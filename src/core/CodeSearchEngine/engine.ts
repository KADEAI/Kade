import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { SearchResult, ScoredFile } from './types';

const execAsync = promisify(exec);

export class JITSearchEngine {
    private readonly WINDOW_SIZE = 30;
    private readonly SYMBOL_WEIGHT = 25.0;
    private readonly FILENAME_WEIGHT = 500.0;
    private readonly BODY_WEIGHT = 1.0;

    private readonly STOPWORDS = new Set([
        'how', 'is', 'the', 'and', 'does', 'it', 'handle', 'where', 'implement', 'code', 'in', 'to', 'of', 'work', 'a', 'an', 'what', 'why', 'who', 'show', 'tell', 'me'
    ]);

    private tokenize(text: string, filterStopwords = true): string[] {
        const tokens = text
            .split(/([^a-zA-Z0-9]+|(?=[A-Z][a-z])|(?<=[a-z])(?=[A-Z])|(?<=[0-9])(?=[a-zA-Z])|(?<=[a-zA-Z])(?=[0-9]))/)
            .map(s => s.trim().toLowerCase())
            .filter(s => s.length > 1);

        return filterStopwords ? tokens.filter(t => !this.STOPWORDS.has(t)) : tokens;
    }

    private async getTopFiles(query: string, limit: number = 50): Promise<string[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return [];

        const rootPath = workspaceFolders[0].uri.fsPath;
        const keywords = this.tokenize(query);
        const regex = keywords.join('|');

        try {
            const { stdout } = await execAsync(`rg -l -i "${regex}" "${rootPath}" --max-filesize 1M -g "!*.map" -g "!*.json"`);
            return stdout.split('\n').filter(f => f.trim().length > 0).slice(0, limit);
        } catch (error) {
            return [];
        }
    }

    public async search(query: string): Promise<SearchResult[]> {
        const queryTokens = this.tokenize(query);
        const filePaths = await this.getTopFiles(query);

        const scoredFiles: ScoredFile[] = await Promise.all(
            filePaths.map(fp => this.processFile(fp, queryTokens))
        );

        return scoredFiles
            .filter(f => f.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(f => {
                let lines = f.content.split('\n');
                let start = f.bestWindow[0] - 1;
                let end = f.bestWindow[1];

                // KILOCODE MOD: Truncate low scoring results to reduce noise
                if (f.score < 600) {
                    const windowSize = end - start;
                    const center = start + Math.floor(windowSize / 2);
                    // Create a 4-line window centered on the peak
                    start = Math.max(0, center - 2);
                    end = Math.min(lines.length, start + 4);
                }

                const content = lines.slice(start, end).join('\n');

                return {
                    filePath: vscode.workspace.asRelativePath(f.path),
                    lineRange: [start + 1, end] as [number, number],
                    relevanceScore: parseFloat(f.score.toFixed(4)),
                    codeContent: content
                };
            });
    }

    private async processFile(filePath: string, queryTokens: string[]): Promise<ScoredFile> {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            const fileName = path.basename(filePath).toLowerCase();

            // KILOCODE MOD: Use regex instead of slow vscode.executeDocumentSymbolProvider
            const symbolRanges = this.parseSymbolsRegex(content);

            // 1. Score every line to find the implementation epicenter
            const lineScores = lines.map((lineText, l) => {
                let score = 0;
                const lineLower = lineText.toLowerCase();
                // Check if line is within a symbol definition
                const symbolAtLine = symbolRanges.find(s => l >= s.start && l <= s.end);
                // Check if line is a comment
                const isComment = /^\s*(\/\/|\/\*|\*)/.test(lineText);

                queryTokens.forEach(q => {
                    if (lineLower.includes(q)) {
                        score += 1.0; // Base match

                        // Context Boosting
                        if (symbolAtLine) {
                            // If match is in the declaration line of the symbol
                            if (l === symbolAtLine.start) score += 20.0;
                            // If match is inside the symbol body
                            else score += 5.0;
                        }

                        // Comment Boosting (High value for "How to" or explanations)
                        if (isComment) score += 5.0;

                        // Keyword Boosting (Definition-like lines)
                        if (lineLower.match(new RegExp(`(class|function|export|interface|const|let|async)\\s+.*${q}`, 'i'))) score += 10.0;
                    }
                });
                return score;
            });

            // 2. Find the optimal 30-line window around the highest density
            let maxTotalScore = 0;
            let bestCenterLine = 0;

            for (let i = 0; i < lines.length; i++) {
                const windowStart = Math.max(0, i - Math.floor(this.WINDOW_SIZE / 2));
                const windowEnd = Math.min(lines.length, windowStart + this.WINDOW_SIZE);

                let windowScore = 0;
                const tokensFound = new Set<string>();

                for (let l = windowStart; l < windowEnd; l++) {
                    windowScore += lineScores[l];
                    queryTokens.forEach(q => {
                        if (lines[l].toLowerCase().includes(q)) tokensFound.add(q);
                    });
                }

                // Diversity Boost: Rewards windows that contain MORE of the unique query terms
                const coverage = tokensFound.size / queryTokens.length;
                windowScore *= Math.pow(1 + coverage, 3);

                // Filename Boost
                queryTokens.forEach(q => {
                    if (fileName.includes(q)) windowScore *= 2.0;
                });

                if (windowScore > maxTotalScore) {
                    maxTotalScore = windowScore;
                    bestCenterLine = i;
                }
            }

            const finalStart = Math.max(0, bestCenterLine - Math.floor(this.WINDOW_SIZE / 2));
            const finalEnd = Math.min(lines.length, finalStart + this.WINDOW_SIZE);

            return { path: filePath, score: maxTotalScore, bestWindow: [finalStart + 1, finalEnd], content };
        } catch (e) {
            return { path: filePath, score: 0, bestWindow: [0, 0], content: '' };
        }
    }

    private parseSymbolsRegex(content: string): { start: number, end: number, type: string }[] {
        const symbols: { start: number, end: number, type: string }[] = [];
        const lines = content.split('\n');

        // Simple regex to catch common definitions.
        // It's not a full parser, but fast and good enough for scoring.
        const defRegex = /^\s*(export\s+)?(class|interface|function|const|let|var|async)\s+([a-zA-Z0-9_]+)/;

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(defRegex);
            if (match) {
                // Heuristic: Estimate block size by indentation or generic size
                // For speed, we assign a "gravity well" of 20 lines to definitions
                // or until the next definition found (not implemented for simplicity, just fixed range)
                // A better approach is indentation tracking, but let's stick to simple "Gravity" for JIT
                symbols.push({
                    start: i,
                    end: Math.min(lines.length - 1, i + 20), // Assume 20 lines of relevant context
                    type: match[2]
                });
            }
        }
        return symbols;
    }
}
