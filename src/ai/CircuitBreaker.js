/**
 * Circuit Breaker implementation for AI Providers
 * States: CLOSED (healthy), OPEN (tripped after threshold failures), HALF_OPEN (probing recovery)
 */
class CircuitBreaker {
  /**
   * @param {string} name - Identifier for the circuit breaker (e.g. 'Gemini', 'HuggingFace')
   * @param {Object} [options]
   * @param {number} [options.failureThreshold=3] - Number of consecutive transient failures to trip circuit
   * @param {number} [options.resetTimeoutMs=60000] - Duration in ms to stay OPEN before testing recovery
   */
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 3;
    this.resetTimeoutMs = options.resetTimeoutMs || 60000;

    this.state = 'CLOSED'; // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
    this.consecutiveFailures = 0;
    this.lastFailureTime = null;
    this.totalSuccesses = 0;
    this.totalFailures = 0;
  }

  /**
   * Check if circuit breaker allows execution
   * @returns {boolean}
   */
  canExecute() {
    const now = Date.now();
    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'OPEN') {
      // Check if timeout elapsed to attempt probe
      if (this.lastFailureTime && (now - this.lastFailureTime) >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }

    if (this.state === 'HALF_OPEN') {
      // Allow single test probe
      return true;
    }

    return false;
  }

  /**
   * Record a successful request
   */
  recordSuccess() {
    this.consecutiveFailures = 0;
    this.totalSuccesses++;
    this.state = 'CLOSED';
    this.lastFailureTime = null;
  }

  /**
   * Record a failed request
   * @param {boolean} isTransient - Whether failure was transient (429, 5xx, timeout)
   */
  recordFailure(isTransient = true) {
    this.totalFailures++;
    this.lastFailureTime = Date.now();

    if (!isTransient) {
      // Non-transient errors (e.g. 400 bad request, schema error) do not trip the circuit
      return;
    }

    if (this.state === 'HALF_OPEN') {
      // Test request failed -> re-open immediately
      this.state = 'OPEN';
      return;
    }

    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  /**
   * Reset the circuit breaker to closed
   */
  reset() {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastFailureTime = null;
  }

  /**
   * Force open for testing
   */
  trip() {
    this.state = 'OPEN';
    this.lastFailureTime = Date.now();
    this.consecutiveFailures = this.failureThreshold;
  }

  /**
   * Get current state snapshot
   */
  getState() {
    // Re-check timeout transition dynamically
    if (this.state === 'OPEN' && this.lastFailureTime && (Date.now() - this.lastFailureTime) >= this.resetTimeoutMs) {
      this.state = 'HALF_OPEN';
    }
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
      cooldownRemainingMs: this.state === 'OPEN' && this.lastFailureTime
        ? Math.max(0, this.resetTimeoutMs - (Date.now() - this.lastFailureTime))
        : 0
    };
  }
}

module.exports = CircuitBreaker;
