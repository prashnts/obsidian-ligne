// npm version x.y.z: the new version goes into manifest.json, and versions.json maps it to the
// minimum Obsidian version (as Obsidian's plugin list expects).
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.env.npm_package_version
const read = f => JSON.parse(readFileSync(f, 'utf8'))
const manifest = read('manifest.json')
manifest.version = version
writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n')
const versions = read('versions.json')
versions[version] = manifest.minAppVersion
writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n')
