/* ============================================================
 * config/dream-guard.js — [v4.88.0] 空梦拦截与梦上下文块
 * ------------------------------------------------------------
 * 缝合自 zyy0463/dreams（dreams.js:118-190、251，MIT）。
 *
 * ── 源在治什么 ──────────────────────────────────────────
 *   让模型「写一段梦」时，最常见的两种坏产出不是写得差，而是**根本没写**：
 *     · 空话：`梦见了一片黑暗` / `什么也想不起来` / `（无）` —— 字数够但不成立；
 *     · 空串 / 只标点 / 只有「梦」一个字。
 *   源的修法三层：`EMPTY_DREAM_RE` 正则先行拦截 → 正文不足 80 字退回 →
 *   **最多重试两次**。另有一个 `contextBlock`：取 18 小时内最近 2 条，
 *   并显式附上「这是梦，不是现实事件」——这条很关键，否则模型会把梦里
 *   发生的事当成正史写进后续。
 *
 * ── 本件的立场（与源的差异）──────────────────────────────
 *   · 源把三层写在一个采集函数里并连着 LLM 调用；本件只做**判定**与
 *     **上下文拼装**，调用与重试由调用方按 `attempt` 计数推进（纯函数
 *     才能穷举验证「第几次该放弃」）。
 *   · 「空话正则」在源里是若干固定短语；本件按本仓文风补了中文口语变体，
 *     并把正则与长度线**都导出**（调用方/测试读同一份，禁两处各写一遍）。
 *   · 重试上限 2 **不包含首轮**（共 3 次机会）；到顶给 `give-up`，
 *     调用方须如实显示「梦没做出来」而不是拿空文本硬塞。
 *
 * ── 硬边界 ──────────────────────────────────────────────
 *   · 阈值与正则都不做「智能判断」，只做确定性匹配；
 *   · `contextBlock` 空内容返回空串（不产生空块，本仓全部 promptBlock 同规）。
 * ============================================================ */

/** 正文最短字数（源 80）。 */
export const DREAM_MIN_CHARS = 80;
/** 允许的重试次数（源 2，不含首轮）。 */
export const DREAM_MAX_RETRIES = 2;
/** 上下文取数：时间窗与条数（源 18h / 2 条）。 */
export const DREAM_CONTEXT_WINDOW_MS = 18 * 60 * 60 * 1000;
export const DREAM_CONTEXT_MAX = 2;
/* [v4.88.0 · 第七批缝入] 数值取值门（弱口径清零）。 */
import { numOrNull } from './num-gate.js';

/**
 * 空梦短语。**只收「整句就是在说没梦」的形态**，不收「黑暗」「深渊」
 * 这类可以成立的意象（它们更常是有效开头）。
 */
export const EMPTY_DREAM_RE = /^(?:[（(【\[]?\s*(?:无|没有|暂无|空|略|同上|想不起来|记不清|什么都没有)\s*[)）】\]]?|梦见了一片?(?:黑暗|空白)|什么也(?:没|未)(?:有)?(?:梦到)?|一片空白|((?:也)?没(?:有)?做?梦)|(?:梦)?(?:见)?不到(?:任何)?(?:东西|画面))[。.!！~～\s]*$/u;

/** 判定结果状态。 */
export const DREAM_VERDICTS = Object.freeze({
    OK: 'ok',             // 通过
    EMPTY_PHRASE: 'empty-phrase',  // 命中空话正则
    TOO_SHORT: 'too-short',        // 字数不足
    GIVE_UP: 'give-up'    // 已用完重试
});

/** 去空白后的字数（中英一并按字符计，源同）。 */
export function dreamCharCount(text) {
    return String(text ?? '').replace(/\s+/gu, '').length;
}

/** 是否命中空话形态。 */
export function isEmptyDream(text) {
    const t = String(text ?? '').trim();
    if (!t) return true;
    return EMPTY_DREAM_RE.test(t);
}

/**
 * 判定一段梦文本。
 * @param {string} text
 * @param {object} opts {attempt, minChars, maxRetries}
 * @returns {{verdict:string, ok:boolean, retry:boolean, chars:number, attempt:number,
 *            reason:string}}
 *   `retry=true` 表示「还能再来一次」，`verdict:'give-up'` 表示到顶。
 */
export function judgeDreamText(text, opts = {}) {
    const o = opts || {};
    const minChars = Math.max(1, numOrNull(o.minChars) ?? DREAM_MIN_CHARS);
    const maxRetries = Math.max(0, Math.floor(numOrNull(o.maxRetries) ?? DREAM_MAX_RETRIES));
    const attempt = Math.max(0, Math.floor(Number(o.attempt) || 0));
    const chars = dreamCharCount(text);

    const finish = (verdict, reason) => {
        const ok = verdict === DREAM_VERDICTS.OK;
        const canRetry = !ok && attempt < maxRetries;
        return {
            verdict: ok ? DREAM_VERDICTS.OK : (canRetry ? verdict : DREAM_VERDICTS.GIVE_UP),
            ok,
            retry: canRetry,
            chars,
            attempt,
            reason: ok ? '' : (canRetry ? reason : reason + '（已用完 ' + maxRetries + ' 次重试）')
        };
    };

    if (isEmptyDream(text)) return finish(DREAM_VERDICTS.EMPTY_PHRASE, '命中空梦形态');
    if (chars < minChars) return finish(DREAM_VERDICTS.TOO_SHORT, '正文 ' + chars + ' 字 < ' + minChars + ' 字');
    return finish(DREAM_VERDICTS.OK, '');
}

/**
 * 梦上下文块。取时间窗内最近 `max` 条，并在块头声明「这是梦」。
 * @param {Array<{text:string, at:number}>} rows
 * @param {object} opts {now, windowMs, max}
 * @returns {string} 空内容返回 ''
 */
export function dreamContextBlock(rows, opts = {}) {
    const o = opts || {};
    const now = numOrNull(o.now) ?? Date.now();
    const windowMs = Math.max(1, numOrNull(o.windowMs) ?? DREAM_CONTEXT_WINDOW_MS);
    const max = Math.max(1, Math.floor(numOrNull(o.max) ?? DREAM_CONTEXT_MAX));
    const list = Array.isArray(rows) ? rows : [];
    const picked = list
        .filter(r => r && typeof r === 'object' && String(r.text || '').trim())
        .filter(r => {
            const at = Number(r.at);
            return Number.isFinite(at) && (now - at) <= windowMs && at <= now;
        })
        .sort((a, b) => Number(b.at) - Number(a.at))
        .slice(0, max);
    if (!picked.length) return '';
    const lines = picked.map(r => '· ' + String(r.text).trim());
    return '【系统·近期梦境（是梦，不是现实发生过的事）】\n' + lines.join('\n');
}