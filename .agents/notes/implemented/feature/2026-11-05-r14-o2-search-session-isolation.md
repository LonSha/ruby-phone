# Agent Note: R14-O2 搜索取消与会话切换后的旧结果（索引是快照，不是增量日志）

Status: implemented

## Problem

计划的验收旅程有四条：**慢查询 A 后发 B，A 晚到不得覆盖 B**；**取消后不回填**；
**切会话无旧片段**；**原搜索排序不被模糊层替换**。

前两条与第四条在 v3.17.0 与 v3.55 / v4.110 已经做成并各有判据（`system-v3170` B5/B7、
`system-v3760`、`r13-x2` 系列）。真正没人管的是第三条 —— **切会话无旧片段**。
侦察（写探针实跑，不读注释）在搜索链路上找到三处：

### ① Spotlight 内核的索引是「只增不删」的

`config/spotlight-universal-search.js` 的 `indexEntities(domain, entities)` 语义是
**追加**：`items.set(fullId, ...)` 与 `index.get(token).add(fullId)`。同名 key 会被覆盖，
但**这一轮没再出现的 id 会原地留着**。

探针实测（真代码，非推断）：

```
s.indexEntities('WECHAT', [{id:'c1', content:'秘密片段'}]);
s.search('秘密片段')                       // → 1 条
s.indexEntities('WECHAT', [{id:'c2', content:'别的片段'}]);
s.search('秘密片段')                       // → 仍是 1 条，命中 c1
```

换会话时 `_spotlightSources()` 按新会话的 `wechat_data` 重新取数，**自然取不到 c1** ——
于是没有任何一次写入会碰它，它就一直留在倒排表里。同一根因的第二个面孔：
用户删掉一条日记后，它在搜索里**永远搜得到**。

### ② `onChatChanged()` 漏清视图那一格扫描记账

`onChatChanged()` 清了 `_restored / _keyword / _scope / _result / _vague*`，
**但没有 `_scanning`**。`renderResults(gen, r, kw)` 有两道关：

```js
const s = this._scanning;
if (!s || s.gen !== gen) return;                    // 第一道：视图账的代际
if (this._keyword.trim() !== String(kw || '')) return; // 第二道：关键词
```

换会话后 App 的 `_scanGen++` 是对的，A 会话那轮回来时 `isCancelled` 会真的转真 ——
但视图 `_scanning` 还停在 `{gen: g}`，第①道关两边都是 g **通过**；
用户在新会话里恰好又搜了同样的词，第②道关也**通过** ⇒ A 会话的命中被写进 B 会话的面板。

### ③ 单例在换会话时完全不重置

`_spotlightEngine` 是惰性单例。上面 ① 的「按域替换」能治四域清单内的残留，
但治不了「四域之外的域」（`_spotlightSources()` 只灌 CONTACTS / WECHAT / DIARY /
SETTINGS，别的域名它一辈子不碰），也治不了 `searchHistory`（它是**上一段会话**的
用户输入痕迹，按域替换完全不管它）。

## Decision

### 一、内核：把「按域整份替换」做进入口，而不是要求调用点记得先清

新增 `clearDomain(domain)`、`reset()`，并让 `indexEntities` **第一件事就 `clearDomain`**。

- 构造时新增 `_domainIds`（domain → Set(fullId)）：倒排表的反向账。没有它，删一个域
  只能全表扫 token 的 Set（`index` 是 token → Set，反查代价与词表同阶）。
- `clearDomain` 同时清 `items` 与 `index` 里的对应 id；**token 摘空就连键一起删** ——
  留着空 Set 会让「这个词在不在索引里」永远答「在」，白占内存且 `index.size`
  这个读数再也量不出真实规模。
- 空域也照落一格空 Set：`clearDomain` 的返回值与「这域从没灌过」处置一样（都是
  0 条可清），但对账时这两件事必须分得开。
- `indexEntities` 的注释写明它「是『这一域现在长这样』，不是『再补几条』」：
  调用点每次拿的都是 `_spotlightSources()` 的全量，本就期待替换。

### 二、换会话出口补齐三件

`onChatChanged()` 在原有清理之外新增：

1. `this.view._scanning = null` —— 关掉 §② 那个窗口。注释记下完整四步剧情
   （哪道关通过、为什么第二道关也放行），因为这段推理不看注释是复原不出来的。
2. `this._spotlightEngine.reset()` —— 治 §③ 的两件（四域之外的域 + 搜索历史）。
3. 原有的 `invalidateAll()` 与 `_syncHostSources()` 一字不动。

三道关的**分工**写进判据（D3），因为最容易犯的错是「以为一道关能顶三件事」：

| 关 | 治什么 | 治不了什么 |
|---|---|---|
| `invalidateAll()` / `cancelToken(gen)` 代际 | 已在跑的这一轮把结果写回 | 已经写进索引的旧条目 |
| `indexEntities` 的按域替换 | 四域清单内的残留、删条目 | 四域之外的域、搜索历史 |
| 单例 `reset()` | 四域之外的域、搜索历史 | 代际语义（它只是把索引清空） |

## 判据设计里踩到的三个坑（都记在套件注释里）

1. **探针词不能用共享 bigram 的中文短词。** 内核 `_tokenize` 把中文切成单字 + 双字，
   「秘密片段」与「别的片段」共享「片段」这个双字 token —— 旧条目即使已被正确清掉，
   新条目也会命中，判据成了假红。改用英文标记串（`[a-z0-9_]+` 只产生一个整词 token）。
2. **「某域这一轮取数抛错」不是 reset 的剧情。** `_spotlightSources()` 每次都返回四域
   （取不到数据的域返回 `rows: []`），于是 `indexEntities` 每轮都会被调用 ——
   空数组也算一次调用，也会触发按域替换。初稿拿这条当 reset 的独有价值，
   破坏 reset 之后判据照旧为绿（实测 0 !== 1），是一条**没有牙**的判据。
   改写为「四域清单之外的域 + 搜索历史」，破坏后立刻变红。
3. **别在断言表达式里顺手 `search()`。** 它自己会 `_recordHistory`，
   于是「历史没清」与「历史被我这句判据自己写了」在读数上长得一样。
   改成「读一次、存下来」。

## Verification

- `tests/r14_o2_search_session_isolation.test.mjs` **18/18**：
  A 内核索引账 4（按域替换 / 跨域不牵连 / 无空桶 / reset 整份清）+ B 视图记账 1 +
  C Spotlight 残留 2 + D 接线 3 + **E 负控制 4**（拿掉按域替换 / 拿掉域账落盘 /
  拿掉 reset / 拿掉 `_scanning` 清理，四条都必须真变红）+ F 纪律与自证 4。
  E 组用的是**递归解析 import 闭包**后复制副本树，不再手写文件清单 ——
  手写清单每次新增 config 依赖都要补一遍，而「漏补 ⇒ 副本 ERR_MODULE_NOT_FOUND ⇒
  负控制因缺文件而红」这个坑本仓已经在 v4.05 / v4.20 / v4.99.7 踩过三次。
- 受影响的既有套件全绿：`system-v3170`(30)、`system-v3760`(25)、`system-v4995`(20)、
  `system-v281`(9)、`system-v255`(13)、`tenth-cycle-frontier-mechanisms`(6)、
  `system-v4350`(25)，以及引用同一份日记夹具的 10 套（v216 / v2161-e2e / v263 /
  v321 / v3212 / v3600 / v3760 / v4995 / timeweaver-collector / timeweaver-v215）。
- 11 项门禁 OK：syntax / import-resolve / named-import / dead-exports / keys /
  weak-coercion / registry / lifecycle / bind-consuming / method-consuming /
  source-derivation。
- 按约定，全量 `npm test` 留到双项目第十四期全部收口后统一跑；本项只做定向验证。

### 顺手修掉的两条**存量红**（都不是本项引入，但都在搜索链路里）

| 套件 | 表现 | 根因 |
|---|---|---|
| `system-v281` C3 | `followed:false`、`bodies:""` | 日记夹具没带 `id` |
| `system-v3170` C1 | `quickHits: 0 !== 1` | 同上 |

两处根因相同：v4.119.0（R14-O3「聚合页点回原条目」）给日记源加了
「**没 id 就是死链，直接不收**」的前置检查；夹具的日记条目没有 id，
于是条目**根本不进搜索面**，判据就变成「在没有命中的空集上判断重开是否吃旧快照」。
两条红都是**夹具没跟上真实契约**，不是契约破了。已在两个 `mkStorage` 的注里
写清来由，并注明「这是夹具跟上真实契约，不是放宽判据」——
这两类修法在 diff 上长得一样，只能靠注释分开。

## 已知边界（诚实）

1. **本项不动「原搜索排序不被模糊层替换」的代码**：模糊回忆是**追加一栏**
   （`_vagueHtml()` 折在结果之上），不参与主列表排序；该旅程由 `r13-x2` 系列判据守。
   本套件只在 F3 里做在场自证，不重写第二份判据（同一口径只许一份实现）。
2. **浏览器侧读数未跑**：计划提到的「48 条登记失败」来自 `browser_readings`，
   那份读数里产品缺陷与夹具/驱动缺陷还没有分账。本轮只做源码侧可复现缺陷，
   浏览器场景（`tests/browser/scenarios/o1-search-cancel.scen.js`）不动。
3. **Grep 得到的旋钮不是判据**：D1/D2/D3 三条接线判据读的是源码文本，
   它们只能防「接线被删」，不能证明行为 —— 行为由 A/B/C/E 组负责。
   这是本仓一贯的分层：文本判据守接线，行为判据守语义，负控制守判据本身有牙。
4. **四域清单若将来变化**，`_domainIds` 的账会自动跟上（按实际灌入的域名记），
   但「清单里删掉一域后它的旧条目」需要一次 `reset()` 或显式 `clearDomain` ——
   本项保证换会话这条路径已经覆盖，其它路径（比如运行时改清单）不在本项范围。
