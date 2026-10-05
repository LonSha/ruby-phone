#!/usr/bin/env python3
"""fix_v3580_anchor_v281.py — [v3.58.0 · 计划 O4] 把 v281 的变异锚点收回到 render() 那一处。

【治的是什么】v281 D1 破坏「每次打开对齐宿主源」，锚点取的是：

        this._syncHostSources();

O4 给 `apps/search/search-app.js` 补上 `onChatChanged()`（换会话这条路径同样要对齐宿主源），
于是同一行字面量在文件里出现**两次**（render() 与 onChatChanged()）。mutate 的纪律是
「锚点须恰好命中 1 次」，于是它直接抛 —— 这条负控制**没跑起来**。

⚠ 这里**不许**顺手把「破坏两处」当等价：onChatChanged 是换会话路径，render 是打开面板路径，
两条路径都对齐才是对的。判据钉的是**打开面板**这一条（C1/C2 的探针走的就是 render）。
故锚点改为 render() 里那一段**独有**的注释 + 调用（恰好 1 次），破坏范围与判据面一致。

【用法】
    python3 tools/fix_v3580_anchor_v281.py            # dry-run
    python3 tools/fix_v3580_anchor_v281.py --write    # 落盘
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = 'tests/system-v281.test.mjs'

OLD = ("    const dir = mutate('no-sync', [\n"
       "        [APP_REL, '        this._syncHostSources();\\n', '']\n"
       "    ]);\n")
NEW = ("    const dir = mutate('no-sync', [\n"
       "        /* [v3.58.0 · 计划 O4] 锚点收回到 render() 那一处：O4 之后 onChatChanged() 也有\n"
       "         *   同一行「对齐宿主源」，裸行字面量会命中 2 次（mutate 直接抛，负控制跑不起来）。\n"
       "         *   两条路径都该对齐，判据钉的是**打开面板**这条（C1/C2 探针走 render），\n"
       "         *   故取 render() 独有的注释 + 调用一起锚定，破坏面与判据面一致。 */\n"
       "        [APP_REL, '        // [v2.81.0] 顺带对齐宿主侧源：宿主上下文刚就绪 / 刚换会话时，源表不能停在构造那一刻\\n'\n"
       "            + '        this._syncHostSources();\\n', '']\n"
       "    ]);\n")


def main():
    write = '--write' in sys.argv
    path = os.path.join(ROOT, TARGET)
    with open(path, encoding='utf-8') as fh:
        src = fh.read()
    n = src.count(OLD)
    if n != 1:
        print('BAD   %s 锚点命中 %d 次（应 1）' % (TARGET, n))
        sys.exit(1)
    out = src.replace(OLD, NEW, 1)
    if write:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(out)
        print('WRITE %s' % TARGET)
    else:
        print('DRY   %s（未写入，加 --write 落盘）' % TARGET)


if __name__ == '__main__':
    main()