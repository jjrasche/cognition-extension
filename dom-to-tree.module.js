export const manifest = {
	name: "dom-to-tree",
	context: ["extension-page"],
	actions: ["extractPage"],
	externalDependencies: [
		{ rename: 'readability.js', destination: 'libs/', url: 'https://esm.run/@mozilla/readability', sha256: '2A1B198B27A71910CDF26AE7087A8F82D714FEF1C7D5DA335AF020D1FE3B50E4' }
	]
};

let runtime, readability;
export const initialize = async (rt) => {
	runtime = rt;
	try {
		readability = (await import(chrome.runtime.getURL('libs/readability.js'))).Readability;
		runtime.log('[DOM-to-Tree] Final Readability type:', typeof readability);
	} catch (error) {
		runtime.logError('[DOM-to-Tree] Failed to import Readability:', error);
	}
};

export const extractPage = async (url) => {
	const { html, url: actualUrl, title } = await extractRawDOM(url);
	const dom = new DOMParser().parseFromString(html, 'text/html');
	const reader = new readability(dom.cloneNode(true));
	const article = reader.parse();
	if (article) {
		return {
			title: article.title,
			title2: title,
			content: article.textContent,
			htmlContent: article.content,
			excerpt: article.excerpt,
			metadata: { url: actualUrl, timestamp: new Date().toISOString() }
		};
	}
};
const extractRawDOM = async (url) => runtime.call("tab.executeTemp", url, () => ({
	html: document.documentElement.outerHTML,
	url: window.location.href,
	title: document.title
}), []);