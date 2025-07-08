const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

function isValidUrl(userUrl) {
  try {
    const parsed = new URL(userUrl);
    const hostname = parsed.hostname;
    const allowList = ['youtube.com', 'youtu.be', 'www.youtube.com', 'tiktok.com', 'www.tiktok.com'];
    const isSafeDomain = allowList.some(domain => hostname.endsWith(domain));
    const isInternal = /^(localhost|127\.|192\.168\.|10\.)/.test(hostname);
    const isExe = /\.(exe|bat|cmd|zip|msi|sh|php)$/i.test(userUrl);
    return isSafeDomain && !isInternal && !isExe;
  } catch {
    return false;
  }
}

const downloadDir = path.join(__dirname, '../public/downloads');
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

const convertLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 นาที
  max: 5,
  message: {
    error: 'คุณใช้คำสั่งแปลงไฟล์บ่อยเกินไป กรุณารอสักครู่ก่อนทำรายการใหม่'
  }
});

const MAX_SIZE = 100 * 1024 * 1024; // 100MB

async function checkFastEstimate(url, format) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '-f', format === 'mp4'
        ? 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]'
        : 'bestaudio[ext=m4a]/bestaudio',
      '--no-playlist',
      url
    ];
    const info = spawn('yt-dlp', args);
    let output = '';
    info.stdout.on('data', data => { output += data.toString(); });
    info.on('close', code => {
      if (code !== 0) return resolve(null);
      try {
        const meta = JSON.parse(output);
        const est =
          meta.filesize_approx ||
          meta.filesize ||
          (meta.duration && meta.abr
            ? meta.duration * meta.abr * 1000 / 8
            : null);
        resolve(est ? Number(est) : null);
      } catch {
        resolve(null);
      }
    });
    info.on('error', reject);
  });
}

// 🎯 Fallback + ตรวจจับ "ไม่มีเสียง" TikTok/YouTube
function downloadMp3WithFallback(url, outputPath, callback) {
  let ytdlpArgs = [
    '-f', 'bestaudio[ext=m4a]/bestaudio',
    '-o', '-', url
  ];
  let triedFallback = false;

  function tryDownload(args) {
    const dl = spawn('yt-dlp', args);
    const ffArgs = [
      '-i', 'pipe:0',
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', '256k',
      outputPath
    ];
    const ff = spawn('ffmpeg', ffArgs);

    dl.stdout.pipe(ff.stdin);

    let dlErr = '';
    let noAudioDetected = false;

    dl.stderr.on('data', data => { dlErr += data.toString(); });

    ff.stderr.on('data', data => {
      const msg = data.toString();
      console.error(`ffmpeg: ${msg}`);
      // ตรวจจับ error ไม่มี stream เสียง (TikTok ไม่มี audio)
      if (
        msg.includes("Stream map") && msg.includes("matches no streams") ||
        msg.includes("could not find codec") ||
        msg.toLowerCase().includes("no audio")
      ) {
        noAudioDetected = true;
      }
    });

    ff.on('close', code => {
      if (code === 0 && !noAudioDetected) {
        callback(null); // success
      } else if (noAudioDetected) {
        callback(new Error('คลิปนี้ไม่มีเสียงในไฟล์ (TikTok ไม่อนุญาตดึง audio stream หรือเป็นคลิปไม่มีเสียง)'));
      } else if (!triedFallback &&
        (dlErr.includes('requested format not available') ||
         dlErr.includes('no suitable formats') ||
         dlErr.toLowerCase().includes('error'))) {
        triedFallback = true;
        tryDownload(['-f', 'best[ext=mp4]', '-o', '-', url]);
      } else {
        callback(new Error('ไม่สามารถแปลงไฟล์ mp3 ได้'));
      }
    });
  }
  tryDownload(ytdlpArgs);
}

app.post('/api/convert', convertLimiter, async (req, res) => {
  const { url, format } = req.body;

  if (!url || !['mp3', 'mp4'].includes(format)) {
    return res.status(400).json({ error: 'Missing or invalid url/format' });
  }

  if (!isValidUrl(url)) {
    return res.status(403).json({ error: 'URL ไม่อนุญาต หรือเสี่ยงอันตราย' });
  }

  if (url.includes('tiktok.com') && url.includes('/photo/')) {
    return res.status(400).json({ error: 'URL เป็นโพสต์ภาพ TikTok ซึ่งไม่รองรับ' });
  }

  // ประเมินขนาดไฟล์ก่อน
  let fastSize = await checkFastEstimate(url, format);
  if (fastSize && fastSize > MAX_SIZE * 0.95) {
    return res.status(413).json({ error: 'ไฟล์นี้มีขนาดประมาณเกิน 100MB ไม่สามารถดาวน์โหลดได้' });
  }

  const randomName = `pangfile_${Date.now()}${Math.floor(Math.random() * 1000000)}.${format}`;
  const outputPath = path.join(downloadDir, randomName);

  if (format === 'mp3') {
    downloadMp3WithFallback(url, outputPath, (err) => {
      if (!err) {
        res.json({ downloadUrl: `/download/${randomName}` });
        setTimeout(() => fs.unlink(outputPath, () => {}), 10 * 60 * 1000);
      } else {
        // แจ้งข้อความเฉพาะกรณีไม่มีเสียง
        res.status(500).json({
          error: err.message || 'ไม่สามารถแปลงไฟล์ mp3 ได้'
        });
      }
    });
  } else {
    let ytdlpArgs;
    if (url.includes('tiktok.com')) {
      ytdlpArgs = [
        '-f', 'best[ext=mp4][height<=720]/best[ext=mp4]',
        '--merge-output-format', 'mp4',
        '-o', outputPath,
        url
      ];
    } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
      ytdlpArgs = [
        '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
        '--merge-output-format', 'mp4',
        '-o', outputPath,
        url
      ];
    } else {
      return res.status(400).json({ error: 'รองรับเฉพาะ YouTube, TikTok เท่านั้น' });
    }

    const dl = spawn('yt-dlp', ytdlpArgs);

    dl.on('close', code => {
      if (code === 0) {
        res.json({ downloadUrl: `/download/${randomName}` });
        setTimeout(() => fs.unlink(outputPath, () => {}), 10 * 60 * 1000);
      } else {
        res.status(500).json({ error: 'ไม่สามารถดาวน์โหลด mp4 ได้' });
      }
    });

    dl.stderr.on('data', data => {
      const msg = data.toString();
      console.error(`yt-dlp: ${msg}`);
    });
  }
});

app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;

  // ป้องกัน path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).send('ไม่สามารถดาวน์โหลดไฟล์นี้ได้');
  }

  const filePath = path.join(downloadDir, filename);
  const normalizedPath = path.normalize(filePath);

  if (!normalizedPath.startsWith(downloadDir)) {
    return res.status(403).send('ไม่อนุญาตให้เข้าถึงไฟล์');
  }

  if (fs.existsSync(normalizedPath)) {
    res.download(normalizedPath, filename);
  } else {
    res.status(404).send('ไม่พบไฟล์ที่ร้องขอ');
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`Server running at http://0.0.0.0:${PORT}`));
