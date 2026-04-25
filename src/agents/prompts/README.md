# Agent prompts (Task #48)

Cada archivo en este directorio es el system prompt de un agente del pipeline nuevo:

- `router.md` — clasifica intent del usuario, decide si hace falta consultar knowledge base y si invocar skill.
- `generator.md` — recibe intent + knowledge snippets + historial, produce la respuesta final.
- `evaluator.md` — rúbrica de calidad: scoring 0-100 sobre objetivo de inscripción, tono, precisión, cierre accionable.

## Flujo

```
user msg → runRouter → (queryKnowledge si needs_knowledge) → runGenerator → runEvaluator
                                                                              ↓
                                                                     score < 70? regenerar 1 vez
                                                                              ↓
                                                                     saveTrainingExample
```

## Convenciones

- Los prompts son markdown pero se concatenan como texto plano al system prompt del LLM call.
- No hardcodear info del club acá — eso va en `knowledge/base.md` y se inyecta vía `queryKnowledge()`.
- Mantener cada prompt bajo 1000 tokens.
