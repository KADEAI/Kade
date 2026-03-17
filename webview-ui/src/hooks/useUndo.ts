import { useCallback, useMemo } from 'react';
import { vscode } from '../utils/vscode';
import { useExtensionState } from '../context/ExtensionStateContext';

export function useUndo(toolUseId?: string) {
    const { undoneToolIds } = useExtensionState();

    const isUndone = useMemo(() => {
        if (!toolUseId || !undoneToolIds) return false;
        return undoneToolIds.includes(toolUseId);
    }, [toolUseId, undoneToolIds]);

    const handleUndo = useCallback(async () => {
        if (!toolUseId) {
            console.warn('[useUndo] No toolUseId available');
            return;
        }

        console.log('[useUndo] Undo button clicked for:', toolUseId);

        try {
            await vscode.postMessage({
                type: 'command',
                command: 'claudix.undoEdits',
                args: [[toolUseId]]
            } as any);
            console.log('[useUndo] Undo command sent to backend');

            // Update the workspace state immediately for persistence
            // The extension will broadcast the updated state back to us
            const newUndoneIds = Array.from(new Set([...(undoneToolIds || []), toolUseId]));
            vscode.postMessage({
                type: 'request',
                requestId: Date.now().toString(),
                request: {
                    type: 'updateWorkspaceState',
                    key: 'claudix.undoneToolIds',
                    value: newUndoneIds
                }
            } as any);

        } catch (e) {
            console.error("Undo failed", e);
        }

    }, [toolUseId, undoneToolIds]);

    const handleRedo = useCallback(async () => {
        if (!toolUseId) return;

        console.log('[useUndo] Redo button clicked for:', toolUseId);

        try {
            await vscode.postMessage({
                type: 'command',
                command: 'claudix.redoEdits',
                args: [[toolUseId]]
            } as any);
            console.log('[useUndo] Redo command sent to backend');

            // Update the workspace state immediately for persistence
            const newUndoneIds = (undoneToolIds || []).filter(id => id !== toolUseId);
            vscode.postMessage({
                type: 'request',
                requestId: Date.now().toString(),
                request: {
                    type: 'updateWorkspaceState',
                    key: 'claudix.undoneToolIds',
                    value: newUndoneIds
                }
            } as any);

        } catch (e) {
            console.error("Redo failed", e);
        }

    }, [toolUseId, undoneToolIds]);

    return { isUndone, handleUndo, handleRedo };
}
