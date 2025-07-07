// ✅ backend: server.js (หรือ index.js แล้วแต่คุณใช้ชื่อไฟล์)

const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 🔐 ปลอดภัยสำหรับ URL
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
const rateLimit = require('express-rate-limit');

// 🔒 จำกัด rate: 5 requests / นาที ต่อ IP
const convertLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 นาที
  max: 5, // ได้แค่ 5 ครั้งในช่วงเวลา
  message: {
    error: 'คุณใช้คำสั่งแปลงไฟล์บ่อยเกินไป กรุณารอสักครู่ก่อนทำรายการใหม่'
  }
});
app.post('/api/convert', convertLimiter, (req, res) => {
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

  const randomName = `myweb_${Date.now()}${Math.floor(Math.random() * 1000000)}.${format}`;
  const outputPath = path.join(downloadDir, randomName);

  // ✅ โหลดแบบ mp4 เสมอ + จำกัดขนาดไฟล์ไม่เกิน 100MB
  const ytdlpArgs = ['-f', 'mp4', '--max-filesize', '100M', '-o', '-', url];
  const dl = spawn('yt-dlp', ytdlpArgs);

  const ffArgs = format === 'mp4'
    ? ['-i', 'pipe:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', 'frag_keyframe+empty_moov+faststart', outputPath]
    : ['-i', 'pipe:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', outputPath];

  const ff = spawn('ffmpeg', ffArgs);

  dl.stdout.pipe(ff.stdin);

  // ✅ ตรวจจับ error ว่าไฟล์ใหญ่เกิน
  dl.stderr.on('data', data => {
    const msg = data.toString();
    console.error(`yt-dlp: ${msg}`);

    if (msg.includes('File is larger than max-filesize')) {
      ff.kill('SIGKILL');
      return res.status(413).json({ error: 'วิดีโอนี้มีขนาดเกิน 100MB ไม่สามารถดาวน์โหลดได้' });
    }
  });

  ff.stderr.on('data', data => console.error(`ffmpeg: ${data}`));

 ff.on('close', code => {
  if (code === 0) {
    res.json({ downloadUrl: `/download/${randomName}` });

    // ✅ ลบไฟล์หลัง 10 นาที
    setTimeout(() => {
      fs.unlink(outputPath, err => {
        if (err) {
          console.error(`ลบไฟล์ไม่สำเร็จ: ${outputPath}`, err);
        } else {
          console.log(`ลบไฟล์เรียบร้อย: ${outputPath}`);
        }
      });
    }, 10 * 60 * 1000);

  } else {
    console.error(`ffmpeg exited with code ${code}`);
    res.status(500).json({ error: 'ไม่สามารถแปลงไฟล์ได้ โปรดลองใหม่อีกครั้ง' });
  }
});
});
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;

  // ป้องกัน path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).send('ไม่สามารถดาวน์โหลดไฟล์นี้ได้');
  }

  const filePath = path.join(downloadDir, filename);
  const normalizedPath = path.normalize(filePath);

  // ตรวจสอบว่าไฟล์ยังอยู่ในโฟลเดอร์ downloadDir จริง
  if (!normalizedPath.startsWith(downloadDir)) {
    return res.status(403).send('ไม่อนุญาตให้เข้าถึงไฟล์');
  }

  if (fs.existsSync(normalizedPath)) {
    res.download(normalizedPath, filename);
  } else {
    res.status(404).send('ไม่พบไฟล์ที่ร้องขอ');
  }
});



app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
