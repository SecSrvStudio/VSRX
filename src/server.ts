import * as http from 'http';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

interface ClientInfo {
    name: string;
    userId: string;
    startTime: number;
    lastSeen: number;
    ip: string;
    pendingScript: string | null;
    executorName: string | null;
    executionEnabled: boolean;
}

export interface LogEntry {
    message: string;
    type: number;
    playerName: string;
}

export class VSRXServer {
    private server: http.Server;
    public connectedClients = new Map<string, ClientInfo>();
    private cachedLocalIP: string | null = null;
    readonly port = 6732;
    public onLogReceived: ((log: LogEntry) => void) | null = null;
    public consoleEnabled = true;
    public internalUIEnabled = false;
    public showUIOnLoad = false;
    public defaultSavePath = "";

    constructor() {
        this.server = http.createServer((req, res) => this.handleRequest(req, res));

        setInterval(() => {
            const now = Date.now();
            for (const [id, data] of this.connectedClients) {
                if (now - data.lastSeen > 3000) {
                    this.connectedClients.delete(id);
                }
            }
        }, 5000);
    }

    public start() {
        this.server.listen(this.port, '127.0.0.1', () => {
            console.log(`VSRX Server listening on port ${this.port}`);
        });
    }

    public stop() {
        this.server.close();
    }

    public hasClients(): boolean {
        return this.connectedClients.size > 0;
    }

    public getExecutorName(): string {
        for (const client of this.connectedClients.values()) {
            if (client.executorName) {
                return client.executorName;
            }
        }
        return "Inject";
    }

    public getLoaderScript(): string {
        return `-- VSRX Smart Master Loader
local ips = { "http://127.0.0.1:${this.port}", "http://10.0.2.2:${this.port}" }
local connected = false

task.spawn(function()
    while not connected do
        for _, ip in ipairs(ips) do
            local s, r = pcall(function() return game:HttpGet(ip .. "/") end)
            if s and r and r:find("VSRX") then
                getgenv().VSRX_IP = ip
                connected = true
                local ok, loaderSource = pcall(function()
                    return game:HttpGet(getgenv().VSRX_IP .. "/loader")
                end)
                if ok and loaderSource then
                    local fn, err = loadstring(loaderSource)
                    if fn then
                        fn()
                    else
                        warn("VSRX: Loader compile failed: " .. tostring(err))
                    end
                end
                break
            end
        end
        if not connected then
            task.wait(1)
        end
    end
end)`;
    }

    public setClientExecution(clientId: string, enabled: boolean) {
        const client = this.connectedClients.get(clientId);
        if (client) {
            client.executionEnabled = enabled;
        }
    }

    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
        }

        const hostHeader = req.headers.host || 'localhost';
        const url = new URL(req.url || '/', `http://${hostHeader}`);

        if (req.method === 'GET') {
            if (url.pathname === '/') {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html');
                res.end('<h1>VSRX Server is Online!</h1><p>You can execute scripts from VS Code now.</p>');
                return;
            }

            if (url.pathname === '/status') {
                const data = Array.from(this.connectedClients.entries()).map(([key, c]) => ({
                    id: key,
                    name: c.name,
                    userId: c.userId,
                    startTime: c.startTime,
                    ip: c.ip,
                    executorName: c.executorName,
                    executionEnabled: c.executionEnabled
                }));
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ clients: data.length, list: data }));
                return;
            }

            if (url.pathname === '/fetch') {
                const clientIP = req.socket.remoteAddress || 'unknown';
                const name = url.searchParams.get('name') || 'Unknown';
                const userId = url.searchParams.get('userId') || '0';
                const executorName = url.searchParams.get('exec') || null;
                const clientKey = userId !== '0' ? userId : clientIP;

                let client = this.connectedClients.get(clientKey);
                if (!client) {
                    client = {
                        name,
                        userId,
                        startTime: Date.now(),
                        lastSeen: Date.now(),
                        ip: clientIP,
                        pendingScript: null,
                        executorName: executorName !== 'null' ? executorName : null,
                        executionEnabled: true
                    };
                    this.connectedClients.set(clientKey, client);
                } else {
                    client.lastSeen = Date.now();
                    client.name = name;
                    if (executorName && executorName !== 'null') {
                        client.executorName = executorName;
                    }
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                const script = client.pendingScript || '';
                client.pendingScript = null;

                const responseData = {
                    script: script,
                    config: {
                        enableConsole: this.consoleEnabled,
                        enableInternalUI: this.internalUIEnabled,
                        showUIOnLoad: this.showUIOnLoad
                    }
                };
                res.end(JSON.stringify(responseData));
                return;
            }

            if (url.pathname === '/saved-scripts') {
                if (!this.defaultSavePath || !fs.existsSync(this.defaultSavePath)) {
                    res.statusCode = 200;
                    res.end(JSON.stringify([]));
                    return;
                }
                try {
                    const files = fs.readdirSync(this.defaultSavePath)
                        .filter(f => f.endsWith('.lua') || f.endsWith('.txt'))
                        .filter(f => !fs.statSync(path.join(this.defaultSavePath, f)).isDirectory());
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(files));
                } catch (e) {
                    res.statusCode = 500;
                    res.end('[]');
                }
                return;
            }

            if (url.pathname === '/execute-saved') {
                const fileName = url.searchParams.get('name');
                if (fileName && this.defaultSavePath) {
                    const filePath = path.join(this.defaultSavePath, fileName);
                    if (fs.existsSync(filePath)) {
                        try {
                            const content = fs.readFileSync(filePath, 'utf8');
                            for (const client of this.connectedClients.values()) {
                                if (client.executionEnabled) {
                                    client.pendingScript = content;
                                }
                            }
                            res.statusCode = 200;
                            res.end('Executed');
                        } catch (e) {
                            res.statusCode = 500;
                            res.end('Error reading file');
                        }
                    } else {
                        res.statusCode = 404;
                        res.end('File not found');
                    }
                } else {
                    res.statusCode = 400;
                    res.end('Missing name');
                }
                return;
            }

            if (url.pathname === '/iris-menu') {
                try {
                    const scriptPath = path.join(__dirname, '..', 'resources', 'scripts', 'iris_menu.lua');
                    if (fs.existsSync(scriptPath)) {
                        const content = fs.readFileSync(scriptPath, 'utf8');
                        res.statusCode = 200;
                        res.setHeader('Content-Type', 'text/plain');
                        res.end(content);
                    } else {
                        res.statusCode = 404;
                        res.end('-- Iris menu script not found on server');
                    }
                } catch (e) {
                    res.statusCode = 500;
                    res.end('-- Error loading Iris menu script');
                }
                return;
            }

            if (url.pathname === '/loader') {
                try {
                    const host = req.headers.host || `127.0.0.1:${this.port}`;
                    const scriptPath = path.join(__dirname, '..', 'resources', 'scripts', 'loader.lua');
                    if (fs.existsSync(scriptPath)) {
                        let content = fs.readFileSync(scriptPath, 'utf8');

                        // Simple baseUrl injection (fallback only)
                        content = content.replace(/local baseUrl = getgenv\(\)\.VSRX_IP\s*/, `local baseUrl = getgenv().VSRX_IP or "http://${host}"\n`);

                        // All other configs are handled via /fetch JSON poll

                        res.statusCode = 200;
                        res.setHeader('Content-Type', 'text/plain');
                        res.end(content);
                    } else {
                        res.statusCode = 404;
                        res.end('-- Loader script not found on server');
                    }
                } catch (e) {
                    res.statusCode = 500;
                    res.end('-- Error loading loader script');
                }
                return;
            }
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                if (url.pathname === '/execute') {
                    try {
                        const data = JSON.parse(body);
                        const script = data.script;
                        let executedCount = 0;
                        for (const client of this.connectedClients.values()) {
                            if (client.executionEnabled) {
                                client.pendingScript = script;
                                executedCount++;
                            }
                        }
                        res.statusCode = 200;
                        res.end(JSON.stringify({ queued: executedCount }));
                    } catch (e) {
                        res.statusCode = 400;
                        res.end('Invalid JSON');
                    }
                } else if (url.pathname === '/log') {
                    try {
                        const data = JSON.parse(body);
                        if (this.onLogReceived) {
                            this.onLogReceived({
                                message: data.message,
                                type: data.type,
                                playerName: data.player
                            });
                        }
                        res.statusCode = 200;
                        res.end('OK');
                    } catch (e) {
                        res.statusCode = 400;
                        res.end('Invalid JSON');
                    }
                } else if (url.pathname === '/toggle') {
                    try {
                        const data = JSON.parse(body);
                        const clientId = data.id;
                        const enabled = data.enabled;
                        this.setClientExecution(clientId, enabled);
                        res.statusCode = 200;
                        res.end('Toggled');
                    } catch (e) {
                        res.statusCode = 400;
                        res.end('Invalid JSON');
                    }
                } else {
                    res.statusCode = 404;
                    res.end('Not Found');
                }
            });
            return;
        }

        if (req.method !== 'POST') {
            res.statusCode = 404;
            res.end('Not Found');
        }
    }
}
