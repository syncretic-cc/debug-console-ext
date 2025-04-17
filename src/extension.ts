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
            // Save directly in the workspace folder
            logFilePath = path.join(workspaceFolder, 'debugConsole.log');
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
        // Save directly in the workspace folder
        logFilePath = path.join(workspaceFolder, 'debugConsole.log');
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
                // Save directly in the workspace folder
                logFilePath = path.join(workspaceFolder, 'debugConsole.log');
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
            // Reset the log file at the beginning of each debug session
            if (logFilePath) {
                // Use an async IIFE to handle the promise without making createDebugAdapterTracker async
                (async () => {
                    try {
                        // Ensure directory exists before attempting to write/clear
                        // This handles cases where the directory might not exist yet if the workspace
                        // was opened after activation but before the first debug session.
                        if (!directoryEnsured) {
                            await ensureLogDirectory();
                        }
                        // Only write if directory exists and is ensured
                        if (logFilePath && directoryEnsured) {
                             await fs.promises.writeFile(logFilePath, '', 'utf8'); // Overwrite with empty string
                             console.log(`Debug Logger: Log file ${logFilePath} reset for new session.`);
                        } else if (logFilePath) {
                             // Log error if directory couldn't be ensured
                             console.error(`Debug Logger: Cannot reset log file. Directory ${path.dirname(logFilePath)} not ensured.`);
                        }
                        // If logFilePath is null/undefined, the outer 'if' prevents this block
                    } catch (error) {
                        console.error(`Debug Logger: Failed to reset log file ${logFilePath}: ${error instanceof Error ? error.message : String(error)}`);
                        // Optionally notify user
                        // vscode.window.showErrorMessage(`Debug Logger: Failed to reset log file: ${error}`);
                    }
                })(); // Immediately invoke the async function
            } else {
                 // Log a warning if the path isn't set when the tracker is created.
                 // This might indicate an issue with activation or workspace handling logic.
                 console.warn('Debug Logger: Cannot reset log file. logFilePath is not set when creating debug adapter tracker.');
            }

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