/**
 * Packaging regression tests for the bundled tree Skills (v0.5.0).
 *
 * The commander/worker Skills are the model-facing half of this package: they
 * teach the decomposition protocol and the 50%-context handoff discipline. They
 * must ship inside the package, be mounted by the bundle patch, and stay
 * well-formed — otherwise the engine is usable only by agents that were already
 * told every tool name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgDir = path.resolve(here, '..')
const repoRoot = path.resolve(pkgDir, '..', '..')

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  assert.ok(match, 'SKILL.md must start with a YAML frontmatter block')
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue
    const at = line.indexOf(':')
    assert.ok(at > 0, `frontmatter line has no key: ${line}`)
    fields[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return { fields, body: text.slice(match[0].length) }
}

for (const id of ['tree-commander', 'tree-worker']) {
  test(`skills/${id}/SKILL.md exists with valid frontmatter`, () => {
    const file = path.join(pkgDir, 'skills', id, 'SKILL.md')
    assert.ok(existsSync(file), file)
    const { fields, body } = frontmatter(readFileSync(file, 'utf8'))
    assert.equal(fields.name, id, 'frontmatter name must equal the skill id')
    assert.ok(fields.description && fields.description.length >= 20, 'description is required')
    assert.ok(fields.whenToUse && fields.whenToUse.length >= 20, 'whenToUse is required for minimal-prompt discovery')
    assert.match(body, /tree_node/, 'protocol must name the tools it relies on')
    assert.match(body, /tree_dispatch/)
    assert.match(body, /tree_report/)
    // v0.5.0: every layer must be able to hand off at the 50% context threshold.
    assert.match(body, /session_handoff/, 'skill must teach the session handoff discipline')
    assert.match(body, /50/)
  })
}

test('the legacy repo-root skills/ copies are gone (single source inside the package)', () => {
  assert.equal(existsSync(path.join(repoRoot, 'skills', 'tree-commander', 'SKILL.md')), false)
  assert.equal(existsSync(path.join(repoRoot, 'skills', 'tree-worker', 'SKILL.md')), false)
})

test('bundle patch mounts a filesystem Skill provider on the packaged skills/', () => {
  const patch = readFileSync(path.join(pkgDir, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /@deepseek-ai\/dsh-skill-filesystem/)
  assert.match(patch, /providerName:\s*tree-engine\b/)
  assert.match(patch, /includeDefaultRoots:\s*false/)
  assert.match(patch, /bundledSkillDir:/)
  assert.match(patch, /'skills'\)/)
  assert.match(patch, /@local\/dsh-tree-engine\/package\.json/)
})
