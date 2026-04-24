import 'dotenv/config.js'
import { timingSafeEqual } from 'crypto'
import express from 'express'
import fetch from 'node-fetch'
import { readFileSync } from 'fs'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { SKILL_NAMES, invokeSkill, parseSkillMarker } from './skills.js'

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

// Security hardening by Codex (GPT-5) on 2026-04-24:
// production credentials must come from env vars, never from source defaults.
const GREEN_URL = process.env.GREEN_API_URL ?? 'https://7107.api.greenapi.com'
const GREEN_INSTANCE = process.env.GREEN_API_INSTANCE_ID?.trim()
const GREEN_TOKEN = process.env.GREEN_API_TOKEN?.trim()
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY?.replace(/[^\x20-\x7E]/g, '').trim()
const MODEL = 'claude-opus-4-7'
const RESEND_API_KEY = process.env.RESEND_API_KEY
const ADMIN_EMAIL = process.env.ADMIN_EMAIL
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN?.trim()
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET?.trim()
const REQUIRE_WEBHOOK_SECRET = process.env.REQUIRE_WEBHOOK_SECRET === 'true' || process.env.NODE_ENV === 'production'
const ENABLE_TEST_ROUTES = process.env.ENABLE_TEST_ROUTES === 'true'
const ENABLE_FOLLOWUP_CRON = process.env.ENABLE_FOLLOWUP_CRON !== 'false'
const STT_FUNCTION_URL = process.env.STT_FUNCTION_URL?.trim()
const STT_SHARED_SECRET = process.env.STT_SHARED_SECRET?.trim()
const GREEN_API_CONFIGURED = Boolean(GREEN_INSTANCE && GREEN_TOKEN)
const STT_CONFIGURED = Boolean(STT_FUNCTION_URL && STT_SHARED_SECRET)

// Supabase client (v4.0 — persistence)
// Server-side Supabase auth tightened by Codex (GPT-5) on 2026-04-24:
// the bot only uses service_role, never anon, for patient/CRM data writes.
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVER_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
const SUPABASE_USING_SERVICE_ROLE = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
const supabase = SUPABASE_URL && SUPABASE_SERVER_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVER_KEY)
  : null

const conversationHistory = new Map()  // Still in-memory (reset hourly)
const rateLimits = new Map()           // Still in-memory (reset hourly)
const userState = new Map()            // ⚠️ Legacy: replaced by patient_state table

const RATE_LIMIT = 30
const RATE_WINDOW = 60 * 60 * 1000
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP

// v4.0: Dynamic token allocation (Fase 4)
const TOKEN_BUDGET = {
  confirmation: 50,        // "✅ Recibido. Mandame el dorso."
  request_document: 100,   // "Aún necesito: DNI frente, REPROCANN dorso 📸"
  request_field: 80,       // "Ahora necesito tu provincia. Contame 👇"
  success: 120,           // "¡Listo! Te contactamos pronto 🌿"
  error: 150,             // Mensajes de error con instrucciones
  explanation: 250,       // Respuestas generales sobre el club (askClaude)
  followup: 120,          // Mensajes de seguimiento automático
  detect: 100,            // Document type detection
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null

// Auth helpers added by Codex (GPT-5) on 2026-04-24 so admin/test routes and
// public webhooks don't stay open in production.
function safeCompare(expected, actual) {
  if (!expected || !actual) return false
  const expectedBuf = Buffer.from(expected)
  const actualBuf = Buffer.from(actual)
  if (expectedBuf.length !== actualBuf.length) return false
  return timingSafeEqual(expectedBuf, actualBuf)
}

function getBearerToken(headerValue) {
  if (!headerValue) return null
  const match = headerValue.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

function tokenMatches(expected, ...candidates) {
  return candidates.some(candidate => safeCompare(expected, candidate))
}

function requireAdminAccess(req, res) {
  if (!ADMIN_API_TOKEN) {
    res.status(503).json({ ok: false, error: 'ADMIN_API_TOKEN no configurado' })
    return false
  }

  const adminHeader = req.get('x-admin-token')?.trim()
  const bearerToken = getBearerToken(req.get('authorization'))
  if (!tokenMatches(ADMIN_API_TOKEN, adminHeader, bearerToken)) {
    res.status(401).json({ ok: false, error: 'unauthorized' })
    return false
  }

  return true
}

function isWebhookAuthorized(req) {
  if (!REQUIRE_WEBHOOK_SECRET && !WEBHOOK_SECRET) return true
  if (!WEBHOOK_SECRET) return false

  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : null
  const headerToken = req.get('x-webhook-secret')?.trim()
  const bearerToken = getBearerToken(req.get('authorization'))
  return tokenMatches(WEBHOOK_SECRET, queryToken, headerToken, bearerToken)
}

function ensureTestRoutesEnabled(req, res) {
  if (!ENABLE_TEST_ROUTES) {
    res.status(404).json({ ok: false, error: 'disabled' })
    return false
  }

  return requireAdminAccess(req, res)
}

function checkRateLimit(chatId) {
  const now = Date.now()
  const entry = rateLimits.get(chatId) || { count: 0, resetAt: now + RATE_WINDOW }
  if (now > entry.resetAt) {
    rateLimits.set(chatId, { count: 1, resetAt: now + RATE_WINDOW })
    return true
  }
  if (entry.count >= RATE_LIMIT) return false
  entry.count++
  rateLimits.set(chatId, entry)
  return true
}

// ========== SUPABASE PERSISTENCE (v4.0) ==========

async function loadState(chatId) {
  try {
    if (!supabase) {
      log('supabase', `⚠️ Supabase NOT CONFIGURED - returning default state`)
      return {
        step: 'inicio',
        nombre: null,
        documentos: { dni: { frente: null, dorso: null }, reprocann: { frente: null, dorso: null } },
        collectedData: {},
        pendingFields: [],
      }
    }

    const { data, error } = await supabase
      .from('patient_state')
      .select('*')
      .eq('chat_id', chatId)
      .single()

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = row not found (expected for new users)
      log('supabase', `❌ ERROR loading state for ${chatId}: ${error.message}`)
    }

    if (!data) {
      return {
        step: 'inicio',
        nombre: null,
        nombre_completo: null,
        documentos: { dni: { frente: null, dorso: null }, reprocann: { frente: null, dorso: null } },
        collectedData: {},
        pendingFields: [],
      }
    }

    return {
      step: data.step,
      nombre: data.nombre,
      nombre_completo: data.collected_data?.nombre_completo || data.nombre || null,
      documentos: data.documentos,
      collectedData: data.collected_data || {},
      pendingFields: data.pending_fields,
      last_message_at: data.last_message_at,
      last_greeting_at: data.last_greeting_at,
      raw_name_attempt: data.collected_data?.raw_name_attempt || null,
    }
  } catch (e) {
    log('supabase', `❌ Exception loading state for ${chatId}: ${e.message}`)
    return {
      step: 'inicio',
      nombre: null,
      nombre_completo: null,
      documentos: { dni: { frente: null, dorso: null }, reprocann: { frente: null, dorso: null } },
      collectedData: {},
      pendingFields: [],
    }
  }
}

async function saveState(chatId, state) {
  try {
    if (!supabase) {
      log('supabase', `⚠️ Supabase NOT CONFIGURED - State NOT saved for ${chatId}`)
      return
    }

    // Store nombre_completo + raw_name_attempt inside collected_data JSON
    // (no dedicated column on patient_state — keeps the schema stable)
    const collectedData = {
      ...(state.collectedData || {}),
      ...(state.nombre_completo ? { nombre_completo: state.nombre_completo } : {}),
      ...(state.raw_name_attempt ? { raw_name_attempt: state.raw_name_attempt } : {}),
    }

    const result = await supabase.from('patient_state').upsert(
      {
        chat_id: chatId,
        nombre: state.nombre,
        step: state.step,
        documentos: state.documentos,
        collected_data: collectedData,
        pending_fields: state.pendingFields,
        last_message_at: state.last_message_at,
        last_greeting_at: state.last_greeting_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'chat_id' }
    )

    if (result.error) {
      log('supabase', `❌ ERROR saving state for ${chatId}: ${result.error.message}`)
    } else {
      log('supabase', `✅ State saved for ${chatId} (step=${state.step})`)
    }
  } catch (e) {
    log('supabase', `❌ Exception saving state for ${chatId}: ${e.message}`)
  }
}

async function loadHistory(chatId) {
  if (!supabase) return []
  try {
    const { data } = await supabase
      .from('conversation_history')
      .select('messages')
      .eq('chat_id', chatId)
      .single()

    return data?.messages || []
  } catch {
    return []
  }
}

async function saveHistory(chatId, messages) {
  if (!supabase) return
  try {
    await supabase.from('conversation_history').upsert(
      {
        chat_id: chatId,
        messages: messages.slice(-8),  // Keep last 8 messages only
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'chat_id' }
    )
  } catch (e) {
    log('supabase', `Error saving history for ${chatId}: ${e.message}`)
  }
}

// ========== END SUPABASE HELPERS ==========

let knowledgeBase = ''
try {
  knowledgeBase = readFileSync('./knowledge/base.md', 'utf-8')
  console.log('[startup] Knowledge base loaded:', knowledgeBase.length, 'chars')
} catch {
  console.log('[startup] No knowledge/base.md, usando info generica')
}

const SYSTEM_PROMPT = `Sos el asistente de WhatsApp del club cannábico. Tu rol principal es ATENCIÓN AL CLIENTE: responder dudas, informar sobre el club, productos, horarios, REPROCANN.

SOLO guiás el proceso de afiliación cuando el usuario lo pide explícitamente.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TONO (muy importante, seguí al pie de la letra):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Cordial, cálido y profesional. Como un empleado amable del club.
- Español rioplatense natural — usá "vos", "dale", "genial", "claro".
- PROHIBIDO: nunca uses "boludo" ni "pibe" ni "loco".
- "Che" y "dale" solo en respuestas casuales off-topic (stickers, audios, bromas). En consultas reales (horarios, precios, afiliación, REPROCANN) usá tono cordial-informativo SIN "che".
- Emojis con moderación (1-2 por mensaje máximo).
- Respuestas cortas para WhatsApp (máx 3-4 líneas).
- Nunca hagas listas largas ni texto tipo email.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONOCIMIENTO DEL CLUB:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${knowledgeBase}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CÓMO RESPONDER SEGÚN LA SITUACIÓN:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Si saluda (hola, buenas, etc.):
→ Saludá cordialmente y preguntá en qué podés ayudar. NO pidas documentos. NO menciones afiliación a menos que te pregunten.

Si pregunta por horarios, dirección, ubicación:
→ Respondé brevemente con la info del knowledge base.

Si pregunta por genéticas, productos, stock:
→ Contá brevemente las opciones disponibles y su perfil de efecto (indica/sativa/híbrida).

Si pregunta por REPROCANN (qué es, cómo tramitarlo):
→ Explicá que es el registro oficial para uso medicinal, se tramita en argentina.gob.ar/reprocann, es gratis.

Si pide hablar con una persona:
→ "Dale, te paso con alguien del club enseguida 👋 Puede demorar un ratito."

Si manda algo raro, fuera de tema (chistes, stickers random, mensajes sin sentido):
→ Respondé casualmente (acá SÍ podés usar "che") y redirigí cordial: "¿En qué te puedo ayudar con el club?"

Si no sabés algo con certeza:
→ "Eso es mejor consultarlo directamente con alguien del club."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTENCIÓN DE AFILIACIÓN — MARCADOR ESPECIAL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Si el usuario expresa EXPLÍCITAMENTE que quiere afiliarse, hacerse socio, anotarse, inscribirse, comenzar la membresía, o frases similares:

1. Respondé cordialmente dándole la bienvenida al proceso.
2. Explicale en 1-2 líneas que vas a necesitar su DNI y certificado REPROCANN.
3. Al FINAL de tu mensaje (después de todo), agregá en una línea aparte exactamente este marcador: [[AFILIAR]]

El marcador [[AFILIAR]] NO lo ve el usuario — lo procesa el sistema para iniciar el flujo de documentos.

Ejemplo de respuesta correcta ante "quiero afiliarme":
"¡Bienvenido/a! 🌿 Para afiliarte necesito que me pases tu DNI y el certificado REPROCANN. Arrancamos?
[[AFILIAR]]"

NO pongas [[AFILIAR]] si el usuario solo pregunta "¿cómo funciona la afiliación?" o "¿qué necesito para ser socio?" sin decir que QUIERE hacerlo ahora. En ese caso solo explicale los requisitos.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SKILLS ESPECIALIZADAS — MARCADORES [[SKILL:nombre]]:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tenés 3 skills (asistentes expertos) que podés invocar agregando un marcador al final de tu respuesta. El sistema detecta el marcador, invoca al experto, y su respuesta reemplaza la tuya:

1. **[[SKILL:legal_faq]]** — Consultas sobre ley, marco legal, compliance, tenencia, Ley 27.350, REPROCANN desde lo legal, autocultivo legal, clubes cannábicos legales, Arriola, causas judiciales.
   Ejemplos: "¿es legal tener plantas en casa?", "¿qué ley regula el cannabis?", "¿me pueden detener por tener aceite?"

2. **[[SKILL:reprocann_guide]]** — Guía paso a paso del TRÁMITE REPROCANN (cómo hacerlo, requisitos, médicos, tiempos, costos, renovación, modalidades).
   Ejemplos: "¿cómo arranco con el REPROCANN?", "¿cuánto tarda el trámite?", "¿qué médico me sirve?", "¿qué documentos piden?"

3. **[[SKILL:genetics_expert]]** — Asesoramiento sobre CEPAS/genéticas según efecto buscado (dormir, dolor, creatividad, socializar), diferencias indica/sativa/híbrida, THC/CBD, terpenos, tolerancia.
   Ejemplos: "¿qué genética me recomendás para dormir?", "¿cuál es más suave?", "diferencia entre indica y sativa"

CÓMO USAR LOS MARCADORES:
- Si detectás que la consulta encaja con una skill, podés dar una mini-intro de 1 línea ("Dale, te paso info") y en LÍNEA APARTE al final poné [[SKILL:nombre]].
- Si invocás una skill, TU respuesta se reemplaza por la del experto — no duplicá info, mejor dejá que el experto responda.
- Para saludos, datos del club, horarios, afiliación, o temas que NO son legales/REPROCANN/genéticas, NO invoques skill — respondé vos directo.
- No inventés skills que no existan. Solo: legal_faq, reprocann_guide, genetics_expert.
- Nunca menciones los marcadores al usuario — son invisibles para él.

OFRECIMIENTO PROACTIVO (IMPORTANTE):
Cuando el usuario se acaba de presentar con su nombre y preguntás "¿en qué te puedo ayudar?", podés mencionar brevemente los 3 temas disponibles. Ejemplo: "Puedo ayudarte con info legal del cannabis, el trámite REPROCANN, o consejos de genéticas según lo que busques 🌿 ¿Por dónde arrancamos?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGLAS FIJAS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Nunca des una dirección exacta (solo zona: "Palermo").
- Nunca prometas cosas que no podés asegurar.
- Si ya hablaron antes, recordá el contexto.
- Si tu respuesta no entra en 4 líneas, cortá natural — nunca a mitad de concepto.`

function log(tag, ...args) {
  console.log(`[${new Date().toISOString()}] [${tag}]`, ...args)
}

// v4.2: Métricas de GreenAPI — límite de correspondents, errores, último 466
// NOTA: el plan "Developer" (gratuito) de GreenAPI permite SOLO 3 CHATS (números distintos)
// por mes. Esos 3 slots se auto-asignan a los primeros 3 números que contactan al bot —
// no hay forma de whitelistear ni elegir. Cuando llega un 4º número, GreenAPI acepta el
// incoming (webhook) pero rechaza el outgoing con HTTP 466 "CORRESPONDENTS_QUOTE_EXCEEDED".
// Única solución: upgrade al plan pago ("Business") en https://console.green-api.com
// Referencias:
//   https://green-api.com/en/docs/api/466-error-example-body/
//   https://green-api.com/en/docs/api/receiving/notifications-format/QuotaExceeded/
//   https://green-api.com/en/docs/news/2024/05/20/
const greenApiStats = {
  sent: 0,
  failed: 0,
  quotaExceeded: false,
  quotaExceededAt: null,
  rejectedChatIds: [],  // chatIds que intentaron contactar pero no pudimos responder
  lastError: null,
  lastErrorAt: null,
}

async function sendWhatsAppMessage(chatId, message) {
  if (!GREEN_API_CONFIGURED) {
    log('whatsapp', 'GreenAPI no configurado — no se puede enviar mensaje')
    return { ok: false, reason: 'not_configured' }
  }

  const url = `${GREEN_URL}/waInstance${GREEN_INSTANCE}/sendMessage/${GREEN_TOKEN}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message }),
    })
    const text = await res.text()

    // GreenAPI devuelve 466 cuando se agota la cuota mensual del plan
    // El payload trae algo como: {"invokeStatus":{"method":"sendmessage","used":250,"total":0,"status":"QUOTE_ALLOWED_EXCEEDED"}}
    if (res.status === 466 || /QUOTE_ALLOWED_EXCEEDED|quotaExceeded/i.test(text)) {
      greenApiStats.quotaExceeded = true
      greenApiStats.quotaExceededAt = new Date().toISOString()
      greenApiStats.failed++
      greenApiStats.lastError = `QUOTA/WHITELIST (466): ${text.substring(0, 150)}`
      greenApiStats.lastErrorAt = new Date().toISOString()

      // Guardar chatId rechazado para que el admin sepa a quién whitelistear
      if (chatId && !greenApiStats.rejectedChatIds.includes(chatId)) {
        greenApiStats.rejectedChatIds.push(chatId)
        if (greenApiStats.rejectedChatIds.length > 20) greenApiStats.rejectedChatIds.shift()
      }

      log('whatsapp', `🚨 GREENAPI 466 CORRESPONDENTS_QUOTE_EXCEEDED — chat=${chatId} FUERA del cupo de 3 chats/mes del plan Developer. Única solución: upgrade a Business en console.green-api.com. Body: ${text.substring(0, 200)}`)

      await notifyAdminQuotaExceeded(text, chatId)
      return { ok: false, reason: 'quota_or_whitelist', status: res.status }
    }

    if (!res.ok) {
      greenApiStats.failed++
      greenApiStats.lastError = `HTTP ${res.status}: ${text.substring(0, 150)}`
      greenApiStats.lastErrorAt = new Date().toISOString()
      log('whatsapp', `❌ Envío falló (${res.status}) chat=${chatId}: ${text.substring(0, 150)}`)
      return { ok: false, reason: 'http_error', status: res.status }
    }

    greenApiStats.sent++
    // Si venimos de cuota agotada y ahora funciona, limpiar el flag
    if (greenApiStats.quotaExceeded) {
      greenApiStats.quotaExceeded = false
      log('whatsapp', `✅ Cuota restablecida, enviando de nuevo`)
    }
    log('whatsapp', `Status: ${res.status} | ${text.substring(0, 80)}`)
    return { ok: true, status: res.status }
  } catch (e) {
    greenApiStats.failed++
    greenApiStats.lastError = `Exception: ${e.message}`
    greenApiStats.lastErrorAt = new Date().toISOString()
    log('whatsapp', `Error al enviar: ${e.message}`)
    return { ok: false, reason: 'exception' }
  }
}

// Alerta al admin cuando GreenAPI rechaza un envío (466). Causas posibles:
//  1) número no está en la whitelist del plan developer (más común)
//  2) cuota mensual agotada del plan
// Throttled: 1 alerta por hora para no spamear.
let lastQuotaAlertAt = 0
async function notifyAdminQuotaExceeded(rawBody, rejectedChatId) {
  const now = Date.now()
  if (now - lastQuotaAlertAt < 60 * 60 * 1000) return  // 1 alerta por hora max
  lastQuotaAlertAt = now

  const subject = `🚨 GreenAPI rechazó envío (HTTP 466) — chat ${rejectedChatId || 'N/A'}`
  const body = `GreenAPI devolvió 466 "CORRESPONDENTS_QUOTE_EXCEEDED".\n\nCAUSA: el plan "Developer" (gratuito) de GreenAPI permite SOLO 3 CHATS distintos por mes. Los primeros 3 números que contactaron al bot ocuparon los 3 slots. Cualquier nuevo número queda fuera hasta el reset mensual.\n\nChat afectado (fuera de cupo): ${rejectedChatId || 'desconocido'}\n\nACCIÓN: upgradeá al plan pago "Business" en https://console.green-api.com — no hay whitelist manual en el plan gratuito, es auto-asignación por orden de llegada.\n\nÚltimos rechazados: ${greenApiStats.rejectedChatIds.slice(-5).join(', ') || 'ninguno'}\n\nRaw: ${rawBody?.substring(0, 300) || 'sin detalle'}`

  if (resend && ADMIN_EMAIL) {
    try {
      await resend.emails.send({
        from: 'Bot Club <onboarding@resend.dev>',
        to: ADMIN_EMAIL,
        subject,
        html: `<h2>${subject}</h2><pre>${body}</pre>`,
      })
      log('admin', `📧 Alerta de cuota enviada a ${ADMIN_EMAIL}`)
    } catch (e) {
      log('admin', `Error enviando alerta de cuota: ${e.message}`)
    }
  } else {
    log('admin', `⚠️ Quota exceeded pero no hay ADMIN_EMAIL/resend configurado para alertar`)
  }
}

async function downloadImage(idMessage, chatId) {
  if (!GREEN_API_CONFIGURED) {
    log('image', 'GreenAPI no configurado — no se puede descargar imagen')
    return null
  }

  const url = `${GREEN_URL}/waInstance${GREEN_INSTANCE}/downloadFile/${GREEN_TOKEN}`
  log('image', `Intentando descargar: ${idMessage} (chat: ${chatId})`)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idMessage, chatId }),
    })
    log('image', `Respuesta status: ${res.status}`)
    const data = await res.json()
    log('image', `Respuesta JSON: ${JSON.stringify(data).substring(0, 200)}`)

    if (data.result) {
      log('image', `Descargada exitosamente: ${idMessage}`)
      return data.result
    }
    log('image', `Error descargando - respuesta: ${JSON.stringify(data)}`)
    return null
  } catch (e) {
    log('image', `Error al descargar: ${e.message}`)
    return null
  }
}

// Campos críticos del REPROCANN. Si Vision logró extraerlos, no molestamos al usuario.
// Si falta alguno, lo pedimos por texto con un mensaje específico.
const REPROCANN_REQUIRED = [
  { key: 'nombre', label: 'tu nombre completo', path: d => d?.nombre },
  { key: 'dni', label: 'tu número de DNI', path: d => d?.dni },
  { key: 'provincia', label: 'tu provincia', path: d => d?.ubicacion?.provincia },
  { key: 'vencimiento', label: 'la fecha de vencimiento de tu REPROCANN', path: d => d?.tramite?.fecha_vencimiento },
]

function getMissingFields(reprocannData) {
  return REPROCANN_REQUIRED.filter(f => !f.path(reprocannData))
}

async function detectImage(imageUrl) {
  if (!ANTHROPIC_KEY) {
    log('detect', 'ANTHROPIC_KEY no configurada, usando detección simple')
    return { tipo: 'REPROCANN', ambosSides: false }
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: TOKEN_BUDGET.detect,  // v4.0: dynamic
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'url', url: imageUrl },
              },
              {
                type: 'text',
                text: `TAREA: Detectar qué tipo de documento es esta imagen.
Retorna SOLO este JSON, sin explicación, sin markdown:
{
  "tipo": "DNI" | "REPROCANN" | "DOCUMENTO_EXTRANJERO" | "OTRO",
  "ambosSides": true | false,
  "pais": "Argentina" | "Uruguay" | "Paraguay" | "otro",
  "valido": true | false
}

INSTRUCCIONES:

1. DNI ARGENTINO = color azul, formato RENAPER moderno, escudo + "Ministerio del Interior", tiene CUIT al dorso
   → tipo="DNI", pais="Argentina"

2. CÉDULA URUGUAYA/PARAGUAYA/BRASILEÑA, pasaporte, licencia, visa
   → tipo="DOCUMENTO_EXTRANJERO"

3. REPROCANN = certificado oficial argentino, menciona "REPROCANN" o "AUTORIZACIÓN" + cannabis/medicinal
   → tipo="REPROCANN"

4. Si NO es ninguno de los anteriores (foto de persona, objeto, paisaje, sticker, etc)
   → tipo="OTRO"

5. CAMPO "valido" — MUY IMPORTANTE:
   → valido=true SIEMPRE que puedas identificar QUÉ TIPO de documento es, AUNQUE esté un poco borroso o con reflejos. El criterio es: ¿puedo leer los datos principales? Si sí → valido=true.
   → valido=false SOLO si la imagen es tan ilegible que no podés ni identificar el tipo de documento. Sé PERMISIVO — preferí decir "valido=true" si tenés dudas.

6. Si dudás entre DNI argentino y extranjero por baja calidad, preferí tipo="DNI" (después se verifica al extraer los datos).`,
              },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      log('detect', `Error detectando (status ${res.status}), asumiendo REPROCANN`)
      return { tipo: 'REPROCANN', ambosSides: false, pais: null, valido: true }
    }

    const data = await res.json()
    const text = data.content[0].text.trim()

    // Parse JSON robustly
    let json
    try {
      json = JSON.parse(text)
    } catch {
      // Si no es JSON válido, asumir REPROCANN
      log('detect', `JSON parse error, asumiendo REPROCANN: ${text.substring(0, 50)}`)
      return { tipo: 'REPROCANN', ambosSides: false, pais: null, valido: true }
    }

    log('detect', `Detectado: tipo=${json.tipo}, ambosSides=${json.ambosSides}, valido=${json.valido}, pais=${json.pais}`)
    return {
      tipo: json.tipo || 'REPROCANN',
      ambosSides: json.ambosSides || false,
      pais: json.pais || null,
      valido: json.valido !== false, // true by default
    }
  } catch (e) {
    log('detect', `Error detectando imagen: ${e.message}, asumiendo REPROCANN`)
    return { tipo: 'REPROCANN', ambosSides: false, pais: null, valido: true }
  }
}

async function analyzeImageWithClaude(imageUrl, chatId) {
  if (!ANTHROPIC_KEY) {
    log('claude', 'ANTHROPIC_KEY no configurada para análisis de imagen')
    return null
  }

  const state = userState.get(chatId) || {}
  const systemMsg = state.step === 'esperando_reprocann_dorso'
    ? 'Di SOLO: "✅ Recibí el dorso."'
    : state.step === 'completando_datos'
    ? 'Di SOLO: "Procesando datos."'
    : state.step === 'esperando_dni'
    ? 'Di SOLO: "✅ Recibí tu DNI."'
    : 'Di SOLO: "✅ Recibido." (máx 1 línea, nada más)'

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: TOKEN_BUDGET.confirmation,  // v4.0: dynamic
        system: systemMsg,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'url',
                  url: imageUrl,
                },
              },
              {
                type: 'text',
                text: 'Analizá.',
              },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      log('claude', `Error analizando imagen: ${err.substring(0, 150)}`)
      return '✅ Recibido'
    }

    const data = await res.json()
    const reply = data.content[0].text.trim()
    log('claude', `Análisis: ${reply.substring(0, 60)}`)
    return reply
  } catch (e) {
    log('claude', `Excepción analizando imagen: ${e.message}`)
    return '✅ Recibido'
  }
}

async function extractDocumentData(imageUrl, docType) {
  if (!ANTHROPIC_KEY) return null

  const prompts = {
    DNI: `Extrae del DNI: nombre, apellido, número de documento, fecha de nacimiento, género, domicilio.
Retorna SOLO JSON sin explicaciones: {"tipo":"DNI","nombre":"","apellido":"","documento":"","fecha_nacimiento":"","genero":"","domicilio":""}`,
    REPROCANN: `Extrae TODO lo que veas del REPROCANN. Si no ves un dato, usa null, no cadena vacía.
Busca especialmente:
- Nombre completo
- DNI / Número de documento
- Provincia, departamento, localidad, dirección, código postal
- Estado (autorizado, vigente, vencido)
- Tipo de paciente (autocultivo, productor, etc)
- Cantidad plantas permitidas
- Límites transporte (gramos, cantidad)
- ID/Número de trámite
- Fechas (emisión, vencimiento)
- Ley/Resolución

IMPORTANTE: Sé flexible. Si ves "20 plantas" escribe 20, si ves "30g" escribe "30g". No dejes campos vacíos si ves algo relacionado.

Retorna JSON válido (null si no aparece, no cadenas vacías):
{
  "tipo": "REPROCANN",
  "nombre": null,
  "dni": null,
  "ubicacion": {"provincia": null, "departamento": null, "localidad": null, "direccion": null, "codigo_postal": null},
  "autorizacion": {"estado": null, "tipo": null, "plantas": null, "transporte": null},
  "tramite": {"id": null, "fecha_emision": null, "fecha_vencimiento": null},
  "ley": null
}`
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: TOKEN_BUDGET.explanation,  // v4.0: extract data needs full response
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'url', url: imageUrl },
              },
              {
                type: 'text',
                text: prompts[docType] || prompts.DNI,
              },
            ],
          },
        ],
      }),
    })

    if (!res.ok) return null

    const data = await res.json()
    let text = data.content[0].text.trim()

    // Limpiar backticks si Claude devuelve markdown
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

    let json
    try {
      json = JSON.parse(text)
    } catch {
      log('extract', `JSON parse error in ${docType}, retornando null`)
      return null
    }

    log('extract', `Datos extraídos de ${docType}: ${text.substring(0, 60)}`)
    return json
  } catch (e) {
    log('extract', `Error extrayendo datos: ${e.message}`)
    return null
  }
}

async function extractReprocannData(imageUrls) {
  if (!ANTHROPIC_KEY) return null

  const urlArray = Array.isArray(imageUrls) ? imageUrls : [imageUrls]
  const prompt = `Extrae TODO lo que veas del REPROCANN. Si no ves un dato, usa null.
Busca: Nombre, DNI, Provincia, localidad, dirección, Estado, Tipo de paciente, Plantas, Transporte, ID Trámite, Fecha vencimiento.
Sé flexible con formatos (ej: "20 plantas" → 20, "30g" → "30g").

Retorna JSON válido:
{
  "tipo": "REPROCANN",
  "nombre": null,
  "dni": null,
  "ubicacion": {"provincia": null, "departamento": null, "localidad": null, "direccion": null, "codigo_postal": null},
  "autorizacion": {"estado": null, "tipo": null, "plantas": null, "transporte": null},
  "tramite": {"id": null, "fecha_emision": null, "fecha_vencimiento": null},
  "ley": null
}`

  try {
    const content = [
      ...urlArray.map(url => ({
        type: 'image',
        source: { type: 'url', url },
      })),
      {
        type: 'text',
        text: prompt,
      },
    ]

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: TOKEN_BUDGET.explanation,  // v4.0: extract data needs full response
        messages: [
          {
            role: 'user',
            content,
          },
        ],
      }),
    })

    if (!res.ok) return null

    const data = await res.json()
    let text = data.content[0].text.trim()

    // Limpiar backticks si Claude devuelve markdown
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

    let json
    try {
      json = JSON.parse(text)
    } catch {
      log('extract', `JSON parse error, retornando null: ${text.substring(0, 80)}`)
      return null
    }

    log('extract', `Datos extraídos de ${urlArray.length} imagen(s) REPROCANN`)
    return json
  } catch (e) {
    log('extract', `Error extrayendo REPROCANN: ${e.message}`)
    return null
  }
}

async function sendEmailNotification(chatId, nombre, dniData, reprocannData, collectedData) {
  if (!resend || !ADMIN_EMAIL) {
    log('email', 'Resend no configurado o email de admin faltante')
    return
  }

  const finalReprocann = {
    ...reprocannData,
    ...(collectedData || {}),
  }

  let htmlContent = `
    <h2>📋 Afiliación Completada - Documentos Recibidos</h2>
    <p><strong>Persona:</strong> ${nombre}</p>
    <p><strong>Contacto:</strong> ${chatId}</p>
    <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-AR')}</p>

    <hr />
  `

  if (dniData && dniData.nombre) {
    htmlContent += `
      <h3>🪪 Documento de Identidad</h3>
      <ul>
        <li><strong>Nombre Completo:</strong> ${dniData.nombre || ''} ${dniData.apellido || ''}</li>
        <li><strong>DNI:</strong> ${dniData.documento || 'No disponible'}</li>
        <li><strong>Fecha Nacimiento:</strong> ${dniData.fecha_nacimiento || 'No disponible'}</li>
        <li><strong>Domicilio:</strong> ${dniData.domicilio || 'No disponible'}</li>
      </ul>
    `
  }

  if (finalReprocann) {
    htmlContent += `
      <h3>🌿 Autorización REPROCANN</h3>
      <ul>
    `
    if (finalReprocann.nombre) htmlContent += `<li><strong>Nombre:</strong> ${finalReprocann.nombre}</li>`
    if (finalReprocann.dni) htmlContent += `<li><strong>DNI en REPROCANN:</strong> ${finalReprocann.dni}</li>`
    if (finalReprocann.autorizacion?.estado) htmlContent += `<li><strong>Estado:</strong> ${finalReprocann.autorizacion.estado}</li>`
    if (finalReprocann.autorizacion?.tipo) htmlContent += `<li><strong>Tipo:</strong> ${finalReprocann.autorizacion.tipo}</li>`
    if (finalReprocann.autorizacion?.plantas) htmlContent += `<li><strong>Cantidad Plantas:</strong> ${finalReprocann.autorizacion.plantas}</li>`
    if (finalReprocann.autorizacion?.transporte) htmlContent += `<li><strong>Transporte:</strong> ${finalReprocann.autorizacion.transporte}</li>`
    if (finalReprocann.ubicacion?.provincia) htmlContent += `<li><strong>Provincia:</strong> ${finalReprocann.ubicacion.provincia}</li>`
    if (finalReprocann.ubicacion?.departamento) htmlContent += `<li><strong>Departamento:</strong> ${finalReprocann.ubicacion.departamento}</li>`
    if (finalReprocann.ubicacion?.localidad) htmlContent += `<li><strong>Localidad:</strong> ${finalReprocann.ubicacion.localidad}</li>`
    if (finalReprocann.ubicacion?.direccion) htmlContent += `<li><strong>Dirección:</strong> ${finalReprocann.ubicacion.direccion}</li>`
    if (finalReprocann.ubicacion?.codigo_postal) htmlContent += `<li><strong>Código Postal:</strong> ${finalReprocann.ubicacion.codigo_postal}</li>`
    if (finalReprocann.tramite?.id) htmlContent += `<li><strong>ID Trámite:</strong> ${finalReprocann.tramite.id}</li>`
    if (finalReprocann.tramite?.fecha_vencimiento) htmlContent += `<li><strong>Vigencia:</strong> ${finalReprocann.tramite.fecha_vencimiento}</li>`
    htmlContent += `</ul>`
  }

  htmlContent += `
    <hr />
    <p style="background: #e8f5e9; padding: 10px; border-left: 4px solid #4caf50;">
      <strong style="color: #2e7d32;">✅ Documentación completa</strong><br/>
      Proceder con verificación y contacto directo.
    </p>
  `

  try {
    const response = await resend.emails.send({
      from: 'Bot Club <onboarding@resend.dev>',
      to: ADMIN_EMAIL,
      subject: `Nuevo Lead: ${nombre} - Documentos Completos`,
      html: htmlContent,
    })
    log('email', `Email enviado a ${ADMIN_EMAIL} para ${nombre}`)
    return response
  } catch (e) {
    log('email', `Error enviando email: ${e.message}`)
    return null
  }
}

async function notifyAdmin(chatId, nombre, dniData, reprocannData, collectedData) {
  log('admin', `Notificando admin para: ${nombre}`)
  await sendEmailNotification(chatId, nombre, dniData, reprocannData, collectedData)
}

// v4.2: Notifica al admin por email cuando un usuario pide hablar con una persona
async function notifyHumanHandover(chatId, nombre, userMessage) {
  if (!resend || !ADMIN_EMAIL) {
    log('handover', `⚠️ Usuario pidió humano pero resend/ADMIN_EMAIL no configurado — notificación NO enviada`)
    return
  }

  const phone = (chatId || '').replace('@c.us', '')
  const safeName = nombre || 'Sin nombre registrado'
  const safeMsg = (userMessage || '').substring(0, 500)
  const when = new Date().toLocaleString('es-AR')

  const html = `
    <h2 style="color:#2e7d32;">📞 Solicitud de atención humana</h2>
    <p style="font-size:15px;">Un usuario en WhatsApp pidió hablar con una persona del club. El bot ya le respondió que lo contactás en un ratito.</p>
    <table style="border-collapse:collapse; margin-top:12px;">
      <tr><td style="padding:6px 10px; font-weight:bold;">Nombre:</td><td style="padding:6px 10px;">${safeName}</td></tr>
      <tr><td style="padding:6px 10px; font-weight:bold;">Teléfono:</td><td style="padding:6px 10px;"><a href="https://wa.me/${phone}">+${phone}</a></td></tr>
      <tr><td style="padding:6px 10px; font-weight:bold;">Chat ID:</td><td style="padding:6px 10px;"><code>${chatId}</code></td></tr>
      <tr><td style="padding:6px 10px; font-weight:bold;">Mensaje:</td><td style="padding:6px 10px;">"${safeMsg}"</td></tr>
      <tr><td style="padding:6px 10px; font-weight:bold;">Fecha/hora:</td><td style="padding:6px 10px;">${when}</td></tr>
    </table>
    <p style="margin-top:20px; padding:12px; background:#fff3e0; border-left:4px solid #ff9800;">
      <strong>Acción sugerida:</strong> contactá al usuario por WhatsApp lo antes posible.
    </p>
  `

  try {
    await resend.emails.send({
      from: 'Bot Club <onboarding@resend.dev>',
      to: ADMIN_EMAIL,
      subject: `📞 Atención humana solicitada — ${safeName} (+${phone})`,
      html,
    })
    log('handover', `📧 Email de handover enviado a ${ADMIN_EMAIL} para ${safeName} (${chatId})`)
  } catch (e) {
    log('handover', `❌ Error enviando email de handover: ${e.message}`)
  }
}

// v4.2: Parseo inteligente del nombre del usuario.
// El usuario puede responder "Martin", "Martin Morales", "Martin pero me dicen Tincho",
// "soy Juan", "jaja que queres", etc. Claude extrae nombre + apellido + apodo, o pide
// aclarar si no puede determinar.
// Retorna: { apodo, nombre_completo, necesita_aclarar, pregunta_aclaracion }
async function parseUserName(rawMessage) {
  if (!ANTHROPIC_KEY) {
    // Fallback simple: primera palabra, max 20 chars
    const guess = (rawMessage || '').trim().split(/\s+/)[0].substring(0, 20)
    return { apodo: guess || 'Amigo', nombre_completo: guess, necesita_aclarar: false }
  }

  const prompt = `El usuario de un club cannabico se está presentando por WhatsApp. Tu tarea: extraer cómo quiere que lo llamemos.

MENSAJE DEL USUARIO: "${rawMessage}"

Devolvé SOLO JSON con esta forma exacta, sin markdown, sin explicación:
{
  "apodo": "string — el nombre/apodo corto para saludarlo (1 palabra idealmente, max 2)",
  "nombre_completo": "string — nombre completo si lo dio, si no el mismo apodo",
  "necesita_aclarar": boolean,
  "pregunta_aclaracion": "string — si necesita_aclarar=true, la pregunta a hacerle (tono cordial, corta)"
}

REGLAS:
- "Martin" → apodo=Martin, nombre_completo=Martin, necesita_aclarar=false
- "Martin Morales" → apodo=Martin, nombre_completo=Martin Morales, necesita_aclarar=false (nombre y apellido claros)
- "Martin pero me dicen Tincho" → apodo=Tincho (usamos el apodo que prefiere), nombre_completo=Martin, necesita_aclarar=false
- "Soy Juan Carlos Pérez" → apodo=Juan, nombre_completo=Juan Carlos Pérez, necesita_aclarar=false
- "hola que tal" / "no se" / "jaja" / algo no-nombre → necesita_aclarar=true, pregunta_aclaracion="¿Cómo te llamás o cómo preferís que te llame?"
- Si tiene más de 2 palabras sin ser claramente "nombre apellido" → necesita_aclarar=true, pregunta="¿Cómo querés que te agendemos? Decime solo tu nombre o apodo 🙂"
- Nunca inventes. Si dudás, pedí aclaración.
- El apodo nunca debe tener "me dicen", "soy", etc. — solo el nombre limpio.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      log('parseName', `Error ${res.status}, fallback simple`)
      const guess = (rawMessage || '').trim().split(/\s+/)[0].substring(0, 20)
      return { apodo: guess || 'Amigo', nombre_completo: guess, necesita_aclarar: false }
    }

    const data = await res.json()
    let text = data.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    const parsed = JSON.parse(text)

    log('parseName', `"${rawMessage}" → apodo="${parsed.apodo}" completo="${parsed.nombre_completo}" aclarar=${parsed.necesita_aclarar}`)

    return {
      apodo: (parsed.apodo || '').trim().substring(0, 30) || 'Amigo',
      nombre_completo: (parsed.nombre_completo || parsed.apodo || '').trim().substring(0, 80),
      necesita_aclarar: !!parsed.necesita_aclarar,
      pregunta_aclaracion: parsed.pregunta_aclaracion || '¿Cómo preferís que te llame? Un nombre o apodo corto 🙂',
    }
  } catch (e) {
    log('parseName', `Excepción: ${e.message}, fallback simple`)
    const guess = (rawMessage || '').trim().split(/\s+/)[0].substring(0, 20)
    return { apodo: guess || 'Amigo', nombre_completo: guess, necesita_aclarar: false }
  }
}

async function askClaude(msg, chatId) {
  if (!ANTHROPIC_KEY) {
    log('claude', 'ANTHROPIC_KEY no configurada!')
    return 'Disculpá, estamos teniendo un problema técnico. Probá de nuevo en unos minutos 🙏'
  }

  let history = conversationHistory.get(chatId)
  if (!history) {
    history = await loadHistory(chatId)  // v4.0: load from DB
  }
  const messages = [...history.slice(-8), { role: 'user', content: msg }]

  log('claude', `Llamando modelo con ${messages.length} mensajes | chat: ${chatId}`)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: TOKEN_BUDGET.explanation,  // v4.0: dynamic
        system: SYSTEM_PROMPT,
        messages,
      }),
    })

    log('claude', `Status: ${res.status}`)

    if (!res.ok) {
      const err = await res.text()
      log('claude', `Error API: ${err.substring(0, 150)}`)
      return 'Disculpá, tuvimos un problema técnico. Intentá de nuevo en un momento 🙏'
    }

    const data = await res.json()
    const rawReply = data.content[0].text.trim()

    // Detectar marker de intent de afiliación
    const wantsAffiliation = /\[\[AFILIAR\]\]/i.test(rawReply)
    let reply = rawReply.replace(/\[\[AFILIAR\]\]/gi, '').trim()

    // Detectar marker de skill especializada
    const parsed = parseSkillMarker(reply)
    reply = parsed.cleanReply
    const skillName = parsed.skillName

    log('claude', `Respuesta: ${reply.substring(0, 100)} | afiliacion=${wantsAffiliation} | skill=${skillName || 'none'}`)

    const updated = [...history, { role: 'user', content: msg }, { role: 'assistant', content: reply }]
    conversationHistory.set(chatId, updated)
    await saveHistory(chatId, updated)

    return { reply, wantsAffiliation, skillName, history: updated }
  } catch (e) {
    log('claude', `Excepcion: ${e.message}`)
    return { reply: 'Disculpá, tuvimos un problema técnico. Intentá de nuevo en un momento 🙏', wantsAffiliation: false, skillName: null, history: [] }
  }
}

// ========== v4.0: CRM MEMBER INSERTION ==========

async function insertMember(chatId, nombre, reprocannData, collectedData) {
  if (!supabase) return
  try {
    const finalData = { ...reprocannData, ...collectedData }

    // Extraer fecha de vencimiento si existe
    let vencimiento = null
    if (finalData.tramite?.fecha_vencimiento) {
      vencimiento = finalData.tramite.fecha_vencimiento
    }

    // CRM upsert added by Codex (GPT-5) on 2026-04-24:
    // the bot may create a provisional member early and complete it later.
    const { error } = await supabase.from('members').upsert(
      {
        chat_id: chatId,
        nombre: nombre || finalData.nombre || 'Sin nombre',
        dni: finalData.dni,
        tipo_paciente: finalData.autorizacion?.tipo,
        provincia: finalData.ubicacion?.provincia,
        localidad: finalData.ubicacion?.localidad,
        direccion: finalData.ubicacion?.direccion,
        reprocann_vencimiento: vencimiento,
        limite_transporte: finalData.autorizacion?.transporte,
        estado_autorizacion: finalData.autorizacion?.estado,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'chat_id' }
    )

    if (error) {
      log('members', `Error upserting member: ${error.message}`)
    } else {
      log('members', `Member upserted: ${nombre} (${chatId})`)
    }
  } catch (e) {
    log('members', `Exception inserting member: ${e.message}`)
  }
}

// ========== END CRM ==========

// ========== v4.0: OFF-FLOW RESPONSES (Fase 7) ==========

// Respuestas casuales y graciosas para mensajes off-topic.
// Rotamos para no repetir siempre lo mismo — experiencia variada.
const RESPUESTAS_FUERA_FLUJO = {
  sticker: [
    'Me faltan algunos superpoderes para entender los stickers 🦸 pero seguro el que mandaste está re piola 😄 ¿Te ayudo con algo?',
    'Uff todavía no manejo stickers, pero seguro estuvo genial 🔥 Contame en qué te puedo dar una mano.',
    'Jaja no llego a interpretar stickers todavía 🙈 pero si lo ponés en palabras o un emoji, te ayudo al toque.',
    'Los stickers son mi kryptonita por ahora 😅 ¿Me lo tirás en texto y vemos?',
    'Me tiraste un sticker y mi cerebrito hizo cortocircuito jaja ⚡ ¿Me contás qué necesitás?',
  ],
  imagen_random: [
    'Linda foto 📸 pero no logré identificar un documento. ¿Querías consultarme algo del club?',
    'Me llegó la imagen, pero no parece un DNI ni un REPROCANN 🤔 ¿En qué te ayudo?',
    'Gracias por la foto 🔥 aunque me cuesta encontrar info útil ahí. Contame qué necesitás.',
    '¿Esa foto venía con alguna pregunta? 😄 Mandame un mensajito y vemos.',
  ],
  solo_emojis: [
    '¡Te capto la onda! 🤝 ¿Querés contarme qué necesitás?',
    'Jaja, los emojis dicen mucho ✨ pero mejor tirame unas palabritas, así te ayudo bien.',
    'Buenísimo 💯 ¿Me contás en qué te puedo dar una mano?',
    '😄 ¿Consulta sobre el club, afiliación, horarios? Contame.',
  ],
  reaccion: [
    '¡Gracias! 🙏 ¿Algo en lo que te pueda ayudar?',
    '¡Dale! 💪 Contame si tenés alguna consulta.',
    'Jaja buenísimo 😄 ¿Te ayudo con algo?',
  ],
  audio: [
    'Uyyy boluuu no puedo escuchar audios todavía 🙉 el jefe aún no me dio oídos jaja — pero si me escribís lo que necesitás seguro te doy una mano 💪',
    'Che, todavía estoy en modo mudo 😅 no puedo reproducir audios. ¿Me lo pasás por texto y lo resolvemos?',
    'Audios nanai por ahora 🎧❌ pero si me tirás el mensaje escrito lo vemos al toque.',
    'Uy, audios no manejo aún — andá sabiendo que mi jefe es tacaño con los permisos jaja 😂 Escribime y te ayudo.',
    'Disculpá, todavía no escucho audios 🙈 ¿Me lo contás en un mensajito?',
  ],
}

// Memoria por chat de qué índice usamos por tipo — evita repetir el mismo mensaje en fila.
const lastRespIndex = new Map()  // chatId -> { sticker: idx, audio: idx, ... }

function randomRespuesta(tipo, chatId = null) {
  const opciones = RESPUESTAS_FUERA_FLUJO[tipo] || RESPUESTAS_FUERA_FLUJO.sticker
  if (opciones.length === 1) return opciones[0]

  if (chatId) {
    // Rotación sin repetir: elegimos un índice distinto al último usado
    const used = lastRespIndex.get(chatId) || {}
    const lastIdx = used[tipo] ?? -1
    let idx
    do {
      idx = Math.floor(Math.random() * opciones.length)
    } while (idx === lastIdx && opciones.length > 1)
    used[tipo] = idx
    lastRespIndex.set(chatId, used)
    return opciones[idx]
  }
  return opciones[Math.floor(Math.random() * opciones.length)]
}

// ========== END OFF-FLOW ==========

// v4.2: Concurrency control — lock por chatId para evitar que dos mensajes del
// mismo usuario corran read-modify-write del state en paralelo.
// Distintos chatIds NO se bloquean entre sí (procesamiento paralelo real).
const chatLocks = new Map()  // chatId -> Promise (cola serializada)
let inFlightWebhooks = 0

function withChatLock(chatId, fn) {
  const prev = chatLocks.get(chatId) || Promise.resolve()
  const next = prev.then(fn, fn).finally(() => {
    if (chatLocks.get(chatId) === next) chatLocks.delete(chatId)
  })
  chatLocks.set(chatId, next)
  return next
}

app.post('/webhook', (req, res) => {
  if (!isWebhookAuthorized(req)) {
    log('auth', `Webhook rechazado por token inválido desde ${req.ip || 'unknown'}`)
    return res.status(401).send('Unauthorized')
  }

  res.send('OK')

  process.nextTick(async () => {
    const t0 = Date.now()
    inFlightWebhooks++
    try {
      const body = req.body
      const msgType = body.messageData?.typeMessage
      const chatId = body.senderData?.chatId
      const sender = body.senderData?.senderName

      log('webhook', `Recibido: typeWebhook=${body.typeWebhook} msgType=${msgType} chat=${chatId} inFlight=${inFlightWebhooks}`)

      // GreenAPI manda este webhook cuando se agota la cuota del plan
      if (body.typeWebhook === 'quotaExceeded') {
        greenApiStats.quotaExceeded = true
        greenApiStats.quotaExceededAt = new Date().toISOString()
        log('webhook', `🚨 GREENAPI QUOTA EXCEEDED webhook recibido — bot no puede enviar`)
        await notifyAdminQuotaExceeded(JSON.stringify(body).substring(0, 300))
        return
      }

      if (body.typeWebhook !== 'incomingMessageReceived') return
      if (!chatId) return

      // Serializar mensajes del mismo chatId — distintos números procesan en paralelo
      await withChatLock(chatId, () => handleMessage(body, msgType, chatId, sender, t0))
    } catch (e) {
      log('webhook', `Error inesperado outer: ${e.message}`)
    } finally {
      inFlightWebhooks--
      log('webhook', `Done in ${Date.now() - t0}ms inFlight=${inFlightWebhooks}`)
    }
  })
})

async function handleMessage(body, msgType, chatId, sender, t0) {
  try {
    let message = null  // Added by OpenCode (Rolli) on 2026-04-24

    // v4.1: Handle off-flow messages (stickers, audios, reactions)
      if (msgType === 'stickerMessage') {
        await sendWhatsAppMessage(chatId, randomRespuesta('sticker', chatId))
        return
      }

      if (msgType === 'reactionMessage') {
        await sendWhatsAppMessage(chatId, randomRespuesta('reaccion', chatId))
        return
      }

      // ========================================================================
      // AUDIO/VOICE PROCESSING - Added by OpenCode (Rolli) on 2026-04-24
      // Uses Deepgram for STT - returns transcript for orchestrator flow
      // ========================================================================
      if (msgType === 'audioMessage' || msgType === 'voiceMessage') {
        const downloadUrl = body.messageData?.fileMessageData?.downloadUrl
        log('webhook', `Audio recibido de ${chatId}, downloadUrl: ${downloadUrl}`)

        // Added by OpenCode (Rolli) on 2026-04-24
        if (downloadUrl) {
          // STT auth/config hardening by Codex (GPT-5) on 2026-04-24:
          // use a dedicated shared secret instead of broad Supabase credentials.
          if (!STT_CONFIGURED) {
            log('webhook', 'Audio recibido pero STT no está configurado de forma segura')
            await sendWhatsAppMessage(chatId, 'Todavía no tengo la transcripción de audios habilitada. ¿Podés escribirlo?')
            return
          }

          try {
            const sttResp = await fetch(STT_FUNCTION_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-stt-secret': STT_SHARED_SECRET,
              },
              body: JSON.stringify({ downloadUrl }),
              signal: AbortSignal.timeout(20_000),
            })
            const sttBody = await sttResp.text()
            let sttData = null
            try {
              sttData = JSON.parse(sttBody)
            } catch {
              sttData = null
            }

            if (sttResp.ok && sttData?.ok && typeof sttData.text === 'string' && sttData.text.trim()) {
              log('webhook', `Audio transcript length=${sttData.text.trim().length}`)
              // Directly process as text - continue flow normally
              const transcript = sttData.text.trim()
              // Added by OpenCode (Rolli) on 2026-04-24
              message = transcript
              // Skip to text processing - don't read from body again
            } else {
              log('webhook', `STT error status=${sttResp.status}: ${(sttData?.error || sttBody || 'Unknown error').substring(0, 160)}`)
              await sendWhatsAppMessage(chatId, 'No pude transcribir el audio. ¿Podés escribirlo?')
              return
            }
          } catch (sttErr) {
            log('webhook', `STT exception: ${sttErr.message}`)
            await sendWhatsAppMessage(chatId, 'Tuve un problema con el audio. ¿Podés escribirlo?')
            return
          }
        } else {
          await sendWhatsAppMessage(chatId, randomRespuesta('audio', chatId))
          return
        }
      }

      // Processing for TEXT messages OR transcript from audio
      // Added by OpenCode (Rolli) on 2026-04-24
      if (msgType === 'textMessage' || message) {
        // If message wasn't set by audio processing, read from body
        if (!message) {
          message = body.messageData?.textMessageData?.textMessage?.trim()
        }
        if (!message) return

        // v4.0: Detect emoji-only messages
        // Detectar mensajes emoji-only (incluye variation selectors, ZWJ, skin tones)
        if (/^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\s‍️]+$/u.test(message) && message.length < 30) {
          await sendWhatsAppMessage(chatId, randomRespuesta('solo_emojis', chatId))
          return
        }

        log('webhook', `De: ${sender} (${chatId}) | "${message}"`)

        if (!checkRateLimit(chatId)) {
          log('webhook', `Rate limit exceeded para ${chatId}`)
          await sendWhatsAppMessage(chatId, 'Recibimos muchos mensajes de este número, intentá en un rato 🙏')
          return
        }

        const state = await loadState(chatId)
        state.last_message_at = new Date().toISOString()

        // ========================================================================
        // LOGGING: Decision trace - Added by OpenCode (Rolli) on 2026-04-24
        // ========================================================================
        log('webhook', `📊 ANALIZANDO: mensaje="${message}" | estado_actual=${state.step} | nombre=${state.nombre || 'sin nombre'}`)

        // Paso 1: Primer contacto — pedir nombre para trato direccional
        if (state.step === 'inicio' && !state.nombre) {
          // Added by OpenCode (Rolli) on 2026-04-24
          log('webhook', `🔀 DECISION: paso1_primer_contacto → solicitar nombre`)
          await sendWhatsAppMessage(chatId, `¡Hola! 👋 Bienvenido/a al club. ¿Cuál es tu nombre?`)
          await sendWhatsAppMessage(chatId, `¡Hola! 👋 Bienvenido/a al club. ¿Cuál es tu nombre?`)
          state.step = 'solicitando_nombre'
          state.last_greeting_at = new Date().toISOString()
          await saveState(chatId, state)
          return
        }

        // Paso 2: Parsear nombre con IA y pasar a modo conversación (o aclarar si es ambiguo)
        if (state.step === 'solicitando_nombre' || state.step === 'aclarando_nombre') {
          // Added by OpenCode (Rolli) on 2026-04-24
          log('webhook', `🔀 DECISION: parseando nombre del mensaje: "${message}"`)
          const parsedName = await parseUserName(message)

          // Si es ambiguo y estamos en el primer intento, pedimos aclaración
          if (parsedName.necesita_aclarar && state.step === 'solicitando_nombre') {
            state.step = 'aclarando_nombre'
            state.raw_name_attempt = message.trim().substring(0, 100)
            await sendWhatsAppMessage(chatId, parsedName.pregunta_aclaracion)
            await saveState(chatId, state)
            // Added by OpenCode (Rolli) on 2026-04-24
            log('webhook', `🔀 DECISION: nombre ambiguo → pedir aclaración ("${parsedName.pregunta_aclaracion}")`)
            return
          }

          // Si tras aclarar sigue ambiguo, tomamos la primera palabra razonable y seguimos
          state.nombre = parsedName.apodo
          state.nombre_completo = parsedName.nombre_completo
          state.step = 'conversando'
          state.last_greeting_at = new Date().toISOString()
          // Added by OpenCode (Rolli) on 2026-04-24
          log('webhook', `🔀 DECISION: nombre confirmado="${state.nombre}" → paso a conversando`)

          // Member draft upsert added by Codex (GPT-5) on 2026-04-24 to avoid
          // unique-key collisions when the same lead completes onboarding later.
          const { error: memberErr } = await supabase.from('members').upsert({
            chat_id: chatId,
            nombre: state.nombre_completo || state.nombre,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'chat_id' })
          if (memberErr) {
            log('supabase', `⚠️ UPSERT members falló (no crítico): ${memberErr.message}`)
          }

          await sendWhatsAppMessage(chatId, `¡Un gusto, ${state.nombre}! 🌿 ¿En qué te puedo ayudar? Puedo darte info legal del cannabis, guiarte con el trámite REPROCANN, o recomendarte genéticas según lo que busques.`)
          await saveState(chatId, state)
          return
        }

        // Paso 3: Si está completando datos de REPROCANN/DNI por texto, guardar la respuesta
        if (state.step === 'completando_datos' && state.pendingFields && state.pendingFields.length > 0) {
          const currentField = state.pendingFields[0]
          state.collectedData[currentField.key] = message
          log('webhook', `Guardado ${currentField.key}=${message} para ${chatId}`)

          state.pendingFields.shift()

          if (state.pendingFields.length > 0) {
            const nextField = state.pendingFields[0]
            await sendWhatsAppMessage(chatId, `Gracias 🙏 Ahora contame ${nextField.label}.`)
            await saveState(chatId, state)
            return
          } else {
            state.step = 'completado'
            await sendWhatsAppMessage(chatId, `✅ ¡Perfecto, ${state.nombre}! Ya tenemos todo. Te contactamos pronto 🌿`)
            await saveState(chatId, state)
            return
          }
        }

        // Paso 4: Detectar pedido explícito de humano
        // Added by OpenCode (Rolli) on 2026-04-24
        const wantHuman = /hablar.*persona|persona.*atienda|atender.*humano|atienda.*humano|pasar.*alguien|pasame.*con.*alguien|contactar.*equipo|speak.*human|hablar.*humano|agente.*humano|atenci[oó]n.*humana/i.test(message)
        if (wantHuman) {
          // Added by OpenCode (Rolli) on 2026-04-24
          log('webhook', `🔀 DECISION: usuario pidio humano → notificar al admin`)
          log('webhook', `User pidió hablar con humano: ${chatId}`)

          // Notificar al admin por email (principal — siempre que esté configurado)
          await notifyHumanHandover(chatId, state.nombre_completo || state.nombre, message)

          // Notificar también por WhatsApp si hay número admin configurado (best-effort)
          if (ADMIN_WHATSAPP) {
            const handoverMsg = `📞 SOLICITUD DE ATENCIÓN HUMANA\n\n👤 ${state.nombre_completo || state.nombre || 'Sin nombre'}\n📱 ${chatId}\n💬 "${message}"\n\nEl usuario quiere hablar con alguien del equipo.`
            await sendWhatsAppMessage(ADMIN_WHATSAPP, handoverMsg)
          }

          await sendWhatsAppMessage(chatId, 'Dale, te paso con alguien del club enseguida 👋 Puede demorar un ratito.')
          return
        }

        // Paso 5: Modo atención al cliente — Claude responde, detecta intent afiliación + skill
        // Added by OpenCode (Rolli) on 2026-04-24
        log('webhook', `🔀 DECISION: mensaje del usuario → llamar a Claude (orquestador)`)
        const { reply, wantsAffiliation, skillName, history: updatedHistory } = await askClaude(message, chatId)

        // Paso 5b: Si Claude pidió invocar una skill, ejecutarla — su respuesta reemplaza a la del orquestador
        if (skillName && SKILL_NAMES.includes(skillName)) {
          // Added by OpenCode (Rolli) on 2026-04-24
          log('webhook', `🔀 DECISION: Claude invocio skill=${skillName}`)
          log('webhook', `Invocando skill=${skillName} para ${chatId}`)
          const skillReply = await invokeSkill(skillName, message, updatedHistory || [], ANTHROPIC_KEY, MODEL)
          if (skillReply) {
            await sendWhatsAppMessage(chatId, skillReply)
            // Reemplazar la última entrada assistant en historial con la respuesta del experto
            const hist = conversationHistory.get(chatId) || []
            if (hist.length > 0 && hist[hist.length - 1].role === 'assistant') {
              hist[hist.length - 1] = { role: 'assistant', content: skillReply }
              conversationHistory.set(chatId, hist)
              await saveHistory(chatId, hist)
            }
            log('webhook', `Skill ${skillName} respondió a ${chatId}`)
          } else {
            // Fallback: si la skill falla, mandamos la respuesta original del orquestador
            log('webhook', `Skill ${skillName} falló, usando fallback del orquestador`)
            await sendWhatsAppMessage(chatId, reply)
          }
        } else {
          await sendWhatsAppMessage(chatId, reply)
        }

        log('webhook', `Respuesta enviada a ${chatId} | wantsAffiliation=${wantsAffiliation} | skill=${skillName || 'none'}`)

        // Paso 6: Si Claude detectó intent de afiliación, transicionar al flujo de documentos
        if (wantsAffiliation && state.step !== 'recibiendo_documentos' && state.step !== 'completando_datos' && state.step !== 'completado') {
          state.step = 'recibiendo_documentos'
          state.documentos = state.documentos || { dni: { frente: null, dorso: null }, reprocann: { frente: null, dorso: null } }
          await saveState(chatId, state)
          log('webhook', `Transición a recibiendo_documentos para ${chatId}`)
        }
      } else if (msgType === 'imageMessage') {
        log('webhook', `messageData: ${JSON.stringify(body.messageData).substring(0, 300)}`)

        const imageUrl = body.messageData?.downloadUrl ||
                         body.messageData?.fileMessageData?.downloadUrl ||
                         body.messageData?.imageMessage?.downloadUrl
        if (!imageUrl) {
          log('webhook', `No downloadUrl encontrada`)
          return
        }

        log('webhook', `Imagen recibida de ${sender} (${chatId})`)

        if (!checkRateLimit(chatId)) {
          log('webhook', `Rate limit exceeded para ${chatId}`)
          await sendWhatsAppMessage(chatId, 'Recibimos muchos mensajes de este número, intentá en un rato 🙏')
          return
        }

        // Initialize state if needed (v4.0: load from DB)
        const state = await loadState(chatId)
        state.last_message_at = new Date().toISOString()

        // v4.0: Si no tiene nombre y no está ya solicitándolo, pedir nombre
        if ((!state.nombre || state.nombre === chatId) && state.step !== 'solicitando_nombre') {
          log('webhook', `Imagen sin nombre registrado: solicitando nombre para ${chatId}`)
          state.step = 'solicitando_nombre'
          state.last_greeting_at = new Date().toISOString()
          await saveState(chatId, state)
          await sendWhatsAppMessage(chatId, `Antes de continuar, ¿cuál es tu nombre?`)
          return
        }

        // Si está solicitando nombre, ignora imágenes hasta que responda
        if (state.step === 'solicitando_nombre') {
          log('webhook', `Esperando nombre, ignorando imagen para ${chatId}`)
          await sendWhatsAppMessage(chatId, `Por favor respondé con tu nombre 👇`)
          return
        }

        // Si está en inicio o conversando y manda una imagen, preparar flujo de docs
        if (state.step === 'inicio' || state.step === 'conversando') {
          state.step = 'recibiendo_documentos'
          state.documentos = state.documentos || { dni: { frente: null, dorso: null }, reprocann: { frente: null, dorso: null } }
        }

        // Detectar tipo de imagen
        const detected = await detectImage(imageUrl)
        log('webhook', `Detectado: tipo=${detected.tipo}, ambosSides=${detected.ambosSides}, valido=${detected.valido}, pais=${detected.pais}`)

        // Análisis de confirmación al usuario
        const analysis = await analyzeImageWithClaude(imageUrl, chatId)
        if (!analysis) {
          await sendWhatsAppMessage(chatId, 'Tuvimos un problema analizando la imagen, intentá de nuevo 🙏')
          return
        }

        // Solo rechazar si tipo === 'OTRO' (no es un documento identificable)
        // Ya NO rechazamos por "borrosa" — intentamos extraer datos primero y pedimos los faltantes por texto.
        if (detected.tipo === 'OTRO') {
          await sendWhatsAppMessage(chatId, 'No logro identificar un documento en esa imagen 🤔 ¿Podés mandarme tu DNI o REPROCANN?')
          return
        }

        if (detected.tipo === 'DOCUMENTO_EXTRANJERO') {
          await sendWhatsAppMessage(chatId, `Ese documento no parece ser argentino 🛑 Necesitamos tu DNI argentino 🇦🇷 y el REPROCANN de acá. ¿Los tenés?`)
          return
        }

        // Procesar según tipo de documento
        if (detected.tipo === 'REPROCANN') {
          if (detected.ambosSides) {
            // REPROCANN completo (ambos lados)
            const data = await extractReprocannData(imageUrl)
            state.documentos.reprocann.frente = { url: imageUrl, data }
            state.documentos.reprocann.dorso = { url: imageUrl, data }
            log('webhook', `REPROCANN completo (ambos lados) para ${chatId}`)
          } else {
            // Un solo lado, determinar si es frente o dorso
            if (!state.documentos.reprocann.frente) {
              // Asumir frente
              const data = await extractReprocannData(imageUrl)
              state.documentos.reprocann.frente = { url: imageUrl, data }
              log('webhook', `REPROCANN frente para ${chatId}`)
              await sendWhatsAppMessage(chatId, `${analysis} Mandame el dorso también.`)
              await saveState(chatId, state)  // v4.0: persist to DB
              return
            } else if (!state.documentos.reprocann.dorso) {
              // Ya tiene frente, esto es dorso
              const data = await extractReprocannData([state.documentos.reprocann.frente.url, imageUrl])
              state.documentos.reprocann.dorso = { url: imageUrl, data }
              log('webhook', `REPROCANN dorso para ${chatId}`)
            }
          }
        } else if (detected.tipo === 'DNI') {
          if (detected.ambosSides) {
            // DNI completo (ambos lados)
            const data = await extractDocumentData(imageUrl, 'DNI')
            state.documentos.dni.frente = { url: imageUrl, data }
            state.documentos.dni.dorso = { url: imageUrl, data }
            log('webhook', `DNI completo (ambos lados) para ${chatId}`)
          } else {
            // Un solo lado, determinar si es frente o dorso
            if (!state.documentos.dni.frente) {
              // Asumir frente
              const data = await extractDocumentData(imageUrl, 'DNI')
              state.documentos.dni.frente = { url: imageUrl, data }
              log('webhook', `DNI frente para ${chatId}`)
              await sendWhatsAppMessage(chatId, `${analysis} Mandame el dorso también.`)
              await saveState(chatId, state)  // v4.0: persist to DB
              return
            } else if (!state.documentos.dni.dorso) {
              // Ya tiene frente, esto es dorso
              const data = await extractDocumentData(imageUrl, 'DNI')
              state.documentos.dni.dorso = { url: imageUrl, data }
              log('webhook', `DNI dorso para ${chatId}`)
            }
          }
        } else {
          // Tipo desconocido — imagen random
          await sendWhatsAppMessage(chatId, randomRespuesta('imagen_random', chatId))
          return
        }

        // Verificar qué documentos faltan
        const documentosFaltantes = []
        if (!state.documentos.reprocann.frente) documentosFaltantes.push('REPROCANN frente')
        if (!state.documentos.reprocann.dorso) documentosFaltantes.push('REPROCANN dorso')
        if (!state.documentos.dni.frente) documentosFaltantes.push('DNI frente')
        if (!state.documentos.dni.dorso) documentosFaltantes.push('DNI dorso')

        if (documentosFaltantes.length > 0) {
          log('webhook', `Documentos faltantes: ${documentosFaltantes.join(', ')}`)
          await sendWhatsAppMessage(chatId, `Dale, recibido 📍 Todavía necesito: ${documentosFaltantes.join(', ')} 📸`)
          await saveState(chatId, state)
          return
        }

        // Tenemos todos los 4 documentos, validar datos de REPROCANN
        const reprocannData = state.documentos.reprocann.dorso?.data || state.documentos.reprocann.frente?.data
        const dniData = state.documentos.dni.dorso?.data || state.documentos.dni.frente?.data

        const missing = getMissingFields(reprocannData)
        log('webhook', `Campos faltantes en REPROCANN: ${missing.map(m => m.key).join(', ') || 'ninguno'}`)

        if (missing.length > 0) {
          // Faltan campos obligatorios en REPROCANN, pedir por texto
          state.step = 'completando_datos'
          state.pendingFields = missing
          const firstField = missing[0]
          await sendWhatsAppMessage(chatId, `Me faltó leer ${firstField.label} 📝 ¿Me lo escribís?`)
          await saveState(chatId, state)
          return
        }

        // Todos los documentos y campos están completos!
        state.step = 'completado'
        await sendWhatsAppMessage(chatId, `✅ ¡Listo, ${state.nombre}! 🎉 Ya tenemos todo. Te contactamos en un ratito 🌿`)

        if (ADMIN_EMAIL) {
          log('webhook', `Enviando email de notificación para ${state.nombre}`)
          await notifyAdmin(chatId, state.nombre_completo || state.nombre, dniData, reprocannData, state.collectedData)
        }

        await saveState(chatId, state)  // v4.0: persist to DB

        // v4.0: Insert member record for CRM (future campaigns)
        await insertMember(chatId, state.nombre_completo || state.nombre, reprocannData, state.collectedData)

        log('webhook', `Imagen procesada para ${chatId}`)
      } else {
        log('webhook', `Tipo no soportado: ${msgType}`)
      }
  } catch (e) {
    log('webhook', `Error inesperado handler (chat=${chatId}, t=${Date.now() - t0}ms): ${e.message}`)
  }
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.floor(process.uptime()),
    model: MODEL,
    threads: conversationHistory.size,
    inFlightWebhooks,
    activeChatLocks: chatLocks.size,
    // Public health payload minimized by Codex (GPT-5) on 2026-04-24.
    greenApi: {
      configured: GREEN_API_CONFIGURED,
      sent: greenApiStats.sent,
      failed: greenApiStats.failed,
      quotaExceeded: greenApiStats.quotaExceeded,
      quotaExceededAt: greenApiStats.quotaExceededAt,
      lastErrorAt: greenApiStats.lastErrorAt,
    },
    knowledgeBase: knowledgeBase.length > 0,
    anthropicKeySet: !!ANTHROPIC_KEY,
    supabaseConfigured: !!supabase,
    sttConfigured: STT_CONFIGURED,
  })
})

app.get('/test-claude', async (req, res) => {
  if (!ensureTestRoutesEnabled(req, res)) return
  if (!ANTHROPIC_KEY) return res.json({ ok: false, error: 'ANTHROPIC_KEY not set' })
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 30, messages: [{ role: 'user', content: 'hola' }] }),
    })
    const data = await r.json()
    res.json({ ok: r.ok, status: r.status, reply: r.ok ? data.content[0].text : data })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

// ========== v4.0: FOLLOW-UP CRON (Fase 3) ==========

// Cargar config de notificaciones (editable en knowledge/notificaciones.config.json)
function loadNotifConfig() {
  try {
    const raw = readFileSync('./knowledge/notificaciones.config.json', 'utf-8')
    const cfg = JSON.parse(raw)
    const intervalos = cfg.modo === 'produccion' ? cfg.intervalos_produccion_minutos : cfg.intervalos_test_minutos
    log('config', `Notificaciones modo=${cfg.modo} cron=${cfg.cron_frecuencia_minutos}min`)
    return {
      modo: cfg.modo,
      cronMinutos: cfg.cron_frecuencia_minutos,
      intervalos,
      maxIntentos: cfg.max_intentos,
    }
  } catch (e) {
    log('config', `⚠️ No se pudo cargar notificaciones.config.json, usando defaults: ${e.message}`)
    return {
      modo: 'produccion',
      cronMinutos: 15,
      intervalos: { sin_reprocann_intento_0: 4320, sin_reprocann_intento_1: 10080, tramitando: 10080, docs_incompletos: 4320, inactivo: 10080 },
      maxIntentos: { sin_reprocann: 2, tramitando: 1, docs_incompletos: 1, inactivo: 1 },
    }
  }
}

const NOTIF_CFG = loadNotifConfig()

async function runFollowUpCron() {
  if (!supabase) return
  const now = new Date().toISOString()

  try {
    const { data: pending } = await supabase
      .from('patient_followups')
      .select('*')
      .eq('status', 'pendiente')
      .lte('proxima_notificacion', now)
      .order('proxima_notificacion')

    for (const f of pending || []) {
      const msg = buildFollowUpMessage(f)
      if (msg) {
        await sendWhatsAppMessage(f.chat_id, msg)
        log('followup', `Enviado a ${f.chat_id} — motivo: ${f.motivo}, intento ${f.intentos + 1}`)
      }

      // Cancelar según max_intentos configurable
      const maxInt = NOTIF_CFG.maxIntentos[f.motivo] ?? 1
      const cancelar = f.intentos >= maxInt

      // Próximo intervalo desde config (en minutos)
      const nextIntervalMinutos = (() => {
        if (f.motivo === 'sin_reprocann') {
          return f.intentos === 0
            ? NOTIF_CFG.intervalos.sin_reprocann_intento_0
            : NOTIF_CFG.intervalos.sin_reprocann_intento_1
        }
        return NOTIF_CFG.intervalos[f.motivo] ?? 4320
      })()

      const nextNotif = new Date(Date.now() + nextIntervalMinutos * 60 * 1000)

      const updatePayload = {
        intentos: f.intentos + 1,
        status: cancelar ? 'cancelado' : 'pendiente',
        updated_at: new Date().toISOString(),
      }
      if (!cancelar) updatePayload.proxima_notificacion = nextNotif.toISOString()

      const { error: updErr } = await supabase.from('patient_followups').update(updatePayload).eq('id', f.id)
      if (updErr) log('followup', `❌ Error updating ${f.id}: ${updErr.message}`)
    }
  } catch (e) {
    log('followup', `Error en cron: ${e.message}`)
  }
}

function buildFollowUpMessage(followup) {
  const msgs = {
    sin_reprocann: [
      '¡Hola! ¿Pudiste iniciar el trámite del REPROCANN?',
      'El trámite REPROCANN tarda 20-30 días hábiles. ¿Ya lo iniciaste?',
    ],
    tramitando: [
      '¿Cómo viene el trámite? Si ya tenés el certificado, mandánoslo.',
      '¿Pudiste obtener tu REPROCANN? Te esperamos 🌿',
    ],
    docs_incompletos: [
      'Te falta enviar algunos documentos. ¿Podemos ayudarte?',
      'Completemos tu afiliación. ¿Tenés los documentos a mano?',
    ],
    inactivo: [
      '¿Podemos ayudarte? El proceso es simple, en unos minutos completás tu afiliación.',
      'Seguimos disponibles cuando quieras continuar.',
    ],
  }

  const opciones = msgs[followup.motivo] || []
  return opciones[Math.min(followup.intentos, opciones.length - 1)] || null
}

// Cron gating added by Codex (GPT-5) on 2026-04-24 so multi-instance deploys
// can disable background jobs on replicas.
if (ENABLE_FOLLOWUP_CRON) {
  setInterval(runFollowUpCron, NOTIF_CFG.cronMinutos * 60 * 1000)
  log('cron', `Follow-up cron corriendo cada ${NOTIF_CFG.cronMinutos} minutos (modo=${NOTIF_CFG.modo})`)
} else {
  log('cron', 'Follow-up cron deshabilitado por configuración')
}

// ========== v4.2: QA AGENT (manual, modo lectura) ==========

// Endpoint manual — lee últimas N conversaciones y pide a Claude evaluarlas
// contra rúbrica (tono, claridad, empatía, conversión, cobertura).
// Devuelve markdown con resumen, fallos y sugerencias al SYSTEM_PROMPT.
// NO aplica cambios automáticos — solo lectura.

const QA_RUBRIC = `RÚBRICA DE EVALUACIÓN (cada conversación, puntaje 1-5 por criterio):

1. **Tono** — ¿Cordial, profesional, rioplatense sin "boludo"? ¿Usa "che" solo en off-topic?
2. **Claridad** — ¿Se entiende fácil? ¿Frases cortas estilo WhatsApp?
3. **Empatía** — ¿Reconoce la situación del usuario? ¿Lo hace sentir escuchado?
4. **Conversión** — ¿Guía hacia el próximo paso útil (afiliación si aplica, info si consulta)?
5. **Cobertura** — ¿Responde lo que el usuario pregunta? ¿Sin inventar datos?

CATEGORÍAS:
- 22-25 pts → EXCELENTE
- 17-21 pts → ACEPTABLE
- <17 pts → DEFICIENTE`

app.get('/admin/qa-report', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  if (!supabase) return res.status(500).json({ ok: false, error: 'Supabase no configurado' })
  if (!ANTHROPIC_KEY) return res.status(500).json({ ok: false, error: 'ANTHROPIC_KEY no configurada' })

  const limit = Math.min(parseInt(req.query.limit) || 20, 50)
  const format = (req.query.format || 'markdown').toLowerCase()

  log('qa', `Ejecutando QA report sobre últimas ${limit} conversaciones`)

  try {
    const { data: convs, error } = await supabase
      .from('conversation_history')
      .select('chat_id, messages, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (error) return res.status(500).json({ ok: false, error: error.message })
    if (!convs || convs.length === 0) {
      return res.json({ ok: true, report: '# QA Report\n\nNo hay conversaciones para evaluar todavía.' })
    }

    // Compactar conversaciones para el evaluador
    const dossier = convs.map((c, i) => {
      const msgs = (c.messages || []).slice(-10).map(m => {
        const who = m.role === 'user' ? 'USER' : 'BOT'
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content).substring(0, 200)
        return `  ${who}: ${content.substring(0, 300)}`
      }).join('\n')
      return `### Conversación #${i + 1} (chat: ${c.chat_id})\n${msgs}`
    }).join('\n\n')

    const evalPrompt = `Sos un QA agent especializado en evaluar calidad de atención de un bot de WhatsApp de un club cannábico argentino.

${QA_RUBRIC}

CONVERSACIONES A EVALUAR (últimas ${convs.length}):

${dossier}

ENTREGÁ un reporte en MARKDOWN con EXACTAMENTE esta estructura:

# QA Report — ${new Date().toLocaleString('es-AR')}

## Resumen
- Total evaluadas: ${convs.length}
- Excelentes: X (X%)
- Aceptables: X (X%)
- Deficientes: X (X%)

## Top 5 mensajes problemáticos
(Listá los 5 peores intercambios con: chat_id abreviado, cita literal del mensaje del bot, y qué falló en 1 línea)

## Patrones detectados
(2-4 bullets con problemas recurrentes: ej. "el bot no ofrece las skills cuando corresponde", "a veces usa tono muy formal")

## Sugerencias para el SYSTEM_PROMPT
(3-5 sugerencias concretas, accionables, como una lista. Ej: "Agregar regla: cuando el usuario pregunte por dormir, invocar genetics_expert")

## Fortalezas observadas
(2-3 bullets con lo que el bot hace bien y no hay que romper)

No inventes datos. Si no hay suficiente material, decilo en vez de rellenar.`

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: evalPrompt }],
      }),
    })

    if (!aiRes.ok) {
      const err = await aiRes.text()
      log('qa', `Error de Claude: ${err.substring(0, 200)}`)
      return res.status(500).json({ ok: false, error: `Claude API error: ${aiRes.status}` })
    }

    const aiData = await aiRes.json()
    const report = aiData.content[0].text.trim()

    log('qa', `Reporte generado: ${report.length} chars`)

    if (format === 'json') {
      return res.json({ ok: true, evaluated: convs.length, report })
    }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    return res.send(report)
  } catch (e) {
    log('qa', `Excepción: ${e.message}`)
    return res.status(500).json({ ok: false, error: e.message })
  }
})

// ========== v4.2: GREENAPI STATUS ==========

app.get('/admin/greenapi-status', (req, res) => {
  if (!requireAdminAccess(req, res)) return
  res.json({
    ok: true,
    ...greenApiStats,
    hint: greenApiStats.quotaExceeded
      ? 'Plan Developer de GreenAPI = máx 3 chats/mes. Ya llegaste al límite. Upgradeá a plan Business en console.green-api.com para habilitar todos los números.'
      : 'GreenAPI funcionando OK',
    plan_info: 'Plan Developer limita a 3 números distintos por mes (auto-asignados por orden de llegada). Sin opción de whitelist manual.',
    rejectedNumbers: greenApiStats.rejectedChatIds.map(c => c.replace('@c.us', '')),
  })
})

// ========== END GREENAPI STATUS ==========

// ========== END QA AGENT ==========

// ========== v4.0: TEST ROUTES (Fase 5) ==========

// Endpoint de diagnóstico — muestra qué env vars tiene el bot (sin exponer secretos)
app.get('/test/env-check', async (req, res) => {
  if (!ensureTestRoutesEnabled(req, res)) return
  const url = process.env.SUPABASE_URL || ''
  const anon = process.env.SUPABASE_ANON_KEY || ''
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  // Test real de conectividad
  let dbTest = 'not tested'
  try {
    const { error } = await supabase.from('patient_state').select('chat_id').limit(1)
    dbTest = error ? `ERROR: ${error.message}` : 'OK'
  } catch (e) { dbTest = `Exception: ${e.message}` }

  res.json({
    supabase_url: {
      configured: !!url,
      length: url.length,
      preview: url.slice(0, 30) + '...',
      endsWithSpace: url !== url.trim(),
    },
    anon_key: {
      configured: !!anon,
      length: anon.length,
      preview: anon.slice(0, 20) + '...',
      endsWithSpace: anon !== anon.trim(),
      hasNewline: anon.includes('\n'),
    },
    service_role_key: {
      configured: !!svc,
      length: svc.length,
      preview: svc.slice(0, 20) + '...',
      endsWithSpace: svc !== svc.trim(),
      hasNewline: svc.includes('\n'),
    },
    using_key: svc ? 'service_role' : (anon ? 'anon' : 'NONE'),
    db_connection_test: dbTest,
  })
})

app.get('/test/seed-followups', async (req, res) => {
  if (!ensureTestRoutesEnabled(req, res)) return
  if (!supabase) return res.json({ ok: false, error: 'Supabase not configured' })

  const testChatId = req.query.chat || '5491100000000@c.us'
  const ahora = new Date()
  const pasado = (minutos) => new Date(ahora.getTime() - minutos * 60000).toISOString()

  const seeds = [
    { chat_id: testChatId, nombre: 'Test User 1', motivo: 'sin_reprocann', proxima_notificacion: pasado(1), intentos: 0, status: 'pendiente' },
    { chat_id: testChatId, nombre: 'Test User 2', motivo: 'tramitando', proxima_notificacion: pasado(2), intentos: 0, status: 'pendiente' },
    { chat_id: testChatId, nombre: 'Test User 3', motivo: 'docs_incompletos', proxima_notificacion: pasado(3), intentos: 0, status: 'pendiente' },
    { chat_id: testChatId, nombre: 'Test User 4', motivo: 'inactivo', proxima_notificacion: pasado(4), intentos: 0, status: 'pendiente' },
    { chat_id: testChatId, nombre: 'Test User 5', motivo: 'sin_reprocann', proxima_notificacion: pasado(5), intentos: 2, status: 'pendiente' },
  ]

  try {
    const { error } = await supabase.from('patient_followups').insert(seeds)
    if (error) {
      return res.json({ ok: false, error: error.message })
    }
    res.json({ ok: true, seeded: seeds.length, note: 'Ejecuta /test/run-cron o espera 15 minutos' })
  } catch (e) {
    res.json({ ok: false, error: e.message })
  }
})

app.get('/test/run-cron', async (req, res) => {
  if (!ensureTestRoutesEnabled(req, res)) return
  await runFollowUpCron()
  res.json({ ok: true, message: 'Cron ejecutado manualmente' })
})

// ========== END TEST ROUTES ==========

const PORT = process.env.PORT ?? 3000
app.listen(PORT, () => {
  log('server', `Bot corriendo en puerto ${PORT}`)
  log('server', `Modelo: ${MODEL}`)
  log('server', `API key configurada: ${!!ANTHROPIC_KEY}`)
  log('server', `Knowledge base: ${knowledgeBase.length} chars`)
  log('server', `GreenAPI configurado: ${GREEN_API_CONFIGURED}`)
  log('server', `Supabase configurado: ${!!supabase} (service_role=${SUPABASE_USING_SERVICE_ROLE})`)
  log('server', `Webhook auth requerido: ${REQUIRE_WEBHOOK_SECRET}`)
  log('server', `STT configurado: ${STT_CONFIGURED}`)
})
