// Seed knowledge base from JSONL
// Added by OpenCode (Rolli) on 2026-04-25

import 'dotenv/config'
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const SEED_FILE = process.argv[2] || 'knowledge/seeds/bot_knowledge.jsonl'
const LANGUAGE = process.argv[3] || 'es'

async function seedKnowledge() {
  console.log(`Seeding from ${SEED_FILE} (language: ${LANGUAGE})`)
  const content = readFileSync(SEED_FILE, 'utf-8')
  const lines = content.trim().split('\n')

  let inserted = 0
  let failed = 0

  for (const line of lines) {
    if (!line.trim()) continue

    const entry = JSON.parse(line)
    try {
      const { error } = await supabase
        .from('bot_knowledge')
        .insert({
          topic: entry.topic,
          content: entry.content,
          tags: entry.tags,
          source_url: entry.source_url || null,
          language: entry.language || LANGUAGE,
          priority: entry.priority || 0,
          active: true,
          updated_at: new Date().toISOString()
        })

      if (error) {
        if (error.message.includes('duplicate')) {
          console.log(`Skipped (duplicate): ${entry.topic}`)
        } else {
          console.error(`Error inserting ${entry.topic}:`, error.message)
          failed++
        }
      } else {
        console.log(`Inserted: ${entry.topic} (${entry.language || LANGUAGE})`)
        inserted++
      }
    } catch (e) {
      console.error(`Error inserting ${entry.topic}:`, e.message)
      failed++
    }
  }

  console.log(`\nSeeded ${inserted} entries, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

seedKnowledge()