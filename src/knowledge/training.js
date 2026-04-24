// Training examples storage
// Added by OpenCode (Rolli) on 2026-04-26

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

let supabase = null

function getSupabase() {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return null
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  }
  return supabase
}

export async function saveTrainingExample(chatId, userMsg, botReply, score, reason) {
  if (!chatId || typeof chatId !== 'string') {
    console.error('saveTrainingExample: chatId is required')
    return
  }

  const clampedScore = Math.max(0, Math.min(100, Math.floor(Number(score) || 0)))
  const truncatedReason = (reason || '').slice(0, 500)

  const db = getSupabase()
  if (!db) {
    console.error('saveTrainingExample: Supabase not configured')
    return
  }

  db.from('bot_training').insert({
    chat_id: chatId,
    user_msg: userMsg || '',
    bot_reply: botReply || '',
    score: clampedScore,
    reason: truncatedReason
  }).then(({ error }) => {
    if (error) {
      console.error('saveTrainingExample failed:', error.message)
    }
  })
}