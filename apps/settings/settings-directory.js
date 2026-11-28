const entries = {
    general: ['通用', 'gear', '#626974'], memory: ['记忆与联动', 'link', '#187257'],
    llm: ['模型与 API', 'sliders', '#1264b4'], tts: ['语音与朗读', 'volume-high', '#b53750'],
    image: ['图像生成', 'image', '#8650a4'], lobby: ['大厅', 'users', '#8a6027']
};

export function mountSettingsDirectory(root, controller) {
    if (!root) return;
    const tabs = root.querySelector('.yzp-settings-tabs');
    const body = root.querySelector('.yzp-settings-body');
    const title = root.querySelector('.yzp-settings-header h2');
    const back = root.querySelector('#yzp-settings-home-back');
    if (!tabs || !body || !title || !back) return;
    const doc = root.ownerDocument;
    if (!doc.getElementById('rp-settings-directory-style')) {
        const link = doc.createElement('link'); link.id = 'rp-settings-directory-style'; link.rel = 'stylesheet';
        link.href = new URL('./settings-directory.css', import.meta.url).href;
        doc.head.append(link);
    }
    const directory = doc.createElement('nav');
    directory.className = 'rp-settings-directory';
    directory.setAttribute('aria-label', '设置分类');
    body.before(directory);
    const tabButtons = [...tabs.querySelectorAll('[data-tab]')];
    function display(detail) {
        controller._settingsDetail = detail;
        root.dataset.settingsView = detail ? 'detail' : 'directory';
        directory.hidden = !!detail;
        body.hidden = !detail;
        title.textContent = detail ? (entries[detail]?.[0] || detail) : '设置';
        back.title = detail ? '返回设置' : '返回手机桌面';
        back.setAttribute('aria-label', back.title);
    }
    for (const tab of tabButtons) {
        const key = tab.dataset.tab;
        const [label, icon, color] = entries[key] || [tab.textContent, 'gear', '#626974'];
        const row = doc.createElement('button');
        row.type = 'button'; row.dataset.category = key;
        const glyph = doc.createElement('i'); glyph.className = 'fa-solid fa-' + icon;
        glyph.setAttribute('aria-hidden', 'true'); glyph.style.backgroundColor = color;
        const text = doc.createElement('span'); text.textContent = label;
        const chevron = doc.createElement('i'); chevron.className = 'fa-solid fa-chevron-right'; chevron.setAttribute('aria-hidden','true');
        row.append(glyph, text, chevron); directory.append(row);
        row.addEventListener('click', () => { display(key); tab.click(); controller._getActiveSettingsRoot()?.querySelector('#yzp-settings-home-back')?.focus(); });
        tab.addEventListener('click', () => display(key), true);
    }
    root.addEventListener('click', e => {
        if (e.target.closest('.r25-ia-group,.r25-ia-hit')) display(controller.currentTab);
    }, true);
    back.addEventListener('click', e => {
        if (!controller._settingsDetail) return;
        e.stopImmediatePropagation(); e.preventDefault();
        const last = controller._settingsDetail; display(null);
        directory.querySelector(`[data-category="${last}"]`)?.focus();
    }, true);
    display(controller._settingsDetail ? controller.currentTab : null);
}
