#!/usr/bin/env python3
"""tools/gen-inline-map-v35.py — RubyPhone v3.5 逐站点内联样式映射生成器（只用标准库）

v3.5：在 v3.4 的 12 个 App 之外，加入 70 个本轮改成手写皮肤的 App（APPS 表后半段）；规范化、令牌与组件识别器与 v3.4 逐字相同，
      所以 v3.4 那 12 个 App 的表项与 v3.4 版完全一致（见 verification/inline-map-v35-diff.txt）。输出文件名改成 rp-inline-map-v3.5.js。

用法：python3 tools/gen-inline-map-v34.py <ruby-phone 仓库根> <输出目录>
输出：
  <out>/phone/ui/rp-inline-map-v3.5.js        运行时读的映射表（ESM）
  <out>/verification/inline-map-sites.tsv      每一处 style="..." 的去向（命中 / 只布局 / 动态跳过）
  <out>/verification/inline-map-palette.tsv    每个 App 的「字面量颜色 -> 令牌」表（人工复核用）

做法（与 phone/ui/rp-skin-runtime.js 的 normStyle() 完全一致的规范化）：
  1. 在 12 个 App 的 JS 源码里找出全部 style="..." / style='...'（含模板字符串、JS 字符串拼接）；
  2. 拆成声明，规范化（小写属性、折叠空白、hex 小写、括号与逗号两侧去空格、重复属性取最后一个）；
     模板变量 ${...} 与字符串拼接 ' + x + ' 记为「动态」：匹配时任意值都算，且这条声明永远不删；
  3. 每条装饰声明按该 App 的调色板翻译成语义令牌（data-rp34），再用组件识别器（表单 / 分组 / 按钮 / 胶囊）整体改写；
  4. 键 = 排序后的属性名集合；值 = 每个属性的静态取值（动态为 *）。运行时按原始 style 文本精确匹配，不靠猜。
"""
import colorsys
import json
import os
import re
import sys
from collections import Counter, OrderedDict

APPS = OrderedDict([
    ('wechat',     {'src': ['apps/wechat'],     'accent': 145, 'link': '#576b95'}),
    ('honey',      {'src': ['apps/honey'],      'accent': 343, 'native': 'dark'}),
    ('reading',    {'src': ['apps/reading'],    'accent': 28, 'colors': False}),   # 阅读主题（羊皮纸 / 夜间 / 墨）的颜色是用户选的，不换
    ('settings',   {'src': ['apps/settings'],   'accent': 211}),
    ('diary',      {'src': ['apps/diary'],      'accent': 30}),
    ('mofo',       {'src': ['apps/mofo'],       'accent': 217}),
    ('wangxiang',  {'src': ['apps/wangxiang'],  'accent': 200, 'native': 'dark'}),
    ('timeweaver', {'src': ['apps/timeweaver'], 'accent': 36, 'native': 'dark'}),
    ('memory',     {'src': ['apps/memory/memory-view.js', 'apps/memory/memory-app.js', 'apps/memory/memory-insights.js'], 'accent': 239}),
    ('graph',      {'src': ['apps/memory/graph-view.js', 'apps/memory/graph-app.js', 'apps/memory/graph-bridge.js'], 'accent': 258}),
    ('games',      {'src': ['apps/games'],      'accent': 211}),
    ('cardtable',  {'src': ['apps/cardtable'],  'accent': 276}),
    # ---- v3.5：70 个由 v3.3 自动生成皮肤的 App（这一轮改成手写皮肤）。accent = 该 App 强调色的色相（度），native = 原生配色 ----
    ('accessdesk', {'src': ['apps/accessdesk'], 'accent': 211}),
    ('accounting', {'src': ['apps/accounting'], 'accent': 177}),
    ('achievement', {'src': ['apps/achievement'], 'accent': 36, 'native': 'dark'}),
    ('affairs', {'src': ['apps/affairs'], 'accent': 211}),
    ('annidate', {'src': ['apps/annidate'], 'accent': 211}),
    ('archive', {'src': ['apps/archive'], 'accent': 199}),
    ('asset', {'src': ['apps/asset'], 'accent': 177}),
    ('avatarframe', {'src': ['apps/avatarframe'], 'accent': 189}),
    ('backupdesk', {'src': ['apps/backupdesk'], 'accent': 211}),
    ('bilibili', {'src': ['apps/bilibili'], 'accent': 340, 'native': 'dark'}),
    ('block', {'src': ['apps/block'], 'accent': 3}),
    ('caphealth', {'src': ['apps/caphealth'], 'accent': 211}),
    ('chars', {'src': ['apps/chars'], 'accent': 189, 'native': 'dark'}),
    ('cheat', {'src': ['apps/cheat'], 'accent': 36}),
    ('clock', {'src': ['apps/clock'], 'accent': 36}),
    ('comms', {'src': ['apps/comms'], 'accent': 189, 'native': 'dark'}),
    ('cotdesk', {'src': ['apps/cotdesk'], 'accent': 211}),
    ('creationdesk', {'src': ['apps/creationdesk'], 'accent': 211}),
    ('date', {'src': ['apps/date'], 'accent': 3}),
    ('diagdesk', {'src': ['apps/diagdesk'], 'accent': 36}),
    ('diagnose', {'src': ['apps/diagnose'], 'accent': 189}),
    ('dirtytalk', {'src': ['apps/dirtytalk'], 'accent': 280}),
    ('doujin', {'src': ['apps/doujin'], 'accent': 18, 'native': 'dark'}),
    ('focus', {'src': ['apps/focus'], 'accent': 199}),
    ('freehome', {'src': ['apps/freehome'], 'accent': 135}),
    ('gacha', {'src': ['apps/gacha'], 'accent': 36}),
    ('health', {'src': ['apps/health'], 'accent': 349, 'native': 'dark'}),
    ('kettle', {'src': ['apps/kettle'], 'accent': 36}),
    ('ledger', {'src': ['apps/ledger'], 'accent': 280}),
    ('lexiscore', {'src': ['apps/lexiscore'], 'accent': 30}),
    ('lofter', {'src': ['apps/lofter'], 'accent': 174}),
    ('loverspace', {'src': ['apps/loverspace'], 'accent': 349}),
    ('magazine', {'src': ['apps/magazine'], 'accent': 36}),
    ('memtable', {'src': ['apps/memtable'], 'accent': 280}),
    ('mood', {'src': ['apps/mood'], 'accent': 239, 'native': 'dark'}),
    ('musicdesk', {'src': ['apps/musicdesk'], 'accent': 36}),
    ('needsim', {'src': ['apps/needsim'], 'accent': 135}),
    ('peek', {'src': ['apps/peek'], 'accent': 36}),
    ('periodmath', {'src': ['apps/periodmath'], 'accent': 349}),
    ('piggy', {'src': ['apps/piggy'], 'accent': 36}),
    ('pixiv', {'src': ['apps/pixiv'], 'accent': 204}),
    ('place', {'src': ['apps/place'], 'accent': 177, 'native': 'dark'}),
    ('playbook', {'src': ['apps/playbook'], 'accent': 280, 'native': 'dark'}),
    ('plotline', {'src': ['apps/plotline'], 'accent': 36, 'native': 'dark'}),
    ('profile', {'src': ['apps/profile'], 'accent': 211, 'native': 'dark'}),
    ('punchcard', {'src': ['apps/punchcard'], 'accent': 189}),
    ('pvdesk', {'src': ['apps/pvdesk'], 'accent': 199}),
    ('recall', {'src': ['apps/recall'], 'accent': 199}),
    ('regexfilter', {'src': ['apps/regexfilter'], 'accent': 239}),
    ('shop', {'src': ['apps/shop'], 'accent': 36}),
    ('socialguard', {'src': ['apps/socialguard'], 'accent': 239}),
    ('soundkit', {'src': ['apps/soundkit'], 'accent': 177}),
    ('sourcebook', {'src': ['apps/sourcebook'], 'accent': 36}),
    ('stickerdesk', {'src': ['apps/stickerdesk'], 'accent': 189}),
    ('sullydesk', {'src': ['apps/sullydesk'], 'accent': 211}),
    ('summdesk', {'src': ['apps/summdesk'], 'accent': 30}),
    ('taobao', {'src': ['apps/taobao'], 'accent': 19}),
    ('tarot', {'src': ['apps/tarot'], 'accent': 239}),
    ('taskentry', {'src': ['apps/taskentry'], 'accent': 211}),
    ('theater', {'src': ['apps/theater'], 'accent': 280}),
    ('tieba', {'src': ['apps/tieba'], 'accent': 218, 'native': 'dark'}),
    ('traveldesk', {'src': ['apps/traveldesk'], 'accent': 189}),
    ('usage', {'src': ['apps/usage'], 'accent': 349}),
    ('uterus', {'src': ['apps/uterus'], 'accent': 3}),
    ('wallet', {'src': ['apps/wallet'], 'accent': 36, 'native': 'dark'}),
    ('weather', {'src': ['apps/weather'], 'accent': 211, 'native': 'dark'}),
    ('widget', {'src': ['apps/widget'], 'accent': 239}),
    ('workflow', {'src': ['apps/workflow'], 'accent': 211}),
    ('worldpulse', {'src': ['apps/worldpulse'], 'accent': 199, 'native': 'dark'}),
    ('xhs', {'src': ['apps/xhs'], 'accent': 352, 'native': 'dark'}),
])
DYN = '\u0001'
RE_ATTR = re.compile(r'''style\s*=\s*(\\?["'])((?:(?!\1).){1,1200}?)\1''', re.S)
DECOR = re.compile(r'^(color|background|background-color|background-image|border|border-(?:top|bottom|left|right)|border-(?:top|bottom|left|right)-color|border-color|border-radius|box-shadow|text-shadow|font-size|font-weight|font-family|-webkit-backdrop-filter|backdrop-filter)$')
NAMED = {'white': (255, 255, 255, 1), 'black': (0, 0, 0, 1), 'red': (255, 0, 0, 1), 'gray': (128, 128, 128, 1), 'grey': (128, 128, 128, 1),
         'orange': (255, 165, 0, 1), 'gold': (255, 215, 0, 1), 'green': (0, 128, 0, 1), 'blue': (0, 0, 255, 1), 'pink': (255, 192, 203, 1),
         'transparent': (0, 0, 0, 0)}
RE_COLOR = re.compile(r'#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|red|gray|grey|orange|gold|green|blue|pink|transparent)\b')


def files_of(root, spec):
    out = []
    for s in spec:
        p = os.path.join(root, s)
        if os.path.isfile(p):
            out.append(p)
        else:
            for r, _ds, fs in os.walk(p):
                for f in sorted(fs):
                    if f.endswith('.js'):
                        out.append(os.path.join(r, f))
    return sorted(out)


# ---------- 规范化（与运行时 normStyle 同一套规则） ----------
def split_decls(text):
    out, cur, depth, quote = [], '', 0, ''
    for ch in text:
        if quote:
            cur += ch
            if ch == quote:
                quote = ''
            continue
        if ch in '"\'':
            quote = ch
        elif ch == '(':
            depth += 1
        elif ch == ')':
            depth = max(0, depth - 1)
        if ch == ';' and depth == 0:
            out.append(cur)
            cur = ''
        else:
            cur += ch
    out.append(cur)
    return [d for d in (x.strip() for x in out) if d]


def norm_value(v):
    v = re.sub(r'\s+', ' ', v.strip())
    v = re.sub(r'#([0-9a-fA-F]{3,8})\b', lambda m: '#' + m.group(1).lower(), v)
    v = re.sub(r'\s*,\s*', ',', v)
    v = re.sub(r'\(\s+', '(', v)
    v = re.sub(r'\s+\)', ')', v)
    return v


def parse_style(raw):
    """-> OrderedDict prop -> (value, important, dynamic)；无法解析（属性名是动态的）返回 None"""
    res = OrderedDict()
    for d in split_decls(raw):
        if ':' not in d:
            if DYN in d:
                return None
            continue
        p, v = d.split(':', 1)
        p = p.strip().lower()
        if not re.match(r'^-?[a-z][a-z0-9-]*$', p):
            return None
        v = norm_value(v)
        imp = bool(re.search(r'!\s*important\s*$', v, re.I))
        if imp:
            v = re.sub(r'\s*!\s*important\s*$', '', v, flags=re.I)
        dyn = DYN in v
        res.pop(p, None)
        res[p] = (v, imp, dyn)
    return res


def prep_raw(raw):
    raw = raw.replace('\\n', ' ').replace('\\t', ' ').replace('\\"', '"').replace("\\'", "'")
    raw = re.sub(r'\$\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}', DYN, raw)
    raw = re.sub(r"'\s*\+\s*[^']*?\s*\+\s*'", DYN, raw)
    raw = re.sub(r'"\s*\+\s*[^"]*?\s*\+\s*"', DYN, raw)
    return raw


# ---------- 颜色 ----------
def parse_color(s):
    s = s.strip().lower()
    if s in NAMED:
        return NAMED[s]
    if s.startswith('#'):
        h = s[1:]
        if len(h) in (3, 4):
            h = ''.join(c * 2 for c in h)
        if len(h) not in (6, 8):
            return None
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return (r, g, b, a)
    m = re.match(r'rgba?\(([^)]*)\)', s)
    if m:
        parts = [x for x in re.split(r'[\s,/]+', m.group(1)) if x]
        try:
            nums = [float(x.rstrip('%')) * (2.55 if x.endswith('%') else 1) for x in parts[:3]]
            a = float(parts[3].rstrip('%')) / (100 if parts[3].endswith('%') else 1) if len(parts) > 3 else 1.0
            return (nums[0], nums[1], nums[2], a)
        except (ValueError, IndexError):
            return None
    return None


def hls(c):
    h, l, s = colorsys.rgb_to_hls(c[0] / 255, c[1] / 255, c[2] / 255)
    return h * 360, l, s


def lum(c):
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255


def is_gray(c):
    return max(c[:3]) - min(c[:3]) < 30


def hue_bucket(h, accent):
    if accent is not None and min(abs(h - accent), 360 - abs(h - accent)) <= 18:
        return 'a'
    if h < 12 or h >= 345:
        return 'r'
    if h < 40:
        return 'o'
    if h < 66:
        return 'y'
    if h < 170:
        return 'g'
    if h < 255:
        return 'b'
    return 'p'


def fg_token(c, cfg):
    if c[3] == 0:
        return None
    dark = cfg.get('native') == 'dark'
    h, l, s = hls(c)
    y = lum(c)
    if dark and (is_gray(c) or s < 0.45 or l > 0.8):
        # 原生深色 App：浅字 = 主文字，中灰 = 次级（换成系统语义色后浅 / 深都成立，底色同理反着映射）
        if c[3] < 0.95 and min(c[:3]) > 200:
            return 'c2' if c[3] >= 0.55 else 'c3'
        return 'c1' if y > 0.8 else 'c2' if y > 0.5 else 'c3'
    if min(c[:3]) > 232:
        return 'cw' if c[3] > 0.85 else 'cw2'
    if max(c[:3]) < 50 and c[3] < 0.95:
        return 'c1' if c[3] >= 0.7 else 'c2' if c[3] >= 0.4 else 'c3'
    if cfg.get('link') and parse_color(cfg['link'])[:3] == tuple(c[:3]):
        return 'cl'
    if is_gray(c) or s < 0.2 or (s < 0.45 and y < 0.5):
        # 灰与「石板蓝」类深色正文（#2f4463 / #5f769a）都按亮度归到 label 一族
        return 'c1' if y < 0.3 else 'c2' if y < 0.72 else 'c3' if y < 0.86 else 'cw2'
    if l > 0.85:
        return 'cw2'           # 很浅的彩色字只会出现在深底 / 彩底上
    return {'a': 'ca', 'r': 'cr', 'o': 'co', 'y': 'cy', 'g': 'cg', 'b': 'cb', 'p': 'cp'}[hue_bucket(h, cfg.get('accent'))]


def bg_token(c, cfg, clickable):
    if c[3] == 0:
        return None
    dark = cfg.get('native') == 'dark'
    if min(c[:3]) > 240:
        if c[3] >= 0.85:
            return 'b0' if min(c[:3]) >= 254 and not clickable else 'bf'
        if c[3] < 0.3:
            return 'bq'        # 深底上的 6%~25% 白 = 极淡填充，不是浅玻璃
        return 'bgl'
    if max(c[:3]) < 60 and c[3] < 0.95:
        if dark and c[3] < 0.8:
            return 'bq' if c[3] <= 0.3 else 'bsc'
        return 'bq' if c[3] <= 0.12 else 'bsc'
    if tuple(int(x) for x in c[:3]) == (0x95, 0xec, 0x69):
        return 'bme'
    h, l, s = hls(c)
    y = lum(c)
    if dark and y < 0.3:
        return 'b0' if c[3] >= 0.9 else 'bf'      # 原生深色 App 的深色面 = 表面（浅色下变白卡，深色下 #1c1c1e）
    if is_gray(c) or s < 0.12:
        if y < 0.22:
            return 'bd'
        if clickable:
            return 'bf'
        return 'b1' if 0.9 <= y < 0.955 else 'bf'
    k = hue_bucket(h, cfg.get('accent'))
    if l > 0.78 or c[3] < 0.5:
        return {'a': 'bas', 'r': 'brs', 'o': 'bos', 'y': 'bys', 'g': 'bgs', 'b': 'bbs', 'p': 'bps'}[k]
    if l < 0.2:
        return {'a': 'bas', 'r': 'brs', 'o': 'bos', 'y': 'bys', 'g': 'bgs', 'b': 'bbs', 'p': 'bps'}[k]   # 很深的彩底 = 该色相的浅底
    return {'a': 'ba', 'r': 'br', 'o': 'bo', 'y': 'bys', 'g': 'bg', 'b': 'bb', 'p': 'bp'}[k]


def border_color_kind(c, cfg):
    if c is None:
        return 'kc'
    if c[3] == 0:
        return 'k0'
    if min(c[:3]) > 232 and c[3] < 0.95:
        return 'sep' if cfg.get('native') == 'dark' else 'km'
    if is_gray(c) or max(c[:3]) < 60:
        return 'sep'
    h, _l, _s = hls(c)
    k = hue_bucket(h, cfg.get('accent'))
    return 'ka' if k == 'a' else 'kred' if k == 'r' else 'kc'


SIDE = {'border': 'k', 'border-top': 'kt', 'border-bottom': 'kb', 'border-left': 'kl', 'border-right': 'kr'}


def map_border(prop, v, cfg):
    """-> (tokens, add_decls) ；None 表示不处理（留在内联）"""
    if v in ('none', '0', '0px', 'transparent'):
        return (['k0'], [])
    cols = RE_COLOR.findall(v)
    c = parse_color(cols[-1]) if cols else None
    wm = re.search(r'(\d*\.?\d+)px', v)
    width = float(wm.group(1)) if wm else 1.0
    style = (re.search(r'\b(solid|dashed|dotted|double)\b', v) or [None, 'solid'])[1] if re.search(r'\b(solid|dashed|dotted|double)\b', v) else 'solid'
    kind = border_color_kind(c, cfg)
    if kind == 'k0':
        return (['k0'], [])
    if kind == 'sep' and width <= 1 and style == 'solid':
        return ([SIDE[prop]], [])
    token = 'kc' if kind == 'sep' else kind
    side = '' if prop == 'border' else prop[len('border'):]
    return ([token], [('border' + side + '-width', ('%gpx' % width)), ('border' + side + '-style', style)])


def radius_token(v):
    if v.endswith('%'):
        return 'rp' if float(v[:-1] or 0) >= 50 else None
    m = re.fullmatch(r'(\d*\.?\d+)(px)?', v)
    if not m:
        return None
    x = float(m.group(1))
    return 'r0' if x == 0 else 'r8' if x <= 9 else 'r12' if x <= 13 else 'r16' if x <= 18 else 'r22' if x <= 26 else 'rp' if x >= 99 else 'r22'


def size_token(v):
    m = re.fullmatch(r'(\d*\.?\d+)px', v)
    if not m:
        return None
    x = float(m.group(1))
    if x > 34:
        return None            # 36px 以上多是图标 / 表情位，留在内联
    return ('t11' if x <= 11.5 else 't12' if x <= 12.5 else 't13' if x <= 13.5 else 't15' if x <= 15.5 else 't16' if x <= 16.5 else
            't17' if x <= 18.5 else 't20' if x <= 21 else 't22' if x <= 25 else 't28' if x <= 31 else 't34')


def weight_token(v):
    v = v.lower()
    if v in ('normal', '400', '300'):
        return 'w4'
    if v == '500':
        return 'w5'
    if v == '600':
        return 'w6'
    if v in ('700', 'bold'):
        return 'w7'
    if v in ('800', '900', 'bolder'):
        return 'w8'
    return None


def first_color(v):
    for c in RE_COLOR.findall(v):
        pc = parse_color(c)
        if pc and pc[3] > 0:
            return pc
    return None


def classify(decls, ctx_tag, ctx_cls, cfg):
    """-> (tokens[], strip[], add[[p,v]]) —— 只碰静态装饰声明"""
    toks, strip, add = [], [], []
    clickable = ctx_tag in ('button', 'a', 'label', 'summary') or 'cursor' in decls or re.search(r'btn|button', ctx_cls or '')
    has_blur = any(p in decls and 'blur' in decls[p][0] for p in ('backdrop-filter', '-webkit-backdrop-filter'))
    for p, (v, imp, dyn) in decls.items():
        if imp or dyn or not DECOR.match(p) or 'url(' in v or 'var(' in v:
            continue
        if cfg.get('colors') is False and (p == 'color' or p.startswith('background') or p.startswith('border') or p.endswith('shadow')):
            continue
        t = None
        if p == 'color':
            pc = parse_color(v)
            t = fg_token(pc, cfg) if pc else None
            t = [t] if t else None
        elif p in ('background', 'background-color', 'background-image'):
            if p == 'background-image' and 'gradient' not in v:
                continue
            if v in ('none', 'transparent'):
                continue
            pc = first_color(v)
            t = bg_token(pc, cfg, clickable) if pc else None
            t = [t] if t else None
        elif p in SIDE:
            r = map_border(p, v, cfg)
            if r:
                t, a2 = r
                add += [list(x) for x in a2]
        elif p.endswith('-color') and p.startswith('border'):
            kind = border_color_kind(parse_color(v), cfg)
            t = ['kc' if kind == 'sep' else kind]
        elif p == 'border-radius':
            rt = radius_token(v)
            t = [rt] if rt else None
        elif p == 'box-shadow':
            cols = [parse_color(c) for c in RE_COLOR.findall(v)]
            glow = any(c and not (max(c[:3]) < 60) for c in cols)
            t = ['s0'] if (v == 'none' or glow or not cols) else ['s1' if 'b0' in toks else 's0']
        elif p == 'text-shadow':
            t = ['ts0']
        elif p == 'font-size':
            st = size_token(v)
            t = [st] if st else None
        elif p == 'font-weight':
            wt = weight_token(v)
            t = [wt] if wt else None
        elif p == 'font-family':
            if re.search(r'mono|courier|consolas|menlo', v, re.I):
                t = ['fm']
            elif re.search(r'apple-system|pingfang|helvetica|sans-serif|inherit|system-ui', v, re.I) and not re.search(r'serif\b(?<!sans-serif)|kai|song', v, re.I):
                t = []
        elif p in ('backdrop-filter', '-webkit-backdrop-filter'):
            t = ['gl'] if 'blur' in v else None
        if t is None:
            continue
        toks += t
        strip.append(p)
    toks = list(OrderedDict.fromkeys(x for x in toks if x))
    # 彩底上的白字永远是 cw（原生深色 App 的「浅字 = 主文字」规则不适用于彩色按钮 / 气泡）
    if 'color' in decls and any(x in toks for x in ('ba', 'br', 'bo', 'bg', 'bb', 'bp', 'brp', 'bme', 'bd')):
        pc = parse_color(decls['color'][0])
        if pc and min(pc[:3]) > 232:
            toks = ['cw' if x in ('c1', 'c2', 'c3') else x for x in toks]
    # ---------- 组件识别器（同一套内联写法反复出现的表单 / 分组 / 按钮） ----------
    bgt = next((x for x in toks if x.startswith('b') and x not in ('bq',)), None)
    has_border = any(x in toks for x in ('k', 'kt', 'kb', 'kc'))
    small = lambda prop, lim: prop in decls and not decls[prop][2] and re.fullmatch(r'(\d+)px', decls[prop][0]) and int(decls[prop][0][:-2]) <= lim
    comp = None
    if ctx_tag in ('input', 'select', 'textarea') and (has_border or bgt in ('b0', 'bf', 'b1')) and not re.search(r'checkbox|radio|range|color|file', ctx_cls or ''):
        comp = 'sel' if ctx_tag == 'select' else 'fld'
        if small('height', 34) and ctx_tag != 'textarea':
            strip.append('height')
    elif ctx_tag == 'details' and (has_border or bgt == 'b0'):
        comp = 'grp'
    elif ctx_tag == 'summary':
        comp = 'grph'
        if small('height', 42):
            strip.append('height')
    elif (ctx_tag == 'button' or re.search(r'(^|\.)[\w-]*(btn|button)\b', ctx_cls or '')
          or (ctx_tag == 'label' and bgt and any(x in toks for x in ('k', 'kc')))):
        # 按钮：<button> / 带 btn 类名；<label> 只有「有底色 + 四边框」时才算按钮（列表行 label 只有单边分隔线）
        rowlike = any(x in toks for x in ('kt', 'kb')) and not any(x in toks for x in ('r8', 'r12', 'r16', 'r22', 'rp'))
        if rowlike:
            comp = None        # 动作表 / 列表里的整行按钮：保持行的样子，只换颜色与字号令牌
        elif bgt in ('ba', 'bg', 'bb') and ('cw' in toks or 'color' not in decls):
            comp = 'btnp'
        elif 'cr' in toks and bgt in (None, 'b0', 'bf', 'brs', 'bgl', 'b1'):
            comp = 'btnd'
        elif (bgt in ('b0', 'bf', 'b1', 'bgl', 'bas', 'bbs', 'bgs', 'bps', 'bos', 'bys') or (bgt is None and any(x in toks for x in ('k', 'kc')))) \
                and not any(x in toks for x in ('kt', 'kb', 'r0')) and (any(x in toks for x in ('r8', 'r12', 'r16', 'r22', 'rp', 'k', 'kc'))):
            # 次级胶囊钮：要有圆角或四边框；整行宽、只有上 / 下分隔线的是动作表的行，不改成胶囊
            comp = 'btn2'
        if comp and small('height', 32):
            strip.append('height')
    if comp:
        keep = [x for x in toks if re.fullmatch(r't\d+|w\d|fm', x)] if comp in ('btn2', 'btnp', 'btnd', 'fld', 'sel') else [x for x in toks if re.fullmatch(r'w\d', x)]
        if comp in ('btn2', 'btnp', 'btnd'):
            keep = [x for x in keep if not re.fullmatch(r't(11|12|13)', x)]    # 胶囊钮统一 15pt
        toks = [comp] + keep
    return toks, list(OrderedDict.fromkeys(strip)), add


def fnv(sv):
    """FNV-1a 32 位，按 UTF-16 码元（与运行时 String.charCodeAt 一致），输出 36 进制"""
    h = 0x811c9dc5
    data = sv.encode('utf-16-le')
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xffffffff
    n, out = h, ''
    while True:
        n, r = divmod(n, 36)
        out = '0123456789abcdefghijklmnopqrstuvwxyz'[r] + out
        if not n:
            return out


def context_of(text, pos):
    st = text.rfind('<', max(0, pos - 2000), pos)
    tagtxt = text[st:pos] if st >= 0 else ''
    tg = re.match(r'<([a-zA-Z][a-zA-Z0-9-]*)', tagtxt)
    cm = re.search(r'class\s*=\s*\\?["\']([^"\']*)', tagtxt)
    cls = '.'.join(re.sub(r'\$\{[^}]*\}', '', cm.group(1)).split()) if cm else ''
    return (tg.group(1).lower() if tg else ''), cls


# v3.5：逐站点排除（生成器的判定在这两处会出错；排除后运行时走 v3.3 的通用降级，原值变成低优先级规则，由皮肤决定）
SITE_DENY = {
    ('apps/magazine/magazine-view.js', 167): 'background 是 cover.typeColor 数据色（表达式里带引号的 \'#888\' 让动态检测失手），不能换成表面色',
    ('apps/tarot/tarot-view.js', 147): 'color:#94a3b8 是次级文字，调色板按色相把它判成蓝色；tarot.v3.css 用 .tarot-history-item > div 设次级文字色',
}


def build(root):
    maps, sites, palette = OrderedDict(), [], []
    for app, cfg in APPS.items():
        index = OrderedDict()
        pal = Counter()
        for f in files_of(root, cfg['src']):
            text = open(f, encoding='utf-8', errors='replace').read()
            rel = os.path.relpath(f, root).replace(os.sep, '/')
            for m in RE_ATTR.finditer(text):
                raw = prep_raw(m.group(2))
                line = text.count('\n', 0, m.start()) + 1
                tag, cls = context_of(text, m.start())
                decls = parse_style(raw)
                if decls is None or not decls:
                    sites.append((app, rel, line, tag, cls, 'dynamic-skip', '', ''))
                    continue
                for p, (v, _i, dyn) in decls.items():
                    if DECOR.match(p) and not dyn:
                        for c in RE_COLOR.findall(v):
                            pal[(p if p == 'color' else 'background' if p.startswith('background') else 'border' if p.startswith('border') else p, c)] += 1
                if (rel, line) in SITE_DENY:
                    sites.append((app, rel, line, tag, cls, 'denied', '', SITE_DENY[(rel, line)]))
                    continue
                toks, strip, add = classify(decls, tag, cls, cfg)
                if not toks:
                    sites.append((app, rel, line, tag, cls, 'layout-only', '', ''))
                    continue
                props = sorted(decls)
                key = ','.join(props)
                vals = [('*' if decls[p][2] else decls[p][0] + (' !important' if decls[p][1] else '')) for p in props]
                mask = ''.join('1' if v == '*' else '0' for v in vals)
                sig = fnv('\u001f'.join(v for v in vals if v != '*'))
                entry = [mask, sig, ' '.join(toks), strip, add or 0, tag or '']
                bucket = index.setdefault(key, [])
                if entry not in bucket:
                    # 同一属性集合里，静态值更多（更具体）的排前面
                    bucket.append(entry)
                    bucket.sort(key=lambda e: e[0].count('1'))
                sites.append((app, rel, line, tag, cls, 'mapped', ' '.join(toks), ','.join(strip)))
        maps[app] = index
        for (p, c), n in pal.most_common():
            pc = parse_color(c)
            tok = (fg_token(pc, cfg) if p == 'color' else bg_token(pc, cfg, False) if p == 'background' else border_color_kind(pc, cfg)) if pc else ''
            palette.append((app, p, c, n, tok or ''))
    return maps, sites, palette


def emit(maps, out_js):
    lines = ['/* ========================================================',
             ' * phone/ui/rp-inline-map-v3.5.js — v3.5 逐站点内联样式映射（由 tools/gen-inline-map-v35.py 生成，勿手改；v3.4 的 12 个 App + v3.5 的 70 个 App）',
             ' * --------------------------------------------------------',
             ' * 结构：INLINE_MAP[appId][属性名集合(排序, 逗号连接)] = [[动态位掩码, 静态取值哈希, "令牌 令牌", 要删的属性[], 补回的声明[[p,v]] | 0, 标签名], ...]',
             ' *   同一段 style 文本出现在不同标签上（例如 <input> 与 <div>）时令牌可能不同：运行时先找标签一致的条目，再退到同哈希的任意条目。',
             ' *   掩码第 i 位为 1 = 第 i 个属性在源码里是模板变量 / 字符串拼接（匹配任意值，且永不删除）；',
             ' *   哈希 = FNV-1a(其余属性的规范化取值用 U+001F 连接)，与运行时 hash() 同一算法。只存哈希不存原文：表更小，也不含颜色字面量。',
             ' * 运行时（rp-skin-runtime.js 的 classifyEl）读元素的原始 style 文本，用 normStyle() 规范化后在这里精确查找；',
             ' * 查不到的元素照 v3.3 走「装饰属性降级」。本文件只有数据。逐站点去向见 verification/inline-map-sites.tsv。',
             ' * ======================================================== */',
             'export const INLINE_MAP_VERSION = \'3.5.0\';',
             'export const INLINE_MAP = Object.freeze({']
    for app, index in maps.items():
        lines.append('    %s: {' % json.dumps(app))
        for key, bucket in index.items():
            lines.append('        %s: %s,' % (json.dumps(key, ensure_ascii=False), json.dumps(bucket, ensure_ascii=False, separators=(',', ':'))))
        lines.append('    },')
    lines.append('});')
    os.makedirs(os.path.dirname(out_js), exist_ok=True)
    with open(out_js, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')


def main():
    root, out = sys.argv[1], sys.argv[2]
    maps, sites, palette = build(root)
    emit(maps, os.path.join(out, 'ruby-phone/phone/ui/rp-inline-map-v3.5.js'))
    vd = os.path.join(out, 'verification')
    os.makedirs(vd, exist_ok=True)
    with open(os.path.join(vd, 'inline-map-sites.tsv'), 'w', encoding='utf-8') as fh:
        fh.write('appId\t文件\t行\t标签\t类\t去向\t令牌\t删除的内联属性\n')
        for s in sites:
            fh.write('\t'.join(str(x) for x in s) + '\n')
    with open(os.path.join(vd, 'inline-map-palette.tsv'), 'w', encoding='utf-8') as fh:
        fh.write('appId\t属性\t源码字面量\t次数\t令牌\n')
        for p in palette:
            fh.write('\t'.join(str(x) for x in p) + '\n')
    summary = Counter((s[0], s[5]) for s in sites)
    for app in APPS:
        print(app, {k: summary[(app, k)] for k in ('mapped', 'layout-only', 'dynamic-skip')}, 'keys', len(maps[app]), 'entries', sum(len(v) for v in maps[app].values()))


if __name__ == '__main__':
    main()
