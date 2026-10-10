# -*- coding: utf-8 -*-
"""R-X8 字段对平：咽喉缓存 ↔ App/视图 读数键名。

【抓到的真缺陷（本版自己实测，不是推演）】
  咽喉 `refreshCapHealth()` 写进 `vp._caphealth` 的键是 `hostVersionText`，
  且**没有** `readable` / `why` 两格；而 App `_vm()` 读的是
  `host.hostVersionLine` / `host.readable` / `host.why`。三处对不上：
    · 宿主版本行永远显示「宿主版本还没取到」（明明取到了）；
    · `faceReadable` 恒为 false ⇒ 界面永远挂着一条「能力面取数口不在位」红字（假故障）。
  这一类「键名对不上」不会报错、不会崩，只**静默显示错读数** —— 本仓最贵的那一类。

【修法（两侧同时改，不让任何一侧迁就另一侧）】
  · 咽喉缓存补 `readable: true` 与 `why: ''`：取数口真跑完一轮才写这份缓存，
    所以「缓存在场」**就是**「读数可读」；不可读的唯一形态是 `capHealthFace()==null`
    （咽喉未挂），那一支由 App 的 host()==null 分支如实说「入口不在位」。
  · App 改读 `hostVersionText`（咽喉那份名字），不再读不存在的 `hostVersionLine`。
"""
import io
import sys

ROOT = '/home/user/ruby-phone'
IDX = ROOT + '/index.js'
APP = ROOT + '/apps/caphealth/caphealth-app.js'

IDX_OLD = """                hostVersion: chHostVersion(win),
                hostVersionText: String(notice.idLine || ''),"""
IDX_NEW = """                hostVersion: chHostVersion(win),
                /* 宿主版本那一行**按内核唯一文案来**（notice.idLine 只说身份：本机 / 宿主）——
                 *   不在咽喉另拼一句，否则同一读数会有两种说法。 */
                hostVersionText: String(notice.idLine || ''),
                /* readable / why 两格与其余协议面同形：**缓存在场即读数可读**
                 *   （本取数口跑完一轮才写这份缓存）。不可读只有一种形态 —— 咽喉没挂，
                 *   那一支由 `capHealthFace()` 返回 null 表达，App 据 null 说「入口不在位」。 */
                readable: true,
                why: '',"""

APP_OLD = """            hostVersionLine: (host && host.hostVersionLine) ? String(host.hostVersionLine) : '宿主版本还没取到',"""
APP_NEW = """            /* 键名与咽喉缓存逐字对齐（`hostVersionText`）：本版实测抓到过一处错位 ——
             *   这里曾读 `hostVersionLine`，而咽喉写的是 `hostVersionText` ⇒
             *   宿主版本明明取到了，界面永远显示「还没取到」（不报错、只错读数）。 */
            hostVersionLine: (host && host.hostVersionText) ? String(host.hostVersionText) : '宿主版本还没取到',"""


def main():
    idx = io.open(IDX, encoding='utf-8').read()
    app = io.open(APP, encoding='utf-8').read()
    for name, src, old in (('index.js', idx, IDX_OLD), ('caphealth-app.js', app, APP_OLD)):
        n = src.count(old)
        print(name, 'anchor-count', n)
        if n != 1:
            print('ABORT', name)
            sys.exit(1)
    io.open(IDX, 'w', encoding='utf-8').write(idx.replace(IDX_OLD, IDX_NEW))
    io.open(APP, 'w', encoding='utf-8').write(app.replace(APP_OLD, APP_NEW))
    print('OK index.js', len(io.open(IDX, encoding='utf-8').read().encode('utf-8')))
    print('OK caphealth-app.js', len(io.open(APP, encoding='utf-8').read().encode('utf-8')))


if __name__ == '__main__':
    main()