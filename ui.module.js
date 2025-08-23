export const manifest = {
    name: 'ui',
    version: '1.0.0',
    context: ['extension-page'],
    description: 'Extension page layout and tree orchestration',
    dependencies: ['tree-to-dom'],
    actions: ['initializeLayout', 'renderTree', 'showTTSControls', 'handleSearchKeydown', 'showModal', 'closeModal', 'updateModal', 'updatePrompt', 'clearPrompt', 'toggleListening', 'speakPrompt'],
};
let runtime;
export const initialize = async (rt) => {
    runtime = rt;
    await initializeLayout();
};

export const initializeLayout = async () => {
    getMainLayout()?.remove();
    const layoutTree = {
        "main-layout": {
            tag: "div", id: MAIN_LAYOUT_ID,
            "main-content": { tag: "div", id: MAIN_CONTENT_ID, innerHTML: loadingHTML("Enter a search query to begin") },
            "search-bar": {
            tag: "div", id: "cognition-search-bar", style: "position: relative; display: flex; align-items: center; gap: 10px;",
            "search-input": { tag: "input", id: SEARCH_INPUT_ID, type: "text", placeholder: "Search the web...", events: { keydown: "ui.handleSearchKeydown" }, style: "flex: 1;" },
            "button-group": {   
                tag: "div", style: "display: flex; gap: 8px;",
                "settings-button": { tag: "button", text: "⚙️", class: "cognition-button-secondary", style: "min-width: 40px; height: 40px; border-radius: 50%; font-size: 16px;", events: { click: "ui.showTTSControls" } },
                "speech-button": { tag: "button", id: "speech-button", text: "🔊", class: "cognition-button-secondary", style: "min-width: 40px; height: 40px; border-radius: 50%; font-size: 18px;", events: { click: "ui.speakPrompt" } },
                "mic-button": { tag: "button", id: "mic-button", text: "🎤", class: "cognition-button-secondary", style: "min-width: 40px; height: 40px; border-radius: 50%; font-size: 18px;", events: { click: "ui.toggleListening" } }
            }
            }
        }
    };
    await runtime.call('tree-to-dom.transform', layoutTree, document.body);
    getSearchInput()?.focus();
};
export const handleSearchKeydown = async (event) => {
    if (event.key === 'Enter' && event.target.value.trim()) {
        showState('Searching...', 'loading');
        try {
            const tree = await runtime.call('web-search.getSearchTree', event.target.value.trim());
            await renderTree(tree);
        }
        catch (error) { showState(`Search failed: ${error.message}`, 'error'); }
    }
};
const getMicButton = () => document.querySelector('#mic-button') ?? (() => { throw new Error('Mic button not found'); })();
export const toggleListening = async () => {
    const status = await runtime.call('web-speech-stt.getStatus');
    const button = getMicButton();

    if (status.isListening) {
        await runtime.call('web-speech-stt.stopListening');
        button.textContent = '🎤';
        button["style"].background = '';
    } else {
        await runtime.call('web-speech-stt.startListening');
        button.textContent = '🔴';
        button["style"].background = 'rgba(255, 0, 0, 0.1)';
    }
};
const getSpeechButton = () => document.querySelector('#speech-button') ?? (() => { throw new Error('Speech button not found'); })();
export const speakPrompt = async () => {
  const text = getSearchInput()?.value?.trim();
  if (!text) return;
  
  const button = getSpeechButton();
  button.textContent = '⏳';
  
  try {
    const settings = await runtime.call('web-speech-tts.getSettings');
    const result = await runtime.call('tts.speak', text, settings);
    if (!result.success) runtime.logError('[UI] TTS failed:', result.error);
  } catch (error) {
    runtime.logError('[UI] TTS error:', error);
  } finally {
    button.textContent = '🔊';
  }
};

export const showTTSControls = async () => {
  const settings = await runtime.call('web-speech-tts.getSettings');
  
  const controlsTree = {
    "tts-controls-form": {
      tag: "form",
      events: { submit: "web-speech-tts.saveSettings" },
      "rate-control": {
        tag: "div", class: "control-group",
        "rate-label": { tag: "label", text: "Speed:" },
        "rate-slider": { tag: "input", type: "range", name: "rate", min: "0.5", max: "3", step: "0.1", value: settings.rate },
        "rate-value": { tag: "span", text: settings.rate, class: "value-display" }
      },
      "pitch-control": {
        tag: "div", class: "control-group",
        "pitch-label": { tag: "label", text: "Pitch:" },
        "pitch-slider": { tag: "input", type: "range", name: "pitch", min: "0.5", max: "2", step: "0.1", value: settings.pitch },
        "pitch-value": { tag: "span", text: settings.pitch, class: "value-display" }
      },
      "volume-control": {
        tag: "div", class: "control-group",
        "volume-label": { tag: "label", text: "Volume:" },
        "volume-slider": { tag: "input", type: "range", name: "volume", min: "0", max: "1", step: "0.1", value: settings.volume },
        "volume-value": { tag: "span", text: settings.volume, class: "value-display" }
      },
      "pause-control": {
        tag: "div", class: "control-group",
        "pause-label": { tag: "label", text: "Add word pauses:" },
        "pause-checkbox": { tag: "input", type: "checkbox", name: "addPauses", checked: settings.addPauses }
      },
      "controls-actions": {
        tag: "div", class: "modal-actions",
        "test-btn": { tag: "button", type: "button", text: "Test", class: "cognition-button-secondary", events: { click: "ui.testTTSSettings" } },
        "save-btn": { tag: "button", type: "submit", text: "Save", class: "cognition-button-primary" }
      }
    }
  };

  await runtime.call('ui.showModal', {
    title: "Speech Settings",
    content: "Adjust voice properties:",
    tree: controlsTree
  });
};

export const testTTSSettings = async (event) => {
  const formData = new FormData(event.target.closest('form'));
  const settings = {
    rate: parseFloat(formData.get('rate')),
    pitch: parseFloat(formData.get('pitch')),
    volume: parseFloat(formData.get('volume')),
    addPauses: formData.get('addPauses') === 'on'
  };
  
  await runtime.call('tts.speak', 'This is a test of the speech settings.', settings);
};

export const saveTTSSettings = async (event) => {
  await runtime.call('web-speech-tts.saveSettings', event);
  await runtime.call('ui.closeModal');
};
export const renderTree = async (tree, container) => {
    const target = container || getMainContent();
    if (!target) throw new Error('Container not found');
    return await runtime.call('tree-to-dom.transform', tree, target);
};
// Updated showModal function to handle tree rendering
export const showModal = async ({ title, content = "", tree, actions = {} }) => {
    // Close any existing modal first
    await closeModal();
    
    const modalTree = {
        "modal-overlay": {
            tag: "div", 
            class: "cognition-overlay",
            "modal": {
                tag: "div", 
                class: "cognition-modal",
                "header": { 
                    tag: "h3", 
                    text: title, 
                    class: "cognition-modal-header" 
                },
                "content": { 
                    tag: "div", 
                    class: "cognition-modal-content",
                    ...(content && { innerHTML: content })
                },
                "actions": { 
                    tag: "div", 
                    class: "cognition-modal-actions", 
                    ...actions 
                }
            }
        }
    };

    // Render the base modal structure
    await renderTree(modalTree, document.body);
    
    // If we have a tree to render inside the content area, render it there
    if (tree) {
        const contentDiv = document.querySelector('.cognition-modal-content');
        if (contentDiv) {
            await renderTree(tree, contentDiv);
        } else {
            runtime.logError('[UI] Could not find modal content div for tree rendering');
        }
    }
};

// Add this new function to your UI module:
export const updateModal = async ({ tree, content }) => {
    const modalContent = document.querySelector('.cognition-modal-content');
    
    if (!modalContent) {
        runtime.logError('[UI] Cannot update modal - modal content not found');
        return;
    }
    
    // Clear existing content
    modalContent.innerHTML = '';
    
    // If we have new content HTML, set it
    if (content) {
        modalContent.innerHTML = content;
    }
    
    // If we have a new tree to render, render it
    if (tree) {
        await renderTree(tree, modalContent);
    }
    
    runtime.log('[UI] Modal updated successfully');
};
export const updatePrompt = async (text) => {
    const input = getSearchInput();
    if (input) input["value"] = text;
};
export const clearPrompt = async () => {
    const input = getSearchInput();
    if (input) input["value"] = '';
};
export const closeModal = async () => document.querySelector('.cognition-overlay')?.remove();
const showState = (message, type) => getMainContent()["innerHTML"] = type === 'error' ? errorHTML(message) : loadingHTML(message);
const createElement = (tag, attrs = {}) => Object.assign(document.createElement(tag), attrs);
const loadingHTML = (message) => `<div class="cognition-loading"><div class="cognition-spinner"></div><div class="cognition-loading-message">${message}</div></div>`;
const errorHTML = (message) => `<div class="cognition-error"><div class="cognition-error-icon">⚠️</div><div class="cognition-error-message">${message}</div></div>`;
const MAIN_LAYOUT_ID = 'cognition-main-layout';
const SEARCH_INPUT_ID = 'cognition-search-input';
const MAIN_CONTENT_ID = 'cognition-main-content';
const getMainLayout = () => document.querySelector(`#${MAIN_LAYOUT_ID}`);
const getSearchInput = () => document.querySelector(`#${SEARCH_INPUT_ID}`);
const getMainContent = () => document.querySelector(`#${MAIN_CONTENT_ID}`) || (() => { throw new Error('Main content area not found'); });

// testing
export const test = async () => {
    const { runUnitTest } = runtime.testUtils;
    return [
        await runUnitTest("Initializes complete extension layout", async () => {
            const layout = getMainLayout(), searchInput = getSearchInput(), mainContent = getMainContent();
            const actual = { hasLayout: !!layout, hasSearch: !!searchInput, hasMain: !!mainContent, inputFocused: document.activeElement === searchInput };
            const expected = { hasLayout: true, hasSearch: true, hasMain: true, inputFocused: true };
            return { actual, assert: runtime.testUtils.deepEqual, expected };
        }),
        await runUnitTest("Search input triggers search on Enter key", async () => {
            let searchQuery = null;
            const originalCall = runtime.call;
            runtime.call = async (action, ...args) => action === 'web-search.getSearchTree' && (searchQuery = args[0]);
            const testQuery = "test search";
            await handleSearchKeydown({ key: 'Enter', target: { value: testQuery } });
            runtime.call = originalCall;
            const actual = { searchTriggered: !!searchQuery, query: searchQuery };
            const expected = { searchTriggered: true, query: testQuery };
            return { actual, assert: runtime.testUtils.deepEqual, expected };
        })
    ];
};