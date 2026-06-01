#!/usr/bin/env python3
import urllib.request
import urllib.parse
import json
import sys
import os

def searx_unlimited_search(query, tipe_file="semua"):
    query_encoded = urllib.parse.quote(query)
    
    # Menggunakan public instance SearXNG yang stabil dan mendukung format JSON
    # PENTING: Jika terjadi error 403, ganti URL ini dengan instance SearXNG Anda sendiri
    # atau instance publik yang diketahui stabil dan tidak memblokir akses otomatis.
    base_url = f"https://searx.be/search?q={query_encoded}&format=json"
    
    # Jika user ingin mencari gambar, arahkan kategori ke 'images'
    if tipe_file.lower() == "gambar":
        base_url += "&categories=images"
        
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    }
    
    try:
        print(f"[*] SearXNG mencari (Unlimited): {query}...")
        req = urllib.request.Request(base_url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            
        results = res_data.get("results", [])
        if not results:
            print("[-] Tidak ditemukan hasil pencarian yang cocok.")
            return
            
        # Ambil hasil pertama yang paling relevan
        first_result = results[0]
        
        # Ekstraksi URL berdasarkan tipe pencarian
        if tipe_file.lower() == "gambar":
            target_url = first_result.get("img_src") or first_result.get("url")
        else:
            target_url = first_result.get("url")
            
        if not target_url:
            print("[-] Gagal mengekstrak URL target dari hasil pencarian.")
            return
            
        print(f"[+] Ketemu URL mentah: {target_url}")
        
        # Proses Pengunduhan File
        nama_file = os.path.basename(urllib.parse.urlparse(target_url).path)
        if not nama_file or "." not in nama_file:
            nama_file = f"unduhan_{tipe_file}"
            if tipe_file.lower() == "gambar": 
                nama_file += ".jpg"
            
        print(f"[*] Mengunduh {nama_file}...")
        req_dl = urllib.request.Request(target_url, headers={'User-Agent': headers['User-Agent']})
        with urllib.request.urlopen(req_dl, timeout=20) as dl_response, open(nama_file, 'wb') as out_file:
            out_file.write(dl_response.read())
            
        print(f"[SUCCESS] File berhasil diamankan di: {os.path.abspath(nama_file)}")
        
    except Exception as e:
        print(f"[ERROR] Kegagalan sistem SearXNG: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print('Cara Pakai: python3 searx_finder.py "[KATA_KUNCI]" [TIPE_FILE]')
        sys.exit(1)
        
    keyword = sys.argv[1]
    tipe = sys.argv[2] if len(sys.argv) > 2 else "semua"
    searx_unlimited_search(keyword, tipe)