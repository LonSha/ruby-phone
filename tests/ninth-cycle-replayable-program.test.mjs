import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplayableProgram, replayProgramStepByPerspective } from '../config/replayable-phone-program.js';

test('R9-X7 · 手机节目单创建与跨角色视角复演', () => {
    const program = createReplayableProgram('深夜电台录制回忆', [
        {
            actorId: 'alice',
            actionDescription: '调低麦克风增益',
            visibleData: { gain: -6, note: '有些紧张', isPrivate: true },
            chosenOption: 'low_gain',
            alternativeOptions: ['keep_default']
        },
        {
            actorId: 'bob',
            actionDescription: '播放开场白片头曲',
            visibleData: { trackName: 'Midnight Jazz', isPrivate: false },
            chosenOption: 'play_music',
            alternativeOptions: []
        }
    ]);

    assert.equal(program.totalSteps, 2);

    // Alice 亲历者视角复演 Step 0：可见私密细节
    const rAlice = replayProgramStepByPerspective(program, 0, 'alice');
    assert.equal(rAlice.canObserveDetails, true);
    assert.equal(rAlice.observedData.gain, -6);
    assert.equal(rAlice.missedOpportunities.length, 1);

    // Bob 观察 Alice 的 Step 0：私密细节被屏蔽
    const rBob = replayProgramStepByPerspective(program, 0, 'bob');
    assert.equal(rBob.canObserveDetails, false);
    assert.equal(rBob.observedData.gain, undefined);
});