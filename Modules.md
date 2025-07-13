[Modules](./Modules.md) are how you customize capability your extended cognition customize your AI assistant. Each module serves a single purpose - like "transcribe my voice" or "search my knowledge graph". You can add, remove, exchange, or write your own `Modules`. Want better voice recognition? Swap the module. Need to track tasks differently? Replace the task module. Have AI create custom behavior just for you. This modularity creates zero-friction AI amplification by letting you assemble exactly the assistant you need.

Modules are self-contained capabilities that extend your assistant. Each module:
- Does one thing well
- Declares what state it reads/writes
- Exposes actions the AI can use
- Contains its own tests

Read more in the [Module Developer Guide](./Module%20Developer%20Guide.md)