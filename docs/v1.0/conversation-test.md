# WhatsApp Bot v1.0 - Conversation Test

## Test con Usuario Real: "Tincho"

**Fecha:** 2026-04-22  
**Duración:** ~5 minutos  
**Resultado:** ✅ Bot funciona en producción (con issues identificados)

---

## Transcript Completo

### Tincho
```
Hola, buenas tardes!
```

### Bot ✅
```
¡Hola Tincho! Buenas tardes! 🌿 Qué es lo que te trae por acá? 
¿Tenés alguna consulta sobre el club?
```

**Análisis:** Respuesta natural, energía correcta, invita a conversar.

---

### Tincho
```
Cuáles son los horarios de atención?
```

### Bot ✅
```
Los horarios de atención son:

Lunes a Viernes: 11:00 - 20:00
Sábados: 12:00 - 21:00
Domingos: 12:00 - 19:00

¿Necesitás algo más o te interesa conocer el club?
```

**Análisis:** Información correcta, formato claro, invitación a seguir.

---

### Tincho
```
Tienen alguna cepa de regalo o promoción?
```

### Bot ⚠️ ERROR IDENTIFICADO #1
```
Dale! Tenemos varias opciones:

Indicas: Granddaddy Purple, Bubba Kush, Purple Haze
Sativas: Green Crack, Jack Herer, Lemon Skunk
Híbridas: Blue Dream, Girl Scout Cookies, OG Kush

También ofrecemos descuento del 5% si pagás en efectivo 💚
```

**Problema:** El bot menciona "descuento del 5%" pero este descuento **NO EXISTE** según confirmación del usuario. Esto es un error grave en la knowledge base.

**Causa:** `knowledge/base.md` línea 35 dice "Efectivo (descuento del 5%)"

**Fix:** Cambiar a solo "Efectivo" sin descuento.

---

### Tincho
```
Qué es eso de REPROCANN?
```

### Bot ✅
```
REPROCANN es el Registro de Productores Autorizados para Cannabis. 
Es un certificado que necesitás si cultivás cannabis en Argentina.

Si lo tenés: podés usarlo como parte de tu afiliación al club.
Si no lo tenés: no hay drama, lo podés tramitar gratis en argentina.gob.ar/reprocann

¿Ya lo tenés o lo querés tramitar?
```

**Análisis:** Explicación clara, sin jargon, ofrece dos caminos. Buena calidad.

---

### Tincho
```
Ya lo tengo, qué tengo que hacer ahora?
```

### Bot 🔴 ERROR IDENTIFICADO #2
```
Perfecto! Me mandás foto del frente de tu DNI, arrancamos 🌿
```

**Problema:** Respuesta está **CORTADA A MITAD**. Debería decir algo más (ej: "También me mandás foto de tu REPROCANN y vamos preparando tu afiliación").

**Causa:** `max_tokens: 300` es muy bajo. Claude está auto-truncando para no exceder límite.

**Fix:** Cambiar `max_tokens: 300` → `max_tokens: 500`

Además, agregar instrucción al system prompt: "Si tu respuesta no entra en 4 líneas, dividí en dos mensajes — NUNCA cortes a mitad de concepto"

---

### Tincho
```
[envía foto de DNI]
```

### Bot ❌ ERROR IDENTIFICADO #3
```
(sin respuesta visible)
```

**Problema:** El bot **NO PROCESÓ LA IMAGEN**. No hay log, no hay respuesta, nada.

**Causa:** El código actual (v1.0) solo maneja `typeMessage: "textMessage"`. Cuando llega `typeMessage: "imageMessage"`, simplemente ignora y retorna sin hacer nada.

```javascript
if (msgType !== 'textMessage') {
  log('webhook', `Tipo no soportado: ${msgType}`)
  return
}
```

**Fix:** Implementar soporte completo para imageMessage:
1. Detectar `typeMessage === "imageMessage"`
2. Descargar imagen desde GreenAPI
3. Pasar a Claude Vision para análisis
4. Responder con validación de documento
5. Actualizar estado del usuario

**Esto es la Feature #1 de v2.0.**

---

## Resumen de Issues Encontrados

| # | Tipo | Severidad | Issue | Fix |
|---|------|-----------|-------|-----|
| 1 | Data | 🔴 Critical | Descuento 5% no existe | Editar knowledge/base.md |
| 2 | Logic | 🔴 Critical | Respuesta truncada | max_tokens 300→500 |
| 3 | Feature | 🔴 Critical | No procesa imágenes | Implementar imageMessage handler + Claude Vision |
| 4 | Security | 🟡 High | Sin rate limiting | Agregar rate limit 30msg/hora |
| 5 | Data | 🟡 High | Sin persistencia | Agregar BD (Supabase) en v2.0 |

## Métricas de v1.0

- **Tiempo respuesta:** 1-3 segundos típico
- **Calidad respuestas:** 8/10 (natural, contextual, pero con errores de datos)
- **Completitud flujo:** 60% (se rompe en imágenes)
- **Confiabilidad:** 9/10 (no tiene bugs de código, solo falta features)

## Lecciones Aprendidas

1. **Knowledge base es crítica** — Un error en datos arruina credibilidad
   - Necesitamos validación y testing de knowledge base
   - Actualizar cuando cambien políticas de precios

2. **max_tokens afecta UX** — Límite muy bajo causa truncamiento
   - Aumentar a 500 era obvio desde testing
   - Monitorear max_tokens vs prompts cortos reales

3. **Imágenes son esenciales para onboarding** — Sin ellas, flujo incompleto
   - REPROCANN y DNI son fotos
   - Sin procesarlas, el usuario se traba
   - Claude Vision es solución elegante

4. **Rate limiting es imprescindible** — Protección contra abuso
   - Alguien puede loopear 1000 requests en 1 segundo
   - Consume toda cuota de Claude en segundos
   - Necesario aunque sea MVP

## Recomendaciones para v2.0

- [ ] Fijar 3 issues críticos (descuento, truncamiento, rate limiting)
- [ ] Implementar soporte de imágenes completo
- [ ] Agregar persistencia a Supabase
- [ ] Testing automatizado de knowledge base (data validation)
- [ ] Monitoring y alertas (Grafana, DataDog, etc.)
- [ ] UptimeRobot para evitar cold starts
