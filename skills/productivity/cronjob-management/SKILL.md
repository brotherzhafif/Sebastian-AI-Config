---
name: cronjob-management
description: Manage automated reminders and scheduled tasks.
---
# Cron Job Management

This skill handles automated scheduling for Tuan Zhafif Raditya H.

## Workflow

### Scheduling Rules
- **Specific Date/Time:** Always set `repeat: once`. The task will automatically be removed by the system after execution.
- **Interval-based (Daily/Weekly/Monthly):** Set `repeat: forever` only when explicitly requested (e.g., "setiap hari", "tiap Jumat").

## Pitfalls
- Do not keep expired 'once' jobs in the list; ensure the system cleans them up.
- Verify the `deliver` parameter. For Tuan Zhafif's personal notifications outside this chat, use the WhatsApp/Fonnte integration. For messages meant for this chat, use `origin`.
- **Model Update Issue**: Jika pembaruan model pada cronjob gagal diterapkan, solusi terbaik adalah menghapus cronjob lama dan membuatnya ulang dengan model yang benar.
- **'repeat' Parameter Pitfall**: Saat menjadwalkan job sekali jalan, hindari penggunaan parameter `repeat` secara eksplisit. Cukup gunakan format cron `0 H D M *` pada `schedule` untuk tanggal dan waktu spesifik, dan sistem akan menganggapnya sebagai satu kali eksekusi secara implisit. Menggunakan `repeat='once'` atau `repeat='forever'` secara eksplisit bersama `schedule` dapat menyebabkan konflik tipe data (`str` dan `int`).
    - **Base URL untuk Cronjob**: Pastikan untuk menyertakan `baseurl: http://localhost:9089/v1` dalam konfigurasi cronjob jika diperlukan oleh agen atau skrip yang dijalankan.\n- **Pengingat Awal**: Untuk pengingat acara, selalu jadwalkan 30 menit lebih awal dari waktu yang ditentukan.\n