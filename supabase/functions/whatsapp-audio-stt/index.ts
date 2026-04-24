/**
 * WhatsApp Audio STT - Deepgram Speech-to-Text
 * Proyecto: whatsapp-bot (ujlgicmuktpqxuulhhwm)
 * Added by OpenCode (Rolli) on 2026-04-24
 */

// Security hardening by Codex (GPT-5) on 2026-04-24:
// secrets and host allowlists must come from function env vars.
const DEEPGRAM_KEY = Deno.env.get('DEEPGRAM_API_KEY')?.trim()
const STT_SHARED_SECRET = Deno.env.get('STT_SHARED_SECRET')?.trim()
const STT_ALLOWED_HOSTS = (Deno.env.get('STT_ALLOWED_HOSTS') || 'do-media-7107.fra1.digitaloceanspaces.com')
  .split(',')
  .map(host => host.trim().toLowerCase())
  .filter(Boolean)

function getBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null
  const match = headerValue.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

function isAuthorized(req: Request): boolean {
  if (!STT_SHARED_SECRET) return false

  const headerSecret = req.headers.get('x-stt-secret')?.trim() || null
  const bearerToken = getBearerToken(req.headers.get('authorization'))
  return headerSecret === STT_SHARED_SECRET || bearerToken === STT_SHARED_SECRET
}

function isAllowedAudioUrl(audioUrl: string): boolean {
  try {
    const url = new URL(audioUrl)
    return url.protocol === 'https:' && STT_ALLOWED_HOSTS.includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

// STT log sanitization added by Codex (GPT-5) on 2026-04-24.
function getAudioHost(audioUrl: string): string {
  try {
    return new URL(audioUrl).hostname
  } catch {
    return 'invalid'
  }
}

async function transcribeWithDeepgram(audioUrl: string): Promise<string | null> {
  try {
    if (!DEEPGRAM_KEY) {
      console.error('Missing DEEPGRAM_API_KEY')
      return null
    }

    console.log('Fetching audio from approved host...')
    const resp = await fetch(audioUrl, { signal: AbortSignal.timeout(20_000) })
    if (!resp.ok) {
      console.error('Fetch failed:', resp.status)
      return null
    }
    const audioBytes = await resp.arrayBuffer()
    console.log('Audio size bytes:', audioBytes.byteLength)

    console.log('Calling Deepgram...')
    const dgResp = await fetch('https://api.deepgram.com/v1/listen?language=es', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_KEY}`,
        'Content-Type': 'audio/ogg'
      },
      body: new Uint8Array(audioBytes),
      signal: AbortSignal.timeout(20_000)
    })

    console.log('Deepgram status:', dgResp.status)
    if (!dgResp.ok) {
      const err = await dgResp.text()
      console.error('Deepgram error:', err.substring(0, 500))
      return null
    }

    const data = await dgResp.json()
    const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript
    console.log('Transcript chars:', transcript?.length || 0)
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

  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
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

  if (!isAllowedAudioUrl(downloadUrl)) {
    return new Response(JSON.stringify({ error: 'downloadUrl host not allowed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  console.log('Processing audio host:', getAudioHost(downloadUrl))

  const text = await transcribeWithDeepgram(downloadUrl)

  if (!text) {
    return new Response(JSON.stringify({ error: 'Transcription failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  console.log('SUCCESS chars:', text.length)

  return new Response(JSON.stringify({ ok: true, text }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
