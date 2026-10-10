#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R-X9 消费面补丁：把「键盘可达 + 可读名」接进真实桌面（验收第一条的落点）。

【为什么必须落在 home-screen.js 而不只落在新 App 里】
  计划验收第一句是「核心操作可通过键盘与触摸完成」。实测修前处境：
  `bindEvents` 只给图标挂 `onclick` —— **没有 tabindex、没有 role、没有 aria-label**，
  键盘用户既 Tab 不过去、读屏也不知道每个图标叫什么（`aria-label` 全仓 270 处，
  桌面图标一处都没有）。放进新 App 里等于把这条验收做成「在新 App 里成立」，
  那正是本仓点过多次的「建好了、挂出来了、产品面零消费」。

本补丁做四件事（都在 home-screen.js）：
  ① 顶部 import：iconA11yName（可读名的唯一实现）；
  ② renderAppIcon / renderDockIcon 给图标加 role="button" + tabindex="0" + aria-label；
  ③ bindEvents 给图标加 Enter / Space 键盘激活（与 onclick 同一入口 openApp）；
  ④ 焦点环由 phone.css 统一给（见 patch_rx9_focus.py），本文件不写样式。
"""
import io
import sys

ROOT = '/home/user/ruby-phone'
PATH = 'phone/home-screen.js'
src = io.open(ROOT + '/' + PATH, encoding='utf-8').read()


def patch(name, anchor, replacement, expect=1):
    global src
    n = src.count(anchor)
    if n != expect:
        print('FAIL [%s] 锚点命中 %d 次（要求 %d）' % (name, n, expect))
        sys.exit(1)
    src = src.replace(anchor, replacement, 1)
    print('  ok %s' % name)


# ---------- ① import ----------
patch('import',
      "import { childRuntime } from '../config/runtime-lifecycle.js';   // [v2.31.0] 实例级资源域",
      """import { childRuntime } from '../config/runtime-lifecycle.js';   // [v2.31.0] 实例级资源域
/* [v3.93.0 · 拓展计划 R-X9] 桌面图标的可读名（唯一实现在内核，本文件只消费）。
 *   修前实测：本文件给图标只挂了 onclick —— 没有 tabindex / role / aria-label，
 *   键盘 Tab 不过去、读屏也不知道每个图标叫什么。名字的真源就在 app 数据里
 *   （自定义显示名 > App 名），只是此前没接出来。 */
import { iconA11yName, a11yNameUsable } from '../config/access-layers.js';""")

# ---------- ② renderAppIcon ----------
APPICON_ANCHOR = """        return `
            <div class="app-icon yzp-home-app-icon yzp-home-app-action" data-app="${app.id}" style="--app-color: ${app.color}">
                <div class="app-icon-bg yzp-home-app-icon-bg ${customClass}" style="${iconStyle}">
                    ${iconContent}
                </div>
                ${badge}
                <div class="app-name yzp-home-app-name">${this._escapeHtml(this._getAppDisplayName(app))}</div>
            </div>
        `;"""
APPICON_NEW = """        /* [v3.93.0 · R-X9] 可读名与键盘可达**在同一处**给：名字取不到就如实空串
         *   （内核 a11yNameOf 的口径：不编「按钮」）—— 此时只加 tabindex/role，
         *   不加空的 aria-label（加了等于告诉读屏「这个控件的名字是空字符串」）。 */
        const a11y = iconA11yName({ displayName: this._getAppDisplayName(app), name: app.name, ariaLabel: app.ariaLabel });
        const ariaAttr = a11yNameUsable(a11y) ? ` aria-label="${this._escapeHtml(a11y.name)}"` : '';

        return `
            <div class="app-icon yzp-home-app-icon yzp-home-app-action" data-app="${app.id}" style="--app-color: ${app.color}" role="button" tabindex="0"${ariaAttr}>
                <div class="app-icon-bg yzp-home-app-icon-bg ${customClass}" style="${iconStyle}">
                    ${iconContent}
                </div>
                ${badge}
                <div class="app-name yzp-home-app-name" aria-hidden="true">${this._escapeHtml(this._getAppDisplayName(app))}</div>
            </div>
        `;"""
patch('renderAppIcon', APPICON_ANCHOR, APPICON_NEW)

# ---------- ③ renderDockIcon ----------
DOCK_ANCHOR = """            return `
                <div class="dock-app yzp-home-dock-app ${customClass}" data-app="${app.id}" style="${iconStyle}">
                    ${iconContent}
                </div>
            `;"""
DOCK_NEW = """            const a11y = iconA11yName({ displayName: this._getAppDisplayName(app), name: app.name, ariaLabel: app.ariaLabel });
            const ariaAttr = a11yNameUsable(a11y) ? ` aria-label="${this._escapeHtml(a11y.name)}"` : '';

            return `
                <div class="dock-app yzp-home-dock-app ${customClass}" data-app="${app.id}" style="${iconStyle}" role="button" tabindex="0"${ariaAttr}>
                    ${iconContent}
                </div>
            `;"""
patch('renderDockIcon', DOCK_ANCHOR, DOCK_NEW)

# ---------- ④ 键盘激活 ----------
BIND_ANCHOR = """        const icons = this.phoneShell.screen.querySelectorAll('.yzp-home-app-action, .yzp-home-dock-app, .app-icon, .dock-app');
        icons.forEach(icon => {
            icon.onclick = (e) => {
                e.stopPropagation();
                const appId = icon.dataset.app;
                this.openApp(appId);"""
BIND_NEW = """        /* 图标句柄在**同一处**挂三种激活方式：点击 / 键盘 Enter / 键盘 Space。
         *   为什么 Space 要 preventDefault：浏览器默认会用 Space 滚动页面，
         *   不拦住就会「按下空格时图标被激活 + 桌面同时滚了一段」（两个后果，其中一个没人要）。 */
        const icons = this.phoneShell.screen.querySelectorAll('.yzp-home-app-action, .yzp-home-dock-app, .app-icon, .dock-app');
        icons.forEach(icon => {
            const activate = () => {
                const appId = icon.dataset.app;
                if (!appId) return;
                this.openApp(appId);
            };
            icon.onclick = (e) => {
                e.stopPropagation();
                const appId = icon.dataset.app;
                this.openApp(appId);"""
patch('bind-click', BIND_ANCHOR, BIND_NEW)

BIND2_ANCHOR = """                const appId = icon.dataset.app;
                this.openApp(appId);
            };
        });"""
BIND2_NEW = """                const appId = icon.dataset.app;
                this.openApp(appId);
            };
            /* 键盘：只在图标自身聚焦时响应（不装到 document 上 —— 那会与 App 内的
             *   输入框抢按键）。Enter 与 Space 都走同一个 activate()。 */
            icon.onkeydown = (e) => {
                if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
                e.preventDefault();
                e.stopPropagation();
                activate();
            };
        });"""
patch('bind-keydown', BIND2_ANCHOR, BIND2_NEW)

io.open(ROOT + '/' + PATH, 'w', encoding='utf-8').write(src)
print('OK phone/home-screen.js -> %d 字节' % len(src))