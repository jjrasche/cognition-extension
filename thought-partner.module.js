import { configProxy } from "./config.module.js";
export const manifest = {
	name: "thought-partner",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Voice-activated conversational turns with trigger word detection",
	permissions: ["idle"],
	dependencies: ["chrome-local", "indexed-db", "inference", "audio-recordings", "tts"],
	actions: ["togglePower", "buildButton"],
	uiComponents: [{ name: "thought-partner-button", getTree: "buildButton", zLayer: "SYSTEM" }],
	config: {
		model: { type: 'select', value: 'groq/llama-3.1-8b-instant', label: 'Model', options: [], onChange: 'populateModelOptions' },
		systemPrompt: { type: 'textarea', value: "You are a terse, associative conversation partner. Respond in under 30 words. Do not explain - make connections.", label: 'System Prompt', rows: 4 },
		queryTemplate: { type: 'textarea', value: "Context: {{transcript}}\n\nRespond:", label: 'Query Template (use {{transcript}})', rows: 3 }
	},
	indexeddb: {
		name: 'ThoughtPartnerDB', 
		version: 1,
		storeConfigs: [ { name: 'turns', options: { keyPath: 'id', autoIncrement: true }, indexes: [{ name: 'by-timestamp', keyPath: 'timestamp' }] } ]
	}
};

let runtime, log, state = null, currentTurn = {}, turns = [], audioContext = null;
const triggers = ['what do you think', 'any ideas', 'your turn', 'go time', 'lets hear it'];
const config = configProxy(manifest);

export const initialize = async (rt, l) => {
	runtime = rt; log = l;
	// state = await getState();
	turns = await loadTurns();
	// if (state) { await startTurn(); }
	await populateModelOptions();
	setupAudio();
};
export const populateModelOptions = async () => manifest.config.model.options = await runtime.call('inference.getAllAvailableModels');

const getResponse = async () => {
	const llmRequest = {
		model: config.model.split('/')[1],
		systemPrompt: config.systemPrompt,
		query: inject(config.queryTemplate, { transcript: currentTurn.stt.transcript }),
		responseFormat: 'JSON'
	};
	const response = await runtime.call('inference.prompt', llmRequest);
	currentTurn.llm = { ...llmRequest, response };
	return response;
};
const inject = (template, vars) => Object.entries(vars).reduce((str, [k, v]) => str.replaceAll(`{{${k}}}`, v), template);
// turn logic
const createTurn = () => ({ timestamp: Date.now(), stt: null, llm: null, tts: null, feedback: null });
const startTurn = async () => {
	state = 'input';
	currentTurn = createTurn();
	await listen();
}
const completeTurn = async () => {
	await stopListening(); 
	turns.push(currentTurn);
	await saveTurn();
	await startTurn();
	signal();
}
// handlers
const handleChunk = async (chunk) => {
	if (!chunk.finalizedAt) return;
	for (const h of handlers) {
		if (h.condition(chunk)) {
			try {
				await h.func(chunk);
				log.log(`${h.name} triggered`);
			}
			catch (e) { log.error(`Handler "${h.name}" failed:`, e); }
		}
	}
};
const handlers = [
	{ name: "start response",
		condition: (chunk) => state === 'input' && triggers.some(t => chunk.text.toLowerCase().includes(t)),
		func: async(chunk) => {
			state = 'response_done';
			await stopListening();
			const text = await getResponse();
			currentTurn.tts = await runtime.call('tts.speak', text);
			await saveTurn();
			await listen();
		}
	},
	{ name: "start feedback",
		condition: (chunk) => state === 'response_done' && chunk.text.toLowerCase().startsWith('feedback'),
		func: async(chunk) => { state = 'feedback'; await saveTurn(); }
	},
	{ name: "non-feedback after response",
		condition: (chunk) => state === 'response_done' && !chunk.text.toLowerCase().startsWith('feedback'),
		func: async(chunk) => await completeTurn()
	},
	{ name: "new turn end feedback",
		condition: (chunk) => state === 'feedback' && chunk.text.toLowerCase().includes('end feedback'),
		func: async(chunk) => {
			// remove remove first 'feedback' from start and 'end feedback' from end
			currentTurn.feedback = (currentTurn.feedback || '') + ' ' + chunk.text.replace(/end feedback/i, '').trim();
			await completeTurn();
		}
	}
];
// === AUDIO ===
const listen = async () => {
	// startNoise();
	await runtime.call('audio-recording.startRecording', { onTranscript: handleChunk });
};
const stopListening = async () => {
	// stopNoise();
	currentTurn.stt = await runtime.call('audio-recording.stopRecording');
};
const setupAudio = () => audioContext = new (window.AudioContext || window["webkitAudioContext"])();
const signal = () => beep(440, 100);
const beep = (freq, duration) => {
	const osc = audioContext.createOscillator(), gain = audioContext.createGain();
	osc.frequency.value = freq;
	gain.gain.setValueAtTime(0.1, audioContext.currentTime);
	gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);
	osc.connect(gain).connect(audioContext.destination);
	osc.start();
	osc.stop(audioContext.currentTime + duration / 1000);
};
let noiseNode = null;
const startNoise = () => {
	if (noiseNode) return;
	const bufferSize = 4096;
	const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
	const output = buffer.getChannelData(0);
	for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
	
	const whiteNoise = audioContext.createBufferSource();
	whiteNoise.buffer = buffer;
	whiteNoise.loop = true;
	
	const gainNode = audioContext.createGain();
	gainNode.gain.setValueAtTime(0, audioContext.currentTime);
	gainNode.gain.linearRampToValueAtTime(0.03, audioContext.currentTime + 0.3); // Fade in
	
	whiteNoise.connect(gainNode).connect(audioContext.destination);
	whiteNoise.start();
	noiseNode = { source: whiteNoise, gain: gainNode };
};
const stopNoise = () => {
	if (!noiseNode) return;
	noiseNode.gain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.2);
	setTimeout(() => { noiseNode.source.stop(); noiseNode = null; }, 250);
};
// === PERSISTENCE ===
const db = async (method, ...args) => await runtime.call(`indexed-db.${method}`, 'ThoughtPartnerDB', 'turns', ...args);
const saveState = async () => await runtime.call('chrome-local.set', { 'thought-partner.state': state });
const getState = async () => await runtime.call('chrome-local.get', 'thought-partner.state');
const loadTurns = async () => await db('getByIndexCursor', 'by-timestamp', 'prev', 50).catch(() => []);
const saveTurn = async () => {
	if (currentTurn.id) { await db('updateRecord', currentTurn); }
	else { currentTurn.id = await db('addRecord', currentTurn); }
}
// === UI ===
const refresh = async () => await runtime.call('layout.renderComponent', 'thought-partner-button');
export const buildButton = async () => ({ "power-button": { tag: "button", text: state === 'feedback' ? "🟠" : state === 'response_done' ? "🔵" : state === 'input' ? "🟢" : "⚫", class: "cognition-button", events: { click: "thought-partner.togglePower" } } });
// === POWER ===
export const togglePower = async () => {
	if (state) { await stopListening(); state = null; currentTurn = null; }
	else { await startTurn(); }
	await saveState(); await refresh();
};

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