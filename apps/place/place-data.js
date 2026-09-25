/* ========================================================
 * place-data.js — [v2.46.0] 地点图景 数据与投影内核（纯函数，零 window 依赖）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   上游记忆插件在 v3.181.0 把「地点」从一句注记做成了一个可查询的面
 *   （`scene-book.js`：场景树 / 到访史 / 在场索引 / 地点挂账 / 覆盖度 / 不变量六面），
 *   并且把它外供到了只读快照桥上（`lonsha_memory_bridge_v1.snapshot.scene`）。
 *   而 RubyPhone 侧实测：**全库零消费**——手机端只看得到剧情、看不到「人在哪儿」。
 *   后果是本仓最典型的欠债形态：上游把面做出来了，下游一个消费点都没有，
 *   于是「主角上一次去『老城›钟楼›顶层』是什么时候」「这一段剧情发生在哪儿」
 *   「谁在这个地方」在手机上全部答不出——而这些数据**已经在手边了**。
 *
 * 【本模块的职责（把 scene 面投影成手机可渲染的东西）】
 *   ① 来源归因 `readSceneFace()`：六态如实分开（见下），不把「桥没装」与「这世界是空的」同形；
 *   ② 投影 `projectScene()`：位置链 / 在场分组 / 到访读数 / 覆盖度 / 不变量五块可读数据；
 *   ③ 一致性块 `scenePromptBlock()`：把「本世界已登记的场所与在场」交给生成侧，
 *      让正文里的地点与记忆插件里的地点是同一个（而不是各写各的）。
 *
 * 【为什么归因要分成六态（本仓反复治理的「静默降级」）】
 *   修前形态：拿不到数据与「这个世界是空的」长得一模一样，调用方只能一律当「没数据」，
 *   于是「桥没装」「桥装了但还没产出快照」「快照是旧版没有 scene 面」「scene 面是缺席退路」
 *   四种完全不同的处境在界面上同形。这里把六态显式分开，让用户知道该去装/去等/去升级。
 *
 *   纯 ESM export，纯函数无 window 依赖，时间戳由调用方注入，保证可测。
 * ======================================================== */
'use strict';
import { faceFieldState } from '../../config/world-bridge.js';

/** 归因文案（六态；与 readSceneFace 的 reason 一一对应，缺项即 UI 显示原始 reason，不静默） */
export const PLACE_REASONS = Object.freeze({
    'ready': '地点图景就绪',
    'empty': '这个会话还没有登记过场所',
    'no-scene-face': '记忆插件在，但这版快照没有场所面（需 v3.181+）',
    'upstream-empty': '记忆插件已声明场所面为空（不是没这面，是这次还没登记场所）',
    'module-absent': '记忆插件里场所模块缺席（退路在跑，读数一律为空）',
    'no-snapshot': '桥在，但还没产出过快照',
    'bridge-absent': 'LonSha 记忆插件未安装'
});

/** 不变量三态文案（ok/warn/broken 必须三种字样，不得两态同形） */
export const IV_TEXT = Object.freeze({
    'ok': '树完好',
    'warn': '读数可疑',
    'broken': '树断裂',
    'absent': '缺席（不算通过）'
});

/** 默认设置（随会话隔离，键须匹配 /^place_/） */
export function defaultPlaceSettings() {
    return {
        // 是否把「已登记场所/在场」交给生成侧（与正文地点对齐）
        injectToPrompt: true,
        // 注入块最多几行场所
        maxInject: 8,
        // 视图是否显示覆盖度/不变量诊断块
        showDiagnostics: true
    };
}

/**
 * 来源归因：把「桥在不在 / 有没有快照 / 有没有 scene 面 / 面是不是缺席退路 / 空不空」
 * 五种处境与「就绪」分开报。
 *
 * @param {{mounted?:boolean, hasSnapshot?:boolean, snapshot?:object|null}} probe
 *   由调用方（消费侧）从只读桥取出，本函数不碰 window。
 * @returns {{state:string, reason:string, snapshot:object|null, text:string}}
 *   state ∈ { absent, empty, ready }（粗态）
 *   reason ∈ PLACE_REASONS 的六个键（细态；粗态不得替代细态）
 */
export function readSceneFace(probe) {
    const p = probe && typeof probe === 'object' ? probe : {};
    const out = { state: 'absent', reason: 'bridge-absent', snapshot: null, text: PLACE_REASONS['bridge-absent'] };
    if (!p.mounted) return out;
    if (!p.hasSnapshot) { out.reason = 'no-snapshot'; out.text = PLACE_REASONS['no-snapshot']; return out; }
    const snap = p.snapshot;
    if (!snap || typeof snap !== 'object') { out.reason = 'no-snapshot'; out.text = PLACE_REASONS['no-snapshot']; return out; }
    // 记忆插件 v3.181 起在桥快照里带 `scene`（summary() 纯数据面）。
    // 旧版没有这一项 ⇒ 「没这面」与「这面是空的」必须分开（升级提示只有前者能给）。
    if (!snap.scene || typeof snap.scene !== 'object') {
        // [v2.98.0] 同 profile：先问上游是否声明过这项。判定只此一份。
        if (faceFieldState(snap, ['scene']) === 'declared-empty') {
            out.state = 'empty'; out.reason = 'upstream-empty'; out.text = PLACE_REASONS['upstream-empty']; return out;
        }
        out.reason = 'no-scene-face'; out.text = PLACE_REASONS['no-scene-face']; return out;
    }
    const face = snap.scene;
    // 模块缺席退路（A 侧 SceneBookFallback）会带 absent:true ⇒ 不静默化成「空」
    if (face.absent === true) {
        out.reason = 'module-absent'; out.text = PLACE_REASONS['module-absent']; out.snapshot = face; return out;
    }
    if (face.empty === true) {
        out.state = 'empty'; out.reason = 'empty'; out.text = PLACE_REASONS['empty']; out.snapshot = face; return out;
    }
    out.state = 'ready'; out.reason = 'ready'; out.text = PLACE_REASONS['ready']; out.snapshot = face;
    return out;
}

/** 取数（不抛；非数值如实 null，不编 0） */
function numOrNull(v) {
    /* 【修的是什么】`Number(null) === Number('') === Number([]) === 0`、`Number(true) === 1`，
     *   于是「上游没给这格」与「上游给了 0」在本函数里塌成同一个读数 —— 而两者处置相反
     *   （没给 ⇒ 等升级；给了 0 ⇒ 真读数）。本文件第 98 行的口径写的就是「非数值如实 null，
     *   不编 0」，实现却漏了这一格。
     *
     *   [v3.3.1·O-8] **与 config/* 的两份同名函数对齐为强口径**。此前本份是**弱一格**的：
     *   只挡 `null` / `undefined` / `''`，而实测 `'  ' → 0`、`[] → 0`、`true → 1`、`false → 0`、`[3] → 3`。
     *   这条不对称在 v3.3.0（O-1 轮）被判为「可达性为零」故未动（怪值只能来自上游外供面，
     *   而上游已收口为 `number | null`）；O-8 把它收掉的理由是：**本仓不该靠上游自觉** ——
     *   同一条口径在同一个仓里存在两种严格度，读代码的人无法判断该信哪一份。
     *   口径逐字同 config/projection-contract.js:95 与 config/injection-contract.js:118。 */
    if (typeof v !== 'number' && typeof v !== 'string') return null;
    if (typeof v === 'string' && !v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
/** 纯文本裁剪（防单条无界） */
function clip(v, max = 200) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * 当前位置链（由粗到细）。缺链如实返回 []（不是 null，也不是编一条）。
 * @param {object} face scene 面
 * @returns {string[]}
 */
export function currentChainOf(face) {
    const line = face && typeof face.currentLine === 'string' ? face.currentLine : '';
    if (line) return line.split('›').map((s) => s.trim()).filter(Boolean);
    const cur = face && typeof face.current === 'string' ? face.current : '';
    return cur ? cur.split('/').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * 在场分组：把「谁在这个地方」按**地点**聚成一室一室的人。
 * 同一地方的多个人 → 一组；无在场如实返回 []。
 * @param {Array<{name:string,key:string,atFloor:number}>} presence
 * @returns {Array<{key:string, members:string[], atFloor:number|null}>}
 */
export function presenceGroups(presence) {
    const map = new Map();
    for (const rec of (Array.isArray(presence) ? presence : [])) {
        if (!rec || typeof rec !== 'object') continue;
        const name = clip(rec.name, 40);
        const key = clip(rec.key, 160);
        if (!name || !key) continue;
        const g = map.get(key) || { key, members: [], atFloor: numOrNull(rec.atFloor) };
        if (!g.members.includes(name)) g.members.push(name);
        map.set(key, g);
    }
    return [...map.values()]
        .map((g) => ({ ...g, members: g.members.slice().sort() }))
        .sort((a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key));
}

/**
 * 覆盖度读数行（逐楼列号 + 缺口 + 未登记到访）。
 * 【为什么不许只报一个百分比】「有缺口」与「缺哪几楼、缺多少」是两件事：
 *   前者无法行动，后者可以直接去补。本项目的老毛病就是把后者压成前者。
 * @returns {{head:string, steps:string[], unregistered:string[]}}
 */
export function coverageLines(coverage) {
    const c = coverage && typeof coverage === 'object' ? coverage : {};
    const floors = Array.isArray(c.floors) ? c.floors.filter((f) => numOrNull(f) !== null) : [];
    const n = numOrNull(c.floorCount);
    const head = floors.length
        ? `变更覆盖 ${n === null ? floors.length : n} 楼：${floors.slice(-12).map((f) => '第' + f + '楼').join('、')}`
        : '尚未观测到任何楼层变更';
    const steps = (Array.isArray(c.steps) ? c.steps : [])
        .filter((s) => s && numOrNull(s.missing) > 0)
        .map((s) => `第${numOrNull(s.after)}楼 → 第${numOrNull(s.before)}楼之间缺 ${numOrNull(s.missing)} 楼未登记`);
    const unregistered = (Array.isArray(c.unregistered) ? c.unregistered : [])
        .map((k) => clip(k, 80)).filter(Boolean);
    /* [v3.2.0] R3-D：**场景头覆盖度**（上游 v3.221.0 的 `coverage.headerFloors` / `headerCount`）。
     *   修前实测：本函数只列「有变更的楼层」与「未登记到访」两类，于是删楼 / 前移对
     *   **本楼场景头**（headers）的处理在下游**没有任何读数面** —— 「那天什么天气」可以停在
     *   一个已被删掉的楼层上，而本页照报「就绪」。上游已把列号与条数外供，这里如实读出来。
     *   两态严格分开（本仓一贯口径）：
     *     `headerFloors` **不是数组** ⇒ 上游这版还没这面 ⇒ 本行为空串（视图另有「需 v3.221+」文案）；
     *     是数组但为空     ⇒ 有这面、这个会话还没登记场景头 ⇒ 如实说「尚未登记」。
     */
    const hFloors = Array.isArray(c.headerFloors) ? c.headerFloors.filter((f) => numOrNull(f) !== null) : [];
    const hCount = numOrNull(c.headerCount);
    const headers = !Array.isArray(c.headerFloors) ? ''
        : (hFloors.length
            ? `场景头覆盖 ${hCount === null ? hFloors.length : hCount} 楼：${hFloors.slice(-12).map((f) => '第' + f + '楼').join('、')}`
            : '尚未登记任何楼层的场景头（日期/时段/天气）');
    return { head, steps, unregistered, headers };
}

/**
 * 不变量读数行（三态如实；broken 与 warn 各自的 kind 逐条列出）。
 * 三态不得塌两态：ok / warn / broken 必须给出三种不同的字样（见 IV_TEXT）。
 * @returns {{state:string, text:string, broken:string[], warnings:string[]}}
 */
export function invariantLines(iv) {
    const v = iv && typeof iv === 'object' ? iv : {};
    const state = typeof v.state === 'string' ? v.state : 'absent';
    const broken = (Array.isArray(v.broken) ? v.broken : []).map((b) => describeIssue(b, true)).filter(Boolean);
    const warnings = (Array.isArray(v.warnings) ? v.warnings : []).map((b) => describeIssue(b, false)).filter(Boolean);
    return { state, text: IV_TEXT[state] || ('未知态：' + state), broken, warnings };
}

/** 一条违例的可读描述（kind 未知时如实显示 kind，不吞） */
function describeIssue(item, fatal) {
    if (!item || typeof item !== 'object') return '';
    const where = item.key ? '「' + clip(item.key, 60) + '」' : (item.name ? '「' + clip(item.name, 40) + '」' : '');
    const K = {
        'bad-node': '节点结构损坏',
        'key-path-mismatch': '键与路径不一致',
        'bad-desc': '描述类型不对',
        'broken-chain': '层级断裂（缺上级）',
        'visit-unregistered': '到访过但未登记',
        'track-unregistered': '位置轨迹指向不存在的地点',
        'presence-bad': '在场记录损坏',
        'invariant-threw': '不变量自检抛错'
    };
    const label = K[item.kind] || String(item.kind || '未知违例');
    return (fatal ? '✗ ' : '！') + label + where + (item.missing ? '（缺 ' + clip(item.missing, 60) + '）' : '');
}

/**
 * [v3.1.0] R3-A：层级树行（上游 scene.tree）。
 * 上游给的是**由粗到细的扁平行**（带 depth），这里原样保留层级关系，
 * 只做三件事：裁剪、去畸形、**把「没给」与「给了空的」分开**。
 * 不重排（顺序就是上游登记顺序，重排会让层级读起来错位），不猜父节点。
 */
function treeRows(tree, maxRows) {
    if (!Array.isArray(tree)) return [];
    const out = [];
    for (const n of tree) {
        if (!n || typeof n !== 'object') continue;
        const depth = Number.isFinite(Number(n.depth)) ? Number(n.depth) : 1;
        out.push({
            key: String(n.key || ''),
            name: String(n.name || ''),
            desc: String(n.desc || ''),
            depth: Math.max(1, Math.min(depth, 4)),
            floor: numOrNull(n.floor),
            visited: n.visited === true,
            visits: Number.isFinite(Number(n.visits)) ? Number(n.visits) : 0
        });
        if (out.length >= maxRows) break;
    }
    return out;
}

/**
 * [v3.1.0] R3-A：到访史行（上游 scene.visits）。
 * 「去过几次」现在**能答了**（count），不再只报条目数；
 * registered=false 表示「到访过但树里没这个节点」——那是真缺陷，要显式标出。
 */
function visitRows(visits, maxRows) {
    if (!Array.isArray(visits)) return [];
    const out = [];
    for (const v of visits) {
        if (!v || typeof v !== 'object') continue;
        out.push({
            key: String(v.key || ''),
            path: Array.isArray(v.path) ? v.path.map((x) => String(x)) : [],
            count: Number.isFinite(Number(v.count)) ? Number(v.count) : null,
            firstFloor: numOrNull(v.firstFloor),
            lastFloor: numOrNull(v.lastFloor),
            revisit: v.revisit === true,
            registered: v.registered !== false
        });
        if (out.length >= maxRows) break;
    }
    return out;
}

/**
 * [v3.1.0] R3-A：本楼场景头（上游 scene.header）。
 * 没登记过就是 null（不是空字符串三连）——「这天没写天气」与「这版没这面」分开。
 */
function headerFace(h) {
    if (!h || typeof h !== 'object') return null;
    const out = {
        floor: numOrNull(h.floor),
        date: String(h.date || ''),
        period: String(h.period || ''),
        weather: String(h.weather || '')
    };
    if (!out.date && !out.period && !out.weather) return null;
    return out;
}

/**
 * 投影：把 scene 面变成可直接渲染的五块数据。
 * 只读、绝不抛；缺失的块如实置空（不抛也不编）。
 *
 * @param {object} face readSceneFace().snapshot
 * @param {{maxEntries?:number}} [opts]
 * @returns {{ok:boolean, scale:object, current:string[], presence:Array, visits:Array,
 *            coverage:object, invariants:object, state:string}}
 */
export function projectScene(face, opts = {}) {
    const out = {
        ok: false, state: 'absent',
        scale: { nodes: null, detailed: null, depth: null, visits: null, presence: null },
        current: [], presence: [], visits: [],
        // [v3.1.0] R3-A：本世界场所的**层级树 / 到访史 / 本楼场景头**三面。
        //   修前实测：上游 summary() 只吐 current（末级键字符串）与规模四数，本页于是
        //   只能说「当前位置 + 19 处场所」；「这店在城里哪一区」「去过哪些、去过几次」
        //   「那天什么天气」在**账本里早有**（tree/visitsList/headerAt），却从没出过仓。
        //   三面与 current 同一读取时刻，同修订下必然自洽；读不到就是空（不编）。
        tree: [], history: [], header: null,
        chainFace: [],
        coverage: { head: '', steps: [], unregistered: [], headers: '' },
        hasHeaderFloorsFace: false,
        invariants: { state: 'absent', text: IV_TEXT['absent'], broken: [], warnings: [] }
    };
    try {
        if (!face || typeof face !== 'object') return out;
        const maxEntries = Math.max(1, Number(opts.maxEntries) || 20);
        const sc = face.scale && typeof face.scale === 'object' ? face.scale : {};
        out.scale = {
            nodes: numOrNull(sc.nodes), detailed: numOrNull(sc.detailed), depth: numOrNull(sc.depth),
            visits: numOrNull(sc.visits), presence: numOrNull(sc.presence)
        };
        out.current = currentChainOf(face);
        out.presence = presenceGroups(face.presence).slice(0, maxEntries);
        // 到访读数：本插件快照里给的是 coverage.visits（到访史**条目数**）。
        //   单点读数（首次/最近/次数）在记忆插件内部；桥上只外供了规模与覆盖度两面，
        //   故这里如实报「到访史 N 处」，不假装能读单点的「去过几次」。
        out.coverage = coverageLines(face.coverage);
        // [v3.2.0] R3-D：覆盖度**面**在不在（判格子在不在，不判内容非空）。
        //   与 hasTreeFace / hasVisitFace / hasHeaderFace 同一口径：缺格要等上游升级，
        //   空格要用户去补 —— 处置相反，故不得同形。
        out.hasHeaderFloorsFace = !!(face.coverage && typeof face.coverage === 'object'
            && Array.isArray(face.coverage.headerFloors));
        out.invariants = invariantLines({
            state: (face.coverage && face.coverage.state) || 'ok',
            broken: (face.coverage && face.coverage.broken) || [],
            warnings: (face.coverage && face.coverage.warnings) || []
        });
        out.visits = Array.isArray(face.coverage && face.coverage.trackFloors)
            ? face.coverage.trackFloors.map((f) => ({ floor: numOrNull(f) })) : [];
        // [v3.1.0] R3-A：三新面。每个字段都按「没给 ⇒ 空」处理，
        //   绝不把「上游这版没这面」渲染成「世界就是这样」——
        //   tree 缺 → 空数组（本页显示「这版上游没带层级」而不是「没有下级」）。
        out.tree = treeRows(face.tree, maxEntries);
        out.history = visitRows(face.visits, maxEntries);
        out.header = headerFace(face.header);
        out.chainFace = Array.isArray(face.currentChain)
            ? face.currentChain.map((n) => ({
                key: String((n && n.key) || ''),
                name: String((n && n.name) || ''),
                desc: String((n && n.desc) || ''),
                floor: numOrNull(n && n.floor)
            })).filter((n) => n.name || n.key) : [];
        out.hasTreeFace = Array.isArray(face.tree);
        out.hasVisitFace = Array.isArray(face.visits);
        out.hasHeaderFace = Object.prototype.hasOwnProperty.call(face, 'header');
        out.ok = true;
        out.state = face.empty === true ? 'empty' : 'ready';
        return out;
    } catch (_e) { return out; }
}

/**
 * 一致性块：把「本世界已登记的场所与在场」交给生成侧。
 * 与 worldpulse 的 worldAxisPromptBlock 同规格：内容为空返回 ''（不产生空块）。
 * @param {object} face
 * @param {{maxLines?:number}} [opts]
 */
export function scenePromptBlock(face, opts = {}) {
    try {
        const maxLines = Math.max(1, Number(opts.maxLines) || 8);
        if (!face || typeof face !== 'object' || face.empty === true) return '';
        const lines = [];
        const chain = currentChainOf(face);
        if (chain.length) lines.push('- 当前所在：' + chain.join(' › '));
        for (const g of presenceGroups(face.presence).slice(0, maxLines)) {
            lines.push('- ' + g.key.split('/').join(' › ') + '：' + g.members.join('、'));
        }
        const sc = face.scale && typeof face.scale === 'object' ? face.scale : {};
        if (numOrNull(sc.nodes) !== null) {
            lines.push('- 已登记场所 ' + numOrNull(sc.nodes) + ' 处（细写 ' + (numOrNull(sc.detailed) || 0)
                + ' / 最深 ' + (numOrNull(sc.depth) || 0) + ' 层）· 到访 ' + (numOrNull(sc.visits) || 0)
                + ' 处 · 在场 ' + (numOrNull(sc.presence) || 0) + ' 人');
        }
        if (!lines.length) return '';
        return '【本世界已登记的场所与在场（记忆插件场所图景，不得与之矛盾）】\n' + lines.slice(0, maxLines + 2).join('\n');
    } catch (_e) { return ''; }
}
