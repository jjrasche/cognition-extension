import { getId } from "./helpers.js";
import { configProxy } from "./config.module.js";

export const manifest = {
	name: "web-speech-stt",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Web speech recognition streaming to UI",
	actions: ["startListening", "stopListening", "toggleListening", "getStatus", "getRecordings", "loadRecording", "seekAudio", "togglePlayback"],
	uiComponents: [
		{ name: "stt-indicator", getTree: "buildIndicator", zLayer: "SYSTEM" },
		{ name: "transcript-viewer", getTree: "buildTranscriptViewer" }
	],
	config: {
		language: { type: 'select', options: ['en-US', 'es-ES'], value: 'en-US' },
		pauseThreshold: { type: 'number', min: 500, max: 3000, value: 1500 },
		toggleKey: { type: 'globalKey', value: 'Ctrl+Space', label: 'Listen Toggle Key', action: "toggleListening" }
	},
	indexeddb: { name: 'AudioStorage', version: 1, storeConfigs: [{ name: 'recordings', options: { keyPath: 'id' } }] }
};
let runtime, recognition, mediaRecorder, audioStream, isListening = false, currentTranscript = '', lastFinalTime = Date.now(), pauseBasedThoughts = [];
let currentRecording = null, audioElement = null, wordTimings = [];
const config = configProxy(manifest);
export const initialize = async (rt) => { runtime = rt; setupRecognition(); }

const setupRecognition = () => {
	if (!window["webkitSpeechRecognition"]) return runtime.logError('[Transcript] WebKit speech not supported');
	recognition = new window["webkitSpeechRecognition"]();
	recognition.continuous = true, recognition.interimResults = true, recognition.lang = config.language;
	recognition.onstart = () => handleRecognitionEvent(true);
	recognition.onend = () => handleRecognitionEvent(false);
	recognition.onerror = (e) => handleRecognitionEvent(false, e);
	recognition.onresult = (event) => handleResultEvent(event);
}
const handleResultEvent = async (event) => {
	let interim = '', final = '';
	for (let i = event.resultIndex; i < event.results.length; i++) {
		const transcript = event.results[i][0].transcript;
		event.results[i].isFinal ? (final += transcript) : (interim += transcript);
	}
	if (final) detectThoughtBoundary(final);
	const t = currentTranscript + interim
	runtime.log(t) // todo: do something useful
}
const handleRecognitionEvent = async (state, e) => {
	isListening = state;
	e && runtime.logError('[Transcript] Error:', e.error);
	await runtime.call('layout.renderComponent', 'stt-indicator');
}
export const toggleListening = async () => isListening ? stopListening() : startListening();
const detectThoughtBoundary = (newText) => {
	const now = Date.now();
	const pauseDuration = now - lastFinalTime;
	if (pauseDuration > config.pauseThreshold || pauseBasedThoughts.length === 0) {
		const id = getId();
		pauseBasedThoughts.push({ text: newText.trim(), id, timestamp: now, pauseBefore: pauseDuration });
		runtime.call('live-chunker.processThought', { id, timestamp: now, pauseDuration, text: newText.trim() });
	}
	else pauseBasedThoughts[pauseBasedThoughts.length - 1].text += ' ' + newText.trim();
	lastFinalTime = now;
};
export const startListening = async () => {
	if (!recognition) throw new Error('Speech recognition not available');
	if (isListening) return;
	recognition.start();
	startRecording();
};
export const stopListening = async () => {
	if (!recognition || !isListening) return;
	recognition.stop();
	await stopRecording();
}
export const getStatus = async () => ({ isListening, currentTranscript, isSupported: !!window["webkitSpeechRecognition"] });
const startRecording = async () => {
	try {
		audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		mediaRecorder = new MediaRecorder(audioStream);
		let chunks = [];
		mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
		// mediaRecorder.onstop = async () => await runtime.call('indexed-db.addRecord', 'AudioStorage', 'recordings', {
		// 	id: getId('audio-'),
		// 	blob: new Blob(chunks, { type: 'audio/webm' }),
		// 	timestamp: new Date().toISOString(),
		// 	transcript: currentTranscript
		// });
		mediaRecorder.onstop = async () => {
			try {
				const record = {
					id: getId('audio-'),
					blob: new Blob(chunks, { type: 'audio/webm' }),
					timestamp: new Date().toISOString(),
					transcript: currentTranscript
				};
				runtime.log('[STT] Saving audio record:', { id: record.id, blobSize: record.blob.size });
				await runtime.call('indexed-db.addRecord', 'AudioStorage', 'recordings', record);
				runtime.log('[STT] Audio record saved successfully');
			} catch (error) {
				runtime.logError('[STT] Failed to save audio record:', error);
			}
		};
		mediaRecorder.start();
	} catch (error) { runtime.logError('[STT] Recording failed:', error); }
};
const stopRecording = async () => {
	if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
	if (audioStream) { audioStream.getTracks().forEach(track => track.stop()); audioStream = null; }
	mediaRecorder = null;
};
// UI
export const buildIndicator = () => !isListening ? null : { "recording-indicator": { tag: "div", text: "🔴", style: "display: flex; align-items: center; justify-content: center; background: rgba(239, 68, 68, 0.9); color: white; border-radius: 50%; width: 100%; height: 100%; animation: pulse 1.5s infinite;" } };