# -*- coding: utf-8 -*-
"""R-X8 咽喉接线（第二段）：取数口挂进日历刷新链 + 窗口挂载 + REBIND 表。

四处同源改动，每处都先断言锚点恰中 1 次（防重复执行把代码块写两遍）。
"""
import io
import os
import sys

ROOT = '/home/user/ruby-phone'
IDX = os.path.join(ROOT, 'index.js')

# ── ① 取数口挂进「剧情时间更新后」的统一刷新链（与 R-X1..R-X7 同族） ──
A1 = u"""        /* [v3.91.0 · 拓展计划 R-X7] 备份与恢复的只读取数：与上两条同族。键枚举是只读的（不触发迁移）。 */
        try { refreshBackup(); } catch (_bkr) { /* 自带兜底，不拖累日历 */ }"""
B1 = A1 + u"""
        /* [v3.92.0 · 拓展计划 R-X8] 宿主与能力健康取数：与上三条同族（同一份「读不到≠没有」的纪律）。
         *   它读的是**设备级**读数（本机版本 / 宿主版本 / 桥在场 / 浏览器能力），跟剧情时间无关，
         *   故同样放在早退之前。检测本身零写入、零模型调用（验收③）。不 await。 */
        try { refreshCapHealth(); } catch (_chr) { /* 自带兜底，不拖累日历 */ }"""

# ── ② 窗口挂载：只读读数口 + 唯一动作口 ──
A2 = u"""                backupFace: function () { refreshBackup(); const v = window.VirtualPhone; return v ? v._backup || null : null; },
                applyBackupAction: applyBackupAction,"""
B2 = A2 + u"""
                /* [v3.92.0 · 拓展计划 R-X8] 能力体检：只读读数口（视图与诊断读这一份）+ 唯一动作口
                 *   （白名单只有一个：report —— 本 App 是纯读数面，没有任何写动作）。
                 *   读数口**每次读都重采**：宿主重载 / 桥上下线 / 通道改选都会改变读数，
                 *   缓存一份陈读数正是本仓最贵的那类错读数（「上次测是好的」）。 */
                capHealthFace: function () { refreshCapHealth(); const v = window.VirtualPhone; return v ? v._caphealth || null : null; },
                applyCaphealthAction: applyCaphealthAction,"""

# ── ③ REBIND 表：换会话必须丢实例态 ──
A3 = u"""    'searchApp'       // [v3.58.0] 全局搜索："""
B3 = u"""    'caphealthApp',   // [v3.92.0 · R-X8] 能力体检：提示行与已生成的报告是**实例态** ——
                      //             换会话必须丢（上一段会话复制出来的报告不能留着），
                      //             六项能力的观测由咽喉下一次 render 现采（设备级读数，不随会话变）。
    'searchApp'       // [v3.58.0] 全局搜索："""

PAIRS = [(A1, B1, 'calendar-refresh'), (A2, B2, 'window-mount'), (A3, B3, 'rebind-table')]


def main():
    with io.open(IDX, 'r', encoding='utf-8') as f:
        src = f.read()
    ok = True
    for a, b, name in PAIRS:
        n = src.count(a)
        print(name, 'anchor-count', n)
        if n != 1:
            ok = False
            continue
        src = src.replace(a, b)
    if not ok:
        print('ABORT: 有锚点不唯一')
        sys.exit(1)
    with io.open(IDX, 'w', encoding='utf-8') as f:
        f.write(src)
    print('OK index.js', len(src.encode('utf-8')))


if __name__ == '__main__':
    main()