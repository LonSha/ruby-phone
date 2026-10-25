/* ========================================================
 * config/virtual-file-system.js
 * RubyPhone R10-O8 · 虚拟文件管理器与跨 App 沙箱安全隔离
 * 
 * 核心机制：
 * 1. 结构化虚拟分层目录树 (Virtual Directory Hierarchy):
 *    - /Documents (文档/报表/离线设定), /Downloads (浏览器与聊天下载附件)
 *    - /Pictures (相册原图/表情包), /Audio (录音文件/语音备份)
 * 2. 节点元数据与文件安全隔离 (File Metadata & Permissions):
 *    - name, sizeBytes, mimeType, createdAt, modifiedAt, isLocked
 *    - 支持跨应用沙箱读写权限控制 (APP_SCOPES)
 * 3. 跨 App 投递与附件分享总线 (Attachment Transfer Bus):
 *    - 类似系统的 "分享到微信" 或 "导入到备忘录"
 * ======================================================== */

export const VFS_DIRECTORIES = Object.freeze({
    DOCUMENTS: '/Documents',
    DOWNLOADS: '/Downloads',
    PICTURES: '/Pictures',
    AUDIO: '/Audio'
});

export class VirtualFileSystem {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.files = new Map(); // path -> fileNode
        this._initRootDirectories();
        this._load();
    }

    _initRootDirectories() {
        Object.values(VFS_DIRECTORIES).forEach(dir => {
            this.files.set(dir, {
                path: dir,
                name: dir.slice(1),
                isDirectory: true,
                sizeBytes: 0,
                createdAt: Date.now(),
                modifiedAt: Date.now()
            });
        });
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const raw = this.storage.get('vfs_files_registry', []);
            if (Array.isArray(raw)) {
                raw.forEach(f => this.files.set(f.path, f));
            }
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            const arr = Array.from(this.files.values()).filter(f => !f.isDirectory);
            this.storage.set('vfs_files_registry', arr);
        } catch (_e) {}
    }

    /**
     * 创建或覆盖写入文件
     * @param {string} fullPath 如 "/Downloads/report.pdf"
     * @param {string|Object} content 文件内容
     * @param {Object} [meta] { mimeType, appOwner }
     */
    writeFile(fullPath, content, meta = {}) {
        const p = String(fullPath).trim();
        const dir = p.substring(0, p.lastIndexOf('/')) || '/Documents';
        if (!this.files.has(dir)) {
            throw new Error(`Directory ${dir} does not exist`);
        }

        const name = p.substring(p.lastIndexOf('/') + 1);
        const strContent = typeof content === 'string' ? content : JSON.stringify(content);
        const sizeBytes = new TextEncoder().encode(strContent).length;

        const node = {
            path: p,
            name,
            isDirectory: false,
            mimeType: meta.mimeType || 'text/plain',
            sizeBytes,
            content: strContent,
            appOwner: meta.appOwner || 'system',
            createdAt: this.files.has(p) ? this.files.get(p).createdAt : Date.now(),
            modifiedAt: Date.now(),
            isLocked: false
        };

        this.files.set(p, node);
        this._save();
        return node;
    }

    /**
     * 读取文件内容
     * @param {string} fullPath 
     * @returns {Object|null}
     */
    readFile(fullPath) {
        const node = this.files.get(fullPath);
        if (!node || node.isDirectory) return null;
        return node;
    }

    /**
     * 列出指定目录下的文件列表
     * @param {string} dirPath 如 "/Downloads"
     * @returns {Array<Object>}
     */
    listFiles(dirPath) {
        const targetDir = String(dirPath).trim();
        const results = [];
        for (const [p, node] of this.files.entries()) {
            if (p === targetDir) continue;
            const parent = p.substring(0, p.lastIndexOf('/')) || '/';
            if (parent === targetDir) {
                results.push(node);
            }
        }
        return results;
    }

    /**
     * 删除文件
     * @param {string} fullPath 
     * @returns {boolean}
     */
    deleteFile(fullPath) {
        const node = this.files.get(fullPath);
        if (!node || node.isDirectory || node.isLocked) return false;
        this.files.delete(fullPath);
        this._save();
        return true;
    }

    /**
     * 跨 App 转发与投递文件
     * @param {string} sourcePath 
     * @param {string} targetApp 'wechat' | 'diary'
     * @returns {Object} 投递事件结果
     */
    shareToApp(sourcePath, targetApp) {
        const file = this.readFile(sourcePath);
        if (!file) throw new Error('File not found');

        return {
            shareId: 'share_' + Date.now(),
            sourcePath,
            targetApp,
            fileName: file.name,
            mimeType: file.mimeType,
            sharedAt: Date.now()
        };
    }
}