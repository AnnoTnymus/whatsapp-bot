-- bot_knowledge Table - Knowledge Layer Data
-- Added by OpenCode (Rolli) on 2026-04-25

CREATE TABLE IF NOT EXISTS bot_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  source_url TEXT,
  priority INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE bot_knowledge ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
DROP POLICY IF EXISTS "service_role_all_knowledge" ON bot_knowledge;
CREATE POLICY "service_role_all_knowledge" ON bot_knowledge FOR ALL USING (auth.role() = 'service_role');

-- Index for topic queries
CREATE INDEX IF NOT EXISTS idx_knowledge_topic ON bot_knowledge(topic) WHERE active = true;

-- Index for tags search
CREATE INDEX IF NOT EXISTS idx_knowledge_tags ON bot_knowledge USING GIN(tags) WHERE active = true;