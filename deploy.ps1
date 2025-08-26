Write-Host "🚀 Desplegando DJ Bot en Railway..." -ForegroundColor Green

# Verificar que estamos en el directorio correcto
if (-Not (Test-Path "package.json")) {
    Write-Host "❌ Error: No se encontró package.json. Ejecuta este script desde la raíz del proyecto." -ForegroundColor Red
    exit 1
}

Write-Host "✅ Verificando dependencias..." -ForegroundColor Yellow
npm ci

Write-Host "✅ Verificando sintaxis del código..." -ForegroundColor Yellow
node -c index.js

Write-Host "📝 Archivos de configuración creados:" -ForegroundColor Cyan
Write-Host "   - railway.json (configuración de Railway)"
Write-Host "   - nixpacks.toml (configuración de Nixpacks con ffmpeg)"
Write-Host "   - Dockerfile (alternativa de Docker)"
Write-Host "   - .env.example (ejemplo de variables de entorno)"

Write-Host ""
Write-Host "🎯 Próximos pasos para desplegar en Railway:" -ForegroundColor Magenta
Write-Host ""
Write-Host "1. Ve a https://railway.app y conecta tu cuenta de GitHub" -ForegroundColor White
Write-Host "2. Selecciona este repositorio (Dj-Bot)" -ForegroundColor White
Write-Host "3. Configura las siguientes variables de entorno en Railway:" -ForegroundColor White
Write-Host "   DISCORD_BOT_TOKEN=tu_token_aquí" -ForegroundColor Yellow
Write-Host "   CLIENT_ID=tu_client_id_aquí" -ForegroundColor Yellow
Write-Host "   GUILD_ID=tu_guild_id_aquí" -ForegroundColor Yellow
Write-Host "   NODE_ENV=production" -ForegroundColor Yellow
Write-Host ""
Write-Host "4. Railway detectará automáticamente el proyecto y lo desplegará" -ForegroundColor White
Write-Host "5. El archivo nixpacks.toml instalará ffmpeg automáticamente" -ForegroundColor White
Write-Host ""
Write-Host "✅ ¡Tu bot está listo para desplegar!" -ForegroundColor Green

# Mostrar el contenido del .env actual (sin tokens sensibles)
Write-Host ""
Write-Host "📋 Variables de entorno actuales:" -ForegroundColor Cyan
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match "^(CLIENT_ID|GUILD_ID)=") {
            Write-Host "   $_" -ForegroundColor Green
        } elseif ($_ -match "^DISCORD_BOT_TOKEN=") {
            Write-Host "   DISCORD_BOT_TOKEN=***CONFIGURADO***" -ForegroundColor Green
        } elseif ($_ -match "^#") {
            Write-Host "   $_" -ForegroundColor Gray
        }
    }
}

Write-Host ""
Write-Host "Enlaces utiles:" -ForegroundColor Blue
Write-Host "   - Railway: https://railway.app"
Write-Host "   - Discord Developer Portal: https://discord.com/developers/applications"
Write-Host "   - Documentacion del bot: README.md"
