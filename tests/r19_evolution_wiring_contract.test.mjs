/**
 * r19_evolution_wiring_contract.test.mjs
 * ------------------------------------------------------------
 * 【为什么要有这个文件】
 *   r18 用的是「直接 require 模块类 + 手写 mock 桥」——它只证明「类能 new 出来」，
 *   并不证明宿主里那条链真的通。本轮审计实证了 r18 的三处失真：
 *     ① mock 桥的 mountEvolutionPipeline / onFloorCommitted 签名与真实桥不同；
 *     ② 全仓零 emit，订阅方永远收不到（r18 直接手调 handler 绕过了总线）；
 *     ③ 真实桥的落账口曾调 core.record('ai', ...) 之外还传 null 楼层，写不进记忆。
 *   本文件改成**全程真件**：真 EventBus → 真 runtime(生产方) → 真 LonShaBridge(消费方)
 *   → 真 MemoryCore(落账)。任何一环契约错配，这里必然失败，而不是被 mock 掩盖。
 *
 * 【判据】不校验「函数被调用过」，只校验**记忆底座里真的多出了那条事实**。
 */
import test from "node:test";
import assert from "node:assert/strict";

import PhoneEventBusPipeline from "../phone/phone-event-bus-pipeline.js";
import { mountEvolutionRuntime } from "../phone/evolution36-runtime.js";
import { LonShaBridge } from "../apps/memory/lonsha-bridge.js";
import MemoryCore from "../apps/memory/memory-data.js";
import CrossAppDailyLifeFabric from "../apps/daily/cross-app-daily-life-fabric.js";
import SmartWearableBiometricInteropV2 from "../apps/health/smart-wearable-biometric-interop-v2.js";
import TypingHesitationRecallAnxiety from "../apps/wechat/typing-hesitation-recall-anxiety.js";

/** 最小 storage 桩：只实现 MemoryCore/LonShaBridge 真正会碰的那两个方法。 */
function makeStorage() {
    const bag = new Map();
    return {
        get: (k) => (bag.has(k) ? bag.get(k) : null),
        set: (k, v) => { bag.set(k, v); },
        remove: (k) => { bag.delete(k); },
        keys: () => [...bag.keys()]
    };
}

/**
 * 组装一条**真实**链路（不使用任何 mock 替代业务对象）。
 * 引擎以实例注入，避免依赖 globalThis —— 这正是宿主 ES module 环境的正确取法。
 */
function buildPipeline() {
    const storage = makeStorage();
    const core = new MemoryCore(storage);
    const bridge = new LonShaBridge(storage, core);
    const bus = new PhoneEventBusPipeline();
    const runtime = mountEvolutionRuntime({
        bus,
        engines: {
            dailyFabric: new CrossAppDailyLifeFabric(),
            biometric: new SmartWearableBiometricInteropV2(),
            typingAnxiety: new TypingHesitationRecallAnxiety()
        },
        scope: {}
    });
    const mounted = bridge.mountEvolutionPipeline(bus);
    return { storage, core, bridge, bus, runtime, mounted };
}

/** 在记忆底座里按标签找事实（走真实数据结构，不猜内部字段名之外的东西）。 */
function findMemories(core, tag) {
    const out = [];
    const push = (arr) => {
        for (const m of Array.isArray(arr) ? arr : []) {
            const tags = Array.isArray(m?.tags) ? m.tags : [];
            if (tags.includes(tag)) out.push(m);
        }
    };
    push(core.shortTerm);
    push(core.longTerm);
    push(core.memories);
    return out;
}

test("[RubyPhone·r19] 演化双计划「生产方→总线→桥→记忆底座」真实链路契约", async (t) => {
    await t.test("① 真实桥能挂上真实总线，三条订阅全部就位", () => {
        const { bridge, mounted } = buildPipeline();
        assert.equal(mounted.ok, true, "mountEvolutionPipeline 必须报告 ok");
        assert.equal(mounted.subscribed.length, 3, "必须订阅满三条生活事件");
        const read = bridge.getEvolutionRead();
        assert.deepEqual(read.subscribed.sort(), [
            "biometric_stress_alert",
            "daily_life_event",
            "typing_anxiety_recall"
        ].sort());
    });

    await t.test("② 生产方 runtime 挂载成功且三条通道全部 wired", () => {
        const { runtime } = buildPipeline();
        assert.equal(runtime.ok, true, "runtime 必须 ok");
        assert.deepEqual(runtime.wired.sort(), [
            "biometric_stress_alert",
            "daily_life_event",
            "typing_anxiety_recall"
        ].sort());
    });

    await t.test("③ 生产方 onChatSnippet 产生的每条生活事件都真的写进了记忆", () => {
        const { core, bridge, runtime } = buildPipeline();
        const before = findMemories(core, "life_fabric").length;
        const emitted = runtime.onChatSnippet("今晚一起点了份外卖，还约了明天下午三点在咖啡店见面，然后打车过去", {
            participant: "她"
        });
        assert.ok(runtime.getRead().emitted >= 1, "至少应产出一条 daily_life_event");
        const after = findMemories(core, "life_fabric").length;
        assert.equal(after - before, runtime.getRead().emitted,
            `emit ${runtime.getRead().emitted} 条，记忆里必须多条同样数量的事实`);
        assert.ok(bridge.getEvolutionRead().written >= 1, "桥的 written 计数必须递增");
        assert.equal(bridge.getEvolutionRead().lastError ?? "", "", "落账过程中不应有错误");
    });

    await t.test("④ 低应激手环采样不打扰记忆；高应激必须落账（字段名/量纲都对得上）", () => {
        const { core, runtime } = buildPipeline();
        /* [r19 抓到的真缺陷] 修前 runtime 读的是 stressLevel/stress/heartRate，
         *   而引擎真实返回 heartRateBpm + stressIndex(0~100) ⇒ 恒不 emit。
         *   这里不再手动 emit 绕过生产方，而是走 onBiometricSample 全真链路。 */
        const emitted = runtime.onBiometricSample("panic", false);   // 引擎口径：panic ⇒ stressIndex 95
        assert.equal(emitted, 1, "panic 状态必须穿透阈值产出一条高应激事件");
        assert.equal(findMemories(core, "biometric_stress").length, 1, "高应激必须落一条 [手环生物体征] 事实");
        const fact = findMemories(core, "biometric_stress")[0];
        assert.match(String(fact.content), /138 bpm/, "事实里必须带上真实心率（heartRateBpm=138）");

        /* 低应激不落账：sleeping ⇒ stressIndex 8 ⇒ 0.08 */
        const n0 = findMemories(core, "biometric_stress").length;
        assert.equal(runtime.onBiometricSample("sleeping", false), 0, "低应激不应 emit");
        assert.equal(findMemories(core, "biometric_stress").length, n0, "低应激不应写进记忆");

        /* 即便有人直接往总线灌百分制 95（绕过归一化），桥端也必须判为高应激而不是丢弃 */
        const bus = runtime; // 保持可读性：用 runtime.emit 直接发总线
        bus.emit("biometric_stress_alert", { heartRateBpm: 150, stressIndex: 95 });
        assert.equal(findMemories(core, "biometric_stress").length, n0 + 1,
            "桥端必须自己归一化量纲，百分制 95 也要落账，不能静默 skip");

        /* 直接灌归一化 0.2 的低应激 → 桥端应计入 skipped 且不写 */
        const n1 = findMemories(core, "biometric_stress").length;
        bus.emit("biometric_stress_alert", { heartRate: 72, stressLevel: 0.2 });
        assert.equal(findMemories(core, "biometric_stress").length, n1, "低应激直发总线不应落账");
    });

    await t.test("⑤ 打字犹豫经引擎判定后产生悬念事实，且带对方标识", () => {
        const { core, runtime } = buildPipeline();
        const before = findMemories(core, "typing_anxiety").length;
        runtime.onTypingHesitation("contact_lin", "我想说其实我一直……", "哦，没事", 6.2);
        const hits = findMemories(core, "typing_anxiety");
        assert.ok(hits.length > before, "打字犹豫必须落一条 [微信沟通悬念] 事实");
        const latest = hits[hits.length - 1];
        assert.match(String(latest.content), /contact_lin|对方/, "悬念事实应指明对话方");
    });

    await t.test("⑥ 记忆底座不可用时必须如实记错，而不是静默吞掉", () => {
        const bus = new PhoneEventBusPipeline();
        const bridge = new LonShaBridge(makeStorage(), null); // 故意不给 memoryCore
        const mounted = bridge.mountEvolutionPipeline(bus);
        assert.equal(mounted.ok, true, "订阅本身仍应成功");
        bus.emit("daily_life_event", { summary: "别的城市下雨了，记得带伞", fromApp: "weather" });
        const read = bridge.getEvolutionRead();
        assert.equal(read.written, 0, "没有底座就不能谎报写过");
        assert.ok(read.skipped >= 1, "必须计入 skipped");
        assert.equal(read.lastError, "memoryCore-absent", "必须点名缺的是什么");
    });

    await t.test("⑦ 重复挂载应复用同一总线，不叠加重复订阅", () => {
        const { bridge, bus } = buildPipeline();
        const again = bridge.mountEvolutionPipeline(bus);
        assert.equal(again.reused, true, "同一总线重复挂载必须复用");
        assert.equal(bridge.getEvolutionRead().subscribed.length, 3, "不得重复订阅导致计数膨胀");
    });
});
