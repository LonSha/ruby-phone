/* ========================================================
 * phone/ui/rp-glyph-sites-v3.6.js —— 字符图标桥 v3.6 站点表（ESM，纯数据）
 * --------------------------------------------------------
 * v3.3 的字符图标桥只认两种位置：「文本节点里只有图标」和「外壳元素（按钮 / 标题 / *-chip ……）开头的图标」。
 * 运行时拼出来的计数串、元信息行里的图标落在普通 <span> / <div> 里，或夹在文字中间，v3.3 认不出来。
 * 这里逐条登记这些位置：命中 sel 的元素里，**所有**字符图标都换成 SVG（原字符照旧留在视觉隐藏的 span 里，
 * textContent 不变，detach 逐字还原）。icons 可以按码点改用别的图标名（只对本条生效）。
 * 每条都由 tools/strip-emoji.mjs 的落点模拟找出来、逐条核对过源码；why 写的是为什么它是界面外壳而不是内容。
 * 数组本体是合法 JSON（tools/strip-emoji.mjs 直接 JSON.parse 读它），不要在里面写注释或尾逗号。
 * 本文件不写颜色、不写 !important、不含字符图标（码点一律写成 0x 数字）。
 * ======================================================== */
export const GLYPH_SITES = Object.freeze([
    {
        "id": "notice",
        "app": null,
        "sel": ".rp-feedback-notice",
        "mode": "lead",
        "why": "底部状态提示条（config/phone-feedback.js 的 phoneNotice，textContent 写入）：开头的对勾 / 警告 / 叉是状态图标；只换开头，句中可能夹着用户起的名字"
    },
    {
        "id": "peek-dy-cell",
        "app": "peek",
        "sel": ".pk-dy-cell-meta",
        "mode": "all",
        "overrideDeny": true,
        "why": "查手机·抖音作品格的「点赞 / 评论」计数（peek-view.js _douyin 网格）：v3.3 的 CONTENT_DENY 用 [class*=\"-cell\"] 防棋盘格，误把 .pk-dy-cell 当内容区；这里的图标是计数前缀，属外壳"
    },
    {
        "id": "peek-dy-detail",
        "app": "peek",
        "sel": ".pk-dy-detail-actions",
        "mode": "all",
        "why": "查手机·抖音详情的点赞 / 评论 / 收藏计数"
    },
    {
        "id": "peek-wb-actions",
        "app": "peek",
        "sel": ".pk-wb-actions",
        "mode": "all",
        "icons": {
            "0x1F501": "repost"
        },
        "why": "查手机·微博卡片的转发 / 评论 / 点赞计数；转发用 v3.6 新增的 repost 图标（v3.3 映射成 refresh，语义不对）"
    },
    {
        "id": "peek-item-meta",
        "app": "peek",
        "sel": ".pk-item-top > span, .pk-section-head > p",
        "mode": "all",
        "cps": [
            10084,
            128172,
            128257,
            128064
        ],
        "icons": {
            "0x1F501": "repost"
        },
        "why": "查手机·列表项副标题与分区摘要：peek-data.js 把「点赞 / 评论 / 转发 / 播放」计数拼进 subtitle（383 / 504 / 548 行），摘要再把 subtitle 拼进句子；只换这 4 个码点（作者名等用户数据里的 emoji 不动）"
    },
    {
        "id": "affairs-part",
        "app": "affairs",
        "sel": ".af-part",
        "mode": "lead",
        "why": "事务台·事务卡「参与者」前缀图标（affairs-view.js:44 用 JS 拼出）；后面的名字是用户数据，只换开头"
    },
    {
        "id": "axd-legend",
        "app": "accessdesk",
        "sel": ".axd-legend-i",
        "mode": "all",
        "why": "无障碍操作台·状态图例：「成功 + 对勾 / 空 + 空心圆」里的符号是图例色标，不是文字"
    },
    {
        "id": "album-undated",
        "app": "album",
        "sel": ".album-tile-time",
        "mode": "lead",
        "why": "相册·无日期照片的「时间不详」前缀相机图标"
    },
    {
        "id": "avf-hint",
        "app": "avatarframe",
        "sel": ".avf-hint",
        "mode": "all",
        "why": "头像框·说明文字里标「收 / 不收」的对勾与叉（作者文案，非用户内容）"
    },
    {
        "id": "cl-flashback",
        "app": "clock",
        "sel": ".cl-flashback",
        "mode": "lead",
        "why": "时计·闪回行前缀图标"
    },
    {
        "id": "cm-dangling",
        "app": "comms",
        "sel": ".cm-dangling",
        "mode": "lead",
        "why": "会话台·「漏接悬着」提示行的星标前缀"
    },
    {
        "id": "diary-photo-status",
        "app": "diary",
        "sel": ".diary-photo-status",
        "mode": "all",
        "why": "日记·配图生成失败提示「点 [刷新] 重试」里的刷新符号"
    },
    {
        "id": "ga-coins",
        "app": "gacha",
        "sel": ".ga-btn, .ga-hist, .ga-empty",
        "mode": "all",
        "why": "幸运转盘·按钮 / 记录 / 空态里的金币与转盘符号（价格单位与装饰，非用户内容）"
    },
    {
        "id": "lg-gap",
        "app": "ledger",
        "sel": ".lg-gap",
        "mode": "lead",
        "why": "账本·缺口读数行的状态前缀"
    },
    {
        "id": "lof-n",
        "app": "lofter",
        "sel": ".lof-n",
        "mode": "lead",
        "why": "老福特·「N 张图」计数前缀"
    },
    {
        "id": "lov-hint",
        "app": "loverspace",
        "sel": ".lov-hint",
        "mode": "lead",
        "why": "恋爱空间·作者说明的星标前缀"
    },
    {
        "id": "mgz-rel",
        "app": "magazine",
        "sel": ".mgz-rel",
        "mode": "lead",
        "why": "杂志·关联行的菱形项目符号"
    },
    {
        "id": "mem-sup-arrow",
        "app": "memory",
        "sel": ".mem-sup-arrow",
        "mode": "lead",
        "why": "记忆·「被顶掉」箭头"
    },
    {
        "id": "mood-probe",
        "app": "mood",
        "sel": ".mood-probe",
        "mode": "lead",
        "why": "心境·「主动想法」前缀图标"
    },
    {
        "id": "nc-digest",
        "app": "notifications",
        "sel": ".nc-digest-line",
        "mode": "lead",
        "why": "通知中心·摘要行的警告前缀"
    },
    {
        "id": "rd-excerpt-tag",
        "app": "reading",
        "sel": ".rd-excerpt-text > span",
        "mode": "lead",
        "why": "阅读·书目行「缺正文」状态的星标前缀（span 没有类名，按 .rd-excerpt-text 的子 span 精确定位）"
    },
    {
        "id": "settings-recycle",
        "app": "settings",
        "sel": "details[data-settings-fold-key=\"phone-settings-recycle-bin-open\"] > summary > span",
        "mode": "lead",
        "why": "设置·回收站折叠标题"
    },
    {
        "id": "settings-item-head",
        "app": "settings",
        "sel": ".setting-item > div > span",
        "mode": "lead",
        "why": "设置·分组标题（「手机与记忆中枢」等，内联样式无类名，按 .setting-item 的结构定位）"
    },
    {
        "id": "tarot-deco",
        "app": "tarot",
        "sel": ".tarot-draw-btn, .tarot-empty",
        "mode": "all",
        "why": "塔罗·抽牌按钮两侧与空态里的星芒装饰"
    },
    {
        "id": "tw-hint",
        "app": "timeweaver",
        "sel": ".tw-hint",
        "mode": "all",
        "why": "时间织机·提示里引用的界面按钮名（「叙事信」「收藏这封信」）前的图标，与按钮本身一致"
    },
    {
        "id": "wx-prompt-sub",
        "app": "wechat",
        "sel": ".prompt-content span",
        "mode": "lead",
        "why": "微信·功能提示词设置里各子项标题（微信聊天 / 语音通话 / 群聊……）"
    },
    {
        "id": "mgz-cmt",
        "app": "magazine",
        "sel": ".mgz-cmt",
        "mode": "lead",
        "cps": [
            9670
        ],
        "why": "杂志·评论区里「卡片 / 关系」行的菱形项目符号（magazine-data.js:873-874 拼出）；只换开头的这一个码点，回答正文是内容不动"
    },
    {
        "id": "mem-advice",
        "app": "memory",
        "sel": ".mem-issue-advice",
        "mode": "all",
        "why": "记忆·体检建议里引用的界面按钮图标（「点右上角 [月亮] 立即巩固」「点 [星] 收藏」，memory-insights.js 拼出），与按钮本身一致"
    }
]);
