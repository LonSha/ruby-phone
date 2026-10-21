/* ============================================================
 * config/topic-dossier-contract.js — [v4.42.0 · 第五期 R5-X9 跨书专题夹与带来源的研究成稿]
 *
 * 【本件是纯契约：只做读数与归一，零 DOM 零存储零联网零时钟】
 *   阅读侧已有单书全文找句（`searchBookChunks`）、摘录/批注与研究清单
 *   （`reading-notes-contract.js`）。本件要回答的是**另一问**：
 *   **「围绕一个问题，把三本书里的原句、我的解释、反证组织成一篇可编辑的论证」**
 *   —— 而「这一篇引的是哪本书的哪一段、那一版」必须在**每一段**上可回源。
 *
 * 【修前的缺口（读码可复算，不是推演）】
 *   手机侧全仓零 `dossier` / `专题` 命中：摘录只能挂在**一本书**下面
 *   （`excerpt.bookId`），没有任何一格能表达「这一篇论证跨了哪几本」。
 *   于是「三本书同名人物」在界面上**无法区分**（都叫同一个名字）——
 *   而那正是验收原文点名要治的第一条。
 *
 * 【四件必须分形】
 *   ① **原句**（书里写的）与**我的解释**（我写的）处置相反：
 *      合成一格就等于把批注伪装成原文（验收原文点名）；
 *   ② **引用失效**（书被删 / 改版）与**引用还在**处置相反：
 *      失效了要如实标出来，不许静默丢掉那一段（那会让论证看起来没引过）；
 *   ③ **同名不同书**必须各带各的书与版本 —— 光有名字无法区分；
 *   ④ **未选择的资料不进成稿**：导出只含用户勾过的引用（不做「全库上传」）。
 * ============================================================ */

/** 专题夹面态。 */
export const DOSSIER_STATES = Object.freeze({
    ABSENT: 'absent',        // 还没有这个专题（或读不到）
    EMPTY: 'empty',          // 有专题但还没引任何段落
    READY: 'ready',          // 有可回源的引用
    UNREADABLE: 'unreadable', // 取数抛了
});

/** 单条引用的四态（这是本件真正的判定粒度）。 */
export const REF_STATES = Object.freeze({
    OK: 'ok',                // 书在、版本对得上
    STALE: 'stale',          // 书改版了（指纹变了）⇒ 需重新核对
    GONE: 'gone',            // 书被删了 ⇒ 引用失效
    UNPINNED: 'unpinned',    // 这条引用没记版本 ⇒ 无从比对（需确认）
    UNREADABLE: 'unreadable', // 书在但这次读不到正文 ⇒ 判不了
});

/** 一段的**分栏**（原句 / 我的解释 / 反证 —— 三栏互不相同）。 */
export const REF_COLUMNS = Object.freeze({
    QUOTE: 'quote',          // 书里写的（原句）
    EXPLAIN: 'explain',      // 我写的解释
    COUNTER: 'counter',      // 我写的反证
});

export const DOSSIER_LIMITS = Object.freeze({
    refs: 60,
    books: 24,
    textLen: 2000,
});

/** 读数里**不得出现**的键名（自动结论 / 置信度一族）。 */
export const DOSSIER_FORBIDDEN_KEYS = Object.freeze([
    'conclusion', 'verdict', 'confidence', 'score', 'percent', 'percentage', 'rank', 'weight',
]);

function str(v) { return String(v == null ? '' : v).trim(); }

/**
 * 归一一条引用的**来源坐标**（书名 / 章节 / 版本 / 定位）。
 *   为什么这四样都要：验收原文「导出时带书名/章节/版本/定位」——
 *   少任何一样，导出的成稿就回不到原处。
 */
export function normalizeRefSource(raw) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    return {
        bookId: str(r.bookId),
        bookTitle: str(r.bookTitle || r.title),
        chapter: str(r.chapter),
        contentHash: str(r.contentHash),
        para: (() => {
            const n = Number(r.para);
            return Number.isInteger(n) && n >= 0 ? n : null;
        })(),
        /* 定位串：段号缺失时如实为空（不编一个「第 0 段」）。 */
        locator: (() => {
            const parts = [];
            if (str(r.chapter)) parts.push(str(r.chapter));
            const n = Number(r.para);
            if (Number.isInteger(n) && n >= 0) parts.push('第 ' + String(n + 1) + ' 段');
            return parts.join(' · ');
        })(),
    };
}

/**
 * 一条引用在**当前书架**上的态（本件唯一判定点）。
 *
 * @param {object} ref 引用（含 `bookId` / `contentHash` / `column` / `text`）
 * @param {Map|object} booksById 书 ID → 书（含 `contentHash`；正文缺失即读不到）
 * @returns {{state:string, column:string, source:object, text:string, annotation:string,
 *            why:string, canExport:boolean}}
 */
export function refStateOf(ref, booksById) {
    const r = (ref && typeof ref === 'object') ? ref : {};
    const source = normalizeRefSource(r.source || r);
    const column = Object.values(REF_COLUMNS).indexOf(str(r.column)) >= 0 ? str(r.column) : REF_COLUMNS.QUOTE;
    const text = str(r.text).slice(0, DOSSIER_LIMITS.textLen);
    const annotation = str(r.annotation);
    const base = { state: REF_STATES.UNREADABLE, column: column, source: source, text: text, annotation: annotation, why: '', canExport: false };
    const map = (booksById && typeof booksById === 'object') ? booksById : null;
    if (!map || !source.bookId) {
        return Object.assign({}, base, { state: REF_STATES.UNPINNED, why: '这条引用**没记书名/书 ID** ⇒ 回不到原处（不是「书没了」）' });
    }
    const book = (map instanceof Map) ? map.get(source.bookId) : map[source.bookId];
    if (!book) {
        return Object.assign({}, base, { state: REF_STATES.GONE, why: '「' + (source.bookTitle || source.bookId) + '」已不在书架 ⇒ 这条引用**失效**（照旧列出，不静默丢）' });
    }
    const liveHash = str(book.contentHash);
    if (!source.contentHash) {
        return Object.assign({}, base, { state: REF_STATES.UNPINNED, why: '这条引用**没记版本** ⇒ 无从比对（需确认）' });
    }
    if (liveHash && liveHash !== source.contentHash) {
        return Object.assign({}, base, { state: REF_STATES.STALE, why: '「' + (source.bookTitle || source.bookId) + '」**改版了**（版本对不上）⇒ 需重新核对' });
    }
    /* 书在、版本对得上：正文这次读不到 ⇒ 仍记 unreadable（**不是**「没问题」）。 */
    const chapters = Array.isArray(book.chapters) ? book.chapters : null;
    if (!chapters) {
        return Object.assign({}, base, { state: REF_STATES.UNREADABLE, why: '书在、版本也对，但这次**读不到正文** ⇒ 判不了（不是「没问题」）' });
    }
    return Object.assign({}, base, { state: REF_STATES.OK, canExport: true, why: '' });
}

/**
 * 一次取齐**整个专题夹**的面（本件唯一装配点）。
 *
 * 【★ 同名不同书必须各带各的书与版本】本件**不按名字合并**任何两条引用 ——
 *   三本书里都叫「甲」的三个人，在成稿里必须是三条各带书名的引用。
 *
 * @param {object} input `{ title, refs, booksById, selected }`
 *   · `selected` 只含用户**勾过**的引用 id；导出只认它（未选择的资料不进成稿）。
 * @returns {{state:string, title:string, refs:Array, columns:object, books:Array,
 *            exportable:Array, dropped:Array, line:string, why:string, writesNothing:boolean}}
 */
export function buildTopicDossier(input = {}) {
    const o = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    const base = {
        state: DOSSIER_STATES.ABSENT, title: '', refs: [],
        columns: { quote: [], explain: [], counter: [] },
        books: [], exportable: [], dropped: [],
        line: '', why: '', writesNothing: true,
    };
    if (o.unreadable === true || o.thrown === true) {
        /* ★ 降级路径的 `line` 也要给出来：只给 `why` 会让 `dossierLine(bad)` 落回
         *   EMPTY 那一句（两句相同）—— 而「读不到」与「还没建」处置相反。 */
        const face = Object.assign({}, base, { state: DOSSIER_STATES.UNREADABLE, why: '取数失败（已降级）—— 这是「读不到」，**不是**「还没建这个专题」' });
        face.line = dossierLine(face);
        return face;
    }
    const title = str(o.title);
    const rawRefs = Array.isArray(o.refs) ? o.refs : [];
    if (!rawRefs.length) {
        const face = Object.assign({}, base, { state: DOSSIER_STATES.EMPTY, title: title, why: '这个专题还没有引用任何段落（**不是**「读不到」）' });
        face.line = dossierLine(face);
        return face;
    }
    const refs = rawRefs.slice(0, DOSSIER_LIMITS.refs).map((r) => refStateOf(r, o.booksById));
    const columns = { quote: [], explain: [], counter: [] };
    for (const x of refs) {
        if (columns[x.column]) columns[x.column].push(x);
        else columns.quote.push(x);
    }
    /* 书目：**按书 ID 去重**（不是按书名 —— 同名两本书是两本）。 */
    const books = [];
    const seen = new Set();
    for (const x of refs) {
        if (!x.source.bookId || seen.has(x.source.bookId)) continue;
        seen.add(x.source.bookId);
        books.push({ bookId: x.source.bookId, bookTitle: x.source.bookTitle, contentHash: x.source.contentHash });
        if (books.length >= DOSSIER_LIMITS.books) break;
    }
    /* 导出面：**只含用户勾过的、且仍可回源的**引用。 */
    const sel = Array.isArray(o.selected) ? o.selected.map((x) => str(x)).filter(Boolean) : null;
    const picked = (sel && sel.length) ? refs.filter((x, i) => sel.indexOf(str((rawRefs[i] && rawRefs[i].id) || '')) >= 0) : [];
    const exportable = picked.filter((x) => x.canExport);
    const dropped = picked.filter((x) => !x.canExport)
        .map((x) => ({ state: x.state, source: x.source, why: x.why }));
    const face = Object.assign({}, base, {
        state: DOSSIER_STATES.READY, title: title, refs: refs,
        columns: columns, books: books, exportable: exportable, dropped: dropped,
    });
    face.line = dossierLine(face);
    return face;
}

/** 一行读数（**唯一出处**）。四态分句 + 失效/未选**分开报**。 */
export function dossierLine(face) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f) return '专题夹：读不到';
    if (f.state === DOSSIER_STATES.UNREADABLE) return '专题夹：取数失败（读不到 ≠ 还没建这个专题）';
    if (f.state === DOSSIER_STATES.EMPTY) return '专题夹：还没有引用任何段落';
    const c = f.columns || {};
    const bits = [
        '引 ' + String(f.refs.length) + ' 条',
        '跨 ' + String(f.books.length) + ' 本',
        '原句 ' + String((c.quote || []).length) + ' / 解释 ' + String((c.explain || []).length) + ' / 反证 ' + String((c.counter || []).length),
    ];
    const bad = (f.refs || []).filter((x) => x.state !== REF_STATES.OK);
    if (bad.length) bits.push('**' + String(bad.length) + ' 条回不到原处**（失效/改版/无版本/读不到）');
    if ((f.exportable || []).length) bits.push('可导出 ' + String(f.exportable.length) + ' 条');
    if ((f.dropped || []).length) bits.push('**未进成稿 ' + String(f.dropped.length) + ' 条**（未选或已失效）');
    return '专题夹：' + bits.join(' · ');
}

/**
 * 引用 → 可点的一行（**原句**与**我的解释**必须分栏，且**失效照旧列出**）。
 */
export function dossierRows(face) {
    const f = (face && typeof face === 'object') ? face : null;
    const list = (f && Array.isArray(f.refs)) ? f.refs : [];
    const COL = { quote: '原句', explain: '我的解释', counter: '反证' };
    const TAG = { ok: '可回源', stale: '需重新核对', gone: '**失效**（书已不在）', unpinned: '**无版本**（需确认）', unreadable: '**读不到**（判不了）' };
    return list.map(function (x, i) {
        const src = x.source || {};
        const where = [src.bookTitle || src.bookId || '(未记书)', src.locator || ''].filter(Boolean).join(' · ');
        return {
            index: i, column: x.column, state: x.state,
            line: '【' + (COL[x.column] || x.column) + '】' + (x.text || '(空)') +
                ' —— ' + where + ' · ' + (TAG[x.state] || x.state) +
                (x.annotation ? ' · 批注：' + x.annotation : ''),
        };
    });
}

/**
 * 导出成稿（**只含用户勾过且仍可回源的**）。
 *   三态分句：可以导出 / **一条都没得导**（未选或全失效）/ 读不到。
 */
export function dossierExport(face) {
    const f = (face && typeof face === 'object') ? face : null;
    if (!f) return { ok: false, reason: 'no-face', text: '', line: '判不了（没有这一面）' };
    if (f.state === DOSSIER_STATES.UNREADABLE) {
        return { ok: false, reason: 'unreadable', text: '', line: '不能导出：取数失败（读不到 ≠ 没有内容）' };
    }
    if (f.state === DOSSIER_STATES.EMPTY) {
        return { ok: false, reason: 'empty', text: '', line: '不能导出：这个专题还没有引用任何段落' };
    }
    if (!f.exportable.length) {
        return {
            ok: false, reason: 'nothing-exportable', text: '',
            line: '不能导出：**一条都没得导**（未选或已失效）—— 未选择的资料不进成稿',
        };
    }
    const rows = dossierRows(f).filter((r) => f.exportable.indexOf(f.refs[r.index]) >= 0);
    const head = (f.title ? ('# ' + f.title) : '# 专题');
    const text = head + String.fromCharCode(10) + String.fromCharCode(10) + rows.map((r) => r.line).join(String.fromCharCode(10));
    return {
        ok: true, reason: '', text: text,
        line: '可以导出：' + String(f.exportable.length) + ' 条（每条都带书名/章节/版本/定位；未选择的资料不进成稿）',
    };
}

/** 判据自证（十项）。 */
export function dossierSelfCheck() {
    const problems = [];
    const states = Object.values(DOSSIER_STATES);
    if (new Set(states).size !== states.length) problems.push('专题夹各态必须互不相同');
    const refs = Object.values(REF_STATES);
    if (new Set(refs).size !== refs.length) problems.push('引用各态必须互不相同');
    if (REF_STATES.STALE === REF_STATES.GONE) problems.push('「改版」与「书没了」必须不同形');
    const cols = Object.values(REF_COLUMNS);
    if (new Set(cols).size !== cols.length) problems.push('三栏必须互不相同');

    const books = {
        b1: { contentHash: 'h1', chapters: [{ paragraphs: ['甲走了'] }] },
        b2: { contentHash: 'h2', chapters: [{ paragraphs: ['甲走了'] }] },
    };
    const bmap = new Map(Object.keys(books).map((k) => [k, books[k]]));

    /* 一 ★ 三本书同名人物不混引（各带各的书与版本）。 */
    const same = buildTopicDossier({
        title: '同名人物',
        booksById: bmap,
        refs: [
            { id: 'r1', column: 'quote', text: '甲走了', source: { bookId: 'b1', bookTitle: '书一', contentHash: 'h1', chapter: '第一章', para: 0 } },
            { id: 'r2', column: 'quote', text: '甲走了', source: { bookId: 'b2', bookTitle: '书二', contentHash: 'h2', chapter: '序', para: 0 } },
        ],
    });
    if (same.books.length !== 2) problems.push('★ 同名不同书必须各带各的书（不按名字合并）');
    const rows = dossierRows(same);
    if (rows[0].line === rows[1].line) problems.push('★ 两条引用的读数必须不同（书名不同）');
    if (rows[0].line.indexOf('书一') < 0 || rows[1].line.indexOf('书二') < 0) problems.push('必须点名各自的出处');

    /* 二 ★ 原句与我的解释分栏（批注不伪装原文）。 */
    const mixed = buildTopicDossier({
        booksById: bmap,
        refs: [
            { id: 'q', column: 'quote', text: '原文一句', source: { bookId: 'b1', contentHash: 'h1' } },
            { id: 'e', column: 'explain', text: '我的解释', annotation: '批注' , source: { bookId: 'b1', contentHash: 'h1' } },
            { id: 'c', column: 'counter', text: '反证一句', source: { bookId: 'b1', contentHash: 'h1' } },
        ],
    });
    if (mixed.columns.quote.length !== 1) problems.push('原句栏应 1 条');
    if (mixed.columns.explain.length !== 1) problems.push('解释栏应 1 条');
    if (mixed.columns.counter.length !== 1) problems.push('反证栏应 1 条');
    if (mixed.columns.quote[0].text !== '原文一句') problems.push('原句栏不得混入批注');
    if (mixed.columns.explain[0].text !== '我的解释') problems.push('解释栏只放我写的');

    /* 三 ★ 书被删 / 改版 ⇒ 失效照旧列出（不静默丢）。 */
    const gone = buildTopicDossier({
        booksById: bmap,
        refs: [{ id: 'g', column: 'quote', text: 'x', source: { bookId: 'bX', bookTitle: '删掉的书', contentHash: 'h' } }],
    });
    if (gone.refs.length !== 1) problems.push('★ 书没了也必须照旧列出那一条（不静默丢）');
    if (gone.refs[0].state !== REF_STATES.GONE) problems.push('书没了 ⇒ gone');
    if (gone.refs[0].canExport !== false) problems.push('失效的引用不得导出');
    if (dossierRows(gone)[0].line.indexOf('失效') < 0) problems.push('读数行必须标出失效：' + dossierRows(gone)[0].line);
    const stale = buildTopicDossier({
        booksById: bmap,
        refs: [{ id: 's', column: 'quote', text: 'x', source: { bookId: 'b1', bookTitle: '书一', contentHash: 'OLD' } }],
    });
    if (stale.refs[0].state !== REF_STATES.STALE) problems.push('版本对不上 ⇒ stale');
    if (stale.refs[0].state === gone.refs[0].state) problems.push('★「改版」与「书没了」必须不同形');

    /* 四 无版本 / 读不到 各自成态。 */
    const unpinned = buildTopicDossier({
        booksById: bmap,
        refs: [{ id: 'u', column: 'quote', text: 'x', source: { bookId: 'b1', bookTitle: '书一' } }],
    });
    if (unpinned.refs[0].state !== REF_STATES.UNPINNED) problems.push('没记版本 ⇒ unpinned');
    const noBody = new Map([['b3', { contentHash: 'h3' }]]);
    const unread = buildTopicDossier({
        booksById: noBody,
        refs: [{ id: 'n', column: 'quote', text: 'x', source: { bookId: 'b3', bookTitle: '书三', contentHash: 'h3' } }],
    });
    if (unread.refs[0].state !== REF_STATES.UNREADABLE) problems.push('书在但正文读不到 ⇒ unreadable（不是「没问题」）');
    if (unread.refs[0].state === REF_STATES.OK) problems.push('★ 读不到不得读成「可回源」');

    /* 五 ★ 未选择的资料不进成稿。 */
    const pick = buildTopicDossier({
        title: 'T', booksById: bmap,
        refs: [
            { id: 'a', column: 'quote', text: 'A', source: { bookId: 'b1', contentHash: 'h1' } },
            { id: 'b', column: 'quote', text: 'B', source: { bookId: 'b1', contentHash: 'h1' } },
        ],
        selected: ['a'],
    });
    if (pick.exportable.length !== 1) problems.push('★ 只勾了一条 ⇒ 只有一条可导出');
    const ex = dossierExport(pick);
    if (!ex.ok) problems.push('有可导出的 ⇒ 应可导出');
    if (ex.text.indexOf('A') < 0) problems.push('成稿必须含选中的那条');
    if (ex.text.indexOf('B') >= 0) problems.push('★★ 未选择的资料**不得**进成稿');
    if (ex.line.indexOf('未选择的资料不进成稿') < 0) problems.push('导出读数必须说清这条纪律：' + ex.line);

    /* 六 一条都没得导 ⇒ 拦住，且理由与「读不到」不同形。 */
    const none = buildTopicDossier({
        booksById: bmap,
        refs: [{ id: 'g2', column: 'quote', text: 'x', source: { bookId: 'bX', contentHash: 'h' } }],
        selected: ['g2'],
    });
    const g = dossierExport(none);
    if (g.ok !== false) problems.push('全失效 ⇒ 不许导出');
    if (g.line === dossierExport(buildTopicDossier({ thrown: true })).line) problems.push('★「没得导」与「读不到」必须不同句');
    if (g.line.indexOf('未选择的资料不进成稿') < 0) problems.push('必须点明那条纪律：' + g.line);

    /* 七 导出带书名/章节/版本/定位。 */
    const rich = buildTopicDossier({
        title: '带来源',
        booksById: bmap,
        refs: [{ id: 'r', column: 'quote', text: '一句', source: { bookId: 'b1', bookTitle: '书一', contentHash: 'h1', chapter: '第三章', para: 4 } }],
        selected: ['r'],
    });
    const rt = dossierExport(rich).text;
    for (const need of ['书一', '第三章', '第 5 段']) {
        if (rt.indexOf(need) < 0) problems.push('成稿必须带出处「' + need + '」：' + rt);
    }

    /* 八 空专题与读不到分形。 */
    const empty = buildTopicDossier({ title: 'T' });
    const bad = buildTopicDossier({ thrown: true });
    if (empty.state !== DOSSIER_STATES.EMPTY) problems.push('没引用 ⇒ empty');
    if (bad.state !== DOSSIER_STATES.UNREADABLE) problems.push('取数失败 ⇒ unreadable');
    if (empty.state === bad.state) problems.push('★「还没建」与「读不到」必须不同形');
    if (empty.line === bad.line) problems.push('两者的话也必须不同句');

    /* 九 不产任何自动结论 / 置信度（计划原文「不自动认定研究结论为剧情事实」）。 */
    const sample = JSON.stringify({ a: same, b: mixed, c: gone, d: stale, e: pick, f: rich, g: g });
    for (const k of DOSSIER_FORBIDDEN_KEYS) {
        if (sample.indexOf('"' + k + '"') >= 0) problems.push('读数里不得出现结论/置信度键：' + k);
    }

    /* 十 只读面 + 空件不抛。 */
    if (same.writesNothing !== true) problems.push('本件恒为只读面');
    if (dossierLine(null) !== '专题夹：读不到') problems.push('空面读数必须如实');
    if (dossierRows(null).length !== 0) problems.push('空面不得编出任何行');

    return { problems: problems, states: states.length, refStates: refs.length, columns: cols.length };
}

export default {
    DOSSIER_STATES,
    REF_STATES,
    REF_COLUMNS,
    DOSSIER_LIMITS,
    DOSSIER_FORBIDDEN_KEYS,
    normalizeRefSource,
    refStateOf,
    buildTopicDossier,
    dossierLine,
    dossierRows,
    dossierExport,
    dossierSelfCheck,
};