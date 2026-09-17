/* ========================================================
 * phone-events.js — 跨模块事件契约单一真源 [v2.26.0]
 * --------------------------------------------------------
 * 动机（v2.25 的延伸）：v2.25 修掉的是「已注册监听器没解绑」，
 *   但整个跨模块通信层仍建立在 **16 个手写事件名字符串** 上。实测：
 *   29 处 addEventListener(手机事件) + 83 处 dispatchEvent(CustomEvent(手机事件))
 *   （散布在 42 个文件）各自拼写字面量，
 *   没有任何编译期/测试期约束。一处打错（如 panelVisiblity）不会
 *   报错，只会静默失联——这是 v2.25 那类「结构上可能出错」的根。
 *
 * 本模块是**权威声明**：事件名、语义类别、发布者、订阅者一次说清。
 *   由 tests/system-v226.test.mjs 双向对账锁定：
 *     ① 全仓出现的任何手机事件字面量必须能映射到本契约（防漂移）；
 *     ② 本契约登记的每个事件必须至少有一处真实使用（防孤儿/死契约）。
 *
 * 取舍（刻意为之，勿"顺手优化"）：
 *   不做全仓 40 文件的机械字面量替换 —— 那会产生巨大 diff 与真实的
 *   破坏风险，却不增加任何约束力（对账测试直接扫字面量，用常量或用
 *   字符串同样被覆盖）。新代码应引用 PHONE_EVENTS；
 *   高频/本轮改动过的模块（album / calendar / phone-shell）已切换。
 * ======================================================== */

/** 事件语义类别（用于文档与诊断分组） */
export const PHONE_EVENT_KINDS = Object.freeze({
    NAVIGATION: 'navigation',      // 导航手势：影响界面栈
    DATA: 'data',                  // 数据变更：订阅方需重取/重绘
    LIFECYCLE: 'lifecycle',        // 宿主生命周期：面板显隐、清理、时间推进
    COMMUNICATION: 'communication' // 对外动作：发消息给聊天、来电等
});

/**
 * 事件名权威表。键为 SCREAMING_SNAKE（供代码引用），值为实际派发字符串。
 * 新增事件的唯一正确姿势：先在此登记（并在 EVENTS 里补元数据），再使用。
 */
export const PHONE_EVENTS = Object.freeze({
    GO_HOME: 'phone:goHome',
    SWIPE_BACK: 'phone:swipeBack',
    OPEN_APP: 'phone:openApp',
    PANEL_VISIBILITY: 'phone:panelVisibility',
    UPDATE_GLOBAL_BADGE: 'phone:updateGlobalBadge',
    UPDATE_WALLPAPER: 'phone:updateWallpaper',
    UPDATE_APP_ICON: 'phone:updateAppIcon',
    UPDATE_CARD_LAYOUT_CSS: 'phone:updateCardLayoutCss',
    TIME_UPDATED: 'phone:timeUpdated',
    ALBUM_IMAGE_DELETED: 'phone:albumImageDeleted',
    SEND_TO_CHAT: 'phone:sendToChat',
    FLOATING_ENTRY_SETTINGS_CHANGED: 'phone:floatingEntrySettingsChanged',
    INCOMING_CALL: 'phone:incomingCall',
    CLEAR_CURRENT_DATA: 'phone:clearCurrentData',
    CLEAR_ALL_DATA: 'phone:clearAllData',
    // [v2.26.0] 由双向对账扫出：全仓唯一一个「有派发、无契约」的漏网事件。
    PET_STATECHANGE: 'phone:pet-statechange'
});

/**
 * 事件元数据：语义说明 + 类别 + 默认目标对象。
 * target 指明该事件应挂在哪个长期存活对象上 —— window 与 document
 * 都是跨会话存活的，因此其监听器必须可解绑（见 v2.25 / runtime-lifecycle）；
 * 'element' 表示挂在随节点一同消失的元素上，监听器随节点回收，不需登记。
 */
export const PHONE_EVENT_CONTRACT = Object.freeze({
    [PHONE_EVENTS.GO_HOME]: {
        kind: PHONE_EVENT_KINDS.NAVIGATION, target: 'window',
        note: '回到桌面：各 App 收起子页/预览。全仓最高频事件。'
    },
    [PHONE_EVENTS.SWIPE_BACK]: {
        kind: PHONE_EVENT_KINDS.NAVIGATION, target: 'window',
        note: '右滑返回：detail 携手势信息，App 经 handleSwipeBack(e) 消费。'
    },
    [PHONE_EVENTS.OPEN_APP]: {
        kind: PHONE_EVENT_KINDS.NAVIGATION, target: 'window',
        note: '打开指定 App：detail.appId 由 index.js 的路由分支消费。'
    },
    [PHONE_EVENTS.PANEL_VISIBILITY]: {
        kind: PHONE_EVENT_KINDS.LIFECYCLE, target: 'window',
        note: '手机面板显隐：detail.open 为布尔。关闭时各视图应暂停播放/预览。'
    },
    [PHONE_EVENTS.UPDATE_GLOBAL_BADGE]: {
        kind: PHONE_EVENT_KINDS.DATA, target: 'window',
        note: '全局角标重算：桌面图标与悬浮入口的未读数汇聚点。'
    },
    [PHONE_EVENTS.UPDATE_WALLPAPER]: {
        kind: PHONE_EVENT_KINDS.DATA, target: 'window',
        note: '壁纸变更：相册设为壁纸后通知桌面/锁屏刷新。'
    },
    [PHONE_EVENTS.UPDATE_APP_ICON]: {
        kind: PHONE_EVENT_KINDS.DATA, target: 'window',
        note: 'App 图标自定义变更后刷新桌面。'
    },
    [PHONE_EVENTS.UPDATE_CARD_LAYOUT_CSS]: {
        kind: PHONE_EVENT_KINDS.DATA, target: 'window',
        note: '卡片布局自定义 CSS 热更新。'
    },
    [PHONE_EVENTS.TIME_UPDATED]: {
        kind: PHONE_EVENT_KINDS.LIFECYCLE, target: 'window',
        note: '剧情时间推进：time-manager 广播，状态栏/日历/心跳类消费。'
    },
    [PHONE_EVENTS.ALBUM_IMAGE_DELETED]: {
        kind: PHONE_EVENT_KINDS.DATA, target: 'window',
        note: '相册图片删除：壁纸等引用方需自检失效。'
    },
    [PHONE_EVENTS.SEND_TO_CHAT]: {
        kind: PHONE_EVENT_KINDS.COMMUNICATION, target: 'window',
        note: '把 App 内文本投递进聊天输入框。'
    },
    [PHONE_EVENTS.FLOATING_ENTRY_SETTINGS_CHANGED]: {
        kind: PHONE_EVENT_KINDS.LIFECYCLE, target: 'window',
        note: '悬浮入口设置变更：floating-entry 重定位/重样式。'
    },
    [PHONE_EVENTS.INCOMING_CALL]: {
        kind: PHONE_EVENT_KINDS.COMMUNICATION, target: 'window',
        note: '来电演出：电话 App 与通知层消费。'
    },
    [PHONE_EVENTS.CLEAR_CURRENT_DATA]: {
        kind: PHONE_EVENT_KINDS.LIFECYCLE, target: 'window',
        note: '清空当前会话数据：各 App 需清缓存并按需 destroy（v2.25 站点）。'
    },
    [PHONE_EVENTS.CLEAR_ALL_DATA]: {
        kind: PHONE_EVENT_KINDS.LIFECYCLE, target: 'window',
        note: '清空全部数据：同上，但跨会话全量重置。'
    },
    [PHONE_EVENTS.PET_STATECHANGE]: {
        kind: PHONE_EVENT_KINDS.LIFECYCLE, target: 'element',
        note: '桌面宠物状态机广播（Idle/TapReaction/PhoneEnter/PhoneLoop/PhoneExit）。'
            + ' 注意：派发目标是宠物按钮元素而非 window/document，故不属长期存活对象、'
            + '不需登记回收；且当前全仓零订阅者——保留为对外可观测接口。'
    }
});

/** 契约内全部事件名（已排序，供审计对账） */
export function listPhoneEventNames() {
    return Object.values(PHONE_EVENTS).sort();
}

/** 是否为已登记的手机事件名 */
export function isPhoneEventName(name) {
    return Object.values(PHONE_EVENTS).includes(String(name || ''));
}

/**
 * 事件名 → 契约元数据。未登记事件返回 null（不抛，供诊断/守卫使用）。
 */
export function phoneEventMeta(name) {
    return PHONE_EVENT_CONTRACT[String(name || '')] || null;
}

/**
 * 统一派发形态：detail 一律为对象（历史上有的派发传裸值，订阅方
 * 需 `typeof detail === 'object'` 兜底）。返回事件对象供调用方判 defaultPrevented。
 */
export function makePhoneEvent(name, detail = {}, opts = {}) {
    const payload = (detail && typeof detail === 'object' && !Array.isArray(detail))
        ? detail
        : { value: detail === undefined ? null : detail };
    return new CustomEvent(String(name), {
        bubbles: opts.bubbles !== false,
        cancelable: opts.cancelable === true,
        detail: payload
    });
}

/** 在当前长期存活对象上登记/派发（供生命周期守卫与诊断使用）。 */
export const PHONE_EVENT_TARGETS = Object.freeze(['window', 'document', 'element']);
