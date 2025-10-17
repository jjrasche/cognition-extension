import { getId } from "./helpers.js";

export const manifest = {
    name: "audio-recordings",
    context: ["extension-page"],
    version: "1.0.0",
    description: "Manage audio recording sessions with coordinated speech transcription and persistence",
    dependencies: ["indexed-db", "web-speech-stt"],
    actions: ["startRecording", "stopRecording", "toggleRecording", "getRecordings", "getRecording", "deleteRecording", "updateRecording", "isRecording"],
    indexeddb: {
        name: 'AudioRecordingsDB', version: 1,
        storeConfigs: [{ name: 'recordings', options: { keyPath: 'id' }, indexes: [{ name: 'by-timestamp', keyPath: 'timestamp' }] }]
    }
};

let runtime, log, activeRecording = null;
export const initialize = async (rt, l) => { runtime = rt; log = l; };
// === Persistence ===
const db = async (method, ...args) => await runtime.call(`indexed-db.${method}`, 'AudioRecordingsDB', 'recordings', ...args);
export const getRecordings = async (limit = 50) => (await db('getByIndexCursor', 'by-timestamp', 'prev', limit).catch(() => [])).map(formatSummary);
export const getRecording = async (id) => await db('getRecord', id) ?? (() => { throw new Error('Recording not found'); })();
export const deleteRecording = (id) => db('removeRecord', id).then(() => (log.info(`🗑️ Deleted: ${id}`), true)).catch(() => false);
export const updateRecording = async (id, updates) => await db('updateRecord', { ...await getRecording(id), ...updates });
// === Logic ===
export const startRecording = async (options = {}) => {
    if (activeRecording) throw new Error('Recording already in progress');
    const { onTranscript = () => { }, finalizationDelay = 0, language = 'en-US' } = options;
    activeRecording = { id: getId('rec-'), audioChunks: [], chunks: [], startTime: Date.now(), language, onTranscript };
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 48000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        recorder.ondataavailable = (e) => activeRecording.audioChunks.push(e.data);
        recorder.start();
        Object.assign(activeRecording, { mediaRecorder: recorder, stream });
        await runtime.call('web-speech-stt.startListening', (chunk) => handleTranscriptChunk(chunk), finalizationDelay);
        log.info(`📹 Started: ${activeRecording.id}`);
        return activeRecording.id;
    } catch (error) { activeRecording = null; throw error; }
};
export const stopRecording = async () => {
    if (!activeRecording) return null;
    const recording = activeRecording;
    activeRecording = null;
    try {
        await runtime.call('web-speech-stt.stopListening');
        recording.mediaRecorder?.stop();
        recording.stream?.getTracks().forEach(track => track.stop());
        await new Promise(resolve => recording.mediaRecorder.state === 'inactive' ? resolve() : (recording.mediaRecorder.onstop = resolve));
        const final = await buildRecording(recording);
        await db('addRecord', final);
        log.info(`💾 Saved: ${final.id}`, { duration: final.duration, chunks: final.chunks.length });
        return final;
    } catch (error) { log.error('Save failed:', error); throw error; }
};
export const toggleRecording = async (options = {}) => activeRecording ? await stopRecording() : await startRecording(options);
export const isRecording = () => !!activeRecording;
const handleTranscriptChunk = (chunk) => {
    if (!activeRecording) return;
    if (chunk.finalizedAt) activeRecording.chunks.push({ text: chunk.text, timestamp: chunk.timestamp });
    activeRecording.onTranscript(chunk);
};
const buildRecording = async (rec) => {
    const audioBlob = new Blob(rec.audioChunks, { type: 'audio/webm' });
    return {
        id: rec.id,
        audioBlob,
        chunks: rec.chunks,
        duration: (Date.now() - rec.startTime) / 1000,
        timestamp: new Date(rec.startTime).toISOString(),
        language: rec.language,
        goldStandard: '',
        get transcript() { return this.chunks.map(c => c.text).join(' '); }
    };
};
const formatSummary = (r) => ({
    id: r.id,
    preview: r.transcript?.substring(0, 100) + (r.transcript?.length > 100 ? '...' : '') || r.chunks.map(c => c.text).join(' ').substring(0, 100),
    duration: r.duration,
    timestamp: r.timestamp,
    language: r.language,
    chunkCount: r.chunks.length,
    hasGold: !!r.goldStandard
});
// === TESTING ===
export const test = async () => {
    const { runUnitTest, deepEqual } = runtime.testUtils;
    return [
        await runUnitTest("Transcript from chunks (no duplication)", async () => {
            const mockRec = { chunks: [{ text: 'hello', timestamp: 1000 }, { text: 'world', timestamp: 2000 }] };
            Object.defineProperty(mockRec, 'transcript', { get() { return this.chunks.map(c => c.text).join(' '); } });
            const actual = { transcript: mockRec.transcript, hasTranscriptProp: 'transcript' in mockRec };
            return { actual, assert: deepEqual, expected: { transcript: 'hello world', hasTranscriptProp: true } };
        }),
        await runUnitTest("Format summary handles missing transcript", async () => {
            const withTranscript = { id: 'r1', transcript: 'x'.repeat(150), chunks: [], duration: 30, timestamp: '', language: 'en' };
            const withoutTranscript = { id: 'r2', chunks: [{ text: 'hello' }], duration: 30, timestamp: '', language: 'en' };
            const actual = {
                truncated: formatSummary(withTranscript).preview.endsWith('...'),
                fallback: formatSummary(withoutTranscript).preview
            };
            return { actual, assert: deepEqual, expected: { truncated: true, fallback: 'hello' } };
        }),
        await runUnitTest("Build recording structure", async () => {
            const mockSession = {
                id: 'rec-test',
                audioChunks: [new Blob(['test'], { type: 'audio/webm' })],
                chunks: [{ text: 'hello', timestamp: 1000 }, { text: 'world', timestamp: 2000 }],
                startTime: Date.now() - 5000,
                language: 'en-US'
            };
            const final = await buildRecording(mockSession);
            const actual = {
                hasBlob: final.audioBlob instanceof Blob,
                transcript: final.transcript,
                chunkCount: final.chunks.length,
                hasDuration: final.duration > 0
            };
            return { actual, assert: deepEqual, expected: { hasBlob: true, transcript: 'hello world', chunkCount: 2, hasDuration: true } };
        }),
        await runUnitTest("Handle transcript chunk filtering", async () => {
            const chunks = [];
            const mockActive = { chunks, onTranscript: () => { } };
            activeRecording = mockActive;
            handleTranscriptChunk({ text: 'interim', timestamp: 1000 });
            handleTranscriptChunk({ text: 'final', timestamp: 2000, finalizedAt: Date.now() });
            activeRecording = null;
            const actual = { count: chunks.length, hasOnlyFinal: chunks.every(c => c.text !== 'interim') };
            return { actual, assert: deepEqual, expected: { count: 1, hasOnlyFinal: true } };
        })
    ];
};