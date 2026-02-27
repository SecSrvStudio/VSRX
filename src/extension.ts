import * as vscode from 'vscode';
import * as http from 'http';
import { VSRXServer } from './server';

let server: VSRXServer;
let statusBarItem: vscode.StatusBarItem;
let runButton: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    server = new VSRXServer();
    server.start();

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
                vscode.window.showInformationMessage('VSRX: Loader script copied! Execute this in your executor first.');
            }
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

    setInterval(() => updateStatusBar(), 500);
}

function updateStatusBar() {
    if (!server) return;

    const count = server.connectedClients.size;
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

        // Toggle the state directly on the server instance
        server.setClientExecution(clientId, !currentEnabled);
        vscode.window.showInformationMessage(`VSRX: Client '${selected.label.split(' ')[1]}' execution is now ${!currentEnabled ? 'ON' : 'OFF'}`);
    }
}

function runScript() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('VSRX: No active script to run.');
        return;
    }

    const script = editor.document.getText();
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
                    vscode.window.showInformationMessage(`VSRX: Script executed on ${parsed.queued} client(s).`);
                } catch {
                    vscode.window.showInformationMessage('VSRX: Script executed successfully.');
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

export function deactivate() {
    if (server) {
        server.stop();
    }
}
