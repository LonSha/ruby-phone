/* tests/system-v4152.test.mjs — R21-X3 HUD 机制缝入（TavernOS HUD → 手机现场态）
 * 重点：直接导入真实内核，验证块解析、现场态投影、末帧回喂与桥的摄取面。
 * 断言读的是**返回值**，不是源码里有没有某句话 —— 后者会把「写了注释」当「行为对了」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    stripHudBlocks,
    parseHudSnapshot,
    deriveScenePresence,
    latestHudSnapshot,
    hudSnapshotPromptBlock
} from '../apps/memory/hud-bridge-parser.js';
import { LonShaBridge } from '../apps/memory/lonsha-bridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* 一份**形状与上游一致**的最小快照：sc 段七字段 + cs 段人物表。 */
const BLOCK = '[HUD]\n{ "sc": { "T": "21:40", "Dt": "2026-11-15", "L": "旧城区 · 河岸", "Wt": "小雨", "At": "湿冷", "Md": "戒备", "Tw": "有人跟踪" }, "cs": [ { "N": "林昭" }, { "N": "周柠" } ] }\n[/HUD]';
const withBlock = (body) => `正文一句。\n${BLOCK}\n结尾一句。`;

test('v4152 A1. 块解析：缺块/空块/坏块/好块四态如实分开，不抛', () => {
    const absent = parseHudSnapshot('这一楼没有块。');
    assert.equal(absent.state, 'absent');
    assert.equal(absent.snapshot, null);

    const empty = parseHudSnapshot('[HUD]\n   \n[/HUD]');
    assert.equal(empty.state, 'empty', '块在但没数据 ⇒ empty，不是 absent');

    const bad = parseHudSnapshot('[HUD]\n{ "sc": { "L": "河岸" \n[/HUD]');
    assert.equal(bad.state, 'malformed', 'JSON 坏 ⇒ malformed，且不 throw');
    assert.ok(bad.reason, 'malformed 必须带出 reason，否则界面上无法归因');

    const ok = parseHudSnapshot(withBlock());
    assert.equal(ok.state, 'ok');
    assert.equal(ok.snapshot.sc.L, '旧城区 · 河岸');
    assert.equal(ok.format, 'json', '格式如实标记，供诊断面读');
});

test('v4152 A2. 四种书写与实体形态都认，块内提及不被当成块起点', () => {
    [
        '<HUD>\n{"sc":{"L":"甲"}}\n</HUD>',
        '&lt;HUD&gt;\n{"sc":{"L":"甲"}}\n&lt;/HUD&gt;',
        '&#91;HUD&#93;\n{"sc":{"L":"甲"}}\n&#91;/HUD&#93;'
    ].forEach((form) => {
        const res = parseHudSnapshot(form);
        assert.equal(res.state, 'ok', `写法未被识别：${form.slice(0, 12)}`);
        assert.equal(res.snapshot.sc.L, '甲');
    });
    /* 提及 vs 真块：模型在正文里写「最后附 [HUD] 块」，后面才是真块。
     * 若把提及当起点，剥除会把中间正文一起吞掉 —— 上游实测事故，故设此负控制。 */
    const mentioned = '我会在结尾附 [HUD] 块。中间这句是真剧情。\n[HUD]\n{"sc":{"L":"乙"}}\n[/HUD]';
    const res = parseHudSnapshot(mentioned);
    assert.equal(res.state, 'ok');
    assert.equal(res.snapshot.sc.L, '乙', '必须认到真块，而不是被提及带偏');
    const stripped = stripHudBlocks(mentioned);
    assert.ok(stripped.includes('中间这句是真剧情'), '剥除不得吞掉正文');
    assert.ok(!stripped.includes('乙'), '块本体必须被剥掉');
});

test('v4152 A3. 剥除在 JSON 数组形态下仍整块剥干净（通用方括号规则会咬断）', () => {
    const arrBlock = '[HUD]\n{"sc":{"L":"河岸"},"cs":[{"N":"甲"},{"N":"乙"}],"guns":["刀","枪"]}\n[/HUD]';
    const text = `前段。\n${arrBlock}\n后段。`;
    const out = stripHudBlocks(text);
    assert.ok(out.includes('前段') && out.includes('后段'), '正文保留');
    assert.ok(!out.includes('刀') && !out.includes('枪'), '数组内容不得漏进正文');
    assert.ok(!out.includes('"sc"'), '半截 JSON 不得残留');
});

test('v4152 A4. 现场态投影三态：无数据/未知/明确没人，不许合并', () => {
    assert.equal(deriveScenePresence(null), null);
    assert.equal(deriveScenePresence({ sc: {} }), null, '整份无现场字段 ⇒ null，不编空现场');

    const noCast = deriveScenePresence({ sc: { L: '河岸' } });
    assert.equal(noCast.inSceneCharacters, undefined, 'cs 缺席 ⇒ undefined（未知）');

    const emptyCast = deriveScenePresence({ sc: { L: '河岸' }, cs: [] });
    assert.deepEqual(emptyCast.inSceneCharacters, [], 'cs 在但空 ⇒ []（明确没人）');

    const full = deriveScenePresence(parseHudSnapshot(BLOCK).snapshot);
    assert.equal(full.location, '旧城区 · 河岸');
    assert.equal(full.time, '2026-11-15 21:40', '日期与时刻合并成一处读数');
    assert.equal(full.action, '有人跟踪');
    assert.equal(full.tension, '湿冷');
    assert.deepEqual(full.inSceneCharacters, ['林昭', '周柠']);
    assert.equal(full.source, 'hud-block', '归因要能自证来源');
});

test('v4152 A5. 空字段写成 empty 等价于没给，不许当字符串值', () => {
    const res = deriveScenePresence({ sc: { L: 'empty', T: 'empty', Md: '戒备' }, cs: [{ N: 'empty' }] });
    assert.equal(res.location, '', 'empty 不得成为地点');
    assert.equal(res.time, '');
    assert.equal(res.mood, '戒备');
    assert.deepEqual(res.inSceneCharacters, [], 'empty 人名被过滤后是空数组');
});

test('v4152 A6. latestHudSnapshot 只取最后一楼，且跳过我方楼层', () => {
    const chat = [
        { is_user: true, mes: '[HUD]\n{"sc":{"L":"不该取到我"}}\n[/HUD]' },
        { is_user: false, mes: '[HUD]\n{"sc":{"L":"第一楼"}}\n[/HUD]' },
        { is_user: false, mes: '没块的一楼' },
        { is_user: false, mes: '[HUD]\n{"sc":{"L":"最后一楼"}}\n[/HUD]', swipes: ['swipe0', '[HUD]\n{"sc":{"L":"换页后的"}}\n[/HUD]'], swipe_id: 1 }
    ];
    const found = latestHudSnapshot(chat);
    assert.equal(found.state, 'ok');
    assert.equal(found.floor, 3);
    assert.equal(found.snapshot.sc.L, '换页后的', 'swipe 分支以 swipe_id 为准');
    assert.equal(latestHudSnapshot([]).state, 'no-chat');
    assert.equal(latestHudSnapshot(undefined).state, 'no-chat');
});

test('v4152 A7. 回喂块预算三态：full / compact / none，none 时不产文本', () => {
    const snap = parseHudSnapshot(BLOCK).snapshot;
    const full = hudSnapshotPromptBlock(snap);
    assert.equal(full.mode, 'full');
    assert.ok(full.text.includes('旧城区 · 河岸'));
    assert.ok(full.text.includes('以正文为准'), '必须带冲突让位声明，否则模型会拿旧快照改剧情');

    const compact = hudSnapshotPromptBlock(snap, { budgetChars: full.text.length - 10 });
    assert.equal(compact.mode, 'compact', '超预算降档而不是直接丢');
    assert.ok(compact.costChars <= compact.budgetChars);

    const none = hudSnapshotPromptBlock(snap, { budgetChars: 80 });
    assert.equal(none.mode, 'none');
    assert.equal(none.text, '', 'none 必须是空串 —— 写空串会把上一轮槽位清空');

    assert.equal(hudSnapshotPromptBlock(null).mode, 'none');
});

test('v4152 A8. 桥的摄取面：ok 应用、no-block 不动既有现场态', () => {
    const bridge = new LonShaBridge();
    bridge.storage = { get: () => undefined, set: () => true };

    const r1 = bridge.ingestHudFromFloor('这一楼没块。');
    assert.equal(r1.state, 'absent');
    assert.equal(r1.applied, false);
    assert.equal(bridge.getScenePresenceState(), null, '无块时不得写现场态');

    const r2 = bridge.ingestHudFromFloor(BLOCK, { floor: 7, swipe: 0 });
    assert.equal(r2.state, 'ok');
    assert.equal(r2.applied, true);
    const st = bridge.getScenePresenceState();
    assert.equal(st.location, '旧城区 · 河岸');
    assert.ok(st.updatedAt > 0, 'applyScenePresenceState 是唯一写入口，含 updatedAt');

    /* 坏块不得覆盖真状态：半截数据改真状态是这类缝入最危险的形态。 */
    const r3 = bridge.ingestHudFromFloor('[HUD]\n{ "sc": {"L": 破 \n[/HUD]');
    assert.equal(r3.applied, false);
    assert.equal(bridge.getScenePresenceState().location, '旧城区 · 河岸', '坏块不得清掉上一份现场');

    /* 空块同理：空块不是「现场清空」。 */
    bridge.ingestHudFromFloor('[HUD]\n\n[/HUD]');
    assert.equal(bridge.getScenePresenceState().location, '旧城区 · 河岸');
});

test('v4152 A9. 桥的自愈面 refreshHudFromChat 扫历史，返回应用结果', () => {
    const bridge = new LonShaBridge();
    bridge.storage = { get: () => undefined, set: () => true };
    const chat = [
        { is_user: false, mes: '[HUD]\n{"sc":{"L":"旧的"}}\n[/HUD]' },
        { is_user: false, mes: '[HUD]\n{"sc":{"L":"新的"},"cs":[{"N":"甲"}]}\n[/HUD]' }
    ];
    const res = bridge.refreshHudFromChat(chat);
    assert.equal(res.state, 'ok');
    assert.equal(res.floor, 1);
    assert.equal(res.applied, true);
    assert.equal(bridge.getScenePresenceState().location, '新的');
    assert.deepEqual(bridge.getScenePresenceState().inSceneCharacters, ['甲']);

    const none = bridge.refreshHudFromChat([{ is_user: false, mes: '没块' }]);
    assert.equal(none.state, 'absent');
    assert.equal(none.applied, false);
});

test('v4152 A10. 建好没人喂的形态已被闭环：产品侧真有调用方', () => {
    /* 三条判据守的是同一件事 —— 提供方在**产品代码**里，不在 tests 里。
     * 只 import 不调用等于引擎仍在、读数仍假，故断言的是调用点存在。 */
    const idx = read('index.js');
    assert.ok(idx.includes('ingestHudFromFloor(text, { floor: index, swipe: swipeIndex })'),
        '事件面：onMessageReceived 新楼层分支必须摄取 HUD');
    assert.ok(idx.includes('lonshaBridge?.refreshHudFromChat()'),
        '自愈面：生成前必须扫一次历史');
    const ingestAt = idx.indexOf('ingestHudFromFloor(text');
    const recordAt = idx.indexOf("memoryCore?.record?.('ai', text, {}, memMeta)");
    assert.ok(recordAt > 0 && ingestAt > recordAt, '摄取紧接记忆入库之后（同一已清洗层级）');
    const refreshAt = idx.indexOf('refreshHudFromChat()');
    const injectAt = idx.indexOf('applyCoordinatedInjection()');
    assert.ok(refreshAt > 0 && injectAt > refreshAt,
        '自愈面必须在注入前跑完，否则注入读到的是上一轮现场');

    /* 剥除面：必须在 cleanFloorForSummary 之前，且确实在 record 内。 */
    const mem = read('apps/memory/memory-data.js');
    const stripAt = mem.indexOf('content = stripHudBlocks(content)');
    const cleanAt = mem.indexOf('content = cleanFloorForSummary(content)');
    assert.ok(stripAt > 0 && cleanAt > stripAt, 'HUD 剥除必须先于通用清洗');
});

test('v4152 A11. 死方法账本：复活的方法不再登记为死方法', () => {
    const baseline = JSON.parse(read('scripts/dead-method-baseline.json'));
    const rows = Array.isArray(baseline) ? baseline : (baseline.methods || baseline.entries || []);
    const flat = JSON.stringify(baseline);
    /* applyScenePresenceState 现在有产品侧调用方（ingestHudFromFloor / refreshHudFromChat）
     * ⇒ 不得仍在死方法账上。getScenePresenceState 同样已被方法面门按同一口径
     * 处置（本版接线后它仍无产品侧调用方，门禁 --update 的读数就是真源）——
     * 账本与代码一致，比「留一条对照」更硬。 */
    assert.ok(!flat.includes('"applyScenePresenceState"'),
        'applyScenePresenceState 已有提供方却仍登记为死方法 ⇒ 账本与代码不一致');
    assert.ok(rows.length > 0, '账本不得被清空');
    assert.ok(baseline.schema, '账本必须是机器维护的（schema 在场）——手改无来源');
});

test('v4152 A12. 上游署名与「未落地机制」如实登记', () => {
    const src = read('apps/memory/hud-bridge-parser.js');
    assert.ok(src.includes('alewwi'), 'AGPL-3.0 要求保留上游署名');
    assert.ok(src.includes('github.com/alewwi/HUD'), '必须带来源地址');
    /* 第三条机制（差分计量）本仓无可验证落点 ⇒ 不许出现占位实现冒充已完成。 */
    assert.ok(src.includes('未落地面'), '未落地必须显式登记');
    assert.ok(!/export function\s+\w*[Dd]iff\w*(Cost|Meter)/.test(src),
        '不得留下一个空壳差分计量函数假装机制已缝入');
});
