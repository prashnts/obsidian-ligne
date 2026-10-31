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
again (or double-click, Enter) to end; end on the first stop for a zone; `Backspace` /
Ctrl-Z takes back a stop; idle, `Esc` (or `v`) selects with Excalidraw's selection while ligne stays on
(its keys act on the selection; `Esc` with nothing selected: back to drawing). Start on a line to branch (tube-map fork, trunk style); on its end to extend
it in its own style; end on a line (or loop back onto the line being drawn) for a junction. Drag a
waypoint to move it (both its legs stay at 45°). Beside a line the pointer snaps to its free lanes,
harder along the leg being drawn, and holds a lane once on it: the new line follows bend for bend and
joins / leaves at 45°. Lines sharing lanes are a stack (Excalidraw group); double-click picks the one
line under the pointer, in ligne or not. Hold Ctrl/Cmd (or `n`) to place anywhere. Bend radius
(0 = sharp): slider or `[` `]`, for the line being drawn, else the selected lines.
A closed line is a zone, under the lines it crosses.

Modes: `v`/`Esc` select, `l` lines, `s` stations, `t` labels, `x` perfboard (the mode key again: back to
lines). Each panel button shows its own key; `?` lists them all.

Snapping: stops and dragged bends line up with waypoints, stations and shapes (pink guides; horizontal
and vertical across the page, diagonals nearby); `g` grid: off, square (Excalidraw's), isometric (legs
at 30°/90°/150°, lattice shown). While ligne is on, Excalidraw's own object snapping is on too, so
shapes moved with its tools get its smart guides. Lane gap (slider, `-` `=`): a line beside another set
further out; in select mode `-` `=` move the selected lines out / in on their lanes.

Line bodies (`w` on/off, `⇧W` next, or the popover): twisted round / zigzag, colour checks, chevron band
(git-flow style, width slider), ribbon, FFC. Strands in the stroke colour and Excalidraw's background
colour (white checks when none); stacked cables keep a gap. Near a cable, drag a strand's end dot to bend
its leg out to a pin; drop it back to reset.
Flat cables (*ribbon* / *ffc*) are drawn true to size at 96 dpi (× 1/2/4), so folds show as they will be:
silicone ribbon by AWG (32/30/28/26, `e`; black with a white stripe on wire 1 in the stroke colour, or
Qwiic, Grove, rainbow colours in the popover), FFC by pitch (0.5/1 mm). `b` folds at the next corner (at
the first stop: starts back up): the cable turns over, the back shows; `⇧B` swaps the bend. `c` cycles
the connector at both ends (none, Dupont, JST PH, SH, MX 1.25; FFC: ZIF), or at the end under the
pointer. At a flat cable's end, click a wire: a bundle of it goes on (click another wire: up to it; all
of them, or ⇧-click: the cable itself). Drag a wire to fan it out; click a fanned wire: a plain line
goes on from it. Click a cable's body to branch off it. By the pointer, a hint says what a click does.
`⇧T` text along the line, repeated (knocked out of thin lines, inside thick ones). `d` direction
chevrons, `a` arrowheads.

`s` stations (`1-4` stop/interchange/commit/net flag, `b` boxed label), following their line's colour.
`t` labels: `1-5` text, box, rounded box, net label (KiCad local: on the wire), flag (KiCad global: at a
line end, pointing away); on a line they read along it, on it or beside it (`b`); `f` solid; font and
size in the popover (Cascadia mono by default). Boxes are Excalidraw containers: double-click edits,
Excalidraw turns and moves them; `r` / `⇧R` in select mode turns the selection 90° / 45°.
`x` perfboard: `1` drag out a board (2.54 mm holes, true size ×1/2/4), `2-9` resistor, cap, diode, LED,
header, DIP, TO-92, module: click the first hole, then the last (TO-92: its middle), then ref and value
(`R3 10k`). Lines over a board snap to its holes (wires). Parts moved or turned with Excalidraw go back
onto the holes.
`k` legend, `p`/`P` A5/A6 frame (`o` landscape). `⇧C` copies the selection (else all) as SVG; the
graph as text is in the sheets popover.

Lines carry a ligne id (`lid`), so links, branches and stations survive Excalidraw's re-id on paste;
older drawings are relinked by geometry when opened.

## Install

- **Obsidian, from GitHub:** install the community plugin *BRAT* (Obsidian42 - BRAT), then
  *BRAT: Add a beta plugin* → `prashnts/obsidian-ligne`. It takes main.js, manifest.json and styles.css
  from the latest release and can keep them updated. Needs the Excalidraw plugin.
- **By hand:** unzip `ligne.zip` from a release into `<vault>/.obsidian/plugins/`, enable *ligne*.
- **Demo:** https://prashnts.github.io/obsidian-ligne/ (opens on a sample drawing; `?sample` to get it
  back, `?blank` for an empty page; drawings stay in the browser).

## Obsidian

Needs the Excalidraw plugin; ligne mounts on its drawings and uses its Excalidraw bundle.
Commands: *Toggle the line tool*, *Copy the graph as text*.

    npm run build     # also installs into test-vault/
    npm run headless  # isolated Obsidian on test-vault (CDP :9334); first time, trust the vault:
    node tools/cdp.mjs eval "[...document.querySelectorAll('.modal button')].find(b=>/trust/i.test(b.innerText)).click()"
    node tools/cdp.mjs do "key m; click 400,300; click 700,450; key Enter"   # real input steps
    node tools/cdp.mjs shot ~/limn-shot/ligne/obsidian.png
    npm run release   # release/ligne.zip → <vault>/.obsidian/plugins/ligne/

Release: `npm version 0.4.3`, tag `v0.4.3`, `git push --follow-tags` (tag = manifest version, `v`
optional); the release workflow tests, builds and attaches main.js, manifest.json, styles.css and ligne.zip.
