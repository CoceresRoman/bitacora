export interface StyleViolation {
  rule: string;
  detail: string;
}

const BANNED_OPENINGS = [
  'en el mundo del',
  'en el mundo de la',
  'emocionado de',
  'feliz de anunciar',
  'hoy quiero compartir',
];

const ENGAGEMENT_BAIT = ['que opinas', 'dejame saber', 'comenta abajo'];

const MAX_HASHTAGS = 3;
const MAX_EMOJI_PER_100_WORDS = 1;
const MIN_LENGTH = 400;
const MAX_LENGTH = 2600;

const EMOJI = /\p{Extended_Pictographic}/gu;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

export function checkStyle(body: string, refs: string[]): StyleViolation[] {
  const violations: StyleViolation[] = [];
  const normalized = normalize(body);
  const trimmed = normalized.trimStart();

  const opening = BANNED_OPENINGS.find((phrase) => trimmed.startsWith(phrase));
  if (opening) {
    violations.push({ rule: 'template-opening', detail: `Empieza con "${opening}"` });
  }

  const hashtags = body.match(/#[\p{L}\d_]+/gu) ?? [];
  if (hashtags.length > MAX_HASHTAGS) {
    violations.push({ rule: 'hashtag-count', detail: `${hashtags.length} hashtags` });
  }

  const words = body.split(/\s+/).filter(Boolean).length;
  const emoji = body.match(EMOJI)?.length ?? 0;
  if (words > 0 && emoji > (words / 100) * MAX_EMOJI_PER_100_WORDS) {
    violations.push({ rule: 'emoji-density', detail: `${emoji} emoji en ${words} palabras` });
  }

  const bait = ENGAGEMENT_BAIT.find((phrase) => normalized.includes(phrase));
  if (bait) {
    violations.push({ rule: 'engagement-bait', detail: `Contiene "${bait}"` });
  }

  const hasRef = refs.some((ref) => body.includes(ref));
  const hasAnchor = /`[^`]+`/.test(body) || /\d/.test(body);
  if (!hasRef && !hasAnchor) {
    violations.push({ rule: 'missing-reference', detail: 'Sin referencia al hecho de origen' });
  }

  if (body.length < MIN_LENGTH || body.length > MAX_LENGTH) {
    violations.push({ rule: 'length', detail: `${body.length} caracteres` });
  }

  return violations;
}
