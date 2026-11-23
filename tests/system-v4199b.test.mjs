import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    PHONE_FRAME_COLOR_DEFAULT,
    parsePhoneHexColor,
    normalizePhoneHexColor,
    clampPhoneColorNumber,
    phoneHexToRgb,
    phoneRgbToHex,
    phoneRgbToHsv,
    phoneHsvToRgb
} from '../config/phone-color-face.js';

/* config/phone-color-face.js 的等价性与边界对拍。
   该内核从 apps/settings/settings-app.js 149~231 行逐字搬出，本文件锁定其行为，
   使「抽内核」这件事有据可查：任何对语义的改动都必须在这里显式破镜。 */

test('1 常量：默认壳色只有一个字面量来源', () => {
    assert.equal(PHONE_FRAME_COLOR_DEFAULT, '#1a1a1a');
});

test('2 parsePhoneHexColor：3 位展开 + 恒大写 6 位', () => {
    assert.equal(parsePhoneHexColor('#abc'), '#AABBCC');
    assert.equal(parsePhoneHexColor('abc'), '#AABBCC');
    assert.equal(parsePhoneHexColor('#aabbcc'), '#AABBCC');
    assert.equal(parsePhoneHexColor('AABBCC'), '#AABBCC');
    assert.equal(parsePhoneHexColor('#ABCDEF'), '#ABCDEF');
    assert.equal(parsePhoneHexColor('  #abc  '), '#AABBCC');
});

test('3 parsePhoneHexColor：不合法一律 null，绝不给猜测值', () => {
    for (const v of ['#abcd', '#12345', '#1234567', '', null, undefined, 0, '#xyz', '#gggggg', true, {}, []]) {
        assert.equal(parsePhoneHexColor(v), null, 'input=' + JSON.stringify(v));
    }
    // 内嵌空格不被 trim 救回
    assert.equal(parsePhoneHexColor('#  #aabbcc'), null);
});

test('4 parsePhoneHexColor：数字会被 String() 后按 3 位展开（锁住怪异但确定的行为）', () => {
    assert.equal(parsePhoneHexColor(255), '#225555');
});

test('5 normalizePhoneHexColor：逐级回落 default -> 硬编码近黑', () => {
    assert.equal(normalizePhoneHexColor('#abc'), '#AABBCC');
    assert.equal(normalizePhoneHexColor('nonsense'), '#1A1A1A');
    assert.equal(normalizePhoneHexColor(''), '#1A1A1A');
    assert.equal(normalizePhoneHexColor(null), '#1A1A1A');
    assert.equal(normalizePhoneHexColor(undefined), '#1A1A1A');
});

test('6 normalizePhoneHexColor：fallback 自身也要过 parse', () => {
    assert.equal(normalizePhoneHexColor('#zzz', '#abc'), '#AABBCC');
    assert.equal(normalizePhoneHexColor('#zzz', 'zzz'), '#1A1A1A');
    assert.equal(normalizePhoneHexColor('#zzz', '#zzz'), '#1A1A1A');
});

test('7 clampPhoneColorNumber：非有限值（含 Infinity）一律落到 min', () => {
    assert.equal(clampPhoneColorNumber(5, 0, 255), 5);
    assert.equal(clampPhoneColorNumber(NaN, 0, 255), 0);
    // Infinity 也是非有限值，按内核声明落到 min，不是 max
    assert.equal(clampPhoneColorNumber(Infinity, 0, 255), 0);
    assert.equal(clampPhoneColorNumber(-Infinity, 0, 255), 0);
    assert.equal(clampPhoneColorNumber(-5, 0, 255), 0);
    assert.equal(clampPhoneColorNumber(300, 0, 255), 255);
    // min 不一定是 0：非有限值落到调用方给的 min
    assert.equal(clampPhoneColorNumber(NaN, 10, 20), 10);
    assert.equal(clampPhoneColorNumber(undefined, 3, 7), 3);
    assert.equal(clampPhoneColorNumber('abc', 0, 255), 0);
    // 数字字符串可用
    assert.equal(clampPhoneColorNumber('42', 0, 255), 42);
});

test('8 phoneHexToRgb：不可解析时回落默认色，不抛', () => {
    assert.deepEqual(phoneHexToRgb('#000000'), [0, 0, 0]);
    assert.deepEqual(phoneHexToRgb('#ffffff'), [255, 255, 255]);
    assert.deepEqual(phoneHexToRgb('#1a1a1a'), [26, 26, 26]);
    assert.deepEqual(phoneHexToRgb('#ff0000'), [255, 0, 0]);
    assert.deepEqual(phoneHexToRgb('#abc'), [170, 187, 204]);
    assert.deepEqual(phoneHexToRgb('garbage'), [26, 26, 26]);
});

test('9 phoneRgbToHex：超界通道先 clamp 再取整，输出恒大写', () => {
    assert.equal(phoneRgbToHex([0, 0, 0]), '#000000');
    assert.equal(phoneRgbToHex([255, 255, 255]), '#FFFFFF');
    assert.equal(phoneRgbToHex([26, 26, 26]), '#1A1A1A');
    assert.equal(phoneRgbToHex([300, -20, 0]), '#FF0000');
    assert.equal(phoneRgbToHex([1.5, 2.5, 3.5]), '#020304');
    // NaN 通道按 clamp 落到 0
    assert.equal(phoneRgbToHex([NaN, 128, Infinity]), '#008000');
});

test('10 phoneRgbToHsv：六主色 + 灰度边界', () => {
    const r = phoneRgbToHsv([255, 0, 0]);
    assert.equal(r.h, 0); assert.equal(r.s, 1); assert.equal(r.v, 1);
    assert.equal(phoneRgbToHsv([0, 255, 0]).h, 120);
    assert.equal(phoneRgbToHsv([0, 0, 255]).h, 240);
    assert.equal(phoneRgbToHsv([255, 255, 0]).h, 60);
    assert.equal(phoneRgbToHsv([255, 0, 255]).h, 300);
    assert.equal(phoneRgbToHsv([0, 255, 255]).h, 180);
    // 纯黑 / 纯白：delta 为 0，hue 保持 0
    assert.deepEqual(phoneRgbToHsv([0, 0, 0]), { h: 0, s: 0, v: 0 });
    assert.equal(phoneRgbToHsv([255, 255, 255]).v, 1);
    // 默认壳色的 v
    assert.ok(Math.abs(phoneRgbToHsv([26, 26, 26]).v - 26 / 255) < 1e-12);
});

test('11 phoneHsvToRgb：角度取模 + 非有限值落到下界', () => {
    assert.deepEqual(phoneHsvToRgb({ h: 0, s: 1, v: 1 }), [255, 0, 0]);
    assert.deepEqual(phoneHsvToRgb({ h: 120, s: 1, v: 1 }), [0, 255, 0]);
    assert.deepEqual(phoneHsvToRgb({ h: 240, s: 1, v: 1 }), [0, 0, 255]);
    assert.deepEqual(phoneHsvToRgb({ h: 360, s: 1, v: 1 }), [255, 0, 0]);
    // 负角与超 360 都归一到同一主色
    assert.deepEqual(phoneHsvToRgb({ h: -60, s: 1, v: 1 }), [255, 0, 0]);
    assert.deepEqual(phoneHsvToRgb({ h: 480, s: 1, v: 1 }), [255, 0, 0]);
    // s/v 为 0 时不看色相
    assert.deepEqual(phoneHsvToRgb({ h: 0, s: 0, v: 0 }), [0, 0, 0]);
    assert.deepEqual(phoneHsvToRgb({ h: 0, s: 0, v: 1 }), [255, 255, 255]);
    // 全 NaN：hue/s/v 全落到下界 0
    assert.deepEqual(phoneHsvToRgb({ h: NaN, s: NaN, v: NaN }), [0, 0, 0]);
});

test('12 往返：rgb -> hex -> rgb 在整数域恒等', () => {
    for (const rgb of [[26, 26, 26], [255, 0, 0], [1, 2, 3], [128, 64, 32], [0, 0, 0], [255, 255, 255]]) {
        assert.deepEqual(phoneHexToRgb(phoneRgbToHex(rgb)), rgb, 'rgb=' + JSON.stringify(rgb));
    }
});

test('13 接线：settings-app.js 只消费内核，不再本地实现', () => {
    const src = fs.readFileSync(new URL('../apps/settings/settings-app.js', import.meta.url), 'utf8');
    assert.match(src, /from '\.\.\/\.\.\/config\/phone-color-face\.js'/);
    for (const n of ['PHONE_FRAME_COLOR_DEFAULT', 'parsePhoneHexColor', 'normalizePhoneHexColor',
                    'clampPhoneColorNumber', 'phoneHexToRgb', 'phoneRgbToHex', 'phoneRgbToHsv', 'phoneHsvToRgb']) {
        assert.doesNotMatch(src, new RegExp('^\\s*(?:function|const)\\s+' + n + '\\b', 'm'), n + ' 仍有本地定义');
        assert.match(src, new RegExp('\\b' + n + '\\b'), n + ' 未被引用');
    }
    // 副作用函数刻意不抽，必须仍在原文件
    assert.match(src, /^\s*function applyPhoneShellScale\(/m);
    assert.match(src, /^\s*function applyGlobalFontScale\(/m);
});

test('14 边界：本内核落在 config/ 而非 apps/settings/，因此不计入 App 重构台账', () => {
    /* 为什么必须把这件事写死：
     *   App 重构台账（tests/audit/app-refactor-ledger.json）的已重构判据是
     *   「apps/<dir>/ 下存在 *-core.js」。phone-color-face.js 放在 config/，
     *   所以 settings 在台账里**仍是 pending** —— 这不是台账坏了，
     *   是两层不同的东西：config/*-face.js 是跨 App 复用的纯函数族
     *   （仓里已有 esc-face / num-face / text-face / array-face 等 20 个同类），
     *   apps/<dir>/*-core.js 是单个 App 的业务内核。
     * 若把本文件移到 apps/settings/ 下去凑台账的 refactored 数，
     * 就等于用「位置」冒充「重构完成」，是本仓治过多次的假绿形态。 */
    const face = fs.existsSync(new URL('../config/phone-color-face.js', import.meta.url));
    assert.ok(face, '内核必须在 config/ 下');
    assert.ok(!fs.existsSync(new URL('../apps/settings/phone-color-core.js', import.meta.url)),
        '不许为了凑台账把内核搬到 apps/settings/ 并改名成 *-core.js');

    const led = JSON.parse(fs.readFileSync(new URL('../tests/audit/app-refactor-ledger.json', import.meta.url), 'utf8'));
    const row = led.rows.find((r) => r.dir === 'settings');
    assert.ok(row, '台账里必须有 settings 行');
    // 位置决定判据：config/ 下的 face 不算 apps/ 下的 core
    assert.equal(row.refactored, false, 'settings 在台账里必须仍是 pending（内核不在 apps/settings/）');
    assert.ok(led.refactor_marker_note && led.refactor_marker_note.length > 10,
        '台账必须自带判据边界说明');
    assert.match(led.refactor_marker_note, /js_lines 为该目录全部 \.js 行数合计/,
        '台账必须写明 js_lines 是目录合计而非单文件');
    assert.match(led.refactor_marker_note, /phone-color-face\.js/,
        '台账必须点名本内核属 config/ 层，不计入 apps/<dir>/ 判据');
    // 防伪造：core_files 必须与磁盘实读一致，不许凭空塞名字
    const onDisk = fs.readdirSync(new URL('../apps/settings/', import.meta.url))
        .filter((f) => f.endsWith('-core.js'));
    assert.deepEqual([...row.core_files].sort(), onDisk.sort(),
        `台账 core_files=${JSON.stringify(row.core_files)} 与磁盘 ${JSON.stringify(onDisk)} 不一致 —— 不许用假名冒充已重构`);
    assert.equal(row.core_files.length, 0, 'settings 目前还没有 apps/ 下的业务内核');
});


function lenOf(rel) {
    return fs.readFileSync(new URL(rel, import.meta.url), 'utf8').split('\n').length;
}

test('15 台账 js_lines 与磁盘实读一致（口径：目录 .js 合计，非单文件）', () => {
    const led = JSON.parse(fs.readFileSync(new URL('../tests/audit/app-refactor-ledger.json', import.meta.url), 'utf8'));
    const row = led.rows.find((r) => r.dir === 'settings');
    // 台账 js_lines = apps/settings/ 下全部 .js 行数合计（settings-app.js 只是其中之一）
    const dirFiles = fs.readdirSync(new URL('../apps/settings/', import.meta.url))
        .filter((f) => f.endsWith('.js'));
    assert.equal(dirFiles.length, row.js_files, `台账 js_files=${row.js_files} 与磁盘 ${dirFiles.length} 不一致`);
    const actual = dirFiles.reduce((n, f) => n + lenOf(`../apps/settings/${f}`), 0);
    assert.equal(row.js_lines, actual,
        `台账 js_lines=${row.js_lines} 与磁盘目录合计 ${actual} 不一致 —— 改完行数必须重跑 tools/gen_app_ledger.mjs --write`);
    // 防伪：settings-app.js 单文件必须小于合计，否则说明有人把口径偷偷改成单文件
    const single = lenOf('../apps/settings/settings-app.js');
    assert.ok(single < row.js_lines, `settings-app.js 单文件 ${single} 竟不小于台账合计 ${row.js_lines}，口径被改坏了`);
    // 接线事实：内核抽出后 settings-app.js 必须小于接线前的 12810 行
    assert.ok(single < 12810, `settings-app.js 仍为 ${single} 行，接线未生效`);
});