/**
 * 对抗式验证（attack–defense–audit iteration，≤N 轮；用户需求 2026-10-05）。
 *
 * 流程（每轮）：
 *   ① 结构检查：verifier.runVerifications(policyId)（artifact/command 等既有模式）
 *   ② 攻击检查：ports.attack(...)——异族模型评审会话，试图推翻产物/找出错误
 *   ③ 任一 FAIL → ports.fix(findings) 通知执行者修复 → 等待 → 下一轮
 *   全 PASS 或达 maxRounds 终止；逐轮裁决记录 rounds[] 经 ports.record 落账。
 *
 * 纯逻辑：attack/fix/等待/落账全部端口注入（与引擎纪律一致）。
 */

const DEFAULT_MAX_ROUNDS = 3

/**
 * @param {object} opts
 * @param {import('./verify.js').Verifier} opts.verifier
 * @param {(o: {round: number, rubric: string[], target: {kind: string, text: string}}) => Promise<{pass: boolean, findings: string[], detail?: string}>} opts.attack
 * @param {(o: {round: number, findings: string[]}) => Promise<boolean>} [opts.fix]   // 返回是否送达
 * @param {(ms: number) => Promise<void>} [opts.wait]
 * @param {(result: object) => Promise<unknown>} [opts.record]                        // 裁决落账（leaf:set-verification 封套）
 * @param {number} [opts.maxRounds]
 */
export function createAdversarial(opts) {
  const { verifier, attack } = opts
  const fix = opts.fix ?? (async () => false)
  const wait = opts.wait ?? (() => Promise.resolve())
  const record = opts.record ?? (async () => {})
  const maxRounds = Math.max(1, Math.min(opts.maxRounds ?? DEFAULT_MAX_ROUNDS, 5))

  /**
   * @param {{treeId: string, leafId: string, policyId: string, cwd: string, target: {kind: string, text: string}, fixWaitMs?: number}} p
   * @returns {Promise<{policyId: string, pass: boolean, rounds: Array<{round: number, structural: object, attack: object, fixed?: boolean}>, verdicts: object[]}>}
   */
  async function run(p) {
    const policy = verifier.policyFor(p.policyId)
    const rubric = [
      ...(policy.dod ?? []),
      '攻击任务：你的职责是推翻它——找事实错误、夸大断言、逻辑漏洞、未兑现承诺。宁可错杀不可放过。',
    ]
    const rounds = []
    let final = null
    for (let round = 1; round <= maxRounds; round++) {
      const structural = await verifier.runVerifications(p.policyId, { cwd: p.cwd })
      // 结构过了才值得攻击（结构都没有=攻击对象缺失，直接按结构裁决走修复路径）
      let attackV = { pass: true, findings: [], detail: 'skipped (structural fail)' }
      if (structural.pass) {
        // target 支持函数形态：按本轮 structural 结果动态解析（如 artifact 路径出来后读全文）
        const target = typeof p.target === 'function' ? await p.target(round, structural) : p.target
        try {
          attackV = await attack({ round, rubric, target })
        } catch (e) {
          attackV = { pass: false, findings: [], detail: `attack port error: ${e?.message ?? e}` }
        }
        if (typeof attackV.pass !== 'boolean') attackV = { pass: false, findings: attackV.findings ?? [], detail: `invalid attack shape: ${JSON.stringify(attackV).slice(0, 200)}` }
      }
      const entry = { round, structural: { pass: structural.pass, verdicts: structural.verdicts }, attack: attackV }
      const pass = structural.pass && attackV.pass
      if (pass || round === maxRounds) { rounds.push(entry); final = { pass, entry }; break }
      // FAIL → 通知执行者修复（防御），等待后进入下一轮
      const fixed = await fix({ round, findings: [...(attackV.findings ?? []), ...structuralFailures(structural)] })
      entry.fixed = fixed
      rounds.push(entry)
      if (fixed) await wait(p.fixWaitMs ?? 30_000)
    }
    const result = {
      policyId: `${p.policyId}+adversarial`,
      pass: final?.pass ?? false,
      rounds,
      verdicts: final ? [...final.entry.structural.verdicts, { mode: 'llm-judge', pass: final.entry.attack.pass, detail: final.entry.attack.detail ?? `attack findings: ${(final.entry.attack.findings ?? []).join('; ').slice(0, 300)}` }] : [],
    }
    await record(result)
    return result
  }

  return { run, maxRounds }
}

function structuralFailures(structural) {
  return structural.verdicts.filter((v) => !v.pass).map((v) => `[${v.mode}] ${v.detail}`)
}
