FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY frontend ./frontend
COPY scripts ./scripts
COPY migrations ./migrations
COPY .env.example ./.env

# Usuario sin privilegios para el proceso de la aplicación. uid/gid fijos (999 por defecto, el mismo que
# asignaban las versiones anteriores); con un bind mount puede alinearlos con su usuario del host:
#   docker build --build-arg APP_UID=$(id -u) --build-arg APP_GID=$(id -g) ...
ARG APP_UID=999
ARG APP_GID=999
RUN groupadd --system --gid "$APP_GID" astrovital \
    && useradd --system --uid "$APP_UID" --gid astrovital --home-dir /app --shell /usr/sbin/nologin astrovital \
    && mkdir -p /app/data/uploads \
    && chown -R astrovital:astrovital /app/data \
    && chmod 700 /app/data/uploads

# Todo lo persistente vive en el volumen /app/data: BD SQLite y adjuntos (fotos / notas de voz).
# DATABASE_URL por defecto dentro del volumen (sin ella, la BD iría a /app, que no es escribible por 'astrovital').
ENV DATABASE_URL=sqlite:////app/data/astrovital.db
ENV UPLOAD_DIR=/app/data/uploads

EXPOSE 8000

# Al arrancar como root: crea el directorio de adjuntos, corrige el propietario solo de lo que no es ya de
# 'astrovital' (directorio /app/data sin recursión, BD SQLite y adjuntos) y baja a 'astrovital' con setpriv.
# Si el contenedor ya arranca con otro usuario (--user), solo crea el directorio y ejecuta el comando.
ENTRYPOINT ["/bin/sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
