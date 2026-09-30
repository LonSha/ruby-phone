/* ========================================================
 * avatarframe-data.js — [v3.27.0] 头像框 App 纯函数内核
 *
 * 缝合自 EPhone·xintuk（`src_xintuk/runtime/scripts/avatar-frames/001.js`，
 * 打包载荷 51639 字节 / 解开 43883 字符 / 1823 行）。源里那份文件**只有数据**——
 * 一个 365 条的 `const avatarFrames = [ {id, url, name}, … ]`（364 条带图 + 1 条「无」），
 * 真正的换框逻辑在 `main-app/033.js` 的 `openFrameSelectorModal / createFrameItem / saveSelectedFrames`。
 * 本件取的是**数据模型 + 六态挂载点的账**，不取源的渲染实现（源在 DOM 上直接挂 `<img>`）。
 *
 * 【缝什么、不缝什么 —— 源里三处「本仓不能有」】
 *   ① **上传的图存 IndexedDB**：源把用户上传的框 base64 化后进 `db.customAvatarFrames`
 *      （Dexie）。本仓**零数据库铁律**——落盘一律 PhoneStorage（键前缀 `avatarframe_`），
 *      本文件保持纯函数：数组进、数组出。
 *   ② **外链图床直连**：源 364 条框全部指向 `i.postimg.cc`。本仓**不新增外链消费**
 *      （见 tests/audit.test.mjs 第 8 段「新增模块零外部请求」：`/https?:\/\//` 直接判红）。
 *      故本件**从不内置那 364 个 URL**，只做一件事：**认得出**「你贴进来的东西是什么」。
 *      预置框由用户从源材料导入（`parsePresetFrames`），本文件只负责**解析与去重**。
 *   ③ **六个挂载点一锅端**：源同时给 我的 / 角色的 / 群成员 / 角色微博 / 我的微博 / 主屏资料
 *      六处换框。本仓只有**本会话**这一个作用域（会话隔离由 storage 承担），
 *      故收敛为两个挂载点：`my`（我）/ `ai`（本会话角色）。这不是少缝了四块——
 *      是本仓没有「跨会话的角色微博」这个对象，硬缝会造出无处落地的键。
 *
 * 【从源里取的三块真价值】
 *   · **「无框」是一个正式选项而不是缺省**（源第 1 条 `{ id: 'none', url: '', name: '无' }`）：
 *     换框面板里必须有一条「摘掉」，否则选上去就下不来。
 *   · **按 URL 去重**（源 `openFrameSelectorModal` 里那个 `frameUrlSet`）：
 *     365 条里 id 只有 123 个唯一值（`frame_14` 一条重复 82 次），**id 不是身份，URL 才是**。
 *   · **选中态跟着 URL 走**（源 `saveSelectedFrames` 存的是 `url` 不是 `id`）：
 *     同一个框在两个挂载点上可以同时用，id 撞了也不影响判断。
 *
 * 【与源的偏离（逐条写明）】
 *   1. **身份用 URL 而不是 id**（源 `createFrameItem` 用 id 做 key，而它的数据里 id 重复 82 次）。
 *      以 id 为身份 ⇒ 面板里选「第 3 个」和选「第 8 个」在数据上是同一个东西。
 *   2. **不落 blob / dataURL 之外的东西**：源的 base64 直塞 IndexedDB。本仓写的是
 *      chatMetadata，塞 300 张 base64 会把整个会话存档顶爆，故 `AVATAR_FRAME_LIMITS`
 *      给单条长度与总条数都设上限，超限**如实拒绝**（不是静默截断成半张图）。
 *   3. **选择是草稿、保存才落盘**（源对「角色设置里的框」也是先暂存内存、点保存才写，
 *      对主屏/微博却是立即写 —— 同一份数据两套语义）。本件统一为**草稿 + 显式保存**，
 *      并把「有几处没保存」做成可见读数（源那两套语义在界面上看不出来）。
 *
 * 本文件叶子模块（只引 config/num-gate.js 的取数门），无副作用、不碰 DOM、不碰 window、不碰网络、不内置任何 URL。
 * ======================================================== */
'use strict';
import { numOrNull } from '../../config/num-gate.js';

/** 归因三态。**值**是连字符形，视图文案表的键必须取这里的值（同 focus / piggy / punchcard 纪律）。 */
export const AVATAR_FRAME_REASONS = Object.freeze({
    ready: 'ready',
    empty: 'empty',
    storage_absent: 'storage-absent',
});

/** 挂载点（源的六处收敛为两处，见文件头「不缝什么」第 ③ 条）。 */
export const AVATAR_FRAME_TARGETS = Object.freeze(['my', 'ai']);

export const AVATAR_FRAME_LIMITS = Object.freeze({
    maxFrames: 120,
    maxSrcLen: 200000,
    maxNameLen: 24,
    maxInjectFrames: 6,
});

export const DEFAULT_AVATAR_FRAME_SETTINGS = Object.freeze({
    injectToPrompt: true,
    maxInjectFrames: 6,
    allowExternal: false,
});

export function defaultAvatarFrameSettings() {
    return Object.freeze({ ...DEFAULT_AVATAR_FRAME_SETTINGS });
}

function boundedInt(v, fallback, min, max) {
    // [v3.27.0] 取数改走全仓唯一实现（config/num-gate.js）：
    //   原写法 Number.isFinite(Number(v)) 是弱口径签名 —— Number('') / Number([]) / Number(null)
    //   全是 0，于是「上游没给这一格」与「上游给了 0」塌成同一个读数。
    const n = numOrNull(v);
    if (n === null) return fallback;
    return Math.min(max, Math.max(min, n));
}

export function normalizeAvatarFrameSettings(raw) {
    const d = DEFAULT_AVATAR_FRAME_SETTINGS;
    const o = (raw && typeof raw === 'object') ? raw : {};
    return Object.freeze({
        injectToPrompt: o.injectToPrompt !== false,
        maxInjectFrames: boundedInt(o.maxInjectFrames, d.maxInjectFrames, 0, 20),
        allowExternal: o.allowExternal === true,
    });
}

/**
 * 认一个 src 是什么。
 *   'empty'       —— 空串：**摘掉框**（源第 1 条 `{id:'none', url:''}` 的语义）。
 *   'preset-token'—— `frame_xxx`：预置框的**名字**（源那 365 条的 id 形态）。
 *   'data-url'    —— `data:image/…;base64,…`：真正落得住的自包含图。
 *   'external-url'—— `http(s)://…`：外链。**默认不接受**（本仓不新增外链消费），
 *                    只有用户显式打开 `allowExternal` 才收，且收进来也照实标注来源是外链。
 *   'blob-url'    —— `blob:…`：只在本轮内存里活着，**不适合落盘**（重开会话即失效），如实标注。
 *   'invalid'     —— 其余一切（含 `javascript:` 等）一律拒收。
 * 绝不返回「看起来像图就收下」的第四种含糊态 —— 归因必须可读。
 */
export function classifySource(src) {
    const s = String(src === null || src === undefined ? '' : src).trim();
    if (!s) return 'empty';
    if (/^frame_[A-Za-z0-9_]+$/.test(s)) return 'preset-token';
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(s)) return 'data-url';
    if (/^data:/i.test(s)) return 'invalid';
    if (/^blob:/i.test(s)) return 'blob-url';
    if (/^https?:\/\//i.test(s)) return 'external-url';
    return 'invalid';
}

/** 该 src 能不能落地存下来（blob / 外部链默认不算「落地」）。 */
export function isStorable(src, settings) {
    const kind = classifySource(src);
    if (kind === 'empty' || kind === 'preset-token' || kind === 'data-url') return true;
    if (kind === 'external-url') return !!(settings && settings.allowExternal === true);
    return false;
}

/**
 * 解析预置框清单文本（源 `avatar-frames.js` 里那段数组字面量的**逐字形态**）。
 * 源格式：`{ id: "frame_cat_ear", url: "https://…", name: "1" },`
 * 用真解析（正则逐条匹配）而不是 `eval` —— 本仓不 eval 外来文本。
 * 返回 `{ frames, matched, malformed }`：`matched` 是认出的条目数，
 * `malformed` 是「看着像条目但没认出」的条数（**如实报，不吞**）。
 */
export function parsePresetFrames(rawText) {
    const text = String(rawText || '');
    const total = (text.match(/\{\s*id\s*:/g) || []).length;
    const re = /\{\s*id:\s*"([^"]*)"\s*,\s*url:\s*"([^"]*)"\s*,\s*name:\s*"([^"]*)"\s*,?\s*\}/g;
    const frames = [];
    let m = null;
    while ((m = re.exec(text)) !== null) {
        const src = String(m[2] || '').trim();
        const kind = classifySource(src);
        frames.push({
            id: String(m[1] || '').trim(),
            name: String(m[3] || '').trim().slice(0, AVATAR_FRAME_LIMITS.maxNameLen),
            src,
            kind,
        });
    }
    return { frames, matched: frames.length, malformed: Math.max(0, total - frames.length) };
}

/**
 * 按 **src 去重**（源 `frameUrlSet` 同义；见文件头「真价值」第 2 条）。
 * 空 src 的条目（「无」）只留一条。返回 `{ frames, dropped }`。
 */
export function dedupeFrames(list) {
    const seen = new Set();
    const out = [];
    let dropped = 0;
    for (const f of (Array.isArray(list) ? list : [])) {
        const src = String((f && f.src) || '').trim();
        const key = src || '__none__';
        if (seen.has(key)) { dropped += 1; continue; }
        seen.add(key);
        out.push(f);
    }
    return { frames: out, dropped };
}

/** 单条规范化。name 为空则用序号补名；src 非法（invalid 类）判无效返回 null。 */
export function normalizeFrame(raw, seq) {
    const o = (raw && typeof raw === 'object') ? raw : {};
    const src = String(o.src || '').trim();
    if (src.length > AVATAR_FRAME_LIMITS.maxSrcLen) return null;
    const kind = classifySource(src);
    if (kind === 'invalid') return null;
    const n = boundedInt(seq, 0, 0, 100000);
    const name = String(o.name || '').trim().slice(0, AVATAR_FRAME_LIMITS.maxNameLen) || ('框 ' + (n + 1));
    return {
        id: (typeof o.id === 'string' && o.id) ? o.id : ('avf_' + n + '_' + (src ? src.length : 0)),
        name,
        src,
        kind,
        addedAt: boundedInt(o.addedAt, 0, 0, Number.MAX_SAFE_INTEGER),
    };
}

/** 清单规范化：逐条净化 → 去重 → 截断到上限。返回 `{ frames, dropped, rejected }`。 */
export function normalizeFrames(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const mapped = [];
    let rejected = 0;
    list.forEach((x, i) => {
        const f = normalizeFrame(x, i);
        if (f) mapped.push(f); else rejected += 1;
    });
    const d = dedupeFrames(mapped);
    const frames = d.frames.slice(0, AVATAR_FRAME_LIMITS.maxFrames);
    return {
        frames,
        dropped: d.dropped + Math.max(0, d.frames.length - frames.length),
        rejected,
    };
}

/** 依 src 找框（**身份是 src 不是 id**，见文件头偏离第 1 条）。空 src 是「摘掉」，返回 null。 */
export function resolveFrame(frames, src) {
    const s = String(src || '').trim();
    if (!s) return null;
    for (const f of (Array.isArray(frames) ? frames : [])) {
        if (String(f && f.src || '') === s) return f;
    }
    return null;
}

/** 归因：先判能不能读，再判读到了什么（与 focus / piggy / punchcard 同纪律）。 */
export function readAvatarFrameFace(probe) {
    if (!probe || probe.storageOk === false) return AVATAR_FRAME_REASONS.storage_absent;
    if (probe.hasFrames !== true) return AVATAR_FRAME_REASONS.empty;
    return AVATAR_FRAME_REASONS.ready;
}

/** 按 kind 归类计数（面板要显示「几张自包含 / 几张外链 / 几张只在本轮」）。 */
export function assignStats(frames) {
    const out = { total: 0, 'data-url': 0, 'external-url': 0, 'preset-token': 0, 'blob-url': 0, empty: 0 };
    for (const f of (Array.isArray(frames) ? frames : [])) {
        out.total += 1;
        const k = classifySource(f && f.src);
        if (Object.prototype.hasOwnProperty.call(out, k)) out[k] += 1;
    }
    return out;
}

/**
 * 面板投影：清单读数 + 两个挂载点当前挂着什么（含「挂的框已不在清单里」这一态）。
 * 读不到就如实给 0 / ''，**不编数**。
 */
export function projectFrames(frames, assignments) {
    const list = Array.isArray(frames) ? frames : [];
    const asg = (assignments && typeof assignments === 'object') ? assignments : {};
    const mounts = [];
    for (const t of AVATAR_FRAME_TARGETS) {
        const src = String(asg[t] || '').trim();
        const f = resolveFrame(list, src);
        mounts.push({
            target: t,
            src,
            frame: f ? { id: f.id, name: f.name } : null,
            /** 挂了 URL 但清单里已经没有它 —— 框被删了而挂载点还指着它。 */
            orphan: !!src && !f,
            none: !src,
        });
    }
    return { stats: assignStats(list), mounts, hasAny: list.length > 0 };
}

/**
 * 生成侧注入块。只给**事实**（谁挂着什么框），不给角色台词。
 * 空清单 / 无框可报 ⇒ 返回**空串**（不产生空块，与 place / punchcard 同契约）。
 */
export function avatarFramePromptBlock(proj, settings) {
    if (!settings || settings.injectToPrompt !== true) return '';
    if (!proj || !proj.hasAny) return '';
    const max = (typeof settings.maxInjectFrames === 'number') ? settings.maxInjectFrames : 6;
    if (max <= 0) return '';
    const rows = [];
    for (const m of (Array.isArray(proj.mounts) ? proj.mounts : [])) {
        if (!m || m.none) continue;
        const label = m.frame ? m.frame.name : '（清单里已没有这个框）';
        rows.push((m.target === 'ai' ? '角色' : '我') + '：' + label);
        if (rows.length >= max) break;
    }
    if (!rows.length) return '';
    return '【系统·头像框】\n' + rows.join('\n');
}
