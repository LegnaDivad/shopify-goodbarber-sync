const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';

/**
 * Low-level Shopify Admin API fetch that returns both parsed JSON data and response headers
 * so callers can handle pagination via the `Link` header.
 */
async function shopifyFetch(shopDomain, accessToken, path, init = {}) {
  if (!shopDomain) throw new Error('Missing shop domain');
  if (!accessToken) throw new Error('Missing access token for shop');

  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${path}`;

  const res = await fetch(url, {
    method: init.method || 'GET',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    body: init.body,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify API error ${res.status}: ${text}`);

  // Some endpoints may return empty body; handle safely.
  const data = text ? JSON.parse(text) : null;

  return { data, headers: res.headers };
}

/**
 * Parse Shopify REST pagination header:
 * Link: <https://...page_info=XYZ...>; rel="next", <...>; rel="previous"
 */
function getNextPageInfo(linkHeader) {
  if (!linkHeader) return null;

  // Example segment: <https://shop.myshopify.com/admin/api/2025-10/products.json?limit=250&page_info=XYZ>; rel="next"
  const parts = linkHeader.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match && match[1]) {
      const nextUrl = new URL(match[1]);
      return nextUrl.searchParams.get('page_info');
    }
  }
  return null;
}

/**
 * Backwards-compatible single-page products fetch (first page only).
 */
async function listProducts(shopDomain, accessToken, limit = 250) {
  const qs = new URLSearchParams({ limit: String(limit) });
  const { data } = await shopifyFetch(shopDomain, accessToken, `/products.json?${qs.toString()}`);
  return data;
}

/**
 * Fetch ALL products using REST pagination (`Link` header + page_info).
 * Returns a flat array of products (not wrapped in {products:...}).
 */
async function listAllProducts(shopDomain, accessToken, limit = 250) {
  const all = [];
  let pageInfo = null;

  while (true) {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (pageInfo) qs.set('page_info', pageInfo);

    const { data, headers } = await shopifyFetch(
      shopDomain,
      accessToken,
      `/products.json?${qs.toString()}`
    );

    const products = data?.products || [];
    all.push(...products);

    const link = headers.get('link') || headers.get('Link');
    pageInfo = getNextPageInfo(link);

    if (!pageInfo) break;
  }

  return all;
}

module.exports = { listProducts, listAllProducts, shopifyFetch, getNextPageInfo };
