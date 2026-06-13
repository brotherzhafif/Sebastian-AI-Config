# Hermes Agent – Sebastian Butler

## Ringkasan Persona
Sebastian adalah asisten pribadi Zhafif yang **efisien**, **tegas**, dan **berhumor**. Ia menjawab singkat, tidak berulang, dan langsung ke inti tanpa penjelasan berlebih.

## Fitur Utama

### 1. Server (`server.cjs`)
- **Pengaturan Lingkungan**: Memuat variabel `.env` dengan `dotenv`.
- **Logging Terstruktur** (`LOG`): Kategori log lengkap (boot, persona, token, request, dll.) untuk debugging mudah.
- **Supabase Client**: Menyimpan log request & sesi di Supabase.
- **Manajemen Model**
  - Alias model & fallback chain (`MODEL_FALLBACK_CHAIN`).
  - Chain khusus **OpenRouter** untuk Copilot & WhatsApp.
- **Kompresi Output**: Mengurangi noise log & output tool agar tetap di bawah batas token.
- **Memory**
  - **Short‑term**: Simpan `turns` & `summary` per sesi di tabel `hermes_sessions`.
  - **Long‑term**: Archive otomatis ke `hermes_memory_archive` saat sesi diringkas atau di‑reset.
- **Payload Builder**: Membuat payload untuk Gemini dan OpenRouter, termasuk injeksi persona & memory.
- **Pemanggilan Model**
  - Prioritas token pool Gemini → fallback ke chain. 
  - Jika OpenRouter aktif, gunakan chain yang relevan, lalu fallback ke Gemini.
- **Endpoint Chat** (`/v1/chat/completions` & `/chat/completions`)
  - Deteksi **cron‑job**, **title shortcut**, dan **semantic triggers**.
  - Streaming atau non‑streaming, timeout otomatis (`30 s` normal, `60 s` tool chain).
- **Health Check** (`/health`) – laporan uptime, statistik request, konfigurasi, dll.
- **Manajemen Memory API**
  - `GET /memory/list` – daftar sesi.
  - `GET /memory/current/{key}` – detail sesi aktif.
  - `GET /memory/archive/{key}` – riwayat ringkasan.
  - `GET /memory/search` – pencarian archive.
  - `DELETE /memory/*` – reset memori (semua, hari ini, atau sesi spesifik).
- **Dashboard Router** – meng‑include `dashboard.cjs` pada `/dashboard`.
- **Server Startup** – Memulai Express pada port yang dikonfigurasi dan mencatat URL penting.

### 2. Dashboard (`dashboard.cjs`)
- **Integrasi Supabase**: Menampilkan data sesi & log request.
- **Router Express**: Endpoint `/dashboard` men‑serve UI‑admin.
- **HTML UI** (`dashboard.html`): Ringkasan status server, memory, dan request terbaru.
- **Static Assets**: CSS/JS untuk tampilan bersih.
- **Keamanan**: Menggunakan kredensial Supabase yang sama dengan server utama.

## Alur Kerja (Flow)
1. **Permintaan Chat** → `/v1/chat/completions`
2. Sistem mengecek:
   - Apakah ada **tool chain**? (timeout 60 s)  
   - Apakah permintaan adalah **title/summary shortcut**? → balas cepat.
   - Apakah ada **cron‑job** atau **semantic trigger**? → injeksi memori terkait.
3. **Memory Injection**:
   - Ambil short‑term dari Supabase (`hermes_sessions`).
   - Jika *semantic trigger*, tarik 5 entri archive (`hermes_memory_archive`).
4. **Payload Construction** → Gemini atau OpenRouter (berdasarkan `sessionKey`).
5. **Model Selection**:
   - Coba token pool Gemini (rotasi token). 
   - Jika gagal, jalankan chain OpenRouter (Copilot/WhatsApp). 
   - Jika semua gagal → fallback ke model terakhir di `MODEL_FALLBACK_CHAIN`.
6. **Response** → parsing `<response>` & `<compact>` tag, mengembalikan teks atau tool calls.
7. **Logging & Update Token Index** → simpan statistik & update `globalIndex`.

## Kustomisasi yang Sudah Disediakan
| Area | Apa yang Bisa Di‑custom |
|------|------------------------|
| **Port** | Ubah `PORT` di `.env` atau variabel lingkungan. |
| **Model Default** | `$DEFAULT_MODEL` di `.env` atau ubah konstanta di file. |
| **Timeout** | `TIMEOUT_NORMAL` & `TIMEOUT_TOOL`. |
| **Model Alias / Fallback** | Edit `MODEL_ALIASES` atau `MODEL_FALLBACK_CHAIN`. |
| **OpenRouter Chains** | Tambah / urutkan model di `OPENROUTER_COPILOT_CHAIN` & `OPENROUTER_WHATSAPP_CHAIN`. |
| **Logging** | Tambah atau matikan kategori di `LOG` (mis. `quota`, `exhaust`). |
| **Memory Retention** | Atur `MEMORY_CONFIG.purgeDays`, `max_turns`, `summary_threshold`. |
| **Dashboard UI** | Ubah `dashboard.html` atau CSS di folder `dashboard`. |
| **Supabase Tables** | Ganti nama tabel atau kolom di fungsi `recordRequestRemote`, `loadLocalMemory`, dll. |
| **Persona** | Isi atau ubah `SOUL.md`; teks persona otomatis di‑inject ke setiap sesi. |

## Cara Menggunakan
```bash
# Jalankan Bridge
node server.cjs   # atau npm start jika package.json mengatur script

# Cek health
curl http://localhost:9089/health

# Lihat dashboard
open http://localhost:9089/dashboard

# Kelola memory
curl http://localhost:9089/memory/list
curl -X DELETE http://localhost:9089/memory/today   # contoh reset hari ini
```

## Catatan Penting
- Pastikan **bridge** aktif di `localhost:9089` agar semua endpoint memory & dashboard berfungsi.
- **Memory** bersifat destruktif pada operasi DELETE – konfirmasi dulu bila diperlukan.
- **Model fallback** otomatis menyesuaikan beban token; tidak perlu intervensi manual kecuali ingin men‑add model baru.

---

*Dengan persona Sebastian, semua interaksi dirancang singkat, langsung ke poin, dan tetap fleksibel untuk penyesuaian lanjutan.*