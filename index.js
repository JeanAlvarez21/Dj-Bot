require("dotenv").config();

const ffmpegPath = require("ffmpeg-static");
const { generateDependencyReport } = require("@discordjs/voice");

console.log("🔎 Reporte de dependencias de voz:\n", generateDependencyReport());
console.log("✅ FFmpeg encontrado en:", ffmpegPath);


const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
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

// --- Inicializar DisTube ---
const distube = new DisTube(client, {
  plugins: [new SpotifyPlugin(), new YouTubePlugin()],
  ytdlOptions: {
    ffmpeg: ffmpegPath,
    filter: "audioonly",
    quality: "highestaudio",
    highWaterMark: 1 << 25,
  },
});

// --- Almacenar mensajes de control activos ---
const activeControlMessages = new Map(); // guildId -> { message, channel }
const progressUpdateIntervals = new Map(); // guildId -> intervalId

// --- Función para crear botones de control ---
function createMusicControlButtons(queue) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music_pause_resume')
      .setLabel(queue?.paused ? '▶️ Reanudar' : '⏸️ Pausar')
      .setStyle(queue?.paused ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music_skip')
      .setLabel('⏭️ Saltar')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('music_stop')
      .setLabel('🛑 Detener')
      .setStyle(ButtonStyle.Danger)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music_queue')
      .setLabel('📜 Ver Cola')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music_clear_queue')
      .setLabel('🗑️ Limpiar Cola')
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

// --- Función para crear embed de música ---
function createMusicEmbed(song, queue) {
  const embed = new EmbedBuilder()
    .setColor(0x00FF00)
    .setTitle('🎶 Panel de Control')
    .setDescription(`**Sonando:** ${song.name}`)
    .addFields(
      { name: '⏱️ Duración:', value: song.formattedDuration, inline: true },
      { name: '👤 Solicitado por:', value: song.user.displayName, inline: true },
      { name: '📊 Estado:', value: queue?.paused ? '⏸️ Pausado' : '▶️ Reproduciendo', inline: true }
    )
    .setThumbnail(song.thumbnail)
    .setTimestamp();

  // Mostrar progreso de la canción
  const currentTime = queue?.currentTime || 0;
  const duration = song.duration;
  const progressBar = createProgressBar(currentTime, duration);
  const currentFormatted = formatTime(currentTime);
  
  embed.addFields({
    name: '🎵 Progreso',
    value: `${currentFormatted} ${progressBar} ${song.formattedDuration}`,
    inline: false
  });

  // Mostrar siguiente canción si existe
  if (queue?.songs.length > 1) {
    const nextSong = queue.songs[1];
    embed.addFields(
      { name: '📝 Canciones en cola', value: `${queue.songs.length - 1}`, inline: true },
      { 
        name: '⏭️ Sigue:', 
        value: `**${nextSong.name.length > 40 ? nextSong.name.slice(0, 40) + '...' : nextSong.name}**\n👤pedida por: ${nextSong.user.displayName}`, 
        inline: true 
      }
    );
  } else {
    embed.addFields({ name: '📝 Canciones en cola', value: '0', inline: true });
  }

  return embed;
}

// --- Función para crear barra de progreso ---
function createProgressBar(current, total, length = 20) {
  if (!total || total === 0) return '▬'.repeat(length);
  
  const progress = Math.min(current / total, 1);
  const filledLength = Math.round(progress * length);
  const emptyLength = length - filledLength;
  
  const filled = '🟩'.repeat(Math.max(0, filledLength));
  const empty = '⬜'.repeat(Math.max(0, emptyLength));
  
  return filled + empty;
}

// --- Función para formatear tiempo ---
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// --- Función para actualizar o crear el panel de control ---
async function updateControlPanel(queue, song) {
  const guildId = queue.id;
  const channel = queue.textChannel;
  
  if (!channel) return;

  const embed = createMusicEmbed(song, queue);
  const buttons = createMusicControlButtons(queue);
  
  try {
    // Si existe un mensaje de control anterior, intentar eliminarlo
    const existingControl = activeControlMessages.get(guildId);
    if (existingControl && existingControl.message) {
      try {
        await existingControl.message.delete();
      } catch (error) {
        // Mensaje ya eliminado o no accesible
      }
    }

    // Crear nuevo mensaje de control
    const newControlMessage = await channel.send({
      embeds: [embed],
      components: buttons
    });

    // Guardar referencia del nuevo mensaje
    activeControlMessages.set(guildId, {
      message: newControlMessage,
      channel: channel
    });

    // Iniciar actualización de progreso
    startProgressUpdate(queue, song);

  } catch (error) {
    console.error('Error actualizando panel de control:', error);
  }
}

// --- Función para iniciar actualización de progreso ---
function startProgressUpdate(queue, song) {
  const guildId = queue.id;
  
  // Limpiar intervalo anterior si existe
  stopProgressUpdate(guildId);
  
  const interval = setInterval(async () => {
    try {
      const currentQueue = client.distube.getQueue(guildId);
      if (!currentQueue || !currentQueue.playing || currentQueue.paused) return;
      
      const controlData = activeControlMessages.get(guildId);
      if (!controlData || !controlData.message) {
        stopProgressUpdate(guildId);
        return;
      }

      const updatedEmbed = createMusicEmbed(song, currentQueue);
      const buttons = createMusicControlButtons(currentQueue);
      
      await controlData.message.edit({
        embeds: [updatedEmbed],
        components: buttons
      });
      
    } catch (error) {
      // Si hay error, detener las actualizaciones
      stopProgressUpdate(guildId);
    }
  }, 5000); // Actualizar cada 5 segundos
  
  progressUpdateIntervals.set(guildId, interval);
}

// --- Función para detener actualización de progreso ---
function stopProgressUpdate(guildId) {
  const interval = progressUpdateIntervals.get(guildId);
  if (interval) {
    clearInterval(interval);
    progressUpdateIntervals.delete(guildId);
  }
}

// --- Función para limpiar panel de control ---
async function clearControlPanel(guildId) {
  // Detener actualizaciones de progreso
  stopProgressUpdate(guildId);
  
  const existingControl = activeControlMessages.get(guildId);
  if (existingControl && existingControl.message) {
    try {
      await existingControl.message.delete();
    } catch (error) {
      // Mensaje ya eliminado
    }
    activeControlMessages.delete(guildId);
  }
}

// --- Eventos de música ---
client.distube
  .on("playSong", (queue, song) => {
    console.log(`🎶 REPRODUCIENDO: ${song.name} - Duración: ${song.formattedDuration}`);
    
    // Enviar mensaje simple de "reproduciendo" sin botones
    queue.textChannel?.send(`🎶 Reproduciendo: **${song.name}** \`${song.formattedDuration}\``).catch(console.error);
    
    // Actualizar panel de control (siempre al final)
    updateControlPanel(queue, song);
  })
  .on("addSong", (queue, song) => {
    console.log(`➕ Canción añadida: ${song.name}`);
    queue.textChannel?.send(`➕ Añadida a la cola: **${song.name}**`).catch(() => {});
    
    // Actualizar panel para mostrar nueva información de cola
    if (queue.songs.length > 1) { // Solo si hay más de una canción
      updateControlPanel(queue, queue.songs[0]);
    }
  })
  .on("addList", (queue, playlist) => {
    console.log(`🧾 Playlist añadida: ${playlist.name}`);
    queue.textChannel?.send(`🧾 Playlist añadida: **${playlist.name}** (${playlist.songs.length} canciones)`).catch(() => {});
    
    // Actualizar panel después de agregar playlist
    updateControlPanel(queue, queue.songs[0]);
  })
  .on("finish", queue => {
    console.log("✅ Cola terminada");
    queue.textChannel?.send("✅ Cola terminada").catch(() => {});
    
    // Limpiar panel de control
    clearControlPanel(queue.id);
  })
  .on("empty", queue => {
    console.log("📭 Canal de voz vacío, deteniendo música");
    queue.textChannel?.send("📭 Canal de voz vacío, parando música...").catch(() => {});
    
    // Limpiar panel de control
    clearControlPanel(queue.id);
  })
  .on("disconnect", queue => {
    console.log("🔌 Bot desconectado del canal de voz");
    queue.textChannel?.send("🔌 Desconectado del canal de voz").catch(() => {});
    
    // Limpiar panel de control
    clearControlPanel(queue.id);
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

// --- Slash commands (solo los necesarios) ---
const commands = [
  new SlashCommandBuilder()
    .setName("p")
    .setDescription("Reproduce una canción o playlist (YouTube/Spotify o nombre)")
    .addStringOption(o => o.setName("cancion").setDescription("Nombre o link (YouTube/Spotify)").setRequired(true)),
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

// --- Manejo de interacciones (comandos slash) ---
client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
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
  }

  // --- Manejo de botones ---
  if (interaction.isButton()) {
    const queue = client.distube.getQueue(interaction.guildId);
    
    try {
      switch (interaction.customId) {
        case 'music_pause_resume':
          if (!queue) return interaction.reply({ content: "❌ No hay música reproduciéndose.", ephemeral: true });
          
          if (queue.paused) {
            queue.resume();
            await interaction.reply({ content: "▶️ Música reanudada.", ephemeral: true });
            // Reanudar actualizaciones de progreso
            startProgressUpdate(queue, queue.songs[0]);
          } else {
            queue.pause();
            await interaction.reply({ content: "⏸️ Música pausada.", ephemeral: true });
            // Pausar actualizaciones de progreso
            stopProgressUpdate(queue.id);
          }
          
          // Actualizar panel de control inmediatamente
          updateControlPanel(queue, queue.songs[0]);
          break;

        case 'music_skip':
          if (!queue) return interaction.reply({ content: "❌ No hay música en la cola.", ephemeral: true });
          await queue.skip();
          await interaction.reply({ content: "⏭️ Canción saltada.", ephemeral: true });
          // No necesitamos actualizar aquí porque el evento "playSong" se disparará
          break;

        case 'music_stop':
          if (!queue) return interaction.reply({ content: "❌ No hay música reproduciéndose.", ephemeral: true });
          queue.stop();
          await interaction.reply({ content: "🛑 Música detenida y cola vaciada.", ephemeral: true });
          // El panel se limpiará automáticamente con el evento "finish"
          break;

        case 'music_queue':
          if (!queue || !queue.songs.length) return interaction.reply({ content: "🕳️ Cola vacía.", ephemeral: true });

          const queueEmbed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('📜 Cola de Reproducción')
            .setDescription(
              queue.songs.slice(0, 10).map((song, i) => 
                `${i === 0 ? "▶️" : `${i}.`} **${song.name}** \`${song.formattedDuration}\``
              ).join('\n')
            )
            .setFooter({ text: `Total: ${queue.songs.length} canción(es)` })
            .setTimestamp();

          if (queue.songs.length > 10) {
            queueEmbed.setFooter({ text: `Mostrando 10 de ${queue.songs.length} canciones` });
          }

          await interaction.reply({ embeds: [queueEmbed], ephemeral: true });
          break;

        case 'music_clear_queue':
          if (!queue || queue.songs.length <= 1) {
            return interaction.reply({ content: "❌ No hay canciones en cola para limpiar.", ephemeral: true });
          }
          
          // Mantener solo la canción actual
          const currentSong = queue.songs[0];
          queue.songs.splice(1); // Eliminar todas excepto la primera
          
          await interaction.reply({ content: `🗑️ Cola limpiada. Solo queda: **${currentSong.name}**`, ephemeral: true });
          
          // Actualizar panel para reflejar la cola limpia
          updateControlPanel(queue, currentSong);
          break;

        default:
          await interaction.reply({ content: "❌ Botón no reconocido.", ephemeral: true });
      }
    } catch (err) {
      console.error('Error manejando botón:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "⚠️ Ocurrió un error procesando el botón.", ephemeral: true });
      }
    }
  }
});

client.once("clientReady", () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
  console.log(`🎵 DisTube configurado correctamente`);
  console.log(`📡 El bot está en ${client.guilds.cache.size} servidor(es)`);
});

client.login(TOKEN);