const db = require('../db/db');

class ErrorTracker {
  constructor() {
    this.memoryErrors = [];
    this.maxMemoryErrors = 200;
  }

  /**
   * Log an error event with context
   * @param {Object} errData
   * @param {string} errData.type - e.g. 'GEMINI_ERROR', 'HF_ERROR', 'INSTAGRAM_SEND_ERROR', 'GUARDRAIL_BLOCK', 'CIRCUIT_BREAKER_TRIP', 'MODEL_DEPRECATION'
   * @param {string} errData.message - Human readable error message
   * @param {string} [errData.provider] - Provider associated with error
   * @param {string} [errData.job_id] - Job ID if applicable
   * @param {string} [errData.comment_id] - Instagram comment ID if applicable
   * @param {number} [errData.statusCode] - HTTP status code
   * @param {any} [errData.details] - Detailed error object or raw response
   */
  async logError(errData) {
    const errorRecord = {
      id: 'err_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
      type: errData.type || 'SYSTEM_ERROR',
      message: errData.message || 'Unknown error',
      provider: errData.provider || 'System',
      job_id: errData.job_id || null,
      comment_id: errData.comment_id || null,
      statusCode: errData.statusCode || null,
      details: typeof errData.details === 'object' ? JSON.stringify(errData.details) : (errData.details || ''),
      timestamp: new Date().toISOString()
    };

    // Store in memory
    this.memoryErrors.unshift(errorRecord);
    if (this.memoryErrors.length > this.maxMemoryErrors) {
      this.memoryErrors.pop();
    }

    // Persist in DB
    if (db.isConnected) {
      try {
        await db.createJobError?.(errorRecord);
      } catch (_) {}
    }

    return errorRecord;
  }

  getRecentErrors(limit = 50) {
    return this.memoryErrors.slice(0, limit);
  }

  clearErrors() {
    this.memoryErrors = [];
    return true;
  }
}

const errorTracker = new ErrorTracker();
module.exports = {
  ErrorTracker,
  errorTracker
};
