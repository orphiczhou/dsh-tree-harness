// Heuristic markdown table checker: within a contiguous table block, every row
// must have the same number of unescaped pipes. Flags likely column drift.
import { readFileSync } from 'node:fs'

const files = process.argv.slice(2)
let problems = 0
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  let block = []
  let blockStart = 0
  const flush = () => {
    if (block.length < 2) { block = []; return }
    const counts = block.map(({ line }) => (line.match(/(?<!\\)\|/g) || []).length)
    const mode = counts.slice().sort((a, b) => counts.filter((x) => x === b).length - counts.filter((x) => x === a).length)[0]
    for (let i = 0; i < block.length; i++) {
      if (counts[i] !== mode) {
        problems += 1
        console.log(`${file}:${block[i].no} pipe-count ${counts[i]} (table mode ${mode}): ${block[i].line.slice(0, 120)}`)
      }
    }
    block = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*\|/.test(line)) {
      if (block.length === 0) blockStart = i + 1
      block.push({ no: i + 1, line })
    } else flush()
  }
  flush()
}
console.log(problems === 0 ? 'TABLE CHECK OK' : `TABLE PROBLEMS: ${problems}`)
process.exit(problems === 0 ? 0 : 1)
