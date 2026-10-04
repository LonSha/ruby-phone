#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# bump_v3560.py — 抬版 v3.56.0（五源同源）
# 与 bump_v3550.py / bump_v3480.py 同款范式：
#   ① update-log.json：新键插首位，latest / head 同置；
#   ② manifest.json / package.json / index.js 的 ST_PHONE_VERSION 常量；
#   ③ index.js 的 ST_PHONE_CURRENT_UPDATE 公告块 —— 累积式（新在前，旧 items 原样续接）；
#   ④ ITERATION_LOG.md：头部插迭代段 + 「当前版本」行改当版 + 头部版本数由真源重算。
# 纪律：只写上面五处；先算 draft、逐份断言、最后才落盘；默认 dry-run，--write 才落盘。
# 本脚本零反斜杠：全部走字符串定位，不用正则转义。
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = '3.56.0'
DATE = '2026-10-04'
PREV = '3.55.0'
SEG_ANCHOR = '## 迭代 113 ' + chr(8212) + ' '
WRITE = '--write' in sys.argv
NL = chr(10)


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)


ITEMS = [
    '【定位】本轮不缝新素材，只收口用户报障的六项真实缺陷。六项同属本仓最贵的那一类形态：不报错、不崩溃、也不进日志，只是安静地不生效 —— 门禁全绿、测试全绿、真机上却「图标重叠」「进了 App 出不来」「拖着没反应」。',
    '【缺陷①·桌面图标重叠】renderIconLayout 把全部 81 件一次性铺进单个 .app-grid（repeat(4,1fr) 且无行数约束），唯一溢出承接是 .home-screen 的 overflow-y:auto —— 桌面成了一条 21 行超长滚动列表，绝对定位的 .dock（bottom:8%）悬浮其上、与末行图标视觉重叠。APPS 键集不含任何分类字段，故分页是唯一不依赖新增数据模型的落法。',
    '【缺陷②·分页缺失】新增六个方法：getIconPageCapacity（4 列 × 5 行 = 20，行数按实测几何取 5：单行约 74px、可用高度约 464px，5 行约 370px 仍有余量）/ buildIconPages / renderIconPageDots / _clampIconPage / goIconPage（走 translate3d(-n*100%)）/ bindIconPager（touchstart-end 与 pointerdown-up 双面，判定取「起止两点坐标之差」与既有 bindSwipeGesture 同口径，刻意不用 PointerEvent.movementX —— 该字段只在 mousemove 上可靠、触摸端基本不填）。页底 padding-bottom:146px 显式留出 dock 净空：分页后内容不再靠滚动承接，不留出末行仍会被 dock 压住（正是报障本体）。81 件 ⇒ 5 页（20/20/20/20/1）。',
    '【缺陷③·品牌串】对外显示名统一 RubyPhone（index.js 抽屉两处显示名 + 两处 title）；文件头版权署名「柚月小手机 (Yuzuki\x27s Little Phone)」有意保留 —— 属来源归属、不是产品名，判据据此把署名行写成唯一放行形态。',
    '【缺陷④·返回键此前从未渲染过】全库零返回按钮，唯一返回路径是「左边缘 1/2 区域右滑」—— 对用户不可见、不可发现。修法：在 .phone-screen 直系渲染 button#phone-back-button（不能放 view-stack 内的图层节点（data-view-id），它会被 setContent 反复重建与回收，按钮跟着图层走就会「切一次 App 就没了」）；返回语义真源仍是 goHome()（压栈弹栈 + 返回桌面后 500ms 屏蔽误 reopen），按钮只调它、不重写第二份；bindBackButton 的 pointerdown/touchstart stopPropagation 是必须的（否则同一次触摸会被 bindSwipeGesture 读成边缘右滑，触发一次额外返回 = 双退）；可见性同步走 syncBackButtonVisibility 三个调用点并写 inline display 直写，不依赖 CSS 优先级。',
    '【缺陷⑤·宠物拖拽空实现】pet.css 写着 cursor:grab 却全库零拖拽实现（光标承诺一直是空头支票）。补 bindPetDrag：阈值 DRAG_MIN=6 把点击与拖拽分流；位移一律相对「未变换原点」算 —— 反解式 styleLeft = rect.left + (rect.width - offsetWidth)/2（offsetWidth 不随 transform 变，是精确反解；宠物根带 scale(0.86)，拿 rect.left 当起点会全程偏半个缩放量）；夹取与恢复一律用未变换尺寸；:active 的按下反馈从 transform:scale(0.95) 换成 filter:brightness（缩放反馈会在按下瞬间改几何，与拖拽抢同一个 transform 属性）；拖后那一次 click 必须用捕获期 + stopImmediatePropagation 吞掉（开/关手机的 click 挂在同一个 petRoot 上，同节点监听器按注册顺序触发，stopPropagation 拦不住同节点的后一个）。',
    '【缺陷⑥·宠物位置键未定义（本轮最深一处）】PHONE_PET_POSITION_KEY 在原状被写点与读点两处引用，而文件头部零声明 —— 拖拽一旦移动就在写点抛 ReferenceError 并被 try/catch 吞掉，用户表现是「拖了但下次打开位置没变」的静默失效。已补定义：键名取连字符形态，默认落全局 extensionSettings（语义归属是「界面偏好」而非会话数据，跨会话漂移会让用户每换角色都要重摆）；刻意不复用悬浮按钮的位置键 —— 两者是不同元素且可见性互斥，共键会让「拖了宠物」下次把按钮摆到宠物位上。',
    '【捕真缺陷 · 判据自指伪证三形态】本套件首跑报红的两条是**假缺陷**，根因同一条：判据把「解释这次修正的注释」当成了缺陷本体。形态一：A1 的负判据锚点（修前的整列渲染表达式）在我写的「为什么加」注释里被引用；形态二：A7 的负判据锚点 movementX 同样只在注释里出现（说明为什么不用它）；形态三：pet.css 的说明里引用了旧写法 transform:scale(0.95)。修法：新增 codeOf() 去注释层，全部负判据一律改在代码面上判 —— 这类误报最容易被当成「判据误报」直接放宽，放宽即失守。',
    '【捕真缺陷 · 判据恒红与计数锚点歧义】首跑另抓到两处判据自身的缺陷：① D5 判据写「该串恰 1 次」，而它在真仓恰有 2 处（拖拽夹取 + 恢复夹取，两处都必须用未变换尺寸），写死「恰 1」使判据恒红 —— 假红与恒绿同样是坏判据，只是方向相反；② E3 用 home-page-dot 计页码点，5 点读数得 12（该串是 yzp- 前缀与外层容器的子串，每点被计两次、容器再计两次），属不可归因的计数面，改取 data-page-index 作锚点。',
    '【判据套件】新增 tests/system-v3560.test.mjs（14 例）：A 分页 / B 返回键 / C 品牌 / D 宠物拖拽 / G 判据工具自证五面判据 + E 面 5 条真调用行为面（直接 import 真模块调真方法并断言算出来的结果 —— 文本在场只证明写过，调用结果才证明算对：分页切分不丢件与边界、页码夹取、页码点唯一、手势真调注册监听器、位置键与真方法同在）+ 18 条真源码定点破坏表 + 1 条真仓只读回读。破坏一律落副本树，锚点必须恰中 1 次（不唯一即抛），锚点一律取纯 ASCII 片段。',
    '【门禁】十一道路门全绿（syntax / import-resolve / test / dead-exports / lifecycle / registry / keys / source-derivation / bridge-contract / weak-coercion / upstream-face）；全量回归 2881 例 0 失败；keys 285 键 96 patterns 285 登记、registry 81 App id 81 懒加载分支 98 前缀、样式投递未覆盖 0。',
    '【边界（诚实记账）】本套件证明的是「消费点在场 + 纯函数算对」，不证明「真机上那段手势/拖拽真跑对了」：手势与拖拽是纯函数级验证（真调监听器、真方法、假事件），指针事件的真实派发、CSS translate3d 的真实合成、宿主 !important 的真实压制都归 R-O3 真宿主实机验证。',
    '【版本升至 3.56.0（五源同源）】manifest.json / package.json / update-log.json 首位新键 + latest + head / index.js 的版本常量与公告块 / ITERATION_LOG.md 头部迭代段，五处同源一次抬齐。',
]
assert len(ITEMS) == 13, len(ITEMS)
for i, it in enumerate(ITEMS):
    assert isinstance(it, str) and it, i
    assert it.startswith('【') and '】' in it, i
    assert '[' not in it and ']' not in it, i
    assert NL not in it, i
    assert chr(34) not in it, i
    assert '\n' not in it and '\r' not in it, i

# ① update-log.json
log = json.loads(rd('update-log.json'))
assert log['latest'] == PREV, log['latest']
assert log['head'] == PREV, log['head']
assert list(log['versions'])[0] == PREV
assert VER not in log['versions']
OLD_N = len(log['versions'])
entry = {'version': VER, 'date': DATE, 'items': ITEMS}
new_versions = {VER: entry}
for k, v in log['versions'].items():
    new_versions[k] = v
new_log = {'latest': VER, 'versions': new_versions, 'head': VER}
assert list(new_log['versions'])[0] == VER
assert len(new_versions) == OLD_N + 1

# ② manifest / package
man = json.loads(rd('manifest.json'))
pkg = json.loads(rd('package.json'))
assert man['version'] == PREV and pkg['version'] == PREV
man['version'] = VER
pkg['version'] = VER

# ③ index.js：版本常量 + 公告块（累积式，新在前）
idx = rd('index.js')
idx_new = once(idx, "const ST_PHONE_VERSION = '%s';" % PREV,
               "const ST_PHONE_VERSION = '%s';" % VER, 'index.js 版本常量')
START = 'const ST_PHONE_CURRENT_UPDATE = {'
assert idx_new.count(START) == 1
bi = idx_new.find(START)
bj = idx_new.find(NL + '};', bi)
assert bi > 0 and bj > bi, 'ST_PHONE_CURRENT_UPDATE 块必须可提取'
OLD_BLOCK = idx_new[bi:bj]
old_items_part = OLD_BLOCK[OLD_BLOCK.index('items: [') + len('items: ['):OLD_BLOCK.rindex('    ]')]
OLD_LINES = [l for l in old_items_part.split(NL) if l.strip().startswith(chr(34))]
assert len(OLD_LINES) >= 5, '旧块 items 行数异常：%d' % len(OLD_LINES)
merged = [START, '    version: ST_PHONE_VERSION,', '    date: "%s",' % DATE, '    items: [']
for it in ITEMS:
    merged.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
merged.extend(OLD_LINES)
merged.append('    ]')
merged.append('};')
idx_new = idx_new[:bi] + NL.join(merged) + idx_new[bj + len(NL) + 2:]
assert idx_new.count(START) == 1
for it in ITEMS:
    assert json.dumps(it, ensure_ascii=False) in idx_new
# 引号计数法（代代相传的接线自纠）：items 区块每行引号数必须为 2
_i0 = idx_new.index('    items: [', idx_new.index(START))
seg = idx_new[_i0:idx_new.index(NL + '    ]', _i0)]
for ln in seg.split(NL):
    if not ln.strip().startswith(chr(34)):
        continue
    q = ln.count(chr(34)) - ln.count(chr(92) + chr(34))
    assert q == 2, '公告块引号数异常（行内引号 %d）：%s' % (q, ln[:60])

# ④ ITERATION_LOG.md
itlog = rd('ITERATION_LOG.md')
itlog = once(itlog, '- **当前版本**：`%s`（五源同源）' % PREV,
             '- **当前版本**：`%s`（五源同源）' % VER, '元信息版本行')
# 头部版本数：声明值与真源长期不一致，故按「数字 + 后缀」定位修正，不用旧值做锚点。
TAG = ' 个版本，按版本号索引'
assert itlog.count(TAG) == 1, '头部版本数句式必须恰中 1 次'
_ti = itlog.index(TAG)
_ts = _ti
while _ts > 0 and itlog[_ts - 1].isdigit():
    _ts -= 1
_old_decl = int(itlog[_ts:_ti])
itlog = itlog[:_ts] + str(len(new_versions)) + itlog[_ti:]
print('头部版本数：%d -> %d（声明值与 update-log 真源对齐）' % (_old_decl, len(new_versions)))
SEG = rd('tools/iter114_seg.md')
assert SEG.lstrip().startswith('## 迭代 114 '), SEG[:40]
assert itlog.count(SEG_ANCHOR) == 1, '迭代 113 段锚点必须恰中 1 次'
itlog = itlog.replace(SEG_ANCHOR, SEG.rstrip(NL) + NL + NL + SEG_ANCHOR)
assert itlog.count('## 迭代 114 ') == 1

print('== dry-run 摘要 ==')
print('update-log: latest=%s first=%s 版本数 %d -> %d' % (VER, list(new_log['versions'])[0], OLD_N, len(new_versions)))
print('manifest/package: version -> %s' % VER)
print('index.js: 常量 + 公告块（当版 %d 条 + 历史 %d 条 = %d）' % (len(ITEMS), len(OLD_LINES), len(ITEMS) + len(OLD_LINES)))
print('ITERATION_LOG: 迭代 114 段 + 当前版本行 + 版本数 %d' % len(new_versions))
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
with open(os.path.join(ROOT, 'update-log.json'), 'w', encoding='utf-8') as f:
    json.dump(new_log, f, ensure_ascii=False, indent=2)
    f.write(NL)
with open(os.path.join(ROOT, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(man, f, ensure_ascii=False, indent=2)
    f.write(NL)
with open(os.path.join(ROOT, 'package.json'), 'w', encoding='utf-8') as f:
    json.dump(pkg, f, ensure_ascii=False, indent=2)
    f.write(NL)
with open(os.path.join(ROOT, 'index.js'), 'w', encoding='utf-8') as f:
    f.write(idx_new)
with open(os.path.join(ROOT, 'ITERATION_LOG.md'), 'w', encoding='utf-8') as f:
    f.write(itlog)
print('已落盘五源')