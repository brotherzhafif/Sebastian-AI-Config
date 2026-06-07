---
name: server-status-report
description: Format laporan status gabungan Server Health dan AI Status untuk Tuan Zhafif.
category: devops
---

# Laporan Status Server & AI

Gunakan skill ini untuk memberikan laporan komprehensif yang menggabungkan kesehatan server, status internal Hermes Agent, dan statistik penggunaan Hermes Bridge.

## Metodologi Pengumpulan Data

1. **Server Health**:
   - RAM: `free -h`
   - Uptime: `uptime -p`
   - Storage: `df -h /`
   - Load Average: `uptime`

2. **Hermes Agent Status**:
   - Jalankan `systemctl --user status hermes-gateway` (Gateway)
   - Jalankan `hermes status` untuk info detail environment, API keys, dan Scheduled Jobs.

3. **AI Stats (Hermes Bridge)**:
   - Endpoint: `http://localhost:9089/dashboard/api/data`
   - Parameter default: `range=today`

## Format Output (WhatsApp Friendly)
*Format ini didesain khusus tanpa simbol markdown yang rusak di WhatsApp. Hanya gunakan bintang (*) untuk cetak tebal.*

*LAPORAN STATUS SERVER & AI AGENT*

*KESEHATAN SERVER*
- RAM Real-time: [Used] / [Total]
- Uptime: [Duration]
- Storage: [Used]/[Total] ([%])
- Load Average: [1m], [5m], [15m]

*STATUS HERMES AGENT*
- Environment: [Path] (Model: [Active Model] - [Provider])
- API Keys: Google ([Status]), ElevenLabs ([Status]), GitHub ([Status])
- Gateway Service: [Status/PID]
- Scheduled Jobs: [Count] active

*HERMES BRIDGE STATS (TODAY)*
- Total Request: [Count]
- Request Sukses: [Success] ([%])
- Total Input Token: [In]
- Total Output Token: [Out]
- Rata-rata Latensi: [ms]
- Distribusi Model:
  * [Model A]: [Count] request
  * [Model B]: [Count] request
  * [Model C]: [Count] request
