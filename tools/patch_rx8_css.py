# -*- coding: utf-8 -*-
"""R-X8 样式投递：把 caphealth 的类前缀族 `.ch-*` 改名 `.cph-*`，再合并进 phone.css。

【为什么必须改名（不是洁癖）】
  实测 `apps/cheat/cheat.css`（金手指 App，v2.47.0）已占用 `.ch-*` 族，与 caphealth
  **八个类名逐字重名**：ch-root / ch-head / ch-title / ch-badge / ch-btn / ch-note /
  ch-pre / ch-row。两者的取值方向还相反（cheat 是深色鎏金全屏，caphealth 是浅色卡片），
  直接按「机制 A」把内容并进 phone.css ⇒ 同名选择器互相覆盖，**金手指界面当场走形**
  （且不报错：registry 门只看「前缀族在不在 phone.css 里」，看不出撞车）。
  本仓「目录 ↔ 文件 ↔ 类 ↔ 槽位」四一致约定管的是命名派生，不管**前缀族唯一性** ——
  这一条只能靠人看出来，所以在此写下来。

【改名范围】
  · `apps/caphealth/caphealth.css`：`.ch-xxx` → `.cph-xxx`；
  · `apps/caphealth/caphealth-view.js`：类名字符串 `ch-xxx` → `cph-xxx`。
  ★ **不动** 属性名 `data-ch-act`（那是动作白名单的 DOM 契约，判据套件按它取动作）——
    正则用 `(?<![\\w-])ch-` 负向后顾：`data-` 里的 `-` 会挡住它，类名上下文（`'` / `"` / `.` 之后）放行。
"""
import io
import os
import re
import sys

ROOT = '/home/user/ruby-phone'
CSS = os.path.join(ROOT, 'apps', 'caphealth', 'caphealth.css')
VIEW = os.path.join(ROOT, 'apps', 'caphealth', 'caphealth-view.js')
PHONE = os.path.join(ROOT, 'phone.css')

REN = re.compile(r'(?<![\w-])ch-')


def main():
    for p in (CSS, VIEW, PHONE):
        if not os.path.exists(p):
            print('缺文件，ABORT:', p)
            sys.exit(1)

    css = io.open(CSS, 'r', encoding='utf-8').read()
    view = io.open(VIEW, 'r', encoding='utf-8').read()
    phone = io.open(PHONE, 'r', encoding='utf-8').read()

    n_css = len(REN.findall(css))
    n_view = len(REN.findall(view))
    print('改名点数 css=%d view=%d' % (n_css, n_view))
    if n_css < 20 or n_view < 20:
        print('改名点太少（疑似未命中），ABORT')
        sys.exit(1)

    css2 = REN.sub('cph-', css)
    view2 = REN.sub('cph-', view)

    # 反坐实：data-ch-act 必须原样留下；且不得再有裸 ch- 类名残留
    if 'data-ch-act' not in view2:
        print('data-ch-act 被误改，ABORT')
        sys.exit(1)
    if REN.search(css2):
        print('css 里仍有裸 ch-，ABORT')
        sys.exit(1)
    left = [m.group(0) for m in re.finditer(r'(?<![\w-])ch-', view2)]
    if left:
        print('view 里仍有裸 ch-：', left[:5], 'ABORT')
        sys.exit(1)
    if '.cph-' not in css2:
        print('css 未产出 cph-，ABORT')
        sys.exit(1)

    # 合并进 phone.css：与 backupdesk / creationdesk 同规格（原样贴一份，带小节标题）
    if '.cph-' in phone:
        print('phone.css 里已有 .cph- —— 疑似重复执行，ABORT')
        sys.exit(1)
    block = ('/* ══════════════ [v3.92.0] 能力体检（caphealth） ══════════════ */\n'
             + css2.rstrip('\n') + '\n')
    if not phone.endswith('\n'):
        phone += '\n'
    phone2 = phone + block

    io.open(CSS, 'w', encoding='utf-8').write(css2)
    io.open(VIEW, 'w', encoding='utf-8').write(view2)
    io.open(PHONE, 'w', encoding='utf-8').write(phone2)
    print('OK css %d -> %d' % (len(css.encode('utf-8')), len(css2.encode('utf-8'))))
    print('OK phone.css %d -> %d' % (len(phone.encode('utf-8')), len(phone2.encode('utf-8'))))
    print('cph- 出现次数 phone.css =', phone2.count('.cph-'))


if __name__ == '__main__':
    main()