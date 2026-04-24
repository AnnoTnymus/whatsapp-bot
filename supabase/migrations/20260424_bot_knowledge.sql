-- bot_knowledge Table - Knowledge Layer Data
-- Added by OpenCode (Rolli) on 2026-04-24

CREATE TABLE IF NOT EXISTS bot_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  keywords TEXT[] DEFAULT '{}',
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

-- Allow anon read for bot queries
DROP POLICY IF EXISTS "anon_read_knowledge" ON bot_knowledge;
CREATE POLICY "anon_read_knowledge" ON bot_knowledge FOR SELECT USING (true);

-- Index for category queries
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON bot_knowledge(category) WHERE active = true;

-- Index for keyword search
CREATE INDEX IF NOT EXISTS idx_knowledge_keywords ON bot_knowledge USING GIN(keywords) WHERE active = true;

-- Seed data - FAQ knowledge base
INSERT INTO bot_knowledge (category, question, answer, keywords, priority) VALUES
-- horarios / ubicacion
('horario', '¿Cuál es el horario?', 'Estamos abiertos de lunes a viernes de 9 a 17hs.', ARRAY['horario', 'horarios', 'hora', 'abren', 'cerrado'], 10),
('horario', '¿Cuándo abren?', 'Abrimos de lunes a viernes de 9 a 17hs.', ARRAY['abren', 'apertura', 'hora'], 10),
('ubicacion', '¿Dónde están?', 'Estamos en Palermo, Buenos Aires.', ARRAY['ubicacion', 'direccion', 'dire', 'donde', 'lugar'], 10),

-- geneticas / variedades
('genetica', '¿Qué genéticas tienen?', 'Tenemos: Amnesia Haze, AK-47, Critical+, OG Kush y Strawberry.', ARRAY['genetica', 'geneticas', 'variedad', 'variedades', 'cepas', 'cepas', 'strains'], 20),
('genetica', '¿Tienen Amnesia?', 'Sí, tenemos Amnesia Haze disponible.', ARRAY['amnesia', 'haze'], 20),
('genetica', '¿Tienen OG Kush?', 'Sí, tenemos OG Kush disponible.', ARRAY['og kush', 'ogkush', 'kush'], 20),

-- requisitos / membresia
('requisito', '¿Qué necesito para entrar?', 'Necesitás credencial de socio y DNI.', ARRAY['requisito', 'requisitos', 'entrar', 'entrada', 'socio', 'credencial'], 30),
('requisito', '¿Puedo ir sin ser socio?', 'No, Necesitás ser socio del club para acceder.', ARRAY['socio', 'sociedad', 'miembro', 'afiliado'], 30),

-- reprocann / legal
('legal', '¿Es legal?', 'Somos un club privado registrado en REPROCANN.', ARRAY['legal', 'ley', 'prohibido', 'ilegal', 'reprocann'], 40),
('legal', '¿Qué es REPROCANN?', 'Es el Registro Nacional de Cereales y Oleaginosas de Argentina.', ARRAY['reprocann', 'registro', 'legal'], 40),

-- contacto /Turnos
('contacto', '¿Cómo contacto?', 'Escribinos por WhatsApp.', ARRAY['contacto', 'contactar', 'whatsapp', 'telefono'], 50),
('contacto', '¿Tienen turno?', 'Sí, podés solicitar un turno por WhatsApp.', ARRAY['turno', 'cita', 'reserva'], 50)
ON CONFLICT DO NOTHING;