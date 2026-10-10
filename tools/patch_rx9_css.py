#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R-X9 全局样式补丁：焦点环 + 状态标记「不只靠颜色」+ 320px 窄屏布局。

【为什么这三段必须进 phone.css（全局）而不是各 App 自己写】
  验收第三句是「空 / 未知 / 失败 / 成功有文字或图标辅助」，第四句是「320px 窄屏专门布局」。
  修前实测：
    · focus-visible 全仓只有 5 个文件有，且全写在**具体控件 ID** 上；桌面图标、
      任务入口卡片、dock 一处都没有 —— 键盘用户在这些地方看不见焦点落在哪。
    · 状态标记（.app-badge / .badge-notification / .phone-call-status-dot 等 10+ 处）
      只有色块，没有文字或图形辅助。
    · 320px 没有任何一条媒体查询（两条 `max-width: 320px` 是宽度取值，不是断点）。
  这三件事的共同点是「**每一处都各自实现一遍就会漏**」：漏掉的那一处不报错、
  只是对某类用户不可用。故统一进 phone.css（全局唯一真源），并在判据里钉住。

断点值取自内核 AX_NARROW_WIDTH（320）—— 本文件是 CSS，取不到 JS 常量，
  故在注释里点名真源，并由判据套件用内核值去比对本文件里的字面量（防漂移）。
"""
import io
import sys

ROOT = '/home/user/ruby-phone'
PATH = 'phone.css'
src = io.open(ROOT + '/' + PATH, encoding='utf-8').read()

BANNER = '\n/* ══════════════ [v3.93.0 · R-X9] 无障碍操作层（焦点环 / 状态标记 / 窄屏） ══════════════ */\n'

SECTION = BANNER + """/* ── ① 焦点环：键盘可达性的**可见那一半**（另一半是 tabindex + keydown，在 home-screen.js） ──
 * 为什么用 :focus-visible 而不是 :focus：:focus 对鼠标点击也生效，会让鼠标用户
 *   看到一圈本不该出现的轮廓（本仓既有 10 处就是这么写的，只覆盖了具体控件）。
 * 覆盖面：桌面图标 / dock 图标 / 任务入口 / 无障碍操作台 / 通用按钮型句柄。
 *   `outline` 单列而不是用 box-shadow：那就不会被任何 `overflow:hidden` 父层裁掉
 *   （桌面图标外层有 overflow 约束，用 box-shadow 会被吃掉一半）。 */
#phone-panel-content .phone-screen :is(
    .app-icon, .dock-app, .home-page-dot, .yzp-home-app-action, .yzp-home-dock-app,
    .home-card, [role="button"], [tabindex]:not([tabindex="-1"])
):focus-visible {
    outline: 2px solid var(--iphone-accent, #0a84ff);
    outline-offset: 2px;
    border-radius: 10px;
}

/* ── ② 状态标记：文字或符号是**主**载体，颜色是附加 ──
 * 口径：`.ax-mark` 是内核 markOf() 产出的标记（含文字 + 符号），
 *   本段只负责「去掉颜色之后仍看得出差别」——即符号不许只靠 color 区分。
 * 为什么要 `[data-ax-mark]` 属性选择器而不是只靠类名：类名可能被复用，
 *   而属性是内核显式打上的（写错就查得到）。 */
.ax-mark { font-weight: 600; }
.ax-mark::before { content: attr(data-ax-mark); margin-right: 4px; }
.ax-mark[data-ax-state="ok"] { color: #2f6b3a; }
.ax-mark[data-ax-state="fail"] { color: #a03a2a; }
.ax-mark[data-ax-state="unknown"] { color: #7a6a3a; }
.ax-mark[data-ax-state="empty"] { color: #6a6a6a; }

/* ── ③ 320px 窄屏专门布局（断点真源：config/access-layers.js 的 AX_NARROW_WIDTH = 320） ──
 * 修前实测：本文件**没有**任何 320px 媒体查询 —— 320px 设备上桌面四列挤成一团、
 *   dock 图标叠字、按钮行溢出。本段给一条**专门布局**（不是「顺带挤一挤」）：
 *   图标三列、字号降一档、按钮行允许换行、状态行高度自适应。 */
@media (max-width: 320px) {
    /* 桌面：四列 → 三列（列数是分页容量的来源之一，home-screen.js 用内核的 narrowPlan 取同一份口径）。 */
    #phone-panel-content .phone-screen .home-screen .app-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        gap: 3% !important;
        padding: 3% 4% !important;
    }
    #phone-panel-content .phone-screen .home-screen .app-icon-bg {
        width: 46px !important;
        height: 46px !important;
    }
    #phone-panel-content .phone-screen .home-screen .app-name {
        font-size: 10px !important;
        max-width: 46px !important;
    }
    /* dock：保留文字（去掉就成了一排无标签色块 —— 验收③的反面），但缩字号。 */
    #phone-panel-content .phone-screen .home-screen .dock-app .app-name {
        font-size: 9px !important;
    }
    /* 设置页与通用卡片：按钮行换行、状态行高度自适应（对应内核 overlapGuardOf 的两格）。 */
    #phone-panel-content .phone-body-panel :is(.setting-item, .settings-row, .axd-row) {
        flex-wrap: wrap !important;
    }
    #phone-panel-content .phone-body-panel :is(.setting-btn, .axd-btn, .axd-cap) {
        min-height: 40px;
    }
}

/* ── ④ 大字体档（>115%）：按钮行换行 + 定高行改自适应 ──
 * 与窄屏段**分列**而不是合并：两件事的成因不同（一个是视口窄、一个是字号大），
 *   合并会造出「大字号设备被当成窄屏」或反之的假处置。
 * 选择器带 `html[data-ax-band="large"]` —— 该属性由咽喉 refreshAccess() 写。 */
html[data-ax-band="large"] #phone-panel-content .phone-body-panel :is(.setting-item, .settings-row, .axd-row) {
    flex-wrap: wrap !important;
    row-gap: 4px !important;
}
html[data-ax-band="large"] #phone-panel-content .phone-body-panel :is(.setting-btn, .axd-btn, .axd-cap) {
    min-height: 44px;
}
html[data-ax-band="large"] #phone-panel-content .phone-body-panel :is(.setting-desc, .axd-dim) {
    line-height: 1.6 !important;
}

/* ── ⑤ 深色模式：只覆盖**不透明底 + 文字色**两族，不做「全仓换肤」 ──
 * 为什么克制：本仓 1218 处用 var(--phone-*) 取色，但绝大多数 App 的局部样式是
 *   写死的浅色。全仓换肤等于重做一遍所有 App 的配色（那是另一版的工作量），
 *   而「只把外壳与通用面板压暗」已经能让深色档**真的看得出是深色**，
 *   且不会把某个 App 的文字压成看不见（那是「做了深色反而更糟」）。
 * 属性 `html[data-ax-theme="dark"]` 由咽喉写；未写时本段不生效（默认亮色）。 */
html[data-ax-theme="dark"] {
    --phone-global-text: #e8e6e2;
    --settings-text-color: #e8e6e2;
    --settings-muted-text-color: #a8a49c;
}
html[data-ax-theme="dark"] #phone-panel-content .phone-body-panel,
html[data-ax-theme="dark"] #phone-panel-content .phone-screen .home-screen,
html[data-ax-theme="dark"] #phone-panel-content .axd-wrap,
html[data-ax-theme="dark"] #phone-panel-content .te-wrap,
html[data-ax-theme="dark"] #phone-panel-content .cph-wrap {
    background: #1c1c1e;
    color: #e8e6e2;
}
html[data-ax-theme="dark"] #phone-panel-content :is(.axd-box, .te-card, .cph-box) {
    background: #2a2a2c;
    border-color: #3a3a3c;
}
"""

if '无障碍操作层（焦点环 / 状态标记 / 窄屏）' in src:
    print('skip（已投递，幂等）')
    sys.exit(0)

io.open(ROOT + '/' + PATH, 'w', encoding='utf-8').write(src + SECTION)
print('OK phone.css %d -> %d 字节' % (len(src), len(src) + len(SECTION)))