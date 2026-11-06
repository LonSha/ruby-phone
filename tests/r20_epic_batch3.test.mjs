/* [v4.137.0 · V20 手机端批次3] 跨应用侦探物证链与不在场证明矛盾裁决测试 */
import test from 'node:test';
import assert from 'node:assert/strict';
import EvidenceMatrix from '../apps/investigation/cross-app-evidence-chain-matrix.js';

test('R20-O5 跨应用物证搜集、不在场证明时空矛盾分析与审讯指令', async () => {
    const state = EvidenceMatrix.createInitialEvidenceMatrixState();

    const baseTime = Date.now();

    // 嫌疑人 A 在微信声称自己在公司加班
    EvidenceMatrix.registerEvidenceNode(state, {
        id: 'wechat_msg_1',
        source: EvidenceMatrix.EVIDENCE_SOURCE.WECHAT,
        actor: '赵副总',
        timestamp: baseTime,
        location: '集团总部科技园',
        claimOrFact: '在7楼办公室核对财务报表',
        isAlibi: true
    });

    // 但20分钟后的钱包账单显示其在城东私人俱乐部有巨额消费
    EvidenceMatrix.registerEvidenceNode(state, {
        id: 'bill_receipt_1',
        source: EvidenceMatrix.EVIDENCE_SOURCE.WALLET,
        actor: '赵副总',
        timestamp: baseTime + 20 * 60000,
        location: '城东暗夜私人会所',
        claimOrFact: '刷卡支付会所包厢与洋酒账单 48000 元',
        isAlibi: false
    });

    // 检测矛盾
    const contra = EvidenceMatrix.detectEvidenceContradictions(state);
    assert.equal(contra.length, 1, '必须检出不在场证明时空冲突');
    assert.match(contra[0].reason, /不在场证明严重冲突/);

    // 导出审讯对质指令
    const dirs = EvidenceMatrix.resolveInvestigationDirectives(state, '赵副总');
    assert.equal(dirs.length, 1);
    assert.match(dirs[0], /侦探破绽证据链/);
    assert.match(dirs[0], /城东暗夜私人会所/);
});