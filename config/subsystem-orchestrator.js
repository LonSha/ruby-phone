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
/* [v4.96.0 · R11-O3] 三条 import 已随方法退役删除：
 *   `./portable-recovery-hub.js`（inspectBackupPayload）、`./recovery-hub.js`（createSnapshot /
 *   computeSnapshotDiff / restoreSnapshot）、`./rule-theatre.js`（registerRule / evaluateEvent）。
 *   这七件内核的**真消费方**现在是 owner App（apps/backupdesk 与 apps/theater），
 *   中原那层包装只会让入度读数虚高（模块「被 import」就算已消费，正是本计划 Problem 2 的成因）。 */
import { adjudicateCharacterProposal } from './proactive-proposal-co-builder.js';
import { rejectProposal, resumeProactiveScheduler, proactiveProposalSelfCheck } from './proactive-proposal.js';
import { QianshiScheduleManager } from './qianshi-schedule.js';
import { relicCollectionSelfCheck } from './relic-collection.js';
import { createReplayableProgram, replayProgramStepByPerspective } from './replayable-phone-program.js';
import { evaluateCadence, createMissedPacket, consumeMissedPacket } from './response-cadence.js';
import { recordAnchor, transitionAnchorStatus } from './resume-anchor.js';
import { allocateAppLease } from './runtime-resource-lease-budget.js';
import { scenarioAuthoringDeskSelfCheck } from './scenario-authoring-desk.js';
import { buildShareDraft, previewRecipientView, markRecipientRead, revokeShare, sharingBoundarySelfCheck } from './sharing-boundary.js';
import { rollbackTheme } from './theme-pack.js';
import { auditJourneyReadability } from './touch-interaction-journey-audit.js';
import { evaluateViewport, generateReadabilityStyle } from './touch-readability-baseline.js';
import { createContextCard, mergeContextItem, summarizeContextCard } from './unified-context-card.js';
import { executeTransaction } from './urban-economy.js';
/* [v4.96.0 · R11-O3] usage-paradigm 的具名导入已随本方法的退役一并删除：
 *   产品端真消费方是 phone/home-screen.js 与 apps/usage/usage-app.js，
 *   中枢这层包装曾在「模块入度」上把该模块记成已消费，而产品端一直是零调用。 */
import { saveWorkPackage, startWorkPackageInstance, advanceInstanceStep } from './user-work-package.js';
import { VolumeChronicleManager } from './volume-chronicle.js';
import { DynamicAtmosphereLighting } from './dynamic-atmosphere-lighting.js';
import { DynamicMomentsFeed } from './dynamic-moments-feed.js';
import { MimicCommEngine } from './mimic-comm-engine.js';
import { SpotlightUniversalSearch, SEARCH_DOMAINS } from './spotlight-universal-search.js';
import { AutonomousLifeScheduler } from './autonomous-life-scheduler.js';
import { SubconsciousDreamscapeMirror } from './subconscious-dreamscape-mirror.js';
import { SystemNotificationDispatcher } from './system-notification-dispatcher.js';
/* [v4.88.0 · 第七批缝入] 十一件新内核的健康自检与一行读数。
 *   接在这里的理由：本中枢的 runSelfChecks 就是「全部子系统的健康自检」出口，
 *   新内核属于同一族。一行读数同时留下（否则那些 *Line 只有测试消费，
 *   而本仓的规矩是**产品端零消费即死导出**）。 */
import { completionGateSelfCheck, gateSummaryLine } from './completion-claim-gate.js';
import { writeGuardSelfCheck, sameVirtualPath, writeRejectLine } from './write-guard.js';
import { redactionSelfCheck, redactSummaryLine } from './secret-redaction.js';
import { dedupSelfCheck, dedupSummaryLine } from './turn-claim-dedup.js';
import { saturationSelfCheck, saturationLine } from './topic-saturation-guard.js';
import { presenceSelfCheck, presenceLine, priorityOf } from './presence-arbitration.js';
import { echoStripSelfCheck, echoStripLine } from './echo-prose-strip.js';
import { stallSelfCheck, stallLine } from './stall-watch.js';
import { retentionSelfCheck, retentionLine } from './snapshot-retention.js';
import { mergeSelfCheck, mergeLine } from './attachment-merge.js';
import { redrawSelfCheck, epochLine, captureEpochs } from './redraw-generation.js';
/* [v4.90.0 · 第十批缝入 5+6+2/7/8] 三件纯函数内核的自检进同步表。
 *   三件都零 IO、不看时钟、不 await —— 若挂进 `_kernelAsyncChecks`，`res.ok === true` 恒不成立，
 *   真绿会变成假红（那条纪律写在 `_kernelAsyncChecks` 的档头，v4.89.0 已付过一次代价）。 */
import { sourcePermissionSelfCheck, sourcePermissionLine, filterSourcesByPermission } from './source-permission.js';
import { storyTimeRelSelfCheck, storyTimeLine } from './story-time-rel.js';
import { worldbookEntrySettingsSelfCheck, entrySettingsLine, applyLorebookEntrySettings } from './worldbook-entry-settings.js';
/* [v4.89.0 · 第九批缝入] 四件内核（前两件是纯函数，后两件带 async：队列自检要真等）。
 *   为什么仍挂在这里：runSelfChecks 是「全部子系统的健康自检」出口，新内核同族；
 *   一行读数同时留下（本仓规矩：产品端零消费即死导出）。 */
import { activationDiffusionSelfCheck, diffusionLine } from './activation-diffusion.js';
import { recallInjectionPlanSelfCheck, recallPlanLine } from './recall-injection-plan.js';
import { backgroundQueueSelfCheck, queueReadLine, runLimited } from './background-queue.js';
import { upstreamFailureSelfCheck, upstreamFailureLine } from './upstream-failure.js';
import { SmartGalleryVault } from './smart-gallery-vault.js';
import { BatteryThermodynamics } from './battery-thermodynamics.js';
import { CellularSignalSim } from './cellular-signal-sim.js';
import { VirtualFileSystem } from './virtual-file-system.js';
import { HapticPredictiveIme } from './haptic-predictive-ime.js';
import { CloudDriveSync } from './cloud-drive-sync.js';
import { ShortVideoLiveHub } from './short-video-live-hub.js';
import { HyperlocalDeliveryService } from './hyperlocal-delivery-service.js';
import { AmbientAudioWiretap } from './ambient-audio-wiretap.js';
import { SmartBandBiometrics } from './smart-band-biometrics.js';
import { ParallelPersonaSpaces } from './parallel-persona-spaces.js';
import { CalendarAutonomousLifeEngine } from './calendar-autonomous-life.js';

/**
 * [v4.89.0] 内核自检结果 → 失败列表的唯一口径。
 *   兼容 `problems` / `bad` 两种字段名：本仓十一件既有内核返回 `problems`，
 *   而 orchestrator 原先只认 `bad` —— 于是既有件**自检失败也被算成通过**。
 *   这里两种都认，空结果回落空数组（不把「没字段」当失败，也不当成功）。
 */
function kernelProblemsOf(res) {
    if (!res || typeof res !== 'object') return [];
    if (Array.isArray(res.problems)) return res.problems;
    if (Array.isArray(res.bad)) return res.bad;
    return [];
}

export class SubsystemOrchestrator {
    constructor(storage) {
        this.storage = storage || null;
        this.backpack = new InventoryBackpackManager();
        this.dossiers = new CharacterDossierManager();
        this.volumes = new VolumeChronicleManager();
        this.schedules = new QianshiScheduleManager();
        this.advisor = new InteractionAdvisor();
        this.mutexGuard = new LoaderMutexTokenGuard();
        
        // 第十期 (R10) 拟真与认知机制全量汇流挂载
        this.mimicComm = new MimicCommEngine({ storage });
        this.notifications = new SystemNotificationDispatcher({ storage });
        this.atmosphere = new DynamicAtmosphereLighting();
        this.spotlight = new SpotlightUniversalSearch({ storage });
        this.autonomousScheduler = new AutonomousLifeScheduler({ storage });
        this.moments = new DynamicMomentsFeed({ storage });
        this.subconscious = new SubconsciousDreamscapeMirror({ storage });
        this.galleryVault = new SmartGalleryVault({ storage });
        this.battery = new BatteryThermodynamics({ storage });
        this.cellular = new CellularSignalSim({ storage });
        this.vfs = new VirtualFileSystem({ storage });
        this.ime = new HapticPredictiveIme();
        this.cloudDrive = new CloudDriveSync({ storage });
        this.shortVideo = new ShortVideoLiveHub({ storage });
        this.delivery = new HyperlocalDeliveryService({ storage });
        this.wiretap = new AmbientAudioWiretap({ storage });
        this.smartBand = new SmartBandBiometrics({ storage });
        this.personaSpaces = new ParallelPersonaSpaces({ storage });
        this.calendarLife = new CalendarAutonomousLifeEngine();

        this._initializedAt = Date.now();
    }

    /**
     * 执行全部 17 个子系统的健康自检并生成状态报告
     */
    /**
     * [v4.88.0 · 第七批缝入] 十一件内核的自检与读数行（与既有子系统同一张表）。
     *   `kind: 'kernel'` 让消费方能区分「既有子系统」与「本次缝入的纯函数内核」，
     *   不必靠键名猜。自检失败时把 bad 逐条翻成 problems —— 上游表用的就是 problems 字段，
     *   这里不另立第二种失败形状。
     */
    _kernelChecks() {
        return {
            completionClaimGate: { run: completionGateSelfCheck, line: gateSummaryLine },
            writeGuard: { run: writeGuardSelfCheck, line: null },
            secretRedaction: { run: redactionSelfCheck, line: redactSummaryLine },
            turnClaimDedup: { run: dedupSelfCheck, line: dedupSummaryLine },
            topicSaturation: { run: saturationSelfCheck, line: saturationLine },
            presenceArbitration: { run: presenceSelfCheck, line: presenceLine },
            echoProseStrip: { run: echoStripSelfCheck, line: echoStripLine },
            stallWatch: { run: stallSelfCheck, line: stallLine },
            snapshotRetention: { run: retentionSelfCheck, line: retentionLine },
            attachmentMerge: { run: mergeSelfCheck, line: mergeLine },
            redrawGeneration: { run: redrawSelfCheck, line: epochLine },
            sourcePermission: { run: sourcePermissionSelfCheck, line: sourcePermissionLine },
            storyTimeRel: { run: storyTimeRelSelfCheck, line: storyTimeLine },
            worldbookEntrySettings: { run: worldbookEntrySettingsSelfCheck, line: entrySettingsLine }
        };
    }
    /**
     * [v4.89.0 · 第九批缝入] 四件带 async 的内核自检。**与同步表分开**，因为它们必须 await ——
     *   挤进 `_kernelChecks` 会让 `v.run()` 返回 Promise 而 `res.ok === true` 恒不成立，
     *   11 件真假绿变 4 件假红（这不报错，只是全绿不再可信）。
     */
    _kernelAsyncChecks() {
        return {
            activationDiffusion: { run: activationDiffusionSelfCheck, line: diffusionLine },
            recallInjectionPlan: { run: recallInjectionPlanSelfCheck, line: recallPlanLine },
            backgroundQueue: { run: backgroundQueueSelfCheck, line: queueReadLine },
            upstreamFailure: { run: upstreamFailureSelfCheck, line: upstreamFailureLine }
        };
    }
    _syncChecks() {
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
            sharingBoundary: sharingBoundarySelfCheck(),
            /* 十一件纯函数内核（自检与读数行同在，见 _kernelChecks） */
            ...Object.fromEntries(Object.entries(this._kernelChecks()).map(([k, v]) => {
                let res = null;
                try { res = v.run(); } catch (e) { res = { ok: false, bad: ['threw: ' + String((e && e.message) || e)] }; }
                const bad = kernelProblemsOf(res);
                return [k, { problems: bad, ok: res && res.ok === true, kind: 'kernel' }];
            }))
        };

        return checks;
    }
    /**
     * 全部自检（含四件异步）—— 队列自检要真等重试退避，故本入口是 async。
     *   异步件走 `runLimited` 限并发（本仓新内核自己就是干这个的，不用就还是靠自检自证），
     *   并 `failFast:false`：一件炸掉不许带走另外三件。
     */
    async runSelfChecks() {
        const checks = this._syncChecks();
        const entries = Object.entries(this._kernelAsyncChecks());
        await runLimited(entries, async ([k, v]) => {
            let res = null;
            try { res = await v.run(); } catch (e) { res = { ok: false, bad: ['threw: ' + String((e && e.message) || e)] }; }
            const bad = kernelProblemsOf(res);
            checks[k] = { problems: bad, ok: res && res.ok === true, kind: 'kernel' };
            return k;
        }, { concurrency: 2, failFast: false });
        return this._composeReport(checks);
    }
    /**
     * 同步自检：给「不能 await 的调用点」（诊断面每帧取数）用。
     *   四件异步件**如实标 skipped**、且不计入 problems —— 不冒充已检、也不判红。
     *   代价写在这里：`ok:true` 只代表同步那部分全绿，不代表四件异步件也绿；
     *   要那份含异步的结论必须走 `runSelfChecks()`。
     */
    runSelfChecksSync() {
        const checks = this._syncChecks();
        for (const k of Object.keys(this._kernelAsyncChecks())) {
            checks[k] = { problems: [], ok: false, skipped: true, kind: 'kernel-async' };
        }
        return this._composeReport(checks);
    }
    /** problems / lines / 计数的唯一收尾口（两条入口共用，避免两份拼装逻辑漂移）。 */
    _composeReport(checks) {
        const problems = [];
        let totalChecks = 0;
        let passedChecks = 0;
        let skippedChecks = 0;

        for (const [key, res] of Object.entries(checks)) {
            totalChecks++;
            const p = (res && Array.isArray(res.problems)) ? res.problems : [];
            if (p.length > 0) {
                problems.push(`${key}: ${p.join('; ')}`);
            } else if (res && res.skipped === true) {
                skippedChecks++;
            } else {
                passedChecks++;
            }
        }

        /* 内核读数行（只在内核自检通过时才有意义；失败的已在 problems 里点名）。 */
        const lines = {};
        for (const [k, v] of Object.entries({ ...this._kernelChecks(), ...this._kernelAsyncChecks() })) {
            if (!v.line) continue;
            const d = checks[k];
            if (!d || !d.ok) continue;
            try { lines[k] = v.line(); } catch (_e) { lines[k] = '读数抛错'; }
        }
        /* 需要现场的两个口径读数：路径同一性（守卫的比较基准）与代次快照（重绘栅栏的基准）。 */
        lines.writeGuardSamePath = String(sameVirtualPath('/Documents/a.txt', '/documents/A.TXT'));
        lines.writeGuardReject = writeRejectLine({ path: '/a.txt', reason: 'bad-path', detail: '只有一级' });
        /* [v4.90.0 · 第十批缝入] 三件新内核的读数行都要**现场参数**才不是「无读数」：
         *   与上面两行同法。合并排除表给一发（同键不同写法必须被排掉才证明规范化在生效），
         *   时间给一发跨月（架空跨月算不出，必须落到「跨架空月」这一因），
         *   设置给一发越界手填（必须夹到 9999 并报出来）。 */
        lines.sourcePermission = sourcePermissionLine(filterSourcesByPermission({
            excludedBooks: ['ＴＯＭＢ', '被排的书'],
            candidates: [
                { kind: 'worldbook', world: '被排的书' },
                { kind: 'worldbook', world: '留着的书' },
                { kind: 'worldbook', world: 'Tomb' },
                { kind: 'worldbook', hostEnabled: false }
            ]
        }));
        lines.storyTimeRel = storyTimeLine({ labeled: 1, skipped: 1, byReason: { ok: 1, 'cross-fantasy-month': 1 } });
        lines.worldbookEntrySettings = entrySettingsLine(
            applyLorebookEntrySettings({}, { orderMode: 'manual', orderValue: 99999, position: 4 }, { orderNumber: 3 })
        );
        lines.redrawEpochs = JSON.stringify(captureEpochs(['wechat:img:s:c']));
        lines.presenceRank = 'error=' + priorityOf('error') + ' idle=' + priorityOf('idle');
        lines.redactSummary = redactSummaryLine(['apiKey', 'proxy_password']);
        return {
            ok: problems.length === 0,
            totalChecks,
            passedChecks,
            skippedChecks,
            problems,
            lines,
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
     *
     * 【v4.99.9 · R11-X9 修正：本方法此前是**纸面假驱动**】
     *   修前四行全部把参数传错（实测，逐行对照内核签名）：
     *     · `recordLifeProgram({ id, title })` —— 签名是 `(state, programSpec, now)`，
     *       只给一个对象 ⇒ 状态被当成「一段没有幕的节目」、spec 落空 ⇒ 永远 `title-required`；
     *     · `getActPerspective(programId, perspective)` —— 签名是 `(program, actIndex, characterId)`，
     *       传字符串进去 ⇒ 恒 `null`（内核第一行就 `Array.isArray(program.acts)` 挡掉）；
     *     · `playbackProgramSummary(programId)` —— 签名是 `(program)` ⇒ 恒 `{valid:false}`；
     *     · `createReplayableProgram({ id })` —— 签名是 `(programTitle, steps)` ⇒
     *       标题变成 `[object Object]`、步数 0。
     *   四处错参的净效果是：**每次调用都成功返回、每一项都是空的**。这正是本仓最贵的
     *   「不报错、不崩溃、只错结果」形态，故不能留着当「将来能用」。
     *
     * 【现在的口径】按内核真实签名重写，并让调用方**显式给出**台账状态与节目规格 ——
     *   本方法不再自己编一个节目（编出来的「回放」与存档对不上，与 X9 的硬约束同源）。
     *
     * @param {object} state `lpr_program_replay_v1` 的归一化状态（`normalizeLifeProgramState` 产物）
     * @param {{id?:string, title:string, acts?:Array, participants?:Array, occasion?:string}} programSpec
     * @param {number} actIndex 1 起的幕号
     * @param {string} characterId 视角角色 id
     * @returns {{recorded:object, actPersp:object|null, summary:object, steps:object[]}}
     */
    replayLifeExperience(state, programSpec, actIndex, characterId) {
        const recorded = recordLifeProgram(state, programSpec);
        const program = (recorded && recorded.success) ? recorded.program : null;
        const actPersp = program ? getActPerspective(program, actIndex, characterId) : null;
        const summary = playbackProgramSummary(program);
        /* 逐步视角：由**已录对白**重建节目单（与 X9 相册侧 `actStepsOf` 同一口径），
         *   本方法不生成任何一句叙事。 */
        const dialogues = (program && Array.isArray(program.acts))
            ? ((program.acts.find((a) => a && Number(a.actIndex) === Number(actIndex)) || {}).dialogues || [])
            : [];
        const rp = createReplayableProgram((program && program.title) || '', dialogues.map((d) => ({
            actorId: d && d.speaker,
            actionDescription: d && d.text,
            visibleData: { text: d && d.text, isPrivate: d && d.isPrivate === true }
        })));
        const steps = rp.steps.map((_s, i) => replayProgramStepByPerspective(rp, i, characterId));
        return { recorded, actPersp, summary, steps };
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
     * 恢复中心快照与校验 —— [v4.96.0 · R11-O3] **已退役**。
     *   为什么删而不是接线：本方法此前是 createSnapshot / computeSnapshotDiff / restoreSnapshot /
     *   inspectBackupPayload 的一层包装，但**每一条都调错了**：
     *     · `createSnapshot(payload)` 把「载荷」当「台账状态」传（内核签名是 (state,label,dataMap)）；
     *     · `restoreSnapshot(snap.id)` 传的是 id 字符串（内核要的是快照对象）；
     *     · `computeSnapshotDiff(snap, payload)` 拿 createSnapshot 的**返回值**（不是 snapshot）去比。
     *   实测它返回四个非空对象，看着全对，实际 keyCount=0 —— 是「形状对、内容空」的假驱动。
     *   真接线已按计划做到 owner App：`apps/backupdesk/backupdesk-app.js` 的
     *   captureSnapshot / diffSnapshot / restoreSnapshotKeys / inspectPayload 直接对内核取值，
     *   一次包装都不留（留一层就多一处口径）。故本方法与对应 import 一并删除。
     */

    /* [v4.96.0 · R11-O3] 规则剧场（原 theatreRule）**已退役**。
     *   为什么删而不是接线：`registerRule(rule)` 少了 state 参数（内核签名 (state, spec)，状态需落盘），
     *   `evaluateEvent(event)` 同样少了 state —— 两个调用恒拿不到真台账，属同族的假驱动。
     *   真接线在 `apps/theater/theater-app.js`（readRuleState / submitRule / evaluateRuleEvent），
     *   规则面板三张白名单直接来自内核。故本方法与 `registerRule` / `evaluateEvent` 两条 import 一并删除。 */

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
     * 手机使用范式管理 —— [v4.96.0 · R11-O3] **已退役**。
     *   为什么删：本方法的五条调用看着都在，但每一条都是「替产品端先跑一遍」——
     *   `switchParadigm(paradigmKey)` 会把用户真选的那一档塞进入口参数、`saveCustomParadigm`
     *   每次都写一份 key='custom' 的固定副本、`filterNoticesByParadigm([])` 传的是空数组
     *   （恒得空结果）。产品端真接线在 owner 位：`phone/home-screen.js` 调 resolveAppOrder /
     *   resolveActiveParadigm，`apps/usage/usage-app.js` 读写范式键并提供切换与另存入口。
     *   留着这层包装只会让「模块被 import 就算已消费」的读数虚高 —— 那正是本计划 Problem 2。
     *   ★ 上一版曾把它从方法面账本里手工摘除（当成已接线），本版实测它**在产品端仍零调用**、
     *     当场被门的「新增死方法」判回来。这说明摘账必须以真调用点为据，不能以「模块已有人用」为据。
     */
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

    /**
     * 第十期 (R10) 全局生活流时钟推进 (跨应用动力学、生理、弱网与光影协同)
     */
    advanceAutonomousLifeStep(elapsedMinutes = 15, currentScenario = 'NORMAL', actorStates = {}) {
        // 0. 自主生活节律与意图检索域校验
        const searchDomains = Object.values(SEARCH_DOMAINS);
        const routinePhase = this.autonomousScheduler ? this.autonomousScheduler.resolveRoutinePhase(new Date().getHours()) : null;

        // 1. 电池动力学流转
        const batteryReport = this.battery.tick(elapsedMinutes);

        // 2. 环境弱网模拟与离线冲刷
        const netReport = this.cellular.applyEnvironmentScenario(currentScenario);

        // 3. 生理手环联动
        let biometricsReport = null;
        if (currentScenario === 'PANIC' || currentScenario === 'CONFRONTATION') {
            biometricsReport = this.smartBand.modulateBiometricsByEvent(currentScenario);
            if (biometricsReport.alert) {
                this.notifications.post({
                    appId: 'smart_band',
                    title: '健康异动预警',
                    body: biometricsReport.alert.message,
                    priority: 'URGENT'
                });
            }
        }
        /* [v4.99.6 · R11-X8] **每推进一步就采一个点**，让心率曲线自己长出来。
         *   修前：手环只在 PANIC / CONFRONTATION 两种场景被调到，其余时间的曲线一片空白 ——
         *   「回看这条曲线」永远只有事件那几个散点。生活流本就按步推进，采样挂在这里最自然。
         *   ★ 采在 modulate 之后但不重复采：上面那两种场景已经在 modulate 内部采过一点。
         *   ★ 采样失败不影响本步的其它结论（曲线是留痕，不是业务）。 */
        if (!biometricsReport) {
            try { this.smartBand.sample(); } catch (_e) { /* 采样坏了不改这一步的结果 */ }
        }

        // 4. 日程扫描与提醒生成
        const upcomingAlerts = this.calendarLife.scanUpcomingAlerts(Date.now(), 15 * 60 * 1000);
        upcomingAlerts.forEach(alert => {
            this.notifications.post({
                appId: 'calendar',
                title: alert.title,
                body: alert.content,
                priority: alert.urgency
            });
        });

        // 5. 光影环境自适应
        const atmosphereSnapshot = this.atmosphere.computeAtmosphere(14, 'CLEAR');

        return {
            battery: batteryReport,
            cellular: netReport,
            biometrics: biometricsReport,
            alerts: upcomingAlerts,
            atmosphere: atmosphereSnapshot
        };
    }
}
