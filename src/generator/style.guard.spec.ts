import { checkStyle } from './style.guard';

const REFS = ['bitacora@abc123'];
const GOOD = `Ayer rompí la cola de publicación de bitacora@abc123 con un retry naíf.

El bug: reintentaba con delay fijo de 1 segundo. Con LinkedIn devolviendo 429, tres reintentos en tres segundos son tres 429 más. El backoff exponencial no es decoración: 1m, 5m, 25m le da tiempo real a la ventana de rate limit a cerrarse.

Lo que cambié: guardo publishAttempts en la fila del draft, no en memoria. Si el proceso muere entre reintentos, al arrancar sabe en qué intento iba. La cola en memoria era cómoda hasta el primer reinicio.

Tres intentos y avisa. Después decide un humano, no el retry.`;

describe('checkStyle', () => {
  it('accepts a substantive post with a reference', () => {
    expect(checkStyle(GOOD, REFS)).toEqual([]);
  });

  it('rejects a banned template opening', () => {
    const body = GOOD.replace('Ayer rompí', 'En el mundo del desarrollo, ayer rompí');
    expect(checkStyle(body, REFS).map((v) => v.rule)).toContain('template-opening');
  });

  it('rejects more than three hashtags', () => {
    const body = `${GOOD}\n\n#node #nestjs #backend #devops`;
    expect(checkStyle(body, REFS).map((v) => v.rule)).toContain('hashtag-count');
  });

  it('rejects emoji spam', () => {
    const body = `🚀 ✨ 🔥 💡 ⚡ 🎯 ${GOOD}`;
    expect(checkStyle(body, REFS).map((v) => v.rule)).toContain('emoji-density');
  });

  it('rejects engagement bait regardless of accents or case', () => {
    expect(checkStyle(`${GOOD}\n\n¿Qué opinas? 👇`, REFS).map((v) => v.rule)).toContain(
      'engagement-bait',
    );
    expect(checkStyle(`${GOOD}\n\nCOMENTA ABAJO`, REFS).map((v) => v.rule)).toContain(
      'engagement-bait',
    );
  });

  it('rejects a post with no concrete anchor', () => {
    const vague =
      'La arquitectura limpia es importante para cualquier equipo. '.repeat(10);
    expect(checkStyle(vague, REFS).map((v) => v.rule)).toContain('missing-reference');
  });

  it('rejects a post that is too short or too long', () => {
    expect(checkStyle('Corto.', REFS).map((v) => v.rule)).toContain('length');
    expect(checkStyle(GOOD.repeat(5), REFS).map((v) => v.rule)).toContain('length');
  });

  it('reports every violated rule at once', () => {
    const bad = 'En el mundo del desarrollo... #a #b #c #d ¿Qué opinás?';
    const rules = checkStyle(bad, REFS).map((v) => v.rule);
    expect(rules).toEqual(
      expect.arrayContaining(['template-opening', 'hashtag-count', 'engagement-bait', 'length']),
    );
  });
});
