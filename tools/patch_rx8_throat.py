# -*- coding: utf-8 -*-
"""R-X8 咽喉四件补丁：index.js 里的取数口 / 唯一动作口 / 只读读数口 / 白名单。

为什么落盘成文件而不是 heredoc 内嵌 python -c：本仓多次实测含引号与括号的
内嵌单行脚本会被 bash 先解析坏（V74 批次 E 注册表补丁即因此失败）。
"""
import io
import os
import sys

ROOT = '/home/user/ruby-phone'
IDX = os.path.join(ROOT, 'index.js')

THROAT = u'''
    /* ══════════ [v3.92.0 · 拓展计划 R-X8] 宿主与能力健康中心 ══════════ */
    /* 与 R-X1..R-X7 同族：六项能力的四态判定全在纯内核（config/capability-health.js），
     * 本处只做三件事 —— 采集观测、传意图、缓存读数。
     *
     * 【本处刻意不做的事】（计划验收③「能力检测本身不得触发真实写入或模型调用」的落点）
     *   · **不写存储**：本段没有任何 storage.set / remove（读数里带 `writes: 0`）；
     *   · **不调模型**：本段没有任何 generateRaw / API 请求；
     *   · **不发网络**：本段没有任何 fetch / XMLHttpRequest / new Image()；
     *   · **不重判**：四态怎么分、替代操作给什么全由内核判（本处只把观测喂进去）。
     *   这四条不靠人记得：判据套件把本段函数体单独取出来（剥注释）逐条核。 */
    /* 动作白名单**只有一个**（`report`）：本 App 是纯读数面，没有任何写动作。
     *   声明在取数口之前 —— 取数口要在读数里带上它（const 有暂时性死区，先后必须对）。 */
    const CAPHEALTH_ACTION_KEYS = ['report'];

    /** 宿主（SillyTavern）版本：**多来源试读，读不到即空串**。
     *   为什么不写死一个来源：本仓实测没有别处读宿主版本，也没有稳定契约
     *   （ST 未把版本写进 `getContext()` 的保证文本里）。故按「先问 API、再问页面元素」
     *   的顺序试读，全拿不到就**如实空串** —— 上层写「读不出」，
     *   绝不写「不支持」（两事处置相反：前者是读数缺席，后者是能力缺失）。 */
    function chHostVersion(win) {
        try {
            const st = win ? win.SillyTavern : null;
            if (st && typeof st.version === 'string' && st.version) return String(st.version).trim();
            if (st && typeof st.getContext === 'function') {
                const ctx = st.getContext();
                if (ctx && typeof ctx.version === 'string' && ctx.version) return String(ctx.version).trim();
            }
            const doc = (win && win.document) ? win.document : null;
            const el = (doc && typeof doc.querySelector === 'function') ? doc.querySelector('#version_display') : null;
            return (el && el.textContent) ? String(el.textContent).trim() : '';
        } catch (_e) { return ''; }
    }

    /** 六项能力的**观测采集**（只调只读出口）。
     *   条件：本函数不写存储、不发网络、不调模型。
     *   “用了哪一级观测”是本函数最容易被后人改坏的一格（把 api 改成 service
     *   就会把「接口在」报成「服务可用」—— 计划验收②明令禁止），故每一格
     *   都把“为什么是这一级”写在当场，并由判据套件反向钉住。 */
    function chCollectObservations(win) {
        const vp = window.VirtualPhone || {};
        const out = {};
        /* ① 搜索：本机内建全局搜索（引擎 + 源表）。
         *   只探到「接口在场」⇒ 观测级 **api** ⇒ 内核最高只能判 partial。 */
        try {
            const app = vp.searchApp || null;
            const engine = (app && app.engine) ? app.engine : null;
            if (app && engine && typeof engine.listSources === 'function') {
                const list = engine.listSources();
                const n = Array.isArray(list) ? list.length : null;
                out.search = {
                    present: true, probe: 'api', healthy: 'ok',
                    note: '全局搜索在位（索引源 ' + (n === null ? '读不出' : String(n) + ' 个') + '）；本处只探到接口、没跑过一次检索'
                };
            } else {
                out.search = { present: false, probe: 'none', healthy: '', note: '全局搜索 App 不在位（本版未加载 / 未打开过）' };
            }
        } catch (e) {
            out.search = { present: false, probe: 'none', healthy: '', note: '搜索探针抛错：' + String((e && e.message) || e) };
        }
        /* ② 记忆：上游记忆插件的桥。观测级 **service** —— 因为读的是**对方的自述态**
         *   （`lonshaSource`：mounted / sourceState / lastError 全是上游自己报的，本仓不猜）。
         *   「桥挂载了但还没产出快照」与「上游说引擎不在位」**不同形**：
         *   前者降到 api 级（→ partial，等一轮就好），后者如实报不可用。 */
        try {
            const src = lonshaSource(LONSHA_BRIDGE_ID, win) || {};
            if (!src.mounted) {
                out.memory = { present: false, probe: 'none', healthy: '', note: '记忆插件桥不在场（未安装或未加载）' };
            } else if (src.reason === 'ready') {
                out.memory = { present: true, probe: 'service', healthy: 'ok', note: '上游自述：桥已就绪（来源态 ' + String(src.sourceState || 'ready') + '）' };
            } else if (src.reason === 'engine-absent') {
                out.memory = { present: true, probe: 'service', healthy: 'unavailable', note: '上游自述：记忆引擎不在位（这是对方说的，不是我们猜的）' };
            } else if (src.reason === 'engine-empty') {
                out.memory = { present: true, probe: 'service', healthy: 'partial', note: '上游自述：记忆引擎为空（还没有数据）' };
            } else if (src.reason === 'thrown') {
                out.memory = { present: true, probe: 'service', healthy: 'unavailable', note: '上游自述抛错：' + String(src.lastError || '（未给原因）') };
            } else {
                out.memory = { present: true, probe: 'api', healthy: 'ok', note: '桥已挂载但还没产出快照（对方尚未就绪）—— 只探到接口' };
            }
        } catch (e) {
            out.memory = { present: false, probe: 'none', healthy: '', note: '记忆桥探针抛错：' + String((e && e.message) || e) };
        }
        /* ③ 图片：生图管理器。只读到“通道选了没”⇒ api 级（“选了通道”不等于
         *   “出得出图”）。本处绝不试跑一张图 —— 那是真实模型调用（验收③）。 */
        try {
            const mgr = vp.imageGenerationManager || null;
            if (mgr && typeof mgr.getConfig === 'function') {
                const cfg = mgr.getConfig() || {};
                const provider = String(cfg.provider || cfg.activeProvider || '').trim();
                out.image = {
                    present: true, probe: 'api', healthy: 'ok',
                    note: '生图管理器在位（' + (provider ? ('通道 ' + provider) : '未选通道') + '）；本处只探到接口、没出过一张图'
                };
            } else {
                out.image = { present: false, probe: 'none', healthy: '', note: '生图管理器不在位（本版未接 / 未初始化）' };
            }
        } catch (e) {
            out.image = { present: false, probe: 'none', healthy: '', note: '生图探针抛错：' + String((e && e.message) || e) };
        }
        /* ④ 语音：两端（朗读 / 语音输入）。注意一格特例：浏览器**没有录音接口**时
         *   不是「没测过」而是**测得到的缺件** —— 那就如实报不可用。
         *   探针只看函数在不在，**不调 getUserMedia**（那会弹授权弹窗，也是副作用）。 */
        try {
            const tts = vp.ttsManager || null;
            const asr = vp.asrManager || null;
            const nav = win ? win.navigator : null;
            const canRecord = !!(nav && nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function');
            if (!tts && !asr) {
                out.voice = { present: false, probe: 'none', healthy: '', note: '语音两端（朗读 / 语音输入）都不在位' };
            } else if (!canRecord && asr) {
                out.voice = { present: true, probe: 'api', healthy: 'unavailable', note: '本浏览器没有录音接口（navigator.mediaDevices.getUserMedia 不在）—— 语音输入不能用' };
            } else {
                out.voice = {
                    present: true, probe: 'api', healthy: 'ok',
                    note: '语音端在位（' + (tts ? '朗读' : '无朗读') + ' / ' + (asr ? '语音输入' : '无语音输入')
                        + (canRecord ? ' · 浏览器录音接口在场' : '') + '）；本处只探到接口、没真朗读过一次'
                };
            }
        } catch (e) {
            out.voice = { present: false, probe: 'none', healthy: '', note: '语音探针抛错：' + String((e && e.message) || e) };
        }
        /* ⑤ 通知：通知账本。**真读一次**读路径（list()）才算 service 级；
         *   「账本读得到」与「能落账」不是一回事，故文案里明说落账**未测**
         *   （落账是写入，本页不做 —— 验收③）。 */
        try {
            const log = vp.notificationLog || null;
            const rows = (log && typeof log.list === 'function') ? log.list() : null;
            if (Array.isArray(rows)) {
                out.notify = {
                    present: true, probe: 'service', healthy: 'ok',
                    note: '通知账本**已真读一次**（本条 ' + String(rows.length) + ' 条）；落账未测（落账是写入，本页不做）'
                };
            } else if (log) {
                out.notify = { present: true, probe: 'api', healthy: 'ok', note: '通知账本在位但读出口没给数组 —— 只探到接口' };
            } else {
                out.notify = { present: false, probe: 'none', healthy: '', note: '通知账本不在位（未初始化）' };
            }
        } catch (e) {
            out.notify = { present: false, probe: 'none', healthy: '', note: '通知账本探针抛错：' + String((e && e.message) || e) };
        }
        /* ⑥ 恢复交接：交接栅栏（本机内纯函数，无外部依赖）。
         *   能真读出世代号与被挡日志 ⇒ service。 */
        try {
            const ep = handoffEpoch();
            if (typeof ep === 'number' && isFinite(ep)) {
                const log = handoffDropLog();
                const dropped = (log && typeof log.count === 'number') ? log.count : null;
                out.handoff = {
                    present: true, probe: 'service', healthy: 'ok',
                    note: '交接栅栏**已真读一次**（当前世代 ' + String(ep) + ' · 被挡旧回信 ' + (dropped === null ? '读不出' : String(dropped)) + ' 条）'
                };
            } else {
                out.handoff = { present: true, probe: 'api', healthy: 'ok', note: '交接栅栏在位但世代号读不出 —— 只探到接口' };
            }
        } catch (e) {
            out.handoff = { present: true, probe: 'service', healthy: 'unavailable', note: '交接栅栏抛错：' + String((e && e.message) || e) };
        }
        return out;
    }

    /* 上游版本比对**只在可归因时进行**：登记面里立了版本判据的上游恰好一个、
     *   且「推/拉统一探针」本轮读到的来源 id 能对上它的名字族 ⇒
     *   才把快照自述的 `pluginVersion` 当作那个上游的版本。
     * 为什么不去读桥对象自己的 `version`：WorldAxis 桥上的 `version` 是**契约版本**
     *   （恒为 1，不是扩展版本）—— 登记面注释里已点名，拿它比会造出假读数。
     * 对不上 / 认不出 / 不止一个 ⇒ 空串 ⇒ 内核如实报「版本读不出」，**不猜**。 */
    function chUpstreamVersions(win) {
        try {
            const owners = [];
            const mins = {};
            for (const f of CROSSREPO_FEATURES) {
                const o = String((f && f.owner) || '');
                if (!o || mins[o] !== undefined) continue;
                const min = minUpstreamOf(CROSSREPO_FEATURES, o);
                mins[o] = min;
                if (!min) continue;                 /* 该上游不立版本判据 ⇒ 不列 */
                owners.push(o);                      /* 不删：认不出来源时要如实报，不静默 */
            }
            const probe = readPushProbe(win) || {};
            const snap = probe.snapshot || null;
            const self = (snap && typeof snap.pluginVersion === 'string') ? String(snap.pluginVersion).trim() : '';
            const pid = String(probe.id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const out = [];
            for (const o of owners) {
                /* 名字族匹配：取上游标识的第一段（按 - _ 切）作为族名。 */
                const seg = String(o).toLowerCase().split(/[-_]/)[0] || '';
                const unique = (owners.length === 1);
                const match = unique && seg && pid.indexOf(seg) >= 0;
                out.push({ id: o, version: match ? self : '', min: mins[o] });
            }
            return out;
        } catch (_e) { return []; }
    }

    /** 跨仓版本联动的输入（只供内核 `crossRepoNotice` 判）。 */
    function chCrossRepoInput(win) {
        return {
            phone: ST_PHONE_VERSION,
            hostVersion: chHostVersion(win),
            upstreams: chUpstreamVersions(win),
            /* 面级契约本轮**不取数**：那一面需要完整的双桥探针（lonsha 侧字段三态 +
             *   worldaxis 侧读成败），而诊断中心的 `repoProbe` 已是那份探针的唯一取数点。
             *   在咽喉再建第二份 ⇒ 同一读数的两个来源必然漂移（本仓治过多次）。
             *   传 null 而不是 0：内核对此写「面级契约：本轮未取数（不是零面就绪）」。 */
            totalFaces: null,
            readyFaces: null,
            minUpstream: '',
        };
    }

    /**
     * [v3.92.0 · R-X8] 能力健康的**唯一取数口**（与 R-X1..R-X7 同族）。
     *   · 六项能力的观测**现采**（`chCollectObservations`，只调只读出口）；
     *   · 四态判定全交内核（本处不重判）；
     *   · 缓存挂 `_caphealth`，视图与诊断只读这一份；
     *   · **不按会话作废**：这是**设备级**读数（本机 / 宿主 / 插件共用），
     *     按会话作废会造出「换个角色能力就变了」的假读数；
     *     但取数口本身**每次读都重采**（宿主重载 / 桥上下线都会变）。
     *   ★ 不 await、自带兜底：与 refreshBackup / refreshWorkflow 放在同一处。
     */
    function refreshCapHealth() {
        try {
            const vp = window.VirtualPhone;
            if (!vp) return;
            const win = (typeof window !== 'undefined') ? window : null;
            const observations = chCollectObservations(win);
            const summary = capHealthSummary(observations);
            const notice = crossRepoNotice(chCrossRepoInput(win));
            let chatId = '';
            try { chatId = String((storage && storage.currentConversationId) || '').trim(); } catch (_ec) { chatId = ''; }
            vp._caphealth = {
                at: Date.now(), token: handoffEpoch(),
                chatId: chatId,
                hostVersion: chHostVersion(win),
                hostVersionText: String(notice.idLine || ''),
                observations: observations,
                summary: summary,
                notice: notice,
                ids: CAPABILITY_IDS.slice(),
                actions: CAPHEALTH_ACTION_KEYS.slice(),
                selfCheck: capHealthSelfCheck(),
                writes: 0,                       /* 本取数口不写存储（字面事实，不是声明） */
                report: '',
            };
        } catch (e) {
            console.warn('[Caphealth] 能力体检取数失败:', e);
        }
    }

    /**
     * [v3.92.0 · R-X8] **唯一动作口**：视图只能交 `report`（白名单就一个）。
     *   · 报告文本由内核 `capHealthReport` 拼（本处不重拼）；
     *   · **不重新检测**：只用**已判定的读数**拼报告 —— 「复制」这个动作本身不得触发检测；
     *   · 世代检查：视图**给了 token 才比**（与 R-X7 的落盘动作不同 —— 本动作不写任何东西，
     *     旧按钮最坏结果是复制到一份过期读数，不会写错地方；而误拒会让按钮看起来坏了）。
     * @returns {{ok:boolean, note:string, kind:string, report?:string}}
     */
    function applyCaphealthAction(payload) {
        const p = (payload && typeof payload === 'object') ? payload : {};
        try {
            const action = String(p.action || '');
            if (CAPHEALTH_ACTION_KEYS.indexOf(action) < 0) return { ok: false, note: '不在白名单的动作：' + action, kind: 'unknown-action' };
            refreshCapHealth();
            const face = window.VirtualPhone ? window.VirtualPhone._caphealth : null;
            if (!face) return { ok: false, note: '读数还没取到（咽喉那一轮尚未跑）', kind: 'absent' };
            if (p.token !== undefined && p.token !== null && p.token !== handoffEpoch()) {
                return { ok: false, note: '世代已变，拒旧按钮', kind: 'stale-epoch' };
            }
            if (action === 'report') {
                const report = capHealthReport(face.summary, face.notice);
                face.report = report;
                return {
                    ok: true,
                    note: '报告 ' + String(report.split(String.fromCharCode(10)).length) + ' 行（只用已判定的读数拼，未重新检测）',
                    kind: 'report',
                    report: report,
                };
            }
            return { ok: false, note: '未接的动作', kind: 'unhandled' };
        } catch (e) {
            return { ok: false, note: '执行失败：' + String((e && e.message) || e), kind: 'error' };
        }
    }

'''

def main():
    with io.open(IDX, 'r', encoding='utf-8') as f:
        src = f.read()
    anchor = u"    function cwInvokeOwner(req) {"
    n = src.count(anchor)
    if n != 1:
        print('ANCHOR-COUNT', n)
        sys.exit(1)
    src = src.replace(anchor, THROAT + anchor)
    with io.open(IDX, 'w', encoding='utf-8') as f:
        f.write(src)
    print('OK index.js', len(src.encode('utf-8')))

if __name__ == '__main__':
    main()