export const manifest = {
	name: "site-index",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Crawls and indexes entire websites with readability extraction",
	permissions: ["storage"],
	dependencies: ["tab", "web-read", "file"],
	actions: ["indexWebsite"],
	requiredDirectories: ["Documents/cognition/site-indexes"]
};

let runtime, log;
export const initialize = async (rt, l) => { runtime = rt; log = l; }

export const indexWebsite = async (params) => {
	const { baseUrl, maxPages = 1000 } = params;
	const domain = new URL(baseUrl).hostname;
	const existing = await loadProgress(domain);
	const state = existing ?? { siteId: domain, crawledAt: new Date().toISOString(), pages: [], queue: [baseUrl], blackListed: [], errors: [] };
	let processed = 0;

	while (state.queue.length > 0 && processed < maxPages) {
		const url = state.queue.shift();
		const alreadySearched = state.pages.some(page => page.url === url);
		const doNotSearch = state.blackListed.includes(url);
		if (alreadySearched || doNotSearch) continue;

		log.log(`[Site-Index] 📄 Processing ${url} (${processed + 1}/${maxPages}, queue: ${state.queue.length})`);

		try {
			const pageData = await runtime.call('tab.executeTemp', url, extractPageAndLinks, [domain]);

			const page = {
				url,
				title: pageData.title || 'Untitled',
				content: pageData.content || '',
				crawledAt: new Date().toISOString()
			};

			state.pages.push(page);

			// Add new links to queue
			const newLinks = pageData.links?.filter(link =>
				!state.pages.some(page => page.url === link) &&
				!state.queue.includes(link) &&
				isValidPageUrl(link)
			) || [];

			state.queue.push(...newLinks);
			processed++;

			// Save progress every 10 pages
			if (processed % 10 === 0) {
				await saveProgress(state);
				log.log(`[Site-Index] 💾 Saved progress: ${processed} pages`);
			}

			// Rate limiting - 200ms between requests
			await new Promise(resolve => setTimeout(resolve, 200));

		} catch (error) {
			log.error(`[Site-Index] ❌ Failed to process ${url}:`, error.message);
			state.errors.push({ url, error: error.message, timestamp: new Date().toISOString() });
		}
	}

	// Final save and output
	const result = {
		siteId: state.siteId,
		crawledAt: state.crawledAt,
		completedAt: new Date().toISOString(),
		pages: state.pages,
		stats: {
			total: state.pages.length,
			errors: state.errors.length,
			queuedButNotProcessed: state.queue.length
		},
		errors: state.errors
	};

	await saveProgress(result);

	log.log(`[Site-Index] ✅ Crawl complete!`);
	log.log(`[Site-Index] 📊 Stats:`, result.stats);

	return result;
};

const extractPageAndLinks = (domain) => {
	// Extract content with simple readability approach
	let title = document.title || 'Untitled';
	let content = '';

	// Find main content area
	const contentArea = document.querySelector('article') ||
		document.querySelector('main') ||
		document.querySelector('#content') ||
		document.querySelector('.content') ||
		document.body;

	if (contentArea) {
		const clone = contentArea.cloneNode(true);
		// Remove non-content elements
		clone.querySelectorAll('script, style, nav, header, footer, aside, .nav, .navigation, .menu').forEach(el => el.remove());
		content = clone.textContent.replace(/\s+/g, ' ').trim();
	}

	// Extract domain links
	const links = [];
	const anchorTags = document.querySelectorAll('a[href]');

	anchorTags.forEach(anchor => {
		try {
			const href = anchor.getAttribute('href');
			const absoluteUrl = new URL(href, window.location.href).href;
			const parsedUrl = new URL(absoluteUrl);

			// Domain restriction
			if (parsedUrl.hostname === domain || parsedUrl.hostname.endsWith(`.${domain}`)) {
				const cleanUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}`;
				if (!links.includes(cleanUrl)) {
					links.push(cleanUrl);
				}
			}
		} catch (error) {
			// Skip invalid URLs silently
		}
	});

	return { title, content, links };
};

const isValidPageUrl = (url) => {
	try {
		const path = new URL(url).pathname.toLowerCase();
		const skipExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', '.css', '.js', '.xml', '.zip', '.doc', '.docx'];
		return !skipExtensions.some(ext => path.endsWith(ext));
	} catch (error) {
		return false;
	}
};

const saveProgress = async (data) => await runtime.call('file.write', { dir: 'Documents/cognition/site-indexes', filename: `${data.siteId}.json`, data: JSON.stringify(data, null, 2) });
const loadProgress = async (siteId) => {
	const result = await runtime.call('file.read', { dir: 'Documents/cognition/site-indexes', filename: `${siteId}.json` });
	return result ? JSON.parse(result) : null;
};