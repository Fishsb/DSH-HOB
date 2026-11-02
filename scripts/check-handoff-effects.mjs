#!/usr/bin/env node
/**
 * handoff → Effects 队列桥判据。
 * ⚠ 临时目录；不碰真实派发 watch。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url).pathname
const { startHandoffEffects, enqueueHandoff, handoffQueuePath } = await import(pathToFileURL(join(root, 'src', 'server', 'handoff-effects.ts')).href)
const { recordHandoff, readOrchState, ensureRuntimeIgnored, ORCH_STATE_SUBDIR, ORCH_STATE_FILENAME } = await import(pathToFileURL(join(root, 'src', 'server', 'orch-state.ts')).href)

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }
const dirs = []
const mk = () => { const d = mkdtempSync(join(tmpdir(), 'hob-handoff-')); dirs.push(d); return d }
const wait = async (fn) => {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 5))
  }
  return false
}

try {
  // H-1 成功投递后清 handoff 与 effect
  {
    const d = mk()
    const runtime = join(d, 'runtime')
    ensureRuntimeIgnored(runtime)
    const stateFile = join(runtime, ORCH_STATE_FILENAME)
    const h = { kind: 'task-file', ref: 'archive/x/TASK.md', at: Date.now(), owner: 'self', wsRoot: d }
    recordHandoff(stateFile, h)
    let sent = 0
    const q = startHandoffEffects(d, async () => { sent++ }, stateFile)
    enqueueHandoff(q, h, 'target', 'go')
    await q.idle('handoff-deliver')
    const left = readOrchState(stateFile).handoffs
    if (sent === 1 && left.length === 0 && q.pending().length === 0) ok('H-1 ✓ 投递成功后清 handoff 与 effect')
    else bad(`H-1 · sent=${sent} handoffs=${left.length} effects=${q.pending().length}`)
    await q.drain()
  }

  // W-1 预设层真的注入 handoffEffectsOf；工具层真的消费它
  {
    const preset = readFileSync(join(root, 'src', 'preset', 'tools.ts'), 'utf8')
    const tools = readFileSync(join(root, 'src', 'modules', 'tools.ts'), 'utf8')
    /**
     * ⚠ 预设层按 `check:config` 的 G-11 纪律使用**命名空间导入**，不能在判据里
     *   要求旧的具名导入/直接调用形态。这里核的是当前安全形态的四段真实接线：
     *   ① 命名空间导入 handoff-effects；② 运行时取函数并校验形状；
     *   ③ 真正调用它建队列；④ 工具层消费注入并在投递失败后入队。
     */
    const wired = /import \* as handoffEffectsFace from '\.\.\/server\/handoff-effects\.ts'/.test(preset)
      && /const start = handoffEffectsFace\.startHandoffEffects/.test(preset)
      && /typeof start !== 'function'/.test(preset)
      && /const q = start\(/.test(preset)
      && /deps\.handoffEffectsOf\?\.\(/.test(tools)
      && /enqueueHandoff\s*\(/.test(tools)
    if (wired) ok('W-1 ✓ 预设层启动 handoff effects，工具层在投递失败后入队')
    else bad('W-1 · handoff effects 只在库里、没有接进真实 write_hob 路径')
  }

  // H-2 投递失败保留 handoff 与 effect，供重启恢复
  {
    const d = mk()
    const runtime = join(d, 'runtime')
    ensureRuntimeIgnored(runtime)
    const stateFile = join(runtime, ORCH_STATE_FILENAME)
    const h = { kind: 'task-file', ref: 'archive/x/FAIL.md', at: Date.now(), owner: 'self', wsRoot: d }
    recordHandoff(stateFile, h)
    const q = startHandoffEffects(d, async () => { throw new Error('offline') }, stateFile)
    enqueueHandoff(q, h, 'target', 'go')
    await wait(() => q.pending('handoff-deliver').length === 1 && q.pending('handoff-deliver')[0].attempts >= 1)
    const persisted = JSON.parse(readFileSync(handoffQueuePath(d), 'utf8'))
    if (readOrchState(stateFile).handoffs.length === 1 && persisted.rows.length === 1) ok('H-2 ✓ 投递失败后 handoff 与 effect 都保留')
    else bad('H-2 · 失败后记录丢失')
    await q.drain()
  }

  // N-H1 负向对拍：两个不同 ref 不能互相清掉
  {
    const d = mk()
    const runtime = join(d, 'runtime')
    ensureRuntimeIgnored(runtime)
    const stateFile = join(runtime, ORCH_STATE_FILENAME)
    const h1 = { kind: 'task-file', ref: 'archive/x/A.md', at: Date.now(), owner: 'self' }
    const h2 = { kind: 'task-file', ref: 'archive/x/B.md', at: Date.now(), owner: 'self' }
    recordHandoff(stateFile, h2)
    recordHandoff(stateFile, h1)
    const q = startHandoffEffects(d, async (_t, _m, h) => {
      const { clearHandoffs } = await import(pathToFileURL(join(root, 'src', 'server', 'orch-state.ts')).href)
      clearHandoffs(stateFile, (x) => x.ref === h.ref)
    }, stateFile)
    enqueueHandoff(q, h1, 'target', 'go')
    await q.idle('handoff-deliver')
    const left = readOrchState(stateFile).handoffs
    if (left.length === 1 && left[0].ref === h2.ref) ok('N-H1 ✓ 负向对拍（投 A 只清 A，B 仍在）')
    else bad(`N-H1 · left=${JSON.stringify(left)}`)
    await q.drain()
  }

  // H-3 失败后重启同一队列文件，恢复并完成
  {
    const d = mk()
    const runtime = join(d, 'runtime')
    ensureRuntimeIgnored(runtime)
    const stateFile = join(runtime, ORCH_STATE_FILENAME)
    const h = { kind: 'task-file', ref: 'archive/x/RESTART.md', at: Date.now(), owner: 'self', wsRoot: d }
    recordHandoff(stateFile, h)
    const q1 = startHandoffEffects(d, async () => { throw new Error('offline') }, stateFile)
    enqueueHandoff(q1, h, 'target', 'go')
    await wait(() => q1.pending('handoff-deliver').length === 1 && q1.pending('handoff-deliver')[0].attempts >= 1)
    await q1.drain()
    let sent = 0
    const q2 = startHandoffEffects(d, async () => { sent++ }, stateFile)
    q2.start()
    /**
     * ⚠ 重启必须继续遵守盘上的 backoff，不能一启动就把失败任务重新打一遍。
     * 这里等到原先的 2s 退避到期，再确认恢复完成。
     */
    await new Promise((r) => setTimeout(r, 2_200))
    await q2.idle('handoff-deliver')
    if (sent === 1 && readOrchState(stateFile).handoffs.length === 0) ok('H-3 ✓ 失败后重启同一队列文件，恢复并完成投递')
    else bad(`H-3 · sent=${sent} handoffs=${readOrchState(stateFile).handoffs.length}`)
    await q2.drain()
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
}
console.log(`\nhandoff effects：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处`
  + (fail > 0 ? ` · 没过 ${fail} 处` : '')
  + ' · 跳过 0 处（⚠ 跳过**不计入通过**）')
process.exitCode = fail > 0 ? 1 : 0
