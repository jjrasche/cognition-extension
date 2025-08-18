export const manifest = {
  name: "dom-to-tree",
  context: ["extension-page"],
  version: "1.0.0",
  description: "Extracts hierarchical tree structure from DOM elements",
  permissions: ["tabs", "scripting", "activeTab"],
  actions: ["extractPage", "extractCurrentTab"]
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const extractPage = async (url, options = {}) => {
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab || !tab.id) throw new Error('Failed to create tab');
  try {
    await waitForTabComplete(tab.id);
    await new Promise(r => setTimeout(r, 3000));
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageInTab, args: [options] });
    await chrome.tabs.remove(tab.id);
    return { success: true, url, ...result.result };
  } catch (error) { chrome.tabs.remove(tab.id).catch(() => {}); }
};

export const extractCurrentTab = async (options = {}) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('No active tab');
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageInTab, args: [options] });
    return { success: true, url: tab.url, ...result.result };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

const LEAF_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'a', 'img', 'input', 'textarea', 'code']);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'path']);
const AD_PATTERNS = /ad|ads|sponsor|promo|banner|advertisement/i;

const isHidden = (el, windowObj) => { try { const style = windowObj?.getComputedStyle?.(el); return style?.display === 'none' || style?.visibility === 'hidden'; } catch { return false; }};
const hasContent = (el) => isSelfClosingTag(el.tagName.toLowerCase()) || hasTextContent(el) || hasValidChildren(el);
const stripFormatting = (text) => text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
const shouldSkipTag = (tag) => SKIP_TAGS.has(tag);
const shouldSkipAds = (el) => AD_PATTERNS.test((el.className || '') + ' ' + (el.id || ''));
const hasTextContent = (el) => el.textContent?.trim()?.length > 0;
const isSelfClosingTag = (tag) => ['img', 'input', 'textarea'].includes(tag);
const hasValidChildren = (el) => el.children && [...el.children].some(child => !shouldSkipElement(child));
const shouldSkipElement = (el, options = {}, windowObj) => {
  if (!el?.tagName) return true;
  const tag = el.tagName.toLowerCase();
  if (shouldSkipTag(tag)) return true;
  if (options.skipHidden && isHidden(el, windowObj)) return true;
  if (options.skipAds && shouldSkipAds(el)) return true;
  return false;
};
const generateUniqueId = (tag, index, usedIds) => {
  let id = `${tag}-${index}`, counter = 0;
  while (usedIds.has(id)) id = `${tag}-${index}-${counter++}`;
  usedIds.add(id);
  return id;
};

const extractText = (el) => LEAF_TAGS.has(el.tagName.toLowerCase()) ? stripFormatting(el.textContent || '').trim() : el.textContent?.trim() || '';
const extractAttributes = (el, tag) => [setImgAttributes, setAnchorAttributes, setInputAttributes].reduce((attrs, fn) => fn(el, tag, attrs), {});
const setImgAttributes    = (el, tag, attrs) => tag === 'img' ? ((el.src && (attrs.src = el.src)), (el.alt && (attrs.alt = el.alt)), attrs) : attrs;
const setAnchorAttributes = (el, tag, attrs) => tag === 'a' ? ((el.href && (attrs.href = el.href)), attrs) : attrs;
const setInputAttributes  = (el, tag, attrs) => (tag === 'input' || tag === 'textarea') ? ((el.value && (attrs.value = el.value)), (el.placeholder && (attrs.placeholder = el.placeholder)), attrs) : attrs;
const createNode = (element, parentId) => {
  const tag = element.tagName.toLowerCase();
  const node = { tag, ...(parentId && { parent: parentId }) };
  node.text = extractText(element) ?? node.text;
  return { ...node, ...extractAttributes(element, tag) };
};


const walkDOM = (element, tree, usedIds, stats, options, windowObj, depth = 0, parentId = null) => {
  if (shouldSkipElement(element, options, windowObj) || !hasContent(element)) return null;
  const tag = element.tagName.toLowerCase();
  const id = generateUniqueId(tag, ++stats.elements, usedIds);
  stats.depth = Math.max(stats.depth, depth);
  tree[id] = createNode(element, parentId);
  if (!LEAF_TAGS.has(tag) && element.children) {
    [...element.children].forEach(child => walkDOM(child, tree, usedIds, stats, options, windowObj, depth + 1, id));
  }
  return id;
};

const extract = (rootElement, options = {}, windowObj = null) => {
  const tree = {};
  const usedIds = new Set();
  const stats = { elements: 0, depth: 0, skipped: 0 };
  const startElement = rootElement.body || rootElement;
      walkDOM(startElement, tree, usedIds, stats, { skipAds: true, skipHidden: true, ...options }, windowObj || window);
  return {
    tree, stats,
    metadata: { url: windowObj?.['location']?.['href'] || 'test', title: windowObj?.['document']?.['title'] || 'Test', timestamp: new Date().toISOString() }
  };
};

const waitForTabComplete = (tabId) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timeout')), 15000);
  const complete = () => (clearTimeout(timeout), chrome.tabs.onUpdated.removeListener(listener), resolve(true));
  const listener = (id, info) => id === tabId && info.status === 'complete' && complete();
  chrome.tabs.onUpdated.addListener(listener);
  chrome.tabs.get(tabId).then(tab => tab.status === 'complete' && complete());
});

const extractPageInTab = (options) => ({ tree: {}, stats: { elements: 0, depth: 0, skipped: 0 }, metadata: { url: window.location.href, title: document.title, timestamp: new Date().toISOString() } });

// testing
export const test = async () => {
  const { runUnitTest, deepEqual } = runtime.testUtils;
  const createTestDoc = (html) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const mockWindow = { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }), location: { href: 'test' }, document: { title: 'Test' } };
  return [
    await runUnitTest("Simple paragraph extraction", async () => {
      const doc = createTestDoc("<p>Hello world</p>");
      const actual = extract(doc.body, {}, mockWindow).tree;
      const expected = { "p-1": { tag: "p", text: "Hello world" } };
      return { actual, assert: deepEqual, expected };
    })
  ];
};