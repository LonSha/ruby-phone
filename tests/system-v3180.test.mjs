// tests/system-v3180.test.mjs — R-O4：跨 App 内容一致性（单一上下文构建 + 一致性约束块）[v3.18.0]
//
//   取证结论（本仓实跑）：四条内容生成路径各自写了一遍「从末楼往回取 N 条正文」，
//   过滤条件 / 清洗钩子 / 正文裁剪 / 条目格式互不相同。后果不是崩溃，而是
//   **同一件事在各 App 里说法不同**，且四条路径都答不出「现在到底是哪一天」
//   与「这个角色此刻知不知道这件事」。
//
//   覆盖：
//     A 单一收集循环（注入式格式 / 区间 / skipSystem / 上限 / 计数如实 / 不抛）
//     B 两面取齐与三态分形（不猜 / 不推断）
//     C 一致性块三条边界（无日期不写 / 冲突必说 / 零 unaware 不产生空块）
//     D 转述链（三平台同链只算一条 / 无来源标记如实 unknown / 归并不手抄）
//     E 八处路径真消费（建好必须有人用）
//     F 负控制：真源码破坏 → 真副本 → 同款真判据必须转红 → 还原复绿
//     G 版本锚
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CC = await import('../config/context-compose.js');

/** 合成酒馆上下文：一楼一条，含三类必须被跳过的内部消息。 */
function mkCtx(n = 5) {
    const chat = [];
    for (let i = 0; i < n; i += 1) {
        chat.push({ is_user: i % 2 === 0, mes: `第${i}楼正文`, name: i % 2 === 0 ? '用户' : '角色' });
    }
    chat.push({ isGaigaiPrompt: true, mes: '提示词注入' });
    chat.push({ isGaigaiData: true, mes: '数据注入' });
    chat.push({ isPhoneMessage: true, mes: '手机内部消息' });
    return { chat, name1: '用户', name2: '角色' };
}

/* ══════════ A ── 单一收集循环 ══════════ */
test('A1 默认格式：说话人 + 全角半角分隔符由调用方决定，内部消息一律跳过', () => {
    const r = CC.collectRecentChat(mkCtx(3), { limit: 10 });
    assert.equal(r.messages.length, 3, '三类内部消息不得进上下文（实测 ' + r.messages.length + '）');
    assert.equal(r.messages[0].content, '用户: 第0楼正文', '默认格式是「说话人: 正文」（半角冒号）');
    assert.equal(r.messages[0].role, 'user');
    assert.equal(r.messages[1].role, 'assistant');
    assert.ok(r.messages.every((m) => m.isPhoneMessage === true));
    /* 计数如实：扫了 6 条、跳过 3 条、取了 3 条 */
    assert.equal(r.scanned, 6, 'scanned 必须如实（实测 ' + r.scanned + '）');
    assert.equal(r.skipped, 3, 'skipped 必须如实（实测 ' + r.skipped + '）');
    assert.equal(r.taken, 3);
});

test('A2 条目格式由调用方注入 ⇒ 各 App 既有格式零漂移（这是「抽取相同步骤」的前提）', () => {
    const plain = CC.collectRecentChat(mkCtx(3), {
        limit: 10,
        toEntry: ({ msg, text }) => ({ role: msg.is_user ? 'user' : 'assistant', content: text, isPhoneMessage: true })
    });
    assert.equal(plain.messages[0].content, '第0楼正文', '纯正文格式（日记侧既有形制）');
    const full = CC.collectRecentChat(mkCtx(3), {
        limit: 10,
        toEntry: ({ msg, text, userName, charName }) => ({
            role: msg.is_user ? 'user' : 'assistant',
            content: `${msg.is_user ? userName : charName}：${text}`,
            isPhoneMessage: true
        })
    });
    assert.equal(full.messages[0].content, '用户：第0楼正文', '全角冒号（日程侧既有形制）');
});

test('A3 清洗钩子由调用方注入：默认不动原文（不折叠空白），需要折叠才折叠', () => {
    const ctx = { chat: [{ is_user: true, mes: '甲  乙\n丙' }], name1: 'U', name2: 'C' };
    const raw = CC.collectRecentChat(ctx, { limit: 1 });
    assert.equal(raw.messages[0].content, 'U: 甲  乙\n丙', '★ 默认逐字保留（折叠空白会让同一段正文在重构前后面目全非）');
    const squeezed = CC.collectRecentChat(ctx, { limit: 1, squeeze: true });
    assert.equal(squeezed.messages[0].content, 'U: 甲 乙 丙', '显式 squeeze 才折叠');
    const cleaned = CC.collectRecentChat(ctx, { limit: 1, clean: (t) => t.replace(/[甲乙丙]/g, '·') });
    assert.equal(cleaned.messages[0].content, 'U: ·  ·\n·', '清洗钩子被逐条应用');
});

test('A4 区间与方向：默认逆序取最近 N 条，start/end 与 skipSystem 如实生效', () => {
    const r = CC.collectRecentChat(mkCtx(10), { limit: 3 });
    assert.equal(r.messages.length, 3);
    assert.equal(r.messages[2].content, '角色: 第9楼正文', '最后一条必须是末楼（第 9 楼为角色，奇数楼）');
    assert.equal(r.messages[1].content, '用户: 第8楼正文', '逆序取到第 8 楼（偶数楼为用户）');
    assert.equal(r.messages[0].content, '角色: 第7楼正文', '最前一条是第 7 楼（取 3 条）');
    const seg = CC.collectRecentChat(mkCtx(10), { limit: Infinity, start: 2, end: 4 });
    assert.deepEqual(seg.messages.map((m) => m.content), ['用户: 第2楼正文', '角色: 第3楼正文'], '★ 区间取全量且**正序**（日记侧语义：按发生顺序读）');
    const withSys = { chat: [{ role: 'system', mes: 'S' }, { is_user: true, mes: 'U' }], name1: 'u', name2: 'c' };
    assert.equal(CC.collectRecentChat(withSys, { limit: 10 }).messages.length, 2, '默认**不跳** system（微信侧现状）');
    assert.equal(CC.collectRecentChat(withSys, { limit: 10, skipSystem: true }).messages.length, 1, 'skipSystem 时才跳');
});

test('A5 limit / maxChars 归一：不编数、不猜、不抛', () => {
    assert.equal(CC.collectRecentChat(mkCtx(3), { limit: 0 }).messages.length, 0, 'limit 0 ⇒ 不取');
    assert.equal(CC.collectRecentChat(mkCtx(3), { limit: -5 }).messages.length, 0, '负数 ⇒ 不取（不编默认值）');
    assert.equal(CC.collectRecentChat(mkCtx(3), {}).messages.length, 0, '缺省不取（不给隐式默认）');
    assert.equal(CC.collectRecentChat(mkCtx(3), { limit: 99999 }).messages.length, 3, '超大 limit 不越界');
    const long = { chat: [{ is_user: true, mes: 'x'.repeat(100) }], name1: 'U', name2: 'C' };
    assert.equal(CC.collectRecentChat(long, { limit: 1, maxChars: 10 }).messages[0].content, 'U: xxxxxxxxxx',
        'maxChars 裁的是**正文**（前缀不计入）—— 逐字对齐既有实现：先裁正文、再加「说话人: 」');
    for (const bad of [null, undefined, 0, 'x', [], { chat: 'str' }]) {
        assert.doesNotThrow(() => CC.collectRecentChat(bad, { limit: 5 }), '畸形入参不得抛：' + JSON.stringify(bad));
    }
    assert.deepEqual(CC.collectRecentChat(null, { limit: 5 }).messages, [], '畸形入参 ⇒ 空结果（键面恒定）');
});

/* ══════════ B ── 两面取齐 ══════════ */
test('B1 contextFaces：两面一次取齐，全走既有真源（本模块不重算）', () => {
    const f = CC.contextFaces({});
    assert.ok(f.clock && typeof f.clock === 'object', '时间面必须在（键面恒定）');
    assert.equal(f.clock.primary, null, '无宿主 ⇒ primary null（**不是**「今天是某天」）');
    assert.equal(f.clock.primaryDate, null);
    assert.equal(f.clock.conflict, false, '没能比 ⇒ 不得报冲突');
    assert.equal(f.knowledge.state, 'bridge-absent', '无桥 ⇒ 知情面如实归因');
    assert.deepEqual(f.knowledge.people, []);
    assert.equal(f.knowledge.silentCapable, false);
});

test('B2 知情面三态分形：known / unaware / silent 与「一条记录都没有」互不混淆', async () => {
    const win = {
        lonsha_memory_bridge_v1: {
            version: '1',
            mounted: true,
            snapshot: {
                meta: { fieldTypes: { worldProg: { present: true, kind: 'object' } } },
                worldProg: { knowledge: { '甲': { known: ['钟楼在城东'], unaware: [] }, '乙': { known: [], unaware: ['钟楼在城东'] }, '丙': { known: ['别的事'], unaware: [] } } }
            }
        }
    };
    const f = CC.contextFaces(win);
    assert.equal(f.knowledge.state, 'ok', '有面有记录 ⇒ ok（实测 ' + f.knowledge.state + '）');
    assert.equal(f.knowledge.people.length, 3);
    assert.equal(f.knowledge.silentCapable, true, '有一条 unaware ⇒ 有能力回答「谁不知道」');
    /* 三档必须不同形：把 silent 并进 unaware 就是本仓最贵的那类错读数 */
    const KC = await import('../config/knowledge-contract.js');
    const w = KC.whoKnows(f.knowledge.people, '钟楼在城东');
    assert.deepEqual(w.known.map((x) => x.character), ['甲']);
    assert.deepEqual(w.unaware.map((x) => x.character), ['乙']);
    assert.deepEqual(w.silent, ['丙'], '★ 丙有记录但这条事实两边都没记 ⇒ silent');
});

/* ══════════ C ── 一致性块 ══════════ */
test('C1 三源全缺时**不写日期**（不得拿现实时间顶替剧情时间）', () => {
    const blk = CC.consistencyBlock({}, {});
    assert.equal(blk, '', '无任何来源 ⇒ 空块（不产生空块也不编日期）');
    assert.equal(/20\d\d/.test(CC.consistencyBlock({}, { fact: 'x' })), false, '★ 块里不得出现任何年份字面量');
});

test('C2 有日期则写出来；冲突时必须说出来（不得静默选一个）', () => {
    const src = () => ({ date: '3月15日', label: '3月15日', source: 'calendar' });
    const one = CC.consistencyBlock({ VirtualPhone: { calendarApp: { currentStoryDate: src } } }, {});
    assert.ok(one.includes(CC.CONSISTENCY_HEAD), '块抬头必须在场：' + one);
    assert.ok(/当前剧情时刻：3月15日/.test(one), '日期必须如实带出：' + one);
    assert.equal(/互相矛盾/.test(one), false, '只有一源 ⇒ 不得报矛盾');
    /* 冲突：两源都给日期且不同 */
    const win = {
        worldaxis_bridge_v1: {
            version: '1', bridge: 'worldaxis_bridge_v1',
            snapshot: () => ({ worldClock: { iso: '2026-03-15', label: '2026-03-15' } }),
            stat: () => ({ published: true, invalidated: false })
        },
        VirtualPhone: { calendarApp: { currentStoryDate: () => ({ date: '2026年06月01日', source: 'calendar' }) } }
    };
    const bad = CC.consistencyBlock(win, {});
    assert.ok(/互相矛盾/.test(bad), '★ 两源冲突必须显式说出来：' + bad);
});

test('C3 知情约束只列**明确记着**不知道的人；零 unaware ⇒ 不产生空段', () => {
    const win = (kn) => ({
        lonsha_memory_bridge_v1: {
            version: '1', mounted: true,
            snapshot: { meta: { fieldTypes: { worldProg: { present: true, kind: 'object' } } }, worldProg: { knowledge: kn } }
        }
    });
    const withUnaware = CC.consistencyBlock(win({ '乙': { known: [], unaware: ['钟楼在城东'] }, '丙': { known: ['别的'], unaware: [] } }), { fact: '钟楼在城东' });
    assert.ok(/乙/.test(withUnaware), '必须列出明确不知情的乙：' + withUnaware);
    assert.equal(/丙/.test(withUnaware), false, '★ silent（丙）一个字都不进块 —— 把「没记录」写成约束，模型会当事实陈述');
    const noUnaware = CC.consistencyBlock(win({ '丙': { known: ['x'], unaware: [] } }), { fact: '钟楼在城东' });
    assert.equal(noUnaware, '', '零 unaware ⇒ 空块（**不是**「没人不知道」，是「账里没记，问不出来」）');
    assert.equal(CC.consistencyBlock(win({}), { fact: '钟楼在城东' }), '', '无 fact ⇒ 不查（不给空事实造块）');
});

/* ══════════ D ── 转述链 ══════════ */
test('D1 同一件传闻三平台转述 ⇒ **只算同一条来源链**（三个独立证据必须被拆穿）', () => {
    const nodes = [
        { platform: 'worldpulse', sourceId: 'ev1' },
        { platform: 'weibo', sourceId: 'p1', origin: 'worldpulse:ev1' },
        { platform: 'moments', sourceId: 'm1', origin: 'worldpulse:ev1' }
    ];
    const r = CC.retellChains(nodes);
    assert.equal(r.chainCount, 1, '★ 三平台必须归成一条链（实测 ' + r.chainCount + ' 条）');
    assert.equal(r.retoldChains, 1, '被多个平台陈述过的链 ⇒ 1 条');
    assert.deepEqual(r.chains[0].platforms.sort(), ['moments', 'weibo', 'worldpulse'], '来源端点也必须入链（否则链上只剩转述方）');
    assert.ok(/同一条来源链的转述/.test(r.text), '块必须点明这不是多个独立证据：' + r.text);
    assert.ok(/worldpulse:ev1/.test(r.text));
});

test('D2 kind 三态不同形；无来源标记的旧数据如实进 unknown（不硬塞进某条链）', () => {
    assert.equal(CC.retellNode({ id: 'a' }).kind, 'original');
    assert.equal(CC.retellNode({ id: 'a', origin: 'worldpulse:e' }).kind, 'retold');
    assert.equal(CC.retellNode({}).kind, 'unknown');
    assert.equal(CC.retellNode(null).kind, 'unknown');
    assert.equal(CC.retellNode({}).chainId, '', '认不出 ⇒ 没有链名');
    const r = CC.retellChains([{ platform: 'weibo', id: 'p1' }, { nonsense: 1 }]);
    assert.equal(r.unknown, 1, '无来源身份的条目如实计数（不冒充来源）');
    assert.equal(r.retoldChains, 0, '单端链不算「被多处陈述」');
    assert.equal(r.text, '', '无可报的转述 ⇒ 不产生空段');
    /* 不被“多处都在说”骗：两个原件互不相干 ⇒ 两条链、零转述 */
    const two = CC.retellChains([{ platform: 'weibo', id: 'p1' }, { platform: 'moments', id: 'm1' }]);
    assert.equal(two.chainCount, 2);
    assert.equal(two.retoldChains, 0, '★ 两件无关的事各说一次，不得被算成「两处印证」');
});

/* ══════════ E ── 八处路径真消费 ══════════ */
test('E1 收集循环只有一份实现：八处既有路径都改走它（建好必须有人用）', () => {
    const sites = [
        ['apps/wechat/chat-view.js', 1],
        ['apps/wechat/moments-view.js', 1],
        ['apps/weibo/weibo-data.js', 1],
        ['apps/diary/diary-data.js', 1],
        ['apps/calendar/calendar-app.js', 1],
        ['apps/games/common/games-ai-context.js', 1],
        ['apps/phone/phone-view.js', 2]
    ];
    let total = 0;
    for (const [rel, n] of sites) {
        const src = readRel(rel);
        const c = src.split('collectRecentChat(').length - 1;
        assert.equal(c, n, rel + ' 的 collectRecentChat( 调用点应为 ' + n + '（实测 ' + c + '）');
        total += c;
    }
    assert.equal(total, 8, '八处路径全部改走真源（实测 ' + total + '）');
    /* 真源只许一份：不得有人再抄一个循环回来 */
    const cc = readRel('config/context-compose.js');
    assert.equal(cc.split('export function collectRecentChat(').length - 1, 1, '★ 单一实现（本仓「同一口径只许一份实现」）');
});

test('E2 一致性块接进四条内容生成路径（且都走同一份读数）', () => {
    for (const rel of ['apps/wechat/chat-view.js', 'apps/weibo/weibo-data.js', 'apps/diary/diary-data.js', 'apps/worldpulse/worldpulse-app.js']) {
        const src = readRel(rel);
        assert.match(src, /consistencyBlock\(/, rel + ' 必须真调用一致性块');
        assert.match(src, /from '\.\.\/\.\.\/config\/context-compose\.js'/, rel + ' 必须从真源导入（不得自写一块）');
    }
    /* contextFaces 是「取数口」：除真源自己外，只有消费方持有它 */
    const cc = readRel('config/context-compose.js');
    assert.equal(cc.split('export function contextFaces(').length - 1, 1, '★ 取数口唯一');
});

test('E3 转述来路真被写入：世界脉搏推给微博的动态必须带 origin（否则链永远断在转述方）', () => {
    const wp = readRel('apps/worldpulse/worldpulse-app.js');
    assert.match(wp, /origin: `worldpulse:/, '推送时必须带来路');
    assert.match(wp, /_pushToWeibo\(it\.content, it\.style \|\| ev\.style, it\.id\)/, '必须把事件 id 一并带过去（否则来路只能退化到「按风格」）');
    const wb = readRel('apps/weibo/weibo-data.js');
    assert.match(wb, /_retellNodes\(\)/, '微博侧必须真给出转述节点');
    /* ★ 归并规则只许一份：消费方不得自己拼链名 */
    assert.equal(/chainId\s*=/.test(wb), false, '★ 微博侧不得自算链名（那是第二份归并实现）');
    assert.match(wb, /retellNode\(post, \{ platform: 'weibo' \}\)/, '只做取数 + 映射');
});

/* ══════════ F ── 负控制（真源码破坏 → 真副本 → 同款真判据转红 → 还原复绿） ══════════ */
function sandbox() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp_v3180_'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    for (const name of fs.readdirSync(path.join(ROOT, 'config'))) {
        if (name.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'config', name), path.join(dir, 'config', name));
    }
    return dir;
}
function damage(dir, rel, anchor, replacement) {
    const p = path.join(dir, rel);
    const txt = fs.readFileSync(p, 'utf8');
    const hits = txt.split(anchor).length - 1;
    assert.equal(hits, 1, '破坏锚点必须恰中 1 次（实测 ' + hits + '）：' + anchor.slice(0, 60));
    fs.writeFileSync(p, txt.split(anchor).join(replacement));
}

/** 同款判据：把**同一份脚本**跑在指定模块 URL 上，断言不成立即 exit 1。
 *  ★ 纪律（本仓三种假绿的修法）：不许「对原文件断言」、不许把破坏写死成常量、
 *  不许破坏把判据自己删掉 —— 故两侧跑的是**逐字同一段判据**。 */
function judgeWith(url, body) {
    return spawnSync(process.execPath, ['-e', `import(${JSON.stringify(url)}).then(async (m)=>{ const bad = ${body}; if (bad) process.exit(1); })`], { encoding: 'utf8' });
}

/** F1 —— 内部消息必须被跳过（拆掉后同款判据转红） */
test('F1 把「内部消息跳过」拆掉 ⇒ 同款判据必须转红', () => {
    const dir = sandbox();
    const body = `(m.collectRecentChat({chat:[{isGaigaiPrompt:true,mes:'x'},{is_user:true,mes:'y'}]},{limit:5}).messages.length !== 1)`;
    assert.equal(judgeWith(pathToFileURL(path.join(ROOT, 'config', 'context-compose.js')).href, body).status, 0,
        '对照：真源码下内部消息被跳过（同款判据通过）');
    damage(dir, 'config/context-compose.js',
        'if (!msg || msg.isGaigaiPrompt || msg.isGaigaiData || msg.isPhoneMessage) { skipped += 1; continue; }',
        'if (!msg) { skipped += 1; continue; }');
    assert.equal(judgeWith(pathToFileURL(path.join(dir, 'config', 'context-compose.js')).href, body).status, 1,
        '★ 破坏后内部消息进了上下文 ⇒ 同款判据必须转红');
    fs.rmSync(dir, { recursive: true, force: true });
});

/** F2 —— 三源全缺时不得写出日期（拿现实时间顶替后转红） */
test('F2 让三源全缺时写出日期（拿现实时间顶替剧情时间）⇒ 同款判据必须转红', () => {
    const dir = sandbox();
    const body = `(m.consistencyBlock({}, {}) !== '')`;
    assert.equal(judgeWith(pathToFileURL(path.join(ROOT, 'config', 'context-compose.js')).href, body).status, 0,
        '对照：真源码下三源全缺 ⇒ 空块（同款判据通过）');
    damage(dir, 'config/context-compose.js',
        "        if (!parts.length) return '';",
        "        if (!parts.length) return '- 当前剧情时刻：今天';");
    assert.equal(judgeWith(pathToFileURL(path.join(dir, 'config', 'context-compose.js')).href, body).status, 1,
        '★ 破坏后空块被顶替 ⇒ 同款判据必须转红');
    fs.rmSync(dir, { recursive: true, force: true });
});

/** F3 —— 转述必须与原件归同一条链（不再归链后转红） */
test('F3 让转述与原件不再归同一条链 ⇒ 同款判据必须转红', () => {
    const dir = sandbox();
    const body = `(m.retellChains([{platform:'worldpulse',sourceId:'ev1'},{platform:'weibo',sourceId:'p1',origin:'worldpulse:ev1'}]).retoldChains !== 1)`;
    assert.equal(judgeWith(pathToFileURL(path.join(ROOT, 'config', 'context-compose.js')).href, body).status, 0,
        '对照：真源码下两平台归成同一条链（同款判据通过）');
    damage(dir, 'config/context-compose.js',
        "        const chainId = origin || (sourceId ? (platform + ':' + sourceId) : '');",
        "        const chainId = (platform + ':' + sourceId);");
    assert.equal(judgeWith(pathToFileURL(path.join(dir, 'config', 'context-compose.js')).href, body).status, 1,
        '★ 破坏后转述不再归链 ⇒ 同款判据必须转红');
    fs.rmSync(dir, { recursive: true, force: true });
});

/** F4 —— 知情约束不得收入 silent（把 silent 并进 unaware 后转红） */
test('F4 把 silent 并进 unaware（把「没记录」写成事实）⇒ 同款判据必须转红', () => {
    const dir = sandbox();
    const win = `{lonsha_memory_bridge_v1:{version:'1',mounted:true,snapshot:{meta:{fieldTypes:{worldProg:{present:true,kind:'object'}}},worldProg:{knowledge:{'乙':{known:[],unaware:['钟楼在城东']},'丙':{known:['别的'],unaware:[]}}}}}}`;
    const body = `(/丙/.test(m.consistencyBlock(${win}, {fact:'钟楼在城东'})))`;
    assert.equal(judgeWith(pathToFileURL(path.join(ROOT, 'config', 'context-compose.js')).href, body).status, 0,
        '对照：真源码下 silent（丙）一个字都不进块');
    /* 破坏：让 whoKnows 把「有记录但这条事实两边都没记」也算成明确不知情 */
    damage(dir, 'config/knowledge-contract.js',
        "        if (u.matched !== 'none') {",
        "        if (u.matched !== 'none' || (p.knownCount || p.unawareCount)) {");
    assert.equal(judgeWith(pathToFileURL(path.join(dir, 'config', 'context-compose.js')).href, body).status, 1,
        '★ 破坏后 silent 被写成「明确不知情」⇒ 同款判据必须转红');
    fs.rmSync(dir, { recursive: true, force: true });
});

/* ══════════ G ── 版本锚 ══════════ */
test('G1 五源同源（下限形），且当版条目非空', () => {
    const idx = readRel('index.js');
    const man = JSON.parse(readRel('manifest.json'));
    const pkg = JSON.parse(readRel('package.json'));
    const log = JSON.parse(readRel('update-log.json'));
    const mv = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(idx)[1];
    assert.ok(/^3\.(1[89]|[2-9]\d)\./.test(mv), '本套件成立于 RubyPhone 3.18.0 及以后，当前 ' + mv);
    assert.equal(man.version, mv, 'manifest 与入口同源');
    assert.equal(pkg.version, mv, 'package 与 manifest 同源');
    assert.equal(log.latest, mv, 'update-log latest 与 manifest 同源');
    assert.ok(log.versions[mv], 'update-log 必须有当版条目');
    assert.ok(Array.isArray(log.versions[mv].items) && log.versions[mv].items.length >= 4, '当版条目至少 4 条说明');
});
