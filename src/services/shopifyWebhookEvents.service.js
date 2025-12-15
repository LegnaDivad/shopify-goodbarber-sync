const { pool } = require('../config/db');

async function insertShopifyWebhookEvent(evt) {
  const sql = `
    insert into shopify_webhook_event
      (event_id, webhook_id, topic, shop_domain, api_version, triggered_at, payload)
    values
      ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb)
    on conflict (event_id) do nothing;
  `;

  const params = [
    evt.eventId,
    evt.webhookId || null,
    evt.topic,
    evt.shopDomain || null,
    evt.apiVersion || null,
    evt.triggeredAt || null,
    JSON.stringify(evt.payload),
  ];

  await pool.query(sql, params);
}

module.exports = { insertShopifyWebhookEvent };
