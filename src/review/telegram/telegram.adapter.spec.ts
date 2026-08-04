import { TelegramAdapter } from './telegram.adapter';
import { TelegramClient, TelegramUpdate } from './telegram.client';
import { InboxSource } from '../../sources/inbox/inbox.source';
import { Decision, Draft } from '../../core/draft.entity';

const ALLOWED = '111';
const NOW = new Date('2026-08-04T12:00:00Z');

const draft: Draft = {
  id: 'd1',
  signalId: 's1',
  topic: 'retry backoff',
  bodyEs: 'cuerpo del post',
  status: 'PENDING_REVIEW',
  revisions: [],
  scheduledAt: null,
  publishedUrn: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function fakes() {
  const sent: Array<{ chatId: string; text: string; keyboard?: unknown }> = [];
  const answered: string[] = [];
  const captured: string[] = [];
  const client = {
    sendMessage: async (chatId: string, text: string, keyboard?: unknown) => {
      sent.push({ chatId, text, keyboard });
    },
    answerCallbackQuery: async (id: string) => {
      answered.push(id);
    },
    getUpdates: async () => [],
  } as unknown as TelegramClient;
  const inbox = {
    capture: async (text: string) => {
      captured.push(text);
    },
  } as unknown as InboxSource;
  return { sent, answered, captured, client, inbox };
}

function adapter(f = fakes()) {
  return {
    ...f,
    adapter: new TelegramAdapter(f.client, f.inbox, {
      botToken: 't',
      allowedChatId: ALLOWED,
    }),
  };
}

function callbackUpdate(chatId: string, data: string): TelegramUpdate {
  return {
    update_id: 1,
    callback_query: {
      id: 'cb1',
      data,
      message: { chat: { id: Number(chatId) }, message_id: 9 },
    },
  };
}

function textUpdate(chatId: string, text: string): TelegramUpdate {
  return { update_id: 2, message: { chat: { id: Number(chatId) }, text } };
}

describe('TelegramAdapter security', () => {
  it('ignores a callback from a chat that is not the allowed one', async () => {
    const t = adapter();
    const decisions: Array<[string, Decision]> = [];
    t.adapter.onDecision(async (id, decision) => {
      decisions.push([id, decision]);
    });

    await t.adapter.handleUpdate(callbackUpdate('999', 'ok:d1'), NOW);

    expect(decisions).toEqual([]);
    expect(t.sent).toEqual([]);
    expect(t.answered).toEqual([]);
  });

  it('ignores a text message from a chat that is not the allowed one', async () => {
    const t = adapter();
    await t.adapter.handleUpdate(textUpdate('999', 'idea infiltrada'), NOW);
    expect(t.captured).toEqual([]);
    expect(t.sent).toEqual([]);
  });
});

describe('TelegramAdapter decisions', () => {
  it('sends the draft with four action buttons', async () => {
    const t = adapter();
    await t.adapter.sendForReview(draft);

    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].chatId).toBe(ALLOWED);
    expect(t.sent[0].text).toContain('cuerpo del post');
    const rows = (t.sent[0].keyboard as { inline_keyboard: Array<Array<{ callback_data: string }>> })
      .inline_keyboard;
    const actions = rows.flat().map((button) => button.callback_data);
    expect(actions).toEqual(['ok:d1', 'rev:d1', 'sched:d1', 'del:d1']);
  });

  it('maps ok to approve and del to discard', async () => {
    const t = adapter();
    const decisions: Array<[string, Decision]> = [];
    t.adapter.onDecision(async (id, decision) => {
      decisions.push([id, decision]);
    });

    await t.adapter.handleUpdate(callbackUpdate(ALLOWED, 'ok:d1'), NOW);
    await t.adapter.handleUpdate(callbackUpdate(ALLOWED, 'del:d2'), NOW);

    expect(decisions).toEqual([
      ['d1', { kind: 'approve' }],
      ['d2', { kind: 'discard' }],
    ]);
  });

  it('schedules for the next 09:00 when it is already past 09:00', async () => {
    const t = adapter();
    const decisions: Array<[string, Decision]> = [];
    t.adapter.onDecision(async (id, decision) => {
      decisions.push([id, decision]);
    });

    await t.adapter.handleUpdate(callbackUpdate(ALLOWED, 'sched:d1'), NOW);

    const decision = decisions[0][1] as { kind: 'schedule'; at: Date };
    expect(decision.kind).toBe('schedule');
    expect(decision.at.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('turns the message after rev into a revise decision', async () => {
    const t = adapter();
    const decisions: Array<[string, Decision]> = [];
    t.adapter.onDecision(async (id, decision) => {
      decisions.push([id, decision]);
    });

    await t.adapter.handleUpdate(callbackUpdate(ALLOWED, 'rev:d1'), NOW);
    await t.adapter.handleUpdate(textUpdate(ALLOWED, 'hacelo mas corto'), NOW);

    expect(decisions).toEqual([['d1', { kind: 'revise', feedback: 'hacelo mas corto' }]]);
    expect(t.captured).toEqual([]);
  });

  it('treats a plain message with no pending revision as an inbox idea', async () => {
    const t = adapter();
    await t.adapter.handleUpdate(textUpdate(ALLOWED, 'idea: contar el bug del backoff'), NOW);

    expect(t.captured).toEqual(['idea: contar el bug del backoff']);
    expect(t.sent[0].text).toMatch(/guardad[ao]/i);
  });

  it('clears the pending revision so the next message is an idea again', async () => {
    const t = adapter();
    t.adapter.onDecision(async () => undefined);

    await t.adapter.handleUpdate(callbackUpdate(ALLOWED, 'rev:d1'), NOW);
    await t.adapter.handleUpdate(textUpdate(ALLOWED, 'mas corto'), NOW);
    await t.adapter.handleUpdate(textUpdate(ALLOWED, 'otra idea suelta'), NOW);

    expect(t.captured).toEqual(['otra idea suelta']);
  });
});
