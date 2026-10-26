/* ========================================================
 * config/source-permission.js —— 世界书来源许可（按书名排除）
 * --------------------------------------------------------
 * 缝合自 ST-MyriadKnots/src/source-permission.js（2000 书 / 1200 字双上限、
 *   NFKD 去重音 + 简中小写规范化、`world::uid` 键与 locator 回退、
 *   非 worldbook 直通、inspect 前后身份比对判 stale）。
 *
 * 【修前本仓是什么样（实测，不是推测）】
 *   `config/worldbook-manager.js` 的「注入哪几本」只有一个布尔开关**按 App** 开合：
 *   `getEnabled('wechat')` 一开，`_loadSelectedWorldbookSources()` 就把选中的书**全量**
 *   拼进注入。于是：
 *     · 玩一张大卡时世界书里那几本「另一套世界观的设定集」（同一份库里混着现代的与仙侠的）
 *       只要被勾过就一直在场，模型每轮都被另一套设定污染；
 *     · 用户想「这本先别用」只有两条路：① 取消整本勾选 —— 连它在这个 App 里一起没了，
 *       下次要用得重新勾；② 关掉整个 App 的注入 —— 把另外几本也一起关掉。
 *   **没有「这一本在这个 App 里排除掉」这一格**。这正是源里 `excludedBooks` 的位置。
 *
 * 【本件给什么（逐条对应源，不是重写）】
 *   · `excludedBooks` 是书名集合，规范化是 **NFKD 去重音 + 小写**，最大化匹配面：
 *     `Tomb_Raider` 与全角同名、`Émile` 与 `Emile` 同键；
 *   · 双上限：书 2000 本 / 单名 1200 字 —— 超限**截断而不是拒收**（拒收会让一条脏名
 *     把整张排除表作废）；空名与超长名直接剔掉（它们永远匹配不上任何一本书）；
 *   · 键优先 `world::uid`，没有就退 `locator`（`locator.lastIndexOf(':')` 切两段）——
 *     条目级排除要的是「哪本书的哪条」，不是展示名；
 *   · **非 worldbook 的候选一律直通**：候选面里将来若混进别的来源（记忆 / 日程），
 *     它们没有书名，不该被书名表误杀；
 *   · 书名为空的世界书候选**也不放行**（认不出是哪本就没法判许可，宁可如实排除）；
 *   · `hostEnabled === false` / `availability === 'disabled'` 也排除 —— 宿主已标禁用，
 *     这里再放行等于把宿主的结论推翻。
 *
 * 【本仓差异（照抄会坏的地方）】
 *   · 源把设置读写交给宿主 settings 对象（`settings.get/update`）；本仓的设置在
 *     `WorldbookManager` 的 storage 上（`phone_worldbook_excluded_*` 一族键），
 *     故本件**只做纯函数**，读写口留在 manager —— 纯件的可测性完全靠「无 IO」。
 *   · 源的 `settings.setSharedWorldInfoExcluded` 是跨来源共享的设置口；本仓没有共享层，
 *     故只有本机一份表（键归属已在 keys 门禁登记）。
 *   · 源的 `inspectCurrent` 带宿主身份比对；本仓身份在 manager（`_getCharacterScopeKey`），
 *     故本件把「前后身份是否一致」收成一个纯函数 `inspectVerdict`，比对动作留在 manager。
 *
 * 【纪律】
 *   ① 纯函数：**零 import**、不读 window / storage、不看时钟、不发请求（故可 data: URL 装载副本做负控制）；
 *   ② 不抛：畸形输入（null / 数组 / 数字 / Symbol）一律降级成空表或直通，绝不因排除表坏掉而吞掉注入；
 *   ③ 不猜：认不出是哪本书的 worldbook 候选**排除**（不是放行），并在归因里说清是哪一条。
 * ======================================================== */
'use strict';

/** 双上限（源值，不放开）。超限截断，不拒收。 */
export const SOURCE_PERMISSION_LIMITS = Object.freeze({
    excludedBooks: 2000,
    keyCharacters: 1200
});

/** 规范化：NFKD 去重音 + 小写。**只用于判等**，写回一律用原文。 */
export function canonicalBookName(value) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (!text) return '';
    return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * 归一排除表：去空、去超长、去重、截断。
 * @param {*} value 上游原值（可能是 null / 数组 / 单个字符串 / 数字）
 * @returns {string[]} 原文数组（顺序按首次出现，去重按规范化键）
 */
export function normalizeExcludedBooks(value) {
    const list = Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        if (typeof raw !== 'string') continue;
        const text = raw.trim();
        if (!text) continue;
        if (text.length > SOURCE_PERMISSION_LIMITS.keyCharacters) continue;
        const key = canonicalBookName(text);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(text);
        if (out.length >= SOURCE_PERMISSION_LIMITS.excludedBooks) break;
    }
    return out;
}

/** 候选的许可键：`permissionKey` 直给优先；否则 `world::uid`；再否则从 `locator` 末段切。 */
export function permissionKeyOf(candidate) {
    const one = candidate && typeof candidate === 'object' ? candidate : {};
    const explicit = typeof one.permissionKey === 'string' ? one.permissionKey.trim() : '';
    if (explicit) return explicit;
    const world = typeof one.world === 'string' ? one.world.trim() : '';
    const uid = typeof one.uid === 'string' ? one.uid.trim() : '';
    if (world && uid) return world + '::' + uid;
    const locator = typeof one.locator === 'string' ? one.locator.trim() : '';
    const split = locator.lastIndexOf(':');
    return split > 0 ? locator.slice(0, split) + '::' + locator.slice(split + 1) : '';
}

/** 候选归属的书名：`world` 直给优先，否则从许可键里切掉 `::` 之后那半。 */
export function bookNameOf(candidate) {
    const one = candidate && typeof candidate === 'object' ? candidate : {};
    const world = typeof one.world === 'string' ? one.world.trim() : '';
    if (world) return world;
    const key = permissionKeyOf(one);
    const split = key.lastIndexOf('::');
    return split > 0 ? key.slice(0, split) : '';
}

/** 宿主是否已标它禁用（两处口径同族，任一处说禁用即禁用）。 */
export function candidateHostEnabled(candidate) {
    const one = candidate && typeof candidate === 'object' ? candidate : {};
    return one.hostEnabled !== false && one.availability !== 'disabled';
}

/**
 * 按许可过滤候选。归因逐条留下（不是为了日志好看 —— 是为了「排除了几条、为什么」可答）。
 * @param {{candidates?:Array, excludedBooks?:Array}} input
 * @returns {{kept:Array, dropped:Array, excluded:Set<string>}} dropped 每条带 reason
 */
export function filterSourcesByPermission(input) {
    const one = input && typeof input === 'object' ? input : {};
    const list = Array.isArray(one.candidates) ? one.candidates : [];
    const excluded = new Set(normalizeExcludedBooks(one.excludedBooks).map(canonicalBookName));
    const kept = [];
    const dropped = [];
    for (const candidate of list) {
        const item = candidate && typeof candidate === 'object' ? candidate : null;
        if (!item) {
            dropped.push({ candidate: candidate, reason: 'not-object', book: '' });
            continue;
        }
        /* ★ 非 worldbook 直通：它们没有书名，不该被书名表误杀。 */
        if (item.kind !== 'worldbook') {
            kept.push(item);
            continue;
        }
        const book = bookNameOf(item);
        if (!book) {
            /* 认不出是哪本书 ⇒ 没法判许可 ⇒ 如实排除（不是放行）。 */
            dropped.push({ candidate: item, reason: 'no-book', book: '' });
            continue;
        }
        if (!candidateHostEnabled(item)) {
            dropped.push({ candidate: item, reason: 'host-disabled', book: book });
            continue;
        }
        if (excluded.has(canonicalBookName(book))) {
            dropped.push({ candidate: item, reason: 'excluded-book', book: book });
            continue;
        }
        kept.push(item);
    }
    return { kept: kept, dropped: dropped, excluded: excluded };
}

/**
 * 书名清单过滤（inspect 用）：只认书名，不做 kind 判断。
 * 空表直通 —— 一次都不必花。
 */
export function filterBookNamesByPermission(input) {
    const one = input && typeof input === 'object' ? input : {};
    const list = Array.isArray(one.bookNames) ? one.bookNames : [];
    const excluded = new Set(normalizeExcludedBooks(one.excludedBooks).map(canonicalBookName));
    if (!excluded.size) return list.slice();
    return list.filter((name) => {
        if (typeof name !== 'string') return false;
        const text = name.trim();
        return Boolean(text) && !excluded.has(canonicalBookName(text));
    });
}

/** 一行读数：三态分列（留下 n / 按书名排除 n / 宿主已禁用 n），不压成「过滤了 n 条」。 */
export function sourcePermissionLine(result) {
    if (!result || typeof result !== 'object') return '来源许可：无读数';
    const dropped = Array.isArray(result.dropped) ? result.dropped : [];
    const byReason = (r) => dropped.filter((d) => d.reason === r).length;
    const parts = [
        '留下 ' + (Array.isArray(result.kept) ? result.kept.length : 0),
        '按书名排除 ' + byReason('excluded-book'),
        '宿主已禁用 ' + byReason('host-disabled')
    ];
    if (byReason('no-book')) parts.push('认不出书名未放行 ' + byReason('no-book'));
    if (byReason('not-object')) parts.push('畸形候选 ' + byReason('not-object'));
    return '来源许可：' + parts.join(' · ');
}

/**
 * 去重（inspect 的书单用）：规范化后去重，保留首次出现的原文。
 * 源里这段写在 inspect 内部；本件提出来的理由是它**有自己的判据面**
 * （`Émile` 与 `Emile`、全角与半角必须同键），埋在 inspect 里就只能靠真宿主验。
 */
export function dedupeBookNames(names) {
    const list = Array.isArray(names) ? names : [];
    const seen = new Set();
    const out = [];
    for (const name of list) {
        if (typeof name !== 'string') continue;
        const text = name.trim();
        if (!text) continue;
        const key = canonicalBookName(text);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(text);
    }
    return out;
}

/**
 * inspect 的身份比对：拉书单是异步的，拉的过程中用户可能换会话。
 *   两段身份任一不同即 `stale` —— 那份书单属于上一个会话，直接渲染会让用户在 A 会话看到 B 会话的书。
 *   「判 stale」而不是「重拉一次」：重拉仍可能在重拉过程中再换，循环没有终点；
 *   交回调用方一句「过期了，请重进」才是有限的。
 */
export function inspectVerdict(start, end) {
    const a = start && typeof start === 'object' ? start : {};
    const b = end && typeof end === 'object' ? end : {};
    const aChat = typeof a.chatId === 'string' ? a.chatId : '';
    const bChat = typeof b.chatId === 'string' ? b.chatId : '';
    const aHost = typeof a.hostChatId === 'string' ? a.hostChatId : '';
    const bHost = typeof b.hostChatId === 'string' ? b.hostChatId : '';
    if (!aChat || !bChat) return { status: 'stale', reason: 'no-chat-id' };
    if (aChat !== bChat) return { status: 'stale', reason: 'chat-changed' };
    if (aHost !== bHost) return { status: 'stale', reason: 'host-chat-changed' };
    return { status: 'ready', reason: '' };
}

/** 自检：本件全部口径在同一次调用里两向自证（既证「该排的排掉了」也证「该通的通得过」）。 */
export function sourcePermissionSelfCheck() {
    const problems = [];
    const push = (ok, msg) => { if (!ok) problems.push(msg); };
    /* ① 规范化两向：全角 / 重音 / 大小写同键，且不吞内容 */
    push(canonicalBookName('ＴＯＭＢ') === canonicalBookName('tomb'), '全角与大写必须同键');
    push(canonicalBookName('Émile') === canonicalBookName('Emile'), '重音必须去掉后同键');
    push(canonicalBookName('  海 边  ') === canonicalBookName('海 边'), '首尾空白必须同键');
    push(canonicalBookName('a b') !== canonicalBookName('ab'), '中间空白不得被吃');
    /* ② 排除表归一：去空、去重、截断、超长剔 */
    const norm = normalizeExcludedBooks(['A', '', ' a ', null, 7, 'x'.repeat(1300), 'B']);
    push(norm.length === 2, '空/重复/非字符串必须剔，短名保留，实得 ' + norm.length);
    push(norm[0] === 'A' && norm[1] === 'B', '首次出现的原文必须保留');
    const many = normalizeExcludedBooks(Array.from({ length: 2100 }, (_, i) => 'b' + i));
    push(many.length === SOURCE_PERMISSION_LIMITS.excludedBooks, '书数必须截断到上限，实得 ' + many.length);
    /* ③ 许可键与书名：直给优先 / world::uid / locator 回退 */
    push(permissionKeyOf({ permissionKey: 'x::1' }) === 'x::1', 'permissionKey 必须直给优先');
    push(permissionKeyOf({ world: 'w', uid: '3' }) === 'w::3', 'world::uid 形态必须成立');
    push(permissionKeyOf({ locator: 'file:9:u' }) === 'file:9::u', 'locator 必须按末段切');
    push(bookNameOf({ locator: 'file:9:u' }) === 'file:9', '书名必须能从 locator 回退');
    /* ④ 过滤：排除命中、非 worldbook 直通、认不出书名排除、宿主禁用排除 */
    const res = filterSourcesByPermission({
        excludedBooks: ['Bad Book'],
        candidates: [
            { kind: 'worldbook', world: 'Bad Book' },
            { kind: 'worldbook', world: 'Good Book' },
            { kind: 'memory', world: 'Bad Book' },
            { kind: 'worldbook' },
            { kind: 'worldbook', world: 'Off Book', hostEnabled: false },
            { kind: 'worldbook', world: 'Off2', availability: 'disabled' },
            null
        ]
    });
    push(res.kept.length === 2, '只该留下 Good Book 与 memory 那条，实得 ' + res.kept.length);
    const reasons = res.dropped.map((d) => d.reason).join(',');
    push(reasons.includes('excluded-book'), '排除命中必须留因');
    push(reasons.includes('no-book'), '认不出书名必须留因');
    push(reasons.includes('host-disabled'), '宿主禁用必须留因');
    push(reasons.includes('not-object'), '畸形候选必须留因');
    push(res.kept.some((c) => c.kind === 'memory'), '非 worldbook 必须直通');
    /* ⑤ 空表直通、书名过滤去重、读数不说谎 */
    const pass = filterSourcesByPermission({ candidates: [{ kind: 'worldbook', world: 'X' }] });
    push(pass.kept.length === 1 && pass.dropped.length === 0, '空表必须全通');
    const names = filterBookNamesByPermission({ bookNames: ['A', 'a', 'B'], excludedBooks: ['B'] });
    push(names.length === 2 && names[0] === 'A' && names[1] === 'a', '书名过滤按规范化排除，实得 ' + names.join('/'));
    push(dedupeBookNames(['X', 'x', '', 'Y']).length === 2, 'dedupe 必须按规范化去重');
    push(sourcePermissionLine(res).includes('按书名排除 1'), '读数必须报出排除数');
    /* ⑥ inspect 判定两向：同身份 ready，换会话 / 换宿主 / 缺号 stale */
    push(inspectVerdict({ chatId: 'c1', hostChatId: 'h1' }, { chatId: 'c1', hostChatId: 'h1' }).status === 'ready', '同身份必须 ready');
    push(inspectVerdict({ chatId: 'c1' }, { chatId: 'c2' }).reason === 'chat-changed', '换会话必须 stale 且说因');
    push(inspectVerdict({ chatId: 'c1', hostChatId: 'h1' }, { chatId: 'c1', hostChatId: 'h2' }).reason === 'host-chat-changed', '换宿主必须 stale 且说因');
    push(inspectVerdict({}, { chatId: 'c1' }).reason === 'no-chat-id', '缺会话号必须 stale 且说因');
    /* ⑦ 不抛：畸形输入 */
    let threw = false;
    try {
        filterSourcesByPermission(null);
        filterSourcesByPermission({ candidates: 'x', excludedBooks: 3 });
        canonicalBookName(Symbol('s'));
        sourcePermissionLine(null);
        dedupeBookNames(null);
        inspectVerdict(null, null);
    } catch (_e) { threw = true; }
    push(!threw, '畸形输入不得抛');
    return { ok: problems.length === 0, problems: problems };
}

export default {
    SOURCE_PERMISSION_LIMITS, canonicalBookName, normalizeExcludedBooks, permissionKeyOf,
    bookNameOf, candidateHostEnabled, filterSourcesByPermission, filterBookNamesByPermission,
    sourcePermissionLine, dedupeBookNames, inspectVerdict, sourcePermissionSelfCheck
};