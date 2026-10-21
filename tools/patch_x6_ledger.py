#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""[v4.46.0 · R5-X6] 补 SR_LIMITS.ledger 的真消费点（本仓主线：功能级失效）。

实测缺口：`config/setting-rewrite-contract.js` 的 `SR_LIMITS` 声明
    `ledger: 40  // 本机台账最多留几次改写`
而全仓消费点只有 `refs`（memory-app 两处）与 `label`（契约件一处）——
`ledger` **零调用**：台账可以无限长，读数里的「本机记了 N 次」会被永久累积刷大，
注释声明的纪律在代码里根本不存在（本仓治过的「导出了 API 但全库零调用」形态）。

修法：在 `settingImpactConfirm` 落盘前裁剪到上限，且**丢最旧必须说出来**
（静默丢会让用户回读时把「被裁掉」读成「本来就没记过」，两者处置相反）。
"""
import ast
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "apps", "memory", "memory-app.js")

ANCHOR = """      note = gate.line;
    }
    const saved = this._srLedgerSave(ledger);
    s.note = saved ? note : (note + '；但台账**没写进去**（存储不可用）—— 重开查不到这一次');
"""
PATCH = """      note = gate.line;
    }
    /* [v4.46.0 · R5-X6] 台账上限（`SR_LIMITS.ledger`）：本机只留最近 N 次改写。
       ★ 丢最旧这件事必须**说出来**：静默丢会让用户回读时把「被裁掉的那几次」
       读成「本来就没记过」—— 而两者处置相反（没记过 ⇒ 重做一次；
       记过但已不在本机 ⇒ 那份决定已经回不来了）。
       裁剪只在**超出上限**时发生，且只动最旧的那些，不动这一次。 */
    let trimmed = 0;
    while (ledger.entries.length > SR_LIMITS.ledger) { ledger.entries.shift(); trimmed += 1; }
    if (trimmed) {
        note = note + '；本机台账只留最近 ' + SR_LIMITS.ledger + ' 次改写，**丢了最旧的 '
            + trimmed + ' 次**（重开看不到那几次了）';
    }
    const saved = this._srLedgerSave(ledger);
"""


def main():
    write = "--write" in sys.argv[1:]
    with open(APP, encoding="utf-8") as fh:
        src = fh.read()
    n = src.count(ANCHOR)
    if n != 1:
        print("锚点必须恰中 1 次（实测 " + str(n) + " 次）")
        return 1
    if src.count("SR_LIMITS.ledger") > 0:
        print("已经补过（SR_LIMITS.ledger 已在场），无需再改。")
        return 0
    new = src.replace(ANCHOR, PATCH)
    # 语法自证：这是 JS 文件，必须用 node --check（本仓踩过 heredoc 截断 / 补丁写坏）。
    import subprocess
    import tempfile
    with tempfile.NamedTemporaryFile('w', suffix='.mjs', delete=False, encoding='utf-8') as tmp:
        tmp.write(new)
        tmp_path = tmp.name
    try:
        r = subprocess.run(['node', '--check', tmp_path], capture_output=True, text=True)
        if r.returncode != 0:
            print("补丁后语法不通过：\n" + (r.stderr or '')[:800])
            return 1
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    if not write:
        print("dry-run：将插入 " + str(len(PATCH)) + " 字，未落盘（加 --write）")
        return 0
    with open(APP, "w", encoding="utf-8") as fh:
        fh.write(new)
    print("OK 已补 SR_LIMITS.ledger 消费点。")
    return 0


if __name__ == "__main__":
    sys.exit(main())