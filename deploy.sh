#!/bin/bash

echo "🚀 Desplegando DJ Bot en Railway..."

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo "❌ Error: No se encontró package.json. Ejecuta este script desde la raíz del proyecto."
    exit 1
fi

echo "✅ Verificando dependencias..."
npm ci

echo "✅ Verificando sintaxis del código..."
node -c index.js

echo "📝 Archivos de configuración creados:"
echo "   - railway.json (configuración de Railway)"
echo "   - nixpacks.toml (configuración de Nixpacks con ffmpeg)"
echo "   - Dockerfile (alternativa de Docker)"
echo "   - .env.example (ejemplo de variables de entorno)"

echo ""
echo "🎯 Próximos pasos para desplegar en Railway:"
echo ""
echo "1. Ve a https://railway.app y conecta tu cuenta de GitHub"
echo "2. Selecciona este repositorio (Dj-Bot)"
echo "3. Configura las siguientes variables de entorno en Railway:"
echo "   DISCORD_BOT_TOKEN=tu_token_aquí"
echo "   CLIENT_ID=tu_client_id_aquí"  
echo "   GUILD_ID=tu_guild_id_aquí"
echo "   NODE_ENV=production"
echo ""
echo "4. Railway detectará automáticamente el proyecto y lo desplegará"
echo "5. El archivo nixpacks.toml instalará ffmpeg automáticamente"
echo ""
echo "✅ ¡Tu bot está listo para desplegar!"
