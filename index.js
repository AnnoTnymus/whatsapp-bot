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
} catch (e) {
  console.log('[startup] No knowledge/base.md found, using generic assistant')
}

function log(tag, ...args) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] [${tag}]`, ...args)
}

async function sendWhatsAppMessage(chatId, message) {
  const url = `${GREEN_URL}/waInstance${GREEN_INSTANCE}/sendMessage/${GREEN_TOKEN}`
  try {
    log('whatsapp', `Sending to ${chatId}: ${message.substring(0, 50)}...`)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, message }),
    })
    const status = res.status
    const text = await res.text()
    log('whatsapp', `Send status: ${status}, response: ${text.substring(0, 100)}`)
  } catch (e) {
    log('whatsapp', 'Error:', e.message)
  }
}

async function askClaude(msg, chatId) {
  if (!ANTHROPIC_KEY) {
    log('claude', 'ERROR: ANTHROPIC_KEY not set!')
    return 'Error: API key not configured'
  }

  const history = conversationHistory.get(chatId) || []
  const messages = [...history.slice(-5), { role: 'user', content: msg }]

  log('claude', `Calling Claude with ${messages.length} messages for chat ${chatId}`)

  try {
    const systemPrompt = knowledgeBase
      ? `You are a helpful club assistant. Use the knowledge base below to answer questions about the club. Answer briefly in Spanish.\n\n# Knowledge Base\n\n${knowledgeBase}`
      : 'You are a helpful club assistant. Answer briefly in Spanish.'

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    })

    log('claude', `Response status: ${res.status}`)

    if (!res.ok) {
      const error = await res.text()
      log('claude', `API error: ${error.substring(0, 200)}`)
      return 'Error: Claude API returned error'
    }

    const data = await res.json()
    const reply = data.content[0].text

    log('claude', `Reply: ${reply.substring(0, 100)}...`)

    const updated = [...history, { role: 'user', content: msg }, { role: 'assistant', content: reply }]
    conversationHistory.set(chatId, updated)

    return reply
  } catch (e) {
    log('claude', `Exception: ${e.message}`)
    return 'Error: Failed to process request'
  }
}

app.post('/webhook', (req, res) => {
  const timestamp = new Date().toISOString()
  log('webhook', `Received POST - responding OK immediately`)

  res.send('OK')

  process.nextTick(async () => {
    try {
      const body = req.body

      log('webhook', `typeWebhook: ${body.typeWebhook}`)

      if (body.typeWebhook !== 'incomingMessageReceived') {
        log('webhook', 'Not incomingMessageReceived, ignoring')
        return
      }

      const msgType = body.messageData?.typeMessage
      log('webhook', `Message type: ${msgType}`)

      if (msgType !== 'textMessage') {
        log('webhook', 'Not textMessage, ignoring')
        return
      }

      const chatId = body.senderData?.chatId
      const message = body.messageData?.textMessageData?.textMessage
      const sender = body.senderData?.senderName

      log('webhook', `From: ${sender} (${chatId}) | Message: ${message}`)

      if (!chatId || !message) {
        log('webhook', 'Missing chatId or message, ignoring')
        return
      }

      log('webhook', `Processing message...`)
      const reply = await askClaude(message, chatId)

      log('webhook', `Sending WhatsApp response...`)
      await sendWhatsAppMessage(chatId, reply)

      log('webhook', `Complete`)
    } catch (e) {
      log('webhook', `Error in async handler: ${e.message}`)
    }
  })
})

app.get('/health', (req, res) => {
  const uptime = process.uptime()
  const historySize = conversationHistory.size
  res.json({
    ok: true,
    uptime: Math.floor(uptime),
    conversationThreads: historySize,
    model: MODEL,
  })
})

const PORT = process.env.PORT ?? 3000
app.listen(PORT, () => {
  log('server', `WhatsApp Bot running on port ${PORT}`)
  log('server', `GREEN_API: ${GREEN_URL}`)
  log('server', `MODEL: ${MODEL}`)
  log('server', `KNOWLEDGE_BASE: ${knowledgeBase.length} chars loaded`)
})
