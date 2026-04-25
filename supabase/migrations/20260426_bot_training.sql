-- bot_training Table - Training examples storage
-- Added by OpenCode (Rolli) on 2026-04-26

CREATE TABLE IF NOT EXISTS bot_training (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT NOT NULL,
  user_msg TEXT NOT NULL,
  bot_reply TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bot_training ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_training" ON bot_training FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX idx_training_score ON bot_training(score);
CREATE INDEX idx_training_chat_id ON bot_training(chat_id);