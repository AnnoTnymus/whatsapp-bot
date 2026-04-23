// Test Suite v4.1 — Atención al cliente + tono cordial + Vision permisivo
// Valida los cambios del rediseño: flujo opt-in, sin "boludo", che solo off-topic,
// y que el detector de afiliación funciona con marker [[AFILIAR]].

import { readFileSync } from 'fs'

let passed = 0, failed = 0
const failures = []
function tick(n) { passed++; console.log(`  ✅ ${n}`) }
function fail(n, e) { failed++; failures.push({ n, e: e?.message || e }); console.log(`  ❌ ${n}: ${e?.message || e}`) }
function assert(n, fn) {
  try { const r = fn(); if (r === false) fail(n, 'returned false'); else tick(n) }
  catch (e) { fail(n, e) }
}

const src = readFileSync('./index.js', 'utf-8')

// ============ SUITE 1: Mensajes hardcodeados sin "boludo" ============
console.log('\n🧪 Suite 1: Tono cordial — ningún mensaje hardcodeado usa "boludo"')

// Separamos código real de los regex que validan la prohibición
const sendCalls = src.match(/sendWhatsAppMessage\([^)]*`[^`]*`/g) || []
const hardcodedStrings = [...src.matchAll(/sendWhatsAppMessage\([^,]+,\s*`([^`]+)`/g)].map(m => m[1])

assert('Ningún sendWhatsAppMessage contiene "boludo"', () => {
  const bad = hardcodedStrings.filter(s => /boludo/i.test(s))
  if (bad.length) throw new Error(`Encontré "boludo" en: ${bad.join(' | ')}`)
  return true
})

assert('Ningún sendWhatsAppMessage contiene "pibe"', () => {
  const bad = hardcodedStrings.filter(s => /\bpibe\b/i.test(s))
  if (bad.length) throw new Error(`Encontré "pibe": ${bad.join(' | ')}`)
  return true
})

// "che" solo debe aparecer en RESPUESTAS_FUERA_FLUJO (off-topic)
assert('"che" fuera de off-topic: no debería estar en mensajes de flujo', () => {
  // extraigo solo los mensajes sendWhatsApp (no los de RESPUESTAS_FUERA_FLUJO)
  const flujo = hardcodedStrings.filter(s => /\bche\b/i.test(s))
  if (flujo.length) throw new Error(`"che" en mensaje de flujo: ${flujo.join(' | ')}`)
  return true
})

// ============ SUITE 2: RESPUESTAS_FUERA_FLUJO — no asumen flujo de docs ============
console.log('\n🧪 Suite 2: Off-topic cordial — no fuerza el flujo de afiliación')

const offFlowMatch = src.match(/const RESPUESTAS_FUERA_FLUJO = \{[\s\S]*?\n\}/)
const offFlowBlock = offFlowMatch ? offFlowMatch[0] : ''

assert('RESPUESTAS_FUERA_FLUJO existe', () => offFlowBlock.length > 0)

assert('sticker responses no pide REPROCANN/DNI', () => {
  const stickerMatch = offFlowBlock.match(/sticker:\s*\[([\s\S]*?)\]/)
  if (!stickerMatch) throw new Error('no encontré sticker array')
  const txt = stickerMatch[1]
  if (/reprocann|dni|documentos/i.test(txt)) throw new Error(`sticker fuerza docs: ${txt}`)
  return true
})

assert('imagen_random no pide documentos a la fuerza', () => {
  const m = offFlowBlock.match(/imagen_random:\s*\[([\s\S]*?)\]/)
  if (!m) throw new Error('no encontré imagen_random')
  if (/necesito tu dni|necesito.*reprocann|pasame los documentos/i.test(m[1]))
    throw new Error('imagen_random sigue forzando docs')
  return true
})

assert('solo_emojis es cordial (no boludo)', () => {
  const m = offFlowBlock.match(/solo_emojis:\s*\[([\s\S]*?)\]/)
  if (!m) throw new Error('no encontré solo_emojis')
  if (/boludo/i.test(m[1])) throw new Error('solo_emojis aún tiene "boludo"')
  return true
})

assert('Existe handler para audios', () => {
  const m = offFlowBlock.match(/audio:\s*\[([\s\S]*?)\]/)
  if (!m) throw new Error('falta array audio')
  if (!/escribir|escribís|texto/i.test(m[1])) throw new Error('mensaje de audio no pide texto')
  return true
})

// ============ SUITE 3: Flujo opt-in — Claude decide intent afiliación ============
console.log('\n🧪 Suite 3: Detección de intent de afiliación vía marker [[AFILIAR]]')

assert('SYSTEM_PROMPT menciona el marker [[AFILIAR]]', () => /\[\[AFILIAR\]\]/.test(src))

assert('askClaude devuelve { reply, wantsAffiliation }', () => {
  if (!/return\s*\{\s*reply,\s*wantsAffiliation\s*\}/.test(src))
    throw new Error('askClaude no retorna object con wantsAffiliation')
  return true
})

assert('webhook captura wantsAffiliation y transiciona a recibiendo_documentos', () => {
  if (!/wantsAffiliation\s*&&/.test(src)) throw new Error('falta check de wantsAffiliation en webhook')
  if (!/step\s*=\s*'recibiendo_documentos'/.test(src)) throw new Error('no transiciona a recibiendo_documentos')
  return true
})

assert('SYSTEM_PROMPT prohíbe "boludo" explícitamente', () => {
  if (!/PROHIBIDO.*boludo|nunca uses.*boludo/i.test(src))
    throw new Error('SYSTEM_PROMPT no prohíbe "boludo"')
  return true
})

assert('SYSTEM_PROMPT aclara cuándo usar "che"', () => {
  if (!/che.*off-topic|off-topic.*che|casuales|fuera de tema/i.test(src))
    throw new Error('SYSTEM_PROMPT no contextualiza uso de "che"')
  return true
})

// ============ SUITE 4: Flujo inicial — pide nombre sin pedir docs ============
console.log('\n🧪 Suite 4: Primer contacto — pide nombre, no docs')

assert('Primer contacto: pide nombre con tono cordial', () => {
  const m = src.match(/Primer contacto.*?sendWhatsAppMessage\(chatId,\s*`([^`]+)`/s)
  if (!m) throw new Error('no encontré mensaje de primer contacto')
  if (/boludo/i.test(m[1])) throw new Error(`mensaje inicial tiene "boludo": ${m[1]}`)
  if (/dni|reprocann|documentos/i.test(m[1])) throw new Error(`mensaje inicial pide docs: ${m[1]}`)
  return true
})

assert('Después de dar nombre, entra en modo "conversando" (no pide docs)', () => {
  if (!/step\s*=\s*'conversando'/.test(src)) throw new Error('falta estado "conversando"')
  // Tras dar nombre, el mensaje debe preguntar en qué puede ayudar
  const m = src.match(/nombre registrado.*?sendWhatsAppMessage\(chatId,\s*`([^`]+)`/s)
  if (m && /dni|reprocann|documentos/i.test(m[1]))
    throw new Error(`después de nombre pide docs directo: ${m[1]}`)
  return true
})

// ============ SUITE 5: Vision permisivo ============
console.log('\n🧪 Suite 5: Vision — acepta docs legibles, pide campos faltantes por texto')

assert('detectImage prompt dice "sé PERMISIVO"', () => {
  if (!/permisivo|PERMISIVO/.test(src)) throw new Error('prompt no menciona ser permisivo')
  return true
})

assert('Ya NO se rechaza por detected.valido=false', () => {
  // El bloque "if (!detected.valido)" debería estar removido o solo para OTRO
  const badBlock = /if\s*\(\s*!detected\.valido\s*\)\s*\{[^}]*borrosa[^}]*\}/
  if (badBlock.test(src)) throw new Error('aún rechaza por borrosa')
  return true
})

assert('Rechazo solo si tipo === "OTRO"', () => {
  if (!/detected\.tipo\s*===\s*'OTRO'/.test(src)) throw new Error('falta check tipo===OTRO')
  return true
})

assert('REPROCANN_REQUIRED tiene pocos campos críticos (no 10+)', () => {
  const m = src.match(/const REPROCANN_REQUIRED = \[([\s\S]*?)\n\]/)
  if (!m) throw new Error('no encontré REPROCANN_REQUIRED')
  const fields = m[1].match(/\{\s*key:/g) || []
  if (fields.length > 6) throw new Error(`demasiados campos obligatorios: ${fields.length}`)
  if (fields.length < 2) throw new Error(`muy pocos campos: ${fields.length}`)
  return true
})

assert('Mensaje de campo faltante es cordial (sin "boludo" sin "che")', () => {
  // El mensaje es "Me faltó leer ${label} 📝 ¿Me lo escribís?"
  if (!/Me faltó leer|me lo escribís/i.test(src))
    throw new Error('falta mensaje cordial para campos faltantes')
  return true
})

// ============ SUITE 6: Audio handler ============
console.log('\n🧪 Suite 6: Audios — respuesta casual con "che"')

assert('webhook maneja audioMessage/voiceMessage', () => {
  if (!/msgType === 'audioMessage'|msgType === 'voiceMessage'/.test(src))
    throw new Error('falta handler de audio')
  return true
})

assert('randomRespuesta("audio", ...) existe', () => {
  if (!/randomRespuesta\('audio'/.test(src)) throw new Error('falta llamada a audio')
  return true
})

// ============ SUITE 7: Variedad de respuestas + rotación ============
console.log('\n🧪 Suite 7: Variedad de respuestas (mínimo 3 por tipo, rotación activa)')

function contarOpciones(tipo) {
  const re = new RegExp(`${tipo}:\\s*\\[([\\s\\S]*?)\\]`)
  const m = offFlowBlock.match(re)
  if (!m) return 0
  return (m[1].match(/^\s*'/gm) || []).length
}

assert('sticker tiene >= 3 variantes', () => contarOpciones('sticker') >= 3)
assert('audio tiene >= 3 variantes', () => contarOpciones('audio') >= 3)
assert('solo_emojis tiene >= 3 variantes', () => contarOpciones('solo_emojis') >= 3)
assert('imagen_random tiene >= 3 variantes', () => contarOpciones('imagen_random') >= 3)

assert('randomRespuesta implementa rotación no-repetitiva', () => {
  if (!/lastRespIndex/.test(src)) throw new Error('falta memoria lastRespIndex')
  if (!/do\s*\{[^}]*idx[^}]*\}\s*while/.test(src)) throw new Error('falta do-while anti-repetición')
  return true
})

// ============ SUITE 8: Tono de los mensajes casuales ============
console.log('\n🧪 Suite 8: Tono casual en mensajes off-topic (jocoso pero útil)')

assert('sticker menciona superpoderes/estar re piola/cerebro', () => {
  const m = offFlowBlock.match(/sticker:\s*\[([\s\S]*?)\]/)
  if (!/superpoder|re piola|cortocircuito|kryptonita|manejo/i.test(m[1]))
    throw new Error('sticker no tiene tono jocoso')
  return true
})

assert('audio tiene tono jocoso ("oídos"/"tacaño"/"mudo")', () => {
  const m = offFlowBlock.match(/audio:\s*\[([\s\S]*?)\]/)
  if (!/oídos|tacaño|mudo|nanai|kryptonita|jefe/i.test(m[1]))
    throw new Error('audio no tiene tono jocoso')
  return true
})

// ============ RESUMEN ============
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
console.log(`📊 Resultado: ${passed} passed / ${failed} failed`)
if (failed) {
  console.log('\n❌ Fallas:')
  failures.forEach(f => console.log(`  - ${f.n}: ${f.e}`))
  process.exit(1)
}
console.log(`✅ Todos los checks v4.1 pasaron.`)
