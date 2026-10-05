#!/usr/bin/env python3
"""wire_v3580_receipt3.py — [v3.58.0 · 计划 O5] 动作口的三处回执失真（第三批）。

【本批治的形态】前两批都只治「写包装怎么读返回值」。本批治的是**读对了却报错**：

  ① 多键丢结果：一次动作落好几条键，前一次的结果**直接丢掉**、saved 只看最后一条 ——
     「正文没落下去、投影落下了」在界面上完全等于成功。
  ② 硬编码成功：_receipt(...) 内部**自己落盘**（台账键），而动作口写到 _savedOk(...) 里的
     是**字面 true** —— 台账落没落，动作口压根不知道。
  ③ 收下原文这一刀同时落两条键（原文键 + 台账键），此前只报后者。

【口径】collectReceipt(rows) 的 saved = **全部**键都落了。此处 _savedOk 相应放宽为
「布尔或完成范围皆可」—— 布尔仍表示「一次单键写落没落」，完成范围表示「这次动作整个落没落」。

【用法】
    python3 tools/wire_v3580_receipt3.py            # dry-run
    python3 tools/wire_v3580_receipt3.py --write    # 落盘
每处替换都断言旧锚点恰中 1 次，不唯一即整件跳过并报出。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMP = "import { writeReceipt } from '../../config/write-receipt.js';"
IMP2 = "import { writeReceipt, collectReceipt } from '../../config/write-receipt.js';"

SCOPE = """
    /** 把「本动作落的那几条键」收成一份**完成范围**回执（唯一实现见 config/write-receipt.js）。
     *  ★ 只报最后一条键是本版治的形态：前一条没落下去时界面照样显示成功，
     *    下次打开就出现「正文没了、投影还在」这种两边对不上的状态。 */
    _writeScope(rows) {
        return collectReceipt(rows);
    }"""

SAVEDOK_OLD = """    _savedOk(wrote) {
        return { saved: wrote === true, storage: this._storageUsable().ok };
    }"""
SAVEDOK_NEW = """    _savedOk(wrote) {
        /* [v3.58.0 · 计划 O5] 既收单键布尔（writeReceipt 的 saved），也收多键**完成范围**
         *   （collectReceipt 的返回）：多键时 saved 表示「本动作落的那几条键全落了」。 */
        const ok = (wrote && typeof wrote === 'object') ? wrote.saved === true : wrote === true;
        return { saved: ok, storage: this._storageUsable().ok };
    }""" + SCOPE

# _receipt：把台账那条键的落盘结果回出去
RECEIPT_OLD = """        this._dropped += t.dropped;
        this._persistLedger();
        return row;
    }"""


def receipt_new(note):
    return ("""        this._dropped += t.dropped;
        const wl = this._persistLedger();
        /* [v3.58.0 · 计划 O5] 台账那条键的落盘结果**必须回出去**：动作口的 saved 要算上它，
         *   此前台账落没落只有本函数知道，而调用方报的是字面 true。 */
        row.saved = wl === true;
        return row;
    }""".replace('*   此前台账落没落只有本函数知道，而调用方报的是字面 true。', note))


def scope_rows(keys, pre, extra):
    """生成完成范围块（本脚本内未用，保留作后续批次的模板）。"""
    lines = ["        const %s = this._writeScope([" % pre]
    for i, (name, var, payload) in enumerate(keys):
        tail = '])' if i == len(keys) - 1 else ']),'
        lines.append("            { key: '%s', ok: %s === true, why: %s === true ? '' : 'set_false' }%s" % (name, var, var, tail))
    return '\n'.join(lines)


PLAN = {}

# ---------------- cotdesk ----------------
cot = [(IMP, IMP2),
       (RECEIPT_OLD, receipt_new('*   此前台账落没落只有本函数知道，而调用方报的是字面 true。')),
       (SAVEDOK_OLD, SAVEDOK_NEW)]
# 逐条显式写（锚点唯一性靠此处字面：收下原文/清空的那两段代码不同）
cot.append(("""        this._raw = raw;
        this._rawAt = this._now;
        this._persistItems();
        this.probe();
        this._receipt('items_ingest', true, '', { n: ex.total });
        return Object.assign(this._savedOk(true), { ok: true, items: ex.total });""",
            """        this._raw = raw;
        this._rawAt = this._now;
        const wItems = this._persistItems();
        this.probe();
        const rcI = this._receipt('items_ingest', true, '', { n: ex.total });
        /* 这一刀落两条键：册子原文 + 台账。**两条都算** —— 只报后者就是「原文丢了也报成功」。 */
        const wrI = this._writeScope([
            { key: 'items', ok: wItems === true, why: wItems === true ? '' : 'set_false' },
            { key: 'ledger', ok: rcI.saved === true, why: rcI.saved === true ? '' : 'set_false' }
        ]);
        return Object.assign(this._savedOk(wrI), { ok: true, items: ex.total });"""))
cot.append(("""        this._raw = '';
        this._rawAt = 0;
        this._persistItems();
        this.probe();
        this._receipt('items_clear', true, '', { n: had });
        return Object.assign(this._savedOk(true), { ok: true, cleared: had });""",
            """        this._raw = '';
        this._rawAt = 0;
        const wItemsC = this._persistItems();
        this.probe();
        const rcIC = this._receipt('items_clear', true, '', { n: had });
        /* 清空同样落两条键（清原文 + 补一笔台账）。 */
        const wrIC = this._writeScope([
            { key: 'items', ok: wItemsC === true, why: wItemsC === true ? '' : 'set_false' },
            { key: 'ledger', ok: rcIC.saved === true, why: rcIC.saved === true ? '' : 'set_false' }
        ]);
        return Object.assign(this._savedOk(wrIC), { ok: true, cleared: had });"""))
cot.append(("""        this._cfgRaw = raw;
        this._cfgAt = this._now;
        this._persistConfig();
        this.probe();
        this._receipt('config_ingest', true, '', { n: 0 });
        return Object.assign(this._savedOk(true), { ok: true, mode: this._mode });""",
            """        this._cfgRaw = raw;
        this._cfgAt = this._now;
        const wCfg = this._persistConfig();
        this.probe();
        const rcC = this._receipt('config_ingest', true, '', { n: 0 });
        const wrC = this._writeScope([
            { key: 'config', ok: wCfg === true, why: wCfg === true ? '' : 'set_false' },
            { key: 'ledger', ok: rcC.saved === true, why: rcC.saved === true ? '' : 'set_false' }
        ]);
        return Object.assign(this._savedOk(wrC), { ok: true, mode: this._mode });"""))
cot.append(("""        this._cfgRaw = '';
        this._cfgAt = 0;
        this._persistConfig();
        this.probe();
        this._receipt('config_clear', true, '', { n: had });
        return Object.assign(this._savedOk(true), { ok: true, cleared: had });""",
            """        this._cfgRaw = '';
        this._cfgAt = 0;
        const wCfgC = this._persistConfig();
        this.probe();
        const rcCC = this._receipt('config_clear', true, '', { n: had });
        const wrCC = this._writeScope([
            { key: 'config', ok: wCfgC === true, why: wCfgC === true ? '' : 'set_false' },
            { key: 'ledger', ok: rcCC.saved === true, why: rcCC.saved === true ? '' : 'set_false' }
        ]);
        return Object.assign(this._savedOk(wrCC), { ok: true, cleared: had });"""))
PLAN['apps/cotdesk/cotdesk-app.js'] = cot

# ---------------- diagdesk ----------------
dd = [(IMP, IMP2),
      (RECEIPT_OLD, receipt_new('*   此前台账落没落只有本函数知道，而调用方报的是字面 true。')),
      (SAVEDOK_OLD, SAVEDOK_NEW)]
dd.append(("""        this._raw = raw;
        this._rawAt = this._now;
        this._persistArchive();
        this.probe();
        this._receipt('archive_ingest', true, '', { n: raw.length });
        return Object.assign(this._savedOk(true), { ok: true, chars: raw.length });""",
            """        this._raw = raw;
        this._rawAt = this._now;
        const wArc = this._persistArchive();
        this.probe();
        const rcA = this._receipt('archive_ingest', true, '', { n: raw.length });
        /* 这一刀落两条键：存档原文 + 台账。**两条都算**。 */
        const wrA = this._writeScope([
            { key: 'archive', ok: wArc === true, why: wArc === true ? '' : 'set_false' },
            { key: 'ledger', ok: rcA.saved === true, why: rcA.saved === true ? '' : 'set_false' }
        ]);
        return Object.assign(this._savedOk(wrA), { ok: true, chars: raw.length });"""))
dd.append(("""        this._raw = '';
        this._rawAt = 0;
        this._persistArchive();
        this.probe();
        this._receipt('archive_clear', true, '', { n: had });
        return Object.assign(this._savedOk(true), { ok: true, cleared: had });""",
            """        this._raw = '';
        this._rawAt = 0;
        const wArcC = this._persistArchive();
        this.probe();
        const rcAC = this._receipt('archive_clear', true, '', { n: had });
        const wrAC = this._writeScope([
            { key: 'archive', ok: wArcC === true, why: wArcC === true ? '' : 'set_false' },
            { key: 'ledger', ok: rcAC.saved === true, why: rcAC.saved === true ? '' : 'set_false' }
        ]);
        return Object.assign(this._savedOk(wrAC), { ok: true, cleared: had });"""))
dd.append(("""        this._ledger = [];
        this._dropped = 0;
        this._persistLedger();
        this._receipt('ledger_clear', true, '', { n: had });
        return Object.assign(this._savedOk(true), { ok: true, cleared: had, archiveKept: this._raw.length });""",
            """        this._ledger = [];
        this._dropped = 0;
        const wLed = this._persistLedger();
        const rcL = this._receipt('ledger_clear', true, '', { n: had });
        /* 清台账这一刀也落两条：清掉后的台账 + 之后补记的那一笔。 */
        const wrL = this._writeScope([
            { key: 'ledger', ok: wLed === true, why: wLed === true ? '' : 'set_false' },
            { key: 'ledger_tail', ok: rcL.saved === true, why: rcL.saved === true ? '' : 'set_false' }
        ]);
        return Object.assign(this._savedOk(wrL), { ok: true, cleared: had, archiveKept: this._raw.length });"""))
PLAN['apps/diagdesk/diagdesk-app.js'] = dd


def main():
    write = '--write' in sys.argv
    total = 0
    for rel, pairs in PLAN.items():
        path = os.path.join(ROOT, rel)
        with open(path, encoding='utf-8') as fh:
            src = fh.read()
        out = src
        bad = False
        for old, new in pairs:
            n = out.count(old)
            if n != 1:
                print('SKIP  %-32s 锚点命中 %d 次（应 1）：%s' % (rel, n, old.splitlines()[0][:44]))
                bad = True
                break
            out = out.replace(old, new, 1)
        if bad:
            continue
        if write:
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(out)
            print('WRITE %-32s %d 处替换' % (rel, len(pairs)))
        else:
            print('DRY   %-32s %d 处替换' % (rel, len(pairs)))
        total += 1
    print('--- %s：%d/%d 件%s' % ('已落盘' if write else '可落盘', total, len(PLAN),
                                  '' if write else '（未写入，加 --write 落盘）'))


if __name__ == '__main__':
    main()