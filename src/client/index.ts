/**
 * client 半边入口 —— 注册本插件的**设置分区**（C1）。
 *
 * ── 本文件做什么 ──────────────────────────────────────────────────────
 *   把 {@link SettingsPanel} 挂到宿主设置界面的槽位 `settings.section`，
 *   使本插件在设置界面里有一个自己的分区（用户点得进去、看得见）。
 *
 * ── 与「宿主自动生成的表单」的分工（重要，避免重复造轮子）────────────
 *   · **改值** 走宿主在**插件管理页**为每个插件自动生成的表单
 *     （`autoGenerate=true`，字段标签来自 `config.ts` 的 `.description()`）；
 *   · **本分区** 提供人话摘要 + 两条语义说明（尤其"模块开关要重启"这条）。
 *   两者读的是**同一个** `configForms` 快照，不会不一致。
 *
 * ⚠ 三条已验证的纪律（全部来自旧项目实测，详见 `.hob/EXPERIENCE.md`）：
 *
 *   ① `apply` 里要用 `ctx.slots` 就必须 `export const inject = ['slots']`
 *      （cordis 的 inject 是**加载门禁**：列进来的服务缺失会让组合不挂载）。
 *
 *   ② `ctx.slots.register` **必须带 `name` 字段**（= 槽位名），缺它报
 *      "slot undefined is not declared"；list 槽还必须给**唯一 `id`** ——
 *      复用官方 id 会顶掉那一格，新增自己的 id 才是"加一个条目"。
 *
 *   ③ 一切资源注册都要挂 `ctx.effect`（或用 `ctx.slots.inject` —— 它本身就是
 *      反应式+自动清理的封装），热重载/卸载时自动清理。
 *
 * ⚠ 另一条坑：**client 半边收不到插件 config**。
 *   客户端挂载路径是 `loader.create({ name: id })` —— 只传 name，没有 config。
 *   所以本文件 `apply` **只有 ctx 一个参数**；配置必须启动后经 DSH 原生
 *   `configForms`（Remote RPC）拉取，**不要**自己造 HTTP 路由（E-10）。
 */
import { SettingsPanel } from './settings-panel.tsx'
import { bindSettingsForm } from './settings.ts'
import { ensurePanelStyles } from './panel-styles.ts'

/** 包名：同时作为模块 id、槽位条目来源标识、settings namespace。 */
const PACKAGE_NAME = 'dsh-hob'

/**
 * 槽位依赖：`slots` 服务（宿主 UI 槽位机制）。
 *
 * ⚠ 少了这一行，`apply` 里访问 `ctx.slots` 会抛
 *   "cannot get property slots without inject"。
 */
export const inject = ['slots']

export function apply(ctx: any): void {
  ctx.logger?.debug?.(`[${PACKAGE_NAME}] client 半边已加载`)

  // 样式只注入一次（幂等），并挂在 `ctx.effect` 上：
  // 卸载/热重载时把**本次新建的那一个** `<style>` 摘掉，避免累积成孤儿标签。
  // ⚠ 宿主 `client-modules` 也会按 `data-plugin` 清理（`removeOwnedStyles`），
  //   两条路径互不冲突：谁都可能先跑，先跑的那个删掉、后跑的查询命中 null 即跳过。
  // ⚠ 为什么不是 `.module.css`：见 `./panel-styles.ts` 文件头（tsdown实测依据）。
  ctx.effect(() => {
    const tag = ensurePanelStyles()
    return () => { tag?.remove() }
  }, `${PACKAGE_NAME}: settings panel styles`)

  // 先把 configForms 反应式绑上：面板渲染时读它。
  // ⚠ 用 `ctx.inject` 反应式订阅，**不能**在 apply 里一次性 `ctx.get` ——
  //   fiber 并行激活，一次性取值会在服务就绪前拿到 undefined 且**无报错**（E-01）。
  ctx.effect(
    () => bindSettingsForm(ctx),
    `${PACKAGE_NAME}: configForms binding`,
  )

  // ⚠ `ctx.slots.inject` 本身就是"等槽位存在再注册"的反应式封装：
  //   槽位缺席时**不注册、不报错**（宿主其它界面插件未装载时也不该炸）。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    // 唯一 id：新增一格，不复用官方 id（复用会顶掉那一格）。
    id: PACKAGE_NAME,
    // 排在宿主自带分区之后，不抢位。
    order: 50,
    // 分区标题 —— **就是包名本身**（用户 2026-10-05 定，UD-24）：
    // 「dsh-hob」，明确不要中文别名；便于与插件管理页里的包名对上。
    label: () => 'dsh-hob',
  }, SettingsPanel))
}
