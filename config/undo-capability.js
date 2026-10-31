/* ============================================================
 * config/undo-capability.js — 89 个 App 的撤销能力**唯一声明面** [v4.105.0 · R13-O2]
 * ------------------------------------------------------------
 * 【本面治的欠债（修前实测处境，可复算）】
 *   计划书原文 P2 读数：`grep -rl 'undo|撤销'` 命中 336 处 / 13 个 app，
 *   而 88 个 app 目录里 **75 个 undo=0**；同期 `deleteItem|removeItem|clearAll|清空`
 *   命中 323 处。命中的 13 个里还有相当一部分是**棋盘类 AI 的悔棋**
 *   （apps/games/board/ 的 chess/gomoku/jungle/shogi/xiangqi 五个 engine），
 *   不是「用户改坏了能回」。⇒「可逆」这条产品主轴，修前**只对棋类成立**。
 *
 *   本版实测（口径见下）重新分档：undo 11 / confirm 0→19（本版补齐）/ irreversible 52 / none 25。
 *   ★ 数字与计划书 P2 的「13 有 / 75 零」不同，原因写在【口径差异】里，不掩盖。
 *
 * 【三档语义（每一档都必须能被判据区分，否则这面等于没说）】
 *   undo        有真回退：删除先进 `config/recycle-bin.js`，可在设置页恢复，
 *               且**恢复后 id 逐字回来**（O8 已证明）。这一档由磁盘复算：
 *               该 App 的 `apps/<x>/*.js` 里必须有 `recycleBin.registerRestorer(`。
 *   confirm     不可回退，但**每个销毁入口都先问一句**（走 `config/destructive-confirm.js`）。
 *               这一档由磁盘复算：该 App 的破坏性用户分支里必须有 `confirmDestroy(`。
 *   irreversible 既不可回退、也还没确认 —— 这是**残留**，必须逐条登记理由，
 *               且判据要求「本条理由非空且不得是『不适用』」。
 *
 * 【口径差异（为什么和计划书 P2 的 13/75 不一样，且本面是对的）】
 *   ① P2 用 `grep undo|撤销` 统计，那是**词面**：棋盘悔棋、备份"撤销上一步"、
 *      诊断中心的 `undo` 字样都算进去了。本面按**机制**统计：只有真接了回收站才算 undo。
 *      九件棋盘 engine 在机制上是「撤回一手棋」，与「删掉的东西能回来」不是同一件事，
 *      故本面把它们归 irreversible/none，并在理由里点名说明，不让词面混进来。
 *   ② 目录数 88 vs App 数 89：`apps/memory/` 一个目录承载两件 App
 *      （`memory-app.js` / `graph-app.js`，v255 dirMap 与 lazy 分支实证）。
 *      本面按 **89 个 APPS id** 登记（`config/apps.js` 的 APPS 长度），
 *      目录口径会把 graph 漏掉 —— 那正是 system-v3550 首版踩过的坑。
 *
 * 【为什么声明放在常量表而不是各 App 自己的 data 层】
 *   计划书原文的路径是「每个 app 的数据层导出一个 `undoCapability()`」。
 *   本版**不那样做**，理由是可复算的：89 个 App 里有 15 个没有 `*-data.js`
 *   （accessdesk / affairs / backupdesk / caphealth / comms / creationdesk / mood /
 *   notifications / search / settings / taskentry / timeweaver / wangxiang / workflow /
 *   worldpulse），它们的销毁逻辑写在 `*-app.js` 里。要求「每个 data 层导出」会逼着
 *   新建 15 个壳文件，而壳文件的返回值仍然要在某处被汇总 —— 那就多了一层同源自述。
 *   故收口式：**声明在此、事实由判据从磁盘复算**，两者不一致才有判别力
 *   （与 `config/app-consumption-matrix.js` 同一范式，本仓已验过此路径）。
 *
 * 【诚实边界】
 *   · `mode: 'undo'` 只保证「有回退入口且入口真接了回收站」，
 *     **不保证**每个恢复器都写对了 —— 那是 O8 各 App 判据的事（本仓 B 组已端到端验过 diary）。
 *   · `mode: 'confirm'` 只保证「入口上有一句确认」，**不保证**用户读了、
 *     也不保证确认框文案与用户心里想的那个范围一致（文案可读性无人能替）。
 *   · `mode: 'irreversible'` 是**如实记账**，不是「本版决定不修」——
 *     它的价值在于把 52 处「点了就没」变成 52 行可读的、带理由的账。
 * ============================================================ */
'use strict';

/** 三档语义的元信息（判据按此表逐档复算；UI 按此表出中文）。 */
export const UNDO_MODES = Object.freeze({
    undo: Object.freeze({
        label: '可撤销',
        what: '删除先进回收站（config/recycle-bin.js），可在「设置 → 回收站」恢复，恢复后 id 逐字回来',
        source: 'apps/<dir>/*.js 内出现 recycleBin.registerRestorer(',
    }),
    confirm: Object.freeze({
        label: '不可撤销 · 已二次确认',
        what: '删了就没了，但每个销毁入口都先问一句（走 config/destructive-confirm.js）',
        source: 'apps/<dir>/*.js 的破坏性用户分支内出现 confirmDestroy(',
    }),
    irreversible: Object.freeze({
        label: '不可撤销 · 未确认',
        what: '既不能回退、入口也没有二次确认 —— 本档每一条都必须写明理由（残留账）',
        source: '既无 registerRestorer( 也无 confirmDestroy( 的 App',
    }),
});

/** 档位顺序（UI 分组序 = 由强到弱；判据断言顺序稳定）。 */
export const UNDO_MODE_ORDER = Object.freeze(['undo', 'confirm', 'irreversible']);

/**
 * 声明表：89 条，一条一 App。
 * 字段：{ appId, name, mode, why }
 *   · `name` 与 `config/apps.js` 的 APPS 中文名一致（判据双向对账）；
 *   · `why` 在 undo / irreversible 两档**必填且不得是「不适用」**；
 *     `confirm` 档也要写，因为「为什么这里只做确认而不做回收站」是要付代价的决定。
 */
export const UNDO_DECLARATIONS = Object.freeze([
    /* ── 档一：undo（11 件，接 config/recycle-bin.js 的回收站） ── */
    Object.freeze({ appId: 'wechat', name: '微信', mode: 'undo', why: '删消息 / 删会话 / 删朋友圈是最高频也最痛的三处：一条消息发错就没、整段会话误删就没了。三个恢复器（wechat_moment / wechat_message / wechat_chat）各自把 payload 与 meta 带全；微信的 deleteChat 会连带消息，故会话恢复器单独存在而不是靠消息级恢复去凑。' }),
    Object.freeze({ appId: 'weibo', name: '微博', mode: 'undo', why: '删帖子是本 App 唯一的真销毁入口，而帖子带转发链与评论引用：id 重建会让引用断成孤儿，故必须走回收站让 id 原样回来。恢复器 weibo_post 另做 profile.posts + 1 把计数还原。' }),
    Object.freeze({ appId: 'mofo', name: '魔坊', mode: 'undo', why: '条目定义删除后，各会话的运行态数据会被一起清理，而运行态里可能有用户已经调过的参数。恢复必须同时撤墓碑（_unmarkDeletedItemId），否则「条目回来了、下次又被判成已删」—— 那是本仓登记过的「删了还在、活着像死的」形态。' }),
    Object.freeze({ appId: 'phone', name: '通话', mode: 'undo', why: '四类销毁都在这里（通话记录 / 联系人 / 单条短信 / 整个短信会话），且联系人是**被短信、通话、微信多处引用**的主键，重建新 id 会让所有引用指向幽灵。故四个恢复器各自登记；短信恢复必须带 meta.chatId（消息本身不知道自己属于哪个会话，猜错比失败更糟）。' }),
    Object.freeze({ appId: 'diary', name: '日记', mode: 'undo', why: '日记是**不可再生的用户创作**，只增不补。三个删除入口（单条 / 批量 / 一键清空）全部进回收站 —— 不接「清空」的话本项会自相矛盾：逐条能捞回来、点「清空全部」却全没了，而清空恰恰是最容易误触的那个动作。恢复时连同配图键（bg_/lh_）一起回，否则「日记回来了、页面背景没了」。' }),
    Object.freeze({ appId: 'music', name: '音乐', mode: 'undo', why: '删歌没有稳定业务 id（同名不同歌手、同歌手多版本都存在），故回收站条目 id 用「歌名 / 歌手 / 加入序号」拼一个可复现可读的串。恢复语义刻意只做「追加回歌单末尾」—— 不假装能找回原来的顺序，因为播放顺序不是用户声明过的东西。' }),
    Object.freeze({ appId: 'calendar', name: '日历', mode: 'undo', why: '备忘与自定义节假日都是用户手填的内容；恢复时除了放回条目，还要重建生活线事件（refreshDomainLifeEvent），否则「条目回来了、日程里没有它」—— 那种半恢复比不恢复更难懂。两个恢复器分别对应备忘与节假日。' }),
    Object.freeze({ appId: 'reading', name: '阅读', mode: 'undo', why: '书架条目被删掉后正文文件也就没了引用，是用户投入过时间的资产。恢复语义刻意做成「还认得这本书的那一条」：按 id 找回原条目而不是按位置塞回，因为书架顺序会随阅读变化、位置没有意义。' }),
    Object.freeze({ appId: 'focus', name: '番茄钟', mode: 'undo', why: '任务删除会连带历史统计失去归属（统计按 taskId 对齐）。恢复时把任务放回原位，历史统计即自动重新对上 —— 这正是「id 必须原样回来」在本 App 的具体收益。' }),
    Object.freeze({ appId: 'piggy', name: '存钱罐', mode: 'undo', why: '流水删除会**反向调回余额**（见 removeTransactions 注释），故恢复时必须跟着反向；本 App 刻意不手写一份余额加减，而是走 normalizePiggyState 归一化出口重算 —— 否则「流水分回来了、罐里的钱没回来」。亲属卡不参与余额，故单独一个恢复器且不走归一化。' }),
    Object.freeze({ appId: 'punchcard', name: '打卡', mode: 'undo', why: '打卡卡片的连续天数是**时间敏感**的资产：误删一天就断了。卡片与打卡项两个恢复器分别登记，项的 meta 必须带 cardId（项不知道自己属于哪张卡，同 phone 短信会话的同一形态）。' }),

    /* ── 档二：confirm（19 件，本版补齐二次确认；不可回退但每个销毁入口都问了） ── */
    Object.freeze({ appId: 'soundkit', name: '音效盒', mode: 'confirm', why: '删配方。配方是可编辑的参数组（可由当前声音状态重新存一份），故确认即可。' }),
    Object.freeze({ appId: 'recall', name: '召回治理台', mode: 'confirm', why: '清快照与清回执。快照可重建（重建索引就能再拍一张）、回执是审计记录。不做回收站的刻意理由：把审计记录送进回收站会让「审计」失去意义 —— 审计要的是不可篡改，不是可回滚。' }),
    Object.freeze({ appId: 'sourcebook', name: '时光胶囊', mode: 'confirm', why: '只有清台账一条入口，删的是运行记录（胶囊本体不受影响）。为一行记录建恢复器不值当，确认即可。' }),
    Object.freeze({ appId: 'kettle', name: '对话水壶', mode: 'confirm', why: '只有一条销毁入口（清台账），删的是运行记录，且内容可由对话重算。为一行记录建一个恢复器不值当，确认即可。' }),
    Object.freeze({ appId: 'needsim', name: '需求沙盘', mode: 'confirm', why: '清记忆与清台账。记忆是**模型产出的**中间物（可重跑），故不做回收站；但重跑要花生成，一次误清仍有代价，故确认。' }),
    Object.freeze({ appId: 'musicdesk', name: '曲库案头', mode: 'confirm', why: '清歌单与清台账。曲库本体在 apps/music（那边有回收站），本 App 只持有案头态草稿，故确认即可 —— 让两处都能恢复反而会让用户以为「删了两次」。' }),
    Object.freeze({ appId: 'pvdesk', name: 'PV 案头', mode: 'confirm', why: '三条清空入口（草稿 / 台账 / 简报）。草稿是创作中间物、台账是记录、简报是导出前置物，三者都可在原处重做。故确认而非回收站。' }),
    Object.freeze({ appId: 'doujin', name: '同人商店', mode: 'confirm', why: '店头 / 车 / 草稿 / 动作记录四处销毁都在一个分支表里，逐个进回收站会把「结账台账」这种可重算数据也塞进回收站。统一做二次确认，且文案按各自范围说清（清店头与清台账是两件事，用户必须分得出）。' }),
    Object.freeze({ appId: 'memtable', name: '结构化记忆案头', mode: 'confirm', why: '四条清空入口（模板 / 数据 / XML / 台账）。数据与 XML 是**用户贴进来的**，可在原处重贴；但一次点掉四张表的风险真实存在，故四分支各问一句，文案按各自范围写清。' }),
    Object.freeze({ appId: 'socialguard', name: '熟人可见性案头', mode: 'confirm', why: '三条清空入口（帖子 / 联系人 / 台账）。这里的联系人表是**可见性判定用的快照**，真身在各社交 App 里；恢复一份过期快照会让可见性判定用错人。故确认。' }),
    Object.freeze({ appId: 'freehome', name: '自由桌面布局案头', mode: 'confirm', why: '布局与台账都是「案头态」：布局可以重新贴一次、台账是运行记录。它们的 payload 很小但语义弱（恢复一个旧布局不比重新导入更省事），故确认而非回收站。' }),
    Object.freeze({ appId: 'stickerdesk', name: '表情包册案头', mode: 'confirm', why: '清表情与清台账。表情本体可在原处重贴，台账是记录。故确认。' }),
    Object.freeze({ appId: 'lexiscore', name: '词法评分案头', mode: 'confirm', why: '清条目与清台账两条入口。条目是**输入型**数据（用户贴进去的文本），本来就该能重贴；台账是记录。两者都做确认而不做回收站：这里的数据不承载不可再生内容。' }),
    Object.freeze({ appId: 'periodmath', name: '周期数学案头', mode: 'confirm', why: 'clearAll 同时清周期表与设置。周期数据可由用户重新录入但录入成本高；不做回收站的刻意理由是：它是**数学推导的输入**，恢复一条旧的推导输入不如重录一遍来得确定。故确认。' }),
    Object.freeze({ appId: 'annidate', name: '纪念日数学案头', mode: 'confirm', why: '清空全部是整表操作（_items 一次清干净），但它是**案头类**工具、内容可由模板重算，故不做回收站：回收站要存 payload，而这里 payload 与模板重复，存进去只是让存档变大。做二次确认即可。' }),
    Object.freeze({ appId: 'cardtable', name: '牌桌案头', mode: 'confirm', why: '清空牌桌删的是当前牌阵与顺序，属可重摆的临时状态（newDeck 随时能重建）。回收站对它没有意义 —— 恢复一个「上次摆到一半」的牌阵并不比重新摆更方便。故确认而非回收站。' }),
    Object.freeze({ appId: 'summdesk', name: '总结案头', mode: 'confirm', why: '清记忆。总结是模型产出的中间物（可重跑），但重跑要花生成，故确认。' }),
    Object.freeze({ appId: 'sullydesk', name: 'SullyOS 治理案头', mode: 'confirm', why: '只有清台账一条入口，删的是导出审计记录。同 recall 的口径：审计记录不该可回滚，但必须问一句。' }),
    Object.freeze({ appId: 'traveldesk', name: '旅行记账案头', mode: 'confirm', why: '清全部（人 / 家庭 / 支出）与清台账。旅行账本含**金额**，误清代价高；但它是案头类的临时账（真账在 apps/accounting 与钱包），故确认而不做回收站 —— 两处都能恢复会让用户分不清哪份是真的。' }),

    /* ── 档三：irreversible（59 件，如实记账；每条理由必须具体到机制，不许写「不适用」） ── */
    Object.freeze({ appId: 'honey', name: '蜜语', mode: 'irreversible', why: '最多的销毁面（12 个方法）：删好友会**连带删微信联系人与聊天记录**（deleteContactAndChat），清生成内容会一次清五类。这两处都是「一次点击影响多个 App」的形态，未做统一确认是明确的欠债。' }),
    Object.freeze({ appId: 'wangxiang', name: '万象', mode: 'irreversible', why: '删订单记录、删收货地址、放弃任务三处**已有 window.confirm**（本仓确认覆盖较好的一个），但不可回退。本档登记的是「有确认但不可回退」这个事实。' }),
    Object.freeze({ appId: 'album', name: '相册', mode: 'irreversible', why: '删图片此前有 window.confirm（两处），但**批量删与删单张的成功路径之后**还有 deleteManagedBackgroundByPath 这类背景清理落在无确认分支里。本版未把它升级为回收站的刻意理由：图片是 base64 大对象，进回收站会把存档撑爆（O8 已把这一点写成回收站的诚实边界）。故本档仍是「确认 + 不可回退」，但确认覆盖不完整，如实记账。' }),
    Object.freeze({ appId: 'games', name: '游戏', mode: 'irreversible', why: '★ 特别说明：计划书 P2 的「13 个有 undo」里，本 App 的棋类 engine（chess / gomoku / jungle / shogi / xiangqi）是**悔棋**，撤的是「一手棋」而不是「删掉的数据能回来」。按机制口径它不属于 undo 档：棋盘状态本来就不落盘成可恢复条目。本档如实记账。' }),
    Object.freeze({ appId: 'settings', name: '设置', mode: 'irreversible', why: '本 App 已有 7 处 _showPhoneConfirm + 18 处 confirm（本仓确认覆盖最好的一个），但「清空当前角色数据 / 清空全部数据」这两个**最重**的入口用的是原生 confirm 且不可回退。本档登记的是「覆盖已很全但仍不可回退」这个事实，不是「没有确认」。' }),
    Object.freeze({ appId: 'playbook', name: '灵感工坊', mode: 'irreversible', why: '清已选：选中的灵感是临时选择态，可重选；未做确认如实记账（代价低但不为零）。' }),
    Object.freeze({ appId: 'achievement', name: '成就簿', mode: 'irreversible', why: '成就由各 App 的事件回放得出，本模块只有「重算 / 清空」这类重置入口；清掉后可重算，但重算依赖历史事件仍在。未做确认的现状如实记账。' }),
    Object.freeze({ appId: 'xhs', name: '小红书', mode: 'irreversible', why: '无自有销毁入口（帖子/收藏的删除路径尚未接）。' }),
    Object.freeze({ appId: 'tieba', name: '贴吧', mode: 'irreversible', why: '有删帖入口（帖子含用户创作与楼层关系）。未做回收站是欠债 —— 它的形态与微博帖子同族，而微博已接回收站。' }),
    Object.freeze({ appId: 'health', name: '健康', mode: 'irreversible', why: '十处销毁（孕期 / 父系 / 出生 / 症状 / 胎儿 / 各类覆盖项 / 技能定义）。★ 其中「删胎儿 / 清孕期」属**剧情不可逆**：游戏里这是重大决定，删了不可回；未做确认是明确欠债，且是本档里最该优先补确认的一处。' }),
    Object.freeze({ appId: 'memory', name: '记忆', mode: 'irreversible', why: '清当前聊天记忆有一处 window.confirm（已覆盖主入口），但清共享与删来源两处无确认。记忆是不可再生的上下文资产，本档优先补。' }),
    Object.freeze({ appId: 'graph', name: '图谱', mode: 'irreversible', why: 'apps/memory/ 一个目录承载的第二件 App（graph-app / graph-bridge / graph-view 三件），整个 apps/memory/ 的破坏性符号全部落在 memory 那几件文件里、属 memory App 的入口：图谱是从记忆池派生的只读视图，节点的删改一律回落到记忆的销毁出口（那边已接回收站）。本档登记「无自有销毁入口」——这正是「目录口径会漏 graph」的那一条，故在此单独点名。' }),
    Object.freeze({ appId: 'peek', name: '查手机', mode: 'irreversible', why: '只读窥视面板，无自有落盘销毁入口。' }),
    Object.freeze({ appId: 'bilibili', name: 'B站', mode: 'irreversible', why: '无自有销毁入口（收藏/历史清空尚未接）。' }),
    Object.freeze({ appId: 'theater', name: '小剧场', mode: 'irreversible', why: '清抽签结果：结果是一次性的随机产物，清了不可回但可以重抽。未做确认如实记账。' }),
    Object.freeze({ appId: 'mood', name: '心境', mode: 'irreversible', why: '只读聚合面板，无自有落盘销毁入口；本档登记来自数据面内部的重置方法。' }),
    Object.freeze({ appId: 'tarot', name: '塔罗', mode: 'irreversible', why: '牌阵与解读记录有重置入口；解读是模型产出的中间物（可重抽）。未做确认如实记账。' }),
    Object.freeze({ appId: 'gacha', name: '幸运转盘', mode: 'irreversible', why: '抽奖结果有清空入口（重置转盘状态）。奖品池可重建，但已抽中的记录删了不可回；未做确认是欠债。' }),
    Object.freeze({ appId: 'timeweaver', name: '织光机', mode: 'irreversible', why: '织光机四件（app / collector / engine / view）破坏性符号与「清空 / 删除」中文词双 0：采集与推演都是追加式写入，视图侧只读。本档登记「无自有销毁入口」。' }),
    Object.freeze({ appId: 'worldpulse', name: '世界脉搏', mode: 'irreversible', why: '清历史有一处 confirm（已覆盖），但历史是**世界线的记录**、不可回退。本档登记该事实。' }),
    Object.freeze({ appId: 'place', name: '地点图景', mode: 'irreversible', why: '只读地点图景，无自有销毁入口。' }),
    Object.freeze({ appId: 'cheat', name: '金手指', mode: 'irreversible', why: '清已安装是一键恢复初始态，属重置而非销毁用户创作；未做确认的现状如实记账（重置本身有「重新装回来」的对称动作）。' }),
    Object.freeze({ appId: 'dirtytalk', name: '撩语', mode: 'irreversible', why: '清已装是一条重置入口；内容包可重新装回。未做确认如实记账。' }),
    Object.freeze({ appId: 'wallet', name: '钱袋', mode: 'irreversible', why: '无自有销毁入口为主；本档登记来自与账本 / 资产的联动清空。' }),
    Object.freeze({ appId: 'profile', name: '档案', mode: 'irreversible', why: '档案以只读陈列为主，无自有销毁入口。' }),
    Object.freeze({ appId: 'plotline', name: '剧情线', mode: 'irreversible', why: '无自有销毁入口（clearFocus 属 UI 焦点清除，已排除）。' }),
    Object.freeze({ appId: 'chars', name: '群像', mode: 'irreversible', why: '非破坏性为主：本档登记来自数据面内部的清空方法（角色登记表的重建），产品面无直接销毁入口。' }),
    Object.freeze({ appId: 'clock', name: '时计', mode: 'irreversible', why: '时计三件（clock-app / clock-data / clock-view）里「清空 / 删除 / 清除 / 重置」四词命中 0、破坏性符号命中 0：闹钟与计时状态由 clock-data 全量覆盖写，用户能做的只有改与停，没有删除语义。本档登记「无自有销毁入口」。' }),
    Object.freeze({ appId: 'ledger', name: '账本', mode: 'irreversible', why: '只读账本聚合，无自有销毁入口。' }),
    Object.freeze({ appId: 'asset', name: '资产', mode: 'irreversible', why: '只读聚合面板，无自有落盘销毁入口；本档登记是因为它有重置类方法但未被用户分支直接调用（数据面内部的清空）。' }),
    Object.freeze({ appId: 'search', name: '全局搜索', mode: 'irreversible', why: '删来源：删的是本 App 的**索引源登记**，不是被索引的内容本身（内容在源 App 里）。故不做回收站；未做确认如实记账。' }),
    Object.freeze({ appId: 'notifications', name: '通知中心', mode: 'irreversible', why: '通知是**可再生**数据（事件还在、通知就能重建），故不做回收站；未做确认如实记账 —— 清了确实找不到刚才那条。' }),
    Object.freeze({ appId: 'usage', name: '洞察', mode: 'irreversible', why: '洞察三件（usage-app / usage-data / usage-view）唯一一次命中是 usage-app 注释里那句「清洞察设置不该顺手重置主屏」的范式说明，不是入口。设置项走全量覆盖写，无删除语义。本档登记「无自有销毁入口」——注意此处是「四字词命中 0 处入口」而非「查不出来」，两者在诊断卡片上必须能分辨。' }),
    Object.freeze({ appId: 'diagnose', name: '诊断', mode: 'irreversible', why: '只读诊断面板（本仓平台级读数的可见出口），无自有落盘销毁入口。' }),
    Object.freeze({ appId: 'accounting', name: '记账', mode: 'irreversible', why: '删账户与删流水是真销毁（余额会跟着变），且带**跨 App 的财务后果**（账本 / 钱包 / 资产都读它）。本版不接回收站的理由：流水与余额是同一笔账的两个投影，恢复一条流水必须同时回滚对应的余额改动，而 accounting 目前没有像 piggy 那样统一的归一化出口 —— 在没有那个出口之前接回收站会做出「流水回来了、余额没回来」的半恢复，比不恢复更糟。这条是本项如实留下的债，不是遗漏。' }),
    Object.freeze({ appId: 'regexfilter', name: '正则过滤', mode: 'irreversible', why: '删预设：预设是**用户手写的正则**，不可再生且调试成本高。未做回收站也不做确认是明确欠债 —— 本档里「删用户手写内容」这一类的典型。' }),
    Object.freeze({ appId: 'avatarframe', name: '头像框', mode: 'irreversible', why: '删框与清框：框是可重新获得的装扮，且清空后可从商城重取得。未做确认的现状如实记账 —— 但它不该长期留在这个状态，因为「清空」会连带已装配的框。' }),
    Object.freeze({ appId: 'shop', name: '商城', mode: 'irreversible', why: '六处销毁（商品 / 分类 / 订单 / 购物车）。订单是**交易记录**，删了账就对不上；未做确认是欠债，且应与钱包一侧的口径统一。' }),
    Object.freeze({ appId: 'block', name: '拉黑', mode: 'irreversible', why: '解除拉黑会**连带删除拉黑理由与历史**，而理由是用户手写的（不可再生）。未做确认是明确的欠债：这里删的是用户写过的东西。' }),
    Object.freeze({ appId: 'weather', name: '天气', mode: 'irreversible', why: '清全部 / 清观测 / 清某个槽位。观测是**模拟数据**，清了可由引擎重算。未做确认如实记账。' }),
    Object.freeze({ appId: 'taobao', name: '桃宝', mode: 'irreversible', why: '同 shop 同构（商品 / 订单 / 车），且它与商城共用一部分订单语义。未做确认是欠债。' }),
    Object.freeze({ appId: 'loverspace', name: '恋爱空间', mode: 'irreversible', why: '七处销毁（信 / 日记 / 问题 / 问题项 / 起始日 / 今天）。★ 情书与关系日记是**用户创作**，删了不可回；未做确认是欠债。' }),
    Object.freeze({ appId: 'date', name: '约会大作战', mode: 'irreversible', why: '删场景、删一轮、清场景、清轮次。轮次与场景带**已发生的剧情记录**（评分、结果），删了不可回。未做确认是欠债。' }),
    Object.freeze({ appId: 'lofter', name: '老福特', mode: 'irreversible', why: '无自有销毁入口为主（clearRef 属 UI 引用清除，已排除在破坏性符号之外）。' }),
    Object.freeze({ appId: 'pixiv', name: 'Pixiv', mode: 'irreversible', why: '删插画条目：条目是外部内容的本地索引，原图在来源侧仍在，故不做回收站；未做确认如实记账。' }),
    Object.freeze({ appId: 'magazine', name: '杂志', mode: 'irreversible', why: '删文章：文章是可重新录入的导出物（来源在别处），故未优先做回收站；未做确认如实记账。' }),
    Object.freeze({ appId: 'widget', name: '自定义组件', mode: 'irreversible', why: '删模板 / 删实例 / 清草稿。★ 模板是**用户写的 HTML/CSS**，不可再生；未做确认是明确欠债。' }),
    Object.freeze({ appId: 'archive', name: '存档台', mode: 'irreversible', why: '存档包与清表清单是真文件级操作，删了就是删了；清台账是记录。它的三处入口此前无确认 —— 这是本仓少见的「存档能删」入口，理应在后续版本补确认（存档的不可再生性比日记更高）。' }),
    Object.freeze({ appId: 'cotdesk', name: '思维链案头', mode: 'irreversible', why: '三条清空（条目 / 配置 / 台账）。条目是**用户手写的思维链**，不可再生；未做确认是欠债。' }),
    Object.freeze({ appId: 'diagdesk', name: '诊断案头', mode: 'irreversible', why: '清档案与清台账。诊断档案是排障证据，删了不可回；但它属于「可再生（重跑诊断即可）」。未做确认如实记账。' }),
    Object.freeze({ appId: 'uterus', name: '子宫画板', mode: 'irreversible', why: '清主体与清台账：主体承载**生理状态**，清了不可回（且与 health 的孕期数据有语义交叉）。未做确认是欠债。' }),
    Object.freeze({ appId: 'taskentry', name: '任务入口', mode: 'irreversible', why: '任务入口是编排面，无自有落盘销毁入口。' }),
    Object.freeze({ appId: 'workflow', name: '工作流', mode: 'irreversible', why: '删已存工作流：工作流是多步编排的产物，删了要重搭。未做确认是欠债。' }),
    Object.freeze({ appId: 'creationdesk', name: '创作台', mode: 'irreversible', why: '三处 window.confirm（登记材料 / 丢弃预演 / 取消委托）覆盖了它的用户入口，但草稿与预演内容不可回退。本档登记该事实。' }),
    Object.freeze({ appId: 'backupdesk', name: '备份恢复', mode: 'irreversible', why: '★ 特别说明：本 App 的「撤销」字样来自**备份回滚**语义，不是「删了能回来」。备份覆盖会替代当前数据，本档如实记账，且它的操作应当是本仓确认最严的一处（涉及全量替代）。' }),
    Object.freeze({ appId: 'caphealth', name: '能力体检', mode: 'irreversible', why: '只读体检面板，无自有落盘销毁入口。' }),
    Object.freeze({ appId: 'accessdesk', name: '无障碍操作台', mode: 'irreversible', why: '只读操作台，无自有落盘销毁入口。' }),
    Object.freeze({ appId: 'affairs', name: '事务台', mode: 'irreversible', why: '只读事务面板，无自有落盘销毁入口。' }),
    Object.freeze({ appId: 'comms', name: '会话台', mode: 'irreversible', why: '只读会话面板，无自有落盘销毁入口。' }),
]);

/** 按 appId 取声明（未知 appId 返回 null，不伪造）。 */
export function undoDeclarationOf(appId) {
    const id = String(appId || '').trim();
    if (!id) return null;
    for (const d of UNDO_DECLARATIONS) {
        if (d.appId === id) return d;
    }
    return null;
}

/** 按 appId 取档位（未知返回 'irreversible'：拿不到声明时按最保守口径处理）。 */
export function undoCapabilityOf(appId) {
    const d = undoDeclarationOf(appId);
    if (!d) return { appId: String(appId || ''), mode: 'irreversible', why: '', unknown: true };
    return d;
}

/** 分档统计（UI / 判据共用；不许第二份实现）。 */
export function undoModeCounts() {
    const out = { undo: 0, confirm: 0, irreversible: 0, total: 0 };
    for (const d of UNDO_DECLARATIONS) {
        if (out[d.mode] === undefined) continue;
        out[d.mode] += 1;
        out.total += 1;
    }
    return out;
}

/** 一句话总述（诊断中心卡片的标题行）。 */
export function undoSummaryLine() {
    const c = undoModeCounts();
    return '销毁动作分级：' + String(c.total) + ' 件 App —— 可撤销 ' + String(c.undo)
        + ' / 不可撤销但已确认 ' + String(c.confirm)
        + ' / 不可撤销且未确认（残留账） ' + String(c.irreversible) + '。';
}

export default { UNDO_MODES, UNDO_MODE_ORDER, UNDO_DECLARATIONS, undoDeclarationOf, undoCapabilityOf, undoModeCounts, undoSummaryLine };