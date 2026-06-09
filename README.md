# VSRX (VS Roblox Executor)

VS Roblox Executor  
Run Lua scripts seamlessly across all executors using Visual Studio Code.

## Process:
1. Install the Plugin.
2. Relaunch VS code.
3. Open any `.lua` or `.luau` file in VS code.
4. Click `Inject` in the bottom left status bar to copy the loader script.
5. Execute the loader script in your Roblox executor.
6. Click `Execute Script` in VS code to run your scripts instantly!

## Supported Features
- Run `.lua` and `.luau` files directly from the editor.
- Resolve local module requires like `require("./src/Utilities/runtime")` and `require("../Utilities/runtime")` before execution.
- Preserve module return values so shared modules like `Runtime` keep working after bundling.
- Cache shared local modules during bundling to avoid duplicate loads.
- Detect real circular local requires and show a clear error.
- Leave native Roblox requires like `require(game.ReplicatedFirst...)` alone.

## Current Limits
- Dynamic requires such as `require(pathVariable)` are not supported yet.
- Folder-style resolution like `require("./Folder")` only works when a real file is found.
- Require parsing is still based on source text, so unusual string/comment edge cases may need extra handling later.

---
*Note: Make sure your script file language is set to Lua in VS Code.*
