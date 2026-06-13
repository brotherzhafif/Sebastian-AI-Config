---
name: global-memory-manager
description: Mengelola memory sesi Hermes (short-term & long-term archive) via bridge di localhost:9089.
version: 2.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [memory, session, management, long-term]
    related_skills: []
---

# Global Memory Manager

## Overview
Skill ini menyediakan antarmuka untuk mengelola memory sesi Hermes (short-term turns + summary) dan long-term archive (ringkasan historis) melalui bridge di localhost:9089.

## When to Use
Gunakan skill ini ketika:
- Pengguna minta lihat daftar sesi memory yang tersimpan.
- Pengguna minta hapus memory sesi tertentu, hari ini, atau semua sesi.
- Pengguna bertanya hal yang merujuk ke percakapan lama / lampau (mis. "ngobrol apa kita minggu lalu?", "ingat nggak waktu itu kita bahas apa?", "cek riwayat sesi sebastian").
- Trigger kata kunci: "lupakan obrolan tadi", "lupakan semua", "hapus memory", "sesi apa yang kamu ingat", "reset memory", "ngobrol apa kita tadi?", "sampe mana kita tadi?", "cek memory lama", "riwayat sesi".

## Endpoints

### Short-term memory (sesi aktif, turns + summary saat ini)
*   **GET /memory/list** — daftar semua sesi (session_key, summary, last_active).
    *   `curl http://localhost:9089/memory/list`
*   **GET /memory/current/{session_key}** — detail penuh satu sesi (summary, turns, token_index).
    *   `curl http://localhost:9089/memory/current/sebastian`

### Long-term memory (archive ringkasan historis, tersimpan saat session direset/summary di-rotate)
*   **GET /memory/archive/{session_key}?limit=10** — daftar ringkasan lama untuk sesi tertentu.
    *   `curl http://localhost:9089/memory/archive/sebastian?limit=10`
*   **GET /memory/search?q={keyword}&session={session_key}&from={ISO}&to={ISO}** — cari ringkasan archive berdasarkan kata kunci/tanggal.
    *   `curl "http://localhost:9089/memory/search?q=devops&session=sebastian"`

### Manajemen / penghapusan
*   **DELETE /memory/today** — hapus semua sesi yang aktif hari ini (turns+summary direset, archive tidak terhapus).
    *   `curl -X DELETE http://localhost:9089/memory/today`
*   **DELETE /memory/all** — reset semua sesi (turns+summary, archive tidak terhapus).
    *   `curl -X DELETE http://localhost:9089/memory/all`
*   **DELETE /memory/{session_key}** — reset sesi spesifik.
    *   `curl -X DELETE http://localhost:9089/memory/sebastian`

## Execution Flow
1. Identifikasi maksud pengguna: lihat sesi aktif, gali riwayat lama, atau hapus memory.
2. Untuk pertanyaan "ingat nggak/tadi/dulu" → cek dulu `/memory/current/{session}` (summary saat ini), lalu kalau belum cukup, panggil `/memory/archive/{session}` atau `/memory/search?q=...`.
3. Untuk permintaan hapus → konfirmasi singkat ke user dulu sebelum eksekusi DELETE, terutama `/memory/all`.
4. Eksekusi via tool `terminal` dengan `curl`.
5. Beri konfirmasi/ringkasan hasil ke pengguna, jangan tampilkan JSON mentah — parse dan sampaikan secara natural.

## Common Pitfalls
1. **Bridge tidak berjalan**: pastikan Hermes bridge aktif di :9089.
2. **session_key salah**: gunakan `/memory/list` dulu untuk konfirmasi key yang benar (umumnya "sebastian" atau "copilot" untuk sesi utama).
3. **Archive kosong**: archive hanya terisi setelah summary di-rotate (≥6 turns combined). Sesi baru belum punya archive.
4. **DELETE bersifat destruktif** untuk short-term memory — selalu konfirmasi ke user sebelum `/memory/all` atau `/memory/today`.

## Verification Checklist
- [ ] Endpoint dapat diakses (`curl` mengembalikan `ok: true`).
- [ ] Untuk query riwayat, cek current memory dulu sebelum archive.
- [ ] Konfirmasi diberikan sebelum operasi DELETE.
- [ ] Hasil disampaikan ke user dalam bahasa natural, bukan JSON mentah.