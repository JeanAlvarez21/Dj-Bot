# Especifica la versión de Node.js
FROM node:20-alpine

# Instalar ffmpeg y dependencias necesarias
RUN apk add --no-cache ffmpeg

# Crear directorio de la aplicación
WORKDIR /usr/src/app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias
RUN npm ci --only=production

# Copiar el código de la aplicación
COPY . .

# Exponer puerto (aunque Discord bots no necesitan puerto específico)
EXPOSE 3000

# Comando para ejecutar la aplicación
CMD ["node", "index.js"]
