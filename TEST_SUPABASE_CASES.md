# Test Cases — Verificar Supabase Persistence

**Objetivo:** Verificar que los datos se guardan correctamente en Supabase  
**Cómo:** Ejecuta cada test case en WhatsApp y verifica los logs + Supabase dashboard

---

## 📋 Test Case 1: Registro de Nombre

### Acciones:
1. Número NUEVO en WhatsApp (ej: 5491155550001)
2. Envía primer mensaje: "Hola"

### Esperado:
- ✅ Bot responde: "¡Ey! 👋 Bienvenido che. ¿Cuál es tu nombre? 🤔"
- ✅ Logs muestren: `[supabase] ✅ State saved for 5491155550001@c.us (step=solicitando_nombre)`

### Verificar en Supabase:
- Abre Supabase → patient_state table
- Busca chat_id = "5491155550001@c.us"
- Verifica:
  - `step` = "solicitando_nombre" ✅
  - `nombre` = NULL (todavía no)
  - `last_greeting_at` = timestamp reciente ✅

---

## 📋 Test Case 2: Guardar Nombre en Members

### Acciones (continuación del TC1):
1. Envía nombre: "Juan Pérez"

### Esperado:
- ✅ Bot responde: "¡Dale, Juan Pérez! 🎉 Gracias por venir..."
- ✅ Logs: `[supabase] ✅ State saved for ... (step=recibiendo_documentos)`

### Verificar en Supabase:
**patient_state table:**
- chat_id = "5491155550001@c.us"
- `nombre` = "Juan Pérez" ✅
- `step` = "recibiendo_documentos" ✅
- `last_message_at` = timestamp reciente ✅

**members table:**
- chat_id = "5491155550001@c.us"
- `nombre` = "Juan Pérez" ✅
- `completed_at` = timestamp ✅

---

## 📋 Test Case 3: Rechazo de Documento Extranjero

### Acciones:
1. Envía foto de cédula uruguaya 🇺🇾

### Esperado en Logs:
```
[webhook] Detectado: tipo=DOCUMENTO_EXTRANJERO, ambosSides=false, valido=true, pais=Uruguay
[webhook] DOCUMENTO_EXTRANJERO rechazado para 5491155550001@c.us
```

### Esperado en WhatsApp:
- ✅ Bot responde: "Ey che 🛑 Ese documento no es argentino..."

### Verificar en Supabase:
- patient_state NO debe tener documentos guardados
- `step` sigue siendo "recibiendo_documentos" ✅

---

## 📋 Test Case 4: Documento Válido Guardado

### Acciones:
1. Envía foto de DNI argentino frente

### Esperado en Logs:
```
[webhook] Detectado: tipo=DNI, ambosSides=false, valido=true, pais=Argentina
[webhook] DNI frente para 5491155550001@c.us
[supabase] ✅ State saved for ... (step=recibiendo_documentos)
```

### Verificar en Supabase:
**patient_state table:**
```json
{
  "documentos": {
    "dni": {
      "frente": {
        "url": "https://...",
        "data": {...}
      },
      "dorso": null
    },
    "reprocann": {...}
  }
}
```
✅ Documento frente guardado

---

## 📋 Test Case 5: Persistencia Después de Deploy

### Acciones:
1. Envía DNI frente (del TC4)
2. Bot responde: "Dale, recibido 📍 Todavía necesito: REPROCANN frente..."
3. **Redeploy Render** (Settings → Manual Deploy)
4. Espera 2 min a que termine
5. Envía DNI dorso

### Esperado:
- ✅ Bot responde: "Dale, recibido 📍 Todavía necesito: REPROCANN..."
- ✅ Bot RECUERDA que ya tiene DNI frente (no lo pide dos veces)

### Logs clave:
```
[supabase] ✅ State saved for ... (step=recibiendo_documentos)
[webhook] Detectado: tipo=DNI, ambosSides=false, valido=true, pais=Argentina
[webhook] DNI dorso para ...
```

**Si falla**: El servidor no está leyendo de Supabase. Check:
- `SUPABASE_URL` en Render env vars
- `SUPABASE_SERVICE_ROLE_KEY` en Render env vars
- `SUPABASE_ANON_KEY` solo si audio/STT está habilitado
- Tablas existen en Supabase

---

## 📋 Test Case 6: Flujo Completo

### Acciones:
1. Número NUEVO (ej: 5491166660002)
2. Texto: "Hola"
3. Espera saludo
4. Envía nombre: "María López"
5. Envía DNI frente
6. Envía DNI dorso
7. Envía REPROCANN frente
8. Envía REPROCANN dorso
9. Envía datos faltantes (si los pide)

### Esperado Final:
- ✅ Bot responde: "✅ ¡Listo boludo! 🎉 Ya está todo..."
- ✅ Email enviado al admin

### Verificar en Supabase:

**patient_state:**
- `step` = "completado" ✅
- `nombre` = "María López" ✅
- `documentos` = todos 4 lados guardados ✅
- `last_message_at` = ahora ✅

**members:**
- `nombre` = "María López" ✅
- `dni` = datos del DNI ✅
- `tipo_paciente` = dato de REPROCANN ✅
- `reprocann_vencimiento` = fecha ✅

---

## 🔍 Cómo Inspeccionar en Supabase

1. Abre https://app.supabase.com
2. Proyecto ujlgicmuktpqxuulhhwm
3. **Editor** (lado izquierdo)
4. Click en tabla (ej: patient_state)
5. Busca por chat_id o nombre

### Ver SQL directamente:
```sql
SELECT * FROM patient_state 
WHERE chat_id = '5491155550001@c.us';

SELECT * FROM members 
WHERE nombre LIKE 'Juan%';
```

---

## ❌ Troubleshooting

### "No veo datos guardados en Supabase"
1. ¿Corriste el SUPABASE_SCHEMA.sql? (Crear tablas)
2. ¿Están las env vars en Render?
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY
   - SUPABASE_ANON_KEY si audio/STT está habilitado
3. Revisa los logs:
   - `[supabase] ⚠️ Supabase NOT CONFIGURED` = env vars faltando
   - `[supabase] ❌ ERROR` = tabla no existe o error de DB

### "Los datos se guardan pero desaparecen al redeploy"
→ El código está fallando en loadState(). Check:
- ¿La tabla tiene los campos nuevos (last_message_at, last_greeting_at)?
- ¿Los tipos de datos son correctos (TIMESTAMPTZ)?

### "El bot repite el saludo dos veces"
→ last_greeting_at no se está guardando. Check:
- ¿El campo existe en patient_state?
- ¿El código está asignando state.last_greeting_at?

---

## ✅ Checklist Final

- [ ] TC1: Nombre solicitado y guardado
- [ ] TC2: Nombre en members
- [ ] TC3: Documento extranjero rechazado
- [ ] TC4: DNI válido guardado
- [ ] TC5: Persiste después de redeploy
- [ ] TC6: Flujo completo a "completado"
- [ ] Logs muestran "✅" para saves
- [ ] Sin mensajes "⚠️ NOT CONFIGURED"
- [ ] Sin logs de error en Supabase

---

**Status:** [Pending] Listo para ejecutar cuando esté desplegado ✅
