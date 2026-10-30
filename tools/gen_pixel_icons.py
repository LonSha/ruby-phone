#!/usr/bin/env python3
"""生成 phone/icons/*.svg —— RubyPhone 像素图标集。

纪律（与 phone/pixel-engine.js 的 lintPixelSvg 机器判据同源）：
  · 24×24 视框，所有坐标/宽高/描边整数；
  · 只用 <rect>/<path>，禁 <circle> 与平滑曲线（圆用 rect 阶梯拼）；
  · shape-rendering="crispEdges"；填充色只取 16 色盘。

[v4.98.0 · R11-O8] 覆盖率从 8/89 提到 89/89。
  为什么不再「一个个手绘」：v4.92.0 只手绘了 8 个核心 + 文件夹，89 个 App 里 81 个
  落到 emoji/PNG 兜底 —— 桌面网格上像素方块与拟物球面混排，「统一像素」的声明
  当场自证为假。手工再画 81 个既贵又必然中途停下（那正是只做了 8 个的原因）。
  故改成**字形族 × 语义底色**的组合生成：
    · HG = 26 个语义字形族（文件 / 气泡 / 心 / 币 / 钟 / 地图 / 锁 …），
      每个只由 4~7 个 rect 组成，白描 + 黑轮廓，落在任意底色上都可读；
    · APP_GLYPHS = appId → 字形，按 App 的真实语义定（账本→清单、钱包→币、
      日历→格、天气→水滴…）；
    · 底色按语义手定（BG_OVERRIDE），同壳成员不撞色、跨壳可分辨。
  判据（tests/system-v4990.test.mjs）看守：覆盖率单调不减、目标 ≥50/89、
  每张 SVG 过 lintPixelSvg、且不许出现 emoji 冒充像素图。
"""
import os

PAL = {
    'black': '#1a1c2c', 'dkblue': '#333c57', 'blue': '#5d7fa6', 'ltblue': '#8fd3ff',
    'white': '#f4f4f4', 'cream': '#ffedd0', 'red': '#d93744', 'pink': '#f77b8f',
    'orange': '#f9a03f', 'yellow': '#f9e14e', 'green': '#3fae49', 'ltgreen': '#9de64e',
    'dkgreen': '#27613b', 'brown': '#8a5636', 'dkbrown': '#5a3d28', 'gray': '#7d8590'
}
K = PAL['black']
W = PAL['white']
C = PAL['cream']
Y = PAL['yellow']
R = PAL['red']
B = PAL['ltblue']
G = PAL['ltgreen']
O = PAL['orange']
P = PAL['pink']


def svg(body):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
            'shape-rendering="crispEdges">' + body + '</svg>')


def base(bg):
    return f'<rect x="1" y="1" width="22" height="22" fill="{bg}" stroke="{K}" stroke-width="2"/>'


def rect(x, y, w, h, f, stroke=None, sw=None):
    s = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{f}"'
    if stroke:
        s += f' stroke="{stroke}" stroke-width="{sw}"'
    return s + '/>'


# ── 26 个语义字形族（只用 16 色盘，坐标全整数） ──────────────────────────────
HG = {}

HG['doc'] = (rect(6, 3, 12, 18, W, K, 1) + rect(8, 6, 8, 2, K)
             + rect(8, 10, 8, 1, K) + rect(8, 13, 8, 1, K) + rect(8, 16, 5, 1, K))

HG['chat'] = (rect(4, 5, 16, 11, W, K, 1) + rect(8, 16, 4, 3, W, K, 1)
              + rect(7, 8, 2, 2, K) + rect(11, 8, 2, 2, K) + rect(15, 8, 2, 2, K))

HG['heart'] = (rect(5, 7, 4, 3, R) + rect(15, 7, 4, 3, R) + rect(4, 9, 16, 5, R)
               + rect(6, 14, 12, 3, R) + rect(8, 17, 8, 2, R) + rect(10, 19, 4, 2, R)
               + rect(7, 8, 2, 2, W))

HG['coin'] = (rect(6, 8, 12, 12, Y, K, 1) + rect(9, 11, 6, 6, K)
              + rect(11, 13, 2, 2, Y) + rect(8, 5, 8, 3, Y, K, 1))

HG['clock'] = (rect(6, 6, 12, 12, W, K, 1) + rect(8, 4, 8, 2, K)
               + rect(11, 8, 2, 5, K) + rect(12, 12, 4, 2, K))

HG['cal'] = (rect(3, 6, 18, 15, W, K, 1) + rect(3, 6, 18, 4, R)
             + rect(6, 12, 3, 3, K) + rect(11, 12, 3, 3, K) + rect(16, 12, 3, 3, K)
             + rect(6, 17, 3, 2, K) + rect(11, 17, 3, 2, K))

HG['camera'] = (rect(3, 8, 18, 12, W, K, 1) + rect(8, 5, 8, 3, K)
                + rect(9, 11, 6, 6, B, K, 1) + rect(11, 13, 2, 2, W))

HG['music'] = (rect(14, 4, 2, 11, W) + rect(9, 6, 7, 2, W)
               + rect(6, 13, 6, 6, W, K, 1) + rect(16, 13, 3, 3, W))

HG['play'] = (rect(6, 5, 3, 3, W) + rect(8, 7, 3, 3, W) + rect(10, 9, 3, 3, W)
              + rect(8, 12, 3, 3, W) + rect(6, 15, 3, 3, W) + rect(15, 5, 3, 3, K))

HG['chart'] = (rect(4, 18, 16, 2, K) + rect(6, 12, 3, 6, W)
               + rect(11, 8, 3, 10, Y) + rect(16, 5, 3, 13, G))

HG['grid'] = (rect(4, 4, 7, 7, W, K, 1) + rect(13, 4, 7, 7, Y, K, 1)
              + rect(4, 13, 7, 7, G, K, 1) + rect(13, 13, 7, 7, B, K, 1))

HG['person'] = (rect(9, 4, 6, 6, W, K, 1) + rect(6, 12, 12, 8, W, K, 1)
                + rect(10, 6, 2, 2, K) + rect(13, 6, 2, 2, K))

HG['drop'] = (rect(10, 4, 4, 2, B) + rect(8, 6, 8, 4, B)
              + rect(7, 10, 10, 5, B) + rect(8, 15, 8, 3, B) + rect(10, 18, 4, 2, B)
              + rect(9, 9, 2, 3, W))

HG['book'] = (rect(4, 4, 4, 16, C, K, 1) + rect(8, 5, 12, 14, W, K, 1)
              + rect(10, 8, 8, 1, K) + rect(10, 11, 8, 1, K) + rect(10, 14, 5, 1, K))

HG['map'] = (rect(3, 5, 18, 14, W, K, 1) + rect(8, 5, 1, 14, K)
             + rect(15, 5, 1, 14, K) + rect(5, 9, 2, 2, G) + rect(11, 13, 3, 3, R)
             + rect(17, 8, 2, 2, B))

HG['key'] = (rect(6, 7, 6, 6, Y, K, 1) + rect(8, 9, 2, 2, K)
             + rect(12, 10, 8, 2, Y) + rect(16, 12, 2, 3, Y) + rect(19, 12, 1, 2, Y))

HG['search'] = (rect(5, 5, 9, 9, W, K, 1) + rect(7, 7, 5, 5, K)
                + rect(13, 13, 3, 3, W, K, 1) + rect(16, 16, 4, 4, W, K, 1))

HG['bell'] = (rect(9, 4, 6, 2, Y) + rect(7, 6, 10, 9, Y, K, 1)
              + rect(5, 15, 14, 3, Y, K, 1) + rect(10, 19, 4, 2, K))

HG['lock'] = (rect(8, 4, 8, 3, W, K, 1) + rect(6, 9, 12, 10, W, K, 1)
              + rect(11, 12, 2, 4, K))

HG['cart'] = (rect(6, 8, 12, 12, O, K, 1) + rect(8, 5, 2, 4, W, K, 1)
              + rect(14, 5, 2, 4, W, K, 1) + rect(9, 12, 2, 5, K) + rect(14, 12, 2, 5, K))

HG['wave'] = (rect(6, 14, 3, 6, W) + rect(10, 11, 3, 9, W)
              + rect(14, 8, 3, 12, W) + rect(18, 4, 2, 16, W))

HG['gear'] = (rect(10, 3, 4, 4, W) + rect(10, 17, 4, 4, W) + rect(3, 10, 4, 4, W)
              + rect(17, 10, 4, 4, W) + rect(6, 6, 12, 12, W, K, 1) + rect(9, 9, 6, 6, K)
              + rect(11, 11, 2, 2, W))

HG['flame'] = (rect(11, 3, 3, 4, R) + rect(8, 7, 8, 5, R) + rect(6, 12, 12, 6, R)
               + rect(9, 18, 6, 3, Y) + rect(11, 13, 3, 5, Y))

HG['star'] = (rect(11, 3, 2, 4, Y) + rect(10, 7, 4, 3, Y) + rect(4, 9, 16, 3, Y)
              + rect(7, 12, 4, 4, Y) + rect(13, 12, 4, 4, Y) + rect(9, 16, 6, 4, Y))

HG['list'] = (rect(4, 6, 4, 3, W, K, 1) + rect(10, 6, 10, 3, W)
              + rect(4, 11, 4, 3, W, K, 1) + rect(10, 11, 10, 3, W)
              + rect(4, 16, 4, 3, W, K, 1) + rect(10, 16, 7, 3, W))

HG['bag'] = (rect(5, 8, 14, 12, Y, K, 1) + rect(9, 5, 6, 3, W, K, 1)
             + rect(8, 11, 2, 4, K) + rect(14, 11, 2, 4, K))

# ── appId → 字形（按真实语义） ──────────────────────────────────────────────
APP_GLYPHS = {
    'wechat': 'chat', 'weibo': 'wave', 'honey': 'heart', 'phone': 'chat',
    'wangxiang': 'bag', 'peek': 'person', 'cheat': 'key', 'dirtytalk': 'heart',
    'profile': 'person', 'chars': 'person', 'loverspace': 'flame', 'date': 'star',
    'avatarframe': 'star', 'shop': 'cart', 'taobao': 'cart', 'block': 'lock',
    'socialguard': 'lock', 'stickerdesk': 'grid', 'affairs': 'list', 'comms': 'chat',

    'xhs': 'doc', 'tieba': 'chat', 'bilibili': 'play', 'worldpulse': 'wave',
    'theater': 'play', 'mood': 'drop', 'tarot': 'star', 'reading': 'book',
    'gacha': 'star', 'lofter': 'doc', 'pixiv': 'camera', 'magazine': 'book',
    'soundkit': 'music', 'musicdesk': 'music', 'pvdesk': 'camera', 'doujin': 'book',
    'cardtable': 'grid', 'music': 'music', 'album': 'camera', 'games': 'play',

    'mofo': 'flame', 'diary': 'doc', 'memory': 'grid', 'graph': 'grid',
    'playbook': 'star', 'achievement': 'star', 'plotline': 'list', 'recall': 'chart',
    'sourcebook': 'book', 'archive': 'doc', 'cotdesk': 'list', 'memtable': 'grid',
    'lexiscore': 'chart', 'summdesk': 'doc', 'creationdesk': 'flame',

    'calendar': 'cal', 'timeweaver': 'clock', 'place': 'map', 'clock': 'clock',
    'focus': 'clock', 'punchcard': 'cal', 'weather': 'drop', 'kettle': 'drop',
    'needsim': 'chart', 'taskentry': 'list', 'workflow': 'grid',

    'wallet': 'coin', 'ledger': 'list', 'asset': 'bag', 'accounting': 'chart',
    'piggy': 'coin', 'traveldesk': 'map',

    'health': 'heart', 'diagnose': 'chart', 'diagdesk': 'chart', 'uterus': 'drop',
    'periodmath': 'cal', 'annidate': 'star', 'caphealth': 'heart',

    'settings': 'gear', 'search': 'search', 'notifications': 'bell', 'usage': 'chart',
    'regexfilter': 'lock', 'widget': 'grid', 'freehome': 'grid',
    'backupdesk': 'doc', 'sullydesk': 'gear', 'accessdesk': 'gear',
}

# ── 底色：同壳成员不撞色、跨壳可分辨（手定，非算法分配） ────────────────────
BG_OVERRIDE = {
    'wechat': PAL['green'], 'weibo': PAL['orange'], 'honey': PAL['pink'],
    'phone': PAL['dkgreen'], 'wangxiang': PAL['dkblue'], 'peek': PAL['gray'],
    'cheat': PAL['dkblue'], 'dirtytalk': PAL['pink'], 'profile': PAL['blue'],
    'chars': PAL['blue'], 'loverspace': PAL['red'], 'date': PAL['red'],
    'avatarframe': PAL['orange'], 'shop': PAL['brown'], 'taobao': PAL['orange'],
    'block': PAL['dkblue'], 'socialguard': PAL['dkgreen'], 'stickerdesk': PAL['yellow'],
    'affairs': PAL['blue'], 'comms': PAL['dkblue'],

    'xhs': PAL['red'], 'tieba': PAL['ltblue'], 'bilibili': PAL['pink'],
    'worldpulse': PAL['dkblue'], 'theater': PAL['brown'], 'mood': PAL['ltblue'],
    'tarot': PAL['dkblue'], 'reading': PAL['cream'], 'gacha': PAL['yellow'],
    'lofter': PAL['green'], 'pixiv': PAL['ltblue'], 'magazine': PAL['brown'],
    'soundkit': PAL['ltgreen'], 'musicdesk': PAL['dkblue'], 'pvdesk': PAL['pink'],
    'doujin': PAL['orange'], 'cardtable': PAL['red'], 'music': PAL['dkblue'],
    'album': PAL['ltblue'], 'games': PAL['pink'],

    'mofo': PAL['dkblue'], 'diary': PAL['yellow'], 'memory': PAL['blue'],
    'graph': PAL['dkblue'], 'playbook': PAL['pink'], 'achievement': PAL['yellow'],
    'plotline': PAL['green'], 'recall': PAL['orange'], 'sourcebook': PAL['cream'],
    'archive': PAL['gray'], 'cotdesk': PAL['blue'], 'memtable': PAL['dkblue'],
    'lexiscore': PAL['ltblue'], 'summdesk': PAL['cream'], 'creationdesk': PAL['pink'],

    'calendar': PAL['orange'], 'timeweaver': PAL['ltgreen'], 'place': PAL['green'],
    'clock': PAL['dkblue'], 'focus': PAL['red'], 'punchcard': PAL['orange'],
    'weather': PAL['ltblue'], 'kettle': PAL['cream'], 'needsim': PAL['blue'],
    'taskentry': PAL['green'], 'workflow': PAL['dkblue'],

    'wallet': PAL['yellow'], 'ledger': PAL['brown'], 'asset': PAL['ltgreen'],
    'accounting': PAL['green'], 'piggy': PAL['pink'], 'traveldesk': PAL['orange'],

    'health': PAL['red'], 'diagnose': PAL['blue'], 'diagdesk': PAL['dkblue'],
    'uterus': PAL['pink'], 'periodmath': PAL['orange'], 'annidate': PAL['yellow'],
    'caphealth': PAL['ltgreen'],

    'settings': PAL['gray'], 'search': PAL['blue'], 'notifications': PAL['orange'],
    'usage': PAL['dkblue'], 'regexfilter': PAL['gray'], 'widget': PAL['ltblue'],
    'freehome': PAL['ltgreen'], 'backupdesk': PAL['dkblue'], 'sullydesk': PAL['gray'],
    'accessdesk': PAL['blue'],
}

outdir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'phone', 'icons')
os.makedirs(outdir, exist_ok=True)

written = 0
for name in sorted(APP_GLYPHS):
    glyph = APP_GLYPHS[name]
    if glyph not in HG:
        raise SystemExit('unknown glyph %r for %r' % (glyph, name))
    bg = BG_OVERRIDE.get(name) or PAL['blue']
    body = base(bg) + HG[glyph]
    with open(os.path.join(outdir, name + '.svg'), 'w', encoding='utf-8') as f:
        f.write(svg(body))
    written += 1

folder_body = (base(PAL['blue'])
               + rect(3, 6, 7, 3, C, K, 1) + rect(3, 7, 18, 13, C, K, 1)
               + rect(7, 11, 3, 3, P) + rect(11, 11, 3, 3, O)
               + rect(7, 15, 3, 3, G) + rect(11, 15, 3, 3, B))
with open(os.path.join(outdir, 'folder.svg'), 'w', encoding='utf-8') as f:
    f.write(svg(folder_body))

# ── 生成清单（注册表真源）：config/app-icons.js 只转写本清单，不手写 id 表。 ──
# ★ id → 磁盘文件名。**不能**假设「id == 文件名」：文件夹图标有历史包袱
#   （id 是 `__folder`，文件是 `folder.svg`，v4.92.0 起既有消费点），
#   而按 id 直接拼 URL 会让 `__folder` 指向一个**不存在**的 `__folder.svg`。
#   故清单写成 id → file 的映射，URL 由映射派生，跑一次生成器就自洽。
icon_files = {name: name for name in sorted(APP_GLYPHS)}
icon_files['__folder'] = 'folder'
ids = list(icon_files)
lines = []
lines.append('/* 自动生成 —— 不要手改。源：tools/gen_pixel_icons.py')
lines.append(' *')
lines.append(' * 为什么清单要由生成器写出、而不是在 config/app-icons.js 里手写一张表：')
lines.append(' *   ① 清单落 config/（注册表层），SVG 落 phone/icons/（图资产层）——')
lines.append(' *      config+apps 两棵浅镜像即自足是本仓既有不变量（system-v300 F0 镜像自证）；')
lines.append(' *   ② 手写表与磁盘必然漂移，而漂移是**静默**的（症状只是「那张图不是像素风」，')
lines.append(' *      没有任何报错）。清单与 SVG 由同一次生成产出，两者不可能对不上；')
lines.append(' *   tests/system-v4990.test.mjs 再对「清单 == 磁盘 .svg 文件名集合」做双向断言，')
lines.append(' *   于是「跑了生成器但没登记」与「登记了但图不在」两种漂移都当场转红。')
lines.append(' */')
lines.append('export const PIXEL_ICON_FILES = Object.freeze({')
lines.append('    // id -> 磁盘 .svg 基名（不带扩展名）。URL 一律由本映射派生，')
lines.append('    // 手写第二份必然与磁盘漂移。')
for i in ids:
    lines.append("    '%s': '%s'," % (i, icon_files[i]))
lines.append('});')
lines.append('export const PIXEL_ICON_IDS = Object.freeze(Object.keys(PIXEL_ICON_FILES));')
# ★ 清单落在 **config/**（注册表层），不落在 phone/icons/（图资产层）：
#   config/ 在本仓有一条既有不变量 —— 「config + apps 两棵浅镜像即自足」
#   （tests/system-v300 的 F0 镜像自证守着它）。把清单放进 phone/ 会让任何
#   只镜像 config+apps 的负控制树 import 不到清单，红的是镜像树自足性，不是被测行为。
#   归属也本该如此：清单是**注册表数据**，SVG 才是图资产。
manifest_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'config', 'pixel-icons.generated.js')
with open(manifest_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')

print('written %d app icons + folder.svg + manifest(%d ids) -> %s'
      % (written, len(ids), outdir))