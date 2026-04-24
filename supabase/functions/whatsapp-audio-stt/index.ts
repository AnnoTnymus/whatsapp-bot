/**
 * WhatsApp Audio STT - Deepgram Speech-to-Text
 * Proyecto: whatsapp-bot (ujlgicmuktpqxuulhhwm)
 * Added by OpenCode (Rolli) on 2026-04-24
 */

// Deepgram API key - Added by OpenCode (Rolli)
const DEEPGRAM_KEY = '0faee3e7e8d5f52db6ca23fea7671f05bd8bc1ff'

async function transcribeWithDeepgram(audioUrl: string): Promise<string | null> {
  try {
    console.log('Fetching audio from URL...')
    const resp = await fetch(audioUrl)
    if (!resp.ok) {
      console.error('Fetch failed:', resp.status)
      return null
    }
    const audioBytes = await resp.arrayBuffer()
    console.log('Audio size:', audioBytes.byteLength)

    console.log('Calling Deepgram...')
    const dgResp = await fetch('https://api.deepgram.com/v1/listen?language=es', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_KEY}`,
        'Content-Type': 'audio/ogg'
      },
      body: new Uint8Array(audioBytes)
    })

    console.log('Deepgram status:', dgResp.status)
    if (!dgResp.ok) {
      const err = await dgResp.text()
      console.error('Deepgram error:', err.substring(0, 500))
      return null
    }

    const data = await dgResp.json()
    const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript
    console.log('Transcript:', transcript)
    return transcript || null
  } catch (e) {
    console.error('Error:', e)
    return null
  }
}

Deno.serve(async (req) => {
  console.log('=== STT REQUEST ===')

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

  if (!downloadUrl) {
    return new Response(JSON.stringify({ error: 'downloadUrl required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  console.log('Processing:', downloadUrl.substring(0, 60))

  const text = await transcribeWithDeepgram(downloadUrl)

  if (!text) {
    return new Response(JSON.stringify({ error: 'Transcription failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  console.log('SUCCESS:', text)

  return new Response(JSON.stringify({ ok: true, text }), {
    headers: { 'Content-Type': 'application/json' }
  })
})