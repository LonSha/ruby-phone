/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  世界书选择与注入辅助
 * ======================================================== */

/* [v3.80.0 · 缝入 A1] 世界书写链路。修前本模块**只有读通道**（loadWorldInfo 一族）：
 *   模型写下的长期事实没有任何去处，只能挤在会话桶里，换卡即丢。
 *   纯函数那一半（去重 / 归一 / 合并 / 读数行）在 config/worldbook-write.js（零 IO，
 *   便于负控制直接破坏）；本文件只留**宿主交互**那一半（读→合并→写→刷缓存）。 */
import { mergeEntries, toEntriesMap, worldbookWriteLine } from './worldbook-write.js';
/* [v4.89.0 · 第九批缝入] 有界并发与写入串行化（config/background-queue.js）。
 *   修前两处真缺陷：① `listAvailableWorldbooks` 用 `Promise.all(books.map(...))` —— 有多少本书
 *   就同时打多少次读，世界书多的用户一次刷列表就是几十路并发；
 *   ② `writeMemoryEntries` 的「读→合并→写」三步没有互斥，两次并发写同一本书时
 *   双方都读到同一份旧表、各自整表回写 ⇒ 后写的那次把前一次的新增整批覆盖掉，
 *   症状是「写了两条只剩一条」，不报错。 */
import { runLimited, createBoundedQueue } from './background-queue.js';
/* [v4.90.0 · 第十批缝入 5/8] 来源许可（按书名排除）。纯函数那一半在
 *   config/source-permission.js（零 IO，便于负控制直接破坏）。修前本模块
 *   「注入哪几本」只有一个按 App 的布尔：一开就把选中的书全量拼进去，
 *   没有「这一本在这个 App 里排除掉」这一格。 */
import {
    canonicalBookName, normalizeExcludedBooks, filterSourcesByPermission,
    filterBookNamesByPermission, dedupeBookNames, inspectVerdict
} from './source-permission.js';
/* [v4.90.0 · 第十批缝入 2+7/8] 世界书条目设置面（position / order / 常驻三色 / 标题序号 / 净化）。
 *   纯函数那一半在 config/worldbook-entry-settings.js。修前写出去的记忆条目**全是默认形态**：
 *   position 不写、order 不写、标题是 `记忆 <uid>` 裸名，列表里没有序号可读、也没法让某条常驻。 */
import {
    applyLorebookEntrySettings, formatEntryTitleAtNumber, sanitizeEntryTitle,
    normalizeLorebookEntrySettings, nextEntryNumber, entrySettingsLine
} from './worldbook-entry-settings.js';

const WORLD_INFO_GET_ENDPOINT = '/api/worldinfo/get';
const WORLD_INFO_SAVE_ENDPOINT = '/api/worldinfo/edit';
let cachedCsrfToken = '';
let cachedCsrfTokenAt = 0;

function safeString(value) {
    return String(value ?? '').trim();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function uniqueStrings(values = []) {
    const seen = new Set();
    const result = [];
    values.forEach((value) => {
        const text = safeString(value);
        if (!text || seen.has(text)) return;
        seen.add(text);
        result.push(text);
    });
    return result;
}

function normalizeSearchText(value) {
    return safeString(value)
        .normalize('NFKC')
        .toLocaleLowerCase('zh-CN')
        .replace(/\s+/g, ' ');
}

function getWorldbookSearchText(source) {
    const entries = Array.isArray(source?.allEntries) ? source.allEntries : [];
    return normalizeSearchText([
        source?.name,
        source?.sourceLabel,
        ...entries.flatMap((entry) => [entry?.comment, entry?.content])
    ].join('\n'));
}

function parseBooleanSetting(value, fallback = false) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return fallback;
}

function isTruthyFlag(value) {
    if (value === true || value === 1) return true;
    if (typeof value === 'string') {
        return ['true', '1', 'yes', 'on', 'enabled', 'checked'].includes(value.trim().toLowerCase());
    }
    return false;
}

function isFalsyFlag(value) {
    if (value === false || value === 0) return true;
    if (typeof value === 'string') {
        return ['false', '0', 'no', 'off', 'disabled', 'unchecked'].includes(value.trim().toLowerCase());
    }
    return false;
}

function isWorldEntryEnabled(entry) {
    if (typeof entry === 'string') return true;
    if (!entry || typeof entry !== 'object') return false;

    // SillyTavern world info entries use `disable: true` for the kill switch.
    // Keep aliases for imported/older schemas so closed entries never leak into phone prompts.
    if (isTruthyFlag(entry.disable) || isTruthyFlag(entry.disabled)) return false;
    if (Object.prototype.hasOwnProperty.call(entry, 'enabled') && isFalsyFlag(entry.enabled)) return false;
    if (Object.prototype.hasOwnProperty.call(entry, 'active') && isFalsyFlag(entry.active)) return false;
    return true;
}

function getRawEntries(entries) {
    if (Array.isArray(entries)) return entries;
    if (entries && typeof entries === 'object') return Object.values(entries);
    return [];
}

function hasWorldEntries(entries) {
    return getRawEntries(entries).length > 0;
}

function safeStorageSegment(value) {
    return safeString(value)
        .replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
}

function normalizeEntries(entries, options = {}) {
    const includeDisabled = options.includeDisabled === true;
    return getRawEntries(entries)
        .map((rawEntry, index) => {
            const enabled = isWorldEntryEnabled(rawEntry);
            const entry = typeof rawEntry === 'string' ? { content: rawEntry } : (rawEntry || {});
            return {
                uid: safeString(entry.uid ?? entry.id ?? index) || String(index),
                comment: safeString(entry.comment || entry.name || entry.title || ''),
                content: safeString(entry.content || entry.text || entry.value || ''),
                enabled
            };
        })
        .filter((entry) => entry.content && (includeDisabled || entry.enabled));
}

function normalizeEntrySelectionMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .map(([sourceId, entryIds]) => [safeString(sourceId), uniqueStrings(Array.isArray(entryIds) ? entryIds : [])])
        .filter(([sourceId]) => sourceId));
}

function normalizeWorldInfoData(data) {
    if (!data) return null;
    if (Array.isArray(data)) return { entries: data };
    if (data.entries) return data;
    if (data.data?.entries) return data.data;
    if (data.worldInfo?.entries) return data.worldInfo;
    if (data.worldInfoData?.entries) return data.worldInfoData;
    if (data.world_info?.entries) return data.world_info;
    if (typeof data === 'object') return { entries: data };
    return null;
}

function createWorldBook(name, index = 0, extra = {}) {
    const cleanName = safeString(name);
    return {
        id: `world:${cleanName}`,
        name: cleanName,
        source: 'world',
        sourceLabel: '酒馆世界书',
        entries: [],
        legacyIds: [`fallback_${index}`],
        ...extra
    };
}

async function getCsrfToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedCsrfToken && now - cachedCsrfTokenAt < 60000) {
        return cachedCsrfToken;
    }

    try {
        const response = await fetch(`/csrf-token?_=${now}`, {
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok) return '';
        const data = await response.json().catch(() => null);
        cachedCsrfToken = safeString(data?.token);
        cachedCsrfTokenAt = now;
        return cachedCsrfToken;
    } catch (_error) {
        return '';
    }
}

async function getJsonHeaders(forceRefresh = false) {
    const headers = {};

    if (!forceRefresh) {
        try {
            if (typeof window.getRequestHeaders === 'function') {
                Object.assign(headers, window.getRequestHeaders() || {});
            }
        } catch (_error) {
            // Fall back to /csrf-token below.
        }
    }

    headers['Content-Type'] = headers['Content-Type'] || headers['content-type'] || 'application/json';
    if (!headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
        const token = await getCsrfToken(forceRefresh);
        if (token) headers['X-CSRF-Token'] = token;
    }
    return headers;
}

function isCsrfError(status, text = '') {
    return [400, 401, 403].includes(Number(status))
        && /csrf|forbidden|invalid token/i.test(String(text || ''));
}

async function fetchJson(url, body = {}, options = {}) {
    const forceRefresh = options.forceRefresh === true;
    const headers = await getJsonHeaders(forceRefresh);

    const response = await fetch(url, {
        method: 'POST',
        headers,
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        if (!forceRefresh && isCsrfError(response.status, text)) {
            cachedCsrfToken = '';
            cachedCsrfTokenAt = 0;
            return fetchJson(url, body, { forceRefresh: true });
        }
        throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
    }
    return response.json();
}

async function fetchWorldInfoByName(name) {
    const payloads = [
        { name },
        { world: name },
        { file: name },
        { filename: name }
    ];

    for (const body of payloads) {
        try {
            const data = normalizeWorldInfoData(await fetchJson(WORLD_INFO_GET_ENDPOINT, body));
            if (hasWorldEntries(data?.entries)) {
                return { ...data, _phoneReadSource: `${WORLD_INFO_GET_ENDPOINT} ${Object.keys(body)[0]}` };
            }
        } catch (error) {
            console.debug('[WorldbookManager] 世界书接口参数尝试失败:', { name, body, error });
        }
    }

    return null;
}

export class WorldbookManager {
    constructor(storage = null) {
        this.storage = storage;
        this._cache = null;
        this._cacheAt = 0;
        this._worldInfoModulePromise = null;
        this._stContextModulePromise = null;
        /* [v4.89.0] 写入串行队列：一次只跑一个「读→合并→写」，后来的排队。
         *   满队不是失败：`writeMemoryEntries` 据 `queued:false` 如实回 `busy`。 */
        this._writeQueue = createBoundedQueue({ maxItems: 8, maxRetries: 1, retryBaseMs: 120 });
    }

    _getWorldNamesFromWindow() {
        if (Array.isArray(window.world_names)) return window.world_names;
        if (Array.isArray(window.worldNames)) return window.worldNames;
        return [];
    }

    async _getWorldNamesFromFrontendModule() {
        const worldModule = await this._loadWorldInfoModule();
        if (Array.isArray(worldModule?.world_names)) return worldModule.world_names;
        if (Array.isArray(worldModule?.worldInfo?.world_names)) return worldModule.worldInfo.world_names;
        return [];
    }

    _appendWorldBook(list, uniqueNames, name, index = 0, extra = {}) {
        const cleanName = safeString(name);
        if (!cleanName) return;
        if (uniqueNames.has(cleanName)) {
            const existing = list.find((book) => book.name === cleanName);
            if (existing && Array.isArray(extra.legacyIds)) {
                existing.legacyIds = uniqueStrings([...(existing.legacyIds || []), ...extra.legacyIds]);
            }
            return;
        }
        list.push(createWorldBook(cleanName, index, extra));
        uniqueNames.add(cleanName);
    }

    matchesSelection(source, selectedIds = []) {
        const selected = new Set((selectedIds || []).map(String));
        return selected.has(source?.id)
            || selected.has(source?.name)
            || (source?.legacyIds || []).some((id) => selected.has(id));
    }

    /**
     * 获取酒馆系统中存在的全部世界书列表，不判断是否激活。
     * 首选酒馆真实 world_names，DOM 下拉框只用于补充遗漏。
     */
    async fetchAllAvailableWorldBooks() {
        const allBooks = [];
        const uniqueNames = new Set();

        const worldNames = uniqueStrings([
            ...(await this._getWorldNamesFromFrontendModule()),
            ...this._getWorldNamesFromWindow()
        ]);
        worldNames.forEach((name, index) => {
            this._appendWorldBook(allBooks, uniqueNames, name, index);
        });

        try {
            const selectors = ['#world_info option', '#world_editor_select option'];
            const options = selectors.flatMap((selector) => {
                const found = Array.from(document.querySelectorAll(selector));
                if (found.length > 0) return found;
                return typeof window.$ === 'function' ? window.$(selector).toArray() : [];
            });

            options.forEach((option) => {
                const id = safeString(option?.getAttribute?.('value') ?? option?.value);
                const name = safeString(option?.textContent || option?.innerText || '');
                const isHidden = option?.style?.display === 'none' || option?.hidden === true;
                const isPlaceholder = !id || /^-+$/.test(id) || /pick to edit|选择以编辑/i.test(name);
                if (!name || isHidden || isPlaceholder) return;
                this._appendWorldBook(allBooks, uniqueNames, name, allBooks.length, {
                    legacyIds: [id, `fallback_${allBooks.length}`].filter(Boolean)
                });
            });
        } catch (error) {
            console.warn('[WorldbookManager] 从 DOM 提取全部世界书失败，尝试备用方案...', error);
        }

        return allBooks;
    }

    _getContext() {
        if (typeof window.SillyTavern?.getContext === 'function') {
            return window.SillyTavern.getContext();
        }
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
            return SillyTavern.getContext();
        }
        return null;
    }

    _isLobbyMode(context = null) {
        const ctx = context || this._getContext();
        const charName = safeString(ctx?.name2);
        if (/^SillyTavern System$/i.test(charName)) return true;

        const chatId = safeString(ctx?.chatMetadata?.file_name || ctx?.chatId);
        if (chatId) return false;
        if (charName) return false;
        return true;
    }

    _getCharacterScopeKey() {
        const context = this._getContext();
        if (this._isLobbyMode(context)) {
            return 'lobby';
        }
        const characterId = context?.characterId;
        const characterName = safeString(context?.characters?.[characterId]?.name || context?.name2 || '');
        const idText = characterId !== undefined && characterId !== null ? safeString(characterId) : '';
        const rawKey = idText
            ? `${idText}_${characterName || 'character'}`
            : characterName;
        return safeStorageSegment(rawKey || 'default_character');
    }

    async _getContextWithWorldInfo() {
        const candidates = [];
        const stContextModule = await this._loadStContextModule();
        const moduleContext = stContextModule?.getContext?.();
        if (moduleContext) candidates.push(moduleContext);

        const windowContext = this._getContext();
        if (windowContext) candidates.push(windowContext);

        return candidates.find((context) => typeof context?.getWorldInfo === 'function')
            || candidates.find(Boolean)
            || null;
    }

    async _loadStContextModule() {
        try {
            if (!this._stContextModulePromise) {
                this._stContextModulePromise = import('../../../../st-context.js');
            }
            return await this._stContextModulePromise;
        } catch (error) {
            console.warn('[WorldbookManager] 导入 st-context 失败:', error);
            return null;
        }
    }

    async _loadWorldInfoModule() {
        try {
            if (!this._worldInfoModulePromise) {
                this._worldInfoModulePromise = import('/scripts/world-info.js')
                    .catch(() => import('../../../../world-info.js'));
            }
            return await this._worldInfoModulePromise;
        } catch (error) {
            console.warn('[WorldbookManager] 导入 world-info 失败:', error);
            return null;
        }
    }

    _extractWorldInfoModuleData(worldModule) {
        const worldInfo = worldModule?.world_info || window.world_info;
        return normalizeWorldInfoData(
            worldModule?.worldInfoData
            || worldModule?.world_info_data
            || worldInfo?.worldInfoData
            || worldInfo?.world_info
            || worldInfo
        );
    }

    async _refreshWorldInfoCache(name) {
        const worldModule = await this._loadWorldInfoModule();
        if (typeof worldModule?.loadWorldInfo === 'function') {
            await worldModule.loadWorldInfo(name);
            return true;
        }
        const worldInfo = worldModule?.world_info || window.world_info;
        if (typeof worldInfo?.loadWorldInfoData === 'function') {
            await worldInfo.loadWorldInfoData(name);
            return true;
        }

        const context = await this._getContextWithWorldInfo();
        if (typeof context?.loadWorldInfo === 'function') {
            await context.loadWorldInfo(name);
            return true;
        }

        return false;
    }

    async _loadWorldInfoViaFrontendModule(name) {
        try {
            const worldModule = await this._loadWorldInfoModule();
            if (typeof worldModule?.loadWorldInfo === 'function') {
                const loaded = normalizeWorldInfoData(await worldModule.loadWorldInfo(name));
                if (hasWorldEntries(loaded?.entries)) {
                    return { ...loaded, _phoneReadSource: '/scripts/world-info.js loadWorldInfo' };
                }

                const cached = this._extractWorldInfoModuleData(worldModule);
                if (hasWorldEntries(cached?.entries)) {
                    return { ...cached, _phoneReadSource: '/scripts/world-info.js cache after loadWorldInfo' };
                }
            }

            const context = await this._getContextWithWorldInfo();
            if (typeof context?.getWorldInfo === 'function') {
                const direct = normalizeWorldInfoData(await context.getWorldInfo(name));
                if (hasWorldEntries(direct?.entries)) {
                    return { ...direct, _phoneReadSource: 'context.getWorldInfo' };
                }
            }

            await this._refreshWorldInfoCache(name);

            const refreshedContext = await this._getContextWithWorldInfo();
            if (typeof refreshedContext?.getWorldInfo === 'function') {
                const after = normalizeWorldInfoData(await refreshedContext.getWorldInfo(name));
                if (hasWorldEntries(after?.entries)) {
                    return { ...after, _phoneReadSource: 'context.getWorldInfo.afterRefresh' };
                }
            }

            const moduleData = this._extractWorldInfoModuleData(worldModule);
            return hasWorldEntries(moduleData?.entries)
                ? { ...moduleData, _phoneReadSource: 'world-info module cache' }
                : null;
        } catch (error) {
            console.warn('[WorldbookManager] 调用酒馆前端世界书读取失败，尝试接口兜底:', error);
            return null;
        }
    }

    async _loadWorldContent(book) {
        const name = safeString(book?.name);
        if (!name) return { ...book, entries: [] };

        try {
            let data = normalizeWorldInfoData(await this._loadWorldInfoViaFrontendModule(name));
            if (!data) {
                data = await fetchWorldInfoByName(name);
            }
            const allEntries = normalizeEntries(data?.entries, { includeDisabled: true });
            const entries = allEntries.filter((entry) => entry.enabled);
            const rawEntries = getRawEntries(data?.entries);
            const totalEntries = rawEntries.length;
            const disabledEntries = rawEntries.filter((entry) => !isWorldEntryEnabled(entry)).length;
            console.info('[WorldbookManager] 世界书读取结果:', {
                name,
                source: data?._phoneReadSource || 'unknown',
                entries: entries.length,
                totalEntries,
                disabledEntries,
                rawEntriesType: Array.isArray(data?.entries) ? 'array' : typeof data?.entries
            });
            return {
                ...book,
                entries,
                allEntries,
                totalEntries,
                disabledEntries,
                /* [v3.80.0 · 缝入 A1] 读出来就必须说得出「这份能被写」：没读到内容时
                 *   这一格如实是空串（写回会走 read-failed），而不是悄悄省略 ——
                 *   省略会让消费方分不清「不能写」和「这一格不存在」。 */
                writeLine: entries.length ? '可写（追加模式·按内容去重）' : '未读到条目：写回前会重新现读一次'
            };
        } catch (error) {
            console.warn(`[WorldbookManager] 读取世界书失败: ${name}`, error);
            return { ...book, entries: [], allEntries: [], totalEntries: 0, disabledEntries: 0, writeLine: '读取失败：写回会再试一次现读' };
        }
    }

    /**
     * [v3.80.0 · 缝入 A1] 把条目**追加**进指定世界书（默认 append 模式，绝不覆盖）。
     *
     * 两条铁律（在纯函数层已实现，这里负责不被宿主绕开）：
     *   ① 绝不覆盖用户手写条目 —— `update-by-uid` 模式也只改 `source` 相同的那条；
     *   ② 按**归一化内容**去重（全角/大小写/空白差异不算新条目）。
     *
     * @returns {{ok:boolean, reason:string, name:string, added:Array, skipped:Array,
     *            replaced:Array, line:string, entries:number}}
     *   `reason`：`'ok'` / `'no-name'` / `'empty'` / `'read-failed'` / `'write-failed'` / `'busy'`
     *   —— 六态互不同形（写失败要重试、没东西可写不用、`busy` 要等一会再来）。
     *
     * [v4.89.0 · 第九批缝入] 本方法是**排队入口**，真正的三步在 `_writeMemoryEntriesNow`。
     *   串行化前：两次并发写同一本书，双方都读到同一份旧表、各自整表回写 ⇒
     *   后写的那次把前一次的新增整批覆盖掉（`mergeEntries` 只保证单次合并正确，
     *   挡不住两个合并结果互相覆盖），症状是「写了两条只剩一条」且不报错。
     *   队列满（8 条）时如实回 `busy`，不无限堆积。
     */
    async writeMemoryEntries(name, incoming, options = {}) {
        const slot = this._writeQueue.enqueue(
            'worldbook-write',
            () => this._writeMemoryEntriesNow(name, incoming, options),
            { retryable: false }
        );
        const shape = (reason) => {
            const r = { ok: false, reason: reason, name: safeString(name), added: [], skipped: [], replaced: [], line: '', entries: 0 };
            this._lastWriteReceipt = Object.assign({ at: Date.now() }, r);
            return r;
        };
        if (!slot.queued) return shape('busy');
        const result = await slot.done;
        return result || shape('write-failed');
    }
    async _writeMemoryEntriesNow(name, incoming, options = {}) {
        const cleanName = safeString(name);
        const empty = { ok: false, reason: 'no-name', name: '', added: [], skipped: [], replaced: [], line: '', entries: 0 };
        /* [v3.83.0 · 计划 R-O7] **真回执**：写入的结论留一份在实例上，供诊断页读。
         *   为什么必须留在真源侧：诊断不许自行推测「上一次写成功了没有」——
         *   没有回执时它只能说「没跑过」（unknown），而那就分不出「没写过」与「写坏了」。 */
        const receipt = (result) => {
            this._lastWriteReceipt = Object.assign({ at: Date.now() }, result);
            return result;
        };
        if (!cleanName) return receipt(empty);
        if (!Array.isArray(incoming) || incoming.length === 0) {
            return receipt(Object.assign({}, empty, { name: cleanName, reason: 'empty' }));
        }

        /* 读：走**和展示同一条**读通道（读到的必须就是他看到的那一份）。 */
        let data = null;
        try {
            data = normalizeWorldInfoData(await this._loadWorldInfoViaFrontendModule(cleanName));
            if (!data) data = await fetchWorldInfoByName(cleanName);
        } catch (error) {
            console.warn('[WorldbookManager] 记忆写回前读取失败:', cleanName, error);
        }
        if (!data || typeof data !== 'object') {
            return receipt(Object.assign({}, empty, { name: cleanName, reason: 'read-failed' }));
        }

        const merged = mergeEntries(data.entries, incoming, {
            mode: options.mode === 'update-by-uid' ? 'update-by-uid' : 'append',
            forceRewriteSource: options.forceRewriteSource === true,
            maxEntries: options.maxEntries
        });
        /* [v4.90.0 · 第十批缝入 2+7/8] 新增条目过一道**设置面**：位置 / 排序 / 三色形态 /
         *   受控字段默认值 / 带序号的标题。三条边界：
         *     ① 只加工 `merged.added`（本次新写的），`merged.replaced` 是用户自己条目里的
         *        我写过的那条，它的设置是用户可能手调过的，重铺一遍等于覆盖他的调整；
         *     ② 序号从**现有条目**按同一模板往后数（`nextEntryNumber`），不按数组下标 ——
         *        下标会因为中间删过条目而回退，回退就撞号；
         *     ③ 标题只补序号不换内容：`comment` 已带占位则替换，否则前置（forceNumber）。 */
        /* [v4.91.0] 设置来源两级：调用方显式传的优先（一次性覆盖），否则用存起来的那份。
         *   存的那份按 App 分桶，`appKey` 由调用方给；给不出就落 `common` 桶 ——
         *   落 common 也不串味（bucket 本身就是键的一部分），只是与各 App 的分开。 */
        const settings = normalizeLorebookEntrySettings(
            options.entrySettings !== undefined ? options.entrySettings : this.getEntrySettings(safeString(options.appKey) || 'common')
        ).settings;
        const addedSet = new Set(merged.added.map((one) => one.uid));
        let seq = nextEntryNumber(merged.entries.filter((one) => !addedSet.has(Number(one.uid))), settings.titleFormat);
        let settingsNotes = [];
        for (const entry of merged.entries) {
            if (!addedSet.has(Number(entry.uid))) continue;
            const applied = applyLorebookEntrySettings(entry, settings, { orderNumber: seq });
            settingsNotes = settingsNotes.concat(applied.notes);
            /* 标题两步：① 模板补序号（forceNumber 兜住「模板里没占位」）；② 才把 `{{title}}`
             *   换成原标题 —— 顺序反了会把原标题里的数字卷进序号替换。
             *   ② 必须做：默认模板只有 `[000]`，不换就会把用户的标题整条吃掉（只留编号）。
             *   换完再净化（控制字符 / 剥空兜底）。 */
            const titled = formatEntryTitleAtNumber(settings.titleFormat, seq, { forceNumber: true });
            entry.comment = sanitizeEntryTitle(String(titled).replace(/\{\{title\}\}/g, String(entry.comment ?? '')));
            seq += 1;
        }
        /* 设置面的读数单独留一格（回执里可查），不混进 `line` ——
         *   `line` 是「写了几条」的账，把夹紧/降级混进去会让那行既不是账也不是诊断。 */
        this._lastEntrySettingsLine = merged.added.length
            ? entrySettingsLine({ settings: settings, notes: settingsNotes })
            : '';
        const line = worldbookWriteLine(merged);
        if (merged.added.length === 0 && merged.replaced.length === 0) {
            /* 「没有新增」不是失败：全部命中重复/空内容/超限，三态在 skipped 里可查。
             *   刻意仍返回 ok:true —— 报失败会诱导调用方重试，而重试一百次结果一样。 */
            return receipt({ ok: true, reason: 'ok', name: cleanName, added: [], skipped: merged.skipped, replaced: [], line: line, entries: merged.entries.length });
        }

        const payload = Object.assign({}, data, { entries: toEntriesMap(merged.entries) });
        const written = await this._saveWorldInfo(cleanName, payload);
        if (!written) {
            return receipt({ ok: false, reason: 'write-failed', name: cleanName, added: [], skipped: merged.skipped, replaced: [], line: line, entries: merged.entries.length });
        }
        /* 写完刷缓存：下一次列表读必须是新值（不刷就会拿 5 秒内的旧缓存，
         *   用户看到「写了但没变」）。 */
        await this._refreshWorldInfoCache(cleanName).catch(function () { return false; });
        this._cache = null;
        this._cacheAt = 0;
        return receipt({ ok: true, reason: 'ok', name: cleanName, added: merged.added, skipped: merged.skipped, replaced: merged.replaced, line: line, entries: merged.entries.length });
    }

    /** 写：先试前端模块出口，再试后端接口。两条都失败才如实报失败（不静默成功）。 */
    async _saveWorldInfo(name, data) {
        try {
            const worldModule = await this._loadWorldInfoModule();
            const worldInfo = worldModule?.world_info || window.world_info;
            if (typeof worldModule?.saveWorldInfo === 'function') {
                await worldModule.saveWorldInfo(name, data.entries, true);
                return true;
            }
            if (typeof worldInfo?.saveWorldInfo === 'function') {
                await worldInfo.saveWorldInfo(name, data.entries, true);
                return true;
            }
        } catch (error) {
            console.warn('[WorldbookManager] 世界书写回（前端模块）失败:', name, error);
        }
        try {
            await fetchJson(WORLD_INFO_SAVE_ENDPOINT, Object.assign({}, data, { name: name }));
            return true;
        } catch (error) {
            console.warn('[WorldbookManager] 世界书写回（后端接口）失败:', name, error);
        }
        return false;
    }

    async listAvailableWorldbooks(options = {}) {
        const force = options.force === true;
        const includeEntries = options.includeEntries === true;
        const now = Date.now();
        if (!force && this._cache && now - this._cacheAt < 5000 && (!includeEntries || this._cache.every(book => Array.isArray(book.allEntries)))) {
            return this._cache;
        }

        const books = await this.fetchAllAvailableWorldBooks();
        /* [v4.89.0] 有界并发：每次最多 4 本书同时读（原为全量同时打）。
         *   `failFast:false` —— 单本读失败只让那一本为空，不许把整次列表刷挂。 */
        this._cache = includeEntries
            ? await runLimited(books, (book) => this._loadWorldContent(book), { concurrency: 4, failFast: false })
            : books;
        this._cacheAt = now;
        return this._cache;
    }

    getSelectionKey(appKey) {
        return `phone_worldbook_selection_${appKey}_char_${this._getCharacterScopeKey()}`;
    }

    getAppSelectionKey(appKey) {
        return `phone_worldbook_selection_${appKey}`;
    }

    getGlobalSelectionKey(appKey) {
        return `chat_worldbook_selection_${appKey}`;
    }

    getPreviousChatScopedSelectionKey(appKey) {
        return `chat_worldbook_selection_${appKey}_char_${this._getCharacterScopeKey()}`;
    }

    getLegacySelectionKey(appKey) {
        return `phone-worldbook-selection-${appKey}`;
    }

    getEnabledKey(appKey) {
        return `phone_worldbook_enabled_${appKey}_char_${this._getCharacterScopeKey()}`;
    }

    getAppEnabledKey(appKey) {
        return `phone_worldbook_enabled_${appKey}`;
    }

    getGlobalEnabledKey(appKey) {
        return `chat_worldbook_enabled_${appKey}`;
    }

    getPreviousChatScopedEnabledKey(appKey) {
        return `chat_worldbook_enabled_${appKey}_char_${this._getCharacterScopeKey()}`;
    }

    getLegacyEnabledKey(appKey) {
        if (appKey === 'honey') return 'phone-honey-use-worldbook';
        if (appKey === 'wechat') return 'wechat-use-worldbook';
        if (appKey === 'games') return 'games-use-worldbook';
        return '';
    }
    /* [v4.90.0 · 第十批缝入 5/8] 来源许可（按书名排除）的键族。
     *   **按 App × 按角色**分桶，与 selection / enabled 同族同粒度：同一个 App 里
     *   「这本不带、那本带」是**每张卡各自的判断**（玩 A 卡排掉的仙侠设定集，
     *   玩 B 卡时正好要用），全局一份会互相冲掉。故这里**不做 global / app 级回退**，
     *   与 getEnabled 那三档回退刻意不同 —— 那是开关，这是清单，清单不该被上一级覆盖。 */
    getExcludedBooksKey(appKey) {
        return `phone_worldbook_excluded_${appKey}_char_${this._getCharacterScopeKey()}`;
    }
    /** 读排除表（已归一：去空 / 去重 / 双上限截断）。坏值一律降级成空表，绝不因它吞掉注入。 */
    getExcludedBooks(appKey) {
        let raw = null;
        try { raw = this.storage?.get?.(this.getExcludedBooksKey(appKey), null); } catch (_e) { raw = null; }
        return normalizeExcludedBooks(raw);
    }
    /** 写排除表。写的是归一后的**原文**（用户的写法原样留着，只在判等时用规范化键）。 */
    async setExcludedBooks(appKey, books) {
        const list = normalizeExcludedBooks(books);
        try { await this.storage?.set?.(this.getExcludedBooksKey(appKey), list); } catch (_e) { /* 写不进就下次再说 */ }
        return list;
    }
    /** 单本开合（UI 一行一个开关用它）。返回写完的**全表**，调用方可直接重渲染。 */
    async setBookExcluded(appKey, bookName, excluded) {
        const name = safeString(bookName);
        if (!name) return this.getExcludedBooks(appKey);
        const key = canonicalBookName(name);
        const now = this.getExcludedBooks(appKey);
        const has = now.some((one) => canonicalBookName(one) === key);
        if (excluded && !has) now.push(name);
        if (!excluded && has) return this.setExcludedBooks(appKey, now.filter((one) => canonicalBookName(one) !== key));
        return this.setExcludedBooks(appKey, now);
    }
    /* [v4.91.0 · 第十一批 5/8 收口] inspect 交互面的**取数那一半**。
     *   修前 `inspectVerdict` / `filterBookNamesByPermission` / `dedupeBookNames` 只有纯函数层自证：
     *   「这次会话里到底有哪些书、我排掉了几本、这份快照还作不作数」在界面上**没有一处可看**。
     *   用户只能从列表逐行读状态，书一多就不可数 —— 而「排了几本」正是排除表唯一的心智模型。
     *
     *   身份比对放在这里（纯件只判、不取）：拉书单是异步的，拉的过程中用户可能换会话。
     *   判 stale 而不是重拉一次 —— 重拉仍可能在重拉途中再换，循环没有终点。 */
    _permissionIdentity() {
        const context = this._getContext();
        return {
            chatId: safeString(context?.chatMetadata?.file_name || context?.chatId),
            hostChatId: safeString(context?.characterId ?? context?.name2)
        };
    }
    /**
     * 取一份**排除面快照**（ready / stale 两态，互不同形）。
     *   stale 时两份名单都给空数组并带因 —— 空数组与「真的没有书」必须分得开，
     *   故状态位在前、名单在后，调用方不许只看名单长度。
     * @returns {{status:'ready'|'stale', reason:string, excluded:Array<string>, kept:Array<string>, total:number}}
     */
    async inspectExcludedBooks(appKey) {
        const start = this._permissionIdentity();
        let names = [];
        let listReason = '';
        try {
            const sources = await this.listAvailableWorldbooks({ includeEntries: false, force: true });
            names = (Array.isArray(sources) ? sources : [])
                .map((source) => safeString(source?.name))
                .filter(Boolean);
        } catch (_e) { listReason = 'list-failed'; }
        const verdict = inspectVerdict(start, this._permissionIdentity());
        if (verdict.status !== 'ready') {
            return { status: 'stale', reason: verdict.reason || listReason || 'stale', excluded: [], kept: [], total: 0 };
        }
        const books = dedupeBookNames(names);
        const excludedSet = new Set(this.getExcludedBooks(appKey).map(canonicalBookName));
        /* 两份名单一次算清（同一份 books 派生，不各扫一遍 —— 各扫会给出互不相补的两份）。 */
        const kept = filterBookNamesByPermission({ bookNames: books, excludedBooks: [] })
            .filter((name) => !excludedSet.has(canonicalBookName(name)));
        const excluded = books.filter((name) => excludedSet.has(canonicalBookName(name)));
        return { status: 'ready', reason: listReason, excluded: excluded, kept: kept, total: books.length };
    }
    /**
     * 打开排除面弹层：把「共几本 / 排了几本」摆成可数的两份名单，每行可当场翻转。
     *   弹层只读一次快照，**不在弹层里重拉** —— 重拉会让手指下的行位移。
     */
    async openPermissionInspectDialog(appKey) {
        const existing = document.querySelector('.phone-worldbook-perm-modal');
        existing?._phoneWorldbookPermClose?.();
        const modal = document.createElement('div');
        modal.className = 'phone-worldbook-perm-modal';
        modal.innerHTML = `
            <button class="phone-worldbook-perm-backdrop" type="button" data-action="close" aria-label="关闭"></button>
            <section class="phone-worldbook-perm-dialog" role="dialog" aria-modal="true" aria-label="世界书排除面">
                <header class="phone-worldbook-perm-head">
                    <div class="phone-worldbook-perm-heading">
                        <h3>排除面</h3>
                        <span class="phone-worldbook-perm-count">读不到快照</span>
                    </div>
                    <button class="phone-worldbook-perm-close" type="button" data-action="close" title="关闭" aria-label="关闭">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </header>
                <div class="phone-worldbook-perm-body"><div class="phone-worldbook-status">正在读取当前世界书…</div></div>
                <footer class="phone-worldbook-perm-actions">
                    <button type="button" class="phone-worldbook-perm-done" data-action="close">关闭</button>
                </footer>
            </section>
        `;
        const host = document.querySelector('#phone-panel-content .phone-screen');
        if (!host) throw new Error('未找到小手机屏幕容器，无法打开排除面');
        host.appendChild(modal);
        return new Promise((resolve) => {
            let settled = false;
            const body = modal.querySelector('.phone-worldbook-perm-body');
            const count = modal.querySelector('.phone-worldbook-perm-count');
            const onKeyDown = (event) => { if (event.key === 'Escape') close(); };
            const close = () => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKeyDown);
                modal.remove();
                resolve(true);
            };
            modal._phoneWorldbookPermClose = close;
            modal.querySelectorAll('[data-action="close"]').forEach((button) => {
                button.addEventListener('click', close);
            });
            document.addEventListener('keydown', onKeyDown);
            const draw = (snapshot) => {
                body.replaceChildren();
                if (!snapshot || snapshot.status !== 'ready') {
                    const why = {
                        'chat-changed': '读取途中换了会话：这份名单属于上一个会话，请重开。',
                        'host-chat-changed': '读取途中换了角色：这份名单属于上一个角色，请重开。',
                        'no-chat-id': '当前没有会话标识，判不出名单归属。',
                        'list-failed': '世界书列表读取失败（不是「一本都没有」）。'
                    }[snapshot?.reason] || '快照已过期，请重开。';
                    count.textContent = '快照过期';
                    const hint = document.createElement('div');
                    hint.className = 'phone-worldbook-status is-error';
                    hint.textContent = why;
                    body.append(hint);
                    return;
                }
                count.textContent = `已排除 ${snapshot.excluded.length} / 共 ${snapshot.total} 本`;
                const section = (title, list, isExcluded) => {
                    const box = document.createElement('div');
                    box.className = 'phone-worldbook-perm-section';
                    const head = document.createElement('div');
                    head.className = 'phone-worldbook-perm-section-title';
                    head.textContent = `${title}（${list.length}）`;
                    box.append(head);
                    if (!list.length) {
                        const empty = document.createElement('div');
                        empty.className = 'settings-hint';
                        empty.textContent = isExcluded ? '还没有排除任何一本。' : '每一本都被排除了。';
                        box.append(empty);
                        return box;
                    }
                    for (const name of list) {
                        const row = document.createElement('div');
                        row.className = 'phone-worldbook-perm-row' + (isExcluded ? ' is-excluded' : '');
                        const label = document.createElement('span');
                        label.className = 'phone-worldbook-perm-name';
                        label.textContent = name;
                        const button = document.createElement('button');
                        button.type = 'button';
                        button.className = 'phone-worldbook-perm-toggle';
                        button.textContent = isExcluded ? '恢复' : '排除';
                        button.addEventListener('click', async () => {
                            await this.setBookExcluded(appKey, name, !isExcluded);
                            const top = modal.querySelector('.phone-worldbook-perm-count');
                            if (top) top.textContent = '已改动，重读中…';
                            draw(await this.inspectExcludedBooks(appKey));
                        });
                        row.append(label, button);
                        box.append(row);
                    }
                    return box;
                };
                body.append(
                    section('已排除 · 不注入', snapshot.excluded, true),
                    section('仍在用', snapshot.kept, false)
                );
            };
            void this.inspectExcludedBooks(appKey).then(draw).catch(() => draw({ status: 'stale', reason: 'list-failed' }));
        });
    }
    /* [v4.91.0 · 第十一批] 条目设置面板的**存储面**。
     *   修前 `entrySettings` 只能由调用方在 `writeMemoryEntries(name, entries, { entrySettings })`
     *   里现传 —— 产品端一个调用点都没有，等于「机制在、用户摸不到」。
     *
     *   键同样按 App × 按角色分桶（与 selection / excluded 同族同粒度，同样不做上级回退）：
     *   同一个 App 里「这张卡要常驻、那张卡要关键字触发」是各自的判断。
     *   刻意与排除表**分键**：排除表是「哪几本进来」，设置是「进来的写成什么样」，
     *   两者的重置节奏不同（清排除表不该顺手把设置也冲掉）。 */
    getEntrySettingsKey(appKey = 'common') {
        return `phone_worldbook_entrysettings_${appKey || 'common'}_char_${this._getCharacterScopeKey()}`;
    }
    /** 读设置（已归一；坏值一律降级成缺省表，绝不因设置坏掉而写坏条目）。 */
    getEntrySettings(appKey = 'common') {
        let raw = null;
        try { raw = this.storage?.get?.(this.getEntrySettingsKey(appKey), null); } catch (_e) { raw = null; }
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_e) { raw = null; }
        }
        return normalizeLorebookEntrySettings(raw).settings;
    }
    /** 打补丁式写设置（只并入传进来的格子，其余保持），返回写完的整份归一结果。 */
    async setEntrySettings(appKey, patch) {
        const merged = Object.assign({}, this.getEntrySettings(appKey), (patch && typeof patch === 'object') ? patch : {});
        const next = normalizeLorebookEntrySettings(merged);
        try { await this.storage?.set?.(this.getEntrySettingsKey(appKey), next.settings); } catch (_e) { /* 写不进就下次再说 */ }
        return next.settings;
    }
    /**
     * 打开条目设置面板。控件与 `applyLorebookEntrySettings` 的受控面一一对应，
     * 越界不在这里拦（纯件会夹紧并回读数）—— 面板只负责把当前值摆出来。
     * `position === 7`（outlet）时才出 outletName 输入格。
     */
    async openEntrySettingsDialog(appKey) {
        const existing = document.querySelector('.phone-worldbook-set-modal');
        existing?._phoneWorldbookSetClose?.();
        const current = this.getEntrySettings(appKey);
        const modal = document.createElement('div');
        modal.className = 'phone-worldbook-set-modal';
        const modeOptions = [['link', '向量化（默认）'], ['green', '关键字触发'], ['blue', '常驻（每轮都带）']]
            .map(([v, label]) => `<option value="${v}" ${current.constVectMode === v ? 'selected' : ''}>${label}</option>`).join('');
        const posOptions = ['0', '1', '2', '3', '5', '6', '7']
            .map((v) => `<option value="${v}" ${String(current.position) === v ? 'selected' : ''}>${v}${v === '7' ? '（出口）' : ''}</option>`).join('');
        const orderOptions = [['auto', '按自身序号'], ['reverse', '按倒序'], ['manual', '手填固定值']]
            .map(([v, label]) => `<option value="${v}" ${current.orderMode === v ? 'selected' : ''}>${label}</option>`).join('');
        modal.innerHTML = `
            <button class="phone-worldbook-set-backdrop" type="button" data-action="close" aria-label="关闭"></button>
            <section class="phone-worldbook-set-dialog" role="dialog" aria-modal="true" aria-label="记忆条目设置">
                <header class="phone-worldbook-set-head">
                    <h3>记忆条目设置</h3>
                    <button class="phone-worldbook-set-close" type="button" data-action="close" title="关闭" aria-label="关闭">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </header>
                <div class="phone-worldbook-set-body">
                    <label class="phone-worldbook-set-row"><span>触发形态</span>
                        <select data-field="constVectMode">${modeOptions}</select></label>
                    <label class="phone-worldbook-set-row"><span>插入位置</span>
                        <select data-field="position">${posOptions}</select></label>
                    <label class="phone-worldbook-set-row" data-outlet><span>出口名</span>
                        <input type="text" data-field="outletName" value="${escapeHtml(current.outletName || '')}" placeholder="位置 7 才用"></label>
                    <label class="phone-worldbook-set-row"><span>排序</span>
                        <select data-field="orderMode">${orderOptions}</select></label>
                    <label class="phone-worldbook-set-row" data-manual><span>手填值</span>
                        <input type="number" data-field="orderValue" value="${current.orderValue}" min="0" max="9999"></label>
                    <label class="phone-worldbook-set-row" data-reverse><span>倒序起点</span>
                        <input type="number" data-field="reverseStart" value="${current.reverseStart}" min="100" max="9999"></label>
                    <label class="phone-worldbook-set-row"><span>标题模板</span>
                        <input type="text" data-field="titleFormat" value="${escapeHtml(current.titleFormat || '')}"></label>
                    <label class="phone-worldbook-set-row is-check"><span>防递归</span>
                        <input type="checkbox" data-field="preventRecursion" ${current.preventRecursion ? 'checked' : ''}></label>
                    <label class="phone-worldbook-set-row is-check"><span>递归时才带</span>
                        <input type="checkbox" data-field="delayUntilRecursion" ${current.delayUntilRecursion ? 'checked' : ''}></label>
                    <label class="phone-worldbook-set-row is-check"><span>忽略预算</span>
                        <input type="checkbox" data-field="ignoreBudget" ${current.ignoreBudget ? 'checked' : ''}></label>
                    <div class="phone-worldbook-set-hint">序号按占位补零（例如三个零补成三位）。单层方括号的壳会被吃掉，写两层才留住一层。</div>
                </div>
                <footer class="phone-worldbook-set-actions">
                    <button type="button" class="phone-worldbook-set-cancel" data-action="close">取消</button>
                    <button type="button" class="phone-worldbook-set-confirm" data-action="save">保存</button>
                </footer>
            </section>
        `;
        const host = document.querySelector('#phone-panel-content .phone-screen');
        if (!host) throw new Error('未找到小手机屏幕容器，无法打开条目设置');
        host.appendChild(modal);
        return new Promise((resolve) => {
            let settled = false;
            const field = (name) => modal.querySelector('[data-field="' + name + '"]');
            const syncCond = () => {
                const outletRow = modal.querySelector('[data-outlet]');
                if (outletRow) outletRow.hidden = field('position')?.value !== '7';
                const manualRow = modal.querySelector('[data-manual]');
                if (manualRow) manualRow.hidden = field('orderMode')?.value !== 'manual';
                const reverseRow = modal.querySelector('[data-reverse]');
                if (reverseRow) reverseRow.hidden = field('orderMode')?.value !== 'reverse';
            };
            field('position')?.addEventListener('change', syncCond);
            field('orderMode')?.addEventListener('change', syncCond);
            syncCond();
            const close = (saved) => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKeyDown);
                modal.remove();
                resolve(!!saved);
            };
            const onKeyDown = (event) => { if (event.key === 'Escape') close(false); };
            modal._phoneWorldbookSetClose = () => close(false);
            modal.querySelectorAll('[data-action="close"]').forEach((button) => {
                button.addEventListener('click', () => close(false));
            });
            document.addEventListener('keydown', onKeyDown);
            modal.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
                const patch = {
                    constVectMode: field('constVectMode')?.value,
                    position: field('position')?.value,
                    outletName: field('outletName')?.value,
                    orderMode: field('orderMode')?.value,
                    orderValue: field('orderValue')?.value,
                    reverseStart: field('reverseStart')?.value,
                    titleFormat: field('titleFormat')?.value,
                    preventRecursion: !!field('preventRecursion')?.checked,
                    delayUntilRecursion: !!field('delayUntilRecursion')?.checked,
                    ignoreBudget: !!field('ignoreBudget')?.checked
                };
                try { await this.setEntrySettings(appKey, patch); } catch (_e) { /* 写不进就下次再说 */ }
                close(true);
            });
        });
    }

    isSessionIsolatedApp(appKey) {
        return appKey === 'wangxiang' || appKey === 'wangxiang-marketplace';
    }

    getEnabled(appKey) {
        const fallback = appKey === 'honey' ? false : true;
        if (this.isSessionIsolatedApp(appKey)) {
            const sessionRaw = this.storage?.get?.(this.getGlobalEnabledKey(appKey), undefined);
            if (sessionRaw !== undefined && sessionRaw !== null) {
                return parseBooleanSetting(sessionRaw, fallback);
            }
            const previousSessionRaw = this.storage?.get?.(this.getPreviousChatScopedEnabledKey(appKey), undefined);
            return previousSessionRaw !== undefined && previousSessionRaw !== null
                ? parseBooleanSetting(previousSessionRaw, fallback)
                : fallback;
        }
        const scopedRaw = this.storage?.get?.(this.getEnabledKey(appKey), undefined);
        if (scopedRaw !== undefined && scopedRaw !== null) {
            return parseBooleanSetting(scopedRaw, fallback);
        }

        const previousScopedRaw = this.storage?.get?.(this.getPreviousChatScopedEnabledKey(appKey), undefined);
        if (previousScopedRaw !== undefined && previousScopedRaw !== null) {
            return parseBooleanSetting(previousScopedRaw, fallback);
        }

        const globalRaw = this.storage?.get?.(this.getGlobalEnabledKey(appKey), undefined);
        if (globalRaw !== undefined && globalRaw !== null) {
            return parseBooleanSetting(globalRaw, fallback);
        }

        const appRaw = this.storage?.get?.(this.getAppEnabledKey(appKey), undefined);
        if (appRaw !== undefined && appRaw !== null) {
            return parseBooleanSetting(appRaw, fallback);
        }

        const legacyKey = this.getLegacyEnabledKey(appKey);
        if (legacyKey) {
            const legacyRaw = this.storage?.get?.(legacyKey, undefined);
            return parseBooleanSetting(legacyRaw, fallback);
        }
        return fallback;
    }

    async setEnabled(appKey, enabled) {
        const keys = this.isSessionIsolatedApp(appKey)
            ? uniqueStrings([
                this.getGlobalEnabledKey(appKey),
                this.getPreviousChatScopedEnabledKey(appKey)
            ])
            : uniqueStrings([
                this.getEnabledKey(appKey),
                this.getPreviousChatScopedEnabledKey(appKey),
                this.getGlobalEnabledKey(appKey),
                this.getAppEnabledKey(appKey)
            ]);
        for (const key of keys) {
            await this.storage?.set?.(key, !!enabled);
        }
        return !!enabled;
    }

    getSelection(appKey) {
        return this.getSelectionState(appKey).ids;
    }

    getSelectionState(appKey) {
        if (this.isSessionIsolatedApp(appKey)) {
            let sessionRaw = this.storage?.get?.(this.getGlobalSelectionKey(appKey), undefined);
            if (sessionRaw === undefined || sessionRaw === null) {
                sessionRaw = this.storage?.get?.(this.getPreviousChatScopedSelectionKey(appKey), undefined);
            }
            return this._parseSelectionState(sessionRaw);
        }
        let raw = this.storage?.get?.(this.getSelectionKey(appKey), undefined);
        if (raw === undefined || raw === null) {
            raw = this.storage?.get?.(this.getPreviousChatScopedSelectionKey(appKey), undefined);
        }
        if (raw === undefined || raw === null) {
            raw = this.storage?.get?.(this.getGlobalSelectionKey(appKey), undefined);
        }
        if (raw === undefined || raw === null) {
            raw = this.storage?.get?.(this.getAppSelectionKey(appKey), undefined);
        }
        if (raw === undefined || raw === null) {
            raw = this.storage?.get?.(this.getLegacySelectionKey(appKey), null);
        }
        return this._parseSelectionState(raw);
    }

    _parseSelectionState(raw) {
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return {
                initialized: raw.initialized === true,
                ids: Array.isArray(raw.ids) ? raw.ids.map(String) : [],
                entryIdsBySource: normalizeEntrySelectionMap(raw.entryIdsBySource || raw.entrySelections)
            };
        }
        if (Array.isArray(raw)) return { initialized: true, ids: raw.map(String), entryIdsBySource: {} };
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return {
                        initialized: parsed.initialized === true,
                        ids: Array.isArray(parsed.ids) ? parsed.ids.map(String) : [],
                        entryIdsBySource: normalizeEntrySelectionMap(parsed.entryIdsBySource || parsed.entrySelections)
                    };
                }
                return {
                    initialized: Array.isArray(parsed),
                    ids: Array.isArray(parsed) ? parsed.map(String) : [],
                    entryIdsBySource: {}
                };
            } catch {
                return { initialized: !!raw, ids: raw ? [raw] : [], entryIdsBySource: {} };
            }
        }
        return { initialized: false, ids: [], entryIdsBySource: {} };
    }

    _getSelectionStorageKeys(appKey) {
        return this.isSessionIsolatedApp(appKey)
            ? uniqueStrings([
                this.getGlobalSelectionKey(appKey),
                this.getPreviousChatScopedSelectionKey(appKey)
            ])
            : uniqueStrings([
                this.getSelectionKey(appKey),
                this.getPreviousChatScopedSelectionKey(appKey),
                this.getGlobalSelectionKey(appKey),
                this.getAppSelectionKey(appKey)
            ]);
    }

    async _writeSelectionState(appKey, selection) {
        const normalized = {
            initialized: true,
            ids: uniqueStrings(selection?.ids || []),
            entryIdsBySource: normalizeEntrySelectionMap(selection?.entryIdsBySource)
        };
        for (const key of this._getSelectionStorageKeys(appKey)) {
            await this.storage?.set?.(key, normalized);
        }
        return normalized;
    }

    _getSourceSelectionAliases(source) {
        return uniqueStrings([source?.id, source?.name, ...(source?.legacyIds || [])]);
    }

    _findExplicitEntrySelection(selection, source) {
        const map = selection?.entryIdsBySource || {};
        for (const key of this._getSourceSelectionAliases(source)) {
            if (Object.prototype.hasOwnProperty.call(map, key)) {
                return { initialized: true, ids: uniqueStrings(map[key]) };
            }
        }
        return { initialized: false, ids: [] };
    }

    _resolveSourceEntrySelection(selection, source) {
        const allEntries = normalizeEntries(source?.allEntries ?? source?.entries, { includeDisabled: true });
        const availableIds = new Set(allEntries.map((entry) => entry.uid));
        const explicit = this._findExplicitEntrySelection(selection, source);
        const configuredIds = (explicit.initialized ? explicit.ids : [])
            .filter((entryId) => availableIds.has(entryId));
        const configuredSet = new Set(configuredIds);
        const sourceSelected = selection?.initialized === true && this.matchesSelection(source, selection.ids);
        /* [v4.90.0 · 第十批缝入 5/8 · 既有缺陷] 没对这一本做过**条目级**选择时，
         *   `configuredIds` 是空集 ⇒ `selectedEntries` 也是空 ⇒ **勾了整本却一条都不注入**。
         *   成因是 `_findExplicitEntrySelection` 只认 `entryIdsBySource` 里的显式记录，
         *   而「勾一本但没点条目按钮」是最常见的用法。这里补上「未显式配置 ⇒ 全部可用条目都算」：
         *   `allEntries` 已按 `includeDisabled:true` 取过，故这里要自己筛一遍启用态。 */
        const fallbackEntries = explicit.initialized ? [] : allEntries.filter((entry) => entry.enabled);
        return {
            sourceSelected,
            explicit: explicit.initialized,
            configuredIds,
            selectedIds: sourceSelected ? (explicit.initialized ? configuredIds : fallbackEntries.map((e) => e.uid)) : [],
            selectedEntries: sourceSelected
                ? (explicit.initialized ? allEntries.filter((entry) => configuredSet.has(entry.uid)) : fallbackEntries)
                : [],
            allEntries
        };
    }

    getSourceEntrySelectionState(appKey, source) {
        return this._resolveSourceEntrySelection(this.getSelectionState(appKey), source);
    }

    async setSelection(appKey, ids = []) {
        const previous = this.getSelectionState(appKey);
        const selection = await this._writeSelectionState(appKey, {
            ids,
            entryIdsBySource: previous.entryIdsBySource
        });
        return selection.ids;
    }

    async setSourceSelected(appKey, source, selected) {
        const previous = this.getSelectionState(appKey);
        const aliases = new Set(this._getSourceSelectionAliases(source));
        const ids = previous.ids.filter((id) => !aliases.has(String(id)));
        const sourceId = safeString(source?.id || source?.name);
        if (selected && sourceId) ids.push(sourceId);
        return this._writeSelectionState(appKey, {
            ids,
            entryIdsBySource: previous.entryIdsBySource
        });
    }

    async setSourceEntrySelection(appKey, source, entryIds = []) {
        const previous = this.getSelectionState(appKey);
        const aliases = this._getSourceSelectionAliases(source);
        const aliasSet = new Set(aliases);
        const sourceId = safeString(source?.id || source?.name);
        const selectedEntryIds = uniqueStrings(entryIds);
        const ids = previous.ids.filter((id) => !aliasSet.has(String(id)));
        if (sourceId && selectedEntryIds.length > 0) ids.push(sourceId);

        const entryIdsBySource = { ...previous.entryIdsBySource };
        aliases.forEach((alias) => { delete entryIdsBySource[alias]; });
        if (sourceId) entryIdsBySource[sourceId] = selectedEntryIds;

        return this._writeSelectionState(appKey, { ids, entryIdsBySource });
    }

    async setEntrySelection(appKey, sourceId, entryIds = []) {
        const source = { id: safeString(sourceId), name: safeString(sourceId) };
        const selection = await this.setSourceEntrySelection(appKey, source, entryIds);
        return selection.ids;
    }

    async renderWorldbookSelector(container, appKey, options = {}) {
        if (!container) return;
        if (!this.getEnabled(appKey)) {
            container.innerHTML = '<div class="phone-worldbook-status">世界书注入已关闭。</div>';
            return;
        }

        try {
            const sources = await this.listAvailableWorldbooks({
                includeEntries: true,
                force: options.force !== false
            });
            if (sources.length === 0) {
                container.innerHTML = '<div class="phone-worldbook-status">未读取到酒馆世界书列表。</div>';
                return;
            }

            const displaySources = [...sources].sort((a, b) => {
                const aSelected = this.getSourceEntrySelectionState(appKey, a).sourceSelected ? 1 : 0;
                const bSelected = this.getSourceEntrySelectionState(appKey, b).sourceSelected ? 1 : 0;
                return (bSelected - aSelected) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
            });
            const savedQuery = safeString(container.dataset.phoneWorldbookSearchQuery);
            const excludedSet = new Set(this.getExcludedBooks(appKey).map(canonicalBookName));
            const sourceRows = displaySources.map((source) => {
                const entryState = this.getSourceEntrySelectionState(appKey, source);
                const totalCount = entryState.allEntries.length;
                const selectedCount = entryState.selectedIds.length;
                const checked = entryState.sourceSelected && selectedCount > 0;
                const unavailable = totalCount === 0;
                /** [v4.90.0 · 第十批缝入 5/8] 这本已上排除表：勾着但不注入。 */
                const excluded = excludedSet.has(canonicalBookName(source.name));
                const sourceId = escapeHtml(source.id);
                const baseStatus = unavailable ? '读取失败或没有条目' : `${selectedCount}/${totalCount} 条已选`;
                const status = excluded ? '已排除 · 不注入' : baseStatus;
                return `
                    <div class="phone-worldbook-source-row${checked ? ' is-selected' : ''}${excluded ? ' is-excluded' : ''}" data-source-id="${sourceId}">
                        <input class="phone-worldbook-source-toggle" type="checkbox" value="${sourceId}" ${checked ? 'checked' : ''} ${unavailable ? 'disabled' : ''} aria-label="选择 ${escapeHtml(source.name)}">
                        <div class="phone-worldbook-source-copy">
                            <div class="phone-worldbook-source-name">${escapeHtml(source.name)}</div>
                            <div class="phone-worldbook-source-meta">${escapeHtml(source.sourceLabel || '世界书')} · ${escapeHtml(status)}</div>
                        </div>
                        <button class="phone-worldbook-exclude-toggle${excluded ? ' is-on' : ''}" type="button" data-source-id="${sourceId}" title="${excluded ? '恢复这本（当前不注入）' : '在这个 App 里排除这本'}" aria-pressed="${excluded ? 'true' : 'false'}">
                            <i class="fa-solid ${excluded ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i>
                        </button>
                        <button class="phone-worldbook-entry-trigger" type="button" data-source-id="${sourceId}" title="选择条目" aria-label="选择 ${escapeHtml(source.name)} 的条目" ${unavailable ? 'disabled' : ''}>
                            <i class="fa-solid fa-list-check" aria-hidden="true"></i>
                        </button>
                    </div>
                `;
            }).join('');
            container.innerHTML = `
                <div class="phone-worldbook-search" role="search">
                    <i class="fa-solid fa-magnifying-glass phone-worldbook-search-icon" aria-hidden="true"></i>
                    <input class="phone-worldbook-search-input" type="search" value="${escapeHtml(savedQuery)}" placeholder="搜索世界书名称或内容" aria-label="搜索世界书名称或内容" autocomplete="off" spellcheck="false">
                    <button class="phone-worldbook-search-clear" type="button" title="清除搜索" aria-label="清除搜索" ${savedQuery ? '' : 'hidden'}>
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="phone-worldbook-search-result" aria-live="polite" ${savedQuery ? '' : 'hidden'}></div>
                <div class="phone-worldbook-toolbar">
                    <button class="phone-worldbook-perm-trigger" type="button" title="看排除面（共几本 / 排了几本）" aria-label="看排除面">
                        <i class="fa-solid fa-eye-low-vision" aria-hidden="true"></i><span>排除面</span>
                    </button>
                    <button class="phone-worldbook-set-trigger" type="button" title="记忆条目设置（形态 / 位置 / 排序 / 标题）" aria-label="记忆条目设置">
                        <i class="fa-solid fa-sliders" aria-hidden="true"></i><span>条目设置</span>
                    </button>
                </div>
                <div class="phone-worldbook-source-list">${sourceRows}</div>
            `;

            const sourceById = new Map(displaySources.map((source) => [String(source.id), source]));
            const searchTextBySourceId = new Map(displaySources.map((source) => [
                String(source.id),
                getWorldbookSearchText(source)
            ]));
            const searchInput = container.querySelector('.phone-worldbook-search-input');
            const searchClear = container.querySelector('.phone-worldbook-search-clear');
            const searchResult = container.querySelector('.phone-worldbook-search-result');
            const sourceRowsElements = Array.from(container.querySelectorAll('.phone-worldbook-source-row'));
            const applySearch = () => {
                const query = safeString(searchInput?.value);
                const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
                let visibleCount = 0;

                sourceRowsElements.forEach((row) => {
                    const searchText = searchTextBySourceId.get(String(row.dataset.sourceId || '')) || '';
                    const matches = tokens.every((token) => searchText.includes(token));
                    row.hidden = !matches;
                    if (matches) visibleCount += 1;
                });

                container.dataset.phoneWorldbookSearchQuery = query;
                if (searchClear) searchClear.hidden = !query;
                if (searchResult) {
                    searchResult.hidden = !query;
                    searchResult.textContent = visibleCount > 0
                        ? `找到 ${visibleCount} 本世界书`
                        : '没有找到匹配的世界书';
                }
            };
            searchInput?.addEventListener('input', applySearch);
            searchInput?.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape' || !searchInput.value) return;
                event.stopPropagation();
                searchInput.value = '';
                applySearch();
            });
            searchClear?.addEventListener('click', () => {
                if (!searchInput) return;
                searchInput.value = '';
                applySearch();
                searchInput.focus();
            });
            applySearch();
            /* [v4.91.0] 两个入口：排除面（可数）与条目设置（用户摸得到的设置面板）。 */
            container.querySelector('.phone-worldbook-perm-trigger')?.addEventListener('click', () => {
                this.openPermissionInspectDialog(appKey).catch((error) => console.warn('[WorldbookManager] 打开排除面失败:', error));
            });
            container.querySelector('.phone-worldbook-set-trigger')?.addEventListener('click', () => {
                this.openEntrySettingsDialog(appKey).catch((error) => console.warn('[WorldbookManager] 打开条目设置失败:', error));
            });
            /* [v4.90.0 · 第十批缝入 5/8] 排除开关：只翻转许可位，**不动勾选**。
             *   与勾选分开的理由：用户排掉一本书往往只是「这次别用它」，勾选是他挑过条目的
             *   劳动成果，不该因为排除而丢掉；反过来恢复时也不该替他决定要不要勾。 */
            container.querySelectorAll('.phone-worldbook-exclude-toggle').forEach((button) => {
                button.addEventListener('click', async () => {
                    const source = sourceById.get(String(button.dataset.sourceId || ''));
                    if (!source) return;
                    const nowExcluded = button.getAttribute('aria-pressed') === 'true';
                    await this.setBookExcluded(appKey, source.name, !nowExcluded);
                    await this.renderWorldbookSelector(container, appKey, options);
                });
            });
            container.querySelectorAll('.phone-worldbook-source-toggle').forEach((input) => {
                input.addEventListener('change', async () => {
                    const source = sourceById.get(String(input.value));
                    if (!source) return;
                    if (input.checked) {
                        await this.openEntrySelectionDialog(appKey, source);
                    } else {
                        await this.setSourceSelected(appKey, source, false);
                    }
                    await this.renderWorldbookSelector(container, appKey, options);
                });
            });
            container.querySelectorAll('.phone-worldbook-entry-trigger').forEach((button) => {
                button.addEventListener('click', async () => {
                    const source = sourceById.get(String(button.dataset.sourceId || ''));
                    if (!source) return;
                    await this.openEntrySelectionDialog(appKey, source);
                    await this.renderWorldbookSelector(container, appKey, options);
                });
            });
        } catch (error) {
            console.warn(`[WorldbookManager] ${appKey} 世界书列表渲染失败:`, error);
            container.innerHTML = '<div class="phone-worldbook-status is-error">世界书读取失败，请稍后重试。</div>';
        }
    }

    async openEntrySelectionDialog(appKey, source) {
        const existing = document.querySelector('.phone-worldbook-entry-modal');
        if (typeof existing?._phoneWorldbookClose === 'function') {
            existing._phoneWorldbookClose({ saved: false, entryIds: [] });
        } else {
            existing?.remove?.();
        }

        const loadedSource = Array.isArray(source?.allEntries)
            ? source
            : await this._loadWorldContent(source);
        const entryState = this.getSourceEntrySelectionState(appKey, loadedSource);
        const entries = entryState.allEntries;
        const configuredIds = new Set(entryState.configuredIds);
        const modal = document.createElement('div');
        modal.className = 'phone-worldbook-entry-modal';
        modal.innerHTML = `
            <button class="phone-worldbook-entry-backdrop" type="button" data-action="cancel" aria-label="关闭条目选择"></button>
            <section class="phone-worldbook-entry-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(loadedSource.name)} 条目选择">
                <header class="phone-worldbook-entry-head">
                    <div class="phone-worldbook-entry-heading">
                        <h3>${escapeHtml(loadedSource.name)}</h3>
                        <span class="phone-worldbook-entry-count"></span>
                    </div>
                    <button class="phone-worldbook-entry-close" type="button" data-action="cancel" title="关闭" aria-label="关闭">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </header>
                <label class="phone-worldbook-entry-select-all">
                    <input type="checkbox" class="phone-worldbook-entry-select-all-input">
                    <span>全选</span>
                </label>
                <div class="phone-worldbook-entry-list">
                    ${entries.length > 0 ? entries.map((entry, index) => {
                        const title = entry.comment || `条目 ${index + 1}`;
                        const preview = entry.content.replace(/\s+/g, ' ').slice(0, 180);
                        return `
                            <label class="phone-worldbook-entry-row">
                                <input class="phone-worldbook-entry-choice" type="checkbox" value="${escapeHtml(entry.uid)}" ${configuredIds.has(entry.uid) ? 'checked' : ''}>
                                <span class="phone-worldbook-entry-copy">
                                    <span class="phone-worldbook-entry-title">${escapeHtml(title)}</span>
                                    <span class="phone-worldbook-entry-origin ${entry.enabled ? 'is-enabled' : 'is-disabled'}">${entry.enabled ? '酒馆开启' : '酒馆关闭'}</span>
                                    <span class="phone-worldbook-entry-preview">${escapeHtml(preview)}</span>
                                </span>
                            </label>
                        `;
                    }).join('') : '<div class="phone-worldbook-status">这个世界书没有可读取的条目。</div>'}
                </div>
                <footer class="phone-worldbook-entry-actions">
                    <button type="button" class="phone-worldbook-entry-cancel" data-action="cancel">取消</button>
                    <button type="button" class="phone-worldbook-entry-confirm" data-action="confirm" ${entries.length === 0 ? 'disabled' : ''}>确定</button>
                </footer>
            </section>
        `;

        const host = document.querySelector('#phone-panel-content .phone-screen');
        if (!host) {
            throw new Error('未找到小手机屏幕容器，无法打开世界书条目选择');
        }
        host.appendChild(modal);

        return new Promise((resolve) => {
            let settled = false;
            const choices = Array.from(modal.querySelectorAll('.phone-worldbook-entry-choice'));
            const selectAll = modal.querySelector('.phone-worldbook-entry-select-all-input');
            const count = modal.querySelector('.phone-worldbook-entry-count');
            const updateSelectionMeta = () => {
                const selectedCount = choices.filter((input) => input.checked).length;
                if (count) count.textContent = `${selectedCount}/${choices.length} 条已选`;
                if (selectAll) {
                    selectAll.checked = choices.length > 0 && selectedCount === choices.length;
                    selectAll.indeterminate = selectedCount > 0 && selectedCount < choices.length;
                    selectAll.disabled = choices.length === 0;
                }
            };
            const close = (result) => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKeyDown);
                modal.remove();
                resolve(result);
            };
            const onKeyDown = (event) => {
                if (event.key === 'Escape') close({ saved: false, entryIds: [] });
            };
            modal._phoneWorldbookClose = close;
            choices.forEach((input) => input.addEventListener('change', updateSelectionMeta));
            selectAll?.addEventListener('change', () => {
                choices.forEach((input) => { input.checked = selectAll.checked; });
                updateSelectionMeta();
            });
            modal.querySelectorAll('[data-action="cancel"]').forEach((button) => {
                button.addEventListener('click', () => close({ saved: false, entryIds: [] }));
            });
            modal.querySelector('[data-action="confirm"]')?.addEventListener('click', async () => {
                const entryIds = choices.filter((input) => input.checked).map((input) => input.value);
                await this.setSourceEntrySelection(appKey, loadedSource, entryIds);
                close({ saved: true, entryIds });
            });
            document.addEventListener('keydown', onKeyDown);
            updateSelectionMeta();
            modal.querySelector('.phone-worldbook-entry-close')?.focus?.();
        });
    }

    async _loadSelectedWorldbookSources(appKey, options = {}) {
        if (!this.getEnabled(appKey)) return [];
        const sources = await this.listAvailableWorldbooks(options);
        if (sources.length === 0) return [];
        const selection = this.getSelectionState(appKey);
        const selectedSources = selection.initialized
            ? sources.filter((source) => this.matchesSelection(source, selection.ids))
            : [];
        if (selectedSources.length === 0) return [];
        /* [v4.90.0 · 第十批缝入 5/8] 过一道来源许可：勾过的书里凡上了排除表的整本不带。
         *   只过滤**已选中**的那一批（未选中的本来就不注入，再过滤一遍徒增 dropper 噪声）。
         *   命中一律记为 `excluded-book`；kind 给 'worldbook' 是本模块的口径 ——
         *   这一层只有书，没有别的来源混进来。 */
        const excludedBooks = this.getExcludedBooks(appKey);
        const permitted = excludedBooks.length
            ? filterSourcesByPermission({
                excludedBooks: excludedBooks,
                candidates: selectedSources.map((source) => ({
                    kind: 'worldbook',
                    world: source?.name,
                    hostEnabled: source?.hostEnabled,
                    availability: source?.availability
                }))
            }).kept.map((one) => one.world)
            : null;
        const keptSources = permitted
            ? selectedSources.filter((source) => permitted.includes(source?.name))
            : selectedSources;
        if (keptSources.length === 0) return [];
        /* [v4.89.0] 同上：选中面一次最多读 4 本。 */
        return runLimited(keptSources, (source) => this._loadWorldContent(source), { concurrency: 4, failFast: false });
    }

    async buildWorldbookMessages(appKey, options = {}) {
        const loadedSources = await this._loadSelectedWorldbookSources(appKey, options);
        const selection = this.getSelectionState(appKey);
        return loadedSources.flatMap((source) => this._resolveSourceEntrySelection(selection, source)
            .selectedEntries
            .map((entry) => ({
                role: 'system',
                content: entry.content,
                name: 'SYSTEM (世界书)',
                isPhoneMessage: true
            })));
    }

    async appendWorldbookMessages(messages, appKey, options = {}) {
        if (!Array.isArray(messages)) {
            throw new TypeError('世界书注入目标必须是消息数组');
        }
        const worldbookMessages = await this.buildWorldbookMessages(appKey, options);
        if (worldbookMessages.length > 0) messages.push(...worldbookMessages);
        return worldbookMessages;
    }

    async buildWorldbookMessage(appKey, options = {}) {
        const loadedSources = await this._loadSelectedWorldbookSources(appKey, options);
        const selection = this.getSelectionState(appKey);

        const parts = loadedSources
            .flatMap((source) => this._resolveSourceEntrySelection(selection, source)
                .selectedEntries
                .map((entry) => entry.content))
            .filter(Boolean);
        if (parts.length === 0) return null;

        return {
            role: 'system',
            content: parts.join('\n\n'),
            name: 'SYSTEM (世界书)',
            isPhoneMessage: true
        };
    }
}
