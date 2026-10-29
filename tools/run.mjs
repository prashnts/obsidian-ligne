// Run a .ts entry (tool or test) by bundling it with esbuild first.
// usage: node tools/run.mjs <entry.ts...> [--test] [-- args for the script]
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, resolve } from 'node:path'

const all = process.argv.slice(2)
const sep = all.indexOf('--')
const args = sep < 0 ? all : all.slice(0, sep), pass = sep < 0 ? [] : all.slice(sep + 1)
const test = args.includes('--test')
const entries = args.filter(a => a !== '--test')
const out = resolve('node_modules/.cache/ligne-run')
mkdirSync(out, { recursive: true })
const files = []
for (const e of entries) {
  const f = `${out}/${basename(e).replace(/\.ts$/, '')}.mjs`
  // outfile stays next to the source dir for import.meta.url-relative paths via banner
  await build({
    entryPoints: [e], outfile: f, bundle: true, platform: 'node', format: 'esm',
    packages: 'external', logLevel: 'warning', target: 'node22', loader: { '.bin': 'binary', '.txt': 'text' },
    define: { 'import.meta.dirname': JSON.stringify(resolve(e, '..')) },
  })
  files.push(f)
}
const r = spawnSync(process.execPath, test ? ['--test', ...files] : [...files, ...pass], { stdio: 'inherit' })
process.exit(r.status ?? 1)
