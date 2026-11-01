/* ========================================================
 * config/vague-recall.js — [v4.110.0 · 第十三期 R13-X2] 模糊回忆：约摸「那阵子」
 * --------------------------------------------------------
 * 【它要治的缺陷：玩家记得的不是关键词】全仓已有全局搜索，它能找**字**：打「搬家」出所有含
 *   「搬家」的行。而玩家的记忆形态是「上次她说下雨那天」—— 里面没有一整个检索词，是**几个
 *   模糊条件叠在一起**。拿它去比字面必然零命中，用户据此得出「手机里没有这段」—— 那是错的。
 *
 * 【本模块做两件事】① `parseVague` 拆成可回源的模糊条件；② `matchRow` 逐条判定，
 *   **每条命中必须交出为什么命中**。归并与自检在 `vague-recall-batch.js`（拆件理由见彼件头注）。
 *   它**不做**：不建索引（读既有引擎已物化的行）、不重排既有搜索结果、不调模型。
 *
 * 【三条纪律】① **命中但说不出为什么 = 没有命中**（模糊检索天生容易「看上去像」，玩家只能靠原因
 *   判断是不是要那一天）；② **代词不许猜**（谁是她只有上下文知道，猜错就是「按不存在的人名
 *   筛出空」那种错，进 `gaps` 说不猜）；③ **相对指代不许切成硬区间**（「上次」没有边界，硬切会让
 *   范围外的记录静默消失，只当排序偏好）。
 *
 * 纯函数，零 IO、零写盘、不碰 DOM。词表在 `vague-recall-terms.js`（拆件理由见彼件头注）。
 * 依赖方向：只引 `num-gate`（口径）与 `search-facets`（时间词表 / 覆盖判定 / 日期口径），
 * **不引 apps/**。
 * ======================================================== */
'use strict';
import { numOrNull } from './num-gate.js';
import { FACET_TIME_WORDS, tokenCoverage, isoOf } from './search-facets.js';
import {
    VAGUE_STATES, VAGUE_WHY_KINDS, WEATHER_WORDS, VAGUE_TIME_WORDS,
    VAGUE_SOFT_TIME, VAGUE_PRONOUNS, VAGUE_LIMITS
} from './vague-recall-terms.js';

function norm(s) { return String(s == null ? '' : s).replace(/\u3000/g, ' ').trim(); }

/**
 * 一句话 → 模糊条件（恒定键面）。
 * @param {string} query
 * @param {{now?:number, knownActors?:string[]}} [opts] `now` 显式传入便于判据确定性复跑；
 *   `knownActors` 是**唯一**认人名来源（缺席即不做人名条件，不猜）。
 */
export function parseVague(query, opts) {
    const o = opts || {};
    const raw = norm(query);
    const gaps = [];
    const out = {
        ok: false, state: VAGUE_STATES.unresolved, raw: raw,
        weatherKinds: [], weatherWords: [],
        from: null, toExcl: null, timeWord: '', softTime: '',
        actor: '', pronoun: '', rest: [], gaps: gaps
    };
    let restText = raw;

    /* ① 天气：长词优先（「雷阵雨」先于「雨」）。先剥「雨」会把「下雨」剥成「下」。 */
    const wsorted = WEATHER_WORDS.slice().sort((a, b) => b.word.length - a.word.length);
    for (const w of wsorted) {
        if (restText.indexOf(w.word) < 0) continue;
        if (out.weatherKinds.indexOf(w.kind) < 0) out.weatherKinds.push(w.kind);
        if (out.weatherWords.indexOf(w.word) < 0) out.weatherWords.push(w.word);
        restText = restText.split(w.word).join(' ');
    }

    /* ② 时间：先认**能切硬区间**的词（模糊表 ∪ search-facets 表，同一份口径），
     *   再认只能当偏好的相对词。长的先认（「前几天」先于「几天」）。 */
    const nowMs = numOrNull(o.now) ?? Date.now();
    const dayTable = Object.assign({}, VAGUE_TIME_WORDS, FACET_TIME_WORDS);
    const dWords = Object.keys(dayTable).filter((w) => typeof dayTable[w] === 'number')
        .sort((a, b) => b.length - a.length);
    for (const w of dWords) {
        if (restText.indexOf(w) < 0) continue;
        const days = dayTable[w];
        out.timeWord = w;
        out.from = isoOf(new Date(nowMs - days * 86400000));
        out.toExcl = isoOf(new Date(nowMs));
        restText = restText.split(w).join(' ');
        break;
    }
    const sWords = VAGUE_SOFT_TIME.slice().sort((a, b) => b.length - a.length);
    for (const w of sWords) {
        if (restText.indexOf(w) < 0) continue;
        out.softTime = w;
        restText = restText.split(w).join(' ');
        /* ★ 这里**不设 from/toExcl** —— 硬切区间会让范围外的记录静默消失。 */
        gaps.push({ kind: 'soft-time', why: '「' + w + '」是相对指代，没切具体区间（只在排序上偏向近期）' });
        break;
    }

    /* ③ 参与人：只从调用方给的 knownActors 认**原名**（最长优先），不猜别号。 */
    const actors = Array.isArray(o.knownActors) ? o.knownActors.map(norm).filter(Boolean) : [];
    const aSorted = actors.slice().sort((a, b) => b.length - a.length);
    for (const a of aSorted) {
        if (restText.indexOf(a) < 0) continue;
        out.actor = a;
        restText = restText.split(a).join(' ');
        break;
    }
    const pSorted = VAGUE_PRONOUNS.slice().sort((a, b) => b.length - a.length);
    for (const p of pSorted) {
        if (raw.indexOf(p) < 0) continue;
        out.pronoun = p;
        restText = restText.split(p).join(' ');
        gaps.push({ kind: 'pronoun', why: '「' + p + '」指谁我不猜 —— 只按其余条件找，你看着对不对' });
        break;
    }
    if (!out.actor && !out.pronoun) {
        gaps.push({ kind: 'no-actor', why: '问句里没认出人物 ⇒ 不做人名条件（不按不存在的人名筛）' });
    }

    /* ④ 语义残余：剩下的话按空白切词，**单字不当条件**（「说」「的」到处都是，等于没筛），
     *   最多 maxRest 个。中文没有词边界，用户连着打的「那天搬家」会是一个整块 ——
     *   这一块的下游判定用 bigram 覆盖率（见 `VAGUE_LIMITS.restCover`），不是连续包含。 */
    out.rest = restText.split(/\s+/).map(norm)
        .filter((t) => t && t.length >= VAGUE_LIMITS.minRestLen)
        .slice(0, VAGUE_LIMITS.maxRest);

    /* ⑤ 可判性：至少一条**能筛**的条件成立。
     *   ★「上次」这类 softTime 不算 —— 它不筛任何东西，只改排序；
     *     若把它当条件，用户只打「上次」就会得到全部记录，而那是假结果。 */
    const hard = out.weatherKinds.length > 0 || !!out.from || !!out.actor || out.rest.length > 0;
    out.ok = hard;
    out.state = hard ? VAGUE_STATES.ok : VAGUE_STATES.unresolved;
    if (!hard) gaps.push({ kind: 'no-condition', why: '没抽出能拿来找的条件（不把「没听懂」当「全都命中」）' });
    return out;
}

/** 一行的全部可检文本（标题 + 正文 + 检索余量 + 摘要 + 天气字段）。读不出即空串。 */
function hayOf(row) {
    const r = (row && typeof row === 'object') ? row : {};
    return [r.title, r.body, r.bodyFull, r.snippet, r.weather]
        .map((x) => String(x == null ? '' : x)).join(' ');
}

/** 一行认得出的天气大类（自带 `weather` 字段 ∪ 文本里的天气词）。**认不出即空数组，不猜**。 */
export function weatherOfRow(row) {
    const r = (row && typeof row === 'object') ? row : {};
    const out = [];
    const own = norm(r.weather);
    if (own) {
        for (const w of WEATHER_WORDS) {
            if (own.indexOf(w.word) >= 0 && out.indexOf(w.kind) < 0) out.push(w.kind);
        }
    }
    const hay = hayOf(r);
    for (const w of WEATHER_WORDS) {
        if (hay.indexOf(w.word) >= 0 && out.indexOf(w.kind) < 0) out.push(w.kind);
    }
    return out;
}

/** 行的时间（毫秒）。`ts` 优先，退 `createdAt`；**读不出即 null**（不给 0）。 */
function tsOf(row) {
    const r = (row && typeof row === 'object') ? row : {};
    const n = numOrNull(r.ts);
    if (n !== null && n > 0) return n;
    const c = Date.parse(String(r.createdAt || ''));
    return Number.isFinite(c) ? c : null;
}

/**
 * 一行是否命中，以及**为什么命中**。
 * @returns {{hit:boolean, why:Array<{kind:string, hit:string, text:string}>}}
 *   ★ 契约：`hit === true` **当且仅当** `why.length > 0`。说不出原因就不算命中。
 *   ★ 实现上的关键一点：**失败分支一律交回空 why**。早先版本把「已攒下的部分因由」留着一起返回，
 *     于是出现「hit:false 却带一条 why」的行 —— 那种行既不算命中、又说得出一半理由，
 *     界面照着 why 排版就会把它渲染成一条「找到了」的记录（本仓最贵的形态：看着没错、结果是错的）。
 *     为什么不做成「部分命中」：部分命中不是命中，而「为什么没算上」由调用方的 gaps 回答，不在这里装。
 */
export function matchRow(row, cond) {
    const c = (cond && typeof cond === 'object') ? cond : null;
    const why = [];
    if (!c || c.ok !== true) return { hit: false, why: [] };
    const r = (row && typeof row === 'object') ? row : {};
    const hay = hayOf(r);

    /* ① 天气是**硬条件**：认得出天气却不是要的那种 ⇒ 排除（用户明确在筛天气）。 */
    if (Array.isArray(c.weatherKinds) && c.weatherKinds.length) {
        const mine = weatherOfRow(r);
        const hit = mine.filter((k) => c.weatherKinds.indexOf(k) >= 0);
        if (!hit.length) return { hit: false, why: [] };
        why.push({ kind: 'weather', hit: hit[0], text: '那天是' + String(c.weatherWords[0] || hit[0]) });
    }

    /* ② 时间：有硬区间时区间外排除；**读不出时间的行不因时间被排除**
     *   （同 `search-facets.matchFacets` 口径：宁可多留一条，不可静默丢一条）。 */
    if (c.from || c.toExcl) {
        const ts = tsOf(r);
        if (ts !== null) {
            const day = isoOf(new Date(ts));
            if (day) {
                if (c.from && day < c.from) return { hit: false, why: [] };
                if (c.toExcl && day >= c.toExcl) return { hit: false, why: [] };
                why.push({ kind: 'time', hit: day, text: day + '（在「' + String(c.timeWord || '') + '」范围里）' });
            }
        }
    }

    /* ③ 参与人：硬条件（只认原名，出现在这段文本里）。 */
    if (c.actor) {
        if (hay.indexOf(c.actor) < 0) return { hit: false, why: [] };
        why.push({ kind: 'actor', hit: c.actor, text: '提到了「' + c.actor + '」' });
    }

    /* ④ 语义残余：宽条件（任一**覆盖够**即算提过），并把命中的是哪个词、盖了几成写出来。
     *   ★ 为什么不是「连续包含」：中文没词边界，用户连打的「那天搬家」在记录里通常不连续。
     *   ★ 为什么阈值是常数而不是打分：本模块只回答「提没提过这件事」，相关性排序归引擎。 */
    if (Array.isArray(c.rest) && c.rest.length) {
        let got = '';
        let cov = null;
        for (const tk of c.rest) {
            const r = tokenCoverage(hay, tk);
            const ratio = (r.total > 0) ? (r.covered / r.total) : 0;
            if (ratio >= VAGUE_LIMITS.restCover) { got = tk; cov = r; break; }
        }
        if (!got) return { hit: false, why: [] };
        why.push({
            kind: 'keyword', hit: got,
            text: '说到「' + got + '」（' + String(cov.covered) + '/' + String(cov.total) + ' 字对上）'
        });
    }
    return { hit: why.length > 0, why: why };
}

/* 批量召回与自检在独立一件（`config/vague-recall-batch.js`），拆件理由见彼件头注。
 * ★ 这里**刻意不转发导出**：转发会造出 `vague-recall ⇄ vague-recall-batch` 的循环依赖，
 *   而循环依赖在 ESM 里不一定当场炸，却会让「谁依赖谁」在下一版无法回答。
 *   调用方按件取：判定取本件，归并/自检取彼件。 */

export default {
    VAGUE_STATES, VAGUE_WHY_KINDS, WEATHER_WORDS, VAGUE_TIME_WORDS, VAGUE_SOFT_TIME,
    VAGUE_PRONOUNS, VAGUE_LIMITS,
    parseVague, weatherOfRow, matchRow
};
