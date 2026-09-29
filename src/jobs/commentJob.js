const crypto = require('crypto');

class CommentJob {
  /**
   * @param {Object} data
   * @param {string} [data.job_id]
   * @param {string} data.comment_id - Idempotency key
   * @param {string} [data.commenter_id]
   * @param {string} [data.comment_text]
   * @param {string} [data.media_id]
   * @param {string} [data.provider]
   * @param {number} [data.attempt_count]
   * @param {string} [data.status]
   */
  constructor(data) {
    if (!data.comment_id) {
      throw new Error('comment_id is required for CommentJob');
    }

    this.job_id = data.job_id || 'job_' + crypto.randomBytes(8).toString('hex');
    this.comment_id = data.comment_id;
    this.commenter_id = data.commenter_id || '';
    this.comment_text = data.comment_text || '';
    this.media_id = data.media_id || '';
    this.provider = data.provider || 'queued';
    this.attempt_count = data.attempt_count || 0;
    this.status = data.status || 'queued';
    this.response_text = data.response_text || '';
    this.intent = data.intent || '';
    this.error_code = data.error_code || null;
    this.created_at = data.created_at || new Date().toISOString();
    this.updated_at = data.updated_at || new Date().toISOString();
  }

  toJSON() {
    return {
      job_id: this.job_id,
      comment_id: this.comment_id,
      commenter_id: this.commenter_id,
      comment_text: this.comment_text,
      media_id: this.media_id,
      provider: this.provider,
      attempt_count: this.attempt_count,
      status: this.status,
      response_text: this.response_text,
      intent: this.intent,
      error_code: this.error_code,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = CommentJob;
