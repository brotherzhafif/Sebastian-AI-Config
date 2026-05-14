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

# # 3. Restart Gateway LiteLLM (Paling Akhir)
# echo "🔄 Me-restart Gateway LiteLLM (localhost:4000) sebagai langkah final..."
# pkill -f litellm
# sleep 1
# nohup litellm --config ~/.hermes/router.yaml --port 4000 > proxy.log 2>&1 &
# echo "✓ LiteLLM telah siap di jalur localhost:4000."

echo "✨ Seluruh sistem telah segar kembali."