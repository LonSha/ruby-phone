/* ========================================================
 * place-app.js — [v2.46.0] 地点图景 App 控制器
 *
 * 消费上游记忆插件的场所图景面（`window.lonsha_memory_bridge_v1.snapshot.scene`），
 * 把「人在哪儿 / 谁在这个地方 / 到访与覆盖」做成手机里可查询的界面，并把
 * 「本世界已登记的场所与在场」交给生成侧（GENERATE_BEFORE_COMBINE_PROMPTS）。
 *
 * 三条纪律（与 config/world-bridge.js 同规格，照抄其消费面先例）：
 *   ① 只读：只取桥的 snapshot（对象）/ refresh()，绝不写上游任何状态；
 *   ② 不抛：桥未装 / 无快照 / 旧版无 scene 面 / 面缺席 / 快照畸形，一律降级为归因文案；
 *   ③ 不猜：拿不到就如实说拿不到（六态分开报），绝不编造地点或人数顶替。
 *
 * 【为什么不在实例里缓存读数】本 App 的读数**每次现取**：
 *   会话隔离靠 storage 的 `/^place_/` 键（设置），而场所面本身随会话变——
 *   任何实例级缓存都会在换会话/删楼回滚后变成陈旧数据（本仓治理过多轮的形态）。
 *   故 onChatChanged() 只丢弃上一次的探针归因，不持有任何数据副本。
 * ======================================================== */
'use strict';
import { defaultPlaceSettings, readSceneFace, projectScene, scenePromptBlock } from './place-data.js';
import { PlaceView } from './place-view.js';
/* [v4.43.0 · R5-X3] 多人行踪时间带与会面证据（纯契约：只做读数与归一，不推算位置）。
 *   与既有 `presenceAt`（「此刻这个地点有谁」）**不是同一件事**：
 *   本件答的是「某个时间窗里这几个人各自在哪几段有据在场、谁和谁**可能**共处过」。 */
import {
  BAND_STATES, MEET_STATES, BAND_LIMITS,
  normalizeBand, coPresenceOf, buildPresenceBand, presenceBandLine, presenceBandSelfCheck
} from '../../config/presence-band-contract.js';
import { readPushProbe } from '../../config/world-bridge.js';
/* [v4.05.0 · R3-X9] 探索内核:清单 / 路径 / 地点卡 / 出行提案。
 *   本 App 只做三件事:①把已有几面数据**现取**出来交给内核;②把内核的话摆到界面上;
 *   ③把用户选中的那条提案**交给聊天**(派发 phone:sendToChat,与扭蛋 / 塔罗同一条通道)。
 *   **本层不移动角色、不写任何地点状态、不编距离** —— 走动只发生在正文里。 */
import { exploreList, buildRoute, normalizeRoamInputs, buildTravelProposal, roamSelfCheck } from '../../config/place-roam.js';
/* [v3.0.1] 投影契约的**归属面**（L-F5 的遗留观察项之一）。
 *   本 App 的数据面照旧读只读快照的场所面（`readSceneFace` 的三态归因一个字不动）——
 *   理由写死在 config/projection-contract.js 的 projectionScopeLine 文件头：
 *   上游投影只外供 6 项窄面，而本面要的是**整面场所树**，用投影替换数据源等于把
 *   跨仓稳定契约变成上游内部结构的镜像。故这里接的是**「这份读数是哪一次的」**这一面。 */
import { readProjection, projectionScopeLine } from '../../config/projection-contract.js';
/* [v4.97.0 · R11-O3 第三批] 街区机会内核接到本 App（此前 importers 为零，tier=zero）。
 *   为什么接在这里：内核头注写明「地点会提供机会，而不只是显示谁在那里」——
 *   而本 App 正是「谁在那里」的读数面，缺的正是「这里此刻有什么可参与」的另一半。
 *   放别处会变成第二个「地点」入口，两份口径各算一次。
 *   ★ 只接内核真身，不搬 orchestrator 的包装方法：内核判，本件只做读写与渲染。
 *   ★ 营业时间槽用上游场景头的日期/时段读数（projectScene().header），不新造第二份时钟。 */
import {
    createPlace, deriveOpportunities, recordVisit, getPlaceFamiliarity,
} from '../../config/district-network.js';
/* 街区机会台账的键：随会话隔离（命中 config/storage.js 既有 /^place_/ 前缀，零机制面改动）。 */
export const PLACE_DISTRICT_KEY = 'place_district_v1';

/** 设置键：必须匹配 config/storage.js 的 CHAT_DATA_PATTERNS 中 `/^place_/`，否则跨会话串味 */
const SETTINGS_KEY = 'place_settings_v1';

export class PlaceApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.view = new PlaceView(this);
        /** 最近一次探针归因（供诊断显示；不参与渲染数据） */
        this._lastProbe = null;
        this._hooked = false;
        this._initHook();
    }

    /* ========== 设置（随会话隔离，容错读写） ========== */
    getSettings() {
        try {
            const raw = this.storage?.get?.(SETTINGS_KEY, false);
            const obj = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
            return { ...defaultPlaceSettings(), ...(obj && typeof obj === 'object' ? obj : {}) };
        } catch (_e) { return defaultPlaceSettings(); }
    }
    saveSettings(patch) {
        try {
            const next = { ...this.getSettings(), ...(patch || {}) };
            this.storage?.set?.(SETTINGS_KEY, JSON.stringify(next), false);
            return next;
        } catch (_e) { return this.getSettings(); }
    }
    /* ========== [v4.97.0 · R11-O3 第三批] 街区机会面（判定全在 district-network 内核） ========== */
    /**
     * 读街区台账：**读不出与空台账分开**（前者「读不到」，后者「还没登记过地点」）。
     * 台账形如 { places: { placeId: placeObj } }，placeObj 由内核 createPlace 产出。
     */
    _readDistrictState() {
        if (!this.storage || typeof this.storage.get !== 'function') {
            return { readable: false, why: 'no_storage', places: {} };
        }
        let raw;
        try { raw = this.storage.get(PLACE_DISTRICT_KEY); }
        catch (_e) { return { readable: false, why: 'read_threw', places: {} }; }
        if (raw === undefined || raw === null || raw === '') {
            return { readable: true, why: '', places: {} };
        }
        let parsed = raw;
        if (typeof raw === 'string') {
            try { parsed = JSON.parse(raw); }
            catch (_e) { return { readable: false, why: 'bad_json', places: {} }; }
        }
        const places = (parsed && typeof parsed === 'object' && parsed.places && typeof parsed.places === 'object')
            ? parsed.places : {};
        return { readable: true, why: '', places };
    }
    _writeDistrictState(places) {
        if (!this.storage || typeof this.storage.set !== 'function') {
            return { saved: false, why: 'no_api' };
        }
        try {
            const out = this.storage.set(PLACE_DISTRICT_KEY, JSON.stringify({ version: 1, places }));
            if (out === false) return { saved: false, why: 'write_refused' };
            return { saved: true, why: '' };
        } catch (_e) { return { saved: false, why: 'write_threw' }; }
    }
    /**
     * 登记一处可提供机会的地点（作者侧动作）。时间窗由用户按剧情补设，不编真实距离。
     * @returns {{ok:boolean, reason?:string, placeId?:string}}
     */
    registerDistrictPlace(placeId, name, timeWindows, orgs) {
        const pid = String(placeId || '').trim();
        const nm = String(name || '').trim();
        if (!pid || !nm) return { ok: false, reason: 'missing-id-or-name' };
        if (!Array.isArray(timeWindows) || !timeWindows.length) {
            return { ok: false, reason: 'time-windows-required' };
        }
        for (const tw of timeWindows) {
            if (!tw || typeof tw !== 'object' || !String(tw.day || '').trim()) return { ok: false, reason: 'bad-time-window' };
            if (!Array.isArray(tw.slots) || !tw.slots.length) return { ok: false, reason: 'bad-time-window' };
        }
        const read = this._readDistrictState();
        if (!read.readable) return { ok: false, reason: 'ledger-' + read.why };
        if (read.places[pid]) return { ok: false, reason: 'place-exists' };
        let place;
        try { place = createPlace({ placeId: pid, name: nm, timeWindows, orgs: Array.isArray(orgs) ? orgs : [] }); }
        catch (_e) { return { ok: false, reason: 'kernel-refused' }; }
        read.places[pid] = place;
        const w = this._writeDistrictState(read.places);
        if (!w.saved) return { ok: false, reason: 'write-' + w.why };
        return { ok: true, placeId: pid };
    }
    /**
     * 算「此刻这里有什么可参与」：时间槽读上游场景头（date→day、period→slot），
     * 缺头时如实报「现在几时读不到」，**不猜一个时段顶替**。
     * 机会按当前在场的角色当 userId 语境（内核用不到具名用户时传 null）。
     */
    districtFace() {
        const read = this._readDistrictState();
        const ids = Object.keys(read.places);
        if (!read.readable) {
            return { ok: false, why: read.why, line: '街区台账读不到（' + read.why + '）—— 不是「没有地点」', rows: [], placeCount: null };
        }
        if (!ids.length) {
            return { ok: true, why: 'empty', line: '这个会话还没登记过可提供机会的地点', rows: [], placeCount: 0 };
        }
        /* 场景头的 date/period 是自由文本；内核要 day 与 slot 标识。取不到就按「不营业」算，
         *   内核会如实把全部机会标 missed（错过不伪造已到场），并把原因写进 face.line。 */
        let header = null;
        try { header = (this.projection().proj || {}).header; } catch (_e) { header = null; }
        const day = header && header.date ? String(header.date) : '';
        const slot = header && header.period ? String(header.period) : '';
        const slotsKnown = !!(day && slot);
        const rows = [];
        for (const pid of ids) {
            const place = read.places[pid];
            if (!place || typeof place !== 'object') continue;
            const events = this._eventsForPlace(pid);
            /* [v4.97.0] 写读同一份用户名：到访记在 'user' 名下，面读数也按 'user' 查，
             *   否则 already-attended 与熟悉度读数永远落空（写读不同名 = 白记）。 */
            const opps = deriveOpportunities(place, day || '—', slot || '—', events, 'user');
            const fam = getPlaceFamiliarity(place, 'user');
            for (const o of opps) rows.push({ placeId: pid, placeName: place.name, status: o.status, label: o.label || o.id, familiarity: fam });
        }
        const line = slotsKnown
            ? ('已登记 ' + ids.length + ' 处 · 当前 ' + day + ' ' + slot)
            : ('已登记 ' + ids.length + ' 处 · 本楼场景头未登记日期/时段，机会只能按「不营业」如实标 missed');
        return { ok: true, why: 'ready', line, rows, placeCount: ids.length, slotsKnown };
    }
    /** 每处地点的可参与事件：由用户在界面上补设（内核不编事件，上限在内核侧已封 5 条/处）。 */
    _eventsForPlace(placeId) {
        const s = this.getSettings();
        const all = Array.isArray(s.districtEvents) ? s.districtEvents : [];
        return all.filter((e) => e && e.placeId === placeId)
            .map((e) => ({ id: String(e.id || ''), label: String(e.label || ''), condition: e.condition ? String(e.condition) : undefined }));
    }
    /** 记录一次到访（用户确认「我参加了这场」）：内核判熟悉度升级，本件只落盘。 */
    recordDistrictVisit(placeId, eventId, metCharacterIds) {
        const read = this._readDistrictState();
        if (!read.readable) return { ok: false, reason: 'ledger-' + read.why };
        const place = read.places[String(placeId || '')];
        if (!place) return { ok: false, reason: 'place-unknown' };
        if (!String(eventId || '').trim()) return { ok: false, reason: 'event-missing' };
        try { recordVisit(place, 'user', String(eventId), Array.isArray(metCharacterIds) ? metCharacterIds : []); }
        catch (_e) { return { ok: false, reason: 'kernel-refused' }; }
        const w = this._writeDistrictState(read.places);
        if (!w.saved) return { ok: false, reason: 'write-' + w.why };
        return { ok: true };
    }

    _win() {
        try { return (typeof window !== 'undefined') ? window : globalThis; } catch (_e) { return globalThis; }
    }

    /**
     * 探针：把「桥在不在 / 有没有快照」取出来交给纯内核归因（本方法不做任何判断）。
     * 桥快照是**推**型（生成管线里 refresh 覆盖），故对象缺失时退而调 refresh()。
     * @returns {{mounted:boolean, hasSnapshot:boolean, snapshot:object|null}}
     */
    probeBridge() {
        const p = readPushProbe(this._win());
        return { mounted: p.mounted, hasSnapshot: p.hasSnapshot, snapshot: p.snapshot };
    }

    /** 来源归因（六态）：{state, reason, snapshot, text} */
    sceneFace() {
        const probe = this.probeBridge();
        this._lastProbe = probe;
        return readSceneFace(probe);
    }

    /**
     * 归属面（[v3.0.1]）：这份读数是**哪一次的**（会话 / 场景 / 世界 / 修订 / 时效 / 权限）。
     * 与数据面**分开取**：投影只回答「能不能用、是谁的」，不替换场所数据（见文件头导入注释）。
     * 不抛、结构恒定（拿不到就是「不可用 + 一行如实文案」）。
     */
    sourceFace() {
        try {
            return projectionScopeLine(readProjection(this._win()));
        } catch (_e) {
            return projectionScopeLine(null);
        }
    }

    /** 一次取齐「归因 + 五块投影 + 归属面」（视图用它，保证同一份读数上的三面同源） */
    projection() {
        const face = this.sceneFace();
        const proj = projectScene(face.snapshot, { maxEntries: 12 });
        return { face, proj, src: this.sourceFace() };
    }

    /* ==================== [v4.05.0 · R3-X9] 地点探索与场景漫游 ====================
     * 【本段只做一件事】把**已经在别处存在**的几面数据现取出来,交给 config/place-roam.js 的纯内核。
     *   本 App 不回答「怎么走」,也不回答「去过没去过」—— 那些判定在核心里有判据、可单测。
     *
     * 【为什么往事与约定要去读约定账】R3-X9 的验收口径要求「从当前地点选目的地可带出已知线索」。
     *   线索有两类来源:本 App 自己的到访史(已有),以及**用户与角色约好的那些事**(在约定账里)。
     *   约定账的 owner 仍是 apps/calendar(config/commitment-flow.js),此处**只读镜像**,
     *   不写、不改、不重算它的状态 —— 不新开第二个 owner,这是本仓跨 App 复用的既定姿势。
     */

    /**
     * 往事与约定面:从约定账里取「注了地点」的条目。
     * **读不到(存储抛 / 结构不是账)返回 null** ⇒ 内核据此说「本面读不到」;
     * 读到但一条都没注地点 ⇒ 返回 [] ⇒ 内核说「这处还没有记下过的往事或约定」。
     * 两种处境处置相反(前者等接入,后者等剧情),故不得同形。
     * @returns {Array|null}
     */
    notesFace() {
        try {
            const raw = this.storage?.get?.('calendar_commitments', null);
            const parsed = typeof raw === 'string' ? JSON.parse(raw || 'null') : raw;
            const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
            const out = [];
            for (const it of items) {
                if (!it || typeof it !== 'object') continue;
                const place = String(it.place || it.location || '').trim();
                if (!place) continue;
                out.push({
                    kind: String(it.status || '') === 'fulfilled' ? '往事' : '约定',
                    text: String(it.content || it.title || '').trim(),
                    place,
                    dateKey: String(it.dateKey || '').trim()
                });
            }
            return out;
        } catch (_e) { return null; }
    }
    /**
     * 探索输入面(内核的唯一入参形状)。
     * 面在不在**按读到没读到判**:读不到就不传这一项(内核据此报「这版读不到」),
     * 而不是传一个空数组 —— 空数组的意思是「有这面,只是空」,两者处置相反。
     */
    roamInputs() {
        const pkg = this.projection();
        const proj = (pkg && pkg.proj) || null;
        const ok = !!(proj && proj.ok);
        const raw = {
            tree: (ok && Array.isArray(proj.tree)) ? proj.tree : [],
            currentChain: (ok && Array.isArray(proj.current)) ? proj.current : []
        };
        if (ok && Array.isArray(proj.history)) raw.visits = proj.history;
        if (ok && Array.isArray(proj.presence)) raw.presence = proj.presence;
        const notes = this.notesFace();
        if (Array.isArray(notes)) raw.notes = notes;
        return normalizeRoamInputs(raw);
    }
    /* ========== [v4.43.0 · R5-X3] 多人行踪时间带与会面证据 ========== */
    /**
     * 把上游 scene 面的在场记录**翻成行踪片段**（本层只翻译形状，不推算位置）。
     *
     * 【★ 为什么没有 ref 的片段判「未知」而不是「在场」】上游给的在场记录若**没带出处**
     *   （`ref`），那这一段的正文**读不到** —— 把它当「有据在场」会让用户以为
     *   「他一直在那儿」，而其实只是没数据。故一律如实落 `unknown`（不画连续线）。
     * 【★ 为什么 conflictWith 单列】同一时段两处都报了是**数据冲突**，
     *   不是「同时在两处」—— 两者处置相反（前者要人去核，后者是超能力）。
     */
    bandCharsFromScene(names) {
        const want = Array.isArray(names) ? names.map((x) => String(x == null ? '' : x).trim()).filter(Boolean) : [];
        const out = [];
        let presence = null;
        let readOk = false;
        try {
            const pkg = this.projection();
            const proj = (pkg && pkg.proj) || null;
            /* ★ 只有「真读到在场面」才算读过：面缺席 / 抛错都算**没读到** ——
             *   那与「读了、确实没有片段」是两件事（后者才是「没行踪」）。 */
            if (proj && proj.ok && Array.isArray(proj.presence)) { presence = proj.presence; readOk = true; }
        } catch (_e) { presence = null; readOk = false; }
        for (const name of want) {
            const segs = readOk
                ? presence.filter((g) => String(g && g.name) === name).map(function (g) {
                    const e = (g && typeof g === 'object') ? g : {};
                    return {
                        from: String(e.from || ''), to: String(e.to || ''),
                        place: String(e.key || e.place || ''), ref: String(e.ref || ''),
                        conflictWith: String(e.conflictWith || ''),
                        absent: e.absent === true,
                        unread: e.unread === true || !String(e.ref || ''),
                    };
                })
                /* ★ 这一轮**没读到**在场面 ⇒ 如实给一条「未知」片段，
                 *   而不是给零片段（零片段会被读成「他没有任何行踪」——那是另一件事）。 */
                : [{ from: '', to: '', place: '', ref: '', conflictWith: '', absent: false, unread: true }];
            out.push({ id: name, name: name, segments: segs });
        }
        return out;
    }
    /** 一次取齐行踪带（**只读**：本层不判重叠，转交纯契约件）。 */
    presenceBand(names, opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        try {
            return buildPresenceBand({
                chars: this.bandCharsFromScene(names),
                evidenced: o.evidenced === true,
            });
        } catch (_e) {
            return buildPresenceBand({ thrown: true });
        }
    }
    /** 行踪带一行读数（视图只排版）。 */
    presenceBandLineOf(face) {
        try { return presenceBandLine(face); }
        catch (_e) { return '行踪带：读不到'; }
    }
    /** 行踪契约件自检的**真消费点**（方法名与 import 不同名，防同类遮蔽）。 */
    presenceBandSelfCheck() {
        try { return presenceBandSelfCheck(); }
        catch (_e) { return { problems: ['自检抛了:' + String((_e && _e.message) || _e)], bandStates: 0, meetStates: 0 }; }
    }

    /** 探索清单(去过 / 待探索 / 可进入 / 未知)。不抛:异常一律降级为一行归因 */
    exploreFace() {
        try { return exploreList(this.roamInputs()); }
        catch (_e) { return { ok: false, state: 'error', reason: 'read-failed', items: [], readings: {} }; }
    }
    /** 从当前位置到某处的拓扑(不认识就是不认识:route=unknown,不编距离与耗时) */
    routeTo(target) {
        try { return buildRoute(this.roamInputs(), target); }
        catch (_e) { return null; }
    }
    /** 地点卡 + 出行提案文本(只生成话,不移动任何东西) */
    proposalOf(target) {
        try { return buildTravelProposal(this.roamInputs(), target); }
        catch (_e) { return { ok: false, reason: 'read-failed', text: '', lines: [], place: null }; }
    }
    /**
     * 把提案交给聊天 —— **这是「提案」二字的落地处**。
     * 本方法只把这段文本投进聊天输入框(与扭蛋 / 塔罗同一条 `phone:sendToChat` 通道),
     * 发不发送由宿主与用户决定;本方法**不改任何地点状态、不移动任何角色**。
     * @returns {{ok:boolean, reason:string, text:string}}
     */
    sendProposalToChat(target) {
        const p = this.proposalOf(target);
        const text = (p && p.text) || '';
        if (!p || !p.ok || !text) return { ok: false, reason: (p && p.reason) || 'no-proposal', text };
        try {
            const win = this._win();
            win.dispatchEvent(new win.CustomEvent('phone:sendToChat', { detail: { message: text } }));
            this.phoneShell?.showNotification?.('地点', '提案已放进聊天输入框(发送与否由你决定)', '🧭');
            return { ok: true, reason: 'ok', text };
        } catch (_e) { return { ok: false, reason: 'dispatch-failed', text }; }
    }
    /** 内核自检读数(诊断面用;拿不到时如实说拿不到,不假装通过) */
    roamProblems() {
        try { return roamSelfCheck(); }
        catch (_e) { return { ok: false, problems: ['self-check-failed'] }; }
    }

    /** 一行总述（供视图/host 诊断；传入已取好的 pkg 可避免重复读桥） */
    summaryLineOf(pkg) {
        try {
            const face = pkg?.face, proj = pkg?.proj;
            if (!face) return '地点图景不可读（探针异常）';
            // 非 ready/empty 一律先报归因：此时投影里的 0 不是「没有场所」，而是「读不到」
            if (face.reason !== 'ready' && face.reason !== 'empty') return face.text;
            const n = (v) => (v === null || v === undefined) ? '—' : String(v);
            const s = proj?.scale || {};
            return `场所 ${n(s.nodes)} 处（细写 ${n(s.detailed)} / 最深 ${n(s.depth)} 层）`
                + ` · 到访 ${n(s.visits)} 处 · 在场 ${n(s.presence)} 人`
                + ` · ${proj?.invariants?.text || ''}`;
        } catch (_e) { return '地点图景总述失败（已降级）'; }
    }
    /** 便捷入口：自己取一次读数再总述 */
    summaryLine() { return this.summaryLineOf(this.projection()); }

    /**
     * 生成侧一致性块：把「本世界已登记的场所与在场」交给生成侧，
     * 让正文里的地点与记忆插件记的地点**是同一个**（无内容返回 ''，不产生空块）。
     */
    promptBlock() {
        try {
            const s = this.getSettings();
            if (!s.injectToPrompt) return '';
            const maxLines = Math.max(1, Number(s.maxInject) || 8);
            return scenePromptBlock(this.sceneFace().snapshot, { maxLines });
        } catch (_e) { return ''; }
    }

    /** 挂生成前钩子（构造期一次；宿主无 eventSource 时静默不挂，不影响 App 本体） */
    _initHook() {
        if (this._hooked) return;
        try {
            const ctx = this._win().SillyTavern?.getContext?.();
            const es = ctx?.eventSource;
            const et = ctx?.event_types;
            if (!es || !et?.GENERATE_BEFORE_COMBINE_PROMPTS) return;
            es.on(et.GENERATE_BEFORE_COMBINE_PROMPTS, (payload) => {
                // 注入失败绝不阻断生成：本块是「一致性约束」，不是必需上下文
                try {
                    if (!payload || !Array.isArray(payload.prompt)) return;
                    const block = this.promptBlock();
                    if (block) payload.prompt.push({ role: 'system', content: block });
                } catch (_e) { /* 静默失败：生成照常进行 */ }
            });
            this._hooked = true;
        } catch (_e) { /* 宿主无事件源：不挂钩子 */ }
    }

    /**
     * 换会话 / 清数据：本 App **不持有任何读数副本**，故无需重绑数据层；
     * 仅丢弃上一次的探针归因（那是旧会话的读数），下一次渲染现取。
     */
    onChatChanged() {
        this._lastProbe = null;
    }

    render() {
        this.view.render(this.phoneShell?.layerHost?.('place-main') || this.phoneShell?.screen);
    }
}

export default PlaceApp;
