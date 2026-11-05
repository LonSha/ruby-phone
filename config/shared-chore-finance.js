import { sharedChore, choreSplit } from './shared-chore.js';
/** Explicit local confirmation only; never claims a participant received money. */
export function choreFinanceDraft(raw) {
    const chore = sharedChore(raw);
    if (!chore || chore.state === 'cancelled' || chore.cents <= 0) return null;
    const split = choreSplit(chore);
    return { source: 'accounting', draftId: 'shared-chore:' + chore.id, dayKey: '', kind: 'suggestion', currency: 'CNY',
        amountCents: chore.cents, participants: chore.members, lines: split.rows.map(row => ({ from: row.member, to: '共同事项费用草案', amount: row.cents / 100, currency: 'CNY' })),
        note: '共同事项费用分摊的本机确认；不代表付款或对方收款' };
}