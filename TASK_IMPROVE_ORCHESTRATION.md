# Task: Mejorar Orquestación del Bot — Minimizar Respuestas Errátidas

## Problema Actual

El bot responde de forma inconsistente/errática porque:

1. **No hay orquestador centralizado** — las decisiones están distribuidas en varios puntos
2. **Router + Generator no coordina bien** — ambos pueden tomar decisiones de forma independiente
3. **Estado del usuario no fluye correctamente** — el `step` (solicitando_nombre, recibiendo_documentos, etc) no guía las respuestas
4. **Lógica de afiliación dispersa** — detectar intención de afiliación no es suficiente; hay que ORQUESTAR el flujo completo
5. **Saludo + Intención combinados no se manejan** — si dice "Hola quiero inscribirme", el bot pregunta "¿en qué te ayudo?" en lugar de confirmar la intención

## Solución: Crear Orchestrator Agent

Necesitamos un nuevo agente **Orchestrator** que:

1. **Reciba TODO el contexto**
   - Mensaje del usuario
   - Historial de conversación
   - Estado actual (step, nombre, documentos recibidos, etc)
   - Output del Router (intent, skill, wants_affiliation)

2. **Determine el mejor camino a tomar**
   - ¿Usuario está en medio de un flujo de afiliación? → continuar flujo
   - ¿Usuario expresó intención de afiliación? → iniciar flujo de nombre
   - ¿Usuario pide skill? → delegar a skill
   - ¿Usuario hace pregunta general? → buscar conocimiento + responder
   - ¿Flujo completado? → enviar email

3. **Retorne una decisión estructurada**
   ```json
   {
     "action": "ask_for_name" | "ask_for_documents" | "process_documents" | "invoke_skill" | "answer_question" | "human_handover",
     "next_step": "solicitando_nombre" | "recibiendo_documentos" | "completando_datos" | "conversando" | null,
     "message": "Lo que el bot debería responder (si action requiere respuesta)",
     "reasoning": "por qué tomamos esta decisión"
   }
   ```

4. **Casos de uso que debe manejar**
   
   | Escenario | Action | next_step |
   |-----------|--------|-----------|
   | "Hola quería inscribirme" | ask_for_name | solicitando_nombre |
   | "Me llamo Martin" (en solicitando_nombre) | ask_for_documents | recibiendo_documentos |
   | Imagen DNI + REPROCANN completas, datos válidos | send_email | completado |
   | Imagen DNI pero faltan campos | ask_missing_field | completando_datos |
   | "¿Qué ley regula?" | invoke_skill | conversando |
   | "Necesito hablar con alguien" | human_handover | null |
   | "Jajaja" | respond_naturally | conversando |

## Implementación Sugerida

### Prioridad 1: Crear Orchestrator Agent

**Archivo:** `src/agents/orchestrator.js`

```javascript
export async function runOrchestrator({ message, history, state, routerOutput }, opts = {}) {
  // Recibe: message, history, state, output del Router
  // Retorna: { action, next_step, message, reasoning }
  
  // Lógica:
  // 1. Si state.step === 'solicitando_nombre' → ask_for_documents después de parsear nombre
  // 2. Si state.step === 'recibiendo_documentos' && tiene imagen → process_documents
  // 3. Si state.step === 'completando_datos' && tiene campos faltantes → ask_missing_field
  // 4. Si routerOutput.wants_affiliation === true → ask_for_name
  // 5. Si routerOutput.intent === 'skill' → invoke_skill
  // 6. Si routerOutput.intent === 'goodbye' → goodbye
  // 7. Si routerOutput.intent === 'handover' → human_handover
  // 8. Sino → answer_question (Generator + Knowledge)
}
```

**Archivo:** `src/agents/prompts/orchestrator.md`

```markdown
# Orchestrator — Centralizador de Decisiones

Eres el orquestador del bot. Recibís:
- Mensaje del usuario
- Historial
- Estado actual (step, nombre, documentos)
- Output del Router

Tu trabajo: DECIDIR qué hacer (no responder, solo decidir).

## Estados Válidos
- `inicio`: Usuario nuevo, no tiene nombre
- `solicitando_nombre`: Esperando que el usuario diga su nombre
- `recibiendo_documentos`: Usuario está pasando DNI/REPROCANN
- `completando_datos`: Faltan campos, pidiendo por texto
- `conversando`: Conversación normal, sin flujo activo
- `completado`: Documentos completos, email enviado

## Decisiones
Retorna JSON (solo esto, nada más):
{
  "action": "ask_for_name" | "ask_for_documents" | "ask_missing_field" | 
            "process_documents" | "send_email" | "invoke_skill" | 
            "answer_question" | "human_handover" | "respond_naturally" | "goodbye",
  "next_step": "solicitando_nombre" | "recibiendo_documentos" | "completando_datos" | "conversando" | null,
  "message": "Opcionalmente, si la acción requiere un mensaje predefinido, acá va",
  "reasoning": "por qué tomaste esta decisión"
}

## Reglas Duras

1. Si `step === 'solicitando_nombre'` → siempre `action: ask_for_name` (espera respuesta, no generes)
2. Si `step === 'recibiendo_documentos'` + hay imagen → delega a `process_documents` (que valida)
3. Si hay campos faltantes → `ask_missing_field` con el primer campo
4. Si `wants_affiliation === true` y `nombre === null` → `ask_for_name`
5. Si `wants_affiliation === true` y `nombre !== null` → `ask_for_documents`
6. Si skill activo → `invoke_skill`
7. Si intent === 'goodbye' → `goodbye`
8. Si intent === 'handover' → `human_handover`
9. Sino → `answer_question` (Generator genera respuesta)
```

### Prioridad 2: Mejorar Router para detectar "Saludo + Intención Combinados"

**En:** `src/agents/prompts/router.md`

Agregar regla especial:

```markdown
## Caso especial: Saludo + Intención Combinados

Si el usuario dice "Hola quería afiliarme", "Buenas, quiero inscribirme", etc:
- intent debe ser "affiliate", NO "greet"
- wants_affiliation debe ser true
- El Orchestrator lo detectará y pedirá nombre inmediatamente

Ejemplos que DEBEN devolver intent=affiliate:
- "Hola quería inscribirme"
- "Buenas, me quiero afiliar"  
- "Hola, me puedo asociar?"
```

### Prioridad 3: Mejorar Generator para recibir contexto del Orchestrator

**Cambio en:** `src/agents/generator.js`

El Generator debe recibir NO solo el intent, sino también:
- El `action` que decidió el Orchestrator
- El `next_step` que necesita
- El estado actual

Así puede generar respuestas más contextualizadas.

## Pipeline Mejorado

```
user message
  ↓
runRouter(message, history, state)
  ↓ (devuelve intent, skill, wants_affiliation)
runOrchestrator(message, history, state, routerOutput) ← NUEVO
  ↓ (devuelve action, next_step, message)
  
SI action === "invoke_skill"
  → invokeSkill(skill, ...) → saltar Generator
  
SI action === "ask_for_name" | "ask_for_documents" | "ask_missing_field"
  → responder mensaje predefinido, cambiar step
  
SI action === "answer_question"
  → runGenerator(message, history, state, intent, knowledge)
    → runEvaluator(reply)
    → if !passes: regenerar
    → responder
    
SI action === "human_handover"
  → enviar a admin
  
SI action === "goodbye"
  → despedir
```

## Código Viejo: Correcciones Inmediatas

Sin esperar Orchestrator, arreglar estas cosas:

### 1. Mejorar prompt del bot para "quiero inscribirme"

En `index.js`, línea donde responde a afiliación, cambiar:

```javascript
// ANTES:
"¡Bienvenido/a! 🌿 Para afiliarte necesito que me pases tu DNI y certificado REPROCANN..."

// DESPUÉS:
"¡Claro! Contame, ¿cómo te llamas? Una vez que tengo tu nombre, te digo exactamente qué necesitamos."
```

### 2. No preguntar "¿en qué te ayudo?" si ya hay intención

En el prompt del bot (línea ~447), cambiar la lógica de saludo:

```markdown
ANTES:
Si saluda (hola, buenas, etc):
→ Saludá cordialmente y preguntá en qué podés ayudar

DESPUÉS:
Si saluda SIN intención adicional:
→ Saludá y preguntá en qué ayudar
  
Si saluda CON intención (quiere inscribirse):
→ Saludá, confirma intención, pide nombre directamente
```

### 3. Lógica de transición de states

En `index.js`, revisar línea 1876-1878:

```javascript
// Agregar lógica:
if (state.step === 'conversando' && state.wants_affiliation) {
  state.step = 'solicitando_nombre'
  // Pedir nombre explícitamente sin preguntar "¿en qué te ayudo?"
}
```

## Aceptación

✅ Orchestrator creado en `src/agents/orchestrator.js` + prompt
✅ Router mejorado para detectar "saludo + intención" juntos
✅ Pipeline actualizado en `index.js` para usar Orchestrator (si USE_NEW_PIPELINE)
✅ Código viejo mejora respuestas de afiliación sin esperar Orchestrator
✅ Tests: usuario dice "Hola quiero inscribirme" → bot pide nombre directo, sin "¿en qué ayudo?"

---

**Autor:** Claude Code | **Fecha:** 2026-04-25 | **Para:** OpenCode
