function toSlug(handle) {
  return (handle || '').toString().trim();
}

function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Campos GoodBarber (producto):
 * Id, Url slug, Collections, Collections_slug, Titulo, SEO titulo, Sumario,
 * SEO resumen, Estado, Brand, Tags, Pict_url, Pict_position
 *
 * Campos GoodBarber (variante):
 * Id, Opciones, Precio, Precio original, Stock, Sku, Peso, Pict_url
 */
function mapShopifyProductToGoodBarber(shopifyProduct, { collections = [] } = {}) {
  const primaryImage = shopifyProduct?.image?.src || shopifyProduct?.images?.[0]?.src || null;

  return {
    // Id lo asigna GoodBarber; aquí NO lo mandamos en create (lo guardamos en DB mapping)
    url_slug: toSlug(shopifyProduct?.handle),
    collections: collections.map(c => c.title).filter(Boolean),
    collections_slug: collections.map(c => c.handle).filter(Boolean),
    titulo: shopifyProduct?.title || '',
    seo_titulo: shopifyProduct?.seo?.title || shopifyProduct?.title || '',
    sumario: stripHtml(shopifyProduct?.body_html || ''),
    seo_resumen: shopifyProduct?.seo?.description || '',
    estado: shopifyProduct?.status || 'active', // active|draft|archived (Shopify)
    brand: shopifyProduct?.vendor || '',
    tags: (shopifyProduct?.tags || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean),
    pict_url: primaryImage,
    pict_position: shopifyProduct?.image?.position ?? 1,
  };
}

function mapShopifyVariantToGoodBarber(shopifyVariant, { productImageUrl = null } = {}) {
  const variantImage = shopifyVariant?.image?.src || null;
  const opts = [shopifyVariant?.option1, shopifyVariant?.option2, shopifyVariant?.option3].filter(Boolean);

  return {
    // Id lo asigna GoodBarber
    opciones: opts, // GoodBarber: “Opciones”
    precio: shopifyVariant?.price != null ? Number(shopifyVariant.price) : null,
    precio_original: shopifyVariant?.compare_at_price != null ? Number(shopifyVariant.compare_at_price) : null,
    stock: shopifyVariant?.inventory_quantity ?? null,
    sku: shopifyVariant?.sku || '',
    // Shopify expone grams normalmente; si GoodBarber espera kg, convertimos después (cuando confirmemos).
    peso: shopifyVariant?.grams ?? null,
    pict_url: variantImage || productImageUrl,
  };
}

module.exports = {
  mapShopifyProductToGoodBarber,
  mapShopifyVariantToGoodBarber,
};
