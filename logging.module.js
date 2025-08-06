export const manifest = {
  name: "logging",
  context: "extension-page",
  version: "1.0.0",
  permissions: [],
  actions: ["logInfo", "logError"],
  description: "Centralized logging system for all contexts"
};

export const initialize = async () => await log({ level: 'info', message: 'Logging system started', context: 'extension-page', module: 'logging'});
const log = (params) => {
  const { level = 'log', message, module, data } = params;
  if (!message) throw new Error('Log message is required');
  (console[level] || console.log)(`[${module}] ${message}`, data);
}

// external callers
export const logInfo = (params) => chrome.runtime.sendMessage({ action: 'logging.log', params: { ...params, level: 'info' } });
export const logError = (params) => chrome.runtime.sendMessage({ action: 'logging.log', params: { ...params, level: 'error' } });