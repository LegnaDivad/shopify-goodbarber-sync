app.use((req, res, next) => {
  if (req.path.startsWith('/auth/shopify')) {
    console.log('[SHOPIFY_AUTH]', req.method, req.originalUrl);
  }
  next();
});

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
const { buildRowsFromShopify, buildGoodbarberCsv } = require('./sync/buildGoodbarberCsv');

// Rutas de autenticación Shopify
const shopifyAuthRoutes = require('./routes/shopifyAuth.routes');
app.use('/auth', shopifyAuthRoutes);

// Export CSV (GoodBarber)
app.get('/exports/goodbarber/products.csv', async (req, res, next) => {
  try {
    const key = req.header('x-export-key');
    const headerKey = req.header('x-export-key');

    if (!process.env.EXPORT_KEY || key !== process.env.EXPORT_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const data = await listProducts(250);
    const products = data.products || [];

    const rows = buildRowsFromShopify(products);
    const csv = buildGoodbarberCsv(rows);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="goodbarber_products.csv"');
    return res.status(200).send(csv);
  } catch (err) {
    return next(err);
  }
});
