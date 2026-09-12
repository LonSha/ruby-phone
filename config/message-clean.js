/**
 * 消息文本去噪清洗 (移植自 芋圆机 yuyuan.js cleanFloorForSummary / stripStatusBlocks / stripWxTagLines)
 * 纯本地纯规则，零外部 API 依赖。
 * 用途：记忆采集/摘要前剔除 horae 等插件注入的状态块、成对大写块、HTML/样式/脚本、智能代码围栏，
 *      避免把系统状态当剧情内容采进去。
 */

// 状态壳标签(成对块整删 + 残留单标签删)
const STATUS_SHELL_TAGS = 'Sy_StatusBar|[A-Za-z_]*StatusBar|StatusBlock|StatusPanel|状态栏|timebar|时间条|status|affection|好感度|dynamic|pinglun|signature|moodbar|horae|HoraeEvent|horae_event';

export function stripStatusBlocks(text) {
    if (!text) return text;
    let t = String(text);
    // 成对的状态壳整块删:<timebar>…</timebar>、<status>…</status>、<affection>…</affection> 等
    t = t.replace(new RegExp('<\\s*(' + STATUS_SHELL_TAGS + ')\\b[^>]*>[\\s\\S]*?<\\/\\s*\\1\\b[^>]*>', 'gi'), '');
    // 残留的单个状态壳标签
    t = t.replace(new RegExp('<\\/?\\s*(?:' + STATUS_SHELL_TAGS + ')\\b[^>]*>', 'gi'), '');
    // 状态栏的方括号字段:[Time|…] [Outfit|…] [signature|…] [favor|…] 等(带竖线分隔的才删,避免误伤普通方括号)
    t = t.replace(/\[\s*(?:Time|Date|Locate|Location|Place|Outfit|Thoughts|Mind|Mood|Emotion|Status|State|Weather|Action|signature|stats|favor|dynamic|心情|地点|时间|日期|穿着|穿搭|想法|状态|天气|动作|签名|好感|续局)\s*[|｜][^\]]*\s*\]/gi, '');
    return t.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 剧情文本一键清洗(记忆采集/摘要前用)
 * 保留正文与干净文本;删除插件注入的状态块/HTML/脚本/成对块/裸K=V状态行
 */
export function cleanFloorForSummary(text) {
    let t = String(text || '');
    // horae 插件块【整块删】(标签+内容一起)——必须在剥 HTML 标签之前做
    t = t.replace(/<\s*horae\b[^>]*>[\s\S]*?<\/\s*horae\s*>/gi, ' ');
    t = t.replace(/<\/?\s*horae\b[^>]*>/gi, ' ');
    t = t.replace(/\[\s*horae\b[^\]]*\]\s*[\s\S]*?\[\s*\/\s*horae\s*\]/gi, ' ');
    t = t.replace(/\[\s*\/?\s*horae[^\]]*\]/gi, ' ');
    try { t = stripStatusBlocks(t); } catch (e) { /* 忽略 */ }
    // 方括号状态块:[STATUS_START]…[STATUS_END]、[TAG]…[/TAG] 整块删
    t = t.replace(/\[STATUS_START\][\s\S]*?\[STATUS_END\]/gi, ' ');
    t = t.replace(/\[([A-Z][A-Z0-9_]{2,})\][\s\S]*?\[\/\1\]/g, ' ');
    // horae 字段行:time:/location:/atmosphere:/characters:/costume:/mood:/event:/config: 开头的行删
    t = t.replace(/^\s*(time|location|atmosphere|characters?|costume|mood|event|config|theme|layout)\s*[:：][^\n]*$/gim, ' ');
    // 状态追踪字段行:affection/npc/agenda/relationship/status/outfit/appearance/好感/着装/议程 等整行删
    t = t.replace(/^\s*(affection|npcs?|agenda|relationship|status|outfit|appearance|好感度?|着装|外貌|议程|待办事项?)\s*[:：][^\n]*$/gim, ' ');
    // 名字=外貌/数值 裸 K=V 状态行(整行短key=内容、无句读标点)→删;正常摘要是句子不会长这样
    t = t.replace(/^\s*[^\s=\n，。；、,.!?？！]{1,24}=[^\n]{0,140}$/gm, ' ');
    // 代码围栏:中文占比高(=正文)->去掉围栏符保留内容;否则(真代码)才删
    t = t.replace(/```[^\n`]*\n?([\s\S]*?)```/g, (mm, inner) => {
        const s = String(inner || '');
        const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
        return (s.length > 40 && cjk / Math.max(1, s.length) > 0.15) ? ' ' + s + ' ' : ' ';
    });
    // 尖括号 HTML 标签剥壳留字
    t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    t = t.replace(/<[^>]+>/g, ' ');
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    return t;
}

/**
 * 剥掉微信/群聊标签行(可选按名字过滤,只剥涉及指定对象的行)
 * @param text 剧情文本
 * @param names 可选;传了则只剥涉及这些名字的微信行,保留其他人的剧情
 */
export function stripWxTagLines(text, names) {
    if (!text) return text;
    const nm = (Array.isArray(names) ? names : []).map(x => String(x || '')).filter(Boolean);
    let t = String(text);
    const isTagLine = (line) => {
        if (/^(微信|WX|wx|WeChat)\s*[:：]/.test(line)) return true;
        if (/^([\[〔【【]?\s*(微信|短信|私聊|群聊|消息|来信|cloud|线上|offline)\s*[\]〕】]?)\s*[:：]/.test(line)) return true;
        return /^(你|我|[^，。；、\n]{1,8}):\s*[^\n]{0,2}$/.test(line) && /(收|发|说|道|问|答|回|告诉|收到|发来)/.test(line);
    };
    const hitName = (line) => {
        if (!nm.length) return false;
        return nm.some(n => line.includes(n));
    };
    return t.split('\n')
        .filter(line => !(isTagLine(line) && (!nm.length || hitName(line))))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n').trim();
}

export default { stripStatusBlocks, cleanFloorForSummary, stripWxTagLines };