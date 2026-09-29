/**
 * Base AIProvider interface / abstract class
 */
class AIProvider {
  /**
   * @param {string} name - Name of the provider (e.g. 'GeminiProvider', 'HuggingFaceProvider')
   */
  constructor(name) {
    if (!name) throw new Error('Provider name is required');
    this.name = name;
  }

  /**
   * Generate a reply for the incoming comment
   * @param {Object} input
   * @param {string} input.comment_id - ID of the Instagram comment
   * @param {string} input.commenter_id - ID/username of the commenter
   * @param {string} input.comment_text - Raw comment text
   * @param {string} [input.businessDescription] - Business description context
   * @param {string} [input.offerInfo] - Offer information context
   * @param {string} [input.allowedUrl] - The approved business URL
   * @returns {Promise<{ intent: string, reply: string, safe: boolean, provider: string, latencyMs: number, raw?: any }>}
   */
  async generateReply(input) {
    throw new Error(`generateReply() must be implemented by ${this.name}`);
  }
}

module.exports = AIProvider;
