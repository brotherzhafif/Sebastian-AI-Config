# Pengecekan Website (User-Agent Simulation)

Saat melakukan tugas pengecekan website atau ekstraksi konten:

1. **JANGAN gunakan pendekatan bot mentah** (seperti `curl` atau `wget` tanpa header). Hal ini sering kali memicu proteksi bot (Cloudflare, CAPTCHA, atau timeout).
2. **SELALU gunakan simulasi User-Agent**. Gunakan header peramban yang sah (misal: Chrome di Windows).
   Contoh:
   `curl -L -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" <URL>`
3. **Pahami Batasan:** Jika website menerapkan *dynamic rendering* (konten dimuat oleh JavaScript setelah halaman terbuka), teknik *text-based* (`curl`/`grep`) akan gagal. 
   - Solusi: Gunakan `browser_navigate` (yang menggunakan Chromium engine) atau pertimbangkan penggunaan API resmi (seperti YouTube Data API) jika tersedia.
   - Jika `browser_navigate` mengalami *timeout*, segera beritahu user dan tawarkan alternatif (seperti API resmi) daripada mencoba berulang kali tanpa perubahan strategi.
