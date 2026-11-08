/* ============================================================
 * i18n-dynamic-locale-engine.js — [v4.139.0 · 第十八期全新内核底座]
 * 操作系统级多语言国际化与动态时区漫游引擎 (i18n & Dynamic Locale Engine)
 * ------------------------------------------------------------
 * 【核心机制与跨国时空拟真】
 * 解决跨国旅行剧情中时间与语言静态锁死的假人感：
 *   - 动态时区与世界时钟: 随剧情飞抵东京、伦敦、纽约时，系统时间栏与时区差自动漫游；
 *   - 手机系统语言随需切换: 中文(zh-CN)、英文(en-US)、日文(ja-JP)全量 UI 字符串资源字典映射。
 * ============================================================ */

export class I18nDynamicLocaleEngine {
    constructor(options = {}) {
        this.options = Object.assign({
            currentLocale: "zh-CN",
            currentTimezoneOffsetHours: 8
        }, options);

        this.localePacks = {
            "zh-CN": {
                battery: "电量",
                signal: "信号",
                swipeUpToUnlock: "轻扫以打开",
                noService: "无服务",
                cancel: "取消",
                send: "发送"
            },
            "en-US": {
                battery: "Battery",
                signal: "Signal",
                swipeUpToUnlock: "Swipe up to open",
                noService: "No Service",
                cancel: "Cancel",
                send: "Send"
            },
            "ja-JP": {
                battery: "バッテリー",
                signal: "電波",
                swipeUpToUnlock: "上にスワイプしてロック解除",
                noService: "圏外",
                cancel: "キャンセル",
                send: "送信"
            }
        };
    }

    setLocale(locale) {
        if (this.localePacks[locale]) {
            this.options.currentLocale = locale;
            return true;
        }
        return false;
    }

    setTimezoneOffset(offsetHours) {
        this.options.currentTimezoneOffsetHours = Number(offsetHours) || 8;
    }

    t(key) {
        const pack = this.localePacks[this.options.currentLocale] || this.localePacks["zh-CN"];
        return pack[key] || key;
    }

    getSystemTimeDisplay() {
        const utcNow = Date.now();
        const localDate = new Date(utcNow + this.options.currentTimezoneOffsetHours * 3600 * 1000);
        const hours = String(localDate.getUTCHours()).padStart(2, "0");
        const minutes = String(localDate.getUTCMinutes()).padStart(2, "0");
        return {
            timeStr: `${hours}:${minutes}`,
            timezone: `UTC${this.options.currentTimezoneOffsetHours >= 0 ? "+" : ""}${this.options.currentTimezoneOffsetHours}`
        };
    }
}

export default I18nDynamicLocaleEngine;