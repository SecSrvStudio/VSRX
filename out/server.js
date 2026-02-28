"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VSRXServer = void 0;
const http = require("http");
class VSRXServer {
    constructor() {
        this.connectedClients = new Map();
        this.cachedLocalIP = null;
        this.port = 6732;
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
    start() {
        this.server.listen(this.port, '127.0.0.1', () => {
            console.log(`VSRX Server listening on port ${this.port}`);
        });
    }
    stop() {
        this.server.close();
    }
    hasClients() {
        return this.connectedClients.size > 0;
    }
    getExecutorName() {
        for (const client of this.connectedClients.values()) {
            if (client.executorName) {
                return client.executorName;
            }
        }
        return "Inject";
    }
    getLoaderScript() {
        return `-- VSRX Smart Master Loader
local ips = { "http://127.0.0.1:${this.port}", "http://10.0.2.2:${this.port}" }
local found = false
for _, ip in ipairs(ips) do
    local s, r = pcall(function() return game:HttpGet(ip .. "/") end)
    if s and r:find("VSRX") then 
        getgenv().VSRX_IP = ip 
        found = true 
        break 
    end
end
if found then 
    loadstring(game:HttpGet(getgenv().VSRX_IP .. "/loader"))() 
else 
    warn("VSRX: Could not connect to any server IP.") 
end`;
    }
    setClientExecution(clientId, enabled) {
        const client = this.connectedClients.get(clientId);
        if (client) {
            client.executionEnabled = enabled;
        }
    }
    handleRequest(req, res) {
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
                }
                else {
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
                const host = req.headers.host || `127.0.0.1:${this.port}`;
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
                    }
                    catch (e) {
                        res.statusCode = 400;
                        res.end('Invalid JSON');
                    }
                }
                else if (url.pathname === '/toggle') {
                    try {
                        const data = JSON.parse(body);
                        const clientId = data.id;
                        const enabled = data.enabled;
                        this.setClientExecution(clientId, enabled);
                        res.statusCode = 200;
                        res.end('Toggled');
                    }
                    catch (e) {
                        res.statusCode = 400;
                        res.end('Invalid JSON');
                    }
                }
                else {
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
exports.VSRXServer = VSRXServer;
//# sourceMappingURL=server.js.map