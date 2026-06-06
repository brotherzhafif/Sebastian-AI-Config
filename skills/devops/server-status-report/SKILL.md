---
name: server-status-report
description: Format laporan status gabungan Server Health dan AI Status untuk Tuan Zhafif.
category: devops
---

# Laporan Status Server

Gunakan format ini setiap kali Tuan Zhafif meminta laporan status server, kesehatan server, atau update performa.

## Metodologi Pengumpulan Data

1. *Server Health*:
   - RAM real-time: Jalankan `free -m` atau `free -h`.
   - Uptime: Jalankan `uptime -p`.
   - Storage: Jalankan `df -h /`.
   - Load Average: Ambil dari output `uptime`.

2. *Hermes Bridge*:
   - Jalankan `curl -s -G "http://localhost:9089/dashboard/api/data" --data-urlencode "range=today"` untuk mengambil analitik harian.

## Format Output (WhatsApp Friendly)
*Format teks wajib tanpa simbol markdown '#' (gunakan bold dengan bintang '*' untuk WhatsApp)*:

*LAPORAN STATUS SERVER HEALTH*

* RAM Real-time: [Nilai] / [Total] GB
* Uptime: [Durasi]
* Storage: [Terpakai]/[Total] ([Persentase])
* Load Average: [1m], [5m], [15m]

*LAPORAN STATUS HERMES BRIDGE*

* Total Request: [Total]
* Request Sukses: [Sukses] ([Persentase]%)
* Total Input Token: [Input]
* Total Output Token: [Output]
* Rata-rata Latensi: [Latensi] ms
