export const manifest = {
  name: "web-extractor",
  context: "extension-page",
  version: "1.0.0",
  description: "Extracts hierarchical DOM structure and converts to multiple formats",
  permissions: ["tabs", "scripting", "activeTab"],
  actions: ["extractPage", "extractCurrentTab", "extractToMarkdown", "runTests"],
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

// Tree to Markdown converter - updated for flattened structure
const treeToMarkdown = (tree) => {
  if (!tree || typeof tree !== 'object') return '';
  
  // Find root elements (no parent)
  const rootIds = Object.keys(tree).filter(id => !tree[id].parent);
  
  return rootIds.map(rootId => processNodeToMarkdown(tree, rootId)).join('\n');
};

// Process node and its children for markdown
const processNodeToMarkdown = (tree, nodeId) => {
  const node = tree[nodeId];
  if (!node) return '';
  
  // Get node's markdown representation
  let md = formatNodeAsMarkdown(node);
  
  // Find and process children
  const childIds = Object.keys(tree).filter(id => tree[id].parent === nodeId);
  if (childIds.length > 0) {
    const childMd = childIds.map(childId => processNodeToMarkdown(tree, childId)).join('\n');
    if (childMd) md += (md ? '\n' : '') + childMd;
  }
  
  return md;
};

// Format node based on tag
const formatNodeAsMarkdown = (node) => {
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








// Test data - HTML input and expected tree structure
const TEST_CASES = {
  basic: [
    {
      name: "simple_paragraph",
      html: "<p>Hello world</p>",
      expected: { 
        "body-0": { tag: "body" },
        "p-0": { tag: "p", text: "Hello world", parent: "body-0" } 
      }
    },
    {
      name: "heading_hierarchy", 
      html: "<h1>Title</h1><h2>Subtitle</h2><p>Content</p>",
      expected: {
        "body-0": { tag: "body" },
        "h1-0": { tag: "h1", text: "Title", parent: "body-0" },
        "h2-1": { tag: "h2", text: "Subtitle", parent: "body-0" },
        "p-2": { tag: "p", text: "Content", parent: "body-0" }
      }
    },
    {
      name: "nested_container",
      html: "<div><p>First</p><p>Second</p></div>",
      expected: {
        "body-0": { tag: "body" },
        "div-0": { tag: "div", parent: "body-0" },
        "p-0": { tag: "p", text: "First", parent: "div-0" },
        "p-1": { tag: "p", text: "Second", parent: "div-0" }
      }
    }
  ],

  filtering: [
    {
      name: "skip_hidden_display_none",
      html: '<p style="display: none">Hidden</p><p>Visible</p>',
      options: { skipHidden: true },
      expected: { 
        "body-0": { tag: "body" },
        "p-0": { tag: "p", text: "Visible", parent: "body-0" } 
      }
    },
    {
      name: "skip_ad_elements",
      html: '<div class="advertisement">Ad</div><p>Content</p>',
      options: { skipAds: true },
      expected: { 
        "body-0": { tag: "body" },
        "p-0": { tag: "p", text: "Content", parent: "body-0" } 
      }
    },
    {
      name: "skip_script_tags",
      html: '<script>alert("test")</script><p>Content</p>',
      expected: { 
        "body-0": { tag: "body" },
        "p-0": { tag: "p", text: "Content", parent: "body-0" } 
      }
    },
    {
      name: "empty_elements",
      html: "<p></p><div></div><p>Content</p>",
      expected: { 
        "body-0": { tag: "body" },
        "p-0": { tag: "p", text: "Content", parent: "body-0" } 
      }
    }
  ],

  special_elements: [
    {
      name: "links_with_href",
      html: '<a href="https://example.com">Link text</a>',
      expected: { 
        "body-0": { tag: "body" },
        "a-0": { tag: "a", text: "Link text", href: "https://example.com", parent: "body-0" } 
      }
    },
    {
      name: "images_with_attributes",
      html: '<img src="image.jpg" alt="Test image">',
      expected: { 
        "body-0": { tag: "body" },
        "img-0": { tag: "img", src: "image.jpg", alt: "Test image", parent: "body-0" } 
      }
    },
    {
      name: "list_structure",
      html: "<ul><li>Item 1</li><li>Item 2</li></ul>",
      expected: {
        "body-0": { tag: "body" },
        "ul-0": { tag: "ul", parent: "body-0" },
        "li-0": { tag: "li", text: "Item 1", parent: "ul-0" },
        "li-1": { tag: "li", text: "Item 2", parent: "ul-0" }
      }
    },
    {
      name: "table_elements",
      html: "<table><tr><th>Header</th><td>Data</td></tr></table>",
      expected: {
        "body-0": { tag: "body" },
        "table-0": { tag: "table", parent: "body-0" },
        "tr-0": { tag: "tr", parent: "table-0" },
        "th-0": { tag: "th", text: "Header", parent: "tr-0" },
        "td-1": { tag: "td", text: "Data", parent: "tr-0" }
      }
    },
    {
      name: "form_elements",
      html: '<input value="test" placeholder="Enter text"><textarea placeholder="Message">Content</textarea>',
      expected: {
        "body-0": { tag: "body" },
        "input-0": { tag: "input", value: "test", placeholder: "Enter text", parent: "body-0" },
        "textarea-1": { tag: "textarea", value: "Content", placeholder: "Message", parent: "body-0" }
      }
    }
  ],

  inline_formatting: [
    {
      name: "bold_italic_text",
      html: "<p>Normal <strong>bold</strong> and <em>italic</em> text</p>",
      expected: { "p-0": { tag: "p", text: "Normal **bold** and *italic* text" } }
    },
    {
      name: "mixed_inline_formatting",
      html: "<p><strong>Bold <em>and italic</em></strong> text</p>",
      expected: { "p-0": { tag: "p", text: "**Bold *and italic*** text" } }
    },
    {
      name: "code_elements",
      html: "<p>Use <code>console.log()</code> function</p>",
      expected: { "p-0": { tag: "p", text: "Use `console.log()` function" } }
    }
  ],

  edge_cases: [
    {
      name: "malformed_html",
      html: "<p>Unclosed paragraph<div>Nested content</div>",
      expected: {
        "body-0": { tag: "body" },
        "p-0": { tag: "p", text: "Unclosed paragraph", parent: "body-0" },
        "div-1": { tag: "div", text: "Nested content", parent: "body-0" }
      }
    },
    {
      name: "special_characters",
      html: "<p>Test &amp; &lt;symbols&gt; &quot;quotes&quot;</p>",
      expected: { 
        "body-0": { tag: "body" },
        "p-0": { tag: "p", text: 'Test & <symbols> "quotes"', parent: "body-0" } 
      }
    },
    {
      name: "deep_nesting",
      html: "<div><div><div><p>Deep content</p></div></div></div>",
      expected: {
        "body-0": { tag: "body" },
        "div-0": { tag: "div", parent: "body-0" },
        "div-0": { tag: "div", parent: "div-0" },
        "div-0": { tag: "div", parent: "div-0" },
        "p-0": { tag: "p", text: "Deep content", parent: "div-0" }
      }
    }
  ]
};

// Test runner helpers
const createTestDOM = (html) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<html><body>${html}</body></html>`, 'text/html');
  return doc.body;
};

const runSingleTest = async (testCase) => {
  try {
    // Create DOM
    const testDoc = createTestDOM(testCase.html);
    
    // Create mock window
    const mockWindow = {
      getComputedStyle: (el) => ({
        display: el.style?.display || 'block',
        visibility: el.style?.visibility || 'visible'
      })
    };
    
    // Run extraction directly (no eval)
    const result = extractPageStructure(testCase.options || {}, testDoc, mockWindow);
    
    // Compare results
    const passed = deepEqual(result.body, testCase.expected);
    
    return {
      name: testCase.name,
      passed,
      expected: testCase.expected,
      actual: result.body,
      stats: result.stats,
      error: null
    };
    
  } catch (error) {
    return {
      name: testCase.name,
      passed: false,
      expected: testCase.expected,
      actual: null,
      stats: null,
      error: error.message
    };
  }
};

const runTestGroup = async (groupName) => {
  const tests = TEST_CASES[groupName];
  if (!tests) throw new Error(`Test group '${groupName}' not found`);
  
  runtime.log(`[WebExtractorTests] Running ${tests.length} tests in group '${groupName}'`);
  
  const results = [];
  for (const test of tests) {
    const result = await runSingleTest(test);
    results.push(result);
    
    const status = result.passed ? '✅' : '❌';
    runtime.log(`  ${status} ${result.name}${result.error ? ` - ${result.error}` : ''}`);
    
    if (!result.passed && !result.error) {
      runtime.log(`    Expected:`, result.expected);
      runtime.log(`    Actual:  `, result.actual);
    }
  }
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  runtime.log(`[WebExtractorTests] Group '${groupName}': ${passed}/${total} tests passed`);
  
  return { groupName, passed, total, results };
};

export const runTests = async () => {
  runtime.log('[WebExtractorTests] Running all test groups...');
  
  const allResults = [];
  let totalPassed = 0;
  let totalTests = 0;
  
  for (const groupName of Object.keys(TEST_CASES)) {
    const groupResult = await runTestGroup(groupName);
    allResults.push(groupResult);
    totalPassed += groupResult.passed;
    totalTests += groupResult.total;
  }
  
  // Summary
  runtime.log(`\n[WebExtractorTests] SUMMARY: ${totalPassed}/${totalTests} tests passed`);
  
  // Failed tests summary
  const failedTests = allResults.flatMap(g => 
    g.results.filter(r => !r.passed).map(r => ({ group: g.groupName, ...r }))
  );
  
  if (failedTests.length > 0) {
    runtime.log(`\nFailed tests:`);
    failedTests.forEach(t => {
      runtime.log(`  ${t.group}.${t.name}: ${t.error || 'Output mismatch'}`);
    });
  }
  
  return { totalPassed, totalTests, groups: allResults, failedTests };
};

export { runTestGroup };

// Utility functions
const deepEqual = (a, b) => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  
  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    
    for (const key of keysA) {
      if (!keysB.includes(key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  
  return false;
};

// Direct implementation (no eval) - extracted from web-extractor module
const extractPageStructure = (options, document, window) => {
  const { skipAds = true, skipHidden = true } = options;
  
  const LEAF_TAGS = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'li', 'td', 'th', 'a', 'img', 'input', 'textarea', 'code'
  ]);
  
  const SKIP_TAGS = new Set(['script', 'style', 'noscript']);
  const AD_PATTERNS = /ad|ads|sponsor|promo|banner|advertisement/i;
  
  let stats = { elements: 0, depth: 0 };
  const usedIds = new Set();
  const flatTree = {}; // Flattened structure
  
  const shouldSkip = (el) => {
    if (SKIP_TAGS.has(el.tagName.toLowerCase())) return true;
    if (skipHidden && el.style) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    }
    if (skipAds && AD_PATTERNS.test(el.className + ' ' + el.id)) return true;
    return false;
  };
  
  const hasContent = (el) => {
    if (el.innerText?.trim()) return true;
    if (el.tagName === 'IMG' || el.tagName === 'INPUT') return true;
    return false;
  };
  
  const getId = (el, tag, index) => {
    if (el.id && !usedIds.has(el.id)) {
      usedIds.add(el.id);
      return el.id;
    }
    let id = tag + '-' + index;
    while (usedIds.has(id)) {
      index++;
      id = tag + '-' + index;
    }
    usedIds.add(id);
    return id;
  };
  
  const extractInlineText = (el) => {
    return el.innerText?.trim() || '';
  };
  
  const walk = (el, depth = 0, index = 0, parentId = null) => {
    if (!el || !el.tagName) return null; // Guard against undefined elements
    if (shouldSkip(el)) return null;
    if (!hasContent(el)) return null;
    
    stats.elements++;
    stats.depth = Math.max(stats.depth, depth);
    
    const tag = el.tagName.toLowerCase();
    const id = getId(el, tag, index);
    const node = { tag };
    
    // Add parent reference if not root
    if (parentId) {
      node.parent = parentId;
    }
    
    // Extract text and attributes for leaf elements
    if (LEAF_TAGS.has(tag)) {
      const text = extractInlineText(el);
      if (text) node.text = text;
      
      // Special attributes
      if (tag === 'a' && el.href) node.href = el.href;
      if (tag === 'img') {
        if (el.src) node.src = el.src;
        if (el.alt) node.alt = el.alt;
      }
      if (tag === 'input' || tag === 'textarea') {
        if (el.value) node.value = el.value;
        if (el.placeholder) node.placeholder = el.placeholder;
      }
    }
    
    // Add to flat tree
    flatTree[id] = node;
    
    // Process children
    let childIndex = 0;
    for (const child of el.children || []) {
      walk(child, depth + 1, childIndex++, id);
    }
    
    return id;
  };
  
  // Start with body
  walk(document.body, 0, 0);
  
  return { body: flatTree, stats };
};