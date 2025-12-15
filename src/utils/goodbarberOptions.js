module.exports = function toGoodbarberOptions(product, variant) {
  // Shopify: product.options => [{name:'Size'}, {name:'Color'}]
  // Variant: option1/option2/option3 => valores
  const names = (product.options || []).map(o => o.name).filter(Boolean);
  const values = [variant.option1, variant.option2, variant.option3].filter(Boolean);

  const pairs = names.map((name, i) => {
    const key = String(name).trim().toLowerCase().replace(/\s+/g, '_');
    const val = values[i];
    return val ? `[[${key}:${val}]]` : null;
  }).filter(Boolean);

  return pairs.join('');
};
