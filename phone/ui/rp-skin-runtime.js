/* ========================================================
 * phone/ui/rp-skin-runtime.js — v3.6 App 皮肤运行时（ESM）（v3.3 起；v3.4 新增第 3a 步「逐站点映射」）
 * v3.6：字符图标桥补三条规则（只在 data-rp-ios="3" 时生效，detach 逐字还原；App 源码一字不改）：
 *   a. 站点表 phone/ui/rp-glyph-sites-v3.6.js：运行时拼出来、落在普通 span / div 里或夹在文字中间的图标（查手机计数、
 *      事务台参与者、提示条……），命中 sel 的元素里按 mode（all / lead）、cps（只换这些码点）换；站点优先于 CONTENT_DENY 的
 *      宽匹配（overrideDeny 的条目），但输入框 / 代码 / 可编辑区 / data-rp33-keep-glyph 一律不碰。
 *   b. 计数串：文本节点整段是「图标 + 数字」（可重复，如 [红心] 12 [气泡] 3），每个图标都换（v3.3 只换第一个）。
 *   c. 属性：title / aria-label / placeholder / alt 与 <option> 文字开头的图标去掉（属性里放不了 SVG；去掉后还有文字才去），
 *      原值存在 data-rp36-attr / data-rp36-opt，detach 时（App 没改过的话）写回。
 *   找这些位置、判定每一处该换还是该留的是 tools/strip-emoji.mjs（落点模拟与这里同一套判据）。
 * v3.5：逐站点映射表换成 rp-inline-map-v3.5.js（v3.4 的 12 个 App 条目逐字不变 + 70 个手写皮肤 App 的站点）；运行逻辑不改。
 * --------------------------------------------------------
 * v3.4：内联样式先走「逐站点精确映射」（3a），查不到的再走 v3.3 的通用降级（3）。
 *   3a. classify  phone/ui/rp-inline-map-v3.4.js 由 tools/gen-inline-map-v34.py 从 12 个 App 的源码生成：每一处 style="..."
 *              按「属性名集合 + 静态取值哈希」登记成语义令牌。这里读元素的**原始** style 文本（App 写进 innerHTML 的原文），
 *              规范化后精确查表；命中就删掉已映射的装饰声明、写 data-rp34="令牌"（等同类名，不改 className），
 *              样式在 app-skins-inline-v3.4.css（@layer rp.skins.inline）。布局 / 尺寸 / 状态 / url() / 模板变量声明不动。
 *              detach 时 style 原文与属性全部写回。
 * 只在 theme-controller 打开 iOS 拟真外观（data-rp-ios="3"）时由它动态加载并 attach；默认不加载。
 * 关掉 v3 时 detach() 把它做过的每一件事都撤销（DOM、属性、样式表、内联样式全部还原）。
 *
 * 做五件事，每件都可以单独关（attachSkinRuntime 的 opts）：
 *   1. skins   按需加载皮肤：公共层一次 + 每个 App 第一次出现时加载 apps/<id>/<id>.v3.css
 *              （识别方式：config/style-skin-v3.js 的类名前缀表；index.js 的 openApp 也可以直接调 ensure(appId)）
 *   2. adopt   「收编」未分层的 App 样式：App 自己插入的 <link href=".../apps/...css"> 和 <style>（例如 wechat-styles、
 *              模板里的 <style>）是未分层样式，天然高于任何 @layer，皮肤压不住它们。这里把它们的文字套进
 *              @layer rp.apps 并去掉 !important（与 DS2 对 phone.css 的做法相同），原 <link> 只是 disabled，原 <style>
 *              的原文存着，detach 时原样写回。用户自定义样式（聊天样式预设、头像框自定义 CSS、桌面卡片 CSS）不收编。
 *   3. demote  内联样式降级：微信 / 设置等 App 有上千处 style="..."，内联样式高于一切层。这里只把「装饰性」属性
 *              （颜色、背景色、边框、圆角、阴影、字体、间距）从 style 属性挪进 @layer rp.apps 的属性选择器规则，
 *              视觉不变、但皮肤可以覆盖；display / position / 尺寸 / transform / opacity / 自定义属性 / 含 url() 的背景 /
 *              带 !important 的内联声明一律不动（那些是状态或用户数据）。
 *   4. glyphs  字符图标桥：界面外壳里的 emoji / 符号图标换成 shared/icons.js 的 SVG。原字符不删，留在一个
 *              视觉隐藏的 <span> 里（textContent 不变，App 里按 textContent 判断状态的代码照常工作，读屏仍可读）。
 *              聊天气泡、朋友圈正文、表情面板、输入框、游戏棋盘等「内容」区域不碰。
 *   5. 以上全部只作用于 root（#phone-panel）内部与 document.head 里的 App 样式，不碰宿主 SillyTavern 的 DOM。
 * 规矩：本文件不写任何颜色字面量、不写 !important、不含字符图标（正则用 \u 转义书写）。
 * ======================================================== */
import '../../shared/icons.js';   // 侧效导入：globalThis.LonShaIcons
import { createSkinLoader, skinAppForClassName, SKIN_V3 } from '../../config/style-skin-v3.js';
import { GLYPH_SITES } from './rp-glyph-sites-v3.6.js';

/* ---------- 3a. 逐站点映射：规范化（与 tools/gen-inline-map-v34.py 的 parse_style / norm_value 同一套规则） ---------- */
function splitDecls(text) {
    const out = []; let cur = ''; let depth = 0; let quote = '';
    for (const ch of String(text || '')) {
        if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(') depth += 1;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        if (ch === ';' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((d) => d.trim()).filter(Boolean);
}
function normValue(v) {
    return String(v).trim().replace(/\s+/g, ' ').replace(/#([0-9a-fA-F]{3,8})\b/g, (m, h) => '#' + h.toLowerCase())
        .replace(/\s*,\s*/g, ',').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
}
/** 原始 style 文本 -> Map(属性 -> 规范化取值；!important 记为后缀 " !important")；解析不了返回 null */
export function normStyle(text) {
    const m = new Map();
    for (const d of splitDecls(text)) {
        const i = d.indexOf(':');
        if (i < 0) continue;
        const p = d.slice(0, i).trim().toLowerCase();
        if (!/^-?[a-z][a-z0-9-]*$/.test(p)) return null;
        let v = normValue(d.slice(i + 1));
        const imp = /!\s*important\s*$/i.test(v);
        if (imp) v = v.replace(/\s*!\s*important\s*$/i, '') + ' !important';
        m.delete(p);
        m.set(p, v);
    }
    return m;
}

/* ---------- 字符 -> 图标名：474 个码点（全仓 App / 外壳 / phone.css 里实际出现过的 emoji 与符号，按 Unicode 名称归到图标；脸 / 手势类统一 smile） ---------- */
export const GLYPH_ICON = Object.freeze({
    0xD7: 'xmark', 0x2026: 'ellipsis', 0x2039: 'chevron-left', 0x203A: 'chevron-right', 0x2139: 'info', 0x2190: 'chevron-left', 0x2191: 'arrow-up',
    0x2192: 'arrow-right', 0x2193: 'arrow-down', 0x2194: 'swap', 0x2197: 'trend-up', 0x2198: 'trend-down', 0x21A5: 'arrow-up', 0x21A9: 'undo',
    0x21AA: 'reply', 0x21B3: 'return', 0x21BA: 'undo', 0x21BB: 'refresh', 0x21C4: 'swap', 0x21D0: 'chevron-left', 0x21D2: 'arrow-right', 0x21D4: 'swap',
    0x22EF: 'ellipsis', 0x2316: 'scope', 0x231B: 'hourglass', 0x23E9: 'forward', 0x23EA: 'backward', 0x23F0: 'alarm', 0x23F1: 'timer',
    0x23F3: 'hourglass', 0x23F8: 'pause', 0x23F9: 'square', 0x25A0: 'square', 0x25A3: 'square', 0x25B2: 'chevron-up', 0x25B4: 'chevron-up',
    0x25B6: 'play', 0x25B8: 'chevron-right-small', 0x25BC: 'chevron-down', 0x25BE: 'chevron-down', 0x25C0: 'chevron-left', 0x25C6: 'dot', 0x25C7: 'dot',
    0x25C8: 'info', 0x25CB: 'circle', 0x25CC: 'circle', 0x25CF: 'dot', 0x25D0: 'circle-half', 0x25F7: 'clock', 0x2600: 'sun', 0x2601: 'cloud',
    0x2605: 'star', 0x2606: 'star', 0x2610: 'square', 0x2611: 'check', 0x2615: 'cup', 0x261D: 'smile', 0x2639: 'smile', 0x2640: 'person',
    0x2642: 'person', 0x2654: 'gamecontroller', 0x2655: 'gamecontroller', 0x2656: 'gamecontroller', 0x2657: 'gamecontroller', 0x2658: 'gamecontroller',
    0x2659: 'gamecontroller', 0x265A: 'gamecontroller', 0x265B: 'gamecontroller', 0x265C: 'gamecontroller', 0x265D: 'gamecontroller',
    0x265E: 'gamecontroller', 0x265F: 'gamecontroller', 0x2660: 'cards', 0x2663: 'cards', 0x2665: 'heart', 0x2666: 'cards', 0x266A: 'music',
    0x266B: 'music', 0x267B: 'refresh', 0x2691: 'flag', 0x2694: 'bolt', 0x2695: 'heart-pulse', 0x2696: 'gauge', 0x2699: 'gear', 0x26A0: 'warning',
    0x26A1: 'bolt', 0x26AA: 'circle', 0x26AB: 'dot', 0x26C5: 'cloud-sun', 0x26D3: 'link', 0x26D4: 'nosign', 0x2702: 'scissors', 0x2705: 'check-circle',
    0x2708: 'airplane', 0x2709: 'mail', 0x270A: 'smile', 0x270B: 'smile', 0x270C: 'smile', 0x270D: 'pencil', 0x270E: 'pencil', 0x270F: 'pencil',
    0x2713: 'check', 0x2714: 'check', 0x2715: 'xmark', 0x2716: 'xmark', 0x2717: 'xmark', 0x2718: 'xmark', 0x2726: 'sparkles', 0x2727: 'sparkles',
    0x2728: 'sparkles', 0x274C: 'x-circle', 0x274E: 'x-circle', 0x2753: 'question', 0x2754: 'question', 0x2757: 'exclaim-double', 0x2763: 'heart',
    0x2764: 'heart', 0x27F6: 'arrow-right', 0x2B05: 'chevron-left', 0x2B07: 'arrow-down', 0x2B21: 'stack', 0x2B50: 'star', 0x1F0CF: 'cards',
    0x1F195: 'sparkles', 0x1F233: 'square', 0x1F300: 'sparkles', 0x1F308: 'sparkles', 0x1F30A: 'droplet', 0x1F30C: 'globe', 0x1F30D: 'globe',
    0x1F310: 'globe', 0x1F319: 'moon', 0x1F31F: 'star', 0x1F321: 'gauge', 0x1F327: 'cloud-rain', 0x1F331: 'flower', 0x1F332: 'flower', 0x1F339: 'flower',
    0x1F33F: 'leaf', 0x1F340: 'leaf', 0x1F346: 'leaf', 0x1F349: 'leaf', 0x1F34E: 'leaf', 0x1F351: 'heart', 0x1F353: 'leaf', 0x1F354: 'utensils',
    0x1F355: 'utensils', 0x1F35F: 'utensils', 0x1F36F: 'cup', 0x1F375: 'cup', 0x1F37A: 'cup', 0x1F37D: 'utensils', 0x1F37E: 'cup', 0x1F381: 'gift',
    0x1F382: 'gift', 0x1F389: 'sparkles', 0x1F38A: 'sparkles', 0x1F392: 'bag', 0x1F393: 'book', 0x1F399: 'mic', 0x1F3A4: 'mic', 0x1F3A5: 'video',
    0x1F3A8: 'paintbrush', 0x1F3AC: 'film', 0x1F3AD: 'mask', 0x1F3AE: 'gamecontroller', 0x1F3AF: 'scope', 0x1F3B0: 'dice', 0x1F3B2: 'dice',
    0x1F3B5: 'music', 0x1F3B6: 'music', 0x1F3BC: 'music', 0x1F3C6: 'trophy', 0x1F3CE: 'car', 0x1F3D9: 'house', 0x1F3DB: 'archive', 0x1F3E0: 'house',
    0x1F3EB: 'house', 0x1F3F0: 'house', 0x1F3F7: 'tag', 0x1F3FA: 'archive', 0x1F41F: 'paw', 0x1F422: 'paw', 0x1F424: 'person', 0x1F426: 'feather',
    0x1F427: 'paw', 0x1F428: 'paw', 0x1F42D: 'smile', 0x1F42E: 'smile', 0x1F42F: 'smile', 0x1F430: 'smile', 0x1F431: 'paw', 0x1F435: 'smile',
    0x1F436: 'paw', 0x1F437: 'smile', 0x1F438: 'smile', 0x1F439: 'smile', 0x1F43A: 'moon', 0x1F43B: 'smile', 0x1F43C: 'smile', 0x1F43E: 'paw',
    0x1F440: 'eye', 0x1F441: 'eye', 0x1F442: 'person', 0x1F443: 'person', 0x1F445: 'person', 0x1F446: 'smile', 0x1F447: 'smile', 0x1F448: 'smile',
    0x1F449: 'smile', 0x1F44A: 'smile', 0x1F44B: 'smile', 0x1F44C: 'smile', 0x1F44D: 'thumbs-up', 0x1F44E: 'thumbs-down', 0x1F44F: 'smile',
    0x1F450: 'smile', 0x1F451: 'crown', 0x1F454: 'shirt', 0x1F464: 'person', 0x1F465: 'people', 0x1F468: 'person', 0x1F469: 'person', 0x1F476: 'person',
    0x1F489: 'inbox', 0x1F48B: 'heart', 0x1F48C: 'bubble-heart', 0x1F48E: 'gem', 0x1F493: 'heart-pulse', 0x1F494: 'heart', 0x1F495: 'heart',
    0x1F496: 'heart', 0x1F497: 'heart', 0x1F498: 'heart', 0x1F499: 'heart', 0x1F49A: 'heart', 0x1F49B: 'heart', 0x1F49C: 'heart', 0x1F49D: 'heart',
    0x1F49E: 'heart', 0x1F4A1: 'lightbulb', 0x1F4A4: 'moon', 0x1F4A7: 'droplet', 0x1F4AB: 'sparkles', 0x1F4AC: 'message', 0x1F4AD: 'chat',
    0x1F4B0: 'wallet', 0x1F4B3: 'creditcard', 0x1F4BC: 'bag', 0x1F4BE: 'save', 0x1F4C1: 'folder', 0x1F4C2: 'folder', 0x1F4C4: 'doc', 0x1F4C5: 'calendar',
    0x1F4C8: 'trend-up', 0x1F4C9: 'trend-down', 0x1F4CA: 'chart', 0x1F4CB: 'checklist', 0x1F4CC: 'pin', 0x1F4CD: 'pin', 0x1F4CF: 'pencil',
    0x1F4D0: 'pencil', 0x1F4D1: 'doc', 0x1F4D2: 'book-closed', 0x1F4D3: 'book-closed', 0x1F4D4: 'book-closed', 0x1F4D5: 'book-closed', 0x1F4D6: 'book',
    0x1F4DA: 'book', 0x1F4DC: 'doc', 0x1F4DD: 'compose', 0x1F4DE: 'phone', 0x1F4E1: 'antenna', 0x1F4E2: 'megaphone', 0x1F4E4: 'upload',
    0x1F4E5: 'download', 0x1F4E6: 'box', 0x1F4E8: 'mail', 0x1F4E9: 'mail', 0x1F4EB: 'mail', 0x1F4EE: 'mail', 0x1F4F0: 'newspaper', 0x1F4F1: 'phone',
    0x1F4F4: 'phone-down', 0x1F4F5: 'nosign', 0x1F4F6: 'cellular', 0x1F4F7: 'camera', 0x1F4F8: 'camera', 0x1F4F9: 'video', 0x1F4FA: 'tv',
    0x1F4FF: 'sparkles', 0x1F500: 'swap', 0x1F501: 'refresh', 0x1F504: 'refresh', 0x1F507: 'speaker-slash', 0x1F50A: 'speaker', 0x1F50B: 'battery',
    0x1F50D: 'search', 0x1F50E: 'search', 0x1F512: 'lock', 0x1F513: 'unlock', 0x1F514: 'bell', 0x1F515: 'bell-slash', 0x1F516: 'bookmark',
    0x1F517: 'link', 0x1F518: 'dot', 0x1F525: 'fire', 0x1F527: 'wrench', 0x1F52E: 'sparkles', 0x1F534: 'dot', 0x1F535: 'dot',
    0x1F539: 'chevron-right-small', 0x1F54A: 'feather', 0x1F550: 'clock', 0x1F552: 'clock', 0x1F56F: 'sparkles', 0x1F570: 'clock', 0x1F575: 'person',
    0x1F578: 'graph', 0x1F58B: 'pencil', 0x1F590: 'smile', 0x1F595: 'smile', 0x1F596: 'smile', 0x1F5A4: 'heart', 0x1F5A5: 'screen-mirror',
    0x1F5BC: 'image', 0x1F5C2: 'folder', 0x1F5C4: 'archive', 0x1F5D1: 'trash', 0x1F5E1: 'scissors', 0x1F5E3: 'chat', 0x1F5E8: 'chat', 0x1F5FA: 'map',
    0x1F600: 'smile', 0x1F601: 'smile', 0x1F602: 'laugh', 0x1F603: 'smile', 0x1F604: 'laugh', 0x1F605: 'smile', 0x1F606: 'smile', 0x1F609: 'smile',
    0x1F60A: 'smile', 0x1F60B: 'smile', 0x1F60C: 'smile', 0x1F60D: 'smile', 0x1F60E: 'smile', 0x1F60F: 'smile', 0x1F610: 'smile', 0x1F612: 'smile',
    0x1F613: 'smile', 0x1F614: 'smile', 0x1F615: 'smile', 0x1F616: 'smile', 0x1F617: 'smile', 0x1F618: 'smile', 0x1F619: 'smile', 0x1F61A: 'smile',
    0x1F61B: 'smile', 0x1F61C: 'smile', 0x1F61D: 'smile', 0x1F61E: 'smile', 0x1F61F: 'smile', 0x1F620: 'smile', 0x1F621: 'smile', 0x1F622: 'smile',
    0x1F623: 'smile', 0x1F624: 'smile', 0x1F625: 'smile', 0x1F628: 'smile', 0x1F629: 'smile', 0x1F62A: 'smile', 0x1F62B: 'smile', 0x1F62C: 'smile',
    0x1F62D: 'smile', 0x1F630: 'smile', 0x1F631: 'smile', 0x1F633: 'smile', 0x1F634: 'moon', 0x1F635: 'smile', 0x1F636: 'smile', 0x1F641: 'smile',
    0x1F642: 'smile', 0x1F643: 'smile', 0x1F644: 'smile', 0x1F64C: 'person', 0x1F64F: 'person', 0x1F680: 'play', 0x1F687: 'car', 0x1F68C: 'car',
    0x1F695: 'car', 0x1F697: 'car', 0x1F69A: 'box', 0x1F6A7: 'warning', 0x1F6A9: 'flag', 0x1F6AB: 'nosign', 0x1F6CD: 'bag', 0x1F6D1: 'nosign',
    0x1F6D2: 'cart', 0x1F6E1: 'shield', 0x1F7E1: 'dot', 0x1F7E2: 'dot', 0x1F90C: 'smile', 0x1F90D: 'heart', 0x1F90E: 'heart', 0x1F90F: 'smile',
    0x1F910: 'smile', 0x1F912: 'smile', 0x1F913: 'smile', 0x1F914: 'smile', 0x1F916: 'robot', 0x1F917: 'smile', 0x1F918: 'smile', 0x1F919: 'smile',
    0x1F91A: 'smile', 0x1F91B: 'smile', 0x1F91C: 'smile', 0x1F91D: 'people', 0x1F91E: 'smile', 0x1F91F: 'smile', 0x1F923: 'smile', 0x1F924: 'smile',
    0x1F928: 'smile', 0x1F929: 'smile', 0x1F92A: 'smile', 0x1F92B: 'smile', 0x1F92C: 'smile', 0x1F92D: 'smile', 0x1F92F: 'smile', 0x1F932: 'smile',
    0x1F947: 'trophy', 0x1F948: 'trophy', 0x1F949: 'trophy', 0x1F95E: 'utensils', 0x1F96B: 'bag', 0x1F970: 'smile', 0x1F973: 'smile', 0x1F975: 'smile',
    0x1F976: 'smile', 0x1F97A: 'smile', 0x1F981: 'smile', 0x1F98A: 'smile', 0x1F9CD: 'person', 0x1F9D0: 'smile', 0x1F9E0: 'brain', 0x1F9E1: 'heart',
    0x1F9E7: 'gift', 0x1F9E9: 'puzzle', 0x1F9EA: 'flask', 0x1F9EC: 'flow', 0x1F9ED: 'compass', 0x1F9EE: 'table', 0x1F9F1: 'stack', 0x1F9F2: 'link',
    0x1F9F5: 'flow', 0x1F9F6: 'flow', 0x1F9F9: 'broom', 0x1F9FE: 'doc', 0x1F9FF: 'eye', 0x1FA79: 'wrench', 0x1FA7A: 'heart-pulse', 0x1FA84: 'wand',
    0x1FA99: 'coins', 0x1FA9E: 'copy', 0x1FAA2: 'flow', 0x1FAA6: 'archive', 0x1FAAA: 'creditcard', 0x1FAB6: 'feather', 0x1FAE1: 'smile',
    0x1FAE2: 'smile', 0x1FAE3: 'smile', 0x1FAE5: 'smile', 0x1FAF0: 'smile', 0x1FAF1: 'smile', 0x1FAF2: 'smile',
    /* v3.6：站点表里出现、v3.5 映射表缺的两个码点 */
    0x2661: 'heart', 0x1F324: 'sun'
});
/* emoji / 常被当图标用的符号（与 tools/glyph-check.mjs 同一组区段）+ 单字符按钮里的 x / 尖括号 / 省略号 */
const RE_GLYPH = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{3030}\u{303D}\u{3297}\u{3299}\u{2122}\u{2139}\u{24C2}]/u;
const RE_JOINERS = /[\u{FE0E}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;
const RE_ONLY = /^(?:[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{3030}\u{303D}\u{3297}\u{3299}\u{2122}\u{2139}\u{24C2}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]){1,6}$/u;
const RE_LEAD = /^(\s*)((?:[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2600}-\u{27BF}\u{2900}-\u{297F}\u{2B00}-\u{2BFF}\u{2122}\u{2139}][\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]*)+)(\s*)(\S[\s\S]*)$/u;
const SINGLE_CHROME = new Set([0xD7, 0x2039, 0x203A, 0x22EF, 0x2026]);   // 只在「按钮里只有这一个字符」时替换
/* v3.6：一个「簇」= 图标字符 + 可选变体 / 肤色 / 键帽 + 可选 ZWJ 连接（与 tools/strip-emoji.mjs 同一组区段） */
const GL_SRC = RE_GLYPH.source;
const MOD_SRC = '[\\u{FE0E}\\u{FE0F}\\u{20E3}\\u{1F3FB}-\\u{1F3FF}]';
const CLUSTER_SRC = GL_SRC + MOD_SRC + '*(?:\\u{200D}' + GL_SRC + MOD_SRC + '*)*';
const RE_COUNTER = new RegExp('^(?:(?:' + CLUSTER_SRC + ')+\\s*\\d[\\d.,\\u{4E07}\\u{5343}\\u{4EBF}+kKwW]*\\s*)+$', 'u');
const RE_LEAD_GROUP = new RegExp('^(\\s*)((?:' + CLUSTER_SRC + ')(?:\\s*(?:' + CLUSTER_SRC + '))*)(\\s*)([\\s\\S]*)$', 'u');
/** 硬内容区：站点表也不能越过 */
const HARD_DENY = 'textarea, input, select, script, style, pre, code, [contenteditable], [data-rp33-keep-glyph], [data-rp33-glyph]';
const ATTR_GLYPH = ['title', 'aria-label', 'placeholder', 'alt'];
const SITES = GLYPH_SITES.map((s) => Object.freeze({
    ...s,
    cps: Array.isArray(s.cps) ? new Set(s.cps) : null,
    icons: new Map(Object.entries(s.icons || {}).map(([k, v]) => [parseInt(k, 16), v]))
}));

/** 内容区（不碰）：聊天 / 朋友圈正文、表情面板、输入、代码、游戏棋盘、用户标记保留的区域 */
const CONTENT_DENY = [
    'textarea', 'input', 'select', 'option', 'script', 'style', 'pre', 'code', '[contenteditable]', '[contenteditable="true"]',
    '.message-text', '.message-content', '.chat-message .message-text', '.moment-text', '.comment-content', '.emoji-panel', '.emoji-item', '.emoji-scroll', '.emoji-tabs',
    '.twemoji-img', '.custom-emoji-item', '.wechat-inline-sticker', '.call-msg-bubble', '.wechat-inner-os-content', '.phone-sms-bubble',
    '.games-board', '.games-card', '.games-2048-board', '[class*="-board"]', '[class*="-cell"]', '[class*="-piece"]', '[class*="poker-card"]',
    '[data-rp33-keep-glyph]', '[data-rp33-glyph]'
].join(', ');
/** 外壳元素：开头的 emoji 会换成图标（后面跟文字也换） */
const CHROME_SEL = 'button, [role="button"], [role="tab"], [role="menuitem"], label, h1, h2, h3, h4, header, nav, .phone-notification, .phone-back-button, [class*="-btn"], [class*="-tab"], [class*="-title"], [class*="-label"], [class*="-header"], [class*="-chip"], [class*="-badge"], [class*="-icon"], [class*="-hint"], [class*="-empty"], [class*="-toast"], [class*="-menu"]';

/** 内联样式里可以降级的「装饰性」属性（浏览器会把简写展开成长写，这里两种都认） */
const DEMOTE_RE = /^(?:color|background(?:-color|-image|-position(?:-x|-y)?|-size|-repeat(?:-x|-y)?|-origin|-clip|-attachment)?|border(?:-[a-z-]+)?|outline(?:-[a-z]+)?|box-shadow|text-shadow|font(?:-[a-z-]+)?|letter-spacing|line-height|text-transform|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|gap|row-gap|column-gap|-webkit-backdrop-filter|backdrop-filter)$/;
const DEMOTE = { has: (p) => DEMOTE_RE.test(p) };
/** 不收编（用户自己写 / 选的样式，必须照旧压过皮肤） */
/* v3.4：加 mofo-global-bubble-style —— 魔坊全局气泡挂在宿主页面上（不在手机里），颜色读宿主主题，收编会改变它与宿主样式的先后 */
const ADOPT_DENY_ID = new Set(['wechat-custom-chat-style', 'weibo-custom-avatar-frame-style', 'phone-card-layout-custom-style', 'rp33-demoted', 'mofo-global-bubble-style']);
const ADOPT_MARK = '/* rp33-adopted */';

function cssPrefixRe() {
    const ps = new Set();
    SKIN_V3.forEach((e) => e.detect.forEach((p) => ps.add(p)));
    const alt = [...ps].sort((a, b) => b.length - a.length).map((p) => p.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
    return new RegExp('#phone-panel|\\.phone-|\\.(?:' + alt + ')-', 'u');
}

/** 字符串哈希（FNV-1a，32 位）——只用于给去重后的内联声明起一个稳定的短名字 */
function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }

function rewriteUrls(cssText, baseHref) {
    return String(cssText || '').replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => {
        if (/^(?:data:|https?:|blob:|#|\/)/i.test(u)) return m;
        try { return 'url("' + new URL(u, baseHref).href + '")'; } catch (_e) { return m; }
    });
}

/**
 * @param {HTMLElement} root  手机根节点（#phone-panel）
 * @param {{ doc?: Document, baseUrl: string, layerize: Function, skins?: boolean, adopt?: boolean, demote?: boolean, glyphs?: boolean, fetchText?: Function }} opts
 * @returns {{ ensure(appId: string): Promise<any>, detach(): void, collect(): object, _scan(): void }}
 */
export function attachSkinRuntime(root, opts = {}) {
    const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
    if (!root || !doc || typeof root.querySelectorAll !== 'function') return { ensure: async () => null, detach() {}, collect: () => ({ attached: false }), _scan() {} };
    const on = { skins: opts.skins !== false, adopt: opts.adopt !== false, classify: opts.classify !== false, demote: opts.demote !== false, glyphs: opts.glyphs !== false };
    const layerize = typeof opts.layerize === 'function' ? opts.layerize : (css) => css;
    const fetchText = typeof opts.fetchText === 'function' ? opts.fetchText : (href) => fetch(href, { cache: 'force-cache' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))));
    const isOn = () => root.getAttribute('data-rp-ios') === '3';
    const loader = createSkinLoader({ doc, baseUrl: opts.baseUrl || '', isOn });
    const seenApps = new Set();
    const counts = { apps: 0, adoptedLinks: 0, adoptedStyles: 0, classified: 0, demoted: 0, glyphs: 0, glyphSites: 0, glyphCounters: 0, glyphAttrs: 0 };
    const classified = new Map();         // 元素 -> { orig: 原始 style 文本, after: 映射后的 style 文本 }
    const classifiedSigs = new Set();
    const appCache = new WeakMap();
    let lastApp = null;
    /* 映射表：调用方可直接传入（预览 / 测试）；否则按需动态加载，加载完成后重扫一遍 */
    let inlineMap = opts.inlineMap || null;
    const styleOrig = new Map();          // <style> -> 原文
    const demoted = new Map();            // 哈希 -> [[prop, value], ...]
    const prefixRe = cssPrefixRe();
    let demoteSheet = null;
    let dirtyDemote = false;
    let detached = false;
    let iconNames = null;

    /* ---------- 1. 皮肤 ---------- */
    function ensure(appId) {
        if (!on.skins || !appId || detached) return Promise.resolve(null);
        if (!seenApps.has(appId)) { seenApps.add(appId); counts.apps += 1; }
        return loader.ensure(appId);
    }
    function detectApps(scope) {
        if (!on.skins) return;
        const els = [scope, ...scope.querySelectorAll('[class]')].slice(0, 600);
        for (const el of els) {
            const id = el && el.getAttribute ? skinAppForClassName(el.getAttribute('class')) : null;
            if (id && !seenApps.has(id)) ensure(id);
        }
    }

    /* ---------- 2. 收编未分层样式 ---------- */
    function adoptStyle(st) {
        if (!on.adopt || !st || st.id && ADOPT_DENY_ID.has(st.id) || st.hasAttribute('data-rp-layer') || st.hasAttribute('data-rp33-own')) return;
        const text = st.textContent || '';
        if (!text || text.startsWith(ADOPT_MARK) || /@layer\s/.test(text) || !prefixRe.test(text)) return;
        styleOrig.set(st, text);
        st.setAttribute('data-rp33-adopted', '1');
        st.textContent = ADOPT_MARK + '\n' + layerize(text, 'rp.apps', { stripImportant: true });
        counts.adoptedStyles += 1;
    }
    function adoptLink(link) {
        if (!on.adopt || !link || link.hasAttribute('data-rp33-skin') || link.hasAttribute('data-rp33-adopted')) return;
        const href = link.href || '';
        if (!/\/apps\/[^?#]+\.css(?:[?#]|$)/.test(href) || /\.v3\.css(?:[?#]|$)/.test(href) ) return;
        link.setAttribute('data-rp33-adopted', 'pending');
        fetchText(href).then((text) => {
            if (detached || !link.isConnected) return;
            if (/@layer\s/.test(text)) { link.setAttribute('data-rp33-adopted', 'layered'); return; }   // 已分层（v1 的 token 版 honey / diary / memory）
            const st = doc.createElement('style');
            st.setAttribute('data-rp33-own', 'adopt');
            st.setAttribute('data-rp33-adopt-of', href);
            st.textContent = ADOPT_MARK + '\n' + layerize(rewriteUrls(text, href), 'rp.apps', { stripImportant: true });
            link.after(st);
            link.disabled = true;
            link.setAttribute('data-rp33-adopted', '1');
            counts.adoptedLinks += 1;
        }).catch(() => { link.removeAttribute('data-rp33-adopted'); });   // 取不到就保持原样（只是这个 App 的旧样式仍高于皮肤）
    }
    function adoptAll() {
        if (!on.adopt) return;
        doc.querySelectorAll('link[rel~="stylesheet"]').forEach(adoptLink);
        doc.querySelectorAll('style').forEach((st) => { if (st.getAttribute('data-rp33-adopted') !== '1') adoptStyle(st); });
    }

    /** 只处理 .phone-screen 里面（App 画面）：scope 在屏幕里就用 scope，scope 包着屏幕就用那块屏幕 */
    function screenScope(scope) {
        if (!scope || scope.nodeType !== 1) return null;
        if (scope.closest('.phone-screen')) return scope;
        return scope.querySelector('.phone-screen');
    }

    /* ---------- 3a. 逐站点映射（先于 3；命中的元素不再降级） ---------- */
    /** 祖先链上（由近到远）出现的、有映射表的 App；最后补上一次命中的 App（弹层常挂在 App 根节点之外） */
    function appsOf(el) {
        const ids = [];
        for (let n = el, i = 0; n && n !== root && i < 48; n = n.parentElement, i += 1) {
            let id = appCache.get(n);
            if (id === undefined) {
                id = n.getAttribute ? skinAppForClassName(n.getAttribute('class')) : null;
                appCache.set(n, id);
            }
            if (id && inlineMap && inlineMap[id] && !ids.includes(id)) ids.push(id);
        }
        if (lastApp && !ids.includes(lastApp)) ids.push(lastApp);
        return ids;
    }
    function classifyEl(el) {
        if (!inlineMap || el.hasAttribute('data-rp34') || el.hasAttribute('data-rp33-st') || el.closest('[data-rp-keep-style]')) return false;
        const raw = el.getAttribute('style');
        if (!raw) return false;
        const decls = normStyle(raw);
        if (!decls || !decls.size) return false;
        const props = [...decls.keys()].sort();
        const key = props.join(',');
        const vals = props.map((p) => decls.get(p));
        const tag = String(el.tagName || '').toLowerCase();
        for (const app of appsOf(el)) {
            const bucket = inlineMap[app][key];
            if (!bucket) continue;
            const sigNow = (mask) => hash(vals.filter((_v, i) => mask[i] !== '1').join('\u001f'));
            /* 先找标签一致的条目（同一段 style 在 <input> 与 <div> 上可能是不同组件），再退到同哈希的任意条目 */
            const hit = bucket.find((e) => e[5] === tag && sigNow(e[0]) === e[1]) || bucket.find((e) => sigNow(e[0]) === e[1]);
            if (!hit) continue;
            const [, sig, toks, strip, add] = hit;
            const st = el.style;
            strip.forEach((p) => st.removeProperty(p));
            (add || []).forEach(([p, v]) => st.setProperty(p, v));
            el.setAttribute('data-rp34', toks);
            classified.set(el, { orig: raw, after: el.getAttribute('style') || '' });
            classifiedSigs.add(app + ':' + sig);
            counts.classified += 1;
            lastApp = app;
            return true;
        }
        return false;
    }
    function classifyTree(scope) {
        if (!on.classify || !inlineMap) return;
        const base = screenScope(scope);
        if (!base) return;
        if (base.hasAttribute && base.hasAttribute('style')) classifyEl(base);
        base.querySelectorAll('[style]').forEach(classifyEl);
    }
    /** 两段 style 文本是否声明完全相同（与顺序无关；两边都是同一个浏览器序列化出来的，取值格式一致） */
    function sameDecls(a, b) {
        const x = normStyle(a) || new Map(); const y = normStyle(b) || new Map();
        if (x.size !== y.size) return false;
        for (const [p, v] of x) if (y.get(p) !== v) return false;
        return true;
    }
    function unclassify() {
        classified.forEach(({ orig, after }, el) => {
            if (!el.isConnected) return;
            if (sameDecls(el.getAttribute('style') || '', after)) el.setAttribute('style', orig);
            else {   /* App 之后又改过这个元素：只补回被删、且现在没有的声明 */
                const o = normStyle(orig) || new Map();
                o.forEach((v, p) => { if (!el.style.getPropertyValue(p)) el.style.setProperty(p, v.replace(/ !important$/, ''), / !important$/.test(v) ? 'important' : ''); });
            }
            el.removeAttribute('data-rp34');
        });
        classified.clear();
    }

    /* ---------- 3. 内联样式降级 ---------- */
    function flushDemoteSheet() {
        dirtyDemote = false;
        if (!demoteSheet) {
            demoteSheet = doc.createElement('style');
            demoteSheet.id = 'rp33-demoted';
            demoteSheet.setAttribute('data-rp33-own', 'demote');
            doc.head.appendChild(demoteSheet);
        }
        let body = '';
        demoted.forEach((decls, h) => { body += '[data-rp33-st="' + h + '"]{' + decls.map(([p, v]) => p + ':' + v).join(';') + '}\n'; });
        demoteSheet.textContent = layerize(body, 'rp.apps');
    }
    function demoteEl(el) {
        const st = el.style;
        if (!st || !st.length || el.closest('[data-rp-keep-style]')) return;
        const take = [];
        for (let i = 0; i < st.length; i++) {
            const p = st[i];
            if (!DEMOTE.has(p) || st.getPropertyPriority(p) === 'important') continue;
            const v = st.getPropertyValue(p);
            if (!v || /url\(/i.test(v)) continue;
            take.push([p, v.trim()]);
        }
        if (!take.length) return;
        const prev = el.getAttribute('data-rp33-st');
        const merged = prev && demoted.has(prev) ? [...demoted.get(prev).filter(([p]) => !take.some(([q]) => q === p)), ...take] : take;
        merged.sort((a, b) => (a[0] < b[0] ? -1 : 1));
        const h = 's' + hash(merged.map(([p, v]) => p + ':' + v).join(';'));
        if (!demoted.has(h)) { demoted.set(h, merged); dirtyDemote = true; }
        el.setAttribute('data-rp33-st', h);
        take.forEach(([p]) => st.removeProperty(p));
        counts.demoted += 1;
    }
    function demoteTree(scope) {
        if (!on.demote) return;
        const base = screenScope(scope);
        if (!base) return;
        if (base.hasAttribute && base.hasAttribute('style')) demoteEl(base);
        base.querySelectorAll('[style]').forEach(demoteEl);
        if (dirtyDemote) flushDemoteSheet();
    }

    /* ---------- 4. 字符图标桥 ---------- */
    function iconFor(text, over) {
        const L = globalThis.LonShaIcons;
        if (!L) return null;
        if (!iconNames) iconNames = new Set(typeof L.names === 'function' ? L.names() : []);
        for (const ch of String(text).replace(RE_JOINERS, '')) {
            const name = (over && over.get(ch.codePointAt(0))) || GLYPH_ICON[ch.codePointAt(0)];
            if (name && iconNames.has(name)) return name;
        }
        return 'dot';
    }
    function wrapGlyph(textNode, glyphText, over) {
        const L = globalThis.LonShaIcons;
        const name = iconFor(glyphText, over);
        const span = doc.createElement('span');
        span.setAttribute('data-rp33-glyph', '1');
        span.className = 'rp33-gl';
        const keep = doc.createElement('span');
        keep.className = 'rp33-gl-txt';
        keep.textContent = glyphText;          // 原字符保留：textContent 不变，读屏可读
        span.appendChild(keep);
        span.insertAdjacentHTML('beforeend', L.svg(name, { className: 'lt-icon rp33-gi', fill: name === 'heart' || name === 'star' }));
        textNode.parentNode.insertBefore(span, textNode);
        return span;
    }
    function bridgeText(node) {
        const t = node.nodeValue;
        if (!t || !RE_GLYPH.test(t) && !(t.trim().length === 1 && SINGLE_CHROME.has(t.trim().codePointAt(0)))) return;
        const parent = node.parentElement;
        if (!parent || parent.closest(HARD_DENY)) return;
        const denied = !!parent.closest(CONTENT_DENY);
        /* v3.6 a. 站点表（逐条核对过的位置，先于 CONTENT_DENY 的宽匹配；overrideDeny 以外的条目仍受它约束） */
        const site = SITES.find((s) => (!denied || s.overrideDeny) && parent.closest(s.sel));
        if (site && wrapClusters(node, site.mode === 'lead', site.cps, site.icons)) { counts.glyphSites += 1; return; }
        if (denied) return;
        const trimmed = t.trim();
        /* v3.6 b. 计数串：整段是「图标 + 数字」时每个图标都换 */
        if (RE_COUNTER.test(trimmed) && wrapClusters(node, false, null, null)) { counts.glyphCounters += 1; return; }
        if (RE_ONLY.test(trimmed) || (trimmed.length === 1 && SINGLE_CHROME.has(trimmed.codePointAt(0)) && parent.closest('button, [role="button"], [class*="-btn"], [class*="close"]'))) {
            const idx = t.indexOf(trimmed);
            if (idx > 0) node.parentNode.insertBefore(doc.createTextNode(t.slice(0, idx)), node);
            wrapGlyph(node, trimmed);
            node.nodeValue = t.slice(idx + trimmed.length);
            if (!node.nodeValue) node.remove();
            if (parent.childElementCount === 1 && !parent.textContent.replace(trimmed, '').trim()) parent.setAttribute('data-rp33-glyph-only', '1');
            counts.glyphs += 1;
            return;
        }
        if (!parent.closest(CHROME_SEL)) return;
        const m = RE_LEAD.exec(t);
        if (!m) return;
        const before = doc.createTextNode(m[1]);
        node.parentNode.insertBefore(before, node);
        wrapGlyph(node, m[2]);
        node.nodeValue = (m[3] ? ' ' : '') + m[4];
        counts.glyphs += 1;
    }
    /** v3.6：把文本节点里的图标簇逐个换成 SVG（leadOnly = 只换开头那一组）；cps = 只换这些码点；返回换了几处 */
    function wrapClusters(node, leadOnly, cps, over) {
        const t = node.nodeValue || '';
        const pieces = [];   // [文字, 图标] 交替
        if (leadOnly) {
            const m = RE_LEAD_GROUP.exec(t);
            if (!m || (cps && !cps.has(m[2].codePointAt(0)))) return 0;
            pieces.push([m[1], m[2]]);
            node.nodeValue = (m[3] ? ' ' : '') + m[4];
        } else {
            const re = new RegExp(CLUSTER_SRC, 'gu');
            let last = 0, m;
            while ((m = re.exec(t))) {
                if (cps && !cps.has(m[0].codePointAt(0))) continue;
                pieces.push([t.slice(last, m.index), m[0]]);
                last = m.index + m[0].length;
            }
            if (!pieces.length) return 0;
            node.nodeValue = t.slice(last);
        }
        for (const [txt, gl] of pieces) {
            if (txt) node.parentNode.insertBefore(doc.createTextNode(txt), node);
            wrapGlyph(node, gl, over);
            counts.glyphs += 1;
        }
        const parent = node.parentNode;
        if (!node.nodeValue) node.remove();
        if (parent && !String(parent.textContent || '').replace(new RegExp(CLUSTER_SRC, 'gu'), '').trim() && parent.querySelectorAll('[data-rp33-glyph]').length === parent.childElementCount) parent.setAttribute('data-rp33-glyph-only', '1');
        return pieces.length;
    }
    /** v3.6 c. 属性与 <option>：开头的图标去掉（去掉后还有文字才去），原值存档 */
    function bridgeAttrs(base) {
        const els = [base, ...base.querySelectorAll('[title], [aria-label], [placeholder], [alt], option')];
        for (const el of els) {
            if (!el || el.nodeType !== 1 || el.closest('[data-rp33-keep-glyph]')) continue;
            const saved = el.hasAttribute('data-rp36-attr') ? JSON.parse(el.getAttribute('data-rp36-attr')) : {};
            let touched = false;
            for (const a of ATTR_GLYPH) {
                const v = el.getAttribute(a);
                if (!v || !RE_GLYPH.test(v)) continue;
                const m = RE_LEAD_GROUP.exec(v);
                if (!m || !m[4].trim()) continue;
                saved[a] = [v, m[4]];
                el.setAttribute(a, m[4]);
                touched = true;
                counts.glyphAttrs += 1;
            }
            if (touched) el.setAttribute('data-rp36-attr', JSON.stringify(saved));
            if (el.tagName === 'OPTION' && !el.hasAttribute('data-rp36-opt') && el.childElementCount === 0) {
                const v = el.textContent || '';
                const m = RE_GLYPH.test(v) ? RE_LEAD_GROUP.exec(v) : null;
                if (m && m[4].trim()) { el.setAttribute('data-rp36-opt', v); el.textContent = m[4]; counts.glyphAttrs += 1; }
            }
        }
    }
    function unbridgeAttrs() {
        root.querySelectorAll('[data-rp36-attr]').forEach((el) => {
            let saved = {};
            try { saved = JSON.parse(el.getAttribute('data-rp36-attr')) || {}; } catch (_e) { saved = {}; }
            Object.entries(saved).forEach(([a, [orig, now]]) => { if (el.getAttribute(a) === now) el.setAttribute(a, orig); });
            el.removeAttribute('data-rp36-attr');
        });
        root.querySelectorAll('[data-rp36-opt]').forEach((el) => { el.textContent = el.getAttribute('data-rp36-opt'); el.removeAttribute('data-rp36-opt'); });
    }
    function bridgeTree(scope) {
        if (!on.glyphs || !globalThis.LonShaIcons) return;
        const base = screenScope(scope);
        if (!base) return;
        const walker = doc.createTreeWalker(base, 4 /* NodeFilter.SHOW_TEXT */);
        const list = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) list.push(n);
        list.forEach(bridgeText);
        bridgeAttrs(base);
    }
    function unbridge() {
        root.querySelectorAll('[data-rp33-glyph]').forEach((span) => {
            const keep = span.querySelector('.rp33-gl-txt');
            const txt = doc.createTextNode(keep ? keep.textContent : '');
            const p = span.parentNode;
            span.replaceWith(txt);
            if (p && p.normalize) p.normalize();
        });
        root.querySelectorAll('[data-rp33-glyph-only]').forEach((el) => el.removeAttribute('data-rp33-glyph-only'));
    }

    /* ---------- 调度：首轮全扫，之后只扫新增节点（下一帧合并） ---------- */
    let pending = new Set();
    let raf = 0;
    const raf$ = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16);
    const caf$ = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
    function run(scope) {
        if (!isOn() || detached) return;
        try { detectApps(scope); } catch (_e) { /* 非致命 */ }
        try { classifyTree(scope); } catch (_e) { /* 非致命 */ }
        try { demoteTree(scope); } catch (_e) { /* 非致命 */ }
        try { bridgeTree(scope); } catch (_e) { /* 非致命 */ }
    }
    function schedule(node) {
        pending.add(node);
        if (raf) return;
        raf = raf$(() => {
            raf = 0;
            const batch = [...pending]; pending = new Set();
            batch.forEach((n) => { if (n.isConnected && n.nodeType === 1) run(n); });
            adoptAll();
        });
    }
    const MO = typeof MutationObserver === 'function' ? MutationObserver : null;
    const moRoot = MO ? new MO((recs) => {
        for (const r of recs) for (const n of r.addedNodes) {
            if (n.nodeType === 1 && !(n.hasAttribute && n.hasAttribute('data-rp33-glyph'))) schedule(n);
            else if (n.nodeType === 3 && r.target && r.target.nodeType === 1 && !r.target.closest('[data-rp33-glyph]')) schedule(r.target);
        }
    }) : null;
    const moHead = MO ? new MO((recs) => {
        for (const r of recs) {
            r.addedNodes.forEach((n) => { if (n.nodeName === 'LINK') adoptLink(n); else if (n.nodeName === 'STYLE') adoptStyle(n); });
            if (r.target && r.target.nodeName === 'STYLE' && r.target.getAttribute('data-rp33-adopted') === '1' && !(r.target.textContent || '').startsWith(ADOPT_MARK)) adoptStyle(r.target);   // App 改写了已收编的 <style>
        }
    }) : null;

    if (on.skins) loader.ensureCommon();
    if (on.classify && !inlineMap) {
        const loadMap = typeof opts.loadInlineMap === 'function' ? opts.loadInlineMap : () => import('./rp-inline-map-v3.5.js').then((m) => m.INLINE_MAP);
        Promise.resolve().then(loadMap).then((m) => { if (!detached && m) { inlineMap = m; run(root); } }).catch(() => { /* 非致命：没有映射表就只走 v3.3 降级 */ });
    }
    run(root);
    adoptAll();
    if (moRoot) moRoot.observe(root, { childList: true, subtree: true });
    if (moHead) moHead.observe(doc.head, { childList: true, subtree: true });

    function detach() {
        if (detached) return;
        detached = true;
        if (moRoot) moRoot.disconnect();
        if (moHead) moHead.disconnect();
        if (raf) caf$(raf);
        loader.detachAll();
        /* 收编还原 */
        styleOrig.forEach((text, st) => { if (st.isConnected) { st.textContent = text; st.removeAttribute('data-rp33-adopted'); } });
        styleOrig.clear();
        doc.querySelectorAll('style[data-rp33-own="adopt"]').forEach((st) => st.remove());
        doc.querySelectorAll('link[data-rp33-adopted]').forEach((l) => { l.disabled = false; l.removeAttribute('data-rp33-adopted'); });
        /* 内联样式写回（App 之后自己又写了同名属性的，以 App 为准） */
        root.querySelectorAll('[data-rp33-st]').forEach((el) => {
            const decls = demoted.get(el.getAttribute('data-rp33-st')) || [];
            decls.forEach(([p, v]) => { if (!el.style.getPropertyValue(p)) el.style.setProperty(p, v); });
            el.removeAttribute('data-rp33-st');
        });
        demoted.clear();
        if (demoteSheet) { demoteSheet.remove(); demoteSheet = null; }
        /* 逐站点映射写回（在降级写回之后：先把降级挪走的声明补回，再整体对照映射后的快照还原原文） */
        unclassify();
        /* 字符图标还原 */
        unbridge();
        unbridgeAttrs();
    }
    function collect() {
        return { attached: !detached, on: { ...on }, ...counts, distinctClassified: classifiedSigs.size, inlineMap: !!inlineMap, distinctDemoted: demoted.size, skins: loader.collect() };
    }
    return { ensure, detach, collect, _scan: () => run(root) };
}

export const _internals = { GLYPH_ICON, RE_ONLY, RE_LEAD, DEMOTE, rewriteUrls, hash, CONTENT_DENY, CHROME_SEL, normStyle, RE_COUNTER, RE_LEAD_GROUP, SITES, HARD_DENY };
