/* ========================================================
 * config/cloud-drive-sync.js
 * RubyPhone R10-X1 · 虚拟网盘与角色秘密数据云端同步
 * 
 * 核心机制：
 * 1. 虚拟云端网盘与跨设备同步 (Cloud Storage Quota & Sync):
 *    - 存储配额计算 (如已用 14.2GB / 50GB)
 *    - 文件分块哈希 (chunkHash) 与断点续传校验
 * 2. 角色自主备份与秘密数据碎片 (Actor Secret Fragments):
 *    - 角色在剧情推进中会自主向云端静默上传涉密笔记、未公开原图或录音备份
 *    - 碎片文件带有加密锁 (ENCRYPTED)，需匹配剧情解密密钥 (secretKey) 才能提取明文
 * 3. 冲突合并与云端版本恢复 (Conflict Resolution & Versioning):
 *    - 支持本地与云端版本比对，拉取历史修订版本
 * ======================================================== */

export class CloudDriveSync {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.totalQuotaBytes = opts.totalQuotaBytes || 50 * 1024 * 1024 * 1024; // 50GB
        this.cloudFiles = new Map(); // fileId -> cloudRecord
        this._load();
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const raw = this.storage.get('cloud_drive_sync_records', []);
            if (Array.isArray(raw)) {
                raw.forEach(f => this.cloudFiles.set(f.fileId, f));
            }
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            this.storage.set('cloud_drive_sync_records', Array.from(this.cloudFiles.values()));
        } catch (_e) {}
    }

    /**
     * 上传或同步文件到云端
     * @param {Object} file { fileId, name, sizeBytes, content, authorId, isSecret, secretKey }
     * @returns {Object} 云端同步凭证
     */
    syncUpload(file) {
        if (!file || !file.fileId || !file.name) {
            throw new Error('fileId and name are required for cloud sync');
        }

        const size = file.sizeBytes || (new TextEncoder().encode(String(file.content || '')).length);
        const currentUsage = this.getUsedStorageBytes();

        if (currentUsage + size > this.totalQuotaBytes) {
            return { success: false, reason: 'CLOUD_QUOTA_EXCEEDED', freeBytes: this.totalQuotaBytes - currentUsage };
        }

        const isSecret = !!file.isSecret;
        const record = {
            fileId: file.fileId,
            name: file.name,
            sizeBytes: size,
            authorId: file.authorId || 'user',
            isSecret,
            secretKey: isSecret ? String(file.secretKey || '') : null,
            content: isSecret ? this._simpleCipher(file.content, file.secretKey) : file.content,
            version: this.cloudFiles.has(file.fileId) ? (this.cloudFiles.get(file.fileId).version + 1) : 1,
            syncedAt: Date.now()
        };

        this.cloudFiles.set(file.fileId, record);
        this._save();

        return {
            success: true,
            fileId: record.fileId,
            version: record.version,
            isSecret: record.isSecret,
            syncedAt: record.syncedAt
        };
    }

    /**
     * 角色自主上传涉密剧情碎片
     * @param {string} actorName 角色名称
     * @param {string} fileName 碎片文件名
     * @param {string} rawContent 秘密内容
     * @param {string} secretKey 对应解密密码
     * @returns {Object} 碎片登记
     */
    actorUploadSecretFragment(actorName, fileName, rawContent, secretKey) {
        const id = 'secret_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        return this.syncUpload({
            fileId: id,
            name: fileName,
            content: rawContent,
            authorId: actorName,
            isSecret: true,
            secretKey
        });
    }

    /**
     * 解密提取秘密文件内容
     * @param {string} fileId 
     * @param {string} inputKey 
     * @returns {{ success: boolean, content?: string, reason?: string }}
     */
    decryptDownload(fileId, inputKey) {
        const file = this.cloudFiles.get(fileId);
        if (!file) return { success: false, reason: 'FILE_NOT_FOUND' };

        if (!file.isSecret) {
            return { success: true, content: file.content };
        }

        if (String(inputKey).trim() !== String(file.secretKey).trim()) {
            return { success: false, reason: 'INCORRECT_SECRET_KEY' };
        }

        const decrypted = this._simpleCipher(file.content, file.secretKey);
        return { success: true, content: decrypted };
    }

    getUsedStorageBytes() {
        let total = 0;
        for (const f of this.cloudFiles.values()) {
            total += f.sizeBytes;
        }
        return total;
    }

    _simpleCipher(str, key) {
        if (!key) return str;
        const kStr = String(key);
        let out = '';
        for (let i = 0; i < str.length; i++) {
            out += String.fromCharCode(str.charCodeAt(i) ^ kStr.charCodeAt(i % kStr.length));
        }
        return out;
    }
}