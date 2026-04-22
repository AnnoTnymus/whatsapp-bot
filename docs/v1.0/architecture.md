# WhatsApp Bot v1.0 - Arquitectura Técnica

## Diagrama General

```
┌─────────────────────────────────────────────────────┐
│                   Usuario en WhatsApp                │
└────────────────┬────────────────────────────────────┘
                 │ Escribe mensaje
                 ↓
┌─────────────────────────────────────────────────────┐
│              GreenAPI (proveedor WhatsApp)           │
│  (procesa mensajes, maneja números, webhook)        │
└────────────────┬────────────────────────────────────┘
                 │ POST /webhook con body JSON
                 ↓
┌─────────────────────────────────────────────────────┐
│        Nuestro Bot (Render.com, Node.js)            │
│  ┌─────────────────────────────────────────────────┐│
│  │ 1. Parse webhook → extraer chatId, mensaje      ││
│  │ 2. Check rate limit                              ││
│  │ 3. Llamar Claude API con:                        ││
│  │    - System prompt (tone + instrucciones)        ││
│  │    - Knowledge base (info del club)              ││
│  │    - Últimos 8 mensajes (contexto)               ││
│  │ 4. Responder con sendMessage de GreenAPI         ││
│  │ 5. Log de todo                                   ││
│  └─────────────────────────────────────────────────┘│
└────────────────┬────────────────────────────────────┘
                 │ POST /sendMessage
                 ↓
┌─────────────────────────────────────────────────────┐
│              GreenAPI (respuesta)                    │
└────────────────┬────────────────────────────────────┘
                 │ Envía respuesta a número
                 ↓
┌─────────────────────────────────────────────────────┐
│              Usuario recibe respuesta                │
└─────────────────────────────────────────────────────┘
```

## Componentes Clave

### 1. Express Server (`app.listen()`)

- Escucha en `PORT` (default 3000)
- Acepta requests HTTP
- Define 3 endpoints:
  - `POST /webhook` — Recibe mensajes de GreenAPI
  - `GET /health` — Metrics para monitoreo
  - `GET /test-claude` — Diagnóstico de API

### 2. Webhook Handler

```javascript
app.post('/webhook', (req, res) => {
  res.send('OK')  // Responder inmediatamente a GreenAPI
  process.nextTick(async () => {
    // Procesar async después de responder
    // Esto es crítico para evitar timeouts en GreenAPI
  })
})
```

**Por qué `res.send('OK')` primero?**
- GreenAPI espera respuesta HTTP en < 5 segundos
- Si procesamos todo sync, se puede timeout
- Respondemos "OK" inmediatamente, luego procesamos async
- Si falla la lógica, GreenAPI ya tiene su ACK

### 3. Conversation History (Map)

```javascript
const conversationHistory = new Map()
// chatId (string) → array de {role, content}
// Mantiene últimos 8 mensajes del usuario
```

**Limite de 8 mensajes:**
- Balancear contexto vs costo de API
- Más mensajes = contexto mejor pero API más cara
- 8 es good balance para chat típico

### 4. System Prompt

Inyectado en cada request a Claude con 3 partes:

1. **ESTILO** — Spanish rioplatense, respuestas cortas para WhatsApp
2. **CONOCIMIENTO_DEL_CLUB** — Inyectado from `knowledge/base.md`
3. **INSTRUCCIONES** — Cómo responder según situación (horarios, genéticas, REPROCANN, etc.)

Tamaño total: ~1.5KB

### 5. Claude API Integration

```javascript
fetch('https://api.anthropic.com/v1/messages', {
  headers: {
    'x-api-key': ANTHROPIC_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: {
    model: 'claude-opus-4-7',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [user message + history],
  },
})
```

**Decisiones:**
- `claude-opus-4-7` — Mejor modelo disponible (mejor razonamiento, mejor español)
- `max_tokens: 300` — ~200-300 palabras = 3-4 líneas de WhatsApp
- Historial en `messages` — Claude mantiene contexto entre turns

### 6. Knowledge Base Injection

`knowledge/base.md` se carga al startup:

```javascript
let knowledgeBase = readFileSync('./knowledge/base.md', 'utf-8')
// Luego inyectada en SYSTEM_PROMPT como string
```

**Ventajas:**
- No requiere fine-tuning
- Actualizable sin redeployar código
- Claude la usa como contexto "authoritative"

**Limitaciones:**
- Total debe ser < 2KB (fits in prompt)
- Si crece mucho, pasar a retrieval system

### 7. GreenAPI Integration

**Enviar mensaje:**
```javascript
POST {GREEN_URL}/waInstance{INSTANCE}/sendMessage/{TOKEN}
Body: { chatId, message }
```

**Descargar imagen (v2.0):**
```javascript
POST {GREEN_URL}/waInstance{INSTANCE}/downloadFile/{TOKEN}
Body: { idMessage }
→ Returns: { result: "url o base64" }
```

**Tipos de mensaje que recibimos:**
```javascript
body.messageData.typeMessage:
  - "textMessage" → cuerpo en textMessageData.textMessage
  - "imageMessage" → ID en idMessage, descargamos con downloadFile
  - "audioMessage" → no soportado (v1.0)
  - etc.
```

## Flujo de Datos en un Webhook

### Input
```json
{
  "typeWebhook": "incomingMessageReceived",
  "senderData": {
    "chatId": "549876543210@c.us",
    "senderName": "Tincho"
  },
  "messageData": {
    "typeMessage": "textMessage",
    "textMessageData": {
      "textMessage": "Hola, cuáles son los horarios?"
    }
  }
}
```

### Procesamiento
1. Parse: `chatId = "549876543210@c.us"`, `message = "Hola, cuáles son los horarios?"`
2. Rate limit check: ¿Menos de 30 mensajes en la última hora?
3. Build messages array:
   ```
   [
     {role: 'user', content: 'Hola, cuáles son los horarios?'}
     // + últimos 7 mensajes de history si existen
   ]
   ```
4. Call Claude:
   ```
   POST https://api.anthropic.com/v1/messages
   system: SYSTEM_PROMPT
   messages: [...]
   max_tokens: 300
   ```
5. Claude responds: `"Hola! Atendemos de lunes a viernes 11-20hs, sábados 12-21hs, domingos 12-19hs 🌿"`
6. Send WhatsApp:
   ```
   POST GreenAPI /sendMessage
   chatId: "549876543210@c.us"
   message: "Hola! Atendemos de..."
   ```
7. Log everything with timestamps

### Output to User
Llega en WhatsApp en 1-3 segundos (típico)

## Decisiones de Arquitectura

### ✅ Por qué Node.js?
- Lightweight, rápido para I/O
- Buen soporte para webhooks
- Fácil de desplegar en serverless (Render)
- npm ecosystem (express, dotenv, node-fetch)

### ✅ Por qué Express y no serverless functions?
- v1.0 con Supabase Edge Functions falló por encoding issues
- Express es más simple y confiable
- Un server tradicional = menos problemas

### ✅ Por qué Render.com?
- Gratuito (5000 horas/mes)
- Auto-deploys desde GitHub
- HTTPS automático
- Logs integrados
- Easy scaling si es necesario

### ⚠️ Cold starts (Render free tier)
- Si inactivo 15 min → server duerme
- Siguiente request = 30-60 seg startup
- Solución (v2.0): UptimeRobot ping cada 5 min

### ✅ Por qué historial en memory Map?
- v1.0 solo requería chat en tiempo real
- Base de datos hubiera sido overkill
- Se pierde con restart pero es aceptable para MVP
- v2.0 puede agregar Supabase si es necesario

### ✅ Por qué max_tokens: 300?
- ~200-300 palabras
- ~3-4 líneas en WhatsApp
- Previene respuestas "emailísticas"
- Barato en tokens
- v1.0 encontró que es muy bajo (se cortan respuestas)

## Monitoreo y Debugging

### Health Endpoint
```
GET /health
→ {
  ok: true,
  uptime: 123,
  model: "claude-opus-4-7",
  threads: 42,
  knowledgeBase: true,
  anthropicKeySet: true,
  ...
}
```

### Logs
Todos los eventos loguean con timestamp ISO:
```
[2026-04-22T15:30:45.123Z] [webhook] De: Tincho (549@c.us) | "Hola"
[2026-04-22T15:30:45.200Z] [claude] Llamando modelo con 1 mensajes
[2026-04-22T15:30:46.100Z] [claude] Respuesta: Hola Tincho!...
[2026-04-22T15:30:46.150Z] [whatsapp] Status: 200 | {"idMessage":"..."}
```

En Render.com, los logs aparecen en el dashboard.

### Common Issues

**401 Unauthorized (Claude)**
- Check `ANTHROPIC_API_KEY` está válida
- Verificar sin caracteres especiales invisibles
- Probar endpoint `/test-claude`

**403 Forbidden (GreenAPI)**
- Check `GREEN_API_TOKEN` es correcto
- Check `GREEN_API_INSTANCE_ID` es correcto
- Verificar webhook URL en GreenAPI dashboard

**Bot no responde**
- Check Render service is running (`/health`)
- Check GreenAPI webhook URL está actualizada
- Check logs en Render dashboard
- Revisar que GreenAPI está enviando webhooks (webhook.site test)

## Costo de Token por Request

Estimación para request típico:

```
Input tokens:
  - System prompt: ~350 tokens
  - Knowledge base: ~300 tokens
  - User message: ~15 tokens
  - History (8 msgs): ~200 tokens
  Total input: ~865 tokens

Output tokens:
  - Typical response: ~80 tokens

Cost (claude-opus-4-7):
  Input: 865 tokens × $3/MTok = $0.0026
  Output: 80 tokens × $15/MTok = $0.0012
  Total: ~$0.004 per request

Monthly (100 messages/day):
  100 × 30 × $0.004 = $12/mes
```

Esto es aceptable para un bot de producción.
