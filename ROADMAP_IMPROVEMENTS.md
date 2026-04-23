# WhatsApp Bot - Roadmap de Mejoras Futuras

**Date:** 2026-04-23  
**Status:** Planning

---

## 🎯 Prioridad Alta

### 1. Dynamic Token Allocation (Asignación Dinámica de Tokens)

**Problema Actual:**
- max_tokens fijo en 80 para todas las respuestas
- Algunas respuestas necesitan más espacio (ej: explicar qué documentos faltan)
- Otras pueden ser muy breves (ej: confirmación simple)
- Mensajes se cortan si necesitan más de 80 tokens

**Solución Propuesta:**

Implementar un sistema de **token budget dinámico** basado en prioridad del mensaje:

```javascript
// Antes de llamar a Claude, analizar qué tipo de respuesta necesita
function determineMaxTokens(messageType, context) {
  // messageType: 'confirmation', 'request_field', 'error', 'explanation'
  // context: { hasErrors, fieldCount, documentCount, isFirstMessage }

  const tokenBudget = {
    confirmation: 40,        // "✅ Recibido"
    request_field: 80,       // "Necesito tu provincia. Contame 👇"
    request_document: 100,   // "Aún necesito: DNI dorso, REPROCANN frente"
    explanation: 200,        // Explicar qué pasó, qué falta, etc
    error: 150,              // Error que necesita explicación
    success: 150,            // Confirmación final con contexto
  }

  // Aumentar presupuesto si hay muchos campos faltantes
  if (context.fieldCount > 3) {
    return tokenBudget[messageType] + 50
  }

  // Aumentar si es error crítico
  if (context.isError) {
    return Math.min(tokenBudget[messageType] * 1.5, 300)
  }

  return tokenBudget[messageType]
}

// Uso:
const maxTokens = determineMaxTokens('request_field', { fieldCount: 2, isError: false })
```

**Beneficios:**
- ✅ Respuestas nunca se cortan (presupuesto suficiente para cada tipo)
- ✅ Respuestas confirmación siguen siendo breves (40 tokens)
- ✅ Errores pueden explicarse completamente (200 tokens)
- ✅ Mensajes finales con contexto (150 tokens)

**Implementación:**
1. Crear tabla de tipos de mensaje y presupuestos
2. Analizar contexto del estado antes de generar respuesta
3. Pasar max_tokens dinámico a Claude
4. Guardar en logs qué presupuesto se usó para debugging

---

### 2. Intelligent Response Generation (Generación Inteligente de Respuestas)

**Problema Actual:**
- El system prompt dice "Say ONLY: ..." forzando respuestas cortas
- No hay flexibilidad para mensajes que necesitan más contexto
- Sistema es muy rígido

**Solución Propuesta:**

```javascript
// Generar instrucción dinámica según presupuesto
function buildSystemPrompt(messageType, maxTokens, state) {
  if (maxTokens <= 50) {
    // Respuesta ultra-breve
    return 'Sé EXTREMADAMENTE breve. Máximo 1 palabra o frase corta. Ej: "✅ Recibido"'
  } else if (maxTokens <= 100) {
    // Respuesta breve (1 línea)
    return 'Sé breve pero claro. Máximo 1 línea. Di exactamente qué hace falta o qué recibiste.'
  } else if (maxTokens <= 200) {
    // Respuesta normal (1-2 líneas)
    return 'Sé claro y directo. 1-2 líneas máximo. Explica qué falta, qué documentos, qué campos.'
  } else {
    // Respuesta completa (puede ser más larga)
    return 'Explica completamente qué está pasando, qué falta, qué próximos pasos. Sé profesional pero cálido.'
  }
}
```

---

## 📋 Implementación Detallada (Pseudocódigo)

```javascript
// 1. Analizar estado y determinar tipo de mensaje
function analyzeContext(state, messageType) {
  const context = {
    messageType,
    documentsMissing: countMissingDocuments(state),
    fieldsMissing: state.pendingFields?.length || 0,
    isFirstMessage: !state.documentos?.dni?.frente,
    hasErrors: false,
    documentsTotal: countTotalDocuments(state)
  }
  return context
}

// 2. Determinar budget de tokens
const maxTokens = determineMaxTokens(context.messageType, context)
log('token_budget', `Type: ${context.messageType}, Budget: ${maxTokens}, Context: ${JSON.stringify(context)}`)

// 3. Generar system prompt dinámico
const systemPrompt = buildSystemPrompt(context.messageType, maxTokens, state)

// 4. Llamar a Claude con presupuesto dinámico
const analysis = await callClaude(imageUrl, {
  maxTokens,
  systemPrompt,
  userPrompt: 'Analizá esta imagen.'
})

// 5. Guardar metrics
metrics.tokensUsed[context.messageType] = analysis.usage.output_tokens
metrics.tokensAvailable = maxTokens
```

---

## 🧪 Testing Plan

### Antes de Implementar:
- [ ] Crear tabla de tipos de mensaje vs presupuestos
- [ ] Definir límites para cada tipo
- [ ] Probar en staging con diferentes contextos

### Después de Implementar:
- [ ] Verificar que confirmaciones sigan siendo breves
- [ ] Verificar que errores se expliquen completamente
- [ ] Verificar que nunca se corte un mensaje importante
- [ ] Monitorear tokens reales usados vs presupuestados

---

## 📊 Tipos de Mensaje Propuestos

| Tipo | Uso | Presupuesto | Ejemplo |
|------|-----|-------------|---------|
| `confirmation` | Confirmar recepción de documento | 40-60 | "✅ Recibido." |
| `request_field` | Pedir un campo específico | 60-100 | "Necesito tu provincia. Contame 👇" |
| `request_document` | Pedir documento(s) faltante(s) | 80-150 | "Aún necesito: DNI dorso, REPROCANN" |
| `explanation` | Explicar qué pasa, qué falta | 150-250 | "Recibí tus documentos pero faltan..." |
| `error` | Error que requiere explicación | 100-200 | "Hubo problema procesando la imagen" |
| `success` | Confirmación final completa | 100-150 | "¡Listo! Todo recibido. Te contactamos" |

---

## 🔮 Mejoras Secundarias

### 3. Token Usage Monitoring
- [ ] Guardar tokens usados por tipo de mensaje
- [ ] Alertar si presupuesto insuficiente
- [ ] Analytics: qué tipos de mensaje usan más tokens

### 4. Multi-Language Support
- [ ] Detectar idioma del usuario
- [ ] Responder en español/portugués/inglés
- [ ] Ajustar presupuesto por idioma

### 5. Context-Aware Responses
- [ ] Recordar información de mensajes anteriores
- [ ] Personalizar respuestas (usar nombre del usuario)
- [ ] Referir a documentos específicos que faltan

### 6. Graceful Degradation
- [ ] Si Claude Vision falla: usar OCR alternativo
- [ ] Si Resend falla: intentar reenviar con exponential backoff
- [ ] Si documento no identifica: pedir al usuario que especifique

---

## 📈 Success Criteria

- ✅ Ningún mensaje se corta nunca (incluso errores complejos)
- ✅ Confirmaciones siguen siendo breves (1 línea)
- ✅ Explicaciones son completas cuando es necesario
- ✅ Presupuesto de tokens se ajusta automáticamente
- ✅ Logs muestran qué presupuesto se usó

---

## 🚀 Estimated Effort

| Tarea | Tiempo | Complejidad |
|-------|--------|-------------|
| Dynamic token allocation | 2-3 horas | Media |
| Intelligent prompt generation | 1-2 horas | Baja |
| Testing & validation | 2-3 horas | Media |
| Monitoring & metrics | 1-2 horas | Baja |
| **Total** | **6-10 horas** | - |

---

## 📝 Notes

- Implementar después de v3 esté estable en producción
- Requerir testing extensivo para no romper flujo actual
- Considerar A/B testing: versión old vs new
- Monitorear quality metrics (respuestas cortadas, user satisfaction)

---

**Status:** Anotado para roadmap futuro  
**Prioridad:** Alta (después de v3 estable)  
**Owner:** TBD  
**Última Actualización:** 2026-04-23
