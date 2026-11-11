#!/usr/bin/env node
/**
 * dump-events.mjs — 开发期探针：打印某会话日志的事件类型直方图与样例，用于校准字段结构。
 * 用法：node scripts/skill-e2e/dump-events.mjs <sessionId> [--type tool/call] [--limit 5] [--json]
 */
import fs from 'node:fs';
import { allSessionIds, decodeSessionLog, findSessionLog, contentTexts, parseArgs, readJson } from './lib.mjs';

const opts = parseArgs(process.argv.slice(2), { type: null, limit: '3', json: false, session: [] });
const ids = allSessionIds(opts);
if (ids.length === 0) {
  process.stderr.write('usage: dump-events.mjs <sessionId> [--type <event/type>] [--limit N] [--json]\n');
  process.exit(2);
}
const id = ids[0];
const log = findSessionLog(id);
if (!log) {
  process.stderr.write(`session log not found for ${id}\n`);
  process.exit(2);
}
const decoded = decodeSessionLog(log.file);
const limit = Number(opts.limit) || 3;

const hist = new Map();
for (const ev of decoded.events) hist.set(ev.type, (hist.get(ev.type) || 0) + 1);

if (opts.json) {
  const samples = {};
  for (const [type] of hist) {
    samples[type] = decoded.events.filter((e) => e.type === type).slice(0, limit);
  }
  process.stdout.write(JSON.stringify({ id, log: log.file, bytes: decoded.bytes, frames: decoded.frames, badLines: decoded.badLines, eventCount: decoded.events.length, types: [...hist].sort((a, b) => b[1] - a[1]), samples }, null, 2) + '\n');
  process.exit(0);
}

process.stdout.write(`session ${id}\nlog ${log.file}\nbytes=${decoded.bytes} frames=${decoded.frames} events=${decoded.events.length} badLines=${decoded.badLines}\n\n`);
for (const [type, n] of [...hist].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`  ${String(n).padStart(5)}  ${type}\n`);
}
if (opts.type) {
  const evs = decoded.events.filter((e) => e.type === opts.type).slice(0, limit);
  process.stdout.write(`\n--- samples of ${opts.type} ---\n`);
  for (const ev of evs) {
    // 对超长字段截断，便于阅读
    const clone = JSON.parse(JSON.stringify(ev));
    const tr = (o) => {
      if (!o || typeof o !== 'object') return o;
      for (const k of Object.keys(o)) {
        if (typeof o[k] === 'string' && o[k].length > 1200) o[k] = `${o[k].slice(0, 1200)}…(${o[k].length} chars)`;
        else if (o[k] && typeof o[k] === 'object') tr(o[k]);
      }
      return o;
    };
    process.stdout.write(JSON.stringify(tr(clone), null, 2) + '\n');
  }
}
