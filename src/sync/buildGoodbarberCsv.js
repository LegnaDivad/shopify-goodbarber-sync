const { stringify } = require('csv-stringify/sync');
const slugify = require('../utils/slugify');
const toGoodbarberOptions = require('../utils/goodbarberOptions');
const { stripHtml, truncate, parseTags } = require('../utils/transform');

function buildRowsFromShopify(products) {
  const rows = [];

  for (const p of products) {
    const productTitle = p.title || '';
    const productSlug = p.handle ? p.handle : slugify(productTitle);
    const productSummary = truncate(stripHtml(p.body_html || ''), 240);
    const productBrand = p.vendor || '';
    const productTags = parseTags(p.tags || '').join(',');
    const productCollections = Array.isArray(p.collections)
      ? p.collections
          .map(c => (typeof c === 'string' ? c : (c && c.title) || ''))
          .map(t => String(t).trim())
          .filter(Boolean)
          .join(',')
      : '';

    const productImage = (p.image && p.image.src) ? p.image.src : '';

    const variants = Array.isArray(p.variants) ? p.variants : [];
    for (const v of variants) {
      // Stock
      // Si Shopify no trackea inventario: normalmente inventory_management = null
      const stock =
        v.inventory_management ? String(v.inventory_quantity ?? 0) : 'Unlimited';

      // Imagen variante (si existe), si no fallback a la del producto
      const variantImage = v.image_id ? productImage : productImage;

      rows.push({
        product_id: '',                 // vacío para altas nuevas en GoodBarber
        variant_id: '',                 // vacío para altas nuevas en GoodBarber
        product_title: productTitle,
        product_summary: productSummary,
        product_brand: productBrand,
        product_tags: productTags,
        product_collections: productCollections,
        product_url_slug: productSlug,
        variant_options: toGoodbarberOptions(p, v), // [[size:36]][[color:red]]
        variant_stock: stock,
        variant_sku: v.sku || '',
        variant_price: v.price || '',
        // Opcionales imágenes:
        product_pict_url: productImage,
        product_pict_position: '',      // opcional (1..n)
        variant_pict_url: variantImage,
      });
    }
  }

  return rows;
}

function buildGoodbarberCsv(rows) {
  const columns = [
    'product_id',
    'variant_id',
    'product_title',
    'product_summary',
    'product_brand',
    'product_tags',
    'product_collections',
    'product_url_slug',
    'variant_options',
    'variant_stock',
    'variant_sku',
    'variant_price',
    'product_pict_url',
    'product_pict_position',
    'variant_pict_url',
  ];

  return stringify(rows, {
    header: true,
    columns,
    delimiter: ';',   // en ejemplos oficiales usan ; :contentReference[oaicite:3]{index=3}
    quoted: true,
  });
}

module.exports = { buildRowsFromShopify, buildGoodbarberCsv };
