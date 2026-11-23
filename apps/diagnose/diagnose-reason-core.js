/* ========================================================
 * diagnose-reason-core.js — [v4.192.0] 诊断归因文案 · 纯函数内核
 * --------------------------------------------------------
 * 为什么抽这一层：diagnose-data.js 2980 行里有一族「同一份枚举 => 同一句中文」
 *   的归因表（字段归因 / 桥归因 / 投影缺席 / 桥自述态 / 存档 schema 态），
 *   外加一个存档健康行拼装。它们只碰入参、不读时钟不造随机、不碰 DOM 与
 *   storage，却和 collectDiagnose 那个 1880 行的聚合函数挤在同一个文件里。
 * 本文件只做「同一取值 => 同一句话」，不含任何编排。
 * 口径（不得改动）：未知取值**如实输出原值**，不静默兜底成具体结论 ——
 *   这是 v2.98  clock-view 那次「查不到就走兜底、多种处境显示成同一句话」
 *   学到的教训；空/缺省给 '未知'。
 * 纪律：不取 Date.now / Math.random、不建类、不碰 DOM / localStorage / window。
 * ======================================================== */
'use strict';

/** 字段级归因（上游 readPushField 的 reason 一族）。 */
export const FIELD_REASON_TEXT = Object.freeze({
    value: '有值',
    'declared-null': '上游明说：这面是空',
    absent: '上游明说：源里没这项',
    'legacy-null': '旧版桥：读不出（不硬猜）',
    'legacy-value': '旧版桥：有值',
    'no-snapshot': '无快照'
});

/** 桥归因（bridgeReport 一族）。 */
export const BRIDGE_REASON_TEXT = Object.freeze({
    'not-mounted': '未安装',
    ready: '就绪',
    disabled: '休眠（未开闸）',
    refused: '拒绝读取（未开闸 / 无授权）',
    'no-snapshot': '在但尚无快照',
    'engine-absent': '插件在、记忆引擎未就位',
    'engine-empty': '引擎在位但返回空',
    thrown: '取快照抛错',
    'probe-threw': '探针异常'
});

/** 投影缺席原因（sourceLedger.absent 的 reason）。 */
export const PROJ_ABSENT_TEXT = Object.freeze({
    'no-provider': '上游没注册这个投影的取值器（不是「没有数据」，是这项压根没接）',
    thrown: '上游取值器抛错（读数已降级，原因见上游）',
    skipped: '本会话关掉了这个投影（配置面，不是故障）',
    absent: '上游标为缺席（未给原因）'
});

/** 桥自述态（上游 v3.174 起的 sourceState；键必须是带连字符的字面量）。 */
export const SOURCE_STATE_TEXT = Object.freeze({
    idle: '未开始（尚未取过快照）',
    ready: '就绪（上游说这轮读数可用）',
    'engine-absent': '记忆引擎未就位（桥在，引擎不在）',
    'engine-empty': '引擎在位但返回空（不是故障）',
    thrown: '取值抛错（原因见 lastError）'
});

/** 存档 schema 代次。 */
export const SCHEMA_STATES = Object.freeze({
    current: '当前代',
    legacy: '旧档（本方法只上报，不做迁移）',
    future: '更新版插件写的档（按当前口径读可能误读）',
    unknown: '无从判断（账本缺失或损坏）'
});

/** 查表：命中给文案，未命中如实输出原值（''/null/undefined 给 '未知'）。 */
function lookup(table, key, fallback) {
    if (key === '' || key === null || key === undefined) return fallback;
    const hit = table[key];
    return hit === undefined ? String(key) : hit;
}

/** 字段级归因文案（未知取值如实输出原值）。 */
export function fieldReasonText(reason) {
    return lookup(FIELD_REASON_TEXT, reason, '未知');
}

/** 桥归因文案（未知取值如实输出原值）。 */
export function bridgeReasonText(reason) {
    return lookup(BRIDGE_REASON_TEXT, reason, '未知');
}

/** 投影缺席原因文案（未知取值如实输出原值）。 */
export function projAbsentText(reason) {
    return lookup(PROJ_ABSENT_TEXT, reason, '未知');
}

/** 桥自述态文案（未知取值如实输出原值）。 */
export function sourceStateText(state) {
    return lookup(SOURCE_STATE_TEXT, state, '未知');
}

/** 存档 schema 代次文案（未知取值如实输出原值）。 */
export function schemaStateText(state) {
    return lookup(SCHEMA_STATES, state, '未知');
}

/** 存档健康面一行读数（**不拼结论**：只做单位与分隔，判断归读者）。
 *  本会话档与全局档分列：一边读不出不等于另一边也读不出。 */
export function storageFaceLine(face) {
    const f = face || {};
    if (f.ok !== true) return '存档健康：读不到（' + String(f.reason || 'unknown') + '）';
    const one = (x) => {
        if (!x || x.ok !== true) return '读不到';
        const s = x.schema || {};
        const l = x.ledger || {};
        return schemaStateText(s.state) + ' · 已搬 ' + (l.count || 0) + ' 条键'
            + (l.unparsableAt ? '（其中 ' + l.unparsableAt + ' 条时间戳坏了）' : '');
    };
    return '本会话档：' + one(f.chat) + ' ／ 全局档：' + one(f.global);
}

export default {
    FIELD_REASON_TEXT,
    BRIDGE_REASON_TEXT,
    PROJ_ABSENT_TEXT,
    SOURCE_STATE_TEXT,
    SCHEMA_STATES,
    fieldReasonText,
    bridgeReasonText,
    projAbsentText,
    sourceStateText,
    schemaStateText,
    storageFaceLine
};