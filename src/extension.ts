import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
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
    const sourcePath = editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
    executeRawScript(editor.document.getText(), sourcePath);
}

interface LocalRequireModule {
    id: string;
    filePath: string;
    source: string;
}

interface LocalRequireBundleContext {
    modules: Map<string, LocalRequireModule>;
    resolutions: Map<string, Map<string, string>>;
    workspaceRoots: string[];
    warnings: string[];
    warningKeys: Set<string>;
}

interface LocalRequireBundleResult {
    script: string;
    moduleCount: number;
    warnings: string[];
}

const VSRX_ENTRY_MODULE_ID = '@vsrx/entry';

function executeRawScript(script: string, sourcePath?: string) {
    if (!script.trim()) {
        vscode.window.showErrorMessage('VSRX: Script is empty.');
        return;
    }

    let executableScript = script;
    let bundledModuleCount = 0;
    try {
        const bundled = bundleLocalRequires(script, sourcePath);
        executableScript = bundled.script;
        bundledModuleCount = bundled.moduleCount;

        if (bundled.warnings.length > 0) {
            const preview = bundled.warnings.slice(0, 3).join(' | ');
            vscode.window.showWarningMessage(`VSRX: Some local require paths could not be linked. ${preview}`);
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`VSRX: Failed to prepare local require runtime. ${error.message}`);
        return;
    }

    const payload = JSON.stringify({ script: executableScript });
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
                    const bundleSuffix = bundledModuleCount > 0
                        ? ` (${bundledModuleCount} local module${bundledModuleCount === 1 ? '' : 's'} linked)`
                        : '';
                    notify(`VSRX: Script executed on ${parsed.queued} client(s).${bundleSuffix}`);
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

function bundleLocalRequires(script: string, sourcePath?: string): LocalRequireBundleResult {
    if (!sourcePath) {
        return { script, moduleCount: 0, warnings: [] };
    }

    if (!script.includes('require')) {
        return { script, moduleCount: 0, warnings: [] };
    }

    const entryPath = path.resolve(sourcePath);
    const workspaceRoots = getWorkspaceRootsForFile(entryPath);
    const context: LocalRequireBundleContext = {
        modules: new Map<string, LocalRequireModule>(),
        resolutions: new Map<string, Map<string, string>>(),
        workspaceRoots,
        warnings: [],
        warningKeys: new Set<string>()
    };

    scanLocalRequires(script, entryPath, VSRX_ENTRY_MODULE_ID, context);

    if (context.modules.size === 0) {
        return { script, moduleCount: 0, warnings: context.warnings };
    }

    return {
        script: createLocalRequireBundle(script, context),
        moduleCount: context.modules.size,
        warnings: context.warnings
    };
}

function scanLocalRequires(source: string, importerPath: string, callerId: string, context: LocalRequireBundleContext) {
    const requests = findStaticRequireRequests(source);
    if (requests.length === 0) {
        return;
    }

    const callerResolutions = getOrCreateResolutionMap(context, callerId);

    for (const request of requests) {
        if (!isLocalRequirePath(request)) {
            continue;
        }

        const resolvedPath = resolveLocalRequirePath(request, importerPath, context.workspaceRoots);
        if (!resolvedPath) {
            if (isExplicitRelativeRequirePath(request)) {
                addBundleWarning(context, `Cannot resolve '${request}' from '${toModuleId(importerPath, context.workspaceRoots)}'`);
            }
            continue;
        }

        const moduleId = toModuleId(resolvedPath, context.workspaceRoots);
        callerResolutions.set(request, moduleId);

        const moduleKey = canonicalFileKey(resolvedPath);
        if (context.modules.has(moduleKey)) {
            continue;
        }

        const moduleSource = readLocalScriptFile(resolvedPath);
        context.modules.set(moduleKey, {
            id: moduleId,
            filePath: resolvedPath,
            source: moduleSource
        });

        scanLocalRequires(moduleSource, resolvedPath, moduleId, context);
    }
}

function findStaticRequireRequests(source: string): string[] {
    const requests: string[] = [];
    let index = 0;

    while (index < source.length) {
        const skippedSyntax = skipLuaIgnoredSyntax(source, index);
        if (skippedSyntax > index) {
            index = skippedSyntax;
            continue;
        }

        if (!isRequireIdentifierAt(source, index)) {
            index++;
            continue;
        }

        let cursor = index + 'require'.length;
        cursor = skipLuaWhitespaceAndComments(source, cursor);

        const directString = parseLuaStringAt(source, cursor);
        if (directString) {
            requests.push(directString.value);
            index = directString.end;
            continue;
        }

        if (source[cursor] !== '(') {
            index++;
            continue;
        }

        cursor = skipLuaWhitespaceAndComments(source, cursor + 1);
        const parsedString = parseLuaStringAt(source, cursor);
        if (!parsedString) {
            index++;
            continue;
        }

        cursor = skipLuaWhitespaceAndComments(source, parsedString.end);
        if (source[cursor] === ')') {
            requests.push(parsedString.value);
            index = cursor + 1;
            continue;
        }

        index++;
    }

    return requests;
}

interface ParsedLuaString {
    value: string;
    end: number;
}

interface LuaLongBracketStart {
    equals: string;
    contentStart: number;
}

function isRequireIdentifierAt(source: string, index: number): boolean {
    if (!source.startsWith('require', index)) {
        return false;
    }

    const before = index > 0 ? source[index - 1] : '';
    const after = source[index + 'require'.length] ?? '';

    return !isLuaIdentifierCharacter(before)
        && before !== '.'
        && before !== ':'
        && !isLuaIdentifierCharacter(after);
}

function isLuaIdentifierCharacter(character: string): boolean {
    return /^[A-Za-z0-9_]$/.test(character);
}

function skipLuaIgnoredSyntax(source: string, index: number): number {
    if (source.startsWith('--', index)) {
        return skipLuaComment(source, index);
    }

    const character = source[index];
    if (character === '"' || character === "'") {
        return parseLuaQuotedStringAt(source, index)?.end ?? source.length;
    }

    const longBracket = readLuaLongBracketStart(source, index);
    if (longBracket) {
        return findLuaLongBracketEnd(source, longBracket);
    }

    return index;
}

function skipLuaWhitespaceAndComments(source: string, index: number): number {
    let cursor = index;

    while (cursor < source.length) {
        while (cursor < source.length && /\s/.test(source[cursor])) {
            cursor++;
        }

        if (source.startsWith('--', cursor)) {
            cursor = skipLuaComment(source, cursor);
            continue;
        }

        break;
    }

    return cursor;
}

function skipLuaComment(source: string, index: number): number {
    const longBracket = readLuaLongBracketStart(source, index + 2);
    if (longBracket) {
        return findLuaLongBracketEnd(source, longBracket);
    }

    const lineEnd = source.indexOf('\n', index + 2);
    return lineEnd === -1 ? source.length : lineEnd + 1;
}

function parseLuaStringAt(source: string, index: number): ParsedLuaString | null {
    const character = source[index];
    if (character === '"' || character === "'") {
        return parseLuaQuotedStringAt(source, index);
    }

    const longBracket = readLuaLongBracketStart(source, index);
    if (!longBracket) {
        return null;
    }

    const closingIndex = findLuaLongBracketClosingIndex(source, longBracket);
    const contentEnd = closingIndex === -1 ? source.length : closingIndex;
    const end = closingIndex === -1 ? source.length : closingIndex + longBracket.equals.length + 2;
    return {
        value: source.slice(longBracket.contentStart, contentEnd),
        end
    };
}

function parseLuaQuotedStringAt(source: string, index: number): ParsedLuaString | null {
    const quote = source[index];
    let cursor = index + 1;
    let value = '';

    while (cursor < source.length) {
        const character = source[cursor];

        if (character === quote) {
            return { value, end: cursor + 1 };
        }

        if (character === '\\') {
            const escape = readLuaEscape(source, cursor);
            value += escape.value;
            cursor = escape.end;
            continue;
        }

        value += character;
        cursor++;
    }

    return null;
}

function readLuaEscape(source: string, index: number): ParsedLuaString {
    const escaped = source[index + 1];

    if (!escaped) {
        return { value: '\\', end: index + 1 };
    }

    const escapes: { [key: string]: string } = {
        '\\': '\\',
        '"': '"',
        "'": "'",
        a: '\x07',
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
        v: '\x0b'
    };

    if (escapes[escaped] !== undefined) {
        return { value: escapes[escaped], end: index + 2 };
    }

    if (escaped === '\r' || escaped === '\n') {
        const end = escaped === '\r' && source[index + 2] === '\n' ? index + 3 : index + 2;
        return { value: '', end };
    }

    if (escaped === 'z') {
        let cursor = index + 2;
        while (cursor < source.length && /\s/.test(source[cursor])) {
            cursor++;
        }
        return { value: '', end: cursor };
    }

    if (escaped === 'x') {
        const hex = source.slice(index + 2, index + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
            return { value: String.fromCharCode(parseInt(hex, 16)), end: index + 4 };
        }
    }

    if (escaped === 'u' && source[index + 2] === '{') {
        const endBrace = source.indexOf('}', index + 3);
        if (endBrace !== -1) {
            const codePoint = source.slice(index + 3, endBrace);
            if (/^[0-9a-fA-F]+$/.test(codePoint)) {
                return { value: String.fromCodePoint(parseInt(codePoint, 16)), end: endBrace + 1 };
            }
        }
    }

    if (/\d/.test(escaped)) {
        const decimal = source.slice(index + 1).match(/^\d{1,3}/)?.[0] ?? escaped;
        return { value: String.fromCharCode(parseInt(decimal, 10)), end: index + 1 + decimal.length };
    }

    return { value: escaped, end: index + 2 };
}

function readLuaLongBracketStart(source: string, index: number): LuaLongBracketStart | null {
    if (source[index] !== '[') {
        return null;
    }

    let cursor = index + 1;
    while (source[cursor] === '=') {
        cursor++;
    }

    if (source[cursor] !== '[') {
        return null;
    }

    return {
        equals: source.slice(index + 1, cursor),
        contentStart: cursor + 1
    };
}

function findLuaLongBracketEnd(source: string, bracket: LuaLongBracketStart): number {
    const closingIndex = findLuaLongBracketClosingIndex(source, bracket);
    return closingIndex === -1 ? source.length : closingIndex + bracket.equals.length + 2;
}

function findLuaLongBracketClosingIndex(source: string, bracket: LuaLongBracketStart): number {
    const closing = `]${bracket.equals}]`;
    return source.indexOf(closing, bracket.contentStart);
}

function isLocalRequirePath(request: string): boolean {
    const normalized = request.replace(/\\/g, '/');
    return isExplicitRelativeRequirePath(request)
        || normalized.includes('/');
}

function isExplicitRelativeRequirePath(request: string): boolean {
    const normalized = request.replace(/\\/g, '/');
    return normalized.startsWith('./')
        || normalized.startsWith('../')
        || normalized.startsWith('/')
        || /^[a-zA-Z]:\//.test(normalized);
}

function resolveLocalRequirePath(request: string, importerPath: string, workspaceRoots: string[]): string | null {
    const candidates: string[] = [];
    const normalizedRequest = request.replace(/\\/g, '/');
    const requestAsPath = normalizedRequest.replace(/\//g, path.sep);

    if (/^[a-zA-Z]:\//.test(normalizedRequest) || (path.isAbsolute(requestAsPath) && !normalizedRequest.startsWith('/'))) {
        candidates.push(path.resolve(requestAsPath));
    } else if (normalizedRequest.startsWith('/')) {
        const projectRelativePath = normalizedRequest.replace(/^\/+/, '').replace(/\//g, path.sep);
        for (const root of workspaceRoots) {
            candidates.push(path.resolve(root, projectRelativePath));
        }
    } else {
        candidates.push(path.resolve(path.dirname(importerPath), requestAsPath));
        for (const root of workspaceRoots) {
            candidates.push(path.resolve(root, requestAsPath));
        }
    }

    for (const candidate of uniquePaths(candidates)) {
        const resolved = resolveScriptFile(candidate);
        if (resolved && isPathInsideAnyRoot(resolved, workspaceRoots)) {
            return resolved;
        }
    }

    return null;
}

function resolveScriptFile(basePath: string): string | null {
    const extension = path.extname(basePath).toLowerCase();
    const candidates = extension === '.lua' || extension === '.luau'
        ? [basePath]
        : [
            `${basePath}.luau`,
            `${basePath}.lua`,
            path.join(basePath, 'init.luau'),
            path.join(basePath, 'init.lua')
        ];

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                return path.resolve(candidate);
            }
        } catch {
            // Ignore inaccessible candidates and continue trying the rest.
        }
    }

    return null;
}

function readLocalScriptFile(filePath: string): string {
    const openDocument = vscode.workspace.textDocuments.find(document =>
        document.uri.scheme === 'file' && canonicalFileKey(document.uri.fsPath) === canonicalFileKey(filePath)
    );

    if (openDocument) {
        return openDocument.getText();
    }

    return fs.readFileSync(filePath, 'utf8');
}

function createLocalRequireBundle(entryScript: string, context: LocalRequireBundleContext): string {
    const modules = Array.from(context.modules.values());
    const moduleSources = [
        `local __vsrx_module_sources = {`,
        ...modules.map(module => `    [${toLuaString(module.id)}] = ${toLuaString(module.source)},`),
        `}`
    ].join('\n');

    return [
        `-- VSRX local require runtime (generated by VS Code)`,
        `return (function()`,
        `local __vsrx_native_require = require`,
        `local __vsrx_entry_source = ${toLuaString(entryScript)}`,
        moduleSources,
        createResolutionTable(context),
        `local __vsrx_cache = {}`,
        `local __vsrx_base_env = (getfenv and getfenv(0)) or (getgenv and getgenv()) or _G`,
        `local __vsrx_require_from`,
        ``,
        `local function __vsrx_load_source(__vsrx_source, __vsrx_name)`,
        `    local __vsrx_fn, __vsrx_err`,
        `    local __vsrx_loaded = pcall(function()`,
        `        __vsrx_fn, __vsrx_err = loadstring(__vsrx_source, "=" .. tostring(__vsrx_name))`,
        `    end)`,
        `    if (not __vsrx_loaded) or (not __vsrx_fn) then`,
        `        __vsrx_fn, __vsrx_err = loadstring(__vsrx_source)`,
        `    end`,
        `    if not __vsrx_fn then`,
        `        error("VSRX local require compile error in " .. tostring(__vsrx_name) .. ": " .. tostring(__vsrx_err), 2)`,
        `    end`,
        `    return __vsrx_fn`,
        `end`,
        ``,
        `local function __vsrx_make_env(__vsrx_caller)`,
        `    local __vsrx_scoped_require = function(__vsrx_target)`,
        `        return __vsrx_require_from(__vsrx_caller, __vsrx_target)`,
        `    end`,
        `    local __vsrx_env = {}`,
        `    setmetatable(__vsrx_env, {`,
        `        __index = function(_, __vsrx_key)`,
        `            if __vsrx_key == "require" then`,
        `                return __vsrx_scoped_require`,
        `            end`,
        `            return __vsrx_base_env[__vsrx_key]`,
        `        end,`,
        `        __newindex = function(_, __vsrx_key, __vsrx_value)`,
        `            __vsrx_base_env[__vsrx_key] = __vsrx_value`,
        `        end`,
        `    })`,
        `    return __vsrx_env`,
        `end`,
        ``,
        `local function __vsrx_run_source(__vsrx_caller, __vsrx_source)`,
        `    local __vsrx_fn = __vsrx_load_source(__vsrx_source, __vsrx_caller)`,
        `    local __vsrx_env = __vsrx_make_env(__vsrx_caller)`,
        `    if setfenv then`,
        `        setfenv(__vsrx_fn, __vsrx_env)`,
        `        return __vsrx_fn()`,
        `    end`,
        ``,
        `    local __vsrx_previous_require = __vsrx_base_env.require`,
        `    __vsrx_base_env.require = __vsrx_env.require`,
        `    local __vsrx_ok, __vsrx_value = pcall(__vsrx_fn)`,
        `    __vsrx_base_env.require = __vsrx_previous_require`,
        `    if not __vsrx_ok then`,
        `        error("VSRX local require runtime error in " .. tostring(__vsrx_caller) .. ": " .. tostring(__vsrx_value), 2)`,
        `    end`,
        `    return __vsrx_value`,
        `end`,
        ``,
        `function __vsrx_require_from(__vsrx_caller, __vsrx_target)`,
        `    if type(__vsrx_target) ~= "string" then`,
        `        return __vsrx_native_require(__vsrx_target)`,
        `    end`,
        ``,
        `    local __vsrx_by_caller = __vsrx_resolve[__vsrx_caller]`,
        `    local __vsrx_module_id = __vsrx_by_caller and __vsrx_by_caller[__vsrx_target] or nil`,
        `    if not __vsrx_module_id then`,
        `        return __vsrx_native_require(__vsrx_target)`,
        `    end`,
        ``,
        `    local __vsrx_cached = __vsrx_cache[__vsrx_module_id]`,
        `    if __vsrx_cached then`,
        `        if __vsrx_cached.loading then`,
        `            error("VSRX local require: circular require detected for " .. tostring(__vsrx_module_id), 2)`,
        `        end`,
        `        return __vsrx_cached.value`,
        `    end`,
        ``,
        `    local __vsrx_source = __vsrx_module_sources[__vsrx_module_id]`,
        `    if not __vsrx_source then`,
        `        error("VSRX local require: module source was not linked: " .. tostring(__vsrx_module_id), 2)`,
        `    end`,
        ``,
        `    local __vsrx_entry = { loading = true, value = nil }`,
        `    __vsrx_cache[__vsrx_module_id] = __vsrx_entry`,
        ``,
        `    local __vsrx_ok, __vsrx_value = pcall(__vsrx_run_source, __vsrx_module_id, __vsrx_source)`,
        `    if not __vsrx_ok then`,
        `        __vsrx_cache[__vsrx_module_id] = nil`,
        `        error(__vsrx_value, 2)`,
        `    end`,
        ``,
        `    __vsrx_entry.loading = false`,
        `    __vsrx_entry.value = __vsrx_value`,
        `    return __vsrx_value`,
        `end`,
        ``,
        `return __vsrx_run_source(${toLuaString(VSRX_ENTRY_MODULE_ID)}, __vsrx_entry_source)`,
        `end)()`
    ].join('\n');
}

function createResolutionTable(context: LocalRequireBundleContext): string {
    const lines = [`local __vsrx_resolve = {`];

    for (const [callerId, resolutions] of context.resolutions.entries()) {
        if (resolutions.size === 0) {
            continue;
        }

        lines.push(`    [${toLuaString(callerId)}] = {`);
        for (const [request, moduleId] of resolutions.entries()) {
            lines.push(`        [${toLuaString(request)}] = ${toLuaString(moduleId)},`);
        }
        lines.push(`    },`);
    }

    lines.push(`}`);
    return lines.join('\n');
}

function getOrCreateResolutionMap(context: LocalRequireBundleContext, callerId: string): Map<string, string> {
    let resolutions = context.resolutions.get(callerId);
    if (!resolutions) {
        resolutions = new Map<string, string>();
        context.resolutions.set(callerId, resolutions);
    }
    return resolutions;
}

function getWorkspaceRootsForFile(filePath: string): string[] {
    const roots: string[] = [];
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));

    if (workspaceFolder) {
        pushUniquePath(roots, workspaceFolder.uri.fsPath);
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        pushUniquePath(roots, folder.uri.fsPath);
    }

    if (roots.length === 0) {
        pushUniquePath(roots, path.dirname(filePath));
    }

    return roots;
}

function isPathInsideAnyRoot(filePath: string, roots: string[]): boolean {
    return roots.some(root => isPathInsideRoot(filePath, root));
}

function isPathInsideRoot(filePath: string, root: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(filePath));
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function toModuleId(filePath: string, roots: string[]): string {
    const root = roots.find(candidate => isPathInsideRoot(filePath, candidate));
    const relativePath = root ? path.relative(root, filePath) : path.basename(filePath);
    return relativePath.replace(/\\/g, '/');
}

function addBundleWarning(context: LocalRequireBundleContext, message: string) {
    if (context.warningKeys.has(message)) {
        return;
    }

    context.warningKeys.add(message);
    context.warnings.push(message);
}

function uniquePaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];

    for (const candidate of paths) {
        const key = canonicalFileKey(candidate);
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        unique.push(candidate);
    }

    return unique;
}

function pushUniquePath(paths: string[], value: string) {
    const key = canonicalFileKey(value);
    if (!paths.some(existing => canonicalFileKey(existing) === key)) {
        paths.push(path.resolve(value));
    }
}

function canonicalFileKey(filePath: string): string {
    return path.resolve(filePath).toLowerCase();
}

function toLuaString(value: string): string {
    return `"${value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, character => {
            return `\\${character.charCodeAt(0).toString().padStart(3, '0')}`;
        })}"`;
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
                const scriptPath = (selected as any).fullPath;
                const scriptContent = fs.readFileSync(scriptPath, 'utf8');
                executeRawScript(scriptContent, scriptPath);
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
