# WhatsApp Bot v1.0 - Release Notes

## Status: Production ✅

El bot v1.0 fue validado en producción el 2026-04-22 con conversación real (Tincho) y funciona correctamente.

## Features Implementadas

### ✅ Básicas
- **Recepción de mensajes de texto** via GreenAPI webhook
- **Conversaciones multi-turno** con historial en memoria (últimos 8 mensajes)
- **Sistema de prompts** con tone rioplatense natural
- **Respuestas contextuales** basadas en knowledge base del club
- **Manejo de errors** con mensajes amigables

### ✅ Onboarding
- Saludo y bienvenida natural
- Consultas sobre horarios, ubicación, productos
- Información sobre REPROCANN y requisitos de afiliación
- Derivación a personal del club cuando es necesario

### ✅ Deployment
- Hosting en Render.com (plan gratuito)
- Auto-redeploy en push a GitHub
- Health endpoint para monitoreo
- Endpoint test-claude para diagnóstico de API

## Issues Identificados (v1.0)

### 🔴 Critical
1. **Descuento 5% inexistente** — Knowledge base menciona descuento que no existe
2. **Respuestas truncadas** — max_tokens: 300 es insuficiente para algunas respuestas
3. **Sin seguridad de tokens** — No hay rate limiting, cualquiera puede consumir API

### 🟡 High Priority
4. **No soporta imágenes** — El flujo de REPROCANN/DNI se rompe cuando llega una foto
5. **Sin persistencia** — Historial de conversaciones se pierde con cada restart

### 🟢 Future
6. **UptimeRobot ping** — Render free tier duerme después de 15 min de inactividad
7. **Datos en BD** — Las conversaciones solo viven en memoria, no son recuperables

## Validación en Producción

**Participante:** Tincho (usuario real del club)  
**Fecha:** 2026-04-22  
**Duración:** ~5 minutos de conversación

### Transcript resumido:
- ✅ Saludó y el bot respondió con energía
- ✅ Preguntó por horarios — respuesta correcta
- ✅ Preguntó por genéticas — respondió con detalles de efecto
- ✅ Preguntó por REPROCANN — explicación clara
- 🔴 Menciono "descuento del 5%" (no existe)
- 🔴 Respuesta cortada a mitad: "Me mandás foto del frente de tu DNI, arrancamos 🌿"
- ❌ Bot no pudo procesar la foto de REPROCANN

## Arquitectura

### Stack
- **Runtime:** Node.js 20 con ES Modules
- **Framework:** Express.js
- **AI:** Claude API (claude-opus-4-7)
- **WhatsApp:** GreenAPI
- **Deployment:** Render.com

### Flujo de Mensajes
```
Usuario escribe en WhatsApp
    ↓
GreenAPI webhook → POST /webhook
    ↓
Parse mensaje + rate limit check
    ↓
Llamar Claude con system prompt + historial
    ↓
Claude responde basado en knowledge base
    ↓
Enviar respuesta via GreenAPI
    ↓
Log todo con timestamp
```

### Variables de Entorno
- `ANTHROPIC_API_KEY` — Clave de API de Claude
- `GREEN_API_URL` — URL base de GreenAPI
- `GREEN_API_INSTANCE_ID` — ID de instancia de WhatsApp en GreenAPI
- `GREEN_API_TOKEN` — Token de autenticación
- `PORT` — Puerto del servidor (default 3000)

## Costos

### Actuales (v1.0)
- **Render.com:** Gratis (5000 horas/mes = ilimitado para 1 bot)
- **GreenAPI:** ~$2-5/mes según uso (conversación típica = 0.5KB)
- **Claude API:** ~$0.30/mes (estimado con baja conversa)
- **Total:** < $10/mes por bot

### Escalado (múltiples bots)
- El mismo stack es reutilizable para N clubes
- Cambiar config en .env y redeployar
- Costos escalan linealmente con uso de Claude

## Próximos Pasos (v2.0)

Ver `docs/v2.0/changelog.md`
