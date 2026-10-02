#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# wire_v3470.py - v3.47.0 诊断案头六处接线
# 每处锚点先断言恰中 1 次，再替换；默认 dry-run，--write 才落盘。
import os
import sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv
NL = chr(10)

def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()

def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)

SEG = rd('apps/diagdesk/diagdesk.css')
assert SEG.count('.dd-root') >= 1
assert '诊断案头' in SEG

APPS_ANCHOR = NL + "];" + NL + "// 手机配置"
APPS_ITEM = """    // [v3.47.0] 诊断案头（素材缝合第 3 层第十一件）：缝 ST-MyriadKnots
    //   的准备阶段诊断片与迁识词表片、st_bs_biotracker 的存档迁移片
    //   （三片同族，合计 20613 字节 / 379 行）。
    //   只把这三种事**读成一张可对账的体检单**（总体判定 / 六态逐格 /
    //   缺失栏位 / 迁移逐版计划 / 流水线逐格 / 逐处诊断 / 摘要文本）。
    //   五块不缝：① **不往错误对象上挂旁路**（源用 WeakMap 把步骤名挂在 Error 实例上）；
    //   ② **不从堆栈里抠定位**（源解析 stack 取文件 / 行 / 列）；
    //   ③ **不往答案里编失败原因**（源的技术细节是按错误名硬编的几行中文）；
    //   ④ **不就地改存档**（源的迁移函数直接写对象）；
    //   ⑤ **不改写宿主的任何键**。
    //   六条偏离：① 空不等于说不清；② 说不清不等于没发生；
    //   ③ 缺栏位不等于 0；④ 自订值不许覆盖；⑤ 迁移不许越版；
    //   ⑥ 条数与状态不许矛盾。
    //   写盘三条键走 ^diagdesk_ 前缀随会话隔离（存档原文 / 摘要草稿 /
    //   动作台账三类分开存，源把三类全挂在宿主大对象上，换角色后一起串味）。
    //   ★ 本件**不挂错误对象、不改存档、不写宿主任何字段**（裁定不等于动手）。
    {
        id: 'diagdesk',
        name: '诊断案头',
        icon: '🩺',
        color: '#c9603f',
        badge: 0,
        data: {}
    },
"""

STOR_ANCHOR = "            /^cotdesk_/," + NL + "            /^musicdesk_/,"
STOR_NEW = ("            /^cotdesk_/," + NL
    + "            // [v3.47.0] 诊断案头（diagdesk_archive / diagdesk_draft /" + NL
    + "            //   diagdesk_ledger）：一条前缀覆盖三键，三条键均无元字符，" + NL
    + "            //   按仓内口径「无需宽匹配登记」。存档原文 / 摘要草稿 / 动作台账。" + NL
    + "            //   随会话隔离：源把存档本体、诊断上下文与迁移进度全挂在" + NL
    + "            //   宿主的大对象上（换角色后三类一起串味），" + NL
    + "            //   而放下一份存档顺手把已出的摘要也清了，源没有这一步。" + NL
    + "            /^diagdesk_/," + NL
    + "            /^musicdesk_/,")

KEYS_ANCHOR = "  { key: 'cotdesk_ledger', scope: 'chat', note: '[v3.46.0] 思维链案头动作台账（每一次收册 / 放下 / 改草稿 / 出文本的回执）' },"
KEYS_NEW = KEYS_ANCHOR + (
    NL + "  { key: 'diagdesk_archive', scope: 'chat', note: '[v3.47.0] 诊断案头存档原文（贴回的存档 + 收下时刻；读不出来与就是空不同形）' },"
    + NL + "  { key: 'diagdesk_draft', scope: 'chat', note: '[v3.47.0] 诊断案头摘要草稿（目标 + 追加要求）' },"
    + NL + "  { key: 'diagdesk_ledger', scope: 'chat', note: '[v3.47.0] 诊断案头动作台账（每一次收档 / 放下 / 存草稿 / 出文本的回执）' },"
)

IDX_BRANCH_ANCHOR = "                } else if (appId === 'musicdesk') {"
IDX_BRANCH_NEW = """                } else if (appId === 'diagdesk') {
                    // [v3.47.0] 诊断案头：缝合自 ST-MyriadKnots 的准备阶段诊断片
                    //   与迁识词表片、st_bs_biotracker 的存档迁移片（三片同族，
                    //   合计 20613 字节 / 379 行）。
                    //   取四块治理面：版本面（读不出来不读成 1）/ 六态逐格计数
                    //   （认不出的另立一格）/ 增量四态与条数互相成立 /
                    //   栏位体检（缺栏位不读 0）/ 迁移逐版计划（自订值不动）/
                    //   十一步流水线逐格回执 / 摘要文本产出（本件唯一的产出物）。
                    //   五块不缝：不往错误对象上挂旁路（源用 WeakMap）；
                    //   不从堆栈里抠定位（源解析 stack）；
                    //   不往答案里编失败原因（源按错误名硬编几行中文）；
                    //   不就地改存档（源的迁移函数直接写对象）；
                    //   不改写宿主的任何键。
                    //   六条偏离：空不等于说不清；说不清不等于没发生；
                    //   缺栏位不等于 0；自订值不许覆盖；迁移不许越版；
                    //   条数与状态不许矛盾。
                    //   ★ 本件**不挂错误对象、不改存档、不写宿主任何字段**（裁定不等于动手）。
                    //   写盘三条键走 ^diagdesk_ 前缀随会话隔离。
                    bootTiming.instrumentImport(import('./apps/diagdesk/diagdesk-app.js'), './apps/diagdesk/diagdesk-app.js')
                        .then(module => {
                            if (!window.VirtualPhone.diagdeskApp) {
                                window.VirtualPhone.diagdeskApp = new module.DiagdeskApp(phoneShell, storage);
                            }
                            window.VirtualPhone.diagdeskApp.render();
                        })
                        .catch(err => {
                            console.error('❌ 加载诊断案头App失败:', err);
                            phoneShell?.showNotification('错误', '诊断案头App加载失败', '❌');
                        });
""" + IDX_BRANCH_ANCHOR

FORM_LINE = """
    'diagdeskApp',    // [v3.47.0] 诊断案头：有表单字段（贴回的存档原文 / 摘要的追加要求）
                      //             与三项上限，且存档原文 / 摘要草稿 / 动作台账
                      //             全是「这段关系的账」—— 换会话必须三格全量重取
                      //             （源把存档本体、诊断上下文与迁移进度
                      //             全挂在宿主的大对象上，换角色后三类一起串味，
                      //             而放下一份存档顺手把已出的摘要也清了，源没有这一步）
"""

def insert_form(s):
    key = "    'cotdeskApp',"
    assert s.count(key) == 1, 'cotdeskApp 登记必须恰 1 处，实得 %d' % s.count(key)
    i = s.index(key)
    j = s.index(NL + '];', i)
    return s[:j] + FORM_LINE + s[j:]

PHONE_ANCHOR = "/* ══════════════ [v3.46.0] 思维链案头（cotdesk） ══════════════ */"
PHONE_NEW = ("/* ══════════════ [v3.47.0] 诊断案头（diagdesk） ══════════════ */" + NL
            + SEG.rstrip(NL) + NL + PHONE_ANCHOR)

V255_LINE_PREFIX = "    cotdeskApp: 'cotdesk'"
V255_LINE_CLEAN = ("    cotdeskApp: 'cotdesk',      // [v3.46.0] 思维链案头：换会话丢贴回的条目册与配置与要求文本草稿，条目册 / 配置 / 要求草稿 / 动作台账四格全量重取")
V255_LINE_ADD = ("    diagdeskApp: 'diagdesk'    // [v3.47.0] 诊断案头：换会话丢贴回的存档与摘要草稿，存档原文 / 摘要草稿 / 动作台账三格全量重取")

def fix_v255(s):
    lines = s.split(NL)
    idx = [i for i, l in enumerate(lines) if l.startswith(V255_LINE_PREFIX)]
    assert len(idx) == 1, '[v255 dirMap] cotdeskApp 行必须恰 1 行，实得 %d' % len(idx)
    i = idx[0]
    assert "diagdeskApp" not in s, '[v255 dirMap] 新行已存在，不可重复插入'
    lines[i:i+1] = [V255_LINE_CLEAN, V255_LINE_ADD]
    return NL.join(lines)

EDITS = []

def edit(rel, old, new, tag):
    EDITS.append((rel, old, new, tag))

edit('config/apps.js', APPS_ANCHOR, APPS_ITEM + APPS_ANCHOR, 'apps 新增一项')
edit('config/storage.js', STOR_ANCHOR, STOR_NEW, 'storage 新增前缀')
edit('scripts/keys-audit.mjs', KEYS_ANCHOR, KEYS_NEW, 'keys 三条登记')
edit('index.js', IDX_BRANCH_ANCHOR, IDX_BRANCH_NEW, 'index 懒加载分支')
edit('phone.css', PHONE_ANCHOR, PHONE_NEW, 'phone.css 本版段')

by_file = {}
for rel, old, new, tag in EDITS:
    by_file.setdefault(rel, []).append((old, new, tag))

out = {}
for rel, ops in by_file.items():
    s = rd(rel)
    for old, new, tag in ops:
        s = once(s, old, new, rel + ' / ' + tag)
    out[rel] = s

out['index.js'] = insert_form(out['index.js'])
out['tests/system-v255.test.mjs'] = fix_v255(rd('tests/system-v255.test.mjs'))

print('== dry-run 摘要 ==')
for rel, ops in sorted(by_file.items()):
    print('  %s: %d 处' % (rel, len(ops)))
print('  phone.css 段长 %d 字节 / %d 行' % (len(SEG.encode('utf-8')), SEG.count(NL)))
print('  index.js 挂载恰 1 处: %s' % (out['index.js'].count('window.VirtualPhone.diagdeskApp = new module.DiagdeskApp') == 1))
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
for rel, s in out.items():
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)
print('已落盘 %d 份' % len(out))
