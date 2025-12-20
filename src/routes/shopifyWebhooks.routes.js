const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

// Solo expone el endpoint de consulta de eventos recientes.
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
