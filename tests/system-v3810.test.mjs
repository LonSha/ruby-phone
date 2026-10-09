/* ============================================================
 * tests/system-v3810.test.mjs — A6 便携负载纯函数对 + A7 副模型隔离面 [v3.81.0]
 * ------------------------------------------------------------
 * 本版把「A 清单第一刀的收尾两笔」从**纪律**变成**可验收项**：
 *   · A6 `config/portable-payload.js`：魔标校验 + 按内容去重追加（**绝不覆盖**）。
 *     修前实测处境：三处导入（NAI 预设 / GPT 预设 / ComfyUI 工作流）各自 `JSON.parse`
 *     + 各自按**名字**去重 —— 同一份文件导两次就多一份（id 每次新生成、名字又被
 *     `导入2` 规则绕开），错文件（把 GPT 预设喂给 NAI 导入）会被静默吃进来写脏。
 *   · A7 `config/submodel-isolation.js`：副模型「不触发其他插件钩子」的隔离面
 *     收口到单一真源。修前处境：那份隔离**正确**，但它是十个字面量写在
 *     `api-manager.js` 的一个对象里 —— 删掉任意一行，不会有任何东西响，
 *     而后果是**读数方向被改变**（副模型开始回答被注入进去的设定）。
 *
 * 本套件守五件事：
 *   A 结构面：两模块在场、导出面齐备、三处导入共用同一份口径、api-manager 不再手写隔离；
 *   B 行为面：五态解析 / 指纹归一 / 三条去重与**同引用级**的绝不覆盖 / 隔离三态；
 *   C 接线面：真跑**产品路径** —— 真调 `ApiManager._callTavernGenerateRawFallback`
 *             （桩宿主捕获参数 → 判据必须读到 isolated），
 *             并把 settings-app 里那个**真函数体文本**抽出来在沙箱里跑（不是复制品）；
 *   D 负控制：**真源码定点破坏 → 破坏副本 → 在副本上重跑同款判据**（每条一份真源）。
 *             禁止对原文件断言、禁止把破坏写成模拟常量、禁止判据引用破坏锚点字面量；
 *   E 版本锚（下限形，不锚死当版）。
 *
 * 分工：本套件回答「接线对不对、判据会不会真红」；门的读数由
 * `node scripts/check-file.mjs` 汇总（读不到即 exit 2 拒判）。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const mod = async (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const M_PORTABLE = 'config/portable-payload.js';
const M_SUBMODEL = 'config/submodel-isolation.js';
const M_API = 'config/api-manager.js';
const M_JSONREP = 'config/json-symbol-repair.js';
const A_SETTINGS = 'apps/settings/settings-app.js';
const V3800 = 'tests/system-v3800.test.mjs';

const P = await mod(M_PORTABLE);
const S = await mod(M_SUBMODEL);
const J = await mod(M_JSONREP);
const API = await mod(M_API);

/* ══════════════════ 判据函数（负控制必须复用**同一份**） ══════════════════ */

/** A6-① 按内容去重：同一份内容导两次，第二次**一条也不该新增**。 */
function jSecondImportAddsNothing(m) {
    const one = { name: '旧版', fixedPrompt: 'a', fixedPromptEnd: 'b', steps: 20 };
    const again = { name: '旧版', fixedPrompt: 'a', fixedPromptEnd: 'b', steps: 20 };
    const first = m.appendByContent([], [one]);
    if (first.added.length !== 1) return { ok: false, why: '首次导入没加进去：' + first.added.length };
    const second = m.appendByContent(first.list, [again]);
    if (second.added.length !== 0) return { ok: false, why: '同内容二次导入仍新增 ' + second.added.length + ' 条' };
    if (!second.skipped.some((s) => s.reason === 'duplicate-existing')) {
        return { ok: false, why: '跳过原因未分得开：' + JSON.stringify(second.skipped.map((s) => s.reason)) };
    }
    return { ok: true, why: '' };
}

/** A6-② 指纹忽略易变键：`id` / `updatedAt` 不同不构成「另一条」。 */
function jFingerprintIgnoresVolatile(m) {
    const a = { id: 'p1', updatedAt: 1, name: '同一套', steps: 20 };
    const b = { id: 'p2', updatedAt: 2, name: '同一套', steps: 20 };
    if (m.canonicalKeyOf(a) !== m.canonicalKeyOf(b)) return { ok: false, why: '易变键参与了指纹（id/时间戳）' };
    const c = { id: 'p3', updatedAt: 3, name: '另一套', steps: 20 };
    if (m.canonicalKeyOf(a) === m.canonicalKeyOf(c)) return { ok: false, why: '不同内容指纹相同（指纹退化成常量）' };
    /* 键序无关 + 字符串归一：同一件事换个写法仍是同一件事 */
    const d = { steps: 20, name: '同一套' };
    if (m.canonicalKeyOf(d) !== m.canonicalKeyOf({ name: ' 同一套 ', steps: 20 })) {
        return { ok: false, why: '键序/空白折叠未归一' };
    }
    return { ok: true, why: '' };
}

/** A6-③ 绝不覆盖：既有条目必须**逐项同引用**留在结果里。 */
function jNeverOverwrite(m) {
    const keptA = { id: 'k1', name: '用户手调', steps: 33 };
    const keptB = { id: 'k2', name: '用户手调2', steps: 44 };
    const existing = [keptA, keptB];
    const r = m.appendByContent(existing, [{ name: '新来的', steps: 1 }]);
    if (r.kept.length !== 2) return { ok: false, why: '既有条目数变了：' + r.kept.length };
    if (r.kept[0] !== keptA || r.kept[1] !== keptB) return { ok: false, why: '既有条目被换成了新对象（有覆盖的可能）' };
    if (r.list[0] !== keptA || r.list[1] !== keptB) return { ok: false, why: '结果表头两条不是既有对象本身' };
    if (keptA.steps !== 33 || keptB.name !== '用户手调2') return { ok: false, why: '既有条目字段被改写' };
    if (r.list.length !== 3) return { ok: false, why: '结果表长度不对：' + r.list.length };
    return { ok: true, why: '' };
}

/** A6-④ 解析五态各有其形：空 / 非 JSON / 无魔标 / 异类魔标 / 就绪。 */
function jParseFiveStates(m) {
    const expect = ['yuzuki-phone-nai-presets'];
    const empty = m.readPortable('   ', { expect: expect });
    const notJson = m.readPortable('{oops', { expect: expect });
    const unmarked = m.readPortable('{"presets":[{"name":"x"}]}', { expect: expect });
    const foreign = m.readPortable('{"type":"yuzuki-phone-comfyui-workflows","workflows":[]}', { expect: expect });
    const ok = m.readPortable('{"type":"yuzuki-phone-nai-presets","presets":[{"name":"x"}]}', { expect: expect });
    const states = [empty.state, notJson.state, unmarked.state, foreign.state, ok.state];
    if (new Set(states).size !== 5) return { ok: false, why: '五态塌成同一形：' + JSON.stringify(states) };
    if (foreign.accepted !== false) return { ok: false, why: '异类魔标被接受了（错文件会静默写脏）' };
    if (unmarked.accepted !== true) return { ok: false, why: '无魔标的旧文件被拒了（兼容面被砍）' };
    if (ok.accepted !== true || ok.candidates.length !== 1) {
        return { ok: false, why: '就绪态没取出条目：' + JSON.stringify(ok.candidates) };
    }
    if (empty.accepted !== false || notJson.accepted !== false) return { ok: false, why: '空/非 JSON 被接受了' };
    return { ok: true, why: '' };
}

/** A6-⑤ 三态读数互不同形：`added` / `skipped` / `kept` 各占一格。 */
function jLineTriad(m) {
    const existing = [{ name: '旧' }];
    const r = m.appendByContent(existing, [{ name: '新' }, { name: '旧' }, { name: '' }]);
    const line = m.portableLine(r, '预设');
    if (!line.includes('加入 1')) return { ok: false, why: '读数没报加入数：' + line };
    if (!line.includes('保留既有 1')) return { ok: false, why: '读数没报保留数：' + line };
    if (!line.includes('跳过重复 1')) return { ok: false, why: '读数没把重复单独报出来：' + line };
    if (!line.includes('跳过空条目 1')) return { ok: false, why: '读数没把空条目单独报出来：' + line };
    return { ok: true, why: '' };
}

/** A7-① 造出的副模型参数：隔离面全就绪。 */
function jIsolationReady(m) {
    const params = m.buildSubmodelParams({ prompt: [{ role: 'user', content: 'hi' }], maxTokens: 256, useStream: true });
    const j = m.judgeSubmodelIsolation(params);
    if (j.state !== 'isolated') return { ok: false, why: '隔离面不就绪：' + JSON.stringify(j) };
    if (params.quiet !== true || params.skip_save !== true) return { ok: false, why: '静默面没开' };
    if (params.include_world_info !== false) return { ok: false, why: '世界书会注进副模型' };
    if (params.include_jailbreak !== false || params.include_character_card !== false || params.include_names !== false) {
        return { ok: false, why: '上下文面有开着的项' };
    }
    if (params.images.length || params.stop.length || params.stop_sequence.length) return { ok: false, why: '空载面非空' };
    if (params.max_tokens !== 256 || params.length !== 256) return { ok: false, why: '上限两项没同源：' + JSON.stringify(params) };
    return { ok: true, why: '' };
}

/** A7-② 三态互不同形：「写反了」不许被读成「没写」。 */
function jIsolationTriad(m) {
    const ready = m.judgeSubmodelIsolation(m.buildSubmodelParams({ prompt: [], maxTokens: 8 }));
    const leakyParams = m.buildSubmodelParams({ prompt: [], maxTokens: 8 });
    leakyParams.quiet = false;
    const leaky = m.judgeSubmodelIsolation(leakyParams);
    const missingParams = m.buildSubmodelParams({ prompt: [], maxTokens: 8 });
    delete missingParams.include_world_info;
    const missing = m.judgeSubmodelIsolation(missingParams);
    if (new Set([ready.state, leaky.state, missing.state]).size !== 3) {
        return { ok: false, why: '三态塌成一格：' + JSON.stringify([ready.state, leaky.state, missing.state]) };
    }
    if (leaky.state !== 'leaky' || !leaky.leaky.some((x) => x.startsWith('quiet='))) {
        return { ok: false, why: '写反的那一项没被点名：' + JSON.stringify(leaky) };
    }
    if (missing.state !== 'missing' || !missing.missing.includes('include_world_info')) {
        return { ok: false, why: '漏写的那一项没被点名：' + JSON.stringify(missing) };
    }
    if (m.isolationLine(leaky) === m.isolationLine(missing)) return { ok: false, why: '两态的一行读数同形' };
    if (!m.isolationLine(ready).includes('就绪')) return { ok: false, why: '就绪读数没说出来' };
    return { ok: true, why: '' };
}

/* ══════════════════ A 结构面 ══════════════════ */

test('v3810 A1. 两份真源在场，导出面齐备（缺一项即接线未完成）', () => {
    for (const rel of [M_PORTABLE, M_SUBMODEL]) {
        assert.ok(fs.existsSync(path.join(ROOT, rel)), '真源必须在场：' + rel);
    }
    const portable = read(M_PORTABLE);
    for (const name of ['PORTABLE_MARKS', 'PARSE_STATES', 'SKIP_REASONS', 'readPortable',
        'portableCandidates', 'canonicalKeyOf', 'appendByContent', 'portableLine', 'parseStateLine']) {
        assert.match(portable, new RegExp('export (function |const )?' + name + '\\b'),
            M_PORTABLE + ' 缺导出：' + name);
    }
    const submodel = read(M_SUBMODEL);
    for (const name of ['SUBMODEL_ISOLATION_STATES', 'SUBMODEL_SILENCE_FLAGS', 'SUBMODEL_CONTEXT_FLAGS',
        'SUBMODEL_EMPTY_KEYS', 'buildSubmodelParams', 'judgeSubmodelIsolation', 'isolationLine']) {
        assert.match(submodel, new RegExp('export (function |const )?' + name + '\\b'),
            M_SUBMODEL + ' 缺导出：' + name);
    }
});

test('v3810 A2. 三处导入共用同一份魔标真源（字面量不许各写一份）', () => {
    const src = read(A_SETTINGS);
    /* ① 三个魔标字面量已从 App 里撤走（改由 PORTABLE_MARKS 单一真源持有） */
    for (const lit of ['yuzuki-phone-nai-presets', 'yuzuki-phone-gpt-presets', 'yuzuki-phone-comfyui-workflows']) {
        assert.equal(src.includes(lit), false,
            A_SETTINGS + ' 里仍有魔标字面量（应与导出侧共用同一真源）：' + lit);
    }
    /* ② 三处解析都经同一份口径（`readPortablePresetFile` 与其直调两条） */
    const calls = (src.match(/readPortablePresetFile\(|readPortable\(/g) || []).length;
    assert.ok(calls >= 4, '三处导入 + 共用封装应至少 4 处调用同一口径，实测 ' + calls);
    /* ③ 三处 handler 都改走按内容去重追加 */
    const appends = (src.match(/appendByContent\(/g) || []).length;
    assert.ok(appends >= 3, '三处导入都必须走按内容去重追加，实测 ' + appends);
    /* ④ 旧形态（按名字去重 + 直接 push 进 [...existing]）不许残留 */
    assert.equal(/const nextPresets = \[\.\.\.existing\];/.test(src), false,
        '旧的「[...existing] + push」形态仍在（那是按名字去重、同一份文件导两次会多一份）');
    assert.equal(/const nextWorkflows = \[\.\.\.existing\];/.test(src), false,
        'ComfyUI 侧旧的「[...existing] + push」形态仍在');
});

test('v3810 A3. api-manager 不再手写隔离字面量（隔离面只在真源里出现一次）', () => {
    const src = read(M_API);
    assert.match(src, /import \{ buildSubmodelParams, judgeSubmodelIsolation, isolationLine \} from '\.\/submodel-isolation\.js'/,
        'api-manager 必须引用隔离面真源');
    assert.match(src, /const generateParams = buildSubmodelParams\(\{/, '参数必须由真源构造');
    assert.match(src, /judgeSubmodelIsolation\(generateParams\)/, '造完必须自检（纪律要变成机器可读的读数）');
    /* 十个隔离字面量的**赋值形态**不得再出现（注释里提一嘴不算点火，故剥注释后判） */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const line of ['include_world_info: false', 'include_jailbreak: false',
        'include_character_card: false', 'include_names: false', 'skip_save: true']) {
        assert.equal(code.includes(line), false,
            '隔离字面量仍在 api-manager 的就地对象里（应归真源唯一持有）：' + line);
    }
});

test('v3810 A4. v3800 仍在，且本套件不是它的改写（追加式产物的口径守卫）', () => {
    assert.ok(fs.existsSync(path.join(ROOT, V3800)), V3800 + ' 必须仍在场（第一刀的前五笔由它守）');
    /* 「不是改写」的判据要能两向成立：只查「本文件不含 v3800 用例名」会**自我指涉**
     *  （本文件里写下那个名字就是为了查它 —— 写下即判红）。故改为查**跨文件事实**：
     *  v3800 的用例名只许出现在 v3800 自己那份文件里，本套件用自己的一套编号。 */
    const mine = read('tests/system-v3810.test.mjs');
    /* 编号面只取 `test('vNNNN Xn.` 这种**用例声明行**（初版按全文扫，把本用例里
     *  引用的旧版用例名也算进来了 —— 判据的输入面必须等于它要回答的那件事）。 */
    const ids = (mine.match(/^test\('v(\d{4}) [A-E]\d\./gm) || []).map((s) => s.match(/v(\d{4})/)[1]);
    assert.ok(ids.length >= 10, '本套件必须有自己的用例编号面：' + ids.length);
    assert.equal(ids.every((x) => x === '3810'), true, '本套件的用例编号必须全部属于本版：' + ids.join(','));
    const old = 'v' + '3800' + ' D5\\.';
    assert.match(read(V3800), new RegExp(old), 'v3800 的负控制必须仍在（它守的是第一刀的五份真源）');
});

/* ══════════════════ B 行为面 ══════════════════ */

test('v3810 B1. A6 去重 / 指纹 / 绝不覆盖 / 五态 / 三态读数', () => {
    for (const [name, fn] of [['二次导入零新增', jSecondImportAddsNothing], ['指纹忽略易变键', jFingerprintIgnoresVolatile],
        ['绝不覆盖', jNeverOverwrite], ['解析五态', jParseFiveStates], ['读数三态', jLineTriad]]) {
        const r = fn(P);
        assert.equal(r.ok, true, 'A6 判据「' + name + '」不成立：' + r.why);
    }
});

test('v3810 B2. A6 同批重复与裸对象：一条口径覆盖两种入口形态', () => {
    /* 同一批里自带两条同内容：第二条必须报「同批重复」，不许两条都进 */
    const r = P.appendByContent([], [{ name: 'x', steps: 1 }, { name: 'X', steps: 1 }]);
    assert.equal(r.added.length, 1, '同批同内容（大小写/空白折叠后）应只加一条：' + JSON.stringify(r.added));
    assert.ok(r.skipped.some((s) => s.reason === 'duplicate-incoming'), '同批重复必须单独成形');
    /* ComfyUI 那种「直接粘一份 API Format」的裸对象入口 */
    const single = P.readPortable('{"3":{"class_type":"KSampler"}}', { singleObject: true });
    assert.equal(single.candidates.length, 1, '裸对象必须被当成一条（否则粘 API Format 会导入 0 条）');
    const strict = P.readPortable('{"3":{"class_type":"KSampler"}}', {});
    assert.equal(strict.candidates.length, 0, '不给 singleObject 时裸对象不该被当成条目');
});

test('v3810 B3. A7 隔离面就绪与三态互不同形', () => {
    const a = jIsolationReady(S);
    assert.equal(a.ok, true, 'A7 就绪判据不成立：' + a.why);
    const b = jIsolationTriad(S);
    assert.equal(b.ok, true, 'A7 三态判据不成立：' + b.why);
});

/* ══════════════════ C 接线面（真跑产品路径） ══════════════════ */

test('v3810 C1. A7 接线：真调 ApiManager 的副模型兜底，桩宿主捕获的参数必须判为就绪', async () => {
    let captured = null;
    const saved = globalThis.SillyTavern;
    globalThis.SillyTavern = {
        getContext: () => ({
            generateRaw: async (payload) => { captured = payload; return '副模型输出'; }
        })
    };
    try {
        const am = new API.ApiManager({ get: () => null, set: () => {}, remove: () => {} });
        const res = await am._callTavernGenerateRawFallback([{ role: 'user', content: '把这一天写成日记' }], 256, {}, null, true);
        assert.equal(res.success, true, '兜底调用应成功：' + JSON.stringify(res));
        assert.ok(captured && typeof captured === 'object', '桩宿主必须收到参数对象');
        const judged = S.judgeSubmodelIsolation(captured);
        assert.equal(judged.state, 'isolated',
            '产品路径发出的副模型参数隔离面不就绪：' + JSON.stringify(judged));
        assert.equal(captured.prompt[0].content, '把这一天写成日记', '正文必须原样带过去（隔离不该改动请求内容）');
        assert.equal(captured.max_tokens, 256, '上限必须真的传下去');
    } finally {
        if (saved === undefined) delete globalThis.SillyTavern; else globalThis.SillyTavern = saved;
    }
});

test('v3810 C2. A6 接线：settings-app 里那份**真函数体**在沙箱里跑，认魔标/拒绝异类/容错解析', () => {
    const src = read(A_SETTINGS);
    /* 从真源码里**抽取**函数体（不是复制品）：破坏源码即转红 —— 这正是接线判据该有的样子。 */
    const marker = 'const readPortablePresetFile = (rawText, expectMark, label) => {';
    const at = src.indexOf(marker);
    assert.ok(at > 0, 'settings-app 里找不到共用的便携读取封装：' + marker);
    let depth = 0;
    let end = -1;
    for (let i = src.indexOf('{', at); i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
    }
    assert.ok(end > 0, '封装体没配平（抽取失败）');
    const block = src.slice(at, end) + ';';
    const parseTolerant = (text) => {
        /* ★ 真源码里那份封装期望注入的是 `parseJsonTolerant` **本体**（它自己解 .ok/.value）；
         *  初版夹具在这里多解了一层 —— 于是封装把「已解开的负载」当成结果对象读 `.ok`
         *  （`undefined` ⇒ `!undefined` 为真）而抛「不是有效 JSON」。
         *  这正是本仓登记过的『判据自身偏差』形态，故夹具改为**转发本体**、不再自行解包。 */
        return J.parseJsonTolerant(text);
    };
    const make = new Function('readPortable', 'parseJsonTolerant', 'parseStateLine',
        block + '\nreturn readPortablePresetFile;');
    const fn = make(P.readPortable, parseTolerant, P.parseStateLine);
    /* ① 就绪：自己导出的 NAI 文件必须被认 */
    const mine = JSON.stringify({ type: P.PORTABLE_MARKS.NAI_PRESETS, version: 1, presets: [{ name: 'A' }] });
    assert.equal(fn(mine, P.PORTABLE_MARKS.NAI_PRESETS, 'NAI 预设').length, 1, '自己导出的文件必须认得出');
    /* ② 异类魔标必须**明确拒绝**（错文件不许静默写脏） */
    const foreign = JSON.stringify({ type: P.PORTABLE_MARKS.COMFYUI_WORKFLOWS, workflows: [{ name: 'w' }] });
    assert.throws(() => fn(foreign, P.PORTABLE_MARKS.NAI_PRESETS, 'NAI 预设'),
        /魔标不属于此类/, '异类魔标必须抛错并说明原因');
    /* ③ 旧文件（无魔标）仍要接受：兼容面不许被砍 */
    const legacy = JSON.stringify({ presets: [{ name: '旧版' }, { name: '旧版2' }] });
    assert.equal(fn(legacy, P.PORTABLE_MARKS.NAI_PRESETS, 'NAI 预设').length, 2, '无魔标的旧文件必须照收');
    /* ④ 容错解析确实接上了（尾逗号是实测最常见的形态） */
    const tolerant = '{"presets":[{"name":"尾逗号"},]}';
    assert.equal(fn(tolerant, P.PORTABLE_MARKS.NAI_PRESETS, 'NAI 预设').length, 1, '容错解析没接上（尾逗号被拒）');
    /* ⑤ 空文件与坏文件的一行读数必须**不同形** */
    assert.equal(P.parseStateLine('empty'), '文件内容为空');
    assert.notEqual(P.parseStateLine('empty'), P.parseStateLine('not-json'), '空与坏必须不同形');
});

/* ══════════════════ D 负控制（真源码破坏 → 破坏副本 → 同款判据） ══════════════════
 * 纪律（本仓反复点名）：
 *   ① 破坏必须在**真源码**上发生（锚点恰中 1 次，否则 assert 失败 = 判据自己坏了）；
 *   ② 判据必须跑在**破坏副本**上，而不是对原文件断言；
 *   ③ 判据函数里不得出现破坏锚点的字面量（否则是自我指涉）；
 *   ④ 破坏必须**可观测**（改到产品真会走到的分支，否则是装饰破坏）。 */
const NEG_SUFFIX = '.__neg__.js';
const madeFiles = [];
function negCopy(rel, mutate) {
    const srcAbs = path.join(ROOT, rel);
    const dstRel = rel.replace(/\.js$/, NEG_SUFFIX);
    const dstAbs = path.join(ROOT, dstRel);
    const src = fs.readFileSync(srcAbs, 'utf8');
    const next = mutate(src);
    assert.notEqual(next, src, '破坏没有真正发生（锚点未命中）：' + rel);
    fs.writeFileSync(dstAbs, next);
    madeFiles.push(dstAbs);
    return import(pathToFileURL(dstAbs).href + '?neg=' + Date.now());
}
process.on('exit', () => {
    for (const f of madeFiles) { try { fs.rmSync(f); } catch (_e) { /* 忽略 */ } }
});

test('v3810 D1. 拆掉「按内容去重」的既有面（existingKeys 恒空）⇒ 二次导入零新增判据必须转红', async () => {
    const neg = await negCopy(M_PORTABLE, (s) => {
        const anchor = 'if (key) existingKeys.add(key);';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '/* neg: 既有面不再参与去重 */ if (key) { /* 不登记 */ }');
    });
    const good = jSecondImportAddsNothing(P);
    assert.equal(good.ok, true, '原版必须真过（否则破坏无意义）：' + good.why);
    const broke = jSecondImportAddsNothing(neg);
    assert.equal(broke.ok, false, '去重门被拆掉后「二次导入零新增」必须转红');
});

test('v3810 D2. 拆掉「易变键不进指纹」⇒ 指纹归一判据必须转红', async () => {
    const neg = await negCopy(M_PORTABLE, (s) => {
        const anchor = "const DEFAULT_IGNORE_KEYS = Object.freeze(['id', 'updatedAt', 'exportedAt', 'app']);";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, 'const DEFAULT_IGNORE_KEYS = Object.freeze([]);');
    });
    const good = jFingerprintIgnoresVolatile(P);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jFingerprintIgnoresVolatile(neg);
    assert.equal(broke.ok, false, '易变键进入指纹之后归一判据必须转红');
});

test('v3810 D3. 让既有条目被新对象顶掉（覆盖）⇒ 绝不覆盖判据必须转红', async () => {
    const neg = await negCopy(M_PORTABLE, (s) => {
        const anchor = '    const next = base.slice();';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        /* 破坏：结果表不再是既有对象的原样延续，而是浅拷贝的新对象 —— `===` 立刻可辨。 */
        return s.replace(anchor, '    const next = base.map((x) => Object.assign({}, x));');
    });
    const good = jNeverOverwrite(P);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jNeverOverwrite(neg);
    assert.equal(broke.ok, false, '既有条目被顶掉之后「绝不覆盖」判据必须转红');
});

test('v3810 D4. 把「异类魔标」并进「无魔标」（照样接受）⇒ 五态判据必须转红', async () => {
    const neg = await negCopy(M_PORTABLE, (s) => {
        const anchor = "        state = PARSE_STATES.FOREIGN;";
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, "        state = PARSE_STATES.UNMARKED;");
    });
    const good = jParseFiveStates(P);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jParseFiveStates(neg);
    assert.equal(broke.ok, false, '错文件被照收之后五态判据必须转红');
});

test('v3810 D5. 把世界书注入打开（隔离面写反）⇒ 就绪判据必须转红', async () => {
    const neg = await negCopy(M_SUBMODEL, (s) => {
        const anchor = '        include_world_info: false,';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '        include_world_info: true,');
    });
    const good = jIsolationReady(S);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jIsolationReady(neg);
    assert.equal(broke.ok, false, '世界书注入被打开后「隔离就绪」判据必须转红（否则它测的不是这件事）');
});

test('v3810 D6. 把「写反了」伪装成「没写」（越界并进缺席）⇒ 三态判据必须转红', async () => {
    const neg = await negCopy(M_SUBMODEL, (s) => {
        const anchor = '    if (leaky.length) state = SUBMODEL_ISOLATION_STATES.LEAKY;';
        assert.equal(s.split(anchor).length - 1, 1, '锚点必须恰中 1 次');
        return s.replace(anchor, '    if (false) state = SUBMODEL_ISOLATION_STATES.LEAKY;');
    });
    const good = jIsolationTriad(S);
    assert.equal(good.ok, true, '原版必须真过：' + good.why);
    const broke = jIsolationTriad(neg);
    assert.equal(broke.ok, false, '「写反」被读成「没写」之后三态判据必须转红');
});

/* ══════════════════ E 版本锚（下限形） ══════════════════ */

test('v3810 E1. 版本锚（下限形）：五源同源且不低于 3.81.0', () => {
    const man = JSON.parse(read('manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const idx = read('index.js');
    const log = JSON.parse(read('update-log.json'));
    const m = /const ST_PHONE_VERSION = '([0-9.]+)'/.exec(idx);
    assert.ok(m, 'index.js 必须仍有版本常量');
    const nums = [man.version, pkg.version, m[1], log.latest, log.head].map(String);
    assert.equal(new Set(nums).size, 1, '五源版本必须同源：' + nums.join(' / '));
    const cmp = (a, b) => {
        const x = String(a).split('.').map(Number);
        const y = String(b).split('.').map(Number);
        for (let i = 0; i < 3; i += 1) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
        return 0;
    };
    assert.ok(cmp(nums[0], '3.81.0') >= 0, '版本不得低于 3.81.0（本版是它的接线版）：' + nums[0]);
    const entry = log.versions && log.versions[log.latest];
    assert.ok(entry, '当版条目必须在 update-log 里');
});
