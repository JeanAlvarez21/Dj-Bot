require("dotenv").config();

// Test de conexión simple
const { Client, GatewayIntentBits } = require("discord.js");

const TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

console.log("🔍 Variables de entorno:");
console.log("TOKEN presente:", !!TOKEN);
console.log("TOKEN length:", TOKEN ? TOKEN.length : 0);
console.log("CLIENT_ID presente:", !!CLIENT_ID);

if (!TOKEN) {
  console.error("❌ Error: No se encontró el token");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once('ready', () => {
  console.log('✅ Bot conectado exitosamente como:', client.user.tag);
  console.log('🆔 ID del bot:', client.user.id);
  process.exit(0);
});

client.on('error', (error) => {
  console.error('❌ Error de conexión:', error.message);
  process.exit(1);
});

console.log("🚀 Intentando conectar...");
client.login(TOKEN).catch(error => {
  console.error('❌ Error al hacer login:', error.message);
  process.exit(1);
});
