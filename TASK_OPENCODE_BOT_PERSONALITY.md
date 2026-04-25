# Task: Mejorar Personalidad y Tono del Bot — Bienvenida + Documentos

## Objetivo

Hacer que el bot sea más atractivo, entusiasta y claro sobre:
1. Quién es Indajaus (presentación)
2. Qué ofrece (servicios)
3. Cómo recibe documentos (con entusiasmo)

## Cambios Requeridos

### 1. Mensaje de Bienvenida (Primer Contacto)

**Situación:** Usuario dice "Hola" o primer contacto

**Cambiar a:**

```
Bienvenido a Indajaus 🌿

Te estás comunicando con nuestro club cannábico en Argentina. 
Somos una empresa que viene desde Uruguay trayendo más de una década de experiencia en el sector del cannabis. 
Estás en el lugar indicado.

¿Cuál es tu nombre?
```

**Implementación:** En el prompt del Generator, cuando `intent === 'greet'` y es primer mensaje, usar este texto.

---

### 2. Mensaje de Opciones (Cuando no hay intención clara)

**Situación:** Usuario saluda pero no expresa intención clara

**Cambiar de:**
```
¿En qué te puedo ayudar?
```

**Cambiar a:**

```
Perfecto, gracias por escribirnos.

Acá podemos ayudarte con:
• 📝 **Inscripción al club** — es lo principal, te digo qué necesitamos
• 📚 **Info sobre Indajaus** — quiénes somos, cómo funciona, precios
• 🌿 **Dudas sobre cannabis** — genéticas, REPROCANN, leyes
• 👥 **Hablar con alguien** — si prefieres atención humana

Yo soy IA entrenada para resolver dudas complejas, así que podemos hablar de cualquier cosa sin problemas.

¿Qué te interesa?
```

**Implementación:** En el prompt del Generator, agregar este bloque cuando:
- `intent === 'info'` Y `step === 'conversando'` Y usuario no expresó afiliación aún

---

### 3. Recepción de Documentos — Caso Exitoso

**Situación:** Usuario manda DNI o REPROCANN y los datos se leen perfectamente

**Cambiar el logging/respuesta en el webhook (cuando NO hay campos faltantes):**

**Antes:**
```
[webhook] REPROCANN completo (ambos lados)
```

**Después (el bot responde):**

```
¡Joya che! 🔥 Se ven los datos perfectos.

Estamos a un paso solamente. Me falta [DOCUMENTO]:
• [Si falta DNI frente]: DNI frente
• [Si falta DNI dorso]: DNI dorso  
• [Si falta REPROCANN]: REPROCANN

Mandame el que te falta y listo.
```

**Implementación:** En `index.js`, en la sección donde se detectan documentos faltantes:

```javascript
if (documentosFaltantes.length > 0) {
  const listaFaltantes = documentosFaltantes
    .map(doc => `• ${doc}`)
    .join('\n')
  
  await sendWhatsAppMessage(chatId, `¡Joya che! 🔥 Se ven los datos perfectos.\n\nEstamos a un paso solamente. Me falta:\n${listaFaltantes}\n\nMandame el que te falta y listo.`)
}
```

---

### 4. Recepción de Documentos — Caso Parcial (Faltan Datos)

**Situación:** Documento se lee pero faltan campos específicos (ej: domicilio en DNI)

**Cambiar el mensaje de pedir campos faltantes:**

**Antes:**
```
Me faltó leer [campo] del DNI. ¿Me lo escribís?
```

**Después (pedir de a uno, inteligentemente):**

**Primer campo faltante:**
```
¡Ufff! 😅 Logré leer algunos datos nada más.

Me falta tu [PRIMER CAMPO]. ¿Me lo escribís?
```

**Implementación:** En la sección de `state.step === 'completando_datos'`:

```javascript
if (missing.length > 0) {
  state.step = 'completando_datos'
  state.pendingFields = missing
  
  const firstField = missing[0]
  const sourceText = firstField.source === 'DNI' ? 'del DNI' : 'de tu REPROCANN'
  
  await sendWhatsAppMessage(
    chatId, 
    `¡Ufff! 😅 Logré leer algunos datos nada más.\n\nMe falta tu ${firstField.label} ${sourceText}. ¿Me lo escribís?`
  )
}
```

**Cuando llega el siguiente campo (mientras está en `completando_datos`):**
- Procesar como respuesta al campo faltante
- Si hay más campos faltantes, pedir el siguiente
- Si no hay más, enviar confirmación final

**Ejemplo de flujo:**
```
Bot: "Me falta tu domicilio del DNI. ¿Me lo escribís?"
Usuario: "Calle 123, CABA"
Bot: "Listo, me falta tu provincia de REPROCANN. ¿De dónde sos?"
Usuario: "Buenos Aires"
Bot: "✅ Perfecto, listo! Ya tenemos todo..."
```

**Implementación en webhook (cuando recibe texto en `completando_datos`):**
- Verificar cuál es el campo pendiente
- Guardar en `state.collectedData[fieldKey]`
- Sacar ese campo de `state.pendingFields`
- Si quedan campos, pedir el siguiente
- Si no hay más, pasar a `completado` y enviar email

---

### 5. Validación Posterior (Cuando Recibe Campos Faltantes)

**Situación:** Usuario responde con los campos faltantes y se completan todos los datos

**Mensaje de confirmación final:**

```
¡Impecaaa! 🎉

Ya tenemos todo lo que necesitamos para que nuestro staff lo revise y se comunique contigo para finalizar la inscripción.

Pero ya tenés un pie adentro del mejor club cannábico en Argentina! 🌿

Nos vemos en breve, bienvenido/a a Indajaus.
```

**Implementación:** Después de validar que todos los campos están completos:

```javascript
// Cuando state.pendingFields está vacío y todos los datos son válidos
await sendWhatsAppMessage(
  chatId,
  `¡Impecaaa! 🎉\n\nYa tenemos todo lo que necesitamos para que nuestro staff lo revise y se comunique contigo para finalizar la inscripción.\n\nPero ya tenés un pie adentro del mejor club cannábico en Argentina! 🌿\n\nNos vemos en breve, bienvenido/a a Indajaus.`
)
state.step = 'completado'
```

Este mensaje se envía ANTES de enviar el email de notificación al admin.

---

## Componentes a Cambiar

| Componente | Ubicación | Tipo |
|------------|-----------|------|
| Bienvenida | Generator prompt | Prompt |
| Opciones menú | Generator prompt | Prompt |
| Recepción doc exitosa | index.js webhook | Código |
| Recepción doc parcial | index.js webhook | Código |
| Confirmación final | index.js webhook | Código |

## Aceptación

✅ Primer mensaje muestra presentación de Indajaus (quiénes somos, historia)
✅ Segundo mensaje (sin intención clara) explica qué hace el bot + opciones (inscripción primero)
✅ Recepción de documentos exitosa → "¡Joya che! Se ven perfectos"
✅ Recepción de documentos parcial → "¡Ufff! Me faltarían..." (lista todos juntos)
✅ Mensaje final de confirmación con tono positivo
✅ Todo en español casual/coloquial (che, joya, ufff, etc)

---

**Autor:** Claude Code | **Fecha:** 2026-04-25 | **Para:** OpenCode  
**Scope:** Mejorar prompts + mensajes de bienvenida/documentos (sin cambiar lógica)
