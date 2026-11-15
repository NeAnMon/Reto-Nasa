#!/bin/sh
# Entrypoint de la imagen Docker de AstroVital.
#
# Arrancando como root: crea el directorio de adjuntos y corrige SOLO lo que la aplicación necesita
# escribir y no pertenece ya al usuario 'astrovital':
#   - el directorio /app/data (no recursivo),
#   - la BD SQLite y sus archivos -journal/-wal/-shm, si viven dentro de /app/data,
#   - el directorio de adjuntos (UPLOAD_DIR) y los archivos de dentro que no sean ya de 'astrovital'.
# Nunca cambia el propietario de otros archivos del volumen (importante con bind mounts: el uid del
# contenedor se ve tal cual en el host). Después baja a 'astrovital' con setpriv.
# Si el contenedor ya arranca con otro usuario (--user / user:), no toca permisos: solo crea UPLOAD_DIR.
set -e

APP_USER=astrovital
DATA_DIR=/app/data
UPLOAD_DIR="${UPLOAD_DIR:-$DATA_DIR/uploads}"

mkdir -p "$UPLOAD_DIR"

if [ "$(id -u)" = 0 ]; then
    uid="$(id -u "$APP_USER")"
    gid="$(id -g "$APP_USER")"

    fix_owner() {
        if [ -e "$1" ] && [ "$(stat -c %u "$1")" != "$uid" ]; then
            chown "$uid:$gid" "$1"
        fi
    }

    fix_owner "$DATA_DIR"

    case "${DATABASE_URL:-}" in
        sqlite:///*)
            db_path="${DATABASE_URL#sqlite:///}"
            case "$db_path" in
                /*) ;;
                *) db_path="/app/${db_path#./}" ;;
            esac
            case "$db_path" in
                "$DATA_DIR"/*)
                    for f in "$db_path" "$db_path-journal" "$db_path-wal" "$db_path-shm"; do
                        fix_owner "$f"
                    done
                    ;;
            esac
            ;;
    esac

    if [ "$UPLOAD_DIR" != "/" ]; then
        find "$UPLOAD_DIR" ! -user "$uid" -exec chown "$uid:$gid" {} +
        if [ "$(stat -c %a "$UPLOAD_DIR")" != 700 ]; then
            chmod 700 "$UPLOAD_DIR"
        fi
    fi

    exec setpriv --reuid="$uid" --regid="$gid" --init-groups "$@"
fi

exec "$@"
