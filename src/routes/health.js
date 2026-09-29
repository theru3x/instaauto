const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { worker } = require('../jobs/worker');
const { providerManager } = require('../ai/ProviderManager');

const startTime = Date.now();

/**
 * GET /health
 * Extremely lightweight health check endpoint for monitoring & keep-alive
 */
router.get('/', (req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const queueStatus = worker.getQueueStatus();
  const circuitBreakerStatus = providerManager.getCircuitBreakerStatus();
  const metrics = db.getMetrics();

  res.status(200).json({
    status: 'healthy',
    uptime: uptimeSeconds,
    timestamp: new Date().toISOString(),
    queue: queueStatus,
    circuitBreakers: circuitBreakerStatus,
    metricsSummary: {
      aiRequests: metrics.ai_requests_total,
      aiSuccess: metrics.ai_success_total,
      fallbacks: metrics.ai_fallback_total,
      jobsCompleted: metrics.jobs_completed_total
    }
  });
});

module.exports = router;
