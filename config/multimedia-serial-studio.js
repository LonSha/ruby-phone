/* ========================================================
 * config/multimedia-serial-studio.js — [R7-X7 · 第七期拓展规划] 跨媒介互动连载工作室（纯函数）
 * --------------------------------------------------------
 * 【这一刀治的是什么】
 *   一部连载如果仅在单一媒介（如纯文本阅读）中展开，读者的互动就会脱节；
 *   以往的跨媒介往往是简单的超链接跳转，换个界面把同一段台词再念一遍，
 *   或者读者的支线选择把作者原本设定的主线世界观与客观事实粗暴抹去。
 *   跨媒介互动连载工作室建立“主线恒定、多媒介分流互补与未读感知”机制：
 *     ① 四大媒介渠道互补(MEDIA_CHANNEL)：
 *        即时聊天(chat) + 深度阅读(reading) + 社媒动态(social_media) + 微剧场(theater)；
 *     ② 主线事实恒定性(primaryFact)：读者选择只改变探索视角、角色侧写与解锁支线，
 *        绝不直接覆写摧毁作者的主线世界观锚点；
 *     ③ 跨媒介接续包(buildContinuationPackage)：换媒介不重复已读剧情，
 *        自动分析并呈现“未读媒介清单(unreadChannels)”，防止漏看关键线索；
 *     ④ 差异化修订策略(revisePrimaryFact)：作者修订主线时，支持选择增量同步
 *        还是保留历史发布版本。
 * ======================================================== */
'use strict';

/** 媒介渠道类型 */
export const MEDIA_CHANNEL = Object.freeze({
    CHAT: 'chat',                   // 聊天通讯（微信/短信/私信）
    READING: 'reading',             // 长篇图文阅读（连载章节）
    SOCIAL_MEDIA: 'social_media',   // 动态广场（小红书/贴吧/风闻）
    THEATER: 'theater'              // 情景剧场（关键冲突切片演练）
});

function safeStr(val, fallback = '') {
    return (typeof val === 'string') ? val.trim() : fallback;
}

function safeNum(val, fallback = 0) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * 规范化连载回次对象
 */
export function normalizeSerialEpisode(raw = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const episodeNum = Math.max(1, safeNum(raw.episodeNum, 1));
    const title = safeStr(raw.title, `第 ${episodeNum} 回`);
    const primaryFact = safeStr(raw.primaryFact, '主线关键事件发生');

    const channelValues = Object.values(MEDIA_CHANNEL);
    const channelArtifacts = Array.isArray(raw.channelArtifacts)
        ? raw.channelArtifacts.map(a => {
            const channel = channelValues.includes(a.channel) ? a.channel : MEDIA_CHANNEL.READING;
            return {
                artifactId: safeStr(a.artifactId, `art_${channel}_${Date.now().toString(36)}`),
                channel,
                title: safeStr(a.title, '媒介切片'),
                content: safeStr(a.content, ''),
                requiredBranchKey: safeStr(a.requiredBranchKey, '') // 若绑定了特定支线，未解锁不可见
            };
        }).filter(a => a.content.length > 0)
        : [];

    const branchOptions = Array.isArray(raw.branchOptions)
        ? raw.branchOptions.map(b => ({
            branchKey: safeStr(b.branchKey),
            label: safeStr(b.label, '继续探索'),
            perspectiveShift: safeStr(b.perspectiveShift, '常规视角'),
            unlockedChannelArtifactIds: Array.isArray(b.unlockedChannelArtifactIds) ? b.unlockedChannelArtifactIds.map(safeStr) : []
        })).filter(b => b.branchKey.length > 0)
        : [];

    return Object.freeze({
        episodeNum,
        title,
        primaryFact,
        channelArtifacts: Object.freeze(channelArtifacts),
        branchOptions: Object.freeze(branchOptions),
        checkpointKey: safeStr(raw.checkpointKey, `ep_${episodeNum}_start`),
        createdAt: safeNum(raw.createdAt, Date.now()),
        updatedAt: safeNum(raw.updatedAt, Date.now())
    });
}

/**
 * 读者进行互动选择（激活分支，主线事实绝不抹除）
 */
export function chooseBranchOption(episode, selectedBranchKey, currentReaderState = {}) {
    const norm = normalizeSerialEpisode(episode);
    if (!norm) return currentReaderState;

    const bKey = safeStr(selectedBranchKey);
    const branch = norm.branchOptions.find(b => b.branchKey === bKey);
    if (!branch) return currentReaderState;

    const readArtifacts = new Set(Array.isArray(currentReaderState.readArtifactIds) ? currentReaderState.readArtifactIds : []);
    const activeBranches = new Set(Array.isArray(currentReaderState.activeBranches) ? currentReaderState.activeBranches : []);
    activeBranches.add(bKey);

    return Object.freeze({
        currentEpisodeNum: norm.episodeNum,
        primaryFactPreserved: norm.primaryFact, // 恒定主线事实严格保持
        activeBranches: Object.freeze(Array.from(activeBranches)),
        currentPerspective: branch.perspectiveShift,
        readArtifactIds: Object.freeze(Array.from(readArtifacts)),
        lastSelectedBranchKey: bKey,
        updatedAt: Date.now()
    });
}

/**
 * 读者标记阅读某个媒介切片，并生成跨媒介接续包与未读提示
 */
export function buildContinuationPackage(episode, readerState = {}) {
    const norm = normalizeSerialEpisode(episode);
    if (!norm) return null;

    const readSet = new Set(Array.isArray(readerState.readArtifactIds) ? readerState.readArtifactIds : []);
    const activeBranches = Array.isArray(readerState.activeBranches) ? readerState.activeBranches : [];

    // 计算当前对该读者可见的所有媒介切片
    const visibleArtifacts = norm.channelArtifacts.filter(a => {
        if (!a.requiredBranchKey) return true;
        return activeBranches.includes(a.requiredBranchKey);
    });

    const unreadArtifacts = visibleArtifacts.filter(a => !readSet.has(a.artifactId));
    const unreadChannels = Array.from(new Set(unreadArtifacts.map(a => a.channel)));

    return Object.freeze({
        episodeNum: norm.episodeNum,
        title: norm.title,
        primaryFact: norm.primaryFact,
        totalVisibleArtifacts: visibleArtifacts.length,
        unreadCount: unreadArtifacts.length,
        unreadChannels: Object.freeze(unreadChannels),
        nextSuggestedChannel: unreadChannels[0] || null,
        canAdvanceToNextEpisode: unreadArtifacts.length === 0
    });
}

/**
 * 作者修订主线事实（可控发布）
 */
export function revisePrimaryFact(episode, newFact, preservePublishedSnapshot = true, now = Date.now()) {
    const norm = normalizeSerialEpisode(episode);
    if (!norm) return null;

    return Object.freeze({
        ...norm,
        primaryFact: safeStr(newFact, norm.primaryFact),
        previousFactSnapshot: preservePublishedSnapshot ? norm.primaryFact : null,
        updatedAt: now
    });
}

/**
 * 模块自检函数
 */
export function multimediaSerialStudioSelfCheck() {
    const problems = [];
    if (Object.keys(MEDIA_CHANNEL).length !== 4) {
        problems.push('MEDIA_CHANNEL 必须恰好为 4 种媒介');
    }

    try {
        // 构建三回、四种媒介切片与分支的连载回次
        const ep1 = normalizeSerialEpisode({
            episodeNum: 1,
            title: '老桥头的重逢',
            primaryFact: '三年前约定之人于老桥头现身',
            branchOptions: [
                {
                    branchKey: 'branch_quiet',
                    label: '暗中观察对方随身携带的背包',
                    perspectiveShift: '探查疑虑视角'
                },
                {
                    branchKey: 'branch_warm',
                    label: '热情挥手并呼唤旧日昵称',
                    perspectiveShift: '坦诚交心视角'
                }
            ],
            channelArtifacts: [
                {
                    artifactId: 'art_read_main',
                    channel: MEDIA_CHANNEL.READING,
                    title: '江畔暮色',
                    content: '暮色降临，旧式石桥上传来熟悉的脚步声。'
                },
                {
                    artifactId: 'art_chat_msg',
                    channel: MEDIA_CHANNEL.CHAT,
                    title: '未读短信',
                    content: '短信预览：“我已经到桥头了，你在哪？”'
                },
                {
                    artifactId: 'art_social_post',
                    channel: MEDIA_CHANNEL.SOCIAL_MEDIA,
                    title: '贴吧怀旧贴',
                    content: '老城贴吧热帖：“谁还记得三年前老琴行的那群人？”'
                },
                {
                    artifactId: 'art_theater_branch',
                    channel: MEDIA_CHANNEL.THEATER,
                    title: '桥头试探小剧场',
                    content: '珞珈下意识按了按口袋里的旧车票……',
                    requiredBranchKey: 'branch_quiet'
                }
            ]
        });

        if (ep1.channelArtifacts.length !== 4) {
            problems.push('连载切片未完整包含四大媒介渠道');
        }

        // 1. 读者选择分支 A
        let readerState = chooseBranchOption(ep1, 'branch_quiet', { readArtifactIds: ['art_read_main'] });
        if (readerState.primaryFactPreserved !== '三年前约定之人于老桥头现身') {
            problems.push('读者分支选择错误地覆盖了作者主线核心事实');
        }
        if (readerState.currentPerspective !== '探查疑虑视角') {
            problems.push('分支选择未能正确切换叙事视角');
        }

        // 2. 接续包分析未读媒介
        const continuation = buildContinuationPackage(ep1, readerState);
        if (continuation.unreadCount !== 3) {
            problems.push(`未读切片计算不正确: 期望3, 实际${continuation.unreadCount}`);
        }
        if (!continuation.unreadChannels.includes(MEDIA_CHANNEL.CHAT)) {
            problems.push('未读媒介列表未识别出 CHAT 渠道');
        }
        if (!continuation.unreadChannels.includes(MEDIA_CHANNEL.THEATER)) {
            problems.push('解锁的分支小剧场切片未被正确识别为未读');
        }

        // 3. 作者修订主线事实留痕测试
        const revised = revisePrimaryFact(ep1, '三年前约定之人改在老茶馆现身', true);
        if (revised.previousFactSnapshot !== '三年前约定之人于老桥头现身') {
            problems.push('作者修订主线时未正确保留已发布版本快照');
        }
    } catch (err) {
        problems.push(`自检运行异常: ${err && err.message ? err.message : String(err)}`);
    }

    return { problems };
}