import sys
import os
import json
import urllib.request
from urllib.error import URLError, HTTPError

if len(sys.argv) < 2:
    print("❌ Error: Path ke router.yaml tidak diberikan.")
    sys.exit(1)

yaml_path = sys.argv[1]
base_url = os.environ.get("LITELLM_BASE_URL", "").rstrip("/v1").rstrip("/")

print(f"🔍 Membaca konfigurasi dari: {yaml_path}\n")

models = []
current_model_name = "Unknown Model"

# Native YAML Parser (Tanpa library eksternal)
try:
    with open(yaml_path, 'r') as f:
        for line in f:
            line_stripped = line.strip()
            if line_stripped.startswith("model_name:"):
                # Mengambil string setelah 'model_name:'
                current_model_name = line_stripped.split("model_name:", 1)[1].strip().strip('"\'')
            elif line_stripped.startswith("api_key:"):
                # Mengambil string setelah 'api_key:'
                api_key = line_stripped.split("api_key:", 1)[1].strip().strip('"\'')
                models.append({
                    "name": current_model_name,
                    "key": api_key
                })
except FileNotFoundError:
    print(f"❌ File tidak ditemukan di path: {yaml_path}")
    sys.exit(1)

print(f"📋 Ditemukan {len(models)} model di router.yaml. Memulai Health Check...\n")

# Melakukan Health Check dengan menembak Chat Completions minimalis
for item in models:
    model_name = item["name"]
    api_key = item["key"]
    
    # Kita arahkan langsung ke endpoint model di LiteLLM Proxy
    endpoint = f"{base_url}/v1/chat/completions"
    
    payload = json.dumps({
        "model": "gemini/gemini-3.1-flash-lite-preview", # Pastikan model ini sesuai dengan router Anda
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 5
    }).encode('utf-8')
    
    req = urllib.request.Request(
        endpoint, 
        data=payload, 
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            if response.status == 200:
                print(f"✅ {model_name} : ACTIVE (Token siap digunakan)")
    except HTTPError as e:
        if e.code == 429:
            print(f"⚠️ {model_name} : RATE LIMITED (Quota Full / Terlalu banyak request)")
        elif e.code == 401:
            print(f"❌ {model_name} : UNAUTHORIZED (API Key invalid)")
        else:
            print(f"❌ {model_name} : ERROR {e.code}")
    except URLError as e:
        print(f"❌ {model_name} : Gagal menghubungi proxy ({e.reason})")

print("\nPengecekan selesai.")