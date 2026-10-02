# 第 3 层剩余缝合总控（2026-10-03 定）

## 硬约束（用户指令，最高优先级）
- **剩余全部缝完之前，一律不跑全量回归**（不跑 `npm run check:file` / `npm test` 全链）。
- 期间只许：单套件 `node --test tests/system-vNNNN.test.mjs`、单道门（syntax 一扇可跑，dead-exports 单脚本、bridge-contract 单脚本）。
- 全量回归只在最后一批收干、最后一次抬版后统一跑一次。

## 剩余源 → 批次（每件仍按老规矩：侦察函数块 → 取治理面 → 套三层 → 改持久化 → 判据套件 → 抬版）

### 批次 A · xinovo 余件（136 文件里未缝的）
已缝：block_system / custom-widgets / shop / piggy_bank / pomodoro / regex_filter / weather。
未缝候选（按机制密度排序，取治理面，不缝网络/宿主/出图/音频）：
- A1 `modules/memory_table.js`（3245 行 / 120 函数，记忆表格一族）
- A2 `modules/moments.js`（2597 行 / 165 函数，朋友圈一族）——查与仓内 wechat/moments 是否撞权威，撞则不缝
- A3 `modules/vector_memory.js`（1849 行 / 80 函数，向量记忆）——与 recall（SullyOS 记忆宫殿）撞权威则不缝或只取差异面
- A4 `modules/journal/automatic-journal.js`（1107 行 / 30 函数，自动日记）——与 diary 撞则取差异
- A5 `modules/sticker.js`（1499 行 / 24 函数，表情包治理）
- A6 `modules/free-home.js`（1558 行 / 70 函数，自由桌面）
- 不缝：video_call / node_system（0 函数、宿主演出面）、chat-ai / mcp / api-*（网络请求面）、settings/*（宿主设置面）、generated/html（DOM 模板面）。

### 批次 B · MyPhone 余件（38 件里未缝的，仓内纪律档案记「只取数据模型那一半」）
已缝：punchcard、weather。
未缝候选：pet.js（2043 行）、food.js（1789 行）、fridge.js（1166 行）、datejournal.js（1108 行）、anniversary.js、memo.js、plan.js、teaparty.js、visa.js、doomsday.js、isekai.js、xiuxian.js、infinite.js、wedding.js、workreport.js、card-table.js、octopus.js（与 ex_octopus 同源？先核）。
不缝：chat.js（宿主主回路）、contacts/settings/forum/lofter/diary/theater（已有权威或宿主面）、beautify/music/qa/story/tarot（仓内已有 tarot 等，逐件核）。

### 批次 C · kawaii 五片（975188 字符，中文注释可读源）
- 05 base.js：向量摘要引擎（getEmbedding / cosineSimilarity / generateVectorSummary / checkAutoSummary 双套）——与 recall 撞则只取「总结格式归一（【标题】【正文】解析、坏行剔除）」治理面
- 08 sandbox.js：虚拟手机沙盒（generatePhoneData / generateBrowserData / generateScheduleData / generateShoppingData 四路生成 + widget 系统）——取「生成数据归一与台账」面
- 06 ui.js / 07 settings.js：宿主渲染与设置面，不缝（第二个权威）

### 批次 D · SullyOS 剩余小件（12 件小物，合计约 40KB）
已缝：WhiteboxSoundEditor（soundkit）、memory-palace（recall）。
可缝：ChatHistoryCleanupModal（聊天清理 13KB）、contentFavorites（收藏 7.7KB）、decorationLibrary（装饰库 4.4KB）、useChatAutoReply（自动回复 4.3KB）、shareCardCanvas（分享卡 2.7KB）、exportGuard（导出守卫 2.3KB）、CharacterGroupFilter（群组过滤 1.3KB）、phoneEvidence（取证 1KB）。
不缝：index 主 chunk / Chat / Settings / BeautyShareChannel（minified React 宿主面）、ttsRouter / voicePlayback / SARSpeechSwitch（已在 soundkit 交棒面）、avatarModelStore / bubbleAppearance（外观面）。

### 批次 E · youyou 一件
- memory-engine-aBBiOmKv.js（269KB，唯一可读业务 chunk）——先侦察与 recall 的差异面，纯重复则不缝并写明理由。
- index 1.8MB React 壳 / react-runtime：不缝。

### 批次 F · meixinji
- db.js（95KB / 2654 行）：数据层——侦察后取「存档结构/关系治理」面
- auth.js（37KB）：登录态治理面（零网络版）
- inline.js（16KB）：内联工具
- 不缝：ai-api.js（网络）、全部 css。

### 批次 G · perigee 剩件
已缝：niconico 一族七件、melonbooks、mercari、pixiv 三片、lofter、magazine。
未缝候选：weibo.js（4031 行，与仓内 weibo 撞权威则不缝）、line.js（3082 行）、twitter 五片（1586+1783+2073+1445+1153，与仓内既有社交件核）、minus-one.js、travel.js、rain/rain-glass.js、tarot.js（撞权威核）、forum 四片（forum/forum-goods/forum-plot/forum-generate）、music.js、broadcast.js、widgets.js（与 widget 撞核）、desktop-edit.js、decorations.js、video-gen.js（出图面不缝）、changelog.js、worldbook.js、utils.js、settings.js、app.js（宿主不缝）。

### 不缝总清单（零机制或第二权威）
- ex_ephone（77 css + 图）、ex_ephone_tk（37 css + 图）：纯样式图源，本仓不缝样式权威
- ex_fluffie（css2.css 697KB + index）：纯样式壳
- ex_octopus（png 图集 + css + index.html）：图集与本仓零外链纪律冲突；css 不缝；**先核其 index.html 是否含业务 js**——octopus.css 一族文件名与 xinovo modules 同名，疑似只是 xinovo 的样式伴生，核实后大概率整件不缝
- src_ephone_full（19 件 minified 单行 html-fragments）：DOM 模板面，无独立机制
- 各源 ai-api / 网络 / 出图 / 音频 / 宿主设置面：按老规矩一律不缝

## 每批交付形态
新件定名 apps/<name>/，四层齐备（data 纯函数内核 / app 取数落盘 / view 视图 / css），判据套件 tests/system-vNNNN.test.mjs（破坏表 + 负控制），抬版五源同源，交棒条写明「已缝/不缝及理由」。
