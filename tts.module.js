import { configProxy } from './config.module.js';
export const manifest = {
    name: "tts",
    keywords: ["speak", "voice", "tts"],
    context: ["extension-page"],
    version: "1.0.0",
    description: "Text-to-speech using Web Speech API (instant, no downloads)",
    actions: ["speak", "stop", "listVoices", "setVoice", "getCurrentVoice"],
    config: {
        defaultVoice: { type: 'select', value: 'Chrome OS US English 5', label: 'Preferred Voice', options: [] },
        rate: { type: 'number', value: 1.6, min: 0.5, max: 3.0, step: 0.1, label: 'Speech Rate' },
        pitch: { type: 'number', value: .6, min: 0.5, max: 2.0, step: 0.1, label: 'Pitch' },
    }
};
const config = configProxy(manifest);
let runtime, log, synthesis, currentUtterance;

export const initialize = async (rt, l) => {
    runtime = rt;
    log = l;
    synthesis = window.speechSynthesis;

    if (!synthesis) {
        log.error(' Web Speech API not supported');
        return;
    }

    // Wait for voices to load
    if (synthesis.getVoices().length === 0) {
        await new Promise(resolve => { synthesis.onvoiceschanged = () => resolve(); });
    }

    // Populate voice options in config
    const voices = synthesis.getVoices().filter(v => v.lang.startsWith('en'));
    manifest.config.defaultVoice.options = voices.map(v => ({ value: v.name, text: `${v.name} (${v.lang})${v.localService ? ' [Local]' : ''}` }));
};

export const listVoices = () => synthesis.getVoices()
    .filter(v => v.lang.startsWith('en'))
    .map(v => ({ name: v.name, lang: v.lang, local: v.localService }));

export const getCurrentVoice = () => manifest.config.defaultVoice.value || 'Default';

export const setVoice = (voiceName) => {
    const voice = synthesis.getVoices().find(v => v.name === voiceName);
    if (!voice) throw new Error(`Voice not found: ${voiceName}`);
    manifest.config.defaultVoice.value = voiceName;
    log.log(` Voice changed to: ${voiceName}`);
    return voiceName;
};

export const speak = async (text, options = {}) => {
    if (!text?.trim()) throw new Error('Text required for TTS');

    // Stop any ongoing speech
    if (currentUtterance) synthesis.cancel();
    currentUtterance = new SpeechSynthesisUtterance(text);

    // Apply voice if specified
    const voiceName = options.voice || manifest.config.defaultVoice.value;
    if (voiceName) {
        const voice = synthesis.getVoices().find(v => v.name === voiceName);
        if (voice) currentUtterance.voice = voice;
    }

    // Apply settings
    currentUtterance.rate = options.rate ?? config.rate;
    currentUtterance.pitch = options.pitch ?? config.pitch;

    return new Promise((resolve, reject) => {
        currentUtterance.onend = () => {
            currentUtterance = null;
            resolve({ success: true, text });
        };

        currentUtterance.onerror = (e) => {
            currentUtterance = null;
            reject(new Error(`TTS error: ${e.error}`));
        };

        synthesis.speak(currentUtterance);
        log.log(` Speaking: "${text.substring(0, 50)}..."`);
    });
};

export const stop = () => {
    if (currentUtterance) {
        synthesis.cancel();
        currentUtterance = null;
        log.log(' Speech stopped');
    }
};