#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# bump_v3550.py — 抬版 v3.55.0（五源同源）
# 与 bump_v3480.py 同款范式：
#   ① update-log.json：新键插首位，latest / head 同置；
#   ② manifest.json / package.json / index.js 的 ST_PHONE_VERSION 常量；
#   ③ index.js 的 ST_PHONE_CURRENT_UPDATE 公告块 —— 由条目真源生成（当版 items 是块头部前缀）；
#   ④ ITERATION_LOG.md：头部插迭代段 + 「当前版本」行改当版 + 头部版本数由真源重算。
# 纪律：只写上面五处；先算 draft、逐份断言、最后才落盘；默认 dry-run，--write 才落盘。
# 本脚本零反斜杠：全部走字符串定位，不用正则转义。
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = '3.55.0'
DATE = '2026-10-03'
PREV = '3.54.0'
SEG_ANCHOR = '## 迭代 112 ' + chr(8212) + ' '
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
    '\u3010\u5b9a\u4f4d\u3011\u672c\u7248\u505a\u8ba1\u5212 A2\uff1a\u5efa\u300cApp \u00d7 \u5e73\u53f0\u7ea7\u6d88\u8d39\u9762\u300d\u77e9\u9635\uff08\u53ea\u8bfb\u96f6\u98ce\u9669\uff09\u3002\u7b2c 1~3 \u5c42\u5171\u7f1d\u5165\u4e09\u5341\u4f59\u4ef6 App\uff0c\u6bcf\u4ef6\u90fd\u505a\u5230\u4e86\u56db\u5c42\u9f50\u5907 + \u516d\u5904\u63a5\u7ebf + \u5224\u636e\u5e26\u8d1f\u63a7\u5236\uff0c\u4f46\u300c\u8fd9\u4e9b App \u6709\u6ca1\u6709\u88ab\u5e73\u53f0\u7ea7\u516d\u9762\u8986\u76d6\u300d\u5168\u4ed3\u6ca1\u6709\u4e00\u5904\u80fd\u56de\u7b54\uff08\u8981\u4e48\u9010\u6587\u4ef6\u8bfb\u6ce8\u91ca\u3001\u6ce8\u91ca\u4e0d\u968f\u5bf9\u9762\u6f02\u79fb\uff0c\u8981\u4e48\u4eba\u8089 review\uff09\u3002\u65b0\u589e config/app-consumption-matrix.js\uff08\u516d\u9762\u53e3\u5f84 + 81 \u884c\u77e9\u9635 + \u4e94\u6761\u4e0d\u9002\u7528\u53f0\u8d26\uff09\u3002',
    '\u3010\u516d\u9762\u53e3\u5f84\u3011F1 \u751f\u6210\u4fa7\u6ce8\u5165\uff08\u771f\u6e90\uff1aApp \u81ea\u6709\u6587\u4ef6\u91cc\u51fa\u73b0 GENERATE_BEFORE_COMBINE_PROMPTS \u4e3b\u94a9\u5b50\uff09/ F2 \u5168\u5c40\u641c\u7d22\uff08global-search-engine \u6e90\u8868 appId\uff09/ F3 \u7cfb\u7edf\u901a\u77e5\uff08config/system-notifications.js \u6620\u5c04\u8868\uff09/ F4 \u5fae\u4fe1\u94fe\u8def\uff08chat-view.js \u7684 _injectApps \u8868\uff09/ F5 \u4e0a\u6e38\u8bfb\u6570\uff0814 \u4e2a\u4e0a\u6e38\u5951\u7ea6\u9762\u4e4b\u4e00\uff09/ F6 \u751f\u547d\u5468\u671f\uff08index.js \u7684 REBIND \u8868\uff09\u3002\u771f\u8bfb\u6570\uff1a28 / 27 / 14 / 10 / 12 / 65\uff08\u5171 81 \u4ef6 App\uff09\u3002',
    '\u3010\u53e3\u5f84\u7eaa\u5f8b\u3011\u672c\u6a21\u5757\u53ea\u9648\u5217\u4e8b\u5b9e\u3001\u4e0d\u505a\u53d6\u6570\uff1a\u516d\u4e2a\u5e03\u5c14\u503c\u5168\u90e8\u7531\u5224\u636e\u5957\u4ef6\u4ece\u78c1\u76d8\u771f\u6e90\u72ec\u7acb\u590d\u7b97\u5e76\u4e0e\u672c\u8868\u53cc\u5411\u5bf9\u8d26\uff08\u540c\u6e90\u81ea\u8ff0\u5fc5\u7136\u6052\u7eff\uff1b\u58f0\u660e\u4e0e\u4e8b\u5b9e\u5206\u5f00\u5b58\u653e\uff0c\u4e24\u8005\u4e0d\u4e00\u81f4\u65f6\u624d\u6709\u5224\u522b\u529b\uff09\u3002false \u683c\u4e0d\u9010\u683c\u5199\u7406\u7531\uff08\u9010\u683c\u5199 4xx \u6761\u5fc5\u7136\u9000\u5316\u6210\u653e\u884c\u6761\uff09\uff0c\u53d6\u6536\u53e3\u5f0f\uff1a\u53ea\u6709\u300c\u516d\u9762\u5168\u65e0\u300d\u7684 5 \u4ef6\uff08mofo / games / settings / mood / search\uff09\u8fdb\u4e0d\u9002\u7528\u53f0\u8d26\u5e76\u9010\u6761\u5199\u660e\u7406\u7531\uff0c\u8be5\u53f0\u8d26\u4e0e\u78c1\u76d8\u53cc\u5411\u5bf9\u8d26\u3002',
    '\u3010\u62d3\u5c55\u3011\u8bca\u65ad\u4e2d\u5fc3\u65b0\u589e\u300cApp \u6d88\u8d39\u9762\u77e9\u9635\u300d\u5361\u7247\uff08\u4f4d\u7f6e\uff1a\u8de8\u4ed3\u529f\u80fd\u767b\u8bb0\u4e4b\u540e\u3001\u68c0\u67e5\u70b9\u5185\u5bb9\u7ea7\u5bf9\u7167\u4e4b\u524d\uff09\uff1a\u9010\u9762\u547d\u4e2d\u6570 + \u9010 App \u547d\u4e2d\u9762\u6e05\u5355 + \u4e0d\u9002\u7528\u53f0\u8d26\u7406\u7531\u5168\u4e0a\u5899\uff1b\u4e00\u53e5\u8bdd\u603b\u8ff0\u7531\u5185\u6838\u7ed9\u51fa\uff0c\u89c6\u56fe\u53ea\u6392\u7248\uff08\u4e0d\u81ea\u7b97\u7b2c\u4e8c\u4efd\uff09\u3002appFaces \u9762\u5728**\u6240\u6709**\u8def\u5f84\u7684\u8fd4\u56de\u5305\u4e0a\u5730\u5728\uff08\u5341\u51e0\u5957\u5386\u53f2\u5224\u636e\u65ad\u8a00 collectDiagnose \u7ed3\u6784\u6052\u5b9a\uff0c\u65b0\u589e\u9762\u5fc5\u987b\u5168\u8def\u5f84\u5728\u573a\uff09\u3002',
    '\u3010\u6355\u771f\u7f3a\u9677 \u00b7 \u76ee\u5f55 \u2260 App\u3011\u9996\u8dd1\u590d\u7b97\u5373\u6293\u5230\uff1aapps/memory/ \u4e00\u4e2a\u76ee\u5f55\u627f\u8f7d\u4e24\u4ef6 App\uff08memory-app.js / graph-app.js\uff09\uff0c\u6309\u76ee\u5f55\u53d6\u6570\u4f1a\u8ba9 graph \u7ee7\u627f memory \u7684\u8bfb\u6570 \u2014\u2014 \u9996\u7248\u5c06 graph \u8bef\u62a5\u4e3a\u547d\u4e2d\u6ce8\u5165 / \u641c\u7d22 / \u4e0a\u6e38\u4e09\u9762\u3002\u4fee\u6cd5\uff1a\u590d\u7b97\u4e00\u5f8b\u6309\u300c\u8be5 App \u81ea\u6709\u6587\u4ef6\u96c6\u300d\u53d6\u6570\uff08\u5165\u53e3\u6587\u4ef6 + \u540c\u540d\u524d\u7f00\u6587\u4ef6\uff09\uff0c\u5e76\u5728\u5224\u636e\u91cc\u628a\u300c\u76ee\u5f55\u53d6\u300d\u4f5c\u4e3a\u53ef\u5206\u8fa8\u6027\u53cd\u4f8b\u9489\u4f4f\uff08\u82e5\u4e24\u79cd\u8bfb\u6cd5\u7ed3\u679c\u4e00\u6837\uff0c\u8bf4\u660e\u8fd9\u6761\u53e3\u5f84\u6839\u672c\u6ca1\u88ab\u9a8c\u8bc1\uff09\u3002',
    '\u3010\u6355\u771f\u7f3a\u9677 \u00b7 \u5224\u636e\u81ea\u8eab\u7684\u5047\u7eff\u3011\u7834\u574f\u8868\u9996\u8dd1\u5373\u62a5\u7ea2 D8\uff08\u300c\u89c6\u56fe\u5361\u7247\u88ab\u62ff\u6389\u300d\u672a\u88ab\u89c2\u6d4b\u5230\uff09\uff1a\u539f\u5224\u636e\u53ea\u770b\u300c_appFacesHtml(pkg) \u5b57\u7b26\u4e32\u5728\u573a\u300d\uff0c\u800c\u65b9\u6cd5\u7b7e\u540d\u4e5f\u5305\u542b\u540c\u4e00\u4e32 \u2014\u2014 \u5361\u7247\u88ab\u5220\u540e\u7b7e\u540d\u4ecd\u5728\uff0c\u5224\u636e\u7167\u6837\u7eff\u3002\u4fee\u6cd5\uff1a\u6539\u8ba4\u300c\u8c03\u7528\u70b9\u300d\u5f62\u6001\uff08this._appFacesHtml(pkg)\uff09\u2014\u2014 \u300c\u5b9a\u4e49\u8fc7\u300d\u4e0e\u300c\u88ab\u8c03\u8d77\u300d\u662f\u4e24\u4ef6\u4e8b\uff0c\u8fd9\u6b63\u662f\u5224\u636e\u8be5\u62b3\u7684\u5f62\u6001\u3002',
    '\u3010\u5224\u636e\u5957\u4ef6\u3011\u65b0\u589e tests/system-v3550.test.mjs\uff0814 \u4f8b\uff09\uff1aA \u9762\u9010\u5217\u590d\u7b97\uff08\u9010\u884c\u3001\u9010\u9762\u4e24\u91cd\u5bf9\u8d26\uff09/ B \u9762 NA \u53cc\u5411\u5bf9\u8d26 / F \u9762\u8bca\u65ad\u63a5\u7ebf\u4e0e\u952e\u9762\u6052\u5b9a / G \u9762\u5224\u636e\u5de5\u5177\u81ea\u8bc1\uff08\u4e0b\u9650\u951a + \u53e3\u5f84\u53ef\u5206\u8fa8\uff09/ V \u9762\u7248\u672c\u4e0b\u9650\u951a / D \u9762\u771f\u6e90\u7801\u5b9a\u70b9\u7834\u574f 8 \u6761\uff08\u7834\u574f\u53ea\u843d\u526f\u672c\u6811\uff0c\u951a\u70b9\u5fc5\u987b\u6070\u4e2d 1 \u6b21\uff09\u3002',
    '\u3010\u95e8\u7981\u3011\u6b7b\u5bfc\u51fa\u95e8\u5f53\u573a\u590d\u8dd1\u5f97\uff1a\u626b\u63cf 413 \u6587\u4ef6 / 2387 \u4e2a\u5bfc\u51fa\u58f0\u660e\uff0c\u65b0\u6a21\u5757\u4e94\u4e2a\u5bfc\u51fa\u5168\u90e8\u88ab\u8bca\u65ad\u4e2d\u5fc3\u771f\u6d88\u8d39\uff08\u6b7b\u5bfc\u51fa\u95e8\u660e\u786e\u300c\u6d4b\u8bd5\u4e0d\u7b97\u6d88\u8d39\u300d\uff0c\u6545\u77e9\u9635\u5bfc\u51fa\u9762\u5fc5\u987b\u6709\u4ea7\u54c1\u7aef\u6d88\u8d39\u70b9\uff09\uff1b\u8bca\u65ad\u76f8\u5173\u5341\u4f59\u5957\u4ef6\u5355\u8dd1 391 \u4f8b\u5168\u7eff\u3002',
    '\u3010\u8fb9\u754c\uff08\u8bda\u5b9e\u8bb0\u8d26\uff09\u3011\u516d\u9762\u590d\u7b97\u662f\u300c\u6587\u672c\u5f62\u6001\u300d\u53e3\u5f84\uff08\u4e0d\u89e3\u6790 AST\u3001\u4e0d\u8ffd\u52a8\u6001\u62fc\u540d\uff09\uff1b\u672c\u8868\u8bc1\u660e\u7684\u662f\u300c\u6d88\u8d39\u70b9\u5728\u573a\u300d\uff0c\u4e0d\u8bc1\u660e\u300c\u771f\u673a\u4e0a\u90a3\u5904\u6d88\u8d39\u771f\u8dd1\u5bf9\u4e86\u300d\uff08\u5f52 R-O3 \u771f\u5bbf\u4e3b\u5b9e\u673a\u9a8c\u8bc1\uff09\u3002',
    '\u3010\u6587\u6863\u8bb0\u8d26\u3011PLAN.md \u73b0\u72b6\u57fa\u7ebf\u7531 v3.28.0 \u5bf9\u9f50\u771f\u8bfb\u6570\uff08v3.55.0\uff1a80 \u4e2a App / index.js \u4f53\u91cf / \u95e8\u7981\u8bfb\u6570\uff09\uff0cA2 \u6761\u76ee\u6807\u6ce8\u300c\u5df2\u4ea4\u4ed8 v3.55.0\u300d\u3002',
    '\u3010\u7248\u672c\u5347\u81f3 3.55.0\uff08\u4e94\u6e90\u540c\u6e90\uff09\u3011manifest.json / package.json / update-log.json \u9996\u4f4d\u65b0\u952e + latest + head / index.js \u7684\u7248\u672c\u5e38\u91cf\u4e0e\u516c\u544a\u5757 / ITERATION_LOG.md \u5934\u90e8\u8fed\u4ee3\u6bb5\uff0c\u4e94\u5904\u540c\u6e90\u4e00\u6b21\u62ac\u9f50\u3002',
]
assert len(ITEMS) == 11, len(ITEMS)
for i, it in enumerate(ITEMS):
    assert isinstance(it, str) and it, i
    assert it.startswith('\u3010') and '\u3011' in it, i
    assert '[' not in it and ']' not in it, i
    assert NL not in it, i

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

# ③ index.js
idx = rd('index.js')
idx_new = once(idx, "const ST_PHONE_VERSION = '%s';" % PREV,
               "const ST_PHONE_VERSION = '%s';" % VER, 'index.js 版本常量')
START = 'const ST_PHONE_CURRENT_UPDATE = {'
assert idx_new.count(START) == 1
bi = idx_new.find(START)
bj = idx_new.find(NL + '};', bi)
assert bi > 0 and bj > bi, 'ST_PHONE_CURRENT_UPDATE 块必须可提取'
OLD_BLOCK = idx_new[bi:bj]
lines = [START,
         '    version: ST_PHONE_VERSION,',
         '    date: "%s",' % DATE,
         '    items: [']
for it in ITEMS:
    lines.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
lines.append('    ]')
lines.append('};')
new_block = NL.join(lines)
# 旧块的 items 追加到新块之后（公告块为累积式：新在前）
old_items_part = OLD_BLOCK[OLD_BLOCK.index('items: [') + len('items: ['):OLD_BLOCK.rindex('    ]')]
OLD_LINES = [l for l in old_items_part.split(NL) if l.strip().startswith('"')]
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
seg = idx_new[idx_new.index('    items: [', idx_new.index(START)):idx_new.index(NL + '    ]', idx_new.index('    items: [', idx_new.index(START)))]
for ln in seg.split(NL):
    if not ln.strip().startswith('"'):
        continue
    q = ln.count('"') - ln.count(chr(92) + '"')
    assert q == 2, '公告块引号数异常（行内引号 %d）：%s' % (q, ln[:60])

# ④ ITERATION_LOG.md
itlog = rd('ITERATION_LOG.md')
itlog = once(itlog, '- **当前版本**：`%s`（五源同源）' % PREV,
             '- **当前版本**：`%s`（五源同源）' % VER, '元信息版本行')
# 头部版本数：声明值与真源长期不一致（199 vs 实际），故按「数字 + 后缀」定位修正，不用旧值做锚点。
TAG = ' 个版本，按版本号索引'
assert itlog.count(TAG) == 1, '头部版本数句式必须恰中 1 次'
_ti = itlog.index(TAG)
_ts = _ti
while _ts > 0 and itlog[_ts - 1].isdigit():
    _ts -= 1
_old_decl = int(itlog[_ts:_ti])
itlog = itlog[:_ts] + str(len(new_versions)) + itlog[_ti:]
print('头部版本数：%d -> %d（声明值与 update-log 真源对齐）' % (_old_decl, len(new_versions)))
SEG = rd('tools/iter113_seg.md')
assert SEG.lstrip().startswith('## 迭代 113 '), SEG[:40]
assert itlog.count(SEG_ANCHOR) == 1, '迭代 112 段锚点必须恰中 1 次'
itlog = itlog.replace(SEG_ANCHOR, SEG.rstrip(NL) + NL + NL + SEG_ANCHOR)
assert itlog.count('## 迭代 113 ') == 1

print('== dry-run 摘要 ==')
print('update-log: latest=%s first=%s 版本数 %d -> %d' % (VER, list(new_log['versions'])[0], OLD_N, len(new_versions)))
print('manifest/package: version -> %s' % VER)
print('index.js: 常量 + 公告块（当版 %d 条 + 历史 %d 条 = %d）' % (len(ITEMS), len(OLD_LINES), len(ITEMS) + len(OLD_LINES)))
print('ITERATION_LOG: 迭代 113 段 + 当前版本行 + 版本数 %d' % len(new_versions))
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
