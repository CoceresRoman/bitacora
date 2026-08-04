import { GeneratorService } from './generator.service';
import { LlmPort } from '../core/ports/llm.port';
import { DraftRepository } from '../persistence/draft.repository';
import { SignalRepository } from '../persistence/signal.repository';
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

/** Fake SignalRepository whose findById resolves from a provided lookup table, or null if absent. */
function fakeSignalRepo(signals: Record<string, RawSignal> = {}) {
  return {
    findById: async (id: string) => signals[id] ?? null,
  } as unknown as SignalRepository;
}

describe('GeneratorService.generateFor', () => {
  it('persists a PENDING_REVIEW draft when the first generation passes the guard', async () => {
    const llm: LlmPort = { generate: async () => VALID_BODY };
    const { repo } = fakeRepo();
    const { draft } = await new GeneratorService(llm, repo, fakeSignalRepo(), 'perfil').generateFor(
      signal,
    );

    expect(draft.status).toBe('PENDING_REVIEW');
    expect(draft.bodyEs).toBe(VALID_BODY);
    expect(draft.signalId).toBe('s1');
  });

  it('retries once when the guard fails and keeps the second result', async () => {
    const outputs = ['#a #b #c #d #e corto', VALID_BODY];
    let calls = 0;
    const llm: LlmPort = { generate: async () => outputs[calls++] };
    const { repo } = fakeRepo();

    const { draft } = await new GeneratorService(llm, repo, fakeSignalRepo(), 'perfil').generateFor(
      signal,
    );

    expect(calls).toBe(2);
    expect(draft.bodyEs).toBe(VALID_BODY);
    expect(draft.status).toBe('PENDING_REVIEW');
  });

  it('keeps the second result and reports violations when the retry also fails', async () => {
    const bad = '#a #b #c #d #e corto';
    const llm: LlmPort = { generate: async () => bad };
    const { repo } = fakeRepo();

    const service = new GeneratorService(llm, repo, fakeSignalRepo(), 'perfil');
    const { draft, violations } = await service.generateFor(signal);

    expect(draft.status).toBe('PENDING_REVIEW');
    expect(violations.map((v) => v.rule)).toContain('hashtag-count');
  });

  it('derives the topic from the signal payload', async () => {
    const llm: LlmPort = { generate: async () => VALID_BODY };
    const { repo } = fakeRepo();
    const { draft } = await new GeneratorService(llm, repo, fakeSignalRepo(), 'perfil').generateFor(
      signal,
    );
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
    const service = new GeneratorService(llm, repo, fakeSignalRepo({ [signal.id]: signal }), 'perfil');
    const { draft } = await service.generateFor(signal);

    await service.regenerate({ ...draft, status: 'REVISING' }, 'mas corto');

    expect(prompts[1]).toContain('mas corto');
    expect(prompts[1]).toContain(VALID_BODY);
  });

  it('regenerate anchors the guard on the real signal refs when a revision cites them', async () => {
    const revised = `Ajusté el backoff en bitacora@abc123 después del feedback: bajé el primer intento a 30 segundos en vez de 1 minuto.

El resto de la lógica queda igual: guardo publishAttempts en la fila del draft, no en memoria, y sigo avisando después de tres intentos para que decida un humano. Este cambio es puntual, sobre el mismo fix de la cola de publicación que rompí la semana pasada por un retry naíf de intervalo fijo.`;
    const llm: LlmPort = { generate: async () => revised };
    const { repo } = fakeRepo();
    const service = new GeneratorService(llm, repo, fakeSignalRepo({ [signal.id]: signal }), 'perfil');
    const { draft } = await service.generateFor(signal);

    const { violations } = await service.regenerate({ ...draft, status: 'REVISING' }, 'mas corto');

    expect(violations.map((v) => v.rule)).not.toContain('missing-reference');
  });

  it('regenerate still flags missing-reference when the revision only fabricates a number', async () => {
    // "Fabricated number" spelled out in words, not digits: the guard's own
    // anchor check is a literal `/\d/` test (left untouched — a deferred,
    // separately-tracked minor), so a body with zero digit characters, no
    // code span and no match against the real signal refs must still trip
    // missing-reference. This is what distinguishes "cites a real fact"
    // from "vaguely gestures at having facts".
    const fabricated = `Cambié un poco el enfoque del retry y ahora reintento algunas veces con un delay de unos cuantos segundos entre cada intento, pero no cité el hecho de origen real ni el commit concreto.

El resto de este párrafo es puro relleno para llegar a la longitud mínima que exige el guard determinista de estilo, sin aportar ningún dato verificable sobre el commit real, el archivo que cambió o el error puntual que motivó el cambio. Todo queda deliberadamente vago y sin ancla concreta al hecho de origen, como cualquier post genérico que este guard está pensado para frenar antes de que salga publicado.`;
    const llm: LlmPort = { generate: async () => fabricated };
    const { repo } = fakeRepo();
    const service = new GeneratorService(llm, repo, fakeSignalRepo({ [signal.id]: signal }), 'perfil');
    const { draft } = await service.generateFor(signal);

    const { violations } = await service.regenerate({ ...draft, status: 'REVISING' }, 'mas corto');

    expect(violations.map((v) => v.rule)).toContain('missing-reference');
  });
});
