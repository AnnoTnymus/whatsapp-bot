import 'dotenv/config.js'
import express from 'express'
import fetch from 'node-fetch'
import { readFileSync } from 'fs'

const app = express()
app.use(express.json())

const GREEN_URL = process.env.GREEN_API_URL ?? 'https://7107.api.greenapi.com'
const GREEN_INSTANCE = process.env.GREEN_API_INSTANCE_ID ?? '7107588003'
const GREEN_TOKEN = process.env.GREEN_API_TOKEN ?? '5d7a2dd449bd48deaed916c65ae197c86ceb73a683254677b5'
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const MODEL = 'claude-opus-4-7'

const conversationHistory = new Map()

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
- Si ya hablaron antes, recordá el contexto de la conversación`

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
        max_tokens: 300,
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
      if (msgType !== 'textMessage') {
        log('webhook', `Tipo no soportado: ${msgType}`)
        return
      }

      const chatId = body.senderData?.chatId
      const message = body.messageData?.textMessageData?.textMessage?.trim()
      const sender = body.senderData?.senderName

      if (!chatId || !message) return

      log('webhook', `De: ${sender} (${chatId}) | "${message}"`)

      const reply = await askClaude(message, chatId)
      await sendWhatsAppMessage(chatId, reply)

      log('webhook', `Respuesta enviada a ${chatId}`)
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
