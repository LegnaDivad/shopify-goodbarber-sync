require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  return res.status(200).json({
    status: 'ok',
    service: 'shopify-goodbarber-sync',
    timestamp: new Date().toISOString()
  });
});

// Error handler mínimo
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Service listening on port ${PORT}`);
});
