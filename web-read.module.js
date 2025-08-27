export const manifest = {
	name: "web-read",
	context: ["extension-page"],
	actions: ["extractPage"],
	externalDependencies: [
		{ rename: 'readability.js', destination: 'libs/', url: 'https://esm.run/@mozilla/readability', sha256: '2A1B198B27A71910CDF26AE7087A8F82D714FEF1C7D5DA335AF020D1FE3B50E4' }
	]
};

let runtime, readability;
export const initialize = async (rt) => {
	runtime = rt;
	readability = (await import(chrome.runtime.getURL('libs/readability.js'))).Readability;
};

export const extractPage = async (url) => {
	const { html, url: actualUrl, title } = await extractRawDOM(url);
	const dom = new DOMParser().parseFromString(html, 'text/html');
	const reader = new readability(dom.cloneNode(true));
	const article = reader.parse();
	if (!article) throw new Error('Could not extract article from page');
	return {
		"article-container": {
			tag: "article", class: "readability-article",
			"back-button": { tag: "button", text: "← Back to Search", class: "cognition-button-secondary cognition-back-button", events: { click: "ui.initializeLayout" } },
			"article-title": { tag: "h1", text: article.title, class: "cognition-markdown-title" },
			"article-url": { tag: "div", text: actualUrl, class: "cognition-markdown-url" },
			"article-content": { tag: "div", innerHTML: article.content, class: "cognition-markdown-content" }
		}
	};
};
const extractRawDOM = async (url) => runtime.call("tab.executeTemp", url, () => ({
	html: document.documentElement.outerHTML,
	url: window.location.href,
	title: document.title
}), []);