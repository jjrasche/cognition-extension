export const manifest = {
  name: "web-extractor",
  context: "service-worker",
  version: "1.0.0",
  description: "Extracts hierarchical DOM structure and converts to multiple formats",
  permissions: ["tabs", "scripting", "activeTab"],
  actions: ["extractPage", "extractCurrentTab", "extractToMarkdown"],
  dependencies: []
};

let runtime;
export const initialize = async (rt) => runtime = rt;

// Extract to hierarchical structure
export const extractPage = async (params) => {
  const { url, options = { skipAds: true, skipHidden: true } } = params;
  let tabId = null;
  
  try {
    runtime.log(`[WebExtractor] Extracting: ${url}`);
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    await waitForTabComplete(tabId);
    // Wait longer for dynamic content
    await new Promise(r => setTimeout(r, 5000));
    
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractPageStructure,
      args: [options]
    });
    
    await chrome.tabs.remove(tabId);
    const extracted = result.result;
    runtime.log(`[WebExtractor] Extracted ${extracted.stats.elements} elements`);
    
    return { success: true, url, ...extracted };
  } catch (error) {
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
    runtime.logError('[WebExtractor] Failed:', error);
    return { success: false, error: error.message, url };
  }
};

// Extract current tab
export const extractCurrentTab = async (params) => {
  const { options = { skipAds: true, skipHidden: true } } = params;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab');
    
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageStructure,
      args: [options]
    });
    
    return { success: true, url: tab.url, ...result.result };
  } catch (error) {
    runtime.logError('[WebExtractor] Failed:', error);
    return { success: false, error: error.message };
  }
};

// Extract and convert to Markdown
export const extractToMarkdown = async (params) => {
  const result = await extractPage(params);
  if (!result.success) return result;
  
  const markdown = treeToMarkdown(result.body);
  return { ...result, markdown, format: 'markdown' };
};

// Tree to Markdown converter
const treeToMarkdown = (node, depth = 0) => {
  if (!node) return '';
  
  // Handle text-only nodes
  if (typeof node === 'string') return node;
  if (node.text && !node.children) {
    return formatNodeAsMarkdown(node, depth);
  }
  
  // Process node and children
  let md = formatNodeAsMarkdown(node, depth);
  
  if (node.children) {
    const childMd = Object.entries(node.children)
      .map(([_, child]) => treeToMarkdown(child, depth + 1))
      .filter(s => s)
      .join('\n');
    if (childMd) md += (md ? '\n' : '') + childMd;
  }
  
  return md;
};

// Format node based on tag
const formatNodeAsMarkdown = (node, depth) => {
  if (!node.text && !node.src && !node.href) return '';
  
  const tag = node.tag?.toLowerCase();
  const text = node.text || '';
  
  // Headings
  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag[1]);
    return '\n' + '#'.repeat(level) + ' ' + text + '\n';
  }
  
  // Paragraphs
  if (tag === 'p') return '\n' + text + '\n';
  
  // Lists
  if (tag === 'li') return '- ' + text;
  if (tag === 'dt') return '\n**' + text + '**';
  if (tag === 'dd') return ': ' + text;
  
  // Emphasis
  if (tag === 'strong' || tag === 'b') return '**' + text + '**';
  if (tag === 'em' || tag === 'i') return '*' + text + '*';
  if (tag === 'code') return '`' + text + '`';
  
  // Links
  if (tag === 'a' && node.href) return `[${text}](${node.href})`;
  
  // Images
  if (tag === 'img' && node.src) {
    const alt = node.alt || 'image';
    return `![${alt}](${node.src})`;
  }
  
  // Blockquotes
  if (tag === 'blockquote') return '> ' + text;
  
  // Pre/Code blocks
  if (tag === 'pre') return '```\n' + text + '\n```';
  
  // Tables
  if (tag === 'td' || tag === 'th') return '| ' + text + ' ';
  
  // Default
  return text;
};

// Wait for tab load
const waitForTabComplete = (tabId) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timeout')), 15000);
  const listener = (id, info) => {
    if (id === tabId && info.status === 'complete') {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
  chrome.tabs.get(tabId).then(tab => {
    if (tab.status === 'complete') {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
  });
});

// Main extraction (injected into page)
function extractPageStructure(options) {
  const { skipAds = true, skipHidden = true } = options;
  
  const LEAF_TAGS = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'li', 'td', 'th', 'dt', 'dd',
    'a', 'button', 'input', 'textarea', 'select', 'label',
    'img', 'video', 'audio', 'pre', 'code', 'blockquote',
    'figcaption', 'cite'
  ]);
  
  const INLINE_TAGS = new Set([
    'strong', 'em', 'b', 'i', 'u', 'mark', 'small', 'span'
  ]);
  
  const SKIP_TAGS = new Set([
    'script', 'style', 'noscript', 'template', 'svg', 'iframe'
  ]);
  
  const AD_PATTERNS = /ad|ads|sponsor|promo|banner|adsense|doubleclick/i;
  
  let stats = { elements: 0, depth: 0 };
  const usedIds = new Set();
  
  // Check if should skip
  const shouldSkip = (el) => {
    if (SKIP_TAGS.has(el.tagName.toLowerCase())) return true;
    if (skipHidden) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || el.hidden) return true;
    }
    if (skipAds && AD_PATTERNS.test(el.className + ' ' + el.id)) return true;
    return false;
  };
  
  // Check if has content
  const hasContent = (el) => {
    if (el.innerText?.trim()) return true;
    if (el.tagName === 'IMG' || el.tagName === 'VIDEO' || el.tagName === 'AUDIO') return true;
    return false;
  };
  
  // Get element ID
  const getId = (el, tag, index) => {
    if (el.id && !usedIds.has(el.id)) {
      usedIds.add(el.id);
      return el.id;
    }
    let id = `${tag}-${index}`;
    while (usedIds.has(id)) {
      index++;
      id = `${tag}-${index}`;
    }
    usedIds.add(id);
    return id;
  };
  
  // Extract inline formatting
  const extractInlineText = (el) => {
    const walker = document.createTreeWalker(
      el,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    let formatted = [];
    let node;
    
    while (node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text) formatted.push({ text, format: null });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        if (INLINE_TAGS.has(tag)) {
          const text = node.innerText?.trim();
          if (text) formatted.push({ text, format: tag });
          walker.nextSibling(); // Skip children
        }
      }
    }
    
    // Combine into single text with format markers
    if (formatted.length === 0) return el.innerText?.trim() || '';
    if (formatted.length === 1 && !formatted[0].format) return formatted[0].text;
    
    return formatted.map(f => {
      if (!f.format) return f.text;
      if (f.format === 'strong' || f.format === 'b') return `**${f.text}**`;
      if (f.format === 'em' || f.format === 'i') return `*${f.text}*`;
      return f.text;
    }).join(' ');
  };
  
  // Walk DOM
  const walk = (el, depth = 0, index = 0) => {
    if (shouldSkip(el)) return null;
    if (!hasContent(el)) return null;
    
    stats.elements++;
    stats.depth = Math.max(stats.depth, depth);
    
    const tag = el.tagName.toLowerCase();
    const id = getId(el, tag, index);
    
    // Build node
    const node = { tag };
    
    // Leaf elements - extract text and attributes
    if (LEAF_TAGS.has(tag)) {
      const text = extractInlineText(el);
      if (text) node.text = text;
      
      // Special attributes
      if (tag === 'a' && el.href) node.href = el.href;
      if (tag === 'img') {
        if (el.src) node.src = el.src;
        if (el.alt) node.alt = el.alt;
      }
      if ((tag === 'video' || tag === 'audio') && el.src) node.src = el.src;
      if (tag === 'input' || tag === 'textarea') {
        if (el.value) node.value = el.value;
        if (el.placeholder) node.placeholder = el.placeholder;
      }
      
      return { [id]: node };
    }
    
    // Container elements - recurse
    const children = {};
    let childIndex = 0;
    
    for (const child of el.children) {
      const result = walk(child, depth + 1, childIndex++);
      if (result) Object.assign(children, result);
    }
    
    if (Object.keys(children).length > 0) {
      node.children = children;
    } else {
      // No children, try to get text
      const text = extractInlineText(el);
      if (text) node.text = text;
      else return null; // Skip empty containers
    }
    
    return { [id]: node };
  };
  
  // Start extraction - try multiple content areas
  const title = document.title;
  
  // Try different content containers
  const contentSelectors = [
    'main',
    'article', 
    '[role="main"]',
    '#main-content',
    '.content',
    '.article-body',
    'body'
  ];
  
  let body = {};
  for (const selector of contentSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      body = walk(el, 0, 0);
      if (body && Object.keys(body).length > 0) break;
    }
  }
  
  // Debug logging
  console.log('[WebExtractor] Extracted:', {
    title,
    bodyKeys: Object.keys(body || {}),
    stats,
    hasContent: document.body.innerText?.length || 0
  });
  
  return {
    title,
    body: body || {},
    stats
  };
}