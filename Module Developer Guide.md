### Module Template
```javascript
export default class MyAwesomeModule {
  static manifest = {
    id: 'my-awesome-module',
    name: 'My Awesome Module',
    version: '1.0.0',
    description: 'Does something awesome with voice commands',
    permissions: ['storage'], // What permissions does your module need? ??? Are these things the extension has to set up in its own manifest when it compiles so that it asks the user for permissions when it loads???
    dependencies: ['state-manager'], // What other modules must be installed? ??? Should these be dependencies be JavaScript libraries or other modules I don't like the idea of them being other modules and I'm not positive we need to explicitly depend on other modules but we could we do need to depend on libraries and the build process could pull those in dynamically???
    actions: ['doSomething', 'checkStatus'], // What functionality the module exposes?
    state: {
      reads: ['...'], // todo: need to come up with namine schema for this I think is verb object reasonable ???
      writes: ['...']
    }
  };
  
  constructor(state, config) {
    this.state = state;
    this.config = config;
  }
  
  async initialize() { } // Called on startup
  
  async cleanup() { } // Called on teardown
  
  async doSomething(params) {
    const transcript = await this.state.get('transcript'); // Read state
    const result = await this.processTranscript(transcript); // Do your thing
    await this.state.set('...', result); // Write state
    return { success: true, result }; // todo: does I'm considering how this works fundamentally so the action registry could keep a pointer to the method from the module and it could run and the return might be useful like it could run within I guess it's not running it's only running from the context of the module and it's only called via the broadcast channel but is are the results I guess there's a listener maybe the main questions I have to answer are what do I store in action registry that allows it to run from the module instance and what does the what do I pass back and who is responsible for and how does that get back to the caller. This success and results thing seems reasonable
  }
  
  getActions() {
    return {
      doSomething: this.doSomething.bind(this),
    };
  }
}

// Required: Module tests
export const tests = {
  unit: [
    {
      name: 'should process transcript correctly',
      fn: async () => {
        const module = new MyAwesomeModule();
        const result = await module.doSomething({ text: 'test' });
        assert(result.success === true);
      }
    }
  ],
  coverage: 80 // Minimum 80% coverage required
};
```


### Core Concepts
#### Single Responsibility
Each module does ONE thing. Don't create a SwissArmyKnifeModule:
❌ EmailAndCalendarAndTaskModule
✅ EmailModule, CalendarModule, TaskModule

2. State Management
Modules communicate through shared state. You declare what you read and write:
javascriptstate: {
  reads: ['transcript.current'],  // You can read these
  writes: ['mymodule.data']       // Only you can write these
}
Important: Only ONE module can write to each state path. This prevents conflicts.
3. Actions
Actions are what the LLM can ask your module to do:
javascript// LLM says: "Send an email to John"
// Your email module's action gets called:
async sendEmail({ to, subject, body }) {
  // Implementation
  return { sent: true, messageId: '123' };
}
4. No Direct Module Communication
Modules don't talk to each other directly. They communicate through:

State: Write data others can read
Events: Emit events others can listen to
Actions: LLM orchestrates between modules

State Patterns
Reading State
javascript// Get single value
const value = await this.state.get('some.path');

// Get multiple values
const { transcript, context } = await this.state.getMany([
  'transcript.current',
  'context.active'
]);

// Subscribe to changes
this.state.on('transcript.current', (newValue) => {
  console.log('Transcript updated:', newValue);
});
Writing State
javascript// Set single value
await this.state.set('mymodule.status', 'active');

// Set multiple values
await this.state.setMany({
  'mymodule.status': 'active',
  'mymodule.lastRun': Date.now()
});

// Delete state
await this.state.delete('mymodule.temp');
State Naming Conventions
Use dot notation with your module name as prefix:
javascript// Good
'email.drafts'
'email.contacts'
'calendar.events'

// Bad
'drafts'        // No module prefix
'emailDrafts'   // Use dots, not camelCase
'my-drafts'     // Use dots, not dashes
Common Module Types
1. Input Processors
Listen to user input and update state:
javascriptclass TranscriptionModule {
  async initialize() {
    this.audio.on('speech', async (audio) => {
      const text = await this.transcribe(audio);
      await this.state.set('transcript.current', text);
    });
  }
}
2. Action Providers
Provide capabilities the LLM can use:
javascriptclass WeatherModule {
  async getWeather({ location }) {
    const weather = await fetch(`/api/weather?q=${location}`);
    return weather.json();
  }
  
  getActions() {
    return { getWeather: this.getWeather.bind(this) };
  }
}
3. Background Monitors
Continuously monitor and update state:
javascriptclass BatteryModule {
  async initialize() {
    setInterval(async () => {
      const level = await navigator.getBattery();
      await this.state.set('system.battery', level.level);
    }, 60000); // Every minute
  }
}
4. UI Providers
Add visual elements to the interface:
javascriptclass StatusModule {
  getUI() {
    return {
      overlay: `
        <div class="status-indicator">
          <div class="recording-light"></div>
          <span>Listening...</span>
        </div>
      `,
      styles: `
        .status-indicator {
          position: fixed;
          top: 10px;
          right: 10px;
        }
      `
    };
  }
}
Testing Your Module
Required Test Structure
javascriptexport const tests = {
  unit: [
    {
      name: 'should handle empty input',
      fn: async () => {
        const module = new MyModule();
        const result = await module.process('');
        assert(result !== null);
      }
    }
  ],
  
  integration: [
    {
      name: 'should work with state manager',
      fn: async (state) => {
        const module = new MyModule(state);
        await module.initialize();
        // Test with real state
      }
    }
  ],
  
  coverage: 80 // Minimum percentage
};
Running Tests
bash# Test your module locally
npm test my-module.js

# Watch mode for development
npm test -- --watch my-module.js
Best Practices
1. Handle Errors Gracefully
javascriptasync doSomething(params) {
  try {
    const result = await this.riskyOperation();
    return { success: true, result };
  } catch (error) {
    // Don't crash the whole system
    console.error('MyModule error:', error);
    return { 
      success: false, 
      error: error.message,
      recovery: 'Try again or check settings'
    };
  }
}
2. Validate Input
javascriptasync processCommand({ text, options }) {
  // Validate required params
  if (!text) {
    throw new Error('Text parameter required');
  }
  
  // Validate types
  if (options && typeof options !== 'object') {
    throw new Error('Options must be an object');
  }
  
  // Process safely
  return this.doWork(text, options || {});
}
3. Performance Considerations
javascriptclass SearchModule {
  constructor() {
    // Cache expensive operations
    this.cache = new Map();
  }
  
  async search(query) {
    // Check cache first
    if (this.cache.has(query)) {
      return this.cache.get(query);
    }
    
    // Expensive operation
    const results = await this.performSearch(query);
    
    // Cache for 5 minutes
    this.cache.set(query, results);
    setTimeout(() => this.cache.delete(query), 300000);
    
    return results;
  }
}
4. Clean Up Resources
javascriptclass TimerModule {
  initialize() {
    this.timers = [];
    this.intervals = [];
  }
  
  setTimeout(fn, delay) {
    const id = setTimeout(fn, delay);
    this.timers.push(id);
    return id;
  }
  
  cleanup() {
    // Clear all timers
    this.timers.forEach(clearTimeout);
    this.intervals.forEach(clearInterval);
  }
}
Publishing Your Module
1. Validate Your Module
bash# Run the validator
npm run validate my-module.js

# Checks:
# - Manifest format
# - Test coverage
# - Size limits
# - Security patterns
2. Submit to Marketplace
bash# Submit for review
npm run submit my-module.js

# What happens:
# 1. Automated validation
# 2. Security scan
# 3. Community review
# 4. Published to marketplace
3. Module Metadata
Add rich metadata for the marketplace:
javascriptstatic manifest = {
  // ... required fields ...
  
  // Optional marketplace info
  author: 'Your Name',
  homepage: 'https://github.com/you/module',
  keywords: ['email', 'productivity'],
  screenshots: ['screenshot1.png', 'screenshot2.png'],
  
  // Helps users understand what your module does
  examples: [
    {
      command: 'Send email to John saying hello',
      description: 'Sends a simple email'
    }
  ]
};
Example Modules
Simple Module: Word Counter
javascriptexport default class WordCountModule {
  static manifest = {
    id: 'word-counter',
    name: 'Word Counter',
    version: '1.0.0',
    description: 'Counts words in your transcripts',
    permissions: [],
    dependencies: ['state-manager'],
    actions: ['countWords'],
    state: {
      reads: ['transcript.current'],
      writes: ['wordcount.latest']
    }
  };
  
  async countWords() {
    const transcript = await this.state.get('transcript.current');
    const count = transcript.split(/\s+/).length;
    
    await this.state.set('wordcount.latest', {
      count,
      timestamp: Date.now()
    });
    
    return { words: count };
  }
  
  getActions() {
    return { countWords: this.countWords.bind(this) };
  }
  
  getStateReads() { return WordCountModule.manifest.state.reads; }
  getStateWrites() { return WordCountModule.manifest.state.writes; }
}

export const tests = {
  unit: [{
    name: 'counts words correctly',
    fn: async () => {
      const module = new WordCountModule({
        get: async () => 'hello world test'
      });
      const result = await module.countWords();
      assert(result.words === 3);
    }
  }],
  coverage: 100
};
Getting Help

Documentation: https://voicebrain.ai/docs
Discord: https://discord.gg/voicebrain
Examples: https://github.com/voicebrain/modules
Module Ideas: https://github.com/voicebrain/ideas

Start Building!

Copy the template
Implement your idea
Test thoroughly
Share with the community

Remember: The best modules do one thing incredibly well. What will yours do?