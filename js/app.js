/* ============================================================
 *  中日武将大单挑 — 主程序 / UI 控制
 * ============================================================ */
(() => {
  "use strict";

  const DB_KEY = "wujiang_db_v1";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------------- 数据库（localStorage 持久化，可增删改） ---------------- */
  const DB = {
    list: [],
    load() {
      const saved = localStorage.getItem(DB_KEY);
      if (saved) {
        try { this.list = JSON.parse(saved); }
        catch { this.list = clone(ALL_GENERALS); }
      } else {
        this.list = clone(ALL_GENERALS);
      }
      // 默认卡池扩充后按姓名合并进老存档，使新增武将对已有玩家生效
      const have = new Set(this.list.map(g => g.name));
      const missing = ALL_GENERALS.filter(g => !have.has(g.name));
      if (missing.length) {
        let nid = this.list.reduce((m, g) => Math.max(m, g.id), 0) + 1;
        missing.forEach(g => this.list.push(Object.assign(clone(g), { id: nid++ })));
        if (saved) this.save();
      }
      this._nextId = this.list.reduce((m, g) => Math.max(m, g.id), 0) + 1;
    },
    save() { localStorage.setItem(DB_KEY, JSON.stringify(this.list)); },
    bySide(side) { return this.list.filter(g => g.side === side); },
    get(id) { return this.list.find(g => g.id === id); },
    add(g) { g.id = this._nextId++; this.list.push(g); this.save(); return g; },
    update(id, data) { const g = this.get(id); if (g) Object.assign(g, data); this.save(); },
    remove(id) { this.list = this.list.filter(g => g.id !== id); this.save(); },
    resetDefault() { this.list = clone(ALL_GENERALS); this._nextId = this.list.length + 1; this.save(); },
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------------- 通用工具 ---------------- */
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove("show"), 1800);
  }
  function avatarChar(name) { return name[0]; }
  function hpColor(ratio) { return ratio > 0.5 ? "var(--hp-good)" : ratio > 0.22 ? "var(--hp-mid)" : "var(--hp-low)"; }

  /* 六维评级：SS≥100 S≥95 A≥90 B≥80 C≥70 D≥60 E<60 */
  function rateLetter(v) {
    if (v >= 100) return "SS";
    if (v >= 95) return "S";
    if (v >= 90) return "A";
    if (v >= 80) return "B";
    if (v >= 70) return "C";
    if (v >= 60) return "D";
    return "E";
  }
  const DIMS = [["ti", "体力"], ["wu", "武力"], ["tong", "统帅"], ["zhi", "智力"], ["zheng", "政治"], ["mei", "魅力"]];
  function sumStats(g) { return g.ti + g.wu + g.tong + g.zhi + g.zheng + g.mei; }
  function gradeChip(v) { const r = rateLetter(v); return `<span class="g grade-${r}">${r}</span>`; }
  // 武将评分 = 六维之和 + 单项突出加成（每项达 A 及以上：(该项数值-90)×5，未达 A 不加分）
  function ratingScore(g) {
    let s = sumStats(g);
    DIMS.forEach(([k]) => { s += Math.max(0, (g[k] - 90) * 5); });
    return s;
  }
  // 武将评级：武将评分（含突出加成）÷6，再套用与单项相同的评级阈值
  function warriorRating(g) { return rateLetter(Math.round(ratingScore(g) / 6)); }
  function ratingChip(g) { const r = warriorRating(g); return `<span class="g grade-${r}">${r}</span>`; }
  const GRADE_COLOR = { SS: "#f4c430", S: "#ff4d3d", A: "#ff9020", B: "#3b9aff", C: "#46c357", D: "#c7923f", E: "#b0705a" };
  function gradeColor(v) { return GRADE_COLOR[rateLetter(v)]; }

  const BGM = {
    select: "assets/bgm/player_select.mp3",   // 选将
    battle: "assets/bgm/single_combat.mp3",   // 单挑
    war: "assets/bgm/tactics.mp3",            // 阵营大战
    cup: "assets/bgm/tactics.mp3",            // 世界杯（沿用战术曲）
    teamwar: "assets/bgm/tactics.mp3",        // 组队大战（沿用战术曲）
  };
  function showScreen(id) {
    $$(".screen").forEach(s => s.classList.remove("active"));
    $("#screen-" + id).classList.add("active");
    if (id !== "battle" && typeof Duel !== "undefined" && Duel.stop) Duel.stop();
    // 按界面切换背景乐：指定界面用 OST，其余回退芯片乐
    if (BGM[id]) AudioSystem.playFile(BGM[id]);
    else AudioSystem.playChip();
    AudioSystem.resume();
  }

  /* ---------------- 弹窗 ---------------- */
  const overlay = $("#overlay");
  function openOverlay(html) { $("#overlay-content").innerHTML = html; overlay.classList.add("show"); }
  function closeOverlay() { overlay.classList.remove("show"); }
  overlay.addEventListener("click", e => { if (e.target === overlay) closeOverlay(); });

  /* ---------------- 雷达图 (SVG) ---------------- */
  function radarSVG(g, size = 200) {
    const dims = [["武力", g.wu], ["统帅", g.tong], ["智力", g.zhi], ["政治", g.zheng], ["魅力", g.mei], ["体力", g.ti]];
    const cx = size / 2, cy = size / 2, R = size * 0.36, n = dims.length, max = 120;
    const pt = (i, r) => {
      const ang = -Math.PI / 2 + i * 2 * Math.PI / n;
      return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    };
    let grid = "";
    for (let g2 = 1; g2 <= 4; g2++) {
      const pts = dims.map((_, i) => pt(i, R * g2 / 4).join(",")).join(" ");
      grid += `<polygon points="${pts}" fill="none" stroke="rgba(90,74,48,.25)" stroke-width="1"/>`;
    }
    let axes = "", labels = "";
    dims.forEach((d, i) => {
      const [x, y] = pt(i, R);
      axes += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(90,74,48,.25)"/>`;
      const [lx, ly] = pt(i, R + 16);
      labels += `<text x="${lx}" y="${ly}" font-size="11" fill="#5a4a30" text-anchor="middle" dominant-baseline="middle">${d[0]}</text>`;
    });
    const dataPts = dims.map((d, i) => pt(i, R * Math.min(1, d[1] / max)).join(",")).join(" ");
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      ${grid}${axes}
      <polygon points="${dataPts}" fill="rgba(193,39,45,.35)" stroke="var(--cn-red)" stroke-width="2"/>
      ${labels}</svg>`;
  }

  function showDetail(g, opts = {}) {
    // 友谊面板：有自选武将(角色扮演)且对象是库中武将时显示
    let bondHtml = "";
    const bondable = RPG.char && g.id !== -1 && DB.get(g.id);
    if (bondable) {
      const p = Bond.pts(g.id), lv = Bond.levelName(p), next = Bond.nextThreshold(p);
      const inTeam = Bond.inTeam(g.id);
      const pct = Math.min(100, p / 250 * 100);
      const recruitLbl = inTeam ? "✓ 已在队中"
        : p >= 250 ? "🤝 招募入队（免费）"
        : p >= 150 ? `🤝 招募入队（${Bond.recruitCost(g)} 金）`
        : "🔒 挚友后可招募";
      bondHtml = `<div class="bond-box">
        <div class="bond-line">友谊 <b>${p}</b> · ${lv}${next ? `（还差 ${next - p} 至下一级）` : "（已至最高）"} · 💰 ${Bond.gold()} 金</div>
        <div class="bond-track"><span class="bond-fill" style="width:${pct}%"></span></div>
        <div class="bond-gifts">
          ${Bond.GIFTS.map(x => `<button class="gift-btn" data-g="${x.k}">${x.icon} ${x.n} <small>${x.cost}金 +${x.add}</small></button>`).join("")}
          <button class="gift-btn recruit ${inTeam || p < 150 ? "dim" : ""}" id="bond-recruit">${recruitLbl}</button>
        </div>
      </div>`;
    }
    const html = `<div class="result-card detail-card">
      <div class="winner-av" style="background:${g.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)'}">${avatarChar(g.name)}</div>
      <div class="wname">${g.name}</div>
      <div style="font-size:13px;color:#8a6d3b;margin-top:2px">${g.title || ''}</div>
      <div class="wdesc">${g.intro || ''}</div>
      ${bondHtml}
      <div class="radar-wrap">${radarSVG(g)}</div>
      <div class="overall-line">武将评分 <b class="ov-sum">${ratingScore(g)}</b> <span class="ov-num">(六维 ${sumStats(g)} + 突出加成 ${Math.round(ratingScore(g) - sumStats(g))})</span> · 武将评级 ${ratingChip(g)}</div>
      <div class="stat-rows">${statRow('体力', g.ti)}${statRow('武力', g.wu)}${statRow('统帅', g.tong)}${statRow('智力', g.zhi)}${statRow('政治', g.zheng)}${statRow('魅力', g.mei)}</div>
      <div class="btns">
        ${opts.pickable ? `<button class="btn-primary" id="detail-pick">选他出战</button>` : ''}
        <button class="btn-ghost" id="detail-close">关闭</button>
      </div>
    </div>`;
    openOverlay(html);
    $("#detail-close").onclick = closeOverlay;
    if (opts.pickable) $("#detail-pick").onclick = () => { closeOverlay(); opts.onPick(g); };
    if (bondable) {
      $$(".gift-btn[data-g]").forEach(b => b.onclick = () => { if (Bond.gift(g, b.dataset.g)) showDetail(g, opts); });
      $("#bond-recruit").onclick = () => { if (Bond.recruit(g)) showDetail(g, opts); };
    }
  }
  function statRow(lbl, val) {
    return `<div class="stat-row"><span class="lbl">${lbl}</span>
      <span class="track"><span class="bar" style="width:${Math.min(100, val / 1.2)}%;background:${gradeColor(val)}"></span></span>
      <span class="val">${val}</span>${gradeChip(val)}</div>`;
  }

  /* ============================================================
   *  选将界面
   * ============================================================ */
  const SelectUI = {
    mode: "classic",
    side: "cn",
    picks: [],     // 选中的武将（classic 需2个，gauntlet 需1个）
    need: 2,

    open(mode) {
      this.mode = mode; this.picks = []; this.side = "cn";
      this.need = mode === "classic" ? 2 : (mode === "cup" ? Tournament.size : (mode === "team" ? 10 : (mode === "duo" ? 4 : 1)));
      const titles = { classic: "经典单挑 · 选择双将", gauntlet: "车轮大战 · 选你的主将", tower: "百人斩 · 选你的登塔勇士", duo: "2v2 · 选主副将（共4人）", cup: `世界杯 · 选 ${Tournament.size} 将`, team: "组队大战 · 选择己方阵容（最多10人）" };
      $("#select-title").textContent = titles[mode] || "选择武将";
      const towerBest = mode === "tower" ? Tower.best() : null;
      const hints = {
        classic: "依次点选两名武将（可同阵营）· 或点「随机双将」· 点 ⓘ 查看六维属性",
        gauntlet: "选一名主将连斩群雄 · 点 ⓘ 查看六维属性",
        tower: "一将无尽爬塔：守将逐层增强，胜后小回体力，每5层三选一机缘" + (towerBest ? ` · 历史最佳 ${towerBest.best} 层（${towerBest.hero}）` : ""),
        duo: "依次点选：①我方主将 ②我方副将 ③敌方主将 ④敌方副将 · 副将六维15%并入主将，危急时驰援一次",
        cup: `点选参赛武将（最多 ${Tournament.size} 名）· 不足将随机补满`,
        team: "先选阵营 tab，再点选最多10名武将（固定三国/战国对战）· 不足将随机补满，AI 另组一队应战",
      };
      $("#select-hint").textContent = hints[mode] || "";
      // 「随机双将」仅经典单挑可用
      $("#select-random").style.display = mode === "classic" ? "" : "none";
      $("#cn-count").textContent = DB.bySide("cn").length;
      $("#jp-count").textContent = DB.bySide("jp").length;
      $("#select-search").value = "";

      this.render();
      this.updateBar();
      showScreen("select");
    },
    // 经典单挑：随机抽取两名武将直接开战
    randomPick() {
      const all = DB.list;
      if (all.length < 2) return;
      const a = all[Math.floor(Math.random() * all.length)];
      let b; do { b = all[Math.floor(Math.random() * all.length)]; } while (b.id === a.id);
      this.picks = [a, b];
      AudioSystem.sfx.select();
      startClassicBattle(a, b, false);
    },
    setSide(side) {
      this.side = side;
      // 组队大战固定单一阵营出战：切换阵营视为重新选人
      if (this.mode === "team") this.picks = [];
      $$(".side-tab", $("#screen-select")).forEach(t => t.classList.toggle("active", t.dataset.side === side));
      this.render();
      this.updateBar();
    },
    render() {
      const kw = $("#select-search").value.trim();
      let arr = DB.bySide(this.side);
      if (kw) arr = arr.filter(g => g.name.includes(kw) || (g.title || "").includes(kw));
      arr.sort((a, b) => b.wu - a.wu);
      const grid = $("#select-grid");
      grid.innerHTML = arr.map(g => {
        const idx = this.picks.findIndex(p => p.id === g.id);
        return `<div class="card ${g.side} ${idx >= 0 ? 'selected' : ''}" data-id="${g.id}">
          <span class="cinfo" data-info>ⓘ</span>
          ${idx >= 0 ? `<span class="selnum">${idx + 1}</span>` : ''}
          <div class="avatar">${avatarChar(g.name)}</div>
          <div class="cname">${g.name}</div>
          <div class="cwu">武 ${g.wu} · 统 ${g.tong}</div>
        </div>`;
      }).join("") || `<div class="empty">无匹配武将</div>`;

      $$(".card", grid).forEach(c => {
        const id = +c.dataset.id;
        c.addEventListener("click", e => {
          if (e.target.closest("[data-info]")) { e.stopPropagation(); showDetail(DB.get(id), { pickable: true, onPick: g => this.toggle(g.id) }); return; }
          this.toggle(id);
        });
        c.addEventListener("contextmenu", e => { e.preventDefault(); showDetail(DB.get(id)); });
      });
    },
    toggle(id) {
      AudioSystem.sfx.select();
      const g = DB.get(id);
      const idx = this.picks.findIndex(p => p.id === id);
      if (idx >= 0) { this.picks.splice(idx, 1); }
      else {
        if (this.picks.length >= this.need) {
          if (this.need === 1) this.picks = [];
          else this.picks.shift();
        }
        this.picks.push(g);
      }
      this.render();
      this.updateBar();
    },
    updateBar() {
      const info = $("#select-info"), btn = $("#select-confirm");
      if (this.mode === "classic") {
        if (this.picks.length === 0) info.textContent = "请选择第 1 名武将";
        else if (this.picks.length === 1) info.textContent = `已选 ${this.picks[0].name}，再选 1 名对手`;
        else info.textContent = `${this.picks[0].name}  VS  ${this.picks[1].name}`;
        btn.disabled = this.picks.length !== 2;
        btn.textContent = "开始单挑";
      } else if (this.mode === "gauntlet") {
        info.textContent = this.picks.length ? `主将：${this.picks[0].name}` : "请选择你的主将";
        btn.disabled = this.picks.length !== 1;
        btn.textContent = "踏上擂台";
      } else if (this.mode === "tower") {
        info.textContent = this.picks.length ? `登塔勇士：${this.picks[0].name}` : "请选择登塔勇士";
        btn.disabled = this.picks.length !== 1;
        btn.textContent = "开始登塔";
      } else if (this.mode === "duo") {
        const roles = ["我方主将", "我方副将", "敌方主将", "敌方副将"];
        info.textContent = this.picks.length < 4
          ? `请选择：${roles[this.picks.length]}（${this.picks.length}/4）`
          : `${this.picks[0].name}+${this.picks[1].name}  VS  ${this.picks[2].name}+${this.picks[3].name}`;
        btn.disabled = this.picks.length !== 4;
        btn.textContent = "开始 2v2";
      } else if (this.mode === "cup") {
        info.textContent = `已选 ${this.picks.length}/${this.need}（不足将随机补满）`;
        btn.disabled = false;
        btn.textContent = this.picks.length >= this.need ? "满员开赛" : "开赛";
      } else if (this.mode === "team") {
        info.textContent = `已选 ${this.picks.length}/${this.need}（${sideName(this.side)}）· 不足将随机补满，AI 另组一队应战`;
        btn.disabled = false;
        btn.textContent = this.picks.length >= this.need ? "满员出战" : "组队出战";
      }
    },
    confirm() {
      if (this.mode === "classic" && this.picks.length === 2) {
        startClassicBattle(this.picks[0], this.picks[1], false);
      } else if (this.mode === "gauntlet" && this.picks.length === 1) {
        Gauntlet.start(this.picks[0]);
      } else if (this.mode === "tower" && this.picks.length === 1) {
        Tower.start(this.picks[0]);
      } else if (this.mode === "duo" && this.picks.length === 4) {
        startDuoBattle(this.picks[0], this.picks[1], this.picks[2], this.picks[3]);
      } else if (this.mode === "cup") {
        Tournament.begin(this.picks);
      } else if (this.mode === "team") {
        TeamBattle.begin(this.picks, this.side);
      }
    },
  };

  /* ============================================================
   *  战斗界面（经典单挑 / 车轮战通用）
   * ============================================================ */
  let BATTLE = null;
  let battleToken = 0;   // 每场战斗唯一票据，防止旧场的自动定时器误驱动新场
  const PREF = { auto: false, speed: 1 };

  function renderFighter(sel, fighter, sideClass) {
    const el = $(sel);
    const isLeft = sel.includes('left');
    el.className = `fighter ${isLeft ? 'left' : 'right'} ${sideClass}`;
    const g = fighter.g;
    $(".favatar", el).textContent = avatarChar(g.name);
    $(".fname", el).textContent = g.name;
    $(".ftotal", el).innerHTML = `武将评分 <b>${ratingScore(g)}</b> ${ratingChip(g)}`;
    // 头像/姓名右侧的五维（评级 + 数值彩条 + 数值；体力另以下方血条呈现）
    $(".fstats", el).innerHTML = DIMS.filter(([k]) => k !== "ti").map(([k, label]) =>
      `<div class="fs-row"><span class="fs-lbl">${label[0]}</span>` +
      `<span class="fs-track"><span class="fs-bar" style="width:${Math.min(100, g[k] / 1.2)}%;background:${gradeColor(g[k])}"></span></span>` +
      `<span class="fs-val">${g[k]}</span>${gradeChip(g[k])}</div>`
    ).join("");
    updateBars(el, fighter);
  }

  /* ============================================================
   *  Duel —— 8-bit 像素骑战画面（仿三国志II 霸王的大陆单挑）
   *  低分辨率 256×160 画布，最近邻放大，骑将策马对冲。
   * ============================================================ */
  const Duel = {
    cv: null, ctx: null, raf: 0, riders: [], spark: 0, sparkX: 128, shake: 0, _bg: null,
    init() {
      this.cv = $("#duel-canvas"); this.ctx = this.cv.getContext("2d"); this.ctx.imageSmoothingEnabled = false;
      // 屏幕尺寸/折叠形态变化时，重算画布缓冲宽度，让背景随屏宽等比铺满（不拉伸）
      window.addEventListener("resize", () => { if ($("#screen-battle").classList.contains("active")) this.resize(); });
    },
    // 画布缓冲高度固定 160，宽度按显示区宽高比等比推算——这样 CSS 铺满时横竖同比缩放不变形，
    // 且背景(drawBg 用 W 铺满)自然延伸到两侧，太阳仍只有一个(位于 W-50)
    resize() {
      if (!this.cv) this.init();
      const cw = this.cv.clientWidth || 256, ch = this.cv.clientHeight || 160, H = 160;
      const W = Math.max(224, Math.min(960, Math.round(H * cw / ch)));
      if (this.cv.width !== W || this.cv.height !== H) {
        this.cv.width = W; this.cv.height = H;
        this.ctx.imageSmoothingEnabled = false;   // 改尺寸会重置 2d 上下文状态
      }
      // 对战进行中则重定位骑将基准点
      if (this.riders && this.riders.length === 2) {
        const [x1, x2] = this.basePos(this.cv.width);
        this.riders[0].baseX = x1; this.riders[1].baseX = x2;
        if (!this.riders[0].anim) this.riders[0].x = x1;
        if (!this.riders[1].anim) this.riders[1].x = x2;
      }
    },
    // 站位：窄屏靠两侧；宽屏(折叠屏展开)站在 1/3 与 2/3 处，不贴屏幕边缘
    basePos(W) { return W > 420 ? [Math.round(W / 3), Math.round(W * 2 / 3)] : [44, W - 44]; },
    setup(g1, g2) {
      if (!this.cv) this.init();
      this.resize();
      const [x1, x2] = this.basePos(this.cv.width);
      this.riders = [this.mk(g1, x1, false), this.mk(g2, x2, true)];
      this.spark = 0; this.shake = 0;
      this.start();
    },
    mk(g, baseX, flip) {
      return {
        g, side: g.side, baseX, x: baseX, y: 134, flip, dir: flip ? -1 : 1,
        anim: null, hitT: 0, ko: false, koT: 0, charge: false, impact: null,
      };
    },
    start() { if (this.raf) return; const loop = t => { this.frame(t); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); },
    stop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } },

    // 攻击：策马冲向中央，返回 Promise 在「命中瞬间」resolve；之后自动收马
    attack(who, tactic, speed) {
      return new Promise(res => {
        const r = this.riders[who];
        const dur = 620 / (speed || 1);
        r.anim = { type: "charge", t0: performance.now(), dur, tactic, hit: false };
        r.charge = false;
        r.impact = res;
      });
    },
    hit(who) { const r = this.riders[who]; r.hitT = performance.now(); this.shake = 6; },
    ko(who) { const r = this.riders[who]; r.ko = true; r.koT = performance.now(); },
    revive(who) { const r = this.riders[who]; r.ko = false; r.koT = 0; },
    setCharge(who, on) { this.riders[who].charge = on; },

    frame(now) {
      const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
      // 镜头抖动
      let sx = 0, sy = 0;
      if (this.shake > 0) { sx = (Math.random() - 0.5) * this.shake; sy = (Math.random() - 0.5) * this.shake; this.shake *= 0.8; if (this.shake < 0.4) this.shake = 0; }
      ctx.save(); ctx.translate(Math.round(sx), Math.round(sy));
      this.drawBg(ctx, W, H, now);
      // 更新骑将位置
      const center = W / 2;
      for (let i = 0; i < this.riders.length; i++) {
        const r = this.riders[i];
        let drawX = r.baseX;
        if (r.anim && r.anim.type === "charge") {
          const p = Math.min(1, (now - r.anim.t0) / r.anim.dur);
          const reach = (center - r.dir * 18) - r.baseX; // 冲到中央交锋点
          // 0→0.5 冲锋, 0.5→1 收马
          const tri = p < 0.5 ? p / 0.5 : (1 - p) / 0.5;
          drawX = r.baseX + reach * tri;
          if (!r.anim.hit && p >= 0.5) { r.anim.hit = true; this.spark = 1; this.sparkX = center; if (r.impact) { r.impact(); r.impact = null; } }
          if (p >= 1) r.anim = null;
        }
        // 受击击退
        if (r.hitT) { const hp = (now - r.hitT) / 300; if (hp >= 1) r.hitT = 0; else drawX += -r.dir * 7 * (1 - hp); }
        r.x = drawX;
      }
      // 远→近顺序：先画较靠后者无所谓，直接画
      for (const r of this.riders) this.drawGeneral(ctx, r, now);
      // 火花
      if (this.spark > 0) { this.drawSpark(ctx, this.sparkX, 96, this.spark); this.spark -= 0.08; if (this.spark < 0) this.spark = 0; }
      ctx.restore();
    },

    drawBg(ctx, W, H, now) {
      const P = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); };
      // 黄昏战场天空：多段渐变
      const sky = ["#243b6e", "#3a5a9c", "#5c7fc8", "#8aa6df", "#c9b6c0", "#f0c79a"];
      for (let i = 0; i < sky.length; i++) P(0, i * 16, W, 17, sky[i]);
      // 落日 + 光晕
      const sunX = W - 50, sunY = 26;
      P(sunX - 12, sunY - 12, 24, 24, "rgba(255,220,140,.25)");
      P(sunX - 9, sunY - 9, 18, 18, "#ffe9a8");
      P(sunX - 7, sunY - 7, 14, 14, "#ffd45a");
      // 霞光横纹
      ctx.fillStyle = "rgba(255,210,140,.18)";
      for (let y = 8; y < 90; y += 12) ctx.fillRect(0, y, W, 2);
      // 飘云（缓慢平移）
      const cloud = (cx, cy, s, col) => { P(cx, cy, 14 * s, 4, col); P(cx + 5, cy - 3, 10 * s, 4, col); P(cx + 12 * s, cy, 10 * s, 4, col); };
      const t = now * 0.004;
      ctx.globalAlpha = .85;
      cloud(((40 + t) % (W + 60)) - 40, 18, 1.4, "#eef0f6");
      cloud(((150 + t * 0.7) % (W + 60)) - 40, 34, 1.0, "#dfe4ef");
      cloud(((250 + t * 1.3) % (W + 60)) - 40, 12, 1.1, "#f6f1ee");
      ctx.globalAlpha = 1;
      // 远山三层（越远越淡）
      for (let mx = -30; mx < W + 30; mx += 90) this.tri(ctx, mx, 98, 70, 34, "#6a6f9a");
      for (let mx = 20; mx < W + 30; mx += 80) this.tri(ctx, mx, 100, 60, 44, "#4a5a7e");
      // 远处城郭剪影
      const cxs = W * 0.5 | 0;
      P(cxs - 26, 78, 52, 22, "#2e3a55");
      P(cxs - 30, 86, 60, 14, "#283250");
      for (let i = -2; i <= 2; i++) P(cxs + i * 11 - 2, 72, 5, 8, "#2e3a55"); // 城垛
      P(cxs - 4, 64, 8, 16, "#37456a"); P(cxs - 6, 60, 12, 5, "#a01818"); // 天守 + 红旗
      // 近山（深绿）
      for (let mx = -10; mx < W + 30; mx += 64) this.tri(ctx, mx, 104, 56, 30, "#235c30");
      // 草原
      P(0, 104, W, H - 104, "#3fae37");
      P(0, 104, W, 5, "#48c23e");
      ctx.fillStyle = "#2f8a28";
      for (let y = 118; y < H; y += 9) ctx.fillRect(0, y, W, 1);
      // 草丛与野花点缀（固定布局）
      for (let i = 0; i < 46; i++) {
        const gx = (i * 71 + 13) % W, gy = 112 + (i * 29) % (H - 116);
        P(gx, gy, 2, 3, "#2c8a24"); P(gx + 2, gy - 1, 2, 3, "#56cc46");
        if (i % 7 === 0) P(gx + 1, gy - 2, 2, 2, i % 14 === 0 ? "#ffe24d" : "#ff7aa0");
      }
      // 两侧军旗
      this.banner(ctx, 10, 104, "#c1272d", now);
      this.banner(ctx, W - 14, 104, "#2b3a67", now);
    },
    // 战旗（旗杆 + 飘动旗面）
    banner(ctx, x, groundY, col, now) {
      const P = (px, py, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(px | 0, py | 0, w | 0, h | 0); };
      P(x, groundY - 46, 2, 46, "#5a4a2a");
      P(x - 1, groundY - 48, 4, 3, "#e8c25a");
      const wv = Math.sin(now * 0.006) * 2;
      for (let i = 0; i < 7; i++) { const fy = groundY - 44 + i * 3; P(x + 2, fy, 16 + (i % 2 ? wv : -wv), 3, col); }
      P(x + 4, groundY - 40, 8, 8, "#e8c25a"); // 旗徽
    },
    tri(ctx, cx, baseY, w, h, col) {
      ctx.fillStyle = col;
      for (let i = 0; i < h; i++) { const ww = Math.round(w * (h - i) / h); ctx.fillRect(Math.round(cx - ww / 2), baseY - i, ww, 1); }
    },
    drawSpark(ctx, x, y, t) {
      const r = Math.round(16 * (1 - t) + 4);
      const cols = ["#ffffff", "#ffe060", "#ff8020"];
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = cols[k];
        const rr = r - k * 3; if (rr <= 0) continue;
        ctx.fillRect(x - rr, y - 1, rr * 2, 2);
        ctx.fillRect(x - 1, y - rr, 2, rr * 2);
        ctx.fillRect(x - rr * 0.7, y - rr * 0.7, rr * 0.5, rr * 0.5);
        ctx.fillRect(x + rr * 0.4, y + rr * 0.3, rr * 0.5, rr * 0.5);
      }
    },

    // 绘制一名骑将（默认朝右，flip 镜像）
    drawGeneral(ctx, r, now) {
      const armor = r.side === "cn" ? "#e03028" : "#3858d8";
      const armor2 = r.side === "cn" ? "#a01818" : "#203098";
      const gold = "#f8d038", skin = "#f8c088", steel = "#d0d8e0";
      const horse = "#b07838", horseD = "#7a5020", mane = "#5a3a18";
      ctx.save();
      ctx.translate(Math.round(r.x), 0);
      if (r.flip) ctx.scale(-1, 1);
      let alpha = 1, rot = 0;
      if (r.ko) { const kp = Math.min(1, (now - r.koT) / 700); rot = -1.0 * kp; alpha = 1 - 0.55 * kp; ctx.translate(0, kp * 6); }
      ctx.globalAlpha = alpha;
      const yb = r.y;
      if (rot) { ctx.translate(0, yb - 18); ctx.rotate(rot); ctx.translate(0, -(yb - 18)); }
      const P = (x, w, y, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
      // 蹄影
      ctx.globalAlpha = alpha * 0.3; P(-16, 34, yb - 1, 3, "#1c5418"); ctx.globalAlpha = alpha;
      // 马腿（奔腾两帧）
      const gf = Math.floor(now / 110) % 2;
      const bL = -10 + (gf ? -2 : 2), fL = 8 + (gf ? 2 : -2);
      P(bL, 3, yb - 9, 9, horseD); P(bL + 5, 3, yb - 8, 8, horse);
      P(fL, 3, yb - 9, 9, horseD); P(fL - 5, 3, yb - 8, 8, horse);
      // 马身
      P(-14, 28, yb - 19, 11, horse);
      P(8, 9, yb - 23, 8, horse);              // 前胸
      P(-16, 4, yb - 18, 12, mane);            // 尾
      // 颈/头
      P(14, 5, yb - 27, 11, horse);
      P(17, 9, yb - 31, 7, horse);
      P(24, 4, yb - 29, 4, horse);             // 口鼻
      P(18, 2, yb - 33, 2, horse);             // 耳
      P(13, 3, yb - 29, 9, mane);              // 鬃
      P(22, 1, yb - 29, 1, "#000");            // 眼
      // 背旗（指物，随风飘动）
      const bw = 9 + Math.round(Math.sin(now * 0.008) * 1.5);
      P(-10, 2, yb - 50, 22, "#5a4a2a");       // 旗杆
      P(-10 - (bw - 9), bw, yb - 49, 14, armor); // 旗面
      P(-10 - (bw - 9), bw, yb - 49, 3, gold);   // 旗顶
      P(-10 - (bw - 9) + 2, bw - 4, yb - 44, 5, gold); // 旗徽
      // 鞍 + 骑将
      P(-6, 13, yb - 21, 3, armor2);
      P(-4, 3, yb - 21, 7, armor2); P(4, 3, yb - 21, 7, armor2);  // 腿
      P(-8, 4, yb - 31, 13, armor2);           // 披风
      P(-4, 10, yb - 32, 11, armor);           // 躯干
      P(-4, 10, yb - 32, 3, gold);             // 胸甲金边
      P(-6, 3, yb - 31, 4, armor2); P(6, 3, yb - 31, 4, armor2);  // 护肩
      P(5, 7, yb - 30, 3, skin);               // 持枪手臂
      P(-2, 7, yb - 39, 7, skin);              // 头
      P(-3, 9, yb - 41, 3, armor2);            // 头盔
      P(0, 2, yb - 47, 6, gold);               // 盔缨（加高）
      P(-2, 2, yb - 44, 4, "#fff");            // 缨穗高光
      P(3, 1, yb - 37, 1, "#000");             // 眼
      // 马蹄扬尘（移动时）
      if (Math.abs(r.x - r.baseX) > 3) {
        ctx.globalAlpha = alpha * 0.5;
        const d = (now / 80 | 0) % 3;
        P(-18 - d * 2, 4, yb - 2, 3, "#d9c9a0"); P(-22 - d, 3, yb - 5, 2, "#e8dcc0");
        ctx.globalAlpha = alpha;
      }
      // 长枪（上扬）
      P(11, 2, yb - 54, 2, mane);
      for (let i = 0; i < 22; i++) P(11 + i * 0.18, 2, yb - 54 + i, 2, "#7a5020"); // 斜枪杆
      P(13, 5, yb - 60, 5, steel);             // 枪尖
      P(12, 2, yb - 58, 2, "#fff");            // 高光
      // 蓄力金光
      if (r.charge) {
        const fl = (Math.floor(now / 80) % 2) ? "#fff0a0" : "#ffd040";
        ctx.globalAlpha = alpha * 0.9;
        P(-9, 1, yb - 42, 24, fl); P(-9, 1, yb - 19, 24, fl);
        P(-9, 24, yb - 42, 1, fl); P(15, 1, yb - 42, 24, fl);
        ctx.globalAlpha = alpha;
      }
      // 受击闪白
      if (r.hitT) { const hp = (now - r.hitT) / 300; if (hp < 1 && (Math.floor(now / 60) % 2)) { ctx.globalAlpha = alpha * 0.7; P(-8, 26, yb - 45, 45, "#ffffff"); } }
      ctx.restore();
    },
  };

  function updateBars(el, fighter) {
    const ratio = fighter.hp / fighter.maxHp;
    const fill = $(".hpbar .fill", el);
    fill.style.width = (ratio * 100) + "%";
    fill.style.background = hpColor(ratio);
    $(".hpbar .txt", el).textContent = `${Math.ceil(fighter.hp)} / ${fighter.maxHp}`;
    $(".stambar .fill", el).style.width = fighter.stam + "%";
  }

  function logLine(text, cls) {
    const log = $("#battle-log");
    const div = document.createElement("div");
    div.className = "ln " + (cls || "");
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function renderTactics(enabled) {
    const wrap = $("#tactics");
    const g = BATTLE.p1.g;
    const used = BATTLE.freeUsed || {};
    wrap.innerHTML = Object.values(TACTICS).map(t => {
      const cost = staminaCost(t.key, g);
      const chosen = used[t.key] ? " chosen" : "";
      const costLbl = cost <= 0 ? `<span class="stcost">免耗</span>` : `<span class="stcost">耗${cost}</span>`;
      return `<button class="tactic-btn ${t.type === "scheme" ? "scheme" : ""}${t.free ? " free" : ""}${chosen}" data-t="${t.key}" title="${t.desc}">
        <span class="ti">${t.icon}</span><span class="tn">${t.name}</span>
        ${costLbl}
      </button>`;
    }).join("");
    $$(".tactic-btn", wrap).forEach(b => {
      const key = b.dataset.t;
      const t = TACTICS[key];
      const cost = staminaCost(key, g);
      // 格挡不耗战意，故不因战意不足而禁用；其余（含蓄力）按战意消耗判定
      let dis = !enabled || BATTLE.spectate || (cost > 0 && BATTLE.p1.stam < cost);
      if (t.free && used[key]) dis = true;   // 该免费计策本回合已发动
      b.disabled = dis;
      b.onclick = () => (t.free ? chooseFree(key) : playerTactic(key));
    });
  }

  function startClassicBattle(g1, g2, isRandom, rpg) {
    BATTLE = {
      p1: makeFighter(g1), p2: makeFighter(g2),
      round: 0, mode: "classic", busy: false,
      onWin: null, rpg: !!rpg, opp: g2,
    };
    $("#battle-title").textContent = rpg ? "历练单挑" : (isRandom ? "随机演武" : "经典单挑");
    enterBattle();
  }

  /* ---- 2v2 主副将单挑：副将六维的 15% 并入主将，另可在主将危急时驰援一次 ---- */
  function fuseDuo(main, dep) {
    const g = clone(main);
    for (const k of ["ti", "wu", "tong", "zhi", "zheng", "mei"]) g[k] = Math.min(150, (g[k] || 0) + Math.round((dep[k] || 0) * 0.15));
    return g;
  }
  function startDuoBattle(m1, d1, m2, d2, rpg) {
    const g1 = fuseDuo(m1, d1), g2 = fuseDuo(m2, d2);
    BATTLE = {
      p1: makeFighter(g1), p2: makeFighter(g2),
      round: 0, mode: "duo", busy: false,
      onWin: null, rpg: !!rpg, opp: g2,
      duo: { m1, d1, m2, d2 },
    };
    BATTLE.p1.deputy = clone(d1);
    BATTLE.p2.deputy = clone(d2);
    $("#battle-title").textContent = rpg ? "2v2 · 历练" : "2v2 · 主副将单挑";
    enterBattle();
    logLine(`副将【${d1.name}】辅佐 ${m1.name}，副将【${d2.name}】辅佐 ${m2.name}——副将六维15%并入主将，危急时驰援一次！`, "sys");
  }
  // 回魂丹：主角在 RPG 相关单挑（历练/2v2/百人斩/车轮）倒地时，可花 100 金满血续战，每场一次
  function maybeRevive() {
    const eligible = RPG.char && !BATTLE.revived &&
      (BATTLE.rpg || (BATTLE.mode === "tower" && Tower.rpg) || (BATTLE.mode === "gauntlet" && Gauntlet.rpg));
    if (!eligible || Bond.gold() < 100) return Promise.resolve(false);
    return new Promise(res => {
      openOverlay(`<div class="result-card">
        <h1>命悬一线</h1>
        <div class="wdesc">${BATTLE.p1.g.name} 倒地！是否服下回魂丹，原地满血续战？<br>（100 金 · 现有 ${Bond.gold()} 金 · 每场限一次）</div>
        <div class="btns">
          <button class="btn-primary" id="rv-yes">💊 服回魂丹</button>
          <button class="btn-ghost" id="rv-no">认输</button>
        </div></div>`);
      $("#rv-yes").onclick = () => {
        closeOverlay();
        if (!Bond.spend(100)) { res(false); return; }
        BATTLE.p1.hp = BATTLE.p1.g.ti;
        BATTLE.revived = true;
        logLine(`💊 ${BATTLE.p1.g.name} 服下回魂丹，满血复活再战！（-100金）`, "sys");
        updateBars($("#f-left"), BATTLE.p1);
        AudioSystem.sfx.victory();
        res(true);
      };
      $("#rv-no").onclick = () => { closeOverlay(); res(false); };
    });
  }

  // 2v2 副将驰援：主将体力≤35%（含被击倒的瞬间）时舍身疗伤，每场限一次
  async function maybeRescue(stale) {
    const list = [[BATTLE.p1, "#f-left", "left"], [BATTLE.p2, "#f-right", "right"]];
    for (const [f, sel, side] of list) {
      if (!f.deputy || f.rescued) continue;
      if (f.hp > f.g.ti * 0.35) continue;
      f.rescued = true;
      const saved = f.hp <= 0;
      const heal = Math.max(8, Math.round(f.deputy.ti * 0.3));
      f.hp = Math.min(f.g.ti, Math.max(0, f.hp) + heal);
      AudioSystem.sfx.select();
      logLine(`🚑 副将【${f.deputy.name}】${saved ? "舍身相救" : "驰援"}！为 ${f.g.name} 疗伤 +${heal}（每场一次）`, "sys");
      floatDamage(side, heal, false, true);
      updateBars($(sel), f);
      await battleSleep(420);
      if (stale && stale()) return;
    }
  }

  // 阵营大战「详情」模式：在经典单挑画面上自动演完整场对决，Promise 返回胜负
  // 中途中止时以 null 解开等待方（见 War.abort）
  function autoPlayBattle(g1, g2, opts = {}) {
    return new Promise(resolve => {
      const b = {
        p1: makeFighter(g1), p2: makeFighter(g2),
        round: 0, mode: "war", busy: false, spectate: true,
        onWin: (winner, loser) => resolve({ winner, loser, rounds: b.round }),
        abortResolve: () => resolve(null),
      };
      BATTLE = b;
      $("#battle-title").textContent = opts.title || "阵营大战 · 单挑";
      enterBattle();
      if (opts.intro) logLine(opts.intro, "sys");
    });
  }

  // 组队大战 · 挑唆触发的单挑：与 autoPlayBattle 结构一致，但 spectate 可控——
  // 未委托 AI 时玩家可在此像素单挑画面里亲自操作（约定：玩家一方武将固定传为 g1，见 TeamBattle.provoke）
  function startTeamDuel(g1, g2, opts = {}) {
    return new Promise(resolve => {
      const b = {
        p1: makeFighter(g1), p2: makeFighter(g2),
        round: 0, mode: "team", busy: false, spectate: !!opts.spectate,
        backScreen: "teamwar",
        onWin: (winner, loser) => resolve({ winner, loser }),
        abortResolve: () => resolve(null),
      };
      BATTLE = b;
      $("#battle-title").textContent = opts.title || "阵前挑唆 · 单挑";
      enterBattle();
      if (opts.intro) logLine(opts.intro, "sys");
    });
  }

  function battleSleep(ms) { return sleep(ms / (BATTLE.speed || 1)); }
  const whoIdx = who => (who === "p1" ? 0 : 1);

  function enterBattle() {
    renderFighter("#f-left", BATTLE.p1, BATTLE.p1.g.side);
    renderFighter("#f-right", BATTLE.p2, BATTLE.p2.g.side);
    Duel.setup(BATTLE.p1.g, BATTLE.p2.g);
    $("#battle-log").innerHTML = "";
    $("#round-badge").textContent = "第 1 回合";
    logLine(`【${BATTLE.p1.g.name}】 对阵 【${BATTLE.p2.g.name}】，单挑开始！`, "sys");
    logLine(`体力=血量 武力=攻 智力=谋攻 统帅=先手/减伤/格挡 政治=战意 魅力=暴击率`, "sys");
    BATTLE.busy = false;
    BATTLE.token = ++battleToken;
    BATTLE.speed = PREF.speed;
    BATTLE.auto = BATTLE.spectate ? true : PREF.auto;   // 阵营观战恒为自动
    // 头像点击查看详情
    $$("[data-info]", $("#screen-battle")).forEach(av => {
      av.onclick = function () {
        const f = this.closest("#f-left") ? BATTLE.p1 : BATTLE.p2;
        showDetail(f.g);
      };
    });
    syncBattleControls();
    BATTLE.turnNo = 0;
    BATTLE.turn = firstMover(BATTLE.p1, BATTLE.p2);   // 统帅决定先手
    nextTurn();
    showScreen("battle");
    Duel.resize();   // 画面显示后按实际显示区尺寸重算缓冲，背景随屏宽铺满
  }

  // 轮换出招：决定/提示当前回合该谁出手
  function nextTurn() {
    BATTLE.freeUsed = {};
    const active = BATTLE.turn;
    const me = active === "p1" ? BATTLE.p1 : BATTLE.p2;
    const foe = active === "p1" ? BATTLE.p2 : BATTLE.p1;
    const human = active === "p1" && !BATTLE.auto && !BATTLE.spectate;
    if (human && me.bound <= 0) {
      renderTactics(true);
      $("#battle-foot").textContent = "请出招 —— " + me.g.name;
      return;
    }
    // 自动出手：对手回合、自动作战、观战、或被束缚（自动跳过）
    renderTactics(false);
    $("#battle-foot").textContent = me.bound > 0
      ? `${me.g.name} 被束缚，暂停出招…`
      : (BATTLE.spectate ? "阵营观战中 ⚔ " : (human ? "" : (active === "p1" ? "自动作战 —— " : "对手出招 —— "))) + me.g.name;
    const tok = BATTLE.token;
    BATTLE._autoTimer = setTimeout(() => {
      if (!BATTLE || BATTLE.token !== tok) return;
      const a = BATTLE.turn === "p1" ? BATTLE.p1 : BATTLE.p2;
      const f = BATTLE.turn === "p1" ? BATTLE.p2 : BATTLE.p1;
      takeTurn(aiChoosePlan(a, f));
    }, 560 / BATTLE.speed);
  }

  // 自动作战开关触发：若轮到我方且可行动则立即自动出手
  function maybeAutoPlay() {
    if (!BATTLE || BATTLE.busy || !BATTLE.auto) return;
    if (overlay.classList.contains("show")) return;
    const a = BATTLE.turn === "p1" ? BATTLE.p1 : BATTLE.p2;
    const f = BATTLE.turn === "p1" ? BATTLE.p2 : BATTLE.p1;
    takeTurn(aiChoosePlan(a, f));
  }

  // 手动：点免费计策(束缚/弱化)——立即发动并演出；同回合两者皆可发动，各限一次，且仍可再出招
  async function chooseFree(key) {
    if (!BATTLE || BATTLE.busy || BATTLE.spectate) return;
    if (BATTLE.turn !== "p1" || BATTLE.p1.bound > 0) return;
    if (!BATTLE.freeUsed) BATTLE.freeUsed = {};
    if (BATTLE.freeUsed[key]) return;              // 该计策本回合已发动
    const cost = staminaCost(key, BATTLE.p1.g);
    if (BATTLE.p1.stam < cost) { toast("战意不足"); return; }
    BATTLE.busy = true;
    const myTok = BATTLE.token; const stale = () => !BATTLE || BATTLE.token !== myTok;
    clearTimeout(BATTLE._autoTimer);
    BATTLE.freeUsed[key] = true;
    renderTactics(false);
    AudioSystem.sfx.select();
    // 立即结算并演出这条免费计策
    BATTLE.p1.stam = Math.max(0, BATTLE.p1.stam - cost);
    const ok = Math.random() < schemeSuccess(BATTLE.p1, BATTLE.p2, TACTICS[key].scheme);
    const ev = applyScheme({ atk: BATTLE.p1, def: BATTLE.p2, label: "p1" }, TACTICS[key].scheme, ok);
    await applyEvent(ev);
    if (stale()) return;
    updateBars($("#f-left"), BATTLE.p1);
    updateBars($("#f-right"), BATTLE.p2);
    BATTLE.busy = false;
    renderTactics(true);   // 主行动可继续；已发动的计策按钮已禁用
    $("#battle-foot").textContent = `已发动【${TACTICS[key].name}】，可再施计或出招`;
  }

  // 玩家选定「主行动」后结算本回合（免费计策已即时发动，不再重复）
  function playerTactic(mainKey) {
    takeTurn({ frees: [], main: mainKey });
  }

  // 结算「当前出手方」的一个回合
  async function takeTurn(plan) {
    if (!BATTLE || BATTLE.busy) return;
    const myTok = BATTLE.token;           // 该回合所属战斗；战斗被替换则中途作废
    const stale = () => !BATTLE || BATTLE.token !== myTok;
    BATTLE.busy = true;
    BATTLE.freeUsed = {};
    clearTimeout(BATTLE._autoTimer);
    renderTactics(false);

    BATTLE.turnNo = (BATTLE.turnNo || 0) + 1;
    $("#round-badge").textContent = `第 ${Math.ceil(BATTLE.turnNo / 2)} 回合`;

    const active = BATTLE.turn;
    const me = active === "p1" ? BATTLE.p1 : BATTLE.p2;
    const foe = active === "p1" ? BATTLE.p2 : BATTLE.p1;
    const events = resolveTurn(me, foe, plan, active);

    for (const ev of events) {
      await applyEvent(ev);
      if (stale()) return;
    }
    updateBars($("#f-left"), BATTLE.p1);
    updateBars($("#f-right"), BATTLE.p2);

    // 2v2：主将危急时副将驰援（可从倒地边缘救回，故在 KO 判定之前结算）
    await maybeRescue(stale);
    if (stale()) return;

    // 三期便利：主角倒地可花 100 金服回魂丹满血续战（每场一次）
    if (BATTLE.p1.hp <= 0 && BATTLE.p2.hp > 0) {
      const saved = await maybeRevive();
      if (stale()) return;
      if (saved) { Duel.revive(0); }
    }

    if (BATTLE.p1.hp <= 0 || BATTLE.p2.hp <= 0) {
      await battleSleep(500);
      if (stale()) return;
      endBattle();
      return;
    }
    BATTLE.busy = false;
    BATTLE.turn = active === "p1" ? "p2" : "p1";   // 轮换出手
    await battleSleep(220);
    if (stale()) return;
    nextTurn();
  }

  async function applyEvent(ev) {
    const cls = ev.who === "p1" ? "p1" : "p2";
    const atk = whoIdx(ev.who), def = whoIdx(ev.who === "p1" ? "p2" : "p1");

    if (ev.type === "charge") {
      AudioSystem.sfx.charge();
      Duel.setCharge(atk, true);
      logLine(ev.text, cls);
      // 蓄力消耗战意：刷新双方血条/战意条
      updateBars($("#f-left"), BATTLE.p1);
      updateBars($("#f-right"), BATTLE.p2);
      await battleSleep(380);
      return;
    }
    if (ev.type === "miss") {
      AudioSystem.sfx.gallop();
      await Duel.attack(atk, ev.tactic, BATTLE.speed);
      Duel.setCharge(atk, false);
      AudioSystem.sfx.guard();
      logLine(ev.text, "sys");
      await battleSleep(320);
      return;
    }
    if (ev.type === "hit") {
      AudioSystem.sfx.gallop();
      AudioSystem.sfx.swing();
      // 策马冲锋，命中瞬间结算
      await Duel.attack(atk, ev.tactic, BATTLE.speed);
      Duel.setCharge(atk, false);

      const softened = ev.guarded || ev.counter <= 0.7;
      if (ev.crit) AudioSystem.sfx.crit();
      else if (softened) AudioSystem.sfx.guard();
      else AudioSystem.sfx.hit();

      Duel.hit(def);
      if (!softened) { $("#duel-canvas").classList.remove("flash"); void $("#duel-canvas").offsetWidth; $("#duel-canvas").classList.add("flash"); }
      floatDamage(ev.who === "p1" ? "right" : "left", ev.dmg, ev.crit);

      logLine(ev.text, cls);
      updateBars($("#f-left"), BATTLE.p1);
      updateBars($("#f-right"), BATTLE.p2);
      await battleSleep(ev.crit ? 460 : 320);
      return;
    }
    if (ev.type === "defend") {
      AudioSystem.sfx.guard();
      Duel.setCharge(atk, true);
      logLine(ev.text, cls);
      await battleSleep(380);
      Duel.setCharge(atk, false);
      return;
    }
    if (ev.type === "bound") {
      AudioSystem.sfx.guard();
      logLine(ev.text, cls);
      await battleSleep(420);
      return;
    }
    if (ev.type === "scheme") {
      AudioSystem.sfx.charge();
      Duel.setCharge(atk, true);
      logLine(ev.text, ev.ok ? cls : "sys");
      await battleSleep(300);
      Duel.setCharge(atk, false);
      if (ev.ok) {
        if (ev.scheme === "heal") {
          AudioSystem.sfx.victory();
          updateBars($("#f-left"), BATTLE.p1);
          updateBars($("#f-right"), BATTLE.p2);
          floatDamage(ev.who === "p1" ? "left" : "right", ev.heal, false, true);
        } else {
          // 束缚/弱化命中：在敌方一侧闪现效果
          AudioSystem.sfx.crit();
          Duel.hit(def);
          $("#duel-canvas").classList.remove("flash"); void $("#duel-canvas").offsetWidth; $("#duel-canvas").classList.add("flash");
        }
      }
      await battleSleep(ev.ok ? 460 : 320);
      return;
    }
    if (ev.type === "ko") {
      AudioSystem.sfx.ko();
      Duel.ko(def);
      logLine(ev.text, "sys");
      await battleSleep(600);
    }
  }

  function syncBattleControls() {
    const a = $("#btn-auto");
    a.classList.toggle("on", !!BATTLE.auto);
    a.textContent = BATTLE.auto ? "⏸ 自动" : "▶ 自动";
    $("#btn-speed").textContent = "×" + (BATTLE.speed || 1);
  }

  function floatDamage(side, dmg, crit, heal) {
    const stage = $("#stage");
    const d = document.createElement("div");
    d.className = "dmg-float" + (crit ? " crit" : "") + (heal ? " heal" : "");
    d.textContent = (heal ? "+" : "-") + dmg;
    d.style.left = (side === "left" ? 28 : 64) + "%";
    d.style.top = "30%";
    stage.appendChild(d);
    setTimeout(() => d.remove(), 1000);
  }

  function endBattle() {
    BATTLE.busy = false; // 战斗结束解除锁定，避免阻塞返回等操作
    const winner = BATTLE.p1.hp > 0 ? BATTLE.p1.g : BATTLE.p2.g;
    const loser = winner === BATTLE.p1.g ? BATTLE.p2.g : BATTLE.p1.g;
    if (!BATTLE.spectate) AudioSystem.sfx.victory();   // 阵营观战由 War 统一收尾，避免逐场喧闹
    if (BATTLE.cupResolve) { const r = BATTLE.cupResolve; BATTLE.cupResolve = null; showScreen("cup"); r(); return; }
    if (BATTLE.rpg) { RPG.onBattleEnd(BATTLE.p1.hp > 0, BATTLE.opp); return; }
    if (BATTLE.onWin) { BATTLE.onWin(winner, loser); return; }

    if (BATTLE.mode === "duo") {
      const d = BATTLE.duo;
      showResult(winner, loser, {
        onRematch: () => startDuoBattle(d.m1, d.d1, d.m2, d.d2),
        onBack: () => { closeOverlay(); SelectUI.open("duo"); },
      });
      return;
    }
    showResult(winner, loser, {
      onRematch: () => { startClassicBattle(BATTLE.p1.g, BATTLE.p2.g, false); },
      onBack: () => { closeOverlay(); SelectUI.open("classic"); },
    });
  }

  function showResult(winner, loser, opts) {
    const bg = winner.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
    openOverlay(`<div class="result-card">
      <h1>胜 · ${winner.side === 'cn' ? '三国' : '战国'}</h1>
      <div class="winner-av" style="background:${bg}">${avatarChar(winner.name)}</div>
      <div class="wname">${winner.name}</div>
      <div style="font-size:13px;color:#8a6d3b">${winner.title || ''}</div>
      <div class="wdesc">力克 ${loser.name}，威震四方！<br>${winner.intro || ''}</div>
      <div class="btns">
        <button class="btn-primary" id="res-again">${opts.rematchLabel || '再战一场'}</button>
        <button class="btn-ghost" id="res-back">${opts.backLabel || '返回'}</button>
      </div>
    </div>`);
    $("#res-again").onclick = () => { closeOverlay(); opts.onRematch(); };
    $("#res-back").onclick = () => { closeOverlay(); opts.onBack(); };
  }

  /* ============================================================
   *  车轮战
   * ============================================================ */
  const Gauntlet = {
    hero: null, streak: 0, pool: [],
    start(hero, rpg) {
      this.hero = clone(hero);
      this.streak = 0;
      this.rpg = !!rpg;
      // 对手池：大致由弱到强，但加入随机扰动，使每次顺序都不同
      this.pool = DB.list.filter(g => g.id !== hero.id)
        .map(g => ({ g, key: g.wu + (Math.random() - 0.5) * 60 }))
        .sort((a, b) => a.key - b.key)
        .map(x => x.g);
      this.next();
    },
    next() {
      if (!this.pool.length) { this.finish(true); return; }
      const foe = this.pool.shift();
      BATTLE = {
        p1: makeFighter(this.hero), p2: makeFighter(foe),
        round: 0, mode: "gauntlet", busy: false,
        onWin: (winner) => this.onResult(winner),
      };
      // 保留主将已损耗的体力（车轮战考验持久力），恢复一部分
      BATTLE.p1.hp = Math.min(this.hero.ti, BATTLE.p1.hp);
      $("#battle-title").textContent = `车轮战 · 第 ${this.streak + 1} 阵`;
      enterBattle();
      logLine(`连胜 ${this.streak} 场！新对手：${foe.name} 登场！`, "sys");
    },
    onResult(winner) {
      if (winner.id === this.hero.id) {
        this.streak++;
        // 胜利后回复 30% 体力
        AudioSystem.sfx.victory();
        const heal = Math.round(this.hero.ti * 0.3);
        this.hero._carryHp = Math.min(this.hero.ti, BATTLE.p1.hp + heal);
        openOverlay(`<div class="result-card">
          <h1>连胜 ${this.streak}</h1>
          <div class="winner-av" style="background:linear-gradient(135deg,var(--cn-gold),#b8860b)">${avatarChar(this.hero.name)}</div>
          <div class="wname">${this.hero.name} 斩将！</div>
          <div class="wdesc">击败 ${BATTLE.p2.g.name}！<br>战后恢复体力 ${heal} 点，下一阵对手更强。</div>
          <div class="btns">
            <button class="btn-primary" id="g-next">迎战下一员</button>
            <button class="btn-ghost" id="g-quit">鸣金收兵</button>
          </div></div>`);
        $("#g-next").onclick = () => {
          closeOverlay();
          const carry = this.hero._carryHp;
          this.next();
          BATTLE.p1.hp = carry; updateBars($("#f-left"), BATTLE.p1);
        };
        $("#g-quit").onclick = () => { closeOverlay(); this.finish(false); };
      } else {
        AudioSystem.sfx.ko();
        this.finish(false, BATTLE.p2.g);
      }
    },
    finish(allCleared, killer) {
      if (this.rpg) { RPG.onGauntletResult(this.streak, allCleared, killer); return; }
      openOverlay(`<div class="result-card">
        <h1>${allCleared ? '天下无敌!' : '车轮战 · 终'}</h1>
        <div class="winner-av" style="background:linear-gradient(135deg,var(--cn-red),#7a1420)">${avatarChar(this.hero.name)}</div>
        <div class="wname">${this.hero.name}</div>
        <div class="wdesc">最终连胜 <b style="font-size:24px;color:var(--cn-red)">${this.streak}</b> 场！${allCleared ? '横扫两国群雄，无人可挡！' : (killer ? '终被 ' + killer.name + ' 所阻。' : '主动收兵。')}</div>
        <div class="btns">
          <button class="btn-primary" id="g-restart">重新挑战</button>
          <button class="btn-ghost" id="g-home">返回菜单</button>
        </div></div>`);
      $("#g-restart").onclick = () => { closeOverlay(); SelectUI.open("gauntlet"); };
      $("#g-home").onclick = () => { closeOverlay(); showScreen("home"); };
    },
  };

  /* ============================================================
   *  百人斩 · 无尽爬塔（Roguelike）
   *  守将随层数增强(约12层与原值持平)；胜后回复 25% 体力并带伤上层；
   *  每攀 5 层三选一机缘（回体/上限/五维永久成长）；阵亡或收兵结算，最佳层数存档
   * ============================================================ */
  const TOWER_KEY = "wujiang_tower_v1";
  const Tower = {
    hero: null, floor: 1, carryHp: 0, gains: [],
    BUFFS: [
      { k: "heal",  icon: "🧪", n: "疗养生息", d: "体力立即回满" },
      { k: "ti",    icon: "❤️", n: "筋骨强健", d: "体力上限 +16，并回复 16 点" },
      { k: "wu",    icon: "⚔️", n: "武艺精进", d: "武力永久 +7" },
      { k: "tong",  icon: "🛡️", n: "兵法研读", d: "统帅永久 +7" },
      { k: "zhi",   icon: "🧠", n: "锦囊妙计", d: "智力永久 +7" },
      { k: "zheng", icon: "🏛️", n: "励精图治", d: "政治永久 +7" },
      { k: "mei",   icon: "✨", n: "天生神威", d: "魅力永久 +7" },
    ],
    best() { try { return JSON.parse(localStorage.getItem(TOWER_KEY)); } catch { return null; } },
    saveBest(cleared) {
      const b = this.best();
      if (!b || cleared > b.best) localStorage.setItem(TOWER_KEY, JSON.stringify({ best: cleared, hero: this.hero.name }));
    },
    start(hero, rpg) {
      this.hero = clone(hero);
      this.rpg = !!rpg;
      this.floor = 1;
      this.carryHp = this.hero.ti;
      this.gains = [];
      this.slain = [];   // 被斩守将名录（RPG 友谊结算用）
      this.next();
    },
    // 守将 = 随机武将按层数放大六维
    makeFoe() {
      const pool = DB.list.filter(g => g.id !== this.hero.id);
      const foe = clone(pool[randInt(0, pool.length - 1)]);
      const mult = Math.min(1.75, 0.7 + this.floor * 0.025);
      for (const k of ["ti", "wu", "tong", "zhi", "zheng", "mei"]) foe[k] = Math.max(20, Math.min(150, Math.round(foe[k] * mult)));
      return foe;
    },
    next() {
      const foe = this.makeFoe();
      BATTLE = {
        p1: makeFighter(this.hero), p2: makeFighter(foe),
        round: 0, mode: "tower", busy: false,
        onWin: winner => this.onResult(winner),
      };
      // 带伤攀塔：沿用上一层战余体力
      BATTLE.p1.hp = Math.max(1, Math.min(this.hero.ti, Math.round(this.carryHp)));
      $("#battle-title").textContent = `百人斩 · 第 ${this.floor} 层`;
      enterBattle();
      updateBars($("#f-left"), BATTLE.p1);
      logLine(`第 ${this.floor} 层守将【${foe.name}】拦路！（守将六维随层数增强）`, "sys");
    },
    onResult(winner) {
      if (winner.id !== this.hero.id) { AudioSystem.sfx.ko(); this.finish(BATTLE.p2.g); return; }
      AudioSystem.sfx.victory();
      this.slain.push(BATTLE.p2.g);
      const healed = Math.round(this.hero.ti * 0.25);
      this.carryHp = Math.min(this.hero.ti, Math.max(0, Math.round(BATTLE.p1.hp)) + healed);
      this.saveBest(this.floor);
      if (this.floor % 5 === 0) this.offerBuffs(healed);
      else this.winOverlay(healed);
    },
    winOverlay(healed) {
      const b = this.best();
      openOverlay(`<div class="result-card">
        <h1>第 ${this.floor} 层 · 破</h1>
        <div class="winner-av" style="background:linear-gradient(135deg,var(--cn-gold),#b8860b)">${avatarChar(this.hero.name)}</div>
        <div class="wname">${this.hero.name} 斩 ${BATTLE.p2.g.name}！</div>
        <div class="wdesc">战后回复体力 ${healed} 点（现 ${Math.round(this.carryHp)}/${this.hero.ti}）。<br>已连斩 <b style="color:var(--cn-red)">${this.floor}</b> 员守将${b ? ` · 历史最佳 ${b.best} 层` : ""}。</div>
        <div class="btns">
          <button class="btn-primary" id="twr-up">攀上一层</button>
          <button class="btn-ghost" id="twr-down">收兵下塔</button>
        </div></div>`);
      $("#twr-up").onclick = () => { closeOverlay(); this.floor++; this.next(); };
      $("#twr-down").onclick = () => { closeOverlay(); this.floor++; this.finish(null); };
    },
    // 每 5 层：三选一机缘
    offerBuffs(healed) {
      const opts = this.BUFFS.slice();
      shuffle(opts);
      const three = opts.slice(0, 3);
      openOverlay(`<div class="result-card">
        <h1>第 ${this.floor} 层 · 天赐机缘</h1>
        <div class="wname">${this.hero.name} 连斩 ${this.floor} 将！</div>
        <div class="wdesc">战后回复体力 ${healed} 点（现 ${Math.round(this.carryHp)}/${this.hero.ti}）。高塔机缘，三选其一：</div>
        <div class="buff-list">
          ${three.map(o => `<button class="buff-btn" data-k="${o.k}"><span class="bi">${o.icon}</span><span class="bt"><b>${o.n}</b><small>${o.d}</small></span></button>`).join("")}
        </div>
        <div class="btns">
          ${RPG.char ? `<button class="btn-ghost" id="twr-reroll">🎲 重抽（50金 · 现有${Bond.gold()}）</button>` : ""}
          <button class="btn-ghost" id="twr-down2">收兵下塔</button>
        </div></div>`);
      $$(".buff-btn").forEach(btn => btn.onclick = () => {
        this.applyBuff(btn.dataset.k);
        closeOverlay();
        this.floor++;
        this.next();
      });
      const rr = $("#twr-reroll");
      if (rr) rr.onclick = () => {
        if (!Bond.spend(50)) { toast("金币不足（重抽需 50 金）"); return; }
        toast("🎲 天机再转…（-50金）");
        this.offerBuffs(healed);
      };
      $("#twr-down2").onclick = () => { closeOverlay(); this.floor++; this.finish(null); };
    },
    applyBuff(k) {
      if (k === "heal") this.carryHp = this.hero.ti;
      else if (k === "ti") { this.hero.ti = Math.min(200, this.hero.ti + 16); this.carryHp = Math.min(this.hero.ti, this.carryHp + 16); }
      else this.hero[k] = Math.min(150, (this.hero[k] || 0) + 7);
      const def = this.BUFFS.find(b => b.k === k);
      this.gains.push(def.n);
      toast(`获得机缘：${def.n}`);
    },
    finish(killer) {
      const cleared = this.floor - 1;
      this.saveBest(cleared);
      if (this.rpg) { RPG.onTowerResult(cleared, killer, this.gains); return; }
      const b = this.best();
      openOverlay(`<div class="result-card">
        <h1>${killer ? "百人斩 · 止" : "鸣金收兵"}</h1>
        <div class="winner-av" style="background:linear-gradient(135deg,var(--cn-red),#7a1420)">${avatarChar(this.hero.name)}</div>
        <div class="wname">${this.hero.name}</div>
        <div class="wdesc">共斩守将 <b style="font-size:24px;color:var(--cn-red)">${cleared}</b> 员${killer ? `，止步第 ${this.floor} 层——败于 ${killer.name} 之手。` : "，全身而退。"}${this.gains.length ? `<br>此行机缘：${this.gains.join("、")}` : ""}<br>历史最佳：${b ? `${b.best} 层（${b.hero}）` : "—"}</div>
        <div class="btns">
          <button class="btn-primary" id="twr-again">再战高塔</button>
          <button class="btn-ghost" id="twr-home">返回菜单</button>
        </div></div>`);
      $("#twr-again").onclick = () => { closeOverlay(); SelectUI.open("tower"); };
      $("#twr-home").onclick = () => { closeOverlay(); showScreen("home"); };
    },
  };

  /* ============================================================
   *  阵营大战（自动模拟 100 vs 100）
   * ============================================================ */
  const War = {
    running: false, mode: "fast", gen: 0, detached: false, scale: "100",
    // 参战规模选择：50 / 100 / 全部 / 随机数量（双方相同）
    setScale(s) {
      if (this.running) { toast("大战进行中，结束后再调整规模"); return; }
      this.scale = s;
      $$(".war-scale").forEach(b => b.classList.toggle("active", b.dataset.scale === s));
      const cap = Math.min(DB.bySide("cn").length, DB.bySide("jp").length);
      const lbl = { "50": "每方 50 名武将", "100": "每方 100 名武将", all: `全部上阵（每方 ${cap} 名）`, random: "随机数量（双方相同）" }[s];
      $("#war-info").textContent = "规模：" + lbl;
    },
    scaleTotal(cap) {
      if (this.scale === "50") return Math.min(50, cap);
      if (this.scale === "100") return Math.min(100, cap);
      if (this.scale === "all") return cap;
      return randInt(20, cap);   // 随机数量
    },
    // 中止进行中的大战：作废循环、解开等待的观战对决、复位界面
    abort() {
      this.gen++;
      this.aborted = true;
      this.running = false;
      $("#war-start").disabled = false;
      if (BATTLE && BATTLE.spectate) { BATTLE.busy = false; if (BATTLE.abortResolve) BATTLE.abortResolve(); }
    },
    // 同步模式开关高亮
    syncModeBtns() {
      $("#war-mode-fast").classList.toggle("active", this.mode === "fast");
      $("#war-mode-detail").classList.toggle("active", this.mode === "detail");
    },
    // 详情观战中点返回：脱离单挑画面，回到战报界面，本场大战继续（其余各阵快捷推进）
    detach() {
      if (!BATTLE || !BATTLE.spectate || BATTLE._detached) return;
      BATTLE._detached = true;
      this.detached = true;
      // 脱离后按钮切回「快捷」，回到战报界面
      this.mode = "fast";
      this.syncModeBtns();
      $("#war-duel").innerHTML = "";
      showScreen("war");
      $("#war-status").textContent = "已返回战报，阵营大战继续进行中…（点「详情」可重新进入观战）";
      // 立即从当前状态续算完这场对决（沿用轮换出招），并交给等待中的循环，使大战无缝继续
      const p1 = BATTLE.p1, p2 = BATTLE.p2;
      let turn = BATTLE.turn || firstMover(p1, p2), guard = 0;
      while (p1.hp > 0 && p2.hp > 0 && guard++ < 400) {
        const me = turn === "p1" ? p1 : p2, foe = turn === "p1" ? p2 : p1;
        resolveTurn(me, foe, aiChoosePlan(me, foe), turn);
        turn = turn === "p1" ? "p2" : "p1";
      }
      BATTLE.token = ++battleToken;     // 作废在飞的回合动画，避免污染后续
      BATTLE.busy = false;
      clearTimeout(BATTLE._autoTimer);
      const winner = p1.hp >= p2.hp ? p1.g : p2.g;
      const loser = winner === p1.g ? p2.g : p1.g;
      if (BATTLE.onWin) BATTLE.onWin(winner, loser);
    },
    setMode(m) {
      // 大战进行中：模式开关变为「观战 / 只看战报」的实时切换
      if (this.running) {
        if (m === "detail") {
          this.mode = "detail";
          this.detached = false;            // 下一阵起重新进入单挑画面观战
          this.syncModeBtns();
          $("#war-status").textContent = "下一阵将进入经典单挑画面继续观战…";
        } else {
          // 切到快捷：若正在单挑画面观战则脱离回战报，否则仅标记
          if (BATTLE && BATTLE.spectate && !BATTLE._detached) { this.detach(); return; }
          this.mode = "fast";
          this.detached = true;
          this.syncModeBtns();
          $("#war-duel").innerHTML = "";
        }
        return;
      }
      this.mode = m;
      this.syncModeBtns();
      if (m === "fast") $("#war-duel").innerHTML = "";
      $("#war-status").textContent = m === "detail"
        ? "详情模式：每一阵都将进入经典单挑画面亲历厮杀（可调速/中途返回）"
        : "点击「开战」，让两军百将随机捉对厮杀";
    },
    async start(hero) {
      if (this.running) return;
      this.running = true;
      this.aborted = false;
      this.detached = false;
      const myGen = ++this.gen;            // 本场大战的代号，被中止/重开后作废旧循环
      $("#war-start").disabled = true;
      $("#war-log").innerHTML = "";
      $("#war-duel").innerHTML = "";
      let cn = DB.bySide("cn").map(clone);
      let jp = DB.bySide("jp").map(clone);
      shuffle(cn); shuffle(jp);
      const total = this.scaleTotal(Math.min(cn.length, jp.length));
      // RPG 英雄出战：主角与同阵营队友排在本方队首，任何规模都必上阵
      if (hero) {
        const forced = [clone(hero), ...Bond.teamGenerals().filter(g => g.side === hero.side).map(clone)];
        const ids = new Set(forced.map(g => g.id));
        if (hero.side === "cn") cn = [...forced, ...cn.filter(g => !ids.has(g.id))];
        else jp = [...forced, ...jp.filter(g => !ids.has(g.id))];
      }
      cn = cn.slice(0, total); jp = jp.slice(0, total);
      $("#war-info").textContent = `规模：每方 ${total} 名武将`;
      let heroKills = 0;
      const kills = new Map();  // 击杀榜：fighter -> {g, kills}
      const bump = g => { const k = kills.get(g) || { g, kills: 0 }; k.kills++; kills.set(g, k); };
      $("#war-cn").textContent = cn.length;
      $("#war-jp").textContent = jp.length;
      $("#war-rank").innerHTML = "";
      $("#war-status").textContent = hero ? `${hero.name} 率军出阵…` : "两军捉对厮杀中…";

      // 各自为队列，轮番派将对决，败者出局，胜者保留（带伤）继续
      let cnIdx = 0, jpIdx = 0;
      let cnFighter = cn[cnIdx], jpFighter = jp[jpIdx];
      let battleNo = 0;
      while (this.gen === myGen && !this.aborted && cnIdx < cn.length && jpIdx < jp.length) {
        battleNo++;

        // 详情模式：切到经典单挑画面，自动演完整场；快捷模式：直接结算
        let res;
        // 详情模式且未脱离观战：进入经典单挑画面演完整场；否则（快捷/已返回）直接结算
        const showDuel = this.mode === "detail" && !this.detached;
        if (showDuel) {
          res = await autoPlayBattle(cnFighter, jpFighter, {
            title: `阵营大战 · 第 ${battleNo} 阵`,
            intro: `${cnFighter.name}（${sideName(cnFighter.side)}） 对阵 ${jpFighter.name}（${sideName(jpFighter.side)}）`,
          });
          if (this.gen !== myGen || this.aborted || !res) return;  // 被中止/接管：安静退出
        } else {
          res = autoBattle(cnFighter, jpFighter);
        }
        const winSide = res.winner.side;
        bump(res.winner);  // res.winner 即 cnFighter 或 jpFighter 本身
        if (hero && res.winner.id === -1) heroKills++;

        const wlog = $("#war-log");
        const ln = document.createElement("div");
        ln.className = winSide === "cn" ? "w-cn" : "w-jp";
        const mark = g => g.id === -1 ? "★" + g.name : g.name;
        ln.innerHTML = `${pad(battleNo)} ${mark(cnFighter)} ⚔ ${mark(jpFighter)} → <b>${mark(res.winner)}</b> 胜 (${res.rounds}回合)`;
        wlog.appendChild(ln);
        wlog.scrollTop = wlog.scrollHeight;
        this.renderRank(kills);

        if (res.winner.side === "cn") { jpIdx++; jpFighter = jp[jpIdx]; }
        else { cnIdx++; cnFighter = cn[cnIdx]; }

        $("#war-cn").textContent = cn.length - cnIdx;
        $("#war-jp").textContent = jp.length - jpIdx;
        if (!showDuel) AudioSystem.sfx.hit();
        await sleep(showDuel ? 220 : (this.detached ? 80 : (hero ? 90 : 140)));
      }
      if (this.gen !== myGen) return;     // 已被新的大战接管，勿动共享状态
      if (this.aborted) { this.running = false; $("#war-start").disabled = false; return; }
      $("#war-duel").innerHTML = "";
      if (this.mode === "detail") showScreen("war");   // 详情打完回到战报界面再公布战果
      const cnWin = cnIdx < cn.length;
      $("#war-status").textContent = cnWin ? "🐲 三国 全军获胜！" : "🏯 战国 全军获胜！";
      AudioSystem.sfx.victory();
      const champ = cnWin ? cnFighter : jpFighter;
      const survivors = cnWin ? cn.length - cnIdx : jp.length - jpIdx;
      this.running = false;
      $("#war-start").disabled = false;
      if (hero) {
        const heroSideWon = (cnWin ? "cn" : "jp") === hero.side;
        // 与主角同阵营并肩存活到最后的同袍（不含主角自身）
        const mySide = hero.side === "cn" ? cn : jp;
        const myIdx = hero.side === "cn" ? cnIdx : jpIdx;
        const comrades = mySide.slice(myIdx).filter(g => g.id !== -1 && g.hp !== 0);
        RPG.onWarResult(heroKills, heroSideWon, cnWin, comrades);
        return;
      }
      const bg = cnWin ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
      openOverlay(`<div class="result-card">
        <h1>${cnWin ? '三国' : '战国'} 胜!</h1>
        <div class="winner-av" style="background:${bg}">${avatarChar(champ.name)}</div>
        <div class="wname">最后的胜者：${champ.name}</div>
        <div class="wdesc">${cnWin ? '三国' : '战国'}阵营尚余 <b>${survivors}</b> 将，力压群雄，问鼎此役！</div>
        <div class="btns">
          <button class="btn-primary" id="war-again">再战一役</button>
          <button class="btn-ghost" id="war-home">返回菜单</button>
        </div></div>`);
      $("#war-again").onclick = () => { closeOverlay(); this.start(); };
      $("#war-home").onclick = () => { closeOverlay(); showScreen("home"); };
    },
    // 击杀数排行榜（取前 8）
    renderRank(kills) {
      const top = [...kills.values()].sort((a, b) => b.kills - a.kills).slice(0, 8);
      $("#war-rank").innerHTML = `<div class="wr-title">⚔ 击杀排行榜</div>` + top.map((s, i) =>
        `<div class="wr-row ${s.g.side}"><span class="wr-no">${i + 1}</span><span class="wr-name">${s.g.id === -1 ? '★' : ''}${s.g.name}</span><span class="wr-k">${s.kills}</span></div>`).join("");
    },
    open(hero) {
      this.pendingHero = hero || null;   // RPG 入口：先选规模/模式，点「开战」再率军出阵
      $("#war-cn").textContent = DB.bySide("cn").length;
      $("#war-jp").textContent = DB.bySide("jp").length;
      $("#war-log").innerHTML = "";
      $("#war-duel").innerHTML = "";
      $("#war-rank").innerHTML = "";
      $("#war-start").disabled = false;   // 确保任何进入路径都可再次开战
      $("#war-status").textContent = hero
        ? `${hero.name} 整军待发——选好规模与模式后点「开战」率军出阵`
        : (this.mode === "detail"
          ? "详情模式：每一阵都将进入经典单挑画面亲历厮杀（可调速/中途返回）"
          : "点击「开战」，让两军百将随机捉对厮杀");
      showScreen("war");
    },
  };
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }
  function pad(n) { return ("#" + n).padEnd(4, " "); }
  function sideName(side) { return side === "cn" ? "三国" : "战国"; }

  /* ============================================================
   *  组队大战：固定三国 vs 战国，双方各自最多 10 名武将带兵出战。
   *  兵力/训练值/征兵量/计谋/挑唆的数值逻辑均在 engine.js（见 maxTroops 等）；
   *  这里只负责编队、回合编排与界面渲染。玩家指挥己方全队，AI 指挥敌队；
   *  「委托 AI」开启后己方也转为自动。
   * ============================================================ */
  const TeamBattle = {
    gen: 0, cn: [], jp: [], playerSide: "cn", delegated: false, running: false,
    round: 0, kills: { player: 0, ai: 0 }, rpg: false, picking: null, activeUnit: null,

    aiSide() { return this.playerSide === "cn" ? "jp" : "cn"; },
    playerArr() { return this[this.playerSide]; },
    enemyArr() { return this[this.aiSide()]; },
    enemyArrOf(unit) { return unit.side === this.playerSide ? this.enemyArr() : this.playerArr(); },

    begin(picks, side, opts = {}) {
      this.gen++;
      const myGen = this.gen;
      this.playerSide = side;
      this.delegated = false;
      this.picking = null;
      this.activeUnit = null;
      this.running = true;
      this.round = 0;
      this.rpg = !!opts.rpg;
      this.onDone = opts.onDone || null;   // 国战等外部玩法的战斗回调：结束时回传战果而非标准结算
      const oppSide = side === "cn" ? "jp" : "cn";
      // exact 模式（国战攻城等）：双方名单原样上阵、不足不补、不设 10 人上限
      let mine = (opts.exact ? picks.slice() : picks.slice(0, 10)).map(clone);
      if (mine.length < 10 && !opts.exact) {
        const have = new Set(mine.map(p => p.id));
        const pool = DB.bySide(side).filter(g => !have.has(g.id));
        shuffle(pool);
        while (mine.length < 10 && pool.length) mine.push(clone(pool.shift()));
      }
      let theirs;
      if (opts.enemies) {
        theirs = opts.enemies.map(clone);
      } else {
        theirs = DB.bySide(oppSide).slice();
        shuffle(theirs);
        theirs = theirs.slice(0, Math.min(10, theirs.length)).map(clone);
      }
      this.cn = (side === "cn" ? mine : theirs).map(g => makeTroopUnit(g, "cn"));
      this.jp = (side === "jp" ? mine : theirs).map(g => makeTroopUnit(g, "jp"));
      // 全场最大兵力：兵力条长度按各将兵力占此值的比例伸展（最长一条到达数字边）
      this.maxCap = Math.max(...[...this.cn, ...this.jp].map(u => u.maxTroops));
      this.kills = { player: 0, ai: 0 };
      showScreen("teamwar");
      $("#tw-log").innerHTML = "";
      $("#tw-actions").innerHTML = "";
      // 强制重建武将行 DOM：避免沿用上一场战斗遗留的行节点（其点击事件闭包绑定的是上一场的武将对象）
      $("#tw-cn").innerHTML = "";
      $("#tw-jp").innerHTML = "";
      $("#tw-status").textContent = "两军列阵，大战一触即发！";
      this.log(`双方列阵完毕：你方（${sideName(side)}）${mine.length} 将　迎战　敌方（${sideName(oppSide)}·AI）${theirs.length} 将！`);
      this.renderBoard();
      this.loop(myGen);
    },

    async loop(myGen) {
      while (this.gen === myGen) {
        const aliveCN = this.cn.filter(u => u.alive), aliveJP = this.jp.filter(u => u.alive);
        if (!aliveCN.length || !aliveJP.length) { this.finish(myGen); return; }
        this.round++;
        this.log(`—— 第 ${this.round} 回合 ——`);
        const order = [...aliveCN, ...aliveJP]
          .map(u => ({ u, key: u.g.tong + rand(0, 20) }))
          .sort((a, b) => b.key - a.key)
          .map(x => x.u);
        for (const unit of order) {
          if (this.gen !== myGen) return;
          if (!unit.alive) continue;
          if (!this.enemyArrOf(unit).filter(u => u.alive).length) break;  // 对面已全灭，提前结束本轮
          $("#tw-status").textContent = `第 ${this.round} 回合 —— 轮到 ${unit.g.name}（${sideName(unit.side)}）行动`;
          this.activeUnit = unit;
          this.renderBoard();
          if (unit.side === this.playerSide && !this.delegated) {
            await this.playerTurn(unit);
          } else {
            await this.aiTurn(unit);
          }
          if (this.gen !== myGen) return;
          this.renderBoard();
          const c2 = this.cn.filter(u => u.alive).length, j2 = this.jp.filter(u => u.alive).length;
          if (!c2 || !j2) { this.finish(myGen); return; }
        }
      }
    },

    playerTurn(unit) {
      return new Promise(resolve => { this.renderActions(unit, resolve); });
    },

    async aiTurn(unit) {
      await sleep(this.delegated ? 260 : 420);
      const action = this.aiChooseTeamAction(unit);
      if (action.type === "attack") this.doAttack(unit, action.target);
      else if (action.type === "scheme") this.doScheme(unit, action.target, action.key);
      else if (action.type === "recruit") this.doRecruit(unit);
      else if (action.type === "provoke") await this.doProvoke(unit, action.target);
    },

    aiChooseTeamAction(unit) {
      const enemies = this.enemyArrOf(unit).filter(u => u.alive);
      if (!enemies.length) return { type: "recruit" };
      const allies = this[unit.side].filter(u => u.alive && u !== unit);
      const lowSelf = unit.troops < unit.maxTroops * 0.3;
      const r = Math.random();
      // 有智谋的武将会优先驰援兵力告急的同伴
      const hurtAlly = allies.filter(u => u.troops < u.maxTroops * 0.35).sort((a, b) => a.troops - b.troops)[0];
      if (hurtAlly && unit.g.zhi >= 60 && !lowSelf && r < 0.3) return { type: "scheme", target: hurtAlly, key: "reinforce" };
      if (lowSelf && unit.g.zhi >= 60 && r < 0.5) return { type: "scheme", target: unit, key: "rally" };
      if (lowSelf) return { type: "recruit" };
      const weakest = enemies.slice().sort((a, b) => a.troops - b.troops)[0];
      if (r < 0.12 && unit.g.mei >= 55) return { type: "provoke", target: weakest };
      if (r < 0.32 && unit.g.zhi >= 65) return { type: "scheme", target: weakest, key: Math.random() < 0.5 ? "disrupt" : "ambush" };
      return { type: "attack", target: weakest };
    },

    /* ---- 行动面板 ---- */
    renderActions(unit, resolve) {
      this.picking = null;
      const box = $("#tw-actions");
      const finish = () => { box.innerHTML = ""; resolve(); };
      box.innerHTML = `
        <div class="tw-turn">轮到 <b>${unit.g.name}</b>（兵力 ${unit.troops}/${unit.maxTroops}）行动</div>
        <div class="tw-act-row">
          <button class="cup-go primary" id="tw-act-attack">⚔ 带兵攻击</button>
          <button class="cup-go primary" id="tw-act-scheme">🧠 计谋</button>
          <button class="cup-go primary" id="tw-act-provoke">🗣 挑唆</button>
          <button class="cup-go" id="tw-act-recruit">👥 征兵</button>
          <button class="cup-go" id="tw-act-delegate">${this.delegated ? "✓ 已委托 AI" : "🤖 委托 AI"}</button>
        </div>`;
      $("#tw-act-attack").onclick = () => {
        const enemies = this.enemyArr().filter(u => u.alive);
        this.pickTarget("请点选要带兵攻击的敌方武将", enemies,
          target => { this.doAttack(unit, target); finish(); },
          () => this.renderActions(unit, resolve));
      };
      $("#tw-act-scheme").onclick = () => this.renderSchemeMenu(unit, resolve);
      $("#tw-act-provoke").onclick = () => {
        const enemies = this.enemyArr().filter(u => u.alive);
        this.pickTarget("请点选要挑唆的敌方武将", enemies,
          target => { this.doProvoke(unit, target).then(finish); },
          () => this.renderActions(unit, resolve));
      };
      $("#tw-act-recruit").onclick = () => { this.doRecruit(unit); finish(); };
      $("#tw-act-delegate").onclick = () => { this.delegated = true; toast("已委托 AI 指挥己方全队"); finish(); };
    },
    renderSchemeMenu(unit, resolve) {
      this.picking = null;
      const box = $("#tw-actions");
      const finish = () => { box.innerHTML = ""; resolve(); };
      box.innerHTML = `
        <div class="tw-turn">${unit.g.name} 施展何计？</div>
        <div class="tw-act-row">
          ${Object.values(TEAM_TACTICS).map(t => `<button class="cup-go primary" data-k="${t.key}">${t.icon} ${t.name}</button>`).join("")}
          <button class="cup-go" id="tw-scheme-back">‹ 返回</button>
        </div>
        <div class="section-hint">${Object.values(TEAM_TACTICS).map(t => t.name + "：" + t.desc).join(" ｜ ")}</div>`;
      $$("[data-k]", box).forEach(b => b.onclick = () => {
        const key = b.dataset.k;
        if (key === "rally") { this.doScheme(unit, unit, key); finish(); return; }
        if (key === "reinforce") {
          const allies = this.playerArr().filter(u => u.alive && u !== unit);
          this.pickTarget("请点选要驰援的友方武将", allies,
            target => { this.doScheme(unit, target, key); finish(); },
            () => this.renderSchemeMenu(unit, resolve));
          return;
        }
        const enemies = this.enemyArr().filter(u => u.alive);
        this.pickTarget(`请点选【${TEAM_TACTICS[key].name}】的目标`, enemies,
          target => { this.doScheme(unit, target, key); finish(); },
          () => this.renderSchemeMenu(unit, resolve));
      });
      $("#tw-scheme-back").onclick = () => this.renderActions(unit, resolve);
    },
    // 目标选择改为直接点选武将区域对应行（见 renderBoard 的行点击逻辑），不再使用弹窗
    pickTarget(prompt, arr, cb, onCancel) {
      if (!arr.length) { onCancel(); return; }
      this.picking = { arr, cb, onCancel };
      $("#tw-status").textContent = prompt;
      const box = $("#tw-actions");
      box.innerHTML = `<div class="tw-turn">${prompt}</div>
        <div class="tw-act-row"><button class="cup-go" id="tw-pick-cancel">‹ 取消</button></div>`;
      $("#tw-pick-cancel").onclick = () => { this.picking = null; this.renderBoard(); onCancel(); };
      this.renderBoard();
    },

    /* ---- 行动结算 ---- */
    doAttack(unit, target) {
      const { toDef, toAtk } = troopClash(unit, target);
      target.troops -= toDef; unit.troops -= toAtk;
      this.log(`${unit.g.name} 带兵攻击 ${target.g.name}：折损敌兵 ${toDef}，己方反噬损兵 ${toAtk}。`);
      this.checkRout(target); this.checkRout(unit);
    },
    doScheme(caster, target, key) {
      const base = TEAM_TACTICS[key].base;
      const ok = Math.random() < schemeSuccess(caster, target, base);
      const ev = applyTeamScheme(caster, target, key, ok);
      this.log(ev.text);
      this.checkRout(target);
    },
    // 兵力耗尽即溃退出局（计入击杀）；若已阵亡则忽略，避免重复计数
    checkRout(u) {
      if (!u.alive || u.troops > 0) return;
      this.markDead(u);
      this.log(`💥 ${u.g.name} 兵力耗尽，退出战场！`);
    },
    markDead(u) {
      if (!u.alive) return;
      u.troops = 0; u.alive = false;
      if (u.side !== this.playerSide) this.kills.player++; else this.kills.ai++;
    },
    doRecruit(unit) {
      const amt = recruitAmount(unit.g);
      const before = unit.troops;
      unit.troops = Math.min(unit.maxTroops, unit.troops + amt);
      const gained = unit.troops - before;
      this.log(gained > 0 ? `${unit.g.name} 就地征兵，补充兵力 ${gained}。` : `${unit.g.name} 就地征兵，但兵力已满。`);
    },
    async doProvoke(unit, target) {
      const ok = Math.random() < provokeSuccess(unit, target);
      if (!ok) { this.log(`${unit.g.name} 挑唆 ${target.g.name}，未能得逞。`); return; }
      this.log(`${unit.g.name} 挑唆得逞，${target.g.name} 被迫应战，两将转入单挑！`);
      const playerIsUnit = unit.side === this.playerSide;
      const g1 = playerIsUnit ? unit.g : target.g;   // 玩家一方武将固定作为 p1，保证操控权
      const g2 = playerIsUnit ? target.g : unit.g;
      const res = await startTeamDuel(g1, g2, {
        title: "阵前挑唆 · 单挑",
        intro: `${unit.g.name} 挑唆 ${target.g.name}，两将阵前单挑！`,
        spectate: this.delegated,
      });
      showScreen("teamwar");
      if (!res) { this.log("单挑中途中止，双方各自归队。"); return; }
      const loserUnit = res.loser === unit.g ? unit : target;
      this.markDead(loserUnit);
      this.log(`💥 ${loserUnit.g.name} 单挑落败，连兵带将退出战场！`);
    },

    /* ---- 渲染 ---- */
    // 存活武将的评分/兵力总计，用于顶部汇总栏
    teamTotals(arr) {
      const alive = arr.filter(u => u.alive);
      return { score: alive.reduce((s, u) => s + ratingScore(u.g), 0), troops: alive.reduce((s, u) => s + u.troops, 0) };
    },
    // 数字滚动过渡：兵力数值变化时不直接跳变，而是在 dur 毫秒内平滑滚动到新值
    animateNumber(el, from, to, dur = 500) {
      if (from === to) { el.textContent = to; return; }
      const t0 = performance.now();
      const tick = now => {
        const p = Math.min(1, (now - t0) / dur);
        el.textContent = Math.round(from + (to - from) * p);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    renderBoard() {
      this.syncRoster($("#tw-cn"), this.cn);
      this.syncRoster($("#tw-jp"), this.jp);
      const cnT = this.teamTotals(this.cn), jpT = this.teamTotals(this.jp);
      $("#tw-sum-cn").innerHTML = `<span class="tws-tag">🐲 三国 ${this.cn.filter(u => u.alive).length}/${this.cn.length}</span><span class="tws-stat">评分 ${cnT.score}</span><span class="tws-stat">兵力 ${cnT.troops}</span>`;
      $("#tw-sum-jp").innerHTML = `<span class="tws-tag">🏯 战国 ${this.jp.filter(u => u.alive).length}/${this.jp.length}</span><span class="tws-stat">评分 ${jpT.score}</span><span class="tws-stat">兵力 ${jpT.troops}</span>`;
    },
    // 每名武将对应一个常驻的行 DOM（只建一次），之后仅更新其内容——
    // 这样兵力条宽度变化/数字滚动才能真正过渡，而不是每次重建节点导致的瞬间跳变
    syncRoster(container, arr) {
      if (container.children.length !== arr.length) {
        container.innerHTML = arr.map((u, i) => `<div class="tw-unit" data-idx="${i}">
          <div class="tw-namewrap"><span class="tw-name"></span><span class="tw-troops"></span></div>
          <div class="tw-track-area"><span class="tw-track"><span class="tw-fill"></span></span></div>
        </div>`).join("");
        $$(".tw-unit", container).forEach(el => {
          const u = arr[+el.dataset.idx];
          el.onclick = e => {
            if (this.picking) {
              if (this.picking.arr.includes(u)) { const cb = this.picking.cb; this.picking = null; this.renderBoard(); cb(u); }
              return;
            }
            if (e.target.closest(".tw-name")) showDetail(u.g);
          };
        });
      }
      arr.forEach((u, i) => {
        const el = container.children[i];
        const pickable = !!(this.picking && this.picking.arr.includes(u));
        el.classList.toggle("dead", !u.alive);
        el.classList.toggle("pickable", pickable);
        el.classList.toggle("current", u === this.activeUnit && u.alive);
        const nameEl = el.querySelector(".tw-name");
        if (nameEl.textContent !== u.g.name) nameEl.textContent = u.g.name;
        const troopsEl = el.querySelector(".tw-troops");
        const prevTroops = u._dispTroops == null ? u.troops : u._dispTroops;
        if (troopsEl.textContent === "") troopsEl.textContent = u.troops;
        else if (prevTroops !== u.troops) this.animateNumber(troopsEl, prevTroops, u.troops);
        u._dispTroops = u.troops;
        // 条总长 ∝ 该将兵力上限 / 全场最大兵力；条内填充 = 现存兵力比例
        const cap = this.maxCap || Math.max(...arr.map(x => x.maxTroops));
        el.querySelector(".tw-track").style.width = Math.max(8, u.maxTroops / cap * 100) + "%";
        el.querySelector(".tw-fill").style.width = Math.max(0, u.troops / u.maxTroops * 100) + "%";
        // 击杀特效：刚由存活转为阵亡时，闪烁高亮一下再落定为灰暗状态
        if (!u.alive && u._wasAlive) {
          el.classList.remove("kill-flash"); void el.offsetWidth; el.classList.add("kill-flash");
        }
        u._wasAlive = u.alive;
      });
    },
    log(text) {
      const el = document.createElement("div"); el.className = "ln"; el.textContent = text;
      const box = $("#tw-log"); box.appendChild(el); box.scrollTop = box.scrollHeight;
    },

    finish(myGen) {
      if (this.gen !== myGen) return;
      this.running = false;
      this.activeUnit = null;
      this.renderBoard();
      const cnAlive = this.cn.filter(u => u.alive).length, jpAlive = this.jp.filter(u => u.alive).length;
      const playerWon = this.playerSide === "cn" ? cnAlive > 0 : jpAlive > 0;
      const mineAlive = this.playerSide === "cn" ? cnAlive : jpAlive, mineTotal = this.playerArr().length;
      const theirAlive = this.playerSide === "cn" ? jpAlive : cnAlive, theirTotal = this.enemyArr().length;
      this.log(playerWon ? "🎉 敌军溃散，你方大获全胜！" : "💀 己方全军溃败……");
      $("#tw-status").textContent = playerWon ? "大捷！" : "败退……";
      // 外部玩法（国战攻城等）回调：回传双方幸存者与击杀数，由调用方结算
      if (this.onDone) {
        const cb = this.onDone; this.onDone = null;
        const res = {
          playerWon,
          mySurvivors: this.playerArr().filter(u => u.alive).map(u => u.g),
          theirSurvivors: this.enemyArr().filter(u => u.alive).map(u => u.g),
          kills: this.kills.player,
        };
        openOverlay(`<div class="result-card">
          <h1>${playerWon ? "大捷" : "败退"}</h1>
          <div class="wdesc">你方存活 <b>${mineAlive}</b>/${mineTotal} 将，敌方存活 <b>${theirAlive}</b>/${theirTotal} 将。<br>本场击杀敌将 <b style="color:var(--cn-red)">${this.kills.player}</b> 员。</div>
          <div class="btns"><button class="btn-primary" id="tw-cont">回到战局</button></div></div>`);
        $("#tw-cont").onclick = () => { closeOverlay(); cb(res); };
        return;
      }
      openOverlay(`<div class="result-card">
        <h1>${playerWon ? "大捷" : "败退"}</h1>
        <div class="wdesc">你方存活 <b>${mineAlive}</b>/${mineTotal} 将，敌方存活 <b>${theirAlive}</b>/${theirTotal} 将。<br>本场击杀敌将 <b style="color:var(--cn-red)">${this.kills.player}</b> 员。</div>
        <div class="btns">
          <button class="btn-primary" id="tw-again">再来一场</button>
          <button class="btn-ghost" id="tw-home">返回菜单</button>
        </div></div>`);
      $("#tw-again").onclick = () => { closeOverlay(); this.rpg ? RPG.teamBattle() : SelectUI.open("team"); };
      $("#tw-home").onclick = () => { closeOverlay(); showScreen(this.rpg ? "rpg" : "home"); };
      if (this.rpg) RPG.onTeamBattleResult(this.kills.player, playerWon);
    },
  };

  /* ============================================================
   *  国战 · 攻城略地
   *  12 城格子地图（三国/战国各6），相邻方可攻伐或调兵；攻城战按组队大战规则打，
   *  败方全军覆没、武将阵亡本局不复活；空城可直接占领；占领全部 12 城获胜
   * ============================================================ */
  const Conquest = {
    cities: [], edges: [], edgeSet: new Set(),
    playerSide: null, running: false, over: false, busyBattle: false,
    sel: null, turnNo: 1, rpg: false, kills: 0, captures: 0,
    NAMES: {
      cn: ["成都", "洛阳", "长安", "许昌", "襄阳", "建业", "邺城", "汉中", "江陵", "合肥"],
      jp: ["京都", "江户", "大阪", "安土", "名古屋", "小田原", "骏府", "甲府", "春日山", "姬路"],
    },
    ek(i, j) { return i < j ? i + "-" + j : j + "-" + i; },

    /* ---- 随机地图生成：城市总数随机、双方城数随机(≥1)、位置=锚点+抖动(防重叠)，
            连边=Gabriel图(天然无交叉且连通)再修剪 ---- */
    genMap() {
      // 城市总数 9~14；三国城数随机（双方至少 1 城、至多 10 城）
      const N = randInt(9, 14);
      const cnCount = randInt(Math.max(1, N - 10), Math.min(10, N - 1));
      // 4×4 锚点池取 N 个 + 抖动
      const colX = [13, 38, 62, 87], rowY = [12, 38, 62, 88];
      const slots = [];
      for (const y of rowY) for (const x of colX) slots.push({ x, y });
      shuffle(slots);
      const cities = slots.slice(0, N).map(s => ({ x: s.x + rand(-6, 6), y: s.y + rand(-8, 8), units: [] }));
      // 防重叠松弛：过近则沿纵向推开；每轮松弛后收拢回边界
      const clampAll = () => cities.forEach(c => {
        c.x = Math.max(7, Math.min(93, c.x));
        c.y = Math.max(9, Math.min(91, c.y));
      });
      clampAll();
      for (let it = 0; it < 60; it++) {
        let moved = false;
        for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
          const a = cities[i], b = cities[j];
          if (Math.abs(b.x - a.x) < 21 && Math.abs(b.y - a.y) < 15) {
            const s = b.y >= a.y ? 1 : -1;
            a.y -= s * 2; b.y += s * 2; moved = true;
          }
        }
        clampAll();
        if (!moved) break;
      }
      // 归属：按 x 从左到右排序，最左 cnCount 城归三国、其余归战国（保持东西对峙、前线随机）
      cities.sort((a, b) => a.x - b.x || a.y - b.y);
      const cnNames = this.NAMES.cn.slice(), jpNames = this.NAMES.jp.slice();
      shuffle(cnNames); shuffle(jpNames);
      cities.forEach((c, i) => {
        c.side = i < cnCount ? "cn" : "jp";
        c.name = c.side === "cn" ? cnNames.pop() : jpNames.pop();
      });
      // Gabriel 图：两城之间若「以其连线为直径的圆」内无第三城，则修路相连
      const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      let edges = [];
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const mx = (cities[i].x + cities[j].x) / 2, my = (cities[i].y + cities[j].y) / 2;
        const r2 = d2(cities[i], cities[j]) / 4;
        let ok = true;
        for (let k = 0; k < N && ok; k++) {
          if (k === i || k === j) continue;
          if ((cities[k].x - mx) ** 2 + (cities[k].y - my) ** 2 < r2 * 0.96) ok = false;
        }
        if (ok) edges.push([i, j]);
      }
      const deg = (eds, n) => eds.reduce((s, e) => s + (e[0] === n || e[1] === n ? 1 : 0), 0);
      const connected = eds => {
        const seen = new Set([0]), q = [0];
        while (q.length) {
          const u = q.shift();
          for (const [a, b] of eds) { const v = a === u ? b : b === u ? a : -1; if (v >= 0 && !seen.has(v)) { seen.add(v); q.push(v); } }
        }
        return seen.size === N;
      };
      const canDrop = e => {
        const rest = edges.filter(x => x !== e);
        return deg(rest, e[0]) >= 2 && deg(rest, e[1]) >= 2 && connected(rest);
      };
      // 修剪：每城最多 4 条路（从最长的边开始拆）
      for (let n = 0; n < N; n++) {
        let mine = edges.filter(e => e[0] === n || e[1] === n).sort((a, b) => d2(cities[b[0]], cities[b[1]]) - d2(cities[a[0]], cities[a[1]]));
        for (const e of mine) {
          if (deg(edges, n) <= 4) break;
          if (canDrop(e)) edges = edges.filter(x => x !== e);
        }
      }
      // 随机再拆 0~2 条边，增加每局地形变化
      const spare = edges.slice(); shuffle(spare);
      let drops = randInt(0, 2);
      for (const e of spare) {
        if (!drops) break;
        if (canDrop(e)) { edges = edges.filter(x => x !== e); drops--; }
      }
      // 保底：至少 2 条跨阵营通路（不足则补最短的跨界城对）
      const crossCount = () => edges.filter(([a, b]) => cities[a].side !== cities[b].side).length;
      if (crossCount() < 2) {
        const cand = [];
        for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
          if (cities[i].side === cities[j].side) continue;
          if (edges.some(e => e[0] === i && e[1] === j)) continue;
          cand.push([i, j]);
        }
        cand.sort((a, b) => d2(cities[a[0]], cities[a[1]]) - d2(cities[b[0]], cities[b[1]]));
        while (crossCount() < 2 && cand.length) edges.push(cand.shift());
      }
      this.cities = cities;
      this.cities.forEach((c, i) => c.idx = i);
      this.edges = edges;
      this.edgeSet = new Set(edges.map(e => this.ek(e[0], e[1])));
    },
    // 图上 BFS：各城到起点的路网步数
    graphDists(start) {
      const n = this.cities.length;
      const dist = Array(n).fill(Infinity); dist[start] = 0;
      const q = [start];
      while (q.length) {
        const u = q.shift();
        for (const [a, b] of this.edges) {
          const v = a === u ? b : b === u ? a : -1;
          if (v >= 0 && dist[v] > dist[u] + 1) { dist[v] = dist[u] + 1; q.push(v); }
        }
      }
      return dist;
    },
    open() {
      showScreen("conquest");
      if (this.running && !this.over) { this.render(); return; }
      this.askSide();
    },
    askSide() {
      openOverlay(`<div class="result-card">
        <h1>国战 · 攻城略地</h1>
        <div class="wdesc">每局随机生成城池地图与道路——城市数量、双方地盘、各城驻军皆随机（双方武将总数相同）。<br>每回合可「攻城」或「调兵」一次：点选己方城池，再点相邻目标。<br>攻城战按组队大战规则展开——败方全军覆没，武将阵亡本局不复活。<br>占领全部城池者，一统天下！</div>
        <div class="btns">
          <button class="btn-primary" id="cq-side-cn">🐲 执三国</button>
          <button class="btn-primary" style="background:linear-gradient(135deg,var(--jp-indigo),#141e3c)" id="cq-side-jp">🏯 执战国</button>
        </div></div>`);
      $("#cq-side-cn").onclick = () => { closeOverlay(); this.start("cn"); };
      $("#cq-side-jp").onclick = () => { closeOverlay(); this.start("jp"); };
    },
    start(side, opts = {}) {
      this._opts = opts;   // 供「重掷地图」原样重开
      this.playerSide = side;
      this.running = true; this.over = false; this.busyBattle = false;
      this.sel = null; this.turnNo = 1;
      this.rpg = !!opts.rpg; this.kills = 0; this.captures = 0;
      this.genMap();   // 每局随机生成城池布局与道路连通
      const cnCities = this.cities.filter(c => c.side === "cn");
      const jpCities = this.cities.filter(c => c.side === "jp");
      // 双方武将总数相同：完全随机 8~200（各200名真实武将卡池直选，不复编），
      // 且 ≥ 双方城数、≥ 主角+队友人数（同阵营队友必上阵）
      const forcedN = opts.hero ? 1 + (opts.mates || []).length : 0;
      const total = Math.max(cnCities.length, jpCities.length, forcedN,
        Math.min(randInt(8, 200), DB.bySide("cn").length, DB.bySide("jp").length));
      const mkArmy = (s, hero, mates) => {
        const forced = hero ? [clone(hero), ...(mates || []).map(clone)] : [];
        const ids = new Set(forced.map(g => g.id));
        const pool = DB.bySide(s).filter(g => !ids.has(g.id)); shuffle(pool);
        return [...forced, ...pool.map(clone)].slice(0, total);
      };
      // 每城初始武将数随机：先保证每城 1 将，剩余完全随机分配（不设单城上限）
      const deploy = (cityList, gens) => {
        cityList.forEach(c => c.units = []);
        gens.forEach((g, i) => {
          if (i < cityList.length) { cityList[i].units.push(g); return; }
          cityList[randInt(0, cityList.length - 1)].units.push(g);
        });
      };
      deploy(cnCities, mkArmy("cn", opts.hero && opts.hero.side === "cn" ? opts.hero : null, opts.hero && opts.hero.side === "cn" ? opts.mates : null));
      deploy(jpCities, mkArmy("jp", opts.hero && opts.hero.side === "jp" ? opts.hero : null, opts.hero && opts.hero.side === "jp" ? opts.mates : null));
      $("#cq-log").innerHTML = "";
      this.log(`天下大乱：三国 ${cnCities.length} 城、战国 ${jpCities.length} 城，双方各拥 ${total} 员武将。你执${sideName(side)}，攻城略地开始！`);
      showScreen("conquest");
      this.render();
    },
    aiSide() { return this.playerSide === "cn" ? "jp" : "cn"; },
    adj(a, b) { return this.edgeSet.has(this.ek(a.idx, b.idx)); },
    power(units) { return units.reduce((s, g) => s + ratingScore(g), 0); },
    log(text) {
      const el = document.createElement("div"); el.className = "ln"; el.textContent = text;
      const box = $("#cq-log"); box.appendChild(el); box.scrollTop = box.scrollHeight;
    },
    // 出兵行军动画：一枚兵马标记沿道路从出发城滑向目的城
    async marchAnim(A, B) {
      const box = $("#cq-map");
      const el = document.createElement("div");
      el.className = "cq-march";
      el.textContent = "🐎";
      el.style.left = A.x + "%"; el.style.top = A.y + "%";
      box.appendChild(el);
      AudioSystem.sfx.gallop();
      void el.offsetWidth;
      el.style.left = B.x + "%"; el.style.top = B.y + "%";
      await sleep(720);
      el.remove();
    },

    render() {
      const box = $("#cq-map");
      const selCity = this.sel != null ? this.cities[this.sel] : null;
      // 城际道路（SVG）：与选中城相连的道路按 攻(红)/移(绿) 高亮
      const lines = this.edges.map(([i, j]) => {
        const A = this.cities[i], B = this.cities[j];
        let cls = "";
        if (selCity) {
          const o = selCity.idx === i ? j : (selCity.idx === j ? i : -1);
          if (o >= 0) cls = this.cities[o].side !== this.playerSide ? "atk" : "mov";
        }
        return `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="${cls}" vector-effect="non-scaling-stroke"/>`;
      }).join("");
      box.innerHTML = `<svg class="cq-lines" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>` + this.cities.map((c, i) => {
        const isSel = this.sel === i;
        let tag = "";
        if (selCity && !isSel && this.adj(selCity, c)) tag = c.side !== this.playerSide ? "atk" : "mov";
        return `<div class="cq-city ${c.side} ${isSel ? 'sel' : ''} ${tag}" data-i="${i}" style="left:${c.x}%;top:${c.y}%">
          <div class="cqc-name">${c.name}</div>
          <div class="cqc-count">${c.units.length ? c.units.length + " 将" : "空城"}</div>
          ${tag === "atk" ? '<div class="cqc-tag">⚔</div>' : tag === "mov" ? '<div class="cqc-tag">➡</div>' : ''}
        </div>`;
      }).join("");
      $$(".cq-city", box).forEach(el => el.onclick = () => this.onCity(+el.dataset.i));
      const cnN = this.cities.filter(c => c.side === "cn").length;
      $("#cq-status").textContent = this.over ? "战局已定"
        : `第 ${this.turnNo} 回合 · 你的行动 —— 三国 ${cnN} 城 : 战国 ${this.cities.length - cnN} 城${selCity ? ` · ${selCity.name}【${selCity.units.map(g => g.name).join("、")}】→ 点相邻城 ⚔攻/➡移` : " · 点选己方城池"}`;
      const canReroll = !this.over && this.rpg && RPG.char && this.turnNo === 1 && !this.busyBattle;
      $("#cq-actions").innerHTML = this.over
        ? `<button class="cup-go primary" id="cq-restart">再来一局</button>`
        : `<button class="cup-go" id="cq-cancel" ${this.sel == null ? "disabled" : ""}>取消选择</button>
           ${canReroll ? `<button class="cup-go" id="cq-reroll">🎲 重掷地图(30金)</button>` : ""}
           <button class="cup-go primary" id="cq-pass">结束回合</button>`;
      const rs = $("#cq-restart"); if (rs) rs.onclick = () => this.askSide();
      const cc = $("#cq-cancel"); if (cc) cc.onclick = () => { this.sel = null; this.render(); };
      const rr = $("#cq-reroll"); if (rr) rr.onclick = () => {
        if (this.busyBattle) return;
        if (!Bond.spend(30)) { toast("金币不足（重掷需 30 金）"); return; }
        toast("🎲 山川重定！（-30金）");
        this.start(this.playerSide, this._opts);
      };
      const ps = $("#cq-pass"); if (ps) ps.onclick = () => { if (this.busyBattle) return; this.sel = null; this.log("你按兵不动。"); this.afterPlayerAction(); };
    },

    onCity(i) {
      if (this.over || this.busyBattle) return;
      const c = this.cities[i];
      if (this.sel == null) {
        if (c.side === this.playerSide && c.units.length) { this.sel = i; AudioSystem.sfx.select(); this.render(); }
        return;
      }
      if (i === this.sel) { this.sel = null; this.render(); return; }
      const from = this.cities[this.sel];
      if (this.adj(from, c)) {
        if (c.side !== this.playerSide) { this.attack(this.sel, i, true); return; }
        this.move(this.sel, i); return;
      }
      if (c.side === this.playerSide && c.units.length) { this.sel = i; this.render(); }
    },
    async move(a, b) {
      const A = this.cities[a], B = this.cities[b];
      this.sel = null;
      this.busyBattle = true; this.render();
      await this.marchAnim(A, B);
      this.busyBattle = false;
      this.log(`你把 ${A.name} 的 ${A.units.length} 将调往 ${B.name}。`);
      B.units.push(...A.units); A.units = [];
      this.afterPlayerAction();
    },
    async attack(a, b, byPlayer) {
      const A = this.cities[a], B = this.cities[b];
      const atkSide = byPlayer ? this.playerSide : this.aiSide();
      this.sel = null;
      this.busyBattle = true;
      this.render();
      await this.marchAnim(A, B);   // 出征行军动画后再入战
      if (!B.units.length) {   // 空城直接占领
        this.busyBattle = false;
        this.log(`${byPlayer ? "你" : "敌军"}兵不血刃，${A.name} 之军开入空城 ${B.name}！`);
        B.side = atkSide; B.units = A.units; A.units = [];
        if (byPlayer) this.captures++;
        if (byPlayer) this.afterPlayerAction(); else this.afterAiAction();
        return;
      }
      // 每方最多 10 将上阵：超编则随机选拔，攻方其余留守出发城、守方其余城内候命
      const pickSquad = arr => {
        if (arr.length <= 10) return { squad: arr.slice(), reserve: [] };
        const pool = arr.slice(); shuffle(pool);
        return { squad: pool.slice(0, 10), reserve: pool.slice(10) };
      };
      const atk = pickSquad(A.units), def = pickSquad(B.units);
      A.units = atk.reserve;   // 出征队伍即刻离城，留守者驻原城
      this.log(`⚔ ${byPlayer ? "你" : "敌军"}自 ${A.name} 发兵攻打 ${B.name}：出征 ${atk.squad.length} 将${atk.reserve.length ? `（${atk.reserve.length} 将留守）` : ""}，守方 ${def.squad.length} 将上阵${def.reserve.length ? `（${def.reserve.length} 将城内候命）` : ""}！`);
      // 攻城战：玩家一方永远作为 TeamBattle 的「我方」；胜负由 onDone 回传
      const mine = byPlayer ? atk.squad : def.squad;
      const foes = byPlayer ? def.squad : atk.squad;
      TeamBattle.begin(mine, this.playerSide, {
        exact: true, enemies: foes,
        onDone: res => this.applyBattle(A, B, byPlayer, res, atk, def),
      });
    },
    // 城破时未上阵守军撤往相邻友城；无路可退则溃散
    retreatReserve(B, defSide, reserve) {
      if (!reserve.length) return;
      const ret = this.cities.find(c => c.side === defSide && c !== B && this.adj(B, c));
      if (ret) {
        ret.units.push(...reserve);
        this.log(`🏃 ${B.name} 城内候命的 ${reserve.length} 将退往 ${ret.name}。`);
      } else {
        this.log(`💨 ${B.name} 城内候命的 ${reserve.length} 将无路可退，四散溃逃……`);
      }
    },
    applyBattle(A, B, byPlayer, res, atk, def) {
      this.busyBattle = false;
      this.kills += res.kills;
      const byId = list => new Set(list.map(g => g.id));
      const defSide = byPlayer ? this.aiSide() : this.playerSide;
      const atkSide = byPlayer ? this.playerSide : this.aiSide();
      const atkWon = byPlayer ? res.playerWon : !res.playerWon;
      const survIds = byId(atkWon ? (byPlayer ? res.mySurvivors : res.theirSurvivors)
                                  : (byPlayer ? res.theirSurvivors : res.mySurvivors));
      if (atkWon) {
        B.side = atkSide;
        B.units = atk.squad.filter(g => survIds.has(g.id));
        this.retreatReserve(B, defSide, def.reserve);
        if (byPlayer) { this.captures++; this.log(`🎉 你攻克 ${B.name}！${B.units.length} 将入城驻守。`); }
        else this.log(`🔥 ${B.name} 失守！上阵守军全军覆没。`);
      } else {
        B.units = def.squad.filter(g => survIds.has(g.id)).concat(def.reserve);
        this.log(byPlayer ? `💀 攻城失败，出征之军全军覆没……` : `🛡 你守住了 ${B.name}，来犯之敌全军覆没！`);
      }
      showScreen("conquest");
      if (byPlayer) this.afterPlayerAction(); else this.afterAiAction();
    },
    afterPlayerAction() {
      this.render();
      if (this.checkEnd()) return;
      setTimeout(() => this.aiTurn(), 700);
    },
    afterAiAction() {
      if (this.checkEnd()) { this.render(); return; }
      this.turnNo++;
      this.render();
    },

    aiTurn() {
      if (this.over) return;
      const ai = this.aiSide();
      const srcs = this.cities.filter(c => c.side === ai && c.units.length);
      // 1) 攻城：挑实力差最有利的相邻目标；空城白捡必打
      let best = null;
      for (const A of srcs) {
        for (const B of this.cities) {
          if (B.side !== this.playerSide || !this.adj(A, B)) continue;
          const score = B.units.length ? this.power(A.units) - this.power(B.units) : 99999;
          if (!best || score > best.score) best = { A, B, score };
        }
      }
      if (best && (best.score > -60 || Math.random() < 0.25)) {
        const ai2 = this.cities.indexOf(best.A), bi = this.cities.indexOf(best.B);
        this.attack(ai2, bi, false);
        return;
      }
      // 2) 调兵：后方兵力向前线聚拢（沿路网往离敌更近的己方城并军，上限8）
      const distToFoe = c => {
        const d = this.graphDists(c.idx);
        return Math.min(...this.cities.filter(x => x.side === this.playerSide).map(x => d[x.idx]));
      };
      let mv = null;
      for (const A of srcs) {
        for (const B of this.cities) {
          if (B.side !== ai || B === A || !this.adj(A, B)) continue;
          if (distToFoe(B) < distToFoe(A)) { mv = { A, B }; break; }
        }
        if (mv) break;
      }
      if (mv) {
        this.log(`敌军把 ${mv.A.name} 的 ${mv.A.units.length} 将调往 ${mv.B.name}。`);
        mv.B.units.push(...mv.A.units); mv.A.units = [];
      } else {
        this.log("敌军按兵不动。");
      }
      this.afterAiAction();
    },

    checkEnd() {
      if (this.over) return true;
      const N = this.cities.length;
      const cnCities = this.cities.filter(c => c.side === "cn").length;
      const sideUnits = s => this.cities.filter(c => c.side === s).reduce((n, c) => n + c.units.length, 0);
      let winner = null;
      if (cnCities === N || sideUnits("jp") === 0) winner = "cn";
      else if (cnCities === 0 || sideUnits("cn") === 0) winner = "jp";
      if (!winner) return false;
      this.over = true; this.running = false;
      const playerWon = winner === this.playerSide;
      this.log(playerWon ? "🏆 你一统天下！" : "💀 你的势力灰飞烟灭……");
      const desc = `你共攻克 <b style="color:var(--cn-red)">${this.captures}</b> 城，斩敌将 <b style="color:var(--cn-red)">${this.kills}</b> 员。`;
      if (this.rpg) { RPG.onConquestResult(playerWon, this.captures, this.kills); return true; }
      openOverlay(`<div class="result-card">
        <h1>${playerWon ? "一统天下" : "大势已去"}</h1>
        <div class="wdesc">${desc}</div>
        <div class="btns">
          <button class="btn-primary" id="cq-again">再来一局</button>
          <button class="btn-ghost" id="cq-home">返回菜单</button>
        </div></div>`);
      $("#cq-again").onclick = () => { closeOverlay(); this.askSide(); };
      $("#cq-home").onclick = () => { closeOverlay(); showScreen("home"); };
      return true;
    },
  };

  /* ============================================================
   *  数据库管理界面
   * ============================================================ */
  /* ============================================================
   *  武将世界杯：随机分组 → 小组循环赛(取前二) → 单败淘汰
   * ============================================================ */
  const Tournament = {
    size: 32, participants: [], groups: [], koRounds: [], koOffsets: [], champion: null, stage: "setup",
    busy: false, grpReveal: null, grpActive: -1, koReveal: 0, koActive: -1,
    rpgMode: false, fight: null,
    GROUP_NAMES: "ABCDEFGH".split(""),

    open() {
      this.stage = "setup"; this.rpgMode = false; this.fight = null; this.busy = false;
      $("#cup-setup").style.display = "";
      $("#cup-content").innerHTML = "";
      $$(".cup-size").forEach(b => b.classList.toggle("active", +b.dataset.size === this.size));
      showScreen("cup");
    },
    setSize(n) { this.size = n; $$(".cup-size").forEach(b => b.classList.toggle("active", +b.dataset.size === n)); },
    beginRandom() {
      const pool = DB.list.slice(); shuffle(pool);
      this.begin(pool.slice(0, this.size));
    },
    begin(parts) {
      parts = parts.slice(0, this.size);
      // 不足则随机补满
      if (parts.length < this.size) {
        const have = new Set(parts.map(p => p.id));
        const pool = DB.list.filter(g => !have.has(g.id)); shuffle(pool);
        while (parts.length < this.size && pool.length) parts.push(pool.shift());
      }
      this.participants = parts.map(clone);
      $("#cup-setup").style.display = "none";
      this.draw();
      showScreen("cup");
    },
    draw() {
      shuffle(this.participants);
      const n = this.size, gcount = n / 4;
      this.groups = [];
      for (let i = 0; i < gcount; i++) {
        this.groups.push({ name: this.GROUP_NAMES[i], teams: this.participants.slice(i * 4, i * 4 + 4), table: [], adv: [] });
      }
      this.koRounds = []; this.koOffsets = []; this.champion = null;
      this.grpReveal = null; this.grpActive = -1; this.koReveal = 0; this.koActive = -1;
      this.predict = null;   // 本届竞猜预测表
      this.cupExp = 0;   // 本届世界杯累计的「单挑获胜经验」
      this.stage = "drawn";
      this.render();
    },
    async runGroups() {
      if (this.busy) return; this.busy = true;
      this.grpReveal = 0; this.grpActive = -1;
      for (let gi = 0; gi < this.groups.length; gi++) {
        const grp = this.groups[gi];
        this.grpActive = gi; this.render();
        await sleep(360);
        const stat = new Map(grp.teams.map(t => [t.id, { g: t, w: 0, l: 0, hp: 0 }]));
        const pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
        for (const [i, j] of pairs) {
          const a = grp.teams[i], b = grp.teams[j];
          let winnerId, aHp, bHp;
          if (this.rpgMode && (a.id === -1 || b.id === -1)) {
            // 轮到自选武将：手动单挑
            const r = await this.playManualMatch(a, b, `世界杯·${grp.name}组`);
            winnerId = r.winner.id; aHp = r.finalHp[0]; bHp = r.finalHp[1];
            if (winnerId === -1) this.cupExp += RPG.winExp(ratingScore(RPG.heroGeneral()), ratingScore(a.id === -1 ? b : a));
          } else {
            const res = autoBattle(a, b);
            aHp = res.p1.g.id === a.id ? res.p1.hp : res.p2.hp;
            bHp = res.p1.g.id === b.id ? res.p1.hp : res.p2.hp;
            winnerId = res.winner.id;
          }
          const sa = stat.get(a.id), sb = stat.get(b.id);
          sa.hp += Math.max(0, aHp); sb.hp += Math.max(0, bHp);
          if (winnerId === a.id) { sa.w++; sb.l++; } else { sb.w++; sa.l++; }
        }
        grp.table = [...stat.values()].sort((x, y) => y.w - x.w || y.hp - x.hp);
        grp.adv = grp.table.slice(0, 2).map(s => s.g);
        this.grpReveal = gi + 1; this.grpActive = -1;
        AudioSystem.sfx.hit();
        this.render();
        await sleep(200);
      }
      this.stage = "groups"; this.busy = false; this.render();
    },
    async runKnockout() {
      if (this.busy) return; this.busy = true;
      // 世界杯式交叉布阵：每两组之间 胜者×负者 交叉
      const ko = [];
      for (let k = 0; k < this.groups.length; k += 2) {
        const g1 = this.groups[k], g2 = this.groups[k + 1];
        ko.push(g1.adv[0], g2.adv[1], g2.adv[0], g1.adv[1]);
      }
      // RPG 模式：英雄场手动单挑，逐轮即时进行
      if (this.rpgMode) { await this.runKnockoutRpg(ko); return; }
      // 预先算出全部结果（含逐回合体力序列）
      this.koRounds = []; this.koOffsets = [];
      let arr = ko, off = 0;
      while (arr.length > 1) {
        const matches = [];
        for (let i = 0; i < arr.length; i += 2) {
          const res = autoBattle(arr[i], arr[i + 1]);
          matches.push({ a: arr[i], b: arr[i + 1], winner: res.winner, rounds: res.rounds, hpSeq: res.hpSeq, startHp: res.startHp, finalHp: res.hpSeq[res.hpSeq.length - 1] });
        }
        this.koOffsets.push(off); off += matches.length;
        this.koRounds.push({ name: this.roundName(arr.length), matches });
        arr = matches.map(m => m.winner);
      }
      const total = off;
      // 逐场揭晓动画（体力数字逐回合递减）
      this.stage = "ko"; this.koReveal = 0; this.koActive = -1; this.champion = null; this.fight = null;
      this.render(); this.scrollTree();
      await this.askPrediction();   // 开赛前竞猜（结果已算好但未揭晓，公平）
      for (let gi = 0; gi < total; gi++) {
        const match = this.matchByGi(gi);
        this.koActive = gi;
        this.fight = { a: match.a, b: match.b, aHp: match.startHp[0], bHp: match.startHp[1] };
        this.render(); this.scrollTree();
        await sleep(350);
        // 逐回合扣血动画
        for (let s = 1; s < match.hpSeq.length; s++) {
          this.fight.aHp = match.hpSeq[s][0]; this.fight.bHp = match.hpSeq[s][1];
          this.updateFightHp(); AudioSystem.sfx.hit();
          await sleep(260);
        }
        await sleep(280);
        this.koReveal = gi + 1; this.koActive = -1; this.fight = null;
        this.render(); this.scrollTree();
        await sleep(160);
      }
      this.champion = arr[0];
      this.stage = "done";
      AudioSystem.sfx.victory();
      this.busy = false; this.render();
      this.settlePrediction(() => {
        if (this.rpgMode) { this.rpgMode = false; RPG.onCupResult(this.heroPlacement()); }
      });
    },

    // RPG 淘汰赛：逐轮即时，英雄场手动单挑、其余自动并演示体力
    async runKnockoutRpg(initial) {
      this.koRounds = []; this.koOffsets = [];
      this.stage = "ko"; this.koReveal = 0; this.koActive = -1; this.champion = null; this.fight = null;
      // 预建完整对阵树骨架（各轮框线一开始就全部显示，未决出场以「？」占位）
      const TBD = { id: 0, name: "？", side: "" };
      let off = 0;
      for (let n = initial.length, r = 0; n > 1; n /= 2, r++) {
        const cnt = n / 2, matches = [];
        for (let i = 0; i < cnt; i++) {
          if (r === 0) matches.push({ a: initial[i * 2], b: initial[i * 2 + 1], winner: null });
          else matches.push({ a: TBD, b: TBD, winner: null });
        }
        this.koOffsets.push(off); off += cnt;
        this.koRounds.push({ name: this.roundName(n), matches });
      }
      this.render(); this.scrollTree();
      await this.askPrediction();   // 开赛前竞猜
      // 逐轮进行；每轮开始时用上一轮胜者填充对阵
      for (let r = 0; r < this.koRounds.length; r++) {
        const rd = this.koRounds[r], rname = rd.name;
        if (r > 0) for (let mi = 0; mi < rd.matches.length; mi++) {
          rd.matches[mi].a = this.koRounds[r - 1].matches[mi * 2].winner;
          rd.matches[mi].b = this.koRounds[r - 1].matches[mi * 2 + 1].winner;
        }
        for (let mi = 0; mi < rd.matches.length; mi++) {
          const m = rd.matches[mi], gi = this.koOffsets[r] + mi;
          if (m.a.id === -1 || m.b.id === -1) {
            const res = await this.playManualMatch(m.a, m.b, `世界杯·${rname}`);
            m.winner = res.winner; m.finalHp = res.finalHp;
            if (res.winner.id === -1) this.cupExp += RPG.winExp(ratingScore(RPG.heroGeneral()), ratingScore(m.a.id === -1 ? m.b : m.a));
            this.koReveal = gi + 1; this.render(); this.scrollTree(); await sleep(200);
          } else {
            const res = autoBattle(m.a, m.b);
            m.winner = res.winner; m.finalHp = res.hpSeq[res.hpSeq.length - 1];
            this.koActive = gi; this.fight = { a: m.a, b: m.b, aHp: res.startHp[0], bHp: res.startHp[1] };
            this.render(); this.scrollTree(); await sleep(280);
            for (let s = 1; s < res.hpSeq.length; s++) { this.fight.aHp = res.hpSeq[s][0]; this.fight.bHp = res.hpSeq[s][1]; this.updateFightHp(); AudioSystem.sfx.hit(); await sleep(150); }
            await sleep(150);
            this.koActive = -1; this.fight = null; this.koReveal = gi + 1; this.render(); this.scrollTree(); await sleep(120);
          }
        }
      }
      this.champion = this.koRounds[this.koRounds.length - 1].matches[0].winner;
      this.stage = "done"; AudioSystem.sfx.victory();
      this.busy = false; this.render();
      this.settlePrediction(() => {
        this.rpgMode = false;
        RPG.onCupResult(this.heroPlacement(), this.cupExp);
      }, true);
    },

    /* ---- 世界杯竞猜：淘汰赛开打前填满整张预测表，赛后按命中率计分，猜中冠军翻倍 ---- */
    askPrediction() {
      return new Promise(res => {
        const rounds = this.koRounds;
        const picks = [];
        const doRound = (r, entrants) => {
          const n = entrants.length / 2;
          openOverlay(`<div class="result-card pred-card">
            <h1>世界杯竞猜</h1>
            <div class="wname">${rounds[r].name} · 点选每场你看好的胜者</div>
            <div class="pred-list">
              ${Array.from({ length: n }, (_, m) => `
                <div class="pred-pair">
                  <button class="pred-side ${entrants[m * 2].side || ''}" data-m="${m}" data-s="0">${this.heroMark(entrants[m * 2])}${entrants[m * 2].name}</button>
                  <span class="pred-vs">VS</span>
                  <button class="pred-side ${entrants[m * 2 + 1].side || ''}" data-m="${m}" data-s="1">${this.heroMark(entrants[m * 2 + 1])}${entrants[m * 2 + 1].name}</button>
                </div>`).join("")}
            </div>
            <div class="btns">
              <button class="btn-primary" id="pred-next" disabled>确定</button>
              ${r === 0 ? '<button class="btn-ghost" id="pred-skip">跳过竞猜</button>' : ''}
            </div></div>`);
          const sel = new Array(n).fill(-1);
          $$(".pred-side").forEach(b => b.onclick = () => {
            const m = +b.dataset.m, s = +b.dataset.s;
            sel[m] = s;
            AudioSystem.sfx.select();
            $$(`.pred-side[data-m="${m}"]`).forEach(x => x.classList.toggle("on", +x.dataset.s === s));
            $("#pred-next").disabled = sel.includes(-1);
          });
          if (r === 0) $("#pred-skip").onclick = () => { this.predict = null; closeOverlay(); res(); };
          $("#pred-next").onclick = () => {
            const winners = sel.map((s, m) => entrants[m * 2 + s]);
            picks.push(winners.map(w => w.id));
            if (winners.length === 1) {
              this.predict = { picks, champion: winners[0].id };
              closeOverlay();
              toast(`竞猜完成！你看好 ${winners[0].name} 夺冠`);
              res();
            } else {
              doRound(r + 1, winners);
            }
          };
        };
        const first = [];
        rounds[0].matches.forEach(m => { first.push(m.a, m.b); });
        doRound(0, first);
      });
    },
    // 竞猜结算：第 r 轮每命中一场得 (r+1)×10 分；猜中冠军总分翻倍；RPG 模式折算经验计入 cupExp
    settlePrediction(next, rpg) {
      const P = this.predict;
      this.predict = null;
      if (!P) { next && next(); return; }
      let score = 0;
      const lines = [];
      for (let r = 0; r < this.koRounds.length; r++) {
        const rd = this.koRounds[r];
        let hit = 0;
        for (let m = 0; m < rd.matches.length; m++) {
          if (P.picks[r] && rd.matches[m].winner && P.picks[r][m] === rd.matches[m].winner.id) { hit++; score += (r + 1) * 10; }
        }
        lines.push(`${rd.name}：命中 ${hit}/${rd.matches.length}`);
      }
      const champHit = this.champion && P.champion === this.champion.id;
      if (champHit) score *= 2;
      if (rpg && score > 0) Bond.addGold(score, "世界杯竞猜");
      openOverlay(`<div class="result-card">
        <h1>竞猜结算</h1>
        <div class="wname">${champHit ? "🎯 神机妙算！猜中冠军，得分翻倍！" : "赛果揭晓"}</div>
        <div class="wdesc">${lines.join("<br>")}<br>冠军预测：${champHit ? "✅ 命中" : "❌ 未中"}<br>竞猜得分 <b style="font-size:22px;color:var(--cn-red)">${score}</b>${rpg ? `<br>竞猜奖金 <b style="color:var(--cn-red)">+${score} 金</b>` : ""}</div>
        <div class="btns"><button class="btn-primary" id="pred-ok">确定</button></div></div>`);
      $("#pred-ok").onclick = () => { closeOverlay(); next && next(); };
    },

    // 手动单挑一场（用于世界杯英雄场），resolve 出胜者与终局体力
    // 始终让自选武将(英雄)落在左侧(p1)由玩家操控，再把体力按对阵(a,b)顺序还原
    playManualMatch(a, b, title) {
      const heroIsB = b.id === -1;           // 英雄在对阵右侧 → 入场时交换到左侧
      const left = heroIsB ? b : a, right = heroIsB ? a : b;
      return new Promise(res => {
        startClassicBattle(left, right, false, false);
        $("#battle-title").textContent = title || "世界杯";
        BATTLE.cupResolve = () => {
          const winner = BATTLE.p1.hp > 0 ? BATTLE.p1.g : BATTLE.p2.g;
          const hL = Math.max(0, Math.round(BATTLE.p1.hp)), hR = Math.max(0, Math.round(BATTLE.p2.hp));
          // 还原为对阵 (a,b) 顺序：若交换过，则 a=右、b=左
          res({ winner, finalHp: heroIsB ? [hR, hL] : [hL, hR] });
        };
      });
    },
    matchByGi(gi) {
      for (let r = 0; r < this.koRounds.length; r++) {
        const len = this.koRounds[r].matches.length;
        if (gi < this.koOffsets[r] + len) return this.koRounds[r].matches[gi - this.koOffsets[r]];
      }
      return null;
    },
    updateFightHp() {
      const a = $("#hp-0"), b = $("#hp-1");
      if (a) a.textContent = Math.max(0, this.fight.aHp);
      if (b) b.textContent = Math.max(0, this.fight.bHp);
    },
    // RPG 英雄(id=-1)最终名次
    heroPlacement() {
      if (!this.champion) return null;
      if (this.champion.id === -1) return { label: "夺冠", exp: 260 };
      // 是否进入淘汰赛
      const advanced = this.groups.some(g => g.adv.some(a => a.id === -1));
      if (!advanced) return { label: "小组未出线", exp: 0 }; // 未出线无晋级奖励
      let lastRound = -1;
      for (let r = 0; r < this.koRounds.length; r++) {
        for (const m of this.koRounds[r].matches) {
          if ((m.a.id === -1 || m.b.id === -1)) { lastRound = r; if (m.winner.id !== -1) { return { label: this.koRounds[r].name + "止步", exp: 50 + r * 45 }; } }
        }
      }
      return { label: "出线", exp: 70 };
    },
    // 单场对阵框（供上/下半区与决赛复用）
    matchBox(r, m) {
      const gi = this.koOffsets[r] + m;
      const decided = gi < this.koReveal, active = gi === this.koActive;
      const A = this.slotInfo(r, m, 0), B = this.slotInfo(r, m, 1);
      const match = this.koRounds[r].matches[m];
      const aw = decided && match.winner.id === match.a.id;
      const bw = decided && match.winner.id === match.b.id;
      // 体力数字（紧挨姓名）：当前场实时递减，已决出场显示终值
      const hpA = active ? `<span class="ts-hp" id="hp-0">${this.fight ? this.fight.aHp : ''}</span>`
        : (decided ? `<span class="ts-hp">${match.finalHp[0]}</span>` : "");
      const hpB = active ? `<span class="ts-hp" id="hp-1">${this.fight ? this.fight.bHp : ''}</span>`
        : (decided ? `<span class="ts-hp">${match.finalHp[1]}</span>` : "");
      return `<div class="tree-match ${active ? 'active' : ''} ${decided ? 'done' : ''}" data-gi="${gi}">
        <div class="tree-slot ${A.side} ${A.hero ? 'hero' : ''} ${aw ? 'win' : (decided ? 'lose' : '')}"><span class="ts-name">${A.hero ? '★' : ''}${A.name}</span>${hpA}</div>
        <div class="tree-slot ${B.side} ${B.hero ? 'hero' : ''} ${bw ? 'win' : (decided ? 'lose' : '')}"><span class="ts-name">${B.hero ? '★' : ''}${B.name}</span>${hpB}</div>
        ${active ? '<div class="tree-fight">⚔</div>' : ''}</div>`;
    },
    // 让当前进行中的对阵框滚动到可视区域（替代旧的「一律滚到最右」，避免早期轮次被推出屏幕）
    scrollTree() {
      const act = $("#cup-content .tree-match.active");
      if (act && act.scrollIntoView) act.scrollIntoView({ block: "nearest", inline: "center" });
    },
    roundName(n) {
      return ({ 16: "十六强赛", 8: "八强赛", 4: "半决赛", 2: "决赛" })[n] || (n + "强赛");
    },

    heroMark(g) { return g && g.id === -1 ? "★" : ""; },
    // 对阵树某场的某一方名字（依揭晓进度决定是否已知）
    slotInfo(r, m, slot) {
      const match = this.koRounds[r].matches[m];
      if (r === 0) { const g = slot === 0 ? match.a : match.b; return { name: g.name, side: g.side, hero: g.id === -1 }; }
      const feederGi = this.koOffsets[r - 1] + (m * 2 + slot);
      if (feederGi < this.koReveal) { const g = slot === 0 ? match.a : match.b; return { name: g.name, side: g.side, hero: g.id === -1 }; }
      return { name: "？", side: "", hero: false };
    },

    render() {
      const C = $("#cup-content");
      let h = "";
      if (this.champion) {
        const c = this.champion;
        h += `<div class="cup-champ ${c.side}">
          <div class="cc-cup">🏆</div>
          <div class="cc-name">${c.name}</div>
          <div class="cc-sub">${c.side === 'cn' ? '三国' : '战国'} · ${c.title || ''}</div>
          <div class="cc-tag">世 界 杯 冠 军</div></div>`;
      }
      // 控制按钮
      h += `<div class="cup-actions">`;
      if (this.stage === "drawn" && !this.busy) h += `<button class="cup-go primary" id="cup-run-groups">⚔ 开始小组赛</button>`;
      if (this.stage === "groups" && !this.busy) h += `<button class="cup-go primary" id="cup-run-ko">🔥 进入淘汰赛</button>`;
      if (!this.busy) h += `<button class="cup-go" id="cup-redraw">↺ 重新抽签</button>`;
      if (this.busy) h += `<div class="cup-running">⚔ 激战中…</div>`;
      h += `</div>`;

      // 淘汰赛对阵树；所有轮次框线自始至终全部显示。
      // 窄屏(折叠形态)：横向单排，最左第一轮 → 逐轮向右 → 冠军（保持原布局）。
      // 宽屏(折叠屏展开)：上下半区——每轮对阵对半分到上/下半区（32人赛十六强上下各4对、
      // 八强各2对、半决赛各1对），决赛与冠军置于屏幕中间；16人赛同理。
      if (this.koRounds && this.koRounds.length) {
        const champCol = `<div class="tree-col champ-col"><div class="tree-col-name">冠军</div><div class="tree-col-body">
          <div class="tree-match champ ${this.champion ? this.champion.side : ''}">
            <div class="tree-slot champ-slot">${this.champion ? '👑 ' + this.heroMark(this.champion) + this.champion.name : '？'}</div></div></div></div>`;
        const wide = window.matchMedia("(min-width: 620px)").matches;
        if (!wide) {
          h += `<div class="cup-tree">`;
          for (let r = 0; r < this.koRounds.length; r++) {
            const rd = this.koRounds[r];
            h += `<div class="tree-col"><div class="tree-col-name">${rd.name}</div><div class="tree-col-body">`;
            for (let m = 0; m < rd.matches.length; m++) h += this.matchBox(r, m);
            h += `</div></div>`;
          }
          h += champCol + `</div>`;
        } else {
          const rounds = this.koRounds, L = rounds.length;
          const nonFinal = rounds.slice(0, L - 1);   // 决赛之前的各轮，对半分到上下半区
          // 每轮一行、横向排开；上半区从最上(第一轮)逐轮向下，下半区镜像(从最下逐轮向上)，
          // 晋级方向为纵向：两端向中间的决赛汇聚
          const rowHtml = (rd, r, which) => {
            const h2 = rd.matches.length / 2;
            const start = which === "top" ? 0 : h2;
            let body = "";
            for (let k = 0; k < h2; k++) body += this.matchBox(r, start + k);
            return `<div class="ko-row"><div class="ko-row-name">${rd.name}</div><div class="ko-row-body">${body}</div></div>`;
          };
          const rowsFor = which => nonFinal.map((rd, r) => rowHtml(rd, r, which));
          const finalCol = `<div class="tree-col"><div class="tree-col-name">${rounds[L - 1].name}</div><div class="tree-col-body">${this.matchBox(L - 1, 0)}</div></div>`;
          h += `<div class="ko-bracket">
            <div class="ko-region top">${rowsFor("top").join("")}</div>
            <div class="ko-region final"><div class="ko-final-cols">${finalCol}${champCol}</div></div>
            <div class="ko-region bottom">${rowsFor("bottom").reverse().join("")}</div>
          </div>`;
        }
      }

      // 小组
      h += `<div class="cup-groups">`;
      for (let gi = 0; gi < this.groups.length; gi++) {
        const grp = this.groups[gi];
        const revealed = this.grpReveal != null && gi < this.grpReveal && grp.table.length;
        const active = gi === this.grpActive;
        h += `<div class="cup-group ${active ? 'active' : ''}"><div class="cg-name">${grp.name} 组${active ? ' ⚔' : ''}</div>`;
        if (revealed) {
          h += `<table class="cg-table"><tr><th>武将</th><th>胜</th><th>负</th></tr>`;
          grp.table.forEach((s, idx) => {
            h += `<tr class="${idx < 2 ? 'adv' : ''} ${s.g.side}"><td>${idx < 2 ? '✓ ' : ''}${this.heroMark(s.g)}${s.g.name}</td><td>${s.w}</td><td>${s.l}</td></tr>`;
          });
          h += `</table>`;
        } else {
          h += grp.teams.map(t => `<div class="cg-member ${t.side}">${this.heroMark(t)}${t.name}</div>`).join("");
        }
        h += `</div>`;
      }
      h += `</div>`;
      C.innerHTML = h;

      const rg = $("#cup-run-groups"); if (rg) rg.onclick = () => this.runGroups();
      const rk = $("#cup-run-ko"); if (rk) rk.onclick = () => this.runKnockout();
      const rd = $("#cup-redraw"); if (rd) rd.onclick = () => { this.koRounds = []; this.grpReveal = null; this.draw(); };
    },
  };

  /* ============================================================
   *  友谊 & 金币（随自选武将征战积累；挚友可花金招募入队，生死之交免费）
   * ============================================================ */
  const BOND_KEY = "wujiang_bond_v1";
  const Bond = {
    data: { gold: 0, friends: {}, team: [], giftDay: {} },
    load() {
      try { const d = JSON.parse(localStorage.getItem(BOND_KEY)); if (d) this.data = Object.assign({ gold: 0, friends: {}, team: [], giftDay: {} }, d); } catch { }
    },
    save() { localStorage.setItem(BOND_KEY, JSON.stringify(this.data)); },
    gold() { return this.data.gold; },
    addGold(n, why) {
      if (!RPG.char || n <= 0) return;
      this.data.gold += Math.round(n); this.save();
      if (why) toast(`💰 +${Math.round(n)} 金 · ${why}`);
    },
    spend(n) { if (this.data.gold < n) return false; this.data.gold -= n; this.save(); return true; },
    pts(id) { return this.data.friends[id] || 0; },
    addF(id, n) {
      if (!RPG.char || id == null || id === -1) return;
      this.data.friends[id] = Math.min(999, (this.data.friends[id] || 0) + n);
    },
    addMany(gens, n) { (gens || []).forEach(g => g && this.addF(g.id, n)); this.save(); },
    LEVELS: [[250, "生死之交"], [150, "挚友"], [80, "好友"], [30, "相识"], [0, "陌生"]],
    levelName(p) { return this.LEVELS.find(([t]) => p >= t)[1]; },
    nextThreshold(p) { const up = this.LEVELS.slice().reverse().find(([t]) => t > p); return up ? up[0] : null; },
    teamLimit() { return 5 + Math.floor(((RPG.char && RPG.char.level) || 1) / 10); },
    inTeam(id) { return this.data.team.includes(id); },
    teamGenerals() { return this.data.team.map(id => DB.get(id)).filter(Boolean); },
    recruitCost(g) { return ratingScore(g) * 2; },
    // 招募：挚友(150)可花金，生死之交(250)免费
    recruit(g) {
      const p = this.pts(g.id);
      if (this.inTeam(g.id)) { toast(`${g.name} 已在队中`); return false; }
      if (p < 150) { toast("友谊未到「挚友」，还不能招募"); return false; }
      if (this.data.team.length >= this.teamLimit()) { toast(`团队已满（${this.teamLimit()} 人上限）`); return false; }
      const cost = p >= 250 ? 0 : this.recruitCost(g);
      if (cost > 0 && !this.spend(cost)) { toast(`金币不足（需 ${cost} 金）`); return false; }
      this.data.team.push(g.id); this.save();
      AudioSystem.sfx.victory();
      toast(`🎉 ${g.name} 加入了你的团队！${cost ? `（花费 ${cost} 金）` : "（生死之交，分文不取）"}`);
      return true;
    },
    dismiss(id) { this.data.team = this.data.team.filter(x => x !== id); this.save(); },
    GIFTS: [
      { k: "wine", n: "浊酒", icon: "🍶", cost: 20, add: 10 },
      { k: "horse", n: "名马", icon: "🐎", cost: 80, add: 20 },
      { k: "sword", n: "宝刀", icon: "⚔️", cost: 200, add: 30 },
    ],
    // 赠礼：每名武将每天限一次
    gift(g, kind) {
      const def = this.GIFTS.find(x => x.k === kind);
      const today = new Date().toISOString().slice(0, 10);
      if (this.data.giftDay[g.id] === today) { toast(`今天已赠过 ${g.name}，明日再来`); return false; }
      if (!this.spend(def.cost)) { toast(`金币不足（${def.n} 需 ${def.cost} 金）`); return false; }
      this.data.giftDay[g.id] = today;
      this.addF(g.id, def.add); this.save();
      AudioSystem.sfx.select();
      toast(`${def.icon} 赠 ${g.name}【${def.n}】，友谊 +${def.add}`);
      return true;
    },
  };

  /* ============================================================
   *  角色扮演：自创/选用武将，随机六维(基线+加点)，历练获经验成长
   * ============================================================ */
  const RPG_KEY = "wujiang_rpg_v1";
  function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  const RPG = {
    char: null,
    load() { try { this.char = JSON.parse(localStorage.getItem(RPG_KEY)); } catch { this.char = null; } },
    save() { localStorage.setItem(RPG_KEY, JSON.stringify(this.char)); },
    expNeed(lv) { return 80 + lv * 70; },
    eff(c, k) { return c.base[k] + (c.alloc[k] || 0); },
    heroGeneral() {
      const c = this.char;
      const g = { id: -1, name: c.name, side: c.side, title: `Lv.${c.level} 历练者`, intro: c.intro || "你亲手培养的武将。" };
      DIMS.forEach(([k]) => g[k] = this.eff(c, k));
      return g;
    },
    // 随机生成基线六维(最大不超过80) + 一笔由玩家自行分配的加点(最多30)
    rollStats() {
      const base = {};
      DIMS.forEach(([k]) => base[k] = randInt(45, 80));
      return { base, points: randInt(18, 30) };
    },

    open() {
      this.load();
      if (this.char) this.renderHub();
      else this.renderCreate();
      // 重建角色按钮常驻右上角（音乐按钮左侧）
      $("#rpg-reset").onclick = () => {
        if (!this.char) { this.renderCreate(); return; }
        if (confirm("放弃当前角色，重新创建？")) { this.char = null; localStorage.removeItem(RPG_KEY); this.renderCreate(); }
      };
      showScreen("rpg");
    },

    /* ---- 创建 ---- */
    renderCreate(tab) {
      tab = tab || "custom";
      const C = $("#rpg-content");
      let h = `<div class="rpg-create">
        <div class="section-hint">创建你的专属武将：随机基线六维，出道后自行分配加点成长</div>
        <div class="side-tabs">
          <div class="rpg-ctab ${tab === 'custom' ? 'active' : ''}" data-tab="custom">✦ 自创武将</div>
          <div class="rpg-ctab ${tab === 'pick' ? 'active' : ''}" data-tab="pick">📜 选用名将</div>
        </div>`;
      if (tab === "custom") {
        if (!this._roll) this._roll = this.rollStats();
        const r = this._roll;
        h += `<div class="rpg-form">
          <div class="rf-row"><label>姓名</label><input id="rpg-name" maxlength="6" placeholder="输入名字" value="${this._name || ''}"></div>
          <div class="rf-row"><label>阵营</label>
            <select id="rpg-side"><option value="cn">三国 风</option><option value="jp">战国 风</option></select></div>
          <div class="rpg-roll-box">${DIMS.map(([k, l]) => {
            const v = r.base[k];
            return `<div class="rr-dim"><span>${l}</span>
              <span class="rr-track"><span class="rr-bar" style="width:${Math.min(100, v / 1.2)}%;background:${gradeColor(v)}"></span></span>
              <b>${v}</b>${gradeChip(v)}</div>`;
          }).join("")}
            <div class="rr-sum">基线评分 <b>${ratingScore(r.base)}</b> ${ratingChip(r.base)} · 可分配加点 <b style="color:var(--cn-gold)">${r.points}</b></div>
          </div>
          <div class="rpg-create-btns">
            <button class="cup-go" id="rpg-reroll">🎲 重新随机</button>
            <button class="cup-go primary" id="rpg-create-go">✓ 出道（去分配加点）</button>
          </div></div>`;
      } else {
        h += `<div class="section-hint">从武将库选一位作为你的角色（以其属性为基线，后续可成长）</div>
          <div class="search-box"><input id="rpg-search" placeholder="搜索…"></div>
          <div class="grid" id="rpg-pick-grid"></div>`;
      }
      h += `</div>`;
      C.innerHTML = h;
      $$(".rpg-ctab").forEach(t => t.onclick = () => { this._roll = null; this.renderCreate(t.dataset.tab); });
      if (tab === "custom") {
        $("#rpg-reroll").onclick = () => { this._name = $("#rpg-name").value; this._roll = this.rollStats(); this.renderCreate("custom"); };
        $("#rpg-create-go").onclick = () => {
          const name = ($("#rpg-name").value || "").trim() || "无名客";
          this.create(name, $("#rpg-side").value, this._roll.base, this._roll.points);
        };
      } else {
        this.renderPickGrid();
        $("#rpg-search").oninput = () => this.renderPickGrid();
      }
    },
    renderPickGrid() {
      const kw = ($("#rpg-search").value || "").trim();
      let arr = DB.list.slice().sort((a, b) => ratingScore(b) - ratingScore(a));
      if (kw) arr = arr.filter(g => g.name.includes(kw));
      $("#rpg-pick-grid").innerHTML = arr.slice(0, 80).map(g =>
        `<div class="card ${g.side}" data-id="${g.id}"><div class="avatar">${avatarChar(g.name)}</div>
          <div class="cname">${g.name}</div><div class="cwu">评分 ${ratingScore(g)} ${ratingChip(g)}</div></div>`).join("");
      $$("#rpg-pick-grid .card").forEach(c => c.onclick = () => {
        const g = DB.get(+c.dataset.id);
        const base = {}; DIMS.forEach(([k]) => base[k] = g[k]);
        this.create(g.name, g.side, base, 15, g.title); // 名将以其属性为基线，另赠 15 加点
      });
    },
    create(name, side, base, points, title) {
      const alloc = {}; DIMS.forEach(([k]) => alloc[k] = 0);
      this.char = { name, side, title: title || "", base: clone(base), alloc, level: 1, exp: 0, points: points || 0, wins: 0, losses: 0 };
      this._roll = null; this._name = "";
      this.save(); AudioSystem.sfx.victory(); this.renderHub();
    },

    /* ---- 主面板 ---- */
    renderHub() {
      const c = this.char, C = $("#rpg-content");
      const need = this.expNeed(c.level), expPct = Math.min(100, c.exp / need * 100);
      const sum = DIMS.reduce((s, [k]) => s + this.eff(c, k), 0);
      const dims = DIMS.map(([k, l]) => {
        const v = this.eff(c, k);
        return `<div class="rpg-dim">
          <span class="rd-lbl">${l}</span>
          <span class="rd-track"><span class="rd-bar" style="width:${Math.min(100, v / 1.2)}%;background:${gradeColor(v)}"></span></span>
          <span class="rd-val">${v}</span>${gradeChip(v)}
          <button class="rd-plus" data-k="${k}" ${c.points > 0 ? '' : 'disabled'}>＋</button>
        </div>`;
      }).join("");
      C.innerHTML = `<div class="rpg-hub">
        <div class="rpg-card ${c.side}">
          <div class="rpg-av">${avatarChar(c.name)}</div>
          <div class="rpg-meta">
            <div class="rpg-name">${c.name} <button class="rpg-edit" id="rpg-rename" title="改名">✎</button> <span class="rpg-lv">Lv.${c.level}</span></div>
            <div class="rpg-side-tag">${c.side === 'cn' ? '三国风' : '战国风'} · 战绩 ${c.wins}胜${c.losses}负</div>
            <div class="rpg-exp"><span class="rpg-exp-fill" style="width:${expPct}%"></span><span class="rpg-exp-txt">EXP ${c.exp}/${need}</span></div>
          </div>
        </div>
        <div class="rpg-overview">
          <div class="rpg-radar">${radarSVG(this.heroGeneral(), 220)}</div>
          <div class="rpg-side">
            <div class="rpg-score-mini">
              <span class="rsm-lbl">武将评分</span>
              <span class="rsm-num">${ratingScore(this.heroGeneral())}</span>
              ${ratingChip(this.heroGeneral())}
              <span class="rsm-points">可分配加点：<b>${c.points}</b>${c.points > 0 ? '（点 ＋ 分配）' : ''}</span>
              <span class="rsm-sub">六维 ${sum} + 突出 ${Math.round(ratingScore(this.heroGeneral()) - sum)}</span>
            </div>
            <div class="rpg-dims">${dims}</div>
          </div>
        </div>
        <div class="bond-team">
          <div class="bt-head">💰 金币 <b>${Bond.gold()}</b> ｜ 👥 我的团队 ${Bond.data.team.length}/${Bond.teamLimit()}<small>（挚友可招募；队友任 2v2 副将，同阵营队友在组队/国战/阵营大战必上阵）</small></div>
          <div class="bt-list">${Bond.teamGenerals().map(t => `<span class="bt-chip" data-id="${t.id}">${t.name}<i data-x="${t.id}">✕</i></span>`).join("") || '<span class="bt-empty">尚无队友——先去结交武将吧</span>'}</div>
        </div>
        <div class="rpg-actions">
          <button class="cup-go primary" id="rpg-train">⚔ 历练单挑</button>
          <button class="cup-go primary" id="rpg-gauntlet">🔥 车轮大战</button>
          <button class="cup-go primary" id="rpg-tower">🗼 百人斩</button>
          <button class="cup-go primary" id="rpg-duo">🤝 2v2 单挑</button>
          <button class="cup-go primary" id="rpg-war">🚩 阵营大战</button>
          <button class="cup-go primary" id="rpg-teamwar">🛡 组队厮杀</button>
          <button class="cup-go primary" id="rpg-conquest">🗺 国战略地</button>
          <button class="cup-go primary" id="rpg-cup32">🏆 世界杯 32 强</button>
        </div>
        <div class="section-hint">历练 / 车轮 / 百人斩 / 2v2 / 阵营 / 组队 / 世界杯（含竞猜）均可获得经验，升级获得加点；战绩越好经验越多。</div>
      </div>`;
      // 蜘蛛图外框高度与右侧（评分+加点+六维）总高度对齐；图形本身按宽度等比居中，不被拉伸变形
      const sideEl = C.querySelector(".rpg-side"), radarEl = C.querySelector(".rpg-radar");
      if (sideEl && radarEl) {
        const h = Math.round(sideEl.getBoundingClientRect().height);
        if (h > 0) radarEl.style.height = h + "px";
      }
      $$(".rd-plus").forEach(b => b.onclick = () => this.allocate(b.dataset.k));
      $("#rpg-train").onclick = () => this.train();
      $("#rpg-gauntlet").onclick = () => this.gauntlet();
      $("#rpg-tower").onclick = () => this.tower();
      $$(".bt-chip").forEach(el => el.onclick = e => {
        const xid = e.target.dataset && e.target.dataset.x;
        if (xid != null) { if (confirm("将其请出团队？")) { Bond.dismiss(+xid); this.renderHub(); } return; }
        const tg = DB.get(+el.dataset.id); if (tg) showDetail(tg);
      });
      $("#rpg-duo").onclick = () => this.duo();
      $("#rpg-war").onclick = () => this.war();
      $("#rpg-teamwar").onclick = () => this.teamBattle();
      $("#rpg-conquest").onclick = () => this.conquest();
      $("#rpg-cup32").onclick = () => this.joinCup(32);
      $("#rpg-rename").onclick = () => {
        const n = prompt("新的名字：", c.name); if (n && n.trim()) { c.name = n.trim().slice(0, 6); this.save(); this.renderHub(); }
      };
    },
    allocate(k) {
      if (this.char.points <= 0) return;
      if (this.eff(this.char, k) >= 120) { toast("该维度已达上限 120"); return; }
      this.char.alloc[k] = (this.char.alloc[k] || 0) + 1;
      this.char.points--;
      AudioSystem.sfx.select();
      this.save(); this.renderHub();
    },

    /* ---- 历练 ---- */
    train() {
      const pool = DB.list;
      const opp = clone(pool[randInt(0, pool.length - 1)]);
      startClassicBattle(this.heroGeneral(), opp, false, true);
    },
    // 单挑获胜经验：以「武将评分」比较，胜过评分更高者按差值比例大增，胜过更低者微增
    winExp(heroScore, oppScore) {
      const diff = oppScore - heroScore;
      if (diff > 0) return 40 + Math.round(diff / heroScore * 600);
      return Math.max(8, 20 + Math.round(diff / 25));
    },
    onBattleEnd(heroWon, opp) {
      const c = this.char;
      const heroSum = ratingScore(this.heroGeneral()), oppSum = ratingScore(opp);
      const diff = oppSum - heroSum;   // >0 表示对手更强
      let gain, tag = "";
      if (heroWon) {
        gain = this.winExp(heroSum, oppSum);
        tag = diff > 0 ? "（以弱胜强，经验大增！）" : "（击败较弱者，经验微增）";
      } else {
        gain = 10 + Math.round(Math.max(0, diff) / 30);
      }
      if (heroWon) c.wins++; else c.losses++;
      if (heroWon) {
        Bond.addGold(15, BATTLE && BATTLE.mode === "duo" ? "2v2 获胜" : "历练获胜");
        Bond.addF(opp.id, 5);                        // 不打不相识
        if (BATTLE && BATTLE.duo) Bond.addF(BATTLE.duo.d1.id, 15);   // 与副将并肩获胜
        Bond.save();
      }
      c.exp += gain;
      let lvUp = 0;
      while (c.exp >= this.expNeed(c.level)) { c.exp -= this.expNeed(c.level); c.level++; c.points += 1; lvUp++; }
      this.save();
      const bg = c.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
      openOverlay(`<div class="result-card">
        <h1>${heroWon ? '历练胜利' : '虽败犹荣'}</h1>
        <div class="winner-av" style="background:${bg}">${avatarChar(c.name)}</div>
        <div class="wname">${c.name}</div>
        <div class="wdesc">${heroWon ? '击败' : '不敌'} ${opp.name}（武将评分 ${oppSum} / 你 ${heroSum}）${tag}<br>获得经验 <b style="color:var(--cn-red)">+${gain}</b>
          ${lvUp ? `<br>🎉 升级 ${lvUp} 级！获得加点 <b style="color:var(--cn-red)">+${lvUp * 1}</b>` : ''}</div>
        <div class="btns">
          <button class="btn-primary" id="rpg-again">再历练</button>
          <button class="btn-ghost" id="rpg-hub">返回养成</button>
        </div></div>`);
      $("#rpg-again").onclick = () => { closeOverlay(); this.train(); };
      $("#rpg-hub").onclick = () => { closeOverlay(); this.renderHub(); showScreen("rpg"); };
    },

    /* ---- 报名世界杯（16 / 32 强） ---- */
    joinCup(size) {
      Tournament.size = size || 16;
      const hero = this.heroGeneral();
      const pool = DB.list.slice(); shuffle(pool);
      const parts = [hero, ...pool.slice(0, Tournament.size - 1)];
      shuffle(parts);
      Tournament.rpgMode = true;
      Tournament.begin(parts);
    },

    /* ---- 车轮大战 ---- */
    gauntlet() { Gauntlet.start(this.heroGeneral(), true); },
    onGauntletResult(streak, allCleared, killer) {
      Bond.addGold(streak * 8, "车轮战果");
      const exp = streak * 25 + (allCleared ? 200 : 0);
      this.grantExp(exp, "车轮大战 · 连胜 " + streak,
        `连斩 <b style="color:var(--cn-red)">${streak}</b> 员${allCleared ? '，横扫群雄！' : (killer ? '，终被 ' + killer.name + ' 所阻。' : '。')}`,
        () => this.gauntlet());
    },

    /* ---- 百人斩 · 爬塔 ---- */
    tower() { Tower.start(this.heroGeneral(), true); },
    onTowerResult(cleared, killer, gains) {
      Bond.addGold(cleared * 8, "攀塔战果");
      Bond.addMany(Tower.slain, 4);   // 被斩守将：不打不相识
      const exp = cleared * 20 + (cleared >= 10 ? 100 : 0);
      this.grantExp(exp, "百人斩 · 斩 " + cleared + " 将",
        `攀塔连斩 <b style="color:var(--cn-red)">${cleared}</b> 员守将${killer ? `，止步于 ${killer.name} 之手。` : '，全身而退。'}${gains && gains.length ? `<br>此行机缘：${gains.join('、')}` : ''}`,
        () => this.tower());
    },

    /* ---- 2v2 主副将单挑：有队友则从团队挑副将，否则随机配 ---- */
    duo() {
      const hero = this.heroGeneral();
      const pool = DB.list.slice();
      shuffle(pool);
      const m2 = clone(pool[0]), d2 = clone(pool[1]);
      const mates = Bond.teamGenerals();
      if (!mates.length) { startDuoBattle(hero, clone(pool[2]), m2, d2, true); return; }
      openOverlay(`<div class="result-card">
        <h1>选择副将</h1>
        <div class="wdesc">从团队中挑一名副将与你并肩（其六维15%并入你，并可驰援一次）：</div>
        <div class="buff-list">
          ${mates.map(t => `<button class="buff-btn" data-id="${t.id}"><span class="bi">👥</span><span class="bt"><b>${t.name}</b><small>评分 ${ratingScore(t)} · 友谊 ${Bond.pts(t.id)}</small></span></button>`).join("")}
          <button class="buff-btn" data-id="rand"><span class="bi">🎲</span><span class="bt"><b>随机路人副将</b><small>不使用团队</small></span></button>
        </div>
        <div class="btns"><button class="btn-ghost" id="duo-cancel">取消</button></div></div>`);
      $$(".buff-btn[data-id]").forEach(b => b.onclick = () => {
        closeOverlay();
        const dep = b.dataset.id === "rand" ? clone(pool[2]) : clone(DB.get(+b.dataset.id));
        startDuoBattle(hero, dep, m2, d2, true);
      });
      $("#duo-cancel").onclick = closeOverlay;
    },

    /* ---- 阵营大战：进入后先选规模/模式，点「开战」再出阵 ---- */
    war() { War.open(this.heroGeneral()); },
    onWarResult(kills, sideWon, cnWin, comrades) {
      if (sideWon) Bond.addGold(40, "阵营大捷");
      Bond.addMany(comrades, 2);   // 并肩存活的同袍
      const exp = kills * 22 + (sideWon ? 120 : 0);
      this.grantExp(exp, "阵营大战 " + (sideWon ? "· 获胜" : "· 落败"),
        `你麾下斩敌 <b style="color:var(--cn-red)">${kills}</b> 员，本方阵营${sideWon ? '获胜！' : '惜败。'}`,
        () => this.war());
    },

    /* ---- 组队大战：同阵营队友必上阵，余位随机补满 ---- */
    teamBattle() {
      const hero = this.heroGeneral();
      const mates = Bond.teamGenerals().filter(g => g.side === hero.side).slice(0, 9).map(clone);
      const ids = new Set(mates.map(g => g.id));
      const pool = DB.bySide(hero.side).filter(g => !ids.has(g.id));
      shuffle(pool);
      const fill = pool.slice(0, Math.max(0, 9 - mates.length)).map(clone);
      TeamBattle.begin([hero, ...mates, ...fill], hero.side, { rpg: true });
    },
    onTeamBattleResult(kills, won) {
      if (won) Bond.addGold(30 + kills * 3, "组队大捷");
      const mates = TeamBattle.playerArr().map(u => u.g).filter(g => g.id !== -1);
      Bond.addMany(mates, won ? 6 : 3);   // 同队并肩 +3，获胜再 +3
      const exp = kills * 20 + (won ? 150 : 0);
      this.grantExp(exp, "组队大战 " + (won ? "· 获胜" : "· 落败"),
        `本场麾下击杀敌将 <b style="color:var(--cn-red)">${kills}</b> 员，全军${won ? '大捷！' : '溃败。'}`,
        () => this.teamBattle());
    },

    /* ---- 国战 · 攻城略地：主角与同阵营队友编入己方军团 ---- */
    conquest() {
      const hero = this.heroGeneral();
      const mates = Bond.teamGenerals().filter(g => g.side === hero.side);
      showScreen("conquest");
      Conquest.start(hero.side, { rpg: true, hero, mates });
    },
    onConquestResult(won, captures, kills) {
      Bond.addGold(captures * 40 + (won ? 200 : 0), "国战战果");
      // 战至终局仍在麾下的同袍
      const hero = this.heroGeneral();
      const allies = Conquest.cities.filter(c => c.side === hero.side)
        .flatMap(c => c.units).filter(g => g.id !== -1);
      Bond.addMany(allies, won ? 6 : 3);
      const exp = captures * 40 + kills * 15 + (won ? 250 : 0);
      this.grantExp(exp, "国战 " + (won ? "· 一统天下" : "· 大势已去"),
        `攻克 <b style="color:var(--cn-red)">${captures}</b> 城，斩敌将 <b style="color:var(--cn-red)">${kills}</b> 员，${won ? '天下归一！' : '霸业未成。'}`,
        () => this.conquest());
    },

    // 统一发放经验/升级并弹窗
    grantExp(gain, title, descHtml, againFn) {
      const c = this.char;
      c.exp += gain;
      let lvUp = 0;
      while (c.exp >= this.expNeed(c.level)) { c.exp -= this.expNeed(c.level); c.level++; c.points += 1; lvUp++; }
      this.save();
      const bg = c.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
      setTimeout(() => {
        openOverlay(`<div class="result-card">
          <h1>${title}</h1>
          <div class="winner-av" style="background:${bg}">${avatarChar(c.name)}</div>
          <div class="wname">${c.name}</div>
          <div class="wdesc">${descHtml}<br>获得经验 <b style="color:var(--cn-red)">+${gain}</b>
            ${lvUp ? `<br>🎉 升级 ${lvUp} 级！获得加点 <b style="color:var(--cn-red)">+${lvUp * 1}</b>` : ''}</div>
          <div class="btns">
            <button class="btn-primary" id="rpg-r-again">再来一次</button>
            <button class="btn-ghost" id="rpg-r-hub">返回养成</button>
          </div></div>`);
        $("#rpg-r-again").onclick = () => { closeOverlay(); againFn(); };
        $("#rpg-r-hub").onclick = () => { closeOverlay(); showScreen("rpg"); this.renderHub(); };
      }, 600);
    },
    onCupResult(placement, cupWinExp) {
      const c = this.char;
      if (!placement) { showScreen("rpg"); this.renderHub(); return; }
      // 名次奖金 + 同组交手友谊
      if (placement.label === "夺冠") Bond.addGold(100, "世界杯夺冠");
      else if (/半决赛|决赛/.test(placement.label)) Bond.addGold(50, "世界杯四强");
      const myGroup = Tournament.groups.find(g => g.teams.some(t => t.id === -1));
      if (myGroup) Bond.addMany(myGroup.teams.filter(t => t.id !== -1), 3);
      const winGain = Math.round(cupWinExp || 0);   // 各场单挑获胜累计经验
      const bonus = placement.exp;                   // 按最终轮次的晋级奖励
      const gain = winGain + bonus;
      c.exp += gain;
      let lvUp = 0;
      while (c.exp >= this.expNeed(c.level)) { c.exp -= this.expNeed(c.level); c.level++; c.points += 1; lvUp++; }
      this.save();
      const bg = c.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
      setTimeout(() => {
        openOverlay(`<div class="result-card">
          <h1>世界杯 · ${placement.label}</h1>
          <div class="winner-av" style="background:${bg}">${avatarChar(c.name)}</div>
          <div class="wname">${c.name}</div>
          <div class="wdesc">本届世界杯成绩：<b>${placement.label}</b><br>
            单挑获胜经验 <b style="color:var(--cn-red)">+${winGain}</b> · 晋级奖励 <b style="color:var(--cn-red)">+${bonus}</b><br>
            合计获得经验 <b style="color:var(--cn-red)">+${gain}</b>
            ${lvUp ? `<br>🎉 升级 ${lvUp} 级！获得加点 <b style="color:var(--cn-red)">+${lvUp * 1}</b>` : ''}</div>
          <div class="btns">
            <button class="btn-primary" id="rpg-cup-again">再战世界杯</button>
            <button class="btn-ghost" id="rpg-cup-hub">返回养成</button>
          </div></div>`);
        $("#rpg-cup-again").onclick = () => { closeOverlay(); this.joinCup(Tournament.size); };
        $("#rpg-cup-hub").onclick = () => { closeOverlay(); showScreen("rpg"); this.renderHub(); };
      }, 1200);
    },
  };

  const DBUI = {
    side: "cn",
    sort: { key: "rating", dir: -1 },   // 默认按武将评分从高到低
    open() { this.render(); showScreen("db"); },
    setSide(side) {
      this.side = side;
      $$(".side-tab", $("#screen-db")).forEach(t => t.classList.toggle("active", t.dataset.dbside === side));
      this.render();
    },
    sortBy(key) {
      if (this.sort.key === key) this.sort.dir *= -1;
      else this.sort = { key, dir: key === "name" ? 1 : -1 };
      this.render();
    },
    render() {
      const kw = $("#db-search").value.trim();
      let arr = DB.bySide(this.side).slice();
      if (kw) arr = arr.filter(g => g.name.includes(kw) || (g.title || "").includes(kw));
      // 排序
      const { key, dir } = this.sort;
      arr.sort((a, b) => {
        let va, vb;
        if (key === "name") return a.name.localeCompare(b.name, "zh") * dir;
        if (key === "rating") { va = ratingScore(a); vb = ratingScore(b); }
        else if (key === "bond") { va = Bond.pts(a.id); vb = Bond.pts(b.id); }
        else { va = a[key]; vb = b[key]; }
        return (va - vb) * dir;
      });
      const arrow = k => this.sort.key === k ? (this.sort.dir > 0 ? " ▲" : " ▼") : "";
      const th = (k, label) => `<th data-sort="${k}" class="${this.sort.key === k ? 'sorted' : ''}">${label}${arrow(k)}</th>`;
      const hasBond = !!RPG.char;   // 有自选武将时显示与其的友谊值
      const head = `<tr>${th("name", "姓名")}${DIMS.map(([k, l]) => th(k, l[0])).join("")}${th("rating", "评分")}<th>评级</th>${hasBond ? th("bond", "友谊") : ""}<th>操作</th></tr>`;
      const body = arr.map(g => {
        const cells = DIMS.map(([k]) => `<td class="num gt-${rateLetter(g[k])}">${g[k]}</td>`).join("");
        return `<tr data-id="${g.id}">
          <td class="dt-name ${g.side}"><span class="dt-dot"></span>${g.name}</td>
          ${cells}
          <td class="dt-total">${ratingScore(g)}</td>
          <td class="dt-grade">${ratingChip(g)}</td>
          ${hasBond ? `<td class="dt-bond">${Bond.inTeam(g.id) ? "👥" : ""}${Bond.pts(g.id)}</td>` : ""}
          <td class="dt-act">
            <button class="db-view" data-act="view">详</button>
            <button class="db-edit" data-act="edit">改</button>
            <button class="db-del" data-act="del">删</button>
          </td></tr>`;
      }).join("");
      $("#db-list").innerHTML = arr.length
        ? `<table class="db-table"><thead>${head}</thead><tbody>${body}</tbody></table>`
        : `<div class="empty">暂无武将</div>`;

      $$("#db-list th[data-sort]").forEach(h => h.onclick = () => this.sortBy(h.dataset.sort));
      $$("#db-list tbody tr").forEach(tr => {
        const id = +tr.dataset.id;
        $$("[data-act]", tr).forEach(btn => btn.onclick = e => {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === "view") showDetail(DB.get(id));
          else if (act === "edit") this.edit(DB.get(id));
          else if (act === "del") { if (confirm(`确定删除「${DB.get(id).name}」？`)) { DB.remove(id); this.render(); toast("已删除"); } }
        });
        $(".dt-name", tr).onclick = () => showDetail(DB.get(id));
      });
    },
    edit(g) {
      const isNew = !g;
      g = g || { name: "", title: "", intro: "", side: this.side, ti: 90, wu: 80, tong: 70, zhi: 60, zheng: 60, mei: 70 };
      const f = (k, label, type = "number") =>
        `<div><label>${label}</label><input id="ef-${k}" type="${type}" value="${g[k] ?? ''}"></div>`;
      openOverlay(`<div class="result-card detail-card">
        <h1 style="font-size:22px">${isNew ? '新增武将' : '编辑武将'}</h1>
        <div class="form-grid" style="margin-top:14px">
          <div><label>姓名</label><input id="ef-name" value="${g.name}"></div>
          <div><label>阵营</label><select id="ef-side">
            <option value="cn" ${g.side === 'cn' ? 'selected' : ''}>三国</option>
            <option value="jp" ${g.side === 'jp' ? 'selected' : ''}>战国</option></select></div>
          <div class="full"><label>称号</label><input id="ef-title" value="${g.title || ''}"></div>
          <div class="full"><label>简介</label><textarea id="ef-intro">${g.intro || ''}</textarea></div>
          ${f('ti', '体力')}${f('wu', '武力')}${f('tong', '统帅')}${f('zhi', '智力')}${f('zheng', '政治')}${f('mei', '魅力')}
        </div>
        <div class="btns" style="margin-top:16px">
          <button class="btn-primary" id="ef-save">保存</button>
          <button class="btn-ghost" id="ef-cancel">取消</button>
        </div></div>`);
      $("#ef-cancel").onclick = closeOverlay;
      $("#ef-save").onclick = () => {
        const name = $("#ef-name").value.trim();
        if (!name) { toast("请填写姓名"); return; }
        const data = {
          name, side: $("#ef-side").value,
          title: $("#ef-title").value.trim(), intro: $("#ef-intro").value.trim(),
          ti: clampStat($("#ef-ti").value), wu: clampStat($("#ef-wu").value),
          tong: clampStat($("#ef-tong").value), zhi: clampStat($("#ef-zhi").value),
          zheng: clampStat($("#ef-zheng").value), mei: clampStat($("#ef-mei").value),
        };
        if (isNew) { DB.add(data); this.side = data.side; }
        else DB.update(g.id, data);
        closeOverlay(); this.setSide(this.side); toast(isNew ? "已新增" : "已保存");
      };
    },
    exportJSON() {
      const blob = new Blob([JSON.stringify(DB.list, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "wujiang_database.json"; a.click();
      URL.revokeObjectURL(url); toast("已导出 JSON");
    },
    importJSON(file) {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const arr = JSON.parse(e.target.result);
          if (!Array.isArray(arr)) throw 0;
          DB.list = arr.map((g, i) => Object.assign({ id: i + 1, side: g.side || 'cn' }, g));
          DB._nextId = DB.list.length + 1; DB.save();
          this.render(); toast(`已导入 ${arr.length} 名武将`);
        } catch { toast("文件格式有误"); }
      };
      reader.readAsText(file);
    },
  };
  function clampStat(v) { return Math.max(1, Math.min(120, Math.round(+v || 0))); }

  /* ============================================================
   *  音频按钮绑定
   * ============================================================ */
  function syncAudioBtns() {
    const m = AudioSystem.isMusicOn(), s = AudioSystem.isSfxOn();
    $$('[id^="btn-music"]').forEach(b => { b.classList.toggle("off", !m); b.textContent = m ? "♪" : "♪̶"; });
    $$('[id^="btn-sfx"]').forEach(b => { b.classList.toggle("off", !s); b.textContent = s ? "🔊" : "🔇"; });
  }
  function bindAudio() {
    $$('[id^="btn-music"]').forEach(b => b.onclick = () => { AudioSystem.toggleMusic(!AudioSystem.isMusicOn()); syncAudioBtns(); });
    $$('[id^="btn-sfx"]').forEach(b => b.onclick = () => { AudioSystem.toggleSfx(!AudioSystem.isSfxOn()); syncAudioBtns(); });
  }

  /* ============================================================
   *  初始化与事件绑定
   * ============================================================ */
  function init() {
    DB.load();
    Bond.load();
    RPG.load();   // 提前载入角色：友谊/金币的累计以其存在为前提

    // 首屏需用户交互才能启动音频
    let audioStarted = false;
    const startAudio = () => { if (!audioStarted) { audioStarted = true; AudioSystem.init(); syncAudioBtns(); } };
    document.body.addEventListener("pointerdown", startAudio, { once: false });

    // 菜单按钮
    $$(".menu-btn").forEach(b => b.onclick = () => {
      startAudio();
      const go = b.dataset.go;
      if (go === "select") SelectUI.open(b.dataset.mode);
      else if (go === "war") War.open();
      else if (go === "conquest") Conquest.open();
      else if (go === "cup") Tournament.open();
      else if (go === "rpg") RPG.open();
      else if (go === "db") DBUI.open();
    });

    // 世界杯
    $$(".cup-size").forEach(b => b.onclick = () => Tournament.setSize(+b.dataset.size));
    $("#cup-manual").onclick = () => SelectUI.open("cup");
    $("#cup-random").onclick = () => Tournament.beginRandom();
    // 折叠屏开合(屏宽跨越断点)时重排世界杯对阵树：窄屏横向单排 ⇄ 宽屏上下半区
    let cupRelayout = 0;
    window.addEventListener("resize", () => {
      clearTimeout(cupRelayout);
      cupRelayout = setTimeout(() => {
        if ($("#screen-cup").classList.contains("active") && Tournament.koRounds && Tournament.koRounds.length) Tournament.render();
      }, 150);
    });

    // 返回（仅在战斗进行中且正处于战斗画面时才阻止）
    $$("[data-back]").forEach(b => b.onclick = () => {
      const onBattle = $("#screen-battle").classList.contains("active");
      // 阵营大战详情观战：脱离单挑画面退回战报界面，但本场大战继续推进（非中止）
      if (onBattle && BATTLE && BATTLE.spectate && BATTLE.mode !== "team") {
        closeOverlay();
        War.detach();   // 内部已切回战报界面、切到「快捷」并续算当前阵
        return;
      }
      if (BATTLE && BATTLE.busy && onBattle) return;
      // 组队大战·挑唆单挑中途退出：视为中止该场单挑，回到组队大战战场（不终止整场组队大战）
      if (onBattle && BATTLE && BATTLE.mode === "team") {
        const b = BATTLE; BATTLE = null;
        closeOverlay();
        showScreen(b.backScreen || "home");
        if (b.abortResolve) b.abortResolve();
        return;
      }
      if (BATTLE) BATTLE.busy = false;
      War.abort();   // 终止可能在进行中的阵营大战
      closeOverlay();
      showScreen("home");
    });

    // 选将
    $$(".side-tab[data-side]").forEach(t => t.onclick = () => SelectUI.setSide(t.dataset.side));
    $("#select-search").oninput = () => SelectUI.render();
    $("#select-confirm").onclick = () => SelectUI.confirm();
    $("#select-random").onclick = () => SelectUI.randomPick();

    // 阵营战
    $("#war-start").onclick = () => War.start(War.pendingHero);
    $("#war-mode-fast").onclick = () => War.setMode("fast");
    $("#war-mode-detail").onclick = () => War.setMode("detail");
    $$(".war-scale").forEach(b => b.onclick = () => War.setScale(b.dataset.scale));

    // 战斗控制：自动作战 / 速度
    $("#btn-auto").onclick = () => {
      if (!BATTLE) return;
      PREF.auto = BATTLE.auto = !BATTLE.auto;
      syncBattleControls();
      // 重新决定当前回合：自动→立即排程出手；手动→等待玩家
      if (!BATTLE.spectate && !BATTLE.busy && !overlay.classList.contains("show")) {
        clearTimeout(BATTLE._autoTimer);
        nextTurn();
      }
    };
    $("#btn-speed").onclick = () => {
      const seq = [1, 2, 4];
      PREF.speed = seq[(seq.indexOf(PREF.speed) + 1) % seq.length];
      if (BATTLE) BATTLE.speed = PREF.speed;
      syncBattleControls();
    };

    // 数据库
    $$(".side-tab[data-dbside]").forEach(t => t.onclick = () => DBUI.setSide(t.dataset.dbside));
    $("#db-search").oninput = () => DBUI.render();
    $("#db-add").onclick = () => DBUI.edit(null);
    $("#db-export").onclick = () => DBUI.exportJSON();
    $("#db-import").onchange = e => { if (e.target.files[0]) DBUI.importJSON(e.target.files[0]); e.target.value = ""; };
    $("#db-reset").onclick = () => { if (confirm("恢复为默认 200 名武将？将覆盖当前数据库。")) { DB.resetDefault(); DBUI.render(); toast("已恢复默认"); } };

    bindAudio();
    syncAudioBtns();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
