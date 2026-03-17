import React, { createContext, useContext, useMemo, useState } from 'react';

export interface ToolTheme {
    name: string;
    fontFamily: string;
    colors: {
        primary: string;
        secondary: string;
        background: string;
        hoverBackground: string;
        border: string;
        text: string;
        description: string;
    };
    toolAccents: Record<string, string>;
    gradients: {
        shimmer: (accent: string) => string;
        header: string;
    };
    styles: {
        borderRadius: string;
        padding: string;
    };
}

const defaultTheme: ToolTheme = {
    name: 'default',
    fontFamily: 'var(--vscode-font-family), -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    colors: {
        primary: 'var(--vscode-textLink-foreground)',
        secondary: 'var(--vscode-descriptionForeground)',
        background: 'transparent',
        hoverBackground: 'var(--vscode-list-hoverBackground)',
        border: 'transparent',
        text: 'var(--vscode-editor-foreground)',
        description: 'var(--vscode-descriptionForeground)',
    },
    toolAccents: {
        'read': 'var(--vscode-editor-foreground)',
        'grep': '#c586c0',
        'web_search': '#3794ff',
        'web_fetch': '#b180d7',
        'glob': '#9cdcfe',
        'list_dir': 'var(--vscode-editor-foreground)',
        'mkdir': 'var(--vscode-editor-foreground)',
        'mcp': '#4ec9b0',
        'browser': '#3794ff',
        'default': 'var(--vscode-editor-foreground)',
    },
    gradients: {
        shimmer: (accent) => `linear-gradient(
            120deg,
            var(--vscode-descriptionForeground) 40%,
            ${accent} 50%,
            var(--vscode-descriptionForeground) 60%
        )`,
        header: 'none',
    },
    styles: {
        borderRadius: '0px',
        padding: '0px 2px',
    },
};

const glassTheme: ToolTheme = {
    name: 'glass',
    fontFamily: 'var(--vscode-font-family), -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    colors: {
        primary: '#61dafb', // React blue-ish
        secondary: 'rgba(255, 255, 255, 0.6)',
        background: 'rgba(30, 30, 30, 0.4)',
        hoverBackground: 'rgba(255, 255, 255, 0.05)',
        border: 'rgba(255, 255, 255, 0.1)',
        text: '#ffffff',
        description: 'rgba(255, 255, 255, 0.7)',
    },
    toolAccents: {
        'read': '#a6e22e',
        'grep': '#f92672',
        'web_search': '#66d9ef',
        'web_fetch': '#ae81ff',
        'glob': '#fd971f',
        'list_dir': '#e6db74',
        'mkdir': '#e6db74',
        'mcp': '#4ec9b0',
        'browser': '#66d9ef',
        'default': '#ffffff',
    },
    gradients: {
        shimmer: (accent) => `linear-gradient(
            120deg,
            rgba(255, 255, 255, 0.5) 40%,
            ${accent} 50%,
            rgba(255, 255, 255, 0.5) 60%
        )`,
        header: 'linear-gradient(90deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0) 100%)',
    },
    styles: {
        borderRadius: '6px',
        padding: '0px 0px',
    },
};

interface ToolThemeContextType {
    theme: ToolTheme;
    setTheme: (themeName: string) => void;
    availableThemes: string[];
}

const ToolThemeContext = createContext<ToolThemeContextType>({
    theme: defaultTheme,
    setTheme: () => { },
    availableThemes: ['default', 'glass']
});

export const ToolThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [themeName, setThemeName] = useState('default');

    const theme = useMemo(() => {
        switch (themeName) {
            case 'glass': return glassTheme;
            default: return defaultTheme;
        }
    }, [themeName]);

    return (
        <ToolThemeContext.Provider value={{
            theme,
            setTheme: setThemeName,
            availableThemes: ['default', 'glass']
        }}>
            {children}
        </ToolThemeContext.Provider>
    );
};

export const useToolTheme = () => {
    return useContext(ToolThemeContext);
};
