import yaml
import os
import json
from datetime import datetime

# Path file
ROUTER_PATH = os.path.expanduser("~/router.yaml")
USAGE_LOG = "usage_log.json"
DEFAULT_LIMIT = 1500

def create_bar(current, total, width=20):
    percent = min(float(current) / total, 1.0) if total > 0 else 0
    filled = int(width * percent)
    bar = "█" * filled + "░" * (width - filled)
    return f"[{bar}] {int(percent * 100)}%"

def get_usage():
    try:
        # 1. Load Router untuk list token
        with open(ROUTER_PATH, 'r') as f:
            config = yaml.safe_load(f)
        models = config.get('model_list', [])

        # 2. Hitung penggunaan dari log JSON
        usage_map = {}
        total_used = 0
        
        if os.path.exists(USAGE_LOG):
            with open(USAGE_LOG, 'r') as f:
                for line in f:
                    try:
                        data = json.loads(line)
                        # Pastikan record hari ini
                        log_date = data.get('start_time', '').split('T')[0]
                        today = datetime.now().strftime('%Y-%m-%d')
                        
                        if log_date == today:
                            model = data.get('model', '')
                            usage_map[model] = usage_map.get(model, 0) + 1
                            total_used += 1
                    except: continue

        # 3. Tampilan Visual
        total_max = len(models) * DEFAULT_LIMIT
        print(f"\n📊 **KUMULASI TOKEN TERPAKAI**")
        print(f"{create_bar(total_used, total_max, 30)}")
        print(f"Total: {total_used} / {total_max} Req/Day")
        print("═" * 45)

        for i, m in enumerate(models, 1):
            name = m['model_name']
            model_id = m['litellm_params']['model']
            used = usage_map.get(model_id, 0)
            
            print(f"{i}. {name}")
            print(f"   📈 Usage: {create_bar(used, DEFAULT_LIMIT, 15)} ({used}/{DEFAULT_LIMIT})")
            print(f"   🟢 Status: Active")
            print("-" * 35)

    except Exception as e:
        print(f"Error monitor: {e}")

if __name__ == "__main__":
    get_usage()