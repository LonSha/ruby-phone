/**
 * first-chunk-barrier.js — [v2.12.0 缝合] 并发 LLM 调用首 chunk 屏障
 *
 * 【来源】缝合 FunnyCups/Luker（SillyTavern 分叉）orchestrator 扩展的
 *         dispatch-barrier.js，按 ruby-phone 工程规范重写为可测纯函数 ESM 模块。
 *         保留其完整契约（见下），非照抄。
 *
 * 【机制】
 *   ruby-phone 多 App（微信/世界脉搏/织光机…）可能并发调用同一 LLM connection-profile。
 *   若同一 profile 的多个请求同时冷启动，会竞争上游的 prompt-cache 冷写，全部 miss。
 *   本屏障让同 key（通常 = connection-profile 名）的并发放出中：
 *   - 首个到达者为 lead，立即发请求并流式读取
 *   - 第二/三/…个为 follower，先 await lead 的「首个上游 chunk」再发自己的请求
 *   这给上游（如 Anthropic）时间预热 prompt 缓存，follower 命中 cache-read 而非
 *   竞争冷写 —— 显著降低多并发调用的输入 token 成本与首 token 延迟。
 *
 * 【契约（对齐 Luker）】
 *   - 每个 orchestrator run 一个 barrier 实例，实例间不共享状态
 *   - acquire() 同步原子：JS 单线程下 Promise.all 的并发 fan-out 串行通过 acquire，
 *     首个到达者赢 lead，无竞态
 *   - signalFirstChunk() 幂等：流式代码可每个 delta 都调，无需判「是否第一」
 *   - release() 于 lead 释放槽位供下一批，且 resolve 任何仍等待的 follower
 *     （fail-open：lead 出错/中止前未流式，绝不挂起兄弟）
 *   - release() 于 follower 是 no-op（仅 lead 拥有槽位）
 *   - follower 永远 RESOLVE 不 reject：屏障只是延迟优化，兄弟不能因 lead 失败而失败
 *   - 伪 key（null/''/undefined）完全退出协调：每个调用者都是无协调的独立 lead
 *
 * 【与源码差异】
 *   - 源码为 Luker orchestrator 内部模块；本实现自包含 ESM，可被 ruby-phone
 *     任意 App 的 apiManager 调用点复用
 *   - 增加 pendingFollowers(key)：观测某 key 当前等待中的 follower 数（调试用）
 *   - 增加 activeLeadCount：观测当前活跃的 lead 槽位数（调试用）
 */

/**
 * 创建首 chunk 屏障实例
 * @returns {{acquire: Function, pendingFollowers: Function, activeLeadCount: Function}}
 */
export function createFirstChunkBarrier() {
    // Map<key, { firstChunkPromise, resolveFirstChunk, followerCount }>
    const slots = new Map();

    function acquire(key) {
        // 伪 key 退出协调：退化的 lead 角色，无任何协调开销
        if (!key) {
            return {
                role: 'lead',
                wait: Promise.resolve(),
                signalFirstChunk: () => {},
                release: () => {},
            };
        }

        const existing = slots.get(key);
        if (existing) {
            // follower：共享 lead 的 promise。wait 永不 reject —— release() 也会
            // resolve 它，故 lead 失败是 fail-open。
            existing.followerCount++;
            return {
                role: 'follower',
                wait: existing.firstChunkPromise,
                signalFirstChunk: () => {},
                release: () => {},
            };
        }

        // 新 lead：先装槽再返回，使紧随的同步 acquire(key) 成为 follower。
        // 原子性依赖 JS 单线程执行模型。
        let resolveFirstChunk;
        const firstChunkPromise = new Promise(resolve => { resolveFirstChunk = resolve; });
        const slot = { firstChunkPromise, resolveFirstChunk, followerCount: 0 };
        slots.set(key, slot);

        // 防止槽位被驱逐后仍调 release/signal（如 release 后迟到的流 chunk）
        let evicted = false;

        return {
            role: 'lead',
            wait: Promise.resolve(),
            signalFirstChunk: () => {
                // 幂等 —— Promise resolve 在 settle 后是 no-op
                resolveFirstChunk();
            },
            release: () => {
                if (evicted) return;
                evicted = true;
                // 先 resolve 仍等待的 follower（fail-open）再驱逐槽位 —— 否则在
                // signal 与 release 间 acquire 的 follower 会卡在永不 resolve 的 promise。
                resolveFirstChunk();
                // 仅当仍是自己占槽才驱逐。迟到 release 不能破坏后续批次的 lead。
                if (slots.get(key) === slot) {
                    slots.delete(key);
                }
            },
        };
    }

    /** 某 key 当前等待中的 follower 数（无该 key 槽位返回 0） */
    function pendingFollowers(key) {
        return slots.get(key)?.followerCount ?? 0;
    }

    /** 当前活跃的 lead 槽位数 */
    function activeLeadCount() {
        return slots.size;
    }

    return { acquire, pendingFollowers, activeLeadCount };
}