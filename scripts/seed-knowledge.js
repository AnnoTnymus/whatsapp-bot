// Seed knowledge base from JSONL
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

async function seedKnowledge() {
  const content = readFileSync(SEED_FILE, 'utf-8')
  const lines = content.trim().split('\n')

  let inserted = 0
  let failed = 0

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
        updated_at: new Date().toISOString()
      }, { onConflict: 'topic' })

    if (error) {
      console.error(`Error inserting ${entry.topic}:`, error.message)
      failed++
    } else {
      console.log(`Inserted: ${entry.topic}`)
      inserted++
    }
  }

  console.log(`\nSeeded ${inserted} entries, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

seedKnowledge()