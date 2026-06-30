const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");

const distanceEl = document.querySelector("#distance");
const bestEl = document.querySelector("#best");
const statusEl = document.querySelector("#status");
const angleInput = document.querySelector("#angle");
const powerInput = document.querySelector("#power");
const angleFill = document.querySelector("#angleFill");
const angleLabel = document.querySelector("#angleLabel");
const swingButton = document.querySelector("#swingButton");
const resetButton = document.querySelector("#resetButton");

const W = canvas.width;
const H = canvas.height;
const groundY = 520;
const batter = { x: 148, y: groundY - 48 };
const spawn = { x: 248, y: 72 };

let bestRecord = loadBestRecord();
let best = bestRecord.distance;
let state;
let lastTime = performance.now();

const clouds = [
  { x: 80, y: 74, s: 1.08 },
  { x: 530, y: 108, s: 0.78 },
  { x: 880, y: 66, s: 0.95 },
];

function loadBestRecord() {
  const legacyBest = Number(localStorage.getItem("penguinBest") || 0);

  try {
    const saved = JSON.parse(localStorage.getItem("penguinBestRecord") || "null");
    if (saved && Number.isFinite(saved.distance)) {
      return {
        distance: Math.max(saved.distance, legacyBest),
        achievedAt: saved.achievedAt || null,
      };
    }
  } catch {
    // Ignore malformed local records and keep the best numeric score.
  }

  return {
    distance: legacyBest,
    achievedAt: legacyBest > 0 ? "legacy" : null,
  };
}

function saveBestRecord(distance) {
  bestRecord = {
    distance,
    achievedAt: new Date().toISOString(),
  };
  best = distance;
  localStorage.setItem("penguinBest", String(distance));
  localStorage.setItem("penguinBestRecord", JSON.stringify(bestRecord));
}

const sound = {
  ctx: null,
  master: null,
  flight: null,
  slide: null,
  enabled: false,
};

function ensureAudio() {
  if (!sound.ctx) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return false;
    sound.ctx = new AudioCtor();
    sound.master = sound.ctx.createGain();
    sound.master.gain.value = 0.58;
    sound.master.connect(sound.ctx.destination);
  }

  if (sound.ctx.state === "suspended") {
    sound.ctx.resume();
  }

  sound.enabled = true;
  return true;
}

function makeNoiseBuffer(duration = 1) {
  const length = Math.max(1, Math.floor(sound.ctx.sampleRate * duration));
  const buffer = sound.ctx.createBuffer(1, length, sound.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function playImpactSound(strength = 1) {
  if (!sound.enabled && !ensureAudio()) return;

  const now = sound.ctx.currentTime;
  const thump = sound.ctx.createOscillator();
  const thumpGain = sound.ctx.createGain();
  thump.type = "triangle";
  thump.frequency.setValueAtTime(175, now);
  thump.frequency.exponentialRampToValueAtTime(58, now + 0.11);
  thumpGain.gain.setValueAtTime(0.001, now);
  thumpGain.gain.exponentialRampToValueAtTime(1.08 * strength, now + 0.012);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  thump.connect(thumpGain).connect(sound.master);
  thump.start(now);
  thump.stop(now + 0.2);

  const crack = sound.ctx.createBufferSource();
  const crackFilter = sound.ctx.createBiquadFilter();
  const crackGain = sound.ctx.createGain();
  crack.buffer = makeNoiseBuffer(0.12);
  crackFilter.type = "bandpass";
  crackFilter.frequency.value = 1300;
  crackFilter.Q.value = 4.5;
  crackGain.gain.setValueAtTime(0.72 * strength, now);
  crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  crack.connect(crackFilter).connect(crackGain).connect(sound.master);
  crack.start(now);
  crack.stop(now + 0.13);
}

function playMissSound() {
  if (!sound.enabled && !ensureAudio()) return;

  const now = sound.ctx.currentTime;
  const source = sound.ctx.createBufferSource();
  const filter = sound.ctx.createBiquadFilter();
  const gain = sound.ctx.createGain();
  source.buffer = makeNoiseBuffer(0.24);
  filter.type = "highpass";
  filter.frequency.setValueAtTime(1100, now);
  filter.frequency.exponentialRampToValueAtTime(250, now + 0.22);
  gain.gain.setValueAtTime(0.22, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
  source.connect(filter).connect(gain).connect(sound.master);
  source.start(now);
  source.stop(now + 0.25);
}

function playBounceSound(force = 1) {
  if (!sound.enabled && !ensureAudio()) return;

  const now = sound.ctx.currentTime;
  const bounce = sound.ctx.createOscillator();
  const gain = sound.ctx.createGain();
  bounce.type = "sine";
  bounce.frequency.setValueAtTime(100, now);
  bounce.frequency.exponentialRampToValueAtTime(46, now + 0.1);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(0.58 * force, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
  bounce.connect(gain).connect(sound.master);
  bounce.start(now);
  bounce.stop(now + 0.2);
}

function startFlightSound() {
  if (!sound.enabled && !ensureAudio()) return;
  stopLoop("flight");

  const source = sound.ctx.createBufferSource();
  const filter = sound.ctx.createBiquadFilter();
  const gain = sound.ctx.createGain();
  source.buffer = makeNoiseBuffer(1.2);
  source.loop = true;
  filter.type = "bandpass";
  filter.frequency.value = 760;
  filter.Q.value = 0.7;
  gain.gain.value = 0.001;
  source.connect(filter).connect(gain).connect(sound.master);
  source.start();
  sound.flight = { source, filter, gain };
}

function startSlideSound() {
  if (!sound.enabled && !ensureAudio()) return;
  stopLoop("slide");

  const source = sound.ctx.createBufferSource();
  const filter = sound.ctx.createBiquadFilter();
  const gain = sound.ctx.createGain();
  source.buffer = makeNoiseBuffer(0.6);
  source.loop = true;
  filter.type = "lowpass";
  filter.frequency.value = 860;
  gain.gain.value = 0.001;
  source.connect(filter).connect(gain).connect(sound.master);
  source.start();
  sound.slide = { source, filter, gain };
}

function stopLoop(name) {
  const loop = sound[name];
  if (!loop) return;
  const now = sound.ctx.currentTime;
  loop.gain.gain.cancelScheduledValues(now);
  loop.gain.gain.setTargetAtTime(0.001, now, 0.04);
  loop.source.stop(now + 0.18);
  sound[name] = null;
}

function stopMovingSounds() {
  if (!sound.ctx) return;
  stopLoop("flight");
  stopLoop("slide");
}

function updateMovingSounds() {
  if (!sound.ctx || !sound.enabled || !state) return;
  const now = sound.ctx.currentTime;
  const speed = Math.abs(state.penguin.vx);

  if (sound.flight) {
    const flightVolume = state.mode === "flying" ? Math.min(0.34, 0.06 + speed / 2600) : 0.001;
    sound.flight.gain.gain.setTargetAtTime(flightVolume, now, 0.08);
    sound.flight.filter.frequency.setTargetAtTime(520 + Math.min(900, speed), now, 0.1);
  }

  if (sound.slide) {
    const slideVolume = state.mode === "sliding" ? Math.min(0.32, 0.04 + speed / 2100) : 0.001;
    sound.slide.gain.gain.setTargetAtTime(slideVolume, now, 0.08);
    sound.slide.filter.frequency.setTargetAtTime(430 + Math.min(620, speed * 0.8), now, 0.12);
  }
}

function resetGame() {
  stopMovingSounds();
  state = {
    mode: "falling",
    t: 0,
    swingT: 0,
    distance: 0,
    contactQuality: 0,
    bounceCount: 0,
    penguin: {
      x: spawn.x,
      y: spawn.y,
      vx: -10,
      vy: 170,
      rotation: 0,
      spin: 0,
      scale: 1,
    },
    message: "看準下落時機，按 Space 或揮棒",
    snowPuffs: [],
  };
  updateStats("準備");
}

function updateAngleUi() {
  const angle = Number(angleInput.value);
  const pct = ((angle - Number(angleInput.min)) / (Number(angleInput.max) - Number(angleInput.min))) * 100;
  angleFill.style.width = `${pct}%`;
  angleLabel.textContent = `${angle}°`;
}

function swing() {
  ensureAudio();

  if (state.mode === "falling") {
    const p = state.penguin;
    const dx = p.x - batter.x;
    const dy = p.y - (groundY - 88);
    const timing = Math.max(0, 1 - Math.hypot(dx - 82, dy) / 140);
    const angle = Number(angleInput.value) * Math.PI / 180;
    const power = Number(powerInput.value) / 100;

    state.swingT = 0.26;

    if (timing > 0.08) {
      const sweetSpot = 1 - Math.abs((Number(angleInput.value) - 36) / 48);
      const launch = (520 + timing * 560) * power * (0.82 + Math.max(0, sweetSpot) * 0.24);
      p.vx = Math.cos(angle) * launch;
      p.vy = -Math.sin(angle) * launch * (0.78 + timing * 0.22);
      p.spin = 5.4 + timing * 6;
      p.x = batter.x + 110;
      p.y = groundY - 118;
      state.contactQuality = timing;
      state.mode = "flying";
      state.message = timing > 0.72 ? "完美命中！" : timing > 0.42 ? "漂亮一擊！" : "擦到邊了，還能飛";
      playImpactSound(1 + timing * 0.55);
      startFlightSound();
      burst(p.x, p.y, timing);
      updateStats("飛行中");
    } else {
      state.message = "揮空了！企鵝落地前再試一次";
      playMissSound();
      updateStats("揮空");
    }
  } else if (state.mode === "settled") {
    resetGame();
  }
}

function burst(x, y, force) {
  for (let i = 0; i < 22; i += 1) {
    state.snowPuffs.push({
      x,
      y,
      vx: (Math.random() - 0.28) * 260 * force,
      vy: (Math.random() - 0.7) * 190 * force,
      r: 2 + Math.random() * 5,
      life: 0.65 + Math.random() * 0.35,
    });
  }
}

function update(dt) {
  state.t += dt;
  state.swingT = Math.max(0, state.swingT - dt);

  const p = state.penguin;
  if (state.mode === "falling") {
    p.y += p.vy * dt;
    p.x = spawn.x + Math.sin(state.t * 2.7) * 16;
    p.rotation = Math.sin(state.t * 5) * 0.18;

    if (p.y > groundY - 28) {
      state.message = "企鵝落地了，按重來再挑戰";
      state.mode = "settled";
      stopMovingSounds();
      playBounceSound(0.85);
      updateStats("落地");
      burst(p.x, groundY - 18, 0.65);
    }
  }

  if (state.mode === "flying") {
    p.vy += 520 * dt;
    p.vx *= 1 - 0.025 * dt;
    p.vy *= 1 - 0.012 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rotation += p.spin * dt;

    if (p.y > groundY - 28) {
      p.y = groundY - 28;
      if (Math.abs(p.vy) > 145 && p.vx > 72) {
        p.vy = -Math.abs(p.vy) * 0.34;
        p.vx *= 0.72;
        p.spin *= 0.62;
        state.bounceCount += 1;
        playBounceSound(Math.min(1.15, 0.35 + Math.abs(p.vy) / 360));
        burst(p.x, groundY - 18, 0.5);
        state.message = "彈了一下，繼續滑！";
      } else {
        state.mode = "sliding";
        p.vy = 0;
        p.spin = 0;
        p.slideRotation = p.rotation;
        stopLoop("flight");
        startSlideSound();
        state.message = "滑行中...";
        updateStats("滑行");
      }
    }
  }

  if (state.mode === "sliding") {
    p.x += p.vx * dt;
    p.vx = Math.max(0, p.vx - 95 * dt);
    const headFirstRotation = Math.PI / 2;
    const turn = Math.min(1, dt * 7);
    const delta = Math.atan2(
      Math.sin(headFirstRotation - p.slideRotation),
      Math.cos(headFirstRotation - p.slideRotation),
    );
    p.slideRotation += delta * turn;
    const snowWobble = Math.sin(state.t * 18) * Math.min(0.08, p.vx / 1800);
    p.rotation = p.slideRotation + snowWobble;
    if (p.vx <= 1) {
      state.mode = "settled";
      state.message = "完成！按 Space 或重來再玩一局";
      stopLoop("slide");
      updateStats("完成");
    }
  }

  state.distance = state.mode === "falling" ? 0 : Math.max(0, (p.x - batter.x - 104) / 4.2);
  if (state.distance > best) {
    saveBestRecord(state.distance);
  }

  for (const puff of state.snowPuffs) {
    puff.x += puff.vx * dt;
    puff.y += puff.vy * dt;
    puff.vy += 360 * dt;
    puff.life -= dt;
  }
  state.snowPuffs = state.snowPuffs.filter((puff) => puff.life > 0);

  distanceEl.textContent = `${state.distance.toFixed(1)} m`;
  bestEl.textContent = `${best.toFixed(1)} m`;
  updateMovingSounds();
}

function updateStats(status) {
  statusEl.textContent = status;
  bestEl.textContent = `${best.toFixed(1)} m`;
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawSky();
  drawWorld();
  drawTrajectoryMarkers();
  drawBatter();
  drawPenguin(state.penguin);
  drawPuffs();
  drawMessage();
}

function drawSky() {
  const grad = ctx.createLinearGradient(0, 0, 0, groundY);
  grad.addColorStop(0, "#9ed9ff");
  grad.addColorStop(0.58, "#e8f7ff");
  grad.addColorStop(1, "#f8fdff");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(255,255,255,0.78)";
  for (const cloud of clouds) {
    drawCloud(cloud.x - (state.t * 12 * cloud.s) % 1180, cloud.y, cloud.s);
    drawCloud(cloud.x + 1180 - (state.t * 12 * cloud.s) % 1180, cloud.y, cloud.s);
  }

  ctx.fillStyle = "#7db5d9";
  ctx.beginPath();
  ctx.moveTo(0, groundY - 68);
  ctx.lineTo(160, groundY - 170);
  ctx.lineTo(300, groundY - 70);
  ctx.lineTo(470, groundY - 188);
  ctx.lineTo(690, groundY - 62);
  ctx.lineTo(900, groundY - 155);
  ctx.lineTo(W, groundY - 80);
  ctx.lineTo(W, groundY);
  ctx.lineTo(0, groundY);
  ctx.closePath();
  ctx.fill();
}

function drawCloud(x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.ellipse(0, 18, 46, 18, 0, 0, Math.PI * 2);
  ctx.ellipse(35, 10, 34, 22, 0, 0, Math.PI * 2);
  ctx.ellipse(-34, 12, 30, 20, 0, 0, Math.PI * 2);
  ctx.ellipse(2, 0, 34, 25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWorld() {
  ctx.fillStyle = "#f8fcff";
  ctx.fillRect(0, groundY, W, H - groundY);

  ctx.strokeStyle = "rgba(8, 122, 143, 0.22)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i += 1) {
    const x = i * 110 - (state.distance * 3.1) % 110;
    ctx.beginPath();
    ctx.moveTo(x, groundY + 28);
    ctx.quadraticCurveTo(x + 42, groundY + 18, x + 86, groundY + 28);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(23,32,51,0.1)";
  ctx.fillRect(0, groundY - 2, W, 4);
}

function drawTrajectoryMarkers() {
  ctx.save();
  ctx.fillStyle = "rgba(23,32,51,0.38)";
  ctx.font = "700 13px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  for (let m = 50; m <= 250; m += 50) {
    const x = batter.x + 104 + m * 4.2 - state.distance * 4.2;
    if (x > 250 && x < W - 20) {
      ctx.fillRect(x, groundY - 12, 2, 16);
      ctx.fillText(`${m}m`, x, groundY - 18);
    }
  }
  ctx.restore();
}

function drawBatter() {
  const swing = state.swingT > 0 ? Math.sin((state.swingT / 0.26) * Math.PI) : 0;
  ctx.save();
  ctx.translate(batter.x, batter.y);

  ctx.fillStyle = "#1e2a42";
  ctx.beginPath();
  ctx.arc(0, -54, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f4f7fb";
  ctx.beginPath();
  ctx.ellipse(0, -22, 20, 32, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#1e2a42";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-8, 6);
  ctx.lineTo(-22, 44);
  ctx.moveTo(10, 4);
  ctx.lineTo(28, 42);
  ctx.stroke();

  ctx.rotate(-0.72 + swing * 1.3);
  ctx.strokeStyle = "#8d5531";
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(12, -44);
  ctx.lineTo(116, -88);
  ctx.stroke();
  ctx.strokeStyle = "#563119";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(22, -48);
  ctx.lineTo(52, -60);
  ctx.stroke();
  ctx.restore();
}

function drawPenguin(p) {
  ctx.save();
  ctx.translate(p.x - state.distance * 4.2, p.y);
  ctx.rotate(p.rotation);
  ctx.scale(p.scale, p.scale);

  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.beginPath();
  ctx.ellipse(0, 35, 32, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#172033";
  ctx.beginPath();
  ctx.ellipse(0, 0, 30, 43, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#fff8ed";
  ctx.beginPath();
  ctx.ellipse(4, 8, 20, 29, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#172033";
  ctx.beginPath();
  ctx.ellipse(-22, 4, 9, 25, -0.55, 0, Math.PI * 2);
  ctx.ellipse(23, 2, 9, 24, 0.55, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f0a52b";
  ctx.beginPath();
  ctx.moveTo(-8, -18);
  ctx.lineTo(18, -11);
  ctx.lineTo(-8, -4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(-8, -23, 7, 0, Math.PI * 2);
  ctx.arc(9, -24, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#172033";
  ctx.beginPath();
  ctx.arc(-6, -22, 3, 0, Math.PI * 2);
  ctx.arc(11, -23, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f0a52b";
  ctx.beginPath();
  ctx.ellipse(-13, 40, 13, 5, 0.15, 0, Math.PI * 2);
  ctx.ellipse(15, 40, 13, 5, -0.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawPuffs() {
  for (const puff of state.snowPuffs) {
    ctx.globalAlpha = Math.max(0, puff.life);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(puff.x - state.distance * 4.2, puff.y, puff.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawMessage() {
  const compact = window.innerWidth <= 760;
  const messageX = compact ? 12 : 24;
  const messageY = compact ? 76 : 104;
  const messageWidth = compact ? 260 : 376;
  const messageHeight = compact ? 54 : 72;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.strokeStyle = "rgba(23,32,51,0.12)";
  ctx.lineWidth = 1;
  roundRect(ctx, messageX, messageY, messageWidth, messageHeight, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#172033";
  ctx.font = `${compact ? 14 : 22}px Segoe UI, Noto Sans TC, sans-serif`;
  ctx.fillText(state.message, messageX + (compact ? 12 : 20), messageY + (compact ? 32 : 40));

  if (state.mode === "falling" && !compact) {
    ctx.fillStyle = "rgba(8,122,143,0.75)";
    ctx.font = "700 14px Segoe UI, Noto Sans TC, sans-serif";
    ctx.fillText("越接近球棒甜蜜點，初速越高；角度太高或太低都會少飛一點。", 44, messageY + 61);
  }
  ctx.restore();
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

angleInput.addEventListener("input", updateAngleUi);
swingButton.addEventListener("click", swing);
resetButton.addEventListener("click", resetGame);
canvas.addEventListener("pointerdown", swing);
window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    swing();
  }
  if (event.key.toLowerCase() === "r") {
    resetGame();
  }
});

updateAngleUi();
resetGame();
requestAnimationFrame(loop);
