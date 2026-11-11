// Link checker for tracked Markdown / HTML files: verifies every local link target
// exists in the repository. Usage: node scripts/check-doc-links.mjs [--all]
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)

const files = tracked.filter((f) => /\.(md|html?)$/i.test(f))
const problems = []
const skipped = []
const seen = new Set()

function checkTarget(file, raw) {
  let target = raw.trim()
  if (!target) return
  const hash = target.indexOf('#')
  if (hash >= 0) target = target.slice(0, hash)
  if (!target) return
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return
  if (target.startsWith('/')) return // repo-absolute paths are not valid relative links
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target))
  const key = `${file} -> ${resolved}`
  if (seen.has(key)) return
  seen.add(key)
  const abs = path.join(root, resolved)
  if (!existsSync(abs)) {
    problems.push({ file, target, resolved })
  }
}

for (const file of files) {
  if (file.startsWith('logs/') || file.startsWith('scripts/skill-e2e/artifacts/')) {
    skipped.push(file)
    continue
  }
  const text = readFileSync(path.join(root, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) checkTarget(file, m[1])
  for (const m of text.matchAll(/(?:src|href)="([^"]+)"/g)) checkTarget(file, m[1])
}

console.log(`checked ${files.length - skipped.length} files (skipped ${skipped.length} historical artifacts)`)
if (problems.length === 0) {
  console.log('LINK CHECK OK')
  process.exit(0)
}
for (const p of problems) console.log(`${p.file}: missing "${p.target}" -> ${p.resolved}`)
console.log(`LINK PROBLEMS: ${problems.length}`)
process.exit(1)
