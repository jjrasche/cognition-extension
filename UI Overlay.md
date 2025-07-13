3 UI actions:
- `notify()`: Temporary message (auto-dismiss)
- `confirm()`: Modal dialog (user must act)
- `display()`: Persistent sidebar content


``` javascript
// In content script (static file)
const stateChannel = new BroadcastChannel('voice-brain-state');

stateChannel.onmessage = (event) => {
  if (event.data.type === 'UI_UPDATE') {
    // Update the UI based on state change
    document.getElementById('vb-sidebar').innerHTML = event.data.content;
  }
};

// Module in service worker
stateChannel.postMessage({
  type: 'UI_UPDATE',
  content: '<div>New task added...</div>'
});
```