# WhatsApp Bot - Nuevo Flujo: Recolectar TODOS los Documentos

**Commit:** `b7243b0`  
**Date:** 2026-04-23  
**Status:** ✅ DEPLOYED

---

## Cambio Principal

El bot ahora requiere **TODOS** los 4 documentos en **CUALQUIER ORDEN**:
- ✅ DNI delantera
- ✅ DNI dorso  
- ✅ REPROCANN delantera
- ✅ REPROCANN dorso

Solo cuando tenga los 4 documentos + todos los campos obligatorios, envía el email.

---

## Flujos Posibles

### Flujo 1: Usuario envía todo en orden DNI primero

```
User: [DNI delantera]
Bot: "✅ Recibido. Mandame el dorso también."

User: [DNI dorso]
Bot: "Gracias. Aún necesito: REPROCANN frente, REPROCANN dorso 📸"

User: [REPROCANN delantera]
Bot: "✅ Recibido. Mandame el dorso también."

User: [REPROCANN dorso]
Bot: "✅ Recibido. ¡Listo! Te contactamos pronto 🌿"
Admin: [Email con DNI completo + REPROCANN completo] ✅
```

### Flujo 2: Usuario envía en orden aleatorio

```
User: [REPROCANN delantera]
Bot: "✅ Recibido. Mandame el dorso también."

User: [DNI delantera]
Bot: "✅ Recibido. Mandame el dorso también."

User: [REPROCANN dorso]
Bot: "Gracias. Aún necesito: DNI dorso 📸"

User: [DNI dorso]
Bot: "✅ Recibido. ¡Listo! Te contactamos pronto 🌿"
Admin: [Email con ambos documentos completos] ✅
```

### Flujo 3: Si faltan campos obligatorios en REPROCANN

```
[Usuario envía todos los 4 documentos]
[REPROCANN tiene datos pero falta "provincia"]

Bot: "Ahora necesito tu provincia. Contame 👇"

User: "Buenos Aires"
Bot: "Gracias. Ahora necesito tu localidad. Contame 👇"

User: "Palermo"
[Continúa pidiendo campos faltantes...]
[Cuando todos completos]

Bot: "¡Listo! Te contactamos pronto 🌿"
Admin: [Email con todos los datos] ✅
```

---

## Estructura del Estado Interno

```javascript
state = {
  step: 'recibiendo_documentos' | 'completando_datos' | 'completado',
  nombre: 'usuario',
  documentos: {
    dni: {
      frente: { url: '...', data: {...} },
      dorso: { url: '...', data: {...} }
    },
    reprocann: {
      frente: { url: '...', data: {...} },
      dorso: { url: '...', data: {...} }
    }
  },
  pendingFields: [], // si faltan campos REPROCANN
  collectedData: {}  // datos proporcionados por texto
}
```

---

## Detección Automática de Documentos

El bot detecta automáticamente:
- **¿Es DNI o REPROCANN?** Usa Vision AI
- **¿Frente o dorso?** Detecta, o asume frente en primer envío
- **¿Ambos lados?** Si ve frente y dorso en una imagen

---

## Mensajes del Bot

| Situación | Mensaje |
|-----------|---------|
| Recibe un documento | `✅ Recibido. Mandame el dorso también.` |
| Faltan documentos | `Gracias. Aún necesito: DNI dorso, REPROCANN frente 📸` |
| Falta campo obligatorio | `Ahora necesito tu provincia. Contame 👇` |
| Todo completo | `✅ Recibido. ¡Listo! Te contactamos pronto 🌿` |

---

## Requisitos de Envío

### Antes de enviar email, bot verifica:

✅ DNI delantera recibida  
✅ DNI dorso recibida  
✅ REPROCANN delantera recibida  
✅ REPROCANN dorso recibida  
✅ Nombre extraído de REPROCANN  
✅ DNI extraído de REPROCANN  
✅ Provincia extraída  
✅ Localidad extraída  
✅ Dirección extraída  
✅ Estado de autorización extraído  
✅ Tipo de paciente extraído  
✅ Límite de transporte extraído  
✅ ID de trámite extraído  
✅ Fecha de vencimiento extraída  

Si falta CUALQUIERA de estos → bot pide por texto

---

## Testing

Después del deploy (1-2 min), prueba estos escenarios:

### Test 1: Orden secuencial
```
1. Envía DNI frente
2. Envía DNI dorso
3. Envía REPROCANN frente
4. Envía REPROCANN dorso
→ Bot debe completar y enviar email
```

### Test 2: Orden aleatorio
```
1. Envía REPROCANN dorso
2. Envía DNI frente
3. Envía REPROCANN frente
4. Envía DNI dorso
→ Bot debe completar y enviar email
```

### Test 3: Con campos faltantes
```
1-4. [Envía los 4 documentos]
[REPROCANN falta provincia]
→ Bot pide "Ahora necesito tu provincia"
→ Usuario responde "Buenos Aires"
→ Bot pregunta próximo campo faltante
```

---

## Email Enviado

Una vez completo, admin recibe email con:
- **DNI:** nombre, apellido, documento, fecha nacimiento, domicilio
- **REPROCANN:** nombre, DNI, provincia, localidad, dirección, estado, tipo, transporte, ID trámite, vencimiento
- **Datos completados por texto:** (si los hay)

---

## Deployment Status

✅ Committed (b7243b0)  
⏳ Render deploying (1-2 min)  
⏳ Ready to test

---

**Mejor así? El usuario puede enviar los documentos en el orden que prefiera, y el bot recolecta todo antes de enviar.**
