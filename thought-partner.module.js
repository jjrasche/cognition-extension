import { getId } from "./helpers.js";
export const manifest = {
    name: "thought-partner",
    context: ["extension-page"],
    version: "1.0.0",
    description: "thought partner that responds in terse associative voice only conversation, updates shared state atomic ideas, and provides meta cognitive state updates",
    dependencies: ["inference", "layout", "indexed-db"],
    actions: [""],
    uiComponents: [{ name: "thought-partner", getTree: "buildUI" }],
    indexeddb: {
        name: 'ThoughtPartnerDB', version: 1,
        storeConfigs: [{
            name: 'turns',
            options: { keyPath: 'id' },
            indexes: [{ name: 'by-conversation', keyPath: 'id' }, { name: 'by-created', keyPath: 'createdOn' }]
        }]
    }
};
let runtime, log, cachedConversations, conversation, conversationPickerVisible = false
const model = "meta-llama/llama-4-scout-17b-16e-instruct";
export const initialize = async (rt, l) => {
    runtime = rt; log = l;
    cachedConversations = await getAllConversations()
    await loadMostRecentConversation();
};

// ============ Persistence ============
const db = async (method, ...args) => await runtime.call(`indexed-db.${method}`, manifest.indexeddb.name, manifest.indexeddb.storeConfigs[0].name, ...args);
const getAllConversations = async () => await db('getAllRecords');
const loadMostRecentConversation = async () => conversation = cachedConversations.sort((a, b) => b.lastModified - a.lastModified)[0] ?? getBlankConversationState();
const getBlankConversationState = () => ({
    id: getId('conv-'),
    name: '',
    userInput: '',
    response: '',
    atomicIdeas: [],
    createdOn: Date.now()
});

const getSystemPrompt = () => `You extract and refine software specifications from conversational transcripts.\n\nInput: JSON spec state + recent transcript text\nOutput: ONE suggestion as JSON: {"type": "modify|add|question", "field": "what|why|architecture", "content": "..."}\n\nRules:\n- Extract WHAT (feature/capability) and WHY (user need/goal) from natural speech\n- Suggest specific technical decisions when architecture is vague\n- Ask clarifying questions when requirements are unclear\n- Keep suggestions concise and actionable\n- Focus on WHAT and WHY before architectural HOW`;
const generateResponse = async () => {
    try {
        const query = `...`;
        return JSON.parse(await runtime.call('inference.prompt', { query, model, systemPrompt: getSystemPrompt(), responseFormat: 'JSON' }));
    } catch (e) { log.error('parse error:', e); return {}; }
};


export const test = async () => {
    const { runUnitTest, deepEqual } = runtime.testUtils;
    return [
        await runUnitTest("LLM suggestion quality validation", async () => {
            initializeTrainingModuleTest();
            const suggestion = await generateResponse();
            const evaluation = await evaluateResponse(suggestion);
            return { actual: evaluation, assert: (actual) => actual.relevance >= 7 && actual.actionability >= 7 && actual.clarity >= 7, expected: { meetsThreshold: true } };
        }, cleanupTest())
    ];
};

const evaluateResponse = async (response) => {
    const query = `Spec State: ${JSON.stringify(workflowState.spec)}\nTranscripts: "${transcriptHistory.map(t => t.text).join(' ')}"\nSuggestion: ${JSON.stringify(suggestion)}`;
    const systemPrompt = `You are an expert evaluator of AI-generated software specifications.\n\nScore each suggestion 0-10 on:\n- Relevance: Does it address the user's transcripts?\n- Actionability: Is it specific and implementable?\n- Clarity: Is it well-articulated?\n\nOutput JSON: {"relevance": 0-10, "actionability": 0-10, "clarity": 0-10, "reasoning": "brief explanation"}`;
    return JSON.parse(await runtime.call('inference.prompt', { query, systemPrompt, model: { id: "openai/gpt-oss-20b" }, responseFormat: 'JSON' }));
};

const cleanupTest = () => async () => { conversation = getBlankConversationState(); };
const initializeTrainingModuleTest = async () => {
    conversation.atomicIdeas = [
    ];
    conversation.userInput = "build a training module";
    renderUI();
}
























const updateConversation = async (updates) => await db('updateRecord', Object.assign(conversation, updates));
export const loadConversation = async (id) => await db('getRecord', id) ?? (() => { throw new Error('Conversation not found') })();
const deleteConversation = async (id) => {
    await db('removeRecord', id);
    if (conversation.id === id) conversation = getBlankConversationState();
    cachedConversations = cachedConversations.filter(c => c.id !== id);
};
export const handleConversationDelete = async (eventData) => { await deleteConversation(eventData.ancestorData.conversationId); await renderUI(); };
// === SHARED UI ===
const conversationPickerBtn = () => ({ "picker-btn": { tag: "button", text: "📁 Conversations", class: "cognition-button-secondary", events: { click: "thought-partner.showConversationPicker" } } });
const headerAndTitle = () => ({ tag: "div", class: "cognition-title", "title": { tag: "h2", text: "Thought Partner", style: "margin: 0;" } });
export const renderUI = async () => await runtime.call('layout.renderComponent', manifest.uiComponents[0].name, await buildUI());
export const buildUI = () => {
    return {
        "thought-partner": {
            tag: "div", style: "height: 100vh; display: flex; flex-direction: column; padding: 20px; gap: 15px;",
            "header": { ...headerAndTitle(), ...conversationPickerBtn() },
            ...(conversationPickerVisible && buildConversationPickerUI())
        }
    }
};
// === SEARCH ===
let cachedWorkflows = [];
export const searchWorkflows = async (query) => {
    if (!query.trim()) return cachedWorkflows.sort((a, b) => b.lastModified - a.lastModified);
    const lq = query.toLowerCase();
    return cachedWorkflows.map(c => ({
        ...c,
        score: (c.name?.toLowerCase().includes(lq) ? 10 : 0) +
            (c.turn?.userInput?.toLowerCase().includes(lq) ? 5 : 0) +
            (c.turn?.response?.toLowerCase().includes(lq) ? 5 : 0) +
            (c.atomicIdeas?.join(", ")?.toLowerCase().includes(lq) ? 3 : 0)
    })).filter(c => c.score > 0).sort((a, b) => b.score - a.score);
};
export const handleSearchInput = async (eventData) => { await searchWorkflows(eventData.target.value); await renderUI(); };
export const showConversationPicker = async () => { conversationPickerVisible = !conversationPickerVisible; await renderUI(); };
export const handleConversationSelect = async (eventData) => {
    await loadConversation(eventData.ancestorData.conversationId);
    conversationPickerVisible = false;
    renderUI();
};
export const handleBackdropClick = async () => { conversationPickerVisible = false; await renderUI(); };
const buildConversationPickerUI = () => ({
    "conversation-backdrop": { tag: "div", class: "picker-backdrop", events: { click: "thought-partner.handleBackdropClick" } },
    "conversation-drawer": {
        tag: "div", class: "picker-drawer",
        "picker-header": { tag: "div", style: "padding: 10px; border-bottom: 1px solid var(--border-primary);", ...searchInput() },
        "picker-list": { tag: "div", style: "flex: 1; overflow-y: auto; padding: 8px;", ...conversationList() }
    }
});
const searchInput = () => ({ "search": { tag: "input", type: "text", placeholder: "Search workflows...", class: "cognition-input", events: { input: "thought-partner.handleSearchInput" } } });
const conversationList = () => cachedConversations.length === 0 ? { "no-results": { tag: "div", text: "No workflows found.", style: "padding: 10px; text-align: center; color: var(--text-muted);" } } :
    Object.fromEntries(cachedConversations.slice(0, 20).map(c => [`wf-${c.id}`, conversationItem(c)]));
const conversationItem = (c) => ({
    tag: "div", class: "picker-item", events: { click: "thought-partner.handleWorkflowSelect" }, "data-workflow-id": c.id,
    "name": { tag: "div", text: c.name || '(unnamed)', style: "font-weight: 500; margin-bottom: 4px;" },
    // ...deleteConversationBtn()
});
// const deleteConversationBtn = () => ({ "delete-btn": { tag: "button", text: "🗑️", class: "cognition-button-secondary", style: "position: absolute; top: 8px; right: 8px; padding: 4px 8px; font-size: 12px;", events: { click: "thought-partner.handleConversationDelete" }, title: "Delete Conversation" } });
// // ============ MIC & SPEECH RECOGNITION ============
// export const acceptSpecChange = async (eventData) => {
//     const field = eventData.target.dataset.field, change = pendingChanges.get(field);
//     await updateConversation();
//     pendingChanges.delete(field);
//     await logSpecTraining('accepted', true); await renderUI();
// };
// export const rejectSpecChange = async (eventData) => {
//     pendingChanges.delete(eventData.target.dataset.field);
//     await logSpecTraining('rejected', null); await renderUI();
// };
// export const markWrongTiming = async () => {
//     await logSpecTraining('ignored', false);
//     pendingChanges.clear(); await renderUI();
// };
// const logSpecTraining = async (action, rightTiming) => { }

// lastSuggestion && await runtime.call('graph-db.addNode', {
// 	type: 'spec-training', aiResponse: lastSuggestion, userFeedback: { action, rightTiming },
// 	context: { specState: { ...currentSpec }, recentTranscript: transcriptHistory.slice(-5).map(t => t.text).join(' '), pauseDuration: Date.now() - lastSpeechTime },
// });
// ============ SPEC MODE ============
// let pendingChanges = new Map(), isListening = false, lastSpeechTime = 0, lastSuggestion = null, historyVisible = true, userPromptVisible = true;
// phases.spec.start = async () => { pendingChanges.clear(); isListening = true; lastSpeechTime = Date.now(); };
// phases.spec.stop = async () => { await runtime.call('web-speech-stt.stopListening'); isListening = false; };
// export const toggleUserPrompt = async () => { userPromptVisible = !userPromptVisible; await renderUI(); };
// export const toggleHistory = async () => (historyVisible = !historyVisible, await renderUI());
// const transcriptContent = () => ({ "content": { tag: "textarea", value: userPrompt, placeholder: "Type or speak your prompt...", class: "cognition-input cognition-textarea-md", events: { input: "thought-partner.updateUserPrompt", focus: "thought-partner.handleUserPromptFocus", } } });
// const historyEntries = () => Object.fromEntries(workflowState.transcriptHistory.slice(-20).map((text, i) => [`entry-${i}`, { tag: "div", style: "margin-bottom: 8px; padding: 8px; background: var(--bg-input); border-radius: 4px; position: relative;", "data-entry-index": i, ...historyTextarea(text), ...historyDeleteBtn() }]));
// const historyTextarea = (text) => ({ "textarea": { tag: "textarea", value: text, class: "cognition-input cognition-textarea-sm", events: { change: "thought-partner.updateTranscriptEntry" } } });
// const historyDeleteBtn = () => ({ "delete": { tag: "button", text: "🗑️", class: "cognition-button-secondary", style: "position: absolute; top: 4px; right: 4px; padding: 2px 6px; font-size: 10px;", events: { click: "thought-partner.deleteTranscriptEntry" } } });
// const micToggle = () => ({ "mic-toggle": { tag: "button", text: isListening ? "⏸ Pause Listening" : "🎤 Start Listening", class: isListening ? "cognition-button-secondary" : "cognition-button-primary", style: isListening ? "background: #4CAF50;" : "", events: { click: "thought-partner.toggleListening" } } });
// const transcriptBtn = () => ({ "toggle": { tag: "button", text: userPromptVisible ? "Hide Transcript" : "Show Transcript", class: "cognition-button-secondary", events: { click: "thought-partner.toggleUserPrompt" } } });
// const historyBtn = () => ({ "history-btn": { tag: "button", text: historyVisible ? "Hide History" : "Show History", class: "cognition-button-secondary", events: { click: "thought-partner.toggleHistory" } } });
// const acceptBtn = (field) => ({ "accept": { tag: "button", text: "✓ Accept", class: "cognition-button-primary", style: "padding: 6px 12px;", events: { click: "thought-partner.acceptSpecChange" }, "data-field": field, title: "Ctrl+Y" } });
// const rejectBtn = (field) => ({ "reject": { tag: "button", text: "✗ Reject", class: "cognition-button-secondary", style: "padding: 6px 12px;", events: { click: "thought-partner.rejectSpecChange" }, "data-field": field, title: "Ctrl+N" } });
// const wrongTimingBtn = () => ({ "timing": { tag: "button", text: "⏰ Too Early", class: "cognition-button-secondary", style: "padding: 6px 12px;", events: { click: "thought-partner.markWrongTiming" }, title: "Valid suggestion, wrong moment" } });
// const historyPanel = () => ({
//     "history": {
//         tag: "div", style: "flex: 0 0 200px; border-top: 1px solid var(--border-primary); padding-top: 15px; overflow-y: auto;",
//         "history-title": { tag: "h4", text: "Transcript History", style: "margin: 0 0 10px 0;" },
//         "entries": { tag: "div", style: "font-size: 12px; color: var(--text-muted);", ...historyEntries() }
//     }
// });
// const userPromptPanel = () => ({
//     "live-transcript": {
//         tag: "div", style: "flex: 0 0 200px; border-top: 1px solid var(--border-primary); padding-top: 15px;",
//         "transcript-title": { tag: "h4", text: "User Prompt", style: "margin: 0;" },
//         ...(userPromptVisible && transcriptContent())
//     }
// });
// const body = () => ({ ...(historyVisible && historyPanel()), ...(userPromptVisible && userPromptPanel()) });
// ============ TESTING ============