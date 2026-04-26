// [claude-opus-4.7] 2026-04-24: unit test para coerceRouterJson.
// Corré con:  node tests/router-parse.test.js

import { strict as assert } from 'node:assert'
import { _internal } from '../src/agents/router.js'

const { coerceRouterJson } = _internal

let failures = 0
function t(name, fn) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (e) {
    failures++
    console.log(`  FAIL ${name}: ${e.message}`)
  }
}

t('parses clean router JSON', () => {
  const r = coerceRouterJson('{"intent":"info","needs_knowledge":true,"knowledge_query":"horarios","skill":null,"wants_affiliation":false,"reasoning":"pregunta por horario"}')
  assert.equal(r.intent, 'info')
  assert.equal(r.needs_knowledge, true)
  assert.equal(r.knowledge_query, 'horarios')
  assert.equal(r.skill, null)
  assert.equal(r.wants_affiliation, false)
})

t('rejects invalid intent, falls to info', () => {
  const r = coerceRouterJson('{"intent":"banana","needs_knowledge":false,"knowledge_query":null,"skill":null,"wants_affiliation":false,"reasoning":"?"}')
  assert.equal(r.intent, 'info')
})

t('only allows the 3 valid skills', () => {
  const r = coerceRouterJson('{"intent":"skill","needs_knowledge":false,"knowledge_query":null,"skill":"made_up_skill","wants_affiliation":false,"reasoning":"?"}')
  assert.equal(r.skill, null)
  const r2 = coerceRouterJson('{"intent":"skill","needs_knowledge":false,"knowledge_query":null,"skill":"genetics_expert","wants_affiliation":false,"reasoning":"?"}')
  assert.equal(r2.skill, 'genetics_expert')
})

t('wants_affiliation only true when intent is affiliate', () => {
  const r = coerceRouterJson('{"intent":"info","needs_knowledge":true,"knowledge_query":"horarios","skill":null,"wants_affiliation":true,"reasoning":"?"}')
  assert.equal(r.wants_affiliation, false)
  const r2 = coerceRouterJson('{"intent":"affiliate","needs_knowledge":false,"knowledge_query":null,"skill":null,"wants_affiliation":true,"reasoning":"?"}')
  assert.equal(r2.wants_affiliation, true)
})

t('strips code fences in router output', () => {
  const r = coerceRouterJson('```json\n{"intent":"greet","needs_knowledge":false,"knowledge_query":null,"skill":null,"wants_affiliation":false,"reasoning":"hola"}\n```')
  assert.equal(r.intent, 'greet')
})

t('null knowledge_query when needs_knowledge is false', () => {
  const r = coerceRouterJson('{"intent":"greet","needs_knowledge":false,"knowledge_query":"garbage","skill":null,"wants_affiliation":false,"reasoning":"hola"}')
  assert.equal(r.knowledge_query, null)
})

t('lowercases knowledge_query', () => {
  const r = coerceRouterJson('{"intent":"info","needs_knowledge":true,"knowledge_query":"HORARIOS","skill":null,"wants_affiliation":false,"reasoning":"?"}')
  assert.equal(r.knowledge_query, 'horarios')
})

t('returns null on invalid JSON', () => {
  assert.equal(coerceRouterJson(''), null)
  assert.equal(coerceRouterJson('not json'), null)
  assert.equal(coerceRouterJson('{intent:"info"}'), null)
})

// ── Fase 2: saludo + intención combinados ──

t('Fase2: greet + affiliate keyword → override a affiliate', () => {
  const raw = '{"intent":"greet","needs_knowledge":false,"knowledge_query":null,"skill":null,"wants_affiliation":false,"reasoning":"saludo"}'
  const r = coerceRouterJson(raw, 'Hola quería inscribirme')
  assert.equal(r.intent, 'affiliate')
  assert.equal(r.wants_affiliation, true)
  assert.equal(r.needs_knowledge, false)
})

t('Fase2: info + affiliate keyword (no pregunta) → override a affiliate', () => {
  const raw = '{"intent":"info","needs_knowledge":true,"knowledge_query":"club","skill":null,"wants_affiliation":false,"reasoning":"info"}'
  const r = coerceRouterJson(raw, 'Quiero anotarme al club')
  assert.equal(r.intent, 'affiliate')
  assert.equal(r.wants_affiliation, true)
  assert.equal(r.needs_knowledge, false)
  assert.equal(r.knowledge_query, null)
})

t('Fase2: pregunta con keyword (¿cómo me afilio?) NO se pisa', () => {
  const raw = '{"intent":"info","needs_knowledge":true,"knowledge_query":"club","skill":null,"wants_affiliation":false,"reasoning":"info"}'
  const r = coerceRouterJson(raw, '¿cómo me afilio al club?')
  assert.equal(r.intent, 'info')
  assert.equal(r.wants_affiliation, false)
})

t('Fase2: pregunta terminada en signo (afiliarme?) NO se pisa', () => {
  const raw = '{"intent":"info","needs_knowledge":true,"knowledge_query":"club","skill":null,"wants_affiliation":false,"reasoning":"info"}'
  const r = coerceRouterJson(raw, 'puedo afiliarme?')
  assert.equal(r.intent, 'info')
})

t('Fase2: greet limpio (sin keyword) NO cambia', () => {
  const raw = '{"intent":"greet","needs_knowledge":false,"knowledge_query":null,"skill":null,"wants_affiliation":false,"reasoning":"saludo"}'
  const r = coerceRouterJson(raw, 'Hola buenas')
  assert.equal(r.intent, 'greet')
  assert.equal(r.wants_affiliation, false)
})

t('Fase2: variantes nuevas (sumarme/anotarme/asociarme) → override', () => {
  const raw = '{"intent":"greet","needs_knowledge":false,"knowledge_query":null,"skill":null,"wants_affiliation":false,"reasoning":"saludo"}'
  const cases = ['Buenas, quiero sumarme', 'Hola me quiero anotar', 'Hola me quiero asociar']
  for (const msg of cases) {
    const r = coerceRouterJson(raw, msg)
    assert.equal(r.intent, 'affiliate', `falló override para: "${msg}"`)
    assert.equal(r.wants_affiliation, true, `wants_affiliation falló para: "${msg}"`)
  }
})

console.log(failures === 0 ? '\nAll router parse tests passed.' : `\n${failures} failure(s).`)
process.exit(failures === 0 ? 0 : 1)
