/* ============================================================
 *  中日武将大单挑 — 主程序 / UI 控制
 * ============================================================ */
(() => {
  "use strict";

  const APP_VERSION = "202607120732";   // 发版时的 UTC+8 时间戳（YYYYMMDD+HHMM），与 sw.js 缓存版本同步生成
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

  // 任何武将（含 400 名史实武将）都可能装备宝物：所有单挑/带兵战斗单位统一在此
  // 挂钩装备加成，按 general.id 查询——自选武将(id=-1)不会与任何真实武将id冲突，
  // 其自身装备已在 RPG.heroGeneral() 中按 "hero" 键应用，此处对其是安全的空操作。
  const _makeFighter = window.makeFighter, _makeTroopUnit = window.makeTroopUnit;
  function makeFighter(g) { return _makeFighter(Armory.geared(g, g.id)); }
  function makeTroopUnit(g, side) { return _makeTroopUnit(Armory.geared(g, g.id), side); }

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
  // 记录"上一次停留的主页面"（角色扮演主页 或 天下地图）：战斗/宝物库等子界面结算后
  // 借此判断该回到哪一层，而不是一律固定返回某一处
  let homeBase = "rpg";
  function goHome() {
    if (homeBase === "map" && typeof Campaign !== "undefined" && Campaign.meta && Campaign.meta.active) MapUI.open();
    else { RPG.renderHub(); showScreen("rpg"); }
  }
  // 重行动统一扣减 1 点行动力（历练/切磋/擂台道场等一切战斗/承接悬赏/移动）；未开局地图时不限制
  function spendAP() {
    const m = typeof Campaign !== "undefined" && Campaign.mapState();
    if (!m) return true;
    if (m.ap <= 0) { toast("今日行动力已耗尽，请先宿营恢复"); return false; }
    m.ap--; Campaign.save();
    return true;
  }
  // 手机系统/浏览器返回键同步：每次切屏正常推入一条历史记录；popstate（硬件返回）触发时置位该标记，
  // 使 showScreen 内部不再重复 push，避免历史栈因"返回导致的切屏"而越返越深
  let backNavActive = false;
  function showScreen(id) {
    $$(".screen").forEach(s => s.classList.remove("active"));
    $("#screen-" + id).classList.add("active");
    if (id === "rpg" || id === "map") homeBase = id;
    if (id === "home" && typeof syncHomeButtons === "function") syncHomeButtons();
    if (id !== "battle" && typeof Duel !== "undefined" && Duel.stop) Duel.stop();
    // 按界面切换背景乐：指定界面用 OST，其余回退芯片乐
    if (BGM[id]) AudioSystem.playFile(BGM[id]);
    else AudioSystem.playChip();
    AudioSystem.resume();
    if (!backNavActive) history.pushState({ screen: id }, "", "");
  }
  // 返回逻辑（原「返回」按钮点击与硬件/浏览器返回键共用）：战斗动画进行中阻止误触，
  // 阵营大战观战/组队大战挑唆单挑有各自的中途退出规则，其余按 homeBase 或固定路由返回上一层
  function handleBackAction() {
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
    // 宝物库（仓库/商店/锻造）挂在角色扮演主页或天下地图之下，退出应回到发起它的那一层（而非直接回首页）
    if ($("#screen-armory").classList.contains("active") && RPG.char) { goHome(); return; }
    // 全部武将名录固定挂在天下地图之下
    if ($("#screen-allgen").classList.contains("active")) { MapUI.open(); return; }
    // 角色扮演主页现为天下地图之下的角色详情页，退出固定回到地图（若尚未开局才回首页）
    if ($("#screen-rpg").classList.contains("active")) {
      if (RPG.char && Campaign.meta && Campaign.meta.active) { MapUI.open(); return; }
      showScreen("home"); return;
    }
    // 阵营大战/组队大战/国战/世界杯：从「小游戏」自由试玩进入时退出回首页；
    // 从角色扮演/天下地图城池特色设施发起时（各自 rpg/rpgMode 标记为真）应回到发起它的那一层
    const rpgSubGames = [["war", () => War.rpg], ["teamwar", () => TeamBattle.rpg], ["conquest", () => Conquest.rpg], ["cup", () => Tournament.rpgMode]];
    for (const [id, isRpg] of rpgSubGames) {
      if ($("#screen-" + id).classList.contains("active")) {
        if (isRpg()) { goHome(); return; }
        showScreen("home"); return;
      }
    }
    showScreen("home");
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
    // 友谊面板：有自选武将(角色扮演)、对象是库中武将、且与主角同阵营时显示；opts.global（武将图鉴全局视图）
    // 时完全不显示进度数据，只呈现默认六维；opts.readonly（全部武将名录只读视图）显示真实战役数值与友谊值，
    // 但隐藏拜访/切磋/招募等互动按钮；非只读且为敌方阵营武将时，交友区替换为「刺杀」——只能与己方阵营交友，
    // 潜入敌境唯有刺杀敌将立威（或被反杀）
    let bondHtml = "", eqHtml = "", assassinHtml = "";
    const isRealGeneral = !opts.global && RPG.char && g.id !== -1 && DB.get(g.id);
    const sameSide = isRealGeneral && g.side === RPG.char.side;
    const bondable = isRealGeneral && sameSide && !opts.readonly;
    const showFriendBox = isRealGeneral && sameSide;
    const assassinable = isRealGeneral && !sameSide && !opts.readonly;
    // 装备加成：六维数值、雷达图、总评均按「若此武将佩戴其当前装备」实时展示（含刺杀等战役内负面效果）。
    // hg 是叠加装备后的最终值（若传入的 g 本就来自战斗单位、已叠加过，则原样沿用，避免二次叠加）；
    // raw 专门用于计算装备增量标注——重新查一份「不含装备」的原始六维做对比基准，
    // 这样即便 g 是战斗中已叠加过装备的单位，也能正确算出装备带来的增量而不是显示 0。
    const hg = opts.global ? g : Armory.geared(g, g.id);
    const raw = opts.global ? g : (g.id === -1
      ? (RPG.char ? Object.assign({}, g, Object.fromEntries(DIMS.map(([k]) => [k, RPG.eff(RPG.char, k)]))) : g)
      : (DB.get(g.id) || g));
    if (isRealGeneral) {
      eqHtml = `<div class="eq-slots-wrap"><div class="bt-head">🎒 携带宝物${bondable ? '<small>（点击槽位选择宝物即为赠送；宝物只在首次赠给某位武将时计入友谊）</small>' : ''}</div><div class="eq-slots compact${bondable ? '' : ' readonly'}">${eqSlotsHtml(g.id, true)}</div></div>`;
    }
    if (showFriendBox) {
      const p = Bond.pts(g.id), lv = Bond.levelName(p), next = Bond.nextThreshold(p);
      const atCap = p >= Bond.MAX_FRIEND;
      const pct = Math.min(100, p / Bond.MAX_FRIEND * 100);
      let giftsRow = "";
      if (bondable) {
        const inTeam = Bond.inTeam(g.id);
        const teamFull = Bond.data.team.length >= Bond.teamLimit();
        const recruitLbl = inTeam ? "✓ 已在队中"
          : !atCap ? `🔒 友谊满上限（${Bond.MAX_FRIEND}）后可招募`
          : teamFull ? "🔁 招募（满员，需替换队友）"
          : `🤝 招募入队（${Bond.recruitCost(g)} 金）`;
        const visitedToday = (Bond.data.visitDay || {})[g.id] === Bond.dayKey();
        const sparredToday = (Bond.data.sparDay || {})[g.id] === Bond.dayKey();
        const mSpar = Campaign.mapState();
        const sparNoAp = !!mSpar && mSpar.ap <= 0;
        giftsRow = `<div class="bond-gifts">
          <button class="gift-btn ${(atCap || visitedToday) ? "dim" : ""}" id="bond-visit">🚶 拜访（+1~2）${atCap ? "（友谊已满）" : visitedToday ? "（今日已访）" : ""}</button>
          <button class="gift-btn ${(sparredToday || sparNoAp) ? "dim" : ""}" id="bond-spar">⚔️ 切磋（-1⚡）${sparredToday ? "（今日已切磋）" : sparNoAp ? "（行动力不足）" : ""}</button>
          <button class="gift-btn recruit ${inTeam || !atCap ? "dim" : ""}" id="bond-recruit">${recruitLbl}</button>
        </div>`;
      }
      bondHtml = `<div class="bond-box">
        <div class="bond-line">友谊 <b>${p}</b> · ${lv}${next ? `（还差 ${next - p} 至下一级）` : "（已至最高）"} · 💰 ${Bond.gold()} 金</div>
        <div class="bond-track"><span class="bond-fill" style="width:${pct}%"></span></div>
        ${giftsRow}
      </div>`;
    }
    if (assassinable) {
      const today = Bond.dayKey();
      const doneToday = (Bond.data.assassinDay || {})[g.id] === today;
      const mAsn = Campaign.mapState();
      const asnNoAp = !!mAsn && mAsn.ap <= 0;
      assassinHtml = `<div class="bond-box enemy-box">
        <div class="bond-line">⚔️ 敌方阵营武将 · 潜入敌境，唯有刺杀方能立威</div>
        <div class="bond-gifts"><button class="gift-btn ${(doneToday || asnNoAp) ? "dim" : ""}" id="bond-assassinate">🗡️ 刺杀（-1⚡）${doneToday ? "（今日已交手）" : asnNoAp ? "（行动力不足）" : ""}</button></div>
      </div>`;
    }
    const html = `<div class="result-card detail-card">
      <div class="dc-head">
        <div class="winner-av dc-av" style="background:${g.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)'}">${avatarChar(g.name)}</div>
        <div class="dc-head-info">
          <div class="wname">${g.name}</div>
          <div class="dc-title">${g.title || ''}</div>
          <div class="dc-intro">${g.intro || ''}</div>
        </div>
      </div>
      <div class="dc-body">
        <div class="radar-wrap dc-radar">${radarSVG(hg, 168)}</div>
        <div class="dc-stats">
          <div class="overall-line">评分 <b class="ov-sum">${ratingScore(hg)}</b> <span class="ov-num">(六维${sumStats(hg)}+突出${Math.round(ratingScore(hg) - sumStats(hg))})</span> ${ratingChip(hg)}</div>
          <div class="stat-rows">${statRow('体力', hg.ti, hg.ti - raw.ti)}${statRow('武力', hg.wu, hg.wu - raw.wu)}${statRow('统帅', hg.tong, hg.tong - raw.tong)}${statRow('智力', hg.zhi, hg.zhi - raw.zhi)}${statRow('政治', hg.zheng, hg.zheng - raw.zheng)}${statRow('魅力', hg.mei, hg.mei - raw.mei)}</div>
        </div>
      </div>
      ${eqHtml}
      ${bondHtml}
      ${assassinHtml}
      <div class="btns">
        ${opts.pickable ? `<button class="btn-primary" id="detail-pick">选他出战</button>` : ''}
        <button class="btn-ghost" id="detail-close">关闭</button>
      </div>
    </div>`;
    openOverlay(html);
    $("#detail-close").onclick = closeOverlay;
    if (opts.pickable) $("#detail-pick").onclick = () => { closeOverlay(); opts.onPick(g); };
    if (bondable) {
      $("#bond-visit").onclick = () => { if (Bond.visit(g)) { showDetail(g, opts); refreshDBIfActive(); } };
      $("#bond-spar").onclick = () => {
        const today = Bond.dayKey();
        if (!Bond.data.sparDay) Bond.data.sparDay = {};
        if (Bond.data.sparDay[g.id] === today) { toast(`今天已与 ${g.name} 切磋过，宿营过夜后可再战`); return; }
        const m = Campaign.mapState();
        if (m && m.ap <= 0) { toast("今日行动力已耗尽，请先宿营恢复"); return; }
        if (m) { m.ap--; m.activeSpar = g.id; Campaign.save(); }
        Bond.data.sparDay[g.id] = today; Bond.save();
        closeOverlay();
        startClassicBattle(RPG.heroGeneral(), g, false, true);
      };
      $("#bond-recruit").onclick = () => {
        if (Bond.inTeam(g.id) || Bond.pts(g.id) < 150) return;
        if (Bond.data.team.length >= Bond.teamLimit()) openTeamReplacePicker(g, () => { showDetail(g, opts); refreshDBIfActive(); });
        else if (Bond.recruit(g)) { showDetail(g, opts); refreshDBIfActive(); }
      };
      bindEqSlots(() => showDetail(g, opts));
    }
    if (assassinable) {
      const assassinBtn = $("#bond-assassinate");
      if (assassinBtn) assassinBtn.onclick = () => {
        const today = Bond.dayKey();
        if (!Bond.data.assassinDay) Bond.data.assassinDay = {};
        if (Bond.data.assassinDay[g.id] === today) { toast(`今日已与 ${g.name} 交手过，宿营过夜后可再袭`); return; }
        const m = Campaign.mapState();
        if (m && m.ap <= 0) { toast("今日行动力已耗尽，请先宿营恢复"); return; }
        if (m) { m.ap--; m.activeAssassin = g.id; Campaign.save(); }
        Bond.data.assassinDay[g.id] = today; Bond.save();
        closeOverlay();
        startClassicBattle(RPG.heroGeneral(), g, false, true);
      };
    }
  }
  // 团队已满时招募：须指定一名现有队友被顶替，队友不可无条件请出团队
  function openTeamReplacePicker(g, onDone) {
    const mates = Bond.teamGenerals();
    openOverlay(`<div class="result-card">
      <h1>👥 团队已满</h1>
      <div class="wdesc">团队已达 ${Bond.teamLimit()} 人上限，选一名队友，由 ${g.name} 顶替其位置：</div>
      <div class="buff-list">
        ${mates.map(t => `<button class="buff-btn replace-opt" data-id="${t.id}"><span class="bi">👤</span><span class="bt"><b>${t.name}</b><small>评分 ${ratingScore(t)} · 友谊 ${Bond.pts(t.id)}</small></span></button>`).join("")}
      </div>
      <div class="btns"><button class="btn-ghost" id="replace-cancel">取消</button></div></div>`);
    $$(".replace-opt").forEach(b => b.onclick = () => {
      const rid = +b.dataset.id;
      const ok = Bond.recruit(g, rid);
      closeOverlay(); if (onDone) onDone();
      if (!ok) toast("替换失败");
    });
    $("#replace-cancel").onclick = () => { closeOverlay(); if (onDone) onDone(); };
  }
  function statRow(lbl, val, gear) {
    return `<div class="stat-row"><span class="lbl">${lbl}</span>
      <span class="track"><span class="bar" style="width:${Math.min(100, val / 1.2)}%;background:${gradeColor(val)}"></span></span>
      <span class="val">${val}${gear ? `<i class="rd-gear">(${gear > 0 ? '+' : ''}${gear})</i>` : ''}</span>${gradeChip(val)}</div>`;
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
  const PREF = { auto: false, speed: 4 };

  function renderFighter(sel, fighter, sideClass) {
    const el = $(sel);
    const isLeft = sel.includes('left');
    el.className = `fighter ${isLeft ? 'left' : 'right'} ${sideClass}`;
    const g = fighter.g;
    $(".favatar", el).textContent = avatarChar(g.name);
    $(".fname", el).textContent = g.name;
    $(".ftotal", el).innerHTML = `<span class="ft-lbl">总</span><span class="ft-row"><b>${ratingScore(g)}</b>${ratingChip(g)}</span>`;
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
        logLine(`💊 ${BATTLE.p1.g.name} 服下回魂丹，满血复活再战！（-100金，余 ${Bond.gold()} 金）`, "sys");
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
          <div class="wdesc">击败 ${BATTLE.p2.g.name}！<br>战后恢复体力 ${heal} 点，下一阵对手更强。<br><small style="opacity:.75">即将自动迎战下一员…</small></div>
          <div class="btns">
            <button class="btn-primary" id="g-next">立即迎战</button>
            <button class="btn-ghost" id="g-quit">鸣金收兵</button>
          </div></div>`);
        const advance = () => {
          clearTimeout(timer);
          closeOverlay();
          const carry = this.hero._carryHp;
          this.next();
          BATTLE.p1.hp = carry; updateBars($("#f-left"), BATTLE.p1);
        };
        const timer = setTimeout(advance, 900);
        $("#g-next").onclick = advance;
        $("#g-quit").onclick = () => { clearTimeout(timer); closeOverlay(); this.finish(false); };
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
        <div class="wdesc">战后回复体力 ${healed} 点（现 ${Math.round(this.carryHp)}/${this.hero.ti}）。<br>已连斩 <b style="color:var(--cn-red)">${this.floor}</b> 员守将${b ? ` · 历史最佳 ${b.best} 层` : ""}。<br><small style="opacity:.75">即将自动攀上一层…</small></div>
        <div class="btns">
          <button class="btn-primary" id="twr-up">立即攀上</button>
          <button class="btn-ghost" id="twr-down">收兵下塔</button>
        </div></div>`);
      const advance = () => { clearTimeout(timer); closeOverlay(); this.floor++; this.next(); };
      const timer = setTimeout(advance, 900);
      $("#twr-up").onclick = advance;
      $("#twr-down").onclick = () => { clearTimeout(timer); closeOverlay(); this.floor++; this.finish(null); };
    },
    // 每 5 层：三选一机缘。角色扮演模式下（this.rpg 为真）六维类机缘（体力/武力/统帅/智力/政治/魅力永久+7 或+16）
    // 若对应维度的主角六维基础值（不含装备加成）已达 110 上限，则不再进入候选池，避免选项本身就在诱导"继续加"一个已封顶的维度；
    // 「疗养生息」不涉及任何维度增长，始终可选。若候选不足 3 项（如多数维度已封顶）则回退为全量 BUFFS，保证界面仍有三个选项可选。
    // 小游戏自由试玩（无持久角色，this.rpg 为假）不受此限制。
    offerBuffs(healed) {
      let opts = this.BUFFS.slice();
      if (this.rpg && RPG.char) {
        const eligible = opts.filter(o => o.k === "heal" || RPG.eff(RPG.char, o.k) < 110);
        if (eligible.length >= 3) opts = eligible;
      }
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
          ${this.rpg ? `<button class="btn-ghost" id="twr-reroll">🎲 重抽（50金 · 现有${Bond.gold()}）</button>` : ""}
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
        toast(`🎲 天机再转…（-50金，余 ${Bond.gold()}）`);
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
    running: false, mode: "fast", gen: 0, detached: false, scale: "100", rpg: false,
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
      if (this._askResolve) { const r = this._askResolve; this._askResolve = null; r(false); }
    },
    // 快捷模式下轮到主角本人或团队成员出战：弹窗询问是否亲自进入经典单挑画面应战
    askJoinDuel(cnF, jpF) {
      return new Promise(resolve => {
        this._askResolve = resolve;
        const mine = isHeroOrMate(cnF) ? cnF : jpF, foe = mine === cnF ? jpF : cnF;
        openOverlay(`<div class="result-card">
          <h1>⚔️ 轮到您方出战</h1>
          <div class="wdesc">${mine.id === -1 ? '您' : '您的队友 ' + mine.name}即将迎战 ${foe.name}（${sideName(foe.side)}），是否亲自上阵单挑？</div>
          <div class="btns">
            <button class="btn-primary" id="war-ask-join">亲自应战</button>
            <button class="btn-ghost" id="war-ask-skip">自动观战</button>
          </div>
        </div>`);
        $("#war-ask-join").onclick = () => { closeOverlay(); this._askResolve = null; resolve(true); };
        $("#war-ask-skip").onclick = () => { closeOverlay(); this._askResolve = null; resolve(false); };
      });
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
    // opts.customRoster: {cn:[...], jp:[...]} 由调用方给定固定参战名单时（如边境阵营大战，只取已现身武将、
    // 双方等量），跳过默认的「全库200员+规模挑选」建军逻辑，改直接以给定名单为准（仍套用下方统一的主角强制上阵逻辑）；
    // opts.onDone(result) 提供时，战报改由调用方接管展示（不再走默认的 RPG.onWarResult / 自由试玩战报弹窗）
    async start(hero, opts = {}) {
      if (this.running) return;
      this.running = true;
      this.aborted = false;
      this.detached = false;
      this.rpg = !!hero;
      const myGen = ++this.gen;            // 本场大战的代号，被中止/重开后作废旧循环
      $("#war-start").disabled = true;
      $("#war-log").innerHTML = "";
      $("#war-duel").innerHTML = "";
      let cn, jp, total;
      if (opts.customRoster) {
        cn = opts.customRoster.cn.map(clone);
        jp = opts.customRoster.jp.map(clone);
        total = Math.min(cn.length, jp.length);
      } else {
        cn = DB.bySide("cn").map(clone);
        jp = DB.bySide("jp").map(clone);
        shuffle(cn); shuffle(jp);
        total = this.scaleTotal(Math.min(cn.length, jp.length));
      }
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
        // 详情模式且未脱离观战：进入经典单挑画面演完整场；否则（快捷/已返回）直接结算；
        // 快捷模式下若轮到主角本人或其团队成员出战，额外询问是否亲自应战（不强制，跳过则按快捷结算）
        let showDuel = this.mode === "detail" && !this.detached;
        if (!showDuel && hero && (isHeroOrMate(cnFighter) || isHeroOrMate(jpFighter))) {
          showDuel = await this.askJoinDuel(cnFighter, jpFighter);
          if (this.gen !== myGen || this.aborted) return;  // 询问期间被中止/接管：安静退出
        }
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
      if (opts.onDone) {
        const heroSideWon = hero ? (cnWin ? "cn" : "jp") === hero.side : null;
        const mySide = hero ? (hero.side === "cn" ? cn : jp) : null;
        const myIdx = hero ? (hero.side === "cn" ? cnIdx : jpIdx) : null;
        const comrades = hero ? mySide.slice(myIdx).filter(g => g.id !== -1 && g.hp !== 0) : [];
        const heroAlive = hero ? mySide.slice(myIdx).some(g => g.id === -1) : null;
        opts.onDone({ cnWin, survivors, champ, heroKills, heroSideWon, comrades, heroAlive });
        return;
      }
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
  // 阵营大战快捷模式下用于判断某个（克隆的）武将是否为角色扮演主角本人或其现有队友
  function isHeroOrMate(g) { return g.id === -1 || Bond.inTeam(g.id); }

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
      $("#tw-home").onclick = () => { closeOverlay(); if (this.rpg) goHome(); else showScreen("home"); };
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
        toast(`🎲 山川重定！（-30金，余 ${Bond.gold()}）`);
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
    // 无界面的完整赛程模拟（小组循环赛取前二 → 单败淘汰），供武将大会主角不参赛时
    // 仍在后台照常产生冠亚军（不影响/不使用当前 this.participants 等交互状态）
    simulate(parts) {
      const n = parts.length, gcount = n / 4;
      let ko = [];
      for (let i = 0; i < gcount; i++) {
        const teams = parts.slice(i * 4, i * 4 + 4);
        const stat = new Map(teams.map(t => [t.id, { g: t, w: 0, l: 0, hp: 0 }]));
        [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]].forEach(([x, y]) => {
          const a = teams[x], b = teams[y], res = autoBattle(a, b);
          const aHp = res.p1.g.id === a.id ? res.p1.hp : res.p2.hp;
          const bHp = res.p1.g.id === b.id ? res.p1.hp : res.p2.hp;
          const sa = stat.get(a.id), sb = stat.get(b.id);
          sa.hp += Math.max(0, aHp); sb.hp += Math.max(0, bHp);
          if (res.winner.id === a.id) { sa.w++; sb.l++; } else { sb.w++; sa.l++; }
        });
        const table = [...stat.values()].sort((x, y) => y.w - x.w || y.hp - x.hp);
        ko.push(...table.slice(0, 2).map(s => s.g));
      }
      while (ko.length > 2) {
        const next = [];
        for (let i = 0; i < ko.length; i += 2) next.push(autoBattle(ko[i], ko[i + 1]).winner);
        ko = next;
      }
      const final = autoBattle(ko[0], ko[1]);
      return { champion: final.winner, runnerUp: final.loser };
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
        if (this.onDone) { const cb = this.onDone; this.onDone = null; this.rpgMode = false; cb(this.heroPlacement()); return; }
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
        if (this.onDone) { const cb = this.onDone; this.onDone = null; cb(this.heroPlacement()); return; }
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
        <div class="wdesc">${lines.join("<br>")}<br>冠军预测：${champHit ? "✅ 命中" : "❌ 未中"}<br>竞猜得分 <b style="font-size:22px;color:var(--cn-red)">${score}</b>${rpg ? Bond.goldLine(score) : ""}</div>
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
    data: { gold: 0, friends: {}, team: [], giftDay: {}, visitDay: {}, gifted: {}, sparDay: {}, assassinDay: {} },
    load() {
      try { const d = JSON.parse(localStorage.getItem(BOND_KEY)); if (d) this.data = Object.assign({ gold: 0, friends: {}, team: [], giftDay: {}, visitDay: {}, gifted: {}, sparDay: {}, assassinDay: {} }, d); } catch { }
    },
    save() { localStorage.setItem(BOND_KEY, JSON.stringify(this.data)); },
    gold() { return this.data.gold; },
    // 获得金币（静默入账；数额统一在各结算弹窗与经验一起展示）
    addGold(n, why) {
      if (!RPG.char || n <= 0) return 0;
      n = Math.round(n);
      this.data.gold += n; this.save();
      return n;
    },
    // 结算弹窗用的金币行（+入账 / 现有余额）
    goldLine(gain) {
      if (!RPG.char) return "";
      return `<br>💰 金币 ${gain > 0 ? `<b style="color:#b8860b">+${gain}</b> · ` : ""}现有 <b style="color:#b8860b">${this.gold()}</b>`;
    },
    spend(n) { if (this.data.gold < n) return false; this.data.gold -= n; this.save(); return true; },
    pts(id) { return this.data.friends[id] || 0; },
    MAX_FRIEND: 300,
    // 返回实际增加量（可能因已达/接近上限而低于 n，甚至为 0）
    addF(id, n) {
      if (!RPG.char || id == null || id === -1) return 0;
      const before = this.data.friends[id] || 0;
      const after = Math.min(this.MAX_FRIEND, before + n);
      this.data.friends[id] = after;
      return after - before;
    },
    addMany(gens, n) { (gens || []).forEach(g => g && this.addF(g.id, n)); this.save(); },
    LEVELS: [[300, "生死之交"], [150, "挚友"], [80, "好友"], [30, "相识"], [0, "陌生"]],
    levelName(p) { return this.LEVELS.find(([t]) => p >= t)[1]; },
    nextThreshold(p) { const up = this.LEVELS.slice().reverse().find(([t]) => t > p); return up ? up[0] : null; },
    teamLimit() { return 5 + Math.floor(((RPG.char && RPG.char.level) || 1) / 10); },
    inTeam(id) { return this.data.team.includes(id); },
    // 注：不在此预先叠加装备加成——如今任何武将的装备加成统一由 makeFighter/makeTroopUnit
    // 在其真正上场结算时按 id 查询叠加，避免队友在此处理和上场结算时被重复叠加。
    teamGenerals() { return this.data.team.map(id => DB.get(id)).filter(Boolean); },
    // 招募改为重金：只有友谊满上限（300）才谈得上招募，且金额较挚友期大幅上调，不再有免费档
    recruitCost(g) { return ratingScore(g) * 10; },
    // 招募：友谊须满上限（300）方可谈及，且始终需付重金；团队已满时须传入 replaceId 指定顶替的队友，
    // 队友不可被随意请出团队——唯一的移除途径就是被新招募的武将顶替。
    recruit(g, replaceId) {
      const p = this.pts(g.id);
      if (this.inTeam(g.id)) { toast(`${g.name} 已在队中`); return false; }
      if (p < this.MAX_FRIEND) { toast(`友谊未满上限（${this.MAX_FRIEND}），还不能招募`); return false; }
      if (this.data.team.length >= this.teamLimit() && !(replaceId != null && this.data.team.includes(replaceId))) {
        toast(`团队已满（${this.teamLimit()} 人上限），需选择一名队友替换`); return false;
      }
      const cost = this.recruitCost(g);
      if (cost > 0 && !this.spend(cost)) { toast(`金币不足（需 ${cost} 金）`); return false; }
      let replacedName = "";
      if (replaceId != null && this.data.team.includes(replaceId)) {
        const rg = DB.get(replaceId); replacedName = rg ? rg.name : "";
        this.dismiss(replaceId);
      }
      this.data.team.push(g.id); this.save();
      AudioSystem.sfx.victory();
      toast(`🎉 ${g.name} 加入了你的团队！${replacedName ? `（顶替了 ${replacedName}）` : ''}${cost ? `（-${cost}金，余 ${this.gold()}）` : "（生死之交，分文不取）"}`);
      return true;
    },
    dismiss(id) { this.data.team = this.data.team.filter(x => x !== id); this.save(); },
    // 赠礼：为一名史实武将装备宝物即视为赠送——直接在其装备槽点选宝物即可，无需另开弹窗。
    // 友谊按「(武将, 宝物) 是否首次相赠」发放而非按天限次：同一件宝物只在第一次装到某位
    // 武将身上时给一次友谊，日后无论怎么卸下/换回都不会重复计——避免拿两件宝物来回横跳刷友谊；
    // 想再赚友谊就得去战场/商店/锻造真正获得新的宝物，从根源上把友谊和宝物消耗绑定。
    GIFT_FRIEND: { normal: 10, fine: 30, rare: 60, legend: 100 },
    rarityLabel(k) { const r = Armory.rarityDef(k); return r ? r.n : k; },
    // 若该宝物是第一次装到这位武将身上，发放对应友谊并返回增量；否则返回 0（静默换装，不重复计）
    maybeGiftFriend(generalId, item) {
      if (!this.data.gifted) this.data.gifted = {};
      const list = this.data.gifted[generalId] || (this.data.gifted[generalId] = []);
      if (list.includes(item.uid)) return 0;
      list.push(item.uid);
      const nominal = this.GIFT_FRIEND[item.rarity] || 0;
      const add = this.addF(generalId, nominal); this.save();
      return add;
    },
    // "一天"的标识：开局后按游戏内天数（宿营推进），未开局时回退自然日
    dayKey() {
      const m = typeof Campaign !== "undefined" && Campaign.mapState();
      return m ? "d" + m.day : new Date().toISOString().slice(0, 10);
    },
    // 拜访：无需宝物，每名武将每（游戏）天限一次，友谊随机小额增长
    visit(g) {
      if (this.pts(g.id) >= this.MAX_FRIEND) { toast(`${g.name} 友谊已至上限，无需再拜访`); return false; }
      const today = this.dayKey();
      if (!this.data.visitDay) this.data.visitDay = {};
      if (this.data.visitDay[g.id] === today) { toast(`今天已拜访过 ${g.name}，宿营过夜后可再访`); return false; }
      this.data.visitDay[g.id] = today;
      const add = this.addF(g.id, randInt(1, 2)); this.save();
      AudioSystem.sfx.select();
      toast(add > 0 ? `🚶 拜访 ${g.name}，畅谈甚欢，友谊 +${add}` : `🚶 拜访 ${g.name}，畅谈甚欢（友谊已至上限）`);
      return true;
    },
  };

  /* ============================================================
   *  宝物系统：五类宝物（兵器/坐骑/书籍/服饰/奇珍）+ 稀有度 + 掉落/商店/锻造
   * ============================================================ */
  const ARMORY_KEY = "wujiang_armory_v1";
  const ARMORY_GLOBAL_KEY = "wujiang_armory_global_v1";
  const Armory = {
    data: { items: [], materials: { weapon: 0, mount: 0, book: 0, attire: 0, curio: 0 }, discovered: [], pity: { weapon: 0, mount: 0, book: 0, attire: 0, curio: 0 }, shop: [], shopDay: "", nextUid: 1 },
    load() {
      try {
        const d = JSON.parse(localStorage.getItem(ARMORY_KEY));
        if (d) this.data = Object.assign({ items: [], materials: { weapon: 0, mount: 0, book: 0, attire: 0, curio: 0 }, discovered: [], pity: { weapon: 0, mount: 0, book: 0, attire: 0, curio: 0 }, shop: [], shopDay: "", nextUid: 1 }, d);
      } catch { }
      this.ensureShop();
    },
    save() { localStorage.setItem(ARMORY_KEY, JSON.stringify(this.data)); },

    // ---- 全局宝物模板层（宝物阁编辑/自建，不随"新游戏"重置）----
    overrides: {}, custom: [], _nextCustomUid: 1,
    loadGlobal() {
      try {
        const d = JSON.parse(localStorage.getItem(ARMORY_GLOBAL_KEY));
        if (d) { this.overrides = d.overrides || {}; this.custom = d.custom || []; this._nextCustomUid = d.nextCustomUid || 1; }
      } catch { }
    },
    saveGlobal() { localStorage.setItem(ARMORY_GLOBAL_KEY, JSON.stringify({ overrides: this.overrides, custom: this.custom, nextCustomUid: this._nextCustomUid })); },
    // 数值限幅：宝物阁自建/编辑的加成值一律 ≤15，避免破坏平衡
    clampBonusArr(arr) { return arr.map(v => Math.max(1, Math.min(15, Math.round(+v || 1)))); },
    // 该类型的全部模板：内置模板(应用覆盖) + 自建模板；_key 用于编辑/删除时定位
    pool(typeK) {
      const base = this.TEMPLATES[typeK].map((t, idx) => {
        const key = typeK + "|b" + idx;
        const ov = this.overrides[key];
        return Object.assign({}, t, ov, { _key: key, _custom: false });
      });
      const customs = this.custom.filter(c => c.type === typeK).map(c => Object.assign({}, c, { _key: typeK + "|c" + c.uid, _custom: true }));
      return base.concat(customs);
    },
    templateByKey(key) { const typeK = key.split("|")[0]; return this.pool(typeK).find(t => t._key === key); },
    setOverride(key, patch) { this.overrides[key] = Object.assign({}, this.overrides[key], patch); this.saveGlobal(); },
    clearOverride(key) { delete this.overrides[key]; this.saveGlobal(); },
    addCustomTemplate(entry) { entry.uid = this._nextCustomUid++; this.custom.push(entry); this.saveGlobal(); return entry; },
    removeCustomTemplate(uid) { this.custom = this.custom.filter(c => c.uid !== uid); this.saveGlobal(); },

    TYPES: [
      { k: "weapon", n: "兵器", icon: "⚔️", stat: "wu" },
      { k: "mount", n: "坐骑", icon: "🐎", stat: "tong" },
      { k: "book", n: "书籍", icon: "📖", stat: null },
      { k: "attire", n: "服饰", icon: "👘", stat: "mei" },
      { k: "curio", n: "奇珍", icon: "🔮", stat: null },
    ],
    RARITIES: [
      { k: "normal", n: "普通", color: "#9a9a9a", weight: 55, bonus: 1 },
      { k: "fine", n: "精良", color: "#3b9aff", weight: 28, bonus: 3 },
      { k: "rare", n: "稀有", color: "#a24df0", weight: 13, bonus: 6 },
      { k: "legend", n: "传说", color: "#f4c430", weight: 4, bonus: 10 },
    ],
    // 奇珍不再只加体力：每件奇珍模板固定绑定一种效果，效果幅度按稀有度分档（普通/精良/稀有/传说）
    // 字段名直接对应武将对象上的加成属性，供 js/engine.js 战斗结算读取
    CURIO_EFFECTS: {
      ti: { label: "体魄", icon: "💪", unit: "" },
      critBonus: { label: "暴击率", icon: "💥", unit: "%" },
      regenBonus: { label: "气血回复", icon: "💗", unit: "" },
      guardBonus: { label: "护体", icon: "🛡️", unit: "%" },
      stamRegenBonus: { label: "气盛", icon: "⚡", unit: "" },
      apBonus: { label: "行动力上限", icon: "🚩", unit: "点" },
    },
    CURIO_VALS: {
      critBonus: [2, 4, 7, 12],
      regenBonus: [1, 3, 5, 8],
      guardBonus: [3, 6, 10, 16],
      stamRegenBonus: [2, 4, 8, 13],
      apBonus: [1, 1, 1, 1],   // 不随稀有度浮动，任意稀有度佩戴皆固定 +1 行动力上限
    },
    TEMPLATES: {
      weapon: [
        { n: "青釭剑", intro: "曹操收缴自袁绍，削铁如泥的百炼神兵。" },
        { n: "方天画戟", intro: "吕布纵横沙场的成名利刃。" },
        { n: "丈八蛇矛", intro: "张飞怒目圆睁，一矛可开山裂石。" },
        { n: "青龙偃月刀", intro: "关羽夜读春秋，刀锋凛冽如霜。" },
        { n: "倚天剑", intro: "曹操随身佩剑，锋芒不外露。" },
        { n: "雌雄双股剑", intro: "刘备起兵时所用双剑，刚柔并济。" },
        { n: "村正", intro: "妖刀之名震慑东瀛，锋锐诡谲。" },
        { n: "正宗", intro: "相州锻刀宗师之作，刃纹如流水。" },
        { n: "湛卢剑", intro: "古代名剑，剑气如虹，专诛无道之君。" },
        { n: "鱼肠剑", intro: "专诸刺王僚所用，锋芒暗藏杀机。" },
        { n: "龙泉剑", intro: "欧冶子铸剑，剑鸣龙吟，削铁如泥。" },
        { n: "七星宝刀", intro: "曹操欲行刺董卓所携，暗藏杀机。" },
        { n: "古锭刀", intro: "江湖流传的绝世好刀，寒光凛冽。" },
        { n: "关刀", intro: "仿造青龙偃月的重刃，力劈千军。" },
        { n: "松倉郷", intro: "相州传世名刀，刃纹如松涛。" },
        { n: "长曾祢虎彻", intro: "江户时代锻造的绝世名刀。" },
        { n: "郷義弘", intro: "越中锻刀三杰之一，锋锐无双。" },
        { n: "兼定", intro: "战国名匠所锻，刃切百炼。" },
        { n: "蜈蚣切", intro: "立花家传世名枪，锋刃如蜈蚣獠牙。" },
        { n: "日本号", intro: "天下三名枪之一，枪穗流光溢彩。" },
      ],
      mount: [
        { n: "赤兔马", intro: "日行千里，三易其主终随关羽。" },
        { n: "的卢", intro: "传说妨主之马，却驮刘备跃过檀溪。" },
        { n: "绝影", intro: "曹操爱驹，宛城一役舍命相救。" },
        { n: "爪黄飞电", intro: "曹操坐骑，通体金黄，疾如闪电。" },
        { n: "照夜玉狮子", intro: "白马如雪，夜行如昼。" },
        { n: "川中岛骏马", intro: "越后武士驰骋雪原的良驹。" },
        { n: "大黑", intro: "织田家家臣钟爱的骏马，性烈难驯。" },
        { n: "磨墨", intro: "毛色如墨，静如处子动如脱兔。" },
        { n: "追风", intro: "神骏追风逐电，日行千里不知疲。" },
        { n: "玉追", intro: "白玉般的骏马，性情温顺却不失锐气。" },
        { n: "黄骠马", intro: "秦琼坐骑，忠心护主。" },
        { n: "逍遥马", intro: "闲云野鹤般的良驹，来去无踪。" },
        { n: "汗血宝马", intro: "西域进贡神驹，日夜兼行不倦。" },
        { n: "乌骓马", intro: "项羽坐骑，力拔山兮气盖世的见证。" },
        { n: "生唼", intro: "源赖朝爱驹，身姿矫健。" },
        { n: "摺墨", intro: "静如泼墨，动若脱缰，与池月齐名。" },
        { n: "太夫黑", intro: "名马谱所载骏驹，毛色乌黑发亮。" },
        { n: "池月", intro: "佐佐木高纲坐骑，宇治川渡河立功。" },
        { n: "小烏", intro: "矫健异常的名驹，主人视若珍宝。" },
        { n: "惊帆", intro: "奔驰如乘风破浪之帆，勇冠三军。" },
      ],
      book: [
        { n: "孙子兵法", intro: "兵者诡道，通读可悟攻守之要。", stat: "zhi" },
        { n: "六韬", intro: "太公兵法，谋略与治国并重。", stat: "zhi" },
        { n: "三略", intro: "黄石公授张良之书，权谋深藏。", stat: "zhi" },
        { n: "太公兵法", intro: "兴周灭商的不传之秘。", stat: "zhi" },
        { n: "五轮书", intro: "宫本武藏毕生剑理所著。", stat: "zhi" },
        { n: "甲阳军鉴", intro: "武田家兵法秘传，攻守皆宜。", stat: "zhi" },
        { n: "贞观政要", intro: "治世箴言，修身齐家之道。", stat: "zheng" },
        { n: "武经总要", intro: "宋代官修兵书，集历代阵法大成。", stat: "zhi" },
        { n: "吴子兵法", intro: "吴起著兵书，与孙子兵法并称。", stat: "zhi" },
        { n: "尉缭子", intro: "论兵制与军法，治军严明之道。", stat: "zhi" },
        { n: "司马法", intro: "上古兵制典籍，礼战并重。", stat: "zhi" },
        { n: "三十六计", intro: "计计相生，攻守进退皆藏玄机。", stat: "zhi" },
        { n: "战国策", intro: "纵横家谋略汇编，辩术权谋兼备。", stat: "zheng" },
        { n: "资治通鉴", intro: "鉴古知今，治乱兴衰尽在其中。", stat: "zheng" },
        { n: "孙臏兵法", intro: "孙膑传世兵法，围魏救赵之智。", stat: "zhi" },
        { n: "论语", intro: "修身立世的儒家经典。", stat: "zheng" },
        { n: "汉书", intro: "记两汉兴衰，鉴古通今。", stat: "zheng" },
        { n: "忍秘伝", intro: "忍者秘传心得，暗藏机变之术。", stat: "zhi" },
        { n: "兵法家伝书", intro: "柳生家传剑术兵法合一之书。", stat: "zhi" },
        { n: "太阁记", intro: "记丰臣秀吉一代霸业的兵略札记。", stat: "zhi" },
      ],
      attire: [
        { n: "蜀锦战袍", intro: "蜀地织锦所制战袍，华美不失威仪。" },
        { n: "云纹披风", intro: "绣工精湛，行走间云影翻涌。" },
        { n: "麒麟战甲罩衫", intro: "甲上绣麒麟纹，威而不猛。" },
        { n: "南蛮锦裘", intro: "异域进贡的锦裘，色泽夺目。" },
        { n: "羽织家纹", intro: "绣有家纹的阵羽织，彰显门第。" },
        { n: "阵羽织", intro: "战场上御寒亦壮声势的外罩。" },
        { n: "唐纹锦缎", intro: "唐风纹样织成，雍容华贵。" },
        { n: "凤纹腰带", intro: "腰间凤纹暗藏，气度自生。" },
        { n: "龙纹玄甲", intro: "玄色铁甲绣龙纹，威严肃穆。" },
        { n: "素纱披风", intro: "轻若烟纱，行动间不失飘逸。" },
        { n: "虎皮战裙", intro: "猛虎之皮所制战裙，彰显悍勇。" },
        { n: "锦鲤纹袍", intro: "锦鲤纹样寓意吉祥，华贵不凡。" },
        { n: "织金战袄", intro: "金线织就的战袄，价值连城。" },
        { n: "缎面披甲", intro: "缎面覆甲，兼具防护与仪容。" },
        { n: "陣笠", intro: "战场上简朴却不失威仪的斗笠。" },
        { n: "具足", intro: "日式铠甲整套，坚固实用。" },
        { n: "胴丸", intro: "轻便贴身的日式铠甲。" },
        { n: "直垂", intro: "武家常服礼装，端庄大方。" },
        { n: "千鸟纹小袖", intro: "绣有千鸟纹样的和服，典雅别致。" },
        { n: "云龙披风", intro: "云龙纹样的锦缎披风，气势恢宏。" },
      ],
      curio: [
        { n: "传国玉玺", intro: "得之者得天命加身，号令四方，行动更无阻碍。", effect: "apBonus" },
        { n: "随侯珠", intro: "灵蛇衔珠相报，光华养神固本。", effect: "ti" },
        { n: "和氏璧", intro: "稀世美玉，握之心神安定，气血自生。", effect: "regenBonus" },
        { n: "勾玉", intro: "沟通神灵的古老玉饰，气息绵长。", effect: "stamRegenBonus" },
        { n: "八尺琼曲玉", intro: "三神器之一，佩之神佑护体。", effect: "regenBonus" },
        { n: "南蛮令", intro: "孟获信物，持之如猛虎添翼，愈战愈勇。", effect: "guardBonus" },
        { n: "不老丹方", intro: "方士所炼丹方，强身固体。", effect: "ti" },
        { n: "定军神符", intro: "军中祈福神符，佑主将屹立不倒。", effect: "guardBonus" },
        { n: "九鼎", intro: "象征天下九州的重器，坐拥九鼎，行走四方皆如履平地。", effect: "apBonus" },
        { n: "河图洛书", intro: "上古神秘图谶，蕴含天地至理，气息不绝。", effect: "stamRegenBonus" },
        { n: "麒麟令", intro: "瑞兽麒麟所化令牌，护佑军心，士气如虹。", effect: "critBonus" },
        { n: "太极图", intro: "阴阳调和之图，静心凝神，固本培元。", effect: "ti" },
        { n: "长生诀", intro: "修真秘术残卷，滋养元气。", effect: "ti" },
        { n: "镇国鼎", intro: "传说中镇压国运的宝鼎，屹立不倒。", effect: "guardBonus" },
        { n: "天叢雲劍", intro: "三神器之一护符，斩妖除魔之气锐不可当。", effect: "critBonus" },
        { n: "八咫镜", intro: "三神器之一，映照真心，护身避邪。", effect: "regenBonus" },
        { n: "铜雀瓦砚", intro: "铜雀台遗物，文气所钟，绵绵不绝。", effect: "stamRegenBonus" },
        { n: "五行珠", intro: "集金木水火土之力于一身，生生不息。", effect: "regenBonus" },
        { n: "不动明王护符", intro: "密宗至尊护法符，驱邪定心，护体挡厄。", effect: "guardBonus" },
        { n: "风林火山旗", intro: "武田家军旗，气势如虹，锐气逼人。", effect: "critBonus" },
      ],
    },
    typeDef(k) { return this.TYPES.find(t => t.k === k); },
    rarityDef(k) { return this.RARITIES.find(r => r.k === k); },

    rollRarity(pity) {
      if (pity) {
        const pool = this.RARITIES.filter(r => r.k === "rare" || r.k === "legend");
        return pool[randInt(0, pool.length - 1)].k;
      }
      const total = this.RARITIES.reduce((s, r) => s + r.weight, 0);
      let x = Math.random() * total;
      for (const r of this.RARITIES) { if (x < r.weight) return r.k; x -= r.weight; }
      return "normal";
    },
    // 奇珍某效果在四档稀有度下的数值（体魄沿用通用属性加成表，其余效果各有独立幅度表）
    curioVals(effect) { return effect === "ti" ? this.RARITIES.map(r => r.bonus) : this.CURIO_VALS[effect]; },
    // 加成数值在基础档位之上小幅浮动：普通1~2、精良3~5、稀有6~8、传说9~10（每件宝物生成时各自独立随机）
    BONUS_RANGE: { normal: [1, 2], fine: [3, 5], rare: [6, 8], legend: [9, 10] },
    rollBonus(rarityK) { const [lo, hi] = this.BONUS_RANGE[rarityK]; return randInt(lo, hi); },
    makeItem(typeK, rarityK, tmpl) {
      const type = this.typeDef(typeK);
      const pool = this.pool(typeK);
      const t = tmpl || pool[randInt(0, pool.length - 1)];
      const rIdx = this.RARITIES.findIndex(r => r.k === rarityK);
      let stat, bonus;
      if (typeK === "curio") {
        stat = t.effect || "ti";
        bonus = t.bonusOverride ? t.bonusOverride[rIdx] : (stat === "ti" ? this.rollBonus(rarityK) : this.curioVals(stat)[rIdx]);
      } else if (typeK === "book") {
        stat = t.stat || "zhi";   // 每部典籍按其性质固定加智力或政治，不再随机
        bonus = t.bonusOverride ? t.bonusOverride[rIdx] : this.rollBonus(rarityK);
      } else {
        stat = type.stat;
        bonus = t.bonusOverride ? t.bonusOverride[rIdx] : this.rollBonus(rarityK);
      }
      const item = { uid: this.data.nextUid++, type: typeK, tid: t.n, name: t.n, icon: type.icon, intro: t.intro, rarity: rarityK, stat, bonus, equippedBy: null, identified: true };
      // 行动力上限奇珍：无论抽到哪档稀有度，只要佩戴即生效（由 Campaign.recalcApMax 读取 apBonus 字段计数，不叠加数值只计佩戴与否）
      if (stat === "apBonus") item.apBonus = 1;
      if (!this.data.discovered.includes(t.n)) this.data.discovered.push(t.n);
      return item;
    },

    // 唯一奇珍：全地图各仅一件，纯粹的高稀有度专属装备，不再附带行动力上限加成（该效果已转移至常规奇珍池的「传国玉玺」「九鼎」）
    UNIQUE_TREASURES: {
      chitu: { n: "赤兔·千里神驹", type: "mount", stat: "tong", intro: "人中吕布马中赤兔，日行千里，唯此一骑——佩之统帅超群。" },
      senriGeta: { n: "千里靴", type: "attire", stat: "mei", intro: "踏遍天下路不知疲，唯此一双——佩之魅力超群。" },
    },
    makeUniqueTreasure(key) {
      const t = this.UNIQUE_TREASURES[key];
      const type = this.typeDef(t.type);
      const item = {
        uid: this.data.nextUid++, type: t.type, tid: t.n, name: t.n, icon: type.icon, intro: t.intro,
        rarity: "legend", stat: t.stat, bonus: this.RARITIES[this.RARITIES.length - 1].bonus,
        equippedBy: null, identified: true,
      };
      if (!this.data.discovered.includes(t.n)) this.data.discovered.push(t.n);
      return item;
    },

    /* ---- 掉落：战场拾获的宝物先以「未鉴定」状态入库，需在宝物库花金鉴宝才能查看细节/装备 ---- */
    IDENTIFY_COST: 50,
    dropItem(typeK) {
      const k = typeK || this.TYPES[randInt(0, this.TYPES.length - 1)].k;
      const item = this.makeItem(k, this.rollRarity(false));
      item.identified = false;
      this.data.items.push(item); this.save();
      return item;
    },
    dropMaterial(typeK, n) {
      const k = typeK || this.TYPES[randInt(0, this.TYPES.length - 1)].k;
      n = n || 1;
      this.data.materials[k] = (this.data.materials[k] || 0) + n;
      this.save();
      return { type: k, n };
    },
    // 统一战利品判定：item/material 各自独立按几率判定，都可能命中或落空；仅角色扮演生效
    roll(chance, matChance, matN) {
      const drops = [];
      if (!RPG.char) return drops;
      if (Math.random() < chance) drops.push({ kind: "item", item: this.dropItem() });
      if (Math.random() < matChance) { const d = this.dropMaterial(null, matN || 1); drops.push({ kind: "mat", type: d.type, n: d.n }); }
      return drops;
    },
    guaranteedItem(rarityK, typeK) {
      const k = typeK || this.TYPES[randInt(0, this.TYPES.length - 1)].k;
      const item = this.makeItem(k, rarityK);
      item.identified = false;
      this.data.items.push(item); this.save();
      return item;
    },
    // 拾获提示：不揭示战场掉落宝物的具体细节，需到宝物库鉴宝
    dropLine(drops) {
      if (!drops || !drops.length) return "";
      const parts = drops.map(d => d.kind === "item"
        ? `❔ 神秘宝物一件（详情请到宝物库鉴宝）`
        : `${this.typeDef(d.type).icon}${this.typeDef(d.type).n}材料 +${d.n}`);
      return `<br>🎁 拾获：${parts.join("、")}`;
    },
    // 鉴宝：花金揭示未鉴定宝物的具体细节，之后方可装备/拆解
    identify(uid) {
      const item = this.data.items.find(i => i.uid === uid); if (!item) return false;
      if (item.identified !== false) return true;
      if (!Bond.spend(this.IDENTIFY_COST)) { toast(`金币不足（鉴宝需 ${this.IDENTIFY_COST} 金）`); return false; }
      item.identified = true; this.save();
      AudioSystem.sfx.victory();
      toast(`🔍 鉴定出 ${item.icon}「${item.name}」（${this.rarityDef(item.rarity).n}）！`);
      return true;
    },

    /* ---- 装备（未鉴定的宝物不可装备）---- */
    itemsOf(owner) { return this.data.items.filter(i => i.equippedBy === owner); },
    availableFor(owner, typeK) { return this.data.items.filter(i => i.type === typeK && i.identified !== false && (i.equippedBy === null || i.equippedBy === owner)); },
    equip(uid, owner) {
      const item = this.data.items.find(i => i.uid === uid); if (!item) return false;
      this.data.items.filter(i => i.equippedBy === owner && i.type === item.type).forEach(i => i.equippedBy = null);
      item.equippedBy = owner; this.save();
      AudioSystem.sfx.select();
      // 主角换装可能涉及行动力奇珍（apBonus 类奇珍/唯一奇珍）的增减，即时重算行动力上限
      if (owner === "hero" && typeof Campaign !== "undefined") { Campaign.recalcApMax(); Campaign.save(); }
      return true;
    },
    unequip(uid) {
      const item = this.data.items.find(i => i.uid === uid); if (!item) return false;
      const wasHero = item.equippedBy === "hero";
      item.equippedBy = null; this.save();
      if (wasHero && typeof Campaign !== "undefined") { Campaign.recalcApMax(); Campaign.save(); }
      return true;
    },
    statBonus(owner) {
      const out = {};
      this.itemsOf(owner).forEach(i => { out[i.stat] = (out[i.stat] || 0) + i.bonus; });
      return out;
    },
    // __geared 标记该对象已叠加过装备加成，避免战斗中生成的战斗单位(其 g 已是叠加结果)
    // 在详情弹窗里被 showDetail 二次叠加而显示虚高数值。
    // 同时叠加刺杀等战役内负面效果（Campaign.mapState().statPenalty，owner 为武将id或"hero"）与
    // 武将大会等战役内正面效果（Campaign.mapState().statGrowth，同一 owner 键），只影响当局战役
    // 展示与交战，不写回全局武将图鉴数据。
    geared(g, owner) {
      if (g.__geared) return g;
      const b = this.statBonus(owner);
      const m = typeof Campaign !== "undefined" && Campaign.mapState();
      const penalty = m && m.statPenalty && m.statPenalty[owner];
      const growth = m && m.statGrowth && m.statGrowth[owner];
      if (!Object.keys(b).length && !penalty && !growth) return g;
      const g2 = clone(g);
      Object.keys(b).forEach(k => { g2[k] = (g2[k] || 0) + b[k]; });
      if (penalty) Object.keys(penalty).forEach(k => { g2[k] = Math.max(10, (g2[k] || 0) - penalty[k]); });
      if (growth) Object.keys(growth).forEach(k => { g2[k] = (g2[k] || 0) + growth[k]; });
      g2.__geared = true;
      return g2;
    },

    /* ---- 分解 ---- */
    DISMANTLE_RETURN: { normal: 1, fine: 2, rare: 3, legend: 5 },
    dismantle(uid) {
      const idx = this.data.items.findIndex(i => i.uid === uid); if (idx < 0) return false;
      const item = this.data.items[idx];
      if (item.identified === false) { toast("需先鉴宝，才能拆解"); return false; }
      if (item.equippedBy) { toast("请先卸下装备再分解"); return false; }
      const n = this.DISMANTLE_RETURN[item.rarity];
      this.data.materials[item.type] = (this.data.materials[item.type] || 0) + n;
      this.data.items.splice(idx, 1); this.save();
      toast(`分解「${item.name}」，获得 ${this.typeDef(item.type).n}材料 +${n}`);
      return true;
    },

    /* ---- 出售：售价为市价的一半（低于市价），售出的宝物以货摊形式回流集市，可再被他人购得 ---- */
    SELL_FACTOR: 0.5,
    sellItem(uid) {
      const idx = this.data.items.findIndex(i => i.uid === uid); if (idx < 0) return false;
      const item = this.data.items[idx];
      if (item.identified === false) { toast("需先鉴宝，才能出售"); return false; }
      if (item.equippedBy) { toast("请先卸下装备再出售"); return false; }
      const price = Math.round(this.shopPrice(item.rarity) * this.SELL_FACTOR);
      const gold = Bond.addGold(price);
      this.data.items.splice(idx, 1);
      // 直接以该宝物自身的名称/描述/属性重建货摊模板，不依赖图鉴模板池（避免自建模板事后被删导致挂空引用）
      const tmpl = { n: item.name, intro: item.intro, stat: item.stat, effect: item.stat };
      this.data.shop.push({ type: item.type, rarity: item.rarity, tmpl });
      this.save();
      toast(`已出售「${item.name}」，获得 ${gold} 金（宝物已回流集市）`);
      return true;
    },

    /* ---- 锻造（保底：连续12次未出稀有以上，下一次必出稀有以上） ---- */
    FORGE_COST: 6,
    FORGE_GOLD: 40,
    FORGE_PITY: 12,
    // opts 可覆盖成本（城市铁匠铺的专精类型享受材料/金币减免），保底与产出逻辑不变
    forge(typeK, opts) {
      const matCost = (opts && opts.matCost) || this.FORGE_COST;
      const goldCost = (opts && opts.goldCost) || this.FORGE_GOLD;
      if ((this.data.materials[typeK] || 0) < matCost) { toast(`材料不足（需 ${this.typeDef(typeK).n}材料 ${matCost}）`); return null; }
      if (!Bond.spend(goldCost)) { toast(`金币不足（需 ${goldCost} 金）`); return null; }
      this.data.materials[typeK] -= matCost;
      this.data.pity[typeK] = (this.data.pity[typeK] || 0) + 1;
      const forcePity = this.data.pity[typeK] >= this.FORGE_PITY;
      const r = this.rollRarity(forcePity);
      if (forcePity || r === "rare" || r === "legend") this.data.pity[typeK] = 0;
      const item = this.makeItem(typeK, r);
      this.data.items.push(item); this.save();
      AudioSystem.sfx.victory();
      toast(`⚒ 锻造出 ${item.icon}「${item.name}」（${this.rarityDef(r).n}）！`);
      return item;
    },

    /* ---- 商店：每日刷新，可花金币主动重刷 ---- */
    SHOP_SIZE: 6,
    REFRESH_COST: 20,
    ensureShop() {
      const today = new Date().toISOString().slice(0, 10);
      if (this.data.shopDay !== today || !this.data.shop.length) this.refreshShop(false);
    },
    refreshShop(paid) {
      if (paid && !Bond.spend(this.REFRESH_COST)) { toast(`金币不足（重刷需 ${this.REFRESH_COST} 金）`); return false; }
      this.data.shop = Array.from({ length: this.SHOP_SIZE }, () => {
        const type = this.TYPES[randInt(0, this.TYPES.length - 1)];
        const r = this.rollRarity(false);
        const p = this.pool(type.k);
        return { type: type.k, rarity: r, tmpl: p[randInt(0, p.length - 1)] };
      });
      this.data.shopDay = new Date().toISOString().slice(0, 10);
      this.save();
      return true;
    },
    // discount 为真时（对马黑市常驻 / 行脚商队奇遇临时触发）全场八折；
    // 基础售价按稀有度基准加成数值的约1000倍计算（普通1000/精良3000/稀有6000/传说10000），
    // 取基准值而非每件实际浮动后的加成——货摊/商店展示价格时实际宝物尚未生成，无从得知精确浮动值
    shopPrice(rarityK, discount) {
      const base = this.rarityDef(rarityK).bonus * 1000;
      return discount ? Math.round(base * 0.8) : base;
    },
    buyShop(idx) {
      const s = this.data.shop[idx]; if (!s) return null;
      const price = this.shopPrice(s.rarity, shopDiscountActive());
      if (!Bond.spend(price)) { toast(`金币不足（需 ${price} 金）`); return null; }
      const item = this.makeItem(s.type, s.rarity, s.tmpl);
      this.data.items.push(item);
      this.data.shop.splice(idx, 1);
      this.save();
      AudioSystem.sfx.select();
      toast(`已购得 ${item.icon}「${item.name}」（${this.rarityDef(s.rarity).n}）-${price}金`);
      return item;
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
    eff(c, k) { return c.base[k] + Math.round(c.alloc[k] || 0); },
    heroGeneral() {
      const c = this.char;
      const g = { id: -1, name: c.name, side: c.side, title: `Lv.${c.level} 历练者`, intro: c.intro || "你亲手培养的武将。" };
      DIMS.forEach(([k]) => g[k] = this.eff(c, k));
      return Armory.geared(g, "hero");
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
      this.char = { name, side, title: title || "", base: clone(base), alloc, level: 1, exp: 0, points: points || 0, wins: 0, losses: 0, growthMul: 1, talents: [] };
      this._roll = null; this._name = "";
      this.save(); AudioSystem.sfx.victory(); this.renderHub();
    },
    // 扮演史实武将开局：少年模式(young)按默认值60%起步、最高两项属性定为本命天赋(成长+50%、可破默认上限)；
    // 巅峰模式(peak)默认原值开局，但历练加点成长减半
    createFromGeneral(g, difficulty) {
      const alloc = {}; DIMS.forEach(([k]) => alloc[k] = 0);
      const base = {};
      const sortedKeys = DIMS.map(([k]) => k).slice().sort((a, b) => g[b] - g[a]);
      const talents = difficulty === "young" ? sortedKeys.slice(0, 2) : [];
      DIMS.forEach(([k]) => { base[k] = difficulty === "young" ? Math.max(1, Math.round(g[k] * 0.6)) : g[k]; });
      this.char = {
        name: g.name, side: g.side, title: g.title || "", intro: g.intro || "", base, alloc,
        level: 1, exp: 0, points: 15, wins: 0, losses: 0,
        growthMul: difficulty === "peak" ? 0.5 : 1, talents, originGeneralId: g.id,
      };
      this._roll = null; this._name = "";
      this.save(); AudioSystem.sfx.victory(); this.renderHub();
    },

    /* ---- 主面板 ---- */
    renderHub() {
      const c = this.char, C = $("#rpg-content");
      const need = this.expNeed(c.level), expPct = Math.min(100, c.exp / need * 100);
      const hg = this.heroGeneral();   // 含已装备宝物的加成，用于展示当前真实作战数值
      const sum = DIMS.reduce((s, [k]) => s + hg[k], 0);
      const dims = DIMS.map(([k, l]) => {
        const raw = this.eff(c, k), v = hg[k], gear = v - raw;
        const isTalent = c.talents && c.talents.includes(k);
        return `<div class="rpg-dim">
          <span class="rd-lbl">${l}${isTalent ? '<i class="rd-talent" title="本命天赋：加点成长 +50%，可突破默认上限">★</i>' : ''}</span>
          <span class="rd-track"><span class="rd-bar" style="width:${Math.min(100, v / 1.2)}%;background:${gradeColor(v)}"></span></span>
          <span class="rd-val">${v}${gear ? `<i class="rd-gear">(${gear > 0 ? '+' : ''}${gear})</i>` : ''}</span>${gradeChip(v)}
          <button class="rd-plus" data-k="${k}" ${c.points > 0 ? '' : 'disabled'}>＋</button>
        </div>`;
      }).join("");
      C.innerHTML = `<div class="rpg-hub">
        <div class="rpg-card ${c.side}">
          <div class="rpg-av">${avatarChar(c.name)}</div>
          <div class="rpg-meta">
            <div class="rpg-name">${c.name} <button class="rpg-edit" id="rpg-rename" title="改名">✎</button> <span class="rpg-lv">Lv.${c.level}</span></div>
            <div class="rpg-side-tag">${c.side === 'cn' ? '三国风' : '战国风'} · 战绩 ${c.wins}胜${c.losses}负</div>
            ${c.talents && c.talents.length ? `<div class="rpg-side-tag talent">✨ 少年成长 · 本命天赋：${c.talents.map(k => DIMS.find(d => d[0] === k)[1]).join('、')}（加点成长 +50%）</div>` : ''}
            ${c.growthMul === 0.5 ? `<div class="rpg-side-tag talent">⚔ 巅峰模式 · 历练加点成长减半</div>` : ''}
            <div class="rpg-exp"><span class="rpg-exp-fill" style="width:${expPct}%"></span><span class="rpg-exp-txt">EXP ${c.exp}/${need}</span></div>
          </div>
        </div>
        <div class="rpg-overview">
          <div class="rpg-radar">${radarSVG(hg, 220)}</div>
          <div class="rpg-side">
            <div class="rpg-score-mini">
              <span class="rsm-lbl">武将评分</span>
              <span class="rsm-num">${ratingScore(hg)}</span>
              ${ratingChip(hg)}
              <span class="rsm-points">可分配加点：<b>${c.points}</b>${c.points > 0 ? '（点 ＋ 分配）' : ''}</span>
              <span class="rsm-sub">六维 ${sum} + 突出 ${Math.round(ratingScore(hg) - sum)}</span>
            </div>
            <div class="rpg-dims">${dims}</div>
          </div>
        </div>
        <div class="bond-team">
          <div class="bt-head">💰 金币 <b>${Bond.gold()}</b> ｜ 👥 我的团队 ${Bond.data.team.length}/${Bond.teamLimit()}<small>（挚友可招募；队友任 2v2 副将，同阵营队友在组队/国战/阵营大战必上阵；队友不可随意请出，满员时招募新武将可选择替换）</small></div>
          <div class="bt-list">${Bond.teamGenerals().map(t => `<span class="bt-chip" data-id="${t.id}">${t.name}</span>`).join("") || '<span class="bt-empty">尚无队友——先去结交武将吧</span>'}</div>
        </div>
        <div class="bond-team">
          <div class="bt-head">🎒 我的装备<small>（点击槽位可装备/更换宝物库中的宝物）</small></div>
          <div class="eq-slots">${eqSlotsHtml("hero")}</div>
          <button class="cup-go" id="rpg-armory" style="margin-top:8px;width:100%">🏪 宝物库（仓库 · 商店 · 锻造）</button>
        </div>
        <div class="section-hint">历练、悬赏、擂台/道场等设施挑战请在「天下游历」地图中进行（均计入经验与名声）；只想爽玩各模式可去首页「小游戏」。</div>
      </div>`;
      // 蜘蛛图外框高度与右侧（评分+加点+六维）总高度对齐；图形本身按宽度等比居中，不被拉伸变形
      const sideEl = C.querySelector(".rpg-side"), radarEl = C.querySelector(".rpg-radar");
      if (sideEl && radarEl) {
        const h = Math.round(sideEl.getBoundingClientRect().height);
        if (h > 0) radarEl.style.height = h + "px";
      }
      $$(".rd-plus").forEach(b => b.onclick = () => this.allocate(b.dataset.k));
      $("#rpg-armory").onclick = () => ArmoryUI.open();
      $$(".bt-chip").forEach(el => el.onclick = () => {
        const tg = DB.get(+el.dataset.id); if (tg) showDetail(tg);
      });
      bindEqSlots(() => this.renderHub());
      $("#rpg-rename").onclick = () => {
        const n = prompt("新的名字：", c.name); if (n && n.trim()) { c.name = n.trim().slice(0, 6); this.save(); this.renderHub(); }
      };
    },
    allocate(k) {
      const c = this.char;
      if (c.points <= 0) return;
      if (this.eff(c, k) >= 110) { toast("该维度已达上限 110"); return; }
      // 本命天赋（少年模式最高两项）加点成长 +50%；巅峰模式整体成长减半
      const mul = (c.growthMul || 1) * (c.talents && c.talents.includes(k) ? 1.5 : 1);
      c.alloc[k] = (c.alloc[k] || 0) + mul;
      c.points--;
      AudioSystem.sfx.select();
      this.save(); this.renderHub();
    },

    // 历练解锁所需的最低名声阶梯：初期靠悬赏/切磋/设施打出名声后才开放这一自由练级手段
    TRAIN_FAME_TIER: 2,
    CUP_FAME_TIER: 4,
    /* ---- 历练（天下地图开启后消耗 1 点行动力；名声需达「小有名气」阶梯方可开放） ---- */
    train() {
      const m = typeof Campaign !== "undefined" && Campaign.mapState();
      if (m && Campaign.fameTierIndex(m.fame || 0) < this.TRAIN_FAME_TIER) {
        toast(`声望不足，需达到「${Campaign.FAME_TIERS[this.TRAIN_FAME_TIER].n}」名声阶梯才能历练——先去悬赏、切磋或设施挑战中扬名吧`);
        return;
      }
      if (!spendAP()) return;
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
      let goldGain = 0, drops = [];
      if (heroWon) {
        goldGain = Bond.addGold(15);
        // 只与己方阵营武将「不打不相识」增进友谊；敌方阵营武将唯有刺杀，不产生友谊值
        if (opp.side === c.side) {
          Bond.addF(opp.id, 5);
          if (BATTLE && BATTLE.duo) Bond.addF(BATTLE.duo.d1.id, 15);   // 与副将并肩获胜
        }
        Bond.save();
        drops = Armory.roll(0.2, 0.3, 1);
        Campaign.addFame(3);                          // 赢一场切磋，薄名声渐积
      }
      c.exp += gain;
      let lvUp = 0;
      while (c.exp >= this.expNeed(c.level)) { c.exp -= this.expNeed(c.level); c.level++; c.points += 1; lvUp++; }
      this.save();
      // 悬赏「讨伐令」判定：命中目标即完成，未命中或落败则该次出征作废（悬赏仍保留在榜上可再次接取）
      let extraHtml = "";
      const m = Campaign.mapState();
      if (m && m.activeBounty && m.activeBounty.kind === "duel") {
        const ab = m.activeBounty;
        extraHtml += (heroWon && opp.id === ab.targetId) ? "<br>" + completeBountyReward(ab) : `<br>📋 悬赏未达成：${ab.desc}（仍保留在城池悬赏榜）`;
        m.activeBounty = null; Campaign.save();
      }
      // 悬赏「刺杀令」：命中目标且刺杀得手才算完成，走与「讨伐令」相同的判定与结算通道
      if (m && m.activeBounty && m.activeBounty.kind === "assassin") {
        const ab = m.activeBounty;
        extraHtml += (heroWon && opp.id === ab.targetId) ? "<br>" + completeBountyReward(ab) : `<br>📋 悬赏未达成：${ab.desc}（仍保留在城池悬赏榜）`;
        m.activeBounty = null; Campaign.save();
      }
      // 悬赏「双雄令」：任意一场 2v2 取胜即算达成（BATTLE.duo 存在即说明本场是 2v2）
      if (m && m.activeBounty && m.activeBounty.kind === "duo" && BATTLE && BATTLE.duo) {
        const ab = m.activeBounty;
        extraHtml += (heroWon) ? "<br>" + completeBountyReward(ab) : `<br>📋 悬赏未达成：${ab.desc}（仍保留在城池悬赏榜）`;
        m.activeBounty = null; Campaign.save();
      }
      // 天下擂台/双人比武等设施挑战：胜利额外记一笔名声（duo 也经此结算通道）
      if (m && (m.activeFacility === "duel" || m.activeFacility === "duo")) {
        if (heroWon) { Campaign.addFame(8); extraHtml += `<br>🏯 设施挑战获胜，名声 <b style="color:var(--cn-red)">+8</b>`; }
        m.activeFacility = null; Campaign.save();
      }
      // 切磋：胜利增进友谊，落败不加（每名武将每游戏日限一次，见 bond-spar 绑定处）；
      // 双方按彼此当前友谊值有 1%~31% 概率触发「切磋习得」——若败方六维中最高一项大于胜方同项数值，胜方该项 +1
      if (m && m.activeSpar != null) {
        if (heroWon && opp.id === m.activeSpar) {
          const add = Bond.addF(opp.id, randInt(3, 5)); Bond.save();
          extraHtml += add > 0
            ? `<br>⚔️ 切磋获胜，与 ${opp.name} 友谊 <b style="color:var(--cn-red)">+${add}</b>`
            : `<br>⚔️ 切磋获胜，惜与 ${opp.name} 友谊已至上限（${Bond.MAX_FRIEND}）`;
        } else if (opp.id === m.activeSpar) {
          extraHtml += `<br>⚔️ 切磋落败，未能增进与 ${opp.name} 的友谊`;
        }
        extraHtml += this.trySparLearn(m, heroWon, opp);
        m.activeSpar = null; Campaign.save();
      }
      // 刺杀：潜入敌境对敌方阵营武将的单挑。胜则重创敌将六维（随机一项 -1~3，写入 Campaign 战役内 statPenalty，
      // 经 Armory.geared 在后续任何展示/交战中生效但不污染全局武将图鉴）；败则己方反遭重创，逻辑对称
      if (m && m.activeAssassin != null && opp.id === m.activeAssassin) {
        const dim = DIMS[randInt(0, DIMS.length - 1)];
        const amt = randInt(1, 3);
        if (!m.statPenalty) m.statPenalty = {};
        const key = heroWon ? opp.id : "hero";
        if (!m.statPenalty[key]) m.statPenalty[key] = { ti: 0, wu: 0, tong: 0, zhi: 0, zheng: 0, mei: 0 };
        m.statPenalty[key][dim[0]] += amt;
        if (heroWon) Campaign.addFame(15);
        extraHtml += heroWon
          ? `<br>🗡️ 刺杀得手！${opp.name} ${dim[1]} <b style="color:var(--cn-red)">-${amt}</b>，名声 <b style="color:var(--cn-red)">+15</b>`
          : `<br>🗡️ 刺杀失手，反被重创！你的 ${dim[1]} <b style="color:var(--cn-red)">-${amt}</b>`;
        m.activeAssassin = null; Campaign.save();
      }
      // 威名榜：击败八大高手记录战绩，凑齐后与武道会夺冠一并达成"天下无双"终局
      if (heroWon) extraHtml += checkRivalDefeat(opp);
      const bg = c.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
      openOverlay(`<div class="result-card">
        <h1>${heroWon ? '历练胜利' : '虽败犹荣'}</h1>
        <div class="winner-av" style="background:${bg}">${avatarChar(c.name)}</div>
        <div class="wname">${c.name}</div>
        <div class="wdesc">${heroWon ? '击败' : '不敌'} ${opp.name}（武将评分 ${oppSum} / 你 ${heroSum}）${tag}<br>获得经验 <b style="color:var(--cn-red)">+${gain}</b>${Bond.goldLine(goldGain)}${Armory.dropLine(drops)}
          ${lvUp ? `<br>🎉 升级 ${lvUp} 级！获得加点 <b style="color:var(--cn-red)">+${lvUp * 1}</b>` : ''}${extraHtml}</div>
        <div class="btns">
          <button class="btn-primary" id="rpg-again">再历练</button>
          <button class="btn-ghost" id="rpg-hub">返回养成</button>
        </div></div>`);
      $("#rpg-again").onclick = () => { closeOverlay(); this.train(); };
      $("#rpg-hub").onclick = () => { closeOverlay(); goHome(); };
    },
    // 切磋习得：按对手当前友谊值算出 1%~31% 的触发概率；命中后比较双方（按当前实际数值，含装备/惩罚/成长加成）
    // 六维——若败方六维中最高一项严格大于胜方同一项，胜方该项 +1（主角走 alloc 永久成长，NPC 走战役内 statGrowth）
    trySparLearn(m, heroWon, opp) {
      const chance = 0.01 + (Bond.pts(opp.id) / Bond.MAX_FRIEND) * 0.30;
      if (Math.random() >= chance) return "";
      const winnerG = heroWon ? this.heroGeneral() : Armory.geared(opp, opp.id);
      const loserG = heroWon ? Armory.geared(opp, opp.id) : this.heroGeneral();
      const loserBest = DIMS.reduce((best, d) => loserG[d[0]] > loserG[best[0]] ? d : best, DIMS[0]);
      const [dimKey, dimLabel] = loserBest;
      if ((winnerG[dimKey] || 0) >= (loserG[dimKey] || 0)) return "";
      if (heroWon) {
        if (RPG.eff(this.char, dimKey) >= 110) return "";
        this.char.alloc[dimKey] = (this.char.alloc[dimKey] || 0) + 1;
        this.save();
        return `<br>💡 切磋中你悟得 ${opp.name} 之长，${dimLabel} <b style="color:var(--cn-red)">+1</b>！`;
      }
      if (!m.statGrowth) m.statGrowth = {};
      if (!m.statGrowth[opp.id]) m.statGrowth[opp.id] = { ti: 0, wu: 0, tong: 0, zhi: 0, zheng: 0, mei: 0 };
      m.statGrowth[opp.id][dimKey] += 1;
      Campaign.save();
      return `<br>💡 ${opp.name} 从你身上悟得一二，${dimLabel} <b style="color:var(--cn-red)">+1</b>！`;
    },

    /* ---- 报名世界杯（16 / 32 强） ---- */
    joinCup(size) {
      const mChk = Campaign.mapState();
      if (mChk && Campaign.fameTierIndex(mChk.fame || 0) < this.CUP_FAME_TIER) { toast(`声望不足，需达到「${Campaign.FAME_TIERS[this.CUP_FAME_TIER].n}」名声阶梯才能报名天下第一武道会`); return; }
      if (!spendAP()) return;
      Tournament.size = size || 16;
      const hero = this.heroGeneral();
      const pool = DB.list.slice(); shuffle(pool);
      const parts = [hero, ...pool.slice(0, Tournament.size - 1)];
      shuffle(parts);
      Tournament.rpgMode = true;
      Tournament.begin(parts);
    },

    /* ---- 车轮大战 ---- */
    gauntlet() { if (!spendAP()) return; Gauntlet.start(this.heroGeneral(), true); },
    onGauntletResult(streak, allCleared, killer) {
      const gold = Bond.addGold(streak * 8);
      const drops = Armory.roll(Math.min(0.6, streak * 0.05), Math.min(0.9, streak * 0.08), Math.min(5, Math.ceil(streak / 3)) || 1);
      const exp = streak * 25 + (allCleared ? 200 : 0);
      let bountyHtml = "";
      const m = Campaign.mapState();
      if (m && m.activeBounty && m.activeBounty.kind === "gauntlet") {
        const ab = m.activeBounty;
        bountyHtml = "<br>" + (streak >= ab.need ? completeBountyReward(ab) : `📋 悬赏未达成：${ab.desc}（本次连胜 ${streak}，仍保留在城池悬赏榜）`);
        m.activeBounty = null; Campaign.save();
      }
      if (m && m.activeFacility === "gauntlet" && allCleared) { Campaign.addFame(10); bountyHtml += `<br>🏯 设施挑战全清，名声 <b style="color:var(--cn-red)">+10</b>`; }
      if (m && m.activeFacility === "gauntlet") { m.activeFacility = null; Campaign.save(); }
      this.grantExp(exp, "车轮大战 · 连胜 " + streak,
        `连斩 <b style="color:var(--cn-red)">${streak}</b> 员${allCleared ? '，横扫群雄！' : (killer ? '，终被 ' + killer.name + ' 所阻。' : '。')}${bountyHtml}`,
        () => this.gauntlet(), gold, Armory.dropLine(drops));
    },

    /* ---- 百人斩 · 爬塔 ---- */
    tower() { if (!spendAP()) return; Tower.start(this.heroGeneral(), true); },
    onTowerResult(cleared, killer, gains) {
      const gold = Bond.addGold(cleared * 8);
      Bond.addMany(Tower.slain, 4);   // 被斩守将：不打不相识
      const drops = Armory.roll(Math.min(0.65, cleared * 0.05), Math.min(0.9, cleared * 0.07), Math.min(6, Math.ceil(cleared / 2)) || 1);
      const exp = cleared * 20 + (cleared >= 10 ? 100 : 0);
      let uniqueHtml = "";
      const m = Campaign.mapState();
      if (m && cleared >= 15 && !m.uniqueOwned.chitu) {
        const item = Armory.makeUniqueTreasure("chitu");
        Armory.data.items.push(item); Armory.save();
        m.uniqueOwned.chitu = true; Campaign.recalcApMax(); Campaign.save();
        uniqueHtml = `<br>🐎 深塔藏珍：寻得唯一奇珍【${item.name}】！`;
      }
      if (m && m.activeBounty && m.activeBounty.kind === "tower") {
        const ab = m.activeBounty;
        uniqueHtml += "<br>" + (cleared >= ab.need ? completeBountyReward(ab) : `📋 悬赏未达成：${ab.desc}（本次登至第 ${cleared} 层，仍保留在城池悬赏榜）`);
        m.activeBounty = null; Campaign.save();
      }
      this.grantExp(exp, "百人斩 · 斩 " + cleared + " 将",
        `攀塔连斩 <b style="color:var(--cn-red)">${cleared}</b> 员守将${killer ? `，止步于 ${killer.name} 之手。` : '，全身而退。'}${gains && gains.length ? `<br>此行机缘：${gains.join('、')}` : ''}${uniqueHtml}`,
        () => this.tower(), gold, Armory.dropLine(drops));
    },

    /* ---- 2v2 主副将单挑：有队友则从团队挑副将，否则随机配 ---- */
    duo() { this.duoPicker(false); },
    // apSpent=true 时（如接取「双雄令」悬赏）行动力已在外层扣减，此处不再重复扣减
    duoPicker(apSpent) {
      const hero = this.heroGeneral();
      const pool = DB.list.slice();
      shuffle(pool);
      const m2 = clone(pool[0]), d2 = clone(pool[1]);
      const mates = Bond.teamGenerals();
      if (!mates.length) { if (!apSpent && !spendAP()) return; startDuoBattle(hero, clone(pool[2]), m2, d2, true); return; }
      openOverlay(`<div class="result-card">
        <h1>选择副将</h1>
        <div class="wdesc">从团队中挑一名副将与你并肩（其六维15%并入你，并可驰援一次）：</div>
        <div class="buff-list">
          ${mates.map(t => `<button class="buff-btn" data-id="${t.id}"><span class="bi">👥</span><span class="bt"><b>${t.name}</b><small>评分 ${ratingScore(t)} · 友谊 ${Bond.pts(t.id)}</small></span></button>`).join("")}
          <button class="buff-btn" data-id="rand"><span class="bi">🎲</span><span class="bt"><b>随机路人副将</b><small>不使用团队</small></span></button>
        </div>
        <div class="btns"><button class="btn-ghost" id="duo-cancel">取消</button></div></div>`);
      $$(".buff-btn[data-id]").forEach(b => b.onclick = () => {
        if (!apSpent && !spendAP()) return;
        closeOverlay();
        const dep = b.dataset.id === "rand" ? clone(pool[2]) : clone(DB.get(+b.dataset.id));
        startDuoBattle(hero, dep, m2, d2, true);
      });
      $("#duo-cancel").onclick = closeOverlay;
    },

    /* ---- 阵营大战：进入后先选规模/模式，点「开战」再出阵 ---- */
    war() { War.open(this.heroGeneral()); },
    onWarResult(kills, sideWon, cnWin, comrades) {
      const gold = sideWon ? Bond.addGold(40) : 0;
      Bond.addMany(comrades, 2);   // 并肩存活的同袍
      const drops = Armory.roll(Math.min(0.5, kills * 0.02 + (sideWon ? 0.25 : 0.05)), Math.min(0.85, kills * 0.03 + 0.1), Math.min(6, Math.ceil(kills / 4)) || 1);
      const exp = kills * 22 + (sideWon ? 120 : 0);
      const m = Campaign.mapState();
      let fameHtml = "";
      if (sideWon) {
        const facilityBonus = (m && m.activeFacility === "war") ? 15 : 0;
        Campaign.addFame(15 + facilityBonus);
        fameHtml = `<br>名声 <b style="color:var(--cn-red)">+${15 + facilityBonus}</b>`;
      }
      if (m && m.activeFacility === "war") { m.activeFacility = null; Campaign.save(); }
      this.grantExp(exp, "阵营大战 " + (sideWon ? "· 获胜" : "· 落败"),
        `你麾下斩敌 <b style="color:var(--cn-red)">${kills}</b> 员，本方阵营${sideWon ? '获胜！' : '惜败。'}${fameHtml}`,
        () => this.war(), gold, Armory.dropLine(drops));
    },

    /* ---- 组队大战：同阵营队友必上阵，余位随机补满 ---- */
    teamBattle() {
      if (!spendAP()) return;
      const hero = this.heroGeneral();
      const mates = Bond.teamGenerals().filter(g => g.side === hero.side).slice(0, 9).map(clone);
      const ids = new Set(mates.map(g => g.id));
      const pool = DB.bySide(hero.side).filter(g => !ids.has(g.id));
      shuffle(pool);
      const fill = pool.slice(0, Math.max(0, 9 - mates.length)).map(clone);
      TeamBattle.begin([hero, ...mates, ...fill], hero.side, { rpg: true });
    },
    onTeamBattleResult(kills, won) {
      const gold = won ? Bond.addGold(30 + kills * 3) : 0;
      const mates = TeamBattle.playerArr().map(u => u.g).filter(g => g.id !== -1);
      Bond.addMany(mates, won ? 6 : 3);   // 同队并肩 +3，获胜再 +3
      const drops = Armory.roll(Math.min(0.55, kills * 0.03 + (won ? 0.25 : 0.05)), Math.min(0.85, kills * 0.04 + 0.1), Math.min(6, Math.ceil(kills / 3)) || 1);
      const exp = kills * 20 + (won ? 150 : 0);
      const m = Campaign.mapState();
      let fameHtml = "";
      if (won) {
        const facilityBonus = (m && m.activeFacility === "teamBattle") ? 15 : 0;
        Campaign.addFame(15 + facilityBonus);
        fameHtml = `<br>名声 <b style="color:var(--cn-red)">+${15 + facilityBonus}</b>`;
      }
      if (m && m.activeFacility === "teamBattle") { m.activeFacility = null; Campaign.save(); }
      this.grantExp(exp, "组队大战 " + (won ? "· 获胜" : "· 落败"),
        `本场麾下击杀敌将 <b style="color:var(--cn-red)">${kills}</b> 员，全军${won ? '大捷！' : '溃败。'}${fameHtml}`,
        () => this.teamBattle(), gold, Armory.dropLine(drops));
    },

    /* ---- 国战 · 攻城略地：主角与同阵营队友编入己方军团 ---- */
    conquest() {
      if (!spendAP()) return;
      const hero = this.heroGeneral();
      const mates = Bond.teamGenerals().filter(g => g.side === hero.side);
      showScreen("conquest");
      Conquest.start(hero.side, { rpg: true, hero, mates });
    },
    onConquestResult(won, captures, kills) {
      const gold = Bond.addGold(captures * 40 + (won ? 200 : 0));
      // 战至终局仍在麾下的同袍
      const hero = this.heroGeneral();
      const allies = Conquest.cities.filter(c => c.side === hero.side)
        .flatMap(c => c.units).filter(g => g.id !== -1);
      Bond.addMany(allies, won ? 6 : 3);
      const drops = Armory.roll(Math.min(0.7, captures * 0.08 + (won ? 0.2 : 0)), Math.min(0.95, captures * 0.1 + 0.1), Math.min(8, captures) || 1);
      if (won) drops.push({ kind: "item", item: Armory.guaranteedItem("legend") });   // 一统天下必得传说宝物
      const exp = captures * 40 + kills * 15 + (won ? 250 : 0);
      const m = Campaign.mapState();
      let fameHtml = "";
      if (won) {
        const facilityBonus = (m && m.activeFacility === "conquest") ? 25 : 0;
        Campaign.addFame(50 + facilityBonus);
        fameHtml = `<br>名声 <b style="color:var(--cn-red)">+${50 + facilityBonus}</b>`;
      }
      if (m && m.activeFacility === "conquest") { m.activeFacility = null; Campaign.save(); }
      this.grantExp(exp, "国战 " + (won ? "· 一统天下" : "· 大势已去"),
        `攻克 <b style="color:var(--cn-red)">${captures}</b> 城，斩敌将 <b style="color:var(--cn-red)">${kills}</b> 员，${won ? '天下归一！' : '霸业未成。'}${fameHtml}`,
        () => this.conquest(), gold, Armory.dropLine(drops));
    },

    // 统一发放经验/升级并弹窗（goldGain：本次一并入账的金币；dropsHtml：宝物/材料掉落，与经验同屏展示）
    grantExp(gain, title, descHtml, againFn, goldGain = 0, dropsHtml = "") {
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
          <div class="wdesc">${descHtml}<br>获得经验 <b style="color:var(--cn-red)">+${gain}</b>${Bond.goldLine(goldGain)}${dropsHtml}
            ${lvUp ? `<br>🎉 升级 ${lvUp} 级！获得加点 <b style="color:var(--cn-red)">+${lvUp * 1}</b>` : ''}</div>
          <div class="btns">
            <button class="btn-primary" id="rpg-r-again">再来一次</button>
            <button class="btn-ghost" id="rpg-r-hub">返回养成</button>
          </div></div>`);
        $("#rpg-r-again").onclick = () => { closeOverlay(); againFn(); };
        $("#rpg-r-hub").onclick = () => { closeOverlay(); goHome(); };
      }, 600);
    },
    onCupResult(placement, cupWinExp) {
      const c = this.char;
      const mFac = Campaign.mapState();
      if (mFac && mFac.activeFacility === "cup") { mFac.activeFacility = null; Campaign.save(); }
      if (!placement) { goHome(); return; }
      // 名次奖金 + 同组交手友谊
      let cupGold = 0;
      if (placement.label === "夺冠") cupGold = Bond.addGold(100);
      else if (/半决赛|决赛/.test(placement.label)) cupGold = Bond.addGold(50);
      const myGroup = Tournament.groups.find(g => g.teams.some(t => t.id === -1));
      if (myGroup) Bond.addMany(myGroup.teams.filter(t => t.id !== -1), 3);
      const drops = [];
      if (placement.label === "夺冠") drops.push({ kind: "item", item: Armory.guaranteedItem("legend") });
      else if (/四强|半决赛|决赛/.test(placement.label)) drops.push({ kind: "item", item: Armory.guaranteedItem("rare") });
      else drops.push(...Armory.roll(0.3, 0.4, 1));
      const winGain = Math.round(cupWinExp || 0);   // 各场单挑获胜累计经验
      const bonus = placement.exp;                   // 按最终轮次的晋级奖励
      const gain = winGain + bonus;
      c.exp += gain;
      let lvUp = 0;
      while (c.exp >= this.expNeed(c.level)) { c.exp -= this.expNeed(c.level); c.level++; c.points += 1; lvUp++; }
      this.save();
      // 名声：按名次浮动；首次夺冠额外永久 +1 行动力上限（武道会终极奖励），并计入"天下无双"终局条件
      const isChamp = placement.label === "夺冠";
      const fameGain = isChamp ? 60 : /半决赛|决赛|四强/.test(placement.label) ? 30 : 12;
      Campaign.addFame(fameGain);
      let champHtml = "";
      const m = Campaign.mapState();
      if (isChamp && m && !m.cupWon) {
        m.cupWon = true; Campaign.recalcApMax(); Campaign.save();
        champHtml = `<br>🏆 天下第一武道会首冠！行动力上限永久 <b style="color:var(--cn-red)">+1</b>`;
        champHtml += checkEnding();
      }
      const bg = c.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
      setTimeout(() => {
        openOverlay(`<div class="result-card">
          <h1>世界杯 · ${placement.label}</h1>
          <div class="winner-av" style="background:${bg}">${avatarChar(c.name)}</div>
          <div class="wname">${c.name}</div>
          <div class="wdesc">本届世界杯成绩：<b>${placement.label}</b><br>
            单挑获胜经验 <b style="color:var(--cn-red)">+${winGain}</b> · 晋级奖励 <b style="color:var(--cn-red)">+${bonus}</b><br>
            合计获得经验 <b style="color:var(--cn-red)">+${gain}</b>${Bond.goldLine(cupGold)}${Armory.dropLine(drops)}
            ${lvUp ? `<br>🎉 升级 ${lvUp} 级！获得加点 <b style="color:var(--cn-red)">+${lvUp * 1}</b>` : ''}
            <br>名声 <b style="color:var(--cn-red)">+${fameGain}</b>${champHtml}</div>
          <div class="btns">
            <button class="btn-primary" id="rpg-cup-again">再战世界杯</button>
            <button class="btn-ghost" id="rpg-cup-hub">返回养成</button>
          </div></div>`);
        $("#rpg-cup-again").onclick = () => { closeOverlay(); this.joinCup(Tournament.size); };
        $("#rpg-cup-hub").onclick = () => { closeOverlay(); goHome(); };
      }, 1200);
    },
  };

  /* ============================================================
   *  天下地图：40 城（中原二十城 + 战国二十城）+ 对马岛海路中转
   *  坐标为风格化的相对位置（%），道路为邻接关系，非精确测绘；
   *  hefei/higo/bungo/bizen/omi 五城坐标经过微调，避免与其无直接道路的另一条 ROADS
   *  边几乎共线重叠——原坐标下这类"城池恰好落在别处两城连线正中间"会让玩家误以为
   *  该城与那条线的两端都直接相连（实际上邻接关系仅由 ROADS 决定，与视觉上是否共线无关）
   * ============================================================ */
  const CITIES = [
    { id: "chengdu", n: "成都", side: "cn", x: 10, y: 55 },
    { id: "hanzhong", n: "汉中", side: "cn", x: 16, y: 45 },
    { id: "chang_an", n: "长安", side: "cn", x: 20, y: 35 },
    { id: "luoyang", n: "洛阳", side: "cn", x: 26, y: 38 },
    { id: "xuchang", n: "许昌", side: "cn", x: 30, y: 42 },
    { id: "ye", n: "邺城", side: "cn", x: 28, y: 28 },
    { id: "xuzhou", n: "徐州", side: "cn", x: 38, y: 40 },
    { id: "jingzhou", n: "荆州", side: "cn", x: 24, y: 58 },
    { id: "chaisang", n: "柴桑", side: "cn", x: 32, y: 60 },
    { id: "jianye", n: "建业", side: "cn", x: 40, y: 55 },
    { id: "tianshui", n: "天水", side: "cn", x: 10, y: 34 },
    { id: "baidicheng", n: "白帝城", side: "cn", x: 14, y: 60 },
    { id: "shangyong", n: "上庸", side: "cn", x: 20, y: 50 },
    { id: "jiangling", n: "江陵", side: "cn", x: 18, y: 62 },
    { id: "wancheng", n: "宛城", side: "cn", x: 26, y: 48 },
    { id: "runan", n: "汝南", side: "cn", x: 32, y: 46 },
    { id: "xiapi", n: "下邳", side: "cn", x: 40, y: 36 },
    { id: "shouchun", n: "寿春", side: "cn", x: 36, y: 46 },
    { id: "hefei", n: "合肥", side: "cn", x: 35, y: 50 },
    { id: "wuchang", n: "武昌", side: "cn", x: 34, y: 58 },
    { id: "tsushima", n: "对马岛", side: "sea", x: 50, y: 66 },
    { id: "satsuma", n: "萨摩", side: "jp", x: 60, y: 82 },
    { id: "aki", n: "安艺", side: "jp", x: 66, y: 66 },
    { id: "kyoto", n: "京都", side: "jp", x: 72, y: 58 },
    { id: "osaka", n: "大坂", side: "jp", x: 74, y: 62 },
    { id: "owari", n: "尾张", side: "jp", x: 78, y: 52 },
    { id: "kai", n: "甲斐", side: "jp", x: 80, y: 44 },
    { id: "sunpu", n: "骏府", side: "jp", x: 82, y: 50 },
    { id: "odawara", n: "小田原", side: "jp", x: 86, y: 42 },
    { id: "echigo", n: "越后", side: "jp", x: 76, y: 32 },
    { id: "oushu", n: "奥州", side: "jp", x: 82, y: 20 },
    { id: "higo", n: "肥后", side: "jp", x: 52, y: 78 },
    { id: "bungo", n: "丰后", side: "jp", x: 59, y: 72 },
    { id: "izumo", n: "出云", side: "jp", x: 62, y: 64 },
    { id: "bizen", n: "备前", side: "jp", x: 72, y: 68 },
    { id: "omi", n: "近江", side: "jp", x: 79, y: 59 },
    { id: "echizen", n: "越前", side: "jp", x: 70, y: 48 },
    { id: "kaga", n: "加贺", side: "jp", x: 72, y: 40 },
    { id: "mino", n: "美浓", side: "jp", x: 76, y: 48 },
    { id: "mikawa", n: "三河", side: "jp", x: 82, y: 54 },
    { id: "hitachi", n: "常陆", side: "jp", x: 90, y: 34 },
  ];
  const ROADS = [
    ["chengdu", "hanzhong"], ["hanzhong", "chang_an"], ["chang_an", "luoyang"], ["luoyang", "xuchang"],
    ["luoyang", "ye"], ["xuchang", "xuzhou"], ["xuchang", "jingzhou"], ["jingzhou", "chaisang"],
    ["chaisang", "jianye"], ["jianye", "xuzhou"], ["chengdu", "jingzhou"],
    ["tianshui", "hanzhong"], ["tianshui", "chang_an"],
    ["baidicheng", "chengdu"], ["baidicheng", "jiangling"], ["jiangling", "jingzhou"],
    ["shangyong", "hanzhong"], ["shangyong", "jingzhou"],
    ["wancheng", "luoyang"], ["wancheng", "xuchang"], ["wancheng", "jingzhou"],
    ["runan", "xuchang"], ["xiapi", "xuzhou"],
    ["shouchun", "xuzhou"], ["shouchun", "hefei"], ["hefei", "jianye"],
    ["wuchang", "chaisang"], ["wuchang", "jianye"],
    ["satsuma", "aki"], ["aki", "kyoto"], ["kyoto", "osaka"], ["kyoto", "owari"], ["osaka", "owari"],
    ["owari", "kai"], ["owari", "sunpu"], ["kai", "sunpu"], ["sunpu", "odawara"], ["kai", "echigo"],
    ["echigo", "oushu"], ["odawara", "oushu"],
    ["higo", "satsuma"], ["bungo", "satsuma"], ["bungo", "izumo"], ["izumo", "aki"],
    ["bizen", "aki"], ["bizen", "osaka"],
    ["omi", "kyoto"], ["omi", "owari"], ["echizen", "kyoto"], ["echizen", "kaga"], ["kaga", "echigo"],
    ["mino", "owari"], ["mino", "omi"], ["mikawa", "owari"], ["mikawa", "sunpu"],
    ["hitachi", "odawara"], ["hitachi", "oushu"],
    ["jianye", "tsushima"], ["xuzhou", "tsushima"], ["tsushima", "satsuma"],
  ];
  function cityDef(id) { return CITIES.find(c => c.id === id); }
  function cityName(id) { const c = cityDef(id); return c ? c.n : "？"; }
  // 游历天数 → 游戏历（每年12月，每月30天，第1天为0年一月一日，年份从0起、月与日从1起），仅用于展示；月末判定（isMonthEnd）供边境战等月度事件复用
  function calYMD(day) {
    const idx = Math.max(0, day - 1);
    return { year: Math.floor(idx / 360), month: Math.floor((idx % 360) / 30) + 1, dom: (idx % 30) + 1 };
  }
  function calLabel(day) { const d = calYMD(day); return `${d.year}年${d.month}月${d.dom}日`; }
  function isMonthEnd(day) { return day % 30 === 0; }
  // 武将大会：每季度第二月（2/5/8/11 月）第 1 天举行
  function isTournamentDay(day) { const d = calYMD(day); return [2, 5, 8, 11].includes(d.month) && d.dom === 1; }
  // 城池归属（可随边境阵营大战易主，独立于武将分布用的静态 c.side）：对马岛海路中转站初始划归战国一方，
  // 其余城池按其固有阵营起始归属
  function initCityOwner() {
    const o = {};
    CITIES.forEach(c => { o[c.id] = c.side === "sea" ? "jp" : c.side; });
    return o;
  }
  function cityOwnerSide(m, cityId) { return (m.cityOwner && m.cityOwner[cityId]) || cityDef(cityId).side; }
  // 边境：owner 不同的两座相邻城池之间的道路，天然只会出现在对马岛与其相邻城池之间（唯一连通两大阵营的路），
  // 一旦某城易主，其原本同阵营的相邻城池也会随之成为新边境，前线因而逐月推移
  function borderEdges(m) {
    return ROADS.filter(([a, b]) => cityOwnerSide(m, a) !== cityOwnerSide(m, b));
  }
  function adjCities(id) {
    return ROADS.filter(r => r[0] === id || r[1] === id).map(r => r[0] === id ? r[1] : r[0]);
  }
  // 特色设施：每城一个，穿插既有玩法，扮演角色亲自上阵；除 duel 外均直接调用对应 RPG.xxx() 入口（已含行动力扣减）
  const CITY_FACILITY = {
    luoyang: { n: "天下擂台", icon: "🏯", mode: "duel" },
    hanzhong: { n: "论剑台", icon: "🗡️", mode: "duel" },
    jianye: { n: "建业演武场", icon: "⚔️", mode: "duel" },
    chengdu: { n: "车轮战武场", icon: "🔥", mode: "gauntlet" },
    chang_an: { n: "长安校场", icon: "🔥", mode: "gauntlet" },
    satsuma: { n: "示现流道场", icon: "🔥", mode: "gauntlet" },
    kyoto: { n: "百人斩道场", icon: "🗼", mode: "tower" },
    xuchang: { n: "许都点将台", icon: "🗼", mode: "tower" },
    aki: { n: "毛利水军演武", icon: "🗼", mode: "tower" },
    osaka: { n: "双人比武场", icon: "🤝", mode: "duo" },
    ye: { n: "邺城双雄会", icon: "🤝", mode: "duo" },
    owari: { n: "桶狭间演武", icon: "🤝", mode: "duo" },
    odawara: { n: "军团攻城演", icon: "🛡", mode: "teamBattle" },
    xuzhou: { n: "联军演武营", icon: "🛡", mode: "teamBattle" },
    kai: { n: "风林火山阵", icon: "🛡", mode: "teamBattle" },
    oushu: { n: "远征校场", icon: "🗺", mode: "conquest" },
    jingzhou: { n: "荆襄争锋", icon: "🗺", mode: "conquest" },
    sunpu: { n: "东海道远征", icon: "🗺", mode: "conquest" },
    chaisang: { n: "江东水军演武", icon: "🏆", mode: "cup" },
    echigo: { n: "越后军神殿", icon: "🏆", mode: "cup" },
    tianshui: { n: "天水论箭台", icon: "🏯", mode: "duel" },
    baidicheng: { n: "白帝连营", icon: "🔥", mode: "gauntlet" },
    shangyong: { n: "上庸孟达垒", icon: "🗼", mode: "tower" },
    jiangling: { n: "江陵水寨", icon: "🤝", mode: "duo" },
    wancheng: { n: "宛城伏兵阵", icon: "🛡", mode: "teamBattle" },
    runan: { n: "汝南屯田营", icon: "🗺", mode: "conquest" },
    xiapi: { n: "下邳辕门赛", icon: "🏆", mode: "cup" },
    shouchun: { n: "寿春校武场", icon: "🏯", mode: "duel" },
    hefei: { n: "合肥连胜阵", icon: "🔥", mode: "gauntlet" },
    wuchang: { n: "武昌钓台", icon: "🗼", mode: "tower" },
    higo: { n: "肥后武馆", icon: "🤝", mode: "duo" },
    bungo: { n: "丰后铳阵", icon: "🛡", mode: "teamBattle" },
    izumo: { n: "出云远征队", icon: "🗺", mode: "conquest" },
    bizen: { n: "备前刀会", icon: "🏆", mode: "cup" },
    omi: { n: "近江论战场", icon: "🏯", mode: "duel" },
    echizen: { n: "越前一乘谷", icon: "🔥", mode: "gauntlet" },
    kaga: { n: "加贺一向塔", icon: "🗼", mode: "tower" },
    mino: { n: "美浓斋藤馆", icon: "🤝", mode: "duo" },
    mikawa: { n: "三河武士团", icon: "🛡", mode: "teamBattle" },
    hitachi: { n: "常陆远征所", icon: "🗺", mode: "conquest" },
  };
  // 集市折扣：对马岛黑市常驻八折；行脚商队奇遇触发后临时持续至 discountUntilDay
  function shopDiscountActive() {
    const m = typeof Campaign !== "undefined" && Campaign.mapState();
    if (!m) return false;
    return m.curCity === "tsushima" || (m.discountUntilDay && m.day <= m.discountUntilDay);
  }
  // 各城行情系数：对马岛黑市固定八折，其余按城名哈希稳定落在 0.90~1.20——低价城可"淘货"，高价城慎买
  function cityPriceFactor(cityId) {
    if (cityId === "tsushima") return 0.8;
    return 0.9 + (hashStr(cityId) % 31) / 100;
  }
  // 简易可复现随机序列：城市集市货摊按 (城市, 游戏天数, 本局种子) 生成，宿营跨天即换新货
  function seededRand(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function cityMarketStalls(m) {
    const rnd = seededRand(hashStr(m.curCity + "|" + m.day + "|" + ((Campaign.meta && Campaign.meta.createdAt) || 0)));
    // 名声达「略有耳闻」（第 1 阶）起，声名远播招来更多行商，货摊数 4→5
    const n = Campaign.fameTierIndex(m.fame || 0) >= 1 ? 5 : 4;
    return Array.from({ length: n }, () => {
      const type = Armory.TYPES[Math.floor(rnd() * Armory.TYPES.length)];
      const total = Armory.RARITIES.reduce((s, r) => s + r.weight, 0);
      let x = rnd() * total, rar = "normal";
      for (const r of Armory.RARITIES) { if (x < r.weight) { rar = r.k; break; } x -= r.weight; }
      const pool = Armory.pool(type.k);
      return { type: type.k, rarity: rar, tmpl: pool[Math.floor(rnd() * pool.length)] };
    });
  }
  // 史实分布：按势力/家臣归属给主要武将预设城池归属，其余（多为次要武将）按姓名哈希兜底分配，
  // 保证仍落在同阵营的城池范围内；仅为风味设计，非严谨考据。
  const CITY_HINTS_RAW = {
    chengdu: ["刘备", "诸葛亮", "赵云", "庞统", "法正", "关平", "关兴", "张苞", "简雍", "孙乾", "糜竺", "糜芳", "黄权", "李严", "蒋琬", "费祎", "董允", "邓芝", "刘璋", "张任", "严颜", "邢道荣", "孟获", "祝融", "兀突骨", "沙摩柯", "诸葛瞻", "宗预", "杨仪", "罗宪"],
    hanzhong: ["张飞", "马超", "黄忠", "魏延", "姜维", "王平", "廖化", "马岱", "张翼", "张嶷", "马忠", "吴懿", "孟达", "郝昭", "张鲁", "文鸯", "陈到", "傅佥", "霍峻", "霍弋"],
    chang_an: ["夏侯渊", "夏侯霸", "马腾", "韩遂", "阎行", "张郃", "郭淮", "陈泰", "王双", "徐荣", "董卓", "李傕", "郭汜", "皇甫嵩", "朱儁", "卢植", "貂蝉", "李儒", "张济"],
    luoyang: ["曹丕", "司马懿", "司马师", "司马昭", "钟繇", "陈群", "华歆", "王朗", "董昭", "蒋济", "曹爽", "王基", "王昶", "王凌", "邓艾", "钟会", "毌丘俭", "诸葛诞", "王濬", "羊祜", "杜预", "何进", "王允"],
    xuchang: ["曹操", "郭嘉", "荀彧", "荀攸", "程昱", "刘晔", "满宠", "典韦", "许褚", "于禁", "乐进", "李典", "曹仁", "曹洪", "曹纯", "徐晃", "张绣"],
    ye: ["张辽", "袁绍", "审配", "田丰", "沮授", "许攸", "郭图", "高览", "麴义", "淳于琼", "颜良", "文丑", "公孙瓒", "张角"],
    xuzhou: ["吕布", "高顺", "魏续", "侯成", "陈登", "陶谦", "孔融", "袁术", "臧霸", "李通", "文聘", "朱灵", "夏侯惇", "曹彰"],
    jingzhou: ["关羽", "刘表", "蔡瑁", "黄祖", "鲍信"],
    chaisang: ["孙策", "孙坚", "周瑜", "鲁肃", "程普", "韩当", "黄盖", "太史慈", "凌统", "凌操", "董袭", "蒋钦", "徐盛", "丁奉", "甘宁", "周泰", "贺齐"],
    jianye: ["孙权", "陆逊", "吕蒙", "张昭", "张纮", "顾雍", "诸葛恪", "孙桓", "孙尚香", "全琮", "朱然", "朱桓", "步骘", "吕岱", "潘濬", "陆凯", "虞翻", "阚泽"],
    owari: ["织田信长", "织田信忠", "柴田胜家", "丹羽长秀", "森兰丸", "森长可", "森可成", "佐佐成政", "池田恒兴", "佐久间信盛", "佐久间盛政", "泷川一益", "前田利家", "可儿才藏"],
    kyoto: ["明智光秀", "明智秀满", "斋藤利三", "细川藤孝", "细川忠兴", "筒井顺庆", "足利义辉", "足利义昭", "北畠具教", "六角义贤", "三好长庆", "十河一存", "三好实休", "松永久秀", "荒木村重", "安国寺惠琼", "宫本武藏", "佐佐木小次郎", "冢原卜传", "上泉信纲", "柳生石舟斋", "宝藏院胤荣", "朝仓义景", "朝仓宗滴", "斋藤义龙", "斋藤龙兴", "斋藤道三"],
    osaka: ["丰臣秀吉", "丰臣秀长", "石田三成", "加藤清正", "福岛正则", "黑田官兵卫", "竹中半兵卫", "竹中重门", "片桐且元", "胁坂安治", "蒲生氏乡", "藤堂高虎", "大谷吉继", "小早川秀秋", "增田长盛", "小西行长", "浅野长政", "石川数正", "本多正信", "山内一丰", "仙石秀久", "堀秀政", "蜂须贺正胜", "前田庆次", "雑賀孫市", "鈴木重秀", "下间赖廉"],
    kai: ["武田信玄", "武田胜赖", "山本勘助", "山县昌景", "马场信春", "高坂昌信", "内藤昌丰", "真田幸村", "真田昌幸", "真田信之", "真田信纲", "真田幸隆", "真田昌辉", "秋山虎繁", "原虎胤", "板垣信方", "甘利虎泰", "饭富虎昌", "小山田信茂", "穴山梅雪"],
    sunpu: ["德川家康", "本多忠胜", "榊原康政", "酒井忠次", "井伊直政", "井伊直虎", "鸟居元忠", "大久保忠世", "服部半藏", "结城秀康", "今川义元", "今川氏真", "太原雪斋", "水野胜成", "松平清康", "堀尾吉晴"],
    odawara: ["北条氏康", "北条氏政", "北条氏直", "北条早云", "北条纲成", "北条氏照", "北条氏邦", "太田道灌", "大道寺政繁", "风魔小太郎"],
    echigo: ["上杉谦信", "上杉景胜", "直江兼续", "甘粕景持", "斎藤朝信", "柿崎景家", "宇佐美定满", "本庄繁长", "村上义清", "长尾政景"],
    oushu: ["伊达政宗", "伊达成实", "片仓小十郎", "鬼庭左月斋", "最上义光", "芦名盛氏", "佐竹义重", "佐竹义宣", "南部晴政", "津轻为信", "安东爱季", "户泽盛安", "里见义尧", "太田资正", "成田长亲", "奥平信昌", "鸟居强右卫门"],
    aki: ["毛利元就", "毛利辉元", "毛利胜永", "吉川元春", "吉川广家", "小早川隆景", "宇喜多直家", "宇喜多秀家", "陶晴贤", "大内义隆", "尼子经久", "山中鹿介", "清水宗治", "安宅冬康"],
    satsuma: ["岛津义弘", "岛津家久", "岛津义久", "岛津岁久", "岛津丰久", "立花宗茂", "立花道雪", "立花誾千代", "高桥绍运", "大友宗麟", "龙造寺隆信", "锅岛直茂", "秋月种实", "有马晴信", "大村纯忠", "相良义阳", "甲斐宗运", "岛左近"],
  };
  const CITY_HINTS = {};
  Object.entries(CITY_HINTS_RAW).forEach(([cid, names]) => names.forEach(n => { CITY_HINTS[n] = cid; }));
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  // distribution: "historical" 优先用 CITY_HINTS，未命中按姓名哈希稳定兜底；"random" 每局按姓名+本局随机种子重新洗牌
  function buildCityAssignment(distribution, seed) {
    const cnCities = CITIES.filter(c => c.side === "cn").map(c => c.id);
    const jpCities = CITIES.filter(c => c.side === "jp").map(c => c.id);
    const assign = {};
    DB.list.forEach(g => {
      const pool = g.side === "cn" ? cnCities : jpCities;
      let cid;
      if (distribution === "random") {
        cid = pool[hashStr(g.name + "|" + seed) % pool.length];
      } else {
        cid = CITY_HINTS[g.name];
        if (!cid || !pool.includes(cid)) cid = pool[hashStr(g.name) % pool.length];
      }
      assign[g.id] = cid;
    });
    return assign;
  }

  /* ============================================================
   *  悬赏榜：每城 2~3 条任务，五种玩法穿插——「讨伐令」（经典单挑，按同城已现身武将优先出题）、
   *  「车轮令」（车轮大战连胜）、「登塔令」（百人斩攀至指定层数）、「双雄令」（2v2 主副将取胜）、
   *  「刺杀令」（仅当该城已现身的本地武将中有敌方阵营成员时才可能出现，成功后名声大幅增加）；
   *  约 15% 概率生成「高级悬赏」（奖励更丰厚，且有机会带出唯一奇珍）
   * ============================================================ */
  function genBounty(cityId, assign, appeared, heroSide) {
    const legendary = Math.random() < 0.15;
    const localIds = Object.keys(assign).filter(gid => assign[gid] === cityId).map(Number);
    const appearedLocal = localIds.filter(id => appeared.includes(id));
    const enemyLocal = heroSide ? appearedLocal.filter(id => { const g = DB.get(id); return g && g.side !== heroSide; }) : [];
    const roll = Math.random();
    let kind;
    if (enemyLocal.length && roll < 0.15) kind = "assassin";
    else {
      // 车轮令（gauntlet）反馈过于密集，权重由 40/20/20/20 调整为 35/15/25/25，压低车轮令占比，向登塔令/双雄令匀出空间
      const r2 = enemyLocal.length ? (roll - 0.15) / 0.85 : roll;
      kind = r2 < 0.35 ? "duel" : r2 < 0.5 ? "gauntlet" : r2 < 0.75 ? "tower" : "duo";
    }
    const uid = cityId + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    if (kind === "assassin") {
      const targetId = enemyLocal[randInt(0, enemyLocal.length - 1)];
      const target = DB.get(targetId) || DB.list[0];
      return {
        uid, kind: "assassin", targetId: target.id, legendary,
        desc: `刺杀令：潜入敌境刺杀【${target.name}】`,
        rewardGold: 80 + Math.round(ratingScore(target) * (legendary ? 0.6 : 0.3)),
        rewardFame: legendary ? 90 : 45,
      };
    }
    if (kind === "duel") {
      const localIds = Object.keys(assign).filter(gid => assign[gid] === cityId).map(Number);
      const appearedLocal = localIds.filter(id => appeared.includes(id));
      const pool = (appearedLocal.length && Math.random() < 0.6) ? appearedLocal : DB.list.map(g => g.id);
      const targetId = pool[randInt(0, pool.length - 1)];
      const target = DB.get(targetId) || DB.list[0];
      return {
        uid, kind: "duel", targetId: target.id, legendary,
        desc: `讨伐令：击败【${target.name}】`,
        rewardGold: 60 + Math.round(ratingScore(target) * (legendary ? 0.6 : 0.3)),
        rewardFame: legendary ? 35 : 12,
      };
    }
    if (kind === "gauntlet") {
      const need = legendary ? 10 : [3, 5, 8][randInt(0, 2)];
      return {
        uid, kind: "gauntlet", need, legendary,
        desc: `车轮令：车轮大战连胜 ${need} 场`,
        rewardGold: 50 + need * 12,
        rewardFame: legendary ? 35 : 8 + need,
      };
    }
    if (kind === "tower") {
      const need = legendary ? 20 : [5, 8, 12][randInt(0, 2)];
      return {
        uid, kind: "tower", need, legendary,
        desc: `登塔令：百人斩攀至第 ${need} 层`,
        rewardGold: 55 + need * 10,
        rewardFame: legendary ? 35 : 6 + need,
      };
    }
    return {
      uid, kind: "duo", legendary,
      desc: `双雄令：携副将取胜一场 2v2`,
      rewardGold: legendary ? 140 : 70,
      rewardFame: legendary ? 35 : 15,
    };
  }
  // 完成悬赏：发金+名声，高级悬赏首次达成额外掉「千里靴」唯一奇珍；完成的槽位立即刷新一条新悬赏
  function completeBountyReward(ab) {
    const goldGain = Bond.addGold(ab.rewardGold);
    Campaign.addFame(ab.rewardFame);
    const m = Campaign.mapState();
    let uniqueHtml = "";
    if (ab.legendary && m && !m.uniqueOwned.senriGeta) {
      const item = Armory.makeUniqueTreasure("senriGeta");
      Armory.data.items.push(item); Armory.save();
      m.uniqueOwned.senriGeta = true; Campaign.recalcApMax();
      uniqueHtml = `、获得唯一奇珍【${item.name}】！`;
    }
    if (m && m.bounties[ab.cityId]) {
      const list = m.bounties[ab.cityId];
      const idx = list.findIndex(b => b.uid === ab.uid);
      if (idx >= 0) list[idx] = genBounty(ab.cityId, m.assign, m.appeared, RPG.char && RPG.char.side);
    }
    Campaign.save();
    return `📋 悬赏完成：${ab.desc}！名声 <b style="color:var(--cn-red)">+${ab.rewardFame}</b>${uniqueHtml}${Bond.goldLine(goldGain)}`;
  }

  /* ============================================================
   *  威名榜八大高手 与「天下无双」终局：全部击败 + 至少一次武道会夺冠
   * ============================================================ */
  const RIVAL_NAMES = ["吕布", "关羽", "张飞", "赵云", "织田信长", "武田信玄", "上杉谦信", "本多忠胜"];
  function checkRivalDefeat(opp) {
    const m = Campaign.mapState();
    if (!m || !RIVAL_NAMES.includes(opp.name) || m.rivalsDefeated.includes(opp.id)) return "";
    m.rivalsDefeated.push(opp.id);
    Campaign.addFame(25);
    Campaign.save();
    let html = `<br>⚔️ 威名榜：击败【${opp.name}】！（${m.rivalsDefeated.length}/${RIVAL_NAMES.length}）名声 <b style="color:var(--cn-red)">+25</b>`;
    html += checkEnding();
    return html;
  }
  function checkEnding() {
    const m = Campaign.mapState();
    if (!m || m.ending) return "";
    if (m.rivalsDefeated.length >= RIVAL_NAMES.length && m.cupWon) {
      m.ending = true; Campaign.save();
      setTimeout(() => showEndingOverlay(), 1500);
      return `<br>🏆 威名与武道会双双圆满……`;
    }
    return "";
  }
  function showEndingOverlay() {
    const c = RPG.char; if (!c) return;
    const bg = c.side === 'cn' ? 'linear-gradient(135deg,#f4c430,#b8860b)' : 'linear-gradient(135deg,#f4c430,#8a6d3b)';
    openOverlay(`<div class="result-card">
      <h1>🏆 天下无双</h1>
      <div class="winner-av" style="background:${bg}">${avatarChar(c.name)}</div>
      <div class="wname">${c.name}</div>
      <div class="wdesc">威名榜八大高手尽数折服，武道会亦已称雄——${c.name} 技压天下群雄，获封「<b style="color:var(--cn-gold)">天下无双</b>」！<br>你的传奇仍将继续，天下之大，尽可去得。</div>
      <div class="btns"><button class="btn-primary" id="ending-continue">继续游历</button></div>
    </div>`);
    $("#ending-continue").onclick = () => { closeOverlay(); goHome(); };
  }

  /* ============================================================
   *  存档架构：全局层（武将图鉴自定义数据、宝物模板编辑）永不重置；
   *  战役层（角色/金币/友谊/队伍/宝物背包）随"新游戏"清空重来
   * ============================================================ */
  const CAMPAIGN_KEY = "wujiang_campaign_v1";
  const Campaign = {
    meta: null,
    load() { try { this.meta = JSON.parse(localStorage.getItem(CAMPAIGN_KEY)); } catch { this.meta = null; } },
    save() { localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(this.meta)); },
    // 开启一局新战役：清空角色/金币/友谊/队伍/宝物背包；武将图鉴与宝物模板编辑（全局层）不受影响
    reset(mode) {
      localStorage.removeItem(RPG_KEY); RPG.char = null;
      Bond.data = { gold: 0, friends: {}, team: [], giftDay: {}, visitDay: {}, gifted: {}, sparDay: {}, assassinDay: {} }; Bond.save();
      Armory.data = { items: [], materials: { weapon: 0, mount: 0, book: 0, attire: 0, curio: 0 }, discovered: [], pity: { weapon: 0, mount: 0, book: 0, attire: 0, curio: 0 }, shop: [], shopDay: "", nextUid: 1 };
      Armory.save(); Armory.ensureShop();
      const distribution = (mode && mode.distribution) || "historical";
      const assign = buildCityAssignment(distribution, Date.now());
      // 按城池归组，开局每城先现身 2~3 名武将，其余「未登场」，随游历推进逐批揭示
      const byCity = {};
      Object.entries(assign).forEach(([gid, cid]) => { (byCity[cid] || (byCity[cid] = [])).push(+gid); });
      const appeared = [];
      Object.values(byCity).forEach(ids => { shuffle(ids); appeared.push(...ids.slice(0, randInt(2, 3))); });
      const heroSide = mode && mode.side;
      // 每城预生成 2~3 条悬赏，作为游历动力之一
      const bounties = {};
      CITIES.filter(c => c.side !== "sea").forEach(c => { bounties[c.id] = Array.from({ length: randInt(2, 3) }, () => genBounty(c.id, assign, appeared, heroSide)); });
      this.meta = {
        active: true, createdAt: Date.now(), mode: mode || {},
        map: {
          day: 1, ap: 1, apMax: 1, curCity: null, assign, appeared, nextAppearDay: 6,
          fame: 0, bounties, activeBounty: null,
          uniqueOwned: { chitu: false, senriGeta: false }, rivalsDefeated: [], cupWon: false, ending: false,
          cityOwner: initCityOwner(), statPenalty: {}, statGrowth: {}, activeAssassin: null,
        },
      };
      this.save();
    },
    mapState() { return this.meta && this.meta.map; },
    // 兼容旧版本存档（第一/二期或更早创建的角色）：不清空任何既有数据，仅补建缺失的地图状态与新增字段，
    // 使"继续游戏"总能正常进入天下地图
    ensureMap() {
      if (!RPG.char) return null;
      let changed = false;
      if (!this.meta) { this.meta = { active: true, createdAt: Date.now(), mode: {} }; changed = true; }
      if (!this.meta.map) {
        const distribution = (this.meta.mode && this.meta.mode.distribution) || "historical";
        const assign = buildCityAssignment(distribution, this.meta.createdAt || Date.now());
        const byCity = {};
        Object.entries(assign).forEach(([gid, cid]) => { (byCity[cid] || (byCity[cid] = [])).push(+gid); });
        const appeared = [];
        Object.values(byCity).forEach(ids => { shuffle(ids); appeared.push(...ids.slice(0, randInt(2, 3))); });
        this.meta.map = { day: 1, ap: 1, apMax: 1, curCity: null, assign, appeared, nextAppearDay: 6 };
        changed = true;
      }
      const m = this.meta.map;
      if (m.fame == null) { m.fame = 0; changed = true; }
      if (!m.bounties) {
        m.bounties = {};
        CITIES.filter(c => c.side !== "sea").forEach(c => { m.bounties[c.id] = Array.from({ length: randInt(2, 3) }, () => genBounty(c.id, m.assign, m.appeared, RPG.char && RPG.char.side)); });
        changed = true;
      }
      if (m.activeBounty === undefined) { m.activeBounty = null; changed = true; }
      if (!m.uniqueOwned) { m.uniqueOwned = { chitu: false, senriGeta: false }; changed = true; }
      if (!m.rivalsDefeated) { m.rivalsDefeated = []; changed = true; }
      if (m.cupWon == null) { m.cupWon = false; changed = true; }
      if (m.ending == null) { m.ending = false; changed = true; }
      if (!m.cityOwner) { m.cityOwner = initCityOwner(); changed = true; }
      if (!m.statPenalty) { m.statPenalty = {}; changed = true; }
      if (!m.statGrowth) { m.statGrowth = {}; changed = true; }
      if (m.activeAssassin === undefined) { m.activeAssassin = null; changed = true; }
      if (changed) this.save();
      return m;
    },
    // 名声九阶：数值上限 9999，各阶对应行动力上限/历练/武道会/集市/悬赏/铁匠铺渐进解锁（见 recalcApMax 与各处 fameTierIndex 判定）
    FAME_MAX: 9999,
    FAME_TIERS: [
      { n: "无名之辈", min: 0 },
      { n: "略有耳闻", min: 150 },
      { n: "小有名气", min: 500 },
      { n: "声名初显", min: 1200 },
      { n: "威震一方", min: 2200 },
      { n: "名动一国", min: 3500 },
      { n: "威名远播", min: 5000 },
      { n: "名满天下", min: 7000 },
      { n: "威加四海", min: 9000 },
    ],
    fameTierIndex(fame) {
      let idx = 0;
      this.FAME_TIERS.forEach((t, i) => { if (fame >= t.min) idx = i; });
      return idx;
    },
    fameTierName(fame) { return this.FAME_TIERS[this.fameTierIndex(fame)].n; },
    fameLabel(fame) { return `${this.fameTierName(fame)}（${fame || 0}）`; },
    // 名动一国（第 5 阶）解锁时：眼线渐广，每城悬赏榜永久 +1 条空缺（仅触发一次，直接补进当前各城悬赏列表）
    BOUNTY_BONUS_TIER: 5,
    // 增加名声；跨阶时提示，重算行动力上限，并在特定阶梯触发一次性福利
    addFame(n) {
      const m = this.mapState(); if (!m || !n) return;
      const before = this.fameTierIndex(m.fame || 0);
      m.fame = Math.min(this.FAME_MAX, (m.fame || 0) + n);
      const after = this.fameTierIndex(m.fame);
      this.recalcApMax();
      if (after >= this.BOUNTY_BONUS_TIER && before < this.BOUNTY_BONUS_TIER && m.bounties) {
        Object.keys(m.bounties).forEach(cid => m.bounties[cid].push(genBounty(cid, m.assign, m.appeared, RPG.char && RPG.char.side)));
      }
      this.save();
      if (after > before) {
        toast(`🎉 名声跨入「${this.FAME_TIERS[after].n}」！行动力上限提升，天下事更多了`);
      }
    },
    // 行动力上限 = 1 + 名声阶梯/2（向下取整） + 武道会首冠(+1) + 已装备的行动力奇珍(传国玉玺/九鼎二选一，+1)，封顶 6
    recalcApMax() {
      const m = this.mapState(); if (!m) return;
      let cap = 1 + Math.floor(this.fameTierIndex(m.fame || 0) / 2);
      if (m.cupWon) cap++;
      cap += Armory.itemsOf("hero").filter(i => i.apBonus).length;
      cap = Math.min(6, cap);
      const delta = cap - m.apMax;
      m.apMax = cap;
      if (delta > 0) m.ap = Math.min(m.apMax, m.ap + delta);   // 上限提升时同步补给当天行动力，即时可用
      m.ap = Math.min(m.ap, m.apMax);
    },
    // 宿营跨天后检查是否触及登场节点：每 5 天揭示一批 3~5 名新武将（不按名声分层，高手也可能随时现身），返回本次新登场名单供「天下快报」展示
    checkAppearances() {
      const m = this.mapState(); if (!m) return [];
      const revealed = [];
      while (m.day >= m.nextAppearDay) {
        const hidden = DB.list.map(g => g.id).filter(id => !m.appeared.includes(id));
        if (!hidden.length) { m.nextAppearDay += 5; continue; }
        shuffle(hidden);
        const batch = hidden.slice(0, randInt(3, 5));
        m.appeared.push(...batch);
        revealed.push(...batch);
        m.nextAppearDay += 5;
      }
      if (revealed.length) this.save();
      return revealed;
    },
  };
  // 返回首页时刷新"继续游戏"按钮的可用状态与摘要（显示当前角色名/等级/战绩，无存档则置灰）
  function syncHomeButtons() {
    const btn = $("#btn-continue"), sub = $("#continue-sub");
    if (!btn || !sub) return;
    if (RPG.char) {
      btn.disabled = false;
      sub.textContent = `${RPG.char.name} · Lv.${RPG.char.level} · ${RPG.char.wins}胜${RPG.char.losses}负`;
    } else {
      btn.disabled = true;
      sub.textContent = "暂无存档";
    }
  }

  /* ============================================================
   *  新游戏 · 开局向导：① 选角色(自创 / 史实武将+少年·巅峰) → ② 选天下格局 → ③ 确认开局
   * ============================================================ */
  const Onboard = {
    step: 1,
    state: {},
    open() {
      this.step = 1;
      this.state = { charType: null, generalId: null, difficulty: null, custom: null, distribution: "historical" };
      this._roll = null; this._name = ""; this._genSearch = "";
      this.render();
      showScreen("onboard");
    },
    render() {
      const C = $("#onboard-content");
      C.innerHTML = `<div class="ob-steps">
        <span class="ob-step ${this.step === 1 ? 'active' : this.step > 1 ? 'done' : ''}">① 选角色</span>
        <span class="ob-step ${this.step === 2 ? 'active' : this.step > 2 ? 'done' : ''}">② 选格局</span>
        <span class="ob-step ${this.step === 3 ? 'active' : ''}">③ 确认开局</span>
      </div>` + (this.step === 1 ? this.stepChar() : this.step === 2 ? this.stepWorld() : this.stepConfirm());
      this.bind();
    },

    /* ---- 第 1 步：选角色 ---- */
    stepChar() {
      const s = this.state;
      if (!s.charType) return this.chooseTypeHtml();
      if (s.charType === "custom") return s.custom ? this.charSummaryHtml() : this.customFormHtml();
      if (!s.generalId) return this.genPickHtml();
      if (!s.difficulty) return this.diffChoiceHtml();
      return this.charSummaryHtml();
    },
    chooseTypeHtml() {
      return `<div class="section-hint">第 1 步 · 选择你的武将</div>
        <div class="buff-list">
          <button class="buff-btn ob-chartype" data-v="custom"><span class="bi">✦</span><span class="bt"><b>自创武将</b><small>白手起家，随机基线六维，历练自由加点成长</small></span></button>
          <button class="buff-btn ob-chartype" data-v="historical"><span class="bi">📜</span><span class="bt"><b>扮演史实武将</b><small>选一位名将，体验其从崭露头角到巅峰的成长</small></span></button>
        </div>`;
    },
    customFormHtml() {
      if (!this._roll) this._roll = RPG.rollStats();
      const r = this._roll;
      return `<div class="section-hint">第 1 步 · 自创武将</div>
        <div class="rpg-form">
          <div class="rf-row"><label>姓名</label><input id="ob-name" maxlength="6" placeholder="输入名字" value="${this._name || ''}"></div>
          <div class="rf-row"><label>阵营</label>
            <select id="ob-side"><option value="cn" ${this._side !== 'jp' ? 'selected' : ''}>三国 风</option><option value="jp" ${this._side === 'jp' ? 'selected' : ''}>战国 风</option></select></div>
          <div class="rpg-roll-box">${DIMS.map(([k, l]) => {
            const v = r.base[k];
            return `<div class="rr-dim"><span>${l}</span>
              <span class="rr-track"><span class="rr-bar" style="width:${Math.min(100, v / 1.2)}%;background:${gradeColor(v)}"></span></span>
              <b>${v}</b>${gradeChip(v)}</div>`;
          }).join("")}
            <div class="rr-sum">基线评分 <b>${ratingScore(r.base)}</b> ${ratingChip(r.base)} · 可分配加点 <b style="color:var(--cn-gold)">${r.points}</b></div>
          </div>
          <div class="rpg-create-btns">
            <button class="cup-go" id="ob-reroll">🎲 重新随机</button>
          </div>
        </div>
        <div class="rpg-create-btns">
          <button class="cup-go" id="ob-type-back">‹ 换个方式</button>
          <button class="cup-go primary" id="ob-custom-next">下一步 ›</button>
        </div>`;
    },
    genPickHtml() {
      return `<div class="section-hint">第 1 步 · 选一位史实武将扮演</div>
        <div class="search-box"><input id="ob-gen-search" placeholder="搜索…" value="${this._genSearch || ''}"></div>
        <div class="grid" id="ob-gen-grid">${this.genGridHtml()}</div>
        <div class="rpg-create-btns"><button class="cup-go" id="ob-type-back">‹ 换个方式</button></div>`;
    },
    genGridHtml() {
      const kw = (this._genSearch || "").trim();
      let arr = DB.list.slice().sort((a, b) => ratingScore(b) - ratingScore(a));
      if (kw) arr = arr.filter(g => g.name.includes(kw));
      return arr.slice(0, 80).map(g =>
        `<div class="card ${g.side}" data-id="${g.id}"><div class="avatar">${avatarChar(g.name)}</div>
          <div class="cname">${g.name}</div><div class="cwu">评分 ${ratingScore(g)} ${ratingChip(g)}</div></div>`).join("");
    },
    bindGenCards() {
      $$("#ob-gen-grid .card").forEach(c => c.onclick = () => { this.state.generalId = +c.dataset.id; this.render(); });
    },
    diffChoiceHtml() {
      const g = DB.get(this.state.generalId);
      return `<div class="section-hint">第 1 步 · ${g.name} —— 选择成长模式</div>
        <div class="buff-list">
          <button class="buff-btn ob-diff" data-v="young"><span class="bi">🌱</span><span class="bt"><b>少年模式</b><small>初始六维为默认值 60%；其中最高两项定为「本命天赋」，加点成长 +50%，可突破默认上限</small></span></button>
          <button class="buff-btn ob-diff" data-v="peak"><span class="bi">👑</span><span class="bt"><b>巅峰模式</b><small>默认原值开局，立即可用；但历练加点成长减半</small></span></button>
        </div>
        <div class="rpg-create-btns"><button class="cup-go" id="ob-gen-back">‹ 重新选将</button></div>`;
    },
    charSummaryHtml() {
      const s = this.state;
      let av, name, desc, bg;
      if (s.charType === "custom") {
        av = avatarChar(s.custom.name); name = s.custom.name;
        bg = s.custom.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
        desc = `自创武将 · ${s.custom.side === 'cn' ? '三国风' : '战国风'} · 基线评分 ${ratingScore(s.custom.base)}`;
      } else {
        const g = DB.get(s.generalId);
        av = avatarChar(g.name); name = g.name;
        bg = g.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
        desc = s.difficulty === 'young' ? '少年模式 · 初始六维 60%，本命天赋成长 +50%' : '巅峰模式 · 默认原值开局，历练成长减半';
      }
      return `<div class="section-hint">第 1 步 · 已选定</div>
        <div class="result-card" style="padding:20px 16px">
          <div class="winner-av" style="background:${bg}">${av}</div>
          <div class="wname">${name}</div>
          <div class="wdesc">${desc}</div>
        </div>
        <div class="rpg-create-btns">
          <button class="cup-go" id="ob-redo1">重新选择</button>
          <button class="cup-go primary" id="ob-next1">下一步 ›</button>
        </div>`;
    },

    /* ---- 第 2 步：选天下格局 ---- */
    stepWorld() {
      const s = this.state;
      return `<div class="section-hint">第 2 步 · 选择天下格局</div>
        <div class="buff-list">
          <button class="buff-btn ob-dist ${s.distribution === 'historical' ? 'active' : ''}" data-v="historical"><span class="bi">🏯</span><span class="bt"><b>史实分布</b><small>武将按真实势力落位（蜀将在成都、武田家在甲斐…）</small></span></button>
          <button class="buff-btn ob-dist ${s.distribution === 'random' ? 'active' : ''}" data-v="random"><span class="bi">🎲</span><span class="bt"><b>群雄乱入</b><small>全部武将随机洗牌分配到各城，每局天下大不同</small></span></button>
        </div>
        <div class="rpg-create-btns">
          <button class="cup-go" id="ob-back1">‹ 上一步</button>
          <button class="cup-go primary" id="ob-next2">下一步 ›</button>
        </div>`;
    },

    /* ---- 第 3 步：确认开局 ---- */
    stepConfirm() {
      const s = this.state;
      const hasExisting = !!RPG.char;
      let name, desc;
      if (s.charType === "custom") { name = s.custom.name; desc = `自创武将 · ${s.custom.side === 'cn' ? '三国风' : '战国风'}`; }
      else { const g = DB.get(s.generalId); name = g.name; desc = s.difficulty === 'young' ? '少年模式' : '巅峰模式'; }
      return `<div class="section-hint">第 3 步 · 确认开局</div>
        <div class="result-card" style="padding:20px 16px">
          <div class="wname">${name}</div>
          <div class="wdesc">${desc} · 天下格局：${s.distribution === 'historical' ? '史实分布' : '群雄乱入'}</div>
          ${hasExisting ? `<div class="wdesc" style="color:var(--cn-red)">⚠️ 当前已有存档（${RPG.char.name}），开始新游戏将覆盖角色、金币、友谊、队伍与宝物背包，且无法恢复！</div>` : ''}
        </div>
        <div class="rpg-create-btns">
          <button class="cup-go" id="ob-back2">‹ 上一步</button>
          <button class="cup-go primary" id="ob-confirm">⚔ ${hasExisting ? '覆盖存档，开始新的武将人生' : '开始新的武将人生'}</button>
        </div>`;
    },

    bind() {
      // 第 1 步
      $$(".ob-chartype").forEach(b => b.onclick = () => { this.state.charType = b.dataset.v; this.render(); });
      const typeBack = $("#ob-type-back"); if (typeBack) typeBack.onclick = () => { this.state.charType = null; this.state.generalId = null; this.state.difficulty = null; this.state.custom = null; this.render(); };
      const nameInput = $("#ob-name"); if (nameInput) nameInput.oninput = () => { this._name = nameInput.value; };
      const sideSel = $("#ob-side"); if (sideSel) sideSel.onchange = () => { this._side = sideSel.value; };
      const reroll = $("#ob-reroll"); if (reroll) reroll.onclick = () => { this._name = $("#ob-name").value; this._side = $("#ob-side").value; this._roll = RPG.rollStats(); this.render(); };
      const customNext = $("#ob-custom-next"); if (customNext) customNext.onclick = () => {
        const name = ($("#ob-name").value || "").trim() || "无名客";
        const side = $("#ob-side").value;
        this.state.custom = { name, side, base: this._roll.base, points: this._roll.points };
        this._roll = null; this._name = ""; this.render();
      };
      const genSearch = $("#ob-gen-search");
      if (genSearch) { genSearch.oninput = () => { this._genSearch = genSearch.value; $("#ob-gen-grid").innerHTML = this.genGridHtml(); this.bindGenCards(); }; this.bindGenCards(); }
      const genBack = $("#ob-gen-back"); if (genBack) genBack.onclick = () => { this.state.generalId = null; this.render(); };
      $$(".ob-diff").forEach(b => b.onclick = () => { this.state.difficulty = b.dataset.v; this.render(); });
      const redo1 = $("#ob-redo1"); if (redo1) redo1.onclick = () => { this.state.charType = null; this.state.generalId = null; this.state.difficulty = null; this.state.custom = null; this.render(); };
      const next1 = $("#ob-next1"); if (next1) next1.onclick = () => { this.step = 2; this.render(); };
      // 第 2 步
      $$(".ob-dist").forEach(b => b.onclick = () => { this.state.distribution = b.dataset.v; this.render(); });
      const back1 = $("#ob-back1"); if (back1) back1.onclick = () => { this.step = 1; this.render(); };
      const next2 = $("#ob-next2"); if (next2) next2.onclick = () => { this.step = 3; this.render(); };
      // 第 3 步
      const back2 = $("#ob-back2"); if (back2) back2.onclick = () => { this.step = 2; this.render(); };
      const confirm = $("#ob-confirm"); if (confirm) confirm.onclick = () => this.finish();
    },

    finish() {
      const s = this.state;
      const side = s.charType === "custom" ? s.custom.side : (DB.get(s.generalId) || {}).side;
      Campaign.reset({ charType: s.charType, difficulty: s.difficulty || null, distribution: s.distribution, side });
      if (s.charType === "custom") RPG.create(s.custom.name, s.custom.side, s.custom.base, s.custom.points);
      else RPG.createFromGeneral(DB.get(s.generalId), s.difficulty);
      toast(`🎉 ${RPG.char.name}，你的武将人生开始了！`);
      MapUI.open();
    },
  };

  /* ============================================================
   *  天下游历：地图主界面——移动/天数/行动力/宿营、当前城池行动、本地武将名录
   * ============================================================ */
  // 风格化陆地剪影（viewBox 0~100，与城池坐标同一相对坐标系），非精确测绘，仅取意接近真实海岸轮廓
  const CHINA_LAND_PATH = "M18,18 L30,16 L40,20 L44,26 L42,32 L46,36 L44,42 L48,48 L44,52 L46,58 L40,62 L42,66 L34,70 L24,72 L14,68 L6,60 L4,50 L8,42 L4,34 L8,26 Z";
  const JAPAN_LAND_PATH = "M90,18 L94,26 L92,34 L90,42 L88,50 L84,56 L80,62 L74,68 L70,74 L68,80 L66,86 L58,88 L54,84 L50,78 L52,70 L56,62 L60,54 L62,46 L66,38 L68,30 L70,22 L74,16 L82,14 Z";
  const MapZoom = { scale: 1, x: 0, y: 0 };
  const MapUI = {
    BORDER_WAR_WIN_BONUS: 1000,   // 己方边境战获胜的特殊犒赏（不小于1000，无论亲征与否）
    open() {
      const m = Campaign.ensureMap();   // 旧版本存档自动补建地图状态，保证"继续游戏"总能进入
      if (!m || !RPG.char) { showScreen("home"); return; }
      if (!m.curCity) { m.curCity = RPG.char.side === "jp" ? "kyoto" : "luoyang"; Campaign.save(); }
      this.render();
      showScreen("map");
    },
    render() {
      const m = Campaign.mapState();
      if (!m || !RPG.char) { showScreen("home"); return; }
      const statusBar = $("#map-topbar-status");
      if (statusBar) statusBar.innerHTML = `<span class="mts-item">📅<b>${calLabel(m.day)}</b></span>`;
      const C = $("#map-content");
      C.innerHTML = `<div class="map-wrap">
        <div class="map-top">
          <div class="map-svg-box">${this.svgHtml(m)}</div>
        </div>
        <div class="map-bottom">
          <div class="map-info-col">
            ${this.heroCardHtml(m)}
            ${this.localGeneralsHtml(m)}
          </div>
          <div class="map-city-panel">
            ${this.cityPanelHtml(m)}
          </div>
        </div>
      </div>`;
      this.bind(m);
      this.bindZoom($(".map-svg-box"));
    },
    svgHtml(m) {
      const lines = ROADS.map(([a, b]) => {
        const A = cityDef(a), B = cityDef(b);
        return `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="map-road" vector-effect="non-scaling-stroke"/>`;
      }).join("");
      const adj = adjCities(m.curCity);
      const dots = CITIES.map(c => {
        const cls = c.id === m.curCity ? "cur" : adj.includes(c.id) ? "adj" : "far";
        const owner = cityOwnerSide(m, c.id);
        return `<div class="map-city ${owner} ${cls}" data-id="${c.id}" style="left:${c.x}%;top:${c.y}%">
          <span class="mcity-name">${c.n}</span>
        </div>`;
      }).join("");
      return `<div class="map-zoom-layer">
        <svg class="map-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path class="map-land cn" d="${CHINA_LAND_PATH}"/>
          <path class="map-land jp" d="${JAPAN_LAND_PATH}"/>
          ${lines}
        </svg>
        ${dots}
      </div>
      <div class="map-zoom-ctl">
        <button id="map-zoom-in" type="button">＋</button>
        <button id="map-zoom-out" type="button">－</button>
        <button id="map-zoom-focus" type="button" title="聚焦当前城市">🎯</button>
        <button id="map-zoom-overview" type="button" title="显示全景">🗺️</button>
      </div>`;
    },
    heroCardHtml(m) {
      const c = RPG.char, hg = RPG.heroGeneral();
      return `<div class="map-hero-card ${c.side}">
        <div class="mh-av">${avatarChar(c.name)}</div>
        <div class="mh-meta">
          <div class="mh-name">${c.name}</div>
          <div class="mh-sub">Lv.${c.level} · ${ratingChip(hg)}</div>
        </div>
        <div class="mh-action-col">
          <div class="mh-fame">⭐ ${Campaign.fameLabel(m.fame || 0)}</div>
          <button class="cup-go" id="map-char">🎭 角色详情</button>
        </div>
      </div>`;
    },
    // 本地武将：原「游戏信息区域」（天数/行动力/金币/名声已上移顶栏状态条，等级已移入角色资料卡）腾出的位置，
    // 每行 3 个更紧凑；「全部武将」改为与「角色详情」同风格的大按钮，置于名录下方
    localGeneralsHtml(m) {
      const localGenerals = DB.list.filter(g => m.assign[g.id] === m.curCity);
      const appearedHere = localGenerals.filter(g => m.appeared.includes(g.id));
      return `<div class="mc-sect">🚶 本地武将<small>已现身${appearedHere.length}/${localGenerals.length}</small></div>
        <div class="mc-roster narrow triple">${appearedHere.map(g => `<button class="mc-gen ${g.side}" data-id="${g.id}">
          <span class="mcg-name">${g.name}</span>
        </button>`).join("") || '<div class="empty" style="grid-column:1/-1;width:100%;padding:14px 4px;white-space:normal;">这座城暂无现身的武将，游历天下终会遇见他们。</div>'}</div>
        <button class="cup-go allgen-btn" id="map-all-gens">🌐 全部武将</button>`;
    },
    cityPanelHtml(m) {
      const c = cityDef(m.curCity);
      const isSea = c.side === "sea";
      const fac = CITY_FACILITY[m.curCity];
      const bounties = (!isSea && m.bounties[m.curCity]) || [];
      const factor = cityPriceFactor(m.curCity);
      const factorTxt = factor <= 0.85 ? "黑市八折" : factor < 1 ? "行情便宜" : factor > 1.1 ? "行情偏贵" : "价格公道";
      const smithType = Armory.TYPES[hashStr(m.curCity) % Armory.TYPES.length];
      const trainLocked = Campaign.fameTierIndex(m.fame || 0) < RPG.TRAIN_FAME_TIER;
      return `<div class="mc-head">
          <span>📍 ${c.n}${isSea ? '<small>海路中转站</small>' : ''}</span>
          <span class="mc-head-stats">⚡<b>${m.ap}</b>/${m.apMax} · 💰<b>${Bond.gold()}</b></span>
        </div>
        <div class="menu map-menu">
          <button class="menu-btn" id="map-train" ${(m.ap <= 0 || trainLocked) ? "disabled" : ""}><span class="mi">${trainLocked ? '🔒' : '🏋️'}</span><span>历练<small>${trainLocked ? `声望达「${Campaign.FAME_TIERS[RPG.TRAIN_FAME_TIER].n}」解锁` : '随机切磋练级 · 耗 1⚡'}</small></span></button>
          <button class="menu-btn" id="map-shop"><span class="mi">🏪</span><span>集市<small>本地货摊每日上新 · ${factorTxt}</small></span></button>
          <button class="menu-btn" id="map-forge"><span class="mi">⚒️</span><span>铁匠铺<small>专精${smithType.n}锻造 · 有减免</small></span></button>
          ${fac ? `<button class="menu-btn" id="map-facility" ${m.ap <= 0 ? "disabled" : ""}><span class="mi">${fac.icon}</span><span>${fac.n}<small>设施挑战扬名 · 耗 1⚡</small></span></button>` : ""}
          <button class="menu-btn" id="map-camp"><span class="mi">🏕️</span><span>宿营<small>推进一天 · 行动力回满</small></span></button>
        </div>
        ${bounties.length ? `<div class="mc-sect">📋 悬赏榜<small>1⚡</small></div>
        <div class="mc-bounty-list">${bounties.map(b => `<button class="mc-bounty ${b.legendary ? 'legendary' : ''}" data-uid="${b.uid}" ${m.ap <= 0 ? "disabled" : ""}>
          <div class="mcb-desc">${b.legendary ? '⭐ ' : ''}${b.desc}</div>
          <div class="mcb-reward">赏 ${b.rewardGold} 金 · 名声 +${b.rewardFame}</div>
        </button>`).join("")}</div>` : ""}`;
    },
    bind(m) {
      $$(".map-city").forEach(el => el.onclick = () => this.moveTo(el.dataset.id));
      $$(".mc-gen").forEach(el => el.onclick = () => { const g = DB.get(+el.dataset.id); if (g) showDetail(g); });
      $$(".mc-bounty").forEach(el => el.onclick = () => this.acceptBounty(m.curCity, el.dataset.uid));
      const trainBtn = $("#map-train"); if (trainBtn) trainBtn.onclick = () => RPG.train();
      const shopBtn = $("#map-shop"); if (shopBtn) shopBtn.onclick = () => this.openMarket();
      const forgeBtn = $("#map-forge"); if (forgeBtn) forgeBtn.onclick = () => this.openForge();
      const facBtn = $("#map-facility"); if (facBtn) facBtn.onclick = () => this.openFacility();
      const campBtn = $("#map-camp"); if (campBtn) campBtn.onclick = () => this.camp();
      const charBtn = $("#map-char"); if (charBtn) charBtn.onclick = () => RPG.open();
      const allGenBtn = $("#map-all-gens"); if (allGenBtn) allGenBtn.onclick = () => AllGenUI.open();
    },
    // 地图缩放/拖动：鼠标拖拽、触控拖拽、双指捏合缩放、滚轮缩放、右上角 +/- 按钮；缩放状态跨渲染持久（MapZoom 为模块级变量）
    applyZoom(box) {
      const layer = box.querySelector(".map-zoom-layer");
      if (layer) layer.style.transform = `translate(${MapZoom.x}px,${MapZoom.y}px) scale(${MapZoom.scale})`;
    },
    clampZoomState(box) {
      MapZoom.scale = Math.min(3, Math.max(1, MapZoom.scale));
      const rect = box.getBoundingClientRect();
      const maxX = (MapZoom.scale - 1) * rect.width / 2 + 40;
      const maxY = (MapZoom.scale - 1) * rect.height / 2 + 40;
      MapZoom.x = Math.min(maxX, Math.max(-maxX, MapZoom.x));
      MapZoom.y = Math.min(maxY, Math.max(-maxY, MapZoom.y));
    },
    bindZoom(box) {
      if (!box) return;
      this.applyZoom(box);
      // 注：不使用 setPointerCapture——它会让 click 事件的目标被劫持到 box 本身，
      // 导致捏合/拖拽绑定后城池点击彻底失效；改为在 document 上临时挂 move/up 监听，手势结束即摘除
      const pointers = new Map();
      let dragging = false, moved = false, lastX = 0, lastY = 0, pinchDist = 0, pinchScale = 1;
      const onMove = e => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
          const pts = [...pointers.values()];
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (pinchDist > 0) { MapZoom.scale = pinchScale * dist / pinchDist; this.clampZoomState(box); this.applyZoom(box); }
          return;
        }
        if (dragging) {
          const dx = e.clientX - lastX, dy = e.clientY - lastY;
          if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
          MapZoom.x += dx; MapZoom.y += dy;
          lastX = e.clientX; lastY = e.clientY;
          this.clampZoomState(box);
          this.applyZoom(box);
        }
      };
      const onUp = e => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchDist = 0;
        if (pointers.size === 0 && dragging) {
          dragging = false;
          if (moved) { box._justDragged = true; setTimeout(() => { box._justDragged = false; }, 60); }
        }
        if (pointers.size === 0) {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", onUp);
        }
      };
      box.onpointerdown = e => {
        if (e.target.closest(".map-zoom-ctl")) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onUp);
        if (pointers.size === 1) { dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY; }
        else if (pointers.size === 2) {
          dragging = false;
          const pts = [...pointers.values()];
          pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          pinchScale = MapZoom.scale;
        }
      };
      box.onwheel = e => {
        e.preventDefault();
        MapZoom.scale += e.deltaY < 0 ? 0.15 : -0.15;
        this.clampZoomState(box);
        this.applyZoom(box);
      };
      box.addEventListener("click", e => { if (box._justDragged) { e.stopPropagation(); e.preventDefault(); } }, true);
      const zoomStep = d => { MapZoom.scale += d; if (MapZoom.scale <= 1.001) { MapZoom.x = 0; MapZoom.y = 0; } this.clampZoomState(box); this.applyZoom(box); };
      const inBtn = $("#map-zoom-in"); if (inBtn) inBtn.onclick = () => zoomStep(0.4);
      const outBtn = $("#map-zoom-out"); if (outBtn) outBtn.onclick = () => zoomStep(-0.4);
      const focusBtn = $("#map-zoom-focus"); if (focusBtn) focusBtn.onclick = () => this.focusCurCity(box);
      const overviewBtn = $("#map-zoom-overview"); if (overviewBtn) overviewBtn.onclick = () => { MapZoom.scale = 1; MapZoom.x = 0; MapZoom.y = 0; this.applyZoom(box); };
    },
    // 聚焦当前城市：以其相对坐标为中心放大（越靠近地图边缘，越可能被 clampZoomState 的平移边界收紧，属预期内的安全兜底）
    focusCurCity(box) {
      const m = Campaign.mapState(); if (!m) return;
      const c = cityDef(m.curCity); if (!c) return;
      const rect = box.getBoundingClientRect();
      MapZoom.scale = 2.2;
      MapZoom.x = MapZoom.scale * rect.width * (0.5 - c.x / 100);
      MapZoom.y = MapZoom.scale * rect.height * (0.5 - c.y / 100);
      this.clampZoomState(box);
      this.applyZoom(box);
    },
    /* ---- 集市：每城每（游戏）日一批本地货摊，价格按城市行情浮动；已购摊位当日售罄 ---- */
    openMarket() {
      const m = Campaign.mapState();
      const c = cityDef(m.curCity);
      const factor = shopDiscountActive() ? Math.min(0.8, cityPriceFactor(m.curCity)) : cityPriceFactor(m.curCity);
      const key = m.curCity + "|" + m.day;
      if (!m.marketSold) m.marketSold = {};
      const sold = m.marketSold[key] || (m.marketSold[key] = []);
      const stalls = cityMarketStalls(m);
      openOverlay(`<div class="result-card detail-card">
        <h1>🏪 ${c.n}集市</h1>
        <div class="wdesc">本地行情：${factor <= 0.85 ? "🈹 黑市/折扣价" : factor < 1 ? "💰 偏低" : factor > 1.1 ? "📈 偏贵" : "⚖️ 公道"}（约 ${Math.round(factor * 100)}% 市价）· 货摊每日更新 · 💰 现有 ${Bond.gold()} 金</div>
        <div class="buff-list">
          ${stalls.map((s, i) => {
            const type = Armory.typeDef(s.type), rar = Armory.rarityDef(s.rarity);
            const price = Math.round(Armory.shopPrice(s.rarity) * factor);
            if (sold.includes(i)) return `<div class="buff-btn sold"><span class="bi">${type.icon}</span><span class="bt"><b>${s.tmpl.n}</b><small>已售出</small></span></div>`;
            return `<button class="buff-btn market-buy" data-i="${i}"><span class="bi">${type.icon}</span><span class="bt"><b style="color:${rar.color}">${s.tmpl.n}</b><small>${rar.n} · ${s.tmpl.intro}</small></span><span class="mkt-price">💰${price}</span></button>`;
          }).join("")}
        </div>
        <div class="btns"><button class="btn-ghost" id="market-close">离开集市</button></div></div>`);
      $$(".market-buy").forEach(b => b.onclick = () => {
        const i = +b.dataset.i, s = stalls[i];
        const price = Math.round(Armory.shopPrice(s.rarity) * factor);
        if (!Bond.spend(price)) { toast(`金币不足（需 ${price} 金）`); return; }
        const item = Armory.makeItem(s.type, s.rarity, s.tmpl);
        Armory.data.items.push(item); Armory.save();
        sold.push(i); Campaign.save();
        AudioSystem.sfx.select();
        toast(`已购得 ${item.icon}「${item.name}」（${Armory.rarityDef(s.rarity).n}）-${price}金`);
        this.openMarket();   // 重开以刷新售罄状态与余额
      });
      $("#market-close").onclick = () => { closeOverlay(); this.render(); };
    },
    /* ---- 铁匠铺：各城专精一类宝物，锻造专精类省料省钱 ---- */
    openForge() {
      const m = Campaign.mapState();
      const c = cityDef(m.curCity);
      const specialty = Armory.TYPES[hashStr(m.curCity) % Armory.TYPES.length];
      // 名声达「名满天下」（第 7 阶）起，铁匠铺待你如上宾，专精类锻造再减免
      const highFame = Campaign.fameTierIndex(m.fame || 0) >= 7;
      const specMat = highFame ? 4 : 5, specGold = highFame ? 20 : 30;
      openOverlay(`<div class="result-card detail-card">
        <h1>⚒️ ${c.n}铁匠铺</h1>
        <div class="wdesc">本铺专精<b style="color:var(--cn-gold)">${specialty.icon}${specialty.n}</b>：锻${specialty.n}只需材料 ${specMat} + ${specGold} 金（其余类型 6 + 40 金）${highFame ? '<br>⭐ 声望崇高，本铺特惠加码' : ''} · 💰 现有 ${Bond.gold()} 金</div>
        <div class="buff-list">
          ${Armory.TYPES.map(type => {
            const isSpec = type.k === specialty.k;
            const mat = Armory.data.materials[type.k] || 0, pity = Armory.data.pity[type.k] || 0;
            const matCost = isSpec ? specMat : Armory.FORGE_COST, goldCost = isSpec ? specGold : Armory.FORGE_GOLD;
            return `<button class="buff-btn smith-forge ${isSpec ? 'active' : ''}" data-type="${type.k}" ${mat < matCost ? "disabled" : ""}>
              <span class="bi">${type.icon}</span>
              <span class="bt"><b>${type.n}${isSpec ? ' ★本铺专精' : ''}</b><small>材料 ${mat}/${matCost} · ${goldCost}金 · 保底 ${pity}/${Armory.FORGE_PITY}</small></span>
            </button>`;
          }).join("")}
        </div>
        <div class="btns"><button class="btn-ghost" id="forge-close">离开铁匠铺</button></div></div>`);
      $$(".smith-forge").forEach(b => b.onclick = () => {
        const typeK = b.dataset.type;
        const isSpec = typeK === specialty.k;
        if (Armory.forge(typeK, isSpec ? { matCost: specMat, goldCost: specGold } : undefined)) this.openForge();
      });
      $("#forge-close").onclick = () => { closeOverlay(); this.render(); };
    },
    acceptBounty(cityId, uid) {
      const m = Campaign.mapState();
      const list = m.bounties[cityId] || [];
      const b = list.find(x => x.uid === uid);
      if (!b) return;
      if (m.ap <= 0) { toast("今日行动力已耗尽，请先宿营恢复"); return; }
      m.ap--; m.activeBounty = { cityId, uid: b.uid, kind: b.kind, targetId: b.targetId, need: b.need, legendary: b.legendary, desc: b.desc, rewardGold: b.rewardGold, rewardFame: b.rewardFame };
      Campaign.save();
      if (b.kind === "duel") startClassicBattle(RPG.heroGeneral(), DB.get(b.targetId), false, true);
      else if (b.kind === "tower") Tower.start(RPG.heroGeneral(), true);
      else if (b.kind === "duo") RPG.duoPicker(true);
      else if (b.kind === "assassin") {
        const target = DB.get(b.targetId);
        if (!target) { m.activeBounty = null; Campaign.save(); toast("目标已不知去向，悬赏已失效"); return; }
        const today = Bond.dayKey();
        if (!Bond.data.assassinDay) Bond.data.assassinDay = {};
        Bond.data.assassinDay[target.id] = today; Bond.save();
        m.activeAssassin = target.id; Campaign.save();
        startClassicBattle(RPG.heroGeneral(), target, false, true);
      }
      else Gauntlet.start(RPG.heroGeneral(), true);
    },
    // 特色设施：duel 类先挑选对手（本地已现身武将优先），其余直接调用对应 RPG 入口（已含行动力扣减）
    openFacility() {
      const m = Campaign.mapState();
      const fac = CITY_FACILITY[m.curCity];
      if (!fac) return;
      if (fac.mode === "duel") {
        const local = DB.list.filter(g => m.assign[g.id] === m.curCity && m.appeared.includes(g.id));
        const pool = (local.length ? local : DB.list.filter(g => m.appeared.includes(g.id))).slice(0, 20);
        if (!pool.length) { toast("暂无可挑战的已现身武将"); return; }
        openOverlay(`<div class="result-card">
          <h1>${fac.icon} ${fac.n}</h1>
          <div class="wdesc">挑一位好手切磋，胜之可扬名声：</div>
          <div class="buff-list">${pool.map(g => `<button class="buff-btn fac-target" data-id="${g.id}"><span class="bi">⚔️</span><span class="bt"><b>${g.name}</b><small>评分 ${ratingScore(g)}</small></span></button>`).join("")}</div>
          <div class="btns"><button class="btn-ghost" id="fac-cancel">取消</button></div></div>`);
        $$(".fac-target").forEach(b => b.onclick = () => {
          if (m.ap <= 0) { toast("今日行动力已耗尽，请先宿营恢复"); return; }
          m.ap--; m.activeFacility = "duel"; Campaign.save();
          closeOverlay();
          startClassicBattle(RPG.heroGeneral(), DB.get(+b.dataset.id), false, true);
        });
        $("#fac-cancel").onclick = closeOverlay;
        return;
      }
      if (fac.mode === "cup" && Campaign.fameTierIndex(m.fame || 0) < RPG.CUP_FAME_TIER) { toast(`声望不足，需达到「${Campaign.FAME_TIERS[RPG.CUP_FAME_TIER].n}」名声阶梯才能报名天下第一武道会`); return; }
      if (m.ap <= 0) { toast("今日行动力已耗尽，请先宿营恢复"); return; }
      m.activeFacility = fac.mode; Campaign.save();
      const fn = { gauntlet: () => RPG.gauntlet(), tower: () => RPG.tower(), duo: () => RPG.duo(), teamBattle: () => RPG.teamBattle(), conquest: () => RPG.conquest(), cup: () => RPG.joinCup(32) }[fac.mode];
      if (fn) fn();
    },
    moveTo(id) {
      const m = Campaign.mapState();
      if (id === m.curCity) return;
      if (!adjCities(m.curCity).includes(id)) { toast(`距离太远，需先移动到相邻城池`); return; }
      if (m.ap <= 0) { toast(`今日行动力已耗尽，请先宿营`); return; }
      m.ap--;
      const isSea = m.curCity === "tsushima" || id === "tsushima";
      if (isSea && Math.random() < 0.2) { this.seaStorm(m); return; }
      m.curCity = id; Campaign.save();
      // 团队成员与主角同行，一并迁至目的城池（使其在新城的「本地武将」名录中同步现身）
      Bond.data.team.forEach(gid => { m.assign[gid] = id; });
      Campaign.save();
      toast(`🚩 抵达${cityName(id)}`);
      if (!this.triggerTeamEncounter(m)) this.triggerEncounter(m);
      this.render();
    },
    // 渡海风暴：延误(耗尽当日行动力，滞留原地) 或 漂流(随机漂到另一港口，仍消耗本次移动)
    seaStorm(m) {
      if (Math.random() < 0.5) {
        m.ap = 0; Campaign.save();
        toast(`🌊 风暴突至！海路延误，只得原地等候风浪平息（今日行动力已耗尽）`);
      } else {
        const others = CITIES.filter(c => c.id !== m.curCity && c.id !== "tsushima").map(c => c.id);
        const drift = others[randInt(0, others.length - 1)];
        m.curCity = drift; Campaign.save();
        toast(`🌊 风暴突至！船只失控，漂流至意外之地——${cityName(drift)}！`);
      }
      this.render();
    },
    // 组队遭遇战：约 12% 概率触发，与「赶路奇遇」互斥（同次移动只触发其一）。
    // 己方为主角与团队成员，敌方从对方阵营已现身武将中随机抽取相同人数，走组队大战（TeamBattle）结算
    triggerTeamEncounter(m) {
      if (Math.random() >= 0.12) return false;
      const heroSide = RPG.char.side, oppSide = heroSide === "cn" ? "jp" : "cn";
      const hero = RPG.heroGeneral();
      const mates = Bond.teamGenerals().filter(g => g.side === heroSide);
      let oppPool = DB.list.filter(g => g.side === oppSide && m.appeared.includes(g.id));
      if (!oppPool.length) return false;
      shuffle(oppPool);
      const count = Math.min(1 + mates.length, oppPool.length, 10);
      const mine = [hero, ...mates].slice(0, count);
      const theirs = oppPool.slice(0, count);
      toast(`⚔️ 途中遭遇${sideName(oppSide)}游兵，一场遭遇战一触即发！`);
      TeamBattle.begin(mine, heroSide, {
        exact: true, enemies: theirs, rpg: true,
        onDone: (result) => {
          const gold = result.playerWon ? Bond.addGold(20 + result.kills * 4) : Bond.addGold(5);
          if (result.playerWon) Campaign.addFame(6);
          const exp = result.kills * 12 + (result.playerWon ? 40 : 10);
          const c = RPG.char;
          c.exp += exp;
          let lvUp = 0;
          while (c.exp >= RPG.expNeed(c.level)) { c.exp -= RPG.expNeed(c.level); c.level++; c.points += 1; lvUp++; }
          RPG.save();
          const heroAlive = result.mySurvivors.some(g => g.id === -1);
          openOverlay(`<div class="result-card detail-card">
            <h1>⚔️ 遭遇战报</h1>
            <div class="wdesc">${heroAlive ? '全身而退' : '力战倒下（阵中负伤）'}，本场斩获 <b style="color:var(--cn-red)">${result.kills}</b> 员${result.playerWon ? `，一战告捷！名声 <b style="color:var(--cn-red)">+6</b>` : '，惜未能取胜。'}<br>获得经验 <b style="color:var(--cn-red)">+${exp}</b>${Bond.goldLine(gold)}${lvUp ? `<br>🎉 升级 ${lvUp} 级！` : ''}</div>
            <div class="btns"><button class="btn-primary" id="te-close">知道了</button></div>
          </div>`);
          $("#te-close").onclick = () => { closeOverlay(); this.render(); };
        }
      });
      return true;
    },
    // 赶路奇遇：约 30% 概率触发，六选一（含小概率客栈奇遇）
    triggerEncounter(m) {
      if (Math.random() >= 0.3) return;
      const roll = Math.random() * 100;
      if (roll < 30) this.encounterBandit();
      else if (roll < 50) this.encounterTreasure();
      else if (roll < 65) this.encounterCaravan(m);
      else if (roll < 80) this.encounterSage();
      else if (roll < 95) this.encounterGeneral(m);
      else this.encounterInn(m);
    },
    encounterBandit() {
      const heroScore = ratingScore(RPG.heroGeneral());
      const win = Math.random() < Math.max(0.3, Math.min(0.85, 0.5 + (heroScore - 500) / 2000));
      if (win) {
        const gold = Bond.addGold(randInt(20, 50));
        toast(`⚔️ 山贼拦路，一番厮杀后击退！获金 +${gold}`);
      } else {
        toast(`⚔️ 山贼拦路，混战中未能取胜，只得脱身而走。`);
      }
    },
    encounterTreasure() {
      Armory.dropItem();
      toast(`✨ 路遇奇珍，捡到一件神秘宝物（详情请到宝物库鉴宝）！`);
    },
    encounterCaravan(m) {
      m.discountUntilDay = m.day + 1;
      Campaign.save();
      toast(`🛒 遇上行脚商队，集市今明两日折扣八折！`);
    },
    encounterSage() {
      RPG.char.points = (RPG.char.points || 0) + 1;
      RPG.save();
      toast(`🧙 偶遇世外高人，指点一二，获得可分配加点 +1！`);
    },
    encounterGeneral(m) {
      const candidates = DB.list.filter(g => m.appeared.includes(g.id));
      if (!candidates.length) return;
      const g = candidates[randInt(0, candidates.length - 1)];
      const add = randInt(5, 15);
      Bond.addF(g.id, add); Bond.save();
      toast(`🤝 路遇【${g.name}】，攀谈甚欢，友谊 +${add}！`);
    },
    encounterInn(m) {
      m.ap = Math.min(m.apMax + 2, m.ap + 1);
      Campaign.save();
      toast(`🍵 客栈奇遇，店家赠送一碗神仙醋，今日行动力临时 +1！`);
    },
    camp() {
      const m = Campaign.mapState();
      m.day++; m.ap = m.apMax;
      m.marketSold = {};   // 新的一天，各城集市重新上货
      const wandered = this.wanderGenerals(m);
      Campaign.save();
      AudioSystem.sfx.victory();
      // 武将大会、月末边境战、敌营夜袭均会另起弹窗/战斗流程，各自负责后续渲染，故提前返回避免与常规宿营提示叠加
      if (isTournamentDay(m.day) && this.checkTournament(m)) return;
      if (isMonthEnd(m.day) && this.checkBorderWar(m)) return;
      if (this.checkAmbush(m)) return;
      const revealed = Campaign.checkAppearances();
      if (revealed.length) {
        const names = revealed.map(id => { const g = DB.get(id); return g ? g.name : "？"; }).join("、");
        toast(`⚡ 天下快报：${names} 现身天下！（第 ${m.day} 天）`);
      } else if (wandered) {
        toast(`🚶 天下武将行踪有变，${wandered} 位已悄然改换驻地（第 ${m.day} 天）`);
      } else {
        toast(`🏕️ 宿营一夜，行动力已恢复（第 ${m.day} 天）`);
      }
      this.render();
    },
    // 已现身的武将每次宿营有小概率自行迁往同阵营的相邻城池（不含对马岛海路），令天下版图持续流动
    wanderGenerals(m) {
      let count = 0;
      m.appeared.forEach(gid => {
        if (Math.random() >= 0.03) return;
        const g = DB.get(gid), cur = m.assign[gid];
        if (!g || !cur) return;
        const opts = adjCities(cur).filter(id => { const c = cityDef(id); return c && c.side === g.side; });
        if (!opts.length) return;
        m.assign[gid] = opts[randInt(0, opts.length - 1)];
        count++;
      });
      return count;
    },
    // 月末边境阵营大战：owner 不同的相邻城池间，每月最多只爆发一场（随机挑一条边），
    // 双方各出「已现身武将」中随机等量人马（不限本地武将）；若涉及主角所在阵营可选择率团队亲征——
    // 亲征将真正进入阵营大战小游戏（screen-war）观战，而非直接出结果；胜方夺取败方该城；
    // 返回 true 表示已接管本次宿营流程
    checkBorderWar(m) {
      const edges = borderEdges(m).filter(([a, b]) => {
        const poolA = DB.list.filter(g => g.side === cityOwnerSide(m, a) && m.appeared.includes(g.id));
        const poolB = DB.list.filter(g => g.side === cityOwnerSide(m, b) && m.appeared.includes(g.id));
        return poolA.length > 0 && poolB.length > 0;
      });
      if (!edges.length) return false;
      this.openBorderWarPicker(m, edges[randInt(0, edges.length - 1)]);
      return true;
    },
    openBorderWarPicker(m, edge) {
      const [a, b] = edge;
      const heroSide = RPG.char.side;
      const sideA = cityOwnerSide(m, a), sideB = cityOwnerSide(m, b);
      const involved = heroSide === sideA || heroSide === sideB;
      if (!involved) { this.resolveBorderWar(m, edge, false); return; }
      openOverlay(`<div class="result-card detail-card">
        <h1>⚔️ 边境战事</h1>
        <div class="wdesc">边境爆发冲突：<b>${cityName(a)}（${sideName(sideA)}）</b> vs <b>${cityName(b)}（${sideName(sideB)}）</b>，两军以阵营大战方式厮杀，胜方夺取败方城池。</div>
        <div class="btns">
          <button class="btn-primary" id="bw-join">率团队亲征</button>
          <button class="btn-ghost" id="bw-skip">各地驻军自行迎战，不亲征</button>
        </div>
      </div>`);
      $("#bw-join").onclick = () => { closeOverlay(); this.resolveBorderWar(m, edge, true); };
      $("#bw-skip").onclick = () => { closeOverlay(); this.resolveBorderWar(m, edge, false); };
    },
    // 共用：胜方夺城，同时调整双方部署——败方原驻守此城的武将退守至己方相邻城池，
    // 胜方随机挑选若干已现身武将进驻新占领的城池；返回被占领的城池 id
    applyBorderWarOutcome(m, edge, winnerSide) {
      const [a, b] = edge;
      const sideA = cityOwnerSide(m, a);
      const capturedCity = sideA === winnerSide ? b : a;
      const loserSide = winnerSide === "cn" ? "jp" : "cn";
      m.cityOwner[capturedCity] = winnerSide;
      DB.list.filter(g => m.assign[g.id] === capturedCity && g.side === loserSide).forEach(g => {
        const opts = adjCities(capturedCity).filter(id => cityOwnerSide(m, id) === loserSide);
        if (opts.length) m.assign[g.id] = opts[randInt(0, opts.length - 1)];
      });
      const garrisonPool = DB.list.filter(g => g.side === winnerSide && m.appeared.includes(g.id) && m.assign[g.id] !== capturedCity);
      shuffle(garrisonPool);
      garrisonPool.slice(0, randInt(2, 4)).forEach(g => { m.assign[g.id] = capturedCity; });
      Campaign.save();
      return capturedCity;
    },
    resolveBorderWar(m, edge, joining) {
      const [a, b] = edge;
      const sideA = cityOwnerSide(m, a), sideB = cityOwnerSide(m, b);
      const heroSide = RPG.char.side;
      if (!joining) {
        let poolA = DB.list.filter(g => g.side === sideA && m.appeared.includes(g.id)).map(clone);
        let poolB = DB.list.filter(g => g.side === sideB && m.appeared.includes(g.id)).map(clone);
        shuffle(poolA); shuffle(poolB);
        const count = Math.min(poolA.length, poolB.length);
        const rosterA = poolA.slice(0, count).map(g => Armory.geared(g, g.id));
        const rosterB = poolB.slice(0, count).map(g => Armory.geared(g, g.id));
        let ia = 0, ib = 0;
        while (ia < rosterA.length && ib < rosterB.length) {
          const res = autoBattle(rosterA[ia], rosterB[ib]);
          if (res.winner.side === sideA) ib++; else ia++;
        }
        const winnerSide = ib >= rosterB.length ? sideA : sideB;
        const capturedCity = this.applyBorderWarOutcome(m, edge, winnerSide);
        const bonusHtml = winnerSide === heroSide ? `<br>🏆 己方大捷，边境犒赏 <b style="color:#b8860b">+${Bond.addGold(this.BORDER_WAR_WIN_BONUS)}</b> 金（现有 <b style="color:#b8860b">${Bond.gold()}</b>）` : "";
        openOverlay(`<div class="result-card detail-card">
          <h1>⚔️ 边境战报</h1>
          <div class="wdesc">${cityName(a)} vs ${cityName(b)}：<b style="color:var(--cn-red)">${sideName(winnerSide)}</b>获胜，夺取【${cityName(capturedCity)}】${bonusHtml}</div>
          <div class="btns"><button class="btn-primary" id="bw-close">知道了</button></div>
        </div>`);
        $("#bw-close").onclick = () => { closeOverlay(); this.render(); };
        return;
      }
      // 亲征：率主角与同阵营队友，改用组队大战（TeamBattle）模式而非阵营大战——武将选择原则不变
      // （双方均从已现身武将中取，主角与队友必上阵，其余随机补足，双方数量相等），
      // 仅因 TeamBattle 单场最多 10 将上阵，双方数量额外取 min(...,10)（与国战攻城的做法一致）
      const oppSide = heroSide === "cn" ? "jp" : "cn";
      const hero = RPG.heroGeneral();
      const mates = Bond.teamGenerals().filter(g => g.side === heroSide);
      const mateIds = new Set(mates.map(g => g.id));
      let minePool = DB.list.filter(g => g.side === heroSide && m.appeared.includes(g.id) && !mateIds.has(g.id));
      let theirPool = DB.list.filter(g => g.side === oppSide && m.appeared.includes(g.id));
      shuffle(minePool); shuffle(theirPool);
      const count = Math.min(1 + mates.length + minePool.length, theirPool.length, 10);
      const mine = [hero, ...mates, ...minePool].slice(0, count);
      const theirs = theirPool.slice(0, count);
      TeamBattle.begin(mine, heroSide, {
        exact: true, enemies: theirs, rpg: true,
        onDone: (result) => {
          const winnerSide = result.playerWon ? heroSide : oppSide;
          const capturedCity = this.applyBorderWarOutcome(m, edge, winnerSide);
          const c = RPG.char;
          const heroAlive = result.mySurvivors.some(g => g.id === -1);
          const goldGain = result.playerWon ? Bond.addGold(30 + result.kills * 5) : Bond.addGold(10);
          const bonusGold = result.playerWon ? Bond.addGold(this.BORDER_WAR_WIN_BONUS) : 0;
          if (result.playerWon) Campaign.addFame(20);
          const exp = result.kills * 15 + (result.playerWon ? 60 : 15);
          c.exp += exp;
          let lvUp = 0;
          while (c.exp >= RPG.expNeed(c.level)) { c.exp -= RPG.expNeed(c.level); c.level++; c.points += 1; lvUp++; }
          RPG.save();
          const heroHtml = `<div class="mc-sect">🎖️ 你的战果</div>
            <div class="wdesc">${heroAlive ? '全身而退' : '力战倒下（阵中负伤）'}，本方战场斩获 <b style="color:var(--cn-red)">${result.kills}</b> 员${result.playerWon ? `，己方 ${sideName(heroSide)} 全线告捷！夺取【${cityName(capturedCity)}】，名声 <b style="color:var(--cn-red)">+20</b>` : '，惜未能扭转战局。'}<br>获得经验 <b style="color:var(--cn-red)">+${exp}</b>${Bond.goldLine(goldGain)}${bonusGold ? `<br>🏆 边境犒赏 <b style="color:#b8860b">+${bonusGold}</b> 金（现有 <b style="color:#b8860b">${Bond.gold()}</b>）` : ''}${lvUp ? `<br>🎉 升级 ${lvUp} 级！` : ''}</div>`;
          openOverlay(`<div class="result-card detail-card">
            <h1>⚔️ 边境战报</h1>
            <div class="wdesc">${cityName(a)} vs ${cityName(b)}：<b style="color:var(--cn-red)">${sideName(winnerSide)}</b>获胜，夺取【${cityName(capturedCity)}】</div>
            ${heroHtml}
            <div class="btns"><button class="btn-primary" id="bw-close">返回天下地图</button></div>
          </div>`);
          $("#bw-close").onclick = () => { closeOverlay(); this.render(); showScreen("map"); };
        },
      });
    },
    // 宿营夜袭：若当前城池本地武将中有敌方阵营成员，有 15% 概率被其中一人偷袭，
    // 复用与「刺杀」完全相同的结算通道（m.activeAssassin）——主角获胜则对方六维受创，落败则己方受创
    checkAmbush(m) {
      const enemies = DB.list.filter(g => m.assign[g.id] === m.curCity && m.appeared.includes(g.id) && g.side !== RPG.char.side);
      if (!enemies.length || Math.random() >= 0.15) return false;
      const attacker = enemies[randInt(0, enemies.length - 1)];
      openOverlay(`<div class="result-card">
        <h1>🗡️ 夜袭！</h1>
        <div class="winner-av" style="background:${attacker.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)'}">${avatarChar(attacker.name)}</div>
        <div class="wname">${attacker.name}</div>
        <div class="wdesc">敌方武将潜入营帐，欲取你性命！唯有应战。</div>
        <div class="btns"><button class="btn-primary" id="ambush-fight">应战</button></div>
      </div>`);
      $("#ambush-fight").onclick = () => {
        closeOverlay();
        m.activeAssassin = attacker.id; Campaign.save();
        startClassicBattle(RPG.heroGeneral(), attacker, false, true);
      };
      return true;
    },
    // 武将大会（季度武将世界杯）：询问主角是否报名（较高报名费，杀入四强全额退还）；
    // 无论主角是否参加，其余 31 席都从已现身武将中随机抽取（不含主角，不足 32 人以「轮空」占位替补，
    // 队友与其他已现身武将一视同仁、独立参赛），冠亚军照常产生并发放奖励
    checkTournament(m) {
      const pool = DB.list.filter(g => m.appeared.includes(g.id));
      if (!pool.length) return false;
      const fee = Math.round(ratingScore(RPG.heroGeneral()) * 2);
      openOverlay(`<div class="result-card detail-card">
        <h1>🏆 武将大会</h1>
        <div class="wdesc">四方豪杰云集，本季武将大会即将开幕（32 强淘汰赛）。是否报名参加？报名费 <b style="color:var(--cn-red)">${fee}</b> 金（现有 💰${Bond.gold()}），若能杀入四强将全额退还。</div>
        <div class="btns">
          <button class="btn-primary" id="tn-join" ${Bond.gold() < fee ? "disabled" : ""}>报名参加</button>
          <button class="btn-ghost" id="tn-skip">不参加，静观其变</button>
        </div>
      </div>`);
      $("#tn-join").onclick = () => { closeOverlay(); this.runTournament(m, pool, true); };
      $("#tn-skip").onclick = () => { closeOverlay(); this.runTournament(m, pool, false); };
      return true;
    },
    // 生成「轮空」占位武将：仅在已现身武将不足 32 人时用于补满赛程，几乎必败
    byeFighter(i) {
      return { id: -3000 - i, name: "轮空", title: "", intro: "", side: "cn", ti: 10, wu: 10, tong: 10, zhi: 10, zheng: 10, mei: 10 };
    },
    runTournament(m, pool, joining) {
      let others = pool.slice(); shuffle(others);
      others = others.slice(0, joining ? 31 : 32);
      let i = 0;
      while (others.length < (joining ? 31 : 32)) others.push(this.byeFighter(i++));
      if (!joining) {
        const { champion, runnerUp } = Tournament.simulate(others);
        const champTxt = this.applyTournamentPrize(m, champion, 3, true);
        const runnerTxt = this.applyTournamentPrize(m, runnerUp, 1, false);
        toast(`🏆 本届武将大会：${champion.name} 夺冠，${runnerUp.name} 屈居亚军（你未参加）`);
        this.render();
        return;
      }
      const fee = Math.round(ratingScore(RPG.heroGeneral()) * 2);
      Bond.spend(fee);
      const parts = [RPG.heroGeneral(), ...others];
      Tournament.size = 32;   // 武将大会固定 32 强，避免沿用小游戏自由试玩时残留的规模设置
      Tournament.rpgMode = true;
      Tournament.onDone = () => {
        const champion = Tournament.champion;
        const finalMatch = Tournament.koRounds[Tournament.koRounds.length - 1].matches[0];
        const runnerUp = finalMatch.winner.id === finalMatch.a.id ? finalMatch.b : finalMatch.a;
        const placement = Tournament.heroPlacement();
        const reachedTop4 = !!placement && /夺冠|决赛|半决赛/.test(placement.label);
        let feeHtml = "";
        if (reachedTop4) { Bond.addGold(fee); feeHtml = `<br>杀入四强，报名费 <b style="color:var(--cn-red)">${fee}</b> 金全额退还！`; }
        const champHtml = this.applyTournamentPrize(m, champion, 3, true);
        const runnerHtml = this.applyTournamentPrize(m, runnerUp, 1, false);
        openOverlay(`<div class="result-card detail-card">
          <h1>🏆 武将大会战报</h1>
          <div class="wdesc">冠军：<b style="color:var(--cn-red)">${champion.name}</b>${champion.id === -1 ? '（你）' : ''}　亚军：<b>${runnerUp.name}</b>${runnerUp.id === -1 ? '（你）' : ''}${feeHtml}</div>
          <div class="wdesc">${champHtml}</div>
          <div class="wdesc">${runnerHtml}</div>
          <div class="btns"><button class="btn-primary" id="tn-close">返回天下地图</button></div>
        </div>`);
        $("#tn-close").onclick = () => { closeOverlay(); this.render(); showScreen("map"); };
      };
      Tournament.begin(parts);
    },
    applyTournamentPrize(m, general, statAmt, isChampion) {
      const isHero = general.id === -1;
      let html;
      if (isHero) {
        const { dimLabel, add } = this.grantHeroStatGrowth(statAmt);
        html = `${isChampion ? '🏆 夺冠' : '🥈 亚军'}！你的${dimLabel} <b style="color:var(--cn-red)">+${add}</b>`;
      } else {
        const dimLabel = this.grantNpcStatGrowth(m, general.id, statAmt);
        html = `${isChampion ? '🏆 夺冠' : '🥈 亚军'}：${general.name} 的${dimLabel} <b style="color:var(--cn-red)">+${statAmt}</b>（战役内生效）`;
      }
      if (isChampion) html += `<br>${this.grantChampionTreasure(m, general)}`;
      return html;
    },
    // 主角六维随机一项 +amt（已达 110 上限的维度不会被抽中，除非全部已封顶）
    grantHeroStatGrowth(amt) {
      const c = RPG.char;
      const eligible = DIMS.filter(([k]) => RPG.eff(c, k) < 110);
      const pool = eligible.length ? eligible : DIMS;
      const dim = pool[randInt(0, pool.length - 1)];
      const room = Math.max(0, 110 - RPG.eff(c, dim[0]));
      const add = Math.min(amt, room) || 0;
      c.alloc[dim[0]] = (c.alloc[dim[0]] || 0) + add;
      RPG.save();
      return { dimLabel: dim[1], add };
    },
    // 非主角武将六维随机一项 +amt，写入战役内 Campaign.mapState().statGrowth（与 statPenalty 同键、符号相反的独立字段），
    // 由 Armory.geared() 叠加展示，不写回武将图鉴全局数值
    grantNpcStatGrowth(m, gid, amt) {
      const dim = DIMS[randInt(0, DIMS.length - 1)];
      if (!m.statGrowth) m.statGrowth = {};
      if (!m.statGrowth[gid]) m.statGrowth[gid] = { ti: 0, wu: 0, tong: 0, zhi: 0, zheng: 0, mei: 0 };
      m.statGrowth[gid][dim[0]] += amt;
      Campaign.save();
      return dim[1];
    },
    // 冠军额外获得一件传说级宝物：主角冠军直接收入宝物库（未鉴定）；非主角冠军与其当前同类型装备比较，
    // 更好则直接换装，更差（含平局，如双方皆为传说级）则改发一次六维 +3（与上方的冠军基础奖励各自独立叠加）
    grantChampionTreasure(m, champion) {
      if (champion.id === -1) {
        const item = Armory.guaranteedItem("legend");
        return `另获得传说级宝物【${item.name}】，已放入宝物库（未鉴定）。`;
      }
      const typeK = Armory.TYPES[randInt(0, Armory.TYPES.length - 1)].k;
      const newItem = Armory.makeItem(typeK, "legend");
      const oldItem = Armory.itemsOf(champion.id).find(i => i.type === typeK);
      const order = Armory.RARITIES.map(r => r.k);
      const better = !oldItem || order.indexOf(newItem.rarity) > order.indexOf(oldItem.rarity) ||
        (newItem.rarity === oldItem.rarity && newItem.bonus > oldItem.bonus);
      if (better) {
        if (oldItem) oldItem.equippedBy = null;
        newItem.equippedBy = champion.id;
        Armory.data.items.push(newItem); Armory.save();
        return `喜获传说级宝物【${newItem.name}】，已为其换装！`;
      }
      const dimLabel = this.grantNpcStatGrowth(m, champion.id, 3);
      return `所获传说级宝物不及其现有装备，改赠${dimLabel} <b style="color:var(--cn-red)">+3</b>。`;
    },
  };

  /* ============================================================
   *  全部武将（战役内已现身名录）：与武将图鉴同一 db-table 风格的只读表格，
   *  不含新增/编辑/删除；六维与评分按 Armory.geared() 叠加当前装备的实时数值，
   *  另加友谊值与当前所在城池两列
   * ============================================================ */
  const AllGenUI = {
    side: "all",
    sort: { key: "bond", dir: -1 },   // 默认按友谊从高到低
    open() {
      this.side = "all";
      $$(".side-tab[data-agside]").forEach(t => t.classList.toggle("active", t.dataset.agside === "all"));
      const kw = $("#allgen-search"); if (kw) kw.value = "";
      this.render();
      showScreen("allgen");
    },
    setSide(side) {
      this.side = side;
      $$(".side-tab[data-agside]").forEach(t => t.classList.toggle("active", t.dataset.agside === side));
      this.render();
    },
    sortBy(key) {
      if (this.sort.key === key) this.sort.dir *= -1;
      else this.sort = { key, dir: key === "name" || key === "city" ? 1 : -1 };
      this.render();
    },
    render() {
      const m = Campaign.mapState();
      const list = $("#allgen-list");
      if (!m) { list.innerHTML = '<div class="empty">尚未开局</div>'; return; }
      const kw = ($("#allgen-search") && $("#allgen-search").value.trim()) || "";
      let arr = DB.list.filter(g => m.appeared.includes(g.id));
      if (this.side !== "all") arr = arr.filter(g => g.side === this.side);
      if (kw) arr = arr.filter(g => g.name.includes(kw) || (g.title || "").includes(kw));
      const rows = arr.map(g => ({ g, hg: Armory.geared(g, g.id) }));
      const { key, dir } = this.sort;
      rows.sort((a, b) => {
        if (key === "name") return a.g.name.localeCompare(b.g.name, "zh") * dir;
        if (key === "city") return cityName(m.assign[a.g.id]).localeCompare(cityName(m.assign[b.g.id]), "zh") * dir;
        let va, vb;
        if (key === "rating") { va = ratingScore(a.hg); vb = ratingScore(b.hg); }
        else if (key === "bond") { va = Bond.pts(a.g.id); vb = Bond.pts(b.g.id); }
        else { va = a.hg[key]; vb = b.hg[key]; }
        return (va - vb) * dir;
      });
      const arrow = k => key === k ? (dir > 0 ? " ▲" : " ▼") : "";
      const th = (k, label) => `<th data-sort="${k}" class="${key === k ? 'sorted' : ''}">${label}${arrow(k)}</th>`;
      const head = `<tr>${th("name", "姓名")}${DIMS.map(([k, l]) => th(k, l[0])).join("")}${th("rating", "评分")}<th>评级</th>${th("bond", "友谊")}${th("city", "所在城")}</tr>`;
      const body = rows.map(({ g, hg }) => {
        const cells = DIMS.map(([k]) => `<td class="num gt-${rateLetter(hg[k])}">${hg[k]}</td>`).join("");
        return `<tr data-id="${g.id}">
          <td class="dt-name ${g.side}"><span class="dt-dot"></span>${g.name}</td>
          ${cells}
          <td class="dt-total">${ratingScore(hg)}</td>
          <td class="dt-grade">${ratingChip(hg)}</td>
          <td class="num">${Bond.pts(g.id)}</td>
          <td class="allgen-city">${cityName(m.assign[g.id])}</td>
        </tr>`;
      }).join("");
      list.innerHTML = rows.length
        ? `<table class="db-table"><thead>${head}</thead><tbody>${body}</tbody></table>`
        : `<div class="empty">未找到符合条件的已现身武将</div>`;
      $$("#allgen-list th[data-sort]").forEach(h => h.onclick = () => this.sortBy(h.dataset.sort));
      $$("#allgen-list tbody tr").forEach(tr => {
        tr.onclick = () => { const g = DB.get(+tr.dataset.id); if (g) showDetail(g, { readonly: true }); };
      });
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
      // 武将图鉴为全局设定集，只展示默认六维，不显示友谊/装备等游戏进度数据
      const head = `<tr>${th("name", "姓名")}${DIMS.map(([k, l]) => th(k, l[0])).join("")}${th("rating", "评分")}<th>评级</th><th>操作</th></tr>`;
      const body = arr.map(g => {
        const cells = DIMS.map(([k]) => `<td class="num gt-${rateLetter(g[k])}">${g[k]}</td>`).join("");
        return `<tr data-id="${g.id}">
          <td class="dt-name ${g.side}"><span class="dt-dot"></span>${g.name}</td>
          ${cells}
          <td class="dt-total">${ratingScore(g)}</td>
          <td class="dt-grade">${ratingChip(g)}</td>
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
          if (act === "view") showDetail(DB.get(id), { global: true });
          else if (act === "edit") this.edit(DB.get(id));
          else if (act === "del") { if (confirm(`确定删除「${DB.get(id).name}」？`)) { DB.remove(id); this.render(); toast("已删除"); } }
        });
        $(".dt-name", tr).onclick = () => showDetail(DB.get(id), { global: true });
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
   *  宝物库界面：仓库 / 图鉴 / 商店 / 锻造
   * ============================================================ */
  function ownerName(owner) {
    if (owner === "hero") return (RPG.char && RPG.char.name) || "主角";
    const g = DB.get(owner); return g ? g.name : "？";
  }
  // 装备/赠送发生变化后，若武将图鉴列表或天下地图当前正显示在背后，立刻重绘使其反映最新数据
  function refreshDBIfActive() {
    if ($("#screen-db").classList.contains("active")) DBUI.render();
    if ($("#screen-map").classList.contains("active")) MapUI.render();
  }
  // 属性/效果的中文标签与单位：六维走 DIMS，奇珍的特殊效果走 Armory.CURIO_EFFECTS
  function statLabel(key) {
    const d = DIMS.find(([k]) => k === key);
    if (d) return d[1];
    const e = Armory.CURIO_EFFECTS[key];
    return e ? e.label : key;
  }
  function statUnit(key) {
    const e = Armory.CURIO_EFFECTS[key];
    return e ? e.unit : "";
  }
  // 某模板在四档稀有度下的属性标签与加成区间（自建/覆盖过的模板优先使用其自定义加成值）
  function armoryStatRange(type, t) {
    if (type.k === "curio") {
      const eff = t.effect || "ti";
      const vals = t.bonusOverride || Armory.curioVals(eff);
      return { statLbl: statLabel(eff), lo: vals[0], hi: vals[vals.length - 1], unit: statUnit(eff) };
    }
    const statK = type.k === "book" ? (t.stat || "zhi") : type.stat;
    const vals = t.bonusOverride || Armory.RARITIES.map(r => r.bonus);
    return { statLbl: statLabel(statK), lo: vals[0], hi: vals[vals.length - 1], unit: "" };
  }
  function itemCard(item) {
    if (item.identified === false) {
      return `<div class="item-card mystery">
        <div class="ic-top"><span class="ic-icon">❔</span><span class="ic-name">神秘宝物</span></div>
        <div class="ic-intro">来历不明，鉴宝方能知晓其真身与效用，才可装备或拆解。</div>
        <button class="ic-identify" data-uid="${item.uid}">🔍 鉴宝（${Armory.IDENTIFY_COST} 金）</button>
      </div>`;
    }
    const rar = Armory.rarityDef(item.rarity);
    const ownerTag = item.equippedBy != null ? `<div class="ic-owner">佩戴中：${ownerName(item.equippedBy)}</div>` : "";
    return `<div class="item-card" style="--rar-color:${rar.color}">
      <div class="ic-top"><span class="ic-icon">${item.icon}</span><span class="ic-name">${item.name}</span><span class="ic-rar" style="color:${rar.color}">${rar.n}</span></div>
      <div class="ic-stat">${statLabel(item.stat)} +${item.bonus}${statUnit(item.stat)}</div>
      <div class="ic-intro">${item.intro}</div>
      ${ownerTag}
      ${!item.equippedBy ? `<div class="ic-btn-row">
        <button class="ic-dismantle" data-uid="${item.uid}">拆解</button>
        <button class="ic-sell" data-uid="${item.uid}">出售（${Math.round(Armory.shopPrice(item.rarity) * Armory.SELL_FACTOR)}金）</button>
      </div>` : ""}
    </div>`;
  }
  // 装备槽位（供角色扮演主页/主角 与 武将详情/史实武将 共用）；未鉴定的宝物不会出现在此。
  // compact=true 时用于武将详情页：五槽紧凑排成一行，仅显示图标与加成数值，长按/点击后在
  // 弹窗中看到全名；owner 为 "hero" 时永远走普通装备逻辑，owner 为具体武将id时选择宝物即视为赠送。
  function eqSlotsHtml(owner, compact) {
    return Armory.TYPES.map(type => {
      const item = Armory.itemsOf(owner).find(i => i.type === type.k && i.identified !== false);
      if (compact) {
        const title = item ? `${item.name} +${item.bonus}${statUnit(item.stat)} ${statLabel(item.stat)}` : `${type.n}（空）`;
        return `<div class="eq-slot compact" data-type="${type.k}" data-owner="${owner}" title="${title}">
          <span class="eq-icon">${type.icon}</span>
          ${item ? `<span class="eq-mini" style="color:${Armory.rarityDef(item.rarity).color}">+${item.bonus}${statUnit(item.stat)}</span>` : `<span class="eq-mini dim">空</span>`}
        </div>`;
      }
      return `<div class="eq-slot" data-type="${type.k}" data-owner="${owner}">
        <span class="eq-icon">${type.icon}</span>
        <span class="eq-body">${item ? `<b style="color:${Armory.rarityDef(item.rarity).color}">${item.name}</b><small>+${item.bonus}${statUnit(item.stat)} ${statLabel(item.stat)}</small>` : `<small>空</small>`}</span>
      </div>`;
    }).join("");
  }
  function bindEqSlots(onDone) {
    // data-owner 属性经 HTML 序列化后恒为字符串，队友的 owner 需还原为数字才能与 g.id 等武将id正确比对
    $$(".eq-slot").forEach(el => el.onclick = () => openEquipPicker(el.dataset.owner === "hero" ? "hero" : +el.dataset.owner, el.dataset.type, onDone));
  }
  function openEquipPicker(owner, typeK, onDone) {
    const type = Armory.typeDef(typeK);
    const cur = Armory.itemsOf(owner).find(i => i.type === typeK);
    const options = Armory.availableFor(owner, typeK);
    const isGift = owner !== "hero";   // 为任意史实武将选择宝物即视为赠送
    openOverlay(`<div class="result-card">
      <h1>${type.icon} 选择${type.n}</h1>
      ${isGift ? `<div class="wdesc">为其佩戴的宝物首次赠出时计入友谊；日后换回同一件不会重复计。</div>` : ""}
      <div class="buff-list">
        ${options.map(it => `<button class="buff-btn eq-opt ${cur && cur.uid === it.uid ? 'active' : ''}" data-uid="${it.uid}">
          <span class="bi">${it.icon}</span><span class="bt"><b style="color:${Armory.rarityDef(it.rarity).color}">${it.name}</b><small>${Armory.rarityDef(it.rarity).n} · +${it.bonus}${statUnit(it.stat)} ${statLabel(it.stat)}${it.equippedBy && it.equippedBy !== owner ? `（原佩戴于 ${ownerName(it.equippedBy)}）` : ''}${isGift ? ` · 友谊 +${Bond.GIFT_FRIEND[it.rarity]}${(Bond.data.gifted[owner] || []).includes(it.uid) ? '（已赠过，不重复计）' : ''}` : ''}</small></span></button>`).join("") || '<div class="empty">尚无该类可用宝物（未鉴定的宝物请先到「宝物库」鉴宝）</div>'}
        ${cur && !isGift ? `<button class="buff-btn" id="eq-unequip"><span class="bi">✕</span><span class="bt"><b>卸下</b></span></button>` : ""}
      </div>
      <div class="btns"><button class="btn-ghost" id="eq-cancel">取消</button></div></div>`);
    $$(".eq-opt").forEach(b => b.onclick = () => {
      const uid = +b.dataset.uid;
      const item = Armory.data.items.find(i => i.uid === uid);
      Armory.equip(uid, owner);
      if (isGift && item) {
        const add = Bond.maybeGiftFriend(owner, item);
        if (add > 0) toast(`🎁 赠 ${ownerName(owner)}【${item.name}】，友谊 +${add}`);
      }
      refreshDBIfActive();
      closeOverlay(); if (onDone) onDone();
    });
    const un = $("#eq-unequip"); if (un) un.onclick = () => { Armory.unequip(cur.uid); refreshDBIfActive(); closeOverlay(); if (onDone) onDone(); };
    // 取消：不改变任何装备，回到刚才的武将信息，而非直接关闭整个弹窗
    $("#eq-cancel").onclick = () => { closeOverlay(); if (onDone) onDone(); };
  }

  const ArmoryUI = {
    tab: "stock",
    open(tab) { if (tab) this.tab = tab; this.render(); showScreen("armory"); },
    setTab(t) {
      this.tab = t;
      $$(".armory-tab").forEach(el => el.classList.toggle("active", el.dataset.atab === t));
      this.render();
    },
    render() {
      $$(".armory-tab").forEach(el => el.classList.toggle("active", el.dataset.atab === this.tab));
      const C = $("#armory-content");
      C.innerHTML = this.tab === "stock" ? this.renderStock()
        : this.tab === "dex" ? this.renderDex()
        : this.tab === "shop" ? this.renderShop()
        : this.renderForge();
      this.bind();
    },
    renderStock() {
      const items = Armory.data.items.slice();
      const rarIdx = k => Armory.RARITIES.findIndex(r => r.k === k);
      // 待鉴定的神秘宝物不按其（尚未揭示的）稀有度参与排序，固定排在已鉴定宝物之后，避免用位置泄露信息
      items.sort((a, b) => {
        const au = a.identified === false, bu = b.identified === false;
        if (au !== bu) return au ? 1 : -1;
        if (au && bu) return 0;
        return rarIdx(b.rarity) - rarIdx(a.rarity);
      });
      if (!items.length) return `<div class="empty">尚未获得任何宝物——去战场上搏一件吧</div>`;
      return `<div class="section-hint">各玩法获胜后有机会掉落，但掉落的宝物为「未鉴定」状态，需花金鉴宝才能查看细节、装备与拆解；已装备的宝物请先在「角色扮演」或武将详情中卸下，才能在此拆解。</div>
        <div class="item-grid">${items.map(itemCard).join("")}</div>`;
    },
    renderDex() {
      const total = Armory.TYPES.reduce((s, type) => s + Armory.pool(type.k).length, 0);
      let html = `<div class="section-hint">已发现 <b>${Armory.data.discovered.length}</b> / ${total} 件 · 前往首页「宝物阁」可查看/编辑/自建全部宝物</div>`;
      Armory.TYPES.forEach(type => {
        html += `<div class="dex-group"><div class="dex-group-title">${type.icon} ${type.n}</div><div class="dex-grid">`;
        html += Armory.pool(type.k).map(t => {
          const found = Armory.data.discovered.includes(t.n);
          if (!found) return `<div class="dex-card locked"><div class="ic-icon">？</div><div class="ic-name">未发现</div></div>`;
          const { statLbl, lo, hi, unit } = armoryStatRange(type, t);
          return `<div class="dex-card found"><div class="ic-icon">${type.icon}</div><div class="ic-name">${t.n}</div><div class="ic-stat">${statLbl} +${lo}~+${hi}${unit}</div><div class="ic-intro">${t.intro}</div></div>`;
        }).join("");
        html += `</div></div>`;
      });
      return html;
    },
    renderShop() {
      const shop = Armory.data.shop;
      const discount = shopDiscountActive();
      let html = `<div class="section-hint">💰 金币 <b>${Bond.gold()}</b> ｜ 每日自动刷新一次，也可主动花金重刷${discount ? ' ｜ 🛒 折扣生效中，全场八折！' : ''}</div>
        <div class="shop-actions"><button class="cup-go" id="shop-refresh">🔄 花 ${Armory.REFRESH_COST} 金重刷</button></div>
        <div class="item-grid">`;
      html += (shop.length ? shop.map((s, idx) => {
        const type = Armory.typeDef(s.type), rar = Armory.rarityDef(s.rarity), price = Armory.shopPrice(s.rarity, discount);
        return `<div class="item-card" style="--rar-color:${rar.color}">
          <div class="ic-top"><span class="ic-icon">${type.icon}</span><span class="ic-name">${s.tmpl.n}</span><span class="ic-rar" style="color:${rar.color}">${rar.n}</span></div>
          <div class="ic-intro">${s.tmpl.intro}</div>
          <button class="ic-buy" data-idx="${idx}">💰 ${price} 金购买${discount ? '<small> (八折)</small>' : ''}</button>
        </div>`;
      }).join("") : `<div class="empty">今日货架已空，明日再来</div>`);
      html += `</div>`;
      return html;
    },
    renderForge() {
      let html = `<div class="section-hint">💰 金币 <b>${Bond.gold()}</b>｜消耗对应材料 + 金币锻造一件随机宝物；连续 ${Armory.FORGE_PITY} 次未出稀有以上，下一次必出稀有以上</div>
        <div class="forge-grid">`;
      html += Armory.TYPES.map(type => {
        const mat = Armory.data.materials[type.k] || 0, pity = Armory.data.pity[type.k] || 0;
        return `<div class="forge-card">
          <div class="ic-top"><span class="ic-icon">${type.icon}</span><span class="ic-name">${type.n}</span></div>
          <div class="forge-mat">材料 <b>${mat}</b> / ${Armory.FORGE_COST}</div>
          <div class="forge-pity">保底进度 ${pity} / ${Armory.FORGE_PITY}</div>
          <button class="forge-btn" data-type="${type.k}" ${mat < Armory.FORGE_COST ? "disabled" : ""}>⚒ 锻造（${Armory.FORGE_GOLD}金）</button>
        </div>`;
      }).join("");
      html += `</div><div class="section-hint">分解未装备的宝物可获得对应类型材料（普通1／精良2／稀有3／传说5），请到「仓库」页签操作。</div>`;
      return html;
    },
    bind() {
      $$(".ic-dismantle").forEach(b => b.onclick = () => {
        const item = Armory.data.items.find(i => i.uid === +b.dataset.uid);
        if (item && confirm(`确定拆解「${item.name}」？将永久失去此宝物，换取材料。`)) { Armory.dismantle(item.uid); this.render(); }
      });
      $$(".ic-sell").forEach(b => b.onclick = () => {
        const item = Armory.data.items.find(i => i.uid === +b.dataset.uid);
        if (item && confirm(`确定出售「${item.name}」？将永久失去此宝物，换取金币（宝物会回流集市）。`)) { Armory.sellItem(item.uid); this.render(); }
      });
      $$(".ic-identify").forEach(b => b.onclick = () => { if (Armory.identify(+b.dataset.uid)) this.render(); });
      const rf = $("#shop-refresh"); if (rf) rf.onclick = () => { if (Armory.refreshShop(true)) this.render(); };
      $$(".ic-buy").forEach(b => b.onclick = () => { if (Armory.buyShop(+b.dataset.idx)) this.render(); });
      $$(".forge-btn").forEach(b => b.onclick = () => { if (Armory.forge(b.dataset.type)) this.render(); });
    },
  };

  /* ============================================================
   *  宝物阁（首页全局入口）：全部宝物一览，不受游戏进度影响；可编辑属性/加成、可自建/删除
   * ============================================================ */
  const VaultUI = {
    open() { this.render(); showScreen("vault"); },
    render() {
      const C = $("#vault-content");
      let html = `<div class="section-hint">全部宝物一览，不受游戏进度影响；可编辑名称/简介/属性/加成值（限幅 ≤15），也可自建新宝物</div>`;
      Armory.TYPES.forEach(type => {
        html += `<div class="dex-group"><div class="dex-group-title">${type.icon} ${type.n}
          <button class="vault-add" data-type="${type.k}">＋ 自建${type.n}</button></div><div class="dex-grid">`;
        html += Armory.pool(type.k).map(t => {
          const { statLbl, lo, hi, unit } = armoryStatRange(type, t);
          const overridden = !t._custom && Armory.overrides[t._key];
          return `<div class="dex-card found vault-card">
            <div class="ic-icon">${type.icon}</div>
            <div class="ic-name">${t.n}${t._custom ? ' <i class="vault-tag">自建</i>' : overridden ? ' <i class="vault-tag">已改</i>' : ''}</div>
            <div class="ic-stat">${statLbl} +${lo}~+${hi}${unit}</div>
            <div class="ic-intro">${t.intro}</div>
            <div class="vault-actions">
              <button class="vault-edit" data-key="${t._key}">✏️ 编辑</button>
              ${overridden ? `<button class="vault-reset" data-key="${t._key}">↺ 重置</button>` : ""}
              ${t._custom ? `<button class="vault-del" data-key="${t._key}">🗑 删除</button>` : ""}
            </div>
          </div>`;
        }).join("");
        html += `</div></div>`;
      });
      C.innerHTML = html;
      this.bind();
    },
    bind() {
      $$(".vault-add").forEach(b => b.onclick = () => this.editForm(b.dataset.type, null));
      $$(".vault-edit").forEach(b => b.onclick = () => { const key = b.dataset.key; this.editForm(key.split("|")[0], key); });
      $$(".vault-reset").forEach(b => b.onclick = () => { if (confirm("重置为默认设定？")) { Armory.clearOverride(b.dataset.key); this.render(); } });
      $$(".vault-del").forEach(b => b.onclick = () => {
        const t = Armory.templateByKey(b.dataset.key);
        if (t && confirm(`确定删除自建宝物「${t.n}」？`)) { Armory.removeCustomTemplate(t.uid); this.render(); }
      });
    },
    editForm(typeK, key) {
      const type = Armory.typeDef(typeK);
      const t = key ? Armory.templateByKey(key) : null;
      const isNew = !t;
      const rarities = Armory.RARITIES;
      const curBonus = t ? (t.bonusOverride || (typeK === "curio" ? Armory.curioVals(t.effect || "ti") : rarities.map(r => r.bonus))) : rarities.map(r => r.bonus);
      const statField = typeK === "book"
        ? `<div><label>属性</label><select id="vf-stat">
            <option value="zhi" ${(!t || t.stat !== 'zheng') ? 'selected' : ''}>智力</option>
            <option value="zheng" ${(t && t.stat === 'zheng') ? 'selected' : ''}>政治</option></select></div>`
        : typeK === "curio"
        ? `<div><label>特殊效果</label><select id="vf-effect">
            ${Object.entries(Armory.CURIO_EFFECTS).map(([k, e]) => `<option value="${k}" ${(t ? (t.effect || 'ti') === k : k === 'ti') ? 'selected' : ''}>${e.label}</option>`).join("")}
            </select></div>`
        : `<div><label>属性</label><input value="${statLabel(type.stat)}" disabled></div>`;
      openOverlay(`<div class="result-card detail-card">
        <h1 style="font-size:22px">${isNew ? '自建' + type.n : '编辑' + type.n}</h1>
        <div class="form-grid" style="margin-top:14px">
          <div class="full"><label>名称</label><input id="vf-name" value="${t ? t.n : ''}"></div>
          <div class="full"><label>简介</label><textarea id="vf-intro">${t ? t.intro : ''}</textarea></div>
          ${statField}
        </div>
        <div class="vault-bonus-grid">
          ${rarities.map((r, i) => `<div class="vf-bonus"><label style="color:${r.color}">${r.n}</label><input id="vf-bonus-${i}" type="number" min="1" max="15" value="${curBonus[i]}"></div>`).join("")}
        </div>
        <div class="section-hint">加成值范围 1~15</div>
        <div class="btns" style="margin-top:16px">
          <button class="btn-primary" id="vf-save">保存</button>
          <button class="btn-ghost" id="vf-cancel">取消</button>
        </div></div>`);
      $("#vf-cancel").onclick = closeOverlay;
      $("#vf-save").onclick = () => {
        const name = $("#vf-name").value.trim();
        if (!name) { toast("请填写名称"); return; }
        const intro = $("#vf-intro").value.trim();
        const bonusOverride = Armory.clampBonusArr(rarities.map((_, i) => $(`#vf-bonus-${i}`).value));
        const patch = { n: name, intro, bonusOverride };
        if (typeK === "book") patch.stat = $("#vf-stat").value;
        if (typeK === "curio") patch.effect = $("#vf-effect").value;
        if (isNew) {
          Armory.addCustomTemplate(Object.assign({ type: typeK }, patch));
          toast(`已新建宝物「${name}」`);
        } else if (t._custom) {
          const idx = Armory.custom.findIndex(c => c.uid === t.uid);
          if (idx >= 0) Armory.custom[idx] = Object.assign({}, Armory.custom[idx], patch);
          Armory.saveGlobal();
          toast(`已保存「${name}」`);
        } else {
          Armory.setOverride(t._key, patch);
          toast(`已保存「${name}」`);
        }
        closeOverlay(); this.render();
      };
    },
  };

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
    Armory.load();
    Armory.loadGlobal();
    Campaign.load();
    $("#app-ver").textContent = APP_VERSION;
    RPG.load();   // 提前载入角色：友谊/金币的累计以其存在为前提
    syncHomeButtons();

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
      else if (go === "armory") ArmoryUI.open();
      else if (go === "db") DBUI.open();
      else if (go === "vault") VaultUI.open();
      else if (go === "minigames") showScreen("minigames");
      else if (go === "onboard") Onboard.open();
      else if (go === "continue") { if (RPG.char) MapUI.open(); }
    });
    $$(".armory-tab").forEach(t => t.onclick = () => ArmoryUI.setTab(t.dataset.atab));

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

    // 返回（点击左上角箭头）：与硬件/浏览器返回键（见下方 popstate 监听）共用同一套 handleBackAction 逻辑
    $$("[data-back]").forEach(b => b.onclick = handleBackAction);
    // 手机系统/浏览器返回键同步：弹窗打开时优先关闭弹窗（不消耗画面层级，随即补回一条历史记录）；
    // 否则与左上角返回箭头走同一套逻辑（backNavActive 置位期间 showScreen 不再重复 push，避免历史栈越返越深）
    window.addEventListener("popstate", () => {
      if (overlay.classList.contains("show")) {
        closeOverlay();
        history.pushState({ t: Date.now() }, "", "");
        return;
      }
      backNavActive = true;
      handleBackAction();
      backNavActive = false;
    });

    // 选将
    $$(".side-tab[data-side]").forEach(t => t.onclick = () => SelectUI.setSide(t.dataset.side));
    $("#select-search").oninput = () => SelectUI.render();
    $("#select-confirm").onclick = () => SelectUI.confirm();
    $("#select-random").onclick = () => SelectUI.randomPick();

    // 阵营战
    $("#war-start").onclick = () => { if (War.pendingHero && !spendAP()) return; War.start(War.pendingHero); };
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

    // 全部武将（战役内已现身名录）
    $$(".side-tab[data-agside]").forEach(t => t.onclick = () => AllGenUI.setSide(t.dataset.agside));
    $("#allgen-search").oninput = () => AllGenUI.render();

    bindAudio();
    syncAudioBtns();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
