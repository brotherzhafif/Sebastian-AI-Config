---
name: get_hermes_stats
description: Use when you need to fetch and summarize Hermes Bridge analytics (requests, tokens, latency) from the local dashboard API.
version: 1.0.0
author: Sebastian
license: MIT
metadata:
  hermes:
    tags: [devops, analytics, dashboard, hermes-bridge]
---

# Get Hermes Stats

## Overview
Skill ini mengambil data analitik dari endpoint lokal Hermes Bridge (`http://localhost:9089/dashboard/api/data`) dan menyusun laporan ringkas mengenai penggunaan model, token, dan performa latensi.

## When to Use
- Saat Tuan Zhafif meminta laporan status atau statistik penggunaan AI.
- Untuk memantau tren traffic dan efisiensi token model tertentu.
- Untuk pengecekan kesehatan (health check) operasional bridge.

## Query Parameters
1. **range** (wajib): `today`, `week`, `month`, `3months`, `all`, `custom`.
2. **model** (opsional): Nama model untuk filter (misal: `gemini-3.5-flash`).
3. **start** (opsional): `YYYY-MM-DD` (hanya jika range='custom').
4. **end** (opsional): `YYYY-MM-DD` (hanya jika range='custom').

## Recipe
Gunakan `curl` untuk mengambil data JSON:
```bash
curl -G "http://localhost:9089/dashboard/api/data" \
  --data-urlencode "range=today" \
  --data-urlencode "model=gemini-1.5-flash"
```

### Visualisasi Data (Timeline)
- **today**: Label jam `HH:00` (24 batang).
- **week/month/3months/custom**: Label harian `YYYY-MM-DD`.
- **all**: Label bulanan `YYYY-MM`.

## Output Format
Laporan harus ringkas dan menggunakan format Markdown:
- **Ringkasan**: Total request, % sukses, token in/out, rata-rata latensi.
- **Tren**: Identifikasi titik tersibuk berdasarkan array `timeline`.

## Common Pitfalls
- Menggunakan parameter `start/end` tanpa range `custom`.
- Tidak menangani kegagalan fetch jika bridge sedang down (port 9089 tertutup).
