#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# wire_v3460.py - v3.46.0 思维链案头六处接线
# 每处锚点先断言恰中 1 次，再替换；默认 dry-run，--write 才落盘。
#   ① config/apps.js：APPS 末尾插一项（id: cotdesk）
#   ② config/storage.js：CHAT_DATA_PATTERNS 插 /^cotdesk_/ 一条
#   ③ scripts/keys-audit.mjs：四条键登记（scope: chat）
#   ④ index.js：懒加载分支 + 挂载（恰一处） + 表单字段登记表
#   ⑤ phone.css：本版段（段头独立成行，与 cotdesk.css 逐字同源）
#   ⑥ tests/system-v255.test.mjs：dirMap 补一项
import os
import sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = '--write' in sys.argv

def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()
def once(s, old, new, tag):
    n = s.count(old)
    assert n == 1, '[%s] 锚点必须恰中 1 次，实得 %d' % (tag, n)
    return s.replace(old, new, 1)

SEG = rd('apps/cotdesk/cotdesk.css')
assert SEG.count('.cd-root') >= 1
assert '\u601d\u7ef4\u94fe\u6848\u5934' in SEG

APPS_ANCHOR = '\n];\n// \u624b\u673a\u914d\u7f6e'
APPS_ITEM = (
    "    // [v3.46.0] \u601d\u7ef4\u94fe\u6848\u5934\uff08\u7d20\u6750\u7f1d\u5408\u7b2c 3 \u5c42\u7b2c\u5341\u4ef6\uff09\uff1a\u7f1d EPhone\u00b7xintuk\n"
    "    //   \u601d\u7ef4\u94fe\u6ce8\u5165\u5185\u6838\u7247\u4e0e UwU \u601d\u7ef4\u94fe\u8bbe\u7f6e\u7247\uff08\u4e24\u7247\u540c\u65cf\uff0c\u5408\u8ba1 95292 \u5b57\u8282 / 1993 \u884c\uff09\u3002\n"
    "    //   \u53ea\u628a**\u4e00\u4efd\u6761\u76ee\u518c**\u6536\u62fe\u6210\u53ef\u5bf9\u8d26\u7684\u8d26\uff08\u6761\u76ee / \u843d\u70b9 / \u63a5\u53e3 /\n"
    "    //   \u9501\u5b9a / \u5b57\u6570\uff09\uff0c\u4ea7\u53ef\u590d\u5236\u7684\u8981\u6c42\u6587\u672c\uff08requestText\uff09\u3002\n"
    "    //   \u56db\u5757\u4e0d\u7f1d\uff1a\u2460 **\u4e0d\u6539\u5199\u5bbf\u4e3b\u63d0\u793a\u8bcd**\uff08\u6e90\u81ea\u5df1\u62fc\u7cfb\u7edf\u63d0\u793a\u4e0e\u6d88\u606f\u6570\u7ec4\uff09\uff1b\n"
    "    //   \u2461 **\u4e0d\u53d1\u8bf7\u6c42\u4e0d\u585e\u53c2\u6570**\uff08\u6e90\u5199\u63a8\u7406\u5f3a\u5ea6 / \u601d\u8003\u9884\u7b97 / \u989d\u5916\u8bf7\u6c42\u4f53\uff09\uff1b\n"
    "    //   \u2462 **\u4e0d\u62a0\u6b63\u6587**\uff08\u6e90\u6309\u8d77\u6b62\u6807\u8bb0\u4ece\u56de\u590d\u91cc\u622a\u51fa\u601d\u8003\u6bb5\u5e76\u5220\u6389\uff09\uff1b\n"
    "    //   \u2463 **\u4e0d\u8bfb\u5bbf\u4e3b\u754c\u9762\u5143\u7d20**\uff08\u6e90\u6ee1\u7bc7\u76f4\u8bfb\u5bbf\u4e3b\u5143\u7d20\uff09\u3002\n"
    "    //   \u56db\u6761\u504f\u79bb\uff1a\u2460 \u4f4d\u7f6e\u4e0d\u8bb8\u5854\u5e73\uff08\u6e90\u91cc\u9996\u90e8\u4e0e\u4e2d\u6bb5\u7684\u975e\u7cfb\u7edf\u6761\u76ee\u843d\u6210\u540c\u4e00\u5904\uff09\uff1b\n"
    "    //   \u2461 \u7b56\u7565\u4e0d\u8bb8\u731c\uff08\u6e90\u6309\u6a21\u578b\u540d\u731c\u672b\u5c3e\u9884\u586b\u7b56\u7565\uff0c\u731c\u4e0d\u51fa\u5c31\u9ed8\u8ba4\u52a9\u624b\u9884\u586b\uff09\uff1b\n"
    "    //   \u2462 \u53c2\u6570\u4e0d\u8bb8\u9759\u9ed8\u4e22\uff08\u6e90\u5bf9\u8ba4\u4e0d\u51fa\u7684\u63a5\u53e3\u628a\u601d\u8003\u53c2\u6570\u6574\u5757\u4e22\u6389\uff09\uff1b\n"
    "    //   \u2463 \u9501\u5b9a\u4e0d\u8bb8\u4e24\u8fb9\u4e0d\u540c\u5f62\uff08\u6e90\u88c5\u8f7d\u65f6\u8fd8\u6709\u4e00\u6bb5\u9759\u9ed8\u89e3\u9501\uff09\u3002\n"
    "    //   \u5199\u76d8\u56db\u6761\u952e\u8d70 ^cotdesk_ \u524d\u7f00\u968f\u4f1a\u8bdd\u9694\u79bb\uff08\u6761\u76ee\u518c / \u914d\u7f6e /\n"
    "    //   \u8981\u6c42\u8349\u7a3f / \u52a8\u4f5c\u53f0\u8d26\u56db\u7c7b\u5206\u5f00\u5b58\uff0c\u6e90\u628a\u56db\u7c7b\u5168\u585e\u8fdb\n"
    "    //   \u4e00\u4e2a\u5bbf\u4e3b\u5927\u5bf9\u8c61\uff0c\u6362\u89d2\u8272\u540e\u4e00\u8d77\u4e32\u5473\uff09\u3002\n"
    "    //   \u2605 \u672c\u4ef6**\u4e0d\u53d1\u8bf7\u6c42\u3001\u4e0d\u6539\u63d0\u793a\u8bcd\u3001\u4e0d\u62a0\u6b63\u6587\u3001\u4e0d\u6ce8\u5165\u6761\u76ee**\uff08\u88c1\u5b9a\u4e0d\u7b49\u4e8e\u6ce8\u5165\uff09\u3002\n"
    "    {\n"
    "        id: 'cotdesk',\n"
    "        name: '\u601d\u7ef4\u94fe\u6848\u5934',\n"
    "        icon: '\U0001F9E0',\n"
    "        color: '#7b8ce0',\n"
    "        badge: 0,\n"
    "        data: {}\n"
    "    },\n"
)

STOR_ANCHOR = '            /^archive_/,\n            /^musicdesk_/,'
STOR_NEW = (
    '            /^archive_/,\n'
    '            // [v3.46.0] \u601d\u7ef4\u94fe\u6848\u5934\uff08cotdesk_items / cotdesk_config /\n'
    '            //   cotdesk_draft / cotdesk_ledger\uff09\uff1a\u4e00\u6761\u524d\u7f00\u8986\u76d6\u56db\u952e\uff0c\u56db\u6761\u952e\u5747\u65e0\u5143\u5b57\u7b26\uff0c\n'
    '            //   \u6309\u4ed3\u5185\u53e3\u5f84\u300c\u65e0\u9700\u5bbd\u5339\u914d\u767b\u8bb0\u300d\u3002\u6761\u76ee\u518c / \u914d\u7f6e / \u8981\u6c42\u8349\u7a3f / \u52a8\u4f5c\u53f0\u8d26\u3002\n'
    '            //   \u968f\u4f1a\u8bdd\u9694\u79bb\uff1a\u6e90\u628a\u6761\u76ee\u518c\u3001\u9884\u8bbe\u3001\u56db\u5904\u5f00\u5173\u4e0e\u9884\u586b\u7b56\u7565\n'
    '            //   \u5168\u585e\u8fdb**\u4e00\u4e2a\u5bbf\u4e3b\u5927\u5bf9\u8c61**\u91cc\uff08\u6362\u89d2\u8272\u540e\u56db\u7c7b\u4e00\u8d77\u4e32\u5473\uff0c\n'
    '            //   \u800c\u5173\u6389\u601d\u8003\u603b\u5f00\u5173\u987a\u624b\u628a\u5df2\u6536\u7684\u6761\u76ee\u518c\u4e5f\u6e05\u4e86\uff09\uff0c\u6e90\u6ca1\u6709\u8fd9\u4e00\u6b65\u3002\n'
    '            /^cotdesk_/,\n'
    '            /^musicdesk_/,'
)

KEYS_ANCHOR = "{ key: 'archive_ledger', scope: 'chat', note: '[v3.45.0] \u5b58\u6863\u53f0\u52a8\u4f5c\u53f0\u8d26\uff08\u6bcf\u4e00\u6b21\u6536\u5305 / \u653e\u4e0b / \u6539\u8349\u7a3f / \u51fa\u6587\u672c\u7684\u56de\u6267\uff09' },"
KEYS_NEW = KEYS_ANCHOR + (
    "\n  { key: 'cotdesk_items', scope: 'chat', note: '[v3.46.0] \u601d\u7ef4\u94fe\u6848\u5934\u6761\u76ee\u518c\uff08\u8d34\u56de\u7684\u6761\u76ee\u539f\u6587 + \u6536\u4e0b\u65f6\u523b\uff1b\u7a7a\u518c\u4e0e\u6ca1\u518c\u4e0d\u540c\u5f62\uff09' },"
    "\n  { key: 'cotdesk_config', scope: 'chat', note: '[v3.46.0] \u601d\u7ef4\u94fe\u6848\u5934\u914d\u7f6e\uff08\u6a21\u5f0f / \u63a5\u53e3 / \u539f\u751f\u5f3a\u5ea6 / \u672b\u5c3e\u9884\u586b\u56db\u683c\uff1b\u56db\u6001\u9762\u5206\u5f00\uff09' },"
    "\n  { key: 'cotdesk_draft', scope: 'chat', note: '[v3.46.0] \u601d\u7ef4\u94fe\u6848\u5934\u8981\u6c42\u6587\u672c\u8349\u7a3f\uff08\u76ee\u6807 + \u8ffd\u52a0\u8981\u6c42\uff09' },"
    "\n  { key: 'cotdesk_ledger', scope: 'chat', note: '[v3.46.0] \u601d\u7ef4\u94fe\u6848\u5934\u52a8\u4f5c\u53f0\u8d26\uff08\u6bcf\u4e00\u6b21\u6536\u518c / \u653e\u4e0b / \u6539\u8349\u7a3f / \u51fa\u6587\u672c\u7684\u56de\u6267\uff09' },"
)

IDX_BRANCH_ANCHOR = "                } else if (appId === 'musicdesk') {"
IDX_BRANCH_NEW = (
    "                } else if (appId === 'cotdesk') {\n"
    "                    // [v3.46.0] \u601d\u7ef4\u94fe\u6848\u5934\uff1a\u7f1d\u5408\u81ea EPhone\u00b7xintuk \u7684\u601d\u7ef4\u94fe\u6ce8\u5165\u5185\u6838\n"
    "                    //   \u4e0e UwU \u7684\u601d\u7ef4\u94fe\u8bbe\u7f6e\u7247\uff08\u4e24\u7247\u540c\u65cf\uff0c\u5408\u8ba1 95292 \u5b57\u8282 / 1993 \u884c\uff09\u3002\n"
    "                    //   \u53d6\u56db\u5757\u6cbb\u7406\u9762\uff1a\u6761\u76ee\u5f52\u4e00\u4e0e\u9010\u6761\u5bf9\u8d26\uff08\u4f4d\u7f6e \u00d7 \u89d2\u8272\n"
    "                    //   \u2192 \u516d\u4fa7\u771f\u503c\u8868\uff0c\u5854\u5e73\u5355\u72ec\u6807\uff09/ \u6df1\u5ea6\u94b3\u4f4d\u4e0e\u53d6\u4e0d\u51fa\u6765\u4e0d\u8bfb 0 /\n"
    "                    //   \u63a5\u53e3\u56db\u6001\uff08\u5199\u660e\u7684 / \u731c\u51fa\u7684 / \u5224\u4e0d\u51fa / \u58f0\u660e\u4e0d\u8ba4\uff09\u4e0e\u539f\u751f\u5b57\u6bb5\u9010\u63a5\u53e3\u5217 /\n"
    "                    //   \u9501\u5b9a\u4e24\u4e2a\u8bed\u4e49\uff08\u6570\u636e\u5b57\u6bb5 + \u754c\u9762\u7981\u4ee4\uff09/ \u6b63\u6587\u6807\u8bb0\u53ea\u6570\u4e0d\u6539\u5199 /\n"
    "                    //   \u8981\u6c42\u6587\u672c\u4ea7\u51fa\uff08\u672c\u4ef6\u552f\u4e00\u7684\u4ea7\u51fa\u7269\uff09\u3002\n"
    "                    //   \u56db\u5757\u4e0d\u7f1d\uff1a\u4e0d\u6539\u5199\u5bbf\u4e3b\u63d0\u793a\u8bcd\uff08\u6e90\u81ea\u62fc\u7cfb\u7edf\u63d0\u793a\u4e0e\u6d88\u606f\u6570\u7ec4\uff09\uff1b\n"
    "                    //   \u4e0d\u53d1\u8bf7\u6c42\u4e0d\u585e\u53c2\u6570\uff08\u6e90\u5199\u63a8\u7406\u5f3a\u5ea6 / \u601d\u8003\u9884\u7b97 / \u989d\u5916\u8bf7\u6c42\u4f53\uff09\uff1b\n"
    "                    //   \u4e0d\u62a0\u6b63\u6587\uff08\u6e90\u6309\u8d77\u6b62\u6807\u8bb0\u622a\u51fa\u601d\u8003\u6bb5\u5e76\u5220\u6b63\u6587\uff09\uff1b\n"
    "                    //   \u4e0d\u8bfb\u5bbf\u4e3b\u754c\u9762\u5143\u7d20\uff08\u6e90\u6ee1\u7bc7\u76f4\u8bfb\u5bbf\u4e3b\u5143\u7d20\uff09\u3002\n"
    "                    //   \u56db\u6761\u504f\u79bb\uff1a\u4f4d\u7f6e\u4e0d\u8bb8\u5854\u5e73\uff1b\u7b56\u7565\u4e0d\u8bb8\u731c\uff1b\u53c2\u6570\u4e0d\u8bb8\u9759\u9ed8\u4e22\uff1b\n"
    "                    //   \u9501\u5b9a\u4e0d\u8bb8\u4e24\u8fb9\u4e0d\u540c\u5f62\u3002\n"
    "                    //   \u2605 \u672c\u4ef6**\u4e0d\u53d1\u8bf7\u6c42\u3001\u4e0d\u6539\u63d0\u793a\u8bcd\u3001\u4e0d\u62a0\u6b63\u6587\u3001\u4e0d\u6ce8\u5165\u6761\u76ee**\uff08\u88c1\u5b9a\u4e0d\u7b49\u4e8e\u6ce8\u5165\uff09\u3002\n"
    "                    //   \u5199\u76d8\u56db\u6761\u952e\u8d70 ^cotdesk_ \u524d\u7f00\u968f\u4f1a\u8bdd\u9694\u79bb\u3002\n"
    "                    bootTiming.instrumentImport(import('./apps/cotdesk/cotdesk-app.js'), './apps/cotdesk/cotdesk-app.js')\n"
    "                        .then(module => {\n"
    "                            if (!window.VirtualPhone.cotdeskApp) {\n"
    "                                window.VirtualPhone.cotdeskApp = new module.CotdeskApp(phoneShell, storage);\n"
    "                            }\n"
    "                            window.VirtualPhone.cotdeskApp.render();\n"
    "                        })\n"
    "                        .catch(err => {\n"
    "                            console.error('\u274c \u52a0\u8f7d\u601d\u7ef4\u94fe\u6848\u5934App\u5931\u8d25:', err);\n"
    "                            phoneShell?.showNotification('\u9519\u8bef', '\u601d\u7ef4\u94fe\u6848\u5934App\u52a0\u8f7d\u5931\u8d25', '\u274c');\n"
    "                        });\n"
    + IDX_BRANCH_ANCHOR
)

FORM_LINE = (
    "\n"
    "    'cotdeskApp',    // [v3.46.0] 思维链案头：有表单字段（贴回的条目册与配置 / 要求文本的目标与追加要求）\n"
    "                     //             与三项上限，且条目册 / 配置 / 要求草稿 / 动作台账\n"
    "                     //             全是「这段关系的账」—— 换会话必须四格全量重取\n"
    "                     //             （源把条目册、预设、四处开关与预填策略全塞进\n"
    "                     //             **一个宿主大对象**里，换角色后四类一起串味，\n"
    "                     //             而关掉思考总开关顺手把已收的条目册也清了，源没有这一步）"
)

def insert_form(s):
    key = "    'archiveApp',"
    assert s.count(key) == 1, 'archiveApp 登记必须恰 1 处，实得 %d' % s.count(key)
    i = s.index(key)
    j = s.index('\n];', i)
    return s[:j] + FORM_LINE + s[j:]

PHONE_ANCHOR = '/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 [v3.45.0] \u5b58\u6863\u53f0\uff08archive\uff09 \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */'
PHONE_NEW = ('/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 [v3.46.0] \u601d\u7ef4\u94fe\u6848\u5934\uff08cotdesk\uff09 \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */\n'
            + SEG.rstrip('\n') + '\n' + PHONE_ANCHOR)

V255_ANCHOR = "    archiveApp: 'archive'"
V255_NEW = (V255_ANCHOR +
    ",      // [v3.45.0] \u5b58\u6863\u53f0\uff1a\u6362\u4f1a\u8bdd\u4e22\u8d34\u56de\u7684\u5305\u539f\u6587\u4e0e\u8981\u6c42\u6587\u672c\u8349\u7a3f\uff0c\u5df2\u6536\u5305 / \u5bf9\u8d26\u9762 / \u8981\u6c42\u8349\u7a3f / \u52a8\u4f5c\u53f0\u8d26\u56db\u683c\u5168\u91cf\u91cd\u53d6\n"
    "    cotdeskApp: 'cotdesk'      // [v3.46.0] \u601d\u7ef4\u94fe\u6848\u5934\uff1a\u6362\u4f1a\u8bdd\u4e22\u8d34\u56de\u7684\u6761\u76ee\u518c\u4e0e\u914d\u7f6e\u4e0e\u8981\u6c42\u6587\u672c\u8349\u7a3f\uff0c\u6761\u76ee\u518c / \u914d\u7f6e / \u8981\u6c42\u8349\u7a3f / \u52a8\u4f5c\u53f0\u8d26\u56db\u683c\u5168\u91cf\u91cd\u53d6")

EDITS = []

def edit(rel, old, new, tag):
    EDITS.append((rel, old, new, tag))

edit('config/apps.js', APPS_ANCHOR, APPS_ITEM + APPS_ANCHOR, 'apps \u65b0\u589e\u4e00\u9879')
edit('config/storage.js', STOR_ANCHOR, STOR_NEW, 'storage \u65b0\u589e\u524d\u7f00')
edit('scripts/keys-audit.mjs', KEYS_ANCHOR, KEYS_NEW, 'keys \u56db\u6761\u767b\u8bb0')
edit('index.js', IDX_BRANCH_ANCHOR, IDX_BRANCH_NEW, 'index \u60f0\u52a0\u8f7d\u5206\u652f')
edit('phone.css', PHONE_ANCHOR, PHONE_NEW, 'phone.css \u672c\u7248\u6bb5')
edit('tests/system-v255.test.mjs', V255_ANCHOR, V255_NEW, 'v255 dirMap')

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

print('== dry-run 摘要 ==')
for rel, ops in sorted(by_file.items()):
    print('  %s: %d 处' % (rel, len(ops)))
print('  phone.css 段长 %d 字节 / %d 行' % (len(SEG.encode('utf-8')), SEG.count(chr(10))))
print('  index.js 挂载恰 1 处: %s' % (out['index.js'].count('window.VirtualPhone.cotdeskApp = new module.CotdeskApp') == 1))
if not WRITE:
    print('（dry-run，未落盘）')
    sys.exit(0)
for rel, s in out.items():
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(s)
print('已落盘 %d 份' % len(out))
