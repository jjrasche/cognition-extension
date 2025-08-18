export const escapeHtml = (str) => {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
};
export const kebabToCamel = (str) =>  str.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
export const formatCurrency = (amount) => `$${amount.toFixed(2)}`;
export const formatDate = (date) => new Date(date).toLocaleDateString();
export const waitFor = (condition, interval = 100, timeout = 10000) => new Promise((resolve, reject) => {
  const startTime = Date.now();
  const check = () => {
    if (condition()) resolve(true);
    else if (Date.now() - startTime > timeout) reject(new Error(`Timeout waiting for condition after ${timeout}ms`));
    else setTimeout(check, interval);
  };
  check();
});
export const getId = (prefix = '') => `${prefix}${Date.now()}_${Math.random().toString(36)}`;

export const yesterday = () => new Date(Date.now() - 86400000).toISOString().split('T')[0];
export const today = () => new Date().toISOString().split('T')[0];

// helpers.js
export const retryAsync = async (asyncFn, options = {}) => {
  const { maxAttempts = 10, delay = 1000, backoff = false, onRetry = null, shouldRetry = (error) => true } = options;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await asyncFn(attempt); } 
    catch (error) {
      if (attempt === maxAttempts || !shouldRetry(error)) throw error;
      if (onRetry) onRetry(error, attempt, maxAttempts);
      const currentDelay = backoff ? delay * Math.pow(2, attempt - 1) : delay;
      await new Promise(resolve => setTimeout(resolve, currentDelay));
    }
  }
};

export const wait = async (ms = 100) => await new Promise(resolve => setTimeout(resolve, ms));