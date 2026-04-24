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

  const recentHistory = Array.isArray(history) ? history.slice(-8) : []
  const stateLine = state && state.nombre && state.nombre !== 'Amigo'
    ? `Nombre del usuario: ${state.nombre}. Paso: ${state.step || 'conversando'}.`
    : 'Usuario sin nombre registrado.'

  const systemWithContext = [
    GENERATOR_PROMPT,
    '',
    '━━━ CONTEXTO DE ESTA CONSULTA ━━━',
    `intent: ${intent || 'info'}`,
    stateLine,
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
