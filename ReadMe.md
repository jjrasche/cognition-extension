# Cognition Extension
## Vision
Imagine an AI assistant that truly extends your mind - not another app to switch to, but an ambient intelligence that listens, remembers, and acts on your behalf while you work. `Cognition` runs continuously in your browser, built from simple pieces of code (modules) you choose based on your needs, creating a personalized AI that grows with you.

Speak naturally. `Cognition` maintains context across everything - your browser tabs, your calendar, your files. It remembers your projects, your people, your ideas. Unlike traditional assistants, you build `Cognition` from modules that match your workflow, creating an AI that's uniquely yours.

## Key Principles
🎯 **Modular by Design** - Install only the capabilities you need  
🧠 **Continuous Context** - Maintains state across all your work  
🔧 **Open** - Every module is readable, modifiable, and under 500 lines  
🚀 **Ambient** - Runs in the background, activated by voice or events  
🔒 **Private** - Your data stays yours, stored where you choose  

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

### First Run
1. Click the Cognition icon in your toolbar
2. Grant microphone permissions when asked
3. Say "Hello" - Cognition should respond

## Documentation

Start here, then explore based on your interests:

1. **[Architecture Overview](./Architecture.md)** - Understand how Cognition works
2. **[Modules](./Modules.md)** - Learn about the modular system
3. **[Module Developer Guide](./Module%20Developer%20Guide.md)** - Build your own modules
4. **[State](./State.md)** - How modules share real-time context
5. **[Knowledge](./Knowledge.md)** - Persistent memory system
6. **[Design Decisions](./Decisions.md)** - Why we built it this way

### Additional Resources
- **[Future Vision - Marketplace](./Future%20Vision%20-%20Marketplace.md)** - Where we're heading
- **[Chrome OS Notes](./Chrome%20OS.md)** - Why Chrome OS is the ideal platform
- **[UI Overlay](./UI%20Overlay.md)** - How modules create UI

## Project Status

⚠️ **Early Development** - This is a proof of concept. Expect breaking changes.

Current focus:
- [ ] Core module system
- [ ] Basic voice input/output
- [ ] State management via BroadcastChannel
- [ ] Simple LLM integration
- [ ] First 3-5 modules

## Contributing

We're not ready for contributions yet, but star the repo to follow progress!

## Philosophy

Traditional assistants make you adapt to them. Cognition adapts to you.

We believe AI should amplify human capability, not replace it. By making the system modular and transparent, you remain in control while gaining superpowers.

## License

MIT - Build whatever you want with it


## Debugging

The extension includes powerful debugging tools in development mode.

### Quick Start Debugging

1. **Open the service worker console:**
   - Go to `chrome://extensions`
   - Click "service worker" under Cognition Extension
   - Wait 2-3 seconds for initialization

2. **Essential commands:**
   ```javascript
   // See what's happening
   viewState()                    // View all state
   listActions()                  // List all available actions
   viewHealthData()               // See Fitbit data summary
   
   // Test functionality
   testFitbit()                   // Test Fitbit connection
   executeAction('ui.toggle')     // Toggle the UI
   
   // Watch changes in real-time
   watchState('sleep.lastNight.hours')
   stopWatching()
   ```

3. **Common issues:**
   - **"globalState not initialized"** - Wait a few seconds after reload
   - **Empty actions list** - Check if modules loaded: `getState('system.modules')`
   - **OAuth errors** - Run `debugFitbit()` for full diagnostic

See [Module Developer Guide](./Module%20Developer%20Guide.md#debugging-your-module) for complete debugging documentation.