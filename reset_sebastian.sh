#!/bin/bash

# 🎩 Reset Sebastian Butler & Hermes Bridge (Deep Clean) — Docker Edition 🎩
set -e

HERMES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "⏳ Memulai hard reset sistem secara menyeluruh, Tuan Zhafif..."

# ─────────────────────────────────────────
# 1. Bersihkan session & cache lama
# ─────────────────────────────────────────
echo ""
echo "🗑️  Membersihkan riwayat sesi lama & cache audio..."
rm -rf ~/.hermes/sessions/* 2>/dev/null || true
rm -rf ~/.hermes/audio_cache/* 2>/dev/null || true
echo "✓ Cache lokal bersih."

# ─────────────────────────────────────────
# 2. Restart Sebastian Gateway (non-Docker)
# ─────────────────────────────────────────
echo ""
echo "🔄 Me-restart Sebastian Gateway..."
if command -v sebastian &> /dev/null; then
  sebastian gateway stop 2>/dev/null || true
  sleep 2
  sebastian gateway start
  echo "✓ Sebastian Gateway aktif."
else
  echo "⚠️  Command 'sebastian' tidak ditemukan, skip."
fi

# ─────────────────────────────────────────
# 3. Hard Reset Docker Stack via Compose
# ─────────────────────────────────────────
echo ""
echo "🛑 Menghentikan seluruh stack Docker & membersihkan sisa kontainer..."
cd "$HERMES_DIR"

# -v menghapus anonymous volumes, --remove-orphans menghapus container liar
docker compose down -v --remove-orphans 2>/dev/null || true

echo "⚙️  Membangun ulang image dari nol (Clean Build)..."
# Jalankan build tanpa cache secara terpisah agar tidak memicu error flag
docker compose build --no-cache

echo "🚀 Menyalakan seluruh stack kontainer baru..."
# Jalankan kontainer yang sudah dibangun bersih
docker compose up -d --force-recreate

echo "✓ Seluruh kontainer (Bridge & Dozzle) berhasil dibangun kembali."

# ─────────────────────────────────────────
# 4. Tunggu bridge ready (health check)
# ─────────────────────────────────────────
echo ""
echo "⏳ Menunggu API Bridge siap melayani..."
MAX_WAIT=30
ELAPSED=0
until curl -sf http://localhost:9089/v1/models > /dev/null 2>&1; do
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "❌ Bridge tidak merespons setelah ${MAX_WAIT}s. Mengambil log darurat:"
    docker compose logs --tail=50
    exit 1
  fi
  echo "   ...masih menunggu (${ELAPSED}s)"
done

echo "✓ Hermes Live Bridge aktif di http://localhost:9089"

# ─────────────────────────────────────────
# 5. Tampilkan status akhir
# ─────────────────────────────────────────
echo ""
echo "📊 Status stack saat ini:"
docker compose ps

echo ""
echo "✨ Seluruh infrastruktur segar kembali dari titik nol, Tuan Zhafif."
echo "   📺 Pantau log segar di Dozzle: https://hermes-log.brotherzhafif.my.id"