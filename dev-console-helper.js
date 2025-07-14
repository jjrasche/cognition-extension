// Development console helpers for Cognition Extension
// This file is automatically loaded in development builds

// Only load in development
if (!chrome.runtime.getManifest().update_url) {
  
  // 1. View all current state
  window.viewState = async function() {
    const stored = await chrome.storage.local.get('cognitionState');
    console.log('Current State:', stored.cognitionState || {});
    return stored.cognitionState;
  }

  // 2. View specific state key
  window.getState = async function(key) {
    const stored = await chrome.storage.local.get('cognitionState');
    const state = stored.cognitionState || {};
    console.log(`${key}:`, state[key]);
    return state[key];
  }

  // 3. View all Fitbit tokens and auth info
  window.viewFitbitAuth = async function() {
    const auth = await chrome.storage.sync.get(['fitbitAccessToken', 'fitbitRefreshToken', 'fitbitTokenExpiry']);
    const hasToken = !!auth.fitbitAccessToken;
    const isExpired = auth.fitbitTokenExpiry ? Date.now() > auth.fitbitTokenExpiry : 'No expiry set';
    
    console.log('Fitbit Auth Status:', {
      hasAccessToken: hasToken,
      hasRefreshToken: !!auth.fitbitRefreshToken,
      tokenExpired: isExpired,
      expiresAt: auth.fitbitTokenExpiry ? new Date(auth.fitbitTokenExpiry).toLocaleString() : 'Not set'
    });
    
    return auth;
  }

  // 4. Execute action via message passing
  window.executeAction = async function(actionName, params = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'EXECUTE_ACTION',
        action: actionName,
        params: params
      }, (response) => {
        console.log(`Action ${actionName} result:`, response);
        resolve(response);
      });
    });
  }

  // 5. Watch state changes in real-time
  window.watchState = function(key) {
    if (window._stateWatcher) {
      window._stateWatcher.close();
    }
    
    window._stateWatcher = new BroadcastChannel('cognition-state');
    console.log(`Watching for changes to: ${key || 'all state'}`);
    
    window._stateWatcher.onmessage = (event) => {
      if (!key || event.data.key === key) {
        console.log(`[State Change] ${event.data.key}:`, event.data.value);
      }
    };
    
    console.log('Call stopWatching() to stop');
  }

  // Stop watching state
  window.stopWatching = function() {
    if (window._stateWatcher) {
      window._stateWatcher.close();
      window._stateWatcher = null;
      console.log('Stopped watching state');
    }
  }

  // 6. Manually set state (for testing)
  window.setState = async function(key, value) {
    const stored = await chrome.storage.local.get('cognitionState');
    const state = stored.cognitionState || {};
    state[key] = value;
    await chrome.storage.local.set({ cognitionState: state });
    
    // Broadcast the change
    const channel = new BroadcastChannel('cognition-state');
    channel.postMessage({ key, value });
    channel.close();
    
    console.log(`Set ${key} to:`, value);
  }

  // 7. View sleep/activity data
  window.viewHealthData = async function() {
    const stored = await chrome.storage.local.get('cognitionState');
    const state = stored.cognitionState || {};
    
    const health = {
      sleep: {
        hours: state['sleep.lastNight.hours'] || 'No data',
        quality: state['sleep.lastNight.quality'] || 'No data'
      },
      activity: {
        calories: state['activity.today.calories'] || 'No data'
      },
      heart: {
        bpm: state['heart.current.bpm'] || 'No data'
      },
      system: {
        status: state['system.status'] || 'Unknown',
        modules: state['system.modules'] || []
      }
    };
    
    console.log('Health Data:', health);
    return health;
  }

  // 8. Test Fitbit connection
  window.testFitbit = async function() {
    console.log('Testing Fitbit connection...');
    const result = await executeAction('fitbit.refreshAllData');
    if (result.success) {
      console.log('✅ Fitbit working! Data updated.');
      await viewHealthData();
    } else {
      console.log('❌ Fitbit error:', result.error);
    }
    return result;
  }

  // 9. Clear all state (for testing)
  window.clearState = async function() {
    if (confirm('Clear all state data? This cannot be undone.')) {
      await chrome.storage.local.clear();
      await chrome.storage.sync.clear();
      console.log('All state cleared. Reload extension to reinitialize.');
    }
  }

  // 10. List all available actions (if accessible)
  window.listActions = function() {
    if (globalThis.cognitionState?.actions) {
      const actions = globalThis.cognitionState.actions.list();
      console.table(actions);
      return actions;
    } else {
      console.log('Direct action access not available. Use executeAction() to run actions.');
      console.log('Common actions:');
      console.log('  - fitbit.fitbitAuth');
      console.log('  - fitbit.refreshAllData');
      console.log('  - fitbit.handleAuthCallback');
      console.log('  - ui.show');
      console.log('  - ui.hide');
      console.log('  - ui.toggle');
      console.log('  - ui.notify');
      console.log('  - ui.modal');
    }
  }

  // 11. View all storage
  window.viewAllStorage = async function() {
    const local = await chrome.storage.local.get();
    const sync = await chrome.storage.sync.get();
    
    console.log('=== Local Storage ===');
    console.log(local);
    console.log('\n=== Sync Storage ===');
    console.log(sync);
    
    return { local, sync };
  }

  // 12. Force token refresh
  window.refreshFitbitToken = async function() {
    console.log('Forcing token expiry to test refresh...');
    await chrome.storage.sync.set({ 
      fitbitTokenExpiry: Date.now() - 1000 // Set to past
    });
    console.log('Token marked as expired. Now try:');
    console.log('  testFitbit()');
  }

  // Auto-display help on load
  console.log(`
🧠 Cognition Dev Helpers Loaded!

State Management:
  viewState()              - See all current state
  getState('key')          - Get specific state value
  setState(key, value)     - Manually set state
  watchState()             - Watch all state changes
  watchState('key')        - Watch specific key
  stopWatching()           - Stop watching state
  clearState()             - Clear all data (careful!)
  viewAllStorage()         - View all Chrome storage

Fitbit:
  viewFitbitAuth()         - Check Fitbit auth status
  testFitbit()             - Test Fitbit connection
  refreshFitbitToken()     - Force token refresh (testing)
  executeAction('fitbit.fitbitAuth')     - Start auth
  executeAction('fitbit.refreshAllData') - Refresh data

UI:
  executeAction('ui.toggle')   - Toggle UI
  executeAction('ui.show')     - Show UI
  executeAction('ui.hide')     - Hide UI
  executeAction('ui.notify', {message: 'Test'}) - Show notification

Other:
  viewHealthData()         - See Fitbit data summary
  listActions()            - List available actions
  executeAction(name, params) - Run any action

Quick Start:
1. viewFitbitAuth()  - Check if connected
2. If not connected: executeAction('fitbit.fitbitAuth')
3. testFitbit()      - Verify it's working
`);

  // Check initial status
  viewFitbitAuth();
  
} else {
  console.log('[Dev Helpers] Skipped - production build');
}