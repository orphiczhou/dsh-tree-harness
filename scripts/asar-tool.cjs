#!/usr/bin/env node
/** asar 只读检索工具：解析 app.asar 头，列出/抽取目标文件（S0 API 形状权威验证用）。 */
'use strict'
const fs = require('node:fs')

const asarPath = process.argv[2]
const mode = process.argv[3]           // 'find' <pattern> | 'grep' <filePattern> <textPattern> | 'cat' <filePattern>
const arg4 = process.argv[4]
const arg5 = process.argv[5]

const fd = fs.openSync(asarPath, 'r')
const probe = Buffer.alloc(64)
fs.readSync(fd, probe, 0, 64, 0)
const jsonSize = probe.readUInt32LE(4)
// chrome-pickle 对齐：在头 64 字节内定位 JSON 起点 '{'
let jsonStart = -1
for (let i = 4; i < 40; i++) {
  if (probe[i] === 0x7b /* '{' */ && probe[i + 1] === 0x22 /* '"' */) { jsonStart = i; break }
}
if (jsonStart < 0) { console.error('cannot locate JSON start in asar header'); process.exit(1) }
const headerBuf = Buffer.alloc(jsonSize + 64)
fs.readSync(fd, headerBuf, 0, jsonSize + 64, jsonStart)
const raw = headerBuf.toString('utf-8')
let header
try {
  header = JSON.parse(raw)
} catch (e) {
  // asar 头后附第二结构：按报错位置截断重析
  const at = Number((e.message.match(/position (\d+)/) || [])[1])
  if (!at) throw e
  header = JSON.parse(raw.slice(0, at))
}
const baseOffset = jsonStart + jsonSize

function* walk(node, prefix) {
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) yield* walk(child, prefix + '/' + name)
  } else if (node.offset !== undefined) {
    yield { path: prefix, offset: node.offset, size: node.size }
  }
}

function readFileContent(entry) {
  const buf = Buffer.alloc(entry.size)
  fs.readSync(fd, buf, 0, entry.size, baseOffset + Number(entry.offset))
  return buf.toString('utf-8')
}

const all = [...walk(header, '')]
if (mode === 'find') {
  const re = new RegExp(arg4, 'i')
  for (const e of all) if (re.test(e.path)) console.log(e.path)
} else if (mode === 'grep') {
  const fileRe = new RegExp(arg4, 'i')
  const textRe = new RegExp(arg5, 'i')
  let hits = 0
  for (const e of all) {
    if (!fileRe.test(e.path) || e.size > 3_000_000) continue
    const text = readFileContent(e)
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (textRe.test(lines[i])) {
        console.log(`--- ${e.path}:${i + 1}`)
        console.log(lines[i].trim().slice(0, 400))
        hits++
        if (hits > 60) { console.log('(truncated)'); process.exit(0) }
      }
    }
  }
  console.log(`(${hits} hits)`)
} else if (mode === 'cat') {
  const fileRe = new RegExp(arg4, 'i')
  for (const e of all) if (fileRe.test(e.path)) console.log(`===== ${e.path} (${e.size} B) =====\n` + readFileContent(e).slice(0, Number(arg4.size ?? 20000)))
}
