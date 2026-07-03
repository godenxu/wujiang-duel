/* ============================================================
 *  音频系统 — 纯 Web Audio 程序化生成 8-bit 芯片音乐(chiptune)
 *  仿 FC/NES (2A03) 音色：2 路方波 + 三角波贝斯 + 噪声鼓
 *  曲目为原创的「武将单挑」战斗进行曲，营造三国志II霸王的大陆风格氛围
 *  （非任何既有乐曲的复制）。
 * ============================================================ */

const AudioSystem = (() => {
  let ctx = null, masterGain = null, musicGain = null, sfxGain = null;
  let musicTimer = null, musicOn = true, sfxOn = true;
  let step = 0;

  function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain(); masterGain.gain.value = 0.9; masterGain.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.34; musicGain.connect(masterGain);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.6; sfxGain.connect(masterGain);
  }

  const SEMI = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11, Bb: 10 };
  function freq(n) {
    const name = n.replace(/[0-9]/g, ""), oct = +n.replace(/[^0-9]/g, "");
    const semis = SEMI[name] - 9 + (oct - 4) * 12;
    return 440 * Math.pow(2, semis / 12);
  }

  /* ---- 芯片音色：方波/三角波，带 NES 风格阶梯包络 ---- */
  function voice(type, f, start, dur, gain, target) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    o.connect(g); g.connect(target || musicGain);
    const t = ctx.currentTime + start, d = Math.max(0.04, dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.setValueAtTime(gain, t + d - 0.03);
    g.gain.linearRampToValueAtTime(0.0001, t + d);
    o.start(t); o.stop(t + d + 0.02);
  }
  function noise(start, dur, gain, type, fc, target) {
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const dat = buf.getChannelData(0);
    for (let i = 0; i < n; i++) dat[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter(); filt.type = type || "highpass"; filt.frequency.value = fc || 6000;
    const g = ctx.createGain(); const t = ctx.currentTime + start;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    src.connect(filt); filt.connect(g); g.connect(target || musicGain);
    src.start(t); src.stop(t + dur);
  }
  /* NES 鼓：kick(三角+低噪) / snare(噪) / hat(高噪) */
  function kick(start, gain) {
    const t = ctx.currentTime + start;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g); g.connect(musicGain); o.start(t); o.stop(t + 0.14);
    noise(start, 0.04, gain * 0.4, "lowpass", 300, musicGain);
  }
  function snare(start, gain) { noise(start, 0.12, gain, "highpass", 1400, musicGain); }
  function hat(start, gain) { noise(start, 0.03, gain, "highpass", 9000, musicGain); }

  /* ---- 原创战斗进行曲：D 小调，8 小节，每小节 16 个十六分音符 ----
     和声 (i-VI-VII-V) ：Dm  Bb  C  A | Dm  Gm  A  Dm */
  const CH = [
    { root: "D2", tri: ["D3", "A3"] },   // Dm
    { root: "A#1", tri: ["D3", "F3"] },  // Bb -> A#1 = Bb1
    { root: "C2", tri: ["E3", "G3"] },   // C
    { root: "A1", tri: ["C#3", "E3"] },  // A (大调属和弦)
    { root: "D2", tri: ["D3", "A3"] },   // Dm
    { root: "G1", tri: ["A#2", "D3"] },  // Gm
    { root: "A1", tri: ["C#3", "E3"] },  // A
    { root: "D2", tri: ["D3", "A3"] },   // Dm
  ];
  // 贝斯：三角波 8 分音符奔腾分解和弦（马蹄律动）
  const BASS_ARP = [
    ["D2", "A2", "D3", "A2", "D2", "A2", "D3", "A2"],
    ["A#1", "F2", "A#2", "F2", "A#1", "F2", "A#2", "F2"],
    ["C2", "G2", "C3", "G2", "C2", "G2", "C3", "G2"],
    ["A1", "E2", "A2", "E2", "A1", "E2", "A2", "E2"],
    ["D2", "A2", "D3", "A2", "D2", "A2", "D3", "A2"],
    ["G1", "D2", "G2", "D2", "G1", "D2", "G2", "D2"],
    ["A1", "E2", "A2", "E2", "A1", "E2", "A2", "C#3"],
    ["D2", "A2", "D3", "A2", "F2", "A2", "D3", "A2"],
  ];
  // 主旋律(方波1) [步, 音名, 时值步]
  const LEAD = [
    [[0,"A4",2],[2,"D5",2],[4,"C5",1],[5,"A4",1],[6,"F4",2],[10,"A4",2],[14,"D5",2]],
    [[0,"D5",2],[2,"A#4",2],[4,"F4",2],[8,"A#4",4],[12,"D5",2]],
    [[0,"E5",2],[2,"C5",2],[4,"G4",2],[8,"E4",1],[9,"G4",1],[10,"C5",4]],
    [[0,"E5",2],[2,"C#5",2],[4,"A4",2],[8,"A4",4],[12,"C#5",2]],
    [[0,"A4",2],[2,"D5",2],[4,"F5",2],[8,"D5",2],[10,"C5",2],[12,"A4",2]],
    [[0,"D5",2],[2,"A#4",2],[4,"G4",2],[8,"A#4",2],[10,"D5",4]],
    [[0,"E5",2],[2,"C#5",2],[4,"E5",2],[8,"A5",4],[12,"G5",2]],
    [[0,"F5",2],[2,"E5",2],[4,"D5",4],[8,"A4",2],[10,"C#5",2],[12,"D5",4]],
  ];
  // 和声(方波2)：每拍点缀和弦三度音
  const HARM_STEPS = [0, 4, 8, 12];
  const KICK = [0, 4, 8, 11, 12];
  const SNARE = [4, 12];
  const HAT = [2, 6, 10, 14];
  const BPM = 148;
  const SIX = 60000 / BPM / 4;

  function tick() {
    if (!musicOn || !ctx) return;
    const bar = Math.floor(step / 16) % 8;
    const s = step % 16;
    const ch = CH[bar];
    const secs = SIX / 1000;

    // 旋律
    for (const [ms, note, dur] of LEAD[bar]) if (ms === s) voice("square", freq(note), 0, dur * secs * 0.96, 0.13);
    // 和声方波2（低八度三度音）
    if (HARM_STEPS.includes(s)) { const h = ch.tri[(s / 4) % ch.tri.length]; voice("square", freq(h), 0, secs * 3.5, 0.05); }
    // 贝斯三角波（8 分音符）
    if (s % 2 === 0) voice("triangle", freq(BASS_ARP[bar][s / 2]), 0, secs * 1.9, 0.16);
    // 鼓
    if (KICK.includes(s)) kick(0, 0.5);
    if (SNARE.includes(s)) snare(0, 0.22);
    if (HAT.includes(s)) hat(0, 0.05);
    // 第 8 小节过门
    if (bar === 7 && (s === 14 || s === 15)) snare(0, 0.18);

    step++;
  }

  function startMusic() { ensure(); if (musicTimer) return; step = 0; tick(); musicTimer = setInterval(tick, SIX); }
  function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

  /* ---- 8-bit 音效 ---- */
  const SFX = {
    select() { if (sfxOn) { ensure(); voice("square", 880, 0, 0.07, 0.18, sfxGain); voice("square", 1320, 0.05, 0.06, 0.14, sfxGain); } },
    swing() { if (sfxOn) { ensure(); noise(0, 0.09, 0.28, "highpass", 3500, sfxGain); } },
    hit() {
      if (!sfxOn) return; ensure();
      noise(0, 0.12, 0.4, "lowpass", 1200, sfxGain);
      const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.1);
      g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.14);
    },
    guard() { if (sfxOn) { ensure(); voice("square", 1500, 0, 0.05, 0.2, sfxGain); voice("square", 1100, 0.05, 0.06, 0.15, sfxGain); } },
    crit() {
      if (!sfxOn) return; ensure();
      noise(0, 0.18, 0.5, "lowpass", 900, sfxGain);
      const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
      g.gain.setValueAtTime(0.38, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.22);
      voice("square", 1760, 0.02, 0.12, 0.16, sfxGain);
    },
    charge() { if (sfxOn) { ensure(); const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = "square"; o.frequency.setValueAtTime(180, t); o.frequency.linearRampToValueAtTime(720, t + 0.4); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45); o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.45); } },
    gallop() { if (sfxOn) { ensure(); noise(0, 0.05, 0.18, "lowpass", 250, sfxGain); } },
    ko() { if (!sfxOn) return; ensure(); noise(0, 0.4, 0.5, "lowpass", 600, sfxGain); ["D4", "A3", "D3"].forEach((n, i) => voice("square", freq(n), i * 0.1, 0.35, 0.28, sfxGain)); },
    victory() { if (!sfxOn) return; ensure(); ["D5", "F5", "A5", "D6"].forEach((n, i) => { voice("square", freq(n), i * 0.12, 0.45, 0.22, sfxGain); voice("triangle", freq(n.replace(/\d/, m => +m - 1)), i * 0.12, 0.45, 0.14, sfxGain); }); },
  };

  /* ---- 文件背景乐（用户自备 OST）+ 缺失时回退芯片乐 ---- */
  let bgmEl = null, curBgm = { type: "chip", src: null };
  function ensureBgm() {
    if (bgmEl) return;
    bgmEl = new Audio();
    bgmEl.loop = true; bgmEl.volume = 0.55; bgmEl.preload = "auto";
    // 文件缺失/出错 → 回退芯片音乐
    bgmEl.addEventListener("error", () => { if (curBgm.type === "file") { curBgm = { type: "chip", src: null }; if (musicOn) startMusic(); } });
  }
  // 播放指定 mp3（循环）；同一曲不重播
  function playFile(src) {
    ensure(); ensureBgm();
    if (curBgm.type === "file" && curBgm.src === src) { if (musicOn) bgmEl.play().catch(() => {}); return; }
    stopMusic();
    curBgm = { type: "file", src };
    bgmEl.src = src;
    if (musicOn) bgmEl.play().catch(() => {});
  }
  // 回到程序化芯片音乐
  function playChip() {
    ensure();
    if (bgmEl) bgmEl.pause();
    curBgm = { type: "chip", src: null };
    if (musicOn) startMusic();
  }

  return {
    init() { ensure(); if (ctx.state === "suspended") ctx.resume(); if (musicOn && curBgm.type === "chip") startMusic(); },
    resume() { if (ctx && ctx.state === "suspended") ctx.resume(); if (musicOn && curBgm.type === "file" && bgmEl) bgmEl.play().catch(() => {}); },
    sfx: SFX,
    playFile, playChip,
    toggleMusic(on) {
      musicOn = on;
      if (!on) { stopMusic(); if (bgmEl) bgmEl.pause(); }
      else if (curBgm.type === "file" && bgmEl) bgmEl.play().catch(() => startMusic());
      else startMusic();
    },
    toggleSfx(on) { sfxOn = on; },
    isMusicOn: () => musicOn,
    isSfxOn: () => sfxOn,
  };
})();
