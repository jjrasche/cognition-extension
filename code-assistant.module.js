export const manifest = {
  name: "code-assistant",
  context: ["extension-page"],
  version: "1.0.0",
  description: "AI-powered code generation and debugging with context-aware LLM integration",
  dependencies: ["file-system", "inference", "layout", "training-collector"],
  actions: ["debugMode", "buildMode", "applyChanges", "rateIteration"],
  uiComponents: [
    { name: "code-diff-viewer", getTree: "buildDiffViewer" },
    { name: "context-panel", getTree: "buildContextPanel" }
  ]
};

let runtime, log, currentContext = null, currentChanges = null, currentIteration = null;

export const initialize = async (rt, l) => { runtime = rt; log = l; };

// === CORE CONTEXT ASSEMBLY ===
const getCoreContext = () => ({
  systemArchitecture: getSystemArchitecture(),
  moduleBuildPatterns: getModuleBuildPatterns(),
  runtimeCallExamples: getRuntimeCallExamples(),
  manifestSchema: getManifestSchema(),
  moduleSummary: getModuleSummary()
});
const getSystemArchitecture = () => ({
  contexts: {
    "service-worker": "Main context - background tasks, API calls, no UI access",
    "extension-page": "UI context - components, user interaction, DOM access", 
    "offscreen": "Heavy compute - ML models, embeddings, isolated processing"
  },
  communication: {
    pattern: "runtime.call(action, ...args)",
    routing: "Auto-routes across contexts via Chrome message passing",
    actions: "Format: 'moduleName.actionName'",
    waiting: "Modules wait for dependencies during initialization"
  },
  storage: {
    "chrome-local": "Local device storage - fast, not synced",
    "chrome-sync": "Synced across devices - smaller limits",
    "indexed-db": "Large data storage with queries"
  },
  errorHandling: {
    moduleFailure: "Modules marked 'failed', others continue",
    crossContext: "Automatic retry with timeout handling",
    gracefulDegradation: "Extension remains functional with partial failures"
  }
});
const getModuleBuildPatterns = () => ({
  manifest: {
    required: ["name", "version", "description"],
    optional: ["context", "dependencies", "actions", "uiComponents", "config"],
    context: "Array of contexts where module runs",
    dependencies: "Other modules this one requires"
  },
  initialization: {
    pattern: "export const initialize = async (runtime, log) => { ... }",
    order: "Dependencies initialized first",
    state: "Runtime tracks module states: loading → ready/failed"
  },
  actions: {
    export: "export const actionName = async (params) => { ... }",
    registration: "Automatic from manifest.actions array",
    calling: "await runtime.call('moduleName.actionName', params)"
  },
  testing: {
    pattern: "export const test = async () => [testResults]",
    utilities: "runtime.testUtils provides assertions",
    structure: "Array of {name, actual, assert, expected, passed}"
  },
  uiComponents: {
    pattern: "Tree structures transformed by tree-to-dom",
    events: "{ events: { click: 'moduleName.actionName' } }",
    state: "Component state managed by modules"
  }
});
const getRuntimeCallExamples = () => [
  {
    purpose: "Cross-context communication",
    example: "await runtime.call('groq-inference.makeRequest', model, messages)",
    note: "Auto-routes from extension-page to service-worker"
  },
  {
    purpose: "Storage operations", 
    example: "await runtime.call('chrome-sync.set', { key: value })",
    note: "Consistent API across storage types"
  },
  {
    purpose: "UI updates",
    example: "await runtime.call('layout.renderComponent', 'componentName')",
    note: "Only works in extension-page context"
  },
  {
    purpose: "File operations",
    example: "await runtime.call('file.write', { dir: 'Documents', filename: 'test.txt', data: content })",
    note: "Requires user permission grants"
  },
  {
    purpose: "Error handling",
    example: "try { await runtime.call('action') } catch (e) { log.error('Failed:', e) }",
    note: "Always wrap cross-context calls in try-catch"
  }
];
const getManifestSchema = () => ({
  type: "object",
  required: ["name", "version", "description"],
  properties: {
    name: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
    context: { 
      type: "array", 
      items: { enum: ["service-worker", "extension-page", "offscreen"] },
      description: "Contexts where module runs - omit for all contexts"
    },
    version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
    description: { type: "string", minLength: 10 },
    dependencies: { 
      type: "array", 
      items: { type: "string" },
      description: "Other module names this depends on"
    },
    actions: {
      type: "array",
      items: { type: "string" },
      description: "Function names to expose as actions"
    },
    uiComponents: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "getTree"],
        properties: {
          name: { type: "string" },
          getTree: { type: "string", description: "Function name that returns UI tree" },
          zLayer: { enum: ["SYSTEM", "PINNED", "ACTIVE", "NORMAL"] }
        }
      }
    },
    config: {
      type: "object",
      patternProperties: {
        ".*": {
          type: "object",
          required: ["type", "value"],
          properties: {
            type: { enum: ["string", "number", "boolean", "select", "globalKey"] },
            value: {},
            label: { type: "string" },
            description: { type: "string" }
          }
        }
      }
    }
  }
});
const getModuleSummary = () => {
  if (!runtime) return {};
  
  return runtime.getContextModules().reduce((summary, module) => {
    summary[module.manifest.name] = {
      purpose: module.manifest.description,
      context: module.manifest.context || ["all"],
      dependencies: module.manifest.dependencies || [],
      actions: module.manifest.actions?.length || 0,
      hasUI: !!(module.manifest.uiComponents?.length),
      hasConfig: !!(module.manifest.config && Object.keys(module.manifest.config).length),
      hasTests: typeof module.test === 'function'
    };
    return summary;
  }, {});
};
// Parses extension-specific error logs to extract file paths: chrome-extension://, webpack bundles, source maps, cross-context errors
const extractFilesFromStackTrace = (errorLogs) => [];

// Interactive requirements gathering - converts user input into structured requirements AND suggests relevant modules for context
const gatherRequirements = async (userInput) => ({});

// LLM-powered context selection: analyzes requirements to determine which existing modules to include as examples
const selectRelevantModules = async (requirements) => [];

// === MODE HANDLERS ===
// Debug mode: takes error logs, extracts stack trace files, assembles debug-focused context, generates minimal fixes
export const debugMode = async (errorLogs) => ({});

// Build mode: takes requirements, gathers target context with LLM-selected examples, generates new code implementations
export const buildMode = async (requirements) => ({});

// === LLM INTEGRATION ===

const generateChanges = async (context, mode) => {
    const prompt = assemblePrompt(context, mode);
    const schema = getResponseSchema(mode);
    
    try {
        const llmResponse = await runtime.call('inference.prompt', { 
            query: prompt,
            systemPrompt: getSystemPrompt(mode),
            responseFormat: {
                type: "json_schema",
                json_schema: {
                    name: `${mode}_fix_response`,
                    strict: true,
                    schema: schema
                }
            }
        });
        
        // Groq guarantees valid JSON matching schema, just parse it
        const parsed = JSON.parse(llmResponse);
        return parsed;
        
    } catch (error) {
        log.error('LLM call failed:', error);
        return { changes: [], reasoning: `Failed to generate changes: ${error.message}` };
    }
};

const getResponseSchema = (mode) => {
    if (mode === 'debug') {
        return {
            type: "object",
            properties: {
                changes: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            filePath: { type: "string" },
                            functionName: { type: "string" },
                            newCode: { type: "string" }
                        },
                        required: ["filePath", "functionName", "newCode"],
                        additionalProperties: false
                    }
                },
                reasoning: { type: "string" }
            },
            required: ["changes", "reasoning"],
            additionalProperties: false
        };
    }
    
    // Build mode schema
    return {
        type: "object",
        properties: {
            changes: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        filePath: { type: "string" },
                        functionName: { type: "string" },
                        newCode: { type: "string" }
                    },
                    required: ["filePath", "functionName", "newCode"],
                    additionalProperties: false
                }
            },
            reasoning: { type: "string" },
            testCases: {
                type: "array",
                items: { type: "string" }
            }
        },
        required: ["changes", "reasoning"],
        additionalProperties: false
    };
};

const assembleDebugPrompt = (context) => {
    const { error, files, coreContext } = context;
    
    // Simplified - no need for JSON format instructions
    return `# DEBUG MODE: Fix Runtime Error

## Error Log
\`\`\`
${error}
\`\`\`

## File Content
${Object.entries(files).map(([path, content]) => `
### ${path}
\`\`\`javascript
${content}
\`\`\`
`).join('\n')}

## System Architecture Context
${JSON.stringify(coreContext.systemArchitecture, null, 2)}

## Common Patterns
${JSON.stringify(coreContext.moduleBuildPatterns, null, 2)}

## Runtime Call Examples
${JSON.stringify(coreContext.runtimeCallExamples, null, 2)}

## Instructions
1. Identify the root cause of the error
2. Generate a MINIMAL fix (change only what's necessary)
3. Use safe references from class instance (this.property) instead of global references
4. Preserve all existing logic and structure
5. Return complete replacement function code with proper formatting`;
};

const assemblePrompt = (context, mode) => {
    if (mode === 'debug') {
        return assembleDebugPrompt(context);
    }
    return assembleBuildPrompt(context);
};

const assembleBuildPrompt = (context) => {
    // TODO: Implement for build mode
    return `Build mode not yet implemented`;
};

const getSystemPrompt = (mode) => {
    if (mode === 'debug') {
        return `You are a debugging assistant for a Chrome extension with a modular architecture. 

Your goal: Generate MINIMAL fixes that resolve errors while preserving existing code structure.

Rules:
- Change ONLY the code necessary to fix the error
- Use instance properties (this.contextModules) not global variables (modules)
- Preserve all existing function logic and structure
- Return complete function replacement code
- Response must be valid JSON only`;
    }
    
    return `You are a code generation assistant for a Chrome extension with a modular architecture.

Your goal: Generate complete, working implementations following established patterns.

Rules:
- Follow the manifest schema exactly
- Use runtime.call() for cross-module communication
- Include proper error handling
- Write complete, production-ready code
- Return valid JSON only`;
};

const parseStructuredResponse = (response, mode, context) => {
    try {
        // Strip markdown code blocks if present
        let cleaned = response.trim();
        cleaned = cleaned.replace(/^```json\n?/i, '').replace(/\n?```$/, '');
        
        const parsed = JSON.parse(cleaned);
        
        // Validate structure
        if (!parsed.changes || !Array.isArray(parsed.changes)) {
            throw new Error('Invalid response: missing changes array');
        }
        
        if (!parsed.reasoning || typeof parsed.reasoning !== 'string') {
            throw new Error('Invalid response: missing reasoning');
        }
        
        // Mode-specific validation
        if (mode === 'debug') {
            validateDebugResponse(parsed, context);
        }
        
        return {
            changes: parsed.changes,
            reasoning: parsed.reasoning,
            testCases: parsed.testCases || []
        };
    } catch (error) {
        log.error('Failed to parse LLM response:', { error, response });
        return {
            changes: [],
            reasoning: `Parse error: ${error.message}`,
            testCases: []
        };
    }
};

const validateDebugResponse = (parsed, context) => {
    // Debug mode should produce minimal changes
    if (parsed.changes.length > 3) {
        log.warn('Debug mode produced more than 3 changes - should be minimal');
    }
    
    // Each change should target a specific file/function
    parsed.changes.forEach(change => {
        if (!change.filePath || !change.functionName || !change.newCode) {
            throw new Error('Change missing required fields: filePath, functionName, newCode');
        }
        
        // Verify it's targeting a file in the context
        if (context.files && !context.files[change.filePath]) {
            log.warn(`Change targets file not in context: ${change.filePath}`);
        }
    });
};

// === FILE OPERATIONS ===
// Maps chrome-extension:// URLs and webpack bundle references back to actual source file paths
const mapExtensionPathsToSource = (extensionPaths) => [];

// Loads full file content for files identified by stack trace or requirements analysis
const loadContextFiles = async (filePaths) => ({});

// Applies generated changes to filesystem after user approval, handles rollback on failure
export const applyChanges = async (changes, userApproval = true) => true;

// Applies individual file change - handles both function replacement and new file creation with boundary detection
const applyFileChange = async (change) => ({});

// Replaces specific function in existing file using simple boundary detection (no AST needed)
const replaceFunctionInFile = async (filePath, functionName, newImplementation) => ({});

// === TRAINING INTEGRATION ===
// Records user rating and feedback for current iteration, includes any manual modifications made in diff viewer
export const rateIteration = async (rating, feedback, userModifications = null) => ({});

// Creates training record with context, LLM output, user modifications, and metadata for ML pipeline
const createIteration = (context, changes, mode) => ({});

// === UI COMPONENTS ===
// Renders split-pane diff viewer showing before/after code with syntax highlighting and edit capability
export const buildDiffViewer = () => ({});

// Renders collapsible context panel showing what context was sent to LLM, organized by mode
export const buildContextPanel = () => ({});

// Helper for building expandable context sections with toggle functionality and mode-specific styling
const buildContextSection = (title, content, isExpanded, mode) => ({});

// === EVENT HANDLERS ===
// Toggles expansion state of context panel sections
export const toggleContextSection = async (eventData) => ({});

// Handles user modifications in diff viewer - tracks changes for training pipeline
export const handleDiffModification = async (eventData) => ({});

// === RED-GREEN TEST CYCLE ===
export const test = async () => {
  const { runUnitTest, deepEqual } = runtime.testUtils;
  return [
    // await runUnitTest("LLM Architecture Comprehension", async () => {
    //     const results = await testArchitectureComprehension();    
	// 	return { actual: results.filter(r => r.passed).length, assert: greaterThanOrEqual, expected: (results.length - 1) };
    // }),
    // // Stack Trace Extraction Tests - Extension Specific
    // await runUnitTest("Stack trace extraction handles chrome-extension:// URLs correctly", async () => true),
    // await runUnitTest("Stack trace extraction handles webpack bundle references", async () => true),
    // await runUnitTest("Stack trace extraction handles source map redirects", async () => true),
    // await runUnitTest("Stack trace extraction handles cross-context errors (service-worker → extension-page)", async () => true),
    // await runUnitTest("Stack trace extraction handles missing files gracefully", async () => true),
    // await runUnitTest("Extension path mapping converts chrome-extension URLs to source paths", async () => true),
    
    // // Context Assembly Tests
    // await runUnitTest("Core context includes architecture, patterns, examples, and module summary", async () => true),
    // await runUnitTest("Debug context focuses on error context and minimal fixes", async () => true),
    // await runUnitTest("Build context focuses on example modules and complete implementations", async () => true),
    // await runUnitTest("Requirements gathering suggests relevant existing modules for context", async () => true),
    // await runUnitTest("LLM-powered module selection returns contextually relevant examples", async () => true),
    
    // // Mode Distinction Tests
    // await runUnitTest("Debug mode system prompt focuses on minimal fixes and error resolution", async () => true),
    // await runUnitTest("Build mode system prompt focuses on complete implementations and best practices", async () => true),
    // await runUnitTest("Debug mode validation expects minimal, targeted changes", async () => true),
    // await runUnitTest("Build mode validation expects complete, functional implementations", async () => true),
    // await runUnitTest("Mode-specific response parsing applies different validation rules", async () => true),
    
    // code-assistant.module.js - Add to test suite

await runUnitTest("Debug mode generates valid fix for real runtime error", async () => {
    // ARRANGE: Real file content + realistic error
    const runtimeFileContent = `
export class Runtime {
    constructor(runtimeName) {
        this.runtimeName = runtimeName;
        this.actions = new Map();
        this.contextModules = [];
    }
    
    loadModulesForContext = async () => {
        this.contextModules = modules.filter(m => 
            m.manifest.context && m.manifest.context.includes(this.runtimeName)
        );
    }
    
    initialize = async () => {
        await this.loadModulesForContext();
        this.registerActions();
        await this.initializeModules(modules.map(m => m.manifest.name)); 
    }
}`;

    const errorLog = `TypeError: Cannot read properties of undefined (reading 'map')
    at Runtime.initialize (chrome-extension://abc123/runtime.js:15:52)
    at initializeRuntime (chrome-extension://abc123/runtime.js:234:23)`;

    // Build full context like production would
    const context = {
        mode: 'debug',
        error: errorLog,
        files: {
            'runtime.js': runtimeFileContent
        },
        coreContext: getCoreContext()
    };

    // ACT: Real LLM call with actual inference
    const result = await generateChanges(context, 'debug');

    // ASSERT: Validate the fix would actually work
    const actual = {
        // Structure validation
        hasChanges: result.changes.length > 0,
        hasReasoning: result.reasoning.length > 50,
        isMinimalFix: result.changes.length === 1,
        
        // Content validation
        targetsCorrectFile: result.changes[0].filePath === 'runtime.js',
        targetsCorrectFunction: result.changes[0].functionName === 'initialize',
        
        // Fix quality validation
        usesSafeReference: result.changes[0].newCode.includes('this.contextModules'),
        avoidsUnsafeReference: !result.changes[0].newCode.includes('modules.map'),
        preservesLogic: result.changes[0].newCode.includes('initializeModules'),
        
        // Reasoning validation
        identifiesRootCause: result.reasoning.toLowerCase().includes('undefined') && 
                            result.reasoning.toLowerCase().includes('modules'),
        explainsCorrection: result.reasoning.toLowerCase().includes('contextModules')
    };

    const expected = {
        hasChanges: true,
        hasReasoning: true,
        isMinimalFix: true,
        targetsCorrectFile: true,
        targetsCorrectFunction: true,
        usesSafeReference: true,
        avoidsUnsafeReference: true,
        preservesLogic: true,
        identifiesRootCause: true,
        explainsCorrection: true
    };

    return { actual, assert: deepEqual, expected };
})
    // // LLM Integration Tests - Single Calls
    // await runUnitTest("Debug mode LLM call returns valid function-level fixes", async () => true),
    // await runUnitTest("Build mode LLM call returns valid function-level implementations", async () => true),
    // await runUnitTest("LLM response parsing handles malformed JSON without crashing", async () => true),
    // await runUnitTest("Prompt assembly creates structured prompt with mode-specific context sections", async () => true),
    
    // // LLM Consistency Tests - Multiple Calls  
    // await runUnitTest("Same debug context produces consistent LLM responses (5 calls)", async () => true),
    // await runUnitTest("Same build context produces consistent LLM responses (5 calls)", async () => true),
    // await runUnitTest("Different error logs produce different debug responses (3 calls)", async () => true),
    // await runUnitTest("Different requirements produce different build responses (3 calls)", async () => true),
    
    // // File Operations Tests
    // await runUnitTest("File loading handles missing files gracefully", async () => true),
    // await runUnitTest("Function replacement preserves file structure and formatting", async () => true),
    // await runUnitTest("Function boundary detection works with various coding styles", async () => true),
    // await runUnitTest("Multiple changes are applied in dependency order", async () => true),
    
    // // Training Pipeline Tests
    // await runUnitTest("Iteration records include context + output + mode + metadata", async () => true),
    // await runUnitTest("User modifications in diff viewer are captured for training", async () => true),
    // await runUnitTest("Training data includes mode-specific validation results", async () => true),
    // await runUnitTest("Multiple iterations create separate training records with progression tracking", async () => true)
  ];
};

const testArchitectureComprehension = async () => {
	return await Promise.all([
		{ concept: "cross-context-communication", question: "How do modules communicate across different contexts (service-worker, extension-page, offscreen)?", options: ["A: Direct function calls", "B: runtime.call() with action routing", "C: Chrome message passing directly", "D: Shared global variables"], correct: "B", },
		{ concept: "module-design-patterns", question: "When should you create a NEW module vs extending an existing one?", options: ["A: Always create new modules", "B: For distinct features with own state/actions", "C: Only when file gets too large", "D: Never create new modules"], correct: "B", },
		{ concept: "context-restrictions", question: "Which context can render UI components?",  options: ["A: service-worker only", "B: extension-page only", "C: offscreen only", "D: Any context"], correct: "B", },
		{ concept: "action-routing", question: "What happens when runtime.call() targets an action in a different context?", options: ["A: Throws an error immediately", "B: Auto-routes via message passing", "C: Times out silently", "D: Falls back to local execution"], correct: "B",  },
		{ concept: "dependency-management", question: "How are module dependencies handled during initialization?", options: ["A: Parallel initialization", "B: Dependency order with waiting", "C: Manual dependency management", "D: Random initialization order"], correct: "B", },
		{ concept: "storage-architecture", question: "What's the difference between chrome-local and chrome-sync modules?", options: ["A: No difference, same API", "B: Local is faster, sync persists across devices", "C: Local is temporary, sync is permanent", "D: Local is for settings, sync for data"], correct: "B", },
		{ concept: "ui-architecture", question: "How should UI components be structured in this architecture?", options: ["A: Direct DOM manipulation", "B: Tree structures transformed by tree-to-dom", "C: React components only", "D: HTML templates"], correct: "B",  },
		{ concept: "error-resilience", question: "What happens if a module fails to initialize?", options: ["A: Entire extension crashes", "B: Module marked as 'failed', others continue", "C: Automatic retry until success", "D: Silent failure"], correct: "B", }
	].map(async q => questionLLM(q)));
};
const questionLLM = async (q) => {
    try {
        const prompt = `Given this system architecture context:\n${JSON.stringify(getCoreContext(), null, 2)}\nAnswer this multiple choice question:\n${q.question}\n${q.options.join('\n')}.\nRespond with ONLY the letter (A, B, C, or D) of the correct answer.`;
        const llmAnswer = (await runtime.call('inference.prompt', { query: prompt })).trim().toUpperCase()
        const isCorrect = llmAnswer === q.correct;
        return{ concept: q.concept, question: q.question, correctAnswer: q.correct, llmAnswer: llmAnswer, passed: isCorrect, explanation: isCorrect ? "✅ Correct" : `❌ Expected ${q.correct}, got ${llmAnswer}` };
    } catch (error) { return { concept: q.concept,  passed: false, error: error.message }; }
}
