const express = require('express');
const crypto = require('crypto');
const { insertShopifyWebhookEvent } = require('../services/shopifyWebhookEvents.service');

const router = express.Router();

// Shopify requiere validar contra el raw body
const rawJson = express.raw({ type: 'application/json' });

function timingSafeEqualBase64(a, b) {
  const aBuf = Buffer.from(a || '', 'utf8');
  const bBuf = Buffer.from(b || '', 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

router.post('/shopify', rawJson, async (req, res) => {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'Missing SHOPIFY_WEBHOOK_SECRET' });

  // Headers (case-insensitive)
  const hmacHeader = req.get('x-shopify-hmac-sha256') || req.get('X-Shopify-Hmac-Sha256');
  const topic = req.get('x-shopify-topic') || req.get('X-Shopify-Topic');
  const shopDomain = req.get('x-shopify-shop-domain') || req.get('X-Shopify-Shop-Domain');
  const apiVersion = req.get('x-shopify-api-version') || req.get('X-Shopify-API-Version');
  const webhookId = req.get('x-shopify-webhook-id') || req.get('X-Shopify-Webhook-Id');
  const triggeredAt = req.get('x-shopify-triggered-at') || req.get('X-Shopify-Triggered-At');
  const eventId = req.get('x-shopify-event-id') || req.get('X-Shopify-Event-Id');

  if (!hmacHeader || !topic || !eventId) {
    return res.status(400).json({ error: 'Missing required Shopify headers' });
  }

  // Calcula HMAC (base64) sobre el raw body
  const digest = crypto
    .createHmac('sha256', secret)
    .update(req.body)          // req.body es Buffer por express.raw
    .digest('base64');

  const ok = timingSafeEqualBase64(digest, hmacHeader);
  if (!ok) return res.status(401).json({ error: 'Invalid webhook signature' });

  // Parse payload
  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // Encolar (idempotente por event_id)
  await insertShopifyWebhookEvent({
    eventId,
    webhookId,
    topic,
    shopDomain,
    apiVersion,
    triggeredAt,
    payload,
  });

  // Responder rápido
  return res.status(200).json({ ok: true });
});

module.exports = router;
