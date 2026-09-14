// group-scheduler.js 单元测试（纯函数）——缝合 GroupWorld 群聊调度机制
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeName, matchMemberByName, parseSpeakers, scheduleSpeakers,
    validateSpeakers, buildForceSpeakInstruction, buildCritiquePrompt, parseCritique
} from '../apps/wechat/group-scheduler.js';

const MEMBERS = [
    { id: 'a1', name: '绫地宁宁', aliases: ['宁宁', 'ningning'], avatar: 'av1' },
    { id: 'a2', name: '常陆茉子', aliases: ['茉子'], avatar: 'av2' },
    { id: 'a3', name: '仮屋和奏', aliases: ['和奏', 'kana'], avatar: 'av3' }
];

test('gs: normalizeName NFKC+去空白+小写', () => {
    assert.equal(normalizeName(' 绫地 宁宁 '), '绫地宁宁');
    assert.equal(normalizeName('ＡＢＣ'), 'abc'); // 全角转半角
    assert.equal(normalizeName(''), '');
    assert.equal(normalizeName(null), '');
});

test('gs: matchMemberByName 精确名/别名/归一', () => {
    assert.equal(matchMemberByName('绫地宁宁', MEMBERS)?.id, 'a1');
    assert.equal(matchMemberByName('宁宁', MEMBERS)?.id, 'a1', '别名命中');
    assert.equal(matchMemberByName(' 绫地 宁宁 ', MEMBERS)?.id, 'a1', '空白归一');
    assert.equal(matchMemberByName('NINGNING', MEMBERS)?.id, 'a1', '别名大小写');
    assert.equal(matchMemberByName('不存在的角色', MEMBERS), null);
});

test('gs: matchMemberByName 包含匹配取最短名优先', () => {
    const m = matchMemberByName('茉子', MEMBERS);
    assert.equal(m?.id, 'a2');
    // 「和」是和奏的子串相关，应中和奏而非误中其它
    const m2 = matchMemberByName('和奏', MEMBERS);
    assert.equal(m2?.id, 'a3');
});

test('gs: parseSpeakers 容错（对象/字符串/带对象元素/裸字符串）', () => {
    assert.deepEqual(parseSpeakers({ speakers: ['宁宁', '茉子'], reason: 'r' }).speakers, ['宁宁', '茉子']);
    assert.deepEqual(parseSpeakers({ speakers: [{ name: '宁宁' }] }).speakers, ['宁宁']);
    assert.deepEqual(parseSpeakers('{"speakers":["和奏"]}').speakers, ['和奏']);
    assert.deepEqual(parseSpeakers('宁宁').speakers, ['宁宁'], '裸名字字符串');
    assert.deepEqual(parseSpeakers('{"speakers":["A",],"reason":"x"}').speakers, ['A'], '尾逗号容错');
    assert.deepEqual(parseSpeakers(null).speakers, []);
});

test('gs: scheduleSpeakers 映射+去重保序+cap', () => {
    const r = scheduleSpeakers(['宁宁', '茉子', '宁宁', '和奏', '路人甲'], MEMBERS, { maxSpeakers: 3 });
    assert.deepEqual(r.names, ['绫地宁宁', '常陆茉子', '仮屋和奏'], '去重+保序+映射回正名');
    assert.deepEqual(r.skipped, ['路人甲'], '未识别名字进 skipped');
    // cap
    const r2 = scheduleSpeakers(['宁宁', '茉子', '和奏'], MEMBERS, { maxSpeakers: 2 });
    assert.equal(r2.speakers.length, 2, 'cap maxSpeakers');
});

test('gs: validateSpeakers 过滤禁用成员', () => {
    const decision = scheduleSpeakers(['宁宁', '茉子', '和奏'], MEMBERS, { maxSpeakers: 3 });
    const enabled = [MEMBERS[0], MEMBERS[2]]; // 茉子被禁用
    const v = validateSpeakers(decision, enabled);
    assert.deepEqual(v.names, ['绫地宁宁', '仮屋和奏'], '禁用成员被过滤且保序');
    assert.equal(validateSpeakers({ speakers: [], names: [] }, enabled), null, '空调度返回null');
    const noneValid = validateSpeakers(scheduleSpeakers(['茉子'], MEMBERS), enabled);
    assert.equal(noneValid, null, '全部禁用返回null');
});

test('gs: buildForceSpeakInstruction 中英模板+自定义', () => {
    const zh = buildForceSpeakInstruction({ name: '宁宁' });
    assert.ok(zh.includes('宁宁') && zh.includes('强制触发'), '中文强制指令');
    const en = buildForceSpeakInstruction({ name: 'Ning' }, { lang: 'en' });
    assert.ok(en.includes('Force-speak') && en.includes('Ning'), '英文强制指令');
    const custom = buildForceSpeakInstruction({ name: 'X' }, { customPrompt: '请 {charName} 发言' });
    assert.equal(custom, '请 X 发言', '自定义模板替换');
});

test('gs: buildCritiquePrompt 双语+parseCritique 容错', () => {
    const zh = buildCritiquePrompt();
    assert.ok(zh.includes('导演') && zh.includes('OOC'), '中文批评模板');
    const en = buildCritiquePrompt({ lang: 'en' });
    assert.ok(en.includes('critique') && en.includes('OOC'), '英文批评模板');
    const parsed = parseCritique('```json\n{"directorCritique":{"pacing":"适中"},"characterCritiques":{"宁宁":{"consistency":"好"}}}\n```');
    assert.equal(parsed.directorCritique.pacing, '适中');
    assert.equal(parsed.characterCritiques['宁宁'].consistency, '好');
    assert.equal(parseCritique('垃圾'), null, '无效输出返回null');
});

test('gs: 端到端（LLM原始输出→调度→校验）', () => {
    const llmRaw = '{"speakers":["宁宁","路人","茉子"],"reason":"话题相关"}';
    const parsed = parseSpeakers(llmRaw);
    const decision = scheduleSpeakers(parsed.speakers, MEMBERS, { maxSpeakers: 3 });
    assert.deepEqual(decision.names, ['绫地宁宁', '常陆茉子']);
    assert.deepEqual(decision.skipped, ['路人']);
    const v = validateSpeakers(decision, MEMBERS);
    assert.equal(v.speakers.length, 2);
});