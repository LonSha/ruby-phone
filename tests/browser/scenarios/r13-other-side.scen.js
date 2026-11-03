import { CharsView } from '/apps/chars/chars-view.js';
import { otherSideSelfCheck } from '/config/other-side-view.js';
import { CharsApp } from '/apps/chars/chars-app.js';
const css = document.createElement('link');
css.rel = 'stylesheet'; css.href = '/apps/chars/chars.css';
const styled = new Promise((resolve, reject) => { css.onload = resolve; css.onerror = () => reject(Error('chars CSS failed')); });
document.head.append(css);
await styled;

const root = document.createElement('main');
root.style.cssText = 'width:100%;max-width:520px;box-sizing:border-box;padding:12px;font:14px sans-serif';
document.body.append(root);

const source = {
  data: {
    chats: [{ id: 'chat-ash', name: '阿澈', unread: 7, blocked: false }],
    messages: {
      'chat-ash': [
        { from: 'me', content: '你今天回来吗', time: '18:20', date: '周三', type: 'text' },
        { from: '阿澈', content: '回，七点前', time: '18:22', date: '周三', type: 'text' },
        { from: '阿澈', type: 'image', time: '18:23', date: '周三' },
        { from: 'system', content: '对方撤回一条消息', time: '18:24', date: '周三', type: 'system' }
      ]
    }
  },
  getUserInfo: () => ({ name: '林晚', avatar: 'avatar://me' }),
  getMessages: () => { throw new Error('X9 browser must use the in-memory source'); }
};

const app = {
  projection: () => ({
    face: { reason: 'empty', text: '还没有被追踪的角色' },
    proj: { roles: [], count: 0 },
    src: null
  }),
  archiveFace: () => ({
    faces: { backpack: [], dossiers: [{ name: '阿澈', identity: '重要角色', formattedAttitudeText: '可接触', experienceBrief: '已登记', recentInteractions: '暂无' }], volumes: [] },
    counts: { volumeStats: null }, notes: {}
  }),
  _archiveRestoreAll: () => {},
  getSettings: () => ({ injectToPrompt: true, maxInject: 5 }),
  saveSettings: () => {},
  perspectiveModeIds: () => ['author', 'character'],
  perspectiveFaceIds: () => ['surface', 'revealed', 'all'],
  perspectiveMode: () => ({ ok: true, mode: 'author', text: '' }),
  perspectiveFace: () => 'surface',
  perspectiveCurrent: () => '',
  perspectiveLayout: () => ({ layout: 'paged', text: '窄屏' }),
  archiveGetDossier: (name) => name === '阿澈' ? { name, identity: '重要角色' } : null,
  borrowOtherSidePhone: CharsApp.prototype.borrowOtherSidePhone
};

const before = JSON.stringify(source.data);
/* 与真实宿主一致：视图只从 VirtualPhone.cachedWechatData 取微信数据源。 */
window.VirtualPhone = { cachedWechatData: source };
new CharsView(app).render(root);
const input = root.querySelector('#cs-os-name');
const open = root.querySelector('#cs-os-open');
report({ name: 'x9-entry-present', ok: !!input && !!open && open.textContent.includes('借手机看看'), detail: '角色详情/档案面出现显式借看入口' });
open.click();
report({ name: 'x9-explicit-confirmation', ok: root.querySelector('#cs-os-note')?.textContent.includes('先填角色名'), detail: '未指定角色时不打开投影' });
input.value = '阿澈';
open.click();
const panel = root.querySelector('#cs-os-view');
const bubbleTexts = [...panel.querySelectorAll('.cs-os-bubble')].map((x) => x.textContent.trim());
report({ name: 'x9-no-escaped-newlines', ok: !panel.textContent.includes('\\n'), detail: 'HTML 拼接不泄漏字面换行转义' });
report({ name: 'x9-styles-applied', ok: getComputedStyle(panel.querySelector('.cs-os-chat')).display === 'flex', detail: '真实群像 CSS 已加载且布局生效' });
report({ name: 'x9-ready-panel', ok: panel.textContent.includes('借看：他的手机') && panel.textContent.includes('林晚'), detail: 'ready 状态显示本人身份与只读投影' });
report({ name: 'x9-reversed-bubbles', ok: panel.querySelector('.cs-os-left')?.textContent.includes('你今天回来吗') && panel.querySelector('.cs-os-right')?.textContent.includes('回，七点前'), detail: '左为你、右为他，按对方视角反转' });
report({ name: 'x9-absent-remark', ok: panel.textContent.includes('他给你起的备注：—') && panel.textContent.includes('无真源'), detail: '不拿 contact.remark 冒充反向备注' });
report({ name: 'x9-withheld-readings', ok: panel.textContent.includes('未读数') && panel.textContent.includes('拉黑标记') && panel.textContent.includes('他与别人的会话'), detail: '方向不成立与无真源读数逐条列出' });
report({ name: 'x9-panel-readonly', ok: panel.querySelectorAll('button,input,select,textarea').length === 0, detail: '投影面内部没有任何操作控件' });
report({ name: 'x9-source-unchanged', ok: JSON.stringify(source.data) === before && otherSideSelfCheck().ok, detail: '打开与退出前后数据快照一致' });
open.scrollIntoView({ block: 'center' });
const rect = open.getBoundingClientRect();
report({ name: 'x9-entry-hit-test', ok: rect.width > 0 && rect.height > 0 && open.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)), detail: '入口可见可点击' });
report({ name: 'x9-narrow-no-overflow', ok: root.scrollWidth <= root.clientWidth + 1, detail: `scroll=${root.scrollWidth},client=${root.clientWidth}` });