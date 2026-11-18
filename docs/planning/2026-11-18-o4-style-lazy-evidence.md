# R25-O4 启动真收益 · 证据页

日期：2026-11-18　版本：v4.157.0（未抬版）

## 1. 开工前的真实处境（实读，不是转述）

- `config/boot-timing.js`（258 行）头注释自认：**「78 处动态加载零时计」「本版一条加载路径都不改」**
  —— 读数层有，优化一件没做；
- `phone.css` **22644 行 / 720288 字节**整包进首屏：89 个 App 里 76 个的样式全在里面，
  而你此刻可能只是在看桌面；
- 样式投递两套机制并存已很久：机制 A 打进 phone.css（76 个）／机制 B 由 App 自己注入 `<link>`
  （album / diary / weibo / honey 四个）—— 但**从来没有人回答过「谁占了多少首屏字节」**；
- **更要紧的一条**：R24-O3 曾交付过 `config/style-loader.js`（173 行）自称「样式懒加载」，
  实读它做的是：`planStyleShards()` 按**权重编**字节（默认 totalBytes=717587，与真值720288 不符）、
  `load()` 只往一个 `Set` 里塞 `id + '.css'` 字符串、**从不插 DOM、从不取文件**。
  这是本仓最贵的那种形态：模块在盘、测试全绿、能力为零。本轮把它退役了。

## 2. 这一轮做了什么

1. **真搬**：`tools/split_phone_css_lazy.mjs` 把 9 个 App 的**独占规则**从 phone.css 摘出来
   （`cotdesk / doujin / pvdesk / musicdesk / needsim / kettle / sourcebook / soundkit / affairs`），
   它们各自的 `apps/<id>/<id>.css` 当唯一真源。工具当场验两条硬条件，任一不成立就 exit 3 一个字都不改：
   - 每条搬走的规则必须在自己的 css 里逐条存在（忽略空白/注释）——否则就是凭空丢规则；
   - 每条搬走的规则，其选择器里的类前缀**全部属于本 App**（共享前缀 `.is-*` 一律留下）——
     否则就是拿别的 App 的样式当代价；
   - 搬运字节必须与账本逐条相等（账本是人的声明，工具只校验，不自己填）。
2. **真加载**：`config/style-lazy.js`（258 行）——账（9 条：appId / css / 前缀 / 字节 / why）
   + 纯函数（`stylePlan` / `styleReceipt` / `styleVerdict` / `styleLazyBudget`）
   + 执行器 `createStyleLoader({doc, baseUrl, now, timeoutMs, setTimeout})`（**doc 注入**，
   所以 node 里能用假 doc 把 load/error/timeout/去重四条边界真造出来）。
3. **真接线**：`index.js` 的 `phone:openApp` 咽喉里，样式与模块**并行取、都到齐才 render**：
   ```js
   Promise.all([bootTiming.instrumentImport(import(lazyRoute.module), lazyRoute.module),
                appStyleLoader.ensure(appId)])
   ```
   并行是因为「样式慢不该等 JS，JS 慢也不该等样式」；到齐才画是因为「先画再上样式＝用户先看一次
   裸奔再跳一下」，比慢更难受。样式没来也照开（`degraded`），回执写 reason，读数上屏。
4. **退役纸面实现**：删 `config/style-loader.js` 与其 47 行测试；自检改挂 `['_r25O4', styleLazySelfCheck]`。

## 3. 真读数（浏览器，390×844，Chromium 131）

`tests/browser/scenarios/o4-style-lazy.scen.js`，10/10 全绿：

| 读数 | 值 |
|---|---|
| `o4-first-paint-no-app-css` | 首屏 `link[id^=app-style-]` 数量 **0** |
| `o4-probe-not-applied-at-boot` | 探针 `--nsm-bg=""`、`--snd-bg=""`（样式确实不在首屏） |
| `o4-open-feeds-style` | 开 needsim → link 真载入并解析，探针 `#eef1f6` |
| `o4-untouched-still-out` | 开 needsim 时 soundkit 仍 `""`（未触达不入首屏不是只对一个 App 成立） |
| `o4-second-app-also-fed` | 再开 soundkit → link 真载入，`#10161d` |
| `o4-receipts` | loaded=2 degraded=0 unknown=0 bytesOut=96641B 条数=9 |
| `o4-dataset-readout` | `dataset.appStyleLoaded=2 appStyleDegraded=0 appStyleBytesOut=96641` |

探针用的是 **CSS 变量**（`.nsm-root { --nsm-bg: #eef1f6 }`）：只有样式真到位才读得出，读不出就是空串。
比「节点在不在」硬 —— 节点在而样式没来，正是要抓的形态。

## 4. 前后对比（同一段操作序列，两版本各跑一遍）

`node tools/ab-desk.mjs --a=/tmp/rphead --b=. --scenes=o4-style-lazy.scen.js`（R25-X8 的台）
→ `tests/audit/ab-reports/r25-o4-style-vs-o3.md`：10 条读数 same 2 / diff 8。

| 指标 | A（R25-O3 收口，205512e） | B（本轮） | 差 |
|---|---|---|---|
| phone.css 首屏载入文本长度 | 684111 字符 | **595899 字符** | −88212（−12.9%） |
| phone.css 源文件字节 | 720288 B | **623617 B** | −96671 B（−13.4%） |
| 首屏探针 `--nsm-bg` / `--snd-bg` | `#eef1f6` / `#10161d`（在首屏） | `""` / `""`（不在首屏） | 机制变了 |
| 打开后样式 | 靠首屏那包（`link` 不存在） | link 真载入并解析 | 机制变了 |
| 冷启动到可交互（墙钟，参考值） | 12280 ms | 12257 ms | −23 ms（**噪声级，没变**） |

### 4.1 必须自己先说清的一条（本轮抓到一次假结论）

第一版场景把墙钟量在**所有「等 link」断言之后**，于是 A 侧因为永远等不到 link 白等了 30s，
读出来 A=42329ms / B=12384ms，看着像「快了 3.4 倍」。那是**场景自己的等待**被算进了启动时间，
不是产品变快。已改成在任何等待之前量，重跑后是 12280 vs 12257 —— **墙钟没变**。

结论（不许含糊）：这一轮省下的是**首屏 CSS 的字节与解析量**（−96671B / −13.4%，9 个 App 的独有
样式不进首屏），**不是**墙钟。要在本 harness 里把字节变成墙钟，得再动「关键片内联 / 预连接 /
首屏阻塞顺序」，那属于下一步，本轮不做 —— 也正因为没做，所以不许把这轮写成「启动变快了」。

## 5. 判据

`tests/r25_o4_style_lazy.test.mjs`（10 项全绿）：

- O4-1 内核自检 5 条 + 账本形状（每条 css 真存在、bytes>0、why 写清）；
- O4-2 **迁移工具复算幂等**（真搬走了；且 phone.css 里各前缀残留 < 自己 css 的 30%）；
- O4-3 真注入（link id/rel/href 逐一验）；O4-4 并发去重只插一个 link；
- O4-5 三态不压平（error⇒degraded / 超时⇒unknown / 无 host⇒unknown，都不是 loaded）；
- O4-6 未登记 App ⇒ `bundled`（不是 lazy 的空壳，且不插节点）；
- O4-7 **负控制**：把「没来」写成 `ok:true` ⇒ O4-5 同款断言必红；
- O4-8 接线证据（并行取 + 回执上屏 + 模块懒加载没被丢）；
- O4-9 真字节（phone.css 变小，且少的量＝账本九条之和；账本不许写虚数）；
- O4-10 旧纸面装载器已退役（文件不在、旧自检不挂、新自检真挂进装配点）。

## 6. 边界（这轮没做什么）

- **只搬了 9 个 App**：判据要求「块与自有 css 逐条等价 + 前缀全属自己」，不满足的（如 `ud-` / `dd-` /
  `arc-` 与别的 App 共享前缀）一律没动 —— 宁可不动，不许错着动；剩下 70 个仍整包在 phone.css；
- **墙钟没变**（见 4.1），别把它读成性能胜利；
- 机制 B 与机制 A 仍并存：本轮新增的 9 个走的是「宿主统一执行器」这条路（不是每个 App 各写一份
  `_preloadCSS`），registry 报「phone.css 打包 70 · JS 自注入 10 · 未覆盖 0」；
- `degraded` 时界面可能裸奔（样式没来），这是刻意选择：**样式不许挂住整机**，回执留痕供诊断。
