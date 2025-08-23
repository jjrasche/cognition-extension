export const manifest = {
    name: 'ui',
    version: '1.0.0',
    context: ['extension-page'],
    description: 'Extension page layout and tree orchestration',
    dependencies: ['tree-to-dom'],
    actions: ['initializeLayout', 'renderTree', 'handleSearchKeydown', 'showModal', 'closeModal', 'updatePrompt', 'clearPrompt', 'toggleListening'],
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
                "mic-button": { tag: "button", id: "mic-button", text: "🎤", class: "cognition-button-secondary", style: "min-width: 40px; height: 40px; border-radius: 50%; font-size: 18px;", events: { click: "ui.toggleListening" } }
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
    const status = await runtime.call('transcript.getStatus');
    const button = getMicButton();

    if (status.isListening) {
        await runtime.call('transcript.stopListening');
        button.textContent = '🎤';
        button["style"].background = '';
    } else {
        await runtime.call('transcript.startListening');
        button.textContent = '🔴';
        button["style"].background = 'rgba(255, 0, 0, 0.1)';
    }
};
export const renderTree = async (tree, container) => {
    const target = container || getMainContent();
    if (!target) throw new Error('Container not found');
    return await runtime.call('tree-to-dom.transform', tree, target);
};
export const showModal = async ({ title, content, actions }) => {
    const modalTree = {
        "modal-overlay": {
            tag: "div", class: "cognition-overlay",
            "modal": {
                tag: "div", class: "cognition-modal",
                "header": { tag: "h3", text: title, class: "cognition-modal-header" },
                "content": { tag: "div", text: content, class: "cognition-modal-content" },
                "actions": { tag: "div", class: "cognition-modal-actions", ...actions }
            }
        }
    };
    await renderTree(modalTree, document.body);
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