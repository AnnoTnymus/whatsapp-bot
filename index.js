import 'dotenv/config.js'
import express from 'express'
import fetch from 'node-fetch'
import { readFileSync } from 'fs'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const app = express()
app.use(express.json())

const GREEN_URL = process.env.GREEN_API_URL ?? 'https://7107.api.greenapi.com'
const GREEN_INSTANCE = process.env.GREEN_API_INSTANCE_ID ?? '7107588003'
const GREEN_TOKEN = process.env.GREEN_API_TOKEN ?? '5d7a2dd449bd48deaed916c65ae197c86ceb73a683254677b5'
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY?.replace(/[^\x20-\x7E]/g, '').trim()
const MODEL = 'claude-opus-4-7'
const RESEND_API_KEY = process.env.RESEND_API_KEY
const ADMIN_EMAIL = process.env.ADMIN_EMAIL

// Supabase client (v4.0 — persistence)
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
)

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
        documentos: { dni: { frente: null, dorso: null }, reprocann: { frente: null, dorso: null } },
        collectedData: {},
        pendingFields: [],
      }
    }

    return {
      step: data.step,
      nombre: data.nombre,
      documentos: data.documentos,
      collectedData: data.collected_data,
      pendingFields: data.pending_fields,
      last_message_at: data.last_message_at,
      last_greeting_at: data.last_greeting_at,
    }
  } catch (e) {
    log('supabase', `❌ Exception loading state for ${chatId}: ${e.message}`)
    return {
      step: 'inicio',
      nombre: null,
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

    const result = await supabase.from('patient_state').upsert(
      {
        chat_id: chatId,
        nombre: state.nombre,
        step: state.step,
        documentos: state.documentos,
        collected_data: state.collectedData,
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

const SYSTEM_PROMPT = `Sos el asistente de WhatsApp del club cannábico. Tu trabajo es atender a las personas que escriben por primera vez o que tienen consultas.

ESTILO:
- Español rioplatense natural (vos, dale, genial, claro, etc.)
- Casual y cercano, pero profesional — como alguien del equipo del club
- Respuestas cortas para WhatsApp (máx 3-4 líneas)
- Nunca hagas listas largas ni texto de email
- Usá emojis con moderación 🌿

CONOCIMIENTO DEL CLUB:
${knowledgeBase}

CÓMO RESPONDER SEGÚN LA SITUACIÓN:

Si saluda (hola, buenas, etc.):
→ Saludá con energía y preguntá en qué podés ayudar

Si pregunta por horarios, dirección, ubicación:
→ Respondé brevemente y cerrá con "¿Necesitás algo más o te interesa conocer el club?"

Si pregunta por genéticas, productos, stock:
→ Contá brevemente las opciones disponibles y su perfil de efecto

Si quiere afiliarse o ser socio:
→ Explicá que necesita REPROCANN (el registro de cultivadores) + DNI
→ Si tiene REPROCANN: "Perfecto! Mandame foto del frente de tu Reprocan"
→ Si no tiene: "No hay drama, lo podés tramitar online en argentina.gob.ar/reprocann — es gratis"

Si pide hablar con alguien o con una persona:
→ "Dale, te paso con alguien del club enseguida 👋 Puede demorar un ratito."

Si manda algo raro, fuera de tema, o confuso:
→ Respondé brevemente y redirigí: "Por acá atendemos todo lo del club, ¿en qué te puedo ayudar?"

Si no sabés algo con certeza:
→ "Eso es mejor consultarlo directamente con alguien del club, te van a poder dar info precisa."

REGLAS FIJAS:
- Nunca des una dirección exacta
- Nunca prometas cosas que no podés asegurar
- Siempre cerrá con algo que invite a seguir la conversación o avanzar
- Si ya hablaron antes, recordá el contexto de la conversación
- Si tu respuesta no entra en 4 líneas, dividí en dos mensajes — NUNCA cortes una respuesta a mitad de palabra o concepto`

function log(tag, ...args) {
  console.log(`[${new Date().toISOString()}] [${tag}]`, ...args)
}

async function sendWhatsAppMessage(chatId, message) {
  const url = `${GREEN_URL}/waInstance${GREEN_INSTANCE}/sendMessage/${GREEN_TOKEN}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message }),
    })
    const text = await res.text()
    log('whatsapp', `Status: ${res.status} | ${text.substring(0, 80)}`)
  } catch (e) {
    log('whatsapp', `Error al enviar: ${e.message}`)
  }
}

async function downloadImage(idMessage, chatId) {
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

const REPROCANN_REQUIRED = [
  { key: 'nombre', label: 'tu nombre completo', path: d => d?.nombre },
  { key: 'dni', label: 'tu número de DNI', path: d => d?.dni },
  { key: 'provincia', label: 'tu provincia', path: d => d?.ubicacion?.provincia },
  { key: 'localidad', label: 'tu localidad', path: d => d?.ubicacion?.localidad },
  { key: 'direccion', label: 'tu dirección (calle y número)', path: d => d?.ubicacion?.direccion },
  { key: 'estado', label: 'el estado de autorización', path: d => d?.autorizacion?.estado },
  { key: 'tipo', label: 'el tipo de paciente (ej: autocultivador)', path: d => d?.autorizacion?.tipo },
  { key: 'transporte', label: 'el límite de transporte permitido', path: d => d?.autorizacion?.transporte },
  { key: 'id_tramite', label: 'el número o ID de trámite', path: d => d?.tramite?.id },
  { key: 'vencimiento', label: 'la fecha de vencimiento', path: d => d?.tramite?.fecha_vencimiento },
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
                text: `TAREA CRÍTICA: Detectar si este es un documento ARGENTINO válido.
Retorna SOLO este JSON, sin explicación, sin markdown:
{
  "tipo": "DNI" | "REPROCANN" | "DOCUMENTO_EXTRANJERO" | "OTRO",
  "ambosSides": true | false,
  "pais": "Argentina" | "Uruguay" | "Paraguay" | "otro",
  "valido": true | false
}

INSTRUCCIONES ABSOLUTAS (no hay excepciones):

1. DNI ARGENTINO = color azul, formato RENAPER moderno, escudo + "Ministerio del Interior", tiene CUIT al dorso
   → tipo="DNI" SOLO si ves estos elementos
   → CUALQUIER OTRO DNI = rechazar como DOCUMENTO_EXTRANJERO

2. CÉDULA URUGUAYA = color marrón/beige, dice "CÉDULA DE IDENTIDAD REPÚBLICA ORIENTAL DEL URUGUAY"
   → tipo="DOCUMENTO_EXTRANJERO", pais="Uruguay" (ESTO DEBE RECHAZARSE)

3. OTROS DOCUMENTOS = pasaporte, licencia, visa, cédula paraguaya, brasileña, etc
   → tipo="DOCUMENTO_EXTRANJERO" (RECHAZAR TODOS)

4. REPROCANN = certificado oficial ANMAT, dice "AUTORIZACIÓN ESPECIAL REPROCANN", tiene datos ANMAT
   → tipo="REPROCANN" SOLO si es certificado OFICIAL argentino
   → CUALQUIER OTRO CERTIFICADO = rechazar

5. valido=true SOLO si la imagen es clara, legible, bien iluminada, NO cortada
   → valido=false si está borrosa, desenfocada, parcial, ilegible

6. EN DUDA SIEMPRE RECHAZA = si dudas entre argentino y extranjero → DOCUMENTO_EXTRANJERO`,
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
    const reply = data.content[0].text.trim()

    log('claude', `Respuesta: ${reply.substring(0, 100)}`)

    const updated = [...history, { role: 'user', content: msg }, { role: 'assistant', content: reply }]
    conversationHistory.set(chatId, updated)
    await saveHistory(chatId, updated)  // v4.0: persist to DB

    return reply
  } catch (e) {
    log('claude', `Excepcion: ${e.message}`)
    return 'Disculpá, tuvimos un problema técnico. Intentá de nuevo en un momento 🙏'
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

    const { error } = await supabase.from('members').insert({
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
    })

    if (error) {
      log('members', `Error inserting member: ${error.message}`)
    } else {
      log('members', `Member inserted: ${nombre} (${chatId})`)
    }
  } catch (e) {
    log('members', `Exception inserting member: ${e.message}`)
  }
}

// ========== END CRM ==========

// ========== v4.0: OFF-FLOW RESPONSES (Fase 7) ==========

const RESPUESTAS_FUERA_FLUJO = {
  sticker: [
    'Jaja che 😄 Buen sticker pero necesito tus documentos, no emojis. Dale, mandame el REPROCANN 📄',
    'Boludo, me encantó 👍 Pero ahora necesito que me pases los papeles che 🤔',
    'Ey, muy bueno 😂 Pero acá tenemos que laburar. ¿Tus documentos? 📸',
  ],
  imagen_random: [
    'Che, linda foto boludo 📸 Pero necesito tu DNI y REPROCANN, no fotos del bolso 😅',
    'Ey, hermosa la foto 🔥 Pero acá necesitamos el DNI y el certificado che 📋',
    'Dale boludo, me encanta la onda 🌿 Pero pasame los documentos, anda 👀',
  ],
  solo_emojis: [
    '🤝 Te entiendo boludo. Ahora anda, mandame los documentos che',
    '✨ Eso suena bien, pero necesito que me pases el REPROCANN 📄',
    '💯 De acuerdo. Ahora vamos con los documentos che 🚀',
  ],
  reaccion: [
    'Gracias boludo! 🙏 ¿Me pasas el REPROCANN? 📋',
    '¡Dale! 💪 ¿Tenés los documentos a mano che?',
  ],
}

function randomRespuesta(tipo) {
  const opciones = RESPUESTAS_FUERA_FLUJO[tipo] || RESPUESTAS_FUERA_FLUJO.sticker
  return opciones[Math.floor(Math.random() * opciones.length)]
}

// ========== END OFF-FLOW ==========

app.post('/webhook', (req, res) => {
  res.send('OK')

  process.nextTick(async () => {
    try {
      const body = req.body
      log('webhook', `Recibido: typeWebhook=${body.typeWebhook}`)

      if (body.typeWebhook !== 'incomingMessageReceived') return

      const msgType = body.messageData?.typeMessage
      const chatId = body.senderData?.chatId
      const sender = body.senderData?.senderName

      if (!chatId) return

      // v4.0: Handle off-flow messages (stickers, emojis, reactions)
      if (msgType === 'stickerMessage') {
        await sendWhatsAppMessage(chatId, randomRespuesta('sticker'))
        return
      }

      if (msgType === 'reactionMessage') {
        await sendWhatsAppMessage(chatId, randomRespuesta('reaccion'))
        return
      }

      if (msgType === 'textMessage') {
        const message = body.messageData?.textMessageData?.textMessage?.trim()
        if (!message) return

        // v4.0: Detect emoji-only messages
        if (/^[\p{Emoji}\s]+$/u.test(message) && message.length < 20) {
          await sendWhatsAppMessage(chatId, randomRespuesta('solo_emojis'))
          return
        }

        log('webhook', `De: ${sender} (${chatId}) | "${message}"`)

        if (!checkRateLimit(chatId)) {
          log('webhook', `Rate limit exceeded para ${chatId}`)
          await sendWhatsAppMessage(chatId, 'Recibimos muchos mensajes de este número, intentá en un rato 🙏')
          return
        }

        const state = await loadState(chatId)  // v4.0: load from DB
        state.last_message_at = new Date().toISOString()

        // v4.0: Si es la primera vez, solicitar nombre
        if (state.step === 'inicio' && !state.nombre) {
          log('webhook', `Primer contacto: solicitando nombre para ${chatId}`)
          await sendWhatsAppMessage(chatId, `¡Ey! 👋 Bienvenido che. ¿Cuál es tu nombre? 🤔`)
          state.step = 'solicitando_nombre'
          state.last_greeting_at = new Date().toISOString()
          await saveState(chatId, state)
          return
        }

        // v4.0: Si está en "solicitando_nombre", guardar nombre y continuar
        if (state.step === 'solicitando_nombre') {
          state.nombre = message.trim()
          state.step = 'recibiendo_documentos'
          state.last_greeting_at = new Date().toISOString()
          log('webhook', `Nombre registrado: ${state.nombre} para ${chatId}`)

          // Guardar contacto inicial en members
          await supabase.from('members').insert({
            chat_id: chatId,
            nombre: state.nombre,
          }).catch(() => {})

          await sendWhatsAppMessage(chatId, `¡Dale, ${state.nombre}! 🎉 Gracias por venir.\n\nAhora necesito que me pases dos cosas:\n1️⃣ Tu DNI (frente y dorso) 🪪\n2️⃣ Tu REPROCANN (frente y dorso) 📋\n\nLos mandas en el orden que quieras. Vamos 💪`)
          await saveState(chatId, state)
          return
        }

        // Si está completando datos, guardar la respuesta
        if (state.step === 'completando_datos' && state.pendingFields && state.pendingFields.length > 0) {
          const currentField = state.pendingFields[0]
          state.collectedData[currentField.key] = message
          log('webhook', `Guardado ${currentField.key}=${message} para ${chatId}`)

          state.pendingFields.shift()

          if (state.pendingFields.length > 0) {
            const nextField = state.pendingFields[0]
            await sendWhatsAppMessage(chatId, `Boludo, gracias 🙏 Ahora contame ${nextField.label}? 👀`)
            await saveState(chatId, state)
            return
          } else {
            // Completó todos los campos, listo
            state.step = 'completado'
            await sendWhatsAppMessage(chatId, `✅ ¡Perfecto che! Ya está todo. Te contactamos en un toque 💯`)
            await saveState(chatId, state)
            return
          }
        }

        const wantHuman = /hablar.*persona|persona.*atienda|atender.*humano|pasar.*alguien|contactar.*equipo|speak.*human/i.test(message)
        if (wantHuman && ADMIN_WHATSAPP) {
          log('webhook', `User pidió hablar con humano: ${chatId}`)
          const handoverMsg = `📞 SOLICITUD DE ATENCIÓN HUMANA\n\n👤 ${state.nombre}\n📱 ${chatId}\n💬 "${message}"\n\nEl usuario quiere hablar con alguien del equipo.`
          await sendWhatsAppMessage(ADMIN_WHATSAPP, handoverMsg)
          await sendWhatsAppMessage(chatId, 'Dale, te paso con alguien del club enseguida 👋 Puede demorar un ratito.')
          return
        }

        const reply = await askClaude(message, chatId)
        await sendWhatsAppMessage(chatId, reply)
        log('webhook', `Respuesta enviada a ${chatId}`)
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

        if (state.step === 'inicio') {
          state.step = 'recibiendo_documentos'
          state.documentos = { dni: { frente: null, dorso: null }, reprocann: { frente: null, dorso: null } }
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

        // v4.0: Validar documento antes de procesar
        if (!detected.valido) {
          await sendWhatsAppMessage(chatId, 'La imagen está muy borrosa o cortada. ¿Podés mandarla de nuevo con mejor luz? 📸')
          return
        }

        if (detected.tipo === 'DOCUMENTO_EXTRANJERO') {
          await sendWhatsAppMessage(chatId, `Ey che 🛑 Ese documento no es argentino. Necesitamos tu *DNI argentino* 🇦🇷 y el *REPROCANN de acá*. ¿Los tenés? 👀`)
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
          await sendWhatsAppMessage(chatId, randomRespuesta('imagen_random'))
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
          await sendWhatsAppMessage(chatId, `Boludo, te falta ${firstField.label} 📝 Contame che 👇`)
          await saveState(chatId, state)
          return
        }

        // Todos los documentos y campos están completos!
        state.step = 'completado'
        await sendWhatsAppMessage(chatId, `✅ ¡Listo boludo! 🎉 Ya está todo. Te contactamos en un ratito 💯`)

        if (ADMIN_EMAIL) {
          log('webhook', `Enviando email de notificación para ${state.nombre}`)
          await notifyAdmin(chatId, state.nombre, dniData, reprocannData, state.collectedData)
        }

        await saveState(chatId, state)  // v4.0: persist to DB

        // v4.0: Insert member record for CRM (future campaigns)
        await insertMember(chatId, state.nombre, reprocannData, state.collectedData)

        log('webhook', `Imagen procesada para ${chatId}`)
      } else {
        log('webhook', `Tipo no soportado: ${msgType}`)
      }
    } catch (e) {
      log('webhook', `Error inesperado: ${e.message}`)
    }
  })
})

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.floor(process.uptime()),
    model: MODEL,
    threads: conversationHistory.size,
    knowledgeBase: knowledgeBase.length > 0,
    anthropicKeySet: !!ANTHROPIC_KEY,
    anthropicKeyPrefix: ANTHROPIC_KEY ? ANTHROPIC_KEY.substring(0, 20) + '...' : 'NOT SET',
    anthropicKeyLength: ANTHROPIC_KEY?.length ?? 0,
    anthropicKeyRaw: process.env.ANTHROPIC_API_KEY ? `len=${process.env.ANTHROPIC_API_KEY.length},codes=${[...process.env.ANTHROPIC_API_KEY.slice(-5)].map(c=>c.charCodeAt(0)).join(',')}` : 'NOT SET',
  })
})

app.get('/test-claude', async (req, res) => {
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

      // Determine if should cancel
      const cancelar = (f.motivo === 'tramitando' && f.intentos >= 1) ||
                       (f.motivo === 'inactivo' && f.intentos >= 1) ||
                       (f.motivo === 'sin_reprocann' && f.intentos >= 2) ||
                       (f.motivo === 'docs_incompletos' && f.intentos >= 1)

      const nextDate = () => {
        if (f.motivo === 'sin_reprocann') return f.intentos === 0 ? 3 : 7
        if (f.motivo === 'tramitando') return 7
        if (f.motivo === 'docs_incompletos') return 3
        if (f.motivo === 'inactivo') return 7
        return 7
      }

      const daysToAdd = nextDate()
      const nextNotif = new Date(now)
      nextNotif.setDate(nextNotif.getDate() + daysToAdd)

      await supabase.from('patient_followups').update({
        intentos: f.intentos + 1,
        status: cancelar ? 'cancelado' : 'pendiente',
        proxima_notificacion: cancelar ? null : nextNotif.toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', f.id)
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

// Run cron every 15 minutes
setInterval(runFollowUpCron, 15 * 60 * 1000)

// ========== v4.0: TEST ROUTES (Fase 5) ==========

app.get('/test/seed-followups', async (req, res) => {
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
})
