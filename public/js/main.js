let selectedFormat = 'mp4';
let isDownloading = false;
let cooldownTimeout = null;

// ฟังก์ชันวางลิงก์จากคลิปบอร์ด
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    const urlInput = document.getElementById('urlInput');
    urlInput.value = text;
    updateDownloadButton();
    urlInput.focus();
    const pasteBtn = document.getElementById('pasteBtn');
    pasteBtn.textContent = '✓';
    pasteBtn.classList.add('bg-green-500');
    pasteBtn.classList.remove('bg-blue-500');
    setTimeout(() => {
      pasteBtn.textContent = 'วาง';
      pasteBtn.classList.remove('bg-green-500');
      pasteBtn.classList.add('bg-blue-500');
    }, 1000);
  } catch (err) {
    // alert('กรุณาวาง URL ด้วยตนเอง (Ctrl+V)');
  }
}

// เลือกรูปแบบไฟล์
function selectFormat(format) {
  selectedFormat = format;
  document.querySelectorAll('.format-card').forEach(card => card.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  updateDownloadButton();
}

// อัปเดตปุ่มดาวน์โหลด
function updateDownloadButton() {
  const urlInput = document.getElementById('urlInput');
  const downloadBtn = document.getElementById('downloadBtn');
  const hasUrl = urlInput.value.trim() !== '';
  downloadBtn.disabled = !hasUrl || isDownloading;
}
function isValidVideoURL(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const pathname = parsed.pathname;

    const isYouTube = hostname.includes("youtube.com") || hostname.includes("youtu.be");
    const isTikTok = hostname.includes("tiktok.com") || hostname.includes("m.tiktok.com") || hostname.includes("vm.tiktok.com");

    // ❌ TikTok Photo
    if (isTikTok && pathname.includes("/photo/")) {
      return {
        valid: false,
        reason: "URL นี้เป็นโพสต์ภาพของ TikTok ซึ่งยังไม่รองรับการดาวน์โหลด"
      };
    }

    // ✅ TikTok Video ต้องมี video ID
    if (isTikTok && !pathname.match(/\/video\/\d+/)) {
      return {
        valid: false,
        reason: "URL นี้ไม่ใช่ลิงก์วิดีโอ TikTok กรุณาคัดลอกลิงก์ใหม่อีกครั้ง"
      };
    }

    if (isYouTube) return { valid: true };
    if (isTikTok) return { valid: true };

    return {
      valid: false,
      reason: "รองรับเฉพาะลิงก์จาก YouTube หรือ TikTok เท่านั้น"
    };
  } catch {
    return {
      valid: false,
      reason: "URL ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง"
    };
  }
}

function isValidURL(url) {
  const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i;
  const tiktokRegex = /^(https?:\/\/)?(www\.)?tiktok\.com\//i;
  return ytRegex.test(url) || tiktokRegex.test(url);
}
async function startDownload() {
  const url = document.getElementById('urlInput').value.trim();
  const downloadBtn = document.getElementById('downloadBtn');

  if (!url) {
    alert('กรุณาใส่ URL ของ TikTok หรือ YouTube');
    return;
  }

  const check = isValidVideoURL(url);
  if (!check.valid) {
    alert(check.reason);
    return;
  }

  if (isDownloading) return; // ป้องกันกดซ้ำ
  isDownloading = true;
  updateDownloadButton();

  document.getElementById('progressSection').classList.remove('hidden');
  downloadBtn.textContent = "";

  try {
    const response = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: selectedFormat })
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data?.error || 'Conversion failed');

    const { downloadUrl } = data;
    fetch('/go/shopee');

    setTimeout(() => {
      window.location.href = downloadUrl;
    }, 500);

  } catch (err) {
    alert(err.message);
  } finally {
    document.getElementById('progressSection').classList.add('hidden');
    let cooldown = 10;
    downloadBtn.disabled = true;

    const countdownInterval = setInterval(() => {
      if (cooldown > 0) {
        downloadBtn.textContent = `รอ ${cooldown} วินาที...`;
        cooldown--;
      } else {
        clearInterval(countdownInterval);
        isDownloading = false;
        downloadBtn.textContent = "ดาวน์โหลด";
        updateDownloadButton();
      }
    }, 1000);
  }
}

// Event Listener
document.getElementById('urlInput').addEventListener('input', updateDownloadButton);
document.getElementById('downloadBtn').addEventListener('click', startDownload);
window.addEventListener('load', () => {
  pasteFromClipboard().catch(() => {});
});
