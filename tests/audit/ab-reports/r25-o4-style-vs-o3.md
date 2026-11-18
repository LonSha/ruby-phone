# A/B 对照表

- A（旧）：/tmp/rphead
- B（新）：/home/user/ruby-phone
- 操作序列：o4-style-lazy.scen.js
- 视口：390x844
- 浏览器：Chromium 131.0.6778.33
- 运行问题：无

读数 10 条：same 2 / diff 8 / only-a 0 / only-b 0 ⇒ changed

| 读数 | 差异面 | A | B |
|---|---|---|---|
| o4-style-lazy.scen.js::o4-boot-to-interactive | diff | ok · 从脚本开始到可交互（VirtualPhone 就绪 + 桌面出图 + 弹窗处理完）=12280ms；本条只作参考值，不判红 | ok · 从脚本开始到可交互（VirtualPhone 就绪 + 桌面出图 + 弹窗处理完）=12257ms；本条只作参考值，不判红 |
| o4-style-lazy.scen.js::o4-probe-not-applied-at-boot | diff | FAIL · 首屏探针 --nsm-bg="#eef1f6" --snd-bg="#10161d"（都应空串：空=样式确实不在首屏） | ok · 首屏探针 --nsm-bg="" --snd-bg=""（都应空串：空=样式确实不在首屏） |
| o4-style-lazy.scen.js::o4-first-paint-css-bytes | diff | ok · phone.css 首屏载入文本长度=684111字符（真 fetch 量的；源文件 623617 字节 —— 中文占多字节，字符数天然小于字节数） | ok · phone.css 首屏载入文本长度=595899字符（真 fetch 量的；源文件 623617 字节 —— 中文占多字节，字符数天然小于字节数） |
| o4-style-lazy.scen.js::o4-open-feeds-style | diff | FAIL · link#app-style-needsim 载入并解析=false；打开后探针 --nsm-bg="#eef1f6"（非空=样式真生效） | ok · link#app-style-needsim 载入并解析=true；打开后探针 --nsm-bg="#eef1f6"（非空=样式真生效） |
| o4-style-lazy.scen.js::o4-untouched-still-out | diff | FAIL · 打开 needsim 之后 --snd-bg="#10161d"（应仍空串：没打开 soundkit 就不该有它的样式） | ok · 打开 needsim 之后 --snd-bg=""（应仍空串：没打开 soundkit 就不该有它的样式） |
| o4-style-lazy.scen.js::o4-second-app-also-fed | diff | FAIL · link#app-style-soundkit 载入=false；--snd-bg="#10161d" | ok · link#app-style-soundkit 载入=true；--snd-bg="#10161d" |
| o4-style-lazy.scen.js::o4-receipts | diff | FAIL · 取不到 _r25O4.collect ⇒ unknown（不编 0） | ok · loaded=2 degraded=0 unknown=0 bytesOut=96641B 条数=9 |
| o4-style-lazy.scen.js::o4-dataset-readout | diff | FAIL · 取不到 phone shell ⇒ 读数未上屏 | ok · dataset.appStyleLoaded=2 appStyleDegraded=0 appStyleBytesOut=96641 |

