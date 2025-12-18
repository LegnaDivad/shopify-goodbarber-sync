const { getShopifyAccessToken } = require('./services/shopifyTokenStore');


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
const goodbarberTestRoutes = require('./webhooks/goodbarberTest.routes');
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
    const productIds = products.map(p => p.id).filter(id => Number.isFinite(Number(id)));
    const collectionsMap = await fetchCollectionsByProductIds(shopDomain, accessToken, productIds);

    for (const p of products) {
      const pid = Number(p.id);
      const colInfo = collectionsMap.get(pid) || { titles: [] };
      p.collections = colInfo.titles || [];
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
