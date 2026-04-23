# WhatsApp Bot v4.0 — Setup para Mañana

## ✅ Lo que ya está HECHO

- ✅ Código completo en `index.js` con todas las fases
- ✅ `FORMULARIO_CLIENTE.md` creado (para enviar al cliente por email)
- ✅ `SUPABASE_SCHEMA.sql` listo para correr
- ✅ `@supabase/supabase-js` instalado (npm install listo)
- ✅ Supabase persistence (Fase 2) — reemplaza Maps en memoria
- ✅ Document validation (Fase 6) — rechaza documentos extranjeros/borrosos
- ✅ Off-flow responses (Fase 7) — respuestas humorísticas para stickers/emojis
- ✅ Follow-up cron (Fase 3) — cada 15 min envía notificaciones automáticas
- ✅ Test routes (Fase 5) — `/test/seed-followups` + `/test/run-cron`
- ✅ CRM members table (Fase 4) — inserta datos para campañas futuras
- ✅ Dynamic tokens (Fase 4) — presupuestos inteligentes por tipo de mensaje

---

## 🔧 LO QUE NECESITÁS HACER MAÑANA

### Paso 1: Crear las Tablas en Supabase (5 min)

1. Abre **Supabase Dashboard** → [https://app.supabase.com](https://app.supabase.com)
2. Selecciona el proyecto: `ujlgicmuktpqxuulhhwm`
3. Abre **SQL Editor** (lado izquierdo)
4. Copia TODO el contenido de `SUPABASE_SCHEMA.sql`
5. Pégalo en el editor
6. Clickea **Run** (botón azul)
7. Espera a que termine ✅

**Resultado esperado:** 4 tablas creadas (patient_state, conversation_history, patient_followups, members)

---

### Paso 2: Verificar Variables de Entorno en Render (2 min)

**Ya están agregadas:**
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

**Verificar en:** Render Dashboard → Settings → Environment Variables

---

### Paso 3: Deploy a Render (1 min)

```bash
cd G:/Dev/whatsapp-bot
git add -A
git commit -m "feat: v4.0 — Supabase persistence, smart notifications, document validation"
git push origin master
```

Render se redeploya automáticamente. Espera 1-2 min.

---

### Paso 4: Test de Persistencia (5 min)

1. **Abrir WhatsApp** y enviar al bot:
   - Una imagen de REPROCANN frente
   - Bot debe responder con confirmación
   
2. **Redeploy manual en Render:**
   - Dashboard → Deployments → Manual Deploy
   
3. **Continuar conversación en WhatsApp:**
   - Enviar REPROCANN dorso
   - El bot debe RECORDAR el frente que enviaste antes ✅ (si no lo recuerda, Supabase no está sincronizado)

---

### Paso 5: Test de Notificaciones (10 min)

Abre dos pestañas:

**Pestaña 1:** http://localhost:3000/test/seed-followups?chat=5491100000000@c.us
- Devuelve `{"ok":true,"seeded":5}`

**Pestaña 2:** http://localhost:3000/test/run-cron
- Devuelve `{"ok":true,"message":"Cron ejecutado manualmente"}`

**En WhatsApp:** Deberías recibir 5 mensajes de diferentes tipos de follow-up

---

### Paso 6: Test de Validación de Documentos (2 min)

Envía al bot:
- ✅ **DNI argentino** → debe continuar con el flujo
- ❌ **Cédula uruguaya** → debe responder con "Necesitamos tu DNI argentino..."
- ❌ **Foto borrosa** → debe pedir "Mandá con mejor luz"
- ❌ **Sticker** → debe responder con una broma
- 🔥 **Solo emojis** → debe responder casual

---

## 📊 Tablas Creadas en Supabase

### `patient_state` (Reemplaza userState Map)
- Persiste el flujo actual de cada usuario
- Guarda documentos, datos recolectados, campos pendientes
- Se actualiza en cada paso del bot

### `conversation_history` (Reemplaza conversationHistory Map)
- Guarda últimos 8 mensajes de cada chat
- Usado para contexto en Claude

### `patient_followups` (Notificaciones automáticas)
- Registros de seguimiento automático
- Cron corre cada 15 min
- 7 tipos de notificaciones según el estado del usuario

### `members` (CRM para campañas futuras)
- Cuando completa el flujo, se inserta aquí
- Campos clave: `reprocann_vencimiento` (para renovación)
- Habilita: segmentación, outbound, reactivación, aniversarios

---

## 🚀 Características v4.0

| Feature | Estado | Testing |
|---------|--------|---------|
| Persistencia en Supabase | ✅ | Redeploy + continuar |
| Validación de documentos argentinos | ✅ | Enviar cédula uruguaya |
| Respuestas humorísticas fuera de flujo | ✅ | Sticker + emoji |
| Cron de notificaciones automáticas | ✅ | `/test/run-cron` |
| CRM members para campañas futuras | ✅ | Completar flujo + Supabase |
| Dynamic token allocation | ✅ | Logs del bot |
| Formulario cliente editable | ✅ | Entregar FORMULARIO_CLIENTE.md |

---

## 📝 Próximos Pasos (Después del Testing)

Cuando esté todo verde:
1. **Deploy a Render** (ya está en git)
2. **Enviar FORMULARIO_CLIENTE.md** al cliente por email
3. **Cliente completa el formulario** → lo reenvía
4. **Tú copias los datos → pegas en knowledge/base.md**
5. **Nuevo deploy** con info del cliente

---

## 🔗 URLs Importantes

- **Supabase Dashboard:** https://app.supabase.com/project/ujlgicmuktpqxuulhhwm
- **Render Dashboard:** https://dashboard.render.com
- **Bot Prod:** https://whatsapp-bot-h85o.onrender.com
- **Health Check:** https://whatsapp-bot-h85o.onrender.com/health

---

## ❓ Si Algo Falla

### Error: "Supabase not configured"
- Verificar env vars en Render: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- Redeploy si son nuevas

### Error: "Table does not exist"
- Verificar que corriste TODO el SQL en Supabase
- Reloadear la página del editor SQL

### Bot no recuerda documentos después de redeploy
- Verificar que saveState() se llamó (buscar logs "[supabase]")
- Revisar que la tabla patient_state tiene datos

### Cron no envía mensajes
- Revisar `/health` → si dice "ok: true"
- Ejecutar `/test/run-cron` manualmente
- Revisar logs en Render → [followup]

---

**Hora de dormir. Mañana testeas todo con calma.** 🌿

*Generated: 2026-04-23*  
*Bot Version: 4.0 (Ready for Delivery)*
