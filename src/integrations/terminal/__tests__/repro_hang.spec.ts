
import * as vscode from "vscode"
import { TerminalProcess } from "../TerminalProcess"
import { Terminal } from "../Terminal"
import { TerminalRegistry } from "../TerminalRegistry"

// Mock the vscode module
vi.mock("vscode", () => {
    // Store event handlers so we can trigger them in tests
    const eventHandlers = {
        startTerminalShellExecution: null,
        endTerminalShellExecution: null,
        closeTerminal: null,
    }

    return {
        workspace: {
            getConfiguration: vi.fn().mockReturnValue({
                get: vi.fn().mockReturnValue(null),
            }),
        },
        window: {
            createTerminal: vi.fn(),
            onDidStartTerminalShellExecution: vi.fn().mockImplementation((handler) => {
                eventHandlers.startTerminalShellExecution = handler
                return { dispose: vi.fn() }
            }),
            onDidEndTerminalShellExecution: vi.fn().mockImplementation((handler) => {
                eventHandlers.endTerminalShellExecution = handler
                return { dispose: vi.fn() }
            }),
            onDidCloseTerminal: vi.fn().mockImplementation((handler) => {
                eventHandlers.closeTerminal = handler
                return { dispose: vi.fn() }
            }),
        },
        ThemeIcon: class ThemeIcon {
            constructor(id: string) {
                this.id = id
            }
            id: string
        },
        Uri: {
            file: (path: string) => ({ fsPath: path }),
        },
        // Expose event handlers for testing
        __eventHandlers: eventHandlers,
    }
})

describe("TerminalProcess Hang Reproduction", () => {
    let terminalProcess: TerminalProcess
    let mockTerminal: any
    let mockTerminalInfo: Terminal
    let mockStream: AsyncIterableIterator<string>

    beforeEach(() => {
        // Create properly typed mock terminal
        mockTerminal = {
            shellIntegration: {
                executeCommand: vi.fn(),
            },
            name: "Kilo Code",
            processId: Promise.resolve(123),
            creationOptions: {},
            exitStatus: undefined,
            state: { isInteractedWith: true },
            dispose: vi.fn(),
            hide: vi.fn(),
            show: vi.fn(),
            sendText: vi.fn(),
        } as unknown as vscode.Terminal & {
            shellIntegration: {
                executeCommand: any
            }
        }

        mockTerminalInfo = new Terminal(1, mockTerminal, "./")
        mockTerminalInfo.running = true

        // Create a process for testing
        terminalProcess = new TerminalProcess(mockTerminalInfo)
        mockTerminalInfo.process = terminalProcess // Link process to terminal

        TerminalRegistry["terminals"] = [mockTerminalInfo]
    })

    it("should complete successfully even if shell_execution_complete event is missing", async () => {
        // Mock stream data with shell integration sequences including EXIT CODE marker
        mockStream = (async function* () {
            yield "\x1b]633;C\x07" // Command Start
            yield "Command Output\n"
            // Exit code 0 marker
            yield "\x1b]633;D;0\x07"
            yield "\x1b]633;E;command line\x07" // Command Line (optional)
        })()

        mockTerminal.shellIntegration.executeCommand.mockReturnValue({
            read: vi.fn().mockReturnValue(mockStream),
        })

        // Spy on shellExecutionComplete to verify it gets called
        const shellExecutionCompleteSpy = vi.spyOn(mockTerminalInfo, "shellExecutionComplete")

        const runPromise = terminalProcess.run("test command")
        terminalProcess.emit("stream_available", mockStream)

        // Wait for runPromise with a timeout
        // Currently (before fix), this should timeout because the event is never fired
        // After fix, it should resolve quickly because it detects the D marker
        await expect(runPromise).resolves.toBeUndefined()

        expect(shellExecutionCompleteSpy).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 0 }))
    }, 5000) // 5s timeout
})
