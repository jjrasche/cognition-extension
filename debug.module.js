/**
 * Enhanced Debug Module - Visual Timeline for State Changes and Actions
 */

export const manifest = {
  name: "debug",
  version: "2.0.0",
  permissions: ["storage"],
  actions: ["openTimeline", "clearHistory", "toggleRealTime"],
  state: {
    reads: ["*"],
    writes: ["debug.timeline", "debug.settings", "debug.realtime"]
  }
};

const timeline = [];
const startTime = Date.now();
const maxSize = 10 * 1024 * 1024;
let realTimeEnabled = false;

const ensure = (condition, message) => condition || (() => { throw new Error(message); })();
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
const formatValue = v => !v ? String(v) : typeof v === 'string' ? (v.length > 100 ? v.substring(0, 100) + '...' : v) : typeof v === 'object' ? JSON.stringify(v).substring(0, 200) + '...' : String(v);

const getCaller = () => {
  const stack = new Error().stack.split('\n').slice(2, 8);
  const moduleMatch = stack.find(line => line.includes('.module.js'))?.match(/(\w+)\.module\.js/);
  return moduleMatch?.[1] || stack.find(line => line.match(/at (\w+)/))?.match(/at (\w+)/)?.[1] || 'unknown';
};

const addEntry = entry => (timeline.push(entry), enforceLimit(), updateRealTime());
const enforceLimit = () => JSON.stringify(timeline).length > maxSize && timeline.splice(0, Math.floor(timeline.length * 0.25));
const updateRealTime = () => realTimeEnabled && globalThis.state?.write('debug.timeline', timeline);

const recordState = (key, value) => addEntry({
  type: 'state', timestamp: Date.now(), relativeTime: Date.now() - startTime,
  key, value: formatValue(value), caller: getCaller(), id: generateId()
});

const recordAction = (name, params, status, timestamp, metadata = {}) => addEntry({
  type: 'action', timestamp, relativeTime: timestamp - startTime,
  name, params: formatValue(params), status, ...metadata, id: generateId()
});

const wrapExecute = originalExecute => async (name, params = {}) => {
  const start = performance.now();
  const timestamp = Date.now();
  recordAction(name, params, 'started', timestamp);
  
  try {
    const result = await originalExecute(name, params);
    recordAction(name, params, 'completed', timestamp, { duration: performance.now() - start, result });
    return result;
  } catch (error) {
    recordAction(name, params, 'failed', timestamp, { duration: performance.now() - start, error: error.message });
    throw error;
  }
};

export const initialize = async (state, config) => {
  const stored = await state.read('debug.timeline');
  stored && timeline.push(...stored);
  
  state.watch('*', (key, value) => !key.startsWith('debug.') && recordState(key, value));
  state.actions.execute = wrapExecute(state.actions.execute.bind(state.actions));
  
  await state.write('debug.settings', {
    realTime: config.realTime || false,
    maxEntries: config.maxEntries || 10000,
    timeScale: config.timeScale || 20
  });
};

export const openTimeline = async state => {
  const settings = await state.read('debug.settings');
  const html = generateTimelineHTML(timeline, settings);
  await state.write('ui.content', html);
  await state.actions.execute('ui.show');
  return { success: true, entries: timeline.length };
};

export const clearHistory = async state => (
  timeline.length = 0,
  await state.write('debug.timeline', []),
  { success: true, message: 'Timeline cleared' }
);

export const toggleRealTime = async state => (
  realTimeEnabled = !realTimeEnabled,
  await state.write('debug.realtime', realTimeEnabled),
  { success: true, realTime: realTimeEnabled }
);

const generateTimelineHTML = (data, settings) => !data?.length ? '<div class="debug-empty">No timeline data</div>' : `
  <div class="debug-timeline-container">
    <div class="debug-header">
      <h2>Debug Timeline (${data.length} entries)</h2>
      <div class="debug-controls">
        <button data-action="debug.clearHistory" data-params='{}'>Clear</button>
        <button data-action="debug.toggleRealTime" data-params='{}'>${realTimeEnabled ? 'Disable' : 'Enable'} Real-time</button>
      </div>
    </div>
    <div class="debug-timeline">
      <div class="debug-time-ruler">${generateTimeRuler(data, settings.timeScale)}</div>
      <div class="debug-events">${data.map(entry => generateTimelineEntry(entry, settings)).join('')}</div>
    </div>
  </div>
  <style>${generateTimelineCSS()}</style>
`;

const generateTimeRuler = (data, timeScale) => {
  if (!data.length) return '';
  const duration = data[data.length - 1].relativeTime;
  const intervals = Math.ceil(duration / 1000); // 1 second intervals
  return Array.from({ length: intervals }, (_, i) => 
    `<div class="time-mark" style="top: ${i * timeScale * 10}px">${formatTime(i * 1000)}</div>`
  ).join('');
};

const generateTimelineEntry = (entry, settings) => {
  const topPos = (entry.relativeTime / 100) * settings.timeScale; // 100ms = timeScale pixels
  const typeClass = `debug-${entry.type}`;
  const statusClass = entry.status ? `status-${entry.status}` : '';
  
  return `
    <div class="debug-entry ${typeClass} ${statusClass}" style="top: ${topPos}px" data-id="${entry.id}">
      <div class="debug-dot"></div>
      <div class="debug-content">
        <div class="debug-title">${formatEntryTitle(entry)}</div>
        <div class="debug-details">${formatEntryDetails(entry)}</div>
        <div class="debug-time">${formatTime(entry.relativeTime)}</div>
      </div>
    </div>
  `;
};

const formatEntryTitle = entry => entry.type === 'action' ? 
  `${entry.name} (${entry.status})` : 
  `${entry.key} = ${entry.value}`;

const formatEntryDetails = entry => entry.type === 'action' ?
  `Params: ${entry.params}${entry.duration ? ` | ${entry.duration.toFixed(1)}ms` : ''}` :
  `From: ${entry.caller}`;

const formatTime = ms => {
  const seconds = Math.floor(ms / 1000);
  const milliseconds = ms % 1000;
  return `${seconds}.${milliseconds.toString().padStart(3, '0')}s`;
};

const generateTimelineCSS = () => `
  .debug-timeline-container { padding: 20px; font-family: 'SF Mono', Monaco, monospace; font-size: 12px; }
  .debug-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; }
  .debug-header h2 { margin: 0; color: #fff; font-size: 16px; }
  .debug-controls button { margin-left: 8px; padding: 4px 12px; background: rgba(99,102,241,0.2); border: 1px solid rgba(99,102,241,0.5); color: #fff; border-radius: 4px; cursor: pointer; font-size: 11px; }
  .debug-controls button:hover { background: rgba(99,102,241,0.3); }
  
  .debug-timeline { position: relative; margin-left: 80px; }
  .debug-time-ruler { position: absolute; left: -80px; top: 0; width: 70px; }
  .time-mark { position: absolute; color: rgba(255,255,255,0.4); font-size: 10px; border-right: 1px solid rgba(255,255,255,0.1); width: 70px; padding-right: 8px; text-align: right; }
  
  .debug-events { position: relative; min-height: 400px; }
  .debug-entry { position: absolute; left: 0; width: 100%; display: flex; align-items: flex-start; margin: 2px 0; }
  .debug-dot { width: 8px; height: 8px; border-radius: 50%; margin: 6px 12px 0 0; flex-shrink: 0; }
  .debug-content { flex: 1; padding: 4px 8px; border-radius: 4px; background: rgba(255,255,255,0.05); border-left: 2px solid; }
  
  .debug-action .debug-dot { background: #3b82f6; }
  .debug-action .debug-content { border-left-color: #3b82f6; }
  .debug-state .debug-dot { background: #10b981; }
  .debug-state .debug-content { border-left-color: #10b981; }
  
  .status-started .debug-dot { background: #f59e0b; }
  .status-failed .debug-dot { background: #ef4444; }
  
  .debug-title { font-weight: 600; color: #fff; margin-bottom: 2px; }
  .debug-details { color: rgba(255,255,255,0.7); font-size: 11px; }
  .debug-time { color: rgba(255,255,255,0.4); font-size: 10px; margin-top: 2px; }
  .debug-empty { text-align: center; color: rgba(255,255,255,0.4); padding: 40px; }
`;