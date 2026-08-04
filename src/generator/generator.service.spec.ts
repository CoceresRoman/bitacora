import { GeneratorService } from './generator.service';
import { LlmPort } from '../core/ports/llm.port';
import { DraftRepository } from '../persistence/draft.repository';
import { Draft } from '../core/draft.entity';
import { RawSignal } from '../core/signal.entity';

const signal: RawSignal = {
  id: 's1',
  source: 'git',
  kind: 'commit',
  payload: 'feat: retry con backoff exponencial',
  refs: ['bitacora@abc123'],
  capturedAt: new Date('2026-08-04T10:00:00Z'),
  hash: 'h',
};

const VALID_BODY = `Rompí la cola de publicación en bitacora@abc123 con un retry naíf de 1 segundo fijo.

Con LinkedIn devolviendo 429, tres reintentos seguidos son tres 429 más. Cambié a backoff exponencial de 1, 5 y 25 minutos, y guardo el contador de intentos en la fila del draft en vez de en memoria, así un reinicio no reinicia la cuenta.

Tres intentos y avisa. Después decide un humano. La automatización tiene un techo y prefiero dejarlo ahí en vez de reintentar para siempre.`;

function fakeRepo() {
  const drafts = new Map<string, Draft>();
  let counter = 0;
  return {
    drafts,
    repo: {
      create: async (input: { signalId: string; topic: string; bodyEs: string }) => {
        const draft: Draft = {
          id: `d${++counter}`,
          signalId: input.signalId,
          topic: input.topic,
          bodyEs: input.bodyEs,
          status: 'DRAFTING',
          revisions: [],
          scheduledAt: null,
          publishedUrn: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        drafts.set(draft.id, draft);
        return draft;
      },
      save: async (draft: Draft) => {
        drafts.set(draft.id, draft);
        return draft;
      },
    } as unknown as DraftRepository,
  };
}

describe('GeneratorService.generateFor', () => {
  it('persists a PENDING_REVIEW draft when the first generation passes the guard', async () => {
    const llm: LlmPort = { generate: async () => VALID_BODY };
    const { repo } = fakeRepo();
    const draft = await new GeneratorService(llm, repo, 'perfil').generateFor(signal);

    expect(draft.status).toBe('PENDING_REVIEW');
    expect(draft.bodyEs).toBe(VALID_BODY);
    expect(draft.signalId).toBe('s1');
  });

  it('retries once when the guard fails and keeps the second result', async () => {
    const outputs = ['#a #b #c #d #e corto', VALID_BODY];
    let calls = 0;
    const llm: LlmPort = { generate: async () => outputs[calls++] };
    const { repo } = fakeRepo();

    const draft = await new GeneratorService(llm, repo, 'perfil').generateFor(signal);

    expect(calls).toBe(2);
    expect(draft.bodyEs).toBe(VALID_BODY);
    expect(draft.status).toBe('PENDING_REVIEW');
  });

  it('keeps the second result and reports violations when the retry also fails', async () => {
    const bad = '#a #b #c #d #e corto';
    const llm: LlmPort = { generate: async () => bad };
    const { repo } = fakeRepo();

    const service = new GeneratorService(llm, repo, 'perfil');
    const draft = await service.generateFor(signal);

    expect(draft.status).toBe('PENDING_REVIEW');
    expect(service.lastViolations.map((v) => v.rule)).toContain('hashtag-count');
  });

  it('derives the topic from the signal payload', async () => {
    const llm: LlmPort = { generate: async () => VALID_BODY };
    const { repo } = fakeRepo();
    const draft = await new GeneratorService(llm, repo, 'perfil').generateFor(signal);
    expect(draft.topic).toBe('feat: retry con backoff exponencial');
  });

  it('regenerate feeds the feedback and the previous body back to the model', async () => {
    const prompts: string[] = [];
    const llm: LlmPort = {
      generate: async (prompt) => {
        prompts.push(prompt);
        return VALID_BODY;
      },
    };
    const { repo } = fakeRepo();
    const service = new GeneratorService(llm, repo, 'perfil');
    const draft = await service.generateFor(signal);

    await service.regenerate({ ...draft, status: 'REVISING' }, 'mas corto');

    expect(prompts[1]).toContain('mas corto');
    expect(prompts[1]).toContain(VALID_BODY);
  });
});
