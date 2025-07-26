export const manifest = {
  name: "inference",
  version: "1.0.0",
  description: "Manages LLM inference across multiple providers with streaming support",
  permissions: ["storage"],
  actions: ["prompt", "getProviders", "setProvider", "getHistory"],
  state: {
    reads: [],
    writes: [ "inference.provider", "inference.history", "inference.stream.content"]
  }
};

const providers = []; // all inference providers
export const register = (module) => {
  providers.push(module);
  module.models.forEach(validateModel);
};
export const getProviders = () => providers;
/*
let m = (await inference.getProviders())[0]
await inference.setProvider(m, m.models[2].id)
*/
export const setProvider = async (params) => {
  const { module, model } = params;
  await _state.write('inference.provider', { moduleName: module.manifest.name, model });
}
const getProvider = async () => {
  const provider = await _state.read('inference.provider');
  const providerModule = providers.find(async p => p.manifest.name === provider.moduleName);
  return { name: provider.moduleName, module: providerModule, model: provider.model ?? providerModule.manifest.defaultModel };
};

let _state;
export const initialize = (state) => _state = state;

export async function prompt(params) {
  if (!params.text) return { success: false, error: 'No prompt text provided' };
  const provider = await getProvider();
  const messages = [{ role: 'user', content: params.text }];
  try {
    let content = '';
    const processChunk = async (chunk) => await updateStreamContent((content += chunk))
    const response = await provider.module.makeRequest(messages, provider.model, processChunk);
    await addToHistory(createHistoryEntry({ provider: provider.name, messages, response }));
    return { success: true, result: response };
  } catch (error) { return { success: false, error: error.message } };
}
const updateStreamContent = async (content) => await _state.write('inference.content', content);

const createHistoryEntry = (obj) => ({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...obj });
const addToHistory = async (entry) => await _state.write('inference.history', [...(await _state.read('inference.history') || []), entry]);
const getHistoryEntries = async (count = 10) => (await _state.read('inference.history') || []).slice(-count);
export const getHistory = async (params) => ({ success: true, result: await getHistoryEntries(params?.count) });

// model validation
// Valid enum values
const VALID_CAPABILITIES = ["text", "vision", "function-calling", "code", "reasoning", "web-search", "file-upload", "streaming"];
const VALID_INPUT_TYPES = ["text", "image", "audio", "video", "document"];
const VALID_OUTPUT_TYPES = ["text", "image", "audio", "code"];
const VALID_BEST_FOR = ["complex-reasoning", "code-generation", "document-analysis", "creative-writing", "conversation", "summarization", "translation", "math", "science"];
// Type validation helpers
const isString = (val) => typeof val === 'string' && val.length > 0;
const isNumber = (val) => typeof val === 'number' && val > 0;
const isArray = (val) => Array.isArray(val);
const isObject = (val) => val && typeof val === 'object' && !Array.isArray(val);
const isValidDate = (val) => isString(val) && !isNaN(Date.parse(val));
const isValidEnum = (val, validValues) => isArray(val) && val.every(v => validValues.includes(v));
// Validation functions
const validateTimestamp = (timestamp) => !timestamp || isValidDate(timestamp) || (() => { throw new Error('Timestamp must be valid ISO date string'); })();
const validateContextVsOutput = (contextWindow, maxOutput) => !contextWindow || !maxOutput || contextWindow > maxOutput || (() => { throw new Error('Context window must be larger than max output'); })();
const validateRateLimitLogic = (limits) => !limits || validateDailyVsMinute(limits) || (() => { throw new Error('Daily limits should be higher than minute limits × 1440'); })();
const validateDailyVsMinute = (limits) => !limits.requestsPerDay || !limits.requestsPerMinute || limits.requestsPerDay >= (limits.requestsPerMinute * 10) || (() => { throw new Error('Daily request limit seems too low compared to per-minute limit'); })();
const validateRateLimitFields = (limits) => Object.values(limits).every(val => !val || isNumber(val));
const validateCapabilityConsistency = (capabilities, inputTypes) => !capabilities || !inputTypes || validateVisionConsistency(capabilities, inputTypes) || (() => { throw new Error('Vision capability requires image input type'); })();
const validateVisionConsistency = (capabilities, inputTypes) => !capabilities.includes('vision') || inputTypes.includes('image');
const validatePricingLogic = (pricing) => !pricing || !pricing.input || !pricing.output || pricing.output >= pricing.input || (() => { throw new Error('Output tokens typically cost more than input tokens'); })();
const validatePricingFields = (pricing) => (!pricing.input || isNumber(pricing.input)) && (!pricing.output || isNumber(pricing.output));
export const validators = {
  id: (id) => isString(id) || (() => { throw new Error('Model ID must be non-empty string'); })(),
  name: (name) => isString(name) || (() => { throw new Error('Model name must be non-empty string'); })(),
  family: (family) => !family || isString(family) || (() => { throw new Error('Model family must be string or null'); })(),
  releaseDate: (date) => !date || isValidDate(date) || (() => { throw new Error('Release date must be valid ISO date string'); })(),
  capabilities: (caps) => !caps || isValidEnum(caps, VALID_CAPABILITIES) || (() => { throw new Error(`Capabilities must be array from: ${VALID_CAPABILITIES.join(', ')}`); })(),
  inputTypes: (types) => !types || isValidEnum(types, VALID_INPUT_TYPES) || (() => { throw new Error(`Input types must be array from: ${VALID_INPUT_TYPES.join(', ')}`); })(),
  outputTypes: (types) => !types || isValidEnum(types, VALID_OUTPUT_TYPES) || (() => { throw new Error(`Output types must be array from: ${VALID_OUTPUT_TYPES.join(', ')}`); })(),
  bestFor: (bestFor) => !bestFor || isValidEnum(bestFor, VALID_BEST_FOR) || (() => { throw new Error(`Best for must be array from: ${VALID_BEST_FOR.join(', ')}`); })(),
  contextWindow: (window) => !window || isNumber(window) || (() => { throw new Error('Context window must be positive number'); })(),
  maxOutput: (output) => !output || isNumber(output) || (() => { throw new Error('Max output must be positive number'); })(),
  pricing: (pricing) => !pricing || (isObject(pricing) && validatePricingFields(pricing)) || (() => { throw new Error('Pricing must be object with input/output numbers'); })(),
  rateLimits: (limits) => !limits || (isObject(limits) && validateRateLimitFields(limits)) || (() => { throw new Error('Rate limits must be object with numeric values'); })(),
  discoveredAt: validateTimestamp,
  lastSeen: validateTimestamp
};
export const validateModel = (model) => {
  if (!isObject(model)) throw new Error('Model must be an object');
  Object.keys(model).forEach(key => {
    const validator = validators[key];
    if (validator) validator(model[key]);
  });
  validateContextVsOutput(model.contextWindow, model.maxOutput);
  validatePricingLogic(model.pricing);
  validateRateLimitLogic(model.rateLimits);
  validateCapabilityConsistency(model.capabilities, model.inputTypes);
  return true;
};