-- Add language column to bot_knowledge for multilingual support
-- Phase 3: Knowledge base multilingual

ALTER TABLE bot_knowledge ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'es';
CREATE INDEX IF NOT EXISTS idx_knowledge_language ON bot_knowledge(language) WHERE active = true;