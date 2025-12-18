const { shopifyGraphql } = require('./shopifyGraphql');

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Usa Admin GraphQL para obtener las colecciones de muchos productos en pocas llamadas,
// evitando el límite "2 calls per second" de REST /collects.
async function fetchCollectionsByProductIds(shopDomain, accessToken, productIdsInput) {
  const numericIds = Array.from(
    new Set(
      (productIdsInput || [])
        .map(id => Number(id))
        .filter(Number.isFinite)
    )
  );

  const result = new Map();
  if (!numericIds.length) return result;

  // Convierte a GIDs de producto para GraphQL
  const gids = numericIds.map(id => `gid://shopify/Product/${id}`);

  const query = `
    query ProductsCollections($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          collections(first: 50) {
            nodes { title handle }
          }
        }
      }
    }
  `;

  for (const group of chunk(gids, 50)) {
    const data = await shopifyGraphql(shopDomain, accessToken, query, { ids: group });

    for (const node of data.nodes || []) {
      if (!node?.id) continue;
      const numericId = Number(String(node.id).split('/').pop());
      const cols = node.collections?.nodes || [];

      result.set(numericId, {
        titles: cols.map(c => c.title).filter(Boolean),
        handles: cols.map(c => c.handle).filter(Boolean),
      });
    }
  }

  return result;
}

module.exports = { fetchCollectionsByProductIds };
