#!/usr/bin/env node
/**
 * summarize-run.mjs — 一次「极简提示词 → skill 驱动分层执行」运行的工具序列证据汇总。
 *
 * 输入一个会话 id（通常是 spawn 出来的实验根会话），只读解码其会话日志，输出：
 *   1. 工具调用序列（seq / 工具名 / 参数摘要 / 结果头 200 字），完整可审计；
 *   2. tree_* 使用情况：tree_plan 建树、tree_node 建点（含 parent/role/taskType/dependencies）、
 *      tree_dispatch 派发、tree_report 上报（brief_echo/progress/context/done）、tree_verify 裁决；
 *   3. session_handoff 调用与返回（status 的 context_pct/threshold/model/preset/permission；
 *      handoff 的 successor id/kind/preset/workspace/inherited）；
 *   4. 子会话列表：从 subagent/tree_dispatch 工具结果 + `started subagent <id>` 提取，
 *      并扫同 workspace 的会话日志 parentSession 链补全（含子会话首轮提示词里的
 *      `你是树节点 <tree>/<leaf> 的执行者` 叶子归属），逐子会话汇总工具数/树调用/handoff；
 *   5. 分层启发式判定：树的最大深度、节点角色、各层是否真的干了活（done/verify 证据）、
 *      派发发生在哪些深度的会话里、交接发生在哪一层；
 *   6. `<available_skills>` 中 3 个目标 skill 的可见性（与 collect-skills.mjs 同口径，便于单命令取证）。
 *
 * 用法：
 *   node scripts/skill-e2e/summarize-run.mjs <sessionId> [options]
 *
 * 选项：
 *   --session <id>          会话 id（可重复；也可作位置参数）
 *   --child-depth <n>       子会话递归发现深度（默认 2：中间层+执行层）
 *   --scan-workspace all|same  子会话日志扫描范围（默认 same=与父会话同 workspace 编码目录）
 *   --max-calls <n>         toolSequence 打印上限（JSON 里总是全量，默认 human 打印 120）
 *   --json                  仅输出 JSON
 *   --out <file>            JSON 报告另存到文件
 *   --no-children           不扫描子会话
 *   --help
 *
 * 退出码：0 = 成功产出；2 = 参数/日志缺失。
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
  firstByType,
  lastByType,
  normSessionId,
  parseArgs,
  readJson,
  readSessionMeta,
  summarizeArgs,
  toolCallOf,
  toolResultOf,
} from './lib.mjs';

const TARGET_SKILLS = ['tree-commander', 'tree-worker', 'session-handoff'];
const TREE_TOOLS = ['tree_plan', 'tree_node', 'tree_dispatch', 'tree_report', 'tree_status', 'tree_verify', 'tree_log', 'tree_maintain'];

function printHelp() {
  const text = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const m = text.match(/\/\*\*([\s\S]*?)\*\//);
  process.stdout.write((m ? m[1] : text).replace(/^\s*\* ?/gm, '') + '\n');
}

// ---------------------------------------------------------------------------
// 单会话取证
// ---------------------------------------------------------------------------

function indexResults(events) {
  /** callId / sourceEventSeq 双口径关联 tool/call ↔ tool/result。 */
  const byCallId = new Map();
  const bySourceSeq = new Map();
  for (const ev of events) {
    if (ev.type !== 'tool/result') continue;
    const r = toolResultOf(ev);
    if (r.callId) byCallId.set(r.callId, r);
    const src = ev.sourceEventSeqs?.[0];
    if (typeof src === 'number') bySourceSeq.set(src, r);
  }
  return { byCallId, bySourceSeq };
}

function summarizeSession(id) {
  const log = findSessionLog(id);
  if (!log) return { id: normSessionId(id), error: 'session log not found', log: null };
  const decoded = decodeSessionLog(log.file);
  const events = decoded.events;
  const sessionEv = firstByType(events, 'session') || {};
  const headers = events.filter((e) => e.type === 'request/header' && e.data?.header);
  const lastHeader = headers[headers.length - 1] || null;
  const { byCallId, bySourceSeq } = indexResults(events);

  const calls = [];
  for (const ev of events) {
    if (ev.type !== 'tool/call') continue;
    const c = toolCallOf(ev);
    const result = (c.callId && byCallId.get(c.callId)) || bySourceSeq.get(ev.seq) || null;
    calls.push({ ...c, result });
  }
  const toolCounts = {};
  for (const c of calls) toolCounts[c.name] = (toolCounts[c.name] || 0) + 1;

  const tree = { plan: [], nodes: [], dispatch: [], reports: [], verify: [], status: [], log: [], maintain: [], send: [] };
  const handoff = [];
  const subagents = [];
  const skillLoads = [];
  const okOf = (r) => (r ? !(r.isError || /^Error:/.test(r.text || '')) : null);
  for (const c of calls) {
    const a = c.args || {};
    if (c.name === 'tree_plan') tree.plan.push({ seq: c.seq, tree_id: a.tree_id, root_brief: head(a.root_brief, 160), root_dod: head(a.root_dod, 160), session_id: a.session_id, ok: okOf(c.result) });
    else if (c.name === 'tree_node') tree.nodes.push({ seq: c.seq, action: a.action, tree_id: a.tree_id, leaf: a.leaf || null, leaf_id: a.leaf_id, status: a.status, ok: okOf(c.result), result: c.result?.text ?? null });
    else if (c.name === 'tree_dispatch') tree.dispatch.push({ seq: c.seq, action: a.action, tree_id: a.tree_id, leaf_id: a.leaf_id, ok: okOf(c.result), result: c.result?.text ?? null });
    else if (c.name === 'tree_report') tree.reports.push({ seq: c.seq, action: a.action, tree_id: a.tree_id, leaf_id: a.leaf_id, type: a.type, meta: a.meta ?? null, pct: a.pct ?? null, ok: okOf(c.result), result: c.result?.text ?? null });
    else if (c.name === 'tree_verify') tree.verify.push({ seq: c.seq, action: a.action, tree_id: a.tree_id, leaf_id: a.leaf_id, ok: okOf(c.result), result: c.result?.text ?? null });
    else if (c.name === 'tree_status') tree.status.push({ seq: c.seq, action: a.action, tree_id: a.tree_id, result: c.result?.text ?? null });
    else if (c.name === 'tree_log') tree.log.push({ seq: c.seq, action: a.action, tree_id: a.tree_id, leaf_id: a.leaf_id, type: a.type });
    else if (c.name === 'tree_maintain') tree.maintain.push({ seq: c.seq, action: a.action, tree_id: a.tree_id });
    else if (c.name === 'tree_send') tree.send.push({ seq: c.seq, args: a, result: c.result?.text ?? null });
    else if (c.name === 'session_handoff') handoff.push({ seq: c.seq, args: a, parsed: parseHandoff(a, c.result), result: c.result?.text ?? null });
    else if (c.name === 'subagent' || c.name === 'subagent_fork') {
      const childId = extractChildId(c.result);
      subagents.push({ seq: c.seq, tool: c.name, description: a.description ?? null, promptHead: head(a.prompt, 240), childId, resultHead: head(c.result?.text, 200) });
    } else if (c.name === 'skill') {
      skillLoads.push({ seq: c.seq, name: a.name || a.skill || null });
    }
  }

  const skills = findAvailableSkills(events);
  const skillNames = skills.names.map((n) => n.name);
  const targetsAt = (names) => Object.fromEntries(TARGET_SKILLS.map((n) => [n, (names || []).includes(n)]));
  const targets = targetsAt(skills.latest?.names || skillNames);
  const evolution = (skills.hits || []).map((h) => ({ seq: h.seq, count: h.count, targets: TARGET_SKILLS.filter((n) => h.names.includes(n)) }));

  const assistantFinal = lastByType(events, 'assistant/message');
  const userMessages = events.filter((e) => e.type === 'user/message');

  return {
    id: normSessionId(id),
    log: log.file,
    workspaceEncoding: log.workspaceEncoding,
    session: {
      cwd: sessionEv.cwd ?? null,
      parentSession: sessionEv.parentSession ?? null,
      origin: sessionEv.origin ?? null,
      delegationDepth: sessionEv.delegationDepth ?? null,
      agentPreset: sessionEv.agentPreset ?? null,
      createdAt: sessionEv.createdAt ?? null,
    },
    header: lastHeader ? { seq: lastHeader.seq, config: lastHeader.data.header.config ?? null, toolCount: lastHeader.data.header.tools?.length ?? null, headerCount: headers.length } : null,
    eventCount: events.length,
    firstUserMessage: userMessages[0] ? { seq: userMessages[0].seq, text: contentTexts(userMessages[0]) } : null,
    assistantFinal: assistantFinal ? { seq: assistantFinal.seq, text: head(contentTexts(assistantFinal), 600) } : null,
    skills: { found: skills.found, firstSeq: skills.firstSeq ?? null, count: skillNames.length, names: skillNames, targets, evolution, loaded: skillLoads },
    tree,
    handoff,
    subagents,
    toolCounts,
    toolSequence: calls.map((c) => ({ seq: c.seq, name: c.name, argsSummary: summarizeArgs(c.args, 220), resultHead: head(c.result?.text, 200), resultIsError: c.result?.isError ?? null })),
    _calls: calls,
  };
}

function head(s, n) {
  if (!s) return s;
  const one = String(s).replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

function extractChildId(result) {
  if (!result) return null;
  const t = result.text || '';
  const m = t.match(/started subagent\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (m) return m[1];
  if (result.json) {
    for (const k of ['id', 'childId', 'sessionId', 'session_id']) {
      const v = result.json[k];
      if (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) return v;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// session_handoff 返回解析
// ---------------------------------------------------------------------------

const UNAVAILABLE = /^unavailable$/i;

function numOrNull(s) {
  if (s == null) return null;
  if (typeof s === 'number') return s;
  if (UNAVAILABLE.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseHandoff(args = {}, result = null) {
  const text = result?.text || '';
  const out = { action: args.action || null, text: head(text, 400), status: null, handoff: null };
  const statusRe = /context=(\S+?)\s*%\s*\(threshold\s*([\d.]+)%\)\s*(?:pressure=(\S+))?\s*(?:model=(\S+))?\s*(?:effort=(\S+))?\s*(?:preset=(\S+))?\s*(?:permission=(\S+))?\s*successor=(\S+)/i;
  const sm = text.match(statusRe);
  if (sm) {
    out.status = {
      context_pct: numOrNull(sm[1]),
      context_pct_raw: sm[1],
      threshold_pct: numOrNull(sm[2]),
      pressure: sm[3] ?? null,
      model: sm[4] ?? null,
      effort: sm[5] ?? null,
      preset: sm[6] ?? null,
      permission: sm[7] ?? null,
      successor_kind: sm[8] ?? null,
      raw: head(text, 400),
    };
  }
  // "session_handoff status: context=unavailable (threshold 50%) ..."
  const sm2 = text.match(/context=(unavailable)\s*\(threshold\s*([\d.]+)%\)/i);
  if (sm2) out.status = { context_pct: null, context_pct_raw: 'unavailable', threshold_pct: numOrNull(sm2[2]), successor_kind: (text.match(/successor=(\S+)/i) || [])[1] ?? null, raw: head(text, 400), degraded: true };

  const hm = text.match(/session_handoff:\s*wrote\s+(.+?);\s*successor\s+(\S+)\s+kind=(\S+)(.*)$/i);
  if (hm) {
    const rest = hm[4] || '';
    out.handoff = {
      handoff_path: hm[1].trim(),
      successor_id: normSessionId(hm[2]),
      kind: hm[3],
      preset: (rest.match(/preset=(\S+)/i) || [])[1] ?? null,
      workspace: (rest.match(/workspace=(\S+)/i) || [])[1] ?? null,
      inherited: (rest.match(/inherited=(\S+)/i) || [])[1] ?? null,
      degraded: (rest.match(/degraded=(\S+)/i) || [])[1] ?? null,
    };
  }
  const fm = text.match(/successor FAILED:\s*(.+)$/i);
  if (fm) out.handoff = { ...(out.handoff || {}), failed: fm[1].trim() };
  if (/session_handoff rejected:/i.test(text)) out.rejected = head(text, 300);
  if (/no successor spawned/i.test(text)) out.handoff = { ...(out.handoff || {}), spawn: false };
  return out;
}

// ---------------------------------------------------------------------------
// 子会话发现（parentSession 链 + 同 workspace 扫目录）
// ---------------------------------------------------------------------------

function discoverChildren({ roots, maxDepth, workspaceEncoding, scanWorkspace }) {
  const root = path.join(DSH_HOME, 'sessions');
  let dirs = [];
  const bonus = [];
  if (scanWorkspace === 'same' && workspaceEncoding) bonus.push(workspaceEncoding);
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { /* ignore */ }
  const scanDirs = scanWorkspace === 'same' ? [...new Set(bonus)] : dirs;
  const found = new Map(); // id -> {id, meta, depth, parentId}
  let frontier = roots.map((r) => ({ id: normSessionId(r.id), createdAt: r.session?.createdAt ?? 0 }));
  const visited = new Set(frontier.map((f) => f.id));
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const parentIds = new Set(frontier.map((f) => f.id));
    const minCreated = Math.min(...frontier.map((f) => f.createdAt || 0));
    const next = [];
    for (const ws of scanDirs) {
      let entries = [];
      try { entries = fs.readdirSync(path.join(root, ws), { withFileTypes: true }); } catch { continue; }
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const dirName = ent.name;
        const bare = normSessionId(dirName);
        if (visited.has(bare)) continue;
        const file = path.join(root, ws, dirName, 'session.v4.jsonl.zstd');
        let st;
        try { st = fs.statSync(file); } catch { continue; }
        if (minCreated && st.mtimeMs + 5 * 60_000 < minCreated) continue;
        const meta = readSessionMeta(file);
        if (!meta) continue;
        const parent = normSessionId(meta.parentSession);
        if (!parentIds.has(parent)) continue;
        const id = normSessionId(meta.id || bare);
        if (visited.has(id)) continue;
        visited.add(id);
        found.set(id, { id, meta, depth, parentId: parent, log: file });
        next.push({ id, createdAt: meta.createdAt ?? st.mtimeMs });
      }
    }
    frontier = next;
  }
  return [...found.values()];
}

/** 从子会话首轮提示词提取树节点归属（tree_dispatch 注入的结算指令）。 */
function extractTreeAssignment(text) {
  const m = String(text || '').match(/你是树节点\s+([\w-]+)\/([\w-]+)\s+的执行者/);
  return m ? { tree_id: m[1], leaf_id: m[2] } : null;
}

// ---------------------------------------------------------------------------
// 分层启发式
// ---------------------------------------------------------------------------

function buildLayering(allSessions) {
  const nodes = new Map(); // leaf_id -> node
  const trees = new Map(); // tree_id -> {tree_id, root_brief, root_dod, planSession}
  for (const s of allSessions) {
    for (const p of s.tree.plan) {
      if (p.ok === false) continue;
      trees.set(p.tree_id, { tree_id: p.tree_id, root_brief: p.root_brief, root_dod: p.root_dod, planSession: s.id, seq: p.seq });
      if (!nodes.has(`${p.tree_id}-root`)) {
        nodes.set(`${p.tree_id}-root`, { tree_id: p.tree_id, leaf_id: `${p.tree_id}-root`, parent: null, role: 'root', taskType: 'default', addedBy: s.id, seq: p.seq, synthesizedFromPlan: true });
      }
    }
    for (const n of s.tree.nodes) {
      if (n.action !== 'add' || !n.leaf?.leaf_id || n.ok === false) continue;
      if (!nodes.has(n.leaf.leaf_id)) {
        nodes.set(n.leaf.leaf_id, {
          tree_id: n.tree_id,
          leaf_id: n.leaf.leaf_id,
          parent: n.leaf.parent ?? null,
          role: n.leaf.role ?? null,
          taskType: n.leaf.taskType ?? null,
          dependencies: n.leaf.dependencies ?? [],
          addedBy: n.leaf.added_by ?? s.id,
          path: n.leaf.path ?? null,
          seq: n.seq,
        });
      }
    }
  }
  // 计算深度（parent 链；root 节点深度 0）
  const depthOf = new Map();
  const walk = (leafId, seen = new Set()) => {
    if (depthOf.has(leafId)) return depthOf.get(leafId);
    if (seen.has(leafId)) return 99; // 环，防御
    const node = nodes.get(leafId);
    if (!node) return 99;
    seen.add(leafId);
    const d = node.parent ? walk(node.parent, seen) + 1 : 0;
    depthOf.set(leafId, d);
    return d;
  };
  const nodeList = [...nodes.values()].map((n) => ({ ...n, depth: walk(n.leaf_id) }));
  const maxDepth = nodeList.length ? Math.max(...nodeList.map((n) => n.depth)) : -1;

  const dispatch = [];
  const reports = [];
  const verifies = [];
  const handoffs = [];
  const dispatchBySession = {};
  for (const s of allSessions) {
    const starts = s.tree.dispatch.filter((d) => d.action === 'start' && d.ok !== false);
    if (starts.length) dispatchBySession[s.id] = starts.length;
    for (const d of s.tree.dispatch) if (d.action === 'start' && d.ok !== false) dispatch.push({ ...d, session: s.id, delegationDepth: s.session.delegationDepth });
    for (const r of s.tree.reports) if (r.ok !== false) reports.push({ ...r, session: s.id, delegationDepth: s.session.delegationDepth });
    for (const v of s.tree.verify) if (v.ok !== false) verifies.push({ ...v, session: s.id, delegationDepth: s.session.delegationDepth, pass: /tree_verify:\s*PASS/.test(v.result || '') });
    for (const h of s.handoff) handoffs.push({ ...h, session: s.id, delegationDepth: s.session.delegationDepth, origin: s.session.origin });
  }

  const doneReports = reports.filter((r) => r.action === 'event' && r.type === 'done');
  const contextReports = reports.filter((r) => r.action === 'context');
  const leavesDispatched = new Set(dispatch.map((d) => d.leaf_id));
  const leavesDone = new Set(doneReports.map((r) => r.leaf_id));
  const leavesVerifiedPass = new Set(verifies.filter((v) => v.pass).map((v) => v.leaf_id));
  const roles = nodeList.reduce((acc, n) => { acc[n.role || 'unknown'] = (acc[n.role || 'unknown'] || 0) + 1; return acc; }, {});

  // 交接的层级：按发生交接的会话的 delegationDepth / origin
  const handoffActions = handoffs.filter((h) => (h.args?.action === 'handoff') && h.parsed?.handoff?.successor_id);
  const handoffInChild = handoffActions.filter((h) => (h.delegationDepth ?? 0) >= 1 || h.origin === 'subagent');

  const checks = [
    check('tree_plan_created', '运行里建了树（tree_plan create）', trees.size > 0, { trees: [...trees.keys()] }),
    check('layer_depth_ge_2', '树深度 ≥2（root→中间层→执行层 = 3 层）', maxDepth >= 2, { maxDepth, nodeCount: nodeList.length }),
    check('roles_commander_worker', '存在 commander 与 worker 角色节点', Boolean(roles.commander) && Boolean(roles.worker), { roles }),
    check('dispatch_from_multiple_layers', '至少两个不同会话执行过 tree_dispatch（每层能继续分层）', Object.keys(dispatchBySession).length >= 2, { dispatchBySession }),
    check('every_layer_worked', '执行层节点有 done 上报（各层真的干了活）', doneReports.length > 0, { doneReports: doneReports.length, leavesDone: [...leavesDone] }),
    check('leaf_dispatched_session', '至少一个 leaf 被派发到独立会话', leavesDispatched.size > 0, { leavesDispatched: [...leavesDispatched] }),
    check('verify_ran', '有 tree_verify 裁决记录', verifies.length > 0, { verifies: verifies.length, pass: verifies.filter((v) => v.pass).length }),
    check('handoff_executed', '有 session_handoff handoff 且拿到 successor', handoffActions.length > 0, { count: handoffActions.length, successors: handoffActions.map((h) => h.parsed.handoff.successor_id) }),
    check('handoff_in_non_root_layer', '交接发生在中间层/子层会话（非根层）', handoffInChild.length > 0, { handoffInChild: handoffInChild.map((h) => ({ session: h.session, depth: h.delegationDepth, kind: h.parsed.handoff.kind })) }),
    check('context_report_evidence', '有树内上下文自报（tree_report context）', contextReports.length > 0, { contextReports: contextReports.length }),
  ];

  return {
    trees: [...trees.values()],
    nodes: nodeList,
    maxDepth,
    layers: maxDepth + 1,
    roles,
    dispatch,
    dispatchBySession,
    reports,
    doneReports,
    verifies,
    handoffs,
    checks,
  };
}

function check(id, label, pass, detail) {
  return { id, label, pass: Boolean(pass), detail };
}

/**
 * 读取 tree-engine 的权威落盘状态（只读旁证，不是被测实现的返回值）：
 *   <profileDir>/tree-engine-data/<tree_id>/tree-state.json
 * 提供节点层级/状态/runtime/owner session/verification，和会话日志口径互相印证。
 */
function readTreeStates(trees, profileDir) {
  const dataRoot = path.join(profileDir, 'tree-engine-data');
  const out = [];
  for (const t of trees) {
    const file = path.join(dataRoot, t.tree_id, 'tree-state.json');
    const st = readJson(file);
    if (!st) { out.push({ tree_id: t.tree_id, found: false, path: file }); continue; }
    const leaves = Object.entries(st.leaves || {}).map(([id, l]) => ({
      leaf_id: id,
      parent: l.parent ?? null,
      role: l.role ?? null,
      taskType: l.taskType ?? null,
      status: l.status ?? null,
      runtime: l.runtime?.state ?? null,
      session_id: l.session_id ?? l.runtime?.subagentSessionId ?? null,
      verification_pass: l.verification?.pass ?? null,
    }));
    const depth = {};
    const walk = (id, set = new Set()) => {
      if (depth[id] != null) return depth[id];
      const l = leaves.find((x) => x.leaf_id === id);
      if (!l || set.has(id)) return 99;
      set.add(id);
      const d = l.parent ? walk(l.parent, set) + 1 : 0;
      depth[id] = d;
      return d;
    };
    for (const l of leaves) l.depth = walk(l.leaf_id);
    out.push({ tree_id: t.tree_id, found: true, path: file, leafCount: leaves.length, maxDepth: leaves.length ? Math.max(...leaves.map((l) => l.depth)) : -1, leaves, eventCount: (st.events || []).length });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2), {
    session: [],
    'child-depth': '2',
    'scan-workspace': 'same',
    'max-calls': '120',
    json: false,
    out: null,
    'no-children': false,
    'profile-dir': null,
  });
  if (opts.help) { printHelp(); return 0; }
  const ids = allSessionIds(opts);
  if (ids.length === 0) {
    process.stderr.write('usage: summarize-run.mjs <sessionId> [--json] [--out file] [--child-depth 2]\n');
    return 2;
  }
  const childDepth = Number(opts['child-depth']);
  const maxCalls = Number(opts['max-calls']);
  const scanWorkspace = opts['scan-workspace'];

  const roots = ids.map((id) => summarizeSession(id));
  const missing = roots.filter((r) => r.error);
  if (missing.length === roots.length) {
    process.stderr.write(`summarize-run: no session log found for ${missing.map((m) => m.id).join(', ')}\n`);
    return 2;
  }

  const all = [...roots];
  const childrenIndex = [];
  if (!opts['no-children']) {
    for (const r of roots) {
      if (r.error) continue;
      const kids = discoverChildren({ roots: [r], maxDepth: childDepth, workspaceEncoding: r.workspaceEncoding, scanWorkspace });
      for (const k of kids) {
        const sum = summarizeSession(k.id);
        if (sum.error) continue;
        sum.discovered = { depth: k.depth, parentId: k.parentId, via: 'parentSession' };
        sum.treeAssignment = extractTreeAssignment(sum.firstUserMessage?.text);
        childrenIndex.push({ id: k.id, parentId: k.parentId, depth: k.depth, assignment: sum.treeAssignment });
        all.push(sum);
      }
    }
  }

  const layering = buildLayering(all);
  const profileDir = opts['profile-dir'] || path.join(DSH_HOME, 'profiles', 'desktop');
  layering.treeStates = readTreeStates(layering.trees, profileDir);

  const report = {
    tool: 'summarize-run',
    generatedAt: new Date().toISOString(),
    dshHome: DSH_HOME,
    profileDir,
    options: { session: ids, childDepth, scanWorkspace },
    sessions: all.map(stripInternal),
    children: childrenIndex,
    layering: stripLayering(layering),
    summary: {
      sessions: all.length,
      roots: roots.length,
      children: childrenIndex.length,
      checks: layering.checks,
      passCount: layering.checks.filter((c) => c.pass).length,
      totalChecks: layering.checks.length,
    },
  };

  const json = JSON.stringify(report, null, 2);
  if (opts.out) fs.writeFileSync(opts.out, json + '\n', 'utf8');
  if (opts.json) process.stdout.write(json + '\n');
  else printHuman(report, maxCalls);
  return 0;
}

function stripInternal(s) {
  const { _calls, ...rest } = s;
  return rest;
}

function stripLayering(l) {
  return {
    trees: l.trees,
    nodes: l.nodes,
    maxDepth: l.maxDepth,
    layers: l.layers,
    roles: l.roles,
    dispatch: l.dispatch,
    dispatchBySession: l.dispatchBySession,
    doneReports: l.doneReports,
    verifies: l.verifies.map((v) => ({ seq: v.seq, session: v.session, leaf_id: v.leaf_id, pass: v.pass, result: v.result })),
    handoffs: l.handoffs,
    treeStates: l.treeStates,
    checks: l.checks,
  };
}

function printHuman(report, maxCalls) {
  const lines = [];
  lines.push(`summarize-run  ${report.generatedAt}`);
  lines.push(`  DSH_HOME: ${report.dshHome}`);
  lines.push(`  sessions: ${report.summary.sessions}（root ${report.summary.roots} / children ${report.summary.children}）`);
  lines.push('');
  for (const s of report.sessions) {
    lines.push(`===== session ${s.id} =====`);
    if (s.error) { lines.push(`  ERROR: ${s.error}`); continue; }
    const sess = s.session || {};
    lines.push(`  cwd=${sess.cwd} parent=${sess.parentSession} origin=${sess.origin} depth=${sess.delegationDepth} preset=${sess.agentPreset}`);
    if (s.header) lines.push(`  header: config=${JSON.stringify(s.header.config)} tools=${s.header.toolCount}`);
    const t = s.skills.targets;
    lines.push(`  available_skills: ${s.skills.found ? `${s.skills.count} 个 @seq ${s.skills.firstSeq}` : 'NOT FOUND'} | tree-commander=${t['tree-commander']} tree-worker=${t['tree-worker']} session-handoff=${t['session-handoff']} | skill加载=${s.skills.loaded.length ? s.skills.loaded.map((x) => `${x.name}@${x.seq}`).join(',') : '(none)'}`);
    if (s.skills.evolution && s.skills.evolution.length > 1) lines.push(`  skills 演化: ${s.skills.evolution.map((h) => `seq${h.seq}:${h.count}[${h.targets.join('+') || '-'}]`).join(' → ')}`);
    lines.push(`  工具计数: ${Object.entries(s.toolCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' ')}`);
    if (s.treeAssignment) lines.push(`  树节点归属: ${s.treeAssignment.tree_id}/${s.treeAssignment.leaf_id}`);
    const shown = s.toolSequence.slice(0, maxCalls);
    lines.push(`  工具序列（前 ${shown.length}/${s.toolSequence.length}）：`);
    for (const c of shown) lines.push(`    ${String(c.seq).padStart(4)}  ${c.name.padEnd(16)} ${c.argsSummary}  → ${c.resultHead}`);
    if (s.tree.plan.length) lines.push(`  tree_plan: ${s.tree.plan.map((p) => p.tree_id).join(', ')}`);
    if (s.tree.nodes.length) lines.push(`  tree_node: ${s.tree.nodes.map((n) => `${n.action}:${n.leaf?.leaf_id ?? n.leaf_id ?? '?'}${n.leaf?.parent ? `<${n.leaf.parent}` : ''}${n.leaf?.role ? `[${n.leaf.role}]` : ''}`).join(', ')}`);
    if (s.tree.dispatch.length) lines.push(`  tree_dispatch: ${s.tree.dispatch.map((d) => `${d.action}:${d.leaf_id}`).join(', ')}`);
    if (s.tree.reports.length) lines.push(`  tree_report: ${s.tree.reports.map((r) => `${r.action}${r.type ? `:${r.type}` : ''}:${r.leaf_id}${r.pct != null ? `@${r.pct}%` : ''}`).join(', ')}`);
    if (s.tree.verify.length) lines.push(`  tree_verify: ${s.tree.verify.map((v) => `${v.leaf_id ?? ''}=${v.result}`).join(' | ')}`);
    if (s.handoff.length) {
      for (const h of s.handoff) {
        if (h.parsed.status) lines.push(`  session_handoff status @${h.seq}: context=${h.parsed.status.context_pct}% threshold=${h.parsed.status.threshold_pct}% model=${h.parsed.status.model} preset=${h.parsed.status.preset} permission=${h.parsed.status.permission} successor=${h.parsed.status.successor_kind}`);
        if (h.parsed.handoff) lines.push(`  session_handoff handoff @${h.seq}: successor=${h.parsed.handoff.successor_id} kind=${h.parsed.handoff.kind} preset=${h.parsed.handoff.preset} workspace=${h.parsed.handoff.workspace} inherited=${h.parsed.handoff.inherited}`);
        if (h.parsed.rejected) lines.push(`  session_handoff rejected @${h.seq}: ${h.parsed.rejected}`);
      }
    }
    if (s.subagents.length) lines.push(`  subagent: ${s.subagents.map((x) => `${x.childId ?? '?'}(${x.description ?? ''})`).join(', ')}`);
    lines.push('');
  }
  if (report.children.length) {
    lines.push('--- 子会话 ---');
    for (const c of report.children) lines.push(`  ${c.id}  parent=${c.parentId} depth=${c.depth}${c.assignment ? `  tree=${c.assignment.tree_id}/${c.assignment.leaf_id}` : ''}`);
    lines.push('');
  }
  lines.push('--- 分层判定（启发式） ---');
  for (const c of report.layering.checks) lines.push(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(30)} ${c.label}  ${JSON.stringify(c.detail)}`);
  lines.push('');
  if (report.layering.treeStates?.length) {
    lines.push('--- tree-engine 权威落盘状态（<profile>/tree-engine-data/<tree_id>/tree-state.json） ---');
    for (const t of report.layering.treeStates) {
      if (!t.found) { lines.push(`  tree ${t.tree_id}: state file NOT FOUND (${t.path})`); continue; }
      lines.push(`  tree ${t.tree_id}: ${t.leafCount} leaves, maxDepth=${t.maxDepth}, events=${t.eventCount}  (${t.path})`);
      for (const l of t.leaves) lines.push(`    ${'  '.repeat(Math.min(l.depth, 6))}${l.leaf_id}  [${l.role ?? '?'}] status=${l.status} rt=${l.runtime ?? '-'} session=${l.session_id ?? '-'}${l.verification_pass != null ? ` verify=${l.verification_pass ? 'PASS' : 'FAIL'}` : ''}`);
    }
    lines.push('');
  }
  lines.push(`  SUMMARY: ${report.summary.passCount}/${report.summary.totalChecks} checks pass`);
  process.stdout.write(lines.join('\n') + '\n');
}

process.exitCode = main();
