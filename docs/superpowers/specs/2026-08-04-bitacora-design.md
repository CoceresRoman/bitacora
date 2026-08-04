# bitacora — Design Spec

**Fecha:** 2026-08-04
**Autor:** Roman Coceres
**Estado:** Aprobado (diseño), pendiente de plan de implementación

---

## 1. Problema y objetivo

Roman produce trabajo técnico real todos los días (microservicios, arquitectura, decisiones
de diseño, bugs resueltos) pero ese trabajo no deja rastro público. Su objetivo profesional
—conseguir un rol remoto pago en USD— depende en parte de tener presencia visible y creíble
en LinkedIn. Escribir posts a mano no ocurre: compite con el trabajo mismo.

**bitacora** es un orquestador que convierte actividad técnica real en posts de LinkedIn,
con aprobación humana obligatoria antes de publicar.

**Criterio de éxito:** 3 posts por semana publicados, cada uno anclado en un hecho técnico
concreto y verificable, con esfuerzo humano ≤ 2 minutos por post (leer y aprobar desde el
celular). Cero posts genéricos de relleno.

**No-objetivo:** volumen. Un ciclo que no encuentra material real se salta y avisa.

---

## 2. Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| Fuentes de contenido | Actividad de código + ideas sueltas + tendencias tech | Cubren los tres modos de post: "hice", "pienso", "opino" |
| Publicación | Borrador → aprobación humana → auto-post | Control total sin copy-paste manual |
| Stack | NestJS + TypeScript | Stack más fuerte del autor; el repo es también pieza de portfolio |
| Runtime | Self-host en PC propia | Sin costos de API |
| Motor LLM | Claude CLI headless (`claude -p`) vía bridge HTTP local | Usa la suscripción existente. **Cero API keys de Anthropic** |
| Idioma de los posts | Español | Audiencia actual del autor |
| Idioma del repo | Inglés (README, código, commits) | Proyecto open source |
| Cadencia | 3/semana (Lun/Mié/Vie 08:00) | Sostenible con material real disponible |
| Canal de aprobación | Bot de Telegram | Permite feedback conversacional ("más corto", "sacá el emoji") |
| Licencia | MIT, repo público `github.com/CoceresRoman/bitacora` | Open source |

---

## 3. Arquitectura

Monolito modular NestJS, un solo proceso. Puertos y adaptadores en los bordes; el núcleo no
conoce ni a Claude, ni a LinkedIn, ni a Telegram.

```
┌─ sources/ ────────────────────────────────────┐
│ git-activity  GitHub API (commits/PRs propios) │
│               + repos locales vía `git log`    │
│ inbox         ideas enviadas por Telegram      │
│ trends        HN Algolia + GitHub releases     │
└──────────────────┬────────────────────────────┘
                   │  RawSignal[]
                   ▼
┌─ curator/ ────────────────────────────────────┐
│ scoring + dedupe (hash, tópicos recientes)    │
└──────────────────┬────────────────────────────┘
                   ▼
┌─ generator/ ──────────────────────────────────┐
│ prompt-builder + voice-profile + style guard  │
│ → LlmPort → ClaudeCliAdapter → bridge local   │
└──────────────────┬────────────────────────────┘
                   │  Draft (PENDING_REVIEW)
                   ▼
┌─ review/telegram/ ────────────────────────────┐
│ long-polling + inline keyboard                │
│ [Aprobar] [Reescribir] [Descartar] [Programar]│
└──────────────────┬────────────────────────────┘
                   │  Draft (APPROVED | SCHEDULED)
                   ▼
┌─ publisher/linkedin/ ─────────────────────────┐
│ OAuth + POST /rest/posts + cola con retry     │
└───────────────────────────────────────────────┘
```

### 3.1 Estructura de directorios

```
src/
  core/
    draft.entity.ts
    signal.entity.ts
    ports/
      llm.port.ts
      publisher.port.ts
      review-channel.port.ts
      source.port.ts
  sources/
    git-activity/
    inbox/
    trends/
  curator/
  generator/
  review/telegram/
  publisher/linkedin/
  scheduler/
```

### 3.2 Puertos

- **`LlmPort`** — `generate(prompt: Prompt): Promise<LlmResult>`.
  Único adapter incluido: `ClaudeCliAdapter`. El puerto existe para que terceros enchufen su
  propio motor; el repo **no incluye ni documenta** ningún adapter de API paga.
- **`PublisherPort`** — `publish(draft: Draft): Promise<PublishedRef>`. Adapter: LinkedIn.
- **`ReviewChannelPort`** — `sendForReview(draft)`, `onDecision(cb)`. Adapter: Telegram.
- **`SourcePort`** — `collect(since: Date): Promise<RawSignal[]>`. Tres adapters.

### 3.3 Entidades

```ts
RawSignal {
  id, source: 'git' | 'inbox' | 'trends',
  kind, payload, refs: string[], capturedAt: Date,
  hash: string          // único: dedupe idempotente
}

Draft {
  id, signalId, topic, bodyEs,
  status: DraftStatus,
  revisions: Revision[], // feedback + resultado de cada vuelta
  scheduledAt?: Date,
  publishedUrn?: string  // URN de LinkedIn: evita doble publicación
}
```

### 3.4 Máquina de estados

```
DRAFTING → PENDING_REVIEW → APPROVED → SCHEDULED → PUBLISHED
              │  ├─ REVISING ──┘
              │  └─ DISCARDED
              └─ EXPIRED
```

- `REVISING`: máximo 3 vueltas de feedback por draft. Al agotarse, se ofrece descartar.
- `EXPIRED`: sin respuesta en 48 h. **Nunca publica por defecto.**
- `SCHEDULED` es opcional: aprobar sin fecha publica de inmediato.

### 3.5 Persistencia

Prisma. SQLite por default (`DATABASE_URL="file:./data/bitacora.db"`) para que clonar y
correr no requiera infraestructura. Apuntando `DATABASE_URL` a Postgres funciona igual.
Sin Redis.

### 3.6 Scheduler y recuperación

`@nestjs/schedule` con cron `0 8 * * 1,3,5`. Al bootear, el scheduler consulta el último
ciclo ejecutado: si se perdió uno dentro de una **ventana de gracia de 12 h**, lo corre;
si es más viejo, lo marca `SKIPPED` y no lo ejecuta. Esto evita que encender la PC un
viernes dispare los ciclos del lunes y miércoles.

La cola de publicación es una tabla, no memoria: al arrancar se reintenta todo lo que quedó
en `APPROVED`/`SCHEDULED` con fecha vencida, con backoff exponencial (1 m, 5 m, 25 m, tope
3 intentos, después avisa por Telegram).

---

## 4. Calidad del contenido

Es el requisito que decide si el proyecto sirve. Un post malo con el nombre del autor cuesta
más que diez posts no publicados.

- **`voice-profile.md`** versionado en el repo: tono, temas propios, qué no se dice nunca.
  Se inyecta en todo prompt de generación.
- **Regla de sustancia:** todo post nace de un hecho concreto (commit, bug, decisión de
  arquitectura, idea propia). Sin hecho, no hay post: el ciclo se salta y notifica.
- **Prohibiciones duras** aplicadas por un guard determinista después de generar:
  - aperturas plantilla ("En el mundo del desarrollo…", "🚀 Emocionado de anunciar")
  - más de 3 hashtags
  - más de 1 emoji cada 100 palabras
  - cierre de engagement-bait forzado ("¿Qué opinás? 👇")
  - ausencia de referencia al hecho de origen
- Si el guard falla: una regeneración automática. Si vuelve a fallar, el draft se envía a
  Telegram marcado con las violaciones para decisión humana.

---

## 5. Seguridad

Repo público y una credencial que puede escribir en el LinkedIn del autor. No hay margen.

- **`TELEGRAM_ALLOWED_CHAT_ID` obligatorio.** El bot descarta todo mensaje de cualquier otro
  chat. Sin esta variable el proceso no arranca. Sin ella, cualquiera que encuentre el bot
  publica en el LinkedIn del autor.
- **Tokens de LinkedIn cifrados en reposo** con AES-256-GCM; clave desde `ENCRYPTION_KEY`.
  Nunca se escriben en logs, ni siquiera truncados.
- **Bridge de Claude** escucha solo en `127.0.0.1`, autenticado con header secreto.
- `.env.example` sin ningún valor real. `.env` y `data/` en `.gitignore`.
- CI (GitHub Actions) corre gitleaks + lint + tests en cada push.

### 5.1 LinkedIn API — detalle operativo

- App en LinkedIn Developers con los productos *Sign In with LinkedIn using OpenID Connect*
  y *Share on LinkedIn* → scope `w_member_social`.
- Autor del post: `urn:li:person:{sub}`, donde `sub` viene del ID token OIDC.
- `POST https://api.linkedin.com/rest/posts` con headers `LinkedIn-Version: <YYYYMM>` y
  `X-Restli-Protocol-Version: 2.0.0`.
- Callback OAuth: `http://localhost:3000/auth/linkedin/callback`.
- **Riesgo conocido:** el access token dura ~60 días y los refresh tokens no están
  habilitados en toda app. Mitigación: se guarda el `expiresAt`; a los 55 días el bot envía
  por Telegram el link de re-autenticación. Si la app tiene refresh habilitado, se renueva
  solo. Verificar cuál de los dos casos aplica al crear la app, antes de implementar el
  módulo publisher.

---

## 6. Testing

- Fakes para los cuatro puertos. `core`, `curator` y el style guard se testean sin red, sin
  Claude y sin LinkedIn.
- Adapters: contract tests contra fixtures HTTP grabados (respuestas reales de GitHub, HN,
  LinkedIn y del bridge, con secretos removidos).
- TDD: test primero, en rojo, después implementación. Objetivo de cobertura 80%.
- Un test end-to-end con todos los adapters falsos: señal → draft → aprobación → publicado.

---

## 7. Alcance

**v1 incluye:** las tres fuentes, curator con dedupe, generación en español con guard de
estilo, bot de Telegram con aprobar/reescribir/descartar/programar, publicación en LinkedIn
con retry idempotente, scheduler 3/semana con recuperación acotada de ciclos perdidos,
README + `.env.example` + docker-compose opcional, licencia MIT.

**v1 excluye deliberadamente:** métricas de engagement, imágenes y carruseles, multi-cuenta,
otras redes sociales, dashboard web, generación en inglés.
