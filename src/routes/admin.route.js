const express = require('express');
const crypto = require('crypto');

const { pool } = require('../config/db');
const { getShopifyAccessToken } = require('../services/shopifyTokenStore');
const { listWebhooks, createWebhook } = require('../services/shopifyWebhooks');
const { listAllProducts } = require('../services/shopifyAdmin');
const { buildRowsFromShopify, buildGoodbarberCsv } = require('../sync/buildGoodbarberCsv');
const { resolveShopDomain } = require('../services/shopifyShopResolver');

const router = express.Router();

/**
 * ============================================================
 * Admin auth middleware
 * ============================================================
 */
function requireAdminKey(req, res, next) {
  const key = req.get('x-admin-key');
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

/**
 * ============================================================
 * Helpers: DB table existence + pending shops
 * ============================================================
 */
async function tableExists(tableName) {
  const r = await pool.query(
    `select 1
     from information_schema.tables
     where table_schema='public' and table_name=$1
     limit 1`,
    [tableName]
  );
  return r.rowCount > 0;
}

async function listPendingShops({ limit = 20 } = {}) {
  const hasDirty = await tableExists('shopify_shop_dirty');

  if (hasDirty) {
    const r = await pool.query(
      `select shop_domain
       from public.shopify_shop_dirty
       order by dirty_at asc
       limit $1`,
      [limit]
    );
    return r.rows.map((x) => x.shop_domain);
  }

  const r = await pool.query(
    `select shop_domain, min(received_at) as first_pending_at
     from public.shopify_webhook_event
     where status='pending'
     group by shop_domain
     order by first_pending_at asc
     limit $1`,
    [limit]
  );
  return r.rows.map((x) => x.shop_domain);
}

/**
 * ============================================================
 * Helpers: Advisory locks (avoid concurrent sync per shop)
 * ============================================================
 */
async function tryLockShop(shopDomain) {
  const r = await pool.query(`select pg_try_advisory_lock(hashtext($1)) as locked`, [shopDomain]);
  return !!r.rows?.[0]?.locked;
}

async function unlockShop(shopDomain) {
  await pool.query(`select pg_advisory_unlock(hashtext($1))`, [shopDomain]);
}

/**
 * ============================================================
 * Core runner: runSyncLatestForShop
 *
 * This is the refactor: single function used by:
 * - POST /jobs/sync-latest (single shop)
 * - POST /jobs/sync-latest-all (batch)
 *
 * Contract:
 * - inputShop can be alias or canonical domain
 * - returns { ok, shopDomain, runId, productsCount, csvBytes, clearedDirty }
 * ============================================================
 */
async function runSyncLatestForShop(inputShop, { requireDirty = false } = {}) {
  if (!inputShop) throw new Error('Missing shop');

  const { shopDomain, accessToken } = await getShopifyAccessToken(inputShop);
  if (!shopDomain || !accessToken) {
    const e = new Error(`Shop not installed: ${inputShop}`);
    e.statusCode = 404;
    throw e;
  }

  // If the dirty table exists, we optionally enforce "dirty gate" (single-shop endpoint behavior).
  const hasDirty = await tableExists('shopify_shop_dirty');
  let clearedDirty = false;

  if (requireDirty && hasDirty) {
    // Lock via row-based lock (legacy behavior) to gate single-shop sync.
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
      const e = new Error('locked or not dirty');
      e.statusCode = 409;
      e.meta = { ok: false, shopDomain, reason: 'locked or not dirty' };
      throw e;
    }
  }

  // Create sync_run
  const run = await pool.query(
    `insert into public.shopify_sync_run (shop_domain) values ($1) returning id`,
    [shopDomain]
  );
  const runId = run.rows[0].id;

  try {
    // Fetch all products (paginated)
    const products = await listAllProducts(shopDomain, accessToken, 250);

    // Build CSV
    const rows = buildRowsFromShopify(products);
    const csv = buildGoodbarberCsv(rows);
    const csvBytes = Buffer.byteLength(csv, 'utf8');

    // Upsert latest
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
      [shopDomain, products.length, csvBytes, csv]
    );

    // Mark pending webhook events as processed
    await pool.query(
      `
      update public.shopify_webhook_event
      set status='processed', processed_at=now()
      where shop_domain=$1 and status='pending'
      `,
      [shopDomain]
    );

    // Clear dirty flag (if table exists)
    if (hasDirty) {
      const del = await pool.query(`delete from public.shopify_shop_dirty where shop_domain=$1`, [shopDomain]);
      clearedDirty = del.rowCount > 0;
    }

    // Close run
    await pool.query(
      `update public.shopify_sync_run
       set status='ok', finished_at=now(), products_count=$2, csv_bytes=$3
       where id=$1`,
      [runId, products.length, csvBytes]
    );

    return {
      ok: true,
      shopDomain,
      runId: String(runId),
      productsCount: products.length,
      csvBytes,
      clearedDirty,
    };
  } catch (err) {
    // Mark run failed
    await pool.query(
      `update public.shopify_sync_run
       set status='failed', finished_at=now(), error=$2
       where id=$1`,
      [runId, String(err?.message || err)]
    );
    throw err;
  }
}

/**
 * ============================================================
 * Shopify Webhooks: register/list (unchanged)
 * ============================================================
 */
const WEBHOOK_TOPICS = ['products/create', 'products/update', 'products/delete', 'inventory_levels/update'];

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

/**
 * ============================================================
 * Jobs: sync-latest (single shop)
 * Behavior preserved:
 * - requires ?shop=
 * - requires shopify_shop_dirty row to exist and be lockable (if table exists)
 * ============================================================
 */
router.post('/jobs/sync-latest', requireAdminKey, async (req, res, next) => {
  try {
    const inputShop = req.query.shop;
    if (!inputShop) return res.status(400).json({ error: 'Missing ?shop=' });

    const out = await runSyncLatestForShop(inputShop, { requireDirty: true });
    return res.json(out);
  } catch (err) {
    // Preserve prior 409 payload if we have it
    if (err?.statusCode === 409 && err?.meta) return res.status(409).json(err.meta);
    if (err?.statusCode === 404) return res.status(404).json({ error: err.message });
    return next(err);
  }
});

/**
 * ============================================================
 * Jobs: sync-latest-all (batch)
 * - finds pending shops (dirty or pending webhooks)
 * - uses advisory locks to avoid concurrent processing
 * - processes up to ?limit=20 by default
 * ============================================================
 */
router.post('/jobs/sync-latest-all', requireAdminKey, async (req, res, next) => {
  try {
    const limit = Number(req.query.limit || 20);
    const shops = await listPendingShops({ limit });

    const results = [];
    for (const shopDomain of shops) {
      const locked = await tryLockShop(shopDomain);
      if (!locked) {
        results.push({ shopDomain, ok: false, status: 'skipped', reason: 'locked' });
        continue;
      }

      try {
        const out = await runSyncLatestForShop(shopDomain, { requireDirty: false });
        results.push({ shopDomain, ok: true, status: 'processed', ...out });
      } catch (err) {
        results.push({
          shopDomain,
          ok: false,
          status: 'failed',
          error: String(err?.message || err),
        });
      } finally {
        await unlockShop(shopDomain);
      }
    }

    const processed = results.filter((r) => r.status === 'processed').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    return res.json({
      ok: true,
      limit,
      shopsFound: shops.length,
      processed,
      skipped,
      failed,
      results,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * ============================================================
 * Exports: latest.csv (unchanged)
 * ============================================================
 */
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

    const r = await pool.query(`select csv_text from public.goodbarber_export_latest where shop_domain=$1`, [
      shopDomain,
    ]);
    if (!r.rowCount) return res.status(404).json({ error: 'No latest export yet', shopDomain });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="goodbarber_products_latest.csv"');
    return res.status(200).send(r.rows[0].csv_text);
  } catch (err) {
    return next(err);
  }
});

/**
 * ============================================================
 * Diagnostics: products/count (unchanged)
 * ============================================================
 */
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
    return next(err);
  }
});

module.exports = router;
