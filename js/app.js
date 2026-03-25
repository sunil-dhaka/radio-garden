/* ============================================================
   Radio Garden - Application Logic
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

/* -- State ------------------------------------------------ */
let stations = [];
let selectedStationId = null;
let playingStationId = null;
let visualizerStyle = 'bars'; // 'bars' or 'wave'
let isPlaying = false;

/* -- DOM refs --------------------------------------------- */
const audio = document.getElementById('audio-player');
const stationListEl = document.getElementById('station-list');
const statusText = document.getElementById('status-text');
const statusBar = document.getElementById('status-bar');
const statusBitrate = document.getElementById('status-bitrate');
const currentNameEl = document.getElementById('current-station-name');
const currentLocEl = document.getElementById('current-station-location');
const nowPlayingLabel = document.getElementById('now-playing-label');
const nowPlayingText = document.getElementById('now-playing-text');
const playBtn = document.getElementById('play-btn');
const stopBtn = document.getElementById('stop-btn');
const volumeSlider = document.getElementById('volume');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

/* -- Audio & Visualizer ----------------------------------- */
let audioContext = null;
let analyser = null;
let sourceNode = null;
let useFakeVisualizer = false;
let animFrameId = null;
const BAR_COUNT = 32;
let fakeBarHeights = new Array(BAR_COUNT).fill(0);

function initAudioContext() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;

    try {
        sourceNode = audioContext.createMediaElementSource(audio);
        sourceNode.connect(analyser);
        analyser.connect(audioContext.destination);
    } catch (e) {
        useFakeVisualizer = true;
    }

}

function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}

function drawVisualizer() {
    animFrameId = requestAnimationFrame(drawVisualizer);
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Draw grid lines (CRT aesthetic)
    ctx.strokeStyle = 'rgba(0, 204, 68, 0.06)';
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 20) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }
    for (let x = 0; x < w; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }

    // Draw scan line effect
    const scanLineY = (Date.now() / 20) % h;
    ctx.fillStyle = 'rgba(0, 255, 68, 0.03)';
    ctx.fillRect(0, scanLineY, w, 2);

    if (visualizerStyle === 'bars') {
        drawBars(w, h);
    } else {
        drawWave(w, h);
    }
}

function drawBars(w, h) {
    const barWidth = (w / BAR_COUNT) - 2;
    const dataArray = new Uint8Array(analyser ? analyser.frequencyBinCount : BAR_COUNT);
    let realData = false;

    if (analyser && isPlaying && !useFakeVisualizer) {
        analyser.getByteFrequencyData(dataArray);
        // Check if data is non-zero (CORS may block it)
        realData = dataArray.some(v => v > 0);
    }

    for (let i = 0; i < BAR_COUNT; i++) {
        let barH;
        if (realData) {
            const idx = Math.floor(i * dataArray.length / BAR_COUNT);
            barH = (dataArray[idx] / 255) * h * 0.85;
        } else if (isPlaying) {
            // Simulated: smooth random motion
            const target = (Math.sin(Date.now() / 300 + i * 0.7) * 0.3 +
                            Math.sin(Date.now() / 700 + i * 1.3) * 0.2 +
                            Math.sin(Date.now() / 150 + i * 2.1) * 0.15 +
                            0.35) * h * 0.75;
            fakeBarHeights[i] += (target - fakeBarHeights[i]) * 0.12;
            barH = Math.max(2, fakeBarHeights[i]);
        } else {
            // Decay when stopped
            fakeBarHeights[i] *= 0.92;
            barH = fakeBarHeights[i];
            if (barH < 1) barH = 0;
        }

        const x = i * (barWidth + 2) + 1;
        const y = h - barH;

        // Bar gradient
        const grad = ctx.createLinearGradient(x, y, x, h);
        grad.addColorStop(0, '#00ff55');
        grad.addColorStop(0.5, '#00cc44');
        grad.addColorStop(1, '#006622');
        ctx.fillStyle = grad;

        ctx.fillRect(x, y, barWidth, barH);

        // Bright top cap
        if (barH > 3) {
            ctx.fillStyle = '#88ffaa';
            ctx.fillRect(x, y, barWidth, 2);
        }
    }
}

function drawWave(w, h) {
    const bufferLength = analyser ? analyser.frequencyBinCount : 128;
    const dataArray = new Uint8Array(bufferLength);
    let realData = false;

    if (analyser && isPlaying && !useFakeVisualizer) {
        analyser.getByteTimeDomainData(dataArray);
        realData = dataArray.some(v => v !== 128);
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00ff55';
    ctx.shadowColor = '#00ff55';
    ctx.shadowBlur = 4;
    ctx.beginPath();

    const sliceWidth = w / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        let v;
        if (realData) {
            v = dataArray[i] / 128.0;
        } else if (isPlaying) {
            v = 1 +
                Math.sin(Date.now() / 200 + i * 0.15) * 0.25 +
                Math.sin(Date.now() / 500 + i * 0.08) * 0.15 +
                Math.sin(Date.now() / 100 + i * 0.3) * 0.05;
        } else {
            v = 1;
        }
        const y = (v * h) / 2;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        x += sliceWidth;
    }

    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
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

        el.addEventListener('click', () => selectStation(station.id));
        el.addEventListener('dblclick', () => {
            selectStation(station.id);
            startPlayback(station.id);
        });

        stationListEl.appendChild(el);
    });
}

function selectStation(id) {
    selectedStationId = id;
    renderStationList();
    updateRemoveBtn();
    const station = stations.find(s => s.id === id);
    if (station && !isPlaying) {
        currentNameEl.textContent = station.name;
        currentLocEl.textContent = station.location || '\u00A0';
    }
}

function updateRemoveBtn() {
    const btn = document.getElementById('remove-station-btn');
    btn.disabled = !selectedStationId;
}

function updateNowPlaying(station) {
    if (station) {
        currentNameEl.textContent = station.name;
        currentLocEl.textContent = station.location || '\u00A0';
        nowPlayingText.textContent = 'NOW PLAYING';
        nowPlayingLabel.classList.add('active');
    } else {
        if (!selectedStationId) {
            currentNameEl.textContent = 'Select a station';
            currentLocEl.innerHTML = '&nbsp;';
        }
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

    initAudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();

    setStatus('Connecting to ' + station.name + '...', true);
    audio.src = station.streamUrl;
    audio.load();
    audio.play()
        .then(() => {
            isPlaying = true;
            playingStationId = stationId;
            selectedStationId = stationId;
            playBtn.disabled = true;
            stopBtn.disabled = false;
            playBtn.classList.add('playing');
            updateNowPlaying(station);
            renderStationList();
            updateStationsMenu();
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
    playBtn.disabled = false;
    stopBtn.disabled = true;
    playBtn.classList.remove('playing');
    updateNowPlaying(null);
    renderStationList();
    updateStationsMenu();
    setStatus('Ready', false);
    statusBitrate.textContent = '';
}

/* -- Volume ----------------------------------------------- */
audio.volume = 0.75;
volumeSlider.addEventListener('input', () => {
    audio.volume = volumeSlider.value / 100;
});

/* -- Transport Controls ----------------------------------- */
playBtn.addEventListener('click', () => startPlayback());
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
    const location = document.getElementById('input-location').value.trim();
    if (!name || !url) {
        setStatus('Please enter a name and stream URL', false);
        return;
    }
    addStation(name, url, location);
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

// Close dialog overlays on click outside
['add-dialog-overlay', 'about-dialog-overlay', 'help-dialog-overlay'].forEach(id => {
    document.getElementById(id).addEventListener('click', (e) => {
        if (e.target.id === id) {
            document.getElementById(id).classList.remove('visible');
        }
    });
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
        if (openMenuId === menuId) {
            closeAllMenus();
        } else {
            openMenu(menuId);
        }
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
    else if (action === 'close-window') document.getElementById('main-window').style.display = 'none';
    else if (action === 'toggle-visualizer-style') toggleVisualizerStyle();
    else if (stationId) {
        selectStation(stationId);
        startPlayback(stationId);
    }

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
        const sep = document.createElement('div');
        sep.className = 'menu-separator';
        dropdown.appendChild(sep);
    }
    const addItem = document.createElement('div');
    addItem.className = 'menu-dropdown-item';
    addItem.dataset.action = 'add-station';
    addItem.innerHTML = 'Add Station...<span class="shortcut">&#8984;N</span>';
    dropdown.appendChild(addItem);
}

function toggleVisualizerStyle() {
    visualizerStyle = visualizerStyle === 'bars' ? 'wave' : 'bars';
    const label = visualizerStyle === 'bars' ? 'Visualizer: Bars' : 'Visualizer: Wave';
    const viewItem = document.querySelector('[data-action="toggle-visualizer-style"]');
    if (viewItem) viewItem.firstChild.textContent = label;
}

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
        // Constrain to viewport
        const menuH = 24;
        y = Math.max(menuH, Math.min(y, window.innerHeight - 30));
        x = Math.max(-win.offsetWidth + 60, Math.min(x, window.innerWidth - 60));
        win.style.left = x + 'px';
        win.style.top = y + 'px';
        // Remove centering transform if set
        win.style.transform = 'none';
    });

    document.addEventListener('mouseup', () => {
        dragging = false;
        titlebar.classList.remove('dragging');
    });
})();

/* -- Window Controls -------------------------------------- */
document.getElementById('close-btn').addEventListener('click', () => {
    stopPlayback();
    document.getElementById('main-window').style.display = 'none';
    setStatus('Window closed. Reload page to reopen.', false);
});

document.getElementById('shade-btn').addEventListener('click', () => {
    document.getElementById('main-window').classList.toggle('shaded');
});

document.getElementById('zoom-btn').addEventListener('click', () => {
    const win = document.getElementById('main-window');
    const desktop = document.getElementById('desktop');
    if (win.classList.contains('zoomed')) {
        win.classList.remove('zoomed');
        win.style.width = '680px';
        win.style.height = '480px';
        win.style.left = '';
        win.style.top = '';
        win.style.transform = '';
    } else {
        win.classList.add('zoomed');
        win.style.width = (desktop.clientWidth - 8) + 'px';
        win.style.height = (desktop.clientHeight - 8) + 'px';
        win.style.left = '4px';
        win.style.top = '28px'; // Below menu bar
        win.style.transform = 'none';
    }
    setTimeout(resizeCanvas, 50);
});

/* -- Keyboard Shortcuts ----------------------------------- */
document.addEventListener('keydown', (e) => {
    // Ignore if typing in input
    if (e.target.tagName === 'INPUT') {
        if (e.key === 'Escape') {
            hideAddDialog();
            document.getElementById('about-dialog-overlay').classList.remove('visible');
            document.getElementById('help-dialog-overlay').classList.remove('visible');
        }
        if (e.key === 'Enter' && document.getElementById('add-dialog-overlay').classList.contains('visible')) {
            document.getElementById('dialog-save-btn').click();
        }
        return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        showAddDialog();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        // Only handle if not a paste action
        if (!e.target.closest('input')) {
            e.preventDefault();
            toggleVisualizerStyle();
        }
    } else if (e.key === ' ') {
        e.preventDefault();
        if (isPlaying) stopPlayback();
        else startPlayback();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        navigateStations(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Escape') {
        hideAddDialog();
        document.getElementById('about-dialog-overlay').classList.remove('visible');
        document.getElementById('help-dialog-overlay').classList.remove('visible');
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
    selectStation(stations[newIdx].id);
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
audio.addEventListener('stalled', () => setStatus('Stream stalled. Reconnecting...', true));

/* -- Utility ---------------------------------------------- */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/* -- Center Window Initially ------------------------------ */
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

    // Start visualizer loop
    drawVisualizer();

    // Handle window resize
    window.addEventListener('resize', () => {
        resizeCanvas();
    });

    // Check CORS compatibility after first play
    let corsChecked = false;
    audio.addEventListener('playing', () => {
        if (corsChecked || !analyser) return;
        corsChecked = true;
        setTimeout(() => {
            const testData = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(testData);
            if (!testData.some(v => v > 0)) {
                useFakeVisualizer = true;
            }
        }, 500);
    });
}

document.addEventListener('DOMContentLoaded', init);
