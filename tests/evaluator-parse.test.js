// [claude-opus-4.7] 2026-04-24: unit test para parseEvaluatorReply.
// Corré con:  node tests/evaluator-parse.test.js

import { strict as assert } from 'node:assert'
import { parseEvaluatorReply } from '../src/agents/evaluator.js'

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

t('parses clean JSON', () => {
  const r = parseEvaluatorReply('{"score":92,"reasons":["ok","tono"],"passes":true}')
  assert.equal(r.score, 92)
  assert.deepEqual(r.reasons, ['ok', 'tono'])
  assert.equal(r.passes, true)
})

t('strips code fences', () => {
  const r = parseEvaluatorReply('```json\n{"score":80,"reasons":["a"],"passes":true}\n```')
  assert.equal(r.score, 80)
  assert.equal(r.passes, true)
})

t('tolerates prose before JSON', () => {
  const r = parseEvaluatorReply('Mi evaluación: {"score":55,"reasons":["tono flojo"],"passes":false}')
  assert.equal(r.score, 55)
  assert.equal(r.passes, false)
})

t('derives passes from score when missing', () => {
  const r = parseEvaluatorReply('{"score":75,"reasons":["x"]}')
  assert.equal(r.passes, true)
})

t('derives failing passes when score below threshold', () => {
  const r = parseEvaluatorReply('{"score":40,"reasons":["mal"]}')
  assert.equal(r.passes, false)
})

t('clamps score above 100', () => {
  const r = parseEvaluatorReply('{"score":150,"reasons":["x"],"passes":true}')
  assert.equal(r.score, 100)
})

t('clamps negative score to 0', () => {
  const r = parseEvaluatorReply('{"score":-20,"reasons":["x"]}')
  assert.equal(r.score, 0)
  assert.equal(r.passes, false)
})

t('converts string reasons into array', () => {
  const r = parseEvaluatorReply('{"score":70,"reasons":"- a\\n- b\\n- c","passes":true}')
  assert.ok(Array.isArray(r.reasons))
  assert.ok(r.reasons.length >= 2)
})

t('handles empty input', () => {
  const r = parseEvaluatorReply('')
  assert.equal(r.score, 0)
  assert.equal(r.passes, false)
})

t('handles invalid JSON', () => {
  const r = parseEvaluatorReply('{score: 80, "reasons": [}')
  assert.equal(r.score, 0)
  assert.equal(r.passes, false)
})

t('no-json string falls back to failure', () => {
  const r = parseEvaluatorReply('sorry, cannot evaluate')
  assert.equal(r.score, 0)
  assert.equal(r.passes, false)
})

console.log(failures === 0 ? '\nAll evaluator parse tests passed.' : `\n${failures} failure(s).`)
process.exit(failures === 0 ? 0 : 1)
