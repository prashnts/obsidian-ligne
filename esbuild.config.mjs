// Builds the web page into web/ (app.js, excalidraw.css, styles.css, Excalidraw fonts) and the
// Obsidian plugin into main.js. --serve: rebuild both on change, serve web/ on :4240.
// With OBSIDIAN_VAULT=/path (or --vault /path) the plugin is copied into that vault on every build.
import esbuild from 'esbuild'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2), serve = args.includes('--serve')
const vault = args.includes('--vault') ? args[args.indexOf('--vault') + 1] : process.env.OBSIDIAN_VAULT
cpSync('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'web/fonts', { recursive: true })
cpSync('styles.css', 'web/styles.css')
cpSync('node_modules/@excalidraw/excalidraw/dist/prod/index.css', 'web/excalidraw.css')

const web = await esbuild.context({
  entryPoints: { app: 'src/web/main.tsx' }, outdir: 'web', bundle: true, format: 'esm',
  jsx: 'automatic', minify: !serve, sourcemap: serve, logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(serve ? 'development' : 'production') },
})
const deploy = { name: 'deploy', setup: b => b.onEnd(r => {
  if (r.errors.length || !vault) return
  const dir = join(vault, '.obsidian', 'plugins', 'ligne')
  mkdirSync(dir, { recursive: true })
  for (const f of ['main.js', 'manifest.json', 'styles.css']) cpSync(f, join(dir, f))
  writeFileSync(join(dir, '.hotreload'), '')
}) }
const plugin = await esbuild.context({
  entryPoints: ['src/obsidian/main.ts'], outfile: 'main.js', bundle: true, format: 'cjs', target: 'es2022',
  external: ['obsidian', 'electron', '@codemirror/*'], minify: !serve, logLevel: 'info', plugins: [deploy],
})
if (serve) {
  await Promise.all([web.watch(), plugin.watch()])
  await web.serve({ servedir: 'web', port: 4240, host: '0.0.0.0' })
} else {
  await Promise.all([web.rebuild(), plugin.rebuild()]); await Promise.all([web.dispose(), plugin.dispose()])
}
