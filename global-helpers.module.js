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
};