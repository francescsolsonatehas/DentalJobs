# 🦷 DentalJobs

Portal de ofertas de trabajo para dentistas con distintas especialidades. Conecta clínicas dentales con profesionales del sector.

## Características

- ✅ **Autenticación** — Registro y login con JWT
- ✅ **Ofertas de trabajo** — Las clínicas pueden publicar oportunidades laborales
- ✅ **Solicitudes de empleo** — Los dentistas pueden buscar empleadores
- ✅ **Especialidades** — Distinción completa entre 8 especialidades dentales
- ✅ **Filtros avanzados** — Por ciudad, especialidad, tipo de contrato, jornada
- ✅ **Sistema de mensajería interna** — Contacto directo sin exponer emails
- ✅ **Diseño responsivo** — Compatible con móvil, tablet y escritorio

## Especialidades soportadas

- Generalista
- Cirugía oral
- Implantología
- Endodoncia
- Periodoncia
- Ortodoncia
- Estética dental
- Odontopediatría

## Stack técnico

- **Backend**: Node.js + Express.js
- **BD**: SQLite3
- **Auth**: JWT (jsonwebtoken + bcryptjs)
- **Frontend**: HTML5 + CSS3 + JavaScript vanilla

## Instalación y ejecución

### 1. Instalar dependencias del backend

```bash
cd backend
npm install
```

### 2. Iniciar el servidor backend

```bash
npm start
```

El servidor se iniciará en `http://localhost:3000`

### 3. Abrir el frontend

Abre el archivo `frontend/index.html` en tu navegador, o usa un live server:

```bash
# Si tienes Python instalado:
cd frontend
python3 -m http.server 8000

# O con Node.js (requiere http-server):
npx http-server frontend
```

Luego accede a `http://localhost:8000` (o el puerto que configure)

## API Endpoints

### Autenticación
- `POST /auth/registro` — Crear usuario (nombre, email, password, tipo, telefono)
- `POST /auth/login` — Obtener JWT (email, password)

### Especialidades
- `GET /especialidades` — Listar todas las especialidades

### Publicaciones
- `GET /publicaciones` — Listar con filtros: `?tipo=oferta&especialidad=2&ciudad=Barcelona`
- `GET /publicaciones/:id` — Obtener detalle de una publicación
- `POST /publicaciones` — Crear nueva (requiere JWT)
- `DELETE /publicaciones/:id` — Eliminar propia publicación (requiere JWT)

### Mensajes
- `POST /mensajes` — Enviar mensaje de contacto sobre una publicación

### Chat
- `GET /chat/conversaciones` — Bandeja de conversaciones (requiere JWT)
- `GET /chat/mensajes/:publicacionId/:otroId` — Hilo de conversación; marca los entrantes como leídos y devuelve si el otro está escribiendo
- `POST /chat/mensajes` — Enviar mensaje (publicacion_id, destinatario_id, cuerpo)
- `POST /chat/escribiendo` — Señal de "escribiendo…" (expira a los 5 s)
- `GET /chat/no-leidos` — Contador de mensajes sin leer

### Reseñas
- `POST /resenyas` — Valorar a la otra parte de una candidatura aceptada (1-5 + comentario)
- `GET /resenyas/usuario/:id` — Reseñas recibidas y media de un usuario

### Recordatorios
- `GET /recordatorios/pendientes` — Postulaciones sin responder desde hace N días (`?dias=3` por defecto)

### Perfil
- `GET /usuarios/:id/publico` — Perfil público (descripción, años de experiencia)
- `GET /auth/mi-cv.pdf` — CV del dentista en PDF generado automáticamente
- `POST /archivos/upload` — Además de `cv` y `portfolio`, admite `foto` (fotos de la clínica)

### Estadísticas de publicación
- `POST /publicaciones/:id/vista` — Registrar una vista
- `GET /publicaciones/:id/estadisticas` — Vistas, postulantes por estado y tiempo medio de respuesta (solo dueño)

### Plantillas
- `POST /plantillas` / `GET /plantillas` / `DELETE /plantillas/:id` — Plantillas de publicación reutilizables

### Sedes
- `POST /sedes` / `GET /sedes` / `PUT /sedes/:id` / `DELETE /sedes/:id` — Sedes de una clínica; las ofertas pueden asociarse con `sede_id`

### Exportación
- `GET /candidaturas/export.csv` — Exportar postulaciones recibidas o enviadas (`?tipo=recibidas|enviadas`)

## Desarrollo futuro

- [ ] Búsqueda fulltext (nombre de clínica, especialista)
- [ ] Recomendaciones basadas en perfil
- [ ] Notificaciones por email
- [ ] Verificación de email
- [ ] Publicaciones destacadas / planes de suscripción

## Licencia

MIT
