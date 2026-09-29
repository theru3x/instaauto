const db = require('../db/db');
const { providerManager } = require('../ai/ProviderManager');
const { instagramService } = require('../services/instagram');

class JobWorker {
  constructor(options = {}) {
    this.db = options.db || db;
    this.providerManager = options.providerManager || providerManager;
    this.instagramService = options.instagramService || instagramService;
    this.queue = [];
    this.isProcessing = false;
    this.concurrency = options.concurrency || 3;
    this.activeWorkers = 0;
  }

  /**
   * Enqueue a job to be processed by the background worker
   * @param {Object} jobData
   * @returns {Promise<{ enqueued: boolean, isDuplicate: boolean, job: Object }>}
   */
  async enqueue(jobData) {
    // 1. Idempotency Check
    const existing = await this.db.getJobByCommentId(jobData.comment_id);
    if (existing) {
      console.info(`[Worker] Idempotent hit: Comment ${jobData.comment_id} already processed or queued (status: ${existing.status}). Skipping.`);
      return { enqueued: false, isDuplicate: true, job: existing };
    }

    // 2. Persist in DB as 'queued'
    const jobRecord = await this.db.createJob({
      ...jobData,
      status: 'queued',
      attempt_count: 0
    });

    // 3. Add to in-memory processing queue
    this.queue.push(jobRecord);
    this.triggerProcessing();

    return { enqueued: true, isDuplicate: false, job: jobRecord };
  }

  triggerProcessing() {
    while (this.activeWorkers < this.concurrency && this.queue.length > 0) {
      const nextJob = this.queue.shift();
      if (nextJob) {
        this.activeWorkers++;
        this.processJob(nextJob).finally(() => {
          this.activeWorkers--;
          this.triggerProcessing();
        });
      }
    }
  }

  /**
   * Process a single comment job
   * @param {Object} job
   */
  async processJob(job) {
    const startTime = Date.now();
    console.info(`[Worker] Processing Job ${job.job_id} for comment_id: ${job.comment_id}`);

    try {
      // 1. Update status to 'processing'
      await this.db.updateJob(job.job_id, {
        status: 'processing',
        attempt_count: (job.attempt_count || 0) + 1
      });

      // 2. AI generation & guardrails via ProviderManager
      const aiResult = await this.providerManager.processComment({
        comment_id: job.comment_id,
        commenter_id: job.commenter_id,
        comment_text: job.comment_text
      });

      const replyText = aiResult.reply;
      const providerUsed = aiResult.provider;
      const intent = aiResult.intent;
      const usedFallback = Boolean(aiResult.usedFallback);

      // 3. Dispatch to Instagram API
      const sendResult = await this.instagramService.sendCommentReply(job.comment_id, replyText);

      // 4. Update final status in DB
      const finalStatus = usedFallback ? 'fallback_sent' : (sendResult.success ? 'completed' : 'failed');
      const errorCode = sendResult.success ? null : (sendResult.error || 'SEND_ERROR');

      const updatedJob = await this.db.updateJob(job.job_id, {
        status: finalStatus,
        provider: providerUsed,
        response_text: replyText,
        intent: intent,
        error_code: errorCode
      });

      if (sendResult.success) {
        this.db.incrementMetric('jobs_completed_total', 1);
        console.info(`[Worker] Job ${job.job_id} ${finalStatus} in ${Date.now() - startTime}ms (Provider: ${providerUsed})`);
      } else {
        this.db.incrementMetric('jobs_failed_total', 1);
        console.error(`[Worker] Job ${job.job_id} failed to send reply: ${errorCode}`);
      }

      return updatedJob;

    } catch (err) {
      console.error(`[Worker] Unhandled error processing Job ${job.job_id}: ${err.message}`);
      this.db.incrementMetric('jobs_failed_total', 1);

      return await this.db.updateJob(job.job_id, {
        status: 'failed',
        error_code: err.message
      });
    }
  }

  getQueueStatus() {
    return {
      pendingInQueue: this.queue.length,
      activeWorkers: this.activeWorkers,
      concurrencyLimit: this.concurrency
    };
  }
}

const worker = new JobWorker();
module.exports = {
  JobWorker,
  worker
};
