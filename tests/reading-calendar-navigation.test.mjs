import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadingView } from '../apps/reading/reading-view.js';
import { CalendarData } from '../apps/calendar/calendar-data.js';

function reader(storage = new Map()) {
    const events = new Map();
    const screen = {
        querySelector: selector => ({ addEventListener: (type, fn) => events.set(selector + ':' + type, fn) }),
        querySelectorAll: () => [],
    };
    const view = new ReadingView({ storage, phoneShell: { screen } });
    view.currentBook = { id: 'a', chapters: [{}, {}, {}] };
    view.render = () => {};
    view._bind();
    return { view, events, storage };
}

test('chapter controls save the destination before leaving the reader', () => {
    const { view, events, storage } = reader();
    for (const [action, value, expected] of [['#rd-next:click', '', 1], ['#rd-prev:click', '', 0], ['#rd-chapters:change', '2', 2]]) {
        view.anchorPara = 30;
        events.get(action)({ target: { value } });
        const saved = JSON.parse(storage.get('ruby_reading_progress_a'));
        assert.equal(saved.chapter, expected);
        assert.equal(saved.para, undefined);
        const reopened = reader(storage).view;
        reopened._loadProgress('a');
        assert.equal(reopened.curChapter, expected);
        assert.equal(reopened.anchorPara, null);
    }
});

test('a book with no readable progress never inherits another book position', () => {
    const { view, storage } = reader();
    for (const raw of [undefined, '{']) {
        if (raw !== undefined) storage.set('ruby_reading_progress_b', raw);
        view.curChapter = 2;
        view.anchorPara = 9;
        view.currentBook = { id: 'b', chapters: [{}] };
        view._loadProgress('b');
        assert.deepEqual([view.curChapter, view.anchorPara], [0, null]);
    }
});

test('invalid holiday edits do not change the calendar; zero-padded leap day is valid', () => {
    const storage = new Map();
    const data = new CalendarData(storage);
    const added = data.addHoliday({ title: 'Leap', month: '02', day: '29' });
    assert.deepEqual([added.month, added.day], [2, 29]);
    const before = storage.get(data.holidayKey);
    for (const [month, day] of [['2x', '28'], ['2', '2x'], [2, 1.5], ['04', '31']]) {
        assert.equal(data.addHoliday({ title: 'Bad', month, day }), null);
        assert.equal(data.updateHoliday(added.id, { title: 'Changed', month, day }), false);
        assert.equal(storage.get(data.holidayKey), before);
    }
});
