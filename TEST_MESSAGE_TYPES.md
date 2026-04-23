# Test: Diferentes Tipos de Mensajes WhatsApp

**Objetivo:** Verificar que el bot maneja correctamente todos los tipos de mensajes que WhatsApp puede enviar

---

## 📱 Tipos de Mensajes Soportados

### 1️⃣ Text Message (`textMessage`)
**Qué es:** Mensaje de texto simple

**Test:**
```
Usuario envía: "Hola che"
Esperado: Bot responde con tono casual rioplatense
Logs: [webhook] De: Tincho (chat_id) | "Hola che"
```

**Edge cases:**
- [ ] Muy largo (>1000 chars) → no se corta la respuesta
- [ ] Solo emojis → respuesta casual
- [ ] Mensaje vacío → se ignora
- [ ] Con caracteres especiales (á, é, ñ) → se procesa bien

---

### 2️⃣ Image Message (`imageMessage`)
**Qué es:** Foto/imagen

**Test casos:**
```
1. DNI argentino frente
   Esperado: Detecta, guarda, pide dorso

2. Cédula uruguaya
   Esperado: Rechaza con "Ey che 🛑 Ese documento no es argentino"
   Logs: [webhook] tipo=DOCUMENTO_EXTRANJERO, pais=Uruguay

3. Foto borrosa/desenfocada
   Esperado: Pide "con mejor luz"
   Logs: [webhook] valido=false

4. Meme/foto random
   Esperado: Respuesta casual humorstica
   Logs: [detect] tipo=OTRO
```

---

### 3️⃣ Sticker Message (`stickerMessage`)
**Qué es:** Sticker/emoji grande

**Test:**
```
Usuario envía: [sticker]
Esperado: Respuesta humorística casual
Ejemplos:
- "Jaja che 😄 Buen sticker pero necesito tus documentos"
- "Boludo, me encantó 👍 Pero ahora necesito que me pases los papeles"
```

**Logs:**
```
[webhook] Imagen recibida de Tincho (chat_id)
[webhook] Detectado: tipo=OTRO
[webhook] RESPUESTA_FUERA_FLUJO: sticker
```

---

### 4️⃣ Reaction Message (`reactionMessage`)
**Qué es:** Reacción emoji a un mensaje anterior

**Test:**
```
Usuario reacciona: 👍 ❤️ 🔥 a un mensaje del bot
Esperado: Respuesta casual agradecimiento
Ejemplos:
- "Gracias boludo! 🙏 ¿Me pasas el REPROCANN? 📋"
- "¡Dale! 💪 ¿Tenés los documentos a mano che?"
```

---

### 5️⃣ Emoji-only Message
**Qué es:** Mensaje que es SOLO emojis

**Test:**
```
Usuario envía: "🔥🔥🔥" o "😄😄"
Esperado: Respuesta casual casual
Ejemplos:
- "🤝 Te entiendo boludo. Ahora anda, mandame los documentos che"
- "✨ Eso suena bien, pero necesito que me pases el REPROCANN 📄"
```

**Regex que lo detecta:**
```javascript
/^[\p{Emoji}\s]+$/u.test("🔥🔥") // true
```

---

## ✅ Flujo Completo por Tipo

### Scenario: Nuevo usuario full journey

```
1. TEXTMESSAGE
   User: "Hola"
   Bot: "¡Ey! 👋 Bienvenido che. ¿Cuál es tu nombre? 🤔"
   → Saves state: step=solicitando_nombre

2. TEXTMESSAGE (nombre)
   User: "Juan"
   Bot: "¡Dale, Juan! 🎉 Gracias por venir..."
   → Saves state: step=recibiendo_documentos, nombre=Juan, inserta en members

3. IMAGEMESSAGE (DNI frente)
   User: [foto DNI argentino]
   Bot: "Dale, recibido 📍 Todavía necesito: DNI dorso, REPROCANN..."
   → Saves state: documentos.dni.frente, step=recibiendo_documentos

4. TEXTMESSAGE (casualidad, en medio)
   User: "che q onda"
   Bot: Lo ignora o responde casual por askClaude

5. STICKERMESSAGE
   User: [sticker funny]
   Bot: "Jaja che 😄 Buen sticker pero necesito tus documentos"
   → No guarda, solo responde

6. IMAGEMESSAGE (DNI dorso)
   User: [foto DNI dorso]
   Bot: "Dale, recibido 📍 Todavía necesito: REPROCANN frente, REPROCANN dorso"
   → Saves state: documentos.dni.dorso

7. REACTIONMESSAGE
   User: [reacción 👍 a un mensaje anterior]
   Bot: "Gracias boludo! 🙏 ¿Me pasas el REPROCANN? 📋"
   → No guarda, solo responde

8. IMAGEMESSAGE (REPROCANN frente)
   User: [foto REPROCANN frente]
   Bot: "Dale, recibido 📍 Todavía necesito: REPROCANN dorso"
   → Saves state: documentos.reprocann.frente

9. TEXTMESSAGE (datos faltantes si es necesario)
   User: "Buenos Aires"
   Bot: "Boludo, gracias 🙏 Ahora contame provincia?"
   → Saves state: collectedData

10. IMAGEMESSAGE (REPROCANN dorso)
    User: [foto REPROCANN dorso]
    Bot: "✅ ¡Listo boludo! 🎉 Ya está todo. Te contactamos en un ratito 💯"
    → Saves state: step=completado, inserta/actualiza members
```

---

## 🔍 Logs Esperados por Tipo

### textMessage
```
[webhook] De: Tincho (59892499463@c.us) | "Hola"
[webhook] Detectado tipo: textMessage
[supabase] State saved for 59892499463@c.us (step=...)
```

### imageMessage
```
[webhook] messageData: {"typeMessage":"imageMessage",...}
[webhook] Imagen recibida de Tincho (59892499463@c.us)
[webhook] Detectado: tipo=DNI, ambosSides=false, valido=true, pais=Argentina
[detect] Detectado: tipo=DNI, ambosSides=false, valido=true, pais=Argentina
[claude] Análisis: ✅ Recibido.
[supabase] ✅ State saved for 59892499463@c.us
```

### stickerMessage
```
[webhook] Imagen recibida de Tincho (59892499463@c.us)
[webhook] messageType=stickerMessage
[webhook] RESPUESTA_FUERA_FLUJO: [random sticker response]
```

### reactionMessage
```
[webhook] messageType=reactionMessage
[webhook] RESPUESTA_FUERA_FLUJO: [random reaction response]
```

### emoji-only
```
[webhook] De: Tincho | "🔥🔥"
[webhook] Emoji-only message detected
[webhook] RESPUESTA_FUERA_FLUJO: [random emoji response]
```

---

## 📋 Checklist de Testing

- [ ] Text: "Hola" → saludo
- [ ] Text: Nombre → guardado ✅
- [ ] Image: DNI argentino → aceptado ✅
- [ ] Image: Cédula uruguaya → rechazado ✅
- [ ] Image: Foto borrosa → pide mejor luz ✅
- [ ] Image: Meme/random → respuesta casual ✅
- [ ] Sticker → respuesta casual ✅
- [ ] Reaction (👍) → respuesta casual ✅
- [ ] Emoji-only (🔥🔥) → respuesta casual ✅
- [ ] Texto especial (á, é, ñ) → se procesa ✅
- [ ] Texto muy largo (>1000 chars) → responde sin cortes ✅
- [ ] Mensaje vacío → se ignora ✅
- [ ] Redeploy en medio → persiste estado ✅

---

**Estado:** Ready to test en ambiente vivo ✅
