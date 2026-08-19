# 🦷 DentalJobs

Portal de empleo especializado para el sector dental. Conecta clínicas y dentistas para ofertas fijas, solicitudes de empleo, suplencias puntuales y colaboraciones recurrentes, con un motor de compatibilidad y matching proactivo por email — el diferencial frente a un portal genérico tipo InfoJobs o LinkedIn.

## Características

- ✅ **Autenticación** — Registro y login con JWT, verificación de email, recuperación de contraseña, cambio de email con confirmación, borrado de cuenta (anonimiza sin romper el historial de la otra parte)
- ✅ **Cuatro tipos de publicación** — Ofertas, solicitudes de empleo, suplencias (por días concretos, con aviso de urgencia) y colaboraciones (turnos recurrentes por día de la semana)
- ✅ **Motor de compatibilidad** — % de encaje dentista↔clínica con desglose, en base a especialidad, ciudad, equipamiento, certificaciones y prioridades configurables por el dentista
- ✅ **Matching proactivo por email** — Digest diario de suplencias y colaboraciones que casan con la disponibilidad del dentista, aviso instantáneo para suplencias urgentes, y resumen semanal de coincidencias activas
- ✅ **Búsqueda por radio en km** — No solo por ciudad exacta: publicaciones y perfiles cercanos dentro del radio de desplazamiento de cada dentista
- ✅ **Chat interno en tiempo real** — Con indicador de "escribiendo…" y contador de no leídos, sin exponer emails
- ✅ **Notificaciones in-app** — Campana con novedades (candidaturas, cambios de estado, mensajes) y onboarding guiado de primeros pasos
- ✅ **Perfiles enriquecidos** — Trayectoria profesional (experiencia, formación, idiomas), CV en PDF autogenerado, foto/logo, Book/portfolio descargable, reseñas bidireccionales tras una candidatura aceptada
- ✅ **Sedes múltiples** — Una clínica puede gestionar varios centros y publicar ofertas asociadas a cada uno
- ✅ **Preguntas de criba** — Hasta 3 preguntas obligatorias por oferta antes de poder postularse
- ✅ **Filtros avanzados y exportación a CSV** — Por ciudad, especialidad, contrato, jornada, salario mínimo, experiencia; cualquier listado se exporta a CSV
- ✅ **Páginas públicas SEO** — Cada oferta y suplencia activa tiene página propia sin necesidad de cuenta, más sitemap y robots.txt
- ✅ **Diseño responsivo** — Compatible con móvil, tablet y escritorio

## Especialidades soportadas

- Generalista
- Cirugía e Implantología
- Endodoncia
- Periodoncia
- Ortodoncia
- Estética dental
- Odontopediatría

## Stack técnico

- **Backend**: Node.js + Express
- **BD**: SQLite en desarrollo; [Turso](https://turso.tech) (libSQL) en producción
- **Auth**: JWT (jsonwebtoken + bcryptjs)
- **Email**: API HTTP de [Brevo](https://www.brevo.com) (Render bloquea SMTP saliente)
- **Frontend**: HTML5 + CSS3 + JavaScript vanilla
- **Despliegue**: backend en Render, frontend en GitHub Pages (se sincroniza a un repo espejo público vía GitHub Actions)

## Instalación y ejecución

### 1. Instalar dependencias del backend

```bash
cd backend
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Rellena al menos `JWT_SECRET`. Sin `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` se usa el SQLite local; sin `BREVO_API_KEY` los emails se imprimen por consola.

### 3. Iniciar el servidor backend

```bash
npm start
```

El servidor se iniciará en `http://localhost:3000`

### 4. Abrir el frontend

Abre el archivo `frontend/index.html` en tu navegador, o usa un live server:

```bash
# Si tienes Python instalado:
cd frontend
python3 -m http.server 8000

# O con Node.js (requiere http-server):
npx http-server frontend
```

Luego accede a `http://localhost:8000` (o el puerto que configure)

### 5. Tests

```bash
cd backend
npm test
```

## API Endpoints

### Autenticación y cuenta
- `POST /auth/registro` / `POST /auth/login` — Registro y login (JWT)
- `GET /auth/verificar-email/:token` / `POST /auth/reenviar-verificacion` — Verificación de email
- `POST /auth/olvide-password` / `POST /auth/restablecer-password` / `PUT /auth/cambiar-password` — Recuperación y cambio de contraseña
- `POST /auth/solicitar-cambio-email` / `GET /auth/confirmar-cambio-email/:token` — Cambio de email con confirmación
- `GET /auth/mi-perfil` / `PUT /auth/actualizar-perfil` — Perfil propio
- `GET /auth/mi-cv.pdf` — CV del dentista en PDF generado automáticamente
- `DELETE /auth/mi-cuenta` — Borrado de cuenta (anonimiza sin romper el historial de la otra parte)

### Especialidades y catálogos
- `GET /especialidades` — Listar especialidades
- `GET /catalogos` — Equipamiento, certificaciones y demás catálogos fijos

### Publicaciones
- `GET /publicaciones` — Listar con filtros: `?tipo=oferta,suplencia,colaboracion&especialidad=2&ciudad=Barcelona&radioKm=25…`
- `GET /publicaciones/:id` — Detalle de una publicación
- `POST /publicaciones` / `PUT /publicaciones/:id` / `DELETE /publicaciones/:id` — Crear, editar y eliminar (requiere JWT; incluye suplencias por días y colaboraciones por día de la semana)
- `GET /publicaciones/:id/compatibilidad` — % de encaje con desglose para el dentista autenticado
- `POST /publicaciones/:id/vista` / `GET /publicaciones/:id/estadisticas` — Vistas y estadísticas de postulantes (solo dueño)

### Disponibilidad y matching
- `GET /disponibilidad` / `PUT /disponibilidad` — Calendario de disponibilidad del dentista para suplencias
- `GET /disponibilidad-semanal` / `PUT /disponibilidad-semanal` — Disponibilidad recurrente para colaboraciones
- `GET /suplencias/calendario` / `GET /colaboraciones/calendario` — Vista de calendario mensual
- `GET /suplencias/:id/dentistas-disponibles` / `GET /colaboraciones/:id/dentistas-disponibles` — Dentistas que casan con una publicación (dueño)

### Notificaciones y onboarding
- `GET /notificaciones` / `PUT /notificaciones/leer` — Campana de notificaciones in-app
- `GET /onboarding` — Estado de los primeros pasos (perfil, disponibilidad, primera publicación…)

### Mensajes y chat
- `POST /mensajes` / `GET /mensajes/:publicacion_id` — Contacto directo sobre una publicación
- `GET /chat/conversaciones` / `GET|POST /chat/con/:otroId` — Chat interno en tiempo real
- `POST /chat/escribiendo` / `GET /chat/no-leidos` — Indicador de "escribiendo…" y contador de no leídos

### Candidaturas y reseñas
- `POST /candidaturas` / `PUT /candidaturas/:id` / `DELETE /candidaturas/:id` — Postularse y gestionar el estado (pendiente, CV visto, entrevista, aceptada…)
- `GET /publicaciones/:id/candidatos` — Candidatos de una oferta (dueño)
- `POST /resenyas` / `GET /resenyas/usuario/:id` — Reseñas bidireccionales tras una candidatura aceptada

### Perfil, trayectoria y archivos
- `GET /perfiles` / `GET /usuarios/:id/publico` / `GET /usuarios/:id/trayectoria` — Fichas navegables y perfil público
- `POST/PUT/DELETE /experiencia-laboral`, `/formacion`, `/idiomas` — Trayectoria profesional
- `POST /contactos-perfil` — Postularse directamente a una ficha de perfil
- `POST /archivos/upload` — Subir CV, portfolio o foto/logo
- `GET /archivos/book/:userId.zip` — Descargar el Book (portfolio) en zip

### Sedes
- `POST /sedes` / `GET /sedes` / `PUT /sedes/:id` / `DELETE /sedes/:id` — Sedes de una clínica; las ofertas pueden asociarse con `sede_id`

### Exportación
- `GET /exportar/:vista.csv` — Exportar cualquier vista de listado (postulaciones, publicaciones, dentistas…) a CSV

### Páginas públicas (SEO)
- `GET /oferta/:id` — Página pública de una oferta o suplencia activa, sin necesidad de cuenta
- `GET /sitemap.xml` / `GET /robots.txt` — SEO

### Administración
Requieren la cabecera `X-Admin-Token` con el valor de `ADMIN_TOKEN` (ver `.env.example`).
- `POST /admin/matching-suplencias` / `POST /admin/matching-colaboraciones` — Digest diario de matching, pensado para dispararse desde `.github/workflows/matching-suplencias.yml`
- `POST /admin/enviar-resumen-semanal` — Resumen semanal de coincidencias por email, desde `.github/workflows/resumen-semanal.yml`

## Desarrollo futuro

- [ ] Publicaciones destacadas / planes de suscripción

## Licencia

MIT
