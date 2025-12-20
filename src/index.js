const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();
const express = require('express');

const { testDb } = require('./config/db');
const { getShopifyAccessToken } = require('./services/shopifyTokenStore');
const { listAllProducts } = require('./services/shopifyAdmin'); // ✅ CAMBIO
const { fetchCollectionsByProductIds } = require('./services/shopifyCollectionsMap');
const { buildRowsFromShopify, buildGoodbarberCsv } = require('./sync/buildGoodbarberCsv');

const shopifyAuthRoutes = require('./routes/shopifyAuth.routes');
const adminRoutes = require('./routes/admin.route');
const goodbarberTestRoutes = require('./routes/goodbarberTest.routes');

// ✅ Webhooks: usa SOLO un router
const shopifyWebhooks = require('./webhooks/shopify.webhooks');

const app = express();

/**
 * ✅ 1) Monta webhooks ANTES del express.json global
 * Esto garantiza que el endpoint webhook pueda leer el RAW body.
 */
app.use('/webhooks', shopifyWebhooks);

/**
 * ✅ 2) JSON parser global para el resto de rutas (NO webhooks)
 */
app.use(express.json());

/**
 * Logs para auth
 */
app.use((req, res, next) => {
  if (req.path.startsWith('/auth/shopify')) {
    console.log('[SHOPIFY_AUTH]', req.method, req.originalUrl);
  }
  next();
});

const PORT = process.env.PORT || 3000;

/**
 * Healthchecks
 */
app.get('/health', (req, res) => {
  return res.status(200).json({
    status: 'ok',
    service: 'shopify-goodbarber-sync',
    timestamp: new Date().toISOString(),
  });
});

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

/**
 * Shopify status
 */
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

/**
 * Rutas principales
 */
app.use('/auth', shopifyAuthRoutes);
app.use('/admin', adminRoutes);
app.use(goodbarberTestRoutes);

/**
 * Export CSV (GoodBarber) - on demand
 */
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

    // ✅ CAMBIO: trae TODOS los productos (paginación)
    const products = await listAllProducts(shopDomain, accessToken, 250);

    // Enriquecer con colecciones (best-effort)
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

/**
 * ✅ Error handler AL FINAL
 */
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal server error' });
});

/**
 * ✅ Listen AL FINAL
 */
app.listen(PORT, () => {
  console.log(`Service listening on port ${PORT}`);
});

/**
 * Export CSV latest (GoodBarber)
 */
const { resolveShopDomain } = require('./services/shopifyShopResolver');
const { pool } = require('./config/db');

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
      `select csv_text, generated_at, products_count, csv_bytes
       from public.goodbarber_export_latest
       where shop_domain=$1`,
      [shopDomain]
    );

    if (!r.rowCount) {
      return res.status(404).json({ error: 'No latest export yet', shopDomain });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="goodbarber_products_latest.csv"');
    res.setHeader('X-Export-Generated-At', r.rows[0].generated_at.toISOString?.() || String(r.rows[0].generated_at));
    res.setHeader('X-Export-Products-Count', String(r.rows[0].products_count ?? ''));
    res.setHeader('X-Export-Bytes', String(r.rows[0].csv_bytes ?? ''));

    return res.status(200).send(r.rows[0].csv_text);
  } catch (err) {
    next(err);
  }
});


