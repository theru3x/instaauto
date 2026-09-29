const crypto = require('crypto');
const config = require('../config/env');
const db = require('../db/db');

class InstagramService {
  constructor(options = {}) {
    this.accessToken = options.accessToken || config.instagramAccessToken;
    this.appSecret = options.appSecret || config.metaAppSecret;
    this.verifyToken = options.verifyToken || config.metaVerifyToken;
    this.publicReply = options.publicReply !== undefined ? options.publicReply : config.publicReply;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.graphApiVersion = 'v21.0';
  }

  /**
   * Verify HMAC SHA256 signature from Meta webhook
   * @param {string|Buffer} rawBody - Raw unparsed request body
   * @param {string} signatureHeader - Value of x-hub-signature-256 header (e.g. 'sha256=abcdef...')
   * @returns {boolean}
   */
  verifySignature(rawBody, signatureHeader) {
    if (!this.appSecret) {
      // In dev mode without secret, allow if not configured
      return true;
    }

    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      return false;
    }

    const signature = signatureHeader.substring(7); // strip 'sha256='
    const expectedSignature = crypto
      .createHmac('sha256', this.appSecret)
      .update(rawBody)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch (_) {
      return false;
    }
  }

  /**
   * Send a direct message or reply to an Instagram comment
   * @param {string} commentId - The ID of the Instagram comment
   * @param {string} messageText - Approved reply text
   * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
   */
  async sendCommentReply(commentId, messageText) {
    if (!commentId || !messageText) {
      throw new Error('commentId and messageText are required');
    }

    if (!this.accessToken) {
      console.warn('[Instagram Service] INSTAGRAM_ACCESS_TOKEN is not configured. Simulating response send.');
      db.incrementMetric('instagram_send_success_total', 1);
      return { success: true, simulated: true, commentId };
    }

    const isIgToken = (this.accessToken || '').startsWith('IGA');
    const apiHost = isIgToken ? 'https://graph.instagram.com' : 'https://graph.facebook.com';

    let url;
    let payload;

    if (this.publicReply) {
      // Public reply to the comment: POST /{comment-id}/replies
      url = `${apiHost}/${this.graphApiVersion}/${encodeURIComponent(commentId)}/replies`;
      payload = {
        message: messageText
      };
    } else {
      // Private reply via Direct Message: POST /me/messages with recipient { comment_id }
      url = `${apiHost}/${this.graphApiVersion}/me/messages`;
      payload = {
        recipient: {
          comment_id: commentId
        },
        message: {
          text: messageText
        }
      };
    }

    let maxRetries = 2;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const response = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.accessToken}`
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const status = response.status;
          let errText = '';
          try {
            errText = await response.text();
          } catch (_) {}

          // Check if transient (429 or 5xx)
          if ([429, 500, 502, 503, 504].includes(status) && attempt < maxRetries) {
            attempt++;
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
            continue;
          }

          db.incrementMetric('instagram_send_failure_total', 1);
          console.error(`[Instagram Service] Failed to send message (HTTP ${status}): ${errText}`);
          return {
            success: false,
            error: `HTTP ${status}: ${errText}`
          };
        }

        const data = await response.json();
        db.incrementMetric('instagram_send_success_total', 1);
        return {
          success: true,
          messageId: data.message_id || data.id || 'sent',
          raw: data
        };
      } catch (err) {
        if (attempt < maxRetries) {
          attempt++;
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
          continue;
        }

        db.incrementMetric('instagram_send_failure_total', 1);
        console.error(`[Instagram Service] Network error sending reply: ${err.message}`);
        return { success: false, error: err.message };
      }
    }

    return { success: false, error: 'Max retries exceeded' };
  }
}

const instagramService = new InstagramService();
module.exports = {
  InstagramService,
  instagramService
};
