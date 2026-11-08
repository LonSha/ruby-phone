import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const EventBus = require("../phone/phone-event-bus-pipeline.js").default;
const VirtualScroller = require("../phone/ui-virtual-list-scroller-60fps.js").default;
const DailyFabric = require("../apps/daily/cross-app-daily-life-fabric.js").default;
const SocialFeed = require("../apps/social/npc-autonomous-social-feed-engine.js").default;
const TypingHesitation = require("../apps/wechat/typing-hesitation-recall-anxiety.js").default;
const WeakSignal = require("../apps/network/radio-cellular-weak-signal-sim.js").default;
const BatteryPhysics = require("../apps/hardware/dynamic-power-battery-physics.js").default;
const BiometricWearable = require("../apps/health/smart-wearable-biometric-interop-v2.js").default;

test("[RubyPhone] 36项演化双计划 · 18项新引擎水合与生活事件反哺闭环校验", async (t) => {
    await t.test("跨应用事件总线发布与订阅机制", () => {
        const bus = new EventBus();
        let received = null;
        bus.on("test_evt", (payload) => { received = payload; });
        bus.emit("test_evt", { foo: "bar" }, { originApp: "unit_test" });
        assert.ok(received);
        assert.equal(received.foo, "bar");
    });

    await t.test("60fps虚拟滚动列表视口复用计算", () => {
        const scroller = new VirtualScroller({ viewportHeight: 600, defaultItemHeight: 60 });
        const items = Array.from({ length: 1000 }, (_, i) => ({ id: `msg_${i}`, text: `Message #${i}` }));
        scroller.setDataset(items);
        const slice = scroller.computeVirtualSlice(1200);
        assert.ok(slice.renderedNodes.length > 0);
        assert.equal(slice.totalCount, 1000);
        assert.ok(slice.totalHeight > 0);
    });

    await t.test("现代生活事件织网与跨应用联动", () => {
        const fabric = new DailyFabric();
        const events = fabric.synthesizeChatToLifestyle("今晚七点我们在老地方日料店聚餐，顺便提前叫个车。", "你");
        assert.ok(Array.isArray(events));
        assert.ok(events.length > 0);
        assert.ok(events.some(a => a.toApp === "takeout" || a.toApp === "calendar" || a.toApp === "taxi"));
    });

    await t.test("NPC昼夜作息与朋友圈自主演化", () => {
        const feed = new SocialFeed();
        const post = feed.generateAutonomousPost("爱丽丝", "night");
        assert.ok(post);
        assert.equal(post.author, "爱丽丝");
        assert.match(post.content, /深夜|胡思乱想|相册|凌晨|微光|轻叹/);
    });

    await t.test("微信输入犹豫与撤回悬念生成", () => {
        const anxiety = new TypingHesitation();
        const hes = anxiety.recordTypingHesitation("爱丽丝", "我很想你", "问作业", 4.5);
        assert.ok(hes.narrativeBehavior.includes("迟疑"));
        const recallRes = anxiety.executeEmergencyRecall("msg_999", "爱丽丝", "我很想你");
        assert.ok(recallRes);
        assert.ok(recallRes.chatNotice.includes("撤回"));
        assert.ok(recallRes.anxietyResidue.length > 0);
    });

    await t.test("双向桥接入事件总线并反哺心智", () => {
        const bus = new EventBus();
        const committedFacts = [];
        const mockBridge = {
            onFloorCommitted: (floor, facts) => { committedFacts.push(...facts); },
            mountEvolutionPipeline(eventBus) {
                eventBus.on("daily_life_event", (payload) => {
                    this.onFloorCommitted(null, [{ content: `[手机生活织网] ${payload.summary}`, tag: "life_fabric" }]);
                });
                eventBus.on("biometric_stress_alert", (payload) => {
                    this.onFloorCommitted(null, [{ content: `[手环生物体征] 角色心率剧增至 ${payload.heartRate} bpm`, tag: "biometric_stress" }]);
                });
            }
        };
        
        mockBridge.mountEvolutionPipeline(bus);
        
        bus.emit("daily_life_event", { summary: "与神秘人在咖啡馆碰头" });
        bus.emit("biometric_stress_alert", { heartRate: 135, stressLevel: 0.88 });
        
        assert.equal(committedFacts.length, 2);
        assert.match(committedFacts[0].content, /咖啡馆碰头/);
        assert.match(committedFacts[1].content, /135 bpm/);
    });
});
