# 第二十二期产品证据（2026-11-16）

> 本文件是 R22/L22 三十六项（双仓各十八）的**立项依据留档**。每条结论附可复跑命令与真实读数。
> 纪律：**读数不手抄**（本文数字全部来自下列命令的真实输出），未跑过的不写。
> **本期的「36 项」只数产品项**：判据套件、台账刷新、门禁不给名额——那是每一项交付时的**默认纪律**，不是计划项。

## 0. 现场基线

```
ruby-phone             main = 9a8adcf  dirty=0   v4.156.0
lonsha-memory-plugin   main = 18ba158  dirty=0   v3.471.0
```

两仓第二十一期（R21/L21 各十八项）**均已全部交付**：R21 十八项 2026-11-16 收口于 v4.156.0；
L21 十八项 2026-11-14 收口于 v3.465.2（拓展面至 v3.466.1）。⇒ 第二十二期是**新立期号**，不与 v21 重复。

## 1. rubyphone：九个真缺口（机器读数）

### 1.1 巨型文件还在长，且没有任何上界门

```
find apps phone config -name "*.js" | xargs wc -l | sort -rn
19931 apps/wechat/chat-view.js     ← v21 立项时 19775，已涨 156 行
12317 apps/settings/settings-app.js
 9488 apps/honey/honey-view.js
 8650 apps/wechat/wechat-app.js
 5618 apps/wechat/wechat-data.js
```

R21-O3 只「补了上界判据」没有拆。读数证明文件仍在长。
⇒ **R22-O1：把 chat-view.js 的消息渲染内核抽成独立模块，行数回落到可维护级；抽解必须行为等价（快照对拍零差异），不是重写。**

### 1.2 设置页 12317 行却零搜索

```
grep -c "搜索设置|settings-search|settingSearch" apps/settings/settings-app.js  → 0
```

12317 行的设置项只能一层层翻。⇒ **R22-O2：设置页跨分区即时过滤（一个输入框过滤所有分区标题与条目，命中高亮，无命中如实说「没有匹配的设置项」）。**

### 1.3 无障碍面稀薄

```
grep -rl "aria-label" apps/ --include=*.js | wc -l   → 30
grep -rl "role="      apps/ --include=*.js | wc -l   → 27
grep -rl "tabindex"   apps/ --include=*.js | wc -l   → 10
```

101 个 app 里仅 30 个文件带 aria-label，10 个带 tabindex——键盘基本不可达。
⇒ **R22-O3：核心可交互面（按钮、输入、列表项）补 aria-label/role/tabindex，键盘可达性做成机器可数的读数。**

### 1.4 微信没有消息全文搜索

```
grep -rl "消息搜索|message-search" apps/ config/ --include=*.js | wc -l  → 0
```

只有会话列表，没有「在聊天记录里搜一句话」。apps/search/ 存在但没接 wechat 源。
⇒ **R22-O4：搜索 App 接一条 wechat 消息源（按剧情时间排序、命中高亮、跳回原会话定位）。**

### 1.5 剩余 story 档裸 Date.now()

```
grep -c "Date.now()" apps/wechat/chat-view.js   → 82
bare-now-whitelist.json 登记                 → 204 条
```

R21-O2 只收了 6 处真·内容时间轴，chat-view.js 那批仍未逐处分类。
⇒ **R22-O5：把 chat-view.js 的 82 处逐处分类（渲染节奏 = wall 档可保留；内容时间轴 = story 档必须收口），收口进度做成机器读数。**

### 1.6 十个 app 目录一行测试都没有

```
coverage_baseline.json: app_dirs 101 / files 437 / zero_test_files 115 / zero_test_dirs 10 / 整体行覆盖 60.95%
零测试目录：accessdesk caphealth cardtable freehome lexiscore mofo periodmath playbook stickerdesk sullydesk
```

⇒ **R22-O6：这 10 个目录逐个补最小行为判据（先保证「能开、不抛、关键投影对」，不追行数）。**

### 1.7 事件订阅欠账 5 条

```
tests/audit/event_subscribers.json: debt 5 条，zeroUse 空
```

emit>0 且 on===0 的 5 条靠台账理由挂着。⇒ **R22-O7：逐条真接订阅或明确改判为「对外遥测 / 跨仓转交」并从 debt 移出，不留「有理由所以一直挂着」。**

### 1.8 通知横幅散落

```
grep -rl "横幅|banner" apps/wechat/wechat-app.js  → 多条命中
```

⇒ **R22-O8：收成单一 incoming-banner 出口（文案唯一实现，横幅样式与生命周期只此一处），各 App 只声明内容不各自拼 DOM。**

### 1.9 未读角标多口径

```
grep -rl "unread-badge|未读角标" apps/ --include=*.js  → 1~2
```

未读判定已收口到 chat-read-cursor.js（R21-X1），但角标绘制可能各自算。
⇒ **R22-O9：角标数一律从 chat-read-cursor 的唯一出口取，App 层不许自己数。**

## 2. lonsha-memory-plugin：九个真缺口（机器读数）

### 2.1 index.js 13201 行单文件

```
wc -l: index.js 13201 · engine-diagnostic-lines.js 5914 · settings-ui.js 5345 · memory-organs.js 3209
```

⇒ **L22-O1：把巨型装配文件按职责拆分（装配 / 注册 / 生命周期各归其位），行为等价。**

### 2.2 台账覆盖判据长红（v3480）

```
node --test upstream:tests/v3480_closeout_fourth_phase.test.mjs  → 独立工作树实测 8 pass / 10 fail
14 个测试文件自 v3.465.2 起未登记进 tests/audit/catalog_reference_consumers.tsv
```

⇒ **L22-O6：把「未登记」与「登记过」区分对待地补登存量（不许用一个「补登」抹平两种事实），让 v3480 回到绿。**

### 2.3 realhost 读数无人读

```
tests/audit/realhost_readings.json: verdict = environment-unavailable / cause = no-st-endpoint
```

生成器在写，但没有门读它——真机不可用时它是「环境事实」，可用时它必须能转绿。
⇒ **L22-O5：给 realhost 读数接一道门：verdict 为 available 时必须真有读数且过阈值；unavailable 时必须如实记 cause——两种状态不同形，不许压成一句「没环境」。**

### 2.4 十一个模块只挂在装载面

```
module_consumption_ledger.json: total 377 / load_surface_only 11
清单：evidence-conflict-adjudication-bench / fact-postgen-replay-receipt / fact-unified-lifecycle-bench /
     generation-material-budget-plan / maintenance-cold-warm-session / meaning-evolution-map /
     memory-action-symbiosis-circuit / memory-task-workbench / project-migration-boundary-bench /
     recall-route-feedback-bench / unified-narrative-clock-axis
```

被 loadAll 取到 ≠ 被业务用。⇒ **L22-O7：11 个逐个真接线到业务路径或明确降级为 declared_dormant（保留文件、不冒充能力）。**

### 2.5~2.9 承接 L21 未闭合的诊断面

- **L22-O2 注入回执全分面**（L21-O5 原项）：回执只覆盖部分注入路径。
- **L22-O3 视图真开**（L21-O6 原项）：27/27 静态可达 ≠ 能真打开。
- **L22-O4 替代证据链**（L21-O3 原项）：条目级证据 → 替代证据链。
- **L22-O8 冻读取新鲜度**（L21-O7 原项）：冻读取会过期。
- **L22-O9 写了不读扫描**（L21-O8 原项）：写了不读的历史两次靠运气发现，要机器扫。

## 3. 复跑命令

```bash
# rubyphone
cd /home/user/ruby-phone-v4155
find apps phone config -name "*.js" | xargs wc -l | sort -rn | head
node tools/audit-event-subscribers.mjs --json | python3 -m json.tool | grep -A2 debt
python3 -c "import json;d=json.load(open('tests/audit/coverage_baseline.json'));print(d['totals'])"

# lonsha
cd /home/user/lonsha-memory-plugin
wc -l index.js engine-diagnostic-lines.js settings-ui.js
python3 -c "import json;d=json.load(open('tests/audit/module_consumption_ledger.json'));print('load_surface_only',sum(1 for m in d['modules'] if m.get('load_surface_only')))"
cat tests/audit/realhost_readings.json | python3 -m json.tool | head
node --test upstream:tests/v3480_closeout_fourth_phase.test.mjs
```
