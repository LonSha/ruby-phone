// iot 最小判据（R22-O6 顺带收掉的最后一个零测试目录）
import { SmartHomeAmbientIOTHub } from '../apps/iot/smart-home-ambient-iot-hub.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("✓ " + n); } else { fail++; console.log("✗ " + n); } };
const nothrow = (n, f) => { try { f(); ok(n, true); } catch (e) { ok(n, false); console.log("  " + e.message); } };

ok("导出 SmartHomeAmbientIOTHub", typeof SmartHomeAmbientIOTHub === "function");
nothrow("构造不抛", () => new SmartHomeAmbientIOTHub());

const hub = new SmartHomeAmbientIOTHub();
ok("有三件设备", Object.keys(hub.iotDevices).length === 3);

const cozy = hub.activateScene("cozy_night");
ok("cozy_night 色温 2400K", cozy.deviceStates.ambientLamp.colorTempK === 2400);
ok("cozy_night 窗帘全闭", cozy.deviceStates.smartBlind.closedPercent === 100);
ok("cozy_night 带 promptDirective", typeof cozy.promptDirective === "string" && cozy.promptDirective.length > 0);

const fresh = hub.activateScene("fresh_morning");
ok("fresh_morning 关灯", fresh.deviceStates.ambientLamp.power === false);
ok("fresh_morning 窗帘全开", fresh.deviceStates.smartBlind.closedPercent === 0);

// 负控制：未登记的场景名不得伪造一个「已切换」的叙述
const unknown = hub.activateScene("does_not_exist");
ok("负控制：未知场景回常规描述", unknown.narrativeAmbience === "常规起居状态");
ok("负控制：未知场景仍回显场景名", unknown.sceneName === "does_not_exist");

console.log(pass + " 通过, " + fail + " 失败");
process.exit(fail > 0 ? 1 : 0);