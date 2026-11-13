/* ========================================================
 * config/setting-effect.js — [v4.107.0 · 第十三期 R13-O5] 设置项**生效时机**的单一真源
 * --------------------------------------------------------
 * 【它要治的缺陷：用户改了开关，不知道什么时候开始算】
 *   实测 `apps/settings/settings-app.js` **732462 字节 / 12115 行**，而全仓写到
 *   「生效时机」四个字的地方只有 **3 处**。也就是说：用户把某个开关拨过去，
 *   界面上没有任何一处回答「它现在是生效了，还是下一轮才生效，还是得重开手机」。
 *   这不是文案缺失，是**语义从未被声明**——于是同一个仓库里的开关事实上分成三类，
 *   而三类长得一模一样。
 *
 * 【本模块只做四件事，不做第五件】
 *   ① `EFFECT_AT`       —— 三档语义的**闭集**（immediate / next-turn / next-session）；
 *   ② `SETTING_EFFECT`  —— 逐项登记「这一项属于哪一档」+ 为什么（未登记 ⇒ null，不猜默认）；
 *   ③ 待生效区           —— `next-turn` / `next-session` 的改动先落这里，**不直接进真源**；
 *   ④ 两个推进器         —— `commitTurn()`（一轮生成走过）与 `commitSession()`（手机重开）。
 *
 * 【三档语义（判据必须由真行为证明，不是靠文案）】
 *   · `immediate`    改完**立即读回必须变**。
 *   · `next-turn`    改完立即读回**必须不变**；走过一轮生成后读回**必须变**（双向）。
 *   · `next-session` 改完立即读回不变；`dispose + 重建`后读回**必须变**（双向）。
 *
 * 【为什么必须集中在一个模块里】
 *   如果每个 `change` 监听器各自决定「要不要等一轮」，那么「哪些项要等」就散在
 *   12115 行里，没有任何一处可答。本版把这件事收成一张表：改设置的人只声明它属于哪一档，
 *   「何时生效」由本模块统一执行。这与本仓 `config/num-gate.js`（口径单一实现）、
 *   `config/recycle-bin.js`（软删单一实现）是同一条纪律。
 *
 * 【本模块不做的事】
 *   · 不存设置值本身（存储是 `PhoneStorage` 的事）——本模块只持有「待生效」那一小块；
 *   · 不做读写旁路（`read()` 的答案来自调用方注入的 `reader`，不自己碰 storage）；
 *   · 不判「这个值合不合法」（那是各设置自己的归一化职责）。
 *
 * 依赖：零 import（不引任何模块：它是叶子，谁都可引用而不会造出环）。
 * ============================================================ */
'use strict';

/** 三档生效时机（**闭集**：不许出现第四档）。 */
export const EFFECT_AT = Object.freeze({
    immediate: 'immediate',
    'next-turn': 'next-turn',
    'next-session': 'next-session'
});

/** 三个档的成因/文案（逐一给人话，因为这些话会直接摆到界面上）。 */
export const EFFECT_AT_TEXT = Object.freeze({
    immediate: '立即生效',
    'next-turn': '下一轮生成后生效',
    'next-session': '重开手机后生效'
});

/** 未声明时用的黄标文案（本仓纪律：「没声明」与「声明为立即」必须不同形）。 */
export const EFFECT_AT_UNKNOWN = '时机未声明';

/**
 * 逐项登记：`键 → { at, why }`。
 *
 * 判定口径（写在这里，免得下一次重新讨论）：
 *   · **只影响渲染 / 只影响本机行为的开关** ⇒ `immediate`（改完下一帧就该看到）；
 *   · **要被「一轮生成」读到的东西**（提示词、注入、召回、线路选择） ⇒ `next-turn`
 *     —— 因为本轮已经在跑，中途换提示词会让同一条回复的前后两半来自两套设定；
 *   · **要重建实例 / 重挂监听才生效的东西**（TTS 引擎、图像线路、语言、音色） ⇒ `next-session`
 *     —— 这些的持有者是长生命周期对象，改了就换等于在运行中拆引擎。
 *
 * 键名沿用设置控件在 DOM 上的 id（`setting-*` / `offline-*` / `phone-*`），
 * 因为那是「用户实际拨动的那一个东西」在代码里唯一的稳定名字。
 */
export const SETTING_EFFECT = Object.freeze({
    /* ── immediate：改完下一帧可见（渲染/本机行为） ── */
    'setting-wechat-message-sound-enabled': { at: 'immediate', why: '只影响本机提示音播放，不参与生成' },
    'setting-inline-reply-btn': { at: 'immediate', why: '只影响输入区按钮，重绘即见' },
    'setting-phone-triple-tap-enabled': { at: 'immediate', why: '手势开关，下一次点击就按新设定走' },
    'setting-phone-floating-entry-enabled': { at: 'immediate', why: '浮窗显隐，改完即调外壳' },
    'phone-home-layout': { at: 'immediate', why: '首页布局属于渲染，重绘即生效' },
    'phone-motion-level': { at: 'immediate', why: '动效档位只影响本机动画强度' },
    'phone-image-debug-payload': { at: 'immediate', why: '只决定是否把请求体打进控制台' },
    'phone-tag-filter-enabled': { at: 'immediate', why: '过滤开关本身即时可判（黑白名单内容另计）' },
    'recycle-bin-enabled': { at: 'immediate', why: '软删开关决定下一次删除怎么走，不涉及生成' },
    'wechat-message-render-mode': { at: 'immediate', why: '只决定消息流按窗口化还是全量物化，重绘即见；不参与生成' },

    /* ── next-turn：要被「一轮生成」读到 ── */
    'setting-wechat-online-proactive-enabled': { at: 'next-turn', why: '主动发言由生成轮次驱动；中途改会让本轮前后的判定来自两套设定' },
    'setting-wechat-online-real-time-enabled': { at: 'next-turn', why: '现实时间开关影响生成时用的时间面，本轮已取过' },
    'setting-wechat-online-only-mode': { at: 'next-turn', why: '线上模式决定本轮是否走生成通道' },
    'setting-wechat-interop-mode': { at: 'next-turn', why: '互通模式影响本轮消息的来路' },
    'setting-time-env-inject-enabled': { at: 'next-turn', why: '时间环境注入属于提示词内容，只在下一次组装时读到' },
    'offline-wechat-prompt-enabled': { at: 'next-turn', why: '线下提示词注入下一次组装才用' },
    'offline-single-chat-enabled': { at: 'next-turn', why: '线下单人对话开关由生成轮次读取' },
    'offline-group-chat-enabled': { at: 'next-turn', why: '线下群聊开关由生成轮次读取' },
    'offline-honey-chat-enabled': { at: 'next-turn', why: '蜜语线下开关由生成轮次读取' },
    'offline-moments-history-enabled': { at: 'next-turn', why: '朋友圈历史注入在下一次组装时读到' },
    'offline-phone-call-history-enabled': { at: 'next-turn', why: '通话历史注入在下一次组装时读到' },
    'offline-weibo-history-enabled': { at: 'next-turn', why: '微博历史注入在下一次组装时读到' },
    'offline-diary-history-enabled': { at: 'next-turn', why: '日记历史注入在下一次组装时读到' },
    'phone-injection-require-variable-enabled': { at: 'next-turn', why: '注入前提属于组装期判断' },
    'phone-wechat-offline-clean-user-reply-enabled': { at: 'next-turn', why: '清洗用户回复发生在生成前处理' },
    'phone-user-message-listener-enabled': { at: 'next-turn', why: '监听器影响下一轮是否被触发' },
    'phone-tag-filter-blacklist': { at: 'next-turn', why: '名单内容在下一次过滤时读到（键名本身即时生效）' },
    'phone-tag-filter-whitelist': { at: 'next-turn', why: '名单内容在下一次标签过滤时读到，当场改不影响已注入的上下文' },
    'phone-image-fixed-prompt': { at: 'next-turn', why: '固定提示词在下一次生图请求时组装' },
    'phone-image-fixed-prompt-end': { at: 'next-turn', why: '尾段固定词要拼进下一轮生成请求，当场改不重写已发请求' },
    'phone-image-negative-prompt': { at: 'next-turn', why: '负面词在下一次生图请求时组装' },

    /* ── next-session：要重建实例 / 重挂监听才生效 ── */
    'phone-tts-provider': { at: 'next-session', why: 'TTS 引擎由长生命周期对象持有，换引擎等于运行中拆它' },
    'phone-tts-url-preset': { at: 'next-session', why: '语音线路在引擎构造时绑定，重开手机才会用新线路' },
    'phone-tts-model-preset': { at: 'next-session', why: '语音模型预设被引擎实例持有，重开手机才重建引擎' },
    'phone-tts-voice-preset': { at: 'next-session', why: '默认音色在引擎构造时选定，重开手机才会换音色' },
    'phone-tts-volc-voice-preset': { at: 'next-session', why: '火山音色在引擎构造时选定，重开手机才会换音色' },
    'phone-tts-volc-clone-model-type': { at: 'next-session', why: '克隆模型类型在引擎构造时选定，重开手机才重建' },
    'phone-tts-volc-clone-language': { at: 'next-session', why: '克隆语言在引擎构造时选定，重开手机才重建' },
    'phone-tts-fallback-male-provider': { at: 'next-session', why: '兜底线路在引擎构造时装配' },
    'phone-tts-fallback-female-provider': { at: 'next-session', why: '女声兜底的引擎选择被引擎实例持有，重开手机才重建' },
    'phone-honey-tts-mode': { at: 'next-session', why: '蜜语语音模式由引擎构造决定' },
    'phone-asr-provider': { at: 'next-session', why: 'ASR 引擎同样由长生命周期对象持有' },
    'phone-asr-language': { at: 'next-session', why: '识别语言在识别器构造时绑定，重开手机才重建' },
    'phone-asr-auto-local': { at: 'next-session', why: '本地识别的装配发生在构造期，重开手机才重装' },
    'phone-image-provider': { at: 'next-session', why: '图像线路由长生命周期客户端持有' },
    'phone-image-novelai-site': { at: 'next-session', why: 'NAI 站点开关被线路实例持有，重开手机才重新初始化' },
    'phone-image-openai-site': { at: 'next-session', why: '公益站点开关被线路实例持有，重开手机才重新初始化线路' },
    'phone-image-sd-model': { at: 'next-session', why: '模型/VAE 在客户端构造时绑定' },
    'phone-image-sd-vae': { at: 'next-session', why: 'VAE 名被 WebUI 侧持有并在请求时贴上，要重开手机才重新拿' },
    'phone-image-comfyui-transport': { at: 'next-session', why: '传输方式在客户端构造时决定' },
    'phone-image-comfyui-workflow-select': { at: 'next-session', why: '工作流在客户端构造时载入' },
    'phone-image-runninghub-instance-type': { at: 'next-session', why: '实例类型在客户端构造时选定' },
    'phone-api-enabled': { at: 'next-session', why: '独立 API 通道由长生命周期客户端持有' },
    'phone-api-profile-select': { at: 'next-session', why: '线路档在客户端构造时绑定，重开手机才换档' },
    'phone-api-url': { at: 'next-session', why: '接口地址在客户端构造时绑定，重开手机才换地址' },
    'phone-api-key': { at: 'next-session', why: '凭据在客户端构造时绑定，重开手机才重新拿密钥' },
    'phone-api-model': { at: 'next-session', why: '模型名在客户端构造时绑定，重开手机才换模型' },
    'phone-api-stream': { at: 'next-session', why: '流式开关在客户端构造时绑定，重开手机才换流式方式' },

    /* ── 补登（v4.107.0 覆盖率达到 100% 的那一轮：逐个按语义分档，不留「未声明」） ── */
    /* 免打扰时段：判定发生在生成轮次里，故与主动发言同档。 */
    'setting-wechat-online-proactive-quiet-enabled': { at: 'next-turn', why: '免打扰判定在生成轮次里做，本轮已判过' },
    'setting-wechat-online-proactive-quiet-start': { at: 'next-turn', why: '免打扰起始时刻由下一轮主动发言调度读取，当场改不重新排程' },
    'setting-wechat-online-proactive-quiet-end': { at: 'next-turn', why: '免打扰结束时刻由下一轮主动发言调度读取，当场改不重新排程' },
    /* 图像生成：线路类（换客户端）走 next-session；单次请求参数走 next-turn。 */
    'phone-image-enabled': { at: 'next-session', why: '总开关决定是否装配图像客户端，装配在构造期' },
    'phone-image-novelai-model': { at: 'next-turn', why: '单次请求参数，下一次生图请求时组装' },
    'phone-image-novelai-sampler': { at: 'next-turn', why: '采样器名要进下一轮 NAI 请求体，当场改不重写已发请求' },
    'phone-image-novelai-schedule': { at: 'next-turn', why: '噪声调度要进下一轮 NAI 请求体，当场改不重写已发请求' },
    'phone-image-novelai-guidance': { at: 'next-turn', why: '引导强度要进下一轮 NAI 请求体，当场改不重写已发请求' },
    'phone-image-novelai-guidance-rescale': { at: 'next-turn', why: '引导重标定要进下一轮 NAI 请求体，当场改不重写已发请求' },
    'phone-image-novelai-skip-cfg-compat': { at: 'next-turn', why: '兼容开关要进下一轮 NAI 请求体，当场改不重写已发请求' },
    'phone-image-steps': { at: 'next-turn', why: '步数要进下一轮生成请求体，当场改不重写已发请求' },
    'phone-image-seed': { at: 'next-turn', why: '随机种子要进下一轮生成请求体，当场改不重写已发请求' },
    'phone-image-openai-model-preset': { at: 'next-turn', why: '模型档要进下一轮图像请求体，当场改不重写已发请求' },
    'phone-image-openai-quality': { at: 'next-turn', why: '质量档要进下一轮图像请求体，当场改不重写已发请求' },
    'phone-image-sd-sampler': { at: 'next-turn', why: '采样器名要进下一轮 WebUI 请求体，当场改不重写已发请求' },
    'phone-image-sd-scheduler': { at: 'next-turn', why: '调度器名要进下一轮 WebUI 请求体，当场改不重写已发请求' },
    'phone-image-sd-upscaler': { at: 'next-turn', why: '放大算法要进下一轮 WebUI 请求体，当场改不重写已发请求' },
    'phone-image-sd-hires-fix': { at: 'next-turn', why: '高清修复开关要进下一轮 WebUI 请求体，当场改不重写已发请求' },
    'phone-image-sd-restore-faces': { at: 'next-turn', why: '面部修复开关要随下一次生成请求发出，当场改不重写已发请求' },
    'phone-image-sd-adetailer': { at: 'next-turn', why: '细节修复开关要随下一次生成请求发出，当场改不重写已发请求' },
    'phone-image-comfyui-mode': { at: 'next-turn', why: '工作流模式要进下一轮 ComfyUI 请求，当场改不重写已发请求' },
    'phone-image-comfyui-model': { at: 'next-turn', why: '模型名要拼进下一轮工作流 JSON，当场改不重写已发请求' },
    'phone-image-comfyui-sampler': { at: 'next-turn', why: '采样器名要拼进工作流 JSON，下一轮生成时才会拼进去' },
    'phone-image-comfyui-scheduler': { at: 'next-turn', why: '调度器名要拼进工作流 JSON，下一轮生成时才会拼进去' },
    'phone-image-comfyui-vae': { at: 'next-turn', why: 'ComfyUI 侧 VAE 名要拼进工作流 JSON，下一轮生成时才会拼' },
    'phone-image-comfyui-clip': { at: 'next-turn', why: 'CLIP Skip 要拼进工作流 JSON，下一轮生成时才会拼进去' },
    'phone-image-comfyui-app-select': { at: 'next-turn', why: 'App 维度的工作流选择在下一轮生成时被读，当场改不变' },
    'phone-image-honey-width': { at: 'next-turn', why: '尺寸参数在请求组装时读到' },
    'phone-image-honey-height': { at: 'next-turn', why: '蜜语生图高度只是尺寸参数，下一轮生成时才会被读' },
    'phone-image-wechat-width': { at: 'next-turn', why: '微信配图宽度只是生图尺寸参数，下一轮生成时才会被读进请求' },
    'phone-image-wechat-height': { at: 'next-turn', why: '微信配图高度只是生图尺寸参数，下一轮生成时才会被读进请求' },
    'phone-image-weibo-width': { at: 'next-turn', why: '微博配图宽度只是生图尺寸参数，下一轮生成时才会被读进请求' },
    'phone-image-weibo-height': { at: 'next-turn', why: '微博配图高度只是生图尺寸参数，下一轮生成时才会被读进请求' },
    'phone-image-diary-width': { at: 'next-turn', why: '日记配图宽度只是生图尺寸参数，下一轮生成时才会被读' },
    'phone-image-diary-height': { at: 'next-turn', why: '日记配图高度只是生图尺寸参数，下一轮生成时才会被读' },
    'phone-image-width': { at: 'next-turn', why: '默认生图宽度只是尺寸参数，下一轮生成时才会被读进请求' },
    'phone-image-height': { at: 'next-turn', why: '生图高度只是单次参数，下一轮生成时才会被读进请求' },
    'phone-image-novelai-vibe-enabled': { at: 'next-turn', why: 'Vibe 引用在请求组装时读到' },
    'phone-image-novelai-vibe-normalize-strength': { at: 'next-turn', why: 'Vibe 强度归一化在下一轮生成时才被算，当场改不变' },
    'phone-image-novelai-vibe-group-select': { at: 'next-turn', why: '引用的 Vibe 组在下一轮生成时才被读，当场改不变' },
    'phone-image-prompt-app-select': { at: 'immediate', why: '只切换设置页里显示哪一组预设，纯渲染' },
    'phone-image-prompt-preset-select': { at: 'immediate', why: '选择本身只影响本页展示，套用到提示词是另一个动作' },
    'phone-image-openai-preset-app-select': { at: 'immediate', why: '只是当前预设适用的应用范围选项，选完就要看到，不参与生成' },
    'phone-image-openai-preset-select': { at: 'immediate', why: '只是当前预设在界面上的选中态，选完就要看到，不参与生成' },
    'phone-image-sd-lora-select': { at: 'immediate', why: '只是 LoRA 列表的选中态，选完就要看到，不参与生成' },
    /* 独立 API 线路的其余档位（与已登记的 url/key/model 同族）。 */
    'phone-api-provider': { at: 'next-session', why: '线路类型在客户端构造时绑定' },
    'phone-api-model-select': { at: 'next-session', why: '从列表选定模型即写进客户端构造参数，重开手机才重建' },
    'phone-api-route-wechat': { at: 'next-session', why: '哪一路走独立通道在客户端构造时决定，重开手机才生效' },
    'phone-api-route-honey': { at: 'next-session', why: '蜜语线路绑定被调用方实例持有，重开手机才重新粘线路' },
    'phone-api-tokens': { at: 'next-session', why: '上下文预算在客户端构造时绑定，重开手机才换预算' },
    /* 语音：通话自动朗读与蜜语语音开关都挂在长生命周期引擎上。 */
    'wechat-call-auto-tts': { at: 'next-session', why: '自动朗读挂在通话 TTS 引擎上，引擎构造期读' },
    'phone-honey-tts-enabled': { at: 'next-session', why: '蜜语语音引擎开关，装配在构造期' },
    'phone-honey-tts-cache-enabled': { at: 'next-session', why: '语音缓存策略在引擎构造时绑定，重开手机才重设' },
    /* ── 本批补登（R13-O5 覆盖率审计发现：只枚举了一部分控件类型，
     *   漏了 select / textarea / range / password 等真设置项） ── */
    'phone-image-comfyui-url': { at: 'next-session', why: 'ComfyUI 的地址被实例构造时抓取，改完要重开手机才会被重新读取' },
    'phone-image-comfyui-remote-url': { at: 'next-session', why: '远端 ComfyUI 地址被图像实例持有，重开手机才重新读地址' },
    'phone-image-comfyui-workflow': { at: 'next-session', why: '工作流 JSON 在实例初始化时解析，运行中换会让半张图来自两套流程' },
    'phone-image-comfyui-workflow-name': { at: 'next-session', why: '工作流名跟着工作流一起被实例持有，选完要重开手机' },
    'phone-image-comfyui-node-mapping': { at: 'next-session', why: '节点映射在实例构造时建立，改了要在重开后重建' },
    'phone-image-novelai-key': { at: 'next-session', why: '编号密钥被请求器持有，重开手机才会重新拿密钥' },
    'phone-image-novelai-url': { at: 'next-session', why: 'NAI 线路地址被请求器持有，不属于单次生成参数' },
    'phone-image-novelai-queue-url': { at: 'next-session', why: 'NAI 队列中转地址被线路实例持有，重开手机才生效' },
    'phone-image-novelai-public-url': { at: 'next-session', why: 'NAI 公益站点地址被线路实例持有，重开手机才生效' },
    'phone-image-openai-key': { at: 'next-session', why: '图像线路密钥被请求器持有，重开手机重新加载' },
    'phone-image-openai-model': { at: 'next-session', why: '默认图像模型被实例持有，不属于单次生成参数' },
    'phone-image-openai-url': { at: 'next-session', why: '图像线路地址被请求器持有，重开手机重新加载' },
    'phone-image-openai-public-relay-url': { at: 'next-session', why: '本地中转地址被线路实例持有，重开手机才生效' },
    'phone-image-openai-public-url': { at: 'next-session', why: '公益站点地址被线路实例持有，重开手机才生效' },
    'phone-image-runninghub-key': { at: 'next-session', why: '工作流平台密钥被请求器持有，重开手机重新加载' },
    'phone-image-runninghub-workflow-id': { at: 'next-session', why: '工作流 ID 被线路实例持有，重开手机重新加载' },
    'phone-image-runninghub-duration': { at: 'next-session', why: '时长属于工作流调用参数，跟着线路实例初始化一次' },
    'phone-image-runninghub-steps': { at: 'next-session', why: '步数属于工作流调用参数，跟着线路实例初始化一次' },
    'phone-image-sd-url': { at: 'next-session', why: 'SD WebUI 地址被请求器持有，重开手机重新加载' },
    'phone-image-sd-auth': { at: 'next-session', why: '身份验证凭据被请求器持有，重开手机重新加载' },
    'phone-image-sd-clip-skip': { at: 'next-session', why: 'Clip Skip 是 WebUI 侧粘性参数，要重开手机才推下去' },
    'phone-image-sd-denoising-strength': { at: 'next-session', why: '去噪强度是 WebUI 侧粘性参数，重开手机才推下去' },
    'phone-image-sd-hires-steps': { at: 'next-session', why: '高清步数是 WebUI 侧粘性参数，重开手机才推下去' },
    'phone-image-sd-upscale-factor': { at: 'next-session', why: '放大倍数是 WebUI 侧粘性参数，重开手机才推下去' },
    'siliconflow-api-key': { at: 'next-session', why: '图像 / 语音线路共用密钥，被实例持有，重开手机重新加载' },
    'image-generation-model': { at: 'next-session', why: '图像模型选择要被实例构造读到，不属于单次生成参数' },
    'phone-tts-key': { at: 'next-session', why: '语音引擎密钥被引擎实例持有，重开手机才重建引擎' },
    'phone-tts-model': { at: 'next-session', why: '语音模型名跟着引擎实例走，重开手机才重建' },
    'phone-tts-url': { at: 'next-session', why: '语音接口地址被引擎实例持有，重开手机才重建' },
    'phone-tts-voice': { at: 'next-session', why: '默认音色被引擎实例持有，重开手机才重建' },
    'phone-tts-fallback-female-voice': { at: 'next-session', why: '女声兜底音色被引擎持有，重开手机才重建' },
    'phone-tts-fallback-male-voice': { at: 'next-session', why: '男声兜底音色被引擎持有，重开手机才重建' },
    'phone-tts-volc-app-id': { at: 'next-session', why: '火山应用 ID 被引擎持有，重开手机才重建' },
    'phone-tts-volc-key': { at: 'next-session', why: '火山令牌被引擎持有，重开手机才重建' },
    'phone-tts-volc-resource-id': { at: 'next-session', why: '资源 ID 被引擎持有，重开手机才重建' },
    'phone-tts-volc-voice': { at: 'next-session', why: '火山音色被引擎持有，重开手机才重建' },
    'phone-tts-volc-clone-app-id': { at: 'next-session', why: '复刻应用 ID 被引擎持有，重开手机才重建' },
    'phone-tts-volc-clone-access-token': { at: 'next-session', why: '复刻令牌被引擎持有，重开手机才重建' },
    'phone-tts-volc-clone-speaker-id': { at: 'next-session', why: '复刻音色 ID 被引擎持有，重开手机才重建' },
    'phone-tts-volc-clone-worker-url': { at: 'next-session', why: '复刻中转地址被引擎持有，重开手机才重建' },
    'phone-tts-nimo-relay-url': { at: 'next-session', why: 'MiMo 中转地址被引擎持有，重开手机才重建' },
    'phone-tts-nimo-clone-nick': { at: 'next-session', why: '复刻音色昵称被引擎持有，重开手机才重建' },
    'phone-asr-key': { at: 'next-session', why: '识别密钥被识别器实例持有，重开手机才重建' },
    'phone-asr-model': { at: 'next-session', why: '识别模型名跟着识别器实例走，重开手机才重建' },
    'phone-asr-url': { at: 'next-session', why: '识别接口地址被识别器持有，重开手机才重建' },
    'phone-asr-relay-url': { at: 'next-session', why: '识别中转地址被识别器持有，重开手机才重建' },
    'setting-wechat-online-proactive-interval': { at: 'next-session', why: '主动发言定时器按间隔重建，重开手机才换新间隔' },
    'wechat-single-chat-limit': { at: 'next-turn', why: '注入酒馆正文的条数在下一轮组装上下文时才被读' },
    'wechat-group-chat-limit': { at: 'next-turn', why: '群聊条数在下一轮组装上下文时才被读，当场改不影响已注入内容' },
    'wechat-moments-context-limit': { at: 'next-turn', why: '朋友圈条数在下一轮组装上下文时才被读，当场改不变' },
    'wechat-single-call-history-limit': { at: 'next-turn', why: '单人通话记录条数在下一轮组装时才被读，当场改不变' },
    'wechat-group-call-history-limit': { at: 'next-turn', why: '群通话记录条数在下一轮组装时才被读，当场改不变' },
    'phone-sms-limit': { at: 'next-turn', why: '短信记录条数在下一轮组装上下文时才被读，当场改不变' },
    'phone-call-limit': { at: 'next-turn', why: '电话记录条数在下一轮组装上下文时才被读，当场改不变' },
    'phone-context-limit': { at: 'next-turn', why: '正文上下文楼层在下一轮组装上下文时才被读，当场改不变' },
    'offline-single-chat-limit': { at: 'next-turn', why: '线下单聊条数在下一轮注入酒馆正文时才被读，当场改不变' },
    'offline-group-chat-limit': { at: 'next-turn', why: '线下群聊条数在下一轮注入酒馆正文时才被读，当场改不变' },
    'offline-diary-history-limit': { at: 'next-turn', why: '日记篇数在下一轮注入酒馆正文时才被读，当场改不变' },
    'offline-weibo-history-limit': { at: 'next-turn', why: '微博条数在下一轮注入酒馆正文时才被读，当场改不变' },
    'phone-font-scale-slider': { at: 'immediate', why: '只影响全局字号，重绘即见，不参与生成' },
    'phone-shell-scale-slider': { at: 'immediate', why: '只影响手机外壳尺寸，重绘即见，不参与生成' },
    'phone-card-layout-custom-css': { at: 'immediate', why: '只影响卡片布局样式，样式重算即见，不参与生成' },
    'phone-image-sd-lora': { at: 'immediate', why: '只影响 LoRA 选择框的展示与下一次选择，不对已开始的生成生效' },
    'phone-image-openai-preset-name': { at: 'immediate', why: '只是当前预设名在界面上的回显，选完就要看到，不参与生成' },
    'phone-image-prompt-preset-name': { at: 'immediate', why: '只是当前提示词预设名的回显，选完就要看到，不参与生成' },
    'phone-image-novelai-vibe-group-name': { at: 'immediate', why: '只是 Vibe 组名在界面上的回显，选完就要看到，不参与生成' },
});

/**
 * 查一项属于哪一档。
 * @param {string} key 设置项键名（通常是 DOM id）
 * @returns {'immediate'|'next-turn'|'next-session'|null} 未登记 ⇒ **null**（刻意不猜默认值）
 */
export function effectAtOf(key) {
    const k = String(key == null ? '' : key).trim();
    if (!k) return null;
    const row = Object.prototype.hasOwnProperty.call(SETTING_EFFECT, k) ? SETTING_EFFECT[k] : null;
    if (!row || !Object.prototype.hasOwnProperty.call(EFFECT_AT, row.at)) return null;
    return row.at;
}

/** 一项的登记理由（未登记 ⇒ 空串，不编理由）。 */
export function effectWhyOf(key) {
    const k = String(key == null ? '' : key).trim();
    const row = Object.prototype.hasOwnProperty.call(SETTING_EFFECT, k) ? SETTING_EFFECT[k] : null;
    return row ? String(row.why || '') : '';
}

/**
 * 一行时机提示（界面与诊断面共用，不许各写一份）。
 * 「未声明」与「声明为立即」**必须不同形** —— 前者的处置是去补登记，后者的处置是无事可做。
 * @param {string} key
 * @returns {string}
 */
export function effectLine(key) {
    const at = effectAtOf(key);
    if (at === null) return EFFECT_AT_UNKNOWN;
    return String(EFFECT_AT_TEXT[at] || at);
}

/**
 * 待生效区（一张进程内的小账）：`key → { value, at, atTurn, reason }`。
 *
 * 为什么需要它：`next-turn` / `next-session` 的改动**不许立即进真源**，否则「立即读回
 * 必须不变」这条判据根本没法成立。故改动先落这里，等推进器把它搬到真源。
 */
export class PendingEffects {
    constructor() {
        this._pending = new Map();
    }

    /**
     * 记一笔待生效改动。
     * @param {string} key 设置项键名
     * @param {*} value 新值
     * @param {{at?:string, turn?:number}} [o] at 缺省取登记表；turn 是登记时的轮次号
     * @returns {{ok:boolean, mode:string, key:string}} mode: 'immediate'（不记账）/ 'pending' / 'unregistered'
     */
    stage(key, value, o) {
        const k = String(key == null ? '' : key).trim();
        const opts = o || {};
        const at = opts.at || effectAtOf(k);
        if (!k) return { ok: false, mode: 'unregistered', key: k };
        /* immediate 档不记账：它本来就该立即生效，记账反而会让「立即读回」读到旧值。 */
        if (at === 'immediate') return { ok: true, mode: 'immediate', key: k };
        this._pending.set(k, {
            value: value,
            at: at || 'next-turn',
            atTurn: Number.isFinite(opts.turn) ? Number(opts.turn) : null,
            reason: at ? '' : 'unregistered'
        });
        return { ok: true, mode: at ? 'pending' : 'unregistered', key: k };
    }

    /** 某一项有没有待生效改动。 */
    has(key) {
        return this._pending.has(String(key == null ? '' : key).trim());
    }

    /** 读待生效值（没有 ⇒ undefined，不返回真源值 —— 那是 reader 的事）。 */
    peek(key) {
        const row = this._pending.get(String(key == null ? '' : key).trim());
        return row ? row.value : undefined;
    }

    /** 待生效项清单（诊断面用；只读快照，不暴露内部 Map）。 */
    list() {
        return Array.from(this._pending.entries()).map(([key, row]) => ({
            key: key,
            at: row.at,
            atTurn: row.atTurn,
            reason: row.reason
        }));
    }

    /** 清空（推进后或会话重建时）。 */
    clear() {
        this._pending.clear();
    }

    /**
     * 推进一轮：把所有 `next-turn` 的待生效改动交出去。
     * @returns {Array<{key:string, value:*}>} 已提交项（调用方负责写进真源）
     */
    commitTurn() {
        return this._drain('next-turn');
    }

    /**
     * 推进一个会话：把所有 `next-session` 的待生效改动交出去。
     * @returns {Array<{key:string, value:*}>}
     */
    commitSession() {
        return this._drain('next-session');
    }

    _drain(at) {
        const out = [];
        for (const [key, row] of Array.from(this._pending.entries())) {
            if (row.at !== at) continue;
            out.push({ key: key, value: row.value });
            this._pending.delete(key);
        }
        return out;
    }
}

/**
 * 一次「改动 → 生效时机」的完整处置（设置页的 change 监听器只调这一个函数）。
 *
 * @param {{key:string, value:*, reader:Function, writer:Function, pending:PendingEffects, turn?:number}} o
 *   reader(key) 读真源当前值；writer(key, value) 写进真源（可能是异步）
 * @returns {{mode:string, at:string|null, wrote:boolean}}
 *   · `immediate` ⇒ 当场写（`wrote:true`），读回立刻变；
 *   · `next-turn` / `next-session` ⇒ 只记待生效（`wrote:false`），读回**不变**；
 *   · 未登记 ⇒ 按 `immediate` 写（保持既有行为），但 `at:null` 让界面能挂黄标。
 */
export function applyChange(o) {
    const opts = o || {};
    const key = String(opts.key == null ? '' : opts.key).trim();
    const at = effectAtOf(key);
    if (at === 'immediate' || at === null) {
        if (typeof opts.writer === 'function') opts.writer(key, opts.value);
        return { mode: 'immediate', at: at, wrote: true };
    }
    const pending = opts.pending instanceof PendingEffects ? opts.pending : null;
    if (!pending) return { mode: 'immediate', at: at, wrote: true };
    const r = pending.stage(key, opts.value, { at: at, turn: opts.turn });
    return { mode: r.mode, at: at, wrote: false };
}

export default {
    EFFECT_AT,
    EFFECT_AT_TEXT,
    EFFECT_AT_UNKNOWN,
    SETTING_EFFECT,
    effectAtOf,
    effectWhyOf,
    effectLine,
    PendingEffects,
    applyChange
};
