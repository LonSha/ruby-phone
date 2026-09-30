/**
 * tests/system-v3171.test.mjs — 注入面可选转述（上游 v3.251 M-O3）[契约 v3.0.4][v3.17.1]
 *
 * 面级 INJECTION_FACE_KEYS 仍是 10 键。layer / tokenSource / stages / via
 * 只作可选转述：有则抄、无则 null，不进 faceDrift、不参与 verdict。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyTreeSafe } from './_mirror_tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const at = (rel) => pathToFileURL(path.join(ROOT, rel)).href;
const IC = await import(at('config/injection-contract.js'));

const FACE10 = ['origin', 'outcome', 'round', 'ts', 'tokens', 'chars', 'html', 'total', 'kept', 'blocks'];

function snap(injection) {
    return {
        meta: { fieldTypes: { injection: { present: true, kind: 'object' } } },
        injection
    };
}

function readyInj(over) {
    return {
        origin: 'generation',
        outcome: 'completed',
        round: 2,
        ts: 1000,
        tokens: 10,
        chars: 20,
        html: 'x',
        total: 1,
        kept: 1,
        blocks: [{ ref: 'a', id: 0, label: '块', kept: true, chars: 20, reason: 'kept' }],
        ...over
    };
}

test('A1 面级仍是 10 键，不含可选转述', () => {
    const keys = IC.injectionFaceKeys();
    assert.deepEqual(keys, FACE10);
    assert.equal(keys.includes('layer'), false);
    assert.equal(keys.includes('tokenSource'), false);
    assert.equal(keys.includes('stages'), false);
    assert.equal(keys.includes('via'), false);
});

test('A2 缺席态四格全是 null，不是 0 / 空串', () => {
    const r = IC.readInjection({});
    assert.equal(r.layer, null);
    assert.equal(r.tokenSource, null);
    assert.equal(r.stages, null);
    assert.equal(r.via, null);
    assert.equal(r.reason, 'bridge-absent');
});

test('B1 上游没给可选字段 ⇒ 仍 null，verdict 不受影响', () => {
    const r = IC.readInjection(null, { snapshot: snap(readyInj()) });
    assert.equal(r.reason, 'ready');
    assert.equal(r.verdict, 'injected');
    assert.equal(r.layer, null);
    assert.equal(r.tokenSource, null);
    assert.equal(r.stages, null);
    assert.equal(r.via, null);
    assert.equal(r.faceDrift.includes('layer'), false);
});

test('B2 有则抄：字符串三格 + stages 对象', () => {
    const r = IC.readInjection(null, {
        snapshot: snap(readyInj({
            layer: 'resident',
            tokenSource: 'estimateTextTokens',
            via: 'router',
            stages: { recall: 1, score: 1 }
        }))
    });
    assert.equal(r.layer, 'resident');
    assert.equal(r.tokenSource, 'estimateTextTokens');
    assert.equal(r.via, 'router');
    assert.equal(r.stages && r.stages.recall, 1);
});

test('B3 畸形 stages（数组/字符串）⇒ null，不编空对象', () => {
    const a = IC.readInjection(null, { snapshot: snap(readyInj({ stages: [1, 2] })) });
    assert.equal(a.stages, null);
    const b = IC.readInjection(null, { snapshot: snap(readyInj({ stages: 'five' })) });
    assert.equal(b.stages, null);
    const c = IC.readInjection(null, { snapshot: snap(readyInj({ layer: 3, via: '' })) });
    assert.equal(c.layer, null);
    assert.equal(c.via, null);
});

test('B4 injectionLine 有才写、没有不假装有', () => {
    const silent = IC.injectionLine(IC.readInjection(null, { snapshot: snap(readyInj()) }));
    assert.equal(/层=/.test(silent), false);
    assert.equal(/via=/.test(silent), false);
    const loud = IC.injectionLine(IC.readInjection(null, {
        snapshot: snap(readyInj({ layer: 'trigger', via: 'router', tokenSource: 'host' }))
    }));
    assert.ok(loud.includes('层=trigger'));
    assert.ok(loud.includes('via=router'));
    assert.ok(loud.includes('token口径=host'));
});

test('B5 可选字段不改变零块两义裁定', () => {
    const empty = IC.readInjection(null, {
        snapshot: snap(readyInj({ total: 0, kept: 0, blocks: [], layer: 'resident', via: 'inline' }))
    });
    assert.equal(empty.verdict, 'candidates-empty');
    const dropped = IC.readInjection(null, {
        snapshot: snap(readyInj({
            total: 2, kept: 0,
            blocks: [
                { ref: 'a', id: 0, label: 'a', kept: false, chars: 1, reason: 'dropped-budget' },
                { ref: 'b', id: 1, label: 'b', kept: false, chars: 1, reason: 'dropped-budget' }
            ],
            via: 'router'
        }))
    });
    assert.equal(dropped.verdict, 'all-dropped');
    assert.equal(dropped.via, 'router');
});

/* ══════════ C 负控制（真源码破坏 → 镜像 → **同款真判据**在副本上转红） ══════════ */
const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'v3171-c-'));
let MIRROR = null;
const mirrorRoot = () => {
    if (MIRROR) return MIRROR;
    copyTreeSafe(ROOT, dest + '/root', {
        filter: (p) => !/(\.git|[\/]node_modules|\.sourcematerial)[\/]?/.test(p)
    });
    MIRROR = dest + '/root';
    return MIRROR;
};

function mutateOnce(src, from, to) {
    const n = src.split(from).length - 1;
    assert.equal(n, 1, '锚点应恰好命中 1 次，实际 ' + n + '：' + String(from).slice(0, 80));
    return src.split(from).join(to);
}

/* 判据本体：与 B3 字面同款（'stages 非普通对象 ⇒ 必须 null'）。
 *   写成函数是为了**同一段判据**在原件与破坏副本上各跑一次 —— 两次各写一份就等于没在测同一件事。 */
const stagesJudgment = (r) => {
    if (r.stages !== null) return 'stages 应为 null，实为 ' + JSON.stringify(r.stages).slice(0, 40);
    return null;
};
const loadInj = async (root) => import(pathToFileURL(path.join(root, 'config/injection-contract.js')).href + '?brk=' + Date.now());
const readBad = async (root) => {
    const mod = await loadInj(root);
    return mod.readInjection(null, {
        snapshot: snap(readyInj({ layer: 'resident', tokenSource: 'host', via: 'router', stages: [1, 2] }))
    });
};

test('C0 镜像自身在破坏前全绿（否则负控制是假绿）', async () => {
    const r = await readBad(mirrorRoot());
    assert.equal(stagesJudgment(r), null, '未破坏的镜像上同款判据必须为真');
    assert.equal(r.layer, 'resident', '有则抄：layer 正常入面');
});

test('C1 ★ 破坏「stages 必须为普通对象」⇒ 同款判据必须转红', async () => {
    const root = mirrorRoot();
    const at = path.join(root, 'config/injection-contract.js');
    const broken = mutateOnce(fs.readFileSync(at, 'utf8'),
        'isPlainObject(raw.stages) ? raw.stages : null', 'raw.stages');
    assert.notEqual(broken, fs.readFileSync(at, 'utf8'), '破坏必须真改变源码');
    fs.writeFileSync(at, broken, 'utf8');
    const r = await readBad(root);
    assert.ok(stagesJudgment(r) !== null, '★ 破坏后同款判据必须转红，实际仍绿');
    /* 还原，免得后续用例建在破坏面上 */
    fs.writeFileSync(at, broken.replace('stages: raw.stages,', 'stages: isPlainObject(raw.stages) ? raw.stages : null,'), 'utf8');
    const back = await readBad(root);
    assert.equal(stagesJudgment(back), null, '还原后同款判据必须回绿（证明转红是破坏引起的）');
});

test('C2 ★ 破坏「字符串三格须为非空字符串」⇒ 同款判据必须转红', async () => {
    const root = mirrorRoot();
    const at = path.join(root, 'config/injection-contract.js');
    const before = fs.readFileSync(at, 'utf8');
    const broken = mutateOnce(before,
        "(typeof raw.layer === 'string' && raw.layer) ? raw.layer : null", 'raw.layer');
    fs.writeFileSync(at, broken, 'utf8');
    const mod = await loadInj(root);
    const r = mod.readInjection(null, {
        snapshot: snap(readyInj({ layer: 3, tokenSource: '', via: '' }))
    });
    assert.equal(r.layer, 3, '破坏后非字符串 layer 被原样收下（旧判据已挡不住）');
    fs.writeFileSync(at, before, 'utf8');
    const back = await loadInj(root);
    const rb = back.readInjection(null, { snapshot: snap(readyInj({ layer: 3 })) });
    assert.equal(rb.layer, null, '还原后必须为 null');
});

/* ══════════ D 工具两向自证 ══════════ */
test('D1 变异工具两向自证（锚点不存在 / 不唯一都必须抛）', () => {
    assert.throws(() => mutateOnce('abc', 'zzz', 'x'), /恰好命中 1 次/);
    assert.throws(() => mutateOnce('aa', 'a', 'b'), /恰好命中 1 次/);
    assert.equal(mutateOnce('abc', 'b', 'X'), 'aXc', '真中 1 次时必须替换成功');
});

/* ══════════ E 版本锚 ══════════ */
const VNUM = (s) => String(s).split('.').reduce((a, x) => a * 1000 + Number(x), 0);

test('E1 版本锚（下限形）：三源同源 + 弹窗与 update-log 逐字同源', () => {
    const idx = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const log = JSON.parse(fs.readFileSync(path.join(ROOT, 'update-log.json'), 'utf8'));
    const codeVer = (/const ST_PHONE_VERSION = '([^']+)'/.exec(idx) || [])[1];
    assert.equal(codeVer, man.version, '入口 == manifest');
    assert.equal(pkg.version, man.version, 'package == manifest');
    assert.equal(log.latest, man.version, 'update-log.latest == manifest');
    assert.equal(Object.keys(log.versions)[0], man.version, '当版条目须在首位');
    assert.ok(VNUM(man.version) >= VNUM('3.17.1'), '本套件自 3.17.1 起成立；当前 ' + man.version);
    const m = idx.match(/const ST_PHONE_CURRENT_UPDATE = {[\s\S]*?\n};/);
    assert.ok(m, '公告块可提取');
    const items = log.versions[log.latest].items;
    for (const it of items) assert.ok(m[0].includes(JSON.stringify(it)), '弹窗逐字同源：' + String(it).slice(0, 24));
    assert.match(m[0], new RegExp('date: "' + log.versions[log.latest].date + '"'), 'date 同源');
    /* [v3.18.0 交棒] 原判据把**上一版专有词**（M-O3）当版本锚 —— 抬版即红，且把「本版这件事」
     *  偷换成「上一版那件事」。改写为**形态锚**：本代号与版本落点 + 如实记录（缺陷 / 交棒改写）。 */
    const rel = new RegExp('版本升至 ' + log.latest + '（五源同源）');
    assert.equal(items.some((v) => rel.test(v)), true, '当版条目须点名本版落点（形态锚，不绑上一版专有词）');
    assert.equal(items.some((v) => /自己抓到的缺陷|本版自己抓到|缺陷形态/.test(v)), true,
        '当版条目须如实记录本版自己抓到的缺陷（形态锚）');
    assert.equal(items.some((v) => /交棒改写|主动改写|下限形/.test(v)), true,
        '当版条目须如实记录对旧判据的交棒改写（形态锚）');
});
