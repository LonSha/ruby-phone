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
/** [v4.88.0] 写目标守卫（第七批缝入）。import 放在顶部之外会成环，故就近取用。 */
import { checkWriteTarget, sameVirtualPath, utf8Bytes, writeRejectLine } from './write-guard.js';

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

    /**
     * [v4.88.0 · 写目标守卫] 找同一路径的**大小写变体**。
     *   VFS 的键是大小写敏感的，`/Documents/A.txt` 与 `/documents/a.txt` 会并存成两份，
     *   而 readFile / listFiles 只按精确键取 —— 写进去了、读不出来，且两份内容各自演化。
     *   本方法只回答「有没有别名」，处置由 writeFile 做（搬到新写法上，内容以本次为准）。
     * @param {string} fullPath
     * @returns {string} 别名键；无别名回 ''
     */
    _findPathVariant(fullPath) {
        const want = String(fullPath || '');
        if (!want || this.files.has(want)) return '';
        for (const key of this.files.keys()) {
            if (sameVirtualPath(key, want)) return key;
        }
        return '';
    }
    /**
     * 把任意写法的路径解析成**盘上真实键**（精确键优先，其次大小写别名）。
     *   写侧有别名归一、读侧没有的话，就会出现「写进去了、readFile 返回 null」——
     *   那比两份同名文件更难查：盘上有内容，界面就是空的。
     * @param {string} fullPath
     * @returns {string} 真实键；无则 ''
     */
    _resolveKey(fullPath) {
        const p = String(fullPath || '').trim();
        if (!p) return '';
        if (this.files.has(p)) return p;
        return this._findPathVariant(p);
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
     * @param {Object} [meta] { mimeType, appOwner, op }
     *
     * [v4.88.0] 走 config/write-guard.js 过门。**默认语义仍是 overwrite**（历史调用点
     *   全都靠覆盖写），故这里只加不破：三道新闸 —— 外壳保留目录、单次/结果字节帽、
     *   以及传了 op 时的 create/append 互斥语义。拒绝时抛一条带原因码的话，
     *   与既有 `Directory ... does not exist` 同形（调用点已习惯 try/catch）。
     *   propose 与 commit 都过门（这里即是 commit 侧；调用方可在提议时先探一次）。
     */
    writeFile(fullPath, content, meta = {}) {
        const p = String(fullPath).trim();
        /* 目录侧也照大小写别名归一：`/documents/A.TXT` 落到已存在的 `/Documents` 上。
         *   否则「文件能按别名认出、目录却认不出」—— 同一个别名在两处判出两种结论。 */
        const rawDir = p.substring(0, p.lastIndexOf('/')) || '/Documents';
        const dir = this.files.has(rawDir) ? rawDir : (this._findPathVariant(rawDir) || rawDir);
        if (!this.files.has(dir)) {
            throw new Error(`Directory ${rawDir} does not exist`);
        }
        const target = dir + p.substring(p.lastIndexOf('/'));
        const name = p.substring(p.lastIndexOf('/') + 1);
        const strContent = typeof content === 'string' ? content : JSON.stringify(content);
        /* 大小写别名先归一：existsOf / isFileOf / prevNode 一律把别名算成本目标，
         *   否则 create 判「不存在」会建出第二份同名文件，append 判「不存在」会误拒。 */
        const variant = this._findPathVariant(target);
        const prevPath = this.files.has(target) ? target : variant;
        const prevNode = this.files.get(prevPath) || null;
        const bytes = utf8Bytes(strContent);
        const verdict = checkWriteTarget({
            path: target,
            op: (meta && meta.op) || 'overwrite',
            bytes,
            mimeType: meta && meta.mimeType,
            existingBytes: prevNode ? (Number(prevNode.sizeBytes) || 0) : 0,
            existsOf: (np) => this.files.has(np) || !!this._findPathVariant(np),
            isFileOf: (np) => {
                const n = this.files.get(np) || this.files.get(this._findPathVariant(np));
                return !!n && n.isDirectory !== true;
            }
        });
        if (verdict.ok !== true) throw new Error(writeRejectLine(verdict));
        const isAppend = (meta && meta.op) === 'append' && prevNode;
        const finalContent = isAppend ? (String(prevNode.content || '') + strContent) : strContent;
        const sizeBytes = utf8Bytes(finalContent);
        const node = {
            path: target,
            name,
            isDirectory: false,
            mimeType: meta.mimeType || 'text/plain',
            sizeBytes,
            content: finalContent,
            appOwner: meta.appOwner || 'system',
            createdAt: prevNode ? prevNode.createdAt : Date.now(),
            modifiedAt: Date.now(),
            isLocked: false
        };
        if (prevPath && prevPath !== target) this.files.delete(prevPath);
        this.files.set(target, node);
        this._save();
        return node;
    }

    /**
     * 读取文件内容
     * @param {string} fullPath 
     * @returns {Object|null}
     */
    readFile(fullPath) {
        const node = this.files.get(this._resolveKey(fullPath));
        if (!node || node.isDirectory) return null;
        return node;
    }

    /**
     * 列出指定目录下的文件列表
     * @param {string} dirPath 如 "/Downloads"
     * @returns {Array<Object>}
     */
    listFiles(dirPath) {
        const rawDir = String(dirPath).trim();
        const targetDir = this.files.has(rawDir) ? rawDir : (this._findPathVariant(rawDir) || rawDir);
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
        const key = this._resolveKey(fullPath);
        const node = this.files.get(key);
        if (!node || node.isDirectory || node.isLocked) return false;
        this.files.delete(key);
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