#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mk_iter102.py — 生成 v3.44.0（迭代 102）的条目真源 items 与迭代段 seg

真源纪律：本文件是**生成器**，产出的 tools/iter102_items.json 与
tools/iter102_seg.md 才是抬版脚本读取的真源（与 iter101_* 同款形状）。
条目共 25 条，每条以【开头、含】、不含方括号（抬版脚本会逐条断言）。
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = '3.44.0'
DATE = '2026-10-08'
NL = '\n'

ITEMS = [
    # 1 定位
    '【定位 · 素材缝合路线图第 3 层第八件：同人商店 · 柜台（Perigee OS「メロンブックス + メルカリ」'
    '两件合一件，合计 2743 行 / 113 方法）】本版把 Perigee OS 的**同人商店与二手市场**缝进本仓：'
    'melonbooks.js（1837 行 / 83133 字符 / 56 方法）+ mercari.js（906 行 / 38414 字符 / 49 方法），'
    '块文件 nuo_sources/nuo3/live/blk_melon.txt（60805 字节 / 526 行）。新件定名 apps/doujin/（同人商店 · 柜台），'
    '四层齐备：doujin-data.js（纯函数内核）/ doujin.css（样式）/ doujin-app.js（取数与落盘）/ '
    'doujin-view.js（视图），按第 3 层范式办理：取机制 → 套三层 → 改持久化'
    '（零数据库 / PhoneStorage / 会话键前缀 /^doujin_/）。',

    # 2 两件合一件的理由
    '【为什么两件合一件：源自己写着「周边は将来の Mercari モジュールへ」】源 melonbooks.js 的定数注释逐字写着'
    '「goods（グッズ）は旧データ表示用に残す。新規生成では使わない」——**周边是旧数据，新规不再产**，'
    '而它的去处正是 Mercari 那一面。商店与二手市场在源里本就是**一条流水线**：商店出货 → 周边 → 市场转手。'
    '拆成两件会把「同一件周边的两次身价」劈开（一次是店头标价，一次是转手价与稀有度倍率），'
    '故本版判成一件：商品五型里的 goods 标成 DJ_LEGACY_TYPES（旧数据照显、新生成不产），'
    '新生成四型（DJ_GENERATABLE_TYPES）另列。',

    # 3 立场差
    '【立场差 · 源是「店员而且是收银的那个人」，本件是「柜台」】源自己起 AI 会话生成新刊与市场行情、'
    '自己把出售按钮接进钱包余额与交易流水 LinePay、自己按剧情节点推进售罄与价格波动、'
    '自己直读宿主界面元素（getElementById 二十余处）。本件是**柜台** —— '
    '只把商品 / 社团 / 即卖会 / 二手在售收拾成一份**账**，产**可复制的要求文本**（requestText），'
    '把价算准、把不合法行逐条报出来。本件不起会话、不接钱包、不出图、不读宿主界面。',

    # 4 缝什么 · 价格解析三态
    '【缝什么 · 价格解析三态：一个数字都没有不许读成 0】源把「¥500」与「面议」同得 0'
    '（剥非数字 → parseInt → 再 || 0），于是「没数字」与「真的 0 元」同形。本件 priceOf 分三态报：'
    'ok / no_digits / over_limit，逐行报是第几行、原文是什么。★ 源的四条定价规则里'
    '「万以上按千、千以上按百、其余按十」本件照抄到 roundPrice 三档，不自己发明数字。',

    # 5 缝什么 · 商品行逐行拒收
    '【缝什么 · 商品行逐行拒收（源是一条静默跳过、整件商品被丢）】源 _generateProducts 里'
    '「找不到社团就把整条商品丢掉」，用户看不出为什么少了一件。本件 classifyProducts 逐行裁定：'
    'ok / no_title / no_price / over_limit，rejected 逐条带行号与原文与 why。'
    '★ 行 id 按**行号**稳定派生（有外部 id 时优先，无则 row + 序号）：行号与 id 两套标号'
    '各说各话时视图点不中那一行。',

    # 6 缝什么 · 合计逐行回报
    '【缝什么 · 合计逐行回报（源把读不出来的行当 0 加进去）】源把每行 parseInt 的结果再 || 0 加进合计，'
    '一行读不出来就少算一笔且不报。本件 cartTotal 逐行回报：合法行的钱照算、读不出来的行进 bad 列，'
    '并且 **ok=false 时合计标「不可信」** —— 不可信的车**不许照样结**（源扣完才说）。',

    # 7 缝什么 · 热度三分量与盲盒分形
    '【缝什么 · 角色热度三分量不塌成一个数（源只返回一个数）】源只返回一个数，'
    '「为什么被炒到 4 倍」用户对不出来。本件 characterHeat 分三分量报：在售周边归属数 / '
    '剧情节点文本命中数（按位置加权）/ 名字出现数，三格各自带值。'
    '★ 盲盒与普通周边**不同形**：盲盒按**单款角色热度**、普通周边取 charNames **最高**热度 —— '
    '源两路都只返回一个数，塔平了就分不出「这一盒里是谁」。',

    # 8 缝什么 · 出品个体价可复现
    '【缝什么 · 出品个体价：同一 roll 必得同一个价（源用 Math.random，判定不可判）】'
    '源 listingPrice 里直接取 Math.random，同一个出品每次问都是新价。本件把**随机数提到参数位**（roll），'
    '同一 roll 必得同一个价 —— 判据才判得动。定价系数表 DJ_PRICE_RULES 逐条照抄源'
    '（黄牛 2.0+rand*3.0 / 赝品 0.7+rand*0.4 / 普通 0.8+rand*0.5 / 急售 15% 概率 0.5+rand*0.2，'
    '本件列成表让「为什么黄牛这么贵」可对）。',

    # 9 缝什么 · 售罄比例与出品规划
    '【缝什么 · 售罄比例四步与出品规划（源不留痕）】soldRatioOf 四步：没绑剧情节点与绑了不同形'
    '（源界面没有这一格，全靠翻列表数）；variantPlan 的基数 / 加成 / 概率逐条对齐，'
    '且概率另给「约每几件出一件」（概率是「几个人里出一个」的语义，源只报个小数）。',

    # 10 缝什么 · 重定价读数
    '【缝什么 · 重定价逐条报旧价 / 新价 / 幅度（源静默改价）】源 refreshMarket 里重新定价，'
    '幅度超过阈值才算「明显变动」，改了什么一个字都不说。本件 repriceOf 逐条报：'
    '旧价 / 新价 / 幅度 / 是否超阈值；且读数必须**每轮重算**（本件第一版只在构造里清一次，'
    '于是越列越长 —— 动作口改完内存字段必须紧跟一次重算）。',

    # 11 缝什么 · 上限余量
    '【缝什么 · 上限余量四项与存档分档（源顶到上限只丢一句「已裁剪」）】源把上限写死在若干处、'
    '顶到上限就截、只说一句已裁剪。本件 readingsOf / gaugesOf 收成一处余量面（四项读数 / 上限），'
    '★ 读数**一律不编 0**：取不出来是 null（视图画横线），不是「真的 0」。'
    '存档份数上限与商品件数上限**分成两个常量**（DJ_SHELF_STORE_MAX / DJ_SHELF_MAX）：'
    '源把两件事挤在一个数上，改一处会静默改另一处。',

    # 12 缝什么 · 台账与裁边计数
    '【缝什么 · 台账挤掉旧记录要计数（源静默 shift）】源动作流水满了一挤了之，挤掉几条不报。'
    '本件 ledgerTrim 逐笔留痕、挤掉要报数（ledgerInfo 的 dropped）。'
    '★ 清店头与车时**不顺手清台账**：源把四类挤在一个大对象里，一个「清空」按钮会连在售台账一起清。',

    # 13 四条偏离
    '【四条偏离 · ① 价格解析不许把「没数字」读成 0】源「¥500」与「面议」同得 0，本件三态分报。',

    # 14 四条偏离
    '【四条偏离 · ② 商品行不许静默跳过】源找不到社团就丢整条，本件逐行报 why 与原文。',

    # 15 四条偏离
    '【四条偏离 · ③ 价格档不许只丢一句「波动了」】源改价不说，本件报旧价 / 新价 / 幅度。',

    # 16 四条偏离
    '【四条偏离 · ④ 盲盒与普通周边不许同形】源两路都返回一个数，本件按热度口径分形'
    '（盲盒单款 / 普通取最高）。',

    # 17 四块不缝 · 零钱包
    '【四块不缝 · ① 不连钱包】源 purchase() 直接扣钱包余额并写交易流水（LinePay）。'
    '本件结账**只动本件的车与历史**，四件里一个钱包 / 流水调用都没有（判据 D1 逐词扫）。',

    # 18 四块不缝 · 零网络 / 零出图 / 零宿主读
    '【四块不缝 · ② 不落库不落外部备份 ③ 不出图 ④ 不读宿主界面元素】'
    '② 源 Utils.saveData / IndexedDB / GitHub 备份 —— 本件只走 PhoneStorage 四条会话键'
    '（doujin_shop / doujin_market / doujin_cart / doujin_ledger，storage 出口收敛成 get / set 两个口）；'
    '③ 源 _buildCoverPrompt + dispatchGenerate 逐件出封面 —— 本件零出图、零 URL、零 data URL、'
    '零图片扩展名、零索引库；④ 源满篇 document.getElementById 直读宿主元素 —— 本件不直读宿主元素'
    '（视图只经 App 取数，App 只经 storage 取数）。',

    # 19 四条会话键与隔离
    '【四条会话键：四类分开存，全走 /^doujin_/ 前缀随会话隔离】doujin_shop（店头 + 存档）/ '
    'doujin_market（二手在售 + 收藏 + 赝品标记）/ doujin_cart（待结行 + 已结历史）/ '
    'doujin_ledger（动作台账）。四条键已在 scripts/keys-audit.mjs 登记 scope: chat。'
    '★ 为什么四条分开：源把四类全塞进一个 AppState.data 大对象 —— 换角色后四类一起串味，'
    '而清购物车顺手把在售台账也清了。',

    # 20 六处接线
    '【六处接线落点（少一处就静默错数据 / 点了没反应）】config/apps.js 的 APPS 一项、'
    'config/storage.js 的 CHAT_DATA_PATTERNS 一条宽前缀、scripts/keys-audit.mjs 四条键登记、'
    'index.js 的懒加载分支与 window.VirtualPhone.doujinApp 挂载、index.js 的表单字段登记表一项'
    '（贴回的商品原文 / 二手在售原文 / 要求文本草稿）、phone.css 的样式段投递（与 doujin.css 逐字同源）。',

    # 21 实现纪律
    '【本件实现纪律（四条，都由判据 J6 守住）】① apps/doujin/ 四件**不许出现正则字面量**'
    '（本仓剥注释器是字符状态机、不解析正则）；② **不许出现反斜杠**；③ 也不许出现反引号'
    '（模板字符串禁用）；④ 一切字符切分走 indexOf / slice / split。'
    '⑤ 视图层与号、双引号与单引号一律走**拼装形**（String.fromCharCode）—— 落盘链会把实体解码；'
    '⑥ 行 id 按行号稳定派生；⑦ **售出状态只有一个真源词 sold_out**；'
    '⑧ **动作口只落行、裁定归 classifyProducts 一处**。',

    # 22 真缺陷（产品侧五处）
    '【本版自己抓到的产品侧真缺陷（五处，全部由本版判据首跑抓出）】① **priceOf 只认字符串**，'
    '而 ingestShopText 落库存的是数字（800）⇒ classifyProducts 按字符串核 ⇒ 写成数字的行全被判 no_price ⇒ '
    '**收下的商品在投影面全消失**（「收下了却一件都没进店头」，不报错不崩溃只错结果）；'
    '② **priceText 存 cleanText(p.price)**，数字形态时为空 ⇒ cartTotal 核价失败 ⇒ '
    '**车里合计永远是 0 且不可信**；③ **ingestShopText 把坏行丢掉**（不落 _productsRaw）⇒ '
    '投影面 rejected 永远为空 ⇒ 视图画不出拒收行（用户连「为什么没收」都查不到）；'
    '④ **_extractList 把「有开括号但没闭合」误判成 no_bracket**（应为 bad_json）—— '
    '两件事挤成一个键时用户会去重贴文本，而真因是括号写残了；'
    '⑤ **sold 与 sold_out 两套状态词各说各话**：统计侧认 sold、而词表里根本没有这个键（是 sold_out）⇒ '
    '「标已售出」点下去界面变了、统计里却仍算作「在售」。修法：加 DJ_SOLD_KEYS + isSold() 当**唯一口径**。',

    # 23 判据面自身缺陷
    '【判据面自身缺陷（本版首跑暴露九处，逐条修）】① 套件 shopJson / listingJson 用**单引号**拼 JSON ⇒ '
    'JSON.parse 必败 ⇒ 整族 B 组红且**看起来像产品缺陷**（改用双引号 DQ）；'
    '② A16 用例词写 sold（与产品同错，判据跟着错）；③ I4 热度判据太松（只断言三字段在场，'
    '抓不住「算的时候只用了一个分量」）⇒ 加逐分量对照；④ appGateProblems 用了 APP 未导出的常量'
    '（undefined ⇒ 循环不跑 ⇒ 假红）；⑤ I13 观测点（跨实例验会漏，改回同实例内存投影）；'
    '⑥ I17/I18 真口径是「换出去再换回来，账要还在」；⑦ I20 需逐项自成字面；'
    '⑧ I21/I22 需咬住「三元回横线」「带 blank 标记」「!blank 才着色」；⑨ I24 需按位置逐项对上。'
    '★ 判据纪律：**不许只查「关键词在场」**——必须咬住可观测的行为（数值 / 路径 / 跨实例结果），'
    '否则破坏落在同类词上时判据会假绿。',

    # 24 破坏表锚点
    '【破坏表锚点（DAMAGE 二十五条）本轮重挂四处】q13 落 `if (!box.ok)` 失败分支并**顺手加 _recompute()**'
    '（否则清了内存不重算投影，观测不到，是装饰性破坏）；q17 把 _clearToDefaults() 与 probe() 一起拿掉；'
    'q19 清车改写等价形（`splice` 清车那句替代赋值清车 + 另插一句清店头）；'
    'q20 改 `malformed: ok`；q22 咬 djn-gauge-num 的 blank 标记；q23 咬 `if (!r.blank) {`。'
    '★ J2 会查「替换后原串残留为零」：替换串**不许原样包含锚点**。',

    # 25 运行时验证边界 + 抬版 + 交棒
    '【运行时验证边界 + 版本升至 3.44.0（五源同源）+ 交棒改写】本版能验的是：价格三态不编 0 / '
    '商品行逐行拒收 / 热度三分量与盲盒分形 / 重定价逐条报 / 合计不可信不许照样结 / 上限余量 null 与 0 不同形 / '
    '四条会话键随会话隔离 / 六处接线落点齐备 / 四件零钱包零网络零出图零宿主读 / '
    '负控制二十五条都真响过（含本轮重挂的四处）。**不能保证**的是：① 真宿主实机里的落盘 / 会话隔离 / '
    '换会话重绑实况（本仓至今没有可运行浏览器的验证环境）；② 真机上贴一份商品原文与一份二手在售原文进来后的'
    '观感与长列表排版；③ 窄屏上的排版与观感（本件是六页签 + 逐条卡片条型界面）。三条均仍归 R-O3'
    '（真宿主实机验证）：这类形态的共性是**不报错、不崩溃、只错结果 —— 看起来没坏但显示不对**，'
    '本版只能挡住机制面。五源同源抬版：manifest.json / package.json / update-log.json 首位新键 + latest / '
    'index.js 的 ST_PHONE_VERSION 常量与公告块 / ITERATION_LOG.md 头部迭代段。'
    '★ 交棒：本件收干后，Perigee OS 的「商店 + 二手市场」两件（melonbooks 1837 行 + mercari 906 行，'
    '合计 2743 行 / 113 方法）**已全部处置完毕**；可取的是价格解析 / 行核 / 热度与盲盒分形 / 出品定价 / '
    '售罄与重定价 / 上限余量 / 台账裁边这一层治理面，不缝的是钱包 / 出图 / 网络 / 宿主界面读。'
    '第 3 层下一步转同批其它源（ephone 全量两套 / perigee / xinovo / fluffie 四款 / '
    'src_sully / src_youyou / src_meixinji / src_myphone 四套），按「先侦察函数块、再取治理面」的老规矩办。',
]

assert len(ITEMS) == 25, len(ITEMS)
for i, it in enumerate(ITEMS):
    assert isinstance(it, str) and it
    assert it.startswith('【') and '】' in it, i
    assert '[' not in it and ']' not in it, i
    assert NL not in it, i

raw = {'version': VER, 'date': DATE, 'items': ITEMS}
with open(os.path.join(ROOT, 'tools', 'iter102_items.json'), 'w', encoding='utf-8') as f:
    json.dump(raw, f, ensure_ascii=False, indent=2)
    f.write('\n')

head = ('## 迭代 102 — v3.44.0 素材缝合路线图第 3 层第八件：同人商店 · 柜台'
        '（Perigee OS メロンブックス + メルカリ 两件合一件 2743 行 / 113 方法）'
        '（价格三态不编 0 / 商品行逐行拒收 / 合计不可信不许照样结 / 热度三分量不塌 / 盲盒与普通周边分形 / '
        '出品个体价可复现 / 重定价逐条报 / 台账裁边计数 / 上限余量 null 与 0 不同形 / 四键会话隔离 / '
        '六处接线 / 四块不缝 / 四条偏离）'
        '+ 抓五处产品真缺陷（含 priceOf 只认字符串与 sold 两套词两处「不报错只错结果」）'
        '+ 判据面自身错九处（含单引号拼 JSON 让整族红且看起来像产品缺陷）+ 重挂四处破坏锚点 + 抬版收干（第 3 层第八件）')
body = NL.join('- **' + it + '**' for it in ITEMS)
seg = head + NL + body + NL
with open(os.path.join(ROOT, 'tools', 'iter102_seg.md'), 'w', encoding='utf-8') as f:
    f.write(seg)

print('items =', len(ITEMS))
print('items.json 字节 =', os.path.getsize(os.path.join(ROOT, 'tools', 'iter102_items.json')))
print('seg.md 字节 =', os.path.getsize(os.path.join(ROOT, 'tools', 'iter102_seg.md')))
print('seg 首行 =', head[:80])
print('seg 行数 =', seg.count(NL))
