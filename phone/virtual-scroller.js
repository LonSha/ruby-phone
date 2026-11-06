/* ========================================================
 * phone/virtual-scroller.js
 * [v4.132.0 · R15-O7] 超长聊天记录虚拟滚动切片渲染引擎
 * ======================================================== */
export class VirtualListScroller {
    /**
     * @param {Object} options
     * @param {number} options.itemHeight 预估单项高度 (px)
     * @param {number} options.viewportHeight 视口高度 (px)
     * @param {number} options.bufferCount 上下缓冲区条目数
     */
    constructor(options = {}) {
        this.itemHeight = options.itemHeight || 60;
        this.viewportHeight = options.viewportHeight || 600;
        this.bufferCount = options.bufferCount || 5;
        this.totalCount = 0;
        this.scrollTop = 0;
    }

    /**
     * 计算当前视口需要切片渲染的条目区间
     * @param {number} totalCount 列表总数据量
     * @param {number} scrollTop 当前容器滚动条偏移
     * @returns {Object} { startIndex, endIndex, topPadding, bottomPadding, visibleCount }
     */
    computeSlice(totalCount, scrollTop = 0) {
        this.totalCount = Math.max(0, Number(totalCount) || 0);
        this.scrollTop = Math.max(0, Number(scrollTop) || 0);

        if (this.totalCount === 0) {
            return {
                startIndex: 0,
                endIndex: 0,
                topPadding: 0,
                bottomPadding: 0,
                visibleCount: 0
            };
        }

        const visibleCapacity = Math.ceil(this.viewportHeight / this.itemHeight);
        const rawStartIndex = Math.floor(this.scrollTop / this.itemHeight);
        
        const startIndex = Math.max(0, rawStartIndex - this.bufferCount);
        const endIndex = Math.min(this.totalCount, rawStartIndex + visibleCapacity + this.bufferCount);

        const topPadding = startIndex * this.itemHeight;
        const bottomPadding = Math.max(0, (this.totalCount - endIndex) * this.itemHeight);

        return {
            startIndex,
            endIndex,
            topPadding,
            bottomPadding,
            visibleCount: endIndex - startIndex
        };
    }
}
