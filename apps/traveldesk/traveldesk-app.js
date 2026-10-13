/* ========================================================
 * traveldesk-app.js — [v3.54.0] 旅行记账案头 · 落盘与接线
 * 两条会话键走 ^tv_ 前缀随会话隔离：tv_book 账本（人/家庭/费用） / tv_ledger 台账。
 * 源挂 AppState.data.travelData 并满篇 DOM 渲染与 confirm，本件零 DOM。
 * ======================================================== */
'use strict';
import {
    TV_LEDGER_MAX, TV_PEOPLE_MAX, TV_EPSILON, TV_CURRENCY_SYMBOLS, toCNY, balancesOf, consolidateFamilies,
    internalSettlement, externalSettlement, normalizeExpenses, normalizeExpense, readingsOf, trimRows, listOf, toStr, isPlain
} from './traveldesk-data.js';
import { TraveldeskView } from './traveldesk-view.js';
import { writeReceipt } from '../../config/write-receipt.js';
/* [v4.03.0 · R3-X6] 协作行程板内核:归一 / 参加者判定 / 读数(预计与实际分列) /
 *   生成支出(幂等) / 建议。**全部纯函数**,本件只负责落盘与把动作派给内核。 */
import {
    normalizeParty, partyReadings, commitCosts, proposedPeople, partyAdvice,
    normalizeMember, normalizeStop, normalizeTask, normalizeCheck, normalizeCost,
    TVP_MEMBER_STATES, TVP_COST_STATES
} from './traveldesk-plan.js';

export const TV_BOOK_KEY = 'tv_book';
export const TV_LEDGER_KEY = 'tv_ledger';
/* [v4.03.0 · R3-X6] 行程板:成员邀请三态 / 地点顺序 / 分工 / 准备清单 / 共同费用(预计与实际两态)。
 *   ★ 与 tv_book **分开存**:账本是「钱怎么算」,行程板是「人怎么去」——
 *     两者的生命周期不同(改期要改行程但不动历史支出),混一格会让改期顺手改到钱。 */
export const TV_PARTY_KEY = 'tv_party';

export class TraveldeskApp {
    constructor(shell, storage) {
        this.shell = shell || null;
        this.storage = storage || null;
        this._view = null;
        this._people = [];
        this._families = [];
        this._expenses = [];
        this._lastSummary = null;
        this._lastQuote = null;
        this._ledger = [];
        this._dropped = 0;
        /* [v3.66.0 · X2] 跨 App 定位到的费用 id（'' = 没有定位态）。
         *   ★ 存 **id** 不存下标：本仓曲库那件正是按数组下标定位详情态，
         *     删中间项后详情会串到别的一条头上（不报错、只串项）。
         *     费用 id 由 `normalizeExpense` 派生的 `tv_e_<下标>` 兜底，
         *     但**用户/上游给了 id 就以它为准** —— 故这里一律按 id 找。 */
        this._focus = '';
        /* [v4.03.0 · R3-X6] 行程板实例态。
         *   ★ 板子本身在 tv_party 那一格(随会话隔离),下面三项是**实例态**:
         *     归一后的拒绝清单 / 裁边计数 / 上一次动作回报 —— 换会话必须丢,
         *     否则新会话会带着上一段的「拒了 3 条」旧读数(与 taskentry 的 dropped 同一形态)。 */
        this._party = null;
        this._partyRejected = [];
        this._partyDropped = {};
    }
    _readRaw(key) {
        if (!this.storage || typeof this.storage.get !== 'function') return { ok: false, why: 'no_api', value: undefined };
        let v;
        try { v = this.storage.get(key, undefined); }
        catch (e) { return { ok: false, why: 'read_threw', value: undefined }; }
        if (v === undefined || v === null || v === '') return { ok: true, why: 'absent', value: undefined };
        return { ok: true, why: 'present', value: v };
    }
    _writeRaw(key, value) {
        if (!this.storage || typeof this.storage.set !== 'function') return { saved: false, why: 'no_api' };
        try {
            /* [v3.58.0 · 计划 O5] 写回执走唯一实现：真 PhoneStorage.set 是 async，
             *   把它的返回值当同步布尔读会让 saved 恒假（见 config/write-receipt.js 头注）。 */
            return writeReceipt(this.storage, key, value);
        } catch (e) {
            return { saved: false, why: 'write_threw' };
        }
    }
    _log(action, detail) {
        const entry = { at: Date.now(), action: toStr(action), detail: toStr(detail) };
        const trimmed = trimRows([entry].concat(this._ledger), TV_LEDGER_MAX);
        this._dropped += trimmed.dropped;
        this._ledger = trimmed.rows;
        this._writeRaw(TV_LEDGER_KEY, this._ledger);
    }
    _probe() {
        const b = this._readRaw(TV_BOOK_KEY);
        const book = (b.ok && b.why === 'present' && isPlain(b.value)) ? b.value : {};
        this._people = listOf(book.people).slice(0, TV_PEOPLE_MAX);
        this._families = listOf(book.families);
        this._expenses = listOf(book.expenses);
        const l = this._readRaw(TV_LEDGER_KEY);
        this._ledger = (l.ok && l.why === 'present' && Array.isArray(l.value)) ? l.value : [];
        /* [v4.03.0 · R3-X6] 行程板:**读不出与空分开** ——
         *   读不出(没有 storage API / 抛错)⇒ 板子保持 null,视图说「还没取到」,
         *   不假装「这一板是空的」(空板与读不到在界面上同形是会骗人的)。 */
        const pr = this._readPartyRaw();
        if (pr === null) { this._party = null; this._partyRejected = []; this._partyDropped = {}; }
        else {
            const norm = normalizeParty(pr, { fallbackId: 'party' });
            this._party = norm.party; this._partyRejected = norm.rejected; this._partyDropped = norm.dropped;
        }
    }
    intakeBook(rawText) {
        let parsed = null;
        try { parsed = JSON.parse(toStr(rawText)); } catch (e) { return { ok: false, why: 'bad_json', saved: false }; }
        const book = isPlain(parsed) ? parsed : {};
        this._people = listOf(book.people).slice(0, TV_PEOPLE_MAX);
        this._families = listOf(book.families);
        const norm = normalizeExpenses(book.expenses, this._people);
        this._expenses = norm.expenses;
        const w = this._writeRaw(TV_BOOK_KEY, { people: this._people, families: this._families, expenses: this._expenses });
        this._log('intake_book', 'people=' + String(this._people.length) + ' expenses=' + String(this._expenses.length) + ' saved=' + String(w.saved === true));
        return { ok: true, saved: w.saved, people: this._people.length, expenses: this._expenses.length, rejected: norm.rejected };
    }
    /* 汇率试算（不落账）。 */
    quote(amount, currency, rate, rateUnit) {
        const q = toCNY(amount, currency, rate, rateUnit);
        this._lastQuote = q;
        return q;
    }
    /* 结算全链：余额 → 家庭归并 → 内部清算 + 外部债务。 */
    settle() {
        const raw = balancesOf(this._expenses, this._people);
        const merged = consolidateFamilies(raw.balances, this._families);
        const internal = internalSettlement(merged);
        const external = externalSettlement(raw.externalDebts);
        const summary = { payerTotals: raw.payerTotals, transfers: internal.transfers, balanced: internal.balanced, external: external };
        this._lastSummary = summary;
        this._log('settle', 'transfers=' + String(internal.transfers.length) + ' external=' + String(external.length) + ' eps=' + String(TV_EPSILON));
        return summary;
    }
    readings() { return readingsOf(this._expenses, this._people); }
    /* ---------- [v3.66.0 · X2] 跨 App 定位口 ---------- */
    /**
     * 定位到某一条费用（全局搜索点进来时用）。
     *   ★ 按 **id** 找，不按下标：删中间一条后下标会让定位串到别的一条头上。
     *   ★ 回报 `{ok:false, reason}` 而**不是**静默返回 —— 「点进来还停在首屏」
     *     与「这条费用没了」在界面上长得一样，必须由调用方把理由报出来。
     */
    openRef(ref) {
        const id = (ref && typeof ref === 'object') ? toStr(ref.id) : '';
        if (!id) return { ok: false, reason: 'no_id' };
        this._probe();
        const hit = this._expenses.filter((e) => toStr(e && e.id) === id);
        if (!hit.length) return { ok: false, reason: 'not_found', id: id, saw: this._expenses.length };
        this._focus = id;
        return { ok: true, id: id, index: this._expenses.indexOf(hit[0]), saw: this._expenses.length };
    }
    /** 清掉定位态（视图「收起」与换会话都走这里，防定位态跨会话残留）。 */
    clearRef() { this._focus = ''; return { ok: true }; }
    /** 定位态：id + 它在**当下**曲库里的下标（找不到时 index = -1，不假装还在）。 */
    focusRow() {
        if (!this._focus) return null;
        const idx = this._expenses.findIndex((e) => toStr(e && e.id) === this._focus);
        if (idx < 0) return { id: this._focus, index: -1, gone: true };
        const e = this._expenses[idx];
        return { id: this._focus, index: idx, gone: false, payer: toStr(e.payer), note: toStr(e.note), finalCNY: e.finalCNY };
    }
    /* ---------- [v4.03.0 · R3-X6] 协作行程板:落盘与动作 ---------- */
    /**
     * 读出行程板原始态。**读不出与空分开**:
     *   读不出(没有 API / 读抛错)⇒ null;读到确实没有 ⇒ {};读到有 ⇒ 那份对象。
     */
    _readPartyRaw() {
        const r = this._readRaw(TV_PARTY_KEY);
        if (!r.ok) return null;
        if (r.why === 'absent') return {};
        return isPlain(r.value) ? r.value : null;
    }
    /** 贴回 JSON 建立/替换行程板(归一后落盘,回报拒绝与裁边 —— 不静默丢)。 */
    intakeBoard(rawText) {
        let parsed = null;
        try { parsed = JSON.parse(toStr(rawText)); } catch (e) { return { ok: false, why: 'bad_json', saved: false }; }
        const norm = normalizeParty(isPlain(parsed) ? parsed : {}, { fallbackId: 'party' });
        const w = this._writeRaw(TV_PARTY_KEY, norm.party);
        this._party = norm.party; this._partyRejected = norm.rejected; this._partyDropped = norm.dropped;
        this._log('intake_board', 'members=' + String(norm.party.members.length) + ' costs=' + String(norm.party.costs.length) + ' saved=' + String(w.saved === true));
        return { ok: true, saved: w.saved, rejected: norm.rejected, dropped: norm.dropped };
    }
    /**
     * 行程板动作窄口(视图把「动作 + 参数」交上来)。
     *   ★ **唯一会碰账本的是 `commit-costs`**(而且只把内核判为 actual 的转成支出行);
     *     其余动作只改行程板或只产文本,一律不动账本、不动真实余额;
     *   ★ 没有任何动作发布到外部平台、没有任何动作自行移动角色或改约定。
     *   ★ 人头增补(`people`)是**用户点了才做**:内核只给建议名单(proposedPeople)。
     */
    partyAct(action, arg) {
        const act = toStr(action || 'advice');
        const a = isPlain(arg) ? arg : {};
        if (act === 'advice') {
            const cur = this._party || { members: [], costs: [], stops: [], tasks: [], checklist: [] };
            return { ok: true, note: '建议不改任何东西', advice: partyAdvice(cur, this._expenses) };
        }
        if (act === 'commit-costs') return this.commitPartyCosts();
        const raw = this._readPartyRaw();
        if (raw === null) return { ok: false, note: '这一板读不出来(没有存储 API 或读失败),不拿它做任何改动' };
        const norm = normalizeParty(raw, { fallbackId: 'party' });
        const party = norm.party;
        if (act === 'intake') {
            if (!isPlain(a.board)) return { ok: false, note: '没给板子内容' };
            return this.intakeBoard(JSON.stringify(a.board));
        }
        if (act === 'clear-board') {
            const w = this._writeRaw(TV_PARTY_KEY, {});
            this._party = normalizeParty({}, { fallbackId: 'party' }).party; this._partyRejected = []; this._partyDropped = {};
            this._log('clear_board', 'saved=' + String(w.saved === true));
            return { ok: true, note: '行程板已清空(账本一分未动)', saved: w.saved === true };
        }
        if (act === 'people') {
            const pp = proposedPeople(party, this._people);
            if (!pp.changed) return { ok: true, note: '参加的人都已经在账本人头里了', added: [], declined: pp.declined };
            const w = this._writeRaw(TV_BOOK_KEY, { people: pp.people, families: this._families, expenses: this._expenses });
            this._people = pp.people.slice(0, TV_PEOPLE_MAX);
            this._log('party_people', 'added=' + pp.added.join('/'));
            return { ok: true, note: '已把 ' + pp.added.join('/') + ' 加进账本人头(婉拒的不算)', added: pp.added, saved: w.saved === true, declined: pp.declined };
        }
        if (act === 'member') {
            const got = normalizeMember(a.member);
            if (!got.member) return { ok: false, note: '成员没名字,加不进去' };
            const idx = party.members.findIndex(function (m) { return m.name === got.member.name; });
            if (idx >= 0) party.members[idx] = got.member; else party.members.push(got.member);
            this._party = party;
            const w = this._writeRaw(TV_PARTY_KEY, party);
            this._log('party_member', got.member.name + '=' + got.member.state + ' saved=' + String(w.saved === true));
            return { ok: true, note: got.member.name + ' 现在是 ' + got.member.state, saved: w.saved === true };
        }
        if (act === 'add-stop' || act === 'add-task' || act === 'add-check' || act === 'add-cost') {
            const key = (act === 'add-stop') ? 'stops' : ((act === 'add-task') ? 'tasks' : ((act === 'add-check') ? 'checklist' : 'costs'));
            const fn = (act === 'add-stop') ? normalizeStop : ((act === 'add-task') ? normalizeTask : ((act === 'add-check') ? normalizeCheck : normalizeCost));
            const got = fn(a.item, party[key].length);
            const field = key === 'stops' ? 'stop' : (key === 'tasks' ? 'task' : (key === 'checklist' ? 'check' : 'cost'));
            if (!got[field]) return { ok: false, note: '这一条填不全,没收(' + got.why + ')' };
            party[key].push(got[field]);
            this._party = party;
            const w = this._writeRaw(TV_PARTY_KEY, party);
            this._log('party_' + key, field + '=' + toStr(got[field].id) + ' saved=' + String(w.saved === true));
            return { ok: true, note: '已加进' + ((key === 'costs') ? '共同费用' : key), row: got[field], saved: w.saved === true, warn: got.why };
        }
        if (act === 'toggle-task' || act === 'toggle-check') {
            const key = (act === 'toggle-task') ? 'tasks' : 'checklist';
            const id = toStr(a.id);
            const hit = party[key].filter(function (x) { return toStr(x.id) === id; })[0];
            if (!hit) return { ok: false, note: '这一条不在了(可能被裁边或换了会话)' };
            hit.done = !(hit.done === true);
            this._party = party;
            const w = this._writeRaw(TV_PARTY_KEY, party);
            this._log('party_toggle', key + ':' + id + '=' + String(hit.done) + ' saved=' + String(w.saved === true));
            return { ok: true, note: (hit.done ? '已打勾:' : '已取消勾:') + toStr(hit.title || hit.text), saved: w.saved === true };
        }
        if (act === 'set-cost-state') {
            const id = toStr(a.id);
            const st = toStr(a.state);
            if (TVP_COST_STATES.indexOf(st) < 0) return { ok: false, note: '费用态认不出:' + st };
            const hit = party.costs.filter(function (x) { return toStr(x.id) === id; })[0];
            if (!hit) return { ok: false, note: '这笔费用不在了' };
            const before = toStr(hit.state);
            hit.state = st;
            this._party = party;
            const w = this._writeRaw(TV_PARTY_KEY, party);
            this._log('party_cost_state', id + ':' + before + '->' + st + ' saved=' + String(w.saved === true));
            return { ok: true, note: (st === 'actual') ? '已标为实际发生(现在才能生成支出)' : '已标为估算(不落账)', saved: w.saved === true };
        }
        return { ok: false, note: '认不出的行程动作:' + act };
    }
    /**
     * 把「实际已发生」的共同费用生成成账本支出行 —— **本 App 里唯一会写账本的动作**。
     *   · 幂等:同一费用二次点得到 skipped,不是第二笔钱(内核 commitCosts 钉住);
     *   · 生成行只**追加**,不覆盖既有支出(改期不动历史支出);
     *   · 回读核对行数:写下去与读回来不是同一份 ⇒ 如实回报 readback-mismatch,不当成功。
     */
    commitPartyCosts() {
        const raw = this._readPartyRaw();
        if (raw === null) return { ok: false, note: '这一板读不出来,不生成支出' };
        const norm = normalizeParty(raw, { fallbackId: 'party' });
        const got = commitCosts(norm.party, this._expenses, this._people);
        if (!got.generated) {
            const why = got.rejected.filter(function (x) { return x.why === 'payer-not-in-people'; }).length;
            this._log('party_commit', 'generated=0 skipped=' + String(got.skipped) + ' payer-missing=' + String(why));
            return { ok: true, generated: 0, skipped: got.skipped, note: why ? '有费用垫付人不在账本人头里,先加人头' : '没有新的实际费用可生成(估算的不落账)' };
        }
        const before = this._expenses.length;
        const merged = this._expenses.concat(got.rows);
        const w = this._writeRaw(TV_BOOK_KEY, { people: this._people, families: this._families, expenses: merged });
        const back = this._readRaw(TV_BOOK_KEY);
        const backRows = (back.ok && back.why === 'present' && isPlain(back.value) && Array.isArray(back.value.expenses)) ? back.value.expenses : null;
        const okRead = backRows !== null && backRows.length === merged.length;
        this._log('party_commit', 'generated=' + String(got.generated) + ' skipped=' + String(got.skipped) + ' readback=' + String(okRead));
        if (!okRead) return { ok: false, generated: got.generated, skipped: got.skipped, note: '支出写下去了但读回来对不上(readback-mismatch)', saved: w.saved === true };
        this._expenses = backRows;
        return { ok: true, generated: got.generated, skipped: got.skipped, note: '已生成 ' + String(got.generated) + ' 笔支出(从 ' + String(before) + ' → ' + String(merged.length) + ')', saved: w.saved === true };
    }

    symbols() { return TV_CURRENCY_SYMBOLS; }
    clearAll() { this._people = []; this._families = []; this._expenses = []; this._writeRaw(TV_BOOK_KEY, {}); this._log('clear', ''); }
    clearLedger() { this._ledger = []; this._writeRaw(TV_LEDGER_KEY, []); this._log('clear_ledger', ''); }
    onChatChanged() { this._probe(); this._dropped = 0; this._focus = ''; this._party = null; this._partyRejected = []; this._partyDropped = {}; this.render(); }
    render() {
        this._probe();
        if (!this._view) this._view = new TraveldeskView(this);
        this._view.render(this._vm());
    }
    _vm() { return { people: this._people, families: this._families, expenses: this._expenses, lastSummary: this._lastSummary, lastQuote: this._lastQuote, readings: this.readings(), ledger: this._ledger, dropped: this._dropped, focus: this.focusRow(),
            /* [v4.03.0 · R3-X6] 行程板读数:预计与实际**分列**报,不合并成一个「总花费」。 */
            party: this._party, partyAdvice: this._party ? partyAdvice(this._party, this._expenses) : [],
            partyReadings: this._party ? partyReadings(this._party, this._expenses) : null,
            partyRejected: this._partyRejected, partyDropped: this._partyDropped }; }
}