export const manifest = {
	name: "dom-to-tree",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Extracts hierarchical tree structure from DOM elements",
	permissions: ["tabs", "scripting", "activeTab"],
	actions: ["extractPage"]
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const extractPage = async (url, options = {}) => {
	const domString = await extractRawDOM(url);
	const dom = new DOMParser().parseFromString(domString, 'text/html');
	createTree(dom);
};
const extractRawDOM = async (url) => runtime.call("tab.executeInTempTab", url, () => ({ html: document.documentElement.outerHTML, url: window.location.href, title: document.title }), []);
const createTree = (rootElement, options = {}) => {
	const tree = {};
	const stats = { elements: 0, depth: 0, skipped: 0 };
	[...rootElement.body.children].forEach(child => walkDOM(child, tree, stats, { skipAds: true, skipHidden: true, ...options }));
	return { tree, stats, metadata: { url: window.location.href, title: document.title, timestamp: new Date().toISOString() } };
};
const walkDOM = (element, tree, stats, options, depth = 0, parentId) => {
	const usedIds = new Set();
	if (shouldSkipElement(element, options) || !hasContent(element)) return null;
	const tag = element.tagName.toLowerCase();
	const id = generateUniqueId(tag, ++stats.elements, usedIds);
	stats.depth = Math.max(stats.depth, depth);
	tree[id] = createNode(element, parentId);
	if (!LEAF_TAGS.has(tag) && element.children) {
		[...element.children].forEach(child => walkDOM(child, tree, stats, options, depth + 1, id));
	}
};
const createNode = (element, parentId) => {
	const tag = element.tagName.toLowerCase();
	const node = { tag, ...(parentId && { parent: parentId }) };
	node.text = extractText(element) ?? node.text;
	return { ...node, ...extractAttributes(element, tag) };
};
const extractText = (el) => LEAF_TAGS.has(el.tagName.toLowerCase()) ? stripFormatting(el.textContent || '').trim() : el.textContent?.trim() || '';
const extractAttributes = (el, tag) => [setImgAttributes, setAnchorAttributes, setInputAttributes].reduce((attrs, fn) => fn(el, tag, attrs), {});
const setImgAttributes = (el, tag, attrs) => tag === 'img' ? ((el.src && (attrs.src = el.src)), (el.alt && (attrs.alt = el.alt)), attrs) : attrs;
const setAnchorAttributes = (el, tag, attrs) => tag === 'a' ? ((el.href && (attrs.href = el.href)), attrs) : attrs;
const setInputAttributes = (el, tag, attrs) => (tag === 'input' || tag === 'textarea') ? ((el.value && (attrs.value = el.value)), (el.placeholder && (attrs.placeholder = el.placeholder)), attrs) : attrs;
const generateUniqueId = (tag, index, usedIds) => {
	let id = `${tag}-${index}`, counter = 0;
	while (usedIds.has(id)) id = `${tag}-${index}-${counter++}`;
	usedIds.add(id);
	return id;
};
const isHidden = (el) => el.style?.display === 'none' || el.style?.visibility === 'hidden' || el.hasAttribute('hidden');
const hasContent = (el) => isSelfClosingTag(el.tagName.toLowerCase()) || hasTextContent(el) || hasValidChildren(el);
const stripFormatting = (text) => text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
const shouldSkipTag = (tag) => SKIP_TAGS.has(tag);
const shouldSkipAds = (el) => AD_PATTERNS.test((el.className || '') + ' ' + (el.id || ''));
const hasTextContent = (el) => el.textContent?.trim()?.length > 0;
const isSelfClosingTag = (tag) => ['img', 'input', 'textarea'].includes(tag);
const hasValidChildren = (el) => el.children && [...el.children].some(child => !shouldSkipElement(child));
const shouldSkipElement = (el, options = {}) => {
	if (!el?.tagName) return true;
	const tag = el.tagName.toLowerCase();
	if (shouldSkipTag(tag)) return true;
	if (options.skipHidden && isHidden(el)) return true;
	if (options.skipAds && shouldSkipAds(el)) return true;
	return false;
};
const LEAF_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'a', 'img', 'input', 'textarea', 'code']);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'path']);
const AD_PATTERNS = /ad|ads|sponsor|promo|banner|advertisement/i;
// testing
export const test = async () => {
	const { runUnitTest, deepEqual } = runtime.testUtils;
	const createTestDoc = (html) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
	return [
		await runUnitTest("Simple paragraph extraction", async () => {
			const doc = createTestDoc("<p>Hello world</p>");
			const actual = extract(doc, {}).tree;
			const expected = { "p-1": { tag: "p", text: "Hello world" } };
			return { actual, assert: deepEqual, expected };
		})
	];
};