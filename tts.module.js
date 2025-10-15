export const manifest = {
    name: "tts",
    keywords: ["speak", "voice", "tts"],
    context: ["offscreen"],
    dependencies: ["transformer"],
    version: "1.0.0",
    description: "Local text-to-speech using Piper ONNX models",
    actions: ["speak", "setVoice", "listVoices", "getCurrentVoice", "testVoices"],
    externalDependencies: [
        // Voice models - starting with 1 low-quality English voice for testing (~10MB)
        // en_US-lessac-low (General American - Female, clear)
        { url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/low/en_US-lessac-low.onnx', destination: 'models/piper/voices/', sha256: 'f7d01dde371555732c4c314111ac79672b1a5ce2fc19266ab42178fd8df7f375' },
        { url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/low/en_US-lessac-low.onnx.json', destination: 'models/piper/voices/', sha256: '45754dfdebb3b8661c3fc564713772deec6e064feeb5b4e9594857dc7305193a' },

        // TODO: Add more voices after testing:
        // { url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/low/en_US-amy-low.onnx', destination: 'models/piper/voices/', sha256: 'TBD' },
        // { url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/low/en_US-amy-low.onnx.json', destination: 'models/piper/voices/', sha256: 'TBD' },
        // { url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alan/low/en_GB-alan-low.onnx', destination: 'models/piper/voices/', sha256: 'TBD' },
        // { url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alan/low/en_GB-alan-low.onnx.json', destination: 'models/piper/voices/', sha256: 'TBD' },
    ],
    config: {
        defaultVoice: { type: 'select', value: 'en_US-lessac-low', label: 'Default Voice', options: ['en_US-lessac-low', 'en_US-amy-low', 'en_GB-alan-low'] },
        lengthScale: { type: 'number', value: 1.0, min: 0.5, max: 2.0, step: 0.1, label: 'Speed (lower=faster)', description: 'Controls speaking rate' },
        noiseScale: { type: 'number', value: 0.667, min: 0.0, max: 1.0, step: 0.05, label: 'Noise Scale', description: 'Variability in speech' },
        noiseW: { type: 'number', value: 0.8, min: 0.0, max: 1.0, step: 0.05, label: 'Noise Width', description: 'Duration variability' },
        autoPlay: { type: 'checkbox', value: true, label: 'Auto-play generated speech' }
    }
};

let runtime, log;
let currentVoice = manifest.config.defaultVoice.value;
let audioContext = null;
let piperEngine = null;

export const initialize = async (rt, l) => {
    runtime = rt;
    log = l;
    audioContext = new AudioContext();

    // Initialize Piper engine with local paths
    const { PiperWebEngine } = await import(chrome.runtime.getURL('libs/index.js'));

    piperEngine = new PiperWebEngine({
        wasmPaths: {
            phonemize: chrome.runtime.getURL('models/piper/piper_phonemize.wasm'),
            phonemizeData: chrome.runtime.getURL('models/piper/piper_phonemize.data'),
            espeakData: chrome.runtime.getURL('models/piper/espeak-ng-data')
        }
    });

    log.log(` TTS initialized with voice: ${currentVoice}`);
};

// Voice management
export const listVoices = () => manifest.config.defaultVoice.options;
export const getCurrentVoice = () => currentVoice;
export const setVoice = (voiceId) => {
    if (!manifest.config.defaultVoice.options.includes(voiceId)) {
        throw new Error(`Voice not found: ${voiceId}. Available: ${manifest.config.defaultVoice.options.join(', ')}`);
    }
    currentVoice = voiceId;
    log.log(` Voice changed to: ${currentVoice}`);
    return currentVoice;
};

// Main TTS function
export const speak = async (text, options = {}) => {
    if (!text) throw new Error('Text required for TTS');

    const voiceId = options.voice || currentVoice;
    const lengthScale = options.lengthScale || manifest.config.lengthScale.value;
    const noiseScale = options.noiseScale || manifest.config.noiseScale.value;
    const noiseW = options.noiseW || manifest.config.noiseW.value;

    log.log(` Speaking: "${text.substring(0, 50)}..." with voice ${voiceId}`);

    try {
        const startTime = performance.now();

        // Load voice model paths
        const modelPath = chrome.runtime.getURL(`models/piper/voices/${voiceId}.onnx`);
        const configPath = chrome.runtime.getURL(`models/piper/voices/${voiceId}.onnx.json`);

        // Generate speech using Piper
        const response = await piperEngine.generate(text, {
            modelPath,
            configPath,
            lengthScale,
            noiseScale,
            noiseW
        });

        const endTime = performance.now();
        log.log(` Generated speech in ${(endTime - startTime).toFixed(2)}ms`);

        // Convert WAV blob to AudioBuffer
        const audioBuffer = await wavBlobToAudioBuffer(response.audio);

        // Play audio if enabled
        if (manifest.config.autoPlay.value) {
            await playAudio(audioBuffer);
        }

        return {
            audioBuffer,
            audioBlob: response.audio,
            voiceId,
            duration: audioBuffer.duration,
            processingTime: endTime - startTime
        };

    } catch (error) {
        log.error(` TTS failed:`, error);
        throw error;
    }
};

// Test all voices
export const testVoices = async () => {
    const testText = "Hello! This is a test of the text to speech system.";
    log.log(`\n🎤 TESTING ALL VOICES:`);

    const results = [];
    for (const voiceId of manifest.config.defaultVoice.options) {
        try {
            log.log(`\n🔊 Testing ${voiceId}...`);
            const startTime = performance.now();
            const result = await speak(testText, { voice: voiceId });
            const duration = performance.now() - startTime;

            results.push({
                voice: voiceId,
                success: true,
                processingTime: Math.round(duration),
                audioDuration: result.duration.toFixed(2) + 's'
            });

            log.log(`   ✅ Success: ${Math.round(duration)}ms processing`);

        } catch (error) {
            results.push({
                voice: voiceId,
                success: false,
                error: error.message
            });
            log.log(`   ❌ Failed: ${error.message}`);
        }
    }

    log.log(`\n📊 VOICE TEST RESULTS:`);
    console.table(results);
    return results;
};

// Helper functions
const wavBlobToAudioBuffer = async (blob) => {
    const arrayBuffer = await blob.arrayBuffer();
    return await audioContext.decodeAudioData(arrayBuffer);
};

const playAudio = async (audioBuffer) => {
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start();

    // Wait for audio to finish
    return new Promise(resolve => {
        source.onended = resolve;
    });
};