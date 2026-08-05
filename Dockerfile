FROM node:25-slim AS build

# Toolchain als Fallback für native Module: better-sqlite3-multiple-ciphers zieht
# normalerweise ein Prebuild (node-v127-linux-{x64,arm64}); schlägt der Download
# fehl, kompiliert node-gyp aus dem Quellcode. Die Cipher-Schicht steckt im Modul
# selbst - ein System-SQLCipher wird nicht mehr benötigt.
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Abhängigkeiten zuerst (Docker-Layer-Caching)
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Runtime stage ----
FROM node:25-slim

RUN apt-get update && apt-get install -y \
    gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node modules aus Build-Stage kopieren
COPY --from=build /app/node_modules ./node_modules

# Anwendungscode (docs/ wird via .dockerignore ausgeschlossen)
COPY . .

# Daten-Volume-Verzeichnisse anlegen (Permissions werden zur Laufzeit gesetzt)
RUN mkdir -p /data /backups /app/modules /documents

# Container-Default für das Backup-Ziel. Ohne diesen ENV fällt die App auf ihren
# Bare-Metal-Default './backups' (= /app/backups) zurück - dort hat der node-User
# keine Schreibrechte, und die Backups landeten nicht im gemounteten Volume.
# Deployments, die BACKUP_DIR selbst setzen (Compose, TrueNAS, Umbrel, Quadlet),
# überschreiben diesen Wert wie gehabt.
ENV BACKUP_DIR=/backups

# Entrypoint: korrigiert Volume-Permissions und startet als node-User
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server/index.js"]
