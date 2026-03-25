/* ============================================================
   Radio Garden - Application Logic (v2)
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
];

const STORAGE_KEY = 'radio-garden-stations';
const ONBOARDED_KEY = 'radio-garden-onboarded';
const VIZ_KEY = 'radio-garden-viz';

/* -- State ------------------------------------------------ */
let stations = [];
let selectedStationId = null;
let playingStationId = null;
let vizMode = localStorage.getItem(VIZ_KEY) || 'rainbow';
let isPlaying = false;
let balloonHelpEnabled = false;

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
    vu: 'VU METER',
    crt: 'CRT PHOSPHOR',
    scope: 'OSCILLOSCOPE',
};

// Winamp-style VU gradient colors (top=red to bottom=green)
const VU_COLORS = [
    '#EF3110', '#CE2910', '#D65A00', '#D66600',
    '#D67300', '#C67B08', '#DEA518', '#D6B521',
    '#BDDE29', '#94DE21', '#29CE10', '#32BE10',
    '#39B510', '#319C08', '#299400', '#188408',
];

function initAudioContext() {
    // No-op: we use simulated visualizer to avoid CORS issues with
    // cross-origin radio streams. See commit history for details.
}

function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    heatGradient = null; // Force rebuild on next draw
}

/* -- Visualizer Drawing ----------------------------------- */
function drawVisualizer() {
    animFrameId = requestAnimationFrame(drawVisualizer);
    const w = canvas.width;
    const h = canvas.height;

    if (w === 0 || h === 0) return;

    // CRT persistence: fade previous frame instead of clearing
    ctx.fillStyle = vizMode === 'scope'
        ? 'rgba(8, 8, 15, 0.3)'
        : 'rgba(8, 8, 15, 0.45)';
    ctx.fillRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = vizMode === 'crt'
        ? 'rgba(0, 204, 68, 0.05)'
        : 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;
    for (let gy = 0; gy < h; gy += 24) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
    }
    for (let gx = 0; gx < w; gx += 24) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
    }

    // Update bar data
    updateBarData(h);

    switch (vizMode) {
        case 'rainbow': drawRainbow(w, h); break;
        case 'vu':      drawVU(w, h);      break;
        case 'crt':     drawCRT(w, h);     break;
        case 'scope':   drawScope(w, h);   break;
    }
}

function updateBarData(h) {
    const maxH = h * 0.82;
    for (let i = 0; i < BAR_COUNT; i++) {
        let target;
        if (isPlaying) {
            const t = Date.now();
            target = (
                Math.sin(t / 280 + i * 0.65) * 0.25 +
                Math.sin(t / 620 + i * 1.4) * 0.20 +
                Math.sin(t / 140 + i * 2.3) * 0.12 +
                Math.sin(t / 900 + i * 0.3) * 0.10 +
                Math.cos(t / 400 + i * 3.1) * 0.08 +
                0.38
            ) * maxH;
            // Add micro-jitter for liveliness
            target += (Math.random() - 0.5) * 3;
            target = Math.max(2, target);
        } else {
            target = 0;
        }

        // Smooth approach
        fakeBarHeights[i] += (target - fakeBarHeights[i]) * 0.18;

        // Display with gravity falloff
        if (fakeBarHeights[i] >= displayHeights[i]) {
            displayHeights[i] = fakeBarHeights[i];
        } else {
            displayHeights[i] *= 0.93;
        }

        if (displayHeights[i] < 1) displayHeights[i] = 0;

        // Peak hold
        if (displayHeights[i] >= peakHeights[i]) {
            peakHeights[i] = displayHeights[i];
            peakVelocity[i] = 0.5;
            peakHold[i] = 25; // frames to hold
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

/* -- Rainbow Spectrum Mode -------------------------------- */
function drawRainbow(w, h) {
    const { barW, gap } = barLayout(w);

    for (let i = 0; i < BAR_COUNT; i++) {
        const barH = displayHeights[i];
        if (barH < 1) continue;

        const x = i * (barW + gap) + gap / 2;
        const y = h - barH;
        const hue = (i / BAR_COUNT) * 280;

        // Glow layer
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.25;
        ctx.shadowColor = `hsl(${hue}, 100%, 55%)`;
        ctx.shadowBlur = 14;
        ctx.fillStyle = `hsl(${hue}, 90%, 50%)`;
        ctx.fillRect(x, y, barW, barH);
        ctx.restore();

        // Solid bar
        const grad = ctx.createLinearGradient(x, y, x, h);
        grad.addColorStop(0, `hsl(${hue}, 100%, 65%)`);
        grad.addColorStop(0.4, `hsl(${hue}, 95%, 50%)`);
        grad.addColorStop(1, `hsl(${hue}, 80%, 25%)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, barH);

        // Bright cap
        if (barH > 4) {
            ctx.fillStyle = `hsl(${hue}, 100%, 80%)`;
            ctx.fillRect(x, y, barW, 2);
        }

        // Peak indicator
        if (peakHeights[i] > 2) {
            const peakY = h - peakHeights[i];
            ctx.fillStyle = `hsl(${hue}, 100%, 90%)`;
            ctx.shadowColor = `hsl(${hue}, 100%, 70%)`;
            ctx.shadowBlur = 4;
            ctx.fillRect(x, peakY, barW, 2);
            ctx.shadowBlur = 0;
        }
    }

    drawReflection(w, h);
}

/* -- VU Meter Mode (Winamp) ------------------------------- */
function drawVU(w, h) {
    const { barW, gap } = barLayout(w);

    // Build heat gradient canvas once
    if (!heatGradient || heatGradient.height !== Math.ceil(h)) {
        const off = document.createElement('canvas');
        off.width = 1;
        off.height = Math.ceil(h);
        const octx = off.getContext('2d');
        const g = octx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0.0,  '#EF3110');
        g.addColorStop(0.15, '#D65A00');
        g.addColorStop(0.30, '#DEA518');
        g.addColorStop(0.45, '#D6B521');
        g.addColorStop(0.60, '#BDDE29');
        g.addColorStop(0.75, '#29CE10');
        g.addColorStop(0.90, '#319C08');
        g.addColorStop(1.0,  '#188408');
        octx.fillStyle = g;
        octx.fillRect(0, 0, 1, h);
        heatGradient = off;
    }

    for (let i = 0; i < BAR_COUNT; i++) {
        const barH = displayHeights[i];
        if (barH < 1) continue;

        const x = i * (barW + gap) + gap / 2;
        const srcY = heatGradient.height - barH;

        // Draw clipped gradient
        ctx.drawImage(heatGradient, 0, srcY, 1, barH, x, h - barH, barW, barH);

        // Glow
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.15;
        ctx.drawImage(heatGradient, 0, srcY, 1, barH, x, h - barH, barW, barH);
        ctx.restore();

        // Peak indicator
        if (peakHeights[i] > 2) {
            const peakY = h - peakHeights[i];
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(x, peakY, barW, 2);
        }
    }

    drawReflection(w, h);
}

/* -- CRT Phosphor Mode ------------------------------------ */
function drawCRT(w, h) {
    const { barW, gap } = barLayout(w);

    for (let i = 0; i < BAR_COUNT; i++) {
        const barH = displayHeights[i];
        if (barH < 1) continue;

        const x = i * (barW + gap) + gap / 2;
        const y = h - barH;

        // Wide outer glow
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.2;
        ctx.shadowColor = '#00CC44';
        ctx.shadowBlur = 18;
        ctx.fillStyle = '#00CC44';
        ctx.fillRect(x, y, barW, barH);
        ctx.restore();

        // Mid bloom
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.4;
        ctx.shadowColor = '#00FF55';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#00FF55';
        ctx.fillRect(x, y, barW, barH);
        ctx.restore();

        // Sharp core
        const grad = ctx.createLinearGradient(x, y, x, h);
        grad.addColorStop(0, '#00FF55');
        grad.addColorStop(0.5, '#00CC44');
        grad.addColorStop(1, '#006622');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, barH);

        // Bright cap
        if (barH > 4) {
            ctx.fillStyle = '#88FFAA';
            ctx.fillRect(x, y, barW, 2);
        }

        // Peak
        if (peakHeights[i] > 2) {
            const peakY = h - peakHeights[i];
            ctx.fillStyle = '#AAFFCC';
            ctx.shadowColor = '#00FF55';
            ctx.shadowBlur = 6;
            ctx.fillRect(x, peakY, barW, 2);
            ctx.shadowBlur = 0;
        }
    }

    // Moving scanline
    const scanY = (Date.now() / 15) % h;
    ctx.fillStyle = 'rgba(0, 255, 68, 0.04)';
    ctx.fillRect(0, scanY, w, 3);

    drawReflection(w, h);
}

/* -- Oscilloscope Mode ------------------------------------ */
function drawScope(w, h) {
    const bufLen = 128;
    ctx.lineWidth = 2;

    // Center line (dim)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Glow pass
    ctx.save();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0, 180, 255, 0.15)';
    ctx.shadowColor = '#0088FF';
    ctx.shadowBlur = 20;
    ctx.globalCompositeOperation = 'lighter';
    drawScopePath(w, h, bufLen);
    ctx.restore();

    // Mid pass
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(68, 136, 255, 0.5)';
    ctx.shadowColor = '#4488FF';
    ctx.shadowBlur = 8;
    drawScopePath(w, h, bufLen);
    ctx.restore();

    // Core line
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4488FF';
    ctx.shadowColor = '#4488FF';
    ctx.shadowBlur = 4;
    drawScopePath(w, h, bufLen);
    ctx.shadowBlur = 0;
}

function drawScopePath(w, h, bufLen) {
    ctx.beginPath();
    const sliceW = w / bufLen;
    let x = 0;
    const t = Date.now();
    for (let i = 0; i < bufLen; i++) {
        let v;
        if (isPlaying) {
            v = 1 +
                Math.sin(t / 180 + i * 0.18) * 0.30 +
                Math.sin(t / 450 + i * 0.09) * 0.18 +
                Math.sin(t / 90 + i * 0.35) * 0.08 +
                Math.cos(t / 300 + i * 0.25) * 0.06;
        } else {
            v = 1;
        }
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceW;
    }
    ctx.stroke();
}

/* -- Reflection effect ------------------------------------ */
function drawReflection(w, h) {
    const reflH = Math.floor(h * 0.12);
    if (reflH < 4) return;

    // Copy bottom strip and flip
    try {
        const imgData = ctx.getImageData(0, h - reflH * 2, w, reflH);
        ctx.save();
        ctx.translate(0, h + reflH);
        ctx.scale(1, -1);
        ctx.globalAlpha = 0.12;
        ctx.putImageData(imgData, 0, 0);
        ctx.restore();
    } catch (e) {
        // Canvas tainted or too small - skip reflection
    }

    // Fade it out
    const fade = ctx.createLinearGradient(0, h - reflH, 0, h);
    fade.addColorStop(0, 'rgba(8, 8, 15, 0.3)');
    fade.addColorStop(1, 'rgba(8, 8, 15, 1)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, h - reflH, w, reflH);
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
        stationListEl.innerHTML = '<div class="station-list-empty">No stations yet.<br>Click "Add Station..." to get started.</div>';
        return;
    }
    stations.forEach(station => {
        const el = document.createElement('div');
        el.className = 'station-item';
        if (station.id === selectedStationId) el.classList.add('selected');
        if (station.id === playingStationId) el.classList.add('playing');

        el.innerHTML = `
            <div class="station-item-indicator"></div>
            <div class="station-item-info">
                <div class="station-item-name">${escapeHtml(station.name)}</div>
                <div class="station-item-location">${escapeHtml(station.location || '')}</div>
            </div>
        `;

        // Single click = select AND play immediately
        el.addEventListener('click', () => {
            selectedStationId = station.id;
            startPlayback(station.id);
        });

        stationListEl.appendChild(el);
    });
}

function updateRemoveBtn() {
    document.getElementById('remove-station-btn').disabled = !selectedStationId;
}

function updateNowPlaying(station) {
    if (station) {
        currentNameEl.textContent = station.name;
        currentLocEl.textContent = station.location || '\u00A0';
        nowPlayingText.textContent = 'NOW PLAYING';
        nowPlayingLabel.classList.add('active');
    } else {
        currentNameEl.textContent = selectedStationId
            ? (stations.find(s => s.id === selectedStationId)?.name || 'Click a station to play')
            : 'Click a station to play';
        currentLocEl.innerHTML = selectedStationId
            ? (stations.find(s => s.id === selectedStationId)?.location || '&nbsp;')
            : '&nbsp;';
        nowPlayingText.textContent = 'NO SIGNAL';
        nowPlayingLabel.classList.remove('active');
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

    // If playing a different station, stop first (smooth transition)
    if (isPlaying) {
        audio.pause();
    }

    setStatus('Connecting to ' + station.name + '...', true);
    audio.src = station.streamUrl;

    audio.play()
        .then(() => {
            isPlaying = true;
            playingStationId = stationId;
            selectedStationId = stationId;
            stopBtn.disabled = false;
            updateNowPlaying(station);
            renderStationList();
            updateStationsMenu();
            updateRemoveBtn();
            setStatus('Playing: ' + station.name, false);
        })
        .catch(err => {
            setStatus('Error: Could not play ' + station.name, false);
            console.error('Playback error:', err);
        });
}

function stopPlayback() {
    audio.pause();
    audio.src = '';
    isPlaying = false;
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

/* -- Add/Remove Station ----------------------------------- */
document.getElementById('add-station-btn').addEventListener('click', showAddDialog);
document.getElementById('remove-station-btn').addEventListener('click', () => {
    if (selectedStationId) removeStation(selectedStationId);
});

/* -- Dialogs ---------------------------------------------- */
function showAddDialog() {
    document.getElementById('input-name').value = '';
    document.getElementById('input-url').value = '';
    document.getElementById('input-location').value = '';
    document.getElementById('add-dialog-overlay').classList.add('visible');
    document.getElementById('input-name').focus();
}

function hideAddDialog() {
    document.getElementById('add-dialog-overlay').classList.remove('visible');
}

document.getElementById('dialog-cancel-btn').addEventListener('click', hideAddDialog);
document.getElementById('dialog-save-btn').addEventListener('click', () => {
    const name = document.getElementById('input-name').value.trim();
    const url = document.getElementById('input-url').value.trim();
    const loc = document.getElementById('input-location').value.trim();
    if (!name || !url) {
        setStatus('Please enter a name and stream URL', false);
        return;
    }
    addStation(name, url, loc);
    hideAddDialog();
    setStatus('Station added: ' + name, false);
});

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

// Help topic navigation
document.querySelectorAll('.help-topic').forEach(topic => {
    topic.addEventListener('click', () => {
        document.querySelectorAll('.help-topic').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.help-page').forEach(p => p.style.display = 'none');
        topic.classList.add('active');
        const pageId = 'help-' + topic.dataset.topic;
        document.getElementById(pageId).style.display = 'block';
    });
});

// Close dialog overlays on click outside or Escape
const overlayIds = ['add-dialog-overlay', 'about-dialog-overlay', 'help-dialog-overlay', 'welcome-dialog-overlay'];
overlayIds.forEach(id => {
    document.getElementById(id).addEventListener('click', (e) => {
        if (e.target.id === id) e.target.classList.remove('visible');
    });
});

/* -- Welcome Dialog --------------------------------------- */
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
    const toggle = document.getElementById('balloon-toggle');
    toggle.textContent = balloonHelpEnabled ? 'Hide Balloon Help' : 'Show Balloon Help';
    if (!balloonHelpEnabled) {
        document.getElementById('balloon').style.display = 'none';
    }
}

document.addEventListener('mouseover', (e) => {
    if (!balloonHelpEnabled) return;
    const target = e.target.closest('[data-balloon]');
    const balloon = document.getElementById('balloon');
    if (target) {
        const text = target.dataset.balloon;
        document.getElementById('balloon-content').textContent = text;
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
    const item = document.querySelector(`.menu-item[data-menu="${menuId}"]`);
    if (item) {
        item.classList.add('open');
        openMenuId = menuId;
    }
}

function closeAllMenus() {
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('open'));
    openMenuId = null;
}

document.querySelectorAll('.menu-item[data-menu]').forEach(item => {
    item.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const menuId = item.dataset.menu;
        if (openMenuId === menuId) closeAllMenus();
        else openMenu(menuId);
    });
    item.addEventListener('mouseenter', () => {
        if (openMenuId && item.dataset.menu !== openMenuId) {
            openMenu(item.dataset.menu);
        }
    });
});

document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.menu-bar')) closeAllMenus();
});

// Menu actions
document.addEventListener('click', (e) => {
    const menuItem = e.target.closest('.menu-dropdown-item');
    if (!menuItem || menuItem.classList.contains('disabled')) return;

    const action = menuItem.dataset.action;
    const stationId = menuItem.dataset.stationId;

    if (action === 'about') showAbout();
    else if (action === 'help') showHelp();
    else if (action === 'add-station') showAddDialog();
    else if (action === 'close-window') closeWindow();
    else if (action === 'quit') quitApp();
    else if (action === 'show-window') showWindow();
    else if (action === 'toggle-balloons') toggleBalloonHelp();
    else if (action && action.startsWith('viz-')) setVizMode(action.replace('viz-', ''));
    else if (stationId) startPlayback(stationId);

    closeAllMenus();
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
    // Update menu checks
    ['rainbow', 'vu', 'crt', 'scope'].forEach(m => {
        const el = document.getElementById('check-' + m);
        if (el) el.textContent = m === mode ? '\u2713' : '';
    });
    heatGradient = null; // Force rebuild
}

/* -- Window Management ------------------------------------ */
function closeWindow() {
    // Don't stop playback -- music keeps playing
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
    setStatus('Quit. Reload page to restart.', false);
}

// Desktop icon: double-click to open, single-click to select
const desktopIcon = document.getElementById('desktop-icon');
desktopIcon.addEventListener('dblclick', showWindow);
desktopIcon.addEventListener('click', () => {
    desktopIcon.classList.toggle('selected');
});

/* -- Menu Clock ------------------------------------------- */
function updateClock() {
    const now = new Date();
    const h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    document.getElementById('menu-clock').textContent = h12 + ':' + m + ' ' + ampm;
}
setInterval(updateClock, 10000);
updateClock();

/* -- Window Dragging -------------------------------------- */
(function setupDrag() {
    const titlebar = document.getElementById('main-titlebar');
    const win = document.getElementById('main-window');
    let dragging = false;
    let offsetX = 0, offsetY = 0;

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
        const menuH = 24;
        y = Math.max(menuH, Math.min(y, window.innerHeight - 30));
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
        win.style.width = '820px';
        win.style.height = '560px';
        win.style.left = '';
        win.style.top = '';
        win.style.transform = '';
    } else {
        win.classList.add('zoomed');
        win.style.width = (desktop.clientWidth - 8) + 'px';
        win.style.height = (desktop.clientHeight - 8) + 'px';
        win.style.left = '4px';
        win.style.top = '28px';
        win.style.transform = 'none';
    }
    setTimeout(resizeCanvas, 50);
});

/* -- Keyboard Shortcuts ----------------------------------- */
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') {
        if (e.key === 'Escape') {
            overlayIds.forEach(id => document.getElementById(id).classList.remove('visible'));
        }
        if (e.key === 'Enter' && document.getElementById('add-dialog-overlay').classList.contains('visible')) {
            document.getElementById('dialog-save-btn').click();
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
        if (isPlaying) stopPlayback();
        else if (selectedStationId) startPlayback(selectedStationId);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        navigateStations(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedStationId) startPlayback(selectedStationId);
    } else if (e.key === 'Escape') {
        overlayIds.forEach(id => document.getElementById(id).classList.remove('visible'));
    }
});

function navigateStations(direction) {
    if (stations.length === 0) return;
    const currentIdx = stations.findIndex(s => s.id === selectedStationId);
    let newIdx;
    if (currentIdx === -1) {
        newIdx = direction > 0 ? 0 : stations.length - 1;
    } else {
        newIdx = (currentIdx + direction + stations.length) % stations.length;
    }
    selectedStationId = stations[newIdx].id;
    renderStationList();
    updateRemoveBtn();
    const station = stations[newIdx];
    if (!isPlaying) {
        currentNameEl.textContent = station.name;
        currentLocEl.textContent = station.location || '\u00A0';
    }
}

/* -- Audio Events ----------------------------------------- */
audio.addEventListener('waiting', () => setStatus('Buffering...', true));
audio.addEventListener('playing', () => {
    const station = stations.find(s => s.id === playingStationId);
    if (station) setStatus('Playing: ' + station.name, false);
});
audio.addEventListener('error', () => {
    if (playingStationId) {
        setStatus('Connection lost. Try again.', false);
        stopPlayback();
    }
});
audio.addEventListener('stalled', () => setStatus('Stream stalled...', true));

/* -- Utility ---------------------------------------------- */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function centerWindow() {
    const win = document.getElementById('main-window');
    const desktop = document.getElementById('desktop');
    const x = (desktop.clientWidth - win.offsetWidth) / 2;
    const y = (desktop.clientHeight - win.offsetHeight) / 2;
    win.style.left = x + 'px';
    win.style.top = y + 'px';
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
