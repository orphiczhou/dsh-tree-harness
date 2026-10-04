/**
 * 验证策略层（PLAN §5；S1 第三批 = 第一批模式：self-report / artifact / command）。
 * llm-judge / composite / human 第二批（依赖 smoke 结论：模型路由、ask 通道）。
 * 纯逻辑：fs/exec 经端口注入；装载期校验策略模板（未知 mode / artifact 缺 glob / command 缺 run
 * → 装载失败含键名——§9 断言「策略模板非法→装载失败报错含键名」）。
 */

const MODES = ['self-report', 'artifact', 'command']  // 第一批闭集；batch2 追加 llm-judge/composite/human

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
      return { mode: v.mode, pass: false, detail: `unknown mode ${v.mode}`, durationMs: Date.now() - t0 }
    } catch (e) {
      return { mode: v.mode, pass: false, detail: `verifier error: ${e?.message ?? e}`, durationMs: Date.now() - t0 }
    }
  }

  /**
   * 运行一个策略的全部验证（AND 语义；composite AND 链短路在 batch2 泛化）。
   * @returns {{policyId: string, verdicts: object[], pass: boolean, onFail: string}}
   */
  async function runVerifications(policyId, ctx) {
    const p = policyFor(policyId)
    const verdicts = []
    for (const v of p.verify) {
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
