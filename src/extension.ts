import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The active workspace folder path, determined on activation.
 * @type {string | undefined}
 */
let workspaceFolder: string | undefined;

/**
 * Path to the log file.
 * @type {string | undefined}
 */
let logFilePath: string | undefined;

/**
 * Flag to ensure the log directory is created only once.
 * @type {boolean}
 */
let directoryEnsured = false;

/**
 * Ensures the log directory exists.
 * @async
 */
async function ensureLogDirectory(): Promise<void> {
    if (directoryEnsured || !logFilePath) return;

    const logDir = path.dirname(logFilePath);
    try {
        await fs.promises.mkdir(logDir, { recursive: true });
        directoryEnsured = true;
        console.log(`Debug Logger: Ensured log directory exists at ${logDir}`);
    } catch (error) {
        console.error(`Debug Logger: Failed to create log directory ${logDir}: ${error instanceof Error ? error.message : String(error)}`);
        // Optionally notify user, but might be noisy
        // vscode.window.showErrorMessage(`Debug Logger: Failed to create log directory: ${error}`);
    }
}

/**
 * Appends a message to the log file.
 * @async
 * @param {string} message The message string to append.
 */
async function appendToLogFile(message: string): Promise<void> {
    // Attempt to initialize logFilePath if it's not already set
    if (!logFilePath) {
        // Re-check workspace folder in case it became available after initial activation
        // but before the first log message
        workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceFolder) {
            const tempDir = path.join(workspaceFolder, 'temp');
            logFilePath = path.join(tempDir, 'debugConsole.log');
            directoryEnsured = false; // Reset flag as path is newly set
            console.log(`Debug Logger: Log path initialized late at ${logFilePath}`);
            // No need to call ensureLogDirectory here, it will be called below
        } else {
            // If still no workspace folder, we cannot log.
            console.error('Debug Logger: Workspace folder not available. Cannot determine log file path.');
            return;
        }
    }

    // Ensure directory exists before first write (or if path was just set)
    if (!directoryEnsured) {
        await ensureLogDirectory();
        // If directory creation failed, don't attempt to append
        if (!directoryEnsured) {
            console.error(`Debug Logger: Failed to ensure log directory exists for path: ${logFilePath}. Cannot append message.`);
            return; // Prevent appending if directory isn't ready
        }
    }

    // Proceed with appending only if logFilePath is now valid and directoryEnsured is true
    if (logFilePath && directoryEnsured) {
        try {
            await fs.promises.appendFile(logFilePath, message, 'utf8');
        } catch (error) {
            console.error(`Debug Logger: Failed to append to log file ${logFilePath}: ${error instanceof Error ? error.message : String(error)}`);
            // Optionally notify user
            // vscode.window.showErrorMessage(`Debug Logger: Failed to write to log file: ${error}`);
        }
    }
    // If logFilePath is somehow still null or directoryEnsured is false after checks,
    // the function will silently exit here, which is intended as preconditions failed.
}

/**
 * Activates the extension by registering a debug adapter tracker that appends output to a log file.
 * @param {vscode.ExtensionContext} context VS Code extension context.
 */
export function activate(context: vscode.ExtensionContext) {
    workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceFolder) {
        console.warn('Debug Logger: No workspace folder found on activation. Log saving might fail until a workspace is opened.');
        // We don't return here, as a workspace might open later, but logFilePath won't be set initially.
    } else {
        const tempDir = path.join(workspaceFolder, 'temp');
        logFilePath = path.join(tempDir, 'debugConsole.log');
        // Reset directory ensured flag on activation
        directoryEnsured = false;
        // Attempt to ensure directory exists on activation
        ensureLogDirectory();
    }

    // Handle workspace changes after activation
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (workspaceFolder) {
                const tempDir = path.join(workspaceFolder, 'temp');
                logFilePath = path.join(tempDir, 'debugConsole.log');
                directoryEnsured = false; // Reset flag as path might change
                ensureLogDirectory(); // Try ensuring the new directory
                console.log(`Debug Logger: Workspace changed. Log path set to ${logFilePath}`);
            } else {
                logFilePath = undefined;
                directoryEnsured = false;
                console.warn('Debug Logger: Workspace closed or became empty. Logging paused.');
            }
        })
    );

    /**
     * Factory for creating debug adapter trackers.
     * @type {vscode.DebugAdapterTrackerFactory}
     */
    const factory: vscode.DebugAdapterTrackerFactory = {
        /**
         * Creates a new debug adapter tracker.
         * @returns {vscode.DebugAdapterTracker} The debug adapter tracker.
         */
        createDebugAdapterTracker() {
            return {
                /**
                 * Called when a message is sent from the debug adapter to the client (VS Code).
                 * Captures 'output' events and appends them to the log file.
                 * @param {vscode.DebugProtocolMessage} message The debug protocol message.
                 */
                onDidSendMessage: (message: vscode.DebugProtocolMessage) => {
                    if ('event' in message && message.event === 'output' && 'body' in message) {
                        const body = message.body as { output?: string };
                        if (typeof body?.output === 'string') {
                            // Append the output directly to the file
                            appendToLogFile(body.output);
                        }
                    }
                }
            };
        }
    };

    // Register the debug adapter tracker factory for all debug types
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterTrackerFactory('*', factory)
    );

    console.log('Debug Logger activated. Appending debug output to log file automatically.');
}

/**
 * Deactivates the extension.
 */
export function deactivate() {
    console.log('Debug Logger deactivating.');
    // No explicit action needed here anymore as data is appended live.
} 