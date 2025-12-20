const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';

async function shopifyAdminFetch(shopDomain, accessToken, path, init = {}) {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify Admin API ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function listWebhooks(shopDomain, accessToken) {
  return shopifyAdminFetch(shopDomain, accessToken, '/webhooks.json');
}

async function createWebhook(shopDomain, accessToken, topic, address) {
  // REST: POST /webhooks.json { webhook: { topic, address, format:"json" } }
  return shopifyAdminFetch(shopDomain, accessToken, '/webhooks.json', {
    method: 'POST',
    body: JSON.stringify({ webhook: { topic, address, format: 'json' } }),
  });
}

async function deleteWebhook(shopDomain, accessToken, webhookId) {
  return shopifyAdminFetch(shopDomain, accessToken, `/webhooks/${webhookId}.json`, {
    method: 'DELETE',
  });
}

module.exports = { listWebhooks, createWebhook, deleteWebhook };
