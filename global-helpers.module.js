export const manifest = {
  name: "global-helpers",
  version: "1.0.0",
  description: "Shared utility functions for all modules, used in memory not through state calls",
  permissions: [],
  actions: [],
  state: { reads: [], writes: [] }
};

export const initialize = async () => {
  globalThis.cognition =  {};
  globalThis.cognition.escapeHtml = (str) => {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  };

  globalThis.cognition.kebabToCamel = (str) =>  str.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
  globalThis.cognition.formatCurrency = (amount) => `$${amount.toFixed(2)}`;
  globalThis.cognition.formatDate = (date) => new Date(date).toLocaleDateString();
  globalThis.cognition.waitFor = (condition, interval = 100, timeout = 10000) => new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      if (condition()) resolve(true);
      else if (Date.now() - startTime > timeout) reject(new Error(`Timeout waiting for condition after ${timeout}ms`));
      else setTimeout(check, interval);
    };
    check();
  });
};