/**
 * WhatsApp Audio STT - Hugging Face Whisper
 * Proyecto: whatsapp-bot (ujlgicmuktpqxuulhhwm)
 * Added by OpenCode (Rolli) on 2026-04-24
 */

const HF_TOKEN = Deno.env.get('HF_TOKEN')!

async function downloadAudioFromGreenAPI(chatId: string, idMessage: string): Promise<ArrayBuffer | null> {
  const GREEN_URL = Deno.env.get('GREEN_API_URL') ?? 'https://7107.api.greenapi.com'
  const GREEN_INSTANCE = Deno.env.get('GREEN_API_INSTANCE_ID') ?? '7107588003'
  const GREEN_TOKEN_API = Deno.env.get('GREEN_API_TOKEN') ?? '5d7a2dd449bd48deaed916c65ae197c86ceb73a683254677b5'

  try {
    const url = `${GREEN_URL}/waInstance${GREEN_INSTANCE}/downloadFile/${GREEN_TOKEN_API}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, idMessage })
    })

    if (!resp.ok) {
      console.error('GreenAPI download failed:', resp.status)
      const err = await resp.text()
      console.error('Error:', err)
      return null
    }

    const arrayBuffer = await resp.arrayBuffer()
    console.log('Downloaded from GreenAPI, size:', arrayBuffer.byteLength)
    return arrayBuffer
  } catch (e) {
    console.error('Download error:', e)
    return null
  }
}

async function transcribeWithWhisper(audioData: ArrayBuffer): Promise<string | null> {
  try {
    const blob = new Blob([audioData], { type: 'audio/ogg' })
    console.log('Audio size:', audioData.byteLength, 'type:', blob.type)

    const formData = new FormData()
    formData.append('file', blob, 'audio.ogg')
    formData.append('model', 'openai/whisper-large-v3')
    formData.append('language', 'es')

    console.log('Calling HuggingFace Whisper...')
    const resp = await fetch('https://api-inference.huggingface.co/models/openai/whisper-large-v3', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${HF_TOKEN}` },
      body: formData
    })

    console.log('Whisper status:', resp.status)
    if (!resp.ok) {
      const errText = await resp.text()
      console.error('Whisper error:', errText.substring(0, 500))
      return null
    }

    const data = await resp.json()
    console.log('Whisper result:', JSON.stringify(data))
    return data.text || null
  } catch (e) {
    console.error('Transcribe error:', e)
    return null
  }
}

Deno.serve(async (req) => {
  console.log('=== VOICE REQUEST ===')

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const downloadUrl = body.downloadUrl
  const idMessage = body.idMessage
  const chatId = body.chatId

  console.log('Request:', JSON.stringify({ downloadUrl: !!downloadUrl, idMessage: !!idMessage, chatId }))

  let audioData: ArrayBuffer | null = null

  // Priority: download from GreenAPI using idMessage
  if (idMessage && chatId) {
    console.log('Downloading from GreenAPI...')
    audioData = await downloadAudioFromGreenAPI(chatId, idMessage)
  } else if (downloadUrl) {
    // Fallback: try direct URL
    console.log('Trying direct URL:', downloadUrl)
    const resp = await fetch(downloadUrl)
    if (!resp.ok) {
      console.error('URL fetch failed:', resp.status)
      return new Response(JSON.stringify({ error: 'Failed to fetch audio from URL' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    audioData = await resp.arrayBuffer()
  }

  if (!audioData) {
    return new Response(JSON.stringify({ error: 'Failed to download audio' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  console.log('Transcribing audio...')
  const text = await transcribeWithWhisper(audioData)

  if (!text) {
    return new Response(JSON.stringify({ error: 'Failed to transcribe' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  console.log('Transcription:', text)

  return new Response(JSON.stringify({ ok: true, text }), {
    headers: { 'Content-Type': 'application/json' }
  })
})