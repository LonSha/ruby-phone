/**
 * tests/r26_x6_health_board.test.mjs — 数据健康看板判据 [R26-X6]
 *
 * A1 损坏优先于增长：既坏又涨 ⇒ broken
 * A2 没有基线 ⇒ unknown，既不判增长也不判正常
 * A3 空面单列 empty，不混进 ok
 * A4 增长阈值可配，且按阈值判 growing / ok
 * A5 阈值非法（≤1）抛错，不许回落默认值
 * A6 面没有 id 直接抛错
 * A7 零损坏零增长 ⇒ ok=true；文案给出各项计数
 * A8 文案点名「要先看的」并给出理由
 * A9 自检为绿
 * A10 产品面接线：index.js 挂载 + 自检进总表
 * N1 破坏副本：先判增长后判损坏 ⇒ 损坏被增长盖住
 * N2 破坏副本：无基线当正常 ⇒ 判不了也报 ok
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_GROWTH_RATIO,
  HEALTH_STATES,
  assessHealth,
  healthBoardSelfCheck,
  healthBoardText,
} from '../config/health-board.js';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config', 'health-board.js'), 'utf8');

const FACES = [
  { id: 'chat', label: '聊天', bytes: 1000, prevBytes: 900 },
  { id: 'media', label: '媒体', bytes: 5000, prevBytes: 1000 },
  { id: 'index', label: '索引', bytes: 10, prevBytes: 10, broken: 2 },
  { id: 'cache', label: '缓存', bytes: 0, prevBytes: 5 },
  { id: 'fresh', label: '新面', bytes: 10 },
];

test('A1 损坏优先于增长', () => {
  const rep = assessHealth([{ id: 'x', bytes: 9000, prevBytes: 1, broken: 1 }]);
  assert.equal(rep.items[0].state, 'broken', '又坏又涨必须先报损坏');
  assert.ok(rep.items[0].reason.includes('损坏'));
  assert.equal(rep.ok, false);
});

test('A2 没有基线 ⇒ unknown', () => {
  const rep = assessHealth([{ id: 'x', bytes: 100 }, { id: 'y', bytes: 100, prevBytes: 0 }]);
  assert.deepEqual(rep.items.map((i) => i.state), ['unknown', 'unknown']);
  assert.ok(rep.items[0].reason.includes('判不了'));
  assert.equal(rep.byState.growing, 0, '没有基线绝不许判增长');
});

test('A3 空面单列 empty', () => {
  const rep = assessHealth([{ id: 'x', bytes: 0, prevBytes: 50 }]);
  assert.equal(rep.items[0].state, 'empty');
  assert.equal(rep.byState.ok, 0, '空面不许混进正常');
});

test('A4 增长阈值可配', () => {
  assert.equal(DEFAULT_GROWTH_RATIO, 1.2);
  const loose = assessHealth([{ id: 'x', bytes: 1300, prevBytes: 1000 }], { growthRatio: 1.5 });
  assert.equal(loose.items[0].state, 'ok', '涨 30% 在 1.5 倍阈值下不算异常');
  const strict = assessHealth([{ id: 'x', bytes: 1300, prevBytes: 1000 }], { growthRatio: 1.25 });
  assert.equal(strict.items[0].state, 'growing');
  assert.ok(strict.items[0].reason.includes('130%'));
});

test('A5 阈值非法抛错', () => {
  assert.throws(() => assessHealth([], { growthRatio: 1 }), /增长阈值/);
  assert.throws(() => assessHealth([], { growthRatio: 0.9 }), /增长阈值/);
  assert.throws(() => assessHealth(null), /面数组/);
});

test('A6 面没有 id 直接抛错', () => {
  assert.throws(() => assessHealth([{ bytes: 1 }]), /必须有 id/);
});

test('A7 零损坏零增长 ⇒ ok', () => {
  const rep = assessHealth(FACES);
  assert.deepEqual([...HEALTH_STATES], ['broken', 'growing', 'empty', 'unknown', 'ok']);
  assert.equal(rep.byState.broken, 1);
  assert.equal(rep.byState.growing, 1);
  assert.equal(rep.byState.empty, 1);
  assert.equal(rep.byState.unknown, 1);
  assert.equal(rep.byState.ok, 1);
  assert.equal(rep.ok, false, '有损坏有增长就不健康');
  const clean = assessHealth([{ id: 'a', bytes: 100, prevBytes: 100 }]);
  assert.equal(clean.ok, true);
});

test('A8 文案点名要先看的并给理由', () => {
  const text = healthBoardText(assessHealth(FACES));
  assert.ok(text.includes('有异常'));
  assert.ok(text.includes('损坏 1'));
  assert.ok(text.includes('异常增长 1'));
  assert.ok(text.includes('媒体'), '异常增长的面要点名');
  assert.ok(text.includes('索引'), '损坏的面要点名');
  assert.ok(text.includes('要先看的'));
  assert.equal(healthBoardText(null), '数据健康：无读数（未体检）');
});

test('A9 自检为绿', () => {
  const r = healthBoardSelfCheck();
  assert.equal(r.ok, true, r.sample);
});

test('A10 产品面接线：index.js 挂载 + 自检进总表', () => {
  const indexSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.match(indexSrc, /import\s*\{[^}]*assessHealth[^}]*\}\s*from\s*'\.\/config\/health-board\.js'/);
  assert.ok(/VirtualPhone\.healthBoard\s*=/.test(indexSrc), '健康看板必须挂诊断面');
  assert.ok(/['"]_r26X6['"]/.test(indexSrc), '自检必须进启动自检总表 _r26X6');
});

/* ------------------------------ 负控制（确定性破坏） ------------------------------ */

async function loadMutant(replacements, tag) {
  let text = SOURCE;
  for (const [from, to] of replacements) {
    assert.ok(text.includes(from), `负控制锚点失效（源变了要同步改判据）：${from}`);
    text = text.split(from).join(to);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rp_x6_${tag}_`));
  const file = path.join(dir, 'health-board.js');
  fs.writeFileSync(file, text, 'utf8');
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

test('N1 破坏：损坏判断失效 ⇒ 又坏又涨被当成增长（证明 A1 靠先判损坏）', async () => {
  const broken = await loadMutant([['if (broken > 0) {', 'if (false && broken > 0) {']], 'brokenlast');
  const rep = broken.assessHealth([{ id: 'x', bytes: 9000, prevBytes: 1, broken: 1 }]);
  assert.equal(rep.items[0].state, 'growing', '破坏后损坏被增长盖住（正说明真实现先判损坏）');
});

test('N2 破坏：无基线当正常 ⇒ 判不了也报 ok', async () => {
  const broken = await loadMutant(
    [["    } else if (prev == null || prev <= 0) {\n      state = 'unknown';\n      reason = '没有上一版读数，判不了增长';", "    } else if (prev == null || prev <= 0) {\n      state = 'ok';\n      reason = '正常';"]],
    'nobaselineok'
  );
  const rep = broken.assessHealth([{ id: 'fresh', bytes: 100 }]);
  assert.equal(rep.items[0].state, 'ok', '破坏后无基线报正常（正说明真实现单列 unknown）');
  assert.equal(rep.ok, true);
});