[Modules](./Modules.md) are how you customize capability your extended cognition customize your AI assistant. Each module serves a single purpose - like "transcribe my voice" or "search my knowledge graph". You can add, remove, exchange, or write your own `Modules`. Want better voice recognition? Swap the module. Need to track tasks differently? Replace the task module. Have AI create custom behavior just for you. This modularity creates zero-friction AI amplification by letting you assemble exactly the assistant you need.

Modules are self-contained capabilities that extend your assistant. Each module:
- Does one thing well
- Declares what state it reads/writes
- Exposes actions the AI can use
- Contains its own tests

### UI Form Module Call Flow Example: API Key Setup
**api-keys.module.js** (business module)
```javascript
const apiKeyFormTree = {
  "api-form": {
    tag: "form",
    events: { 
      change: "api-keys.updateForm",
      submit: "api-keys.setKey" 
    },
    "key-input": { tag: "input", name: "key", type: "password" },
    "submit-btn": { tag: "button", type: "submit", text: "Save" }
  }
};
// Business module - specifies WHAT, WHERE, and HANDLERS
await runtime.call('ui.renderForm', {
  tree: apiKeyFormTree,
  title: 'Enter Claude API Key',
  placement: 'modal', // or 'main', 'sidebar'
});
```
**ui.module.js**
```javascript
// UI module handles placement
export const renderForm = async ({ tree, title, placement = 'modal' }) => {
  const container = getContainer(placement, title);
  await runtime.call('tree-transformer.transform', { tree, container });
};
```