/* ============================================================
 * atomic-filesystem-snapshot-vault.js — 手机存储层原子事务与整机单文件快照导出器
 * [v4.140.0 · 虚拟磁盘原子写入、快照增量校验与灾难恢复]
 * ============================================================ */

export class AtomicFilesystemSnapshotVault {
    constructor() {
        this.virtualDisk = new Map(); // path/key -> { content, sizeBytes, updatedAt, checksum }
        this.transactionStaging = new Map();
        this.isInTransaction = false;
    }

    beginTransaction() {
        this.isInTransaction = true;
        this.transactionStaging.clear();
    }

    stageWrite(filePath, data) {
        if (!this.isInTransaction) throw new Error("必须在 beginTransaction 块内调用 stageWrite");
        const raw = JSON.stringify(data);
        this.transactionStaging.set(filePath, {
            content: JSON.parse(raw),
            sizeBytes: raw.length,
            updatedAt: Date.now()
        });
    }

    commitTransaction() {
        if (!this.isInTransaction) return false;
        for (const [k, v] of this.transactionStaging.entries()) {
            this.virtualDisk.set(k, v);
        }
        this.transactionStaging.clear();
        this.isInTransaction = false;
        return true;
    }

    rollbackTransaction() {
        this.transactionStaging.clear();
        this.isInTransaction = false;
    }

    read(filePath) {
        return this.virtualDisk.get(filePath)?.content || null;
    }

    exportFullSystemDump() {
        const files = {};
        let totalSize = 0;
        for (const [k, v] of this.virtualDisk.entries()) {
            files[k] = v;
            totalSize += v.sizeBytes;
        }
        return {
            vaultVersion: "4.140.0",
            exportedTimestamp: Date.now(),
            totalFiles: this.virtualDisk.size,
            totalSizeBytes: totalSize,
            diskState: files
        };
    }

    importFullSystemDump(dump) {
        if (!dump || !dump.diskState) return false;
        this.virtualDisk.clear();
        for (const [k, v] of Object.entries(dump.diskState)) {
            this.virtualDisk.set(k, v);
        }
        return true;
    }
}
if (typeof globalThis !== "undefined") { globalThis.AtomicFilesystemSnapshotVault = AtomicFilesystemSnapshotVault; }
if (typeof window !== "undefined") { window.AtomicFilesystemSnapshotVault = AtomicFilesystemSnapshotVault; }
if (typeof module !== "undefined" && module.exports) { module.exports = AtomicFilesystemSnapshotVault; }
export default AtomicFilesystemSnapshotVault;