require("dotenv").config();

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require("@discordjs/voice");
const { DisTube } = require("distube");
const { SpotifyPlugin } = require("@distube/spotify");
const { YouTubePlugin } = require("@distube/youtube");
const { YtDlpPlugin } = require("@distube/yt-dlp");

// --- Variables de entorno ---
const TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// --- Debug de variables de entorno ---
console.log("🔍 Verificando variables de entorno...");
console.log("TOKEN presente:", !!TOKEN);
console.log("CLIENT_ID presente:", !!CLIENT_ID);
console.log("GUILD_ID presente:", !!GUILD_ID);

if (!TOKEN) {
  console.error("❌ Error: Token de Discord no encontrado!");
  console.error("💡 Asegúrate de configurar DISCORD_BOT_TOKEN en Railway");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("❌ Error: CLIENT_ID no encontrado!");
  process.exit(1);
}

// --- Detectar comando de Python (python3 en Linux, python en Windows) ---
let pythonCommand = 'python3';
try {
  require('child_process').execSync('python3 --version', { stdio: 'ignore' });
} catch {
  pythonCommand = 'python';
}

// --- Función helper para buscar en YouTube con yt-dlp ---
async function searchYouTube(query) {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  try {
    const isUrl = query.startsWith('http');
    const cleanQuery = isUrl ? query : `${query} official audio`;

    // Comando compatible con Windows y Linux
    const cmd = `${pythonCommand} -m yt_dlp "ytsearch1:${cleanQuery.replace(/"/g, '')}" --get-title --get-id --get-url --no-playlist --no-warnings -f "bestaudio/best"`;

    const { stdout } = await execAsync(cmd, { timeout: 15000 });
    const lines = stdout.trim().split('\n');

    if (lines.length >= 3) {
      return {
        title: lines[0],
        url: `https://www.youtube.com/watch?v=${lines[1]}`,
        // En algunas versiones la URL del stream es la última línea
        streamUrl: lines[lines.length - 1]
      };
    }
    return null;
  } catch (error) {
    console.error('❌ Error en búsqueda yt-dlp:', error.message);
    return null;
  }
}

// --- Map para almacenar players activos por guild ---
const activePlayers = new Map(); // guildId -> { player, connection, queue: [], currentIndex, paused, playing }

// --- Función para reproducir siguiente canción en la cola ---
async function playNextInQueue(guildId) {
  const playerData = activePlayers.get(guildId);
  if (!playerData) return;

  const { queue, currentIndex, connection, textChannel } = playerData;

  // Si hay más canciones en la cola
  if (currentIndex + 1 < queue.length) {
    const nextSong = queue[currentIndex + 1];
    playerData.currentIndex++;

    console.log(`▶️ Reproduciendo siguiente: ${nextSong.title}`);
    await clearControlPanel(guildId);
    await startPlayerStream(guildId, nextSong);
  } else {
    // No hay más canciones, limpiar
    try { playerData.connection.destroy(); } catch (e) { }
    activePlayers.delete(guildId);
    clearControlPanel(guildId);
    textChannel?.send('✅ Cola terminada');
  }
}

// --- Función para enviar un nuevo panel de control personalizado ---
async function sendNewCustomControlPanel(guildId, song, textChannel, user) {
  const playerData = activePlayers.get(guildId);
  if (!playerData) return;

  const { queue, currentIndex, paused } = playerData;

  const embed = new EmbedBuilder()
    .setColor(paused ? 0xFFA500 : 0x00FF00)
    .setTitle('🎶 Panel de Control')
    .setDescription(`**Sonando:** ${song.title}`)
    .addFields(
      { name: '⏱️ Duración:', value: song.duration || '02:47', inline: true },
      { name: '👤 Solicitado por:', value: user?.displayName || 'Usuario', inline: true },
      { name: '📊 Estado:', value: paused ? '⏸️ Pausado' : '▶️ Reproduciendo', inline: true },
      { name: '📝 Canciones en cola:', value: `${queue.length - currentIndex - 1}`, inline: false }
    )
    .setTimestamp();

  const buttons = createMusicControlButtons({ paused });

  try {
    const controlMessage = await textChannel.send({
      embeds: [embed],
      components: buttons
    });

    activeControlMessages.set(guildId, {
      message: controlMessage,
      channel: textChannel
    });
  } catch (error) {
    console.error('Error enviando nuevo panel de control:', error);
  }
}

// --- Función para actualizar panel de control personalizado existente ---
function updateCustomControlPanel(guildId, song) {
  const controlData = activeControlMessages.get(guildId);
  const playerData = activePlayers.get(guildId);

  if (!controlData || !playerData) return;

  const { queue, currentIndex, paused } = playerData;

  const embed = new EmbedBuilder()
    .setColor(paused ? 0xFFA500 : 0x4B0082) // Un color diferente para indicar actualización
    .setTitle('🎶 Panel de Control')
    .setDescription(`**Sonando:** ${song.title}`)
    .addFields(
      { name: '⏱️ Duración:', value: song.duration || '02:47', inline: true },
      { name: '👤 Solicitado por:', value: song.user?.displayName || 'Usuario', inline: true },
      { name: '📊 Estado:', value: paused ? '⏸️ Pausado' : '▶️ Reproduciendo', inline: true },
      { name: '📝 Canciones en cola:', value: `${queue.length - currentIndex - 1}`, inline: false }
    )
    .setTimestamp();

  const buttons = createMusicControlButtons({ paused });

  controlData.message.edit({
    embeds: [embed],
    components: buttons
  }).catch(err => {
    console.log('No se pudo editar el panel (tal vez fue borrado), enviando uno nuevo...');
    sendNewCustomControlPanel(guildId, song, controlData.channel, song.user);
  });
}


// --- Función para reproducir stream directo con @discordjs/voice ---
async function playDirectStream(voiceChannel, streamUrl, title, textChannel, user) {
  try {
    const guildId = voiceChannel.guild.id;
    const existingPlayer = activePlayers.get(guildId);

    const song = {
      title,
      streamUrl,
      duration: '02:47',
      user: user || { displayName: 'Usuario' }
    };

    // Si ya existe un player en este servidor, gestionar cola
    if (existingPlayer) {
      existingPlayer.queue.push(song);

      // Si el reproductor estaba parado o terminó, reiniciarlo con la nueva canción
      if (!existingPlayer.player || existingPlayer.player.state.status === AudioPlayerStatus.Idle) {
        existingPlayer.currentIndex = existingPlayer.queue.length - 1;
        await startPlayerStream(guildId, song);
      } else {
        await textChannel.send({
          content: `➕ **${title}** agregado a la cola (Posición: ${existingPlayer.queue.length - existingPlayer.currentIndex - 1})`,
          flags: 64
        }).catch(() => { });
        await updateCustomControlPanel(guildId, existingPlayer.queue[existingPlayer.currentIndex]);
      }
      return true;
    }

    // Si es un inicio limpio, destruir conexiones de DisTube para evitar conflictos
    try { client.distube.voices.leave(voiceChannel.guild.id); } catch (e) { }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    // Inicializar objeto de estado
    activePlayers.set(guildId, {
      connection,
      queue: [song],
      currentIndex: 0,
      paused: false,
      playing: true,
      textChannel,
      player: null
    });

    await startPlayerStream(guildId, song);
    return true;
  } catch (error) {
    console.error('Error en playDirectStream:', error);
    return false;
  }
}

// --- Función para iniciar o cambiar de canción en el stream ---
async function startPlayerStream(guildId, song) {
  const playerData = activePlayers.get(guildId);
  if (!playerData) return;

  try {
    const player = createAudioPlayer();
    const resource = createAudioResource(song.streamUrl);

    player.play(resource);
    playerData.connection.subscribe(player);
    playerData.player = player;
    playerData.playing = true;
    playerData.paused = false;

    // Enviar nuevo panel de control
    await sendNewCustomControlPanel(guildId, song, playerData.textChannel, song.user);

    player.on(AudioPlayerStatus.Idle, () => {
      setTimeout(() => playNextInQueue(guildId), 1000);
    });

    player.on('error', error => {
      console.error('AudioPlayer Error:', error);
      setTimeout(() => playNextInQueue(guildId), 1000);
    });
  } catch (err) {
    console.error('Error al iniciar stream:', err);
    setTimeout(() => playNextInQueue(guildId), 1000);
  }
}

// --- Crear cliente ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// --- Inicializar DisTube ---
client.distube = new DisTube(client, {
  plugins: [
    new SpotifyPlugin(),
    new YouTubePlugin({
      ytdlOptions: {
        quality: 'highestaudio',
        filter: 'audioonly',
        highWaterMark: 1 << 25
      }
    })
  ],
  emitNewSongOnly: true,
  nsfw: false
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
    // console.log(`Iniciando reproducción vía DisTube: ${song.name}`);
  })
  .on("addSong", (queue, song) => {
    // console.log(`➕ Canción añadida: ${song.name}`);
  })
  .on("addList", (queue, playlist) => {
    console.log(`🧾 Playlist añadida: ${playlist.name}`);
    queue.textChannel?.send(`🧾 Playlist añadida: **${playlist.name}** (${playlist.songs.length} canciones)`).catch(() => { });

    // Actualizar panel después de agregar playlist
    updateControlPanel(queue, queue.songs[0]);
  })
  .on("finish", queue => {
    console.log("✅ Cola terminada");
    queue.textChannel?.send("✅ Cola terminada").catch(() => { });

    // Limpiar panel de control
    clearControlPanel(queue.id);
  })
  .on("empty", queue => {
    console.log("📭 Canal de voz vacío, deteniendo música");
    queue.textChannel?.send("📭 Canal de voz vacío, parando música...").catch(() => { });

    // Limpiar panel de control
    clearControlPanel(queue.id);
  })
  .on("disconnect", queue => {
    console.log("🔌 Bot desconectado del canal de voz");
    queue.textChannel?.send("🔌 Desconectado del canal de voz").catch(() => { });

    // Limpiar panel de control
    clearControlPanel(queue.id);
  })
  .on("noRelated", queue => {
    console.log("❌ No se encontraron canciones relacionadas");
    queue.textChannel?.send("❌ No se pudieron encontrar canciones relacionadas").catch(() => { });
  })
  .on("error", (error, queue) => {
    console.error("❌ DisTube Error completo:", error);
    console.error("❌ Stack trace:", error?.stack);
    console.error("❌ Error name:", error?.name);
    console.error("❌ Error message:", error?.message);

    let errorMessage = "⚠️ Error reproduciendo música";

    // Verificar si el error tiene mensaje
    if (error && error.message) {
      if (error.message.includes('Sign in to confirm') || error.message.includes('not a bot')) {
        errorMessage = "❌ YouTube bloqueó el video (detección de bot). Prueba con otra canción o un enlace directo.";
        // Intentar saltar automáticamente con validación
        if (queue && queue.songs && queue.songs.length > 1 && queue.skip) {
          try {
            queue.skip();
          } catch (skipError) {
            console.error("Error saltando canción:", skipError);
          }
        }
      } else if (error.message.includes('unavailable')) {
        errorMessage = "❌ Video no disponible. Prueba con otra canción.";
      } else if (error.message.includes('private')) {
        errorMessage = "❌ Video privado. Prueba con otra canción.";
      } else if (error.message.includes('copyright')) {
        errorMessage = "❌ Video bloqueado por derechos de autor.";
      } else if (error.message.includes('ffmpeg exited with code 1') || error.errorCode === 'FFMPEG_EXITED') {
        errorMessage = "❌ Error de audio en Railway. Intentando saltar...";
        // Intentar saltar la canción automáticamente, pero con validación
        if (queue && queue.songs && queue.songs.length > 1 && queue.skip) {
          try {
            queue.skip();
          } catch (skipError) {
            console.error("Error saltando canción:", skipError);
            // Si no se puede saltar, detener la cola
            if (queue.stop) {
              queue.stop();
            }
          }
        } else if (queue && queue.stop) {
          // Si no hay más canciones, detener completamente
          queue.stop();
        }
      } else if (error.message.includes('ffmpeg')) {
        errorMessage = "❌ Error de procesamiento de audio. Prueba con otra canción.";
      } else {
        errorMessage = `⚠️ Error: ${String(error.message).slice(0, 100)}`;
      }
    }

    // Enviar mensaje al canal
    if (queue && queue.textChannel && typeof queue.textChannel.send === 'function') {
      queue.textChannel.send(errorMessage).catch(() => { });
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
        // Defer la respuesta inmediatamente para evitar timeout
        try {
          await interaction.deferReply();
        } catch (deferError) {
          // Si la interacción ya expiró, ignorar silenciosamente
          if (deferError.code === 10062) {
            console.log("⚠️ Interacción expirada, ignorando comando antiguo");
            return;
          }
          throw deferError;
        }

        const query = interaction.options.getString("cancion", true);
        const voiceChannel = interaction.member.voice.channel;

        if (!voiceChannel) {
          return interaction.editReply({ content: "❌ Debes estar en un canal de voz." });
        }

        const permissions = voiceChannel.permissionsFor(client.user);
        if (!permissions.has(['Connect', 'Speak'])) {
          return interaction.editReply({ content: "❌ No tengo permisos para conectar o hablar en este canal de voz." });
        }

        await interaction.editReply(`🔎 Buscando: **${query}**`);


        try {
          // 1. Manejo prioritario de Spotify
          if (query.includes('spotify.com')) {
            await interaction.editReply(`🟢 Resolviendo link de Spotify...`);
            try {
              const spotifyResult = await client.distube.handler.resolve(query);
              if (spotifyResult) {
                if (spotifyResult.songs) {
                  await interaction.editReply(`🟢 Cargando playlist: **${spotifyResult.name}**`);
                  for (const song of spotifyResult.songs.slice(0, 10)) {
                    const search = await searchYouTube(`${song.name} ${song.uploader?.name || ''}`);
                    if (search) await playDirectStream(voiceChannel, search.streamUrl, search.title, interaction.channel, interaction.member);
                  }
                  return;
                } else {
                  const songName = `${spotifyResult.name} ${spotifyResult.uploader?.name || ''}`;
                  const search = await searchYouTube(songName);
                  if (search) {
                    await playDirectStream(voiceChannel, search.streamUrl, search.title, interaction.channel, interaction.member);
                    return;
                  }
                }
              }
            } catch (err) {
              console.error("Error Spotify:", err);
            }
          }

          // 2. Cualquier otra búsqueda o URL (Todo por nuestro motor yt-dlp)
          const searchResult = await searchYouTube(query);
          if (searchResult) {
            await interaction.editReply(`🎵 Reproduciendo: **${searchResult.title}**`);
            await playDirectStream(voiceChannel, searchResult.streamUrl, searchResult.title, interaction.channel, interaction.member);
          } else {
            await interaction.editReply(`❌ No encontré resultados para: **${query}**`);
          }
        } catch (playError) {
          console.error("Error en play command:", playError);
          await interaction.followUp(`❌ Error al reproducir: ${playError.message || 'Error desconocido'}`);
        }
      }

      if (name === "join") {
        // Defer la respuesta inmediatamente
        try {
          await interaction.deferReply();
        } catch (deferError) {
          // Si la interacción ya expiró, ignorar silenciosamente
          if (deferError.code === 10062) {
            console.log("⚠️ Interacción expirada, ignorando comando antiguo");
            return;
          }
          throw deferError;
        }

        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
          return interaction.editReply({ content: "❌ Debes estar en un canal de voz." });
        }

        await interaction.editReply("🔗 Intentando conectar...");
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

        return interaction.reply({ content: status, flags: 64 });
      }
    } catch (err) {
      console.error(err);
      // Ignorar errores de interacciones expiradas
      if (err.code === 10062) {
        console.log("⚠️ Interacción expirada en catch general");
        return;
      }

      if (interaction.deferred || interaction.replied) {
        interaction.followUp({ content: "⚠️ Ocurrió un error ejecutando el comando." }).catch(() => { });
      } else {
        interaction.reply({ content: "⚠️ Ocurrió un error ejecutando el comando.", flags: 64 }).catch(() => { });
      }
    }
  }

  // --- Manejo de botones ---
  if (interaction.isButton()) {
    const queue = client.distube.getQueue(interaction.guildId);
    const activePlayer = activePlayers.get(interaction.guildId);

    try {
      switch (interaction.customId) {
        case 'music_pause_resume':
          // Intentar con DisTube primero
          if (queue) {
            if (queue.paused) {
              queue.resume();
              await interaction.reply({ content: "▶️ Música reanudada.", flags: 64 });
              startProgressUpdate(queue, queue.songs[0]);
            } else {
              queue.pause();
              await interaction.reply({ content: "⏸️ Música pausada.", flags: 64 });
              stopProgressUpdate(queue.id);
            }
            updateControlPanel(queue, queue.songs[0]);
          }
          // Si no hay queue, intentar con activePlayer
          else if (activePlayer) {
            const { player, queue: playerQueue, currentIndex } = activePlayer;
            if (player.state.status === AudioPlayerStatus.Paused) {
              player.unpause();
              activePlayer.paused = false;
              await interaction.reply({ content: "▶️ Música reanudada.", flags: 64 });
              updateCustomControlPanel(interaction.guildId, playerQueue[currentIndex]);
            } else if (player.state.status === AudioPlayerStatus.Playing) {
              player.pause();
              activePlayer.paused = true;
              await interaction.reply({ content: "⏸️ Música pausada.", flags: 64 });
              updateCustomControlPanel(interaction.guildId, playerQueue[currentIndex]);
            }
          } else {
            return interaction.reply({ content: "❌ No hay música reproduciéndose.", flags: 64 });
          }
          break;

        case 'music_skip':
          if (queue) {
            await queue.skip();
            await interaction.reply({ content: "⏭️ Saltando...", flags: 64 });
          } else if (activePlayer) {
            await interaction.reply({ content: "⏭️ Saltando...", flags: 64 });
            activePlayer.player.stop(); // Esto disparará el evento Idle que llama a playNextInQueue
          } else {
            return interaction.reply({ content: "❌ No hay música reproduciéndose.", flags: 64 });
          }
          break;

        case 'music_stop':
          if (queue) {
            queue.stop();
            await interaction.reply({ content: "🛑 Música detenida y cola vaciada.", flags: 64 });
          } else if (activePlayer) {
            activePlayer.player.stop();
            activePlayer.connection.destroy();
            activePlayers.delete(interaction.guildId);
            clearControlPanel(interaction.guildId);
            await interaction.reply({ content: "🛑 Música detenida y cola vaciada.", flags: 64 });
          } else {
            return interaction.reply({ content: "❌ No hay música reproduciéndose.", flags: 64 });
          }
          break;

        case 'music_queue':
          if (queue && queue.songs.length) {
            const queueEmbed = new EmbedBuilder()
              .setColor(0x0099FF)
              .setTitle('📜 Cola de Reproducción')
              .setDescription(
                queue.songs.slice(0, 10).map((song, i) =>
                  `${i === 0 ? "▶️" : `${i}.`} **${song.name}** \`${song.formattedDuration}\``
                ).join('\n')
              )
              .setFooter({ text: queue.songs.length > 10 ? `Mostrando 10 de ${queue.songs.length} canciones` : `Total: ${queue.songs.length} canción(es)` })
              .setTimestamp();

            await interaction.reply({ embeds: [queueEmbed], flags: 64 });
          } else if (activePlayer && activePlayer.queue.length) {
            const { queue: playerQueue, currentIndex } = activePlayer;
            const upcomingSongs = playerQueue.slice(currentIndex);

            const queueEmbed = new EmbedBuilder()
              .setColor(0x0099FF)
              .setTitle('📜 Cola de Reproducción')
              .setDescription(
                upcomingSongs.slice(0, 10).map((song, i) =>
                  `${i === 0 ? "▶️" : `${i}.`} **${song.title}** \`${song.duration}\``
                ).join('\n')
              )
              .setFooter({ text: upcomingSongs.length > 10 ? `Mostrando 10 de ${upcomingSongs.length} canciones` : `Total: ${upcomingSongs.length} canción(es)` })
              .setTimestamp();

            await interaction.reply({ embeds: [queueEmbed], flags: 64 });
          } else {
            return interaction.reply({ content: "🕳️ Cola vacía.", flags: 64 });
          }
          break;

        case 'music_clear_queue':
          if (queue) {
            const removedCount = queue.songs.length - 1;
            queue.songs = [queue.songs[0]];
            await interaction.reply({ content: `🗑️ Se eliminaron ${removedCount} canción(es) de la cola.`, flags: 64 });
            updateControlPanel(queue, queue.songs[0]);
          } else if (activePlayer) {
            const { queue: playerQueue, currentIndex } = activePlayer;
            const removedCount = playerQueue.length - currentIndex - 1;
            activePlayer.queue = playerQueue.slice(0, currentIndex + 1);
            await interaction.reply({ content: `🗑️ Se eliminaron ${removedCount} canción(es) de la cola.`, flags: 64 });
            updateCustomControlPanel(interaction.guildId, playerQueue[currentIndex]);
          } else {
            return interaction.reply({ content: "❌ No hay música reproduciéndose.", flags: 64 });
          }
          break;

        default:
          await interaction.reply({ content: "❌ Botón no reconocido.", flags: 64 });
      }
    } catch (err) {
      console.error('Error manejando botón:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "⚠️ Ocurrió un error procesando el botón.", flags: 64 });
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