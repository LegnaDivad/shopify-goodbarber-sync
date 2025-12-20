const express = require('express');
const { pool } = require('../config/db');
const { verifyShopifyWebhookHmac } = require('../utils/verifyShopifyWebhook');

const router = express.Router();

// IMPORTANTE: Shopify requiere validar con el body crudo.
// Por eso usamos express.raw SOLO en esta ruta.
router.post(
  '/shopify',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const topic = req.header('x-shopify-topic') || 'unknown';
      const shopDomain = req.header('x-shopify-shop-domain') || 'unknown';
      const webhookId = req.header('x-shopify-webhook-id') || null;
      const hmac = req.header('x-shopify-hmac-sha256');

      const ok = verifyShopifyWebhookHmac(req.body, hmac, process.env.SHOPIFY_WEBHOOK_SECRET);
      if (!ok) {
        // 401 para que quede claro que no pasó autenticación
        return res.status(401).json({ ok: false, error: 'Invalid webhook HMAC' });
      }

      // Parse JSON una vez validado
      let payload;
      try {
        payload = JSON.parse(req.body.toString('utf8'));
      } catch {
        return res.status(400).json({ ok: false, error: 'Invalid JSON payload' });
      }

      await pool.query(
        `
        insert into public.shopify_webhook_event (shop_domain, topic, webhook_id, payload, status)
        values ($1, $2, $3, $4, 'pending')
        `,
        [shopDomain, topic, webhookId, payload]
      );

      await pool.query(
        `
        insert into public.shopify_shop_dirty (shop_domain, dirty_at, updated_at)
        values ($1, now(), now())
        on conflict (shop_domain)
        do update set dirty_at = excluded.dirty_at, updated_at = excluded.updated_at
        `,
        [shopDomain]
      );

      // Shopify espera 200 rápido
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[WEBHOOK_ERROR]', err);
      return res.status(500).json({ ok: false, error: 'Webhook handler failed' });
    }
  }
);

router.get('/shopify/recent', async (req, res) => {
  const shop = (req.query.shop || '').toLowerCase().trim();
  const q = shop
    ? `select id, shop_domain, topic, webhook_id, received_at, status
       from public.shopify_webhook_event
       where shop_domain=$1
       order by received_at desc
       limit 20`
    : `select id, shop_domain, topic, webhook_id, received_at, status
       from public.shopify_webhook_event
       order by received_at desc
       limit 20`;

  const r = shop ? await pool.query(q, [shop]) : await pool.query(q);
  res.json({ ok: true, rows: r.rows });
});

module.exports = router;
