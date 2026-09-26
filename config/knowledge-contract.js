/* ========================================================
 * knowledge-contract.js — [v3.10.0] 知情网络的**消费侧单一真源**
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   上游记忆插件 v3.219.0 建了「知情网络」（`knowledge-network.js`）并把每角色的
 *   `{ known: string[], unaware: string[] }` 送进快照 `worldProg.knowledge`（v3.237.0
 *   同一形状，随 `worldProg` 十个子面一起外供）。而 RubyPhone 侧实测：
 *     · `plotline-data.js` 的 `knowledgeList()` 会把它**列出来**（有出口）；
 *     · 但**没有任何一处**把「谁不知道某件事」当成**约束**用起来 ——
 *       微信/微博/通知中心的文案生成、剧情线的一致性块，都在凭「角色名出现了」说话，
 *       不看「这个角色此刻到底知不知道这件事」。
 *   后果（本仓最贵的那类：不报错、只是说错话）：一个角色在场外、账里明确记着
 *   `unaware`，手机里的动态照样让他「知道」；反过来，账里**根本没有记录**的角色
 *   被当成「他什么都不知道」——而这个词在上游口径里是**不成立的**（上游明确
 *   「只记录正文明确表达的认知，不根据沉默推断」）。
 *
 * 【本模块的职责（只读、只归一、不推断）】
 *   把 `worldProg.knowledge` 读成手机端可用的三档边界面：
 *     · known   —— 账里**明确记着**这人知道
 *     · unaware —— 账里**明确记着**这人不知道
 *     · silent  —— 这人在账里有认知记录，但这条事实**两边都没记**
 *                  ⇒「无从分辨」，**不是**「不知道」（本仓三态纪律的直接应用）
 *   三档**必须不同形**：把 silent 归进 unaware 就是把「没记录」冒充成「明确不知情」，
 *   与上游「不根据沉默推断」的口径正面冲突。
 *
 * 【口径纪律（逐条对应本仓治理过的形态）】
 *   ① **读不到 ≠ 空**：五态分形（bridge-absent / no-snapshot / face-absent /
 *      declared-empty / ok），面级三态由调用方传 `faceState`（那是 `world-bridge.js`
 *      的职责，同一口径只许一份实现），本模块不另写形态判据。
 *   ② **不推断**：本模块**不**从任何一侧「反推」另一侧（`known` 里没有 ⇏ 不知道）。
 *      判定只按账里写了什么。
 *   ③ **不抛**：任何畸形输入一律降级成对应态，绝不外抛（只读面的老账）。
 *   ④ **匹配方式如实报**：事实与账里条目的对应只允许两种 —— `exact`（归一后全等）
 *      与 `substring`（互为子串）。返回里必须带 `matched`，让调用方知道这条结论
 *      是「逐字对上」还是「宽泛命中」（本仓 F-4 的教训：范围粒度错会造成假阳性）。
 *   ⑤ **纯函数化可注入**：不读全局、不写任何状态。
 *
 * 纯 ESM export，零 window 依赖。
 * ======================================================== */

/** 五态文案（与 `state` 一一对应；缺项即 UI 显示原始值，不静默） */
export const KN_REASONS = Object.freeze({
    ok: '知情网络就绪（账里有认知记录）',
    'declared-empty': '记忆插件已声明认知面为空（不是没这面，是这次还没记录）',
    'face-absent': '记忆插件在，但这版快照没有世界推进/认知面（需插件较新版本）',
    'no-snapshot': '桥在，但还没产出过快照',
    'bridge-absent': 'LonSha 记忆插件未安装'
});

/** 单条事实留存量上限 */
const ITEM_MAX = 120;
/** 单角色在两档里各留几条（如实截断，另记 truncated） */
const PER_LIST_MAX = 40;

function str(v, max) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return max ? s.slice(0, max) : s;
}

/** 归一：去空白、转小写（仅用于**匹配**；返回值仍是原文） */
function norm(v) {
    return str(v).toLowerCase();
}

/** 归一一个角色条目：列表逐条修剪、去空、截断并计数 */
function normalizePerson(name, rec) {
    const known = [];
    const unaware = [];
    let dropped = 0;
    const push = (arr, raw) => {
        for (const it of (Array.isArray(raw) ? raw : [])) {
            const s = str(it, ITEM_MAX);
            if (!s) { dropped += 1; continue; }
            if (!arr.includes(s)) arr.push(s);
        }
    };
    push(known, rec && rec.known);
    push(unaware, rec && rec.unaware);
    const knownTruncated = known.length > PER_LIST_MAX;
    const unawareTruncated = unaware.length > PER_LIST_MAX;
    return {
        character: str(name, 60),
        known: known.slice(0, PER_LIST_MAX),
        unaware: unaware.slice(0, PER_LIST_MAX),
        knownCount: known.length,
        unawareCount: unaware.length,
        truncated: knownTruncated || unawareTruncated,
        dropped
    };
}

/**
 * 把上游 `worldProg` 读成边界面。**纯读、不抛、键面恒定**（读者不必再判 undefined）。
 *
 * @param {{mounted?:boolean, hasSnapshot?:boolean, worldProg?:object|null,
 *          faceState?:string}} probe
 *   只接受**已取出的** `worldProg` 子面 —— 本模块**刻意不碰快照本体**：
 *   快照的形态判定只许有一份（`config/world-bridge.js`），消费方自写
 *   `x.snapshot && typeof x.snapshot === 'object'` 会被第九道门 J4 判红
 *   （那是本仓治理过多轮的「同一口径抄 N 份」）。调用方（剧情线内核）负责取子面。
 * @returns {{ state:string, reason:string, text:string, people:Array, count:number,
 *             knownTotal:number, unawareTotal:number, silentCapable:boolean }}
 *   state ∈ { ok, declared-empty, face-absent, no-snapshot, bridge-absent }
 */
export function knowledgeFace(probe) {
    const p = (probe && typeof probe === 'object') ? probe : {};
    const empty = (state) => ({
        state,
        reason: state,
        text: KN_REASONS[state] || KN_REASONS['bridge-absent'],
        people: [],
        count: 0,
        knownTotal: 0,
        unawareTotal: 0,
        silentCapable: false
    });
    try {
        /* 前三态：桥/快照/面 的在场性 —— 沿用调用方给的裁定（不在本模块重判形状） */
        if (p.mounted === false) return empty('bridge-absent');
        const faceState = str(p.faceState);
        if (faceState === 'absent') return empty('face-absent');
        if (faceState === 'declared-empty') return empty('declared-empty');
        if (p.hasSnapshot === false) return empty('no-snapshot');
        if (faceState === 'legacy-unknown') return empty('face-absent');

        const world = (p.worldProg && typeof p.worldProg === 'object') ? p.worldProg : null;
        if (!world) return faceState === 'present' ? empty('face-absent') : empty('no-snapshot');
        const kn = world.knowledge;
        /* 「没给」与「给了 0」必须不同形：knowledge 非对象 ⇒ 这版没这面 */
        if (!kn || typeof kn !== 'object' || Array.isArray(kn)) return empty('face-absent');
        const people = [];
        let knownTotal = 0;
        let unawareTotal = 0;
        for (const name of Object.keys(kn)) {
            const rec = kn[name];
            if (!rec || typeof rec !== 'object') continue;
            const person = normalizePerson(name, rec);
            if (!person.character) continue;
            knownTotal += person.knownCount;
            unawareTotal += person.unawareCount;
            people.push(person);
        }
        if (!people.length) return empty('declared-empty');
        return {
            state: 'ok',
            reason: 'ok',
            text: KN_REASONS.ok,
            people,
            count: people.length,
            knownTotal,
            unawareTotal,
            /* 至少有一处 unaware 记录，本面才**有能力**回答「谁不知道」——
             *   全账零 unaware 时，silent 与 unaware 在数据上无从区分，UI 必须知道这件事。 */
            silentCapable: unawareTotal > 0
        };
    } catch (_e) {
        return empty('bridge-absent');
    }
}

/** 一条事实与一份列表的匹配（只允许 exact / substring；不抛） */
export function matchFact(list, fact) {
    const f = norm(fact);
    if (!f) return { matched: 'none', hit: '' };
    for (const it of (Array.isArray(list) ? list : [])) {
        if (norm(it) === f) return { matched: 'exact', hit: str(it, ITEM_MAX) };
    }
    for (const it of (Array.isArray(list) ? list : [])) {
        const n = norm(it);
        if (n && (n.includes(f) || f.includes(n))) return { matched: 'substring', hit: str(it, ITEM_MAX) };
    }
    return { matched: 'none', hit: '' };
}

/**
 * 「谁（不）知道这条事实」—— 三档分形，**绝不把 silent 并进 unaware**。
 *
 * @param {Array} people `knowledgeFace()` 的 `people`
 * @param {string} fact 事实文本
 * @returns {{ fact:string, known:Array, unaware:Array, silent:Array, matched:string, unrecorded:number }}
 *   · known   —— 账里明确记着「这人知道」（含命中原文 `via`）
 *   · unaware —— 账里明确记着「这人不知道」
 *   · silent  —— 这人在账里**有认知记录**，但这条事实两边都没记 ⇒ 无从分辨
 *   · unrecorded —— 账里**完全没有**认知记录的角色数（他们连 silent 都算不上：
 *     连「有记录」这个前提都不成立）；该计数只做提示，**不列名** ——
 *     列名就等于把「没记录」渲染成「不知情」（本模块存在的主要理由）。
 *   matched 取两侧的**最弱**结论：有一侧只到 substring，整体就是 substring。
 */
export function whoKnows(people, fact) {
    const list = Array.isArray(people) ? people : [];
    const f = str(fact, ITEM_MAX);
    const known = [];
    const unaware = [];
    const silent = [];
    let unrecorded = 0;
    let matched = 'none';
    const rank = { none: 0, substring: 1, exact: 2 };
    const weaken = (m) => { if (rank[m] < rank[matched]) matched = m; };
    for (const p of list) {
        if (!p || !p.character) continue;
        const k = matchFact(p.known, f);
        const u = matchFact(p.unaware, f);
        if (k.matched !== 'none') {
            if (matched === 'none') matched = k.matched; else weaken(k.matched);
            known.push({ character: p.character, via: k.hit, matched: k.matched });
            continue;
        }
        if (u.matched !== 'none') {
            if (matched === 'none') matched = u.matched; else weaken(u.matched);
            unaware.push({ character: p.character, via: u.hit, matched: u.matched });
            continue;
        }
        /* 这人一条认知记录都没有 ⇒ 连「有记录」的前提都不成立 */
        if (!p.knownCount && !p.unawareCount) { unrecorded += 1; continue; }
        silent.push(p.character);
    }
    return { fact: f, known, unaware, silent, matched, unrecorded };
}

/**
 * 某个角色视角的边界（供「他该不该提到这件事」用）。
 *
 * @returns {{ character:string, known:Array, unaware:Array, recorded:boolean,
 *             knownCount:number, unawareCount:number, boundary:string }}
 *   `boundary` 是**性格面**：'recorded'（有认知记录）/ 'unrecorded'（一条都没有，
 *   无从分辨他知道什么）。刻意不叫 'known'/'unaware' —— 那是单条事实的结论，不是人的属性。
 */
export function boundaryOf(people, character) {
    const list = Array.isArray(people) ? people : [];
    const name = str(character, 60);
    const miss = { character: name, known: [], unaware: [], recorded: false, knownCount: 0, unawareCount: 0, boundary: 'unrecorded' };
    if (!name) return miss;
    for (const p of list) {
        if (!p || p.character !== name) continue;
        const recorded = !!(p.knownCount || p.unawareCount);
        return {
            character: p.character,
            known: p.known.slice(),
            unaware: p.unaware.slice(),
            recorded,
            knownCount: p.knownCount,
            unawareCount: p.unawareCount,
            boundary: recorded ? 'recorded' : 'unrecorded'
        };
    }
    return miss;
}

/**
 * 「这条事实此刻谁不知道」的**生成侧约束块**（给写文案/写动态的模型用）。
 * 只列账里**明确记着**不知道的人；silent 与 unrecorded **一个字都不进块** ——
 * 把「没记录」写成约束，模型就会把它当成事实陈述出去（本仓最贵形态）。
 * 无可列时返回 ''（不产生空块）。
 *
 * @param {Array} people
 * @param {string} fact
 * @param {{maxChars?:number}} [o]
 */
export function unawareBlock(people, fact, o = {}) {
    try {
        const w = whoKnows(people, fact);
        if (!w.unaware.length) return '';
        const maxChars = Number(o.maxChars) || 400;
        const names = w.unaware.map((x) => x.character);
        let line = '- ' + str(w.fact, 80) + '：由「' + names.join('、') + '」明确不知情（账里有记录），不得让他们表现出知情。';
        if (line.length > maxChars) line = line.slice(0, maxChars) + '…';
        return line;
    } catch (_e) { return ''; }
}

/**
 * 一行总述（含证据：角色数 / 两条计数 / 是否能回答「谁不知道」）。
 * 五态各有各的话；**读不到时绝不说「谁都不知道」**。
 */
export function knowledgeLine(face) {
    const f = face || {};
    const state = KN_REASONS[f.state] ? f.state : 'bridge-absent';
    if (state === 'ok') {
        const cap = f.silentCapable ? '' : '（账里暂无「不知情」记录，一问「谁不知道」只能得到「没记录」）';
        return { state, label: `${f.count} 位角色`, detail: `明确知道 ${f.knownTotal} 条 · 明确不知情 ${f.unawareTotal} 条${cap}` };
    }
    if (state === 'declared-empty') return { state, label: '账里没有认知记录', detail: KN_REASONS['declared-empty'] };
    return { state, label: '取不到', detail: KN_REASONS[state] };
}

export default {
    KN_REASONS,
    knowledgeFace,
    matchFact,
    whoKnows,
    boundaryOf,
    unawareBlock,
    knowledgeLine
};