import test from 'node:test';
import assert from 'node:assert/strict';

import { ImeDraftGuardian } from '../phone/ime-draft-guardian.js';
import { AmbientCallSimulator } from '../phone/ambient-call-simulator.js';
import { PhoneShell } from '../phone/phone-shell.js';

test('R15-Batch-E: 拟真输入法口癖联想与长草稿防护中枢 (R15-O4)', () => {
    const guardian = new ImeDraftGuardian();

    // 1. 口癖联想根据人设标签推导
    const tsundereSuggestions = guardian.suggestCatchphrases('tsundere', '别');
    assert.ok(tsundereSuggestions.length > 0);
    assert.match(tsundereSuggestions[0], /哼，别多想/);

    const devotedSuggestions = guardian.suggestCatchphrases('devoted');
    assert.ok(devotedSuggestions.length > 0);
    assert.match(devotedSuggestions[0], /只要你需要/);

    // 2. 长草稿持久化防护
    const saved = guardian.saveDraft('chat_catherine', '今天在图书馆看到的古卷，似乎记载着……');
    assert.equal(saved, true);

    const draft = guardian.getDraft('chat_catherine');
    assert.ok(draft);
    assert.match(draft.text, /今天在图书馆/);

    // 3. 草稿清空
    guardian.clearDraft('chat_catherine');
    assert.equal(guardian.getDraft('chat_catherine'), null);

    // 4. 破坏性负控制：空 appId 无法保存草稿
    const emptySave = guardian.saveDraft('', 'test content');
    assert.equal(emptySave, false);
});

test('R15-Batch-E: 通话环境背景音与天气噪点模拟器 (R15-X4)', () => {
    // 1. 暴风雪情境音
    const blizzardAtmosphere = AmbientCallSimulator.formatCallAtmosphere({
        weather: '极地暴雪',
        signalStrength: 4
    });
    assert.match(blizzardAtmosphere.noiseTag, /呼啸的风雪声/);
    const spokenBlizzard = blizzardAtmosphere.formattedSpeakerPrefix('莉莉娅', '你听得清我说话吗？');
    assert.match(spokenBlizzard, /莉莉娅〔呼啸的风雪声与气流破音〕：“你听得清我说话吗？”/);

    // 2. 暴雨情境音
    const rainAtmosphere = AmbientCallSimulator.formatCallAtmosphere({
        weather: '倾盆大雨',
        signalStrength: 3
    });
    assert.match(rainAtmosphere.noiseTag, /淅沥的雨声/);

    // 3. 弱信号噪点
    const poorSignalAtmosphere = AmbientCallSimulator.formatCallAtmosphere({
        weather: '晴天',
        signalStrength: 1
    });
    assert.match(poorSignalAtmosphere.noiseTag, /微弱的电流杂音/);

    // 4. 晴朗安静环境
    const clearAtmosphere = AmbientCallSimulator.formatCallAtmosphere({
        weather: '晴朗',
        signalStrength: 4
    });
    assert.match(clearAtmosphere.noiseTag, /清晰的通话背景音/);
});

test('R15-Batch-E: PhoneShell 宿主接线与锁屏情境动态壁纸微语 (R15-X3)', () => {
    const shell = new PhoneShell();
    shell.personaSign = '与你同在';
    shell.currentWeather = '暴风雪';
    assert.ok(shell.imeGuardian instanceof ImeDraftGuardian, 'ImeDraftGuardian 必须挂载在 shell.imeGuardian');
    assert.equal(typeof shell.ambientCallSimulator.formatCallAtmosphere, 'function', 'AmbientCallSimulator 必须暴露在 shell 上');
    assert.equal(shell.personaSign, '与你同在');
    assert.equal(shell.currentWeather, '暴风雪');
});