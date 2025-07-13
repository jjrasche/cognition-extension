# Architecture Decision Records

This document captures key architectural decisions for Voice Brain, including context, alternatives considered, and rationale.

## 1. Compilation Service Instead of Dynamic Loading

### Context
Chrome's Manifest V3 removes the ability to load code dynamically at runtime. We need a way to provide modularity despite this limitation.

### Options Considered
1. **Ship all modules** - Include every possible module in one extension
2. **Multiple extensions** - Each module as separate extension
3. **Compilation service** - Build custom extensions per user
4. **Native app** - Bypass browser limitations entirely

### Decision
**Compilation service** - Users select modules, we compile custom extension.

### Rationale
- True modularity - users only get code they need
- Single extension - better UX than managing multiple
- Stay in browser - no native app complexity
- Security - all code reviewed before compilation
- Updates - can still auto-update with custom manifest

### Consequences
- Need to maintain compilation infrastructure
- Slightly higher barrier to entry (download vs. one-click)
- Can't add modules without reinstalling extension

## 2. Single-File Module Architecture

### Context
Modules need to be self-contained, testable, and easy to understand.

### Options Considered
1. **Multi-file modules** - Traditional src/, tests/, docs/ structure
2. **Single file** - Everything in one JavaScript file
3. **Compiled bundles** - TypeScript/build step per module
4. **JSON + code** - Separate manifest from implementation

### Decision
**Single file** with embedded manifest, code, and tests.

### Rationale
- Simplicity - one file to review, share, version
- Transparency - see everything at once
- No build step - just JavaScript
- Enforces focus - can't sprawl across files
- Easy marketplace - display one file

### Consequences
- Larger single files
- Mixed concerns in one file
- Need good IDE support
- Template critical for consistency

## 3. 500-Line Module Guideline

### Context
Need to ensure modules remain focused and reviewable.

### Options Considered
1. **No limit** - Let complexity emerge
2. **Strict 500 limit** - Hard enforcement
3. **1000 lines** - More room for complexity
4. **Guideline** - Soft limit with exceptions

### Decision
**500-line guideline** - Strong recommendation, not hard limit.

### Rationale
- Forces single responsibility
- Reviewable in one sitting
- Encourages composition over complexity
- Allows exceptions for truly complex needs
- Community can police via ratings

### Consequences
- Some features need multiple modules
- Might see code golf/compression
- Need patterns for module composition
- Utility code duplication

## 4. State Management via Single Writer

### Context
Multiple modules need to share information without conflicts.

### Options Considered
1. **Free-for-all** - Any module writes anywhere
2. **Event sourcing** - Immutable event log
3. **Single writer** - Each state path has one owner
4. **CRDT** - Conflict-free replicated data
5. **Transactions** - ACID guarantees

### Decision
**Single writer pattern** - Each state path owned by one module.

### Rationale
- Prevents conflicts by design
- Simple to understand and implement
- Clear responsibility boundaries
- Easy debugging - know who wrote what
- No complex conflict resolution

### Consequences
- Modules must coordinate through LLM
- Some redundancy in state
- Need clear naming conventions
- Can't have true shared ownership

## 5. LLM as Primary Orchestrator

### Context
Modules need coordination for complex tasks.

### Options Considered
1. **Direct module communication** - Modules call each other
2. **Central orchestrator** - Dedicated coordination engine
3. **Workflow engine** - Visual/declarative workflows
4. **LLM orchestration** - AI decides what to call
5. **Hybrid** - LLM + workflow modules

### Decision
**LLM orchestration** with optional workflow modules for complex cases.

### Rationale
- Natural language control
- Flexible and adaptive
- No rigid programming needed
- Can handle unexpected combinations
- Workflows available for deterministic needs

### Consequences
- Latency for multi-step operations
- Non-deterministic behavior
- Context window limitations
- Need good error handling
- Costs for LLM calls

## 6. Browser Extension as Platform

### Context
Need to choose runtime environment for voice assistant.

### Options Considered
1. **Native desktop app** - Full system access
2. **Web app** - Simple deployment
3. **Browser extension** - Middle ground
4. **Mobile app** - Always with user
5. **Electron app** - Web tech + native

### Decision
**Browser extension** with Chrome as primary target.

### Rationale
- Runs where people work (browser)
- Good enough permissions
- Cross-platform via browser
- Built-in update mechanism
- Secure sandbox
- Can inject into any website

### Consequences
- Limited by browser APIs
- Must handle Manifest V3 restrictions
- Need cross-browser compatibility later
- Can't access native OS features
- Chrome-first development

## 7. Knowledge Graph in Neo4j

### Context
Need persistent storage for user's knowledge.

### Options Considered
1. **Local SQLite** - Simple, private
2. **IndexedDB** - Browser native
3. **PostgreSQL** - Traditional relational
4. **Neo4j** - Graph database
5. **Vector DB** - Embedding-based

### Decision
**Neo4j** for knowledge graph, browser storage for state.

### Rationale
- Natural for connected information
- Powerful Cypher query language
- Managed cloud option
- Good JavaScript drivers
- Visualizations built-in
- Scales with knowledge growth

### Consequences
- External dependency
- Network latency
- Need user accounts
- Privacy considerations
- Backup complexity

## 8. Declarative Module Interface

### Context
Modules need to describe their capabilities to the system.

### Options Considered
1. **Convention-based** - Follow naming patterns
2. **Decorators** - @action, @state annotations
3. **Inheritance** - Extend base classes
4. **Declarative** - Static manifest object
5. **Discovery** - Runtime introspection

### Decision
**Declarative manifest** with static property.

### Rationale
- Clear contract
- Static analysis possible
- No runtime surprises
- Easy documentation
- Simple validation
- Works with tree-shaking

### Consequences
- Verbose manifests
- Duplication with code
- Version management needed
- Must keep in sync with implementation

## 9. Context Assembly as Configuration

### Context
LLM needs relevant context without overwhelming token limits.

### Options Considered
1. **Hard-coded** - Fixed context rules
2. **AI-driven** - LLM decides what it needs
3. **User configuration** - JSON/UI defined
4. **Learned** - ML-based selection
5. **Module-defined** - Each module contributes

### Decision
**User configuration** with sensible defaults.

### Rationale
- User controls their AI's attention
- Predictable behavior
- Can optimize for use cases
- Easy to understand
- Can share configurations

### Consequences
- Learning curve for users
- Need good defaults
- Configuration complexity
- Token budget management
- Performance tuning needed

## 10. Test Requirements in Modules

### Context
Need to ensure module quality and reliability.

### Options Considered
1. **No requirements** - Trust developers
2. **External tests** - Separate test files
3. **Embedded tests** - In module file
4. **Type checking** - TypeScript/Flow
5. **Formal verification** - Prove correctness

### Decision
**Embedded tests** with coverage requirements.

### Rationale
- Can't ignore tests
- Travel with module
- Easy to verify
- Run before publishing
- Community sees test quality

### Consequences
- Larger module files
- Test framework needed
- Coverage tooling required
- May encourage minimal tests
- Performance impact of loading tests

## Future Decisions to Make

1. **Mobile support** - PWA vs native app vs responsive extension
2. **Monetization** - How do module developers get paid?
3. **Federation** - Multiple knowledge graphs?
4. **Privacy modes** - Local-only operation?
5. **AI model selection** - OpenAI vs Anthropic vs local?

Each decision will follow the same format: Context → Options → Decision → Rationale → Consequences.