# WhatsApp Bot - HOTFIX #2: REPROCANN-First Flow

**Date:** 2026-04-23  
**Commit:** `042eb21`  
**Status:** ✅ DEPLOYED

---

## Problem Fixed

**Issue:** When user sent DNI image alone (without REPROCANN), bot said "¡Listo! Te contactamos pronto" and sent incomplete email.

**Root Cause:** Bot was processing DNI immediately without checking if REPROCANN was received first.

**Solution:** Added validation to require REPROCANN before accepting DNI.

---

## New Logic

### Before (Wrong):
```
User sends DNI → Bot marks complete → Email sent (missing REPROCANN) ❌
```

### After (Correct):
```
User sends DNI (but no REPROCANN yet) 
→ Bot says: "Primero necesito tu REPROCANN. Mandame esa foto."
→ User sends REPROCANN
→ Bot says: "✅ Recibido" or asks for missing fields
→ Bot says: "Ahora mandame tu DNI"
→ User sends DNI
→ Bot says: "¡Listo! Te contactamos pronto"
→ Email sent with REPROCANN + DNI ✅
```

---

## Code Change

```javascript
// NEW: Check if REPROCANN is received and complete
const hasReprocann = state.reprocannData || (state.imagenes?.reprocann?.data)
const hasAllReprocannFields = hasReprocann && getMissingFields(hasReprocann).length === 0

if (!hasReprocann || !hasAllReprocannFields) {
  // Aún no tiene REPROCANN completo
  await sendWhatsAppMessage(chatId, `Primero necesito tu REPROCANN. Mandame esa foto.`)
  return
}

// Only if REPROCANN complete, process DNI
// ... extract DNI, send email, mark complete
```

---

## Expected Behavior Now

**Scenario 1: User sends DNI first**
```
User: [sends DNI delantera]
Bot: "Primero necesito tu REPROCANN. Mandame esa foto."
User: [sends REPROCANN]
Bot: "✅ Recibí el frente. Mandame el dorso también."
(etc...)
```

**Scenario 2: User sends REPROCANN then DNI**
```
User: [sends REPROCANN delantera]
Bot: "✅ Recibí el frente. Mandame el dorso también."
User: [sends REPROCANN dorso]
Bot: "✅ Recibí el dorso. Ahora mandame tu DNI 📸"
User: [sends DNI]
Bot: "✅ Recibido tu DNI. ¡Listo! Te contactamos pronto 🌿"
Email: [Complete with REPROCANN + DNI] ✅
```

---

## Deployment Status

✅ Committed to GitHub (commit `042eb21`)  
⏳ Render auto-deploying (1-2 min)

---

## Testing After Deploy

Try this exact flow:
1. Send DNI delantera alone → Bot should say "Primero necesito tu REPROCANN"
2. Then send REPROCANN → Bot processes it
3. Then send DNI again → Bot completes

---

**Status:** Ready to test on Render  
**Next:** If still having issues, will consider adding dorso detection for DNI as well
