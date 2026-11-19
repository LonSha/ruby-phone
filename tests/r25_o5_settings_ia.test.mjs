/* R25-O5 设置面信息架构：组目录 / 跨 tab 搜索可见 / 统一恢复默认
 * 纪律：内核在 node 里逐条判；面板用**迷你假 DOM** 真挂载一次，证明「写了 DOM、真写了 storage」；
 *   真键真默认值回到源码逐条对账（默认值编不出来）；负控制证明读不到值时判据自己会拦。
 * 本文件不用正则匹配源码（生成链会吃反斜杠），一律 includes / indexOf / 手写扫描。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    IA_GROUPS, IA_GROUP_ORDER, IA_RESET_ENTRIES, iaItemKey, buildIaIndex, iaSearch,
    iaResetPlan, iaResetReceipt, iaPanelNote, settingsIaSelfCheck
} from '../config/settings-ia.js';
import { mountIaPanel, collectIaSnapshot, IA_PANEL_ID } from '../apps/settings/settings-ia-panel.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SETTINGS_SRC = read('apps/settings/settings-app.js');

/* ------------------------------ 迷你假 DOM ------------------------------ */
function parseSel(sel) {
    // 支持 tag / #id / .class / [attr] / [attr="value"] 组合（jumpTo 用的是复合选择器）
    const out = { tag: '', id: '', classes: [], attrs: [] };
    let i = 0;
    const raw = String(sel || '').trim();
    while (i < raw.length) {
        const ch = raw[i];
        if (ch === '.' || ch === '#') {
            let j = i + 1;
            let word = '';
            while (j < raw.length && ' .#['.indexOf(raw[j]) === -1) { word += raw[j]; j += 1; }
            if (ch === '.') out.classes.push(word); else out.id = word;
            i = j;
        } else if (ch === '[') {
            let j = i + 1;
            let body = '';
            while (j < raw.length && raw[j] !== ']') { body += raw[j]; j += 1; }
            const eq = body.indexOf('=');
            if (eq === -1) out.attrs.push([body, null]);
            else {
                let val = body.slice(eq + 1);
                if (val[0] === '"' || val[0] === "'") val = val.slice(1, -1);
                out.attrs.push([body.slice(0, eq), val]);
            }
            i = j + 1;
        } else if (ch === ' ') { i += 1; } else {
            let j = i;
            let word = '';
            while (j < raw.length && ' .#['.indexOf(raw[j]) === -1) { word += raw[j]; j += 1; }
            out.tag = word;
            i = j;
        }
    }
    return out;
}

function matchOne(el, sel) {
    const p = parseSel(sel);
    if (p.tag && el.tag !== p.tag) return false;
    if (p.id && el.id !== p.id) return false;
    for (const c of p.classes) if (el.classList.contains(c) === false) return false;
    for (const [k, v] of p.attrs) {
        const have = el.getAttribute(k);
        if (have === null || have === undefined) return false;
        if (v !== null && String(have) !== String(v)) return false;
    }
    return true;
}

function matchAny(el, selector) {
    return String(selector).split(',').some((s) => matchOne(el, s.trim()));
}

class FakeEl {
    constructor(tag, doc) {
        this.tag = String(tag || 'div').toLowerCase();
        this.ownerDocument = doc;
        this.children = [];
        this.parentElement = null;
        this.attrs = {};
        this.id = '';
        // class 与 classList 必须同一份真源：真浏览器里两者永远一致，替身也得一致
        this._cls = new Set();
        Object.defineProperty(this, 'className', {
            get() { return Array.from(this._cls).join(' '); },
            set(v) { this._cls = new Set(String(v || '').split(' ').filter(Boolean)); },
            configurable: true
        });
        this.textContent = '';
        this.innerHTML = '';
        this.hidden = false;
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.open = false;
        this.listeners = {};
        this.style = { cssText: '', setProperty() {} };
        this.classList = {
            add: (c) => this._cls.add(c),
            remove: (c) => this._cls.delete(c),
            contains: (c) => this._cls.has(c)
        };
    }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.className = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    appendChild(node) { node.parentElement = this; this.children.push(node); return node; }
    insertAdjacentElement(_pos, node) { return this.parentElement ? this.parentElement.appendChild(node) : node; }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    removeEventListener() {}
    fire(type, ev) {
        const list = this.listeners[type] || [];
        list.forEach((fn) => fn(Object.assign({ target: this, key: '' }, ev || {})));
    }
    click() { this.fire('click', {}); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this); this.parentElement = null; }
    matches(sel) { return matchAny(this, sel); }
    closest(sel) {
        let node = this;
        while (node) { if (node.matches && node.matches(sel)) return node; node = node.parentElement; }
        return null;
    }
    _walk(out) { for (const c of this.children) { out.push(c); c._walk(out); } return out; }
    querySelectorAll(sel) { return this._walk([]).filter((el) => matchAny(el, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    scrollIntoView() {}
}

function makeFakeDoc() {
    const doc = {
        head: null,
        documentElement: null,
        createElement(tag) { return new FakeEl(tag, doc); },
        getElementById(id) { return doc.documentElement ? doc.documentElement.querySelector('#' + id) : null; }
    };
    doc.head = new FakeEl('head', doc);
    doc.documentElement = new FakeEl('html', doc);
    doc.documentElement.appendChild(doc.head);
    return doc;
}

/** 造一个「像设置页」的假根：两个 tab、分区、设置项、tab 按钮、r22 搜索框。 */
function makeSettingsDom() {
    const doc = makeFakeDoc();
    const root = new FakeEl('div', doc);
    root.setAttribute('id', 'yzp-settings-app');
    root.setAttribute('class', 'settings-app');
    doc.documentElement.appendChild(root);

    const tabs = new FakeEl('div', doc);
    tabs.setAttribute('class', 'settings-tabs');
    root.appendChild(tabs);
    [['general', '常规', 'true'], ['image', '生图', 'false']].forEach(([id, name, sel]) => {
        const b = new FakeEl('button', doc);
        b.setAttribute('class', 'settings-tab-btn');
        b.setAttribute('data-tab', id);
        b.setAttribute('aria-selected', sel);
        b.textContent = name;
        b.addEventListener('click', () => { root.__clickedTab = id; });
        tabs.appendChild(b);
    });

    const wrap = new FakeEl('div', doc);
    wrap.setAttribute('class', 'r22-settings-filter-wrap');
    root.appendChild(wrap);
    const input = new FakeEl('input', doc);
    input.setAttribute('id', 'r22-settings-filter');
    wrap.appendChild(input);
    const status = new FakeEl('div', doc);
    status.setAttribute('id', 'r22-settings-filter-status');
    root.appendChild(status);

    const tabGeneral = new FakeEl('div', doc);
    tabGeneral.setAttribute('id', 'tab-general');
    root.appendChild(tabGeneral);
    const secA = new FakeEl('div', doc);
    secA.setAttribute('class', 'setting-section');
    tabGeneral.appendChild(secA);
    const titleA = new FakeEl('div', doc);
    titleA.setAttribute('class', 'setting-section-title');
    titleA.textContent = '当前角色';
    secA.appendChild(titleA);
    [['setting-label', '称呼'], ['setting-label', '界面字号']].forEach(([cls, label]) => {
        const item = new FakeEl('div', doc);
        item.setAttribute('class', 'setting-item');
        const lab = new FakeEl('div', doc);
        lab.setAttribute('class', cls);
        lab.textContent = label;
        item.appendChild(lab);
        secA.appendChild(item);
    });

    const tabImage = new FakeEl('div', doc);
    tabImage.setAttribute('id', 'tab-image');
    root.appendChild(tabImage);
    const fold = new FakeEl('details', doc);
    fold.setAttribute('class', '');
    tabImage.appendChild(fold);
    const summary = new FakeEl('summary', doc);
    summary.textContent = '生图功能';
    fold.appendChild(summary);
    const itemImg = new FakeEl('div', doc);
    itemImg.setAttribute('class', 'setting-item');
    const labImg = new FakeEl('div', doc);
    labImg.setAttribute('class', 'setting-label');
    labImg.textContent = '生图开关';
    itemImg.appendChild(labImg);
    fold.appendChild(itemImg);

    return { doc, root };
}

/* ------------------------------ 1. 内核自检 ------------------------------ */
test('O5-1 内核自检零违规', () => {
    const r = settingsIaSelfCheck();
    assert.deepEqual(r.bad, []);
    assert.equal(r.ok, true);
});

/* --------------------- 2. 分组真源 = 设置页真 tab --------------------- */
test('O5-2 六组与设置页真 tab 一一对应（不是另造语义分组）', () => {
    const tabs = [];
    let i = 0;
    const marker = 'data-tab="';
    while (true) {
        const at = SETTINGS_SRC.indexOf(marker, i);
        if (at === -1) break;
        const end = SETTINGS_SRC.indexOf('"', at + marker.length);
        const id = SETTINGS_SRC.slice(at + marker.length, end);
        if (id && tabs.indexOf(id) === -1) tabs.push(id);
        i = end;
    }
    assert.deepEqual(tabs.sort(), ['general', 'image', 'llm', 'lobby', 'memory', 'tts']);
    const mapped = IA_GROUP_ORDER.map((g) => IA_GROUPS[g].tab).sort();
    assert.deepEqual(mapped, tabs.sort());
    assert.equal(IA_GROUPS.api.tab, 'llm', 'API 组必须落到真 tab llm');
});

/* ------------------------------ 3. 索引形状 ------------------------------ */
test('O5-3 索引：重复标签与空标签不入索引，未登记 tab 与空组如实报', () => {
    const idx = buildIaIndex([
        { tab: 'general', sections: [{ title: '当前角色', items: [{ label: ' 称呼 ' }, { label: '称呼' }, { label: '   ' }] }] },
        { tab: 'zzz', sections: [{ title: '野', items: [{ label: '野项' }] }] }
    ]);
    assert.equal(idx.total, 1, '重复/空标签不许变成两项');
    assert.equal(idx.items[0].key, iaItemKey('general', '当前角色', '称呼'));
    assert.deepEqual(idx.unknownTabs, ['zzz'], '未登记的 tab 不许悄悄吞掉');
    assert.ok(idx.absentGroups.includes('image'), '空组要如实报');
    assert.equal(buildIaIndex([]).total, 0);
    assert.ok(iaPanelNote(buildIaIndex([])).includes('0 项设置'));
});

/* ------------------------------ 4. 搜索 ------------------------------ */
test('O5-4 搜索：跨组命中带真 tab，无命中如实 noMatch', () => {
    const idx = buildIaIndex([
        { tab: 'general', sections: [{ title: '当前角色', items: [{ label: '界面字号' }] }] },
        { tab: 'image', sections: [{ title: '生图功能', items: [{ label: '生图开关' }] }] }
    ]);
    const hit = iaSearch(idx, '字号');
    assert.equal(hit.face, 'results');
    assert.equal(hit.hits.length, 1);
    assert.equal(hit.hits[0].tab, 'general');
    assert.ok(hit.note.includes('找到 1 项'));

    assert.equal(iaSearch(idx, '生图').face, 'results', '跨组要能搜到');
    assert.equal(iaSearch(idx, '绝无此设置').face, 'noMatch');
    assert.equal(iaSearch(idx, '').face, 'all');
    assert.equal(iaSearch(buildIaIndex([]), 'x').face, 'empty');
});

/* --------------------------- 5. 恢复默认预览 --------------------------- */
test('O5-5 预览四件事：没设过是 noop、改了给原值、读不到不塌成 noop、空组判 unknown', () => {
    const entries = [
        { id: 'a', group: 'general', label: '甲', storageKey: 'k-a', default: 100 },
        { id: 'b', group: 'general', label: '乙', storageKey: 'k-b', default: true }
    ];
    const noop = iaResetPlan(entries, () => null, { kind: 'all' });
    assert.equal(noop.face, 'noop');
    assert.ok(noop.note.includes('都是默认值'));

    const preview = iaResetPlan(entries, (k) => (k === 'k-a' ? 130 : true), { kind: 'all' });
    assert.equal(preview.face, 'preview');
    assert.equal(preview.changed.length, 1);
    assert.equal(preview.changed[0].from, 130);
    assert.equal(preview.changed[0].to, 100);

    const boom = iaResetPlan(entries, () => { throw new Error('storage 挂了'); }, { kind: 'all' });
    assert.equal(boom.face, 'unknown', '读不到当前值必须 unknown，不许说「都是默认值」');
    assert.equal(boom.skipped.length, 2);

    assert.equal(iaResetPlan(entries, () => null, { kind: 'group', group: 'tts' }).face, 'unknown');
    assert.equal(iaResetPlan(entries, () => null, { kind: 'one', id: 'a' }).items.length, 1);
});

test('O5-6 「没设过」与「设成了 0 / false」不同形', () => {
    const entries = [{ id: 'a', group: 'general', label: '甲', storageKey: 'k-a', default: 0 }];
    const unset = iaResetPlan(entries, () => null, { kind: 'all' });
    const zero = iaResetPlan(entries, () => 0, { kind: 'all' });
    assert.equal(unset.items[0].fromSet, false);
    assert.equal(unset.items[0].from, null);
    assert.equal(zero.items[0].fromSet, true);
    assert.equal(zero.items[0].from, 0);
    assert.equal(unset.face, 'noop');
    assert.equal(zero.face, 'noop', '0 等于默认 0，本来就不用改；但形状必须不同');

    const boolEntries = [{ id: 'b', group: 'general', label: '乙', storageKey: 'k-b', default: true }];
    assert.equal(iaResetPlan(boolEntries, () => false, { kind: 'all' }).changed.length, 1, 'false ≠ true 必须算改动');
    assert.equal(iaResetPlan(boolEntries, () => 'true', { kind: 'all' }).changed.length, 0, '字符串 true 要当同值');
});

/* ------------------------------ 7. 回执 ------------------------------ */
test('O5-7 回执：零条 unknown、全成 applied、部分 partial、ok 只认 true', () => {
    assert.equal(iaResetReceipt([]).face, 'unknown');
    assert.equal(iaResetReceipt([{ id: 'a', ok: true }]).face, 'applied');
    assert.equal(iaResetReceipt([{ id: 'a', ok: true }, { id: 'b', ok: false }]).face, 'partial');
    assert.equal(iaResetReceipt([{ id: 'a', ok: false }]).face, 'failed');
    assert.equal(iaResetReceipt([{ id: 'a', ok: 'yes' }]).face, 'failed', 'ok 只认 true（字符串不算成）');
    const r = iaResetReceipt([{ id: 'a', ok: true }, { id: 'b', ok: false }]);
    assert.deepEqual(r.appliedIds, ['a']);
    assert.deepEqual(r.failedIds, ['b']);
    assert.ok(r.note.includes('恢复 1 项'));
});

/* --------------------- 8~9. 真键 + 真默认值对账 --------------------- */
function readLineDefault(line, src) {
    const at = line.indexOf('||');
    if (at === -1) {
        if (line.includes('!== false')) return true; // `get(k) !== false ? checked : ''` 的隐式默认
        return undefined;
    }
    const tail = line.slice(at + 2).trim();
    if (!tail) return undefined;
    const quote = tail[0];
    if (quote === "'" || quote === '"') {
        const end = tail.indexOf(quote, 1);
        return tail.slice(1, end);
    }
    let j = 0;
    let token = '';
    const allowed = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-';
    while (j < tail.length && allowed.indexOf(tail[j]) !== -1) { token += tail[j]; j += 1; }
    if (!token) return undefined;
    if (String(Number(token)) === token) return Number(token);
    const constAt = src.indexOf('const ' + token + ' = ');
    if (constAt === -1) return undefined;
    const tail2 = src.slice(constAt + ('const ' + token + ' = ').length);
    let k = 0;
    let num = '';
    while (k < tail2.length && '0123456789.-'.indexOf(tail2[k]) !== -1) { num += tail2[k]; k += 1; }
    return num ? Number(num) : undefined;
}

test('O5-8 每个登记项都必须是对设置页真读真写的键（get + set 两侧都在）', () => {
    IA_RESET_ENTRIES.forEach((entry) => {
        const key = entry.storageKey;
        const getAt = SETTINGS_SRC.indexOf("storage.get('" + key + "')");
        const setAt = SETTINGS_SRC.indexOf("storage.set('" + key + "'");
        assert.notEqual(getAt, -1, key + ' 没有读取点：编出来的键');
        assert.notEqual(setAt, -1, key + ' 没有写入点：给了也改不了');
    });
    assert.ok(IA_RESET_ENTRIES.length >= 8, '可恢复项太少说明没真找');
});

test('O5-9 登记的默认值必须与源码里那行读取默认一致（默认值编不出来）', () => {
    IA_RESET_ENTRIES.forEach((entry) => {
        const marker = "storage.get('" + entry.storageKey + "')";
        const at = SETTINGS_SRC.indexOf(marker);
        assert.notEqual(at, -1, entry.storageKey);
        const lineStart = SETTINGS_SRC.lastIndexOf('\n', at) + 1;
        const lineEnd = SETTINGS_SRC.indexOf('\n', at);
        const line = SETTINGS_SRC.slice(lineStart, lineEnd);
        const srcDefault = readLineDefault(line, SETTINGS_SRC);
        assert.equal(srcDefault, entry.default, entry.id + ' 的默认值与源码不符：源码读作 ' + String(srcDefault) + '，登记写 ' + String(entry.default));
    });
});

/* ------------------------- 10. 接线（防「模块在盘」） ------------------------- */
test('O5-10 接线：主文件真 import 真调用，逻辑没搬进一万二千行', () => {
    assert.ok(SETTINGS_SRC.includes("import { mountIaPanel } from './settings-ia-panel.js"));
    assert.ok(SETTINGS_SRC.includes('this._r25IaMount = mountIaPanel('));
    assert.ok(SETTINGS_SRC.includes('storage: this.storage,'));
    // O5 自带「新增行数有上限」：主文件里不许出现内核函数名（逻辑在 config/settings-ia.js）
    ['iaResetPlan(', 'iaSearch(', 'buildIaIndex(', 'iaResetReceipt('].forEach((name) => {
        assert.equal(SETTINGS_SRC.includes(name), false, '内核逻辑不许写进 settings-app.js：' + name);
    });
    assert.ok(fs.statSync(path.join(ROOT, 'apps/settings/settings-ia-panel.js')).size > 8000, '面板真的带着 DOM 面');
});

/* ------------------- 11. 面板真挂载（假 DOM 里跑一遍） ------------------- */
test('O5-11 面板真挂载：六颗组 chip、状态行说人话、搜索出命中、恢复默认真写 storage', async () => {
    const { doc, root } = makeSettingsDom();

    const snapshot = collectIaSnapshot(root);
    assert.equal(snapshot.length, 2, '两个 tab 都该收进快照');
    assert.ok(JSON.stringify(snapshot).includes('界面字号'));

    const stored = new Map([['phone-font-scale', 130]]);
    const writes = [];
    const storage = {
        get: (k) => (stored.has(k) ? stored.get(k) : null),
        set: async (k, v) => { writes.push([k, v]); stored.set(k, v); }
    };
    const mounted = mountIaPanel(root, { storage, doc });
    assert.equal(mounted.ok, true);
    assert.equal(mounted.index.total, 3, '三项设置（称呼 / 界面字号 / 生图开关）');

    const panel = doc.getElementById(IA_PANEL_ID);
    assert.ok(panel, '面板必须真的进 DOM');
    const chips = panel.querySelectorAll('.r25-ia-group');
    assert.equal(chips.length, 6, '六组各一颗 chip');
    const emptyChip = chips.filter((c) => c.getAttribute('data-empty') === '1');
    assert.equal(emptyChip.length, 4, '只有 general/image 有项，其余四组要如实标空');
    assert.equal(emptyChip[0].disabled, true, '空组 chip 不该假装能跳');

    const status = doc.getElementById('r25-ia-status');
    assert.ok(status.textContent.includes('项设置'), '状态行要说清有多少项：' + status.textContent);
    assert.ok(status.textContent.includes('空组'), '空组要如实报');

    // 搜索：同一个输入框（r22 的），命中结果画在可见区
    const input = doc.getElementById('r22-settings-filter');
    input.value = '字号';
    input.fire('input');
    const results = doc.getElementById('r25-ia-results');
    assert.equal(results.hidden, false, '有命中就必须显示结果区（这是修「搜到但看不见」）');
    const hits = results.querySelectorAll('.r25-ia-hit');
    assert.equal(hits.length, 1);
    assert.ok(hits[0].innerHTML.includes('界面字号'));
    assert.ok(mounted.api.lastSearch.face === 'results');

    input.value = '绝无此设置';
    input.fire('input');
    assert.equal(doc.getElementById('r25-ia-results').hidden, true);
    assert.ok(doc.getElementById('r25-ia-status').textContent.includes('没有匹配'));

    // 恢复默认：先出差异预览，再真写
    doc.getElementById('r25-ia-reset').click();
    const sheet = doc.getElementById('r25-ia-sheet');
    assert.equal(sheet.hidden, false, '有改动必须先出预览，不许直接写');
    assert.ok(sheet.querySelectorAll('label').length >= 1, '预览层要逐项列出改动');
    const confirm = doc.getElementById('r25-ia-reset-confirm');
    assert.ok(confirm, '要有确认按钮');
    confirm.click();
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(writes, [['phone-font-scale', 100]], '必须真把默认值写回去');
    assert.equal(stored.get('phone-font-scale'), 100);
    assert.equal(mounted.api.lastReceipt.face, 'applied');
    assert.ok(doc.getElementById('r25-ia-status').textContent.includes('已恢复 1 项'));
});

/* ------------------- 12. 负控制：读不到值时不许写 ------------------- */
test('O5-12 负控制：storage 读挂掉时点恢复默认 → 只说未知，一次都不写', () => {
    const { doc, root } = makeSettingsDom();
    const writes = [];
    const storage = {
        get: () => { throw new Error('storage 挂了'); },
        set: async (k, v) => { writes.push([k, v]); }
    };
    mountIaPanel(root, { storage, doc });
    doc.getElementById('r25-ia-reset').click();
    assert.equal(doc.getElementById('r25-ia-sheet').hidden, true, '读不到值不许弹预览确认层');
    const status = doc.getElementById('r25-ia-status').textContent;
    assert.ok(status.includes('未知'), '必须说未知，不许说「都是默认值」：' + status);
    assert.equal(writes.length, 0, '一次都不许写');
});

test('O5-13 负控制：判据写宽了自己会红（ok/零条/读失败三条）', () => {
    // 如果哪天有人把「零条结果」放宽成 applied，这条会立刻红
    assert.equal(iaResetReceipt([]).face, 'unknown');
    // 如果哪天把「ok !== false」当成成，这条会立刻红
    assert.equal(iaResetReceipt([{ id: 'a', ok: 'yes' }]).face, 'failed');
    // 如果哪天把读失败塌成 noop，这条会立刻红
    assert.equal(iaResetPlan([{ id: 'a', group: 'general', label: '甲', storageKey: 'k', default: 1 }], () => { throw new Error('x'); }, { kind: 'all' }).face, 'unknown');
});
