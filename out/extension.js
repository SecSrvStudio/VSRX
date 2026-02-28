"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const http = require("http");
const fs = require("fs");
const path = require("path");
const server_1 = require("./server");
let server;
let statusBarItem;
let runButton;
let savedScriptsButton;
function notify(msg) {
    const config = vscode.workspace.getConfiguration('vsrx');
    if (config.get('showNotifications') !== false) {
        vscode.window.showInformationMessage(msg);
    }
}
function activate(context) {
    server = new server_1.VSRXServer();
    server.start();
    context.subscriptions.push(vscode.commands.registerCommand('vsrx.showClients', async () => {
        await showClientsMenu();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vsrx.runScript', () => {
        if (server.hasClients()) {
            runScript();
        }
        else {
            const loader = server.getLoaderScript();
            vscode.env.clipboard.writeText(loader);
            notify('VSRX: Loader script copied! Execute this in your executor first.');
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vsrx.saveScript', async () => {
        await saveScript();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vsrx.showSavedScripts', async () => {
        await showSavedScripts();
    }));
    savedScriptsButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    savedScriptsButton.text = `$(folder-library) Saved Scripts`;
    savedScriptsButton.tooltip = "VSRX: View and Run Saved Scripts";
    savedScriptsButton.command = 'vsrx.showSavedScripts';
    savedScriptsButton.show();
    context.subscriptions.push(savedScriptsButton);
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
    setInterval(() => updateStatusBar(), 500);
}
exports.activate = activate;
function updateStatusBar() {
    if (!server)
        return;
    const count = server.connectedClients.size;
    if (count > 0) {
        statusBarItem.text = `$(versions) ${count} Client${count !== 1 ? 's' : ''}`;
        runButton.text = `$(play) ${server.getExecutorName()}`;
        runButton.color = new vscode.ThemeColor('testing.iconPassed');
    }
    else {
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
    const items = [];
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
        // Toggle the state directly on the server instance
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
    executeRawScript(editor.document.getText());
}
function executeRawScript(script) {
    if (!script.trim()) {
        vscode.window.showErrorMessage('VSRX: Script is empty.');
        return;
    }
    const payload = JSON.stringify({ script });
    const requestOptions = {
        hostname: '127.0.0.1',
        port: 3000,
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
                }
                catch {
                    notify('VSRX: Script executed successfully.');
                }
            }
            else {
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
    const defaultPath = config.get('defaultSavePath');
    if (defaultPath && defaultPath.trim() !== "") {
        try {
            let finalPath = defaultPath;
            if (!path.extname(finalPath)) {
                const fileName = await vscode.window.showInputBox({
                    prompt: 'Enter script name',
                    value: `vsrx_script_${Date.now()}.lua`
                });
                if (!fileName)
                    return; // User cancelled
                finalPath = path.join(finalPath, fileName.endsWith('.lua') || fileName.endsWith('.luau') ? fileName : `${fileName}.lua`);
            }
            fs.writeFileSync(finalPath, script, 'utf8');
            notify(`VSRX: Script saved to ${finalPath}`);
            return;
        }
        catch (error) {
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
        }
        catch (error) {
            vscode.window.showErrorMessage(`VSRX: Could not save file. Error: ${error.message}`);
        }
    }
}
async function showSavedScripts() {
    const config = vscode.workspace.getConfiguration('vsrx');
    const defaultPath = config.get('defaultSavePath');
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
        const items = files.map(file => {
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
                vscode.env.openExternal(vscode.Uri.file(selected.fullPath));
            }
            else {
                const scriptContent = fs.readFileSync(selected.fullPath, 'utf8');
                executeRawScript(scriptContent);
            }
        }
    }
    catch (e) {
        vscode.window.showErrorMessage(`VSRX: Failed to read directory. Error: ${e.message}`);
    }
}
function deactivate() {
    if (server) {
        server.stop();
    }
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map