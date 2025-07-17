

/**
 * Transcript Module - Bridge to Web Speech API for live transcription
 * Provides real-time speech recognition and transcription capabilities


Summary: Transcript Module Approach
Decision: Dedicated transcript tab

Open a chrome-extension://[id]/transcript.html page
One-time microphone permission (remembered for extension)
Clean tab management: if transcript tab exists, focus it; else create it
Full control over UI/UX in the transcript page
No complex content script injection needed

Two possible modes:

Microphone transcription - Web Speech API (what we're building)
Tab audio transcription - chrome.tabCapture API (future feature)

*/

// Module manifest
export const manifest = {
  name: "Transcript",
  version: "1.0.0",
  permissions: ["storage"],
  actions: ["startTranscription", "stopTranscription"],
  state: {
    reads: [],
    writes: ["speech.transcript.current", "speech.transcript.history"]
  }
};

let recognition = null;

export async function initialize(state, config) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.error('Web Speech API not supported in this browser.');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = config?.lang || 'en-US';
  recognition.onresult = (event) => processRecognitionResult(state, event);
  recognition.onerror = (event) => console.error('SpeechRecognition error:', event.error);
  recognition.onend = () => console.log('SpeechRecognition ended');
}

const processRecognitionResult = async (state,event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result.isFinal) continue;
      const transcript = result[0].transcript.trim();
      const confidence = result[0].confidence;
      const timestamp = new Date().toISOString();
      const segment = { text: transcript, confidence, timestamp };

      await state.write('speech.transcript.current', segment);
      const existing = (await state.read('speech.transcript.history')) || [];
      existing.push(segment);
      await state.write('speech.transcript.history', existing);
    }    
}

export const startTranscription = () => {
  verifySpeechModuleInitialized();
  return recognition.start().then(() => ({ success: true }));
};

export const stopTranscription = () => {
  verifySpeechModuleInitialized();
  return recognition.stop().then(() => ({ success: true }));
};

const verifySpeechModuleInitialized = () => {
  if (!recognition) {
    throw new Error('speech-module not initialized. Call initialize() first.');
  }
};

// ----------------------
// Tests
// ----------------------
export const tests = [
  {
    name: 'initialize_setsUpRecognition',
    fn: async () => {
      // Mock SpeechRecognition constructor
      let created = null;
      const MockRecon = function() { created = this; };
      MockRecon.prototype.start = () => {};
      MockRecon.prototype.stop = () => {};
      window.SpeechRecognition = MockRecon;

      const mockState = createMockState();
      await initialize(mockState, { lang: 'en-US' });
      // Ensure recognition instance exists and has correct settings
      assert(created instanceof MockRecon);
      assert(typeof created.start === 'function');
      assert(typeof created.stop === 'function');
    }
  },
  {
    name: 'startTranscription_callsRecognitionStart',
    fn: async () => {
      // Spy on start
      let started = false;
      const MockRecon = function() { this.start = () => { started = true }; };
      window.SpeechRecognition = MockRecon;

      const mockState = createMockState();
      await initialize(mockState, {});
      startTranscription();
      assert(started === true);
    }
  },
  {
    name: 'stopTranscription_callsRecognitionStop',
    fn: async () => {
      // Spy on stop
      let stopped = false;
      const MockRecon = function() { this.stop = () => { stopped = true }; };
      window.SpeechRecognition = MockRecon;

      const mockState = createMockState();
      await initialize(mockState, {});
      stopTranscription();
      assert(stopped === true);
    }
  },
  {
    name: 'onResult_finalSegment_updatesCurrentAndHistory',
    fn: async () => {
      // Setup recognition and mockState
      const MockRecon = function() {};
      window.SpeechRecognition = MockRecon;
      const mockState = createMockState();
      await initialize(mockState, {});

      // Prepare fake event with one interim and one final result
      const fakeEvent = {
        resultIndex: 0,
        results: [
          { isFinal: false, 0: { transcript: 'hello world', confidence: 0.5 } },
          { isFinal: true,  0: { transcript: 'test done',   confidence: 0.9 } }
        ]
      };
      // Invoke handler directly
      await recognition.onresult(fakeEvent);

      // Check writes
      const current = await mockState.read('speech.transcript.current');
      assert(current.text === 'test done');
      assert(current.confidence === 0.9);

      const history = await mockState.read('speech.transcript.history');
      assert(Array.isArray(history));
      assert(history.length === 1);
      assert(history[0].text === 'test done');
    }
  }
];
