(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const canvas = $('#previewCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const emptyState = $('#emptyState');
  const playButton = $('#playButton');
  const timeline = $('#timeline');
  const storageKey = 'cine-title-studio-v01';

  const presets = {
    rose: { color: '#e48b9b', shadow: '#914b51', warmth: 8, grain: 20, vignette: 20 },
    cream: { color: '#f0e7ad', shadow: '#8d6740', warmth: 16, grain: 23, vignette: 23 },
    orange: { color: '#e78a2b', shadow: '#91481c', warmth: 20, grain: 18, vignette: 18 },
    blue: { color: '#9fbfea', shadow: '#6188ba', warmth: -10, grain: 14, vignette: 20 }
  };

  const defaults = {
    ratio: '9:16', duration: 8, line1: 'SCENES FROM', line2: 'Seoul', line3: 'WITH', line4: 'Love',
    font: 'Instrument Serif', size: 100, y: 50, tilt: -4, lineSpacing: 100, color: '#e48b9b', shadow: '#914b51',
    grain: 18, vignette: 22, warmth: 12, colorFilter: 'static', filterIntensity: 78, filmColor: '#4a3229', filmOpacity: 14,
    motion: 'stagger', kenBurns: true, preset: 'rose', subtitleText: '', subtitleEnabled: true,
    subtitleFont: 'Noto Sans KR', subtitleStyle: 'shadow', subtitleColor: '#ffffff', subtitleSize: 38, subtitleY: 88
  };
  let state = { ...defaults, ...safeLoad() };
  // 이전 기본값(Bodoni)을 쓰던 프로젝트만 새 시네마 이탤릭 기본값으로 옮기고, 직접 고른 서체는 유지합니다.
  if (state.font === 'Bodoni Moda') state.font = 'Instrument Serif';
  let clips = [];
  let mediaMuted = true;
  let activeClipIndex = -1;
  let isPlaying = false;
  let isRendering = false;
  let startedAt = 0;
  let currentSeconds = 0;
  let animationFrame = 0;
  let toastTimer = 0;
  let customFontName = '';
  let customSubtitleFontName = '';
  let titleInkCache = new Map();
  let titleInkCacheSignature = '';

  function safeLoad() {
    try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
  }
  function save() {
    const persist = { ...state };
    if (persist.font === customFontName) persist.font = defaults.font;
    if (persist.subtitleFont === customSubtitleFontName) persist.subtitleFont = defaults.subtitleFont;
    localStorage.setItem(storageKey, JSON.stringify(persist));
  }
  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
  }
  function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
  function easeOut(value) { return 1 - Math.pow(1 - clamp(value), 3); }
  function formatTime(seconds) { return `0:${String(Math.floor(seconds)).padStart(2, '0')}`; }

  function syncUI() {
    $('#ratioSelect').value = state.ratio;
    if (![...$('#durationSelect').options].some(option => Number(option.value) === Number(state.duration))) {
      $('#durationSelect').add(new Option(`${state.duration}초`, String(state.duration)));
    }
    $('#durationSelect').value = String(state.duration);
    ['line1','line2','line3','line4'].forEach(id => { $(`#${id}`).value = state[id]; });
    $('#fontSelect').value = [...$('#fontSelect').options].some(o => o.value === state.font) ? state.font : defaults.font;
    $('#sizeRange').value = state.size;
    $('#yRange').value = state.y;
    $('#tiltRange').value = state.tilt;
    $('#lineSpacingRange').value = state.lineSpacing;
    $('#colorInput').value = state.color;
    $('#shadowInput').value = state.shadow;
    $('#grainRange').value = state.grain;
    $('#vignetteRange').value = state.vignette;
    $('#warmthRange').value = state.warmth;
    $('#filterRange').value = state.filterIntensity;
    $('#filmColorInput').value = state.filmColor;
    $('#filmOpacityRange').value = state.filmOpacity;
    $('#kenBurnsToggle').checked = state.kenBurns;
    $('#subtitleText').value = state.subtitleText;
    $('#subtitleToggle').checked = state.subtitleEnabled;
    $('#subtitleFontSelect').value = [...$('#subtitleFontSelect').options].some(option => option.value === state.subtitleFont) ? state.subtitleFont : defaults.subtitleFont;
    $('#subtitleStyleSelect').value = state.subtitleStyle;
    $('#subtitleColorInput').value = state.subtitleColor;
    $('#subtitleSizeRange').value = state.subtitleSize;
    $('#subtitleYRange').value = state.subtitleY;
    $(`input[name="motion"][value="${state.motion}"]`).checked = true;
    updateOutputs();
    selectColorFilter(state.colorFilter, false);
    selectPreset(state.preset, false);
    setCanvasRatio();
    $('#totalTime').textContent = formatTime(state.duration);
    $('#muteButton').classList.toggle('is-muted', mediaMuted);
  }

  function updateOutputs() {
    $('#sizeOutput').textContent = `${state.size}%`;
    $('#yOutput').textContent = `${state.y}%`;
    $('#tiltOutput').textContent = `${state.tilt}°`;
    $('#lineSpacingOutput').textContent = `${state.lineSpacing}%`;
    $('#grainOutput').textContent = `${state.grain}%`;
    $('#vignetteOutput').textContent = `${state.vignette}%`;
    $('#warmthOutput').textContent = `${state.warmth}%`;
    $('#filterOutput').textContent = `${state.filterIntensity}%`;
    $('#filmOpacityOutput').textContent = `${state.filmOpacity}%`;
    $('#subtitleSizeOutput').textContent = String(state.subtitleSize);
    $('#subtitleYOutput').textContent = `${state.subtitleY}%`;
  }

  function setCanvasRatio() {
    const sizes = { '9:16':[1080,1920], '4:5':[1080,1350], '1:1':[1080,1080], '16:9':[1920,1080] };
    [canvas.width, canvas.height] = sizes[state.ratio];
    $('.stage-shell').style.aspectRatio = state.ratio.replace(':',' / ');
    renderFrame(currentSeconds);
  }

  function drawCover(element, zoom = 1) {
    const sw = element.videoWidth || element.naturalWidth;
    const sh = element.videoHeight || element.naturalHeight;
    if (!sw || !sh) return;
    const scale = Math.max(canvas.width / sw, canvas.height / sh) * zoom;
    const w = sw * scale;
    const h = sh * scale;
    ctx.drawImage(element, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }

  function mediaFilterStyle() {
    const k = state.filterIntensity / 100;
    const profiles = {
      static: { contrast:.94, saturation:.78, brightness:1.01, sepia:.17, hue:-4 },
      sunset: { contrast:.98, saturation:.88, brightness:.99, sepia:.22, hue:-7 },
      cyan: { contrast:1.12, saturation:.94, brightness:.98, sepia:.03, hue:8 },
      faded: { contrast:.9, saturation:.76, brightness:1.06, sepia:.16, hue:-4 },
      clean: { contrast:1, saturation:1, brightness:1, sepia:0, hue:0 }
    };
    const profile = profiles[state.colorFilter] || profiles.static;
    const mix = (neutral, target) => neutral + (target - neutral) * k;
    return `contrast(${mix(1,profile.contrast)}) saturate(${mix(1,profile.saturation)}) brightness(${mix(1,profile.brightness)}) sepia(${profile.sepia*k}) hue-rotate(${profile.hue*k}deg)`;
  }

  function applyColorGrade() {
    const k = state.filterIntensity / 100;
    if (!k || state.colorFilter === 'clean') return;
    ctx.save();
    if (state.colorFilter === 'static') {
      // 오래된 컬러 필름처럼 검정은 살짝 들고, 녹색 그림자와 앰버 하이라이트를 남깁니다.
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .075 * k; ctx.fillStyle = '#aa9272'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = .22 * k;
      const g = ctx.createLinearGradient(0,0,canvas.width,canvas.height);
      g.addColorStop(0,'#788166'); g.addColorStop(.52,'#b8945d'); g.addColorStop(1,'#ba7040');
      ctx.fillStyle = g; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = .055 * k; ctx.fillStyle = '#574837'; ctx.fillRect(0,0,canvas.width,canvas.height);
    } else if (state.colorFilter === 'sunset') {
      ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = .34 * k; ctx.fillStyle = '#d97732'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = .08 * k; ctx.fillStyle = '#4b231d'; ctx.fillRect(0,0,canvas.width,canvas.height);
    } else if (state.colorFilter === 'cyan') {
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .17 * k; ctx.fillStyle = '#075d67'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = .18 * k; ctx.fillStyle = '#2b9aa0'; ctx.fillRect(0,0,canvas.width,canvas.height);
    } else if (state.colorFilter === 'faded') {
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .16 * k; ctx.fillStyle = '#5a5040'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = .16 * k; ctx.fillStyle = '#c98464'; ctx.fillRect(0,0,canvas.width,canvas.height);
    }
    ctx.restore();
  }

  function addFilmSheet(time) {
    const opacity = state.filmOpacity / 100;
    if (opacity <= 0) return;
    ctx.save();
    // 반투명 컬러 필름지: 배경만 눌러 타이틀이 밝은 장면에서도 읽히게 합니다.
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = opacity * .72;
    ctx.fillStyle = state.filmColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = opacity * .52;
    ctx.fillStyle = '#f5d9a8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 필름지 안쪽의 미세한 색 입자와 먼지. 타이틀보다 먼저 그려 텍스트는 또렷하게 유지합니다.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = Math.min(.14, opacity * .34);
    let seed = Math.floor(time * 24) + 173;
    const random = () => { seed = (seed * 48271) % 2147483647; return (seed - 1) / 2147483646; };
    const count = Math.floor((canvas.width * canvas.height) / 4600 * Math.min(1.5, opacity * 5));
    for (let i = 0; i < count; i++) {
      const pale = random() > .52;
      ctx.fillStyle = pale ? '#f7e6c2' : state.filmColor;
      const size = .8 + random() * 2.1;
      ctx.fillRect(random() * canvas.width, random() * canvas.height, size, size);
    }
    ctx.restore();
  }

  function drawFallback() {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#789095');
    gradient.addColorStop(.48, '#a77952');
    gradient.addColorStop(1, '#362b26');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function sceneInfo(time) {
    if (!clips.length) return null;
    const segment = state.duration / clips.length;
    const safeTime = Math.min(Math.max(0, time), Math.max(0, state.duration - .001));
    const index = Math.min(clips.length - 1, Math.floor(safeTime / segment));
    const local = safeTime - index * segment;
    const fadeDuration = clips.length > 1 ? Math.min(.5, segment * .22) : 0;
    const fade = index < clips.length - 1 && fadeDuration ? clamp((local - (segment - fadeDuration)) / fadeDuration) : 0;
    return { index, local, segment, fade, clip: clips[index], next: clips[index + 1] || null, fadeDuration };
  }

  function drawClip(clip, zoom, alpha = 1) {
    if (!clip?.element) return false;
    const ready = clip.type === 'image'
      ? clip.element.complete && clip.element.naturalWidth > 0 && clip.element.naturalHeight > 0
      : clip.element.readyState >= 2 && clip.element.videoWidth > 0 && clip.element.videoHeight > 0;
    if (!ready) return false;
    try {
      ctx.save();
      ctx.globalAlpha = alpha;
      drawCover(clip.element, zoom);
      ctx.restore();
      return true;
    } catch (error) {
      ctx.restore();
      console.warn('미디어 프레임을 그리지 못했습니다.', clip.name, error);
      return false;
    }
  }

  function syncVideoPlayback(time, shouldPlay = isPlaying || isRendering, forceSeek = false) {
    const info = sceneInfo(time);
    clips.forEach((clip, index) => {
      if (clip.type !== 'video') return;
      const isCurrent = info && index === info.index;
      const isIncoming = info && info.fade > 0 && index === info.index + 1;
      if (!isCurrent && !isIncoming) { clip.element.pause(); return; }
      const local = isCurrent ? info.local : Math.max(0, info.local - (info.segment - info.fadeDuration));
      const usableDuration = Number.isFinite(clip.element.duration) && clip.element.duration > .05 ? clip.element.duration : info.segment;
      const target = local % usableDuration;
      clip.element.muted = mediaMuted;
      if (forceSeek || Math.abs(clip.element.currentTime - target) > .55) {
        try { clip.element.currentTime = target; } catch {}
      }
      if (shouldPlay) clip.element.play().catch(() => {}); else clip.element.pause();
    });
  }

  function pauseAllVideos() {
    clips.forEach(clip => { if (clip.type === 'video') clip.element.pause(); });
  }

  function fitText(text, maxWidth, initialSize, family) {
    let size = initialSize;
    while (size > initialSize * .58) {
      ctx.font = `italic 600 ${size}px "${family}", Georgia, serif`;
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 3;
    }
    return size;
  }

  function titleInk(text, fontSize, family) {
    const key = `${text}|${fontSize}|${family}|${state.color}|${state.shadow}`;
    const cached = titleInkCache.get(key);
    if (cached) return cached;
    ctx.font = `italic 500 ${fontSize}px "${family}", Georgia, serif`;
    const width = Math.ceil(ctx.measureText(text).width + fontSize * .24);
    const height = Math.ceil(fontSize * 1.55);
    const layer = document.createElement('canvas');
    layer.width = width; layer.height = height;
    const ink = layer.getContext('2d');
    ink.font = `italic 500 ${fontSize}px "${family}", Georgia, serif`;
    ink.textAlign = 'center'; ink.textBaseline = 'middle';
    // 레퍼런스처럼 오른쪽에만 아주 얇게 보이는 활자 인쇄 오차입니다. 번짐·블러는 사용하지 않습니다.
    ink.globalAlpha = .42;
    ink.fillStyle = state.shadow;
    ink.fillText(text, width / 2 + Math.max(1, fontSize * .011), height / 2 + fontSize * .025);
    ink.globalAlpha = 1;
    ink.fillStyle = state.color;
    ink.fillText(text, width / 2, height / 2 + fontSize * .025);
    // 화면 밖으로 튀어나오는 그림자는 만들지 않고, 활자 안에서만 인쇄 농도를 살짝 바꿉니다.
    ink.save();
    ink.globalCompositeOperation = 'source-atop';
    ink.globalAlpha = .15;
    ink.fillStyle = state.shadow;
    ink.fillRect(0, 0, width, height);
    let seed = Math.max(1, [...key].reduce((value, character) => (value * 31 + character.charCodeAt(0)) % 2147483647, 17));
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const flecks = Math.max(4, Math.floor((width * height) / 9000));
    ink.globalAlpha = .28;
    for (let i = 0; i < flecks; i++) {
      const size = 1 + random() * 1.8;
      ink.fillStyle = random() > .56 ? 'rgba(255,248,230,.58)' : state.shadow;
      ink.fillRect(random() * width, random() * height, size, size);
    }
    ink.restore();
    titleInkCache.set(key, layer);
    return layer;
  }

  function drawTitle(time) {
    const w = canvas.width, h = canvas.height;
    const duration = Math.min(state.duration, 4.2);
    const globalP = clamp(time / duration);
    const titleSpan = Math.min(state.duration, 5);
    const fadeOut = 1 - easeOut((time - (titleSpan - .65)) / .65);
    const fontScale = state.size / 100;
    const groupY = h * (state.y / 100);
    const lineSpacing = state.lineSpacing / 100;
    const lines = [
      { text: state.line1, offset: -.135, size: .034, delay: .04 },
      { text: state.line2, offset: -.047, size: .118, delay: .16 },
      { text: state.line3, offset: .035, size: .028, delay: .29 },
      { text: state.line4, offset: .12, size: .112, delay: .42 }
    ];
    const cacheSignature = `${w}|${h}|${state.font}|${state.color}|${state.shadow}|${state.size}|${state.line1}|${state.line2}|${state.line3}|${state.line4}`;
    if (cacheSignature !== titleInkCacheSignature) {
      titleInkCache.clear();
      titleInkCacheSignature = cacheSignature;
    }
    ctx.save();
    ctx.translate(w / 2, groupY);
    ctx.rotate(state.tilt * Math.PI / 180);
    lines.forEach((line, index) => {
      if (!line.text.trim()) return;
      const appear = easeOut((globalP - line.delay) / .22);
      if (appear <= 0) return;
      let shiftY = 0, scale = 1;
      if (state.motion === 'stagger') shiftY = (1 - appear) * h * .026;
      if (state.motion === 'rise') shiftY = (1 - appear) * h * .085;
      if (state.motion === 'zoom') scale = .78 + appear * .22;
      const initialSize = h * line.size * fontScale;
      const fontSize = fitText(line.text, w * .84, initialSize, state.font);
      const layer = titleInk(line.text, fontSize, state.font);
      ctx.save();
      ctx.translate(0, h * line.offset * lineSpacing + shiftY);
      ctx.scale(scale, scale);
      ctx.globalAlpha = appear * fadeOut;
      ctx.drawImage(layer, -layer.width / 2, -layer.height / 2);
      ctx.restore();
    });
    ctx.restore();
  }

  function wrapSubtitle(text, maxWidth) {
    const lines = [];
    text.split('\n').forEach(paragraph => {
      if (!paragraph) { lines.push(''); return; }
      let line = '';
      for (const character of paragraph) {
        const test = line + character;
        if (line && ctx.measureText(test).width > maxWidth) {
          lines.push(line.trim());
          line = character === ' ' ? '' : character;
        } else line = test;
      }
      if (line) lines.push(line.trim());
    });
    return lines.slice(0, 4);
  }

  function drawSubtitle(time) {
    const text = state.subtitleText.trim();
    if (!state.subtitleEnabled || !text) return;
    const w = canvas.width, h = canvas.height;
    const base = Math.min(w, h * .75);
    const fontSize = Math.max(18, base * (state.subtitleSize / 900));
    const lineHeight = fontSize * 1.48;
    const fadeIn = easeOut(time / .25);
    const fadeOut = 1 - easeOut((time - (state.duration - .3)) / .3);
    ctx.save();
    ctx.globalAlpha = fadeIn * fadeOut;
    ctx.font = `500 ${fontSize}px "${state.subtitleFont}", "Noto Sans KR", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const lines = wrapSubtitle(text, w * .82);
    const y = h * (state.subtitleY / 100);
    const startY = y - (lines.length - 1) * lineHeight;
    if (state.subtitleStyle === 'panel') {
      const widest = Math.max(...lines.map(line => ctx.measureText(line).width), 1);
      const padX = fontSize * .55, padY = fontSize * .38;
      const boxX = (w - widest) / 2 - padX;
      const boxY = startY - lineHeight * .52 - padY;
      const boxW = widest + padX * 2;
      const boxH = lineHeight * lines.length + padY * 2;
      ctx.fillStyle = 'rgba(0,0,0,.58)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(boxX, boxY, boxW, boxH, fontSize * .18);
      else ctx.rect(boxX, boxY, boxW, boxH);
      ctx.fill();
    }
    lines.forEach((line, index) => {
      const lineY = startY + index * lineHeight;
      if (state.subtitleStyle === 'shadow') {
        ctx.shadowColor = 'rgba(0,0,0,.95)'; ctx.shadowBlur = fontSize * .18;
        ctx.shadowOffsetX = 0; ctx.shadowOffsetY = fontSize * .09;
      } else if (state.subtitleStyle === 'outline') {
        ctx.lineWidth = Math.max(2, fontSize * .105); ctx.strokeStyle = 'rgba(0,0,0,.95)';
        ctx.strokeText(line, w / 2, lineY);
      }
      ctx.fillStyle = state.subtitleColor;
      ctx.fillText(line, w / 2, lineY);
      ctx.shadowColor = 'transparent';
    });
    ctx.restore();
  }

  function addMood(time) {
    const warmth = state.warmth;
    if (warmth !== 0) {
      ctx.save();
      ctx.globalCompositeOperation = warmth > 0 ? 'soft-light' : 'color';
      ctx.globalAlpha = Math.abs(warmth) / 115;
      ctx.fillStyle = warmth > 0 ? '#f08a3e' : '#557ed8';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    if (state.vignette > 0) {
      const r = Math.max(canvas.width, canvas.height) * .72;
      const g = ctx.createRadialGradient(canvas.width/2, canvas.height/2, r*.22, canvas.width/2, canvas.height/2, r);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${state.vignette/100})`);
      ctx.fillStyle = g; ctx.fillRect(0,0,canvas.width,canvas.height);
    }
    if (state.grain > 0) {
      const count = Math.floor((canvas.width * canvas.height) / 780 * (state.grain / 22));
      ctx.save();
      ctx.globalAlpha = Math.min(.2, state.grain / 420);
      let seed = Math.floor(time * 30) + 29;
      const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      for (let i=0;i<count;i++) {
        const v = random() > .5 ? 255 : 0;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(random()*canvas.width, random()*canvas.height, 1.7, 1.7);
      }
      ctx.restore();
    }
  }

  function drawFilmGate(time) {
    if (state.motion !== 'gate') return;
    // 레퍼런스의 첫 컷처럼, 검은 프레임 안에서 얇은 가로 화면이 열려 전체 장면으로 확장됩니다.
    const progress = easeOut((time - .14) / 1.48);
    if (progress >= 1) return;
    const halfHeight = canvas.height * (.008 + .492 * clamp(progress));
    const top = canvas.height / 2 - halfHeight;
    const bottom = canvas.height / 2 + halfHeight;
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, Math.max(0, top));
    ctx.fillRect(0, Math.min(canvas.height, bottom), canvas.width, Math.max(0, canvas.height - bottom));
    ctx.restore();
  }

  function renderFrame(time = 0) {
    ctx.save();
    ctx.fillStyle = '#1b1a18';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    const info = sceneInfo(time);
    ctx.filter = mediaFilterStyle();
    if (info) {
      const sceneProgress = clamp(info.local / info.segment);
      const zoom = state.kenBurns ? 1 + .035 * sceneProgress : 1;
      const drawn = drawClip(info.clip, zoom, 1);
      if (!drawn) drawFallback();
      if (info.next && info.fade > 0) drawClip(info.next, 1, easeOut(info.fade));
      if (activeClipIndex !== info.index) {
        activeClipIndex = info.index;
        $$('.scene-card').forEach((card, index) => card.classList.toggle('active', index === activeClipIndex));
        $('#stageNote').textContent = `장면 ${info.index + 1}/${clips.length} · ${info.clip.name}`;
      }
    } else {
      drawFallback();
      $('#stageNote').textContent = '타이틀 모션은 미리보기와 저장 결과에 동일하게 적용됩니다.';
    }
    ctx.filter = 'none';
    applyColorGrade();
    addFilmSheet(time);
    addMood(time);
    drawFilmGate(time);
    drawTitle(time);
    drawSubtitle(time);
    ctx.restore();
  }

  function loop(now) {
    if (!isPlaying) return;
    currentSeconds = (now - startedAt) / 1000;
    if (currentSeconds >= state.duration) {
      currentSeconds = 0;
      startedAt = now;
      syncVideoPlayback(0, true, true);
    }
    syncVideoPlayback(currentSeconds, true, false);
    renderFrame(currentSeconds);
    updateTimeline();
    animationFrame = requestAnimationFrame(loop);
  }

  function play() {
    if (isPlaying || isRendering) return;
    isPlaying = true;
    playButton.classList.add('is-playing');
    playButton.setAttribute('aria-label','일시정지');
    startedAt = performance.now() - currentSeconds * 1000;
    syncVideoPlayback(currentSeconds, true, true);
    animationFrame = requestAnimationFrame(loop);
  }
  function pause() {
    isPlaying = false;
    cancelAnimationFrame(animationFrame);
    playButton.classList.remove('is-playing');
    playButton.setAttribute('aria-label','재생');
    pauseAllVideos();
  }
  function restart(autoplay = true) {
    pause(); currentSeconds = 0;
    syncVideoPlayback(0, false, true);
    renderFrame(0); updateTimeline();
    if (autoplay) play();
  }
  function updateTimeline() {
    timeline.value = String(Math.round((currentSeconds / state.duration) * 1000));
    $('#currentTime').textContent = formatTime(currentSeconds);
  }

  async function createClip(file) {
    const url = URL.createObjectURL(file);
    try {
      const isVideo = (file.type || '').startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
      if (isVideo) {
        const video = document.createElement('video');
        video.preload = 'metadata'; video.playsInline = true; video.loop = true; video.muted = mediaMuted;
        await new Promise((resolve, reject) => {
          let settled = false;
          const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            error ? reject(error) : resolve();
          };
          const ready = () => video.videoWidth && video.videoHeight && finish();
          const timeout = setTimeout(() => finish(new Error('영상 메타데이터 시간 초과')), 15000);
          video.onloadedmetadata = ready;
          video.oncanplay = ready;
          video.onerror = () => finish(new Error('지원하지 않는 영상 형식'));
          video.src = url;
          video.load();
        });
        return { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, type:'video', name:file.name, url, element:video };
      }

      // Safari에서는 Image.decode() 또는 off-DOM 이미지의 load 이벤트가 지연될 수 있습니다.
      // 이미지를 즉시 장면 목록에 넣고, 준비되는 순간 캔버스를 다시 그립니다.
      const image = new Image();
      image.decoding = 'async';
      const clip = { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, type:'image', name:file.name, url, element:image, loading:true, dataUrlFallback:false };
      const refreshPreview = () => {
        clip.loading = false;
        if (!clips.some(item => item.id === clip.id)) return;
        renderFrame(currentSeconds);
        renderSceneList();
      };
      image.onload = () => {
        if (image.naturalWidth && image.naturalHeight) refreshPreview();
      };
      image.onerror = () => {
        // 일부 iOS 환경에서 blob: URL을 캔버스가 읽지 못하는 경우 data URL로 한 번 더 시도합니다.
        if (!clip.dataUrlFallback && typeof FileReader !== 'undefined') {
          clip.dataUrlFallback = true;
          const reader = new FileReader();
          reader.onload = () => { image.src = reader.result; };
          reader.onerror = () => { clip.loading = false; refreshPreview(); toast(`${file.name}을 열지 못했어요.`); };
          reader.readAsDataURL(file);
          return;
        }
        clip.loading = false;
        refreshPreview();
        toast(`${file.name}을 열지 못했어요.`);
      };
      image.src = url;
      return clip;
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  function updateMediaSummary() {
    const photos = clips.filter(clip => clip.type === 'image').length;
    const videos = clips.length - photos;
    $('#uploadTitle').textContent = clips.length ? '사진·영상 더 추가' : '사진·영상 여러 개 선택';
    $('#uploadHelp').textContent = clips.length ? `현재 ${clips.length}개 · 사진 ${photos} · 영상 ${videos}` : '한 번에 여러 파일 선택 · 최대 20개';
    $('#sceneCount').textContent = `장면 ${clips.length}개`;
    $('#sceneList').hidden = clips.length === 0;
    emptyState.hidden = clips.length > 0;
  }

  function renderSceneList() {
    const strip = $('#sceneStrip');
    strip.replaceChildren();
    clips.forEach((clip, index) => {
      const card = document.createElement('article');
      card.className = `scene-card${index === activeClipIndex ? ' active' : ''}`;
      const previewButton = document.createElement('button');
      previewButton.className = 'scene-thumb'; previewButton.type = 'button'; previewButton.setAttribute('aria-label', `${index + 1}번 장면 미리보기`);
      const preview = clip.type === 'image' ? document.createElement('img') : document.createElement('video');
      preview.src = clip.url; preview.alt = clip.type === 'image' ? clip.name : '';
      if (clip.type === 'video') { preview.muted = true; preview.playsInline = true; preview.preload = 'metadata'; }
      const number = document.createElement('span'); number.className = 'scene-number'; number.textContent = String(index + 1);
      const type = document.createElement('span'); type.className = 'scene-type'; type.textContent = clip.loading ? 'LOADING' : (clip.type === 'video' ? 'VIDEO' : 'PHOTO');
      previewButton.append(preview, number, type);
      previewButton.addEventListener('click', () => seekToScene(index));
      const name = document.createElement('span'); name.className = 'scene-name'; name.textContent = clip.name; name.title = clip.name;
      const actions = document.createElement('div'); actions.className = 'scene-actions';
      const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '←'; previous.disabled = index === 0; previous.setAttribute('aria-label','앞으로 이동'); previous.addEventListener('click', () => moveScene(index, -1));
      const next = document.createElement('button'); next.type = 'button'; next.textContent = '→'; next.disabled = index === clips.length - 1; next.setAttribute('aria-label','뒤로 이동'); next.addEventListener('click', () => moveScene(index, 1));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.className = 'remove-scene'; remove.setAttribute('aria-label','장면 삭제'); remove.addEventListener('click', () => removeScene(index));
      actions.append(previous, next, remove); card.append(previewButton, name, actions); strip.append(card);
    });
    updateMediaSummary();
  }

  function applyRecommendedDuration() {
    const choices = [5,8,10,15,20,30];
    const needed = Math.min(30, Math.max(5, clips.length * 3));
    const recommended = choices.find(value => value >= needed) || 30;
    if (state.duration < recommended) {
      state.duration = recommended;
      $('#durationSelect').value = String(recommended);
      $('#totalTime').textContent = formatTime(recommended);
      save();
    }
  }

  async function loadMediaFiles(fileList) {
    const files = [...fileList].slice(0, Math.max(0, 20 - clips.length));
    if (!files.length) return clips.length >= 20 ? toast('장면은 최대 20개까지 추가할 수 있습니다.') : undefined;
    pause(); currentSeconds = 0;
    let failed = 0;
    const failedFiles = [];
    // 선택이 끝나는 즉시 화면에 장면을 등록합니다. 사진은 로딩 완료를 기다리지 않으므로
    // iPhone Safari에서도 빈 Aa 화면에 멈춰 보이지 않습니다.
    for (const file of files) {
      try { clips.push(await createClip(file)); }
      catch (error) {
        failed += 1;
        failedFiles.push(file.name);
        console.warn('미디어를 불러오지 못했습니다.', file.name, error);
      }
    }
    activeClipIndex = -1;
    applyRecommendedDuration(); renderSceneList(); syncVideoPlayback(0, false, true); renderFrame(0); updateTimeline();
    if (clips.length) toast(failed ? `${files.length - failed}개를 추가했습니다. ${failed}개는 열지 못했어요: ${failedFiles[0]}` : `${files.length}개 장면을 추가했습니다. 사진은 바로 미리보기에 표시됩니다.`);
    else toast(`선택한 파일을 열 수 없습니다: ${failedFiles[0] || '파일 형식을 확인해주세요.'}`);
  }

  function seekToScene(index) {
    if (!clips[index]) return;
    pause(); activeClipIndex = -1; currentSeconds = index * (state.duration / clips.length);
    syncVideoPlayback(currentSeconds, false, true); renderFrame(currentSeconds); updateTimeline(); renderSceneList();
  }

  function moveScene(index, direction) {
    const target = index + direction;
    if (!clips[index] || target < 0 || target >= clips.length) return;
    [clips[index], clips[target]] = [clips[target], clips[index]];
    seekToScene(target);
    toast('장면 순서를 바꿨습니다.');
  }

  function removeScene(index) {
    const [removed] = clips.splice(index, 1);
    if (removed?.type === 'video') removed.element.pause();
    if (removed?.url) URL.revokeObjectURL(removed.url);
    currentSeconds = 0; activeClipIndex = -1;
    renderSceneList(); renderFrame(0); updateTimeline();
    toast('장면을 삭제했습니다.');
  }

  function clearScenes() {
    pause(); clips.forEach(clip => { if (clip.type === 'video') clip.element.pause(); URL.revokeObjectURL(clip.url); });
    clips = []; activeClipIndex = -1; currentSeconds = 0;
    renderSceneList(); renderFrame(0); updateTimeline();
    toast('모든 장면을 비웠습니다.');
  }

  function selectPreset(name, update = true) {
    if (!presets[name]) {
      $$('.preset').forEach(button => {
        button.classList.remove('selected');
        button.setAttribute('aria-checked', 'false');
      });
      return;
    }
    state.preset = name;
    if (update) Object.assign(state, presets[name]);
    $$('.preset').forEach(button => {
      const selected = button.dataset.preset === name;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', String(selected));
    });
    if (update) { syncUI(); save(); renderFrame(currentSeconds); }
  }

  function selectColorFilter(name, update = true) {
    state.colorFilter = name;
    $$('.filter-card').forEach(button => {
      const selected = button.dataset.filter === name;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', String(selected));
    });
    if (update) { save(); renderFrame(currentSeconds); }
  }

  async function loadFont(file) {
    if (!file) return;
    try {
      customFontName = `LocalTitle${Date.now()}`;
      const face = new FontFace(customFontName, `url(${URL.createObjectURL(file)})`);
      await face.load(); document.fonts.add(face);
      const option = new Option(file.name.replace(/\.[^.]+$/, ''), customFontName, true, true);
      $('#fontSelect').add(option);
      state.font = customFontName;
      $('#fontUploadButton').textContent = file.name;
      renderFrame(currentSeconds);
      toast('내 서체를 적용했습니다.');
    } catch { toast('이 서체 파일을 불러올 수 없습니다.'); }
  }

  async function loadSubtitleFont(file) {
    if (!file) return;
    try {
      customSubtitleFontName = `LocalSubtitle${Date.now()}`;
      const face = new FontFace(customSubtitleFontName, `url(${URL.createObjectURL(file)})`);
      await face.load(); document.fonts.add(face);
      const option = new Option(file.name.replace(/\.[^.]+$/, ''), customSubtitleFontName, true, true);
      $('#subtitleFontSelect').add(option);
      state.subtitleFont = customSubtitleFontName;
      $('#subtitleFontUploadButton').textContent = file.name;
      renderFrame(currentSeconds);
      toast('로컬 자막 폰트를 적용했습니다.');
    } catch { toast('이 자막 폰트 파일을 불러올 수 없습니다.'); }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function exportImage() {
    if (!clips.length) return toast('먼저 사진이나 영상을 선택해 주세요.');
    renderFrame(currentSeconds || state.duration * .72);
    canvas.toBlob(blob => blob && downloadBlob(blob, `cine-title-${Date.now()}.jpg`), 'image/jpeg', .94);
    toast('현재 장면을 이미지로 저장했습니다.');
  }

  async function exportVideo() {
    if (!clips.length) return toast('먼저 사진이나 영상을 선택해 주세요.');
    if (!canvas.captureStream || !window.MediaRecorder) return toast('이 브라우저는 영상 저장을 지원하지 않습니다. 이미지 저장을 이용해 주세요.');
    const types = ['video/mp4;codecs=h264,aac','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
    const mimeType = types.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) return toast('이 기기에서 저장 가능한 영상 형식을 찾지 못했습니다.');
    pause(); isRendering = true;
    const badge = $('#renderBadge'); badge.hidden = false;
    $('#exportVideoButton').disabled = true;
    const stream = canvas.captureStream(30);
    const chunks = [];
    let recorder;
    try { recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 }); }
    catch { recorder = new MediaRecorder(stream, { mimeType }); }
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const complete = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start(250);
    syncVideoPlayback(0, true, true);
    const start = performance.now();
    await new Promise(resolve => {
      const step = now => {
        const elapsed = Math.min(state.duration, (now - start) / 1000);
        syncVideoPlayback(elapsed, true, false);
        renderFrame(elapsed);
        $('#renderPercent').textContent = `${Math.round(elapsed / state.duration * 100)}%`;
        if (elapsed < state.duration) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    pauseAllVideos();
    recorder.stop(); await complete;
    stream.getTracks().forEach(track => track.stop());
    const blob = new Blob(chunks, { type: mimeType });
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    downloadBlob(blob, `cine-title-${Date.now()}.${ext}`);
    badge.hidden = true; $('#exportVideoButton').disabled = false; isRendering = false;
    currentSeconds = 0; renderFrame(0); updateTimeline();
    toast(`${ext.toUpperCase()} 영상으로 저장했습니다.`);
  }

  function bind() {
    $$('.section-trigger').forEach(button => button.addEventListener('click', () => {
      const section = button.closest('.control-section');
      section.classList.toggle('open');
      button.setAttribute('aria-expanded', String(section.classList.contains('open')));
    }));
    ['#uploadButton','#stageUploadButton'].forEach(id => $(id).addEventListener('click', () => $('#mediaInput').click()));
    $('#mediaInput').addEventListener('change', event => { loadMediaFiles(event.target.files); event.target.value = ''; });
    $('#fontUploadButton').addEventListener('click', () => $('#fontInput').click());
    $('#fontInput').addEventListener('change', event => loadFont(event.target.files[0]));
    $('#subtitleFontUploadButton').addEventListener('click', () => $('#subtitleFontInput').click());
    $('#subtitleFontInput').addEventListener('change', event => { loadSubtitleFont(event.target.files[0]); event.target.value = ''; });
    playButton.addEventListener('click', () => isPlaying ? pause() : play());
    $('#restartButton').addEventListener('click', () => restart(true));
    $('#muteButton').addEventListener('click', () => {
      mediaMuted = !mediaMuted;
      clips.forEach(clip => { if (clip.type === 'video') clip.element.muted = mediaMuted; });
      $('#muteButton').classList.toggle('is-muted', mediaMuted);
      syncVideoPlayback(currentSeconds, isPlaying, false);
    });
    timeline.addEventListener('input', () => {
      pause(); currentSeconds = Number(timeline.value) / 1000 * state.duration;
      syncVideoPlayback(currentSeconds, false, true);
      renderFrame(currentSeconds); updateTimeline();
    });
    $('#ratioSelect').addEventListener('change', e => { state.ratio=e.target.value; setCanvasRatio(); save(); });
    $('#durationSelect').addEventListener('change', e => { state.duration=Number(e.target.value); currentSeconds=0; $('#totalTime').textContent=formatTime(state.duration); syncVideoPlayback(0,false,true); renderFrame(0); renderSceneList(); save(); });
    ['line1','line2','line3','line4'].forEach(id => $(`#${id}`).addEventListener('input', e => { state[id]=e.target.value; renderFrame(currentSeconds); save(); }));
    $('#fontSelect').addEventListener('change', e => { state.font=e.target.value; renderFrame(currentSeconds); save(); });
    $('#subtitleText').addEventListener('input', e => { state.subtitleText=e.target.value; renderFrame(currentSeconds); save(); });
    $('#subtitleToggle').addEventListener('change', e => { state.subtitleEnabled=e.target.checked; renderFrame(currentSeconds); save(); });
    $('#subtitleFontSelect').addEventListener('change', e => { state.subtitleFont=e.target.value; renderFrame(currentSeconds); save(); });
    $('#subtitleStyleSelect').addEventListener('change', e => { state.subtitleStyle=e.target.value; renderFrame(currentSeconds); save(); });
    $('#subtitleColorInput').addEventListener('input', e => { state.subtitleColor=e.target.value; renderFrame(currentSeconds); save(); });
    const ranges = { sizeRange:['size',false], yRange:['y',false], tiltRange:['tilt',false], lineSpacingRange:['lineSpacing',false], grainRange:['grain',true], vignetteRange:['vignette',true], warmthRange:['warmth',true], filterRange:['filterIntensity',false], filmOpacityRange:['filmOpacity',false], subtitleSizeRange:['subtitleSize',false], subtitleYRange:['subtitleY',false] };
    Object.entries(ranges).forEach(([id,[key,breakPreset]]) => $(`#${id}`).addEventListener('input', e => {
      state[key]=Number(e.target.value); if (breakPreset) state.preset='custom'; updateOutputs(); renderFrame(currentSeconds); save();
    }));
    $('#colorInput').addEventListener('input', e => { state.color=e.target.value; state.preset='custom'; renderFrame(currentSeconds); save(); });
    $('#shadowInput').addEventListener('input', e => { state.shadow=e.target.value; state.preset='custom'; renderFrame(currentSeconds); save(); });
    $('#filmColorInput').addEventListener('input', e => { state.filmColor=e.target.value; renderFrame(currentSeconds); save(); });
    $$('.preset').forEach(button => button.addEventListener('click', () => selectPreset(button.dataset.preset)));
    $$('.filter-card').forEach(button => button.addEventListener('click', () => selectColorFilter(button.dataset.filter)));
    $$('input[name="motion"]').forEach(input => input.addEventListener('change', e => {
      state.motion=e.target.value;
      restart(false);
      renderFrame(state.motion === 'gate' ? 0 : state.duration*.65);
      save();
    }));
    $('#kenBurnsToggle').addEventListener('change', e => { state.kenBurns=e.target.checked; renderFrame(currentSeconds); save(); });
    $('#resetButton').addEventListener('click', () => { state={...defaults}; syncUI(); save(); restart(false); toast('설정을 처음 상태로 돌렸습니다.'); });
    $('#exportImageButton').addEventListener('click', exportImage);
    $('#exportVideoButton').addEventListener('click', exportVideo);
    $('#clearScenesButton').addEventListener('click', clearScenes);
    window.addEventListener('beforeunload', () => clips.forEach(clip => URL.revokeObjectURL(clip.url)));
  }

  function registerWebMCP() {
    const modelContext = document.modelContext;
    if (!modelContext?.registerTool) return;
    try {
      modelContext.registerTool({
        name:'configure_title_sequence', title:'타이틀 시퀀스 설정',
        description:'현재 화면의 네 줄 타이틀, 글자색, 모션을 한 번에 설정합니다.',
        inputSchema:{type:'object',properties:{line1:{type:'string'},line2:{type:'string'},line3:{type:'string'},line4:{type:'string'},subtitleText:{type:'string'},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},motion:{type:'string',enum:['stagger','rise','zoom','gate']}},additionalProperties:false},
        annotations:{readOnlyHint:false,untrustedContentHint:false},
        execute(input){
          ['line1','line2','line3','line4','subtitleText','color','motion'].forEach(key => { if (input[key] !== undefined) state[key]=input[key]; });
          syncUI(); save(); renderFrame(currentSeconds);
          return {updated:true,title:[state.line1,state.line2,state.line3,state.line4].filter(Boolean).join(' '),motion:state.motion};
        }
      });
      modelContext.registerTool({
        name:'play_title_preview', title:'타이틀 미리보기 재생',
        description:'현재 오프닝 시퀀스 미리보기를 처음부터 재생합니다.',
        inputSchema:{type:'object',properties:{},additionalProperties:false}, annotations:{readOnlyHint:false,untrustedContentHint:false},
        execute(){ restart(true); return {playing:true,duration:state.duration}; }
      });
    } catch {}
  }

  document.fonts.ready.then(() => { titleInkCache.clear(); renderFrame(0); });
  syncUI(); bind(); registerWebMCP(); renderFrame(0); updateTimeline();
})();
