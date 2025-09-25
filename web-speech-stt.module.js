import { getId } from "./helpers.js";
import { configProxy } from "./config.module.js";
import { createSelectableSource } from './tree-to-dom.module.js';
export const manifest = {
	name: "web-speech-stt",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Production speech-audio synchronization with real-time transcript UI",
	dependencies: ["indexed-db"],
	actions: ["startListening", "stopListening", "toggleListening", "getStatus", "getRecordings", "loadRecording", "deleteRecording", "seekToChunk", "seekToTime", "togglePlayback", "setPlaybackRate", "saveGoldStandard"],
	uiComponents: [
		// { name: "stt-indicator", getTree: "buildIndicator", },
		{ name: "transcript-viewer", getTree: "buildTranscriptViewer" },
		{ name: "recording-manager", getTree: "buildRecordingManager" }
	],
	config: {
		language: {
			type: 'select', options: [
				{ value: 'en-US', text: 'English (US)' }, { value: 'en-GB', text: 'English (UK)' }, { value: 'es-ES', text: 'Spanish' },
				{ value: 'fr-FR', text: 'French' }, { value: 'de-DE', text: 'German' }, { value: 'ja-JP', text: 'Japanese' }, { value: 'zh-CN', text: 'Chinese' }
			], value: 'en-US', label: 'Recognition Language'
		},
		pauseThreshold: { type: 'number', min: 500, max: 5000, value: 1500, label: 'Thought Break (ms)' },
		toggleKey: { type: 'globalKey', value: 'Ctrl+Space', label: 'Listen Toggle', action: "toggleListening" },
		playbackRate: { type: 'number', min: 0.25, max: 3.0, value: 1.0, step: 0.25, label: 'Playback Speed' },
		sourceMode: { type: 'checkbox', value: true, label: 'In Source Mode or Review Mode' }
	},
	indexeddb: { name: 'SpeechAudioDB', version: 1, storeConfigs: [{ name: 'recordings', options: { keyPath: 'id' }, indexes: [{ name: 'by-timestamp', keyPath: 'timestamp' }] }] }
};
let runtime, log, recognition, mediaRecorder, audioStream, audioContext, audioBuffer;
let isListening = false, isPlaying = false, currentTime = 0, playbackRate = 1.0;
let audioStartTime = 0, recordingChunks = [], currentRecording = null, currentPlayingSource = null, highlightedChunkIndex = -1;
const config = configProxy(manifest);
export const initialize = async (rt, l) => { runtime = rt; log = l; setupAudioContext(); setupRecognition(); playbackRate = config.playbackRate; };
// === SETUP ===
const setupAudioContext = () => { try { audioContext = new (window.AudioContext || window["webkitAudioContext"])(); } catch (e) { log.error(' AudioContext:', e); } };
const setupRecognition = () => {
	if (!window["webkitSpeechRecognition"]) return log.error(' WebKit speech not supported');
	recognition = new window["webkitSpeechRecognition"]();
	Object.assign(recognition, { continuous: true, interimResults: true, lang: config.language });
	recognition.onstart = () => handleStart();
	recognition.onend = () => handleEnd();
	recognition.onerror = (e) => handleError(e);
	recognition.onresult = (e) => handleResult(e);
};

// === RECORDING HANDLERS ===
const handleStart = async () => {
	isListening = true;
	audioStartTime = performance.now();
	recordingChunks = [];
	await refreshUI();
	await runtime.call('layout.addComponent', 'transcript-viewer');
};
const handleEnd = async () => { isListening = false; await refreshUI(); };
const handleError = async (e) => { isListening = false; await refreshUI(); log.error(' Error:', e.error); };
const handleResult = (event) => {
	const currentTimeMs = performance.now() - audioStartTime;
	for (let i = event.resultIndex; i < event.results.length; i++) {
		const result = event.results[i];
		const transcript = result[0].transcript;
		const estimatedDurationMs = transcript.length * 100;
		const chunk = {
			text: transcript.trim(), startTime: Math.max(0, currentTimeMs - estimatedDurationMs) / 1000, endTime: currentTimeMs / 1000,
			confidence: result[0].confidence || 0, isFinal: result.isFinal, timestamp: currentTimeMs
		};
		const existingIndex = recordingChunks.findIndex(c => result.isFinal ? (!c.isFinal && Math.abs(c.timestamp - currentTimeMs) < 1000) : !c.isFinal);
		existingIndex >= 0 ? recordingChunks[existingIndex] = chunk : recordingChunks.push(chunk);
	}
	(currentRecording || isListening) && refreshTranscriptViewer();
};
// === RECORDING CONTROL ===
export const startListening = async () => { if (!recognition || isListening) return; try { await startAudioRecording(); recognition.start(); } catch (e) { log.error(' Start failed:', e); await stopAudioRecording(); } };
export const stopListening = async () => { if (!recognition || !isListening) return; recognition.stop(); await stopAudioRecording(); };
export const toggleListening = async () => isListening ? await stopListening() : await startListening();
// === AUDIO RECORDING ===
const startAudioRecording = async () => {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 48000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
	audioStream = stream;
	mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
	const chunks = [];
	mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
	mediaRecorder.onstop = async () => await finalizeRecording(new Blob(chunks, { type: 'audio/webm' }));
	mediaRecorder.start();
};
const stopAudioRecording = async () => {
	mediaRecorder && mediaRecorder.state !== 'inactive' && mediaRecorder.stop();
	audioStream && (audioStream.getTracks().forEach(track => track.stop()), audioStream = null);
};
const finalizeRecording = async (audioBlob) => {
	const finalChunks = recordingChunks.filter(chunk => chunk.isFinal);
	if (finalChunks.length === 0) return;
	const recording = {
		id: getId('rec-'), audioBlob, transcript: finalChunks.map(c => c.text).join(' '), goldStandard: '', chunks: finalChunks,
		duration: finalChunks[finalChunks.length - 1].endTime, timestamp: new Date().toISOString(), language: config.language
	};
	try { await runtime.call('indexed-db.addRecord', 'SpeechAudioDB', 'recordings', recording); log.log(' Saved:', recording.id); }
	catch (error) { log.error(' Save failed:', error); }
};
// === PLAYBACK ===
export const loadRecording = async (recordingId) => {
	const recording = await runtime.call('indexed-db.getRecord', 'SpeechAudioDB', 'recordings', recordingId);
	if (!recording) throw new Error('Recording not found');
	const arrayBuffer = await recording.audioBlob.arrayBuffer();
	audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
	currentRecording = recording; currentTime = 0; highlightedChunkIndex = -1;
	await refreshTranscriptViewer();
	return recording;
};
export const togglePlayback = async () => audioBuffer && currentRecording && (isPlaying ? await pausePlayback() : await startPlayback());
const startPlayback = async () => {
	if (!audioContext || !audioBuffer) return;
	audioContext.state === 'suspended' && await audioContext.resume();
	currentPlayingSource = audioContext.createBufferSource();
	currentPlayingSource.buffer = audioBuffer; currentPlayingSource.playbackRate.value = playbackRate; currentPlayingSource.connect(audioContext.destination);
	const startTime = audioContext.currentTime, offset = currentTime;
	currentPlayingSource.start(0, offset); isPlaying = true;
	const updateProgress = () => {
		if (!isPlaying) return;
		currentTime = offset + (audioContext.currentTime - startTime) * playbackRate;
		updateHighlight();
		currentTime >= audioBuffer.duration ? (pausePlayback(), currentTime = audioBuffer.duration) : requestAnimationFrame(updateProgress);
	};
	requestAnimationFrame(updateProgress);
	currentPlayingSource.onended = () => isPlaying && (isPlaying = false, refreshTranscriptViewer());
	await refreshTranscriptViewer();
};
const pausePlayback = async () => { currentPlayingSource && (currentPlayingSource.stop(), currentPlayingSource = null); isPlaying = false; await refreshTranscriptViewer(); };
const updateHighlight = () => {
	if (!currentRecording) return;
	const newIndex = currentRecording.chunks.findIndex(chunk => currentTime >= chunk.startTime && currentTime <= chunk.endTime);
	newIndex !== highlightedChunkIndex && (highlightedChunkIndex = newIndex, refreshTranscriptViewer());
};
// === SEEK ===
export const seekToChunk = async (chunkIndex) => currentRecording && chunkIndex >= 0 && chunkIndex < currentRecording.chunks.length && await seekToTime(currentRecording.chunks[chunkIndex].startTime);
export const seekToTime = async (timeInSeconds) => {
	if (!audioBuffer || !currentRecording) return;
	const wasPlaying = isPlaying;
	isPlaying && await pausePlayback();
	currentTime = Math.max(0, Math.min(timeInSeconds, audioBuffer.duration));
	wasPlaying ? await startPlayback() : (updateHighlight(), await refreshTranscriptViewer());
};
export const setPlaybackRate = async (rate) => {
	playbackRate = Math.max(0.25, Math.min(3.0, rate));
	if (isPlaying && currentPlayingSource) { const wasPlaying = isPlaying, savedTime = currentTime; await pausePlayback(); currentTime = savedTime; wasPlaying && await startPlayback(); }
};
// === DATA ===
export const getRecordings = async () => {
	try {
		const recordings = await runtime.call('indexed-db.getByIndexCursor', 'SpeechAudioDB', 'recordings', 'by-timestamp', 'prev', 50);
		return recordings.map(r => ({ id: r.id, transcript: r.transcript.substring(0, 100) + (r.transcript.length > 100 ? '...' : ''), goldStandard: r.goldStandard || '', duration: r.duration, timestamp: r.timestamp, language: r.language, chunkCount: r.chunks.length }));
	} catch (error) { log.error(' Get recordings failed:', error); return []; }
};
export const deleteRecording = async (recordingId) => {
	await runtime.call('indexed-db.removeRecord', 'SpeechAudioDB', 'recordings', recordingId);
	currentRecording && currentRecording.id === recordingId && (await pausePlayback(), currentRecording = null, audioBuffer = null, await refreshTranscriptViewer());
};
export const saveGoldStandard = async (goldText) => {
	if (!currentRecording) return;
	const updated = { ...currentRecording, goldStandard: goldText };
	await runtime.call('indexed-db.updateRecord', 'SpeechAudioDB', 'recordings', updated);
	currentRecording = updated;
	await refreshTranscriptViewer();
};
// === STATUS ===
export const getStatus = async () => ({ isListening, isPlaying, currentTime, duration: audioBuffer ? audioBuffer.duration : 0, hasRecording: !!currentRecording, recordingId: currentRecording?.id, playbackRate, highlightedChunk: highlightedChunkIndex, isSupported: !!(window["webkitSpeechRecognition"] && window.AudioContext) });
// === UI ===
const refreshUI = () => runtime.call('layout.renderComponent', 'stt-indicator');
const refreshTranscriptViewer = () => runtime.call('layout.renderComponent', 'transcript-viewer');
const refreshRecordingManager = () => runtime.call('layout.renderComponent', 'recording-manager');
export const buildIndicator = () => !isListening ? null : { "recording-indicator": { tag: "div", style: "display: flex; align-items: center; justify-content: center; background: rgba(239, 68, 68, 0.9); color: white; border-radius: 50%; width: 100%; height: 100%; font-size: 16px; animation: pulse 1.5s infinite;", text: "🎤", title: "Recording..." } };
export const buildTranscriptViewer = () => (!currentRecording && !isListening) ? { "no-recording": { tag: "div", style: "display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);", text: "Load recording to view transcript" } } : { "transcript-container": { tag: "div", style: "display: flex; flex-direction: column; height: 100%; background: var(--bg-secondary);", ...buildAudioControls(), ...buildTranscriptContent(), ...buildGoldStandardEditor() } };
const buildAudioControls = () => isListening ? {} : ({
	"audio-controls": {
		tag: "div", style: "padding: 10px; border-bottom: 1px solid var(--border-primary); background: var(--bg-tertiary);",
		"playback-controls": {
			tag: "div", style: "display: flex; align-items: center; gap: 10px; margin-bottom: 10px;",
			"play-button": { tag: "button", text: isPlaying ? "⏸️ Pause" : "▶️ Play", class: "cognition-button-primary", events: { click: "web-speech-stt.togglePlayback" }, disabled: !audioBuffer },
			"time-display": { tag: "span", style: "font-family: monospace; color: var(--text-secondary);", text: `${formatTime(currentTime)} / ${formatTime(audioBuffer ? audioBuffer.duration : 0)}` },
			"rate-control": { tag: "select", class: "cognition-select", style: "width: 80px;", value: playbackRate.toString(), events: { change: "web-speech-stt.handleRateChange" }, options: [{ value: "0.25", text: "0.25x" }, { value: "0.5", text: "0.5x" }, { value: "0.75", text: "0.75x" }, { value: "1", text: "1x" }, { value: "1.25", text: "1.25x" }, { value: "1.5", text: "1.5x" }, { value: "2", text: "2x" }] }
		},
		"progress-bar": buildProgressBar()
	}
});
const buildProgressBar = () => {
	const duration = audioBuffer ? audioBuffer.duration : 1, progress = duration > 0 ? (currentTime / duration) * 100 : 0;
	return { tag: "div", style: "width: 100%; height: 6px; background: var(--border-primary); border-radius: 3px; cursor: pointer;", events: { click: "web-speech-stt.handleProgressClick" }, "progress-fill": { tag: "div", style: `height: 100%; background: var(--accent-primary); border-radius: 3px; width: ${progress}%; transition: width 0.1s;` } };
};
const buildTranscriptContent = () => ({ "transcript-content": { tag: "div", style: "flex: 1; overflow-y: auto; padding: 15px; line-height: 1.6;", ...buildChunksUI() } });
const getChunks = () => isListening ? recordingChunks : currentRecording?.chunks || [];
const buildChunksUI = () => config.sourceMode ? buildTranscriptSource() : buildTranscriptChunks();
const buildTranscriptSource = () => createSelectableSource(
  { tag: "div", text: getChunks().map(chunk => chunk.text).join(' '), style: "cursor: text; line-height: 1.6; padding: 15px;" },
  `transcript-${currentRecording?.id || 'live'}`,
  "transcript",
  "web-speech-stt"
);
const buildTranscriptChunks = () => Object.fromEntries(
	getChunks().map((chunk, index) => [`chunk-${index}`, {
		tag: "span",
		style: `cursor: pointer; padding: 2px 4px; margin: 0 1px; border-radius: 3px; 
			${isListening ?
				(chunk.isFinal ? 'opacity: 1;' : 'opacity: 0.6; font-style: italic;') :
				(index === highlightedChunkIndex ? 'background: var(--accent-primary);' : '')
			}`,
		text: chunk.text + ' ',
		...(isListening ? {} : {
			events: { click: "web-speech-stt.handleChunkClick" },
			"data-chunk-index": index,
			title: `${formatTime(chunk.startTime)} - ${formatTime(chunk.endTime)}`
		})
	}])
);
const buildGoldStandardEditor = () => (isListening || !currentRecording) ? {} : ({
	"gold-standard": {
		tag: "div", style: "border-top: 1px solid var(--border-primary); padding: 15px; background: var(--bg-tertiary);",
		"gold-label": { tag: "label", text: "Gold Standard (Manual Correction):", style: "display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-primary);" },
		"gold-textarea": { tag: "textarea", value: currentRecording.goldStandard || '', placeholder: "Enter corrected transcript for comparison with other transcription services...", style: "width: 100%; height: 80px; padding: 8px; border: 1px solid var(--border-primary); border-radius: 4px; background: var(--bg-input); resize: vertical; font-family: inherit;", events: { change: "web-speech-stt.handleGoldStandardChange" } },
		"gold-stats": { tag: "div", style: "margin-top: 8px; font-size: 12px; color: var(--text-muted);", text: `Auto: ${currentRecording.transcript.length} chars | Gold: ${(currentRecording.goldStandard || '').length} chars` }
	}
});
export const buildRecordingManager = async () => {
	const recordings = await getRecordings();
	return {
		"recording-manager": {
			tag: "div", style: "display: flex; flex-direction: column; height: 100%; background: var(--bg-secondary);",
			"header": { tag: "div", style: "padding: 15px; border-bottom: 1px solid var(--border-primary); background: var(--bg-tertiary);", "title": { tag: "h3", text: `Recordings (${recordings.length})`, style: "margin: 0 0 10px 0;" }, "record-btn": { tag: "button", text: isListening ? "⏹️ Stop" : "🎤 Record", class: isListening ? "cognition-button-secondary" : "cognition-button-primary", events: { click: "web-speech-stt.toggleListening" } } },
			"recording-list": { tag: "div", style: "flex: 1; overflow-y: auto;", ...buildRecordingList(recordings) }
		}
	};
};
const buildRecordingList = (recordings) => recordings.length === 0 ? { "empty-state": { tag: "div", style: "display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);", text: "No recordings yet. Click Record to start." } } : Object.fromEntries(recordings.map(recording => [`recording-${recording.id}`, { tag: "div", style: `padding: 12px; border-bottom: 1px solid var(--border-primary); cursor: pointer; position: relative; ${currentRecording && currentRecording.id === recording.id ? 'background: var(--bg-tertiary);' : 'background: transparent;'}`, events: { click: "web-speech-stt.handleRecordingClick" }, "data-recording-id": recording.id, "recording-info": { tag: "div", style: "display: flex; justify-content: space-between; margin-bottom: 6px;", "timestamp": { tag: "div", style: "font-size: 12px; color: var(--text-secondary);", text: new Date(recording.timestamp).toLocaleString() }, "duration": { tag: "div", style: "font-size: 12px; color: var(--text-secondary);", text: formatTime(recording.duration) } }, "transcript-preview": { tag: "div", style: "font-size: 13px; color: var(--text-primary); margin-bottom: 4px;", text: recording.transcript }, "metadata": { tag: "div", style: "font-size: 11px; color: var(--text-muted);", text: `${recording.chunkCount} segments • ${recording.language} • Gold: ${recording.goldStandard ? 'Yes' : 'No'}` }, "delete-button": { tag: "button", text: "🗑️", class: "cognition-button-secondary", style: "position: absolute; top: 8px; right: 8px; padding: 4px 8px; font-size: 12px;", events: { click: "web-speech-stt.handleDeleteClick" }, "data-recording-id": recording.id, title: "Delete recording" } }]));
// === EVENT HANDLERS ===
export const handleChunkClick = async (eventData) => await seekToChunk(parseInt(eventData.target.dataset.chunkIndex));
export const handleProgressClick = async (eventData) => { if (!audioBuffer) return; const rect = eventData.target.getBoundingClientRect(), progress = (eventData.clientX - rect.left) / rect.width; await seekToTime(progress * audioBuffer.duration); };
export const handleRateChange = async (eventData) => await setPlaybackRate(parseFloat(eventData.target.value));
export const handleRecordingClick = async (eventData) => await loadRecording(eventData.target.closest('[data-recording-id]').dataset.recordingId);
export const handleDeleteClick = async (eventData) => { eventData.stopPropagation(); const recordingId = eventData.target.dataset.recordingId; confirm('Delete this recording?') && (await deleteRecording(recordingId), await refreshRecordingManager()); };
export const handleGoldStandardChange = async (eventData) => await saveGoldStandard(eventData.target.value);
// === UTILITIES ===
const formatTime = (seconds) => !seconds || isNaN(seconds) ? "0:00" : (() => { const mins = Math.floor(seconds / 60), secs = Math.floor(seconds % 60); return `${mins}:${secs.toString().padStart(2, '0')}`; })();
// === TESTING ===
export const test = async () => {
	const { runUnitTest, deepEqual } = runtime.testUtils;
	return [
		await runUnitTest("Format time displays correctly", async () => {
			const actual = { zero: formatTime(0), seconds: formatTime(45), minutes: formatTime(125), invalid: formatTime(null) };
			const expected = { zero: "0:00", seconds: "0:45", minutes: "2:05", invalid: "0:00" };
			return { actual, assert: deepEqual, expected };
		}),
		await runUnitTest("Chunk timing calculation", async () => {
			const mockChunk = { text: "hello world", startTime: 1.5, endTime: 2.8, confidence: 0.95, isFinal: true };
			const duration = mockChunk.endTime - mockChunk.startTime;
			const actual = { hasValidTiming: mockChunk.startTime < mockChunk.endTime, duration: Math.round(duration * 10) / 10, isComplete: mockChunk.isFinal && mockChunk.confidence > 0.8 };
			return { actual, assert: deepEqual, expected: { hasValidTiming: true, duration: 1.3, isComplete: true } };
		})
	];
};