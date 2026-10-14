/* ========================================================
 * call-attribution.js — [v4.11.0] 通话人工认领账（第三期 R3-O1 收口）
 * --------------------------------------------------------
 * 动机：通话记录此前只存 caller 姓名，同名联系人无法自动归属
 *   （buildContactInsight 对多候选如实进 unattributedCalls，不猜）。
 *   R3-O1 要求「旧记录可人工认领，撤销认领后恢复未归属」——
 *   这需要一个**会话隔离的认领账**：{ 通话姓名: 联系人ID }。
 *
 * ★ 三条纪律（与 contact-insight.js 同族）：
 *   ① **不猜**：认领必须是显式动作；空名 / 空 ID 一律拒绝，
 *      绝不静默成功（认领错人比不认领更伤）。
 *   ② **可撤销**：撤销即删键；没认领过时如实返回 false，不报错不补写。
 *   ③ **不抛**：读写全部 try 包住；读不到返回空对象——
 *      「还没有认领」是合法态，不是故障。
 *
 * ★ 键归属：`phone_call_attribution` 命中 config/storage.js 的
 *   `/^phone_call_/` ⇒ 会话隔离（chatMetadata）。认领是「这个会话里
 *   这个人是谁」的判断，跨会话/跨角色不得串味。
 *
 * ★ 形状：认领账**只认**归一后的纯对象 `{ 姓名键: 联系人ID }`。
 *   历史误存 / 手改存储产生的畸形值在读取边界被 normalize 丢弃。
 * ============================================================ */

/** 键名只在读写点以字面量出现（keys 门的 K1 使用点）；不导出常量，防死导出。 */
const KEY = 'phone_call_attribution';

/**
 * 归一认领账：只认 `{ 姓名键: 联系人ID }` 纯对象。
 * 畸形键值（空名 / 空 ID / 非字符串）一律丢弃——**不猜、不补**。
 */
export function normalizeCallAttribution(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const name of Object.keys(raw)) {
        const safeName = String(name || '').trim();
        const safeId = String(raw[name] || '').trim();
        if (!safeName || !safeId) continue;
        out[safeName] = safeId;
    }
    return out;
}

function readMap(storage) {
    try {
        const raw = storage ? storage.get(KEY, null) : null;
        const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
        return normalizeCallAttribution(obj);
    } catch (_e) { return {}; }
}

function writeMap(storage, map) {
    try {
        if (storage) storage.set(KEY, JSON.stringify(map));
        return true;
    } catch (_e) { return false; }
}

/**
 * 读认领账（永不抛）。返回归一后的 `{ 姓名: 联系人ID }`；
 * 读不到返回 `{}` ——「没有认领过」与「读不到」在认领这件事上同处置，
 * 都等于「没有任何显式认领」，不会产生错归属。
 */
export function readCallAttribution(storage) {
    return readMap(storage);
}

/**
 * 认领：把某个通话姓名认领给某个联系人 ID。
 * 空名 / 空 ID **如实拒绝**（返回 false，什么都不写）——
 * 认领是显式动作，「调用错了但静默成功」会让账里出现幽灵键。
 */
export function claimCall(storage, name, contactId) {
    const safeName = String(name || '').trim();
    const safeId = String(contactId || '').trim();
    if (!safeName || !safeId) return false;
    const map = readMap(storage);
    map[safeName] = safeId;
    return writeMap(storage, map);
}

/**
 * 撤销认领：删掉这个姓名的认领键。
 * 没认领过时返回 false（幂等且如实）；写入失败也如实返回 false。
 */
export function unclaimCall(storage, name) {
    const safeName = String(name || '').trim();
    if (!safeName) return false;
    const map = readMap(storage);
    if (!(safeName in map)) return false;
    delete map[safeName];
    return writeMap(storage, map);
}
