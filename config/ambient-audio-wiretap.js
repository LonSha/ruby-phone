/* ========================================================
 * config/ambient-audio-wiretap.js
 * RubyPhone R10-X5 · 手机环境录音机与离线窃听线索解密
 * 
 * 核心机制：
 * 1. 后台环境录音与波形采集 (Ambient Audio Sampling):
 *    - 模拟录音记录: id, recordedAt, durationSec, location, backgroundNoiseLevel (0.1~1.0)
 *    - 依据角色在场与私聊场景自动捕捉环境声
 * 2. 离线窃听线索解密与语音转写 (Wiretap Transcription & Decryption):
 *    - 含有模糊/密谈标签 (WHISPER/ENCRYPTED) 的音频片段需进行降噪解密
 *    - 输出逐字转写对白 (transcripts) 与涉密关键词提取 (secretKeywords)
 * 3. 剧情证据留痕与录音回放 (Audio Evidence Log):
 *    - 将关键涉密录音标记为剧情物证 (CASE_EVIDENCE)
 * ======================================================== */

export class AmbientAudioWiretap {
    constructor(opts = {}) {
        this.storage = opts.storage || null;
        this.recordings = [];
        this.isRecording = false;
        this._currentSession = null;
        this._load();
    }

    _load() {
        if (!this.storage?.get) return;
        try {
            const raw = this.storage.get('audio_wiretap_records', []);
            if (Array.isArray(raw)) this.recordings = raw;
        } catch (_e) {}
    }

    _save() {
        if (!this.storage?.set) return;
        try {
            this.storage.set('audio_wiretap_records', this.recordings);
        } catch (_e) {}
    }

    startRecording(location = '城市某处') {
        this.isRecording = true;
        this._currentSession = {
            id: 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            startedAt: Date.now(),
            location,
            noiseLevel: 0.35,
            waveform: []
        };
        return this._currentSession;
    }

    /**
     * 停止录音并保存音频凭证
     * @param {Object} [metadata] { transcripts: [], actors: [], isEvidence: boolean }
     */
    stopRecording(metadata = {}) {
        if (!this.isRecording || !this._currentSession) return null;

        const durationSec = Math.max(2, Math.round((Date.now() - this._currentSession.startedAt) / 1000));
        const rec = {
            ...this._currentSession,
            durationSec,
            actors: metadata.actors || ['未知声音'],
            transcripts: metadata.transcripts || ['(嘈杂的背景环境杂音与微弱脚步声...)'],
            isEvidence: !!metadata.isEvidence,
            decrypted: !metadata.isEncrypted,
            encryptedClue: metadata.isEncrypted ? '暗号与密谈线索需降噪分析' : null
        };

        this.recordings.unshift(rec);
        this.isRecording = false;
        this._currentSession = null;
        this._save();

        return rec;
    }

    /**
     * 降噪解密窃听录音
     * @param {string} recId 
     * @param {string} decryptedText 
     */
    decryptWiretapAudio(recId, decryptedText) {
        const rec = this.recordings.find(r => r.id === recId);
        if (!rec) return null;

        rec.decrypted = true;
        rec.transcripts = [decryptedText];
        rec.isEvidence = true;
        this._save();

        return rec;
    }

    getEvidenceRecordings() {
        return this.recordings.filter(r => r.isEvidence);
    }
}