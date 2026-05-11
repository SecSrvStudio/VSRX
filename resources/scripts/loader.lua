local HttpService = game:GetService("HttpService")
local LogService = game:GetService("LogService")
local player = game.Players.LocalPlayer
local playerName = (player and player.Name) or "Server"
local playerUserId = (player and player.UserId) or 0
local baseUrl = getgenv().VSRX_IP 
local execName = tostring((pcall(identifyexecutor) and identifyexecutor()) or "Run")

local function sendLog(msg, msgType)
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
    end)
end

local function hookConsole()
    if getgenv().VSRX_CONSOLE_HOOKED then return end
    getgenv().VSRX_CONSOLE_HOOKED = true
    
    task.spawn(function()
        pcall(function()
            local history = LogService:GetLogHistory()
            for i = 1, #history do
                local log = history[i]
                sendLog(log.message .. " (History)", log.messageType.Value)
            end
        end)
    end)

    LogService.MessageOut:Connect(function(msg, msgType)
        sendLog(msg, msgType.Value)
    end)
    
    sendLog("VSRX Console Hooked (" .. execName .. ")", 1)
end

local function poll()
    local success, responseBody = pcall(function()
        local name = HttpService:UrlEncode(playerName)
        local userId = tostring(playerUserId)
        local encodedExec = HttpService:UrlEncode(execName)
        return game:HttpGet(baseUrl .. "/fetch?name=" .. name .. "&userId=" .. userId .. "&exec=" .. encodedExec)
    end)

    if success and responseBody and #responseBody > 0 then
        local decodeSuccess, data = pcall(function()
            return HttpService:JSONDecode(responseBody)
        end)

        if not decodeSuccess then return end

        local script = data.script
        local config = data.config or {}

        if config.enableConsole then
            hookConsole()
        end

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
                if getgenv().VSRX_UI_LOADED or getgenv().VSRX_LOADING_UI then return end
                getgenv().VSRX_LOADING_UI = true
                
                if not getgenv().Iris then
                    local s1, irisSource = pcall(function() return game:HttpGet("https://raw.githubusercontent.com/x0581/Iris-Exploit-Bundle/main/bundle.lua") end)
                    if s1 and irisSource then
                        local factory, err = loadstring(irisSource)
                        if factory then
                            getgenv().Iris = factory()
                            getgenv().Iris.Init(game:GetService("CoreGui"))
                        end
                    end
                end

                if getgenv().Iris then
                    local s2, menuScript = pcall(function() return game:HttpGet(baseUrl .. "/iris-menu") end)
                    if s2 and menuScript then
                        local func, err = loadstring(menuScript)
                        if func then
                            func()
                            getgenv().VSRX_UI_LOADED = true
                            if config.showUIOnLoad then
                                getgenv().VSRX_States.Opened:set(true)
                            end
                        end
                    end
                end
                getgenv().VSRX_LOADING_UI = false
            end)
        end
    end
end

while task.wait(0.1) do
    poll()
end
