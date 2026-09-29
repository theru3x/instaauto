const { z } = require('zod');

const VALID_INTENTS = [
  'LINK_REQUEST',
  'GENERAL_QUESTION',
  'PRICE_QUESTION',
  'SERVICE_QUESTION',
  'OTHER',
  'PROMPT_INJECTION',
  'UNSAFE'
];

const AIOutputSchema = z.object({
  intent: z.enum(VALID_INTENTS, {
    errorMap: () => ({ message: `intent must be one of: ${VALID_INTENTS.join(', ')}` })
  }),
  reply: z.string().min(1).max(500, 'Reply exceeds 500 characters limit'),
  safe: z.boolean()
});

/**
 * Validate and parse AI raw output string or object
 * @param {string|object} rawOutput
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
function validateAIOutput(rawOutput) {
  try {
    let parsed;
    if (typeof rawOutput === 'string') {
      // Strip markdown code fences if model wrapped response in ```json ... ```
      let cleaned = rawOutput.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      parsed = JSON.parse(cleaned);
    } else if (typeof rawOutput === 'object' && rawOutput !== null) {
      parsed = rawOutput;
    } else {
      return { success: false, error: 'Output is neither a valid string nor object' };
    }

    const result = AIOutputSchema.safeParse(parsed);
    if (!result.success) {
      const errorMsg = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return { success: false, error: errorMsg };
    }

    return { success: true, data: result.data };
  } catch (err) {
    return { success: false, error: `Invalid JSON format: ${err.message}` };
  }
}

module.exports = {
  VALID_INTENTS,
  AIOutputSchema,
  validateAIOutput
};
