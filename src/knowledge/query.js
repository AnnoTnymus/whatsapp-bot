// Knowledge query runtime
// Added by OpenCode (Rolli) on 2026-04-25

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

export async function queryKnowledge(topic, limit = 3) {
  if (!topic || typeof topic !== 'string') {
    console.warn('queryKnowledge: invalid topic')
    return []
  }

  const searchTerm = topic.toLowerCase().trim()

  const { data, error } = await supabase
    .from('bot_knowledge')
    .select('id, topic, content, tags, source_url, priority')
    .eq('active', true)
    .order('priority', { ascending: false })
    .limit(limit * 3)

  if (error) {
    console.error(`queryKnowledge failed: ${error.message}`)
    return []
  }

  const results = data
    .map((row) => {
      let score = 0
      const rowTopic = row.topic?.toLowerCase() || ''
      const rowContent = row.content?.toLowerCase() || ''
      const rowTags = row.tags || []

      if (rowTopic === searchTerm) {
        score += 100
      } else if (rowTopic.includes(searchTerm) || searchTerm.includes(rowTopic)) {
        score += 50
      }

      if (rowTags.some((tag) => searchTerm.includes(tag) || tag.includes(searchTerm))) {
        score += 30
      }

      if (rowContent.includes(searchTerm)) {
        score += 10
      }

      return { ...row, _score: score }
    })
    .filter((r) => r._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...rest }) => rest)

  return results
}

export async function getKnowledgeStats() {
  const { count, error } = await supabase
    .from('bot_knowledge')
    .select('*', { count: 'exact', head: true })
    .eq('active', true)

  if (error) {
    throw new Error(`getKnowledgeStats failed: ${error.message}`)
  }

  const { data: recent } = await supabase
    .from('bot_knowledge')
    .select('id, topic, updated_at')
    .order('updated_at', { ascending: false })
    .limit(5)

  return {
    total: count,
    recent: recent || []
  }
}