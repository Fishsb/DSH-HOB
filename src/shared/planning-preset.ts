/**
 * 「新建会话默认」**不作候选**的预设 id —— **全仓唯一一处字面值**。
 *
 * ── 为什么要排除它（用户裁定 · 2026-10-10 · 第 9 轮）────────────────────
 *   用户原话：
 *   > 「新建预设的选项不应该有 hob 模式了吧，hob 模式新建是为了具体施工的，
 *   >   hob 本身没有施工能力，这不是死循环了吗」
 *
 *   理由成立（本插件自己的预设声明里就写死了）：`Hob` **去掉** persistent-shell 组
 *   ⇒ 无 `bash` / `pwsh`；**不加** `tool-bash` / `tool-pwsh` / `delegation`；
 *   白名单不含 `write` / `edit`；契约开头即声明
 *   *"You never carry out the work itself … you cannot edit code, you cannot run a command."*
 *   ⇒ 拿 `Hob` 当**新会话的默认预设**派出去，新会话只能再规划、**不能施工** = **死循环**。
 *
 * ── ⚠ 排除的语义（别读成别的）───────────────────────────────────────────
 *   排除的是**本插件的规划侧预设**（现为 {@link PLANNING_PRESET_ID}），
 *   **不是**"所有非内置预设"，也**不是**"用户自建预设"。
 *   ⇒ 用户自建的其它预设照旧是候选；换个名字/新增规划侧预设时，**只改这一个常量**。
 *
 * ── ⚠ 为什么单独一个文件（而不是写在 catalog.ts 或 bus.ts 里）────────────
 *   这个 id 有**两个消费方，分属两个编译单元**：
 *     · client 半边 —— `src/client/catalog.ts`（候选列表要把它排除、并可见地说明）；
 *     · host  半边 —— `src/modules/bus.ts`（派活解析默认值时**不套用**它，见该处注释）；
 *   而**唯一值**必须只有一处（防漂移）。client 半边由 tsdown 打包、host 半边由 tsc 编译，
 *   两边都能 import 本文件（实测：`npm run typecheck` 与 `npm run build:client` 皆过）。
 *
 * ── 机检锚定（防漂移）───────────────────────────────────────────────────
 *   本常量必须与 `preset/dsh-hob/preset-dsh-hob.patch.yml` 里 `config.id` 声明的 id
 *   **逐字一致** —— 将来预设改名而这里没跟上 ⇒ `npm run check:presets` **直接 FAIL**
 *   （断言见 `scripts/check-preset-contracts.mjs` 的 ⑦ 组）。
 *   同时 `check:client` 钉住"client 侧经本常量判定，而不是自己写一个字面量"。
 */
export const PLANNING_PRESET_ID = 'Hob'
