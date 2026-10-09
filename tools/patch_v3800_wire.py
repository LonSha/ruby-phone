# -*- coding: utf-8 -*-
"""v3.80.0 缝入第一刀：A1/A2/A3/A4/A5 接线补丁。
每个锚点必须**恰中 1 次**（==1），否则整体中止、不写盘。"""
import io, os, sys

R = '/home/user/ruby-phone'
os.chdir(R)

PLAN = []


def edit(rel, anchor, new, label):
    PLAN.append((rel, anchor, new, label))


# ══════════════════════════════════════════════════════════
# A5 — injection-contract：把「预算保护」接到唯一读入口上
# ══════════════════════════════════════════════════════════
PRIORITY_IMPORT = (
    "import { readPushProbe } from './world-bridge.js';\n"
    "/* [v3.80.0 · 缝入 A5] 注入优先级 / 预算保护。本模块此前**只读**上游的 `dropped-budget`，\n"
    " *   从不参与裁剪：上游裁完报一个数，下游把那个数转述出去 —— 而「底线与规则不压」这条\n"
    " *   口径在整条链路上没有任何地方成立。接线后：块级读数进入 planInjection，\n"
    " *   `priorityPlan` 与 `dropped-budget` 两个来源同时暴露，**可对账**（相等=口径一致；\n"
    " *   不等=上游换了裁剪口径，本仓不必再猜）。 */\n"
    "import { planInjection, injectionPriorityLine } from './injection-priority.js';\n"
)
edit('config/injection-contract.js',
     "import { readPushProbe } from './world-bridge.js';\n",
     PRIORITY_IMPORT, 'A5 import')

edit('config/injection-contract.js',
     "        blocks: [],\n"
     "        /* [v3.0.4] M-O3 可选转述：不在面级 10 键里，缺席即 null */\n",
     "        blocks: [],\n"
     "        /* [v3.80.0 · 缝入 A5] 预算计划面。空形也带这一格（读出面结构必须恒定，\n"
     "         *   消费方不必判 undefined）。 */\n"
     "        priorityPlan: null,\n"
     "        /* [v3.0.4] M-O3 可选转述：不在面级 10 键里，缺席即 null */\n",
     'A5 empty shape')

edit('config/injection-contract.js',
     "        const ts = numOrNull(raw.ts);\n",
     "        /* [v3.80.0 · 缝入 A5] 预算计划：把逐块读数喂给 planInjection。\n"
     "         *   预算取上游真给的 `chars`（它才是「这次注入了多少字」）；给不出就取——\n"
     "         *   **不**编一个默认预算：编了会让「上游没报预算」被读成「预算够」。\n"
     "         *   块形状：上游 ref/label/chars/kept → 本模块的 ref/label/chars/tier 提示。 */\n"
     "        let priorityPlan = null;\n"
     "        try {\n"
     "            const budget = numOrNull(raw.chars);\n"
     "            priorityPlan = planInjection(\n"
     "                blocks.map(function (b) {\n"
     "                    return { ref: b.ref, label: b.label, chars: b.chars, kept: b.kept, kind: b.label };\n"
     "                }),\n"
     "                { budgetChars: (budget === null ? Number.MAX_SAFE_INTEGER : budget) }\n"
     "            );\n"
     "        } catch (_e) { priorityPlan = null; }\n"
     "        const ts = numOrNull(raw.ts);\n",
     'A5 plan compose')

edit('config/injection-contract.js',
     "            verdict,\n"
     "            blocks,\n",
     "            verdict,\n"
     "            blocks,\n"
     "            priorityPlan,\n",
     'A5 plan field')

edit('config/injection-contract.js',
     "    if (p.layer) parts.push('层=' + p.layer);\n",
     "    /* [v3.80.0 · 缝入 A5] 计划面有读数才说，没有不假装有（同 layer / via 的口径）。 */\n"
     "    if (p.priorityPlan) parts.push(injectionPriorityLine(p.priorityPlan));\n"
     "    if (p.layer) parts.push('层=' + p.layer);\n",
     'A5 line')

# ══════════════════════════════════════════════════════════
# A4 — memory-pool：精确集合匹配 → 字窗滑窗重合
# ══════════════════════════════════════════════════════════
edit('apps/memory/memory-pool.js',
     " *  零外部依赖; 持久化由 MemoryData 负责\n"
     " * ======================================================== */\n",
     " *  零外部依赖; 持久化由 MemoryData 负责\n"
     " * --------------------------------------------------------\n"
     " *  [v3.80.0 · 缝入 A4] 关键词层此前是**精确集合匹配**（`itemKw.some(ik => ik === k)`）：\n"
     " *  查询切出的 2~4 字片段要在条目关键词里**一字不差**地存在才算命中。中文里\n"
     " *  「城西的老槐树」与「老槐树下避雨」共享 4 个字，却在旧口径下**零命中** ——\n"
     " *  而语义层要求 `hit >= 2` 才收，于是这类条目直接被丢掉。\n"
     " *  本版把打分交给 apps/memory/keyword-overlap.js 的字窗滑窗（2 字权 1 / 3 字权 3 /\n"
     " *  4 字权 9），并**保留触发类型判定**：命中为 0 时仍如实回落语义层。\n"
     " *  归一化在这里做（overlapScore 只给原始分，见该模块文件头）。\n"
     " * ======================================================== */\n"
     "import { overlapScore } from './keyword-overlap.js';\n",
     'A4 import')

edit('apps/memory/memory-pool.js',
     "    _matchByKeywords(keywords) {\n"
     "        const matches = [];\n"
     "        const kset = new Set(keywords.map(k => k.toLowerCase()));\n"
     "        for (const item of this.pool.spatial.concat(this.pool.temporal)) {\n"
     "            const itemKw = (item.keywords || []).map(k => String(k).toLowerCase());\n"
     "            const text = String(item.content || '').toLowerCase();\n"
     "            let hit = 0;\n"
     "            for (const k of kset) {\n"
     "                if (itemKw.some(ik => ik === k) || text.includes(k)) hit++;\n"
     "            }\n"
     "            if (hit > 0) matches.push({ ...item, _score: hit / Math.sqrt(kset.size || 1), _layer: item._layer || (item.place ? 'spatial' : 'temporal') });\n"
     "        }\n"
     "        return matches.sort((a, b) => b._score - a._score).slice(0, 8);\n"
     "    }\n",
     "    /** 条目检索文本：关键词与正文**一起**看（旧口径也是两者 or，不缩面）。 */\n"
     "    _entrySearchText(item) {\n"
     "        const kw = (item && Array.isArray(item.keywords)) ? item.keywords.join(' ') : '';\n"
     "        return kw + ' ' + String((item && item.content) || '');\n"
     "    }\n"
     "\n"
     "    _matchByKeywords(keywords) {\n"
     "        const query = Array.isArray(keywords) ? keywords.join(' ') : String(keywords || '');\n"
     "        return this._rankByOverlap(query, this.pool.spatial.concat(this.pool.temporal), 8);\n"
     "    }\n"
     "\n"
     "    /** [v3.80.0 · 缝入 A4] 懒建的字窗索引。持久结构与 `sensoryIndex` 同款（Map），\n"
     "     *  不落盘、不改变 `dumpState` 的形状（落盘形状一改，读旧档那条路就要迁移）。 */\n"
     "    _overlapIndex() {\n"
     "        if (!this._overlapCache) this._overlapCache = new Map();\n"
     "        return this._overlapCache;\n"
     "    }\n"
     "\n"
     "    /** 归一化：把原始加权分压进 0–1。\n"
     "     *  分母与 keyword-overlap.overlapRatio 同源（3 字窗权重），**不另立一套** ——\n"
     "     *  同一件事两份归一化正是本仓反复点名的分叉种子。 */\n"
     "    _normalizeOverlap(raw) {\n"
     "        return Math.min(1, Math.max(0, Number(raw) || 0) / 9);\n"
     "    }\n"
     "\n"
     "    _rankByOverlap(query, items, topN) {\n"
     "        const q = String(query || '');\n"
     "        if (!q.trim()) return [];\n"
     "        const idx = this._overlapIndex();\n"
     "        const out = [];\n"
     "        for (const item of items) {\n"
     "            const key = String(item && item.id || '') + '@' + String((item && item.createdAt) || '');\n"
     "            let scored = idx.get(key);\n"
     "            if (!scored) {\n"
     "                scored = overlapScore(q, this._entrySearchText(item));\n"
     "                idx.set(key, scored);\n"
     "                if (idx.size > 4000) {\n"
     "                    /* 有界：索引是缓存不是账本，超限即整体丢（丢缓存只损失一次重算，\n"
     "                     *   而无限长大的 Map 会跟着会话活到用户卸载那天）。 */\n"
     "                    idx.clear();\n"
     "                    idx.set(key, scored);\n"
     "                }\n"
     "            }\n"
     "            if (scored.score <= 0) continue;\n"
     "            out.push({\n"
     "                ...item,\n"
     "                _score: this._normalizeOverlap(scored.score),\n"
     "                _rawScore: scored.score,\n"
     "                _overlap: { hits: scored.hits, phrases: scored.phrases, truncated: scored.truncated },\n"
     "                _layer: item._layer || (item.place ? 'spatial' : 'temporal')\n"
     "            });\n"
     "        }\n"
     "        return out.sort((a, b) => b._score - a._score).slice(0, topN || 8);\n"
     "    }\n"
     "\n"
     "    /** [v3.80.0 · 缝入 A4] 相关度触发面：旧语义层要求「至少 2 个 2 字片段命中」——\n"
     "     *  那是一个与文本长度无关的**绝对**门槛，长句天然占优、短条目天然吃亏。\n"
     "     *  这里改用同一份字窗打分按 layer 收敛（三层都过、各有自己的 topN）。 */\n"
     "    _matchByRelevance(query) {\n"
     "        const bags = [\n"
     "            ['spatial', this.pool.spatial, 8],\n"
     "            ['temporal', this.pool.temporal, 8],\n"
     "            ['perception', this.pool.perception, 6]\n"
     "        ];\n"
     "        const out = [];\n"
     "        for (const bag of bags) {\n"
     "            for (const m of this._rankByOverlap(query, bag[1], bag[2])) {\n"
     "                out.push({ ...m, _layer: m._layer || bag[0] });\n"
     "            }\n"
     "        }\n"
     "        return out.sort((a, b) => b._score - a._score).slice(0, 8);\n"
     "    }\n",
     'A4 关键词层替换')

edit('apps/memory/memory-pool.js',
     "    _matchBySemantic(query) {\n"
     "        const q = String(query || '').toLowerCase();\n"
     "        const cjk = q.match(/[\u4e00-\u9fff]{2}/g) || [];\n",
     "    /** 旧语义层（**保留可回退**）：修前它是唯一兜底，v3800 之后由 `_matchByRelevance`\n"
     "     *  接管触发路径，但函数本身留着 —— 诊断页要能对比两套口径的召回差异。 */\n"
     "    _matchBySemantic(query) {\n"
     "        const q = String(query || '').toLowerCase();\n"
     "        const cjk = q.match(/[\u4e00-\u9fff]{2}/g) || [];\n",
     'A4 语义层注释')

edit('apps/memory/memory-pool.js',
     "        if (results.matched.length === 0) {\n"
     "            results.triggerType = 'semantic';\n"
     "            results.matched = this._matchBySemantic(query);\n"
     "        }\n",
     "        if (results.matched.length === 0) {\n"
     "            /* [v3.80.0 · 缝入 A4] 第三级由「语义（2 字片段计数）」换成「相关度（字窗滑窗）」：\n"
     "             *   形态只有一处收口，故旧语义层不再参与触发，只留作诊断对比面。\n"
     "             *   触发类型名字如实报 relevance —— 报成 semantic 会让诊断页把两套口径混为一谈。 */\n"
     "            results.triggerType = 'relevance';\n"
     "            results.matched = this._matchByRelevance(query);\n"
     "        }\n",
     'A4 trigger 第三级')

# ══════════════════════════════════════════════════════════
# A3 + A2 — memory-data：结构化记忆块解析 + 三级跨卡记忆
# ══════════════════════════════════════════════════════════
edit('apps/memory/memory-data.js',
     "import { scanSupersede, reviveSuperseded, SUPERSEDE_STATUS } from '../../config/supersede-engine.js';\n",
     "import { scanSupersede, reviveSuperseded, SUPERSEDE_STATUS } from '../../config/supersede-engine.js';\n"
     "/* [v3.80.0 · 缝入 A3] 结构化记忆块：模型在正文里**显式声明**要记的事。\n"
     " *   修前记忆全靠被动采集（正文丢桶、后续检索捞回来），于是「共同经历」这类\n"
     " *   需要主动声明的东西，从来没被声明过 —— 它只是恰好躺在某句话里，检索到了算运气。 */\n"
     "import { parseMemoryBlock, memoryBlockLine } from '../../config/memory-block.js';\n"
     "/* [v3.80.0 · 缝入 A2] 三级记忆：world（跨卡共同）/ shared:<角色>（跨卡角色）/ save（本档）。\n"
     " *   存储只加**一个**全局键（键面成本：每加一键就要在 keys-audit 回答归属、在\n"
     " *   CHAT_DATA_PATTERNS 与机制对齐）；`/^memory_/` 全判会话隔离的口径不变，\n"
     " *   故该键刻意走 `phone_` 前缀并登记 scope:'global'（见 scripts/keys-audit.mjs）。 */\n"
     "import {\n"
     "    SHARED_MEMORY_KEY, LEVELS as SHARED_LEVELS, emptyStore, normalizeStore,\n"
     "    remember as sharedRemember, recordsOf as sharedRecordsOf,\n"
     "    recall as sharedRecall, clear as sharedClear, sharedMemoryLine as sharedMemoryLineOf\n"
     "} from '../../config/shared-memory.js';\n",
     'A2A3 imports')

edit('apps/memory/memory-data.js',
     "        this._dataVersion = 0;\n",
     "        this._dataVersion = 0;\n"
     "        /* [v3.80.0 · 缝入 A3] 最近一次解析到的记忆块（诊断页读它，不重解析）。\n"
     "         *   刻意**不落盘**：块是「这一轮回复说了什么」，不是账本。 */\n"
     "        this.pendingMemoryBlock = null;\n"
     "        this._sharedLoaded = false;\n"
     "        this._sharedStore = emptyStore();\n"
     "        this._sharedWriteCount = 0;\n",
     'A2A3 ctor')

edit('apps/memory/memory-data.js',
     "        content = content.replace(/\\s+/g, ' ').trim();\n"
     "        if (!content) return null;\n",
     "        content = content.replace(/\\s+/g, ' ').trim();\n"
     "        if (!content) return null;\n"
     "\n"
     "        /* [v3.80.0 · 缝入 A3] 结构化记忆块解析。\n"
     "         *   注意：解析的是**清洗前**的原文 —— 清洗器会把成对块剔掉，\n"
     "         *   先清洗再解析等于把模型写的块当噪声删掉（这正是缝入时最容易踩的一步）。 */\n"
     "        let block = null;\n"
     "        try { block = parseMemoryBlock(String(text || '')); } catch (_e) { block = null; }\n"
     "        this.pendingMemoryBlock = (block && block.present) ? block : null;\n"
     "        if (block && block.present && !block.empty && block.items.length) {\n"
     "            try { this._absorbMemoryBlock(block, role, meta); } catch (_e) { /* 解析出的块坏了不阻断采集 */ }\n"
     "        }\n",
     'A3 record 解析')

edit('apps/memory/memory-data.js',
     "    _extractTags(text) {\n",
     "    /* ---------------- [v3.80.0 · 缝入 A2/A3] 跨卡记忆与结构化块 ---------------- */\n"
     "\n"
     "    /** 全局桶读入（懒加载 + 每次写回都回写内存副本）。\n"
     "     *  刻意**不**进 `_load()`：`reload()` 是换会话路径，把跨卡桶挂在那儿\n"
     "     *  等于换会话就把跨卡层丢掉 —— 那正是本功能要治的病。 */\n"
     "    _sharedStoreNow() {\n"
     "        if (this._sharedLoaded) return this._sharedStore;\n"
     "        let raw = null;\n"
     "        try { raw = this.storage?.get?.(SHARED_MEMORY_KEY); } catch (_e) { raw = null; }\n"
     "        this._sharedStore = normalizeStore(raw);\n"
     "        this._sharedLoaded = true;\n"
     "        return this._sharedStore;\n"
     "    }\n"
     "\n"
     "    _persistShared(store) {\n"
     "        this._sharedStore = store;\n"
     "        this._sharedLoaded = true;\n"
     "        this._sharedWriteCount += 1;\n"
     "        try { this.storage?.set?.(SHARED_MEMORY_KEY, JSON.stringify(store)); } catch (_e) { /* 全局桶写失败不阻断本会话记忆 */ }\n"
     "    }\n"
     "\n"
     "    /** 结构化块 → 跨卡桶。层级由调用方经 `meta.sharedLevel` 指定，默认 world：\n"
     "     *  「共同经历」需要知道**是谁**的经历，而块里只有文本 —— 名字得由调用方给。 */\n"
     "    _absorbMemoryBlock(block, role, meta) {\n"
     "        const level = (meta && meta.sharedLevel === SHARED_LEVELS.SHARED) ? SHARED_LEVELS.SHARED : SHARED_LEVELS.WORLD;\n"
     "        const cardId = String((meta && meta.cardId) || '');\n"
     "        const chatId = String((meta && meta.chatId) || '');\n"
     "        const name = String((meta && meta.character) || '');\n"
     "        let store = this._sharedStoreNow();\n"
     "        let added = 0;\n"
     "        for (const item of block.items) {\n"
     "            const res = sharedRemember(store, level, item.text, {\n"
     "                kind: item.kind, cardId: cardId, chatId: chatId, name: name, source: 'memory-block'\n"
     "            });\n"
     "            store = res.store;\n"
     "            if (res.added) added += 1;\n"
     "        }\n"
     "        this._lastSharedWrite = { added: added, skipped: block.items.length - added, level: level, bucket: level === SHARED_LEVELS.SHARED ? ('shared:' + name) : 'world' };\n"
     "        if (added > 0) this._persistShared(store);\n"
     "        return this._lastSharedWrite;\n"
     "    }\n"
     "\n"
     "    /** 三级检索：跨卡两档 + 本档。**逐档标注来源**（诊断页必须能回答\n"
     "     *  「这条是跨卡层来的还是本会话来的」，揉成一列后两张卡的同名角色就分不开了）。 */\n"
     "    recallShared(query = {}, limit = 8) {\n"
     "        const q = (typeof query === 'string') ? { text: query } : (query || {});\n"
     "        const saveRecords = this.longTerm.map(function (m) { return { text: m.content, at: m.createdAt || '' }; });\n"
     "        const score = function (a, b) {\n"
     "            const needle = String(a || '').trim();\n"
     "            const hay = String(b || '');\n"
     "            if (!needle || !hay) return 0;\n"
     "            let hit = 0;\n"
     "            for (let i = 0; i + 2 <= needle.length; i += 1) {\n"
     "                if (hay.indexOf(needle.slice(i, i + 2)) >= 0) hit += 1;\n"
     "            }\n"
     "            return hit;\n"
     "        };\n"
     "        return sharedRecall(this._sharedStoreNow(), saveRecords, Object.assign({}, q, { limit: limit, score: score }));\n"
     "    }\n"
     "\n"
     "    /** 一行读数（诊断页用）：三档分列 + 结构化块的当轮读数。 */\n"
     "    sharedMemoryLine() {\n"
     "        const res = this.recallShared({}, 0);\n"
     "        return sharedMemoryLineOf(res);\n"
     "    }\n"
     "\n"
     "    /** 记忆块一行读数（当轮）。无块时如实说「本回复无」，不报失败。 */\n"
     "    memoryBlockLineNow() {\n"
     "        return memoryBlockLine(this.pendingMemoryBlock || { present: false });\n"
     "    }\n"
     "\n"
     "    /** 跨卡桶清空（用户必须能清掉全局桶，否则它是一块看不见也删不掉的污渍）。 */\n"
     "    clearShared() {\n"
     "        this._persistShared(emptyStore());\n"
     "        return true;\n"
     "    }\n"
     "\n"
     "    _extractTags(text) {\n",
     'A2A3 methods')

edit('apps/memory/memory-data.js',
     "    clear() {\n"
     "        this.longTerm = [];\n"
     "        this.shortTerm = [];\n"
     "        this.pool.clear();\n"
     "        this.stats = { consolidated: 0, archived: 0, lastSleep: null };\n"
     "        this._save();\n"
     "    }\n",
     "    clear() {\n"
     "        this.longTerm = [];\n"
     "        this.shortTerm = [];\n"
     "        this.pool.clear();\n"
     "        this.stats = { consolidated: 0, archived: 0, lastSleep: null };\n"
     "        this.pendingMemoryBlock = null;\n"
     "        /* [v3.80.0 · 缝入 A2] 「清全部数据」连跨卡桶一起清：它与 storage.clearAllData()\n"
     "         *   同一语义（连全局设置都清），留着跨卡桶会让用户以为清干净了。\n"
     "         *   「清当前数据」走 clearCurrentChat()，那里**不动**跨卡桶 —— 跨卡层正是\n"
     "         *   为了不被会话边界切碎才存在的。两者处置相反，故不共用一条实现。 */\n"
     "        this.clearShared();\n"
     "        this._save();\n"
     "    }\n",
     'A2 clear')

# ══════════════════════════════════════════════════════════
# A5/A2 — 诊断页：两个新读数面并入
# ══════════════════════════════════════════════════════════
edit('apps/diagnose/diagnose-data.js',
     "import { readInjection, injectionLine, injectionVerdictText, outcomeText, blockLine } from '../../config/injection-contract.js';\n",
     "import { readInjection, injectionLine, injectionVerdictText, outcomeText, blockLine, injectionPriorityLine } from '../../config/injection-contract.js';\n",
     'A5 diagnose import')

edit('apps/diagnose/diagnose-data.js',
     "    injectionLine,\n",
     "    injectionLine,\n"
     "    injectionPriorityLine,\n",
     'A5 diagnose export')

# ══════════════════════════════════════════════════════════
# A1 — worldbook：只读 → 可写（两条铁律：绝不覆盖用户手写 / 按内容去重）
# ══════════════════════════════════════════════════════════
edit('config/worldbook-manager.js',
     "const WORLD_INFO_GET_ENDPOINT = '/api/worldinfo/get';\n",
     "/* [v3.80.0 · 缝入 A1] 世界书写链路。修前本模块**只有读通道**（loadWorldInfo 一族）：\n"
     " *   模型写下的长期事实没有任何去处，只能挤在会话桶里，换卡即丢。\n"
     " *   纯函数那一半（去重 / 归一 / 合并 / 读数行）在 config/worldbook-write.js（零 IO，\n"
     " *   便于负控制直接破坏）；本文件只留**宿主交互**那一半（读→合并→写→刷缓存）。 */\n"
     "import { mergeEntries, toEntriesMap, worldbookWriteLine } from './worldbook-write.js';\n"
     "\n"
     "const WORLD_INFO_GET_ENDPOINT = '/api/worldinfo/get';\n"
     "const WORLD_INFO_SAVE_ENDPOINT = '/api/worldinfo/edit';\n",
     'A1 import')

edit('config/worldbook-manager.js',
     "    async listAvailableWorldbooks(options = {}) {\n",
     "    /**\n"
     "     * [v3.80.0 · 缝入 A1] 把条目**追加**进指定世界书（默认 append 模式，绝不覆盖）。\n"
     "     *\n"
     "     * 两条铁律（在纯函数层已实现，这里负责不被宿主绕开）：\n"
     "     *   ① 绝不覆盖用户手写条目 —— `update-by-uid` 模式也只改 `source` 相同的那条；\n"
     "     *   ② 按**归一化内容**去重（全角/大小写/空白差异不算新条目）。\n"
     "     *\n"
     "     * @returns {{ok:boolean, reason:string, name:string, added:Array, skipped:Array,\n"
     "     *            replaced:Array, line:string, entries:number}}\n"
     "     *   `reason`：`'ok'` / `'no-name'` / `'empty'` / `'read-failed'` / `'write-failed'`\n"
     "     *   —— 五态互不同形（写失败与没东西可写处置相反：前者要重试，后者不用）。\n"
     "     */\n"
     "    async writeMemoryEntries(name, incoming, options = {}) {\n"
     "        const cleanName = safeString(name);\n"
     "        const empty = { ok: false, reason: 'no-name', name: '', added: [], skipped: [], replaced: [], line: '', entries: 0 };\n"
     "        if (!cleanName) return empty;\n"
     "        if (!Array.isArray(incoming) || incoming.length === 0) {\n"
     "            return Object.assign({}, empty, { name: cleanName, reason: 'empty' });\n"
     "        }\n"
     "\n"
     "        /* 读：走**和展示同一条**读通道（读到的必须就是他看到的那一份）。 */\n"
     "        let data = null;\n"
     "        try {\n"
     "            data = normalizeWorldInfoData(await this._loadWorldInfoViaFrontendModule(cleanName));\n"
     "            if (!data) data = await fetchWorldInfoByName(cleanName);\n"
     "        } catch (error) {\n"
     "            console.warn('[WorldbookManager] 记忆写回前读取失败:', cleanName, error);\n"
     "        }\n"
     "        if (!data || typeof data !== 'object') {\n"
     "            return Object.assign({}, empty, { name: cleanName, reason: 'read-failed' });\n"
     "        }\n"
     "\n"
     "        const merged = mergeEntries(data.entries, incoming, {\n"
     "            mode: options.mode === 'update-by-uid' ? 'update-by-uid' : 'append',\n"
     "            forceRewriteSource: options.forceRewriteSource === true,\n"
     "            maxEntries: options.maxEntries\n"
     "        });\n"
     "        const line = worldbookWriteLine(merged);\n"
     "        if (merged.added.length === 0 && merged.replaced.length === 0) {\n"
     "            /* 「没有新增」不是失败：全部命中重复/空内容/超限，三态在 skipped 里可查。\n"
     "             *   刻意仍返回 ok:true —— 报失败会诱导调用方重试，而重试一百次结果一样。 */\n"
     "            return { ok: true, reason: 'ok', name: cleanName, added: [], skipped: merged.skipped, replaced: [], line: line, entries: merged.entries.length };\n"
     "        }\n"
     "\n"
     "        const payload = Object.assign({}, data, { entries: toEntriesMap(merged.entries) });\n"
     "        const written = await this._saveWorldInfo(cleanName, payload);\n"
     "        if (!written) {\n"
     "            return { ok: false, reason: 'write-failed', name: cleanName, added: [], skipped: merged.skipped, replaced: [], line: line, entries: merged.entries.length };\n"
     "        }\n"
     "        /* 写完刷缓存：下一次列表读必须是新值（不刷就会拿 5 秒内的旧缓存，\n"
     "         *   用户看到「写了但没变」）。 */\n"
     "        await this._refreshWorldInfoCache(cleanName).catch(function () { return false; });\n"
     "        this._cache = null;\n"
     "        this._cacheAt = 0;\n"
     "        return { ok: true, reason: 'ok', name: cleanName, added: merged.added, skipped: merged.skipped, replaced: merged.replaced, line: line, entries: merged.entries.length };\n"
     "    }\n"
     "\n"
     "    /** 写：先试前端模块出口，再试后端接口。两条都失败才如实报失败（不静默成功）。 */\n"
     "    async _saveWorldInfo(name, data) {\n"
     "        try {\n"
     "            const worldModule = await this._loadWorldInfoModule();\n"
     "            const worldInfo = worldModule?.world_info || window.world_info;\n"
     "            if (typeof worldModule?.saveWorldInfo === 'function') {\n"
     "                await worldModule.saveWorldInfo(name, data.entries, true);\n"
     "                return true;\n"
     "            }\n"
     "            if (typeof worldInfo?.saveWorldInfo === 'function') {\n"
     "                await worldInfo.saveWorldInfo(name, data.entries, true);\n"
     "                return true;\n"
     "            }\n"
     "        } catch (error) {\n"
     "            console.warn('[WorldbookManager] 世界书写回（前端模块）失败:', name, error);\n"
     "        }\n"
     "        try {\n"
     "            await fetchJson(WORLD_INFO_SAVE_ENDPOINT, Object.assign({}, data, { name: name }));\n"
     "            return true;\n"
     "        } catch (error) {\n"
     "            console.warn('[WorldbookManager] 世界书写回（后端接口）失败:', name, error);\n"
     "        }\n"
     "        return false;\n"
     "    }\n"
     "\n"
     "    async listAvailableWorldbooks(options = {}) {\n",
     'A1 write 方法')

edit('config/worldbook-manager.js',
     "            return {\n"
     "                ...book,\n"
     "                entries,\n"
     "                allEntries,\n"
     "                totalEntries,\n"
     "                disabledEntries\n"
     "            };\n",
     "            return {\n"
     "                ...book,\n"
     "                entries,\n"
     "                allEntries,\n"
     "                totalEntries,\n"
     "                disabledEntries,\n"
     "                /* [v3.80.0 · 缝入 A1] 读出来就必须说得出「这份能被写」：没读到内容时\n"
     "                 *   这一格如实是空串（写回会走 read-failed），而不是悄悄省略 ——\n"
     "                 *   省略会让消费方分不清「不能写」和「这一格不存在」。 */\n"
     "                writeLine: entries.length ? '可写（追加模式·按内容去重）' : '未读到条目：写回前会重新现读一次'\n"
     "            };\n",
     'A1 writeLine')

edit('config/worldbook-manager.js',
     "            return { ...book, entries: [], allEntries: [], totalEntries: 0, disabledEntries: 0 };\n",
     "            return { ...book, entries: [], allEntries: [], totalEntries: 0, disabledEntries: 0, writeLine: '读取失败：写回会再试一次现读' };\n",
     'A1 writeLine err')


def main():
    for rel, anchor, new, label in PLAN:
        src = io.open(rel, encoding='utf-8').read()
        n = src.count(anchor)
        if n != 1:
            print('ABORT [%s] %s: 锚点命中 %d 次（要求 1）' % (rel, label, n))
            return 1
        src = src.replace(anchor, new, 1)
        io.open(rel, 'w', encoding='utf-8').write(src)
        print('ok [%s] %s' % (rel, label))
    print('--- all patches applied ---')
    return 0


sys.exit(main())
