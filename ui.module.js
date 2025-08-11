export const manifest = {
  name: 'ui',
  version: '1.0.0',
  context: 'extension-page',
  description: 'Provides sidebar, notifications, and modals for other modules',
  permissions: ['tabs', 'scripting', 'storage'],
  actions: ['showInput', 'showSelect', 'renderTree', 'initializeLayout'],
};

let runtime;
export const initialize = (rt) => (runtime = rt, initializeLayout());

// Modal factory
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
// Form control factory
const createFormControl = (type, { placeholder, options, defaultValue, className = `cognition-${type}` }) => {
  if (type === 'select') {
    const select = createElement('select', { className });
    if (placeholder) select.appendChild(createElement('option', { value: '', textContent: placeholder, disabled: true, selected: !defaultValue }));
    options.forEach(opt => {
      const option = typeof opt === 'string' 
        ? { value: opt, text: opt } 
        : { value: opt.value || opt.id, text: opt.text || opt.label || opt.value };
      select.appendChild(createElement('option', { ...option, textContent: option.text, selected: option.value === defaultValue }));
    });
    return select;
  }
  return createElement('input', { type, className, placeholder });
};
// Generic modal input handler
const showModalInput = (type, params) => new Promise(resolve => {
  const { title = 'Input', action, valueName = 'value', actionParams = {}, onClose = () => resolve(null) } = params;
  const handleSubmit = () => {
    const value = control.value?.trim();
    if (value) {
      action && runtime.call(action, { ...actionParams, [valueName]: value });
      resolve(value);
      removeModal();
    }
  };
  const control = createFormControl(type, params);
  const container = type === 'select' ? (() => {
    const div = createElement('div');
    const actions = createElement('div', { className: 'cognition-modal-actions' });
    const cancel = createElement('button', { className: 'cognition-button cognition-button-secondary', textContent: 'Cancel', onclick: onClose });
    const submit = createElement('button', { className: 'cognition-button cognition-button-primary', textContent: type === 'select' ? 'Select' : 'Submit', onclick: handleSubmit });
    
    control.addEventListener('change', () => submit.disabled = !control.value);
    submit.disabled = !control.value;
    
    actions.append(cancel, submit);
    div.append(control, actions);
    return div;
  })() : control;

  createModal({ title, content: container, onClose });
  control.addEventListener('keydown', handleKeydown(handleSubmit, onClose));
  setTimeout(() => control.focus(), 50);
});

// Public APIs
export const showInput = (params = {}) => showModalInput('input', { placeholder: 'Type...', title: 'Enter Input', ...params });
export const showSelect = (params = {}) => showModalInput('select', { title: 'Select Option', placeholder: 'Choose an option...', options: [], ...params });

// Layout and rendering
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
          try { await runtime.call('web-search.searchWeb', { query }); }
          catch (error) { showState(`Search failed: ${error.message}`, 'error'); }
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

export const renderTree = async ({ tree }) => {
  try {
    (getMainContent()).innerHTML = '';
    addElementsToTree(tree, createTreeElements(tree));
  } catch (error) { showState(`Failed to render: ${error.message}`, 'error'); }
};
const createTreeElements = (tree) => {
  const elements = new Map();
  Object.entries(tree).forEach(([id, node]) => {
    const el = createElement(node.tag || 'div');
    setElementAttributes(id, el, node);
    elements.set(id, el);
  });
  return elements;
}
const setElementAttributes = (id, el, node) => Object.entries(node).forEach(([attr, value]) => {
  if (attr === 'text') el.textContent = value;
  else if (attr === 'class') el.className = value;
  else if (['src', 'href', 'alt', 'id', 'placeholder', 'value'].includes(attr)) el[attr] = value;
  else if (attr === 'data') Object.entries(value).forEach(([k, v]) => el.dataset[k] = v);
  else if (attr === 'events') Object.entries(value).forEach(([event, handler]) => el.addEventListener(event, (e) => handleTreeEvent(e, handler, id, node)));
});
const addElementsToTree = (tree, elements) => {
  Object.entries(tree).forEach(([id, node]) => {
    const el = elements.get(id);
    const parent = node.parent ? elements.get(node.parent) : getMainContent();
    parent?.appendChild(el);
  });
};

const MAIN = 'cognition-main-content'
const getMainContent = () => document.getElementById(MAIN) || (() => { throw new Error('Main content area not found'); })();
const showState = (message, type = 'loading') => getMainContent().innerHTML = type === 'error' ? errorMessageHTML(message) : loadingMessageHTML(message);
const errorMessageHTML = (message) => `<div class="cognition-error"><div class="cognition-error-icon">⚠️</div><div class="cognition-error-message">${message}</div></div>`;
const loadingMessageHTML = (message) => `<div class="cognition-loading"><div class="cognition-spinner"></div><div class="cognition-loading-message">${message}</div></div>`;
const handleTreeEvent = async (event, handlerName, nodeId, node) => {
  event.preventDefault();
  try {
    if (handlerName === 'handleResultClick' && node.data?.url) {
      showState('Extracting page content...', 'loading');
      const result = await runtime.call('web-extractor.extractToMarkdown', { url: node.data.url });
      result.success ? renderMarkdown(result.markdown, result.title, node.data.url) : showState(`Failed to extract: ${result.error}`, 'error');
    }
  } catch (error) { showState(`Action failed: ${error.message}`, 'error'); }
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

const removeModal = () => ['#cognition-active-modal', '.cognition-overlay'].forEach(sel => document.querySelector(sel)?.remove());
const createElement = (tag, attrs = {}) => Object.assign(document.createElement(tag), attrs);
const handleKeydown = (onEnter, onEscape = removeModal) => (e) => e.key === 'Enter' ? onEnter() : e.key === 'Escape' && onEscape();
