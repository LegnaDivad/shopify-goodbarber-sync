const { shopifyFetch } = require('./shopifyAdmin');

async function fetchCollectionsByProductIds(shopDomain, accessToken, productIdsInput) {
  const ids = Array.from(
    new Set(
      (productIdsInput || [])
        .map(id => Number(id))
        .filter(Number.isFinite)
    )
  );

  const result = new Map();
  if (!ids.length) return result;

  const productToCollectionIds = new Map();
  for (const id of ids) {
    productToCollectionIds.set(id, new Set());
  }

  const allCollectionIds = new Set();

  // 1) Collects por producto -> collection_ids
  for (const productId of ids) {
    const data = await shopifyFetch(
      shopDomain,
      accessToken,
      `/collects.json?product_id=${productId}&limit=250`
    );

    const collects = Array.isArray(data?.collects) ? data.collects : [];
    for (const c of collects) {
      const cid = Number(c.collection_id);
      if (!Number.isFinite(cid)) continue;
      allCollectionIds.add(cid);
      const set = productToCollectionIds.get(productId);
      if (set) set.add(cid);
    }
  }

  if (!allCollectionIds.size) {
    for (const id of ids) {
      result.set(id, { titles: [], handles: [] });
    }
    return result;
  }

  // 2) Fetch metadatos de colecciones (custom + smart)
  const collectionMeta = new Map(); // id -> { title, handle }
  const chunkSize = 50;
  const allIdsArr = Array.from(allCollectionIds);

  for (let i = 0; i < allIdsArr.length; i += chunkSize) {
    const chunk = allIdsArr.slice(i, i + chunkSize);
    const idsParam = chunk.join(',');

    // Custom collections
    const customRes = await shopifyFetch(
      shopDomain,
      accessToken,
      `/custom_collections.json?ids=${idsParam}&limit=250`
    );
    const customCols = Array.isArray(customRes?.custom_collections)
      ? customRes.custom_collections
      : [];

    for (const col of customCols) {
      const id = Number(col.id);
      if (!Number.isFinite(id)) continue;
      collectionMeta.set(id, {
        title: col.title || '',
        handle: col.handle || ''
      });
    }

    // Smart collections
    const smartRes = await shopifyFetch(
      shopDomain,
      accessToken,
      `/smart_collections.json?ids=${idsParam}&limit=250`
    );
    const smartCols = Array.isArray(smartRes?.smart_collections)
      ? smartRes.smart_collections
      : [];

    for (const col of smartCols) {
      const id = Number(col.id);
      if (!Number.isFinite(id)) continue;
      collectionMeta.set(id, {
        title: col.title || '',
        handle: col.handle || ''
      });
    }
  }

  // 3) Construir resultado: productId -> { titles, handles }
  for (const [productId, colIdsSet] of productToCollectionIds.entries()) {
    const titles = [];
    const handles = [];

    for (const cid of colIdsSet) {
      const meta = collectionMeta.get(cid);
      if (!meta) continue;
      if (meta.title) titles.push(meta.title);
      if (meta.handle) handles.push(meta.handle);
    }

    result.set(productId, { titles, handles });
  }

  return result;
}

module.exports = { fetchCollectionsByProductIds };
