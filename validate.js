/**
 * middleware/validate.js — Zod request validation.
 *
 * Usage:
 *   validate({ body: schema, query: schema, params: schema })
 *
 * On failure: 400 with a structured error body.
 */
const { z } = require('zod');

function validate(schemas = {}) {
  return (req, res, next) => {
    try {
      for (const key of ['body', 'query', 'params']) {
        const schema = schemas[key];
        if (!schema) continue;
        const parsed = schema.parse(req[key]);
        req[key] = parsed; // replace with coerced/cleaned values
      }
      next();
    } catch (err) {
      if (err && err.name === 'ZodError') {
        return res.status(400).json({
          error: 'validation_error',
          issues: err.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      return res.status(500).json({ error: 'internal_error' });
    }
  };
}

// ---------- Shared schemas ----------
const factSchema = z.object({
  text: z.string().min(8).max(600),
  category: z.string().min(2).max(40).regex(/^[a-zA-Z0-9 _-]+$/),
  source_url: z.string().url().max(2048).optional().or(z.literal('')),
  image_seed: z.string().min(1).max(80).optional(),
  verified: z.boolean().optional(),
});

const adSchema = z.object({
  sponsor: z.string().min(1).max(80),
  headline: z.string().min(3).max(120),
  body: z.string().max(400).optional().or(z.literal('')),
  cta_url: z.string().url().max(2048),
  image_seed: z.string().min(1).max(80).optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

const otpSchema = z.object({
  email: z.string().email().max(200),
});

const otpVerifySchema = z.object({
  email: z.string().email().max(200),
  code: z.string().regex(/^\d{6}$/),
});

module.exports = {
  validate,
  factSchema,
  adSchema,
  loginSchema,
  otpSchema,
  otpVerifySchema,
};
