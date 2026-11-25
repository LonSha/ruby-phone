import io

P = 'config/undo-capability.js'
s = io.open(P, encoding='utf8').read()

def rep(old, new, why):
    global s
    assert old in s, 'MISS: ' + why
    s = s.replace(old, new, 1)

rep(' * config/undo-capability.js — 89 个 App 的撤销能力**唯一声明面** [v4.105.0 · R13-O2]',
    ' * config/undo-capability.js — 105 个 App 的撤销能力**唯一声明面** [v4.105.0 · R13-O2]',
    'header count')
rep(' *   ② 目录数 88 vs App 数 89：`apps/memory/` 一个目录承载两件 App',
    ' *   ② 目录数 vs App 数：`apps/memory/` 一个目录承载两件 App（memory + graph）；'
    'v4.191.0 起又多了「同目录承载一件试算内核」的形态（见文件末尾那 16 条）',
    'dir vs app')
rep(' *      本面按 **89 个 APPS id** 登记（`config/apps.js` 的 APPS 长度），',
    ' *      本面按 **APPS 真源长度**（`config/apps.js` 的 APPS.length，当前 105）登记，',
    'register line')
rep(' *   本版**不那样做**，理由是可复算的：89 个 App 里有 15 个没有 `*-data.js`',
    ' *   本版**不那样做**，理由是可复算的：105 个 App 里有 15 个没有 `*-data.js`',
    'data coverage line')
rep(' * 声明表：89 条，一条一 App。', ' * 声明表：105 条，一条一 App。', 'table count')
rep('    /* ── 档三：irreversible（59 件，如实记账；每条理由必须具体到机制，不许写「不适用」） ── */',
    '    /* ── 档三：irreversible（75 件，如实记账；每条理由必须具体到机制，不许写「不适用」） ── */',
    'section header')

ADD = '''    /* ── 档三补登（v4.200.0）：v4.191.0 起并入 APPS 真源的 16 件，此前从未在声明面上出现 ──
     *
     *   为什么它们此前漏了：这 16 件都不是「独立目录的 App」，APPS 里有 id、`config/app-lazy-routes.js`
     *   有路由、`config/app-consumption-matrix.js` 有 `dir` 指向**父 App 的目录**（试算内核形态），
     *   于是「按目录枚举」的老口径看不到它们，而声明表是按「一条一 App」登记的 ⇒ 缺口 16 条。
     *   本版不改字段口径（仍按 appId 登记），只把这 16 条补上，并逐条写清「本件自身的销毁面」与
     *   「同目录里那些销毁符号归谁」。档位一律 irreversible —— 它们没有一件接过回收站或二次确认，
     *   把它们说成「删了能回来」才是真危险（`undoCapabilityOf` 对未知 id 也按这个最保守口径处理）。
     */
    Object.freeze({ appId: 'weibotext', name: '微博文本', mode: 'irreversible', why: '试算内核（`apps/weibo/weibo-text-app.js`）：拆的是相对时间 / @人名 / 粉丝数 / 评论行四族**解析**，只读会话文本、只写 `^weibo_text_` 前缀的当次试算结果，自身没有任何删除语义。`apps/weibo/` 里那些销毁符号（`_removePostById` / `_deleteServerImages` / `_showWeiboClearDataDialog` 等）全部落在 weibo 主件上，已由 `weibo` 那条单独登记 —— 本档登记「无自有销毁入口」，不是「查不出来」。' }),
    Object.freeze({ appId: 'honeytext', name: '蜜语文本', mode: 'irreversible', why: '试算内核（`apps/honey/honey-text-app.js`）：拆 HTML 剥除 / 好感度钳制 / 参考图归一 / 评论行归一，只读原文、只写 `^honey_text_` 前缀的试算结果，无删除语义。`apps/honey/` 的十二处销毁（`_removeStored` / `_deleteManagedHoneyGeneratedImage` / `_clearHoneyTtsCache` 等）全属 honey 主件，已单独登记为残留账。' }),
    Object.freeze({ appId: 'phonetext', name: '通话文本', mode: 'irreversible', why: '试算内核（`apps/phone/phone-text-app.js`）：拆短信批处理与通话记录行的**文本形态**，只读原记录、只写 `^phone_text_` 前缀的试算结果。`apps/phone/` 里 `_removeSmsMessages` / `_removePersistedPhoneCallTtsCache` / `_bindSmsMessageDeleteEvents` 等全属 phone 主件（已单独登记）；本件不删任何一条短信或通话记录。' }),
    Object.freeze({ appId: 'gamesprotocol', name: '游戏协议', mode: 'irreversible', why: '试算内核（`apps/games/games-protocol-core.js` + `-app` / `-view`）：把狼人杀 / 卧底 / 牌型的**协议文本**折成结构化读数，纯函数、不落盘。`apps/games/` 里唯一的销毁形符号 `_clearUndercoverUserTurnTimer` 是计时器清理而非数据销毁，且属 games 主件。本档登记「无自有销毁入口」。' }),
    Object.freeze({ appId: 'diagnosereason', name: '诊断归因', mode: 'irreversible', why: '试算内核（`apps/diagnose/diagnose-reason-core.js` + `-app` / `-view`）：只做「原因码 → 可读句子」的映射，零破坏性符号。`apps/diagnose/` 里 5 处「删除 / 重置 / 清空」字样全在诊断面板的文案与台账说明里（diagnose 主件已登记为只读面板），本件自身不写盘、不删任何东西。' }),
    Object.freeze({ appId: 'iot', name: '智能家居', mode: 'irreversible', why: '四件（app / data / view / ambient-hub）破坏性符号命中 0、四字中文词（清空 / 删除 / 清除 / 重置）命中 0：设备表是全量覆盖写，用户能做的只有开关与解绑，没有「删除设备」这条落盘语义。本档登记「无自有销毁入口」——「零破坏性入口」这句话是可复算的，不是「查不出来」。' }),
    Object.freeze({ appId: 'share', name: '近场快传', mode: 'irreversible', why: '五件（app / data / view / nfc 交换 / 系统分享总线）里 2 处「清空」：清的是本次快传的**候选清单**（临时搬运态，源文件在对方设备上仍在），清了不可回但也不需要回。未做确认如实记账。' }),
    Object.freeze({ appId: 'callscene', name: '情境通话', mode: 'irreversible', why: '五件（app / data / view / 声学调制 / 情境声场）里 2 处「清空」：清的是当前情境的**声场预设选择**，预设本身由引擎按情境重算，可重新生成。未做确认如实记账。' }),
    Object.freeze({ appId: 'social', name: '朋友圈', mode: 'irreversible', why: '四件（app / data / view / NPC 自主社交引擎）里 2 处「清空」：清的是自主社交的**动态流**（由引擎按 NPC 关系重算，属可再生数据），故不做回收站；未做确认如实记账 —— 清了确实找不到刚才那条。' }),
    Object.freeze({ appId: 'daily', name: '生活织机', mode: 'irreversible', why: '四件（app / data / view / 跨 App 日程织机）里 2 处「清空」：清的是当日编织出的**建议条目**，建议由既有日程重算得出，属派生数据。未做确认如实记账。' }),
    Object.freeze({ appId: 'keyboard', name: '口癖联想', mode: 'irreversible', why: '四件（app / data / view / 像素输入法口癖预测）破坏性符号与四字中文词双 0：口癖表是全量覆盖写，学习结果可重新累积。本档登记「无自有销毁入口」。' }),
    Object.freeze({ appId: 'pokereval', name: '牌型评估', mode: 'irreversible', why: '试算内核（`apps/games/poker/poker-eval*.js`）：从手牌读数算牌型与胜率，纯函数、不落盘。同目录 `poker-data.js` 的 `_resetOtherActors` 属 poker 主件的局内状态重置，不是本件的入口 —— 本档登记「无自有销毁入口」。' }),
    Object.freeze({ appId: 'wwrules', name: '狼人杀规则', mode: 'irreversible', why: '规则引擎（`apps/games/werewolf/` 的 `-rules` 三件）：把规则文本折成可判定的规则表，破坏性符号与四字中文词双 0。同目录 `werewolf-data.js` 的 `_removeLegacyGlobalState` 是旧全局键迁移清理、属主件。本档登记「无自有销毁入口」。' }),
    Object.freeze({ appId: 'ucrules', name: '谁是卧底规则', mode: 'irreversible', why: '规则引擎（`apps/games/undercover/` 的 `-rules` 三件）：规则表与词库的**只读**推导，破坏性符号与四字中文词双 0（同目录 only 的销毁形符号在 `undercover-data` 的局内状态里，属主件）。本档登记「无自有销毁入口」。' }),
    Object.freeze({ appId: 'bilifmt', name: 'B站换算', mode: 'irreversible', why: '试算内核（`apps/bilibili/bili-format*.js`）：把播放量 / 时长 / 分P 折成可读换算，纯函数。`apps/bilibili/` 的 4 处「清空 / 删除」全在 bili 主件的收藏与历史入口里（bili 已单独登记为「无自有销毁入口」）。本件自身不删任何东西。' }),
    Object.freeze({ appId: 'musiccore', name: '歌词与模式', mode: 'irreversible', why: '试算内核（`apps/music/music-core*.js`）：歌词行解析 + 播放模式换算，纯函数、不落盘。`apps/music/` 里那 1 处 `recycleBin.registerRestorer(` 与 20 处「清空 / 删除 / 重置」全属 music 主件（已登记为 undo 档的恢复器与销毁面）—— 本件不新增恢复器，也不新增销毁入口。' }),
'''

anchor = '    Object.freeze({ appId: \'comms\', name: \'会话台\', mode: \'irreversible\', why: \'只读会话面板，无自有落盘销毁入口。\' }),\n]);'
assert anchor in s, 'MISS tail anchor'
s = s.replace(anchor, '    Object.freeze({ appId: \'comms\', name: \'会话台\', mode: \'irreversible\', why: \'只读会话面板，无自有落盘销毁入口。\' }),\n\n' + ADD + ']);', 1)

io.open(P, 'w', encoding='utf8').write(s)
print('undo-capability.js patched')