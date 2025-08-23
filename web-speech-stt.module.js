import { getId } from "./helpers.js";

export const manifest = {
  name: "web-speech-stt",
  context: ["extension-page"],
  version: "1.0.0", 
  description: "Web speech recognition streaming to UI",
  dependencies: ["ui"],
  actions: ["startListening", "stopListening", "getStatus"],
};
                // "mic-button": { tag: "button", id: "mic-button", text: "🎤", class: "cognition-button-secondary", style: "min-width: 40px; height: 40px; border-radius: 50%; font-size: 18px;", events: { click: "ui.toggleListening" } }


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

let runtime, recognition, isListening = false, currentTranscript = '';
let lastFinalTime = Date.now();
let pauseBasedThoughts = [];
export const initialize = async (rt) => {
  runtime = rt;
  if (!window["webkitSpeechRecognition"]) return runtime.logError('[Transcript] WebKit speech not supported');
  recognition = new window["webkitSpeechRecognition"]();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.onstart = () => (isListening = true, runtime.log('[Transcript] Started'));
  recognition.onend = () => (isListening = false, runtime.log('[Transcript] Ended'));
  recognition.onerror = (e) => (isListening = false, runtime.logError('[Transcript] Error:', e.error));
  
  recognition.onresult = async (event) => {
    let interim = '', final = '';
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      event.results[i].isFinal ? (final += transcript) : (interim += transcript);
    }
    if (final) {
      currentTranscript += processVoiceCommands(final);
      detectThoughtBoundary(final);
      runtime.log('[Transcript] Final added:', final);
    }
    await runtime.call('ui.updatePrompt', currentTranscript + interim);
  };
};

// Add this function
const detectThoughtBoundary = (finalText) => {
  const now = Date.now();
  const pauseDuration = now - lastFinalTime;
  
  // If significant pause (1500ms+) or this is first thought
  if (pauseDuration > 1500 || pauseBasedThoughts.length === 0) {
    // Create new thought
    const thoughtId = getId();
    pauseBasedThoughts.push({
      text: finalText.trim(),
      id: thoughtId,
      timestamp: now,
      pauseBefore: pauseDuration
    });
    
    runtime.log(`[Transcript] New thought boundary detected (${pauseDuration}ms pause):`, finalText);
    
    // Notify live-chunker of new thought
    runtime.call('live-chunker.processThought', {
      id: thoughtId,
      text: finalText.trim(),
      timestamp: now,
      pauseDuration
    });
  } else {
    // Append to current thought
    const currentThought = pauseBasedThoughts[pauseBasedThoughts.length - 1];
    currentThought.text += ' ' + finalText.trim();
    
    runtime.log(`[Transcript] Extending current thought:`, currentThought.text);
  }
  
  lastFinalTime = now;
};

export const startListening = async () => {
	if (!recognition) throw new Error('Speech recognition not available');
	if (isListening) return;
	recognition.start();
};
export const stopListening = async () => {
	if (!recognition || !isListening) return;
	recognition.stop();
};
export const getStatus = async () => ({ isListening, currentTranscript, isSupported: !!window["webkitSpeechRecognition"] });

const processVoiceCommands = (text) => {
  return text
    .replace(/\bperiod\b/gi, '.')
    .replace(/\bcomma\b/gi, ',')
    .replace(/\bquestion mark\b/gi, '?')
    .replace(/\bexclamation point\b/gi, '!')
    .replace(/\bnew paragraph\b/gi, '\n\n')
    .replace(/\bnew line\b/gi, '\n');
};

// export const manifest = {
//   name: "transcript",
//   context: ["offscreen"], // Run with transformer module
//   version: "1.0.0", 
//   description: "Local speech transcription using Whisper Base",
//   dependencies: ["transformer"],
//   actions: ["start", "stop", "getStatus", "transcribe"],
//   externalDependencies: [
//     { url: 'https://huggingface.co/Xenova/whisper-base.en/resolve/main/onnx/encoder_model.onnx', destination: 'models/Xenova/whisper-base.en/onnx/', sha256: '3AF4D8B7515F01F1C313AFE0D691768FF084169B8E1EC1CB4D975CE2AC465F6E' },
//     { url: 'https://huggingface.co/Xenova/whisper-base.en/resolve/main/onnx/decoder_model_merged.onnx', destination: 'models/Xenova/whisper-base.en/onnx/', sha256: 'E2B3D8E71A16E9462C2849FFB79B2966DA800997AAB299BFB9A754BA3CAA54C1' },
//     { url: 'https://huggingface.co/Xenova/whisper-base.en/resolve/main/tokenizer.json', destination: 'models/Xenova/whisper-base.en/', sha256: 'C6EE8F089220A5B1188F6426456772572671C6141AE007EECB83C6A8349F5DEB' },
//     { url: 'https://huggingface.co/Xenova/whisper-base.en/resolve/main/config.json', destination: 'models/Xenova/whisper-base.en/', sha256: '5C390F2C6BA84DDEB7E362CD8B2123832911407850174E64D7081CCC36DF2D64' },
//     { url: 'https://huggingface.co/Xenova/whisper-base.en/resolve/main/generation_config.json', destination: 'models/Xenova/whisper-base.en/', sha256: '1E57ED56AD1BD7F08A49ECE7FE7DAADA674573805A35F8BDBBE68380AAB5B1EE' },
//     { url: 'https://huggingface.co/Xenova/whisper-base.en/resolve/main/preprocessor_config.json', destination: 'models/Xenova/whisper-base.en/', sha256: 'A6A76D28C93EDB273669EB9E0B0636A2BDDBB1272C3261E47B7CA6DFDBAC1B8D' },
//   ],
//   localModels: [
//     { name: "Xenova/whisper-base.en", options: { device: 'webgpu', dtype: 'fp16', local_files_only: true } }
//   ]
// };

// let runtime;
// let whisperPipeline = null;

// export async function initialize(rt) {
//   runtime = rt;
//   runtime.log('[Transcript] Loading Whisper Base model...');
  
//   // Load the model via transformer module
//   whisperPipeline = await runtime.call('transformer.getModel', 'Xenova/whisper-base.en-webgpu-fp16');
  
//   runtime.log('[Transcript] Whisper Base ready for transcription');
// }

// export async function transcribe(params) {
//   const { audioData } = params; // Float32Array of 16kHz audio
  
//   if (!whisperPipeline) {
//     throw new Error('Whisper model not loaded');
//   }
  
//   const result = await whisperPipeline(audioData);
  
//   return {
//     text: result.text,
//     confidence: result.confidence || 1.0,
//     processingTime: result.processingTime
//   };
// }

// export async function start(params = {}) {
//   // Start continuous transcription (to be implemented)
//   // Will need VAD + chunking logic
//   return { success: true, message: 'Transcription started' };
// }

// export async function stop() {
//   return { success: true, message: 'Transcription stopped' };
// }

// export async function getStatus() {
//   return {
//     modelLoaded: !!whisperPipeline,
//     modelName: 'Xenova/whisper-base.en'
//   };
// }