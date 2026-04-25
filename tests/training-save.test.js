// Training save test
// Added by OpenCode (Rolli) on 2026-04-26

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

import { saveTrainingExample } from '../src/knowledge/training.js'

async function runTests() {
  console.log('=== Test 1: saveTrainingExample inserts row ===')
  const chatId = `test-${Date.now()}`
  await saveTrainingExample(chatId, 'Hello', 'Hi there!', 85, 'Good response')
  await new Promise((r) => setTimeout(r, 500))

  const { data, error } = await supabase
    .from('bot_training')
    .select('*')
    .eq('chat_id', chatId)
    .single()

  if (error) {
    console.error('FAIL: row not found', error.message)
    process.exit(1)
  }

  if (data.user_msg !== 'Hello' || data.bot_reply !== 'Hi there!' || data.score !== 85) {
    console.error('FAIL: data mismatch')
    process.exit(1)
  }
  console.log('PASS')

  console.log('\n=== Test 2: empty chatId does NOT create row ===')
  const before = await supabase.from('bot_training').select('*', { count: 'exact', head: true })
  await saveTrainingExample('', 'Hello', 'Hi', 50, 'test')
  await new Promise((r) => setTimeout(r, 500))
  const after = await supabase.from('bot_training').select('*', { count: 'exact', head: true })

  if (after.count !== before.count) {
    console.error('FAIL: empty chatId should not create row')
    process.exit(1)
  }
  console.log('PASS')

  console.log('\n=== All tests passed ===')
  process.exit(0)
}

runTests()