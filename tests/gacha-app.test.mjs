// Gacha App 渲染冒烟测试
class MockEl {
  constructor() { this.innerHTML = ''; this.listeners = {}; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
}
class MockScreen extends MockEl {}
class MockStorage {
  constructor() { this.d = {}; }
  get(k) { return this.d[k] ?? null; }
  set(k, v) { this.d[k] = v; }
  remove(k) { delete this.d[k]; }
}
const mock = {
  phoneShell: {
    screen: new MockScreen(),
    showNotification() {},
    /* [v3.61.0 · O1] 视图改走 setContent（唯一内容入口），夹具必须跟上新接口：
     *   缺它则 render 当场抛「setContent is not a function」，后续断言全不跑。 */
    setContent(html) { this.screen.innerHTML = html; },
  },
  storage: new MockStorage(),
};
const events = [];
global.window = { VirtualPhone: {}, dispatchEvent: (e) => events.push(e), addEventListener() {} };
global.toastr = { info() {}, error() {}, warning() {}, success() {} };

let pass = 0, fail = 0;
const assert = (n, c) => { if (c) { pass++; console.log(`✓ ${n}`); } else { fail++; console.log(`✗ ${n}`); } };

try {
  const { GachaApp } = await import('../apps/gacha/gacha-app.js');
  const app = new GachaApp(mock.phoneShell, mock.storage);
  assert('实例化', app instanceof GachaApp);
  app.render();
  assert('render 不抛错', true);
  assert('初始 1000 币', app.data.getBalance() === 1000);

  // 抽卡
  const r = app.data.pullOnce('pool_erotic');
  assert('抽到 1 件', r.ok && r.results.length === 1);
  app.render();
  assert('抽后 render 不抛错', true);

  // 分享到聊天
  app.shareToChat(r);
  assert('分享触发 sendToChat 事件', events.some(e => e.type === 'phone:sendToChat'));

  console.log(`\n${pass} 通过, ${fail} 失败`);
} catch (e) {
  fail++;
  console.log('✗ 异常:', e.message);
  console.log(`\n${pass} 通过, ${fail} 失败`);
}
process.exit(fail > 0 ? 1 : 0);