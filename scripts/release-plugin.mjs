#!/usr/bin/env node
/**
 * Release sync for the single-package session-tree bundle.
 *
 * The repository is the single source of truth for `packages/dsh-session-tree/`.
 * The public plugin repo (github.com/orphiczhou/dsh-session-tree) is a *copy* of
 * that directory. This script is the only supported way to produce that copy:
 * it mirrors the package into `--target`, then re-reads every written file and
 * verifies it byte-for-byte with SHA-256 against the source.
 *
 * What it never does:
 *   - it never runs git (no add / commit / push / tag) — the git commands it
 *     prints are for a human to run in the public repo;
 *   - it never edits package.json or bumps the version. Version discipline is
 *     decision D6: the market judges an update by `package.json.version`, so a
 *     content change must carry a version bump in `packages/dsh-session-tree/`
 *     *before* this script is run. A pure re-sync of unchanged content stays on
 *     the existing version;
 *   - it never touches anything outside `--target` (plus reading the source).
 *
 * Usage:
 *   node scripts/release-plugin.mjs --target <dir> [options]
 *   node scripts/release-plugin.mjs --target <dir> --check      # verify only
 *   node scripts/release-plugin.mjs --help
 *
 * Options:
 *   --target <dir>   destination directory (normally the public plugin repo root)
 *   --source <dir>   source package directory
 *                    (default: <repo>/packages/dsh-session-tree)
 *   --check          do not write; compare target against source and report
 *   --prune          delete files in the target that the source does not have
 *   --force          allow syncing when the target's package.json names a
 *                    different package (wrong-repo guard)
 *   -h, --help       show this help
 *
 * Exit codes: 0 = synced (or verified) with zero mismatches; 1 = usage error,
 * refused target, or any missing/mismatched file.
 *
 * Pure ESM, Node built-in modules only.
 */

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = dirname(SCRIPT_DIR)
const DEFAULT_SOURCE = join(REPO_ROOT, 'packages', 'dsh-session-tree')

// Never mirrored into the release copy: local installs and OS/editor junk would
// either bloat the public repo or silently differ per machine.
const SKIP_DIRS = new Set(['node_modules', '.git'])
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db'])

const USAGE = `release-plugin.mjs — mirror packages/dsh-session-tree to a release target

Usage:
  node scripts/release-plugin.mjs --target <dir> [options]
  node scripts/release-plugin.mjs --check --target <dir>

Options:
  --target <dir>   destination directory (normally the public plugin repo root)
  --source <dir>   source package dir (default: <repo>/packages/dsh-session-tree)
  --check          verify only; write nothing
  --prune          delete target files that do not exist in the source
  --force          allow a target whose package.json names a different package
  -h, --help       show this help

What it does:
  1. copies every source file (skipping node_modules/.git/OS junk) to --target;
  2. re-reads each written file and verifies its SHA-256 against the source;
  3. reports missing / extra / mismatched files (--prune removes extras);
  4. prints the git commands to run in the public repo — it never runs them.

Exit codes: 0 = verified clean, 1 = usage error / refused target / any mismatch.

See docs/merge-session-tree-2026-11-11.md for the release flow and provenance.`

function fail(message) {
  console.error(`release-plugin: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const opts = { target: null, source: DEFAULT_SOURCE, check: false, prune: false, force: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg === '--check') opts.check = true
    else if (arg === '--prune') opts.prune = true
    else if (arg === '--force') opts.force = true
    else if (arg === '--target' || arg === '-t') {
      opts.target = argv[++i]
      if (!opts.target) fail('--target needs a directory')
    } else if (arg.startsWith('--target=')) opts.target = arg.slice('--target='.length)
    else if (arg === '--source' || arg === '-s') {
      opts.source = argv[++i]
      if (!opts.source) fail('--source needs a directory')
    } else if (arg.startsWith('--source=')) opts.source = arg.slice('--source='.length)
    else fail(`unknown argument: ${arg}\n\n${USAGE}`)
  }
  return opts
}

/** Normalize a path for containment checks (case-insensitive on Windows). */
function normalizeForCompare(p) {
  const abs = resolve(p)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

function isInside(parent, child) {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..' + sep) && rel !== '..' && !rel.includes(':' + sep)
}

/** Recursively list files under `root`, repository-relative, sorted. */
function walkFiles(root) {
  const files = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(abs, rel)
      } else if (entry.isFile()) {
        if (SKIP_FILES.has(entry.name)) continue
        files.push(rel)
      }
    }
  }
  walk(root, '')
  return files.sort()
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function readPackage(pkgDir) {
  const file = join(pkgDir, 'package.json')
  if (!existsSync(file)) fail(`not a package (package.json missing): ${pkgDir}`)
  let pkg
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`cannot parse ${file}: ${error.message}`)
  }
  if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') {
    fail(`${file} has no name/version strings`)
  }
  return pkg
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(USAGE)
    return
  }
  if (!opts.target) {
    console.log(USAGE)
    fail('missing --target')
  }

  const source = resolve(opts.source)
  const target = resolve(opts.target)

  if (!existsSync(source) || !statSync(source).isDirectory()) fail(`source is not a directory: ${source}`)
  const pkg = readPackage(source)

  // ---------------------------------------------------------------- safety checks
  const sourceNorm = normalizeForCompare(source)
  const targetNorm = normalizeForCompare(target)
  if (sourceNorm === targetNorm) fail('source and target are the same directory')
  if (isInside(source, target)) fail(`refusing to sync into a subdirectory of the source: ${target}`)
  // Copying into a parent of the source would recursively re-copy the source
  // into the target; --force is only for the wrong-repo guard, not for this.
  if (isInside(target, source)) fail(`refusing to sync into a parent of the source: ${target}`)

  const targetPkgFile = join(target, 'package.json')
  if (!opts.check && existsSync(targetPkgFile)) {
    let targetPkg = null
    try {
      targetPkg = JSON.parse(readFileSync(targetPkgFile, 'utf8'))
    } catch {
      /* non-JSON target package.json — the name check below simply cannot run */
    }
    if (targetPkg && targetPkg.name && targetPkg.name !== pkg.name && !opts.force) {
      fail(
        `target package.json names "${targetPkg.name}", source names "${pkg.name}" — ` +
          'looks like the wrong target; pass --force to override',
      )
    }
  }

  console.log(`release-plugin: ${pkg.name}@${pkg.version}`)
  console.log(`  source: ${source}`)
  console.log(`  target: ${target}`)
  console.log(`  mode:   ${opts.check ? 'check (no writes)' : 'sync'}${opts.prune ? ' + prune' : ''}`)

  const sourceFiles = walkFiles(source)
  if (sourceFiles.length === 0) fail(`source has no files: ${source}`)

  // ---------------------------------------------------------------------- write
  if (!opts.check) {
    for (const rel of sourceFiles) {
      const src = join(source, ...rel.split('/'))
      const dst = join(target, ...rel.split('/'))
      mkdirSync(dirname(dst), { recursive: true })
      copyFileSync(src, dst)
    }
  }

  // ------------------------------------------------------------------- verify
  const targetFiles = existsSync(target) ? walkFiles(target) : []
  const targetSet = new Set(targetFiles)
  const sourceSet = new Set(sourceFiles)

  let match = 0
  let mismatch = 0
  let missing = 0
  let extras = 0
  const rows = []

  for (const rel of sourceFiles) {
    const src = join(source, ...rel.split('/'))
    const dst = join(target, ...rel.split('/'))
    const srcHash = sha256(src)
    const srcSize = statSync(src).size
    if (!targetSet.has(rel)) {
      missing++
      rows.push({ rel, status: 'MISSING', srcHash, dstHash: '-' })
      continue
    }
    const dstHash = sha256(dst)
    if (srcHash === dstHash) {
      match++
      rows.push({ rel, status: 'OK', srcHash, dstHash })
    } else {
      mismatch++
      rows.push({ rel, status: 'MISMATCH', srcHash, dstHash })
    }
    void srcSize
  }

  const extraFiles = targetFiles.filter((rel) => !sourceSet.has(rel))
  extras = extraFiles.length
  const pruned = []
  if (extras > 0 && opts.prune && !opts.check) {
    for (const rel of extraFiles) {
      const dst = join(target, ...rel.split('/'))
      rmSync(dst, { force: true })
      pruned.push(rel)
    }
  }

  // Print every file with its full SHA-256 so the run itself is auditable.
  for (const row of rows) {
    const label = `[${row.status}]`.padEnd(10)
    console.log(`  ${label} ${row.rel}`)
    if (row.status === 'OK') console.log(`             sha256 ${row.srcHash}`)
    else {
      console.log(`             source sha256 ${row.srcHash}`)
      console.log(`             target sha256 ${row.dstHash}`)
    }
  }
  for (const rel of extraFiles) {
    console.log(`  [${opts.prune && !opts.check ? 'PRUNED  ' : 'EXTRA   '}] ${rel}`)
  }

  console.log('')
  console.log(
    `  files=${sourceFiles.length} match=${match} mismatch=${mismatch} missing=${missing} ` +
      `extra=${extras}${extras > 0 && opts.prune && !opts.check ? ` pruned=${pruned.length}` : ''}`,
  )

  const clean = mismatch === 0 && missing === 0 && (extras === 0 || opts.prune || opts.check)
  if (!clean) {
    if (extras > 0 && !opts.prune && !opts.check) {
      console.error(`  NOTE: target has ${extras} extra file(s); re-run with --prune to remove them.`)
    }
    console.error('  RESULT: FAILED — the target is not byte-identical to the source.')
    process.exit(1)
  }

  console.log(`  RESULT: OK — ${sourceFiles.length}/${sourceFiles.length} files byte-identical (SHA-256).`)

  // ------------------------------------------------------------ next-step hints
  const commitSubject = `sync: ${pkg.name}@${pkg.version} from dsh-tree-harness packages/dsh-session-tree`
  console.log('')
  console.log('  Next steps (run in the PUBLIC plugin repo — this script never runs git):')
  console.log(`    cd "${target}"`)
  console.log('    git status --short')
  console.log('    git add -A')
  console.log(`    git commit -m "${commitSubject}"`)
  console.log('    git push origin main')
  console.log('')
  console.log(
    '  Version discipline (D6): content changes require a version bump in ' +
      'packages/dsh-session-tree/package.json before syncing; an unchanged re-sync stays on ' +
      `${pkg.version}.`,
  )
}

main()
