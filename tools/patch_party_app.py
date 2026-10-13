import io, ast, sys
p = 'apps/traveldesk/traveldesk-app.js'
s = io.open(p, encoding='utf-8').read()
orig = s

# (A) import 追加 + 新键常量
a_old = "import { writeReceipt } from '../../config/write-receipt.js';"
a_new = ("import { writeReceipt } from '../../config/write-receipt.js';\n"
         "/* [v4.03.0 · R3-X6] 协作行程板内核:归一 / 参加者判定 / 读数(预计与实际分列) /\n"
         " *   生成支出(幂等) / 建议。**全部纯函数**,本件只负责落盘与把动作派给内核。 */\n"
         "import {\n"
         "    normalizeParty, partyReadings, commitCosts, proposedPeople, partyAdvice,\n"
         "    normalizeMember, normalizeStop, normalizeTask, normalizeCheck, normalizeCost,\n"
         "    TVP_MEMBER_STATES, TVP_COST_STATES\n"
         "} from './traveldesk-plan.js';")
assert s.count(a_old) == 1, 'anchor A'
s = s.replace(a_old, a_new, 1)

a2_old = "export const TV_LEDGER_KEY = 'tv_ledger';"
a2_new = ("export const TV_LEDGER_KEY = 'tv_ledger';\n"
          "/* [v4.03.0 · R3-X6] 行程板:成员邀请三态 / 地点顺序 / 分工 / 准备清单 / 共同费用(预计与实际两态)。\n"
          " *   ★ 与 tv_book **分开存**:账本是「钱怎么算」,行程板是「人怎么去」——\n"
          " *     两者的生命周期不同(改期要改行程但不动历史支出),混一格会让改期顺手改到钱。 */\n"
          "export const TV_PARTY_KEY = 'tv_party';")
assert s.count(a2_old) == 1, 'anchor A2'
s = s.replace(a2_old, a2_new, 1)

# (B) 构造函数实例态
b_old = "        this._focus = '';\n    }"
b_new = ("        this._focus = '';\n"
         "        /* [v4.03.0 · R3-X6] 行程板实例态。\n"
         "         *   ★ 板子本身在 tv_party 那一格(随会话隔离),下面三项是**实例态**:\n"
         "         *     归一后的拒绝清单 / 裁边计数 / 上一次动作回报 —— 换会话必须丢,\n"
         "         *     否则新会话会带着上一段的「拒了 3 条」旧读数(与 taskentry 的 dropped 同一形态)。 */\n"
         "        this._party = null;\n"
         "        this._partyRejected = [];\n"
         "        this._partyDropped = {};\n"
         "    }")
assert s.count(b_old) == 1, 'anchor B'
s = s.replace(b_old, b_new, 1)

# (C) _probe 读行程板
c_old = ("        const l = this._readRaw(TV_LEDGER_KEY);\n"
         "        this._ledger = (l.ok && l.why === 'present' && Array.isArray(l.value)) ? l.value : [];\n"
         "    }")
c_new = ("        const l = this._readRaw(TV_LEDGER_KEY);\n"
         "        this._ledger = (l.ok && l.why === 'present' && Array.isArray(l.value)) ? l.value : [];\n"
         "        /* [v4.03.0 · R3-X6] 行程板:**读不出与空分开** ——\n"
         "         *   读不出(没有 storage API / 抛错)⇒ 板子保持 null,视图说「还没取到」,\n"
         "         *   不假装「这一板是空的」(空板与读不到在界面上同形是会骗人的)。 */\n"
         "        const pr = this._readPartyRaw();\n"
         "        if (pr === null) { this._party = null; this._partyRejected = []; this._partyDropped = {}; }\n"
         "        else {\n"
         "            const norm = normalizeParty(pr, { fallbackId: 'party' });\n"
         "            this._party = norm.party; this._partyRejected = norm.rejected; this._partyDropped = norm.dropped;\n"
         "        }\n"
         "    }")
assert s.count(c_old) == 1, 'anchor C'
s = s.replace(c_old, c_new, 1)

# (D) 方法块插在 symbols() 之前
d_old = "    symbols() { return TV_CURRENCY_SYMBOLS; }"
party_methods = '''    /* ---------- [v4.03.0 · R3-X6] 协作行程板:落盘与动作 ---------- */
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

'''
assert s.count(d_old) == 1, 'anchor D'
s = s.replace(d_old, party_methods + d_old, 1)

# (E) onChatChanged 重置
e_old = "    onChatChanged() { this._probe(); this._dropped = 0; this._focus = ''; this.render(); }"
e_new = "    onChatChanged() { this._probe(); this._dropped = 0; this._focus = ''; this._party = null; this._partyRejected = []; this._partyDropped = {}; this.render(); }"
assert s.count(e_old) == 1, 'anchor E'
s = s.replace(e_old, e_new, 1)

# (F) _vm 增字段
f_old = "focus: this.focusRow() }; }"
f_new = ("focus: this.focusRow(),\n"
         "            /* [v4.03.0 · R3-X6] 行程板读数:预计与实际**分列**报,不合并成一个「总花费」。 */\n"
         "            party: this._party, partyAdvice: this._party ? partyAdvice(this._party, this._expenses) : [],\n"
         "            partyReadings: this._party ? partyReadings(this._party, this._expenses) : null,\n"
         "            partyRejected: this._partyRejected, partyDropped: this._partyDropped }; }")
assert s.count(f_old) == 1, 'anchor F'
s = s.replace(f_old, f_new, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('patched bytes', len(orig), '->', len(s))