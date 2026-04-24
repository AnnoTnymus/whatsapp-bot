# Club de Cannabis - Información

## Sobre Nosotros — Indajaus

**Indajaus** fue fundada el **17/10/2017** y es actualmente **líder del sector en Uruguay**. En estos años nos posicionamos como una de las marcas y grow shops de mayor prestigio a nivel latinoamericano, gracias a un servicio de atención al cliente excepcional, precios competitivos y una organización empresarial como pocas en el rubro.

### Qué hacemos
- Distribuidores para grow shops
- Mayoristas de clubes cannábicos
- Proveedores de empresas estatales
- Venta al público auto-cultivador
- Líderes en redes sociales y plataformas online (Mercado Libre)

### Nuestros valores
- **Vocación por el servicio** como pilar central
- Equipo formado por profesionales del rubro en todas las áreas
- Políticas de empresa multinacional: ambiente laboral cuidado, responsabilidad social, políticas medioambientales y de seguridad
- Evaluación interna anual con formulario **Feedback to Grow** (estándares internacionales)
- Áreas: gerencia, ventas y operaciones, administración, marketing, logística

### Qué ofrecemos
- Todos los productos necesarios para cultivar cannabis (y cualquier cultivo agrícola)
- Accesorios e indumentaria
- **Atención personalizada gratuita** para llevar tus cultivos a los máximos estándares
- Experiencia de compra enfocada en el cliente como "socio principal"

## Ubicación
- **Dirección**: Palermo, Buenos Aires, Argentina
- **Zona**: Centro de la ciudad

## Horarios de Atención
- **Lunes a Viernes**: 11:00 - 20:00
- **Sábados**: 12:00 - 21:00
- **Domingos**: 12:00 - 19:00

## Acceso y Membresía
- Requiere afiliación válida
- Documento de identidad al momento de la visita
- Certificado REPROCANN (Registro de Productores Autorizados para Cannabis)

## Catálogo de Genéticas

### Indica (Relajantes)
- **Granddaddy Purple**: efecto relajante profundo, sabor a uva
- **Bubba Kush**: sabor terroso, ideal para descanso nocturno
- **Purple Haze**: aroma floral, efecto calmante

### Sativa (Energizantes)
- **Green Crack**: energía sostenida, efecto cerebral
- **Jack Herer**: aroma especiado, claridad mental
- **Lemon Skunk**: sabor cítrico, energía con claridad

### Híbridas (Balanceadas)
- **Blue Dream**: balance perfecto de efectos
- **Girl Scout Cookies**: sabor dulce, efecto balanceado
- **OG Kush**: concentración de THC, sabor fuerte

## Métodos de Pago
- Efectivo
- Transferencia bancaria
- Débito/Crédito (sujeto a disponibilidad)

## Preguntas Frecuentes

### ¿Cuáles son los requisitos para ingresar?
Necesitás ser mayor de 18 años, tener un documento válido y estar afiliado al club. También es recomendable tener el certificado REPROCANN si cultivas.

### ¿Cuál es la cantidad máxima de compra?
Depende de tu nivel de afiliación. Consulta con nuestro personal para más detalles.

### ¿Entregan a domicilio?
No realizamos entregas a domicilio. Solo venta presencial en las instalaciones del club.

### ¿Qué documentos necesito?
- Documento de identidad original
- Comprobante de domicilio (actualizado)
- Certificado REPROCANN o equivalente

### ¿Se puede reservar con anticipación?
Sí, puedes reservar genéticas llamando o escribiendo. Contáctanos para más información.

## Contacto
Para consultas sobre membresía, inventario o eventos especiales, comunícate con nuestro equipo.

---

## 🔧 Configuración Admin — Notificaciones Automáticas

Los intervalos de follow-up (cuándo el bot vuelve a contactar a un usuario inactivo, sin REPROCANN, etc.) se configuran en:

**`knowledge/notificaciones.config.json`**

### Campos editables:

- **`modo`**: `"test"` (intervalos en minutos, para validación rápida) o `"produccion"` (intervalos en días, uso real)
- **`cron_frecuencia_minutos`**: cada cuántos minutos el bot revisa si hay notificaciones pendientes (2 min test / 15 min prod)
- **`intervalos_test_minutos`** / **`intervalos_produccion_minutos`**: cuántos minutos esperar antes del próximo intento por cada motivo
- **`max_intentos`**: después de cuántos intentos se cancela el seguimiento

### Para pasar a producción:
1. Abrir `notificaciones.config.json`
2. Cambiar `"modo": "test"` → `"modo": "produccion"`
3. Guardar y redeployar (Render auto-redeploy al hacer git push)

⚠️ No tocar este archivo en vivo — requiere reiniciar el bot para aplicar cambios.
