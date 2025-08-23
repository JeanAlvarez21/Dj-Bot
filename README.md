# DJ Bot - Bot de Música para Discord

Un bot de música completo para Discord usando DisTube, con soporte para YouTube y Spotify.

## 🚀 Despliegue en Railway

### Pasos para desplegar:

1. **Conecta tu repositorio a Railway:**
   - Ve a [Railway](https://railway.app/)
   - Conecta tu cuenta de GitHub
   - Selecciona este repositorio

2. **Configura las variables de entorno:**
   En el panel de Railway, agrega estas variables:
   ```
   DISCORD_BOT_TOKEN=tu_token_de_discord
   CLIENT_ID=tu_client_id_de_discord
   GUILD_ID=tu_guild_id (opcional, para comandos de servidor específico)
   NODE_ENV=production
   ```

3. **El despliegue es automático:**
   - Railway detectará automáticamente que es un proyecto Node.js
   - Usará el archivo `nixpacks.toml` para instalar ffmpeg
   - Ejecutará `npm ci` y luego `node index.js`

### ✅ Solución para ffmpeg

Este bot requiere ffmpeg para procesar audio. La configuración incluye:

- **nixpacks.toml**: Instala ffmpeg en el entorno de Railway
- **Dockerfile**: Alternativa con Alpine Linux + ffmpeg
- **ffmpeg-static**: Dependencia de npm como respaldo

Railway automáticamente manejará la instalación de ffmpeg usando Nixpacks.

### 🎵 Características

- Reproducción de música desde YouTube
- Soporte para Spotify (con credenciales opcionales)
- Controles interactivos con botones
- Cola de reproducción
- Comandos slash de Discord

### 🔧 Comandos disponibles

- `/play [canción]` - Reproduce una canción
- `/skip` - Salta la canción actual
- `/stop` - Detiene la reproducción
- `/queue` - Muestra la cola
- `/volume [nivel]` - Ajusta el volumen

### 📝 Notas importantes

1. **Token del bot**: Asegúrate de que tu bot tenga los permisos necesarios en Discord
2. **ffmpeg**: Se instala automáticamente en Railway
3. **Memoria**: El bot puede usar bastante memoria procesando audio
4. **Límites**: Railway tiene límites de tiempo de ejecución en el plan gratuito

### 🐛 Solución de problemas

Si tienes problemas con ffmpeg:
1. Verifica que `nixpacks.toml` esté en la raíz del proyecto
2. Revisa los logs de Railway para errores de instalación
3. La dependencia `ffmpeg-static` funciona como respaldo
