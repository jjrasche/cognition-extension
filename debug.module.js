import { getId } from './helpers.js';

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

const formatValue = v => !v ? String(v) : typeof v === 'string' ? (v.length > 100 ? v.substring(0, 100) + '...' : v) : typeof v === 'object' ? JSON.stringify(v).substring(0, 200) + '...' : String(v);

const getCaller = () => {
  const error = new Error();
  const stack = error.stack ? error.stack.split('\n').slice(2, 8) : [];
  const moduleMatch = stack.find(line => line?.includes('.module.js'))?.match(/(\w+)\.module\.js/);
  return moduleMatch?.[1] || stack.find(line => line?.match(/at (\w+)/))?.match(/at (\w+)/)?.[1] || 'unknown';
};

const addEntry = (state, entry) => (timeline.push(entry), enforceLimit(), updateRealTime(state));
const enforceLimit = () => JSON.stringify(timeline).length > maxSize && timeline.splice(0, Math.floor(timeline.length * 0.25));
const updateRealTime = (state) => realTimeEnabled && state.write('debug.timeline', timeline);

const recordState = (state, key, value) => addEntry(state, {
  type: 'state', timestamp: Date.now(), relativeTime: Date.now() - startTime,
  key, value: formatValue(value), caller: getCaller(), id: getId()
});

const recordAction = (state, name, params, status, timestamp, metadata = {}) => addEntry(state, {
  type: 'action', timestamp, relativeTime: timestamp - startTime,
  name, params: formatValue(params), status, ...metadata, id: getId()
});

const wrapExecute = (state, originalExecute) => async (name, params = {}) => {
  const start = performance.now();
  const timestamp = Date.now();
  recordAction(state, name, params, 'started', timestamp);

  try {
    const result = await originalExecute(name, params);
    recordAction(state, name, params, 'completed', timestamp, { duration: performance.now() - start, result });
    return result;
  } catch (error) {
    recordAction(state, name, params, 'failed', timestamp, { duration: performance.now() - start, error: error.message });
    throw error;
  }
};

export const initialize = async (state, config) => {
  const stored = await state.read('debug.timeline');
  stored && timeline.push(...stored);

  state.watch('*', (value, key) => !key.startsWith('debug.') && recordState(state, key, value));
  state.actions.execute = wrapExecute(state, state.actions.execute.bind(state.actions));
  
  await state.write('debug.settings', {
    realTime: config.realTime || false,
    maxEntries: config.maxEntries || 10000,
    timeScale: config.timeScale || 20
  });
};

export const openTimeline = async state => {
  const settings = await state.read('debug.settings');
  const html = generateFullPageHTML(timeline, settings);
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  await chrome.tabs.create({ url: dataUrl });
  return { success: true, entries: timeline.length };
};

export const clearHistory = async state => (
  timeline.length = 0,
  await state.write('debug.timeline', []),
  { success: true, message: 'Timeline cleared' }
);

export const toggleRealTime = async state => (
  realTimeEnabled = !realTimeEnabled,
  // await state.write('debug.realtime', realTimeEnabled),
  { success: true, realTime: realTimeEnabled }
);

const generateFullPageHTML = (data, settings) => `
<!DOCTYPE html>
<html>
<head>
  <title>Cognition Debug Timeline</title>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f0f17; color: #fff; font-family: 'SF Mono', Monaco, monospace; font-size: 13px; }
    .page-header { padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); background: rgba(17,17,27,0.8); position: sticky; top: 0; z-index: 100; }
    .page-title { font-size: 24px; font-weight: 600; color: #fff; margin-bottom: 8px; }
    .page-subtitle { color: rgba(255,255,255,0.6); font-size: 14px; }
    .debug-controls { margin-top: 16px; }
    .debug-controls button { 
      margin-right: 12px; padding: 8px 16px; background: rgba(99,102,241,0.2); 
      border: 1px solid rgba(99,102,241,0.5); color: #fff; border-radius: 6px; 
      cursor: pointer; font-size: 12px; font-family: inherit; 
    }
    .debug-controls button:hover { background: rgba(99,102,241,0.3); }
    .timeline-container { padding: 40px; max-width: 1200px; margin: 0 auto; }
    .timeline-wrapper { position: relative; margin-left: 100px; }
    .time-ruler { position: absolute; left: -100px; top: 0; width: 90px; }
    .time-mark { 
      position: absolute; color: rgba(255,255,255,0.4); font-size: 11px; 
      border-right: 2px solid rgba(255,255,255,0.1); width: 90px; 
      padding-right: 12px; text-align: right; height: 1px;
    }
    .timeline-events { position: relative; min-height: 600px; border-left: 2px solid rgba(255,255,255,0.1); }
    .timeline-entry { 
      position: absolute; left: -1px; width: calc(100% + 1px); 
      display: flex; align-items: flex-start; 
    }
    .entry-dot { 
      width: 12px; height: 12px; border-radius: 50%; 
      margin: 4px 16px 0 -6px; flex-shrink: 0; border: 2px solid #0f0f17;
    }
    .entry-content { 
      flex: 1; padding: 8px 16px 12px 0; border-radius: 6px; 
      background: rgba(255,255,255,0.03); border-left: 3px solid; 
      margin-top: 2px; min-height: 44px;
    }
    .entry-title { font-weight: 600; color: #fff; margin-bottom: 4px; font-size: 14px; }
    .entry-details { color: rgba(255,255,255,0.7); font-size: 12px; line-height: 1.4; }
    .entry-time { color: rgba(255,255,255,0.4); font-size: 11px; margin-top: 4px; }
    .entry-meta { color: rgba(255,255,255,0.5); font-size: 11px; margin-top: 2px; }
    
    .debug-action .entry-dot { background: #3b82f6; }
    .debug-action .entry-content { border-left-color: #3b82f6; }
    .debug-state .entry-dot { background: #10b981; }
    .debug-state .entry-content { border-left-color: #10b981; }
    
    .status-started .entry-dot { background: #f59e0b; }
    .status-failed .entry-dot { background: #ef4444; }
    .status-completed .entry-dot { background: #10b981; }
    
    .empty-timeline { 
      text-align: center; color: rgba(255,255,255,0.4); 
      padding: 80px 20px; font-size: 16px; 
    }
  </style>
</head>
<body>
  <div class="page-header">
    <div class="page-title">Cognition Debug Timeline</div>
    <div class="page-subtitle">${data?.length || 0} events tracked • ${formatDuration(data)}</div>
    <div class="debug-controls">
      <button onclick="toggleTimeScale()">Zoom Timeline</button>
      <button onclick="filterByType('action')">Actions Only</button>
      <button onclick="filterByType('state')">State Only</button>
      <button onclick="clearFilters()">Show All</button>
    </div>
  </div>
  
  <div class="timeline-container">
    ${!data?.length ? '<div class="empty-timeline">No timeline data available</div>' : `
      <div class="timeline-wrapper">
        <div class="time-ruler">${generateTimeRuler(data, settings.timeScale)}</div>
        <div class="timeline-events">${data.map(entry => generateTimelineEntry(entry, settings)).join('')}</div>
      </div>
    `}
  </div>
  
  <script>
    let currentScale = ${settings.timeScale};
    let currentFilter = 'all';
    
    function toggleTimeScale() {
      currentScale = currentScale === 20 ? 40 : 20;
      location.reload();
    }
    
    function filterByType(type) {
      currentFilter = type;
      document.querySelectorAll('.timeline-entry').forEach(entry => {
        entry.style.display = entry.classList.contains('debug-' + type) ? 'flex' : 'none';
      });
    }
    
    function clearFilters() {
      currentFilter = 'all';
      document.querySelectorAll('.timeline-entry').forEach(entry => {
        entry.style.display = 'flex';
      });
    }
  </script>
</body>
</html>
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
  const topPos = (entry.relativeTime / 100) * settings.timeScale;
  const typeClass = `debug-${entry.type}`;
  const statusClass = entry.status ? `status-${entry.status}` : '';
  
  return `
    <div class="timeline-entry ${typeClass} ${statusClass}" style="top: ${topPos}px" data-id="${entry.id}">
      <div class="entry-dot"></div>
      <div class="entry-content">
        <div class="entry-title">${formatEntryTitle(entry)}</div>
        <div class="entry-details">${formatEntryDetails(entry)}</div>
        <div class="entry-time">${formatTime(entry.relativeTime)}</div>
        <div class="entry-meta">ID: ${entry.id}</div>
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

const formatDuration = data => {
  if (!data?.length) return '0s';
  const duration = data[data.length - 1].relativeTime;
  return duration > 1000 ? `${(duration / 1000).toFixed(1)}s` : `${duration}ms`;
};