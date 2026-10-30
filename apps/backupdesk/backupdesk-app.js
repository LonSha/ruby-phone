/* ========================================================
 * backupdesk-app.js — [v3.91.0 · 拓展计划 R-X7] 本地备份与恢复 · 落盘与接线
 * 一条会话键走 ^backup_ 前缀随会话隔离：backup_ledger 备份与恢复台账。
 * 判定与计划全在 config/data-backup.js（纯函数），本件只做「读 → 判 → 落 → 渲染」。
 *
 * 【本件刻意不做的事】
 *   · **不联网**：本件没有 fetch / XMLHttpRequest / 外链；备份默认不上传云端。
 *   · **不自己解 JSON**：解析容错走仓内既有实现，本件只把文本交给咽喉。
 *   · **不自己判**：能不能导入 / 冲突怎么算 / 分面能不能换，全由内核判；
 *     本件只把意图交给咽喉（applyBackupAction）—— 重判就是同一口径两份实现。
 *   · **不编辑包体**：本件没有「改包」入口，只有选择 / 预览 / 提交 / 撤销四个动作。
 * ========================================================= */
'use strict';
import { BACKUP_DIM_KEYS, BACKUP_ENTRY_STATES, backupPackLine, backupPlanLine, backupSelfCheck } from '../../config/data-backup.js';
import { BackupdeskView } from './backupdesk-view.js';
/* [v4.96.0 · R11-O3 第二批] 恢复中心内核接到本 App（此前 importers 只有 orchestrator 与 tests，
 *   产品端零消费 ⇒ 那两个方法与这两件内核一起被记死）。为什么接在这里：本 App 已经是
 *   「导出包 → 逐条计划 → 确认提交 → 撤销」的受控恢复面，而**恢复快照**（拍点 / 差异 / 选择性还原）
 *   正是同一件事的另一半 —— 放别处会变成第二个「备份」入口，两份口径各算一次。
 *   ★ 只接内核真身，不搬 orchestrator 的包装方法：内核判，本件只做读写与渲染。 */
import {
    RH_MAX_SNAPSHOTS, normalizeRecoveryState, createSnapshot, computeSnapshotDiff, restoreSnapshot,
} from '../../config/recovery-hub.js';
import { inspectBackupPayload } from '../../config/portable-recovery-hub.js';
/* [v4.99.8 · R11-X4] 分享与迁移面：三件内核（sharing-boundary / portable-recovery-hub /
 *   offline-creator-bundle-pipeline）此前产品端零消费，本版把它们的**形状翻译**收进这一层。
 *   ★ 分工写死：内核判（谁能看 / 包认不认 / 包能不能装），桥只翻形状，本件只读盘与渲染。
 *   ★ 为什么不在这里自己判三态：那会让 missing / rejected / ok 的口径出现第二份实现，
 *     与视图那边各写一遍是同一个病（本仓治过多次）。 */
import { payloadInspectFrom, sharePreviewOf, shareTraceOf, bundlePlanOf } from '../../config/share-migrate-bridge.js';
import { writeReceipt } from '../../config/write-receipt.js';
/* [v4.99.8 · R11-X4] 分享边界内核：谁能看、看得到什么、撤回后留不留痕 —— **全由内核判**。
 *   本件只做三件事：读盘 / 把用户意图转交内核 / 把结果落盘。不写第二份授权判据。 */
import {
    buildShareDraft as kernBuildShareDraft,
    markRecipientRead as kernMarkRecipientRead,
    revokeShare as kernRevokeShare,
    sharingBoundarySelfCheck,
} from '../../config/sharing-boundary.js';
/* 快照台账的键：随会话隔离（模式 /^rh_/ 已在 config/storage.js 收录，keys-audit 已登记）。 */
export const RH_KEY = 'rh_recovery_hub_v1';
/* [v4.99.8 · R11-X4] 分享草案台账的键：**随会话隔离**（分享的是这段会话里的内容；
 *   落全局会让另一个角色看到别人分享给了谁、谁读过 —— 那是串味里最难看的一种）。
 *   模式 /^share_/ 与登记同时加进 config/storage.js 与 scripts/keys-audit.mjs。 */
export const SHARE_KEY = 'share_drafts_v1';

export class BackupdeskApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._dims = {};
        this._onConflict = 'keep';
        this._flash = '';
        this._flashBad = false;
        /* [v4.96.0 · R11-O3 第二批] 恢复快照面的**实例态**：提示行、上次比过的差异、上次体检读数。
         *   三者都是「这一次点出来的东西」，换会话必须丢（上一个会话的差异读数贴到新会话 =
         *   用户会照着一份不属于本段的差异去还原）。台账本体在 rh_recovery_hub_v1 那一格，现取。 */
        this._snapFlash = '';
        this._snapFlashBad = false;
        this._snapDiff = null;
        this._snapInspect = null;
        /* [v4.99.8 · R11-X4] 分享与迁移审阅面的**实例态**：当前选中的草案 id、
         *   当前预览的收件人、提示行。三者都是「这一次点出来的」，换会话必须丢
         *   （上一个会话选中的草案贴到新会话 = 用户会以为自己分享了别人的东西）。
         *   草案本体在 share_drafts_v1 那一格，现取。 */
        this._sharePick = '';
        this._shareViewer = '';
        this._shareFlash = '';
        this._shareFlashBad = false;
        /* [v4.99.8 · R11-X4] 创作者包导入计划的读数（导入前先看清楚会装哪几类、有没有被安全阻断）。
         *   它是「这一次审阅」的产物，换会话必须丢；包体本体不在本件手里（宿主给什么审什么）。 */
        this._bundlePlan = null;
    }
    host() {
        try {
            const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
            return (vp && typeof vp.backupFace === 'function') ? vp.backupFace() : null;
        } catch (_e) { return null; }
    }
    setDim(dim, value) {
        if (BACKUP_DIM_KEYS.indexOf(String(dim)) < 0) return this._dims;
        const cur = Array.isArray(this._dims[dim]) ? this._dims[dim].slice() : [];
        const i = cur.indexOf(String(value));
        if (i >= 0) cur.splice(i, 1); else cur.push(String(value));
        this._dims[dim] = cur;
        this.render();
        return this._dims;
    }
    setConflict(mode) {
        this._onConflict = ['keep', 'overwrite', 'skip'].indexOf(String(mode)) >= 0 ? String(mode) : 'keep';
        this.render();
        return this._onConflict;
    }
    /* ---------- [v4.96.0 · R11-O3 第二批] 恢复快照面（读写在本件，判定全在内核） ---------- */
    /** 读快照台账：**读不出与空台账必须分开**（前者是「读不到」，后者才是「没拍过」）。 */
    _readSnapState() {
        if (!this.storage || typeof this.storage.get !== 'function') {
            return { readable: false, why: 'no_storage', state: normalizeRecoveryState(null) };
        }
        let raw;
        try { raw = this.storage.get(RH_KEY); }
        catch (_e) { return { readable: false, why: 'read_threw', state: normalizeRecoveryState(null) }; }
        if (raw === undefined || raw === null || raw === '') {
            return { readable: true, why: '', state: normalizeRecoveryState(null) };
        }
        let parsed = raw;
        if (typeof raw === 'string') {
            try { parsed = JSON.parse(raw); } catch (_e) { return { readable: false, why: 'bad_json', state: normalizeRecoveryState(null) }; }
        }
        return { readable: true, why: '', state: normalizeRecoveryState(parsed) };
    }
    /** 拍一个恢复点：数据取**当前导出口径的键面读数**（与 export 同一份取数，不另造一份）。 */
    captureSnapshot(label) {
        const host = this.host();
        if (!host || !host.keys || !host.keys.readable) {
            return { ok: false, note: '键面读不到（读不出 ≠ 没有数据），不拍空点' };
        }
        const dataMap = {};
        const rows = [];
        for (const k of (host.keys.chat || [])) rows.push({ key: String(k), scope: 'chat' });
        for (const k of (host.keys.global || [])) rows.push({ key: String(k), scope: 'global' });
        for (const r of rows) {
            try { dataMap[r.scope + '::' + r.key] = this.storage.get(r.key); } catch (_e) { /* 单键读失败不算整面失败 */ }
        }
        const read = this._readSnapState();
        if (!read.readable) return { ok: false, note: '快照台账读不到（' + read.why + '），不敢在它上面加一条' };
        const made = createSnapshot(read.state, label, dataMap);
        const w = writeReceipt(this.storage, RH_KEY, made.state);
        this._snapFlash = w.saved
            ? ('已拍恢复点 ' + String(made.snapshot.keyCount) + ' 键（保留最近 ' + String(RH_MAX_SNAPSHOTS) + ' 个）')
            : ('恢复点没写下去：' + w.why);
        this._snapFlashBad = !w.saved;
        this.render();
        return { ok: w.saved, note: this._snapFlash, snapshot: made.snapshot };
    }
    /** 差异：拿某个恢复点与**当前键面**比，逐键分新增 / 变更 / 移除。 */
    diffSnapshot(snapshotId) {
        const read = this._readSnapState();
        if (!read.readable) return { ok: false, note: '快照台账读不到（' + read.why + '）' };
        const snap = read.state.snapshots[String(snapshotId)];
        if (!snap) return { ok: false, note: '没有这个恢复点' };
        const host = this.host();
        if (!host || !host.keys || !host.keys.readable) return { ok: false, note: '键面读不到，比不了差异' };
        const cur = {};
        for (const k of (host.keys.chat || [])) { try { cur['chat::' + k] = this.storage.get(k); } catch (_e) {} }
        for (const k of (host.keys.global || [])) { try { cur['global::' + k] = this.storage.get(k); } catch (_e) {} }
        const diff = computeSnapshotDiff(snap, cur);
        this._snapDiff = { id: snap.id, label: snap.label, diff: diff };
        this.render();
        return { ok: true, diff: diff };
    }
    /** 选择性还原：只把**选定键**写回（未选的一个字节都不动），写后回读，读不回就报失败。 */
    restoreSnapshotKeys(snapshotId, keys) {
        const read = this._readSnapState();
        if (!read.readable) return { ok: false, note: '快照台账读不到（' + read.why + '）' };
        const snap = read.state.snapshots[String(snapshotId)];
        if (!snap) return { ok: false, note: '没有这个恢复点' };
        const want = Array.isArray(keys) ? keys.filter((k) => typeof k === 'string' && k) : [];
        if (!want.length) return { ok: false, note: '一个键都没选 —— 不还原' };
        const plan = restoreSnapshot(snap, want);
        if (!plan.success) return { ok: false, note: '还原计划没通过：' + String(plan.reason) };
        const bad = [];
        let wrote = 0;
        for (const full of Object.keys(plan.restoredData)) {
            const cut = full.indexOf('::');
            const key = cut >= 0 ? full.slice(cut + 2) : full;
            const w = writeReceipt(this.storage, key, plan.restoredData[full]);
            if (!w.saved) { bad.push(key + '(' + w.why + ')'); continue; }
            wrote += 1;
        }
        /* 写后回读：这一步是本件的诚实边界 —— 「调用落了」不等于「字节进了」。 */
        let backOk = 0;
        for (const full of Object.keys(plan.restoredData)) {
            const cut = full.indexOf('::');
            const key = cut >= 0 ? full.slice(cut + 2) : full;
            if (bad.some((b) => b.startsWith(key + '('))) continue;
            try {
                const got = this._decode(this.storage.get(key));
                if (JSON.stringify(got) === JSON.stringify(plan.restoredData[full])) backOk += 1;
            } catch (_e) { /* 回读失败按未确认 */ }
        }
        this._snapFlash = bad.length
            ? ('还原 ' + String(wrote) + ' 键，' + String(bad.length) + ' 键没写下去：' + bad.slice(0, 3).join('；'))
            : ('还原 ' + String(wrote) + ' 键（回读到 ' + String(backOk) + ' 键）');
        this._snapFlashBad = bad.length > 0;
        this.render();
        return { ok: bad.length === 0, note: this._snapFlash, wrote: wrote, readback: backOk };
    }
    /** 存储里的值可能是字符串（本仓 storage 存字符串）——回读比较前按同一口径解码。 */
    _decode(v) {
        if (typeof v !== 'string') return v;
        try { return JSON.parse(v); } catch (_e) { return v; }
    }
    /** 外部包体检：把「包长什么样」读成读数（不导入、不写盘）。
     *  [v4.99.8 · R11-X4] 四态改由桥翻译：没有包 / 体检自己坏了 / 包体不认 / 认出来了 ——
     *    四句不同的话。内核算一次（抛错也按形状转过去），桥只翻形状
     *    （不再重复调用内核，也不再让视图自己判 state）。 */
    inspectPayload(payload) {
        /* [v4.99.8 · R11-X4] 「没有包」与「体检这一步自己坏了」必须分开（前者没选包，后者是我们
         *   的代码炸了）。catch 到的错误**不吞**，按桥认得的形状转过去（`inspect_threw:` 前缀），
         *   于是桥把它翻成 threw 一态 —— 若这里吞成 null，界面会把「体检坏了」念成「没有包」。 */
        let raw = null;
        if (!payload || typeof payload !== 'object') {
            raw = null;
        } else {
            try { raw = inspectBackupPayload(payload); }
            catch (e) { raw = { ok: false, error: 'inspect_threw: ' + String((e && e.message) || e || 'unknown') }; }
        }
        this._snapInspect = payloadInspectFrom(raw);
        this.render();
        return this._snapInspect;
    }
    /* ---------- [v4.99.8 · R11-X4] 创作者包导入计划（导入前先看清楚会装什么） ----------
     * 【与 inspectPayload 的分工】那一件看「备份包」（数据快照），本件看「创作者包」
     *   （主题 / 规则 / 工作包 / 资产四类能力包）。两者刻意不共用一格读数：
     *   混成一个体检口会让用户以为「装主题 = 恢复数据」。
     * 【内核判什么】包里有没有可执行脚本（安全阻断）、选了节目单但包里没有（缺依赖警告）。
     *   本件只把包与选择转交内核，再把结论交给桥翻形状 —— 不在这里写第二份判据。 */
    planBundle(bundle, selection) {
        this._bundlePlan = bundlePlanOf(bundle, selection);
        this.render();
        return this._bundlePlan;
    }
    /* ---------- [v4.99.8 · R11-X4] 分享与迁移审阅面（读写在本件，判定全在内核） ----------
     * 本面的产品问题：用户把一段内容发出去之前，**看不到收件人会看到什么**；
     *   发出去之后也**撤不回来**（内核早就写好了撤回，但产品端一次都没调用过）。
     * 故本面只做三件事：起草 → 预览收件人视角 → 撤回（并如实留痕）。
     * 三件判据全在 config/sharing-boundary.js；本件只读盘、转交、落盘、归因。 */
    /** 读分享台账：**读不出与空台账必须分开**（前者是「读不到」，后者才是「没起草过」）。 */
    _readShareState() {
        if (!this.storage || typeof this.storage.get !== 'function') {
            return { readable: false, why: 'no_storage', drafts: {} };
        }
        let raw;
        try { raw = this.storage.get(SHARE_KEY); }
        catch (_e) { return { readable: false, why: 'read_threw', drafts: {} }; }
        if (raw === undefined || raw === null || raw === '') {
            return { readable: true, why: '', drafts: {} };
        }
        let parsed = raw;
        if (typeof raw === 'string') {
            try { parsed = JSON.parse(raw); }
            catch (_e) { return { readable: false, why: 'bad_json', drafts: {} }; }
        }
        const drafts = (parsed && typeof parsed === 'object' && parsed.drafts && typeof parsed.drafts === 'object')
            ? parsed.drafts : {};
        return { readable: true, why: '', drafts };
    }
    _writeShareState(drafts) {
        const w = writeReceipt(this.storage, SHARE_KEY, JSON.stringify({ version: 1, drafts }));
        return w;
    }
    /**
     * 起一份分享草案并落盘。
     * 【不放宽的地方】范围/收件人/时效/敏感词的合法性**全由内核判**；
     *   本件不做「范围写错了就默默改成私聊」这种事 —— 内核已经这么做了，重做一遍就是两份口径。
     */
    draftShare(opts) {
        let draft;
        try { draft = kernBuildShareDraft(opts || {}); }
        catch (_e) { return { ok: false, note: '内核拒了这份草案（抛错），不落盘' }; }
        const read = this._readShareState();
        if (!read.readable) return { ok: false, note: '分享台账读不到（' + read.why + '），不敢在它上面加一条' };
        read.drafts[draft.id] = draft;
        const w = this._writeShareState(read.drafts);
        /* ★ 写不下去时**不许**把选中项指向这份草案：它没落盘，下一次读盘就找不到，
         *   界面会显示「选了一份不存在的草案」—— 那正是本仓反复治的「看起来正常」。 */
        this._sharePick = w.saved ? draft.id : '';
        this._shareViewer = '';
        this._shareFlash = w.saved ? ('已起草分享 ' + draft.id + '（' + String((draft.recipients || []).length) + ' 位收件人）') : ('草案没写下去：' + w.why);
        this._shareFlashBad = !w.saved;
        this.render();
        return { ok: w.saved === true, note: this._shareFlash, id: draft.id };
    }
    /** 指定当前预览的收件人（纯视图态：不落盘 —— 换个人看不改变分享本身）。 */
    setShareViewer(viewerId) {
        this._shareViewer = String(viewerId || '');
        this.render();
        return this._shareViewer;
    }
    /** 选中一份草案（纯视图态）。 */
    pickShare(id) {
        this._sharePick = String(id || '');
        this._shareViewer = '';
        this.render();
        return this._sharePick;
    }
    /**
     * 收件人视角预览：**纯读**，不写盘、不记「已读」（读的是「他会看到什么」，不是「他读过了」）。
     * 【也不自己重绘】它是「算一份视角」这件事的唯一实现：`_shareVm`（画那一行）与视图的
     *   收件人动作（点人即算，给一句回执）都从这里取，故本件只算数、不画。若本件也调 render，
     *   点一次人要重绘两遍，且「算读数」与「画读数」的顺序被渲染副作用搅在一起。
     */
    previewShare(id, viewerId) {
        const read = this._readShareState();
        if (!read.readable) return { ok: false, note: '分享台账读不到（' + read.why + '）', preview: null };
        const draft = read.drafts[String(id || this._sharePick || '')];
        if (!draft) return { ok: false, note: '没有这份草案', preview: null };
        const p = sharePreviewOf(draft, viewerId || this._shareViewer, Date.now());
        return { ok: p.ok, note: p.label, preview: p };
    }
    /**
     * 记一次「对方读过了」。
     * 【诚实边界】这一步写盘，故它**不是**预览：预览不该替对方记已读。
     */
    markShareRead(id, readerId) {
        const read = this._readShareState();
        if (!read.readable) return { ok: false, note: '分享台账读不到（' + read.why + '）' };
        const draft = read.drafts[String(id || this._sharePick || '')];
        if (!draft) return { ok: false, note: '没有这份草案' };
        let next;
        try { next = kernMarkRecipientRead(draft, readerId); }
        catch (_e) { return { ok: false, note: '内核拒了这次记读' }; }
        read.drafts[next.id] = next;
        const w = this._writeShareState(read.drafts);
        this._shareFlash = w.saved ? ('已记 ' + String(readerId || '') + ' 读过') : ('记读没写下去：' + w.why);
        this._shareFlashBad = !w.saved;
        this.render();
        return { ok: w.saved === true, note: this._shareFlash };
    }
    /**
     * 撤回一次分享。
     * 【必须留痕的地方】内核的契约是「撤回未来访问，不伪造记忆抹除」——
     *   故撤回后**已读账原样保留**，界面也必须说出来（`shareTraceOf` 那句 line）。
     */
    revokeShare(id, reason) {
        const read = this._readShareState();
        if (!read.readable) return { ok: false, note: '分享台账读不到（' + read.why + '）' };
        const draft = read.drafts[String(id || this._sharePick || '')];
        if (!draft) return { ok: false, note: '没有这份草案' };
        let next;
        try { next = kernRevokeShare(draft, reason); }
        catch (_e) { return { ok: false, note: '内核拒了这次撤回' }; }
        if (!next) return { ok: false, note: '内核拒了这次撤回（草案不可用）' };
        read.drafts[next.id] = next;
        const w = this._writeShareState(read.drafts);
        const trace = shareTraceOf(next);
        this._shareFlash = w.saved ? ('已撤回 · ' + trace.line) : ('撤回没写下去：' + w.why);
        this._shareFlashBad = !w.saved;
        this.render();
        return { ok: w.saved === true, note: this._shareFlash, trace: trace };
    }
    /** 分享面的视图模型：三态（读不到 / 空 / 有草案）分开，预览与痕迹各自成形。 */
    _shareVm() {
        const read = this._readShareState();
        const rows = [];
        if (read.readable) {
            const list = Object.values(read.drafts || {})
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            for (const d of list) {
                const trace = shareTraceOf(d);
                rows.push({
                    id: d.id,
                    pick: d.id === this._sharePick,
                    scope: String(d.scope || ''),
                    audience: trace.audience,
                    readCount: trace.readCount,
                    revoked: trace.revoked,
                    line: trace.line,
                    snippet: String(d.snippet || '').slice(0, 40),
                });
            }
        }
        const picked = read.readable ? (read.drafts[this._sharePick] || null) : null;
        const viewer = this._shareViewer;
        /* ★ 收件人视角只算一遍：走 `previewShare`（本 App 上那件事的唯一实现）。
         *   这里若再调一次 `sharePreviewOf`，「他会看到什么」就有两份口径，
         *   且 `previewShare` 退化成只给判据用的死方法（method-audit 会点名）。
         */
        let preview = null;
        if (picked && viewer) {
            const r = this.previewShare(picked.id, viewer);
            const p = r.preview || {};
            preview = {
                label: r.ok ? p.label : String(r.note || ''),
                readable: p.readable === true,
                content: p.content,
                masked: p.masked === true,
                why: p.why,
                viewer: viewer,
            };
        } else if (picked && !viewer) {
            preview = { label: '还没选收件人 —— 选一个再看他会看到什么', readable: false, content: '', masked: false, why: '', viewer: '' };
        }
        return {
            readable: read.readable,
            why: read.why,
            rows: rows,
            text: read.readable
                ? ('分享草案 ' + String(rows.length) + ' 份')
                : ('分享台账**读不到**（' + String(read.why) + '）—— 这是「读不出」，不是「没分享过」'),
            empty: read.readable && rows.length === 0,
            pick: this._sharePick,
            audience: picked ? (shareTraceOf(picked).audience) : [],
            preview: preview,
            /* [v4.99.8 · R11-X4] 创作者包计划：没审过是 null（不是「可以装」）。
             *   视图据此不画那一行 —— 不画 ≠ 假装没这功能，审过就一定有读数。 */
            bundle: this._bundlePlan ? {
                state: this._bundlePlan.state,
                label: this._bundlePlan.label,
                blocked: this._bundlePlan.blocked,
                modules: (this._bundlePlan.modules || []).slice(),
                warnCount: (this._bundlePlan.warnings || []).length,
            } : null,
            selfCheck: sharingBoundarySelfCheck(),
            flash: this._shareFlash,
            flashBad: this._shareFlashBad,
        };
    }
    async act(action, extra) {
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (!vp || typeof vp.applyBackupAction !== 'function') {
            this._flash = '备份入口不在位（咽喉未就绪）';
            this._flashBad = true;
            this.render();
            return { ok: false, note: this._flash };
        }
        const face = this._displayedFace;
        const scope = face && face.scope;
        const token = face && face.token;
        const payload = Object.assign({ action: action, selection: this._dims, onConflict: this._onConflict, scope: scope, token: token }, extra || {});
        let r;
        try { r = await vp.applyBackupAction(payload); }
        catch (e) { r = { ok: false, note: '执行失败：' + String(e.message || e) }; }
        const now = this.host();
        if (now && (now.token !== token || JSON.stringify(now.scope) !== JSON.stringify(scope))) return r;
        this._flash = String((r && r.note) || '');
        this._flashBad = !(r && r.ok === true);
        this.render();
        return r;
    }
    render() {
        if (!this._view) this._view = new BackupdeskView(this);
        this._view.render(this._vm());
    }
    _vm() {
        const host = this.host();
        this._displayedFace = host;
        const self = backupSelfCheck();
        const plan = host && host.plan ? host.plan : null;
        return {
            scope: host && host.scope ? host.scope : {},
            scopeOk: !!(host && host.scopeState === 'ok'),
            keysText: host ? host.keysText : '键枚举读数还没取到',
            dims: BACKUP_DIM_KEYS,
            dimValues: (host && host.dimValues) || {},
            picked: this._dims,
            onConflict: this._onConflict,
            packLine: host && host.pack ? backupPackLine(host.pack) : '还没有导出任何包',
            planLine: plan ? backupPlanLine(plan, host && host.commit) : '还没有导入计划',
            planRows: plan ? plan.rows.filter((r) => r.state !== BACKUP_ENTRY_STATES.IDENTICAL).slice(0, 40) : [],
            identical: plan ? plan.totals.identical : 0,
            ledger: (host && host.ledger) || { readable: false, entries: [] },
            ledgerText: (host && host.ledger && host.ledger.readable)
                ? ('备份台账 ' + String(host.ledger.entries.length) + ' 条')
                : '备份台账**读不到**（不是「没备份过」—— 这两件事处置相反）',
            undo: host && host.undo ? host.undo : null,
            cloudLine: '默认不上传云端（本面零网络调用）',
            selfCheck: self,
            flash: this._flash, flashBad: this._flashBad,
            /* [v4.96.0 · R11-O3 第二批] 恢复快照面的读数（视图只渲染，判定全在内核与本件的读写口）。 */
            snap: this._snapVm(),
            /* [v4.99.8 · R11-X4] 分享与迁移审阅面（起草 / 收件人视角预览 / 撤回留痕）。 */
            share: this._shareVm(),
        };
    }
    /** 快照面的视图模型：台账读不出与空台账**分两句话**，差异与体检读数各自成形。 */
    _snapVm() {
        const read = this._readSnapState();
        const rows = [];
        if (read.readable) {
            const list = Object.values(read.state.snapshots || {})
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            for (const s of list) {
                rows.push({
                    id: s.id,
                    label: s.label,
                    at: s.createdAt,
                    keyCount: s.keyCount,
                    picked: this._snapDiff && this._snapDiff.id === s.id,
                });
            }
        }
        const d = this._snapDiff;
        return {
            readable: read.readable,
            why: read.why,
            rows: rows,
            text: read.readable
                ? ('恢复点 ' + String(rows.length) + ' 个（上限 ' + String(RH_MAX_SNAPSHOTS) + ' 个，超出按拍点时间挤掉最老的）')
                : ('恢复点**读不到**（' + String(read.why) + '）—— 这是「读不出」，不是「没拍过」'),
            empty: read.readable && rows.length === 0,
            diff: d ? {
                id: d.id, label: d.label,
                count: d.diff.diffCount,
                added: (d.diff.added || []).slice(0, 20),
                modified: (d.diff.modified || []).slice(0, 20),
                removed: (d.diff.removed || []).slice(0, 20),
                line: d.diff.diffCount === 0
                    ? '与当前键面逐键相同（没有可还原的差异）'
                    : ('差异 ' + String(d.diff.diffCount) + ' 键：新增 ' + String((d.diff.added || []).length) +
                        ' / 变更 ' + String((d.diff.modified || []).length) +
                        ' / 移除 ' + String((d.diff.removed || []).length)),
            } : null,
            inspect: this._snapInspect ? {
                /* [v4.99.8 · R11-X4] 三态原样透传：视图只认 state + label，不再自己拼文案
                 *   （原先这里把 ok/error 两格拼成两句话，等于在 App 层又写了一份口径）。 */
                state: this._snapInspect.state,
                ok: this._snapInspect.ok,
                text: this._snapInspect.label,
            } : null,
            flash: this._snapFlash, flashBad: this._snapFlashBad,
        };
    }
    selfCheck() { return backupSelfCheck(); }
    onChatChanged() {
        /* 换会话必须丢**实例态**：选中的范围与提示行（上一个会话的选择不能留着）。 */
        this._dims = {};
        this._flash = '';
        this._flashBad = false;
        /* [v4.96.0] 快照面的实例态同样要丢：差异读数与体检读数都是「这一次点出来的」。 */
        this._snapFlash = '';
        this._snapFlashBad = false;
        this._snapDiff = null;
        this._snapInspect = null;
        /* [v4.99.8 · R11-X4] 分享面的实例态同样要丢：选中的草案、选中的收件人与提示行
         *   都是「这一段会话里点出来的」。留着它们 = 换会话后界面指着别人的分享。 */
        this._sharePick = '';
        this._shareViewer = '';
        this._shareFlash = '';
        this._shareFlashBad = false;
        this._bundlePlan = null;
        this.render();
    }
    destroy() { this._view = null; }
}
