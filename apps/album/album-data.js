/* ========================================================
 *  RubyPhone — SillyTavern 虚拟智能手机 UI
 *  作者 (Author): LonSha
 *
 * 本仓为独立实现（Zero-Database Architecture），不含任何第三方未授权代码。
 * 对外显示名统一为 RubyPhone。
 *
 * 版权 (c) 2026 LonSha。采 MIT 许可。
 * ======================================================== */

const MANAGED_MEDIA_RE = /(https?:\/\/[^\s"'<>)]*\/backgrounds\/phone_[^\s"'<>)]*|\/backgrounds\/phone_[^\s"'<>)]*)/ig;
const VIDEO_EXT_RE = /\.(?:mp4|webm|mov|m4v)$/i;

const ALBUM_SOURCE_CATALOG = Object.freeze([
    { key: 'honey', label: '蜜语', icon: 'fa-comment-dots' },
    { key: 'wechat-chat', label: '微信聊天', icon: 'fa-comments' },
    { key: 'wechat-custom', label: '微信自定义表情', icon: 'fa-face-smile' },
    { key: 'diary', label: '日记', icon: 'fa-book-open' },
    { key: 'weibo', label: '微博', icon: 'fa-eye' },
    { key: 'wangxiang', label: '万象', icon: 'fa-bag-shopping' },
    { key: 'mofo', label: '魔坊', icon: 'fa-wand-magic-sparkles' },
    { key: 'wallpaper', label: '壁纸', icon: 'fa-mobile-screen' },
    { key: 'avatar', label: '头像', icon: 'fa-user' },
    { key: 'app-icon', label: 'App 图标', icon: 'fa-grip' },
    { key: 'local-upload', label: '本地上传', icon: 'fa-cloud-arrow-up' },
    { key: 'other', label: '其他媒体', icon: 'fa-images' }
]);

/* [v4.99.9 · R11-X9] 回看面的**形状翻译**在桥里（`replay-face-bridge`），本数据层不重写
 *   任何判据：这里只做两件「取数」的事 —— ① 把保险箱里的路径从主列表剔除；
 *   ② 把 storage 里的台账原样交给桥去分态。三态文案、视角兜底标记全在桥上。 */
import {
    replayStateOf, actRowsOf, perspectiveOf, programSummaryOf,
    actStepsOf, vaultPartitionOf, REPLAY_LEDGER_KEY, REPLAY_VIEWERS, viewerKnown,
    viewerLabelOf, secrecyOptions, programSpecFromChat
} from '../../config/replay-face-bridge.js';
import { recordLifeProgram } from '../../config/life-program-replay.js';

export class AlbumData {
    constructor(storage) {
        this.storage = storage;
        this.deletedKey = 'phone_album_deleted_paths';
    }
    getMedia() {
        const items = new Map();
        const deleted = this._getDeletedSet();
        /* [v4.99.9 · R11-X9] 保险箱里已入箱的影像**不许出现在普通相册列表**（验收第 3 条）。
         *   这一层用桥给出的 `excludedPaths`（保险箱全集的归一化路径）做一次查表，
         *   而不是在这里重算「谁在箱里」—— 重算就等于把保险箱的判据复制到相册里。 */
        const vaultExcluded = this._vaultExcludedSet();
        let order = 0;

        const addImage = (pathLike, sourceLabel = '小手机', meta = {}) => {
            const normalized = this.normalizePath(pathLike);
            if (!normalized || deleted.has(normalized)) return;
            if (vaultExcluded.has(normalized)) return;
            if (!this.isManagedMediaPath(normalized)) return;

            const createdAt = Number(meta?.createdAt || 0);

            const existing = items.get(normalized);
            if (existing) {
                if (sourceLabel && !existing.sources.includes(sourceLabel)) {
                    existing.sources.push(sourceLabel);
                }
                existing.refCount += 1;
                if (Number.isFinite(createdAt) && createdAt > existing.createdAt) {
                    existing.createdAt = createdAt;
                }
                return;
            }

            items.set(normalized, {
                id: normalized,
                src: this.toDisplayPath(pathLike),
                path: normalized,
                filename: this.getFilename(normalized),
                mediaType: this.isVideoPath(normalized) ? 'video' : 'image',
                sources: sourceLabel ? [sourceLabel] : [],
                refCount: 1,
                createdAt: Number.isFinite(createdAt) ? createdAt : 0,
                order: order++
            });
        };

        this._scanKnownStores(addImage);
        this._scanRuntimeData(addImage);
        this._scanLocalStorage(addImage);

        return Array.from(items.values())
            .sort((a, b) => {
                const createdDiff = Number(b.createdAt || 0) - Number(a.createdAt || 0);
                return createdDiff || (a.order - b.order);
            })
            .map(image => ({
                ...image,
                sourceKey: this.getImageSourceKey(image)
            }));
    }

    getImages() {
        return this.getMedia().filter(item => item.mediaType !== 'video');
    }

    /* ══════════ [v4.99.9 · R11-X9] 回看面取数（只读已落盘记录，不生成内容） ══════════
     * 【为什么不在这里拼文案 / 不在这里判三态】
     *   三态（读不到 / 还没录过 / 有 N 段）、视角兜底标记、保险箱四态，
     *   全部由 `config/replay-face-bridge.js` 一处判。本层只回答「盘上读到什么」。
     * 【为什么台账读失败不抛】
     *   相册主页在这里就要能打开（保险箱是相册的一部分）；台账坏了只是回看页那一格
     *   显示「读不到」，不能让整个相册白屏。
     */

    /** 保险箱实例（中枢缺席时返回 null；桥会把 null 翻成 missing 而不是 empty）。 */
    _vault() {
        try {
            return window.VirtualPhone?.subsystems?.galleryVault || null;
        } catch (_e) {
            return null;
        }
    }

    /** 保险箱路径排除集（`getMedia` 的过滤源）。读不到时**返回空集**：
     *   相册照常显示，不因为保险箱坏了就连公开流一起藏掉。 */
    _vaultExcludedSet() {
        try {
            const part = vaultPartitionOf(this._vault());
            return new Set(Array.isArray(part.excludedPaths) ? part.excludedPaths : []);
        } catch (_e) {
            return new Set();
        }
    }

    /** 保险箱分区读数（视图直接用；锁着时 vaultRows 不含 url）。 */
    vaultFace() {
        return vaultPartitionOf(this._vault());
    }

    /** 回看台账（`lpr_program_replay_v1`）。原始串交给桥分态，本层不 parse。 */
    replayLedger() {
        let raw = null;
        let readThrew = false;
        let why = '';
        try {
            raw = this.storage?.get?.(REPLAY_LEDGER_KEY, null) ?? null;
        } catch (e) {
            readThrew = true;
            why = String((e && e.message) || 'read_threw');
        }
        if (readThrew) {
            return { state: 'missing', label: '回看台账读不到（不是「还没录过」）', rows: [], count: 0, readable: false, why, programs: {} };
        }
        return replayStateOf(raw);
    }

    /** 一个节目按 id 取（台账里没有时返回 null，不编一个空节目）。 */
    getProgram(programId) {
        const id = String(programId || '');
        if (!id) return null;
        const ledger = this.replayLedger();
        const programs = ledger.programs || {};
        return programs[id] || null;
    }

    /** 幕次读数（视图直接渲染 rows）。 */
    programActs(programId) {
        return actRowsOf(this.getProgram(programId));
    }

    /** 单幕某视角（self / other / bystander）。 */
    programPerspective(programId, actIndex, kind, opts) {
        const k = String(kind || '');
        if (!viewerKnown(k)) return perspectiveOf(null, 0, k, opts);
        return perspectiveOf(this.getProgram(programId), actIndex, k, opts);
    }

    /** 节目总述。 */
    programSummary(programId) {
        return programSummaryOf(this.getProgram(programId));
    }

    /** 三视角一次取齐（视图画切换条用；非法视角不画按钮，故先过滤）。 */
    programPerspectives(programId, actIndex, opts) {
        const rows = [];
        for (const kind of [REPLAY_VIEWERS.SELF, REPLAY_VIEWERS.OTHER, REPLAY_VIEWERS.BYSTANDER]) {
            if (!viewerKnown(kind)) continue;
            /* ★ `this.` 不能省：漏掉就是 ReferenceError（整个三格取数全炸）。
             *   这个坑是**探针实测**抓到的，不是推演：漏 `this.` 时
             *   `programPerspectives()` 抛错 ⇒ 回看页的视角区整块画不出来，
             *   而「节目列表 / 幕次列表」照常显示 —— 界面看着有内容、只少一格。 */
            rows.push(this.programPerspective(programId, actIndex, kind, opts));
        }
        return rows;
    }

    /* ══════════ [v4.99.9 · R11-X9] 归档：把已落盘对话写进回看台账 ══════════
     * 【为什么相册要能写】
     *   X9 的硬约束是「回看只读已落盘记录」。但台账此前**没有人写** ——
     *   于是回看页会永远停在「还没录过」：判据全绿、用户永远看不到东西。
     *   归档是唯一的写入口，且它只把**盘上已有的对话**切成幕，一句都不生成。
     * 【为什么不放在记忆 App】
     *   `apps/album/` 是计划原文点名的落点（`apps/album/` 新增「回看」页），
     *   写入口放在这一层，记忆侧的幕次视图只读一份台账 —— 两边看到的是同一段记录。
     */

    /** 中枢实例（宿主缺席时返回 null；归档会回落到内核直调，不是静默成功）。 */
    _orchestrator() {
        try {
            return window.VirtualPhone?.subsystems || null;
        } catch (_e) {
            return null;
        }
    }

    /** 宿主对话读数（宿主缺席时返回空面，绝不造一个假对话）。 */
    _chatContext() {
        try {
            if (typeof SillyTavern === 'undefined' || typeof SillyTavern.getContext !== 'function') return null;
            return SillyTavern.getContext();
        } catch (_e) {
            return null;
        }
    }

    /** 当前会话的对话读数（给回看页显示「可归档 N 幕 · M 句」）。 */
    chatArchivePreview(opts) {
        const ctx = this._chatContext();
        if (!ctx) {
            return { state: 'missing', label: '读不到当前对话（不是「这段对话是空的」）', actCount: 0, dialogueCount: 0, speakers: [], why: 'no_host_context' };
        }
        const messages = Array.isArray(ctx.chat) ? ctx.chat : null;
        if (!messages) {
            return { state: 'missing', label: '当前会话没有对话楼层（不是「已归档」）', actCount: 0, dialogueCount: 0, speakers: [], why: 'no_chat_array' };
        }
        return programSpecFromChat(messages, opts || {});
    }

    /**
     * 把当前会话的对话归档进回看台账。**这是本面唯一的写入口。**
     *
     * 【四态不同形】宿主读不到 / 没有对话楼层 / 没有可取对白 / 归档成功 ——
     *   压平任意两态，「读不到」就会被念成「还没录过」，用户会一直点那个按钮。
     *
     * @param {{title?:string, occasion?:string, perAct?:number, id?:string}} [opts]
     * @returns {{ok:boolean, note:string, state:string, programId:string, actCount:number}}
     */
    archiveChat(opts) {
        const o = (opts && typeof opts === 'object') ? opts : {};
        const preview = this.chatArchivePreview(o);
        if (preview.state !== 'ok') {
            return { ok: false, note: preview.label, state: preview.state, programId: '', actCount: 0 };
        }
        /* 台账先读一次：读不到时**不许盲写**（写下去会把一份坏档静默覆盖成「只有这一段」）。 */
        const ledger = this.replayLedger();
        if (!ledger || ledger.readable === false) {
            return { ok: false, note: '回看台账读不到，先不写（写下去会把旧记录覆盖掉）', state: 'ledger_unreadable', programId: '', actCount: 0 };
        }
        const state = { programs: ledger.programs || {}, updatedAt: Date.now() };
        /* ★ 走中枢的 `replayLifeExperience`（录制 + 取该幕视角 + 总述 + 逐步，一体）：
         *   本仓历史上「写完没人调」的方法不止一条；这一条正好是归档要的全套动作，
         *   接在这里就同时解决两件事 —— 归档有真实现，方法有真调用点。
         *   中枢缺席（测试夹具 / 早期启动）时回落内核直调：**回落必须是同一个内核**，
         *   不许在这里另写一份录制逻辑。 */
        const hub = this._orchestrator();
        const firstAct = (preview.spec.acts && preview.spec.acts[0]) || null;
        const firstSpeaker = firstAct && firstAct.dialogues && firstAct.dialogues[0]
            ? String(firstAct.dialogues[0].speaker || '') : '';
        let recorded;
        if (hub && typeof hub.replayLifeExperience === 'function') {
            try {
                recorded = hub.replayLifeExperience(state, preview.spec, 1, firstSpeaker).recorded;
            } catch (_e) {
                recorded = null;    /* 中枢这一步坏了 ⇒ 落到下面的内核直调，不是静默成功 */
            }
        }
        if (!recorded || recorded.success !== true) {
            recorded = recordLifeProgram(state, preview.spec, Date.now());
        }
        if (!recorded || recorded.success !== true) {
            return { ok: false, note: '归档没成（内核拒绝：' + String((recorded && recorded.reason) || '未给原因') + '）', state: 'record_failed', programId: '', actCount: 0 };
        }
        const saved = this.storage?.set?.(REPLAY_LEDGER_KEY, JSON.stringify(recorded.state));
        if (saved === false) {
            /* 落盘失败 ⇒ 不许说「归档好了」：界面下一步会去台账里找它，找不到就是指着不存在的东西。 */
            return { ok: false, note: '归档没写进盘（存储拒绝），台账没有变', state: 'write_failed', programId: '', actCount: 0 };
        }
        return {
            ok: true,
            note: '已归档 ' + String(preview.actCount) + ' 幕 · ' + String(preview.dialogueCount) + ' 句',
            state: 'ok',
            programId: recorded.program && recorded.program.id ? recorded.program.id : '',
            actCount: preview.actCount
        };
    }

    /**
     * 三视角的**枚举与文案**（视图画格子的唯一出处）。
     *   ★ 与记忆侧 `MemoryApp.replayViewerOptions()` 同一条纪律：视图不 import 桥，
     *     连「本人/对方/旁观」这三个词也由本层转出，否则就是同一口径 N 份实现。
     * @returns {Array<{kind:string, label:string}>}
     */
    viewerOptions() {
        return [REPLAY_VIEWERS.SELF, REPLAY_VIEWERS.OTHER, REPLAY_VIEWERS.BYSTANDER]
            .filter(viewerKnown)
            .map((kind) => ({ kind, label: viewerLabelOf(kind) }));
    }

    /** 密级可选值（视图画选择器用；文案唯一出处仍在桥上）。 */
    secrecyChoices() {
        return secrecyOptions();
    }

    /**
     * 一幕的「当时谁能看到什么」（由**已录对白**重建节目单，一句都不生成）。
     *   `viewerId` 取当前视角的角色 id：本人 / 对方由桥给，旁观取空（旁观只看公开部分）。
     *   ★ 不再另开一个 `programSteps(programLike)` 透传口：产品面真正需要的是
     *     「按台账里的节目 id + 幕号取」，多一个泛用口只会在门禁里变成一条没人调的死方法。
     */
    programActSteps(programId, actIndex, viewerId) {
        return actStepsOf(this.getProgram(programId), actIndex, String(viewerId || ''));
    }

    getSourceCatalog() {
        return ALBUM_SOURCE_CATALOG.map(source => ({ ...source }));
    }

    getSourceDefinition(sourceKey = 'other') {
        return this.getSourceCatalog().find(source => source.key === sourceKey)
            || this.getSourceCatalog().find(source => source.key === 'other');
    }

    getImageSourceKey(image = {}) {
        const path = String(image?.path || image?.src || '').toLowerCase();
        if (/\/phone_(?:[^/]*_)?emoji(?:_|\.)/i.test(path)) return 'wechat-custom';
        if (/\/phone_wechat_(?:img|sticker)(?:_|\.)/i.test(path)) return 'wechat-chat';

        const sourceKeys = new Set();
        const sources = Array.isArray(image?.sources) ? image.sources : [];
        for (const source of sources) {
            const value = String(source || '').trim().toLowerCase();
            if (!value) continue;
            if (/微信自定义表情|自定义表情|表情包|custom.?emoji/.test(value)) sourceKeys.add('wechat-custom');
            else if (/微信聊天|微信消息|^微信$|wechat/.test(value)) sourceKeys.add('wechat-chat');
            else if (/蜜语|honey/.test(value)) sourceKeys.add('honey');
            else if (/日记|diary/.test(value)) sourceKeys.add('diary');
            else if (/微博|weibo/.test(value)) sourceKeys.add('weibo');
            else if (/万象|wangxiang/.test(value)) sourceKeys.add('wangxiang');
            else if (/魔坊|mofo/.test(value)) sourceKeys.add('mofo');
            else if (/壁纸|wallpaper/.test(value)) sourceKeys.add('wallpaper');
            else if (/头像|avatar/.test(value)) sourceKeys.add('avatar');
            else if (/app\s*图标|app.?icon/.test(value)) sourceKeys.add('app-icon');
            else if (/本地上传|本地备份|全局设置|聊天数据|小手机/.test(value)) sourceKeys.add('local-upload');
        }
        const priority = [
            'wechat-custom', 'honey', 'wechat-chat', 'diary', 'weibo', 'wangxiang',
            'mofo', 'wallpaper', 'avatar', 'app-icon', 'local-upload'
        ];
        return priority.find(key => sourceKeys.has(key)) || 'other';
    }

    getImageSourceLabel(image = {}) {
        return this.getSourceDefinition(image?.sourceKey || this.getImageSourceKey(image))?.label || '其他媒体';
    }

    groupImagesBySource(images = []) {
        const groups = new Map(this.getSourceCatalog().map(source => [source.key, { ...source, images: [] }]));
        (Array.isArray(images) ? images : []).forEach(image => {
            const sourceKey = image?.sourceKey || this.getImageSourceKey(image);
            const group = groups.get(sourceKey) || groups.get('other');
            group.images.push(image);
        });
        return Array.from(groups.values()).filter(group => group.images.length > 0);
    }

    async deleteImage(pathLike) {
        const normalized = this.normalizePath(pathLike);
        if (!normalized) return { success: false, message: '媒体路径无效' };

        const imageManager = window.VirtualPhone?.imageManager;
        let deleteResult = { attempted: false, success: false };
        if (imageManager?.deleteManagedBackgroundByPath) {
            deleteResult = await imageManager.deleteManagedBackgroundByPath(normalized, { quiet: true });
        }

        await this.cleanupReferences(normalized);
        await this._markDeleted(normalized);
        await this._removeUploadIndexPath(normalized);

        return {
            success: true,
            fileDeleted: !!deleteResult.success,
            attempted: !!deleteResult.attempted,
            message: deleteResult.success ? '文件已删除' : '媒体记录已删除'
        };
    }

    async deleteImages(pathLikes = []) {
        const normalizedPaths = Array.from(new Set(
            (Array.isArray(pathLikes) ? pathLikes : [])
                .map(path => this.normalizePath(path))
                .filter(Boolean)
        ));
        if (normalizedPaths.length === 0) {
            return { successCount: 0, failCount: 0, results: [] };
        }

        const imageManager = window.VirtualPhone?.imageManager;
        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const path of normalizedPaths) {
            let deleteResult = { attempted: false, success: false };
            try {
                if (imageManager?.deleteManagedBackgroundByPath) {
                    deleteResult = await imageManager.deleteManagedBackgroundByPath(path, { quiet: true });
                }
                await this.cleanupReferences(path);
                await this._markDeleted(path);
                await this._removeUploadIndexPath(path);
                successCount += 1;
                results.push({ path, success: true, fileDeleted: !!deleteResult.success, attempted: !!deleteResult.attempted });
            } catch (e) {
                failCount += 1;
                results.push({ path, success: false, error: e });
            }
        }

        return { successCount, failCount, results };
    }

    async markMissingImage(pathLike) {
        const normalized = this.normalizePath(pathLike);
        if (!normalized || !this.isManagedMediaPath(normalized)) return false;
        await this._markDeleted(normalized);
        await this._removeUploadIndexPath(normalized);
        return true;
    }

    async cleanupReferences(pathLike) {
        const target = this.normalizePath(pathLike);
        if (!target) return;

        const imageManager = window.VirtualPhone?.imageManager;
        if (imageManager?.cache) {
            let changed = false;
            if (this.normalizePath(imageManager.cache.wallpaper) === target) {
                imageManager.cache.wallpaper = null;
                changed = true;
                window.dispatchEvent(new CustomEvent('phone:updateWallpaper', { detail: { wallpaper: null } }));
            }

            ['appIcons', 'avatars'].forEach(groupKey => {
                const group = imageManager.cache[groupKey];
                if (!group || typeof group !== 'object') return;
                Object.keys(group).forEach(key => {
                    if (this.normalizePath(group[key]) === target) {
                        delete group[key];
                        changed = true;
                    }
                });
            });

            if (changed && imageManager.saveImages) {
                await imageManager.saveImages(imageManager.cache);
                window.dispatchEvent(new CustomEvent('phone:updateAppIcon'));
            }
        }

        if (this.normalizePath(this.storage?.get?.('phone-card-time-image')) === target) {
            await this.storage.remove('phone-card-time-image');
            window.dispatchEvent(new CustomEvent('phone:updateWallpaper', { detail: { cardTimeImage: null } }));
        }

        this._cleanupStorageStore(this.storage?._getChatMetadataStore?.(), target, 'chat');
        this._cleanupStorageStore(this.storage?._getExtensionSettingsStore?.(), target, 'settings');
        this._cleanupHoneyRuntimeReferences(target);
    }

    _cleanupHoneyRuntimeReferences(target) {
        const honeyApp = window.VirtualPhone?.honeyApp;
        const honeyData = honeyApp?.honeyData;
        const honeyView = honeyApp?.honeyView;
        if (!honeyData && !honeyView) return;

        const clean = value => this._removePathFromValue(value, target, new Set());

        const recommendTopics = honeyData?.getRecommendTopics?.();
        const recommendResult = clean(recommendTopics);
        if (recommendResult.changed) honeyData?.saveRecommendTopics?.(recommendResult.value);

        const topicScenes = honeyData?.getTopicScenes?.();
        const topicScenesResult = clean(topicScenes);
        if (topicScenesResult.changed) honeyData?.saveTopicScenes?.(topicScenesResult.value);

        const lastScene = honeyData?.getLastSceneData?.();
        const lastSceneResult = clean(lastScene);
        if (lastSceneResult.changed) honeyData?.saveLastSceneData?.(lastSceneResult.value);

        const viewTopicsResult = clean(honeyView?.recommendTopics);
        if (viewTopicsResult.changed) {
            honeyView.recommendTopics = viewTopicsResult.value;
            honeyData?.saveRecommendTopics?.(viewTopicsResult.value);
        }

        const selectedTopicResult = clean(honeyView?.selectedTopic);
        if (selectedTopicResult.changed) honeyView.selectedTopic = selectedTopicResult.value;

        const currentSceneResult = clean(honeyView?.currentSceneData);
        if (currentSceneResult.changed) {
            honeyView.currentSceneData = currentSceneResult.value;
            honeyView._persistCurrentScene?.();
        }
    }

    normalizePath(pathLike) {
        const raw = String(pathLike || '').trim();
        if (!raw) return '';
        let value = raw.split('?')[0].split('#')[0];
        try {
            if (/^https?:\/\//i.test(value)) {
                value = new URL(value).pathname;
            }
        } catch (e) { }
        return value;
    }

    toDisplayPath(pathLike) {
        const raw = String(pathLike || '').trim();
        if (!raw) return '';
        if (/^https?:\/\//i.test(raw)) return raw;
        return this.normalizePath(raw);
    }

    isManagedImagePath(pathLike) {
        const value = this.normalizePath(pathLike);
        return this.isManagedMediaPath(value) && !this.isVideoPath(value);
    }

    isManagedMediaPath(pathLike) {
        const value = this.normalizePath(pathLike);
        return /\/backgrounds\/phone_[^/]+/i.test(value);
    }

    isVideoPath(pathLike) {
        return VIDEO_EXT_RE.test(this.normalizePath(pathLike));
    }

    getFilename(pathLike) {
        const normalized = this.normalizePath(pathLike);
        return normalized.split('/').filter(Boolean).pop() || 'image';
    }

    _scanKnownStores(addImage) {
        const imageManager = window.VirtualPhone?.imageManager;
        this._scanAlbumUploadIndex(addImage);
        this._scanValue(imageManager?.cache, '本地上传', addImage);
        this._scanValue(this.storage?.get?.('phone-card-time-image'), '时间卡片背景', addImage);
        this._scanValue(this.storage?._getChatMetadataStore?.(), '聊天数据', addImage);
        this._scanValue(this.storage?._getExtensionSettingsStore?.(), '全局设置', addImage);
    }

    _scanAlbumUploadIndex(addImage) {
        try {
            const raw = this.storage?.get?.('phone_album_upload_index', '[]');
            const list = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
            if (!Array.isArray(list)) return;
            list.forEach(item => {
                const path = typeof item === 'string' ? item : item?.path;
                addImage(path, this._labelFromUploadPrefix(item?.prefix), {
                    createdAt: Number(item?.createdAt || 0)
                });
            });
        } catch (e) { }
    }

    _scanRuntimeData(addImage) {
        const phone = window.VirtualPhone || {};
        const wechatData = phone.wechatApp?.wechatData?.data;
        this._scanValue(wechatData?.customEmojis, '微信自定义表情', addImage);
        this._scanValue(wechatData?.userInfo, '头像', addImage);
        this._scanValue(wechatData?.contacts, '头像', addImage);
        this._scanValue(wechatData?.chats, '微信聊天', addImage);
        this._scanValue(wechatData?.moments, '微信聊天', addImage);
        try {
            const chats = wechatData?.chats || [];
            chats.forEach(chat => {
                const messages = phone.wechatApp.wechatData.getMessages?.(chat.id);
                this._scanValue(messages, `微信聊天:${chat.name || chat.id}`, addImage);
            });
        } catch (e) { }
        this._scanValue(phone.weiboApp?.weiboData, '微博', addImage);
        this._scanValue(phone.honeyApp?.honeyData, '蜜语', addImage);
        this._scanValue(phone.diaryApp?.diaryData, '日记', addImage);
        this._scanValue(phone.mofoApp?.mofoData, '魔坊', addImage);
        const wangxiangApp = phone.wangxiangApp;
        this._scanValue({
            marketplaceProducts: wangxiangApp?.marketplaceProducts,
            marketplaceOrders: wangxiangApp?.marketplaceOrders,
            inventoryItems: wangxiangApp?.inventoryItems,
            generatedTasks: wangxiangApp?.generatedTasks,
            managedTasks: wangxiangApp?.managedTasks
        }, '万象', addImage);
    }

    _scanLocalStorage(addImage) {
        try {
            for (let i = 0; i < window.localStorage.length; i += 1) {
                const key = window.localStorage.key(i);
                if (!key || (!key.includes('virtual_phone') && !key.includes('st_virtual_phone'))) continue;
                this._scanValue(window.localStorage.getItem(key), `本地备份:${key}`, addImage);
            }
        } catch (e) { }
    }

    _scanValue(value, sourceLabel, addImage, seen = new Set(), depth = 0) {
        if (value === null || value === undefined) return;
        if (typeof value === 'string') {
            let match;
            MANAGED_MEDIA_RE.lastIndex = 0;
            while ((match = MANAGED_MEDIA_RE.exec(value)) !== null) {
                addImage(match[1], sourceLabel);
            }
            return;
        }
        if (typeof value !== 'object' || seen.has(value) || depth > 8) return;
        seen.add(value);
        if (Array.isArray(value)) {
            value.forEach(item => this._scanValue(item, sourceLabel, addImage, seen, depth + 1));
            return;
        }
        Object.entries(value).forEach(([key, item]) => {
            const label = this._labelFromKey(key, sourceLabel);
            this._scanValue(item, label, addImage, seen, depth + 1);
        });
    }

    _labelFromKey(key, fallback) {
        const value = String(key || '').toLowerCase();
        if (['手机壁纸', '时间卡片背景', 'App图标', '头像', '微信自定义表情'].includes(fallback)) {
            return fallback;
        }
        if (value.includes('customemoji') || value.includes('custom_emoji')) return '微信自定义表情';
        if (value.includes('appicons') || value.includes('app_icons')) return 'App图标';
        if (value.includes('avatar')) return '头像';
        if (value.includes('wechat')) return '微信聊天';
        if (value.includes('weibo')) return '微博';
        if (value.includes('honey')) return '蜜语';
        if (value.includes('diary')) return '日记';
        if (value.includes('wangxiang')) return '万象';
        if (value.includes('mofo')) return '魔坊';
        if (value.includes('wallpaper')) return '手机壁纸';
        if (value.includes('card-time')) return '时间卡片背景';
        if (value.includes('phone_image_paths')) return '本地上传';
        if (value.includes('phone_album_upload_index')) return '本地上传';
        return fallback || '小手机';
    }

    _labelFromUploadPrefix(prefix) {
        const value = String(prefix || '').toLowerCase();
        if (value.includes('wallpaper')) return '手机壁纸';
        if (value.includes('card_time')) return '时间卡片背景';
        if (value.includes('icon_')) return 'App图标';
        if (value.includes('avatar')) return '头像';
        if (value.includes('wechat_sticker') || value.includes('wechat_img')) return '微信聊天';
        if (value.includes('emoji')) return '微信自定义表情';
        if (value.includes('wechat')) return '微信聊天';
        if (value.includes('weibo')) return '微博';
        if (value.includes('honey')) return '蜜语';
        if (value.includes('diary')) return '日记';
        if (value.includes('wangxiang')) return '万象';
        if (value.includes('mofo')) return '魔坊';
        return '本地上传';
    }

    _cleanupStorageStore(store, target, scope) {
        if (!store || typeof store !== 'object') return;
        let changed = false;
        Object.keys(store).forEach(key => {
            if (key === this.deletedKey) return;
            const result = this._removePathFromValue(store[key], target);
            if (result.changed) {
                store[key] = result.value;
                changed = true;
            }
        });

        if (!changed) return;
        if (scope === 'chat') {
            this.storage?._debouncedSaveChat?.();
        } else {
            this.storage?._queuedSaveExtensionSettings?.();
        }
    }

    _removePathFromValue(value, target, seen = new Set()) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (this.normalizePath(trimmed) === target) {
                return { value: '', changed: true };
            }
            if (!trimmed.includes('/backgrounds/')) {
                return { value, changed: false };
            }
            try {
                const parsed = JSON.parse(trimmed);
                const result = this._removePathFromValue(parsed, target, seen);
                if (result.changed) {
                    return { value: JSON.stringify(result.value), changed: true };
                }
            } catch (e) { }
            if (trimmed.includes(target)) {
                return { value: value.replaceAll(target, ''), changed: true };
            }
            return { value, changed: false };
        }

        if (value === null || value === undefined || typeof value !== 'object' || seen.has(value)) {
            return { value, changed: false };
        }
        seen.add(value);

        if (Array.isArray(value)) {
            let changed = false;
            const next = [];
            value.forEach(item => {
                if (typeof item === 'string' && this.normalizePath(item) === target) {
                    changed = true;
                    return;
                }
                const result = this._removePathFromValue(item, target, seen);
                if (result.changed) changed = true;
                next.push(result.value);
            });
            return { value: next, changed };
        }

        let changed = false;
        Object.keys(value).forEach(key => {
            const item = value[key];
            if (typeof item === 'string' && this.normalizePath(item) === target) {
                delete value[key];
                changed = true;
                return;
            }
            const result = this._removePathFromValue(item, target, seen);
            if (result.changed) {
                value[key] = result.value;
                changed = true;
            }
        });
        return { value, changed };
    }

    _getDeletedSet() {
        try {
            const raw = this.storage?.get?.(this.deletedKey, '[]');
            const list = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
            return new Set(list.map(item => this.normalizePath(item)).filter(Boolean));
        } catch (e) {
            return new Set();
        }
    }

    async _markDeleted(pathLike) {
        const deleted = this._getDeletedSet();
        const normalized = this.normalizePath(pathLike);
        if (!normalized) return;
        deleted.add(normalized);
        await this.storage?.set?.(this.deletedKey, JSON.stringify(Array.from(deleted).slice(-500)));
    }

    async _removeUploadIndexPath(pathLike) {
        const target = this.normalizePath(pathLike);
        if (!target) return;
        try {
            const raw = this.storage?.get?.('phone_album_upload_index', '[]');
            const list = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
            if (!Array.isArray(list)) return;
            const next = list.filter(item => this.normalizePath(item?.path || item) !== target);
            if (next.length === list.length) return;
            await this.storage?.set?.('phone_album_upload_index', JSON.stringify(next));
        } catch (e) { }
    }
}
