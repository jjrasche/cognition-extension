## Big STuff
Throughout this documentation, I am referring to the entity made up by persistant memory, state, and infernece as `Cognition`.
## Quick Start
### 1. Install Your First Build (2 minutes)
1. Visit [voicebrain.ai/marketplace](https://voicebrain.ai/marketplace)
2. Select modules:
   - ✓ Audio Capture (required)
   - ✓ Transcription (required)
   - ✓ LLM Service (required)
   - ✓ Any others you want
3. Click "Build My Extension"
4. Install the downloaded .crx file
### 2. First Voice Command
1. Click the Cognition icon in your browser
2. Say: "Start listening"
3. Say: "What can you do?"
4. Watch your personalized AI respond based on your modules
### 3. Explore Your Capabilities
Each module adds new abilities. With the starter pack:
- **Navigation**: "Go to my email", "Switch to the GitHub tab"
- **Knowledge**: "Remember this idea", "What did I say about Project X?"
- **Tasks**: "Add a task to review the proposal"
## Core Concepts
### Modules: Your Building Blocks
Each module is a single capability that does one thing well. Like apps on your phone, you choose which ones to install. Modules can:
- Listen to your voice
- Control your browser  
- Store your knowledge
- Connect to services
- Create custom UI
### Your Second Brain
The knowledge graph stores information the way you think - as a network of connected ideas. Unlike folders, it grows with you and helps the AI understand YOUR context.
### Zero Friction Philosophy
No switching apps. No copy-paste. No remembering commands. Just speak naturally and your AI figures out which modules to use.
## Key Features
🎯 **Modular by Design** - Only install what you need  
🧠 **Knowledge Graph** - Your permanent, searchable memory  
🔧 **Hackable** - Every module is open source and < 500 lines  
🚀 **Fast** - Runs locally in your browser  
🔒 **Private** - You control where your data lives  
📱 **Cross-Device** - Works on desktop and tablets  
## Documentation
- [Architecture Overview](./ARCHITECTURE.md) - How the system works
- [Module Development](./MODULES.md) - Build your own modules  
- [Build & Deploy](./BUILD-AND-DEPLOY.md) - Compilation and distribution
- [Design Decisions](./DECISIONS.md) - Why we built it this way
- [Module Catalog](./MODULE-CATALOG.md) - Available modules
## Getting Started as a Developer
```bash
# Clone the repo
git clone https://github.com/voicebrain/voice-brain-assistant
# Install dev tools
npm install
# Create your first module
npm run create-module my-awesome-module
# Test it
npm test modules/my-awesome-module.js
# Submit to marketplace
npm run submit modules/my-awesome-module.js
```
## Community
- **Discord**: [discord.gg/voicebrain](https://discord.gg/voicebrain) - Get help, share modules
- **Modules**: [github.com/voicebrain/modules](https://github.com/voicebrain/modules) - Community modules
- **Ideas**: [github.com/voicebrain/ideas](https://github.com/voicebrain/ideas) - Request features
## Philosophy
We believe AI assistants should:
1. **Amplify** what you can do, not replace you
2. **Adapt** to your workflow, not force you into theirs
3. **Compose** from simple pieces you understand
4. **Respect** your privacy and data ownership
## License
MIT - Build whatever you want with it
