const express = require('express');
const crypto = require('crypto');
const { insertShopifyWebhookEvent } = require('../services/shopifyWebhookEvents.service');
const { pool } = require('../config/db');

const router = express.Router();

// ✅ Raw body para validar HMAC (Shopify firma el raw body)
const rawJson = express.raw({ type: 'application/json' });

function timingSafeEqualBase64(a, b) {
  const aBuf = Buffer.from(a || '', 'utf8');
  const bBuf = Buffer.from(b || '', 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * POST /webhooks/shopify
 * (Recibe webhooks Shopify)
 */
router.post('/shopify', rawJson, async (req, res) => {
  try {
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ error: 'Missing SHOPIFY_WEBHOOK_SECRET' });

    // Headers (Shopify)
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const topic = req.get('X-Shopify-Topic');
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    const apiVersion = req.get('X-Shopify-API-Version') || null;
    const webhookId = req.get('X-Shopify-Webhook-Id') || null;
    const triggeredAt = req.get('X-Shopify-Triggered-At') || null;
    const eventId = req.get('X-Shopify-Event-Id') || null; // ⚠️ no siempre existe

    // ✅ Validación mínima realista
    if (!hmacHeader || !topic || !shopDomain) {
      return res.status(400).json({ error: 'Missing required Shopify headers' });
    }

    // ✅ Asegurar Buffer para HMAC (defensivo)
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body));

    // HMAC base64 sobre raw body
    const digest = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    const ok = timingSafeEqualBase64(digest, hmacHeader);
    if (!ok) return res.status(401).json({ error: 'Invalid webhook signature' });

    // Parse payload solo después del HMAC
    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    // Encolar / persistir evento (tu servicio)
    await insertShopifyWebhookEvent({
      eventId,      // puede ser null
      webhookId,    // usualmente presente
      topic,
      shopDomain,
      apiVersion,
      triggeredAt,
      payload,
    });

    // Responder rápido a Shopify
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[SHOPIFY_WEBHOOK_ERROR]', err);
    return res.status(500).json({ error: 'Webhook handler error' });
  }
});

/**
 * GET /webhooks/shopify/recent?shop=...
 * (Debug: últimos webhooks guardados)
 */
router.get('/shopify/recent', async (req, res) => {
  try {
    const shop = String(req.query.shop || '').toLowerCase().trim();
    if (!shop) return res.status(400).json({ ok: false, error: 'Missing ?shop=' });

    const r = await pool.query(
      `select id, shop_domain, topic, webhook_id, status, received_at
       from public.shopify_webhook_event
       where shop_domain = $1
       order by received_at desc
       limit 20`,
      [shop]
    );

    return res.json({ ok: true, rows: r.rows });
  } catch (err) {
    console.error('[WEBHOOK_RECENT_ERROR]', err);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

module.exports = router;
