## IMPORTANT: Development Workflow Rules
### Code Development Process
1. **Always use artifacts for code files** - Every code file should be created/updated as an artifact in the chat
2. **Update files completely** - When updating a file, include the ENTIRE file content, not just changes
3. **Maintain GitHub repo context** - All updates should reference the actual file paths in the GitHub repo
### Before Writing ANY Code:
1. Explain what needs to be done
2. Ask for confirmation on the approach
3. Propose the simplest solution first (command line tools, one-liners)
4. Only write code if explicitly approved
5. If multiple approaches exist, list them and let me choose
### Artifact Usage Guidelines:
- **For existing files**: Load the current content, modify it, and present the COMPLETE updated file
- **For new files**: Create as artifact with full content
- **For scripts**: Create PowerShell scripts that can update/create files in the repo
- **File paths**: Always use relative paths from the repo root
## Project Context
### Development Environment
- **Local Machine**: Dell Precision 5690 Windows 11
- **Shell**: PowerShell preferred for scripts
- **Testing**: Running module test cases + manual testing in chrome
### CRITICAL: Working Directory Context
- **You are IN the project**: When running scripts, you're already inside root
## PowerShell Script Guidelines
### CRITICAL: Avoid Common PowerShell Errors
#### 1. NO EMOJIS IN POWERSHELL SCRIPTS
- **NEVER use emoji characters** (❌, ✅, 🚀, 💡, etc.) in PowerShell scripts
- They cause string termination errors and encoding issues
- Use ASCII alternatives: [OK], [ERROR], [!], [*], etc.
- Or use plain text: "Success", "Error", "Warning", "Info"
#### 2. Quote Escaping Rules
- **Use here-strings (@' ... '@) for large code blocks**
  - No need to escape quotes inside
  - Preserves formatting exactly
  - Prevents syntax errors
- **For inline strings with quotes**:
  - Use double quotes outside, escape inner: `"He said `"Hello`""`
  - Or use single quotes when possible: `'Simple string'`
  - Never mix quote styles in the same string
#### 3. Brace Matching
- **Always verify all braces are closed**: `{` needs `}`
- Count opening and closing braces
- Use proper indentation to track nesting
- PowerShell is sensitive to unclosed blocks
#### 4. Script Validation Before Creating Artifacts
- **Test syntax locally first**: `powershell -File script.ps1 -WhatIf`
- Check for unmatched quotes
- Verify all brackets {} are properly closed
- Ensure here-strings are properly terminated with '@
### Example Script Structure:
```powershell
# GOOD: No emojis, proper quotes
Write-Host "[OK] Updated successfully!" -ForegroundColor Green
Write-Host "[ERROR] Failed to update" -ForegroundColor Red
# GOOD: Using here-string for code content
$content = @'
// JavaScript code with "quotes" and 'apostrophes'
const message = "This doesn't need escaping";
'@
# GOOD: Proper quote escaping for inline
Write-Host "Use -CommitMessage `"Your message`"" -ForegroundColor White
# BAD: Emojis cause parser errors
Write-Host "✅ Success!" -ForegroundColor Green  # NEVER DO THIS
# BAD: Mixed quotes causing errors
Write-Host '   .\script.ps1 -Message "Your message"' -ForegroundColor White
```
## Remember:
- **Every code change = new artifact**
- **Always include complete file content**
- **Test PowerShell syntax before creating artifacts**
- **Use here-strings for code blocks in scripts**