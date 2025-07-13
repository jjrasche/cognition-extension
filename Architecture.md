### Core Components
- [Knowledge](./Knowledge.md): Memory, all stored information you and Cognition can interacted with.
- [State](./State.md): Context, what Cognition has access to right now.
- [Modules](./Modules.md): Functionality, the tools that extends Cognition's capabilities.

### Extension Components
**Offscreen Document** (always on): Media key listener only
**Service Worker** (when active): 
- Initializes State (BroadcastChannel)
- Initizlizes all modules
- Creates module action registry
**UI Overlay Module**: 
- Loaded as content script into each tab
- Modules update ovlary through actions: `notify()`, `confirm()`, `display()`
- Keeps UI loosely coupled through these simple options
**Storage**:
- [Config](./Configuration.md): chrome.storage.local 
- [Secrets](./Secrets.md): Chrome password manager

### Example Data Flow: How Information Moves
From a module perspective:
1. **Audio module** listens and transcribes, writes transcript to `state`
2. **LLM module** notified of new transcript, sends t AI with context and available actions
3. **AI responds** with actions it wants to take
4. **Action requests** route through service worker to modules
5. **Modules execute** and return results via message passing
6. **LLM incorporates results** and updates `state` or saves to knowledge graph