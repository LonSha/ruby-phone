// tests/r24_o9_cheat_data_split.test.mjs — R24-O9 判据：巨型数据文件治理
// （物理行数 / 同源逐条对拍 / 按需取用调用链 / 未打开时不在内存的真实读数）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NL = String.fromCharCode(10);
let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass += 1; } else { fail += 1; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
function lines(text) { return String(text).split(NL).length; }

// —— 1) 物理行数：巨无霸降到千行以内 ——
const aggPath = path.join(ROOT, 'data', 'cheats.js');
const aggText = fs.readFileSync(aggPath, 'utf8');
const aggLines = lines(aggText);
ok('cheats.js 物理行数 < 1000', aggLines < 1000, '实得 ' + aggLines);

const shardDir = path.join(ROOT, 'data', 'cheats');
const shards = fs.existsSync(shardDir)
    ? fs.readdirSync(shardDir).filter((f) => /^part-\d+\.js$/.test(f)).sort()
    : [];
ok('数据搬进分片（不是删掉了）', shards.length > 0, '分片数 ' + shards.length);
ok('每个分片自己也在千行内', shards.every((f) => lines(fs.readFileSync(path.join(shardDir, f), 'utf8')) < 1000));

// —— 2) 同源逐条对拍：分离前后每包逐字一致（以 git HEAD 的旧文件为基准） ——
const show = spawnSync('git', ['show', 'HEAD:data/cheats.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 80 });
ok('取得到分离前的基准文件', show.status === 0 && String(show.stdout || '').length > 500000, 'stderr=' + String(show.stderr || '').slice(0, 120));

let packCount = 0;
const tmp = path.join(os.tmpdir(), 'r24-o9-baseline-' + process.pid + '.mjs');
if (show.status === 0) {
    fs.writeFileSync(tmp, show.stdout);
    const oldMod = await import('file://' + tmp);
    const newMod = await import('file://' + aggPath);
    packCount = newMod.cheatPacks.length;
    ok('条目数一致', oldMod.cheatPacks.length === newMod.cheatPacks.length, oldMod.cheatPacks.length + ' vs ' + newMod.cheatPacks.length);
    ok('逐包逐字一致（内容零漂移）', JSON.stringify(oldMod.cheatPacks) === JSON.stringify(newMod.cheatPacks));
    ok('id 顺序零重排（id 稳定性铁律）', oldMod.cheatPacks.every((p, i) => p.id === newMod.cheatPacks[i].id));
    ok('分片数常量与磁盘一致', newMod.CHEAT_PART_COUNT === shards.length, newMod.CHEAT_PART_COUNT + ' vs ' + shards.length);
    fs.unlinkSync(tmp);
} else {
    ok('基准文件可用（否则同源对拍无结论）', false);
}

// —— 3) 与轻量索引同源（抽卡侧那一边） ——
const idxMod = await import('file://' + path.join(ROOT, 'data', 'cheat-index.js'));
const indexList = idxMod.cheatIndex || idxMod.cheatIndexList;
const aggMod = await import('file://' + aggPath);
ok('轻量索引可读', Array.isArray(indexList) && indexList.length > 0);
ok('索引与正文条数一致', indexList.length === aggMod.cheatPacks.length, indexList.length + ' vs ' + aggMod.cheatPacks.length);
ok('索引 id 与正文 id 逐条对齐', indexList.every((it, i) => it.id === aggMod.cheatPacks[i].id));
ok('索引字数与正文登记字数对得上', indexList.every((it, i) => it.chars === aggMod.cheatPacks[i].chars));

// —— 4) 按需取用：分页只碰需要的那一片（调用链逐跳可查） ——
const lazy = await import('file://' + path.join(ROOT, 'config', 'cheat-lazy.js'));
const pager = lazy.createCheatPager({});
const p0 = await pager.page(0);
ok('第 0 页可读且满页', p0.ok === true && p0.items.length === lazy.DEFAULT_PAGE_SIZE);
ok('第 0 页只碰第 1 片', p0.partsTouched.join(',') === '1', p0.partsTouched.join(','));
ok('读一页只载一片', pager.stats().partLoads === 1, String(pager.stats().partLoads));
const p1 = await pager.page(1);
ok('第 1 页碰第 2 片', p1.partsTouched.join(',') === '2', p1.partsTouched.join(','));
ok('回翻复用不重载', (await pager.page(0)).ok === true && pager.stats().partLoads === 2, String(pager.stats().partLoads));
const metaOnly = await lazy.listMeta();
ok('元数据路径只读索引', metaOnly.ok === true && metaOnly.count === indexList.length);

// —— 5) 未打开 App 时数据不在内存：真实读数（两个子进程比 heapUsed） ——
function heapOf(code) {
    const f = path.join(os.tmpdir(), 'r24-o9-heap-' + Math.random().toString(36).slice(2) + '.mjs');
    fs.writeFileSync(f, code);
    const r = spawnSync('node', [f], { encoding: 'utf8', timeout: 180000 });
    fs.unlinkSync(f);
    const m = /heapUsed=(\d+)/.exec(String(r.stdout || ''));
    return m ? Number(m[1]) : -1;
}
const rootUrl = 'file://' + ROOT;
const heapMeta = heapOf(
    "const i = await import('" + rootUrl + "/data/cheat-index.js');" + NL
    + "await import('" + rootUrl + "/config/cheat-lazy.js');" + NL
    + "console.log('heapUsed=' + process.memoryUsage().heapUsed + ' n=' + (i.cheatIndex || []).length);"
);
const heapFull = heapOf(
    "const m = await import('" + rootUrl + "/data/cheats.js');" + NL
    + "console.log('heapUsed=' + process.memoryUsage().heapUsed + ' n=' + m.cheatPacks.length);"
);
const heapBase = heapOf("console.log('heapUsed=' + process.memoryUsage().heapUsed);");
ok('三条读数都拿到了', heapBase > 0 && heapMeta > 0 && heapFull > 0, heapBase + ' / ' + heapMeta + ' / ' + heapFull);
// 绝对 heap 里含 Node 自身约 4MB ⇒ 比**增量**：元数据路径的增量不到全量增量的 20%
const dMeta = heapMeta - heapBase;
const dFull = heapFull - heapBase;
ok('全量路径确实把数据拉进了内存', dFull > 2000000, String(dFull));
ok('只看元数据的增量 < 全量增量的 20%', dMeta > 0 && dFull > 0 && dMeta < dFull * 0.2, dMeta + ' / ' + dFull);

// —— 6) 接线 ——
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
ok('接线：import 真进 index.js', idxSrc.includes("from './config/cheat-lazy.js'"));
ok('接线：桥表真登记 _r24O9', idxSrc.includes("'_r24O9'"));

console.log('R24-O9 巨型数据治理：' + pass + ' 通过，' + fail + ' 失败（条目 ' + packCount + '，聚合器 ' + aggLines + ' 行，分片 ' + shards.length + '）');
process.exit(fail > 0 ? 1 : 0);