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

function simulateLanguageAssignment(state, message) {
  const detectedLang = detectLanguage(message)
  if (!state.language) state.language = detectedLang
  return state.language
}

const stateNoLang = { language: null }
const stateEsLang = { language: 'es' }
const stateEnLang = { language: 'en' }

assert(simulateLanguageAssignment({ language: null }, 'hello') === 'en',    'no lang + english msg → en')
assert(simulateLanguageAssignment({ language: null }, 'hola') === 'es',     'no lang + spanish msg → es')
assert(simulateLanguageAssignment({ language: 'es' }, 'hello') === 'es',   'es set + english msg → stays es')
assert(simulateLanguageAssignment({ language: 'en' }, 'hola') === 'en',    'en set + spanish msg → stays en')
assert(simulateLanguageAssignment({ language: 'en' }, 'obrigado') === 'en','en set + portuguese msg → stays en')

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
      assert(indexSrc.includes("if (!state.language)"), 'language set only on first contact')
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
