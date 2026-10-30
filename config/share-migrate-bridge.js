/* ============================================================
 * config/share-migrate-bridge.js — [v4.99.8 · R11-X4] 分享与迁移面：形状态翻译 + 审阅口径（纯函数）
 * ------------------------------------------------------------
 * 【这一层治的是什么】
 *   `config/sharing-boundary.js` 与 `config/portable-recovery-hub.js` /
 *   `config/offline-creator-bundle-pipeline.js` 三件内核都写好了、也都被测试逐条消费过，
 *   但**产品端零 import** —— 用户从来没有「分享前先看收件人会看到什么」这个动作，
 *   也从来没有「导入前先看这个包会动哪些键」这个动作。本层把三件内核的结果翻成
 *   产品面直接能渲染的形状，落点是备份台与相册的分享出口。
 *
 * 【为什么必须有一层翻译，而不是 App 直接拼】
 *   ① 三件内核的返回体形状各不相同：`previewRecipientView` 返回 {status, content, reason}，
 *      `inspectBackupPayload` 返回 {ok, version, totalAppScopes, totalEntries, error}，
 *      `validateAndPlanBundleImport` 返回 {success, selectedModules, errors, warnings}。
 *      视图若各写一遍取值，就是**同一口径三份实现**，改内核时三处都要找一遍。
 *   ② 「三态必须不同形」在本面尤其要紧：
 *      · 分享视角：授权可看 ≠ 遮蔽后可看 ≠ 无权看 ≠ 已过期 ≠ 已撤回（**五态**）；
 *      · 迁移体检：包体不认 ≠ 包里没东西 ≠ 包会动 N 个键（**不能都显示成「没有数据」**）；
 *      · 撤销：撤回成功 ≠ 本来就没撤回过 ≠ 撤回后又有人读过（诚实存证，不伪造抹除）。
 *      把它们压成一句，就是本仓治过多次的「看起来没坏但显示不对」。
 *   ③ 档名 / 文案只许一处：本层给 `label`，视图只消费 `label`，不自己写字面量。
 *
 * 【本层刻意不做的事】
 *   · **不判权限**：谁能看由 `previewRecipientView` 判；本层只翻译它的结论。
 *   · **不写存储**：本层是纯函数，没有 storage 句柄，也不 import storage。
 *   · **不改入参**：所有函数返回**新对象**，传入的 draft / payload 一字不动
 *     （分享草案与备份包都是真源，翻译是呈现层的事）。
 *   · **不合并五态**：`MASKED_PARTIAL`（看得到但被遮）与 `AUTHORIZED`（原样看到）
 *     在产品面上是**两句不同的话**，合并等于骗用户「他看到的和你一样」。
 * ============================================================ */
'use strict';
import { ACCESS_STATUS, previewRecipientView, sharingBoundarySelfCheck } from './sharing-boundary.js';
/* 本层**不** import `inspectBackupPayload`：体检是备份台的本业，让它调一次、桥只翻形状。
 *   桥若也持有一份，同一次点击会跑两遍内核（并且那个便捷口在产品端会变成死导出）。 */
import { validateAndPlanBundleImport } from './offline-creator-bundle-pipeline.js';

/** 授权五态的界面文案（**唯一出处**：视图不写这五个字面量）。 */
const ACCESS_LABELS = Object.freeze({
    authorized: '对方可见全文',
    masked_partial: '对方可见（敏感处已遮蔽）',
    unauthorized: '对方看不到（不在受众名单）',
    expired: '对方看不到（分享已过期）',
    revoked: '所有人看不到（已撤回）'
});

/** 授权五态的分组：能在界面「预览到内容」的只有前两态。 */
const ACCESS_READABLE = Object.freeze(['authorized', 'masked_partial']);

/**
 * 授权状态的界面文案。坏值如实念，不回落成「可见」。
 * @param {string} status ACCESS_STATUS 之一（或坏值）
 * @returns {string}
 */
export function accessLabelOf(status) {
    const s = (typeof status === 'string') ? status.trim() : '';
    if (Object.prototype.hasOwnProperty.call(ACCESS_LABELS, s)) return ACCESS_LABELS[s];
    return s ? ('未知授权态「' + s + '」') : '授权态未判';
}

/** 该授权态下「收件人能不能看到内容」—— 只有这个布尔能决定预览区画不画内容。 */
export function accessReadable(status) {
    const s = (typeof status === 'string') ? status.trim() : '';
    return ACCESS_READABLE.indexOf(s) >= 0;
}

/**
 * 收件人视角预览：把内核结论翻成产品面可直接渲染的形状。
 *
 * ★ 关键纪律：`content` 只在 `readable:true` 时才有值 —— 无权/过期/撤回三态
 *   一律 `content:''`，并且 `why` 必须说得出原因（不能只画一行空白让用户猜）。
 *
 * @param {object} draft buildShareDraft 的产物
 * @param {string} viewerId 收件人 id
 * @param {number} [now]
 * @returns {{ok:boolean, status:string, label:string, readable:boolean, content:string,
 *            masked:boolean, reshareable:boolean, why:string, selfCheck:object}}
 */
export function sharePreviewOf(draft, viewerId, now = Date.now()) {
    let raw;
    try {
        raw = previewRecipientView(draft, viewerId, now);
    } catch (e) {
        /* 内核自己抛错 ≠ 无权查看：另立一个状态，界面据此说「判不出来」而不是「看不了」。 */
        return {
            ok: false, status: 'threw', label: '视角判不出来（内核抛错）',
            readable: false, content: '', masked: false, reshareable: false,
            why: String((e && e.message) || e || 'preview_threw'),
            selfCheck: null
        };
    }
    const status = (raw && typeof raw.status === 'string') ? raw.status : '';
    const readable = accessReadable(status);
    const masked = status === ACCESS_STATUS.MASKED_PARTIAL;
    return {
        ok: true,
        status,
        label: accessLabelOf(status),
        readable,
        /* 不可读时**不给内容**（哪怕内核把 content 带了出来）：这是本层的诚实边界。 */
        content: readable ? String((raw && raw.content) || '') : '',
        masked,
        reshareable: readable && raw && raw.reshareable === true,
        why: String((raw && raw.reason) || ''),
        selfCheck: sharingBoundarySelfCheck()
    };
}

/**
 * 分享出口的整行读数：受众名单 / 已读账 / 撤回事实。
 *
 * ★ 「已撤回」与「没撤回过」不同形；「撤回前已有人读过」这件事**必须留痕**
 *   （内核 revokeShare 的契约是「撤回未来访问，不伪造记忆抹除」，本层如实转述）。
 *
 * @param {object} draft
 * @returns {{ok:boolean, audience:string[], readLogs:Array, readCount:number,
 *            revoked:boolean, revokedAt:number|null, revokeReason:string,
 *            line:string}}
 */
export function shareTraceOf(draft) {
    const d = (draft && typeof draft === 'object') ? draft : null;
    if (!d) {
        return {
            ok: false, audience: [], readLogs: [], readCount: 0,
            revoked: false, revokedAt: null, revokeReason: '',
            line: '分享草案读不到（不是「没分享过」）'
        };
    }
    const audience = Array.isArray(d.recipients) ? d.recipients.map((x) => String(x)) : [];
    const readLogs = Array.isArray(d.readLogs) ? d.readLogs.slice() : [];
    const revoked = d.revoked === true;
    const revokedAt = (typeof d.revokedAt === 'number') ? d.revokedAt : null;
    const revokeReason = String(d.revokeReason || '');
    let line;
    if (revoked) {
        line = '已撤回（' + (revokeReason || '未写原因') + '）—— 撤回前已读 ' + String(readLogs.length) + ' 人，这段痕迹不会被抹掉';
    } else if (!audience.length) {
        line = '还没有指定收件人（公开分享以外的范围都发不出去）';
    } else {
        line = '受众 ' + String(audience.length) + ' 人 · 已读 ' + String(readLogs.length) + ' 人';
    }
    return {
        ok: true, audience, readLogs, readCount: readLogs.length,
        revoked, revokedAt, revokeReason, line
    };
}

/**
 * 备份包体检的界面形状：**四态不同形**。
 *   · `missing`   —— 没有包（没选、或宿主还没导出过）；
 *   · `threw`     —— 体检这一步自己坏了（内核抛错，`why` 带原话）；
 *   · `rejected`  —— 有包但不认（内核报错，`why` 如实念，**不说成「包里没东西」**）；
 *   · `ok`        —— 认出来了，给出作用域数 / 条目数 / 版本。
 *
 * ★ 为什么这里**只有翻形状这一支**（没有「调内核」的兄弟函数）：
 *   调用点（备份台）本来就持有 `inspectBackupPayload` 的 import —— 备份包体检是它的本业。
 *   桥若自己也调一遍，等于**同一次点击跑两遍内核**；若桥再提供一个便捷口，那个便捷口
 *   在产品端没人用（等于又造一条「建好了却没人接线」的死导出口，本仓治过多次）。
 *   故分工写死：**调用点调内核拿读数（含 catch 出来的抛错），桥只负责翻形状**。
 *
 * @param {object|null} raw `inspectBackupPayload(payload)` 的返回体；
 *                         内核抛错时由调用点传 `{ ok:false, error:'inspect_threw: <msg>' }`
 * @returns {{state:string, label:string, ok:boolean, version:number|null,
 *            scopes:number, entries:number, why:string}}
 */
/** 「没有包」那一格：与「包是空的」刻意不同形。 */
function _missingInspect() {
    return {
        state: 'missing', label: '还没有包体可体检（不是「包是空的」）',
        ok: false, version: null, scopes: 0, entries: 0, why: 'no-payload'
    };
}

export function payloadInspectFrom(raw) {
    if (!raw || typeof raw !== 'object') return _missingInspect();
    if (raw.ok !== true) {
        const err = String(raw.error || '');
        /* 「体检这一步自己坏了」与「包体不认」是两件事：前者是**我们的代码**出问题，
         *   后者是**这个包**不合法。处置方向相反（前者该报 bug，后者该换包），故不同形。 */
        if (err.indexOf('inspect_threw') === 0) {
            return {
                state: 'threw',
                label: '包体体检失败（内核抛错）：' + (err.slice('inspect_threw'.length + 1) || '未给原因'),
                ok: false, version: null, scopes: 0, entries: 0, why: err
            };
        }
        return {
            state: 'rejected',
            label: '包体不认：' + (err || '未给原因'),
            ok: false, version: null, scopes: 0, entries: 0,
            why: err || 'inspect_failed'
        };
    }
    const scopes = Number(raw.totalAppScopes) || 0;
    const entries = Number(raw.totalEntries) || 0;
    const version = Number(raw.version);
    const verText = String(Number.isFinite(version) ? version : '?');
    return {
        state: 'ok',
        /* 「认出来了但包里一条都没有」与「认不出来」是两件事，文案分开。 */
        label: entries > 0
            ? ('包体 v' + verText + '：' + String(scopes) + ' 个作用域 / ' + String(entries) + ' 条')
            : ('包体 v' + verText + ' 认出来了，但包里一条数据都没有'),
        ok: true,
        version: Number.isFinite(version) ? version : null,
        scopes, entries,
        why: ''
    };
}

/**
 * 创作者包导入计划的审阅形状：**导入前先看清楚会动什么**。
 *
 * ★ 与 `payloadInspectOf` 的分工：那一件看「备份包」，本件看「创作者包」（含主题/规则/
 *   工作包/资产四类）。两者刻意不合并 —— 备份包是数据快照，创作者包是能力包，
 *   混成一个体检口会让用户以为「装主题 = 恢复数据」。
 *
 * @param {object} bundle 创作者包
 * @param {object} selection { modules: string[] }
 * @returns {{state:string, label:string, ok:boolean, blocked:boolean,
 *            modules:string[], errors:Array, warnings:Array, why:string}}
 */
export function bundlePlanOf(bundle, selection) {
    if (!bundle || typeof bundle !== 'object') {
        return {
            state: 'missing', label: '还没有创作者包（不是「包是空的」）',
            ok: false, blocked: true, modules: [], errors: [], warnings: [], why: 'no-bundle'
        };
    }
    let r;
    try {
        r = validateAndPlanBundleImport(bundle, selection || {});
    } catch (e) {
        return {
            state: 'rejected', label: '包计划判不出来（内核抛错）',
            ok: false, blocked: true, modules: [], errors: [],
            warnings: [], why: String((e && e.message) || e || 'plan_threw')
        };
    }
    const errors = Array.isArray(r && r.errors) ? r.errors.slice() : [];
    const warnings = Array.isArray(r && r.warnings) ? r.warnings.slice() : [];
    const modules = Array.isArray(r && r.selectedModules) ? r.selectedModules.slice() : [];
    const ok = !!(r && r.success === true);
    /* 内核禁止的是「包里有可执行脚本」这类**安全阻断**：这类不是「警告」，必须显式挡住。 */
    const blocked = errors.length > 0;
    let label;
    if (!ok) {
        label = '包不能用：' + (errors.length ? String(errors[0].message || errors[0].code || '') : '未给原因');
    } else if (warnings.length) {
        label = '可以装（' + String(modules.length) + ' 类）· ' + String(warnings.length) + ' 项缺依赖提示';
    } else {
        label = '可以装（' + String(modules.length) + ' 类，无缺依赖）';
    }
    return {
        state: ok ? 'ok' : 'rejected',
        label, ok, blocked, modules, errors, warnings,
        why: ok ? '' : String((errors[0] && (errors[0].code || errors[0].message)) || 'refused')
    };
}
