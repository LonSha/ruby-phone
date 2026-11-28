import { FocusApp } from '/apps/focus/focus-app.js';

const stage = document.querySelector('#__stage');
stage.innerHTML = '<div id="phone-panel" data-rp-ds="2" data-rp-ios="3"><div id="focus-mount" style="height:320px;width:min(100vw,390px)"></div></div>';
const panel = stage.firstElementChild;
panel.classList.add('phone-panel-open');
// Host fixture supplies a finite shell, not app layout rules.
panel.style.cssText = 'display:block;position:relative;inset:auto;transform:none;width:fit-content;height:auto;opacity:1;visibility:visible';
const mount = document.querySelector('#focus-mount');
const store = new Map();
const app = new FocusApp({ getContentContainer: () => mount }, store);
app.render();
const q = sel => mount.querySelector(sel);
const nav = page => q('[data-fc-nav="' + page + '"]').click();
const selected = page => mount.querySelectorAll('.fc-scroll:not([hidden])').length === 1 &&
    q('.fc-scroll:not([hidden])').dataset.fcPage === page && q('[aria-current="page"]').dataset.fcNav === page;
const check = (name, ok, detail = '') => report({ name, ok: Boolean(ok), detail });
check('default-page', selected('timer') && !store.size);
q('#fc-choose').click();
check('choose-opens-tasks', selected('tasks'));
const input = q('#fc-name');
input.value = '读一章';
q('#fc-add').click();
check('create-task', store.get('focus_tasks').length === 1 && q('.fc-task-name').textContent === '读一章');
q('.fc-start').click();
check('start-shows-timer', selected('timer') && app.isRunning() && q('.fc-timer').textContent !== '00:00');
q('#fc-pause').click();
check('pause', !app.isRunning() && q('#fc-resume'));
q('#fc-resume').click();
q('#fc-poke').click();
check('resume-poke', app.isRunning() && app.pokeCount() === 1);
nav('tasks');
input.value = '未提交的草稿';
q('input[value="stopwatch"]').click();
const pill = q('.fc-pill:last-child');
pill.click();
nav('settings');
q('#fc-goal').value = '75';
q('#fc-goal').dispatchEvent(new Event('change'));
check('settings-save', JSON.parse(store.get('focus_settings')).dailyGoalMinutes === 75 && app.isRunning());
nav('tasks');
input.focus();
// Exercise the controller's real interval and automatic finish, without waiting minutes.
app._deadline = Date.now() - 1;
await window.__sleep(1250);
check('auto-finish-on-other-page', selected('tasks') && !app.currentTask() && store.get('focus_sessions')?.length === 1);
check('draft-and-focus-survive', input === q('#fc-name') && document.activeElement === input && input.value === '未提交的草稿' &&
    q('input[value="stopwatch"]').checked && pill.classList.contains('is-active'),
    [input === q('#fc-name'), document.activeElement.tagName, input.value, q('input[value="stopwatch"]').checked, pill.className].join('|'));
nav('stats');
check('stats-after-finish', selected('stats') && q('.fc-stats').textContent.includes('1 次'));
nav('tasks');
q('.fc-del').click();
check('delete-keeps-history', !q('.fc-task') && store.get('focus_sessions').length === 1);
for (let i = 0; i < 18; i++) app.addTask('长列表 ' + i, 'stopwatch', 25);
app._view.refresh();
const scroll = q('[data-fc-page="tasks"]');
scroll.scrollTop = scroll.scrollHeight;
const box = q('.fc-tabbar').getBoundingClientRect();
const tab = q('[data-fc-nav="tasks"]');
const hit = tab.getBoundingClientRect();
const style = getComputedStyle(tab);
check('short-shell-footer', scroll.scrollTop > 0 && Math.abs(box.bottom - mount.getBoundingClientRect().bottom) < 2 &&
    hit.height >= 44 && document.elementFromPoint(hit.x + hit.width / 2, hit.y + hit.height / 2) === tab &&
    style.textDecorationLine.includes('underline'), JSON.stringify({scroll: scroll.scrollTop, bottom: box.bottom, height: hit.height,
        x: hit.x, y: hit.y, target: document.elementFromPoint(hit.x + hit.width / 2, hit.y + hit.height / 2)?.outerHTML.slice(0,80),
        pointer: style.pointerEvents, visibility: style.visibility}));
app.deactivate();
done();
