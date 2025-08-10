export const manifest = {
  name: 'ui',
  version: '1.0.0',
  context: 'extension-page',
  description: 'Provides sidebar, notifications, and modals for other modules',
  permissions: ['tabs', 'scripting', 'storage'],
  actions: ['showInput', 'renderTree', 'initializeLayout'],
};

let runtime;
let eventHandlers = new Map();

export const initialize = (rt) => {
  runtime = rt;
  initializeLayout();
};

// Initialize the main layout (80% content area + 20% search bar)
export const initializeLayout = async () => {
  // Remove any existing layout
  const existingLayout = document.getElementById('cognition-main-layout');
  if (existingLayout) {
    existingLayout.remove();
  }
  
  // Create main layout container
  const layout = document.createElement('div');
  layout.id = 'cognition-main-layout';
  layout.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    font-family: system-ui, -apple-system, sans-serif;
    background: #f5f5f5;
    z-index: 999999;
  `;
  
  // Create main content area (80%)
  const mainContent = document.createElement('div');
  mainContent.id = 'cognition-main-content';
  mainContent.style.cssText = `
    flex: 1;
    height: 80vh;
    margin: 0 10%;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    overflow-y: auto;
    padding: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 18px;
  `;
  mainContent.textContent = 'Enter a search query below to begin';
  
  // Create search bar area (20%)
  const searchBar = document.createElement('div');
  searchBar.id = 'cognition-search-bar';
  searchBar.style.cssText = `
    height: 20vh;
    margin: 0 10%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px 0;
  `;
  
  // Create search input
  const searchInput = document.createElement('input');
  searchInput.id = 'cognition-search-input';
  searchInput.type = 'text';
  searchInput.placeholder = 'Search the web...';
  searchInput.style.cssText = `
    width: 100%;
    max-width: 800px;
    padding: 16px 24px;
    font-size: 16px;
    border: 2px solid #ddd;
    border-radius: 50px;
    outline: none;
    transition: border-color 0.2s;
  `;
  
  // Add search input focus effect
  searchInput.addEventListener('focus', () => {
    searchInput.style.borderColor = '#4285f4';
  });
  
  searchInput.addEventListener('blur', () => {
    searchInput.style.borderColor = '#ddd';
  });
  
  // Add search functionality
  searchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const query = searchInput.value.trim();
      if (query) {
        // Show loading state
        showLoadingState('Searching...');
        
        try {
          // Call web search
          await runtime.call('web-search.searchWeb', { query });
        } catch (error) {
          showError(`Search failed: ${error.message}`);
        }
      }
    }
  });
  
  // Assemble layout
  searchBar.appendChild(searchInput);
  layout.appendChild(mainContent);
  layout.appendChild(searchBar);
  document.body.appendChild(layout);
  
  // Focus search input
  setTimeout(() => searchInput.focus(), 100);
  
  return { success: true };
};

// Render tree structure into main content
export const renderTree = async (params) => {
  const { tree } = params;
  
  if (!tree || typeof tree !== 'object') {
    return { success: false, error: 'Invalid tree structure' };
  }
  
  const mainContent = document.getElementById('cognition-main-content');
  if (!mainContent) {
    return { success: false, error: 'Main content area not found' };
  }
  
  try {
    // Clear existing content
    mainContent.innerHTML = '';
    mainContent.style.cssText = mainContent.style.cssText.replace(/display: flex[^;]*;|align-items: center;|justify-content: center;/g, '');
    mainContent.style.display = 'block';
    
    // Convert tree to DOM elements
    const elements = new Map();
    
    // First pass: create all elements
    for (const [nodeId, node] of Object.entries(tree)) {
      const element = createElementFromNode(node, nodeId);
      elements.set(nodeId, element);
    }
    
    // Second pass: build parent-child relationships
    for (const [nodeId, node] of Object.entries(tree)) {
      const element = elements.get(nodeId);
      
      if (node.parent) {
        const parentElement = elements.get(node.parent);
        if (parentElement) {
          parentElement.appendChild(element);
        }
      } else {
        // Root element - append to main content
        mainContent.appendChild(element);
      }
    }
    
    // Add base styles for search results
    addSearchResultStyles();
    
    return { success: true };
    
  } catch (error) {
    runtime.logError('[UI] renderTree failed:', error);
    showError(`Failed to render content: ${error.message}`);
    return { success: false, error: error.message };
  }
};

// Create DOM element from tree node
function createElementFromNode(node, nodeId) {
  const element = document.createElement(node.tag || 'div');
  
  // Set basic properties
  if (node.text) element.textContent = node.text;
  if (node.class) element.className = node.class;
  if (node.id) element.id = node.id;
  
  // Set data attributes
  if (node.data) {
    for (const [key, value] of Object.entries(node.data)) {
      element.dataset[key] = value;
    }
  }
  
  // Set other attributes
  if (node.src) element.src = node.src;
  if (node.href) element.href = node.href;
  if (node.alt) element.alt = node.alt;
  if (node.placeholder) element.placeholder = node.placeholder;
  if (node.value) element.value = node.value;
  
  // Bind event handlers
  if (node.events) {
    for (const [eventType, handlerName] of Object.entries(node.events)) {
      element.addEventListener(eventType, (e) => {
        handleTreeEvent(e, handlerName, nodeId, node);
      });
    }
  }
  
  return element;
}

// Handle events from tree elements
async function handleTreeEvent(event, handlerName, nodeId, node) {
  event.preventDefault();
  
  try {
    if (handlerName === 'handleResultClick') {
      // Handle search result clicks
      const url = node.data?.url;
      if (url) {
        // Show loading state
        showLoadingState('Extracting page content...');
        
        // Extract page content
        const result = await runtime.call('web-extractor.extractToMarkdown', { url });
        
        if (result.success) {
          // Render markdown content
          renderMarkdownContent(result.markdown, result.title, url);
        } else {
          showError(`Failed to extract content: ${result.error}`);
        }
      }
    }
    // Add more event handlers here as needed
    
  } catch (error) {
    runtime.logError('[UI] Event handler failed:', error);
    showError(`Action failed: ${error.message}`);
  }
}

// Render markdown content in main area
function renderMarkdownContent(markdown, title, url) {
  const mainContent = document.getElementById('cognition-main-content');
  if (!mainContent) return;
  
  mainContent.innerHTML = '';
  
  // Create back button
  const backButton = document.createElement('button');
  backButton.textContent = '← Back to Results';
  backButton.style.cssText = `
    margin-bottom: 20px;
    padding: 8px 16px;
    background: #f0f0f0;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  `;
  backButton.addEventListener('click', () => {
    // TODO: Implement back navigation
    location.reload(); // Temporary solution
  });
  
  // Create title
  const titleElement = document.createElement('h1');
  titleElement.textContent = title || 'Extracted Content';
  titleElement.style.cssText = `
    margin: 0 0 10px 0;
    color: #333;
    font-size: 28px;
    line-height: 1.2;
  `;
  
  // Create URL display
  const urlElement = document.createElement('div');
  urlElement.textContent = url;
  urlElement.style.cssText = `
    color: #666;
    font-size: 14px;
    margin-bottom: 20px;
    word-break: break-all;
  `;
  
  // Create markdown content
  const contentElement = document.createElement('div');
  contentElement.innerHTML = markdownToHTML(markdown);
  contentElement.style.cssText = `
    line-height: 1.6;
    color: #333;
  `;
  
  // Assemble content
  mainContent.appendChild(backButton);
  mainContent.appendChild(titleElement);
  mainContent.appendChild(urlElement);
  mainContent.appendChild(contentElement);
}

// Simple markdown to HTML converter
function markdownToHTML(markdown) {
  if (!markdown) return '<p>No content extracted</p>';
  
  return markdown
    // Headers
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Code
    .replace(/`(.*?)`/g, '<code>$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    // Paragraphs
    .split('\n\n')
    .map(para => para.trim() ? `<p>${para.replace(/\n/g, '<br>')}</p>` : '')
    .join('');
}

// Show loading state
function showLoadingState(message) {
  const mainContent = document.getElementById('cognition-main-content');
  if (!mainContent) return;
  
  mainContent.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;">
      <div style="width: 40px; height: 40px; border: 4px solid #f0f0f0; border-top: 4px solid #4285f4; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px;"></div>
      <div style="color: #666; font-size: 16px;">${message}</div>
    </div>
  `;
  
  // Add spinner animation if not already added
  if (!document.querySelector('#spinner-styles')) {
    const styles = document.createElement('style');
    styles.id = 'spinner-styles';
    styles.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(styles);
  }
}

// Show error message
function showError(message) {
  const mainContent = document.getElementById('cognition-main-content');
  if (!mainContent) return;
  
  mainContent.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #d32f2f;">
      <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
      <div style="font-size: 18px; text-align: center; max-width: 400px;">${message}</div>
    </div>
  `;
}

// Add styles for search results
function addSearchResultStyles() {
  if (document.querySelector('#search-result-styles')) return;
  
  const styles = document.createElement('style');
  styles.id = 'search-result-styles';
  styles.textContent = `
    .search-results {
      max-width: 800px;
      margin: 0 auto;
    }
    
    .search-results h2 {
      color: #333;
      margin: 0 0 24px 0;
      font-size: 24px;
    }
    
    .search-result {
      margin-bottom: 24px;
      padding: 16px;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .search-result:hover {
      border-color: #4285f4;
      box-shadow: 0 2px 8px rgba(66, 133, 244, 0.1);
    }
    
    .result-title {
      color: #1a73e8;
      margin: 0 0 8px 0;
      font-size: 18px;
      line-height: 1.3;
    }
    
    .result-url {
      color: #006621;
      margin: 0 0 8px 0;
      font-size: 14px;
    }
    
    .result-snippet {
      color: #545454;
      margin: 0;
      line-height: 1.4;
    }
  `;
  document.head.appendChild(styles);
}

// Existing showInput function (unchanged)
export const showInput = async (params = {}) => {
  const { 
    placeholder = 'Type...', 
    title = 'Enter Input', 
    action = '',
    valueName = 'value',
    actionParams: actionParams = {}
  } = params;
  
  // Remove any existing input form
  const existingForm = document.getElementById('cognition-mini-input');
  if (existingForm) {
    existingForm.remove();
  }
  
  // Create container
  const container = document.createElement('div');
  container.id = 'cognition-mini-input';
  container.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    padding: 16px;
    z-index: 999999;
    width: 300px;
    font-family: system-ui, -apple-system, sans-serif;
  `;
  
  // Create title
  const titleElement = document.createElement('div');
  titleElement.textContent = title;
  titleElement.style.cssText = `
    font-size: 14px;
    margin-bottom: 8px;
    color: #333;
    font-weight: 500;
  `;
  
  // Create input
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.style.cssText = `
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
    box-sizing: border-box;
    outline: none;
  `;
  
  // Add event listener
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const value = input.value.trim();
      if (value) {
        // Send message with the specified action and param name
        if (action) {
          runtime.call(action, { ...actionParams, [valueName]: value });
        }
        container.remove();
      }
    } else if (e.key === 'Escape') {
      container.remove();
    }
  });
  
  // Create background overlay (click to close)
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.3);
    z-index: 999998;
  `;
  overlay.addEventListener('click', () => {
    container.remove();
    overlay.remove();
  });
  
  // Assemble and add to DOM
  container.appendChild(titleElement);
  container.appendChild(input);
  document.body.appendChild(overlay);
  document.body.appendChild(container);
  
  // Focus input
  setTimeout(() => input.focus(), 50);
  
  return { success: true };
};