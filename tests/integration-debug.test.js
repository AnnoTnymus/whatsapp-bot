// Integration Tests for Production Bugs
// Tests los problemas encontrados en producción

const TEST_CHAT_ID = '5491161749233@c.us'

// Test 1: Rate limit demasiado bajo
console.log('=== TEST 1: RATE LIMIT ===')
console.log('Current RATE_LIMIT:', 30, 'msg/hour')
console.log('Problem: User sends 3 messages and gets blocked')
console.log('Fix needed: Increase to 100+ or add admin bypass')

// Test 2: Language selection flow
console.log('\n=== TEST 2: LANGUAGE SELECTION FLOW ===')

function detectLanguage(text) {
  if (!text || !text.trim()) return 'es'
  const lower = text.toLowerCase()
  
  // Portuguese "ola" vs Spanish "hola"
  if (lower === 'ola' || lower === 'ola!' || lower === 'olaa' || lower.startsWith('ola ')) {
    return 'pt'
  }
  
  // English
  if (/^(good\s|morning|afternoon|evening|night|day|hey|hello|hi|thanks|thank|what|where|when|how|need|want|have|there|can|could|would|should|please|great|okay|alright|appreciated)/i.test(lower) ||
      lower.includes('hello') || lower.includes('thank ') || lower.includes('thx') ||
      lower.includes(' i ') || lower.startsWith('i ') || lower.startsWith("i'") ||
      lower.includes('appreciated') || lower.includes('awesome')) {
    return 'en'
  }
  
  // Portuguese
  if (/^(oi|olá|bom|boa|td bem|valeu)/i.test(lower) ||
      lower.includes('obrigado') || lower.includes('obrigada') || 
      lower.includes('vocês') || lower.includes('preciso') || 
      lower.includes('vão') || lower.includes('quanto') || 
      lower.includes('onde ') || lower.contains('quando') ||
      lower.includes('posso') || lower.includes('voces tem')) {
    return 'pt'
  }
  
  // Spanish
  if (lower.includes('hola') || lower.includes('gracias') ||
      lower.includes('cómo') || lower.includes('qué ') || lower.includes('dónde') || 
      lower.includes('cuándo') || lower.includes('genéticas') || 
      lower.includes('cepas') || lower.includes('afiliar') ||
      lower.includes('quiero') || lower.includes('necesito') ||
      lower.includes('geneticas ')) {
    return 'es'
  }
  
  if (/[áéíóúñ]/i.test(lower)) return 'es'
  
  return 'es'
}

const msgs = [
  'ey whatsap upp?',
  'Hola como va?',
  'Oii tudo bem?',
  'Hi how are you?',
  'thanks',
]

console.log('Language detection:')
for (const m of msgs) {
  console.log(`  "${m}" → ${detectLanguage(m)}`)
}

// Test 3: isUncertain logic
console.log('\n=== TEST 3: UNCERTAIN DETECTION ===')

const uncertainPatterns = [/^I .+$/i, /^i .+$/i, /^ola$/i, /^ola !$/i, /^geneticas/i]

function isUncertainMsg(msg, currentLang, detectedLang, step) {
  if (step === 'seleccionando_idioma') return false
  
  // Some patterns are always uncertain
  if (uncertainPatterns.some(p => p.test(msg))) return true
  
  // If language changed and not first message
  if (currentLang && detectedLang !== currentLang) return true
  
  return false
}

const testCases = [
  { msg: 'Oii tudo bem?', current: 'es', detected: 'pt', step: 'conversando', expected: true },
  { msg: 'Hi how are you?', current: 'es', detected: 'en', step: 'conversando', expected: true },
  { msg: 'Gracias', current: 'es', detected: 'es', step: 'conversando', expected: false },
  { msg: 'Hola', current: null, detected: 'es', step: 'inicio', expected: false },
]

console.log('Testing isUncertain:')
for (const tc of testCases) {
  const result = isUncertainMsg(tc.msg, tc.current, tc.detected, tc.step)
  const status = result === tc.expected ? '✅' : '❌'
  console.log(`  ${status} "${tc.msg}" (${tc.current}→${tc.detected}) = ${result} (expected: ${tc.expected})`)
}

// Test 4: Rate limit message should be multilingual
console.log('\n=== TEST 4: RATE LIMIT MESSAGE ===')
console.log('Current: "Recibimos muchos mensajes de este número"')
console.log('Problem: Only in Spanish, user speaks Portuguese')
console.log('Fix: Should respond in user language with fallback')

// Test 5: Language change request (only explicit)
console.log('\n=== TEST 5: EXPLICIT LANGUAGE CHANGE ===')
const wantsToChangeLang = /(cambiar.*idioma|cambiar.*lenguaje|english|español|português|portugues|cambiar a español|cambiar a inglés|quiero en inglés|quiero en español)/i

const langChangeTests = [
  'quiero cambiar a inglés',
  'cambiar idioma',
  'I want to switch to English',
  'ola tudo bem?',
  'Hola como va?',
]

console.log('Should trigger language selection:')
for (const m of langChangeTests) {
  const result = wantsToChangeLang.test(m)
  console.log(`  "${m}" → ${result}`)
}

console.log('\n=== SUMMARY OF FIXES NEEDED ===')
console.log(`
1. RATE_LIMIT: Increase from 30 to 100+ per hour
2. isUncertain: Remove automatic triggering, only explicit
3. Rate limit message: Make it multilingual
4. Language selection: Only ask if user explicitly requests
5. State persistence: Check if state.language is being saved correctly

PROBLEMS FOUND:
- "Oii tudo bem?" → detected as Portuguese
- isUncertain = true because 'ola' pattern matches
- Bot asks language selection
- User continues typing, gets rate limited
- Fallback message appears (wrong language)
`)

process.exit(0)