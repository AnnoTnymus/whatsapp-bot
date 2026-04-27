# Plan: Multiidioma — Español, Inglés, Portugués

## Actual

- Solo español ✓
- Hardcoded en prompts

## Objetivo

- Detectar idioma automáticamente
- Responder en el mismo idioma del usuario
- Variables de entorno para config

## Fases

### Fase 1: Detector de idioma
- Crear función `detectLanguage(text)` en `index.js`
- Usar reglas simples (palabras clave) o librería ligera
- O usar el primer mensaje del usuario para detectar

### Fase 2: Prompts por idioma
- Duplicar prompts existentes:
  - `prompts/router.md` → `prompts/router-en.md`, `prompts/router-pt.md`
  - `prompts/generator.md` → `prompts/generator-en.md`, `prompts/generator-pt.md`
- Adaptar instrucciones y ejemplos

### Fase 3: Selector dinámico
- Modificar `router.js` y `generator.js` para:
  - Leer `language` del estado o detectar
  - Cargar prompt apropiado
  - Ajustar respuestas según idioma

### Fase 4: Knowledge base
- Duplicar/traducir seeds en `bot_knowledge`
- Queries en español, inglés, portugués

---

## Tareas técnicas

| # | Tarea | Archivo |
|---|-------|---------|
| 1 | Agregar `LANGS = ['es','en','pt']` en .env | index.js |
| 2 | Función `detectLanguage(text)` | index.js |
| 3 | Guardar `language` en `state` | index.js |
| 4 | Copias de prompts por idioma | prompts/*.md |
| 5 | Selector en router/generator | src/agents/*.js |
| 6 | seeds por idioma | knowledge/seeds/*.jsonl |
| 7 | Actualizar presentation.html | public/presentation.html |

---

## Estimación

- **Fase 1**: 30 min
- **Fase 2**: 1 hora
- **Fase 3**: 30 min
- **Fase 4**: 1 hora

**Total**: ~3 horas

---

## Pendiente

- Traducir los prompts existentes a EN/PT (o hire translator)
- Testing con usuarios reales

---

**Confirmame para arrancar.**