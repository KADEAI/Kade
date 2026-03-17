import * as vscode from "vscode"

// Store panel references in both modes
let sidebarPanel: vscode.WebviewView | undefined = undefined
let tabPanel: vscode.WebviewPanel | undefined = undefined

/**
 * Get the currently active panel
 * @returns WebviewPanel或WebviewView
 */
export function getPanel(): vscode.WebviewPanel | vscode.WebviewView | undefined {
    return tabPanel || sidebarPanel
}

export function getTabPanel(): vscode.WebviewPanel | undefined {
    return tabPanel
}

export function getSidebarPanel(): vscode.WebviewView | undefined {
    return sidebarPanel
}

/**
 * Set panel references
 */
export function setPanel(
    newPanel: vscode.WebviewPanel | vscode.WebviewView | undefined,
    type: "sidebar" | "tab",
): void {
    if (type === "sidebar") {
        sidebarPanel = newPanel as vscode.WebviewView
        tabPanel = undefined
    } else {
        tabPanel = newPanel as vscode.WebviewPanel
        sidebarPanel = undefined
    }
}
