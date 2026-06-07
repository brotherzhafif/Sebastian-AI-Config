'use strict';

const express = require('express');
const router = express.Router();

function getDashboardHTML(supabaseUrl, supabaseKey) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>🎩 Hermes Bridge — Advanced Dynamic Analytics</title>
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <style>
        *{box-sizing:border-box;margin:0;padding:0}
        :root{
            --bg:#0f1117;--surface:#1a1d27;--surface2:#22263a;--border:#2d3148;
            --text:#e2e8f0;--muted:#64748b;--accent:#6366f1;--green:#22c55e;
            --red:#ef4444;--yellow:#f59e0b;--blue:#3b82f6;
        }
        body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;min-height:100vh;padding-bottom:40px}
        header{background:var(--surface);border-bottom:1px solid var(--border);padding:16px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}
        header h1{font-size:18px;font-weight:700;display:flex;align-items:center;gap:8px}
        .badge{background:var(--accent);color:#fff;font-size:11px;padding:2px 8px;border-radius999px;font-weight:600}
        .badge.live{background:var(--green);animation:pulse 2s infinite}
        @keyframes pulse{0%{opacity:0.6} 50%{opacity:1} 100%{opacity:0.6}}
        .controls{padding:16px 24px;display:flex;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--border);background:var(--surface);align-items:center}
        select, input, button{background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;outline:none}
        input[type="date"]{color-scheme:dark}
        select:focus, input:focus, button:hover{border-color:var(--accent)}
        button.refresh{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
        
        .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;padding:24px}
        .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px}
        .card-label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
        .card-value{font-size:28px;font-weight:700;line-height:1}
        .card-value.green{color:var(--green)}
        .card-value.red{color:var(--red)}
        .card-value.yellow{color:var(--yellow)}
        .card-value.blue{color:var(--blue)}
        .card-sub{font-size:12px;color:var(--muted);margin-top:6px}
        
        .layout-split{display:grid;grid-template-columns:2fr 1fr;gap:24px;padding:0 24px 24px}
        @media(max-width:992px){.layout-split{grid-template-columns:1fr}}
        
        .section{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:24px}
        .section-header{display:flex;justify-content:between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px}
        .section-title{font-size:14px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
        
        .chart-wrap {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 20px;
            /* Hilangkan overflow horizontal agar tidak akan pernah ada scrollbar */
            overflow: hidden; 
            position: relative;
        }
        .chart-bars {
            display: flex;
            align-items: flex-end;
            gap: 4px; /* Persepat gap antar bar sedikit agar muat banyak */
            height: 200px;
            border-bottom: 1px solid var(--border);
            padding-bottom: 24px; /* Beri ruang ekstra di bawah untuk label yang miring */
            width: 100%; /* Paksa mengikuti lebar layar web */
        }
        .chart-bar-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            height: 100%;
            justify-content: flex-end;
            position: relative;
            min-width: 0; /* Mengizinkan flex-item menyusut di bawah ukuran kontennya */
        }
        .chart-bar {
            width: 100%;
            background: var(--accent);
            border-radius: 3px 3px 0 0;
            min-height: 2px;
            position: relative;
            cursor: pointer;
            transition: all 0.2s;
            z-index: 2;
        }
        .chart-bar:hover {
            transform: scaleY(1.02);
        }
        .line-node {
            width: 6px;
            height: 6px;
            background: var(--blue);
            border-radius: 50%;
            position: absolute;
            z-index: 4;
            cursor: pointer;
        }
        .chart-bar::after, .line-node::after {
            content: attr(data-tip);
            position: absolute;
            bottom: calc(100% + 6px);
            left: 50%;
            transform: translateX(-50%);
            background: #000;
            color: #fff;
            font-size: 10px;
            padding: 4px 8px;
            border-radius: 4px;
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            z-index: 20;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        }
        .chart-bar:hover::after, .line-node:hover::after {
            opacity: 1;
        }
        .chart-label-x {
            font-size: 8px; /* Kecilkan font sedikit untuk mode padat */
            color: var(--muted);
            margin-top: 8px;
            text-align: center;
            white-space: nowrap;
            /* TRIK SAKTI: Putar label 45 derajat agar tidak saling tabrakan */
            transform: rotate(-45deg) translateX(-8px);
            transform-origin: left top;
            position: absolute;
            top: 100%;
        }
        
        .pie-box{display:flex;flex-direction:column;align-items:center;justify-content:center;height:240px;position:relative}
        .pie-legend{display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;margin-top:16px;font-size:11px}
        .legend-item{display:flex;align-items:center;gap:6px;color:var(--text)}
        .legend-color{width:10px;height:10px;border-radius:2px}
        
        .date-range-inputs{display:inline-flex;align-items:center;gap:6px}
        canvas{max-width:100%}
    </style>
</head>
<body>
    <header>
        <h1>🎩 Hermes Realtime Dashboard <span class="badge live">● ONLINE</span></h1>
        <div style="text-align: right; font-size: 12px; color: var(--muted)">
            <div>Database Mode: Direct +7 WIB Storage</div>
            <div style="color: var(--yellow); font-weight: 600; margin-top: 2px;">Waktu Server: <span id="srv-time">—</span></div>
        </div>
    </header>
    
    <div class="controls">
        <label style="font-size:12px;color:var(--muted)">Periode:</label>
        <select id="range-sel" onchange="toggleRangeInputs()">
            <option value="today">Hari Ini</option>
            <option value="week">7 Hari Terakhir</option>
            <option value="month">30 Hari Terakhir</option>
            <option value="3months">3 Bulan Terakhir</option>
            <option value="all">Semua Waktu (All-Time)</option>
            <option value="custom">Kustom Range Tanggal</option>
        </select>

        <div id="custom-date-container" class="date-range-inputs" style="display:none;">
            <input type="date" id="start-date">
            <span>s/d</span>
            <input type="date" id="end-date">
        </div>
        
        <label style="font-size:12px;color:var(--muted)">Model:</label>
        <select id="model-sel" onchange="fetchAnalytics()">
          <option value="all">Semua Model</option>
          <option value="gemini-2.5-flash">gemini-2.5-flash</option>
          <option value="gemini-3.5-flash">gemini-3.5-flash</option>
          <option value="gemini-flash-latest">gemini-flash-latest</option>
          <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
        </select>

        <label style="font-size:12px;color:var(--muted)">Pecah:</label>
        <select id="bucket-sel" onchange="fetchAnalytics()">
            <option value="auto">Otomatis (Auto Fallback)</option>
            <option value="hour">Per Jam (Hourly Breakdown)</option>
            <option value="day">Per Hari (Daily Breakdown)</option>
        </select>

        <label style="font-size:12px;color:var(--muted)">Tipe Grafik:</label>
        <select id="view-sel" onchange="fetchAnalytics()">
            <option value="bar">Bar Chart (Batang)</option>
            <option value="line">Line Chart (Garis)</option>
        </select>

        <button class="refresh" onclick="fetchAnalytics()">↻ Terapkan</button>
        <span style="margin-left:auto;font-size:12px;color:var(--muted)" id="last-update">—</span>
    </div>

    <div class="grid">
        <div class="card"><div class="card-label">Total Request</div><div class="card-value blue" id="s-total">0</div><div class="card-sub" id="s-success">0 sukses</div></div>
        <div class="card"><div class="card-label">Token Masuk (Prompt)</div><div class="card-value yellow" id="s-input">0</div><div class="card-sub">Tokens consumed</div></div>
        <div class="card"><div class="card-label">Token Keluar (Output)</div><div class="card-value green" id="s-output">0</div><div class="card-sub">Tokens generated</div></div>
        <div class="card"><div class="card-label">Avg Latency</div><div class="card-value red" id="s-latency">0ms</div><div class="card-sub">Speed connection</div></div>
    </div>

    <div class="layout-split">
        <!-- Panel Grafik Utama (Kiri) -->
        <div class="section">
            <div class="section-header">
                <div class="section-title" id="graph-title">Statistik Distribusi Penggunaan</div>
            </div>
            <div class="chart-wrap">
                <div class="chart-bars" id="chart-bars"></div>
                <canvas id="line-canvas" style="position:absolute; top:20px; left:0; height:200px; width:100%; pointer-events:none; display:none; z-index:3;"></canvas>
            </div>
        </div>

        <!-- Panel Share Perbandingan Model (Kanan) -->
        <div class="section">
            <div class="section-title">Pangsa Request Model AI</div>
            <div class="pie-box">
                <canvas id="pie-canvas" width="180" height="180"></canvas>
            </div>
            <div class="pie-legend" id="pie-legend"></div>
        </div>
    </div>

    <script>
        const sbUrl = "${supabaseUrl}";
        const sbKey = "${supabaseKey}";
        const sbClient = supabase.createClient(sbUrl, sbKey);

        // Map Palette Warna Unik per Model AI agar konsisten
        const modelColors = {
          'gemini-2.5-flash': '#6366f1',       // Indigo
          'gemini-3.5-flash': '#3b82f6',       // Blue
          'gemini-flash-latest': '#22c55e',    // Green
          'gemini-3-flash-preview': '#06b6d4', // Cyan
          'other': '#64748b'                   // Slate Gray
        };

        function toggleRangeInputs() {
            const range = document.getElementById('range-sel').value;
            const container = document.getElementById('custom-date-container');
            container.style.display = (range === 'custom') ? 'inline-flex' : 'none';
            fetchAnalytics();
        }

        function fmt(n) {
            if(n >= 1e6) return (n/1e6).toFixed(1)+'M';
            if(n >= 1e3) return (n/1e3).toFixed(1)+'K';
            return n;
        }

        async function fetchAnalytics() {
            const range = document.getElementById('range-sel').value;
            const model = document.getElementById('model-sel').value;
            const start = document.getElementById('start-date').value;
            const end = document.getElementById('end-date').value;
            const bucket = document.getElementById('bucket-sel').value;
            
            let url = \`/dashboard/api/data?range=\${range}&model=\${model}&bucket=\${bucket}\`;
            if (range === 'custom') {
                url += \`&start=\${start}&end=\${end}\`;
            }

            try {
                const res = await fetch(url);
                const data = await res.json();
                renderDashboard(data);
            } catch(e) {
                console.error('API Error:', e);
            }
        }

        function renderDashboard(d) {
            document.getElementById('s-total').textContent = fmt(d.summary.total_requests);
            const pct = d.summary.total_requests ? Math.round((d.summary.success_requests / d.summary.total_requests) * 100) : 0;
            document.getElementById('s-success').textContent = \`\${fmt(d.summary.success_requests)} sukses (\${pct}%)\`;
            document.getElementById('s-input').textContent = fmt(d.summary.total_input_tokens);
            document.getElementById('s-output').textContent = fmt(d.summary.total_output_tokens);
            document.getElementById('s-latency').textContent = Math.round(d.summary.avg_latency) + 'ms';
            document.getElementById('last-update').textContent = 'Live Sync: ' + new Date().toLocaleTimeString('id-ID');
            document.getElementById('srv-time').textContent = d.server_time;
            document.getElementById('graph-title').textContent = 'Statistik Distribusi: ' + d.bucket_type.toUpperCase() + (d.fallback_triggered ? ' (AUTO-FALLBACK HOUR ACTIVATED)' : '');

            const chartBarsEl = document.getElementById('chart-bars');
            const lineCanvas = document.getElementById('line-canvas');
            const viewType = document.getElementById('view-sel').value;

            if (!d.timeline || d.timeline.length === 0) {
                chartBarsEl.innerHTML = '<div style="color:var(--muted);margin:auto;font-size:13px">Tidak ada log aktivitas data pada rentang ini</div>';
                lineCanvas.style.display = 'none';
                return;
            }

            const maxVal = Math.max(...d.timeline.map(t => t.count), 1);
            
            // Render Framework Kolom Grafik
            chartBarsEl.innerHTML = d.timeline.map((t, idx) => {
                const hPct = t.count ? Math.max((t.count / maxVal) * 100, 4) : 0;
                const tip = \`\${t.label} | \${t.count} Req (\${fmt(t.tokens)} Tkn)\`;
                
                if (viewType === 'line') {
                    // Tampilan Node Titik untuk Line Chart
                    const bottomPos = (hPct / 100) * 160; // sesuaikan tinggi wrapper (.chart-bars adalah 200px)
                    return \`
                        <div class="chart-bar-container" id="node-box-\${idx}">
                            <div class="line-node" style="bottom:\${bottomPos}px" data-tip="\${tip}"></div>
                            <div class="chart-label-x">\${t.label}</div>
                        </div>
                    \`;
                } else {
                    // Tampilan Bar Chart Bawaan Favoritmu
                    // Warnai bar berdasarkan warna model dominan atau warna aksen standar jika semua model terpilih
                    const barColor = d.selected_model !== 'all' ? (modelColors[d.selected_model] || 'var(--accent)') : 'var(--accent)';
                    return \`
                        <div class="chart-bar-container">
                            <div class="chart-bar" style="height:\${hPct}%; background:\${barColor}" data-tip="\${tip}"></div>
                            <div class="chart-label-x">\${t.label}</div>
                        </div>
                    \`;
                }
            }).join('');

            // Gambar Garis Penghubung Khusus Line Chart
            if (viewType === 'line') {
                lineCanvas.style.display = 'block';
                // Beri jeda sejenak agar DOM ter-render untuk menangkap ukuran koordinat asli
                setTimeout(() => drawLineChart(d.timeline, maxVal), 50);
            } else {
                lineCanvas.style.display = 'none';
            }

            // Render Pie Chart Pangsa Model AI
            renderPieChart(d.model_share);
        }

        function drawLineChart(timeline, maxVal) {
            const canvas = document.getElementById('line-canvas');
            const wrap = document.getElementById('chart-bars');
            canvas.width = wrap.clientWidth;
            canvas.height = wrap.clientHeight;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            ctx.beginPath();
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';

            timeline.forEach((t, idx) => {
                const container = document.getElementById(\`node-box-\${idx}\`);
                if (!container) return;
                
                const x = container.offsetLeft + (container.clientWidth / 2);
                const hPct = t.count ? Math.max((t.count / maxVal) * 100, 4) : 0;
                const y = canvas.height - 4 - ((hPct / 100) * 160); // Penyelarasan padding bawah grafik

                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        }

        function renderPieChart(shares) {
            const canvas = document.getElementById('pie-canvas');
            const ctx = canvas.getContext('2d');
            const legendEl = document.getElementById('pie-legend');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const total = Object.values(shares).reduce((a, b) => a + b, 0);
            if (total === 0) {
                ctx.fillStyle = 'var(--muted)';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Tidak ada sebaran model', canvas.width/2, canvas.height/2);
                legendEl.innerHTML = '';
                return;
            }

            let startAngle = 0;
            legendEl.innerHTML = '';

            Object.keys(shares).forEach(model => {
                const count = shares[model];
                if (count === 0) return;
                
                const sliceAngle = (count / total) * 2 * Math.PI;
                const color = modelColors[model] || modelColors['other'];

                // Draw Slice
                ctx.beginPath();
                ctx.pie = true;
                ctx.fillStyle = color;
                ctx.moveTo(canvas.width/2, canvas.height/2);
                ctx.arc(canvas.width/2, canvas.height/2, Math.min(canvas.width, canvas.height)/2 - 10, startAngle, startAngle + sliceAngle);
                ctx.closePath();
                ctx.fill();

                startAngle += sliceAngle;

                // Append Legend
                const pct = Math.round((count / total) * 100);
                legendEl.innerHTML += \`
                    <div class="legend-item">
                        <div class="legend-color" style="background:\${color}"></div>
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">\${model} (\${pct}%)</span>
                    </div>
                \`;
            });
        }

        sbClient
          .channel('schema-db-changes')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hermes_requests' }, () => {
              fetchAnalytics();
          })
          .subscribe();

        window.addEventListener('resize', () => {
            if(document.getElementById('view-sel').value === 'line') fetchAnalytics();
        });

        // Set default filter date
        const todayStr = new Date().toISOString().split('T')[0];
        document.getElementById('start-date').value = todayStr;
        document.getElementById('end-date').value = todayStr;

        fetchAnalytics();
    </script>
</body>
</html>`;
}

function initDashboardRouter(supabase) {
  
  router.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    return res.send(getDashboardHTML(supabase.supabaseUrl, supabase.supabaseKey));
  });

  router.get('/api/data', async (req, res) => {
    const { range, model, start, end, bucket } = req.query;

    try {
      let query = supabase
        .from('hermes_requests')
        .select('success, input_tokens, output_tokens, latency_ms, created_at, model');

      let bucketType = bucket || 'auto';
      let fallbackTriggered = false;

      // ── MENGHITUNG RENTANG FILTER TANGGAL (WIB COMPATIBLE) ──
      const tzOffset = 7 * 60 * 60 * 1000; // Offset +7 Jam WIB
      const localNow = new Date(Date.now() + tzOffset);
      const localTodayStr = localNow.toISOString().split('T')[0];

      if (range === 'today') {
        query = query.gte('created_at', `${localTodayStr} 00:00:00`).lte('created_at', `${localTodayStr} 23:59:59`);
        if (bucketType === 'auto') bucketType = 'hour';
      } else if (range === 'week') {
        const pastWeekDate = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000) + tzOffset);
        query = query.gte('created_at', `${pastWeekDate.toISOString().split('T')[0]} 00:00:00`);
        if (bucketType === 'auto') bucketType = 'day';
      } else if (range === 'month') {
        const pastMonthDate = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000) + tzOffset);
        query = query.gte('created_at', `${pastMonthDate.toISOString().split('T')[0]} 00:00:00`);
        if (bucketType === 'auto') bucketType = 'day';
      } else if (range === '3months') {
        const past3MonthsDate = new Date(Date.now() - (90 * 24 * 60 * 60 * 1000) + tzOffset);
        query = query.gte('created_at', `${past3MonthsDate.toISOString().split('T')[0]} 00:00:00`);
        if (bucketType === 'auto') bucketType = 'day';
      } else if (range === 'custom') {
        if (start) query = query.gte('created_at', `${start} 00:00:00`);
        if (end) query = query.lte('created_at', `${end} 23:59:59`);
        if (bucketType === 'auto') bucketType = 'day';
      } else if (range === 'all') {
        if (bucketType === 'auto') bucketType = 'month_year';
      }

      if (model && model !== 'all') query = query.eq('model', model);

      const { data, error } = await query;
      if (error) throw error;

      // ── AUTO-FALLBACK ENGINE: Hitung sebaran hari unik data ──
      if (bucket === 'auto' && (range === 'week' || range === 'month' || range === 'custom')) {
        const uniqueDays = new Set(data.map(item => item.created_at.split(/[\sT]/)[0]));
        // Jika data sepi (kurang dari 3 hari terisi), paksa pecah per jam biar grafik berbobot (> 20 kolom)
        if (uniqueDays.size < 3 && data.length > 0) {
          bucketType = 'hour_expanded';
          fallbackTriggered = true;
        }
      }

      // Hitung agregat Top Card Summary
      const summary = {
        total_requests: data.length,
        success_requests: data.filter(r => r.success).length,
        total_input_tokens: data.reduce((acc, r) => acc + (r.input_tokens || 0), 0),
        total_output_tokens: data.reduce((acc, r) => acc + (r.output_tokens || 0), 0),
        avg_latency: data.length ? (data.reduce((acc, r) => acc + (r.latency_ms || 0), 0) / data.length) : 0
      };

      // Hitung Sebaran Pangsa Pasar Model AI (Sesuai MODEL_FALLBACK_CHAIN)
      const modelShare = {
        'gemini-2.5-flash': 0,
        'gemini-3.5-flash': 0,
        'gemini-flash-latest': 0,
        'gemini-3-flash-preview': 0,
        'other': 0
      };

      data.forEach(r => {
        if (modelShare[r.model] !== undefined) modelShare[r.model]++;
        else modelShare['other']++;
      });

      // ── PROSES PENGELOMPOKKAN GRAFIK (DYNAMIC BUCKETING ENGINE) ──
      const timelineMap = {};

      // ── UPDATE DI BAGIAN BUCKET TYPE HOUR ──
      if (bucketType === 'hour') {
        // Ambil rentang tanggal dari data terkecil dan terbesar agar mencakup pergantian hari
        const dates = data.map(item => item.created_at.split(/[\sT]/)[0]).sort();
        const baseDates = dates.length > 0 ? [...new Set(dates)] : [localTodayStr];

        // Generate template jam penuh (00:00 - 23:00) yang mengunci tanggalnya agar sort tidak tertukar
        baseDates.forEach(dStr => {
          for (let i = 0; i < 24; i++) {
            const hr = `${String(i).padStart(2, '0')}:00`;
            // Gunakan key kombinasi "YYYY-MM-DD HH:00" agar urutan sort mutlak kronologis
            timelineMap[`${dStr} ${hr}`] = { count: 0, tokens: 0 };
          }
        });

        data.forEach(item => {
          const parts = item.created_at.split(/[\sT]/);
          const dStr = parts[0];
          const timePart = parts[1];
          if (timePart) {
            const hour = timePart.split(':')[0];
            const labelKey = `${dStr} ${hour}:00`;
            
            if (timelineMap[labelKey]) {
              timelineMap[labelKey].count++;
              timelineMap[labelKey].tokens += (item.input_tokens || 0) + (item.output_tokens || 0);
            }
          }
        });
      }
      else if (bucketType === 'hour_expanded') {
        // 1. Cari tanggal minimal dan maksimal dari data yang didapat
        const dates = data.map(item => item.created_at.split(/[\sT]/)[0]).sort();
        
        if (dates.length > 0) {
          const startDate = new Date(dates[0]);
          const endDate = new Date(dates[dates.length - 1]);
          
          // Jaga-jaga jika datanya di hari yang sama, kita paksa minimal generate 2 hari agar rentang jamnya kelihatan trennya
          if (dates[0] === dates[dates.length - 1]) {
            endDate.setDate(endDate.getDate() + 1);
          }

          // 2. Generate template jam penuh (00:00 s/d 23:00) untuk setiap hari di dalam rentang tersebut
          let cursor = new Date(startDate);
          while (cursor <= endDate) {
            const dateStr = cursor.toISOString().split('T')[0].substring(5); // Format: MM-DD
            for (let h = 0; h < 24; h++) {
              const hourStr = `${String(h).padStart(2, '0')}:00`;
              timelineMap[`${dateStr} ${hourStr}`] = { count: 0, tokens: 0 };
            }
            cursor.setDate(cursor.getDate() + 1);
          }
        }

        // 3. Masukkan data asli dari database ke dalam template yang sudah padat
        data.forEach(item => {
          const parts = item.created_at.split(/[\sT]/);
          const datePart = parts[0].substring(5); // MM-DD
          const hourPart = parts[1] ? parts[1].split(':')[0] + ':00' : '00:00';
          const label = `${datePart} ${hourPart}`;
          
          // Jika karena suatu hal kursor template terlewat, buat cadangannya secara dinamis
          if (!timelineMap[label]) timelineMap[label] = { count: 0, tokens: 0 };
          
          timelineMap[label].count++;
          timelineMap[label].tokens += (item.input_tokens || 0) + (item.output_tokens || 0);
        });

        // 4. FILTER: Biar grafik gak kepanjangan berhari-hari kosong, buang zero-buckets di awal/akhir yang berlebihan
        // 4. IMPLEMENTASI FILTER: Buang zero-buckets di awal sebelum data pertama muncul
        const sortedKeys = Object.keys(timelineMap).sort();
        
        // Cari indeks pertama yang benar-benar ada request-nya
        let firstActiveIdx = sortedKeys.findIndex(key => timelineMap[key].count > 0);
        // Cari indeks terakhir yang benar-back ada request-nya
        let lastActiveIdx = sortedKeys.length - 1 - [...sortedKeys].reverse().findIndex(key => timelineMap[key].count > 0);

        // Beri sedikit "napas" margin (misal tampilkan 3 jam sebelum dan 3 jam setelah data aktif)
        const startTrim = Math.max(0, firstActiveIdx - 3);
        const endTrim = Math.min(sortedKeys.length, lastActiveIdx + 4);

        // Potong keys yang akan dimasukkan ke timeline asli
        const trimmedKeys = sortedKeys.slice(startTrim, endTrim);
        
        // Bentuk array timeline hanya berdasarkan keys yang sudah dipangkas
        const timeline = trimmedKeys.map(key => ({
          label: key,
          count: timelineMap[key].count,
          tokens: timelineMap[key].tokens
        }));

        // Return langsung dari block ini agar tidak ditimpa oleh fungsi global .map() di bawahnya
        const currentServerTime = new Date().toLocaleString('id-ID', {
          timeZone: 'Asia/Jakarta',
          dateStyle: 'medium',
          timeStyle: 'medium'
        });

        return res.json({ 
          summary, 
          timeline, 
          model_share: modelShare,
          bucket_type: bucketType,
          selected_model: model || 'all',
          fallback_triggered: fallbackTriggered,
          server_time: currentServerTime
        });
      }
      else if (bucketType === 'day') {
        // Mode Harian Bersih
        data.forEach(item => {
          const label = item.created_at.split(/[\sT]/)[0]; // YYYY-MM-DD
          if (!timelineMap[label]) timelineMap[label] = { count: 0, tokens: 0 };
          timelineMap[label].count++;
          timelineMap[label].tokens += (item.input_tokens || 0) + (item.output_tokens || 0);
        });
      } 
      else if (bucketType === 'month_year') {
        data.forEach(item => {
          const parts = item.created_at.split(/[\sT]/)[0].split('-'); // [YYYY, MM, DD]
          const label = `${parts[0]}-${parts[1]}`; // YYYY-MM
          if (!timelineMap[label]) timelineMap[label] = { count: 0, tokens: 0 };
          timelineMap[label].count++;
          timelineMap[label].tokens += (item.input_tokens || 0) + (item.output_tokens || 0);
        });
      }

      // Pastikan data berurutan secara kronologis maju
      const timeline = Object.keys(timelineMap).sort().map(key => ({
        label: key,
        count: timelineMap[key].count,
        tokens: timelineMap[key].tokens
      }));

      const currentServerTime = new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        dateStyle: 'medium',
        timeStyle: 'medium'
      });

      return res.json({ 
        summary, 
        timeline, 
        model_share: modelShare,
        bucket_type: bucketType,
        selected_model: model || 'all',
        fallback_triggered: fallbackTriggered,
        server_time: currentServerTime
      });

    } catch (err) {
      console.error('🚨 Dashboard API Multi-scale Error:', err.message);
      return res.status(500).json({ error: 'Gagal mengompilasi agregasi rentang waktu dinamis' });
    }
  });

  return router;
}

module.exports = initDashboardRouter;