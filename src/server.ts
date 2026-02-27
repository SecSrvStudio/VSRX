import * as http from 'http';
import * as os from 'os';

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

export class VSRXServer {
    private server: http.Server;
    public connectedClients = new Map<string, ClientInfo>();
    private cachedLocalIP: string | null = null;
    readonly port = 3000;

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
        this.server.listen(this.port, '0.0.0.0', () => {
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

    private getLocalExternalIP(): string {
        if (this.cachedLocalIP) return this.cachedLocalIP;
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            const ifaceList = interfaces[name];
            if (ifaceList) {
                for (const iface of ifaceList) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        this.cachedLocalIP = iface.address;
                        return this.cachedLocalIP;
                    }
                }
            }
        }
        return '127.0.0.1';
    }

    public getLoaderScript(): string {
        const ip = this.getLocalExternalIP();
        return `-- VSRX Master Loader\ngetgenv().VSRX_IP = "http://${ip}:${this.port}"\nloadstring(game:HttpGet(getgenv().VSRX_IP .. "/loader"))()`;
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
                res.setHeader('Content-Type', 'text/plain');
                const script = client.pendingScript || '';
                client.pendingScript = null;
                res.end(script);
                return;
            }

            if (url.pathname === '/loader') {
                const host = req.headers.host || `${this.getLocalExternalIP()}:${this.port}`;
                const loader = `-- VSRX External Loader
local HttpService = game:GetService("HttpService")
local player = game.Players.LocalPlayer
local baseUrl = "http://${host}"
local execName = tostring((pcall(identifyexecutor) and identifyexecutor()) or "Run")

local function poll()
    local success, script = pcall(function()
        local name = HttpService:UrlEncode(player.Name)
        local userId = tostring(player.UserId)
        local encodedExec = HttpService:UrlEncode(execName)
        return game:HttpGet(baseUrl .. "/fetch?name=" .. name .. "&userId=" .. userId .. "&exec=" .. encodedExec)
    end)
    if success and script and #script > 0 then
        local func, err = loadstring(script)
        if func then
            task.spawn(func)
        else
            warn("VSRX Load Error: " .. tostring(err))
        end
    end
end

while task.wait(0.1) do
    poll()
end`;
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/plain');
                res.end(loader);
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
