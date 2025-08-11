export const manifest = {
  name: 'ui',
  version: '1.0.0',
  context: 'extension-page',
  description: 'Provides sidebar, notifications, and dynamic forms for other modules',
  permissions: ['tabs', 'scripting', 'storage'],
  actions: ['renderForm', 'renderTree', 'initializeLayout'],
};

let runtime;
export const initialize = (rt) => (runtime = rt, initializeLayout());

// Enhanced form system replacing showInput/showSelect
export const renderForm = async (params) => {
  const { tree, onSubmit, onFieldChange, title = 'Form', formData = {} } = params;
  
  // Create modal with form
  const { modal, contentArea } = createModal({ 
    title, 
    content: '', 
    onClose: removeModal 
  });
  
  // Build and render the form tree
  const formElements = createTreeElements(tree);
  addElementsToTree(tree, formElements);
  
  // Set initial form values
  Object.entries(formData).forEach(([name, value]) => {
    const element = contentArea.querySelector(`[name="${name}"]`);
    if (element) element.value = value;
  });
  
  // Set up dependency listeners
  setupDependencyListeners(tree, formElements, onFieldChange);
  
  // Set up form submission
  setupFormSubmission(contentArea, onSubmit);
  
  return { success: true };
};

const createTreeElements = (tree) => {
  const elements = new Map();
  
  const processNode = (nodes) => {
    Object.entries(nodes).forEach(([id, node]) => {
      if (node.tag) {
        // Create element for this node
        const el = createElement(node.tag || 'div');
        setElementAttributes(id, el, node);
        elements.set(id, el);
        
        // Process any nested children
        Object.entries(node).forEach(([childId, childNode]) => {
          if (typeof childNode === 'object' && childNode.tag) {
            processNode({ [childId]: childNode });
          }
        });
      }
    });
  };
  
  processNode(tree);
  return elements;
};

// Set attributes and properties on elements
const setElementAttributes = (id, el, node) => {
  // Basic attributes
  if (node.text) el.textContent = node.text;
  if (node.class) el.className = node.class;
  if (node.name) el.name = node.name;
  if (node.type) el.type = node.type;
  if (node.placeholder) el.placeholder = node.placeholder;
  if (node.value) el.value = node.value;
  
  // Data attributes
  if (node.data) {
    Object.entries(node.data).forEach(([key, value]) => {
      el.dataset[key] = value;
    });
  }
  
  // Handle select options
  if (node.tag === 'select' && node.options) {
    populateSelectOptions(el, node.options);
  }
  
  // Style for better form appearance
  if (['input', 'select', 'textarea'].includes(node.tag)) {
    el.className = `cognition-${node.tag} ${node.class || ''}`.trim();
  }
  
  if (node.tag === 'button') {
    el.className = `cognition-button cognition-button-primary ${node.class || ''}`.trim();
  }
};

// Populate select element with options
const populateSelectOptions = (selectEl, options) => {
  selectEl.innerHTML = '';
  
  options.forEach(opt => {
    const option = createElement('option');
    const optionData = typeof opt === 'string' 
      ? { value: opt, text: opt } 
      : { value: opt.value || opt.id, text: opt.text || opt.label || opt.value };
    
    option.value = optionData.value;
    option.textContent = optionData.text;
    if (optionData.selected) option.selected = true;
    
    selectEl.appendChild(option);
  });
};

const addElementsToTree = (tree, elements, parentElement = null) => {
  Object.entries(tree).forEach(([id, node]) => {
    const el = elements.get(id);
    const parent = parentElement || document.querySelector('#cognition-active-modal .cognition-modal-content');
    parent?.appendChild(el);
    
    // Recursively handle nested children
    Object.entries(node).forEach(([childId, childNode]) => {
      if (typeof childNode === 'object' && childNode.tag) {
        addElementsToTree({ [childId]: childNode }, elements, el);
      }
    });
  });
};

// Set up listeners for dependent fields
const setupDependencyListeners = (tree, elements, onFieldChange) => {
  if (!onFieldChange) return;
  
  Object.entries(tree).forEach(([id, node]) => {
    if (node.dependsOn) {
      const parentElement = elements.get(node.dependsOn);
      const childElement = elements.get(id);
      
      if (parentElement && childElement) {
        parentElement.addEventListener('change', async () => {
          // Get current form state
          const formData = getCurrentFormData();
          
          try {
            // Call back to requesting module for updated tree
            const result = await runtime.call(onFieldChange, {
              formData,
              changedField: node.dependsOn
            });
            
            if (result.success && result.tree) {
              await updateDependentField(id, result.tree[id], elements, formData);
            }
          } catch (error) {
            console.error('[UI] Error updating dependent field:', error);
          }
        });
        
        // Initialize dependent field
        initializeDependentField(node, elements);
      }
    }
  });
};

// Initialize dependent field based on current parent value
const initializeDependentField = (node, elements) => {
  if (!node.optionsByDependency) return;
  
  const parentElement = elements.get(node.dependsOn);
  const childElement = elements.get(Object.keys(elements).find(key => 
    elements.get(key) === parentElement
  ));
  
  if (parentElement && childElement) {
    const parentValue = parentElement.value;
    const options = node.optionsByDependency[parentValue] || [];
    populateSelectOptions(childElement, options);
  }
};

// Update a specific dependent field while preserving other form data
const updateDependentField = async (fieldId, newNodeDef, elements, formData) => {
  const element = elements.get(fieldId);
  if (!element || !newNodeDef) return;
  
  // Store current value to preserve if possible
  const currentValue = element.value;
  
  // Update the field based on new definition
  if (newNodeDef.options && element.tagName === 'SELECT') {
    populateSelectOptions(element, newNodeDef.options);
    
    // Try to preserve the current value if it exists in new options
    const optionExists = Array.from(element.options).some(opt => opt.value === currentValue);
    if (optionExists) {
      element.value = currentValue;
    }
  }
  
  // Restore other form values
  restoreFormData(formData);
};

// Get current form data as object
const getCurrentFormData = () => {
  const modal = document.querySelector('#cognition-active-modal');
  if (!modal) return {};
  
  const formData = {};
  const formElements = modal.querySelectorAll('input, select, textarea');
  
  formElements.forEach(el => {
    if (el.name) {
      formData[el.name] = el.value;
    }
  });
  
  return formData;
};

// Restore form data after tree update
const restoreFormData = (formData) => {
  const modal = document.querySelector('#cognition-active-modal');
  if (!modal) return;
  
  Object.entries(formData).forEach(([name, value]) => {
    const element = modal.querySelector(`[name="${name}"]`);
    if (element && element.value !== value) {
      element.value = value;
    }
  });
};

// Set up form submission handling
const setupFormSubmission = (contentArea, onSubmit) => {
  if (!onSubmit) return;
  
  // Find submit button or form
  const submitBtn = contentArea.querySelector('button[type="submit"], button:not([type])');
  const form = contentArea.querySelector('form');
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const formData = getCurrentFormData();
    
    try {
      await runtime.call(onSubmit, formData);
      removeModal();
    } catch (error) {
      console.error('[UI] Form submission error:', error);
      // Could show error in UI here
    }
  };
  
  if (form) {
    form.addEventListener('submit', handleSubmit);
  } else if (submitBtn) {
    submitBtn.addEventListener('click', handleSubmit);
  }
};

// Existing tree rendering (unchanged)
export const renderTree = async ({ tree }) => {
  try {
    (getMainContent()).innerHTML = '';
    addElementsToTree(tree, createTreeElements(tree));
  } catch (error) { 
    showState(`Failed to render: ${error.message}`, 'error'); 
  }
};

// Layout and rendering (unchanged)
export const initializeLayout = async () => {
  document.querySelector('#cognition-main-layout')?.remove();
  const layout = createElement('div', { id: 'cognition-main-layout' });
  const mainContent = createElement('div', { id: MAIN, innerHTML: loadingMessageHTML("Enter a search query below to begin") });
  
  const searchInput = createElement('input', { 
    id: 'cognition-search-input',
    type: 'text',
    placeholder: 'Search the web...',
    onkeydown: async (e) => {
      if (e.key === 'Enter') {
        const query = e.target.value.trim();
        if (query) {
          showState('Searching...', 'loading');
          try { 
            await runtime.call('web-search.searchWeb', { query }); 
          } catch (error) { 
            showState(`Search failed: ${error.message}`, 'error'); 
          }
        }
      }
    }
  });
  
  const searchBar = createElement('div', { id: 'cognition-search-bar' });
  searchBar.appendChild(searchInput);
  layout.append(mainContent, searchBar);
  document.body.appendChild(layout);
  
  setTimeout(() => searchInput.focus(), 100);
  return { success: true };
};

// Modal factory (unchanged)
const createModal = ({ title, content, onClose = removeModal }) => {
  removeModal();
  const overlay = createElement('div', { className: 'cognition-overlay', onclick: onClose });
  const modal = createElement('div', { className: 'cognition-modal', id: 'cognition-active-modal' });
  if (title) modal.appendChild(createElement('div', { className: 'cognition-modal-header', textContent: title }));
  const contentArea = createElement('div', { className: 'cognition-modal-content' });
  if (typeof content === 'string') contentArea.innerHTML = content;
  else contentArea.appendChild(content);
  modal.appendChild(contentArea);
  document.body.append(overlay, modal);
  return { modal, contentArea };
};

// Utility functions (unchanged)
const MAIN = 'cognition-main-content';
const getMainContent = () => document.getElementById(MAIN) || (() => { throw new Error('Main content area not found'); })();
const showState = (message, type = 'loading') => getMainContent().innerHTML = type === 'error' ? errorMessageHTML(message) : loadingMessageHTML(message);
const errorMessageHTML = (message) => `<div class="cognition-error"><div class="cognition-error-icon">⚠️</div><div class="cognition-error-message">${message}</div></div>`;
const loadingMessageHTML = (message) => `<div class="cognition-loading"><div class="cognition-spinner"></div><div class="cognition-loading-message">${message}</div></div>`;
const removeModal = () => ['#cognition-active-modal', '.cognition-overlay'].forEach(sel => document.querySelector(sel)?.remove());
const createElement = (tag, attrs = {}) => Object.assign(document.createElement(tag), attrs);

// Handle tree events (for search results, etc.)
const handleTreeEvent = async (event, handlerName, nodeId, node) => {
  event.preventDefault();
  try {
    if (handlerName === 'handleResultClick' && node.data?.url) {
      showState('Extracting page content...', 'loading');
      const result = await runtime.call('web-extractor.extractToMarkdown', { url: node.data.url });
      result.success ? renderMarkdown(result.markdown, result.title, node.data.url) : showState(`Failed to extract: ${result.error}`, 'error');
    }
  } catch (error) { 
    showState(`Action failed: ${error.message}`, 'error'); 
  }
};

const renderMarkdown = (markdown, title, url) => {
  const backBtn = createElement('button', { className: 'cognition-button cognition-button-secondary cognition-back-button', textContent: '← Back to Results', onclick: () => location.reload() });
  const titleEl = createElement('h1', { className: 'cognition-markdown-title', textContent: title || 'Extracted Content' });
  const urlEl = createElement('div', { className: 'cognition-markdown-url', textContent: url });
  const contentEl = createElement('div', { className: 'cognition-markdown-content', innerHTML: markdownToHTML(markdown) });
  getMainContent().replaceChildren(backBtn, titleEl, urlEl, contentEl);
};

const markdownToHTML = (md) => !md ? '<p>No content extracted</p>' : md
  .replace(/^### (.*$)/gm, '<h3>$1</h3>')
  .replace(/^## (.*$)/gm, '<h2>$1</h2>')
  .replace(/^# (.*$)/gm, '<h1>$1</h1>')
  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  .replace(/\*(.*?)\*/g, '<em>$1</em>')
  .replace(/`(.*?)`/g, '<code>$1</code>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
  .split('\n\n').map(p => p.trim() ? `<p>${p.replace(/\n/g, '<br>')}</p>` : '').join('');