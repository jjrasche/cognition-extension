## Cognition Extension Architecture

### Overview
Cognition is an AI assistant that runs continuously in your browser, built from modules you choose. It augments your thinking by maintaining context and knowledge while you work.

### Three Core Components

**[Knowledge](./Knowledge.md)**: Your permanent memory - everything Cognition remembers across sessions. When you mention people, projects, or ideas, they become part of your growing knowledge graph.

**[State](./State.md)**: Current context - what's happening right now. Your recent words, active browser tab, current time. Ephemeral information that provides immediate context.

**[Modules](./Modules.md)**: Capabilities - each module adds specific functionality. Voice input, email access, calendar integration. You choose which modules to include when building your extension.

### The Cognition Loop

```
You speak → Voice module updates state with transcript
     ↓
Trigger (timer? event?) → Context Assembly gathers relevant state
     ↓
LLM receives: current context + available module actions
     ↓
AI decides: Just respond? Or take action(s)?
     ↓
If actions: Module executes → Results to state → Back to LLM (if multi-step)
     ↓
Response flows back to you (voice, notification, or UI update)
```

This happens continuously in the background. You're not "using an app" - you're thinking out loud while Cognition augments your capabilities.

### How Modules Coordinate

Modules don't communicate directly. Instead:
- Each module writes to its designated state paths
- Other modules can read any state
- The LLM orchestrates complex tasks by calling multiple module actions

Example flow:
```
Email module → writes → state.email.unreadCount: 5
Calendar module → writes → state.calendar.nextMeeting: "3pm with John"
LLM → reads both → "You have 5 unread emails. Want me to summarize them before your 3pm?"
```

### Runtime Components

- **Service Worker** (background.js): Initializes modules, manages state, routes actions
- **Offscreen Document**: Always-on media key listener
- **Content Scripts**: UI overlays injected by modules (see [UI Overlay](./UI%20Overlay.md))
- **Storage**: Config in chrome.storage, state via BroadcastChannel, knowledge in graph

### Design Philosophy

The magic isn't in complex code - it's in simple modules (<500 lines each) working together through shared state and AI orchestration. Each module does one thing well. The AI figures out how to combine them to help you.

### Next Steps

- To build your own modules: [Module Developer Guide](./Module%20Developer%20Guide.md)
- To understand our choices: [Design Decisions](./Decisions.md)
- To see the future vision: [Future Vision - Marketplace](./Future%20Vision%20-%20Marketplace.md)