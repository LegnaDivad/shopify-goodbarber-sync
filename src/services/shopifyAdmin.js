const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

function getBaseUrl() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) throw new Error('Missing SHOPIFY_STORE_DOMAIN');
  return `https://${domain}/admin/api/${SHOPIFY_API_VERSION}`;
}

async function shopifyFetch(path) {
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!token) throw new Error('Missing SHOPIFY_ACCESS_TOKEN');

  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

// MVP: 250 primeros. (Luego hacemos paginación por Link header si lo necesitas)
async function listProducts(limit = 250) {
  return shopifyFetch(`/products.json?limit=${limit}`);
}

module.exports = { listProducts };
