const { getId } = globalThis.cognition;

export const manifest = {
  name: 'ui',
  version: '1.0.0',
  description: 'Provides sidebar, notifications, and modals for other modules',
  permissions: ['tabs', 'scripting', 'storage'],
  actions: ['show', 'hide', 'toggle', 'notify', 'modal'],
  state: {
    reads: ['ui.visible', 'ui.action.request'],
    writes: ['ui.visible', 'ui.content', 'ui.notify', 'ui.modal', 'ui.action.request']
  }
};

let _state, extensionTabId;
export async function initialize(state, config) {
  _state = state;
  watchUIActions();
  await initializeUIConfig(config);
  // setContentScript();
  // await createExtensionPage();
};
const initializeUIConfig = async (config) => await _state.write('ui.config', { position: config.position || 'right', size: config.size || '20%', ...config });

// Module Actions - These run in the service worker context and communicate with content scripts via state changes
export const watchUIActions = () => _state.watch('ui.action.request', (request) => _state.actions.execute(request.action, request.params));
export const show = async () => _state.write('ui.visible', true);
export const hide = async () => _state.write('ui.visible', false);
export const toggle = async () => await _state.write('ui.visible', !(await _state.read('ui.visible')));
export const notify = (params) => {
  !params?.message && (() => { throw new Error('Notification requires a message'); })();
  return _state.write('ui.notify', {
    id: getId('notif'),
    message: params.message,
    type: params.type || 'info',
    from: params.from || 'System',
    duration: params.duration || 5000,
    timestamp: Date.now(),
  }).then(() => ({ success: true }));
}
// Form stack management
const getStack = async () => await _state.read('ui.formStack') || [];
const setStack = async (stack) => await _state.write('ui.formStack', stack);
export const pushForm = async (params) => {
  (!params || typeof params !== 'object') && (() => { throw new Error("Form configuration required"); })();
  const stack = await getStack();
  const formWithId = { ...params, id: getId('form') };
  stack.push(formWithId);
  await setStack(stack);
  await show();
  return { success: true, formId: formWithId.id };
};
export const popForm = async () => {
  const stack = await getStack();
  if (stack.length === 0) return { success: false, error: 'No forms to close' };
  const removed = stack.pop();
  await setStack(stack);
  (stack.length === 0) && await hide();
  return { success: true, removedForm: removed.id };
};
export const clearForms = async () => (await setStack([]), await hide());
const validateText = (params) => !params?.text && (() => { throw new Error('Modal requires text'); })();
const createModalConfig = (params) => ({ title: params.title || 'Confirm', text: params.text, timestamp: Date.now() });
export const modal = (params) => (validateText(params), _state.write('ui.modal', createModalConfig(params)));


// const createExtensionPage = async () => {
//   const tab = await chrome.tabs.create({ url: 'extension-page.html' });
//   extensionTabId = tab.id;
// };


const createExtensionPage = async () => {
  const storedTabId = (await chrome.storage.local.get(['extensionPageTabId'])).extensionPageTabId;
  if (storedTabId) {
    try { await chrome.tabs.get(storedTabId); return; }
    catch (e) { await chrome.storage.local.remove(['extensionPageTabId']); }
  } else {
    let window = await chrome.windows.create({ url: 'extension-page.html', type: 'normal', state: 'maximized' });
    window = (window != null && window.tabs) ? window : (() => { throw new Error('Failed to create window or no tabs found'); })();
    const tabId = window?.tabs?.[0]?.id;
    if (tabId) await chrome.storage.local.set({ extensionPageTabId: tabId });
  }
};





// /*
//  * Content Script
//  */
// export let contentScript;

// const setContentScript = async () => {
//   contentScript = {
//     contentFunction,
//     css: cssFunction(await _state.read('ui.config')),
//     options: {
//       pattern: 'all',
//     }
//   };
// };
// async function contentFunction() {
//   console.log('[CognitionUI] Injecting UI content script');

//   // form
//   const escapeHtml = (str) => globalThis.cognition?.escapeHtml?.(str) || str;
//   const getElementValue = (ele) => (ele instanceof HTMLInputElement || ele instanceof HTMLSelectElement) ? ele.value : '';
//   const getFormValues = (config) => Object.fromEntries(config.fields.map(field => [field.id, getElementValue(getFieldElement(field))]));
//   const getDataset = (ele, sel) => (ele instanceof HTMLElement ? ele.closest(sel) : null).dataset || null;
//   const getFieldElement = (field) => document.getElementById(field.id) || (() => { throw new Error(`Field with id ${field.id} not found`); })();


//   const formTemplate = (config) => `
//     <div class="cog-form" data-form-id="${config.id}">
//       <h3 style="margin: 0 0 20px 0; color: #fff;">${escapeHtml(config.title)}</h3>
//       ${config.fields.map(field => inputTemplate(field)).join('')}
//       <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
//         <button class="cog-btn cog-btn-secondary" data-action="ui.popForm">Cancel</button>
//         <button class="cog-btn cog-btn-primary" data-form-submit="${config.submitAction}">Submit</button>
//       </div>
//     </div>
//   `;
//   const inputTemplate = (field) => 
//     field.type === 'select' ? fieldWrapper(field, selectInput(field)) :
//     field.type === 'text' ? fieldWrapper(field, textInput(field)) : '';
//   const fieldWrapper = (field, inputHtml) => `
//     <div style="margin-bottom: 16px;">
//       <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.9);">${escapeHtml(field.label)}</label>
//       ${inputHtml}
//     </div>
//   `;
//   const selectInput = (field) => `
//     <select id="${field.id}" data-field-id="${field.id}" class="cog-select">
//       ${(field.options || []).map(opt => `<option value="${escapeHtml(opt.value)}" ${opt.value === field.value ? 'selected' : ''}>${escapeHtml(opt.text)}</option>`).join('')}
//     </select>
//   `;
//   const textInput = (field) => `<input  type="${field.inputType || 'text'}"  id="${field.id}"  data-field-id="${field.id}"  class="cog-input"  value="${escapeHtml(field.value || '')}" ${field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : ''} ${field.required ? 'required' : ''} ${field.disabled ? 'disabled' : ''} />`;
//   // if (!stack?.length) return updateContent('');
//   const renderTopForm = (stack) => {
//     const form = stack[stack.length - 1];
//     setTimeout(() => initializeDependentFields(form), 100);
//     updateContent(formTemplate(form));
//     setupFormHandlers(form);
//   };
//   const setupFormHandlers = (config) => ( setupFieldChangeHandlers(config), setupSubmitHandler(config) );
//   const setupFieldChangeHandlers = (config) => config.fields.forEach(field => setupFieldChangeHandler(field, config));
//   const setupFieldChangeHandler = (field, config) => getFieldElement(field)?.addEventListener('change', (e) => updateDepFields(field.id, getElementValue(e.target), config));
//   const setupSubmitHandler = (config) => document.querySelector('[data-form-submit]')?.addEventListener('click', async (e) => (e.preventDefault(), submitForm(e, config)));
//   const submitForm = async (ele, config) => await state.write('ui.action.request', { action: ele.target.dataset.formSubmit, params: getFormValues(config) });
  
//   const updateDepFields = (changedId, value, config) => config.fields.filter(f => f.dependsOn == changedId).forEach(e => updateDepField(e, value));
//   // todo: update for other input elements
//   const updateDepField = (field, value) => {
//     if (field.optionsByDependency && field.optionsByDependency[value]) {
//       const newOptions = field.optionsByDependency[value];
//       setSelectOptions(getFieldElement(field), newOptions);
//       field.options = newOptions;
//     }
//   }
//   const initializeDependentFields = (config) => {
//       config.fields.filter(field => (field.dependsOn && field.optionsByDependency)).forEach(field => {
//         const dependentField = config.fields.find(f => f.id === field.dependsOn);
//         const dependentOptions = field.optionsByDependency[dependentField.value];
//         // if (dependentField.value && dependentOptions) {
//         //   field.options = dependentOptions;
//         //   setSelectOptions(getFieldElement(field), field.options || []);
//         // }
//     });
//   }
//   const setSelectOptions = (sel, opts) => sel.innerHTML = opts.map(opt => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.text)}</option>`).join('');

//   (window.__Cognition ??= {}).ui = true;
//   const modalTemplate = `
//     <div class="cog-modal-backdrop" data-action="ui.modal.close"></div>
//     <div class="cog-modal-content">
//     </div>
//   `;
  
//   const mainTemplate = `
//     <div class="cog-header">
//       <span class="cog-title">Cognition</span>
//       <button class="cog-close" data-action="ui.hide">×</button>
//     </div>
//     <div class="cog-content">
//       <div class="cog-empty">No content</div>
//     </div>
//   `;
  
//   const notificationTemplate = (data) => `
//     <div class="cog-notif-content">
//       ${data.from ? `<span class="cog-notif-from">${data.from}:</span>` : ''}
//       <span class="cog-notif-message">${data.message}</span>
//     </div>
//   `;

//   let elements = {};
//   const notifications = new Map();
//   const state = new window.ContentStore();  
//   const createElements = () => {
//     const container = Object.assign(document.createElement('div'), { id: 'cognition-container', className: 'cognition-ui', innerHTML: mainTemplate });
//     const notifications = Object.assign(document.createElement('div'), { id: 'cognition-notifications', className: 'cognition-ui' });
//     const modal = Object.assign(document.createElement('div'), { id: 'cognition-modal', className: 'cognition-ui', innerHTML: modalTemplate });
//     elements = { container, notifications, modal }
//     Object.keys(elements).forEach(el => document.body.appendChild(elements[el]));
//     elements.content = container.querySelector('.cog-content');
//     elements.modalTitle = modal.querySelector('.cog-modal-title');
//     elements.modalText = modal.querySelector('.cog-modal-text');
//   }
  
//   const setupStateListener = () => {
//     state.watch('ui.visible', (value) => value ? show() : hide());
//     state.watch('ui.content', updateContent);
//     state.watch('ui.notify', addNotification);
//     state.watch('ui.modal', showModal);
//     state.watch('ui.formStack', renderTopForm);
//   }

//   const setupActionClickHandlers = () => {
//     // document.getElementById("cognition-container")?.addEventListener('click', async (e) => {
//     //   const dataSet = getDataset(e.target, '[data-action]');
//     //   if (dataSet?.action) {
//     //     await state.write('ui.action.request', { 
//     //       action: dataSet.action, 
//     //       params: JSON.parse(dataSet.params || '{}') 
//     //     });
//     //   }
//     // });
//   }
  
//   const show = () => {
//     elements.container.classList.add('visible');
//     elements.notifications.classList.add('visible');
//   }
  
//   const hide = () => {
//     elements.container.classList.remove('visible');
//     elements.notifications.classList.remove('visible');
//     elements.modal.classList.remove('visible');
//   }
  
//   const updateContent = (html) => {
//     elements.content.innerHTML = html || '<div class="cog-empty">No content</div>';
//   }
  
//   const addNotification = (data) => {
//     const id = Date.now();
//     const notif = Object.assign(document.createElement('div'), { 
//       className: `cog-notification ${data.type || 'info'}`, 
//       innerHTML: notificationTemplate(data) 
//     });
//     elements.notifications.appendChild(notif);
//     notifications.set(id, notif);
    
//     // Animate in
//     requestAnimationFrame(() => notif.classList.add('visible'));
    
//     // Auto remove
//     setTimeout(() => {
//       notif.classList.remove('visible');
//       setTimeout(() => {
//         if (notifications.has(id)) {
//           notifications.delete(id);
//           notif.remove();
//         }
//       }, 300);
//     }, data.duration || 5000);
//   }
  
//   const showModal = async (data) => {
//     elements.modalTitle.textContent = data.title || 'Confirm';
//     elements.modalText.innerHTML = data.text;
//     elements.modal.classList.add('visible');
//     await setTimeout(async () => { await _state.remove('ui.modal'); }, 5000);
//   }
  
//   // Initialize UI
//   (async () => {
//     createElements();
//     setupStateListener();
//     setupActionClickHandlers();
//     if (await state.read('ui.visible')) show();
//   })();
// }

// // CSS generation function
// function cssFunction (config) {
//   // Position-based styles
//   const positions = {
//     right: {
//       base: 'right: 0; width: ' + config.size + '; height: 100vh; top: 0;',
//       hidden: 'transform: translateX(100%);',
//       visible: 'transform: translateX(0);',
//       border: 'border-left: 1px solid rgba(255, 255, 255, 0.1);'
//     },
//     left: {
//       base: 'left: 0; width: ' + config.size + '; height: 100vh; top: 0;',
//       hidden: 'transform: translateX(-100%);',
//       visible: 'transform: translateX(0);',
//       border: 'border-right: 1px solid rgba(255, 255, 255, 0.1);'
//     },
//     top: {
//       base: 'top: 0; height: ' + config.size + '; width: 100vw; left: 0;',
//       hidden: 'transform: translateY(-100%);',
//       visible: 'transform: translateY(0);',
//       border: 'border-bottom: 1px solid rgba(255, 255, 255, 0.1);'
//     },
//     bottom: {
//       base: 'bottom: 0; height: ' + config.size + '; width: 100vw; left: 0;',
//       hidden: 'transform: translateY(100%);',
//       visible: 'transform: translateY(0);',
//       border: 'border-top: 1px solid rgba(255, 255, 255, 0.1);'
//     }
//   };
  
//   const pos = positions[config.position] || positions.right;
  
//   return `
//     /* Base styles */
//     .cognition-ui {
//       font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
//       font-size: 14px;
//       line-height: 1.5;
//       color: #fff;
//       box-sizing: border-box;
//     }
    
//     .cognition-ui * {
//       box-sizing: border-box;
//     }
    
//     /* Container */
//     #cognition-container {
//       position: fixed;
//       ${pos.base}
//       ${pos.border}
//       background: rgba(17, 17, 27, 0.6);
//       backdrop-filter: blur(10px);
//       transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
//       z-index: 999998;
//       overflow-y: auto;
//       box-shadow: 0 0 20px rgba(0, 0, 0, 0.3);
//       ${pos.hidden}
//     }
    
//     #cognition-container.visible {
//       ${pos.visible}
//     }
    
//     .cog-header {
//       padding: 16px 20px;
//       border-bottom: 1px solid rgba(255, 255, 255, 0.1);
//       display: flex;
//       align-items: center;
//       justify-content: space-between;
//     }
    
//     .cog-title {
//       font-size: 16px;
//       font-weight: 600;
//       background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
//       -webkit-background-clip: text;
//       -webkit-text-fill-color: transparent;
//       background-clip: text;
//     }
    
//     .cog-close {
//       width: 32px;
//       height: 32px;
//       border: none;
//       background: none;
//       color: rgba(255, 255, 255, 0.6);
//       cursor: pointer;
//       font-size: 24px;
//       display: flex;
//       align-items: center;
//       justify-content: center;
//       border-radius: 4px;
//       transition: all 0.2s;
//     }
    
//     .cog-close:hover {
//       color: #fff;
//       background: rgba(255, 255, 255, 0.1);
//     }
    
//     .cog-content {
//       padding: 20px;
//     }
    
//     .cog-empty {
//       color: rgba(255, 255, 255, 0.4);
//       text-align: center;
//       padding: 40px 20px;
//     }
    
//     /* Notifications */
//     #cognition-notifications {
//       position: fixed;
//       top: 20px;
//       right: 20px;
//       z-index: 999999;
//       pointer-events: none;
//       display: none;
//     }
    
//     #cognition-notifications.visible {
//       display: block;
//     }
    
//     .cog-notification {
//       background: rgba(17, 17, 27, 0.6);
//       backdrop-filter: blur(10px);
//       border: 1px solid rgba(255, 255, 255, 0.1);
//       border-radius: 8px;
//       padding: 12px 16px;
//       margin-bottom: 10px;
//       min-width: 300px;
//       box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
//       transform: translateX(120%);
//       transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
//       pointer-events: auto;
//     }
    
//     .cog-notification.visible {
//       transform: translateX(0);
//     }
    
//     .cog-notification.success {
//       border-color: rgba(16, 185, 129, 0.5);
//     }
    
//     .cog-notification.error {
//       border-color: rgba(239, 68, 68, 0.5);
//     }
    
//     .cog-notification.info {
//       border-color: rgba(59, 130, 246, 0.5);
//     }
    
//     .cog-notif-from {
//       font-size: 12px;
//       color: rgba(255, 255, 255, 0.5);
//       margin-right: 8px;
//     }
    
//     /* Modal */
//     #cognition-modal {
//       position: fixed;
//       top: 0;
//       left: 0;
//       width: 100vw;
//       height: 100vh;
//       z-index: 999999;
//       display: none;
//     }
    
//     #cognition-modal.visible {
//       display: block;
//     }
    
//     .cog-modal-backdrop {
//       position: absolute;
//       inset: 0;
//       background: rgba(0, 0, 0, 0.5);
//       backdrop-filter: blur(4px);
//       cursor: pointer;
//     }
    
//     .cog-modal-content {
//       position: absolute;
//       top: 50%;
//       left: 50%;
//       transform: translate(-50%, -50%);
//       background: rgba(17, 17, 27, 0.6);
//       border: 1px solid rgba(255, 255, 255, 0.1);
//       border-radius: 12px;
//       padding: 24px;
//       min-width: 400px;
//       max-width: 90vw;
//       box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
//     }
    
//     .cog-modal-title {
//       margin: 0 0 12px 0;
//       font-size: 18px;
//       font-weight: 600;
//     }
    
//     .cog-modal-text {
//       margin: 0 0 24px 0;
//       color: rgba(255, 255, 255, 0.8);
//       line-height: 1.6;
//     }
    
//     .cog-modal-buttons {
//       display: flex;
//       gap: 12px;
//       justify-content: flex-end;
//     }
    
//     .cog-modal-btn {
//       padding: 8px 24px;
//       border: 1px solid rgba(255, 255, 255, 0.2);
//       background: none;
//       color: #fff;
//       border-radius: 6px;
//       cursor: pointer;
//       font-size: 14px;
//       transition: all 0.2s;
//     }
    
//     .cog-modal-btn:hover {
//       background: rgba(255, 255, 255, 0.1);
//       border-color: rgba(255, 255, 255, 0.3);
//     }
    
//     .cog-modal-btn[data-modal-response="true"] {
//       background: rgba(99, 102, 241, 0.2);
//       border-color: rgba(99, 102, 241, 0.5);
//     }
    
//     .cog-modal-btn[data-modal-response="true"]:hover {
//       background: rgba(99, 102, 241, 0.3);
//       border-color: rgba(99, 102, 241, 0.7);
//     }
    
//     /* Mobile adjustments */
//     @media (max-width: 768px) {
//       #cognition-container {
//         width: 100% !important;
//       }
      
//       .cog-modal-content {
//         min-width: 90vw;
//         padding: 20px;
//       }
//     }

//     /* Form styles */  
//     .cog-form { padding: 20px; }
//     .cog-select {
//       width: 100%;
//       padding: 8px 12px;
//       background: rgba(255,255,255,0.1);
//       border: 1px solid rgba(255,255,255,0.2);
//       border-radius: 6px;
//       color: #fff;
//       font-size: 14px;
//       outline: none;
//     }
//     .cog-select:focus {
//       border-color: rgba(99,102,241,0.6);
//       background: rgba(255,255,255,0.15);
//     }
//     .cog-btn {
//       padding: 8px 24px;
//       border-radius: 6px;
//       cursor: pointer;
//       font-size: 14px;
//       transition: all 0.2s;
//       border: 1px solid;
//     }
//     .cog-btn-primary {
//       background: rgba(99,102,241,0.2);
//       border-color: rgba(99,102,241,0.5);
//       color: #fff;
//     }
//     .cog-btn-primary:hover {
//       background: rgba(99,102,241,0.3);
//       border-color: rgba(99,102,241,0.7);
//     }
//     .cog-btn-secondary {
//       background: none;
//       border-color: rgba(255,255,255,0.2);
//       color: #fff;
//     }
//     .cog-btn-secondary:hover {
//       background: rgba(255,255,255,0.1);
//       border-color: rgba(255,255,255,0.3);
//     }
//     .cog-input {
//       width: 100%;
//       padding: 8px 12px;
//       background: rgba(255,255,255,0.1);
//       border: 1px solid rgba(255,255,255,0.2);
//       border-radius: 6px;
//       color: #fff;
//       font-size: 14px;
//       outline: none;
//     }
//     .cog-input:focus {
//       border-color: rgba(99,102,241,0.6);
//       background: rgba(255,255,255,0.15);
//     }
//     .cog-input::placeholder {
//       color: rgba(255,255,255,0.4);
//     }
//     .cog-input:disabled {
//       opacity: 0.5;
//       cursor: not-allowed;
//     }
//   `;
// }