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
import { schemaStateText, storageFaceLine, evidenceFaceText, knowledgeFaceText, storyClockFaceText } from './diagnose-data.js';
import { rollbackPreviewFaceText, rollbackPreviewRows } from './diagnose-data.js';
/* [v3.13.0 · 计划 #14] 启动耗时面：一行文案与逐段明细**都走内核转发**（本文件不自拼）。 */
import { bootTimingFaceText, bootTimingRows } from './diagnose-data.js';
/* [v3.19.0 · 计划一「共同配套」第 2 条] 跨仓功能登记面：一行总述走内核转发（本文件不自拼）。 */
import { crossRepoFaceText } from './diagnose-data.js';
/* [v3.20.2] 上游检查点「内容级只读对照」面：一行文案与逐条明细**都走内核转发**（本文件不自拼结论，
 *   也不直摸上游全局 —— 本仓纪律：视图纯渲染，一切结论由 diagnose-data.js 给出）。 */
import { checkpointFaceText, sessionGateFaceText } from './diagnose-data.js';
import { outcomeText, injectionFaceKeys } from '../../config/injection-contract.js';
import { projectionLine } from '../../config/projection-contract.js';
import { projectionFreshnessText } from '../../config/world-bridge.js';
import { noteSilenceCycle, silenceAlerts, silenceLedgerFace, resetSilenceLedger } from '../../config/silence-guard.js';

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

    /**
     * [v3.11.0 · F-1 替代轴] 回滚影响预览卡：把「删这一楼会连带丢掉什么」摆在删之前。
     *  纯渲染：四态与逐域文案全部来自真源（`rollbackPreviewFaceText` / `rollbackPreviewRows`），
     *  本方法**不做任何判断**（不数条数、不猜域）。
     *  三条必须看见的东西（缺一条这张卡就失去意义）：
     *    · **两种语义分列**：`及之后`（删楼/回滚）与 `正好该楼`（编辑重放该楼）给出的条数
     *      方向相反，混成一格用户会照着一个方向的数去做另一个方向的决定；
     *    · **读不到 ≠ 0 条**：`absent` 域显式写「读不到（不等于 0 条）」，
     *      与 `zero` 的「0 条（这一楼不影响它）」在界面上长得不一样；
     *    · **下界说出来**：微信正文按会话懒加载，未加载的会话只算已加载部分，
     *      读数标注为下界，绝不静默给一个偏低但看起来完整的数。
     */
    _rollbackPreviewHtml(pkg) {
        const pv = (pkg && pkg.rollbackPreview) || null;
        if (!pv) return '<div class=' + Q + 'dg-note' + Q + '>回滚影响预览读取失败（已降级）</div>';
        let html = '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(rollbackPreviewFaceText(pv.rollback)) + '</div>';
        html += '<div class=' + Q + 'dg-sub' + Q + '>另一种语义：' + escapeHtml(rollbackPreviewFaceText(pv.replay)) + '</div>';
        if (pv.floorOk !== true) {
            html += '<div class=' + Q + 'dg-note' + Q + '>楼层不可算 —— 当前会话读不到楼层（**不是**「0 条影响」）。'
                + '没有楼层就没有作废范围，此时任何一个域的「0 条」都不是结论。</div>';
            return html;
        }
        const rows = rollbackPreviewRows(pv.rollback);
        const toneOf = (st) => (st === 'hit' ? 'warn' : (st === 'partial' ? 'warn' : 'muted'));
        html += '<div class=' + Q + 'dg-table' + Q + '>'
            + this._chip('当前楼层 ' + String(pv.floor), 'muted')
            + rows.map((r) => '<div class=' + Q + 'dg-trow' + Q + '><code class=' + Q + 'dg-key' + Q + '>'
                + escapeHtml(r.id) + '</code>' + this._chip(r.label, 'muted')
                + this._chip(r.text, toneOf(r.state)) + '</div>').join('')
            + '</div>';
        const srcs = Array.isArray(pv.sources) ? pv.sources : [];
        if (srcs.length) {
            html += '<div class=' + Q + 'dg-note' + Q + '>取数归因：'
                + srcs.map((s) => escapeHtml(s.id + '=' + s.state)).join(' · ') + '</div>';
        }
        html += '<div class=' + Q + 'dg-note' + Q + '>口径纪律：<b>只算不执行</b> —— 本卡只回答「这次动作会让哪些域各丢几条」，'
            + '**不会**替你回滚、不会备份、也不报金额（钱包流水作废时会反向冲回余额，报金额等于预演副作用，'
            + '而副作用是否与真回滚逐分一致、本层无法自证 —— 如实少报一层，好过给出一个没人能核对的数）。</div>';
        return html;
    }
    /** [v3.20.2] 上游检查点「内容级只读对照」卡：把「两份检查点之间内容级差了什么」摆出来。
     *
     *  【这张卡治的欠债】上游 v3.252.0 交付了 `diffPayloadsDeep`（键面之上叠一层逐条内容差异），
     *    而下游零消费 ⇒ 用户看到的仍只有「键一样、字节差不多」，而计划二 F7 点名的那类改变
     *    （「余额 100→900」「朋友→仇人」：**同键同长度但值不同**）在手机端**零读数**。
     *
     *  【三条必须看见的东西（缺一条这张卡就失去意义）】
     *    · **五态各有各的话**：记忆插件不在场 / 本版没这面（旧版）/ 清单读不到 /
     *      还没有检查点（**真读数**）/ 有 —— 全由内核真源分好，卡片只转发。
     *      把「读不到」渲染成「还没有检查点」是本仓最贵的那类错读数；
     *    · **半成功不得当失败**：上游在「深比较这版没有」时仍给键面读数，
     *      卡片必须把这句话原样念出来（与「两边内容完全一样」不是一回事）；
     *    · **文案走上游**：多行对照文案的唯一实现是上游 `checkpointContentDiffLines`，
     *      本卡只转发（不自拼 —— 自拼一份就是第二处「这句话该怎么说」的知识）。
     *  纯渲染：不取数、不判定、不重算差异。 */
    _checkpointHtml(pkg) {
        const cp = (pkg && pkg.checkpoint) || null;
        if (!cp) {
            return '<div class=' + Q + 'dg-note dg-bad' + Q + '>检查点面读取失败（已降级）—— '
                + '这是「本层读不出」，**不是**「还没有检查点」。</div>';
        }
        let html = '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(checkpointFaceText(cp)) + '</div>';
        /* 对照只在「有两份及以上」时才有意义；只有一份时**明说没什么可比**，
         *   不渲染成一格空白（空白与「比过了，一样」同形）。 */
        if (!cp.pair || !cp.diff) {
            if (cp.state === 'ok') {
                html += '<div class=' + Q + 'dg-note' + Q + '>只有一份检查点，暂无可对照的两份 —— '
                    + '这里**不是**「比过了、内容一样」。</div>';
            }
            return html;
        }
        const d = cp.diff;
        html += '<div class=' + Q + 'dg-sub' + Q + '>对照 <code class=' + Q + 'dg-key' + Q + '>'
            + escapeHtml(cp.pair.a) + '</code> ↔ <code class=' + Q + 'dg-key' + Q + '>'
            + escapeHtml(cp.pair.b) + '</code>（只对照，不改任何一份）</div>';
        if (d.state !== 'readable') {
            html += '<div class=' + Q + 'dg-note dg-bad' + Q + '>对照读不到（'
                + escapeHtml(String(d.reason || 'unknown')) + '）—— 这是「本层读不出」，**不是**「没有差异」。</div>';
            return html;
        }
        if (String(cp.diffLines || '').trim()) {
            html += '<pre class=' + Q + 'dg-pre' + Q + '>' + escapeHtml(cp.diffLines) + '</pre>';
        }
        return html;
    }
    /** [v3.58.0 · 计划 O4] 会话世代栅栏卡：把「被挡下的旧会话回信」摆到可见面上。
     *
     *  【这张卡治的欠债】v3.58.0 给七族回信写回点（生图 / 微博 / 蜜语 / 日程 / 日记 /
     *    微信图片 / 朋友圈图片）装了会话世代栅栏，挡下时**不抛异常、不弹窗**
     *    （抛异常会打断调用方的 finally 清理，弹窗会吵）—— 于是它「安静地正确」，
     *    也「安静到没人知道它是否真的挡过谁」。计划 O4 的验收原文点名：
     *    「旧响应有**可读的拒绝原因**」。本卡就是那份可读。
     *
     *  【三条必须看见的东西（缺一条这张卡就失去意义）】
     *    · **三态各有各的话**（全在内核真源 `sessionGateFaceText` 里分好）：
     *      读不到账本 / 读到但零条 / 读到有挡下 —— 三句文案互不相同；
     *      把「读不到账本」渲染成「本轮没挡过」是本仓最贵的那类反向错读数；
     *    · **零条是正常读数，不是坏消息**：本轮没有跨会话回信时不该出现任何告警色 ——
     *      把「没有异常」谎报成「机制坏了」会让人去修一个没坏的东西；
     *    · **每条给得出域名与中文原因**：域名叫得出「是哪一族回信」（如 wechat-image），
     *      原因为四种裁决之一（令牌畸形 / 身份取不到 / 会话已切换 / 世代已变）——
     *      只说「挡了一条」而不能说「挡了谁、为什么」等于没说。
     *  纯渲染：取数与三态判定全在内核（`collectDiagnose` 的 `sessionGate` 面 + `sessionGateFaceText`），
     *  本方法不自己数条数、不自己判原因（那都是同一口径的第二份实现）。 */
    _sessionGateHtml(pkg) {
        const face = (pkg && pkg.sessionGate) || null;
        if (!face) {
            return '<div class=' + Q + 'dg-note dg-bad' + Q + '>读不到会话世代栅栏面（已降级）—— '
                + '这是「本层读不出」，**不是**「没有被挡下的回信」。</div>';
        }
        let html = '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(sessionGateFaceText(face)) + '</div>';
        if (face.ok !== true) return html;
        if (!face.count) {
            html += '<div class=' + Q + 'dg-note' + Q + '>零条是**正常**读数：本轮没有跨会话回信落地，'
                + '不代表栅栏没生效（栅栏只在该挡的时候出现读数）。</div>';
            return html;
        }
        const rows = Array.isArray(face.rows) ? face.rows : [];
        html += '<div class=' + Q + 'dg-table' + Q + '>' + rows.map((r) => (
            '<div class=' + Q + 'dg-trow' + Q + '><code class=' + Q + 'dg-key' + Q + '>'
            + escapeHtml(String(r.domain || 'unknown')) + '</code>'
            + this._chip(String(r.reason || 'unknown'), 'warn')
            + '<span class=' + Q + 'dg-face' + Q + '>' + escapeHtml(String(r.text || '')) + '</span></div>'
        )).join('') + '</div>';
        html += '<div class=' + Q + 'dg-note' + Q + '>口径：被挡下的回信**一条都没落盘**（不写正文、不推游标、不点红点），'
            + '账本有界（只留最近若干条）—— 遥测本身不得成为新的泄漏源。</div>';
        return html;
    }
    /** [v3.13.0 · 计划 #14] 启动耗时卡：把「谁拖慢了启动」摆在用户面前。
     *  三条必须看见的东西（缺一条这张卡就失去意义）：
     *    · **逐段**而不是只有总数：既有那两句 console.log 只报合计，
     *      读得出「慢不慢」读不出「谁慢」—— 卡片的主体是段表；
     *    · **不可测时的段单独列出、绝不进耗时排序**：没有 ms 的段混进耗时表里，
     *      会把「测不出」伪装成「很快」（本仓最贵的错读数形态）；
     *    · **重复加载点单列**：同一模块被多路 import（带不同 cache-busting query 时
     *      浏览器不共享实例）是真开销，也是真线索。
     *  纯渲染：段表排序与截断都在内核（`bootTimingRows`），本方法不自己排。 */
    _bootTimingHtml(pkg) {
        const face = (pkg && pkg.bootTiming) || null;
        if (!face) {
            return '<div class=' + Q + 'dg-note' + Q + '>读不到启动耗时面 —— 宿主未挂 '
                + '<code class=' + Q + 'dg-key' + Q + '>VirtualPhone.bootTiming</code>'
                + '（旧版插件或本页在插件初始化前打开）。这是「没这个读数」，**不是**「启动很快」。</div>';
        }
        let html = '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(bootTimingFaceText(face)) + '</div>';
        if (face.clock === 'absent') {
            html += '<div class=' + Q + 'dg-note dg-bad' + Q + '>本环境无 <code class=' + Q + 'dg-key' + Q + '>performance.now</code>：'
                + '只记了 ' + escapeHtml(String(face.spans || 0)) + ' 段的**顺序**，'
                + '所有耗时如实留空（不编 0）—— 顺序信息仍然有用：它就是加载先后。</div>';
        }
        const rows = bootTimingRows(face, 40);
        const spanRows = rows.filter((r) => !r.isMark);
        const marks = rows.filter((r) => r.isMark);
        if (spanRows.length) {
            html += '<div class=' + Q + 'dg-table' + Q + '>' + spanRows.map((r) => {
                const tone = r.failed ? 'warn' : (r.state === 'measured' ? 'ok' : 'muted');
                const msText = (r.ms === null) ? '不可测时' : (Math.round(r.ms) + 'ms');
                return '<div class=' + Q + 'dg-trow' + Q + '><code class=' + Q + 'dg-key' + Q + '>' + escapeHtml(r.name) + '</code>'
                    + this._chip(msText, tone)
                    + (r.failed ? this._chip('加载失败', 'warn') : '')
                    + (r.spec && r.spec !== r.name ? '<span class=' + Q + 'dg-face' + Q + '>' + escapeHtml(r.spec) + '</span>' : '')
                    + '</div>';
            }).join('') + '</div>';
        } else {
            html += '<div class=' + Q + 'dg-note' + Q + '>还没有任何段被记账 —— 本页可能在启动完成之前就被打开了。</div>';
        }
        if (marks.length) {
            html += '<div class=' + Q + 'dg-chips' + Q + '>顺序打点：'
                + marks.map((r) => this._chip(r.name, 'muted')).join('') + '</div>';
        }
        if ((face.unmeasurable || 0) > 0 && face.clock !== 'absent') {
            html += '<div class=' + Q + 'dg-note dg-bad' + Q + '>【注意】有 ' + escapeHtml(String(face.unmeasurable))
                + ' 段**不可测时**（它们已从上面的耗时排序里摘出、也不计入合计）：'
                + '这些段没坏，只是钟在那一刻读不到 —— 把它们的耗时当 0 会把「读不到」当成「很快」。</div>';
        }
        if ((face.overflow || 0) > 0) {
            html += '<div class=' + Q + 'dg-note' + Q + '>另有 ' + escapeHtml(String(face.overflow))
                + ' 段超出明细上限（只计数不留明细，防长会话膨胀）。</div>';
        }
        const rep = Array.isArray(face.repeatedSpecs) ? face.repeatedSpecs : [];
        if (rep.length) {
            html += '<div class=' + Q + 'dg-note' + Q + '>重复加载点 ' + rep.length + ' 个：'
                + rep.slice(0, 6).map((x) => escapeHtml(x.spec + '×' + x.times)).join(' · ')
                + '（带不同 cache-busting query 时浏览器不共享模块实例，是真开销也是真线索）</div>';
        }
        html += '<div class=' + Q + 'dg-note' + Q + '>口径纪律：<b>本卡只读数，不做优化</b> —— 本版一条加载路径都没改'
            + '（不改顺序、不改并发、不拆包、不预加载）。读数是优化的**前置条件**：先能看见谁慢，再谈改哪'
            + '（没有读数的优化是把直觉当证据）。耗时缺失一律如实报「不可测时」，绝不报 0ms。</div>';
        return html;
    }
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
        /* [v3.6.0 · R1-C] 「投影缺席」必须先回答「是扔掉了还是本来就没这面」：
         *   本卡上方原样显示上游给的那句话（`no-projection-face` 的文案），
         *   但若 `meta.projectionFreshness` 说它被守卫扣下了，这里必须**当场纠正**，
         *   否则用户读到的是「需记忆插件 v3.212+」——一句对「被扣下」处境**事实错误**的归因。 */
        const fresh = pkg.freshness || null;
        if (fresh && fresh.dropped === true) {
            html += '<div class=' + Q + 'dg-note dg-bad' + Q + '>【注意】上面这句话在本轮**不成立**：'
                + escapeHtml(projectionFreshnessText(fresh)) + '。这不是「本版没这面」，'
                + '重发一轮（或切回原会话再切回来）即会重取。</div>';
        }
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
        /* [v3.0.3] R2-E：结局单独一格 —— 「被中止」与「已完成」处置相反
         *   （前者该重发、后者该看回复），压成一格就是本仓最贵的错读数。
         *   上游没外供该格（v3.217 及以前）时如实说「未提供」，不预填成「进行中」。 */
        if (inj.reason === 'ready') {
            const _ocTone = inj.outcome === 'completed' ? 'ok' : (inj.outcome === 'aborted' ? 'bad' : 'muted');
            html += '<div class=' + Q + 'dg-row' + Q + '><span class=' + Q + 'dg-name' + Q + '>结局</span>'
                + this._chip(inj.outcome ? outcomeText(inj.outcome) : '未提供（上游这版还没外供 outcome）', _ocTone) + '</div>';
            if (Array.isArray(inj.faceDrift) && inj.faceDrift.length) {
                /* [v3.0.3] 契约快照**必须在这里真消费**（本仓 dead-export 门禁当场捐到：
                 *   `injectionFaceKeys` 建好却产品端零消费 = 又一次「建好不消费」）。
                 *   而且它在这里是**用户能不能自证**的关键：只说「缺了 outcome」，
                 *   用户无从判断是上游旧版还是本机认错了格子；说出本机认得的整份键面，
                 *   他才能自己核对。 */
                const faceKeys = injectionFaceKeys();
                html += '<div class=' + Q + 'dg-note' + Q + '>上游注入面缺少本机认得的格子：'
                    + escapeHtml(inj.faceDrift.join('、')) + '（契约快照对账，非故障——旧版上游缺新格属正常）。'
                    + '本机认得的注入面共 ' + faceKeys.length + ' 格：'
                    + escapeHtml(faceKeys.join('、')) + '。</div>';
            }
        }
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

    /** [v3.4.2 · F-5] 沉默降级卡：每类一句话 + 证据（阈值与实测值并列，便于判断「差多少」）。
     *  纯渲染：结论与文案全部来自 `config/silence-guard.js`，本方法不做任何判断。
     *  卡尾附**台账面**（计数与轮次身份）：它回答「这几轮是怎么数出来的」——
     *  没有它，用户看到「连续 4 轮」却不知道这 4 轮是怎么来的，也就无法判断该不该信。 */
    _silenceHtml(alerts) {
        const rows = [];
        for (const a of alerts) {
            const ev = a.evidence || {};
            const evText = Object.keys(ev).map((k) => k + '=' + String(ev[k])).join(' · ');
            rows.push('<div class=' + Q + 'dg-row' + Q + '><span class=' + Q + 'dg-name' + Q + '>' + escapeHtml(a.id) + '</span>'
                + '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(a.text) + '</div>'
                + '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(evText) + '</div></div>');
        }
        const face = silenceLedgerFace(typeof window !== 'undefined' ? window : null);
        rows.push('<div class=' + Q + 'dg-row' + Q + '><span class=' + Q + 'dg-name' + Q + '>台账</span>'
            + '<div class=' + Q + 'dg-sub' + Q + '>累计 ' + escapeHtml(face.cycles) + ' 轮 · pending 连续 ' + escapeHtml(face.pendingStreak)
            + '（末轮 ' + escapeHtml(face.pendingLastRound === null ? '—' : face.pendingLastRound) + '）'
            + ' · empty 连续 ' + escapeHtml(face.emptyStreak) + '（末次 ' + escapeHtml(face.emptyLastRoundKey === null ? '—' : face.emptyLastRoundKey) + '）</div>'
            + '<div class=' + Q + 'dg-sub' + Q + '>重载页面即从零计数（台账在内存里）；只记计数与轮次身份，不存读数内容。</div></div>');
        return rows.join('');
    }

    /** [v3.4.3 · F-6] 上游口径自述卡：只转述上游声明，不加任何本仓判断。
     *  没有这面（上游旧版 / 没装场景模块）⇒ 明说「这版上游没带」。 */
    _notesHtml(pkg) {
        const notes = (pkg && pkg.obsNotes) || null;
        if (!notes || !notes.length) {
            return '<div class=' + Q + 'dg-sub' + Q + '>上游这版没有口径自述面（需记忆插件 v3.232 或更新）。</div>';
        }
        const rows = notes.map((x) => [
            '<div class=' + Q + 'dg-row' + Q + '>',
            '  <span class=' + Q + 'dg-name' + Q + '>' + escapeHtml(x.id) + '</span>',
            '  <div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(x.subject + ' · ' + x.kind) + '</div>',
            '  <div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(x.statement) + '</div>',
            '  <div class=' + Q + 'dg-sub' + Q + '>调用方职责：' + escapeHtml(x.callerDuty) + '</div>',
            '</div>'
        ].join(''));
        return rows.join('');
    }

    /** [v3.4.2 · F-5] 重置沉默台账（用户显式动作：看完告警后清一次计数）。
     *  为什么给出口而不是留给测试：台账是**进程内**的，若没有清零点，用户重开诊断页
     *  只会在同一份计数上继续累加，「刚清零过」这个动作在界面上无处可做。 */
    /**
     * [v3.10.0 · G-4] 当前剧情时刻卡：三处时间读数的**唯一对照面**。
     * 纯渲染（归因与文案来自真源 `storyClockFaceText`）。三条必须可见：
     *   · 每个来源的**原值或在场性**（缺就是缺，不补默认值）；
     *   · 一致性三态：一致 / **不一致（冲突）** / **无法验证**（给出日期的来源不足两个）；
     *   · 「无法验证」与「一致」在界面上必须长得不一样 —— 处置相反（前者去补数据，后者可放心用）。
     */
    _storyClockHtml(pkg) {
        const sc = (pkg && pkg.storyClock) || null;
        if (!sc) return '<div class=' + Q + 'dg-note' + Q + '>剧情时刻读取失败（已降级）</div>';
        const line = storyClockFaceText(sc);
        const tone = sc.conflict ? 'warn' : (sc.agree === true ? 'ok' : 'muted');
        const label = sc.conflict ? '不一致' : (sc.agree === true ? '一致' : '无法验证');
        let html = '<div class=' + Q + 'dg-sub' + Q + '>'
            + escapeHtml('当前剧情时刻：' + (sc.primaryDate || '—')) + ' ' + this._chip(label, tone) + '</div>';
        if (sc.conflict) {
            html += '<div class=' + Q + 'dg-note' + Q + '>三处读数互不相同 —— 正文时间与手机时间此刻**不是同一个**，先确认哪个才是当前。</div>';
        } else if (sc.agree === null) {
            html += '<div class=' + Q + 'dg-note' + Q + '>给出日期的来源少于两个 ⇒ **无法交叉验证**（不是「已确认一致」）。</div>';
        }
        const rows = [['worldaxis', '世界钟（WorldAxis）'], ['lonsha', '记忆插件剧情日期'], ['calendar', '手机日历当天']];
        html += '<div class=' + Q + 'dg-table' + Q + '>' + rows.map(([k, name]) => {
            const s = (sc.sources && sc.sources[k]) || { state: 'source-missing', date: null };
            const ok = s.state === 'ok';
            const text = ok ? String(s.date) : ('取不到：' + s.state);
            return '<div class=' + Q + 'dg-trow' + Q + '><code class=' + Q + 'dg-key' + Q + '>' + escapeHtml(k) + '</code>'
                + this._chip(ok ? (s.precision ? s.precision : '有日期') : '缺', ok ? 'ok' : 'muted')
                + '<span class=' + Q + 'dg-face' + Q + '>' + escapeHtml(name + ' · ' + text) + '</span></div>';
        }).join('') + '</div>';
        html += '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(line.detail) + '</div>';
        return html;
    }

    /**
     * [v3.10.0 · G-3] 知情网络卡：三档边界（known / unaware / silent）的**可视面**。
     * 纯渲染：归因与文案全部来自真源（`knowledgeFaceText`），本方法不做任何判断。
     * 三条必须看见的东西（缺一条这张卡就失去意义）：
     *   · `silent` —— **不是**「不知道」，是「账里没记，无从分辨」；
     *   · `silentCapable === false` —— 账里一条 unaware 记录都没有，
     *     此时「谁不知道」在数据上无从回答（与「没人不知道」处置相反）；
     *   · 明确的不知情事实逐条列出（这是用户唯一能据以纠正正文的东西）。
     */
    _knowledgeHtml(pkg) {
        const k = (pkg && pkg.knowledge) || null;
        if (!k) return '<div class=' + Q + 'dg-note' + Q + '>知情网络读取失败（已降级）</div>';
        const line = knowledgeFaceText(k);
        let html = '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(line.label + ' · ' + line.detail) + '</div>';
        if (k.state === 'ok') {
            if (k.silentCapable !== true) {
                html += '<div class=' + Q + 'dg-note' + Q + '>账里**没有**任何「明确不知情」记录 —— 问「谁不知道」只能得到「没记录」，'
                    + '这不是「没人不知道」。</div>';
            }
            const rows = [];
            for (const p of k.people) {
                const u = Array.isArray(p.unaware) ? p.unaware : [];
                for (const fact of u) rows.push({ fact, who: p.character, kind: 'unaware' });
            }
            if (rows.length) {
                html += '<div class=' + Q + 'dg-table' + Q + '>' + rows.slice(0, 20).map((r) => {
                    return '<div class=' + Q + 'dg-trow' + Q + '><code class=' + Q + 'dg-key' + Q + '>' + escapeHtml(r.who) + '</code>'
                        + this._chip('明确不知情', 'warn')
                        + '<span class=' + Q + 'dg-face' + Q + '>' + escapeHtml(r.fact) + '</span></div>';
                }).join('') + '</div>';
                if (rows.length > 20) html += '<div class=' + Q + 'dg-sub' + Q + '>（共 ' + rows.length + ' 条，此处只列前 20 条）</div>';
            }
        }
        return html;
    }

    /**
     * [v3.6.0 · R1-E] 九账证据面卡：上游 v3.214.0 把九本账收成一份可查表（此前**全库零消费**）。
     *  纯渲染：五态归因与文案全部来自真源（`evidenceFaceText`），本方法不做任何判断。
     *  卡尾附**逐账读数表**：用户据此看到「哪本读到、哪本缺席、缺席的两种原因分别是什么」
     *  —— 没有它，用户看到「读不到」也无从判断该等升级还是该等重跑。 */
    _evidenceHtml(pkg) {
        const ev = (pkg && pkg.evidence) || null;
        if (!ev) return '<div class=' + Q + 'dg-note' + Q + '>证据面读取失败（已降级）</div>';
        let html = '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(evidenceFaceText(ev)) + '</div>';
        const ledgers = Array.isArray(ev.ledgers) ? ev.ledgers : [];
        if (ledgers.length) {
            html += '<div class=' + Q + 'dg-table' + Q + '>' + ledgers.map((l) => {
                const tone = l.state === 'ok' ? 'ok' : (l.state === 'empty' ? 'muted' : 'warn');
                const label = l.state === 'ok' ? ('条目 ' + l.count + (l.truncated ? '（已截断）' : ''))
                    : (l.state === 'empty' ? '空账（在位，无条目）' : ('取不到：' + l.reason));
                return '<div class=' + Q + 'dg-trow' + Q + '><code class=' + Q + 'dg-key' + Q + '>' + escapeHtml(l.id) + '</code>'
                    + '<span class=' + Q + 'dg-face' + Q + '>' + escapeHtml(l.label) + '</span>'
                    + this._chip(label, tone) + '</div>';
            }).join('') + '</div>';
        }
        const items = Array.isArray(ev.items) ? ev.items : [];
        if (items.length) {
            html += '<div class=' + Q + 'dg-table' + Q + '>' + items.slice(0, 20).map((it) => {
                /* ★ 楼层「取不到」显示「—」而**绝不显示 0**：0 是「第 0 楼」这个真实读数。 */
                const f = (it.floor === null || it.floor === undefined) ? '—' : String(it.floor);
                return '<div class=' + Q + 'dg-trow' + Q + '><code class=' + Q + 'dg-key' + Q + '>' + escapeHtml(it.ref) + '</code>'
                    + this._chip(it.status || '（无状态）', it.status === 'open' ? 'warn' : 'muted')
                    + '<span class=' + Q + 'dg-face' + Q + '>' + escapeHtml(it.ledgerLabel + ' · 出处 ' + f + ' 楼') + '</span></div>'
                    + '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(it.title) + '</div>';
            }).join('') + '</div>';
            if (items.length > 20) {
                html += '<div class=' + Q + 'dg-sub' + Q + '>（共 ' + items.length + ' 条，此处只列前 20 条）</div>';
            }
        }
        html += '<div class=' + Q + 'dg-note' + Q + '>本卡只答「能查到几条证据、还有几本账读不到、为什么」，'
            + '<b>不复述上游的九账对账结论</b>（那是上游工作台的职责）。'
            + '「九本账一本也读不到」（模块没挂，等上游修）与「账在位但没有条目」（真读数，等剧情推进）'
            + '是两件处置相反的事，本卡分开报。出处楼层取不到时显示「—」—— <b>不写 0</b>（0 是「第 0 楼」这个真实读数）。</div>';
        return html;
    }

    /** [v3.6.0 · R1-C] 投影新鲜度归因卡：上游 v3.213.0 的新鲜度守卫扣下的旧投影**此前被谎报成「本版没这面」**。
     *  两种处境处置相反：被扣下 ⇒ 等宿主重跑一轮（用户可重发）；本版没这面 ⇒ 等上游升级。 */
    _freshnessHtml(pkg) {
        const f = (pkg && pkg.freshness) || null;
        if (!f || f.present !== true) {
            return '<div class=' + Q + 'dg-sub' + Q + '>本轮没有投影被新鲜度守卫扣下'
                + '（或上游这版还没外供该归因面 —— 那与「扣下了」是两件事，本卡不混报）。</div>';
        }
        const dropped = f.dropped === true;
        const line = dropped
            ? (projectionFreshnessText(f) || ('投影已被扣下（原因 ' + String(f.reason || '未知') + '）'))
            : ('新鲜度归因在场，但本轮未扣下任何投影（dropped=false，原因 ' + String(f.reason || '—') + '）');
        return '<div class=' + Q + 'dg-row' + Q + '>'
            + this._chip(dropped ? '投影被扣下' : '未扣下', dropped ? 'warn' : 'muted') + '</div>'
            + '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(line) + '</div>'
            + '<div class=' + Q + 'dg-sub' + Q + '>归属：从 ' + escapeHtml(f.from === null ? '（未提供）' : String(f.from))
            + ' → 到 ' + escapeHtml(f.to === null ? '（未提供）' : String(f.to)) + '</div>'
            + '<div class=' + Q + 'dg-note' + Q + '>上游 v3.213.0 起，切聊 / 回滚后的旧投影缓存**不再导出**'
            + '（它属于别的会话或上一代）。修前这条归因下游零消费，于是「有面但被守卫扣下」与'
            + '「本版没这面」同形 —— 前者<b>重发一轮就好</b>，后者只能等升级，压成一态就是错读数。</div>';
    }

    /** [v3.5.1 · F-8] 存档健康面：P-4 的两个裁定读数（存储时代 / 迁移账本）**首次可见**。
     *  只呈现，不判定也不迁移：卡片上写下的每一个字都来自 storage 的两个只读出口，
     *  两个分域（本会话档 / 全局档）分开列 —— 它们是两本不同的账。 */
    _storageHtml(pkg) {
        const f = (pkg && pkg.storageFace) || {};
        if (f.ok !== true) {
            /* 读不到就说读不到（不是「一切正常」）：存储实例没接上 / 接口缺失 / 抛错。 */
            return '<div class=' + Q + 'dg-note dg-bad' + Q + '>存档健康：读不到（归因 '
                + escapeHtml(String(f.reason || 'unknown')) + '）—— 这只说明本页取不到读数，不代表存档有问题。</div>';
        }
        const one = (label, x) => {
            if (!x || x.ok !== true) {
                return '<div class=' + Q + 'dg-row' + Q + '><span class=' + Q + 'dg-name' + Q + '>' + escapeHtml(label) + '</span>'
                    + this._chip('读不到（' + String((x && x.reason) || 'unknown') + '）', 'muted') + '</div>';
            }
            const sc = x.schema || {}, lg = x.ledger || {};
            const tone = sc.state === 'current' ? 'ok' : (sc.state === 'future' ? 'warn' : 'muted');
            const corrupt = (sc.corrupt || lg.corrupt) ? '<div class=' + Q + 'dg-sub dg-bad' + Q + '>账本形状损坏（已降级为空账本读）</div>' : '';
            const noted = lg.unparsableAt
                ? '<div class=' + Q + 'dg-sub' + Q + '>其中 ' + lg.unparsableAt + ' 条时间戳不可解析（<b>如实计数</b>，不当成 0 条，也不丢弃）</div>'
                : '';
            return '<div class=' + Q + 'dg-row' + Q + '><span class=' + Q + 'dg-name' + Q + '>' + escapeHtml(label) + '</span>'
                + this._chip(schemaStateText(sc.state), tone)
                + this._chip('存储版 ' + sc.version + ' / 本机 ' + sc.current, 'muted')
                + this._chip('已搬 ' + (lg.count || 0) + ' 条键', (lg.count ? 'muted' : 'muted'))
                + '<div class=' + Q + 'dg-sub' + Q + '>账本：' + (lg.absent ? '从未写过（正常旧档）' : ('在位，版本 ' + lg.version))
                + (sc.absent ? ' · 存储版本账从未写过' : '') + '</div>' + noted + corrupt + '</div>';
        };
        return '<div class=' + Q + 'dg-table' + Q + '>'
            + one('本会话档', f.chat) + one('全局档', f.global) + '</div>'
            + '<div class=' + Q + 'dg-note' + Q + '>' + escapeHtml(storageFaceLine(f)) + '</div>'
            + '<div class=' + Q + 'dg-note' + Q + '>口径纪律：<b>裁定不等于迁移</b> —— 本卡只回答「这份存档属于哪个存储时代」'
            + '与「一共搬过几条旧键」，迁移必须由调用方显式发起（读取路径上顺手做破坏性写操作，'
            + '是所有「打开一下就改了数据」事故的同一个形状）。</div>';
    }

    /**
     * [v3.19.0 · 计划一「共同配套」第 2 条] 跨仓功能登记卡：把「本仓在消费上游哪些面」一次列全。
     *  纯渲染：七态文案、分组计数与总述全部来自真源（`crossRepoFaceText` 转发
     *  `config/crossrepo-registry.js` 的 `registryLine`），本方法**不做任何判定**
     *  （不数条数、不判版本、不猜谁该动手 —— 判断只在登记面里做一次）。
     *
     *  三条必须看见的东西（缺一条这张卡就变成装饰）：
     *    · **两种处置相反的处境不得同形**：「缺席」（等对面装）／「闸门关着」（用户自己去开）／
     *      「本版不产出」（等对面升级）／「明确为空」（真读数，什么都不用做）—— 这四件事
     *      在用户侧的动作完全不同，压成一格就会把人指去做无用功；
     *    · **逐条带归属与起始版本**：读者要能回答「这条是谁产的、我装的够不够新」；
     *    · **失效条件写在行上**：同一句「现在没读数」，是「重发一轮就好」还是「只能等升级」，
     *      取决于失效条件，不写出来读者只能猜。
     *  排版：逐条按登记顺序列出（**不重排** —— 本仓列表一律按原始顺序），非 ok 的行给对应色调。
     */
    _crossRepoHtml(pkg) {
        const face = (pkg && pkg.crossRepo) || null;
        if (!face) {
            return '<div class=' + Q + 'dg-note dg-bad' + Q + '>跨仓功能登记面读取失败（已降级）—— '
                + '这只说明本页取不到登记读数，**不代表**上游缺席（缺席是登记面里的一格状态）。</div>';
        }
        const rows = Array.isArray(face.rows) ? face.rows : [];
        if (!rows.length) {
            return '<div class=' + Q + 'dg-note' + Q + '>登记表为空：本版没有登记任何跨仓面（无面可判，不等于全部就绪）。</div>';
        }
        /* 状态 → 色调：ok 才是绿；empty 是**真读数**（中性）；其余都是「有事要看」。
         *   empty 刻意不给绿也不给红 —— 它既不是好消息也不是坏消息，是数据本身。 */
        const toneOf = (st) => (st === 'ok' ? 'ok' : (st === 'empty' ? 'muted' : 'warn'));
        let html = '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(crossRepoFaceText(face)) + '</div>';
        html += '<div class=' + Q + 'dg-table' + Q + '>' + rows.map((r) => {
            const since = (r.since === null || r.since === undefined) ? '无版本判据' : ('since ' + String(r.since));
            const ver = (r.producerVersion === null || r.producerVersion === undefined)
                ? '对面版本读不到' : ('对面 ' + String(r.producerVersion));
            return '<div class=' + Q + 'dg-trow' + Q + '><code class=' + Q + 'dg-key' + Q + '>' + escapeHtml(r.label) + '</code>'
                + this._chip(r.stateText, toneOf(r.state))
                + this._chip(r.owner + ' · ' + since, 'muted')
                + this._chip(ver, 'muted')
                /* 失效条件只对**非 ok** 的行显示：那是「这格怎么了」的解释；
                 *   全列出会把卡片变成一张没人读的清单。 */
                + (r.state === 'ok' ? '' : '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(r.invalidation) + '</div>')
                + (r.state === 'ok' ? '' : '<div class=' + Q + 'dg-sub' + Q + '>只装一个插件时：' + escapeHtml(r.standalone) + '</div>')
                + '</div>';
        }).join('') + '</div>';
        html += '<div class=' + Q + 'dg-note' + Q + '>口径纪律：<b>本卡只登记，不改行为</b> —— 它不装上游、不开闸门、不替代缺面，'
            + '只把「本仓在消费谁产出的哪一面、现在处于哪一格」摆出来。判定顺序固定在真源里：'
            + '<b>桥在场 → 闸门 → 版本 → 字段三态</b>（先比版本会把「桥缺席」报成「版本偏低」，那是编造归因）。</div>';
        return html;
    }

    /** [v3.55.0 · 计划 A2] App 消费面矩阵卡：把「哪些 App 接上了哪些平台面」摆出来。
     *   本方法**只排版**：逐面命中数、逐行命中面、台账理由全部来自内核读数（一句话总述也是内核给的）。
     *   视图自己数一遍条数就是同一口径的第二份实现 —— 本仓治理过多轮的形态。 */
    _appFacesHtml(pkg) {
        const face = (pkg && pkg.appFaces) || null;
        if (!face) {
            return '<div class=' + Q + 'dg-note dg-bad' + Q + '>消费面矩阵读数读取失败（已降级）—— '
                + '这只说明本页取不到矩阵读数，**不代表**这些 App 就全面没接上。</div>';
        }
        let html = '<div class=' + Q + 'dg-sub' + Q + '>' + escapeHtml(face.line) + '</div>';
        const faces = Array.isArray(face.faces) ? face.faces : [];
        if (faces.length) {
            html += '<div class=' + Q + 'dg-chips' + Q + '>' + faces.map((f) =>
                this._chip(f.label + ' ' + String(f.count), f.count > 0 ? 'ok' : 'muted')).join('') + '</div>';
        }
        const rows = Array.isArray(face.rows) ? face.rows : [];
        if (!rows.length) {
            html += '<div class=' + Q + 'dg-note' + Q + '>矩阵为空：本版没有可列的 App（无表可判，不等于全部适配）。</div>';
            return html;
        }
        html += '<div class=' + Q + 'dg-table' + Q + '>' + rows.map((r) => {
            const on = Array.isArray(r.faces) ? r.faces : [];
            return '<div class=' + Q + 'dg-trow' + Q + '><code class=' + Q + 'dg-key' + Q + '>' + escapeHtml(r.name) + '</code>'
                + this._chip(r.count + '/' + String(faces.length), r.count > 0 ? 'ok' : 'muted')
                + (on.length ? this._chip(on.join(' · '), 'muted')
                    : this._chip('六面全无（见下台账）', 'warn'))
                + '</div>';
        }).join('') + '</div>';
        const na = Array.isArray(face.na) ? face.na : [];
        if (na.length) {
            html += '<div class=' + Q + 'dg-note' + Q + '><b>「不适用」台账</b>（只有六面全无的 App 才需理由，且与磁盘双向对账）：</div>';
            html += na.map((x) => '<div class=' + Q + 'dg-sub' + Q + '><b>' + escapeHtml(x.name) + '</b>：' + escapeHtml(x.reason) + '</div>').join('');
        }
        html += '<div class=' + Q + 'dg-note' + Q + '>口径纪律：<b>本卡只陈列事实，不做取数</b> —— 六个布尔值的真源复算在判据套件里，'
            + '与本表双向对账（同源自述必然恒绿）。「false」格不逐格写理由：只有「六面全无」才是真需要说明的那一类，'
            + '其余一面命中即说明它确实在被消费。</div>';
        return html;
    }

    resetSilence() {
        try { resetSilenceLedger(typeof window !== 'undefined' ? window : null); } catch (_e) { /* 不抛 */ }
    }

    render(container) {
        if (!container) return;
        this.loadCSS();
        /* [v3.5.1 · F-8] 存档健康面要读 storage（P-4 的两个裁定出口）；
         *   本 App 不自持副本，storage 由宿主注入到构造器（与其它 App 同规格）。 */
        const pkg = collectDiagnose(null, this.app && this.app.storage);
        /* [v3.4.2 · F-5] 沉默降级告警面：先记这一轮（跨轮计数），再算告警。
         *   顺序不能反 —— 反了的话「连续 3 轮」永远差一轮（当轮还没记）。
         *   本卡**只进诊断页、不弹窗**：三类沉默都是上游或宿主那边的事，
         *   弹窗提示用户也做不了什么，只会把「安静地降级」换成「吵闹地降级」。 */
        noteSilenceCycle(typeof window !== 'undefined' ? window : null, pkg);
        const silence = silenceAlerts(typeof window !== 'undefined' ? window : null, pkg);
        const summary = summarizeDiagnose(pkg);
        const bad = /^需注意/.test(summary);
        const h = [];
        h.push('<div class=' + Q + 'dg-root' + Q + '>');
        h.push('  <div class=' + Q + 'dg-head' + Q + '>');
        h.push('    <div class=' + Q + 'dg-title' + Q + '>诊断中心</div>');
        h.push('    <div class=' + Q + 'dg-summary' + (bad ? ' dg-bad' : '') + Q + '>' + escapeHtml(summary) + '</div>');
        h.push('  </div>');
        /* 沉默告警卡放**最前**：有坏消息先说坏消息（本仓 v2.36 桥卡片学到的教训）。
         *   零告警时**不出卡片** —— 不给「一切正常」的绿灯结论（那是另一个判据面的事）。 */
        if (silence.length > 0) {
            h.push('  <section class=' + Q + 'dg-card dg-bad' + Q + '><h3>沉默降级告警</h3>'
                + this._silenceHtml(silence) + '</section>');
        } else if (bad) {
            h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>沉默降级告警</h3>'
                + '<div class=' + Q + 'dg-sub' + Q + '>本轮未观察到三类沉默（快照久未更新 / 注入连续 pending / 投影长期 empty）。</div></section>');
        }
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>上游桥</h3>' + this._bridgesHtml(pkg.bridgeReport || {}) + '</section>');
        /* [v3.10.0 · G-4] 当前剧情时刻卡放桥之后、其余读数之前：
         *   「现在是哪一天」是所有其它读数（投影新鲜度 / 账龄 / 承诺期限）的解释前提 ——
         *   它若不一致，后面每一格的相对时间都不可信。 */
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>当前剧情时刻（三源对照）</h3>' + this._storyClockHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>探针自述（sourceState / lastError）</h3>' + this._probeSelfHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>上游自述面 · 字段三态</h3>' + this._fieldsHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>投影契约（上游投影面）</h3>' + this._projHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>投影新鲜度归因</h3>' + this._freshnessHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>注入读数（本轮实际注入）</h3>' + this._injectionHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>九账证据面</h3>' + this._evidenceHtml(pkg) + '</section>');
        /* [v3.10.0 · G-3] 知情网络卡：放在剧情/证据两族之后 —— 它回答的是
         *   「为什么某个角色像是知道了不该知道的事」，属于「解读型」读数而非「在场型」。 */
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>知情网络（谁不知道某件事）</h3>' + this._knowledgeHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>上游口径自述（T16/T17）</h3>' + this._notesHtml(pkg) + '</section>');
        /* [v3.19.0 · 计划一「共同配套」第 2 条] 跨仓功能登记卡放在「上游口径自述」之后、
         *   「回滚影响预览」之前：它属**契约型/解读型**读数（「本仓在消费谁产出的哪一面、
         *   现在处于哪一格」），而不是「这一次动作的范围」—— 后者与存档健康同族，
         *   都属「动手前先看清」，登记面答的不是这个问题。 */
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>跨仓功能登记（消费了上游哪些面）</h3>' + this._crossRepoHtml(pkg) + '</section>');
        /* [v3.55.0 · 计划 A2] App 消费面矩阵卡放在「跨仓功能登记」之后、
         *   「检查点内容级对照」之前：两者同族（都答「本仓在消费谁产出的哪一面」），
         *   但登记面答的是**向外看**的上游契约，本卡答的是**向内看**的平台级覆盖 —— 先看外部哪些面在，再看自己家的 App 有没有接上。 */
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>App 消费面矩阵（哪些 App 接上了哪些平台面）</h3>' + this._appFacesHtml(pkg) + '</section>');
        /* [v3.58.0 · 计划 O4] 会话世代栅栏卡紧跟在消费面矩阵**之后**：两张卡常被混为一谈，
         *   摆在一起才看得出分工 —— 矩阵答「哪些 App **接上了**平台面」（接线在场），
         *   本卡答「这些接线**真的挡下过谁**」（行为发生过）。接线在场不等于行为发生过。 */
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>会话世代栅栏（哪些旧会话回信被挡下）</h3>' + this._sessionGateHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>检查点内容级对照（上游只读）</h3>' + this._checkpointHtml(pkg) + '</section>');
        /* [v3.11.0 · F-1 替代轴] 回滚影响预览卡放在「存档健康」之前：
         *   它与存档健康同属「动手前先看清」，但本卡说的是**这一次动作的范围**，
         *   而存档健康说的是**这份存档属于哪个时代** —— 先看范围，再看时代。 */
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>回滚影响预览（只算不执行）</h3>' + this._rollbackPreviewHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>返回栈</h3>' + this._backHtml(pkg) + '</section>');
        /* [v3.13.0 · 计划 #14] 启动耗时卡放在最后：它是**启动期**的读数（其余卡片都是当前态
         *   的读数）—— 摆在前面的卡会让人以为「启动慢」是当前正在发生的事。 */
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>启动耗时（谁拖慢了启动）</h3>' + this._bootTimingHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>源键规则</h3>' + this._sourceKeysHtml(pkg) + '</section>');
        h.push('  <section class=' + Q + 'dg-card' + Q + '><h3>存档健康</h3>' + this._storageHtml(pkg) + '</section>');
        h.push('</div>');
        container.innerHTML = h.join('');
    }
}

export default DiagnoseView;
