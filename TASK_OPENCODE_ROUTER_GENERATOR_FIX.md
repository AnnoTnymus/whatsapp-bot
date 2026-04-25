# Task: Mejorar Router + Generator para Flujo de Afiliación

## Problema

Cuando usuario dice "Hola quería inscribirme", el bot responde "¿En qué te puedo ayudar?" en lugar de ir directo a pedir nombre.

El orquestador (Router → Generator → Evaluator) ya existe. El problema es que **los prompts no coordinan bien cuando hay saludo + intención juntos**.

## Cambios Requeridos

### 1. Router: Mejorar detección de "Saludo + Intención Combinados"

**Archivo:** `src/agents/prompts/router.md`

**Agregar esta sección antes de "Ejemplos":**

```markdown
## Caso especial: Saludo + Intención Combinados

Cuando el usuario saluda Y expresa intención de afiliación en el MISMO mensaje:
- Ignorá el saludo como intent separado
- Priorizá la intención (affiliate)
- Marca `wants_affiliation: true`

Ejemplos:
- "Hola quería inscribirme" → intent=affiliate, wants_affiliation=true (NOT greet)
- "Buenas, me quiero afiliar" → intent=affiliate, wants_affiliation=true
- "Hola, ¿puedo asociarme?" → intent=affiliate, wants_affiliation=true
- "Hola, ¿cómo funciona?" → intent=info, wants_affiliation=false (es pregunta genérica)
```

### 2. Generator: Responder según Estado Actual

**Archivo:** `src/agents/prompts/generator.md` (si existe) o `src/agents/generator.js`

**Agregar lógica condicional al prompt del Generator:**

```markdown
## Contexto: Estado del Usuario

Recibís el `state.step` que indica dónde está el usuario en el flujo:
- `solicitando_nombre`: Usuario acaba de expresar querer afiliarse, necesita ser preguntado su nombre
- `recibiendo_documentos`: Usuario está pasando DNI/REPROCANN
- `completando_datos`: Faltan campos específicos de documentos
- `conversando`: Conversación normal, sin flujo activo
- `completado`: Documentos listos, usuario será contactado

## Reglas según Step

**Si `step === 'solicitando_nombre'` y `wants_affiliation === true`:**
- NO preguntes "¿en qué te ayudo?"
- Responde con confirmación de afiliación + pide nombre directo
- Ejemplo: "¡Claro! Contame, ¿cómo te llamas? Una vez que tengo tu nombre, te cuento qué necesitamos para la inscripción."

**Si `step === 'recibiendo_documentos'`:**
- Guía al usuario a mandar DNI frente, DNI dorso, REPROCANN
- No hagas preguntas genéricas
- Ejemplo: "Perfecto. Ahora necesito que me mandes tu DNI (frente y dorso) y tu REPROCANN 📸"

**Si `step === 'completando_datos'` y `pending_fields`:**
- Pide específicamente el campo faltante
- No preguntes por todo de nuevo
- Ejemplo: "Me faltó tu provincia. ¿De dónde sos? 👇"

**Si `step === 'conversando'` y hay intención de afiliación:**
- Confirmá que quiere afiliarse
- Cambió el step a 'solicitando_nombre' después de responder su pregunta
- En siguiente mensaje, pide nombre

**Sino (conversación normal):**
- Respondé naturalmente
- No menciones documentos/afiliación si no es relevante
```

### 3. Integración en index.js (Código Viejo)

**Verificar que:**
- `state.step` se está pasando correctamente al Router/Generator
- `state.wants_affiliation` se está guardando desde el routerOutput
- El flujo de transición de estados es consistente

**En la sección donde se llama el nuevo pipeline (USE_NEW_PIPELINE === true):**

```javascript
// Pasar state completo al Router
const routerOutput = await runRouter({ 
  message: msg, 
  history: conversationHistory.get(chatId) || [],
  state  // ← IMPORTANTE: pasar state para que Router pueda ver step actual
})

// Si wants_affiliation y usuario aún no tiene nombre
if (routerOutput.wants_affiliation && !state.nombre) {
  state.step = 'solicitando_nombre'
}

// Pasar state al Generator también
const generatorOutput = await runGenerator({
  message: msg,
  history,
  state,  // ← state con step actual
  intent: routerOutput.intent,
  skill: routerOutput.skill,
  knowledge: snippets
})
```

## Flujo Esperado (Después del Fix)

```
Usuario: "Hola quería inscribirme"
↓
Router: { intent: "affiliate", wants_affiliation: true, ... }
↓
Generator recibe: { step: "conversando", wants_affiliation: true, intent: "affiliate" }
↓
Generator entiende: Usuario quiere afiliarse + responde según regla
↓
Bot: "¡Claro! Contame, ¿cómo te llamas? Una vez que tengo tu nombre, te cuento qué necesitamos."
↓
state.step pasa a 'solicitando_nombre'
↓
Siguiente mensaje del usuario: "Martin"
↓
Router: { intent: "info" (neutral) }
↓
Generator recibe: { step: "solicitando_nombre", nombre_completo: null }
↓
Generator entiende: Es respuesta a pregunta de nombre
↓
Bot: "Perfecto Martin, ahora necesito que me mandes tu DNI y REPROCANN 📸"
↓
state.step pasa a 'recibiendo_documentos'
```

## Aceptación

✅ Router detecta "Hola quería inscribirme" → intent=affiliate (not greet)
✅ Generator responde con confirmación + pide nombre directo (sin "¿en qué te ayudo?")
✅ Generator maneja los 5 states correctamente (solicitando_nombre, recibiendo_documentos, etc)
✅ State.step fluye correctamente y guía las respuestas
✅ Prueba: "Hola quería inscribirme" → Bot pide nombre directo
✅ Prueba: Usuario dice nombre → Bot pide documentos directo

---

**Autor:** Claude Code | **Fecha:** 2026-04-25 | **Para:** OpenCode  
**Dependencias:** Router y Generator ya existen; solo mejoramos prompts  
**Scope:** NO crear nuevos agentes, solo arreglar existentes
