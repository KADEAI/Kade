import * as vscode from 'vscode';

export interface SearchResult {
    filePath: string;
    lineRange: [number, number];
    relevanceScore: number;
    codeContent: string;
}

export interface ScoredFile {
    path: string;
    score: number;
    bestWindow: [number, number];
    content: string;
}
