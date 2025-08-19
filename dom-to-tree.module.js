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
	const tree = {}, usedIds = new Set(), stats = { elements: 0, depth: 0, skipped: 0 };
	[...rootElement.body.children].forEach(child => walkDOM(child, tree, usedIds, stats));
	return { tree, stats, metadata: { url: window.location.href, title: document.title, timestamp: new Date().toISOString() } };
};

const walkDOM = (element, container, usedIds, stats, depth = 0) => {
	if (shouldSkipElement(element) || !hasContent(element)) return;
	const tag = element.tagName.toLowerCase(), id = generateUniqueId(tag, ++stats.elements, usedIds);
	stats.depth = Math.max(stats.depth, depth);
	const node = createNode(element);
	container[id] = node;
	if (!LEAF_TAGS.has(tag) && element.children.length) {
		[...element.children].forEach(child => walkDOM(child, node, usedIds, stats, depth + 1));
	}
};

const createNode = (element) => {
	const tag = element.tagName.toLowerCase(), node = { tag };
	setText(element, node);
	return { ...node, ...getAttributes(element, tag) };
};

const setText = (el, node) => {
	const text = LEAF_TAGS.has(el.tagName.toLowerCase()) ? stripFormatting(el.textContent || '').trim() : getDirectTextContent(el).trim();
	if (text) node.text = text;
};

const getDirectTextContent = (el) => [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();

const getAttributes = (el, tag) => [getIdAttributes, getClassAttributes, getImgAttributes, getAnchorAttributes, getInputAttributes].reduce((attrs, fn) => fn(el, tag, attrs), {});

const getImgAttributes = (el, tag, attrs) => tag === 'img' ? (el.src && (attrs.src = el.src), el.alt && (attrs.alt = el.alt), attrs) : attrs;
const getAnchorAttributes = (el, tag, attrs) => tag === 'a' ? (el.href && (attrs.href = el.href), attrs) : attrs;
const getInputAttributes = (el, tag, attrs) => ['input', 'textarea'].includes(tag) ? (el.value && (attrs.value = el.value), el.placeholder && (attrs.placeholder = el.placeholder), attrs) : attrs;
const getIdAttributes = (el, tag, attrs) => (el.id && (attrs.id = el.id), attrs);
const getClassAttributes = (el, tag, attrs) => (el.className && (attrs.class = el.className), attrs);

const generateUniqueId = (tag, index, usedIds) => {
	let id = `${tag}-${index}`, counter = 0;
	while (usedIds.has(id)) id = `${tag}-${index}-${++counter}`;
	return (usedIds.add(id), id);
};

const shouldSkipElement = (el) => !el?.tagName || shouldSkipTag(el.tagName.toLowerCase()) || isHidden(el) || shouldSkipAds(el);
const isHidden = (el) => el.style?.display === 'none' || el.style?.visibility === 'hidden' || el.hasAttribute('hidden');
const hasContent = (el) => isSelfClosingTag(el.tagName.toLowerCase()) || hasTextContent(el) || hasValidChildren(el);
const stripFormatting = (text) => text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
const shouldSkipTag = (tag) => SKIP_TAGS.has(tag);
const shouldSkipAds = (el) => AD_PATTERNS.test((el.className || '') + ' ' + (el.id || ''));
const hasTextContent = (el) => el.textContent?.trim()?.length > 0;
const isSelfClosingTag = (tag) => ['img', 'input', 'textarea'].includes(tag);
const hasValidChildren = (el) => el.children && [...el.children].some(child => !shouldSkipElement(child));

const LEAF_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'a', 'img', 'input', 'textarea', 'code']);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'path']);
const AD_PATTERNS = /ad|ads|sponsor|promo|banner|advertisement/i;

export const test = async () => {
	const { runUnitTest, deepEqual } = runtime.testUtils;
	const createTestDoc = (html) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
	return [
		await runUnitTest("Hierarchical parent-child nesting", async () => {
			const doc = createTestDoc('<div id="parent-div" class="container">Parent text<p id="child-p">Child text</p></div>');
			const actual = createTree(doc).tree;
			const expected = {
				"div-1": {
					tag: "div",
					id: "parent-div",
					class: "container",
					text: "Parent text",
					"p-2": { tag: "p", id: "child-p", text: "Child text" }
				}
			};
			return { actual, assert: deepEqual, expected };
		}),
		await runUnitTest("Multiple children same parent", async () => {
			const doc = createTestDoc('<ul><li>First</li><li>Second</li><li>Third</li></ul>');
			const { tree } = createTree(doc);
			const actual = Object.keys(tree["ul-1"]).filter(key => key.startsWith('li-'));
			return { actual, assert: deepEqual, expected: ["li-2", "li-3", "li-4"] };
		}),
		await runUnitTest("Deep nesting structure", async () => {
			const doc = createTestDoc('<section><div><article><h2>Title</h2><p>Content</p></article></div></section>');
			const { tree } = createTree(doc);
			const hasDeepNest = tree["section-1"]?.["div-2"]?.["article-3"]?.["h2-4"]?.text === "Title";
			return { actual: hasDeepNest, assert: (a, b) => a === b, expected: true };
		}),
		await runUnitTest("Kitchen sink comprehensive HTML extraction", async () => {
			const kitchenSinkHTML = `<main><section><hgroup><h1>h1 HTML5 Kitchen Sink</h1><h2>h2 Back in my quaint <a href='#'>garden</a></h2><h3>h3 Jaunty <a href='#'>zinnias</a> vie with flaunting phlox</h3><h4>h4 Five or six big jet planes zoomed quickly by the new tower.</h4><h5>h5 Expect skilled signwriters to use many jazzy, quaint old alphabets effectively.</h5><h6>h6 Pack my box with five dozen liquor jugs.</h6></hgroup></section><hr><section><header><nav><ul><li><a href="#">Home</a></li><li><a href="#">About</a></li><li><a href="#">Contact</a></li></ul></nav></header><article><p>This paragraph is nested inside an article. It contains many different, sometimes useful, <a href="https://www.w3schools.com/tags/">HTML5 tags</a>. Of course there are classics like <em>emphasis</em>, <strong>strong</strong>, and <small>small</small> but there are many others as well.</p></article><aside>This is an aside.</aside><footer>This is footer for this section</footer></section><hr><section><table><caption>Tables can have captions now.</caption><tbody><tr><th>Person</th><th>Number</th><th>Third Column</th></tr><tr><td>Someone Lastname</td><td>900</td><td>Nullam quis risus eget urna mollis ornare vel eu leo.</td></tr></tbody></table></section><hr><section><form><p><label for="example-input-email">Email address</label><input type="email" id="example-input-email" placeholder="Enter email"></p><p><label for="example-input-password">Password</label><input type="password" id="example-input-password" placeholder="Password"></p><p><label for="example-select1">Example select</label><select id="example-select1"><option>1</option><option>2</option></select></p><fieldset><legend>I am legend</legend><label><input type="radio" name="options-radios" value="option1" checked> Option one</label><label><input type="checkbox"> Check me out</label></fieldset><button type="submit">Submit Button</button></form></section></main>`;
			const doc = new DOMParser().parseFromString(`<body>${kitchenSinkHTML}</body>`, 'text/html');
			const { tree, stats } = createTree(doc);
			const elements = Object.values(tree);
			debugger;
			const actual = {
				totalElements: 40, hasDepth: 5,
				// Semantic HTML5 elements
				hasMain: elements.some(el => el.tag === 'main'),
				hasSections: elements.some(el => el.tag === 'section'),
				hasArticle: elements.some(el => el.tag === 'article'),
				hasAside: elements.some(el => el.tag === 'aside'),
				hasHeader: elements.some(el => el.tag === 'header'),
				hasFooter: elements.some(el => el.tag === 'footer'),
				hasNav: elements.some(el => el.tag === 'nav'),
				// Headings hierarchy
				hasH1: elements.some(el => el.tag === 'h1'),
				hasH2: elements.some(el => el.tag === 'h2'),
				hasH3: elements.some(el => el.tag === 'h3'),
				hasH4: elements.some(el => el.tag === 'h4'),
				hasH5: elements.some(el => el.tag === 'h5'),
				hasH6: elements.some(el => el.tag === 'h6'),
				// Links with attributes
				hasLinks: elements.some(el => el.tag === 'a' && el.href),
				hasExternalLink: elements.some(el => el.tag === 'a' && el.href && el.href.includes('w3schools')),

				// Lists
				hasUL: elements.some(el => el.tag === 'ul'),
				hasLI: elements.some(el => el.tag === 'li'),

				// Tables
				hasTable: elements.some(el => el.tag === 'table'),
				hasCaption: elements.some(el => el.tag === 'caption'),
				hasTH: elements.some(el => el.tag === 'th'),
				hasTD: elements.some(el => el.tag === 'td'),

				// Forms
				hasForm: elements.some(el => el.tag === 'form'),
				hasInputs: elements.some(el => el.tag === 'input'),
				hasEmailInput: elements.some(el => el.tag === 'input' && el.type === 'email'),
				hasPasswordInput: elements.some(el => el.tag === 'input' && el.type === 'password'),
				hasSelect: elements.some(el => el.tag === 'select'),
				hasFieldset: elements.some(el => el.tag === 'fieldset'),
				hasLegend: elements.some(el => el.tag === 'legend'),
				hasButton: elements.some(el => el.tag === 'button'),

				// Text content preserved
				hasTextContent: elements.some(el => el.text && el.text.includes('Kitchen Sink')),
				hasPlaceholder: elements.some(el => el.placeholder === 'Enter email')
			};

			const expected = {
				totalElements: true, hasDepth: true,
				hasMain: true, hasSections: true, hasArticle: true, hasAside: true,
				hasHeader: true, hasFooter: true, hasNav: true,
				hasH1: true, hasH2: true, hasH3: true, hasH4: true, hasH5: true, hasH6: true,
				hasLinks: true, hasExternalLink: true,
				hasUL: true, hasLI: true,
				hasTable: true, hasCaption: true, hasTH: true, hasTD: true,
				hasForm: true, hasInputs: true, hasEmailInput: true, hasPasswordInput: true,
				hasSelect: true, hasFieldset: true, hasLegend: true, hasButton: true,
				hasTextContent: true, hasPlaceholder: true
			};

			return { actual, assert: deepEqual, expected };
		})
	];
};