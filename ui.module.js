// ui-module.js - UI overlay system for displaying module content
export const manifest = {
  name: 'UI Overlay',
  version: '1.0.0',
  description: 'Provides sidebar, notifications, and modals for other modules',
  permissions: ['tabs', 'scripting', 'storage'],
  actions: ['show', 'hide', 'toggle', 'notify', 'modal'],
  state: {
    reads: ['ui.visible'],
    writes: ['ui.visible', 'ui.content', 'ui.notify', 'ui.modal']
  }
};

// Module initialization - injects UI into tabs
// Store state reference for use in event listeners
let globalStateRef = null;

export async function initialize(state, config) {
  globalStateRef = state;
  await initializeUIConfig(state, config);
  await injectUIIntoExistingTabs(state);
  // Handle new tabs
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id) {
      setTimeout(() => injectUI(globalStateRef, tab.id), 100);
    }
  });
  // Handle navigation
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
      injectUI(globalStateRef, tabId);
    }
  });
}
const initializeUIConfig = async (state, config) => {
  const uiConfig = { position: config.position || 'right', size: config.size || '20%', ...config };
  await state.write('ui.config', uiConfig);
};
const injectUIIntoExistingTabs = async (state) => await Promise.all([... await chrome.tabs.query({})].map(async (tab) => await injectUI(globalStateRef, tab.id)));
const shouldInjectIntoTab = (tab) => tab.url && !['chrome://', 'chrome-extension://', 'edge://', 'about:', 'file:///', 'view-source:', 'chrome-devtools://'].some(pattern => tab.url.startsWith(pattern));
const injectContentScript = async (tabId) => await chrome.scripting.executeScript({ target: { tabId }, func: contentScriptCode, world: 'ISOLATED' });
const injectCSS = async (state, tabId) => await chrome.scripting.insertCSS({ target: { tabId }, css: await generateCSS(state) });

async function injectUI(state, tabId) {
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find(t => t.id === tabId);
  if (!shouldInjectIntoTab(tab)) return;
  
  try {
    await injectContentScript(tabId);
    await injectCSS(state, tabId);
  } catch (e) {
    // Silently skip error pages, chrome:// pages, etc.
    if (!e.message.includes('Cannot access') && !e.message.includes('error page')) {
      console.error(`[UI Module] Failed to inject into tab ${tabId}:`, e);
    }
  }
}

// Module Actions - These run in the service worker context and communicate with content scripts via state changes
export const show = state => state.write('ui.visible', true).then(() => ({ success: true }));
export const hide = state => state.write('ui.visible', false).then(() => ({ success: true }));
export const toggle = async state => {
  const currentValue = await state.read('ui.visible');
  const newValue = !currentValue;
  await state.write('ui.visible', newValue);
  return { success: true, value: newValue };
};

export const notify = (state, params) => {
  if (!params?.message) {
    return { success: false, error: 'Notification requires a message' };
  }
  return state.write('ui.notify', {
    id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    message: params.message,
    type: params.type || 'info',
    from: params.from || 'System',
    duration: params.duration || 5000,
    timestamp: Date.now(),
  }).then(() => ({ success: true }));
}

export const modal = (state, params) => {
  if (!params?.text) {
    return { success: false, error: 'Modal requires text' };
  }
  return state.write('ui.modal', {
    title: params.title || 'Confirm',
    text: params.text,
    responseAction: params.responseAction || '',
    timestamp: Date.now()
  }).then(() => ({ success: true }));
}



/*
 * Content Script Code - Runs in the context of the page
 */
function contentScriptCode() {
  // Prevent re-injection
  if (window.__cognitionUI) return;
  
  const ui = {
    elements: {},
    notifications: new Map(),
    config: {},
    
    async init() {
      // Get config from state via messaging
      const configResult = await chrome.runtime.sendMessage({ type: 'EXECUTE_ACTION', action: 'state.read', params: { key: 'ui.config' } });
      this.config = configResult.result || {};
      
      this.createElements();
      this.setupStateListener();
      this.setupClickHandlers();
      
      // Check if UI should be visible
      const visibleResult = await chrome.runtime.sendMessage({ type: 'EXECUTE_ACTION', action: 'state.read', params: { key: 'ui.visible' } });
      if (visibleResult.result) {
        this.show();
      }
      window.__cognitionUI = this; // Mark as initialized
    },
    
    createElements() {
      // Main container
      const container = document.createElement('div');
      container.id = 'cognition-container';
      container.className = 'cognition-ui';
      container.innerHTML = `
        <div class="cog-header">
          <span class="cog-title">Cognition</span>
          <button class="cog-close" data-action="ui.hide">×</button>
        </div>
        <div class="cog-content">
          <div class="cog-empty">No content</div>
        </div>
      `;
      
      // Notifications container
      const notifications = document.createElement('div');
      notifications.id = 'cognition-notifications';
      notifications.className = 'cognition-ui';
      
      // Modal
      const modal = document.createElement('div');
      modal.id = 'cognition-modal';
      modal.className = 'cognition-ui';
      modal.innerHTML = `
        <div class="cog-modal-backdrop" data-action="ui.modal.close"></div>
        <div class="cog-modal-content">
          <h3 class="cog-modal-title"></h3>
          <p class="cog-modal-text"></p>
          <div class="cog-modal-buttons">
            <button class="cog-modal-btn" data-modal-response="true">Yes</button>
            <button class="cog-modal-btn" data-modal-response="false">No</button>
          </div>
        </div>
      `;
      
      // Store references
      this.elements = {
        container,
        notifications,
        modal,
        content: container.querySelector('.cog-content'),
        modalTitle: modal.querySelector('.cog-modal-title'),
        modalText: modal.querySelector('.cog-modal-text')
      };
      
      // Add to page
      document.body.appendChild(container);
      document.body.appendChild(notifications);
      document.body.appendChild(modal);
    },
    
    setupStateListener() {
      // Listen to state changes via BroadcastChannel
      const channel = new BroadcastChannel('cognition-state');
      
      channel.onmessage = (event) => {
        const { key, value } = event.data;
        
        // Handle state changes based on key
        switch(key) {
          case 'ui.visible':
            if (value) this.show();
            else this.hide();
            break;
            
          case 'ui.content':
            this.updateContent(value);
            break;
            
          case 'ui.notify':
            if (value && value.message) {
              this.addNotification(value);
            }
            break;
            
          case 'ui.modal':
            if (value) {
              this.showModal(value);
            }
            break;
        }
      };
      
      this.channel = channel;
    },
    
    setupClickHandlers() {
      document.addEventListener('click', (e) => {
        // Handle data-action clicks
        const actionEl = e.target.closest('[data-action]');
        if (actionEl) {
          const action = actionEl.dataset.action;
          // Handle UI-specific actions locally
          if (action === 'ui.hide') {
            this.hide();
            // Also update state so service worker knows
            this.updateState('ui.visible', false);
          } else if (action === 'ui.modal.close') {
            this.hideModal();
          } else {
            // Other actions go to state for modules to handle
            const params = actionEl.dataset.params ? JSON.parse(actionEl.dataset.params) : {};
            this.updateState('ui.action.request', { action, params });
          }
        }
        // Handle modal responses
        const responseEl = e.target.closest('[data-modal-response]');
        if (responseEl) {
          this.handleModalResponse(responseEl.dataset.modalResponse === 'true');
        }
      });
    },
    
    // Helper to update state from content script
    async updateState(key, value) {
      // Update state via messaging to background script
      await chrome.runtime.sendMessage({ type: 'EXECUTE_ACTION', action: 'state.write', params: { key, value } });
    },
    
    show() {
      this.elements.container.classList.add('visible');
      this.elements.notifications.classList.add('visible');
    },
    
    hide() {
      this.elements.container.classList.remove('visible');
      this.elements.notifications.classList.remove('visible');
      this.elements.modal.classList.remove('visible');
    },
    
    updateContent(html) {
      if (!html) {
        this.elements.content.innerHTML = '<div class="cog-empty">No content</div>';
      } else {
        this.elements.content.innerHTML = html;
      }
    },
    
    addNotification(data) {
      const notif = document.createElement('div');
      notif.className = `cog-notification ${data.type || 'info'}`;
      notif.innerHTML = `
        <div class="cog-notif-content">
          ${data.from ? `<span class="cog-notif-from">${data.from}:</span>` : ''}
          <span class="cog-notif-message">${data.message}</span>
        </div>
      `;
      
      this.elements.notifications.appendChild(notif);
      const id = Date.now();
      this.notifications.set(id, notif);
      
      // Animate in
      requestAnimationFrame(() => notif.classList.add('visible'));
      
      // Auto remove
      setTimeout(() => {
        notif.classList.remove('visible');
        setTimeout(() => {
          if (this.notifications.has(id)) {
            this.notifications.delete(id);
            notif.remove();
          }
        }, 300);
      }, data.duration || 5000);
    },
    
    showModal(data) {
      this.elements.modalTitle.textContent = data.title || 'Confirm';
      this.elements.modalText.textContent = data.text;
      this.elements.modal.dataset.responseAction = data.responseAction || '';
      this.elements.modal.classList.add('visible');
    },
    
    hideModal() {
      this.elements.modal.classList.remove('visible');
      delete this.elements.modal.dataset.responseAction;
    },
    
    handleModalResponse(confirmed) {
      const responseAction = this.elements.modal.dataset.responseAction;
      this.hideModal();
      if (responseAction) {
        this.updateState(responseAction, { confirmed });
      }
    }
  };
  
  // Initialize
  ui.init();
}

// CSS generation function
async function generateCSS(state) {
  const config = await state.read('ui.config') || {};
  
  // Position-based styles
  const positions = {
    right: {
      base: 'right: 0; width: ' + config.size + '; height: 100vh; top: 0;',
      hidden: 'transform: translateX(100%);',
      visible: 'transform: translateX(0);',
      border: 'border-left: 1px solid rgba(255, 255, 255, 0.1);'
    },
    left: {
      base: 'left: 0; width: ' + config.size + '; height: 100vh; top: 0;',
      hidden: 'transform: translateX(-100%);',
      visible: 'transform: translateX(0);',
      border: 'border-right: 1px solid rgba(255, 255, 255, 0.1);'
    },
    top: {
      base: 'top: 0; height: ' + config.size + '; width: 100vw; left: 0;',
      hidden: 'transform: translateY(-100%);',
      visible: 'transform: translateY(0);',
      border: 'border-bottom: 1px solid rgba(255, 255, 255, 0.1);'
    },
    bottom: {
      base: 'bottom: 0; height: ' + config.size + '; width: 100vw; left: 0;',
      hidden: 'transform: translateY(100%);',
      visible: 'transform: translateY(0);',
      border: 'border-top: 1px solid rgba(255, 255, 255, 0.1);'
    }
  };
  
  const pos = positions[config.position] || positions.right;
  
  return `
    /* Base styles */
    .cognition-ui {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #fff;
      box-sizing: border-box;
    }
    
    .cognition-ui * {
      box-sizing: border-box;
    }
    
    /* Container */
    #cognition-container {
      position: fixed;
      ${pos.base}
      ${pos.border}
      background: rgba(17, 17, 27, 0.6);
      backdrop-filter: blur(10px);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 999998;
      overflow-y: auto;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.3);
      ${pos.hidden}
    }
    
    #cognition-container.visible {
      ${pos.visible}
    }
    
    .cog-header {
      padding: 16px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    
    .cog-title {
      font-size: 16px;
      font-weight: 600;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .cog-close {
      width: 32px;
      height: 32px;
      border: none;
      background: none;
      color: rgba(255, 255, 255, 0.6);
      cursor: pointer;
      font-size: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s;
    }
    
    .cog-close:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.1);
    }
    
    .cog-content {
      padding: 20px;
    }
    
    .cog-empty {
      color: rgba(255, 255, 255, 0.4);
      text-align: center;
      padding: 40px 20px;
    }
    
    /* Notifications */
    #cognition-notifications {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 999999;
      pointer-events: none;
      display: none;
    }
    
    #cognition-notifications.visible {
      display: block;
    }
    
    .cog-notification {
      background: rgba(17, 17, 27, 0.6);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 10px;
      min-width: 300px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      transform: translateX(120%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      pointer-events: auto;
    }
    
    .cog-notification.visible {
      transform: translateX(0);
    }
    
    .cog-notification.success {
      border-color: rgba(16, 185, 129, 0.5);
    }
    
    .cog-notification.error {
      border-color: rgba(239, 68, 68, 0.5);
    }
    
    .cog-notification.info {
      border-color: rgba(59, 130, 246, 0.5);
    }
    
    .cog-notif-from {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.5);
      margin-right: 8px;
    }
    
    /* Modal */
    #cognition-modal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 999999;
      display: none;
    }
    
    #cognition-modal.visible {
      display: block;
    }
    
    .cog-modal-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
      cursor: pointer;
    }
    
    .cog-modal-content {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(17, 17, 27, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 24px;
      min-width: 400px;
      max-width: 90vw;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    }
    
    .cog-modal-title {
      margin: 0 0 12px 0;
      font-size: 18px;
      font-weight: 600;
    }
    
    .cog-modal-text {
      margin: 0 0 24px 0;
      color: rgba(255, 255, 255, 0.8);
      line-height: 1.6;
    }
    
    .cog-modal-buttons {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
    
    .cog-modal-btn {
      padding: 8px 24px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      background: none;
      color: #fff;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    }
    
    .cog-modal-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.3);
    }
    
    .cog-modal-btn[data-modal-response="true"] {
      background: rgba(99, 102, 241, 0.2);
      border-color: rgba(99, 102, 241, 0.5);
    }
    
    .cog-modal-btn[data-modal-response="true"]:hover {
      background: rgba(99, 102, 241, 0.3);
      border-color: rgba(99, 102, 241, 0.7);
    }
    
    /* Mobile adjustments */
    @media (max-width: 768px) {
      #cognition-container {
        width: 100% !important;
      }
      
      .cog-modal-content {
        min-width: 90vw;
        padding: 20px;
      }
    }
  `;
}

/*
  manual testing

*/

// Tests
export const tests = [
  {
    name: 'module exports all expected actions',
    fn: async () => {
      assert(typeof show === 'function');
      assert(typeof hide === 'function');
      assert(typeof toggle === 'function');
      assert(typeof notify === 'function');
      assert(typeof modal === 'function');
    }
  },
  {
    name: 'notify validates parameters',
    fn: async () => {
      const mockState = createMockState();
      
      // Should fail without message
      const result1 = await notify(mockState, {});
      assert(result1.success === false);
      assert(result1.error.includes('message'));
      
      // Should succeed with message
      const result2 = await notify(mockState, { message: 'Test' });
      assert(result2.success === true);
      
      // Check state was written
      const notification = await mockState.read('ui.notify');
      assert(notification.message === 'Test');
      assert(notification.type === 'info'); // default
      assert(notification.id.startsWith('notif_'));
    }
  },
  {
    name: 'modal validates parameters',
    fn: async () => {
      const mockState = createMockState();
      
      // Should fail without text
      const result1 = await modal(mockState, {});
      assert(result1.success === false);
      
      // Should succeed with text
      const result2 = await modal(mockState, { text: 'Confirm?' });
      assert(result2.success === true);
      
      const modalData = await mockState.read('ui.modal');
      assert(modalData.text === 'Confirm?');
      assert(modalData.title === 'Confirm'); // default
    }
  }
];

// Mock state helper for testing
function createMockState() {
  const data = {};
  return {
    async read(key) { return data[key]; },
    async write(key, value) { data[key] = value; }
  };
}

// Simple assertion helper
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}