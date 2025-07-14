// ui-module.js - UI overlay system for displaying module content

export const manifest = {
  name: 'UI Overlay',
  version: '1.0.0',
  description: 'Provides sidebar, notifications, and modals for other modules',
  permissions: ['tabs', 'scripting', 'storage'],
  actions: ['show', 'hide', 'toggle', 'notify', 'modal']
};

let stateChannel = null;

export async function initialize(state, config) {
  // Get the state channel from initialization
  stateChannel = state.channel || new BroadcastChannel('cognition-state');
  
  // Store config for content scripts to read
  const uiConfig = {
    position: config.position || 'right',
    size: config.size || '20%',
    ...config
  };
  await chrome.storage.local.set({ uiConfig });
  
  // Inject into existing tabs
  const tabs = await chrome.tabs.query({});
  tabs.forEach(tab => {
    if (shouldInjectIntoTab(tab)) {
      injectUI(tab.id);
    }
  });
  
  // Handle new tabs
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id && shouldInjectIntoTab(tab)) {
      setTimeout(() => injectUI(tab.id), 100);
    }
  });
  
  // Handle navigation
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && shouldInjectIntoTab(tab)) {
      injectUI(tabId);
    }
  });
}

function shouldInjectIntoTab(tab) {
  return tab.url && 
         !tab.url.startsWith('chrome://') && 
         !tab.url.startsWith('edge://') &&
         !tab.url.startsWith('about:');
}

async function injectUI(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: contentScriptCode,
      world: 'ISOLATED'
    });
    
    await chrome.scripting.insertCSS({
      target: { tabId },
      css: await generateStyles()
    });
  } catch (e) {
    // Tab might be restricted, ignore silently
  }
}

// This entire function runs in the page context
function contentScriptCode() {
  // Prevent re-injection
  if (window.__cognitionUI) return;
  
  const ui = {
    elements: {},
    notifications: new Map(),
    config: {},
    
    async init() {
      // Load config
      const stored = await chrome.storage.local.get(['uiConfig', 'uiVisible']);
      this.config = stored.uiConfig || {};
      
      // Create UI elements
      this.createElements();
      
      // Set up listeners
      this.setupStateListener();
      this.setupClickHandlers();
      
      // Apply initial visibility
      if (stored.uiVisible) {
        this.show();
      }
      
      // Mark as initialized
      window.__cognitionUI = this;
    },
    
    createElements() {
      // Main container
      const container = this.createElement('div', {
        id: 'cognition-container',
        className: 'cognition-ui',
        innerHTML: `
          <div class="cog-header">
            <span class="cog-title">Cognition</span>
            <button class="cog-close" data-action="ui.hide">×</button>
          </div>
          <div class="cog-content"></div>
        `
      });
      
      // Notifications container
      const notifications = this.createElement('div', {
        id: 'cognition-notifications',
        className: 'cognition-ui'
      });
      
      // Modal
      const modal = this.createElement('div', {
        id: 'cognition-modal',
        className: 'cognition-ui',
        innerHTML: `
          <div class="cog-modal-backdrop" data-action="ui.modal.close"></div>
          <div class="cog-modal-content">
            <h3 class="cog-modal-title"></h3>
            <p class="cog-modal-text"></p>
            <div class="cog-modal-buttons">
              <button class="cog-modal-btn" data-modal-response="true">Yes</button>
              <button class="cog-modal-btn" data-modal-response="false">No</button>
            </div>
          </div>
        `
      });
      
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
      document.body.append(container, notifications, modal);
    },
    
    createElement(tag, props) {
      const el = document.createElement(tag);
      Object.assign(el, props);
      return el;
    },
    
    setupStateListener() {
      // Use the existing state channel
      const channel = new BroadcastChannel('cognition-state');
      this.channel = channel;
      
      channel.onmessage = (event) => {
        const { type, path, value } = event.data;
        if (type !== 'STATE_UPDATE') return;
        
        // Simple path-based routing
        const handlers = {
          'ui.visible': () => value ? this.show() : this.hide(),
          'ui.content': () => this.updateContent(value),
          'ui.notify': () => this.addNotification(value),
          'ui.modal': () => this.showModal(value)
        };
        
        const handler = handlers[path];
        if (handler) handler();
      };
    },
    
    setupClickHandlers() {
      document.addEventListener('click', (e) => {
        // Handle data-action clicks
        const actionEl = e.target.closest('[data-action]');
        if (actionEl) {
          this.handleAction(actionEl.dataset.action, actionEl.dataset.params);
        }
        
        // Handle modal responses
        const responseEl = e.target.closest('[data-modal-response]');
        if (responseEl) {
          this.handleModalResponse(responseEl.dataset.modalResponse === 'true');
        }
      });
    },
    
    handleAction(action, params) {
      // UI-specific actions handled locally
      if (action === 'ui.hide') {
        this.channel.postMessage({
          type: 'STATE_UPDATE',
          path: 'ui.visible',
          value: false
        });
        return;
      }
      
      if (action === 'ui.modal.close') {
        this.hideModal();
        return;
      }
      
      // All other actions go to state for modules to handle
      this.channel.postMessage({
        type: 'STATE_UPDATE',
        path: 'ui.action.request',
        value: {
          action,
          params: params ? JSON.parse(params) : {},
          timestamp: Date.now()
        }
      });
    },
    
    handleModalResponse(confirmed) {
      const modalData = this.elements.modal.dataset;
      
      this.hideModal();
      
      if (modalData.responseAction) {
        this.channel.postMessage({
          type: 'STATE_UPDATE',
          path: modalData.responseAction,
          value: { confirmed, timestamp: Date.now() }
        });
      }
    },
    
    show() {
      this.elements.container.classList.add('visible');
      this.elements.notifications.classList.add('visible');
      chrome.storage.local.set({ uiVisible: true });
    },
    
    hide() {
      this.elements.container.classList.remove('visible');
      this.elements.notifications.classList.remove('visible');
      this.elements.modal.classList.remove('visible');
      chrome.storage.local.set({ uiVisible: false });
    },
    
    updateContent(html) {
      this.elements.content.innerHTML = html || '<div class="cog-empty">No content</div>';
    },
    
    addNotification(data) {
      if (!data?.message) return;
      
      const id = Date.now();
      const notif = this.createElement('div', {
        className: `cog-notification ${data.type || 'info'}`,
        innerHTML: `
          <div class="cog-notif-content">
            ${data.from ? `<span class="cog-notif-from">${data.from}</span>` : ''}
            <span class="cog-notif-message">${data.message}</span>
          </div>
        `
      });
      
      this.elements.notifications.appendChild(notif);
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
      if (!data?.text) {
        this.hideModal();
        return;
      }
      
      this.elements.modalTitle.textContent = data.title || 'Confirm';
      this.elements.modalText.textContent = data.text;
      this.elements.modal.dataset.responseAction = data.responseAction || '';
      this.elements.modal.classList.add('visible');
    },
    
    hideModal() {
      this.elements.modal.classList.remove('visible');
      delete this.elements.modal.dataset.responseAction;
    }
  };
  
  // Initialize
  ui.init();
}

// UI Module Actions (exportable for voice commands)
export async function show() {
  stateChannel.postMessage({
    type: 'STATE_UPDATE',
    path: 'ui.visible',
    value: true
  });
  return { success: true };
}

export async function hide() {
  stateChannel.postMessage({
    type: 'STATE_UPDATE',
    path: 'ui.visible',
    value: false
  });
  return { success: true };
}

export async function toggle() {
  const { state } = await chrome.storage.local.get(['state']);
  const visible = state?.['ui.visible'] || false;
  stateChannel.postMessage({
    type: 'STATE_UPDATE',
    path: 'ui.visible',
    value: !visible
  });
  return { visible: !visible };
}

export async function notify(params) {
  stateChannel.postMessage({
    type: 'STATE_UPDATE',
    path: 'ui.notify',
    value: params
  });
  return { success: true };
}

export async function modal(params) {
  stateChannel.postMessage({
    type: 'STATE_UPDATE',
    path: 'ui.modal',
    value: params
  });
  return { success: true };
}

// Dynamic style generation based on config
async function generateStyles() {
  const { uiConfig } = await chrome.storage.local.get(['uiConfig']);
  const config = uiConfig || {};
  
  // Position-based styles
  const positions = {
    right: `
      right: -${parseInt(config.size) + 1}%;
      width: ${config.size};
      height: 100vh;
      top: 0;
      border-left: 1px solid rgba(255, 255, 255, 0.1);
    `,
    left: `
      left: -${parseInt(config.size) + 1}%;
      width: ${config.size};
      height: 100vh;
      top: 0;
      border-right: 1px solid rgba(255, 255, 255, 0.1);
    `,
    top: `
      top: -${parseInt(config.size) + 1}%;
      height: ${config.size};
      width: 100vw;
      left: 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    `,
    bottom: `
      bottom: -${parseInt(config.size) + 1}%;
      height: ${config.size};
      width: 100vw;
      left: 0;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    `
  };
  
  const positionStyle = positions[config.position] || positions.right;
  const visibleTransform = config.position === 'left' ? 'left: 0;' :
                          config.position === 'right' ? 'right: 0;' :
                          config.position === 'top' ? 'top: 0;' :
                          'bottom: 0;';
  
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
    
    /* Container with dynamic positioning */
    #cognition-container {
      position: fixed;
      ${positionStyle}
      background: rgba(17, 17, 27, 0.85);
      backdrop-filter: blur(10px);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 999998;
      overflow-y: auto;
      box-shadow: 0 0 20px rgba(0, 0, 0, 0.3);
    }
    
    #cognition-container.visible {
      ${visibleTransform}
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
      background: rgba(17, 17, 27, 0.95);
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
      background: rgba(17, 17, 27, 0.98);
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
      #cognition-container[style*="width"] {
        width: 100% !important;
      }
      
      .cog-modal-content {
        min-width: 90vw;
        padding: 20px;
      }
    }
  `;
}

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
    name: 'generates position-based styles correctly',
    fn: async () => {
      global.chrome = {
        storage: {
          local: {
            get: async () => ({
              uiConfig: { position: 'left', size: '30%' }
            })
          }
        }
      };
      
      const styles = await generateStyles();
      assert(styles.includes('left: -31%'));
      assert(styles.includes('width: 30%'));
      assert(styles.includes('left: 0;')); // visible position
    }
  },
  {
    name: 'actions use state channel correctly',
    fn: async () => {
      let messageSent = null;
      stateChannel = {
        postMessage: (msg) => { messageSent = msg; }
      };
      
      await show();
      assert(messageSent.path === 'ui.visible');
      assert(messageSent.value === true);
      
      await notify({ message: 'Test', type: 'info' });
      assert(messageSent.path === 'ui.notify');
      assert(messageSent.value.message === 'Test');
    }
  }
];