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
    // Tomamos las etiquetas desde Shopify pero limitadas a un máximo de 5.
    // Usamos '/' como separador, siguiendo el formato de ejemplo de GoodBarber
    // (tag1/tag2/tag3), que sí acepta múltiples valores.
    const shopifyTags = parseTags(p.tags || '');
    const productTags = shopifyTags.slice(0, 5).join('/');

    // Colecciones: usamos los títulos de las colecciones de Shopify, limitadas a 5
    // y separadas con '/': Collection1/Collection2/Collection3
    const shopifyCollections = Array.isArray(p.collections) ? p.collections : [];
    const productCollections = shopifyCollections
      .map(c => {
        if (!c) return '';
        if (typeof c === 'string') return c.trim();
        return (c.title || c.name || '').trim();
      })
      .filter(Boolean)
      .slice(0, 5)
      .join('/');

    const productImages = Array.isArray(p.images) ? p.images : [];
    const primaryImage = (p.image && p.image.src)
      ? p.image.src
      : (productImages[0] && productImages[0].src) ? productImages[0].src : '';

    // Mapa auxiliar para encontrar la imagen asociada a una variante por image_id
    const imagesById = new Map();
    for (const img of productImages) {
      if (img && img.id && img.src) {
        imagesById.set(img.id, img.src);
      }
    }

    const variants = Array.isArray(p.variants) ? p.variants : [];
    for (let idx = 0; idx < variants.length; idx += 1) {
      const v = variants[idx];
      // Stock
      // Si Shopify no trackea inventario: normalmente inventory_management = null
      const stock =
        v.inventory_management ? String(v.inventory_quantity ?? 0) : 'Unlimited';

      // Peso variante: usamos el campo weight de Shopify tal cual (número)
      // para que GoodBarber lo interprete según la unidad configurada.
      let variantWeight = '';
      if (v.weight != null && !Number.isNaN(Number(v.weight))) {
        variantWeight = String(Number(v.weight));
      }

      // Imagen del producto para esta fila: repartimos las imágenes del array p.images
      // entre las filas de variantes usando el índice (1 -> posición 1, etc.).
      const imageForRow = productImages[idx] || null;
      const productPictUrl = imageForRow && imageForRow.src ? imageForRow.src : '';
      const productPictPosition = imageForRow
        ? (imageForRow.position || idx + 1)
        : '';

      // Imagen variante (si existe una asociada por image_id), si no, la principal
      let variantImage = primaryImage;
      if (v.image_id && imagesById.has(v.image_id)) {
        variantImage = imagesById.get(v.image_id);
      }

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
        variant_weight: variantWeight,
        // Opcionales imágenes:
        product_pict_url: productPictUrl,
        product_pict_position: productPictPosition,      // opcional (1..n)
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
    'variant_weight',
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
