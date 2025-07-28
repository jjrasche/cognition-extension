/**
 * Model Validator Module - Validates LLM model schemas
 * Extracted from inference.module.js for reusability
 */
export const manifest = {
  name: "inference-model-validation",
  version: "1.0.0",
  description: "Validates LLM model schemas for provider registration",
  permissions: [],
  actions: ["validateModels"],
};
// Valid enum values
export const VALID_CAPABILITIES = ["text", "vision", "function-calling", "code", "reasoning", "web-search", "file-upload", "streaming"];
export const VALID_INPUT_TYPES = ["text", "image", "audio", "video", "document"];
export const VALID_OUTPUT_TYPES = ["text", "image", "audio", "code"];
export const VALID_BEST_FOR = ["complex-reasoning", "code-generation", "document-analysis", "creative-writing", "conversation", "summarization", "translation", "math", "science"];
// Type validation helpers
const isString = (val) => typeof val === 'string' && val.length > 0;
const isNumber = (val) => typeof val === 'number' && val > 0;
const isArray = (val) => Array.isArray(val);
const isObject = (val) => val && typeof val === 'object' && !Array.isArray(val);
const isValidDate = (val) => isString(val) && !isNaN(Date.parse(val));
const isValidEnum = (val, validValues) => isArray(val) && val.every(v => validValues.includes(v));
// Business logic validation functions
const validateTimestamp = (timestamp) => !timestamp || isValidDate(timestamp);
const validateContextVsOutput = (contextWindow, maxOutput) => !contextWindow || !maxOutput || contextWindow > maxOutput;
const validateDailyVsMinute = (limits) => !limits.requestsPerDay || !limits.requestsPerMinute || limits.requestsPerDay >= (limits.requestsPerMinute * 10);
const validateRateLimitFields = (limits) => Object.values(limits).every(val => !val || isNumber(val));
const validateVisionConsistency = (capabilities, inputTypes) => !capabilities?.includes('vision') || inputTypes?.includes('image');
const validatePricingFields = (pricing) => (!pricing.input || isNumber(pricing.input)) && (!pricing.output || isNumber(pricing.output));
const validatePricingLogic = (pricing) => !pricing || !pricing.input || !pricing.output || pricing.output >= pricing.input;
// Field validators
export const validators = {
  id: (id) => ({ name: 'Model ID must be non-empty string', valid: isString(id) }),
  name: (name) => ({ name: 'Model name must be non-empty string', valid: isString(name) }),
  family: (family) => ({ name: 'Model family must be string or null', valid: !family || isString(family) }),
  releaseDate: (date) => ({ name: 'Release date must be valid ISO date string', valid: validateTimestamp(date) }),
  capabilities: (caps) => ({ name: `Capabilities must be array from: ${VALID_CAPABILITIES.join(', ')}`, valid: !caps || isValidEnum(caps, VALID_CAPABILITIES) }),
  inputTypes: (types) => ({ name: `Input types must be array from: ${VALID_INPUT_TYPES.join(', ')}`, valid: !types || isValidEnum(types, VALID_INPUT_TYPES) }),
  outputTypes: (types) => ({ name: `Output types must be array from: ${VALID_OUTPUT_TYPES.join(', ')}`, valid: !types || isValidEnum(types, VALID_OUTPUT_TYPES) }),
  bestFor: (bestFor) => ({ name: `Best for must be array from: ${VALID_BEST_FOR.join(', ')}`, valid: !bestFor || isValidEnum(bestFor, VALID_BEST_FOR) }),
  contextWindow: (window) => ({ name: 'Context window must be positive number', valid: !window || isNumber(window) }),
  maxOutput: (output) => ({ name: 'Max output must be positive number', valid: !output || isNumber(output) }),
  pricing: (pricing) => ({ name: 'Pricing must be object with input/output numbers', valid: !pricing || (isObject(pricing) && validatePricingFields(pricing)) }),
  rateLimits: (limits) => ({ name: 'Rate limits must be object with numeric values', valid: !limits || (isObject(limits) && validateRateLimitFields(limits)) }),
  discoveredAt: (timestamp) => ({ name: 'discoveredAt must be valid ISO date string', valid: validateTimestamp(timestamp) }),
  lastSeen: (timestamp) => ({ name: 'lastSeen must be valid ISO date string', valid: validateTimestamp(timestamp) })
};

// Cross-field validation rules
const crossFieldValidations = [
  { name: 'Context window must be larger than max output', validate: (model) => validateContextVsOutput(model.contextWindow, model.maxOutput) },
  { name: 'Output tokens typically cost more than input tokens', validate: (model) => validatePricingLogic(model.pricing), warning: true  },
  { name: 'Daily request limit seems too low compared to per-minute limit', validate: (model) => validateDailyVsMinute(model.rateLimits) },
  { name: 'Vision capability requires image input type', validate: (model) => validateVisionConsistency(model.capabilities, model.inputTypes) }
];

export const initialize = async () => {};

export const validateModels = async (params) => {
  const { models } = params;
  !isArray(models) && (() => {throw new Error(`Models must be an array not ${typeof models}`)})();
  const results = await Promise.all(models.map((model) => validateModel({ model }).then(validation => validation.result)));
  const summary = { total: models.length, valid: results.filter(r => r.valid).length, invalid: results.filter(r => !r.valid).length, warnings: results.reduce((sum, r) => sum + r.warnings.length, 0) };
  return { success: true, result: { allValid: summary.valid === models.length, summary, results } };
};

const validateModel = async (params) => {
  const { model } = params;
  !isObject(model) && (() => { throw new Error('Model must be an object'); })();
  const fv = runFieldValidations(model);
  const cfv = runCrossFieldValidations(model);
  return {
    success: true,
    result: { modelId: model.id, valid: cfv.valid && fv.valid, errors: [...fv.errors, ...cfv.errors], warnings: [...fv.warnings, ...cfv.warnings] }
  };
};

const runCrossFieldValidations = (model) => crossFieldValidations.reduce((acc, validation) => {
  if (!validation.validate(model)) {
    if (validation.warning) acc.warnings.push(validation.name);
    else (acc.valid = false, acc.errors.push(validation.name));
  }
  return acc;
}, { valid: true, errors: [''].slice(1), warnings: [''].slice(1) });

const runFieldValidations = (model) => Object.keys(validators).reduce((acc, key) => {
  const result = validators[key](model[key]);
  if (!result.valid) ( acc.valid = false, acc.errors.push(`${key}: ${result.error}`) )
  return acc;
}, { valid: true, errors: [''].slice(1), warnings: [''].slice(1) });

export const getSchema = async () => {
  return {
    success: true,
    result: {
      requiredFields: ['id', 'name'],
      optionalFields: Object.keys(validators).filter(key => !['id', 'name'].includes(key)),
      validCapabilities: VALID_CAPABILITIES,
      validInputTypes: VALID_INPUT_TYPES,
      validOutputTypes: VALID_OUTPUT_TYPES,
      validBestFor: VALID_BEST_FOR,
      crossFieldValidations: crossFieldValidations.map(v => ({ name: v.name, isWarning: !!v.warning }))
    }
  };
};
