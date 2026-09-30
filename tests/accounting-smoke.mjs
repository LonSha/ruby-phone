// 记账 App 无头渲染冒烟（照 tests/route-apps.test.mjs 的 mock 范式）
class MockEl {
    constructor() { this.innerHTML = ''; this.listeners = {}; this.dataset = {}; this.children = []; this.className = ''; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    closest() { return null; }
    appendChild(c) { this.children.push(c); return c; }
    classList = { add() {}, remove() {} };
}
class MockScreen extends MockEl {}
class MockStorage {
    constructor() { this.d = {}; }
    get(k) { return this.d[k] ?? null; }
    set(k, v) { this.d[k] = v; }
    remove(k) { delete this.d[k]; }
}
const storage = new MockStorage();
const mock = {
    phoneShell: { screen: new MockScreen(), getContentContainer() { return new MockEl(); }, showNotification() {} },
    storage,
};
global.window = { VirtualPhone: {}, dispatchEvent() {}, addEventListener() {} };
global.toastr = { info() {}, error() {} };
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
const elCache = new Map();
global.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => { const e = new MockEl(); e.tagName = tag; return e; },
};

const mod = await import('../apps/accounting/accounting-app.js');
const data = await import('../apps/accounting/accounting-data.js');
const app = new mod.AccountingApp(mock.phoneShell, storage);
app.render();
console.log('✓ 空态 render 成功 · face =', app.faceReason(), '· summary =', app.summaryLine());

// 建账户 + 记一笔（走真实数据层）
const acc = app.addAccount('招行储蓄卡', '普通账户', '储蓄卡', '1000');
if (!acc) throw new Error('addAccount 失败');
app.render();
console.log('✓ 建账户后 render · 净值 =', app.projection().netWorth, '（应为 100000 分）');
const rec = app.addRecord('expense', '88.5', '餐饮', acc.id, '午饭');
if (!rec) throw new Error('addRecord 失败');
console.log('✓ 记一笔后余额 =', app.projection().assets, '（应为 91150 分）');
// 删一笔应把余额退回去
app.removeRecord(rec.id);
console.log('✓ 删流水后余额 =', app.projection().assets, '（应退回 100000 分）');
// 删账户应连带撤流水
app.addRecord('income', '200', '工资', acc.id, '');
app.removeAccount(acc.id);
console.log('✓ 删账户后账户数 =', app.accountList().length, '· 流水数 =', app.recordList().length, '（应都为 0）');
app.render();
console.log('✓ 回到空态 render 成功');
// 设置读写
app.settings = { ...app.settings, monthlyBudget: 500000, injectToPrompt: true };
app.saveSettings();
const app2 = new mod.AccountingApp(mock.phoneShell, storage);
console.log('✓ 设置持久化往返 monthlyBudget =', app2.settings.monthlyBudget);
console.log('注入块 =', JSON.stringify(app2.promptBlock()));
console.log('全部冒烟通过');
