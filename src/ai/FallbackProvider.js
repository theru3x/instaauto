const AIProvider = require('./AIProvider');
const config = require('../config/env');

class FallbackProvider extends AIProvider {
  constructor(options = {}) {
    super('DeterministicFallbackProvider');
    this.fallbackMessage = options.fallbackMessage || config.fallbackMessage;
    this.allowedUrl = options.allowedUrl || config.allowedUrl;
  }

  async generateReply(input = {}) {
    const startTime = Date.now();
    const replyText = input.fallbackMessage || this.fallbackMessage;

    return {
      intent: 'LINK_REQUEST',
      reply: replyText,
      safe: true,
      provider: this.name,
      latencyMs: Date.now() - startTime
    };
  }
}

module.exports = FallbackProvider;
