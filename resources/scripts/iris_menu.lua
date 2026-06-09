local Iris = getgenv().Iris
if not Iris then
    warn("VSRX: Iris library not found. Menu script aborted.")
    return
end
local HttpService = game:GetService("HttpService")
local baseUrl = getgenv().VSRX_IP 
local UserInputService = game:GetService("UserInputService")

if not getgenv().VSRX_States then
    getgenv().VSRX_States = {
        Opened = Iris.State(false), 
        Code = Iris.State("-- VSRX Executor Ready")
    }
end

local States = getgenv().VSRX_States

if not getgenv()._VSRX_F1_CONNECTED then
    getgenv()._VSRX_F1_CONNECTED = true
    UserInputService.InputBegan:Connect(function(input, processed)
        if not processed and input.KeyCode == Enum.KeyCode.F1 then
            States.Opened:set(not States.Opened:get())
        end
    end)
end

Iris:Connect(function()
    if States.Opened:get() then
        local ok, err = pcall(function()
            local window = Iris.Window({"VSRX Executor [F1]", [Iris.Args.Window.NoClose] = true}, {size = Iris.State(Vector2.new(450, 360))})
                
                Iris.PushConfig({
                    ItemSpacing = Vector2.new(8, 0),
                    Button = Color3.fromRGB(40, 40, 50),
                    ButtonHovered = Color3.fromRGB(50, 50, 65),
                    ButtonActive = Color3.fromRGB(60, 60, 80)
                })
                Iris.SameLine()
                    Iris.PushConfig({
                        TextColor = Color3.fromRGB(255, 255, 255),
                        Button = Color3.fromRGB(0, 102, 204),
                        ButtonHovered = Color3.fromRGB(0, 120, 240),
                        ButtonActive = Color3.fromRGB(0, 153, 255)
                    }) 
                    Iris.Button({"  Editor  "})
                    Iris.PopConfig()
                Iris.End()
                Iris.PopConfig()

                Iris.Separator()

                Iris.PushConfig({
                    TextSize = 14,
                    TextFont = Enum.Font.Code,
                    ContentWidth = UDim.new(1, 0)
                })

                local input = Iris.InputText({""}, {value = States.Code})
                
                pcall(function()
                    local inputField = input.Instance.InputField
                    if inputField and not inputField:GetAttribute("VSRX_Configured") then
                        inputField:SetAttribute("VSRX_Configured", true)
                        inputField.MultiLine = true
                        inputField.TextWrapped = false
                        inputField.ClearTextOnFocus = false
                        inputField.Font = Enum.Font.Code
                        inputField.TextXAlignment = Enum.TextXAlignment.Left
                        inputField.TextYAlignment = Enum.TextYAlignment.Top
                        inputField.Size = UDim2.new(1, 0, 0, 230)
                    end
                    if input.Instance.TextLabel then input.Instance.TextLabel.Visible = false end
                end)

                Iris.PopConfig() 

                Iris.Separator()

                Iris.SameLine()
                    local runBtn = Iris.Button({"Run Script"})
                    if runBtn.clicked then
                        local codeToRun = input.Instance.InputField.Text
                        if codeToRun and #codeToRun > 0 then
                            local func, parseErr = loadstring(codeToRun)
                            if func then
                                task.spawn(func)
                            else
                                warn("VSRX Parse Error: " .. tostring(parseErr))
                            end
                        end
                    end
                    
                    local clearBtn = Iris.Button({"Clear"})
                    if clearBtn.clicked then
                        States.Code:set("")
                        pcall(function()
                            input.Instance.InputField.Text = ""
                        end)
                    end
                Iris.End() 

            Iris.End()
        end)
        if not ok then
            warn("VSRX Iris UI Error: " .. tostring(err))
        end
    end
end)
