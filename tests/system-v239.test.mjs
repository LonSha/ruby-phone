/* ============================================================
 * RubyPhone v2.39.0 —— 群聊发言调度引擎接线
 *
 * 本版问题：apps/wechat/group-scheduler.js 缝合了完整的群聊三 agent 机制
 *   （director 选发言者 / force-speak 强制接管 / critique 导演批判）——
 *   7 个纯函数（matchMemberByName / parseSpeakers / scheduleSpeakers / validateSpeakers /
 *   buildForceSpeakInstruction / buildCritiquePrompt / parseCritique）全部零消费。
 *   群聊回复链路（triggerAI→sendToAI）从不询问「谁该发言」，群聊主流程里
 *   只有成员计数展示、没有任何调度逻辑。这是「数据层就位但 UI/主流程漏接」的第五次出现。
 *
 * 本版修法：WechatData 新增 6 个消费方法：
 *   getGroupMembers / resolveGroupSpeaker / planGroupSpeakers /
 *   buildGroupForceSpeakInstruction / buildGroupCritiquePrompt / parseGroupCritique
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`\u2713 ${name}`); }
    else { fail++; console.log(`\u2717 ${name} ${detail}`); }
};
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const vnum = (s) => {
    const m = /^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(String(s || '').trim());
    return m ? Number(m[1]) * 1000000 + Number(m[2]) * 1000 + Number(m[3]) : NaN;
};

const { WechatData } = await import(path.join(root, 'apps/wechat/wechat-data.js'));
const SCHED = await import(path.join(root, 'apps/wechat/group-scheduler.js'));

const mockStorage = {
    _m: {},
    get(k) { return this._m[k]; },
    set(k, v) { this._m[k] = v; },
    remove(k) { delete this._m[k]; }
};
function makeWD() {
    const wd = new WechatData(mockStorage);
    wd.data.chats = [
        { id: 'g1', name: '\u6d4b\u8bd5\u7fa4', type: 'group', members: ['\u54c8\u5229', '\u8d6b\u654f', '\u7f57\u6069'] },
        { id: 's1', name: '\u5355\u804a', type: 'single', members: [] }
    ];
    return wd;
}

/* ================================================================
 * A. 纯函数层（group-scheduler.js 本体，端到端）
 * ================================================================ */
// A1 matchMemberByName
ok('A1 精确名匹配', SCHED.matchMemberByName('\u54c8\u5229', [{ id: 'h', name: '\u54c8\u5229' }])?.id === 'h');
ok('A1b \u522b\u540d\u5339\u914d', SCHED.matchMemberByName('\u6551\u4e16\u4e3b', [{ id: 'h', name: '\u54c8\u5229', aliases: ['\u6551\u4e16\u4e3b'] }])?.id === 'h');
ok('A1c \u672a\u547d\u4e2d\u8fd4 null', SCHED.matchMemberByName('\u65e0\u4eba', [{ id: 'h', name: '\u54c8\u5229' }]) === null);
ok('A1d \u7a7a\u540d\u8fd4 null', SCHED.matchMemberByName('', [{ id: 'h', name: '\u54c8\u5229' }]) === null);

// A2 parseSpeakers 容错
ok('A2 \u5bf9\u8c61\u5f62\u5f0f', SCHED.parseSpeakers({ speakers: ['A', 'B'] }).speakers.length === 2);
ok('A2b \u5b57\u7b26\u4e32 JSON', SCHED.parseSpeakers('{"speakers":["C"]}').speakers[0] === 'C');
ok('A2c \u5c3e\u9017\u53f7\u5bb9\u9519', SCHED.parseSpeakers('{"speakers":["D",]}').speakers[0] === 'D');
ok('A2d \u88f8\u5b57\u7b26\u4e32', SCHED.parseSpeakers('E').speakers[0] === 'E');
ok('A2e {name} \u5bf9\u8c61\u6570\u7ec4', SCHED.parseSpeakers({ speakers: [{ name: 'F' }] }).speakers[0] === 'F');

// A3 scheduleSpeakers
const members3 = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
const dec3 = SCHED.scheduleSpeakers(['A', 'A', 'B', 'X', 'C'], members3, { maxSpeakers: 3 });
ok('A3 \u53bb\u91cd\u4fdd\u5e8f', dec3.names.join(',') === 'A,B,C');
ok('A3b skipped \u8bb0\u5f55\u672a\u8bc6\u522b', dec3.skipped.includes('X'));
ok('A3c cap maxSpeakers', SCHED.scheduleSpeakers(['A', 'B', 'C'], members3, { maxSpeakers: 2 }).names.length === 2);

// A4 validateSpeakers
const dec4 = SCHED.scheduleSpeakers(['A', 'B'], members3, {});
ok('A4 \u8fc7\u6ee4\u4e0d\u53ef\u7528', SCHED.validateSpeakers(dec4, [{ id: 'a', name: 'A' }]).names.join(',') === 'A');
ok('A4b \u5168\u4e0d\u53ef\u7528\u8fd4 null', SCHED.validateSpeakers(dec4, [{ id: 'z', name: 'Z' }]) === null);
ok('A4c \u7a7a\u51b3\u7b56\u8fd4 null', SCHED.validateSpeakers({ speakers: [], names: [] }, members3) === null);

// A5 buildForceSpeakInstruction
ok('A5 \u4e2d\u6587\u542b\u89d2\u8272\u540d', SCHED.buildForceSpeakInstruction({ name: '\u54c8\u5229' }).includes('\u54c8\u5229'));
ok('A5b \u82f1\u6587\u6a21\u677f', SCHED.buildForceSpeakInstruction({ name: 'Harry' }, { lang: 'en' }).includes('Harry'));
ok('A5c customPrompt \u5360\u4f4d\u7b26', SCHED.buildForceSpeakInstruction({ name: 'X' }, { customPrompt: 'only {charName}' }) === 'only X');

// A6 buildCritiquePrompt / parseCritique
ok('A6 critique prompt \u975e\u7a7a', SCHED.buildCritiquePrompt().length > 100);
ok('A6b parseCritique \u5bf9\u8c61', SCHED.parseCritique('{"directorCritique":{"pacing":"p"}}').directorCritique.pacing === 'p');
ok('A6c parseCritique \u7801\u5757\u5305\u88f9', SCHED.parseCritique('```json\n{"directorCritique":{"pacing":"q"}}\n```').directorCritique.pacing === 'q');
ok('A6d parseCritique \u65e0 JSON \u8fd4 null', SCHED.parseCritique('\u6ca1\u6709JSON') === null);

/* ================================================================
 * B. 数据层消费（WechatData 新方法）
 * ================================================================ */
const wd = makeWD();

// B1 getGroupMembers
const gm = wd.getGroupMembers('g1');
ok('B1 \u7fa4\u6210\u5458\u5f52\u4e00\u5316', gm.length === 3 && gm[0].id === '\u54c8\u5229' && gm[0].name === '\u54c8\u5229');
ok('B1b \u975e\u7fa4\u8fd4\u7a7a', wd.getGroupMembers('s1').length === 0);
ok('B1c \u4e0d\u5b58\u5728\u8fd4\u7a7a', wd.getGroupMembers('nope').length === 0);

// B2 resolveGroupSpeaker
ok('B2 \u6210\u5458\u547d\u4e2d', wd.resolveGroupSpeaker('g1', '\u8d6b\u654f')?.id === '\u8d6b\u654f');
ok('B2b \u672a\u547d\u4e2d null', wd.resolveGroupSpeaker('g1', '\u65e0\u4eba') === null);

// B3 planGroupSpeakers
const plan = wd.planGroupSpeakers('g1', { speakers: ['\u54c8\u5229', '\u8d6b\u654f', '\u4e0d\u5b58\u5728'] }, { maxSpeakers: 2 });
ok('B3 plan ok', plan.ok === true);
ok('B3b names \u53bb\u91cd\u4fdd\u5e8f+cap', plan.names.join(',') === '\u54c8\u5229,\u8d6b\u654f');
ok('B3c skipped \u8bb0\u5f55', plan.skipped.includes('\u4e0d\u5b58\u5728'));
ok('B3d \u975e\u7fa4 no-members', wd.planGroupSpeakers('s1', { speakers: ['A'] }).reason === 'no-members');
ok('B3e \u5168\u975e\u6cd5 no-valid-speakers', wd.planGroupSpeakers('g1', { speakers: ['\u9b3c'] }).reason === 'no-valid-speakers');

// B4 buildGroupForceSpeakInstruction
ok('B4 \u5f3a\u5236\u53d1\u8a00\u542b\u540d', wd.buildGroupForceSpeakInstruction('\u7f57\u6069').includes('\u7f57\u6069'));
ok('B4b \u7a7a\u540d\u4e0d\u629b', typeof wd.buildGroupForceSpeakInstruction('') === 'string');

// B5 buildGroupCritiquePrompt / parseGroupCritique
ok('B5 critique prompt \u975e\u7a7a', wd.buildGroupCritiquePrompt().length > 100);
ok('B5b parseGroupCritique', wd.parseGroupCritique('{"directorCritique":{"pacing":"z"}}').directorCritique.pacing === 'z');
ok('B5c \u65e0\u6548\u8fd4 null', wd.parseGroupCritique('xxx') === null);

/* ================================================================
 * C. 零消费消除（纯函数真被消费）
 * ================================================================ */
const WD_SRC = read('apps/wechat/wechat-data.js');
const SCHED_SRC = read('apps/wechat/group-scheduler.js');
const expectConsumed = ['matchMemberByName', 'parseSpeakers', 'scheduleSpeakers', 'validateSpeakers', 'buildForceSpeakInstruction', 'buildCritiquePrompt', 'parseCritique'];
for (const fn of expectConsumed) {
    const defLine = new RegExp('export\\s+(?:async\\s+)?function\\s+' + fn + '\\b');
    const calls = WD_SRC.split('\\n').filter(l => l.includes(fn) && !defLine.test(l));
    ok('C \u6d88\u8d39 ' + fn, calls.length >= 1, `calls=${calls.length}`);
}

/* ================================================================
 * D. 发布卫生
 * ================================================================ */
const IDX = read('index.js');
const MANIFEST = JSON.parse(read('manifest.json'));
const PKG = JSON.parse(read('package.json'));
const LOG = JSON.parse(read('update-log.json'));
/* [v2.40.0] 交棒：原 D1-D4b 钉死 V=2.39.0，每发一版必翻红。
 * 改为「三源同源 + 不低于本版 + HEAD 自洽」——与本版条目是否仍是 HEAD 无关。 */
const V = '2.39.0';
const idxVer = (/ST_PHONE_VERSION = '([^']+)'/.exec(IDX) || [])[1];
const HEADV = LOG.latest;
ok('D1 三处版本同源', !!idxVer && idxVer === MANIFEST.version && idxVer === PKG.version, `${idxVer}/${MANIFEST.version}/${PKG.version}`);
ok('D2 版本不低于 2.39.0', vnum(idxVer) >= vnum(V), String(idxVer));
ok('D3 package.json 与 manifest 一致', PKG.version === MANIFEST.version, `${PKG.version}/${MANIFEST.version}`);
ok('D4 update-log.latest 指向 versions 头部（自洽）', HEADV === Object.keys(LOG.versions)[0], `${HEADV}`);
ok('D4b latest 不低于 2.39.0', vnum(HEADV) >= vnum(V), String(HEADV));
ok('D4c HEAD 条目数 >= 4', ((LOG.versions[HEADV] || {}).items || []).length >= 4);
const annMatch = /ST_PHONE_CURRENT_UPDATE\s*=\s*\{([\s\S]*?)\n\};/.exec(IDX);
ok('D5 \u516c\u544a\u5757\u5b58\u5728', !!annMatch);
if (annMatch && LOG.versions[HEADV]) {
    const annItems = [...annMatch[1].matchAll(/["'](.*?)["']/g)].map(m => m[1]).filter(s => s.length > 10);
    const logItems = LOG.versions[HEADV].items;
    ok('D5b \u516c\u544a\u6761\u6570\u4e00\u81f4', annItems.length === logItems.length, `ann=${annItems.length} log=${logItems.length}`);
    ok('D5c \u516c\u544a\u9010\u5b57\u540c\u6e90', logItems.every((it, i) => annItems[i] === it));
} else {
    ok('D5b \u516c\u544a\u6761\u6570\u4e00\u81f4', false, 'versions entry missing');
    ok('D5c \u516c\u544a\u9010\u5b57\u540c\u6e90', false, 'versions entry missing');
}

console.log(`\n[v239] ${pass}/${pass + fail} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
