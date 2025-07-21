// utilities.module.js
export const manifest = {
  name: "utilities",
  version: "1.0.0",
  description: "Shared utility functions for all modules, used in memory not through state calls",
  permissions: [],
  actions: [],
  state: { reads: [], writes: [] }
};

export const initialize = async () => {
  globalThis.escapeHtml = (str) => {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  };
  
  // Add other shared utilities here
  globalThis.formatCurrency = (amount) => `$${amount.toFixed(2)}`;
  globalThis.formatDate = (date) => new Date(date).toLocaleDateString();
};