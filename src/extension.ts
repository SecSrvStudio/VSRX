import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { VSRXServer } from './server';

let server: VSRXServer;
let statusBarItem: vscode.StatusBarItem;
let runButton: vscode.StatusBarItem;
let savedScriptsButton: vscode.StatusBarItem;
let scriptHubButton: vscode.StatusBarItem;
let robloxOutputChannel: vscode.OutputChannel | undefined;
let logBuffer: { message: string, type: number, playerName: string, count: number } | null = null;
let logBufferTimeout: NodeJS.Timeout | null = null;
let lastStatusBarCount = -1;
import * as https from 'https';

function notify(msg: string) {
    const config = vscode.workspace.getConfiguration('vsrx');
    if (config.get<boolean>('showNotifications') !== false) {
        vscode.window.showInformationMessage(msg);
    }
}

export function activate(context: vscode.ExtensionContext) {
    server = new VSRXServer();
    server.start();

    const config = vscode.workspace.getConfiguration('vsrx');
    server.consoleEnabled = config.get<boolean>('enableConsoleCapture') !== false;
    server.internalUIEnabled = config.get<boolean>('enableInternalUI') === true;
    server.showUIOnLoad = config.get<boolean>('showUIOnLoad') === true;
    server.defaultSavePath = config.get<string>('defaultSavePath') || "";

    if (server.consoleEnabled) {
        setupConsole();
        if (robloxOutputChannel) {
            robloxOutputChannel.show(true);
        }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('vsrx.showClients', async () => {
            await showClientsMenu();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vsrx.runScript', () => {
            if (server.hasClients()) {
                runScript();
            } else {
                const loader = server.getLoaderScript();
                vscode.env.clipboard.writeText(loader);
                notify('VSRX: Auto-detecting Loader script copied! Execute this in your emulator or executor.');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vsrx.saveScript', async () => {
            await saveScript();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vsrx.showSavedScripts', async () => {
            await showSavedScripts();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vsrx.showScriptHub', async () => {
            await showScriptHub();
        })
    );


    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = `$(versions) No Clients`;
    statusBarItem.tooltip = "Click to View VSRX Connections";
    statusBarItem.command = 'vsrx.showClients';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    runButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
    runButton.text = `$(play) Inject`;
    runButton.tooltip = "Run script in connected clients or copy loader";
    runButton.command = 'vsrx.runScript';
    runButton.color = new vscode.ThemeColor('testing.iconFailed');
    runButton.show();
    context.subscriptions.push(runButton);

    savedScriptsButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    savedScriptsButton.text = `$(folder-library) Save`;
    savedScriptsButton.tooltip = "VSRX: View and Run Saved Scripts";
    savedScriptsButton.command = 'vsrx.showSavedScripts';
    if (config.get<boolean>('showSaveButton')) savedScriptsButton.show();
    context.subscriptions.push(savedScriptsButton);

    scriptHubButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    scriptHubButton.text = `$(cloud-download) Hub`;
    scriptHubButton.tooltip = "VSRX: Search and Run Scripts from ScriptBlox";
    scriptHubButton.command = 'vsrx.showScriptHub';
    if (config.get<boolean>('showHubButton')) scriptHubButton.show();
    context.subscriptions.push(scriptHubButton);

    server.onLogReceived = (log) => {
        queueLog(log.message, log.type, log.playerName);
    };

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('vsrx.showSaveButton')) {
            vscode.workspace.getConfiguration('vsrx').get<boolean>('showSaveButton') ? savedScriptsButton.show() : savedScriptsButton.hide();
        }
        if (e.affectsConfiguration('vsrx.showHubButton')) {
            vscode.workspace.getConfiguration('vsrx').get<boolean>('showHubButton') ? scriptHubButton.show() : scriptHubButton.hide();
        }
        if (e.affectsConfiguration('vsrx.enableConsoleCapture')) {
            const enabled = vscode.workspace.getConfiguration('vsrx').get<boolean>('enableConsoleCapture') !== false;
            server.consoleEnabled = enabled;
            if (enabled) {
                setupConsole();
                if (robloxOutputChannel) {
                    robloxOutputChannel.show(true);
                    robloxOutputChannel.appendLine("VSRX: Console Capture Enabled.");
                }
            } else {
                if (robloxOutputChannel) {
                    robloxOutputChannel.appendLine("VSRX: Console Capture Disabled.");
                }
            }
        }
        if (e.affectsConfiguration('vsrx.enableInternalUI')) {
            server.internalUIEnabled = vscode.workspace.getConfiguration('vsrx').get<boolean>('enableInternalUI') === true;
        }
        if (e.affectsConfiguration('vsrx.showUIOnLoad')) {
            server.showUIOnLoad = vscode.workspace.getConfiguration('vsrx').get<boolean>('showUIOnLoad') === true;
        }
        if (e.affectsConfiguration('vsrx.defaultSavePath')) {
            server.defaultSavePath = vscode.workspace.getConfiguration('vsrx').get<string>('defaultSavePath') || "";
        }
    }));

    setInterval(() => updateStatusBar(), 500);
}

function updateStatusBar() {
    if (!server) return;

    const count = server.connectedClients.size;
    if (count !== lastStatusBarCount) {
        if (count > lastStatusBarCount && lastStatusBarCount !== -1) {
            logToConsole(`VSRX: New client connected. Total: ${count}`, 'info');
        } else if (count < lastStatusBarCount) {
            logToConsole(`VSRX: Client disconnected. Total: ${count}`, 'info');
        }
        lastStatusBarCount = count;
    }

    if (count > 0) {
        statusBarItem.text = `$(versions) ${count} Client${count !== 1 ? 's' : ''}`;
        runButton.text = `$(play) ${server.getExecutorName()}`;
        runButton.color = new vscode.ThemeColor('testing.iconPassed');
    } else {
        statusBarItem.text = `$(versions) No Clients`;
        runButton.text = `$(play) Inject`;
        runButton.color = new vscode.ThemeColor('testing.iconFailed');
    }
}

async function showClientsMenu() {
    if (server.connectedClients.size === 0) {
        vscode.window.showInformationMessage("VSRX: No active clients connected. Run the Loader script first.");
        return;
    }

    const items: vscode.QuickPickItem[] = [];

    for (const [id, client] of server.connectedClients.entries()) {
        const stateIcon = client.executionEnabled ? '$(check)' : '$(circle-slash)';
        const stateText = client.executionEnabled ? 'Enabled' : 'Disabled';

        items.push({
            label: `${stateIcon} ${client.name}`,
            description: `Executor: ${client.executorName || 'Unknown'}`,
            detail: `User ID: ${client.userId || 'N/A'} - Click to Toggle (${stateText})`,
            // @ts-ignore
            clientId: id,
            clientEnabled: client.executionEnabled
        });
    }

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a client to Toggle Execution (ON/OFF)',
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (selected) {
        // @ts-ignore
        const clientId = selected.clientId;
        // @ts-ignore
        const currentEnabled = selected.clientEnabled;
        server.setClientExecution(clientId, !currentEnabled);
        notify(`VSRX: Client '${selected.label.split(' ')[1]}' execution is now ${!currentEnabled ? 'ON' : 'OFF'}`);
    }
}

function runScript() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('VSRX: No active script to run.');
        return;
    }
    const source = editor.document.getText();
    const entryPath = editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
    const workspaceRoot = getProjectRoot(entryPath) || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    expandLocalRequires(source, entryPath, workspaceRoot, new Map<string, string>(), new Set<string>(), true)
        .then(script => executeRawScript(script))
        .catch((error: any) => {
            vscode.window.showErrorMessage(`VSRX: Failed to resolve local require. ${error?.message || String(error)}`);
        });
}

async function expandLocalRequires(
    source: string,
    entryFilePath?: string,
    workspaceRoot?: string,
    moduleCache = new Map<string, string>(),
    loadingStack = new Set<string>(),
    wrapAsEntry = false
): Promise<string> {
    const requirePattern = /require\(\s*(["'])(.+?)\1\s*\)/g;
    const currentDir = entryFilePath ? path.dirname(entryFilePath) : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '');

    const modules = new Map<string, string>();
    const replacements = new Map<string, string>();
    const matches = Array.from(source.matchAll(requirePattern));

    for (const match of matches) {
        const fullCall = match[0];
        const requireTarget = match[2].trim();

        if (!requireTarget.startsWith('.')) {
            continue;
        }

        const resolvedPath = resolveLocalRequirePath(requireTarget, currentDir, workspaceRoot);
        if (!resolvedPath) {
            continue;
        }

        const normalizedPath = normalizeModulePath(resolvedPath);
        if (moduleCache.has(normalizedPath)) {
            modules.set(normalizedPath, moduleCache.get(normalizedPath)!);
            replacements.set(fullCall, `__VSRX_REQUIRE(${JSON.stringify(normalizedPath)})`);
            continue;
        }

        if (loadingStack.has(normalizedPath)) {
            throw new Error(`Circular require detected: ${normalizedPath}`);
        }

        if (!fs.existsSync(normalizedPath) || fs.statSync(normalizedPath).isDirectory()) {
            throw new Error(`Required file not found: ${requireTarget}`);
        }

        loadingStack.add(normalizedPath);
        try {
            let moduleSource = fs.readFileSync(normalizedPath, 'utf8');
            moduleSource = await expandLocalRequires(moduleSource, normalizedPath, workspaceRoot, moduleCache, loadingStack, false);

            moduleCache.set(normalizedPath, moduleSource);
            modules.set(normalizedPath, moduleSource);
            replacements.set(fullCall, `__VSRX_REQUIRE(${JSON.stringify(normalizedPath)})`);
        } finally {
            loadingStack.delete(normalizedPath);
        }
    }

    const moduleEntries = Array.from(modules.entries())
        .map(([modulePath, moduleSource]) => `\n\t[${JSON.stringify(modulePath)}] = function()\n${indentScript(moduleSource, 2)}\n\tend,`)
        .join('');

    const moduleWrapper = `local __VSRX_MODULES = {${moduleEntries}\n}\nlocal __VSRX_REQUIRE_CACHE = {}\nlocal function __VSRX_REQUIRE(modulePath)\n\tlocal cached = __VSRX_REQUIRE_CACHE[modulePath]\n\tif cached ~= nil then\n\t\treturn cached\n\tend\n\n\tlocal loader = __VSRX_MODULES[modulePath]\n\tif not loader then\n\t\terror(("VSRX: module not found: %s"):format(tostring(modulePath)), 2)\n\tend\n\n\tlocal result = loader()\n\tif result == nil then\n\t\tresult = true\n\tend\n\n\t__VSRX_REQUIRE_CACHE[modulePath] = result\n\treturn result\nend\n`;

    let expandedSource = source;
    for (const [needle, replacement] of replacements) {
        expandedSource = expandedSource.split(needle).join(replacement);
    }

    expandedSource = expandedSource.replace(
        /require\(\s*(game[^)]*)\s*\)/g,
        '(function() return require($1) end)()'
    );

    if (wrapAsEntry) {
        return `(function()\n${moduleWrapper}\n${expandedSource}\nend)()`;
    }

    return `${moduleWrapper}\n${expandedSource}`;
}

function resolveLocalRequirePath(target: string, currentDir: string, workspaceRoot?: string): string | null {
    const sanitized = target.replace(/^\.\//, '').replace(/^\.\\/, '');
    const shouldTryWorkspaceRoot = workspaceRoot && (target.startsWith('./') || target.startsWith('.\\'));
    const candidates = [
        ...(shouldTryWorkspaceRoot ? [
            path.resolve(workspaceRoot, target),
            path.resolve(workspaceRoot, sanitized),
            path.resolve(workspaceRoot, `${sanitized}.luau`),
            path.resolve(workspaceRoot, `${sanitized}.lua`)
        ] : []),
        path.resolve(currentDir, target),
        path.resolve(currentDir, sanitized),
        path.resolve(currentDir, `${sanitized}.luau`),
        path.resolve(currentDir, `${sanitized}.lua`)
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

function getProjectRoot(entryFilePath?: string): string | undefined {
    if (!entryFilePath) {
        return undefined;
    }

    const containingWorkspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(entryFilePath));
    if (containingWorkspace) {
        return containingWorkspace.uri.fsPath;
    }

    let current = path.dirname(entryFilePath);
    while (true) {
        if (
            fs.existsSync(path.join(current, '.luaurc')) ||
            fs.existsSync(path.join(current, 'default.project.json')) ||
            fs.existsSync(path.join(current, 'package.json')) ||
            fs.existsSync(path.join(current, '.git'))
        ) {
            return current;
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return path.dirname(entryFilePath);
        }
        current = parent;
    }
}

function normalizeModulePath(filePath: string): string {
    const normalized = path.normalize(filePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function indentScript(script: string, level: number): string {
    const indent = '\t'.repeat(level);
    return script
        .split(/\r?\n/)
        .map(line => line.length > 0 ? `${indent}${line}` : '')
        .join('\n');
}

function executeRawScript(script: string) {
    if (!script.trim()) {
        vscode.window.showErrorMessage('VSRX: Script is empty.');
        return;
    }

    const payload = JSON.stringify({ script });
    const requestOptions = {
        hostname: '127.0.0.1',
        port: 6732,
        path: '/execute',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = http.request(requestOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            if (res.statusCode === 200) {
                try {
                    const parsed = JSON.parse(data);
                    notify(`VSRX: Script executed on ${parsed.queued} client(s).`);
                } catch {
                    notify('VSRX: Script executed successfully.');
                }
            } else {
                vscode.window.showErrorMessage(`VSRX: Failed to queue script (Status: ${res.statusCode})`);
            }
        });
    });

    req.on('error', (e) => {
        vscode.window.showErrorMessage(`VSRX Server Error: (${e.message})`);
    });

    req.write(payload);
    req.end();
}

async function saveScript() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('VSRX: No active script to save.');
        return;
    }

    const script = editor.document.getText();
    if (!script.trim()) {
        vscode.window.showWarningMessage('VSRX: Script is empty, nothing to save.');
        return;
    }

    const config = vscode.workspace.getConfiguration('vsrx');
    const defaultPath = config.get<string>('defaultSavePath');

    if (defaultPath && defaultPath.trim() !== "") {
        try {
            let finalPath = defaultPath;
            if (!path.extname(finalPath)) {
                const fileName = await vscode.window.showInputBox({
                    prompt: 'Enter script name',
                    value: `vsrx_script_${Date.now()}.lua`
                });
                if (!fileName) return;

                finalPath = path.join(finalPath, fileName.endsWith('.lua') || fileName.endsWith('.luau') ? fileName : `${fileName}.lua`);
            }

            fs.writeFileSync(finalPath, script, 'utf8');
            notify(`VSRX: Script saved to ${finalPath}`);
            return;
        } catch (error: any) {
            vscode.window.showErrorMessage(`VSRX: Failed to save to default path. Error: ${error.message}`);
        }
    }

    const uri = await vscode.window.showSaveDialog({
        filters: {
            'Lua Scripts': ['lua', 'luau'],
            'All Files': ['*']
        },
        title: 'Save VSRX Script'
    });

    if (uri) {
        try {
            const contentBytes = Buffer.from(script, 'utf8');
            await vscode.workspace.fs.writeFile(uri, contentBytes);
            notify('VSRX: Script saved successfully.');
        } catch (error: any) {
            vscode.window.showErrorMessage(`VSRX: Could not save file. Error: ${error.message}`);
        }
    }
}

async function showSavedScripts() {
    const config = vscode.workspace.getConfiguration('vsrx');
    const defaultPath = config.get<string>('defaultSavePath');

    if (!defaultPath || defaultPath.trim() === "") {
        const setNow = await vscode.window.showWarningMessage('VSRX: Default Save Path is not set. Would you like to set it now?', 'Set Settings', 'Cancel');
        if (setNow === 'Set Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'vsrx.defaultSavePath');
        }
        return;
    }

    if (!fs.existsSync(defaultPath)) {
        vscode.window.showErrorMessage(`VSRX: Directory does not exist: ${defaultPath}`);
        return;
    }

    try {
        const files = fs.readdirSync(defaultPath);
        const items: vscode.QuickPickItem[] = files.map(file => {
            const fullPath = path.join(defaultPath, file);
            const isDir = fs.statSync(fullPath).isDirectory();
            return {
                label: isDir ? `$(folder) ${file}` : `$(file-code) ${file}`,
                description: isDir ? 'Folder - Click to open' : 'Lua Script - Click to execute',
                // @ts-ignore
                fullPath,
                isDir
            };
        });

        if (items.length === 0) {
            notify('VSRX: No scripts found in the save directory.');
            return;
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a script to run or folder to open'
        });

        if (selected) {
            // @ts-ignore
            if (selected.isDir) {
                vscode.env.openExternal(vscode.Uri.file((selected as any).fullPath));
            } else {
                const scriptContent = fs.readFileSync((selected as any).fullPath, 'utf8');
                executeRawScript(scriptContent);
            }
        }
    } catch (e: any) {
        vscode.window.showErrorMessage(`VSRX: Failed to read directory. Error: ${e.message}`);
    }
}

async function showScriptHub(query: string = '', page: number = 1) {
    let url = `https://scriptblox.com/api/script/fetch?page=${page}`;
    if (query && query.trim() !== '') {
        url = `https://scriptblox.com/api/script/search?q=${encodeURIComponent(query)}&page=${page}`;
    }

    notify(`VSRX: Fetching scripts from ScriptBlox (Page ${page})...`);

    https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
            if (res.statusCode === 200) {
                try {
                    const parsed = JSON.parse(data);
                    if (!parsed.result || !parsed.result.scripts || parsed.result.scripts.length === 0) {
                        vscode.window.showInformationMessage('VSRX: No scripts found for this search.');
                        const searchAgain = await vscode.window.showInputBox({ prompt: 'Search ScriptBlox (Leave empty for trending)', placeHolder: 'e.g. Blox Fruits' });
                        if (searchAgain !== undefined) showScriptHub(searchAgain, 1);
                        return;
                    }

                    const items: vscode.QuickPickItem[] = [];

                    items.push({
                        label: `$(search) Search ScriptBlox...`,
                        description: `Current Query: ${query || 'Trending'}`,
                        // @ts-ignore
                        isAction: 'search'
                    });

                    for (const script of parsed.result.scripts) {
                        items.push({
                            label: `$(code) ${script.title}`,
                            description: script.game && script.game.name ? `Game: ${script.game.name}` : `Universal`,
                            detail: `Views: ${script.views} | Verified: ${script.verified ? 'Yes' : 'No'}`,
                            // @ts-ignore
                            scriptCode: script.script,
                            isAction: 'run'
                        });
                    }

                    if (page > 1) {
                        items.push({
                            label: `$(arrow-left) Previous Page`,
                            description: `Go to Page ${page - 1}`,
                            // @ts-ignore
                            isAction: 'prev'
                        });
                    }

                    if (parsed.result.totalPages && page < parsed.result.totalPages) {
                        items.push({
                            label: `$(arrow-right) Next Page`,
                            description: `Go to Page ${page + 1}`,
                            // @ts-ignore
                            isAction: 'next'
                        });
                    }

                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: `ScriptBlox Hub - Page ${page}/${parsed.result.totalPages || 1}`,
                        matchOnDescription: true,
                        matchOnDetail: true
                    });

                    if (selected) {
                        // @ts-ignore
                        const action = selected.isAction;
                        if (action === 'search') {
                            const newQuery = await vscode.window.showInputBox({
                                prompt: 'Search ScriptBlox (Leave empty for trending)',
                                placeHolder: 'e.g. Blox Fruits',
                                value: query
                            });
                            if (newQuery !== undefined) {
                                showScriptHub(newQuery, 1);
                            }
                        } else if (action === 'next') {
                            showScriptHub(query, page + 1);
                        } else if (action === 'prev') {
                            showScriptHub(query, page - 1);
                        } else if (action === 'run') {
                            // @ts-ignore
                            executeRawScript(selected.scriptCode);
                        }
                    }

                } catch (e) {
                    vscode.window.showErrorMessage('VSRX: Failed to parse ScriptBlox data.');
                }
            } else {
                vscode.window.showErrorMessage(`VSRX: ScriptBlox API Error (Status: ${res.statusCode})`);
            }
        });
    }).on('error', (e) => {
        vscode.window.showErrorMessage(`VSRX: Network Error - ${e.message}`);
    });
}



function setupConsole() {
    if (!robloxOutputChannel) {
        robloxOutputChannel = vscode.window.createOutputChannel("Roblox Console");
    }
}

function queueLog(message: string, type: number, playerName: string) {
    if (logBuffer && logBuffer.message === message && logBuffer.type === type && logBuffer.playerName === playerName) {
        logBuffer.count++;
        if (logBufferTimeout) clearTimeout(logBufferTimeout);
        logBufferTimeout = setTimeout(() => flushLogBuffer(), 100);
    } else {
        if (logBuffer) flushLogBuffer();

        logBuffer = { message, type, playerName, count: 1 };
        logBufferTimeout = setTimeout(() => flushLogBuffer(), 100);
    }
}

function flushLogBuffer() {
    if (!logBuffer || !robloxOutputChannel) return;

    if (logBufferTimeout) {
        clearTimeout(logBufferTimeout);
        logBufferTimeout = null;
    }

    const countStr = logBuffer.count > 1 ? ` (x${logBuffer.count})` : "";
    let typeLabel = "info";
    if (logBuffer.type === 2) typeLabel = "warn";
    else if (logBuffer.type === 3) typeLabel = "error";

    const formattedMsg = `[${typeLabel}] [${logBuffer.playerName}] ${logBuffer.message}${countStr}`;
    robloxOutputChannel.appendLine(formattedMsg);

    // Ensure channel is visible on first logs
    robloxOutputChannel.show(true);

    logBuffer = null;
}

function logToConsole(message: string, type: string = 'info') {
    if (!robloxOutputChannel) return;

    robloxOutputChannel.appendLine(`[${type}] [system] ${message}`);
}

export function deactivate() {
    if (server) {
        server.stop();
    }
    if (robloxOutputChannel) {
        robloxOutputChannel.dispose();
    }
}
