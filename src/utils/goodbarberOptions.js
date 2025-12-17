function normalizeKey(name) {
  const raw = String(name || '').trim().toLowerCase();

  // Eliminar acentos/diacríticos
  const withoutAccents = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Espacios -> '_' y luego limitar a [a-z0-9_]
  const withUnderscore = withoutAccents.replace(/\s+/g, '_');

  return withUnderscore.replace(/[^a-z0-9_]/g, '');
}

function normalizeValue(val) {
  if (val === null || val === undefined) return null;
  const v = String(val).trim();
  return v === '' ? null : v;
}

module.exports = function toGoodbarberOptions(product, variant) {
  // Shopify: product.options => [{name:'Size'}, {name:'Color'}]
  // Variant: option1/option2/option3 => valores
  const names = (product.options || []).map(o => o.name).filter(Boolean);
  const values = [variant.option1, variant.option2, variant.option3];

  const pairs = names
    .map((name, i) => {
      const key = normalizeKey(name);
      const val = normalizeValue(values[i]);
      if (!key || val === null) return null;

      // Formato final: [[key:value]] con un solo ':' separador
      return `[[${key}:${val}]]`;
    })
    .filter(Boolean);

  return pairs.join('');
};
