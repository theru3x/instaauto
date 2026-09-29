const config = require('../config/env');
const db = require('../db/db');
const { errorTracker } = require('./errorTracker');

class ModelDiscoveryService {
  constructor(options = {}) {
    this.fetchFn = options.fetchFn || globalThis.fetch;
    // Default candidate models in order of priority
    this.geminiCandidates = [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-3.8-flash',
      'gemini-2.0-flash-exp',
      'gemini-2.0-pro-exp-02-05',
      'gemini-2.0-flash',
      'gemini-1.5-flash-8b',
      'gemini-1.5-flash',
      'gemini-1.5-pro'
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
   * @returns {Promise<{ model: string, working: boolean, latencyMs: number, error?: string, suggestedModel?: string }>}
   */
  async probeGeminiModel(modelName, apiKey) {
    if (!apiKey) {
      return { model: modelName, working: false, latencyMs: 0, error: 'GEMINI_API_KEY is not set' };
    }

    const cleanModel = modelName.replace(/^models\//, '').trim();
    const startTime = Date.now();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

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

      // Check if Google's error response suggests a specific newer model
      let suggestedModel = null;
      const suggestMatch = errText.match(/models\/([a-zA-Z0-9.\-_]+)/i);
      if (suggestMatch && suggestMatch[1] && suggestMatch[1] !== cleanModel) {
        suggestedModel = suggestMatch[1];
      }

      return {
        model: cleanModel,
        working: false,
        latencyMs,
        error: `HTTP ${res.status}: ${errText}`,
        suggestedModel
      };
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
    const endpoints = [
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
    ];

    for (const url of endpoints) {
      try {
        const res = await this.fetchFn(url);
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data.models) && data.models.length > 0) {
          const usable = data.models
            .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
            .map(m => m.name.replace(/^models\//, ''));
          if (usable.length > 0) return usable;
        }
      } catch (_) {}
    }
    return [];
  }

  /**
   * Discover and test all candidate models for Gemini and HuggingFace
   * @param {Object} [options]
   * @returns {Promise<{ gemini: Object, huggingFace: Object, recommendedGemini: string, recommendedHf: string }>}
   */
  async discoverModels(options = {}) {
    const geminiKey = options.geminiApiKey || config.geminiApiKey;
    const hfToken = options.hfToken || config.hfToken;

    // 1. Fetch live models directly from Google's Gemini API
    let candidateList = [];
    if (geminiKey) {
      const liveModels = await this.listAvailableGeminiModels(geminiKey);
      if (liveModels.length > 0) {
        // Sort live models putting flash/pro first
        const flashModels = liveModels.filter(m => /flash/i.test(m));
        const proModels = liveModels.filter(m => /pro/i.test(m) && !/flash/i.test(m));
        const otherModels = liveModels.filter(m => !/flash|pro/i.test(m));
        candidateList = [...flashModels, ...proModels, ...otherModels];
      }
    }

    // Merge default candidates
    candidateList = Array.from(new Set([...candidateList, ...this.geminiCandidates]));

    // Always include currently configured model
    if (config.geminiModel && !candidateList.includes(config.geminiModel)) {
      candidateList.unshift(config.geminiModel);
    }

    // 2. Probe top Gemini candidates (probe up to 8 in parallel)
    let probeTargets = candidateList.slice(0, 8);
    let geminiResults = await Promise.all(
      probeTargets.map(m => this.probeGeminiModel(m, geminiKey))
    );

    // If any probe suggested a newer model (e.g. from 404 message), probe it too if not tested
    for (const res of geminiResults) {
      if (res.suggestedModel && !geminiResults.some(r => r.model === res.suggestedModel)) {
        const suggestedProbe = await this.probeGeminiModel(res.suggestedModel, geminiKey);
        geminiResults.unshift(suggestedProbe);
      }
    }

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
      try {
        const { providerManager } = require('../ai/ProviderManager');
        if (providerManager && providerManager.geminiProvider) {
          providerManager.geminiProvider.model = newModel;
        }
      } catch (_) {}
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
