/* ========================================================
 * system-controls.js — 系统控制内核 [v2.16.0]
 * --------------------------------------------------------
 * 为「控制中心」（顶部下拉）提供真实可控的开关状态读写。
 *   每一项都必须落到既有能力上，不做纯装饰（除手电筒这类物理不可达项，
 *   也以手机壳视觉状态真实呈现）。
 *
 * 落地矩阵：
 *   dnd     免打扰 → 通知只入账不弹横幅（真实影响通知中心，notifyIfAllowed）
 *   scale   显示缩放 → 复用已有 --phone-shell-* 缩放（与设置页同键，双向一致）
 *   lock    立即锁屏 → 真实调 PhoneShell 锁屏
 *   flashlight 手电筒 → 手机壳视觉（真实可见的开关态）
 *   wifi    网络 → 手机状态栏 Wi-Fi 图标联动
 *
 * 存储键约定：一律 `sys_*`（命中 config/storage.js 的 /^sys_/ → chatMetadata，
 *   随会话隔离，避免换角色时把某个角色的免打扰状态带过去）。
 * ======================================================== */
'use strict';

export const SYS_KEYS = Object.freeze({
    DND: 'sys_dnd',
    SCALE: 'sys_shell_scale',
    FLASHLIGHT: 'sys_flashlight',
    WIFI: 'sys_wifi'
});

export const SCALE_MIN = 80;
export const SCALE_MAX = 120;
export const SCALE_DEFAULT = 100;

/** 归一化显示缩放（80–120，取整） */
export function normalizeScale(value, fallback = SCALE_DEFAULT) {
    const n = Number.parseInt(String(value ?? ''), 10);
    const f = Number.parseInt(String(fallback ?? ''), 10);
    const base = Number.isFinite(n) ? n : (Number.isFinite(f) ? f : SCALE_DEFAULT);
    return Math.max(SCALE_MIN, Math.min(SCALE_MAX, base));
}

/** 布尔读（兼容 '1' / 'true' / true） */
export function readFlag(storage, key, fallback = false) {
    try {
        const raw = storage?.get?.(key, undefined);
        if (raw === undefined || raw === null || raw === '') return !!fallback;
        if (typeof raw === 'boolean') return raw;
        const s = String(raw).toLowerCase();
        if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
        if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
        return !!fallback;
    } catch (_e) {
        return !!fallback;
    }
}

export function writeFlag(storage, key, value) {
    try { storage?.set?.(key, !!value); return true; } catch (_e) { return false; }
}

/**
 * 免打扰是否开启。
 *   通知咽喉（index.js 的 showUnifiedPhoneNotification）在展示前调用：
 *   开启时仍落账到通知中心，但不弹横幅——消息不会丢，只是不打断。
 */
export function isDndOn(storage) {
    return readFlag(storage, SYS_KEYS.DND, false);
}

/** 手电筒（视觉） */
export function isFlashlightOn(storage) {
    return readFlag(storage, SYS_KEYS.FLASHLIGHT, false);
}

/** Wi-Fi（联动状态栏图标） */
export function isWifiOn(storage) {
    return readFlag(storage, SYS_KEYS.WIFI, true);
}

/** 读取显示缩放（优先 sys_* 新键，回落既有 phone-shell-scale，保证与设置页一致） */
export function readShellScale(storage) {
    try {
        const raw = storage?.get?.(SYS_KEYS.SCALE, undefined);
        if (raw !== undefined && raw !== null && raw !== '') return normalizeScale(raw);
    } catch (_e) { /* 回落 */ }
    try {
        const legacy = storage?.get?.('phone-shell-scale', undefined);
        if (legacy !== undefined && legacy !== null && legacy !== '') return normalizeScale(legacy);
    } catch (_e) { /* 忽略 */ }
    return SCALE_DEFAULT;
}

/**
 * 应用显示缩放：优先走 PhoneShell 暴露的 applyPhoneShellScale（设置页同款通路），
 *   缺失时退化为直接写 CSS 变量（保证控制中心在任意宿主下都真实生效）。
 */
export function applyShellScale(storage, percent) {
    const p = normalizeScale(percent);
    let applied = false;
    try {
        const vp = (typeof window !== 'undefined') ? window.VirtualPhone : null;
        if (vp && typeof vp.applyPhoneShellScale === 'function') {
            vp.applyPhoneShellScale(p);
            applied = true;
        }
    } catch (_e) { /* 回落 */ }
    if (!applied) {
        try {
            const widthScale = p / 100;
            const heightScale = widthScale * 0.95;
            document.documentElement.style.setProperty('--phone-shell-width-scale', widthScale.toFixed(4));
            document.documentElement.style.setProperty('--phone-shell-height-scale', heightScale.toFixed(4));
            applied = true;
        } catch (_e) { /* 无 DOM 环境（单测） */ }
    }
    // 状态与效果分离：DOM 应用是尽力而为（宿主可能无 document），
    //   但「用户设定的缩放值」必须落盘，否则控制中心在无 DOM 环境会选择静默丢设定。
    try { storage?.set?.(SYS_KEYS.SCALE, p); } catch (_e) { /* 忽略 */ }
    return { percent: p, applied };
}

/** Wi-Fi 图标联动（状态栏真实可见） */
export function applyWifiIndicator(on) {
    try {
        const el = document.querySelector('.phone-statusbar .phone-wifi-signal');
        if (!el) return false;
        el.style.opacity = on ? '' : '0.28';
        el.style.filter = on ? '' : 'grayscale(1)';
        el.setAttribute('aria-label', on ? 'Wi-Fi 已连接' : 'Wi-Fi 已关闭');
        return true;
    } catch (_e) { return false; }
}

/** 手电筒视觉：在手机壳上叠加暖光晕 + 面板高亮 */
export function applyFlashlightVisual(on) {
    try {
        const host = document.querySelector('.phone-in-panel');
        if (!host) return false;
        host.classList.toggle('sys-flashlight-on', !!on);
        return true;
    } catch (_e) { return false; }
}

/** 立即锁屏（真实调 PhoneShell） */
export function lockNow(phoneShell) {
    try {
        if (phoneShell?.lockScreen?.lock) { phoneShell.lockScreen.lock(); return true; }
        if (phoneShell?.toggleScreen) { phoneShell.toggleScreen(); return true; }
    } catch (_e) { /* 忽略 */ }
    return false;
}

/**
 * 取出真实音乐数据层（MusicData 实例）。
 *   MusicApp 的存储字段是 musicData（不是 data），曲目列表经 getActiveList()
 *   取当前激活列表（待播清单 / 收藏夹），当前曲目经 getCurrentSong() 取。
 */
function _musicData() {
    try {
        const app = (typeof window !== 'undefined') ? window.VirtualPhone?.musicApp : null;
        if (!app) return null;
        const data = app.musicData || null;
        return (data && typeof data === 'object') ? data : null;
    } catch (_e) { return null; }
}

/** 音乐播放控制（真实联动 MusicApp；未初始化则返回不可用） */
export function musicControl(action = 'toggle') {
    try {
        const data = _musicData();
        if (!data) return { available: false, playing: false };
        const audio = data.audioPlayer;
        if (action === 'next') {
            if (typeof data.next === 'function') data.next();
        } else if (action === 'prev') {
            if (typeof data.prev === 'function') data.prev();
        } else {
            const playing = !!data.isPlaying || (audio && !audio.paused);
            if (playing) {
                if (typeof data.pause === 'function') data.pause();
                else if (audio) { audio.pause(); data.isPlaying = false; }
            } else if (typeof data.resume === 'function') {
                data.resume();
            } else if (audio && audio.src) {
                audio.play?.();
                data.isPlaying = true;
            }
        }
        return { available: true, playing: !!data.isPlaying };
    } catch (_e) { return { available: false, playing: false }; }
}

/** 当前曲目信息（控制中心音乐卡 / 锁屏音乐条展示用） */
export function currentTrack() {
    try {
        const data = _musicData();
        if (!data) return null;
        let song = null;
        if (typeof data.getCurrentSong === 'function') song = data.getCurrentSong();
        else {
            const list = typeof data.getActiveList === 'function'
                ? (data.getActiveList() || [])
                : (Array.isArray(data.playlist) ? data.playlist : []);
            const idx = Number(data.currentIndex);
            song = (Number.isFinite(idx) && idx >= 0) ? list[idx] : null;
        }
        const playing = !!data.isPlaying;
        if (!song && !playing) return null;
        return {
            title: String(song?.name || song?.title || '未在播放'),
            artist: String(song?.artist || ''),
            playing
        };
    } catch (_e) { return null; }
}