const express = require('express');
const router = express.Router();
const db = require('../db/db');
const config = require('../config/env');
const { providerManager } = require('../ai/ProviderManager');
const { errorTracker } = require('../services/errorTracker');
const { modelDiscoveryService } = require('../services/modelDiscovery');

// Optional Admin API Key protection middleware
const authMiddleware = (req, res, next) => {
  if (config.adminApiKey) {
    const authHeader = req.headers['authorization'] || req.headers['x-api-key'];
    if (authHeader !== config.adminApiKey && authHeader !== `Bearer ${config.adminApiKey}`) {
      return res.status(401).json({ error: 'Unauthorized: Invalid Admin API Key' });
    }
  }
  next();
};

router.use(authMiddleware);

// --- JOBS & LOGS ---

// GET /api/jobs - List processed jobs
router.get('/jobs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const jobs = await db.listJobs(limit, offset);
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/metrics - Metrics summary
router.get('/metrics', (req, res) => {
  try {
    const metrics = db.getMetrics();
    const circuitBreakers = providerManager.getCircuitBreakerStatus();
    res.json({
      success: true,
      metrics,
      circuitBreakers
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- KEYWORD & SENTENCE RULES ---

// GET /api/rules - List all keyword/sentence rules
router.get('/rules', async (req, res) => {
  try {
    const rules = await db.getRules();
    res.json({ success: true, rules });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/rules - Add new rule
router.post('/rules', async (req, res) => {
  try {
    const { name, trigger_type, trigger_value, reply_template, target_url, is_active, priority } = req.body;
    if (!trigger_value) {
      return res.status(400).json({ success: false, error: 'trigger_value is required' });
    }

    const created = await db.createRule({
      name: name || `Rule for "${trigger_value}"`,
      trigger_type: trigger_type || 'keyword',
      trigger_value: trigger_value.trim(),
      reply_template: reply_template || '',
      target_url: target_url || config.allowedUrl,
      is_active: is_active !== false,
      priority: priority ? parseInt(priority, 10) : 0
    });

    res.status(201).json({ success: true, rule: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/rules/:id - Update rule
router.put('/rules/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const updates = req.body;
    const updated = await db.updateRule(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Rule not found' });
    }
    res.json({ success: true, rule: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/rules/:id - Delete rule
router.delete('/rules/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await db.deleteRule(id);
    res.json({ success: true, message: 'Rule deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- CONFIGURATION & KEYS ---

// GET /api/config - Get current configuration (masked)
router.get('/config', async (req, res) => {
  try {
    const appCfg = await db.getConfig();
    res.json({
      success: true,
      config: {
        ...appCfg,
        hasGeminiKey: Boolean(config.geminiApiKey),
        geminiApiKeyMasked: config.maskSecret(config.geminiApiKey),
        hasHfToken: Boolean(config.hfToken),
        hfTokenMasked: config.maskSecret(config.hfToken),
        hasInstagramToken: Boolean(config.instagramAccessToken),
        instagramTokenMasked: config.maskSecret(config.instagramAccessToken),
        hasMetaAppSecret: Boolean(config.metaAppSecret),
        metaAppSecretMasked: config.maskSecret(config.metaAppSecret),
        metaVerifyToken: config.metaVerifyToken,
        hasMongoUri: Boolean(config.mongoUri),
        mongoUriMasked: config.maskSecret(config.mongoUri),
        allowedUrl: appCfg.allowedUrl || config.allowedUrl,
        fallbackMessage: appCfg.fallbackMessage || config.fallbackMessage,
        geminiModel: appCfg.geminiModel || config.geminiModel,
        hfModel: appCfg.hfModel || config.hfModel,
        businessDescription: appCfg.businessDescription || config.businessDescription,
        offerInfo: appCfg.offerInfo || config.offerInfo,
        publicReply: appCfg.publicReply !== undefined ? appCfg.publicReply : config.publicReply
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/config - Save configuration & keys
router.post('/config', async (req, res) => {
  try {
    const {
      geminiApiKey,
      geminiModel,
      hfToken,
      hfModel,
      instagramAccessToken,
      metaAppSecret,
      metaVerifyToken,
      mongoUri,
      fallbackMessage,
      allowedUrl,
      businessDescription,
      offerInfo,
      publicReply
    } = req.body;

    // Update memory/process environment safely if provided
    if (geminiApiKey && geminiApiKey.trim() !== '') config.geminiApiKey = geminiApiKey.trim();
    if (geminiModel) config.geminiModel = geminiModel;
    if (hfToken && hfToken.trim() !== '') config.hfToken = hfToken.trim();
    if (hfModel) config.hfModel = hfModel;
    if (instagramAccessToken && instagramAccessToken.trim() !== '') config.instagramAccessToken = instagramAccessToken.trim();
    if (metaAppSecret && metaAppSecret.trim() !== '') config.metaAppSecret = metaAppSecret.trim();
    if (metaVerifyToken && metaVerifyToken.trim() !== '') config.metaVerifyToken = metaVerifyToken.trim();
    if (mongoUri && mongoUri.trim() !== '') {
      config.mongoUri = mongoUri.trim();
      config.databaseUrl = mongoUri.trim();
      db.mongoUri = mongoUri.trim();
      db.useMongo = true;
      db.init().catch(console.error);
    }
    if (fallbackMessage) config.fallbackMessage = fallbackMessage;
    if (allowedUrl) config.allowedUrl = allowedUrl;
    if (businessDescription) config.businessDescription = businessDescription;
    if (offerInfo) config.offerInfo = offerInfo;
    if (publicReply !== undefined) config.publicReply = Boolean(publicReply);

    const updated = await db.updateConfig({
      geminiModel: config.geminiModel,
      hfModel: config.hfModel,
      fallbackMessage: config.fallbackMessage,
      allowedUrl: config.allowedUrl,
      businessDescription: config.businessDescription,
      offerInfo: config.offerInfo,
      publicReply: config.publicReply
    });

    res.json({ success: true, message: 'Settings saved successfully', config: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- SIMULATION / PLAYGROUND ---

// POST /api/test-simulate - Test comment against AI pipeline
router.post('/test-simulate', async (req, res) => {
  try {
    const { comment_text, commenter_id } = req.body;
    if (!comment_text) {
      return res.status(400).json({ success: false, error: 'comment_text is required' });
    }

    const result = await providerManager.processComment({
      comment_id: 'test_' + Date.now(),
      commenter_id: commenter_id || 'test_user',
      comment_text
    });

    res.json({
      success: true,
      simulation: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- ERROR MONITORING & LOGS ---

// GET /api/errors - List recent system & provider errors
router.get('/errors', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const errors = errorTracker.getRecentErrors(limit);
    res.json({
      success: true,
      count: errors.length,
      errors
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/errors - Clear error logs
router.delete('/errors', (req, res) => {
  try {
    errorTracker.clearErrors();
    res.json({ success: true, message: 'Error logs cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- MODEL DISCOVERY & AUTO-UPDATE ---

// GET /api/models/discover - Probe and discover active models
router.get('/models/discover', async (req, res) => {
  try {
    const result = await modelDiscoveryService.discoverModels();
    res.json({
      success: true,
      discovery: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/models/auto-update - Auto-check and switch to verified working model
router.post('/models/auto-update', async (req, res) => {
  try {
    const result = await modelDiscoveryService.autoUpdateToBestModel();
    res.json({
      success: true,
      result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/models/select - Manually select active model
router.post('/models/select', async (req, res) => {
  try {
    const { geminiModel, hfModel } = req.body;
    if (geminiModel) {
      config.geminiModel = geminiModel;
      await db.updateConfig({ geminiModel });
    }
    if (hfModel) {
      config.hfModel = hfModel;
      await db.updateConfig({ hfModel });
    }
    res.json({
      success: true,
      message: 'Active model updated',
      activeGeminiModel: config.geminiModel,
      activeHfModel: config.hfModel
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/circuit-breaker/reset - Reset circuit breakers
router.post('/circuit-breaker/reset', (req, res) => {
  try {
    providerManager.resetCircuitBreakers();
    res.json({ success: true, message: 'Circuit breakers reset to CLOSED' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
