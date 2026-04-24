// [claude-opus-4.7] 2026-04-24: runRouter — clasifica intent del usuario.
// Contrato: docs/contracts-task48.md
//
// Import: runRouter({ message, history, state }, { anthropicKey, model, fetchImpl })
// Return: { intent, needs_knowledge, knowledge_query, skill, wants_affiliation, reasoning }

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import nodeFetch from 'node-fetch'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROUTER_PROMPT = readFileSync(join(__dirname, 'prompts', 'router.md'), 'utf8')

const VALID_INTENTS = new Set(['greet', 'info', 'affiliate', 'handover', 'skill', 'offtopic', 'goodbye'])
const VALID_SKILLS = new Set(['legal_faq', 'reprocann_guide', 'genetics_expert'])

const FALLBACK = {
  intent: 'info',
  needs_knowledge: true,
  knowledge_query: 'club',
  skill: null,
  wants_affiliation: false,
  reasoning: 'router fallback',
}

function coerceRouterJson(raw) {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null

  // Tolerate models that wrap JSON in ```json ... ``` despite the instruction.
  const match = trimmed.match(/\{[\s\S]*\}/)
  if (!match) return null

  let obj
  try {
    obj = JSON.parse(match[0])
  } catch {
    return null
  }

  const intent = VALID_INTENTS.has(obj.intent) ? obj.intent : FALLBACK.intent
  const skill = VALID_SKILLS.has(obj.skill) ? obj.skill : null
  const needs_knowledge = Boolean(obj.needs_knowledge)
  const knowledge_query = needs_knowledge && typeof obj.knowledge_query === 'string' && obj.knowledge_query.trim()
    ? obj.knowledge_query.trim().toLowerCase()
    : null
  const wants_affiliation = intent === 'affiliate' && Boolean(obj.wants_affiliation)
  const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning.slice(0, 200) : ''

  return { intent, needs_knowledge, knowledge_query, skill, wants_affiliation, reasoning }
}

export async function runRouter({ message, history = [], state = {} }, opts = {}) {
  const anthropicKey = opts.anthropicKey || process.env.ANTHROPIC_API_KEY?.replace(/[^\x20-\x7E]/g, '').trim()
  const model = opts.model || process.env.ANTHROPIC_MODEL_ROUTER || 'claude-opus-4-7'
  const fetchImpl = opts.fetchImpl || nodeFetch

  if (!anthropicKey) return { ...FALLBACK, reasoning: 'missing ANTHROPIC_API_KEY' }

  const recentHistory = Array.isArray(history) ? history.slice(-6) : []
  const stateLine = state && state.nombre && state.nombre !== 'Amigo'
    ? `Usuario identificado: ${state.nombre}. Paso: ${state.step || 'conversando'}.`
    : `Usuario aún sin nombre.`

  const userBlock = [
    stateLine,
    recentHistory.length ? 'Historial reciente:' : '',
    ...recentHistory.map((m) => `${m.role === 'user' ? 'Usuario' : 'Bot'}: ${m.content}`),
    '',
    `Último mensaje del usuario: ${message}`,
    '',
    'Devolvé el JSON del Router.',
  ].filter(Boolean).join('\n')

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
        max_tokens: 300,
        system: ROUTER_PROMPT,
        messages: [{ role: 'user', content: userBlock }],
      }),
    })

    if (!res.ok) return { ...FALLBACK, reasoning: `router http ${res.status}` }

    const data = await res.json()
    const raw = data?.content?.[0]?.text || ''
    const parsed = coerceRouterJson(raw)
    return parsed || { ...FALLBACK, reasoning: 'router unparsable' }
  } catch (e) {
    return { ...FALLBACK, reasoning: `router exception: ${e.message}` }
  }
}

// Exported for tests.
export const _internal = { coerceRouterJson, ROUTER_PROMPT }
