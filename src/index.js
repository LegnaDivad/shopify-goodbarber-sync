const { getShopifyAccessToken } = require('./services/shopifyTokenStore');
const shopifyWebhooksRoutes = require('./routes/shopifyWebhooks.routes');


const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json({
  verify: (req, res, buf) => {
    // Guardar rawBody solo en rutas de webhooks Shopify
    if (req.originalUrl.startsWith('/webhooks/shopify')) {
      req.rawBody = buf; // Buffer
    }
  }
}));

app.use((req, res, next) => {
  if (req.path.startsWith('/auth/shopify')) {
    console.log('[SHOPIFY_AUTH]', req.method, req.originalUrl);
  }
  next();
});

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  return res.status(200).json({
    status: 'ok',
    service: 'shopify-goodbarber-sync',
    timestamp: new Date().toISOString()
  });
});
const { testDb } = require('./config/db');

app.get('/health/db', async (req, res) => {
  try {
    const r = await testDb();
    return res.status(200).json({
      status: 'ok',
      db: 'connected',
      db_now: r.now,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(503).json({
      status: 'degraded',
      db: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/auth/shopify/status', (req, res) => {
  res.json({
    ok: true,
    baseUrl: process.env.APP_BASE_URL || null,
    redirectUri: process.env.SHOPIFY_REDIRECT_URI || null,
    scopes: process.env.SHOPIFY_SCOPES || null,
    hasClientId: Boolean(process.env.SHOPIFY_CLIENT_ID),
    hasClientSecret: Boolean(process.env.SHOPIFY_CLIENT_SECRET),
  });
});


// Error handler mínimo
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Service listening on port ${PORT}`);
});

//Rutas de webhooks Shopify
const shopifyWebhooksRouter = require('./webhooks/shopify.routes');
app.use('/webhooks/shopify', shopifyWebhooksRouter);

//Rutas de test GoodBarber
const goodbarberTestRoutes = require('./routes/goodbarberTest.routes');
app.use(goodbarberTestRoutes);

// Rutas de webhooks
const shopifyWebhooks = require('./webhooks/shopify.webhooks');
app.use('/webhooks', shopifyWebhooks);

const { listProducts } = require('./services/shopifyAdmin');
const { fetchCollectionsByProductIds } = require('./services/shopifyCollectionsMap');
const { buildRowsFromShopify, buildGoodbarberCsv } = require('./sync/buildGoodbarberCsv');

// Rutas de autenticación Shopify
const shopifyAuthRoutes = require('./routes/shopifyAuth.routes');
app.use('/auth', shopifyAuthRoutes);

// Export CSV (GoodBarber)
app.get('/exports/goodbarber/products.csv', async (req, res, next) => {
  try {
    const key = req.header('x-export-key');
    if (!process.env.EXPORT_KEY || key !== process.env.EXPORT_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const inputShop = req.query.shop;
    if (!inputShop) return res.status(400).json({ error: 'Missing ?shop=' });

    const { shopDomain, accessToken } = await getShopifyAccessToken(inputShop);
    if (!shopDomain) return res.status(404).json({ error: 'Unknown shop/alias', inputShop });
    if (!accessToken) return res.status(404).json({ error: 'Token not found for shop', shopDomain });

    const data = await listProducts(shopDomain, accessToken, 250);
    const products = data.products || [];

    // Enriquecer productos con títulos de colecciones para el CSV GoodBarber
    // Si algo falla al obtener colecciones, seguimos adelante sin romper el export.
    try {
      const productIds = products
        .map(p => p.id)
        .filter(id => Number.isFinite(Number(id)));

      if (productIds.length) {
        const collectionsMap = await fetchCollectionsByProductIds(
          shopDomain,
          accessToken,
          productIds
        );

        for (const p of products) {
          const pid = Number(p.id);
          const colInfo = collectionsMap.get(pid) || { titles: [] };
          p.collections = colInfo.titles || [];
        }
      }
    } catch (err) {
      console.error('[WARN] Failed to enrich products with collections', err);
    }

    const rows = buildRowsFromShopify(products);
    const csv = buildGoodbarberCsv(rows);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="goodbarber_products.csv"');
    return res.status(200).send(csv);
  } catch (err) {
    return next(err);
  }
});

const adminRoutes = require('./routes/admin.route');

app.use('/webhooks', shopifyWebhooksRoutes);
app.use('/admin', adminRoutes);

app.post('/admin/jobs/sync-latest', requireAdminKey, async (req, res, next) => {
  try {
    const inputShop = req.query.shop; // puede ser alias
    if (!inputShop) return res.status(400).json({ error: 'Missing ?shop=' });

    const { shopDomain, accessToken } = await getShopifyAccessToken(inputShop);
    if (!shopDomain || !accessToken) return res.status(404).json({ error: 'Shop not installed', inputShop });

    // Lock simple (si quieres robustez multi-worker, hacemos SELECT ... FOR UPDATE SKIP LOCKED)
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

    // Si no hay dirty row, igual puedes generar (o devolver "nothing to do")
    // Aquí: si no lockea, devolvemos 409
    if (!lock.rowCount) {
      return res.status(409).json({ ok: false, shopDomain, reason: 'locked or not dirty' });
    }

    // 1) Crear sync_run
    const run = await pool.query(
      `insert into public.shopify_sync_run (shop_domain) values ($1) returning id`,
      [shopDomain]
    );
    const runId = run.rows[0].id;

    // 2) Generar CSV (reusando tu pipeline actual)
    const data = await listProducts(shopDomain, accessToken, 250);
    const products = data.products || [];
    const rows = buildRowsFromShopify(products);
    const csv = buildGoodbarberCsv(rows);

    // 3) Guardar latest
    await pool.query(
      `
      insert into public.goodbarber_export_latest (shop_domain, generated_at, products_count, csv_bytes, csv_text)
      values ($1, now(), $2, $3, $4)
      on conflict (shop_domain)
      do update set generated_at=excluded.generated_at, products_count=excluded.products_count, csv_bytes=excluded.csv_bytes, csv_text=excluded.csv_text
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

    // 5) Limpiar dirty + cerrar run
    await pool.query(`delete from public.shopify_shop_dirty where shop_domain=$1`, [shopDomain]);
    await pool.query(
      `update public.shopify_sync_run set status='ok', finished_at=now(), products_count=$2, csv_bytes=$3 where id=$1`,
      [runId, products.length, Buffer.byteLength(csv, 'utf8')]
    );

    return res.json({ ok: true, shopDomain, runId, productsCount: products.length });
  } catch (err) {
    next(err);
  }
});

app.get('/exports/goodbarber/latest.csv', async (req, res, next) => {
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
