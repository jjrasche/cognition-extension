### Module Developer Guide

## Module Structure

Every module is a single JavaScript file that exports functions. No classes, no complex abstractions - just functions that do one thing well.

```javascript
// email-module.js

// Private helper functions (not exported = not actions)
function validateEmailAddress(email) {
  return email.includes('@');
}

// Required: Initialize function
export function initialize(state, config) {
  // Set up any watchers, timers, or initial state
  state.watch('voice.transcript.current', async (transcript) => {
    if (transcript.includes('send email')) {
      // React to voice commands
    }
  });
}

// Actions: Any exported function (except 'initialize') becomes an action
export async function sendEmail({ to, subject, body }) {
  if (!validateEmailAddress(to)) {
    throw new Error('Invalid email address');
  }
  
  // Do the actual work
  const result = await gmailAPI.send({ to, subject, body });
  
  // Return the result - system handles state updates
  return { 
    success: true, 
    messageId: result.id,
    sentAt: new Date().toISOString()
  };
}

export async function checkInbox() {
  const messages = await gmailAPI.getMessages();
  return { count: messages.length, messages };
}

// Tests: Export as 'tests' array
export const tests = [
  {
    name: 'validates email addresses',
    fn: async () => {
      try {
        await sendEmail({ to: 'invalid-email' });
        assert(false, 'Should have thrown');
      } catch (e) {
        assert(e.message.includes('Invalid'));
      }
    }
  },
  {
    name: 'sends email successfully',
    fn: async () => {
      const result = await sendEmail({ 
        to: 'test@example.com',
        subject: 'Test',
        body: 'Hello'
      });
      assert(result.success === true);
      assert(result.messageId);
    }
  }
];
```

## Core Concepts

### 1. Single Responsibility
Each module does ONE thing. Don't create a SwissArmyKnifeModule:
- ❌ `EmailAndCalendarAndTaskModule`
- ✅ `EmailModule`, `CalendarModule`, `TaskModule`

### 2. Action Discovery
Any function you export (except `initialize`) automatically becomes an action the AI can call:
```javascript
// These become actions
export function sendEmail() { }
export function checkInbox() { }
export async function searchEmails() { }

// These don't (not exported)
function helperFunction() { }
const PRIVATE_CONSTANT = 'value';
```

### 3. State Management
Modules communicate through shared state. Follow the naming pattern: `noun.type.property`

```javascript
// Good state keys
'email.inbox.count'         // Domain: email, Type: inbox, Property: count
'calendar.events.today'     // Domain: calendar, Type: events, Property: today
'voice.transcript.current'  // Domain: voice, Type: transcript, Property: current

// Bad state keys
'inboxCount'               // No structure
'email-inbox-count'        // Use dots, not dashes
'getEmailCount'           // Not a verb, this is data
```

Only ONE module should write to each state path:
```javascript
// Email module owns all 'email.*' state
state.write('email.inbox.count', 5);        // ✅ Email module
state.write('email.settings.signature', ''); // ✅ Email module

// Calendar module trying to write email state
state.write('email.inbox.count', 10);       // ❌ Don't do this!
```

### 4. Action Flow

Actions are triggered through state, not direct function calls:

```javascript
// How the system calls your action:
// 1. Someone (AI, another module, user) requests an action
state.write('actions.request', {
  id: 'unique-123',
  action: 'email.sendEmail',
  params: { to: 'john@example.com', subject: 'Hello' }
});

// 2. System automatically:
//    - Reads the request
//    - Calls your sendEmail function
//    - Writes the result to state

// 3. If you care about the result, watch for it:
state.watch('actions.completed.unique-123', (result) => {
  console.log('Email sent:', result);
});
```

You don't handle this flow - just implement your function and return results.

## Module Lifecycle

### Chrome Extension Environment
Service workers can be terminated after 30 seconds of inactivity. Your module must be prepared for this:

```javascript
export function initialize(state, config) {
  // ✅ Good: Use state for anything important
  state.watch('voice.transcript.current', async (transcript) => {
    const analysis = await analyzeTranscript(transcript);
    state.write('email.analysis.latest', analysis); // Persisted!
  });
  
  // ❌ Bad: Don't rely on in-memory variables
  let importantData = {};  // This will be lost!
}
```

### No Cleanup Needed
When Chrome terminates the service worker, it doesn't call cleanup methods. Design your module to be stateless:
- Write important data to state immediately
- Don't rely on cleanup for critical operations
- Assume every operation might be your last

## State Patterns

### Reading State
```javascript
// Get single value
const count = await state.read('email.inbox.count');

// Watch for changes
state.watch('voice.transcript.current', (newTranscript) => {
  console.log('User said:', newTranscript);
});

// Watch patterns (if supported)
state.watch('email.inbox.*', (key, value) => {
  console.log(`Inbox update: ${key} = ${value}`);
});
```

### Writing State
```javascript
// Write single value
await state.write('email.inbox.count', 42);

// Write complex data
await state.write('email.inbox.messages', {
  total: 42,
  unread: 5,
  items: [...]
});
```

## Testing Your Module

### Test Structure
```javascript
export const tests = [
  {
    name: 'descriptive test name',
    fn: async () => {
      // Your test code
      const result = await yourFunction();
      assert(result === expected);
    }
  }
];
```

### Using Test Utilities
```javascript
import { createMockState, assert } from '../core/test-utils.js';

export const tests = [
  {
    name: 'updates state correctly',
    fn: async () => {
      const state = createMockState();
      await initialize(state, {});
      
      // Trigger some behavior
      await state.write('voice.transcript.current', 'send email');
      
      // Check the result
      const analysis = await state.read('email.analysis.latest');
      assert(analysis !== undefined);
    }
  }
];
```

### Mocking External Services
```javascript
// Mock your external dependencies
const mockGmailAPI = {
  send: async (params) => ({ id: 'mock-123', status: 'sent' }),
  getMessages: async () => [{ id: '1', subject: 'Test' }]
};

// Use mocks in tests
export const tests = [
  {
    name: 'handles API errors gracefully',
    fn: async () => {
      // Override with failing mock
      const original = gmailAPI.send;
      gmailAPI.send = async () => { throw new Error('API Down'); };
      
      try {
        await sendEmail({ to: 'test@test.com' });
        assert(false, 'Should have thrown');
      } catch (e) {
        assert(e.message === 'API Down');
      }
      
      // Restore
      gmailAPI.send = original;
    }
  }
];
```

## Best Practices

### 1. Handle Errors Gracefully
```javascript
export async function riskyOperation(params) {
  try {
    const result = await externalAPI.call(params);
    return { success: true, data: result };
  } catch (error) {
    // Don't crash the whole system
    console.error('[EmailModule] Error:', error);
    
    // Return error info for the AI to handle
    return { 
      success: false, 
      error: error.message,
      suggestion: 'Check your internet connection and try again'
    };
  }
}
```

### 2. Validate Input
```javascript
export async function sendEmail({ to, subject, body }) {
  // Validate required params
  if (!to) throw new Error('Recipient (to) is required');
  if (!subject) throw new Error('Subject is required');
  
  // Validate format
  if (!to.includes('@')) {
    throw new Error('Invalid email address format');
  }
  
  // Proceed safely
  return await gmailAPI.send({ to, subject, body });
}
```

### 3. Keep Actions Fast
```javascript
export async function analyzeInbox() {
  // ❌ Bad: Long-running in action
  const allEmails = await fetchAllEmails(); // Could be thousands
  const analysis = await deepAnalyze(allEmails); // Takes 30+ seconds
  return analysis;
  
  // ✅ Good: Start async process, return immediately
  state.write('email.analysis.status', 'started');
  
  // Do the work asynchronously
  setTimeout(async () => {
    const allEmails = await fetchAllEmails();
    const analysis = await deepAnalyze(allEmails);
    state.write('email.analysis.result', analysis);
    state.write('email.analysis.status', 'completed');
  }, 0);
  
  return { started: true, watchKey: 'email.analysis.status' };
}
```

### 4. Document Your Actions
Make your actions self-documenting with clear names and parameters:
```javascript
// ✅ Good: Clear, specific, documented
export async function sendEmail({ to, subject, body, cc, attachments }) {
  // Parameters are self-explanatory
}

// ❌ Bad: Vague, unclear
export async function process(data) {
  // What does this do? What's in data?
}
```

## Module Manifest

While not implemented yet, modules should include metadata:
```javascript
export const manifest = {
  name: 'Email Module',
  description: 'Send and receive emails via Gmail',
  version: '1.0.0',
  author: 'Your Name',
  permissions: ['gmail.send', 'gmail.read'],
  state: {
    writes: ['email.*'],
    reads: ['voice.transcript.current']
  }
};
```

## Example: Simple Timer Module

Here's a complete, minimal module:

```javascript
// timer-module.js

let intervals = [];

export function initialize(state, config) {
  // Watch for timer commands
  state.watch('voice.transcript.current', (transcript) => {
    if (transcript.includes('set timer')) {
      const minutes = parseInt(transcript.match(/(\d+) minutes?/)?.[1] || '5');
      startTimer({ minutes });
    }
  });
}

export function startTimer({ minutes }) {
  const id = Date.now().toString();
  const endTime = Date.now() + (minutes * 60 * 1000);
  
  // Store timer info
  state.write(`timers.active.${id}`, {
    id,
    minutes,
    endTime,
    startTime: Date.now()
  });
  
  // Set the actual timer
  const timeoutId = setTimeout(() => {
    state.write('timers.finished.latest', {
      id,
      message: `Your ${minutes} minute timer is done!`
    });
    state.write(`timers.active.${id}`, null); // Remove active timer
  }, minutes * 60 * 1000);
  
  intervals.push(timeoutId);
  
  return { 
    success: true, 
    timerId: id,
    message: `Timer set for ${minutes} minutes`
  };
}

export function listTimers() {
  // Read all active timers
  const activeTimers = state.read('timers.active');
  return Object.values(activeTimers || {});
}

export const tests = [
  {
    name: 'creates timer with correct duration',
    fn: async () => {
      const state = createMockState();
      const result = startTimer({ minutes: 5 });
      
      assert(result.success === true);
      assert(result.message.includes('5 minutes'));
      
      const timer = await state.read(`timers.active.${result.timerId}`);
      assert(timer.minutes === 5);
    }
  }
];
```

## Next Steps

1. Start with a simple module that solves one problem
2. Test it thoroughly
3. Iterate based on real usage
4. Share with the community

Remember: The best modules do one thing incredibly well. What will yours do?