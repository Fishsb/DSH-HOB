/**
 * ⚠ ⚠ **生成物 —— ⛔ 不许手改**（改它没用：收尾断言拿仓库重算，不一致即 FAIL）。
 *
 * 生成：`node scripts/gen-skeleton-manifest.mjs`（2026-10-16 · 第 224 轮 · `UD-118`「C」）
 * 判据：`scripts/check-code-face.mjs` 的 `runSkeletonSource`（⚠ 提取不到即 FAIL —— `E-130` / `E-131`）。
 *
 * ⚠ **源 = 仓库的 `.hob/**`**（唯一来源）；`allowlist` 派生自 `.gitignore` 的 `!` 例外（⛔ 不手抄）。
 * ⚠ **记录层（`EXPERIENCE.md` / `experience/**`）与本项目备份（`backups/**`）⛔ 不在内** ——
 *    理由见生成脚本的文件头（⚠ 铺过去会造出一堆悬空引用）。
 */
export interface SkeletonEntry {
  /** 相对 `.hob/` 的 POSIX 路径。 */
  path: string
  /** 该件在**仓库**里的 sha256（⚠ 同源判据的基准）。 */
  sha256: string
  /** 该件字节数（⚠ 只作读数，判据用 `sha256`）。 */
  bytes: number
}

/** ⚠ 允许铺的相对路径（`.hob/…`）—— 派生自 `.gitignore` 的 `!` 例外，**已剔除记录层**。 */
export const SKELETON_ALLOWLIST: readonly string[] = [
  ".hob/README.md",
  ".hob/INIT.md",
  ".hob/templates",
  ".hob/templates/**",
  ".hob/drafts",
  ".hob/drafts/**",
  ".hob/roles",
  ".hob/roles/**"
]

/** ⚠ 逐件 sha256（⚠ 与仓库不一致 ⇒ 收尾断言 FAIL）。 */
export const SKELETON_ENTRIES: readonly SkeletonEntry[] = [
  { path: 'INIT.md', sha256: '31407dd97faed5b2dfeaa2eae771dab8ce0c2aaa9a3f22e06c67df8b36689b24', bytes: 25157 },
  { path: 'README.md', sha256: '0a287c5077a119aab2306428df769c3cfda42cea6843d1bbc539037db7c98fa7', bytes: 55750 },
  { path: 'drafts/archive-index.md', sha256: '5926b04f828bb1de6f4874133862affefabebd6e65b2b9d7e512c1914d2157d9', bytes: 7967 },
  { path: 'drafts/check-gitignore-guide.md', sha256: 'f68f45639fde88ada30635df480d1ce23f2b6c9f9ba584b383a2a0db4bbadb04', bytes: 19714 },
  { path: 'drafts/contract-verification-notes.md', sha256: '571cc0b8be2e1688d7a7ef849783fccf65fd5c1ad8572417a1ed1edc112e2bb2', bytes: 18577 },
  { path: 'drafts/discipline-details.md', sha256: '551ca449193338c0b9c541f484c1f1f605921460ab2e055dd305a0678075046c', bytes: 35992 },
  { path: 'drafts/growth-registry.md', sha256: '2d0bb5b55321f6611869936252ecedcc976a51e3a64806e5a8c67d64cc7d89a6', bytes: 11800 },
  { path: 'drafts/nav-intake-draft.md', sha256: 'ea34ab8a129da640c5532b561b09df84c54c31d314d2596b8250feee7be26e06', bytes: 11036 },
  { path: 'drafts/preset-contracts.md', sha256: 'ad5024eee14653442951caeefdd2c0364efd7f952764712f20abe93fc1008e88', bytes: 45192 },
  { path: 'drafts/restructure-plan.md', sha256: '38bfa48e573f5b527d278e6ee8b3c7c29a545d439dcd462ce9bd4289a26eb710', bytes: 18638 },
  { path: 'drafts/架构总览.html', sha256: 'df003d12d89372ab93f67360e022d041eaed53a775c74dc098e76d67dd5d5135', bytes: 9522 },
  { path: 'drafts/架构总览.png', sha256: '0430caae59894c937b6e712d099ad80491e72da9e7cbf214e5508fb3dc1b23b8', bytes: 133570 },
  { path: 'roles/methods/architect.md', sha256: '2ebc77a07ddcffabeba76d8b9f81cf65b00ee38afac0b26eb1b64762952541fe', bytes: 1456 },
  { path: 'roles/methods/backend-dev.md', sha256: 'a4059f331c7e40251725e064b1b32b7a03a4c06c196de7c8150233483ad07dae', bytes: 592 },
  { path: 'roles/methods/copywriter.md', sha256: '987a95ec2d57b782dffa6610542aef5ffe3a4ef088b65274073237558dea4afa', bytes: 1471 },
  { path: 'roles/methods/data-analyst.md', sha256: '9d6e1179f8c205ce32fb6f9eba91f828613150a8134e621102ecae52fb2461e9', bytes: 1395 },
  { path: 'roles/methods/database.md', sha256: '28e8e4727eece80b8c05e5f6f32377b6103266c11a2eedda46c63a3b529c2ec8', bytes: 526 },
  { path: 'roles/methods/devops.md', sha256: '4998016e35e77f3598e4404c1ad5fc28bf1d62168480c4791051365b56a12e20', bytes: 632 },
  { path: 'roles/methods/finance.md', sha256: '4b3ab071064ea5fbfdd9e4794472609df41efada8c4e80ff4b4c5cd52d7771bc', bytes: 1560 },
  { path: 'roles/methods/frontend-dev.md', sha256: '121034cbb452d91fa7dd3a76818b136e56fa27a2e31f55aec5158e4466590e1c', bytes: 2307 },
  { path: 'roles/methods/growth.md', sha256: 'da4589a14a502904fa66afc32e8ee74c60bb6bd9d36d243908c881ed385d0dbc', bytes: 1572 },
  { path: 'roles/methods/legal-review.md', sha256: 'd5f60099a8919a1f4f1a5ea9108dc950c7c8658621258f2f3b82248ee3dac411', bytes: 1785 },
  { path: 'roles/methods/media-creator.md', sha256: '936e06118d7bb9995089067a13a0bec9ee5ef564a8bf32431d4706188bdddd3b', bytes: 7368 },
  { path: 'roles/methods/product-manager.md', sha256: 'be6485158117fed537f8ec6468cdc314f80459441bbfdfc649dcd3f4df005313', bytes: 1771 },
  { path: 'roles/methods/qa.md', sha256: '9137242243951040b143a1d49743935839981018f0a671e720c5799890283e5b', bytes: 573 },
  { path: 'roles/methods/quality-gates.md', sha256: '176686a93231de43c1a47833ee23057ba9e7bbfff8f64e94f93216e77a564fc9', bytes: 4613 },
  { path: 'roles/methods/quant-finance.md', sha256: '8cfbfae01e02d0d0bb8eb12c21c93176261a5da0a3c9fce4d084309055037a88', bytes: 1857 },
  { path: 'roles/methods/security.md', sha256: 'c12f6947057de131b009ca4ac6de61c639dd140807c4d5b7f1b983c764156396', bytes: 591 },
  { path: 'roles/methods/social-media.md', sha256: '472f25ccd78fee649b96c1c51f2f56ef7417134bb23fe86f0f33fe7a65c51a0b', bytes: 1930 },
  { path: 'roles/methods/uiux-design.md', sha256: 'aa48f1a5f166b001e5f9d4352d03d44f2f82a8081c1dfd6fe6e126917a4b95c5', bytes: 2127 },
  { path: 'templates/CONTEXT.md', sha256: '5da6aaee1090c479a8cdad74d4a70c08a3653bca4107889a2d7889c53110039e', bytes: 14263 },
  { path: 'templates/DECISIONS.md', sha256: '35cbf204ad4131e0222f2fd4e711391ceff843d09f155da8af1f772b7d418c33', bytes: 3558 },
  { path: 'templates/GATES.md', sha256: '82a42c346cffc0b5007be9dc72dd7dcf5c2825f11cbe800c6756a3fa259fec49', bytes: 7025 },
  { path: 'templates/REPORT.md', sha256: '0375d39ec33b0d736ce4f2227316414a55348cf5a89e441529c26a8a253faf0f', bytes: 6849 },
  { path: 'templates/ROLES.md', sha256: 'e4ac160b5e521a4396edbdb5e39663d34b1c7d1e74da96a4baec24deca6ad326', bytes: 14476 },
  { path: 'templates/TASK.md', sha256: '49d120d5edfab0e16fbf117a275e0475bba59851a78a70a2617e31144623393b', bytes: 15447 },
  { path: 'templates/USER-DECISIONS.md', sha256: '4714d0d400459eb6cc4fe1d79f2701e2f0cc1aa999e5c6373626d75171625931', bytes: 3887 },
]

/** 生成时刻（⚠ 只作追溯，⛔ 不作判据 —— 判据是 sha256）。 */
export const SKELETON_GENERATED_AT = '2026-10-20T10:29:46.000Z'

export interface SkeletonManifest {
  allowlist: readonly string[]
  entries: readonly SkeletonEntry[]
}

/** ⚠ 单一出口（⚠ `runtimes` 只读它，⛔ 不各自拼一份）。 */
export const SKELETON_MANIFEST: SkeletonManifest = {
  allowlist: SKELETON_ALLOWLIST,
  entries: SKELETON_ENTRIES,
}
