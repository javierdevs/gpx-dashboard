 // ── Supabase config ──────────────────────────────────────────
    const SUPABASE_URL = 'https://uiocfousdsfphddqajtx.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpb2Nmb3VzZHNmcGhkZHFhanR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2Mzg2MzcsImV4cCI6MjA5MjIxNDYzN30.sIlGJle8IP7ur0NW1-iJR1KcLkcKhfFc9t-L81i3JgA';
    const BUCKET = 'gpx-files';
    const { createClient } = supabase;
    const db = createClient(SUPABASE_URL, SUPABASE_KEY);

    // ── Auth ─────────────────────────────────────────────────────
    async function checkSession() {
        const { data: { session } } = await db.auth.getSession();
        if (session) {
            showDashboard(session.user.email);
        } else {
            document.getElementById('login-screen').style.display = 'flex';
        }
    }

    function showDashboard(email) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('user-email').textContent = email;
        loadFromCloud();
    }

    document.getElementById('login-btn').addEventListener('click', async function() {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');
        errorEl.textContent = '';

        const { data, error } = await db.auth.signInWithPassword({ email, password });

        if (error) {
            errorEl.textContent = 'Correo o contraseña incorrectos';
            return;
        }

        showDashboard(data.user.email);
    });

    document.getElementById('logout-btn').addEventListener('click', async function() {
        await db.auth.signOut();
        location.reload();
    });

    const map = L.map('map').setView([0, 0], 2);

    const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap © CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    });

    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri © OpenStreetMap',
        maxZoom: 19
    });

    darkLayer.addTo(map);
    let isSatellite = false;

    let totalGlobalDist = 0;
    // statsData structure: { "YYYY-MM": { label, weekStart, weekEnd, dist } }
    const statsData = {};

    // Track cards data for sorting: [{ date: Date, element: HTMLElement, layer, color }]
    let trackCards = [];
    let sortDescending = true; // true = más reciente primero
    let selectedCard = null;   // currently selected track card entry
    const allBounds = [];

    /* ── Week helpers ──────────────────────────────────────────── */

    /** Returns the Monday of the ISO week containing `date` */
    function getISOMonday(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        const day = d.getDay(); // 0=Sun
        const diff = (day === 0) ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        return d;
    }

    /** ISO week number (1-53) */
    function getISOWeek(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
        const week1 = new Date(d.getFullYear(), 0, 4);
        return 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    }

    function getWeekInfo(date) {
        const monday = getISOMonday(date);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        const opts = { day: '2-digit', month: 'short' };
        const isoWeek = getISOWeek(monday);

        // Key: year + ISO week number so weeks never bleed across months
        const year = monday.getFullYear();
        const weekKey = `${year}-W${String(isoWeek).padStart(2, '0')}`;

        const monthLabel = monday.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase();
        const rangeLabel = `Semana ${isoWeek} · ${monday.toLocaleDateString('es-ES', opts)} – ${sunday.toLocaleDateString('es-ES', opts)}`;

        return { weekKey, monthLabel, rangeLabel, monday, sunday };
    }

    /* ── File input ────────────────────────────────────────────── */
// ── Renderiza un GPX en el mapa y sidebar ────────────────────
    function renderGPX(gpxText, filename, fromCloud = false, storagePath = null) {
        return new Promise((resolve) => {
        const color = '#' + ((1 << 24) * Math.random() | 0).toString(16).padStart(6, '0');

        new L.GPX(gpxText, {
            async: true,
            marker_options: { startIconUrl: null, endIconUrl: null, shadowUrl: null },
            polyline_options: { color, weight: 4, opacity: 0.8 }
        }).on('loaded', function(ev) {
            const g = ev.target;
            const distKm = g.get_distance() / 1000;
            const durationMs = g.get_moving_time();
            const speedKmh = durationMs > 0 ? (distKm / (durationMs / 3600000)) : 0;
            const start = g.get_start_time();
            const end   = g.get_end_time();

            totalGlobalDist += distKm;
            document.getElementById('global-km').innerText = totalGlobalDist.toFixed(2);

            if (start) {
                const info = getWeekInfo(start);
                if (!statsData[info.weekKey]) {
                    statsData[info.weekKey] = { monthLabel: info.monthLabel, rangeLabel: info.rangeLabel, monday: info.monday, dist: 0 };
                }
                statsData[info.weekKey].dist += distKm;
                updateStatsUI();
            }

            const card = document.createElement('div');
            card.className = 'track-card';
            card.style.borderLeftColor = color;
            card.dataset.timestamp = start ? start.getTime() : 0;
            card.innerHTML = `
                <button class="delete-btn" title="Eliminar ruta">✕</button>
                <h4>${filename}</h4>
                <div class="grid-meta">
                    <div>Fecha: <span class="val">${start ? start.toLocaleDateString('es-ES') : 'N/A'}</span></div>
                    <div>Dist: <span class="val">${distKm.toFixed(2)} km</span></div>
                    <div>Inicio: <span class="val">${start ? start.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--'}</span></div>
                    <div>Fin: <span class="val">${end ? end.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--'}</span></div>
                    <div style="grid-column: span 2">Vel. Media: <span class="val">${speedKmh.toFixed(2)} km/h</span></div>
                </div>
            `;

            const entry = { date: start ? start.getTime() : 0, element: card, layer: g, color };
            trackCards.push(entry);
            card.addEventListener('click', () => selectTrack(entry));

            const deleteBtn = card.querySelector('.delete-btn');
            if (storagePath) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteTrack(entry, storagePath);
                });
            } else {
                deleteBtn.style.display = 'none';
            }

            allBounds.push(g.getBounds());
            renderCards();
            resolve();
        }).on('error', () => resolve()).addTo(map);
    });
}

    // ── Subir archivos nuevos a Supabase ────────────────────────
    async function uploadFiles(files) {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`Subiendo ${i + 1}/${files.length}: ${file.name}`);

        try {
            const storagePath = `${Date.now()}_${file.name}`;

            const { error: upError } = await db.storage
                .from(BUCKET)
                .upload(storagePath, file, { contentType: 'application/gpx+xml' });

            if (upError) throw upError;

            const { error: dbError } = await db
                .from('gpx_tracks')
                .insert({ filename: file.name, storage_path: storagePath });

            if (dbError) throw dbError;

            const text = await file.text();
            await renderGPX(text, file.name, true, storagePath);

        } catch (err) {
            console.error('Error subiendo', file.name, err);
        }
    }
}

document.getElementById('gpx-input').addEventListener('change', function(e) {
    uploadFiles(e.target.files);
    this.value = '';
});

    // ── Eliminar ruta ────────────────────────────────────────────
    async function deleteTrack(entry, storagePath) {
        if (!confirm('¿Eliminar esta ruta?')) return;

        try {
            await db.storage.from(BUCKET).remove([storagePath]);

            await db.from('gpx_tracks')
                .delete()
                .eq('storage_path', storagePath);

            map.removeLayer(entry.layer);
            trackCards = trackCards.filter(t => t !== entry);
            if (selectedCard === entry) selectedCard = null;
            renderCards();

        } catch (err) {
            console.error('Error eliminando ruta:', err);
        }
    }

    /* ── Track selection & highlight ──────────────────────────── */

    function selectTrack(entry) {
        // Deselect previous
        if (selectedCard) {
            selectedCard.element.classList.remove('selected');
            // Restore all tracks to normal opacity/weight
            trackCards.forEach(t => {
                t.layer.getLayers().forEach(l => {
                    if (l.setStyle) l.setStyle({ opacity: 0.8, weight: 4 });
                    else if (l.setOpacity) l.setOpacity(0.8);
                });
            });
        }

        // Clicking the same card again deselects
        if (selectedCard === entry) {
            selectedCard = null;
            return;
        }

        selectedCard = entry;
        entry.element.classList.add('selected');

        // Dim all other tracks
        trackCards.forEach(t => {
            const isSelected = t === entry;
            t.layer.getLayers().forEach(l => {
                if (l.setStyle) l.setStyle({
                    opacity: isSelected ? 1 : 0.15,
                    weight: isSelected ? 6 : 3
                });
                else if (l.setOpacity) l.setOpacity(isSelected ? 1 : 0.15);
            });
        });

        // Bring selected to front and fit bounds
        entry.layer.bringToFront();
        map.fitBounds(entry.layer.getBounds(), { padding: [40, 40] });
    }

    /* ── Sorting ───────────────────────────────────────────────── */

    function renderCards() {
        const sorted = [...trackCards].sort((a, b) =>
            sortDescending ? b.date - a.date : a.date - b.date
        );
        const list = document.getElementById('file-list');
        list.innerHTML = '';
        sorted.forEach(item => list.appendChild(item.element));
    }

    // ── Toggle satellite/dark map ────────────────────────────────
    document.getElementById('satellite-btn').addEventListener('click', function() {
        isSatellite = !isSatellite;
        if (isSatellite) {
            map.removeLayer(darkLayer);
            satelliteLayer.addTo(map);
            this.textContent = '🗺 Vista oscura';
        } else {
            map.removeLayer(satelliteLayer);
            darkLayer.addTo(map);
            this.textContent = '🛰 Vista satélite';
        }
    });
    
    document.getElementById('sort-btn').addEventListener('click', function() {
        sortDescending = !sortDescending;
        this.classList.toggle('asc', !sortDescending);
        document.getElementById('sort-label').textContent = sortDescending
            ? 'Más reciente primero'
            : 'Más antiguo primero';
        renderCards();
    });

    /* ── Stats UI ──────────────────────────────────────────────── */

    function updateStatsUI() {
        const container = document.getElementById('weekly-list');
        container.innerHTML = '';

        // Sort weeks chronologically descending
        const sortedKeys = Object.keys(statsData).sort((a, b) => b.localeCompare(a));

        // Group by month for display
        const byMonth = {};
        for (const key of sortedKeys) {
            const entry = statsData[key];
            if (!byMonth[entry.monthLabel]) byMonth[entry.monthLabel] = [];
            byMonth[entry.monthLabel].push({ key, ...entry });
        }

        for (const [month, weeks] of Object.entries(byMonth)) {
            const mesHeader = document.createElement('div');
            mesHeader.innerHTML = `<div style="color:var(--accent); margin-top:10px; font-weight:bold;">● ${month}</div>`;
            container.appendChild(mesHeader);

            for (const w of weeks) {
                const semDiv = document.createElement('div');
                semDiv.className = 'week-entry';
                semDiv.innerHTML = `
                    <div style="font-size:0.8em; color:#888">${w.rangeLabel}</div>
                    <div style="font-weight:bold">${w.dist.toFixed(2)} km</div>
                `;
                container.appendChild(semDiv);
            }
        }
    }
    // ── Cargar todas las rutas desde Supabase al abrir la página ──
    async function loadFromCloud() {
        try {
            const { data: tracks, error } = await db
                .from('gpx_tracks')
                .select('*')
                .order('uploaded_at', { ascending: false });

            if (error) throw error;
            if (!tracks || tracks.length === 0) return;

            for (let i = 0; i < tracks.length; i++) {
                const track = tracks[i];

                const { data: fileData, error: dlError } = await db.storage
                    .from(BUCKET)
                    .download(track.storage_path);

                if (dlError) { console.warn('Error descargando', track.filename); continue; }

                const text = await fileData.text();
                await renderGPX(text, track.filename, true, track.storage_path);
            }

            if (allBounds.length > 0) {
                const combined = allBounds.reduce((acc, b) => acc.extend(b), L.latLngBounds(allBounds[0]));
                map.fitBounds(combined, { padding: [30, 30] });
            }

        } catch (err) {
            console.error('Error cargando desde Supabase:', err);
        }
    }

    checkSession();