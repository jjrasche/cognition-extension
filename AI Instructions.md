## IMPORTANT: Development Workflow Rules

### Code Development Process
1. **Always use artifacts for ALL files** - Code, documentation, configs - everything should be created/updated as artifacts
2. **Update files completely** - When updating any file, include the ENTIRE file content, not just changes

### Before Writing ANY Code:
1. Explain what needs to be done
2. Ask for confirmation on the approach
3. Propose the simplest solution first
4. Only write code if explicitly approved
5. If multiple approaches exist, list them and let me choose

### Artifact Usage Guidelines:
- **For ALL file types**: Create/update as artifacts with full content
- **Complete files only**: Never show partial updates or diffs

## Project Context

### Development Environment
- **Local Machine**: Dell Precision 5690 Windows 11
- **Testing**: Running module test cases + manual testing in chrome

## Remember:
- **Every file change = new artifact**
- **Always include complete file content**

## Known Issues & Solutions:
1. **Service Workers**: No dynamic imports allowed - use static imports only
2. **Timing Issues**: globalState needs ~2-3 seconds to initialize after reload
3. **OAuth Flows**: Watch for concurrent auth attempts and state mismatches
4. **Dev Helpers**: Must wait for initialization before they're available
5. **Global Exports**: Must happen AFTER state creation inside initializeExtension()

## Debugging Tips:
- Always check the service worker console, not popup/page console
- Use `debugInit()` to diagnose initialization issues  
- `listActions()` should show all module actions if properly registered
- OAuth errors often involve multiple listeners or concurrent flows