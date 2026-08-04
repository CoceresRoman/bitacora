import { RawSignal } from '../core/signal.entity';
import { StyleViolation } from './style.guard';

export interface PromptInput {
  signal: RawSignal;
  voiceProfile: string;
  previousBody?: string;
  feedback?: string;
  violations?: StyleViolation[];
}

export function buildPrompt(input: PromptInput): string {
  const { signal, voiceProfile, previousBody, feedback, violations } = input;

  const sections: string[] = [
    'Escribí un post de LinkedIn en español a partir de un hecho técnico real.',
    voiceProfile,
    `## Hecho de origen (${signal.source}/${signal.kind})\n${signal.payload}`,
    signal.refs.length > 0 ? `## Referencias\n${signal.refs.join('\n')}` : '',
    [
      '## Reglas duras',
      '- Entre 400 y 2600 caracteres.',
      '- Máximo 3 hashtags. Máximo 1 emoji cada 100 palabras.',
      '- Prohibido abrir con frases de plantilla o cerrar con preguntas de engagement.',
      '- El post tiene que anclar en el hecho concreto: nombrá el archivo, el servicio,',
      '  el error o el número real. Nada de generalidades.',
      '- Devolvé solo el texto del post. Sin título, sin comillas, sin comentarios tuyos.',
    ].join('\n'),
  ];

  if (previousBody) {
    sections.push(`## Versión anterior\n${previousBody}`);
  }
  if (feedback) {
    sections.push(`## Qué cambiar\n${feedback}`);
  }
  if (violations && violations.length > 0) {
    sections.push(
      `## Reglas que violó la versión anterior\n${violations
        .map((violation) => `- ${violation.rule}: ${violation.detail}`)
        .join('\n')}`,
    );
  }

  return sections.filter((section) => section !== '').join('\n\n');
}
