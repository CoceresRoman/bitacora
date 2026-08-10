import { POLL_RETRY_DELAY_MS, TelegramAdapter } from './telegram.adapter';
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
      return true;
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
  it('throws when Telegram does not confirm delivery of the review request', async () => {
    const client = {
      sendMessage: async () => false,
      answerCallbackQuery: async () => undefined,
      getUpdates: async () => [],
    } as unknown as TelegramClient;
    const inbox = { capture: async () => undefined } as unknown as InboxSource;
    const unreachableAdapter = new TelegramAdapter(client, inbox, {
      botToken: 't',
      allowedChatId: ALLOWED,
    });

    await expect(unreachableAdapter.sendForReview(draft)).rejects.toThrow(/draft/i);
  });

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

  it('clears a stale pending revision when a different draft is approved', async () => {
    const t = adapter();
    const decisions: Array<[string, Decision]> = [];
    t.adapter.onDecision(async (id, decision) => {
      decisions.push([id, decision]);
    });

    await t.adapter.handleUpdate(callbackUpdate(ALLOWED, 'rev:d1'), NOW);
    await t.adapter.handleUpdate(callbackUpdate(ALLOWED, 'ok:d2'), NOW);
    await t.adapter.handleUpdate(textUpdate(ALLOWED, 'nueva idea suelta'), NOW);

    expect(decisions).toEqual([['d2', { kind: 'approve' }]]);
    expect(t.captured).toEqual(['nueva idea suelta']);
  });

  it('replaces the pending revision when rev is tapped again for a different draft', async () => {
    const t = adapter();
    const decisions: Array<[string, Decision]> = [];
    t.adapter.onDecision(async (id, decision) => {
      decisions.push([id, decision]);
    });

    await t.adapter.handleUpdate(callbackUpdate(ALLOWED, 'rev:d1'), NOW);
    await t.adapter.handleUpdate(callbackUpdate(ALLOWED, 'rev:d2'), NOW);
    await t.adapter.handleUpdate(textUpdate(ALLOWED, 'mas corto para d2'), NOW);

    expect(decisions).toEqual([['d2', { kind: 'revise', feedback: 'mas corto para d2' }]]);
    expect(t.captured).toEqual([]);
  });

  it('ignores malformed callback data with no draft id', async () => {
    const t = adapter();
    const decisions: Array<[string, Decision]> = [];
    t.adapter.onDecision(async (id, decision) => {
      decisions.push([id, decision]);
    });

    await t.adapter.handleUpdate(callbackUpdate(ALLOWED, 'ok'), NOW);
    await t.adapter.handleUpdate(callbackUpdate(ALLOWED, 'ok:'), NOW);

    expect(decisions).toEqual([]);
    expect(t.answered).toEqual([]);
  });
});

describe('TelegramAdapter unsupported update shapes', () => {
  it('drops an edited_message update with no reply', async () => {
    const t = adapter();
    const decisions: Array<[string, Decision]> = [];
    t.adapter.onDecision(async (id, decision) => {
      decisions.push([id, decision]);
    });

    const update: TelegramUpdate = {
      update_id: 10,
      edited_message: { chat: { id: Number(ALLOWED) }, text: 'edited idea' },
    };
    await t.adapter.handleUpdate(update, NOW);

    expect(decisions).toEqual([]);
    expect(t.captured).toEqual([]);
    expect(t.sent).toEqual([]);
  });

  it('drops a channel_post update with no reply', async () => {
    const t = adapter();
    const decisions: Array<[string, Decision]> = [];
    t.adapter.onDecision(async (id, decision) => {
      decisions.push([id, decision]);
    });

    const update: TelegramUpdate = {
      update_id: 11,
      channel_post: { chat: { id: Number(ALLOWED) }, text: 'posted to channel' },
    };
    await t.adapter.handleUpdate(update, NOW);

    expect(decisions).toEqual([]);
    expect(t.captured).toEqual([]);
    expect(t.sent).toEqual([]);
  });

  it('drops a callback_query with no message with no reply', async () => {
    const t = adapter();
    const decisions: Array<[string, Decision]> = [];
    t.adapter.onDecision(async (id, decision) => {
      decisions.push([id, decision]);
    });

    const update: TelegramUpdate = {
      update_id: 12,
      callback_query: { id: 'cb2', data: 'ok:d1' },
    };
    await t.adapter.handleUpdate(update, NOW);

    expect(decisions).toEqual([]);
    expect(t.answered).toEqual([]);
    expect(t.sent).toEqual([]);
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('TelegramAdapter poll loop', () => {
  it('processes a queued update, then aborts the in-flight poll and stops on destroy', async () => {
    const resolvers: Array<(updates: TelegramUpdate[]) => void> = [];
    const signals: Array<AbortSignal | undefined> = [];
    const sent: Array<{ chatId: string; text: string }> = [];
    const captured: string[] = [];

    const client = {
      sendMessage: async (chatId: string, text: string) => {
        sent.push({ chatId, text });
        return true;
      },
      answerCallbackQuery: async () => undefined,
      getUpdates: (_offset: number, _timeoutSec: number, signal?: AbortSignal) => {
        signals.push(signal);
        return new Promise<TelegramUpdate[]>((resolve) => {
          resolvers.push(resolve);
        });
      },
    } as unknown as TelegramClient;
    const inbox = {
      capture: async (text: string) => {
        captured.push(text);
      },
    } as unknown as InboxSource;

    const pollAdapter = new TelegramAdapter(client, inbox, {
      botToken: 't',
      allowedChatId: ALLOWED,
    });

    pollAdapter.onModuleInit();
    await flush();
    expect(resolvers).toHaveLength(1);

    resolvers[0]([textUpdate(ALLOWED, 'idea del poll')]);
    await flush();
    await flush();
    expect(captured).toEqual(['idea del poll']);
    expect(sent[0]?.text).toMatch(/guardad[ao]/i);
    expect(resolvers).toHaveLength(2);

    pollAdapter.onModuleDestroy();
    expect(signals[1]?.aborted).toBe(true);

    // Resolve the aborted call the way a real fetch abort would: with no
    // updates. The loop must observe `polling === false` and exit instead
    // of issuing a third getUpdates call.
    resolvers[1]([]);
    await flush();
    await flush();

    const resolverCountAfterDestroy = resolvers.length;
    await flush();
    expect(resolvers).toHaveLength(resolverCountAfterDestroy);
  });
});

describe('TelegramAdapter poll loop backoff', () => {
  beforeEach(() => {
    // setImmediate/nextTick stay real so the existing flush() helper keeps
    // draining microtasks; only setTimeout (used by the retry delay) is
    // under fake-timer control so the test does not actually wait out the
    // delay in real time.
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function pollingClient() {
    const resolvers: Array<(updates: TelegramUpdate[]) => void> = [];
    const client = {
      sendMessage: async () => undefined,
      answerCallbackQuery: async () => undefined,
      getUpdates: () =>
        new Promise<TelegramUpdate[]>((resolve) => {
          resolvers.push(resolve);
        }),
    } as unknown as TelegramClient;
    const inbox = { capture: async () => undefined } as unknown as InboxSource;
    return { resolvers, adapter: new TelegramAdapter(client, inbox, { botToken: 't', allowedChatId: ALLOWED }) };
  }

  it('does not immediately re-poll after Telegram is unreachable (empty result with no delay)', async () => {
    const { resolvers, adapter: pollAdapter } = pollingClient();

    pollAdapter.onModuleInit();
    await flush();
    expect(resolvers).toHaveLength(1);

    // TelegramClient.call() swallows network errors into `null`, and
    // getUpdates() maps that to `[]` — this is indistinguishable at this
    // layer from a legitimate empty long poll. Either way the loop must not
    // call getUpdates again until the backoff delay elapses.
    resolvers[0]([]);
    await flush();
    await flush();
    expect(resolvers).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(POLL_RETRY_DELAY_MS);
    await flush();
    expect(resolvers).toHaveLength(2);

    pollAdapter.onModuleDestroy();
  });

  it('shuts down promptly during the backoff delay instead of waiting it out', async () => {
    const { resolvers, adapter: pollAdapter } = pollingClient();

    pollAdapter.onModuleInit();
    await flush();
    resolvers[0]([]);
    await flush();
    await flush();
    expect(resolvers).toHaveLength(1);

    pollAdapter.onModuleDestroy();
    await flush();
    await flush();

    // Advancing all the way past the delay must not trigger a further poll:
    // the destroy should have interrupted the wait rather than letting it
    // run out.
    await jest.advanceTimersByTimeAsync(POLL_RETRY_DELAY_MS);
    await flush();
    expect(resolvers).toHaveLength(1);
  });
});
