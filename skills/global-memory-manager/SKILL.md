---
name: global-memory-manager
description: Mengelola memory sesi Hermes via bridge di localhost:9089.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [memory, session, management]
    related_skills: []
---

# Global Memory Manager

## Overview
Skill ini menyediakan antarmuka untuk mengelola memory sesi Hermes melalui bridge yang berjalan di localhost:9089. Ini memungkinkan listing, penghapusan spesifik, penghapusan sesi hari ini, atau penghapusan semua memory sesi.

## When to Use
Gunakan skill ini ketika:
- Anda ingin melihat sesi memory yang tersimpan.
- Anda ingin menghapus memory sesi tertentu, sesi hari ini, atau semua sesi.
- Trigger kata kunci dari pengguna: "lupakan obrolan tadi", "lupakan semua", "hapus memory", "sesi apa yang kamu ingat", "reset memory", "ngobrol apa kita tadi?", "sampe mana kita tadi?"

## Endpoint
Akses endpoint berikut menggunakan `curl` via tool `terminal`:

*   **GET /memory/list**: Untuk mencantumkan semua sesi memory yang tersimpan.
    *   Contoh: `curl http://localhost:9089/memory/list`

*   **DELETE /memory/today**: Untuk menghapus semua sesi memory yang dibuat hari ini.
    *   Contoh: `curl -X DELETE http://localhost:9089/memory/today`

*   **DELETE /memory/all**: Untuk menghapus semua sesi memory.
    *   Contoh: `curl -X DELETE http://localhost:9089/memory/all`

*   **DELETE /memory/{session_key}**: Untuk menghapus sesi memory spesifik. Ganti `{session_key}` dengan ID sesi yang relevan.
    *   Contoh: `curl -X DELETE http://localhost:9089/memory/a1b2c3d4e5f6g7h8i9j0`

## Execution Flow
1.  Identifikasi permintaan pengguna berdasarkan kata kunci pemicu.
2.  Tentukan endpoint yang sesuai.
3.  Gunakan tool `terminal` untuk mengeksekusi perintah `curl` ke endpoint yang relevan.
4.  Berikan konfirmasi singkat kepada pengguna setelah eksekusi.

## Common Pitfalls
1.  **Bridge tidak berjalan**: Pastikan Hermes bridge berjalan di localhost:9089. Jika tidak, perintah curl akan gagal.
2.  **Session Key tidak valid**: Memasukkan `session_key` yang salah untuk penghapusan sesi spesifik akan mengakibatkan kegagalan.

## Verification Checklist
- [ ] Skill dapat ditemukan dan diakses melalui `skill_view`.
- [ ] Perintah `curl` berhasil mengeksekusi operasi memory yang diminta.
- [ ] Konfirmasi singkat diberikan setelah eksekusi.
