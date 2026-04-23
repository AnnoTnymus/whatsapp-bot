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

## 🎯 Prioridad Alta (Fase 2 - Con Base de Datos)

### 3. Smart Patient Follow-up & Tracking (Sistema de Seguimiento Inteligente)

**Contexto:**
Muchos pacientes dicen que van a sacar REPROCANN pero no lo hacen. Otros dicen que ya lo tienen pero no lo envían. Necesitamos seguimiento automático basado en su situación.

**Problema:**
- Sin DB: información se pierde cuando servidor reinicia
- Sin tracking: no sabemos qué dijo el paciente o cuándo
- Sin notificaciones: pacientes se olvidan
- Sin automatización: admin debe recordar manualmente

**Solución Propuesta:**

Implementar sistema de **Follow-up Inteligente** con notificaciones automáticas:

```javascript
// Tabla en BD: patient_followups
{
  id: UUID,
  chatId: "59892499463@c.us",
  nombre: "Tincho",
  estado: "pendiente_reprocann" | "pendiente_dni" | "completado",
  razon: "no_tiene_reprocann" | "va_a_sacar" | "ya_lo_tiene" | "en_tramite",
  
  // Cuando contactó por primera vez
  primer_contacto: "2026-04-23T03:54:50.319Z",
  
  // Próxima notificación
  proxima_notificacion: "2026-04-24T10:00:00Z", // 1 día después
  
  // Regla que determinó el tiempo
  regla_seguimiento: {
    tipo: "no_tiene_reprocann",
    tiempoEspera: 1,      // días
    razon: "Necesita tiempo para gestionar trámite"
  },
  
  // Historial de intentos
  intentos_contacto: [
    { fecha: "2026-04-23", mensaje: "Bot pidió REPROCANN", respuesta: "no_tengo" },
    { fecha: "2026-04-24", mensaje: "Recordatorio primer día" },
  ],
  
  documentacion_recibida: {
    dni_frente: false,
    dni_dorso: false,
    reprocann_frente: false,
    reprocann_dorso: false
  }
}
```

**Reglas de Seguimiento Automático:**

```javascript
const followupRules = [
  {
    trigger: "no_tiene_reprocann",
    tiempoEspera: { value: 1, unit: "day" },
    mensaje: "Hola {nombre}! 👋 ¿Ya tramitaste tu REPROCANN? Necesitamos esa documentación para avanzar.",
    razon: "Usuario dijo que no tiene REPROCANN pero puede gestionar en argentina.gob.ar"
  },
  {
    trigger: "va_a_sacar_reprocann",
    tiempoEspera: { value: 3, unit: "days" },
    mensaje: "Hola {nombre}! ¿Pudiste sacar el REPROCANN? Te espero cuando lo tengas 🌿",
    razon: "Usuario dijo que la iba a sacar en los próximos días"
  },
  {
    trigger: "tiene_reprocann_pero_no_envio",
    tiempoEspera: { value: 1, unit: "day" },
    mensaje: "Hola {nombre}! Necesito que me mandes foto de tu REPROCANN (frente y dorso) 📸",
    razon: "Usuario dijo que ya la tiene pero no envió aún"
  },
  {
    trigger: "documento_parcial_dni_pendiente",
    tiempoEspera: { value: 2, unit: "days" },
    mensaje: "Hola {nombre}! Solo me falta tu DNI (frente y dorso) para completar. ¿Podés enviarmelo?",
    razon: "Tiene REPROCANN pero no enviaste DNI"
  },
  {
    trigger: "documento_parcial_reprocann_pendiente",
    tiempoEspera: { value: 2, unit: "days" },
    mensaje: "Hola {nombre}! Solo me falta tu REPROCANN para completar. ¿Podés enviarmelo?",
    razon: "Tiene DNI pero no envió REPROCANN"
  },
  {
    trigger: "no_responde_3_dias",
    tiempoEspera: { value: 7, unit: "days" },
    mensaje: "Hola {nombre}! ⏰ Hace varios días que no sabemos de vos. ¿Seguís interesado en afiliarte?",
    razon: "Inactividad sin respuesta - revisar si sigue interesado"
  },
  {
    trigger: "incompleto_hace_2_semanas",
    tiempoEspera: { value: 14, unit: "days" },
    mensaje: "Hola {nombre}! Hace 2 semanas que empezaste el proceso. ¿Necesitás ayuda con algo?",
    razon: "Largo tiempo sin completar - ofrecer asistencia"
  }
]
```

**Arquitectura de Cálculo:**

```javascript
function calcularProximaNotificacion(estado, razon, ultimoContacto) {
  const regla = followupRules.find(r => r.trigger === razon)
  
  if (!regla) {
    log('warning', `No rule found for reason: ${razon}`)
    return null
  }
  
  const tiempoMs = convertToMs(regla.tiempoEspera)
  const proximaNotificacion = new Date(ultimoContacto.getTime() + tiempoMs)
  
  return {
    proximaNotificacion,
    regla: regla.trigger,
    tiempoEspera: regla.tiempoEspera,
    mensaje: regla.mensaje,
    razon: regla.razon
  }
}

function convertToMs(tiempoObj) {
  const { value, unit } = tiempoObj
  const msPerUnit = {
    'hour': 60 * 60 * 1000,
    'day': 24 * 60 * 60 * 1000,
    'week': 7 * 24 * 60 * 60 * 1000,
  }
  return value * msPerUnit[unit]
}
```

**Sistema de Notificaciones Programadas:**

```javascript
// Cron job que se ejecuta cada 15 minutos
// SELECT * FROM patient_followups WHERE proxima_notificacion <= NOW()

async function executeScheduledFollowups() {
  const pendientes = await db.query(`
    SELECT * FROM patient_followups 
    WHERE proxima_notificacion <= NOW() 
    AND estado != 'completado'
    ORDER BY proxima_notificacion ASC
  `)
  
  for (const followup of pendientes) {
    try {
      // Personalizar mensaje
      const mensaje = followup.regla_seguimiento.mensaje
        .replace('{nombre}', followup.nombre)
      
      // Enviar mensaje via WhatsApp
      await sendWhatsAppMessage(followup.chatId, mensaje)
      
      // Registrar intento
      await db.query(`
        UPDATE patient_followups 
        SET 
          intentos_contacto = intentos_contacto || $1,
          proxima_notificacion = $2
        WHERE id = $3
      `, [
        { fecha: new Date(), mensaje, exito: true },
        calcularProximaNotificacion(...)  // próximo intento
        followup.id
      ])
      
      log('followup', `Sent followup to ${followup.nombre} (${followup.chatId})`)
    } catch (e) {
      log('followup_error', `Failed for ${followup.chatId}: ${e.message}`)
    }
  }
}
```

**Actualización de Estado al Recibir Documento:**

```javascript
// Cuando usuario envía documento
async function updatePatientState(chatId, documentoRecibido, esCompleto) {
  const followup = await db.query(`
    SELECT * FROM patient_followups WHERE chatId = $1
  `, [chatId])
  
  if (!followup) return
  
  // Actualizar documentación recibida
  followup.documentacion_recibida[documentoRecibido] = true
  
  // Calcular nuevo estado
  let nuevoEstado = followup.estado
  let proximaNotificacion = null
  
  if (esCompleto) {
    // Todos los documentos recibidos
    nuevoEstado = 'completado'
    proximaNotificacion = null // Sin notificación futura
  } else {
    // Parcialmente completo, calcular qué falta
    const docFaltantes = Object.entries(followup.documentacion_recibida)
      .filter(([_, recibido]) => !recibido)
      .map(([doc, _]) => doc)
    
    if (docFaltantes.length > 0) {
      // Calcular próxima notificación por documento faltante
      const razonNueva = docFaltantes[0].includes('reprocann') 
        ? 'documento_parcial_reprocann_pendiente'
        : 'documento_parcial_dni_pendiente'
      
      proximaNotificacion = calcularProximaNotificacion(
        nuevoEstado, 
        razonNueva, 
        new Date()
      )
    }
  }
  
  // Guardar en BD
  await db.query(`
    UPDATE patient_followups 
    SET 
      estado = $1,
      documentacion_recibida = $2,
      proxima_notificacion = $3
    WHERE chatId = $4
  `, [nuevoEstado, followup.documentacion_recibida, proximaNotificacion?.proximaNotificacion, chatId])
}
```

---

## 📊 Estados del Paciente

```
inicio
  ↓
contacto_inicial (usuario envía primer documento)
  ├─→ no_tiene_reprocann → [seguimiento 1 día] → check_1dia
  ├─→ va_a_sacar_reprocann → [seguimiento 3 días] → check_3dias
  ├─→ tiene_reprocann → [espera envío] → ...
  └─→ no_responde → [seguimiento 7 días] → recheck

documento_parcial
  ├─→ tiene_dni_espera_reprocann → [seguimiento 2 días] → check_2dias
  └─→ tiene_reprocann_espera_dni → [seguimiento 2 días] → check_2dias

documentacion_completa
  ├─→ validando_campos → [espera respuestas de texto]
  └─→ completado → [email enviado, FIN]

inactivo
  ├─→ no_responde_3_dias → [seguimiento 7 días]
  └─→ incompleto_2_semanas → [último intento de contacto]
```

---

## 🔔 Ejemplos de Notificaciones

**Caso 1: Usuario sin REPROCANN**
```
Día 0: Usuario dice "no tengo REPROCANN"
Bot: "Entendido, podés sacarla en argentina.gob.ar, es gratis"

Día 1 (automático): 
Bot: "¡Hola Tincho! 👋 ¿Ya tramitaste tu REPROCANN? 
      Necesitamos esa documentación para avanzar."
      
Día 2-3: Usuario responde con REPROCANN
Bot procesa y continúa flujo normal
```

**Caso 2: Usuario con REPROCANN pero no envía**
```
Día 0: Usuario dice "ya la tengo"
Bot: "Perfecto! Mandame foto de frente y dorso"

Día 1 (automático):
Bot: "¡Hola Tincho! Necesito que me mandes foto de tu REPROCANN 
      (frente y dorso) 📸"
      
Día 3-4: Usuario envía REPROCANN
Bot procesa y continúa
```

**Caso 3: Largo tiempo sin responder**
```
Día 0: Usuario envía primer documento
Día 3: Sin respuesta
Día 7 (automático):
Bot: "¡Hola Tincho! ⏰ Hace varios días que no sabemos de vos. 
      ¿Seguís interesado en afiliarte?"
      
Si responde: continúa
Si no responde: marcar como "inactivo"
```

---

## 💾 Schema de BD Mínimo

```sql
-- Tabla de seguimiento de pacientes
CREATE TABLE patient_followups (
  id UUID PRIMARY KEY,
  chatId VARCHAR(50) UNIQUE NOT NULL,
  nombre VARCHAR(100),
  estado VARCHAR(50), -- pendiente_reprocann, pendiente_dni, completado, inactivo
  razon VARCHAR(100), -- no_tiene_reprocann, va_a_sacar, etc
  
  primer_contacto TIMESTAMP,
  ultimo_contacto TIMESTAMP,
  proxima_notificacion TIMESTAMP,
  
  documentacion_recibida JSONB, -- {dni_frente, dni_dorso, reprocann_frente, reprocann_dorso}
  
  regla_seguimiento JSONB, -- {tipo, tiempoEspera, razon}
  intentos_contacto JSONB[], -- [{fecha, mensaje, exito}]
  
  datos_completos JSONB, -- DNI + REPROCANN datos finales
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para búsquedas rápidas
CREATE INDEX idx_proxima_notificacion ON patient_followups(proxima_notificacion);
CREATE INDEX idx_estado ON patient_followups(estado);
CREATE INDEX idx_chatId ON patient_followups(chatId);
```

---

## 📈 Success Criteria

- ✅ Pacientes reciben recordatorios automáticos sin intervención manual
- ✅ Tiempos de seguimiento adaptan según razón (1d, 3d, 7d, 14d)
- ✅ Estado se actualiza automáticamente al recibir documentos
- ✅ Historial completo de intentos de contacto
- ✅ Admin puede ver quién está pendiente, en qué etapa, desde cuándo
- ✅ Mensajes personalizados con nombre del usuario

---

## 🚀 Estimated Effort

| Tarea | Tiempo | Complejidad |
|-------|--------|-------------|
| Schema BD | 1 hora | Baja |
| Reglas de seguimiento | 2-3 horas | Media |
| Cálculo de notificaciones | 2 horas | Media |
| Cron job / scheduler | 2-3 horas | Media |
| Integración con webhook | 2 horas | Baja |
| Testing | 3-4 horas | Media |
| Admin dashboard (ver seguimiento) | 4-6 horas | Alta |
| **Total** | **16-20 horas** | - |

---

## 📝 Notas

- Implementar DESPUÉS de tener base de datos operativa
- Usar Postgres con JSONB para flexibilidad
- Cron job puede ejecutarse con node-cron o systemd timer
- Considerar timezone del usuario para notificaciones
- Guardar log de todos los intentos para auditoría

---

## ⚠️ PROBLEMA CRÍTICO: Pérdida de Datos en Reinicios

### Problema Actual (v3.0)

**Situación:**
- El servidor se reinicia ocasionalmente (deploy automático, crash, etc)
- Todo el estado de usuarios está en memoria (`userState` Map)
- Cuando se reinicia: **Se pierden todos los documentos enviados**
- Usuario debe empezar de cero

**Ejemplo Real:**
```
Día 1, 15:00 - Usuario envía REPROCANN frente
Bot: "✅ Recibido, mandame el dorso"

Día 1, 15:05 - Servidor se reinicia (deploy automático)

Día 1, 15:06 - Usuario envía REPROCANN dorso
Bot: "✅ Recibido. Aún necesito: REPROCANN frente, DNI frente, DNI dorso"

Usuario confundido: "¡Pero recién envié el frente!" ❌
```

### Solución: Persistir Todo en BD

**Cuando implementen BD, guardar INMEDIATAMENTE:**

```javascript
// Cuando se recibe una imagen
async function procesarImagen(chatId, imageUrl, type) {
  // 1. Guardar imagen URL en BD ANTES de procesar
  await db.query(`
    INSERT INTO document_uploads (chatId, imageUrl, tipo, timestamp)
    VALUES ($1, $2, $3, NOW())
  `, [chatId, imageUrl, type])
  
  // 2. Procesar imagen
  const data = await detectImage(imageUrl)
  
  // 3. Actualizar estado en BD inmediatamente
  await db.query(`
    UPDATE patient_state 
    SET documentos_recibidos = documentos_recibidos || $1
    WHERE chatId = $2
  `, [{ [type]: { url: imageUrl, data } }, chatId])
  
  // 4. Responder al usuario
  await sendWhatsAppMessage(chatId, respuesta)
}
```

### Schema de BD para Esto

```sql
-- Tabla de uploads de documentos
CREATE TABLE document_uploads (
  id UUID PRIMARY KEY,
  chatId VARCHAR(50) NOT NULL,
  imageUrl TEXT NOT NULL,
  tipo VARCHAR(50), -- dni_frente, dni_dorso, reprocann_frente, reprocann_dorso
  status VARCHAR(50), -- pending, processed, error
  extracted_data JSONB, -- datos extraídos de la imagen
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (chatId) REFERENCES patient_followups(chatId)
);

-- Tabla de estado del usuario (reemplaza en-memoria)
CREATE TABLE patient_state (
  chatId VARCHAR(50) PRIMARY KEY,
  nombre VARCHAR(100),
  paso_actual VARCHAR(50), -- recibiendo_documentos, completando_datos, completado
  documentos_recibidos JSONB, -- {dni_frente, dni_dorso, reprocann_frente, reprocann_dorso}
  datos_completos JSONB, -- datos finales validados
  campos_faltantes JSONB[], -- campos que faltan llenar
  datos_texto_completados JSONB, -- datos que usuario proporcionó por texto
  ultimo_documento_timestamp TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_document_uploads_chatId ON document_uploads(chatId);
CREATE INDEX idx_patient_state_created ON patient_state(created_at);
```

### Al Iniciar el Bot

```javascript
// En startup.js o en inicio del webhook
async function loadUserStateFromDB(chatId) {
  // En lugar de crear state vacío, buscar en BD
  const state = await db.query(
    'SELECT * FROM patient_state WHERE chatId = $1',
    [chatId]
  )
  
  if (state) {
    // El usuario YA había empezado el proceso, recuperar su estado
    userState.set(chatId, state)
    log('startup', `Loaded state for ${chatId} from DB`)
    return state
  } else {
    // Usuario nuevo
    const newState = { paso_actual: 'recibiendo_documentos', ... }
    userState.set(chatId, newState)
    await db.query(
      'INSERT INTO patient_state (...) VALUES (...)',
      [...]
    )
    return newState
  }
}

// Usar en webhook
const state = await loadUserStateFromDB(chatId)
```

### Sincronización Bidireccional

```javascript
// IMPORTANTE: Sincronizar memoria ↔ BD constantemente

async function syncStateToDB(chatId, state) {
  // Después de CADA cambio de estado
  await db.query(`
    UPDATE patient_state 
    SET 
      documentos_recibidos = $1,
      campos_faltantes = $2,
      paso_actual = $3,
      updated_at = NOW()
    WHERE chatId = $4
  `, [
    state.documentos_recibidos,
    state.pendingFields,
    state.step,
    chatId
  ])
}

// En webhook, después de procesar imagen:
await syncStateToDB(chatId, state)
userState.set(chatId, state)
```

### Recuperación Automática Post-Reinicio

```javascript
// Cuando bot se reinicia y usuario envía próximo documento

async function webhookImageHandler(chatId, imageUrl) {
  // 1. Cargar estado de BD (puede haber sido guardado desde reinicio anterior)
  let state = userState.get(chatId)
  if (!state) {
    state = await loadUserStateFromDB(chatId)
  }
  
  // 2. Estado está recuperado, continuar flujo normal
  // Usuario no ve ningún problema, documentos no se perdieron
  
  processImage(state, imageUrl)
}
```

### Timeline: Cómo Sería

```
Hora 15:00 - Usuario envía REPROCANN frente
  ↓ Guardado en DB inmediatamente
  Bot dice: "Recibido, mandame el dorso"

Hora 15:01 - Servidor se reinicia
  
Hora 15:02 - Usuario envía REPROCANN dorso
  ↓ Bot carga estado de BD
  Bot ve: "Ah, ya tiene REPROCANN frente, este es dorso"
  Bot procesa ambos juntos
  
Usuario feliz: No notó el reinicio ✅
```

### Beneficios

- ✅ Documentos nunca se pierden
- ✅ Usuarios pueden continuar el flujo después de reinicios
- ✅ Admin tiene historial completo de intentos
- ✅ No hay frustración por "empezar de cero"
- ✅ Trazabilidad completa

### Checklist para BD (Critical)

**ANTES de usar en producción:**
- [ ] Guardar uploads en BD inmediatamente
- [ ] Cargar estado desde BD al iniciar webhook
- [ ] Sincronizar estado después de cada cambio
- [ ] Índices en tablas para búsquedas rápidas
- [ ] Testing: reiniciar servidor con usuarios mid-flow
- [ ] Verificar que documentos no se pierden
- [ ] Verificar que flujo continúa normalmente

### Estimado de Esfuerzo

| Tarea | Tiempo |
|-------|--------|
| Schema BD | 1 hora |
| Persistencia de uploads | 2 horas |
| Sincronización estado | 2 horas |
| Loading en startup | 1 hora |
| Testing robusto | 3-4 horas |
| **Total** | **9-10 horas** |

---

**IMPORTANTE:** Esto es CRÍTICO cuando pasen a BD. Sin esto, volverán a tener problemas con usuarios que pierden documentos.

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
