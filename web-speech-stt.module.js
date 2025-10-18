import { configProxy } from "./config.module.js";
export const manifest = {
	name: "web-speech-stt",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Stateless speech-to-text transcription via Web Speech API",
	dependencies: [],
	actions: ["startListening", "stopListening", "toggleListening", "getStatus"],
	config: {
		language: {
			type: 'select',
			options: [{ value: 'en-US', text: 'English (US)' }, { value: 'en-GB', text: 'English (UK)' }, { value: 'es-ES', text: 'Spanish' }, { value: 'fr-FR', text: 'French' }, { value: 'de-DE', text: 'German' }, { value: 'ja-JP', text: 'Japanese' }, { value: 'zh-CN', text: 'Chinese' }],
			value: 'en-US',
			label: 'Recognition Language'
		},
		toggleKey: { type: 'globalKey', value: 'Ctrl+Space', label: 'Listen Toggle', action: "toggleListening" }
	}
};

const config = configProxy(manifest);
let runtime, log, recognition, isListening = false, onTranscript = (t) => { }, audioStartTime = 0;
export const initialize = async (rt, l) => { runtime = rt; log = l; setupRecognition(); };

const setupRecognition = () => {
	if (!window["webkitSpeechRecognition"]) return log.error('WebKit speech not supported');
	recognition = new window["webkitSpeechRecognition"]();
	Object.assign(recognition, { continuous: true, interimResults: true, lang: config.language });
	recognition.onstart = () => (isListening = true, audioStartTime = performance.now());
	recognition.onend = () => (isListening = false);
	recognition.onerror = (e) => (isListening = false, handleError(e));
	recognition.onresult = handleResult;
};
const handleResult = (event) => {
	const timestamp = performance.now() - audioStartTime;
	const lastResult = event.results[event.results.length - 1];
	const text = lastResult[0].transcript.trim();
	if (lastResult.isFinal) onTranscript({ text, timestamp, finalizedAt: Date.now() });
	else onTranscript({ text, timestamp });
};
const handleError = (e) => {
	if (['no-speech', 'audio-capture', 'network'].includes(e.error)) {
		restart();
		log.info('restarted on error', e.error);
	} else {
		log.error('Recognition error:', e.error);
	}
};
const restart = () => setTimeout(() => { try { recognition.start(); } catch (e) { log.error('Restart failed:', e); } }, 100);
export const startListening = async (callback = () => { }) => {
	if (!recognition || isListening) return;
	onTranscript = callback;
	try { recognition.start(); log.info('🎤 Listening started'); }
	catch (e) { log.error('Start failed:', e); throw e; }
};
export const stopListening = async () => {
	if (!recognition || !isListening) return;
	recognition.stop();
	onTranscript = () => { };
	log.info('🎤 Listening stopped');
};
export const toggleListening = async (callback) => isListening ? await stopListening() : await startListening(callback);
export const getStatus = () => ({ isListening, isSupported: !!(window["webkitSpeechRecognition"] && window.AudioContext), language: config.language });
