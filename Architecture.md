## Cognition Extension Architecture

### Overview
Cognition is an AI assistant that runs continuously in your browser, built from modules you choose. It augments your thinking by maintaining context and knowledge while you work.

### Three Core Components

**[Knowledge](./Knowledge.md)**: Your permanent memory - everything Cognition remembers across sessions. When you mention people, projects, or ideas, they become part of your growing knowledge graph.

**[Modules](./Modules.md)**: Capabilities - each module adds specific functionality. Voice input, email access, calendar integration. You choose which modules to include when building your extension.


### Runtime Contexts
- Extension Page: for UI display. Passthrough console output for all other contexts
- Service Worker: hosts most modular funcionality 
- Content Script: can interact with user browsing 
- Offscreen Document: runs modules with heavy/consistent computation demands (ML)

### Communication: Pure Action/Request Pattern
- Action Initiated: chrome.runtime.sendMessage({action: 'module.actionName', params}, callback)
- Action Routed: 1 chrome.runtime.onMessage.addListener per context with actionable code (service worker, offscreen document, extension page)

#### State is maintained in:
- Module state: Private variables only -> enforces single writer pattern
- graphDB: one off interactions, long running data collection, configs, transient metadata 