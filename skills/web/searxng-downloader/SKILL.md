---
name: searxng-downloader
category: web
description: Mencari dan mengunduh file atau gambar secara unlimited menggunakan API JSON dari SearXNG.
---

### SearXNG Downloader

Skill ini memungkinkan Sebastian untuk mencari dan mengunduh file atau gambar dari internet menggunakan API JSON gratis dari SearXNG. Ini dirancang untuk mengatasi batasan API dan pemblokiran 403 yang sering terjadi pada layanan pencarian lainnya.

**Masalah Instance SearXNG Publik:**
Perlu dicatat bahwa banyak instance SearXNG publik menerapkan batasan atau memblokir akses otomatis (seperti yang kita alami dengan error 403). Untuk penggunaan yang paling andal, sangat disarankan untuk:
1.  **Meng-host instance SearXNG Anda sendiri:** Ini memberi Anda kontrol penuh dan menjamin ketersediaan.
2.  **Menggunakan instance publik yang diketahui stabil dan tidak memblokir akses otomatis:** Jika Anda memiliki URL instance semacam itu, Anda dapat memintanya untuk diperbarui dalam skrip.

**Cara Menggunakan:**

Untuk mencari dan mengunduh file:
`python3 scripts/searx_finder.py "KATA_KUNCI" [TIPE_FILE]`

Untuk mencari dan mengunduh gambar:
`python3 scripts/searx_finder.py "KATA_KUNCI" "gambar"`

**Contoh:**
`python3 scripts/searx_finder.py "wallpaper alam" "gambar"`
`python3 scripts/searx_finder.py "dokumen pdf python" "semua"`

**Penting:** Jika Anda mengalami error 403, informasikan kepada saya URL instance SearXNG yang Anda inginkan untuk digunakan, dan saya akan memperbarui skrip di dalam skill ini.

**File Terkait:**
- `scripts/searx_finder.py`: Skrip Python utama untuk pencarian dan pengunduhan.