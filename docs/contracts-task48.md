# Task #48 — Knowledge-Driven Agent Contract

**Responsable**: OpenCode (data + runtime layer)  
**Colaborador**: Claude Opus 4.7 (prompts + agents layer)

---

## CONTEXTO

El bot v4.3 hoy tiene un orquestador monolítico en `askClaude()`. Vamos a partirlo en 3 roles (Router, Generator, Evaluator) que comparten una knowledge base consultable. OpenCode construye la base + el runtime de scoring. Claude construye los prompts y la integración.

---

## FASE 0 — Contrato

### Firmas EXPORTADAS

```typescript
// queryKnowledge - Busca en la knowledge base
function queryKnowledge(topic: string, limit?: number): Array<{
  id: string,
  topic: string,
  content: string,
  tags: string[],
  source_url: string | null
}>

// saveTrainingExample - Guarda ejemplos para training
function saveTrainingExample(
  chatId: string,
  userMsg: string,
  botReply: string,
  score: number,
  reason: string
): void

// getEvaluatorScore - Orquestador de scoring
function getEvaluatorScore(
  reply: string,
  context: { chatId: string, history: Array<{role: string, content: string}> }
): {
  score: number,      // 0-100
  reasons: string[],
  passes: boolean
}
```

### Interfaces EXTERNAS (implementadas por Claude)

```typescript
// Parseador de output del LLM - implementa Claude
function parseEvaluatorReply(rawLLMOutput: string): {
  score: number,
  reasons: string[],
  passes: boolean
}
```

---

## FASE 1 — Tabla bot_knowledge + seeds

✅ **COMPLETADO** (2026-04-25)

- [x] Tabla: `supabase/migrations/20260425_bot_knowledge.sql`
  - Schema: `id UUID, topic, content, tags text[], source_url, priority, active, timestamps`
  - RLS: **service_role only** (anon_read eliminada - hardening)
  - Índices: btree(topic) WHERE active, GIN(tags) WHERE active
  - Sin seeds en migración (solo schema)
- [x] Seeds: `knowledge/seeds/bot_knowledge.jsonl` (32 entriesparseadas de base.md)
- [x] Seed script: `scripts/seed-knowledge.js` (upsert by topic)
- [x] Test: `tests/knowledge-query.test.js` (seed + queryKnowledge('indajaus') ≥1)

---

## FASE 2 — Runtime de queryKnowledge

✅ **COMPLETADO** (2026-04-25)

- [x] Runtime: `src/knowledge/query.js`
  - `queryKnowledge(topic, limit=3)` — búsqueda por topic exact, tags overlap, content ILIKE
  - Scoring: topic exact (100), topic partial (50), tags match (30), content (10)
  - `getKnowledgeStats()` — row count + últimas 5 entries
- [x] Exports: `src/knowledge/index.js`
- [x] Endpoint: `/admin/knowledge-stats` (admin-gated)

---

## FASE 3 — Training storage

**TODO**: La implementación va aquí.

---

## FASE 4 — Evaluator scoring runtime

**TODO**: La implementación va aquí.

---

## REGLAS ESTRICTAS

- **NO tocás**: SYSTEM_PROMPT, askClaude, ni los archivos src/agents/*
- **NO editás**: index.js salvo agregar imports al tope alfabético
- **Comentarios**: `// Added by OpenCode (Rolli) on 2026-04-25`
- **Commits**: Una fase = 1 commit atómico en feat/knowledge-layer
- **Sin merges** a master hasta aprobación del usuario

---

## Pendiente de Claude (escribir TODO en cada fase)

- [ ] Integración de queryKnowledge en el flujo del Router
- [ ] Prompt del Generator usando knowledge base
- [ ] Prompt del Evaluator con scoring
- [ ] Llamadas a getEvaluatorScore en el loop principal