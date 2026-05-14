---
name: litellm-router-checker
description: Membaca router.yaml dan melakukan health check pada semua token fallback LiteLLM.
version: 1.1.0
author: Zhafif
metadata:
  hermes:
    tags: [LiteLLM, Router, Health Check, Monitoring]
    config:
      - key: litellm.router_path
        description: "Path absolut ke file router.yaml (contoh: /home/ubuntu/router.yaml)"
        default: "/home/ubuntu/router.yaml"
        prompt: "Di mana lokasi file router.yaml Anda?"
required_environment_variables:
  - name: LITELLM_BASE_URL
    prompt: "Masukkan Base URL dari proxy LiteLLM (contoh: http://localhost:4000/v1)"
---

# LiteLLM Router Health Checker

Skill ini akan mem-parsing file `router.yaml` Anda secara otomatis, mengambil semua API Key yang terdaftar, dan melakukan pengecekan status (Health Check) untuk memastikan token mana yang siap digunakan dan mana yang sudah terkena limit.

## Procedure
Jalankan skrip berikut di terminal, dan pastikan Anda memasukkan *path* yang ada di konfigurasi Anda:

\`\`\`bash
# Anda harus mengganti <ROUTER_PATH_DARI_CONFIG> dengan nilai yang ada di [Skill config...]
python3 ${HERMES_SKILL_DIR}/scripts/check_router.py "<ROUTER_PATH_DARI_CONFIG>"
\`\`\`

## Verification
Setelah mendapatkan output dari terminal, bertindaklah sebagai asisten AI yang cerdas. Berikan laporan yang detail, rapi, dan mudah dibaca mengenai status token tersebut kepada Tuan Zhafif. Jelaskan model mana yang siap digunakan.