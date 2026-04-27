// Language Detection Tests - Indajaus Bot
import 'dotenv/config.js'

const SUPPORTED_LANGUAGES = ['es', 'en', 'pt']

function detectLanguage(text) {
  if (!text) return 'es'
  const lower = text.toLowerCase()
  
  const esWords = ['hola', 'gracias', 'quiero', 'necesito', 'cuándo', 'cuál', 'dónde', 'cómo', 'cuánto', 'qué', 'estás', 'tenés', 'estás', 'tengo', 'tienes', 'sos', 'soy', 'genéticas', 'cepas', 'ayuda']
  const esCount = esWords.filter(w => lower.includes(w)).length
  
  const enWords = ['hello', 'hi', 'hey', 'thanks', 'want', 'need', 'when', 'what', 'where', 'how', 'much', 'are', 'have', 'strains', 'genetics', 'menu', 'info', 'good', 'great', 'okay']
  const enCount = enWords.filter(w => lower.includes(w)).length
  
  const ptWords = ['olá', 'obrigado', 'quero', 'preciso', 'quando', 'qual', 'onde', 'genéticas', 'cepas', 'ajuda', 'vocês', 'vão']
  const ptCount = ptWords.filter(w => lower.includes(w)).length
  
  if (esCount >= enCount && esCount >= ptCount) return 'es'
  if (ptCount > esCount && ptCount > enCount) return 'pt'
  if (enCount > esCount && enCount > ptCount) return 'en'
  return 'es'
}

let passed = 0, failed = 0

function test(name, fn) {
  try {
    const result = fn()
    if (result) {
      console.log(`  ✅ ${name}`)
      passed++
    } else {
      console.log(`  ❌ ${name}: assertion failed`)
      failed++
    }
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`)
    failed++
  }
}

console.log('\n🔤 Test Suite: Language Detection')

console.log('\n📗 Spanish Tests')
test('Spanish: Hola', () => detectLanguage('Hola') === 'es')
test('Spanish: Gracias', () => detectLanguage('Gracias') === 'es')
test('Spanish: Qué genéticas tienen?', () => detectLanguage('Qué genéticas tienen?') === 'es')
test('Spanish: Cómo están?', () => detectLanguage('Cómo están?') === 'es')
test('Spanish: Cuándo abren?', () => detectLanguage('Cuándo abren?') === 'es')
test('Spanish: Dónde están?', () => detectLanguage('Dónde están?') === 'es')
test('Spanish: Necesito información', () => detectLanguage('Necesito información') === 'es')
test('Spanish:Quiero afiliarme', () => detectLanguage('Quiero afiliarme') === 'es')
test('Spanish: Gracias por todo', () => detectLanguage('Gracias por todo') === 'es')

console.log('\n📘 English Tests')
test('English: Hello', () => detectLanguage('Hello') === 'en')
test('English: Thanks', () => detectLanguage('Thanks') === 'en')
test('English: What strains do you have?', () => detectLanguage('What strains do you have?') === 'en')
test('English: How are you?', () => detectLanguage('How are you?') === 'en')
test('English: When do you open?', () => detectLanguage('When do you open?') === 'en')
test('English: Where are you located?', () => detectLanguage('Where are you located?') === 'en')
test('English: I need information', () => detectLanguage('I need information') === 'en')
test('English: I want to join', () => detectLanguage('I want to join') === 'en')
test('English: Great, thank you', () => detectLanguage('Great, thank you') === 'en')
test('English: Hey how is it going?', () => detectLanguage('Hey how is it going?') === 'en')

console.log('\n📙 Portuguese Tests')
test('Portuguese: Olá', () => detectLanguage('Olá') === 'pt')
test('Portuguese: Obrigado', () => detectLanguage('Obrigado') === 'pt')
test('Portuguese: Quais genéticas têm?', () => detectLanguage('Quais genéticas têm?') === 'pt')
test('Portuguese: Como vão?', () => detectLanguage('Como vão?') === 'pt')
test('Portuguese: Quando abrem?', () => detectLanguage('Quando abrem?') === 'pt')
test('Portuguese: Onde ficam?', () => detectLanguage('Onde ficam?') === 'pt')
test('Portuguese: Preciso de informação', () => detectLanguage('Preciso de informação') === 'pt')
test('Portuguese: Quero me afiliar', () => detectLanguage('Quero me afiliar') === 'pt')

console.log('\n🔞 Edge Cases')
test('Empty string → default', () => detectLanguage('') === 'es')
test('Null → default', () => detectLanguage(null) === 'es')
test('Numbers only → default', () => detectLanguage('12345') === 'es')
test('Emojis only → default', () => detectLanguage('🙂') === 'es')

console.log('\n📊 Results')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)

if (failed > 0) {
  console.log('\n⚠️ Some tests failed!')
  process.exit(1)
} else {
  console.log('\n✅ All language detection tests passed!')
  process.exit(0)
}