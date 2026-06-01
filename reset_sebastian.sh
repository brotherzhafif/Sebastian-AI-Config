#!/bin/bash

# 🎩 Skrip Reset Total Sebastian Butler 🎩

echo "⏳ Memulai pembersihan sistem sesuai protokol, Tuan Zhafif..."

# 1. Hapus semua sesi lama
echo "🗑️  Membersihkan riwayat sesi lama..."
rm -rf ~/.hermes/sessions/*
rm -rf ~/.hermes/audio_cache/*

# 2. Restart Sebastian Gateway (WhatsApp/Bridge)
echo "🔄 Me-restart Sebastian Gateway..."
sudo -E sudo sebastian gateway stop
sleep 2
sudo -E sudo sebastian gateway start

# 3. Restart Hermes Live Bridge (server.cjs pada localhost:8089)
echo "🔄 Me-restart Hermes Live Bridge (server.cjs)..."
# Cari PID dari server.cjs
PID_BRIDGE=$(pgrep -f "node server.cjs")
if [ -n "$PID_BRIDGE" ]; then
    kill -9 $PID_BRIDGE > /dev/null 2>&1
    echo "✓ Proses server.cjs lama ($PID_BRIDGE) telah dihentikan."
fi
sleep 1

# Jalankan kembali server.cjs di latar belakang menggunakan nohup
cd ~/.hermes
nohup node server.cjs > bridge_output.log 2>&1 &
echo "✓ Hermes Live Bridge v7.2 aktif kembali di latar belakang (localhost:8089)."

echo "✨ Seluruh sistem telah segar kembali."