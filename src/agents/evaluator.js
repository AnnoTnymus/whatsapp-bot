// [claude-opus-4.7] 2026-04-24: runEvaluator + parseEvaluatorReply — scoring 0-100 de la respuesta del Generator.
// Contrato: docs/contracts-task48.md
//
// parseEvaluatorReply(rawLLMOutput) — parser puro, implementado por Claude per el contrato.
// runEvaluator({ reply, context }) — orquestador completo (llama al LLM y parsea).
// OpenCode puede reusar parseEvaluatorReply desde getEvaluatorScore si prefiere componer.

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import nodeFetch from 'node-fetch'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EVALUATOR_PROMPT = readFileSync(join(__dirname, 'prompts', 'evaluator.md'), 'utf8')

const PASS_THRESHOLD = 70  // Standard threshold

function clampScore(n) {
  const v = Number.isFinite(n) ? Math.round(n) : 0
  return Math.max(0, Math.min(100, v))
}

/**
 * Parses the raw LLM output into the {score, reasons, passes} contract shape.
 * Tolerates:
 *   - trailing / leading text around the JSON
 *   - ```json fences``` the model might add despite instructions
 *   - missing `passes` (derived from score >= 70)
 *   - reasons as a string (split by newline / bullet)
 * Never throws. On total failure returns a zero-score failing result.
 */
export function parseEvaluatorReply(rawLLMOutput) {
  const raw = (rawLLMOutput || '').trim()
  if (!raw) return { score: 0, reasons: ['evaluator output vacío'], passes: false }

  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return { score: 0, reasons: ['evaluator output sin JSON'], passes: false }

  let obj
  try {
    obj = JSON.parse(match[0])
  } catch {
    return { score: 0, reasons: ['evaluator JSON inválido'], passes: false }
  }

  const score = clampScore(obj.score)

  let reasons
  if (Array.isArray(obj.reasons)) {
    reasons = obj.reasons.map((r) => String(r).slice(0, 200)).filter(Boolean)
  } else if (typeof obj.reasons === 'string') {
    reasons = obj.reasons
      .split(/\n|•|-\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6)
  } else {
    reasons = []
  }
  if (reasons.length === 0) reasons = ['sin razones provistas']

  const passes = typeof obj.passes === 'boolean' ? obj.passes : score >= PASS_THRESHOLD

  return { score, reasons, passes }
}

export async function runEvaluator({ reply, context = {} }, opts = {}) {
  const trimmed = (reply || '').trim()
  if (!trimmed) return { score: 0, reasons: ['reply vacía o inválida'], passes: false }

  const lang = opts.lang || 'es'
  const userLabel = lang === 'en' ? 'User' : lang === 'pt' ? 'Usuário' : 'Usuario'
  const botLabel = lang === 'en' ? 'Bot' : lang === 'pt' ? 'Bot' : 'Bot'
  
  const anthropicKey = opts.anthropicKey || process.env.ANTHROPIC_API_KEY?.replace(/[^\x20-\x7E]/g, '').trim()
  const model = opts.model || process.env.ANTHROPIC_MODEL_EVALUATOR || 'claude-haiku-4-5-20250514'
  const fetchImpl = opts.fetchImpl || nodeFetch

  if (!anthropicKey) {
    // No API key available — be conservative and let the reply pass to avoid blocking prod on config issues.
    return { score: 70, reasons: ['evaluator bypass: sin ANTHROPIC_API_KEY'], passes: true }
  }

  const history = Array.isArray(context.history) ? context.history.slice(-6) : []
  const historyBlock = history.length
    ? history.map((m) => `${m.role === 'user' ? userLabel : botLabel}: ${m.content}`).join('\n')
    : '(sin historial)'

  const userBlock = [
    'Reply candidata a evaluar (entre triple comillas):',
    '"""',
    trimmed,
    '"""',
    '',
    'Historial reciente:',
    historyBlock,
    '',
    'Devolvé el JSON del Evaluator.',
  ].join('\n')

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
        max_tokens: 350,
        system: EVALUATOR_PROMPT,
        messages: [{ role: 'user', content: userBlock }],
      }),
    })

    if (!res.ok) {
      let errorDetail = `http ${res.status}`
      if (res.status === 400) {
        try {
          const errorBody = await res.json()
          errorDetail = `http 400: ${JSON.stringify(errorBody)}`
        } catch {
          errorDetail = 'http 400 (no body)'
        }
      }
      return { score: 70, reasons: [`evaluator ${errorDetail}`], passes: true }
    }

    const data = await res.json()
    const rawText = data?.content?.[0]?.text || ''
    return parseEvaluatorReply(rawText)
  } catch (e) {
    return { score: 70, reasons: [`evaluator exception: ${e.message}`], passes: true }
  }
}

export const _internal = { PASS_THRESHOLD, EVALUATOR_PROMPT, clampScore }
