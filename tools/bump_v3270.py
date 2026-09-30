#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bump_v3270.py — 抬版 v3.27.0（五源同源）

做什么：
  ① update-log.json：新键插**首位**（仓内约定，v3.23.0 踩过「追加末尾」的坑），latest / head 同置；
  ② manifest.json / package.json / index.js 的 ST_PHONE_VERSION 常量；
  ③ index.js 的 ST_PHONE_CURRENT_UPDATE 公告块 —— **由 update-log 条目生成**（逐字同源，不手抄）；
  ④ ITERATION_LOG.md：头部插迭代 85 段 + 元信息「当前版本」行改当版。

纪律：
  · 本脚本只写上面四处；先算 draft、逐份断言、最后才落盘（一次成型的写入不许留半成品）。
  · 默认 dry-run，`--write` 才落盘。
  · 公告块由条目列表 dumps 生成，不做字符串拼贴（条目里含引号也逐字对得上）。
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = '3.27.0'
DATE = '2026-09-30'

WRITE = '--write' in sys.argv


def rd(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def wr(rel, text):
    with open(os.path.join(ROOT, rel), 'w', encoding='utf-8') as f:
        f.write(text)


# ────────────────────────── 条目（12 条） ──────────────────────────
ITEMS = [
    "【本版做什么 · 素材缝合路线图第 1 层余下四件：头像框 / 商城 / 拉黑 / 天气一次落地】上一版落了两件（正则过滤器与打卡），本版按同一套骨架**一次落四件**，把第 1 层除「自定义组件」外的余下小件全部收干。四件的源各带一块**本仓明令禁止**的东西，正好把「缝合不是搬运」这条规矩从四个方向同时钉住：一个不许接外链图床、一个不许替用户叫模型、一个不许往宿主对象上挂字段、一个不许自己发请求。",

    "【起手先复算：路线图第 1 层清单当场失真的那一格】按 TODO 硬性要求「起手前按当场 grep 复算缺口矩阵」，先量了一遍第 1 层清单。清单写着「头像框 / 商城 / 自定义组件 / 拉黑 / 天气五件未开工」，而其中**四件正是本版要落的**；复算后确认唯一真缺口只剩**自定义组件**。教训与上一版同：路线图是上一轮读源材料时的判断，**不是事实**，每轮起手必须重新量一遍。",

    "【头像框 · 缝什么】源 EPhone·xintuk 的 avatar-frames/001.js（打包载荷 51639 字节 / 1823 行）里**只有数据** —— 一个 365 条的 avatarFrames 表（364 条带图 + 1 条「无」），真正的换框逻辑在 main-app/033.js。取三块真价值：**「无框」是一个正式选项**（面板里必须有一条「摘掉」，否则选上去就下不来）、**按 URL 去重**（365 条里 id 只有 123 个唯一值，frame_14 一条重复 82 次 ⇒ id 不是身份、URL 才是）、**选中态跟着 URL 走**（同一条框在两个挂载点上可以同时用，id 撞了也不影响判断）。",

    "【头像框 · 不缝什么】源 364 条框**全部**指向 i.postimg.cc 外链图床，且上传的框 base64 化后直塞自定义框表（Dexie）。前者违本仓「新增模块零外部请求」判据，后者违零数据库铁律 ⇒ 本件**一条 URL 都没有**，只做「认得出你贴进来的是什么」（六态分类：空 / 预置 token / data-url / blob / 外链 / 非法），预置框由用户从源材料导入。源里六个挂载点也只留两个（我 / 本会话角色）—— 另外四处在本仓没有对应对象，硬缝会造出无处落地的键。",

    "【商城 · 缝什么、不缝什么】源 EPhone·xINOVO 的 js/modules/shop.js（1068 行 / 38254 字符）。取三块：**分类可扩展且带「它想卖什么」的说明**（并要防 id 撞车 —— 源明确拦了 5 个默认 id）、**购物车是「条目 + 数量」二元组**（同一个东西可以加两份，结算要按数量算）、**自提口令忽略大小写与空格**才比对得上。不缝三块：① 源的商品桶是**空的**、装的是「等模型填」的位置（商品由角色接口按分类现生成）—— 本仓模型调用一律走宿主，故本件只做目录 / 车 / 订单 / 余额，商品由用户登记；② 源 handlePickupConfirm 遍历聊天历史、用正则**从正文里抠口令** —— 本仓正文归属在聊天层，App 读正文＝在别人的账本上写第二套账，且正则一漂移就静默判「没找到」，故口令改由本 App 自己签发；③ 源直写 dexieDB.characters.update(...) ⇒ 换 PhoneStorage。另有三处偏离逐条写明：钱的单位一律**整数分**、数量与单价都设上限、下单是**快照不是引用**（源订单存引用，商品改价后历史订单会跟着变）。",

    "【拉黑 · 缝什么、不缝什么】源 EPhone·xINOVO 的 js/modules/block_system.js（530 行 / 27324 字符）。取三块：**两本账对称且各有各的历史**（你拉黑它 / 它拉黑你，带时间与理由 —— 不是一条布尔）、**申请有频次语义**（fixed 固定间隔、默认 30 分 / auto 让它自己决定何时再来）、**拒绝要留理由**（理由会进下一次申请，是它记仇的材料）。不缝三块：① 源把拉黑标记**写在宿主角色对象上**（按角色 id find 后挂 isBlocked）—— 本仓角色对象归宿主，App 不许往上挂字段，故改为**本会话的一本账**；② 源自己把角色人设拼成 system prompt、调接口、解析模型的接受 / 拒绝字段 —— 本仓模型调用走宿主生成侧，故申请一律落成 pending 等生成侧回，本件只提供「记为接受 / 记为拒绝（含理由）」两个落定口；③ 源起了 **60 秒常驻轮询** —— 本仓不做后台轮询，改为 cooldownRemaining() **读数**（该不该置灰由读数说话，不靠一个自己转的定时器）。",

    "【天气 · 缝什么、不缝什么】源两路：xINOVO 的 weather.js（250 行）取**结构**（角色 / 用户各一份、把天气转成一句自然语言塞给生成侧、24 小时缓存那条时效概念），MyPhone 的 weather.js（483 行）取**事实模型**（WMO 码表与「算不算下雨」那张表 —— 这两张是**知识**，不是请求）。不缝三块：① 四家 provider 直连与两处 fetch ⇒ 本件**一条 URL 都没有**，天气事实由宿主或用户填进来；② 定位接口 ⇒ 本仓不碰权限面，城市名是一个**由用户填的字符串**，本件不解析、不换算；③ 源直开另一个 App 的数据库读任务表来决定提醒谁 ⇒ 零数据库铁律，且**一个 App 不该读另一个 App 的表**，提醒这件事本件不做。另把源「24 小时前的数据照样当当前天气用」改成**读数**：只标「未必是当下的」，**不删数据**（删了就变成「怎么没了」）。",

    "【本版自己抓到的缺陷 · 三类，都不是门禁抓的】① **重建脚本里的作用域错**：列表推导式里用了从未绑定的名字，实跑当场抛未绑定错误 —— 典型的「看着像对的、跑起来才发现」，改为逐键比对。② **先写后校验**：重建脚本首版把基线里的 file 字段断言成自己那一份，而其中一份的历史值指向**探针**而非基线 ⇒ 断言在**前三份已落盘之后**才炸，留下半成品；处置是回滚干净基线再重做，并把校验**前移**（先算稿、逐份断言、最后才落盘）。③ **判据把正常平移当成漂移**：逐字比对拦下了两处行号后移，而那是本版 index.js 追加懒加载分支与重绑键后的**预期后移**（形态未变）；改为「计数与文件名单逐项不变、只允许行号后移」，并把后移详情打进 dry-run 日志。",

    "【判据面 · tests/system-v3270.test.mjs（35 条）】A 段 4 条守头像框内核（六态认源与可落地门控 / 预置清单真解析且坏条目如实报 malformed / 身份是 URL 而不是 id / 归因与投影：框已被删而挂载点还指着它必须标 orphan）；B 段 5 条守商城内核（钱一律整数分 / 分类可扩展但默认 id 撞车必须拦 / 购物车条目+数量与缺货单独计数 / 下单是快照不是引用与口令忽略大小写空格 / 归因与投影）；C 段 4 条守拉黑内核（两本账对称、重复拉黑不开第二段历史 / 申请不叠第二条、接受即自动解除 / 倒计时是读数不是定时器 / 归因与投影）；D 段 3 条守天气内核（码要翻成人话、未知码不猜 / 城市与温度至少一个、码非法不拒收 / 过期只标未必是当下的、不删数据）；E 段 5 条守接线（四件各四处注册齐备 / **视图调用面必须闭合在 App 上** / 样式源与 phone.css 逐字同源且每个类名都有落点 / 四条前缀全仓唯一 / 四件套齐备且数据层保持纯函数）；F 段 1 条守键归属（十二条新键在门禁账本里且 scope=chat）；G 段 10 条负控制（真源码破坏 → 按真目录结构加载破坏副本 → 在同款真判据上必须转红，各配反向自证）；H 段 2 条判据工具自证（剥注释器两向 / 破坏表锚点在场性与替换保真）。",

    "【抬版交棒改写 · 四份活基线与一条取段口径】本版新增四个 App 使四份审计活基线当场漂移：枚举面 257/258 → 269/270；生命周期读数 App 类 42 → 46、实例槽位 55 → 59、签名无参出口 32 → 36；会话隔离静态模式面 114 → 130（新增四条真前缀与配套注释行，探针按文本行计）。按仓内既有通道逐份重建：新建 tools/rebuild_v3270.py（**读数零手抄**、以探针 --json 现场输出落盘），并在每份 rebuilds 下登记 v3.27.0 的 why 与未动字段；冻结面（写「未复核」的那些）按既有口径**不刷新**。另交棒一条取段口径：上一版那套件里样式同源判据原按「本版段头 → 文件尾」取段，而 phone.css 是**追加式**产物 ⇒ 本版往后接了四段，取到文件尾会把新段并进来、以「逐字同源失败」**假红**（红的原因不是样式漂移，是取段口径没跟上传送带）；已改为**按下一个段头截断**，本版新套件 E 段沿用同款。",

    "【边界文档复校 · 当版实测数字】docs/runtime-verification-boundary.md 的复校标记改为 v3.27.0，两道真门读数改为语法 486 文件 / 导入 282 文件 439 条（新增 13 个 .js = 四件 App 各三层共 12 个 + 本版判据套件 1 个；四件的样式文件是 .css，不计入语法面），并追加 v3.27.0 复校段（能验 / 不能保证三条 / 归 R-O3）。四份活基线的判据散文一并复算，与探针现场逐字对上。",

    "【落地 · 版本升至 3.27.0（五源同源）】新建 apps/avatarframe/ / apps/shop/ / apps/block/ / apps/weather/（各四件：纯函数内核 / 落盘与接线 / 界面 / 源样式）；config/apps.js 登记四条；config/storage.js 加四条会话隔离前缀（覆盖 12 条键）；index.js 加四个懒加载分支与四条重绑键；scripts/keys-audit.mjs 登记十二条新键；phone.css 打包本版四段样式（与源逐字同源）；新建 tests/system-v3270.test.mjs 与 tools/rebuild_v3270.py；四份审计活基线按探针现场输出零手抄重建。【运行时验证边界（诚实登记）】本版能验的是：四件纯函数内核的全部口径在真模块上都成立、四处注册齐备（APPS / 懒加载分支 / 重绑表 / 会话键前缀）、视图调用面闭合（产出的每个类名都有样式落点或选择器锚点）、样式源与 phone.css 打包产物逐字同源、十二条新键已登记且键归属门全过、十条负控制都真响过（各配反向自证）、四份活基线零手抄重建、既有门禁与既有判据无一倒退。**不能保证**的是：① 真宿主实机里的落盘与会话隔离实况（本仓至今没有可运行浏览器的验证环境）；② 窄屏上的排版与观感（四件都是面板型界面，320px 下挤不挤只有真机能答）；③ 四件的「不叫模型 / 不读正文 / 不碰宿主对象 / 不发请求」是**本仓侧**的结构事实，宿主那一侧将来若有人再挂一个同类实现，本层看不到。三条均归 R-O3（真宿主实机验证）：这类形态的共性是**不报错、不崩溃、只错结果** —— 看起来没坏但显示不对，本版**不能保证**该形态在真机上一出现就被发现。",
]

assert len(ITEMS) == 12, '条目数必须为 12（仓内一贯规模），实得 %d' % len(ITEMS)

# ────────────────────────── ① update-log.json ──────────────────────────
log_rel = 'update-log.json'
log = json.loads(rd(log_rel))
assert log['latest'] == '3.26.0', '抬版前 latest 应为 3.26.0，实得 ' + str(log['latest'])
assert list(log['versions'])[0] == '3.26.0', '抬版前首位键应为 3.26.0'
assert VER not in log['versions'], '目标版本已存在，禁止重复抬版'

entry = {'version': VER, 'date': DATE, 'items': ITEMS}
new_versions = {VER: entry}
for k, v in log['versions'].items():
    new_versions[k] = v
new_log = {'latest': VER, 'versions': new_versions, 'head': VER}
assert list(new_log['versions'])[0] == VER

# ────────────────────────── ② manifest / package ──────────────────────────
man = json.loads(rd('manifest.json'))
pkg = json.loads(rd('package.json'))
assert man['version'] == '3.26.0' and pkg['version'] == '3.26.0'
man['version'] = VER
pkg['version'] = VER

# ────────────────────────── ③ index.js ──────────────────────────
idx = rd('index.js')
old_const = "const ST_PHONE_VERSION = '3.26.0';"
assert idx.count(old_const) == 1, '版本常量锚点必须恰中 1 次，实得 %d' % idx.count(old_const)
idx_new = idx.replace(old_const, "const ST_PHONE_VERSION = '%s';" % VER)

BLOCK_RE = re.compile(r'const ST_PHONE_CURRENT_UPDATE = \{[\s\S]*?\n\};')
mb = BLOCK_RE.search(idx_new)
assert mb, 'ST_PHONE_CURRENT_UPDATE 块必须可提取'
lines = ['const ST_PHONE_CURRENT_UPDATE = {',
         '    version: ST_PHONE_VERSION,',
         '    date: "%s",' % DATE,
         '    items: [']
for it in ITEMS:
    lines.append('        ' + json.dumps(it, ensure_ascii=False) + ',')
lines.append('    ]')
lines.append('};')
new_block = '\n'.join(lines)
idx_new = idx_new[:mb.start()] + new_block + idx_new[mb.end():]
assert idx_new.count('const ST_PHONE_CURRENT_UPDATE = {') == 1
# 逐字同源自证：公告块里每一条都必须能被 JSON.stringify(it) 找到
for it in ITEMS:
    assert json.dumps(it, ensure_ascii=False) in idx_new, '公告块缺条目：' + it[:20]

# ────────────────────────── ④ ITERATION_LOG.md ──────────────────────────
iter_rel = 'ITERATION_LOG.md'
itlog = rd(iter_rel)
old_ver_line = '- **当前版本**：`3.26.0`（五源同源）'
assert itlog.count(old_ver_line) == 1, '元信息版本行锚点必须恰中 1 次'
itlog = itlog.replace(old_ver_line, '- **当前版本**：`%s`（五源同源）' % VER)

SEG = rd('tools/iter85_seg.md')
anchor = '## 迭代 84 — '
assert itlog.count(anchor) == 1, '迭代 84 段头锚点必须恰中 1 次'
itlog = itlog.replace(anchor, SEG.rstrip('\n') + '\n\n' + anchor)
assert itlog.count('## 迭代 85 — ') == 1

# ────────────────────────── 落盘 ──────────────────────────
print('== dry-run 摘要 ==')
print('update-log: latest=%s first=%s 版本数 %d → %d' % (VER, list(new_log['versions'])[0], len(log['versions']), len(new_versions)))
print('manifest/package: version → %s' % VER)
print('index.js: 常量 + 公告块（%d 条）' % len(ITEMS))
print('ITERATION_LOG: 迭代 85 段 + 当前版本行')
if not WRITE:
    print('（dry-run，未落盘；加 --write 才写）')
    sys.exit(0)

wr(log_rel, json.dumps(new_log, ensure_ascii=False, indent=2) + '\n')
wr('manifest.json', json.dumps(man, ensure_ascii=False, indent=2) + '\n')
wr('package.json', json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')
wr('index.js', idx_new)
wr(iter_rel, itlog)
print('== 已落盘 ==' + ' latest=%s' % json.loads(rd(log_rel))['latest'])
