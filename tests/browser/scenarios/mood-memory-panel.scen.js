import { MoodApp } from '/apps/mood/mood-app.js';

const mount = document.createElement('div');
mount.style.cssText = 'width: min(100%, 320px); height: 540px';
document.body.appendChild(mount);
window.VirtualPhone = { memoryCore: { longTerm: [null, { content: 'a' }, { metadata: { _permission: 'cite' } }] } };
const shell = { setContent(html) { mount.innerHTML = html; }, getContentContainer() { return mount; } };
new MoodApp(shell, {}).render();
await new Promise(resolve => {
    const css = document.getElementById('mood-v4-css');
    if (css.sheet) resolve(); else css.addEventListener('load', resolve, { once: true });
});
mount.querySelector('[data-act=tab][data-tab=memory]').click();
const page = mount.querySelector('[data-page=memory]');
const cards = [...(page?.querySelectorAll('.mood-stat') || [])];
const counts = Object.fromEntries(cards.map(el => [el.querySelector('span').textContent, el.querySelector('b').textContent]));
report({ name: 'memory-tab-counts', ok: counts['长期'] === '2' && counts['未标注'] === '1' && counts['可引用'] === '1', detail: JSON.stringify(counts) });
const bounds = mount.getBoundingClientRect();
const fits = cards.length === 9 && cards.every(card => {
    const box = card.getBoundingClientRect();
    return box.width > 0 && box.left >= bounds.left - 1 && box.right <= bounds.right + 1 &&
        [...card.children].every(child => child.scrollWidth <= child.clientWidth + 1 || child.clientWidth === 0 && child.getBoundingClientRect().width <= box.width);
});
report({ name: 'memory-stats-fit', ok: fits, detail: `width=${bounds.width} stats=${cards.length}` });
done();
