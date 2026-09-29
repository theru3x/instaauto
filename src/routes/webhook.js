const express = require('express');
const router = express.Router();
const config = require('../config/env');
const { instagramService } = require('../services/instagram');
const { worker } = require('../jobs/worker');

/**
 * GET /webhook
 * Meta Webhook Verification
 */
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === config.metaVerifyToken) {
      console.info('[Webhook] Meta Webhook verified successfully');
      return res.status(200).send(challenge);
    } else {
      console.warn('[Webhook] Verification token mismatch');
      return res.sendStatus(403);
    }
  }

  return res.sendStatus(400);
});

/**
 * POST /webhook
 * Receive Instagram Comment events
 * Acknowledges Meta immediately with HTTP 200 and delegates work to the async queue
 */
router.post('/', async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const rawBody = req.rawBody || JSON.stringify(req.body);

  // 1. Signature Verification
  if (config.metaAppSecret && !instagramService.verifySignature(rawBody, signature)) {
    console.error('[Webhook] Invalid webhook signature');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const body = req.body;

  // 2. Validate object type
  if (body.object === 'instagram' || body.object === 'page') {
    if (Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        if (Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            if (change.field === 'comments') {
              const val = change.value;
              const commentId = val.id;
              const commentText = val.text || '';
              const commenterId = (val.from && (val.from.username || val.from.id)) || 'unknown';
              const mediaId = (val.media && val.media.id) || '';

              if (commentId) {
                // Enqueue job asynchronously (non-blocking)
                worker.enqueue({
                  comment_id: commentId,
                  commenter_id: commenterId,
                  comment_text: commentText,
                  media_id: mediaId
                }).catch(err => {
                  console.error('[Webhook] Failed to enqueue job:', err.message);
                });
              }
            }
          }
        }
      }
    }

    // Always immediately return HTTP 200 to Meta
    return res.status(200).send('EVENT_RECEIVED');
  }

  return res.status(200).send('IGNORED_OBJECT');
});

module.exports = router;
