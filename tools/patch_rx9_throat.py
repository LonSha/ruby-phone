#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R-X9 咽喉补丁：把无障碍操作层接进 index.js（与 R-X1..R-X8 同族）。

六个补丁点（每个锚点必须恰中 1 次）：
  ① import 段：import { … } from './config/access-layers.js'
  ② 白名单 + 取数口 + 动作口（整段插在 cwInvokeOwner 之前）
  ③ 刷新链：refreshAccess() 挂进日历提醒那条链（与 refreshCapHealth 同处）
  ④ 只读读数口 + 唯一动作口挂 window.VirtualPhone
  ⑤ REBIND 表加 'accessdeskApp'
  ⑥ documentElement 属性写入（refreshAccess 内部，随 ② 一起）
"""
import io
import sys

ROOT = '/home/user/ruby-phone'
IDX = ROOT + '/index.js'
src = io.open(IDX, encoding='utf-8').read()
before = len(src)


def patch(name, anchor, replacement, expect=1):
    global src
    n = src.count(anchor)
    if n != expect:
        print('FAIL [%s] 锚点命中 %d 次（要求 %d 次）' % (name, n, expect))
        sys.exit(1)
    src = src.replace(anchor, replacement, 1)
    print('  ok %s' % name)


# ---------- ① import ----------
IMP_ANCHOR = """import {
    CAPABILITY_IDS, capHealthSummary, capHealthReport, crossRepoNotice,
    capHealthSelfCheck, minUpstreamOf,
} from './config/capability-health.js';"""
IMP_NEW = IMP_ANCHOR + """
/* [v3.93.0 · 拓展计划 R-X9] 无障碍 / 窄屏 / 个性化操作层（纯函数内核）。
 *   接在咽喉的理由与 R-X1..R-X8 同族：三档怎么定、四态怎么分、窄屏怎么排、名字取哪个
 *   真源全由调用方（内核）判 —— 本模块自己不读存储、不碰 DOM、不联网。
 *   三件个性化开关刻意**复用既有真源**：低动画落 `sys_motion_level`（config/motion.js 的键）、
 *   字体缩放落 `phone-font-scale`（phone/font-scale.js 的键），本版只新开三个键
 *   （sys_access_level / sys_access_compact / sys_access_theme）。
 *   为什么 320px 断点必须从内核取而不是写在 CSS 里：列数变化会改分页容量（home-screen.js），
 *   而分页容量是 JS 算的 —— 两边各写一个 320 就必然漂移（本仓同一口径两份实现的老账）。 */
import {
    AX_LEVEL_KEY, AX_PREF_KEYS, AX_NARROW_WIDTH, AX_TOUCH_MIN,
    resolveAccessLevel, readAccessEnv, narrowPlan, overlapGuardOf,
    resolveTheme, readDarkEnv, normalizeCompact, markOf, accessSelfCheck,
    iconA11yName, a11yNameUsable,
} from './config/access-layers.js';"""
patch('import', IMP_ANCHOR, IMP_NEW)

# ---------- ② 咽喉四件 ----------
THROAT_ANCHOR = "    /**\n     * [v3.91.0 · R-X7] 备份与恢复的**唯一取数口**（与 R-X1..R-X6 同族）。"
THROAT_NEW = '''    /* ══════════════ [v3.93.0 · 拓展计划 R-X9] 无障碍 / 窄屏 / 个性化操作层 ══════════════
     * 【范式（与 R-X1..R-X8 同族）】
     *   · 动作白名单 ACCESS_ACTION_KEYS 声明在取数口**之前**（取数口要在读数里带上它，
     *     `const` 有暂时性死区，先后必须对）；
     *   · refreshAccess() 是唯一取数口（缓存挂 vp._access，含 readable / why 与其余面同形）；
     *   · applyAccessAction() 是唯一动作口（先判白名单 → 取数 → 世代检查 → 写 → 重取）；
     *   · accessFace 是只读读数口。
     * 【不按会话作废】dataset 与档位写的是 **documentElement**（整台机器一份），
     *   按会话作废会造出「换个角色无障碍档位就回默认」的假行为；但实例态（提示行 / 预览）
     *   必须随会话丢，故 accessdeskApp 进 REBIND 表。
     * 【为什么 dataset 只在这里写】写两处必然漂移（一处改了另一处没改，界面就是
     *   「看起来生效了、其实没生效」）—— 与 motion.js 的 data-motion 同规。
     * ------------------------------------------------------------------ */
    /* 动作白名单**只有三个落盘动作**（preview 是纯视图态，不进白名单也不经这里）。 */
    const ACCESS_ACTION_KEYS = ['level', 'compact', 'theme'];

    /**
     * 写一次设置并**回读三态**（写入的对错要能读出来，不能只信 set 没抛）。
     * 为什么这一格单独成函数：三个动作都要「写 → 回读 → 如实报三态」，
     *   各写一遍就是同一口径三份实现（本仓常驻判据之一）。
     * @returns {{ok:boolean, kind:string, why:string}}
     *   ok=true 且 why='' ⇒ 回读得到；ok=true 且 why='pending' ⇒ 写入已排队但本刻回读不到
     *   （真宿主上 set 返回 Promise、落盘在防抖之后 —— **这两事必须分开**）；
     *   ok=false ⇒ 写入调用抛了（明确的失败）。
     */
    function writeAccessKey(key, value) {
        try {
            const ret = storage.set(key, value);
            if (ret && typeof ret.then === 'function') {
                try { Promise.resolve(ret).catch(function () { /* storage 侧自行报告 */ }); } catch (_e) { /* 忽略 */ }
            }
        } catch (e) {
            return { ok: false, kind: 'write-threw', why: '写入抛错：' + String((e && e.message) || e) };
        }
        /* 回读一次：读得到且**与写入值同形**才算落定；读不到不算失败（可能在防抖窗口里）。 */
        let back = null;
        try { back = storage.get(key); } catch (_e2) { back = null; }
        if (back === undefined || back === null || back === '') return { ok: true, kind: 'pending', why: '' };
        const same = (typeof value === 'boolean') ? (back === value || String(back) === String(value)) : (String(back) === String(value));
        if (!same) return { ok: false, kind: 'mismatch', why: '回读值不一致（写入 ' + String(value) + '，回读到 ' + String(back) + '）' };
        return { ok: true, kind: 'confirmed', why: '' };
    }

    /** 写 documentElement 上的三个数据属性（浏览器真懂的载体）。
     *   · `data-ax-level`  本机生效的操作层档（standard / enhanced / large）；
     *   · `data-ax-theme`  生效主题（light / dark）；
     *   · `data-ax-compact` 紧凑列表（1 存在即生效，0 时**移除**属性 —— 与 motion 的
     *     data-still 同规：属性存在即生效，写 0 仍会被 [data-ax-compact] 命中）。 */
    function applyAccessAttrs(win, state) {
        try {
            const doc = (win && win.document) ? win.document : null;
            const root = doc ? doc.documentElement : null;
            if (!root || !root.dataset) return { ok: false, why: 'no-documentElement' };
            root.dataset.axLevel = String(state.level);
            root.dataset.axTheme = String(state.theme);
            if (state.compact) root.dataset.axCompact = '1';
            else { try { delete root.dataset.axCompact; } catch (_e) { root.removeAttribute('data-ax-compact'); } }
            return { ok: true, why: '' };
        } catch (e) { return { ok: false, why: 'threw: ' + String((e && e.message) || e) }; }
    }

    /** 读三个键（**读不出与空分开**：读不出 ⇒ null，分别由上层说「读不出」）。 */
    function readAccessKeys() {
        const read = (k) => { try { return storage && typeof storage.get === 'function' ? storage.get(k) : null; } catch (_e) { return null; } };
        return {
            level: read(AX_LEVEL_KEY),
            compact: read(AX_PREF_KEYS.compact),
            theme: read(AX_PREF_KEYS.theme),
            fontPercent: read('phone-font-scale'),
            /* 动效档位**读既有真源**（config/motion.js 的 MOTION_STORAGE_KEY）：
             *   本版不新开「低动画」键 —— 同一件事两个存储位必然漂移。 */
            motionLevel: read(MOTION_STORAGE_KEY)
        };
    }

    /** 桌面图标的可读名盘点（**只读**当前 App 表，不渲染、不碰 DOM）。
     *   口径：名字取不到即如实计入 namesMissing，不编「按钮」。
     *   表的优先级：currentApps（用户改过显示名的现值）> APPS（出厂值）。
     *   两者都读不到（尚未 init）⇒ 如实返回 null ⇒ 上层说「未盘点」，**不报 0**。 */
    function auditIconNames() {
        let total = 0, missing = 0;
        let rows = null;
        try { if (typeof currentApps !== 'undefined' && Array.isArray(currentApps)) rows = currentApps; } catch (_e1) { rows = null; }
        if (!rows) { try { if (typeof APPS !== 'undefined' && Array.isArray(APPS)) rows = APPS; } catch (_e2) { rows = null; } }
        if (!rows) return { total: null, missing: null };
        for (const a of rows) {
            total += 1;
            if (!a11yNameUsable(iconA11yName(a))) missing += 1;
        }
        return { total: total, missing: missing };
    }

    /** 四态读数守恒：本页三个开关 + 档位来源 + 自检，逐格归到 markOf 的四态之一。 */
    function accessMarks(state) {
        const rows = [];
        const push = (k, raw, detail) => rows.push({ key: k, mark: markOf(raw, detail) });
        push('level', state.levelState, state.levelText);
        push('theme', state.themeState, state.themeText);
        push('compact', state.compact ? 'ok' : 'empty', state.compact ? '紧凑列表已开' : '紧凑列表未开');
        push('motion', state.motionState, '动效档位 ' + String(state.motionLevel === null ? '读不出' : state.motionLevel));
        push('font', state.fontKnown ? 'ok' : 'unknown', state.fontKnown ? ('字体缩放 ' + String(state.fontPercent) + '%') : '字体缩放读不出');
        push('names', state.namesMissing === null ? 'unknown' : (state.namesMissing === 0 ? 'ok' : 'fail'),
            state.namesMissing === null ? '桌面图标名未盘点' : ('缺 ' + String(state.namesMissing) + ' 个可读名'));
        return rows;
    }

    /**
     * 唯一取数口：读三个键 + 问两条系统政策 + 现算窄屏与遮挡守卫 → 缓存挂 vp._access。
     * 不 await、自带兜底：与 refreshCapHealth / refreshBackup 放在同一处。
     */
    function refreshAccess() {
        try {
            const vp = window.VirtualPhone;
            if (!vp) return;
            const win = (typeof window !== 'undefined') ? window : null;
            const keys = readAccessKeys();
            const env = readAccessEnv(win);
            const dark = readDarkEnv(win);
            /* 档位：用户显式 > 系统政策 > 默认。 */
            const lv = resolveAccessLevel(keys.level, env);
            /* 主题：用户显式 > 系统政策 > 亮色。 */
            const th = resolveTheme(keys.theme, { dark: dark });
            const compact = normalizeCompact(keys.compact);
            /* 窄屏判定需要真实视口宽：读不出（无宿主）⇒ 不判窄屏（内核如实退回标准布局）。 */
            const width = (win && typeof win.innerWidth === 'number') ? win.innerWidth : NaN;
            const plan = narrowPlan({ width: width, level: lv.level });
            const guard = overlapGuardOf(plan, keys.fontPercent);
            const attrs = applyAccessAttrs(win, { level: lv.level, theme: th.theme, compact: compact });
            const names = auditIconNames();
            const self = accessSelfCheck();
            /* 档位这一格的来源（谁定的）必须可读 —— 否则「我选了增强却看起来没生效」无法定位。 */
            const levelState = self.problems.length ? 'fail' : (attrs.ok ? 'ok' : 'fail');
            const levelText = '生效 ' + String(lv.level) + '（来源 ' + String(lv.source) + '）';
            const themeState = attrs.ok ? 'ok' : 'fail';
            const themeText = '主题 ' + String(th.theme) + '（来源 ' + String(th.source) + '）';
            const motionState = keys.motionLevel === null || keys.motionLevel === undefined ? 'unknown' : 'ok';
            const state = {
                level: lv.level, levelSource: lv.source, levelState: levelState, levelText: levelText,
                theme: th.theme, themeSource: th.source, themeState: themeState, themeText: themeText,
                compact: compact,
                motionLevel: (keys.motionLevel === null || keys.motionLevel === undefined) ? null : String(keys.motionLevel),
                motionState: motionState,
                fontPercent: (guard.band === undefined) ? null : (keys.fontPercent === null || keys.fontPercent === undefined ? null : Number(keys.fontPercent)),
                fontKnown: !!(keys.fontPercent !== null && keys.fontPercent !== undefined),
                plan: plan, guard: guard,
                namesMissing: names.missing, iconTotal: names.total,
                focusRing: lv.level === 'standard' ? 'auto' : 'always'
            };
            const marks = accessMarks(state);
            const counts = { ok: 0, fail: 0, unknown: 0, empty: 0 };
            for (const r of marks) counts[r.mark.state] += 1;
            let chatId = '';
            try { chatId = String((storage && storage.currentConversationId) || '').trim(); } catch (_ec) { chatId = ''; }
            let narrowNow = false;
            try { narrowNow = (win && typeof win.innerWidth === 'number') ? win.innerWidth <= AX_NARROW_WIDTH : false; } catch (_en) { narrowNow = false; }
            vp._access = {
                at: Date.now(), token: handoffEpoch(),
                chatId: chatId,
                /* 三格与其余协议面同形：缓存在场即可读；不可读的唯一形态是咽喉未挂（accessFace 返 null）。 */
                readable: true, why: '',
                level: lv.level, levelSource: lv.source, levelState: levelState, levelText: levelText,
                theme: th.theme, themeSource: th.source, themeState: themeState, themeText: themeText,
                compact: compact,
                motionLevel: state.motionLevel, motionState: motionState,
                fontPercent: state.fontPercent, fontKnown: state.fontKnown,
                plan: plan, guard: guard,
                narrowNow: narrowNow,
                focusRing: state.focusRing,
                namesMissing: state.namesMissing, iconTotal: state.iconTotal,
                marks: marks, counts: counts,
                selfCheck: self,
                attrs: attrs,
                touchMin: AX_TOUCH_MIN,   /* 点击目标下限（CSS 43/44px 那一格的真源） */
                ids: ACCESS_ACTION_KEYS.slice(),
                actions: ACCESS_ACTION_KEYS.slice(),
                writes: 0,          /* 取数口本身不写存储（只写 documentElement 属性） */
                note: (attrs.ok
                    ? ('已按 ' + String(lv.level) + ' 档落地（来源 ' + String(lv.source) + '）· 视口 ' + (plan.narrow ? '窄屏' : '标准') + '布局' + (state.fontKnown ? ' · 字号 ' + String(state.fontPercent) + '%' : ' · 字号读不出'))
                    : ('落地失败：' + String(attrs.why) + '（读数仍然可读，界面照常显示这一格）'))
            };
        } catch (e) {
            console.warn('[Access] 无障碍操作层取数失败:', e);
        }
    }

    /**
     * 唯一动作口：白名单先判 → 取数 → 世代检查（视图给了 token 才比）→ 写 → 重取。
     * 三个动作一一对应三个键；**没有第四个动作**（preview 根本不写东西，故不经这里）。
     * @returns {{ok:boolean, note:string, kind:string}}
     */
    function applyAccessAction(payload) {
        const p = (payload && typeof payload === 'object') ? payload : {};
        try {
            const action = String(p.action || '');
            if (ACCESS_ACTION_KEYS.indexOf(action) < 0) return { ok: false, note: '不在白名单的动作：' + action, kind: 'unknown-action' };
            refreshAccess();
            const face = window.VirtualPhone ? window.VirtualPhone._access : null;
            if (!face) return { ok: false, note: '读数还没取到（咽喉那一轮尚未跑）', kind: 'absent' };
            if (p.token !== undefined && p.token !== null && p.token !== handoffEpoch()) {
                return { ok: false, note: '世代已变，拒旧按钮', kind: 'stale-epoch' };
            }
            const value = p.value;
            if (action === 'level') {
                const v = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
                if (['standard', 'enhanced', 'large'].indexOf(v) < 0) return { ok: false, note: '不认的档位：' + v, kind: 'bad-value' };
                const w = writeAccessKey(AX_LEVEL_KEY, v);
                refreshAccess();
                if (!w.ok) return { ok: false, note: '操作层档位没写下去：' + w.why, kind: w.kind };
                return { ok: true, note: '操作层档位 → ' + v + '（' + (w.kind === 'confirmed' ? '已回读到' : '已排队，稍后落盘') + '）', kind: 'level' };
            }
            if (action === 'compact') {
                const on = (value === true || value === 'on' || value === 'true');
                const w = writeAccessKey(AX_PREF_KEYS.compact, on);
                refreshAccess();
                if (!w.ok) return { ok: false, note: '紧凑列表没写下去：' + w.why, kind: w.kind };
                return { ok: true, note: '紧凑列表 → ' + (on ? '开' : '关') + '（' + (w.kind === 'confirmed' ? '已回读到' : '已排队，稍后落盘') + '）', kind: 'compact' };
            }
            if (action === 'theme') {
                const v = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
                if (['auto', 'light', 'dark'].indexOf(v) < 0) return { ok: false, note: '不认的主题：' + v, kind: 'bad-value' };
                const w = writeAccessKey(AX_PREF_KEYS.theme, v);
                refreshAccess();
                if (!w.ok) return { ok: false, note: '主题没写下去：' + w.why, kind: w.kind };
                return { ok: true, note: '主题 → ' + v + '（' + (w.kind === 'confirmed' ? '已回读到' : '已排队，稍后落盘') + '）', kind: 'theme' };
            }
            return { ok: false, note: '未接的动作', kind: 'unhandled' };
        } catch (e) {
            return { ok: false, note: '执行失败：' + String((e && e.message) || e), kind: 'error' };
        }
    }

''' + THROAT_ANCHOR
patch('throat', THROAT_ANCHOR, THROAT_NEW)

# ---------- ③ 刷新链 ----------
REF_ANCHOR = "        try { refreshCapHealth(); } catch (_chr) { /* 自带兜底，不拖累日历 */ }"
REF_NEW = REF_ANCHOR + """
        /* [v3.93.0 · 拓展计划 R-X9] 无障碍操作层取数：与上一条同族（同一份「读不到≠没有」的纪律）。
         *   它读的是**设备级**读数（视口宽 / 系统政策 / 三个键），跟剧情时间无关，故同样放在
         *   早退之前。取数只写 documentElement 属性、不写存储（验收「设置重开后保留」由键负责）。 */
        try { refreshAccess(); } catch (_axr) { /* 自带兜底，不拖累日历 */ }"""
patch('refresh-chain', REF_ANCHOR, REF_NEW)

# ---------- ④ 挂 window.VirtualPhone ----------
VP_ANCHOR = """                capHealthFace: function () { refreshCapHealth(); const v = window.VirtualPhone; return v ? v._caphealth || null : null; },
                applyCaphealthAction: applyCaphealthAction,"""
VP_NEW = VP_ANCHOR + """
                /* [v3.93.0 · 拓展计划 R-X9] 无障碍操作层：只读读数口 + 唯一动作口。
                 *   读数口**每次读都重采**（视口宽会变、系统政策会变、档位会变）。 */
                accessFace: function () { refreshAccess(); const v = window.VirtualPhone; return v ? v._access || null : null; },
                applyAccessAction: applyAccessAction,"""
patch('virtualphone', VP_ANCHOR, VP_NEW)

# ---------- ⑤ REBIND 表 ----------
RB_ANCHOR = """    'caphealthApp',   // [v3.92.0 · R-X8] 能力体检：提示行与已生成的报告是**实例态** ——"""
RB_NEW = """    'accessdeskApp',  // [v3.93.0 · R-X9] 无障碍操作台：提示行与预览档是**实例态** ——
                      //             换会话必须丢（上一段会话的预览不能留着）；
                      //             三个设置键随会话隔离（^sys_），档位属性由咽喉下一次 render 重写。
    'caphealthApp',   // [v3.92.0 · R-X8] 能力体检：提示行与已生成的报告是**实例态** ——"""
patch('rebind', RB_ANCHOR, RB_NEW)

io.open(IDX, 'w', encoding='utf-8').write(src)
print('OK index.js %d -> %d 字节' % (before, len(src)))