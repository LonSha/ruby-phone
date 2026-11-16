import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridges = [
 ['pin-top.js','pinTopSelfCheck'],['dnd-schedule.js','dndSelfCheck'],['contact-group.js','contactGroupSelfCheck'],
 ['call-transcript-segments.js','callSegSelfCheck'],['diary-search.js','diarySearchSelfCheck'],['wishlist.js','wishlistSelfCheck'],
 ['chat-bubble-theme.js','bubbleThemeSelfCheck'],['cross-app-clipboard.js','clipboardSelfCheck'],['reading-progress.js','readingProgressSelfCheck'],
 ['settings-filter.js','settingsFilterSelfCheck'],['a11y-audit.js','a11ySelfCheck'],['msg-search.js','msgSearchSelfCheck'],
 ['chat-virtual-window.js','chatVirtualWindowSelfCheck'],['story-clock-classify.js','clockClassifySelfCheck'],
 ['coverage-gap-report.js','coverageSelfCheck'],['event-debt-disposition.js','eventDebtSelfCheck'],['incoming-banner.js','bannerSelfCheck'],['unread-badge.js','unreadBadgeSelfCheck']
];
test('R22 all 18 pure kernels pass positive and negative self-checks', async()=>{
 for(const [file,check] of bridges){ const mod=await import(pathToFileURL(path.join(root,'config',file))); const r=mod[check](); assert.equal(r.ok,true,file+': '+JSON.stringify(r.bad)); }
});
test('R22 product consumers are wired beyond the index self-check registry',()=>{
 const reads=[
  ['apps/wechat/chat-view.js',['virtualWindow(','classifyClockSite(','bubbleTheme(']],
  ['apps/wechat/wechat-app.js',['searchMessages(','badgeOf(','_r22StageClipboard(']],
  ['apps/wechat/contacts-view.js',['_r22GroupContacts(']],['apps/reading/reading-view.js',['_r22ReadingProgress(']],
  ['apps/phone/phone-view.js',['_r22SegmentTranscript(']],['apps/diary/diary-view.js',['_r22DiarySearch(']],
  ['apps/settings/settings-app.js',['_r22FilterSettings(','_r22A11yAudit(']],['index.js',['r22BannerOf(','r22DndFace(']]
 ];
 for(const [file,needles] of reads){const src=fs.readFileSync(path.join(root,file),'utf8');for(const n of needles)assert.ok(src.includes(n),file+' missing '+n);}
});
test('R22 negative controls remain fail-closed and distinct',async()=>{
 const search=await import(pathToFileURL(path.join(root,'config/msg-search.js'))); assert.notEqual(search.searchMessages([], '').face,'results');
 const clock=await import(pathToFileURL(path.join(root,'config/story-clock-classify.js'))); assert.equal(clock.classifyClockSite({field:'timestamp',context:'message'}).cls,'story');
 const dnd=await import(pathToFileURL(path.join(root,'config/dnd-schedule.js'))); assert.equal(dnd.dndFace({enabled:true,hour:null,window:{start:23,end:7}}).face,'invalid');
});
