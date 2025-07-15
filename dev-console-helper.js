// Development console helpers for Cognition Extension
// This file is automatically loaded in development builds

// Only load in development
if (!chrome.runtime.getManifest().update_url) {
  globalThis.viewHealthData = async function() {
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

  globalThis.testFitbit = async function() {
    console.log('Testing Fitbit connection...');
    const result = await globalThis.cognitionState.actions.execute('fitbit.refreshAllData'); 
    if (result.success) {
      console.log('✅ Fitbit working! Data updated.');
      await viewHealthData();
    } else {
      console.log('❌ Fitbit error:', result.error);
    }
    return result;
  }

  globalThis.listActions = function() {
    const actions = globalThis.cognitionState.actions.list(); // todo fix to not use globalThis
    console.table(actions);
    return actions;
  }
}