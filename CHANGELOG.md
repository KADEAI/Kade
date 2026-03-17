# Changelog
All notable changes to this project will be documented in #this file.

### [2.3.0] - Current
### Fixed
- MONUMENTAL improvments and fixes have been made to the GUI, it is on another level now
- Numerous GUI issues that could be summarized as janky and buggy have been fixed.
- The terminal gui has been redesigned once again, now on Gen 5 terminal design.
- Huge improvements to the edit tool. Agents can now provide flat content in their edits and it will get auto structured, no need to include whitespace etc. This is also implemented in the write tool as well, but on a more minimal level. This also allows the edit tool to be roughly 10x more accurate as well with Old and New blocks & applying edits. We made that up, but nonetheless, "It just works" - Todd Howard

### Added
- Added the option to option to close bash, edit, and write gui tool blocks by default in the display settings (Where they're not auto expanded when called)

## Known Issues
- Currently the edit tool when set to native, isnt live streaming in the GUI block, this will be fixed in another update. Works just fine when tool protocol is set to Aero.

## [2.1.0]
### Fixed
- Fixed numerous bugs with json and aero tool schemas
- Fixed bugs with loading indicator and reasoning block

## Added
- Skills support. You can now install and enable skills. You can also directly install skills from skills.sh inside the kade marketplace tab as well
- Automations, you can now create automations to automate your workflow. Set times for prompts to trigger at etc.
- Added provider icons to config profiles that also show in the chat input box as well.

## [2.0.0]
### Fixed
Hundreds of bug fixes, too many to list in this changelog.

### Added & Changed
- Added effect to .md write tool gui blocks when writes are happening. (.md gui write blocks are different from other file write blocks)
- Added auto scroll to vs code editor tab when file write live streaming occurs.
- Removed Markdown, XML, and CLI tool schemas in favor of a heavily overhauled native json system, and a brand new tool schema called Aero, which is far more reliable then CLI and markdown. Aero allows AIs to call tools with a single letter. eg. R sample.txt /R
- Added support for Kiro Provider. Simply download and login to Kiro. If you're logged in, a token gets generated in a path similar to other CLI implentations.
Select your auth path for the token.json if its not already in the default one. The only supported model as of right now for Kiro is Sonnet 4.5. Works with both Trial and Pro accounts.
- Updated location for the config profile button in the chat input box. It is now located in a spot that makes a lot more sense.
- Terminal now hides output after completing a command providing a much more clean GUI experience
- Writes and Edits now save much faster and more reliably due to optimizations made to them.
- Numerous System prompt improvements.
-  MCPs not working has been fixed and supports native and aero almost perfectly now.
- Dead chats coming back to life 5 minutes after you send a message has been fixed.
-  Optimziations and bug fixes have been made to scrolling (virtuso is a pain to work with)
- todo list issues have been fixed (currently the todo list tool only works with Aero, support for native coming soon)
- Issues with the thinking and loading indicators have been fixed.

## Known Issues
# These will be fixed in a later update.
Currently LobeHub for MCP Search is not working, and will be fixed soon.
Lack of skills support.
Rare instances where tools dont get called and the stream drops.
Rare instances where tool call output can leak into the chat.
Rare instances of edit and write tool gui blocks duplicating endlessly upon completion. (can be resolved by going in and out of the chat)

## [1.85.0]
### Fixed
Last update broke Google CLI and Gemini OAuth sign in, which is now fixed.
Slight Gui fixes
Better result prompt for Edit Tool to distinguish that the earlier read result has been updated.

## [1.80.0]
### Fixed
- Numerous chat reliability issues that previously caused corruptions, dead scroll zones, and other conversation glitches
- Multiple visual glitches throughout the UI, including errant spacings and inconsistent panel layouts
- Issues in Google OAuth, covering token refresh edge cases and intermittent provider sign-in loops
- Fixed issues with Minimax Models having duplicate messages

### Changed
- Refined chat and panel margins for a more compact layout and improved readability
- Broad GUI polish pass covering buttons, tool blocks, and status toasts for a smoother overall feel
- General stability improvements across the extension
- Added free provider guide

## [1.75.0]
### Fixed
System prompt issues
Potential chat corruptions
Glob Tool fixes



## [1.70.0]
### Added
- **Atomic Turns**: Enforced strict turn boundaries in `MarkdownToolCallParser` and `CLIToolCallParser`. The model's turn now ends immediately after a tool call is finalized, mirroring native JSON function calling standards.
- **Context Poisoning Prevention**: Implemented automatic stripping of trailing text, hallucinations, and redundant "I'm done" messages after tool calls to maintain state integrity and clean context.
- **Hardened Tool Protocol**: Updated system prompts to align with the new deterministic execution model, forcing reasoning to occur before actions.

### Fixed
- Removed fragile tool end logic in favor of robust structural enforcement.
- Fixed syntax errors and corrupted lines in parser files to ensure 100% reliability.
- Eliminated "Double Confirm" UI friction caused by redundant post-tool text blocks.

---

## [1.60.0]

### Added
- **Disk-Based Task History Storage**: Moved task history from VS Code's globalState (SQLite) to disk-based JSON storage
  - Eliminates ~5MB extension state warning that appeared on every message update
  - Dramatically improves performance during task execution by using in-memory cache with debounced writes
  - Reduces I/O by 100x during streaming (50 rapid updates now = 1 disk write instead of 50 SQLite writes)
  - Automatic migration from globalState to disk on first run with seamless data preservation
  - Faster extension startup with direct JSON file loading instead of SQLite overhead

### Fixed
- **Performance**: Fixed severe lag during message streaming caused by repeated SQLite writes to globalState
  - Task history updates now use in-memory cache with 500ms debounced writes instead of immediate SQLite writes
  - Eliminated 500MB+ of unnecessary I/O during typical 50-message task execution
- **Visual GUI Issues**: Fixed chat scrolling jank and visual glitches during streaming
  - Removed competing scroll mechanisms that caused stuttering
  - Optimized animation transitions to prevent layout shifts
  - Improved rendering performance for long conversations
- **OAuth Refresh Issues**: Fixed authentication token refresh problems across multiple providers

### Changed
- Task history storage location moved from `globalState` to `globalStorageUri/task_history.json`
- Extension state size reduced from ~5MB to near-zero in VS Code's internal database
- Improved memory efficiency with single in-memory cache instead of repeated deserializations

---

## [1.50.0]
### Added
- **Sub-Agent System**: Introduced revolutionary sub-agent functionality that allows AI to delegate specialized tasks to dedicated agents with different capabilities and contexts
- **AI Chat Memory**: Implemented persistent model selection per chat - each conversation now remembers its selected AI model and maintains that choice across sessions
- **Multi-Model Concurrent Usage**: Users can now run multiple AI models simultaneously in different chat windows, enabling specialized workflows and comparisons
- **Smart Model Persistence**: Chat sessions automatically restore with their previously selected models, eliminating the need to reconfigure settings for ongoing conversations
- **Redesigned Terminal**: The inline terminal has been redesigned from the ground up, and offers a much more native & seamless experience of terminal commands compared to the awkward interface of the one before.

### Fixed
- **Critical Performance Fix for Large Codebases**: Fixed severe performance issues that made the extension unusable in large codebases (10,000+ files)
  - The @context menu now only processes file paths when actually open, preventing constant expensive array operations
  - MarkdownBlock file link processing limited to 1,000 files with intelligent change detection to avoid reprocessing unchanged file lists
  - WorkspaceTracker file watcher now completely skips when `maxWorkspaceFiles=0`, eliminating background CPU drain
  - Added 60-second cache for expensive ripgrep operations (getLineCounts, getDirectoryMetadata)
  - File scanning now properly respects user settings and skips when disabled
- Fixed duplicate edit/write tool blocks appearing in chat during streaming

### Changed
- Enhanced chat session management with model state preservation
- Improved multi-chat workflow support for power users
- Optimized memory usage for concurrent chat sessions
- Dramatically improved UI responsiveness in large codebases through React render optimization

---

## [1.30.0]
### Fixed
- Fixed numerous oauth provider issues; Antigravity 500 errors, Gemini CLI 429 rate limit errors that would appear after the first messaage, even on pro accounts. Pro acccounts should now be able to make the advertised 1500 requests per day. Lastly, OpenAI Codex reasoning block visual issues. 
- Fixed issues with hyperlinks displaying in chat.
- Fixed numerous issues with the grep tool.
- Fixed virtually every issue that was occuring with the grep tool when using the markdown tool protocol.
- Introduced final optimizations to smart context management system that updates read results on every turn to ensure AI never has stale context.
-
### Changed
- Enhanced read output format for all tools to ensure continuity across all results (grep, semgrep, etc.) `1 |` and `1: ` to `1→` helping the AI to better understand the context of the results.
- Changed the system result tag (when AI gets results from tool use) from [System :: Observation] to [STDOUT] to better distinguish user output from tool output. 
- Visual improvements to write and edit gui blocks while live streaming.
`

## [1.20.0]
 
### Added
- **Markdown Tool Protocol**: Introduced an entirely new tool protocol that allows AI to call tools using markdown syntax - the closest possible way for AI to call tools in natural language

- Enhanced read tool output format: Changed line number prefix from `1 |` to `1→` (Unicode right arrow) for improved readability
 
### Fixed
- Fixed laggy scrolling in long conversations by re-enabling Virtuoso virtual scrolling with optimized rendering
- Resolved performance issues with content-visibility CSS optimizations during streaming
- Fixed issues with todo tool
- FIxed visual issues with the MCP Hub

### Changed
- Increased performance and introduced numerous optimizations to the context management engine that updates read results on every turn.
- Optimized chat rendering with content-visibility and containment strategies for off-screen rows
- Improved ResizeObserver batching to reduce layout thrashing
 
---
 

## [1.16.0] 

### Fixed
- Fixed out-of-date prompt for unified schema
- Enhanced read tool with support for heads and tails reading (Exclusive to the Unified and markdown Tool Protocol)
- Added welcome notification sequence for new users
- Updated extension branding and marketplace information

### Changed
- Improved onboarding experience with step-by-step notifications
- Enhanced provider selection guidance
- Better unified tool protocol recommendations
- Updated extension display name to "Kade: AI Coding Agent"
- Refreshed logo and visual branding

## [1.10.0]

### Fixed
- Fixed AgentLoop tool counter reset issue between turns
- Resolved MCP server connection state persistence
- Fixed unified tools prompt batch mode detection
- Corrected streaming tool call length tracking
- Resolved McpHub client transport cleanup on disconnect
- Fixed sub-agent tool parameter validation
- Corrected tool protocol resolution for native providers
- Fixed UnifiedToolCallParser streaming buffer safety check
- Resolved chat content flash during fast streaming
- Fixed animation jank from competing scroll mechanisms

### Changed
- Improved chat scrolling performance during streaming
- Optimized animation transitions to reduce layout shifts
- Enhanced token usage tracking and context management

---

## [Previous Versions]

For previous version history, please refer to the git commit history.
