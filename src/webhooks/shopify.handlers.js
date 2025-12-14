const { pool } = require('../config/db');
const {
  stripHtml,
  truncate,
  parseTags,
  pickProductImage,
  pickVariantImageUrl,
  buildVariantOptions,
  safeNumber
} = require('../utils/transform');

function getHeadersMeta(req) {
  return {
    shop_domain: req.get('x-shopify-shop-domain') || null,
    topic: req.get('x-shopify-topic') || null,
    webhook_id: req.get('x-shopify-webhook-id') || req.get('x-request-id') || null,
  };
}

async function insertSyncLog({
  source,
  event_type,
  shop_domain,
  shopify_topic,
  shopify_resource_id,
  status,
  http_status,
  request_id,
  payload,
  error,
  started_at,
  finished_at,
  duration_ms
}) {
  const q = `
    insert into public.sync_log (
      source, event_type, shop_domain, shopify_topic, shopify_resource_id,
      status, http_status, request_id, payload, error, started_at, finished_at, duration_ms
    )
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  `;
  const v = [
    source, event_type, shop_domain, shopify_topic, shopify_resource_id,
    status, http_status, request_id, payload, error, started_at, finished_at, duration_ms
  ];
  await pool.query(q, v);
}

async function upsertProductVariantRow({ meta, product, variant }) {
  const tags = parseTags(product?.tags);
  const img = pickProductImage(product);

  const product_sumario = truncate(stripHtml(product?.body_html || ''), 240);

  // SEO (Shopify a veces expone metafields_global_* en payload)
  const seoTitle = product?.metafields_global_title_tag || product?.seo_title || null;
  const seoDesc  = product?.metafields_global_description_tag || product?.seo_description || null;

  const q = `
    insert into public.product_mapping (
      shop_domain,
      shopify_product_id,
      shopify_variant_id,

      shopify_handle,
      shopify_title,
      shopify_body_html,
      shopify_status,
      shopify_vendor,
      shopify_tags,

      product_url_slug,
      product_titulo,
      product_sumario,
      product_seo_titulo,
      product_seo_resumen,
      product_estado,
      product_brand,
      product_pict_url,
      product_pict_position,

      variant_opciones,
      variant_precio,
      variant_precio_original,
      variant_stock,
      variant_sku,
      variant_peso,
      variant_pict_url,

      last_shopify_updated_at,
      sync_status,
      last_error
    )
    values (
      $1,$2,$3,
      $4,$5,$6,$7,$8,$9,
      $10,$11,$12,$13,$14,$15,$16,$17,$18,
      $19,$20,$21,$22,$23,$24,$25,
      $26,$27,$28
    )
    on conflict (shop_domain, shopify_product_id, shopify_variant_id)
    do update set
      shopify_handle = excluded.shopify_handle,
      shopify_title = excluded.shopify_title,
      shopify_body_html = excluded.shopify_body_html,
      shopify_status = excluded.shopify_status,
      shopify_vendor = excluded.shopify_vendor,
      shopify_tags = excluded.shopify_tags,

      product_url_slug = excluded.product_url_slug,
      product_titulo = excluded.product_titulo,
      product_sumario = excluded.product_sumario,
      product_seo_titulo = excluded.product_seo_titulo,
      product_seo_resumen = excluded.product_seo_resumen,
      product_estado = excluded.product_estado,
      product_brand = excluded.product_brand,
      product_pict_url = excluded.product_pict_url,
      product_pict_position = excluded.product_pict_position,

      variant_opciones = excluded.variant_opciones,
      variant_precio = excluded.variant_precio,
      variant_precio_original = excluded.variant_precio_original,
      variant_stock = excluded.variant_stock,
      variant_sku = excluded.variant_sku,
      variant_peso = excluded.variant_peso,
      variant_pict_url = excluded.variant_pict_url,

      last_shopify_updated_at = excluded.last_shopify_updated_at,
      last_error = null,
      -- si ya estaba synced, lo conservamos; si no, queda pending
      sync_status = case
        when public.product_mapping.sync_status = 'synced' then 'synced'
        else excluded.sync_status
      end
  `;

  const v = [
    meta.shop_domain,
    Number(product.id),
    Number(variant.id),

    product.handle || null,
    product.title || null,
    product.body_html || null,
    product.status || null,
    product.vendor || null,
    tags.length ? tags : null,

    product.handle || null,                 // Url slug
    product.title || null,                  // Titulo
    product_sumario || null,                // Sumario (texto)
    seoTitle || product.title || null,      // SEO titulo
    seoDesc || product_sumario || null,     // SEO resumen
    product.status || null,                 // Estado
    product.vendor || null,                 // Brand
    img.url,                                // Pict_url
    img.position,                           // Pict_position

    buildVariantOptions(variant),           // Opciones
    safeNumber(variant.price),              // Precio
    safeNumber(variant.compare_at_price),   // Precio original
    Number.isFinite(variant.inventory_quantity) ? variant.inventory_quantity : null, // Stock
    variant.sku || null,                    // Sku
    safeNumber(variant.weight),             // Peso
    pickVariantImageUrl(product, variant),  // Variant pict_url

    product.updated_at ? new Date(product.updated_at) : null,
    'pending',
    null
  ];

  await pool.query(q, v);
}

async function handleProductUpsert(req, res) {
  const started = Date.now();
  const meta = getHeadersMeta(req);

  try {
    const product = req.body;

    // Shopify producto trae variants[]
    const variants = Array.isArray(product?.variants) && product.variants.length
      ? product.variants
      : [{ id: 0 }]; // fallback (raro) para no romper (pero idealmente siempre hay variants)

    for (const variant of variants) {
      // En MVP esperamos variant.id real. Si llegara 0, aún insertará con variant_id=0.
      await upsertProductVariantRow({ meta, product, variant });
    }

    const duration = Date.now() - started;

    await insertSyncLog({
      source: 'webhook',
      event_type: meta.topic || 'products/upsert',
      shop_domain: meta.shop_domain,
      shopify_topic: meta.topic,
      shopify_resource_id: String(product?.id ?? ''),
      status: 'success',
      http_status: 200,
      request_id: meta.webhook_id,
      payload: product,
      error: null,
      started_at: new Date(Date.now() - duration),
      finished_at: new Date(),
      duration_ms: duration
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    const duration = Date.now() - started;

    await insertSyncLog({
      source: 'webhook',
      event_type: meta.topic || 'products/upsert',
      shop_domain: meta.shop_domain,
      shopify_topic: meta.topic,
      shopify_resource_id: String(req?.body?.id ?? ''),
      status: 'error',
      http_status: 500,
      request_id: meta.webhook_id,
      payload: req.body ?? null,
      error: { message: err.message, stack: err.stack },
      started_at: new Date(Date.now() - duration),
      finished_at: new Date(),
      duration_ms: duration
    });

    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

async function handleProductDelete(req, res) {
  const started = Date.now();
  const meta = getHeadersMeta(req);

  try {
    const payload = req.body; // { id: ... }
    const productId = Number(payload?.id);

    if (!meta.shop_domain || !Number.isFinite(productId)) {
      return res.status(400).json({ error: 'Invalid delete payload' });
    }

    // No borramos: marcamos disabled para conservar el mapeo con GoodBarber
    await pool.query(
      `
      update public.product_mapping
      set sync_status = 'disabled',
          last_error = null,
          last_shopify_updated_at = now()
      where shop_domain = $1 and shopify_product_id = $2
      `,
      [meta.shop_domain, productId]
    );

    const duration = Date.now() - started;

    await insertSyncLog({
      source: 'webhook',
      event_type: meta.topic || 'products/delete',
      shop_domain: meta.shop_domain,
      shopify_topic: meta.topic,
      shopify_resource_id: String(productId),
      status: 'success',
      http_status: 200,
      request_id: meta.webhook_id,
      payload,
      error: null,
      started_at: new Date(Date.now() - duration),
      finished_at: new Date(),
      duration_ms: duration
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    const duration = Date.now() - started;

    await insertSyncLog({
      source: 'webhook',
      event_type: meta.topic || 'products/delete',
      shop_domain: meta.shop_domain,
      shopify_topic: meta.topic,
      shopify_resource_id: String(req?.body?.id ?? ''),
      status: 'error',
      http_status: 500,
      request_id: meta.webhook_id,
      payload: req.body ?? null,
      error: { message: err.message, stack: err.stack },
      started_at: new Date(Date.now() - duration),
      finished_at: new Date(),
      duration_ms: duration
    });

    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = { handleProductUpsert, handleProductDelete };
