import 'dotenv/config.js'
import express from 'express'
import fetch from 'node-fetch'
import { readFileSync } from 'fs'
import { Resend } from 'resend'

const app = express()
app.use(express.json())

const GREEN_URL = process.env.GREEN_API_URL ?? 'https://7107.api.greenapi.com'
const GREEN_INSTANCE = process.env.GREEN_API_INSTANCE_ID ?? '7107588003'
const GREEN_TOKEN = process.env.GREEN_API_TOKEN ?? '5d7a2dd449bd48deaed916c65ae197c86ceb73a683254677b5'
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY?.replace(/[^\x20-\x7E]/g, '').trim()
const MODEL = 'claude-opus-4-7'
const RESEND_API_KEY = process.env.RESEND_API_KEY
const ADMIN_EMAIL = process.env.ADMIN_EMAIL

const conversationHistory = new Map()
const rateLimits = new Map()
const userState = new Map()

const RATE_LIMIT = 30
const RATE_WINDOW = 60 * 60 * 1000
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP

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

async function analyzeImageWithClaude(imageUrl, chatId) {
  if (!ANTHROPIC_KEY) {
    log('claude', 'ANTHROPIC_KEY no configurada para análisis de imagen')
    return null
  }

  const state = userState.get(chatId) || {}
  const systemMsg = state.step === 'esperando_reprocann'
    ? 'El usuario ya indicó que tiene REPROCANN. Analizá esta imagen como su certificado REPROCANN. Confirmá con entusiasmo la recepción (ej: "¡Perfecto, vi tu REPROCANN!") y pedile el DNI para completar.'
    : state.step === 'esperando_dni'
    ? 'El usuario ya mandó su REPROCANN. Analizá esta imagen como su DNI. Confirmá con entusiasmo que recibiste ambos documentos (ej: "¡Excelente, ya tengo tu DNI!") y que alguien lo contactará.'
    : 'El usuario está en proceso de afiliación. Analizá esta imagen: ¿Es un REPROCANN válido o un DNI? Respondé con entusiasmo qué ves y qué necesitás a continuación.'

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
        max_tokens: 300,
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
                text: 'Analizá esta imagen para el flujo de afiliación del club.',
              },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      log('claude', `Error analizando imagen: ${err.substring(0, 150)}`)
      return null
    }

    const data = await res.json()
    const reply = data.content[0].text.trim()
    log('claude', `Análisis de imagen: ${reply.substring(0, 80)}`)
    return reply
  } catch (e) {
    log('claude', `Excepción analizando imagen: ${e.message}`)
    return null
  }
}

async function extractDocumentData(imageUrl, docType) {
  if (!ANTHROPIC_KEY) return null

  const prompts = {
    DNI: `Extrae del DNI: nombre, apellido, número de documento, fecha de nacimiento, género, domicilio.
Retorna SOLO JSON sin explicaciones: {"tipo":"DNI","nombre":"","apellido":"","documento":"","fecha_nacimiento":"","genero":"","domicilio":""}`,
    REPROCANN: `Extrae del REPROCANN estos datos exactos:
- Nombre del paciente
- Documento (DNI)
- Provincia / Departamento / Localidad
- Dirección
- Código postal
- Estado de autorización
- Tipo de paciente (ej: autocultivo)
- Cantidad de plantas permitidas
- Límites de transporte
- ID de trámite
- Fecha de emisión
- Fecha de vencimiento
- Ley

Retorna SOLO JSON sin explicaciones ni textos adicionales:
{
  "tipo": "REPROCANN",
  "nombre": "",
  "dni": "",
  "ubicacion": {"provincia": "", "departamento": "", "localidad": "", "direccion": "", "codigo_postal": ""},
  "autorizacion": {"estado": "", "tipo": "", "plantas": "", "transporte": ""},
  "tramite": {"id": "", "fecha_emision": "", "fecha_vencimiento": ""},
  "ley": ""
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
        max_tokens: 600,
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
    const text = data.content[0].text.trim()
    const json = JSON.parse(text)
    log('extract', `Datos extraídos de ${docType}: ${text.substring(0, 60)}`)
    return json
  } catch (e) {
    log('extract', `Error extrayendo datos: ${e.message}`)
    return null
  }
}

async function sendEmailNotification(chatId, nombre, dniData, reprocannData) {
  if (!resend || !ADMIN_EMAIL) {
    log('email', 'Resend no configurado o email de admin faltante')
    return
  }

  let htmlContent = `
    <h2>📋 Nuevo Lead - Documentos Completos</h2>
    <p><strong>Contacto:</strong> ${nombre}</p>
    <p><strong>Número:</strong> ${chatId}</p>

    <hr />
  `

  if (dniData && dniData.nombre) {
    htmlContent += `
      <h3>🪪 DNI</h3>
      <ul>
        <li><strong>Nombre:</strong> ${dniData.nombre || ''} ${dniData.apellido || ''}</li>
        <li><strong>Documento:</strong> ${dniData.documento || 'N/A'}</li>
        <li><strong>Nacimiento:</strong> ${dniData.fecha_nacimiento || 'N/A'}</li>
        <li><strong>Domicilio:</strong> ${dniData.domicilio || 'N/A'}</li>
      </ul>
    `
  }

  if (reprocannData && reprocannData.nombre) {
    htmlContent += `
      <h3>🌿 REPROCANN</h3>
      <ul>
        <li><strong>Nombre:</strong> ${reprocannData.nombre || 'N/A'}</li>
        <li><strong>DNI:</strong> ${reprocannData.dni || 'N/A'}</li>
        <li><strong>Plantas:</strong> ${reprocannData.autorizacion?.plantas || 'N/A'}</li>
        <li><strong>Tipo:</strong> ${reprocannData.autorizacion?.tipo || 'N/A'}</li>
        <li><strong>Estado:</strong> ${reprocannData.autorizacion?.estado || 'N/A'}</li>
        <li><strong>Provincia:</strong> ${reprocannData.ubicacion?.provincia || 'N/A'}</li>
        <li><strong>Dirección:</strong> ${reprocannData.ubicacion?.direccion || 'N/A'}</li>
        <li><strong>ID Trámite:</strong> ${reprocannData.tramite?.id || 'N/A'}</li>
        <li><strong>Vencimiento:</strong> ${reprocannData.tramite?.fecha_vencimiento || 'N/A'}</li>
      </ul>
    `
  }

  htmlContent += `
    <hr />
    <p style="color: green; font-weight: bold;">✅ Listo para contactar y procesar afiliación</p>
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

async function notifyAdmin(chatId, nombre, dniData, reprocannData) {
  log('admin', `Notificando admin para: ${nombre}`)
  await sendEmailNotification(chatId, nombre, dniData, reprocannData)
}

async function askClaude(msg, chatId) {
  if (!ANTHROPIC_KEY) {
    log('claude', 'ANTHROPIC_KEY no configurada!')
    return 'Disculpá, estamos teniendo un problema técnico. Probá de nuevo en unos minutos 🙏'
  }

  const history = conversationHistory.get(chatId) || []
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
        max_tokens: 500,
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

    return reply
  } catch (e) {
    log('claude', `Excepcion: ${e.message}`)
    return 'Disculpá, tuvimos un problema técnico. Intentá de nuevo en un momento 🙏'
  }
}

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

      if (msgType === 'textMessage') {
        const message = body.messageData?.textMessageData?.textMessage?.trim()
        if (!message) return

        log('webhook', `De: ${sender} (${chatId}) | "${message}"`)

        if (!checkRateLimit(chatId)) {
          log('webhook', `Rate limit exceeded para ${chatId}`)
          await sendWhatsAppMessage(chatId, 'Recibimos muchos mensajes de este número, intentá en un rato 🙏')
          return
        }

        const wantHuman = /hablar.*persona|persona.*atienda|atender.*humano|pasar.*alguien|contactar.*equipo|speak.*human/i.test(message)
        if (wantHuman && ADMIN_WHATSAPP) {
          log('webhook', `User pidió hablar con humano: ${chatId}`)
          const state = userState.get(chatId) || { nombre: sender }
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
          log('webhook', `No downloadUrl encontrada. Estructura completa: ${JSON.stringify(body.messageData)}`)
          return
        }

        log('webhook', `Imagen recibida de ${sender} (${chatId}) - URL: ${imageUrl.substring(0, 80)}`)

        if (!checkRateLimit(chatId)) {
          log('webhook', `Rate limit exceeded para ${chatId}`)
          await sendWhatsAppMessage(chatId, 'Recibimos muchos mensajes de este número, intentá en un rato 🙏')
          return
        }

        const analysis = await analyzeImageWithClaude(imageUrl, chatId)
        if (!analysis) {
          await sendWhatsAppMessage(chatId, 'Tuvimos un problema analizando la imagen, intentá de nuevo 🙏')
          return
        }

        const state = userState.get(chatId) || { step: 'inicio', nombre: sender, imagenes: {} }
        let docType = 'DNI'
        let extractedData = null
        let userMessage = analysis

        if (state.step === 'inicio' || state.step === 'esperando_reprocann') {
          docType = 'REPROCANN'
          state.step = 'esperando_dni'
          extractedData = await extractDocumentData(imageUrl, 'REPROCANN')
          state.imagenes.reprocann = { url: imageUrl, data: extractedData }
          log('webhook', `Estado actualizado a esperando_dni para ${chatId}`)
        } else if (state.step === 'esperando_dni') {
          docType = 'DNI'
          state.step = 'completado'
          extractedData = await extractDocumentData(imageUrl, 'DNI')
          state.imagenes.dni = { url: imageUrl, data: extractedData }
          log('webhook', `Estado actualizado a COMPLETADO para ${chatId}`)

          log('webhook', `ADMIN_WHATSAPP configurada: ${!!ADMIN_WHATSAPP}`)
          if (ADMIN_WHATSAPP) {
            const dniData = state.imagenes.dni?.data || null
            const reprocannData = state.imagenes.reprocann?.data || null
            log('webhook', `Notificando admin con datos: DNI=${dniData?.nombre}, REPROCANN=${reprocannData?.numero}`)
            await notifyAdmin(chatId, state.nombre, dniData, reprocannData)
          } else {
            log('webhook', `ADMIN_WHATSAPP NO está configurada, no enviando notificación`)
          }

          userMessage = `¡Perfecto! 🎉 Ahora ya tenemos todos tus datos. Te va a contactar alguien del club para confirmarte que todo está bien y darte la bienvenida! 🌿`
        }
        userState.set(chatId, state)

        await sendWhatsAppMessage(chatId, userMessage)
        log('webhook', `Análisis enviado a ${chatId} | ${docType} procesado`)
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

const PORT = process.env.PORT ?? 3000
app.listen(PORT, () => {
  log('server', `Bot corriendo en puerto ${PORT}`)
  log('server', `Modelo: ${MODEL}`)
  log('server', `API key configurada: ${!!ANTHROPIC_KEY}`)
  log('server', `Knowledge base: ${knowledgeBase.length} chars`)
})
