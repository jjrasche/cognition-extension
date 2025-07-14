/**
 * Debug Module - Logs state changes to console for development
 * Helps developers understand what's happening in the system
 */

// Module manifest
export const manifest = {
  name: "Debug",
  version: "1.0.0",
  permissions: [],
  actions: ["startWatching", "stopWatching", "logCurrentState"],
  state: {
    reads: ["*"], // Read all state
    writes: ["debug.watching", "debug.logCount"]
  }
};

// Track watchers and state
let isWatching = false;
let watchers = new Map();
let logCount = 0;

export async function initialize(state, config) {
  console.log('[Debug] Module initialized');
  
  // Start watching automatically if configured
  if (config.autoStart !== false) {
    await startWatching(state);
  }
  
  // Initialize debug state
  await state.write('debug.watching', isWatching);
  await state.write('debug.logCount', 0);
}

export async function startWatching(state) {
  if (isWatching) {
    console.log('[Debug] Already watching state changes');
    return { success: true, message: 'Already watching' };
  }
  
  isWatching = true;
  await state.write('debug.watching', true);
  
  // Watch for new state keys by monitoring the state object itself
  // Since we can't watch all possible keys, we'll watch the most common patterns
  const commonPatterns = [
    'system.',
    'sleep.',
    'activity.',
    'heart.',
    'ui.',
    'fitbit.',
    'debug.'
  ];
  
  // Set up watchers for common state patterns
  for (const pattern of commonPatterns) {
    setupPatternWatcher(state, pattern);
  }
  
  console.log('[Debug] 🔍 Started watching state changes for patterns:', commonPatterns);
  
  return { success: true, message: 'Started watching state changes' };
}

export async function stopWatching(state) {
  if (!isWatching) {
    return { success: true, message: 'Not currently watching' };
  }
  
  isWatching = false;
  await state.write('debug.watching', false);
  
  // Clear all watchers
  for (const [key, unwatchFn] of watchers) {
    unwatchFn();
  }
  watchers.clear();
  
  console.log('[Debug] 🛑 Stopped watching state changes');
  
  return { success: true, message: 'Stopped watching state changes' };
}

export async function logCurrentState(state) {
  // Since we can't easily get all state keys, log what we know about
  const knownKeys = [
    'system.status',
    'system.modules', 
    'system.errors',
    'sleep.lastNight.hours',
    'sleep.lastNight.quality',
    'activity.today.calories',
    'heart.current.bpm',
    'ui.visible',
    'ui.notify.queue',
    'debug.watching',
    'debug.logCount'
  ];
  
  console.log('[Debug] 📊 Current State Snapshot:');
  console.log('========================================');
  
  for (const key of knownKeys) {
    try {
      const value = await state.read(key);
      if (value !== undefined) {
        console.log(`  ${key}:`, value);
      }
    } catch (error) {
      // Ignore errors for keys that don't exist
    }
  }
  
  console.log('========================================');
  
  return { success: true, message: 'Current state logged to console' };
}

function setupPatternWatcher(state, pattern) {
  // For each pattern, we'll try to watch some common variations
  const variations = generateKeyVariations(pattern);
  
  for (const key of variations) {
    try {
      const unwatchFn = state.watch(key, (value) => {
        logStateChange(key, value);
      });
      
      if (unwatchFn) {
        watchers.set(key, unwatchFn);
      }
    } catch (error) {
      // Some keys might not be watchable, that's OK
    }
  }
}

function generateKeyVariations(pattern) {
  const base = pattern.replace('.', '');
  
  // Generate likely key variations based on existing patterns
  const variations = [
    pattern + 'status',
    pattern + 'data',
    pattern + 'lastNight.hours',
    pattern + 'lastNight.quality', 
    pattern + 'today.calories',
    pattern + 'current.bpm',
    pattern + 'visible',
    pattern + 'notify.queue',
    pattern + 'modules',
    pattern + 'errors',
    pattern + 'watching',
    pattern + 'logCount'
  ];
  
  return variations;
}

async function logStateChange(key, value) {
  logCount++;
  
  const timestamp = new Date().toLocaleTimeString();
  const valueStr = formatValue(value);
  
  console.log(`[Debug] 🔄 [${timestamp}] State changed: ${key} = ${valueStr}`);
  
  // Update log count in state
  try {
    // Get current state reference if available
    if (typeof globalThis.cognitionState?.write === 'function') {
      await globalThis.cognitionState.write('debug.logCount', logCount);
    }
  } catch (error) {
    // Ignore errors updating log count
  }
}

function formatValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'object') {
    try {
      const str = JSON.stringify(value);
      return str.length > 100 ? `Object{${Object.keys(value).length} keys}` : str;
    } catch {
      return '[Object]';
    }
  }
  return String(value);
}

// Cleanup function
export async function cleanup() {
  if (isWatching) {
    // Clear all watchers
    for (const [key, unwatchFn] of watchers) {
      try {
        unwatchFn();
      } catch (error) {
        console.error(`[Debug] Error cleaning up watcher for ${key}:`, error);
      }
    }
    watchers.clear();
  }
  
  console.log('[Debug] Module cleaned up');
}

// Tests
export const tests = [
  {
    name: 'initializes with correct default state',
    fn: async () => {
      const mockState = createMockState();
      
      await initialize(mockState, { autoStart: false });
      
      const watching = await mockState.read('debug.watching');
      const logCount = await mockState.read('debug.logCount');
      
      assert(watching === false, 'Should not auto-start when disabled');
      assert(logCount === 0, 'Should initialize log count to 0');
    }
  },
  
  {
    name: 'starts and stops watching correctly',
    fn: async () => {
      const mockState = createMockState();
      
      // Start watching
      const result1 = await startWatching(mockState);
      assert(result1.success === true, 'Should start watching successfully');
      
      const watching1 = await mockState.read('debug.watching');
      assert(watching1 === true, 'Should set watching state to true');
      
      // Stop watching
      const result2 = await stopWatching(mockState);
      assert(result2.success === true, 'Should stop watching successfully');
      
      const watching2 = await mockState.read('debug.watching');
      assert(watching2 === false, 'Should set watching state to false');
    }
  },
  
  {
    name: 'logs current state without errors',
    fn: async () => {
      const mockState = createMockState();
      
      // Add some test data
      await mockState.write('system.status', 'ready');
      await mockState.write('sleep.lastNight.hours', 7.5);
      
      const result = await logCurrentState(mockState);
      assert(result.success === true, 'Should log state successfully');
    }
  },
  
  {
    name: 'formats values correctly',
    fn: async () => {
      assert(formatValue(null) === 'null');
      assert(formatValue(undefined) === 'undefined');
      assert(formatValue('test') === '"test"');
      assert(formatValue(42) === '42');
      assert(formatValue(true) === 'true');
      assert(formatValue([1, 2, 3]) === 'Array(3)');
      assert(formatValue({ a: 1 }) === '{"a":1}');
    }
  }
];

// Mock state helper for testing
function createMockState() {
  const data = {};
  const watchers = new Map();
  
  return {
    async read(key) { 
      return data[key]; 
    },
    async write(key, value) { 
      data[key] = value;
      
      // Simulate watchers being called
      if (watchers.has(key)) {
        for (const callback of watchers.get(key)) {
          try {
            callback(value);
          } catch (error) {
            // Ignore callback errors in tests
          }
        }
      }
    },
    watch(key, callback) {
      if (!watchers.has(key)) {
        watchers.set(key, new Set());
      }
      watchers.get(key).add(callback);
      
      // Return unwatch function
      return () => {
        watchers.get(key)?.delete(callback);
      };
    }
  };
}

// Simple assertion helper
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}