# Testing Guide

## Testing Philosophy

Keep tests simple, fast, and focused on the module's contract. Test what your module does, not how the browser works.

## What to Test

### ✅ DO Test
- **State changes** - Verify correct values are written
- **Action calls** - Confirm required actions are invoked
- **Return values** - Check success/error responses
- **Generated content** - Validate HTML/data structure
- **Edge cases** - Empty inputs, special characters, errors

### ❌ DON'T Test
- **Browser behavior** - DOM rendering, event firing
- **External APIs** - Chrome extensions, fetch responses
- **Integration** - Cross-module communication
- **Implementation details** - Private functions, timers

## Test Structure

```javascript
export const tests = [
  {
    name: 'descriptive test name',
    fn: async () => {
      const state = createMockState();
      const result = await yourAction(state, params);
      assert(state.data['your.key'] === expectedValue);
      assert(result.success === true);
    }
  }
];
```

## Common Test Helpers

```javascript
// Mock state with action support
const createMockState = () => ({
  data: {},
  async read(key) { return this.data[key]; },
  async write(key, value) { this.data[key] = value; },
  async writeMany(updates) { Object.assign(this.data, updates); },
  actions: {
    execute: async (action) => {
      // Mock common UI actions
      if (action === 'ui.show') return { success: true };
      if (action === 'ui.hide') return { success: true };
      return { success: false, error: 'Unknown action' };
    }
  }
});

// Simple assertion
const assert = (condition, message) => {
  if (!condition) throw new Error(message || 'Assertion failed');
};
```

## Testing Patterns

### State Updates
```javascript
{
  name: 'updates state correctly',
  fn: async () => {
    const state = createMockState();
    await myAction(state, { value: 42 });
    assert(state.data['my.key'] === 42);
  }
}
```

### Action Calls
```javascript
{
  name: 'calls required actions',
  fn: async () => {
    const state = createMockState();
    let uiShowCalled = false;
    state.actions.execute = async (action) => {
      if (action === 'ui.show') uiShowCalled = true;
      return { success: true };
    };
    await myAction(state);
    assert(uiShowCalled);
  }
}
```

### Edge Cases
```javascript
{
  name: 'handles edge cases',
  fn: async () => {
    const state = createMockState();
    
    // Empty input
    await myAction(state);
    assert(state.data['my.key'] !== undefined);
    
    // Special characters
    await myAction(state, { text: '<script>"&' });
    assert(!state.data['ui.content']?.includes('<script>'));
  }
}
```

## Running Tests

Tests are run during the build process:
```bash
npm test
```

Each module's tests are self-contained and can be run independently.