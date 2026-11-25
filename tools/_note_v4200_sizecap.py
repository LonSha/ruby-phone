import io

P = 'tests/audit/scan_file_size_ceiling.mjs'
s = io.open(P, encoding='utf8').read()

anchor = "逐文件天花板只有 settings-app.js 一条往下压。',\n"
assert anchor in s, 'note tail anchor miss'

ADD = (
    "      ' **v4.200.0 清存量红的两笔（406016 → 406058，+42）**：本版只做「清既有红」，产品面新增的行只有两处 —— '\n"
    "      'config/undo-capability.js +26（撤销声明面补登 16 件试算内核/规则引擎的条目与其来由说明，此前它们在 APPS 真源里却没有声明）、 '\n"
    "      'apps/cardtable/cardtable-core.js +5（取数转发不再重定义一份本地 numOrNullOf，改用 cardtable-data.js 的导出并写清来由）。 '\n"
    "      '26 + 5 = 31 是本版的全部。余下 +11 是台账上一次签字（dfa371a）之后、本版之前散在 1200 行以下小文件里的存量漂移 —— '\n"
    "      '那笔是同一个提交里 pure-time 接线落地后没再签一次台账，属既有疏漏，如实签字而不抹平。 '\n"
    "      '**逐文件天花板一条都没涨**（45 个大文件的 lines_max 全未变，复算：改前改后台账的 files 逐键相等）， '\n"
    "      '也就是说这一笔全是 1200 行以下的小文件在涨，没碰任何一条棘轮。压回原位仍靠继续拆 index.js / settings-app.js，不靠压台账。',\n"
)
s = s.replace(anchor, anchor + ADD, 1)
io.open(P, 'w', encoding='utf8').write(s)
print('note appended')