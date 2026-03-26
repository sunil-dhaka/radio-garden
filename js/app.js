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
let heatGradient = null;

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
    heatGradient = null;
}

/* -- Visualizer Drawing ----------------------------------- */
function drawVisualizer() {
    animFrameId = requestAnimationFrame(drawVisualizer);
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;

    ctx.fillStyle = vizMode === 'scope'
        ? 'rgba(8, 8, 15, 0.3)'
        : 'rgba(8, 8, 15, 0.45)';
    ctx.fillRect(0, 0, w, h);

    // Grid
    const gridColor = 'rgba(255, 255, 255, 0.02)';
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let gy = 0; gy < h; gy += 24) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    }
    for (let gx = 0; gx < w; gx += 24) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
    }

    updateBarData(h);

    switch (vizMode) {
        case 'rainbow': drawRainbow(w, h); break;
        case 'radial':  drawRadial(w, h);  break;
        case 'aurora':  drawAurora(w, h);  break;
        case 'scope':   drawScope(w, h);   break;
    }
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
    const { barW, gap } = barLayout(w);
    for (let i = 0; i < BAR_COUNT; i++) {
        const barH = displayHeights[i];
        if (barH < 1) continue;
        const x = i * (barW + gap) + gap / 2;
        const y = h - barH;
        const hue = (i / BAR_COUNT) * 280;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.25;
        ctx.shadowColor = `hsl(${hue}, 100%, 55%)`;
        ctx.shadowBlur = 14;
        ctx.fillStyle = `hsl(${hue}, 90%, 50%)`;
        ctx.fillRect(x, y, barW, barH);
        ctx.restore();

        const grad = ctx.createLinearGradient(x, y, x, h);
        grad.addColorStop(0, `hsl(${hue}, 100%, 65%)`);
        grad.addColorStop(0.4, `hsl(${hue}, 95%, 50%)`);
        grad.addColorStop(1, `hsl(${hue}, 80%, 25%)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, barH);

        if (barH > 4) {
            ctx.fillStyle = `hsl(${hue}, 100%, 80%)`;
            ctx.fillRect(x, y, barW, 2);
        }

        if (peakHeights[i] > 2) {
            ctx.fillStyle = `hsl(${hue}, 100%, 90%)`;
            ctx.shadowColor = `hsl(${hue}, 100%, 70%)`;
            ctx.shadowBlur = 4;
            ctx.fillRect(x, h - peakHeights[i], barW, 2);
            ctx.shadowBlur = 0;
        }
    }
    drawReflection(w, h);
}

/* -- Radial Burst Mode ------------------------------------ */
function drawRadial(w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(cx, cy) * 0.88;
    const innerR = maxR * 0.12;
    const barCount = BAR_COUNT * 2; // More bars for full circle

    // Rotating inner ring
    const t = Date.now();
    const ringPulse = isPlaying || isBuffering ? 0.6 + Math.sin(t / 400) * 0.15 : 0.3;
    ctx.save();
    ctx.globalAlpha = ringPulse * 0.15;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < barCount; i++) {
        const dataIdx = i % BAR_COUNT;
        const barH = displayHeights[dataIdx];
        if (barH < 1) continue;

        const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
        const barLen = (barH / (h * 0.82)) * (maxR - innerR);
        const hue = (i / barCount) * 360;

        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const x1 = cx + cos * innerR;
        const y1 = cy + sin * innerR;
        const x2 = cx + cos * (innerR + barLen);
        const y2 = cy + sin * (innerR + barLen);

        // Outer glow
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = `hsl(${hue}, 100%, 50%)`;
        ctx.shadowColor = `hsl(${hue}, 100%, 50%)`;
        ctx.shadowBlur = 10;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();

        // Core bar
        ctx.strokeStyle = `hsl(${hue}, 100%, 65%)`;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

        // Bright tip
        ctx.fillStyle = `hsl(${hue}, 100%, 85%)`;
        ctx.beginPath();
        ctx.arc(x2, y2, 1.5, 0, Math.PI * 2);
        ctx.fill();

        // Peak dot
        if (peakHeights[dataIdx] > 2) {
            const peakLen = (peakHeights[dataIdx] / (h * 0.82)) * (maxR - innerR);
            const px = cx + cos * (innerR + peakLen);
            const py = cy + sin * (innerR + peakLen);
            ctx.fillStyle = `hsl(${hue}, 100%, 95%)`;
            ctx.shadowColor = `hsl(${hue}, 100%, 70%)`;
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.arc(px, py, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }
}

/* -- Aurora Waves Mode ------------------------------------ */
function drawAurora(w, h) {
    const waves = [
        { color: '#FF00AA', glow: '#FF0088', speed: 280, freq: 0.012, amp: 0.14 },
        { color: '#00FFCC', glow: '#00CCAA', speed: 350, freq: 0.009, amp: 0.16 },
        { color: '#FFAA00', glow: '#CC8800', speed: 420, freq: 0.015, amp: 0.12 },
        { color: '#44FF00', glow: '#33CC00', speed: 300, freq: 0.011, amp: 0.15 },
        { color: '#8855FF', glow: '#6633DD', speed: 500, freq: 0.008, amp: 0.18 },
        { color: '#FF4466', glow: '#CC3355', speed: 260, freq: 0.013, amp: 0.13 },
    ];

    const t = Date.now();
    const active = isPlaying || isBuffering;
    const intensity = active ? (isBuffering ? 0.4 : 1.0) : 0.05;

    for (let wi = 0; wi < waves.length; wi++) {
        const wave = waves[wi];
        const baseY = (h / (waves.length + 1)) * (wi + 1);

        // Wide glow pass
        ctx.save();
        ctx.lineWidth = 8;
        ctx.strokeStyle = wave.glow;
        ctx.shadowColor = wave.glow;
        ctx.shadowBlur = 25;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.2 * intensity;
        drawAuroraPath(w, h, baseY, wi, wave, t, intensity);
        ctx.restore();

        // Fill below the wave (aurora glow)
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.04 * intensity;
        ctx.fillStyle = wave.color;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 3) {
            const amp = auroraY(x, baseY, wi, wave, t, intensity);
            if (x === 0) ctx.moveTo(x, amp);
            else ctx.lineTo(x, amp);
        }
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Core line
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = wave.color;
        ctx.shadowColor = wave.color;
        ctx.shadowBlur = 8;
        ctx.globalAlpha = 0.7 * intensity + 0.3;
        drawAuroraPath(w, h, baseY, wi, wave, t, intensity);
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
    }
}

function auroraY(x, baseY, idx, wave, t, intensity) {
    return baseY +
        Math.sin(t / wave.speed + x * wave.freq) * (wave.amp * baseY * intensity) +
        Math.sin(t / (wave.speed * 1.7) + x * wave.freq * 2.3 + idx) * (wave.amp * baseY * 0.5 * intensity) +
        Math.cos(t / (wave.speed * 0.6) + x * wave.freq * 0.4) * (wave.amp * baseY * 0.3 * intensity);
}

function drawAuroraPath(w, h, baseY, idx, wave, t, intensity) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 3) {
        const y = auroraY(x, baseY, idx, wave, t, intensity);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

function drawScope(w, h) {
    const bufLen = 128;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();

    ctx.save();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0, 180, 255, 0.15)';
    ctx.shadowColor = '#0088FF'; ctx.shadowBlur = 20;
    ctx.globalCompositeOperation = 'lighter';
    drawScopePath(w, h, bufLen); ctx.restore();

    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(68, 136, 255, 0.5)';
    ctx.shadowColor = '#4488FF'; ctx.shadowBlur = 8;
    drawScopePath(w, h, bufLen); ctx.restore();

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4488FF';
    ctx.shadowColor = '#4488FF'; ctx.shadowBlur = 4;
    drawScopePath(w, h, bufLen);
    ctx.shadowBlur = 0;
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
    stopBtn.disabled = false;
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
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
    drawVisualizer();
    showWelcome();
    window.addEventListener('resize', resizeCanvas);
}

document.addEventListener('DOMContentLoaded', init);
