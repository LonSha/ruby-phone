/**
 * config/consume-once.js — 反向输入「读完即消费」[R26-X2]
 *
 * 缝自 myworld：pullViewer 把投票/投稿交给查看方之后，同一拍里就
 * close_poll() / set_sponsor(status='used')。东西交出去的那一刻就不是「待处理」了。
 * 它的反面才是常态缺陷：拉走看完了，记录还是 fresh，于是同一条能被反复取走。
 *
 * 【本仓的真洞（实测）】
 *   config/sharing-boundary.js 有 markRecipientRead —— 它记「谁看过」，但不消费。
 *   已读不等于已消费，这两件事必须分开；但本仓只有前一半。
 *   没有任何一次性语义，意味着「交给某人的东西」可以被无限次再交出去。
 *
 * 【纪律】
 *   ① preview 永不消费：看一眼就没了的东西没人敢看。消费只发生在「投递」那一下。
 *   ② deliver 严格一次性：第二次必须 already-consumed，且**不许覆盖**首次的
 *      consumedAt / consumedBy（否则「谁消费的」会被后写者篡改）。
 *   ③ copy-on-write：源记录逐字段不动，新记录是新对象。
 *   ④ 过期不是消费：expired 不许伪装成 delivered（否则读数会以为东西交出去了）。
 *   ⑤ 未知模式一律拒载，不许默认按 deliver（会把预览变成一次性）也不许默认 preview。
 */

import { numOrNull } from './num-gate.js';

/** 一次记录在消费面上一共有几种落点。 */
export const CONSUME_STATES = Object.freeze(['fresh', 'delivered', 'expired', 'revoked', 'invalid']);
/** 交互模式闭集。 */
export const CONSUME_MODES = Object.freeze(['preview', 'deliver']);

function str(v) { return String(v == null ? '' : v).trim(); }
function asNum(v, fallback) {
    const n = numOrNull(v);
    return n === null ? fallback : n;
}

/** 模式 -> 语义。未知给 null，由调用方拒载。 */
export function consumeModeOf(mode) {
    const m = str(mode).toLowerCase();
    if (m === 'preview') return { mode: 'preview', consume: false, why: '预览不消费' };
    if (m === 'deliver') return { mode: 'deliver', consume: true, why: '投递即消费' };
    return null;
}

/** 这条记录现在落在哪一态（只读，不改）。传入 now 才能判过期。 */
export function consumeStateOf(record, now = Date.now()) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return 'invalid';
    if (record.revoked === true) return 'revoked';
    const expiresAt = asNum(record.expiresAt, 0);
    if (expiresAt > 0 && now > expiresAt) return 'expired';
    if (asNum(record.consumedAt, 0) > 0) return 'delivered';
    return 'fresh';
}

/**
 * 预览：只读，绝不落 consumedAt。
 * 给出 wouldBe —— 若此刻真投递会得到什么态，让界面能提前说人话。
 */
export function previewOnce(record, opts = {}) {
    const now = asNum(opts.now, Date.now());
    const state = consumeStateOf(record, now);
    return {
        mode: 'preview',
        state: state,
        record: record,
        changed: false,
        wouldBe: state === 'fresh' ? 'delivered' : state,
        reason: state === 'fresh' ? 'preview-does-not-consume' : ('would-be-' + state)
    };
}

/**
 * 投递：本文件唯一会「写」的地方。一次性。
 * 返回新 record（源不动）；已消费的记录再投一次只有 already-consumed，没有第二次内容。
 */
export function deliverOnce(record, opts = {}) {
    const out = { mode: 'deliver', state: 'invalid', record: record, changed: false, reason: 'invalid-record' };
    if (!record || typeof record !== 'object' || Array.isArray(record)) return out;
    const now = asNum(opts.now, Date.now());
    const reader = str(opts.reader);

    if (record.revoked === true) {
        out.state = 'revoked';
        out.reason = 'record-revoked';
        return out;
    }
    const expiresAt = asNum(record.expiresAt, 0);
    if (expiresAt > 0 && now > expiresAt) {
        out.state = 'expired';
        out.reason = 'record-expired';
        return out;
    }
    const already = asNum(record.consumedAt, 0) > 0;
    if (already) {
        out.state = 'delivered';
        out.reason = 'already-consumed';
        return out;
    }

    const next = {};
    for (const k of Object.keys(record)) next[k] = record[k];
    next.consumedAt = now;
    next.consumedBy = reader;
    next.consumeState = 'used';
    out.state = 'delivered';
    out.reason = 'delivered-once';
    out.changed = true;
    out.record = next;
    return out;
}

/**
 * 对拍：消费结果必须同时满足「源没被动过」与「新记录真的带戳」。
 * 这个函数存在的理由：只测「有 consumedAt」会漏掉「顺手改了源」，只测「源没变」会漏掉「根本没写」。
 */
export function verifyConsumeOnce(before, out) {
    const bad = [];
    if (!out || typeof out !== 'object') return { ok: false, bad: ['没有消费结果'] };
    if (out.changed) {
        if (out.record === before) bad.push('消费后仍是同一个对象引用（源被就地改了）');
        if (!(asNum(out.record && out.record.consumedAt, 0) > 0)) bad.push('写成消费了却没落 consumedAt');
        if (asNum(before && before.consumedAt, 0) > 0) bad.push('源记录本来就有 consumedAt，不该再改');
    } else {
        if (asNum(out.record && out.record.consumedAt, 0) !== asNum(before && before.consumedAt, 0)) {
            bad.push('没消费却改了 consumedAt');
        }
    }
    if (out.state === 'expired' && out.reason !== 'record-expired') bad.push('过期落点理由不对');
    if (out.state === 'delivered' && !out.reason) bad.push('投递结果必须带理由');
    return { ok: bad.length === 0, bad: bad };
}

/** 一行读数。 */
export function consumeOnceText(out) {
    if (!out) return '一次性投递：没有结果（没量过）';
    if (out.state === 'invalid') return '一次性投递：**记录无效**';
    if (out.changed) return '一次性投递：已消费（' + (out.record.consumedBy || '匿名') + '）';
    if (out.reason === 'already-consumed') return '一次性投递：**已被取走**（不再发第二次）';
    if (out.state === 'expired') return '一次性投递：已过期（没交出去）';
    if (out.state === 'revoked') return '一次性投递：已撤回';
    if (out.mode === 'preview') return '一次性投递：预览（未消费，投递才会）';
    return '一次性投递：' + (out.state || 'unknown');
}

/** 自检：纯逻辑。 */
export function consumeOnceSelfCheck() {
    const bad = [];
    const base = { id: 'sub_1', text: '一段投稿', expiresAt: 1999999999999 };

    if (consumeModeOf('preview').consume) bad.push('preview 不许消费');
    if (!consumeModeOf('deliver').consume) bad.push('deliver 必须消费');
    if (consumeModeOf('whatever') !== null) bad.push('未知模式必须拒载');

    const pv = previewOnce(base, { now: 1000 });
    if (pv.changed) bad.push('预览改动了记录');
    if (asNum(pv.record.consumedAt, 0) > 0) bad.push('预览落了 consumedAt');
    if (pv.wouldBe !== 'delivered') bad.push('预览应预告投递落点');

    const d1 = deliverOnce(base, { now: 2000, reader: 'a' });
    if (d1.state !== 'delivered' || !d1.changed) bad.push('首次投递应成功');
    if (d1.record === base) bad.push('投递返回了同一个对象引用');
    if (asNum(base.consumedAt, 0) > 0) bad.push('源记录被就地写了');
    if (d1.record.consumedBy !== 'a') bad.push('首次消费人错');
    if (d1.record.consumeState !== 'used') bad.push('消费后应标 used');
    const v1 = verifyConsumeOnce(base, d1);
    if (!v1.ok) bad.push('首次投递对拍不过：' + v1.bad.join('；'));

    const d2 = deliverOnce(d1.record, { now: 3000, reader: 'b' });
    if (d2.changed) bad.push('第二次投递又写了（不一次性）');
    if (d2.reason !== 'already-consumed') bad.push('第二次必须是 already-consumed');
    if (asNum(d2.record.consumedAt, 0) !== 2000) bad.push('被后写者覆盖了首次消费时间');
    if (d2.record.consumedBy !== 'a') bad.push('消费人被后写者篡改');

    const exp = deliverOnce({ id: 'sub_2', expiresAt: 500 }, { now: 1000 });
    if (exp.state !== 'expired') bad.push('过期记录不该判 delivered');
    if (exp.changed) bad.push('过期不许落消费戳');
    const rev = deliverOnce({ id: 'sub_3', revoked: true }, { now: 1000 });
    if (rev.state !== 'revoked') bad.push('撤回记录不许投递');
    if (deliverOnce(null).state !== 'invalid') bad.push('空记录必须判 invalid');
    if (consumeStateOf({ id: 'x' }, 1000) !== 'fresh') bad.push('干净记录应为 fresh');

    return { ok: bad.length === 0, bad: bad };
}

export default {
    CONSUME_STATES, CONSUME_MODES, consumeModeOf, consumeStateOf,
    previewOnce, deliverOnce, verifyConsumeOnce, consumeOnceText, consumeOnceSelfCheck
};
