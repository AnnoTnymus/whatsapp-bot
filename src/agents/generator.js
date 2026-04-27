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

function loadPrompt(language = 'es') {
  const langMap = {
    es: 'generator.md',
    en: 'generator-en.md', 
    pt: 'generator-pt.md'
  }
  const file = langMap[language] || 'generator.md'
  try {
    return readFileSync(join(__dirname, 'prompts', file), 'utf8')
  } catch {
    return readFileSync(join(__dirname, 'prompts', 'generator.md'), 'utf8')
  }
}

const FALLBACK = {
  es: 'Tuve un problema para responderte 😔 ¿Querés que te pase con alguien del equipo?',
  en: 'I had some trouble responding 😔 Would you like me to connect you with someone from our team?',
  pt: 'Tive um problema para responder 😔 Você quer que eu passe para alguém da equipe?'
}

const GREET = {
  es: `Bienvenido a Indajaus 🌿

Te estás comunicando con nuestro club cannábico en Argentina. 
Somos una empresa que viene desde Uruguay trayendo más de una década de experiencia en el sector del cannabis. 
Estás en el lugar indicado.

¿Cuál es tu nombre?`,
  en: `Welcome to Indajaus 🌿

You're reaching our cannabis club in Argentina. 
We're a company from Uruguay with over a decade of experience in the cannabis sector. 
You're in the right place.

What's your name?`,
  pt: `Bem-vindo à Indajaus 🌿

Você está entrando em contato com nosso club de cannabis na Argentina. 
Somos uma empresa do Uruguai com mais de uma década de experiência no setor. 
Você está no lugar certo.

Qual é o seu nome?`
}

const OPTIONS = {
  es: `Perfecto, gracias por escribirnos.

Acá podemos ayudarte con:
• 📝 **Inscripción al club** — es lo principal, te digo qué necesitamos
• 📚 **Info sobre Indajaus** — quiénes somos, cómo funciona, precios
• 🌿 **Dudas sobre cannabis** — genéticas, REPROCANN, leyes  
• 👥 **Hablar con alguien** — si prefieres atención humana

Yo soy IA entrenada para resolver dudas complejas, así que podemos hablar de cualquier cosa sin problemas.

¿Qué te interesa?`,
  en: `Perfect, thanks for reaching out.

Here's how we can help:
• 📝 **Club membership** — that's the main one, I'll tell you what we need
• 📚 **About Indajaus** — who we are, how it works, prices
• 🌿 **Cannabis questions** — genetics, REPROCANN, laws  
• 👥 **Talk to someone** — if you prefer human support

I'm AI trained to handle complex questions, so we can talk about anything.

What interests you?`,
  pt: `Perfeito, obrigado por entrar em contato.

Aqui está como podemos ajudar:
• 📝 **Associar ao club** — é o principal, vou te dizer o que precisamos
• 📚 **Sobre Indajaus** — quem somos, como funciona, preços
• 🌿 **Dúvidas sobre cannabis** — genética, REPROCANN, leis  
• 📞 **Falar com alguém** — se preferir suporte humano

Sou IA treinada para resolver dúvidas complexas, então podemos conversar sobre qualquer coisa.

O que te interessa?`
}

function getGreeting(lang = 'es') { return GREET[lang] || GREET.es }
function getOptions(lang = 'es') { return OPTIONS[lang] || OPTIONS.es }
function getFallback(lang = 'es') { return FALLBACK[lang] || FALLBACK.es }

const INFO_OPTIONS_KEYWORDS = ['menu', 'menú', 'opciones', 'qué puedes hacer', 'qué hacés', 'ayuda', 'help', 'que hace', 'que hace', 'informacion', 'informação', 'opções', 'ajuda', 'como funciona']

function getOptionsLang(lang = 'es') { return OPTIONS[lang] || OPTIONS.es }

function isInfoOptionsRequest(intent, currentStep, message, recentHistory, state) {
  // Always show options if user explicitly asks for menu/opciones/etc
  if (message) {
    const lowerMsg = message.toLowerCase()
    if (INFO_OPTIONS_KEYWORDS.some(kw => lowerMsg.includes(kw))) {
      return true
    }
  }
  // Or if info intent + in early conversation (sin nombre aún)
  const hasName = state?.nombre && state.nombre !== 'Amigo'
  if (intent === 'info' && !hasName && (currentStep === 'inicio' || currentStep === 'conversando') && recentHistory.length <= 2) {
    return true
  }
  return false
}

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
  const model = opts.model || process.env.ANTHROPIC_MODEL_GENERATOR || 'claude-opus-4-20250514'
  const fetchImpl = opts.fetchImpl || nodeFetch
  const maxTokens = opts.maxTokens || 400

  if (!anthropicKey) return { reply: getFallback(lang), wants_affiliation: false }

  const recentHistory = Array.isArray(history) ? history.slice(-8) : []
  const currentStep = state?.step || 'inicio'
  const stateLine = state && state.nombre && state.nombre !== 'Amigo'
    ? `Nombre del usuario: ${state.nombre}. Paso: ${currentStep}.`
    : 'Usuario sin nombre registrado.'

  // Add step-specific instructions
  let stepInstructions = ''
  let forcedReply = null

  // Check for greet intent with no history or greet with "hola" message
  const lang = state?.language || 'es'
  if (intent === 'greet' && (!recentHistory.length || message.toLowerCase().match(/^hola+$/))) {
    forcedReply = getGreeting(lang)
  } else if (isInfoOptionsRequest(intent, currentStep, message, recentHistory, state)) {
    forcedReply = getOptions(lang)
  } else if (currentStep === 'solicitando_nombre' || (intent === 'affiliate' && !state.nombre)) {
    stepInstructions = '\n⚠️ ACCIÓN REQUERIDA: El usuario aún no tiene nombre. Pedir nombre directamente, no saludar genéricamente.'
  } else if (currentStep === 'recibiendo_documentos') {
    stepInstructions = '\n⚠️ ACCIÓN REQUERIDA: El usuario está en proceso de enviar documentos. Pedir DNI y REPROCANN.'
  } else if (currentStep === 'completando_datos' && state.pendingFields?.length > 0) {
    const field = state.pendingFields[0]
    stepInstructions = `\n⚠️ ACCIÓN REQUERIDA: Falta completar "${field.label}". Pedir ese dato específico.`
  }

  // Return forced reply for greet/info without history
  if (forcedReply) {
    return { reply: forcedReply, wants_affiliation: false }
  }

  const systemWithContext = [
    loadPrompt(state?.language),
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

    if (!res.ok) return { reply: getFallback(lang), wants_affiliation: false }

    const data = await res.json()
    const raw = (data?.content?.[0]?.text || '').trim()
    if (!raw) return { reply: getFallback(lang), wants_affiliation: false }

    const wants_affiliation = /\[\[AFILIAR\]\]/i.test(raw)
    // Drop both [[AFILIAR]] and stray [[SKILL:...]] markers — the new pipeline routes skills before generator runs.
    const reply = raw
      .replace(/\[\[AFILIAR\]\]/gi, '')
      .replace(/\[\[SKILL:[^\]]+\]\]/gi, '')
      .trim()

    return { reply: reply || getFallback(lang), wants_affiliation }
  } catch {
    return { reply: getFallback(lang), wants_affiliation: false }
  }
}

export const _internal = { renderSnippets, loadPrompt }
