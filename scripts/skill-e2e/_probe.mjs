#!/usr/bin/env node
/**
 * _probe.mjs — 开发期临时探针（保留作排障样例，不参与正式断言）。
 * 打印一个会话的事件类型直方图、catalog 演化与工具计数，用于校准字段结构。
 * 用法：node scripts/skill-e2e/_probe.mjs <sessionId>
 */
import { allSessionIds, contentTexts, decodeSessionLog, findAvailableSkills, findSessionLog, normSessionId } from './lib.mjs';

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (ids.length === 0) {
  process.stderr.write('usage: _probe.mjs <sessionId>\n');
  process.exit(2);
}
for (const raw of ids) {
  const id = normSessionId(raw);
  const log = findSessionLog(id);
  if (!log) { console.log(`${id}: session log NOT FOUND`); continue; }
  const decoded = decodeSessionLog(log.file);
  const hist = {};
  for (const ev of decoded.events) hist[ev.type] = (hist[ev.type] || 0) + 1;
  const skills = findAvailableSkills(decoded.events);
  const calls = decoded.events.filter((e) => e.type === 'tool/call');
  const counts = {};
  for (const c of calls) counts[c.data?.name] = (counts[c.data?.name] || 0) + 1;
  console.log(`== ${id} ==`);
  console.log(`  events: ${decoded.events.length} frames=${decoded.frames} bytes=${decoded.bytes}`);
  console.log(`  catalog 演化: ${(skills.hits || []).map((h) => `seq${h.seq}:${h.count}[${h.names.filter((n) => /tree-|session-handoff/.test(n)).join(',')}]`).join(' → ') || '(none)'}`);
  console.log(`  tools: ${JSON.stringify(counts)}`);
  const firstUser = decoded.events.find((e) => e.type === 'user/message');
  if (firstUser) console.log(`  first user seq=${firstUser.seq}: ${contentTexts(firstUser).slice(0, 100).replace(/\s+/g, ' ')}`);
}
