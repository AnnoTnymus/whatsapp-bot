# Task: Mejorar Manejo de Imágenes - Cloud Vision + Email con Adjuntos

## Contexto

El bot recibe 3 tipos de imágenes:
1. **DNI Argentino + REPROCANN** → Extraer datos, guardar en BD, enviar email
2. **Documento no argentino** → Rechazar (ya funciona)
3. **Otra imagen cualquiera** → Analizar con IA (NUEVO)

## Estado Actual

✅ **Funciona:**
- `detectImage(imageUrl)` — identifica tipo de documento
- `extractDocumentData(imageUrl, docType)` — extrae DNI/REPROCANN con Claude
- `extractReprocannData(imageUrls)` — extrae REPROCANN (uno o ambos lados)
- `sendEmailNotification(chatId, nombre, dniData, reprocannData)` — envía email con Resend

❌ **Problemas:**
1. Email NO adjunta imágenes → admin debe pedir screenshots después
2. NO se valida que TODOS los datos estén completos antes de enviar email
3. NO hay función para analizar imágenes que NO son documentos
4. Si un dato falta, simplemente se pide pero no hay tracking de cuál falta

## Cambios Requeridos

### 1. Mejorar `sendEmailNotification()`
**Qué:** Adjuntar imágenes al email
**Cómo:**
- Resend soporta `attachments` — pasar URLs de imágenes como adjuntos
- Incluir screenshots claros de DNI y REPROCANN en el email
- Mostrar los datos extraídos JUNTO a dónde vinieron (qué imagen)

**Ejemplo:**
```javascript
attachments: [
  { filename: 'DNI_frente.jpg', path: dniImageUrl },
  { filename: 'REPROCANN.jpg', path: reprocannImageUrl }
]
```

### 2. Validar Datos Antes de Enviar
**Qué:** Si un campo crítico falta, pedir al usuario ANTES de enviar email
**Campos críticos:**
- DNI: nombre, documento, domicilio
- REPROCANN: nombre, estado, provincia

**Cómo implementar:**
- Función `validateCriticalFields(dniData, reprocannData)` → retorna campos faltantes
- Si hay campos faltantes, pedir por WhatsApp ANTES de llamar a sendEmail
- Guardar respuestas en `state.collectedData` y RE-VALIDAR
- Solo cuando TODO esté completo, ENTONCES enviar email

**Ejemplo flow:**
```
Usuario manda DNI → Se extrae pero falta domicilio
Bot: "Veo tu DNI pero me falta tu domicilio. ¿Dónde vivís?"
Usuario: "Calle 123, CABA"
Bot: ✅ Datos completos, enviamos email
```

### 3. Analizar Imágenes Genéricas (NO documentos)
**Qué:** Si usuario manda foto de plantas, sticker, meme, etc → no rechazar, analizar
**Cómo:**
- Crear función `analyzeGenericImage(imageUrl)` que use Claude con vision
- Prompt debe ser flexible: divertido, informativo o educativo según contexto
- Responder en WhatsApp con un comentario inteligente (no "imagen no soportada")

**Ejemplos:**
- Foto de planta de cannabis → "¡Esa genética se ve saludable! ¿Es autovivencia? 🌿"
- Meme → "😂 jaja bueno, mientras no comas los documentos"
- Foto aleatoria → "Linda foto, pero ¿necesitás ayuda con el trámite REPROCANN?"

**Implementar:**
```javascript
async function analyzeGenericImage(imageUrl, userMessage) {
  // Claude vision para entender contexto
  // Retornar respuesta empática
}
```

### 4. Mejorar Flujo de `completando_datos`
**Qué:** Tracking de qué datos faltan
**Cambio:**
- En `state.pendingFields`, incluir no solo `key` sino también `extracted_from_image`
- Si un campo se completó parcialmente en imagen, pedir solo lo faltante
- Ej: imagen DNI tiene nombre pero no domicilio → pedir solo domicilio

## Implementación Sugerida

### Prioridad 1 (Crítica):
1. Validar datos antes de email ← evita errores en BD/email
2. Adjuntar imágenes a email ← mejora admin experience

### Prioridad 2 (Nice-to-have):
3. Analizar imágenes genéricas ← mejor UX

## Notas Técnicas

- **Resend attachments**: Soporta `path` (archivo local) o `data` (buffer). Usamos `path` con URLs públicas
- **Cloud Vision**: Podemos usar Claude Vision (ya está) O Google Cloud Vision API
- **Estado**: Usar `state.documentos` para rastrear qué se adjunta al email
- **Revalidación**: Después de `completando_datos`, re-extraer + re-validar

## Files a Modificar

- `sendEmailNotification()` — agregar adjuntos
- `validateCriticalFields()` — NUEVA función
- `analyzeGenericImage()` — NUEVA función (optional)
- Webhook handler `imageMessage` — llamar validación antes de email
- `state.collectedData` tracking — mejorar

## Aceptación

✅ Email tiene adjuntos (DNI + REPROCANN)
✅ Se piden datos faltantes ANTES de email
✅ Imágenes genéricas se analizan inteligentemente
✅ BD recibe SOLO datos completos y validados
✅ Admin tiene contexto de dónde vino cada dato

---

**Autor:** Claude Code | **Fecha:** 2026-04-25
