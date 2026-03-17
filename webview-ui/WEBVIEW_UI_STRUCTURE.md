# WebView UI File Structure

This document provides an overview of the file structure for the `webview-ui` directory, which contains the React-based frontend for the extension.

## Directory Layout

### Root (`/`)
- **`index.html`**: Main entry point for the webview.
- **`vite.config.ts`**: Vite configuration.
- **`package.json`**: Dependencies and scripts.

### Source Code (`src/`)

The source code is organized primarily by function and feature.

#### `src/components/`
React components, organized by feature domain.

- **`chat/`**: Components related to the chat interface (messages, input, rows).
- **`settings/`**: Components for the settings page and configuration.
- **`ui/`**: Reusable generic UI components (often atomic, e.g., Buttons, Inputs).
- **`common/`**: Shared components used across different features.
- **`history/`**: Components for displaying chat history.
- **`marketplace/`**: Components for the extension marketplace or features.
- **`kilocode/`**: Specific components related to Kilocode branding or features.
- **`ErrorBoundary.tsx`**: Global error boundary component.

#### `src/context/`
React Context definitions for global state management (e.g., ExtensionStateContext).

#### `src/hooks/`
Custom React hooks (e.g., `useEvent`, `useScroll`).

#### `src/utils/`
Utility functions and helpers.

#### `src/services/`
Service layer for handling logic like formatting or specific API interactions.

#### `src/lib/`
Library code, often containing utility wrappers or `utils.ts` for class merging (cn).

#### `src/kilocode/`
Specific Kilocode module integrations.
- **`agent-manager/`**: Components and logic for the agent manager interface.

#### `src/i18n/`
Internationalization files.

### Key Files
- **`src/App.tsx`**: Main application component, handles routing and top-level layout.
- **`src/index.tsx`**: Entry point for React rendering.
- **`src/index.css`**: Global styles (Tailwind imports).

## Tech Stack
- **Framework**: React
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **State Management**: React Context
