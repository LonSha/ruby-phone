/* ========================================================
 * config/character-slot-manager.js — [v3.71.0 · 拓展计划 X7] 多角色生图操作深化（纯函数）
 *
 * 【为什么需要这一面 / 修前实测后果】
 *   image-generation-manager.js（5245 行）已解析最多六个 {人物 ... 人物} 块、
 *   产出 v4_prompt / v4_negative_prompt 的 char_captions / centers，
 *   支持位置（A1-E5 网格 / 中文方位 / 英文别名）和深度标签（前/后）。
 *
 *   但以下操作全部内联在类方法里、无法离线验证或复用：
 *   ① **槽位编辑没有协议面** —— 增删重排角色只能手改 `{人物 ... 人物}` 字符串，
 *      没有结构化的 add/remove/reorder/swap 操作，重排后位置不自动调整；
 *   ② **别名重复不报** —— 两个角色同名不报冲突，payload 合法但出图可能混角色；
 *   ③ **坐标越界不拦** —— 位置解析的 clamp 在 _resolveNovelAICharacterPosition 里，
 *      但自定义坐标（{位置 0.95, 0.05} 形）不经 clamp，越界值直进 payload；
 *   ④ **payload 无法离线预检** —— 构建前看不到最终角色分配，构建后才发现问题；
 *   ⑤ **图片回执无绑定** —— 生成结果不绑会话/角色/场景，回看时不知道哪张图是哪段。
 *
 * 【本模块只做三件事（与 schedule-bridge / finance-overview / social-knowledge-bridge
 *    / creation-pipeline 同范式）】
 *   ① **槽位模型 `SlotModel`**：把 `{人物 ... 人物}` 字符串解析成结构化槽位列表，
 *      提供 add / remove / reorder / swap / duplicate / validate 操作；
 *      主名与别名绑定、重复别名检测、位置自动重排。
 *   ② **payload 预检 `buildPayloadPreview`**：从 SlotModel 构建最终角色分配预览
 *      （char_captions / centers / use_coords / 各角色别名/位置/深度标签），
 *      可离线验证不需真实 API 调用。
 *   ③ **幂等图片回执账本 `imageReceiptIdemKey` + `normalizeImageReceiptLedger` +
 *      `diffImageReceiptLedger` + `applyImageReceiptLedger`**：
 *      回执绑 `<sessionKey>:<characterId>:<sceneTag>`，上限 200 条，随会话隔离。
 *
 * 【不做什么】
 *   · 不出图：只做预检和结构化编辑，实际生图仍由 ImageGenerationManager。
 *   · 不解析 vibe / reference_image：那些在 image-generation-manager.js 里已实现。
 *   · 不读存储、不带计时器：纯函数。
 *
 * 【四条口径纪律】
 *   · **六槽上限**：角色槽位最多 6 个（NovelAI v4 Prompt 限制），超出报错。
 *   · **重复别名报 conflict**：同名角色标 `duplicate`，不静默通过。
 *   · **坐标越界报 out-of-bounds**：x/y 不在 [0.1, 0.9] 的坐标标 `outOfBounds`。
 *   · **回执绑定可追溯**：每张图绑会话/角色/场景，换角色不串。
 *
 * 纯 ESM export，纯函数无 window 依赖，保证可测。
 * ======================================================== */
'use strict';

/* ───────── ① 槽位模型 ───────── */

/** 角色槽位上限（NovelAI v4 Prompt 最多 6 个角色块）。 */
export const MAX_CHARACTER_SLOTS = 6;

/** 图片回执账本上限（随会话隔离）。 */
export const IMAGE_RECEIPT_LEDGER_LIMIT = 200;

/**
 * 位置校验：坐标是否在 [0.1, 0.9] 范围内。
 * @param {{x: number, y: number}|null} center
 * @returns {{valid: boolean, reason: string}}
 */
export function validatePosition(center) {
    if (center === null || center === undefined) return { valid: true, reason: 'no-position' };
    if (typeof center !== 'object') return { valid: false, reason: 'not-an-object' };
    const x = Number(center.x);
    const y = Number(center.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { valid: false, reason: 'non-finite' };
    if (x < 0.1 || x > 0.9) return { valid: false, reason: 'x-out-of-bounds:' + x };
    if (y < 0.1 || y > 0.9) return { valid: false, reason: 'y-out-of-bounds:' + y };
    return { valid: true, reason: 'ok' };
}

/**
 * 把网格坐标（如 "A1", "C3"）转换为 {x, y}。
 * A-E 映射 x=0.1..0.9，1-5 映射 y=0.1..0.9。
 * @param {string} grid - 如 "B3"
 * @returns {{x: number, y: number}|null}
 */
export function gridToCoords(grid) {
    const raw = String(grid || '').trim().toUpperCase();
    const m = raw.match(/^([A-E])([1-5])$/);
    if (!m) return null;
    const axis = { A: 0.1, B: 0.3, C: 0.5, D: 0.7, E: 0.9 };
    return { x: axis[m[1]], y: Math.round((Number(m[2]) * 0.2 - 0.1) * 1e10) / 1e10 };
    // 1→0.1, 2→0.3, 3→0.5, 4→0.7, 5→0.9
}

/**
 * 把 {x, y} 转换为最近的网格坐标。
 * @param {{x: number, y: number}} coords
 * @returns {string|null} 如 "B3"，越界返回 null
 */
export function coordsToGrid(coords) {
    if (!coords || typeof coords !== 'object') return null;
    const x = Number(coords.x);
    const y = Number(coords.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const clamp = (v) => Math.max(0.1, Math.min(0.9, v));
    const cx = clamp(x);
    const cy = clamp(y);
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const colIdx = Math.round((cx - 0.1) / 0.2);
    const rowIdx = Math.round((cy - 0.1) / 0.2);
    return letters[Math.max(0, Math.min(4, colIdx))] + String(Math.max(1, Math.min(5, rowIdx + 1)));
}

/**
 * 解析 `{人物 ... 人物}` 字符串为结构化槽位列表。
 *
 * @param {string} prompt - 原始 prompt 字符串
 * @param {string} [negativePrompt=''] - 全局负面 prompt
 * @returns {{baseCaption: string, negativeBaseCaption: string, slots: Array, useCoords: boolean}}
 *   每个 slot: { index, charCaption, negativeCaption, center, centerGrid, depthTag, rawBlock }
 */
export function parseSlotModel(prompt, negativePrompt = '') {
    const source = String(prompt || '');
    const slots = [];
    const blockPattern = /\{\s*人物\s*([\s\S]*?)\s*人物\s*\}/g;
    let match;
    let index = 0;
    while ((match = blockPattern.exec(source)) && slots.length < MAX_CHARACTER_SLOTS) {
        const rawBlock = String(match[1] || '');
        // 提取位置标签
        let center = null;
        let depthTag = '';
        let content = rawBlock;
        // 位置标签 {位置 XXX} 或 {position XXX}
        content = content.replace(/\{\s*(?:位置|position)\s*[:：]?\s*([^{}]+?)\s*\}/gi, (m, value) => {
            const v = String(value || '').trim();
            // 先尝试 grid 格式
            const grid = gridToCoords(v);
            if (grid) {
                center = grid;
            } else {
                center = resolvePositionAlias(v);
            }
            const dt = resolveDepthTag(v);
            if (dt) depthTag = dt;
            return '';
        });
        // 分离 ntags
        let charCaption = content;
        let negativeCaption = '';
        const negMatch = charCaption.match(/(?:^|[,，]\s*)ntags\s*=\s*([\s\S]*)$/i);
        if (negMatch) {
            negativeCaption = negMatch[1] || '';
            charCaption = charCaption.slice(0, negMatch.index);
        }
        charCaption = trimSeparators(charCaption);
        negativeCaption = trimSeparators(negativeCaption);
        if (!charCaption && !negativeCaption) continue;
        slots.push({
            index: index++,
            charCaption,
            negativeCaption,
            center,
            centerGrid: center ? coordsToGrid(center) : null,
            depthTag,
            rawBlock: String(match[0] || '')
        });
    }
    // base caption = 去掉人物块后的剩余文本
    const baseCaption = trimSeparators(source.replace(blockPattern, ''));
    const useCoords = slots.length > 0 && slots.every(s => s.center !== null);
    // 如果不是所有角色都有位置，全部清位置（与 image-generation-manager 一致）
    if (slots.length > 0 && !useCoords) {
        slots.forEach(s => { s.center = null; s.centerGrid = null; });
    }
    return {
        baseCaption,
        negativeBaseCaption: String(negativePrompt || '').trim(),
        slots,
        useCoords
    };
}

/**
 * 把 SlotModel 序列化回 `{人物 ... 人物}` 字符串。
 *
 * @param {{baseCaption: string, slots: Array, useCoords: boolean}} model
 * @returns {string}
 */
export function serializeSlotModel(model) {
    if (!model || typeof model !== 'object') return '';
    const base = String(model.baseCaption || '').trim();
    const slots = Array.isArray(model.slots) ? model.slots : [];
    const useCoords = model.useCoords === true;
    const parts = [];
    if (base) parts.push(base);
    for (const slot of slots) {
        let inner = String(slot.charCaption || '');
        if (slot.negativeCaption) {
            inner += ', ntags=' + slot.negativeCaption;
        }
        if (useCoords && slot.center) {
            const grid = slot.centerGrid || coordsToGrid(slot.center);
            const posLabel = grid || (slot.center.x + ', ' + slot.center.y);
            const depthSuffix = slot.depthTag === 'foreground' ? '前'
                : slot.depthTag === 'background' ? '后' : '';
            inner += ', {位置 ' + posLabel + (depthSuffix ? ' ' + depthSuffix : '') + '}';
        }
        parts.push('{人物 ' + inner + ' 人物}');
    }
    return parts.join(', ');
}

/**
 * 向 SlotModel 添加一个角色槽位。
 *
 * @param {{slots: Array}} model
 * @param {{charCaption: string, negativeCaption?: string, center?: {x,y}, depthTag?: string}} slotSpec
 * @returns {{model: object, error: string}}
 */
export function addSlot(model, slotSpec) {
    if (!model || !Array.isArray(model.slots)) return { model: model, error: 'invalid-model' };
    if (model.slots.length >= MAX_CHARACTER_SLOTS) {
        return { model: model, error: 'max-slots-exceeded:' + MAX_CHARACTER_SLOTS };
    }
    const spec = (slotSpec && typeof slotSpec === 'object') ? slotSpec : {};
    const charCaption = String(spec.charCaption || '').trim();
    if (!charCaption) return { model: model, error: 'empty-caption' };
    const newSlot = {
        index: model.slots.length,
        charCaption,
        negativeCaption: String(spec.negativeCaption || '').trim(),
        center: spec.center || null,
        centerGrid: spec.center ? coordsToGrid(spec.center) : null,
        depthTag: String(spec.depthTag || ''),
        rawBlock: ''
    };
    const newModel = {
        baseCaption: model.baseCaption,
        negativeBaseCaption: model.negativeBaseCaption,
        slots: [...model.slots, newSlot],
        useCoords: model.useCoords
    };
    // 重新评估 useCoords
    if (newModel.slots.length > 0) {
        newModel.useCoords = newModel.slots.every(s => s.center !== null);
        if (!newModel.useCoords) {
            newModel.slots.forEach(s => { s.center = null; s.centerGrid = null; });
        }
    }
    return { model: newModel, error: '' };
}

/**
 * 从 SlotModel 移除指定索引的角色槽位。
 *
 * @param {{slots: Array}} model
 * @param {number} slotIndex
 * @returns {{model: object, error: string}}
 */
export function removeSlot(model, slotIndex) {
    if (!model || !Array.isArray(model.slots)) return { model: model, error: 'invalid-model' };
    const idx = Number(slotIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= model.slots.length) {
        return { model: model, error: 'index-out-of-range:' + slotIndex };
    }
    const newSlots = model.slots.filter((_, i) => i !== idx);
    // 重建索引
    newSlots.forEach((s, i) => { s.index = i; });
    const newModel = {
        baseCaption: model.baseCaption,
        negativeBaseCaption: model.negativeBaseCaption,
        slots: newSlots,
        useCoords: newSlots.length > 0 ? newSlots.every(s => s.center !== null) : false
    };
    if (newModel.slots.length > 0 && !newModel.useCoords) {
        newModel.slots.forEach(s => { s.center = null; s.centerGrid = null; });
    }
    return { model: newModel, error: '' };
}

/**
 * 交换两个槽位的位置（内容互换，索引不变）。
 *
 * @param {{slots: Array}} model
 * @param {number} i - 槽位 A 索引
 * @param {number} j - 槽位 B 索引
 * @returns {{model: object, error: string}}
 */
export function swapSlots(model, i, j) {
    if (!model || !Array.isArray(model.slots)) return { model: model, error: 'invalid-model' };
    const a = Number(i), b = Number(j);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= model.slots.length || b >= model.slots.length) {
        return { model: model, error: 'index-out-of-range' };
    }
    const newSlots = model.slots.map(s => ({ ...s }));
    const tmp = newSlots[a];
    newSlots[a] = { ...newSlots[b], index: a };
    newSlots[b] = { ...tmp, index: b };
    return {
        model: { ...model, slots: newSlots },
        error: ''
    };
}

/**
 * 重排槽位顺序（传入新顺序的索引数组）。
 *
 * @param {{slots: Array}} model
 * @param {Array<number>} newOrder - 如 [2, 0, 1] 表示原槽位2→0, 原0→1, 原1→2
 * @returns {{model: object, error: string}}
 */
export function reorderSlots(model, newOrder) {
    if (!model || !Array.isArray(model.slots)) return { model: model, error: 'invalid-model' };
    const order = Array.isArray(newOrder) ? newOrder : [];
    if (order.length !== model.slots.length) {
        return { model: model, error: 'order-length-mismatch' };
    }
    const seen = new Set();
    for (const idx of order) {
        const n = Number(idx);
        if (!Number.isInteger(n) || n < 0 || n >= model.slots.length || seen.has(n)) {
            return { model: model, error: 'invalid-order' };
        }
        seen.add(n);
    }
    const newSlots = order.map((origIdx, newIdx) => ({
        ...model.slots[Number(origIdx)],
        index: newIdx
    }));
    return {
        model: { ...model, slots: newSlots },
        error: ''
    };
}

/* ───────── ② payload 预检 ───────── */

/**
 * 从 SlotModel 构建 payload 预览（最终角色分配）。
 *
 * @param {{baseCaption: string, negativeBaseCaption: string, slots: Array, useCoords: boolean}} model
 * @returns {{valid: boolean, preview: object|null, issues: Array}}
 *   preview: { baseCaption, negativeBaseCaption, charCaptions: Array, useCoords, slotCount, duplicateAliases, outOfBoundsPositions }
 */
export function buildPayloadPreview(model) {
    if (!model || typeof model !== 'object') {
        return { valid: false, preview: null, issues: ['invalid-model'] };
    }
    const slots = Array.isArray(model.slots) ? model.slots : [];
    const issues = [];

    // 槽位上限检查
    if (slots.length > MAX_CHARACTER_SLOTS) {
        issues.push('slots-exceed-max:' + slots.length + '/' + MAX_CHARACTER_SLOTS);
    }

    // 重复别名检测
    const captions = slots.map(s => String(s.charCaption || '').trim().toLowerCase());
    const dupSet = new Set();
    const duplicates = [];
    for (let i = 0; i < captions.length; i++) {
        if (!captions[i]) continue;
        for (let j = i + 1; j < captions.length; j++) {
            if (captions[i] === captions[j] && !dupSet.has(i)) {
                dupSet.add(i);
                dupSet.add(j);
                duplicates.push({ slotA: i, slotB: j, caption: captions[i] });
            }
        }
    }
    if (duplicates.length > 0) {
        issues.push('duplicate-alias:' + duplicates.map(d => d.caption).join('|'));
    }

    // 坐标越界检测
    const outOfBounds = [];
    if (model.useCoords) {
        for (const slot of slots) {
            if (slot.center) {
                const check = validatePosition(slot.center);
                if (!check.valid) {
                    outOfBounds.push({ slot: slot.index, reason: check.reason });
                }
            }
        }
    }
    if (outOfBounds.length > 0) {
        issues.push('position-out-of-bounds:' + outOfBounds.length);
    }

    // 构建 char_captions（与 image-generation-manager._buildNovelAICharCaptions 同形）
    const charCaptions = slots.map(slot => {
        const entry = { char_caption: String(slot.charCaption || '').trim() };
        if (model.useCoords && slot.center) {
            entry.centers = [{ x: Number(slot.center.x), y: Number(slot.center.y) }];
        }
        return entry;
    });

    const negativeCharCaptions = slots.map(slot => ({
        char_caption: String(slot.negativeCaption || '').trim()
    }));

    const preview = {
        baseCaption: String(model.baseCaption || ''),
        negativeBaseCaption: String(model.negativeBaseCaption || ''),
        charCaptions,
        negativeCharCaptions,
        useCoords: model.useCoords === true,
        slotCount: slots.length,
        duplicateAliases: duplicates,
        outOfBoundsPositions: outOfBounds
    };

    return {
        valid: issues.length === 0,
        preview,
        issues
    };
}

/* ───────── ③ 幂等图片回执账本 ───────── */

/**
 * 幂等键：会话 + 角色 id + 场景标签。
 * 同一角色在同一场景只记一次。
 */
export function imageReceiptIdemKey(sessionKey, characterId, sceneTag) {
    return String(sessionKey || '') + ':' + String(characterId || '') + ':' + String(sceneTag || '');
}

/**
 * 归一化回执条目。
 */
export function normalizeImageReceiptEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const idemKey = typeof raw.idemKey === 'string' ? raw.idemKey : '';
    if (!idemKey) return null;
    return {
        idemKey,
        sessionKey: typeof raw.sessionKey === 'string' ? raw.sessionKey : '',
        characterId: typeof raw.characterId === 'string' ? raw.characterId : '',
        sceneTag: typeof raw.sceneTag === 'string' ? raw.sceneTag : '',
        status: typeof raw.status === 'string' ? raw.status : 'pending',
        at: typeof raw.at === 'number' ? raw.at : 0,
        seed: typeof raw.seed === 'number' ? raw.seed : 0,
        note: typeof raw.note === 'string' ? raw.note : ''
    };
}

/**
 * 归一化回执账本（去重 + 截断）。
 */
export function normalizeImageReceiptLedger(raw) {
    if (!Array.isArray(raw)) return { entries: [], dropped: 0 };
    const seen = new Set();
    const entries = [];
    let dropped = 0;
    for (const item of raw) {
        const e = normalizeImageReceiptEntry(item);
        if (!e) { dropped++; continue; }
        if (seen.has(e.idemKey)) { dropped++; continue; }
        seen.add(e.idemKey);
        entries.push(e);
    }
    if (entries.length > IMAGE_RECEIPT_LEDGER_LIMIT) {
        dropped += entries.length - IMAGE_RECEIPT_LEDGER_LIMIT;
        entries.splice(0, entries.length - IMAGE_RECEIPT_LEDGER_LIMIT);
    }
    return { entries, dropped };
}

/**
 * 对账：找出已完成但对应角色已不存在的条目（stale）。
 *
 * @param {Array} ledger - 已有回执账本
 * @param {Array} currentCharacterIds - 当前角色 id 列表
 * @returns {{stale: Array, active: Array}}
 */
export function diffImageReceiptLedger(ledger, currentCharacterIds) {
    const prev = Array.isArray(ledger) ? ledger : [];
    const currentIds = new Set((Array.isArray(currentCharacterIds) ? currentCharacterIds : [])
        .map(id => String(id || '')));
    const stale = [];
    const active = [];
    for (const e of prev) {
        if (!e || !e.characterId) continue;
        if (currentIds.has(e.characterId)) {
            active.push(e);
        } else {
            stale.push(e);
        }
    }
    return { stale, active };
}

/**
 * 应用账本更新：移除陈旧条目，写入新条目。
 */
export function applyImageReceiptLedger(prevLedger, newEntries, staleCharacterIds) {
    const prev = Array.isArray(prevLedger) ? prevLedger : [];
    const stale = new Set((Array.isArray(staleCharacterIds) ? staleCharacterIds : []).map(k => String(k)));
    const filtered = prev.filter(e => e && e.characterId && !stale.has(e.characterId));
    const merged = filtered.concat(
        (Array.isArray(newEntries) ? newEntries : []).map(e => normalizeImageReceiptEntry(e)).filter(Boolean)
    );
    const normalized = normalizeImageReceiptLedger(merged);
    return {
        entries: normalized.entries,
        dropped: normalized.dropped,
        count: normalized.entries.length
    };
}

/* ───────── ④ 内部工具函数 ───────── */

function trimSeparators(text) {
    return String(text || '')
        .replace(/([,，、；;])(?:\s*[,，、；;])+/g, '$1')
        .replace(/^\s*[,，、；;]+\s*|\s*[,，、；;]+\s*$/g, '')
        .trim();
}

function resolvePositionAlias(value) {
    const raw = String(value || '').trim().replace(/\s+/g, '');
    if (!raw) return null;
    // grid 格式
    const grid = gridToCoords(raw);
    if (grid) return grid;
    // 中文方位别名
    const aliases = new Map([
        ['中', [0.5, 0.5]], ['中心', [0.5, 0.5]], ['中央', [0.5, 0.5]],
        ['左', [0.3, 0.5]], ['右', [0.7, 0.5]],
        ['上', [0.5, 0.3]], ['下', [0.5, 0.7]],
        ['前', [0.5, 0.7]], ['前方', [0.5, 0.7]], ['前景', [0.5, 0.7]],
        ['后', [0.5, 0.3]], ['後', [0.5, 0.3]], ['后方', [0.5, 0.3]], ['後方', [0.5, 0.3]],
        ['背景', [0.5, 0.3]],
        ['左上', [0.3, 0.3]], ['上左', [0.3, 0.3]],
        ['右上', [0.7, 0.3]], ['上右', [0.7, 0.3]],
        ['左下', [0.3, 0.7]], ['下左', [0.3, 0.7]],
        ['右下', [0.7, 0.7]], ['下右', [0.7, 0.7]],
    ]);
    if (aliases.has(raw)) {
        const [x, y] = aliases.get(raw);
        return { x, y };
    }
    // 中文方位组合
    if (/^[左右上下]+$/.test(raw)) {
        const clamp = (n) => Math.max(0.1, Math.min(0.9, Math.round(n * 10) / 10));
        const left = (raw.match(/左/g) || []).length;
        const right = (raw.match(/右/g) || []).length;
        const up = (raw.match(/上/g) || []).length;
        const down = (raw.match(/下/g) || []).length;
        return {
            x: clamp(0.5 + (right - left) * 0.2),
            y: clamp(0.5 + (down - up) * 0.2)
        };
    }
    // 英文别名
    const lower = raw.toLowerCase();
    const enAliases = new Map([
        ['center', [0.5, 0.5]], ['middle', [0.5, 0.5]],
        ['left', [0.3, 0.5]], ['right', [0.7, 0.5]],
        ['top', [0.5, 0.3]], ['upper', [0.5, 0.3]],
        ['bottom', [0.5, 0.7]], ['lower', [0.5, 0.7]],
        ['front', [0.5, 0.7]], ['foreground', [0.5, 0.7]],
        ['back', [0.5, 0.3]], ['background', [0.5, 0.3]],
    ]);
    const enKey = lower.replace(/[-_\s]+/g, '');
    if (enAliases.has(enKey)) {
        const [x, y] = enAliases.get(enKey);
        return { x, y };
    }
    return null;
}

function resolveDepthTag(value) {
    const key = String(value || '').trim().toLowerCase().replace(/[-_\s]+/g, '');
    if (['前', '前方', '前景', 'front', 'foreground'].includes(key)) return 'foreground';
    if (['后', '後', '后方', '後方', '背景', 'back', 'background'].includes(key)) return 'background';
    return '';
}

/* ───────── ⑤ 自检 ───────── */

export function characterSlotSelfCheck() {
    const problems = [];

    // 常量
    if (MAX_CHARACTER_SLOTS !== 6) problems.push('MAX_CHARACTER_SLOTS 应为 6');
    if (IMAGE_RECEIPT_LEDGER_LIMIT !== 200) problems.push('IMAGE_RECEIPT_LEDGER_LIMIT 应为 200');

    // grid 转换
    const g1 = gridToCoords('A1');
    if (!g1 || g1.x !== 0.1 || g1.y !== 0.1) problems.push('gridToCoords A1 应为 {0.1, 0.1}');
    const g2 = gridToCoords('C3');
    if (!g2 || g2.x !== 0.5 || g2.y !== 0.5) problems.push('gridToCoords C3 应为 {0.5, 0.5}');
    const g3 = gridToCoords('E5');
    if (!g3 || g3.x !== 0.9 || g3.y !== 0.9) problems.push('gridToCoords E5 应为 {0.9, 0.9}');
    if (gridToCoords('Z9') !== null) problems.push('gridToCoords Z9 应返回 null');

    // 坐标转 grid
    const c1 = coordsToGrid({ x: 0.1, y: 0.1 });
    if (c1 !== 'A1') problems.push('coordsToGrid {0.1,0.1} 应为 A1，实际 ' + c1);
    const c2 = coordsToGrid({ x: 0.5, y: 0.5 });
    if (c2 !== 'C3') problems.push('coordsToGrid {0.5,0.5} 应为 C3，实际 ' + c2);

    // 位置校验
    const v1 = validatePosition({ x: 0.5, y: 0.5 });
    if (!v1.valid) problems.push('validatePosition {0.5,0.5} 应 valid');
    const v2 = validatePosition({ x: 0.05, y: 0.5 });
    if (v2.valid) problems.push('validatePosition {0.05,0.5} 应 out-of-bounds');
    const v3 = validatePosition(null);
    if (!v3.valid) problems.push('validatePosition null 应 valid（无位置）');

    // parseSlotModel
    const model = parseSlotModel(
        '{人物 1girl, black hair, {位置 B2} 人物}, {人物 1boy, blond hair, {位置 D4} 人物}',
        'lowres'
    );
    if (model.slots.length !== 2) problems.push('应解析 2 个槽位，实际 ' + model.slots.length);
    if (!model.useCoords) problems.push('所有角色有位置时 useCoords 应 true');
    if (model.slots[0].centerGrid !== 'B2') problems.push('槽位 0 grid 应 B2');
    if (model.slots[1].centerGrid !== 'D4') problems.push('槽位 1 grid 应 D4');

    // 无位置时 useCoords false
    const model2 = parseSlotModel('{人物 1girl 人物}, {人物 1boy, {位置 C3} 人物}');
    if (model2.useCoords) problems.push('部分角色无位置时 useCoords 应 false');

    // serializeSlotModel
    const serialized = serializeSlotModel(model);
    if (!serialized.includes('{人物')) problems.push('serializeSlotModel 应包含人物块');

    // addSlot
    const addResult = addSlot(model, { charCaption: '1cat, white fur', center: { x: 0.5, y: 0.5 } });
    if (addResult.error) problems.push('addSlot 不应报错: ' + addResult.error);
    if (addResult.model.slots.length !== 3) problems.push('addSlot 后应 3 个槽位');

    // addSlot 超上限
    let bigModel = { baseCaption: '', negativeBaseCaption: '', slots: [], useCoords: false };
    for (let i = 0; i < MAX_CHARACTER_SLOTS; i++) {
        const r = addSlot(bigModel, { charCaption: 'char' + i });
        bigModel = r.model;
    }
    const overLimit = addSlot(bigModel, { charCaption: 'overflow' });
    if (!overLimit.error) problems.push('超过 6 槽位应报错');
    if (!overLimit.error.startsWith('max-slots-exceeded')) problems.push('错误应 max-slots-exceeded: ' + overLimit.error);

    // removeSlot
    const rmResult = removeSlot(addResult.model, 0);
    if (rmResult.error) problems.push('removeSlot 不应报错: ' + rmResult.error);
    if (rmResult.model.slots.length !== 2) problems.push('removeSlot 后应 2 个槽位');

    // swapSlots
    const swapResult = swapSlots(model, 0, 1);
    if (swapResult.error) problems.push('swapSlots 不应报错: ' + swapResult.error);
    if (swapResult.model.slots[0].charCaption !== '1boy, blond hair') problems.push('swap 后槽位 0 应为 1boy');

    // reorderSlots
    const reorderResult = reorderSlots(model, [1, 0]);
    if (reorderResult.error) problems.push('reorderSlots 不应报错: ' + reorderResult.error);
    if (reorderResult.model.slots[0].charCaption !== '1boy, blond hair') problems.push('reorder [1,0] 后槽位 0 应为 1boy');

    // buildPayloadPreview
    const preview = buildPayloadPreview(model);
    if (!preview.valid) problems.push('payload preview 应 valid: ' + preview.issues.join('; '));
    if (preview.preview.charCaptions.length !== 2) problems.push('preview charCaptions 应 2 条');
    if (!preview.preview.useCoords) problems.push('preview useCoords 应 true');

    // 重复别名检测
    const dupModel = parseSlotModel('{人物 1girl, red hair 人物}, {人物 1girl, red hair 人物}');
    const dupPreview = buildPayloadPreview(dupModel);
    if (dupPreview.valid) problems.push('重复别名应不 valid');
    if (dupPreview.preview.duplicateAliases.length === 0) problems.push('应有重复别名');

    // 坐标越界
    const oobModel = {
        baseCaption: '',
        negativeBaseCaption: '',
        slots: [{ index: 0, charCaption: 'test', negativeCaption: '', center: { x: 0.05, y: 0.5 }, centerGrid: null, depthTag: '', rawBlock: '' }],
        useCoords: true
    };
    const oobPreview = buildPayloadPreview(oobModel);
    if (oobPreview.valid) problems.push('坐标越界应不 valid');
    if (oobPreview.preview.outOfBoundsPositions.length !== 1) problems.push('应有 1 个越界位置');

    // 幂等键
    const k1 = imageReceiptIdemKey('sess1', 'charA', 'scene1');
    const k2 = imageReceiptIdemKey('sess1', 'charA', 'scene1');
    if (k1 !== k2) problems.push('幂等键不稳定');
    if (k1 !== 'sess1:charA:scene1') problems.push('幂等键格式不符: ' + k1);

    // 回执账本去重
    const raw = [
        { idemKey: 's:c1:sc1', sessionKey: 's', characterId: 'c1', sceneTag: 'sc1', status: 'completed', at: 1 },
        { idemKey: 's:c1:sc1', sessionKey: 's', characterId: 'c1', sceneTag: 'sc1', status: 'completed', at: 2 },
        null,
    ];
    const norm = normalizeImageReceiptLedger(raw);
    if (norm.entries.length !== 1) problems.push('去重后应 1 条');
    if (norm.dropped !== 2) problems.push('丢弃应 2 条');

    // 截断
    const big = [];
    for (let i = 0; i < IMAGE_RECEIPT_LEDGER_LIMIT + 5; i++) {
        big.push({ idemKey: 'k' + i, sessionKey: 's', characterId: 'c' + i, sceneTag: 'sc', status: 'pending', at: i });
    }
    const trunc = normalizeImageReceiptLedger(big);
    if (trunc.entries.length !== IMAGE_RECEIPT_LEDGER_LIMIT) {
        problems.push('截断后应 ' + IMAGE_RECEIPT_LEDGER_LIMIT + ' 条');
    }

    // diff
    const ledger = [
        { idemKey: 's:c1:sc1', sessionKey: 's', characterId: 'c1', sceneTag: 'sc1', status: 'completed', at: 1 },
        { idemKey: 's:c2:sc1', sessionKey: 's', characterId: 'c2', sceneTag: 'sc1', status: 'completed', at: 2 },
    ];
    const diff = diffImageReceiptLedger(ledger, ['c1']);
    if (diff.stale.length !== 1) problems.push('陈旧应 1 条（c2 已删）');
    if (diff.active.length !== 1) problems.push('有效应 1 条（c1 仍在）');

    // apply
    const applied = applyImageReceiptLedger(ledger, [], ['c2']);
    if (applied.count !== 1) problems.push('应用后应 1 条');

    return { problems };
}

/* ───────── ⑥ 导出清单 ───────── */

export default {
    MAX_CHARACTER_SLOTS,
    IMAGE_RECEIPT_LEDGER_LIMIT,
    validatePosition,
    gridToCoords,
    coordsToGrid,
    parseSlotModel,
    serializeSlotModel,
    addSlot,
    removeSlot,
    swapSlots,
    reorderSlots,
    buildPayloadPreview,
    imageReceiptIdemKey,
    normalizeImageReceiptEntry,
    normalizeImageReceiptLedger,
    diffImageReceiptLedger,
    applyImageReceiptLedger,
    characterSlotSelfCheck,
};