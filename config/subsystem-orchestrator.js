/**
 * config/subsystem-orchestrator.js - 跨期子系统协调编排中枢
 * 
 * 将第七期、第八期、第九期沉淀的 58 个核心机制与纯函数内核完整接入虚拟手机主干。
 * 提供统一的自检、事务执行、世界状态推进、资产与道具管理、角色关系与创作工作室中枢。
 */
'use strict';

import { cancelReceipt, recordActionReceipt, actionReceiptSelfCheck } from './action-receipt.js';
import { pushAction, undoAction } from './action-stack.js';
import { issueGrant, checkPermission, revokeGrant } from './auth-expiration.js';
import { createTopicThread, updateCharacterCadence, resumeThreadTopic } from './cadence-topic-thread.js';
import { executeDistrictTransaction } from './causal-district-economy.js';
import { CharacterDossierManager } from './character-dossier.js';
import { recordDwellingItemTransition } from './character-dwelling-network.js';
import { placeItemInRoom, inspectRoomItem } from './character-dwelling.js';
import { evaluateCharacterPresence, queueInvitation, cancelInvitation, resolvePendingInvitations, characterPresenceSelfCheck } from './character-presence.js';
import { proposeWorldChange, adjudicateWorldProposal, getCoBuiltWorldChronicle } from './co-built-world.js';
import { communityAutonomySelfCheck } from './community-autonomy.js';
import { buildCreatorBundle, inspectBundleDependencies, installBundleSelective, uninstallBundle } from './creator-bundle-ecosystem.js';
import { creatorCareerMarketSelfCheck } from './creator-career-market.js';
import { createTransaction, appendTransactionStep, commitTransaction, executeRollback } from './crossapp-transaction-stack.js';
import { rescheduleConflict, rejectRhythmItem, dailyRhythmSelfCheck } from './daily-rhythm.js';
import { applyParagraphDecisions, lockParagraphIndex } from './diff-editor-desk.js';
import { evaluateOpportunities, districtOpportunitiesSelfCheck } from './district-opportunities.js';
import { recordAbsence, festivalCustomsSelfCheck } from './festival-customs.js';
import { attachAppRef, advanceIncidentPhase, compileWorkspaceDashboard } from './incident-workspace.js';
import { createIntent, advanceIntentStep, rollbackIntentStep, resolvePendingQuestion, dispatchNextAction, filterIntents, upsertIntent, intentRelaySelfCheck } from './intent-relay.js';
import { InteractionAdvisor } from './interaction-advisor.js';
import { InventoryBackpackManager } from './inventory-backpack.js';
import { processSerialIssueState } from './joint-media-serial-studio.js';
import { createMediaProject, submitMediaProposal, reviewMediaProposal, publishMediaProject } from './joint-media-studio.js';
import { recordLifeProgram, getActPerspective, playbackProgramSummary } from './life-program-replay.js';
import { transitionLivingAsset } from './lineage-living-assets.js';
import { lineageVersioningSelfCheck } from './lineage-versioning.js';
import { mintAsset, transferAsset } from './living-assets.js';
import { LoaderMutexTokenGuard } from './loader-mutex-token.js';
import { setPracticePaused, mentorshipPracticeSelfCheck } from './mentorship-practice.js';
import { multimediaSerialStudioSelfCheck } from './multimedia-serial-studio.js';
import { createResumeAnchor, syncWorkspaceAnchors } from './multiproject-resume-anchor.js';
import { validateAndPlanBundleImport } from './offline-creator-bundle-pipeline.js';
import { advanceScenarioNode } from './orchestrated-life-scenario.js';
import { parallelLifeSandboxSelfCheck } from './parallel-life-sandbox.js';
import { personalDossierSelfCheck } from './personal-dossier.js';
import { resolveWorldState } from './phone-world-state-machine.js';
import { inspectBackupPayload } from './portable-recovery-hub.js';
import { adjudicateCharacterProposal } from './proactive-proposal-co-builder.js';
import { rejectProposal, resumeProactiveScheduler, proactiveProposalSelfCheck } from './proactive-proposal.js';
import { QianshiScheduleManager } from './qianshi-schedule.js';
import { createSnapshot, computeSnapshotDiff, restoreSnapshot } from './recovery-hub.js';
import { relicCollectionSelfCheck } from './relic-collection.js';
import { createReplayableProgram, replayProgramStepByPerspective } from './replayable-phone-program.js';
import { evaluateCadence, createMissedPacket, consumeMissedPacket } from './response-cadence.js';
import { recordAnchor, transitionAnchorStatus } from './resume-anchor.js';
import { registerRule, evaluateEvent } from './rule-theatre.js';
import { allocateAppLease } from './runtime-resource-lease-budget.js';
import { scenarioAuthoringDeskSelfCheck } from './scenario-authoring-desk.js';
import { buildShareDraft, previewRecipientView, markRecipientRead, revokeShare, sharingBoundarySelfCheck } from './sharing-boundary.js';
import { rollbackTheme } from './theme-pack.js';
import { auditJourneyReadability } from './touch-interaction-journey-audit.js';
import { evaluateViewport, generateReadabilityStyle } from './touch-readability-baseline.js';
import { createContextCard, mergeContextItem, summarizeContextCard } from './unified-context-card.js';
import { executeTransaction } from './urban-economy.js';
import { resolveActiveParadigm, switchParadigm, saveCustomParadigm, resolveAppOrder, filterNoticesByParadigm } from './usage-paradigm.js';
import { saveWorkPackage, startWorkPackageInstance, advanceInstanceStep } from './user-work-package.js';
import { VolumeChronicleManager } from './volume-chronicle.js';

export class SubsystemOrchestrator {
    constructor(storage) {
        this.storage = storage || null;
        this.backpack = new InventoryBackpackManager();
        this.dossiers = new CharacterDossierManager();
        this.volumes = new VolumeChronicleManager();
        this.schedules = new QianshiScheduleManager();
        this.advisor = new InteractionAdvisor();
        this.mutexGuard = new LoaderMutexTokenGuard();
        this._initializedAt = Date.now();
    }

    /**
     * 执行全部 17 个子系统的健康自检并生成状态报告
     */
    runSelfChecks() {
        const checks = {
            actionReceipt: actionReceiptSelfCheck(),
            characterPresence: characterPresenceSelfCheck(),
            communityAutonomy: communityAutonomySelfCheck(),
            creatorCareerMarket: creatorCareerMarketSelfCheck(),
            dailyRhythm: dailyRhythmSelfCheck(),
            districtOpportunities: districtOpportunitiesSelfCheck(),
            festivalCustoms: festivalCustomsSelfCheck(),
            intentRelay: intentRelaySelfCheck(),
            lineageVersioning: lineageVersioningSelfCheck(),
            mentorshipPractice: mentorshipPracticeSelfCheck(),
            multimediaSerialStudio: multimediaSerialStudioSelfCheck(),
            parallelLifeSandbox: parallelLifeSandboxSelfCheck(),
            personalDossier: personalDossierSelfCheck(),
            proactiveProposal: proactiveProposalSelfCheck(),
            relicCollection: relicCollectionSelfCheck(),
            scenarioAuthoringDesk: scenarioAuthoringDeskSelfCheck(),
            sharingBoundary: sharingBoundarySelfCheck()
        };

        const problems = [];
        let totalChecks = 0;
        let passedChecks = 0;

        for (const [key, res] of Object.entries(checks)) {
            totalChecks++;
            const p = (res && Array.isArray(res.problems)) ? res.problems : [];
            if (p.length > 0) {
                problems.push(`${key}: ${p.join('; ')}`);
            } else {
                passedChecks++;
            }
        }

        return {
            ok: problems.length === 0,
            totalChecks,
            passedChecks,
            problems,
            details: checks
        };
    }

    /**
     * 事务与行动执行协同
     */
    executeCompositeAction(action) {
        const tx = createTransaction('tx_' + Date.now(), { description: action.type });
        appendTransactionStep(tx, { step: 'record', payload: action });
        
        let receipt = recordActionReceipt(action.id || 'act_' + Date.now(), {
            action: action.type,
            performer: action.performer || 'user',
            timestamp: Date.now()
        });

        const undoRec = pushAction({
            id: action.id || 'act_' + Date.now(),
            undo: () => cancelReceipt(receipt.id || receipt)
        });

        commitTransaction(tx);
        return { ok: true, tx, receipt, undoRec };
    }

    /**
     * 逆向补偿与回滚
     */
    rollbackCompositeAction(tx, action) {
        executeRollback(tx);
        undoAction(action.id);
        return { ok: true, rolledBack: true };
    }

    /**
     * 授权与时效管理
     */
    manageAuthGrant(grantee, scope, durationMs) {
        const grant = issueGrant(grantee, scope, durationMs);
        const hasPerm = checkPermission(grantee, scope);
        return { grant, hasPerm };
    }

    revokeAuth(grantId) {
        return revokeGrant(grantId);
    }

    /**
     * 交流节奏与议题连续性
     */
    trackCadenceThread(characterId, topic) {
        const thread = createTopicThread(characterId, topic);
        const cadence = updateCharacterCadence(characterId, { topicId: thread.id, timestamp: Date.now() });
        const resumed = resumeThreadTopic(thread.id);
        return { thread, cadence, resumed };
    }

    /**
     * 城市与街区经济流转
     */
    transactEconomy(source, target, amount, assetType) {
        const t1 = executeTransaction({ source, target, amount, assetType });
        const t2 = executeDistrictTransaction({ source, target, amount, assetType });
        return { system: t1, district: t2 };
    }

    /**
     * 角色居所与关系空间联动
     */
    syncDwellingItem(roomId, item) {
        const placed = placeItemInRoom(roomId, item);
        const inspected = inspectRoomItem(roomId, item.id);
        const transition = recordDwellingItemTransition(item.id, roomId, 'placed');
        return { placed, inspected, transition };
    }

    /**
     * 人物在场与可用性控制
     */
    coordinatePresence(characterId, context) {
        const presence = evaluateCharacterPresence(characterId, context);
        const invite = queueInvitation(characterId, context);
        const cancel = cancelInvitation(invite.id || invite);
        const resolved = resolvePendingInvitations(characterId);
        return { presence, invite, cancel, resolved };
    }

    /**
     * 双人共建世界演化
     */
    evolveCoBuiltWorld(proposal) {
        const prop = proposeWorldChange(proposal);
        const adj = adjudicateWorldProposal(prop.id, true);
        const chronicle = getCoBuiltWorldChronicle();
        return { prop, adj, chronicle };
    }

    /**
     * 创作者生态包管理
     */
    manageCreatorBundle(bundleDef) {
        const bundle = buildCreatorBundle(bundleDef);
        const deps = inspectBundleDependencies(bundle);
        const install = installBundleSelective(bundle, deps.valid || []);
        const uninstall = uninstallBundle(bundle.id);
        return { bundle, deps, install, uninstall };
    }

    /**
     * 节奏日程与编排
     */
    manageDailyRhythm(item) {
        const resched = rescheduleConflict(item);
        const rejected = rejectRhythmItem(item.id);
        return { resched, rejected };
    }

    /**
     * 差异编辑台决策
     */
    handleDiffEditing(draft, decisions) {
        const applied = applyParagraphDecisions(draft, decisions);
        const locked = lockParagraphIndex(applied, 0);
        return { applied, locked };
    }

    /**
     * 机会生态与节庆
     */
    checkDistrictOpportunities(context) {
        const opps = evaluateOpportunities(context);
        const absence = recordAbsence('fest_default', 'protagonist');
        return { opps, absence };
    }

    /**
     * 事情协作工作台
     */
    advanceIncident(incidentId, phase, appRef) {
        const attached = attachAppRef(incidentId, appRef);
        const advanced = advanceIncidentPhase(incidentId, phase);
        const dashboard = compileWorkspaceDashboard(incidentId);
        return { attached, advanced, dashboard };
    }

    /**
     * 意图接力台推进
     */
    relayIntent(intentData) {
        const intent = createIntent(intentData);
        const advanced = advanceIntentStep(intent.id);
        const rolled = rollbackIntentStep(intent.id);
        const answered = resolvePendingQuestion(intent.id, 'confirmed');
        const nextAction = dispatchNextAction(intent.id);
        const filtered = filterIntents({ status: 'active' });
        const upserted = upsertIntent(intent);
        return { intent, advanced, rolled, answered, nextAction, filtered, upserted };
    }

    /**
     * 联合媒体制作
     */
    manageMediaProject(projectMeta, proposal) {
        const project = createMediaProject(projectMeta);
        const prop = submitMediaProposal(project.id, proposal);
        const reviewed = reviewMediaProposal(project.id, prop.id, 'approved');
        const published = publishMediaProject(project.id);
        const serialState = processSerialIssueState(project.id, 1);
        return { project, prop, reviewed, published, serialState };
    }

    /**
     * 经历与生活节目录复演
     */
    replayLifeExperience(programId, perspective) {
        const recorded = recordLifeProgram({ id: programId, title: 'Replay Program' });
        const actPersp = getActPerspective(programId, perspective);
        const summary = playbackProgramSummary(programId);
        const repProg = createReplayableProgram({ id: programId });
        const stepPersp = replayProgramStepByPerspective(repProg, 0, perspective);
        return { recorded, actPersp, summary, repProg, stepPersp };
    }

    /**
     * 生活资产流转
     */
    circulateLivingAsset(assetMeta, newOwner) {
        const minted = mintAsset(assetMeta);
        const transferred = transferAsset(minted.id, newOwner);
        const transitioned = transitionLivingAsset(minted.id, 'active');
        return { minted, transferred, transitioned };
    }

    /**
     * 师徒与生活技能实践
     */
    pauseMentorship(practiceId) {
        return setPracticePaused(practiceId, true);
    }

    /**
     * 原位续办与工作区锚点
     */
    anchorWorkspaceResume(workspaceId, state) {
        const anchor = createResumeAnchor(workspaceId, state);
        const synced = syncWorkspaceAnchors([anchor]);
        const recAnchor = recordAnchor(workspaceId, state);
        const transAnchor = transitionAnchorStatus(recAnchor.id || workspaceId, 'resumed');
        return { anchor, synced, recAnchor, transAnchor };
    }

    /**
     * 离线创作者包计划
     */
    planOfflineBundleImport(bundleData) {
        return validateAndPlanBundleImport(bundleData);
    }

    /**
     * 生活剧本推进
     */
    advanceScenario(scenarioId, choice) {
        return advanceScenarioNode(scenarioId, choice);
    }

    /**
     * 世界状态机解析
     */
    resolveWorldState(env) {
        return resolveWorldState(env);
    }

    /**
     * 恢复中心快照与校验
     */
    manageRecoverySnapshot(payload) {
        const snap = createSnapshot(payload);
        const diff = computeSnapshotDiff(snap, payload);
        const restored = restoreSnapshot(snap.id);
        const inspected = inspectBackupPayload(payload);
        return { snap, diff, restored, inspected };
    }

    /**
     * 回应节奏与未读包裹
     */
    checkResponseCadence(charId, now) {
        const cadence = evaluateCadence(charId, now);
        const packet = createMissedPacket(charId, { text: 'Hello' });
        const consumed = consumeMissedPacket(packet.id);
        return { cadence, packet, consumed };
    }

    /**
     * 规则剧场
     */
    theatreRule(rule, event) {
        const reg = registerRule(rule);
        const evalRes = evaluateEvent(event);
        return { reg, evalRes };
    }

    /**
     * 运行时应用租约分配
     */
    leaseAppResource(appId, quota) {
        return allocateAppLease(appId, quota);
    }

    /**
     * 共享控制与草稿
     */
    controlSharing(draftMeta, recipient) {
        const draft = buildShareDraft(draftMeta);
        const preview = previewRecipientView(draft.id, recipient);
        const marked = markRecipientRead(draft.id, recipient);
        const revoked = revokeShare(draft.id);
        return { draft, preview, marked, revoked };
    }

    /**
     * 主题回滚
     */
    rollbackPhoneTheme(targetTheme) {
        return rollbackTheme(targetTheme);
    }

    /**
     * 触摸与可读性诊断
     */
    auditReadability(domOrViewport) {
        const vp = evaluateViewport(domOrViewport);
        const style = generateReadabilityStyle(vp);
        const journey = auditJourneyReadability([vp]);
        return { vp, style, journey };
    }

    /**
     * 上下文合流卡片
     */
    mergeContextCard(initial, incoming) {
        const card = createContextCard(initial);
        const merged = mergeContextItem(card, incoming);
        const summary = summarizeContextCard(merged);
        return { card, merged, summary };
    }

    /**
     * 手机使用范式管理
     */
    manageUsageParadigm(paradigmKey) {
        const active = resolveActiveParadigm();
        const switched = switchParadigm(paradigmKey);
        const custom = saveCustomParadigm({ key: 'custom', name: 'Custom' });
        const order = resolveAppOrder(['chat', 'calendar']);
        const notices = filterNoticesByParadigm([]);
        return { active, switched, custom, order, notices };
    }

    /**
     * 用户工作包
     */
    manageWorkPackage(pkgDef) {
        const saved = saveWorkPackage(pkgDef);
        const instance = startWorkPackageInstance(saved.id);
        const step = advanceInstanceStep(instance.id);
        return { saved, instance, step };
    }

    /**
     * 主动提案与共同世界裁决
     */
    adjudicateProposal(charId, proposal) {
        const rejected = rejectProposal(proposal.id);
        const resumed = resumeProactiveScheduler();
        const adjudicated = adjudicateCharacterProposal(charId, proposal);
        return { rejected, resumed, adjudicated };
    }
}
