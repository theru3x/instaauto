const dotenv = require('dotenv');
dotenv.config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  
  // AI Keys & Models
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  
  hfToken: process.env.HF_TOKEN || '',
  hfModel: process.env.HF_MODEL || 'meta-llama/Llama-3.2-3B-Instruct',
  
  // Instagram / Meta credentials
  instagramAccessToken: process.env.INSTAGRAM_ACCESS_TOKEN || '',
  instagramAccountId: process.env.INSTAGRAM_ACCOUNT_ID || '',
  metaVerifyToken: process.env.META_VERIFY_TOKEN || 'my_secure_verify_token_123',
  metaAppId: process.env.META_APP_ID || '',
  metaAppSecret: process.env.META_APP_SECRET || '',
  
  // Automation settings
  publicReply: process.env.PUBLIC_REPLY === 'true',
  fallbackMessage: process.env.FALLBACK_MESSAGE || 'Hey 👋 Thanks for your comment! You can find the requested information here: https://theru3x.com/links',
  allowedUrl: process.env.ALLOWED_URL || 'https://theru3x.com/links',
  
  // Database (MongoDB URI)
  mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || '',
  databaseUrl: process.env.DATABASE_URL || process.env.MONGODB_URI || process.env.MONGO_URI || '',
  
  // AI Limits and Timeouts
  aiTimeoutMs: parseInt(process.env.AI_TIMEOUT_MS || '10000', 10),
  aiMaxRetries: parseInt(process.env.AI_MAX_RETRIES || '3', 10),
  aiBackoffBaseMs: parseInt(process.env.AI_BACKOFF_BASE_MS || '1000', 10),
  
  // Circuit Breaker settings
  circuitBreakerThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '3', 10),
  circuitBreakerResetTimeoutMs: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS || '60000', 10),
  
  // Admin & Security
  adminApiKey: process.env.ADMIN_API_KEY || '',
  businessDescription: process.env.BUSINESS_DESCRIPTION || 'We provide premium developer tools, AI automation solutions, and productivity resources.',
  offerInfo: process.env.OFFER_INFO || 'Official resources, portfolio, links, and contact information.',
  
  // Mask sensitive values for safe logging or admin display
  maskSecret(val) {
    if (!val || typeof val !== 'string') return '';
    if (val.length <= 8) return '********';
    return val.substring(0, 4) + '...' + val.substring(val.length - 4);
  }
};

module.exports = config;
