const GeminiProvider = require('./GeminiProvider');
const HuggingFaceProvider = require('./HuggingFaceProvider');
const FallbackProvider = require('./FallbackProvider');
const CircuitBreaker = require('./CircuitBreaker');
const Guardrail = require('./Guardrail');
const config = require('../config/env');
const db = require('../db/db');
const { errorTracker } = require('../services/errorTracker');

class ProviderManager {
  constructor(options = {}) {
    this.geminiCircuitBreaker = options.geminiCircuitBreaker || new CircuitBreaker('Gemini', {
      failureThreshold: config.circuitBreakerThreshold,
      resetTimeoutMs: config.circuitBreakerResetTimeoutMs
    });

    this.hfCircuitBreaker = options.hfCircuitBreaker || new CircuitBreaker('HuggingFace', {
      failureThreshold: config.circuitBreakerThreshold,
      resetTimeoutMs: config.circuitBreakerResetTimeoutMs
    });

    this.geminiProvider = options.geminiProvider || new GeminiProvider();
    this.hfProvider = options.hfProvider || new HuggingFaceProvider();
    this.fallbackProvider = options.fallbackProvider || new FallbackProvider();
    this.db = options.db || db;
  }

  /**
   * Evaluate if comment matches any user-defined keyword/sentence rules
   * @param {string} commentText
   * @param {Array} rules
   * @returns {Object|null}
   */
  matchCustomRule(commentText, rules = []) {
    if (!commentText || !Array.isArray(rules) || rules.length === 0) return null;

    const normalized = commentText.trim().toLowerCase();

    for (const rule of rules) {
      if (!rule.is_active) continue;
      const target = (rule.trigger_value || '').trim().toLowerCase();
      if (!target) continue;

      let matched = false;

      if (rule.trigger_type === 'exact') {
        matched = normalized === target;
      } else if (rule.trigger_type === 'sentence') {
        matched = normalized.includes(target) || target.includes(normalized);
      } else if (rule.trigger_type === 'regex') {
        try {
          const reg = new RegExp(rule.trigger_value, 'i');
          matched = reg.test(commentText);
        } catch (_) {
          matched = false;
        }
      } else {
        // default: 'keyword' (contains word or token)
        const words = normalized.split(/\s+/);
        matched = words.includes(target) || normalized.includes(target);
      }

      if (matched) {
        return rule;
      }
    }

    return null;
  }

  /**
   * Main entry point to process comment through AI / rules pipeline with fallbacks
   * @param {Object} input
   * @param {string} input.comment_id
   * @param {string} input.commenter_id
   * @param {string} input.comment_text
   * @returns {Promise<{ intent: string, reply: string, safe: boolean, provider: string, latencyMs: number, usedFallback: boolean, ruleMatched?: string }>}
   */
  async processComment(input) {
    const startTime = Date.now();
    const commentText = input.comment_text || '';
    this.db.incrementMetric('ai_requests_total', 1);

    // 1. Prompt Injection check on untrusted input
    const injectionCheck = Guardrail.detectPromptInjection(commentText);
    if (injectionCheck.isInjected) {
      console.warn(`[AI Guardrail] Prompt injection blocked for comment: "${commentText.substring(0, 50)}..."`);
      this.db.incrementMetric('ai_fallback_total', 1);
      errorTracker.logError({
        type: 'GUARDRAIL_BLOCKED',
        message: `Prompt injection pattern detected: "${commentText.substring(0, 60)}"`,
        provider: 'Guardrail',
        comment_id: input.comment_id,
        details: { pattern: injectionCheck.pattern }
      }).catch(() => {});
      const fallback = await this.fallbackProvider.generateReply(input);
      return {
        intent: 'PROMPT_INJECTION',
        reply: fallback.reply,
        safe: false,
        provider: 'GuardrailFallback',
        latencyMs: Date.now() - startTime,
        usedFallback: true,
        guardrailBlocked: true,
        reason: 'PROMPT_INJECTION'
      };
    }

    // 2. Unsafe input check
    const unsafeCheck = Guardrail.detectUnsafeInput(commentText);
    if (unsafeCheck.isUnsafe) {
      console.warn(`[AI Guardrail] Unsafe input blocked: "${commentText.substring(0, 50)}..."`);
      this.db.incrementMetric('ai_fallback_total', 1);
      errorTracker.logError({
        type: 'UNSAFE_INPUT_BLOCKED',
        message: `Unsafe input detected: "${commentText.substring(0, 60)}"`,
        provider: 'Guardrail',
        comment_id: input.comment_id,
        details: { reason: unsafeCheck.reason }
      }).catch(() => {});
      const fallback = await this.fallbackProvider.generateReply(input);
      return {
        intent: 'UNSAFE',
        reply: fallback.reply,
        safe: false,
        provider: 'GuardrailFallback',
        latencyMs: Date.now() - startTime,
        usedFallback: true,
        guardrailBlocked: true,
        reason: 'UNSAFE_INPUT'
      };
    }

    // 3. Check custom rules (e.g. "link" -> link, "hii" -> greeting, "price" -> pricing)
    let activeRules = [];
    try {
      activeRules = await this.db.getRules();
    } catch (_) {}

    const matchedRule = this.matchCustomRule(commentText, activeRules);
    if (matchedRule) {
      let replyText = matchedRule.reply_template;
      if (!replyText || replyText.trim() === '') {
        replyText = `Hey! Check out what you requested here: ${matchedRule.target_url || config.allowedUrl}`;
      }

      // Validate rule output through guardrail
      const allowedUrls = activeRules.map(r => r.target_url).filter(Boolean);
      const guardrailResult = Guardrail.validate({
        intent: 'LINK_REQUEST',
        reply: replyText,
        safe: true
      }, { allowedUrls });

      if (guardrailResult.isValid) {
        this.db.incrementMetric('ai_success_total', 1);
        return {
          intent: 'LINK_REQUEST',
          reply: guardrailResult.sanitizedResult.reply,
          safe: true,
          provider: `RuleMatcher:${matchedRule.name}`,
          latencyMs: Date.now() - startTime,
          usedFallback: false,
          ruleMatched: matchedRule.name
        };
      }
    }

    // Collect allowed URLs from config & active rules for guardrail checking
    const allowedUrls = [
      config.allowedUrl,
      'https://theru3x.com/links',
      ...activeRules.map(r => r.target_url).filter(Boolean)
    ];

    // 4. Try Primary Provider: Gemini
    if (this.geminiCircuitBreaker.canExecute()) {
      try {
        const result = await this.geminiProvider.generateReply(input);
        const guardrailResult = Guardrail.validate(result, { allowedUrls });

        if (guardrailResult.isValid) {
          this.geminiCircuitBreaker.recordSuccess();
          this.db.incrementMetric('ai_success_total', 1);
          this.db.recordLatency(result.latencyMs);

          return {
            intent: guardrailResult.sanitizedResult.intent,
            reply: guardrailResult.sanitizedResult.reply,
            safe: true,
            provider: this.geminiProvider.name,
            latencyMs: result.latencyMs,
            usedFallback: false
          };
        } else {
          console.warn(`[AI Guardrail] Gemini output rejected by guardrail: ${guardrailResult.error}`);
          errorTracker.logError({
            type: 'GUARDRAIL_REJECTED_OUTPUT',
            message: `Gemini generated output violated guardrails: ${guardrailResult.error}`,
            provider: 'Gemini',
            comment_id: input.comment_id,
            details: result
          }).catch(() => {});
        }
      } catch (err) {
        console.error(`[AI Provider] Gemini failed: ${err.message}`);
        this.geminiCircuitBreaker.recordFailure(err.isTransient);
        if (err.status === 429) {
          this.db.incrementMetric('ai_429_total', 1);
        } else if (err.status >= 500 && err.status < 600) {
          this.db.incrementMetric('ai_5xx_total', 1);
        }

        errorTracker.logError({
          type: err.status === 429 ? 'GEMINI_429_RATE_LIMIT' : (err.status === 404 ? 'GEMINI_DEPRECATED_MODEL' : 'GEMINI_ERROR'),
          message: `Gemini failure: ${err.message}`,
          provider: 'Gemini',
          statusCode: err.status,
          comment_id: input.comment_id,
          details: { isTransient: err.isTransient, model: config.geminiModel }
        }).catch(() => {});

        // If model is rate-limited (429) or deprecated (404), trigger background auto-switch to another working model
        if (err.status === 404 || err.status === 429 || /no longer available|not found|exceeded your current quota/i.test(err.message)) {
          try {
            const { modelDiscoveryService } = require('../services/modelDiscovery');
            modelDiscoveryService.autoUpdateToBestModel().catch(console.error);
          } catch (_) {}
        }
      }
    } else {
      console.warn('[AI CircuitBreaker] Gemini circuit is OPEN, skipping to Hugging Face');
      errorTracker.logError({
        type: 'CIRCUIT_BREAKER_OPEN',
        message: 'Gemini circuit breaker is OPEN due to repeated transient failures. Skipping to Hugging Face.',
        provider: 'Gemini',
        comment_id: input.comment_id
      }).catch(() => {});
    }

    // 5. Try Secondary Provider: Hugging Face
    if (this.hfCircuitBreaker.canExecute()) {
      try {
        const result = await this.hfProvider.generateReply(input);
        const guardrailResult = Guardrail.validate(result, { allowedUrls });

        if (guardrailResult.isValid) {
          this.hfCircuitBreaker.recordSuccess();
          this.db.incrementMetric('ai_success_total', 1);
          this.db.recordLatency(result.latencyMs);

          return {
            intent: guardrailResult.sanitizedResult.intent,
            reply: guardrailResult.sanitizedResult.reply,
            safe: true,
            provider: this.hfProvider.name,
            latencyMs: result.latencyMs,
            usedFallback: false
          };
        } else {
          console.warn(`[AI Guardrail] Hugging Face output rejected by guardrail: ${guardrailResult.error}`);
          errorTracker.logError({
            type: 'GUARDRAIL_REJECTED_OUTPUT',
            message: `Hugging Face output violated guardrails: ${guardrailResult.error}`,
            provider: 'HuggingFace',
            comment_id: input.comment_id
          }).catch(() => {});
        }
      } catch (err) {
        console.error(`[AI Provider] Hugging Face failed: ${err.message}`);
        this.hfCircuitBreaker.recordFailure(err.isTransient);
        if (err.status === 429) {
          this.db.incrementMetric('ai_429_total', 1);
        } else if (err.status >= 500 && err.status < 600) {
          this.db.incrementMetric('ai_5xx_total', 1);
        }

        errorTracker.logError({
          type: 'HUGGINGFACE_ERROR',
          message: `Hugging Face failure: ${err.message}`,
          provider: 'HuggingFace',
          statusCode: err.status,
          comment_id: input.comment_id,
          details: { model: config.hfModel }
        }).catch(() => {});
      }
    } else {
      console.warn('[AI CircuitBreaker] Hugging Face circuit is OPEN, skipping to Fallback');
      errorTracker.logError({
        type: 'CIRCUIT_BREAKER_OPEN',
        message: 'Hugging Face circuit breaker is OPEN. Executing deterministic fallback.',
        provider: 'HuggingFace',
        comment_id: input.comment_id
      }).catch(() => {});
    }

    // 6. Final Fallback: Static Deterministic Fallback
    console.info('[AI Provider] Executing DeterministicFallbackProvider');
    this.db.incrementMetric('ai_fallback_total', 1);
    const fallbackResult = await this.fallbackProvider.generateReply(input);

    return {
      intent: fallbackResult.intent,
      reply: fallbackResult.reply,
      safe: true,
      provider: this.fallbackProvider.name,
      latencyMs: Date.now() - startTime,
      usedFallback: true
    };
  }

  getCircuitBreakerStatus() {
    return {
      gemini: this.geminiCircuitBreaker.getState(),
      huggingFace: this.hfCircuitBreaker.getState()
    };
  }

  resetCircuitBreakers() {
    this.geminiCircuitBreaker.reset();
    this.hfCircuitBreaker.reset();
  }
}

const providerManager = new ProviderManager();
module.exports = {
  ProviderManager,
  providerManager
};
