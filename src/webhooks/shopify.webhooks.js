const express = require('express');
const crypto = require('crypto');
const { insertShopifyWebhookEvent } = require('../services/shopifyWebhookEvents.service');

const router = express.Router();

// Shopify requiere validar contra el raw body
const rawJson = express.raw({ type: 'application/json' });

function verifyHmac({ rawBody, hmacHeader, secret }) {
  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody)          // rawBody DEBE ser Buffer
    .digest('base64');

  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(String(hmacHeader || ''), 'utf8');
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

router.post('/shopify', rawJson, async (req, res) => {
  try {
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!secret) return res.status(500).send('Missing SHOPIFY_WEBHOOK_SECRET');

    const hmac = req.get('X-Shopify-Hmac-Sha256');

    // req.body debe ser Buffer por express.raw(); fallback defensivo por si algo cambia
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body || {}));

    const ok = verifyHmac({ rawBody, hmacHeader: hmac, secret });
    if (!ok) return res.status(401).send('Invalid webhook HMAC');

    const topic = req.get('X-Shopify-Topic') || 'unknown';
    const shopHeader = (req.get('X-Shopify-Shop-Domain') || '').toLowerCase();
    const webhookId = req.get('X-Shopify-Webhook-Id') || null;
    const apiVersion = req.get('X-Shopify-API-Version') || null;
    const triggeredAt = req.get('X-Shopify-Triggered-At') || null;
    const eventId = req.get('X-Shopify-Event-Id') || null;

    const payload = JSON.parse(rawBody.toString('utf8'));

    // Encolar en DB (idempotente por event_id).
    await insertShopifyWebhookEvent({
      eventId,
      webhookId,
      topic,
      shopDomain: shopHeader,
      apiVersion,
      triggeredAt,
      payload,
    });

    return res.status(200).send('OK');
  } catch (err) {
    console.error('[WEBHOOK_ERROR]', err);
    return res.status(500).send('Webhook handler error');
  }
});

module.exports = router;

