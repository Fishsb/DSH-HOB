#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const here = new URL('.', import.meta.url).pathname
const root = join(here, '..')
const policyMod = await import(pathToFileURL(join(root, 'src', 'shared', 'ledger-write-policy.ts')).href)
const { writeHobFile } = await import(pathToFileURL(join(root, 'src', 'server', 'hob-write.ts')).href)

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }
const work = mkdtempSync(join(tmpdir(), 'dsh-hob-write-policy-'))
const opts = { hobDir: '', keepBackups: 3, shrinkGuard: 0.5, maxFileBytes: 65536 }
const text = (marker, n = 200) => `# ${marker}\n\n${'current-only\n'.repeat(Math.ceil(n / 13))}`

try {
  console.log('\nWP 组：账本写入策略（真实写入器 + 三轮替换夹具）\n')

  const rootAppend = await writeHobFile(work, {
    file: 'CONTEXT.md',
    content: text('append-attempt'),
    mode: 'append',
  }, opts)
  if (rootAppend.ok === false && rootAppend.reason === 'append-current-denied') {
    ok('WP-1 ✓ 负向对拍：当前根文档 append 被真实写入器拒绝（append-current-denied）')
  } else bad(`WP-1 · 当前根文档 append 未拒绝：${JSON.stringify(rootAppend)}`)

  const createCurrent = await writeHobFile(work, {
    file: 'CONTEXT.md',
    content: text('cycle-0'),
    mode: 'overwrite',
  }, opts)
  if (!createCurrent.ok) bad(`WP-2 · 首次创建当前正文失败：${JSON.stringify(createCurrent)}`)
  else ok(`WP-2 ✓ 首次当前正文写入成功（${createCurrent.bytesAfter} B）`)

  const archived = []
  for (let i = 1; i <= 3; i++) {
    const r = await writeHobFile(work, {
      file: 'CONTEXT.md',
      content: text(`cycle-${i}`, 220 + i),
      mode: 'overwrite',
    }, opts)
    if (!r.ok || r.archiveSnapshot === undefined) {
      bad(`WP-3.${i} · 第 ${i} 轮替换没有自动归档：${JSON.stringify(r)}`)
      continue
    }
    archived.push(r.archiveSnapshot)
  }
  const archiveOk = archived.length === 3
    && new Set(archived.map((x) => x.directory)).size === 3
    && archived.every((x) => /^[0-9a-f]{64}$/.test(x.sha256))
    && archived.every((x) => {
      try {
        const bytes = readFileSync(join(work, x.source))
        return createHash('sha256').update(bytes).digest('hex') === x.sha256
      } catch { return false }
    })
  if (archiveOk) {
    ok('WP-3 ✓ 三轮根文档替换：每轮都创建唯一归档件、SHA-256 可复算，当前正文未追加')
  } else bad(`WP-3 · 三轮替换归档不成立：${JSON.stringify(archived)}`)

  const archivedRoots = readdirSync(join(work, 'archive')).filter((n) => n.includes('-current-context-'))
  if (archivedRoots.length === 3) ok('WP-4 ✓ 当前正文体积保持有界：3 次替换得到 3 个独立快照，不是 1 个线性增长的追加文件')
  else bad(`WP-4 · 归档快照数 ${archivedRoots.length} ≠ 3`)

  const generated = await writeHobFile(work, {
    file: 'ledger/spec/current.md',
    content: '# generated\n',
    mode: 'overwrite',
  }, opts)
  if (generated.ok === false && generated.reason === 'generated-write-denied') {
    ok('WP-5 ✓ 负向对拍：ledger/spec 生成视图不可由 HOB 写入')
  } else bad(`WP-5 · 生成物写入未拒绝：${JSON.stringify(generated)}`)

  const processFile = await writeHobFile(work, {
    file: 'ledger/changes/demo/VERDICT-X.md',
    content: '# verdict\n',
    mode: 'overwrite',
  }, opts)
  if (processFile.ok === false && processFile.reason === 'active-change-file-denied') {
    ok('WP-6 ✓ 负向对拍：活跃 change 的 VERDICT 过程件被拒绝')
  } else bad(`WP-6 · 活跃 change 过程件未拒绝：${JSON.stringify(processFile)}`)

  const proposal = await writeHobFile(work, {
    file: 'ledger/changes/demo/proposal.md',
    content: '# proposal\n',
    mode: 'overwrite',
  }, opts)
  if (proposal.ok) ok('WP-7 ✓ 正向对照：活跃 change 的 proposal.md 可写')
  else bad(`WP-7 · 合法 proposal 被误拒：${JSON.stringify(proposal)}`)

  const archiveFile = 'archive/2026-11-03-history/HISTORY.md'
  mkdirSync(join(work, 'archive', '2026-11-03-history'), { recursive: true })
  writeFileSync(join(work, archiveFile), '# old\n', 'utf8')
  const historyOverwrite = await writeHobFile(work, {
    file: archiveFile,
    content: '# changed\n',
    mode: 'overwrite',
  }, opts)
  if (historyOverwrite.ok === false && historyOverwrite.reason === 'archive-overwrite-denied') {
    ok('WP-8 ✓ 负向对拍：历史归档 overwrite 被拒绝')
  } else bad(`WP-8 · 历史归档 overwrite 未拒绝：${JSON.stringify(historyOverwrite)}`)

  const policyFile = readFileSync(join(root, 'preset', 'dsh-hob', 'ledger-policy.toml'), 'utf8')
  const policySynced = policyMod.CURRENT_ROOT_DOCS.every((x) => policyFile.includes(`"${x}"`))
    && policyMod.ACTIVE_CHANGE_FILES.every((x) => policyFile.includes(`"${x}"`))
    && policyMod.GENERATED_LEDGER_PREFIXES.every((x) => policyFile.includes(`"${x}"`))
  if (policySynced) ok('WP-9 ✓ 机器策略文件与运行时策略常量同集')
  else bad('WP-9 · 机器策略文件与运行时策略常量不一致')
} catch (error) {
  bad(`WP 组自身异常：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

console.log(`\nWP 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · 跳过 0 处`)
if (fail > 0) process.exit(1)
console.log('  ✅ 账本写入策略全绿')
