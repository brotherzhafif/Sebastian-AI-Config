---
name: minecraft-server
description: Mengelola server Minecraft di VPS melalui tmux session 'mc'.
version: 1.0.0
author: Sebastian
license: MIT
metadata:
  hermes:
    tags: [minecraft, tmux, devops, server]
    related_skills: [server-status-report]
---

# Mengelola Server Minecraft (Sampit_Empire)

Gunakan skill ini untuk memantau, mengirim perintah, dan mengelola server Minecraft yang berjalan dalam sesi tmux `mc` di folder `Sampit_Empire`.

## When to Use
- Mengelola server Minecraft yang berjalan di VPS melalui terminal/tmux.
- Mengirim pesan atau perintah ke dalam game secara terprogram atau manual.
- Membaca log konsol server untuk memantau aktivitas pemain atau kesalahan server.

## Cara Akses & Manajemen Sesi

Server Minecraft berjalan di dalam sesi tmux bernama `mc`.

1. **Mengirim Perintah secara Non-Interaktif (Direkomendasikan)**:
   Gunakan perintah `tmux send-keys` untuk mengirim command tanpa perlu melakukan attach secara interaktif:
   ```bash
   tmux send-keys -t mc "say Halo Dunia!" C-m
   ```
   *Catatan*: `C-m` mensimulasikan tombol Enter.

2. **Membaca Log Server Terkini**:
   Untuk membaca output log terbaru dari sesi tmux:
   ```bash
   tmux capture-pane -t mc -p
   ```

3. **Akses Interaktif (Jika Benar-benar Diperlukan)**:
   - Masuk: `tmux attach -t mc` (gunakan `pty=true` jika melalui tool `terminal`).
   - Keluar tanpa mematikan server: Tekan urutan tombol `Ctrl + b` lalu `d`.

## Aturan Komunikasi & Pengiriman Pesan (PENTING)

1. **Gunakan Perintah Minecraft yang Sesuai**:
   - `/say <pesan>`: Mengirim pesan global ke seluruh pemain.
   - `/msg <pemain> <pesan>`: Mengirim pesan privat ke pemain tertentu. Lakukan verifikasi nama pemain menggunakan `/list` terlebih dahulu untuk menghindari salah ketik (typo).
   - `/title <pemain> title <pesan>` atau `/subtitle`: Menampilkan judul besar di layar.

2. **Aturan Baris Berganda (Multiple Lines)**:
   Jika ada pesan yang terdiri dari beberapa baris (multiple lines), **JANGAN** mengirim semuanya sekaligus dalam satu baris. Pecah pesan menjadi beberapa baris perintah dan berikan jeda singkat di antaranya.
   
   *Contoh salah*:
   ```bash
   tmux send-keys -t mc "say ayam goreng, enak banget\nyaaa benar sekali" C-m
   ```

   *Contoh benar*:
   ```bash
   tmux send-keys -t mc "say ayam goreng, enak banget" C-m
   sleep 1
   tmux send-keys -t mc "say yaaa benar sekali" C-m
   ```

## Perintah Bermanfaat Lainnya
- `/help`: Menampilkan daftar perintah yang tersedia.
- `/list`: Menampilkan daftar pemain yang sedang online.
- `/whitelist add/remove <nama>`: Mengelola whitelist.
