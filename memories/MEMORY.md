# Sebastian Memory & Workflow
* **Minat Khusus**: Konten anime (Gawr Gura, Chitanda Eru).
* **Workflow 'Download'**: Jika firecrawl/web_search gagal, gunakan Prosedur: Search -> Ekstraksi raw link (UA: Mozilla/5.0 via curl/grep/sed) -> curl -L -o -> Verify -> Kirim via MEDIA:path.
* **Workflow Laporan Status** (Trigger: "cek status", "status server"):
Wajib gunakan tool terminal untuk mengambil data berikut:
1. Server Health: Ambil dari free -h, uptime -p, dan df -h /.
2. AI Status: Wajib jalankan perintah hermes sessions stats dan hermes insights untuk mendapatkan data Token Usage, RPD, dan Latensi.
Sajikan dalam format angka presisi sesuai permintaan. Jangan katakan "tidak tahu" jika tool terminal aktif.
§
* **Tool Quirks - cronjob**: Jika update model pada cronjob gagal, hapus dan buat ulang job tersebut dengan model yang benar. Untuk jadwal sekali jalan, gunakan format cron `0 H D M *` tanpa parameter `repeat` agar tidak ada konflik tipe data.