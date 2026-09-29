const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const healthRouter = require('./routes/health');
const webhookRouter = require('./routes/webhook');
const apiRouter = require('./routes/api');
const { modelDiscoveryService } = require('./services/modelDiscovery');

const app = express();

// Enable CORS for frontend
app.use(cors());

// Parse JSON body while capturing rawBody for webhook HMAC verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/health', healthRouter);
app.use('/webhook', webhookRouter);
app.use('/api', apiRouter);

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'Instagram Comment-to-DM Automation Server',
    status: 'running',
    version: '2.0.0',
    endpoints: {
      health: '/health',
      webhook: '/webhook',
      api: '/api'
    }
  });
});

const PORT = config.port;

// Start server on 0.0.0.0 so cloud providers (Render, Railway, Fly, Docker) detect open port
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Instagram Automation Server listening on port ${PORT}`);
  console.log(`[Server] Environment: ${config.env}`);
  console.log(`[Server] Webhook URL: http://0.0.0.0:${PORT}/webhook`);
  console.log(`[Server] Health Check: http://0.0.0.0:${PORT}/health`);

  // Start monthly scheduled AI model health scanner & boot auto-fix
  modelDiscoveryService.startMonthlyAutoScanSchedule();
});

// Graceful shutdown
const shutdown = () => {
  console.log('[Server] Gracefully shutting down...');
  server.close(() => {
    console.log('[Server] Closed all connections.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
