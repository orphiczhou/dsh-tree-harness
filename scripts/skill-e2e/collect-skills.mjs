#!/usr/bin/env node
/**
 * collect-skills.mjs — 断言某会话「看到了哪些 skill」（含活体热加载演化）。
 *
 * 机制（旁证口径，不依赖被测实现）：DSH 把 skill 目录渲染进会话首轮
 * user/message 内的 `<system-reminder>…<available_skills>…</available_skills>…</system-reminder>`
 * 块；skill provider 热加载后，后续 user/message 会再注入刷新后的 catalog。
 * 本脚本解码会话日志（多帧 zstd），解析每个 catalog 块，输出：
 *   - `atCreation`：会话创建时（首个 catalog）看到的 skill 列表；
 *   - `latest`：最后一次注入的 catalog（当前活体加载结果）；
 *   - `evolution`：所有 catalog 注入的 seq/数量/目标命中，用于观察分批 reload；
 *   - `skillLoads`：会话里 `skill` 工具的真实加载调用（真的用了某个 skill 的证据）。
 *
 * 用法：
 *   node scripts/skill-e2e/collect-skills.mjs <sessionId> [...]
 *   node scripts/skill-e2e/collect-skills.mjs --session <id> --expect tree-commander,tree-worker,session-handoff --expect-at latest
 *
 * 选项：
 *   --session <id>     会话 id（可重复；也可作为位置参数）
 *   --expect <a,b,...> 期望出现的 skill 名（缺省 tree-commander,tree-worker,session-handoff）
 *   --expect-at <latest|first|any> 在哪个快照上断言（缺省 latest）
 *   --json             仅输出 JSON
 *   --out <file>       把 JSON 报告另存到文件
 *   --no-default-expect 不断言三个目标 skill（只做清单采集）
 *   --help / -h        显示帮助
 *
 * 退出码：0 = 期望的 skill 全部出现；1 = 有缺失；2 = 参数/日志缺失等无法取证。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  DSH_HOME,
  allSessionIds,
  contentTexts,
  decodeSessionLog,
  findAvailableSkills,
  findSessionLog,
  normSessionId,
  parseArgs,
} from './lib.mjs';

const TARGET_SKILLS = ['tree-commander', 'tree-worker', 'session-handoff'];

function printHelp() {
  const text = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const m = text.match(/\/\*\*([\s\S]*?)\*\//);
  process.stdout.write((m ? m[1] : text).replace(/^\s*\* ?/gm, '') + '\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2), {
    session: [],
    expect: null,
    'expect-at': 'latest',
    json: false,
    out: null,
    'no-default-expect': false,
  });
  if (opts.help) { printHelp(); return 0; }
  const ids = allSessionIds(opts);
  if (ids.length === 0) {
    process.stderr.write('usage: collect-skills.mjs <sessionId...> [--expect a,b,c] [--expect-at latest|first|any] [--json] [--out file]\n');
    return 2;
  }
  const expectAt = opts['expect-at'];
  if (!['latest', 'first', 'any'].includes(expectAt)) {
    process.stderr.write(`collect-skills: --expect-at must be latest|first|any, got ${expectAt}\n`);
    return 2;
  }
  const expected = opts.expect
    ? String(opts.expect).split(/[,;\s]+/).filter(Boolean)
    : opts['no-default-expect']
      ? []
      : TARGET_SKILLS;

  const results = ids.map((id) => collectOne(id, expected, expectAt));
  const report = {
    tool: 'collect-skills',
    generatedAt: new Date().toISOString(),
    dshHome: DSH_HOME,
    expected,
    expectAt,
    sessions: results,
    summary: {
      sessions: results.length,
      found: results.filter((r) => r.ok).length,
      missingSessions: results.filter((r) => !r.ok).length,
      allExpectedPresent: results.every((r) => (opts['no-default-expect'] && expected.length === 0 ? true : r.ok)),
    },
  };
  report.summary.verdict = report.summary.allExpectedPresent ? 'PASS' : 'FAIL';

  const json = JSON.stringify(report, null, 2);
  if (opts.out) fs.writeFileSync(opts.out, json + '\n', 'utf8');
  if (opts.json) process.stdout.write(json + '\n');
  else printHuman(report);

  return report.summary.allExpectedPresent ? 0 : 1;
}

/** 在给定 skill 名集合上评估期望。返回 {present, missing, targets} */
function evalExpected(names, expected) {
  const set = new Set(names || []);
  const targets = Object.fromEntries(TARGET_SKILLS.map((n) => [n, set.has(n)]));
  return { present: expected.filter((e) => set.has(e)), missing: expected.filter((e) => !set.has(e)), targets };
}

function collectOne(id, expected, expectAt) {
  const log = findSessionLog(id);
  if (!log) {
    return { id, ok: false, error: 'session log not found', log: null, expected, found: false, missing: expected, atCreation: null, latest: null, skillLoads: [], evolution: [] };
  }
  const decoded = decodeSessionLog(log.file);
  const events = decoded.events;
  const skills = findAvailableSkills(events);

  // skill 工具加载调用（真的把 skill 正文拉进上下文的证据）
  const skillLoads = [];
  for (const ev of events) {
    if (ev.type !== 'tool/call' || ev.data?.name !== 'skill') continue;
    let args = {};
    try { args = JSON.parse(ev.data.arguments || '{}'); } catch { /* ignore */ }
    skillLoads.push({ seq: ev.seq, name: args.name || args.skill || null });
  }

  const atCreation = skills.found
    ? { ...evalExpected(skills.first.names, expected), seq: skills.first.seq, count: skills.first.count, names: skills.first.names }
    : null;
  const latest = skills.found
    ? { ...evalExpected(skills.latest.names, expected), seq: skills.latest.seq, count: skills.latest.count, names: skills.latest.names }
    : null;
  const evolution = (skills.hits || []).map((h) => {
    const targets = TARGET_SKILLS.filter((n) => h.names.includes(n));
    return { seq: h.seq, type: h.type, surfaceOp: h.surfaceOp, count: h.count, targets };
  });

  // 断言快照：latest（当前活体加载）/ first（创建时）/ any（任一快照出现过）
  let chosen;
  if (expectAt === 'first') chosen = atCreation;
  else if (expectAt === 'latest') chosen = latest;
  else {
    const union = new Set();
    for (const h of skills.hits || []) for (const n of h.names) union.add(n);
    chosen = skills.found ? { ...evalExpected([...union], expected), seq: null, count: union.size, names: [...union] } : null;
  }
  const missing = chosen ? chosen.missing : expected;
  const firstUser = events.find((e) => e.type === 'user/message') || null;

  return {
    id: normSessionId(id),
    ok: missing.length === 0,
    log: log.file,
    logBytes: decoded.bytes,
    frames: decoded.frames,
    eventCount: events.length,
    found: skills.found,
    expectAt,
    atCreation,
    latest,
    evolution,
    expected,
    missing,
    skillLoads,
    firstUserMessageSeq: firstUser ? firstUser.seq : null,
    firstUserMessageHead: firstUser ? truncate(contentTexts(firstUser), 240) : null,
  };
}

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function printHuman(report) {
  const lines = [];
  lines.push(`collect-skills  ${report.generatedAt}`);
  lines.push(`  DSH_HOME: ${report.dshHome}`);
  lines.push(`  expected: ${report.expected.length ? report.expected.join(', ') : '(none)'}   expectAt=${report.expectAt}`);
  lines.push('');
  for (const s of report.sessions) {
    lines.push(`  session ${s.id}`);
    if (s.error) { lines.push(`    ERROR: ${s.error}`); continue; }
    lines.push(`    log       : ${s.log}`);
    lines.push(`    events    : ${s.eventCount} (frames=${s.frames})`);
    const fmt = (snap, label) => {
      if (!snap) { lines.push(`    ${label}: NOT FOUND`); return; }
      lines.push(`    ${label}: ${snap.count} 个 @seq ${snap.seq}  targets=${JSON.stringify(snap.targets)}`);
      const rest = (snap.names || []).filter((n) => !report.expected.includes(n));
      lines.push(`      names: ${(snap.names || []).join(', ')}`);
      if (rest.length && snap.names.length !== rest.length) lines.push(`      (非目标: ${rest.length} 个)`);
    };
    fmt(s.atCreation, 'atCreation');
    if (s.latest && s.atCreation && s.latest.seq !== s.atCreation.seq) fmt(s.latest, 'latest    ');
    lines.push(`    evolution : ${s.evolution.map((h) => `seq${h.seq}:${h.count}[${h.targets.join('+') || '-'}]`).join(' → ') || '(none)'}`);
    lines.push(`    目标命中  : ${s.ok ? 'PASS' : 'FAIL'}${s.missing.length ? `  缺: ${s.missing.join(', ')}` : ''}`);
    lines.push(`    skill 工具加载: ${s.skillLoads.length ? s.skillLoads.map((l) => `${l.name ?? '?'}@${l.seq}`).join(', ') : '(none)'}`);
    lines.push('');
  }
  lines.push(`  SUMMARY: ${report.summary.found}/${report.summary.sessions} sessions ok → ${report.summary.verdict}`);
  process.stdout.write(lines.join('\n') + '\n');
}

process.exitCode = main();
