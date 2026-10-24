/* ========================================================
 * tests/eighth-cycle-batch-c.test.mjs — 第八期批次 C 综合测试
 * --------------------------------------------------------
 * 覆盖：
 *   - R8-O5 · 差异优先的编辑台（diff-editor-desk.js）
 *   - R8-O6 · 用户工作包（user-work-package.js）
 *   - R8-X5 · 角色共同媒体台（joint-media-studio.js）
 *   - R8-X7 · 可复演的生活节目录（life-program-replay.js）
 * ======================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DIFF_DECISION,
    normalizeDiffEditorState,
    computeParagraphDiff,
    applyParagraphDecisions,
    lockParagraphIndex
} from '../config/diff-editor-desk.js';

import {
    WORK_PACKAGE_STEP_STATUS,
    normalizeWorkPackageState,
    saveWorkPackage,
    startWorkPackageInstance,
    advanceInstanceStep
} from '../config/user-work-package.js';

import {
    MEDIA_PROJECT_TYPES,
    PROPOSAL_STATUS,
    PROJECT_STATUS,
    normalizeMediaStudioState,
    createMediaProject,
    submitMediaProposal,
    reviewMediaProposal,
    publishMediaProject
} from '../config/joint-media-studio.js';

import {
    normalizeLifeProgramState,
    recordLifeProgram,
    getActPerspective,
    playbackProgramSummary
} from '../config/life-program-replay.js';

test('R8-O5 · 差异优先的编辑台：段级比对、人工锁定段保护与局部采纳', () => {
    let state = normalizeDiffEditorState(null);

    const originalText = '第一段：清晨的雾气笼罩着街道。\n第二段：街角面包店传出刚出炉的香味。\n第三段：老猫在长椅上打着盹。';
    const modifiedText = '第一段：清晨的雾气已被朝阳驱散。\n第二段：街角面包店传出咖啡与面包香。\n第三段：老猫跳下了长椅。\n第四段：电车叮当驶过。';

    // 1. 用户人工锁定了第二段（index 1）
    state = lockParagraphIndex(state, 'doc_ch01', 1).state;
    const lockedIndices = state.sessions['doc_ch01'].lockedIndices;
    assert.deepEqual(lockedIndices, [1]);

    // 2. 计算段级差异
    const diffResult = computeParagraphDiff(originalText, modifiedText, lockedIndices);
    assert.equal(diffResult.totalParagraphs, 4);
    assert.equal(diffResult.hasLockedConflict, true);

    const para2Diff = diffResult.diffs[1];
    assert.equal(para2Diff.isLocked, true);
    assert.equal(para2Diff.defaultDecision, DIFF_DECISION.LOCKED_KEEP);

    // 3. 局部合并：虽然全部选择 ACCEPT，但被锁定的第二段坚决保留原貌
    const merged = applyParagraphDecisions(diffResult, {
        0: DIFF_DECISION.ACCEPT,
        1: DIFF_DECISION.ACCEPT, // 试图覆盖锁定段
        2: DIFF_DECISION.ACCEPT,
        3: DIFF_DECISION.ACCEPT
    });

    assert.ok(merged.mergedText.includes('清晨的雾气已被朝阳驱散')); // 第一段被修改接受
    assert.ok(merged.mergedText.includes('街角面包店传出刚出炉的香味')); // 第二段因锁定保留原貌！
    assert.ok(merged.mergedText.includes('老猫跳下了长椅')); // 第三段接受
    assert.ok(merged.mergedText.includes('电车叮当驶过')); // 第四段新增接受
});

test('R8-O6 · 用户工作包：工作包模板定义、多步骤实例化与跳过推进', () => {
    let state = normalizeWorkPackageState(null);

    // 1. 保存一个“长篇创作与发布”工作包
    const saveRes = saveWorkPackage(state, {
        id: 'pkg_creative_release',
        title: '长篇创作与发布全流程',
        steps: [
            { id: 's1', title: '撰写草稿', appId: 'creation-project', intent: 'draft' },
            { id: 's2', title: '校对敏感词', appId: 'memo', intent: 'proofread', optional: true },
            { id: 's3', title: '发布至动态', appId: 'moments', intent: 'publish' }
        ]
    });
    assert.equal(saveRes.success, true);
    state = saveRes.state;

    // 2. 启动实例
    const startRes = startWorkPackageInstance(state, 'pkg_creative_release');
    assert.equal(startRes.success, true);
    state = startRes.state;
    const instId = startRes.instance.instanceId;
    assert.equal(startRes.instance.currentStepIndex, 0);

    // 3. 完成第一步
    state = advanceInstanceStep(state, instId, 'complete', { wordCount: 3000 }).state;
    assert.equal(state.instances[instId].stepStates[0].status, WORK_PACKAGE_STEP_STATUS.COMPLETED);
    assert.equal(state.instances[instId].stepStates[1].status, WORK_PACKAGE_STEP_STATUS.RUNNING);

    // 4. 跳过第二步（可选步骤）
    state = advanceInstanceStep(state, instId, 'skip', { reason: '免审通道' }).state;
    assert.equal(state.instances[instId].stepStates[1].status, WORK_PACKAGE_STEP_STATUS.SKIPPED);
    assert.equal(state.instances[instId].stepStates[2].status, WORK_PACKAGE_STEP_STATUS.RUNNING);

    // 5. 完成第三步，整个流程结束
    const finalAdv = advanceInstanceStep(state, instId, 'complete', { postId: 'post_999' });
    assert.equal(finalAdv.isCompleted, true);
    assert.equal(finalAdv.instance.stepStates[2].status, WORK_PACKAGE_STEP_STATUS.COMPLETED);
});

test('R8-X5 · 角色共同媒体台：企划创建、成员提案提交、审稿与合刊发布', () => {
    let state = normalizeMediaStudioState(null);
    const now = 1700000000000;

    // 1. 创建一期周末播客企划
    const createRes = createMediaProject(state, {
        id: 'pod_weekend_talk',
        title: '周末闲聊电台第 1 期',
        type: MEDIA_PROJECT_TYPES.PODCAST,
        members: ['user', 'char_alice']
    }, now);
    assert.equal(createRes.success, true);
    state = createRes.state;

    // 2. Alice 提交开场白提案
    const prop1 = submitMediaProposal(state, 'pod_weekend_talk', {
        id: 'prop_intro',
        author: 'char_alice',
        title: '开场问候与天气漫谈',
        content: '收音机前的朋友们，这里是初冬微风吹拂的深夜电台……'
    }, now + 100);
    assert.equal(prop1.success, true);
    state = prop1.state;

    // 3. User 提交音乐推荐提案
    const prop2 = submitMediaProposal(state, 'pod_weekend_talk', {
        id: 'prop_music',
        author: 'user',
        title: '中场爵士配乐',
        content: '推荐这首秋末写下的萨克斯风小曲。'
    }, now + 200);
    state = prop2.state;

    // 4. 审阅提案：批准 Alice 的开场白，驳回配乐（要求重新挑选）
    state = reviewMediaProposal(state, 'pod_weekend_talk', 'prop_intro', true, '文案极佳，批准录入', 'user', now + 300).state;
    state = reviewMediaProposal(state, 'pod_weekend_talk', 'prop_music', false, '风格略微偏沉重，建议换一首轻快的', 'char_alice', now + 400).state;

    // 5. 发布企划：汇总已批准的提案
    const pubRes = publishMediaProject(state, 'pod_weekend_talk', '首期节目成刊发布！', now + 500);
    assert.equal(pubRes.success, true);
    assert.equal(pubRes.release.includedProposalIds.length, 1);
    assert.equal(pubRes.release.includedProposalIds[0], 'prop_intro');
    assert.equal(pubRes.state.projects['pod_weekend_talk'].status, PROJECT_STATUS.PUBLISHED);
});

test('R8-X7 · 可复演的生活节目录：多幕经历录制、角色视角切片与沙箱重播', () => {
    let state = normalizeLifeProgramState(null);
    const now = 1700000000000;

    // 1. 录制一段海边夏夜烟花会的生活节目
    const recordRes = recordLifeProgram(state, {
        id: 'prog_beach_fireworks',
        title: '海边夏夜的烟花大会',
        occasion: '仲夏纪念',
        participants: ['user', 'char_alice', 'char_bob'],
        acts: [
            {
                title: '海风吹拂的沙滩野餐',
                location: '月牙湾沙滩',
                narrativeSnippet: '傍晚六点，大家在细软的沙滩上铺开野餐垫。',
                perspectives: {
                    'char_alice': '橘红色的晚霞落在海面上，让人暂时忘却了所有烦恼。',
                    'char_bob': '海风有点凉，但炭烤秋刀鱼的味道非常地道。'
                }
            },
            {
                title: '盛大的夏夜花火',
                location: '海滨栈桥',
                narrativeSnippet: '第一颗金色的烟花升空绽放，夜空瞬间如白昼。',
                perspectives: {
                    'char_alice': '烟花照亮了彼此的笑脸，我许下了一个关于来年的愿望。'
                }
            }
        ]
    }, now);
    assert.equal(recordRes.success, true);
    state = recordRes.state;

    const program = state.programs['prog_beach_fireworks'];

    // 2. 角色视角切片：查看 Alice 与 Bob 在第一幕的不同回忆
    const aliceView = getActPerspective(program, 1, 'char_alice');
    assert.ok(aliceView.subjectiveView.includes('橘红色的晚霞'));

    const bobView = getActPerspective(program, 1, 'char_bob');
    assert.ok(bobView.subjectiveView.includes('炭烤秋刀鱼'));

    // 3. 沙箱重播概览（纯只读）
    const summary = playbackProgramSummary(program);
    assert.equal(summary.valid, true);
    assert.equal(summary.totalActs, 2);
    assert.ok(summary.replayOverview.includes('月牙湾沙滩'));
    assert.ok(summary.replayOverview.includes('海滨栈桥'));
});