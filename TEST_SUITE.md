# WhatsApp Bot v2.0 - Test Suite

**Date:** 2026-04-23  
**Status:** IN PROGRESS

## Test Scenarios

### Test 1: REPROCANN Detection - Both Sides in One Image
**Goal:** Verify bot detects REPROCANN with both frente and dorso in one image

**Mock Request:**
```json
{
  "typeWebhook": "incomingMessageReceived",
  "messageData": {
    "typeMessage": "imageMessage",
    "downloadUrl": "https://example.com/reprocann-completo.jpg",
    "idMessage": "msg_001"
  },
  "senderData": {
    "chatId": "595491111111@c.us",
    "senderName": "TestUser1"
  }
}
```

**Expected Behavior:**
- [ ] detectImage() returns `{ tipo: 'REPROCANN', ambosSides: true }`
- [ ] extractReprocannData() processes single URL
- [ ] getMissingFields() identifies missing mandatory fields
- [ ] If complete: Bot asks for DNI ("mandame una foto de tu DNI")
- [ ] If incomplete: Bot asks for first missing field (e.g., "contame tu provincia")
- [ ] State: 'esperando_dni' or 'completando_datos'

**Test Code:**
```javascript
const test1 = {
  typeWebhook: 'incomingMessageReceived',
  messageData: {
    typeMessage: 'imageMessage',
    downloadUrl: 'https://example.com/reprocann-both-sides.jpg',
    idMessage: 'msg_test1'
  },
  senderData: {
    chatId: '595491111111@c.us',
    senderName: 'TestUser1'
  }
}
```

---

### Test 2: Two-Image REPROCANN - Frente Only (First)
**Goal:** Verify bot waits for dorso when only frente received

**Mock Request 1 - Frente:**
```json
{
  "typeWebhook": "incomingMessageReceived",
  "messageData": {
    "typeMessage": "imageMessage",
    "downloadUrl": "https://example.com/reprocann-frente.jpg"
  },
  "senderData": {
    "chatId": "595491222222@c.us",
    "senderName": "TestUser2"
  }
}
```

**Expected Behavior (Step 1):**
- [ ] detectImage() returns `{ tipo: 'REPROCANN', ambosSides: false }`
- [ ] User has no reprocannFrenteUrl saved yet
- [ ] Bot saves URL to state.reprocannFrenteUrl
- [ ] State goes to 'esperando_reprocann_dorso'
- [ ] Bot responds: "Ahora mandame el dorso también"

---

### Test 2b: Two-Image REPROCANN - Dorso (Second)
**Goal:** Verify bot processes both images together when dorso received

**Mock Request 2 - Dorso:**
```json
{
  "typeWebhook": "incomingMessageReceived",
  "messageData": {
    "typeMessage": "imageMessage",
    "downloadUrl": "https://example.com/reprocann-dorso.jpg"
  },
  "senderData": {
    "chatId": "595491222222@c.us",
    "senderName": "TestUser2"
  }
}
```

**Expected Behavior (Step 2):**
- [ ] detectImage() returns `{ tipo: 'REPROCANN', ambosSides: false }`
- [ ] User has reprocannFrenteUrl saved
- [ ] Bot calls extractReprocannData([frenteUrl, dorsoUrl])
- [ ] Bot merges data from both images
- [ ] getMissingFields() checks for mandatory fields
- [ ] If complete: State → 'esperando_dni', asks for DNI
- [ ] If incomplete: State → 'completando_datos', asks for first field
- [ ] reprocannFrenteUrl is cleared

---

### Test 3: Missing Fields - Text Completion
**Goal:** Verify bot asks for missing mandatory fields via text

**Prerequisites:**
- REPROCANN processed with missing fields (e.g., provincia, localidad missing)
- State is 'completando_datos'
- pendingFields array has [provincia_field, localidad_field, ...]

**Mock Request 1 - User Provides Provincia:**
```json
{
  "typeWebhook": "incomingMessageReceived",
  "messageData": {
    "typeMessage": "textMessage",
    "textMessageData": {
      "textMessage": "Buenos Aires"
    }
  },
  "senderData": {
    "chatId": "595491333333@c.us",
    "senderName": "TestUser3"
  }
}
```

**Expected Behavior (Request 1):**
- [ ] State is 'completando_datos', pendingFields = [provincia, localidad, ...]
- [ ] Message saved to collectedData['provincia'] = "Buenos Aires"
- [ ] First pending field removed from array
- [ ] Bot responds: "Gracias. Ahora contame tu localidad 👇"
- [ ] State remains 'completando_datos'

**Mock Request 2 - User Provides Localidad:**
```json
{
  "typeWebhook": "incomingMessageReceived",
  "messageData": {
    "typeMessage": "textMessage",
    "textMessageData": {
      "textMessage": "Palermo"
    }
  },
  "senderData": {
    "chatId": "595491333333@c.us",
    "senderName": "TestUser3"
  }
}
```

**Expected Behavior (Request 2):**
- [ ] Message saved to collectedData['localidad'] = "Palermo"
- [ ] pendingFields array decreases again
- [ ] If more fields pending: ask next field
- [ ] If all fields complete: State → 'esperando_dni', bot says "Ahora mandame una foto de tu DNI"

---

### Test 4: DNI Processing & Email Sending
**Goal:** Verify DNI triggers completion and email with merged data

**Prerequisites:**
- REPROCANN processed (with or without text-collected fields)
- State is 'esperando_dni'

**Mock Request - DNI Image:**
```json
{
  "typeWebhook": "incomingMessageReceived",
  "messageData": {
    "typeMessage": "imageMessage",
    "downloadUrl": "https://example.com/dni.jpg"
  },
  "senderData": {
    "chatId": "595491444444@c.us",
    "senderName": "TestUser4"
  }
}
```

**Expected Behavior:**
- [ ] detectImage() returns `{ tipo: 'DNI', ... }`
- [ ] extractDocumentData() processes DNI image
- [ ] State goes to 'completado'
- [ ] Bot responds: "¡Perfecto! 🎉 Recibimos toda tu documentación. Te contactamos pronto 🌿"
- [ ] Email is sent with:
  - [ ] DNI data (nombre, apellido, documento, etc.)
  - [ ] REPROCANN data from images
  - [ ] Merged collectedData (text responses)
- [ ] Email subject: "Nuevo Lead: [nombre] - Documentos Completos"

---

### Test 5: Complete Flow - All Data Provided
**Goal:** End-to-end test with complete REPROCANN + DNI

**User Flow:**
1. User sends REPROCANN image (both sides) with ALL 10 mandatory fields complete
2. Bot responds: "✅ Perfecto, vi tu REPROCANN" + "Ahora mandame una foto de tu DNI"
3. User sends DNI image
4. Bot responds: "¡Perfecto! 🎉 Recibimos toda tu documentación"
5. Email is sent to admin with all data

**Verification:**
- [ ] No missing fields request occurs
- [ ] State transitions: inicio → esperando_dni → completado
- [ ] Email contains all 10 REPROCANN fields
- [ ] Email contains DNI data
- [ ] No response truncation (max_tokens: 150 for user messages)

---

### Test 6: Response Length Verification
**Goal:** Ensure responses don't truncate (fix for max_tokens: 150)

**Previous Issue:**
- analyzeImageWithClaude used max_tokens: 300, causing truncation
- Now using max_tokens: 150 for brief confirmations

**Verification:**
- [ ] All user-facing confirmations are 1-2 lines max
- [ ] No mid-word truncation
- [ ] Response examples:
  - "✅ Recibí el frente. Mandame el dorso también." (OK)
  - "Gracias. Ahora contame tu provincia 👇" (OK)
  - NOT: "Recibí tu..." (truncated)

---

### Test 7: Rate Limiting Still Works
**Goal:** Verify rate limiting not broken by new features

**Prerequisites:**
- RATE_LIMIT = 30 messages/hour

**Expected Behavior:**
- [ ] Message 1-30: Accepted, processed normally
- [ ] Message 31: Rejected with "Recibimos muchos mensajes de este número, intentá en un rato 🙏"
- [ ] Rate limit applies to both text and image messages

---

### Test 8: Edge Cases

#### 8a: Non-REPROCANN/Non-DNI Image
**Mock Request:**
```json
{
  "typeWebhook": "incomingMessageReceived",
  "messageData": {
    "typeMessage": "imageMessage",
    "downloadUrl": "https://example.com/random.jpg"
  },
  "senderData": {
    "chatId": "595491555555@c.us",
    "senderName": "TestUser5"
  }
}
```

**Expected Behavior:**
- [ ] detectImage() returns `{ tipo: 'OTRO', ... }`
- [ ] Bot responds: "No estoy seguro qué documento es esa imagen. Mandame tu REPROCANN o tu DNI 📸"

#### 8b: Text Message During 'completando_datos'
**Expected Behavior:**
- [ ] Message saved to collectedData
- [ ] pendingFields updated
- [ ] Next field requested (or DNI if complete)

#### 8c: Text Message NOT During 'completando_datos'
**Expected Behavior:**
- [ ] Normal Claude response (askClaude())
- [ ] No attempt to save as field

---

## Test Execution Log

### Test 1: Single REPROCANN (Both Sides)
- **Status:** [ ] PENDING

### Test 2: Two-Image REPROCANN
- **Status:** [ ] PENDING

### Test 3: Missing Fields
- **Status:** [ ] PENDING

### Test 4: DNI & Email
- **Status:** [ ] PENDING

### Test 5: Complete Flow
- **Status:** [ ] PENDING

### Test 6: Response Length
- **Status:** [ ] PENDING

### Test 7: Rate Limiting
- **Status:** [ ] PENDING

### Test 8: Edge Cases
- **Status:** [ ] PENDING

---

## Summary

- Total Tests: 8 main + 3 edge cases = 11 test scenarios
- Status: Ready for execution
- Next Step: Execute tests and verify all checks pass
