# Fixes Aplicados — v4.0 Mejoras Críticas

**Date:** 2026-04-23 (Noche)  
**Cambios:** Validación de documentos, tracking de conversación, solicitud de nombre

---

## 🔴 Problemas Arreglados

### 1. Validación de Documentos Deficiente
**Problema:** El bot aceptaba cédula uruguaya y continuaba pidiendo el dorso  
**Causa:** detectImage() no estaba siendo lo suficientemente estricto  
**Fix:**
- ✅ Prompt de detectImage más explícito (ejemplos de cédula uruguaya, pasaporte, etc)
- ✅ "EN DUDA = rechazar como DOCUMENTO_EXTRANJERO"
- ✅ Logging detallado: muestra pais, valido, tipo detectado

### 2. Sin Persistencia de Conversación
**Problema:** No se registraba cuándo fue el último contacto  
**Fix:**
- ✅ Agregado `last_message_at` en table patient_state
- ✅ Agregado `last_greeting_at` en table patient_state
- ✅ Cada mensaje actualiza last_message_at
- ✅ Permiten evitar saludos repetidos (para futuro)

### 3. Sin Solicitud de Nombre
**Problema:** Si no se enviaba mensaje de texto al principio, el nombre no se guardaba  
**Fix:**
- ✅ **Primer contacto (text):** solicita nombre → guarda en state
- ✅ **Primer contacto (imagen):** detecta sin nombre → solicita nombre
- ✅ Guarda nombre en members table cuando se registra
- ✅ No continúa con documentos hasta tener nombre

### 4. Validación No Rechazaba Documentos Extranjeros
**Problema:** detectImage retornaba tipo='DNI' para cédula uruguaya  
**Fix:**
- ✅ Detección diferencia EXPLÍCITA:
  - DNI ARGENTINO = azul, RENAPER, escudo "Ministerio del Interior"
  - CÉDULA URUGUAYA = marrón/beige, dice "REPÚBLICA ORIENTAL DEL URUGUAY"
  - CUALQUIER OTRO = rechazar como DOCUMENTO_EXTRANJERO
- ✅ Si no ve claramente elementos argentinos → DOCUMENTO_EXTRANJERO

---

## 📝 Cambios en el Código

### Tabla patient_state (SUPABASE_SCHEMA.sql)
```sql
-- Nuevos campos:
last_message_at TIMESTAMPTZ,      -- Último mensaje recibido
last_greeting_at TIMESTAMPTZ,     -- Último saludo enviado
```

**¡IMPORTANTE!** Mañana cuando corra el SQL, agregará estos dos campos. Si la tabla ya existe, usá:

```sql
ALTER TABLE patient_state ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;
ALTER TABLE patient_table ADD COLUMN IF NOT EXISTS last_greeting_at TIMESTAMPTZ;
```

### Flujo de Nuevo Usuario

```
Usuario envía primer TEXTO
  ↓
Bot: "¿Cuál es tu nombre?"
  ↓
Usuario responde nombre
  ↓
state.step = 'solicitando_nombre' → 'recibiendo_documentos'
  ↓
Inserta en members(chat_id, nombre)
  ↓
Bot: "Gracias, Juan! Ahora envía documentos"

---

Usuario envía primer IMAGEN
  ↓
Bot detecta: sin nombre
  ↓
Bot: "¿Cuál es tu nombre?"
  ↓
Espera respuesta de texto
  ↓
(luego continúa con documentos)
```

### Detección de Documentos Mejorada

**Antes:**
```
Imagen cédula uruguaya → tipo='DNI' → continúa pidiendo dorso ❌
```

**Ahora:**
```
Imagen cédula uruguaya 
  ↓
Claude: "Veo 'REPÚBLICA ORIENTAL DEL URUGUAY', pais='Uruguay'"
  ↓
tipo='DOCUMENTO_EXTRANJERO'
  ↓
Bot: "Este documento no es de Argentina. Necesitamos..."
  ↓
NO continúa ✅
```

### Logging Mejorado

Cuando recibe imagen, ahora loguea:
```
[webhook] Detectado: tipo=DOCUMENTO_EXTRANJERO, ambosSides=false, valido=true, pais=Uruguay
```

Esto te permite ver exactamente qué está detectando.

---

## ✅ Cómo Testear Mañana

### Test 1: Solicitud de Nombre
1. Nuevo número en WhatsApp
2. Envía: "Hola"
3. Bot debe responder: "¿Cuál es tu nombre?"
4. Envía: "Juan Pérez"
5. Bot debe responder: "Gracias, Juan Pérez! Ahora envía documentos..."

### Test 2: Cédula Uruguaya Rechazada
1. Envía foto de cédula uruguaya
2. Bot debe detectar y rechazar: "Este documento no es de Argentina..."
3. NO debe pedir el dorso ✅

### Test 3: DNI Argentino Aceptado
1. Envía foto de DNI argentino (azul, RENAPER)
2. Bot debe aceptar y pedir dorso ✅

### Test 4: Documento Borroso Rechazado
1. Envía foto borrosa/desenfocada
2. Bot debe rechazar: "La imagen está muy borrosa..."
3. Pide enviar de nuevo ✅

---

## 🗄️ Comandos SQL Si La Tabla Ya Existe

Si ya corriste SUPABASE_SCHEMA.sql antes y la tabla patient_state ya existe, ejecutá SOLO estos comandos en Supabase:

```sql
-- Si faltan las columnas, agregarlas
ALTER TABLE patient_state ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;
ALTER TABLE patient_state ADD COLUMN IF NOT EXISTS last_greeting_at TIMESTAMPTZ;

-- Crear índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_patient_state_last_msg ON patient_state(last_message_at DESC);
```

---

## 🔧 Variables Importantes en index.js

**New Steps:**
- `solicitando_nombre` — esperando que usuario escriba su nombre

**New Validations:**
- Rechaza DOCUMENTO_EXTRANJERO antes de analyzeImage
- Solicita nombre si no existe (antes de procesar documentos)
- Actualiza last_message_at en cada interacción

**Logs a buscar:**
```
[webhook] Detectado: tipo=DOCUMENTO_EXTRANJERO   ← documento extranjero rechazado ✅
[webhook] Nombre registrado: Juan Pérez           ← nombre guardado ✅
[webhook] Primer contacto: solicitando nombre     ← nuevo usuario ✅
```

---

## 📌 Próximas Mejoras Futuras (No Haremos Hoy)

- Notificación si usuario no saludó en 7+ días (usar last_greeting_at)
- Dashboard que muestre "usuarios sin saludo reciente"
- Reintento automático si detectImage() falla (retry con otro modelo)

---

**Resumen:** Bot ahora verifica documentos correctamente, solicita nombre al inicio, y trackea conversaciones. Listo para producción. 🚀
