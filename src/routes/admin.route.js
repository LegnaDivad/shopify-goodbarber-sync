const express = require('express');

const { getShopifyAccessToken } = require('../services/shopifyTokenStore');
const { listWebhooks, createWebhook } = require('../services/shopifyWebhooks');

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

// (Opcional pero recomendado) list
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

module.exports = router;
