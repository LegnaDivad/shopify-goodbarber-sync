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

  // Marcar la tienda como "dirty" para disparar syncs posteriores.
  if (evt.shopDomain) {
    await pool.query(
      `
      insert into public.shopify_shop_dirty (shop_domain, dirty_at, updated_at)
      values ($1, now(), now())
      on conflict (shop_domain)
      do update set dirty_at = excluded.dirty_at, updated_at = excluded.updated_at
      `,
      [evt.shopDomain]
    );
  }
}

module.exports = { insertShopifyWebhookEvent };
