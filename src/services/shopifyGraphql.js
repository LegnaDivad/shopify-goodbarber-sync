async function shopifyGraphql(shopDomain, accessToken, query, variables = {}) {
  if (!shopDomain) throw new Error('Missing shop domain');
  if (!accessToken) throw new Error('Missing access token for shop');

  const apiVersion = process.env.SHOPIFY_API_VERSION || '2025-10';
  const url = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`Shopify GraphQL invalid JSON response: ${text}`);
  }

  if (!res.ok || json.errors) {
    throw new Error(`Shopify GraphQL error ${res.status}: ${JSON.stringify(json.errors || json)}`);
  }

  return json.data;
}

module.exports = { shopifyGraphql };
