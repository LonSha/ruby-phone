/**
 * 裸时钟分类 —— 唯一桥（v4.157.0 · R22-O5）
 *
 * 纪律：纯函数。把一处裸 Date.now() / 时间字段用法分类为 story 档（内容时间轴，必须收口）
 * 或 wall 档（渲染节奏，可保留）。分类只按调用点特征判，不替调用方改写。
 * 四态：invalid / story / wall / unknown。
 */
export const CLOCK_CLASSES = Object.freeze(['story', 'wall', 'unknown']);
export const CLOCK_FACES = Object.freeze(['invalid', 'classified']);

export function classifyClockSite(site) {
    if (!site || typeof site !== 'object') return { face: 'invalid', cls: 'unknown' };
    const field = String(site.field == null ? '' : site.field).toLowerCase();
    const context = String(site.context == null ? '' : site.context).toLowerCase();
    const STORY_FIELDS = ['storyat', 'timestamp', 'time', 'date', 'createdat', 'sentat'];
    const WALL_HINTS = ['debounce', 'throttle', 'raf', 'interval', 'timeout', 'anim', 'scroll', 'render'];
    let cls = 'unknown';
    if (WALL_HINTS.some((h) => context.indexOf(h) >= 0)) cls = 'wall';
    else if (STORY_FIELDS.some((f) => field === f || field.indexOf(f) >= 0)) cls = 'story';
    return { face: 'classified', cls, field, reason: cls === 'unknown' ? 'no-signal' : cls + '-matched' };
}

export function classifySummary(sites) {
    const arr = Array.isArray(sites) ? sites : [];
    const out = { story: 0, wall: 0, unknown: 0 };
    for (const s of arr) out[classifyClockSite(s).cls]++;
    return { face: arr.length ? 'classified' : 'invalid', counts: out, total: arr.length };
}

export function clockClassifyNote(r) {
    if (!r || r.face === 'invalid') return '没有可分类的时钟用法';
    const c = r.counts;
    return `story ${c.story} / wall ${c.wall} / 未知 ${c.unknown}`;
}

export function clockClassifySelfCheck() {
    const bad = [];
    if (classifyClockSite(null).face !== 'invalid') bad.push('空应 invalid');
    if (classifyClockSite({ field: 'storyAt' }).cls !== 'story') bad.push('storyAt 应 story');
    if (classifyClockSite({ field: 'x', context: 'debounce' }).cls !== 'wall') bad.push('防抖应 wall');
    if (classifyClockSite({ field: 'mystery' }).cls !== 'unknown') bad.push('无信号应 unknown');
    const sum = classifySummary([{ field: 'storyAt' }, { context: 'scroll' }, { field: '?' }]);
    if (sum.counts.story !== 1 || sum.counts.wall !== 1 || sum.counts.unknown !== 1) bad.push('汇总计数错');
    return { ok: bad.length === 0, bad };
}
