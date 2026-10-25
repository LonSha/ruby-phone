/* ========================================================
 * config/smart-gallery-vault.js
 * RubyPhone R10-O5 · 相册智能多维视觉标签与隐私加密保险箱
 * 
 * 核心机制：
 * 1. 多维多层标签体系 (Multi-Dimensional Tagging):
 *    - 场景维度 (SCENE: 海边、咖啡馆、深夜街头、书房)
 *    - 角色面容关联 (ACTORS: Alice, Bob 等多在场角色聚类)
 *    - 涉密/私密等级 (SECRECY: PUBLIC, INTIMATE, TOP_SECRET)
 * 2. 隐私保险箱与密码校验 (Encrypted Privacy Vault):
 *    - 私密相片移入保险箱后，主相册列表中隐藏，仅在密码解锁后可见
 *    - 密码支持与剧情线索结合（如角色生日或纪念日），输错 3 次触发临时锁死冷却
 * 3. EXIF 伪元数据分析 (EXIF Timestamp & Geolocation):
 *    - 模拟拍摄相机型号、光圈、GPS 经纬度及时间戳
 * ======================================================== */

export const PHOTO_SECRECY = Object.freeze({
    PUBLIC: 'PUBLIC',
    INTIMATE: 'INTIMATE',
    TOP_SECRET: 'TOP_SECRET'
});

export class SmartGalleryVault {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.photos = [];
        this.vaultPhotos = [];
        this.vaultPin = opts.vaultPin || '1234';
        this.isUnlocked = false;
        this.failedAttempts = 0;
        this.lockedUntil = 0;
        this._load();
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const rawPublic = this.storage.get('gallery_public_photos', []);
            const rawVault = this.storage.get('gallery_vault_photos', []);
            if (Array.isArray(rawPublic)) this.photos = rawPublic;
            if (Array.isArray(rawVault)) this.vaultPhotos = rawVault;
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            this.storage.set('gallery_public_photos', this.photos);
            this.storage.set('gallery_vault_photos', this.vaultPhotos);
        } catch (_e) {}
    }

    /**
     * 录入相片并自动生成智能多维标签
     * @param {Object} photoData { id, url, title, actors, scene, secrecy, date }
     * @returns {Object} 带有 EXIF 与标签的完整相片对象
     */
    addPhoto(photoData) {
        if (!photoData || !photoData.url) {
            throw new Error('Photo url is required');
        }

        const id = photoData.id || ('img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
        const secrecy = photoData.secrecy || PHOTO_SECRECY.PUBLIC;
        const actors = Array.isArray(photoData.actors) ? photoData.actors : [];
        const scene = photoData.scene || '日常';

        const photo = {
            id,
            url: photoData.url,
            title: photoData.title || '无标题照片',
            actors,
            scene,
            secrecy,
            timestamp: photoData.timestamp || Date.now(),
            exif: {
                cameraModel: 'RubyPhone Pro Max Dual Cam',
                lens: '24mm f/1.78',
                iso: 125,
                location: photoData.location || '城市中心'
            },
            tags: [scene, secrecy, ...actors]
        };

        if (secrecy === PHOTO_SECRECY.PUBLIC) {
            this.photos.unshift(photo);
        } else {
            this.vaultPhotos.unshift(photo);
        }

        this._save();
        return photo;
    }

    /**
     * 验证保险箱密码并解锁
     * @param {string} pin 
     * @returns {{ success: boolean, message: string }}
     */
    unlockVault(pin) {
        const now = Date.now();
        if (now < this.lockedUntil) {
            const waitSec = Math.ceil((this.lockedUntil - now) / 1000);
            return { success: false, message: `多次密码错误，请等待 ${waitSec} 秒后再试` };
        }

        if (String(pin).trim() === String(this.vaultPin).trim()) {
            this.isUnlocked = true;
            this.failedAttempts = 0;
            return { success: true, message: '保险箱已解锁' };
        }

        this.failedAttempts++;
        if (this.failedAttempts >= 3) {
            this.lockedUntil = now + 30000; // 锁定 30 秒
            return { success: false, message: '连续输错 3 次，保险箱已锁定 30 秒' };
        }

        return { success: false, message: `密码错误，剩余尝试次数：${3 - this.failedAttempts}` };
    }

    lockVault() {
        this.isUnlocked = false;
    }

    /**
     * 将照片移入或移出保险箱
     * @param {string} photoId 
     * @param {boolean} moveToVault 
     * @returns {boolean}
     */
    movePhotoSecrecy(photoId, moveToVault) {
        if (moveToVault) {
            const idx = this.photos.findIndex(p => p.id === photoId);
            if (idx < 0) return false;
            const p = this.photos.splice(idx, 1)[0];
            p.secrecy = PHOTO_SECRECY.INTIMATE;
            this.vaultPhotos.unshift(p);
        } else {
            if (!this.isUnlocked) return false;
            const idx = this.vaultPhotos.findIndex(p => p.id === photoId);
            if (idx < 0) return false;
            const p = this.vaultPhotos.splice(idx, 1)[0];
            p.secrecy = PHOTO_SECRECY.PUBLIC;
            this.photos.unshift(p);
        }
        this._save();
        return true;
    }

    /**
     * 查询相片列表
     * @param {Object} [filter] { actor, scene, includeVault }
     * @returns {Array<Object>}
     */
    queryPhotos(filter = {}) {
        let pool = [...this.photos];
        if (filter.includeVault && this.isUnlocked) {
            pool = pool.concat(this.vaultPhotos);
        }

        return pool.filter(p => {
            if (filter.actor && !p.actors.includes(filter.actor)) return false;
            if (filter.scene && p.scene !== filter.scene) return false;
            return true;
        });
    }
}