#!/usr/bin/env python3
"""wire_v3580_trees.py — [v3.58.0 · 计划 O5] 给所有「破坏副本树」补上 config/write-receipt.js。

【治的是什么】O5 把案头一族的 `_writeJSON` 接到唯一实现 `config/write-receipt.js`。
这些套件在跑负控制时要**造一棵副本树**（真源码定点破坏 → 写副本 → `import` 副本），
副本清单里只有它们当时认得的那几件（num-gate.js / storage.js）。
于是副本树里缺 write-receipt.js，`import` 直接抛
    ERR_MODULE_NOT_FOUND: .../config/write-receipt.js imported from .../apps/xxx/xxx-app.js
这不是「判据转红」，是**判据压根没跑起来** —— 负控制层反而不能证明任何东西。
本仓纪律：副本树必须与判据读的路径一一对应；少一件即报错，不许静默。

【改法】在每个「往副本树 config/ 里放文件」的锚点之后，补一行同款拷贝。
  · 锚点一：writeFileSync(... 'config', 'num-gate.js' ...) 形态
  · 锚点二：copyFileSync(ROOT/config/num-gate.js -> dir/config/num-gate.js) 形态
  · 锚点三：copyFileSync(ROOT/config/storage.js -> dir/config/storage.js) 形态
  · 锚点四（v3480/v3490）：WS_FILES 清单里 NUM_GATE 之后追加 RECEIPT 条目
缩进按命中行的缩进对齐（v3370/v3380 有两处、缩进不同，两处都要补）。

【幂等】已经带 write-receipt.js 拷贝的文件跳过（v3460/v3470 先前已手工补齐）。

【用法】
    python3 tools/wire_v3580_trees.py            # dry-run
    python3 tools/wire_v3580_trees.py --write    # 落盘
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RECEIPT = 'config/write-receipt.js'
COPY_LINE = ("fs.copyFileSync(path.join(ROOT, 'config', 'write-receipt.js'), "
             "path.join(dir, 'config', 'write-receipt.js'));")

ANCHORS = [
    re.compile(r"^([ \t]*)fs\.writeFileSync\(path\.join\(dir, 'config', 'num-gate\.js'\), NUM_GATE_STUB\);$", re.M),
    re.compile(r"^([ \t]*)fs\.copyFileSync\(path\.join\(ROOT, 'config', 'num-gate\.js'\), path\.join\(dir, 'config', 'num-gate\.js'\)\);$", re.M),
    re.compile(r"^([ \t]*)fs\.copyFileSync\(path\.join\(ROOT, 'config', 'storage\.js'\), path\.join\(dir, 'config', 'storage\.js'\)\);$", re.M),
]

WS_ANCHORS = [
    ('tests/system-v3480.test.mjs', "\n    NUM_GATE\n];", "\n    NUM_GATE,\n    RECEIPT\n];"),
    ('tests/system-v3490.test.mjs', "\n    NUM_GATE\n];", "\n    NUM_GATE,\n    RECEIPT\n];"),
]
CONST_ANCHORS = [
    ("tests/system-v3480.test.mjs", "const NUM_GATE = 'config/num-gate.js';",
     "const NUM_GATE = 'config/num-gate.js';\nconst RECEIPT = 'config/write-receipt.js';"),
    ("tests/system-v3490.test.mjs", "const NUM_GATE = 'config/num-gate.js';",
     "const NUM_GATE = 'config/num-gate.js';\nconst RECEIPT = 'config/write-receipt.js';"),
]

FILES = ['tests/system-v%s.test.mjs' % v for v in (
    '3350', '3360', '3370', '3380', '3390', '3400', '3410', '3420',
    '3430', '3440', '3450', '3460', '3470', '3480', '3490',
)]


def patch_anchor(src):
    total = [0]

    def repl(m):
        total[0] += 1
        indent = m.group(1)
        return m.group(0) + '\n' + indent + COPY_LINE

    out = src
    for rex in ANCHORS:
        out = rex.sub(repl, out)
    return out, total[0]


def main():
    write = '--write' in sys.argv
    done, skip, bad = 0, [], []
    for rel in FILES:
        path = os.path.join(ROOT, rel)
        with open(path, encoding='utf-8') as fh:
            src = fh.read()
        if RECEIPT in src:
            skip.append(rel)
            continue
        out, n = patch_anchor(src)
        for f, old, new in CONST_ANCHORS:
            if f == rel:
                if out.count(old) != 1:
                    bad.append('%s 常量锚点命中 %d 次（应 1）' % (rel, out.count(old)))
                else:
                    out = out.replace(old, new, 1)
                    n += 1
        for f, old, new in WS_ANCHORS:
            if f == rel:
                if out.count(old) != 1:
                    bad.append('%s 清单锚点命中 %d 次（应 1）' % (rel, out.count(old)))
                else:
                    out = out.replace(old, new, 1)
                    n += 1
        if n < 1:
            bad.append('%s 无任何锚点命中' % rel)
            continue
        if write:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(out)
            print('WRITE %-32s 补 %d 处' % (rel, n))
        else:
            print('DRY   %-32s 可补 %d 处' % (rel, n))
        done += 1
    for rel in skip:
        print('SKIP  %-32s 已带 write-receipt.js 拷贝' % rel)
    for msg in bad:
        print('BAD   ' + msg)
    print('--- %s：%d 件%s，跳过 %d 件，异常 %d 件' % (
        '已落盘' if write else '可落盘', done, '' if write else '（未写入，加 --write 落盘）',
        len(skip), len(bad)))
    if bad:
        sys.exit(1)


if __name__ == '__main__':
    main()
