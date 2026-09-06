// ---------- Elements ----------
const uploadZone = document.getElementById('uploadZone');
const videoInput = document.getElementById('videoInput');
const stage = document.getElementById('stage');
const videoPlayer = document.getElementById('videoPlayer');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const videoWrapper = document.getElementById('videoWrapper');
const controlBar = document.getElementById('controlBar');
const playPauseBtn = document.getElementById('playPauseBtn');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const seekBar = document.getElementById('seekBar');
const seekProgress = document.getElementById('seekProgress');
const seekBuffered = document.getElementById('seekBuffered');
const seekHandle = document.getElementById('seekHandle');
const timeCurrent = document.getElementById('timeCurrent');
const timeDuration = document.getElementById('timeDuration');
const skipBackBtn = document.getElementById('skipBackBtn');
const skipFwdBtn = document.getElementById('skipFwdBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const muteBtn = document.getElementById('muteBtn');
const volIcon = document.getElementById('volIcon');
const muteIcon = document.getElementById('muteIcon');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const loadingIndicator = document.getElementById('loadingIndicator');
const loadingText = document.getElementById('loadingText');
const statusEl = document.getElementById('status');
const resultPanel = document.getElementById('resultPanel');
const closePanel = document.getElementById('closePanel');
const resultSuccess = document.getElementById('resultSuccess');
const resultUnclear = document.getElementById('resultUnclear');
const resultName = document.getElementById('resultName');
const confidenceLabel = document.getElementById('confidenceLabel');
const confidenceFill = document.getElementById('confidenceFill');
const resultInfo = document.getElementById('resultInfo');
const unclearMessage = document.getElementById('unclearMessage');
const leftRail = document.getElementById('leftRail');

let faces = [];
let videoUploaded = false;
let analyzing = false;
let capturedWidth = 0;
let capturedHeight = 0;
let statusTimer = null;
let hideBarTimer = null;

// ---------- Status toast ----------
function updateStatus(message, duration = 2500) {
    console.log('Status:', message);
    statusEl.textContent = message;
    statusEl.classList.add('visible');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove('visible'), duration);
}

// ---------- Upload (drag & drop + file input) ----------
function handleFile(file) {
    if (!file) return;
    updateStatus('Uploading video...');

    let formData = new FormData();
    formData.append('video', file);

    fetch('/upload_video', { method: 'POST', body: formData })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                updateStatus('Upload failed: ' + data.error);
                return;
            }
            uploadZone.hidden = true;
            stage.hidden = false;
            updateStatus('Video uploaded — loading player...');
            resizeCanvas();
            // Serve from the saved file over HTTP, not a local Blob URL.
            videoPlayer.src = '/static/uploads/' + encodeURIComponent(file.name);
        })
        .catch(() => updateStatus('Upload failed'));
}

videoInput.addEventListener('change', e => handleFile(e.target.files[0]));

['dragenter', 'dragover'].forEach(evt =>
    uploadZone.addEventListener(evt, e => {
        e.preventDefault();
        uploadZone.classList.add('dragging');
    })
);
['dragleave', 'drop'].forEach(evt =>
    uploadZone.addEventListener(evt, e => {
        e.preventDefault();
        uploadZone.classList.remove('dragging');
    })
);
uploadZone.addEventListener('drop', e => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});

// ---------- Canvas sizing (matches video's letterboxed content area) ----------
function resizeCanvas() {
    if (!videoPlayer.videoWidth || !videoPlayer.videoHeight) return;

    const videoRect = videoPlayer.getBoundingClientRect();
    const videoAspect = videoPlayer.videoWidth / videoPlayer.videoHeight;
    const displayAspect = videoRect.width / videoRect.height;

    let displayWidth, displayHeight;
    if (videoAspect > displayAspect) {
        displayWidth = videoRect.width;
        displayHeight = videoRect.width / videoAspect;
    } else {
        displayHeight = videoRect.height;
        displayWidth = videoRect.height * videoAspect;
    }

    canvas.width = displayWidth;
    canvas.height = displayHeight;
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';

    const offsetX = (videoRect.width - displayWidth) / 2;
    const offsetY = (videoRect.height - displayHeight) / 2;
    canvas.style.left = offsetX + 'px';
    canvas.style.top = offsetY + 'px';

    // offsetX is the width of the black bar on each side (pillarboxed video).
    updateSideRegions(offsetX);
}
window.addEventListener('resize', resizeCanvas);

// Fits the left analyze-rail into the black-bar width, with a minimum so
// it stays usable when there's little to no black bar.
const MIN_RAIL_WIDTH = 64;

function updateSideRegions(barWidth) {
    leftRail.style.width = Math.max(MIN_RAIL_WIDTH, barWidth) + 'px';
}

// ---------- Play / Pause (single toggle) ----------
function setPlayIcon(isPlaying) {
    playIcon.hidden = isPlaying;
    pauseIcon.hidden = !isPlaying;
}

function togglePlayPause() {
    if (!videoUploaded) return;
    if (videoPlayer.paused) {
        videoPlayer.play();
    } else {
        videoPlayer.pause();
    }
}
playPauseBtn.addEventListener('click', togglePlayPause);

videoPlayer.addEventListener('play', () => {
    setPlayIcon(true);
    faces = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.pointerEvents = 'none';
    if (resultPanel.classList.contains('open')) {
        closeResultPanel();
    }
});

videoPlayer.addEventListener('pause', () => {
    setPlayIcon(false);
    showControlBar(true); // keep controls visible while paused
});

videoPlayer.addEventListener('loadedmetadata', () => {
    resizeCanvas();
    videoUploaded = true;
    videoPlayer.muted = false;
    videoPlayer.play().catch(() => {
        videoPlayer.muted = true;
        videoPlayer.play().catch(() => updateStatus('Video loaded — click play to start'));
    });
});

videoPlayer.addEventListener('playing', () => {
    updateStatus('Playing video');
});

// Surfaces the actual reason if the video fails to load/decode.
videoPlayer.addEventListener('error', () => {
    const err = videoPlayer.error;
    const codeNames = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };
    const reason = err ? (codeNames[err.code] || `code ${err.code}`) : 'unknown';
    console.error('Video error:', reason, err);
    updateStatus(`Video failed to load (${reason}) — check the browser console`, 6000);
});

videoPlayer.addEventListener('seeking', () => {
    faces = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.pointerEvents = 'none';
    analyzing = false;
});

// ---------- Seek bar ----------
function formatTime(seconds) {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

videoPlayer.addEventListener('timeupdate', () => {
    if (!videoPlayer.duration) return;
    const pct = (videoPlayer.currentTime / videoPlayer.duration) * 100;
    seekProgress.style.width = pct + '%';
    seekHandle.style.left = pct + '%';
    timeCurrent.textContent = formatTime(videoPlayer.currentTime);
});

videoPlayer.addEventListener('loadedmetadata', () => {
    timeDuration.textContent = formatTime(videoPlayer.duration);
});

videoPlayer.addEventListener('progress', () => {
    if (videoPlayer.buffered.length && videoPlayer.duration) {
        const end = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
        seekBuffered.style.width = (end / videoPlayer.duration * 100) + '%';
    }
});

function seekToClientX(clientX) {
    const rect = seekBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (videoPlayer.duration) {
        videoPlayer.currentTime = pct * videoPlayer.duration;
    }
}

let seeking = false;
seekBar.addEventListener('mousedown', e => {
    seeking = true;
    seekToClientX(e.clientX);
});
window.addEventListener('mousemove', e => {
    if (seeking) seekToClientX(e.clientX);
});
window.addEventListener('mouseup', () => { seeking = false; });

// ---------- Skip / volume / fullscreen ----------
function skipVideo(seconds) {
    if (!videoUploaded) return;
    videoPlayer.currentTime = Math.max(0, Math.min(videoPlayer.duration, videoPlayer.currentTime + seconds));
    updateStatus(`${seconds > 0 ? 'Forward' : 'Back'} ${Math.abs(seconds)}s — ${formatTime(videoPlayer.currentTime)}`);
}
skipBackBtn.addEventListener('click', () => skipVideo(-10));
skipFwdBtn.addEventListener('click', () => skipVideo(10));

function setMuteIcon(muted) {
    volIcon.hidden = muted;
    muteIcon.hidden = !muted;
}
muteBtn.addEventListener('click', () => {
    videoPlayer.muted = !videoPlayer.muted;
    setMuteIcon(videoPlayer.muted);
    updateStatus(videoPlayer.muted ? 'Muted' : 'Unmuted');
});

function adjustVolume(delta) {
    if (!videoUploaded) return;
    videoPlayer.muted = false;
    setMuteIcon(false);
    videoPlayer.volume = Math.max(0, Math.min(1, videoPlayer.volume + delta));
    updateStatus(`Volume: ${Math.round(videoPlayer.volume * 100)}%`);
}

fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        // Fullscreen the whole #app, not just videoWrapper, so leftRail
        // and resultPanel (siblings of videoWrapper) stay visible.
        document.getElementById('app').requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen();
    }
});

// ---------- Auto-hide control bar ----------
function showControlBar(persist = false) {
    controlBar.classList.remove('hidden-bar');
    clearTimeout(hideBarTimer);
    if (!persist && !videoPlayer.paused) {
        hideBarTimer = setTimeout(() => controlBar.classList.add('hidden-bar'), 2800);
    }
}
videoWrapper.addEventListener('mousemove', () => showControlBar());
videoWrapper.addEventListener('mouseleave', () => {
    if (!videoPlayer.paused) controlBar.classList.add('hidden-bar');
});

// ---------- Analyze frame (face detection) ----------
function analyzeFrame() {
    if (!videoUploaded || analyzing) return;

    analyzing = true;
    analyzeBtn.disabled = true;
    videoPlayer.pause();
    if (resultPanel.classList.contains('open')) {
        closeResultPanel();
    }
    loadingText.textContent = 'Detecting faces…';
    loadingIndicator.hidden = false;

    resizeCanvas();
    capturedWidth = canvas.width;
    capturedHeight = canvas.height;
    ctx.drawImage(videoPlayer, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(function (blob) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let formData = new FormData();
        formData.append('frame', blob, 'frame.jpg');

        fetch('/detect_faces', { method: 'POST', body: formData })
            .then(res => res.json())
            .then(data => {
                analyzing = false;
                analyzeBtn.disabled = false;
                loadingIndicator.hidden = true;

                if (data.error) {
                    updateStatus('Face detection failed');
                    return;
                }
                if (data.faces.length === 0) {
                    updateStatus('No faces detected in this frame');
                    canvas.style.pointerEvents = 'none';
                    return;
                }

                // Rescale only if canvas size changed since capture.
                const scaleX = canvas.width / capturedWidth;
                const scaleY = canvas.height / capturedHeight;

                faces = data.faces.map(f => ({
                    x: f[0] * scaleX,
                    y: f[1] * scaleY,
                    width: f[2] * scaleX,
                    height: f[3] * scaleY,
                    originalX: f[0],
                    originalY: f[1],
                    originalWidth: f[2],
                    originalHeight: f[3]
                }));

                drawBoxes();
                canvas.style.pointerEvents = 'auto';
                updateStatus(`Found ${faces.length} face(s) — click on any face for info`);
            })
            .catch(() => {
                analyzing = false;
                analyzeBtn.disabled = false;
                loadingIndicator.hidden = true;
                updateStatus('Face detection failed');
            });
    }, 'image/jpeg', 0.9);
}
analyzeBtn.addEventListener('click', analyzeFrame);

function drawBoxes() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    faces.forEach(face => {
        ctx.strokeStyle = '#d4af37';
        ctx.lineWidth = 2;
        ctx.strokeRect(face.x, face.y, face.width, face.height);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(face.x, face.y - 24, 100, 20);
        ctx.fillStyle = '#fff';
        ctx.font = '13px Arial';
        ctx.fillText('Click for info', face.x + 4, face.y - 9);
    });
}

// ---------- Click a face -> predict ----------
canvas.addEventListener('click', function (e) {
    if (faces.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    for (let i = 0; i < faces.length; i++) {
        let face = faces[i];
        if (x >= face.x && x <= face.x + face.width && y >= face.y && y <= face.y + face.height) {
            updateStatus('Recognizing character...');
            loadingText.textContent = 'Recognizing…';
            loadingIndicator.hidden = false;

            // face.originalX/Y/Width/Height are in the captured canvas's
            // pixel space - scale to native video resolution before cropping.
            const vw = videoPlayer.videoWidth;
            const vh = videoPlayer.videoHeight;
            const cropScaleX = vw / capturedWidth;
            const cropScaleY = vh / capturedHeight;
            const nativeX = face.originalX * cropScaleX;
            const nativeY = face.originalY * cropScaleY;
            const nativeWidth = face.originalWidth * cropScaleX;
            const nativeHeight = face.originalHeight * cropScaleY;

            const x1 = Math.max(0, nativeX);
            const y1 = Math.max(0, nativeY);
            const x2 = Math.min(vw, nativeX + nativeWidth);
            const y2 = Math.min(vh, nativeY + nativeHeight);
            const cropW = x2 - x1;
            const cropH = y2 - y1;

            if (cropW <= 0 || cropH <= 0) {
                loadingIndicator.hidden = true;
                updateStatus('Face crop out of bounds, try another frame');
                return;
            }

            let tempCanvas = document.createElement('canvas');
            tempCanvas.width = cropW;
            tempCanvas.height = cropH;
            let tempCtx = tempCanvas.getContext('2d');

            let videoCanvas = document.createElement('canvas');
            videoCanvas.width = vw;
            videoCanvas.height = vh;
            let videoCtx = videoCanvas.getContext('2d');
            videoCtx.drawImage(videoPlayer, 0, 0);

            tempCtx.drawImage(videoCanvas, x1, y1, cropW, cropH, 0, 0, cropW, cropH);

            tempCanvas.toBlob(function (blob) {
                let formData = new FormData();
                formData.append('face', blob, 'face.jpg');

                fetch('/predict_face', { method: 'POST', body: formData })
                    .then(res => res.json())
                    .then(data => {
                        loadingIndicator.hidden = true;

                        if (data.error) {
                            updateStatus('Character recognition failed');
                            return;
                        }

                        if (data.status === 'low_confidence') {
                            showUnclearPanel(data);
                            updateStatus('Not clear enough — try a different frame');
                            return;
                        }

                        showResultPanel(data);
                        updateStatus(`Recognized: ${data.prediction} (${(data.confidence * 100).toFixed(1)}%)`);
                    })
                    .catch(() => {
                        loadingIndicator.hidden = true;
                        updateStatus('Character recognition failed');
                    });
            }, 'image/jpeg', 0.9);
            break;
        }
    }
});

// ---------- Result panel (DOM, not canvas) ----------
function showResultPanel(data) {
    // resizeCanvas() clears the canvas as a side effect, so redraw the boxes.
    resizeCanvas();
    drawBoxes();
    resultUnclear.hidden = true;
    resultSuccess.hidden = false;
    resultName.textContent = data.prediction;
    const confPct = data.confidence * 100;
    confidenceLabel.textContent = `Confidence: ${confPct.toFixed(1)}%`;
    confidenceFill.style.width = confPct + '%';
    confidenceFill.style.background = confPct >= 80 ? 'var(--green)' : confPct >= 50 ? 'var(--gold)' : 'var(--red)';
    resultInfo.textContent = data.info;
    resultPanel.hidden = false;
    requestAnimationFrame(() => resultPanel.classList.add('open'));
}

function showUnclearPanel(data) {
    resizeCanvas();
    drawBoxes();
    resultSuccess.hidden = true;
    resultUnclear.hidden = false;
    unclearMessage.textContent = data.message;
    resultPanel.hidden = false;
    requestAnimationFrame(() => resultPanel.classList.add('open'));
}

function closeResultPanel() {
    resultPanel.classList.remove('open');
    setTimeout(() => { resultPanel.hidden = true; }, 350);
}
closePanel.addEventListener('click', closeResultPanel);

// ---------- Keyboard shortcuts ----------
document.addEventListener('keydown', e => {
    const keys = ['Space', 'KeyA', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyF'];
    if (keys.includes(e.code)) e.preventDefault();

    switch (e.code) {
        case 'Space': togglePlayPause(); break;
        case 'KeyA': analyzeFrame(); break;
        case 'ArrowLeft': skipVideo(-10); break;
        case 'ArrowRight': skipVideo(10); break;
        case 'ArrowUp': adjustVolume(0.1); break;
        case 'ArrowDown': adjustVolume(-0.1); break;
        case 'KeyF': fullscreenBtn.click(); break;
    }
});
