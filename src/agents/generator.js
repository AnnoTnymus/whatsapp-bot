// [claude-opus-4.7] 2026-04-24: runGenerator — produce la respuesta final para el usuario.
// Contrato: docs/contracts-task48.md
//
// Import: runGenerator({ intent, knowledge, history, state, message }, { anthropicKey, model, fetchImpl })
// Return: { reply, wants_affiliation }

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import nodeFetch from 'node-fetch'

const __dirname = dirname(fileURLToPath(import.meta.url))
const GENERATOR_PROMPT = readFileSync(join(__dirname, 'prompts', 'generator.md'), 'utf8')

const FALLBACK_REPLY = 'Disculpá, tuvimos un problema técnico. Intentá de nuevo en un momento 🙏'

const GREET_WELCOME = `Bienvenido a Indajaus 🌿

Te estás comunicando con nuestro club cannábico en Argentina. 
Somos una empresa que viene desde Uruguay trayendo más de una década de experiencia en el sector del cannabis. 
Estás en el lugar indicado.

¿Cuál es tu nombre?`

const INFO_OPTIONS = `Perfecto, gracias por escribirnos.

Acá podemos ayudarte con:
• 📝 **Inscripción al club** — es lo principal, te digo qué necesitamos
• 📚 **Info sobre Indajaus** — quiénes somos, cómo funciona, precios
• 🌿 **Dudas sobre cannabis** — genéticas, REPROCANN, leyes  
• 👥 **Hablar con alguien** — si prefieres atención humana

Yo soy IA entrenada para resolver dudas complejas, así que podemos hablar de cualquier cosa sin problemas.

¿Qué te interesa?`

function renderSnippets(knowledge) {
  if (!Array.isArray(knowledge) || knowledge.length === 0) {
    return '(sin snippets — si el intent requiere datos del club, decí que mejor se consulte con alguien del staff)'
  }
  return knowledge
    .map((k, i) => `[${i + 1}] topic="${k.topic}" tags=${JSON.stringify(k.tags || [])}\n${k.content}`)
    .join('\n\n')
}

export async function runGenerator({ intent, knowledge = [], history = [], state = {}, message }, opts = {}) {
  const anthropicKey = opts.anthropicKey || process.env.ANTHROPIC_API_KEY?.replace(/[^\x20-\x7E]/g, '').trim()
  const model = opts.model || process.env.ANTHROPIC_MODEL_GENERATOR || 'claude-opus-4-7'
  const fetchImpl = opts.fetchImpl || nodeFetch
  const maxTokens = opts.maxTokens || 400

  if (!anthropicKey) return { reply: FALLBACK_REPLY, wants_affiliation: false }

  // Return forced reply for greet/info without history
  if (forcedReply) {
    return { reply: forcedReply, wants_affiliation: false }
  }

  const recentHistory = Array.isArray(history) ? history.slice(-8) : []
  const currentStep = state?.step || 'inicio'
  const stateLine = state && state.nombre && state.nombre !== 'Amigo'
    ? `Nombre del usuario: ${state.nombre}. Paso: ${currentStep}.`
    : 'Usuario sin nombre registrado.'

  // Add step-specific instructions
  let stepInstructions = ''
  let forcedReply = null

  // Check for greet intent with no history or greet with "hola" message
  if (intent === 'greet' && (!recentHistory.length || message.toLowerCase().match(/^hola+$/))) {
    forcedReply = GREET_WELCOME
  } else if (intent === 'info' && currentStep === 'inicio' && !state.nombre && !recentHistory.length) {
    forcedReply = INFO_OPTIONS
  } else if (currentStep === 'solicitando_nombre' || (intent === 'affiliate' && !state.nombre)) {
    stepInstructions = '\n⚠️ ACCIÓN REQUERIDA: El usuario aún no tiene nombre. Pedir nombre directamente, no saludar genéricamente.'
  } else if (currentStep === 'recibiendo_documentos') {
    stepInstructions = '\n⚠️ ACCIÓN REQUERIDA: El usuario está en proceso de enviar documentos. Pedir DNI y REPROCANN.'
  } else if (currentStep === 'completando_datos' && state.pendingFields?.length > 0) {
    const field = state.pendingFields[0]
    stepInstructions = `\n⚠️ ACCIÓN REQUERIDA: Falta completar "${field.label}". Pedir ese dato específico.`
  }

  const systemWithContext = [
    GENERATOR_PROMPT,
    '',
    '━━━ CONTEXTO DE ESTA CONSULTA ━━━',
    `intent: ${intent || 'info'}`,
    stateLine,
    stepInstructions,
    '',
    'Knowledge snippets:',
    renderSnippets(knowledge),
  ].join('\n')

  const messages = [
    ...recentHistory,
    { role: 'user', content: message },
  ]

  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemWithContext,
        messages,
      }),
    })

    if (!res.ok) return { reply: FALLBACK_REPLY, wants_affiliation: false }

    const data = await res.json()
    const raw = (data?.content?.[0]?.text || '').trim()
    if (!raw) return { reply: FALLBACK_REPLY, wants_affiliation: false }

    const wants_affiliation = /\[\[AFILIAR\]\]/i.test(raw)
    // Drop both [[AFILIAR]] and stray [[SKILL:...]] markers — the new pipeline routes skills before generator runs.
    const reply = raw
      .replace(/\[\[AFILIAR\]\]/gi, '')
      .replace(/\[\[SKILL:[^\]]+\]\]/gi, '')
      .trim()

    return { reply: reply || FALLBACK_REPLY, wants_affiliation }
  } catch {
    return { reply: FALLBACK_REPLY, wants_affiliation: false }
  }
}

export const _internal = { renderSnippets, GENERATOR_PROMPT }
