const crypto = require('crypto');

function verifyShopifyWebhookHmac(rawBodyBuffer, hmacHeader, webhookSecret) {
  if (!webhookSecret) throw new Error('Missing SHOPIFY_WEBHOOK_SECRET');
  if (!hmacHeader) return false;

  // Shopify manda HMAC base64
  const digest = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBodyBuffer)
    .digest('base64');

  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(String(hmacHeader), 'utf8');
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

module.exports = { verifyShopifyWebhookHmac };
