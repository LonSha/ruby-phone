# 第二十三期产品证据（2026-11-17）· RubyPhone 侧

> 本文件是 R23 十八项（R23-O1~O9 / R23-X1~X9）的**立项依据留档**。每条结论附可复跑命令与真实读数。
> 纪律：**读数不手抄**（本文数字全部来自下列命令的真实输出），**未跑过的不写**。
> **本期的「36 项」只数产品项**（两仓各 18）：判据套件、台账刷新、门禁不给名额。
> LonSha 侧读数见 lonsha-memory-plugin 仓 `docs/planning/2026-11-17-product-evidence-v23.md`。

## 0. 现场基线

```
ruby-phone-v4155       main = 7cac358   dirty=0   v4.157.0   与 origin/main 同步
lonsha-memory-plugin   main = 550b433   dirty=0   v3.472.0   与 origin/main 同步

ST_PHONE_VERSION = '4.157.0'   manifest.json 4.157.0   package.json 4.157.0   update-log.latest 4.157.0
```

## 0.1 开工前的账实对账（必须先做，不占本期名额）

立项实勘发现：v22 的**拓展九项**（R22-X1~X9）桥文件**确实全落了盘**，
但**优化九项**（R22-O1~O9）多项与 `CHANGELOG` 的「十八项同批交付」措辞不符。

```
wc -l apps/wechat/chat-view.js                     → 19977   （R22-O1 声称已抽渲染内核）
ls apps/wechat/chat-render-core.js                 → 不存在
grep -c 'Date.now()' apps/wechat/chat-view.js      → 83      （R22-O5 声称已分类收口）
coverage_baseline.totals.zero_test_dirs            → 10      （R22-O6 声称已补判据）
event_subscribers.debt                             → 5       （R22-O7 声称已处置）
```

**已真交付的 v22 拓展桥（11 座，本期不得重做，只可复用）**：

```
config/settings-filter.js          config/a11y-audit.js
config/pin-top.js                  config/dnd-schedule.js
config/contact-group.js            config/call-transcript-segments.js
config/diary-search.js             config/wishlist.js
config/chat-bubble-theme.js        config/cross-app-clipboard.js
config/reading-progress.js
```

⇒ 本期第 0 刀：把 R22-O1~O9 逐条按 **已做 / 部分 / 未做** 三态重登，逐条附读数。

### 0.2 一条方法论教训（本期纪律，两仓共用）

立项实勘时曾用 `grep -c 'setting-search|settings-search|settingsSearch|设置搜索' = 0`
判定 R22-O2（设置页搜索）**未做** —— **这是误判**。真实现叫 `config/settings-filter.js`，
导出 `filterSettings`，关键标识符与计划书里写下的名字不一致。

⇒ **本期纪律：关键词命中数不能当判据。** 判定「某能力是否已交付」只认三种证据：
① 判据套件真跑绿；② 台账字段真读数；③ 消费点真调用链（不是字符串登记）。
单靠 grep 名字命中得出的「未做」结论，**必须先找同义实现再下判断**。
→ 反面同样成立：**「grep 命中」也不能当「已做」的证据**（注释里写个名字就命中）。

## 0.3 本仓 v23 现场读数

```
全树 js（排除 node_modules/.git/dist）          878~879 个文件
最大文件：
  27612  data/cheats.js
  19977  apps/wechat/chat-view.js
  14805  index.js
  12363  apps/settings/settings-app.js
  11926  data/gacha-items.js
   9490  apps/honey/honey-view.js
   8721  apps/wechat/wechat-app.js
   5227  apps/honey/honey-data.js

apps/ 目录数            101
config/ js 文件数       345
tests/*.test.mjs        450
```

## 1. 本仓九个真缺口

### 1.1 巨型视图文件仍在长

`apps/wechat/chat-view.js` **19977** 行，R21 立项时 19775（涨 202）。R22-O1 承诺抽渲染内核，实测未抽。
⇒ **R23-O1 抽 `chat-render-core.js`，只搬不改，快照对拍零差异。**

### 1.2 裸钟未逐处分类

```
grep -c 'Date.now()' apps/wechat/chat-view.js → 83
```

R22-O5 承诺「逐处标 wall/story」，实测未分类。⇒ **R23-O2：83 处逐处分类，产出收口进度读数。**

### 1.3 十个 app 目录零测试

```
coverage_baseline.totals: app_dirs 101 / files_on_disk 437 / zero_test_files 115 /
                          zero_test_dirs 10 / coverage_rows 2483
零测试目录：accessdesk caphealth cardtable freehome lexiscore mofo periodmath playbook stickerdesk sullydesk
```

⇒ **R23-O3：逐个补最小行为判据（能 import / 关键投影对 / 不抛），不追行数。**

### 1.4 事件订阅欠账 5 条

```
event_subscribers.json: debt 5 条，zeroUse 空
```

⇒ **R23-O4：逐条写 `resolution`（`wired` 或 `reclassified` + 去向），不许「有理由一直挂着」。**

### 1.5 未读角标多口径

```
grep -rl 'unread-badge|未读角标' apps/ → 3 个文件命中
```

未读判定已收口到 `chat-read-cursor`（R21-X1），但角标绘制仍各自算。
⇒ **R23-O5：角标数一律取唯一出口，App 层不许自算。**

### 1.6 微信无消息全文搜索

```
grep -rl 'message-search|消息搜索' apps/ config/ → 0
```

只有会话列表，没有「在聊天记录里搜一句话」。`apps/search/` 存在但没接 wechat 源。
⇒ **R23-O6：接 wechat 消息源，按剧情时间排序、命中高亮、跳回定位。**

### 1.7 无障碍面稀薄且无基线门

```
apps/ 下含 aria-label 的文件  43
apps/ 下含 role=" 的文件      33
apps/ 下含 tabindex 的文件    13
```

101 个 app 目录，**且没有任何读数守着不让它下滑**。
⇒ **R23-O7：补核心交互面无障碍属性 + 建 `a11y_baseline.json`，判据只许升不许降。**

### 1.8 巨型数据文件与启动全量加载

```
27612  data/cheats.js
11926  data/gacha-items.js
```

⇒ **R23-O8：数据与代码分离，按需加载；判据用调用链证明启动路径不再整份载入（不靠 grep）。**

### 1.9 通知横幅散落

```
grep -rl 'incoming-banner' apps/ → 1 个文件命中
grep -c  '横幅|banner' apps/wechat/wechat-app.js → 多条命中
```

⇒ **R23-O9：收成单一 `incoming-banner` 出口，App 只声明内容不拼 DOM（文案唯一实现）。**

## 2. 复跑命令

```bash
cd /home/user/ruby-phone-v4155
find apps phone config data -name "*.js" | xargs wc -l | sort -rn | head
grep -c 'Date.now()' apps/wechat/chat-view.js
node -e "const d=require('./tests/audit/coverage_baseline.json');console.log(d.totals)"
node -e "const d=require('./tests/audit/event_subscribers.json');console.log('debt',d.debt.length,'zeroUse',d.zeroUse.length)"
ls tests/*.test.mjs | wc -l
node -e "console.log(require('./manifest.json').version, require('./package.json').version)"
```

## 3. 与 LonSha 的关系

L23 的「可回源族」（X1/X6/X7/X9）与 R23 的「时间轴族」（X1/X5/X7）语义互相依赖：
**LonSha 提供记忆层的可回源标识，RubyPhone 提供事件层的时间锚**。
两侧都只报「可回源 / 不可回源」，**不互相猜**，也不把对方的缺失当成自己的结论。