# Usar una imagen base con Node.js y ffmpeg precompilado
FROM node:20-bullseye-slim

# Instalar dependencias del sistema necesarias
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Instalar yt-dlp (versión específica que funciona sin warnings)
RUN pip3 install yt-dlp==2024.8.6

# Crear directorio de trabajo
WORKDIR /usr/src/app

# Copiar archivos de configuración
COPY package*.json ./

# Instalar dependencias de Node.js
RUN npm install -g npm@latest
RUN npm ci --only=production && npm cache clean --force

# Copiar código fuente
COPY . .

# Variables de entorno
ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg

# Comando de inicio
CMD ["node", "index.js"]
