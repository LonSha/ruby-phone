/* ============================================================
 * checkpoint-content-contract.js — [v3.20.2] 上游检查点**内容级只读对照**的消费侧单一真源
 * ------------------------------------------------------------
 * 【治的欠债（修前实测，不是推测）】
 *   上游 lonsha-memory-plugin 在 **v3.237.0（R4-C）** 交付了检查点族（命名检查点 / 只读对照），
 *   并在 **v3.252.0（F7 首阶段）** 补上了本仓一直缺的那一半：
 *     · 模块面 `snapshot-checkpoint.js::diffPayloadsDeep(a, b, opts)` —— 在既有键面读数
 *       （`onlyInA` / `onlyInB` / `shared` / `bytes` / 代际，**逐字未改**）**之上**叠一层
 *       有界的逐条内容差异（`changes[]` / `sets[]` / `capped[]` / `cycles[]` /
 *       `deepContentCompared` 三态 / `changesTruncated` / `limits`）；
 *     · 引擎面 `compareBranchCheckpointsDeep(nameA, nameB, chatId, opts)` 与
 *       多行文案 `checkpointContentDiffLines(nameA, nameB, chatId)`。
 *
 *   而本仓实测（`grep -RIn 'compareCheckpoints|diffPayloads|snapshot-checkpoint|LonShaSnapshot' apps config`）
 *   **零命中** —— 上游把「同键同长度但值不同」（计划二 F7 点名的「余额 100→900、朋友→仇人」）
 *   这类改变的读数做出来了，下游**一个消费者都没有**。于是用户能看到的仍然只有
 *   「两边的键一样、字节差不多」，而那份最要紧的差异（值变了）**零读数**。
 *   这是本仓反复出现的「建好不消费」的第十例，与投影面 / 注入面 / 证据面**同一族**。
 *
 * 【本模块的职责（只搬、不重算）】
 *   · 只读：只调上游**只读**出口（`compareBranchCheckpointsDeep` / 文案口），
 *     绝不碰 `saveCheckpoint` / `dropCheckpoint` 这类写面，也不碰 localStorage；
 *   · 不抛：引擎不在场 / 旧版无此方法 / 调用抛错 / 返回值畸形，一律降级为归因；
 *   · 不猜：**不在这里重算内容差异** —— 那是上游 `diffPayloadsDeep` 的口径，
 *     下游再实现一份必然漂移（本仓「同一口径只许一份实现」）。
 *     本模块只把上游读数**归一成恒定键面**，供 UI 直接渲染。
 *
 * 【三态（本仓最贵的老账：缺席与空必须不同形）】
 *   · 引擎不在场（插件未装 / 未 init）      ⇒ `engine-absent`（等装桥）
 *   · 引擎在场但没有这一族方法（旧版插件）   ⇒ `face-absent`（等上游升级）
 *   · 方法在但调用抛错                      ⇒ `unusable`（本机读不出，等上游修）
 *   · 读到清单且清单为空                    ⇒ `empty`（**真读数**：还没有检查点）
 *   · 有检查点                              ⇒ `ok`
 *   压平任何两态都会造出处置相反的两种处境长得一模一样的读数。
 *
 * 【为什么对照本身再分四态（而不是复用上面五态）】
 *   `compareBranchCheckpointsDeep` 自己的失败形态是**另一套**，且上游刻意做成了不同形：
 *     · 任一侧缺失 / 载荷损坏  ⇒ `corrupt`（**不拿空载荷冒充「那边是空的」**）；
 *     · 模块过旧（无深比较出口）⇒ `deep-unavailable`，**仍给键面读数**
 *       ——「深比较这版没有」不得把已经能给的键面读数一起吞掉；
 *     · 深比较内部出错          ⇒ 上游仍报 `ok:true` 且 `deep.ok:false`（键面能用就说能用）。
 *   本模块**照原样搬运 reason**，不把它折成本模块自己的态词（折了就是替上游下结论）。
 * ============================================================ */
'use strict';

/** 上游引擎全局名（与 `apps/memory/graph-bridge.js` 读的是同一个；此处唯一收口，别处不再写） */
const LONSHA_ENGINE_GLOBAL = 'LonShaMemory';

/** 面状态（本模块自己的五态；对照的失败形态搬运上游 reason，不折进来） */
export const CHECKPOINT_FACE_STATES = Object.freeze({
    ENGINE_ABSENT: 'engine-absent',
    FACE_ABSENT: 'face-absent',
    UNUSABLE: 'unusable',
    EMPTY: 'empty',
    OK: 'ok'
});

/** 对照状态的**本模块侧**两种：上游能给就说能给（`readable`），给不了才归因。 */
export const CHECKPOINT_DIFF_STATES = Object.freeze({
    READABLE: 'readable',
    ENGINE_ABSENT: 'engine-absent',
    FACE_ABSENT: 'face-absent',
    UNUSABLE: 'unusable'
});

/** 本模块要用的上游出口名（读出面唯一清单；改这里即两边同时对齐） */
const ENGINE_FACE_METHOD = 'compareBranchCheckpointsDeep';
const ENGINE_FACE_LINES = 'checkpointContentDiffLines';

/** 宿主窗口（注入优先，回落全局；与 config/story-clock.js 的探针同规格） */
function resolveWin(win) {
    if (win && typeof win === 'object') return win;
    try { return (typeof globalThis !== 'undefined' && globalThis) ? globalThis : null; }
    catch (_e) { return null; }
}

/** 安全取引擎（宿主怪 getter 一律降级成 null，绝不外抛） */
function engineOf(win) {
    try {
        const w = resolveWin(win);
        if (!w) return null;
        const holder = w[LONSHA_ENGINE_GLOBAL];
        if (!holder || typeof holder !== 'object') return null;
        const eng = holder.engine;
        return (eng && typeof eng === 'object') ? eng : null;
    } catch (_e) { return null; }
}

/** 缺席形态的恒定键面（读者不必再判 undefined；`state`/`reason` 之外的键都有确定零值） */
function emptyFace(state, reason) {
    return {
        state, reason,
        names: [], count: 0,
        hasContentDiff: false,
        engineVersion: ''
    };
}

/**
 * 读上游检查点清单的**存在性面**（只读，绝不写）。
 *
 * @param {object} [win] 显式注入 window（无头测试用），不传即取全局
 * @returns {{ state:string, reason:string, names:string[], count:number,
 *             hasContentDiff:boolean, engineVersion:string }}
 *   state ∈ CHECKPOINT_FACE_STATES
 *   `names` 只是**名字**（清单用途），不含任何载荷 —— 载荷读取一律走对照口，
 *   免得本模块成为第二处「检查点长什么样」的知识。
 */
export function readLonshaCheckpointFace(win) {
    try {
        const eng = engineOf(win);
        if (!eng) return emptyFace(CHECKPOINT_FACE_STATES.ENGINE_ABSENT, 'not-mounted');
        const engineVersion = String(eng.version || eng.pluginVersion || '');
        /* 旧版判定只看**方法在不在**，不看版本号：版本号可能缺（提取执行模式的独立实例），
         *   而「方法在不在」是能力本身。拿一个可能为空的版本号去做能力判定＝猜。 */
        const hasList = typeof eng.listCheckpoints === 'function';
        const hasDiff = typeof eng[ENGINE_FACE_METHOD] === 'function';
        if (!hasList && !hasDiff) {
            return Object.assign(emptyFace(CHECKPOINT_FACE_STATES.FACE_ABSENT, 'face-absent'), { engineVersion });
        }
        let items = null;
        if (hasList) {
            const r = eng.listCheckpoints();
            /* 三态：清单 `null` 是「读不到」，`[]` 是「真的没有」—— 上游刻意分了这两态，
             *   下游不得压平（压平就是把「读不到」显示成「还没有检查点」）。 */
            if (r && r.items === null) {
                return Object.assign(emptyFace(CHECKPOINT_FACE_STATES.UNUSABLE, String(r.reason || 'unavailable')),
                    { engineVersion, hasContentDiff: hasDiff });
            }
            items = (r && Array.isArray(r.items)) ? r.items : null;
        }
        if (items === null) {
            return Object.assign(emptyFace(CHECKPOINT_FACE_STATES.UNUSABLE, 'list-unavailable'),
                { engineVersion, hasContentDiff: hasDiff });
        }
        const names = items.map((it) => String((it && it.name) || '')).filter(Boolean);
        if (!names.length) {
            return Object.assign(emptyFace(CHECKPOINT_FACE_STATES.EMPTY, 'no-checkpoints'),
                { engineVersion, hasContentDiff: hasDiff });
        }
        return {
            state: CHECKPOINT_FACE_STATES.OK, reason: 'ok',
            names, count: names.length,
            hasContentDiff: hasDiff, engineVersion
        };
    } catch (_e) {
        return emptyFace(CHECKPOINT_FACE_STATES.UNUSABLE, 'thrown');
    }
}

/**
 * 读两份检查点的**只读对照**（含上游 v3.252.0 的内容级增量）。
 *
 * 【为什么返回值键面恒定】读者不该按键在不在猜处境（本仓「对象键面随路径变」的老账）。
 *   失败路径一律给 `face:null` / `deep:null`，并以 `state` + `reason` 归因。
 *
 * 【为什么不在这里重算差异】上游已把键面与内容两层都算好了；下游再算一份就是
 *   同一口径的第二份实现（而两份必然在某一次改动后分叉，且分叉是无声的）。
 *
 * @param {object} [win] 显式注入 window
 * @param {string} nameA 基线检查点名
 * @param {string} nameB 目标检查点名
 * @param {string} [chatId] 会话身份（缺省交给上游引擎自己取）
 * @returns {{ state:string, reason:string, face:object|null, deep:object|null, lines:string|null }}
 *   state ∈ CHECKPOINT_DIFF_STATES；`reason` **原样搬运上游 reason**（不折算成本模块态词）
 */
export function readCheckpointContentDiff(win, nameA, nameB, chatId) {
    const base = { state: CHECKPOINT_DIFF_STATES.UNUSABLE, reason: 'unknown', face: null, deep: null, lines: null };
    try {
        const eng = engineOf(win);
        if (!eng) return Object.assign({}, base, { state: CHECKPOINT_DIFF_STATES.ENGINE_ABSENT, reason: 'not-mounted' });
        if (typeof eng[ENGINE_FACE_METHOD] !== 'function') {
            return Object.assign({}, base, { state: CHECKPOINT_DIFF_STATES.FACE_ABSENT, reason: 'face-absent' });
        }
        const r = eng[ENGINE_FACE_METHOD](String(nameA == null ? '' : nameA), String(nameB == null ? '' : nameB), chatId);
        if (!r || typeof r !== 'object') {
            return Object.assign({}, base, { reason: 'malformed' });
        }
        const reason = String(r.reason || 'unknown');
        /* 上游 `deep-unavailable` 是**半成功**：键面读数照给。
         *   本模块把它标成 readable（能给就说能给），并**保留原 reason** 让 UI 讲清
         *   「内容级这一步本版没有」——不得与「两边内容完全一样」同形。 */
        const readable = (r.ok === true) || (reason === 'deep-unavailable');
        return {
            state: readable ? CHECKPOINT_DIFF_STATES.READABLE : CHECKPOINT_DIFF_STATES.UNUSABLE,
            reason,
            face: (r.face && typeof r.face === 'object') ? r.face : null,
            deep: (r.deep && typeof r.deep === 'object') ? r.deep : null,
            lines: null
        };
    } catch (_e) {
        return Object.assign({}, base, { reason: 'thrown' });
    }
}

/**
 * 内容级对照的**多行文案**（唯一实现在上游；本模块只转发或如实报「拿不到」）。
 *
 * 【为什么文案不自拼】上游 `checkpointContentDiffLines` 已经把三态写进去了
 *   （截断 / 未下钻 / 循环引用各自单列，「没比」不得与「一样」同形）。
 *   下游再拼一份就是第二处「这句话该怎么说」的知识。
 *
 * @returns {string|null} 上游文案；拿不到时返回**本模块的归因文案**（说清楚是哪种拿不到）
 *   刻意不返回 null —— null 会被 UI 渲染成空行，而空行与「两边看不出差异」同形。
 */
export function checkpointContentLines(win, nameA, nameB, chatId) {
    try {
        const eng = engineOf(win);
        if (!eng) return '内容级对照：**读不到** —— 记忆插件不在场（不是「两边内容一样」）。';
        if (typeof eng[ENGINE_FACE_LINES] === 'function') {
            const s = eng[ENGINE_FACE_LINES](String(nameA == null ? '' : nameA), String(nameB == null ? '' : nameB), chatId);
            /* 上游文案口在读不到时返回 null（契约如此）。此处如实换成一句话，
             *   不让 UI 把「读不到」渲染成空行。 */
            if (typeof s === 'string' && s.trim()) return s;
            return '内容级对照：**读不到** —— 上游文案口回了空（两侧缺失或载荷损坏），不是「没有差异」。';
        }
        if (typeof eng[ENGINE_FACE_METHOD] !== 'function') {
            return '内容级对照：**本版插件没有这个出口**（旧版记忆插件，检查点族尚未交付）—— 这不是「内容一样」。';
        }
        return '内容级对照：**读不到** —— 上游文案口缺席（插件版本不齐），不是「没有差异」。';
    } catch (_e) {
        return '内容级对照：**比不成**（读取抛错）—— 这不是「没有差异」。';
    }
}

/** 面状态的一句话归因（唯一实现；供诊断面念出） */
export function checkpointFaceLine(face) {
    const f = (face && typeof face === 'object') ? face : emptyFace(CHECKPOINT_FACE_STATES.ENGINE_ABSENT, 'not-mounted');
    switch (f.state) {
        case CHECKPOINT_FACE_STATES.OK:
            return '检查点 ' + f.count + ' 份（' + f.names.slice(0, 5).join('、')
                + (f.names.length > 5 ? ' 等' : '') + '）'
                + (f.hasContentDiff ? ' · 本版支持内容级对照' : ' · 本版只有键面读数（旧版插件）');
        case CHECKPOINT_FACE_STATES.EMPTY:
            return '还没有检查点（**真读数**：清单读到了，里面是空的）'
                + (f.hasContentDiff ? '' : ' · 且本版只有键面读数（旧版插件）');
        case CHECKPOINT_FACE_STATES.FACE_ABSENT:
            return '本版插件没有检查点族（等上游升级）—— 这不是「还没有检查点」';
        case CHECKPOINT_FACE_STATES.UNUSABLE:
            return '清单读不到（' + String(f.reason || 'unavailable') + '）—— 这不是「还没有检查点」';
        case CHECKPOINT_FACE_STATES.ENGINE_ABSENT:
        default:
            return '记忆插件不在场（引擎未就位）—— 这不是「还没有检查点」';
    }
}

export default {
    LONSHA_ENGINE_GLOBAL,
    CHECKPOINT_FACE_STATES,
    CHECKPOINT_DIFF_STATES,
    readLonshaCheckpointFace,
    readCheckpointContentDiff,
    checkpointContentLines,
    checkpointFaceLine
};
