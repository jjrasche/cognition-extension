export const manifest = {
	name: "web-speech-tts",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Text-to-speech using Web Speech API with native voice preference",
	dependencies: ["chrome-sync"],
	actions: ["speak", "stop", "getVoices", "setVoice", "getStatus", "getSettings", "saveSettings"]
};

// "settings-button": { tag: "button", text: "⚙️", class: "cognition-button-secondary", style: "min-width: 40px; height: 40px; border-radius: 50%; font-size: 16px;", events: { click: "ui.showTTSControls" } },
// "speech-button": { tag: "button", id: "speech-button", text: "🔊", class: "cognition-button-secondary", style: "min-width: 40px; height: 40px; border-radius: 50%; font-size: 18px;", events: { click: "ui.speakPrompt" } },


// const getSpeechButton = () => document.querySelector('#speech-button') ?? (() => { throw new Error('Speech button not found'); })();
// export const speakPrompt = async () => {
//   const text = getSearchInput()?.["value"]?.trim();
//   if (!text) return;

//   const button = getSpeechButton();
//   button.textContent = '⏳';

//   try {
//     const settings = await runtime.call('web-speech-tts.getSettings');
//     const result = await runtime.call('tts.speak', text, settings);
//     if (!result.success) runtime.logError('[UI] TTS failed:', result.error);
//   } catch (error) {
//     runtime.logError('[UI] TTS error:', error);
//   } finally {
//     button.textContent = '🔊';
//   }
// };


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


let runtime, synthesis, currentUtterance, preferredVoice;

export const initialize = async (rt) => {
	runtime = rt;
	synthesis = window.speechSynthesis;
	if (!synthesis) return runtime.logError('[TTS] Speech synthesis not supported');

	preferredVoice = await loadVoicePreference();
	setupVoiceLoadListener();
};

const setupVoiceLoadListener = () => synthesis.onvoiceschanged = () => runtime.log('[TTS] Voices loaded:', synthesis.getVoices().length);

// Add to TTS module - enhanced speak function with controls
export const speak = async (text, options = {}) => {
	if (!text?.trim()) return { success: false, error: 'No text provided' };

	stop(); // Interrupt any current speech

	// Apply text processing for spacing if requested
	const processedText = options.addPauses ? addSpacingPauses(text) : text;

	currentUtterance = new SpeechSynthesisUtterance(processedText);
	applyVoiceSettings(currentUtterance, options);

	return new Promise((resolve) => {
		currentUtterance.onend = () => (currentUtterance = null, resolve({ success: true }));
		currentUtterance.onerror = (e) => (currentUtterance = null, resolve({ success: false, error: e.error }));
		synthesis.speak(currentUtterance);
	});
};

const applyVoiceSettings = (utterance, options) => {
	const voice = getSelectedVoice();
	if (voice) utterance.voice = voice;
	utterance.rate = clamp(options.rate ?? 1, 0.1, 10);
	utterance.pitch = clamp(options.pitch ?? 1, 0, 2);
	utterance.volume = clamp(options.volume ?? 0.8, 0, 1);
};

// Helper functions
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const addSpacingPauses = (text) => text.replace(/\s+/g, ', '); // Replace spaces with commas for slight pauses

// Get/set TTS settings from Chrome sync
export const getSettings = async () => ({
	rate: await runtime.call('chrome-sync.get', 'tts.rate') || 1,
	pitch: await runtime.call('chrome-sync.get', 'tts.pitch') || 1,
	volume: await runtime.call('chrome-sync.get', 'tts.volume') || 0.8,
	addPauses: await runtime.call('chrome-sync.get', 'tts.addPauses') || false
});

export const saveSettings = async (settings) => await runtime.call('chrome-sync.set', {
	'tts.rate': settings.rate,
	'tts.pitch': settings.pitch,
	'tts.volume': settings.volume,
	'tts.addPauses': settings.addPauses
});

export const stop = async () => {
	if (synthesis.speaking || synthesis.pending) synthesis.cancel();
	currentUtterance = null;
	return { success: true };
};

export const getVoices = async () => ({
	all: synthesis.getVoices().map(formatVoice),
	native: synthesis.getVoices().filter(v => v.localService).map(formatVoice),
	preferred: preferredVoice
});

const formatVoice = (voice) => ({
	name: voice.name,
	lang: voice.lang,
	isNative: voice.localService,
	isDefault: voice.default
});

export const setVoice = async (voiceName) => {
	const voice = synthesis.getVoices().find(v => v.name === voiceName);
	if (!voice) return { success: false, error: 'Voice not found' };

	preferredVoice = voiceName;
	await saveVoicePreference(voiceName);
	return { success: true, voice: formatVoice(voice) };
};

export const getStatus = async () => ({
	isSupported: !!synthesis,
	isSpeaking: synthesis?.speaking || false,
	isPending: synthesis?.pending || false,
	voicesLoaded: synthesis?.getVoices().length > 0,
	currentText: currentUtterance?.text || null,
	preferredVoice
});

// Voice preference management
const getSelectedVoice = () => {
	const voices = synthesis.getVoices();
	if (!voices.length) return null;

	// Try preferred voice first
	if (preferredVoice) {
		const preferred = voices.find(v => v.name === preferredVoice);
		if (preferred) return preferred;
	}

	// Fallback to first native voice for speed
	const nativeVoice = voices.find(v => v.localService);
	if (nativeVoice) return nativeVoice;

	// Last resort: default voice
	return voices.find(v => v.default) || voices[0];
};

const loadVoicePreference = async () => await runtime.call('chrome-sync.get', 'tts.preferredVoice');
const saveVoicePreference = async (voiceName) => await runtime.call('chrome-sync.set', { 'tts.preferredVoice': voiceName });