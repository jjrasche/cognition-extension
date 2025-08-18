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

export const extractPage = async (url) => {
	const { html, url: actualUrl, title } = await extractRawDOM(url);
	const dom = new DOMParser().parseFromString(html, 'text/html');
	const result = createTree(dom);
	return { ...result, metadata: { url: actualUrl, title, timestamp: new Date().toISOString() } };
};
const extractRawDOM = async (url) => runtime.call("tab.executeInTempTab", url, () => ({ html: document.documentElement.outerHTML, url: window.location.href, title: document.title }), []);
const createTree = (rootElement) => {
	const tree = {};
	const usedIds = new Set();
	const stats = { elements: 0, depth: 0, skipped: 0 };
	[...rootElement.body.children].forEach(child => walkDOM(child, tree, usedIds, stats));
	return { tree, stats, metadata: { url: window.location.href, title: document.title, timestamp: new Date().toISOString() } };
};
const walkDOM = (element, tree, usedIds, stats, depth = 0, parentId) => {
	if (shouldSkipElement(element) || !hasContent(element)) return null;
	const tag = element.tagName.toLowerCase();
	const id = generateUniqueId(tag, ++stats.elements, usedIds);
	stats.depth = Math.max(stats.depth, depth);
	tree[id] = createNode(element, parentId);
	if (!LEAF_TAGS.has(tag) && element.children) {
		[...element.children].forEach(child => walkDOM(child, tree, usedIds, stats, depth + 1, id));
	}
};
const createNode = (element, parentId) => {
	const tag = element.tagName.toLowerCase();
	const node = { tag, ...(parentId && { parent: parentId }) };
	setText(element, node);
	return { ...node, ...getAttributes(element, tag) };
};
const setText = (el, node) => {
	const text = LEAF_TAGS.has(el.tagName.toLowerCase()) ? stripFormatting(el.textContent || '').trim() : el.textContent?.trim() || '';
	if (text) node.text = text;
};
const getAttributes = (el, tag) => [getImgAttributes, getAnchorAttributes, getInputAttributes].reduce((attrs, fn) => fn(el, tag, attrs), {});
const getImgAttributes = (el, tag, attrs) => tag === 'img' ? ((el.src && (attrs.src = el.src)), (el.alt && (attrs.alt = el.alt)), attrs) : attrs;
const getAnchorAttributes = (el, tag, attrs) => tag === 'a' ? ((el.href && (attrs.href = el.href)), attrs) : attrs;
const getInputAttributes = (el, tag, attrs) => (tag === 'input' || tag === 'textarea') ? ((el.value && (attrs.value = el.value)), (el.placeholder && (attrs.placeholder = el.placeholder)), attrs) : attrs;
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
const shouldSkipElement = (el) => {
	if (!el?.tagName) return true;
	const tag = el.tagName.toLowerCase();
	if (shouldSkipTag(tag)) return true;
	if (isHidden(el)) return true;
	if (shouldSkipAds(el)) return true;
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
			const actual = (await createTree(doc)).tree;
			const expected = { "p-1": { tag: "p", text: "Hello world" } };
			return { actual, assert: deepEqual, expected };
		}),
		await runUnitTest("Skips hidden elements", async () => {
			const doc = createTestDoc('<div style="display:none">Hidden</div><p>Visible</p>');
			const actual = Object.keys((await createTree(doc)).tree);
			return { actual, assert: deepEqual, expected: ["p-1"] };
		}),
		await runUnitTest("Filters ad elements", async () => {
			const doc = createTestDoc('<div class="advertisement">Ad</div><p>Content</p>');
			const actual = Object.keys((await createTree(doc)).tree);
			return { actual, assert: deepEqual, expected: ["p-1"] };
		}),
		await runUnitTest("Extracts link attributes", async () => {
			const doc = createTestDoc('<a href="https://example.com">Link</a>');
			const actual = (await createTree(doc)).tree["a-1"];
			return { actual, assert: deepEqual, expected: { tag: "a", text: "Link", href: "https://example.com/" } };
		}),
		await runUnitTest("Extracts image attributes", async () => {
			const doc = createTestDoc('<img src="test.jpg" alt="Test image">');
			const actual = (await createTree(doc)).tree["img-1"];
			return { actual, assert: deepEqual, expected: { tag: "img", src: "test.jpg", alt: "Test image" } };
		}),
		// Hierarchy Tests
		await runUnitTest("Maintains parent-child relationships", async () => {
			const doc = createTestDoc('<div><p>Child text</p></div>');
			const tree = (await createTree(doc)).tree;
			const actual = { hasDiv: !!tree["div-1"], hasP: !!tree["p-2"], parentRef: tree["p-2"]?.parent };
			return { actual, assert: deepEqual, expected: { hasDiv: true, hasP: true, parentRef: "div-1" } };
		}),

	];
};