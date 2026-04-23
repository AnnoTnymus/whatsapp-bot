// Test Suite v4.0 — Full E2E against Supabase
import 'dotenv/config.js'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
)

let passed = 0, failed = 0
const failures = []

function tick(name) { passed++; console.log(`  ✅ ${name}`) }
function fail(name, err) { failed++; failures.push({ name, err: err?.message || err }); console.log(`  ❌ ${name}: ${err?.message || err}`) }

async function assert(name, fn) {
  try {
    const r = await fn()
    if (r === false) fail(name, 'assertion returned false')
    else tick(name)
  } catch (e) { fail(name, e) }
}

async function loadState(chatId) {
  const { data } = await supabase.from('patient_state').select('*').eq('chat_id', chatId).single()
  if (!data) return { step: 'inicio', nombre: null, documentos: { dni: { frente: null, dorso: null }, reprocann: { frente: null, dorso: null } }, collectedData: {}, pendingFields: [] }
  return { step: data.step, nombre: data.nombre, documentos: data.documentos, collectedData: data.collected_data, pendingFields: data.pending_fields, last_message_at: data.last_message_at, last_greeting_at: data.last_greeting_at }
}

async function saveState(chatId, state) {
  const { error } = await supabase.from('patient_state').upsert({
    chat_id: chatId, nombre: state.nombre, step: state.step,
    documentos: state.documentos, collected_data: state.collectedData,
    pending_fields: state.pendingFields,
    last_message_at: state.last_message_at,
    last_greeting_at: state.last_greeting_at,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'chat_id' })
  if (error) throw error
}

async function cleanup(cids) {
  for (const c of cids) {
    await supabase.from('patient_state').delete().eq('chat_id', c)
    await supabase.from('conversation_history').delete().eq('chat_id', c)
    await supabase.from('patient_followups').delete().eq('chat_id', c)
    await supabase.from('members').delete().eq('chat_id', c)
  }
}

async function suitePersistence() {
  console.log('\n📦 Suite 1: Persistencia Supabase')
  const cid = `test-persist-${Date.now()}@c.us`

  await assert('TC1.1 loadState en chat nuevo → default', async () => {
    const s = await loadState(cid); return s.step === 'inicio' && s.nombre === null
  })
  await assert('TC1.2 saveState preserva step', async () => {
    await saveState(cid, { step: 'solicitando_nombre', nombre: null, documentos: { dni: { frente: null, dorso: null }, reprocann: { frente: null, dorso: null } }, collectedData: {}, pendingFields: [] })
    const s = await loadState(cid); return s.step === 'solicitando_nombre'
  })
  await assert('TC1.3 saveState preserva nombre', async () => {
    await saveState(cid, { step: 'recibiendo_documentos', nombre: 'Juan Pérez', documentos: { dni: { frente: null, dorso: null }, reprocann: { frente: null, dorso: null } }, collectedData: {}, pendingFields: [] })
    const s = await loadState(cid); return s.nombre === 'Juan Pérez'
  })
  await assert('TC1.4 documentos JSONB persisten', async () => {
    const docs = { dni: { frente: 'https://x/dni.jpg', dorso: null }, reprocann: { frente: null, dorso: null } }
    await saveState(cid, { step: 'recibiendo_documentos', nombre: 'J', documentos: docs, collectedData: {}, pendingFields: [] })
    const s = await loadState(cid); return s.documentos?.dni?.frente === 'https://x/dni.jpg'
  })
  await assert('TC1.5 upsert sobrescribe', async () => {
    await saveState(cid, { step: 'completado', nombre: 'Juan Pérez', documentos: {}, collectedData: {}, pendingFields: [] })
    const s = await loadState(cid); return s.step === 'completado'
  })
  await assert('TC1.6 collected_data JSONB', async () => {
    await saveState(cid, { step: 'completando_datos', nombre: 'J', documentos: {}, collectedData: { provincia: 'Buenos Aires' }, pendingFields: [] })
    const s = await loadState(cid); return s.collectedData?.provincia === 'Buenos Aires'
  })
  await assert('TC1.7 last_message_at guardado', async () => {
    const ts = new Date().toISOString()
    await saveState(cid, { step: 'recibiendo_documentos', nombre: 'J', documentos: {}, collectedData: {}, pendingFields: [], last_message_at: ts })
    const s = await loadState(cid); return s.last_message_at !== null
  })

  await cleanup([cid])
}

async function suiteMembers() {
  console.log('\n👥 Suite 2: Members CRM')
  const cid = `test-members-${Date.now()}@c.us`

  await assert('TC2.1 INSERT member', async () => {
    const { error } = await supabase.from('members').insert({ chat_id: cid, nombre: 'María López' })
    return !error
  })
  await assert('TC2.2 READ member', async () => {
    const { data } = await supabase.from('members').select('*').eq('chat_id', cid).single()
    return data?.nombre === 'María López'
  })
  await assert('TC2.3 UPDATE member REPROCANN', async () => {
    const { error } = await supabase.from('members').update({
      dni: '30111222', tipo_paciente: 'autocultivador',
      provincia: 'Buenos Aires', localidad: 'La Plata',
      reprocann_vencimiento: '2027-06-15', limite_transporte: '30g',
    }).eq('chat_id', cid)
    return !error
  })
  await assert('TC2.4 reprocann_vencimiento query-able', async () => {
    const { data } = await supabase.from('members').select('*').eq('chat_id', cid).single()
    return data?.reprocann_vencimiento === '2027-06-15'
  })
  await assert('TC2.5 UNIQUE chat_id', async () => {
    const { error } = await supabase.from('members').insert({ chat_id: cid, nombre: 'Dup' })
    return error !== null
  })
  await assert('TC2.6 Query por provincia', async () => {
    const { data } = await supabase.from('members').select('*').eq('provincia', 'Buenos Aires')
    return Array.isArray(data) && data.length >= 1
  })

  await cleanup([cid])
}

async function suiteFollowups() {
  console.log('\n🔔 Suite 3: Follow-ups cron')
  const cid = `test-follow-${Date.now()}@c.us`
  const ahora = new Date()
  const pasado = (m) => new Date(ahora - m * 60000).toISOString()
  const futuro = (m) => new Date(ahora.getTime() + m * 60000).toISOString()

  await assert('TC3.1 INSERT sin_reprocann', async () => {
    const { error } = await supabase.from('patient_followups').insert({
      chat_id: cid, nombre: 'Test', motivo: 'sin_reprocann',
      proxima_notificacion: pasado(5), intentos: 0, status: 'pendiente'
    })
    return !error
  })
  await assert('TC3.2 Query pendientes pasados', async () => {
    const { data } = await supabase.from('patient_followups').select('*')
      .eq('status', 'pendiente').lte('proxima_notificacion', ahora.toISOString())
    return Array.isArray(data) && data.length >= 1
  })
  await assert('TC3.3 UPDATE intentos + reschedule', async () => {
    const { data: rows } = await supabase.from('patient_followups').select('*').eq('chat_id', cid).limit(1)
    const { error } = await supabase.from('patient_followups').update({
      intentos: 1, proxima_notificacion: futuro(3 * 24 * 60)
    }).eq('id', rows[0].id)
    return !error
  })
  await assert('TC3.4 Cancelar followup (sin tocar proxima_notificacion)', async () => {
    const { error } = await supabase.from('patient_followups').update({ status: 'cancelado' }).eq('chat_id', cid)
    return !error
  })
  await assert('TC3.5 Cancelados no aparecen en pendientes', async () => {
    const { data } = await supabase.from('patient_followups').select('*').eq('chat_id', cid).eq('status', 'pendiente')
    return data.length === 0
  })
  await assert('TC3.6 Múltiples motivos por chat_id', async () => {
    for (const m of ['sin_reprocann', 'tramitando', 'docs_incompletos', 'inactivo']) {
      await supabase.from('patient_followups').insert({
        chat_id: cid, nombre: 'Test', motivo: m,
        proxima_notificacion: pasado(1), intentos: 0, status: 'pendiente'
      })
    }
    const { data } = await supabase.from('patient_followups').select('*').eq('chat_id', cid)
    return data.length >= 5
  })

  await cleanup([cid])
}

async function suiteHistory() {
  console.log('\n💬 Suite 4: Conversation History')
  const cid = `test-hist-${Date.now()}@c.us`

  await assert('TC4.1 INSERT con messages', async () => {
    const { error } = await supabase.from('conversation_history').insert({
      chat_id: cid, messages: [{ role: 'user', content: 'Hola' }, { role: 'assistant', content: '¡Ey che!' }]
    })
    return !error
  })
  await assert('TC4.2 READ history', async () => {
    const { data } = await supabase.from('conversation_history').select('*').eq('chat_id', cid).single()
    return Array.isArray(data?.messages) && data.messages.length === 2
  })
  await assert('TC4.3 UPSERT replace', async () => {
    const { error } = await supabase.from('conversation_history').upsert({
      chat_id: cid, messages: [{ role: 'user', content: 'Nuevo' }], updated_at: new Date().toISOString()
    }, { onConflict: 'chat_id' })
    return !error
  })
  await assert('TC4.4 JSONB preserva estructura', async () => {
    const { data } = await supabase.from('conversation_history').select('*').eq('chat_id', cid).single()
    return data.messages[0].role === 'user' && data.messages[0].content === 'Nuevo'
  })
  await assert('TC4.5 History con 8 mensajes', async () => {
    const msgs = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `msg ${i}` }))
    await supabase.from('conversation_history').upsert({ chat_id: cid, messages: msgs, updated_at: new Date().toISOString() }, { onConflict: 'chat_id' })
    const { data } = await supabase.from('conversation_history').select('*').eq('chat_id', cid).single()
    return data.messages.length === 8
  })

  await cleanup([cid])
}

async function suiteFlowE2E() {
  console.log('\n🔄 Suite 5: Flujo completo E2E')
  const cid = `test-flow-${Date.now()}@c.us`

  await assert('TC5.1 Estado inicial inicio', async () => {
    const s = await loadState(cid); return s.step === 'inicio'
  })
  await assert('TC5.2 → solicitando_nombre', async () => {
    await saveState(cid, {
      step: 'solicitando_nombre', nombre: null,
      documentos: { dni: { frente: null, dorso: null }, reprocann: { frente: null, dorso: null } },
      collectedData: {}, pendingFields: [],
      last_greeting_at: new Date().toISOString(),
    })
    const s = await loadState(cid); return s.step === 'solicitando_nombre'
  })
  await assert('TC5.3 → recibiendo_documentos + members', async () => {
    const s = await loadState(cid)
    s.nombre = 'Juan Test'; s.step = 'recibiendo_documentos'
    await saveState(cid, s)
    const { error: mErr } = await supabase.from('members').insert({ chat_id: cid, nombre: 'Juan Test' })
    if (mErr && mErr.code !== '23505') throw mErr
    const s2 = await loadState(cid); return s2.nombre === 'Juan Test'
  })
  await assert('TC5.4 Guardar DNI frente', async () => {
    const s = await loadState(cid)
    s.documentos.dni.frente = 'https://storage/dni-f.jpg'
    await saveState(cid, s)
    const s2 = await loadState(cid); return s2.documentos.dni.frente !== null
  })
  await assert('TC5.5 Guardar DNI dorso', async () => {
    const s = await loadState(cid)
    s.documentos.dni.dorso = 'https://storage/dni-b.jpg'
    await saveState(cid, s)
    const s2 = await loadState(cid); return s2.documentos.dni.dorso && s2.documentos.dni.frente
  })
  await assert('TC5.6 REPROCANN ambos lados', async () => {
    const s = await loadState(cid)
    s.documentos.reprocann = { frente: 'https://r/f.jpg', dorso: 'https://r/b.jpg' }
    await saveState(cid, s)
    const s2 = await loadState(cid); return s2.documentos.reprocann.frente && s2.documentos.reprocann.dorso
  })
  await assert('TC5.7 → completando_datos con pendingFields', async () => {
    const s = await loadState(cid)
    s.step = 'completando_datos'; s.pendingFields = [{ key: 'provincia', pregunta: '¿Provincia?' }]
    await saveState(cid, s)
    const s2 = await loadState(cid); return s2.pendingFields.length === 1
  })
  await assert('TC5.8 Recoger respuesta', async () => {
    const s = await loadState(cid)
    s.collectedData.provincia = 'Buenos Aires'; s.pendingFields.shift()
    await saveState(cid, s)
    const s2 = await loadState(cid); return s2.collectedData.provincia === 'Buenos Aires' && s2.pendingFields.length === 0
  })
  await assert('TC5.9 → completado', async () => {
    const s = await loadState(cid); s.step = 'completado'
    await saveState(cid, s)
    const s2 = await loadState(cid); return s2.step === 'completado'
  })
  await assert('TC5.10 Update members completo', async () => {
    const { error } = await supabase.from('members').update({
      dni: '30111222', tipo_paciente: 'autocultivador',
      provincia: 'Buenos Aires', localidad: 'CABA',
      reprocann_vencimiento: '2027-12-31', limite_transporte: '30g',
    }).eq('chat_id', cid)
    return !error
  })
  await assert('TC5.11 Member completo readable', async () => {
    const { data } = await supabase.from('members').select('*').eq('chat_id', cid).single()
    return data?.nombre === 'Juan Test' && data?.provincia === 'Buenos Aires'
  })
  await assert('TC5.12 Persistencia post-reload (simula redeploy)', async () => {
    const sb2 = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { data } = await sb2.from('patient_state').select('*').eq('chat_id', cid).single()
    return data?.step === 'completado' && data?.nombre === 'Juan Test'
  })

  await cleanup([cid])
}

async function suiteEdgeCases() {
  console.log('\n⚠️  Suite 6: Edge cases')
  const cid = `test-edge-${Date.now()}@c.us`

  await assert('TC6.1 Nombre con acentos', async () => {
    await saveState(cid, { step: 'recibiendo_documentos', nombre: 'José Peña Muñoz', documentos: {}, collectedData: {}, pendingFields: [] })
    const s = await loadState(cid); return s.nombre === 'José Peña Muñoz'
  })
  await assert('TC6.2 Nombre 150 chars', async () => {
    const largo = 'A'.repeat(150)
    await saveState(cid, { step: 'inicio', nombre: largo, documentos: {}, collectedData: {}, pendingFields: [] })
    const s = await loadState(cid); return s.nombre.length === 150
  })
  await assert('TC6.3 URL documento muy larga', async () => {
    const url = 'https://example.com/' + 'x'.repeat(500) + '.jpg'
    await saveState(cid, { step: 'recibiendo_documentos', nombre: 'J',
      documentos: { dni: { frente: url, dorso: null }, reprocann: { frente: null, dorso: null } },
      collectedData: {}, pendingFields: [] })
    const s = await loadState(cid); return s.documentos.dni.frente.length > 500
  })
  await assert('TC6.4 collectedData con 25 campos', async () => {
    const big = {}; for (let i = 0; i < 25; i++) big[`c${i}`] = `v${i}`
    await saveState(cid, { step: 'completando_datos', nombre: 'J', documentos: {}, collectedData: big, pendingFields: [] })
    const s = await loadState(cid); return Object.keys(s.collectedData).length === 25
  })
  await assert('TC6.5 chat_id formato WhatsApp real', async () => {
    const real = `5491155550${Date.now() % 10000}@c.us`
    await saveState(real, { step: 'inicio', nombre: null, documentos: {}, collectedData: {}, pendingFields: [] })
    const s = await loadState(real)
    await cleanup([real])
    return s.step === 'inicio'
  })
  await assert('TC6.6 Concurrent updates — last write wins', async () => {
    await saveState(cid, { step: 'A', nombre: 'X', documentos: {}, collectedData: {}, pendingFields: [] })
    await saveState(cid, { step: 'B', nombre: 'Y', documentos: {}, collectedData: {}, pendingFields: [] })
    const s = await loadState(cid); return s.step === 'B' && s.nombre === 'Y'
  })
  await assert('TC6.7 Empty documentos object', async () => {
    await saveState(cid, { step: 'inicio', nombre: null, documentos: {}, collectedData: {}, pendingFields: [] })
    const s = await loadState(cid); return typeof s.documentos === 'object'
  })

  await cleanup([cid])
}

async function main() {
  const start = Date.now()
  console.log('🧪 WhatsApp Bot v4.0 — Test Suite\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  try {
    await suitePersistence()
    await suiteMembers()
    await suiteFollowups()
    await suiteHistory()
    await suiteFlowE2E()
    await suiteEdgeCases()
  } catch (e) {
    console.log('\n💥 FATAL:', e.message)
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`📊 ${passed} passed, ${failed} failed — ${elapsed}s`)
  if (failures.length) {
    console.log('\nFallos:')
    failures.forEach(f => console.log(`  - ${f.name}: ${f.err}`))
  }
  process.exit(failed > 0 ? 1 : 0)
}

main()
