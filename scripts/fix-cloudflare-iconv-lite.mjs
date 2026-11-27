import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('node_modules')
const targets = new Set(['./lib/extend-node', './lib/streams'])
const patched = []

function visit(directory) {
  if (!fs.existsSync(directory)) return

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const entryPath = path.join(directory, entry.name)
    if (entry.name === 'iconv-lite') {
      const packagePath = path.join(entryPath, 'package.json')
      if (fs.existsSync(packagePath)) {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
        if (pkg.browser && typeof pkg.browser === 'object' && !Array.isArray(pkg.browser)) {
          let changed = false
          for (const target of targets) {
            if (Object.hasOwn(pkg.browser, target)) {
              delete pkg.browser[target]
              changed = true
            }
          }
          if (changed) {
            if (Object.keys(pkg.browser).length === 0) delete pkg.browser
            fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n')
            patched.push(path.relative(process.cwd(), packagePath))
          }
        }
      }
    }

    if (entry.name !== '.bin') visit(entryPath)
  }
}

visit(root)

if (patched.length === 0) {
  throw new Error('Cloudflare compatibility patch: iconv-lite browser aliases were not found. Check installed iconv-lite dependency version.')
}

for (const file of patched) console.log('Patched Cloudflare-incompatible iconv-lite browser aliases:', file)
