#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""refresh_baselines_v3930.py — v3.93.0 抬版后的**探针基线对账**（现场读数写回，零手抄）。

它治的是同一族缺陷的**两个证据面**：

  （一）本版当场抓到的真缺陷（不是本版引入，但是本版修掉的）
  `tests/audit/longlist_scale_baseline.json` 的 `readings.after_motion_css.css_files_scanned`
  停在 **85**，而真仓的全仓 .css 枚举面自 v3.89.0 起就已超过 85
  （实测：v3.88.0=85、v3.89.0=86、v3.90.0=87、v3.91.0=88、v3.92.0=89、本版=90）。
  也就是说 **v3770 的 B1/B2 两条读数判据已连红五版**：每版新增一张 App 局部样式表，
  那条「计数段与基线逐字段相等」就当场转红，而它**不是**本版引入的 ——
  是「新增 CSS 时没有人负责刷新那张基线」。

  （二）本版**注入的**枚举面漂移（R-X9 新增真源/产品面/判据 ⇒ 四张基线的扫描面读数 +3）
  本版新增 `config/access-layers.js`（真源）、`apps/accessdesk/`（产品面）、
  `tests/system-v3930.test.mjs`（判据）等落盘文件 ⇒ 四张取证基线的**枚举面**读数
  必然跟着涨（+3 文件）。
  外加 R-X9 把一个 App 类接进实例域 ⇒ `lifecycle_declarative` 的
  `app_classes 82→83 / slots 94→95 / app_slots 83→84 / sig_empty 72→73`，
  以及 `app_slot_share_pct`（84/95 = 88.4%，**真漂移**，不是形式差异）。

  为什么这值得单独立工具：这些基线是**读数判据的真源**，它们一旦过时，判据就从
  「看守」退化成「噪声」—— 后来者看到红灯的第一反应会变成「这条判据老是这样」
  （本仓最贵的形态：判据失去可信度）。修法不是把判据删掉，而是
  **把刷新做成可复算的动作**。

纪律（与 tools/refresh_baselines_v3910.py 逐字同规，并加三条）：
  · 探针 rc!=0 即中止不写；
  · 只在现场与基线不同才写盘（幂等：已同源则一行不动）；
  · 判据散文逐条按 id 对齐，条数不同即报错不静默；
  · 现场值命中「未复核 / 冻结证据 / （冻结）」的冻结面跳过；
  · 标量才可对平（防「基线记计数、现场给名单」的 int↔list 误写）；
  · **不碰首测版的 `measured_at`**（冻结历史值）；
  · 名单（数组）不一致即报错不静默 —— 那是**面变了**，不是漂移，要人看一眼；
  · 嵌套格（after_motion_css）里的标量逐格对，名单不一致同上；
  · `*_pct` 的口径归一：基线是百分数（80.6）、现场是小数（0.8064…），
    两者**同口径即视为已同源、一行不动**；真漂移也按基线口径写回（88.4），
    不把可读口径改写成 0.8842105263157894。
"""
import io
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)
VER = '3.93.0'

# 嵌套与异名（lifecycle 探针把签名/路径分组成对象，基线把它们平铺成下划线键）
NESTED_LC = {
    'sig_empty': ('signatures', 'empty'),
    'sig_default': ('signatures', 'def'),
    'sig_required': ('signatures', 'required'),
    'sig_none': ('signatures', 'none'),
    'points_p1': ('pointsByPath', 'P1'),
    'points_p2': ('pointsByPath', 'P2'),
    'points_p3': ('pointsByPath', 'P3'),
}
# 同名异算（现场换了字段名，值语义相同：占比与一致率）
ALIAS_LC = {
    'app_slot_share_pct': 'appSlotShare',
    'coverage_pct': 'coverage',
    'non_app_share_pct': 'nonAppShare',
    'semantic_consistency_pct': 'semanticConsistency',
}

PAIRS = [
    {
        'base': 'tests/audit/longlist_scale_baseline.json',
        'probe': 'tests/audit/longlist_scale_probe.cjs',
        'readings_from': 'readings',
        'nested': ['after_motion_css'],
        'note': (
            '本基线在 v3.93.0 被**显式刷新过一次**（不是抬版侧写）：两处 ——'
            '① readings.after_motion_css.css_files_scanned 与 ② criteria[L8] 的散文。'
            '这是一条**跨五版未刷**的遗留：真仓全仓 .css 枚举面自 v3.89.0 起就已超过 85'
            '（v3.88.0=85 → v3.89.0=86 → v3.90.0=87 → v3.91.0=88 → v3.92.0=89 → v3.93.0=90），'
            '而那份基线停在 85 ⇒ v3770 的 B1/B2 两条读数判据自 v3.89.0 起**连红五版**，'
            '且每版都看着像「本版引入的新红」。本版把刷新做成可复算的脚本动作'
            '（tools/refresh_baselines_v3930.py，零手抄、幂等、冻结 measured_at），'
            '并把这条遗留如实登记进 v3.93.0 的当版条目。'
            'measured_at 仍是 v3.76.0（建基线时的当版，冻结历史值）；'
            '刷新是「输入面变了、读数跟着变」的显式动作，不是被抬版脚本连带改写。'
        ),
    },
    {
        'base': 'tests/audit/schedule_conflict_baseline.json',
        'probe': 'tests/audit/schedule_conflict_probe.cjs',
        'readings_from': 'flat',
        'nested': [],
        # 探针现场给的是**名单**，基线在 readings 里记的是**条数**（int）——
        # 这一格是 int↔list，按名单长度对平；名单本体在顶层 consume_files。
        'count_of': {'consume_files': 'consumeFiles'},
        'lists': [('consume_files', 'consumeFiles')],
    },
    {
        'base': 'tests/audit/branch_play_baseline.json',
        'probe': 'tests/audit/branch_play_probe.cjs',
        'readings_from': 'flat',
        'nested': [],
        'lists': [('rollback_files_list', 'rollbackFilesList')],
    },
    {
        'base': 'tests/audit/long_chat_baseline.json',
        'probe': 'tests/audit/long_chat_probe.cjs',
        'readings_from': 'readings',
        'nested': [],
        # long_chat 的静态面读数在**顶层** scan（不在 readings.scan）；
        # v327 用 assert.deepEqual 逐项比，故必须逐字段对平。
        'scan_from': 'scan',
    },
    {
        'base': 'tests/audit/lifecycle_declarative_baseline.json',
        'probe': 'tests/audit/lifecycle_declarative_probe.cjs',
        'readings_from': 'flat',
        'nested': [],
        'nested_map': NESTED_LC,
        'alias': ALIAS_LC,
    },
]

REFRESH_NOTE_FMT = (
    '本基线在 v3.93.0 被**显式刷新过一次**（不是抬版侧写），原因只有一类：'
    'R-X9 落地的文件使**全仓枚举面**从 419 涨到 422，于是「扫到的文件数」'
    '这条读数必然跟着涨。这是「**输入面变了、读数跟着变**」的显式动作，不是转写漂移。'
    '刷新由 tools/refresh_baselines_v3930.py 完成（零手抄、幂等、冻结 measured_at、'
    '冻结面跳过、名单不一致即报错）。measured_at 仍是建基线时的当版，未被改写。'
)


def rd(rel):
    with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, s):
    with io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)


def detect_indent(rel):
    """探测原文件的缩进量（顶层键前面几个空格）——**写回必须保持原缩进**。
    踩坑：本工具第一版把 write_json 的 indent 写死成 1，于是 longlist_scale_baseline.json
    （原 indent=2）被整文件重排，diff 从「两处」涨成「整文件」——
    这是**形式破坏**：真正的改动被淹没在缩进洪流里，评审时看不见。
    修法：缩进从原文件探测，工具只改该改的那几格。"""
    try:
        with io.open(os.path.join(ROOT, rel), encoding='utf-8') as f:
            f.readline()
            second = f.readline()
    except OSError:
        return 1
    n = len(second) - len(second.lstrip(' '))
    return n if 0 < n <= 8 else 1


def write_json(rel, obj, indent=None):
    if indent is None:
        indent = detect_indent(rel)
    wr(rel, json.dumps(obj, ensure_ascii=False, indent=indent) + NL)


def run_probe(rel):
    r = subprocess.run(['node', rel, '--json'], cwd=ROOT, capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        raise SystemExit('[refresh] 探针 %s rc=%d：%s' % (rel, r.returncode, (r.stderr or '')[:300]))
    return json.loads(r.stdout)


def camel(s):
    p = s.split('_')
    return p[0] + ''.join(x[:1].upper() + x[1:] for x in p[1:])


def scalars(x, y):
    for v in (x, y):
        if isinstance(v, bool) or not isinstance(v, (int, float, str)):
            return False
    return True


def same_unit(key, base_v, live_v):
    """口径归一：*_pct 在基线里是**百分数形式**（80.6），
    而探针现场给的是**小数形式**（0.8064516...）—— 两者不是漂移，是同一读数的两种写法。
    这一格防的是「对账把可读口径改写成 0.8064516129032258」这种**形式破坏**：
    写回前先按同口径比一次，同口径即视为已同源、一行不动。
    活标本：v3.24.0 基线里 app_slot_share_pct: 88.3，现场 appSlotShare: 0.8842...。
    """
    if key.endswith('_pct') and isinstance(base_v, (int, float)) and isinstance(live_v, (int, float)):
        if abs(live_v) <= 1.0000001:
            return round(live_v * 100.0, 1) == round(float(base_v), 1)
    return False


def live_readings(live, pair):
    if pair['readings_from'] == 'readings':
        blk = live.get('readings')
        return blk if isinstance(blk, dict) else {}
    return live


def resolve_live(live, key, pair):
    """把基线里的下划线平铺键解析成现场值（顺序：条数→嵌套→异名→同名→驼峰）。"""
    co = pair.get('count_of') or {}
    if key in co:
        lst = live.get(co[key])
        return len(lst) if isinstance(lst, list) else None
    nm = pair.get('nested_map') or {}
    if key in nm:
        head, tail = nm[key]
        blk = live.get(head)
        return blk.get(tail) if isinstance(blk, dict) else None
    al = pair.get('alias') or {}
    if key in al:
        return live.get(al[key])
    if key in live:
        return live[key]
    ck = camel(key)
    return live.get(ck) if ck in live else None


def sync_readings(doc, live, pair, changed):
    block = doc.get('readings') or {}
    nested = pair.get('nested') or []
    for k, v in list(block.items()):
        if isinstance(v, dict):
            if k not in nested:
                continue
            lv = live.get(k)
            if not isinstance(lv, dict):
                raise SystemExit('[refresh] %s：基线是对象、现场不是（%s）—— 不静默' % (k, type(lv).__name__))
            for kk, vv in list(v.items()):
                llv = lv.get(kk)
                if llv is None or llv == vv:
                    continue
                if isinstance(vv, (list, dict)) or isinstance(llv, (list, dict)):
                    raise SystemExit('[refresh] %s.%s 是名单/对象且不一致 —— 那是面变了，不是漂移，要人看一眼' % (k, kk))
                if isinstance(vv, bool) or not isinstance(vv, (int, float, str)):
                    continue
                changed.append('readings.%s.%s %s -> %s' % (k, kk, vv, llv))
                v[kk] = llv
            continue
        lv = resolve_live(live, k, pair)
        if lv is None or lv == v or not scalars(v, lv):
            continue
        if same_unit(k, v, lv):
            continue
        out = lv
        if k.endswith('_pct') and isinstance(lv, (int, float)) and abs(lv) <= 1.0000001:
            # 真漂移也按基线口径写回（百分数形式，一位小数），不把可读口径改成小数
            out = round(lv * 100.0, 1)
        changed.append('readings.%s %s -> %s' % (k, v, out))
        block[k] = out
    doc['readings'] = block


def sync_block(doc, live, pair, changed):
    """逐字段对平一个**顶层标量块**（如 long_chat 的 scan）。"""
    sec = pair.get('scan_from')
    if not sec:
        return
    lv_block = live.get(sec)
    if not isinstance(lv_block, dict):
        raise SystemExit('[refresh] 现场缺 %s 块 —— 不静默' % sec)
    base_block = doc.get(sec)
    if not isinstance(base_block, dict):
        raise SystemExit('[refresh] 基线缺 %s 块 —— 不静默' % sec)
    for k, v in list(base_block.items()):
        llv = lv_block.get(k)
        if llv is None or llv == v:
            continue
        if isinstance(v, (list, dict)) or isinstance(llv, (list, dict)) or isinstance(llv, bool):
            raise SystemExit('[refresh] %s.%s 是名单/对象且不一致 —— 那是面变了，不是漂移' % (sec, k))
        changed.append('%s.%s %s -> %s' % (sec, k, v, llv))
        base_block[k] = llv
    doc[sec] = base_block


def sync_lists(doc, live, pair, changed):
    """顶层名单字段：**只报不写**（名单变了是面变了，要人看一眼）。"""
    for base_key, live_key in (pair.get('lists') or []):
        b = doc.get(base_key)
        l = live.get(live_key)
        if not isinstance(b, list) or not isinstance(l, list):
            continue
        if b == l:
            continue
        raise SystemExit('[refresh] %s 名单与现场不一致（基线 %d 项 / 现场 %d 项）'
                         '—— 那是面变了，不是漂移，本工具不代写' % (base_key, len(b), len(l)))


def sync_criteria(doc, live, changed):
    base_crit = doc.get('criteria') or []
    live_crit = live.get('criteria') or []
    if not base_crit or not live_crit:
        return
    if len(base_crit) != len(live_crit):
        raise SystemExit('[refresh] 判据条数与现场不同（%d vs %d）—— 不静默，先人工核'
                         % (len(base_crit), len(live_crit)))
    lm = {str(c.get('id')): c for c in live_crit}
    for b in base_crit:
        cid = str(b.get('id'))
        l = lm.get(cid)
        if l is None:
            raise SystemExit('[refresh] 现场缺判据 ' + cid)
        lg = l.get('got_text')
        if lg is None:
            lg = l.get('gotText')
        if lg is None:
            # longlist 探针把判据实测值记在 `got`（历史形态），一并认，避免静默跳过。
            lg = l.get('got')
        if lg is None:
            continue
        lg = str(lg)
        if any(t in lg for t in ('未复核', '冻结证据', '（冻结）')):
            continue
        lpass = l.get('pass')
        if b.get('pass') != lpass and b.get('pass') is not None and lpass is not None:
            changed.append('criteria[%s].pass %s -> %s' % (cid, b.get('pass'), lpass))
            b['pass'] = lpass
        bg = b.get('got_text', b.get('got'))
        if str(bg) != lg:
            changed.append('criteria[%s].got_text %s -> %s' % (cid, str(bg)[:48], lg[:48]))
            b['got_text'] = lg
    doc['criteria'] = base_crit


def main():
    total = 0
    for pair in PAIRS:
        base_rel = pair['base']
        live = run_probe(pair['probe'])
        doc = json.loads(rd(base_rel))
        assert doc.get('measured_at'), '基线必须带 measured_at（冻结历史值）：' + base_rel
        before_measured = doc['measured_at']
        changed = []
        sync_readings(doc, live_readings(live, pair), pair, changed)
        sync_block(doc, live, pair, changed)
        sync_lists(doc, live, pair, changed)
        sync_criteria(doc, live, changed)
        assert doc['measured_at'] == before_measured, 'measured_at 不得被对账改写'
        if not changed:
            print('[refresh] %s：已与现场同源，跳过' % base_rel)
            continue
        total += len(changed)
        for line in changed:
            print('[refresh] %s：%s' % (base_rel, line))
        doc['refreshed_at'] = 'v' + VER
        doc['refresh_note'] = pair.get('note') or REFRESH_NOTE_FMT
        if WRITE:
            write_json(base_rel, doc)
            print('[refresh] %s -> 已写盘（%d 处）' % (base_rel, len(changed)))
        else:
            print('[refresh] %s -> （dry）需写盘（%d 处）' % (base_rel, len(changed)))
    print('[refresh] 合计待写 %d 处' % total)
    if not WRITE:
        print('--- DRY RUN (pass --write to apply) ---')
    return 0


if __name__ == '__main__':
    sys.exit(main())