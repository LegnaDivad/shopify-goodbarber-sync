const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';

async function shopifyFetch(shopDomain, accessToken, path) {
  if (!shopDomain) throw new Error('Missing shop domain');
  if (!accessToken) throw new Error('Missing access token for shop');

  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${path}`;

  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify API error ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function listProducts(shopDomain, accessToken, limit = 250) {
  return shopifyFetch(shopDomain, accessToken, `/products.json?limit=${limit}`);
}

module.exports = { listProducts };
