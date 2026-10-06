// tests/system-v3370.test.mjs — 白盒音效盒 [v3.37.0]
//
//   本版接的是素材缝合路线图 **第 3 层第一件：白盒音效盒**。源侧是 SullyOS 的
//   `assets/WhiteboxSoundEditor-CGLDgpa7.js`（41208 字节 / 37105 字符）+
//   `ttsRouter-CSfthnMI.js` / `voicePlayback-CgQpyeBv.js` / `SARSpeechSwitch-BZWisYgX.js` 三件套。
//
//   ★ 源是什么：「白盒」二字指的就是这件事 —— 六条内置音效**不是 mp3**，
//     而是可读、可改、可分享的**合成配方**（每条是若干 oscillator 音符：
//     频率 / 起点 / 时长 / 波形 / 增益），播放时由 WebAudio 现合成。
//     播放器 `k_`：createGain 做主音量 + 每音符一个 createOscillator + 一个 createGain，
//     linearRampToValueAtTime 8ms 淡入、exponentialRampToValueAtTime 到 1e-4 淡出。
//     分享码 `AP`：`SULLYSND1:` + btoa(unescape(encodeURIComponent(JSON)))，只带 `{src,volume}`。
//     CSS 内嵌绑定：一行 `@sully-sound` 注释挂在白框 CSS 顶上（读回走正则 `Ec`）。
//
//   ★ 取五块 / 四处不缝 / 三条偏离（逐条写在 soundkit-data.js 文件头，此处只留判据面）：
//     取：① 合成配方真源表 ② 播放器机制（8ms 淡入 + 指数淡出）③ 分享码
//         ④ 语音三件套的**机制**（自动播放受限的人话化 / 原台词与污染台词二态）
//         ⑤ CSS 绑定注释的编解码。
//     不缝：① 源 `ttsRouter` 直连 fishaudio / elevenlabs / minimax 三家（自己拼请求、
//             按语言选模型、粤语还做模型前置校验）—— 本件**零网络调用**，合成只走本机
//             WebAudio（本仓语音出口的唯一仲裁者是 apps/settings 的语音设置面，本件不与它争）；
//           ② 源把提示音写回宿主对象、把绑定注释写进宿主白框 —— 本件零宿主读零宿主写；
//           ③ 源直接读全局音频元素与角色卡的 `voiceProfile` 字段 —— 本件自带配方表，零跨 App 读；
//           ④ 源允许 https 音频直链与 ≤200KB 音频上传（转 data URL）—— 本件只收配方，
//             零 URL、零 base64 载荷、零上传。
//     偏离：四态互不同形（源在 `(!sound || !sound.src || sound.src === 'none')` 时**静默 return**，
//           于是「没绑 / 绑了空 / 绑了 none / 绑了不存在的 key」在用户那边**都是「点了没响」**）/
//           配方提成可登记可导出且过校验门、坏音符**如实计数**（源拿 `o.freq` 就 createOscillator，
//           坏值一律**抛在播放期**，而播放期抛异常在宿主里常被吞掉）/ 音量收成一次取值门
//           （源在**每一处**调用点各写一遍 `Math.min(1, Math.max(0, Number.isFinite(t) ? t : .6))`，
//           而 `Number('')` 与 `Number(null)` 都是 0 ⇒「没给」被读成「静音」）。
//
//   ★ 本版抓到**三处真缺陷**（都不是自述，是写的时候当场按纪律自查出来的，同一族）：
//     ① **数据层 `soundkitReadings` 手写四态计数表**：首版写的是
//        `const counts = { builtin: 0, custom: 0, silent: 0, missing: 0 };`
//        —— 这是第二个真源（真源表是 `SOUNDKIT_STATES`）。数据层多一态时，
//        手写的那份表**静默少一个格**，读数面上永远看不到新状态，而没有任何东西会报错。
//        修法 = 键面从 `SOUNDKIT_STATES` 算（计算键）。
//     ② **视图 `STATE_TONE` 手写四态键面**（同族，本仓 J7 形态）：
//        视图手写了一遍 `{ builtin: 'ok', custom: 'info', silent: 'mute', missing: 'warn' }`，
//        数据层多一态时视图**静默落兜底色**，四态在用户眼里又塌回一种观感 ——
//        而这恰恰是本件最要紧的一条（四态不许同形）。
//        修法 = 严重度由数据层给（`SOUNDKIT_STATES` 每项带 `severity`），视图只把 severity 映射成色相。
//     ③ **视图 `_waveSVG` 手写频率上下界**（`Math.log(20)` / `Math.log(20000)`）：
//        纵轴两端本是数据层的上限（`SOUNDKIT_FREQ_MIN` / `SOUNDKIT_FREQ_MAX`），
//        视图再写一遍就是第二个真源 —— 上限一改，波形图的纵轴**静默失真**
//        （图还画得出来、不报错，只是所有柱子都挤到同一段）。
//        修法 = 纵轴从 `app.catalogs().limits` 取。
//     三处同族（「同一份读数在两处各写一遍」），故本套件把**手写键不许回潮**单列成 E 面。
//
//   ★ 另修一处**判据自身**的口径错：K4 首版用 `\b24\b` / `\b60\b` 裸查「视图有没有手写上限」，
//     而视图里有 320×64 的画布尺寸、`Math.max(3, …)` 的柱宽下限、`W - 6` 的算式 ——
//     裸查会把**画法**误判成**上限**（判据过宽就是判据写歪）。改成查上限字面量的完整形态。
//
//   本套件守的静默失效形态（都不报错、不崩溃，只是结果不对）：
//     A 内核：六条内置配方与源逐条一致 / 四态互不同形（unbound 与 unknown_key 分开）/
//       坏音符如实计数与分因 / 音量「没给」与「给了 0」不许塌成一态 / 分享码只带配方；
//     B 播放计划：静音与没绑**不许报成「播完了」** / 计划是纯函数（不碰 AudioContext）/
//       音量 0 与「没绑」不同形 / totalMs 是最后一条停下的时刻；
//     C 接线：三条键随会话隔离 / 六处接线落点到位 / 重绑表在册 / 视图调用面闭合；
//     D 通道：不碰模型（源三家 TTS 商）/ 不碰宿主对象 / 不跨 App 读 / 不收外链 / 不产二进制；
//     E 活性：零消费导出必须真被产品消费 / 手写键不许回潮（本版两处缺陷的守卫）；
//     F 视图面闭合：视图调用的 App 方法在 App 上全都在（差集必须为空）；
//     G 视图契约：四态分开画 / 波形预览不依赖 AudioContext / 转义走拼装形；
//     H 键归属：三条会话键登记 scope=chat / 宽匹配族在场 / 三条键真被产品消费；
//     I 负控制：真源码破坏 → 加载破坏副本 → 在同款真判据上必须转红；
//     J 判据工具自证：剥注释器两向 / 破坏表锚点在场（恰 1 次）且替换保真 / 替换后仍是合法 JS；
//     K 单一真源：四态表 / 坏音符原因表 / 波形表 / 槽位表都不许手写键；
//     L 版本锚（下限形 + 守自己那一版）。
//
//   负控制纪律（本仓统一口径，v3250 起）：真源码破坏（锚点恰中 1 次）→ 加载破坏副本 →
//   在副本上重跑**同款真判据**。判据函数一律不解析副本的 import.meta.url（副本在 /tmp 下，
//   那条路径必然解析不到 —— 会造出与破坏无关的假红）；副本按**真目录结构**建
//   （`<tmp>/apps/soundkit/<file>.js` + `<tmp>/config/num-gate.js` 等价桩），否则相对 import
//   会解析错位置、首跑即假红；App 侧的编排断言只做**结构面**（不加载副本）。
//   ★ 判据纯度：负控制层里的锚点字面量**只准声明一次**（在 DAMAGE 表里），
//     判据函数不得引用破坏串（否则破坏一改，判据跟着变 ⇒ 假绿三形之三）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withRouteSurface, routeSurface, readRepoTable, LAZY_ROUTE_TABLE_REL } from './_lazy_routes.mjs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as DAT from '../apps/soundkit/soundkit-data.js';
import { SoundkitApp } from '../apps/soundkit/soundkit-app.js';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SK_DATA = 'apps/soundkit/soundkit-data.js';
const SK_APP = 'apps/soundkit/soundkit-app.js';
const SK_VIEW = 'apps/soundkit/soundkit-view.js';
const SK_CSS = 'apps/soundkit/soundkit.css';
const APPS = 'config/apps.js';
const STORAGE = 'config/storage.js';
const INDEX = 'index.js';
const KEYS = 'scripts/keys-audit.mjs';
const V255 = 'tests/system-v255.test.mjs';
const _readRaw = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const read = withRouteSurface(_readRaw, ROOT);
/** 剥注释（字符状态机，与 v3300 / v3310 / v3320 / v3330 / v3340 / v3350 / v3360 同款）。
 *  ★ 为什么必须有：本仓纪律「**注释里的提及不算消费**」。本件的文件头与源码注释逐条写明了
 *    「源里有什么、本仓为什么不能有」——那些词（`callChatAPI`、`ttsRouter`、`data:image`…）是
 *    **说明**不是**消费**。
 *  ★ 本剥器**不解析正则字面量**（本仓各版同款）：被审代码里一旦出现**裸的引号或反引号**，
 *    剥器会把正则正文当成字符串/模板串的起头。故 J1 用**尾随哨兵**逐文件实测「剥器能复位」。 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let state = 'code';
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') { state = c; out += c; i += 1; continue; }
            out += c; i += 1; continue;
        }
        if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
        if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 2; continue; } i += 1; continue; }
        if (c === '\\') { out += c + (d || ''); i += 2; continue; }
        out += c; i += 1;
        if (c === state) state = 'code';
    }
    return out;
}
/** 内存假存储：`key -> 字符串`。视图/App 只经 `storage.get/set`，与真件同形。 */
function memStorage(seed = {}) {
    const box = new Map(Object.entries(seed));
    return {
        get: (k) => (box.has(k) ? box.get(k) : null),
        set: (k, v) => { box.set(k, v); return true; },
        _box: box,
    };
}
/** 换会话的存储（真件里由 `config/storage.js` 的 `/^soundkit_/` 前缀拼 chatId 实现）。
 *  ★ 前缀必须与本件一致（`soundkit_`）—— 抄别版的前缀会把「换会话后读到别人数据」
 *    这条判据测成空气（假绿三形之一）。 */
function sessionStorage() {
    const box = new Map();
    let chat = 'c1';
    return {
        get: (k) => (box.has(chat + '::' + k) ? box.get(chat + '::' + k) : null),
        set: (k, v) => { box.set(chat + '::' + k, v); },
        switchTo: (c) => { chat = c; },
        _box: box,
    };
}
const A_GOOD_NOTE = { freq: 880, at: 0, dur: 0.3, type: 'sine', gain: 0.6 };

/* ══════════════════════ A — 内核面 ══════════════════════ */
test('A1 六条内置配方与源逐条一致（源的六条是合成配方，不是音频文件）', () => {
    assert.deepEqual([...DAT.SOUNDKIT_BUILTIN_KEYS].sort(),
        ['chime', 'crystal', 'ding', 'heart', 'pop', 'retro'], '六条内置（源的键面）');
    assert.equal(DAT.SOUNDKIT_BUILTIN.chime.label, '风铃');
    assert.deepEqual(DAT.SOUNDKIT_BUILTIN.chime.notes[0], { freq: 1046.5, at: 0, dur: 0.5, type: 'sine', gain: 0.6 });
    assert.deepEqual(DAT.SOUNDKIT_BUILTIN.heart.notes.map((x) => x.freq), [174, 174], '心跳是两声 174Hz');
    assert.equal(DAT.SOUNDKIT_BUILTIN.retro.notes[0].type, 'square', '像素用方波');
    assert.equal(DAT.SOUNDKIT_BUILTIN.pop.notes[0].type, 'triangle', '气泡用三角波');
    /* 六条全部要能过校验门（源里它们是硬编码、本件里它们是数据 ⇒ 必须自己站得住）。 */
    for (const k of DAT.SOUNDKIT_BUILTIN_KEYS) {
        const s = DAT.sanitizeNotes(DAT.SOUNDKIT_BUILTIN[k].notes);
        assert.equal(s.dropped, 0, k + ' 的配方不许有坏音符');
        assert.ok(s.notes.length >= 2, k + ' 至少两个音符');
    }
});
test('A2 四态互不同形：unbound 与 unknown_key 不许塌成同一个读数（源静默 return）', () => {
    const none = DAT.resolveSound(null, []);
    assert.equal(none.kind, 'missing');
    assert.equal(none.missingKind, 'unbound');
    const ghost = DAT.resolveSound({ mode: 'builtin', key: '不存在的音效' }, []);
    assert.equal(ghost.kind, 'missing');
    assert.equal(ghost.missingKind, 'unknown_key', '「绑了一个不存在的 key」必须与「没绑」分开');
    const silent = DAT.resolveSound({ mode: 'silent', key: '', volume: 0 }, []);
    assert.equal(silent.kind, 'silent', '显式静音是**第三态**，不是 missing');
    const builtin = DAT.resolveSound({ mode: 'builtin', key: 'ding', volume: 0.5 }, []);
    assert.equal(builtin.kind, 'builtin');
    assert.equal(builtin.label, '叮');
    const custom = DAT.resolveSound({ mode: 'custom', key: '我的', volume: 0.5 },
        [{ key: '我的', label: '我的', notes: [A_GOOD_NOTE], volume: 0.9 }]);
    assert.equal(custom.kind, 'custom');
    assert.equal(custom.volume, 0.5, '槽位自己的音量优先于配方音量');
    /* 四态人话互不相同（视图画的就是这四句）。 */
    const labels = DAT.SOUNDKIT_STATES.map((s) => s.label);
    assert.equal(new Set(labels).size, 4, '四态人话不许有重复');
    for (const s of DAT.SOUNDKIT_STATES) assert.ok(DAT.stateLabel(s.key) === s.label);
});
test('A3 坏音符如实计数与分因，不许静默丢（源把坏值拖到播放期才抛）', () => {
    const s = DAT.sanitizeNotes([
        A_GOOD_NOTE,
        null,
        { freq: 5, at: 0, dur: 0.3, type: 'sine', gain: 0.6 },
        { freq: 880, at: 0, dur: 99, type: 'sine', gain: 0.6 },
        { freq: 880, at: -1, dur: 0.3, type: 'sine', gain: 0.6 },
        { freq: 880, at: 0, dur: 0.3, type: '锯齿', gain: 0.6 },
        { freq: 880, at: 0, dur: 0.3, type: 'sine' },
    ]);
    assert.equal(s.notes.length, 1, '只有第一条能播');
    assert.equal(s.dropped, 6, '六个坏音符必须如实计数');
    assert.equal(s.reasons.note_not_object, 1);
    assert.equal(s.reasons.freq_out_of_range, 1);
    assert.equal(s.reasons.dur_out_of_range, 1);
    assert.equal(s.reasons.at_out_of_range, 1);
    assert.equal(s.reasons.wave_unknown, 1);
    assert.equal(s.reasons.gain_missing, 1);
    /* ★ 读数面自洽的不变量：**逐因相加必须等于 dropped**。
     *   首版在超限那一支只 bump 一次（不论砍掉几条），于是「有 5 个音符放不了」
     *   与「原因表里写着 1 个」自相矛盾 —— 这正是本件要守的「不许静默丢」的镜像：
     *   计数漏了，读数面上就等于**丢了一部分**。 */
    assert.equal(s.reasonsTotal, s.dropped, '逐因相加必须等于 dropped');
    /* 原因人话表必须覆盖每一个 reason（视图不许手写键面）。 */
    for (const k of Object.keys(s.reasons)) {
        assert.notEqual(DAT.dropReasonLabel(k), k, '这一条原因必须有人话：' + k);
    }
    /* 超过条数上限：如实计 dropped 并**按条数**记 over_max_notes（不静默截断）。 */
    const many = [];
    for (let i = 0; i < DAT.SOUNDKIT_MAX_NOTES + 5; i += 1) many.push({ ...A_GOOD_NOTE, at: i * 0.01 });
    const cap = DAT.sanitizeNotes(many);
    assert.equal(cap.notes.length, DAT.SOUNDKIT_MAX_NOTES);
    assert.equal(cap.dropped, 5);
    assert.equal(cap.reasons.over_max_notes, 5, '砍掉几条就记几条（不是「超限过一次」）');
    assert.equal(cap.reasonsTotal, cap.dropped, '超限这一支也要满足同一条不变量');
});
test('A4 音量：「没给」回落默认 ≠「给了 0」如实静音（源每处各写一遍 ⇒ 两者塌成一态）', () => {
    assert.equal(DAT.normalizeVolume(undefined), DAT.SOUNDKIT_DEFAULT_VOLUME, '没给 ⇒ 默认');
    assert.equal(DAT.normalizeVolume(null), DAT.SOUNDKIT_DEFAULT_VOLUME, 'null 是「没给」');
    assert.equal(DAT.normalizeVolume(''), DAT.SOUNDKIT_DEFAULT_VOLUME, '空串是「没给」（Number(\'\') 是 0 —— 源的坑）');
    assert.equal(DAT.normalizeVolume('   '), DAT.SOUNDKIT_DEFAULT_VOLUME, '空白串也是「没给」');
    assert.equal(DAT.normalizeVolume([]), DAT.SOUNDKIT_DEFAULT_VOLUME, '空数组不是 0');
    assert.equal(DAT.normalizeVolume(true), DAT.SOUNDKIT_DEFAULT_VOLUME, '布尔不是音量');
    assert.equal(DAT.normalizeVolume(0), 0, '**给了 0 就是静音**（这是合法选择，不许回落默认）');
    assert.equal(DAT.normalizeVolume('0'), 0, '字符串 0 同办');
    assert.equal(DAT.normalizeVolume(-3), 0, '越界夹到 0');
    assert.equal(DAT.normalizeVolume(9), 1, '越界夹到 1');
    assert.equal(DAT.normalizeVolume(0.35), 0.35, '区间内如实');
    assert.equal(DAT.normalizeVolume('0.35'), 0.35, '数字字符串如实');
});
test('A5 分享码只带配方、不带任何外链；导入失败与「一条都没认出来」不同形', () => {
    const code = DAT.toShareCode({ label: '我的音效', volume: 0.5, notes: [A_GOOD_NOTE] });
    assert.ok(code.startsWith(DAT.SOUNDKIT_SHARE_PREFIX), '前缀必须是本件的（源的 SULLYSND1: 带外链）');
    assert.equal(code.includes('http'), false, '分享码里不许出现任何链接');
    const back = DAT.fromShareCode(code);
    assert.equal(back.ok, true);
    assert.equal(back.recipe.label, '我的音效');
    assert.equal(back.recipe.volume, 0.5);
    assert.equal(back.recipe.notes.length, 1);
    /* 中文必须原样回来（零依赖手写 base64 的意义就在这里）。 */
    const cn = DAT.fromShareCode(DAT.toShareCode({ label: '风铃·夏夜', volume: 1, notes: [A_GOOD_NOTE] }));
    assert.equal(cn.recipe.label, '风铃·夏夜', '中文标签必须原样往返');
    /* 坏码 / 结构不对 / 一个能播的都没有 —— 三种**不同形**的失败。 */
    assert.equal(DAT.fromShareCode('随便一串').reason, 'bad_code');
    assert.equal(DAT.fromShareCode(DAT.SOUNDKIT_SHARE_PREFIX + '!!!').reason, 'bad_code');
    const badShape = DAT.SOUNDKIT_SHARE_PREFIX
        + DAT.bytesToBase64(DAT.utf8Bytes(JSON.stringify({ v: 1, label: 'x' })));
    assert.equal(DAT.fromShareCode(badShape).reason, 'bad_shape', '没有 notes 数组 ⇒ bad_shape');
    const noNote = DAT.SOUNDKIT_SHARE_PREFIX
        + DAT.bytesToBase64(DAT.utf8Bytes(JSON.stringify({ v: 1, label: 'x', notes: [{ freq: 5 }] })));
    const nr = DAT.fromShareCode(noNote);
    assert.equal(nr.ok, false);
    assert.equal(nr.reason, 'no_playable_note', '「导入失败」与「导入成功但一条都没认出来」必须不同形');
    assert.equal(nr.dropped, 1, '坏音符要如实回报条数');
});
test('A6 配方登记：空名 / 无音符 / 超上限如实拒绝，同名是「改」并回报 replaced', () => {
    const r0 = DAT.registerRecipe([], { label: '  ', notes: [A_GOOD_NOTE] });
    assert.equal(r0.ok, false);
    assert.equal(r0.reason, 'label_empty');
    const r1 = DAT.registerRecipe([], { label: '空音效', notes: [{ freq: 5 }] });
    assert.equal(r1.ok, false);
    assert.equal(r1.reason, 'no_playable_note');
    assert.equal(r1.dropped, 1);
    const r2 = DAT.registerRecipe([], { label: '甲', notes: [A_GOOD_NOTE] });
    assert.equal(r2.ok, true);
    assert.equal(r2.recipes.length, 1);
    assert.equal(r2.replaced, false);
    assert.equal(r2.recipe.key, '甲', '没给 key 就用名字当 key');
    const r3 = DAT.registerRecipe(r2.recipes, { label: '甲', notes: [{ ...A_GOOD_NOTE, freq: 440 }] });
    assert.equal(r3.replaced, true, '同名是「改」不是「第二条」');
    assert.equal(r3.recipes.length, 1);
    assert.equal(r3.recipes[0].notes[0].freq, 440);
    /* 超上限如实拒绝，**不静默顶掉旧的**。 */
    const full = [];
    for (let i = 0; i < DAT.SOUNDKIT_MAX_RECIPES; i += 1) full.push({ key: 'k' + i, label: 'k' + i, notes: [A_GOOD_NOTE], volume: 0.6 });
    const over = DAT.registerRecipe(full, { label: '再来一条', notes: [A_GOOD_NOTE] });
    assert.equal(over.ok, false);
    assert.equal(over.reason, 'over_max_recipes');
    assert.equal(over.recipes.length, DAT.SOUNDKIT_MAX_RECIPES, '拒绝时不许动原表');
    /* 删除：found:false 与「删掉了」不同形。 */
    assert.equal(DAT.removeRecipe(r2.recipes, '不在的').found, false);
    assert.equal(DAT.removeRecipe(r2.recipes, '甲').found, true);
});
test('A7 CSS 绑定注释：读回 / 写出（写出先剥旧的，不留两行）', () => {
    const css = 'body { color: red; }';
    const one = DAT.writeSoundComment(css, { mode: 'builtin', key: 'ding', volume: 0.4 });
    assert.ok(one.includes('@soundkit-sound'), '注释必须写进去');
    assert.ok(one.endsWith(css), '原文不许被动');
    const back = DAT.parseSoundComment(one);
    assert.equal(back.mode, 'builtin');
    assert.equal(back.key, 'ding');
    assert.equal(back.volume, 0.4);
    const two = DAT.writeSoundComment(one, { mode: 'custom', key: '我的', volume: 0.9 });
    assert.equal((two.match(/@soundkit-sound/g) || []).length, 1, '重写必须剥掉旧的那行');
    assert.equal(DAT.parseSoundComment(two).key, '我的');
    /* 没有注释 ⇒ null；注释坏了 ⇒ null 且**不抛**。 */
    assert.equal(DAT.parseSoundComment(css), null);
    assert.equal(DAT.parseSoundComment('/* @soundkit-sound {坏 JSON} */'), null);
    assert.equal(DAT.parseSoundComment(''), null);
    assert.equal(DAT.parseSoundComment(null), null);
    /* 剥掉之后只留空 ⇒ 不许留一个孤零零的换行。 */
    assert.equal(DAT.writeSoundComment(one, null), css, '解绑后原文必须原样回来');
});
/* ══════════════════════ B — 播放计划面 ══════════════════════ */
test('B1 静音与没绑**不许报成「播完了」**（源静默 return ⇒ 用户只看到「点了没响」）', () => {
    const miss = DAT.playbackPlan(DAT.resolveSound(null, []));
    assert.equal(miss.ok, false);
    assert.equal(miss.reason, 'missing_unbound');
    assert.equal(miss.steps.length, 0);
    const ghost = DAT.playbackPlan(DAT.resolveSound({ mode: 'builtin', key: '幽灵' }, []));
    assert.equal(ghost.ok, false);
    assert.equal(ghost.reason, 'missing_unknown_key', '两种 missing 的原因读数必须不同形');
    const sil = DAT.playbackPlan(DAT.resolveSound({ mode: 'silent', key: '', volume: 0 }, []));
    assert.equal(sil.ok, false);
    assert.equal(sil.reason, 'silent', '静音是**第四种**原因，与 missing 分开');
    const zero = DAT.playbackPlan({ kind: 'builtin', notes: [A_GOOD_NOTE], volume: 0, missingKind: null });
    assert.equal(zero.ok, false);
    assert.equal(zero.reason, 'volume_zero', '音量 0 与「没绑」不同形');
    assert.equal(DAT.playbackPlan(null).reason, 'no_sound');
});
test('B2 计划是纯函数：不出声、不碰 AudioContext、totalMs 是最后一条停下的时刻', () => {
    const p = DAT.playbackPlan({
        kind: 'builtin',
        notes: [{ freq: 440, at: 0, dur: 0.1, type: 'sine', gain: 0.5 }, { freq: 880, at: 0.2, dur: 0.3, type: 'square', gain: 0.5 }],
        volume: 1,
        missingKind: null
    });
    assert.equal(p.ok, true);
    assert.equal(p.steps.length, 2);
    assert.equal(p.steps[0].wave, 'sine');
    assert.equal(p.steps[1].wave, 'square');
    assert.equal(p.steps[1].startAt, 0.2);
    /* stopAt 含 0.03 的尾巴（源的 osc.stop 也留尾巴，否则尾音被硬切）。 */
    assert.ok(Math.abs(p.steps[0].stopAt - 0.13) < 1e-9, '第一条 0.1 + 0.03 尾巴');
    assert.equal(p.totalMs, Math.round(0.53 * 1000), 'totalMs 取最后一条停下');
    assert.ok(p.steps[0].peak > 0 && p.steps[0].peak <= 1, 'peak 必须在 (0,1]');
    /* 音量进 peak：半音量 ⇒ 半峰值（源把音量乘在 master 上，本件乘在每条上，
     * 读数面上等价、且**无头可判**）。 */
    const half = DAT.playbackPlan({ kind: 'builtin', notes: [A_GOOD_NOTE], volume: 0.5, missingKind: null });
    assert.ok(Math.abs(half.steps[0].peak - 0.3) < 1e-9, '0.6 增益 × 0.5 音量 = 0.3');
    /* 空配方：no_playable_note（与「没绑」不同形）。 */
    assert.equal(DAT.playbackPlan({ kind: 'builtin', notes: [], volume: 1, missingKind: null }).reason, 'no_playable_note');
});
test('B3 读数面：四态分开计数、坏音符分开报、台账与配方数分开报', () => {
    const recipes = [{ key: '我的', label: '我的', notes: [A_GOOD_NOTE], volume: 0.6 }];
    const bindings = {
        message: { mode: 'builtin', key: 'ding', volume: 0.6 },
        send: { mode: 'custom', key: '我的', volume: 0.6 },
        tap: { mode: 'silent', key: '', volume: 0 },
    };
    const r = DAT.soundkitReadings(bindings, recipes);
    assert.equal(r.counts.builtin, 1);
    assert.equal(r.counts.custom, 1);
    assert.equal(r.counts.silent, 1);
    assert.equal(r.counts.missing, 1, 'notice 没绑');
    assert.equal(r.unresolvedCount, 1);
    assert.equal(r.unresolved[0].slot, 'notice');
    assert.equal(r.unresolved[0].why, 'unbound');
    assert.equal(r.recipes, 1, '配方数与「四个槽在用几个」是两件事');
    assert.equal(r.recipeRoom, DAT.SOUNDKIT_MAX_RECIPES - 1);
    assert.equal(r.builtinCount, 6);
    /* 指向不存在的配方 ⇒ unresolved 的 why 是 unknown_key。 */
    const r2 = DAT.soundkitReadings({ message: { mode: 'custom', key: '幽灵', volume: 0.6 } }, []);
    assert.equal(r2.unresolved[0].why, 'unknown_key');
    /* 计数表的键面**必须与真源表逐键对齐**（本版抓到的缺陷 ① 的守卫）。 */
    assert.deepEqual(Object.keys(r.counts).sort(), DAT.SOUNDKIT_STATES.map((s) => s.key).sort(),
        '计数表的键面必须从真源表算（手写会静默少一个格）');
});
test('B4 语音三件套的机制：自动播放受限的人话化 / 两种台词都取不到时如实报', () => {
    const blocked = DAT.playbackErrorFace({ name: 'NotAllowedError' });
    assert.equal(blocked.kind, 'blocked');
    assert.equal(blocked.retryable, true, '被浏览器拦下是**可重试**的（源分成两句不同的话，这是对的）');
    assert.equal(DAT.playbackErrorFace({ name: 'NotSupportedError' }).retryable, false);
    assert.equal(DAT.playbackErrorFace(new Error('boom')).kind, 'failed');
    assert.equal(DAT.playbackErrorFace(null).kind, 'failed', '没给错误对象也不许抛');
    const both = DAT.speechFace('原台词', '污染台词');
    assert.equal(both.mode, 'surface');
    assert.equal(both.hasTruth, true);
    assert.equal(DAT.speechFace('原台词', '').mode, 'truth');
    assert.equal(DAT.speechFace('原台词', '').missingKind, 'surface_only');
    const none = DAT.speechFace('', '');
    assert.equal(none.mode, 'none');
    assert.equal(none.missingKind, 'both_missing');
    assert.equal(none.text, '', '两种都没有时不许默认落到某一边（源在污染文本缺失时会显示空）');
});
/* ══════════════════════ C — 接线面 ══════════════════════ */
test('C1 三条会话键随会话隔离（换角色后不许读到别人的账）', () => {
    const st = sessionStorage();
    const app = new SoundkitApp(null, st);
    app.bind('message', 'builtin', 'ding', 0.6);
    app.saveRecipe({ label: '甲', notes: [A_GOOD_NOTE] });
    assert.equal(app.slotRows().find((r) => r.slot === 'message').kind, 'builtin');
    st.switchTo('c2');
    const app2 = new SoundkitApp(null, st);
    assert.equal(app2.slotRows().find((r) => r.slot === 'message').kind, 'missing', '换会话必须读不到上一个人的绑定');
    assert.equal(app2.recipes.length, 0, '配方也是「这段关系的账」');
    st.switchTo('c1');
    const app3 = new SoundkitApp(null, st);
    assert.equal(app3.slotRows().find((r) => r.slot === 'message').kind, 'builtin', '切回来还在');
    assert.equal(app3.recipes.length, 1);
});
test('C2 六处接线落点到位（少一处就静默错数据 / 点了没反应）', () => {
    assert.ok(read(APPS).includes("id: 'soundkit'"), 'config/apps.js 必须有条目');
    assert.ok(read(STORAGE).includes('/^soundkit_/'), 'storage.js 必须有宽前缀');
    assert.ok(read(INDEX).includes("'soundkitApp'"), 'index.js 重绑表必须登记（有未提交草稿）');
    assert.ok(read(INDEX).includes("appId === 'soundkit'"), 'index.js 必须有懒加载分支');
    assert.ok(read(INDEX).includes('./apps/soundkit/soundkit-app.js'), '懒加载分支必须指对文件');
    assert.ok(read(KEYS).includes("key: 'soundkit_settings'"), 'keys-audit 必须登记设置键');
    assert.ok(read(V255).includes("soundkitApp: 'soundkit'"), 'v255 目录映射必须在册');
    assert.ok(read('phone.css').includes('v3.37.0] 白盒音效盒'), 'phone.css 必须有本版段头');
});
test('C3 样式段头**独立成行**（本仓踩过粘连坑：语法合法但样式挂错选择器）', () => {
    const css = read('phone.css');
    const idx = css.indexOf('[v3.37.0] 白盒音效盒');
    assert.ok(idx > 0, '段头必须在场');
    const lineStart = css.lastIndexOf('\n', idx);
    assert.ok(css.slice(lineStart + 1, idx).startsWith('/*'), '段头必须从行首开始（前面只有 /*）');
    assert.equal(css[idx - 1] !== '\n' && css[lineStart + 1] === '/', true, '段头必须独立成行');
    const seg = read(SK_CSS);
    assert.ok(css.includes(seg.trim()), 'phone.css 里的样式段必须与源文件**逐字同源**');
});
test('C4 视图调用面闭合：视图调用的每个 App 方法都真在 App 上', () => {
    const view = read(SK_VIEW);
    const app = new SoundkitApp(null, memStorage());
    const calls = new Set();
    const re = /\bapp\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
    let m;
    while ((m = re.exec(view)) !== null) calls.add(m[1]);
    assert.ok(calls.size >= 16, '视图至少要调 16 个 App 方法（实测 ' + calls.size + '）');
    const missing = [];
    for (const c of calls) {
        if (typeof app[c] !== 'function') missing.push(c);
    }
    assert.deepEqual(missing, [], '视图调了但 App 上没有的方法（差集必须为空）：' + missing.join(' / '));
});
test('C5 样式类名与视图产出逐类对应（视图产出的类必须有样式落点）', () => {
    const view = read(SK_VIEW);
    const css = read(SK_CSS);
    const cls = new Set();
    /* ★ 先抹掉**拼接段**：`class="snd-face snd-face-' + meta.tone + '"` 这种写法里，
     *   正则会把 `snd-face-'` / `meta.tone` 之类**片段**当成类名（假红）。
     *   拼接段一律以 `' + ` 起、以 ` + '` 止 —— 整段抹成空格再抓。 */
    const flat = view.replace(/'\s*\+[\s\S]*?\+\s*'/g, ' ');
    const re = /class="([^"]+)"/g;
    let m;
    while ((m = re.exec(flat)) !== null) {
        for (const c of m[1].split(/\s+/)) {
            if (c && !c.includes('+') && !c.startsWith('$')) cls.add(c);
        }
    }
    const missing = [];
    for (const c of cls) {
        if (!css.includes('.' + c)) missing.push(c);
    }
    assert.deepEqual(missing, [], '视图产出但样式里没有落点的类：' + missing.join(' / '));
    /* 四态四色必须都有落点（本件最要紧的一条：四态不许同色）。 */
    for (const tone of ['ok', 'info', 'mute', 'warn']) {
        assert.ok(css.includes('.snd-tone-' + tone), '四态配色必须都有样式落点：' + tone);
    }
});
/* ══════════════════════ D — 通道面 ══════════════════════ */
test('D1 不碰模型：三件里一个网络调用都没有（源 ttsRouter 直连三家 TTS 商）', () => {
    for (const rel of [SK_DATA, SK_APP, SK_VIEW]) {
        const code = stripComments(read(rel));
        for (const bad of ['callChatAPI', 'fetch(', 'XMLHttpRequest', 'axios', 'WebSocket', 'EventSource',
            'fishaudio', 'elevenlabs', 'minimax', 'ttsRouter']) {
            assert.equal(code.includes(bad), false, rel + ' 里不许出现 ' + bad);
        }
    }
});
test('D2 不碰宿主对象、不落数据库、不跨 App 读（源把提示音写回宿主 + 读全局音频元素）', () => {
    for (const rel of [SK_DATA, SK_APP, SK_VIEW]) {
        const code = stripComments(read(rel));
        for (const bad of ['AppState', 'Utils.saveData', 'Utils.emitEvent', 'voiceProfile',
            'getWorldContext', 'ttsConfig', 'indexedDB', 'localStorage', 'SillyTavern']) {
            assert.equal(code.includes(bad), false, rel + ' 里不许出现 ' + bad);
        }
    }
});
test('D3 不收外链、不产二进制：没有任何 URL / data URL / 图片扩展名 / 音频文件', () => {
    for (const rel of [SK_DATA, SK_APP, SK_VIEW]) {
        const code = stripComments(read(rel));
        /* ★ 判据按**文件名形态**查（前面必须是非标识符字符）：首版裸查 `.wav`，
         *   而 App 里有 `osc.type = st.wave;` —— `st.wave` 里含子串 `.wav`
         *   （判据过宽就是判据写歪：把合法标识符读成了音频扩展名）。 */
        for (const bad of ['http://', 'https://', 'cdn.', 'data:image', 'data:audio',
            'toDataURL', 'Buffer', 'atob', 'btoa']) {
            assert.equal(code.includes(bad), false, rel + ' 里不许出现 ' + bad);
        }
        for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp3', 'wav', 'ogg', 'm4a']) {
            const re = new RegExp('(^|[^A-Za-z0-9_$])' + ext + '(\\b|\\s*[\'\"`])');
            assert.equal(re.test(code), false, rel + ' 里不许出现 .' + ext + ' 文件形态');
        }
    }
    const css = stripComments(read(SK_CSS));
    assert.equal(css.includes('url('), false, '样式里不许有任何外部资源引用');
});
test('D4 不写宿主楼层、不整块回写：App 只有 storage.get/set 两个出口', () => {
    const code = stripComments(read(SK_APP));
    for (const bad of ['pushMessage', 'AppState', 'Utils.saveData', 'chat.history', 'saveChat']) {
        assert.equal(code.includes(bad), false, '不许出现：' + bad);
    }
});
/* ══════════════════════ E — 活性面 ══════════════════════ */
test('E1 数据层的每一条真源表都必须被产品侧真消费（不许建好了零消费）', () => {
    const dataCode = stripComments(read(SK_DATA));
    const appCode = stripComments(read(SK_APP));
    const viewCode = stripComments(read(SK_VIEW));
    /* 波形表：数据层用它做白名单、视图用它建下拉。 */
    assert.ok(dataCode.includes('SOUNDKIT_WAVE_KINDS.indexOf('), '数据层必须用波形表做校验白名单');
    assert.ok(viewCode.includes('cat.waves'), '视图必须消费波形表（下拉的键面）');
    /* 内置键表：App 用 `SOUNDKIT_BUILTIN[k]` 判 key、catalogs 出键面、视图画芯片。 */
    assert.ok(appCode.includes('SOUNDKIT_BUILTIN['), 'App 必须用内置表判 key 是否存在');
    assert.ok(viewCode.includes('cat.builtins'), '视图必须消费内置键表');
    /* 槽位表：App 遍历它算行、视图画行。 */
    assert.ok(appCode.includes('SOUNDKIT_SLOTS.map('), 'App 必须遍历槽位表');
    /* 四态表：读数面与视图配色都用它（本版缺陷 ①② 的守卫）。 */
    assert.ok(dataCode.includes('for (const s of SOUNDKIT_STATES) counts[s.key] = 0'),
        '计数表必须从四态表算（不许手写第二份）');
    assert.ok(viewCode.includes('toneTable(app.catalogs().states)'),
        '视图配色必须从四态表算（不许手写第二份键面）');
    /* 坏音符原因表：App 的 catalogs 出它、视图用它建人话表（**取的是方法引用**，
     *   不是当场调用 —— `const check = app.dropReasonLabel;` 这种取法同属真消费，
     *   判据不许只认调用形，否则会把合法消费逼成绕路）。 */
    assert.ok(viewCode.includes('app.dropReasonLabel'), '视图必须走 App 的原因人话出口');
    assert.ok(appCode.includes('reasons: s.reasons'), 'App 必须把原因表透出去（视图才有键面）');
    /* 三态表（取数面）：App 用它当取数面读数、视图用它建三态人话表（本版缺陷 ④ 的守卫）。 */
    assert.ok(appCode.includes('const FACE = SOUNDKIT_FACES'),
        'App 的三态键面必须取数据层真源（不许另写一份）');
    assert.ok(viewCode.includes('[SOUNDKIT_FACES.'), '视图三态人话表必须用计算键');
});
test('E2 手写键不许回潮：数据层与视图都不许再出现四态标识符形键面', () => {
    const dataCode = stripComments(read(SK_DATA));
    const viewCode = stripComments(read(SK_VIEW));
    const appCode = stripComments(read(SK_APP));
    /* 数据层：`{ builtin: 0, custom: 0, … }` 这个形态不许再出现。 */
    assert.equal(/counts\s*=\s*\{\s*builtin\s*:/.test(dataCode), false,
        '计数表不许退回手写（本版缺陷 ① 的守卫）');
    /* 视图：`{ builtin: 'ok', custom: 'info', … }` 这个形态不许再出现。 */
    assert.equal(/STATE_TONE/.test(viewCode), false, '四态配色表不许退回手写（本版缺陷 ② 的守卫）');
    for (const k of ["    builtin:", "    custom:", "    silent:", "    missing:"]) {
        assert.equal(viewCode.includes(k), false, '视图不许手写四态标识符形键：' + k.trim());
    }
    /* ★ 三态（取数面）同族守卫（本版缺陷 ④）：不许再退回手写标识符形键面。
     *   形态 = 表里出现 `ok:` / `empty:` / `storage_absent:` 这种**裸键**。 */
    assert.equal(/FACE_META\s*=\s*\{\s*\n\s*ok\s*:/.test(viewCode), false,
        '视图三态人话表不许退回手写键（本版缺陷 ④ 的守卫）');
    for (const k of ['    storage_absent:', '    empty: {']) {
        assert.equal(viewCode.includes(k), false, '视图不许手写三态标识符形键：' + k.trim());
    }
    assert.equal(/const FACE\s*=\s*Object\.freeze\(\{/.test(appCode), false,
        'App 不许再另写一份三态常量（必须取 SOUNDKIT_FACES）');
});
test('E3 视图不自己算校验、不自己算播放计划（那是数据层与 App 的事）', () => {
    const view = stripComments(read(SK_VIEW));
    assert.ok(view.includes('app.checkNotes('), '草稿校验必须走 App 出口');
    assert.ok(view.includes('app.planOfDraft('), '草稿播放计划必须走 App 出口');
    assert.ok(view.includes('app.planOf('), '槽位播放计划必须走 App 出口');
    assert.equal(view.includes('sanitizeNotes'), false, '视图不许直接调数据层的校验（那是数据层的事）');
    assert.equal(view.includes('playbackPlan'), false, '视图不许直接调播放计划');
    assert.equal(view.includes('createOscillator'), false, '视图一行声音代码都不许有（发声是 App 的事）');
});
/* ══════════════════════ F — 视图契约面 ══════════════════════ */
test('F1 四态必须分开画：视图必须画出 kindLabel，不许把四态塌成一句「点了没响」', () => {
    const view = read(SK_VIEW);
    assert.ok(view.includes('r.kindLabel'), '视图必须画四态人话');
    assert.ok(view.includes("r.kind === 'builtin' || r.kind === 'custom'"), '在用与没在用的画法必须分开');
    assert.ok(view.includes("r.missingKind === 'unknown_key'"), '「指向的配方不在了」与「没绑」必须分开画');
    assert.ok(view.includes('静音'), '静音那一态必须在场（它与「没绑」不同）');
});
test('F2 波形预览不依赖 AudioContext：无头环境里也看得到配方长什么样', () => {
    /* ★ 必须用**剥过注释的**真代码判：首版裸查 `AudioContext`，而视图的文件头
     *   与 `_waveSVG` 的注释里**提到了**这个词（「无头环境（没有 AudioContext）
     *   照样能看到」）—— 注释里的提及不算消费，同一条纪律对判据也成立。 */
    const view = stripComments(read(SK_VIEW));
    assert.ok(view.includes('_waveSVG'), '波形预览必须在场');
    assert.equal(view.includes('AudioContext'), false, '视图不许碰 AudioContext（那是 App 的惰性出口）');
    assert.equal(view.includes('createOscillator'), false, '视图一行声音代码都不许有');
    assert.ok(view.includes('viewBox'), '波形必须是 SVG（零位图、零外链）');
    assert.ok(view.includes('snd-wave-empty'), '没有声音时必须画出**原因**，不是空白');
});
test('F3 转义走拼装形：`&` 与引号不许以字面量出现（落盘链会把实体解码 ⇒ _esc 静默失效）', () => {
    const view = read(SK_VIEW);
    assert.ok(view.includes('String.fromCharCode(38)'), '`&` 必须用拼装形');
    assert.ok(view.includes('String.fromCharCode(34)'), '双引号必须用拼装形');
    assert.equal(view.includes('&amp;'), false, '不许出现实体字面量（会被解码成真字符）');
});
test('F4 失败面必须可见：试听没响 / 导入失败 / 保存失败都要有话说', () => {
    const view = read(SK_VIEW);
    assert.ok(view.includes('没响（'), '试听失败必须把那句话画出来');
    assert.ok(view.includes('导入失败：'), '导入失败必须画');
    assert.ok(view.includes('保存失败：'), '保存失败必须画');
    assert.ok(view.includes('_flash'), '动作回执必须在场');
});
/* ══════════════════════ G — 键归属面 ══════════════════════ */
test('G1 三条会话键登记 scope=chat，且宽匹配族在场', () => {
    const keys = read(KEYS);
    for (const k of ['soundkit_settings', 'soundkit_recipes', 'soundkit_ledger']) {
        const re = new RegExp("key:\\s*'" + k + "',\\s*scope:\\s*'chat'");
        assert.ok(re.test(keys), '键必须在册且 scope=chat：' + k);
    }
    assert.ok(/\/\^soundkit_\//.test(read(STORAGE)), '宽匹配前缀必须在场');
});
test('G2 三条键真被产品消费（写面必须落到这三条上）', () => {
    const code = stripComments(read(SK_APP));
    for (const k of ['soundkit_settings', 'soundkit_recipes', 'soundkit_ledger']) {
        assert.ok(code.includes("'" + k + "'"), 'App 必须真用到这一条键：' + k);
    }
    assert.equal(code.includes('soundkit_extra'), false, '不许有第四条未登记的键');
});
/* ══════════════════════ H — App 编排面 ══════════════════════ */
test('H1 取数分两种回报：storage 取不出来**不许**读成「就是空的」', () => {
    /* 一取就抛的 storage：ok 必须是 false（「取不出来」），而不是「空表」。 */
    const broken = { get() { throw new Error('boom'); }, set() {} };
    const app = new SoundkitApp(null, broken);
    app.probe();
    assert.equal(app.faceOf(), 'storage_absent', '取数抛异常 ⇒ 存储不可用，不是「还没有配方」');
    /* 好的 storage 但一格没有：ok 是 true，face 是 empty。 */
    const empty = new SoundkitApp(null, memStorage());
    empty.probe();
    assert.equal(empty.faceOf(), 'empty', '「还没有配方」与「读不出来」必须不同形');
    /* 有配方：ok。 */
    const withOne = new SoundkitApp(null, memStorage({
        soundkit_recipes: JSON.stringify({ recipes: [{ key: '甲', label: '甲', notes: [A_GOOD_NOTE], volume: 0.6 }] })
    }));
    withOne.probe();
    assert.equal(withOne.faceOf(), 'ok');
});
test('H2 换会话必须全量重取：绑定、配方、台账、草稿一律不许留（源把提示音写回宿主）', () => {
    const st = sessionStorage();
    const app = new SoundkitApp(null, st);
    app.bind('message', 'builtin', 'ding', 0.6);
    app.saveRecipe({ label: '甲', notes: [A_GOOD_NOTE] });
    app.openRecipe('甲');
    app.setTab('editor');
    app._lastPlay = { slot: 'message' };
    st.switchTo('c2');
    app.onChatChanged();
    assert.equal(app.recipes.length, 0, '配方必须重取');
    assert.equal(app.currentKey(), '', '选中的配方必须丢');
    assert.equal(app.tab(), 'slots', '视图态必须回默认');
    assert.equal(app.lastPlay(), null, '上一次试听读数必须丢（那是别人的账）');
    assert.equal(app.slotRows().find((r) => r.slot === 'message').kind, 'missing');
});
test('H3 删配方必须连带解绑：绑它的槽位不许留在「指向不存在的配方」态', () => {
    const st = memStorage();
    const app = new SoundkitApp(null, st);
    app.saveRecipe({ label: '甲', notes: [A_GOOD_NOTE] });
    app.bind('message', 'custom', '甲', 0.6);
    assert.equal(app.slotRows().find((r) => r.slot === 'message').kind, 'custom');
    app.deleteRecipe('甲');
    const row = app.slotRows().find((r) => r.slot === 'message');
    assert.equal(row.kind, 'missing', '删了配方，绑它的槽位必须一并解绑');
    assert.equal(row.missingKind, 'unbound', '解绑后是 unbound（不是 unknown_key）');
});
test('H4 播放：无 AudioContext 的环境里**读数不消失**，计划照样返回', () => {
    const app = new SoundkitApp(null, memStorage());
    app.bind('message', 'builtin', 'ding', 0.6);
    const r = app.play('message');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_audio_context', '无头环境如实报「没有音频上下文」');
    assert.ok(r.totalMs > 0, '计划读数不因环境缺失而消失');
    assert.ok(r.steps.length > 0);
    /* 静音槽：连计划都没有，原因是 silent（与 no_audio_context 不同形）。 */
    app.bind('tap', 'silent');
    const s = app.play('tap');
    assert.equal(s.reason, 'silent');
    assert.equal(s.totalMs, 0);
    /* 没绑的槽：missing_unbound。 */
    assert.equal(app.play('notice').reason, 'missing_unbound');
});
test('H5 草稿面：checkNotes 与 planOfDraft 是**纯读数**（不落盘、不占台账）', () => {
    const st = memStorage();
    const app = new SoundkitApp(null, st);
    const c = app.checkNotes([A_GOOD_NOTE, { freq: 5 }]);
    assert.equal(c.ok, true, '有一个能播的就算能播');
    assert.equal(c.dropped, 1);
    assert.equal(c.notes.length, 1);
    const p = app.planOfDraft([A_GOOD_NOTE], 0.5);
    assert.equal(p.ok, true);
    assert.equal(st._box.size, 0, '草稿校验与草稿计划**一个字节都不许落盘**');
    assert.equal(app.readings().recipes, 0, '草稿不许进读数（它不是已登记的配方）');
});
/* ══════════════════════ I — 负控制 ══════════════════════ */
/** 破坏表：锚点一律取**代码行**，一律字面 split/join（不用 String.replace，避免 `$&` 被解释）。 */
const DAMAGE = {
    /* ① 四态塌成一态：绑了不存在的 key 与「没绑」合流（源就是这个形态） */
    d1: [SK_DATA,
        "        if (!hit) {\n            return { kind: 'missing', missingKind: 'unknown_key', notes: [], volume: SOUNDKIT_DEFAULT_VOLUME, label: '' };\n        }\n        const s = sanitizeNotes(hit.notes);\n        return {\n            kind: 'builtin',",
        "        if (!hit) {\n            return { kind: 'missing', missingKind: 'unbound', notes: [], volume: SOUNDKIT_DEFAULT_VOLUME, label: '' };\n        }\n        const s = sanitizeNotes(hit.notes);\n        return {\n            kind: 'builtin',"],
    /* ② 静音塌进 missing（源把 silent 也当「没声」） */
    d2: [SK_DATA,
        "    if (b.mode === 'silent') {\n        return { kind: 'silent', missingKind: null, notes: [], volume: 0, label: '静音' };\n    }",
        "    if (b.mode === 'silent') {\n        return { kind: 'missing', missingKind: 'unbound', notes: [], volume: 0, label: '' };\n    }"],
    /* ③ 坏音符静默丢（源的真缺陷形态：坏值不报、只是没响） */
    d3: [SK_DATA,
        "        if (freq === null || freq < SOUNDKIT_FREQ_MIN || freq > SOUNDKIT_FREQ_MAX) {\n            dropped += 1; bump('freq_out_of_range'); continue;\n        }",
        "        if (freq === null || freq < SOUNDKIT_FREQ_MIN || freq > SOUNDKIT_FREQ_MAX) {\n            continue;\n        }"],
    /* ④ 「没给」与「给了 0」塌成一态（源每处各写一遍 Number 强转的形态） */
    d4: [SK_DATA,
        "    const n = numOrNull(v);\n    if (n === null) return SOUNDKIT_DEFAULT_VOLUME;",
        "    const n = Number(v);\n    if (!Number.isFinite(n)) return SOUNDKIT_DEFAULT_VOLUME;"],
    /* ⑤ 分享码不再过校验门（坏音符进码 —— 与源一样只带原始字段）。
     *   ★ 首版破坏写成 `const s = { notes: Array.isArray(r.notes) ? r.notes : [] };`，
     *     但导出用的是 `s.notes` —— 字段名对得上 ⇒ **行为完全不变**（不可观测的破坏
     *     = 装饰破坏）。要让判据有判别力，必须让**导出真的带上坏音符**。 */
    d5: [SK_DATA,
        "    const s = sanitizeNotes(r.notes);\n    const payload = {\n        v: 1,\n        label: typeof r.label === 'string' ? r.label.slice(0, 40) : '',\n        volume: normalizeVolume(r.volume),\n        notes: s.notes\n    };",
        "    const payload = {\n        v: 1,\n        label: typeof r.label === 'string' ? r.label.slice(0, 40) : '',\n        volume: normalizeVolume(r.volume),\n        notes: Array.isArray(r.notes) ? r.notes : []\n    };"],
    /* ⑥ 静音与没绑在**播放计划**上塌成同一句（源静默 return ⇒ 用户只看到「点了没响」） */
    d6: [SK_DATA,
        "    if (s.kind === 'silent') return { ok: false, reason: 'silent', steps: [], totalMs: 0 };",
        "    if (s.kind === 'silent') return { ok: false, reason: 'missing_unbound', steps: [], totalMs: 0 };"],
    /* ⑦ 计数表退回手写（本版抓到的缺陷 ① 的形态）。
     *   ★ 首版破坏写成「四格齐全的手写表」—— 键面与真源表**恰好相同** ⇒ 键面对账判据
     *     看不出来（不可观测的破坏）。真实后果是「数据层多一态时手写表少一格」，
     *     所以破坏要**模拟少一格**：缺的那一格一加就成 NaN，读数面上立刻响亮地坏。 */
    d7: [SK_DATA,
        "    const counts = {};\n    for (const s of SOUNDKIT_STATES) counts[s.key] = 0;",
        "    const counts = { builtin: 0, custom: 0, silent: 0 };"],
    /* ⑧ App：认源又走吞异常的读法（坏 storage 被读成「空」） */
    a1: [SK_APP,
        '        const rr = this._readRaw(RECIPES_KEY);',
        '        const rr = { ok: true, raw: this._readJSON(RECIPES_KEY) };'],
    /* ⑨ App：删配方不再连带解绑（留下「指向不存在的配方」的槽位）。
     *   ★ 首版破坏写成 `if (false) delete this.bindings[slot.key];` —— 那一行**仍然含**
     *     `delete this.bindings[slot.key]` 这个串，判据照样为真（不可观测的破坏）。
     *     改成「条件成立就 continue」：解绑语句**真的消失**，判据才看得见。 */
    a2: [SK_APP,
        "            if (b && b.mode === 'custom' && b.key === String(key)) delete this.bindings[slot.key];",
        "            if (b && b.mode === 'custom' && b.key === String(key)) continue;"],
    /* ⑩ App：换会话不再重取（源把提示音写回宿主的形态） */
    a3: [SK_APP,
        "        this._loadSettings();\n        this.probe();\n        if (this._view) this._view.refresh();\n    }\n    render() {",
        "        if (this._view) this._view.refresh();\n    }\n    render() {"],
    /* ⑪ 视图：四态配色退回手写标识符形键（本版抓到的缺陷 ② 的形态） */
    v1: [SK_VIEW,
        '        const tone = toneTable(app.catalogs().states);',
        "        const tone = { builtin: 'ok', custom: 'info', silent: 'mute', missing: 'warn' };"],
    /* ⑫ 视图：没绑与「指向的配方不在了」塌成同一句。
     *   ★ 首版替换串写成 `: '没绑'))` —— 把三元表达式的**另一半括号**也吃掉了，
     *     替换后**语法都不合法**（J2 报「破坏后必须仍是合法 JS」）。
     *     破坏必须只动**语义**、不动结构。 */
    v2: [SK_VIEW,
        "                    : (r.missingKind === 'unknown_key' ? '指向的配方不在了' : '没绑'))",
        "                    : (r.missingKind === 'unbound' ? '没绑' : '没绑'))"],
    /* ⑬ 视图：三态人话表退回手写标识符形键（本版抓到的缺陷 ④ 的形态 —— 第九道门 J7 报的就是它） */
    v3: [SK_VIEW,
        "    [SOUNDKIT_FACES.ok]: { icon: '\\u{1f514}', label: '音效盒开着', tone: 'ok' },",
        "    ok: { icon: '\\u{1f514}', label: '音效盒开着', tone: 'ok' },"],
    /* ⑭ App：三态常量退回手写一份（同族另一半） */
    a4: [SK_APP,
        'const FACE = SOUNDKIT_FACES;',
        "const FACE = Object.freeze({ ok: 'ok', empty: 'empty', storage_absent: 'storage_absent' });"],
};
/** 数据层判据（加载破坏副本后真跑）。 */
const dataProblems = (mod) => {
    const bad = [];
    /* ① 四态互不同形：unknown_key 与 unbound 必须分开 */
    if (mod.resolveSound(null, []).missingKind !== 'unbound') bad.push('unbound-kind-lost');
    if (mod.resolveSound({ mode: 'builtin', key: '幽灵' }, []).missingKind !== 'unknown_key') {
        bad.push('unknown-key-not-distinguished');
    }
    if (mod.resolveSound({ mode: 'silent', key: '', volume: 0 }, []).kind !== 'silent') {
        bad.push('silent-collapsed-into-missing');
    }
    /* ② 坏音符必须计数（不许静默丢） */
    const s = mod.sanitizeNotes([{ freq: 5, at: 0, dur: 0.3, type: 'sine', gain: 0.6 }]);
    if (s.dropped !== 1 || s.reasons.freq_out_of_range !== 1) bad.push('bad-note-swallowed');
    /* ③ 「没给」与「给了 0」不许塌成一态 */
    if (mod.normalizeVolume(undefined) !== mod.SOUNDKIT_DEFAULT_VOLUME) bad.push('undefined-not-default');
    if (mod.normalizeVolume('') !== mod.SOUNDKIT_DEFAULT_VOLUME) bad.push('empty-string-read-as-zero');
    if (mod.normalizeVolume(0) !== 0) bad.push('zero-not-honored');
    /* ④ 分享码必须过校验门（坏音符不许进码）。
     *   ★ 判据必须用**好坏混装**的配方：只用坏音符时，带不带校验门都会在导入端
     *     得到 `no_playable_note`（**同形**）—— 那样判据测的是空气。
     *     混装后差别才可观测：过门的码里只剩好音符（dropped 0），
     *     不过门的码里好坏都在（dropped 1）。 */
    const code = mod.toShareCode({ label: 'x', volume: 0.5, notes: [{ freq: 880, at: 0, dur: 0.2, type: 'sine', gain: 0.5 }, { freq: 5 }] });
    const back = mod.fromShareCode(code);
    if (back.ok !== true) bad.push('share-code-roundtrip-broken');
    else if (back.dropped !== 0) bad.push('share-code-keeps-bad-notes');
    /* ⑤ 播放计划：静音与没绑不同形 */
    const sil = mod.playbackPlan(mod.resolveSound({ mode: 'silent', key: '', volume: 0 }, []));
    const mis = mod.playbackPlan(mod.resolveSound(null, []));
    if (sil.ok !== false || sil.reason !== 'silent') bad.push('silent-plan-not-marked');
    if (mis.reason === sil.reason) bad.push('silent-and-missing-same-reason');
    /* ⑥ 计数表键面必须与四态表逐键对齐（本版缺陷 ① 的正判据）。
     *   ★ 只对键面还不够：手写表**少一格**时键面可能仍凑齐（靠 `+=` 现造出来），
     *     但那一格的值会是 `NaN`（`undefined + 1`）—— 读数面上「NaN 个槽」
     *     比缺一格更坏（它会被 `|| 0` 之类兜底悄悄变成 0）。故**逐格验数**。 */
    const r = mod.soundkitReadings({}, []);
    const want = mod.SOUNDKIT_STATES.map((x) => x.key).sort().join(',');
    const got = Object.keys(r.counts).sort().join(',');
    if (want !== got) bad.push('counts-keys-handwritten');
    for (const k of Object.keys(r.counts)) {
        if (!Number.isFinite(r.counts[k])) bad.push('counts-cell-not-a-number');
    }
    if (!Number.isFinite(r.unresolvedCount)) bad.push('counts-cell-not-a-number');
    return bad;
};
/** App 侧的**结构面**判据（不加载副本 —— 编排层 import 视图/宿主，副本树里跑不起来）。 */
const appReadProblems = (src) => {
    const bad = [];
    /* ★ 判据必须落到**被破坏的那一处**（`probe()` 里的认源调用）。
     *   只查全文件含 `_readRaw(` 等于没盖住破坏面（定义处与别处都在）。 */
    const i = src.indexOf('    probe() {');
    const body = i < 0 ? '' : src.slice(i, i + 2400);
    if (!body.includes('this._readRaw(RECIPES_KEY)')) bad.push('read-raw-not-used');
    if (!/storageOk\s*=/.test(body)) bad.push('storage-ok-not-computed');
    return bad;
};
const appDeleteProblems = (src) => {
    const bad = [];
    const i = src.indexOf('    deleteRecipe(key) {');
    const rest = i < 0 ? '' : src.slice(i + 22);
    const endRel = rest.indexOf('\n    }\n');
    const body = endRel < 0 ? rest : rest.slice(0, endRel);
    if (!/delete this\.bindings\[slot\.key\]/.test(body)) bad.push('delete-does-not-unbind');
    return bad;
};
const appChatProblems = (src) => {
    const bad = [];
    const i = src.indexOf('    onChatChanged() {');
    if (i < 0) { bad.push('on-chat-changed-missing'); return bad; }
    /* ★ 窗口必须取到**函数体结束**（下一个顶格 `    }`）：取固定字数会把紧随其后的
     *   `render()` 的 `this.probe()` 落进窗口 ⇒ 破坏后照样为真（判据面没盖住破坏面）。 */
    const rest = src.slice(i + 20);
    const endRel = rest.indexOf('\n    }\n');
    const body = endRel < 0 ? rest : rest.slice(0, endRel);
    if (!/this\.probe\(\)/.test(body)) bad.push('chat-change-no-refetch');
    if (!/this\._loadSettings\(\)/.test(body)) bad.push('chat-change-no-settings-reload');
    return bad;
};
const viewToneProblems = (src) => {
    const bad = [];
    /* ★ 必须**数次数**：不许出现任何手写的四态标识符形键面。 */
    if (/STATE_TONE/.test(src)) bad.push('state-tone-handwritten');
    if (/tone\s*=\s*\{\s*builtin\s*:/.test(src)) bad.push('state-tone-handwritten');
    if (!src.includes('toneTable(app.catalogs().states)')) bad.push('tone-not-from-catalog');
    return bad;
};
const viewMissingProblems = (src) => {
    const bad = [];
    if (!src.includes("r.missingKind === 'unknown_key'")) bad.push('unknown-key-not-drawn');
    return bad;
};
/** 视图三态人话表的判据（本版缺陷 ④ 的正判据）：键必须取数据层真源的计算键。
 *  ★ 判据面与破坏面同一语义：破坏把计算键退回手写裸键 ⇒ 本判据必须转红。
 *  ★ 必须**数次数**（不是「含不含」）：只查「文件里含 `[SOUNDKIT_FACES.`」时，
 *    破坏掉三行里的**一行**后其余两行仍在 ⇒ 判据照样为真（判据测空气）。
 *    这正是本仓 v3.36.0 踩过的第 ⑩ 条判据侧自身错，本版不再重犯。 */
const viewFaceProblems = (src) => {
    const bad = [];
    /* ★ 先剥注释：本件文件头**逐条写明**了修前的错误形态（里面就有 `storage_absent:` 这种
     *   字面）——按本仓纪律「注释里的提及不算消费」，注释里的提及不算手写键。
     *   不剥的话判据会在**真源码上**就报红（对照面不干净 ⇒ 假红，与破坏无关）。 */
    const code = stripComments(src);
    if (code.split('[SOUNDKIT_FACES.').length - 1 < 3) bad.push('face-keys-handwritten');
    if (code.includes('    storage_absent:')) bad.push('face-keys-handwritten');
    return bad;
};
/** App 三态常量的判据（本版缺陷 ④ 的另一半）：必须取真源，不许另写一份。
 *  ★ 这是**结构面**判据（App 侧不加载副本 —— 编排层 import 视图/宿主，副本树里跑不起来）。 */
const appFaceProblems = (src) => {
    const bad = [];
    const code = stripComments(src);
    if (!code.includes('const FACE = SOUNDKIT_FACES')) bad.push('face-constant-handwritten');
    if (/const FACE\s*=\s*Object\.freeze\(\{/.test(code)) bad.push('face-constant-handwritten');
    return bad;
};
function chr96() { return String.fromCharCode(96); }
/** num-gate 的等价桩（与真件同口径，零依赖）。 */
const NUM_GATE_STUB = 'export function numOrNull(v) {\n'
    + "    if (typeof v !== 'number' && typeof v !== 'string') return null;\n"
    + "    if (typeof v === 'string' && !v.trim()) return null;\n"
    + '    const n = Number(v);\n'
    + '    return Number.isFinite(n) ? n : null;\n'
    + '}\n';
/** 造一份破坏副本并**落盘**（只写文件，不加载）。副本按**真目录结构**建。 */
function writeDamagedCopy(rel, from, to) {
    const src = read(rel);
    const hits = src.split(from).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + from.slice(0, 70));
    const damaged = src.split(from).join(to);
    assert.notEqual(damaged, src, '破坏必须真的发生');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3370_'));
    const target = path.join(dir, path.dirname(rel), path.basename(rel));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, damaged);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'num-gate.js'), NUM_GATE_STUB);
    fs.copyFileSync(path.join(ROOT, 'config', 'write-receipt.js'), path.join(dir, 'config', 'write-receipt.js'));
    return { target, src: damaged };
}
async function loadDamagedCopy(rel, from, to) {
    const { target, src } = writeDamagedCopy(rel, from, to);
    return { mod: await import(pathToFileURL(target).href), src };
}
const NEG = [
    ['I1 破坏「unknown_key 与 unbound 分开」⇒ 内核判据必须转红', 'd1', 'data', dataProblems, ['unknown-key-not-distinguished']],
    ['I2 破坏「静音是独立一态」⇒ 内核判据必须转红', 'd2', 'data', dataProblems, ['silent-collapsed-into-missing']],
    ['I3 破坏「坏音符如实计数」⇒ 内核判据必须转红', 'd3', 'data', dataProblems, ['bad-note-swallowed']],
    ['I4 破坏「没给与给了 0 不塌成一态」⇒ 内核判据必须转红', 'd4', 'data', dataProblems, ['empty-string-read-as-zero']],
    ['I5 破坏「分享码过校验门」⇒ 内核判据必须转红', 'd5', 'data', dataProblems, ['share-code-keeps-bad-notes']],
    ['I6 破坏「静音与没绑不同形」⇒ 内核判据必须转红', 'd6', 'data', dataProblems, ['silent-plan-not-marked']],
    /* ★ 期望里两条都写：破坏「少一格」时键面**恰好仍能凑齐**（靠 `+=` 现造），
     *   真正被抓住的是那一格成了 `NaN` —— 期望写死一条会把合法判据逼成绕路。 */
    ['I7 破坏「计数表从真源算」⇒ 内核判据必须转红', 'd7', 'data', dataProblems, ['counts-keys-handwritten', 'counts-cell-not-a-number']],
    ['I8 破坏「认源走不吞异常的读法」⇒ 结构面判据必须转红', 'a1', 'app', appReadProblems, ['read-raw-not-used']],
    ['I9 破坏「删配方连带解绑」⇒ 结构面判据必须转红', 'a2', 'app', appDeleteProblems, ['delete-does-not-unbind']],
    ['I10 破坏「换会话必须重取」⇒ 结构面判据必须转红', 'a3', 'app', appChatProblems, ['chat-change-no-refetch']],
    ['I11 破坏「四态配色从真源算」⇒ 视图判据必须转红', 'v1', 'view', viewToneProblems, ['state-tone-handwritten']],
    ['I12 破坏「unknown_key 分开画」⇒ 视图判据必须转红', 'v2', 'view', viewMissingProblems, ['unknown-key-not-drawn']],
    ['I13 破坏「三态人话表取真源计算键」⇒ 视图判据必须转红', 'v3', 'view', viewFaceProblems, ['face-keys-handwritten']],
    ['I14 破坏「App 三态常量取真源」⇒ 结构面判据必须转红', 'a4', 'app', appFaceProblems, ['face-constant-handwritten']],
];
for (const [title, key, kind, judge, expect] of NEG) {
    test(title, async () => {
        const [rel, from, to] = DAMAGE[key];
        if (kind === 'data') {
            const { target: dmgTarget, src: damagedSrc } = writeDamagedCopy(rel, from, to);
            /* ★ 破坏副本按**内容哈希**命名（不是每次新目录）：Node 的 ESM 加载器按 URL 缓存，
             *   同一路径只会加载一次 —— 用 `mkdtemp` 时路径不同所以看不出问题，
             *   但一旦换成固定目录，第二次破坏就会**拿到上一次的模块**（判据测空气）。
             *   这里把哈希写进文件名，既保证内容变了就重新加载，也让缓存键与内容一致。 */
            let hash = 0;
            for (let i = 0; i < damagedSrc.length; i += 1) hash = (hash * 31 + damagedSrc.charCodeAt(i)) | 0;
            const dir = path.join(os.tmpdir(), 'rp_v3370_dmg');
            fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
            fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'config', 'num-gate.js'), NUM_GATE_STUB);
            fs.copyFileSync(path.join(ROOT, 'config', 'write-receipt.js'), path.join(dir, 'config', 'write-receipt.js'));
            const target = path.join(dir, path.dirname(rel), 'h' + (hash >>> 0) + '_' + path.basename(rel));
            fs.writeFileSync(target, damagedSrc);
            const mod = await import(pathToFileURL(target).href);
            const bad = judge(mod);
            /* ★ 期望集为空 = 「这一条破坏必须让判据转红」，具体报哪一条由实现决定；
             *   但**不许一条都不报**（那说明判据面没盖住破坏面）。 */
            if (expect.length) {
                assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                    '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            } else {
                assert.ok(bad.length > 0, '破坏后判据必须至少报一条，实测：（没报）');
            }
            /* 对照：真模块必须干净（否则「转红」可能只是因为判据本来就红 —— 假绿三形之一）。 */
            assert.deepEqual(judge(DAT), [], '对照：真模块必须干净');
        } else {
            const { src } = writeDamagedCopy(rel, from, to);
            const bad = judge(src);
            assert.ok(bad.some((x) => expect.some((e) => x.startsWith(e))),
                '破坏后必须报出 ' + expect.join('/') + '，实测：' + (bad.join(' , ') || '（没报）'));
            assert.deepEqual(judge(read(rel)), [], '对照：真源码必须干净');
        }
    });
}
/* ══════════════════════ J — 判据工具自证 ══════════════════════ */
test('J1 剥注释器两向自证：真注释必须剥掉、字符串里的同形文本必须留住', () => {
    const q = chr96();
    assert.equal(stripComments('a /* 注释里的 fetch( */ b').includes('fetch('), false, '块注释必须剥掉');
    assert.equal(stripComments('a // 注释里的 fetch(\nb').includes('fetch('), false, '行注释必须剥掉');
    assert.equal(stripComments("a = '字符串里的 fetch(';").includes('fetch('), true, '字符串里的同形文本必须留住');
    assert.equal(stripComments('a = ' + q + '模板里的 fetch(' + q + ';').includes('fetch('), true, '模板串里的必须留住');
    assert.equal(stripComments('a = "带 \\" 转义的 fetch(";').includes('fetch('), true, '转义串不许被误断');
    for (const rel of [SK_DATA, SK_APP, SK_VIEW]) {
        const sentinel = stripComments(read(rel) + '\n/* RP_TAIL_3370 */\n');
        assert.equal(sentinel.includes('RP_TAIL_3370'), false, rel + ' 的文件尾注释必须剥得掉（剥器必须复位）');
    }
});
test('J2 破坏表自证：锚点必须在场（恰 1 次）、在代码里、替换必须保真且仍是合法 JS', () => {
    for (const [key, [rel, from, to]] of Object.entries(DAMAGE)) {
        const src = read(rel);
        const hits = src.split(from).length - 1;
        assert.equal(hits, 1, key + ' 的锚点必须恰中 1 次（实测 ' + hits + '）');
        assert.notEqual(from, to, key + ' 的锚点与替换不许相同（否则是装饰）');
        assert.ok(stripComments(src).includes(from), key + ' 的锚点必须落在代码里（不许在注释里）');
        const damaged = src.split(from).join(to);
        assert.equal(damaged.split(from).length - 1, 0, key + ' 替换后不许残留原串');
        assert.ok(damaged.includes(to) || to === '', key + ' 替换后必须出现新串');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3370k_'));
        const f = path.join(dir, 'x' + key + '.mjs');
        fs.writeFileSync(f, damaged);
        const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
        assert.equal(r.status, 0, key + ' 破坏后必须仍是合法 JS：' + (r.stderr || '').split('\n')[0]);
    }
});
test('J3 主线源码本身三件都可解析（判据的输入面不许是坏文件）', () => {
    for (const rel of [SK_DATA, SK_APP, SK_VIEW]) {
        const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
        assert.equal(r.status, 0, rel + ' 必须语法正确：' + (r.stderr || '').split('\n')[0]);
    }
});
test('J4 十道静态门必须在场（含本版两处缺陷所属的那两道）', () => {
    const pkg = JSON.parse(read('package.json'));
    for (const g of ['syntax', 'import-resolve', 'dead-exports', 'lifecycle', 'registry', 'keys',
        'source-derivation', 'bridge-contract', 'weak-coercion', 'upstream-face']) {
        assert.ok(pkg.scripts[g], '门必须在 package.json 里：' + g);
    }
});
/* ══════════════════════ K — 单一真源面 ══════════════════════ */
test('K1 四态表：severity 必须在场且逐态不同（视图靠它上色，不许塌成同一观感）', () => {
    const sev = DAT.SOUNDKIT_STATES.map((s) => s.severity);
    for (const s of DAT.SOUNDKIT_STATES) {
        assert.ok(typeof s.severity === 'string' && s.severity, '每一态必须带 severity：' + s.key);
    }
    assert.equal(new Set(sev).size, 4, '四态的 severity 不许重复（重复就等于四态同色）');
});
test('K2 坏音符原因表：七个键逐条有人话，且与校验门逐条对应', () => {
    assert.equal(DAT.SOUNDKIT_DROP_REASONS.length, 7, '七个原因');
    for (const r of DAT.SOUNDKIT_DROP_REASONS) {
        assert.ok(r.label && r.label !== r.key, '原因必须有人话：' + r.key);
    }
    /* 校验门实际能产出的原因，必须都在表里（表脱节 ⇒ 视图落兜底文本）。 */
    const produced = DAT.sanitizeNotes([
        null,
        { freq: 1, at: 0, dur: 1, type: 'sine', gain: 1 },
        { freq: 880, at: 0, dur: 99, type: 'sine', gain: 1 },
        { freq: 880, at: -1, dur: 1, type: 'sine', gain: 1 },
        { freq: 880, at: 0, dur: 1, type: '锯齿', gain: 1 },
        { freq: 880, at: 0, dur: 1, type: 'sine' },
    ]).reasons;
    const keys = DAT.SOUNDKIT_DROP_REASONS.map((r) => r.key);
    for (const k of Object.keys(produced)) {
        assert.ok(keys.includes(k), '校验门产出的原因必须在表里：' + k);
    }
});
test('K3 波形与槽位表：键面逐条不重复、槽位表覆盖四个去处', () => {
    assert.equal(new Set(DAT.SOUNDKIT_WAVE_KINDS).size, DAT.SOUNDKIT_WAVE_KINDS.length);
    assert.deepEqual([...DAT.SOUNDKIT_WAVE_KINDS], ['sine', 'triangle', 'square', 'sawtooth'],
        '四条波形必须与源的键面一致（createOscillator 的 type）');
    assert.deepEqual(DAT.SOUNDKIT_SLOTS.map((s) => s.key), ['message', 'send', 'tap', 'notice']);
    for (const s of DAT.SOUNDKIT_SLOTS) assert.ok(s.label && s.label !== s.key);
});
test('K4 上限与默认值只有一处（不许在视图或 App 里再写一遍字面量）', () => {
    const viewCode = stripComments(read(SK_VIEW));
    const appCode = stripComments(read(SK_APP));
    /* ★ 判据必须按**上限的身份**去查，不能按裸数字查：视图里有 320×64 的 SVG 画布尺寸、
     *   有 `Math.max(3, …)` 的柱宽下限 —— 那些是**画法**，与数据层的上限无关。
     *   首版用 `\b24\b` / `\b60\b` 裸查，会把 `W - 6` / `H - 16` 之类算式误判成「手写上限」
     *   （判据过宽就是判据写歪）。这里改成查**上限字面量的完整形态**。 */
    for (const bad of ['20000', 'FREQ_MIN = 20', 'MAX_NOTES = 24', 'MAX_RECIPES = 60']) {
        assert.equal(viewCode.includes(bad), false, '视图不许手写上限：' + bad);
    }
    /* 视图画波形时纵轴两端必须从 catalogs().limits 取（本版第三处同族缺陷的守卫）。 */
    assert.ok(viewCode.includes('this.app.catalogs().limits'), '波形纵轴必须取数据层的上下界');
    assert.equal(viewCode.includes('Math.log(20000)'), false, '不许手写纵轴上端');
    /* ★ App 引用上限常量是**对的**（catalogs().limits 就是给视图的那一份读数出口）；
     *   要守的是「App 不许**另写一遍数字**」。首版这条判据写反了 —— 把「正消费」当成了
     *   「手写」（判据写反与判据写歪同罪：都会把真源消费逼成绕路）。
     *   真正的守卫是：上限字面量**只在数据层声明一次**（见下），且视图不出现裸字面量。 */
    assert.ok(appCode.includes('maxNotes: SOUNDKIT_MAX_NOTES'),
        'App 必须把上限**引用**出来（不许另写数字）');
    assert.ok(appCode.includes('SOUNDKIT_DEFAULT_VOLUME'), 'App 必须用默认音量常量');
    /* 上限只在数据层出现一次（真源唯一）。 */
    const dataCode = stripComments(read(SK_DATA));
    assert.equal(dataCode.split('SOUNDKIT_MAX_NOTES = 24').length - 1, 1, '条数上限只能声明一次');
    assert.equal(dataCode.split('SOUNDKIT_FREQ_MAX = 20000').length - 1, 1, '频率上限只能声明一次');
    /* App 里不许出现上限的**数字**（要引用常量，不许抄值）。 */
    for (const lit of ['20000', '= 24', '= 60']) {
        assert.equal(appCode.includes(lit), false, 'App 里不许出现上限字面量：' + lit);
    }
});
test('K5 三态表唯一：数据层声明一次，App 与视图都取它（本版缺陷 ④ 的守卫）', () => {
    const dataCode = stripComments(read(SK_DATA));
    const appCode = stripComments(read(SK_APP));
    const viewCode = stripComments(read(SK_VIEW));
    assert.equal(dataCode.split('SOUNDKIT_FACES = Object.freeze(').length - 1, 1,
        '三态表只能在数据层声明一次');
    assert.ok(dataCode.includes('export const SOUNDKIT_FACES'), '三态表必须导出（两侧都要取它）');
    assert.ok(appCode.includes('const FACE = SOUNDKIT_FACES'), 'App 必须取真源，不许另写一份');
    assert.ok(viewCode.includes('SOUNDKIT_FACES.ok'), '视图必须用计算键（ok 那一态）');
    assert.ok(viewCode.includes('SOUNDKIT_FACES.empty'), '视图必须用计算键（empty 那一态）');
    assert.ok(viewCode.includes('SOUNDKIT_FACES.storage_absent'), '视图必须用计算键（存储不可用那一态）');
    /* 三态的值必须逐态不同（同值就等于三态在数据层先塌成一态）。 */
    const vals = Object.values(DAT.SOUNDKIT_FACES);
    assert.equal(new Set(vals).size, vals.length, '三态的值不许重复');
    assert.equal(vals.length, 3, '取数面是三种处境');
});
/* ══════════════════════ L — 版本锚 ══════════════════════ */
test('L1 版本锚（下限形）+ 四源同版 + update-log 条目在册', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const log = JSON.parse(read('update-log.json'));
    const src = read(INDEX);
    const parts = man.version.split('.').map(Number);
    assert.ok(parts[0] > 3 || (parts[0] === 3 && parts[1] >= 37),
        '本套件成立于 RubyPhone 3.37.0 及以后，当前 ' + man.version);
    assert.equal(pkg.version, man.version, 'package.json 必须与 manifest 同版');
    assert.equal(log.latest, man.version, 'update-log.latest 必须与 manifest 同版');
    assert.equal(log.head, man.version, 'update-log.head 必须与 manifest 同版');
    assert.ok(src.includes("const ST_PHONE_VERSION = '" + man.version + "';"), '入口版本常量必须与 manifest 同版');
    /* ★ 本套件守的是**自己那一版**（v3.37.0 白盒音效盒），不是「当版」——
     *   本仓已有四处「守别人的版」的口径错（v3270 / v3280 / v3290 / v3300）。 */
    const SELF = '3.37.0';
    const cur = (log.versions || {})[SELF];
    assert.ok(cur, 'update-log 必须含本套件所属版本 ' + SELF + ' 的条目');
    assert.ok(Array.isArray(cur.items) && cur.items.length >= 6,
        '本版条目必须写足（items ' + (cur.items ? cur.items.length : 0) + ' 段）');
    const joined = cur.items.join('\n');
    for (const marker of ['音效盒', '合成配方', '四态', '手写', '分享码']) {
        assert.ok(joined.includes(marker), '本版条目必须写到 ' + marker);
    }
});