/* [v4.137.0 · V20 批次7] AI拟真语音伪造与篡改检测器测试 */
import test from 'node:test';
import assert from 'node:assert/strict';
import TamperDetector from '../apps/audio/ai-voice-deepfake-tamper-detector.js';

test('R20-10 AI拟真语音伪造检测器：声学特征提取、微抖动分析与伪造判定', () => {
    // 1. 模拟自然人声录音（具有自然的基频扰动与微抖动）
    const naturalAnalysis = TamperDetector.analyzeAudioClip({
        clipId: 'voice_note_natural_01',
        callerName: '楚天阔',
        durationSec: 15.2,
        frequencyJitter: 0.038,       // 正常微抖动
        phaseDiscontinuity: 0.05,     // 正常相位
        spectralArtifactNoise: 0.08   // 正常背景杂音
    });

    assert.equal(naturalAnalysis.isSyntheticDeepfake, false);
    assert.ok(naturalAnalysis.deepfakeProbability < 0.35);

    // 2. 模拟由高阶神经网络生成的克隆合成音频（微抖动极低、出现典型扩散截断伪影）
    const deepfakeAnalysis = TamperDetector.analyzeAudioClip({
        clipId: 'voice_note_clone_02',
        callerName: '最高指挥官',
        durationSec: 22.0,
        frequencyJitter: 0.003,       // 机械平滑死寂
        phaseDiscontinuity: 0.65,     // 相位跳变不自然
        spectralArtifactNoise: 0.88   // 典型扩散模型高频噪声伪影
    });

    assert.equal(deepfakeAnalysis.isSyntheticDeepfake, true);
    assert.ok(deepfakeAnalysis.deepfakeProbability >= 0.85);

    // 3. 生成提示词指引
    const directive = TamperDetector.generateTamperDetectionDirectives(deepfakeAnalysis);
    assert.ok(directive);
    assert.match(directive, /【手机安全警报 · AI拟真语音伪造检测】/);
    assert.match(directive, /高频扩散截断噪声/);
    assert.match(directive, /最高指挥官/);
    assert.match(directive, /合成克隆语音/);
});
