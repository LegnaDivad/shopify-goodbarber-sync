const express = require('express');
const crypto = require('crypto');

const { pool } = require('../config/db');
const { getShopifyAccessToken } = require('../services/shopifyTokenStore');
const { listWebhooks, createWebhook } = require('../services/shopifyWebhooks');
const { listAllProducts } = require('../services/shopifyAdmin'); // ✅ CAMBIO
const { buildRowsFromShopify, buildGoodbarberCsv } = require('../sync/buildGoodbarberCsv');
const { resolveShopDomain } = require('../services/shopifyShopResolver');

const router = express.Router();

function requireAdminKey(req, res, next) {
  const key = req.get('x-admin-key');
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

const WEBHOOK_TOPICS = [
  'products/create',
  'products/update',
  'products/delete',
  'inventory_levels/update',
];

router.post('/shopify/webhooks/register', requireAdminKey, async (req, res, next) => {
  try {
    const inputShop = req.query.shop;
    if (!inputShop) return res.status(400).json({ error: 'Missing ?shop=' });

    const { shopDomain, accessToken } = await getShopifyAccessToken(inputShop);
    if (!shopDomain) return res.status(404).json({ error: 'Unknown shop/alias', inputShop });
    if (!accessToken) return res.status(404).json({ error: 'Token not found', shopDomain });

    const address = `${process.env.APP_BASE_URL}/webhooks/shopify`;

    const current = await listWebhooks(shopDomain, accessToken);
    const existing = (current.webhooks || []).filter(
      (w) => WEBHOOK_TOPICS.includes(w.topic) && w.address === address
    );

    const existingTopics = new Set(existing.map((w) => w.topic));
    const created = [];

    for (const topic of WEBHOOK_TOPICS) {
      if (!existingTopics.has(topic)) {
        const r = await createWebhook(shopDomain, accessToken, topic, address);
        created.push(r.webhook);
      }
    }

    return res.json({
      ok: true,
      inputShop,
      shopDomain,
      address,
      already: existing.map((w) => ({ id: w.id, topic: w.topic })),
      created: created.map((w) => ({ id: w.id, topic: w.topic })),
    });
  } catch (err) {
    return next(err);
  }
});

// list
router.get('/shopify/webhooks/list', requireAdminKey, async (req, res, next) => {
  try {
    const inputShop = req.query.shop;
    if (!inputShop) return res.status(400).json({ error: 'Missing ?shop=' });

    const { shopDomain, accessToken } = await getShopifyAccessToken(inputShop);
    if (!shopDomain || !accessToken) {
      return res.status(404).json({ error: 'Shop not installed', inputShop });
    }

    const current = await listWebhooks(shopDomain, accessToken);
    return res.json({ ok: true, shopDomain, webhooks: current.webhooks || [] });
  } catch (err) {
    return next(err);
  }
});

router.post('/jobs/sync-latest', requireAdminKey, async (req, res, next) => {
  try {
    const inputShop = req.query.shop;
    if (!inputShop) return res.status(400).json({ error: 'Missing ?shop=' });

    const { shopDomain, accessToken } = await getShopifyAccessToken(inputShop);
    if (!shopDomain || !accessToken) return res.status(404).json({ error: 'Shop not installed', inputShop });

    // Lock simple
    const lockId = crypto.randomUUID();
    const lock = await pool.query(
      `
      update public.shopify_shop_dirty
      set locked_at=now(), lock_id=$2, updated_at=now()
      where shop_domain=$1
        and (locked_at is null or locked_at < now() - interval '10 minutes')
      returning shop_domain
      `,
      [shopDomain, lockId]
    );

    if (!lock.rowCount) {
      return res.status(409).json({ ok: false, shopDomain, reason: 'locked or not dirty' });
    }

    // 1) Crear sync_run
    const run = await pool.query(
      `insert into public.shopify_sync_run (shop_domain) values ($1) returning id`,
      [shopDomain]
    );
    const runId = run.rows[0].id;

    // 2) Generar CSV (✅ CAMBIO: traer TODO con paginación)
    const products = await listAllProducts(shopDomain, accessToken, 250);
    const rows = buildRowsFromShopify(products);
    const csv = buildGoodbarberCsv(rows);

    // 3) Guardar latest
    await pool.query(
      `
      insert into public.goodbarber_export_latest (shop_domain, generated_at, products_count, csv_bytes, csv_text)
      values ($1, now(), $2, $3, $4)
      on conflict (shop_domain)
      do update set
        generated_at=excluded.generated_at,
        products_count=excluded.products_count,
        csv_bytes=excluded.csv_bytes,
        csv_text=excluded.csv_text
      `,
      [shopDomain, products.length, Buffer.byteLength(csv, 'utf8'), csv]
    );

    // 4) Marcar eventos pending como processed
    await pool.query(
      `
      update public.shopify_webhook_event
      set status='processed', processed_at=now()
      where shop_domain=$1 and status='pending'
      `,
      [shopDomain]
    );

    // 5) Limpiar dirty + cerrar run (✅ aquí ya estás guardando métricas)
    await pool.query(`delete from public.shopify_shop_dirty where shop_domain=$1`, [shopDomain]);
    await pool.query(
      `update public.shopify_sync_run
       set status='ok', finished_at=now(), products_count=$2, csv_bytes=$3
       where id=$1`,
      [runId, products.length, Buffer.byteLength(csv, 'utf8')]
    );

    return res.json({ ok: true, shopDomain, runId, productsCount: products.length });
  } catch (err) {
    next(err);
  }
});

router.get('/exports/goodbarber/latest.csv', async (req, res, next) => {
  try {
    const key = req.header('x-export-key');
    if (!process.env.EXPORT_KEY || key !== process.env.EXPORT_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const inputShop = req.query.shop;
    if (!inputShop) return res.status(400).json({ error: 'Missing ?shop=' });

    const shopDomain = await resolveShopDomain(inputShop);
    if (!shopDomain) return res.status(404).json({ error: 'Unknown shop/alias', inputShop });

    const r = await pool.query(
      `select csv_text from public.goodbarber_export_latest where shop_domain=$1`,
      [shopDomain]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'No latest export yet', shopDomain });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="goodbarber_products_latest.csv"');
    return res.status(200).send(r.rows[0].csv_text);
  } catch (err) {
    next(err);
  }
});

router.get('/shopify/products/count', requireAdminKey, async (req, res, next) => {
  try {
    const inputShop = req.query.shop;
    if (!inputShop) return res.status(400).json({ error: 'Missing ?shop=' });

    const { shopDomain, accessToken } = await getShopifyAccessToken(inputShop);
    if (!shopDomain || !accessToken) return res.status(404).json({ error: 'Shop not installed', inputShop });

    const v = process.env.SHOPIFY_API_VERSION || '2025-10';

    const countResp = await fetch(`https://${shopDomain}/admin/api/${v}/products/count.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    const countText = await countResp.text();
    if (!countResp.ok) {
      return res.status(countResp.status).json({ error: 'Shopify count failed', details: countText });
    }

    const countJson = JSON.parse(countText);

    const products = await listAllProducts(shopDomain, accessToken, 250);

    return res.json({
      ok: true,
      shopDomain,
      apiCount: countJson.count,
      pagedCount: products.length,
      matches: countJson.count === products.length,
    });
  } catch (err) {
    next(err);
  }
});



module.exports = router;
