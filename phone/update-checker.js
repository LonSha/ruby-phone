/* ========================================================
 * RubyPhone 版本更新检测与公告弹窗（模块化拆解 · 第一批）
 * 来源：原 index.js else 闭包内的更新检测簇（8 个内联函数，约 190 行）
 * 拆解说明：
 *   - 该簇不引用任何共享闭包可变状态（APPS/PhoneStorage/modulesLoaded 零命中），
 *     唯一外部依赖为 storage（键值存取）与若干模块级常量，适合整体外移。
 *   - storage 由原「闭包捕获 let 变量」改为「显式依赖注入」，耦合点显式化。
 *   - 常量（版本/URL/CURRENT_UPDATE）通过工厂参数注入，避免重复定义漂移。
 * 用法（index.js）：
 *   import { createUpdateChecker } from './phone/update-checker.js';
 *   const updateChecker = createUpdateChecker({ ...constants, escapePhoneHtml });
 *   // storage 在 init 后赋值：updateChecker.setStorage(storage);
 * ======================================================== */

/** 语义化版本比较：a>b 返回 1，a<b 返回 -1，相等返回 0。纯函数。 */
export function compareSemver(a, b) {
    const parse = (value) => String(value || '')
        .replace(/^v/i, '')
        .split(/[.-]/)
        .map(part => Number.parseInt(part, 10))
        .map(num => (Number.isFinite(num) ? num : 0));
    const left = parse(a);
    const right = parse(b);
    const maxLen = Math.max(left.length, right.length, 3);
    for (let i = 0; i < maxLen; i++) {
        const diff = (left[i] || 0) - (right[i] || 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
}

/**
 * 创建更新检测器。
 * @param {object} deps
 * @param {string} deps.ST_PHONE_VERSION 当前版本号
 * @param {object} deps.ST_PHONE_CURRENT_UPDATE 当前版本更新说明 {version,date,items}
 * @param {string[]} deps.ST_PHONE_UPDATE_MANIFEST_URLS 远端 manifest 候选 URL
 * @param {string[]} deps.ST_PHONE_UPDATE_LOG_URLS 远端更新日志候选 URL
 * @param {string} deps.ST_PHONE_LOCAL_UPDATE_LOG_URL 本地更新日志 URL
 */
export function createUpdateChecker(deps) {
    const {
        ST_PHONE_VERSION,
        ST_PHONE_CURRENT_UPDATE,
        ST_PHONE_UPDATE_MANIFEST_URLS,
        ST_PHONE_UPDATE_LOG_URLS,
        ST_PHONE_LOCAL_UPDATE_LOG_URL,
    } = deps;

    // storage 由调用方在初始化完成后注入（原为闭包捕获的 let 变量）
    let storage = null;
    const setStorage = (s) => { storage = s; };

    function getKnownUpdateNotes(version = ST_PHONE_VERSION) {
        if (String(version || '') === ST_PHONE_CURRENT_UPDATE.version) {
            return ST_PHONE_CURRENT_UPDATE;
        }
        return { version: String(version || '新版'), date: '', items: [] };
    }

    async function fetchLocalUpdateNotes(version = ST_PHONE_VERSION, cacheBust = Date.now()) {
        if (typeof window === 'undefined' || !window.fetch) return getKnownUpdateNotes(version);
        try {
            const resp = await fetch(`${ST_PHONE_LOCAL_UPDATE_LOG_URL}?_=${cacheBust}`, { cache: 'no-store' });
            if (!resp.ok) return getKnownUpdateNotes(version);
            const log = await resp.json();
            const entry = log?.versions?.[version];
            if (entry && Array.isArray(entry.items) && entry.items.length) {
                return {
                    version: String(version || ST_PHONE_VERSION),
                    date: String(entry.date || ''),
                    items: entry.items.map(item => String(item || '')).filter(Boolean)
                };
            }
        } catch (_e) {
            // 本地更新日志读取失败时使用内置兜底文案，避免影响插件启动。
        }
        return getKnownUpdateNotes(version);
    }

    function showPhoneUpdateModal(mode, updateInfo, options = {}) {
        const data = updateInfo || getKnownUpdateNotes();
        const version = String(data.version || ST_PHONE_VERSION);
        const fallbackItems = mode === 'local' ? getKnownUpdateNotes(version).items : [];
        const items = Array.isArray(data.items) && data.items.length ? data.items : fallbackItems;
        const title = options.title || (mode === 'remote' ? '发现新版本' : '已更新');
        const subtitle = mode === 'remote'
            ? `当前版本 ${ST_PHONE_VERSION}，最新版本 ${version}`
            : `版本 ${version}${data.date ? ` · ${data.date}` : ''}`;
        const primaryText = options.primaryText || (mode === 'remote' ? '知道了' : '不再显示');

        document.getElementById('st-phone-update-modal')?.remove();

        const overlay = document.createElement('div');
        const viewportController = new AbortController();
        const syncUpdateModalViewport = () => {
            const vv = window.visualViewport;
            const width = Math.max(320, Math.round(vv?.width || window.innerWidth || document.documentElement?.clientWidth || 360));
            const height = Math.max(320, Math.round(vv?.height || window.innerHeight || document.documentElement?.clientHeight || 640));
            const left = Math.round(vv?.offsetLeft || 0);
            const top = Math.round(vv?.offsetTop || 0);
            overlay.style.setProperty('--st-phone-update-vw', `${width}px`);
            overlay.style.setProperty('--st-phone-update-vh', `${height}px`);
            overlay.style.setProperty('--st-phone-update-left', `${left}px`);
            overlay.style.setProperty('--st-phone-update-top', `${top}px`);
        };

        overlay.id = 'st-phone-update-modal';
        overlay.className = 'st-phone-update-modal';
        overlay.innerHTML = `
            <div class="st-phone-update-dialog" role="dialog" aria-modal="true" aria-labelledby="st-phone-update-title">
                <div class="st-phone-update-mark">${mode === 'remote' ? '↗' : '✓'}</div>
                <div class="st-phone-update-content">
                    <div class="st-phone-update-kicker">${mode === 'remote' ? '需要手动更新' : '本次更新内容'}</div>
                    <div class="st-phone-update-title" id="st-phone-update-title">${title}</div>
                    <div class="st-phone-update-subtitle">${subtitle}</div>
                    ${items.length ? `<ul class="st-phone-update-list">
                        ${items.map(item => `<li>${String(item || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</li>`).join('')}
                    </ul>` : ''}
                    ${mode === 'remote' ? '<div class="st-phone-update-note">请在酒馆扩展管理中更新，或手动替换插件文件。</div>' : ''}
                    <div class="st-phone-update-actions">
                        <button type="button" class="st-phone-update-btn st-phone-update-btn-primary">${primaryText}</button>
                    </div>
                </div>
            </div>
        `;

        const close = async () => {
            const rememberKey = String(options.rememberKey || '');
            if (rememberKey && storage?.set) {
                await storage.set(rememberKey, version);
            }
            viewportController.abort();
            overlay.remove();
            if (typeof options.onClose === 'function') {
                options.onClose();
            }
        };

        overlay.querySelector('.st-phone-update-btn-primary')?.addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay && mode === 'remote') close();
        });
        window.addEventListener('resize', syncUpdateModalViewport, { passive: true, signal: viewportController.signal });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', syncUpdateModalViewport, { passive: true, signal: viewportController.signal });
            window.visualViewport.addEventListener('scroll', syncUpdateModalViewport, { passive: true, signal: viewportController.signal });
        }
        syncUpdateModalViewport();
        document.body.appendChild(overlay);
    }

    async function showLocalUpdateAnnouncementIfNeeded(options = {}) {
        if (!storage?.get || !storage?.set) return;
        const seenVersion = String(storage.get('phone-update-announcement-seen-version') || '');
        if (seenVersion === ST_PHONE_VERSION) return false;
        const notes = await fetchLocalUpdateNotes(ST_PHONE_VERSION);
        showPhoneUpdateModal('local', notes, {
            rememberKey: 'phone-update-announcement-seen-version',
            onClose: options.onClose
        });
        return true;
    }

    async function checkRemotePhoneUpdate() {
        if (!storage?.get || !storage?.set || typeof window === 'undefined' || !window.fetch) return;
        const lastCheckAt = Number.parseInt(storage.get('phone-update-last-check-at') || '0', 10) || 0;
        const now = Date.now();
        if (now - lastCheckAt < 60 * 60 * 1000) return;
        await storage.set('phone-update-last-check-at', String(now));

        let remoteManifest = null;
        for (const url of ST_PHONE_UPDATE_MANIFEST_URLS) {
            try {
                const resp = await fetch(`${url}?_=${now}`, { cache: 'no-store' });
                if (!resp.ok) continue;
                remoteManifest = await resp.json();
                break;
            } catch (_e) {
                // 网络不可用或仓库不可达时静默失败，不能影响插件启动。
            }
        }
        const latestVersion = String(remoteManifest?.version || '').trim();
        if (!latestVersion || compareSemver(latestVersion, ST_PHONE_VERSION) <= 0) return;

        const acknowledged = String(storage.get('phone-update-remote-ack-version') || '');
        if (acknowledged === latestVersion) return;

        const notes = await fetchRemoteUpdateNotes(latestVersion, now);
        showPhoneUpdateModal('remote', notes, {
            rememberKey: 'phone-update-remote-ack-version'
        });
    }

    async function fetchRemoteUpdateNotes(version, cacheBust = Date.now()) {
        for (const url of ST_PHONE_UPDATE_LOG_URLS) {
            try {
                const resp = await fetch(`${url}?_=${cacheBust}`, { cache: 'no-store' });
                if (!resp.ok) continue;
                const log = await resp.json();
                const entry = log?.versions?.[version];
                if (entry && Array.isArray(entry.items) && entry.items.length) {
                    return {
                        version,
                        date: String(entry.date || ''),
                        items: entry.items.map(item => String(item || '')).filter(Boolean)
                    };
                }
            } catch (_e) {
                // 更新日志不可达时使用内置兜底文案。
            }
        }
        return getKnownUpdateNotes(version);
    }

    function schedulePhoneUpdateNotices() {
        setTimeout(() => {
            Promise.resolve(showLocalUpdateAnnouncementIfNeeded({ onClose: checkRemotePhoneUpdate })).then((showedLocal) => {
                if (!showedLocal) checkRemotePhoneUpdate();
            });
        }, 900);
    }

    return {
        setStorage,
        getKnownUpdateNotes,
        fetchLocalUpdateNotes,
        showPhoneUpdateModal,
        showLocalUpdateAnnouncementIfNeeded,
        checkRemotePhoneUpdate,
        fetchRemoteUpdateNotes,
        schedulePhoneUpdateNotices,
    };
}
