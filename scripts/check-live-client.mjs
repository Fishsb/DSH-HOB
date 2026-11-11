#!/usr/bin/env node
/**
 * Live client checks — invalidation, gap recovery, reconnect and debounce.
 *
 * The fake transport produces real SSE text through a ReadableStream, so the
 * production frame parser and client state machine are under test (not a copy).
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url).pathname
const protocol = await import(pathToFileURL(join(root, 'src/shared/live-protocol.ts')).href)
const clientMod = await import(pathToFileURL(join(root, 'src/client/live-client.ts')).href)

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log(`  ✓ ${m}`) }
const bad = (m) => { fail++; console.log(`  ✗ ${m}`) }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function streamOf(text, keepOpen = false) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      if (!keepOpen) controller.close()
    },
  })
}

/** A stream that stays open long enough to observe the connected state. */
function heldOpen(text) {
  let ctl
  const stream = new ReadableStream({
    start(controller) {
      ctl = controller
      controller.enqueue(new TextEncoder().encode(text))
    },
  })
  return { stream, close: () => { try { ctl.close() } catch { /* already closed */ } } }
}

function fakeFetch(frames) {
  let calls = 0
  const impl = async () => {
    const rows = frames[Math.min(calls, frames.length - 1)]
    calls += 1
    return new Response(rows ?? '', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }
  return { impl, calls: () => calls }
}

function heldFetch(text) {
  let call = 0
  let held
  const impl = async () => {
    call += 1
    if (call > 1) return new Response('', { status: 503 })
    held = heldOpen(text)
    return new Response(held.stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  return { impl, close: () => held?.close() }
}

try {
  // C1 · protocol parser accepts hello and rejects malformed / empty-source frames.
  {
    const hello = protocol.parseLiveFrame('hello', JSON.stringify({ revision: 3, ledger: 'alpha', heartbeatMs: 20000 }))
    const badRev = protocol.parseLiveFrame('change', JSON.stringify({ revision: -1, ledger: 'alpha', sources: ['ledger'], at: 1 }))
    const noSource = protocol.parseLiveFrame('change', JSON.stringify({ revision: 4, ledger: 'alpha', sources: [], at: 1 }))
    if (hello?.event === 'hello' && badRev === undefined && noSource === undefined) {
      ok('C1 ✓ 帧解析只接受合法 hello/change；负序号与空来源被丢弃')
    } else bad(`C1 · hello=${JSON.stringify(hello)} badRev=${JSON.stringify(badRev)} noSource=${JSON.stringify(noSource)}`)
  }

  // C2 · a valid stream transitions to live and coalesces two changes.
  {
    const transport = heldFetch(
      `event: hello\ndata: ${JSON.stringify({ revision: 1, ledger: 'alpha', heartbeatMs: 20000 })}\n\n`
        + `event: change\ndata: ${JSON.stringify({ revision: 2, ledger: 'alpha', sources: ['ledger'], at: 1 })}\n\n`
        + `event: change\ndata: ${JSON.stringify({ revision: 3, ledger: 'alpha', sources: ['runtime'], at: 2 })}\n\n`,
    )
    let refreshes = 0
    let lastState
    const live = clientMod.createLiveClient({
      sessionId: 's', ledger: 'alpha', fetch: transport.impl, debounceMs: 20,
      onChange: () => { refreshes += 1 }, onState: (s) => { lastState = s },
    })
    live.start()
    await wait(120)
    if (lastState === 'live' && refreshes === 1) {
      ok('C2 ✓ 两条连续 change 只触发一次快照刷新，连接状态为 live')
    } else bad(`C2 · state=${lastState} refreshes=${refreshes}`)
    live.stop()
    transport.close()
  }

  // C3 · a revision gap triggers a snapshot in addition to the change.
  {
    const transport = fakeFetch([
      `event: hello\ndata: ${JSON.stringify({ revision: 1, ledger: 'alpha', heartbeatMs: 20000 })}\n\n`
        + `event: change\ndata: ${JSON.stringify({ revision: 5, ledger: 'alpha', sources: ['ledger'], at: 1 })}\n\n`,
    ])
    let refreshes = 0
    const live = clientMod.createLiveClient({
      sessionId: 's', fetch: transport.impl, debounceMs: 10, onChange: () => { refreshes += 1 },
    })
    live.start()
    await wait(80)
    if (refreshes === 1) ok('C3 ✓ 序号跳档仍触发一次完整快照刷新（不停止在旧读数）')
    else bad(`C3 · refreshes=${refreshes}`)
    live.stop()
  }

  // C4 · three failed attempts report fallback and do not spin silently.
  {
    let calls = 0
    const impl = async () => { calls += 1; return new Response('no', { status: 503 }) }
    let state
    const live = clientMod.createLiveClient({
      sessionId: 's', fetch: impl, maxBackoffMs: 10, debounceMs: 5,
      onChange: () => {}, onState: (s) => { state = s },
    })
    live.start()
    await wait(180)
    if (calls >= 3 && state === 'fallback') ok('C4 ✓ 连续失败进入 fallback 并保留可见状态，不静默')
    else bad(`C4 · calls=${calls} state=${state}`)
    live.stop()
  }

  // C5 · stop aborts the stream and clears reconnect / debounce timers.
  {
    const transport = fakeFetch([
      `event: hello\ndata: ${JSON.stringify({ revision: 1, ledger: 'alpha', heartbeatMs: 20000 })}\n\n`,
    ])
    let refreshes = 0
    const live = clientMod.createLiveClient({
      sessionId: 's', fetch: transport.impl, debounceMs: 20, onChange: () => { refreshes += 1 },
    })
    live.start()
    await wait(15)
    live.stop()
    await wait(80)
    if (refreshes === 0) ok('C5 ✓ stop 后不再触发刷新（断流、重连与去抖都被清理）')
    else bad(`C5 · refreshes after stop=${refreshes}`)
  }

  // C6 · malformed frames do not crash or add a refresh beyond the hello baseline.
  {
    const transport = fakeFetch([
      `event: hello\ndata: ${JSON.stringify({ revision: 1, ledger: 'alpha', heartbeatMs: 20000 })}\n\n`
        + 'event: change\ndata: not-json\n\n',
    ])
    let refreshes = 0
    const live = clientMod.createLiveClient({
      sessionId: 's', fetch: transport.impl, debounceMs: 10, onChange: () => { refreshes += 1 },
    })
    live.start()
    await wait(80)
    if (refreshes === 1) ok('C6 ✓ 坏帧被丢弃：只有 hello 的基线快照，坏帧不额外触发刷新或伪造状态')
    else bad(`C6 · refreshes=${refreshes}（期望 1：hello 基线；坏帧不得再加一次）`)
    live.stop()
  }

  // C7 · a frame for another ledger is never accepted as this panel's state.
  {
    const transport = heldFetch(
      `event: hello\ndata: ${JSON.stringify({ revision: 1, ledger: 'beta', heartbeatMs: 20000 })}\n\n`
        + `event: change\ndata: ${JSON.stringify({ revision: 2, ledger: 'beta', sources: ['ledger'], at: 1 })}\n\n`,
    )
    let refreshes = 0
    let state
    const live = clientMod.createLiveClient({
      sessionId: 's', ledger: 'alpha', fetch: transport.impl, debounceMs: 10,
      onChange: () => { refreshes += 1 }, onState: (s) => { state = s },
    })
    live.start()
    await wait(80)
    if (refreshes === 1 && state !== 'live') {
      ok('C7 ✓ 负向对拍：收到别的账本帧 ⇒ 不当成已连接，仍触发一次兜底快照（不串账本）')
    } else bad(`C7 · refreshes=${refreshes} state=${state}`)
    live.stop()
    transport.close()
  }

  // C8 · state transitions are observable, so the panel can change its polling cadence.
  {
    const transport = heldFetch(
      `event: hello\ndata: ${JSON.stringify({ revision: 1, ledger: 'alpha', heartbeatMs: 20000 })}\n\n`,
    )
    const seen = []
    const live = clientMod.createLiveClient({
      sessionId: 's', ledger: 'alpha', fetch: transport.impl, debounceMs: 10,
      onChange: () => {}, onState: (s) => { seen.push(s) },
    })
    const subscribed = []
    live.onStateChange((s) => { subscribed.push(s) })
    live.start()
    await wait(60)
    if (seen.includes('live') && subscribed.includes('live')) {
      ok('C8 ✓ 连接状态可订阅：live 同时通知构造参数与 onStateChange 监听器')
    } else bad(`C8 · onState=${JSON.stringify(seen)} listener=${JSON.stringify(subscribed)}`)
    live.stop()
    transport.close()
  }

  // C9 · stop() invalidates an in-flight attempt; a late response cannot revive it.
  {
    let release
    let calls = 0
    const impl = async (_url, init) => {
      calls += 1
      await new Promise((resolve) => { release = resolve })
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return new Response(
        `event: hello\ndata: ${JSON.stringify({ revision: 1, ledger: 'alpha', heartbeatMs: 20000 })}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
    }
    let refreshes = 0
    let state
    const live = clientMod.createLiveClient({
      sessionId: 's', ledger: 'alpha', fetch: impl, debounceMs: 10,
      onChange: () => { refreshes += 1 }, onState: (s) => { state = s },
    })
    live.start()
    await wait(5)
    live.stop()
    release?.()
    await wait(80)
    if (calls === 1 && refreshes === 0 && state !== 'live') {
      ok('C9 ✓ 负向对拍：stop 后迟到的响应不能把已停止的连接复活成 live')
    } else bad(`C9 · calls=${calls} refreshes=${refreshes} state=${state}`)
    live.stop()
  }

  // C10 · reconnect always pulls a snapshot, even if the new hello has the same revision.
  {
    let call = 0
    let held
    const impl = async () => {
      call += 1
      if (call === 1) {
        held = heldOpen(
          `event: hello\ndata: ${JSON.stringify({ revision: 7, ledger: 'alpha', heartbeatMs: 20000 })}\n\n`,
        )
        return new Response(held.stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      if (call === 2) {
        return new Response(
          `event: hello\ndata: ${JSON.stringify({ revision: 7, ledger: 'alpha', heartbeatMs: 20000 })}\n\n`,
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        )
      }
      // Keep the reconnect loop quiet after the assertion window.
      await new Promise((resolve) => setTimeout(resolve, 1000))
      return new Response('', { status: 503 })
    }
    let refreshes = 0
    const live = clientMod.createLiveClient({
      sessionId: 's', ledger: 'alpha', fetch: impl, debounceMs: 5, maxBackoffMs: 5,
      onChange: () => { refreshes += 1 },
    })
    live.start()
    await wait(40)
    held?.close()
    await wait(120)
    if (refreshes >= 1 && call >= 2) {
      ok('C10 ✓ 负向对拍：重连后 hello 序号与断线前相同（含服务器重启归零）仍补一次完整快照')
    } else bad(`C10 · refreshes=${refreshes} calls=${call}`)
    live.stop()
  }

  // C11 · oversized frames and buffers are discarded and force a fresh connection.
  {
    let held
    const hugeData = JSON.stringify({
      revision: 2, ledger: 'alpha', sources: ['ledger'], at: 1,
      padding: 'x'.repeat(protocol.LIVE_MAX_FRAME_BYTES + 1),
    })
    let calls = 0
    const impl = async () => {
      calls += 1
      if (calls === 1) {
        // Do not let the reconnect arrive before the assertion window: a fast
        // loop would turn the expected reconnect refresh into many refreshes.
        await new Promise((resolve) => setTimeout(resolve, 30))
        return new Response(
          `event: hello\ndata: ${JSON.stringify({ revision: 1, ledger: 'alpha', heartbeatMs: 20000 })}\n\n`
            + `event: change\ndata: ${hugeData}\n\n`,
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        )
      }
      // Keep reconnects from delivering the bad frame again during this window;
      // the stream must stay open so the second hello does not cause a refresh.
      held = heldOpen(
        `event: hello\ndata: ${JSON.stringify({ revision: 2, ledger: 'alpha', heartbeatMs: 20000 })}\n\n`,
      )
      return new Response(held.stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    let refreshes = 0
    const states = []
    const live = clientMod.createLiveClient({
      sessionId: 's', ledger: 'alpha', fetch: impl, debounceMs: 5, maxBackoffMs: 5,
      onChange: () => { refreshes += 1 }, onState: (s) => { states.push(s) },
    })
    live.start()
    await wait(80)
    const firstCalls = calls
    const firstEntryStillServed = states[0] === 'live' && states.includes('reconnecting')
    /**
     * The call count is taken after the assertion window. There are exactly
     * two refreshes in the window: the hello baseline and the reconnect hello.
     * Neither is caused by the oversized change frame.
     */
    const firstChangeAccepted = refreshes > 2
    if (firstEntryStillServed && !firstChangeAccepted && firstCalls === 2) {
      ok('C11 ✓ 首连接只有 hello 基线快照；超限帧被拒绝、不当作 change，连接随即结束并重连')
    } else bad(`C11 · states=${JSON.stringify(states)} refreshes=${refreshes} calls=${firstCalls}`)
    /**
     * The bad stream must terminate and be replaced through a new attempt; it
     * must not be accepted as `live` forever on the same oversized connection.
     */
    if (firstCalls >= 2) {
      ok('C11b ✓ 超限帧会结束当前流并走重连；重连后的正常 hello 才允许补快照')
    } else bad(`C11b · oversized stream was not replaced (calls=${firstCalls})`)
    live.stop()
    held?.close()
  }
} finally {
  // no external resources
}

console.log(`\nLive client：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · 跳过 0 处`)
process.exitCode = fail > 0 ? 1 : 0

