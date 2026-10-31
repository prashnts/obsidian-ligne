# ligne

Metro-map lines over Excalidraw: octilinear legs with round bends, trunk/branch/dotted lines,
branching, extending, stations (label lines `key: value` = data) and a text graph export. Web page now, Obsidian plugin (on top of the
Excalidraw plugin) next. `src/core/` is dependency-free geometry + graph, reusable elsewhere.

    npm run dev       # web page on :4240, rebuilds on change
    npm test          # core + line tests (node:test, no browser)
    uv run --project ~/repo/projects --group ui python tools/shot.py [name]   # → ~/limn-shot/ligne/

Tool: `m` or the toolbar button toggles; it holds Excalidraw's line (or arrow) tool, so colour, width,
dash, sloppiness, fill, arrowheads come from Excalidraw's style panel (remembered for ligne; `i` or
Alt-click takes a line's style). Excalidraw's shortcuts (undo, delete, copy) keep working meanwhile.
Click stops; the line is previewed rounded as it will be; the first leg goes the way the pointer leaves
the stop (`b` swaps); a near miss that would leave a tiny jog lines up instead. Click the last stop
again (or double-click, Enter) to end; end on the first stop for a zone (at the back); `Backspace` /
Ctrl-Z takes back a stop. Start on a line to branch (tube-map fork, trunk style); on its end to extend
it in its own style; end on a line (or loop back onto the line being drawn) for a junction. Drag a
waypoint to move it (both its legs stay at 45°). Beside a line the pointer snaps to its free lanes,
harder along the leg being drawn, and holds a lane once on it: the new line follows bend for bend and
joins / leaves at 45°. Lines sharing lanes are a stack (Excalidraw group); double-click picks the one
line under the pointer, in ligne or not. Hold Ctrl/Cmd (or `n`) to place anywhere. Bend radius
(0 = sharp): slider or `[` `]`, for the line being drawn, else the selected lines.

Cables (`t`, style `T`: round / zigzag twist or colour checks; strands ×2–4, length slider): strands
in the stroke colour and Excalidraw's background colour (white checks when none); stacked cables
keep a gap. Near a cable, drag a strand's end dot to bend its leg out to a pin; drop it back to reset.
`d` direction chevrons along the line, the way it was drawn. `a` arrowheads.
`s` stations (`1-4` stop/interchange/commit/net flag, `b` boxed label), following their line's colour.
`l` labels: click a line, type; set along it, on it (knocked out) or beside it (`b`); drag along the line.
`k` legend, `p`/`P` A5/A6 frame (`o` landscape), `g` graph text, `?` help. Every key has a panel button.

Lines carry a ligne id (`lid`), so links, branches and stations survive Excalidraw's re-id on paste;
older drawings are relinked by geometry when opened.

## Obsidian

Needs the Excalidraw plugin; ligne mounts on its drawings and uses its Excalidraw bundle.
Commands: *Toggle the line tool*, *Copy the graph as text*.

    npm run build     # also installs into test-vault/
    npm run headless  # isolated Obsidian on test-vault (CDP :9334); first time, trust the vault:
    node tools/cdp.mjs eval "[...document.querySelectorAll('.modal button')].find(b=>/trust/i.test(b.innerText)).click()"
    node tools/cdp.mjs do "key m; click 400,300; click 700,450; key Enter"   # real input steps
    node tools/cdp.mjs shot ~/limn-shot/ligne/obsidian.png
    npm run release   # release/ligne.zip → <vault>/.obsidian/plugins/ligne/

Release: `npm version 0.2.0 && git push --follow-tags` (tag = manifest version, no `v`); the
release workflow tests, builds and attaches main.js, manifest.json, styles.css and ligne.zip.
