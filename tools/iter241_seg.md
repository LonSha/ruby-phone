## 迭代 241 · v4.107.0 · 第十三期 R13-O5：设置项生效时机（三档闭集 + 逐条登记 + 双向真证明 + 覆盖率 100%）

- 【版本升至 4.107.0】R13-O5 设置项生效时机：三档闭集 + 176 项逐条登记 + 三档双向真证明 + 覆盖率 100%（五源同源）
- 【本版治什么】用户把开关拨过去，界面没有任何一处回答「现在生效了，还是下一轮，还是得重开手机」：设置页 12115 行里「生效时机」四个字只有个位数。三类开关长得一模一样，而它们的行为完全不同
- 【本版做什么】新建 config/setting-effect.js（三档闭集 immediate / next-turn / next-session + 176 项逐条带理由 + 待生效账 + 两个推进器 + 统一写入口 applyChange）
- 【本版做什么】判据 tests/system-v4108.test.mjs 二十一项：A 闭集与未声明不同形 / B 三档双向真证明（含交叉面：跑一轮不许带走 next-session）/ C 覆盖率 100% 且防幽灵 / D 待生效区不回落实源 / E 四向负控制 / F 真接线三面
- 【本版做什么】真接线：设置页三档各接一个真控件走统一口（提示音 immediate / 用户消息监听 next-turn / 蜜语语音开关 next-session）；index.js 挂两个推进器（GENERATION_STARTED 推 next-turn、实例重建前推 next-session）；bindEvents 末尾给全部带 id 的控件逐项挂时机提示，漏登记直接挂黄标
- 【自己抓到的缺陷形态】首版枚举口径只覆盖了一部分控件类型：按「带 id 属性」抽得 110 项，按真控件（input/select/textarea）抽得 176 项，差 66 项全是 select / textarea / range / password 类真设置项。覆盖率 100% 这条判据当场把这个口径差抓了出来
- 【自己抓到的缺陷形态】登记表里有 57 条理由写成「同上」前向引用，读到那一条的人拿不到上一条，等于没有说明。判据已把「理由不许含同上」写死，57 条逐条改写成能独立成立的因果句
- 【自己抓到的缺陷形态】真源键与控件 id 不同名（提示音控件 id 是 setting-wechat-message-sound-enabled，老常量真源键是 wechat_message_sound_enabled）：按控件 id 登记后若直接写，分档就只是纸面上的。统一口已支持显式传 storageKey 并写了判据
- 【顺手治的存量债】v4.106.0 抬版时只跑了 gen_plan_baseline 的打印分支、没跑 --check，导致 PLAN 版本行与三处体量数字全滞后，直到本版跑 O7 判据才被逮到。已修好入口，并把「抬版必须连带重算三处入口」写进 bump 脚本本体
- 【交棒改写】config/story-clock.js 回答「哪一天」，config/time-source.js 回答「哪个钟 + 从哪取」，config/setting-effect.js 回答「什么时候生效」。三者各司一面，不当成同一面的三份实现
- 【运行时验证边界】判据证明的是「分档语义与接线成立」，不是「浏览器里那行提示长得对」。settings-app.js 的 DOM 挂标在无头环境不可验，真机需人工确认黄标数
