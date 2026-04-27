// Comprehensive Language Detection Test Suite v5
// Uses the ACTUAL detectLanguage from index.js via direct copy

function detectLanguage(text) {
  if (!text || !text.trim()) return 'es'
  const lower = text.toLowerCase()
  
  // === PRIORITY 1: Portuguese "ola" vs Spanish "hola" ===
  // Check standalone "ola" specifically (Portuguese) before Spanish catches "hola"
  if (lower === 'ola' || lower === 'ola!' || lower === 'olaa' || lower.startsWith('ola ')) {
    return 'pt'
  }
  
  // === PRIORITY 2: Mixed greetings - "hey hola" is Spanish ===
  if (lower.includes('hey hola') || lower.includes('hey ola') || 
      (lower.startsWith('hey') && lower.includes('hola'))) {
    return 'es'
  }
  
  // === PRIORITY 3: Very distinctive patterns (unique to each language) ===
  
  // English - MUST check FIRST (includes common words that overlap with ES/PT)
  if (/^(good\s|morning|afternoon|evening|night|day|hey|hello|hi|thanks|thank|what|where|when|how|need|want|have|there|can|could|would|should|please|great|okay|alright|appreciated)/i.test(lower) ||
      /\b(good\s|morning|afternoon|evening|night|day|thanks|thx|please)\b/i.test(lower) ||
      lower.includes('hello') || lower.includes('thank ') || lower.includes('thx') ||
      lower.includes('what ') || lower.includes('where ') || lower.includes('when ') ||
      lower.includes('strains') || lower.includes('genetics') || lower.includes('menu') ||
      lower.includes('how are') || lower.includes('can i') || lower.includes('do you') ||
      lower.includes(' i ') || lower.startsWith('i ') || lower.startsWith("i'") ||
      lower.includes(' watsup') || lower.includes('watsup') ||
      lower.includes('pls') || lower.includes('plz') ||
      lower.includes('appreciated') || lower.includes('awesome')) {
    return 'en'
  }
  
  // Portuguese - very distinctive patterns
  if (/^(oi|olá|bom|boa|td bem|valeu)/i.test(lower) ||
      lower.includes('obrigado') || lower.includes('obrigada') || 
      lower.includes('vocês') || lower.includes('preciso') || 
      lower.includes('vão') || lower.includes('quanto') || 
      lower.includes('onde ') || lower.includes('quando') ||
      lower.includes('posso') || lower.includes('voces tem')) {
    return 'pt'
  }
  
  // Spanish - fallback (most common)
  if (lower.includes('hola') || lower.includes('gracias') ||
      lower.includes('cómo') || lower.includes('qué ') || lower.includes('dónde') || 
      lower.includes('cuándo') || lower.includes('genéticas') || 
      lower.includes('cepas') || lower.includes('afiliar') ||
      lower.includes('quiero') || lower.includes('necesito') ||
      lower.includes('geneticas ')) {
    return 'es'
  }
  
  // Check for Spanish accent characters (very strong signal)
  if (/[áéíóúñ]/i.test(lower)) return 'es'
  
  // Default
  return 'es'
}

// Test cases - 100+
const testCases = [
  // === ESPAÑOL - SALUDOS ===
  {input: 'Hola', expected: 'es'}, {input: 'Hola!', expected: 'es'}, 
  {input: 'Buenos días', expected: 'es'}, {input: 'Buenas', expected: 'es'},
  {input: 'Hey hola', expected: 'es'}, {input: 'Holaaa', expected: 'es'},
  {input: 'hola', expected: 'es'}, {input: 'Buenas', expected: 'es'},
  {input: 'buenos noches', expected: 'es'}, {input: 'Que tal?', expected: 'es'},
  
  // === ESPAÑOL - AGRADECIMIENTOS ===
  {input: 'Gracias', expected: 'es'}, {input: 'Muchas gracias', expected: 'es'},
  {input: 'Gracias totales!', expected: 'es'}, {input: 'gracias por todo', expected: 'es'},
  {input: 'Mil gracias!', expected: 'es'},
  
  // === ESPAÑOL - PREGUNTAS ===
  {input: 'Cómo están?', expected: 'es'}, {input: 'Qué genéticas tienen?', expected: 'es'},
  {input: 'Cuándo abren?', expected: 'es'}, {input: 'Dónde están?', expected: 'es'},
  {input: 'Cuál es el precio?', expected: 'es'}, {input: 'Tienen delivery?', expected: 'es'},
  {input: 'Cuánto cuesta?', expected: 'es'}, {input: 'Puedo afiliarme?', expected: 'es'},
  {input: 'Qué documentos necesito?', expected: 'es'}, {input: 'Me pasan el menú?', expected: 'es'},
  
  // === ESPAÑOL - ERRORES/TYPOS ===
  {input: 'ola', expected: 'es'}, {input: 'gracias', expected: 'es'},
  {input: 'Que geneticas tienen', expected: 'es'}, {input: 'como estas', expected: 'es'},
  {input: 'necesito info', expected: 'es'}, {input: 'quiero afiliarme', expected: 'es'},
  {input: 'hay cepas?', expected: 'es'}, {input: 'dame data', expected: 'es'},
  
  // === INGLÉS - SALUDOS ===
  {input: 'Hello', expected: 'en'}, {input: 'Hi there', expected: 'en'},
  {input: 'Hey', expected: 'en'}, {input: 'Good morning', expected: 'en'},
  {input: 'Good afternoon', expected: 'en'}, {input: 'Good evening', expected: 'en'},
  {input: 'hi', expected: 'en'}, {input: 'Good day!', expected: 'en'},
  
  // === INGLÉS - AGRADECIMIENTOS ===
  {input: 'Thanks', expected: 'en'}, {input: 'Thank you', expected: 'en'},
  {input: 'Thx!', expected: 'en'}, {input: 'Much appreciated!', expected: 'en'},
  {input: 'Thanks a lot!', expected: 'en'},
  
  // === INGLÉS - PREGUNTAS ===
  {input: 'What strains do you have?', expected: 'en'}, {input: 'How are you?', expected: 'en'},
  {input: 'When do you open?', expected: 'en'}, {input: 'Where are you located?', expected: 'en'},
  {input: 'How much is it?', expected: 'en'}, {input: 'Can I join?', expected: 'en'},
  {input: 'What are your hours?', expected: 'en'}, {input: 'Do you deliver?', expected: 'en'},
  {input: 'I need info', expected: 'en'}, {input: 'I want to join', expected: 'en'},
  {input: 'What genetics available?', expected: 'en'}, {input: 'Can you help me?', expected: 'en'},
  
  // === INGLÉS - ERRORES ===
  {input: 'Thx', expected: 'en'}, {input: 'watsup', expected: 'en'},
  {input: 'i need sum help', expected: 'en'}, {input: 'wat strains', expected: 'en'},
  {input: 'hlp me pls', expected: 'en'},
  
  // === PORTUGUÉS - SALUDOS ===
  {input: 'Olá', expected: 'pt'}, {input: 'Olá tudo bem?', expected: 'pt'},
  {input: 'Oi', expected: 'pt'}, {input: 'Bom dia', expected: 'pt'},
  {input: 'Boa tarde', expected: 'pt'}, {input: 'Boa noite', expected: 'pt'},
  
  // === PORTUGUÉS - AGRADECIMIENTOS ===
  {input: 'Obrigado', expected: 'pt'}, {input: 'Muito obrigado!', expected: 'pt'},
  {input: 'Obrigada', expected: 'pt'}, {input: 'Valeu!', expected: 'pt'},
  
  // === PORTUGUÉS - PREGUNTAS ===
  {input: 'Quais genéticas vocês tâem?', expected: 'pt'}, {input: 'Como vão?', expected: 'pt'},
  {input: 'Quando abrem?', expected: 'pt'}, {input: 'Onde ficam?', expected: 'pt'},
  {input: 'Quanto custa?', expected: 'pt'}, {input: 'Posso me afiliar?', expected: 'pt'},
  {input: 'Preciso de informação', expected: 'pt'}, {input: 'Vocês entregam?', expected: 'pt'},
  
  // === PORTUGUÉS - ERRORES ===
  {input: 'ola', expected: 'pt'}, {input: 'obrigado', expected: 'pt'},
  {input: 'preciso info', expected: 'pt'}, {input: 'geneticas voces tem', expected: 'pt'},
  
  // === EDGE CASES ===
  {input: '', expected: 'es'}, {input: '12345', expected: 'es'},
  {input: '🙂', expected: 'es'}, {input: '!!!', expected: 'es'},
  {input: '...', expected: 'es'}, {input: '   ', expected: 'es'},
  {input: 'ok', expected: 'es'}, {input: 'sim', expected: 'es'},
]

// Run
console.log('╔══════════════════════════════════════════════════════════════╗')
console.log('║       LANGUAGE DETECTION - COMPREHENSIVE TEST v4           ║')
console.log('╚══════════════════════════════════════════════════════════════╝\n')

let passed = 0, failed = 0
const failures = []

for (const tc of testCases) {
  const result = detectLanguage(tc.input)
  if (result === tc.expected) {
    passed++
  } else {
    failed++
    failures.push({input: tc.input, got: result, expected: tc.expected})
  }
}

const pct = Math.round((passed/testCases.length)*100)
console.log(`📈 Results: ${passed}/${testCases.length} (${pct}%)`)
console.log(`Grade: ${pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : 'D'}`)
if (failures.length > 0) {
  console.log('\n❌ Failed:')
  failures.forEach(f => console.log(`   "${f.input}" → ${f.got} (expected ${f.expected})`))
}