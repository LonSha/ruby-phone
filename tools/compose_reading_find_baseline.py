#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""compose_reading_find_baseline.py — 合成 R5-O7 的**改前/改后双格**基线。

【为什么需要这一步，而不是直接 `探针 > 基线.json`】
计划原文（R5-O7 验收）：「以本地 200 万汉字书**记录改前/后**首查、续查及内存」。
直接重定向只能留一份（必然是改后那份），改前读数就只剩口述 —— 而本仓的纪律是
「读数零手抄」。故把两份**现场跑出来的** JSON 合成一份：
  · `readings` / `timing` / `criteria`  = **改后**（必须与现场复跑逐项一致，判据看守）；
  · `readings_before` / `timing_before` / `criteria_before` = **改前**（冻结的历史读数，
    由当版探针在**改动前**的真代码上跑出来，不参与现场复跑比对 —— 它记的是历史）。
【为什么 measured_at 冻结在 v4.33.0】
  与 tests/system-v3760 对 search_scale_baseline 同款纪律：`measured_at` 是**首测版**，
  抬版不得改写。本探针的首测发生在改动之前（4.33.0 的代码上），故冻在那里。
用法：
  python3 tools/compose_reading_find_baseline.py --before /tmp/rf_before.json --after /tmp/rf_after.json --write
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = 'tests/audit/reading_find_scale_baseline.json'
FIRST_MEASURED_AT = 'v4.33.0'      # 首测版（改动之前）—— 冻结，抬版不改写
CHANGED_AT = 'v4.34.0'             # 本版（R5-O7 落地的那一版）


def flag(name, default=None):
    pre = '--' + name + '='
    for a in sys.argv:
        if a.startswith(pre):
            return a[len(pre):]
    for i, a in enumerate(sys.argv):
        if a == '--' + name and i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


def rd(p):
    with io.open(p, encoding='utf-8') as f:
        return json.load(f)


def main():
    before_p = flag('before')
    after_p = flag('after')
    write = '--write' in sys.argv
    if not before_p or not after_p:
        print('[compose] 必须同时给 --before 与 --after（两份现场跑出来的 JSON）')
        return 2
    for p in (before_p, after_p):
        if not os.path.exists(p):
            print('[compose] 读不到 %s —— 拒判（不许拿半份读数合成）' % p)
            return 2
    b = rd(before_p)
    a = rd(after_p)
    # 两次都必须真是同一支探针跑出来的：探针路径不一致就是拿两份不同的东西硬拼。
    if b.get('probe') != a.get('probe'):
        print('[compose] 两份读数的 probe 字段不一致 —— 拒判：%r vs %r' % (b.get('probe'), a.get('probe')))
        return 2
    if b.get('host', {}).get('total_chars') != a.get('host', {}).get('total_chars'):
        print('[compose] 两份夹具规模不一致（总字数不同）—— 拒判：改前/后必须是同一本书')
        return 2
    out = dict(a)
    out['measured_at'] = FIRST_MEASURED_AT
    out['changed_at'] = CHANGED_AT
    out['note'] = (a.get('note', '') +
                   ' 【改前/后双格】readings/timing/criteria = 改后（v%s 落地后）；'
                   'readings_before/timing_before/criteria_before = 改前（在 v%s 真代码上跑出来的历史读数）。'
                   '为什么两格都要：计划原文要求「记录改前/后首查、续查及内存」——'
                   '只有改后那份就分不清「本来就这样」与「本版改成的」。'
                   '为什么改前那格不与现场复跑比对：它记的是历史，现场跑的是现在的代码。'
                   % (CHANGED_AT.lstrip('v'), FIRST_MEASURED_AT.lstrip('v')))
    out['readings_before'] = b.get('readings')
    out['timing_before'] = b.get('timing')
    out['criteria_before'] = b.get('criteria')
    out['verdict_before'] = b.get('verdict')
    # 判据面：改前的 R4/R5 是**不成立**的（正是本版要治的两条）—— 合成时如实留痕。
    out['criteria_before_note'] = ('改前 R4/R5 不成立属**预期**：那时每次查询都现建索引、'
                                   '且 App 上没有任何复用读数。判据看守的是改后那一组（criteria）。')
    text = json.dumps(out, ensure_ascii=False, indent=1) + chr(10)
    if not write:
        print('[compose] 干跑：将写出 %d 字节到 %s' % (len(text.encode('utf-8')), OUT))
        return 0
    with io.open(os.path.join(ROOT, OUT), 'w', encoding='utf-8') as f:
        f.write(text)
    print('[compose] 已写出 %s（改后判据 %d 项 · 改前判据 %d 项）'
          % (OUT, len(out.get('criteria') or []), len(out.get('criteria_before') or [])))
    return 0


if __name__ == '__main__':
    sys.exit(main())
