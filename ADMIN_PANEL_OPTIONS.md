# Admin Panel para Gestionar base.md - Opciones de Implementación

**Date:** 2026-04-23  
**Objetivo:** Permitir al cliente actualizar información del negocio sin editar código

---

## 📊 Comparativa de Opciones

| Opción | Complejidad | Costo | Acceso | Persistencia | Recomendación |
|--------|-------------|-------|--------|--------------|---------------|
| **A: Panel Local + JSON** | 🟢 Muy Simple | $0 | URL protegida | ❌ Se pierde en reinicio | Pruebas |
| **B: Panel + Google Sheets** | 🟢 Simple | $0 | URL + contraseña | ✅ Permanente | ✅ MEJOR |
| **C: GitHub UI Visual** | 🟡 Media | $0 | GitHub directo | ✅ Permanente | Avanzado |
| **D: Supabase + Panel** | 🔴 Compleja | $0-15/mes | URL + auth | ✅ Permanente | Futuro |

---

## 🥇 OPCIÓN B (RECOMENDADA): Admin Panel + Google Sheets

### Por Qué?
✅ **Sin costo** - Google Sheets es gratuito  
✅ **Súper simple** - Cliente solo completa un formulario  
✅ **Acceso seguro** - URL con contraseña  
✅ **Permanente** - Datos guardados en Google  
✅ **Auto-actualización** - Bot lee los datos  
✅ **Fácil de gestionar** - Cliente ve datos en Sheet  

### Implementación

#### Paso 1: Admin Panel HTML (`/admin` endpoint)

```javascript
app.get('/admin', (req, res) => {
  // Contraseña simple (en variable de entorno)
  const adminPassword = process.env.ADMIN_PASSWORD || 'cambiar123'
  const password = req.query.pwd
  
  if (password !== adminPassword) {
    return res.send(`
      <html>
        <body style="padding: 20px; font-family: sans-serif;">
          <h1>🔐 Admin Panel</h1>
          <form method="GET">
            <label>Contraseña:</label><br/>
            <input type="password" name="pwd" required />
            <button type="submit">Acceder</button>
          </form>
        </body>
      </html>
    `)
  }

  // Panel abierto - mostrar formulario
  res.send(`
    <html>
      <body style="padding: 20px; font-family: sans-serif; max-width: 800px;">
        <h1>⚙️ Configuración del Club</h1>
        
        <form id="configForm">
          <h2>📍 Información General</h2>
          <label>Nombre del Club:</label><br/>
          <input type="text" name="nombre" value="Tu Club Cannábico" style="width:100%; padding: 8px;"/><br/><br/>
          
          <label>Ubicación/Dirección:</label><br/>
          <input type="text" name="ubicacion" value="Palermo, Buenos Aires" style="width:100%; padding: 8px;"/><br/><br/>
          
          <label>Horarios:</label><br/>
          <textarea name="horarios" style="width:100%; padding: 8px; height: 100px;">
Lunes a Viernes: 10:00 - 18:00
Sábados: 12:00 - 20:00
Domingos: Cerrado
          </textarea><br/><br/>

          <h2>🌿 Genéticas Disponibles</h2>
          <label>Indicas (relajantes):</label><br/>
          <textarea name="indicas" style="width:100%; padding: 8px; height: 100px;">
Granddaddy Purple, Bubba Kush, Northern Lights
          </textarea><br/><br/>

          <label>Sativas (energizantes):</label><br/>
          <textarea name="sativas" style="width:100%; padding: 8px; height: 100px;">
Sour Diesel, Green Crack, Jack Herer
          </textarea><br/><br/>

          <label>Híbridas:</label><br/>
          <textarea name="hibridas" style="width:100%; padding: 8px; height: 100px;">
OG Kush, Girl Scout Cookies, Gorilla Glue
          </textarea><br/><br/>

          <h2>📋 REPROCANN Info</h2>
          <label>Información REPROCANN:</label><br/>
          <textarea name="reprocann_info" style="width:100%; padding: 8px; height: 120px;">
REPROCANN es el Registro de Personas Autorizadas a Cultivar Plantas de Cannabis.
- Tramitación: argentina.gob.ar/reprocann
- Costo: Gratuito
- Tiempo: 20-30 días hábiles
          </textarea><br/><br/>

          <h2>💬 Mensaje Personalizado</h2>
          <label>Mensaje adicional para usuarios:</label><br/>
          <textarea name="mensaje_custom" style="width:100%; padding: 8px; height: 100px;">
Bienvenido a nuestro club. Somos una comunidad dedicada a la educación y cultivo responsable.
          </textarea><br/><br/>

          <button type="button" onclick="guardar()" style="background: #4CAF50; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">
            💾 Guardar Cambios
          </button>
          
          <p id="status"></p>
        </form>

        <script>
          // Cargar datos actuales
          async function cargar() {
            const res = await fetch('/api/admin/config')
            const data = await res.json()
            
            Object.keys(data).forEach(key => {
              const input = document.querySelector('[name="' + key + '"]')
              if (input) input.value = data[key]
            })
          }

          // Guardar datos
          async function guardar() {
            const form = document.getElementById('configForm')
            const formData = new FormData(form)
            const data = Object.fromEntries(formData)
            data.pwd = '${password}'
            
            const res = await fetch('/api/admin/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            })
            
            const result = await res.json()
            document.getElementById('status').textContent = result.ok 
              ? '✅ Cambios guardados!' 
              : '❌ Error al guardar'
          }

          cargar()
        </script>
      </body>
    </html>
  `)
})
```

#### Paso 2: API para Guardar/Cargar Config

```javascript
// Guardar configuración
app.post('/api/admin/config', (req, res) => {
  const { pwd, ...config } = req.body
  
  // Verificar contraseña
  if (pwd !== process.env.ADMIN_PASSWORD) {
    return res.json({ ok: false, error: 'Contraseña incorrecta' })
  }

  // Guardar en archivo local (o Google Sheets si prefieres)
  fs.writeFileSync('./config.json', JSON.stringify(config, null, 2))
  
  // Recargar base de datos del bot
  updateKnowledgeBase(config)
  
  res.json({ ok: true })
})

// Cargar configuración
app.get('/api/admin/config', (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'))
    res.json(config)
  } catch {
    res.json({
      nombre: 'Tu Club',
      ubicacion: 'Palermo, Buenos Aires',
      horarios: 'Lunes a Viernes: 10-18',
      // ... defaults
    })
  }
})

// Actualizar knowledge base del bot
function updateKnowledgeBase(config) {
  const baseContent = `
# ${config.nombre}

## Ubicación
${config.ubicacion}

## Horarios
${config.horarios}

## Genéticas Disponibles

### Indicas (Relajantes)
${config.indicas}

### Sativas (Energizantes)
${config.sativas}

### Híbridas
${config.hibridas}

## REPROCANN
${config.reprocann_info}

## Información Adicional
${config.mensaje_custom}
  `
  
  knowledgeBase = baseContent
  log('admin', 'Knowledge base actualizada')
}
```

#### Paso 3: Cargar en Startup

```javascript
// En startup
try {
  const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'))
  updateKnowledgeBase(config)
  log('startup', 'Config cargada desde archivo')
} catch {
  log('startup', 'Usando config por defecto')
}
```

### URL de Acceso
```
https://whatsapp-bot-h85o.onrender.com/admin?pwd=tu_contraseña_secreta
```

---

## 🥈 OPCIÓN A: Simple (Sin Persistencia)

Si quieres algo **aún más simple** sin persistencia:

```javascript
app.get('/admin', (req, res) => {
  res.send(`
    <html>
      <body style="padding: 20px;">
        <h1>⚙️ Editar Información</h1>
        <textarea id="content" style="width: 100%; height: 500px;"></textarea>
        <button onclick="guardar()">Guardar</button>
        
        <script>
          fetch('/api/knowledge')
            .then(r => r.text())
            .then(text => document.getElementById('content').value = text)
          
          function guardar() {
            fetch('/api/knowledge', {
              method: 'POST',
              body: document.getElementById('content').value
            }).then(() => alert('Guardado (hasta próximo restart)'))
          }
        </script>
      </body>
    </html>
  `)
})

app.post('/api/knowledge', express.text(), (req, res) => {
  knowledgeBase = req.body
  res.send('OK')
})
```

**Ventaja:** Super simple  
**Desventaja:** Se pierde al reiniciar servidor

---

## 🥉 OPCIÓN C: GitHub Visual (Sin Programación)

El cliente edita directamente en GitHub sin tocar código:

1. Cliente va a: `https://github.com/usuario/whatsapp-bot/blob/main/knowledge/base.md`
2. Clickea el icono de edición (✏️)
3. Edita el contenido
4. Hace "Commit changes"
5. Render redeploy automático

**Ventaja:** Muy simple, permanente  
**Desventaja:** Requiere cuenta GitHub

---

## 🚀 OPCIÓN D: Supabase + Panel (Futuro)

Cuando implementen BD:

```javascript
// Tabla en Supabase
CREATE TABLE club_config (
  id UUID PRIMARY KEY,
  nombre TEXT,
  ubicacion TEXT,
  horarios TEXT,
  genéticas JSONB,
  reprocann_info TEXT,
  updated_at TIMESTAMP
);

// Bot carga en startup
const config = await supabase
  .from('club_config')
  .select('*')
  .single()
```

---

## 📋 Recomendación Final

### Para AHORA (v3.0):
**Implementar OPCIÓN A (Simple File Editor)**
- 5 minutos para implementar
- Cliente accede a `/admin`
- Edita directamente
- Cambios inmediatos (hasta reinicio)

### Para DESPUÉS (con BD):
**Pasar a OPCIÓN B (Panel + Google Sheets o Supabase)**
- Cliente UI profesional
- Datos permanentes
- Auto-actualizaciones

### Implementación Mínima Ahora:

```javascript
// Agregar a index.js
app.get('/admin', (req, res) => {
  const pwd = req.query.pwd
  if (pwd !== process.env.ADMIN_PASSWORD) {
    return res.send('<h1>Contraseña requerida</h1><input type="password" placeholder="pwd">')
  }

  res.send(`
    <form action="/admin/save" method="POST">
      <textarea name="content" style="width:100%; height:500px;">${knowledgeBase}</textarea>
      <button>Guardar</button>
    </form>
  `)
})

app.post('/admin/save', express.text(), (req, res) => {
  const pwd = req.query.pwd
  if (pwd !== process.env.ADMIN_PASSWORD) return res.status(403).send('Denied')
  
  knowledgeBase = req.body
  res.send('Guardado')
})
```

---

## 🔐 Seguridad

**Variables de Entorno Requeridas:**
```bash
ADMIN_PASSWORD=contraseña_fuerte_aqui
```

En Render dashboard:
```
Environment → Add Environment Variable
Name: ADMIN_PASSWORD
Value: tu_contraseña_secreta
```

---

**Mi recomendación:** Implementa Opción A ahora (5 minutos), y cuando tengan BD, migra a Opción B o D.

¿Cuál prefieres? 🤔
