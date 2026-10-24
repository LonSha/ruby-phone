import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateCharacterProposal, PROPOSAL_STATUS } from '../config/proactive-proposal-co-builder.js';

test('R9-X9 · 角色主动提案塑造手机裁决与配置留痕', () => {
    const proposal = {
        id: 'prop_wallpaper',
        proposerActorId: 'alice',
        suggestedConfig: { wallpaperTheme: 'night_forest' }
    };

    // 用户修改后批准
    const res = adjudicateCharacterProposal(proposal, {
        verdict: 'modify',
        modifiedConfig: { wallpaperTheme: 'night_forest_dark_mode' },
        note: '夜间森林主题需要搭配深色字体'
    });

    assert.equal(res.success, true);
    assert.equal(res.status, PROPOSAL_STATUS.MODIFIED);
    assert.equal(res.finalConfig.wallpaperTheme, 'night_forest_dark_mode');
    assert.equal(res.userFeedback, '夜间森林主题需要搭配深色字体');
});