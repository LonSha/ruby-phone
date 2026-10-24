import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorldState, WORLD_STATES } from '../config/phone-world-state-machine.js';

test('R9-X1 · 手机世界状态机多源情境投影', () => {
    // 1. 存在进行中跨应用事务 -> HAPPENING
    const s1 = resolveWorldState({ activeIncidentCount: 2 });
    assert.equal(s1.state, WORLD_STATES.HAPPENING);

    // 2. 无事务但有待回应事项 -> AWAITING_RESPONSE
    const s2 = resolveWorldState({ activeIncidentCount: 0, pendingResponseCount: 3 });
    assert.equal(s2.state, WORLD_STATES.AWAITING_RESPONSE);

    // 3. 转场中 -> TRANSITION
    const s3 = resolveWorldState({ activeIncidentCount: 0, pendingResponseCount: 0, isTransitioning: true });
    assert.equal(s3.state, WORLD_STATES.TRANSITION);

    // 4. 空闲断档期 -> HIATUS
    const s4 = resolveWorldState({});
    assert.equal(s4.state, WORLD_STATES.HIATUS);
});