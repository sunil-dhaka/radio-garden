/* ============================================================
   Radio Garden - Application Logic (v3)
   ============================================================ */

const DEFAULT_STATIONS = [
    {
        id: 'radio-aashiqanaa',
        name: 'Radio Aashiqanaa',
        location: 'Kanpur, India',
        streamUrl: 'https://mars.streamerr.co/8154/stream',
    },
    {
        id: 'marwar-radio',
        name: 'Marwar Radio',
        location: 'Pali, India',
        streamUrl: 'https://stream.zeno.fm/vq6p5vxb4v8uv',
    },
    {
        id: 'kishore-kumar-radio',
        name: 'Kishore Kumar Radio',
        location: 'Mumbai, India',
        streamUrl: 'https://radio.garden/api/ara/content/listen/sG9ZZzTf/channel.mp3',
    },
];

const STORAGE_KEY = 'radio-garden-stations-v2';
const ONBOARDED_KEY = 'radio-garden-onboarded';
const VIZ_KEY = 'radio-garden-viz';

const RADIO_GARDEN_REGEX = /\/listen\/[^/]+\/([a-zA-Z0-9_]+)/;
const CORS_PROXIES = [
    url => 'https://corsproxy.io/?' + encodeURIComponent(url),
    url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
];

/* -- State ------------------------------------------------ */
let stations = [];
let selectedStationId = null;
let playingStationId = null;
let vizMode = localStorage.getItem(VIZ_KEY) || 'rainbow';
let isPlaying = false;
let isBuffering = false;
let balloonHelpEnabled = false;
let resolvedStation = null; // For add-station dialog

/* -- DOM refs --------------------------------------------- */
const audio = document.getElementById('audio-player');
const stationListEl = document.getElementById('station-list');
const statusText = document.getElementById('status-text');
const statusBar = document.getElementById('status-bar');
const statusRight = document.getElementById('status-right');
const currentNameEl = document.getElementById('current-station-name');
const currentLocEl = document.getElementById('current-station-location');
const nowPlayingLabel = document.getElementById('now-playing-label');
const nowPlayingText = document.getElementById('now-playing-text');
const stopBtn = document.getElementById('stop-btn');
const volumeSlider = document.getElementById('volume');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');
const vizLabel = document.getElementById('visualizer-label');

/* -- Visualizer State ------------------------------------- */
const BAR_COUNT = 40;
let fakeBarHeights = new Array(BAR_COUNT).fill(0);
let displayHeights = new Array(BAR_COUNT).fill(0);
let peakHeights = new Array(BAR_COUNT).fill(0);
let peakVelocity = new Array(BAR_COUNT).fill(0);
let peakHold = new Array(BAR_COUNT).fill(0);
let animFrameId = null;

// Pre-computed color tables (rebuilt on viz mode change or resize)
let rainbowColors = null;
let radialColors = null;
const RADIAL_COUNT = BAR_COUNT * 2;

const VIZ_LABELS = {
    rainbow: 'RAINBOW SPECTRUM',
    radial: 'RADIAL BURST',
    aurora: 'AURORA WAVES',
    scope: 'OSCILLOSCOPE',
};

function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    rainbowColors = null; // Force rebuild
    radialColors = null;
}

function buildRainbowColors() {
    rainbowColors = [];
    for (let i = 0; i < BAR_COUNT; i++) {
        const hue = (i / BAR_COUNT) * 280;
        rainbowColors.push({
            glow: 'hsl(' + hue + ',100%,50%)',
            cap: 'hsl(' + hue + ',100%,80%)',
            peak: 'hsl(' + hue + ',100%,90%)',
            gradStops: [
                'hsl(' + hue + ',100%,65%)',
                'hsl(' + hue + ',95%,50%)',
                'hsl(' + hue + ',80%,25%)',
            ],
        });
    }
}

function buildRadialColors() {
    radialColors = [];
    for (let i = 0; i < RADIAL_COUNT; i++) {
        const hue = (i / RADIAL_COUNT) * 360;
        radialColors.push({
            glow: 'hsl(' + hue + ',100%,50%)',
            core: 'hsl(' + hue + ',100%,65%)',
            tip: 'hsl(' + hue + ',100%,85%)',
            peak: 'hsl(' + hue + ',100%,95%)',
        });
    }
}

// Reusable element for escapeHtml
const _escDiv = document.createElement('div');

/* -- Visualizer Drawing ----------------------------------- */
let lastFrameTime = 0;
const FRAME_INTERVAL = 1000 / 30; // 30fps
let idleDrawn = false;

function startVisualizer() {
    if (animFrameId) return;
    idleDrawn = false;
    animFrameId = requestAnimationFrame(drawVisualizer);
}

function stopVisualizer() {
    // Draw one final idle frame, then stop
    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
    drawIdleFrame();
}

function drawIdleFrame() {
    const w = canvas.width, h = canvas.height;
    if (w === 0 || h === 0) return;
    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, w, h);
    // Dim grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gy = 0; gy < h; gy += 24) { ctx.moveTo(0, gy); ctx.lineTo(w, gy); }
    for (let gx = 0; gx < w; gx += 24) { ctx.moveTo(gx, 0); ctx.lineTo(gx, h); }
    ctx.stroke();
    idleDrawn = true;
}

function drawVisualizer(timestamp) {
    animFrameId = requestAnimationFrame(drawVisualizer);

    // Throttle to 30fps
    if (timestamp - lastFrameTime < FRAME_INTERVAL) return;
    lastFrameTime = timestamp;

    // If idle and we already drew the static frame, skip entirely
    const active = isPlaying || isBuffering;
    if (!active && idleDrawn) return;
    if (!active) { drawIdleFrame(); return; }

    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;

    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, w, h);

    // Grid - single batched path
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gy = 0; gy < h; gy += 24) { ctx.moveTo(0, gy); ctx.lineTo(w, gy); }
    for (let gx = 0; gx < w; gx += 24) { ctx.moveTo(gx, 0); ctx.lineTo(gx, h); }
    ctx.stroke();

    updateBarData(h);

    switch (vizMode) {
        case 'rainbow': drawRainbow(w, h); break;
        case 'radial':  drawRadial(w, h);  break;
        case 'aurora':  drawAurora(w, h);  break;
        case 'scope':   drawScope(w, h);   break;
    }
    idleDrawn = false;
}

function updateBarData(h) {
    const active = isPlaying || isBuffering;
    const maxH = h * 0.82;
    for (let i = 0; i < BAR_COUNT; i++) {
        let target;
        if (active) {
            const t = Date.now();
            target = (
                Math.sin(t / 280 + i * 0.65) * 0.25 +
                Math.sin(t / 620 + i * 1.4) * 0.20 +
                Math.sin(t / 140 + i * 2.3) * 0.12 +
                Math.sin(t / 900 + i * 0.3) * 0.10 +
                Math.cos(t / 400 + i * 3.1) * 0.08 +
                0.38
            ) * maxH;
            target += (Math.random() - 0.5) * 3;
            target = Math.max(2, target);
            if (isBuffering) target *= 0.4; // Lower bars while buffering
        } else {
            target = 0;
        }

        fakeBarHeights[i] += (target - fakeBarHeights[i]) * 0.18;

        if (fakeBarHeights[i] >= displayHeights[i]) {
            displayHeights[i] = fakeBarHeights[i];
        } else {
            displayHeights[i] *= 0.93;
        }
        if (displayHeights[i] < 1) displayHeights[i] = 0;

        if (displayHeights[i] >= peakHeights[i]) {
            peakHeights[i] = displayHeights[i];
            peakVelocity[i] = 0.5;
            peakHold[i] = 25;
        } else if (peakHold[i] > 0) {
            peakHold[i]--;
        } else {
            peakHeights[i] -= peakVelocity[i];
            peakVelocity[i] *= 1.08;
            if (peakHeights[i] < 0) peakHeights[i] = 0;
        }
    }
}

function barLayout(w) {
    const gap = 2;
    const barW = (w / BAR_COUNT) - gap;
    return { barW, gap };
}

function drawRainbow(w, h) {
    if (!rainbowColors) buildRainbowColors();
    const { barW, gap } = barLayout(w);

    // Glow pass (all bars, single alpha change)
    ctx.globalAlpha = 0.15;
    for (let i = 0; i < BAR_COUNT; i++) {
        const barH = displayHeights[i];
        if (barH < 1) continue;
        const x = i * (barW + gap) + gap / 2;
        ctx.fillStyle = rainbowColors[i].glow;
        ctx.fillRect(x - 2, h - barH - 2, barW + 4, barH + 4);
    }
    ctx.globalAlpha = 1;

    // Core bars
    for (let i = 0; i < BAR_COUNT; i++) {
        const barH = displayHeights[i];
        if (barH < 1) continue;
        const x = i * (barW + gap) + gap / 2;
        const y = h - barH;
        const c = rainbowColors[i];

        const grad = ctx.createLinearGradient(0, y, 0, h);
        grad.addColorStop(0, c.gradStops[0]);
        grad.addColorStop(0.4, c.gradStops[1]);
        grad.addColorStop(1, c.gradStops[2]);
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, barH);

        if (barH > 4) {
            ctx.fillStyle = c.cap;
            ctx.fillRect(x, y, barW, 2);
        }
        if (peakHeights[i] > 2) {
            ctx.fillStyle = c.peak;
            ctx.fillRect(x, h - peakHeights[i], barW, 2);
        }
    }
}

/* -- Radial Burst Mode ------------------------------------ */
function drawRadial(w, h) {
    if (!radialColors) buildRadialColors();
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(cx, cy) * 0.88;
    const innerR = maxR * 0.12;
    const scale = (maxR - innerR) / (h * 0.82);

    // Inner ring
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Pre-compute angles
    const PI2 = Math.PI * 2;
    const halfPI = Math.PI / 2;

    // Glow pass (all bars, one alpha state)
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 5;
    for (let i = 0; i < RADIAL_COUNT; i++) {
        const dataIdx = i % BAR_COUNT;
        const barH = displayHeights[dataIdx];
        if (barH < 1) continue;
        const angle = (i / RADIAL_COUNT) * PI2 - halfPI;
        const barLen = barH * scale;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        ctx.strokeStyle = radialColors[i].glow;
        ctx.beginPath();
        ctx.moveTo(cx + cos * innerR, cy + sin * innerR);
        ctx.lineTo(cx + cos * (innerR + barLen), cy + sin * (innerR + barLen));
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Core pass
    ctx.lineWidth = 2.5;
    for (let i = 0; i < RADIAL_COUNT; i++) {
        const dataIdx = i % BAR_COUNT;
        const barH = displayHeights[dataIdx];
        if (barH < 1) continue;
        const angle = (i / RADIAL_COUNT) * PI2 - halfPI;
        const barLen = barH * scale;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const ex = cx + cos * (innerR + barLen);
        const ey = cy + sin * (innerR + barLen);

        ctx.strokeStyle = radialColors[i].core;
        ctx.beginPath();
        ctx.moveTo(cx + cos * innerR, cy + sin * innerR);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        // Tip dot
        ctx.fillStyle = radialColors[i].tip;
        ctx.fillRect(ex - 1, ey - 1, 3, 3);

        // Peak
        if (peakHeights[dataIdx] > 2) {
            const peakLen = peakHeights[dataIdx] * scale;
            ctx.fillStyle = radialColors[i].peak;
            ctx.fillRect(
                cx + cos * (innerR + peakLen) - 1,
                cy + sin * (innerR + peakLen) - 1, 3, 3
            );
        }
    }
}

/* -- Aurora Waves Mode ------------------------------------ */
const AURORA_WAVES = [
    { color: '#FF00AA', glow: '#FF0088', speed: 280, freq: 0.012, amp: 0.14 },
    { color: '#00FFCC', glow: '#00CCAA', speed: 350, freq: 0.009, amp: 0.16 },
    { color: '#FFAA00', glow: '#CC8800', speed: 420, freq: 0.015, amp: 0.12 },
    { color: '#44FF00', glow: '#33CC00', speed: 300, freq: 0.011, amp: 0.15 },
    { color: '#8855FF', glow: '#6633DD', speed: 500, freq: 0.008, amp: 0.18 },
    { color: '#FF4466', glow: '#CC3355', speed: 260, freq: 0.013, amp: 0.13 },
];

function drawAurora(w, h) {
    const t = Date.now();
    const active = isPlaying || isBuffering;
    const intensity = active ? (isBuffering ? 0.4 : 1.0) : 0.05;
    const step = 4; // pixels per sample (was 3)
    const numPts = Math.ceil(w / step) + 1;

    for (let wi = 0; wi < AURORA_WAVES.length; wi++) {
        const wave = AURORA_WAVES[wi];
        const baseY = (h / (AURORA_WAVES.length + 1)) * (wi + 1);
        const ampScale = wave.amp * baseY * intensity;

        // Compute Y values once, reuse for all 3 passes
        const ys = new Float32Array(numPts);
        for (let j = 0; j < numPts; j++) {
            const px = j * step;
            ys[j] = baseY +
                Math.sin(t / wave.speed + px * wave.freq) * ampScale +
                Math.sin(t / (wave.speed * 1.7) + px * wave.freq * 2.3 + wi) * (ampScale * 0.5) +
                Math.cos(t / (wave.speed * 0.6) + px * wave.freq * 0.4) * (ampScale * 0.3);
        }

        // Glow pass
        ctx.lineWidth = 6;
        ctx.strokeStyle = wave.glow;
        ctx.globalAlpha = 0.15 * intensity;
        ctx.beginPath();
        for (let j = 0; j < numPts; j++) {
            if (j === 0) ctx.moveTo(0, ys[0]);
            else ctx.lineTo(j * step, ys[j]);
        }
        ctx.stroke();

        // Fill below wave
        ctx.globalAlpha = 0.04 * intensity;
        ctx.fillStyle = wave.color;
        ctx.beginPath();
        for (let j = 0; j < numPts; j++) {
            if (j === 0) ctx.moveTo(0, ys[0]);
            else ctx.lineTo(j * step, ys[j]);
        }
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();

        // Core line
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = wave.color;
        ctx.globalAlpha = 0.7 * intensity + 0.3;
        ctx.beginPath();
        for (let j = 0; j < numPts; j++) {
            if (j === 0) ctx.moveTo(0, ys[0]);
            else ctx.lineTo(j * step, ys[j]);
        }
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

function drawScope(w, h) {
    const bufLen = 128;
    // Center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();

    // Wide glow pass (no shadowBlur)
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0, 180, 255, 0.12)';
    drawScopePath(w, h, bufLen);

    // Mid pass
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(68, 136, 255, 0.4)';
    drawScopePath(w, h, bufLen);

    // Core line
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4488FF';
    drawScopePath(w, h, bufLen);
}

function drawScopePath(w, h, bufLen) {
    ctx.beginPath();
    const sliceW = w / bufLen;
    let x = 0;
    const t = Date.now();
    const active = isPlaying || isBuffering;
    for (let i = 0; i < bufLen; i++) {
        let v = 1;
        if (active) {
            v = 1 +
                Math.sin(t / 180 + i * 0.18) * 0.30 +
                Math.sin(t / 450 + i * 0.09) * 0.18 +
                Math.sin(t / 90 + i * 0.35) * 0.08 +
                Math.cos(t / 300 + i * 0.25) * 0.06;
            if (isBuffering) v = 1 + (v - 1) * 0.3;
        }
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += sliceW;
    }
    ctx.stroke();
}

function drawReflection(w, h) {
    // Removed: putImageData ignores canvas transforms, causing bars
    // to render at the top of the canvas instead of as a reflection.
    // The rainbow bars look clean without a reflection effect.
}

/* -- Station Management ----------------------------------- */
function loadStations() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        stations = JSON.parse(saved);
    } else {
        stations = DEFAULT_STATIONS.map(s => ({ ...s }));
        saveStations();
    }
}

function saveStations() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stations));
}

function addStation(name, url, location) {
    const id = 'custom-' + Date.now();
    stations.push({ id, name, streamUrl: url, location: location || '' });
    saveStations();
    renderStationList();
    updateStationsMenu();
}

function removeStation(id) {
    if (playingStationId === id) stopPlayback();
    stations = stations.filter(s => s.id !== id);
    if (selectedStationId === id) selectedStationId = null;
    saveStations();
    renderStationList();
    updateStationsMenu();
    updateRemoveBtn();
}

/* -- Rendering -------------------------------------------- */
function renderStationList() {
    stationListEl.innerHTML = '';
    if (stations.length === 0) {
        stationListEl.innerHTML = '<div class="station-list-empty">No stations.<br>Click "Add Station..." to get started.</div>';
        return;
    }
    stations.forEach(station => {
        const el = document.createElement('div');
        el.className = 'station-item';
        if (station.id === selectedStationId) el.classList.add('selected');
        if (station.id === playingStationId && isPlaying) el.classList.add('playing');
        if (station.id === playingStationId && isBuffering) el.classList.add('buffering');

        el.innerHTML = `
            <div class="station-item-indicator"></div>
            <div class="station-item-info">
                <div class="station-item-name">${escapeHtml(station.name)}</div>
                <div class="station-item-location">${escapeHtml(station.location || '')}</div>
            </div>
        `;

        // Single click = select AND play immediately
        el.addEventListener('click', () => startPlayback(station.id));
        stationListEl.appendChild(el);
    });
}

function updateRemoveBtn() {
    document.getElementById('remove-station-btn').disabled = !selectedStationId;
}

function updateNowPlaying(station, buffering) {
    if (station) {
        currentNameEl.textContent = station.name;
        currentLocEl.textContent = station.location || '\u00A0';
        if (buffering) {
            nowPlayingText.textContent = 'BUFFERING';
            nowPlayingLabel.className = 'now-playing-label buffering';
        } else {
            nowPlayingText.textContent = 'NOW PLAYING';
            nowPlayingLabel.className = 'now-playing-label active';
        }
    } else {
        currentNameEl.textContent = 'Click a station to play';
        currentLocEl.innerHTML = '&nbsp;';
        nowPlayingText.textContent = 'NO SIGNAL';
        nowPlayingLabel.className = 'now-playing-label';
    }
}

function setStatus(msg, loading) {
    statusText.textContent = msg;
    statusBar.classList.toggle('loading', !!loading);
}

/* -- Playback --------------------------------------------- */
function startPlayback(id) {
    const stationId = id || selectedStationId;
    if (!stationId) return;
    const station = stations.find(s => s.id === stationId);
    if (!station) return;

    // If already playing this station, do nothing
    if (playingStationId === stationId && isPlaying) return;

    // Stop previous if any
    if (isPlaying || isBuffering) {
        audio.pause();
    }

    // IMMEDIATELY update UI to show selected + buffering
    selectedStationId = stationId;
    playingStationId = stationId;
    isBuffering = true;
    isPlaying = false;
    idleDrawn = false;
    stopBtn.disabled = false;
    startVisualizer();
    updateNowPlaying(station, true);
    renderStationList();
    updateStationsMenu();
    updateRemoveBtn();
    setStatus('Connecting to ' + station.name + '...', true);

    // Start audio
    audio.src = station.streamUrl;
    audio.play()
        .then(() => {
            isPlaying = true;
            isBuffering = false;
            updateNowPlaying(station, false);
            renderStationList();
            setStatus('Playing: ' + station.name, false);
        })
        .catch(err => {
            isBuffering = false;
            playingStationId = null;
            updateNowPlaying(null);
            renderStationList();
            updateStationsMenu();
            setStatus('Error: Could not play ' + station.name, false);
            console.error('Playback error:', err);
        });
}

function stopPlayback() {
    audio.pause();
    audio.src = '';
    isPlaying = false;
    isBuffering = false;
    playingStationId = null;
    stopBtn.disabled = true;
    updateNowPlaying(null);
    renderStationList();
    updateStationsMenu();
    setStatus('Ready', false);
    statusRight.textContent = '';
}

/* -- Volume ----------------------------------------------- */
audio.volume = 0.75;
volumeSlider.addEventListener('input', () => {
    audio.volume = volumeSlider.value / 100;
});

/* -- Transport Controls ----------------------------------- */
stopBtn.addEventListener('click', () => stopPlayback());

/* -- Radio Garden URL Resolution -------------------------- */
function extractChannelId(url) {
    const match = url.match(RADIO_GARDEN_REGEX);
    return match ? match[1] : null;
}

async function fetchViaProxy(url) {
    for (const proxyFn of CORS_PROXIES) {
        try {
            const proxyUrl = proxyFn(url);
            const res = await fetch(proxyUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
            });
            if (res.ok) return res;
        } catch (e) { continue; }
    }
    throw new Error('Could not reach radio.garden');
}

async function resolveRadioGardenUrl(channelId) {
    const apiUrl = 'https://radio.garden/api/ara/content/channel/' + channelId;
    const res = await fetchViaProxy(apiUrl);
    const json = await res.json();
    const data = json.data;
    if (!data || !data.title) throw new Error('Invalid station data');

    const name = data.title;
    const city = data.place ? data.place.title : '';
    const country = data.country ? data.country.title : '';
    const location = city && country ? city + ', ' + country : city || country || '';
    const streamUrl = 'https://radio.garden/api/ara/content/listen/' + channelId + '/channel.mp3';

    return { name, location, streamUrl };
}

/* -- Add Station Dialog ----------------------------------- */
let resolveDebounce = null;

function showAddDialog() {
    document.getElementById('input-url').value = '';
    document.getElementById('resolve-preview').style.display = 'none';
    document.getElementById('manual-name-row').style.display = 'none';
    document.getElementById('dialog-save-btn').disabled = true;
    resolvedStation = null;
    document.getElementById('add-dialog-overlay').classList.add('visible');
    document.getElementById('input-url').focus();
}

function hideAddDialog() {
    document.getElementById('add-dialog-overlay').classList.remove('visible');
    resolvedStation = null;
}

document.getElementById('input-url').addEventListener('input', (e) => {
    clearTimeout(resolveDebounce);
    const url = e.target.value.trim();
    resolvedStation = null;
    document.getElementById('dialog-save-btn').disabled = true;

    if (!url) {
        document.getElementById('resolve-preview').style.display = 'none';
        document.getElementById('manual-name-row').style.display = 'none';
        return;
    }

    const channelId = extractChannelId(url);
    if (channelId) {
        // Radio.garden URL -- auto-resolve
        document.getElementById('resolve-preview').style.display = 'block';
        document.getElementById('resolve-loading').style.display = 'flex';
        document.getElementById('resolve-result').style.display = 'none';
        document.getElementById('resolve-error').style.display = 'none';
        document.getElementById('manual-name-row').style.display = 'none';

        resolveDebounce = setTimeout(async () => {
            try {
                const info = await resolveRadioGardenUrl(channelId);
                resolvedStation = info;
                document.getElementById('resolve-loading').style.display = 'none';
                document.getElementById('resolve-result').style.display = 'block';
                document.getElementById('resolve-name').textContent = info.name;
                document.getElementById('resolve-location').textContent = info.location;
                document.getElementById('dialog-save-btn').disabled = false;
            } catch (err) {
                document.getElementById('resolve-loading').style.display = 'none';
                document.getElementById('resolve-error').style.display = 'block';
                document.getElementById('resolve-error').textContent = 'Could not resolve station. Try pasting a direct stream URL instead.';
            }
        }, 300);
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
        // Direct stream URL
        document.getElementById('resolve-preview').style.display = 'none';
        document.getElementById('manual-name-row').style.display = 'block';
        resolvedStation = { name: '', location: '', streamUrl: url };
        document.getElementById('dialog-save-btn').disabled = false;
    }
});

document.getElementById('add-station-btn').addEventListener('click', showAddDialog);
document.getElementById('remove-station-btn').addEventListener('click', () => {
    if (selectedStationId) removeStation(selectedStationId);
});

document.getElementById('dialog-cancel-btn').addEventListener('click', hideAddDialog);
document.getElementById('dialog-save-btn').addEventListener('click', () => {
    if (!resolvedStation) return;
    const name = resolvedStation.name ||
                 document.getElementById('input-name').value.trim() ||
                 'Custom Station';
    addStation(name, resolvedStation.streamUrl, resolvedStation.location);
    hideAddDialog();
    setStatus('Station added: ' + name, false);
});

/* -- About / Help / Welcome Dialogs ----------------------- */
function showAbout() {
    document.getElementById('about-dialog-overlay').classList.add('visible');
}
document.getElementById('about-ok-btn').addEventListener('click', () => {
    document.getElementById('about-dialog-overlay').classList.remove('visible');
});

function showHelp() {
    document.getElementById('help-dialog-overlay').classList.add('visible');
}
document.getElementById('help-ok-btn').addEventListener('click', () => {
    document.getElementById('help-dialog-overlay').classList.remove('visible');
});

document.querySelectorAll('.help-topic').forEach(topic => {
    topic.addEventListener('click', () => {
        document.querySelectorAll('.help-topic').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.help-page').forEach(p => p.style.display = 'none');
        topic.classList.add('active');
        document.getElementById('help-' + topic.dataset.topic).style.display = 'block';
    });
});

const overlayIds = ['add-dialog-overlay', 'about-dialog-overlay', 'help-dialog-overlay', 'welcome-dialog-overlay'];
overlayIds.forEach(id => {
    document.getElementById(id).addEventListener('click', (e) => {
        if (e.target.id === id) e.target.classList.remove('visible');
    });
});

function showWelcome() {
    if (localStorage.getItem(ONBOARDED_KEY)) return;
    document.getElementById('welcome-dialog-overlay').classList.add('visible');
}

document.getElementById('welcome-ok-btn').addEventListener('click', () => {
    if (document.getElementById('welcome-dont-show').checked) {
        localStorage.setItem(ONBOARDED_KEY, '1');
    }
    document.getElementById('welcome-dialog-overlay').classList.remove('visible');
});

/* -- Balloon Help ----------------------------------------- */
function toggleBalloonHelp() {
    balloonHelpEnabled = !balloonHelpEnabled;
    document.getElementById('balloon-toggle').textContent =
        balloonHelpEnabled ? 'Hide Balloon Help' : 'Show Balloon Help';
    if (!balloonHelpEnabled) document.getElementById('balloon').style.display = 'none';
}

document.addEventListener('mouseover', (e) => {
    if (!balloonHelpEnabled) return;
    const target = e.target.closest('[data-balloon]');
    const balloon = document.getElementById('balloon');
    if (target) {
        document.getElementById('balloon-content').textContent = target.dataset.balloon;
        const rect = target.getBoundingClientRect();
        balloon.style.left = rect.left + 'px';
        balloon.style.top = (rect.bottom + 4) + 'px';
        balloon.style.display = 'block';
    } else {
        balloon.style.display = 'none';
    }
});

/* -- Menu Bar --------------------------------------------- */
let openMenuId = null;

function openMenu(menuId) {
    closeAllMenus();
    const item = document.querySelector('.menu-item[data-menu="' + menuId + '"]');
    if (item) {
        item.classList.add('open');
        openMenuId = menuId;
    }
}

function closeAllMenus() {
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('open'));
    openMenuId = null;
}

// ---- Menu System (simplified, no stopPropagation conflicts) ----

// 1) Toggle menus on click of the menu-item label
document.querySelectorAll('.menu-item[data-menu]').forEach(item => {
    item.addEventListener('click', (e) => {
        // Ignore clicks that landed on a dropdown item inside this menu
        if (e.target.closest('.menu-dropdown-item') || e.target.closest('.menu-separator')) return;
        const menuId = item.dataset.menu;
        if (openMenuId === menuId) closeAllMenus();
        else openMenu(menuId);
    });
    // Hover to switch between open menus
    item.addEventListener('mouseenter', () => {
        if (openMenuId && item.dataset.menu !== openMenuId) openMenu(item.dataset.menu);
    });
});

// 2) Handle dropdown-item actions at the dropdown level (event delegation)
document.querySelectorAll('.menu-dropdown').forEach(dropdown => {
    dropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.menu-dropdown-item');
        if (!item || item.classList.contains('disabled')) return;
        e.stopPropagation(); // Prevent the menu-item toggle from firing

        const action = item.dataset.action;
        const stationId = item.dataset.stationId;

        if (action === 'about') showAbout();
        else if (action === 'help') showHelp();
        else if (action === 'add-station') showAddDialog();
        else if (action === 'close-window') closeWindow();
        else if (action === 'quit') quitApp();
        else if (action === 'show-window') showWindow();
        else if (action === 'toggle-balloons') toggleBalloonHelp();
        else if (action === 'viz-rainbow') setVizMode('rainbow');
        else if (action === 'viz-radial') setVizMode('radial');
        else if (action === 'viz-aurora') setVizMode('aurora');
        else if (action === 'viz-scope') setVizMode('scope');
        else if (stationId) startPlayback(stationId);

        closeAllMenus();
    });
});

// 3) Close menus when clicking anywhere outside the menu bar
document.addEventListener('click', (e) => {
    if (openMenuId && !e.target.closest('.menu-bar')) closeAllMenus();
});

function updateStationsMenu() {
    const dropdown = document.getElementById('dropdown-stations');
    dropdown.innerHTML = '';
    stations.forEach(s => {
        const item = document.createElement('div');
        item.className = 'menu-dropdown-item station-menu-item';
        if (s.id === playingStationId) item.classList.add('active');
        item.dataset.stationId = s.id;
        item.textContent = s.name;
        dropdown.appendChild(item);
    });
    if (stations.length > 0) {
        dropdown.appendChild(Object.assign(document.createElement('div'), { className: 'menu-separator' }));
    }
    const addItem = document.createElement('div');
    addItem.className = 'menu-dropdown-item';
    addItem.dataset.action = 'add-station';
    addItem.innerHTML = 'Add Station...<span class="shortcut">&#8984;N</span>';
    dropdown.appendChild(addItem);
}

/* -- Visualizer Mode -------------------------------------- */
function setVizMode(mode) {
    vizMode = mode;
    localStorage.setItem(VIZ_KEY, mode);
    vizLabel.textContent = VIZ_LABELS[mode] || mode.toUpperCase();
    ['rainbow', 'radial', 'aurora', 'scope'].forEach(m => {
        const el = document.getElementById('check-' + m);
        if (el) el.textContent = m === mode ? '\u2713' : '';
    });
    heatGradient = null;
}

/* -- Window Management ------------------------------------ */
function closeWindow() {
    document.getElementById('main-window').style.display = 'none';
    document.getElementById('desktop-icon').style.display = 'flex';
    document.getElementById('check-window').textContent = '';
}

function showWindow() {
    document.getElementById('main-window').style.display = 'flex';
    document.getElementById('desktop-icon').style.display = 'none';
    document.getElementById('check-window').textContent = '\u2713';
    setTimeout(resizeCanvas, 50);
}

function quitApp() {
    stopPlayback();
    closeWindow();
    setStatus('Quit. Reload to restart.', false);
}

const desktopIcon = document.getElementById('desktop-icon');
desktopIcon.addEventListener('dblclick', showWindow);
desktopIcon.addEventListener('click', () => desktopIcon.classList.toggle('selected'));

/* -- Menu Clock ------------------------------------------- */
function updateClock() {
    const now = new Date();
    const h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    document.getElementById('menu-clock').textContent = (h % 12 || 12) + ':' + m + ' ' + ampm;
}
setInterval(updateClock, 10000);
updateClock();

/* -- Window Dragging -------------------------------------- */
(function setupDrag() {
    const titlebar = document.getElementById('main-titlebar');
    const win = document.getElementById('main-window');
    let dragging = false, offsetX = 0, offsetY = 0;

    titlebar.addEventListener('mousedown', (e) => {
        if (e.target.closest('.titlebar-btn')) return;
        dragging = true;
        offsetX = e.clientX - win.offsetLeft;
        offsetY = e.clientY - win.offsetTop;
        titlebar.classList.add('dragging');
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        let x = e.clientX - offsetX;
        let y = e.clientY - offsetY;
        y = Math.max(24, Math.min(y, window.innerHeight - 30));
        x = Math.max(-win.offsetWidth + 60, Math.min(x, window.innerWidth - 60));
        win.style.left = x + 'px';
        win.style.top = y + 'px';
        win.style.transform = 'none';
    });
    document.addEventListener('mouseup', () => {
        dragging = false;
        titlebar.classList.remove('dragging');
    });
})();

/* -- Window Controls -------------------------------------- */
document.getElementById('close-btn').addEventListener('click', closeWindow);
document.getElementById('shade-btn').addEventListener('click', () => {
    document.getElementById('main-window').classList.toggle('shaded');
});
document.getElementById('zoom-btn').addEventListener('click', () => {
    const win = document.getElementById('main-window');
    const desktop = document.getElementById('desktop');
    if (win.classList.contains('zoomed')) {
        win.classList.remove('zoomed');
        win.style.width = '820px'; win.style.height = '560px';
        win.style.left = ''; win.style.top = ''; win.style.transform = '';
    } else {
        win.classList.add('zoomed');
        win.style.width = (desktop.clientWidth - 8) + 'px';
        win.style.height = (desktop.clientHeight - 8) + 'px';
        win.style.left = '4px'; win.style.top = '28px'; win.style.transform = 'none';
    }
    setTimeout(resizeCanvas, 50);
});

/* -- Keyboard Shortcuts ----------------------------------- */
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') {
        if (e.key === 'Escape') overlayIds.forEach(id => document.getElementById(id).classList.remove('visible'));
        if (e.key === 'Enter' && document.getElementById('add-dialog-overlay').classList.contains('visible')) {
            const btn = document.getElementById('dialog-save-btn');
            if (!btn.disabled) btn.click();
        }
        return;
    }
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && e.key === 'n') { e.preventDefault(); showAddDialog(); }
    else if (cmd && e.key === 'w') { e.preventDefault(); closeWindow(); }
    else if (cmd && e.key === 'q') { e.preventDefault(); quitApp(); }
    else if (cmd && e.key === '1') { e.preventDefault(); showWindow(); }
    else if (e.key === ' ') {
        e.preventDefault();
        if (isPlaying || isBuffering) stopPlayback();
        else if (selectedStationId) startPlayback(selectedStationId);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        navigateStations(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && selectedStationId) {
        e.preventDefault();
        startPlayback(selectedStationId);
    } else if (e.key === 'Escape') {
        overlayIds.forEach(id => document.getElementById(id).classList.remove('visible'));
    }
});

function navigateStations(direction) {
    if (stations.length === 0) return;
    const idx = stations.findIndex(s => s.id === selectedStationId);
    let newIdx = idx === -1
        ? (direction > 0 ? 0 : stations.length - 1)
        : (idx + direction + stations.length) % stations.length;
    selectedStationId = stations[newIdx].id;
    renderStationList();
    updateRemoveBtn();
    if (!isPlaying && !isBuffering) {
        currentNameEl.textContent = stations[newIdx].name;
        currentLocEl.textContent = stations[newIdx].location || '\u00A0';
    }
}

/* -- Audio Events ----------------------------------------- */
audio.addEventListener('waiting', () => {
    if (playingStationId) {
        isBuffering = true;
        isPlaying = false;
        const station = stations.find(s => s.id === playingStationId);
        if (station) updateNowPlaying(station, true);
        renderStationList();
        setStatus('Buffering...', true);
    }
});
audio.addEventListener('playing', () => {
    isBuffering = false;
    isPlaying = true;
    const station = stations.find(s => s.id === playingStationId);
    if (station) {
        updateNowPlaying(station, false);
        renderStationList();
        setStatus('Playing: ' + station.name, false);
    }
});
audio.addEventListener('error', () => {
    if (playingStationId) {
        setStatus('Connection lost. Click to retry.', false);
        isBuffering = false;
        isPlaying = false;
        playingStationId = null;
        updateNowPlaying(null);
        renderStationList();
        updateStationsMenu();
    }
});
audio.addEventListener('stalled', () => {
    if (playingStationId) setStatus('Stream stalled...', true);
});

/* -- Utility ---------------------------------------------- */
function escapeHtml(str) {
    _escDiv.textContent = str;
    return _escDiv.innerHTML;
}

function centerWindow() {
    const win = document.getElementById('main-window');
    const desktop = document.getElementById('desktop');
    win.style.left = ((desktop.clientWidth - win.offsetWidth) / 2) + 'px';
    win.style.top = ((desktop.clientHeight - win.offsetHeight) / 2) + 'px';
    win.style.transform = 'none';
}

/* -- Init ------------------------------------------------- */
function init() {
    loadStations();
    renderStationList();
    updateStationsMenu();
    resizeCanvas();
    centerWindow();
    setVizMode(vizMode);
    startVisualizer();
    showWelcome();
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resizeCanvas, 120);
    });
}

document.addEventListener('DOMContentLoaded', init);
