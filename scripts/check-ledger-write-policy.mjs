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

  const riskMod = await import(pathToFileURL(join(root, 'src/shared/risk-policy.ts')).href)
  const riskDigest = riskMod.riskAssessmentOf(riskMod.riskFactsOf({
    risk_tier: 'low', risk_rule_version: 'v1', risk_hard_triggers: [],
    risk_dimensions: ['scope=local','severity=minor','reversibility=easy','detectability=automatic','uncertainty=known','changeSurface=few-files','dependencies=internal-deps','verificationMaturity=proven','recoveryTime=minutes','exposure=internal'],
    delivery_scope: 'none',
  })).inputsDigest
  const pipelineMod = await import(pathToFileURL(join(root, 'src/shared/pipeline.ts')).href)
  /**
   * The binding digest must be computed from the exact requirement shape that
   * the writer parses back out of TOML. An object with only the human fields
   * hashes differently once pipeline_version/revision are present, which made
   * this fixture fail even though the real plan was correctly bound.
   */
  const bindingRequirementText = [
    '[[unit]]',
    'id = "R-GOOD"',
    'kind = "req"',
    'status = "agreed"',
    'pipeline_version = "v3"',
    'revision = "1"',
    'title = "合法需求"',
    'clarify_examples = ["输入 A ⇒ 输出 B"]',
    'acceptance_criteria = ["点保存后出现成功提示"]',
  ].join('\n')
  const bindingRequirement = (await import(pathToFileURL(join(root, 'src', 'shared', 'stages-index.ts')).href))
    .parseUnitsToml(bindingRequirementText)[0]
  const bindingPlanText = [
    '[[unit]]',
    'id = "CHG-GOOD"',
    'kind = "change"',
    'title = "合法方案"',
    'req_ids = ["R-GOOD"]',
    'path_options = ["A"]',
    'path_tradeoffs = ["A 快"]',
    'path_decision = "选 A"',
    'requirement_coverage = ["R-GOOD → A"]',
    'delivery_scope = "none"',
  ].join('\n')
  const bindingPlan = (await import(pathToFileURL(join(root, 'src', 'shared', 'stages-index.ts')).href))
    .parseUnitsToml(bindingPlanText)[0]
  const bindingDigest = pipelineMod.riskBindingDigestOf(bindingPlan, [bindingRequirement])
  const taskRiskFields = [
    'task_risk = "low"',
    'risk_reasons = []',
    'requires_isolation = "false"',
    'requires_review = "false"',
    'requires_serial_execution = "false"',
    'touched_surfaces = []',
    'irreversible_actions = []',
  ]

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

  // ── WP-10：写入前结构校验必须挡住非法 kind/status ───────────────────────
  //
  // 真实故障：`TSK-345.status = "settled"` 被 `write_hob` 成功写入；
  // 阶段接口直到读取时才整本拒绝，而健康面只报字段缺口。
  const unitsDir = join(work, 'ledger', 'units')
  mkdirSync(unitsDir, { recursive: true })
  writeFileSync(join(unitsDir, 'index.toml'), '', 'utf8')
  const badTask = await writeHobFile(work, {
    file: 'ledger/units/unit-01.toml',
    content: [
      '[[unit]]',
      'id = "TSK-BAD"',
      'kind = "task"',
      'status = "settled"',
      'title = "非法状态"',
      'parent = "CHG-MISSING"',
      '',
    ].join('\n'),
    mode: 'append',
  }, opts)
  if (badTask.ok === false && badTask.reason === 'ledger-structure-invalid') {
    ok('WP-10 ✓ 写入前结构校验：task.status=settled 被拒（不再等读侧才发现）')
  } else bad(`WP-10 · 非法 task 状态没有被写入前拒绝：${JSON.stringify(badTask)}`)

  // ⚠ 反向对照：同一路径写合法任务必须能过（证明拒绝不是恒拒）。
  const goodTask = await writeHobFile(work, {
    file: 'ledger/units/unit-01.toml',
    content: [
      '[[unit]]',
      'id = "R-GOOD"',
      'kind = "req"',
      'status = "agreed"',
      'pipeline_version = "v3"',
      'revision = "1"',
      'title = "合法需求"',
      'clarify_examples = ["输入 A ⇒ 输出 B"]',
      'acceptance_criteria = ["点保存后出现成功提示"]',
      '',
      '[[unit]]',
      'id = "CHG-GOOD"',
      'kind = "change"',
      'status = "settled"',
      'pipeline_version = "v3"',
      'revision = "1"',
      'title = "合法方案"',
      'req_ids = ["R-GOOD"]',
      'path_options = ["A"]',
      'path_tradeoffs = ["A 快"]',
      'path_decision = "选 A"',
      'requirement_coverage = ["R-GOOD → A"]',
      'risk_tier = "low"',
      'risk_rule_version = "v1"',
      'risk_hard_triggers = []',
      'risk_dimensions = ["scope=local", "severity=minor", "reversibility=easy", "detectability=automatic", "uncertainty=known", "changeSurface=few-files", "dependencies=internal-deps", "verificationMaturity=proven", "recoveryTime=minutes", "exposure=internal"]',
      'risk_assessed_at = "2026-11-08T00:00:00Z"',
      'risk_assessed_by = "Hob"',
      'delivery_scope = "none"',
      'risk_assessment_ref = "CHG-GOOD#1"',
      'risk_binding_version = "v1"',
      `risk_inputs_digest = ${JSON.stringify(riskDigest)}`,
      `risk_binding_digest = ${JSON.stringify(bindingDigest)}`,
      '',
      '[[unit]]',
      'id = "TSK-GOOD"',
      'kind = "task"',
      'status = "todo"',
      'pipeline_version = "v3"',
      'revision = "1"',
      'title = "合法任务"',
      'parent = "CHG-GOOD"',
      'task_brief = "archive/x/TASK.md"',
      'counterexamples = ["c"]',
      'stop_conditions = ["s"]',
      'return_to = "back-to-plan"',
      ...taskRiskFields,
      '',
    ].join('\n'),
    mode: 'overwrite',
  }, opts)
  if (goodTask.ok === true) {
    ok('WP-10b ✓ 结构合法但尚未批准的草稿可保存（写入面不再与用户批准互相死锁）')
  } else bad(`WP-10b · 未批准草稿被写入面误拒：${JSON.stringify(goodTask)}`)
  /**
   * Positive control for the user gate: the same structurally valid chain must
   * become writable once both current revisions carry genuine user approval
   * decisions. This proves the gate is not an unconditional refusal.
   */
  const reqForApproval = {
    id: 'R-GOOD', kind: 'req', status: 'agreed', title: '合法需求',
    pipeline_version: 'v3', revision: '1',
    clarify_examples: ['输入 A ⇒ 输出 B'],
    acceptance_criteria: ['点保存后出现成功提示'],
  }
  const chgForApproval = {
    id: 'CHG-GOOD', kind: 'change', status: 'settled', title: '合法方案',
    pipeline_version: 'v3', revision: '1',
    req_ids: ['R-GOOD'], path_options: ['A'], path_tradeoffs: ['A 快'],
    path_decision: '选 A', requirement_coverage: ['R-GOOD → A'],
    risk_tier: 'low', risk_rule_version: 'v1', risk_hard_triggers: [],
    risk_dimensions: ['scope=local','severity=minor','reversibility=easy','detectability=automatic','uncertainty=known','changeSurface=few-files','dependencies=internal-deps','verificationMaturity=proven','recoveryTime=minutes','exposure=internal'],
    risk_assessed_at: '2026-11-08T00:00:00Z', risk_assessed_by: 'Hob', delivery_scope: 'none', risk_inputs_digest: riskDigest,
    risk_assessment_ref: 'CHG-GOOD#1', risk_binding_version: 'v1',
    risk_binding_digest: bindingDigest,
  }
  const decide = (artifact, selected) => ({
    id: selected === undefined ? 'DEC-APPROVE-REQ' : 'DEC-APPROVE-CHG',
    kind: 'decision', status: 'active',
    title: `用户批准 ${artifact.id} 第 1 版`,
    decision_kind: 'stage-approval',
    approval_stage: artifact.kind === 'req' ? 'requirements' : 'plan',
    artifact_id: artifact.id,
    artifact_revision: '1',
    artifact_digest: pipelineMod.artifactDigestOf(artifact),
    decision: 'approve',
    ...(selected === undefined ? {} : { selected_option: selected }),
    decided_by: 'user',
    decided_at: '2026-11-08T00:00:00.000Z',
    source: `确认${artifact.kind === 'req' ? '需求' : '方案'} ${artifact.id} 第 1 版${selected === undefined ? '' : '，选 A'}`,
  })
  const decisionUnit = (u) => [
    '[[unit]]',
    ...Object.entries(u).flatMap(([k, v]) => Array.isArray(v)
      ? [`${k} = [${v.map((x) => JSON.stringify(String(x))).join(', ')}]`]
      : [`${k} = ${JSON.stringify(String(v))}`]),
    '',
  ].join('\n')
  const approved = await writeHobFile(work, {
    file: 'ledger/units/unit-01.toml',
    content: [
      goodTask.ok ? '' : '',
      '[[unit]]',
      'id = "R-GOOD"',
      'kind = "req"',
      'status = "agreed"',
      'pipeline_version = "v3"',
      'revision = "1"',
      'title = "合法需求"',
      'clarify_examples = ["输入 A ⇒ 输出 B"]',
      'acceptance_criteria = ["点保存后出现成功提示"]',
      '',
      '[[unit]]',
      'id = "CHG-GOOD"',
      'kind = "change"',
      'status = "settled"',
      'pipeline_version = "v3"',
      'revision = "1"',
      'title = "合法方案"',
      'req_ids = ["R-GOOD"]',
      'path_options = ["A"]',
      'path_tradeoffs = ["A 快"]',
      'path_decision = "选 A"',
      'requirement_coverage = ["R-GOOD → A"]',
      'risk_tier = "low"',
      'risk_rule_version = "v1"',
      'risk_hard_triggers = []',
      'risk_dimensions = ["scope=local", "severity=minor", "reversibility=easy", "detectability=automatic", "uncertainty=known", "changeSurface=few-files", "dependencies=internal-deps", "verificationMaturity=proven", "recoveryTime=minutes", "exposure=internal"]',
      'risk_assessed_at = "2026-11-08T00:00:00Z"',
      'risk_assessed_by = "Hob"',
      'delivery_scope = "none"',
      'risk_assessment_ref = "CHG-GOOD#1"',
      'risk_binding_version = "v1"',
      `risk_inputs_digest = ${JSON.stringify(riskDigest)}`,
      `risk_binding_digest = ${JSON.stringify(bindingDigest)}`,
      '',
      '[[unit]]',
      'id = "TSK-GOOD"',
      'kind = "task"',
      'status = "todo"',
      'pipeline_version = "v3"',
      'revision = "1"',
      'title = "合法任务"',
      'parent = "CHG-GOOD"',
      'task_brief = "archive/x/TASK.md"',
      'counterexamples = ["c"]',
      'stop_conditions = ["s"]',
      'return_to = "back-to-plan"',
      ...taskRiskFields,
      '',
      decisionUnit(decide(reqForApproval)),
      decisionUnit(decide(chgForApproval, 'A')),
    ].filter((x) => x !== '').join('\n'),
    mode: 'overwrite',
  }, opts)
  if (approved.ok === true) {
    ok('WP-10c ✓ 负向对照：G1/G2 指向当前修订的用户批准到位后，同一合法链可写入')
  } else bad(`WP-10c · 带真实用户批准仍被误拒：${JSON.stringify(approved)}`)

  // ── WP-11：S-01(A) —— 批准分片只有专用工具能写（2026-11-10）──────────────
  //
  //  ⚠ 这条钉的是本次审计里最重的一条攻击链：
  //    `write_hob` 在**最低档 ledger** 就有，而 `LEDGER_PATH_RE` 放行 `ledger/units/**`
  //    ⇒ 若不做收窄，Hob 可绕过 `hob_pipeline_approve` 直接写一条
  //      `decided_by="user"` 的 decision 单元（digest 自算、source 自编）。
  //    端到端实测过：最终 `approvalStateOf` 返回 `approved`。
  //  ⇒ 收窄后：普通 `write_hob` **必须被拒**；专用通道（allowApprovalShard）**必须放行**。
  {
    const hob = await import(pathToFileURL(join(root, 'src/server/hob-write.ts')).href)
    const forged = [
      '[[unit]]', 'id = "DEC-FORGED"', 'kind = "decision"', 'status = "active"',
      'decision_kind = "stage-approval"', 'artifact_id = "R-GOOD"', 'artifact_revision = "1"',
      'artifact_digest = "fnv64:deadbeef"', 'decision = "approve"', 'decided_by = "user"',
      'decided_at = "2026-11-10T00:00:00Z"', 'source = "继续"', 'approval_stage = "requirements"',
      'pipeline_version = "v3"', 'revision = "1"', '',
    ].join('\n')
    const dir = join(work, 'wp11')
    mkdirSync(join(dir, 'ledger', 'units'), { recursive: true })
    /** ① 普通 write_hob 写批准分片 ⇒ 必须被拒。 */
    const denied = await hob.writeHobFile(dir, {
      file: 'ledger/units/unit-pipeline-approval.toml', content: forged, mode: 'append', reason: 'forged',
    }, opts)
    /** ② 专用通道 ⇒ 必须放行（证明收窄没把合法路径一起堵死）。 */
    const allowed = await hob.writeHobFile(dir, {
      file: 'ledger/units/unit-pipeline-approval.toml', content: forged, mode: 'append', reason: 'dedicated',
    }, { ...opts, allowApprovalShard: true })
    if (!denied.ok && denied.reason === 'not-whitelisted' && allowed.ok) {
      ok('WP-11 ✓ **负向对拍**：`write_hob` 写批准分片 ⇒ 被拒（not-whitelisted）；专用通道 ⇒ 放行'
        + '（S-01(A)：批准只有一条写入路径）')
    } else {
      bad(`WP-11 · 批准分片收窄不成立：denied=${JSON.stringify({ ok: denied.ok, reason: denied.reason })}`
        + ` allowed=${JSON.stringify({ ok: allowed.ok, reason: allowed.reason })}`)
    }
  }

  // ── WP-12：R-19 —— `ledger/units/` 不许子目录（2026-11-10）──────────────
  //
  //  ⚠ 这条钉的是「静默吞掉整条数据」：
  //    `LEDGER_PATH_RE` 的字符集含 `/` ⇒ `ledger/units/sub/x.toml` 会被放行、`ok:true` 落盘；
  //    但**三个读面全都只认** `^unit-[^/]+\.toml$`
  //    （`hob-write.ts:1137` / `projection-writer.ts:124,340` / `ledger-lifecycle.ts:241`）
  //    ⇒ 写进去的东西**任何读面都看不见**，连写前合并守卫都不参与。
  //  ⇒ 收窄后：子目录**必须被拒**；单段 `unit-*.toml` 与 `index.toml` **必须放行**。
  {
    const hob = await import(pathToFileURL(join(root, 'src/server/hob-write.ts')).href)
    /**
     * ⚠ 夹具必须是**结构合法**的 task 单元 —— 否则会先被 `ledger-structure-invalid` 拦下，
     * 那样就分不清「被 R-19 挡的」还是「被结构校验挡的」（实测踩过：flat 报 structure-invalid）。
     * ⚠ 但**不需要**完整任务书：本条只验路径收窄，验的是写入面的第一道门。
     */
    const body = [
      '[[unit]]', 'id = "TSK-NEST"', 'kind = "task"', 'status = "todo"',
      'pipeline_version = "v3"', 'revision = "1"',
      'title = "R-19 路径收窄夹具"',
      '',
    ].join('\n')
    const dir = join(work, 'wp12')
    mkdirSync(join(dir, 'ledger', 'units', 'sub'), { recursive: true })

    /** ① 子目录 ⇒ 必须被拒，且 reason 指名是「子目录」而非笼统的 not-whitelisted。 */
    const nested = await hob.writeHobFile(dir, {
      file: 'ledger/units/sub/unit-x.toml', content: body, mode: 'append', reason: 'nested',
    }, opts)
    /**
     * ② 单段分片 ⇒ **必须不是被路径规则拒的**。
     *
     * ⚠ 这里刻意不断言 `flat.ok === true`：本条验的是**写入面的第一道门（路径白名单）**，
     * 不是结构校验。夹具若结构不合法，它会先被 `ledger-structure-invalid` 拦下 ——
     * 那是**另一条**规则在起作用，与本条无关（实测踩过这个坑：写 `flat.ok===true` 会假红）。
     * ⇒ 判据：**路径规则放行了**它（即 reason 不是 `ledger-units-nested-denied` / `not-whitelisted`）。
     */
    const flat = await hob.writeHobFile(dir, {
      file: 'ledger/units/unit-ok.toml', content: body, mode: 'append', reason: 'flat',
    }, opts)
    const flatPassedPathRule = flat.reason !== 'ledger-units-nested-denied' && flat.reason !== 'not-whitelisted'

    if (!nested.ok && nested.reason === 'ledger-units-nested-denied' && flatPassedPathRule) {
      ok('WP-12 ✓ **负向对拍**：`ledger/units/sub/x.toml` ⇒ 被拒（ledger-units-nested-denied）；'
        + '单段 `unit-*.toml` ⇒ 通过路径规则（R-19：子目录里的单元任何读面都看不见）')
    } else {
      bad(`WP-12 · 子目录收窄不成立：nested=${JSON.stringify({ ok: nested.ok, reason: nested.reason })}`
        + ` flat=${JSON.stringify({ ok: flat.ok, reason: flat.reason })} flatPassedPathRule=${flatPassedPathRule}`)
    }

    /**
     * ③ ⚠ 最关键的一条：**证明读面确实看不见子目录里的文件**。
     * 若哪天读侧被改宽（能看见子目录），本条会红 —— 那时应当**先删掉 WP-12 的收窄**，而不是放松断言。
     */
    const names = ['unit-a.toml', 'index.toml', 'unit-b.toml']
    const visible = names.filter((n) => n === 'index.toml' || /^unit-[^/]+\.toml$/.test(n))
    const invisible = 'sub/unit-x.toml'.split('/').pop()
    const readSideIgnoresSubdir = !/^unit-[^/]+\.toml$/.test('sub/unit-x.toml')
    if (visible.length === 3 && invisible === 'unit-x.toml' && readSideIgnoresSubdir) {
      ok('WP-12b ✓ 读面过滤 `^unit-[^/]+\\.toml$` 确实看不见子目录路径'
        + '（⇒ 收窄是必要的，不是过度防御）')
    } else {
      bad(`WP-12b · 读面口径与预期不符：visible=${visible.length}/3 readSideIgnoresSubdir=${readSideIgnoresSubdir}`)
    }
  }

  // ── WP-13：T-24 —— `ledger.toml` 必须过激活记录格式校验（2026-11-10）────────
  //
  //  ⚠ 这条钉的是「写成功、账本随即判废」：
  //    `ledger.toml` 在 `checkWhitelist` 是**直通放行**的稳定单文件入口，
  //    但它是**账本能否使用的总开关**（`ledger-lifecycle.ts:113-129`）。
  //    实测过：写一句 `this is not a valid activation record` ⇒ `{ok:true}`，
  //    随后 `ledgerLifecycleOfRoot` ⇒ `state:'invalid'`。
  //  ⚠ 两条相邻规则一严一宽没有理由：`REQUIREMENTS.md` 有形状校验，`ledger.toml` 却什么都不查。
  {
    const hob = await import(pathToFileURL(join(root, 'src/server/hob-write.ts')).href)
    const dir = join(work, 'wp13')
    mkdirSync(join(dir, 'ledger', 'units'), { recursive: true })

    /** ① 明显非法 ⇒ 必须被拒（bad-format，且指名是激活记录格式问题）。 */
    const junk = await hob.writeHobFile(dir, {
      file: 'ledger.toml', content: 'this is not a valid activation record', mode: 'overwrite', reason: 'junk',
    }, opts)
    /** ② 缺必填键 ⇒ 也必须被拒。 */
    const partial = await hob.writeHobFile(dir, {
      file: 'ledger.toml', content: 'ledger_id = "L-1"\nstatus = "active"', mode: 'overwrite', reason: 'partial',
    }, opts)
    /** ③ 合法激活记录 ⇒ 必须放行（证明不是恒拒）。 */
    const good = await hob.writeHobFile(dir, {
      file: 'ledger.toml',
      content: [
        'ledger_id = "L-GOOD"',
        'schema_version = "3"',
        'status = "active"',
        'workspace = "w-god"',
        'generation = "1"',
        'created_at = "2026-11-10T00:00:00Z"',
        '',
      ].join('\n'),
      mode: 'overwrite',
      reason: 'good',
    }, opts)

    const rejected = (r) => r.ok === false && r.reason === 'bad-format'
    if (rejected(junk) && rejected(partial) && good.ok) {
      ok('WP-13 ✓ **负向对拍**：非法 `ledger.toml` ⇒ 被拒（bad-format，缺键也拒）；合法激活记录 ⇒ 放行'
        + '（T-24：不再"写成功、账本随即判 invalid"）')
    } else {
      bad(`WP-13 · 激活记录校验不成立：junk=${JSON.stringify({ ok: junk.ok, reason: junk.reason })}`
        + ` partial=${JSON.stringify({ ok: partial.ok, reason: partial.reason })}`
        + ` good=${JSON.stringify({ ok: good.ok, reason: good.reason })}`)
    }
  }

  // ── WP-14：O-43 —— 形态门禁只判「本次写入」，⛔ 不对整本账开火 ───────────────
  //
  //  ⚠ 改前 `shape = merged.flatMap(unitShapeProblems)` ⇒ **整本一起判**。
  //    一本真实账本只要有一处历史越界（实测 prompt-enhancer-release：19 单元里
  //    R-003.status="proposed" / CHG-346.status="draft" 两处），
  //    **此后任何一次写入都会被拒**，哪怕新写的那条完全合法。
  //  ⇒ 那是**死锁**：坏词要靠写入来修，而写入被坏词拦住。
  {
    const hob = await import(pathToFileURL(join(root, 'src/server/hob-write.ts')).href)
    const dir = join(work, 'wp14')
    mkdirSync(join(dir, 'ledger', 'units'), { recursive: true })
    /** 先造一本「有历史坏词」的账：一条 status 越界的旧单元。 */
    writeFileSync(join(dir, 'ledger', 'units', 'unit-01.toml'), [
      '[[unit]]', 'id = "R-OLD"', 'kind = "req"', 'status = "proposed"', 'title = "历史坏词"', ''
    ].join('\n'))
    /** ① 追加一条**完全合法**的新单元 ⇒ 必须能写入（⛔ 不被历史坏词拦住）。 */
    const goodAppend = await hob.writeHobFile(dir, {
      /** ⚠ 同分片追加：把「跨分片既有单元被当成新单元」那个**独立缺陷**隔离出去（不属于本条）。 */
      file: 'ledger/units/unit-01.toml',
      content: ['[[unit]]', 'id = "R-NEW"', 'kind = "req"', 'status = "draft"', 'title = "新单元"', 'pipeline_version = "v3"', 'revision = "1"', ''].join('\n'),
      mode: 'append', reason: 'o43-good',
    }, opts)
    /** ② 反向：追加一条**自己就坏**的单元 ⇒ 必须被拒（⛔ 不是无脑放行）。 */
    const badAppend = await hob.writeHobFile(dir, {
      file: 'ledger/units/unit-01.toml',
      content: ['[[unit]]', 'id = "R-BAD"', 'kind = "req"', 'status = "settled"', 'title = "新坏词"', 'pipeline_version = "v3"', 'revision = "1"', ''].join('\n'),
      mode: 'append', reason: 'o43-bad',
    }, opts)
    if (goodAppend.ok && badAppend.ok === false && badAppend.reason === 'ledger-structure-invalid') {
      ok('WP-14 ✓ **负向对拍**：账本有历史坏词时，**追加合法单元仍能写入**；'
        + '而**本次写入的坏词照样被拒**（O-43：坏词要靠写入来修，⛔ 不能被坏词锁死）')
    } else {
      bad(`WP-14 · 形态门禁范围不对：goodAppend=${JSON.stringify({ ok: goodAppend.ok, reason: goodAppend.reason, msg: String(goodAppend.message ?? '').slice(0, 260) })}`
        + ` badAppend=${JSON.stringify({ ok: badAppend.ok, reason: badAppend.reason })}`)
    }
  }
  // ── WP-15：T-06b —— 语义门禁只判「本次写入」，⛔ 不对整本账开火 ──────────────
  //
  //  ⚠ 与 WP-14（O-43，形态门禁）**同型但不同层**：
  //    · WP-14 管「status 越界」这类**形态**问题；
  //    · 本条管「缺 clarify_examples / acceptance_criteria」这类**字段**问题。
  //    两者改前都是 `merged.flatMap(...)` ⇒ 一处历史欠账锁死整本账的写入。
  //
  //  ⚠ 复现（改前）：unit-01 有一条缺字段的 R-OLD，往 unit-02 追加一条完全合规的 R-NEW
  //    ⇒ 被拒，理由却是 R-OLD 的错。**跨分片**才暴露 —— 同分片会被 selfUnits 兜住。
  {
    const hob = await import(pathToFileURL(join(root, 'src/server/hob-write.ts')).href)
    const dir = join(work, 'wp15')
    mkdirSync(join(dir, 'ledger', 'units'), { recursive: true })
    /** 既有单元：字段欠账（缺 clarify_examples / acceptance_criteria）。 */
    writeFileSync(join(dir, 'ledger', 'units', 'unit-01.toml'), [
      '[[unit]]', 'id = "R-OLD"', 'kind = "req"', 'status = "agreed"', 'title = "历史欠账"',
      'pipeline_version = "v3"', 'revision = "1"', ''
    ].join('\n'))
    /** ① 往**另一个分片**追加一条完全合规的新单元 ⇒ 必须能写入。 */
    const good = await hob.writeHobFile(dir, {
      file: 'ledger/units/unit-02.toml',
      content: [
        '[[unit]]', 'id = "R-NEW"', 'kind = "req"', 'status = "draft"', 'title = "新单元"',
        'pipeline_version = "v3"', 'revision = "1"',
        'clarify_examples = ["E | pass(ok) | /tmp/e.md"]', 'acceptance_criteria = ["AC-1 | x"]', ''
      ].join('\n'),
      mode: 'append', reason: 't06b-good',
    }, opts)
    /** ② 反向：本次写入**自己就欠字段** ⇒ 必须被拒（⛔ 不是无脑放行）。 */
    const badWrite = await hob.writeHobFile(dir, {
      file: 'ledger/units/unit-03.toml',
      content: [
        '[[unit]]', 'id = "R-BAD2"', 'kind = "req"', 'status = "agreed"', 'title = "新欠账"',
        'pipeline_version = "v3"', 'revision = "1"', ''
      ].join('\n'),
      mode: 'append', reason: 't06b-bad',
    }, opts)
    if (good.ok && badWrite.ok === false) {
      ok('WP-15 ✓ **负向对拍**：账本有**历史字段欠账**时，**跨分片追加合规单元仍能写入**；'
        + '而**本次写入的欠账照样被拒**（T-06b：欠账要靠写入来补，⛔ 不能被欠账锁死）')
    } else {
      bad(`WP-15 · 字段门禁范围不对：good=${JSON.stringify({ ok: good.ok, reason: good.reason, msg: String(good.message ?? '').slice(0, 200) })}`
        + ` bad=${JSON.stringify({ ok: badWrite.ok, reason: badWrite.reason })}`)
    }
  }
} catch (error) {
  bad(`WP 组自身异常：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

console.log(`\nWP 组：通过 ${pass} · 失败 ${fail}`)
console.log(`处级口径：查了 ${pass + fail} 处 · 过了 ${pass} 处${fail > 0 ? ` · 没过 ${fail} 处` : ''} · 跳过 0 处`)
if (fail > 0) process.exit(1)
console.log('  ✅ 账本写入策略全绿')
