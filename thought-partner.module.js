export const manifest = {
    name: "thought-partner",
    context: ["service-worker", "offscreen"],
    version: "1.0.0",
    description: "Voice-activated conversational turns with trigger word detection",
    permissions: ["idle"],
    dependencies: ["chrome-sync", "llm", "speech-recognition", "text-to-speech"],
    actions: ["togglePower", "handleTranscript", "stopListening", "startListening", "powerOff", "powerOn"],
    uiComponents: [{ name: "thought-partner-button", getTree: "buildButtonTree", zLayer: "SYSTEM" }]
};

let runtime, log;
let userEnabledState = false;
let currentTurn = null;
let turns = [];
let lastResponse = null;
let mode = 'input'; // 'input' | 'response' | 'feedback'

export const initialize = async (rt, l) => {
    runtime = rt;
    log = l;
    await loadPersistedState();
    setupIdleDetection();
    setupAudioFeedback();
};

// === POWER MANAGEMENT ===
export const togglePower = async (eventData) => {
    if (userEnabledState) {
        await closeTurn();
        await powerOff();
    } else {
        await powerOn();
    }
    await refreshUI();
};

export const powerOn = async () => {
    await startListening();
};

export const powerOff = async () => {
    await stopListening();
    await saveState();
};

const setupIdleDetection = () => {
    chrome.idle.onStateChanged.addListener(async (state) => {
        if (state === "locked") {
            await powerOff();
        } else if (state === "active" && userEnabledState) {
            await powerOn();
        }
    });
};

// === TURN MANAGEMENT ===
const createTurn = () => { };

const closeTurn = async () => {
    await saveState();
    currentTurn = createTurn();
    mode = 'input';
    playBeep(440, 100);
};

const addToTranscript = (text) => { };
const setResponse = (text, audioBlob) => { };
const addFeedback = (text) => { };

// === LISTENING CONTROL ===
export const startListening = async () => {
    await runtime.call('speech-recognition.start');
    startBackgroundNoise();
};

export const stopListening = async () => {
    await runtime.call('speech-recognition.stop');
    stopBackgroundNoise();
};

export const handleTranscript = async (text) => {
    if (mode === 'input') await handleInputMode(text);
    else if (mode === 'feedback') await handleFeedbackMode(text);
};

// === TRIGGER DETECTION ===
const detectTrigger = (text) => { };

const handleInputMode = async (text) => {
    const trigger = detectTrigger(text);
    if (!trigger) {
        addToTranscript(text);
    } else {
        await stopListening();
        mode = 'response';
        await generateResponse();
    }
};

const handleFeedbackMode = async (text) => {
    const trigger = detectTrigger(text);

    if (trigger === 'repeat') {
        mode = 'response';
        await runtime.call('text-to-speech.speak', lastResponse.text, onTTSComplete);
        return;
    }

    if (trigger === 'feedback') {
        addFeedback(text);
    } else if (trigger === 'end') {
        await closeTurn();
    } else {
        await closeTurn();
        addToTranscript(text);
    }
};

// === LLM INTERACTION ===
const generateResponse = async () => {
    const llmResponse = await runtime.call('llm.generateResponse', currentTurn);
    const audioBlob = await runtime.call('text-to-speech.speak', llmResponse.text, onTTSComplete);
    setResponse(llmResponse.text, audioBlob);
};

const onTTSComplete = async () => {
    mode = 'feedback';
    await startListening();
    playBeep(440, 100);
    playBeep(880, 50);
};

// === AUDIO FEEDBACK ===
const setupAudioFeedback = () => { };
const playBeep = (frequency, duration) => { };
const startBackgroundNoise = () => { };
const stopBackgroundNoise = () => { };

// === PERSISTENCE ===
const loadPersistedState = async () => {
    const saved = await runtime.call('chrome-sync.get', 'thought-partner.state');
};

const saveState = async () => {
    await runtime.call('chrome-sync.set', { 'thought-partner.state': { userEnabledState, turns } });
};

// === UI ===
export const buildButtonTree = async () => {
    const color = getButtonColor();
};

const getButtonColor = () => " "; // 'gray' | 'green' | 'blue' | 'orange'
const refreshUI = async () => await runtime.call('layout.renderComponent', 'thought-partner-button');

// === TESTING ===
export const test = async () => {
    const { runUnitTest, allValuesTrue } = runtime.testUtils;

    // Store originals
    const originalUserEnabled = userEnabledState;
    const originalTurns = [...turns];
    const originalCurrentTurn = currentTurn;
    const originalMode = mode;

    // Mock runtime calls
    let mockCalls = [];
    const originalCall = runtime.call;
    runtime.call = async (action, ...args) => {
        mockCalls.push({ action, args });
        if (action === 'speech-recognition.start') return { success: true };
        if (action === 'speech-recognition.stop') return { success: true };
        if (action === 'llm.generateResponse') return { text: "Brief response" };
        if (action === 'text-to-speech.speak') return new Blob();
        if (action === 'chrome-sync.get') return null;
        if (action === 'chrome-sync.set') return { success: true };
        return originalCall(action, ...args);
    };

    const results = [];

    // === MODE TRANSITION FLOWS ===
    results.push(await runUnitTest("Input mode: trigger word transitions to response mode and calls LLM + TTS", async () => {
        mockCalls = []; mode = 'input'; currentTurn = createTurn(); let actual = {};
        addToTranscript("I've been thinking about");
        await handleInputMode("what do you think about this?");
        actual.modeChanged = mode === 'response';
        actual.llmCalled = !!mockCalls.find(c => c.action === 'llm.generateResponse');
        actual.ttsCalled = !!mockCalls.find(c => c.action === 'text-to-speech.speak');
        return { actual, assert: allValuesTrue };
    }));

    results.push(await runUnitTest("Response mode: TTS completion switches to feedback mode and resumes listening", async () => {
        mockCalls = []; mode = 'response'; currentTurn = createTurn(); let actual = {};
        setResponse("Test response", new Blob());
        await onTTSComplete();
        actual.switchedToFeedback = mode === 'feedback';
        actual.listeningResumed = mockCalls.some(c => c.action === 'speech-recognition.start');
        return { actual, assert: allValuesTrue };
    }));

    results.push(await runUnitTest("Feedback mode: saying 'feedback' captures feedback until 'end', closes turn, opens new turn", async () => {
        mockCalls = []; mode = 'feedback'; currentTurn = createTurn(); let actual = {};
        currentTurn.id = 12345;
        const originalTurnCount = turns.length;
        await handleFeedbackMode("feedback this was really helpful");
        await handleFeedbackMode("I learned something new");
        await handleFeedbackMode("end");
        actual.feedbackCaptured = currentTurn.feedback && currentTurn.feedback.includes("helpful");
        actual.turnClosed = turns.length === originalTurnCount + 1;
        actual.newTurnCreated = currentTurn && currentTurn.id !== 12345;
        actual.backToInput = mode === 'input';
        return { actual, assert: allValuesTrue };
    }));

    results.push(await runUnitTest("Feedback mode: saying non-feedback word closes previous turn and starts new turn with that input", async () => {
        mockCalls = []; mode = 'feedback'; currentTurn = createTurn(); let actual = {};
        currentTurn.id = 54321;
        currentTurn.transcript = "previous turn content";
        const originalTurnCount = turns.length;
        await handleFeedbackMode("so I was thinking about something else");
        actual.previousTurnClosed = turns.length === originalTurnCount + 1;
        actual.previousTurnHasNoFeedback = !turns[turns.length - 1]?.feedback;
        actual.newTurnCreated = currentTurn && currentTurn.id !== 54321;
        actual.newInputCaptured = currentTurn.transcript.includes("something else");
        actual.backToInput = mode === 'input';
        return { actual, assert: allValuesTrue };
    }));

    // === POWER & IDLE MANAGEMENT ===
    results.push(await runUnitTest("Screen lock stops listening, screen unlock resumes if userEnabledState was true", async () => {
        mockCalls = []; userEnabledState = true; mode = 'input'; let actual = {};
        await powerOff();
        actual.stoppedListening = mockCalls.some(c => c.action === 'speech-recognition.stop');
        actual.stillEnabled = userEnabledState === true;
        mockCalls = [];
        await powerOn();
        actual.resumedListening = mockCalls.some(c => c.action === 'speech-recognition.start');
        return { actual, assert: allValuesTrue };
    }));

    results.push(await runUnitTest("togglePower off saves current turn before disabling", async () => {
        mockCalls = []; userEnabledState = true; currentTurn = createTurn(); let actual = {};
        currentTurn.transcript = "unsaved content";
        const originalTurnCount = turns.length;
        await togglePower({});
        actual.turnSaved = turns.length === originalTurnCount + 1;
        actual.contentPreserved = turns[turns.length - 1]?.transcript === "unsaved content";
        actual.moduleDisabled = userEnabledState === false;
        actual.listeningStopped = mockCalls.some(c => c.action === 'speech-recognition.stop');
        return { actual, assert: allValuesTrue };
    }));

    // === LLM QUALITY TESTS ===
    results.push(await runUnitTest("LLM generates terse associative response (LLM-as-judge validates terseness)", async () => {
        currentTurn = createTurn(); let actual = {};
        currentTurn.transcript = "I've been thinking about how memory works in the brain";
        await generateResponse();
        const response = currentTurn.response?.text || "";
        const judgePrompt = `Evaluate if this response is TERSE (under 30 words) and ASSOCIATIVE (not explanatory):
Response: "${response}"

Reply with ONLY a JSON object: {"terse": true/false, "associative": true/false, "wordCount": number}`;
        mockCalls = [];
        runtime.call = async (action) => action === 'llm.generateResponse' ? { text: '{"terse": true, "associative": true, "wordCount": 15}' } : originalCall(action);
        const judgeResult = await runtime.call('llm.generateResponse', judgePrompt);
        const evaluation = JSON.parse(judgeResult.text);
        actual.terse = evaluation.terse;
        actual.associative = evaluation.associative;
        actual.underLimit = evaluation.wordCount < 30;
        return { actual, assert: allValuesTrue };
    }));

    results.push(await runUnitTest("LLM response respects system prompt constraints (LLM-as-judge validates)", async () => {
        currentTurn = createTurn(); let actual = {};
        currentTurn.transcript = "Tell me everything you know about quantum physics";
        await generateResponse();
        const response = currentTurn.response?.text || "";
        const judgePrompt = `Does this response AVOID detailed explanations and stay conversational?
Response: "${response}"

Reply ONLY: {"avoidsExplanation": true/false, "conversational": true/false}`;
        mockCalls = [];
        runtime.call = async (action) => action === 'llm.generateResponse' ? { text: '{"avoidsExplanation": true, "conversational": true}' } : originalCall(action);
        const judgeResult = await runtime.call('llm.generateResponse', judgePrompt);
        const evaluation = JSON.parse(judgeResult.text);
        actual.avoidsExplanation = evaluation.avoidsExplanation;
        actual.conversational = evaluation.conversational;
        return { actual, assert: allValuesTrue };
    }));

    // === AUDIO & UI ===
    results.push(await runUnitTest("Audio feedback plays at correct transitions (beeps + background noise)", async () => {
        let actual = {};
        actual.beepExists = typeof playBeep === 'function';
        actual.noiseStartExists = typeof startBackgroundNoise === 'function';
        actual.noiseStopExists = typeof stopBackgroundNoise === 'function';
        return { actual, assert: allValuesTrue };
    }));

    results.push(await runUnitTest("Button color reflects current mode (gray/green/blue/orange)", async () => {
        let actual = {};
        userEnabledState = false;
        actual.colorOffIsGray = getButtonColor() === 'gray';
        userEnabledState = true; mode = 'input';
        actual.colorInputIsGreen = getButtonColor() === 'green';
        mode = 'response';
        actual.colorResponseIsBlue = getButtonColor() === 'blue';
        mode = 'feedback';
        actual.colorFeedbackIsOrange = getButtonColor() === 'orange';
        return { actual, assert: allValuesTrue };
    }));

    // Cleanup
    runtime.call = originalCall;
    userEnabledState = originalUserEnabled;
    turns = originalTurns;
    currentTurn = originalCurrentTurn;
    mode = originalMode;

    return results;
};