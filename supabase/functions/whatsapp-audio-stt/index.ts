/**
 * WhatsApp Audio STT - Hugging Face Whisper
 * Proyecto: whatsapp-bot (ujlgicmuktpqxuulhhwm)
 * Added by OpenCode (Rolli) on 2026-04-24
 */

const HF_TOKEN = Deno.env.get('HF_TOKEN')!

const GREEN_URL = Deno.env.get('GREEN_API_URL') ?? 'https://7107.api.greenapi.com'
const GREEN_INSTANCE = Deno.env.get('GREEN_API_INSTANCE_ID') ?? '7107588003'
const GREEN_TOKEN = Deno.env.get('GREEN_API_TOKEN') ?? '5d7a2dd449bd48deaed916c65ae197c86ceb73a683254677b5'

async function downloadAudioFromGreenAPI(fileId: string): Promise<ArrayBuffer | null> {
  try {
    const url = `${GREEN_URL}/waInstance${GREEN_INSTANCE}/downloadFile/${GREEN_TOKEN}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId })
    })

    if (!resp.ok) {
      console.error('Download failed:', resp.status)
      return null
    }

    const arrayBuffer = await resp.arrayBuffer()
    return arrayBuffer
  } catch (e) {
    console.error('Download error:', e)
    return null
  }
}

async function transcribeWithWhisper(audioData: ArrayBuffer): Promise<string | null> {
  try {
    const blob = new Blob([audioData], { type: 'audio/ogg' })
    const formData = new FormData()
    formData.append('file', blob, 'audio.ogg')
    formData.append('model', 'openai/whisper-large-v3')
    formData.append('language', 'es')

    const resp = await fetch('https://api-inference.huggingface.co/models/openai/whisper-large-v3', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${HF_TOKEN}` },
      body: formData
    })

    if (!resp.ok) {
      console.error('Whisper error:', resp.status)
      const text = await resp.text()
      console.error('Response:', text)
      return null
    }

    const data = await resp.json()
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

  const fileId = body.fileId
  const downloadUrl = body.downloadUrl

  if (!fileId && !downloadUrl) {
    return new Response(JSON.stringify({ error: 'fileId or downloadUrl required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  let audioData: ArrayBuffer | null = null

  if (downloadUrl) {
    console.log('Fetching audio from URL:', downloadUrl)
    const resp = await fetch(downloadUrl)
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch audio from URL' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    audioData = await resp.arrayBuffer()
  } else {
    console.log('Downloading audio:', fileId)
    audioData = await downloadAudioFromGreenAPI(fileId)
  }

  if (!audioData) {
    return new Response(JSON.stringify({ error: 'Failed to download audio' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  console.log('Transcribing...')
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