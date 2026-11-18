# A/B 对照表

- A（旧）：/tmp/rphead
- B（新）：/home/user/ruby-phone
- 操作序列：o1-core-flow.scen.js + o3-media-20.scen.js
- 视口：390x844
- 浏览器：Chromium 131.0.6778.33
- 运行问题：无

读数 27 条：same 17 / diff 1 / only-a 1 / only-b 8 ⇒ changed

| 读数 | 差异面 | A | B |
|---|---|---|---|
| o1-core-flow.scen.js::lock-screen-covers | diff | ok · lock={"w":390,"h":738,"t":46,"l":0} screen={"w":334,"h":726,"t":51,"l":28} | ok · lock={"w":390,"h":738,"t":46,"l":0} screen={"w":335,"h":729,"t":50,"l":27} |
| o3-media-20.scen.js::scenario-threw | only-a | FAIL · Failed to fetch dynamically imported module: http://127.0.0.1:36273/config/media-lifetime. | （没有这条读数） |
| o3-media-20.scen.js::o3-view-reachable | only-b | （没有这条读数） | ok · 相册已开屏；albumView.openPreview/closePreview 可取到，入口=桌面图标 |
| o3-media-20.scen.js::o3-payload-real | only-b | （没有这条读数） | ok · 画布生成 20 张 320x320 PNG，去重后 20 张，最小单张 7938 B，合计约 175 KiB（占位图会被这条拦下） |
| o3-media-20.scen.js::o3-open-close-20 | only-b | （没有这条读数） | ok · 20 轮开/关全部合格：关前 live=1、关后 live=0、句柄 src 真摘、覆盖层节点真出 DOM |
| o3-media-20.scen.js::o3-receipts | only-b | （没有这条读数） | ok · 回执 20 条，ok=true 20 条，台账上限 64（丢最旧、不丢最坏） |
| o3-media-20.scen.js::o3-live-and-dataset | only-b | （没有这条读数） | ok · live=0 残留覆盖层=0 dataset.mlReleased=20（应=20） mlLive=0 mlLastReceipt.ok=true |
| o3-media-20.scen.js::o3-toolbar-visible | only-b | （没有这条读数） | ok · 工具条可见文本=                             全部来源 · 20 项 · 已释放 20           （夹具：getMedia 临时指向本场景 2 |
| o3-media-20.scen.js::o3-switch-path | only-b | （没有这条读数） | ok · 连开 3 张不关：覆盖层 1 个（应=1，换图不留孤儿）、live=1；最后一次关掉 live=0，本轮释放 3 张（应=3） |
| o3-media-20.scen.js::o3-heap-reference | only-b | （没有这条读数） | ok · heap before=22MiB after=22MiB face=same deltaPct=0；本条只作参考 |

