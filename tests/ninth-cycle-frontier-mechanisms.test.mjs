/* ========================================================
 * tests/ninth-cycle-frontier-mechanisms.test.mjs
 * RubyPhone v4.57.0 前沿机制超越测试套件
 * 
 * 验证 6 大超越模块：
 * 1. R-EX1 单实例互斥令牌守卫 (Loader Mutex Token Guard)
 * 2. R-EX2 剧情待办与约定日程应用 (Qianshi Schedule Manager)
 * 3. R-EX3 道具背包与权属流转应用 (Inventory Backpack Manager)
 * 4. R-EX4 角色等权多档案备忘录应用 (Character Dossier Manager)
 * 5. R-EX5 历史卷宗回放与长剧本浏览应用 (Volume Chronicle Manager)
 * 6. R-EX6 反极化交互行为解读辅助 (Interaction Advisor)
 * ======================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';

import { LoaderMutexTokenGuard } from '../config/loader-mutex-token.js';
import { QianshiScheduleManager, STORAGE_KEY as STORAGE_KEY_QSS } from '../config/qianshi-schedule.js';
import { InventoryBackpackManager, STORAGE_KEY as STORAGE_KEY_IBP } from '../config/inventory-backpack.js';
import { CharacterDossierManager, STORAGE_KEY as STORAGE_KEY_CDS } from '../config/character-dossier.js';
import { VolumeChronicleManager, STORAGE_KEY as STORAGE_KEY_VCH } from '../config/volume-chronicle.js';
import { InteractionAdvisor } from '../config/interaction-advisor.js';

test('R-EX1 · 深度单实例互斥令牌守卫：锁抢占、冲突排斥、释放与自动解绑', () => {
    const fakeScope = {};
    const guardA = new LoaderMutexTokenGuard({ holderId: 'instance_A' });
    const guardB = new LoaderMutexTokenGuard({ holderId: 'instance_B' });

    // 1. A 成功抢占
    const acqA = guardA.acquire(fakeScope);
    assert.strictEqual(acqA.acquired, true);
    assert.strictEqual(guardA.isHolding(fakeScope), true);

    // 2. B 抢占被拒
    const acqB = guardB.acquire(fakeScope);
    assert.strictEqual(acqB.acquired, false);
    assert.strictEqual(acqB.reason, 'mutex_held_by_another_instance');
    assert.strictEqual(guardB.isHolding(fakeScope), false);

    // 3. A 释放令牌后，B 可以抢占
    assert.strictEqual(guardA.release(fakeScope), true);
    assert.strictEqual(guardA.isHolding(fakeScope), false);

    const acqB2 = guardB.acquire(fakeScope);
    assert.strictEqual(acqB2.acquired, true);
    assert.strictEqual(guardB.isHolding(fakeScope), true);
});

test('R-EX2 · 剧情待办与约定日程应用：约定注册、状态流转、按角色过滤与统计', () => {
    assert.strictEqual(STORAGE_KEY_QSS, 'qss_qianshi_schedule_v1');
    const manager = new QianshiScheduleManager();

    // 登记两条约定
    const s1 = manager.addOrUpdateSchedule({
        title: '校门口碰头',
        character: '白清夜',
        storyTime: '周五晚自习后',
        status: 'planned'
    });
    const s2 = manager.addOrUpdateSchedule({
        title: '归还笔记',
        character: '苏晓',
        storyTime: '次日午后',
        status: 'inProgress'
    });

    assert.ok(s1.id);
    assert.strictEqual(manager.listSchedules().length, 2);

    // 推进状态
    manager.updateStatus(s1.id, 'completed');
    const completed = manager.listSchedules({ status: 'completed' });
    assert.strictEqual(completed.length, 1);
    assert.strictEqual(completed[0].character, '白清夜');

    const counts = manager.getSummaryCounts();
    assert.strictEqual(counts.total, 2);
    assert.strictEqual(counts.completed, 1);
    assert.strictEqual(counts.active, 1);
});

test('R-EX3 · 道具背包与权属流转应用：物品录入、转赠溯源与状态变更', () => {
    assert.strictEqual(STORAGE_KEY_IBP, 'ibp_inventory_backpack_v1');
    const backpack = new InventoryBackpackManager();

    // 录入物品
    const item = backpack.registerItem({
        name: '银制怀表',
        owner: 'protagonist',
        source: '祖父的遗物',
        significance: '时间与承诺的象征'
    });

    assert.strictEqual(item.status, 'held');
    assert.strictEqual(backpack.listByOwner('protagonist').length, 1);

    // 转赠他人
    backpack.transferItem(item.id, '白清夜', '作为离别信物');
    assert.strictEqual(backpack.listByOwner('protagonist').length, 0);
    assert.strictEqual(backpack.listByOwner('白清夜').length, 1);

    const targetItem = backpack.listByOwner('白清夜')[0];
    assert.strictEqual(targetItem.history.length, 2);
    assert.strictEqual(targetItem.history[1].action, 'transferred');

    // 消耗品测试
    const potion = backpack.registerItem({ name: '止痛药', owner: 'protagonist' });
    backpack.changeStatus(potion.id, 'consumed', '在受伤后服下');
    assert.strictEqual(backpack.listByOwner('protagonist', true).length, 0); // 持有中为 0
});

test('R-EX4 · 角色等权多档案备忘录应用：双段格式态度、性格偏移记录与多主角并列', () => {
    assert.strictEqual(STORAGE_KEY_CDS, 'cds_character_dossier_v1');
    const dossierManager = new CharacterDossierManager();

    // 登记第一个主角
    dossierManager.upsertDossier({
        name: '白清夜',
        identity: '社团学姐',
        relationship: '暧昧好友',
        attitude: '嘴硬心软，总在关键时刻照料'
    });

    // 登记第二个等权主角
    dossierManager.upsertDossier({
        name: '苏晓',
        identity: '调查搭档',
        relationship: '生死挚友',
        attitude: '绝对信任，毫无防备'
    });

    const summaries = dossierManager.listDossierSummaries();
    assert.strictEqual(summaries.length, 2);
    assert.ok(summaries[0].formattedAttitudeText.includes('关系：暧昧好友；态度：嘴硬心软'));

    // 记录性格偏移说明
    dossierManager.recordPersonalityShift('白清夜', {
        behavior: '故意走得很慢',
        meaning: '想多聊一会儿',
        avoidReadingAs: '不耐烦或嫌弃'
    });

    const bai = dossierManager.getDossier('白清夜');
    assert.strictEqual(bai.personalityShift.statement, '故意走得很慢 = 想多聊一会儿 | 不要理解为不耐烦或嫌弃');
});

test('R-EX5 · 历史卷宗回放与长剧本浏览应用：分卷同步、编年史卡片渲染与里程碑统计', () => {
    assert.strictEqual(STORAGE_KEY_VCH, 'vch_volume_chronicle_v1');
    const chronicle = new VolumeChronicleManager();

    chronicle.syncVolumes([
        {
            index: 2,
            title: '第二卷·迷雾渐起',
            timeRange: '秋季',
            recap: '发现钟楼下的暗道，众人面临抉择',
            entryCount: 10,
            majorEventCount: 3,
            characters: ['白清夜', '苏晓']
        },
        {
            index: 1,
            title: '第一卷·初遇与誓约',
            timeRange: '盛夏',
            recap: '在校园重逢，确立调查同盟',
            entryCount: 12,
            majorEventCount: 2,
            characters: ['白清夜']
        }
    ]);

    const stats = chronicle.getStats();
    assert.strictEqual(stats.totalVolumes, 2);
    assert.strictEqual(stats.totalEntriesArchived, 22);
    assert.strictEqual(stats.totalMajorEvents, 5);
    assert.strictEqual(stats.latestVolume.index, 2);

    const deck = chronicle.renderCardDeck();
    assert.strictEqual(deck[0].badge, 'VOL.01'); // 自动按序号升序重排
    assert.strictEqual(deck[1].badge, 'VOL.02');
    assert.ok(deck[0].statsTag.includes('12条记忆'));
});

test('R-EX6 · 反极化交互行为解读辅助：行为模式匹配、防过度解读与规范条目格式化', () => {
    const advisor = new InteractionAdvisor();

    // 1. 匹配沉默行为
    const res1 = advisor.analyzeBehavior('她低着头，沉默了良久，欲言又止。');
    assert.strictEqual(res1.matched, true);
    assert.ok(res1.adviceList[0].statement.includes('正在消化关键信息'));
    assert.ok(res1.adviceList[0].statement.includes('切勿片面解读为「冷漠、嫌弃或蓄意隐瞒」'));

    // 2. 匹配主动找话题
    const res2 = advisor.analyzeBehavior('“那个……你今天在干嘛呢？”她主动发来消息。');
    assert.strictEqual(res2.matched, true);
    assert.ok(res2.adviceList[0].meaning.includes('希望延长相处时间'));

    // 3. 规范语句构造
    const statement = advisor.formatShiftStatement('低头看手机', '在整理思路', '敷衍');
    assert.strictEqual(statement, '低头看手机 = 在整理思路 | 不要理解为敷衍');
});