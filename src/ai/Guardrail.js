const { validateAIOutput, VALID_INTENTS } = require('./schemas');
const config = require('../config/env');

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /show\s+(me\s+)?(your\s+)?(system\s+prompt|hidden\s+instructions|secret)/i,
  /give\s+(me\s+)?(your\s+)?(api[_\s-]?key|token|password|secret|credentials)/i,
  /tell\s+(me\s+)?(your\s+)?(hidden\s+instructions|system\s+prompt|internal\s+rules)/i,
  /change\s+(your\s+)?(rules|instructions|behavior|prompt)/i,
  /execute\s+(this\s+)?(command|code|script|sql|query|tool)/i,
  /send\s+(this\s+)?(request|data)\s+to\s+(another\s+)?url/i,
  /reveal\s+(system\s+prompt|api\s+key|access\s+token)/i,
  /disregard\s+(all\s+)?(instructions|rules)/i,
  /you\s+are\s+now\s+in\s+dan\s+mode/i,
  /pretend\s+you\s+are\s+(an\s+unrestricted|a\s+different)/i
];

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z-_]{35}/, // Google API key
  /hf_[0-9a-zA-Z]{30,}/,   // Hugging Face token
  /EAAB[0-9a-zA-Z]{10,}/,  // Meta Access token
  /sk-[a-zA-Z0-9_-]{20,}/, // Standard Secret key
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /process\.env/i,
  /META_APP_SECRET/i,
  /GEMINI_API_KEY/i,
  /HF_TOKEN/i,
  /DATABASE_URL/i
];

const SYSTEM_LEAK_PATTERNS = [
  /system\s+prompt/i,
  /hidden\s+instruction/i,
  /you\s+are\s+an\s+ai\s+assistant/i,
  /internal\s+configuration/i,
  /system\s+rules\s+are/i
];

class Guardrail {
  /**
   * Check if untrusted comment text contains prompt injection patterns
   * @param {string} commentText
   * @returns {{ isInjected: boolean, pattern?: string }}
   */
  static detectPromptInjection(commentText) {
    if (!commentText || typeof commentText !== 'string') {
      return { isInjected: false };
    }

    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(commentText)) {
        return { isInjected: true, pattern: pattern.toString() };
      }
    }

    return { isInjected: false };
  }

  /**
   * Check if comment text is unsafe or abusive
   * @param {string} commentText
   * @returns {{ isUnsafe: boolean, reason?: string }}
   */
  static detectUnsafeInput(commentText) {
    if (!commentText || typeof commentText !== 'string') {
      return { isUnsafe: false };
    }

    const unsafePatterns = [
      /\b(kill|suicide|bomb|attack|hack|exploit|malware|ransomware|ddos)\b/i,
      /<script[\s\S]*?>[\s\S]*?<\/script>/i,
      /javascript:\s*/i,
      /drop\s+table/i
    ];

    for (const pattern of unsafePatterns) {
      if (pattern.test(commentText)) {
        return { isUnsafe: true, reason: `Matched pattern: ${pattern.toString()}` };
      }
    }

    return { isUnsafe: false };
  }

  /**
   * Extract all URLs found inside a string
   * @param {string} text
   * @returns {string[]}
   */
  static extractUrls(text) {
    if (!text || typeof text !== 'string') return [];
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const matches = text.match(urlRegex) || [];
    // Clean trailing punctuation
    return matches.map(url => url.replace(/[.,;:!?)]+$/, ''));
  }

  /**
   * Validate that all URLs in text are allowed
   * @param {string} text
   * @param {string[]} [allowedUrls]
   * @returns {{ valid: boolean, unauthorizedUrl?: string }}
   */
  static validateUrlAllowlist(text, allowedUrls = []) {
    const urls = this.extractUrls(text);
    if (urls.length === 0) return { valid: true };

    const masterAllowlist = [
      config.allowedUrl,
      'https://theru3x.com/links',
      ...allowedUrls
    ].filter(Boolean).map(u => u.toLowerCase().replace(/\/+$/, ''));

    for (const url of urls) {
      const normalized = url.toLowerCase().replace(/\/+$/, '');
      const isAllowed = masterAllowlist.some(allowed => 
        normalized === allowed || normalized.startsWith(allowed)
      );

      if (!isAllowed) {
        return { valid: false, unauthorizedUrl: url };
      }
    }

    return { valid: true };
  }

  /**
   * Check if generated text leaks any system secrets or internal prompts
   * @param {string} text
   * @returns {{ hasLeak: boolean, reason?: string }}
   */
  static checkSecretLeaks(text) {
    if (!text || typeof text !== 'string') return { hasLeak: false };

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        return { hasLeak: true, reason: 'Detected secret pattern in reply' };
      }
    }

    for (const pattern of SYSTEM_LEAK_PATTERNS) {
      if (pattern.test(text)) {
        return { hasLeak: true, reason: 'Detected system prompt leakage in reply' };
      }
    }

    return { hasLeak: false };
  }

  /**
   * Full guardrail validation on parsed AI output
   * @param {object|string} output - AI output object or raw JSON string
   * @param {object} options
   * @param {string} [options.commentText] - Original comment text
   * @param {string[]} [options.allowedUrls] - Extra allowed URLs
   * @returns {{ isValid: boolean, error?: string, sanitizedResult?: object }}
   */
  static validate(output, options = {}) {
    // 1. Validate structured JSON output
    const validation = validateAIOutput(output);
    if (!validation.success) {
      return { isValid: false, error: `Schema Error: ${validation.error}` };
    }

    const { intent, reply, safe } = validation.data;

    // 2. Intent validation
    if (!VALID_INTENTS.includes(intent)) {
      return { isValid: false, error: `Invalid intent: ${intent}` };
    }

    if (intent === 'PROMPT_INJECTION') {
      return { isValid: false, error: 'AI flagged comment as PROMPT_INJECTION' };
    }

    if (intent === 'UNSAFE') {
      return { isValid: false, error: 'AI flagged comment as UNSAFE' };
    }

    // 3. Safe flag check
    if (safe !== true) {
      return { isValid: false, error: 'AI output marked safe as false' };
    }

    // 4. Length check (max 500 characters)
    if (reply.length > 500) {
      return { isValid: false, error: `Reply length ${reply.length} exceeds 500 characters limit` };
    }

    // 5. Secret leak detection
    const leakCheck = this.checkSecretLeaks(reply);
    if (leakCheck.hasLeak) {
      return { isValid: false, error: leakCheck.reason };
    }

    // 6. URL allowlist verification
    const urlCheck = this.validateUrlAllowlist(reply, options.allowedUrls || []);
    if (!urlCheck.valid) {
      return { isValid: false, error: `Unauthorized URL found in reply: ${urlCheck.unauthorizedUrl}` };
    }

    return {
      isValid: true,
      sanitizedResult: {
        intent,
        reply: reply.trim(),
        safe: true
      }
    };
  }
}

module.exports = Guardrail;
