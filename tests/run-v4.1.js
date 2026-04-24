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

assert('askClaude devuelve { reply, wantsAffiliation, ... }', () => {
  if (!/return\s*\{\s*reply,\s*wantsAffiliation/.test(src))
    throw new Error('askClaude no retorna object con reply y wantsAffiliation')
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

// ============ SUITE 9: Skills (v4.2) — legal_faq, reprocann_guide, genetics_expert ============
console.log('\n🧪 Suite 9: Skills integration (v4.2)')

const skillsSrc = readFileSync('./skills.js', 'utf-8')

assert('skills.js exporta SKILL_NAMES con los 3 nombres correctos', () => {
  if (!/SKILL_NAMES\s*=\s*\[\s*'legal_faq'\s*,\s*'reprocann_guide'\s*,\s*'genetics_expert'/.test(skillsSrc))
    throw new Error('SKILL_NAMES no contiene los 3 skills esperados')
  return true
})

assert('skills.js exporta invokeSkill y parseSkillMarker', () => {
  if (!/export (async )?function invokeSkill/.test(skillsSrc)) throw new Error('falta invokeSkill')
  if (!/export function parseSkillMarker/.test(skillsSrc)) throw new Error('falta parseSkillMarker')
  return true
})

assert('SKILL_PROMPTS tiene las 3 skills con contenido sustancial', () => {
  for (const s of ['legal_faq', 'reprocann_guide', 'genetics_expert']) {
    const re = new RegExp(`${s}:\\s*\``)
    if (!re.test(skillsSrc)) throw new Error(`falta prompt para ${s}`)
  }
  // Cada prompt debería tener > 500 chars
  const prompts = skillsSrc.match(/`[^`]{500,}`/g) || []
  if (prompts.length < 3) throw new Error(`prompts muy cortos: ${prompts.length}`)
  return true
})

assert('parseSkillMarker detecta [[SKILL:nombre]] correctamente', () => {
  if (!/\\\[\\\[SKILL:\(\\w\+\)\\\]\\\]/.test(skillsSrc))
    throw new Error('regex de parseSkillMarker no está bien')
  return true
})

assert('index.js importa skills.js', () => {
  if (!/from '\.\/skills\.js'/.test(src)) throw new Error('falta import de skills.js')
  if (!/SKILL_NAMES.*invokeSkill.*parseSkillMarker|parseSkillMarker.*invokeSkill.*SKILL_NAMES/.test(src))
    throw new Error('import no trae los 3 símbolos esperados')
  return true
})

assert('SYSTEM_PROMPT documenta los 3 markers [[SKILL:...]]', () => {
  if (!/\[\[SKILL:legal_faq\]\]/.test(src)) throw new Error('falta documentación [[SKILL:legal_faq]]')
  if (!/\[\[SKILL:reprocann_guide\]\]/.test(src)) throw new Error('falta documentación [[SKILL:reprocann_guide]]')
  if (!/\[\[SKILL:genetics_expert\]\]/.test(src)) throw new Error('falta documentación [[SKILL:genetics_expert]]')
  return true
})

assert('askClaude retorna skillName además de reply/wantsAffiliation', () => {
  if (!/return\s*\{\s*reply,\s*wantsAffiliation,\s*skillName/.test(src))
    throw new Error('askClaude no retorna skillName')
  return true
})

assert('webhook invoca skill cuando Claude la marca', () => {
  if (!/invokeSkill\(skillName/.test(src)) throw new Error('webhook no invoca invokeSkill')
  if (!/SKILL_NAMES\.includes\(skillName\)/.test(src))
    throw new Error('webhook no valida skillName contra SKILL_NAMES')
  return true
})

assert('Saludo post-nombre menciona los 3 temas (legal, REPROCANN, genéticas)', () => {
  const m = src.match(/¡Un gusto[^`]*`/)
  if (!m) throw new Error('no encontré saludo post-nombre')
  const txt = m[0]
  if (!/legal/i.test(txt)) throw new Error('saludo no menciona legal')
  if (!/reprocann/i.test(txt)) throw new Error('saludo no menciona REPROCANN')
  if (!/gen[eé]tica/i.test(txt)) throw new Error('saludo no menciona genéticas')
  return true
})

// ============ SUITE 10: QA Agent endpoint ============
console.log('\n🧪 Suite 10: QA Agent endpoint /admin/qa-report')

assert('Existe endpoint GET /admin/qa-report', () => {
  if (!/app\.get\(['"]\/admin\/qa-report['"]/.test(src))
    throw new Error('no existe ruta /admin/qa-report')
  return true
})

assert('QA endpoint lee conversation_history con limit', () => {
  if (!/from\(['"]conversation_history['"]\)/.test(src))
    throw new Error('QA no consulta conversation_history')
  if (!/\.limit\(limit\)/.test(src)) throw new Error('QA no aplica limit')
  return true
})

assert('QA tiene rúbrica definida', () => {
  if (!/QA_RUBRIC/.test(src)) throw new Error('falta QA_RUBRIC')
  if (!/Tono|Claridad|Empat[ií]a|Conversi[oó]n|Cobertura/.test(src))
    throw new Error('rúbrica no menciona los 5 criterios')
  return true
})

assert('QA no aplica cambios automáticos al prompt (solo lectura)', () => {
  // No debería haber ningún UPDATE/PATCH sobre el SYSTEM_PROMPT desde /admin/qa-report
  const qaBlock = src.match(/app\.get\(['"]\/admin\/qa-report['"][^}]*?\}\)/s)
  if (qaBlock && /SYSTEM_PROMPT\s*=/.test(qaBlock[0]))
    throw new Error('QA modifica SYSTEM_PROMPT — debería ser solo lectura')
  return true
})

// ============ SUITE 11: Concurrencia (v4.2) — per-chat lock, sin bloqueo cross-chat ============
console.log('\n🧪 Suite 11: Concurrencia — lock por chatId, distintos números procesan en paralelo')

assert('Existe chatLocks Map para serializar mensajes del mismo chat', () => {
  if (!/const chatLocks = new Map\(\)/.test(src)) throw new Error('falta chatLocks Map')
  return true
})

assert('Existe withChatLock para envolver el procesamiento', () => {
  if (!/function withChatLock\(chatId,\s*fn\)/.test(src)) throw new Error('falta withChatLock')
  return true
})

assert('Webhook llama a withChatLock antes de handleMessage', () => {
  if (!/withChatLock\(chatId,\s*\(\)\s*=>\s*handleMessage/.test(src))
    throw new Error('webhook no envuelve handleMessage en withChatLock')
  return true
})

assert('Se contabiliza inFlightWebhooks para observabilidad', () => {
  if (!/inFlightWebhooks\+\+/.test(src)) throw new Error('falta incremento de inFlightWebhooks')
  if (!/inFlightWebhooks--/.test(src)) throw new Error('falta decremento de inFlightWebhooks')
  return true
})

assert('/health expone inFlightWebhooks y activeChatLocks', () => {
  if (!/inFlightWebhooks[,\s]/.test(src)) throw new Error('/health no expone inFlightWebhooks')
  if (!/activeChatLocks/.test(src)) throw new Error('/health no expone activeChatLocks')
  return true
})

assert('Locks se limpian del Map cuando terminan (evita leak)', () => {
  if (!/chatLocks\.delete\(chatId\)/.test(src)) throw new Error('locks no se limpian del Map')
  return true
})

// ============ SUITE 12: GreenAPI quota handling (v4.2) ============
console.log('\n🧪 Suite 12: Detección de cuota agotada en GreenAPI')

assert('sendWhatsAppMessage detecta HTTP 466 y QUOTE_ALLOWED_EXCEEDED', () => {
  if (!/res\.status === 466|QUOTE_ALLOWED_EXCEEDED/.test(src))
    throw new Error('no detecta 466 / QUOTE_ALLOWED_EXCEEDED')
  return true
})

assert('Existe greenApiStats con contadores sent/failed/quotaExceeded', () => {
  if (!/greenApiStats\s*=\s*\{/.test(src)) throw new Error('falta greenApiStats')
  if (!/sent:\s*0/.test(src) || !/failed:\s*0/.test(src) || !/quotaExceeded:\s*false/.test(src))
    throw new Error('greenApiStats no tiene los campos esperados')
  return true
})

assert('Webhook maneja typeWebhook=quotaExceeded', () => {
  if (!/body\.typeWebhook === 'quotaExceeded'/.test(src))
    throw new Error('webhook no maneja quotaExceeded')
  return true
})

assert('notifyAdminQuotaExceeded existe y está throttleado', () => {
  if (!/async function notifyAdminQuotaExceeded/.test(src))
    throw new Error('falta notifyAdminQuotaExceeded')
  if (!/lastQuotaAlertAt/.test(src)) throw new Error('falta throttle de alertas')
  return true
})

// Health hardening check updated by Codex (GPT-5) on 2026-04-24.
assert('/health expone greenApi saneado', () => {
  if (!/greenApi:\s*\{/.test(src)) throw new Error('/health no expone greenApi')
  if (/anthropicKeyRaw|anthropicKeyPrefix|anthropicKeyLength/.test(src))
    throw new Error('/health sigue exponiendo detalles sensibles de claves')
  return true
})

assert('Webhook valida secreto antes de aceptar requests', () => {
  if (!/if \(!isWebhookAuthorized\(req\)\)/.test(src))
    throw new Error('webhook no valida secreto')
  return true
})

assert('Rutas admin usan requireAdminAccess', () => {
  if (!/\/admin\/qa-report[\s\S]{0,120}requireAdminAccess/.test(src))
    throw new Error('/admin/qa-report no exige auth')
  if (!/\/admin\/greenapi-status[\s\S]{0,120}requireAdminAccess/.test(src))
    throw new Error('/admin/greenapi-status no exige auth')
  return true
})

assert('GreenAPI ya no tiene token hardcodeado por defecto', () => {
  if (!/const GREEN_TOKEN = process\.env\.GREEN_API_TOKEN\?\.trim\(\)/.test(src))
    throw new Error('GREEN_TOKEN no quedó ligado solo al env')
  return true
})

// ============ SUITE 13: Human handover (v4.2) ============
console.log('\n🧪 Suite 13: Atención humana — email al admin cuando piden hablar con persona')

assert('Existe notifyHumanHandover', () => {
  if (!/async function notifyHumanHandover/.test(src))
    throw new Error('falta función notifyHumanHandover')
  return true
})

assert('notifyHumanHandover usa resend.emails.send con ADMIN_EMAIL', () => {
  const m = src.match(/async function notifyHumanHandover[\s\S]*?^\}/m)
  if (!m) throw new Error('no pude extraer el body de notifyHumanHandover')
  if (!/resend\.emails\.send/.test(m[0])) throw new Error('no usa resend.emails.send')
  if (!/to:\s*ADMIN_EMAIL/.test(m[0])) throw new Error('no envía a ADMIN_EMAIL')
  return true
})

assert('Webhook llama a notifyHumanHandover cuando wantHuman=true', () => {
  if (!/if \(wantHuman\)[\s\S]{0,800}notifyHumanHandover\(/.test(src))
    throw new Error('webhook no llama a notifyHumanHandover')
  return true
})

assert('Handover funciona aunque ADMIN_WHATSAPP no esté configurado', () => {
  // El chequeo `wantHuman && ADMIN_WHATSAPP` viejo bloqueaba todo sin ADMIN_WHATSAPP.
  // Ahora el flujo debería ser: if (wantHuman) { notifyHumanHandover(...); if (ADMIN_WHATSAPP) { ... } }
  if (/if \(wantHuman && ADMIN_WHATSAPP\)/.test(src))
    throw new Error('el handover aún depende de ADMIN_WHATSAPP para ejecutarse')
  return true
})

assert('Regex detecta variantes comunes de pedido humano', () => {
  // Verificamos que el regex tenga varios patrones
  const m = src.match(/const wantHuman = (\/[^/]+\/i)/)
  if (!m) throw new Error('no encontré regex wantHuman')
  const re = new RegExp(m[1].replace(/^\/|\/i$/g, ''), 'i')
  const casos = [
    'quiero hablar con una persona',
    'necesito que me atienda un humano',
    'pasame con alguien',
    'atención humana por favor',
  ]
  for (const c of casos) {
    if (!re.test(c)) throw new Error(`regex no matchea: "${c}"`)
  }
  return true
})

// ============ SUITE 14: Parseo IA del nombre (apodo + nombre_completo) ============
console.log('\n🧪 Suite 14: Parseo inteligente del nombre')

assert('Existe función parseUserName', () => {
  if (!/async function parseUserName\(rawMessage\)/.test(src))
    throw new Error('parseUserName no definida')
  return true
})

assert('parseUserName devuelve apodo + nombre_completo + necesita_aclarar', () => {
  const body = src.match(/async function parseUserName[\s\S]*?^\}/m)
  if (!body) throw new Error('no pude extraer body')
  if (!/apodo/.test(body[0])) throw new Error('no usa apodo')
  if (!/nombre_completo/.test(body[0])) throw new Error('no usa nombre_completo')
  if (!/necesita_aclarar/.test(body[0])) throw new Error('no usa necesita_aclarar')
  return true
})

assert('parseUserName llama a la API de Claude', () => {
  // Buscamos el bloque desde "async function parseUserName" hasta la próxima
  // declaración top-level (otra "async function" o "function").
  const m = src.match(/async function parseUserName[\s\S]*?(?=\nasync function |\nfunction )/)
  if (!m) throw new Error('no pude extraer el body de parseUserName')
  if (!/api\.anthropic\.com\/v1\/messages/.test(m[0]))
    throw new Error('no llama a la API de Claude')
  return true
})

assert('parseUserName tiene fallback si no hay ANTHROPIC_KEY', () => {
  const body = src.match(/async function parseUserName[\s\S]*?^\}/m)
  if (!/if \(!ANTHROPIC_KEY\)/.test(body[0]))
    throw new Error('no tiene guard de ANTHROPIC_KEY')
  return true
})

assert('State machine tiene paso aclarando_nombre', () => {
  if (!/aclarando_nombre/.test(src))
    throw new Error('no se usa aclarando_nombre como step')
  return true
})

assert('solicitando_nombre invoca parseUserName en lugar de usar el mensaje crudo', () => {
  // Tomamos el bloque del step solicitando_nombre
  const block = src.match(/state\.step === 'solicitando_nombre'[\s\S]{0,1500}/)
  if (!block) throw new Error('no encontré bloque solicitando_nombre')
  if (!/parseUserName\(message\)/.test(block[0]))
    throw new Error('no llama a parseUserName(message)')
  if (/state\.nombre = message\.trim\(\)/.test(block[0]))
    throw new Error('aún asigna state.nombre = message.trim() (sin IA)')
  return true
})

assert('Si necesita_aclarar=true, se pasa a aclarando_nombre y se pregunta', () => {
  const block = src.match(/parsedName\.necesita_aclarar[\s\S]{0,500}/)
  if (!block) throw new Error('no encontré check de necesita_aclarar')
  if (!/aclarando_nombre/.test(block[0])) throw new Error('no asigna aclarando_nombre')
  if (!/pregunta_aclaracion/.test(block[0])) throw new Error('no envía pregunta_aclaracion')
  return true
})

assert('Saludo usa state.nombre (apodo) no nombre_completo', () => {
  const greet = src.match(/¡Un gusto, \$\{state\.nombre\}/)
  if (!greet) throw new Error('saludo no usa ${state.nombre}')
  return true
})

assert('insertMember usa nombre_completo cuando está disponible', () => {
  // Al menos un call site debe priorizar nombre_completo
  if (!/state\.nombre_completo \|\| state\.nombre/.test(src))
    throw new Error('ningún call site usa state.nombre_completo || state.nombre')
  return true
})

assert('loadState incluye nombre_completo en el retorno', () => {
  const load = src.match(/async function loadState[\s\S]*?^\}/m)
  if (!/nombre_completo:/.test(load[0]))
    throw new Error('loadState no devuelve nombre_completo')
  return true
})

assert('saveState persiste nombre_completo en collected_data', () => {
  const save = src.match(/async function saveState[\s\S]*?^\}/m)
  if (!/nombre_completo/.test(save[0]))
    throw new Error('saveState no persiste nombre_completo')
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
