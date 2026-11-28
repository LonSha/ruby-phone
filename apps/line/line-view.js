/* ========================================================
 * line-view.js — [v4.159.0 · 第 2 层最后一件] LINE App 视图
 * 归因卡 + 会话列表 + 打开的一个会话（消息流 / 发消息 / 发贴图 / 撤回 / 已读）
 * + 建会话 + 时间线读数 + 设置
 *
 * 与 focus-view / weather-view / taobao-view 同纪律：归因文案表的键取
 *   LINE_REASONS 的**值**。本视图**只画与派事件**：一切数据变动都回调到
 *   App 的方法上（App 负责纯函数 + 落盘）。
 *
 * 四处「不糊弄」：
 *   · 贴图**不是图片**：源那里是图床 URL，本件只有名字（`[贴图：喵]`）。
 *     界面不许假装画了图 —— 没图就是没图；
 *   · 撤回是**留痕**，不是消失：那条还在，只是内容改成「撤回了一条消息」，
 *     并标明是谁撤的；源的实现直接从数组里删，之后就查不到「撤过」；
 *   · 未读是**读数**（读游标之后还有几条），不是布尔角标；游标不在列表里
 *     （消息被环形裁掉）⇒ 如实按全部未读算，不装作已读；
 *   · 上限**写在界面上**（会话 24 / 每会话 200 条 / 单条 1000 字 / 群成员 12），
 *     挤掉了就明说「挤掉 N 条」，不是静默丢。
 * ======================================================== */
'use strict';
import { LINE_REASONS, LINE_LIMITS } from './line-data.js';
/* [v4.211.0] 销毁守卫走本仓统一出口：关会话是**真销毁**（消息跟着没、没接回收站），
 *   所以它必须过 confirmDestroy —— 带「不可撤回」文案，且无宿主确认框时 fail-closed 不放行。
 *   视图层那两击 `_armed` 保留为第一道（「点错了还能退」），confirmDestroy 是第二道。 */
import { confirmDestroy } from '../../config/destructive-confirm.js';

const FACE_META = {
    [LINE_REASONS.ready]: { icon: '\u2705', label: '有会话记录', tone: 'ok' },
    [LINE_REASONS.empty]: { icon: '\u{1f4ac}', label: '还没有会话', tone: 'warn' },
    [LINE_REASONS.storage_absent]: { icon: '\u26a0\ufe0f', label: '存储不可用（读数拿不到）', tone: 'err' },
};
const KIND_ICON = { dm: '\u{1f464}', group: '\u{1f465}', official: '\u{1f4e3}' };
const KIND_LABEL = { dm: '单聊', group: '群聊', official: '官方号' };

export class LineView {
    constructor(app, shell, storage) {
        this.app = app;
        this.shell = shell;
        this.storage = storage;
        this._root = null;
        /** 打开的会话 id（视图态，不落盘） */
        this._open = '';
        /** 正文草稿（视图态） */
        this._text = '';
        /** 选中的贴图 id（视图态，空串 = 不发贴图像） */
        this._sticker = '';
        /** 建会话表单草稿（视图态） */
        this._new = { id: '', name: '', kind: 'dm', members: '' };
        /** 提示条 */
        this._flash = '';
        /** 两步确认：存「正要确认的动作键」 */
        this._armed = '';
    }
    _esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    render() {
        const container = this.shell && this.shell.getContentContainer ? this.shell.getContentContainer() : null;
        if (!container) return;
        container.innerHTML = '';
        this._root = document.createElement('div');
        this._root.className = 'ln-root';
        this._root.innerHTML = this._buildHTML();
        container.appendChild(this._root);
        this._bindEvents();
    }
    refresh() {
        if (!this._root) return;
        this._root.innerHTML = this._buildHTML();
        this._bindEvents();
    }
    /** 换会话：**视图态全部丢**（打开的会话 / 草稿 / 贴图 / 建会话表单 / 确认态）。 */
    onChatChanged() {
        this._open = '';
        this._text = '';
        this._sticker = '';
        this._new = { id: '', name: '', kind: 'dm', members: '' };
        this._flash = '';
        this._armed = '';
        this.refresh();
    }
    _buildHTML() {
        const app = this.app;
        const face = app.faceReason();
        const meta = FACE_META[face] || { icon: '\u2753', label: '未识别的状态：' + String(face), tone: 'warn' };
        const proj = app.projection() || { rooms: [], timeline: [], roomCount: 0, unreadTotal: 0, hasAny: false, readReceiptOn: true };
        const settings = app.settings;
        const limits = app.limits();
        const parts = [];

        parts.push('<div class="ln-header"><h2>\u{1f4ac} LINE</h2>');
        parts.push('<div class="ln-header-sub">' + this._esc(app.summaryLine()) + '</div></div>');

        parts.push('<div class="ln-face ln-face-' + meta.tone + '">');
        parts.push('<span class="ln-face-icon">' + meta.icon + '</span>');
        parts.push('<span class="ln-face-label">' + this._esc(meta.label) + '</span>');
        parts.push('</div>');

        if (this._flash) parts.push('<div class="ln-flash">' + this._esc(this._flash) + '</div>');

        parts.push('<div class="ln-banner">本页**不连 LINE**：不发请求、不拉贴图、不拉历史。'
            + '会话与消息是你（或者宿主读到之后）喂进来的；贴图只有名字，没有图。'
            + '已读记的是「读到第几条」的游标，不是开关。</div>');

        /* ---------- 会话列表 ---------- */
        parts.push('<div class="ln-rooms">');
        parts.push('<h3 class="ln-list-title">会话 <span class="ln-count">' + proj.roomCount + ' / ' + limits.rooms + '</span></h3>');
        if (!proj.rooms.length) {
            parts.push('<div class="ln-empty">' + (face === LINE_REASONS.storage_absent
                ? '存储读不出来，连「有没有会话」都不知道 —— 这不是「空的」。'
                : '还没有会话。下面可以建一个（单聊 / 群聊 / 官方号）。') + '</div>');
        }
        for (const r of proj.rooms) {
            const icon = KIND_ICON[r.kind] || '\u2753';
            const isOpen = r.id === this._open;
            parts.push('<div class="ln-room' + (isOpen ? ' is-open' : '') + '" data-room="' + this._esc(r.id) + '">');
            parts.push('<div class="ln-room-main">');
            parts.push('<div class="ln-room-title"><span class="ln-room-icon">' + icon + '</span>'
                + '<span class="ln-room-name">' + this._esc(r.name) + '</span>'
                + '<span class="ln-room-kind">' + this._esc(r.kindText) + '</span>'
                + (r.muted ? '<span class="ln-room-muted">静音</span>' : '') + '</div>');
            if (r.last) {
                const what = r.last.recalled ? '（撤回了一条消息）'
                    : (r.last.sticker ? ('[贴图：' + (r.last.stickerName || '未知贴图') + ']') : r.last.text);
                parts.push('<div class="ln-room-last">' + this._esc(r.last.from) + '：' + this._esc(what) + '</div>');
            } else {
                parts.push('<div class="ln-room-last ln-room-last-empty">还没有消息</div>');
            }
            parts.push('<div class="ln-room-meta">' + (r.last ? this._esc(r.last.clock) : '—')
                + ' · ' + r.count + ' 条' + (r.dropped ? ('（挤掉 ' + r.dropped + ' 条）') : '')
                + (r.kind === 'group' ? (' · ' + r.members.length + ' 人') : '') + '</div>');
            parts.push('</div>');
            if (settings.readReceiptOn && r.unread > 0) {
                parts.push('<span class="ln-unread" title="读游标之后还有几条">' + r.unread + '</span>');
            }
            parts.push('</div>');
        }
        parts.push('</div>');

        /* ---------- 打开的会话 ---------- */
        if (this._open) {
            const r = app.room(this._open);
            if (!r) {
                parts.push('<div class="ln-open"><div class="ln-empty">这个会话已经不在了（可能刚被关掉）。</div></div>');
            } else {
                parts.push('<div class="ln-open">');
                parts.push('<h3 class="ln-list-title">' + (KIND_ICON[r.kind] || '\u2753') + ' ' + this._esc(r.name)
                    + ' <span class="ln-count">' + this._esc(this.app.kindText(r.kind) || '未知类型') + ' · ' + r.messages.length + ' / ' + limits.messages + '</span></h3>');
                if (r.kind === 'group' && r.members.length) {
                    parts.push('<div class="ln-members">' + r.members.map((m) => '<span class="ln-member">' + this._esc(m) + '</span>').join('') + '</div>');
                }
                parts.push('<div class="ln-msgs">');
                if (!r.messages.length) {
                    parts.push('<div class="ln-empty">这个会话里还没有消息。</div>');
                }
                for (const m of r.messages) {
                    const mine = m.from === '__me__';
                    parts.push('<div class="ln-msg' + (m.recalled ? ' is-recalled' : '') + (mine ? ' is-mine' : '') + '">');
                    parts.push('<div class="ln-msg-head"><span class="ln-msg-from">' + this._esc(m.from) + '</span>'
                        + '<span class="ln-msg-clock">' + this._esc(this.app.clockText(m.ts)) + '</span></div>');
                    if (m.recalled) {
                        parts.push('<div class="ln-msg-body">（这条被撤回了）</div>');
                    } else if (m.sticker) {
                        parts.push('<div class="ln-msg-body ln-msg-sticker">[贴图：' + this._esc(this.app.stickerName(m.sticker) || '未知贴图') + ']</div>');
                        if (m.text) parts.push('<div class="ln-msg-body">' + this._esc(m.text) + '</div>');
                    } else {
                        parts.push('<div class="ln-msg-body">' + this._esc(m.text) + '</div>');
                    }
                    if (m.truncated) parts.push('<div class="ln-msg-note">超过 ' + limits.text + ' 字，后面截掉了</div>');
                    if (!m.recalled) {
                        parts.push('<div class="ln-msg-acts"><button class="ln-mini ln-recall" data-room="'
                            + this._esc(r.id) + '" data-msg="' + this._esc(m.id) + '">撤回</button></div>');
                    }
                    parts.push('</div>');
                }
                parts.push('</div>');
                /* 发消息 */
                parts.push('<div class="ln-compose">');
                parts.push('<textarea class="ln-input ln-text" maxlength="' + limits.text + '" rows="2" placeholder="说点什么（最多 '
                    + limits.text + ' 字）">' + this._esc(this._text) + '</textarea>');
                parts.push('<div class="ln-compose-row">');
                parts.push('<select class="ln-input ln-sticker">');
                parts.push('<option value=""' + (this._sticker === '' ? ' selected' : '') + '>不带贴图</option>');
                for (const s of this.app.stickers()) {
                    parts.push('<option value="' + this._esc(s.id) + '"' + (this._sticker === s.id ? ' selected' : '') + '>'
                        + this._esc(s.name) + '（' + this._esc(s.pack) + '）</option>');
                }
                parts.push('</select>');
                parts.push('<button class="ln-btn ln-btn-primary ln-send" data-room="' + this._esc(r.id) + '">发出去</button>');
                parts.push('<button class="ln-mini ln-read" data-room="' + this._esc(r.id) + '">标为已读</button>');
                parts.push('<button class="ln-mini ln-close" data-room="' + this._esc(r.id) + '">收起</button>');
                parts.push('<button class="ln-mini ln-drop" data-room="' + this._esc(r.id) + '">关掉这个会话</button>');
                parts.push('</div>');
                parts.push('<div class="ln-hint">发出去的消息署名是「__me__」（本仓不碰宿主角色对象，不拿你的真名）。'
                    + '贴图只有名字，没有图 —— 别指望在这里看到图。</div>');
                parts.push('</div>');
                parts.push('</div>');
            }
        }

        /* ---------- 建会话 ---------- */
        parts.push('<div class="ln-new">');
        parts.push('<h3 class="ln-list-title">新建会话</h3>');
        parts.push('<div class="ln-form-row">');
        parts.push('<input class="ln-input ln-new-id" type="text" maxlength="60" placeholder="id（如 dm-aki）" value="' + this._esc(this._new.id) + '">');
        parts.push('<input class="ln-input ln-new-name" type="text" maxlength="60" placeholder="名字（如 秋）" value="' + this._esc(this._new.name) + '">');
        parts.push('<select class="ln-input ln-new-kind">');
        for (const k of this.app.kinds()) {
            parts.push('<option value="' + this._esc(k) + '"' + (this._new.kind === k ? ' selected' : '') + '>'
                + this._esc(KIND_LABEL[k] || k) + '</option>');
        }
        parts.push('</select>');
        parts.push('</div>');
        parts.push('<input class="ln-input ln-new-members" type="text" maxlength="200" placeholder="群成员（逗号分隔，最多 '
            + limits.members + ' 个；单聊可空）" value="' + this._esc(this._new.members) + '">');
        parts.push('<div class="ln-actions">');
        parts.push('<button class="ln-btn ln-btn-primary ln-create">建这个会话</button>');
        parts.push('</div>');
        if (proj.roomCount >= limits.rooms) {
            parts.push('<div class="ln-warn">会话数已到上限 ' + limits.rooms + ' —— 先关掉一个再建（关掉的会话连同消息一起没，'
                + '这一步本件不代你决定）。</div>');
        }
        parts.push('</div>');

        /* ---------- 时间线读数 ---------- */
        parts.push('<div class="ln-timeline">');
        parts.push('<h3 class="ln-list-title">时间线 <span class="ln-count">最近 ' + limits.timeline + ' 个会话的最后一条</span></h3>');
        if (!proj.timeline.length) {
            parts.push('<div class="ln-empty">还没有任何消息 —— 所以也没有时间线。</div>');
        } else {
            for (const t of proj.timeline) {
                const what = t.recalled ? '（撤回了一条消息）' : ('#' + t.msgId);
                parts.push('<div class="ln-tl-row" data-room="' + this._esc(t.roomId) + '">');
                parts.push('<span class="ln-tl-room">' + this._esc(t.roomName) + '</span>');
                parts.push('<span class="ln-tl-from">' + this._esc(t.from) + '</span>');
                parts.push('<span class="ln-tl-what">' + this._esc(what) + '</span>');
                parts.push('<span class="ln-tl-clock">' + this._esc(this.app.clockText(t.ts)) + '</span>');
                parts.push('</div>');
            }
            parts.push('<div class="ln-hint">时间线只出**引用**（哪个会话、谁、第几条、几时），不复制正文 ——'
                + '正文留在房间里，一处权威。</div>');
        }
        parts.push('</div>');

        /* ---------- 读数 ---------- */
        parts.push('<div class="ln-stats">');
        parts.push('<div class="ln-stat-row"><span>会话</span><span>' + proj.roomCount + ' / ' + limits.rooms + '</span></div>');
        parts.push('<div class="ln-stat-row"><span>未读</span><span>' + (settings.readReceiptOn ? proj.unreadTotal : '（回执关着，不记）') + '</span></div>');
        parts.push('<div class="ln-stat-row"><span>每会话上限</span><span>' + limits.messages + ' 条</span></div>');
        parts.push('<div class="ln-stat-row"><span>单条上限</span><span>' + limits.text + ' 字</span></div>');
        parts.push('<div class="ln-stat-row"><span>账本版本（写序号）</span><span>rev ' + this.app.stateSnapshot().rev + '</span></div>');
        parts.push('</div>');

        /* ---------- 设置 ---------- */
        parts.push('<div class="ln-settings">');
        parts.push('<h3 class="ln-list-title">设置</h3>');
        parts.push('<label class="ln-toggle"><span>把最近消息交给生成侧</span>'
            + '<input type="checkbox" class="ln-set-inject"' + (settings.injectToPrompt ? ' checked' : '') + '></label>');
        parts.push('<label class="ln-toggle"><span>照实记已读回执（关掉就不算未读）</span>'
            + '<input type="checkbox" class="ln-set-receipt"' + (settings.readReceiptOn ? ' checked' : '') + '></label>');
        parts.push('<label class="ln-toggle"><span>官方号也算未读</span>'
            + '<input type="checkbox" class="ln-set-official"' + (settings.officialUnread ? ' checked' : '') + '></label>');
        parts.push('<div class="ln-hint">LINE 随会话走：换角色后那是另一段关系的另一本聊天记录。'
            + '本 App 只记账：不发请求、不起定时器、不读别的 App 的表、不碰角色对象。</div>');
        parts.push('</div>');

        return parts.join('\n');
    }
    _bindEvents() {
        if (!this._root) return;
        const app = this.app;
        const q = (sel) => this._root.querySelector(sel);
        const qa = (sel) => Array.from(this._root.querySelectorAll(sel));
        const done = (msg) => { this._flash = msg || ''; this.refresh(); };

        /* 打开会话 */
        for (const el of qa('.ln-room')) {
            el.addEventListener('click', () => {
                this._open = el.dataset.room || '';
                this._text = '';
                this._sticker = '';
                this._armed = '';
                this.refresh();
            });
        }
        for (const el of qa('.ln-tl-row')) {
            el.addEventListener('click', () => {
                this._open = el.dataset.room || '';
                this._text = '';
                this._sticker = '';
                this._armed = '';
                this.refresh();
            });
        }
        /* 草稿 */
        const ta = q('.ln-text');
        if (ta) ta.addEventListener('input', () => { this._text = ta.value; });
        const sk = q('.ln-sticker');
        if (sk) sk.addEventListener('change', () => { this._sticker = sk.value; });
        /* 发 */
        for (const el of qa('.ln-send')) {
            el.addEventListener('click', () => {
                const roomId = el.dataset.room;
                const text = (this._text || '').trim();
                const sticker = this._sticker || '';
                if (!text && !sticker) { done('既没正文也没贴图 —— 空的发不出去。'); return; }
                const ts = app.nowMs();
                const id = 'lm_' + ts.toString(36) + '_' + Math.random().toString(36).slice(2, 6);
                const r = app.append(roomId, { id: id, from: '__me__', text: text, sticker: sticker, ts });
                if (!r.ok) { done('没发出去：' + (r.error || '原因不明')); return; }
                this._text = '';
                this._sticker = '';
                done('发出去了（' + id + '）。');
            });
        }
        /* 撤回 */
        for (const el of qa('.ln-recall')) {
            el.addEventListener('click', () => {
                const key = el.dataset.room + '|' + el.dataset.msg;
                if (this._armed !== key) { this._armed = key; done('再点一次才真撤回（撤回是留痕，条目还在）。'); return; }
                this._armed = '';
                const r = app.recall(el.dataset.room, el.dataset.msg);
                done(r.ok ? '撤回了 —— 那条还在原位，只是内容变成「被撤回」。' : ('没撤成：' + (r.error || '原因不明')));
            });
        }
        /* 已读 */
        for (const el of qa('.ln-read')) {
            el.addEventListener('click', () => {
                const r = app.markRead(el.dataset.room);
                done(r.ok ? '读游标推到最后一条了。' : ('没有新消息可读：' + (r.error || '原因不明')));
            });
        }
        /* 收起 */
        for (const el of qa('.ln-close')) {
            el.addEventListener('click', () => {
                this._open = '';
                this._text = '';
                this._sticker = '';
                this._armed = '';
                this.refresh();
            });
        }
        /* 关掉会话（两步确认：关掉就连同消息一起没，本件不代用户决定） */
        for (const el of qa('.ln-drop')) {
            el.addEventListener('click', () => {
                const key = 'drop|' + el.dataset.room;
                if (this._armed !== key) { this._armed = key; done('再点一次才真关掉 —— 关掉的会话连同它里面的消息一起没。'); return; }
                this._armed = '';
                /* [v4.211.0] 第二道：统一销毁守卫（不可撤回 + 无宿主确认框一律不放行） */
                const room = app.room(el.dataset.room);
                if (!confirmDestroy({
                    appId: 'line',
                    action: '关掉会话「' + String((room && room.name) || el.dataset.room) + '」',
                    what: '这个会话里的消息会一起没，本件没有回收站可恢复',
                })) { done('没关：确认框里取消了（或者这台宿主没有确认框，按不放行处理）。'); return; }
                const r = app.dropRoom(el.dataset.room);
                if (!r.ok) { done('没关成：' + (r.error || '原因不明')); return; }
                this._open = '';
                this._text = '';
                this._sticker = '';
                done('关掉了这个会话。');
            });
        }
        /* 建会话 */
        const iId = q('.ln-new-id'); if (iId) iId.addEventListener('input', () => { this._new.id = iId.value; });
        const iName = q('.ln-new-name'); if (iName) iName.addEventListener('input', () => { this._new.name = iName.value; });
        const iKind = q('.ln-new-kind'); if (iKind) iKind.addEventListener('change', () => { this._new.kind = iKind.value; });
        const iMem = q('.ln-new-members'); if (iMem) iMem.addEventListener('input', () => { this._new.members = iMem.value; });
        const btnCreate = q('.ln-create');
        if (btnCreate) {
            btnCreate.addEventListener('click', () => {
                const id = (this._new.id || '').trim();
                if (!id) { done('会话得有个 id（用来落盘与找回来）。'); return; }
                const members = (this._new.members || '').split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
                const r = app.upsertRoom({
                    id: id,
                    name: (this._new.name || '').trim() || id,
                    kind: this._new.kind || 'dm',
                    members: members,
                });
                if (!r.ok) { done('没建成：' + (r.error || '原因不明')); return; }
                this._new = { id: '', name: '', kind: 'dm', members: '' };
                done('建好了：' + id + '。');
            });
        }
        /* 设置 */
        const sInj = q('.ln-set-inject');
        if (sInj) sInj.addEventListener('change', () => { app.patchSettings({ injectToPrompt: sInj.checked }); this.refresh(); });
        const sRec = q('.ln-set-receipt');
        if (sRec) sRec.addEventListener('change', () => { app.patchSettings({ readReceiptOn: sRec.checked }); this.refresh(); });
        const sOff = q('.ln-set-official');
        if (sOff) sOff.addEventListener('change', () => { app.patchSettings({ officialUnread: sOff.checked }); this.refresh(); });
    }
}