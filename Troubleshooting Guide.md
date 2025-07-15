# Troubleshooting Guide

This guide covers common issues and their solutions.

## Service Worker Issues

### "import() is disallowed on ServiceWorkerGlobalScope"

**Problem:** Dynamic imports like `import('./module.js').then()` don't work in service workers.

**Solution:** Use static imports at the top of the file:
```javascript
// ❌ BAD - Dynamic import
import('./dev-console-helper.js').then(() => {
  console.log('Loaded');
});

// ✅ GOOD - Static import
import './dev-console-helper.js';
```

### "globalState not initialized yet"

**Problem:** Trying to use the state before initialization completes.

**Solution:** 
1. Wait a few seconds after extension reload
2. Check initialization status: `debugInit()`
3. Move debug exports inside `initializeExtension()` after state creation

## OAuth Issues

### "processingOAuthCodes is not defined"

**Problem:** Variable used but never declared in background.js.

**Solution:** Add at the top of background.js:
```javascript
// Track OAuth codes being processed to prevent duplicate handling
const processingOAuthCodes = new Set();
```

### OAuth State Mismatch Errors

**Problem:** Multiple auth flows creating different state values, causing mismatches.

**Symptoms:**
```
[Fitbit] State mismatch - expected: abc123 got: xyz789
```

**Solutions:**
~~1. **Prevent concurrent auth flows:**
   ```javascript
   // In fitbit.module.js, check for existing flow
   const stored = await chrome.storage.sync.get(['fitbitAuthState', 'fitbitAuthInProgress']);
   if (stored.fitbitAuthInProgress) {
     console.log('[Fitbit] Auth already in progress, skipping');
     return;
   }
   ```~~
~~
2. **Clear stale state before new auth:**
   ```javascript
   await chrome.storage.sync.remove(['fitbitAuthState']);
   ```~~

3. **Use deduplication in listeners:**
   - Both `webNavigation` and `tabs.onUpdated` can fire for same callback
   - Check `processingOAuthCodes` Set before processing

### Multiple OAuth Windows

**Problem:** User clicks auth button multiple times, opening multiple windows.

**Solution:** Track active auth state and prevent multiple windows:
```javascript
let isOAuthFlowActive = false;

export async function startOAuthFlow(state) {
  if (isOAuthFlowActive) {
    console.log('[Module] OAuth flow already active');
    return;
  }
  isOAuthFlowActive = true;
  // ... rest of flow
}
```

## State Management Issues

### Actions Not Registering

**Problem:** `listActions()` returns empty array despite modules being loaded.

**Causes:**
1. `registerModuleActions()` called before state is ready
2. Module exports not being detected properly
3. Timing issue with globalState assignment

**Solution:** Ensure proper initialization order:
```javascript
// In initializeExtension()
1. Create StateStore
2. Wait for loadPersistedState()
3. Register module actions
4. Initialize modules
5. Export to globalThis (for debugging)
```

### State Not Persisting

**Problem:** State lost on service worker restart.

**Solution:** Always persist to chrome.storage:
```javascript
// ❌ BAD - Only in memory
this.localState[key] = value;

// ✅ GOOD - Persist immediately
await chrome.storage.local.set({ cognitionState: state });
```

## Module Development Issues

### Circular Import Dependencies

**Problem:** Module tries to import from background.js.

**Solution:** Modules receive state as parameter - no imports needed:
```javascript
// ❌ BAD
import { globalState } from './background.js';

// ✅ GOOD
export async function myAction(state, params) {
  await state.write('my.key', 'value');
}
```

### Module Not Loading

**Problem:** Module file exists but isn't loading.

**Debug steps:**
1. Check file is in build folder
2. Verify filename matches import exactly
3. Check for syntax errors in module
4. Look for console errors during initialization
5. Verify module is in `enabledModules` array

## Dev Console Helper Issues

### Helpers Not Available

**Problem:** Functions like `viewState()` not defined in console.

**Checklist:**
1. ✓ File named correctly (`dev-console-helper.js` not `helpers`)
2. ✓ File included in build process
3. ✓ Static import in background.js
4. ✓ No syntax errors in helper file
5. ✓ Checking service worker console (not popup or page console)
6. ✓ Waiting for initialization to complete

### executeAction Not Working

**Problem:** `executeAction` fails with various errors.

**Solution:** Use the state's action system directly:
```javascript
// If using direct access
await globalThis.cognitionState.actions.execute('module.action', params)

// If state not ready, wait
if (!globalThis.cognitionState?.actions) {
  console.log('State not ready, try again in a few seconds');
}
```

## Chrome Extension Issues

### Changes Not Showing

**Problem:** Code changes don't appear after reload.

**Solution:**
1. Run build: `npm run build:dev`
2. Click reload button in chrome://extensions
3. Close and reopen service worker console
4. For persistent issues: Remove and re-add extension

### "Cannot read property of undefined"

**Problem:** Trying to access Chrome APIs that don't exist.

**Common causes:**
- Using `window` in service worker (use `globalThis`)
- API needs permission in manifest.json
- API not available in service workers

## Quick Diagnostic Commands

```javascript
// Check everything at once
debugInit()      // See initialization state
listActions()    // Verify actions loaded
viewState()      // Check current state
debugFitbit()    // Full Fitbit diagnostic

// Reset if needed
clearState()     // Clear all data (careful!)
clearFitbitAuth() // Reset Fitbit connection
```

## Getting More Help

1. Check console for error messages
2. Look for `[Background]`, `[Fitbit]`, `[StateStore]` prefixed logs
3. Use `watchState()` to monitor state changes
4. Enable verbose logging by adding more console.log statements
5. Check the [Module Developer Guide](./Module%20Developer%20Guide.md) for patterns