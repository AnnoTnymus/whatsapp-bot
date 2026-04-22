# WhatsApp Bot con Claude AI

Bot de WhatsApp completamente automatizado que responde preguntas usando Claude AI y la base de conocimiento del club.

## Stack

- **Runtime**: Node.js 20
- **Framework**: Express.js
- **AI**: Claude API (Anthropic)
- **WhatsApp**: GreenAPI
- **Deployment**: Render.com (gratuito)

## Setup Local

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables de entorno

Copiar `.env.example` a `.env` y actualizar con tus credenciales:

```bash
cp .env.example .env
```

Valores necesarios:
- `ANTHROPIC_API_KEY`: Tu clave de API de Anthropic
- `GREEN_API_*`: Credenciales de GreenAPI (instance ID y token)

### 3. Arrancar localmente

```bash
npm start
# o con auto-reload:
npm run dev
```

El servidor corre en `http://localhost:3000`

### 4. Testear webhook localmente

```bash
curl -X GET http://localhost:3000/health
# → {"ok":true,"uptime":5,"conversationThreads":0,"model":"claude-3-5-haiku-20241022"}
```

### 5. Testear webhook con datos

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "typeWebhook":"incomingMessageReceived",
    "senderData":{"chatId":"test@c.us","senderName":"Test"},
    "messageData":{"typeMessage":"textMessage","textMessageData":{"textMessage":"Hola, cual es el horario?"}}
  }'
```

Deberías ver logs en la terminal con timestamps.

## Test End-to-End con ngrok

Para testear con mensajes reales de WhatsApp desde tu máquina local:

### 1. Instalar ngrok

```bash
npm install -g ngrok
# o descargar desde https://ngrok.com
```

### 2. Exponer servidor local

```bash
ngrok http 3000
# → https://abc123.ngrok.io
```

### 3. Configurar en GreenAPI

- GreenAPI Dashboard → Settings → Webhooks
- Editar webhook URL: `https://abc123.ngrok.io/webhook`
- Guardar

### 4. Enviar mensaje

Envía un mensaje de WhatsApp a tu número. Deberías:
- Ver logs en la terminal de `npm start`
- Recibir respuesta del bot en WhatsApp en 2-5 segundos

## Deployment en Render.com

### 1. Crear repo GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/whatsapp-bot.git
git push -u origin main
```

### 2. Crear Web Service en Render

1. Ve a [render.com](https://render.com)
2. Conecta tu GitHub
3. Crea "New Web Service"
4. Selecciona el repo `whatsapp-bot`
5. Configura env vars:
   - `ANTHROPIC_API_KEY`
   - `GREEN_API_URL`
   - `GREEN_API_INSTANCE_ID`
   - `GREEN_API_TOKEN`

Render genera URL automática: `https://whatsapp-bot-xxxx.onrender.com`

### 3. Actualizar GreenAPI

GreenAPI Dashboard → Webhooks → URL: `https://whatsapp-bot-xxxx.onrender.com/webhook`

### 4. Test en producción

Envía un mensaje de WhatsApp. Debería funcionar igual que localmente.

## Logs

Todos los eventos se loguean con timestamp:

```
[2024-04-22T15:30:45.123Z] [webhook] Received POST - responding OK immediately
[2024-04-22T15:30:45.145Z] [webhook] typeWebhook: incomingMessageReceived
[2024-04-22T15:30:45.150Z] [webhook] Message type: textMessage
[2024-04-22T15:30:45.155Z] [webhook] From: John Doe (+549876543210) | Message: Hola
[2024-04-22T15:30:45.160Z] [webhook] Processing message...
[2024-04-22T15:30:46.200Z] [claude] Calling Claude with 1 messages for chat +549876543210@c.us
[2024-04-22T15:30:47.100Z] [claude] Reply: Hola John! Nos vemos en horario...
[2024-04-22T15:30:47.150Z] [whatsapp] Sending to +549876543210@c.us
[2024-04-22T15:30:47.500Z] [whatsapp] Send status: 200
```

En Render.com, los logs aparecen en el dashboard del servicio.

## Knowledge Base

El archivo `knowledge/base.md` contiene toda la información del club. Claude lo usa como contexto para responder preguntas.

Para actualizar la información del club:
1. Editar `knowledge/base.md`
2. Hacer commit y push
3. Render.com redeploy automático en 1-2 min

## Troubleshooting

### El bot no responde

1. Verificar que el servidor corre: `curl http://localhost:3000/health`
2. Verificar logs por errores
3. Confirmar que GreenAPI webhook URL es correcta
4. Confirmar que las env vars están seteadas

### Errores de API

- **401 Unauthorized**: verificar `ANTHROPIC_API_KEY`
- **403 Forbidden**: verificar GreenAPI token y instance ID
- **500 Error**: revisar logs de Render.com Dashboard

## Autor

Martin - mmoralesoloriz@gmail.com
