import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { projectOtherSide, otherSideSelfCheck, OTHER_SIDE_STATES, OTHER_SIDE_ORIGINS } from '../config/other-side-view.js';
import { CharsApp } from '../apps/chars/chars-app.js';
import { withAuditCopyAsync } from './lib/audit-copy.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const KERNEL = path.join(ROOT, 'config/other-side-view.js');
const VIEW = path.join(ROOT, 'apps/chars/chars-view.js');
const APP = path.join(ROOT, 'apps/chars/chars-app.js');

function sourceFixture() {
    return {
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
        getMessages: () => { throw new Error('should prefer in-memory message source'); }
    };
}

function projectFixture() {
    const source = sourceFixture();
    return { source, out: projectOtherSide({ source, contactName: '阿澈', chatId: 'chat-ash' }) };
}

test('X9-A: three page states and four origin categories are complete', () => {
    assert.deepEqual(Object.values(OTHER_SIDE_STATES).sort(), ['no-contact', 'no-source', 'ready']);
    assert.deepEqual(Object.values(OTHER_SIDE_ORIGINS).sort(), ['absent', 'not-other-side', 'other-side', 'self-identity']);
    assert.equal(otherSideSelfCheck().ok, true);
    assert.equal(projectOtherSide({ contactName: '' }).state, 'no-contact');
    assert.equal(projectOtherSide({ contactName: '阿澈', source: null }).state, 'no-source');
    assert.equal(projectFixture().out.state, 'ready');
});

test('X9-B: other-side bubble direction is reversed, system bubbles stay unplaced', () => {
    const { out } = projectFixture();
    assert.deepEqual(out.bubbles.map((b) => b.side), ['left', 'right', 'right', '']);
    assert.deepEqual(out.bubbles.map((b) => b.text), ['你今天回来吗', '回，七点前', '[图片]', '对方撤回一条消息']);
    assert.equal(out.bubbles[0].unplaced, false);
    assert.equal(out.bubbles[3].unplaced, true);
    assert.equal(out.selfName, '林晚');
    assert.equal(out.selfAvatar, 'avatar://me');
});

test('X9-C: remark is permanently absent and direction-invalid readings stay withheld', () => {
    const { out } = projectFixture();
    assert.deepEqual(out.theirRemarkOfYou, {
        origin: 'absent', value: null, reason: 'remark-has-no-source',
        reasonText: '他给你起的备注名，任何数据源都没有记录——造了就是假的。'
    });
    assert.deepEqual(out.withheld.map((x) => [x.field, x.origin]), [
        ['unread', 'not-other-side'],
        ['blocked', 'not-other-side'],
        ['otherConversations', 'absent']
    ]);
});

test('X9-D: kernel has no write surface after comments are removed', () => {
    const kernel = fs.readFileSync(KERNEL, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(kernel, /setItem|removeItem|save[A-Z_a-z]|\.push\s*\(/);
    const view = fs.readFileSync(VIEW, 'utf8');
    const x9Handler = view.slice(view.lastIndexOf('/* [v4.118.0 · R13-X9]'))
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(x9Handler, /setItem|save[A-Z_a-z]|\.push\s*\(/);
});

test('X9-E: projection and app bridge do not mutate source or caller inputs', () => {
    const { source } = projectFixture();
    const before = JSON.stringify(source.data);
    const args = { source, contactName: '阿澈', chatId: 'chat-ash', messageLimit: 3 };
    const argsBefore = JSON.stringify({ contactName: args.contactName, chatId: args.chatId, messageLimit: args.messageLimit });
    const out = projectOtherSide(args);
    assert.equal(out.conversation.length, 3);
    assert.equal(JSON.stringify(source.data), before);
    assert.equal(JSON.stringify({ contactName: args.contactName, chatId: args.chatId, messageLimit: args.messageLimit }), argsBefore);

    const bridge = Object.create(CharsApp.prototype);
    const bridged = bridge.borrowOtherSidePhone('阿澈', source);
    assert.equal(bridged.state, 'ready');
    assert.equal(bridged.chatId, 'chat-ash');
    assert.equal(JSON.stringify(source.data), before);
});

test('X9-F: true-source mutation changes the same production criterion', async () => {
    const { out: original } = projectFixture();
    const criterion = out => assert.equal(out.conversation[0].text, '你今天回来吗');
    criterion(original);
    await withAuditCopyAsync(ROOT, async (copy) => {
        const mutantPath = path.join(copy, 'config/other-side-view.js');
        const old = fs.readFileSync(mutantPath, 'utf8');
        const needle = "m.content !== undefined && m.content !== null ? m.content : (m.text || '')";
        assert.equal(old.split(needle).length - 1, 1, 'mutation anchor must hit exactly once');
        fs.writeFileSync(mutantPath, old.replace(needle, "false ? m.content : (m.text || '')"));
        const mutant = await import(`${mutantPath}?mutant=${Date.now()}`);
        const source = sourceFixture();
        const changed = mutant.projectOtherSide({ source, contactName: '阿澈', chatId: 'chat-ash' });
        assert.throws(() => criterion(changed), { name: 'AssertionError' });
    });
});

test('X9-G: app-internal entry is present and only opens after explicit name confirmation', () => {
    const app = fs.readFileSync(APP, 'utf8');
    const view = fs.readFileSync(VIEW, 'utf8');
    assert.match(app, /borrowOtherSidePhone\s*\(/);
    assert.match(app, /projectOtherSide\s*\(/);
    assert.match(view, /id="cs-os-open"/);
    assert.match(view, /借手机看看/);
    assert.match(view, /archiveGetDossier\(name\)/);
    assert.match(view, /otherSideSelfCheck\(\)/);
    assert.match(view, /cachedWechatData/);
    assert.match(view, /id="cs-os-view"/);
});


test('X9-H: async audit copy survives await and cleans up on resolve and reject', async () => {
    const os = await import('node:os');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-async-copy-test-'));
    let copy;
    try {
        fs.writeFileSync(path.join(root, 'sample.mjs'), 'export const value = 7;');
        for (const fail of [false, true]) {
            const run = withAuditCopyAsync(root, async dir => {
                copy = dir;
                await new Promise(resolve => setTimeout(resolve, 20));
                assert.equal(fs.existsSync(copy), true);
                const mod = await import(path.join(copy, 'sample.mjs'));
                assert.equal(mod.value, 7);
                if (fail) throw Error('async cleanup probe');
                return mod.value;
            });
            if (fail) await assert.rejects(run, /async cleanup probe/);
            else assert.equal(await run, 7);
            assert.equal(fs.existsSync(copy), false);
        }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
