``` javascript
// In content script - watch for state changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.cognitionState) {
    const state = changes.cognitionState.newValue;
    
    // React to specific state changes
    if (state['ui.visible'] !== undefined) {
      document.getElementById('vb-sidebar').style.display = 
        state['ui.visible'] ? 'block' : 'none';
    }
    
    if (state['ui.content']) {
      document.getElementById('vb-sidebar').innerHTML = state['ui.content'];
    }
  }
});

// Module in service worker - update state
await state.write('ui.visible', true);
await state.write('ui.content', '<div>New task added...</div>');
```