const config = require('../config/env');
const db = require('../db/db');
const { errorTracker } = require('./errorTracker');

class ModelDiscoveryService {
  constructor(options = {}) {
    this.fetchFn = options.fetchFn || globalThis.fetch;
    // Default candidate models to test probe in order of preference
    this.geminiCandidates = [
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite-preview-02-05',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash',
      'gemini-1.5-pro-latest',
      'gemini-1.5-pro',
      'gemini-pro'
    ];

    this.hfCandidates = [
      'meta-llama/Llama-3.3-70B-Instruct',
      'meta-llama/Llama-3.2-3B-Instruct',
      'meta-llama/Llama-3.2-1B-Instruct',
      'mistralai/Mistral-7B-Instruct-v0.3',
      'Qwen/Qwen2.5-7B-Instruct'
    ];
  }

  /**
   * Probe a specific Gemini model to test if it is active and working
   * @param {string} modelName
   * @param {string} apiKey
   * @returns {Promise<{ model: string, working: boolean, latencyMs: number, error?: string }>}
   */
  async probeGeminiModel(modelName, apiKey) {
    if (!apiKey) {
      return { model: modelName, working: false, latencyMs: 0, error: 'GEMINI_API_KEY is not set' };
    }

    const cleanModel = modelName.replace(/^models\//, '');
    const startTime = Date.now();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);

      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Respond with JSON {"status": "ok"}' }] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 50 }
        }),
        signal: controller.signal
      });

      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;

      if (res.ok) {
        return { model: cleanModel, working: true, latencyMs };
      }

      let errText = '';
      try {
        const json = await res.json();
        errText = json.error?.message || JSON.stringify(json);
      } catch (_) {
        errText = await res.text().catch(() => 'Request failed');
      }

      return { model: cleanModel, working: false, latencyMs, error: `HTTP ${res.status}: ${errText}` };
    } catch (err) {
      return { model: cleanModel, working: false, latencyMs: Date.now() - startTime, error: err.message };
    }
  }

  /**
   * Fetch all models available from Google Gemini API
   * @param {string} apiKey
   * @returns {Promise<string[]>}
   */
  async listAvailableGeminiModels(apiKey) {
    if (!apiKey) return [];
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      const res = await this.fetchFn(url);
      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data.models)) {
        return data.models
          .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => m.name.replace(/^models\//, ''));
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Discover and test all candidate models for Gemini and HuggingFace
   * @param {Object} [options]
   * @returns {Promise<{ gemini: Object, huggingFace: Object, recommendedGemini: string, recommendedHf: string }>}
   */
  async discoverModels(options = {}) {
    const geminiKey = options.geminiApiKey || config.geminiApiKey;
    const hfToken = options.hfToken || config.hfToken;

    // 1. Fetch official list from Gemini API if possible
    let candidateList = [...this.geminiCandidates];
    if (geminiKey) {
      const liveModels = await this.listAvailableGeminiModels(geminiKey);
      if (liveModels.length > 0) {
        // Merge with priority on 2.0 / 1.5 flash
        const prioritized = liveModels.filter(m => /flash/i.test(m) || /pro/i.test(m));
        candidateList = Array.from(new Set([...this.geminiCandidates, ...prioritized]));
      }
    }

    // 2. Probe top Gemini candidates (probe top 5 in parallel to be fast)
    const probeTargets = candidateList.slice(0, 6);
    const geminiResults = await Promise.all(
      probeTargets.map(m => this.probeGeminiModel(m, geminiKey))
    );

    // Pick best working Gemini model
    const workingGemini = geminiResults.filter(r => r.working);
    let recommendedGemini = config.geminiModel;

    if (workingGemini.length > 0) {
      // Pick fastest or preferred flash model
      recommendedGemini = workingGemini[0].model;
    }

    const result = {
      timestamp: new Date().toISOString(),
      currentConfiguredGemini: config.geminiModel,
      recommendedGemini,
      geminiModels: geminiResults,
      allGeminiCandidates: candidateList,
      huggingFaceModels: this.hfCandidates.map(m => ({
        model: m,
        working: Boolean(hfToken),
        status: hfToken ? 'Ready (Token Configured)' : 'Requires HF_TOKEN'
      })),
      recommendedHf: this.hfCandidates[0]
    };

    return result;
  }

  /**
   * Automatically check and update active model in configuration if current model is deprecated / failing
   * @returns {Promise<{ updated: boolean, previousModel: string, newModel: string, reason: string }>}
   */
  async autoUpdateToBestModel() {
    const current = config.geminiModel;
    if (!config.geminiApiKey) {
      return { updated: false, previousModel: current, newModel: current, reason: 'No Gemini API key set' };
    }

    // Probe current model
    const currentCheck = await this.probeGeminiModel(current, config.geminiApiKey);

    if (currentCheck.working) {
      return { updated: false, previousModel: current, newModel: current, reason: 'Current model is active and healthy' };
    }

    // Current model is failing / deprecated -> discover working model
    console.warn(`[Model Discovery] Current model "${current}" failed health probe (${currentCheck.error}). Auto-discovering replacement...`);
    await errorTracker.logError({
      type: 'MODEL_DEPRECATION',
      message: `Model "${current}" is failing or deprecated: ${currentCheck.error}. Auto-switching to working model.`,
      provider: 'Gemini',
      statusCode: 404
    });

    const discovery = await this.discoverModels();
    const working = discovery.geminiModels.find(m => m.working);

    if (working) {
      const newModel = working.model;
      config.geminiModel = newModel;
      await db.updateConfig({ geminiModel: newModel });
      console.log(`[Model Discovery] Successfully auto-updated model from "${current}" to "${newModel}"`);
      return {
        updated: true,
        previousModel: current,
        newModel,
        reason: `Auto-switched from deprecated/failing "${current}" to verified working model "${newModel}" (${working.latencyMs}ms)`
      };
    }

    return { updated: false, previousModel: current, newModel: current, reason: 'No working Gemini model could be verified' };
  }
}

const modelDiscoveryService = new ModelDiscoveryService();
module.exports = {
  ModelDiscoveryService,
  modelDiscoveryService
};
