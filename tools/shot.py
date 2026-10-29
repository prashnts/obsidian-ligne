"""Drives the ligne page in Firefox and screenshots it to ~/limn-shot/ligne/<name>.png.

    uv run --project ~/repo/projects --group ui python tools/shot.py [name] [--steps steps.json]

Steps (JSON list): ["key", "m"], ["click", x, y], ["dbl", x, y], ["move", x, y], ["wait", ms].
Default steps draw a trunk with a branch off it. Console errors are printed.
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = 'http://localhost:4240/'
OUT = Path.home() / 'limn-shot' / 'ligne'
DEMO = [
    ['key', 'm'], ['click', 200, 200], ['click', 500, 300], ['click', 800, 300], ['dbl', 900, 500],
    ['click', 900, 500], ['dbl', 1000, 650],
    ['key', '2'], ['click', 650, 300], ['dbl', 750, 450],
    ['key', 's'], ['click', 350, 202], ['key', '2'], ['click', 650, 300], ['key', '3'], ['click', 700, 400],
    ['key', 's'], ['click', 300, 500], ['move', 600, 600],
]


def run(name: str, steps: list) -> None:
    with sync_playwright() as p:
        page = p.firefox.launch().new_page(viewport={'width': 1200, 'height': 800})
        page.on('console', lambda m: m.type == 'error' and print('console:', m.text))
        page.on('pageerror', lambda e: print('pageerror:', e))
        page.goto(URL)
        page.evaluate('localStorage.clear()'); page.reload()
        page.wait_for_selector('.ligne-panel')
        for s in steps:
            match s:
                case ['key', k]: page.keyboard.press(k)
                case ['click', x, y]: page.mouse.click(x, y)
                case ['dbl', x, y]: page.mouse.dblclick(x, y)
                case ['move', x, y]: page.mouse.move(x, y)
                case ['wait', ms]: page.wait_for_timeout(ms)
        page.wait_for_timeout(300)
        OUT.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=OUT / f'{name}.png')
        print(page.evaluate('window.ligne.text()'))


if __name__ == '__main__':
    args = sys.argv[1:]
    steps = json.loads(Path(args[args.index('--steps') + 1]).read_text()) if '--steps' in args else DEMO
    run(next((a for a in args if not a.startswith('--') and not a.endswith('.json')), 'demo'), steps)
