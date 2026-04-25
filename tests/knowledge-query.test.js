// Knowledge query test
// Added by OpenCode (Rolli) on 2026-04-25

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const SEED_FILE = 'knowledge/seeds/bot_knowledge.jsonl'

async function seed() {
  const content = readFileSync(SEED_FILE, 'utf-8')
  const lines = content.trim().split('\n')

  for (const line of lines) {
    if (!line.trim()) continue
    const entry = JSON.parse(line)
    await supabase.from('bot_knowledge').upsert({
      topic: entry.topic,
      content: entry.content,
      tags: entry.tags,
      source_url: entry.source_url || null,
      priority: entry.priority || 0,
      updated_at: new Date().toISOString()
    }, { onConflict: 'topic' })
  }
}

import { queryKnowledge } from '../src/knowledge/query.js'
global.supabase = supabase

async function runTests() {
  console.log('=== Seeding ===')
  await seed()

  console.log('\n=== Test 1: queryKnowledge("indajaus") should return >= 1 ===')
  const hits = await queryKnowledge('indajaus')
  console.log(`Found ${hits.length} results`)
  if (hits.length < 1) {
    console.error('FAIL: indajaus should return >= 1')
    process.exit(1)
  }
  console.log('PASS')

  console.log('\n=== Test 2: non-existent topic should return [] ===')
  const miss = await queryKnowledge('xxxxxno-existe-xxxxx')
  console.log(`Found ${miss.length} results`)
  if (miss.length !== 0) {
    console.error('FAIL: non-existent topic should return []')
    process.exit(1)
  }
  console.log('PASS')

  console.log('\n=== Test 3: limit must be respected ===')
  const limited = await queryKnowledge('reprocann', 2)
  console.log(`Found ${limited.length} results (limit=2)`)
  if (limited.length > 2) {
    console.error('FAIL: limit must be respected')
    process.exit(1)
  }
  console.log('PASS')

  console.log('\n=== All tests passed ===')
  process.exit(0)
}

runTests()