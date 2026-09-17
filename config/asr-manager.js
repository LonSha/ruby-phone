/* ========================================================
 *  RubyPhone ASR Manager (语音输入)
 *  架构对齐 config/tts-manager.js：provider 默认值 + scoped
 *  storage key（phone-asr-<provider>-<field>）+ relay 中转可选。
 * ======================================================== */
export class AsrManager {
    constructor(storage) {
        this.storage = storage;
    }

    // ---------- provider 默认值（与 TTS 同构） ----------
    _getProviderDefaults(provider) {
        const defaults = {
            minimax_cn: {
                url: 'https://api.minimaxi.com/v1/audio/translations',
                model: 'speech-02-turbo'
            },
            openai: {
                url: 'https://api.openai.com/v1/audio/transcriptions',
                model: 'gpt-4o-mini-transcribe'
            },
            volcengine: {
                url: 'https://openspeech.bytedance.com/api/v3/sauc/bigmodel',
                model: 'bigmodel'
            },
            local: {
                // 浏览器原生 Web Speech API（零配置、零费用、离线可用）
                url: '',
                model: 'webkitSpeechRecognition'
            }
        };
        return defaults[provider] || defaults.openai;
    }

    _getProviderConfigKey(provider, field) {
        return `phone-asr-${provider}-${field}`;
    }

    _getStoredProviderValue(provider, field, legacyKey = '') {
        const scoped = String(this.storage?.get?.(this._getProviderConfigKey(provider, field)) || '').trim();
        if (scoped) return scoped;
        if (legacyKey) {
            return String(this.storage?.get?.(legacyKey) || '').trim();
        }
        return '';
    }

    _inferProviderFromUrl(apiUrl = '', fallback = 'openai') {
        const url = String(apiUrl || '').trim().toLowerCase();
        if (!url) return String(fallback || '').trim() || 'openai';
        if (url.includes('minimaxi.com')) return 'minimax_cn';
        if (url.includes('openspeech.bytedance.com')) return 'volcengine';
        if (url.includes('api.openai.com') || /\/audio\/transcriptions\b/.test(url)) return 'openai';
        return String(fallback || '').trim() || 'openai';
    }

    // ---------- 配置解析 ----------
    _resolveConfig(options = {}) {
        const provider = String(options.provider || this.storage?.get?.('phone-asr-provider') || 'openai').trim() || 'openai';
        const defaults = this._getProviderDefaults(provider);
        const apiKey = String(options.apiKey || this._getStoredProviderValue(provider, 'key', 'phone-asr-key') || '').trim();
        const apiUrl = String(options.apiUrl || this._getStoredProviderValue(provider, 'url', 'phone-asr-url') || '').trim()
            || (provider === 'local' ? '' : defaults.url || '');
        const model = String(options.model || this._getStoredProviderValue(provider, 'model', 'phone-asr-model') || '').trim()
            || defaults.model || '';
        const language = String(options.language || this.storage?.get?.('phone-asr-language') || 'zh-CN').trim() || 'zh-CN';
        const relayUrl = String(options.relayUrl || this._getStoredProviderValue(provider, 'relay-url') || '').trim().replace(/\/+$/, '');
        return { provider, apiKey, apiUrl, model, language, relayUrl };
    }

    // ---------- 浏览器能力探测 ----------
    isLocalAsrSupported() {
        return typeof window !== 'undefined'
            && (typeof window.SpeechRecognition === 'function'
                || typeof window.webkitSpeechRecognition === 'function');
    }

    // ---------- 音频读取工具（与 TTS 同构） ----------
    _readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const raw = String(reader.result || '');
                resolve(raw.includes(',') ? raw.split(',').pop() : raw);
            };
            reader.onerror = () => reject(reader.error || new Error('音频文件读取失败'));
            reader.readAsDataURL(file);
        });
    }

    _inferAudioMime(file) {
        const type = String(file?.type || '').trim();
        if (type) return type;
        const name = String(file?.name || '').toLowerCase();
        if (name.endsWith('.wav')) return 'audio/wav';
        if (name.endsWith('.flac')) return 'audio/flac';
        if (name.endsWith('.m4a')) return 'audio/mp4';
        if (name.endsWith('.ogg')) return 'audio/ogg';
        if (name.endsWith('.webm')) return 'audio/webm';
        return 'audio/mpeg';
    }

    // ---------- 通用网络层（与 TTS 同构：relay 可选 / rawFetch 透传酒馆内部标记） ----------
    _getRawFetch() {
        if (typeof window !== 'undefined' && window.VirtualPhoneRawFetch) return window.VirtualPhoneRawFetch;
        if (typeof window !== 'undefined' && typeof window.fetch === 'function') return window.fetch.bind(window);
        return fetch;
    }

    async _getCsrfToken() {
        try {
            const headers = typeof window !== 'undefined' && typeof window.getRequestHeaders === 'function'
                ? window.getRequestHeaders() || {}
                : {};
            const existing = headers['X-CSRF-Token'] || headers['x-csrf-token'];
            if (existing) return String(existing);
            const rawFetch = this._getRawFetch();
            const response = await rawFetch('/csrf-token', {
                credentials: 'include',
                cache: 'no-store',
                stPhoneInternalApi: true,
                headers: { 'X-ST-Phone-Internal-API': '1' }
            });
            if (!response.ok) return null;
            const data = await response.json().catch(() => null);
            return String(data?.token || '').trim() || null;
        } catch (_e) {
            return null;
        }
    }

    async _buildStJsonHeaders() {
        const headers = {};
        try {
            if (typeof window !== 'undefined' && typeof window.getRequestHeaders === 'function') {
                Object.assign(headers, window.getRequestHeaders() || {});
            }
        } catch (_e) { }
        delete headers['content-type'];
        delete headers['Content-Type'];
        headers['Content-Type'] = 'application/json';
        headers['X-ST-Phone-Internal-API'] = '1';
        if (!headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
            const token = await this._getCsrfToken();
            if (token) headers['X-CSRF-Token'] = token;
        }
        return headers;
    }

    _formatNetworkError(error) {
        const message = String(error?.message || error || '').trim();
        if (/failed to fetch|networkerror|load failed|err_failed/i.test(message)) {
            return '语音识别网络请求失败。若浏览器控制台提示 CORS，可配置 ASR Worker 中转。';
        }
        if (/aborted|aborterror/i.test(message)) {
            return '语音识别请求已超时或被取消';
        }
        return message || '语音识别请求失败';
    }

    _extractText(payload) {
        if (!payload) return '';
        if (typeof payload === 'string') return payload;
        if (typeof payload.text === 'string') return payload.text;
        if (typeof payload.transcript === 'string') return payload.transcript;
        if (typeof payload.result === 'string') return payload.result;
        if (Array.isArray(payload.segments)) {
            return payload.segments.map(s => String(s?.text || s?.transcript || '')).join('').trim();
        }
        if (payload.data && typeof payload.data === 'object') return this._extractText(payload.data);
        // MiniMax translations: { translations: [{ text }] }
        if (Array.isArray(payload.translations)) {
            return payload.translations.map(t => String(t?.text || '')).join(' ').trim();
        }
        return '';
    }

    // ---------- 本地 Web Speech（零配置兜底，始终优先可用） ----------
    _recognizeLocal({ language = 'zh-CN', signal } = {}) {
        return new Promise((resolve, reject) => {
            const Ctor = typeof window !== 'undefined'
                ? (window.SpeechRecognition || window.webkitSpeechRecognition)
                : null;
            if (!Ctor) {
                reject(new Error('当前浏览器不支持本地语音识别（Web Speech API）'));
                return;
            }
            const recognition = new Ctor();
            recognition.lang = language || 'zh-CN';
            recognition.interimResults = false;
            recognition.maxAlternatives = 1;
            let settled = false;
            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                try { recognition.stop(); } catch (_e) { }
                fn(value);
            };
            recognition.onresult = (event) => {
                const transcript = Array.from(event.results || [])
                    .map(r => Array.from(r || []).map(a => String(a?.transcript || '')).join(''))
                    .join('')
                    .trim();
                finish(resolve, transcript);
            };
            recognition.onerror = (event) => {
                const code = String(event?.error || 'unknown').trim();
                if (code === 'no-speech') finish(resolve, '');
                else if (code === 'not-allowed' || code === 'service-not-allowed') {
                    finish(reject, new Error('浏览器拒绝了麦克风权限，请在站点设置中允许麦克风访问'));
                } else {
                    finish(reject, new Error(`本地语音识别失败：${code}`));
                }
            };
            recognition.onend = () => finish(resolve, '');
            if (signal) {
                if (signal.aborted) finish(reject, new Error('语音识别已取消'));
                else signal.addEventListener('abort', () => finish(reject, new Error('语音识别已取消')), { once: true });
            }
            try {
                recognition.start();
            } catch (e) {
                reject(new Error(`本地语音识别启动失败：${String(e?.message || e)}`));
            }
        });
    }

    // ---------- 录音采集（供 UI 长按/点按使用） ----------
    async startRecording(signal) {
        if (typeof window === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
            throw new Error('当前环境不支持麦克风录音');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (signal?.aborted) {
            stream.getTracks().forEach(t => t.stop());
            throw new Error('语音识别已取消');
        }
        const mime = this._pickSupportedMime();
        const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e?.data?.size) chunks.push(e.data); };
        return new Promise((resolve, reject) => {
            recorder.onerror = (e) => {
                stream.getTracks().forEach(t => t.stop());
                reject(new Error(String(e?.error?.message || '录音失败')));
            };
            recorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(chunks, { type: mime || 'audio/webm' });
                resolve(blob);
            };
            if (signal) signal.addEventListener('abort', () => {
                try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_e) { }
            }, { once: true });
            recorder.start();
        });
    }

    _pickSupportedMime() {
        if (typeof MediaRecorder === 'undefined') return '';
        const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
        for (const m of candidates) {
            try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_e) { }
        }
        return '';
    }

    async _blobToBase64(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    // ---------- 对外主入口 ----------
    /**
     * 语音识别
     * @param {Blob|File} audioBlob 音频数据（startRecording 产物或外部音频文件）
     * @param {object} options { provider, language, signal, relayUrl, forceLocal }
     * @returns {Promise<string>} 识别文本
     */
    async transcribe(audioBlob, options = {}) {
        const config = this._resolveConfig(options);
        const provider = options.forceLocal ? 'local' : config.provider;
        if (provider === 'local') {
            // 本地模式直接走 Web Speech（不录音，浏览器自采）
            return this._recognizeLocal({ language: config.language, signal: options.signal });
        }
        if (!audioBlob) throw new Error('缺少音频数据');
        if (Number(audioBlob.size || 0) > 25 * 1024 * 1024) throw new Error('音频文件不能超过 25MB');
        if (!config.apiUrl) throw new Error('未配置 ASR 接口地址');
        if (!config.apiKey && !config.relayUrl) throw new Error('缺少 ASR API Key（或配置 Worker 中转）');

        const mime = this._inferAudioMime(audioBlob);
        const base64 = await this._blobToBase64(audioBlob);
        const filename = `asr_${Date.now()}.${String(mime.split('/')[1] || 'webm').split(';')[0] || 'webm'}`;

        // relay 中转：base64 JSON，避免 CORS 与直连密钥暴露
        if (config.relayUrl) {
            const rawFetch = this._getRawFetch();
            const response = await rawFetch(`${config.relayUrl}/api/asr`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiUrl: config.apiUrl,
                    apiKey: config.apiKey,
                    model: config.model,
                    language: config.language,
                    audioBase64: base64,
                    audioFormat: filename.split('.').pop() || 'webm',
                    mime
                }),
                signal: options.signal
            }).catch(e => { throw new Error(this._formatNetworkError(e)); });
            const text = await response.text().catch(() => '');
            let payload = null;
            try { payload = JSON.parse(text || '{}'); } catch (_e) { payload = null; }
            if (!response.ok || payload?.success === false) {
                const message = payload?.error?.message || payload?.error || payload?.message || text;
                throw new Error(`语音识别中转 HTTP ${response.status}${message ? `：${String(message).slice(0, 300)}` : ''}`);
            }
            const recognized = this._extractText(payload?.result || payload);
            if (!recognized) throw new Error('语音识别返回空文本');
            return recognized;
        }

        // 直连：multipart/form-data（OpenAI / MiniMax / 火山兼容）
        const rawFetch = this._getRawFetch();
        const formData = new FormData();
        formData.append('file', audioBlob, filename);
        formData.append('model', config.model);
        if (config.language) formData.append('language', config.language);

        let response;
        try {
            response = await rawFetch(config.apiUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${config.apiKey}` },
                body: formData,
                signal: options.signal
            });
        } catch (e) {
            throw new Error(this._formatNetworkError(e));
        }
        const text = await response.text().catch(() => '');
        let payload = null;
        try { payload = JSON.parse(text || '{}'); } catch (_e) { payload = null; }
        if (!response.ok) {
            const message = payload?.error?.message || payload?.error?.code || payload?.message || text;
            throw new Error(`语音识别 HTTP ${response.status}${message ? `：${String(message).slice(0, 300)}` : ''}`);
        }
        const recognized = this._extractText(payload);
        if (!recognized) throw new Error('语音识别返回空文本');
        return recognized;
    }

    // ---------- 一站式：录音 → 识别（UI 层只调这一个） ----------
    /**
     * 按住说话 → 松开识别。本地模式直接走 Web Speech 无需录音。
     * @returns {Promise<string>} 识别文本
     */
    async recognizeOnce(options = {}) {
        const config = this._resolveConfig(options);
        // [v2.22.0] 自动回落开关：兼容布尔与字符串 'false'（与项目其它布尔键读取风格一致）
        const autoLocalRaw = this.storage?.get?.('phone-asr-auto-local');
        const autoLocalEnabled = autoLocalRaw !== false && autoLocalRaw !== 'false';
        const useLocal = options.forceLocal
            || (config.provider === 'local')
            || (autoLocalEnabled && !config.apiKey && !config.relayUrl);
        if (useLocal && this.isLocalAsrSupported()) {
            return this._recognizeLocal({ language: config.language, signal: options.signal });
        }
        const blob = await this.startRecording(options.signal);
        return this.transcribe(blob, { ...options, provider: config.provider });
    }
}
