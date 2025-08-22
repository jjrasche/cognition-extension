# Cognition Extension Architecture
## Runtime Contexts
- Extension Page: for UI display. Passthrough console output for all other contexts
- Service Worker: hosts most modular funcionality 
- Content Script: can interact with user browsing 
- Offscreen Document: runs modules with heavy/consistent computation demands (ML)
## Communication: Pure Action/Request Pattern
- Action Initiated: chrome.runtime.sendMessage({action: 'module.actionName', params}, callback)
- Action Routed: 1 chrome.runtime.onMessage.addListener per context with actionable code (service worker, offscreen document, extension page)
## Web Tree Structure
The Web Tree is Cognition's fundamental data format - a hierarchical object structure that represents any UI, content, or document in a consistent way.
```javascript
{
  "container-1": {
    tag: "div",
    "title-1": { tag: "h1", text: "Page Title" },
    "content-1": { tag: "p", text: "Paragraph content",
      "bold-1": {tag: "b" text: "important"}
    },
    "button-1": { tag: "button", text: "Click me", events: { click: "action.name"} }
  }
}