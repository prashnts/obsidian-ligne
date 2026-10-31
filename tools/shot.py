"""Drives the ligne page in Firefox and screenshots it to ~/limn-shot/ligne/<name>.png.

    uv run --project ~/repo/projects --group ui python tools/shot.py [name] [--steps steps.json]

Steps (JSON list): ["key", "m"], ["click", x, y], ["dbl", x, y], ["move", x, y], ["wait", ms],
["drag", x1, y1, x2, y2], ["eval", "<js>"], ["shot", name] (an extra screenshot mid-way),
["save", path] (the scene as an .excalidraw JSON).
Default steps draw a trunk with a branch off it. Console errors are printed.
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = 'http://localhost:4240/?blank'
OUT = Path.home() / 'limn-shot' / 'ligne'
DEMO = [
    ['key', 'm'], ['click', 300, 250], ['move', 500, 250], ['click', 700, 350], ['move', 850, 350],
    ['click', 1000, 350], ['click', 1000, 350],                              # trunk
    ['click', 550, 250], ['move', 600, 300], ['click', 700, 450], ['click', 700, 450],  # branch off it
    ['move', 331, 258], ['click', 330, 258], ['move', 500, 258], ['move', 690, 360],
    ['click', 900, 358], ['click', 900, 358],                                # on its lane
    ['key', 's'], ['click', 400, 250], ['key', '2'], ['click', 700, 350], ['key', '3'], ['click', 1000, 350],
    ['key', 'l'], ['click', 820, 350], ['wait', 100], ['eval', "document.querySelector('.ligne-input').value = 'trunk'"],
    ['key', 'Enter'], ['key', 's'], ['move', 600, 600],
]


def run(name: str, steps: list) -> None:
    with sync_playwright() as p:
        page = p.firefox.launch().new_page(viewport={'width': 1200, 'height': 800})
        page.on('console', lambda m: m.type == 'error' and print('console:', m.text))
        page.on('pageerror', lambda e: print('pageerror:', e))
        page.goto(URL)
        page.evaluate('localStorage.clear()'); page.reload()
        page.wait_for_selector('.ligne-panel', state='attached')
        OUT.mkdir(parents=True, exist_ok=True)
        for s in steps:
            match s:
                case ['key', k]: page.keyboard.press(k)
                case ['click', x, y]: page.mouse.click(x, y)
                case ['dbl', x, y]: page.mouse.dblclick(x, y)
                case ['move', x, y]: page.mouse.move(x, y)
                case ['wait', ms]: page.wait_for_timeout(ms)
                case ['eval', js]: page.evaluate(js)
                case ['shot', n]: page.screenshot(path=OUT / f'{n}.png')
                case ['save', path]:
                    els = page.evaluate('window.ligne.api.getSceneElements().filter(e => !e.isDeleted)')
                    Path(path).write_text(json.dumps({'type': 'excalidraw', 'version': 2, 'elements': els}))
                case ['drag', x1, y1, x2, y2]:
                    page.mouse.move(x1, y1); page.mouse.down()
                    for i in range(1, 9): page.mouse.move(x1 + (x2 - x1) * i / 8, y1 + (y2 - y1) * i / 8)
                    page.mouse.up()
        page.wait_for_timeout(300)
        OUT.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=OUT / f'{name}.png')
        print(page.evaluate('window.ligne.text()'))


if __name__ == '__main__':
    args = sys.argv[1:]
    steps = json.loads(Path(args[args.index('--steps') + 1]).read_text()) if '--steps' in args else DEMO
    run(next((a for a in args if not a.startswith('--') and not a.endswith('.json')), 'demo'), steps)
