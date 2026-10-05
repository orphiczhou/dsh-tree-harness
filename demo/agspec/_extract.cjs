#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const asarPath = 'D:/DSHarness/resources/app.asar'
const target = process.argv[2]
const outPath = process.argv[3]
const fd = fs.openSync(asarPath, 'r')
const probe = Buffer.alloc(64)
fs.readSync(fd, probe, 0, 64, 0)
const jsonSize = probe.readUInt32LE(4)
let jsonStart = -1
for (let i = 4; i < 40; i++) { if (probe[i] === 0x7b && probe[i+1] === 0x22) { jsonStart = i; break } }
const headerBuf = Buffer.alloc(jsonSize + 64)
fs.readSync(fd, headerBuf, 0, jsonSize + 64, jsonStart)
const raw = headerBuf.toString('utf-8')
let header
try { header = JSON.parse(raw) } catch (e) {
  const at = Number((e.message.match(/position (\d+)/) || [])[1]); header = JSON.parse(raw.slice(0, at))
}
const baseOffset = jsonStart + jsonSize
function* walk(node, prefix) {
  if (node.files) { for (const [n, c] of Object.entries(node.files)) yield* walk(c, prefix + '/' + n) }
  else if (node.offset !== undefined) yield { path: prefix, offset: node.offset, size: node.size }
}
const e = [...walk(header, '')].find(x => x.path === target)
if (!e) { console.error('not found: ' + target); process.exit(1) }
const buf = Buffer.alloc(e.size)
fs.readSync(fd, buf, 0, e.size, baseOffset + Number(e.offset))
fs.writeFileSync(outPath, buf)
console.log(`wrote ${outPath} (${e.size} B)`)
