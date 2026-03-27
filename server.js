const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const API_KEY = process.env.API_KEY;

app.post('/extract', async (req, res) => {
  // Auth check
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { url, format = 'mp3' } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }

  const tmpId = crypto.randomBytes(8).toString('hex');
  const outDir = path.join('/tmp', tmpId);
  fs.mkdirSync(outDir, { recursive: true });

  const outTemplate = path.join(outDir, `audio.%(ext)s`);

  try {
    // Extract audio with yt-dlp
    await new Promise((resolve, reject) => {
      execFile('yt-dlp', [
        '-x',
        '--audio-format', format,
        '--audio-quality', '0',
        '--no-playlist',
        '--max-filesize', '50m',
        '-o', outTemplate,
        url,
      ], { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });

    // Find the output file
    const files = fs.readdirSync(outDir);
    const audioFile = files.find(f => f.startsWith('audio.'));
    if (!audioFile) {
      return res.status(500).json({ error: 'No audio file produced' });
    }

    const filePath = path.join(outDir, audioFile);

    // Get duration via ffprobe
    let duration = 0;
    try {
      duration = await new Promise((resolve, reject) => {
        execFile('ffprobe', [
          '-v', 'error',
          '-show_entries', 'format=duration',
          '-of', 'csv=p=0',
          filePath,
        ], (err, stdout) => {
          if (err) reject(err);
          else resolve(parseFloat(stdout.trim()) || 0);
        });
      });
    } catch (_) { /* duration stays 0 */ }

    const stat = fs.statSync(filePath);
    res.set({
      'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
      'Content-Length': stat.size,
      'X-Duration': String(duration),
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('end', () => {
      // Cleanup
      fs.rmSync(outDir, { recursive: true, force: true });
    });
  } catch (err) {
    // Cleanup on error
    fs.rmSync(outDir, { recursive: true, force: true });
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`yt-extractor listening on ${PORT}`));
