# Cognition Extension
## Vision
a knowledge companion that grows more helpful as you use it.

Imagine an AI assistant that truly extends your mind - not another app to switch to, but an ambient intelligence that listens, remembers, and acts on your behalf while you work. `Cognition` runs continuously in your browser, built from simple pieces of code (modules) you choose based on your needs, creating a personalized AI that grows with you.

Speak naturally. `Cognition` maintains context across everything - your browser tabs, your calendar, your files. It remembers your projects, your people, your ideas. Unlike traditional assistants, you build `Cognition` from modules that match your workflow, creating an AI that's uniquely yours.
## Key Principles
🎯 **Modular by Design** - Install only the capabilities you need  
🧠 **Continuous Context** - Maintains state across interactions   
🔧 **Open** - Every module is readable, modifiable, and under ~500 lines  
🔒 **Private** - Your data stays yours, stored where you choose  
🚀 **Ambient** - Runs in the background, activated by voice or events  

## Project Status
- Near Term Goal: Semantic search that actually works
### What Works:
✅ Modules communicate across 3 contexts of Chrome extension (service worker, extension page, and offscreen document)
✅ Integrated module testing capabilitites
✅ Local embedding models running
✅ LLM providers connected (Claude, GROQ)
✅ Graph-DB running on IndexedDB
✅ Proof of Concepts for: OAuth, web search, and api
✅ Basic UI
### Work In Progress:
❌ Testable quality chunking
❌ Testable quality Graph 
❌ Graph Retreival from prompt 

## Getting Started (For Developers)
### Prerequisites
- Chrome browser
- Node.js 18+
- Basic JavaScript knowledge
### Build Your First Extension
```bash
# Clone the repository
git clone https://github.com/voicebrain/cognition-extension
cd cognition-extension
# Install dependencies
npm install
# Build with default modules
npm run build
# The extension is now in build/
```
### Install in Chrome
1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `build/` folder
### Debugging
1. Go to `chrome://extensions`
2. Click "service worker" under Cognition Extension to open dev console
3. Wait 2-3 seconds for initialization
## Documentation 
1. **[Architecture Overview](./Architecture.md)** - Understand how Cognition works
2. **[Modules](./Modules.md)** - Learn about the modular system
3. **[Knowledge](./Knowledge.md)** - Persistent knowledge graph
4. **[Chrome OS Notes](./Chrome%20OS.md)** - Why Chrome OS is the ideal platform
## Contributing
We're not ready for contributions yet, but star the repo to follow progress!
## License
MIT - Build whatever you want with it