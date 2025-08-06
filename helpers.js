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
