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

console.log(failures === 0 ? '\nAll router parse tests passed.' : `\n${failures} failure(s).`)
process.exit(failures === 0 ? 0 : 1)
