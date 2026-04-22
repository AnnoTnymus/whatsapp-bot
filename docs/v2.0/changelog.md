# WhatsApp Bot v2.0 - Changelog

## Version: 2.0.0 (Planned Release 2026-04-22)

### Overview
v2.0 arregla los 3 issues críticos de v1.0, agrega soporte de imágenes, rate limiting y state management para onboarding.

---

## 🔴 Critical Fixes

### 1. Remove Non-Existent Discount
**Issue:** Knowledge base mencionaba "descuento del 5%" que no existe  
**Status:** ✅ FIXED  
**Changes:**
- `knowledge/base.md` línea 35: "Efectivo (descuento del 5%)" → "Efectivo"

**Impact:** Bot ya no promete descuentos falsos

---

### 2. Increase max_tokens (Fix Response Truncation)
**Issue:** Respuestas se cortaban mid-sentence porque max_tokens: 300 era muy bajo  
**Status:** ✅ FIXED  
**Changes:**
- `index.js` línea 108: `max_tokens: 300` → `max_tokens: 500`
- `index.js` system prompt: Agregada instrucción "Si tu respuesta no entra en 4 líneas, dividí en dos mensajes"

**Impact:** Respuestas completas, nunca cortadas

---

### 3. Rate Limiting (Token Security)
**Issue:** Sin protección contra abuso, alguien puede consumir API quota en segundos  
**Status:** ✅ FIXED  
**Changes:**
- `index.js` línea 15-17: Nuevo `Map<chatId, {count, resetAt}>`
- `index.js` función `checkRateLimit()`: Max 30 mensajes por hora por usuario
- `index.js` webhook: Antes de procesar, check rate limit
- Si excede: responder "Recibimos muchos mensajes..." y no llamar a Claude

**Impact:** Seguridad contra DoS, protege API quota

**Technical:**
```javascript
const RATE_LIMIT = 30
const RATE_WINDOW = 60 * 60 * 1000  // 1 hora

function checkRateLimit(chatId) {
  // Retorna true si usuario puede enviar mensaje
  // Retorna false si llegó a 30 en la última hora
  // Auto-reset cada hora
}
```

---

## 🟢 New Features

### 4. Image Message Support
**Feature:** El bot ahora procesa imágenes (REPROCANN, DNI, etc.)  
**Status:** ✅ IMPLEMENTED  
**Changes:**
- `index.js` función nueva `downloadImage()`: Descarga imagen de GreenAPI
- `index.js` webhook: Nuevo branch para `msgType === 'imageMessage'`
- `index.js` webhook: Parse `idMessage` e invoke `downloadImage()`
- `index.js` webhook: Log "Imagen recibida"

**Technical:**
```javascript
const idMessage = body.messageData?.idMessage
const imageUrl = await downloadImage(idMessage)
// imageUrl es URL pública de la imagen descargada
```

**Impact:** Ya no se ignoran imágenes, flujo completo con soporte para documentos

---

### 5. Claude Vision (Image Analysis)
**Feature:** Claude analiza imágenes para validar REPROCANN/DNI  
**Status:** ✅ IMPLEMENTED  
**Changes:**
- `index.js` función nueva `analyzeImageWithClaude()`: Llama a Claude con image block
- Sistema prompt personalizado según user state:
  - Si esperando REPROCANN: "Analizá como REPROCANN"
  - Si esperando DNI: "Analizá como DNI"
  - Si inicial: "¿Qué es esto?"

**Technical:**
```javascript
{
  type: 'image',
  source: {
    type: 'url',
    url: imageUrl
  }
},
{
  type: 'text',
  text: 'Analizá esta imagen para el flujo de afiliación'
}
```

**Impact:** Validación automática de documentos, flujo más smart

---

### 6. User State Tracking (Onboarding Flow)
**Feature:** El bot sabe en qué punto del onboarding está cada usuario  
**Status:** ✅ IMPLEMENTED  
**Changes:**
- `index.js` línea 16: Nuevo `Map<chatId, {step, nombre}>`
- States: `'inicio'` → `'esperando_dni'` → `'completado'`
- Al recibir imagen, avanza el state
- Si estado es `'completado'`, notifica admin

**Technical:**
```javascript
userState.set(chatId, {
  step: 'esperando_dni',  // o 'completado'
  nombre: sender
})
```

**Impact:** Bot personaliza respuestas según contexto del usuario

---

### 7. Admin Notifications (Completion Alert)
**Feature:** Cuando usuario completa (REPROCANN + DNI), admin recibe notificación  
**Status:** ✅ IMPLEMENTED  
**Changes:**
- `.env`: Nueva variable `ADMIN_WHATSAPP` (número del admin)
- `index.js` función nueva `notifyAdmin()`: Envía mensaje al admin
- `index.js` webhook: Al alcanzar `step === 'completado'`, llama `notifyAdmin()`

**Format del mensaje admin:**
```
📋 Nuevo lead listo:
👤 Nombre del usuario
📱 Número de teléfono
✅ Reprocann + DNI recibidos
```

**Impact:** Admin se enteral instant cuando alguien completa onboarding, puede seguir

---

## 📋 Configuration Changes

### New Environment Variable
```bash
ADMIN_WHATSAPP=549XXXXXXXXXX@c.us
```

Set this to the WhatsApp number (with country code) of the admin who should receive notifications.

Format: `[country][area][number]@c.us`  
Example: `549876543210@c.us` (Argentina)

---

## 📊 Comparison: v1.0 vs v2.0

| Feature | v1.0 | v2.0 |
|---------|------|------|
| **Texto** | ✅ | ✅ |
| **Horarios** | ✅ | ✅ |
| **Genéticas** | ✅ | ✅ |
| **REPROCANN info** | ✅ | ✅ |
| **Imágenes** | ❌ | ✅ |
| **Claude Vision** | ❌ | ✅ |
| **Rate limiting** | ❌ | ✅ |
| **Estado usuario** | ❌ | ✅ |
| **Admin notif** | ❌ | ✅ |
| **Descuento correcto** | ❌ | ✅ |
| **Respuestas completas** | ❌ | ✅ |
| **max_tokens** | 300 | 500 |

---

## 🧪 Testing Checklist

- [ ] El bot NO menciona descuento en efectivo
- [ ] Preguntar algo que requiera > 4 líneas → respuesta completa (no truncada)
- [ ] Enviar 31 mensajes en < 1 hora → recibir "limite de mensajes"
- [ ] Enviar imagen REPROCANN → bot responde (no ignorado)
- [ ] Estado avanza: inicial → esperando_dni → completado
- [ ] Al completar: admin recibe notificación
- [ ] Logs muestran timestamps y detalles

---

## 🚀 Deployment

1. Update code locally
2. `git add .`
3. `git commit -m "v2.0: fixes críticos + soporte de imágenes"`
4. `git push origin main`
5. Render auto-deploys (1-2 min)
6. Test with real messages

---

## 📝 Documentation

- `docs/v1.0/release-notes.md` — v1.0 status, issues found
- `docs/v1.0/architecture.md` — Technical deep dive
- `docs/v1.0/conversation-test.md` — Real chat with Tincho, issues identified
- `docs/v2.0/changelog.md` — This file (v2.0 changes)

---

## 💰 Cost Impact

v1.0: ~$12/mes (estimado)  
v2.0: ~$15/mes (Claude Vision adds ~$3/mes for image analysis)

Acceptable trade-off for feature completeness.

---

## 🔮 Future (v3.0+)

- [ ] Persistencia a Supabase (historial queries)
- [ ] UptimeRobot integration (prevent cold starts)
- [ ] Database onboarding state (survive restarts)
- [ ] Webhook verification (HMAC signing)
- [ ] Monitoring/alerting (Grafana, Sentry)
- [ ] Multi-language support
- [ ] Admin dashboard (web UI para ver leads)
