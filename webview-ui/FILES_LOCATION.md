# KiloCode Webview UI - Files Location Guide

This document outlines the location of all major UI components and logic in the webview-ui directory.

## Main Application Structure

### Core App Files
- **`src/App.tsx`** - Main application component with routing logic and tab management
  - Line 81: `App()` component definition
  - Line 104: `tab` state management
  - Line 132: `switchTab()` navigation function
  - Line 325: Welcome view conditional rendering
  - Line 333: History view rendering
- **`src/index.tsx`** - Application entry point and React root rendering
  - Line 14: React root creation and App rendering
- **`src/index.css`** - Global styles and CSS variables

## Main Pages/Views

### Home Page (Setup Only)
- **`src/components/kilocode/welcome/WelcomeView.tsx`** - Welcome/setup page for initial configuration
  - Line 13: `WelcomeView()` component definition
  - Line 44: `handleSubmit()` configuration save function
  - Line 63: Main render logic with conditional manual config
  - **NOTE**: This is only shown during initial setup, NOT the main home page

### Actual "Home Page" (Main Interface)
- **`src/components/chat/ChatView.tsx`** - This IS the home page/main interface
  - When `showWelcome = false` in App.tsx, ChatView becomes the main interface
  - Line 325-326 in App.tsx: Conditional rendering logic
  - **There is no separate home page component - ChatView IS the home page**

### Chat Interface
- **`src/components/chat/ChatView.tsx`** - Main chat interface and message display
  - Line 1: Component definition and imports
  - Main chat container and message handling
- **`src/components/chat/ChatTextArea.tsx`** - Chat input area and message composition
  - Line 2075: Current cursor location (input handling area)
  - Message input and submission logic
- **`src/components/chat/ChatRow.tsx`** - Individual chat message row component
  - User and assistant message rendering
- **`src/components/chat/ChatTimestamps.tsx`** - Message timestamp display
  - Timestamp formatting and display logic

### Chat History
- **`src/components/history/HistoryView.tsx`** - Chat history page with search and filtering
  - Line 31: `HistoryView()` component definition
  - Line 94: Main render structure
  - Line 251: Virtuoso list for history items
- **`src/components/history/TaskItem.tsx`** - Individual task/conversation item in history
  - Task item rendering and interaction
- **`src/components/history/useTaskSearch.ts`** - Hook for searching and filtering history
  - Search logic and state management

### Settings
- **`src/components/settings/SettingsView.tsx`** - Main settings page
  - Settings container and tab management
- **`src/components/settings/ApiOptions.tsx`** - API configuration options
  - API provider selection and configuration
- **`src/components/settings/AutoApproveSettings.tsx`** - Auto-approval settings
  - Auto-approval toggle and configuration
- **`src/components/settings/FastApplySettings.tsx`** - Fast apply settings
  - Fast apply feature configuration

### Profile & Authentication
- **`src/components/kilocode/profile/ProfileView.tsx`** - User profile page
  - Profile management and display
- **`src/components/kilocode/auth/AuthView.tsx`** - Authentication page
  - Login and authentication flow
- **`src/components/kilocode/common/KiloCodeAuth.tsx`** - KiloCode authentication component
  - KiloCode-specific authentication logic

### Marketplace
- **`src/components/marketplace/MarketplaceView.tsx`** - Marketplace/prompts page
  - Marketplace interface and prompt browsing
- **`src/components/marketplace/MarketplaceViewStateManager.ts`** - Marketplace state management
  - State management for marketplace features

### MCP (Model Context Protocol)
- **`src/components/mcp/McpView.tsx`** - MCP configuration page
  - MCP server configuration and management

## Message Components

### User & Assistant Messages
- **`src/components/chat/ChatRow.tsx`** - Contains both user and assistant message rendering
  - Message display logic and styling
- **`src/components/chat/kilocode/FastApplyChatDisplay.tsx`** - KiloCode-specific chat display
  - Enhanced chat display for KiloCode features

### Message Management
- **`src/components/chat/MessageModificationConfirmationDialog.tsx`** - Edit/delete message dialogs
  - Message edit and delete confirmation dialogs
- **`src/components/chat/CheckpointRestoreDialog.tsx`** - Checkpoint restore functionality
  - Checkpoint restoration interface

## UI Components Library

### Base Components
- **`src/components/ui/index.ts`** - Main UI components export
  - Component exports and re-exports
- **`src/components/ui/`** directory contains:
  - Button, ButtonPrimary, ButtonLink - Interactive elements
  - Input, TextField, Select - Form inputs
  - Dialog, Modal, Popover - Overlay components
  - Tooltip, Badge, Avatar - Display components
  - Checkbox, Radio, Switch - Selection components
  - Card, Container, Divider - Layout components

### Common Components
- **`src/components/common/Tab.tsx`** - Tab container and content
  - Tab layout and content structure
- **`src/components/common/ButtonPrimary.tsx`** - Primary button component
  - Primary button styling and behavior
- **`src/components/common/ButtonLink.tsx`** - Link button component
  - Link-style button component

## KiloCode Specific Components

### Chat Enhancements
- **`src/components/kilocode/chat/KiloChatRowGutterBar.tsx`** - Chat row gutter with actions
  - Chat action buttons and controls
- **`src/components/kilocode/agent-manager/`** - Agent management components
  - `AgentManagerApp.tsx` - Main agent manager interface
  - Agent configuration and management UI
- **`src/components/kilocode/group-chat/`** - Group chat functionality
  - `GroupChatApp.tsx` - Group chat interface
  - Multi-user chat features

### Bottom Controls
- **`src/components/kilocode/BottomControls.tsx`** - Bottom navigation/control bar
  - Navigation buttons and bottom controls

### Memory & Features
- **`src/kilocode/MemoryWarningBanner.tsx`** - Memory usage warning banner
  - Memory usage display and warnings
- **`src/services/MemoryService.ts`** - Memory management service
  - Memory service implementation and management

## State Management & Context

### Context Providers
- **`src/context/ExtensionStateContext.tsx`** - Main extension state context
  - Global state management and context provider
- **`src/i18n/TranslationContext.tsx`** - Internationalization context
  - Translation and i18n context provider

### Hooks
- **`src/components/ui/hooks/`** - UI-specific hooks
  - `index.ts` - UI hook exports
  - Custom UI logic hooks
- **`src/components/chat/hooks/`** - Chat-specific hooks
  - `useChatGhostText.ts` - Ghost text functionality
  - Chat-related state management hooks
- **`src/hooks/`** - General application hooks
  - Application-wide custom hooks

## Utilities & Services

### Communication
- **`src/utils/vscode.ts`** - VSCode extension communication
  - VSCode API communication layer
- **`src/utils/TelemetryClient.ts`** - Telemetry and analytics
  - Telemetry data collection and reporting

### Styling & Theming
- **`src/utils/highlighter.ts`** - Code syntax highlighting
  - Shiki highlighter initialization and configuration
- **`src/codicon-custom.css`** - Custom VSCode icon styles
  - Custom icon styles and overrides

### Internationalization
- **`src/i18n/locales/`** - Translation files for all supported languages
  - `en/chat.json` - English chat translations
  - `en/` and other language folders - Complete translations
  - Supports: ar, ca, cs, de, es, fr, hi, id, it, ja, ko, nl, pl, pt-BR, ru, th, tr, uk, vi, zh-CN, zh-TW

## Tools & Features

### Tool Components (ALL TOOLS)
- **`src/components/chat/tools/ReadTool.tsx`** - File reading tool interface
  - File content display and reading functionality
- **`src/components/chat/tools/WriteTool.tsx`** - File writing tool interface
  - File editing and writing functionality
- **`src/components/chat/tools/EditTool.tsx`** - File editing tool interface
  - File modification and editing interface
- **`src/components/chat/tools/WebSearchTool.tsx`** - Web search tool interface
  - Web search results display and interaction
- **`src/components/chat/tools/WebFetchTool.tsx`** - Web fetch tool interface
  - Web content fetching and display
- **`src/components/chat/tools/ToolMessageWrapper.tsx`** - Tool message container
  - Wrapper for all tool execution displays
- **`src/components/chat/tools/ToolError.tsx`** - Tool error display
  - Error handling and display for tools
- **`src/components/chat/tools/ToolStatusIndicator.tsx`** - Tool status indicator
  - Visual status indicators for tool execution
- **`src/components/chat/tools/ToolFilePath.tsx`** - Tool file path display
  - File path display for tool operations
- **`src/components/chat/tools/FileIcon.tsx`** - File icon display
  - File type icons for tool interfaces
- **`src/components/common/ToolUseBlock.tsx`** - Generic tool use block
  - Common tool execution display component
- **`src/components/chat/UpdateTodoListToolBlock.tsx`** - Todo list update tool
  - Todo list management tool interface

### Search & Code Analysis Tools
- **`src/components/chat/CodebaseSearchResult.tsx`** - Codebase search result display
  - Individual search result display
- **`src/components/chat/CodebaseSearchResultsDisplay.tsx`** - Codebase search results container
  - Multiple search results display interface
- **`src/components/ui/searchable-select.tsx`** - Searchable select component
  - Dropdown with search functionality

### Browser Session Tools
- **`src/components/browser-session/BrowserSessionPanel.tsx`** - Browser session interface
  - Web browser session management
- **`src/components/browser-session/BrowserPanelStateProvider.tsx`** - Browser session state
  - Browser session state management
- **`src/components/chat/BrowserActionRow.tsx`** - Browser action display
  - Browser action results display
- **`src/components/chat/BrowserSessionRow.tsx`** - Browser session row
  - Browser session item display
- **`src/components/chat/BrowserSessionStatusRow.tsx`** - Browser session status
  - Browser session status indicator

### MCP (Model Context Protocol) Tools
- **`src/components/mcp/McpToolRow.tsx`** - MCP tool display
  - MCP tool execution interface
- **`src/components/mcp/McpView.tsx`** - MCP configuration page
  - MCP server configuration and management

### Command & Execution Tools
- **`src/components/chat/CommandExecution.tsx`** - Command execution display
  - Command execution results display
- **`src/components/chat/CommandExecutionError.tsx`** - Command error display
  - Command execution error handling
- **`src/components/chat/CommandPatternSelector.tsx`** - Command pattern selector
  - Command pattern selection interface
- **`src/components/chat/McpExecution.tsx`** - MCP execution display
  - MCP tool execution results

### Code Indexing & Management
- **`src/components/chat/CodeIndexPopover.tsx`** - Code indexing popup interface
  - Indexing controls and status display
- **`src/components/chat/IndexingStatusBadge.tsx`** - Indexing status indicator
  - Visual indexing progress and status badges
- **`src/components/chat/kilocode/ManagedCodeIndexPopover.tsx`** - Managed code indexing interface
  - KiloCode-specific indexing controls
- **`src/components/chat/kilocode/ManagedIndexerStatus.tsx`** - Managed indexer status display
  - Indexer status and progress information
- **`src/components/chat/kilocode/OrganizationIndexingTab.tsx`** - Organization indexing interface
  - Organization-level indexing controls

### Auto-Approval System
- **`src/components/chat/AutoApproveDropdown.tsx`** - Auto-approval dropdown menu
  - Auto-approval options and settings
- **`src/components/chat/AutoApproveMenu.tsx`** - Auto-approval menu interface
  - Auto-approval configuration menu
- **`src/components/chat/AutoApprovedRequestLimitWarning.tsx`** - Auto-approval limit warning
  - Warning for auto-approval request limits
- **`src/components/chat/BatchDiffApproval.tsx`** - Batch diff approval interface
  - Multiple change approval interface
- **`src/components/chat/BatchFilePermission.tsx`** - Batch file permission
  - Multiple file permission requests

### Context Management
- **`src/components/chat/context-management/`** - Context management components
  - `index.ts` - Context management exports
  - Context selection and configuration interfaces
- **`src/components/chat/ContextMenu.tsx`** - Context menu interface
  - Context menu display and interaction

### Chat Hooks & Logic
- **`src/components/chat/hooks/useChatGhostText.ts`** - Ghost text functionality
  - Line 1: Hook definition for ghost text predictions
- **`src/components/chat/hooks/useManagedCodeIndexingEnabled.ts`** - Managed indexing state
  - Managed code indexing enable/disable logic
- **`src/components/chat/hooks/useManagedIndexerState.ts`** - Indexer state management
  - Indexer state and status management

### Human Relay System
- **`src/components/human-relay/HumanRelayDialog.tsx`** - Human relay dialog interface
  - Human-in-the-loop request handling

### Error Handling & Boundaries
- **`src/components/ErrorBoundary.tsx`** - React error boundary component
  - Error catching and display logic

## Data Models & Types

### Type Definitions
- **`@roo/ExtensionMessage`** - Extension message types
- **`@roo-code/types`** - KiloCode-specific types

### Schemas
- **`src/components/chat/kilocode/managedIndexerSchema.ts`** - Indexer configuration schema

## Testing

### Test Files
- **`src/__tests__/`** - General application tests
- **`src/components/**/__tests__/`** - Component-specific tests
- Test files follow the pattern `.spec.tsx` or `.test.tsx`

## Entry Points

### HTML Entry
- **`index.html`** - Main HTML template for the webview

### Build Configuration
- **`package.json`** - Dependencies and build scripts
- **`tsconfig.json`** - TypeScript configuration

## Key Features by Location

### Message Flow
1. **Input**: `ChatTextArea.tsx` → User types message
2. **Processing**: `ChatView.tsx` → Handles message state
3. **Display**: `ChatRow.tsx` → Renders user/assistant messages
4. **History**: `HistoryView.tsx` → Stores and displays conversation history

### Navigation Flow
1. **Routing**: `App.tsx` → Tab management logic
2. **Tabs**: Each view component (WelcomeView, ChatView, HistoryView, etc.)
3. **Controls**: `BottomControls.tsx` → Navigation buttons

### Settings Flow
1. **Main Settings**: `SettingsView.tsx` → Settings container
2. **API Config**: `ApiOptions.tsx` → API provider setup
3. **Profile**: `ProfileView.tsx` → User profile management

This structure provides a clear separation of concerns with reusable components and a modular architecture.
