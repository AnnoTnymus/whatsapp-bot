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
        max_tokens: 100,
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
                text: 'Retorna SOLO este JSON (sin explicación): {"tipo":"REPROCANN" o "DNI" o "OTRO","ambosSides":true o false}',
              },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      log('detect', `Error detectando (status ${res.status}), asumiendo REPROCANN`)
      return { tipo: 'REPROCANN', ambosSides: false }
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
      return { tipo: 'REPROCANN', ambosSides: false }
    }

    log('detect', `Detectado: tipo=${json.tipo}, ambosSides=${json.ambosSides}`)
    return { tipo: json.tipo || 'REPROCANN', ambosSides: json.ambosSides || false }
  } catch (e) {
    log('detect', `Error detectando imagen: ${e.message}, asumiendo REPROCANN`)
    return { tipo: 'REPROCANN', ambosSides: false }
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
        max_tokens: 80,
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
        max_tokens: 800,
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
        max_tokens: 800,
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
    const text = data.content[0].text.trim()
    const json = JSON.parse(text)
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

        const state = userState.get(chatId) || { step: 'inicio', nombre: sender, collectedData: {}, pendingFields: [] }

        // Si está completando datos, guardar la respuesta
        if (state.step === 'completando_datos' && state.pendingFields && state.pendingFields.length > 0) {
          const currentField = state.pendingFields[0]
          state.collectedData[currentField.key] = message
          log('webhook', `Guardado ${currentField.key}=${message} para ${chatId}`)

          state.pendingFields.shift()

          if (state.pendingFields.length > 0) {
            const nextField = state.pendingFields[0]
            await sendWhatsAppMessage(chatId, `Gracias. Ahora contame ${nextField.label} 👇`)
            userState.set(chatId, state)
            return
          } else {
            // Completó todos los campos, pedir DNI
            state.step = 'esperando_dni'
            await sendWhatsAppMessage(chatId, `✅ Perfecto! Ahora mandame una foto de tu DNI para completar todo.`)
            userState.set(chatId, state)
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

        const state = userState.get(chatId) || { step: 'inicio', nombre: sender, collectedData: {}, pendingFields: [] }

        // Detectar tipo de imagen
        const detected = await detectImage(imageUrl)
        log('webhook', `Detectado: tipo=${detected.tipo}, ambosSides=${detected.ambosSides}`)

        // Análisis de confirmación al usuario
        const analysis = await analyzeImageWithClaude(imageUrl, chatId)
        if (!analysis) {
          await sendWhatsAppMessage(chatId, 'Tuvimos un problema analizando la imagen, intentá de nuevo 🙏')
          return
        }

        if (detected.tipo === 'REPROCANN') {
          // REPROCANN: frente vs dorso
          if (detected.ambosSides) {
            // Imagen con ambos lados
            log('webhook', `REPROCANN con ambos lados para ${chatId}`)
            const reprocannData = await extractReprocannData(imageUrl)
            state.reprocannData = reprocannData
            state.imagenes = { reprocann: { url: imageUrl, data: reprocannData } }

            const missing = getMissingFields(reprocannData)
            log('webhook', `Campos faltantes: ${missing.map(m => m.key).join(', ') || 'ninguno'}`)

            if (missing.length > 0) {
              // Faltan campos, pedir por texto
              state.step = 'completando_datos'
              state.pendingFields = missing
              const firstField = missing[0]
              await sendWhatsAppMessage(chatId, `Falta ${firstField.label}. Contame 👇`)
            } else {
              // Todos los campos del REPROCANN están, pedir DNI
              state.step = 'esperando_dni'
              await sendWhatsAppMessage(chatId, `${analysis} Ahora mandame tu DNI 📸`)
            }
            userState.set(chatId, state)
          } else {
            // Una sola lado: ¿frente o dorso?
            if (!state.reprocannFrenteUrl) {
              // Asumir que es frente, guardar y pedir dorso
              log('webhook', `Recibido frente de REPROCANN para ${chatId}, esperando dorso`)
              state.step = 'esperando_reprocann_dorso'
              state.reprocannFrenteUrl = imageUrl
              await sendWhatsAppMessage(chatId, `${analysis} Mandame el dorso también.`)
            } else {
              // Ya tenemos frente, este es dorso
              log('webhook', `Recibido dorso de REPROCANN para ${chatId}`)
              const reprocannData = await extractReprocannData([state.reprocannFrenteUrl, imageUrl])
              state.reprocannData = reprocannData
              state.imagenes = { reprocann: { urls: [state.reprocannFrenteUrl, imageUrl], data: reprocannData } }
              state.reprocannFrenteUrl = null

              const missing = getMissingFields(reprocannData)
              log('webhook', `Campos faltantes: ${missing.map(m => m.key).join(', ') || 'ninguno'}`)

              if (missing.length > 0) {
                state.step = 'completando_datos'
                state.pendingFields = missing
                const firstField = missing[0]
                await sendWhatsAppMessage(chatId, `Falta ${firstField.label}. Contame 👇`)
              } else {
                state.step = 'esperando_dni'
                await sendWhatsAppMessage(chatId, `${analysis} Ahora mandame tu DNI 📸`)
              }
            }
            userState.set(chatId, state)
          }
        } else if (detected.tipo === 'DNI') {
          // DNI - solo procesar si ya tiene REPROCANN completo
          const hasReprocann = state.reprocannData || (state.imagenes?.reprocann?.data)
          const hasAllReprocannFields = hasReprocann && getMissingFields(hasReprocann).length === 0

          if (!hasReprocann || !hasAllReprocannFields) {
            // Aún no tiene REPROCANN completo
            log('webhook', `DNI recibido pero falta REPROCANN para ${chatId}`)
            await sendWhatsAppMessage(chatId, `Primero necesito tu REPROCANN. Mandame esa foto.`)
            userState.set(chatId, state)
            return
          }

          // Ya tiene REPROCANN completo, procesar DNI
          log('webhook', `DNI recibido para ${chatId}`)
          const dniData = await extractDocumentData(imageUrl, 'DNI')
          state.imagenes = state.imagenes || {}
          state.imagenes.dni = { url: imageUrl, data: dniData }

          // Completado, enviar email
          state.step = 'completado'
          await sendWhatsAppMessage(chatId, `${analysis} ¡Listo! Te contactamos pronto 🌿`)

          const reprocannData = state.reprocannData || (state.imagenes.reprocann?.data || null)
          if (ADMIN_EMAIL) {
            log('webhook', `Enviando email de notificación para ${state.nombre}`)
            await notifyAdmin(chatId, state.nombre, dniData, reprocannData, state.collectedData)
          }

          userState.set(chatId, state)
        } else {
          // OTRO: no sabemos qué es
          await sendWhatsAppMessage(chatId, `Mandame tu REPROCANN o DNI 📸`)
        }

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

const PORT = process.env.PORT ?? 3000
app.listen(PORT, () => {
  log('server', `Bot corriendo en puerto ${PORT}`)
  log('server', `Modelo: ${MODEL}`)
  log('server', `API key configurada: ${!!ANTHROPIC_KEY}`)
  log('server', `Knowledge base: ${knowledgeBase.length} chars`)
})
