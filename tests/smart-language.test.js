// Test Smart Language Detection v2

function detectLanguage(text) {
  if (!text || !text.trim()) return 'es'
  const lower = text.toLowerCase().trim()
  
  // Remove accents for comparison
  const norm = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  
  // PRIORITY 1: Very distinctive Portuguese patterns
  // These must be checked FIRST
  if (norm.includes('vocês') || norm.includes('preciso') || 
      norm.includes('onde ') || norm.endsWith('onde') ||
      norm.includes('vão') || norm.includes('quando') ||
      lower.includes('obrigado') || lower.includes('olá')) {
    // But reject if it has Spanish-specific patterns
    if (lower.includes('hola') || lower.includes('gracias') || 
        lower.includes('cómo') || lower.includes('qué ') || lower.includes('dónde')) {
      return 'es'  // Spanish wins when mixed
    }
    return 'pt'
  }
  
  // PRIORITY 2: Very distinctive English patterns  
  // These must be checked before Spanish
  if (lower.startsWith('hello') || lower.startsWith('hi ') || lower.startsWith('hey') ||
      lower.includes('thanks') || lower.includes('what ') || 
      lower.includes('how are') || lower.includes('when do') ||
      lower.includes('where ') || lower.includes('need ') ||
      lower.includes('want ') || lower.includes('strains') || 
      lower.includes('genetics')) {
    return 'en'
  }
  
  // PRIORITY 3: Distinctive Spanish patterns
  if (lower.includes('hola') || lower.includes('gracias') ||
      lower.includes('cómo') || lower.includes('qué ') || 
      lower.includes('dónde') || lower.includes('cuándo') ||
      lower.includes('genéticas') || lower.includes('cepas')) {
    return 'es'
  }
  
  // Check for accented characters that strongly suggest Spanish
  if (/[áéíóúñ]/i.test(lower)) return 'es'
  
  // Default fallback
  return 'es'
}

const tests = [
  // Spanish - 12 tests
  ['Hola', 'es'], ['Gracias', 'es'], ['Qué genéticas tienen?', 'es'], ['Cómo están?', 'es'],
  ['Cuándo abren?', 'es'], ['Dónde están?', 'es'], ['Necesito información', 'es'], ['Quiero afiliarme', 'es'],
  ['genéticas', 'es'], ['cepas', 'es'],
  ['ola', 'es'], ['gracias', 'es'],
  
  // English - 12 tests
  ['Hello', 'en'], ['Thanks', 'en'], ['What strains do you have?', 'en'], ['How are you?', 'en'],
  ['When do you open?', 'en'], ['Where are you located?', 'en'], ['I need information', 'en'], ['I want to join', 'en'],
  ['strains', 'en'], ['genetics', 'en'],
  ['helo', 'en'], ['thnks', 'en'],
  
  // Portuguese - 10 tests
  ['Olá', 'pt'], ['Obrigado', 'pt'], ['Quais genéticas vocês tâem?', 'pt'], ['Como vão?', 'pt'],
  ['Quando abrem?', 'pt'], ['Onde ficam?', 'pt'], ['Preciso de informação', 'pt'], ['Quero me afiliar', 'pt'],
  ['vocês', 'pt'], ['obrigado', 'pt'],
  
  // Edge - 3 tests
  ['', 'es'], ['12345', 'es'], ['🙂', 'es'],
]

let passed = 0, failed = 0
console.log('🔤 Smart Detection v2\n')

for (const [input, expected] of tests) {
  const result = detectLanguage(input)
  if (result === expected) {
    console.log(`  ✅ "${input}" → ${result}`)
    passed++
  } else {
    console.log(`  ❌ "${input}" → ${result} (expected ${expected})`)
    failed++
  }
}

console.log(`\n📊 ${passed}/${tests.length} passed (${Math.round(passed/tests.length*100)}%)`)
if (failed) console.log(`❌ ${failed} failed`)