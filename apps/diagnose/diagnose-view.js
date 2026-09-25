/* ========================================================
 * diagnose-view.js - 诊断中心 · 视图 [v2.99.0]
 * --------------------------------------------------------
 * 纯渲染：本文件不做任何判断，一切结论由 diagnose-data.js 给出。
 * 为什么把「判断」全部推到内核：本仓反复踩到「视图自己兜底推出一个结论」，
 * 于是不同 App 对同一份读数给出互相矛盾的说法（v2.98 的 FACE_META 键形
 * 漂移就是这类：视图的键与真源常量不同形，兜底改写归因）。
 * ======================================================== */
'use strict';

import { collectDiagnose, fieldReasonText, bridgeReasonText, projAbsentText, sourceStateText, injectionLine, injectionVerdictText, blockLine, summarizeDiagnose } from './diagnose-data.js';
import { projectionLine } from '../../config/projection-contract.js';

const Q = String.fromCharCode(34);

/** 样式表 URL（自注入；与 album/diary 的 view 同做法）*/
const DIAGNOSE_CSS_URL = new URL('./diagnose.css?v=1.0.0', import.meta.url).href;

/** HTML 转义（不写字面双引号：本仓视图一律单引号属性，避免转义层数手数） */
export function escapeHtml(v) {
    return String(v == null ? '' : v)
        .split('&').join('&amp;')
        .split('<').join('&lt;')
        .split('>').join('&gt;')
        .split(Q).join('&#34;')
        .split(String.fromCharCode(39)).join('&#39;');
}

export class DiagnoseView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
    }

    /** 自注入样式（幂等；已存在同 id 则不重注） */
    loadCSS() {
        try {
            if (this._cssLoaded) return;
            if (document.getElementById('diagnose-css')) { this._cssLoaded = true; return; }
            const link = document.createElement('link');
            link.id = 'diagnose-css';
            link.rel = 'stylesheet';
            link.href = DIAGNOSE_CSS_URL;
            document.head.appendChild(link);
            this._cssLoaded = true;
        } catch (_e) { /* CSS 注入失败不得阻断渲染 */ }
    }

    _esc(v) { return escapeHtml(v); }

    _chip(text, tone) {
        return '<span class=' + Q + 'dg-chip dg-' + escapeHtml(tone || 'muted') + Q + '>' + escapeHtml(text) + '</span>';
    }

    /** 桥面：两台上游桥的在场 + 来源态 + 读取结果 + 自洽性 */
    _bridgesHtml(rep) {
        const rows = [];
        const one = (label, side) => {
            const s = side || {};
            const mounted = s.mounted === true;
            const tone = !mounted ? 'muted' : (String(s.reason) === 'ready' ? 'ok' : 'warn');
            const read = s.read
                ? ('实际读取：' + (s.read.ok ? '成功' : '失败（' + escapeHtml(s.read.reason) + '）'))
                : '实际读取：未尝试';
            const extra = (s.sourceState || s.enabled !== undefined)
                ? '<div class=' + Q + 'dg-sub' + Q + '>自述：' + escapeHtml(s.sourceState || ('enabled=' + String(s.enabled)))
                  + (s.lastError ? ' · lastError=' + escapeHtml(s.lastError) : '') + '</div>'
                : '';
            rows.push('<div class=' + Q + 'dg-row' + Q + '><span class=' + Q + 'dg-name' + Q + '>' + escapeHtml(label) + '</span>'
                + this._chip(bridgeReasonText(s.reason), tone)
                + '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(read) + '</div>' + extra + '</div>');
        };
        one('WorldAxis 世界桥', rep.worldaxis);
        one('LonSha 记忆插件桥', rep.lonsha);
        const clock = rep.clock || {};
        rows.push('<div class=' + Q + 'dg-row' + Q + '><span class=' + Q + 'dg-name' + Q + '>两钟对账</span>'
            + this._chip(String(clock.verdict || 'unparsable'), clock.verdict === 'same' ? 'ok' : 'muted')
            + '<div class=' + Q + 'dg-sub' + Q + '>'
            + escapeHtml(clock.days === null || clock.days === undefined ? '' : ('相差 ' + clock.days + ' 天')) + '</div></div>');
        rows.push('<div class=' + Q + 'dg-note' + (rep.consistent === true ? '' : ' dg-bad') + Q + '>'
            + (rep.consistent === true
                ? '自洽性：桥自述与实际读取一致。'
                : '【注意】自洽性不成立：桥说它就绪、实际却拉不到（或反之）。这一条不成立时，上面的「就绪」不可信。')
            + '</div>');
        return rows.join('');
    }

    /** 上游自述面：字段三态逐字段列出（把 v2.98 的消费面变成可看的） */
    _fieldsHtml(pkg) {
        const list = Array.isArray(pkg.fields) ? pkg.fields : [];
        if (!list.length) return '<div class=' + Q + 'dg-note' + Q + '>无字段清单（本版未登记消费面）。</div>';
        return '<div class=' + Q + 'dg-table' + Q + '>' + list.map((f) => {
            const tone = f.reason === 'value' ? 'ok' : (f.reason === 'absent' ? 'muted' : 'warn');
            return '<div class=' + Q + 'dg-trow' + Q + '><code class=' + Q + 'dg-key' + Q + '>' + escapeHtml(f.key) + '</code>'
                + '<span class=' + Q + 'dg-face' + Q + '>' + escapeHtml(f.face) + ' · ' + escapeHtml(f.app) + '</span>'
                + this._chip(fieldReasonText(f.reason), tone)
                + '<span class=' + Q + 'dg-face' + Q + '>面级：' + escapeHtml(f.faceState) + '</span></div>';
        }).join('') + '</div>'
        + '<div class=' + Q + 'dg-note' + Q + '>「上游明说：源里没这项」与「上游明说：这面是空」是两种不同处境，'
        + '此前被压成同一个读不出；「旧版桥：读不出」是第三种，本页把三者分开报（v2.98.0 的消费面）。</div>';
    }

    /** 返回栈（v2.99 新增能力） */
    _backHtml(pkg) {
        const b = pkg.backStack || {};
        const tags = Array.isArray(b.tags) ? b.tags : [];
        let html = '<div class=' + Q + 'dg-row' + Q + '><span class=' + Q + 'dg-name' + Q + '>返回键守卫</span>'
            + this._chip(b.armed ? '已接管' : '未接管', b.armed ? 'ok' : 'muted')
            + this._chip('可关层 ' + String(b.closers || 0), (b.closers || 0) > 0 ? 'ok' : 'muted') + '</div>';
        if (tags.length) {
            html += '<div class=' + Q + 'dg-sub' + Q + '>层序（后开的先关）：' + escapeHtml(tags.slice().reverse().join(' < ')) + '</div>';
        }
        if (Number(b.dropped) > 0) {
            html += '<div class=' + Q + 'dg-note dg-bad' + Q + '>【注意】有 ' + escapeHtml(String(b.dropped)) + ' 次压入被拒（层数超过上限）：'
                + '说明有浮层注册了却没注销，返回栈在累积。</div>';
        }
        if (b.lastClose) {
            html += '<div class=' + Q + 'dg-sub' + Q + '>上一次返回关掉的是：' + escapeHtml(b.lastClose) + '</div>';
        }
        html += '<div class=' + Q + 'dg-note' + Q + '>返回顺序 = 后开的先关（LIFO）。此机制 v2.99.0 从上游「瑟瑟小手机 V1.059」的 __ubBackGuard 缝入；'
            + '本仓此前全库零 popstate，物理返回键与浏览器返回完全不响应，右滑也只退视图、不关浮层。</div>';
        return html;
    }

    /** 源键规则 + 现场自检 */
    _sourceKeysHtml(pkg) {
        const rb = pkg.rulebook || {};
        const sites = Array.isArray(pkg.sourceKeys) ? pkg.sourceKeys : [];
        let html = '<div class=' + Q + 'dg-sub' + Q + '>源键基名不放可变状态（v2.93.0 教训）：'
            + '身份一旦随状态漂移，「新增/改写/回收」三条出口写得再齐也全是死的。</div>';
        html += '<div class=' + Q + 'dg-chips' + Q + '>规则词表：'
            + (rb.volatileSegments || []).map((t) => this._chip(t, 'warn')).join('') + '</div>';
        html += '<div class=' + Q + 'dg-chips' + Q + '>允许尾缀（分类而非状态）：'
            + (rb.allowedTail || []).map((t) => this._chip(t, 'ok')).join('') + '</div>';
        html += '<div class=' + Q + 'dg-table' + Q + '>' + sites.map((s) => {
            return '<div class=' + Q + 'dg-trow' + Q + '><code class=' + Q + 'dg-key' + Q + '>' + escapeHtml(s.sample) + '</code>'
                + this._chip(s.ok ? '合规' : ('违规：' + s.reason), s.ok ? 'ok' : 'bad')
                + '<span class=' + Q + 'dg-face' + Q + '>' + escapeHtml(s.file) + '</span></div>'
                + '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(s.note || '') + '</div>';
        }).join('') + '</div>';
        return html;
    }

    /** [v3.0.0] 投影契约面：上游投影的「有值 / 空 / 缺席」分面展示 */
    _projHtml(pkg) {
        const pj = pkg.projection || null;
        if (!pj) return '<div class=' + Q + 'dg-note' + Q + '>投影面读取失败（已降级）</div>';
        let html = '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(projectionLine(pj)) + '</div>';
        if (pj.reason !== 'ready') return html;
        html += '<div class=' + Q + 'dg-sub' + Q + '>身份：会话 ' + escapeHtml(pj.identity.conversationId == null ? '（未提供）' : pj.identity.conversationId)
            + ' · 场景 ' + escapeHtml(pj.identity.sceneId == null ? '（未提供）' : pj.identity.sceneId)
            + ' · 世界 ' + escapeHtml(pj.identity.worldId == null ? '（未提供）' : pj.identity.worldId)
            + ' · 修订 ' + escapeHtml(pj.revision == null ? '（未提供）' : String(pj.revision)) + '</div>';
        const items = Array.isArray(pkg.projItems) ? pkg.projItems : [];
        html += '<div class=' + Q + 'dg-table' + Q + '>' + items.map((it) => {
            const isW = it.visibility === 'withheld';
            const tone = isW ? 'warn' : (it.present ? 'ok' : 'muted');
            const label = isW ? ('上游扣下：' + projAbsentText(it.reason)) : (it.present ? ('有值（' + it.kind + '）') : '上游明说：这项是空');
            return '<div class=' + Q + 'dg-trow' + Q + '><code class=' + Q + 'dg-key' + Q + '>' + escapeHtml(it.id) + '</code>'
                + this._chip(label, tone) + '</div>';
        }).join('') + '</div>';
        return html;
    }

    /** [v3.0.1] 探针自述面：`readPushProbe` 的 `sourceState` / `lastError`（此前零消费）。
     *  与「上游桥」卡的分工：那张卡读的是 `bridgeReport` 的**汇总**（含 enabled / read 等合成字段），
     *  这张卡读的是**裸探针自述**（这次取快照时上游说了什么）。两者不同源、不互相顶替。 */
    _probeSelfHtml(pkg) {
        const s = pkg.probeSelf || null;
        if (!s) return '<div class=' + Q + 'dg-note' + Q + '>探针自述面读取失败（已降级）</div>';
        const tone = !s.mounted ? 'muted' : (s.lastError || s.sourceState === 'thrown' ? 'bad' : (s.sourceState === 'ready' ? 'ok' : 'warn'));
        let html = '<div class=' + Q + 'dg-row' + Q + '><span class=' + Q + 'dg-name' + Q + '>统一探针</span>'
            + this._chip(s.mounted ? '在场' : '未装', s.mounted ? 'ok' : 'muted')
            + this._chip(String(s.id == null ? '（未报 id）' : s.id), 'muted') + '</div>';
        html += '<div class=' + Q + 'dg-sub' + Q + '>探针归因：' + escapeHtml(bridgeReasonText(s.reason)) + '</div>';
        html += '<div class=' + Q + 'dg-sub' + Q + '>上游自述 sourceState：'
            + this._chip(s.sourceState == null ? '（未提供）' : sourceStateText(s.sourceState), tone) + '</div>';
        html += '<div class=' + Q + 'dg-sub' + Q + '>' + (s.lastError
            ? ('lastError：' + escapeHtml(s.lastError))
            : 'lastError：（未提供）') + '</div>';
        html += '<div class=' + Q + 'dg-note' + Q + '>上游 v3.174 起把「记忆引擎没就位 / 返回空 / 取值抛错」'
            + '写进桥自己的 sourceState，并让 lastError 不吞。这一面自 v2.97.0 起下游零消费 —— '
            + '用户只能看到一个笼统的「不可读」；v3.0.1 起收进本页并进总述首行（坏消息先说）。</div>';
        return html;
    }

    /** [v3.0.2] R2-C 注入读数卡：本轮**最终实际注入**（此前全库零消费）。
     *  与织光机「回望」卡的分工：那张读的是召回侧（想起了什么），
     *  这张读的是**送达侧**（真正进了上下文的块 / 被预算裁掉的块）。 */
    _injectionHtml(pkg) {
        const inj = pkg.injection || null;
        if (!inj) return '<div class=' + Q + 'dg-note' + Q + '>注入面读取失败（已降级）</div>';
        const tone = (inj.reason !== 'ready') ? 'muted'
            : (inj.verdict === 'injected' ? 'ok' : 'warn');
        let html = '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(injectionLine(inj)) + '</div>';
        html += '<div class=' + Q + 'dg-row' + Q + '><span class=' + Q + 'dg-name' + Q + '>裁定</span>'
            + this._chip(inj.reason === 'ready' ? injectionVerdictText(inj.verdict) : inj.reason, tone) + '</div>';
        if (inj.reason === 'ready') {
            html += '<div class=' + Q + 'dg-sub' + Q + '>来源：' + escapeHtml(String(inj.origin == null ? '（未给）' : inj.origin))
                + ' · 轮次 ' + escapeHtml(String(inj.round == null ? '（未给）' : inj.round))
                + ' · 候选 ' + escapeHtml(String(inj.total)) + ' 块 · 保留 ' + escapeHtml(String(inj.kept))
                + ' · 裁掉 ' + escapeHtml(String(inj.dropped)) + '</div>';
            if (inj.strayOrigin) {
                html += '<div class=' + Q + 'dg-note dg-bad' + Q + '>【注意】这份读数**不是真生成写的**（origin=' + escapeHtml(String(inj.origin))
                    + '）—— 「AI 真实所见」被别的东西改写过，读数不可信。</div>';
            }
            const blocks = Array.isArray(pkg.injBlocks) ? pkg.injBlocks : [];
            if (blocks.length) {
                html += '<div class=' + Q + 'dg-table' + Q + '>' + blocks.map((b) => {
                    return '<div class=' + Q + 'dg-trow' + Q + '><code class=' + Q + 'dg-key' + Q + '>' + escapeHtml(b.ref || ('#' + b.id)) + '</code>'
                        + this._chip(b.kept ? '进了上下文' : '被预算裁掉', b.kept ? 'ok' : 'warn')
                        + '<span class=' + Q + 'dg-face' + Q + '>' + escapeHtml(blockLine(b)) + '</span></div>';
                }).join('') + '</div>';
            }
        }
        html += '<div class=' + Q + 'dg-note' + Q + '>上游记忆插件的「最终实际注入」读数（v3.215.0 起外供，v3.216.0 起落地不早于代际确认）。'
            + '「读到 0 块候选（召回没给素材）」与「候选全被预算裁掉（素材有、预算关门）」是两件处置方向相反的事，本页分开报。</div>';
        return html;
    }

    render(container) {
        if (!container) return;
        this.loadCSS();
        const pkg = collectDiagnose();
        const summary = summarizeDiagnose(pkg);
        const bad = /^需注意/.test(summary);
        const h = [];
        h.push('<div class=' + Q + 'dg-root' + Q + '>');
        h.push('  <div class=' + Q + 'dg-head' + Q + '>');
        h.push('    <div class=' + Q + 'dg-title' + Q + '>诊断中心</div>');
        h.push('    <div class=' + Q + 'dg-summary' + (bad ? ' dg-bad' : '') + Q + '>' + escapeHtml(summary) + '</div>');
        h.push('  </div>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>上游桥</h3>' + this._bridgesHtml(pkg.bridgeReport || {}) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>探针自述（sourceState / lastError）</h3>' + this._probeSelfHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>上游自述面 · 字段三态</h3>' + this._fieldsHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>投影契约（上游投影面）</h3>' + this._projHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>注入读数（本轮实际注入）</h3>' + this._injectionHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>返回栈</h3>' + this._backHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>源键规则</h3>' + this._sourceKeysHtml(pkg) + '</section>');
        h.push('</div>');
        container.innerHTML = h.join('');
    }
}

export default DiagnoseView;
