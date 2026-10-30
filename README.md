# ligne

Metro-map lines over Excalidraw: octilinear legs with round bends, trunk/branch/dotted lines,
branching, extending, stations (label lines `key: value` = data) and a text graph export. Web page now, Obsidian plugin (on top of the
Excalidraw plugin) next. `src/core/` is dependency-free geometry + graph, reusable elsewhere.

    npm run dev       # web page on :4240, rebuilds on change
    npm test          # core tests
    uv run --project ~/repo/projects --group ui python tools/shot.py [name]   # → ~/limn-shot/ligne/

Tool: `m` or the toolbar button toggles; it holds Excalidraw's line (or arrow) tool, so colour, width,
dash, sloppiness, fill, arrowheads come from Excalidraw's style panel (remembered for ligne; `i` or
Alt-click takes a line's style). Click stops; click the last stop again (or double-click, Enter) to end;
end on the first stop for a zone (at the back). Start on a line to branch (tube-map fork: trunk style,
peels off in a curve towards the pointer's side, `f` swaps the first leg); on its end to extend; drag a
waypoint to move it. Beside a line the pointer snaps to its lanes: the new line follows it bend for
bend (same centres); it joins and leaves a lane at 45° in a curve, like a branch; lines sharing lanes are a stack (Excalidraw group:
click = stack, double-click = one line) and follow when the line they sit on is reshaped.
Snapping is close range; hold Ctrl/Cmd (or `n`) to place anywhere. Bend radius: slider or `[` `]`, for the line
being drawn, else the lines selected before `m`. `a` arrowheads, `d` direction ticks, `t` twisted pair (2nd strand in the background colour).
`s` stations (`1-4` stop/interchange/commit/net flag, `b` boxed label; labels use Excalidraw's font);
stations follow their line's colour; drag a station along its line, or its label. `k` legend,
`p`/`P` A5/A6 frame (`o` landscape), `g` graph text, `?` help. Every key has a panel button.

## Obsidian

Needs the Excalidraw plugin; ligne mounts on its drawings and uses its Excalidraw bundle.
Commands: *Toggle the line tool*, *Copy the graph as text*.

    npm run build     # also installs into test-vault/
    npm run headless  # isolated Obsidian on test-vault (CDP :9334); first time, trust the vault:
    node tools/cdp.mjs eval "[...document.querySelectorAll('.modal button')].find(b=>/trust/i.test(b.innerText)).click()"
    node tools/cdp.mjs do "key m; click 400,300; click 700,450; key Enter"   # real input steps
    node tools/cdp.mjs shot ~/limn-shot/ligne/obsidian.png
    npm run release   # release/ligne.zip → <vault>/.obsidian/plugins/ligne/
