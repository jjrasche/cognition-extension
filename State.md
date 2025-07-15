
[State](./State.md) is the current information [Modules](./Modules.md) share. What you just said, what task is active, an email you just received. Think of it as the shared whiteboard where [Modules](./Modules.md) write updates that others instantly see. While [Knowledge](./Knowledge.md) stores permanent information, [State](./State.md) holds what's happening right now.

- **Persistent state via chrome.storage**: All state persists across service worker restarts
- **Granular watching**: Subscribe to specific keys or patterns (e.g., `ui.*`)
- **Automatic sync**: Changes propagate instantly via chrome.storage.onChanged

```javascript
// Example state structure
{
  "speech.transcript.current": "Schedule meeting with John",
  "browser.activeTab": "calendar.google.com", 
  "ui.visible": true,
  "fitbit.lastSync": "2024-01-15T10:30:00Z",
  "sleep.lastNight.hours": 7.5,
  "system.status": "ready"
}
```

## How State Works

State is stored in `chrome.storage.local` under a single key (`cognitionState`) for efficiency. The StateStore class provides a clean API:

```javascript
// Write state
await state.write('sleep.hours', 7.5);

// Read state  
const hours = await state.read('sleep.hours');

// Watch for changes
const unwatch = state.watch('sleep.*', (value) => {
  console.log('Sleep data updated:', value);
});
```