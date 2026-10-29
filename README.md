# ligne

Metro-map lines over Excalidraw: octilinear legs with round bends, trunk/branch/dotted lines,
branching, extending, stations (label lines `key: value` = data) and a text graph export. Web page now, Obsidian plugin (on top of the
Excalidraw plugin) next. `src/core/` is dependency-free geometry + graph, reusable elsewhere.

    npm run dev       # web page on :4240, rebuilds on change
    npm test          # core tests
    uv run --project ~/repo/projects --group ui python tools/shot.py [name]   # → ~/limn-shot/ligne/

Tool: `m` toggles; click stops, double-click/Enter ends, Shift free 8-way leg, `f` flips leg order,
Backspace undoes a stop, Esc cancels, `1 2 3` trunk/branch/dotted. Start on a line to branch,
on its end to extend. `s` stations (`1 2 3` stop/interchange/commit), `g` copies the graph text.

## Obsidian

Needs the Excalidraw plugin; ligne mounts on its drawings and uses its Excalidraw bundle.
Commands: *Toggle the line tool*, *Copy the graph as text*.

    npm run build     # also installs into test-vault/
    npm run headless  # isolated Obsidian on test-vault (CDP :9334); first time, trust the vault:
    node tools/cdp.mjs eval "[...document.querySelectorAll('.modal button')].find(b=>/trust/i.test(b.innerText)).click()"
    node tools/cdp.mjs do "key m; click 400,300; click 700,450; key Enter"   # real input steps
    node tools/cdp.mjs shot ~/limn-shot/ligne/obsidian.png
    npm run release   # release/ligne.zip → <vault>/.obsidian/plugins/ligne/
