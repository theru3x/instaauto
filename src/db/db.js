const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const config = require('../config/env');

// --- MONGOOSE SCHEMAS ---

const JobSchema = new mongoose.Schema({
  job_id: { type: String, required: true, unique: true, index: true },
  comment_id: { type: String, required: true, unique: true, index: true },
  commenter_id: { type: String, default: '' },
  comment_text: { type: String, default: '' },
  media_id: { type: String, default: '' },
  provider: { type: String, default: 'queued' },
  attempt_count: { type: Number, default: 0 },
  status: { type: String, default: 'queued', index: true },
  response_text: { type: String, default: '' },
  intent: { type: String, default: '' },
  error_code: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const RuleSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  trigger_type: { type: String, default: 'keyword' },
  trigger_value: { type: String, required: true },
  reply_template: { type: String, default: '' },
  target_url: { type: String, default: 'https://theru3x.com/links' },
  is_active: { type: Boolean, default: true },
  priority: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
});

const ConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
});

const MetricSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Number, default: 0 }
});

let JobModel;
let RuleModel;
let ConfigModel;
let MetricModel;

try {
  JobModel = mongoose.model('Job', JobSchema);
  RuleModel = mongoose.model('Rule', RuleSchema);
  ConfigModel = mongoose.model('Config', ConfigSchema);
  MetricModel = mongoose.model('Metric', MetricSchema);
} catch (_) {
  JobModel = mongoose.models.Job;
  RuleModel = mongoose.models.Rule;
  ConfigModel = mongoose.models.Config;
  MetricModel = mongoose.models.Metric;
}

class Database {
  constructor() {
    this.mongoUri = config.mongoUri || '';
    this.useMongo = Boolean(this.mongoUri && this.mongoUri.trim() !== '');
    this.isConnected = false;
    this.localDbPath = path.join(process.cwd(), 'data', 'db.json');
    this.memoryData = {
      jobs: [],
      rules: [
        {
          id: 'rule_1',
          name: 'Main Link Trigger',
          trigger_type: 'keyword',
          trigger_value: 'link',
          reply_template: 'Here is the link you requested: https://theru3x.com/links',
          target_url: 'https://theru3x.com/links',
          is_active: true,
          priority: 10,
          created_at: new Date().toISOString()
        },
        {
          id: 'rule_2',
          name: 'Greeting / Hello Trigger',
          trigger_type: 'keyword',
          trigger_value: 'hii',
          reply_template: 'Hey there! 😊 Great to connect. Check out our resources here: https://theru3x.com/links',
          target_url: 'https://theru3x.com/links',
          is_active: true,
          priority: 5,
          created_at: new Date().toISOString()
        },
        {
          id: 'rule_3',
          name: 'Pricing & Plans Trigger',
          trigger_type: 'keyword',
          trigger_value: 'price',
          reply_template: 'You can check all pricing and details here: https://theru3x.com/links',
          target_url: 'https://theru3x.com/links',
          is_active: true,
          priority: 8,
          created_at: new Date().toISOString()
        }
      ],
      config: {
        geminiModel: config.geminiModel,
        hfModel: config.hfModel,
        fallbackMessage: config.fallbackMessage,
        allowedUrl: config.allowedUrl,
        businessDescription: config.businessDescription,
        offerInfo: config.offerInfo,
        publicReply: config.publicReply
      },
      metrics: {
        ai_requests_total: 0,
        ai_success_total: 0,
        ai_429_total: 0,
        ai_5xx_total: 0,
        ai_fallback_total: 0,
        ai_latency_ms: 0,
        instagram_send_success_total: 0,
        instagram_send_failure_total: 0,
        jobs_completed_total: 0,
        jobs_failed_total: 0
      }
    };

    this.init();
  }

  async init() {
    this.loadLocalData();

    if (this.useMongo) {
      try {
        await mongoose.connect(this.mongoUri, {
          serverSelectionTimeoutMS: 4000
        });
        this.isConnected = true;
        console.log('[DB] Connected to MongoDB database successfully.');
        await this.seedInitialMongoData();
      } catch (err) {
        console.warn(`[DB] MongoDB connection failed (${err.message}). Using resilient local storage fallback.`);
        this.isConnected = false;
      }
    }
  }

  async seedInitialMongoData() {
    try {
      const count = await RuleModel.countDocuments();
      if (count === 0 && this.memoryData.rules.length > 0) {
        await RuleModel.insertMany(this.memoryData.rules);
      }
    } catch (_) {}
  }

  loadLocalData() {
    try {
      const dataDir = path.dirname(this.localDbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      if (fs.existsSync(this.localDbPath)) {
        const raw = fs.readFileSync(this.localDbPath, 'utf8');
        const parsed = JSON.parse(raw);
        this.memoryData = { ...this.memoryData, ...parsed };
      } else {
        this.saveLocalData();
      }
    } catch (e) {
      console.warn('[DB] Local database init warning:', e.message);
    }
  }

  saveLocalData() {
    try {
      const dataDir = path.dirname(this.localDbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(this.localDbPath, JSON.stringify(this.memoryData, null, 2), 'utf8');
    } catch (e) {
      console.error('[DB] Failed to persist local database:', e.message);
    }
  }

  // --- JOB OPERATIONS ---

  async getJobByCommentId(commentId) {
    if (this.isConnected) {
      try {
        const doc = await JobModel.findOne({ comment_id: commentId }).lean();
        if (doc) return doc;
      } catch (err) {
        console.error('[DB] MongoDB getJobByCommentId error:', err.message);
      }
    }
    return this.memoryData.jobs.find(j => j.comment_id === commentId) || null;
  }

  async getJobById(jobId) {
    if (this.isConnected) {
      try {
        const doc = await JobModel.findOne({ job_id: jobId }).lean();
        if (doc) return doc;
      } catch (err) {
        console.error('[DB] MongoDB getJobById error:', err.message);
      }
    }
    return this.memoryData.jobs.find(j => j.job_id === jobId) || null;
  }

  async createJob(job) {
    const jobRecord = {
      job_id: job.job_id || 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
      comment_id: job.comment_id,
      commenter_id: job.commenter_id || '',
      comment_text: job.comment_text || '',
      media_id: job.media_id || '',
      provider: job.provider || 'queued',
      attempt_count: job.attempt_count || 0,
      status: job.status || 'queued',
      response_text: job.response_text || '',
      intent: job.intent || '',
      error_code: job.error_code || null,
      created_at: job.created_at || new Date().toISOString(),
      updated_at: job.updated_at || new Date().toISOString()
    };

    if (this.isConnected) {
      try {
        const doc = await JobModel.create(jobRecord);
        return doc.toObject();
      } catch (err) {
        console.error('[DB] MongoDB createJob error:', err.message);
      }
    }

    this.memoryData.jobs.unshift(jobRecord);
    if (this.memoryData.jobs.length > 1000) {
      this.memoryData.jobs.pop();
    }
    this.saveLocalData();
    return jobRecord;
  }

  async updateJob(jobId, updates) {
    updates.updated_at = new Date().toISOString();

    if (this.isConnected && jobId) {
      try {
        const doc = await JobModel.findOneAndUpdate(
          { job_id: jobId },
          { $set: updates },
          { returnDocument: 'after' }
        ).lean();
        if (doc) return doc;
      } catch (err) {
        console.error('[DB] MongoDB updateJob error:', err.message);
      }
    }

    const idx = this.memoryData.jobs.findIndex(j => j.job_id === jobId);
    if (idx !== -1) {
      this.memoryData.jobs[idx] = { ...this.memoryData.jobs[idx], ...updates };
      this.saveLocalData();
      return this.memoryData.jobs[idx];
    }
    return null;
  }

  async listJobs(limit = 50, offset = 0) {
    if (this.isConnected) {
      try {
        const docs = await JobModel.find()
          .sort({ created_at: -1 })
          .skip(offset)
          .limit(limit)
          .lean();
        return docs;
      } catch (err) {
        console.error('[DB] MongoDB listJobs error:', err.message);
      }
    }
    return this.memoryData.jobs.slice(offset, offset + limit);
  }

  // --- RULES OPERATIONS ---

  async getRules() {
    if (this.isConnected) {
      try {
        const docs = await RuleModel.find()
          .sort({ priority: -1, created_at: 1 })
          .lean();
        return docs;
      } catch (err) {
        console.error('[DB] MongoDB getRules error:', err.message);
      }
    }
    return [...this.memoryData.rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  async createRule(rule) {
    const newRule = {
      id: rule.id || 'rule_' + Date.now(),
      name: rule.name || 'New Rule',
      trigger_type: rule.trigger_type || 'keyword',
      trigger_value: rule.trigger_value || '',
      reply_template: rule.reply_template || '',
      target_url: rule.target_url || config.allowedUrl,
      is_active: rule.is_active !== false,
      priority: parseInt(rule.priority || '0', 10),
      created_at: new Date().toISOString()
    };

    if (this.isConnected) {
      try {
        const doc = await RuleModel.create(newRule);
        return doc.toObject();
      } catch (err) {
        console.error('[DB] MongoDB createRule error:', err.message);
      }
    }

    this.memoryData.rules.push(newRule);
    this.saveLocalData();
    return newRule;
  }

  async updateRule(id, updates) {
    if (this.isConnected) {
      try {
        const doc = await RuleModel.findOneAndUpdate(
          { id },
          { $set: updates },
          { returnDocument: 'after' }
        ).lean();
        if (doc) return doc;
      } catch (err) {
        console.error('[DB] MongoDB updateRule error:', err.message);
      }
    }

    const idx = this.memoryData.rules.findIndex(r => r.id === id);
    if (idx !== -1) {
      this.memoryData.rules[idx] = { ...this.memoryData.rules[idx], ...updates };
      this.saveLocalData();
      return this.memoryData.rules[idx];
    }
    return null;
  }

  async deleteRule(id) {
    if (this.isConnected) {
      try {
        await RuleModel.deleteOne({ id });
        return true;
      } catch (err) {
        console.error('[DB] MongoDB deleteRule error:', err.message);
      }
    }
    this.memoryData.rules = this.memoryData.rules.filter(r => r.id !== id);
    this.saveLocalData();
    return true;
  }

  // --- CONFIG OPERATIONS ---

  async getConfig() {
    if (this.isConnected) {
      try {
        const doc = await ConfigModel.findOne({ key: 'app_settings' }).lean();
        if (doc && doc.value) {
          return { ...this.memoryData.config, ...doc.value };
        }
      } catch (_) {}
    }
    return { ...this.memoryData.config };
  }

  async updateConfig(newConfig) {
    this.memoryData.config = { ...this.memoryData.config, ...newConfig };
    this.saveLocalData();

    if (this.isConnected) {
      try {
        await ConfigModel.findOneAndUpdate(
          { key: 'app_settings' },
          { $set: { value: this.memoryData.config } },
          { upsert: true, returnDocument: 'after' }
        );
      } catch (err) {
        console.error('[DB] MongoDB updateConfig error:', err.message);
      }
    }

    return this.memoryData.config;
  }

  // --- METRICS OPERATIONS ---

  getMetrics() {
    return { ...this.memoryData.metrics };
  }

  incrementMetric(key, amount = 1) {
    if (this.memoryData.metrics[key] !== undefined) {
      this.memoryData.metrics[key] += amount;
    } else {
      this.memoryData.metrics[key] = amount;
    }
    this.saveLocalData();
  }

  recordLatency(ms) {
    this.memoryData.metrics.ai_latency_ms = Math.round(ms);
  }
}

const db = new Database();
module.exports = db;
