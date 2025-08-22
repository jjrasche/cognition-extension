// helpers.js: One file for ALL pure utilities (math, string, async, test utilities)
// date
export const format = (date) => new Date(date).toLocaleDateString();
export const yesterday = () => new Date(Date.now() - 86400000).toISOString().split('T')[0];
export const today = () => new Date().toISOString().split('T')[0];

// async
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
export const waitFor = (condition, interval = 100, timeout = 10000) => new Promise((resolve, reject) => {
	const startTime = Date.now();
	const check = () => {
		if (condition()) resolve(true);
		else if (Date.now() - startTime > timeout) reject(new Error(`Timeout waiting for condition after ${timeout}ms`));
		else setTimeout(check, interval);
	};
	check();
});

// string
export const truncateOrNA = (value, maxLength = 50) => {
	if (value == null) return 'N/A';
	const str = JSON.stringify(value);
	return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
};
export const escapeHtml = (str) => {
	if (!str) return '';
	return str.replace(/[&<>"']/g, m => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
	}[m]));
};
export const kebabToCamel = (str) => str.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
export const formatCurrency = (amount) => `$${amount.toFixed(2)}`;
export const formatDate = (date) => new Date(date).toLocaleDateString();
export const getId = (prefix = '') => `${prefix}${Date.now()}_${Math.random().toString(36)}`;


// math
export const calculateCosineSimilarity = (vecA, vecB) => {
	const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
	const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
	const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
	return dotProduct / (magnitudeA * magnitudeB);
}

export const asserts = {
	strictEqual: (a, b) => a === b,
	looseEqual: (a, b) => a == b,
	contains: (arr, item) => arr.includes(item),
	containsAll: (arr, items) => items.every(item => arr.includes(item)),
	deepEqual: (a, b) => {
		if (a === b) return true;
		if (!a || !b || typeof a !== typeof b) return false;
		if (typeof a === 'object') {
			const keysA = Object.keys(a), keysB = Object.keys(b);
			return keysA.length === keysB.length && keysA.every(key => asserts.deepEqual(a[key], b[key]));
		}
		return false;
	},
    // Returns true if A contains all key-value pairs from B
	containsKeyValuePairs: (a, b) => {
		if (a === b) return true;
		if (!a || !b) return false;
		if (typeof a !== 'object' || typeof b !== 'object') return a === b;
		
		// Check if all keys in B exist in A with equal values
		return Object.keys(b).every(key => {
			if (!(key in a)) return false;
			if (typeof a[key] === 'object' && typeof b[key] === 'object') {
				return asserts.containsKeyValuePairs(a[key], b[key]);
			}
			return a[key] === b[key];
		});
	}
};