require("dotenv").config();

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");
const { DisTube } = require("distube");
const { SpotifyPlugin } = require("@distube/spotify");
const { YouTubePlugin } = require("@distube/youtube");

// --- Variables de entorno ---
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// --- Crear cliente ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// --- Inicializar DisTube (sin ffmpegPath) ---
client.distube = new DisTube(client, {
  plugins: [new SpotifyPlugin(), new YouTubePlugin()],
});

// --- Eventos de música ---
client.distube
  .on("playSong", (queue, song) => {
    console.log(`🎶 REPRODUCIENDO: ${song.name} - Duración: ${song.formattedDuration}`);
    queue.textChannel?.send(`🎶 Reproduciendo: **${song.name}** \`${song.formattedDuration}\``).catch(() => {});
  })
  .on("addSong", (queue, song) => {
    console.log(`➕ Canción añadida: ${song.name}`);
    queue.textChannel?.send(`➕ Añadida a la cola: **${song.name}**`).catch(() => {});
  })
  .on("addList", (queue, playlist) => {
    console.log(`🧾 Playlist añadida: ${playlist.name}`);
    queue.textChannel?.send(`🧾 Playlist añadida: **${playlist.name}** (${playlist.songs.length} canciones)`).catch(() => {});
  })
  .on("finish", queue => {
    console.log("✅ Cola terminada");
    queue.textChannel?.send("✅ Cola terminada").catch(() => {});
  })
  .on("empty", queue => {
    console.log("📭 Canal de voz vacío, deteniendo música");
    queue.textChannel?.send("📭 Canal de voz vacío, parando música...").catch(() => {});
  })
  .on("disconnect", queue => {
    console.log("🔌 Bot desconectado del canal de voz");
    queue.textChannel?.send("🔌 Desconectado del canal de voz").catch(() => {});
  })
  .on("noRelated", queue => {
    console.log("❌ No se encontraron canciones relacionadas");
    queue.textChannel?.send("❌ No se pudieron encontrar canciones relacionadas").catch(() => {});
  })
  .on("error", (textChannel, error) => {
    console.error("❌ DisTube Error:", error);
    if (textChannel && typeof textChannel.send === 'function') {
      textChannel.send(`⚠️ Error: \`${String(error.message).slice(0, 150)}\``).catch(() => {});
    }
  });

// --- Slash commands ---
const commands = [
  new SlashCommandBuilder()
    .setName("p")
    .setDescription("Reproduce una canción o playlist (YouTube/Spotify o nombre)")
    .addStringOption(o => o.setName("cancion").setDescription("Nombre o link (YouTube/Spotify)").setRequired(true)),
  new SlashCommandBuilder().setName("skip").setDescription("Saltar canción actual"),
  new SlashCommandBuilder().setName("pause").setDescription("Pausar la canción"),
  new SlashCommandBuilder().setName("resume").setDescription("Reanudar la canción"),
  new SlashCommandBuilder().setName("stop").setDescription("Detener y vaciar la cola"),
  new SlashCommandBuilder().setName("queue").setDescription("Ver la cola actual"),
  new SlashCommandBuilder().setName("join").setDescription("Unir el bot al canal de voz"),
  new SlashCommandBuilder().setName("status").setDescription("Ver el estado del bot y conexión de audio"),
].map(c => c.toJSON());

// Registrar comandos
const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  try {
    console.log("⚙️ Registrando slash commands (servidor)...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Slash commands listos en el servidor");
  } catch (e) {
    console.error("Error registrando comandos:", e);
  }
})();

// --- Manejo de interacciones ---
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const name = interaction.commandName;

  try {
    if (name === "p") {
      const query = interaction.options.getString("cancion", true);
      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel) return interaction.reply({ content: "❌ Debes estar en un canal de voz.", ephemeral: true });

      const permissions = voiceChannel.permissionsFor(client.user);
      if (!permissions.has(['Connect', 'Speak'])) {
        return interaction.reply({ content: "❌ No tengo permisos para conectar o hablar en este canal de voz.", ephemeral: true });
      }

      await interaction.reply(`🔎 Buscando: **${query}**`);
      await client.distube.play(voiceChannel, query, { textChannel: interaction.channel, member: interaction.member });
    }

    if (name === "skip") {
      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply({ content: "❌ No hay música en la cola.", ephemeral: true });
      await queue.skip();
      return interaction.reply("⏭️ Saltado.");
    }

    if (name === "pause") {
      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply({ content: "❌ No hay música reproduciéndose.", ephemeral: true });
      queue.pause();
      return interaction.reply("⏸️ Pausado.");
    }

    if (name === "resume") {
      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply({ content: "❌ No hay música reproduciéndose.", ephemeral: true });
      queue.resume();
      return interaction.reply("▶️ Reanudado.");
    }

    if (name === "stop") {
      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply({ content: "❌ No hay música reproduciéndose.", ephemeral: true });
      queue.stop();
      return interaction.reply("🛑 Detenido y cola vaciada.");
    }

    if (name === "queue") {
      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || !queue.songs.length) return interaction.reply({ content: "🕳️ Cola vacía.", ephemeral: true });

      const list = queue.songs.slice(0, 10).map((s, i) => `${i === 0 ? "▶️" : `${i}.`} ${s.name} \`${s.formattedDuration}\``).join("\n");
      return interaction.reply({ content: `📜 **Cola (top 10)**\n${list}` });
    }

    if (name === "join") {
      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel) return interaction.reply({ content: "❌ Debes estar en un canal de voz.", ephemeral: true });

      await interaction.reply("🔗 Intentando conectar...");
      await client.distube.voices.join(voiceChannel);
      await interaction.followUp("✅ Conectado correctamente! Ahora prueba `/p`");
    }

    if (name === "status") {
      const queue = client.distube.getQueue(interaction.guildId);
      const voiceChannel = interaction.member.voice.channel;

      let status = "📊 **Estado del Bot**\n";
      status += `🤖 Bot conectado: ✅\n`;
      status += `👤 Usuario en canal de voz: ${voiceChannel ? `✅ ${voiceChannel.name}` : '❌'}\n`;
      status += `🎵 Cola activa: ${queue ? '✅' : '❌'}\n`;

      if (queue) {
        status += `🎶 Reproduciendo: ${queue.playing ? '✅' : '❌'}\n`;
        status += `⏸️ Pausado: ${queue.paused ? '✅' : '❌'}\n`;
        status += `📝 Canciones en cola: ${queue.songs.length}\n`;
        if (queue.songs.length > 0) status += `🎵 Canción actual: ${queue.songs[0].name}\n`;
      }

      return interaction.reply({ content: status, ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    if (interaction.deferred || interaction.replied) {
      interaction.followUp({ content: "⚠️ Ocurrió un error ejecutando el comando." }).catch(() => {});
    } else {
      interaction.reply({ content: "⚠️ Ocurrió un error ejecutando el comando.", ephemeral: true }).catch(() => {});
    }
  }
});

client.once("ready", () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
  console.log(`🎵 DisTube configurado correctamente`);
  console.log(`📡 El bot está en ${client.guilds.cache.size} servidor(es)`);
});

client.login(TOKEN);
