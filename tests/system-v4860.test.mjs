/* ============================================================
 * tests/system-v4860.test.mjs — v4.86.0 生理繁育与精方档案全量缝入
 * 算法移植自 Liuuuu54/st_bs_biotracker v1.2.0 (Commit c2794dd)
 * ------------------------------------------------------------
 * 判据分六面：
 *   A 面 版本锚与结构自证
 *   B 面 81 物种生理字典、核型与繁简归一 (bio-races / race-names)
 *   C 面 7 级个体体型与体型契合度 (body-size)
 *   D 面 精方档案与精子品质调控 (sires-core)
 *   E 面 性爱记录、半衰期衰减与经产扩张 (intimacy-core)
 *   F 面 子宫精液容量与健康数据接线 (semen-capacity / health-data)
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(rel(p), 'utf8');
const BORN_V = '4.86.0';

function vnum(v) {
  return v.split('.').map(Number).reduce((a, b, i) => a + b * Math.pow(100, 2 - i), 0);
}

// 导入待测核心模块
import {
  ALL_BUILTIN_RACES,
  DERIVED_TYPE_RACES,
  canonicalizeRaceName,
  getEmbryoTypeByRace,
  getRaceInheritanceMode,
} from '../apps/health/bio-races.js';
import { toSimplifiedName, toTraditionalName } from '../apps/health/race-names.js';
import {
  clampIndividualBodySize,
  getUterusVolumeFactor,
  describeBodySizeFit,
  getConceptionStageWeight,
  resolveConceptionWeightRatio,
  resolveBodySize,
} from '../apps/health/body-size.js';
import {
  createEmptySires,
  upsertSireRecord,
  getSireRecord,
  normalizeSpermQuality,
  getSpermQualityFactors,
  describeSpermQuality,
} from '../apps/health/sires-core.js';
import {
  getSheathStretch,
  getCompatMultiplier,
  recordIntimacyInsert,
  recordIntimacySemen,
  getIntimacyRanking,
  formatIntimacyPromptLine,
} from '../apps/health/intimacy-core.js';
import {
  getSemenCapacity,
  getProfileSemenCapacity,
} from '../apps/health/semen-capacity.js';
import { HealthData } from '../apps/health/health-data.js';

/* ============================================================ */
/* A 面：版本锚与结构自证                                       */
/* ============================================================ */
const vnumCmp = (a, b) => { const A = a.split('.').map(Number), B = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (A[i] !== B[i]) return A[i] - B[i]; } return 0; };
test('A1: manifest.json 与 package.json 版本 >= BORN_V（下限形交棒）', () => {
  const man = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  assert.ok(vnumCmp(man.version, BORN_V) >= 0, 'manifest 版本 ' + man.version + ' < ' + BORN_V);
  assert.ok(vnumCmp(pkg.version, BORN_V) >= 0, 'package 版本 ' + pkg.version + ' < ' + BORN_V);
});

test('A2: update-log.json latest 指针与版本条目完整（下限形交棒）', () => {
  const log = JSON.parse(read('update-log.json'));
  assert.ok(vnumCmp(log.latest, BORN_V) >= 0, 'update-log latest ' + log.latest + ' < ' + BORN_V);
  assert.ok(log.versions[BORN_V], '必须存在 4.86.0 版本条目');
  assert.ok(Array.isArray(log.versions[BORN_V].items), '条目 items 必须为数组');
  assert.ok(log.versions[BORN_V].items.length >= 3, '4.86.0 至少记录 3 项技术改动');
});

/* ============================================================ */
/* B 面：81 物种字典、核型与繁简归一                             */
/* ============================================================ */
test('B1: 81 个内置物种全量登记且支持 13 类衍生类型', () => {
  assert.equal(ALL_BUILTIN_RACES.length, 81, '必须包含 81 个内置种族');
  assert.equal(DERIVED_TYPE_RACES.length, 13, '必须包含 13 类衍生类型');
  assert.ok(DERIVED_TYPE_RACES.includes('咒缚'), '衍生类型必须包含新增的「咒缚」');
  assert.ok(ALL_BUILTIN_RACES.includes('米诺陶族'), '包含米诺陶族');
  assert.ok(ALL_BUILTIN_RACES.includes('海德拉'), '包含海德拉');
  assert.ok(ALL_BUILTIN_RACES.includes('核焰族'), '包含核焰族');
});

test('B2: 繁简体名称互转映射双向健全', () => {
  assert.equal(toSimplifiedName('精靈'), '精灵');
  assert.equal(toSimplifiedName('史萊姆'), '史莱姆');
  assert.equal(toSimplifiedName('半龍人'), '半龙人');
  assert.equal(toTraditionalName('人类'), '人類');
  assert.equal(toTraditionalName('人类'), '人類');
  assert.equal(canonicalizeRaceName('精靈'), '精灵');
});

test('B3: 核型遗传模式正确区分母系、父系与一般', () => {
  assert.equal(getRaceInheritanceMode('媚魔'), 'maternal', '媚魔为雌核母系');
  assert.equal(getRaceInheritanceMode('哥布林'), 'paternal', '哥布林为雄核父系');
  assert.equal(getRaceInheritanceMode('人类'), 'normal', '人类为一般核型');
});

/* ============================================================ */
/* C 面：7 级个体体型与体型契合度                                 */
/* ============================================================ */
test('C1: 个体体型限定在 1 ~ 7 级，子宫容积倍率以 4 级为基准', () => {
  assert.equal(clampIndividualBodySize(4), 4);
  assert.equal(clampIndividualBodySize(0), 1);
  assert.equal(clampIndividualBodySize(99), 7);
  assert.equal(getUterusVolumeFactor({ bodySize: 4 }), 1, '4 级为 1 倍');
  assert.equal(getUterusVolumeFactor({ bodySize: 5 }), 2, '5 级为 2 倍');
  assert.equal(getUterusVolumeFactor({ bodySize: 3 }), 0.5, '3 级为 0.5 倍');
});

test('C2: 体型契合度判定：同体型与跨级差距描述正确', () => {
  const f = resolveBodySize({ bodySize: 4 });
  const mSame = resolveBodySize({ bodySize: 4 });
  const mBig = resolveBodySize({ bodySize: 7 });
  const fitSame = describeBodySizeFit({ female: f, male: mSame });
  assert.equal(fitSame.gap, 0);
  assert.equal(fitSame.label, '恰好契合');

  const fitBig = describeBodySizeFit({ female: f, male: mBig });
  assert.equal(fitBig.gap, 3);
  assert.equal(fitBig.label, '极不相称');
  assert.equal(getCompatMultiplier(fitBig), 0, '相差 >= 2.5 倍率为 0');
});

test('C3: 受精胎重阶段基准与体型差加权', () => {
  assert.equal(getConceptionStageWeight('排卵期'), 1.0);
  assert.equal(getConceptionStageWeight('黄体期'), 1.1);
  const { ratio } = resolveConceptionWeightRatio({ bodySize: 4 }, { bodySize: 6 });
  assert.ok(ratio > 1.0, '精方体型大于母方时胎重比例大于 1');
});

/* ============================================================ */
/* D 面：精方档案与精子品质调控                                   */
/* ============================================================ */
test('D1: 精方档案 CRUD 与品质边界', () => {
  const chatState = { sires: createEmptySires() };
  const addRes = upsertSireRecord(chatState, '亚瑟', {
    race: '人类',
    bodySize: 5,
    spermQuality: 2.0,
  });
  assert.ok(addRes.applied, '精方创建成功');
  const record = getSireRecord(chatState, '亚瑟');
  assert.ok(record, '读取精方档案');
  assert.equal(record.race, '人类');
  assert.equal(record.bodySize, 5);
  assert.equal(record.spermQuality, 2.0);

  assert.equal(normalizeSpermQuality(0.1), 0.25, '精子品质下界 0.25');
  assert.equal(normalizeSpermQuality(10), 4.0, '精子品质上界 4.0');
});

test('D2: 精子品质三项调控指数：有效量、留存时间与排出阻力', () => {
  const f1 = getSpermQualityFactors(1.0);
  assert.equal(f1.amount, 1.0);
  assert.equal(f1.decay, 1.0);
  assert.equal(f1.drain, 1.0);

  const f4 = getSpermQualityFactors(4.0);
  assert.equal(f4.amount, 2.0, '有效量 ×q^0.5 = 2.0');
  assert.equal(f4.decay, 0.5, '每天衰减 ×q^-0.5 = 0.5 (留存延长)');
  assert.ok(Math.abs(f4.drain - 0.7071) < 0.01, '清洗排出 ×q^-0.25');
  assert.equal(describeSpermQuality(4.0), '精力极旺，阳物雄伟，一次就能灌满');
});

/* ============================================================ */
/* E 面：性爱记录、半衰期衰减与经产扩张                           */
/* ============================================================ */
test('E1: 经产扩张每次自然分娩增加 0.125 级，上限 1.0 级', () => {
  assert.equal(getSheathStretch({ naturalBirthExperience: 0 }), 0);
  assert.equal(getSheathStretch({ naturalBirthExperience: 2 }), 0.25);
  assert.equal(getSheathStretch({ naturalBirthExperience: 8 }), 1.0);
  assert.equal(getSheathStretch({ naturalBirthExperience: 20 }), 1.0, '最多扩张 1 级');
});

test('E2: 性爱插入去重、精液增益与契合度计算', () => {
  const profile = { intimacy: {} };
  // 第一次插入
  const fresh1 = recordIntimacyInsert(profile, '兰斯洛特', { minutesPassed: 0, compat: 1 });
  assert.ok(fresh1, '初次插入算作新场次');
  assert.equal(profile.intimacy['兰斯洛特'].count, 1);

  // 6 小时内重复插入被去重
  const fresh2 = recordIntimacyInsert(profile, '兰斯洛特', { minutesPassed: 120, compat: 1 });
  assert.equal(fresh2, false, '6小时内同场次去重');
  assert.equal(profile.intimacy['兰斯洛特'].count, 1);

  // 精液注入提升契合度
  recordIntimacySemen(profile, '兰斯洛特', { minutesPassed: 130, quality: 4 });
  const rank = getIntimacyRanking(profile, { minutesPassed: 130 });
  assert.ok(rank.length >= 1);
  assert.equal(rank[0].name, '兰斯洛特');
  assert.ok(rank[0].fit > 0);
  const prompt = formatIntimacyPromptLine(rank);
  assert.ok(prompt.includes('身体最熟悉 兰斯洛特'));
});

/* ============================================================ */
/* F 面：子宫精液容量与健康数据接线                               */
/* ============================================================ */
test('F1: 子宫精液容量按阶段、内膜厚度与母体体型倍率动态结算', () => {
  // 未孕排卵期基准 100
  const capNormal = getSemenCapacity({
    gestating: false,
    emptyStage: '排卵期',
    emptyLining: 7,
    emptyProgress: 0.5,
    volumeFactor: 1,
  });
  assert.equal(capNormal, 100);

  // 5 级体型母体容积翻倍
  const capGiant = getSemenCapacity({
    gestating: false,
    emptyStage: '排卵期',
    emptyLining: 7,
    emptyProgress: 0.5,
    volumeFactor: 2,
  });
  assert.equal(capGiant, 200);
});

test('F2: HealthData 实例集成与会话存储隔离', () => {
  const mockStorage = new Map();
  const fakeStore = {
    get: (k) => mockStorage.get(k),
    set: (k, v) => mockStorage.set(k, v),
  };

  const hd = new HealthData(fakeStore);
  assert.equal(hd.bodySize, 4, '默认体型为 4');
  assert.equal(hd.getSheathStretch(), 0, '初产经产扩张为 0');

  // 建档精方并记录契合
  hd.upsertSire('高文', { race: '人类', bodySize: 5, spermQuality: 2 });
  assert.ok(hd.sires['高文'], '精方档案已保存');

  hd.recordIntimacy('高文', { spermValue: 30, quality: 2, minutesPassed: 10 });
  assert.ok(hd.intimacy['高文'], '性爱契合已记录');
  assert.ok(hd.getSemenCapacity() > 0, '子宫容量有效');

  // 模拟重启恢复状态
  const hdRestored = new HealthData(fakeStore);
  assert.ok(hdRestored.sires['高文'], '重启后精方档案保留');
  assert.ok(hdRestored.intimacy['高文'], '重启后性爱记录保留');
  assert.equal(hdRestored.sires['高文'].spermQuality, 2);
});
