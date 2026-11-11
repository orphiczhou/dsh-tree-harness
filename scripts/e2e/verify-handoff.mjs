#!/usr/bin/env node
/**
 * verify-handoff.mjs — 真机 E2E 断言器：session_handoff 接替会话的继承与归属。
 *
 * 只读本地 DSH 存储（不修改任何文件）。断言四类继承 + 工作区归属 + 交接提示/读取证据：
 *   1. cwd 相同
 *   2. successor 归属源 workspace（root 路径）/ 与源同归属（sibling 路径，子会话本就不入册）
 *   3. successor 首帧 permission/preset、sandbox/mode、approval/policy 与源「生效态」逐项相等
 *   4. request/header config（provider/model/reasoningEffort/maxTokens）与源相等
 *   5. agentPreset 与源相等
 *   6. tools 数量相等（并给出缺失/多出工具名）
 *   7. successor 首轮 user/message 是交接提示，且点名了 --source
 *   8. successor 首轮确有读取 HANDOFF 文件的证据（read 工具调用 / 含文件内容的 tool/result）
 *
 * 数据源（与 DSH 实现无关的旁证口径）：
 *   - 会话日志：<DSH_HOME>/sessions/<workspace-encoded>/<sessionId>/session.v4.jsonl.zstd
 *     格式 = 多个 zstd frame 拼接。Node 单次 zstdDecompressSync 只解第一帧，
 *     故扫描 0x28 0xB5 0x2F 0xFD 每个出现位置逐帧解压，失败忽略，按 type+seq 去重。
 *   - 会话投影缓存：<DSH_HOME>/storages/session_projcache/sessions/<sessionId>.json
 *     record.rows.permissions / agentPreset / modelSelection / workingDirectory
 *   - 工作区注册表：<DSH_HOME>/storages/workspace.json
 *     tables.workspaces.<wsId>.path / sessionIds；global.workspaceIds
 *
 * 用法：
 *   node scripts/e2e/verify-handoff.mjs --source <id> --successor <id> [options]
 *
 * 选项：
 *   --source <id>                  源（被交接）会话 id，允许带/不带 "session-" 前缀
 *   --successor <id>               接替会话 id，允许带/不带 "session-" 前缀
 *   --expect-kind root|sibling     期望接替类型（root：无 parentSession 且 delegationDepth=0；
 *                                  sibling：与源同 parentSession 且同 delegationDepth）
 *   --expect-permission-preset <n> 期望 successor 首帧 permission/preset == n
 *   --expect-preset <n>            --expect-permission-preset 的简写（兼容任务书写法）
 *   --expect-agent-preset <n>      期望 successor agentPreset == n
 *   --wait <ms>                    等待 successor 日志/首帧就绪（默认 0，不等待）
 *   --json                         仅输出 JSON（stdout）
 *   --out <file>                   把 JSON 报告另存到文件
 *   --help                         显示帮助
 *
 * 退出码：0 = 全部 PASS；1 = 存在 FAIL / 数据缺失导致无法判定。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const SESSION_ID_RE = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const opts = {
    source: null,
    successor: null,
    expectKind: null,
    expectPermissionPreset: null,
    expectAgentPreset: null,
    waitMs: 0,
    json: false,
    out: null,
  };
  const take = (i, name) => {
    if (i + 1 >= argv.length) throw new Error(`missing value for ${name}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--source': opts.source = take(i, a); i++; break;
      case '--successor': opts.successor = take(i, a); i++; break;
      case '--expect-kind': {
        const v = take(i, a); i++;
        if (v !== 'root' && v !== 'sibling') throw new Error(`--expect-kind must be root|sibling, got ${v}`);
        opts.expectKind = v;
        break;
      }
      case '--expect-permission-preset':
      case '--expect-preset':
        opts.expectPermissionPreset = take(i, a); i++; break;
      case '--expect-agent-preset':
        opts.expectAgentPreset = take(i, a); i++; break;
      case '--wait': opts.waitMs = Number(take(i, a)); i++; break;
      case '--json': opts.json = true; break;
      case '--out': opts.out = take(i, a); i++; break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`unknown argument: ${a} (use --help)`);
    }
  }
  if (!opts.source || !opts.successor) throw new Error('--source and --successor are required');
  if (!Number.isFinite(opts.waitMs) || opts.waitMs < 0) throw new Error('--wait must be a non-negative number of ms');
  return opts;
}

function printHelp() {
  const text = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const m = text.match(/\/\*\*([\s\S]*?)\*\//);
  process.stdout.write((m ? m[1] : text).replace(/^\s*\* ?/gm, '') + '\n');
}

/** 规范化会话 id：去掉可选的 "session-" 前缀，便于 --source 与日志内引用互比。 */
function normalizeSessionId(id) {
  if (!id) return '';
  return String(id).trim().replace(/^session-/i, '');
}

function looksLikeSessionId(v) {
  return SESSION_ID_RE.test(v || '') || UUID_RE.test(v || '');
}

/** Windows 路径比较口径：正斜杠→反斜杠、去尾分隔符、小写。 */
function normPath(p) {
  if (!p) return '';
  return String(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

function isUnder(parent, child) {
  const a = normPath(parent);
  const b = normPath(child);
  if (!a || !b) return false;
  return b === a || b.startsWith(a.endsWith('\\') ? a : a + '\\');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 会话日志解码（多 zstd frame 拼接）
// ---------------------------------------------------------------------------

/** 在 conversations/sessions 根下递归查找 <sessionId>/session.v4.jsonl.zstd。 */
function findSessionLog(sessionId) {
  const sessionsRoot = path.join(DSH_HOME, 'sessions');
  let workspaceDirs = [];
  try {
    workspaceDirs = fs.readdirSync(sessionsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return null;
  }
  const candidates = [];
  for (const wsDir of workspaceDirs) {
    const file = path.join(sessionsRoot, wsDir, sessionId, 'session.v4.jsonl.zstd');
    if (fs.existsSync(file)) candidates.push({ file, workspaceEncoding: wsDir });
  }
  if (candidates.length === 0) return null;
  // 同一会话 id 只应有一份；若多份取修改时间最新者并标注。
  candidates.sort((a, b) => fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs);
  return { ...candidates[0], duplicates: candidates.slice(1).map((c) => c.file) };
}

/**
 * 解码多帧拼接的会话日志。
 * @returns {{events: object[], frames: number, bytes: number, badLines: number}}
 */
function decodeSessionLog(file) {
  const buf = fs.readFileSync(file);
  const chunks = [];
  let frames = 0;
  let pos = 0;
  while (pos < buf.length) {
    const idx = buf.indexOf(ZSTD_MAGIC, pos);
    if (idx < 0) break;
    try {
      chunks.push(zlib.zstdDecompressSync(buf.subarray(idx)).toString('utf8'));
      frames++;
    } catch {
      /* 压缩体内部的伪魔数：忽略 */
    }
    pos = idx + ZSTD_MAGIC.length;
  }
  const events = [];
  const seen = new Set();
  let badLines = 0;
  for (const chunk of chunks) {
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        badLines++;
        continue;
      }
      const key = `${ev.type}|${ev.seq ?? 'na'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(ev);
    }
  }
  events.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return { events, frames, bytes: buf.length, badLines };
}

// ---------------------------------------------------------------------------
// 会话摘要
// ---------------------------------------------------------------------------

function firstByType(events, type) {
  const e = events.find((x) => x.type === type);
  return e || null;
}

function lastByType(events, type) {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].type === type) return events[i];
  return null;
}

function contentTexts(ev) {
  const out = [];
  const visit = (content) => {
    if (!content) return;
    if (typeof content === 'string') { out.push(content); return; }
    if (Array.isArray(content)) { for (const c of content) visit(c); return; }
    if (typeof content === 'object') {
      if (typeof content.text === 'string') out.push(content.text);
      if (content.content) visit(content.content);
    }
  };
  if (ev.type === 'user/message') visit(ev.data?.content);
  else if (ev.type === 'assistant/message') visit(ev.data?.message?.content);
  else if (ev.type === 'tool/result') visit(ev.data?.message?.content);
  return out.join('\n');
}

function summarizeSession(id, decoded, logPath) {
  const events = decoded.events;
  const sessionEvent = firstByType(events, 'session');
  const headerEvents = events.filter((e) => e.type === 'request/header' && e.data?.header);
  const firstHeader = headerEvents[0] || null;
  const lastHeader = headerEvents[headerEvents.length - 1] || null;
  const userMessages = events.filter((e) => e.type === 'user/message');
  const firstUser = userMessages[0] || null;

  const frameEvent = (type) => {
    const evs = events.filter((e) => e.type === type);
    if (evs.length === 0) return null;
    return { first: evs[0], last: evs[evs.length - 1] };
  };

  const proj = readJson(path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions', `${id}.json`));
  const projRows = proj?.record?.rows || null;
  const rowVal = (k) => (projRows && projRows[k] ? projRows[k].val : undefined);

  return {
    id,
    logPath,
    logBytes: decoded.bytes,
    frames: decoded.frames,
    badLines: decoded.badLines,
    eventCount: events.length,
    maxSeq: events.length ? events[events.length - 1].seq : null,
    session: sessionEvent
      ? {
          cwd: sessionEvent.cwd ?? null,
          parentSession: sessionEvent.parentSession ?? null,
          origin: sessionEvent.origin ?? null,
          delegationDepth: sessionEvent.delegationDepth ?? null,
          agentPreset: sessionEvent.agentPreset ?? null,
          createdAt: sessionEvent.createdAt ?? null,
          isSeeded: sessionEvent.isSeeded ?? null,
        }
      : null,
    frameEvents: {
      permissionPreset: frameEvent('permission/preset'),
      sandboxMode: frameEvent('sandbox/mode'),
      approvalPolicy: frameEvent('approval/policy'),
    },
    projcache: {
      found: Boolean(proj),
      path: path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions', `${id}.json`),
      cwd: proj?.record?.identity?.cwd ?? null,
      permissions: rowVal('permissions') ?? null,
      agentPreset: rowVal('agentPreset') ?? null,
      modelSelection: rowVal('modelSelection') ?? null,
      workingDirectory: rowVal('workingDirectory') ?? null,
    },
    firstHeader: firstHeader
      ? {
          seq: firstHeader.seq,
          config: firstHeader.data.header.config ?? null,
          toolCount: Array.isArray(firstHeader.data.header.tools) ? firstHeader.data.header.tools.length : null,
          toolNames: Array.isArray(firstHeader.data.header.tools) ? firstHeader.data.header.tools.map((t) => t.name) : null,
        }
      : null,
    lastHeader: lastHeader
      ? {
          seq: lastHeader.seq,
          config: lastHeader.data.header.config ?? null,
          toolCount: Array.isArray(lastHeader.data.header.tools) ? lastHeader.data.header.tools.length : null,
          toolNames: Array.isArray(lastHeader.data.header.tools) ? lastHeader.data.header.tools.map((t) => t.name) : null,
        }
      : null,
    lastHeaderCount: headerEvents.length,
    firstUserMessage: firstUser
      ? {
          seq: firstUser.seq,
          text: contentTexts(firstUser),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// 工作区注册表
// ---------------------------------------------------------------------------

function loadWorkspaces() {
  const file = path.join(DSH_HOME, 'storages', 'workspace.json');
  const j = readJson(file);
  if (!j) return { found: false, path: file, workspaces: [] };
  const workspaces = Object.entries(j.tables?.workspaces || {}).map(([id, w]) => ({
    id,
    path: w?.path ?? null,
    title: w?.title ?? null,
    sessionIds: Array.isArray(w?.sessionIds) ? w.sessionIds : [],
  }));
  return {
    found: true,
    path: file,
    workspaces,
    archivedSessionIds: Array.isArray(j.global?.archivedSessionIds) ? j.global.archivedSessionIds : [],
    defaultWorkspaceId: j.global?.defaultWorkspaceId ?? null,
  };
}

/** 会话被哪些工作区登记。 */
function workspacesContaining(registry, sessionId) {
  if (!sessionId) return [];
  return registry.workspaces.filter((w) => w.sessionIds.includes(sessionId)).map((w) => ({ id: w.id, path: w.path, title: w.title }));
}

/** 按路径找候选工作区。 */
function workspacesByPath(registry, p) {
  const target = normPath(p);
  if (!target) return [];
  return registry.workspaces
    .filter((w) => normPath(w.path) === target)
    .map((w) => ({ id: w.id, path: w.path, title: w.title, member: false }));
}

// ---------------------------------------------------------------------------
// 交接提示与读取证据
// ---------------------------------------------------------------------------

const HANDOFF_FILE_RE = /([A-Za-z]:\\[^\s"'<>]*?HANDOFF[^\s"'<>\\]*\.md)|HANDOFF[-A-Za-z0-9._]*\.md/i;
const PROMPT_SOURCE_RE = /You are the successor session for\s+([A-Za-z0-9._:-]+)/i;

function analyzeHandoffPrompt(summary) {
  const text = summary.firstUserMessage?.text || '';
  const srcMatch = text.match(PROMPT_SOURCE_RE);
  const fileMatch = text.match(HANDOFF_FILE_RE);
  return {
    textHead: text.slice(0, 600),
    isHandoffPrompt: /You are the successor session for/i.test(text) && /First read the handoff file at/i.test(text),
    namedSource: srcMatch ? srcMatch[1] : null,
    handoffFileMentioned: fileMatch ? fileMatch[0] : null,
  };
}

/** 在 successor 日志里找「真的读了 HANDOFF 文件」的证据。 */
function findReadEvidence(summary, handoffFileMentioned) {
  const basename = handoffFileMentioned ? path.win32.basename(handoffFileMentioned.replace(/\//g, '\\')) : null;
  const id = summary.id;
  const log = findSessionLog(id);
  if (!log) return { strong: [], weak: [], basename };
  const { events } = decodeSessionLog(log.file);
  const strong = [];
  const weak = [];

  const mentions = (s) =>
    Boolean(s) &&
    ((basename && s.includes(basename)) || /HANDOFF[-A-Za-z0-9._]*\.md/i.test(s));

  for (const ev of events) {
    if (ev.type === 'tool/call') {
      let args = {};
      try { args = JSON.parse(ev.data?.arguments || '{}'); } catch { /* ignore */ }
      const argStr = JSON.stringify(args);
      const name = ev.data?.name || '';
      const filePathArg = args.file_path || args.path || args.filePath || '';
      const cmdArg = args.command || args.cmd || args.text || '';
      // 只有「真正返回文件内容」的读取工具才算强证据；why_check/why_file/glob/grep 等
      // 仅元数据/索引查询，不算读过交接文件。
      if (/^(read|read_file|read_multiple_files|readfile)$/i.test(name) && mentions(filePathArg)) {
        strong.push({ kind: 'tool_call', tool: name, seq: ev.seq, file: filePathArg });
        continue;
      }
      if (mentions(argStr) && mentions(filePathArg)) {
        weak.push({ kind: 'tool_call_mention', tool: name, seq: ev.seq, file: filePathArg });
        continue;
      }
      if (mentions(cmdArg) && /(Get-Content|type\s|cat\s|head\s|read\s)/i.test(cmdArg)) {
        weak.push({ kind: 'command_text', tool: name, seq: ev.seq, cmd: String(cmdArg).slice(0, 200) });
      }
      continue;
    }
    if (ev.type === 'tool/result') {
      const txt = contentTexts(ev);
      if (!txt) continue;
      const looksLikeReadResult =
        /<path>[^<]*HANDOFF[^<]*<\/path>/i.test(txt) ||
        (/HANDOFF[-A-Za-z0-9._]*\.md/i.test(txt) && /#\s*Session handoff/i.test(txt));
      if (looksLikeReadResult) {
        strong.push({ kind: 'tool_result', seq: ev.seq, head: txt.slice(0, 200) });
        continue;
      }
      if (mentions(txt)) weak.push({ kind: 'tool_result_mention', seq: ev.seq, head: txt.slice(0, 200) });
      continue;
    }
    if (ev.type === 'assistant/message') {
      const txt = contentTexts(ev);
      if (!txt || !mentions(txt)) continue;
      if (/(read|read the|已读|读取|看过)/i.test(txt)) {
        weak.push({ kind: 'assistant_claim', seq: ev.seq, head: txt.slice(0, 200) });
      }
    }
  }
  const cap = (arr) => arr.slice(0, 8);
  return { strong: cap(strong), weak: cap(weak), basename };
}

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

function assertion(id, label, pass, expected, actual, detail) {
  return { id, label, pass: Boolean(pass), expected, actual, ...(detail !== undefined ? { detail } : {}) };
}

/** 源「生效态」：优先 projcache 当前投影，缺失时退回日志最后一个事件。 */
function sourceEffective(source) {
  const p = source.projcache?.permissions || {};
  const fromProj = {
    permissionPreset: p.preset ?? null,
    sandboxMode: p.sandbox ?? null,
    approvalPolicy: p.approval ?? null,
  };
  const fromLog = {
    permissionPreset: source.frameEvents.permissionPreset?.last?.data?.preset ?? null,
    sandboxMode: source.frameEvents.sandboxMode?.last?.data?.mode ?? null,
    approvalPolicy: source.frameEvents.approvalPolicy?.last?.data?.policy ?? null,
  };
  const pick = (k) => fromProj[k] ?? fromLog[k];
  return {
    permissionPreset: pick('permissionPreset'),
    sandboxMode: pick('sandboxMode'),
    approvalPolicy: pick('approvalPolicy'),
    fromProj,
    fromLog,
    projcacheUsed: source.projcache?.found ?? false,
  };
}

function successorFirstFrame(successor) {
  return {
    permissionPreset: successor.frameEvents.permissionPreset?.first?.data?.preset ?? null,
    sandboxMode: successor.frameEvents.sandboxMode?.first?.data?.mode ?? null,
    approvalPolicy: successor.frameEvents.approvalPolicy?.first?.data?.policy ?? null,
  };
}

function diffToolNames(a, b) {
  const setA = new Set(a || []);
  const setB = new Set(b || []);
  const missing = [...setA].filter((n) => !setB.has(n));
  const extra = [...setB].filter((n) => !setA.has(n));
  return { missing, extra };
}

function buildAssertions(opts, source, successor, registry, prompt, readEvidence) {
  const out = [];
  const eff = sourceEffective(source);
  const succ = successorFirstFrame(successor);

  // 1. cwd
  const srcCwd = source.session?.cwd || source.projcache?.cwd || source.projcache?.workingDirectory;
  const succCwd = successor.session?.cwd || successor.projcache?.cwd || successor.projcache?.workingDirectory;
  const cwdPass = Boolean(srcCwd && succCwd && normPath(srcCwd) === normPath(succCwd));
  out.push(assertion('cwd_match', 'successor cwd 与源相同', cwdPass, srcCwd, succCwd, {
    sourceProjcacheWorkingDirectory: source.projcache?.workingDirectory ?? null,
    successorProjcacheWorkingDirectory: successor.projcache?.workingDirectory ?? null,
  }));

  // 2. 工作区归属
  const srcHomes = workspacesContaining(registry, source.id);
  const succHomes = workspacesContaining(registry, successor.id);
  const byPath = workspacesByPath(registry, succCwd || srcCwd);
  let wsPass = false;
  let wsExpected;
  let wsDetail;
  if (opts.expectKind === 'sibling') {
    // 子会话（continuable subagent）按设计不写工作区注册表；断言与源保持「同归属状态」。
    const same = (srcHomes.length > 0) === (succHomes.length > 0);
    const sameIds = same && srcHomes.length === succHomes.length &&
      srcHomes.every((s) => succHomes.some((h) => h.id === s.id));
    wsPass = same && sameIds;
    wsExpected = { membershipParityWithSource: true, sourceHomes: srcHomes.map((h) => h.id), sourceCwdWorkspaces: byPath.map((w) => w.id) };
    wsDetail = { rationale: 'sibling 接替为 continuable subagent 会话，按 DSH 现有设计不登记到 workspace.sessionIds；断言与源同归属状态（都未登记视为一致）。' };
  } else {
    // root 路径：必须出现在与 cwd 同路径的工作区 sessionIds 中（侧栏分组依据）。
    const targetWs = byPath[0] || null;
    const memberOfTarget = targetWs ? succHomes.some((h) => h.id === targetWs.id) : false;
    wsPass = Boolean(targetWs) && memberOfTarget;
    wsExpected = {
      workspaceWithCwd: targetWs ? { id: targetWs.id, path: targetWs.path } : null,
      sessionIdsContainsSuccessor: memberOfTarget,
    };
    wsDetail = {
      successorWorkspaces: succHomes,
      sourceWorkspaces: srcHomes,
      note: succHomes.length === 0 ? 'successor 不在任何 workspace.sessionIds → 侧栏「未分组」' : undefined,
    };
  }
  out.push(assertion('workspace_attribution', 'successor 归属源 workspace（分组可见）', wsPass, wsExpected, {
    successor: succHomes.map((h) => ({ id: h.id, path: h.path })),
    workspacesWithSamePath: byPath.map((w) => ({ id: w.id, path: w.path })),
  }, wsDetail));

  // 3. 首帧 permission/preset
  out.push(assertion(
    'first_frame_permission_preset',
    'successor 首帧 permission/preset == 源生效权限预设',
    succ.permissionPreset !== null && succ.permissionPreset === eff.permissionPreset,
    eff.permissionPreset,
    succ.permissionPreset,
    { sourceFromProjcache: eff.fromProj.permissionPreset, sourceFromLogLastEvent: eff.fromLog.permissionPreset, sourceFirstFrame: source.frameEvents.permissionPreset?.first?.data?.preset ?? null },
  ));

  // 4. 首帧 sandbox/mode
  out.push(assertion(
    'first_frame_sandbox_mode',
    'successor 首帧 sandbox/mode == 源生效 sandbox 模式',
    succ.sandboxMode !== null && succ.sandboxMode === eff.sandboxMode,
    eff.sandboxMode,
    succ.sandboxMode,
    { sourceFromProjcache: eff.fromProj.sandboxMode, sourceFromLogLastEvent: eff.fromLog.sandboxMode, sourceFirstFrame: source.frameEvents.sandboxMode?.first?.data?.mode ?? null },
  ));

  // 5. 首帧 approval/policy
  out.push(assertion(
    'first_frame_approval_policy',
    'successor 首帧 approval/policy == 源生效审批策略',
    succ.approvalPolicy !== null && succ.approvalPolicy === eff.approvalPolicy,
    eff.approvalPolicy,
    succ.approvalPolicy,
    { sourceFromProjcache: eff.fromProj.approvalPolicy, sourceFromLogLastEvent: eff.fromLog.approvalPolicy, sourceFirstFrame: source.frameEvents.approvalPolicy?.first?.data?.policy ?? null },
  ));

  // 6. agentPreset
  const srcAgentPreset = source.session?.agentPreset ?? source.projcache?.agentPreset ?? null;
  const succAgentPreset = successor.session?.agentPreset ?? successor.projcache?.agentPreset ?? null;
  out.push(assertion(
    'agent_preset',
    'successor agentPreset == 源 agentPreset',
    succAgentPreset !== null && succAgentPreset === srcAgentPreset,
    srcAgentPreset,
    succAgentPreset,
    { sourceSessionEvent: source.session?.agentPreset ?? null, sourceProjcache: source.projcache?.agentPreset ?? null, successorSessionEvent: successor.session?.agentPreset ?? null, successorProjcache: successor.projcache?.agentPreset ?? null },
  ));

  // 7. request/header config
  const srcCfg = source.lastHeader?.config || source.firstHeader?.config || null;
  const succCfg = successor.firstHeader?.config || null;
  const cfgKeys = ['provider', 'model', 'reasoningEffort', 'maxTokens'];
  const cfgDiffs = [];
  if (srcCfg && succCfg) {
    for (const k of cfgKeys) {
      if (JSON.stringify(srcCfg[k]) !== JSON.stringify(succCfg[k])) {
        cfgDiffs.push({ key: k, source: srcCfg[k] ?? null, successor: succCfg[k] ?? null });
      }
    }
  }
  out.push(assertion(
    'header_config',
    'request/header config（provider/model/reasoningEffort/maxTokens）与源相等',
    Boolean(srcCfg && succCfg) && cfgDiffs.length === 0,
    srcCfg ? Object.fromEntries(cfgKeys.map((k) => [k, srcCfg[k] ?? null])) : null,
    succCfg ? Object.fromEntries(cfgKeys.map((k) => [k, succCfg[k] ?? null])) : null,
    { sourceHeaderSeq: source.lastHeader?.seq ?? null, successorHeaderSeq: successor.firstHeader?.seq ?? null, diffs: cfgDiffs, sourceFirstHeaderConfig: source.firstHeader?.config ?? null },
  ));

  // 8. tools 数量
  const srcTools = source.lastHeader?.toolCount ?? null;
  const succTools = successor.firstHeader?.toolCount ?? null;
  const toolDiff = srcTools !== null && succTools !== null
    ? diffToolNames(source.lastHeader?.toolNames || [], successor.firstHeader?.toolNames || [])
    : { missing: [], extra: [] };
  out.push(assertion(
    'tools_count',
    'successor 首帧 tools 数量 == 源最近一帧 tools 数量',
    srcTools !== null && succTools !== null && srcTools === succTools,
    srcTools,
    succTools,
    {
      sourceHeaderSeq: source.lastHeader?.seq ?? null,
      successorHeaderSeq: successor.firstHeader?.seq ?? null,
      missingInSuccessorCount: toolDiff.missing.length,
      extraInSuccessorCount: toolDiff.extra.length,
      missingInSuccessor: toolDiff.missing.slice(0, 40),
      extraInSuccessor: toolDiff.extra.slice(0, 40),
    },
  ));

  // 9. 首轮消息是交接提示
  out.push(assertion(
    'handoff_prompt_present',
    'successor 首轮 user/message 是交接提示（含 handoff 文件路径）',
    prompt.isHandoffPrompt && Boolean(prompt.handoffFileMentioned),
    { isHandoffPrompt: true, handoffFile: 'HANDOFF-*.md' },
    { isHandoffPrompt: prompt.isHandoffPrompt, handoffFile: prompt.handoffFileMentioned, firstUserSeq: successor.firstUserMessage?.seq ?? null, textHead: prompt.textHead.slice(0, 200) },
  ));

  // 10. 交接提示点名的源 == --source
  const named = prompt.namedSource ? normalizeSessionId(prompt.namedSource) : null;
  const wantSource = normalizeSessionId(opts.source);
  out.push(assertion(
    'handoff_prompt_names_source',
    '交接提示点名的源会话 == --source（防止配对错误）',
    Boolean(named) && named === wantSource,
    opts.source,
    prompt.namedSource,
    { normalized: { named, expected: wantSource } },
  ));

  // 11. 读取 HANDOFF 文件的证据
  out.push(assertion(
    'handoff_file_read',
    'successor 首轮确有读取 HANDOFF 文件的证据（read 调用 / 含文件内容的 tool/result）',
    readEvidence.strong.length > 0,
    '>=1 条强证据',
    readEvidence.strong.length,
    { strong: readEvidence.strong, weakClaims: readEvidence.weak, basename: readEvidence.basename },
  ));

  // 12. 接替类型
  if (opts.expectKind) {
    let pass = false;
    let actual;
    if (opts.expectKind === 'root') {
      pass = !successor.session?.parentSession && (successor.session?.delegationDepth ?? 0) === 0;
      actual = { parentSession: successor.session?.parentSession ?? null, delegationDepth: successor.session?.delegationDepth ?? null };
    } else {
      pass =
        (successor.session?.parentSession || null) === (source.session?.parentSession || null) &&
        (successor.session?.delegationDepth ?? null) === (source.session?.delegationDepth ?? null);
      actual = {
        successorParent: successor.session?.parentSession ?? null,
        sourceParent: source.session?.parentSession ?? null,
        successorDepth: successor.session?.delegationDepth ?? null,
        sourceDepth: source.session?.delegationDepth ?? null,
      };
    }
    out.push(assertion('successor_kind', `successor 接替类型 == ${opts.expectKind}`, pass, opts.expectKind, actual));
  }

  // 13/14. 显式期望值（任务书参数）
  if (opts.expectPermissionPreset) {
    out.push(assertion(
      'expected_permission_preset',
      `successor 首帧 permission/preset == ${opts.expectPermissionPreset}（显式期望）`,
      succ.permissionPreset === opts.expectPermissionPreset,
      opts.expectPermissionPreset,
      succ.permissionPreset,
    ));
  }
  if (opts.expectAgentPreset) {
    out.push(assertion(
      'expected_agent_preset',
      `successor agentPreset == ${opts.expectAgentPreset}（显式期望）`,
      succAgentPreset === opts.expectAgentPreset,
      opts.expectAgentPreset,
      succAgentPreset,
    ));
  }

  return out;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForSessionLog(id, waitMs, needComplete) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const log = findSessionLog(id);
    if (log) {
      const decoded = decodeSessionLog(log.file);
      const hasHeader = decoded.events.some((e) => e.type === 'request/header');
      const hasEnd = decoded.events.some((e) => e.type === 'turn/end');
      const ready = needComplete ? hasHeader && hasEnd : true;
      if (ready || Date.now() >= deadline) return { log, decoded };
    } else if (Date.now() >= deadline) {
      return { log: null, decoded: null };
    }
    await sleep(500);
  }
}

function logOrNull(id) {
  const log = findSessionLog(id);
  if (!log) return { log: null, decoded: null };
  return { log, decoded: decodeSessionLog(log.file) };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`verify-handoff: ${e.message}\n`);
    process.exit(2);
  }

  const registry = loadWorkspaces();

  const srcWaited = opts.waitMs
    ? await waitForSessionLog(opts.source, opts.waitMs, false)
    : logOrNull(opts.source);
  if (!srcWaited.log) {
    process.stderr.write(`verify-handoff: source session log not found for ${opts.source} under ${path.join(DSH_HOME, 'sessions')}\n`);
    process.exit(2);
  }

  const succWaited = opts.waitMs
    ? await waitForSessionLog(opts.successor, opts.waitMs, true)
    : logOrNull(opts.successor);
  if (!succWaited.log) {
    process.stderr.write(`verify-handoff: successor session log not found for ${opts.successor} under ${path.join(DSH_HOME, 'sessions')}\n`);
    process.exit(2);
  }

  const source = summarizeSession(opts.source, srcWaited.decoded, srcWaited.log.file);
  const successor = summarizeSession(opts.successor, succWaited.decoded, succWaited.log.file);
  const prompt = analyzeHandoffPrompt(successor);
  const readEvidence = findReadEvidence(successor, prompt.handoffFileMentioned);
  const assertions = buildAssertions(opts, source, successor, registry, prompt, readEvidence);

  const pass = assertions.filter((a) => a.pass).length;
  const fail = assertions.length - pass;
  const report = {
    tool: 'verify-handoff',
    generatedAt: new Date().toISOString(),
    dshHome: DSH_HOME,
    options: {
      source: opts.source,
      successor: opts.successor,
      expectKind: opts.expectKind,
      expectPermissionPreset: opts.expectPermissionPreset,
      expectAgentPreset: opts.expectAgentPreset,
    },
    paths: {
      sourceLog: srcWaited.log.file,
      successorLog: succWaited.log.file,
      workspaceRegistry: registry.path,
      sourceProjcache: source.projcache.path,
      successorProjcache: successor.projcache.path,
    },
    sessions: {
      source: {
        id: source.id,
        session: source.session,
        firstFrame: {
          permissionPreset: source.frameEvents.permissionPreset?.first?.data ?? null,
          sandboxMode: source.frameEvents.sandboxMode?.first?.data ?? null,
          approvalPolicy: source.frameEvents.approvalPolicy?.first?.data ?? null,
        },
        lastFrame: {
          permissionPreset: source.frameEvents.permissionPreset?.last?.data ?? null,
          sandboxMode: source.frameEvents.sandboxMode?.last?.data ?? null,
          approvalPolicy: source.frameEvents.approvalPolicy?.last?.data ?? null,
        },
        projcache: source.projcache,
        firstHeader: source.firstHeader ? { seq: source.firstHeader.seq, config: source.firstHeader.config, toolCount: source.firstHeader.toolCount } : null,
        lastHeader: source.lastHeader ? { seq: source.lastHeader.seq, config: source.lastHeader.config, toolCount: source.lastHeader.toolCount } : null,
        headerCount: source.lastHeaderCount,
        eventCount: source.eventCount,
      },
      successor: {
        id: successor.id,
        session: successor.session,
        firstFrame: {
          permissionPreset: successor.frameEvents.permissionPreset?.first?.data ?? null,
          sandboxMode: successor.frameEvents.sandboxMode?.first?.data ?? null,
          approvalPolicy: successor.frameEvents.approvalPolicy?.first?.data ?? null,
        },
        projcache: successor.projcache,
        firstHeader: successor.firstHeader ? { seq: successor.firstHeader.seq, config: successor.firstHeader.config, toolCount: successor.firstHeader.toolCount } : null,
        eventCount: successor.eventCount,
        firstUserMessage: prompt.textHead,
        handoffPrompt: {
          isHandoffPrompt: prompt.isHandoffPrompt,
          namedSource: prompt.namedSource,
          handoffFileMentioned: prompt.handoffFileMentioned,
        },
        readEvidence,
      },
    },
    workspace: {
      registryFound: registry.found,
      sourceWorkspaces: workspacesContaining(registry, source.id).map((h) => ({ id: h.id, path: h.path })),
      successorWorkspaces: workspacesContaining(registry, successor.id).map((h) => ({ id: h.id, path: h.path })),
      workspacesWithSuccessorCwd: workspacesByPath(registry, successor.session?.cwd || source.session?.cwd).map((w) => ({ id: w.id, path: w.path })),
      archivedSessionIdsContainsSuccessor: registry.archivedSessionIds?.includes(successor.id) ?? false,
    },
    assertions,
    summary: {
      total: assertions.length,
      pass,
      fail,
      verdict: fail === 0 ? 'PASS' : 'FAIL',
    },
  };

  const json = JSON.stringify(report, null, 2);
  if (opts.out) fs.writeFileSync(opts.out, json + '\n', 'utf8');

  if (opts.json) {
    process.stdout.write(json + '\n');
  } else {
    printHuman(report);
  }
  process.exit(fail === 0 ? 0 : 1);
}

function printHuman(report) {
  const lines = [];
  lines.push(`verify-handoff  ${report.generatedAt}`);
  lines.push(`  source    : ${report.options.source}`);
  lines.push(`  successor : ${report.options.successor}${report.options.expectKind ? `  (expect kind=${report.options.expectKind})` : ''}`);
  lines.push(`  source log: ${report.paths.sourceLog}`);
  lines.push(`  succ  log : ${report.paths.successorLog}`);
  lines.push('');
  lines.push(`  ${'RESULT'.padEnd(7)} ${'ASSERTION'.padEnd(32)} DETAIL`);
  for (const a of report.assertions) {
    const head = `${a.pass ? 'PASS' : 'FAIL'}`.padEnd(7);
    const name = a.id.padEnd(32);
    let detail = '';
    if (a.pass) {
      detail = `ok (${short(a.actual)})`;
    } else {
      detail = `expected=${short(a.expected)} actual=${short(a.actual)}`;
    }
    lines.push(`  ${head} ${name} ${detail}`);
  }
  lines.push('');
  lines.push(`  SUMMARY: ${report.summary.pass}/${report.summary.total} PASS, ${report.summary.fail} FAIL → ${report.summary.verdict}`);
  lines.push('');
  lines.push('  --- 关键事实 ---');
  const s = report.sessions.source;
  const u = report.sessions.successor;
  lines.push(`  source  firstFrame: preset=${JSON.stringify(s.firstFrame.permissionPreset)} sandbox=${JSON.stringify(s.firstFrame.sandboxMode)} approval=${JSON.stringify(s.firstFrame.approvalPolicy)} agentPreset=${JSON.stringify(s.session?.agentPreset ?? s.projcache?.agentPreset ?? null)}`);
  lines.push(`  succ    firstFrame: preset=${JSON.stringify(u.firstFrame.permissionPreset)} sandbox=${JSON.stringify(u.firstFrame.sandboxMode)} approval=${JSON.stringify(u.firstFrame.approvalPolicy)} agentPreset=${JSON.stringify(u.session?.agentPreset ?? u.projcache?.agentPreset ?? null)}`);
  lines.push(`  source  tools=${s.lastHeader?.toolCount ?? '?'}  succ tools=${u.firstHeader?.toolCount ?? '?'}`);
  lines.push(`  workspace attrib: sourceHomes=${JSON.stringify(report.workspace.sourceWorkspaces)} succHomes=${JSON.stringify(report.workspace.successorWorkspaces)}`);
  lines.push(`  prompt names source: ${JSON.stringify(u.handoffPrompt.namedSource)}; handoff file: ${JSON.stringify(u.handoffPrompt.handoffFileMentioned)}`);
  lines.push(`  read evidence: strong=${report.sessions.successor.readEvidence.strong.length} weak=${report.sessions.successor.readEvidence.weak.length}`);
  process.stdout.write(lines.join('\n') + '\n');
}

function short(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > 110 ? s.slice(0, 107) + '...' : s;
}

main().catch((e) => {
  process.stderr.write(`verify-handoff: unexpected error: ${e?.stack || e}\n`);
  process.exit(3);
});
