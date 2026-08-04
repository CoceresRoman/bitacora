import { buildPrompt } from './prompt.builder';
import { RawSignal } from '../core/signal.entity';

const signal: RawSignal = {
  id: 's1',
  source: 'git',
  kind: 'commit',
  payload: 'feat: retry con backoff exponencial en la cola de publicación',
  refs: ['bitacora@abc123'],
  capturedAt: new Date('2026-08-04T10:00:00Z'),
  hash: 'h',
};

const VOICE = '# Perfil de voz\nPrimera persona.';

describe('buildPrompt', () => {
  it('includes the voice profile, the payload and the refs', () => {
    const prompt = buildPrompt({ signal, voiceProfile: VOICE });
    expect(prompt).toContain(VOICE);
    expect(prompt).toContain(signal.payload);
    expect(prompt).toContain('bitacora@abc123');
  });

  it('demands Spanish output and forbids surrounding commentary', () => {
    const prompt = buildPrompt({ signal, voiceProfile: VOICE });
    expect(prompt.toLowerCase()).toContain('español');
    expect(prompt.toLowerCase()).toContain('solo el texto del post');
  });

  it('includes prior body and feedback on a revision', () => {
    const prompt = buildPrompt({
      signal,
      voiceProfile: VOICE,
      previousBody: 'version anterior',
      feedback: 'hacelo mas corto',
    });
    expect(prompt).toContain('version anterior');
    expect(prompt).toContain('hacelo mas corto');
  });

  it('lists style violations when retrying after a guard failure', () => {
    const prompt = buildPrompt({
      signal,
      voiceProfile: VOICE,
      previousBody: 'x',
      violations: [{ rule: 'hashtag-count', detail: '6 hashtags' }],
    });
    expect(prompt).toContain('hashtag-count');
    expect(prompt).toContain('6 hashtags');
  });
});
