# Cognition Extension Debugging Checklist

## 1. Initial Extension Load Check

### In Chrome Extensions Page (chrome://extensions)
- [ ] Extension is loaded without errors
- [ ] Service worker shows as "Active"
- [ ] No errors in "Errors" button
- [ ] Manifest version shows as 3

### Open Service Worker Console
1. Click "service worker" link under Cognition Extension
2. Wait 2-3 seconds for initialization
3. Check for any red error messages

## 2. Core Initialization Tests

Run these commands in the service worker console:

```javascript
// Check if state is initialized
globalThis.cognitionState
// Expected: StateStore object

// Check system status
await globalThis.cognitionState.read('system.status')
// Expected: 'ready'

// Check loaded modules
await globalThis.cognitionState.read('system.modules')
// Expected: Array with fitbit, ui, transcript modules

// Check for any errors
await globalThis.cognitionState.read('system.errors')
// Expected: Empty array or specific error details
```

## 3. Module Registration Tests

```javascript
// List all registered actions
listActions()
// Expected: Table showing actions from all modules

// Check specific module actions exist
globalThis.cognitionState.actions.has('ui.toggle')
globalThis.cognitionState.actions.has('fitbit.refreshAllData')
globalThis.cognitionState.actions.has('transcript.startTranscription')
```

## 4. UI Module Tests

```javascript
// Test UI toggle
await executeAction('ui.toggle')
// Expected: {success: true, value: true/false}

// Check UI state
await globalThis.cognitionState.read('ui.visible')

// Test notification
await executeAction('ui.notify', {
  message: 'Test notification',
  type: 'info'
})
```

## 5. Fitbit Module Tests

```javascript
// Check Fitbit auth status
await globalThis.cognitionState.read('fitbit.auth.status')
// Expected: 'connected' or 'disconnected'

// View Fitbit tokens (if connected)
await globalThis.cognitionState.oauthManager.isAuthenticated('fitbit')

// Test Fitbit data refresh (if authenticated)
testFitbit()
```

## 6. State Management Tests

```javascript
// Test state write/read
await globalThis.cognitionState.write('test.debug', 'hello')
await globalThis.cognitionState.read('test.debug')
// Expected: 'hello'

// Test state watching
watchState('test.debug')
await globalThis.cognitionState.write('test.debug', 'changed')
// Expected: Console log showing change

stopWatching()
```

## 7. Common Issues to Check

### Issue: "globalState not initialized"
- Wait 2-3 seconds after reload
- Run `debugInit()` to see initialization details
- Check for errors in `system.errors`

### Issue: Actions not showing up
- Check if modules loaded: `await globalThis.cognitionState.read('system.modules')`
- Look for module initialization errors in console
- Verify module files are in build folder

### Issue: OAuth not working
- Check for multiple auth windows
- Look for "processingOAuthCodes" errors
- Verify OAuth configuration in fitbit.module.js

### Issue: UI not appearing
- Open a regular webpage (not chrome:// pages)
- Check if content script injected
- Look for CSP errors in page console

## 8. Test Page Verification

1. Open test.html in a browser tab
2. Try each button:
   - Toggle UI Overlay
   - Show Test Notification
   - Connect Fitbit
   - Refresh State

## 9. Module-Specific Debug Commands

```javascript
// View all health data
viewHealthData()

// Debug Fitbit specifically
debugFitbit()

// Check OAuth manager state