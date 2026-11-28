/* ========================================================
 * worldpulse-view.js — 世界脉搏视图（照现实那种：底栏三分区）
 * --------------------------------------------------------
 * [v4.213.0] 这一屏原来是「全塞在一滚里」：自动脉搏开关 / 风格 / 阈值 / 队列 /
 *   跨插件世界桥观测面 / 动态流挨着排在同一列。后果有两个，都是信息架构问题：
 *     ① 想看动态，得先滚过一整屏设置；
 *     ② 想知道「桥为什么不通」，得滚到中段去翻一张只读卡片 —— 而那正是最该被
 *        单独摆出来看的东西（本 App 要么陈述真世界、要么退回现编，这个分岔就藏在中段）。
 *   现实里同类客户端不会这么排：信息流是第一格，观测面与设置各自成格。
 *
 *   三格（单一真源 WP_FACES）：
 *     · feed     动态   —— 风格筛片 + 动态流（两种空态分开说：还没有动态 / 这颗筛片没有）
 *     · bridge   世界桥 —— 跨插件世界桥只读观测面（真世界通到哪一步）
 *     · settings 设置   —— 自动脉搏 / 风格 / 阈值 / 队列 / 手动脉冲 / 清空
 *
 *   【纪律】
 *     · 面判定只在 `_renderFaceBody` 一处；底栏按钮、标题、面内容全从 WP_FACES 取，
 *       别处不许再写第二份 if / 第二张标签表；
 *     · 样式全部走 apps/worldpulse/worldpulse.v4.css（入口 phone/design/rp-entry.css
 *       的 @import 投递，在 @layer rp.apps 内）。本视图**不再输出内联样式块**：
 *       无层内联规则会压过层内规则，宿主 data-rp-ds=2 时还会被
 *       `:is(button, …) { all: revert-layer; }` 打回 UA 默认（底栏按钮变灰、padding 0）；
 *     · 现场态（`_face` / `_filter`）只活在这一屏：换页即丢，不落盘、不进 storage。
 *
 *   只读性不变：本视图只调 app 的读取面（getSettings / getHistory / getState /
 *   bridgeStatus）与既有动作面（saveSettings / startListening / stopListening /
 *   manualPulse / clearHistory），不自己写存储、不自己起定时器。
 * ======================================================== */
'use strict';
import { phoneConfirm } from '../../config/phone-feedback.js';
import { WP_STYLES } from './worldpulse-engine.js';
import { projectFeed } from './worldpulse-core.js';

function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
const STYLE_ICON = { '都市日常':'🏙️', '财经头条':'📈', '娱乐八卦':'🍉', '科幻未来':'🚀', '悬疑异闻':'🕵️', '自定义':'✍️' };

/**
 * 底栏三格：单一真源。
 *   ★ 底栏按钮、标题、面内容分派全部从这张表取（判据按形态钉它，
 *     tests/apps-worldpulse-v4.test.mjs）。加一格就在这里加一行。
 *   · feed     —— 动态流（按风格筛片过滤，筛片只改这一屏的视图，不写设置）
 *   · bridge   —— 世界桥只读观测面（桥通不通 / 通到哪一步 / 两个钟差多少）
 *   · settings —— 脉搏怎么跳（开关 / 风格 / 频率 / 队列 / 手动脉冲 / 清空）
 */
export const WP_FACES = Object.freeze([
    { id: 'feed', label: '动态', icon: 'fa-rss', hint: '主线之外，这个世界仍在运转' },
    { id: 'bridge', label: '世界桥', icon: 'fa-tower-broadcast', hint: '跨插件世界桥：真世界通到哪一步' },
    { id: 'settings', label: '设置', icon: 'fa-sliders', hint: '脉搏怎么跳：频率 / 风格 / 手动脉冲' },
]);

export class WorldpulseView {
    constructor(app) {
        this.app = app;
        /* [v4.213.0] 两个现场态：默认落第一格、不筛。不落盘（换页即丢）。 */
        this._face = WP_FACES[0].id;
        this._filter = 'all';
    }

    render() {
        if (!this.app.phoneShell?.setContent) return;
        this.app.phoneShell.setContent(this._layout(), 'worldpulse-main');
        this._bind();
    }

    _layout() {
        return `<div class="wp-wrap wp-app" data-wp-face="${esc(this._face)}">
          <header class="wp-hero">
            <div class="wp-hero-title">🌍 世界脉搏</div>
            <div class="wp-hero-sub">${esc(this._faceHint())}</div>
          </header>
          <div class="wp-body">${this._renderFaceBody()}</div>
          ${this.renderBottomNav()}
        </div>`;
    }

    /** 当前格的说明（取不到就回落第一格，不编一个不存在的名字）。 */
    _faceHint() {
        const hit = WP_FACES.find((f) => f.id === this._face);
        const head = hit ? hit.hint : WP_FACES[0].hint;
        if (this._face !== 'feed') return head;
        const n = this.app.getHistory().length;
        return `${head} · ${n} 条动态`;
    }

    /** 面内容分派（唯一判定处）。 */
    _renderFaceBody() {
        if (this._face === 'bridge') return this._renderBridgeFace();
        if (this._face === 'settings') return this._renderSettingsFace();
        return this._renderFeedFace();
    }

    /** 底栏（排在内容层之后，进正常流，不覆盖内容；热区写在 CSS 里）。 */
    renderBottomNav() {
        const cur = this._face;
        const tabs = WP_FACES.map((f) => {
            const on = f.id === cur;
            return `
                <button type="button" class="wp-nav-btn${on ? ' is-active' : ''}" role="tab"
                        data-wp-face="${esc(f.id)}"
                        aria-selected="${on ? 'true' : 'false'}"${on ? ' aria-current="page"' : ''}>
                    <i class="fa-solid ${esc(f.icon)} wp-nav-icon" aria-hidden="true"></i>
                    <span class="wp-nav-label">${esc(f.label)}</span>
                </button>`;
        }).join('');
        return `<nav class="wp-nav" role="tablist" aria-label="世界脉搏分区">${tabs}</nav>`;
    }

    /* ══════════ 第一格：动态 ══════════ */

    _renderFeedFace() {
        return `<div class="wp-filters" role="tablist" aria-label="按风格筛动态">${this._renderFilterChips()}</div>
          <div class="wp-feed" id="wp-feed-list">${this._renderFeedList()}</div>`;
    }

    _renderFilterChips() {
        const keys = ['all', ...Object.keys(WP_STYLES)];
        return keys.map((k) => {
            const on = k === this._filter;
            const label = k === 'all' ? '🗂️ 全部' : `${STYLE_ICON[k] ?? ''} ${k}`;
            return `<button type="button" class="wp-chip${on ? ' on' : ''}" role="tab"
                        data-wp-filter="${esc(k)}"
                        aria-selected="${on ? 'true' : 'false'}"${on ? ' aria-current="page"' : ''}>${esc(label)}</button>`;
        }).join('');
    }

    /**
     * 动态列表（新→旧）。两种空态分开说：
     *   · 一条都没有 —— 告诉用户怎么让它呼吸起来；
     *   · 有动态但这颗筛片没有 —— 报出总数，别让人误以为世界空了。
     */
    _renderFeedList() {
        const { rows, total } = projectFeed(this.app.getHistory(), this._filter);
        if (!rows.length) {
            if (total) {
                return `<div class="wp-empty" data-wp-empty="filtered">
                    <div class="wp-empty-icon">🔍</div>
                    <div>这颗筛片下还没有动态</div>
                    <div class="wp-empty-sub">共 ${total} 条动态 —— 换一颗筛片，或点「全部」。</div>
                </div>`;
            }
            return `<div class="wp-empty" data-wp-empty="none">
                <div class="wp-empty-icon">🌍</div>
                <div>还没有世界动态</div>
                <div class="wp-empty-sub">去「设置」开启自动脉搏，或点一次「立即脉冲一次」让世界呼吸。</div>
            </div>`;
        }
        return rows.map((e) => `
            <div class="wp-item">
              <div class="wp-item-head"><span class="wp-item-style">${STYLE_ICON[e.style] ?? '🌍'} ${esc(e.style)}</span><span class="wp-item-time">第${esc(String(e.floorCount ?? ''))}楼</span></div>
              <div class="wp-item-text">${esc(e.content)}</div>
            </div>`).join('');
    }

    /* ══════════ 第二格：世界桥（只读观测面） ══════════ */

    _renderBridgeFace() {
        return `${this._bridgeCard()}
          <div class="wp-card wp-bridge-foot">
            <div class="wp-label">这一格为什么单独成格</div>
            <div class="wp-bridge-hint">本 App 的平行事件要么陈述真世界、要么退回 LLM 现编 ——
              这个分岔以前藏在设置卡中间，看不见就等于不存在。摆成单独一格，是为了让「桥没装 / 装了没开 /
              对方引擎没就绪 / 两个钟对不上」这几种情况一眼分开。</div>
          </div>`;
    }

    /**
     * [v2.36.0] 跨插件世界桥卡片：把「桥通不通、通到哪一步、两个钟差多少」摆给用户看。
     *
     * 为什么需要它：本 App 的平行事件要么陈述真世界、要么退回 LLM 现编，而这个**分岔**
     *   此前在界面上完全看不见——用户只看到「又是编的」，看不到原因（桥没装？桥没开？
     *   对方引擎没就绪？两个钟对不上？）。可观测面就是把这段话摆出来。
     * 只读：只调 app.bridgeStatus()（其内部只调两个桥的读取面），不写任何状态。
     */
    _bridgeCard() {
        let st = null;
        try { st = this.app.bridgeStatus(); } catch (_e) { st = null; }
        const br = st && st.bridges ? st.bridges : null;
        if (!br) {
            return `<div class="wp-card wp-bridge"><div class="wp-label">跨插件世界桥</div>
              <div class="wp-bridge-line wp-bridge-off">可观测面不可用（读取失败，已降级）</div></div>`;
        }
        const WA_TXT = {
            'not-mounted': 'WorldAxis 未安装', 'disabled': '世界桥休眠（未开闸）',
            'refused': '世界桥拒绝读取', 'no-snapshot': '桥在但尚无快照',
            'ready': '就绪', 'probe-threw': '探针异常'
        };
        const LO_TXT = {
            'not-mounted': 'LonSha 未安装', 'ready': '就绪',
            'engine-absent': '插件在但引擎未就位', 'engine-empty': '引擎在位但返回空',
            'thrown': '取快照抛错', 'no-snapshot': '桥在但尚未产出快照',
            'probe-threw': '探针异常'
        };
        // [v2.37.0] 优先用 bridgeReport() 的条目（worldBridgeAvailability 只报在场，没有读取结果）；
        const rep = (st && st.report) || null;
        const wi = (rep && rep.worldaxis) || br.worldaxis || {}, lo = (rep && rep.lonsha) || br.lonsha || {};
        const waRead = wi.read || null, loRead = lo.read || null;
        // 「来源态说就绪、这一次却拉不到」也算读不到——不能只看 reason。
        const bad = (wi.reason === 'refused' || wi.reason === 'no-snapshot' || lo.reason === 'thrown' || lo.reason === 'engine-empty'
            || (wi.reason === 'ready' && waRead && waRead.ok === false)
            || (lo.reason === 'ready' && loRead && loRead.ok === false));
        /* [v3.5.0] F-2 来源侧：桥卡片再答一个问题 —— 「记忆侧的事件是谁记的」。
         * 与前两块并列的第三个问题：不是「世界现在什么样」，而是「这条线是插件从正文提的、
         * 还是手机 App 里发生的」——跨平台对照的事实前提。
         * 四态文案直接取真源给出的 line，**视图不重判形态**（真源已把
         * bridge-absent / face-absent / empty / ok 分好）；缺席时如实带出，不写「0 个平台」。
         */
        let epHtml = '';
        if (st && st.eventPlatforms) {
            const ep = st.eventPlatforms;
            /* 三态各有各的色：ok 绿 / empty 中性（真读数，不是故障）/ 其余（缺席、读不出）按故障色。 */
            const cls = ep.state === 'ok' ? ' wp-bridge-ok' : (ep.state === 'empty' ? '' : ' wp-bridge-off');
            const plats = (ep.state === 'ok' && Array.isArray(ep.platforms) && ep.platforms.length)
                ? `<div class="wp-bridge-hint">被标过的平台：${ep.platforms.map(p => esc(p)).join(' · ')}`
                  + `（标签由登记方显式给出、不猜归类、不排重要性）</div>`
                : '';
            epHtml = `<div class="wp-bridge-line${cls}">${esc(ep.line ?? '')}</div>` + plats;
        } else if (st) {
            epHtml = `<div class="wp-bridge-line wp-bridge-off">事件来源：读取失败</div>`;
        }
        /* [v3.10.2 · G-4 余量] 时间侧：三源剧情时刻对照（世界钟 / 插件剧情日期 / 日历当天）。
         *   一致性三态（一致 / 不一致 / 无法验证）与逐源归因**全部取真源**，视图不重判；
         *   不一致时用告警色 —— 三处时间对不上这件事，用户必须看得见。 */
        let clockHtml = '';
        if (st && st.storyClock) {
            const ck = st.storyClock;
            const cls = ck.conflict ? ' wp-bridge-warn' : (ck.present ? ' wp-bridge-ok' : '');
            clockHtml = `<div class="wp-bridge-line${cls}">剧情时刻：${esc(ck.verdict)}`
                + (ck.primaryDate ? '（' + esc(ck.primaryDate) + '）' : '') + `</div>`
                + `<div class="wp-bridge-hint">${esc(ck.detail ?? '')}</div>`;
        } else if (st) {
            clockHtml = `<div class="wp-bridge-line wp-bridge-off">剧情时刻：读取失败</div>`;
        }
        return `<div class="wp-card wp-bridge">
            <div class="wp-label">跨插件世界桥</div>
            <div class="wp-bridge-line ${wi.mounted ? (wi.reason === 'ready' ? 'wp-bridge-ok' : 'wp-bridge-warn') : 'wp-bridge-off'}">
              WorldAxis：${esc(WA_TXT[wi.reason] ?? wi.reason ?? '未知')}${wi.reason === 'ready' && waRead && waRead.ok === false ? '（实际拉取失败：' + esc(waRead.reason ?? 'unknown') + '）' : ''}</div>
            <div class="wp-bridge-line ${lo.mounted ? (lo.reason === 'ready' ? 'wp-bridge-ok' : 'wp-bridge-warn') : 'wp-bridge-off'}">
              LonSha：${esc(LO_TXT[lo.reason] ?? lo.reason ?? '未知')}${lo.reason === 'ready' && loRead && loRead.ok === false ? '（实际拉取失败：' + esc(loRead.reason ?? 'unknown') + '）' : ''}</div>
            ${bad ? `<div class="wp-bridge-line wp-bridge-warn">读不到时本 App 会退回 LLM 生成——两个世界就此对不上</div>` : ''}
            ${rep && rep.consistent === false ? `<div class="wp-bridge-line wp-bridge-warn">来源态与实际读取不一致：桥自述可用、这一次却拉不到——按「实际读取失败」处置</div>` : ''}
            ${rep && rep.summary ? `<div class="wp-bridge-hint">${esc(rep.summary)}</div>` : ''}
            ${epHtml}${clockHtml}
            <div class="wp-bridge-hint">真世界可用时，平行事件陈述真事件、不调 LLM；桥休眠时退回生成（不编数据顶替真世界）。
              「未安装」与「装了没开」是两件事——后者去 WorldAxis 面板开闸即可。</div>
          </div>`;
    }

    /* ══════════ 第三格：设置 ══════════ */

    _renderSettingsFace() {
        const s = this.app.getSettings();
        const st = this.app.getState();
        return `<div class="wp-card">
            <div class="wp-row">
              <span class="wp-label">自动脉搏</span>
              <button class="wp-switch ${s.enabled ? 'on' : ''}" id="wp-toggle" aria-pressed="${s.enabled ? 'true' : 'false'}">${s.enabled ? '开' : '关'}</button>
            </div>
            <div class="wp-row">
              <span class="wp-label">风格</span>
              <div class="wp-styles">${Object.keys(WP_STYLES).map(k =>
                `<button class="wp-style ${s.style === k ? 'on' : ''}" data-style="${esc(k)}">${STYLE_ICON[k] ?? ''} ${esc(k)}</button>`).join('')}</div>
            </div>
            ${s.style === '自定义' ? `<div class="wp-row"><input class="wp-input" id="wp-custom" placeholder="自定义生成指令前缀…" value="${esc(s.customPrefix)}"></div>` : ''}
            <div class="wp-row">
              <span class="wp-label">每 ${s.threshold} 楼一次</span>
              <input type="range" class="wp-range" id="wp-threshold" min="1" max="20" value="${s.threshold}">
            </div>
            <div class="wp-row wp-queue">队列 ${st.queue.length} · 已处理至第 ${st.lastFloorCount} 楼</div>
            <div class="wp-row wp-actions">
              <button class="wp-btn" id="wp-manual">⚡ 立即脉冲一次</button>
              <button class="wp-btn wp-btn-ghost" id="wp-clear">清空历史</button>
            </div>
          </div>`;
    }

    /* ══════════ 绑定 ══════════ */

    _bind() {
        const root = document.querySelector('.wp-app') ?? document;
        const $ = (id) => document.getElementById(id);
        const rerender = () => this.render();

        /* 底栏三格：切格不重取数据（数据在 render 里现取），只换面 + 重画。
         * 换面后把滚动拉回顶部 —— 三格的高度不同，留在旧位置会落在半截。 */
        root.querySelectorAll('.wp-nav-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = btn.dataset.wpFace ?? WP_FACES[0].id;
                if (next === this._face) return;
                this._face = next;
                this.render();
                requestAnimationFrame(() => {
                    const body = document.querySelector('.wp-app .wp-body');
                    if (body) body.scrollTop = 0;
                });
            });
        });

        /* 动态格的风格筛片：只重画列表，不整页重绘（整页重绘会把滚动位置顶回顶部）。 */
        const chips = root.querySelectorAll('.wp-chip');
        chips.forEach((chip) => {
            chip.addEventListener('click', () => {
                const next = chip.dataset.wpFilter ?? 'all';
                if (next === this._filter) return;
                this._filter = next;
                chips.forEach((c) => {
                    const on = (c.dataset.wpFilter ?? 'all') === next;
                    c.classList.toggle('on', on);
                    c.setAttribute('aria-selected', on ? 'true' : 'false');
                    if (on) c.setAttribute('aria-current', 'page');
                    else c.removeAttribute('aria-current');
                });
                const list = document.getElementById('wp-feed-list');
                if (list) list.innerHTML = this._renderFeedList();
            });
        });

        /* 设置格 */
        $('wp-toggle')?.addEventListener('click', () => {
            const s = this.app.getSettings();
            this.app.saveSettings({ enabled: !s.enabled, autoGenerate: !s.enabled });
            if (!s.enabled) this.app.startListening(); else this.app.stopListening();
            rerender();
        });
        root.querySelectorAll('.wp-style').forEach(b => b.addEventListener('click', () => {
            this.app.saveSettings({ style: b.dataset.style }); rerender();
        }));
        $('wp-custom')?.addEventListener('change', e => this.app.saveSettings({ customPrefix: e.target.value }));
        $('wp-threshold')?.addEventListener('change', e => { this.app.saveSettings({ threshold: Number(e.target.value) }); rerender(); });
        $('wp-manual')?.addEventListener('click', async e => {
            e.target.disabled = true; e.target.textContent = '⏳ 生成中…';
            await this.app.manualPulse();
            rerender();
        });
        $('wp-clear')?.addEventListener('click', () => { if (phoneConfirm('清空全部世界动态历史？')) { this.app.clearHistory(); this.render(); } });
    }
}
