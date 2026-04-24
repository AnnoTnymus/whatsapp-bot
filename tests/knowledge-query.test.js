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

async function seedAndTest() {
  console.log('=== Seeding knowledge base ===')
  
  const content = readFileSync(SEED_FILE, 'utf-8')
  const lines = content.trim().split('\n')

  let seeded = 0
  for (const line of lines) {
    if (!line.trim()) continue
    const entry = JSON.parse(line)
    const { error } = await supabase
      .from('bot_knowledge')
      .upsert({
        topic: entry.topic,
        content: entry.content,
        tags: entry.tags,
        source_url: entry.source_url || null,
        priority: entry.priority || 0,
        updated_at: new Date().toISOString()
      }, { onConflict: 'topic' })

    if (error) {
      console.error(`Error seeding ${entry.topic}:`, error.message)
    } else {
      seeded++
    }
  }
  console.log(`Seeded ${seeded} entries`)

  console.log('\n=== Testing queryKnowledge("indajaus") ===')
  
  const { data, error } = await supabase
    .from('bot_knowledge')
    .select('id, topic, content, tags, source_url')
    .or('topic.ilike.%indajaus%,tags.cs.{indajaus}')
    .limit(3)

  if (error) {
    console.error('Query error:', error.message)
    process.exit(1)
  }

  console.log(`Found ${data.length} results for "indajaus"`)
  for (const row of data) {
    console.log(`  - ${row.topic}: ${row.content.substring(0, 60)}...`)
  }

  if (data.length >= 1) {
    console.log('\n✅ TEST PASSED: queryKnowledge("indajaus") returned >= 1 entry')
    process.exit(0)
  } else {
    console.log('\n❌ TEST FAILED: Expected >= 1 entry')
    process.exit(1)
  }
}

seedAndTest()