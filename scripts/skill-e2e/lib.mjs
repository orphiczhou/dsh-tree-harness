#!/usr/bin/env node
/**
 * lib.mjs — skill-e2e 取证脚本共享层（只读 DSH 本地存储）。
 *
 * 数据源（与 DSH 实现无关的旁证口径）：
 *   - 会话日志：<DSH_HOME>/sessions/<workspace-encoded>/<sessionId>/session.v4.jsonl.zstd
 *     格式 = 多个 zstd frame 拼接。Node 单次 zstdDecompressSync 只解第一帧，
 *     故扫描魔数 0x28 0xB5 0x2F 0xFD 的每个出现位置逐帧解压（失败忽略），
 *     按 type+seq 去重后按 seq 排序。
 *   - 会话投影缓存：<DSH_HOME>/storages/session_projcache/sessions/<sessionId>.json
 *   - 工作区注册表：<DSH_HOME>/storages/workspace.json
 *
 * 会话 id 允许带/不带 "session-" 前缀；日志目录两种命名都实际存在，统一搜索。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

export const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
export const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// 基础
// ---------------------------------------------------------------------------

/** 规范化会话 id：去首尾空白、去掉可选的 "session-" 前缀、小写。 */
export function normSessionId(id) {
  if (!id) return '';
  return String(id).trim().replace(/^session-/i, '').toLowerCase();
}

export function looksLikeSessionId(v) {
  const s = normSessionId(v);
  return UUID_RE.test(s);
}

/** Windows 路径比较口径：正斜杠→反斜杠、去尾分隔符、小写。 */
export function normPath(p) {
  if (!p) return '';
  return String(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function parseArgs(argv, spec) {
  const opts = {};
  for (const k of Object.keys(spec)) opts[k] = spec[k];
  const takes = new Set(Object.keys(spec).filter((k) => typeof spec[k] !== 'boolean'));
  const aliases = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (!a.startsWith('--')) {
      // 位置参数：session / sessions
      (opts._ ??= []).push(a);
      continue;
    }
    const key = aliases[a.slice(2)] || a.slice(2);
    if (!(key in spec)) throw new Error(`unknown argument: ${a}`);
    if (typeof spec[key] === 'boolean') { opts[key] = true; continue; }
    if (i + 1 >= argv.length) throw new Error(`missing value for ${a}`);
    if (Array.isArray(spec[key])) (opts[key] ??= []).push(argv[++i]);
    else opts[key] = argv[++i];
  }
  return opts;
}

export function allSessionIds(opts) {
  const ids = [...(opts._ || []), ...(Array.isArray(opts.session) ? opts.session : opts.session ? [opts.session] : [])];
  return [...new Set(ids.map(normSessionId).filter(Boolean))];
}

/** 递归列出 sessions 根下的 workspace 编码目录。 */
export function sessionWorkspaceDirs() {
  const root = path.join(DSH_HOME, 'sessions');
  try {
    return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * 在 sessions 根下查找某会话的日志文件（允许带/不带 session- 前缀）。
 * 同一 id 多份时取 mtime 最新者。返回 {file, workspaceEncoding, mtimes, candidates} | null。
 */
export function findSessionLog(sessionId, { workspaceEncoding = null } = {}) {
  const bare = normSessionId(sessionId);
  if (!bare) return null;
  const root = path.join(DSH_HOME, 'sessions');
  const wsDirs = workspaceEncoding ? [workspaceEncoding] : sessionWorkspaceDirs();
  const candidates = [];
  for (const ws of wsDirs) {
    for (const dirName of [bare, `session-${bare}`]) {
      const file = path.join(root, ws, dirName, 'session.v4.jsonl.zstd');
      if (fs.existsSync(file)) candidates.push({ file, workspaceEncoding: ws });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs);
  return { ...candidates[0], candidates };
}

/** 解码多帧拼接的会话日志；按 type+seq 去重并按 seq 排序。 */
export function decodeSessionLog(file) {
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

/** 只解第一帧并解析 session 元事件（用于廉价地扫子会话目录）。 */
export function readSessionMeta(file) {
  try {
    const buf = fs.readFileSync(file);
    const idx = buf.indexOf(ZSTD_MAGIC);
    if (idx < 0) return null;
    const text = zlib.zstdDecompressSync(buf.subarray(idx)).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'session') return ev;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return null;
}

/** 解码并返回会话摘要所需的最小信息。 */
export function loadSession(sessionId, opts = {}) {
  const log = findSessionLog(sessionId, opts);
  if (!log) return null;
  const decoded = decodeSessionLog(log.file);
  return { id: normSessionId(sessionId), log, decoded };
}

// ---------------------------------------------------------------------------
// 事件工具
// ---------------------------------------------------------------------------

export const byType = (events, type) => events.filter((e) => e.type === type);
export const firstByType = (events, type) => events.find((e) => e.type === type) || null;
export function lastByType(events, type) {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].type === type) return events[i];
  return null;
}

/** 提取事件里的文本内容（user/message、assistant/message、tool/result）。 */
export function contentTexts(ev) {
  const out = [];
  const visit = (content) => {
    if (!content) return;
    if (typeof content === 'string') { out.push(content); return; }
    if (Array.isArray(content)) { for (const c of content) visit(c); return; }
    if (typeof content === 'object') {
      if (typeof content.text === 'string') out.push(content.text);
      if (typeof content.content === 'string') out.push(content.content);
      if (content.content && typeof content.content === 'object') visit(content.content);
      if (Array.isArray(content.attachments)) {
        for (const a of content.attachments) {
          if (typeof a?.text === 'string') out.push(a.text);
          else if (a && typeof a === 'object') out.push(JSON.stringify(a));
        }
      }
    }
  };
  if (ev.type === 'user/message') visit(ev.data?.content);
  else if (ev.type === 'assistant/message') visit(ev.data?.message?.content ?? ev.data?.content);
  else if (ev.type === 'tool/result') visit(ev.data?.message?.content ?? ev.data?.content ?? ev.data?.result);
  else if (ev.type === 'tool/call') visit(ev.data?.arguments);
  return out.join('\n');
}

/** 工具调用事件 → {seq, name, args, argsRaw, callId}。 */
export function toolCallOf(ev) {
  const d = ev.data || {};
  let args = d.arguments;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { /* keep raw string */ }
  }
  return { seq: ev.seq, name: d.name || d.tool || '', args: args ?? {}, argsRaw: typeof d.arguments === 'string' ? d.arguments : JSON.stringify(d.arguments ?? {}), callId: d.callId ?? d.id ?? null };
}

/** 工具结果事件 → 文本 + 结构化 JSON（若 content 是 JSON）。返回 {text, json, seq, callId}。 */
export function toolResultOf(ev) {
  const d = ev.data || {};
  const text = contentTexts(ev);
  let json = null;
  for (const visit of [d.result, d.structuredContent, d.output, d.value]) {
    if (visit && typeof visit === 'object') { json = visit; break; }
  }
  if (!json) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { json = JSON.parse(trimmed); } catch { /* ignore */ }
    }
  }
  const callId = d.message?.toolCallId ?? d.message?.source?.callId ?? d.callId ?? d.id ?? null;
  return { seq: ev.seq, callId, text, json, isError: d.message?.isError ?? d.isError ?? null };
}

/** 参数摘要（单行、限长）。 */
export function summarizeArgs(args, maxLen = 180) {
  let s;
  try { s = JSON.stringify(args); } catch { s = String(args); }
  if (!s) return '';
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

// ---------------------------------------------------------------------------
// <available_skills> 解析
// ---------------------------------------------------------------------------

const SKILL_LINE_RE = /^\s*[-*]\s*(?:`([^`]+)`|([A-Za-z0-9][\w.-]*))\s*[:：]\s*(.*)$/;

/**
 * 从文本里解析 <available_skills> 块。
 * 返回 {found, names: [{name, description}], headSeqHint}。支持多个块（合并去重）。
 */
export function parseAvailableSkills(text) {
  const blocks = [];
  const re = /<available_skills>([\s\S]*?)<\/available_skills>/gi;
  let m;
  while ((m = re.exec(text || '')) !== null) blocks.push(m[1]);
  if (blocks.length === 0) return { found: false, names: [], blocks: 0 };
  const seen = new Map();
  for (const block of blocks) {
    for (const line of block.split('\n')) {
      const lm = line.match(SKILL_LINE_RE);
      if (!lm) continue;
      const name = (lm[1] || lm[2] || '').trim();
      if (!name || seen.has(name)) continue;
      seen.set(name, lm[3].trim());
    }
  }
  return { found: true, names: [...seen].map(([name, description]) => ({ name, description })), blocks: blocks.length };
}

/** 在所有 user/message（及 system 文本）里找 available_skills 块。 */
export function findAvailableSkills(events) {
  const hits = [];
  for (const ev of events) {
    if (ev.type !== 'user/message' && ev.type !== 'system' && ev.type !== 'request/header') continue;
    const text = ev.type === 'user/message' ? contentTexts(ev) : JSON.stringify(ev.data ?? {});
    const parsed = parseAvailableSkills(text);
    if (!parsed.found) continue;
    hits.push({ seq: ev.seq, type: ev.type, surfaceOp: ev.surfaceOp ?? null, names: parsed.names });
  }
  if (hits.length === 0) return { found: false, firstSeq: null, names: [], hits: [] };
  // 合并去重（含后续 catalog 刷新注入的 user/message）
  const seen = new Map();
  for (const h of hits) for (const n of h.names) if (!seen.has(n.name)) seen.set(n.name, n.description);
  const first = hits[0];
  const latest = hits[hits.length - 1];
  return {
    found: true,
    firstSeq: first.seq,
    firstType: first.type,
    names: [...seen].map(([name, description]) => ({ name, description })),
    /** 每个含 catalog 的 user/message（按 seq 升序）：用于观察活体热加载前后的目录演化。 */
    hits: hits.map((h) => ({ seq: h.seq, type: h.type, surfaceOp: h.surfaceOp, count: h.names.length, names: h.names.map((n) => n.name) })),
    /** 会话首个 catalog（创建时的可用 skill 列表） */
    first: { seq: first.seq, type: first.type, count: first.names.length, names: first.names.map((n) => n.name) },
    /** 最近一次注入的 catalog（当前活体加载结果） */
    latest: { seq: latest.seq, type: latest.type, count: latest.names.length, names: latest.names.map((n) => n.name) },
  };
}
