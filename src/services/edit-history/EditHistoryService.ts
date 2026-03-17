import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { diffLines } from 'diff';
import debounce from 'lodash.debounce';

export interface FileSnapshot {
    filePath: string;
    originalContent: string;
    modifiedContent?: string;
}

export interface EditRecord {
    toolUseId: string;
    timestamp: number;
    snapshots: FileSnapshot[];
}

export class EditHistoryService {
    private static instance: EditHistoryService;

    // Map toolUseId -> EditRecord
    private history = new Map<string, EditRecord>();
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadHistoryFromStorage();
    }

    public static getInstance(context?: vscode.ExtensionContext): EditHistoryService {
        if (!EditHistoryService.instance) {
            if (context) {
                EditHistoryService.instance = new EditHistoryService(context);
            } else {
                throw new Error("EditHistoryService not initialized with context");
            }
        }
        return EditHistoryService.instance;
    }

    public static setInstance(instance: EditHistoryService): void {
        EditHistoryService.instance = instance;
    }

    private loadHistoryFromStorage(): void {
        try {
            const stored = this.context.workspaceState.get<{ [key: string]: EditRecord }>('claudix.editHistory');
            if (stored) {
                this.history = new Map(Object.entries(stored));
                // console.log(`[EditHistoryService] Loaded ${this.history.size} edit records`);
            }
        } catch (error) {
            console.error('[EditHistoryService] Failed to load edit history:', error);
        }
    }

    private saveHistoryToStorage(): void {
        // PERF: Use debounced version to batch rapid saves
        this.debouncedSaveHistoryToStorage();
    }

    // PERF: Debounce storage writes to prevent blocking on every snapshot.
    // In large codebases with rapid file operations, this prevents severe lag.
    private debouncedSaveHistoryToStorage = debounce(
        () => {
            try {
                const historyObject = Object.fromEntries(this.history);
                this.context.workspaceState.update('claudix.editHistory', historyObject);
            } catch (error) {
                console.error('[EditHistoryService] Failed to save edit history:', error);
            }
        },
        75, // 500ms debounce
        { leading: false, trailing: true, maxWait: 150 } // Max 2s wait
    );

    // Force immediate save (for cleanup/dispose)
    public flushPendingSave(): void {
        this.debouncedSaveHistoryToStorage.flush();
    }

    public async captureBatchState(cwd: string, snapshots: { path: string, content: string | undefined }[], toolUseId?: string): Promise<void> {
        if (!toolUseId) {
            return;
        }

        for (const snapshot of snapshots) {
            const absolutePath = path.isAbsolute(snapshot.path) ? snapshot.path : path.resolve(cwd, snapshot.path);
            this.addSnapshot(toolUseId, {
                filePath: absolutePath,
                originalContent: snapshot.content || ""
            });
        }
    }

    public addSnapshot(toolUseId: string, snapshot: FileSnapshot): void {
        let record = this.history.get(toolUseId);
        if (!record) {
            record = {
                toolUseId,
                timestamp: Date.now(),
                snapshots: []
            };
            this.history.set(toolUseId, record);
        }

        // Avoid duplicate snapshots for the same file in the same toolUseId
        const existing = record.snapshots.find(s => s.filePath === snapshot.filePath);
        if (!existing) {
            record.snapshots.push(snapshot);
            this.saveHistoryToStorage();
        }
    }

    public updateModifiedState(toolUseId: string, filePath: string, modifiedContent: string): void {
        const record = this.history.get(toolUseId);
        if (record) {
            const snapshot = record.snapshots.find(s => s.filePath === filePath);
            if (snapshot) {
                snapshot.modifiedContent = modifiedContent;
                this.saveHistoryToStorage();
            }
        }
    }

    public getSnapshots(toolUseId: string): FileSnapshot[] {
        return this.history.get(toolUseId)?.snapshots || [];
    }

    public async undo(toolUseIds: string[]): Promise<string[]> {
        const revertedFiles: string[] = [];

        for (const id of toolUseIds) {
            const record = this.history.get(id);
            if (record) {
                for (const snapshot of record.snapshots) {
                    try {
                        if (snapshot.originalContent === "") {
                            // It was a new file, so delete it
                            if (fs.existsSync(snapshot.filePath)) {
                                await fs.promises.unlink(snapshot.filePath);
                            }
                        } else {
                            // Restore original content
                            await fs.promises.writeFile(snapshot.filePath, snapshot.originalContent, 'utf-8');
                        }
                        revertedFiles.push(snapshot.filePath);
                    } catch (e) {
                        console.error(`[EditHistoryService] Failed to revert ${snapshot.filePath}:`, e);
                    }
                }
            }
        }
        return [...new Set(revertedFiles)];
    }

    public async redo(toolUseIds: string[]): Promise<string[]> {
        const redoneFiles: string[] = [];

        for (const id of toolUseIds) {
            const record = this.history.get(id);
            if (record) {
                for (const snapshot of record.snapshots) {
                    try {
                        if (snapshot.modifiedContent !== undefined) {
                            await fs.promises.writeFile(snapshot.filePath, snapshot.modifiedContent, 'utf-8');
                            redoneFiles.push(snapshot.filePath);
                        } else {
                            console.warn(`[EditHistoryService] No modified content found for ${snapshot.filePath} (id: ${id}), cannot redo.`);
                        }
                    } catch (e) {
                        console.error(`[EditHistoryService] Failed to redo ${snapshot.filePath}:`, e);
                    }
                }
            }
        }
        return [...new Set(redoneFiles)];
    }

    public async getUndoPreview(toolUseIds: string[]): Promise<{ filePath: string, name: string, isDeleted: boolean, isNew: boolean, additions: number, deletions: number }[]> {
        const preview: any[] = [];

        for (const id of toolUseIds) {
            const record = this.history.get(id);
            if (record) {
                for (const snapshot of record.snapshots) {
                    try {
                        const filePath = snapshot.filePath;
                        const name = path.basename(filePath);
                        const exists = fs.existsSync(filePath);

                        let additions = 0;
                        let deletions = 0;
                        let isDeleted = false;
                        let isNew = false;

                        if (snapshot.originalContent === "") {
                            // It's a new file created by the AI. Undoing will delete it.
                            isNew = true; // "New" in the context that AI made it, but undoing removes it.
                            if (exists) {
                                try {
                                    const currentContent = await fs.promises.readFile(filePath, 'utf-8');
                                    additions = currentContent.split('\n').filter(line => line.length > 0).length || 1;
                                } catch (e) {
                                    additions = 0;
                                }
                            }
                        } else if (!exists) {
                            // The AI deleted the file. Undoing restores it.
                            isDeleted = true;
                            deletions = snapshot.originalContent.split('\n').filter(line => line.length > 0).length || 1;
                        } else {
                            // Modified file
                            try {
                                const currentContent = await fs.promises.readFile(filePath, 'utf-8');
                                // Diff current against original (snapshot)
                                // If we undo, we go FROM current TO original.
                                // So additions in current are deletions in undo.
                                const diff = diffLines(snapshot.originalContent, currentContent);

                                diff.forEach((part) => {
                                    if (part.added) {
                                        additions += part.count || 0;
                                    }
                                    if (part.removed) {
                                        deletions += part.count || 0;
                                    }
                                });
                            } catch (e) {
                                console.error(`[EditHistoryService] Diff failed for ${filePath}:`, e);
                            }
                        }

                        preview.push({
                            filePath,
                            name,
                            isDeleted,
                            isNew,
                            additions,
                            deletions
                        });
                    } catch (e) {
                        console.error(`[EditHistoryService] Preview failed for ${snapshot.filePath}:`, e);
                    }
                }
            }
        }

        // Deduplicate logic if needed (borrowed from original)
        const uniquePreview = Array.from(
            preview.reduce((acc, curr) => {
                if (!acc.has(curr.filePath)) {
                    acc.set(curr.filePath, curr);
                }
                return acc;
            }, new Map<string, any>()).values()
        );

        return uniquePreview as any;
    }
}
