import { configProxy } from "./config.module.js";
import { createSelectableSource } from './tree-to-dom.module.js';

export const manifest = {
    name: "transcript-review",
    context: ["extension-page"],
    version: "1.0.0",
    description: "Playback, review, and edit audio recordings with synchronized transcript highlighting",
    dependencies: ["audio-recordings", "layout"],
    actions: ["loadRecording", "togglePlayback", "seekToChunk", "seekToTime", "setPlaybackRate", "saveGoldStandard", "handleChunkClick", "handleProgressClick", "handleRateChange", "handleRecordingClick", "handleDeleteClick", "handleGoldStandardChange"],
    uiComponents: [
        { name: "transcript-viewer", getTree: "buildTranscriptViewer" },
        { name: "recording-manager", getTree: "buildRecordingManager" }
    ],
    config: {
        playbackRate: { type: 'number', min: 0.25, max: 3.0, value: 1.0, step: 0.25, label: 'Playback Speed' },
        sourceMode: { type: 'checkbox', value: true, label: 'Source Mode (vs Chunk Mode)' }
    }
};

let runtime, log, audioContext, audioBuffer, currentRecording = null, currentPlayingSource = null, highlightedChunkIndex = -1, isPlaying = false, currentTime = 0, playbackRate = 1.0;
const config = configProxy(manifest);

export const initialize = async (rt, l) => {
    runtime = rt;
    log = l;
    setupAudioContext();
    playbackRate = config.playbackRate;
};
const setupAudioContext = () => {
    try { audioContext = new (window.AudioContext || window["webkitAudioContext"])(); }
    catch (e) { log.error('AudioContext:', e); }
};

// === PLAYBACK ===
export const togglePlayback = async () => audioBuffer && currentRecording && (isPlaying ? await pausePlayback() : await startPlayback());
export const loadRecording = async (recordingId) => {
    const recording = await runtime.call('audio-recordings.getRecording', recordingId);
    if (!recording) throw new Error('Recording not found');
    const arrayBuffer = await recording.audioBlob.arrayBuffer();
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    currentRecording = recording;
    currentTime = 0;
    highlightedChunkIndex = -1;
    await refreshTranscriptViewer();
    return recording;
};
const startPlayback = async () => {
    if (!audioContext || !audioBuffer) return;
    audioContext.state === 'suspended' && await audioContext.resume();
    currentPlayingSource = audioContext.createBufferSource();
    currentPlayingSource.buffer = audioBuffer;
    currentPlayingSource.playbackRate.value = playbackRate;
    currentPlayingSource.connect(audioContext.destination);
    const startTime = audioContext.currentTime, offset = currentTime;
    currentPlayingSource.start(0, offset);
    isPlaying = true;
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
    if (isPlaying && currentPlayingSource) {
        const wasPlaying = isPlaying, savedTime = currentTime;
        await pausePlayback();
        currentTime = savedTime;
        wasPlaying && await startPlayback();
    }
};

// === GOLD STANDARD ===
export const saveGoldStandard = async (goldText) => {
    if (!currentRecording) return;
    await runtime.call('audio-recordings.updateRecording', currentRecording.id, { goldStandard: goldText });
    currentRecording.goldStandard = goldText;
    await refreshTranscriptViewer();
};

// === UI ===
const refreshTranscriptViewer = () => runtime.call('layout.renderComponent', 'transcript-viewer');
const refreshRecordingManager = () => runtime.call('layout.renderComponent', 'recording-manager');

export const buildTranscriptViewer = () => !currentRecording ? { "no-recording": { tag: "div", style: "display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);", text: "Load recording to view transcript" } } : { "transcript-container": { tag: "div", style: "display: flex; flex-direction: column; height: 100%; background: var(--bg-secondary);", ...buildAudioControls(), ...buildTranscriptContent(), ...buildGoldStandardEditor() } };

const buildAudioControls = () => ({
    "audio-controls": {
        tag: "div", style: "padding: 10px; border-bottom: 1px solid var(--border-primary); background: var(--bg-tertiary);",
        "playback-controls": {
            tag: "div", style: "display: flex; align-items: center; gap: 10px; margin-bottom: 10px;",
            "play-button": { tag: "button", text: isPlaying ? "⏸️ Pause" : "▶️ Play", class: "cognition-button-primary", events: { click: "transcript-review.togglePlayback" }, disabled: !audioBuffer },
            "time-display": { tag: "span", style: "font-family: monospace; color: var(--text-secondary);", text: `${formatTime(currentTime)} / ${formatTime(audioBuffer ? audioBuffer.duration : 0)}` },
            "rate-control": { tag: "select", class: "cognition-select", style: "width: 80px;", value: playbackRate.toString(), events: { change: "transcript-review.handleRateChange" }, options: [{ value: "0.25", text: "0.25x" }, { value: "0.5", text: "0.5x" }, { value: "0.75", text: "0.75x" }, { value: "1", text: "1x" }, { value: "1.25", text: "1.25x" }, { value: "1.5", text: "1.5x" }, { value: "2", text: "2x" }] }
        },
        "progress-bar": buildProgressBar()
    }
});

const buildProgressBar = () => {
    const duration = audioBuffer ? audioBuffer.duration : 1, progress = duration > 0 ? (currentTime / duration) * 100 : 0;
    return { tag: "div", style: "width: 100%; height: 6px; background: var(--border-primary); border-radius: 3px; cursor: pointer;", events: { click: "transcript-review.handleProgressClick" }, "progress-fill": { tag: "div", style: `height: 100%; background: var(--accent-primary); border-radius: 3px; width: ${progress}%; transition: width 0.1s;` } };
};

const buildTranscriptContent = () => ({ "transcript-content": { tag: "div", style: "flex: 1; overflow-y: auto; padding: 15px; line-height: 1.6;", ...buildChunksUI() } });

const buildChunksUI = () => config.sourceMode ? buildTranscriptSource() : buildTranscriptChunks();

const buildTranscriptSource = () => createSelectableSource(
    { tag: "div", text: currentRecording.chunks.map(chunk => chunk.text).join(' '), style: "cursor: text; line-height: 1.6; padding: 15px;" },
    `transcript-${currentRecording.id}`,
    "transcript",
    "transcript-review"
);

const buildTranscriptChunks = () => Object.fromEntries(
    currentRecording.chunks.map((chunk, index) => [`chunk-${index}`, {
        tag: "span",
        style: `cursor: pointer; padding: 2px 4px; margin: 0 1px; border-radius: 3px; ${index === highlightedChunkIndex ? 'background: var(--accent-primary);' : ''}`,
        text: chunk.text + ' ',
        events: { click: "transcript-review.handleChunkClick" },
        "data-chunk-index": index,
        title: `${formatTime(chunk.startTime)} - ${formatTime(chunk.endTime)}`
    }])
);

const buildGoldStandardEditor = () => ({
    "gold-standard": {
        tag: "div", style: "border-top: 1px solid var(--border-primary); padding: 15px; background: var(--bg-tertiary);",
        "gold-label": { tag: "label", text: "Gold Standard (Manual Correction):", style: "display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-primary);" },
        "gold-textarea": { tag: "textarea", value: currentRecording.goldStandard || '', placeholder: "Enter corrected transcript for comparison...", style: "width: 100%; height: 80px; padding: 8px; border: 1px solid var(--border-primary); border-radius: 4px; background: var(--bg-input); resize: vertical; font-family: inherit;", events: { change: "transcript-review.handleGoldStandardChange" } },
        "gold-stats": { tag: "div", style: "margin-top: 8px; font-size: 12px; color: var(--text-muted);", text: `Auto: ${currentRecording.transcript.length} chars | Gold: ${(currentRecording.goldStandard || '').length} chars` }
    }
});

export const buildRecordingManager = async () => {
    const recordings = await runtime.call('audio-recordings.getRecordings');
    return {
        "recording-manager": {
            tag: "div", style: "display: flex; flex-direction: column; height: 100%; background: var(--bg-secondary);",
            "header": { tag: "div", style: "padding: 15px; border-bottom: 1px solid var(--border-primary); background: var(--bg-tertiary);", "title": { tag: "h3", text: `Recordings (${recordings.length})`, style: "margin: 0;" } },
            "recording-list": { tag: "div", style: "flex: 1; overflow-y: auto;", ...buildRecordingList(recordings) }
        }
    };
};

const buildRecordingList = (recordings) => recordings.length === 0 ? { "empty-state": { tag: "div", style: "display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);", text: "No recordings yet" } } : Object.fromEntries(recordings.map(rec => [`recording-${rec.id}`, {
    tag: "div",
    style: `padding: 12px; border-bottom: 1px solid var(--border-primary); cursor: pointer; position: relative; ${currentRecording && currentRecording.id === rec.id ? 'background: var(--bg-tertiary);' : 'background: transparent;'}`,
    events: { click: "transcript-review.handleRecordingClick" },
    "data-recording-id": rec.id,
    "recording-info": {
        tag: "div", style: "display: flex; justify-content: space-between; margin-bottom: 6px;",
        "timestamp": { tag: "div", style: "font-size: 12px; color: var(--text-secondary);", text: new Date(rec.timestamp).toLocaleString() },
        "duration": { tag: "div", style: "font-size: 12px; color: var(--text-secondary);", text: formatTime(rec.duration) }
    },
    "transcript-preview": { tag: "div", style: "font-size: 13px; color: var(--text-primary); margin-bottom: 4px;", text: rec.preview },
    "metadata": { tag: "div", style: "font-size: 11px; color: var(--text-muted);", text: `${rec.chunkCount} segments • ${rec.language} • Gold: ${rec.hasGold ? 'Yes' : 'No'}` },
    "delete-button": { tag: "button", text: "🗑️", class: "cognition-button-secondary", style: "position: absolute; top: 8px; right: 8px; padding: 4px 8px; font-size: 12px;", events: { click: "transcript-review.handleDeleteClick" }, "data-recording-id": rec.id, title: "Delete recording" }
}]));

// === EVENT HANDLERS ===
export const handleChunkClick = async (eventData) => await seekToChunk(parseInt(eventData.target.dataset.chunkIndex));
export const handleProgressClick = async (eventData) => { if (!audioBuffer) return; const rect = eventData.target.getBoundingClientRect(), progress = (eventData.clientX - rect.left) / rect.width; await seekToTime(progress * audioBuffer.duration); };
export const handleRateChange = async (eventData) => await setPlaybackRate(parseFloat(eventData.target.value));
export const handleRecordingClick = async (eventData) => await loadRecording(eventData.target.closest('[data-recording-id]').dataset.recordingId);
export const handleDeleteClick = async (eventData) => { eventData.stopPropagation(); const recordingId = eventData.target.dataset.recordingId; confirm('Delete this recording?') && (await runtime.call('audio-recordings.deleteRecording', recordingId), await refreshRecordingManager()); };
export const handleGoldStandardChange = async (eventData) => await saveGoldStandard(eventData.target.value);

// === UTILITIES ===
const formatTime = (seconds) => !seconds || isNaN(seconds) ? "0:00" : (() => { const mins = Math.floor(seconds / 60), secs = Math.floor(seconds % 60); return `${mins}:${secs.toString().padStart(2, '0')}`; })();