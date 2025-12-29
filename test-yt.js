const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

async function test() {
    const query = "Too sweet Hozier official audio";
    const cmd = `python -m yt_dlp "ytsearch1:${query}" --get-title --get-id --get-url --no-playlist --no-warnings -f "bestaudio/best"`;

    console.log("🔍 Probando comando:", cmd);

    try {
        const { stdout, stderr } = await execAsync(cmd);
        console.log("✅ SALIDA:\n", stdout);
        if (stderr) console.log("⚠️ STDERR:\n", stderr);

        const lines = stdout.trim().split('\n');
        console.log("📊 Líneas encontradas:", lines.length);
    } catch (e) {
        console.error("❌ ERROR CRÍTICO:\n", e.message);
    }
}

test();
