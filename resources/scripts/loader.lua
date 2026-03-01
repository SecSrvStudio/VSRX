local HttpService = game:GetService("HttpService")
local LogService = game:GetService("LogService")
local player = game.Players.LocalPlayer
local playerName = (player and player.Name) or "Server"
local playerUserId = (player and player.UserId) or 0
local baseUrl = getgenv().VSRX_IP 
local execName = tostring((pcall(identifyexecutor) and identifyexecutor()) or "Run")

local function sendLog(msg, msgType)
    if getgenv()._VSRX_LOGGING then return end
    getgenv()._VSRX_LOGGING = true
    
    task.spawn(function()
        pcall(function()
            local payload = HttpService:JSONEncode({
                message = tostring(msg),
                type = tonumber(msgType),
                player = playerName
            })
            
            local req = (getgenv().request or getgenv().http_request or (syn and syn.request))
            if req then
                req({
                    Url = baseUrl .. "/log",
                    Method = "POST",
                    Headers = { ["Content-Type"] = "application/json" },
                    Body = payload
                })
            else
                HttpService:PostAsync(baseUrl .. "/log", payload)
            end
        end)
        getgenv()._VSRX_LOGGING = false
    end)
end

if getgenv()._VSRX_CONSOLE_ENABLED then
    task.spawn(function()
        pcall(function()
            local history = LogService:GetLogHistory()
            for i = math.max(1, #history - 15), #history do
                local log = history[i]
                sendLog(log.message .. " (History)", log.messageType.Value)
            end
        end)
    end)

    LogService.MessageOut:Connect(function(msg, msgType)
        sendLog(msg, msgType.Value)
    end)
end

local function poll()
    local success, responseBody = pcall(function()
        local name = HttpService:UrlEncode(playerName)
        local userId = tostring(playerUserId)
        local encodedExec = HttpService:UrlEncode(execName)
        return game:HttpGet(baseUrl .. "/fetch?name=" .. name .. "&userId=" .. userId .. "&exec=" .. encodedExec)
    end)

    if success and responseBody and #responseBody > 0 then
        local data = HttpService:JSONDecode(responseBody)
        local script = data.script
        local config = data.config or {}

        if script and #script > 0 then
            local func, err = loadstring(script)
            if func then
                task.spawn(func)
            else
                warn("VSRX Load Error: " .. tostring(err))
            end
        end

        if config.enableInternalUI then
            task.spawn(function()
                local menuScript = game:HttpGet(baseUrl .. "/resources/scripts/iris_menu.lua")
                if menuScript then
                    loadstring(menuScript)()
                    if config.showUIOnLoad then
                        getgenv().VSRX_States.Opened:set(true)
                    end
                end
            end)
        end
    end
end

while task.wait(0.1) do
    poll()
end
