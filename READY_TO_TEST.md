# 🚀 READY TO TEST — Bot v4.0

**Status:** ✅ Código desplegado en Render  
**Tono:** ✅ Rioplatense casual con emojis  
**Supabase:** ✅ Tablas creadas, persistencia activa  
**Documento:** ✅ Validación de IDs argentinos  

---

## 📋 Tareas de Testing (Ejecuta en orden)

### Tarea 1: Verificar Supabase Persistence
**Documento:** `TEST_SUPABASE_CASES.md`

Ejecuta los 6 test cases:
1. [ ] TC1: Registro de nombre
2. [ ] TC2: Guardar en members
3. [ ] TC3: Rechazar documento extranjero
4. [ ] TC4: Guardar DNI válido
5. [ ] TC5: Persistencia post-deploy
6. [ ] TC6: Flujo completo

**Verificación:**
- Entra a Supabase → patient_state table
- Verifica que los datos se guardan ✅
- Sin errores `[supabase]` en logs ✅

**Logs esperados:**
```
[supabase] ✅ State saved for chat_id (step=...)
[supabase] ✅ Estado guardado correctamente
```

---

### Tarea 2: Verificar Tipos de Mensajes
**Documento:** `TEST_MESSAGE_TYPES.md`

Ejecuta con 1 número de WhatsApp nuevo:
1. [ ] Envía texto: "Hola" → bot pide nombre
2. [ ] Envía nombre: "Juan" → guardado en members ✅
3. [ ] Envía DNI argentino frente → aceptado ✅
4. [ ] Envía DNI dorso → detecta ambos lados ✅
5. [ ] Envía REPROCANN frente → aceptado ✅
6. [ ] Envía REPROCANN dorso → OK, pide campos si faltan ✅
7. [ ] Envía sticker → respuesta casual ✅
8. [ ] Envía emojis solo (🔥🔥) → respuesta casual ✅
9. [ ] Envía foto random (meme) → respuesta humorística ✅

**Verificación:**
- Bot responde con tono "boludo", "che", emojis ✅
- Datos se guardan en Supabase ✅
- Sin doble saludo ✅

---

### Tarea 3: Verificar Rechazo de Documentos Extranjeros
**Documento:** `TEST_SUPABASE_CASES.md` (TC3)

Con 1 número nuevo:
1. [ ] Envía DNI pero de **cédula uruguaya** 🇺🇾
2. [ ] Bot debe rechazar: "Ey che 🛑 Ese documento no es argentino"
3. [ ] Log debe mostrar: `tipo=DOCUMENTO_EXTRANJERO, pais=Uruguay`
4. [ ] **NO** debe pedir el dorso ✅
5. [ ] Bot debe pedir documentos argentinos nuevamente ✅

**Verificación:**
- Logs claros mostrando detección de país ✅
- Rechazo inmediato sin continuar ✅

---

### Tarea 4: Flujo Completo End-to-End
**Documento:** `TEST_SUPABASE_CASES.md` (TC6)

Con 1 número completamente nuevo:
1. [ ] Texto "Hola" → pide nombre
2. [ ] Nombre "Test User" → guarda
3. [ ] Todos los 4 documentos → proceso completo
4. [ ] Datos faltantes (provincia, etc) → los pide
5. [ ] Usuario responde → guarda
6. [ ] Completa → mensaje final "¡Listo boludo! 🎉"
7. [ ] Email llegó al admin ✅
8. [ ] Supabase tiene todos los datos:
   - patient_state: completado ✅
   - members: con todos los campos ✅

---

### Tarea 5: Persistencia Post-Redeploy
**Documento:** `TEST_SUPABASE_CASES.md` (TC5)

1. [ ] Envía DNI frente
2. [ ] Bot reconoce y responde correctamente
3. [ ] Redeploy manual en Render
4. [ ] Espera 2 min a que termine
5. [ ] Envía DNI dorso
6. [ ] Bot responde recordando que ya tiene frente ✅
7. [ ] NO pide DNI frente de nuevo ✅

**Verificación:**
- Bot carga datos de Supabase sin problemas
- Sin dobles solicitudes
- `[supabase]` logs muestran load correcto

---

## 📊 Estado Actual

| Feature | Status | Verificado |
|---------|--------|-----------|
| Persistencia Supabase | ✅ Código listo | [ ] Test |
| Tono rioplatense | ✅ Implementado | [ ] Test |
| Emojis (1 c/100 chars) | ✅ Agregados | [ ] Test |
| Validación documentos | ✅ Mejorada | [ ] Test |
| Rechazo extranjeros | ✅ Código | [ ] Test |
| Solicitar nombre | ✅ Implementado | [ ] Test |
| Salvo doble saludo | ✅ Fixed | [ ] Test |
| Diferentes msg types | ✅ Soportados | [ ] Test |

---

## 🔍 Cómo Revisar Logs

### En Render Dashboard:
1. Abre https://dashboard.render.com
2. Selecciona el servicio "whatsapp-bot"
3. Tab "Logs"
4. Busca los logs más recientes

### Logs importantes:
```
✅ [supabase] State saved
❌ [supabase] ⚠️ Supabase NOT CONFIGURED
❌ [supabase] ❌ ERROR
✅ [webhook] Detectado: tipo=...
✅ [detect] Detectado: tipo=...
```

---

## ⚡ Quick Checklist

Antes de empezar a testear:

- [ ] Render dashboard muestra logs ✅
- [ ] Supabase tables existen (patient_state, members) ✅
- [ ] Bot está respondiendo en WhatsApp ✅
- [ ] SUPABASE_URL en env vars ✅
- [ ] SUPABASE_SERVICE_ROLE_KEY en env vars ✅
- [ ] SUPABASE_ANON_KEY en env vars si audio/STT está habilitado ✅
- [ ] UptimeRobot pinging /health ✅

---

## 📞 Si Algo Falla

### "Bot no responde"
→ Revisar Render logs: busca `[error]`

### "Datos no se guardan en Supabase"
→ Revisar logs: `[supabase] ⚠️ NOT CONFIGURED`
→ Verificar env vars en Render

### "Bot acepta cédula uruguaya"
→ Revisar logs: `tipo=DNI` (debería ser `tipo=DOCUMENTO_EXTRANJERO`)
→ Contactame, necesita fix en detectImage

### "Bot repite saludo dos veces"
→ Revisar que last_greeting_at se está guardando
→ Supabase: verificar columna existe en patient_state

---

## ✅ Resultado Final Esperado

**Cuando todo esté OK:**
1. Nuevo usuario dice "Hola" → pide nombre
2. Dice nombre → lo guarda en members
3. Envía documentos en cualquier orden → acepta
4. Si envía documento extranjero → rechaza
5. Si faltan datos → pide por texto
6. Todo completo → email al admin + guarda en Supabase
7. Si redeploy → recuerda todo ✅

**Tono:** "¡Dale, Juan! 🎉" / "Boludo, gracias 🙏" / "¿Me pasas el REPROCANN? 📋"

---

**Listo. A testear che!** 🚀

*¿Preguntas? Revisar los documentos de test casos. Si hay error, ver logs en Render.*
