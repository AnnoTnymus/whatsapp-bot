import 'dotenv/config.js'
import { timingSafeEqual } from 'crypto'
import express from 'express'
import fetch from 'node-fetch'
import { readFileSync, writeFileSync } from 'fs'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { SKILL_NAMES, invokeSkill, parseSkillMarker } from './skills.js'
// [claude-opus-4.7] 2026-04-24 Task #48 — knowledge-driven pipeline (detrás de USE_NEW_PIPELINE).
import { runRouter, runGenerator, runEvaluator } from './src/agents/index.js'

const app = express()
app.use(express.static('public'))
app.use('/presentacion', express.static('presentacion'))

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
const CLIENT_API_TOKEN = process.env.CLIENT_API_TOKEN?.trim()
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET?.trim()
const REQUIRE_WEBHOOK_SECRET = process.env.REQUIRE_WEBHOOK_SECRET === 'true' || process.env.NODE_ENV === 'production'
const ENABLE_TEST_ROUTES = process.env.ENABLE_TEST_ROUTES === 'true'
const ENABLE_FOLLOWUP_CRON = process.env.ENABLE_FOLLOWUP_CRON !== 'false'
// [claude-opus-4.7] 2026-04-24 Task #48 — canary flag: false = askClaude legacy, true = pipeline nuevo.
const USE_NEW_PIPELINE = process.env.USE_NEW_PIPELINE === 'true'
const STT_FUNCTION_URL = process.env.STT_FUNCTION_URL?.trim()
const STT_SHARED_SECRET = process.env.STT_SHARED_SECRET?.trim()
const GREEN_API_CONFIGURED = Boolean(GREEN_INSTANCE && GREEN_TOKEN)
// Added by OpenCode (Rolli) on 2026-04-24
const STT_CONFIGURED = Boolean(STT_FUNCTION_URL && STT_SHARED_SECRET)

// [OpenCode] Language detection
const SUPPORTED_LANGUAGES = ['es', 'en', 'pt']
const DEFAULT_LANGUAGE = 'es'

function detectLanguage(text) {
  if (!text || !text.trim()) return 'es'
  const t = text.toLowerCase().trim()

  // Portuguese — check before English ("oi", "ola" etc. are high-confidence)
  if (/^(oi|olá|ola\b|ola!|bom dia|boa tarde|boa noite|td bem|tudo bem|valeu)/i.test(t) ||
      /\b(obrigado|obrigada|preciso|posso|vocês|você|quando\b|também|não\b|está\b|ção\b)/i.test(t)) {
    return 'pt'
  }

  // English — clear markers only (avoid false-positives on short ambiguous words)
  if (/^(hello|hi\b|hey\b|good morning|good afternoon|good evening|good night)/i.test(t) ||
      /\b(hello|thanks|thank you|please|strains|genetics|membership|i need|i want|i would|can i|do you|how are|what is|where is|when is)\b/i.test(t) ||
      / i /i.test(t) || t.startsWith('i ') || t.startsWith("i'")) {
    return 'en'
  }

  // Spanish accent characters are a strong signal
  if (/[áéíóúñ]/i.test(t)) return 'es'

  // Default — Spanish (99% of users are Argentine)
  return 'es'
}

// Helper to parse language selection from user response
// Accepts: 1, 2, 3 or any variation of Spanish/English/Portuguese with typos
function parseLanguageSelection(text) {
  if (!text) return null
  const lower = text.toLowerCase().trim()
  
  // Number selection
  if (lower === '1') return 'es'
  if (lower === '2') return 'en'
  if (lower === '3') return 'pt'
  
  // Spanish - starts with "es" or contains "span"/"esp"/"españ"
  if (/^es|span|esp|españ/.test(lower)) return 'es'
  
  // English - starts with "en" or contains "ing"/"engl"
  if (/^en|ing|engl/.test(lower)) return 'en'
  
  // Portuguese - starts with "port"
  if (/^port|portug/.test(lower)) return 'pt'
  
  return null
}

// Get confirmation message for selected language
function getLanguageConfirmation(lang) {
  const msgs = {
    es: '✅ Perfecto, ahora chateamos en español.',
    en: '✅ Perfect, we will chat in English.',
    pt: '✅ Perfeito, agora vamos conversar em português.'
  }
return msgs[lang] || msgs.es
}

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
const processedInboundMessages = new Map()  // chatId -> Map(messageId, seenAt)

const RATE_LIMIT = 100
const RATE_WINDOW = 60 * 60 * 1000
const PROCESSED_MESSAGE_TTL_MS = 6 * 60 * 60 * 1000
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP

// v4.0: Dynamic token allocation (Fase 4)
const TOKEN_BUDGET = {
  confirmation: 50,        // "✅ Recibido. Mandame el dorso."
  request_document: 100,   // "Aún necesito: DNI frente, REPROCANN dorso 📸"
  request_field: 80,       // "Ahora necesito tu provincia. Contame 👇"
  success: 120,           // "¡Listo! Te contactamos pronto 🌿"
  error: 150,             // Mensajes de error con instrucciones
  explanation: 1200,      // Extracción DNI/REPROCANN — debe devolver JSON completo con todos los campos
  followup: 120,          // Mensajes de seguimiento automático
  detect: 100,            // Document type detection
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null
const DEFAULT_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'DEFAULT_FROM_EMAIL'

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

// Returns 'admin', 'client', or null based on which token matches.
function resolveRole(req) {
  const incomingToken = req.get('x-admin-token')?.trim() || getBearerToken(req.get('authorization'))
  if (!incomingToken) return null
  if (ADMIN_API_TOKEN && safeCompare(ADMIN_API_TOKEN, incomingToken)) return 'admin'
  if (CLIENT_API_TOKEN && safeCompare(CLIENT_API_TOKEN, incomingToken)) return 'client'
  return null
}

function requireAdminAccess(req, res) {
  if (!ADMIN_API_TOKEN) {
    res.status(503).json({ ok: false, error: 'ADMIN_API_TOKEN no configurado' })
    return false
  }
  const role = resolveRole(req)
  if (role === 'client') {
    res.status(403).json({ ok: false, error: 'forbidden' })
    return false
  }
  if (role !== 'admin') {
    res.status(401).json({ ok: false, error: 'unauthorized' })
    return false
  }
  return true
}

// Allows both admin and client tokens. Returns the resolved role, or null + sends 401/503.
function requireDashboardAccess(req, res) {
  if (!ADMIN_API_TOKEN) {
    res.status(503).json({ ok: false, error: 'ADMIN_API_TOKEN no configurado' })
    return null
  }
  const role = resolveRole(req)
  if (!role) {
    res.status(401).json({ ok: false, error: 'unauthorized' })
    return null
  }
  return role
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

// Production logging/idempotency helpers added by Codex (GPT-5) on 2026-04-24:
// reduce PII in logs and avoid duplicate replies when a webhook is redelivered.
function formatChatRef(chatId) {
  if (!chatId) return 'unknown'
  const normalized = String(chatId)
  const [localPart, suffix = ''] = normalized.split('@')
  if (localPart.length <= 4) return normalized
  return `${localPart.slice(0, 4)}...${localPart.slice(-2)}${suffix ? `@${suffix}` : ''}`
}

function rememberInboundMessage(chatId, messageId) {
  if (!chatId || !messageId) return false

  const now = Date.now()
  const cache = processedInboundMessages.get(chatId) || new Map()

  for (const [cachedId, seenAt] of cache) {
    if (now - seenAt > PROCESSED_MESSAGE_TTL_MS) cache.delete(cachedId)
  }

  if (cache.has(messageId)) {
    processedInboundMessages.set(chatId, cache)
    return true
  }

  cache.set(messageId, now)
  while (cache.size > 200) {
    const oldestKey = cache.keys().next().value
    if (!oldestKey) break
    cache.delete(oldestKey)
  }

  processedInboundMessages.set(chatId, cache)
  return false
}

function pruneEphemeralState() {
  const now = Date.now()

  for (const [chatId, entry] of rateLimits.entries()) {
    if (now > entry.resetAt) rateLimits.delete(chatId)
  }

  for (const [chatId, cache] of processedInboundMessages.entries()) {
    for (const [messageId, seenAt] of cache.entries()) {
      if (now - seenAt > PROCESSED_MESSAGE_TTL_MS) cache.delete(messageId)
    }
    if (cache.size === 0) processedInboundMessages.delete(chatId)
  }
}

// ========== SUPABASE PERSISTENCE (v4.0) ==========

async function loadState(chatId) {
  try {
    if (!supabase) {
      log('supabase', `⚠️ Supabase NOT CONFIGURED - returning default state`)
      return {
        step: 'inicio',
        language: DEFAULT_LANGUAGE,
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
      // Log sanitization refined by Codex (GPT-5) on 2026-04-24.
      log('supabase', `❌ ERROR loading state for ${formatChatRef(chatId)}: ${error.message}`)
    }

    if (!data) {
      return {
        step: 'inicio',
        language: DEFAULT_LANGUAGE,
        nombre: null,
        nombre_completo: null,
        documentos: { dni: { frente: null, dorso: null }, reprocann: { frente: null, dorso: null } },
        collectedData: {},
        pendingFields: [],
      }
    }

return {
        step: data.step,
        language: data.language || DEFAULT_LANGUAGE,
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
    log('supabase', `❌ Exception loading state for ${formatChatRef(chatId)}: ${e.message}`)
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
      log('supabase', `⚠️ Supabase NOT CONFIGURED - State NOT saved for ${formatChatRef(chatId)}`)
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
        language: state.language || DEFAULT_LANGUAGE,
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
      log('supabase', `❌ ERROR saving state for ${formatChatRef(chatId)}: ${result.error.message}`)
    } else {
      log('supabase', `✅ State saved for ${formatChatRef(chatId)} (step=${state.step})`)
    }
  } catch (e) {
    log('supabase', `❌ Exception saving state for ${formatChatRef(chatId)}: ${e.message}`)
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
        messages: messages.slice(-50),  // Keep last 50 messages for full context
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'chat_id' }
    )
  } catch (e) {
    log('supabase', `Error saving history for ${formatChatRef(chatId)}: ${e.message}`)
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

// [claude-opus-4.7] 2026-04-24: objetivo primario del agente = conseguir la inscripción.
// Atención al cliente sigue siendo el vehículo, pero siempre orientado a que el lead se inscriba.
const SYSTEM_PROMPT = `Sos el asistente de WhatsApp del club cannábico. Tu OBJETIVO PRIMARIO es lograr que el usuario se inscriba/afilie al club. Tu rol de atención al cliente (responder dudas, informar sobre el club, productos, horarios, REPROCANN) es el vehículo para llegar a la inscripción.

Mostrá una leve inclinación a guiar la conversación hacia la afiliación: cuando el usuario pregunta algo genérico, respondé su duda y conectá suavemente con la inscripción ("justo es parte de lo que te cubre la membresía", "cuando te asociás eso ya te lo damos resuelto", etc.).

No fuerces la afiliación ni la pidas antes de que el usuario termine su consulta. Solo iniciás el flujo de documentos cuando el usuario lo pide explícitamente.

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

Si saluda (hola, buenas, etc.) SIN expresar intención clara:
→ Saludá con la presentación de Indajaus + ofrece opciones completas. Ejemplo:
"¡Bienvenido a Indajaus! 🌿
Te estás comunicando con nuestro club cannábico en Argentina. Con más de una década de experiencia en el sector del cannabis, somos líderes del sector. Estás en el lugar indicado.

Acá podemos ayudarte con:
• 📝 Inscripción al club — es lo principal, te cuento qué necesitamos para afiliararte
• 🌱 Nuestras genéticas — catálogo completo, efectos, perfiles de THC/CBD, recomendaciones según lo que buscas
• ⚖️ Marco legal — preguntas sobre REPROCANN, leyes, derechos, autocultivo, legalidad en Argentina
• 📋 Info sobre el club — cómo funciona, horarios, precios, productos, ubicación
• 👥 Atención humana — si prefieres hablar con alguien del equipo directamente

Yo soy IA entrenada en cannabis, legales y genéticas, así que podemos resolver casi cualquier duda. ¿Con qué te podemos ayudar?"

Si pregunta por horarios, dirección, ubicación:
→ Respondé brevemente con la info del knowledge base.

Si pregunta por genéticas, productos, stock:
→ Contá brevemente las opciones disponibles y su perfil de efecto (indica/sativa/híbrida).

Si pregunta por REPROCANN (qué es, cómo tramitarlo):
→ Explicá que es el registro oficial para uso medicinal, se tramita en argentina.gob.ar/reprocann, es gratis.

Si pide hablar con una persona:
→ Confirmale que ya notificaste al staff y que lo van a contactar, PERO ofrecele seguir la conversación mientras espera. Mencionale que podés contarle sobre el club, Indajaus (somos líderes del sector en Argentina), genéticas, REPROCANN, o arrancar la inscripción. El objetivo es mantenerlo activo y avanzar hacia la afiliación aunque esté esperando al humano.

Si manda algo raro, fuera de tema (chistes, stickers random, mensajes sin sentido):
→ Respondé casualmente con humor rioplatense (acá SÍ podés usar "che", "jaja", emojis) y redirigí cordial: "Dale, ¿en qué te puedo ayudar con el club?"

RECEPCIÓN DE DOCUMENTOS (IMPORTANTE - TONO ENTUSIASTA):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Si recibís DNI o REPROCANN y SE LEEN BIEN TODOS LOS DATOS:
→ "¡Joya che! 🔥 Se ven los datos perfectos. Estamos a un paso solamente. [Si falta otro doc: Me falta tu REPROCANN/DNI. Mandame lo que te falta y listo.]"

Si recibís documento pero FALTAN CAMPOS específicos:
→ "¡Ufff! 😅 Logré leer algunos datos nada más. Me falta tu [PRIMER CAMPO FALTANTE]. ¿Me lo escribís?"
→ Pedir DE A UNO. Cuando llega cada campo, validar y pedir el siguiente si hay más.
→ NO pedir todos juntos — conversación natural, campo por campo.

Cuando TODOS los datos estén COMPLETOS:
→ "¡Impecaaa! 🎉 Ya tenemos todo lo que necesitamos para que nuestro staff lo revise y se comunique contigo para finalizar la inscripción. Pero ya tenés un pie adentro del mejor club cannábico en Argentina! 🌿 Nos vemos en breve, bienvenido/a a Indajaus."

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
Cuando el usuario se acaba de presentar con su nombre y preguntás "¿en qué te puedo ayudar?", la INSCRIPCIÓN AL CLUB va PRIMERA siempre, y luego mencionás las consultas posibles como alternativas. Ejemplo: "¿Querés que te guíe para inscribirte al club? 🌿 O si preferís primero te cuento cómo funciona, te ayudo con el REPROCANN, temas legales, o qué genéticas tenemos — lo que te sirva."

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

      // Provider log sanitization by Codex (GPT-5) on 2026-04-24:
      // keep operational detail without exposing full chat identifiers in logs.
      log('whatsapp', `🚨 GREENAPI 466 CORRESPONDENTS_QUOTE_EXCEEDED — chat=${formatChatRef(chatId)} FUERA del cupo de 3 chats/mes del plan Developer. Única solución: upgrade a Business en console.green-api.com. Body: ${text.substring(0, 200)}`)

      await notifyAdminQuotaExceeded(text, chatId)
      return { ok: false, reason: 'quota_or_whitelist', status: res.status }
    }

    if (!res.ok) {
      greenApiStats.failed++
      greenApiStats.lastError = `HTTP ${res.status}: ${text.substring(0, 150)}`
      greenApiStats.lastErrorAt = new Date().toISOString()
      log('whatsapp', `❌ Envío falló (${res.status}) chat=${formatChatRef(chatId)}: ${text.substring(0, 150)}`)
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
        from: 'Bot Club <DEFAULT_FROM_EMAIL>',
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
  // Image download logs sanitized by Codex (GPT-5) on 2026-04-24.
  log('image', `Intentando descargar id=${idMessage} chat=${formatChatRef(chatId)}`)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idMessage, chatId }),
    })
    log('image', `Respuesta status: ${res.status}`)
    const data = await res.json()
    log('image', `Respuesta JSON resumida: hasResult=${!!data?.result} hasUrl=${!!data?.result?.downloadUrl}`)

    if (data.result) {
      log('image', `Descargada exitosamente: ${idMessage}`)
      return data.result
    }
    log('image', `Error descargando - respuesta resumida: hasResult=${!!data?.result}`)
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

const DNI_REQUIRED = [
  { key: 'nombre', label: 'tu nombre completo', path: d => d?.nombre },
  { key: 'documento', label: 'tu número de documento', path: d => d?.documento },
  { key: 'domicilio', label: 'tu domicilio', path: d => d?.domicilio },
]

function getMissingFields(reprocannData) {
  return REPROCANN_REQUIRED.filter(f => !f.path(reprocannData))
}

function validateCriticalFields(dniData, reprocannData) {
  const missing = []

  if (!dniData) {
    log('validate', `DNI data es null/undefined, marcando como incompleto`)
    missing.push({ key: 'extraction', label: 'datos del DNI', source: 'DNI' })
  } else {
    const dniMissing = DNI_REQUIRED.filter(f => !f.path(dniData))
    if (dniMissing.length > 0) {
      missing.push(...dniMissing.map(f => ({ ...f, source: 'DNI' })))
    }
  }

  if (!reprocannData) {
    log('validate', `REPROCANN data es null/undefined, marcando como incompleto`)
    missing.push({ key: 'extraction', label: 'datos del REPROCANN', source: 'REPROCANN' })
  } else {
    const reprocannMissing = REPROCANN_REQUIRED.filter(f => !f.path(reprocannData))
    if (reprocannMissing.length > 0) {
      missing.push(...reprocannMissing.map(f => ({ ...f, source: 'REPROCANN' })))
    }
  }

  return missing
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
    let text = data.content[0].text.trim()

    // Extraer JSON si está envuelto en backticks o prefijo
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      log('detect', `JSON no encontrado, asumiendo REPROCANN: ${text.substring(0, 50)}`)
      return { tipo: 'REPROCANN', ambosSides: false, pais: null, valido: true }
    }

    // Parse JSON robustly
    let json
    try {
      json = JSON.parse(jsonMatch[0])
    } catch {
      // Si no es JSON válido, asumir REPROCANN
      log('detect', `JSON parse error, asumiendo REPROCANN: ${jsonMatch[0].substring(0, 50)}`)
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

async function analyzeImageWithClaude(imageUrl, state = {}) {
  if (!ANTHROPIC_KEY) {
    log('claude', 'ANTHROPIC_KEY no configurada para análisis de imagen')
    return null
  }

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

    // Extraer SOLO el JSON — ignorar prefijo/sufijo que Claude pueda agregar
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      log('extract', `JSON no encontrado en ${docType}, retornando null: ${text.substring(0, 80)}`)
      return null
    }

    let json
    try {
      json = JSON.parse(jsonMatch[0])
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

    // Extraer SOLO el JSON — ignorar prefijo/sufijo que Claude pueda agregar
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      log('extract', `JSON no encontrado en respuesta, retornando null: ${text.substring(0, 80)}`)
      return null
    }

    let json
    try {
      json = JSON.parse(jsonMatch[0])
    } catch {
      log('extract', `JSON parse error, retornando null: ${jsonMatch[0].substring(0, 80)}`)
      return null
    }

    log('extract', `Datos extraídos de ${urlArray.length} imagen(s) REPROCANN`)
    return json
  } catch (e) {
    log('extract', `Error extrayendo REPROCANN: ${e.message}`)
    return null
  }
}

async function sendEmailNotification(chatId, nombre, dniData, reprocannData, collectedData, imageUrls = {}) {
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

  // Extraer número de teléfono del chatId (formato: "5989...63@c.us")
  const phoneNumber = chatId.split('@')[0]
  const whatsappLink = `https://wa.me/${phoneNumber}`

  htmlContent += `
    <hr />
    <p style="background: #e8f5e9; padding: 10px; border-left: 4px solid #4caf50;">
      <strong style="color: #2e7d32;">✅ Documentación completa</strong><br/>
      <a href="${whatsappLink}" style="color: #25d366; font-weight: bold; text-decoration: none;">📱 Ver chat en WhatsApp</a> • Proceder con verificación y contacto directo.
    </p>
  `

  try {
    const emailParams = {
      from: 'Bot Club <DEFAULT_FROM_EMAIL>',
      to: ADMIN_EMAIL,
      subject: `Nuevo Lead: ${nombre} - Documentos Completos`,
      html: htmlContent,
    }
    const response = await resend.emails.send(emailParams)

    if (response && response.id) {
      log('email', `✅ Email enviado exitosamente (id=${response.id}) a ${ADMIN_EMAIL} para ${nombre}`)
      return response
    } else if (response && response.error) {
      log('email', `❌ Error de Resend: ${response.error}`)
      return null
    } else {
      log('email', `⚠️ Response inesperada de Resend: ${JSON.stringify(response).substring(0, 100)}`)
      return response
    }
  } catch (e) {
    log('email', `❌ Exception enviando email: ${e.message}`)
    return null
  }
}

async function notifyAdmin(chatId, nombre, dniData, reprocannData, collectedData, imageUrls = {}) {
  log('admin', `Notificando admin para: ${nombre}`)
  await sendEmailNotification(chatId, nombre, dniData, reprocannData, collectedData, imageUrls)
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
    const result = await resend.emails.send({
      from: `Bot Club <${DEFAULT_FROM_EMAIL}>`,
      to: ADMIN_EMAIL,
      subject: `📞 Atención humana solicitada — ${safeName} (+${phone})`,
      html,
    })
    if (result.error) {
      log('handover', `❌ Resend error: ${JSON.stringify(result.error)}`)
    } else {
      log('handover', `📧 Email enviado: ${result.data?.id}`)
    }
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

  const system = `El usuario de un club cannabico se está presentando por WhatsApp. Tu tarea: extraer cómo quiere que lo llamemos.

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

  const userMessage = `MENSAJE DEL USUARIO: "${rawMessage}"`

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
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!res.ok) {
      log('parseName', `Error ${res.status}, fallback simple`)
      const guess = (rawMessage || '').trim().split(/\s+/)[0].substring(0, 20)
      return { apodo: guess || 'Amigo', nombre_completo: guess, necesita_aclarar: false }
    }

    const data = await res.json()
    let text = data.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

    // Extraer JSON si está envuelto en prefijo/sufijo
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      const guess = (rawMessage || '').trim().split(/\s+/)[0].substring(0, 20)
      return { apodo: guess || 'Amigo', nombre_completo: guess, necesita_aclarar: false }
    }

    let parsed
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      const guess = (rawMessage || '').trim().split(/\s+/)[0].substring(0, 20)
      return { apodo: guess || 'Amigo', nombre_completo: guess, necesita_aclarar: false }
    }

    // Name parsing logs sanitized by Codex (GPT-5) on 2026-04-24.
    log('parseName', `len=${(rawMessage || '').length} apodoLen=${(parsed.apodo || '').length} aclarar=${parsed.necesita_aclarar}`)

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

  log('claude', `Llamando modelo con ${messages.length} mensajes | chat=${formatChatRef(chatId)}`)

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

    log('claude', `Respuesta len=${reply.length} | afiliacion=${wantsAffiliation} | skill=${skillName || 'none'}`)

    const updated = [...history, { role: 'user', content: msg }, { role: 'assistant', content: reply }]
    conversationHistory.set(chatId, updated)
    await saveHistory(chatId, updated)

    return { reply, wantsAffiliation, skillName, history: updated }
  } catch (e) {
    log('claude', `Excepcion: ${e.message}`)
    return { reply: 'Disculpá, tuvimos un problema técnico. Intentá de nuevo en un momento 🙏', wantsAffiliation: false, skillName: null, history: [] }
  }
}

// ========== [claude-opus-4.7] 2026-04-24 Task #48 — NEW PIPELINE ==========
// Pipeline Router → Knowledge → Generator → Evaluator (+1 retry si score<70).
// Se activa cuando USE_NEW_PIPELINE=true. Firma compatible con askClaude() para swap limpio.
// Las funciones de knowledge (queryKnowledge, saveTrainingExample) las provee OpenCode en
// feat/knowledge-layer — acá usamos dynamic import con fallback vacío para que esta rama
// compile aunque src/knowledge/ todavía no exista.

let _knowledgeModule = null
async function loadKnowledgeModule() {
  if (_knowledgeModule) return _knowledgeModule
  try {
    _knowledgeModule = await import('./src/knowledge/index.js')
  } catch (e) {
    log('pipeline', `knowledge module unavailable (${e.code || e.message}) — usando stub`)
    _knowledgeModule = {
      queryKnowledge: async () => [],
      saveTrainingExample: async () => {},
    }
  }
  return _knowledgeModule
}

async function runNewPipeline(msg, chatId, state) {
  let history = conversationHistory.get(chatId)
  if (!history) history = await loadHistory(chatId)

  const knowledgeLayer = await loadKnowledgeModule()

  // 1. Router
  const routed = await runRouter({ message: msg, history, state })
  log('pipeline', `router intent=${routed.intent} skill=${routed.skill || '-'} query=${routed.knowledge_query || '-'} want_afil=${routed.wants_affiliation} | ${formatChatRef(chatId)}`)

  // 2. Skill short-circuit — la skill handler del webhook toma el control.
  //    Devolvemos placeholder corto como "último assistant" para que skills.js pueda reemplazarlo.
  if (routed.intent === 'skill' && routed.skill && SKILL_NAMES.includes(routed.skill)) {
    const placeholder = 'Dale, te paso info 🌿'
    const updated = [...history, { role: 'user', content: msg }, { role: 'assistant', content: placeholder }]
    conversationHistory.set(chatId, updated)
    await saveHistory(chatId, updated)
    return { reply: placeholder, wantsAffiliation: routed.wants_affiliation, skillName: routed.skill, history: updated }
  }

  // 2b. Handover short-circuit — Router detectó semánticamente que usuario pide atención humana
  if (routed.intent === 'handover') {
    log('pipeline', `handover detectado por Router LLM | ${formatChatRef(chatId)}`)

    // Email al admin
    await notifyHumanHandover(chatId, state?.nombre_completo || state?.nombre, msg)

    // WA al admin (mismo guard que Paso 4 legacy)
    if (ADMIN_WHATSAPP && ADMIN_WHATSAPP !== chatId) {
      const handoverMsg = `📞 SOLICITUD DE ATENCIÓN HUMANA\n\n👤 ${state?.nombre_completo || state?.nombre || 'Sin nombre'}\n📱 ${chatId}\n💬 "${msg}"\n\nEl usuario quiere hablar con alguien del equipo.`
      await sendWhatsAppMessage(ADMIN_WHATSAPP, handoverMsg)
    } else if (ADMIN_WHATSAPP === chatId) {
      log('pipeline', `⚠️ Skip admin WA: ADMIN_WHATSAPP===chatId`)
    }

    // Respuesta coherente al usuario
    const nombreSaludo = state?.nombre && state.nombre !== 'Amigo' ? `, ${state.nombre}` : ''
    const _hoLang = state?.language || 'es'
    const _hoMsgs = {
      es: `Listo${nombreSaludo} 👋 Ya notifiqué al staff y te van a contactar apenas puedan.\n\nMientras tanto puedo contarte sobre el club, las genéticas disponibles, cómo funciona el REPROCANN, o arrancar con la inscripción si preferís ir avanzando. ¿Te interesa alguna?`,
      en: `Got it${nombreSaludo} 👋 I've notified the staff and they'll reach out as soon as they can.\n\nMeanwhile I can tell you about the club, available genetics, how REPROCANN works, or we can start the membership process if you'd like to move forward. Interested?`,
      pt: `Feito${nombreSaludo} 👋 Notifiquei o staff e eles vão entrar em contato assim que puderem.\n\nEnquanto isso posso te contar sobre o clube, as genéticas disponíveis, como funciona o REPROCANN, ou podemos iniciar o processo de associação se preferir avançar. Tem interesse?`,
    }
    const handoverReply = _hoMsgs[_hoLang] || _hoMsgs.es

    // Marcar step para que el admin lo vea en el dashboard
    if (state) {
      state.step = 'esperando_humano'
      await saveState(chatId, state)
    }

    // Persistir historial
    const updated = [...history, { role: 'user', content: msg }, { role: 'assistant', content: handoverReply }]
    conversationHistory.set(chatId, updated)
    await saveHistory(chatId, updated)

    return { reply: handoverReply, wantsAffiliation: false, skillName: null, history: updated }
  }

  // 3. Knowledge (si el router lo pide)
  let knowledge = []
  if (routed.needs_knowledge && routed.knowledge_query) {
    try {
      const lang = state?.language || 'es'
      knowledge = await knowledgeLayer.queryKnowledge(routed.knowledge_query, 3, lang)
      log('pipeline', `knowledge hits=${knowledge.length} topic="${routed.knowledge_query}" lang=${lang}`)
    } catch (e) {
      log('pipeline', `queryKnowledge excepción: ${e.message} — sigo sin snippets`)
      knowledge = []
    }
  }

  // 4. Generator
  const gen = await runGenerator({
    intent: routed.intent,
    knowledge,
    history,
    state,
    message: msg,
  })
  let finalReply = gen.reply
  let finalWants = gen.wants_affiliation

  // 5. Evaluator (+1 retry si no pasa)
  const lang = state?.language || 'es'
  const evaluation = await runEvaluator({ reply: finalReply, context: { chatId, history } }, { lang })
  log('pipeline', `evaluator score=${evaluation.score} passes=${evaluation.passes}`)

  let finalScore = evaluation.score
  let finalReasons = evaluation.reasons
  if (!evaluation.passes) {
    const retry = await runGenerator({ intent: routed.intent, knowledge, history, state, message: msg })
    const retryEval = await runEvaluator({ reply: retry.reply, context: { chatId, history } }, { lang })
    log('pipeline', `retry score=${retryEval.score} passes=${retryEval.passes}`)
    if (retryEval.passes || retryEval.score > evaluation.score) {
      finalReply = retry.reply
      finalWants = retry.wants_affiliation
      finalScore = retryEval.score
      finalReasons = retryEval.reasons
    }
  }

  // Si sigue fallando, notificar a humano + cambiar estado
  if (finalScore < 20) {
    log('pipeline', `low score ${finalScore}, notifying human`)
    await notifyHumanHandover(chatId, state?.nombre_completo || state?.nombre, msg)
    if (state) {
      state.step = 'esperando_humano'
      await saveState(chatId, state)
    }
  }

  // 6. Training storage (fire-and-forget, nunca bloquear)
  Promise.resolve()
    .then(() => knowledgeLayer.saveTrainingExample(chatId, msg, finalReply, finalScore, (finalReasons || []).join('; ')))
    .catch((e) => log('pipeline', `saveTrainingExample falló: ${e.message}`))

  // 7. Persistir historial (mismo contrato que askClaude)
  const updated = [...history, { role: 'user', content: msg }, { role: 'assistant', content: finalReply }]
  conversationHistory.set(chatId, updated)
  await saveHistory(chatId, updated)

  // Router tiene autoridad final sobre wants_affiliation (más determinista que el marcador del Generator).
  const wantsAffiliation = Boolean(routed.wants_affiliation || finalWants)

  return { reply: finalReply, wantsAffiliation, skillName: null, history: updated }
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
      // CRM logs sanitized by Codex (GPT-5) on 2026-04-24.
      log('members', `Member upserted para ${formatChatRef(chatId)}`)
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
      const messageId = body.messageData?.idMessage || body.idMessage || null
      const chatId = body.senderData?.chatId
      const sender = body.senderData?.senderName

      log('webhook', `Recibido: typeWebhook=${body.typeWebhook} msgType=${msgType} chat=${formatChatRef(chatId)} msgId=${messageId || 'none'} inFlight=${inFlightWebhooks}`)

      // GreenAPI manda este webhook cuando se agota la cuota del plan
      if (body.typeWebhook === 'quotaExceeded') {
        greenApiStats.quotaExceeded = true
        greenApiStats.quotaExceededAt = new Date().toISOString()
        log('webhook', `🚨 GREENAPI QUOTA EXCEEDED webhook recibido — bot no puede enviar`)
        await notifyAdminQuotaExceeded(
          `typeWebhook=${body.typeWebhook || 'unknown'} msgType=${msgType || 'unknown'} msgId=${messageId || 'none'}`,
          chatId
        )
        return
      }

      if (body.typeWebhook !== 'incomingMessageReceived') return
      if (!chatId) return

      // Serializar mensajes del mismo chatId — distintos números procesan en paralelo
      await withChatLock(chatId, () => handleMessage(body, msgType, chatId, sender, messageId, t0))
    } catch (e) {
      log('webhook', `Error inesperado outer: ${e.message}`)
    } finally {
      inFlightWebhooks--
      log('webhook', `Done in ${Date.now() - t0}ms inFlight=${inFlightWebhooks}`)
    }
  })
})

async function handleMessage(body, msgType, chatId, sender, messageId, t0) {
  try {
    let message = null  // Added by OpenCode (Rolli) on 2026-04-24

    // Idempotency guard added by Codex (GPT-5) on 2026-04-24.
    if (rememberInboundMessage(chatId, messageId)) {
      log('webhook', `Duplicado ignorado chat=${formatChatRef(chatId)} msgId=${messageId}`)
      return
    }

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
        log('webhook', `Audio recibido chat=${formatChatRef(chatId)} msgId=${messageId || 'none'} hasUrl=${!!downloadUrl}`)

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
                'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
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

        if (!checkRateLimit(chatId)) {
          log('webhook', `Rate limit exceeded para ${formatChatRef(chatId)}`)
          await sendWhatsAppMessage(chatId, 'Recibimos muchos mensajes de este número, intentá en un rato 🙏')
          return
        }

        const state = await loadState(chatId)
        state.last_message_at = new Date().toISOString()
        
        // Check if user explicitly wants to change language
        const lowerMsg = message.toLowerCase()
        const wantsToChangeLang = /(cambiar.*idioma|cambiar.*lenguaje|cambiar.*idiom|change.*language|change.*english|change.*spanish|change.*portuguese|switch.*english|switch.*spanish|switch.*portuguese|cambiar a español|cambiar a inglés|quiero en inglés|quiero en español|mudar.*idioma|quero em português)/i.test(lowerMsg)

        // Detect language from this message
        const detectedLang = detectLanguage(message)

        // Set language only on first contact — never auto-overwrite after that
        if (!state.language) {
          state.language = detectedLang
        }

        // Handle explicit language-change request
        if (wantsToChangeLang) {
          state.step = 'seleccionando_idioma'
          const langMenus = {
            es: '🌍 ¿Qué idioma preferís?\n\n1️⃣ Español\n2️⃣ English\n3️⃣ Português\n\nRespondé con el número.',
            en: '🌍 What language do you prefer?\n\n1️⃣ Español\n2️⃣ English\n3️⃣ Português\n\nReply with the number.',
            pt: '🌍 Qual idioma você prefere?\n\n1️⃣ Español\n2️⃣ English\n3️⃣ Português\n\nResponda com o número.',
          }
          await sendWhatsAppMessage(chatId, langMenus[state.language] || langMenus.es)
          await saveState(chatId, state)
          return
        }

        // Handle language selection response
        if (state.step === 'seleccionando_idioma') {
          const selectedLang = parseLanguageSelection(message)
          if (selectedLang) {
            state.language = selectedLang
            state.step = state.nombre ? 'conversando' : 'solicitando_nombre'
            await sendWhatsAppMessage(chatId, getLanguageConfirmation(selectedLang))
            if (state.step === 'solicitando_nombre') {
              const namePrompts = {
                es: '¿Cómo te llamás?',
                en: "What's your name?",
                pt: 'Como você se chama?',
              }
              await sendWhatsAppMessage(chatId, namePrompts[selectedLang] || namePrompts.es)
            }
            await saveState(chatId, state)
            return
          } else {
            const retryPrompts = {
              es: 'Por favor elegí 1, 2 o 3 (Español, English, Português)',
              en: 'Please choose 1, 2 or 3 (Español, English, Português)',
              pt: 'Por favor escolha 1, 2 ou 3 (Español, English, Português)',
            }
            await sendWhatsAppMessage(chatId, retryPrompts[state.language] || retryPrompts.es)
            await saveState(chatId, state)
            return
          }
        }
        
        log('webhook', `Texto recibido chat=${formatChatRef(chatId)} len=${message.length} step=${state.step}`)

        // Paso 1: Primer contacto — pedir nombre para trato direccional
        // [claude-opus-4.7] 2026-04-24: tratar 'Amigo' (fallback) y nombre vacío como "sin nombre"
        // Antes, si un estado quedaba con nombre='Amigo' de un fallback previo, el bot no volvía a preguntar.
        const nombreInvalido = !state.nombre || state.nombre === 'Amigo' || state.nombre.trim() === '' || state.nombre === chatId
        if (nombreInvalido && state.step !== 'solicitando_nombre' && state.step !== 'aclarando_nombre') {
          const lowerFirst = message.toLowerCase()
          const hasAffiliateIntent = /(inscrib|afili|asoci|anotar|sumar|unir|registr|hacerme socio|ser socio|hacerse socio)/i.test(lowerFirst)
            && !lowerFirst.endsWith('?') && !/^(c[oó]mo|qu[eé]|cu[aá]nto|d[oó]nde|cu[aá]ndo|por\s?qu[eé])\b/.test(lowerFirst)
          const lang = state.language || 'es'
          const INTRO = {
            es: (aff) => `¡Hola! 👋\n\nSoy el *asistente de IA* de *Indajaus*, un club cannábico en Argentina 🌿\n\nEstoy aquí para acompañarte en la inscripción, resolver dudas sobre cannabis medicinal y leyes, y entiendo *audios* 🎙️ e *imágenes* 📸. Hablo *español, inglés y portugués*.\n\n${aff ? '¡Genial que quieras sumarte! ' : ''}¿Cómo te llamás para empezar?`,
            en: (aff) => `Hello! 👋\n\nI'm *Indajaus*'s *AI assistant*, an Argentine cannabis club 🌿\n\nI'm here to help you with membership, answer questions about medical cannabis and Argentine law, and I understand *voice notes* 🎙️ and *images* 📸. I speak *Spanish, English and Portuguese*.\n\n${aff ? 'Great that you want to join! ' : ''}What\'s your name to get started?`,
            pt: (aff) => `Olá! 👋\n\nSou o *assistente de IA* da *Indajaus*, um clube de cannabis argentino 🌿\n\nEstou aqui para ajudar com a associação, responder dúvidas sobre cannabis medicinal e leis, e entendo *áudios* 🎙️ e *imagens* 📸. Falo *espanhol, inglês e português*.\n\n${aff ? 'Que bom que quer se associar! ' : ''}Como você se chama para começar?`,
          }
          await sendWhatsAppMessage(chatId, (INTRO[lang] || INTRO.es)(hasAffiliateIntent))
          state.step = 'solicitando_nombre'
          if (hasAffiliateIntent) state.wants_affiliation_pending = true
          state.last_greeting_at = new Date().toISOString()
          await saveState(chatId, state)
          return
        }

        // Usuario conocido que saluda → retomamos conversación sin pasar al pipeline
        const isGreetMsg = /^(hola|hello|hi\b|hey\b|ola\b|oi\b|olá|buenas?|buen\s?d[íi]a|buenos\s?d[íi]as|bom\s|boa\s|good\s)/i.test(message.trim())
        const ACTIVE_STEPS = ['recibiendo_documentos', 'completando_datos', 'solicitando_nombre', 'aclarando_nombre', 'seleccionando_idioma']
        if (!nombreInvalido && isGreetMsg && !ACTIVE_STEPS.includes(state.step)) {
          const lang = state.language || 'es'
          const RETURN_GREET = {
            es: `¡Hola de nuevo, *${state.nombre}*! 👋\n\n¿En qué te puedo ayudar hoy?`,
            en: `Hey *${state.nombre}*, welcome back! 👋\n\nHow can I help you today?`,
            pt: `Olá, *${state.nombre}*, que bom te ver! 👋\n\nComo posso ajudar hoje?`,
          }
          await sendWhatsAppMessage(chatId, RETURN_GREET[lang] || RETURN_GREET.es)
          await saveState(chatId, state)
          return
        }

        // Paso 2: Parsear nombre con IA y pasar a modo conversación (o aclarar si es ambiguo)
        if (state.step === 'solicitando_nombre' || state.step === 'aclarando_nombre') {
          const parsedName = await parseUserName(message)

          // Si es ambiguo y estamos en el primer intento, pedimos aclaración
          if (parsedName.necesita_aclarar && state.step === 'solicitando_nombre') {
            state.step = 'aclarando_nombre'
            state.raw_name_attempt = message.trim().substring(0, 100)
            await sendWhatsAppMessage(chatId, parsedName.pregunta_aclaracion)
            await saveState(chatId, state)
            log('webhook', `Nombre ambiguo chat=${formatChatRef(chatId)} → pedir aclaración`)
            return
          }

          // Si tras aclarar sigue ambiguo, tomamos la primera palabra razonable y seguimos
          state.nombre = parsedName.apodo
          state.nombre_completo = parsedName.nombre_completo
          state.step = 'conversando'
          state.last_greeting_at = new Date().toISOString()
          log('webhook', `Nombre confirmado chat=${formatChatRef(chatId)} → paso a conversando`)

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

          // Si el usuario llegó al saludo con intención de afiliarse ("Hola quería inscribirme"),
          // no le mostrés el menú: ya sabemos qué quiere — saltamos directo a pedir documentos.
          if (state.wants_affiliation_pending) {
            state.step = 'recibiendo_documentos'
            state.documentos = state.documentos || { dni: { frente: null, dorso: null }, reprocann: { frente: null, dorso: null } }
            delete state.wants_affiliation_pending
            const lang = state.language || 'es'
            const DOC_REQUEST = {
              es: `¡Un gusto, *${state.nombre}*! 🌿\n\nPara arrancar la inscripción necesito 2 cosas:\n• Tu DNI argentino (frente y dorso)\n• Tu certificado REPROCANN\n\nMandame las fotos cuando puedas 📸`,
              en: `Nice to meet you, *${state.nombre}*! 🌿\n\nTo start the membership process I need 2 things:\n• Your Argentine ID (front and back)\n• Your REPROCANN certificate\n\nSend the photos whenever you're ready 📸`,
              pt: `Prazer, *${state.nombre}*! 🌿\n\nPara iniciar a associação preciso de 2 coisas:\n• Seu RG argentino (frente e verso)\n• Seu certificado REPROCANN\n\nEnvie as fotos quando puder 📸`,
            }
            await sendWhatsAppMessage(chatId, DOC_REQUEST[lang] || DOC_REQUEST.es)
            await saveState(chatId, state)
            log('webhook', `Saludo+afiliación combinados: ${formatChatRef(chatId)} → recibiendo_documentos directo`)
            return
          }

          const lang = state.language || 'es'
          const WELCOME_MENU = {
            es: `¡Un gusto, *${state.nombre}*! 🌿\n\nAcá podemos ayudarte con:\n• 📝 Inscripción al club — es lo principal, te cuento qué necesitamos\n• 📚 Info sobre Indajaus — quiénes somos, cómo funciona, precios\n• 🌿 Dudas sobre cannabis — genéticas, REPROCANN, leyes\n• 👥 Hablar con alguien — si preferís atención humana\n\n¿Con qué te puedo ayudar?`,
            en: `Nice to meet you, *${state.nombre}*! 🌿\n\nHere's how I can help:\n• 📝 Club membership — the main one, I'll tell you what we need\n• 📚 About Indajaus — who we are, how it works, prices\n• 🌿 Cannabis questions — genetics, REPROCANN, laws\n• 👥 Talk to someone — if you prefer a human\n\nWhat can I help you with?`,
            pt: `Prazer, *${state.nombre}*! 🌿\n\nPosso ajudar com:\n• 📝 Associação ao clube — o principal, vou te explicar o que precisamos\n• 📚 Sobre Indajaus — quem somos, como funciona, preços\n• 🌿 Dúvidas sobre cannabis — genética, REPROCANN, leis\n• 👥 Falar com alguém — se preferir atendimento humano\n\nComo posso ajudar?`,
          }
          await sendWhatsAppMessage(chatId, WELCOME_MENU[lang] || WELCOME_MENU.es)
          await saveState(chatId, state)
          return
        }

        // Paso 3: Si está completando datos de REPROCANN/DNI por texto, guardar la respuesta
        if (state.step === 'completando_datos' && state.pendingFields && state.pendingFields.length > 0) {
          const currentField = state.pendingFields[0]
          state.collectedData[currentField.key] = message
          log('webhook', `Guardado campo ${currentField.key} para ${formatChatRef(chatId)}`)

          state.pendingFields.shift()

          if (state.pendingFields.length > 0) {
            const nextField = state.pendingFields[0]
            const _cdLang = state.language || 'es'
            const _cdSourceEs = nextField.source === 'DNI' ? 'del DNI' : 'de tu REPROCANN'
            const _cdSourceEn = nextField.source === 'DNI' ? 'from your ID' : 'from your REPROCANN'
            const _cdSourcePt = nextField.source === 'DNI' ? 'do seu RG' : 'do seu REPROCANN'
            const _cdNextMsgs = {
              es: `¡Joya! 🙌 Ahora me falta tu ${nextField.label} ${_cdSourceEs}. ¿Me lo escribís?`,
              en: `Got it! 🙌 Now I need your ${nextField.label} ${_cdSourceEn}. Can you write it?`,
              pt: `Ótimo! 🙌 Agora preciso do seu ${nextField.label} ${_cdSourcePt}. Pode escrever?`,
            }
            await sendWhatsAppMessage(chatId, _cdNextMsgs[_cdLang] || _cdNextMsgs.es)
            await saveState(chatId, state)
            return
          } else {
            state.step = 'completado'
            const _cdDoneLang = state.language || 'es'
            const _cdDoneMsgs = {
              es: `¡Impecaaa! 🎉\n\nYa tenemos todo lo que necesitamos para que nuestro staff lo revise y se comunique contigo para finalizar la inscripción.\n\nPero ya tenés un pie adentro del mejor club cannábico en Argentina! 🌿\n\nNos vemos en breve, bienvenido/a a Indajaus.`,
              en: `All done! 🎉\n\nWe have everything we need — our staff will review and reach out to finalize your membership.\n\nYou're one step away from Argentina's best cannabis club! 🌿\n\nSee you soon, welcome to Indajaus.`,
              pt: `Perfeito! 🎉\n\nJá temos tudo o que precisamos — nossa equipe vai revisar e entrar em contato para finalizar sua associação.\n\nVocê já tem um pé dentro do melhor clube de cannabis da Argentina! 🌿\n\nAté logo, bem-vindo/a à Indajaus.`,
            }
            await sendWhatsAppMessage(chatId, _cdDoneMsgs[_cdDoneLang] || _cdDoneMsgs.es)
            await saveState(chatId, state)
            return
          }
        }

        // Paso 4: Detectar pedido explícito de humano
        // Added by OpenCode (Rolli) on 2026-04-24
        // Detecta: "me pasas con humano", "necesito un ser humano", "quiero atención humana", etc
        const wantHuman = /hablar.*(?:persona|humano)|pas(?:a|ar|as|á).*(?:alguien|humano|ser\s+humano|con)|pasame|pasá?me|contactar.*(?:equipo|humano|persona)|speak.*human|agente.*humano|atenci[oó]n.*humana|necesito.*humano|quiero.*humano|ser\s+humano|un\s+humano/i.test(message)
        if (wantHuman) {
          log('webhook', `Pedido de humano chat=${formatChatRef(chatId)}`)

          // Notificar al admin por email (principal — siempre que esté configurado)
          await notifyHumanHandover(chatId, state.nombre_completo || state.nombre, message)

          // Notificar también por WhatsApp si hay número admin configurado (best-effort)
          // [claude-opus-4.7] 2026-04-24: jamás mandar la plantilla de admin al mismo chat que la disparó.
          // Si ADMIN_WHATSAPP coincide con el chatId del usuario, el template interno leakea a la conversación.
          if (ADMIN_WHATSAPP && ADMIN_WHATSAPP !== chatId) {
            const handoverMsg = `📞 SOLICITUD DE ATENCIÓN HUMANA\n\n👤 ${state.nombre_completo || state.nombre || 'Sin nombre'}\n📱 ${chatId}\n💬 "${message}"\n\nEl usuario quiere hablar con alguien del equipo.`
            await sendWhatsAppMessage(ADMIN_WHATSAPP, handoverMsg)
          } else if (ADMIN_WHATSAPP === chatId) {
            log('webhook', `⚠️ Skip admin WA: ADMIN_WHATSAPP===chatId (${formatChatRef(chatId)}) — habría leakeado plantilla al usuario`)
          }

          // [claude-opus-4.7] 2026-04-24: no cortar el chat. Mantener al usuario activo
          // mientras espera al humano — objetivo primario sigue siendo la inscripción.
          const nombreSaludo = state.nombre && state.nombre !== 'Amigo' ? `, ${state.nombre}` : ''
          const _legHoLang = state?.language || 'es'
          const _legHoMsgs = {
            es: `Listo${nombreSaludo} 👋 Ya notifiqué al staff y te van a contactar apenas puedan.\n\nMientras tanto puedo contarte sobre el club, las genéticas disponibles, cómo funciona el REPROCANN, o arrancar con la inscripción si preferís. ¿Te interesa?`,
            en: `Got it${nombreSaludo} 👋 I've notified the staff and they'll reach out soon.\n\nMeanwhile I can tell you about the club, available genetics, how REPROCANN works, or we can start your membership. Interested?`,
            pt: `Feito${nombreSaludo} 👋 Notifiquei o staff e eles entrarão em contato em breve.\n\nEnquanto isso posso te contar sobre o clube, genéticas disponíveis, como funciona o REPROCANN, ou iniciar sua associação. Tem interesse?`,
          }
          await sendWhatsAppMessage(chatId, _legHoMsgs[_legHoLang] || _legHoMsgs.es)
          // Marcar step para que el admin lo vea en el dashboard
          state.step = 'esperando_humano'
          await saveState(chatId, state)
          return
        }

        // Paso 5: Modo atención al cliente — Claude responde, detecta intent afiliación + skill.
        // [claude-opus-4.7] 2026-04-24 Task #48: gate del pipeline nuevo detrás de USE_NEW_PIPELINE.
        log('webhook', `USE_NEW_PIPELINE=${USE_NEW_PIPELINE} state.lang=${state?.language}`)
        const { reply, wantsAffiliation, skillName, history: updatedHistory } = USE_NEW_PIPELINE
          ? await runNewPipeline(message, chatId, state)
          : await askClaude(message, chatId)

        // Paso 5b: Si Claude pidió invocar una skill, ejecutarla — su respuesta reemplaza a la del orquestador
        if (skillName && SKILL_NAMES.includes(skillName)) {
          log('webhook', `Invocando skill=${skillName} para ${formatChatRef(chatId)}`)
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
            log('webhook', `Skill ${skillName} respondió a ${formatChatRef(chatId)}`)
          } else {
            // Fallback: si la skill falla, mandamos la respuesta original del orquestador
            log('webhook', `Skill ${skillName} falló, usando fallback del orquestador`)
            await sendWhatsAppMessage(chatId, reply)
          }
        } else {
          await sendWhatsAppMessage(chatId, reply)
        }

        log('webhook', `Respuesta enviada a ${formatChatRef(chatId)} | wantsAffiliation=${wantsAffiliation} | skill=${skillName || 'none'}`)

        // Paso 6: Si Claude detectó intent de afiliación, transicionar al flujo de documentos
        if (wantsAffiliation && state.step !== 'recibiendo_documentos' && state.step !== 'completando_datos' && state.step !== 'completado') {
          state.step = 'recibiendo_documentos'
          state.documentos = state.documentos || { dni: { frente: null, dorso: null }, reprocann: { frente: null, dorso: null } }
          await saveState(chatId, state)
          log('webhook', `Transición a recibiendo_documentos para ${formatChatRef(chatId)}`)
        }
      } else if (msgType === 'imageMessage') {
        const imageUrl = body.messageData?.downloadUrl ||
                         body.messageData?.fileMessageData?.downloadUrl ||
                         body.messageData?.imageMessage?.downloadUrl
        if (!imageUrl) {
          log('webhook', `No downloadUrl encontrada`)
          return
        }

        log('webhook', `Imagen recibida chat=${formatChatRef(chatId)} msgId=${messageId || 'none'}`)

        if (!checkRateLimit(chatId)) {
          log('webhook', `Rate limit exceeded para ${formatChatRef(chatId)}`)
          await sendWhatsAppMessage(chatId, 'Recibimos muchos mensajes de este número, intentá en un rato 🙏')
          return
        }

        // Initialize state if needed (v4.0: load from DB)
        const state = await loadState(chatId)
        state.last_message_at = new Date().toISOString()
        const imgLang = state.language || 'es'

        // v4.0: Si no tiene nombre y no está ya solicitándolo, pedir nombre
        if ((!state.nombre || state.nombre === chatId) && state.step !== 'solicitando_nombre') {
          log('webhook', `Imagen sin nombre registrado: solicitando nombre para ${formatChatRef(chatId)}`)
          state.step = 'solicitando_nombre'
          state.last_greeting_at = new Date().toISOString()
          await saveState(chatId, state)
          const askNameMsgs = { es: '¿Cuál es tu nombre antes de continuar?', en: "What's your name before we continue?", pt: 'Qual é o seu nome antes de continuar?' }
          await sendWhatsAppMessage(chatId, askNameMsgs[imgLang] || askNameMsgs.es)
          return
        }

        // Si está solicitando nombre, ignora imágenes hasta que responda
        if (state.step === 'solicitando_nombre') {
          log('webhook', `Esperando nombre, ignorando imagen para ${formatChatRef(chatId)}`)
          const waitNameMsgs = { es: 'Por favor respondé con tu nombre 👇', en: 'Please reply with your name first 👇', pt: 'Por favor responda com seu nome primeiro 👇' }
          await sendWhatsAppMessage(chatId, waitNameMsgs[imgLang] || waitNameMsgs.es)
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
        const analysis = await analyzeImageWithClaude(imageUrl, state)
        if (!analysis) {
          const imgErrMsgs = { es: 'Tuvimos un problema analizando la imagen, intentá de nuevo 🙏', en: 'We had a problem analyzing the image, please try again 🙏', pt: 'Tivemos um problema ao analisar a imagem, tente novamente 🙏' }
          await sendWhatsAppMessage(chatId, imgErrMsgs[imgLang] || imgErrMsgs.es)
          return
        }

        // Solo rechazar si tipo === 'OTRO' (no es un documento identificable)
        if (detected.tipo === 'OTRO') {
          const notDocMsgs = { es: 'No logro identificar un documento en esa imagen 🤔 ¿Podés mandarme tu DNI o REPROCANN?', en: "I can't identify a document in that image 🤔 Can you send your ID or REPROCANN?", pt: 'Não consigo identificar um documento nessa imagem 🤔 Pode me enviar seu RG ou REPROCANN?' }
          await sendWhatsAppMessage(chatId, notDocMsgs[imgLang] || notDocMsgs.es)
          return
        }

        if (detected.tipo === 'DOCUMENTO_EXTRANJERO') {
          const foreignDocMsgs = { es: 'Ese documento no parece ser argentino 🛑 Necesitamos tu DNI argentino 🇦🇷 y el REPROCANN de acá. ¿Los tenés?', en: "That document doesn't appear to be Argentine 🛑 We need your Argentine ID 🇦🇷 and the REPROCANN from here. Do you have them?", pt: 'Esse documento não parece ser argentino 🛑 Precisamos do seu RG argentino 🇦🇷 e do REPROCANN daqui. Você os tem?' }
          await sendWhatsAppMessage(chatId, foreignDocMsgs[imgLang] || foreignDocMsgs.es)
          return
        }

        // Procesar según tipo de documento
        if (detected.tipo === 'REPROCANN') {
          if (detected.ambosSides) {
            // REPROCANN completo (ambos lados)
            const data = await extractReprocannData(imageUrl)
            state.documentos.reprocann.frente = { url: imageUrl, data }
            state.documentos.reprocann.dorso = { url: imageUrl, data }
            log('webhook', `REPROCANN completo (ambos lados) para ${formatChatRef(chatId)}`)
          } else {
            // Un solo lado, determinar si es frente o dorso
            if (!state.documentos.reprocann.frente) {
              // Asumir frente
              const data = await extractReprocannData(imageUrl)
              state.documentos.reprocann.frente = { url: imageUrl, data }
              log('webhook', `REPROCANN frente para ${formatChatRef(chatId)}`)
              const _rpLang = state.language || 'es'
              const _rpDorsoMsgs = {
                es: `${analysis}\n\nAhora mandame el dorso y vamos por el siguiente 📸`,
                en: `${analysis}\n\nNow send me the back side and we'll continue 📸`,
                pt: `${analysis}\n\nAgora me manda o verso e continuamos 📸`,
              }
              await sendWhatsAppMessage(chatId, _rpDorsoMsgs[_rpLang] || _rpDorsoMsgs.es)
              await saveState(chatId, state)  // v4.0: persist to DB
              return
            } else if (!state.documentos.reprocann.dorso) {
              // Ya tiene frente, esto es dorso
              const data = await extractReprocannData(imageUrl)
              state.documentos.reprocann.dorso = { url: imageUrl, data }
              log('webhook', `REPROCANN dorso para ${formatChatRef(chatId)}`)
            }
          }
        } else if (detected.tipo === 'DNI') {
          if (detected.ambosSides) {
            // DNI completo (ambos lados)
            const data = await extractDocumentData(imageUrl, 'DNI')
            state.documentos.dni.frente = { url: imageUrl, data }
            state.documentos.dni.dorso = { url: imageUrl, data }
            log('webhook', `DNI completo (ambos lados) para ${formatChatRef(chatId)}`)
          } else {
            // Un solo lado, determinar si es frente o dorso
            if (!state.documentos.dni.frente) {
              // Asumir frente
              const data = await extractDocumentData(imageUrl, 'DNI')
              state.documentos.dni.frente = { url: imageUrl, data }
              log('webhook', `DNI frente para ${formatChatRef(chatId)}`)
              const _dniLang = state.language || 'es'
              const _dniDorsoMsgs = {
                es: `${analysis}\n\nAhora mandame el dorso y vamos por el siguiente 📸`,
                en: `${analysis}\n\nNow send me the back side and we'll continue 📸`,
                pt: `${analysis}\n\nAgora me manda o verso e continuamos 📸`,
              }
              await sendWhatsAppMessage(chatId, _dniDorsoMsgs[_dniLang] || _dniDorsoMsgs.es)
              await saveState(chatId, state)  // v4.0: persist to DB
              return
            } else if (!state.documentos.dni.dorso) {
              // Ya tiene frente, esto es dorso
              const data = await extractDocumentData(imageUrl, 'DNI')
              state.documentos.dni.dorso = { url: imageUrl, data }
              log('webhook', `DNI dorso para ${formatChatRef(chatId)}`)
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
          const listaFaltantes = documentosFaltantes.map(doc => `• ${doc}`).join('\n')
          const _faltLang = state.language || 'es'
          const _faltMsgs = {
            es: `¡Joya che! 🔥 Se ven los datos perfectos.\n\nEstamos a un paso solamente. Me falta:\n${listaFaltantes}\n\nMandame el que te falta y listo.`,
            en: `Looking great! 🔥 Data looks perfect.\n\nAlmost there — still missing:\n${listaFaltantes}\n\nSend what's left and we're done.`,
            pt: `Ótimo! 🔥 Os dados estão perfeitos.\n\nQuase lá — ainda falta:\n${listaFaltantes}\n\nManda o que falta e terminamos.`,
          }
          await sendWhatsAppMessage(chatId, _faltMsgs[_faltLang] || _faltMsgs.es)
          await saveState(chatId, state)
          return
        }

        // Tenemos todos los 4 documentos, validar datos de ambos documentos
        const reprocannData = state.documentos.reprocann.dorso?.data || state.documentos.reprocann.frente?.data
        const dniData = state.documentos.dni.dorso?.data || state.documentos.dni.frente?.data

        const missing = validateCriticalFields(dniData, reprocannData)
        log('webhook', `Campos críticos faltantes: ${missing.map(m => `${m.source}:${m.key}`).join(', ') || 'ninguno'}`)

        if (missing.length > 0) {
          state.step = 'completando_datos'
          state.pendingFields = missing
          const firstField = missing[0]
          const _mfLang = state.language || 'es'
          const _mfSrc = {
            es: firstField.source === 'DNI' ? 'del DNI' : 'de tu REPROCANN',
            en: firstField.source === 'DNI' ? 'from your ID' : 'from your REPROCANN',
            pt: firstField.source === 'DNI' ? 'do seu RG' : 'do seu REPROCANN',
          }
          const _mfMsgs = {
            es: `¡Ufff! 😅 Logré leer algunos datos nada más.\n\nMe falta tu ${firstField.label} ${_mfSrc.es}. ¿Me lo escribís?`,
            en: `Hmm 😅 I could only read some of the data.\n\nI'm missing your ${firstField.label} ${_mfSrc.en}. Can you write it?`,
            pt: `Hmm 😅 Só consegui ler alguns dados.\n\nPreciso do seu ${firstField.label} ${_mfSrc.pt}. Pode escrever?`,
          }
          await sendWhatsAppMessage(chatId, _mfMsgs[_mfLang] || _mfMsgs.es)
          await saveState(chatId, state)
          return
        }

        // Todos los documentos y campos están completos!
        state.step = 'completado'
        const _imgDoneLang = state.language || 'es'
        const _imgDoneMsgs = {
          es: `¡Impecaaa! 🎉\n\nYa tenemos todo lo que necesitamos para que nuestro staff lo revise y se comunique contigo para finalizar la inscripción.\n\nPero ya tenés un pie adentro del mejor club cannábico en Argentina! 🌿\n\nNos vemos en breve, bienvenido/a a Indajaus.`,
          en: `All done! 🎉\n\nWe have everything we need — our staff will review and reach out to finalize your membership.\n\nYou're one step away from Argentina's best cannabis club! 🌿\n\nSee you soon, welcome to Indajaus.`,
          pt: `Perfeito! 🎉\n\nJá temos tudo o que precisamos — nossa equipe vai revisar e entrar em contato para finalizar sua associação.\n\nVocê já tem um pé dentro do melhor clube de cannabis da Argentina! 🌿\n\nAté logo, bem-vindo/a à Indajaus.`,
        }
        await sendWhatsAppMessage(chatId, _imgDoneMsgs[_imgDoneLang] || _imgDoneMsgs.es)

        if (ADMIN_EMAIL) {
          log('webhook', `Enviando email de notificación para ${state.nombre}`)
          const imageUrls = {
            dni_frente: state.documentos.dni.frente?.url,
            dni_dorso: state.documentos.dni.dorso?.url,
            reprocann_frente: state.documentos.reprocann.frente?.url,
            reprocann_dorso: state.documentos.reprocann.dorso?.url,
          }
          await notifyAdmin(chatId, state.nombre_completo || state.nombre, dniData, reprocannData, state.collectedData, imageUrls)

          // Validar que DNI y REPROCANN sean de la misma persona
          const nombreDniVal = dniData ? `${dniData.nombre || ''} ${dniData.apellido || ''}`.trim() : null
          const nameVal = validateNameMatch(nombreDniVal, reprocannData?.nombre || null)
          if (nameVal.status === 'mismatch') {
            log('validation', `⚠️ MISMATCH nombres: DNI="${nombreDniVal}" REPROCANN="${reprocannData?.nombre}" score=${nameVal.score}%`)
          }
        }

        await saveState(chatId, state)  // v4.0: persist to DB

        // v4.0: Insert member record for CRM (future campaigns)
        await insertMember(chatId, state.nombre_completo || state.nombre, reprocannData, state.collectedData)

        log('webhook', `Imagen procesada para ${formatChatRef(chatId)}`)
      } else {
        log('webhook', `Tipo no soportado: ${msgType}`)
      }
  } catch (e) {
    log('webhook', `Error inesperado handler (chat=${formatChatRef(chatId)}, t=${Date.now() - t0}ms): ${e.message}`)
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
    email: {
      adminEmailConfigured: !!ADMIN_EMAIL,
      resendConfigured: !!resend,
      adminEmail: ADMIN_EMAIL ? ADMIN_EMAIL.substring(0, 3) + '***' : null,
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

app.get('/test-handover-email', async (req, res) => {
  if (!ensureTestRoutesEnabled(req, res)) return

  // Diagnostics
  const diag = {
    resendConfigured: !!resend,
    adminEmailSet: !!ADMIN_EMAIL,
    adminEmail: ADMIN_EMAIL ? ADMIN_EMAIL.substring(0, 5) + '***' : 'NOT SET',
  }

  if (!resend || !ADMIN_EMAIL) {
    return res.json({
      ok: false,
      error: 'resend or ADMIN_EMAIL not configured',
      diagnostics: diag
    })
  }

  try {
    // Send test email
    const result = await resend.emails.send({
      from: 'Bot Club <DEFAULT_FROM_EMAIL>',
      to: ADMIN_EMAIL,
      subject: '[TEST] Verificación de notificaciones de atención humana',
      html: `
        <h2 style="color:#2e7d32;">✅ Email de prueba</h2>
        <p>Este es un email de prueba para verificar que el sistema de notificaciones de atención humana está funcionando correctamente.</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        <p style="margin-top:20px; padding:12px; background:#e8f5e9; border-left:4px solid #4caf50;">
          ✅ Si recibes este email, el sistema está funcionando.
        </p>
      `,
    })

    res.json({
      ok: true,
      message: 'Test email enviado',
      emailId: result.id,
      diagnostics: diag
    })
  } catch (e) {
    res.json({
      ok: false,
      error: e.message,
      diagnostics: diag
    })
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

// Periodic cleanup added by Codex (GPT-5) on 2026-04-24 to avoid unbounded
// growth in ephemeral in-memory caches used for rate limiting and dedupe.
setInterval(pruneEphemeralState, 15 * 60 * 1000)

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

// Validar que nombres de DNI y REPROCANN sean de la misma persona
function validateNameMatch(nombreDni, nombreReprocann) {
  if (!nombreDni && !nombreReprocann) return { status: 'incomplete', score: 0 }
  if (!nombreDni || !nombreReprocann) return { status: 'incomplete', score: 0 }

  const normalize = (s) => s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim()

  const a = normalize(nombreDni).split(/\s+/).filter(Boolean)
  const b = normalize(nombreReprocann).split(/\s+/).filter(Boolean)

  const setA = new Set(a)
  const common = b.filter(w => setA.has(w)).length
  const score = common / Math.max(a.length, b.length)

  return {
    status: score >= 0.5 ? 'ok' : 'mismatch',
    score: Math.round(score * 100),
    nombres: { dni: nombreDni, reprocann: nombreReprocann },
  }
}

app.get('/admin/qa-report', async (req, res) => {
  if (!requireDashboardAccess(req, res)) return
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
  if (!requireDashboardAccess(req, res)) return
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

// ========== ADMIN CONFIG (OpenCode/Rolli 2026-04-24) ==========

// Token verification — returns role so the dashboard can apply permissions.
app.get('/admin/verify', (req, res) => {
  const role = requireDashboardAccess(req, res)
  if (!role) return
  res.json({ ok: true, role })
})

// Backward-compat: redirige al dashboard unificado
app.get('/admin/config-html', (req, res) => res.redirect('/dashboard.html'))
app.get('/admin', (req, res) => res.redirect('/dashboard.html'))
app.get('/dashboard.html', (req, res) => res.redirect('/dashboard.html'))
app.get('/dashboard2.html', (req, res) => res.redirect('/dashboard2.html'))
app.get('/', (req, res) => res.redirect('/dashboard.html'))

app.get('/admin/config', async (req, res) => {
  const role = requireDashboardAccess(req, res)
  if (!role) return
  try {
    const { data, error } = await supabase
      .from('bot_config')
      .select('*')
      .eq('id', 'whatsapp_bot')
      .single()
    if (error) throw error
    // Clients only receive club-public fields, not bot internals.
    if (role === 'client') {
      const { club_nombre, club_ubicacion, horarios, geneticas, reprocann_url } = data || {}
      return res.json({ ok: true, config: { club_nombre, club_ubicacion, horarios, geneticas, reprocann_url } })
    }
    res.json({ ok: true, config: data })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.post('/admin/config', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const updates = req.body
    updates.updated_at = new Date().toISOString()
    const { data, error } = await supabase
      .from('bot_config')
      .update(updates)
      .eq('id', 'whatsapp_bot')
      .select('*')
      .single()
    if (error) throw error
    res.json({ ok: true, config: data })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin knowledge stats endpoint
app.get('/admin/knowledge-stats', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const { getKnowledgeStats } = await import('./src/knowledge/index.js')
    const stats = await getKnowledgeStats()
    res.json({ ok: true, stats })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Admin leads endpoint — para dashboard de validación de nombres + estado de flujo
app.get('/admin/leads', async (req, res) => {
  if (!requireDashboardAccess(req, res)) return
  if (!supabase) return res.status(500).json({ ok: false, error: 'Supabase no configurado' })

  const limit = Math.min(parseInt(req.query.limit) || 100, 200)
  const stepFilter = req.query.step || null

  try {
    let query = supabase.from('patient_state').select('*')
      .order('updated_at', { ascending: false }).limit(limit)
    if (stepFilter) query = query.eq('step', stepFilter)

    const { data: states, error } = await query
    if (error) throw error

    const { data: members } = await supabase
      .from('members').select('chat_id, dni, reprocann_vencimiento')

    const membersMap = {}
    for (const m of members || []) membersMap[m.chat_id] = m

    const leads = (states || []).map(s => {
      const cd = s.collected_data || {}
      const nombreDni = cd.nombre_dni ? `${cd.nombre_dni} ${cd.apellido_dni || ''}`.trim() : null
      const nombreReprocann = cd.nombre_reprocann || null
      const validation = validateNameMatch(nombreDni, nombreReprocann)

      return {
        chat_id: s.chat_id,
        nombre_usuario: s.nombre || 'Sin nombre',
        step: s.step,
        validation,
        documents: {
          dni_frente: !!(s.documentos?.dni?.frente),
          dni_dorso: !!(s.documentos?.dni?.dorso),
          reprocann: !!(s.documentos?.reprocann?.frente),
        },
        member: membersMap[s.chat_id] || null,
        last_message_at: s.last_message_at,
        updated_at: s.updated_at,
      }
    })

    const byStep = {}
    for (const l of leads) byStep[l.step] = (byStep[l.step] || 0) + 1

    res.json({
      ok: true,
      summary: {
        total: leads.length,
        by_step: byStep,
        validation: {
          ok: leads.filter(l => l.validation.status === 'ok').length,
          mismatch: leads.filter(l => l.validation.status === 'mismatch').length,
          incomplete: leads.filter(l => l.validation.status === 'incomplete').length,
        },
      },
      leads,
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Update lead step (for manually marking as contacted)
app.post('/admin/lead/step', async (req, res) => {
  if (!requireDashboardAccess(req, res)) return
  if (!supabase) return res.status(500).json({ ok: false, error: 'Supabase no configurado' })

  const { chat_id, step } = req.body
  if (!chat_id || !step) {
    return res.status(400).json({ ok: false, error: 'chat_id y step requeridos' })
  }

  const VALID_STEPS = ['inicio', 'solicitando_nombre', 'aclarando_nombre', 'recibiendo_documentos', 'completando_datos', 'conversando', 'completado', 'esperando_humano', 'contactado', 'inscrito']
  if (!VALID_STEPS.includes(step)) {
    return res.status(400).json({ ok: false, error: `Step inválido: ${step}` })
  }

  try {
    const { error } = await supabase
      .from('patient_state')
      .update({ step, updated_at: new Date().toISOString() })
      .eq('chat_id', chat_id)

    if (error) throw error

    // Si se marca como "inscripto", enviar mensaje de bienvenida al usuario
    if (step === 'inscrito') {
      const { data: state } = await supabase
        .from('patient_state')
        .select('language, nombre')
        .eq('chat_id', chat_id)
        .single()
      
      const lang = state?.language || 'es'
      const nombre = state?.nombre || ''
      
      const WELCOME_MSG = {
        es: `¡Bienvenido a Indajaus! 🎉\n\nYa forms parte del club. podés visitar nuestras instalaciones en Palermo, Buenos Aires.\n\nHorario:\n• Lunes a Viernes: 11:00 - 20:00\n• Sábados: 12:00 - 21:00\n• Domingos: 12:00 - 19:00\n\nTe esperamos! 🌿`,
        en: `Welcome to Indajaus! 🎉\n\nYou're now a member of the club. You can visit us in Palermo, Buenos Aires.\n\nHours:\n• Mon-Fri: 11:00 - 20:00\n• Saturdays: 12:00 - 21:00\n• Sundays: 12:00 - 19:00\n\nSee you soon! 🌿`,
        pt: `Bem-vindo ao Indajaus! 🎉\n\nVocê agora é membro do clube. Pode nos visitar em Palermo, Buenos Aires.\n\nHorário:\n• Segunda a Sexta: 11:00 - 20:00\n• Sábados: 12:00 - 21:00\n• Domingos: 12:00 - 19:00\n\nNos vemos em breve! 🌿`
      }
      
      await sendWhatsAppMessage(chat_id, WELCOME_MSG[lang] || WELCOME_MSG.es)
      log('admin', `Welcome message sent to ${chat_id}`)
    }

    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ========== END GREENAPI STATUS ==========

// ========== END QA AGENT ==========

// ========== DASHBOARD ENDPOINTS (Fase Dashboard B — 2026-04-26) ==========

// Historial completo de una conversación (todos los mensajes user/bot)
app.get('/admin/conversation/:chatId', async (req, res) => {
  if (!requireDashboardAccess(req, res)) return
  if (!supabase) return res.status(500).json({ ok: false, error: 'Supabase no configurado' })

  const chatId = decodeURIComponent(req.params.chatId)
  try {
    const [convRes, stateRes, memberRes, trainingRes] = await Promise.all([
      supabase.from('conversation_history').select('*').eq('chat_id', chatId).maybeSingle(),
      supabase.from('patient_state').select('*').eq('chat_id', chatId).maybeSingle(),
      supabase.from('members').select('*').eq('chat_id', chatId).maybeSingle(),
      supabase.from('bot_training').select('user_msg, bot_reply, score, reason, created_at')
        .eq('chat_id', chatId).order('created_at', { ascending: false }).limit(50),
    ])

    res.json({
      ok: true,
      chat_id: chatId,
      conversation: convRes.data || null,
      state: stateRes.data || null,
      member: memberRes.data || null,
      training_history: trainingRes.data || [],
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Listado de training examples con filtros (score, búsqueda, límite)
app.get('/admin/training', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  if (!supabase) return res.status(500).json({ ok: false, error: 'Supabase no configurado' })

  const limit = Math.min(parseInt(req.query.limit) || 50, 200)
  const maxScore = req.query.max_score ? parseInt(req.query.max_score) : null
  const minScore = req.query.min_score ? parseInt(req.query.min_score) : null
  const search = (req.query.search || '').trim()

  try {
    let query = supabase.from('bot_training')
      .select('id, chat_id, user_msg, bot_reply, score, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (maxScore !== null) query = query.lte('score', maxScore)
    if (minScore !== null) query = query.gte('score', minScore)
    if (search) query = query.or(`user_msg.ilike.%${search}%,bot_reply.ilike.%${search}%`)

    const { data, error } = await query
    if (error) throw error

    res.json({ ok: true, count: data.length, training: data })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Stats agregadas de training: distribución de scores, promedios, totales
app.get('/admin/training/stats', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  if (!supabase) return res.status(500).json({ ok: false, error: 'Supabase no configurado' })

  const sinceDays = Math.min(parseInt(req.query.days) || 30, 365)
  const sinceIso = new Date(Date.now() - sinceDays * 86400000).toISOString()

  try {
    const { data, error } = await supabase.from('bot_training')
      .select('score, created_at')
      .gte('created_at', sinceIso)

    if (error) throw error

    const total = data.length
    const sum = data.reduce((s, r) => s + (r.score || 0), 0)
    const avg = total > 0 ? Math.round(sum / total) : 0

    const buckets = { '0-29': 0, '30-49': 0, '50-69': 0, '70-89': 0, '90-100': 0 }
    for (const r of data) {
      const s = r.score || 0
      if (s < 30) buckets['0-29']++
      else if (s < 50) buckets['30-49']++
      else if (s < 70) buckets['50-69']++
      else if (s < 90) buckets['70-89']++
      else buckets['90-100']++
    }

    const failing = data.filter(r => (r.score || 0) < 70).length
    const failRate = total > 0 ? Math.round((failing / total) * 100) : 0

    res.json({
      ok: true,
      since_days: sinceDays,
      total,
      avg_score: avg,
      fail_rate_pct: failRate,
      failing,
      passing: total - failing,
      buckets,
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Skills usage — count por skill desde bot_training (asumiendo reason contiene la skill o usa logs)
app.get('/admin/skills/usage', async (req, res) => {
  if (!requireAdminAccess(req, res)) return
  if (!supabase) return res.status(500).json({ ok: false, error: 'Supabase no configurado' })

  const sinceDays = Math.min(parseInt(req.query.days) || 30, 365)
  const sinceIso = new Date(Date.now() - sinceDays * 86400000).toISOString()

  try {
    // Heurística: buscamos invocaciones de skill en reason / bot_reply.
    // Una vez tengamos columna `skill` dedicada en bot_training esto se simplifica.
    const { data, error } = await supabase.from('bot_training')
      .select('reason, bot_reply, score, created_at')
      .gte('created_at', sinceIso)

    if (error) throw error

    const counts = { legal_faq: 0, reprocann_guide: 0, genetics_expert: 0 }
    const scores = { legal_faq: [], reprocann_guide: [], genetics_expert: [] }

    for (const r of data) {
      const haystack = `${r.reason || ''} ${r.bot_reply || ''}`.toLowerCase()
      for (const skill of Object.keys(counts)) {
        if (haystack.includes(skill)) {
          counts[skill]++
          scores[skill].push(r.score || 0)
        }
      }
    }

    const summary = Object.keys(counts).map(skill => {
      const arr = scores[skill]
      const avg = arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null
      return { skill, count: counts[skill], avg_score: avg }
    })

    res.json({ ok: true, since_days: sinceDays, total_messages: data.length, skills: summary })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Lista de chat IDs únicos con resumen — para tabs de "todas las conversaciones"
app.get('/admin/conversations', async (req, res) => {
  if (!requireDashboardAccess(req, res)) return
  if (!supabase) return res.status(500).json({ ok: false, error: 'Supabase no configurado' })

  const limit = Math.min(parseInt(req.query.limit) || 50, 200)

  try {
    const { data, error } = await supabase.from('conversation_history')
      .select('chat_id, messages, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    const conversations = data.map(c => {
      const msgs = c.messages || []
      const lastMsg = msgs[msgs.length - 1]
      return {
        chat_id: c.chat_id,
        message_count: msgs.length,
        last_message_role: lastMsg?.role || null,
        last_message_preview: lastMsg?.content?.substring(0, 100) || null,
        updated_at: c.updated_at,
      }
    })

    res.json({ ok: true, count: conversations.length, conversations })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// Notificaciones config — lee/escribe knowledge/notificaciones.config.json
const NOTIFICATIONS_PATH = './knowledge/notificaciones.config.json'

app.get('/admin/notifications', (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const raw = readFileSync(NOTIFICATIONS_PATH, 'utf8')
    res.json({ ok: true, config: JSON.parse(raw) })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.post('/admin/notifications', (req, res) => {
  if (!requireAdminAccess(req, res)) return
  try {
    const incoming = req.body
    // Validación mínima: campos requeridos presentes
    if (!incoming.modo || !incoming.intervalos_test_minutos || !incoming.intervalos_produccion_minutos || !incoming.max_intentos) {
      return res.status(400).json({ ok: false, error: 'Faltan campos requeridos' })
    }
    // Preservar comentarios del archivo original
    const existing = JSON.parse(readFileSync(NOTIFICATIONS_PATH, 'utf8'))
    const merged = {
      ...Object.fromEntries(Object.entries(existing).filter(([k]) => k.startsWith('_'))),
      ...incoming,
    }
    writeFileSync(NOTIFICATIONS_PATH, JSON.stringify(merged, null, 2), 'utf8')
    res.json({ ok: true, config: merged })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ========== END DASHBOARD ENDPOINTS ==========

// ========== v4.0: TEST ROUTES (Fase 5) ==========

// Endpoint de diagnóstico — muestra qué env vars tiene el bot (sin exponer secretos)
app.get('/test/env-check', async (req, res) => {
  if (!ensureTestRoutesEnabled(req, res)) return
  const url = process.env.SUPABASE_URL || ''
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
    // Test route updated by Codex (GPT-5) on 2026-04-24:
    // server-side paths now rely only on service_role.
    service_role_key: {
      configured: !!svc,
      length: svc.length,
      preview: svc.slice(0, 20) + '...',
      endsWithSpace: svc !== svc.trim(),
      hasNewline: svc.includes('\n'),
    },
    using_key: svc ? 'service_role' : 'NONE',
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
