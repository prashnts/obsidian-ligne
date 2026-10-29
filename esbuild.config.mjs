// Builds the web page into web/ (app.js, excalidraw.css, styles.css, Excalidraw fonts).
// --serve: rebuild on change and serve web/ on :4240.
import esbuild from 'esbuild'
import { cpSync } from 'node:fs'

const serve = process.argv.includes('--serve')
cpSync('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'web/fonts', { recursive: true })
cpSync('styles.css', 'web/styles.css')
cpSync('node_modules/@excalidraw/excalidraw/dist/prod/index.css', 'web/excalidraw.css')

const web = await esbuild.context({
  entryPoints: { app: 'src/web/main.tsx' }, outdir: 'web', bundle: true, format: 'esm',
  jsx: 'automatic', minify: !serve, sourcemap: serve, logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(serve ? 'development' : 'production') },
})
if (serve) {
  await web.watch()
  await web.serve({ servedir: 'web', port: 4240, host: '0.0.0.0' })
} else {
  await web.rebuild(); await web.dispose()
}
