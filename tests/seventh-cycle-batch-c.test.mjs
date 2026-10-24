// tests/seventh-cycle-batch-c.test.mjs — [RubyPhone · 第七期批次 C]
// R7-O5 作品版本与来源谱系、R7-O6 个人资料与决定册
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ARTIFACT_MEDIA_TYPES,
    LINEAGE_STALE_STATUS,
    RESOLUTION_ACTIONS,
    computeContentFingerprint,
    normalizeSourceSegment,
    normalizeArtifact,
    diffImpactedArtifacts,
    applyUpdateWithLockProtection,
    lineageVersioningSelfCheck
} from '../config/lineage-versioning.js';

import {
    DECISION_STANCE_STATUS,
    SOURCE_CHANNEL_TYPES,
    normalizeDossierSource,
    normalizeDecisionEntry,
    buildPersonalDossier,
    retractDecision,
    evaluateUpstreamChanges,
    personalDossierSelfCheck
} from '../config/personal-dossier.js';

test('RubyPhone · 第七期批次 C · R7-O5 作品版本与来源谱系', async (t) => {
    await t.test('自检零异常', () => {
        const check = lineageVersioningSelfCheck();
        assert.deepEqual(check.problems, [], 'lineageVersioningSelfCheck 必须零问题');
    });

    await t.test('三章作品派生三种媒介、修改单章只影响关联成稿、锁定段绝对保护、来源删除识别', () => {
        // 1. 定义三章作品源文本
        const ch1 = normalizeSourceSegment({ sourceId: 'ch_1', title: '第1章·初入江湖', content: '林舟背着木剑走出青石镇。' });
        const ch2 = normalizeSourceSegment({ sourceId: 'ch_2', title: '第2章·破庙避雨', content: '暴雨如注，破庙中传来一阵琵琶声。' });
        const ch3 = normalizeSourceSegment({ sourceId: 'ch_3', title: '第3章·夜探黑风寨', content: '月黑风高，林舟潜入山寨后厨。' });
        const sources = [ch1, ch2, ch3];

        // 2. 派生三种媒介成品：社交短帖(引ch1)、海报文案(引ch2)、配音脚本(引ch3)
        const post = normalizeArtifact({
            artifactId: 'art_post',
            title: '少年出山·微博发帖',
            mediaType: ARTIFACT_MEDIA_TYPES.SOCIAL_POST,
            sourceRef: 'ch_1',
            baseFingerprint: ch1.fingerprint,
            generatedBody: '【新章发布】走出青石镇，天下谁人不识君！',
            lockedSegments: [{ key: 'author_slogan', content: '天下谁人不识君！', userLocked: true }]
        });

        const poster = normalizeArtifact({
            artifactId: 'art_poster',
            title: '雨夜琵琶·概念海报',
            mediaType: ARTIFACT_MEDIA_TYPES.PROMO_POSTER,
            sourceRef: 'ch_2',
            baseFingerprint: ch2.fingerprint,
            generatedBody: '弦音落处，风雨无声。'
        });

        const vo = normalizeArtifact({
            artifactId: 'art_vo',
            title: '后厨暗影·旁白脚本',
            mediaType: ARTIFACT_MEDIA_TYPES.VOICEOVER,
            sourceRef: 'ch_3',
            baseFingerprint: ch3.fingerprint,
            generatedBody: '（低沉男声）更深露重，炊烟早熄，黑风寨的秘密就在这里。'
        });

        const artifacts = [post, poster, vo];

        // 3. 初始基线比对：全 fresh
        const initDiff = diffImpactedArtifacts(artifacts, sources);
        assert.equal(initDiff.length, 3);
        assert.ok(initDiff.every(d => d.status === LINEAGE_STALE_STATUS.FRESH), '初始三件成稿应全为 fresh');

        // 4. 更改源段：仅改动第 1 章设定（林舟改为提着铁剑），第 2、3 章不变
        const ch1v2 = normalizeSourceSegment({ sourceId: 'ch_1', title: '第1章·初入江湖(修)', content: '林舟提着沉重的精铁剑走出青石镇。' });
        const updatedSources = [ch1v2, ch2, ch3];

        const changedDiff = diffImpactedArtifacts(artifacts, updatedSources);
        const postDiff = changedDiff.find(x => x.artifactId === 'art_post');
        const posterDiff = changedDiff.find(x => x.artifactId === 'art_poster');
        const voDiff = changedDiff.find(x => x.artifactId === 'art_vo');

        assert.equal(postDiff.status, LINEAGE_STALE_STATUS.STALE_VERSION, '修改源段只影响关联成品');
        assert.equal(posterDiff.status, LINEAGE_STALE_STATUS.FRESH, '未改动源段的成品保持 fresh');
        assert.equal(voDiff.status, LINEAGE_STALE_STATUS.FRESH, '未改动源段的成品保持 fresh');

        // 5. 人工锁定段不被重写保护测试
        const rederivedText = '林舟提着铁剑迈出镇口，踏上修仙之旅。';
        const updatedPost = applyUpdateWithLockProtection(post, rederivedText, ch1v2.fingerprint);
        assert.ok(updatedPost.generatedBody.includes('天下谁人不识君！'), '重新派生时人工锁定段必须被保护保留');
        assert.equal(updatedPost.baseFingerprint, ch1v2.fingerprint, '更新后基线指纹同步刷新');

        // 6. 删除素材时清晰区分 missing_source
        const missingSources = [ch1v2, ch3]; // 删除了 ch2
        const missingDiff = diffImpactedArtifacts(artifacts, missingSources);
        const posterMissing = missingDiff.find(x => x.artifactId === 'art_poster');
        assert.equal(posterMissing.status, LINEAGE_STALE_STATUS.MISSING_SOURCE, '来源删除时准确标记 missing_source 而非仅仅 stale');
    });
});

test('RubyPhone · 第七期批次 C · R7-O6 个人资料与决定册', async (t) => {
    await t.test('自检零异常', () => {
        const check = personalDossierSelfCheck();
        assert.deepEqual(check.problems, [], 'personalDossierSelfCheck 必须零问题');
    });

    await t.test('从多源资料构成主题档案、来源可回跳、上游改版精准打标、立场撤回流转', () => {
        // 1. 构造两本资料与一次群聊来源
        const b1 = normalizeDossierSource({ sourceId: 'ref_novel_1', channel: 'reader_note', title: '宗门律典', appRoute: 'apps/reader?book=zmld', fingerprint: 'fp_z1' });
        const b2 = normalizeDossierSource({ sourceId: 'ref_novel_2', channel: 'reader_note', title: '九州山海志', appRoute: 'apps/reader?book=jzsh', fingerprint: 'fp_j1' });
        const c1 = normalizeDossierSource({ sourceId: 'chat_discourse', channel: 'chat_thread', title: '长老会商议纪要', appRoute: 'apps/wechat?session=elders', fingerprint: 'fp_c1' });

        // 2. 形成主题决定档案
        const d1 = normalizeDecisionEntry({
            id: 'dec_dan_dao',
            topic: '宗门炼丹改革',
            question: '是否允许外门弟子修习洗髓丹古方？',
            conclusion: '全面开放外门借阅权限，但需在筑基执事监护下开炉',
            sources: [b1, c1],
            supportingEvidence: ['山海志第12卷记载外门普及丹道可提升整体战力30%'],
            counterEvidence: ['宗门律典警告古方炸炉风险高，需严控安全措施'],
            stance: DECISION_STANCE_STATUS.CONFIRMED
        });

        const d2 = normalizeDecisionEntry({
            id: 'dec_ling_shi',
            topic: '宗门炼丹改革',
            question: '丹药兑换灵石定价是否浮动？',
            conclusion: '维持固定平价，宗门承担溢价差额补贴',
            sources: [b2],
            stance: DECISION_STANCE_STATUS.CONFIRMED
        });

        let dossier = buildPersonalDossier('宗门炼丹改革', [d1, d2]);
        assert.equal(dossier.entries.length, 2);
        assert.equal(dossier.activeCount, 2);

        // 验证来源回跳契约完整
        assert.equal(dossier.entries[0].sources[0].appRoute, 'apps/reader?book=zmld');
        assert.equal(dossier.entries[0].sources[1].appRoute, 'apps/wechat?session=elders');

        // 3. 上游改版影响测试：仅宗门律典改版（fp_z1 -> fp_z1_rev2）
        const upstreamUpdate = [{ sourceId: 'ref_novel_1', fingerprint: 'fp_z1_rev2', title: '宗门律典(修正版)' }];
        dossier = evaluateUpstreamChanges(dossier, upstreamUpdate);

        const checkD1 = dossier.entries.find(e => e.id === 'dec_dan_dao');
        const checkD2 = dossier.entries.find(e => e.id === 'dec_ling_shi');

        assert.equal(checkD1.isStale, true, '引用的上游改版后只精准标记该条受影响结论');
        assert.ok(checkD1.staleReason.includes('宗门律典'), '应说明具体哪个上游导致 stale');
        assert.equal(checkD2.isStale, false, '无关决定的 stale 状态不受影响');

        // 4. 用户撤回立场流转
        dossier = retractDecision(dossier, 'dec_dan_dao', '长老会后续发现古方缺失残页，用户主动撤回开放许可');
        const retractedD1 = dossier.entries.find(e => e.id === 'dec_dan_dao');

        assert.equal(retractedD1.stance, DECISION_STANCE_STATUS.RETRACTED, '撤回后不再以用户确认立场展示');
        assert.equal(dossier.activeCount, 1, '活跃确认数应减为 1');
        assert.equal(dossier.retractedCount, 1, '撤回记录应计入 retractedCount');
    });
});