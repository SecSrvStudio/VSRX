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

## Local file `require` support

When you run a `.lua` or `.luau` file from VS Code, VSRX sends your script source as-is. It does not strip Luau types, rewrite `continue`, or transpile syntax.

If your script uses local file requires, VSRX adds a small runtime that loads those files from the current VS Code sources and executes them with native `loadstring`.

```luau
require("./Example/TEST/HI")
```

Supported local targets:
- `.luau` / `.lua` files
- omitted extensions, e.g. `require("./modules/foo")`
- folder modules via `init.luau` / `init.lua`
- relative paths from the current file and workspace-root style paths

Roblox/native requires are left untouched, including `require(ModuleScript)`, `require(game.ReplicatedStorage.Module)`, numeric asset requires, and unresolved/custom string requires.

---
*Note: Make sure your script file language is set to Lua in VS Code.*
