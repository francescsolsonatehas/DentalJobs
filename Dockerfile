# Imagen del backend, necesaria solo para tener Ghostscript disponible en producción
# (compresión de PDF, ver backend/pdfs.js): el runtime "Node" nativo de Render no
# permite instalar herramientas de sistema. Todo lo demás (arranque, puerto, cómo
# lee las variables de entorno) es idéntico al despliegue sin Docker.
#
# En Render: cambiar el servicio a "Docker" y apuntar a este Dockerfile en la raíz
# del repo (Docker Build Context: raíz del repo).
FROM node:20-slim

# Ghostscript: compresión de PDF. ca-certificates: llamadas HTTPS salientes
# (Turso, Brevo) desde este runtime más pelado que la imagen "node" completa.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ghostscript \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Capa de dependencias separada del código: así un cambio en el código no obliga
# a reinstalar node_modules en cada build.
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/ ./
COPY frontend/ ../frontend/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
