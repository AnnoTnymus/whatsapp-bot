// Language Selection Flow Tests v2
// Tests parseLanguageSelection - accepts any variation with typos

// Helper to parse language selection from user response
// Accepts: 1, 2, 3 or any variation of Spanish/English/Portuguese with typos
function parseLanguageSelection(text) {
  if (!text) return null
  const lower = text.toLowerCase().trim()
  
  // Number selection
  if (lower === '1') return 'es'
  if (lower === '2') return 'en'
  if (lower === '3') return 'pt'
  
  // Spanish - starts with "es" or contains "span"/"esp"/"españ"
  if (/^es|span|esp|españ/.test(lower)) return 'es'
  
  // English - starts with "en" or contains "ing"/"engl"
  if (/^en|ing|engl/.test(lower)) return 'en'
  
  // Portuguese - starts with "port"
  if (/^port|portug/.test(lower)) return 'pt'
  
  return null
}

function getLanguageConfirmation(lang) {
  const msgs = {
    es: '✅ Perfecto, ahora chateamos en español.',
    en: '✅ Perfect, we will chat in English.',
    pt: '✅ Perfeito, agora vamos conversar em português.'
  }
  return msgs[lang] || msgs.es
}

// === TEST CASES ===
const testCases = [
  // Numbers
  { fn: 'parseLanguageSelection', input: '1', expected: 'es', desc: '1 → Spanish' },
  { fn: 'parseLanguageSelection', input: '2', expected: 'en', desc: '2 → English' },
  { fn: 'parseLanguageSelection', input: '3', expected: 'pt', desc: '3 → Portuguese' },
  
  // Spanish variations
  { fn: 'parseLanguageSelection', input: 'español', expected: 'es', desc: 'español → Spanish' },
  { fn: 'parseLanguageSelection', input: 'espanol', expected: 'es', desc: 'espanol → Spanish' },
  { fn: 'parseLanguageSelection', input: 'ESPANIOL', expected: 'es', desc: 'ESPANIOL → Spanish' },
  { fn: 'parseLanguageSelection', input: 'esañol', expected: 'es', desc: 'esañol (typo) → Spanish' },
  { fn: 'parseLanguageSelection', input: 'esp', expected: 'es', desc: 'esp → Spanish (partial)' },
  
  // English variations
  { fn: 'parseLanguageSelection', input: 'english', expected: 'en', desc: 'english → English' },
  { fn: 'parseLanguageSelection', input: 'ingles', expected: 'en', desc: 'ingles → English' },
  { fn: 'parseLanguageSelection', input: 'INGLES', expected: 'en', desc: 'INGLES → English' },
  { fn: 'parseLanguageSelection', input: 'engles', expected: 'en', desc: 'engles (typo) → English' },
  { fn: 'parseLanguageSelection', input: 'ingl', expected: 'en', desc: 'ingl → English (partial)' },
  
  // Portuguese variations
  { fn: 'parseLanguageSelection', input: 'português', expected: 'pt', desc: 'português → Portuguese' },
  { fn: 'parseLanguageSelection', input: 'portugues', expected: 'pt', desc: 'portugues → Portuguese' },
  { fn: 'parseLanguageSelection', input: 'PORTUGUES', expected: 'pt', desc: 'PORTUGUES → Portuguese' },
  { fn: 'parseLanguageSelection', input: 'portugues', expected: 'pt', desc: 'portugues (typo) → Portuguese' },
  { fn: 'parseLanguageSelection', input: 'port', expected: 'pt', desc: 'port → Portuguese (partial)' },
  
  // Invalid - should not match
  { fn: 'parseLanguageSelection', input: 'francés', expected: null, desc: 'francés → null (not a support lang)' },
  { fn: 'parseLanguageSelection', input: 'hola', expected: null, desc: 'hola → null (random word)' },
  { fn: 'parseLanguageSelection', input: '', expected: null, desc: 'empty → null' },
  
  // Confirmations
  { fn: 'getLanguageConfirmation', input: 'es', expected: '✅ Perfecto, ahora chateamos en español.', desc: 'Spanish confirmation' },
  { fn: 'getLanguageConfirmation', input: 'en', expected: '✅ Perfect, we will chat in English.', desc: 'English confirmation' },
  { fn: 'getLanguageConfirmation', input: 'pt', expected: '✅ Perfeito, agora vamos conversar em português.', desc: 'Portuguese confirmation' },
  { fn: 'getLanguageConfirmation', input: 'invalid', expected: '✅ Perfecto, ahora chateamos en español.', desc: 'Fallback to Spanish' },
]

console.log('╔══════════════════════════════════════════════╗')
console.log('║       LANGUAGE SELECTION TESTS v1          ║')
console.log('╚══════════════════════════════════════════════╝')

let passed = 0, failed = 0
const failures = []

for (const tc of testCases) {
  const fn = tc.fn === 'parseLanguageSelection' ? parseLanguageSelection : getLanguageConfirmation
  const result = fn(tc.input)
  const ok = result === tc.expected
  if (ok) {
    passed++
    console.log(`✅ ${tc.desc}`)
  } else {
    failed++
    failures.push(tc.desc)
    console.log(`❌ ${tc.desc}`)
    console.log(`   Input: "${tc.input}"`)
    console.log(`   Expected: "${tc.expected}"`)
    console.log(`   Got: "${result}"`)
  }
}

console.log('')
console.log(`📈 Results: ${passed}/${testCases.length} (${Math.round(passed/testCases.length*100)}%)`)
console.log(`Grade: ${failed === 0 ? 'A' : failed <= 2 ? 'B' : 'C'}`)

if (failed > 0) {
  console.log('')
  console.log('❌ Failed:')
  failures.forEach(f => console.log(`   - ${f}`))
  process.exit(1)
}

process.exit(0)