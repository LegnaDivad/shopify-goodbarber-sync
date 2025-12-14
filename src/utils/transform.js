function stripHtml(html = '') {
  // MVP: strip simple. Si luego quieres robustez, metemos una lib.
  const text = String(html).replace(/<[^>]*>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text, max = 240) {
  const t = String(text || '');
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function parseTags(tags) {
  // Shopify webhooks suelen traer tags como string "a, b, c"
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map(t => String(t).trim()).filter(Boolean);

  return String(tags)
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
}

function pickProductImage(product) {
  const img = product?.image?.src
    ? { src: product.image.src, position: product.image.position }
    : (Array.isArray(product?.images) && product.images.length ? product.images[0] : null);

  return {
    url: img?.src || null,
    position: Number.isFinite(img?.position) ? img.position : 1
  };
}

function pickVariantImageUrl(product, variant) {
  const productImage = pickProductImage(product).url;
  const imageId = variant?.image_id;

  if (!imageId || !Array.isArray(product?.images)) return productImage;

  const found = product.images.find(i => i?.id === imageId);
  return found?.src || productImage;
}

function buildVariantOptions(variant) {
  // GoodBarber: "Opciones" -> lo guardamos estructurado (jsonb)
  return {
    option1: variant?.option1 ?? null,
    option2: variant?.option2 ?? null,
    option3: variant?.option3 ?? null,
    title: variant?.title ?? null
  };
}

function safeNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  stripHtml,
  truncate,
  parseTags,
  pickProductImage,
  pickVariantImageUrl,
  buildVariantOptions,
  safeNumber
};
