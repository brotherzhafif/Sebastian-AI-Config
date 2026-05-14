---
name: litellm-monitor
description: Cek kuota dan status token AI di LiteLLM router
version: 1.0.0
author: Raja
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [AI, Tooling, Monitoring]
    config:
      - key: litellm.config_path
        description: "Path ke file router.yaml LiteLLM"
        default: "~/.litellm/router.yaml"
---

# LiteLLM Token Monitor

Skill ini memungkinkan agent untuk memantau penggunaan token dan status model yang terdaftar di LiteLLM Router.

## When to Use
Gunakan skill ini jika user bertanya:
- "Tokenku sisa berapa?"
- "Info token AI"
- "Status model litellm"
- "Cek kuota backup token"

## Procedure
1. Agent akan mencari file `router.yaml` pada path yang ditentukan di config.
2. Agent menjalankan script python helper untuk memproses data YAML tersebut.
3. Agent menampilkan output dalam bentuk bar kumulasi (total) dan list detail per token.

## Commands
Untuk mengecek status, jalankan:
```bash
python3 ${HERMES_SKILL_DIR}/scripts/check_usage.py