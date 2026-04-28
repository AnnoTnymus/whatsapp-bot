// Test Suite v4.0 — Lógica pura (sin API calls)
// Cubre: respuestas fuera de flujo, emojis, tono rioplatense, follow-up messages

let passed = 0, failed = 0
const failures = []

function tick(name) { passed++; console.log(`  ✅ ${name}`) }
function fail(name, err) { failed++; failures.push({ name, err: err?.message || err }); console.log(`  ❌ ${name}: ${err?.message || err}`) }

function assert(name, fn) {
  try {
    const r = fn()
    if (r === false) fail(name, 'returned false')
    else tick(name)
  } catch (e) { fail(name, e) }
}

// ---------- Copias de funciones reales en index.js ----------
const RESPUESTAS_FUERA_FLUJO = {
  sticker: [
    'Jaja che 😄 Buen sticker pero necesito tus documentos, no emojis. Dale, mandame el REPROCANN 📄',
    'Boludo, me encantó 👍 Pero ahora necesito que me pases los papeles che 🤔',
    'Ey, muy bueno 😂 Pero acá tenemos que laburar. ¿Tus documentos? 📸',
  ],
  imagen_random: [
    'Che, linda foto boludo 📸 Pero necesito tu DNI y REPROCANN, no fotos del bolso 😅',
    'Ey, hermosa la foto 🔥 Pero acá necesitamos el DNI y el certificado che 📋',
    'Dale boludo, me encanta la onda 🌿 Pero pasame los documentos, anda 👀',
  ],
  solo_emojis: [
    '🤝 Te entiendo boludo. Ahora anda, mandame los documentos che',
    '✨ Dale che, eso suena bien. Pero necesito que me pases el REPROCANN 📄',
    '💯 De acuerdo. Ahora vamos con los documentos che 🚀',
  ],
  reaccion: [
    'Gracias boludo! 🙏 ¿Me pasas el REPROCANN? 📋',
    '¡Dale! 💪 ¿Tenés los documentos a mano che?',
  ],
}

function randomRespuesta(tipo) {
  const opciones = RESPUESTAS_FUERA_FLUJO[tipo] || RESPUESTAS_FUERA_FLUJO.sticker
  return opciones[Math.floor(Math.random() * opciones.length)]
}

const FOLLOWUP_MSGS = {
  sin_reprocann: [
    '¡Hola! ¿Pudiste iniciar el trámite del REPROCANN?',
    'El trámite REPROCANN tarda 20-30 días hábiles. ¿Ya lo iniciaste?',
  ],
  tramitando: [
    '¿Cómo viene el trámite? Si ya tenés el certificado, mandánoslo.',
    '¿Pudiste obtener tu REPROCANN? Te esperamos 🌿',
  ],
  docs_incompletos: [
    'Te falta enviar algunos documentos. ¿Podemos ayudarte?',
    'Completemos tu afiliación. ¿Tenés los documentos a mano?',
  ],
  inactivo: [
    '¿Podemos ayudarte? El proceso es simple, en unos minutos completás tu afiliación.',
    'Seguimos disponibles cuando quieras continuar.',
  ],
}

function buildFollowUpMessage(followup) {
  const opciones = FOLLOWUP_MSGS[followup.motivo] || []
  return opciones[Math.min(followup.intentos, opciones.length - 1)] || null
}

const SUPPORTED_LANGUAGES = ['es', 'en', 'pt']
const DEFAULT_LANGUAGE = 'es'

function detectLanguage(text) {
  if (!text || !text.trim()) return 'es'
  const t = text.toLowerCase().trim()

  if (/^(oi|olá|ola\b|ola!|bom dia|boa tarde|boa noite|td bem|tudo bem|valeu)/i.test(t) ||
      /\b(obrigado|obrigada|preciso|posso|vocês|você|quando\b|também|não\b|está\b|ção\b)/i.test(t)) {
    return 'pt'
  }

  if (/^(hello|hi\b|hey\b|good morning|good afternoon|good evening|good night)/i.test(t) ||
      /\b(hello|thanks|thank you|please|strains|genetics|membership|i need|i want|i would|can i|do you|how are|what is|where is|when is)\b/i.test(t) ||
      / i /i.test(t) || t.startsWith('i ') || t.startsWith("i'")) {
    return 'en'
  }

  if (/[áéíóúñ]/i.test(t)) return 'es'

  return 'es'
}

function getLanguageSignal(text, detectedLang = detectLanguage(text)) {
  if (!text || !text.trim()) return { language: DEFAULT_LANGUAGE, clear: false }

  const t = text.toLowerCase().trim()
  const ambiguous = /^(ok|okay|dale|listo|si|sí|sim|yes|no|jaja|haha|jeje|👍|👌|🙏|\.{1,3}|!+|\?+|\d+)$/i
  if (ambiguous.test(t)) {
    return { language: detectedLang || DEFAULT_LANGUAGE, clear: false }
  }

  const clearPatterns = {
    es: /^(hola|hol[aa]+|buenas?|buen\s?d[ií]a|buenos\s?d[ií]as|buenas\s?tardes|buenas\s?noches)\b|\b(gracias|quiero|necesito|puedo|consulta|consultar|afiliar|asociar|inscribir|documentos?|reprocann|cuota|prueba)\b|[áéíóúñ]/i,
    en: /^(hello|hi\b|hey\b|good morning|good afternoon|good evening|good night)\b|\b(thanks|thank you|please|i need|i want|i would|can i|do you|how are|what is|where is|when is|strains|genetics|membership)\b/i,
    pt: /^(oi|olá|ola\b|bom dia|boa tarde|boa noite|td bem|tudo bem|valeu)\b|\b(obrigado|obrigada|preciso|posso|vocês|voces|você|voce|quero me|portugu[eê]s)\b/i,
  }

  return {
    language: detectedLang || DEFAULT_LANGUAGE,
    clear: Boolean(clearPatterns[detectedLang]?.test(t)),
  }
}

function resolveConversationLanguage(message, state, detectedLang = detectLanguage(message)) {
  const signal = getLanguageSignal(message, detectedLang)
  const currentLang = SUPPORTED_LANGUAGES.includes(state?.language) ? state.language : null

  if (signal.clear && SUPPORTED_LANGUAGES.includes(signal.language)) {
    return signal.language
  }

  return currentLang || DEFAULT_LANGUAGE
}

// ---------- SUITE 7: Respuestas fuera de flujo ----------
console.log('🧪 WhatsApp Bot v4.0 — Test Suite (Lógica)')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

console.log('\n🎭 Suite 7: Respuestas fuera de flujo')

assert('TC7.1 randomRespuesta(sticker) retorna string', () => {
  const r = randomRespuesta('sticker')
  return typeof r === 'string' && r.length > 0
})
assert('TC7.2 randomRespuesta(imagen_random) retorna string', () => {
  const r = randomRespuesta('imagen_random')
  return typeof r === 'string' && r.length > 0
})
assert('TC7.3 randomRespuesta(solo_emojis) retorna string', () => {
  const r = randomRespuesta('solo_emojis')
  return typeof r === 'string' && r.length > 0
})
assert('TC7.4 randomRespuesta(reaccion) retorna string', () => {
  const r = randomRespuesta('reaccion')
  return typeof r === 'string' && r.length > 0
})
assert('TC7.5 randomRespuesta(desconocido) hace fallback a sticker', () => {
  const r = randomRespuesta('tipo_inexistente')
  return typeof r === 'string' && RESPUESTAS_FUERA_FLUJO.sticker.includes(r)
})

// Distribución random — 10 calls deben variar
assert('TC7.6 randomRespuesta varía (no siempre el mismo)', () => {
  const results = new Set()
  for (let i = 0; i < 30; i++) results.add(randomRespuesta('sticker'))
  return results.size >= 2
})

// ---------- SUITE 8: Tono rioplatense ----------
console.log('\n🇦🇷 Suite 8: Tono rioplatense y emojis')

const RIOPLATENSE_WORDS = ['che', 'boludo', 'dale', 'anda', 'pasame', 'laburar', 'mandame', 'tenés', 'podés']

assert('TC8.1 Sticker responses tienen palabras rioplatenses', () => {
  return RESPUESTAS_FUERA_FLUJO.sticker.every(r =>
    RIOPLATENSE_WORDS.some(w => r.toLowerCase().includes(w))
  )
})
assert('TC8.2 Imagen_random tienen palabras rioplatenses', () => {
  return RESPUESTAS_FUERA_FLUJO.imagen_random.every(r =>
    RIOPLATENSE_WORDS.some(w => r.toLowerCase().includes(w))
  )
})
assert('TC8.3 Solo_emojis tienen palabras rioplatenses', () => {
  return RESPUESTAS_FUERA_FLUJO.solo_emojis.every(r =>
    RIOPLATENSE_WORDS.some(w => r.toLowerCase().includes(w))
  )
})
assert('TC8.4 Reacciones tienen palabras rioplatenses', () => {
  return RESPUESTAS_FUERA_FLUJO.reaccion.every(r =>
    RIOPLATENSE_WORDS.some(w => r.toLowerCase().includes(w))
  )
})

// Emojis
const EMOJI_RE = /\p{Emoji}/u

assert('TC8.5 Sticker responses tienen al menos 1 emoji', () => {
  return RESPUESTAS_FUERA_FLUJO.sticker.every(r => EMOJI_RE.test(r))
})
assert('TC8.6 Imagen_random tienen emojis', () => {
  return RESPUESTAS_FUERA_FLUJO.imagen_random.every(r => EMOJI_RE.test(r))
})
assert('TC8.7 Solo_emojis tienen emojis', () => {
  return RESPUESTAS_FUERA_FLUJO.solo_emojis.every(r => EMOJI_RE.test(r))
})
assert('TC8.8 Reacciones tienen emojis', () => {
  return RESPUESTAS_FUERA_FLUJO.reaccion.every(r => EMOJI_RE.test(r))
})

// Longitud razonable (no muy largas)
assert('TC8.9 Respuestas < 200 chars', () => {
  const todas = [
    ...RESPUESTAS_FUERA_FLUJO.sticker,
    ...RESPUESTAS_FUERA_FLUJO.imagen_random,
    ...RESPUESTAS_FUERA_FLUJO.solo_emojis,
    ...RESPUESTAS_FUERA_FLUJO.reaccion,
  ]
  return todas.every(r => r.length < 200)
})

// ---------- SUITE 9: Detector emoji-only ----------
console.log('\n😀 Suite 9: Detector emoji-only regex')

const EMOJI_ONLY = /^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\s‍️]+$/u

assert('TC9.1 "🔥🔥🔥" es emoji-only', () => EMOJI_ONLY.test('🔥🔥🔥'))
assert('TC9.2 "😀😁😂" es emoji-only', () => EMOJI_ONLY.test('😀😁😂'))
assert('TC9.3 "👍 🎉" con espacios es emoji-only', () => EMOJI_ONLY.test('👍 🎉'))
assert('TC9.4 "Hola 🔥" NO es emoji-only', () => !EMOJI_ONLY.test('Hola 🔥'))
assert('TC9.5 "che 😂" NO es emoji-only', () => !EMOJI_ONLY.test('che 😂'))
assert('TC9.6 "hola" NO es emoji-only', () => !EMOJI_ONLY.test('hola'))
assert('TC9.7 Emoji con variation selector', () => EMOJI_ONLY.test('❤️'))
assert('TC9.8 Emoji compuesto (familia, skin tone)', () => EMOJI_ONLY.test('👨‍👩‍👧'))

// ---------- SUITE 10: buildFollowUpMessage ----------
console.log('\n🔁 Suite 10: Follow-up messages')

assert('TC10.1 sin_reprocann intento 0', () => {
  const m = buildFollowUpMessage({ motivo: 'sin_reprocann', intentos: 0 })
  return m && m.includes('iniciar')
})
assert('TC10.2 sin_reprocann intento 1 (diferente mensaje)', () => {
  const m0 = buildFollowUpMessage({ motivo: 'sin_reprocann', intentos: 0 })
  const m1 = buildFollowUpMessage({ motivo: 'sin_reprocann', intentos: 1 })
  return m0 !== m1
})
assert('TC10.3 tramitando intento 0', () => {
  const m = buildFollowUpMessage({ motivo: 'tramitando', intentos: 0 })
  return m && m.includes('trámite')
})
assert('TC10.4 docs_incompletos intento 0', () => {
  const m = buildFollowUpMessage({ motivo: 'docs_incompletos', intentos: 0 })
  return m && m.toLowerCase().includes('document')
})
assert('TC10.5 inactivo intento 0', () => {
  const m = buildFollowUpMessage({ motivo: 'inactivo', intentos: 0 })
  return m && typeof m === 'string'
})
assert('TC10.6 intento alto retorna último mensaje (no null)', () => {
  const m = buildFollowUpMessage({ motivo: 'sin_reprocann', intentos: 99 })
  return m !== null
})
assert('TC10.7 motivo inexistente retorna null', () => {
  const m = buildFollowUpMessage({ motivo: 'no_existe', intentos: 0 })
  return m === null
})

// ---------- SUITE 11: Regex para textos especiales ----------
console.log('\n🔠 Suite 11: Procesamiento de texto')

assert('TC11.1 Texto con acentos se maneja OK', () => {
  const s = 'José Peña Muñoz'
  return s.length === 15 && s.includes('ñ')
})
assert('TC11.2 Texto vacío detectado', () => {
  const s = ''
  return !s.trim()
})
assert('TC11.3 Texto con solo espacios detectado', () => {
  const s = '    '
  return !s.trim()
})
assert('TC11.4 Texto muy largo truncable', () => {
  const s = 'A'.repeat(2000)
  return s.substring(0, 1000).length === 1000
})

// ---------- SUITE 12: State machine transitions ----------
console.log('\n🔀 Suite 12: State machine validación')

const VALID_STEPS = ['inicio', 'solicitando_nombre', 'recibiendo_documentos', 'completando_datos', 'completado']

assert('TC12.1 Todos los steps son strings válidos', () => VALID_STEPS.every(s => typeof s === 'string'))

function isValidTransition(from, to) {
  const transitions = {
    'inicio': ['solicitando_nombre', 'recibiendo_documentos'],
    'solicitando_nombre': ['recibiendo_documentos'],
    'recibiendo_documentos': ['completando_datos', 'completado'],
    'completando_datos': ['completado'],
    'completado': [],
  }
  return transitions[from]?.includes(to) || false
}

assert('TC12.2 inicio → solicitando_nombre válido', () => isValidTransition('inicio', 'solicitando_nombre'))
assert('TC12.3 solicitando_nombre → recibiendo_documentos válido', () => isValidTransition('solicitando_nombre', 'recibiendo_documentos'))
assert('TC12.4 recibiendo_documentos → completando_datos válido', () => isValidTransition('recibiendo_documentos', 'completando_datos'))
assert('TC12.5 completando_datos → completado válido', () => isValidTransition('completando_datos', 'completado'))
assert('TC12.6 completado → cualquier otro NO válido', () => !isValidTransition('completado', 'inicio'))
assert('TC12.7 recibiendo_documentos → completado (skip datos) válido', () => isValidTransition('recibiendo_documentos', 'completado'))

// ---------- SUITE 13: Language resolution ----------
console.log('\nLanguage Suite 13: stale-state language correction')

assert('TC13.1 stale en + clear Spanish greeting switches to es', () => {
  return resolveConversationLanguage('Hola prueba cuota', { language: 'en' }) === 'es'
})
assert('TC13.2 stale en + ambiguous ok stays en', () => {
  return resolveConversationLanguage('ok', { language: 'en' }) === 'en'
})
assert('TC13.3 no state + ambiguous ok defaults to es', () => {
  return resolveConversationLanguage('ok', {}) === 'es'
})
assert('TC13.4 no state + clear English switches to en', () => {
  return resolveConversationLanguage('Hello, I need info', {}) === 'en'
})
assert('TC13.5 no state + clear Portuguese switches to pt', () => {
  return resolveConversationLanguage('Oi tudo bem', {}) === 'pt'
})

// ---------- Resultado ----------
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(`📊 ${passed} passed, ${failed} failed`)
if (failures.length) {
  console.log('\nFallos:')
  failures.forEach(f => console.log(`  - ${f.name}: ${f.err}`))
}
process.exit(failed > 0 ? 1 : 0)
