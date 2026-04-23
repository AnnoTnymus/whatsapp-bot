-- WhatsApp Bot v4.0 — Supabase Schema
-- Run all SQL statements in Supabase SQL Editor
-- Database: ujlgicmuktpqxuulhhwm
-- Created: 2026-04-23

---
--- TABLE 1: patient_state (replaces in-memory userState Map)
---

CREATE TABLE IF NOT EXISTS patient_state (
  chat_id TEXT PRIMARY KEY,
  nombre TEXT,
  step TEXT DEFAULT 'inicio',
  documentos JSONB DEFAULT '{
    "dni": {"frente": null, "dorso": null},
    "reprocann": {"frente": null, "dorso": null}
  }',
  collected_data JSONB DEFAULT '{}',
  pending_fields JSONB DEFAULT '[]',
  last_message_at TIMESTAMPTZ,
  last_greeting_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patient_state_step ON patient_state(step);
CREATE INDEX idx_patient_state_updated ON patient_state(updated_at);

---
--- TABLE 2: conversation_history (replaces conversationHistory Map)
---

CREATE TABLE IF NOT EXISTS conversation_history (
  chat_id TEXT PRIMARY KEY,
  messages JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversation_updated ON conversation_history(updated_at);

---
--- TABLE 3: patient_followups (for smart follow-up notifications)
---

CREATE TABLE IF NOT EXISTS patient_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT NOT NULL,
  nombre TEXT,
  motivo TEXT,  -- 'sin_reprocann' | 'tramitando' | 'docs_incompletos' | 'inactivo'
  proxima_notificacion TIMESTAMPTZ NOT NULL,
  intentos INT DEFAULT 0,
  status TEXT DEFAULT 'pendiente',  -- 'pendiente' | 'completado' | 'cancelado'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_followups_status ON patient_followups(status);
CREATE INDEX idx_followups_proxima ON patient_followups(proxima_notificacion);
CREATE INDEX idx_followups_chat_id ON patient_followups(chat_id);

---
--- TABLE 4: members (CRM — future campaigns: renewal, outbound, retention)
---

CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  dni TEXT,
  tipo_paciente TEXT,          -- 'autocultivador' | 'club' | 'otra'
  provincia TEXT,
  localidad TEXT,
  direccion TEXT,
  reprocann_vencimiento DATE,  -- 🔑 enables REPROCANN renewal campaigns
  limite_transporte TEXT,
  estado_autorizacion TEXT,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  notas TEXT,                  -- free field for admin notes
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_members_chat_id ON members(chat_id);
CREATE INDEX idx_members_vencimiento ON members(reprocann_vencimiento);
CREATE INDEX idx_members_provincia ON members(provincia);
CREATE INDEX idx_members_tipo ON members(tipo_paciente);

---
--- COMMENTS (optional, for documentation)
---

COMMENT ON TABLE patient_state IS 'Current state of each user in onboarding flow. Replaces in-memory userState Map.';
COMMENT ON COLUMN patient_state.step IS 'Flow step: inicio | recibiendo_documentos | completando_datos | completado';
COMMENT ON COLUMN patient_state.documentos IS 'JSON object with dni and reprocann, each with frente and dorso URLs';

COMMENT ON TABLE patient_followups IS 'Automatic follow-up notifications. Cron checks proxima_notificacion every 15 min.';
COMMENT ON COLUMN patient_followups.motivo IS 'Reason for follow-up: sin_reprocann | tramitando | docs_incompletos | inactivo';

COMMENT ON TABLE members IS 'Completed members CRM. Enables: REPROCANN renewal (vencimiento), outbound campaigns, analytics.';
COMMENT ON COLUMN members.reprocann_vencimiento IS 'CRITICAL: enables renewal campaigns 30/60 days before expiry';

---
--- RLS POLICIES (disable for anon key, or restrict as needed)
---

ALTER TABLE patient_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE patient_followups DISABLE ROW LEVEL SECURITY;
ALTER TABLE members DISABLE ROW LEVEL SECURITY;

---
--- DONE
---

-- Copy-paste these commands into Supabase SQL Editor (https://app.supabase.com)
-- Navigate to: SQL Editor → New Query → paste all
-- Click Run
-- Expected output: "success"
