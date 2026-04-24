-- WhatsApp Bot Config Table
-- Added by OpenCode (Rolli) on 2026-04-24

CREATE TABLE IF NOT EXISTS bot_config (
  id TEXT PRIMARY KEY DEFAULT 'whatsapp_bot',
  club_nombre TEXT DEFAULT 'The Panda Club',
  club_ubicacion TEXT DEFAULT 'Palermo, Buenos Aires',
  horarios TEXT DEFAULT 'Lunes a viernes 9 a 17hs',
  geneticas TEXT DEFAULT 'Amnesia Haze, AK-47, Critical+, OG Kush, Strawberry',
  reprocann_url TEXT DEFAULT 'https://www.argentina.gob.ar/seguridad/reprocann',
  respuesta_saludo TEXT DEFAULT '¡Hola! 👋 Bienvenido/a al club. ¿Cuál es tu nombre?',
  respuesta_confirmacion TEXT DEFAULT 'Una persona te va a contactar pronto.',
  respuesta_error TEXT DEFAULT 'Tuve un problema. ¿Podés escribirlo?',
  modelo_ia TEXT DEFAULT 'claude-opus-4-7',
  max_tokens INTEGER DEFAULT 500,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default config if not exists
INSERT INTO bot_config (id) VALUES ('whatsapp_bot') ON CONFLICT DO NOTHING;

-- Enable RLS
ALTER TABLE bot_config ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
DROP POLICY IF EXISTS "service_role_all_config" ON bot_config;
CREATE POLICY "service_role_all_config" ON bot_config FOR ALL USING (auth.role() = 'service_role');

-- Allow anon read for admin dashboard
DROP POLICY IF EXISTS "anon_read_config" ON bot_config;
CREATE POLICY "anon_read_config" ON bot_config FOR SELECT USING (true);