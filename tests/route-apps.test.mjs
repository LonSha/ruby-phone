// 运行时渲染冒烟测试：mock phoneShell + storage，实例化 App 类并调用 render()
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
  phoneShell: { screen: new MockScreen(), showNotification() {} },
  storage: new MockStorage(),
};
global.window = { VirtualPhone: {}, dispatchEvent() {}, addEventListener() {} };
global.toastr = { info() {}, error() {} };
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.document = { querySelector: () => null, querySelectorAll: () => [], createElement: () => new MockEl() };

async function smoke(appInfo) {
  const [id, path, cls] = appInfo;
  try {
    const mod = await import(path);
    const app = new mod[cls](mock.phoneShell, mock.storage);
    if (typeof app.render !== 'function') throw new Error('no render');
    app.render();
    console.log(`✓ ${id}: 实例化+render 成功`);
    return true;
  } catch (e) {
    console.log(`✗ ${id}: ${e.message}`);
    return false;
  }
}

const apps = [
  ['peek', '../apps/peek/peek-app.js', 'PeekApp'],
  ['bilibili', '../apps/bilibili/bili-app.js', 'BiliApp'],
  ['theater', '../apps/theater/theater-app.js', 'TheaterApp'],
  ['graph', '../apps/memory/graph-app.js', 'GraphApp'],
  ['timeweaver', '../apps/timeweaver/timeweaver-app.js', 'TimeweaverApp'],
  ['worldpulse', '../apps/worldpulse/worldpulse-app.js', 'WorldpulseApp'],
];
let fail = 0;
for (const a of apps) { if (!(await smoke(a))) fail++; }
console.log(fail === 0 ? '\n全部渲染冒烟通过' : `\n${fail} 项失败`);
process.exit(fail > 0 ? 1 : 0);