/**
 * 验证策略层（PLAN §5）：batch-1 self-report/artifact/command + batch-2 llm-judge/composite/human。
 * llm-judge 经 ports.judge（宿主装配异族评审会话；未装配 fail-closed）；human 在 approval=never
 * 运行时降级为 frozen 待裁（工具面手动裁决）；composite = 嵌套 checks[] AND 链（batch-1 的
 * 多 verify 项 AND 语义泛化）。纯逻辑：fs/exec/judge 经端口注入。
 */

const MODES = ['self-report', 'artifact', 'command', 'llm-judge', 'composite', 'human']

/** 内置五模板缺省（§7 verificationPolicies 缺省的 batch-1 子集）。 */
export const DEFAULT_POLICIES = {
  'self-report': { dod: ['结论自述完成并给出关键产出'], verify: [{ mode: 'self-report' }], onFail: 'frozen' },
  'artifact-doc': {
    dod: ['产物文件存在且形状合规', '产出变更摘要'],
    verify: [{ mode: 'artifact', glob: '**/*.md', minSize: 200 }],
    onFail: 'retry:1',
  },
  'code-change': {
    dod: ['改动后指定命令退出码 0', '不修改约束外路径', '产出变更摘要'],
    verify: [{ mode: 'command', run: 'pnpm test', timeoutMs: 300_000 }],
    onFail: 'retry:1',
  },
  'research-answer': { dod: ['结论含出处引用'], verify: [{ mode: 'self-report' }], onFail: 'frozen' },
}

/** taskType → policyId 缺省映射（§7 taskTypePolicyMap）。 */
export const DEFAULT_TASK_TYPE_MAP = {
  research: 'research-answer',
  question: 'research-answer',
  doc: 'artifact-doc',
  'code-change': 'code-change',
  default: 'self-report',
}

/**
 * 装载期校验（类型/约束类：失败抛错含键名，不静默回退）。
 * @param {Record<string, object>} policies
 */
export function validatePolicies(policies) {
  for (const [id, p] of Object.entries(policies ?? {})) {
    if (!p || typeof p !== 'object') throw new Error(`verificationPolicies["${id}"]: policy object required`)
    if (!Array.isArray(p.verify) || p.verify.length === 0) throw new Error(`verificationPolicies["${id}"].verify: non-empty array required`)
    for (const v of p.verify) {
      if (!v || typeof v !== 'object') throw new Error(`verificationPolicies["${id}"].verify[]: object required`)
      if (!MODES.includes(v.mode)) {
        throw new Error(`verificationPolicies["${id}"].verify[].mode "${v.mode}" unknown (batch-1 modes: ${MODES.join('|')}; llm-judge/composite/human land in batch 2)`)
      }
      if (v.mode === 'artifact' && typeof v.glob !== 'string') throw new Error(`verificationPolicies["${id}"]: artifact mode requires "glob"`)
      if (v.mode === 'command' && typeof v.run !== 'string') throw new Error(`verificationPolicies["${id}"]: command mode requires "run"`)
      if (v.mode === 'llm-judge' && typeof v.rubric !== 'string') throw new Error(`verificationPolicies["${id}"]: llm-judge mode requires "rubric"`)
      if (v.mode === 'composite' && (!Array.isArray(v.checks) || v.checks.length === 0)) throw new Error(`verificationPolicies["${id}"]: composite mode requires non-empty "checks[]"`)
      if (v.mode === 'composite') {
        for (const c of v.checks) {
          if (!c || typeof c !== 'object' || !MODES.includes(c.mode) || c.mode === 'composite') {
            throw new Error(`verificationPolicies["${id}"].checks[]: flat composite only (mode ∈ ${MODES.filter((m) => m !== 'composite').join('|')})`)
          }
        }
      }
    }
  }
  return true
}

/**
 * @param {object} opts
 * @param {Record<string, object>} [opts.policies]
 * @param {Record<string, string>} [opts.taskTypeMap]
 * @param {{glob?: (pattern: string, cwd: string) => Promise<string[]>, readFile?: (p: string) => Promise<string>, exec?: (cmd: string, o?: {cwd?: string, timeoutMs?: number}) => Promise<{code: number, stdout: string, stderr: string}>}} [opts.ports]
 */
export function createVerifier(opts = {}) {
  const policies = { ...DEFAULT_POLICIES, ...(opts.policies ?? {}) }
  validatePolicies(policies)
  const taskTypeMap = { ...DEFAULT_TASK_TYPE_MAP, ...(opts.taskTypeMap ?? {}) }
  const ports = opts.ports ?? {}

  function policyFor(/** @type {string} */ idOrTaskType) {
    return policies[idOrTaskType] ?? policies[taskTypeMap[idOrTaskType]] ?? policies[taskTypeMap.default] ?? policies['self-report']
  }

  /** DoD 前置注入文本（§5.3：执行者开工即知验收标准；与验证器同模板）。 */
  function dodPrompt(policy) {
    const p = typeof policy === 'string' ? policyFor(policy) : policy
    const lines = (p.dod ?? []).map((d, i) => `${i + 1}. ${d}`).join('\n')
    return `[DoD 验收标准（完成定义，验收器与本文同源）]\n${lines}`
  }

  async function runCheck(v, ctx) {
    const t0 = Date.now()
    try {
      if (v.mode === 'self-report') return { mode: v.mode, pass: true, detail: 'self-report: 执行者自述完成即过（缺省模式）', durationMs: Date.now() - t0 }
      if (v.mode === 'artifact') {
        if (typeof ports.glob !== 'function' || typeof ports.readFile !== 'function') {
          return { mode: v.mode, pass: false, detail: 'artifact ports not wired (glob/readFile)', durationMs: Date.now() - t0 }
        }
        const files = await ports.glob(v.glob, ctx.cwd)
        if (!files || files.length === 0) return { mode: v.mode, pass: false, detail: `no artifact matching ${v.glob} under ${ctx.cwd}`, durationMs: Date.now() - t0 }
        // 形状校验：minSize / regex / jsonSchema（取第一个匹配文件）
        const f = files.sort()[0]
        const text = await ports.readFile(f)
        if (v.minSize && text.length < v.minSize) return { mode: v.mode, pass: false, detail: `artifact ${f} size ${text.length} < minSize ${v.minSize}`, durationMs: Date.now() - t0 }
        if (v.regex && !(new RegExp(v.regex, 'm')).test(text)) return { mode: v.mode, pass: false, detail: `artifact ${f} fails regex ${v.regex}`, durationMs: Date.now() - t0 }
        if (v.jsonSchema) {
          let parsed
          try { parsed = JSON.parse(text) } catch (e) { return { mode: v.mode, pass: false, detail: `artifact ${f} not valid JSON: ${e.message}`, durationMs: Date.now() - t0 } }
          const miss = schemaCheck(v.jsonSchema, parsed)
          if (miss) return { mode: v.mode, pass: false, detail: `artifact ${f} schema mismatch: ${miss}`, durationMs: Date.now() - t0 }
        }
        return { mode: v.mode, pass: true, detail: `artifact ${f} OK (${files.length} match)`, durationMs: Date.now() - t0, artifact: f }
      }
      if (v.mode === 'command') {
        if (typeof ports.exec !== 'function') return { mode: v.mode, pass: false, detail: 'command ports not wired (exec)', durationMs: Date.now() - t0 }
        const timeoutMs = v.timeoutMs ?? 600_000
        let r
        try {
          r = await ports.exec(v.run, { cwd: ctx.cwd, timeoutMs })
        } catch (e) {
          const msg = String(e?.message ?? e)
          return { mode: v.mode, pass: false, detail: msg.includes('TIMEOUT') || /timeout/i.test(msg) ? `command timeout > ${timeoutMs}ms (=verdict fail)` : `command error: ${msg}`, durationMs: Date.now() - t0 }
        }
        const expectExit = v.expect?.exit ?? 0
        if (r.code !== expectExit) return { mode: v.mode, pass: false, detail: `exit=${r.code} (expect ${expectExit}) stderr: ${String(r.stderr ?? '').slice(0, 300)}`, durationMs: Date.now() - t0 }
        if (v.expect?.stdoutRegex && !(new RegExp(v.expect.stdoutRegex, 'm')).test(String(r.stdout ?? ''))) {
          return { mode: v.mode, pass: false, detail: `stdout fails regex ${v.expect.stdoutRegex}`, durationMs: Date.now() - t0 }
        }
        return { mode: v.mode, pass: true, detail: `exit=0 (${v.run})`, durationMs: Date.now() - t0 }
      }
      if (v.mode === 'llm-judge') {
        if (typeof ports.judge !== 'function') return { mode: v.mode, pass: false, detail: 'llm-judge ports not wired (judge)', durationMs: Date.now() - t0 }
        try {
          const j = await ports.judge({ rubric: v.rubric, minScore: v.minScore ?? 0.8, ctx })
          if (!j || typeof j !== 'object' || typeof j.pass !== 'boolean') {
            return { mode: v.mode, pass: false, detail: `judge returned invalid shape: ${JSON.stringify(j).slice(0, 200)}`, durationMs: Date.now() - t0 }
          }
          return { mode: v.mode, pass: j.pass, detail: j.detail ?? `judge score=${j.score ?? '?'} (min ${v.minScore ?? 0.8})`, durationMs: Date.now() - t0 }
        } catch (e) {
          return { mode: v.mode, pass: false, detail: `judge error: ${e?.message ?? e}`, durationMs: Date.now() - t0 }
        }
      }
      if (v.mode === 'human') {
        // approval=never 降级设计（engine-spec §8-6）：human 裁决冻结待定——pass=false + pending=true，
        // onFail 语义 frozen：节点不得结算，直到人工经 tree_verify 显式 policy 覆盖裁决。
        return { mode: v.mode, pass: false, pending: true, detail: 'human adjudication required (approval=never → frozen): resolve manually via tree_verify with explicit policy_id', durationMs: Date.now() - t0 }
      }
      if (v.mode === 'composite') {
        return { mode: v.mode, pass: false, detail: 'composite is expanded by runVerifications (checks[]) and never executed directly', durationMs: Date.now() - t0 }
      }
      return { mode: v.mode, pass: false, detail: `unknown mode ${v.mode}`, durationMs: Date.now() - t0 }
    } catch (e) {
      return { mode: v.mode, pass: false, detail: `verifier error: ${e?.message ?? e}`, durationMs: Date.now() - t0 }
    }
  }

  /**
   * 运行一个策略的全部验证（AND 语义；composite 展开 checks[] 为平铺 AND 链，短路可选）。
   * @returns {{policyId: string, verdicts: object[], pass: boolean, onFail: string}}
   */
  async function runVerifications(policyId, ctx) {
    const p = policyFor(policyId)
    // composite 展开：checks[] 平铺进执行链（嵌套 composite 装载期已拒）
    const chain = []
    for (const v of p.verify) {
      if (v.mode === 'composite') for (const c of v.checks) chain.push(c)
      else chain.push(v)
    }
    const verdicts = []
    for (const v of chain) {
      const verdict = await runCheck(v, ctx)
      verdicts.push(verdict)
      if (!verdict.pass && p.shortCircuit !== false) break   // AND 短路
    }
    return { policyId, verdicts, pass: verdicts.every((x) => x.pass), onFail: p.onFail ?? 'frozen' }
  }

  return { policyFor, dodPrompt, runVerifications, policies, taskTypeMap, modes: MODES }
}

/** 最小 JSON Schema 子集校验（type/required/properties）——够 artifact 形状判定，非全量 Ajv。 */
function schemaCheck(schema, value, path = '$') {
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${path}: expected object`
    for (const key of schema.required ?? []) if (!(key in value)) return `${path}: missing required "${key}"`
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (k in value) { const miss = schemaCheck(sub, value[k], `${path}.${k}`); if (miss) return miss }
    }
    return null
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${path}: expected array`
    return null
  }
  if (schema.type === 'string' && typeof value !== 'string') return `${path}: expected string`
  if (schema.type === 'number' && typeof value !== 'number') return `${path}: expected number`
  if (schema.type === 'boolean' && typeof value !== 'boolean') return `${path}: expected boolean`
  return null
}
