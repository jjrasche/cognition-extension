import { configProxy } from "./config.module.js";
export const manifest = {
    name: "thought-partner",
    context: ["extension-page"],
    version: "1.0.0",
    description: "Voice-activated conversational turns with trigger word detection",
    permissions: ["idle"],
    dependencies: ["chrome-sync", "inference", "audio-recordings", "tts"],
    actions: ["togglePower", "buildButtonTree"],
    uiComponents: [{ name: "thought-partner-button", getTree: "buildButtonTree", zLayer: "SYSTEM" }],
    config: {
        model: { type: 'select', value: 'groq/llama-3.3-70b-versatile', label: 'Model', options: [], onChange: 'populateModelOptions' },
        systemPrompt: { type: 'textarea', value: "You are a terse, associative conversation partner. Respond in under 30 words. Do not explain - make connections.", label: 'System Prompt', rows: 4 },
        queryTemplate: { type: 'textarea', value: "Context: {{transcript}}\n\nRespond:", label: 'Query Template (use {{transcript}})', rows: 3 }
    }
};

let runtime, log, state = null, currentTurn = null, turns = [], audioContext = null;
const triggers = ['what do you think', 'any ideas', 'your turn', 'go time', 'lets hear it'];
const config = configProxy(manifest);

export const initialize = async (rt, l) => {
    runtime = rt; log = l;
    const saved = await runtime.call('chrome-sync.get', 'thought-partner');
    state = saved?.state || null; turns = saved?.turns || [];
    state && await listen();
    setupAudio();
    await populateModelOptions();
};
export const populateModelOptions = async () => manifest.config.model.options = await runtime.call('inference.getAllAvailableModels');

// === CORE FLOW ===
const listen = async () => {
    await runtime.call('audio-recordings.startRecording', {
        onTranscript: handleChunk,
        finalizationDelay: 2000
    });
    startNoise();
};

const stopListening = async () => {
    const recording = await runtime.call('audio-recordings.stopRecording');
    stopNoise();
    return recording;
};

const handleChunk = async (chunk) => {
    const text = chunk.text;
    console.log('Chunk received:', { text, isFinal: !!chunk.finalizedAt });

    // Run all handlers on every chunk (both interim and final)
    for (const h of handlers) {
        if (await h(text, chunk.finalizedAt)) {
            log.log(`${h.name} triggered`);
            break;
        }
    }
};

const detectTrigger = (text) => triggers.some(t => text.toLowerCase().includes(t));
// pass in chunk
const handlers = [
];
const onResponseTrigger = async (chunk) => state === 'input' && chunk.isFinal && detectTrigger(chunk.text) && (await getResponse(), true);
const func2 = async (chunk) => state === 'input' && chunk.isFinal && (currentTurn.interimTranscript = '', await save(), true);
const func3 = async (chunk) => state === 'input' && !chunk.isFinal && (currentTurn.interimTranscript = chunk.text, true);
const onFeedbackTrigger = async (chunk) => state === 'response_done' && chunk.isFinal && chunk.text.toLowerCase().startsWith('feedback') && (state = 'feedback', beep(440, 100), beep(880, 50), await save(), true);
const onNoFeedback = async (chunk) => state === 'response_done' && chunk.isFinal && (await close(), currentTurn.interimTranscript = text, state = 'input', beep(440, 100), await save(), await listen(), true);
const df = async (chunk) => state === 'feedback' && chunk.isFinal && chunk.text.toLowerCase().includes('end feedback') && (await close(), state = 'input', beep(440, 100), currentTurn = createTurn(), await listen(), true);
const func7 = async (chunk) => state === 'feedback' && chunk.isFinal && (currentTurn.feedback += ` ${chunk.text}`, await save(), true);

const getResponse = async () => {
    const recording = await stopListening();

    currentTurn.stt = {
        model: "whisper",
        chunks: recording.chunks,
        transcript: recording.transcript,
        audioBlob: recording.audioBlob,
        recordingId: recording.id,
        duration: recording.duration
    };

    const llmRequest = {
        model: config.model.split('/')[1],
        systemPrompt: config.systemPrompt,
        query: inject(config.queryTemplate, { transcript: currentTurn.stt.transcript }),
        responseFormat: 'JSON'
    };

    const llmResp = await runtime.call('inference.prompt', llmRequest);
    currentTurn.llm = { ...llmRequest, ...llmResp };
    currentTurn.tts = await runtime.call('tts.speak', llmResp.text);

    state = 'response_done';
    await listen();
    await save();
};

const inject = (template, vars) => Object.entries(vars).reduce((str, [k, v]) => str.replaceAll(`{{${k}}}`, v), template);
const createTurn = () => ({ id: Date.now(), timestamp: Date.now(), interimTranscript: '', stt: null, llm: null, tts: null, feedback: null });
const close = async () => {
    currentTurn.duration = Date.now() - currentTurn.timestamp;
    delete currentTurn.interimTranscript; // Don't save interim text
    turns.push(currentTurn);
    await save();
    currentTurn = createTurn()
};

// === POWER ===
export const togglePower = async () => {
    if (state) {
        await stopListening();
        state = null;
        currentTurn = null;
    } else {
        state = 'input';
        currentTurn = createTurn();
        await listen();
    }
    await save();
    await refresh();
};

// === AUDIO ===
const setupAudio = () => audioContext = new (window.AudioContext || window.webkitAudioContext)();
const beep = (freq, dur) => { const osc = audioContext.createOscillator(), gain = audioContext.createGain(); osc.frequency.value = freq; gain.gain.setValueAtTime(0.1, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + dur / 1000); osc.connect(gain).connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + dur / 1000); };
const startNoise = () => { }; // TODO: white noise oscillator
const stopNoise = () => { }; // TODO: stop oscillator

// === PERSISTENCE ===
const save = async () => await runtime.call('chrome-sync.set', { 'thought-partner': { state, turns: turns.slice(-50) } }); // Keep last 50

// === UI ===
export const buildButtonTree = async () => ({
    "power-button": {
        tag: "button",
        text: state === 'feedback' ? "🟠" : state === 'response_done' ? "🔵" : state === 'input' ? "🟢" : "⚫",
        class: "cognition-button-primary",
        style: "position: fixed; top: 10px; right: 10px; width: 40px; height: 40px; border-radius: 50%; font-size: 24px; z-index: 10000;",
        events: { click: "thought-partner.togglePower" }
    }
});
const refresh = async () => await runtime.call('layout.renderComponent', 'thought-partner-button');


// // === TESTING ===
// export const test = async () => {
//     const { runUnitTest, allValuesTrue } = runtime.testUtils;
//     const orig = { state, turns: [...turns], currentTurn, call: runtime.call };
//     let mockCalls = [];
//     runtime.call = async (action, ...args) => (mockCalls.push({ action, args }), action === 'speech-recognition.start' ? {} : action === 'speech-recognition.stop' ? {} : action === 'llm.generateResponse' ? { text: "Brief", model: "test", usage: { input_tokens: 10, output_tokens: 5 } } : action === 'text-to-speech.speak' ? new Blob() : action === 'chrome-sync.get' ? null : action === 'chrome-sync.set' ? {} : orig.call(action, ...args));

//     const results = [
//         await runUnitTest("Input: trigger transitions to response_done", async () => {
//             mockCalls = []; state = 'input'; currentTurn = createTurn(); let actual = {};
//             currentTurn.stt.transcript = "I've been thinking";
//             await onTranscript("what do you think about this?");
//             actual.stateChanged = state === 'response_done';
//             actual.llmCalled = mockCalls.some(c => c.action === 'llm.generateResponse');
//             actual.ttsCalled = mockCalls.some(c => c.action === 'text-to-speech.speak');
//             actual.hasLLM = !!currentTurn.llm;
//             actual.hasTTS = !!currentTurn.tts;
//             return { actual, assert: allValuesTrue };
//         }),

//         await runUnitTest("Response done: 'feedback' enters feedback state", async () => {
//             mockCalls = []; state = 'response_done'; currentTurn = createTurn(); let actual = {};
//             await onTranscript("feedback this was helpful");
//             actual.enteredFeedback = state === 'feedback';
//             actual.feedbackCaptured = currentTurn.feedback.includes("helpful");
//             return { actual, assert: allValuesTrue };
//         }),

//         await runUnitTest("Response done: non-feedback closes turn and starts new", async () => {
//             state = 'response_done'; currentTurn = createTurn(); currentTurn.id = 123; let actual = {};
//             const origCount = turns.length;
//             await onTranscript("something else entirely");
//             actual.turnClosed = turns.length === origCount + 1;
//             actual.newTurnCreated = currentTurn.id !== 123;
//             actual.backToInput = state === 'input';
//             actual.newTranscript = currentTurn.stt.transcript === "something else entirely";
//             return { actual, assert: allValuesTrue };
//         }),

//         await runUnitTest("Feedback: 'end feedback' closes turn", async () => {
//             state = 'feedback'; currentTurn = createTurn(); currentTurn.feedback = "great stuff"; let actual = {};
//             const origCount = turns.length;
//             await onTranscript("end feedback");
//             actual.turnClosed = turns.length === origCount + 1;
//             actual.feedbackSaved = turns[turns.length - 1].feedback === "great stuff";
//             actual.backToInput = state === 'input';
//             return { actual, assert: allValuesTrue };
//         }),

//         await runUnitTest("Feedback: accumulates until end", async () => {
//             state = 'feedback'; currentTurn = createTurn(); currentTurn.feedback = ""; let actual = {};
//             await onTranscript("feedback this is part one");
//             await onTranscript("and here's part two");
//             actual.accumulated = currentTurn.feedback.includes("part one") && currentTurn.feedback.includes("part two");
//             actual.stillInFeedback = state === 'feedback';
//             return { actual, assert: allValuesTrue };
//         }),

//         await runUnitTest("Toggle power saves and resumes", async () => {
//             mockCalls = []; state = 'input'; currentTurn = createTurn(); let actual = {};
//             await togglePower();
//             actual.turnedOff = state === null;
//             actual.stoppedListening = mockCalls.some(c => c.action === 'speech-recognition.stop');
//             mockCalls = [];
//             await togglePower();
//             actual.turnedOn = state === 'input';
//             actual.startedListening = mockCalls.some(c => c.action === 'speech-recognition.start');
//             return { actual, assert: allValuesTrue };
//         }),

//         await runUnitTest("Turn object has complete structure", async () => {
//             state = 'input'; currentTurn = createTurn(); let actual = {};
//             currentTurn.stt.transcript = "test input";
//             await getResponse();
//             actual.hasSTT = !!currentTurn.stt && Array.isArray(currentTurn.stt.chunks);
//             actual.hasLLM = !!currentTurn.llm && !!currentTurn.llm.response;
//             actual.hasTTS = !!currentTurn.tts && !!currentTurn.tts.output;
//             actual.hasTokens = !!currentTurn.llm.tokens;
//             return { actual, assert: allValuesTrue };
//         })
//     ];

//     runtime.call = orig.call; state = orig.state; turns = orig.turns; currentTurn = orig.currentTurn;
//     return results;
// };