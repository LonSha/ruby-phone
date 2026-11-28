export function scoreVoiceFeatures(frequencyJitter, phaseDiscontinuity, spectralArtifactNoise) {
  let score = 0.1;
  const artefacts = [];

  if (frequencyJitter < 0.01) {
    score += 0.45;
    artefacts.push('缺失人类生理声带神经自然微抖动 (Jitter < 0.01)');
  }
  if (phaseDiscontinuity > 0.5) {
    score += 0.25;
    artefacts.push('频段拼接处出现非连续相位突变');
  }
  if (spectralArtifactNoise > 0.7) {
    score += 0.25;
    artefacts.push('20kHz以上检出高频扩散截断噪声与生成模型水印');
  }

  return { score, artefacts, isSyntheticDeepfake: score >= 0.85 };
}
