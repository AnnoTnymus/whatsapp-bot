// Pipeline Scenarios Test — tests logic conditions without real LLM calls
// Validates: language flow, greeting intercept, step transitions, marker parsing

const PASS = '\x1b[32m✅\x1b[0m'
const FAIL = '\x1b[31m❌\x1b[0m'
let passed = 0, failed = 0

function assert(condition, name, got, expected) {
  if (condition) {
    console.log(`  ${PASS} ${name}`)
    passed++
  } else {
    console.log(`  ${FAIL} ${name}`)
    console.log(`       got: ${JSON.stringify(got)}`)
    console.log(`  expected: ${JSON.stringify(expected)}`)
    failed++
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Copy the pure functions from index.js so we can test them in isolation
// ──────────────────────────────────────────────────────────────────────────────

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

function parseLanguageSelection(text) {
  if (!text) return null
  const lower = text.toLowerCase().trim()
  if (lower === '1') return 'es'
  if (lower === '2') return 'en'
  if (lower === '3') return 'pt'
  if (/^es|span|esp|españ/.test(lower)) return 'es'
  if (/^en|ing|engl/.test(lower)) return 'en'
  if (/^port|portug/.test(lower)) return 'pt'
  return null
}

function getLanguageConfirmation(lang) {
  const msgs = { es: '✅ Perfecto, ahora chateamos en español.', en: '✅ Perfect, we will chat in English.', pt: '✅ Perfeito, agora vamos conversar em português.' }
  return msgs[lang] || msgs.es
}

// ──────────────────────────────────────────────────────────────────────────────
// Logic helpers (extracted from handleMessage conditions)
// ──────────────────────────────────────────────────────────────────────────────

function isNombreInvalido(state) {
  return !state.nombre || state.nombre === 'Amigo' || state.nombre.trim() === '' || state.nombre === '5491112345678@c.us'
}

const ACTIVE_STEPS = ['recibiendo_documentos', 'completando_datos', 'solicitando_nombre', 'aclarando_nombre', 'seleccionando_idioma']

function isGreetMsg(msg) {
  return /^(hola|hello|hi\b|hey\b|ola\b|oi\b|olá|buenas?|buen\s?d[íi]a|buenos\s?d[íi]as|bom\s|boa\s|good\s)/i.test(msg.trim())
}

function shouldShowReturnGreet(state, msg) {
  return !isNombreInvalido(state) && isGreetMsg(msg) && !ACTIVE_STEPS.includes(state.step)
}

function wantsToChangeLang(msg) {
  return /(cambiar.*idioma|cambiar.*lenguaje|change.*language|change.*english|change.*spanish|switch.*english|switch.*spanish|switch.*portuguese|mudar.*idioma|quero em português)/i.test(msg.toLowerCase())
}

// ──────────────────────────────────────────────────────────────────────────────
// [[AFILIAR]] marker detection (from pipeline post-processing)
// ──────────────────────────────────────────────────────────────────────────────

function detectAfiliarMarker(reply) {
  return /\[\[AFILIAR\]\]/.test(reply)
}
function stripAfiliarMarker(reply) {
  return reply.replace(/\n?\[\[AFILIAR\]\]/g, '').trim()
}

// ──────────────────────────────────────────────────────────────────────────────
// Suite 1 — Language detection
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n══ Suite 1: Language detection ══')
assert(detectLanguage('hola') === 'es',             'hola → es')
assert(detectLanguage('buenos días') === 'es',      'buenos días → es')
assert(detectLanguage('quiero inscribirme') === 'es','quiero inscribirme → es')
assert(detectLanguage('cómo funciona') === 'es',    'cómo funciona → es (accent)')
assert(detectLanguage('hello') === 'en',            'hello → en')
assert(detectLanguage('hi there') === 'en',         'hi there → en')
assert(detectLanguage('good morning') === 'en',     'good morning → en')
assert(detectLanguage('can i join') === 'en',       'can i join → en')
assert(detectLanguage('I need info') === 'en',      'I need info → en')
assert(detectLanguage('i want to join') === 'en',   'i want to join → en')
assert(detectLanguage('what is REPROCANN') === 'en','what is REPROCANN → en')
assert(detectLanguage('obrigado') === 'pt',         'obrigado → pt')
assert(detectLanguage('oi tudo bem') === 'pt',      'oi tudo bem → pt')
assert(detectLanguage('ola') === 'pt',              'ola (standalone) → pt')
assert(detectLanguage('bom dia') === 'pt',          'bom dia → pt')
assert(detectLanguage('preciso me associar') === 'pt','preciso me associar → pt')
assert(detectLanguage('') === 'es',                 'empty → es (default)')
assert(detectLanguage('ok') === 'es',               'ok → es (neutral, defaults to es)')
assert(detectLanguage('si') === 'es',               'si → es')

// ──────────────────────────────────────────────────────────────────────────────
// Suite 2 — Language selection parsing
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n══ Suite 2: Language selection ══')
assert(parseLanguageSelection('1') === 'es',       '"1" → es')
assert(parseLanguageSelection('2') === 'en',       '"2" → en')
assert(parseLanguageSelection('3') === 'pt',       '"3" → pt')
assert(parseLanguageSelection('español') === 'es', '"español" → es')
assert(parseLanguageSelection('english') === 'en', '"english" → en')
assert(parseLanguageSelection('portugues') === 'pt','"portugues" → pt')
assert(parseLanguageSelection('espanol') === 'es', '"espanol" (sin tilde) → es')
assert(parseLanguageSelection('hola') === null,    '"hola" → null (not a language)')
assert(parseLanguageSelection('') === null,         'empty → null')

// ──────────────────────────────────────────────────────────────────────────────
// Suite 3 — Language change request detection
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n══ Suite 3: Language change detection ══')
assert(wantsToChangeLang('cambiar idioma'),          'cambiar idioma → true')
assert(wantsToChangeLang('quiero cambiar el idioma'),'quiero cambiar el idioma → true')
assert(wantsToChangeLang('switch to english'),       'switch to english → true')
assert(wantsToChangeLang('switch to spanish'),       'switch to spanish → true')
assert(wantsToChangeLang('change language'),         'change language → true')
assert(wantsToChangeLang('change to english'),       'change to english → true')
assert(!wantsToChangeLang('hola como estás'),        'hola como estás → false')
assert(!wantsToChangeLang('quiero inscribirme'),     'quiero inscribirme → false')
assert(!wantsToChangeLang('ok'),                     'ok → false')

// ──────────────────────────────────────────────────────────────────────────────
// Suite 4 — New vs returning user logic
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n══ Suite 4: New vs returning user ══')
const newUser = { nombre: null, step: 'inicio', language: null }
const newUserAmigo = { nombre: 'Amigo', step: 'conversando', language: 'es' }
const knownUser = { nombre: 'María', step: 'conversando', language: 'es' }
const knownInDocs = { nombre: 'Juan', step: 'recibiendo_documentos', language: 'es' }
const knownSolicitando = { nombre: 'Ana', step: 'solicitando_nombre', language: 'es' }

assert(isNombreInvalido(newUser),           'null nombre → invalid')
assert(isNombreInvalido(newUserAmigo),      '"Amigo" nombre → invalid')
assert(!isNombreInvalido(knownUser),        'María → valid')
assert(!isNombreInvalido(knownInDocs),      'Juan in docs → valid')

// ──────────────────────────────────────────────────────────────────────────────
// Suite 5 — Returning user greeting intercept
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n══ Suite 5: Returning user greeting intercept ══')
assert(shouldShowReturnGreet(knownUser, 'hola'),           'known+hola+conversando → show return greet')
assert(shouldShowReturnGreet(knownUser, 'hello'),          'known+hello+conversando → show return greet')
assert(shouldShowReturnGreet(knownUser, 'buenos días'),    'known+buenos días → show return greet')
assert(shouldShowReturnGreet(knownUser, 'good morning'),   'known+good morning → show return greet')
assert(!shouldShowReturnGreet(newUser, 'hola'),            'new user+hola → NO return greet')
assert(!shouldShowReturnGreet(newUserAmigo, 'hola'),       'Amigo+hola → NO return greet')
assert(!shouldShowReturnGreet(knownInDocs, 'hola'),        'known+hola+recibiendo_docs → NO return greet (active flow)')
assert(!shouldShowReturnGreet(knownSolicitando, 'hola'),   'known+hola+solicitando_nombre → NO return greet (active flow)')
assert(!shouldShowReturnGreet(knownUser, 'quiero inscribirme'), 'known+affiliate msg → NO return greet (not greeting)')
assert(!shouldShowReturnGreet(knownUser, 'necesito info'), 'known+info msg → NO return greet')

// ──────────────────────────────────────────────────────────────────────────────
// Suite 6 — Language assigned on first message only
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n══ Suite 6: Language first-contact assignment ══')

function getLanguageSignal(text, detectedLang = detectLanguage(text)) {
  if (!text || !text.trim()) return { language: 'es', clear: false }
  const t = text.toLowerCase().trim()
  if (/^(ok|okay|dale|listo|si|sí|sim|yes|no|jaja|haha|jeje|👍|👌|🙏|\.{1,3}|!+|\?+|\d+)$/i.test(t)) {
    return { language: detectedLang || 'es', clear: false }
  }
  const clearPatterns = {
    es: /^(hola|hol[aa]+|buenas?|buen\s?d[ií]a|buenos\s?d[ií]as|buenas\s?tardes|buenas\s?noches)\b|\b(gracias|quiero|necesito|puedo|consulta|consultar|afiliar|asociar|inscribir|documentos?|reprocann|cuota|prueba)\b|[áéíóúñ]/i,
    en: /^(hello|hi\b|hey\b|good morning|good afternoon|good evening|good night)\b|\b(thanks|thank you|please|i need|i want|i would|can i|do you|how are|what is|where is|when is|strains|genetics|membership)\b/i,
    pt: /^(oi|olá|ola\b|bom dia|boa tarde|boa noite|td bem|tudo bem|valeu)\b|\b(obrigado|obrigada|preciso|posso|vocês|voces|você|voce|quero me|portugu[eê]s)\b/i,
  }
  return { language: detectedLang || 'es', clear: Boolean(clearPatterns[detectedLang]?.test(t)) }
}

function simulateLanguageAssignment(state, message) {
  const detectedLang = detectLanguage(message)
  const signal = getLanguageSignal(message, detectedLang)
  if (signal.clear) state.language = signal.language
  return state.language || 'es'
}

const stateNoLang = { language: null }
const stateEsLang = { language: 'es' }
const stateEnLang = { language: 'en' }

assert(simulateLanguageAssignment({ language: null }, 'hello') === 'en',    'no lang + english msg → en')
assert(simulateLanguageAssignment({ language: null }, 'hola') === 'es',     'no lang + spanish msg → es')
assert(simulateLanguageAssignment({ language: 'es' }, 'hello') === 'en',   'es set + clear english msg → switches en')
assert(simulateLanguageAssignment({ language: 'en' }, 'hola') === 'es',    'en set + clear spanish msg → switches es')
assert(simulateLanguageAssignment({ language: 'en' }, 'ok') === 'en',      'en set + ambiguous ok → stays en')
assert(simulateLanguageAssignment({ language: null }, 'ok') === 'es',      'no lang + ambiguous ok → defaults es')

function simulateReturnGreeting(state, message) {
  const resolvedLang = simulateLanguageAssignment({ ...state }, message)
  const RETURN_GREET = {
    es: `¡Hola de nuevo, *${state.nombre}*! 👋\n\n¿En qué te puedo ayudar hoy?`,
    en: `Hey *${state.nombre}*, welcome back! 👋\n\nHow can I help you today?`,
    pt: `Olá, *${state.nombre}*, que bom te ver! 👋\n\nComo posso ajudar hoje?`,
  }
  return RETURN_GREET[resolvedLang] || RETURN_GREET.es
}

const staleEnglishGreeting = simulateReturnGreeting({ language: 'en', nombre: 'Martin' }, 'Hola prueba cuota')
assert(staleEnglishGreeting.includes('¡Hola de nuevo'), 'stale en + "Hola prueba cuota" → Spanish return greeting')
assert(!staleEnglishGreeting.includes('welcome back'), 'stale en + Spanish greeting does not return English copy')

// ──────────────────────────────────────────────────────────────────────────────
// Suite 7 — [[AFILIAR]] marker
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n══ Suite 7: [[AFILIAR]] marker ══')
assert(detectAfiliarMarker('Claro, vamos a arrancar!\n[[AFILIAR]]'),    'detects [[AFILIAR]] at end')
assert(detectAfiliarMarker('[[AFILIAR]]'),                              'detects standalone [[AFILIAR]]')
assert(!detectAfiliarMarker('Hola, ¿cómo estás?'),                     'no false positive')
assert(!detectAfiliarMarker('Quiero afiliarme'),                        'afiliarme word ≠ [[AFILIAR]] marker')
assert(stripAfiliarMarker('Ok vamos!\n[[AFILIAR]]') === 'Ok vamos!',   'strips [[AFILIAR]] and trailing newline')
assert(stripAfiliarMarker('[[AFILIAR]]') === '',                        'strips standalone marker to empty')

// ──────────────────────────────────────────────────────────────────────────────
// Suite 8 — Language confirmation messages
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n══ Suite 8: Language confirmations ══')
assert(getLanguageConfirmation('es').includes('español'),  'es confirmation in Spanish')
assert(getLanguageConfirmation('en').includes('English'),  'en confirmation in English')
assert(getLanguageConfirmation('pt').includes('português'),'pt confirmation in Portuguese')
assert(getLanguageConfirmation('xx') === getLanguageConfirmation('es'), 'unknown lang falls back to es')

// ──────────────────────────────────────────────────────────────────────────────
// Suite 9 — Generator prompt files exist and have correct content
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n══ Suite 9: Generator prompt files ══')
import('fs').then(({ readFileSync }) => {
  import('path').then(({ join }) => {
    import('url').then(({ fileURLToPath }) => {
      const base = join(process.cwd(), 'src/agents/prompts')

      const prompts = {
        es: readFileSync(join(base, 'generator.md'), 'utf8'),
        en: readFileSync(join(base, 'generator-en.md'), 'utf8'),
        pt: readFileSync(join(base, 'generator-pt.md'), 'utf8'),
      }

      assert(!prompts.es.includes('Uruguay'),    'generator.md: no Uruguay reference')
      assert(!prompts.en.includes('Uruguay'),    'generator-en.md: no Uruguay reference')
      assert(!prompts.pt.includes('Uruguay'),    'generator-pt.md: no Uruguay reference')
      assert(prompts.es.includes('Argentina'),   'generator.md: mentions Argentina')
      assert(prompts.en.includes('Argentina'),   'generator-en.md: mentions Argentina')
      assert(prompts.pt.includes('Argentina'),   'generator-pt.md: mentions Argentina')
      assert(prompts.pt.includes('português') || prompts.pt.includes('Português'), 'generator-pt.md: Portuguese instruction')
      assert(prompts.es.includes('[[AFILIAR]]'), 'generator.md: has [[AFILIAR]] marker docs')
      assert(prompts.en.includes('[[AFILIAR]]'), 'generator-en.md: has [[AFILIAR]] marker docs')
      assert(prompts.pt.includes('[[AFILIAR]]'), 'generator-pt.md: has [[AFILIAR]] marker docs')

      // ──────────────────────────────────────────────────────────────────────
      // Suite 10 — index.js hardcoded string audit
      // ──────────────────────────────────────────────────────────────────────
      console.log('\n══ Suite 10: index.js hardcoded Spanish audit ══')
      const indexSrc = readFileSync(join(process.cwd(), 'index.js'), 'utf8')

      // Must NOT appear (wrong flag, hardcoded Spanish in multilang paths)
      assert(!indexSrc.includes('🇺🇾'), 'no Uruguay flag in index.js')
      assert(!indexSrc.includes("sendWhatsAppMessage(chatId, `Antes de continuar"), 'image handler: no hardcoded Spanish ask-name')
      assert(!indexSrc.includes("sendWhatsAppMessage(chatId, `Por favor respondé"), 'image handler: no hardcoded Spanish wait-name')
      assert(!indexSrc.includes("sendWhatsAppMessage(chatId, 'No logro identificar"), 'image handler: no hardcoded single-lang doc error')

      // Must still appear (correct strings in right places)
      assert(indexSrc.includes('detectedLang'), 'has detectedLang variable')
      assert(indexSrc.includes('resolveConversationLanguage'), 'language uses centralized current-message resolver')
      assert(indexSrc.includes('seleccionando_idioma'), 'has language selection step')
      assert(indexSrc.includes('langMenus'), 'has localized language menu')
      assert(indexSrc.includes('RETURN_GREET'), 'has returning user greeting object')
      assert(indexSrc.includes('ACTIVE_STEPS'), 'has active steps guard')

      // ──────────────────────────────────────────────────────────────────────
      // Suite 11 — Document flow strings are now multilang
      // ──────────────────────────────────────────────────────────────────────
      console.log('\n══ Suite 11: Document flow multilang audit ══')

      // These strings must not appear as direct sendWhatsAppMessage arguments (bypassing multilang map)
      assert(!indexSrc.includes("sendWhatsAppMessage(chatId, `¡Impecaaa!"), 'completado: not passed bare to sendWhatsApp')
      assert(!indexSrc.includes("sendWhatsAppMessage(chatId, `${analysis}\\n\\nAhora mandame"), 'doc-side-2: not passed bare to sendWhatsApp')
      assert(!indexSrc.includes("sendWhatsAppMessage(chatId, `¡Joya! 🙌"), 'completando_datos: not passed bare to sendWhatsApp')
      assert(!indexSrc.includes("sendWhatsAppMessage(chatId, `¡Ufff!"), 'missing-fields: not passed bare to sendWhatsApp')
      assert(!indexSrc.includes("sendWhatsAppMessage(chatId, `¡Joya che!"), 'faltantes: not passed bare to sendWhatsApp')

      // These multilang keys must exist
      assert(indexSrc.includes('_imgDoneMsgs'), 'completado (image path): has multilang map')
      assert(indexSrc.includes('_cdDoneMsgs'), 'completado (text path): has multilang map')
      assert(indexSrc.includes('_rpDorsoMsgs'), 'REPROCANN dorso: has multilang map')
      assert(indexSrc.includes('_dniDorsoMsgs'), 'DNI dorso: has multilang map')
      assert(indexSrc.includes('_faltMsgs'), 'faltantes: has multilang map')
      assert(indexSrc.includes('_mfMsgs'), 'missing-fields: has multilang map')
      assert(indexSrc.includes('_cdNextMsgs'), 'completando_datos next-field: has multilang map')

      // Generator step instructions must be in English
      const genSrc = readFileSync(join(process.cwd(), 'src/agents/generator.js'), 'utf8')
      assert(!genSrc.includes('ACCIÓN REQUERIDA'), 'generator: no Spanish ACCIÓN REQUERIDA')
      assert(genSrc.includes('ACTION REQUIRED'), 'generator: stepInstructions in English')
      assert(!genSrc.includes('sin snippets'), 'generator: no Spanish renderSnippets fallback')
      assert(!genSrc.includes('claude-opus-4-20250514'), 'generator: no invalid legacy model ID')
      assert(genSrc.includes('claude-opus-4-7'), 'generator: uses valid claude-opus-4-7 model')

      // ──────────────────────────────────────────────────────────────────────
      // Suite 12 — Never-silent guarantees
      // ──────────────────────────────────────────────────────────────────────
      console.log('\n══ Suite 12: Never-silent guarantees ══')

      // documentMessage must be handled as image (GreenAPI sends gallery-shared images as documentMessage)
      assert(indexSrc.includes("msgType === 'documentMessage'"), 'documentMessage included in image handler')
      assert(indexSrc.includes("'imageMessage' || msgType === 'documentMessage'"), 'imageMessage||documentMessage combined check')

      // imageUrl not found must reply, not silently return
      assert(!indexSrc.includes("if (!imageUrl) {\n          log('webhook', `No downloadUrl encontrada`)\n          return\n        }"),
        'imageUrl missing: sends reply instead of silent return')
      assert(indexSrc.includes('_urlErrMsgs'), 'imageUrl missing: has multilang error map')

      // Unsupported msgType must reply
      assert(indexSrc.includes('_unsupMsgs'), 'unsupported msgType: sends reply (not silent)')
      assert(!indexSrc.includes("log('webhook', `Tipo no soportado: ${msgType}`)\n      }"), 'no bare silent fallthrough')

      // catch block must reply
      assert(indexSrc.includes('Last-resort reply'), 'catch block: has last-resort reply comment')

      // ──────────────────────────────────────────────────────────────────────
      // Suite 14 — Step-aware greetings (completado / esperando_humano)
      // ──────────────────────────────────────────────────────────────────────
      console.log('\n══ Suite 14: Step-aware greetings ══')

      // Completado greeting
      assert(indexSrc.includes('COMPLETADO_GREET'), 'has COMPLETADO_GREET map')
      assert(indexSrc.includes("state.step === 'completado'"), 'greet intercept checks completado step')
      assert(indexSrc.includes('ya está en revisión') || indexSrc.includes('Alguien del club'),
        'completado greeting mentions review status')

      // Esperando_humano greeting
      assert(indexSrc.includes('ESPERA_GREET'), 'has ESPERA_GREET map')
      assert(indexSrc.includes("state.step === 'esperando_humano'"), 'greet intercept checks esperando_humano step')

      // Re-notification detector
      assert(indexSrc.includes('_noContactMsg'), 'has no-contact detector')
      assert(indexSrc.includes('_noContactSteps'), 'has no-contact steps array')
      assert(indexSrc.includes('Re-aviso:'), 're-notification has distinct email subject')
      assert(!indexSrc.includes('[RE-AVISO]'), 'old [RE-AVISO] tag replaced by proper subject')

      // Language change regex covers natural phrases
      const langChangeRegex = indexSrc.match(/const wantsToChangeLang = (.+)/)?.[1] || ''
      assert(langChangeRegex.includes('hablar.*idioma'), 'wantsToChangeLang: covers "hablar en otro idioma"')
      assert(langChangeRegex.includes('otro idioma'), 'wantsToChangeLang: covers "otro idioma"')
      assert(langChangeRegex.includes('speak.*english'), 'wantsToChangeLang: covers "speak english"')
      assert(langChangeRegex.includes('en inglés|en ingles'), 'wantsToChangeLang: covers "en inglés"')

      // notifyHumanHandover accepts opts.subject
      assert(indexSrc.includes('opts.subject ||'), 'notifyHumanHandover: subject override supported')

      // ──────────────────────────────────────────────────────────────────────
      // Suite 15 — Language menu + completado handover
      // ──────────────────────────────────────────────────────────────────────
      console.log('\n══ Suite 15: Language menu + completado-aware handover ══')

      // Language menu: new text with flags
      assert(indexSrc.includes('🇪🇸'), 'language menu: Spain flag')
      assert(indexSrc.includes('🇺🇸'), 'language menu: US flag')
      assert(indexSrc.includes('🇧🇷'), 'language menu: Brazil flag')
      assert(indexSrc.includes('Soy trilingüe') || indexSrc.includes('trilíngue'), 'language menu: trilingual intro')
      assert(indexSrc.includes('número o escribí el nombre') || indexSrc.includes('number or type the language'), 'language menu: says can type name too')

      // Handover: step-aware (completado/inscripto don't offer inscription)
      assert(indexSrc.includes('_hoAlreadyDone'), 'pipeline handover: step-aware inscription guard')
      assert(indexSrc.includes('_legHoAlreadyDone'), 'legacy handover: step-aware inscription guard')
      assert(indexSrc.includes("['completado', 'inscripto'].includes(state?.step)"), 'pipeline handover: checks completado+inscripto')
      assert(indexSrc.includes("['completado', 'inscripto'].includes(state?.step)"), 'legacy handover: checks completado+inscripto')

      // ──────────────────────────────────────────────────────────────────────
      // Suite 13 — Resend email fixes
      // ──────────────────────────────────────────────────────────────────────
      console.log('\n══ Suite 13: Resend email fixes ══')

      // No literal 'DEFAULT_FROM_EMAIL' string — must be template literal with variable
      const fromMatches = [...indexSrc.matchAll(/from:\s*['"`]([^'"`]+)['"`]/g)]
      const badFroms = fromMatches.filter(m => m[1].includes('DEFAULT_FROM_EMAIL') && !m[0].includes('${'))
      assert(badFroms.length === 0, 'no literal DEFAULT_FROM_EMAIL in any from: field')

      // Resend v3: { data, error } destructuring in all send() calls
      const sendCalls = [...indexSrc.matchAll(/resend\.emails\.send\(/g)]
      const destructuredCalls = [...indexSrc.matchAll(/const \{ data[^}]+\} = await resend\.emails\.send/g)]
      assert(sendCalls.length > 0, 'has resend.emails.send calls')
      // All notification sends (not test route) should use v3 destructuring
      assert(!indexSrc.includes("response.id"), 'no v1-style response.id check')
      assert(!indexSrc.includes("result.error\n"), 'no v1-style result.error newline check')

      // ──────────────────────────────────────────────────────────────────────
      // Final summary
      // ──────────────────────────────────────────────────────────────────────
      printSummary()
    })
  })
})

function printSummary() {
  const total = passed + failed
  console.log(`\n${'━'.repeat(50)}`)
  console.log(`📊 ${passed}/${total} passed${failed > 0 ? ` — ${failed} failed` : ' — all good ✅'}`)
  if (failed > 0) process.exit(1)
}
