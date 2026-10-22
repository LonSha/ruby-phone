// Planning observations only: existing features must not be proposed as new.
import assert from 'node:assert/strict';
import { composeDrafts } from '../../config/creation-multi-draft.js';
import { PLAY_STEPS } from '../../config/date-playbook.js';
import { normalizeTopicBook, buildTopicPage } from '../../config/topic-echo.js';
const drafts = composeDrafts('lofter', 'article-1', ['weibo', 'magazine'], { note: '一次共同出行', per: { weibo: { note: '短文' }, magazine: { note: '长文' } } });
assert.equal(drafts.ok, true);
assert.equal(drafts.drafts.length, 2);
assert.notEqual(drafts.drafts[0].note, drafts.drafts[1].note);
assert.deepEqual(PLAY_STEPS, ['prepare', 'depart', 'arrive', 'interact', 'wrapUp']);
const book = normalizeTopicBook([
  { id: 'a', rootEventId: 'trip1', platform: 'weibo', kind: 'publish', text: '展览开幕', confirmed: true, time: 1 },
  { id: 'b', rootEventId: 'trip1', platform: 'xhs', kind: 'repost', text: '转述', confirmed: true, origin: 'weibo:a', time: 2 },
]);
assert.equal(book.ok, true);
const page = buildTopicPage(book.entries, 'trip1');
assert.equal(page.found, true);
assert.deepEqual(page.platforms, ['weibo', 'xhs']);
console.log(JSON.stringify({ kind: 'bounded-module-observation', cases: 3, observed: { multiTargetDrafts: drafts.drafts.length, distinctTargetText: true, activitySteps: PLAY_STEPS, topicPlatforms: page.platforms }, boundary: 'Production pure modules on synthetic inputs; not host clicks, model quality, or new-plan implementation.' }, null, 2));