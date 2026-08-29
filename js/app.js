/* ============================================================
 *  中日武将大单挑 — 主程序 / UI 控制
 * ============================================================ */
(() => {
  "use strict";

  const APP_VERSION = "202608290814";   // 发版时的 UTC+8 时间戳（YYYYMMDD+HHMM），与 sw.js 缓存版本同步生成
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
    // 任何武将库变动都可能改动主公姓名/增删主公其人，故在此唯一的落盘出口统一清空主公姓名解析缓存
    save() { localStorage.setItem(DB_KEY, JSON.stringify(this.list)); if (typeof clearLordCache === "function") clearLordCache(); },
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
  // 士气条改用独立配色（蓝紫调），与兵力条的绿黄红分开——两条本就代表不同数值，长度自然不同，
  // 用不同色相直观提醒这是两码事，避免被误读成"同一种条却粗细/长度不一致"的样式 bug
  function moraleColor(ratio) { return ratio > 0.5 ? "#4fc3f7" : ratio > 0.22 ? "#7e57c2" : "#5c4a8a"; }

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
  // 武将评分 = 六维之和，不设单项突出加成
  function ratingScore(g) { return sumStats(g); }
  // 武将评级：武将评分（即六维之和）÷6，再套用与单项相同的评级阈值
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
    field: "assets/bgm/tactics.mp3",          // 野战演武·经典版（沿用战术曲）
    fieldgrid: "assets/bgm/war.mp3",          // 野战演武·棋盘对垒
    map: "assets/bgm/strategy.mp3",           // 天下游历大地图
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
    if (id !== "field" && typeof FieldFX !== "undefined" && FieldFX.stop) FieldFX.stop();
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
    // 全部武将名录/全部城市总览/全部势力总览固定挂在天下地图之下
    if ($("#screen-allgen").classList.contains("active")) { MapUI.open(); return; }
    if ($("#screen-allcity").classList.contains("active")) { MapUI.open(); return; }
    if ($("#screen-allfac").classList.contains("active")) { MapUI.open(); return; }
    // 角色扮演主页现为天下地图之下的角色详情页，退出固定回到地图（若尚未开局才回首页）
    if ($("#screen-rpg").classList.contains("active")) {
      if (RPG.char && Campaign.meta && Campaign.meta.active) { MapUI.open(); return; }
      showScreen("home"); return;
    }
    // 野战演武·经典版：从小游戏自由试玩进入时退出中止整场回首页；从边境战事等角色扮演流程发起时（rpg 标记为真）回到天下地图
    if ($("#screen-field").classList.contains("active")) {
      const rpg = FieldBattle.rpg;
      FieldBattle.abort();
      if (rpg) goHome(); else showScreen("home");
      return;
    }
    // 野战演武·棋盘对垒：现已接入边境战事/攻城战作为战斗界面——从小游戏自由试玩进入时退出中止整场回首页，
    // 从边境战事等角色扮演流程发起时（rpg 标记为真）回到天下地图，与旧版 FieldBattle 同一套规则
    if ($("#screen-fieldgrid").classList.contains("active")) {
      const rpg = GridBattle.rpg;
      GridBattle.abort();
      if (rpg) goHome(); else showScreen("home");
      return;
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

  /* ---------------- 弹窗 ----------------
   * modal:true 的弹窗点击遮罩不关闭——凡是「战斗流程正在 await 玩家选择」的弹窗（回魂丹、
   * 出战询问、战报回调、竞猜、夜袭、边境战等）必须走 modal，否则误触遮罩会把按钮连同
   * Promise 的唯一出路一起关掉，战斗循环从此挂死 */
  const overlay = $("#overlay");
  let overlayModal = false;
  // 每次开新弹窗都先清掉内容容器自身可能残留的 onclick——某些弹窗（如两军阵前对比）会给
  // #overlay-content 直接挂一个"点内容任意处关闭"的处理器，若不在这里兜底清空，这个处理器
  // 会一直挂在这个全局共用的容器节点上（innerHTML 替换只清子节点，清不掉容器自己的 onclick），
  // 后续任何一个新弹窗——哪怕是 modal:true、正在 await 玩家点击的关键弹窗——只要点到按钮之外
  // 的空白处就会被这个陈年处理器误关掉，游戏就此卡死在等一个永远不会再来的点击上
  function openOverlay(html, opts) { const c = $("#overlay-content"); c.onclick = null; c.innerHTML = html; overlay.classList.add("show"); overlayModal = !!(opts && opts.modal); }
  function closeOverlay() { overlay.classList.remove("show"); overlayModal = false; }
  overlay.addEventListener("click", e => { if (e.target === overlay && !overlayModal) closeOverlay(); });

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
    let bondHtml = "", eqHtml = "", assassinHtml = "", factionHtml = "";
    const isRealGeneral = !opts.global && RPG.char && g.id !== -1 && DB.get(g.id);
    const sameSide = isRealGeneral && g.side === RPG.char.side;
    const bondable = isRealGeneral && sameSide && !opts.readonly;
    const showFriendBox = isRealGeneral && sameSide;
    const assassinable = isRealGeneral && !sameSide && !opts.readonly;
    // 势力效忠：无论中日，任一武将的所属势力与忠诚度都照实展示（情报本就该看得见）；
    // 但「招揽」按钮仍只对同国武将开放——跨国挖人有违"保留中日两国"的立意，异国武将只能是刺杀的对象
    const mFac = isRealGeneral ? Campaign.mapState() : null;
    if (mFac && mFac.generalFaction) {
      const curFid = mFac.generalFaction[g.id];
      const isMine = curFid && curFid === mFac.playerFaction;
      const isLord = curFid && isFactionLord(curFid, g.id);
      const postK = (mFac.posts || {})[g.id];
      const postTxt = curFid && !isLord && postK ? ` · 官位 <b>${Rewards.postName(postK, g.side)}</b>` : "";
      const facLine = `🚩 现效力于：${curFid ? facChip(curFid) : "<b>在野</b>"}${isLord ? ' <span class="lord-mark" title="主公">👑 主公</span>' : ""}`
        + (curFid ? ` · 忠诚 ${loyaltyCell(mFac, curFid, g.id)}` : "") + postTxt;
      let btn = "";
      if (!opts.readonly && !isMine && sameSide) {
        if (isLord) {
          // 主公乃一方之尊，非区区财帛可动——要他麾下的地盘与人马，只能堂堂正正灭其势力
          btn = `<div class="bond-gifts"><button class="gift-btn" disabled>👑 一方主公，非金帛可招（唯灭其势力）</button></div>`;
        } else {
          const chance = Math.round(Loyalty.persuadeChance(mFac, g.id) * 100);
          btn = `<div class="bond-gifts"><button class="gift-btn" id="bond-persuade">🗣️ 招揽（约 ${chance}% 成功 · ${Loyalty.persuadeCost(g.id)} 金）</button></div>`;
        }
      }
      factionHtml = `<div class="bond-box"><div class="bond-line">${facLine}</div>${btn}</div>`;
    }
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
        const lordMode = Bond.isLordMode();
        const visitedToday = (Bond.data.visitDay || {})[g.id] === Bond.dayKey();
        const sparredToday = (Bond.data.sparDay || {})[g.id] === Bond.dayKey();
        const mSpar = Campaign.mapState();
        const sparNoAp = !!mSpar && mSpar.ap <= 0;
        // 自立当主后，「纳入麾下」与势力效力行里的「招揽」殊途同归——都是把对方的 generalFaction 改成
        // "_player_"，唯一区别是前者友谊满上限即可白拿、后者要看成算掏钱赌一把，形同白送的后门，
        // 使「招揽」的风险设计形同虚设。当主状态下不再渲染这颗按钮，招人一律走招揽一条路；
        // 仕官/在野期的「招募入队」招的是私人团队（与效忠哪一方无关），并非同一件事，不受影响
        let recruitBtnHtml = "";
        if (!lordMode) {
          const inTeam = Bond.inTeam(g.id);
          const teamFull = Bond.data.team.length >= Bond.teamLimit();
          const recruitLbl = inTeam ? "✓ 已在队中"
            : !atCap ? `🔒 友谊满上限（${Bond.MAX_FRIEND}）后可招募`
            : teamFull ? "🔁 招募（满员，需替换队友）"
            : `🤝 招募入队（${Bond.recruitCost(g)} 金）`;
          recruitBtnHtml = `<button class="gift-btn recruit ${inTeam || !atCap ? "dim" : ""}" id="bond-recruit">${recruitLbl}</button>`;
        }
        giftsRow = `<div class="bond-gifts">
          <button class="gift-btn ${(atCap || visitedToday) ? "dim" : ""}" id="bond-visit">🚶 拜访（+1~2）${atCap ? "（友谊已满）" : visitedToday ? "（今日已访）" : ""}</button>
          <button class="gift-btn ${(sparredToday || sparNoAp) ? "dim" : ""}" id="bond-spar">⚔️ 切磋（-1⚡）${sparredToday ? "（今日已切磋）" : sparNoAp ? "（行动力不足）" : ""}</button>
          ${recruitBtnHtml}
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
          <div class="overall-line">评分 <b class="ov-sum">${ratingScore(hg)}</b> ${ratingChip(hg)}</div>
          <div class="stat-rows">${statRow('体力', hg.ti, hg.ti - raw.ti)}${statRow('武力', hg.wu, hg.wu - raw.wu)}${statRow('统帅', hg.tong, hg.tong - raw.tong)}${statRow('智力', hg.zhi, hg.zhi - raw.zhi)}${statRow('政治', hg.zheng, hg.zheng - raw.zheng)}${statRow('魅力', hg.mei, hg.mei - raw.mei)}</div>
        </div>
      </div>
      ${g.id !== -1 ? (() => { const sk = Skill.of(hg); return `<div class="dc-skill ${sk.named ? "named" : ""}"><b>${sk.icon} 将魂 ·【${sk.n}】</b>${sk.named ? "<small>名将专属</small>" : ""}<br>${sk.desc}</div>`; })() : ""}
      ${eqHtml}
      ${bondHtml}
      ${factionHtml}
      ${assassinHtml}
      <div class="btns">
        ${opts.pickable ? `<button class="btn-primary" id="detail-pick">选他出战</button>` : ''}
        <button class="btn-ghost" id="detail-close">关闭</button>
      </div>
    </div>`;
    openOverlay(html, { modal: true });
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
      const recruitBtn = $("#bond-recruit");
      if (recruitBtn) recruitBtn.onclick = () => {
        if (Bond.pts(g.id) < Bond.MAX_FRIEND) return;
        if (Bond.inTeam(g.id)) return;
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
    const persuadeBtn = $("#bond-persuade");
    if (persuadeBtn) persuadeBtn.onclick = () => { if (Loyalty.persuade(mFac, g.id)) { showDetail(g, opts); refreshDBIfActive(); } };
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
      <div class="btns"><button class="btn-ghost" id="replace-cancel">取消</button></div></div>`, { modal: true });
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
    const fnameEl = $(".fname", el);
    fnameEl.textContent = g.name;
    // 姓名过长时逐级缩小字体，确保单行显示不被卡片边界截断（原字号 16px 恰容 4 字）
    fnameEl.style.fontSize = g.name.length >= 7 ? "10px" : g.name.length >= 5 ? "12px" : "";
    const sk = Skill.of(g);
    $(".ftotal", el).innerHTML = `<span class="ft-lbl" title="${sk.n}：${sk.desc}">${sk.n}</span><span class="ft-row"><b>${ratingScore(g)}</b>${ratingChip(g)}</span>`;
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
  // 回魂丹：主角在 RPG 相关单挑（历练/2v2/百人斩/车轮）倒地时，可花金满血续战，每场一次；
  // 基准 100 金，所在城建有医馆（且城属己方）时按医馆等级折价 80/65/50（见 Buildings.reviveCost）
  function maybeRevive() {
    const eligible = RPG.char && !BATTLE.revived &&
      (BATTLE.rpg || (BATTLE.mode === "tower" && Tower.rpg) || (BATTLE.mode === "gauntlet" && Gauntlet.rpg));
    const cost = eligible ? Buildings.reviveCost() : 100;
    if (!eligible || Bond.gold() < cost) return Promise.resolve(false);
    return new Promise(res => {
      openOverlay(`<div class="result-card">
        <h1>命悬一线</h1>
        <div class="wdesc">${BATTLE.p1.g.name} 倒地！是否服下回魂丹，原地满血续战？<br>（${cost} 金${cost < 100 ? " · 🏥 医馆折价" : ""} · 现有 ${Bond.gold()} 金 · 每场限一次）</div>
        <div class="btns">
          <button class="btn-primary" id="rv-yes">💊 服回魂丹</button>
          <button class="btn-ghost" id="rv-no">认输</button>
        </div></div>`, { modal: true });
      $("#rv-yes").onclick = () => {
        closeOverlay();
        if (!Bond.spend(cost)) { res(false); return; }
        BATTLE.p1.hp = BATTLE.p1.g.ti;
        BATTLE.revived = true;
        logLine(`💊 ${BATTLE.p1.g.name} 服下回魂丹，满血复活再战！（-${cost}金，余 ${Bond.gold()} 金）`, "sys");
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
        backScreen: opts.backScreen || "teamwar",
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
    // 将魂 · 开场技（威压/据水断桥/离间）并昭示双方技能
    applyDuelOpeners(BATTLE.p1, BATTLE.p2);
    [BATTLE.p1, BATTLE.p2].forEach(f => {
      const sk = Skill.of(f.g);
      logLine(`${sk.named ? "⭐" : sk.icon} ${f.g.name} 将魂【${sk.n}】——${sk.desc.split("｜").find(s => s.includes("单挑")) || sk.desc}`, "sys");
    });
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
    // 鏖战护栏：逾 300 手（150 回合）仍未分出胜负（回血/疗伤型对局可能拖长），按剩余体力判定，防止观战/委托模式无限拖场
    if (BATTLE.turnNo >= 300) {
      logLine("⏳ 两将鏖战多时未分胜负，以伤势轻重定高下！", "sys");
      if (BATTLE.p1.hp / BATTLE.p1.maxHp >= BATTLE.p2.hp / BATTLE.p2.maxHp) BATTLE.p2.hp = 0; else BATTLE.p1.hp = 0;
      await battleSleep(400);
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
    if (ev.type === "skill") {
      // 将魂技能发动（如七进七出复活）：亮出提示并刷新体力条
      AudioSystem.sfx.victory();
      logLine(ev.text, "sys");
      updateBars($("#f-left"), BATTLE.p1);
      updateBars($("#f-right"), BATTLE.p2);
      await battleSleep(700);
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
    // 单挑结束的胜负确认框此前未传 { modal: true }，背景遮罩一点即关（见 overlay 的点击穿透关闭逻辑）——
    // 玩家手一抖点到卡片外，确认框秒退但游戏并未继续，两个按钮也随之一并消失，形同卡死；补上 modal
    // 令其只能由框内按钮关闭
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
    </div>`, { modal: true });
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
          </div></div>`, { modal: true });
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
        </div></div>`, { modal: true });
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
        </div></div>`, { modal: true });
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
        // 不只排除已封顶的维度，连"当前值+该机缘固定加成量"会超过 110 上限的也一并排除（如 109 距上限仅 1 点，
        // 但该机缘固定 +7，109+7=116 会突破上限，同样不应作为选项出现）
        const eligible = opts.filter(o => o.k === "heal" || RPG.eff(RPG.char, o.k) + (o.k === "ti" ? 16 : 7) <= 110);
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
        </div></div>`, { modal: true });
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
        </div></div>`, { modal: true });
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
        </div>`, { modal: true });
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
    // opts.customRoster: {cn:[...], jp:[...]} 由调用方给定固定参战名单时（通用能力，暂无内置玩法使用），
    // 跳过默认的「全库200员+规模挑选」建军逻辑，改直接以给定名单为准（仍套用下方统一的主角强制上阵逻辑）；
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
        const forced = [clone(hero), ...Bond.myRoster().filter(g => g.side === hero.side).map(clone)];
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
        </div></div>`, { modal: true });
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
      this.delegated = !!opts.observe;   // observe：主角未上场的纯观战——「己方」全程由 AI 代打
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
      shuffle(mine);   // 阵中站位随机，不再固定自选武将（含主角）排头位
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
      // 医馆驻城加成：主角带兵作战时，己方「安抚军心/驰援同袍」在本城（归属己方、建有医馆）额外恢复兵力
      if (ev.ok && (key === "rally" || key === "reinforce") && this.rpg) {
        const who = key === "reinforce" ? target : caster;
        if (who.side === this.playerSide) {
          const m = typeof Campaign !== "undefined" && Campaign.mapState();
          const frac = m ? Buildings.troopHealBonus(m) : 0;
          if (frac > 0) {
            const before = who.troops;
            who.troops = Math.min(who.maxTroops, who.troops + Math.round(who.maxTroops * frac));
            const gained = who.troops - before;
            if (gained > 0) ev.text += `（🏥 医馆额外 +${gained}）`;
          }
        }
      }
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
      // 历战成长：战役内的组队大战（如遭遇战、武将大会等；边境战事/攻城战现改走野战演武·棋盘对垒，
      // 其历战成长见 GridBattle.finishExternal），参战真实武将胜负各有小概率精进
      if (this.rpg && typeof Campaign !== "undefined") {
        const gm = Campaign.mapState();
        if (gm) {
          let grew = 0;
          [...this.cn, ...this.jp].forEach(u => {
            if (u.g.id == null || u.g.id < 0) return;
            if (Growth.battle(gm, u.g, u.side === "cn" ? cnAlive > 0 : jpAlive > 0)) grew++;
          });
          if (grew) this.log(`📈 历战磨砺：${grew} 位武将六维有所精进`);
        }
      }
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
          <div class="btns"><button class="btn-primary" id="tw-cont">回到战局</button></div></div>`, { modal: true });
        $("#tw-cont").onclick = () => { closeOverlay(); cb(res); };
        return;
      }
      openOverlay(`<div class="result-card">
        <h1>${playerWon ? "大捷" : "败退"}</h1>
        <div class="wdesc">你方存活 <b>${mineAlive}</b>/${mineTotal} 将，敌方存活 <b>${theirAlive}</b>/${theirTotal} 将。<br>本场击杀敌将 <b style="color:var(--cn-red)">${this.kills.player}</b> 员。</div>
        <div class="btns">
          <button class="btn-primary" id="tw-again">再来一场</button>
          <button class="btn-ghost" id="tw-home">返回菜单</button>
        </div></div>`, { modal: true });
      $("#tw-again").onclick = () => { closeOverlay(); this.rpg ? RPG.teamBattle() : SelectUI.open("team"); };
      $("#tw-home").onclick = () => { closeOverlay(); if (this.rpg) goHome(); else showScreen("home"); };
      if (this.rpg) RPG.onTeamBattleResult(this.kills.player, playerWon);
    },
  };

  /* ============================================================
   *  野战演武（小游戏）：两军对圆 · 斗将破阵
   *  排兵布阵（五位五将阵+阵形克制+随机地形）→ 阵前斗将（单挑定士气，连斩夺气）→
   *  挥军破阵（前锋/左翼/右翼/中军四线实时推挤，限量军令扭转战局，溃线冲乱邻线）→ 追亡逐北。
   *  自由玩法：使用武将图鉴默认数值，不消耗、不产出任何存档数据。
   * ============================================================ */
  /* ============================================================
   *  将魂 · 武将独特技能（一期：野战侧）
   *  每员武将按六维最突出一项归入门派持通用技能；十二位名将持史实专属技能（金色）。
   *  全部被动自动发动，发动时入战报。
   * ============================================================ */
  const Skill = {
    // 主动技能（ACTIVE）：野战总攻中以战线旁的技能钮呈现，冷却完毕自动发动，一场战斗可反复触发；
    // 被动技能（其余）：常驻加成，不占技能钮位。
    ACTIVE_WAR_TYPES: new Set(["awe", "discord", "infiltrate", "roar", "volley", "dualblade", "tempo",
      "school-wu", "school-ti", "school-mei", "school-zheng"]),
    SCHOOLS: {
      wu: { n: "陷阵", icon: "🗡️", desc: "野战【主动】：冷却完毕自动突击所在线，斩敌兵力（幅度随武力）｜单挑：伤害 +10%" },
      tong: { n: "坚壁", icon: "🛡️", desc: "野战【被动】：所在线守备常驻 +10%｜单挑：受创 -10%" },
      zhi: { n: "连环", icon: "🧠", desc: "野战【被动】：所在线我计谋 +15%、敌计谋 -15%｜单挑：敌计策成功率 -15%" },
      ti: { n: "游击", icon: "🐎", desc: "野战【主动】：冷却完毕自动整军，为所在线补充兵力｜单挑：每回合回复体力 2" },
      mei: { n: "感召", icon: "👑", desc: "野战【主动】：冷却完毕自动振奋，提振所在线士气｜单挑：威压使对手起始战意 -15" },
      zheng: { n: "辎重", icon: "📜", desc: "野战【主动】：冷却完毕自动调度，为所在线补充兵力｜单挑：出招战意消耗打八折" },
    },
    NAMED: {
      "吕布": { n: "无双", type: "awe", desc: "野战【主动】：冷却完毕自动震慑，所在线敌军士气骤降｜单挑前三回合伤害 ×1.5" },
      "关羽": { n: "武圣", type: "duelmorale", desc: "野战【被动】：阵前斩将士气收益翻倍｜单挑暴击率 +15%" },
      "张飞": { n: "据水断桥", type: "roar", desc: "野战【主动】：冷却完毕一声断喝，所在线敌军士气重挫｜单挑：敌起始战意 -20" },
      "诸葛亮": { n: "借东风", type: "firemaster", desc: "野战【被动】：火攻不限地形且威力翻倍｜单挑计策成功率 +15%" },
      "曹操": { n: "奸雄", type: "counterspy", desc: "野战【被动】：敌计谋对我全军减半｜单挑敌计策成功率 -20%" },
      "吕蒙": { n: "白衣渡江", type: "infiltrate", desc: "野战【主动】：冷却完毕潜行突袭，偷袭所在线敌军兵力｜单挑首回合奇袭伤害 ×1.4" },
      "貂蝉": { n: "离间", type: "discord", desc: "野战【主动】：冷却完毕巧施连环，令所在线敌军自乱｜单挑开局魅惑，敌攻击 -15%（2 回合）" },
      "织田信长": { n: "三段击", type: "volley", desc: "野战【主动】：冷却完毕连番齐射，重创所在线敌军｜单挑 20% 概率追加连击" },
      "武田信玄": { n: "风林火山", type: "tempo", desc: "野战【主动】：冷却完毕临阵调度，振我军挫敌军｜单挑前三回合受创 -20%" },
      "上杉谦信": { n: "军神", type: "duelmorale", desc: "野战【被动】：阵前斩将士气收益翻倍｜单挑伤害 +12%" },
      "本多忠胜": { n: "无伤", type: "adamant", desc: "野战【被动】：所在线守备常驻 +20%｜单挑受创 -15%" },
      "德川家康": { n: "隐忍", type: "endure", desc: "野战【被动】：所在线兵力折损 -20%｜单挑残血时受创 -30%" },
      "赵云": { n: "七进七出", type: "rescue", desc: "野战【被动】：所在线兵力折损 -10%｜单挑首次倒地杀出重围（回复五成体力）" },
      "宫本武藏": { n: "二天一流", type: "dualblade", desc: "野战【主动】：冷却完毕双刀连斩，重创所在线敌军｜单挑 25% 概率追加连击" },
      "许褚": { n: "虎痴", type: "tiger", desc: "野战【被动】：所在线守备常驻 +15%｜单挑残血时裸衣暴走，伤害 ×1.5" },
      "真田幸村": { n: "日本一兵", type: "sanada", desc: "野战【被动】：所在线攻守常驻 +8%｜单挑对体力更雄厚的强敌伤害 ×1.2" },
      "周瑜": { n: "火烧赤壁", type: "volley", desc: "野战【主动】：冷却完毕纵火奇计，重创所在线敌军｜单挑 20% 概率追加连击" },
      "陆逊": { n: "火烧连营", type: "dualblade", desc: "野战【主动】：冷却完毕连营纵火，重创所在线敌军｜单挑 25% 概率追加连击" },
      "黄忠": { n: "老当益壮", type: "school-wu", desc: "野战【主动】：冷却完毕宝刀不老，突击所在线斩敌｜单挑：暴击率 +12%" },
      "姜维": { n: "九伐中原", type: "dualblade", desc: "野战【主动】：冷却完毕连番进击，重创所在线敌军｜单挑 22% 概率追加连击" },
      "张辽": { n: "威震逍遥津", type: "roar", desc: "野战【主动】：冷却完毕仲达破胆，所在线敌军士气重挫｜单挑：敌起始战意 -22" },
      "司马懿": { n: "鹰视狼顾", type: "tempo", desc: "野战【主动】：冷却完毕后发制人，振我军挫敌军｜单挑前三回合受创 -22%" },
      "伊达政宗": { n: "独眼龙的野望", type: "volley", desc: "野战【主动】：冷却完毕孤军突进，重创所在线敌军｜单挑 20% 概率追加连击" },
      "石田三成": { n: "智略关原", type: "discord", desc: "野战【主动】：冷却完毕运筹帷幄，令所在线敌军自乱｜单挑开局魅惑，敌攻击 -15%（2 回合）" },
      "前田利家": { n: "槍の又左", type: "dualblade", desc: "野战【主动】：冷却完毕长枪连突，重创所在线敌军｜单挑 25% 概率追加连击" },
      "明智光秀": { n: "本能寺之变", type: "infiltrate", desc: "野战【主动】：冷却完毕暗谋突变，偷袭所在线敌军兵力｜单挑首回合奇袭伤害 ×1.45" },
      "立花宗茂": { n: "西国无双", type: "adamant", desc: "野战【被动】：所在线守备常驻 +20%｜单挑受创 -15%" },
      "岛津义弘": { n: "捨て奸", type: "endure", desc: "野战【被动】：所在线兵力折损 -22%｜单挑残血时受创 -32%" },
      "马超": { n: "西凉铁骑", type: "dualblade", desc: "野战【主动】：冷却完毕铁骑冲阵，重创所在线敌军｜单挑 23% 概率追加连击" },
      "甘宁": { n: "百骑劫营", type: "infiltrate", desc: "野战【主动】：冷却完毕铃铛夜袭，偷袭所在线敌军兵力｜单挑首合奇袭伤害 ×1.42" },
      "太史慈": { n: "神亭酣斗", type: "volley", desc: "野战【主动】：冷却完毕连珠劲射，重创所在线敌军｜单挑 20% 概率追加连击" },
      "徐晃": { n: "周亚夫之风", type: "adamant", desc: "野战【被动】：所在线守备常驻 +20%｜单挑受创 -15%" },
      "郭嘉": { n: "十胜十败", type: "firemaster", desc: "野战【被动】：火攻不限地形且威力翻倍｜单挑计策成功率 +15%" },
      "庞统": { n: "连环献策", type: "discord", desc: "野战【主动】：冷却完毕连环献策，令所在线敌军自乱｜单挑开局魅惑，敌攻击 -15%（2 回合）" },
      "黑田官兵卫": { n: "九州军师", type: "counterspy", desc: "野战【被动】：敌计谋对我全军减半｜单挑敌计策成功率 -20%" },
      "竹中半兵卫": { n: "稻叶山夜取", type: "infiltrate", desc: "野战【主动】：冷却完毕十六奇袭，偷袭所在线敌军兵力｜单挑首合奇袭伤害 ×1.38" },
      "毛利元就": { n: "三矢之训", type: "tempo", desc: "野战【主动】：冷却完毕调度三军，振我军挫敌军｜单挑前三回合受创 -18%" },
      "柴田胜家": { n: "瓶割破釜", type: "tiger", desc: "野战【被动】：所在线守备常驻 +15%｜单挑残血时破釜死斗，伤害 ×1.6" },
      "加藤清正": { n: "虎退治·熊本坚城", type: "adamant", desc: "野战【被动】：所在线守备常驻 +20%｜单挑受创 -15%" },
      "福岛正则": { n: "贱岳一番枪", type: "school-wu", desc: "野战【主动】：冷却完毕一番抢功，突击所在线斩敌｜单挑：暴击率 +14%" },
    },
    // 六维分布并不对称（如体力普遍偏高且离散度小），直接取原始数值最大项会让"游击"门派严重扎堆；
    // 改用 Z 分数（(数值-全库均值)/标准差）衡量"该维度相对该武将有多突出"，六门派归属显著更均衡
    _dimStats: null,
    _computeDimStats() {
      const dims = ["wu", "tong", "zhi", "ti", "mei", "zheng"];
      const pool = (typeof ALL_GENERALS !== "undefined" && ALL_GENERALS.length) ? ALL_GENERALS : (DB.list.length ? DB.list : []);
      const stats = {};
      dims.forEach(d => {
        const vals = pool.map(g => g[d] || 0);
        const mean = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
        const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length || 1);
        stats[d] = { mean, std: Math.sqrt(variance) || 1 };
      });
      return stats;
    },
    of(g) {
      // 自建武将可指定「将魂来源」：习得武将库中某将的将魂（见 RPG.create 的 skillGeneralId），
      // heroGeneral() 据此在 g.skillOverride 上挂好已算出的技能对象，此处优先读取
      if (g.skillOverride) return g.skillOverride;
      const nm = this.NAMED[g.name];
      if (nm) return { ...nm, icon: "⭐", named: true };
      if (!this._dimStats) this._dimStats = this._computeDimStats();
      const dims = ["wu", "tong", "zhi", "ti", "mei", "zheng"];
      let best = dims[0], bestZ = -Infinity;
      dims.forEach(d => {
        const st = this._dimStats[d];
        const z = ((g[d] || 0) - st.mean) / st.std;
        if (z > bestZ) { bestZ = z; best = d; }
      });
      return { ...this.SCHOOLS[best], type: "school-" + best, named: false };
    },
    tag(g) {
      const sk = this.of(g);
      return `<span class="fb-skl ${sk.named ? "named" : ""}" title="${sk.n}：${sk.desc}">${sk.icon}${sk.n}</span>`;
    },
    // 单挑侧：把技能折算成引擎可读的旗标（覆盖式写入，重复调用安全；engine.makeFighter 自动调用）
    duelApply(g) {
      g.skDmgMul = 1; g.skDefMul = 1; g.skCrit = 0; g.skDodge = 0; g.skSchemeUp = 0;
      g.skRegen = 0; g.skStamSave = 1; g.skAwe = 0; g.skWeakenOpen = false;
      g.skFirst3 = 0; g.skFirst3Def = 0; g.skFirstStrike = 0; g.skDouble = 0;
      g.skLowDef = 0; g.skRevive = false; g.skRage = 0; g.skGiant = 0;
      const t = this.of(g).type;
      if (t === "school-wu") { if (g.name === "黄忠") g.skCrit = 0.12; else if (g.name === "福岛正则") g.skCrit = 0.14; else g.skDmgMul = 1.1; }
      else if (t === "school-tong") g.skDefMul = 0.9;
      else if (t === "school-zhi") g.skDodge = 0.15;
      else if (t === "school-ti") g.skRegen = 2;
      else if (t === "school-mei") g.skAwe = 15;
      else if (t === "school-zheng") g.skStamSave = 0.8;
      else if (t === "awe") g.skFirst3 = 1.5;
      else if (t === "duelmorale") { if (g.name === "关羽") g.skCrit = 0.15; else g.skDmgMul = 1.12; }
      else if (t === "roar") g.skAwe = g.name === "张辽" ? 22 : 20;
      else if (t === "firemaster") g.skSchemeUp = 0.15;
      else if (t === "counterspy") g.skDodge = 0.2;
      else if (t === "infiltrate") g.skFirstStrike = g.name === "明智光秀" ? 1.45 : g.name === "甘宁" ? 1.42 : g.name === "竹中半兵卫" ? 1.38 : 1.4;
      else if (t === "discord") g.skWeakenOpen = true;
      else if (t === "volley") g.skDouble = 0.2;
      else if (t === "tempo") g.skFirst3Def = g.name === "司马懿" ? 0.78 : g.name === "毛利元就" ? 0.82 : 0.8;
      else if (t === "adamant") g.skDefMul = 0.85;
      else if (t === "endure") g.skLowDef = g.name === "岛津义弘" ? 0.68 : 0.7;
      else if (t === "rescue") g.skRevive = true;
      else if (t === "dualblade") g.skDouble = g.name === "姜维" ? 0.22 : g.name === "马超" ? 0.23 : 0.25;
      else if (t === "tiger") g.skRage = g.name === "柴田胜家" ? 1.6 : 1.5;
      else if (t === "sanada") g.skGiant = 1.2;
      return g;
    },
  };
  window.Skill = Skill;   // 供 engine.js 的 makeFighter 挂载单挑侧技能旗标

  // 自建武将「将魂来源」选择器：列出武将库全员供搜索挑选，选定后回调 onPick(id)（id 为 null 表示不指定，
  // 按自身六维最突出一项自动归派门派技能，即维持原有默认行为）；供开局向导与旧版创建入口共用
  function openSkillGenPicker(curId, onPick) {
    const render = (kw) => {
      let arr = DB.list.slice().sort((a, b) => ratingScore(b) - ratingScore(a));
      if (kw) arr = arr.filter(g => g.name.includes(kw));
      return arr.slice(0, 80).map(g => { const sk = Skill.of(g);
        return `<div class="card ${g.side} ${g.id === curId ? 'selected' : ''}" data-id="${g.id}">
          <div class="avatar">${avatarChar(g.name)}</div>
          <div class="cname">${g.name}</div><div class="cwu">⭐${sk.n}</div></div>`; }).join("");
    };
    openOverlay(`<div class="result-card detail-card">
      <h1>选择将魂来源</h1>
      <div class="wdesc">从武将库挑一位武将，习得其「将魂」技能（单挑/野战皆生效）。</div>
      <div class="search-box"><input id="skg-search" placeholder="搜索…"></div>
      <div class="grid" id="skg-grid" style="max-height:50vh;overflow-y:auto">${render("")}</div>
      <div class="btns"><button class="btn-ghost" id="skg-clear">不指定（按自身六维自动归派）</button></div>
    </div>`, { modal: true });
    const bind = () => $$("#skg-grid .card").forEach(c => c.onclick = () => { onPick(+c.dataset.id); closeOverlay(); });
    bind();
    $("#skg-search").oninput = () => { $("#skg-grid").innerHTML = render($("#skg-search").value.trim()); bind(); };
    $("#skg-clear").onclick = () => { onPick(null); closeOverlay(); };
  }

  /* ============================================================
   *  野战演武·挥军破阵 全景画布（FieldFX）：五线战场连成一整幅画面，沿用 Duel 模块的像素堆叠
   *  美术语言（无平滑、方块拼装），服务于"多线拉锯"而非"两人对决"——每条战线一道横带，双方
   *  各自一队小兵方块隔着交锋点对推，主将骑影押阵，火光/烟尘/奇袭随军令而起。
   *  仅负责视觉，不参与任何数值判定：每帧只读取 FieldBattle 的 lanes/myPos/foePos/terrain 作画；
   *  军令/将魂发动等离散事件由 FieldBattle 主动调用 burst() 追加一段特效，持续伤害无需特意通知——
   *  本模块自行比对逐帧兵力差值探测"刚挨了一下"并触发交锋点火花，解耦得更彻底、不必在战斗结算
   *  代码里到处插柱子。画布本身独立于 renderClash() 的 DOM 重绘（后者只管信息条与按钮，见
   *  #fb-canvas 常驻于 index.html，不随 innerHTML 重写而被销毁），故下军令时的特效不会被同一帧
   *  触发的重渲染清空。 */
  const FieldFX = {
    cv: null, ctx: null, raf: 0, fx: [], _prevTr: {}, _pulse: {}, _onResize: null,
    BAND_H: 50, TOP_M: 18, BOT_M: 14, MARGIN_X: 24,
    mount(cv) {
      this.stop();
      this.cv = cv; this.ctx = cv.getContext("2d"); this.ctx.imageSmoothingEnabled = false;
      this.fx = []; this._prevTr = {}; this._pulse = {};
      if (!this._onResize) this._onResize = () => this.resize();
      window.addEventListener("resize", this._onResize);
      this.resize();
      this.start();
    },
    unmount() {
      this.stop();
      if (this._onResize) window.removeEventListener("resize", this._onResize);
      this.cv = null; this.ctx = null;
    },
    resize() {
      if (!this.cv) return;
      const cw = this.cv.clientWidth || 320;
      const H = this.TOP_M + this.BAND_H * 5 + this.BOT_M;
      const W = Math.max(300, Math.min(900, Math.round(cw)));
      if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; this.ctx.imageSmoothingEnabled = false; }
    },
    start() { if (this.raf) return; const loop = t => { this.frame(t); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); },
    stop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } },
    // 追加一段离散特效：kind ∈ drum/hold/fire/scheme/raid/skill，见 drawFx
    burst(laneK, kind) { this.fx.push({ laneK, kind, t0: performance.now() }); if (this.fx.length > 50) this.fx.shift(); },
    shade(hex, amt) {
      const n = parseInt(hex.slice(1), 16);
      let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
      r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
      return `rgb(${r},${g},${b})`;
    },
    frame(now) {
      const FB = FieldBattle;
      if (!this.ctx || !this.cv || !FB.lanes) return;
      const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
      ctx.clearRect(0, 0, W, H);
      this.drawSky(ctx, W, now);
      FB.LANES.forEach((k, i) => {
        const L = FB.lanes[k];
        if (!L) return;
        const prev = this._prevTr[k];
        if (prev && (L.myTr < prev.my - 1 || L.foeTr < prev.foe - 1)) this._pulse[k] = now;
        this._prevTr[k] = { my: L.myTr, foe: L.foeTr };
        this.drawBand(ctx, FB, L, k, i, W, now);
      });
      this.drawBanners(ctx, W, H, FB, now);
      this.fx = this.fx.filter(f => now - f.t0 < 1500);
    },
    drawSky(ctx, W, now) {
      const sky = ["#2a3a63", "#48619a", "#7c93c4"];
      const bh = Math.ceil(this.TOP_M / sky.length);
      sky.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * bh, W, bh + 1); });
      ctx.fillStyle = "rgba(255,210,120,.35)"; ctx.fillRect(W - 36, 3, 12, 12);
      ctx.fillStyle = "#ffd45a"; ctx.fillRect(W - 34, 5, 8, 8);
    },
    drawBanners(ctx, W, H, FB, now) {
      const myCol = FB.side === "cn" ? "#c1272d" : "#2b3a67";
      const foeCol = FB.side === "cn" ? "#2b3a67" : "#c1272d";
      this.pole(ctx, 6, H - this.BOT_M, H - this.TOP_M - 2, myCol, now, 1);
      this.pole(ctx, W - 10, H - this.BOT_M, H - this.TOP_M - 2, foeCol, now, -1);
    },
    pole(ctx, x, groundY, h, col, now, dir) {
      ctx.fillStyle = "#5a4a2a"; ctx.fillRect(x, groundY - h, 2, h);
      ctx.fillStyle = "#e8c25a"; ctx.fillRect(x - 1, groundY - h - 2, 4, 3);
      const wv = Math.sin(now * 0.005) * 2;
      for (let i = 0; i < 5; i++) {
        const fy = groundY - h + 6 + i * 8;
        const fw = 12 + (i % 2 ? wv : -wv);
        ctx.fillStyle = col;
        ctx.fillRect(dir > 0 ? x + 2 : x - 2 - fw, fy, fw, 5);
      }
    },
    terrainGround(FB) { return FB.terrain === "pass" ? "#4a4032" : FB.terrain === "river" ? "#33506a" : "#3a4a24"; },
    terrainDeco(ctx, FB, mx, y0, innerW, bandH, i) {
      const t = FB.terrain;
      if (t === "river") {
        ctx.fillStyle = "rgba(140,190,230,.35)";
        const wy = y0 + bandH - 6;
        for (let x = mx; x < mx + innerW; x += 10) ctx.fillRect(x, wy + (Math.floor(x / 10 + i) % 2), 6, 1);
      } else if (t === "pass") {
        ctx.fillStyle = "rgba(90,80,60,.4)";
        for (let x = mx + 6; x < mx + innerW; x += 26) ctx.fillRect(x, y0 + bandH - 10, 6, 4);
      } else {
        ctx.fillStyle = "rgba(120,200,90,.25)";
        for (let x = mx + 4; x < mx + innerW; x += 8) ctx.fillRect(x, y0 + bandH - 6, 1, 4);
      }
    },
    drawBand(ctx, FB, L, k, i, W, now) {
      const y0 = this.TOP_M + i * this.BAND_H, bandH = this.BAND_H;
      const mx = this.MARGIN_X, innerW = W - mx * 2;
      const base = this.terrainGround(FB);
      ctx.fillStyle = i % 2 === 0 ? base : this.shade(base, -8);
      ctx.fillRect(mx - 6, y0 + 2, innerW + 12, bandH - 5);
      this.terrainDeco(ctx, FB, mx, y0, innerW, bandH, i);
      const broken = L.broken;
      const w = FB.laneW(L);
      const boundaryX = mx + innerW * w / 100;
      const midY = y0 + bandH / 2;
      this.drawSide(ctx, FB, L, "my", mx, boundaryX, midY, now, broken);
      this.drawSide(ctx, FB, L, "foe", boundaryX, mx + innerW, midY, now, broken);
      if (!broken) this.drawClash(ctx, boundaryX, midY, k, now);
      else this.drawBrokenBanner(ctx, L, mx, mx + innerW, midY);
      this.fx.filter(f => f.laneK === k).forEach(f => this.drawFx(ctx, f, mx, boundaryX, mx + innerW, y0, bandH, midY, now));
      const lbl = FB.posName(k);
      ctx.font = "9px sans-serif";
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(W / 2 - tw / 2 - 4, y0 + 1, tw + 8, 11);
      ctx.fillStyle = "#e8c25a"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(lbl, W / 2, y0 + 2);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    },
    troopCount(tr) { return tr <= 0 ? 0 : Math.max(1, Math.min(8, Math.round(Math.sqrt(tr) / 10))); },
    drawSide(ctx, FB, L, side, x0, x1, midY, now, broken) {
      const tr = side === "my" ? L.myTr : L.foeTr;
      const n = this.troopCount(tr);
      if (n <= 0) return;
      const loserSide = broken === "my" ? "foe" : broken === "foe" ? "my" : null;
      let alpha = 1, retreat = 0;
      if (loserSide === side) {
        const t = (now - (L.brokenAt || now)) / 900;
        alpha = Math.max(0, 1 - t);
        if (alpha <= 0) return;
        retreat = t * 24 * (side === "my" ? -1 : 1);
      }
      const armor = side === "my" ? (FB.side === "cn" ? "#e03028" : "#3858d8") : (FB.side === "cn" ? "#3858d8" : "#e03028");
      const dark = this.shade(armor, -60);
      const avail = Math.max(10, Math.abs(x1 - x0) - 8);
      const rows = n > 4 ? 2 : 1;
      const perRow = Math.ceil(n / rows);
      const spacing = Math.max(6, Math.min(11, avail / perRow));
      ctx.save();
      ctx.globalAlpha = alpha;
      for (let r = 0; r < rows; r++) {
        const rowY = midY + (side === "my" ? -1 : 1) * (6 + r * 9);
        const cnt = r === 0 ? perRow : n - perRow;
        for (let c = 0; c < cnt; c++) {
          const t = c + r * perRow;
          const bob = Math.sin(now * 0.006 + t) * 1.2;
          const dist = 5 + c * spacing;
          const px = (side === "my" ? x1 - dist : x0 + dist) + retreat;
          this.troopSprite(ctx, px, rowY + bob, armor, dark);
        }
      }
      const lx = (side === "my" ? x1 - 3 : x0 + 3) + retreat;
      this.leaderSprite(ctx, lx, midY, armor);
      ctx.restore();
    },
    troopSprite(ctx, x, y, armor, dark) {
      ctx.fillStyle = dark; ctx.fillRect(Math.round(x - 1), Math.round(y - 1), 3, 1);
      ctx.fillStyle = armor; ctx.fillRect(Math.round(x - 1), Math.round(y), 3, 3);
      ctx.fillStyle = "#d8c79c"; ctx.fillRect(Math.round(x), Math.round(y - 3), 1, 3);
    },
    leaderSprite(ctx, x, y, armor) {
      ctx.fillStyle = "#7a5020"; ctx.fillRect(Math.round(x - 3), Math.round(y - 1), 6, 3);
      ctx.fillStyle = armor; ctx.fillRect(Math.round(x - 2), Math.round(y - 5), 4, 4);
      ctx.fillStyle = "#f8d038"; ctx.fillRect(Math.round(x - 1), Math.round(y - 7), 2, 2);
    },
    drawClash(ctx, x, y, k, now) {
      const pulseAt = this._pulse[k];
      const recent = pulseAt && now - pulseAt < 350;
      const r = recent ? Math.max(1, 6 - (now - pulseAt) / 70) : 2 + Math.sin(now * 0.01) * 0.6;
      ctx.fillStyle = recent ? "#fff2b0" : "rgba(255,220,140,.5)";
      ctx.fillRect(Math.round(x - r), Math.round(y - 1), Math.round(r * 2), 2);
      ctx.fillRect(Math.round(x - 1), Math.round(y - r), 2, Math.round(r * 2));
    },
    drawBrokenBanner(ctx, L, x0, x1, midY) {
      const win = L.broken === "my";
      ctx.fillStyle = win ? "#e8c25a" : "#e53935";
      ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(win ? "突破" : "失守", (x0 + x1) / 2, midY);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    },
    drawFx(ctx, f, x0, boundaryX, x1, y0, bandH, midY, now) {
      const age = now - f.t0;
      if (f.kind === "drum") {
        const p = Math.min(1, age / 500); if (p >= 1) return;
        ctx.strokeStyle = `rgba(232,194,90,${1 - p})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc((x0 + boundaryX) / 2, midY, 4 + p * 16, 0, Math.PI * 2); ctx.stroke();
      } else if (f.kind === "hold") {
        const p = Math.min(1, age / 800); if (p >= 1) return;
        ctx.fillStyle = `rgba(180,190,200,${0.7 * (1 - p)})`;
        for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(boundaryX - 6), Math.round(y0 + 8 + i * 8), 4, 6);
      } else if (f.kind === "fire") {
        const p = Math.min(1, age / 700); if (p >= 1) return;
        for (let i = 0; i < 5; i++) {
          const fx = boundaryX + 6 + i * ((x1 - boundaryX - 10) / 5);
          const fh = 6 + Math.sin(now * 0.02 + i) * 3;
          ctx.fillStyle = i % 2 ? "#ff8020" : "#ffd060";
          ctx.fillRect(Math.round(fx), Math.round(midY - fh * (1 - p)), 3, Math.round(fh));
        }
      } else if (f.kind === "raid") {
        const p = Math.min(1, age / 500); if (p >= 1) return;
        const rx = x0 + (x1 - x0) * p;
        ctx.fillStyle = "#7a5020"; ctx.fillRect(Math.round(rx - 4), Math.round(midY - 2), 8, 4);
        ctx.fillStyle = "#f8d038"; ctx.fillRect(Math.round(rx - 1), Math.round(midY - 5), 2, 3);
      } else if (f.kind === "scheme") {
        const p = Math.min(1, age / 900); if (p >= 1) return;
        for (let i = 0; i < 3; i++) {
          const sx = (x0 + x1) / 2 + (i - 1) * 8, sy = midY - p * 14 - i * 2;
          ctx.fillStyle = `rgba(180,180,190,${0.5 * (1 - p)})`;
          ctx.beginPath(); ctx.arc(sx, sy, 3 + p * 3, 0, Math.PI * 2); ctx.fill();
        }
      } else if (f.kind === "skill") {
        const p = Math.min(1, age / 400); if (p >= 1) return;
        ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - p)})`;
        ctx.fillRect(Math.round(x0), Math.round(y0 + 2), Math.round(x1 - x0), bandH - 5);
      }
    },
    // 排兵布阵阶段的静态阵型预览：按当前五线站位的（武力+统帅）合计画一道左右分推的迷你条形图，
    // 提前一窥"照此阵容开打，各线大致谁占优"；不参与动画循环，仅在 renderDeploy 每次重渲染时重画一次
    drawDeployPreview(cv, FB) {
      if (!cv) return;
      const ctx = cv.getContext("2d"); ctx.imageSmoothingEnabled = false;
      const cw = cv.clientWidth || 300, rowH = 26, H = rowH * 5 + 8, W = Math.max(260, Math.min(900, Math.round(cw)));
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      ctx.clearRect(0, 0, W, H);
      const mx = 6, innerW = W - mx * 2;
      const myCol = FB.side === "cn" ? "#e03028" : "#3858d8", foeCol = FB.side === "cn" ? "#3858d8" : "#e03028";
      FB.POSITIONS.forEach(([k, n], i) => {
        const y0 = 4 + i * rowH;
        const myPow = (FB.myPos[k] || []).filter(g => g).reduce((s, g) => s + g.wu + g.tong, 0);
        const foePow = (FB.foePos[k] || []).filter(g => g).reduce((s, g) => s + g.wu + g.tong, 0);
        const tot = myPow + foePow;
        const w = tot > 0 ? myPow / tot * innerW : innerW / 2;
        ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect(mx, y0, innerW, rowH - 6);
        ctx.fillStyle = myCol; ctx.fillRect(mx, y0, w, rowH - 6);
        ctx.fillStyle = foeCol; ctx.fillRect(mx + w, y0, innerW - w, rowH - 6);
        ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(W / 2 - 12, y0, 24, rowH - 6);
        ctx.fillStyle = "#f0dcae"; ctx.fillText(n, W / 2, y0 + (rowH - 6) / 2);
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      });
    },
  };

  const FieldBattle = {
    gen: 0, phase: null, timer: null, side: "cn",
    POSITIONS: [["van", "前锋"], ["left", "左翼"], ["right", "右翼"], ["center", "中军"], ["reserve", "后路"]],
    LANES: ["van", "left", "right", "center", "reserve"],   // 五条战线全员接敌（后路亦是一线）
    FORMS: {
      cone: { n: "锥形", icon: "🔺", desc: "前锋/中军攻击 +20%", beats: "round" },
      crane: { n: "鹤翼", icon: "🕊️", desc: "左右两翼攻击 +20%", beats: "cone" },
      round: { n: "方圆", icon: "🛡️", desc: "全军守备 +25%", beats: "goose" },
      goose: { n: "雁行", icon: "🏹", desc: "乱箭蚀敌：敌各线士气持续流失", beats: "crane" },
    },
    TERRAINS: {
      plain: { n: "平原", icon: "🌾", desc: "堂堂之阵，正面对决，无特殊规则" },
      pass: { n: "山道", icon: "⛰️", desc: "两翼难以展开（左右翼战力减半）；山道草木可施火攻" },
      river: { n: "河畔", icon: "🌊", desc: "临水人心浮动：斗将士气波动 ×1.5；奇袭得手率 +15%" },
    },
    posName(k) { const p = this.POSITIONS.find(x => x[0] === k); return p ? p[1] : k; },
    // 两块常驻画布（排兵预览 / 挥军破阵全景战场）互斥切换显隐，见 index.html #screen-field 内固定挂载的两个 wrap——
    // 不随 #fb-content 的 innerHTML 重写而销毁重建，故 FieldFX 的动画与特效队列不会被同一帧的信息条重渲染打断
    showFieldCanvas(which) {
      const dw = $("#fb-deploy-canvas-wrap"), bw = $("#fb-canvas-wrap");
      if (dw) dw.style.display = which === "deploy" ? "" : "none";
      if (bw) bw.style.display = which === "battle" ? "" : "none";
    },
    open() { this.setup(this.side || "cn"); },
    setup(side) {
      this.gen++;
      clearInterval(this.timer); this.timer = null;
      this.side = side;
      this.rpg = false; this.external = null;
      const foeSide = side === "cn" ? "jp" : "cn";
      const draft = s => { const p = DB.bySide(s).slice(); shuffle(p); return p.slice(0, 10).map(clone); };
      this.mine = draft(side); this.foes = draft(foeSide);
      this._setupCommon();
    },
    // 供角色扮演·边境战事调用：以外部已构建好的双方阵容（含城墙/守将等加成）开局，不再从图鉴随机抽点；
    // opts.observe 为真（主角未被抽中亲历）时全程自动推演，无需任何点击；战罢通过 opts.onDone 回调
    // 组队大战兼容的结果对象（playerWon/mySurvivors/kills），交由调用方沿用既有的经验/金币/夺城结算
    beginExternal(myRoster, foeRoster, heroSide, opts = {}) {
      this.gen++;
      clearInterval(this.timer); this.timer = null;
      this.side = heroSide;
      this.rpg = !!opts.rpg;
      this.external = { auto: !!opts.observe, onDone: opts.onDone };
      // 城池驻军覆盖（军事一期）：委外战场（边境战）按各自实际出阵兵力与「按统帅推算的自然兵力」之比
      // 换算缩放系数，使接战兵力真正取决于所在城池的驻军存量，而非单纯看武将统帅高低；
      // 不传则维持原有的纯统帅推算（如小游戏自由试玩）
      this.troopScale = opts.troopScale || null;
      this.mine = myRoster.slice(0, 10);
      this.foes = foeRoster.slice(0, 10);
      this._setupCommon();
    },
    // 双方开局共用步骤：this.mine/this.foes 须已就位（随机抽点或外部指定皆可）
    _setupCommon() {
      this.phase = "deploy";
      // 初始自动排阵：按（武力+统帅）从强到弱依次填 前锋→左翼→右翼→中军→后备，可手动对调；
      // filter(Boolean) 容许外部战场人数不足 10（如边境战一方现身武将较少）时某些战线只分到 0~1 员
      const deploy = arr => {
        const sorted = arr.slice().sort((a, b) => (b.wu + b.tong) - (a.wu + a.tong));
        const pos = {};
        this.POSITIONS.forEach(([k], i) => { pos[k] = [sorted[i * 2], sorted[i * 2 + 1]].filter(Boolean); });
        return pos;
      };
      this.myPos = deploy(this.mine); this.foePos = deploy(this.foes);
      this.myForm = "cone";
      const fk = Object.keys(this.FORMS); this.foeForm = fk[randInt(0, fk.length - 1)];
      this.foeFormKnown = false;
      const tk = Object.keys(this.TERRAINS); this.terrain = tk[randInt(0, tk.length - 1)];
      // 军令数由全军智谋所定（智将云集则调度自如），敌军同理
      this.orders = this.calcOrders(this.mine);
      this.foeOrders = this.calcOrders(this.foes);
      // 兵力 = Σ统帅×100：斗将阶段静态展示，破阵阶段随战况折损；
      // 有城池驻军覆盖时，先按自然值算出缩放系数，实际兵力与后续各线兵力一并按此系数换算
      const myNatural = this.mine.reduce((s, g) => s + g.tong * 100, 0) || 1;
      const foeNatural = this.foes.reduce((s, g) => s + g.tong * 100, 0) || 1;
      this.myScale = this.troopScale ? this.troopScale.mine / myNatural : 1;
      this.foeScale = this.troopScale ? this.troopScale.foe / foeNatural : 1;
      this.myTroops = this.myTroops0 = this.troopScale ? this.troopScale.mine : myNatural;
      this.foeTroops = this.foeTroops0 = this.troopScale ? this.troopScale.foe : foeNatural;
      this.myMorale = 50; this.foeMorale = 50;
      this.duelRound = 0; this.myDuelWins = 0; this.foeDuelWins = 0;
      this.dead = new Set();
      this.usedDuelists = new Set();   // 斗将三阵须各遣一将，胜者亦不得再出
      this.usedFoeDuelists = new Set();   // 敌方出阵搦战的武将同样不得重复出战
      this.lanes = null; this.orderMode = null; this.tickN = 0; this.logLines = [];
      this.assault = false; this.paused = false; this.everStarted = false; this.speed = 1;
      this.stats = { myFall: 0, foeFall: 0, myBreach: 0, foeBreach: 0 };
      this.swapSel = null;
      showScreen("field");
      this.applyTickMs();
      // 全自动推演（边境战主角未被抽中亲历）：跳过排兵布阵画面/点将出阵等一切手动确认，直接进入斗将流程
      if (this.external && this.external.auto) this.renderDuel();
      else this.renderDeploy();
    },
    // 冷却环的 transition-duration 与实际刻间隔同步，使调速时动画节奏保持连续跟手（见 --fbtickms）
    applyTickMs() { document.documentElement.style.setProperty("--fbtickms", Math.round(1100 / (this.speed || 1)) + "ms"); },
    // 总攻控制钮的当前文案：攻击（一次性初始态，此时全局暂停）→ ×1 → ×2 → ×4 → 暂停 → ×1 → …（循环）
    assaultCtrlLabel() {
      if (!this.everStarted) return "开始总攻";
      return this.paused ? "暂停" : `×${this.speed}`;
    },
    // 总攻调速+暂停合一钮：去除原音乐钮左侧的独立倍速按钮，改与暂停功能合并为单钮循环
    assaultCtrlClick() {
      const wasStarted = this.everStarted;
      if (!wasStarted || this.paused) {
        this.everStarted = true; this.paused = false; this.speed = 1;
        this.log(wasStarted ? "▶ 军令再起，厮杀继续！" : "⚔️ 传令攻击！全军压上，两军对圆！");
      } else if (this.speed < 4) {
        this.speed *= 2;
      } else {
        this.paused = true;
        this.log("⏸ 传令暂歇——两军罢手对峙，从容运筹");
      }
      this.applyTickMs();
      if (this.assault && this.phase === "clash" && this.timer) {
        clearInterval(this.timer);
        const myGen = this.gen;
        this.timer = setInterval(() => this.tick(myGen), Math.round(1100 / (this.speed || 1)));
      }
      const b = $("#fb-ord-ctrl");
      if (b) b.textContent = this.assaultCtrlLabel();
    },
    abort() { this.gen++; clearInterval(this.timer); this.timer = null; this.phase = null; FieldFX.stop(); },
    alive(g) { return !this.dead.has(g.id); },
    // 全军智谋均值折算军令道数（约 2~6 道）
    calcOrders(arr) {
      if (!arr.length) return 2;   // 无兵无将的一方（如空虚的对马番所）军令按下限计，避免 0/0 除出 NaN
      const avg = arr.reduce((s, g) => s + g.zhi, 0) / arr.length;
      return Math.max(2, Math.min(6, Math.round((avg - 30) / 12)));
    },
    laneZhi(side, laneK) {
      const pos = side === "my" ? this.myPos : this.foePos;
      return pos[laneK].filter(g => this.alive(g)).reduce((s, g) => s + g.zhi, 0);
    },
    laneMei(side, laneK) {
      const pos = side === "my" ? this.myPos : this.foePos;
      return pos[laneK].filter(g => this.alive(g)).reduce((s, g) => s + (g.mei || 0), 0);
    },
    laneSkilled(side, laneK) {
      const pos = side === "my" ? this.myPos : this.foePos;
      return pos[laneK].filter(g => this.alive(g)).map(g => ({ g, sk: Skill.of(g) }));
    },
    armyHas(side, type) {
      const arr = side === "my" ? this.mine : this.foes;
      return arr.some(g => this.alive(g) && (Skill.NAMED[g.name] || {}).type === type);
    },
    // 该线该方全部持有「主动」将魂的武将（每线两将各自持技能钮，互不互斥）
    laneActiveSkilled(side, laneK) {
      return this.laneSkilled(side, laneK).filter(x => Skill.ACTIVE_WAR_TYPES.has(x.sk.type));
    },
    // 每刻推进各线双方每员武将各自的将魂冷却（每将独立冷却，同线两将可各自反复触发）；阵亡即清除
    tickSkillCooldowns() {
      this.LANES.forEach(k => {
        const L = this.lanes[k];
        if (L.broken) return;
        ["my", "foe"].forEach(side => {
          const cdsKey = side + "SkillCds";
          const map = L[cdsKey] = L[cdsKey] || {};
          const active = this.laneActiveSkilled(side, k);
          const aliveIds = new Set(active.map(x => x.g.id));
          Object.keys(map).forEach(id => { if (!aliveIds.has(+id)) delete map[id]; });   // 该将阵亡：清除其冷却槽
          active.forEach(({ g, sk }) => {
            let st = map[g.id];
            if (!st) { const cd = this.warCD(g); map[g.id] = { cd, cdMax: cd }; return; }   // 新入列先充能，不立即发动
            st.cd--;
            if (st.cd <= 0) {
              this.fireWarSkill(side, k, g, sk.type);
              st.cd = st.cdMax;
            }
          });
        });
      });
    },
    // 主动将魂效果实装：小幅但频繁的“爆发”，配合冷却钮达成敌我对等、可反复触发的均衡强度；
    // 该线该方若两将同时持有主动将魂（现每将独立冷却，不再互斥），单次效果按 ×0.6 折算——
    // 两名同时在线仍比单emitter更频繁生效（合计约 ×1.2），但避免总吞吐量翻倍冲垮阵形/军令等既有强度设定（如雁行乱箭）
    fireWarSkill(side, laneK, g, type) {
      const L = this.lanes[laneK];
      const we = side === "my" ? "我军" : "敌军", sk = Skill.of(g);
      const scale = this.laneActiveSkilled(side, laneK).length > 1 ? 0.6 : 1;
      const dealDmg = amt => {
        amt = Math.round(amt * scale);
        if (side === "my") { L.foeTr = Math.max(0, L.foeTr - amt); this.foeTroops = Math.max(0, this.foeTroops - amt); if (L.foeTr <= 0) this.breach("my", laneK); }
        else { L.myTr = Math.max(0, L.myTr - amt); this.myTroops = Math.max(0, this.myTroops - amt); if (L.myTr <= 0) this.breach("foe", laneK); }
        return amt;
      };
      const healTr = amt => {
        amt = Math.round(amt * scale);
        if (side === "my") { const add = Math.min(amt, L.myTr0 - L.myTr); if (add > 0) { L.myTr += add; this.myTroops += add; } }
        else { const add = Math.min(amt, L.foeTr0 - L.foeTr); if (add > 0) { L.foeTr += add; this.foeTroops += add; } }
        return amt;
      };
      const dropFoeMor = amt => { amt = Math.round(amt * scale); if (side === "my") L.foeMor = Math.max(5, L.foeMor - amt); else L.myMor = Math.max(5, L.myMor - amt); return amt; };
      const boostMyMor = amt => { amt = Math.round(amt * scale); if (side === "my") L.myMor = Math.min(100, L.myMor + amt); else L.foeMor = Math.min(100, L.foeMor + amt); return amt; };
      const pos = this.posName(laneK);
      let msg = "";
      if (type === "school-wu") { const dmg = dealDmg(g.wu * 2.8); msg = `${g.name}【${sk.n}】陷阵突击，${pos}线斩敌 ${dmg.toLocaleString()} 众！`; }
      else if (type === "school-ti") { const amt = healTr(g.ti * 8); msg = `${g.name}【${sk.n}】游走整军，${pos}线补充兵力 ${amt.toLocaleString()}！`; }
      else if (type === "school-mei") { const amt = boostMyMor(Math.max(5, g.mei / 10)); msg = `${g.name}【${sk.n}】振臂高呼，${pos}线士气 +${amt}！`; }
      else if (type === "school-zheng") { const amt = healTr(g.zheng * 1.3); msg = `${g.name}【${sk.n}】调度粮秣，${pos}线补充兵力 ${amt.toLocaleString()}！`; }
      else if (type === "awe") { const amt = dropFoeMor(10); msg = `⭐ ${g.name}【${sk.n}】横戟怒喝，${pos}线对面为之胆寒（士气 -${amt}）！`; }
      else if (type === "discord") { const amt = dropFoeMor(12); msg = `⭐ ${g.name}【${sk.n}】暗施连环，${pos}线对面自乱阵脚（士气 -${amt}）！`; }
      else if (type === "roar") { const amt = dropFoeMor(10); msg = `⭐ ${g.name}【${sk.n}】断喝如雷，${pos}线敌军肝胆俱裂（士气 -${amt}）！`; }
      else if (type === "infiltrate") { const dmg = dealDmg(randInt(700, 1200)); msg = `⭐ ${g.name}【${sk.n}】潜行突袭，${pos}线偷袭得手，斩敌 ${dmg.toLocaleString()} 众！`; }
      else if (type === "volley") { const dmg = dealDmg(randInt(190, 320)); msg = `⭐ ${g.name}【${sk.n}】连番齐射，${pos}线重创敌军 ${dmg.toLocaleString()} 众！`; }
      else if (type === "dualblade") { const dmg = dealDmg(g.wu * 3.2); msg = `⭐ ${g.name}【${sk.n}】连番猛击，${pos}线斩敌 ${dmg.toLocaleString()} 众！`; }
      else if (type === "tempo") { const dmg = dealDmg(g.wu); const mor = boostMyMor(8); msg = `⭐ ${g.name}【${sk.n}】临阵调度，${pos}线我方士气 +${mor}、敌军受挫 ${dmg.toLocaleString()} 众！`; }
      if (msg) { this.log("🌟 " + msg); toast("🌟 " + msg); this.flashLane(laneK, side, g.id); FieldFX.burst(laneK, "skill"); }
    },
    flashLane(laneK, side, genId) {
      const el = document.querySelector(`.fb-lane[data-lane="${laneK}"]`);
      if (!el) return;
      const badge = document.getElementById(`fb-sk-${side}-${laneK}-${genId}`);
      const target = badge || el;
      target.classList.remove("fire"); void target.offsetWidth; target.classList.add("fire");
      setTimeout(() => target.classList && target.classList.remove("fire"), 700);
    },
    chip(g, posK, idx, sel) {
      const dead = !this.alive(g);
      return `<button class="fb-chip ${g.side} ${sel ? "sel" : ""} ${dead ? "dead" : ""}" data-pos="${posK}" data-idx="${idx}" ${dead ? "disabled" : ""}>
        ${g.name}<small>武${g.wu} 统${g.tong} 智${g.zhi}</small>${Skill.tag(g)}</button>`;
    },
    /* ---------- 第〇环 · 排兵布阵 ---------- */
    renderDeploy() {
      const t = this.TERRAINS[this.terrain];
      this.showFieldCanvas("deploy");
      FieldFX.drawDeployPreview($("#fb-deploy-canvas"), this);
      $("#fb-content").innerHTML = `
        <div class="section-hint">两军对圆：先排兵选阵，再阵前斗将，后挥军破阵——士气贯穿全场；军令我 <b>${this.orders}</b> 道 · 敌 <b>${this.foeOrders}</b> 道（全军智谋越高军令越多），省着用</div>
        <div class="fb-banner">${t.icon} 战场·${t.n}<small>${t.desc}</small></div>
        <div class="fb-sect">我方阵形（与敌阵有相克：克敌全军 +12%）</div>
        <div class="fb-forms">${Object.entries(this.FORMS).map(([k, f]) =>
          `<button class="fb-form ${k === this.myForm ? "active" : ""}" data-form="${k}">${f.icon} ${f.n}<small>${f.desc}</small></button>`).join("")}</div>
        <div class="fb-sect">敌军阵形：${this.foeFormKnown
          ? `<b>${this.FORMS[this.foeForm].icon} ${this.FORMS[this.foeForm].n}</b>（${this.FORMS[this.foeForm].desc}）`
          : `旌旗蔽日看不真切 <button class="cup-go" id="fb-scout" ${this.orders > 0 ? "" : "disabled"} style="padding:4px 10px">🕵️ 斥候探阵（耗 1 军令）</button>`}</div>
        <div class="fb-sect">我方布阵（敌军在上方——点两名武将互换位置，文官压前锋是要吃败仗的）<br><small style="font-weight:400;opacity:.75">每员武将按六维之长自带「将魂」技能（⭐ 为名将专属，长按可看说明）；主动型技能会在总攻各战线两端化作技能钮（该线两将各占一枚、各自独立冷却），冷却完毕自动发动（战报+提示+闪光三重提醒）；被动型技能常驻生效，以灰环徽标标出</small></div>
        <div class="fb-board2">${this.POSITIONS.map(([k, n]) => `
          <div class="fb-slot fb-slot-${k}"><span class="fb-pos-lbl">${n}</span>
            ${this.myPos[k].map((g, i) => this.chip(g, k, i, this.swapSel && this.swapSel.pos === k && this.swapSel.idx === i)).join("")}
          </div>`).join("")}</div>
        <div class="fb-sect">${this.foes.length
          ? `敌将共 ${this.foes.length} 员，为首者 ${this.foes.slice().sort((a, b) => b.wu - a.wu)[0].name}`
          : "敌军城中空虚，未见一兵一将——此行形同不战而胜"}</div>
        <div class="cup-start-btns" style="margin-top:10px"><button class="cup-go primary" id="fb-go">🥁 擂鼓 · 两军对圆</button></div>`;
      $$(".fb-form").forEach(b => b.onclick = () => { this.myForm = b.dataset.form; this.renderDeploy(); });
      const scout = $("#fb-scout");
      if (scout) scout.onclick = () => {
        if (this.orders <= 0) return;
        this.orders--; this.foeFormKnown = true;
        toast(`🕵️ 斥候回报：敌军摆的是${this.FORMS[this.foeForm].n}之阵！（军令余 ${this.orders}）`);
        this.renderDeploy();
      };
      $$(".fb-chip", $("#fb-content")).forEach(c => c.onclick = () => {
        const pos = c.dataset.pos, idx = +c.dataset.idx;
        if (!this.swapSel) { this.swapSel = { pos, idx }; this.renderDeploy(); return; }
        const a = this.swapSel; this.swapSel = null;
        if (a.pos !== pos || a.idx !== idx) {
          const tmp = this.myPos[a.pos][a.idx];
          this.myPos[a.pos][a.idx] = this.myPos[pos][idx];
          this.myPos[pos][idx] = tmp;
        }
        this.renderDeploy();
      });
      $("#fb-go").onclick = () => this.renderDuel();
    },
    /* ---------- 第一环 · 阵前斗将 ---------- */
    challenger() {
      const pool = this.foes.filter(g => this.alive(g) && !this.usedFoeDuelists.has(g.id));
      return pool.sort((a, b) => b.wu - a.wu)[0] || null;
    },
    renderDuel() {
      this.phase = "duel";
      const foe = this.challenger();
      if (!foe || this.duelRound >= 3) { this.startClash(); return; }
      this.usedFoeDuelists.add(foe.id);   // 已搦战出阵者，此局不得再战
      // 全自动推演：不弹点将名单，直接从可用武将中抽一员应战（无人可遣则视同避战）
      if (this.external && this.external.auto) {
        const cands = this.mine.filter(g => this.alive(g) && !this.usedDuelists.has(g.id));
        if (!cands.length) {
          this.myMorale = Math.max(5, this.myMorale - (this.terrain === "river" ? 6 : 4));
          this.duelRound++;
          this.renderDuel();
          return;
        }
        this.runDuel(cands[randInt(0, cands.length - 1)], foe);
        return;
      }
      $("#fb-content").innerHTML = `
        <div class="fb-banner">⚔️ 阵前斗将 · 第 ${this.duelRound + 1}/3 阵${this.moraleBarHtml()}</div>
        <div class="fb-duel-card ${foe.side}">
          <div class="fb-duel-av">${avatarChar(foe.name)}</div>
          <div class="fb-duel-meta"><b>${foe.name}</b>纵马出阵，横刀立马点名搦战！<small>总评 ${ratingScore(foe)} · 武 ${foe.wu} · 统 ${foe.tong} · 体 ${foe.ti}</small>${Skill.tag(foe)}</div>
        </div>
        <div class="section-hint">胜一阵敌胆寒（士气 ±6${this.terrain === "river" ? "，河畔 ×1.5" : ""}），连斩三将敌军未战先乱；避战不出则己方士气 -4，出阵者若被斩折损更重</div>
        <div class="fb-btnrow">
          <button class="cup-go" id="fb-decline">避战不出（士气 -4）</button>
          <button class="cup-go primary" id="fb-fight">出将应战</button>
        </div>`;
      $("#fb-fight").onclick = () => this.pickDuelist(foe);
      $("#fb-decline").onclick = () => {
        const loss = this.terrain === "river" ? 6 : 4;
        this.myMorale = Math.max(5, this.myMorale - loss);
        toast(`鸣金避战，${foe.name} 阵前耀武扬威——己方士气 -${loss}`);
        this.duelRound++;
        this.renderDuel();
      };
    },
    // 主角本人与其团队成员可亲自操控斗将单挑，其余武将只能自动接战（旁观）。
    // 根因修复：主角自立当主后，declareIndependence 会清空 Bond.data.team（团队并入势力，见该处注释），
    // 此后 myRoster() 改走 generalFaction 取「本势力麾下」，但本函数仍死认 Bond.data.team——
    // 团队既已清空且永不再填，自立之后但凡挑到任何一将出阵，一律被判定为"不可操控"，全部自动接战，
    // 玩家亲自出征却连自己的爱将都点不动。主角本人（id -1）任何时候都该能亲自上阵；
    // 自立当主后麾下武将即"本势力麾下"这一集合，理应继承团队成员原有的可操控权
    controllable(g) {
      if (!RPG.char) return false;
      if (g.id === -1) return true;
      const m = typeof Campaign !== "undefined" && Campaign.mapState && Campaign.mapState();
      if (m && m.playerFaction === "_player_") return (m.generalFaction || {})[g.id] === "_player_";
      return !!(typeof Bond !== "undefined" && Bond.data && (Bond.data.team || []).includes(g.id));
    },
    pickDuelist(foe) {
      // 三阵各遣一将：已出战者（无论胜败存亡）不得再出
      const cands = this.mine.filter(g => this.alive(g) && !this.usedDuelists.has(g.id));
      if (!cands.length) { toast("已无可遣之将，唯有避战不出"); return; }
      openOverlay(`<div class="result-card detail-card" style="width:min(520px,94vw);max-height:96vh">
        <h1>点将出阵</h1>
        <div class="wdesc">谁去会一会 ${foe.name}（总评 ${ratingScore(foe)} · 武 ${foe.wu}）？每阵须遣不同武将；仅你的团队成员可亲自操控，余者自动接战。</div>
        <div class="menu" style="max-height:74vh;overflow:auto">${cands.map(g =>
          `<button class="menu-btn fb-pick" data-gid="${g.id}"><span class="mi">${avatarChar(g.name)}</span><span>${g.name} ${Skill.tag(g)}<b style="float:right">总评 ${ratingScore(g)}</b><small>武 ${g.wu} · 统 ${g.tong} · 体 ${g.ti}${this.controllable(g) ? " · 🎮 可操控" : " · 自动接战"}</small></span></button>`).join("")}</div>
        <div class="btns"><button class="btn-ghost" id="fb-pick-cancel">再想想</button></div>
      </div>`, { modal: true });
      $$(".fb-pick").forEach(b => b.onclick = () => { closeOverlay(); this.runDuel(this.mine.find(g => g.id === +b.dataset.gid), foe); });
      $("#fb-pick-cancel").onclick = () => { closeOverlay(); };
    },
    async runDuel(mineG, foe) {
      if (!mineG) return;
      const myGen = this.gen;
      this.usedDuelists.add(mineG.id);
      const res = await startTeamDuel(clone(mineG), clone(foe), {
        title: "阵前斗将", backScreen: "field",
        spectate: (this.external && this.external.auto) || !this.controllable(mineG),
        intro: `两军阵前，${mineG.name} 迎战 ${foe.name}——三军瞩目，胜负关乎全军士气！`,
      });
      if (this.gen !== myGen) return;
      showScreen("field");
      if (!res) { this.renderDuel(); return; }   // 中途退出：本阵作罢，不计胜负（该将已出阵，不得再出）
      const swing = Math.round(6 * (this.terrain === "river" ? 1.5 : 1));
      // 斗将阶段士气只泄不竭（保底 5）：无论多惨烈，挥军破阵这场正戏都要照打
      if (res.winner.name === mineG.name) {
        this.dead.add(foe.id); this.stats.foeFall++;
        this.myDuelWins++;
        this.myMorale = Math.min(100, this.myMorale + swing);
        this.foeMorale = Math.max(5, this.foeMorale - swing);
        let msg = `⚔️ ${mineG.name} 阵前斩 ${foe.name}！己方士气 +${swing}，敌军 -${swing}`;
        const sk = Skill.NAMED[mineG.name];
        if (sk && sk.type === "duelmorale") { this.myMorale = Math.min(100, this.myMorale + swing); msg += `——⭐【${sk.n}】威震三军，士气收益翻倍！`; }
        if (this.myDuelWins >= 3) { this.foeMorale = Math.max(5, this.foeMorale - 8); msg += `——连斩三将，敌军未战先乱（再 -8）！`; }
        toast(msg);
      } else {
        this.dead.add(mineG.id); this.stats.myFall++;
        this.foeDuelWins++;
        this.foeMorale = Math.min(100, this.foeMorale + swing);
        this.myMorale = Math.max(5, this.myMorale - swing);
        let msg = `💀 ${mineG.name} 被 ${foe.name} 斩于阵前！己方士气 -${swing}`;
        const fsk = Skill.NAMED[foe.name];
        if (fsk && fsk.type === "duelmorale") { this.foeMorale = Math.min(100, this.foeMorale + swing); msg += `——敌将⭐【${fsk.n}】威震三军，敌士气再 +${swing}！`; }
        toast(msg);
      }
      this.duelRound++;
      this.renderDuel();
    },
    /* ---------- 第二环 · 挥军破阵（五线；先点主攻再击鼓总攻） ---------- */
    startClash() {
      this.phase = "clash";
      this.tickN = 0;
      // 斗将既毕即刻进入总攻页面（不再有中间确认页），但节奏本身先按下暂停——
      // 待玩家点【攻击】钮亲自下令方才开打，钮上同时兼管调速（攻击→×1→×2→×4→暂停→循环）
      this.assault = true; this.paused = true; this.everStarted = false;
      this.lanes = {};
      // 各线兵力 = 该线两将统帅×100，再按 _setupCommon 算好的城池驻军缩放系数换算；各线士气开局取全军总士气，此后独立涨落；
      // 战线只在该线兵力耗尽（或全军士气崩溃）时才告破
      this.LANES.forEach(k => {
        const myTr = this.myPos[k].reduce((s, g) => s + g.tong * 100, 0) * this.myScale;
        const foeTr = this.foePos[k].reduce((s, g) => s + g.tong * 100, 0) * this.foeScale;
        this.lanes[k] = {
          broken: null, myHold: 0,
          myTr, myTr0: myTr, foeTr, foeTr0: foeTr,
          myMor: this.myMorale, foeMor: this.foeMorale,
          // 将魂主动技能：战线旁每将各占一枚按钮自动冷却发动，冷却完毕即触发（见 tickSkillCooldowns），键为武将 id
          mySkillCds: {}, foeSkillCds: {},
        };
      });
      this.showFieldCanvas("battle");
      FieldFX.mount($("#fb-canvas"));
      this.renderClash();
      // 敌我同享阵形加成——开战时把双方阵形效果都摆到明面上
      this.log(`🥁 战鼓雷动，五线接敌！我军${this.FORMS[this.myForm].n}阵（${this.FORMS[this.myForm].desc}） 对 敌军${this.FORMS[this.foeForm].n}阵（${this.FORMS[this.foeForm].desc}）${this.beats(this.myForm, this.foeForm) ? "——我阵克敌，全线攻 +12%！" : this.beats(this.foeForm, this.myForm) ? "——敌阵克我（敌攻 +12%），小心！" : ""}`);
      // 全自动推演：无需玩家点【攻击】，径直以最高倍速开打
      if (this.external && this.external.auto) { this.everStarted = true; this.paused = false; this.speed = 4; this.applyTickMs(); }
      const myGen = this.gen;
      // 基准刻 1100ms 留出下令余裕；tick() 内 this.paused 为真时直接跳过，故此刻虽已建好定时器但按兵不动，等玩家点【攻击】钮
      this.timer = setInterval(() => this.tick(myGen), Math.round(1100 / (this.speed || 1)));
    },
    beats(a, b) { return this.FORMS[a].beats === b; },
    // 主动将魂冷却按持有者统帅浮动：统帅越高，将令传达越快，冷却越短——4~14 刻宽幅拉开差距，避免各将扎堆同刻发动
    warCD(g) { return Math.max(4, Math.min(14, Math.round(14 - ((g.tong || 0) - 40) / 7))); },
    // 各线攻/防 = 该线存活武将的平均武力/统帅（攻偏武、防偏统）× 阵形地形加成 × 该线士气
    laneStat(side, laneK, mode) {
      const pos = side === "my" ? this.myPos : this.foePos;
      const alive = pos[laneK].filter(g => this.alive(g));
      if (!alive.length) return 10;
      const wu = alive.reduce((s, g) => s + g.wu, 0) / alive.length;
      const tong = alive.reduce((s, g) => s + g.tong, 0) / alive.length;
      const form = side === "my" ? this.myForm : this.foeForm;
      let p = mode === "atk" ? wu * 0.65 + tong * 0.35 : tong * 0.65 + wu * 0.35;
      if (mode === "atk") {
        if (form === "cone" && (laneK === "van" || laneK === "center")) p *= 1.2;
        if (form === "crane" && (laneK === "left" || laneK === "right")) p *= 1.2;
        if (this.terrain === "pass" && (laneK === "left" || laneK === "right")) p *= 0.5;
        const foeForm = side === "my" ? this.foeForm : this.myForm;
        if (this.beats(form, foeForm)) p *= 1.12;
      } else {
        if (form === "round") p *= 1.25;   // 方圆阵长于守
        // 将魂被动：坚壁（帅才 +10%）/ 无伤·西国无双（+20%）/ 虎痴（+15%）
        pos[laneK].filter(g => this.alive(g)).forEach(g => {
          const t = Skill.of(g).type;
          if (t === "school-tong") p *= 1.1;
          if (t === "adamant") p *= 1.2;
          if (t === "tiger") p *= 1.15;
        });
      }
      // 将魂被动：日本一兵（真田幸村所在线攻守 +8%）
      if (pos[laneK].some(g => this.alive(g) && Skill.of(g).type === "sanada")) p *= 1.08;
      const L = this.lanes && this.lanes[laneK];
      const mor = L ? (side === "my" ? L.myMor : L.foeMor) : (side === "my" ? this.myMorale : this.foeMorale);
      p *= 0.5 + 0.8 * mor / 100;
      return p;
    },
    tick(myGen) {
      if (this.gen !== myGen || this.phase !== "clash" || this.paused) return;
      this.tickN++;
      const sd = this.tickN > 60 ? 1.6 : 1;   // 胶着逾60刻进入决胜时刻：烈度加快，务必分出胜负
      if (this.tickN === 61) this.log(`⚡ 决胜时刻！两军杀红了眼，战局加速倾泻`);
      this.LANES.forEach(k => {
        const L = this.lanes[k];
        if (L.broken) return;
        // 攻方战力打对方，守方战力抵折损：折损 ∝ 敌攻/我守；鸣金守倍增（擂鼓改为振奋该线士气）
        const myAtk = this.laneStat("my", k, "atk");
        const foeAtk = this.laneStat("foe", k, "atk");
        const myDef = this.laneStat("my", k, "def") * (this.tickN < L.myHold ? 2 : 1);
        const foeDef = this.laneStat("foe", k, "def");
        let myLoss = 220 * foeAtk / Math.max(myDef, 1) * (0.9 + Math.random() * 0.2) * sd;
        let foeLoss = 220 * myAtk / Math.max(foeDef, 1) * (0.9 + Math.random() * 0.2) * sd;
        // 将魂被动：游击/隐忍持续减损（主动型将魂改由战线旁技能钮冷却自动发动，见 tickSkillCooldowns）
        this.laneSkilled("my", k).forEach(({ g, sk }) => {
          if (sk.type === "rescue") myLoss *= 0.9;
          if (sk.type === "endure") myLoss *= 0.8;
        });
        this.laneSkilled("foe", k).forEach(({ g, sk }) => {
          if (sk.type === "rescue") foeLoss *= 0.9;
          if (sk.type === "endure") foeLoss *= 0.8;
        });
        myLoss = Math.min(L.myTr, myLoss); foeLoss = Math.min(L.foeTr, foeLoss);
        L.myTr -= myLoss; L.foeTr -= foeLoss;
        this.myTroops = Math.max(0, this.myTroops - myLoss);
        this.foeTroops = Math.max(0, this.foeTroops - foeLoss);
        // 该线士气随战况小幅涨落：折损比低的一方越战越勇
        const edge = (foeLoss - myLoss) / 500;
        L.myMor = Math.max(5, Math.min(100, L.myMor + edge * 0.5));
        L.foeMor = Math.max(5, Math.min(100, L.foeMor - edge * 0.5));
        if (L.foeTr <= 0 && L.myTr > 0) this.breach("my", k);
        else if (L.myTr <= 0 && L.foeTr > 0) this.breach("foe", k);
        else if (L.myTr <= 0 && L.foeTr <= 0) this.breach(L.myMor >= L.foeMor ? "my" : "foe", k);
      });
      // 雁行乱箭：敌方各线士气持续流失（每刻 -0.4，肉眼可见地蚀敌）
      if (this.myForm === "goose") {
        this.LANES.forEach(k => { const L = this.lanes[k]; if (!L.broken) L.foeMor = Math.max(5, L.foeMor - 0.4); });
      }
      if (this.foeForm === "goose") {
        this.LANES.forEach(k => { const L = this.lanes[k]; if (!L.broken) L.myMor = Math.max(5, L.myMor - 0.4); });
      }
      // 将魂主动技能：战线旁按钮冷却推进，冷却完毕自动发动（含视觉/日志/toast 提醒）
      this.tickSkillCooldowns();
      // 敌军军令 AI：军令未罄时择机擂鼓或施计（计谋成败看战线上敌我智谋之和）
      if (this.tickN % 5 === 0 && this.foeOrders > 0 && Math.random() < 0.4) {
        const open = this.LANES.filter(k => !this.lanes[k].broken);
        if (open.length) {
          this.foeOrders--;
          if (Math.random() < 0.5) {
            const losing = open.slice().sort((a, b) => (this.lanes[a].foeTr / this.lanes[a].foeTr0) - (this.lanes[b].foeTr / this.lanes[b].foeTr0))[0];
            FieldFX.burst(losing, "drum");
            const gain = Math.max(3, Math.round(this.laneMei("foe", losing) / 12));
            this.lanes[losing].foeMor = Math.min(100, this.lanes[losing].foeMor + gain);
            this.log(`🥁 敌阵中军擂鼓，${this.posName(losing)}线敌军士气大振（+${gain}，敌令余 ${this.foeOrders}）`);
          } else {
            const target = open.slice().sort((a, b) =>
              (this.laneZhi("foe", b) - this.laneZhi("my", b)) - (this.laneZhi("foe", a) - this.laneZhi("my", a)))[0];
            FieldFX.burst(target, "scheme");
            const p = this.schemeP("foe", target);
            if (Math.random() < p) {
              const L = this.lanes[target];
              L.myMor = Math.max(5, L.myMor - 15);
              this.log(`🧠 敌军诡计得逞！${this.posName(target)}线我军中计大乱（该线士气 -15，敌令余 ${this.foeOrders}）`);
            } else {
              const L = this.lanes[target];
              L.foeMor = Math.max(5, L.foeMor - 5);
              this.log(`🛡️ 敌军诡计被我军看破，${this.posName(target)}线敌军自乱（该线敌士气 -5，敌令余 ${this.foeOrders}）`);
            }
          }
        }
      }
      if (this.checkClashEnd()) return;
      this.updateClashDom();
    },
    breach(winner, laneK) {
      const L = this.lanes[laneK];
      if (L.broken) return;
      L.broken = winner;
      L.brokenAt = performance.now();   // 供 FieldFX 画败退淡出/位移动画
      const nbs = { van: ["left", "right"], left: ["van", "center"], right: ["van", "center"], center: ["left", "right", "reserve"], reserve: ["center"] }[laneK] || [];
      if (winner === "my") {
        this.stats.myBreach++;
        nbs.forEach(n => { const N = this.lanes[n]; if (!N.broken) N.foeMor = Math.max(5, N.foeMor - 8); });
        this.log(`💥 敌军${this.posName(laneK)}线兵力耗尽，全线告破！溃兵冲乱敌军邻线（邻线敌士气 -8）`);
      } else {
        this.stats.foeBreach++;
        nbs.forEach(n => { const N = this.lanes[n]; if (!N.broken) N.myMor = Math.max(5, N.myMor - 8); });
        this.log(`⚠️ 我军${this.posName(laneK)}线兵力耗尽，战线失守！溃兵冲乱邻线（邻线我士气 -8）`);
      }
    },
    checkClashEnd() {
      // 战线士气再低也不判负：唯兵力耗尽定胜负——一方五线兵力尽墨即败
      if (this.foeTroops <= 0) { this.finish(true, "敌军五线兵力折损殆尽，全军覆没"); return true; }
      if (this.myTroops <= 0) { this.finish(false, "我军五线兵力折损殆尽，力竭而败"); return true; }
      const myB = this.LANES.filter(k => this.lanes[k].broken === "my").length;
      const foeB = this.LANES.filter(k => this.lanes[k].broken === "foe").length;
      if (myB + foeB >= 5) { this.finish(this.myTroops > this.foeTroops, "五线战罢，存兵多者胜"); return true; }
      return false;
    },
    /* 军令：点军令钮再点目标战线（含奇袭） */
    useOrder(kind, laneK) {
      if (this.orders <= 0) { toast("军令已用尽！"); return; }
      const L = this.lanes[laneK];
      if (!L || L.broken) { toast("此线战事已了"); return; }
      if (kind === "raid") {
        const cands = this.myPos.reserve.filter(g => this.alive(g));
        if (!cands.length) { toast("后路已无可遣之将"); this.orderMode = null; this.renderClash(); return; }
        this.orders--;
        FieldFX.burst(laneK, "raid");
        const g = cands.sort((a, b) => b.zhi - a.zhi)[0];
        const p = 0.5 + (g.zhi - 70) / 250 + (this.terrain === "river" ? 0.15 : 0);
        if (Math.random() < p) {
          const kill = randInt(1500, 2500);
          L.foeTr = Math.max(0, L.foeTr - kill);
          this.foeTroops = Math.max(0, this.foeTroops - kill);
          L.foeMor = Math.max(5, L.foeMor - 10);
          this.log(`🐎 ${g.name} 奇袭${this.posName(laneK)}线侧后得手！焚粮劫寨斩 ${kill.toLocaleString()} 众（该线敌士气 -10）`);
          if (L.foeTr <= 0) this.breach("my", laneK);
        } else {
          this.dead.add(g.id); this.stats.myFall++;
          const RL = this.lanes.reserve;
          if (RL && !RL.broken) RL.myMor = Math.max(5, RL.myMor - 10);
          this.log(`💀 ${g.name} 奇袭${this.posName(laneK)}线被敌军识破，力战殉国——后路军心动摇（该线士气 -10）`);
        }
        this.afterOrder(); return;
      }
      this.orders--;
      if (kind === "drum") {
        // 擂鼓振军：提振该线士气，幅度取决于该线武将魅力总值
        FieldFX.burst(laneK, "drum");
        const gain = Math.max(3, Math.round(this.laneMei("my", laneK) / 12));
        L.myMor = Math.min(100, L.myMor + gain);
        this.log(`🥁 擂鼓！${this.posName(laneK)}线将士闻声振奋（魅力合计 ${this.laneMei("my", laneK)}，该线士气 +${gain}）`);
      }
      if (kind === "hold") { FieldFX.burst(laneK, "hold"); L.myHold = this.tickN + 8; this.log(`🛡️ 鸣金稳守！${this.posName(laneK)}线我军守备倍增、结阵如山（8 刻）`); }
      if (kind === "fire") {
        FieldFX.burst(laneK, "fire");
        const master = this.armyHas("my", "firemaster");
        const burn = randInt(800, 1500) * (master ? 2 : 1);
        L.foeTr = Math.max(0, L.foeTr - burn);
        this.foeTroops = Math.max(0, this.foeTroops - burn);
        L.foeMor = Math.max(5, L.foeMor - 8);
        this.log(`🔥 火攻！${master ? "⭐ 诸葛亮【借东风】风向骤转、火势倍增——" : ""}${this.posName(laneK)}线烧敌 ${burn.toLocaleString()} 众（该线敌士气 -8）`);
        if (L.foeTr <= 0) this.breach("my", laneK);
      }
      if (kind === "scheme") {
        FieldFX.burst(laneK, "scheme");
        // 计谋成败看该战线上敌我武将智谋之和（含将魂修正：连环/奸雄）
        const myZ = this.laneZhi("my", laneK), foeZ = this.laneZhi("foe", laneK);
        const p = this.schemeP("my", laneK);
        if (Math.random() < p) {
          L.foeMor = Math.max(5, L.foeMor - 15);
          this.log(`🧠 计谋得手！${this.posName(laneK)}线敌军中计大乱（该线士气 -15，我智 ${myZ} 对敌智 ${foeZ}）`);
        } else {
          L.myMor = Math.max(5, L.myMor - 5);
          this.log(`💫 计谋被敌军看破，${this.posName(laneK)}线我军反受其乱（该线士气 -5，我智 ${myZ} 对敌智 ${foeZ}）`);
        }
      }
      this.afterOrder();
    },
    afterOrder() { this.orderMode = null; this.renderClash(); },
    // showMorale=false（总攻页）：各线士气各自为战，总士气已无意义——只留兵力行并放大字体
    moraleBarHtml(showMorale = true) {
      const trMy = Math.max(0, this.myTroops / this.myTroops0), trFoe = Math.max(0, this.foeTroops / this.foeTroops0);
      // 兵力条在上、士气条在下；双方同一套配色，按数值高低变色（如单挑体力条：过半绿、中段黄、危殆红）
      let h = `<div class="fb-morales ${showMorale ? "" : "big"}">
        <div class="fb-mor my"><span>我军兵力</span><div class="fb-mor-bar"><i id="fb-trbar-my" style="width:${trMy * 100}%;background:${hpColor(trMy)}"></i></div><b class="fb-trnum" id="fb-tr-my">${Math.max(0, Math.round(this.myTroops)).toLocaleString()}</b></div>
        <div class="fb-mor foe"><span>敌军兵力</span><div class="fb-mor-bar foe"><i id="fb-trbar-foe" style="width:${trFoe * 100}%;background:${hpColor(trFoe)}"></i></div><b class="fb-trnum" id="fb-tr-foe">${Math.max(0, Math.round(this.foeTroops)).toLocaleString()}</b></div>
      </div>`;
      if (showMorale) h += `<div class="fb-morales">
        <div class="fb-mor my"><span>我军士气</span><div class="fb-mor-bar"><i id="fb-morbar-my" style="width:${this.myMorale}%;background:${hpColor(this.myMorale / 100)}"></i></div><b id="fb-mor-my">${Math.round(this.myMorale)}</b></div>
        <div class="fb-mor foe"><b id="fb-mor-foe">${Math.round(this.foeMorale)}</b><div class="fb-mor-bar foe"><i id="fb-morbar-foe" style="width:${this.foeMorale}%;background:${hpColor(this.foeMorale / 100)}"></i></div><span>敌军士气</span></div>
      </div>`;
      return h;
    },
    laneW(L) { const tot = L.myTr + L.foeTr; return tot > 0 ? L.myTr / tot * 100 : 50; },
    // 计谋成功率：智谋和之差 + 将魂修正（连环 ±15%、奸雄减半）
    schemeP(att, laneK) {
      const def = att === "my" ? "foe" : "my";
      let p = 0.45 + (this.laneZhi(att, laneK) - this.laneZhi(def, laneK)) / 150;
      if (this.laneSkilled(att, laneK).some(x => x.sk.type === "school-zhi")) p += 0.15;
      if (this.laneSkilled(def, laneK).some(x => x.sk.type === "school-zhi")) p -= 0.15;
      p = Math.max(0.15, Math.min(0.85, p));
      if (this.armyHas(def, "counterspy")) p *= 0.5;
      return p;
    },
    // 战线框线左右两侧的将魂技能钮堆叠：该线该方每员在世武将各占一枚（最多2枚）——
    // 主动型显示冷却环（--cdpct 0=就绪满环，1=刚触发空环，独立冷却）；被动型显示常驻徽标（无冷却，效果已生效）
    skillBadgeHtml(side, laneK) {
      const L = this.lanes[laneK];
      const pos = side === "my" ? this.myPos[laneK] : this.foePos[laneK];
      const gens = pos.filter(g => g && this.alive(g));
      if (!gens.length) return `<span class="fb-skillbtn-slot"></span>`;
      const cds = L[side + "SkillCds"] || {};
      const items = gens.map(g => {
        const sk = Skill.of(g);
        if (Skill.ACTIVE_WAR_TYPES.has(sk.type)) {
          const st = cds[g.id];
          const cdMax = (st && st.cdMax) || this.warCD(g);
          const pct = st ? Math.max(0, Math.min(1, st.cd / cdMax)) : 1;
          return `<span class="fb-skillbtn ${side}" id="fb-sk-${side}-${laneK}-${g.id}" style="--cdpct:${pct}" title="${g.name}【${sk.n}】冷却完毕自动发动（冷却 ${cdMax} 刻，随统帅浮动）">
            <span class="face"><b class="ic">${sk.icon}</b><b class="nm">${sk.n}</b></span>
          </span>`;
        }
        return `<span class="fb-skillbtn passive ${side}" title="${g.name}【${sk.n}】被动常驻，无需发动、持续生效">
          <span class="face"><b class="ic">${sk.icon}</b><b class="nm">${sk.n}</b></span>
        </span>`;
      });
      return `<span class="fb-skillstack ${side}">${items.join("")}</span>`;
    },
    // 兵力推挤的可视化已移交 #fb-canvas 全景画布（见 FieldFX.drawBand），此处只保留信息条与点击下令的
    // 命中区——姓名/士气/战线名一行，双方兵力数字一行，不再重复画一条纯文字的色条推挤
    laneHtml(k) {
      const L = this.lanes[k];
      const myGs = this.myPos[k].map(g => this.alive(g) ? g.name : `<s>${g.name}</s>`).join("、");
      const foeGs = this.foePos[k].map(g => this.alive(g) ? g.name : `<s>${g.name}</s>`).join("、");
      const state = L.broken === "my" ? `<span class="fb-broke my">突破！</span>` : L.broken === "foe" ? `<span class="fb-broke foe">失守…</span>` : "";
      const pickable = this.orderMode && !L.broken;
      return `<div class="fb-lane ${L.broken ? "done" : ""} ${pickable ? "pickable" : ""}" data-lane="${k}">
        ${this.skillBadgeHtml("my", k)}
        <div class="fb-lane-body">
          <div class="fb-lane-row1">
            <span class="fb-lane-my">${myGs}</span>
            <span class="fb-lmor my" id="fb-lmm-${k}">💪${Math.round(L.myMor)}</span>
            <span class="fb-lane-lbl">${this.posName(k)}${state}</span>
            <span class="fb-lmor foe" id="fb-lmf-${k}">💪${Math.round(L.foeMor)}</span>
            <span class="fb-lane-foe">${foeGs}</span>
          </div>
          <div class="fb-lane-row2">
            <span class="fb-trin my" id="fb-ltrm-${k}">${Math.round(L.myTr).toLocaleString()}</span>
            <span class="fb-lane-vs">⚔</span>
            <span class="fb-trin foe" id="fb-ltrf-${k}">${Math.round(L.foeTr).toLocaleString()}</span>
          </div>
        </div>
        ${this.skillBadgeHtml("foe", k)}
      </div>`;
    },
    renderClash() {
      const banner = `🥁 挥军破阵${this.orderMode ? ` · 请点选【${{ drum: "擂鼓振军", hold: "鸣金稳守", fire: "火攻", scheme: "计谋", raid: "奇袭" }[this.orderMode]}】的目标战线` : ""}`;
      $("#fb-content").innerHTML = `
        <div class="fb-banner">${banner}${this.moraleBarHtml(false)}</div>
        <div class="fb-lanes" id="fb-lanes">${this.LANES.map(k => this.laneHtml(k)).join("")}</div>
        <div class="fb-orders">
          <span class="fb-ord-left">军令 <b id="fb-orders-left">${this.orders}</b> · 敌令 <b id="fb-orders-foe">${this.foeOrders}</b></span>
          <button class="fb-ord" id="fb-ord-drum" ${this.orders ? "" : "disabled"}>🥁 擂鼓</button>
          <button class="fb-ord" id="fb-ord-hold" ${this.orders ? "" : "disabled"}>🛡️ 鸣金</button>
          <button class="fb-ord" id="fb-ord-scheme" ${this.orders ? "" : "disabled"} title="成败看战线上敌我智谋之和">🧠 计谋</button>
          <button class="fb-ord" id="fb-ord-fire" ${this.orders && (this.terrain === "pass" || this.armyHas("my", "firemaster")) ? "" : "disabled"} title="仅山道可用（军中有诸葛亮则不限地形）">🔥 火攻</button>
          <button class="fb-ord" id="fb-ord-raid" ${this.orders ? "" : "disabled"}>🐎 奇袭</button>
          <button class="fb-ord ctrl ${!this.everStarted ? "primary" : ""}" id="fb-ord-ctrl">${this.assaultCtrlLabel()}</button>
        </div>
        <div class="fb-log" id="fb-log">${(this.logLines || []).join("")}</div>`;
      [["drum", "#fb-ord-drum"], ["hold", "#fb-ord-hold"], ["fire", "#fb-ord-fire"], ["scheme", "#fb-ord-scheme"], ["raid", "#fb-ord-raid"]].forEach(([kind, sel]) => {
        const b = $(sel); if (b) b.onclick = () => { if (this.orders <= 0) return; this.orderMode = this.orderMode === kind ? null : kind; this.renderClash(); };
      });
      const ctrl = $("#fb-ord-ctrl");
      if (ctrl) ctrl.onclick = () => { this.assaultCtrlClick(); ctrl.classList.toggle("primary", !this.everStarted); };
      $$(".fb-lane", $("#fb-content")).forEach(el => el.onclick = () => {
        if (this.assault && this.orderMode) this.useOrder(this.orderMode, el.dataset.lane);
      });
    },
    // 高频只改数值/宽度，不整块重绘（避免打断点击）
    updateClashDom() {
      this.LANES.forEach(k => {
        const el = document.querySelector(`.fb-lane[data-lane="${k}"]`);
        if (!el) return;
        const L = this.lanes[k];
        const lm = $(`#fb-ltrm-${k}`), lf = $(`#fb-ltrf-${k}`);
        if (lm) lm.textContent = Math.round(L.myTr).toLocaleString();
        if (lf) lf.textContent = Math.round(L.foeTr).toLocaleString();
        const mm2 = $(`#fb-lmm-${k}`), mf2 = $(`#fb-lmf-${k}`);
        if (mm2) mm2.textContent = `💪${Math.round(L.myMor)}`;
        if (mf2) mf2.textContent = `💪${Math.round(L.foeMor)}`;
        // 将魂技能钮堆叠：冷却环随刻推进；该线在世武将数变化（阵亡）导致钮数不符时整线重绘一次
        let badgeMismatch = false;
        ["my", "foe"].forEach(side => {
          const pos = side === "my" ? this.myPos[k] : this.foePos[k];
          const gens = pos.filter(g => g && this.alive(g));
          const stack = el.querySelector(`.fb-skillstack.${side}`);
          if (gens.length !== (stack ? stack.children.length : 0)) { badgeMismatch = true; return; }
          const cds = L[side + "SkillCds"] || {};
          gens.forEach(g => {
            const sk = Skill.of(g);
            if (!Skill.ACTIVE_WAR_TYPES.has(sk.type)) return;
            const badge = document.getElementById(`fb-sk-${side}-${k}-${g.id}`);
            if (!badge) { badgeMismatch = true; return; }
            const st = cds[g.id];
            const cdMax = (st && st.cdMax) || this.warCD(g);
            const pct = st ? Math.max(0, Math.min(1, st.cd / cdMax)) : 1;
            badge.style.setProperty("--cdpct", pct);
          });
        });
        if (badgeMismatch) { this.renderClash(); return; }
        if (L.broken && !el.classList.contains("done")) this.renderClash();
      });
      const mm = $("#fb-mor-my"), mf = $("#fb-mor-foe");
      if (mm) mm.textContent = Math.round(this.myMorale);
      if (mf) mf.textContent = Math.round(this.foeMorale);
      const mbar = $("#fb-morbar-my"), fbar = $("#fb-morbar-foe");
      if (mbar) { mbar.style.width = this.myMorale + "%"; mbar.style.background = hpColor(this.myMorale / 100); }
      if (fbar) { fbar.style.width = this.foeMorale + "%"; fbar.style.background = hpColor(this.foeMorale / 100); }
      const tm = $("#fb-tr-my"), tf = $("#fb-tr-foe");
      if (tm) tm.textContent = Math.max(0, Math.round(this.myTroops)).toLocaleString();
      if (tf) tf.textContent = Math.max(0, Math.round(this.foeTroops)).toLocaleString();
      const trm = $("#fb-trbar-my"), trf = $("#fb-trbar-foe");
      const trMy = Math.max(0, this.myTroops / this.myTroops0), trFoe = Math.max(0, this.foeTroops / this.foeTroops0);
      if (trm) { trm.style.width = trMy * 100 + "%"; trm.style.background = hpColor(trMy); }
      if (trf) { trf.style.width = trFoe * 100 + "%"; trf.style.background = hpColor(trFoe); }
      const of = $("#fb-orders-foe");
      if (of) of.textContent = this.foeOrders;
    },
    log(msg) {
      this.logLines = this.logLines || [];
      this.logLines.unshift(`<div>${msg}</div>`);
      if (this.logLines.length > 30) this.logLines.pop();
      const el = $("#fb-log"); if (el) el.innerHTML = this.logLines.join("");
    },
    /* ---------- 终局 · 追亡逐北 ---------- */
    finish(won, reason) {
      clearInterval(this.timer); this.timer = null;
      this.phase = "done";
      FieldFX.stop();
      if (this.external) { this.finishExternal(won, reason); return; }
      if (!won) { this.showResult(false, reason, ""); return; }
      openOverlay(`<div class="result-card">
        <h1>🏇 追亡逐北</h1>
        <div class="wdesc">${reason}——敌军全线溃退！穷追可扩大战果，但若敌后备未乱，恐有埋伏。</div>
        <div class="btns">
          <button class="btn-primary" id="fb-chase">穷追猛打</button>
          <button class="btn-ghost" id="fb-stop">见好就收</button>
        </div></div>`, { modal: true });
      $("#fb-chase").onclick = () => {
        closeOverlay();
        if (Math.random() < 0.6) {
          const extra = randInt(2, 4);
          this.stats.foeFall += extra;
          this.showResult(true, reason, `🏇 穷追三十里，再斩敌将 ${extra} 员，大获全胜、缴获无数！`);
        } else {
          const lost = randInt(1, 2);
          this.stats.myFall += lost;
          this.showResult(true, reason, `⚠️ 追击途中遭敌后备伏击，折损 ${lost} 将——胜局虽在，美中不足。`);
        }
      };
      $("#fb-stop").onclick = () => { closeOverlay(); this.showResult(true, reason, "🎺 鸣金收兵，稳稳吃下这场大胜。"); };
    },
    // 外部战场（如边境战事）终局：不展示野战自身的战果卡，折算为调用方约定的结果对象后回调；
    // 全自动推演（敌我皆非玩家亲历）直接结算，无需追亡逐北的二次确认；亲历时胜局仍可选择穷追
    finishExternal(won, reason) {
      // 历战成长：与组队大战一致，双方真实参战武将（主角除外）按各自胜负各有小概率六维精进
      if (typeof Campaign !== "undefined") {
        const gm = Campaign.mapState();
        if (gm) {
          let grew = 0;
          this.mine.forEach(g => { if (g.id != null && g.id >= 0 && Growth.battle(gm, g, won)) grew++; });
          this.foes.forEach(g => { if (g.id != null && g.id >= 0 && Growth.battle(gm, g, !won)) grew++; });
          if (grew) this.log(`📈 历战磨砺：${grew} 位武将六维有所精进`);
        }
      }
      const done = () => {
        // myTroopsLeft/foeTroopsLeft：委外战场（边境战/攻城战）据此把幸存兵力遣返/编入城池驻军；
        // foeSurvivors 供边境战"野战得胜方乘胜攻城"时，胜方若恰是敌方（foe）也能取得己方幸存武将名单
        const res = { playerWon: won, mySurvivors: this.mine.filter(g => this.alive(g)), foeSurvivors: this.foes.filter(g => this.alive(g)), kills: this.stats.foeFall,
          myTroopsLeft: Math.max(0, Math.round(this.myTroops)), foeTroopsLeft: Math.max(0, Math.round(this.foeTroops)) };
        const onDone = this.external.onDone;
        this.external = null;
        if (onDone) onDone(res);
      };
      if (!won || this.external.auto) { done(); return; }
      openOverlay(`<div class="result-card">
        <h1>🏇 追亡逐北</h1>
        <div class="wdesc">${reason}——敌军全线溃退！穷追可扩大战果，但若敌后备未乱，恐有埋伏。</div>
        <div class="btns">
          <button class="btn-primary" id="fb-chase">穷追猛打</button>
          <button class="btn-ghost" id="fb-stop">见好就收</button>
        </div></div>`, { modal: true });
      $("#fb-chase").onclick = () => {
        closeOverlay();
        if (Math.random() < 0.6) this.stats.foeFall += randInt(2, 4);
        else this.stats.myFall += randInt(1, 2);
        done();
      };
      $("#fb-stop").onclick = () => { closeOverlay(); done(); };
    },
    showResult(won, reason, chaseTxt) {
      // 与单挑结果框同一根因：未传 modal 时背景一点即关，玩家点不到框内按钮，流程卡死——统一补上
      openOverlay(`<div class="result-card">
        <h1>${won ? "🏆 野战大捷" : "💀 兵败如山"}</h1>
        <div class="wdesc">${reason}${chaseTxt ? `<br>${chaseTxt}` : ""}<br><br>
          ⚔️ 阵前斗将：${this.myDuelWins} 胜 ${this.foeDuelWins} 负<br>
          💥 破阵：突破 ${this.stats.myBreach} 线 · 失守 ${this.stats.foeBreach} 线<br>
          💀 阵亡：我方 ${this.stats.myFall} 将 · 敌方 ${this.stats.foeFall} 将<br>
          ⚔️ 余兵：我 ${Math.max(0, Math.round(this.myTroops)).toLocaleString()} / ${this.myTroops0.toLocaleString()} · 敌 ${Math.max(0, Math.round(this.foeTroops)).toLocaleString()} / ${this.foeTroops0.toLocaleString()}</div>
        <div class="btns">
          <button class="btn-primary" id="fb-again">再战一场</button>
          <button class="btn-ghost" id="fb-home">返回菜单</button>
        </div></div>`, { modal: true });
      $("#fb-again").onclick = () => { closeOverlay(); this.open(); };
      $("#fb-home").onclick = () => { closeOverlay(); this.abort(); showScreen("home"); };
    },
  };
  window.FieldBattle = FieldBattle;   // 导出到 window，便于自动化测试等外部脚本直接读取战场状态

  /* ============================================================
   *  野战演武 · 棋盘对垒（GridBattle）
   *  回合制方格棋盘，一将一格，取代原五线推兵版成为「野战演武」主入口；
   *  旧版 FieldBattle 原样保留（小游戏合集「野战演武·经典版」+ 边境战事内部调用不受影响）。
   *  第一期骨架：方格移动/交锋/阵形部署窗口/士气崩溃胜负 + 每回合「挑发」概率触发单挑
   *  （复用 startTeamDuel 引擎）；军令、将魂主动技能网格化、夺营判定留待后续分期。
   * ============================================================ */
  const GridZoom = { scale: 1, x: 0, y: 0 };   // 棋盘双指缩放/拖动状态，跨 render() 持久，命名与 MapZoom 区分避免顶层 const 撞名
  const GridBattle = {
    gen: 0, phase: null,
    COLS: 13, ROWS: 9,
    TERRAINS: {
      plain: { n: "平地", icon: "🌾", moveCost: 1, defMul: 1 },
      hill:  { n: "丘陵", icon: "⛰️", moveCost: 2, defMul: 1.25 },
      river: { n: "河道", icon: "🌊", moveCost: 3, defMul: 1, noAtk: true },
      road:  { n: "道路", icon: "🛤️", moveCost: 0.5, defMul: 1 },
      camp:  { n: "大营", icon: "🚩", moveCost: 1, defMul: 1.4, heal: true },
    },
    FORMS: {
      cone:  { n: "锥形", icon: "🔺", desc: "前 3 回合全军攻击 +20%", atkMul: 1.2 },
      crane: { n: "鹤翼", icon: "🕊️", desc: "前 3 回合全军攻击 +20%（散开克锥形）", atkMul: 1.2 },
      round: { n: "方圆", icon: "🛡️", desc: "前 3 回合全军防御 +25%", defMul: 1.25 },
      goose: { n: "雁行", icon: "🏹", desc: "前 3 回合乱箭蚀敌，敌军士气每回合 -1.5", moraleDrain: 1.5 },
    },
    // 锥克方圆、方圆克雁行、雁行克鹤翼、鹤翼克锥形——克敌方阵形加成期内攻击再 +10%
    FORM_BEATS: { cone: "round", round: "goose", goose: "crane", crane: "cone" },
    TERRAIN_TPL_NAME: { plain: "平原", hill: "山道", river: "河畔" },

    open() {
      this.gen++;
      this.side = "cn";
      this.rpg = false; this.external = null; this.troopScale = null;
      GridZoom.scale = 1; GridZoom.x = 0; GridZoom.y = 0;
      const draft = s => { const p = DB.bySide(s).slice(); shuffle(p); return p.slice(0, 10).map(clone); };
      this.mine = draft("cn"); this.foes = draft("jp");
      this._setupCommon();
    },
    // 供角色扮演·边境战事/攻城战调用：以外部已构建好的双方阵容（含城墙/守将等加成）开局，
    // 取代旧版 FieldBattle 成为这两处的战斗界面；opts.observe 为真（主角未被抽中亲历）时全程自动
    // 推演双方，无需任何点击；战罢通过 opts.onDone 回调组队大战兼容的结果对象
    // （playerWon/mySurvivors/foeSurvivors/kills/myTroopsLeft/foeTroopsLeft），供调用方沿用既有结算
    beginExternal(myRoster, foeRoster, heroSide, opts = {}) {
      this.gen++;
      this.side = heroSide;
      this.rpg = !!opts.rpg;
      this.external = { auto: !!opts.observe, onDone: opts.onDone };
      // 城池驻军覆盖：委外战场按各自实际出阵兵力与「按统帅推算的自然兵力」之比换算缩放系数，
      // 使接战兵力真正取决于所在城池的驻军存量；不传则维持原有纯统帅推算（如小游戏自由试玩）
      this.troopScale = opts.troopScale || null;
      GridZoom.scale = 1; GridZoom.x = 0; GridZoom.y = 0;
      this.mine = myRoster.slice(0, 10);
      this.foes = foeRoster.slice(0, 10);
      this._setupCommon();
    },
    // 可操控范围：野战演武·自由练习（this.rpg 为假）不受身份限制，两军随你摆弄，保留原有的练习/试玩体验；
    // 委外战场（边境战/攻城战，this.rpg 为真）则按身份收紧——只有你本人、你的团队成员可亲自指挥，
    // 其余武将（候选池随机补位而来）交由 AI 自主调度；官至「城主」（PlayerRank 最高一阶）或已自立门户
    // 当主（"_player_"）时，视同已统率一方势力，本势力麾下全部出阵武将皆可指挥
    controllable(g) {
      if (!this.rpg) return true;
      if (!RPG.char) return false;
      if (g.id === -1) return true;
      const m = typeof Campaign !== "undefined" && Campaign.mapState && Campaign.mapState();
      if (m && m.playerFaction) {
        const lordLevel = m.playerFaction === "_player_" || m.playerRank >= PlayerRank.RANKS.length - 1;
        if (lordLevel) return (m.generalFaction || {})[g.id] === m.playerFaction;
      }
      return !!(typeof Bond !== "undefined" && Bond.data && (Bond.data.team || []).includes(g.id));
    },
    abort() { this.gen++; this.phase = null; this.selectedUnit = null; },

    /* ---------- 开局：地形生成 + 布阵 ---------- */
    generateTerrain() {
      const templates = ["plain", "hill", "river"];
      const tpl = templates[randInt(0, 2)];
      const tiles = [];
      for (let r = 0; r < this.ROWS; r++) {
        const row = [];
        for (let c = 0; c < this.COLS; c++) {
          let t = "plain";
          const midBand = r > 1 && r < this.ROWS - 2;
          if (tpl === "hill" && midBand && Math.random() < 0.24) t = "hill";
          else if (tpl === "plain" && midBand && Math.random() < 0.10) t = "hill";
          else if (tpl === "river" && r === Math.floor(this.ROWS / 2) && c !== 2 && c !== this.COLS - 3) t = "river";
          row.push(t);
        }
        tiles.push(row);
      }
      // 主干道：中线纵向打通（河畔模板遇河即断，须绕行 2 处渡口）
      const midC = Math.floor(this.COLS / 2);
      for (let r = 0; r < this.ROWS; r++) if (tiles[r][midC] === "plain") tiles[r][midC] = "road";
      const myCamp = { r: this.ROWS - 1, c: midC }, foeCamp = { r: 0, c: midC };
      tiles[myCamp.r][myCamp.c] = "camp"; tiles[foeCamp.r][foeCamp.c] = "camp";
      this.terrainTpl = tpl;
      return { tiles, myCamp, foeCamp };
    },
    // 将魂冷却（回合制换算）：统帅越高冷却越短，2~4 回合宽幅（design 6.2）
    warCD(g) { return Math.max(2, Math.min(4, Math.round((14 - ((g.tong || 0) - 40) / 7) / 3))); },
    // scale：委外战场（边境战/攻城战）按城池驻军换算的兵力缩放系数，默认 1（小游戏自由试玩/未指定时维持纯统帅推算）
    makeUnit(g, side, form, scale = 1) {
      const hpMax = Math.max(100, Math.round(g.tong * 100 * scale));
      const skType = Skill.of(g).type;
      return {
        uid: g.side + "-" + g.id + "-" + Math.random().toString(36).slice(2, 7),
        g, side, r: 0, c: 0,
        hp: hpMax, hpMax,           // 兵力（非"体力"——沿用武将六维数值，但战场语境下代表其所辖部众）
        morale: 50,                 // 士气：每员武将独立维护，不再是全队共享的单一数值
        form: form || "cone",       // 阵形改为逐将独立（非全军统一），决定该部的攻防乘区与相克
        atk: g.wu * 0.65 + g.tong * 0.35,
        def: g.tong * 0.65 + g.wu * 0.35,
        moveMax: Math.max(3, Math.min(5, Math.round(g.tong / 28))),
        // volley 已直接落实为「远程 2 格且不受反击」的被动，不再重复挂一枚战法钮（design 6.2 表格 volley 行）
        ranged: skType === "volley",
        skActive: (Skill.ACTIVE_WAR_TYPES.has(skType) && skType !== "volley") ? skType : null,
        skCd: 0, skCdMax: this.warCD(g),
        alive: true, acted: false, moved: false, standDef: false,
        kills: 0, dmgDealt: 0,      // 战绩统计，供终局战报评头功用
        merit: 0,                   // 战场功勋值：消灭敌军、对敌武将最后一击、计谋成功、单挑得胜、力战存活皆计入
      };
    },
    // 被动将魂：融入攻防结算的乘区（design 6.1，网格化版）
    skillAtkMul(u) {
      const t = Skill.of(u.g).type;
      let m = 1;
      if (t === "sanada") m *= 1.08;
      return m;
    },
    skillDefMul(u) {
      const t = Skill.of(u.g).type;
      let m = 1;
      if (t === "school-tong") m *= 1.1;
      if (t === "adamant") m *= 1.2;
      if (t === "tiger") m *= 1.15;
      if (t === "sanada") m *= 1.08;
      return m;
    },
    armyHasFiremaster(side) {
      const arr = side === "my" ? this.myUnits : this.foeUnits;
      return arr.some(u => u.alive && Skill.of(u.g).type === "firemaster");
    },
    // 部署站位形状：阵形已改为逐将独立属性（design 2.4 修订），不再驱动全军统一的站位造型，
    // 这里只负责把十员武将按战力由强到弱、由中路向两翼铺开地摆进己方两行部署区
    placeFormation(units, side) {
      const rows = side === "my" ? [this.ROWS - 2, this.ROWS - 1] : [0, 1];
      const mid = Math.floor(this.COLS / 2);
      const order = [];
      for (let d = 0; d <= this.COLS; d++) {
        if (mid - d >= 0) order.push(mid - d);
        if (d > 0 && mid + d < this.COLS) order.push(mid + d);
      }
      const cells = [];
      order.forEach(c => rows.forEach(r => cells.push([r, c])));
      const sorted = units.slice().sort((a, b) => (b.g.wu + b.g.tong) - (a.g.wu + a.g.tong));
      sorted.forEach((u, i) => { const cell = cells[i]; if (cell) { u.r = cell[0]; u.c = cell[1]; } });
    },
    _setupCommon() {
      this.phase = "deploy";
      const { tiles, myCamp, foeCamp } = this.generateTerrain();
      this.tiles = tiles; this.myCamp = myCamp; this.foeCamp = foeCamp;
      const fk = Object.keys(this.FORMS);
      // 城池驻军覆盖（委外战场专属）：按各自实际出阵兵力与「按统帅推算的自然兵力」之比换算缩放系数，
      // 未传 troopScale（小游戏自由试玩）时两侧系数皆为 1，行为与此前完全一致
      const myNatural = this.mine.reduce((s, g) => s + g.tong * 100, 0) || 1;
      const foeNatural = this.foes.reduce((s, g) => s + g.tong * 100, 0) || 1;
      this.myScale = this.troopScale ? this.troopScale.mine / myNatural : 1;
      this.foeScale = this.troopScale ? this.troopScale.foe / foeNatural : 1;
      // 阵形逐将独立：我方默认全给「锥形」，部署页可逐将点选切换；敌方随机各配一种，制造混编阵容
      this.myUnits = this.mine.map(g => this.makeUnit(g, "my", "cone", this.myScale));
      this.foeUnits = this.foes.map(g => this.makeUnit(g, "foe", fk[randInt(0, fk.length - 1)], this.foeScale));
      this.placeFormation(this.myUnits, "my");
      this.placeFormation(this.foeUnits, "foe");
      this.formTurnsLeft = 3;
      this.turnSide = "my"; this.turnN = 1;
      this.logLines = [];
      this.myOrders = this.calcOrders(this.mine); this.foeOrders = this.calcOrders(this.foes);
      this.orderMode = null;
      this.selectedUnit = null; this.selPhase = null; this.actionMode = null; this.deploySel = null;
      this.myCampSiege = 0; this.foeCampSiege = 0;   // 大本营围城计数：连续 3 回合被占领即视为攻破
      this.busy = false;
      this._advancing = false;   // advanceAutoPlay 防重入标记，见该方法注释
      this.delegated = false;   // 「委托」：玩家中途放弃亲自指挥，余下战斗全自动推演，见 delegate()
      showScreen("fieldgrid");
      // 委外战场且主角未被抽中亲历：跳过排兵布阵画面/点将出阵等一切手动确认，直接开战并自动推演双方
      if (this.external && this.external.auto) {
        this.startBattle();
        this.scheduleIfCurrent(() => this.autoPlayMyTurn(), 400);
      } else {
        this.renderDeploy();
      }
    },
    // 全军统帅+智力均值折算的基准值（约 2~6 道）：开战时的起始军令池直接取这个数；
    // 军令不再是"每回合推倒重算"，而是上限 10 道的累积池
    calcOrders(arr) {
      if (!arr.length) return 2;
      const avg = arr.reduce((s, g) => s + (g.tong + g.zhi) / 2, 0) / arr.length;
      return Math.max(2, Math.min(6, Math.round((avg - 30) / 10)));
    },
    // 每回合的恢复量在基准值上再减半（向下取整但至少 1 道）——军令消耗更有分量，
    // 不再是"一场仗打下来军令根本花不完"；恢复量按当前存活武将实时重算，折损越重恢复越慢，见 endTurnCycle
    calcOrderRegen(arr) {
      return Math.max(1, Math.floor(this.calcOrders(arr) / 2));
    },
    ORDERS_CAP: 10,

    /* ---------- 共用查询 ---------- */
    unitAt(r, c) {
      return [...this.myUnits, ...this.foeUnits].find(u => u.alive && u.r === r && u.c === c) || null;
    },
    manhattan(a, b) { return Math.abs(a.r - b.r) + Math.abs(a.c - b.c); },
    totalHp(side) { return (side === "my" ? this.myUnits : this.foeUnits).reduce((s, u) => s + (u.alive ? u.hp : 0), 0); },
    avgMorale(side) {
      const arr = (side === "my" ? this.myUnits : this.foeUnits).filter(u => u.alive);
      return arr.length ? Math.round(arr.reduce((s, u) => s + u.morale, 0) / arr.length) : 0;
    },
    // 士气增减的唯一入口：跌至 0 即视为该部气丧胆寒、不战自溃（与兵力耗尽同为"溃退"的两条独立触因）；
    // 顺带同步该部士气条，覆盖军令/战法/溃退连锁等所有会改动士气的场景，不必逐处手动补刷新
    dropMorale(u, amt) {
      if (!u.alive) return;
      u.morale = Math.max(0, u.morale - amt);
      if (this.phase === "battle") this.syncUnitDom(u);
      if (u.morale <= 0) this.routUnit(u, "士气涣散、军心崩溃");
    },
    gainMorale(u, amt) {
      if (!u.alive) return;
      u.morale = Math.min(100, u.morale + amt);
      if (this.phase === "battle") this.syncUnitDom(u);
    },
    // 共用 BFS：同时算出可达格代价表与来路（parent），reachable()/findPath() 各取所需
    _bfsReach(unit) {
      const cost = { [unit.r + "," + unit.c]: 0 };
      const parent = {};
      const queue = [[unit.r, unit.c, 0]];
      while (queue.length) {
        const [r, c, cc] = queue.shift();
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= this.ROWS || nc < 0 || nc >= this.COLS) continue;
          const terr = this.TERRAINS[this.tiles[nr][nc]];
          const nCost = cc + terr.moveCost;
          if (nCost > unit.moveMax) continue;
          const occ = this.unitAt(nr, nc);
          if (occ && occ !== unit) continue;
          const key = nr + "," + nc;
          if (cost[key] !== undefined && cost[key] <= nCost) continue;
          cost[key] = nCost; parent[key] = r + "," + c;
          queue.push([nr, nc, nCost]);
        }
      }
      return { cost, parent };
    },
    reachable(unit) {
      const { cost } = this._bfsReach(unit);
      const startKey = unit.r + "," + unit.c;
      return Object.keys(cost).filter(k => k !== startKey).map(k => k.split(",").map(Number));
    },
    // 逐格路径（供 AI 移动演出用）：找不到可达路径时返回 null
    findPath(unit, tr, tc) {
      const { cost, parent } = this._bfsReach(unit);
      const startKey = unit.r + "," + unit.c, destKey = tr + "," + tc;
      if (destKey === startKey || cost[destKey] === undefined) return null;
      const path = [];
      let cur = destKey;
      while (cur !== startKey) {
        const [r, c] = cur.split(",").map(Number);
        path.unshift([r, c]);
        cur = parent[cur];
      }
      return path;
    },
    // AI 移动改为逐格挪动而非瞬移，玩家才看得清走位过程；每步之间短暂停顿并重绘
    async animateMove(unit, path) {
      if (!path || !path.length) return;
      for (const [r, c] of path) {
        unit.r = r; unit.c = c;
        this.renderBattle();
        await this.uiPause(110);
      }
    },

    /* ---------- 战斗结算 ---------- */
    // 夹击不再是几何上自动判定，而是玩家在行动前的明确抉择：选「单独攻击」只有本部出手，
    // 选「夹击」则把所有仍未行动、且已贴在目标相邻格的同袍一并拉入这次围攻（见 resolveCoordinatedAttack）
    eligibleFlankers(unit, target) {
      const allies = unit.side === "my" ? this.myUnits : this.foeUnits;
      return allies.filter(a => a !== unit && a.alive && !a.acted && this.manhattan(a, target) === 1);
    },
    computeCombat(att, def, flankers = 0) {
      const defTerr = this.TERRAINS[this.tiles[def.r][def.c]];
      const formBonus = (u, kind) => {
        if (this.formTurnsLeft <= 0) return 1;
        const f = this.FORMS[u.form];
        return (kind === "atk" && f.atkMul) || (kind === "def" && f.defMul) || 1;
      };
      const beatBonus = () => {
        if (this.formTurnsLeft <= 0) return 1;
        return this.FORM_BEATS[att.form] === def.form ? 1.1 : 1;
      };
      // 士气不再是全队共享的单一数值：以攻方自身士气决定其发挥
      const moraleMul = 0.7 + att.morale / 100 * 0.6;
      // 疑兵佯攻：被点名的一部防御临时打对折（-20%），持续 2 回合（见 tryFeintOrder / endTurnCycle 的递减）
      const feintMul = def.feintTurns > 0 ? (def.feintMul || 1) : 1;
      let dmg = 220 * (att.atk * this.skillAtkMul(att) * formBonus(att, "atk") * beatBonus() * moraleMul)
        / Math.max(1, def.def * this.skillDefMul(def) * defTerr.defMul * formBonus(def, "def") * feintMul)
        * (0.85 + Math.random() * 0.3);
      // 夹击伤害改为按参战总人数（含发起者本人）取固定倍率：2 人 133%、3 人 167%、4 人及以上封顶 200%
      if (flankers > 0) {
        const n = flankers + 1;
        dmg *= n >= 4 ? 2.0 : n === 3 ? 1.67 : 1.33;
      }
      if (def.standDef) dmg *= 0.85;
      // 暴击：由攻方「魅力」决定（与单挑同一套公式），中则伤害 ×1.7
      let crit = false;
      if (Math.random() < Math.min(0.6, (att.g.mei || 0) / 280)) { dmg *= 1.7; crit = true; }
      return { dmg: Math.max(1, Math.round(dmg)), crit, flankers };
    },
    computeCombatAt(att, def, r, c, flankers = 0) {
      const sr = att.r, sc = att.c;
      att.r = r; att.c = c;
      const res = this.computeCombat(att, def, flankers);
      att.r = sr; att.c = sc;
      return res;
    },
    // 单位兵力/士气条与顶部 VS 条/对阵情况的即时同步：命中瞬间直接改这几处 DOM 的行内样式/文字，
    // 不等这一整轮攻击（含夹击的每一次出手）全部结束后才靠下一次整块 renderBattle 去刷新
    syncUnitDom(u) {
      const root = $("#fg-content");
      const cell = root && root.querySelector(`.fg-cell[data-r="${u.r}"][data-c="${u.c}"]`);
      if (!cell) return;
      const hpI = cell.querySelector(".fg-hpbar i"), morI = cell.querySelector(".fg-morbar i"), unitEl = cell.querySelector(".fg-unit");
      const pct = Math.max(0, u.hp / u.hpMax), moralePct = Math.max(0, u.morale / 100);
      if (hpI) { hpI.style.width = (pct * 100) + "%"; hpI.style.background = hpColor(pct); }
      if (morI) { morI.style.width = (moralePct * 100) + "%"; morI.style.background = moraleColor(moralePct); }
      if (unitEl) unitEl.title = `${u.g.name}　${this.FORMS[u.form].n}　兵力 ${Math.max(0, Math.round(u.hp))}/${u.hpMax}　士气 ${Math.round(u.morale)}`;
    },
    syncTopBars() {
      const root = $("#fg-content"); if (!root) return;
      const vs = root.querySelector(".fg-area-vsbar"); if (vs) vs.innerHTML = this.vsbarHtml();
      const mu = root.querySelector(".fg-area-matchup"); if (mu) mu.innerHTML = this.hintLineHtml();
      const vb = $("#fg-vsbar-open", root); if (vb) vb.onclick = () => this.showMatchupOverlay();
      this.syncTopbarTitle();
    },
    // 顶栏标题行：把"我方回合·第N回合"挪到最上面的主标题（野战演武）那一行、居中显示
    syncTopbarTitle() {
      const h2 = $("#screen-fieldgrid .topbar h2"); if (!h2) return;
      if (this.phase === "battle") h2.textContent = `${this.turnSide === "my" ? "🟢 我方回合" : "🔴 敌方回合"} · 第 ${this.turnN} 回合`;
      else h2.textContent = "野战演武";
    },
    // 攻击画面感：挥砍/受创闪动、暴击全屏微闪、伤害数字浮现于目标格，全程配以音效——先播完这段短促演出，
    // 再交回调用方去做真正的整块重绘（renderBattle），避免动画节点被同一帧的 innerHTML 重写瞬间冲掉
    async playAttackFx(att, def, res) {
      const root = $("#fg-content");
      const attCell = root && root.querySelector(`.fg-cell[data-r="${att.r}"][data-c="${att.c}"]`);
      const defCell = root && root.querySelector(`.fg-cell[data-r="${def.r}"][data-c="${def.c}"]`);
      AudioSystem.sfx.swing();
      if (attCell) attCell.classList.add("fg-atk-anim");
      await this.uiPause(150);
      if (res.crit) { AudioSystem.sfx.crit(); const board = root && root.querySelector(".fg-board"); if (board) board.classList.add("fg-screenflash"); }
      else AudioSystem.sfx.hit();
      if (defCell) {
        defCell.classList.add("fg-hit-flash");
        const num = document.createElement("div");
        num.className = "fg-dmgnum" + (res.crit ? " crit" : "");
        num.textContent = "-" + res.dmg;
        defCell.appendChild(num);
        setTimeout(() => num.remove(), 850);
      }
      // 命中的这一刻就把兵力/士气条与顶部总量一并刷新，而不是等整套攻击（含夹击逐次出手）全部播完
      this.syncUnitDom(def);
      this.syncTopBars();
      await this.uiPause(280);
      if (attCell) attCell.classList.remove("fg-atk-anim");
      if (defCell) defCell.classList.remove("fg-hit-flash");
      const board2 = root && root.querySelector(".fg-board"); if (board2) board2.classList.remove("fg-screenflash");
    },
    async resolveAttack(att, def, flankers = 0) {
      if (this.TERRAINS[this.tiles[att.r][att.c]].noAtk) { toast("半渡之际，不可出战！"); return; }
      const res = this.computeCombat(att, def, flankers);
      def.hp = Math.max(0, def.hp - res.dmg);
      att.dmgDealt = (att.dmgDealt || 0) + res.dmg;
      this.gainMerit(att, res.dmg / 100);
      this.log(`⚔️ ${att.g.name} 攻击 ${def.g.name}${flankers ? "（夹击）" : ""}，造成 ${res.dmg} 点伤害${res.crit ? " 💥暴击！" : ""}${def.hp <= 0 ? "，一举击溃！" : ""}`);
      await this.playAttackFx(att, def, res);
      if (def.hp <= 0) { att.kills = (att.kills || 0) + 1; this.gainMerit(att, 30); this.routUnit(def); }
      if (def.hp > 0 && !att.ranged && !this.TERRAINS[this.tiles[def.r][def.c]].noAtk) {
        const cres = this.computeCombat(def, att, 0);
        const counterDmg = Math.round(cres.dmg * 0.5);
        att.hp = Math.max(0, att.hp - counterDmg);
        def.dmgDealt = (def.dmgDealt || 0) + counterDmg;
        this.gainMerit(def, counterDmg / 100);
        this.log(`↩️ ${def.g.name} 奋力反击${cres.crit ? " 💥暴击" : ""}，造成 ${counterDmg} 点伤害${att.hp <= 0 ? "，反遭击溃！" : ""}`);
        await this.playAttackFx(def, att, { dmg: counterDmg, crit: cres.crit });
        if (att.hp <= 0) { def.kills = (def.kills || 0) + 1; this.gainMerit(def, 30); this.routUnit(att); }
      }
    },
    // 夹击：主攻手 + 所有已就位（相邻目标、未行动）的同袍依次出手，各自独立结算伤害/反击，
    // 每人都播一遍完整的攻击演出，让"围攻"这件事真正在画面上看得见——目标半途溃败即中止后续出手
    async resolveCoordinatedAttack(attackers, def) {
      for (const att of attackers) {
        if (!def.alive || !att.alive) continue;
        const flankers = attackers.filter(a => a !== att && a.alive).length;
        await this.resolveAttack(att, def, flankers);
        att.acted = true;
      }
    },
    // 溃退：兵力或士气（见 dropMorale）任一见底皆触发，两者互为独立判定；殃及己方同袍士气小幅下滑、
    // 敌方同步小振——由个体的溃败连锁牵动全局，而非旧版"全队一个开关"式的整队瞬间崩溃
    // 功勋值：各类战场表现的统一入账口——伤敌以战果论功、扣至归零则再加一记头功，
    // 计谋施展见效、单挑取胜、力战存活亦各有加成（详见各调用处），终局据此排出双方功勋榜
    gainMerit(u, n) {
      u.merit = (u.merit || 0) + n;
    },
    routUnit(u, reason) {
      if (!u.alive) return;
      u.alive = false;
      const allies = u.side === "my" ? this.myUnits : this.foeUnits;
      const enemies = u.side === "my" ? this.foeUnits : this.myUnits;
      allies.forEach(a => this.dropMorale(a, 5));
      enemies.forEach(e => this.gainMorale(e, 3));
      AudioSystem.sfx.ko();
      this.log(`💀 ${u.g.name} 部${reason || "兵力耗尽，全军溃退"}，退出战场！`);
    },
    async doTargetAction(def) {
      const att = this.selectedUnit;
      if (!att || this.busy) return;
      if (this.actionMode === "challenge") return this.challenge(att, def);
      this.busy = true;
      // 一旦出手就先把浮动菜单收起来，免得挡住紧接着播放的攻击/夹击动画
      this.selectedUnit = null; this.selPhase = null;
      this.renderBattle();
      if (this.actionMode === "flank") {
        const joiners = this.eligibleFlankers(att, def);
        await this.resolveCoordinatedAttack([att, ...joiners], def);
      } else {
        await this.resolveAttack(att, def, 0);
        att.acted = true;
      }
      this.busy = false;
      this.afterAction();
    },
    // 单挑（decision #4，原「挑发」改名）：向相邻敌将发起单挑请求，成败取决于己方魅力与对方智力之差；
    // 应战则复用 startTeamDuel 引擎真实打一场；败方兵力折半、士气受挫，且均只落在败方这一员武将身上——
    // 不再是旧版"团队共享一个士气开关"，一场单挑输赢至多只会让败者本人这一部溃退，不会牵动全军
    async challenge(att, def) {
      if (this.busy) return;
      this.busy = true;
      this.selectedUnit = null; this.selPhase = null;
      this.renderBattle();
      const pAccept = Math.max(0.25, Math.min(0.85, 0.5 + (att.g.mei - def.g.zhi) / 200));
      if (Math.random() >= pAccept) {
        this.log(`🤺 ${att.g.name} 请战单挑，${def.g.name} 识破其意，按兵不动。`);
        att.acted = true; this.busy = false; this.afterAction();
        return;
      }
      this.log(`🤺 ${att.g.name} 请战单挑，${def.g.name} 按捺不住，两将阵前一战！`);
      const myGen = this.gen;
      const res = await startTeamDuel(clone(att.g), clone(def.g), {
        // 只要这一步棋是由 AI（而非玩家当场点击）代为出手，单挑就必须走观战/全自动结算，不能按
        // "玩家亲自出招"打开——三种情形都算 AI 代打：已委托（delegated）、委外战场全自动推演
        // （external.auto，主角未被抽中亲历）、或攻方本就不在玩家可操控范围内。只看 controllable
        // 曾经漏判前两种：即便攻方恰是主角本人或本势力麾下、理论上"可操控"，一旦当下是 AI 在替玩家
        // 操盘，仍会误开非观战模式的单挑画面，卡在等待一次永远不会到来的人工点击「出招」上
        title: "阵前单挑", backScreen: "fieldgrid",
        spectate: this.delegated || (this.external && this.external.auto) || !this.controllable(att.g),
        intro: `${att.g.name} 请战单挑 ${def.g.name}，两将阵前一决高下！`,
      });
      if (this.gen !== myGen) return;
      showScreen("fieldgrid");
      att.acted = true;
      this.busy = false;
      if (!res) { this.afterAction(); return; }
      const winnerIsAtt = res.winner.name === att.g.name;
      const loser = winnerIsAtt ? def : att;
      const winner = winnerIsAtt ? att : def;
      this.gainMerit(winner, 40);
      loser.hp = Math.max(1, Math.round(loser.hp * 0.5));
      this.dropMorale(loser, 20);
      this.log(`${winnerIsAtt ? "⚔️" : "💥"} ${res.winner.name} 单挑得胜，${res.loser.name} 部众折损过半、军心动摇！`);
      // 小概率（12%）此部当场溃散——只影响败者本人这一部，不再殃及全军
      if (loser.alive && Math.random() < 0.12) this.routUnit(loser, "单挑落败后军心涣散、当场溃散");
      this.afterAction();
    },
    // 主动将魂 → 战法钮（design 6.2）：占用本回合行动，冷却以回合计；效果按持有者所属阵营通用判定，
    // 故 AI 一方（foe）可直接复用同一函数。school-wu/ti/mei/zheng 对应四门通用技，其余为名将专属。
    async useActiveSkill(u) {
      const type = u.skActive;
      if (!type || this.busy) return;
      this.busy = true;
      this.selectedUnit = null; this.selPhase = null;
      this.renderBattle();
      const sk = Skill.of(u.g);
      const enemies = (u.side === "my" ? this.foeUnits : this.myUnits).filter(e => e.alive);
      const allies = (u.side === "my" ? this.myUnits : this.foeUnits).filter(e => e.alive);
      const near = enemies.filter(e => this.manhattan(u, e) <= 1);
      let msg = "", handled = false, schemeLanded = false;
      if (type === "school-wu") {
        const target = near[0];
        if (target) {
          const dmg = Math.round(this.computeCombat(u, target).dmg * 1.6);
          target.hp = Math.max(0, target.hp - dmg);
          u.dmgDealt = (u.dmgDealt || 0) + dmg;
          AudioSystem.sfx.swing(); AudioSystem.sfx.hit();
          this.syncUnitDom(target); this.syncTopBars();
          msg = `${u.g.name}【${sk.n}】陷阵突击，斩敌 ${target.g.name} 部 ${dmg} 点！`;
          schemeLanded = true;
          if (target.hp <= 0) { u.kills = (u.kills || 0) + 1; this.gainMerit(u, 30); this.routUnit(target); }
        } else msg = `${u.g.name}【${sk.n}】未寻得近旁可突击的目标。`;
      } else if (type === "school-ti") {
        const heal = Math.round(u.hpMax * 0.18); u.hp = Math.min(u.hpMax, u.hp + heal);
        this.syncUnitDom(u); this.syncTopBars();
        msg = `${u.g.name}【${sk.n}】游走整军，自部兵力回复 ${heal}！`;
        schemeLanded = true;
      } else if (type === "school-mei") {
        allies.forEach(a => this.gainMorale(a, 8));
        this.syncTopBars();
        msg = `${u.g.name}【${sk.n}】振臂高呼，全军士气 +8！`;
        schemeLanded = true;
      } else if (type === "school-zheng") {
        const heal = Math.round(u.hpMax * 0.15); u.hp = Math.min(u.hpMax, u.hp + heal);
        this.syncUnitDom(u); this.syncTopBars();
        msg = `${u.g.name}【${sk.n}】调度粮秣，自部兵力回复 ${heal}！`;
        schemeLanded = true;
      } else if (type === "awe" || type === "discord" || type === "roar") {
        enemies.forEach(e => this.dropMorale(e, 10));
        this.syncTopBars();
        msg = `⭐ ${u.g.name}【${sk.n}】威慑当面，敌军士气 -10！`;
        schemeLanded = enemies.length > 0;
      } else if (type === "infiltrate") {
        const target = enemies[randInt(0, enemies.length - 1)];
        if (target) {
          const dmg = randInt(700, 1200);
          target.hp = Math.max(0, target.hp - dmg);
          u.dmgDealt = (u.dmgDealt || 0) + dmg;
          AudioSystem.sfx.swing(); AudioSystem.sfx.hit();
          this.syncUnitDom(target); this.syncTopBars();
          msg = `⭐ ${u.g.name}【${sk.n}】潜行突袭，${target.g.name} 部折损 ${dmg}！`;
          schemeLanded = true;
          if (target.hp <= 0) { u.kills = (u.kills || 0) + 1; this.gainMerit(u, 30); this.routUnit(target); }
        } else msg = `⭐ ${u.g.name}【${sk.n}】敌军已无可袭之部。`;
      } else if (type === "dualblade") {
        const target = near[0];
        if (target) { this.log(`⭐ ${u.g.name}【${sk.n}】技势不衰，连番猛击！`); await this.resolveAttack(u, target); handled = true; schemeLanded = true; }
        else msg = `${u.g.name}【${sk.n}】附近无可连击的目标。`;
      } else if (type === "tempo") {
        const ally = allies.find(a => a !== u && a.acted && this.manhattan(u, a) <= 1);
        if (ally) { ally.acted = false; msg = `${u.g.name}【${sk.n}】临阵调度，${ally.g.name} 获得额外行动！`; schemeLanded = true; }
        else msg = `${u.g.name}【${sk.n}】附近无已行动的友军可供调度。`;
      }
      if (msg && !handled) this.log("🌟 " + msg);
      if (schemeLanded) this.gainMerit(u, randInt(8, 15));
      u.skCd = u.skCdMax;
      u.acted = true;
      this.busy = false;
      this.afterAction();
    },
    // 军令：擂鼓（全军士气各+8）/ 火攻（须山道地形或军中有精通天时者，直接烧一路敌军）/
    // 医疗营救（选定己方一部小幅回兵）/ 疑兵佯攻（选定敌方一部防御临时-20%，持续2回合）——
    // 「斥候探阵」随阵形改为逐将独立、且棋子上直接标出阵形图标后失去意义，本轮起移除
    useOrder(kind) {
      if (this.delegated) return;
      if (this.myOrders <= 0) { toast("军令已用尽！"); return; }
      if (kind === "drum") {
        this.myOrders--; this.myUnits.filter(u => u.alive).forEach(u => this.gainMorale(u, 8));
        this.log(`🥁 擂鼓助威！我军士气 +8（军令余 ${this.myOrders}）`);
      } else if (kind === "fire" || kind === "heal" || kind === "feint") {
        this.orderMode = this.orderMode === kind ? null : kind;
      }
      if (this.phase === "battle") this.renderBattle(); else this.renderDeploy();
    },
    // 火攻的燃烧演出：火苗图标升起 + 目标格短促橙红闪动，与近战攻击的挥砍/受击一样先播完这段再回收
    async playFireFx(target, dmg) {
      const root = $("#fg-content");
      const cell = root && root.querySelector(`.fg-cell[data-r="${target.r}"][data-c="${target.c}"]`);
      const board = root && root.querySelector(".fg-board");
      AudioSystem.sfx.burn();
      if (board) board.classList.add("fg-fireflash");
      if (cell) {
        cell.classList.add("fg-fire-anim");
        const flame = document.createElement("div");
        flame.className = "fg-fire-icon"; flame.textContent = "🔥";
        cell.appendChild(flame);
        const num = document.createElement("div");
        num.className = "fg-dmgnum fire"; num.textContent = "-" + dmg;
        cell.appendChild(num);
        setTimeout(() => { flame.remove(); num.remove(); }, 900);
      }
      this.syncUnitDom(target);
      this.syncTopBars();
      await this.uiPause(260);
      if (cell) cell.classList.remove("fg-fire-anim");
      if (board) board.classList.remove("fg-fireflash");
      await this.uiPause(200);
    },
    async tryFireAttack(target) {
      if (this.myOrders <= 0) { toast("军令已用尽！"); this.orderMode = null; this.renderBattle(); return; }
      const terr = this.tiles[target.r][target.c];
      const master = this.armyHasFiremaster("my");
      if (terr !== "hill" && !master) { toast("火攻须在山道地形，或军中有精通天时的谋士"); return; }
      if (this.busy) return;
      this.busy = true;
      this.myOrders--; this.orderMode = null;
      const dmg = randInt(400, 800) * (master ? 2 : 1);
      target.hp = Math.max(0, target.hp - dmg);
      this.log(`🔥 火攻！${master ? "⭐ 借东风，风向骤转、火势倍增——" : ""}${target.g.name} 部折损 ${dmg}（军令余 ${this.myOrders}）！`);
      await this.playFireFx(target, dmg);
      if (target.hp <= 0) this.routUnit(target);
      this.busy = false;
      if (!this.checkBattleEnd()) this.renderBattle();
    },
    // 医疗营救：绿色 + 数字浮现，回复目标 14% 满编兵力
    async playHealFx(target, amount) {
      const root = $("#fg-content");
      const cell = root && root.querySelector(`.fg-cell[data-r="${target.r}"][data-c="${target.c}"]`);
      AudioSystem.sfx.guard();
      if (cell) {
        cell.classList.add("fg-heal-anim");
        const num = document.createElement("div");
        num.className = "fg-dmgnum heal"; num.textContent = "+" + amount;
        cell.appendChild(num);
        setTimeout(() => num.remove(), 850);
      }
      this.syncUnitDom(target);
      this.syncTopBars();
      await this.uiPause(260);
      if (cell) cell.classList.remove("fg-heal-anim");
      await this.uiPause(200);
    },
    async tryHealOrder(target) {
      if (this.myOrders <= 0) { toast("军令已用尽！"); this.orderMode = null; this.renderBattle(); return; }
      if (!target.alive || this.busy) return;
      this.busy = true;
      this.myOrders--; this.orderMode = null;
      const heal = Math.round(target.hpMax * 0.14);
      target.hp = Math.min(target.hpMax, target.hp + heal);
      this.log(`🩹 医疗营救！${target.g.name} 部兵力回复 ${heal}（军令余 ${this.myOrders}）！`);
      await this.playHealFx(target, heal);
      this.busy = false;
      this.renderBattle();
    },
    // 疑兵佯攻：目标格短促摇晃闪烁，防御 -20% 持续 2 回合（endTurnCycle 里递减，computeCombat 里生效）
    async playFeintFx(target) {
      const root = $("#fg-content");
      const cell = root && root.querySelector(`.fg-cell[data-r="${target.r}"][data-c="${target.c}"]`);
      AudioSystem.sfx.select();
      if (cell) cell.classList.add("fg-feint-anim");
      await this.uiPause(260);
      if (cell) cell.classList.remove("fg-feint-anim");
      await this.uiPause(200);
    },
    async tryFeintOrder(target) {
      if (this.myOrders <= 0) { toast("军令已用尽！"); this.orderMode = null; this.renderBattle(); return; }
      if (!target.alive || this.busy) return;
      this.busy = true;
      this.myOrders--; this.orderMode = null;
      target.feintTurns = 2; target.feintMul = 0.8;
      this.log(`🎭 疑兵佯攻！${target.g.name} 部军心浮动，防御 -20%，持续 2 回合（军令余 ${this.myOrders}）！`);
      await this.playFeintFx(target);
      this.busy = false;
      this.renderBattle();
    },

    /* ---------- 我方回合：选将/移动/行动 ---------- */
    selectUnit(u) {
      if (u.acted || u.side !== "my" || this.turnSide !== "my" || this.delegated) return;
      if (!this.controllable(u.g)) { toast(`${u.g.name} 部不在你的直属调度范围内，已由部将自主接战`); return; }
      // 不再预设「攻击」为默认行动类型——玩家须先在环形菜单里点明确的行动方式，见 onCellClick 的把关
      // 若该部本回合已经挪动过（u.moved），哪怕中途取消选择、重新选中也不能再挪一次——直接进入行动阶段，
      // 之前是「移动后点空白处取消」会把这部重新丢回可移动状态，等于一回合能挪好几次的 bug
      this.selectedUnit = u; this.selPhase = u.moved ? "act" : "move"; this.actionMode = null;
      this.renderBattle();
    },
    moveTo(r, c) {
      const u = this.selectedUnit; if (!u) return;
      u.moved = !(r === u.r && c === u.c);
      u.r = r; u.c = c;
      this.selPhase = "act";
      this.renderBattle();
    },
    standDown() {
      const u = this.selectedUnit; if (!u) return;
      if (!u.moved) u.standDef = true;
      u.acted = true;
      this.afterAction();
    },
    afterAction() {
      this.selectedUnit = null; this.selPhase = null;
      if (this.checkBattleEnd()) return;
      this.renderBattle();
      // 玩家刚出手完毕：按统帅值顺位接着往下推进，把轮到的低统帅队友的行动权还给 AI——
      // advanceAutoPlay 自身已挡住一切不该触发的场合（敌方回合/委托/全自动/重入），此处无需重复判断
      this.advanceAutoPlay();
    },
    onCellClick(r, c) {
      if (this.turnSide !== "my" || this.busy) return;
      const u = this.unitAt(r, c);
      if (this.orderMode === "fire") {
        if (u && u.side === "foe") this.tryFireAttack(u);
        return;
      }
      if (this.orderMode === "heal") {
        if (u && u.side === "my") this.tryHealOrder(u);
        return;
      }
      if (this.orderMode === "feint") {
        if (u && u.side === "foe") this.tryFeintOrder(u);
        return;
      }
      if (!this.selectedUnit) {
        if (u && u.side === "my" && !u.acted) this.selectUnit(u);
        return;
      }
      if (this.selPhase === "move") {
        if (u === this.selectedUnit) { this.moveTo(r, c); return; }
        if (u) {
          if (u.side === "my" && !u.acted) this.selectUnit(u);
          else { this.selectedUnit = null; this.selPhase = null; this.renderBattle(); }
          return;
        }
        const ok = this.reachable(this.selectedUnit).some(([rr, cc]) => rr === r && cc === c);
        if (ok) { this.moveTo(r, c); return; }
        // 点了棋盘上不可达的空格：视为放弃当前这步，退出选择（可另选一将行动）
        this.selectedUnit = null; this.selPhase = null; this.renderBattle();
        return;
      }
      if (this.selPhase === "act") {
        if (u === this.selectedUnit) return;
        // 必须先在环形菜单里选定行动类型（单独攻击/夹击/单挑）才认目标点击，不再有默认"攻击"兜底
        if (u && u.side === "foe" && this.actionMode) {
          const range = this.selectedUnit.ranged ? 2 : 1;
          const d = this.manhattan(this.selectedUnit, u);
          if (d <= range && (this.actionMode !== "challenge" || d === 1)) { this.doTargetAction(u); return; }
        }
        if (u && u.side === "my" && !u.acted) { this.selectUnit(u); return; }
        // 点了非目标区域：退出当前行动选择
        this.selectedUnit = null; this.selPhase = null; this.renderBattle();
      }
    },
    endMyTurn() {
      // 结束回合时，尚未行动的我方武将自动转入待命——未曾挪动过的同样吃到待命 +15% 防的加成，
      // 与手动点「待命」按钮完全一致，玩家不必逐个补点才能吃满这份增益
      this.myUnits.forEach(u => {
        if (!u.alive || u.acted) return;
        if (!u.moved) u.standDef = true;
        u.acted = true;
      });
      this.selectedUnit = null; this.selPhase = null;
      this.turnSide = "foe";
      this.renderBattle();
      this.scheduleIfCurrent(() => this.runFoeTurn(), 400);
    },

    /* ---------- 敌方回合：简化 AI ---------- */
    uiPause(ms = 260) { return new Promise(res => setTimeout(res, ms)); },
    // 排定"这局战斗结束后 ms 毫秒接着跑下一步"的定时器时，必须在排定的这一刻就把 gen 钉死，
    // 而不是等定时器真正触发时才读——若定时器触发前玩家已经中途退出战斗（abort 会令 gen 自增）、
    // 或紧接着又开了一局新战斗，回调函数体内部临时 const myGen = this.gen 只会读到"当下"的 gen，
    // 跟自己比对永远相等，起不到任何拦截作用，陈旧的 runFoeTurn/autoPlayMyTurn 就会在玩家已经
    // 离开战场（甚至正在天下地图操作别的面板）之后凭空续跑，跑出玩家意想不到的结算弹窗。
    scheduleIfCurrent(fn, ms) {
      const gen = this.gen;
      setTimeout(() => { if (this.gen === gen) fn(); }, ms);
    },
    nearestEnemyPos(u, enemies) { return enemies.slice().sort((a, b) => this.manhattan(u, a) - this.manhattan(u, b))[0]; },
    // 军令连续尝试的次数与首次概率都随手头余量走高走低：囤得越多越舍得抛，免得攒到封顶却
    // 始终没用出去、白白浪费；余量紧张时收着点，把机会留给真正紧急的场合——敌我双方共用同一套节奏
    orderAttemptPlan(orders) {
      if (orders >= 7) return [0.75, 0.45, 0.2];
      if (orders >= 4) return [0.6, 0.25];
      if (orders >= 1) return [0.4];
      return [];
    },
    // 敌军军令 AI：按局势优先级挑招（救援残部 > 烧可烧目标 > 士气过低先擂鼓 > 疑兵削弱我军主力 >
    // 兜底擂鼓 > 军令快满时主动疑兵免得溢出浪费）；返回 true 表示确实用掉了一道军令
    async aiUseOrder() {
      if (this.foeOrders <= 0) return false;
      const hurtAlly = this.foeUnits.filter(u => u.alive && u.hp < u.hpMax * 0.55).sort((a, b) => a.hp / a.hpMax - b.hp / b.hpMax)[0];
      const master = this.armyHasFiremaster("foe");
      const fireTargets = this.myUnits.filter(u => u.alive && (this.tiles[u.r][u.c] === "hill" || master));
      const avgMor = this.avgMorale("foe");
      const strongestFoe = this.myUnits.filter(u => u.alive && !(u.feintTurns > 0)).sort((a, b) => b.atk - a.atk)[0];
      // 火攻优先挑"这把火大概率能直接烧溃"的残部斩杀，找不到才退而求其次去烧兵力最厚的那部，
      // 与近战集火（aiActUnit）思路一致：军令也要优先换成实打实的斩获，而非平均分摊伤害
      const fireEstDmg = 600 * (master ? 2 : 1);
      const fireTarget = fireTargets.length ?
        (fireTargets.filter(t => t.hp <= fireEstDmg).sort((a, b) => a.hp - b.hp)[0] || fireTargets.slice().sort((a, b) => b.hp - a.hp)[0]) : null;
      if (hurtAlly && Math.random() < 0.85) {
        this.foeOrders--;
        const heal = Math.round(hurtAlly.hpMax * 0.14);
        hurtAlly.hp = Math.min(hurtAlly.hpMax, hurtAlly.hp + heal);
        this.log(`🩹 敌军医疗营救，${hurtAlly.g.name} 部兵力回复 ${heal}（敌令余 ${this.foeOrders}）！`);
        await this.playHealFx(hurtAlly, heal);
      } else if (fireTarget && Math.random() < 0.65) {
        this.foeOrders--;
        const t = fireTarget;
        const dmg = randInt(400, 800) * (master ? 2 : 1);
        t.hp = Math.max(0, t.hp - dmg);
        this.log(`🔥 敌军火攻！${t.g.name} 部折损 ${dmg}（敌令余 ${this.foeOrders}）！`);
        await this.playFireFx(t, dmg);
        if (t.hp <= 0) this.routUnit(t);
        if (this.checkBattleEnd()) return true;
      } else if (avgMor < 35) {
        this.foeOrders--;
        this.foeUnits.filter(u => u.alive).forEach(u => this.gainMorale(u, 8));
        this.log(`🥁 敌阵擂鼓，敌军士气 +8（敌令余 ${this.foeOrders}）`);
      } else if (strongestFoe && Math.random() < 0.6) {
        this.foeOrders--;
        strongestFoe.feintTurns = 2; strongestFoe.feintMul = 0.8;
        this.log(`🎭 敌军疑兵佯攻，${strongestFoe.g.name} 部防御 -20%，持续 2 回合（敌令余 ${this.foeOrders}）！`);
        await this.playFeintFx(strongestFoe);
      } else if (avgMor < 55) {
        // 兜底擂鼓也要看士气是否真有起色空间——士气本就充裕时不再为了"用掉"而硬用一道，把军令留给真正用得上的时机
        this.foeOrders--;
        this.foeUnits.filter(u => u.alive).forEach(u => this.gainMorale(u, 8));
        this.log(`🥁 敌阵擂鼓，敌军士气 +8（敌令余 ${this.foeOrders}）`);
      } else if (strongestFoe && this.foeOrders >= this.ORDERS_CAP - 2) {
        // 以上时机都没触发，但军令已快攒到封顶——与其看着它溢出浪费，不如主动疑兵削一削
        // 对面最能打的那部，好歹算是花在了刀刃上
        this.foeOrders--;
        strongestFoe.feintTurns = 2; strongestFoe.feintMul = 0.8;
        this.log(`🎭 敌军军令将满，主动疑兵佯攻，${strongestFoe.g.name} 部防御 -20%，持续 2 回合（敌令余 ${this.foeOrders}）！`);
        await this.playFeintFx(strongestFoe);
      } else {
        return false;
      }
      this.renderBattle();
      return true;
    },
    async runFoeTurn() {
      const myGen = this.gen;
      // 是否出军令、出几次都按上面 aiUseOrder 的局势优先级来；这一层"要不要试一次"的概率与
      // 上限次数由 orderAttemptPlan 按当前余量决定——余量充裕时更舍得连续出招，紧张时收着点
      let orderUses = 0;
      const foePlan = this.orderAttemptPlan(this.foeOrders);
      while (this.foeOrders > 0 && orderUses < foePlan.length && Math.random() < foePlan[orderUses]) {
        await this.aiUseOrder();
        orderUses++;
        if (this.gen !== myGen) return;
        if (this.checkBattleEnd()) return;
      }
      for (const u of this.sortedAliveByTong(this.foeUnits)) {
        if (this.gen !== myGen) return;
        if (!u.alive || u.acted) continue;
        await this.aiActUnit(u);
        if (this.gen !== myGen) return;
        if (this.checkBattleEnd()) return;
      }
      if (this.gen !== myGen) return;
      this.endTurnCycle();
    },
    // 我方军令 AI：委外战场全自动推演（主角未亲历）与委托代打（this.delegated）共用同一套逻辑，
    // 与 aiUseOrder（敌方专用）逻辑完全对称，只是主体换成我方——按局势优先级挑招，不写死角色
    async aiUseOrderMy() {
      if (this.myOrders <= 0) return false;
      const hurtAlly = this.myUnits.filter(u => u.alive && u.hp < u.hpMax * 0.55).sort((a, b) => a.hp / a.hpMax - b.hp / b.hpMax)[0];
      const master = this.armyHasFiremaster("my");
      const fireTargets = this.foeUnits.filter(u => u.alive && (this.tiles[u.r][u.c] === "hill" || master));
      const avgMor = this.avgMorale("my");
      const strongestFoe = this.foeUnits.filter(u => u.alive && !(u.feintTurns > 0)).sort((a, b) => b.atk - a.atk)[0];
      // 火攻优先挑"这把火大概率能直接烧溃"的残部斩杀，找不到才退而求其次去烧兵力最厚的那部
      const fireEstDmg = 600 * (master ? 2 : 1);
      const fireTarget = fireTargets.length ?
        (fireTargets.filter(t => t.hp <= fireEstDmg).sort((a, b) => a.hp - b.hp)[0] || fireTargets.slice().sort((a, b) => b.hp - a.hp)[0]) : null;
      if (hurtAlly && Math.random() < 0.85) {
        this.myOrders--;
        const heal = Math.round(hurtAlly.hpMax * 0.14);
        hurtAlly.hp = Math.min(hurtAlly.hpMax, hurtAlly.hp + heal);
        this.log(`🩹 我军医疗营救，${hurtAlly.g.name} 部兵力回复 ${heal}（军令余 ${this.myOrders}）！`);
        await this.playHealFx(hurtAlly, heal);
      } else if (fireTarget && Math.random() < 0.65) {
        this.myOrders--;
        const t = fireTarget;
        const dmg = randInt(400, 800) * (master ? 2 : 1);
        t.hp = Math.max(0, t.hp - dmg);
        this.log(`🔥 我军火攻！${t.g.name} 部折损 ${dmg}（军令余 ${this.myOrders}）！`);
        await this.playFireFx(t, dmg);
        if (t.hp <= 0) this.routUnit(t);
        if (this.checkBattleEnd()) return true;
      } else if (avgMor < 35) {
        this.myOrders--;
        this.myUnits.filter(u => u.alive).forEach(u => this.gainMorale(u, 8));
        this.log(`🥁 我阵擂鼓，我军士气 +8（军令余 ${this.myOrders}）`);
      } else if (strongestFoe && Math.random() < 0.6) {
        this.myOrders--;
        strongestFoe.feintTurns = 2; strongestFoe.feintMul = 0.8;
        this.log(`🎭 我军疑兵佯攻，${strongestFoe.g.name} 部防御 -20%，持续 2 回合（军令余 ${this.myOrders}）！`);
        await this.playFeintFx(strongestFoe);
      } else if (avgMor < 55) {
        this.myOrders--;
        this.myUnits.filter(u => u.alive).forEach(u => this.gainMorale(u, 8));
        this.log(`🥁 我阵擂鼓，我军士气 +8（军令余 ${this.myOrders}）`);
      } else if (strongestFoe && this.myOrders >= this.ORDERS_CAP - 2) {
        // 以上时机都没触发，但军令已快攒到封顶——主动疑兵削一削对面最能打的那部，别白白浪费掉
        this.myOrders--;
        strongestFoe.feintTurns = 2; strongestFoe.feintMul = 0.8;
        this.log(`🎭 我军军令将满，主动疑兵佯攻，${strongestFoe.g.name} 部防御 -20%，持续 2 回合（军令余 ${this.myOrders}）！`);
        await this.playFeintFx(strongestFoe);
      } else {
        return false;
      }
      this.renderBattle();
      return true;
    },
    // 我方回合全自动推演：委外战场 observe 模式（主角未被抽中亲历）与玩家中途「委托」两种场景共用，
    // 与 endMyTurn+runFoeTurn 的正常玩家流程完全并行、结构对称，跑完即调用既有 endMyTurn() 交回敌方回合
    async autoPlayMyTurn() {
      const myGen = this.gen;
      // 委托可随时被玩家收回：endTurnCycle 排定本次调用时 delegated 也许还是真，但真正执行的这一刻
      // 玩家可能已经点了收回——改按当下状态走「只帮不可控部众代打」，把可控部众原样留给玩家
      if (!this.delegated && !(this.external && this.external.auto)) { this.advanceAutoPlay(); return; }
      let orderUses = 0;
      const myPlan = this.orderAttemptPlan(this.myOrders);
      while (this.myOrders > 0 && orderUses < myPlan.length && Math.random() < myPlan[orderUses]) {
        await this.aiUseOrderMy();
        orderUses++;
        if (this.gen !== myGen) return;
        if (this.checkBattleEnd()) return;
      }
      for (const u of this.sortedAliveByTong(this.myUnits)) {
        if (this.gen !== myGen) return;
        if (!u.alive || u.acted) continue;
        await this.aiActUnit(u);
        if (this.gen !== myGen) return;
        if (this.checkBattleEnd()) return;
      }
      if (this.gen !== myGen) return;
      this.endMyTurn();
    },
    // 统帅值排序：本回合尚未行动的存活武将按统帅从高到低排成一份固定顺序快照——每次调用都
    // 重新按"当前谁还没动"筛一遍，但相对先后次序只认统帅高低，不看阵营/是否可操控
    sortedAliveByTong(units) {
      return units.filter(u => u.alive && !u.acted).sort((a, b) => b.g.tong - a.g.tong);
    },
    // 我方回合的自动接战推进：候选池补位而来、不在玩家直属调度范围内的部众（见 controllable）
    // 按统帅值从高到低依次自动接战，一旦轮到玩家可操控的部众就立即停手，把回合交还给玩家——
    // 这正是本轮要修的缺陷：旧版不分统帅高低，一律先把全体不可控部众打完仗，等玩家真正上场时
    // 队友早已全部「已行动」，eligibleFlankers 的 !acted 判定形同虚设，玩家永远拉不到人夹击。
    // 现在统帅比玩家本人低的队友会留到玩家出手之后再继续（由 afterAction 收尾时接着调用本函数
    // 往下推进），统帅比玩家高的队友则仍先手行动，与统帅代表的"用兵反应速度"设定相符。
    // 玩家操作完自己能管的部众后仍需手动点「结束回合」——本函数只负责推进队列，不代为结束回合。
    // 三重把关缺一不可：①只在真正的"我方回合、半自动"场景下才有意义，委托/全自动推演自有各自
    // 独立的整队循环（autoFinishMyTurn/autoPlayMyTurn），敌方回合更是完全不相干——武将的主动战法/
    // 单挑（useActiveSkill、challenge）AI 与玩家共用同一份实现，末尾都会调用 afterAction()，
    // 若不挡住 turnSide!=="my"/delegated/external.auto 这些场合，AI 出招时也会稀里糊涂地
    // 触发一次本函数；②_advancing 防重入——本函数内部 await this.aiActUnit(u) 时，若这一步
    // 恰好用出主动战法又顺带调用了 afterAction()，会试图在尚未跑完的这次调用里再套一层自己，
    // 两份调用各拿着自己那份"谁还没行动"的快照并发去抢同一个武将的行动权，双重出手、动画错乱
    async advanceAutoPlay() {
      if (this.turnSide !== "my" || this.delegated || (this.external && this.external.auto) || this._advancing) return;
      this._advancing = true;
      try {
        const myGen = this.gen;
        for (const u of this.sortedAliveByTong(this.myUnits)) {
          if (this.gen !== myGen) return;
          if (!u.alive || u.acted) continue;
          if (this.controllable(u.g)) return;
          await this.aiActUnit(u);
          if (this.gen !== myGen) return;
          if (this.checkBattleEnd()) return;
        }
        if (this.gen !== myGen) return;
        this.renderBattle();
      } finally {
        this._advancing = false;
      }
    },
    // 「委托」：玩家中途放弃亲自指挥，把本回合剩余「未行动」的部众（含此前一直由玩家亲自操控的部众）
    // 一并交给 AI 接管，随后调用 endMyTurn 进入敌方回合——此后每个我方回合，endTurnCycle 见 this.delegated
    // 便会持续自动排定 autoPlayMyTurn，无需再逐回合手动确认，直到战斗结束
    async autoFinishMyTurn() {
      const myGen = this.gen;
      this.selectedUnit = null; this.selPhase = null; this.actionMode = null; this.orderMode = null;
      for (const u of this.sortedAliveByTong(this.myUnits)) {
        if (this.gen !== myGen) return;
        if (!u.alive || u.acted) continue;
        await this.aiActUnit(u);
        if (this.gen !== myGen) return;
        if (this.checkBattleEnd()) return;
      }
      if (this.gen !== myGen) return;
      this.endMyTurn();
    },
    // 委托：可随时切换，再点一次即收回指挥权，不再要求二次确认——按钮本身已明确标注当前状态
    // （🤝 委托 / 🎮 收回指挥），点错了立刻能反悔，无需专门弹窗确认这一步
    delegate() {
      if (this.phase !== "battle") return;
      // 收回指挥权不设回合限制：委托战斗中敌我回合交替飞快，玩家很可能在敌方回合点这个按钮，
      // 若仍要求 turnSide==="my" 才生效，收回操作会被静默吞掉、按钮看着点了却毫无反应
      if (this.delegated) {
        this.delegated = false;
        this.log("🎮 已收回指挥权，继续亲自操控");
        this.renderBattle();
        return;
      }
      this.delegated = true;
      this.log("🤝 已委托全军自主指挥，静观战报即可");
      this.renderBattle();
      // 开启委托这一刻若恰逢我方回合，立即代打完当前回合；若是敌方回合，则等 endTurnCycle
      // 轮到我方回合时自会按 this.delegated 走 autoPlayMyTurn，无需在此强求
      if (this.turnSide === "my") this.autoFinishMyTurn();
    },
    // 侧别无关的通用 AI：既供敌方回合（runFoeTurn）调用，也供外部委外战场全自动推演时
    // 驱动我方（autoPlayMyTurn，主角未亲历时）调用——按 u.side 自行判定敌我，不再写死"我方=玩家"
    async aiActUnit(u) {
      const enemies = (u.side === "foe" ? this.myUnits : this.foeUnits).filter(e => e.alive);
      if (!enemies.length) return;
      // 冷却完毕的将魂战法：约四成概率优先使用，而非单纯移动攻击
      if (u.skActive && u.skCd <= 0 && Math.random() < 0.4) {
        await this.useActiveSkill(u);
        await this.uiPause(150);
        return;
      }
      const range = u.ranged ? 2 : 1;
      // 集火：可斩杀目标优先挑血量最低者；找不到必杀目标时，移动后攻击也优先伤害更高/更容易斩杀（含夹击加成）的目标
      let target = enemies.filter(e => this.manhattan(u, e) <= range).sort((a, b) => a.hp - b.hp)
        .find(e => this.computeCombat(u, e).dmg >= e.hp);
      if (!target) {
        const reach = this.reachable(u);
        let bestMove = null, bestTarget = null, bestScore = -1;
        for (const [r, c] of reach) {
          const near = enemies.filter(e => Math.abs(e.r - r) + Math.abs(e.c - c) <= range);
          for (const e of near) {
            const dmg = this.computeCombatAt(u, e, r, c).dmg;
            const score = dmg + (dmg >= e.hp ? 1000 : 0) - e.hp * 0.001;
            if (score > bestScore) { bestScore = score; bestMove = [r, c]; bestTarget = e; }
          }
        }
        if (bestMove) {
          await this.animateMove(u, this.findPath(u, bestMove[0], bestMove[1]) || [bestMove]);
          u.moved = true; target = bestTarget;
        } else {
          const lowHp = u.hp < u.hpMax * 0.25;
          // 大本营策略：己方大营已被围困或有敌军逼近时优先回防；否则在没有迫切战斗任务时
          // 有三成概率主动向对方大本营进军，伺机围城——不再只会一味扑向最近的敌军
          const ownCamp = u.side === "foe" ? this.foeCamp : this.myCamp;
          const enemyCamp = u.side === "foe" ? this.myCamp : this.foeCamp;
          const ownCampSiege = u.side === "foe" ? this.foeCampSiege : this.myCampSiege;
          const campThreatened = ownCampSiege > 0 || enemies.some(e => this.manhattan(e, ownCamp) <= 2);
          let dest;
          if (lowHp) dest = ownCamp;
          else if (campThreatened && this.manhattan(u, ownCamp) <= 5) dest = ownCamp;
          else if (Math.random() < 0.3) dest = enemyCamp;
          else dest = this.nearestEnemyPos(u, enemies);
          const best = reach.slice().sort((a, b) =>
            (Math.abs(a[0] - dest.r) + Math.abs(a[1] - dest.c)) - (Math.abs(b[0] - dest.r) + Math.abs(b[1] - dest.c)))[0];
          if (best) await this.animateMove(u, this.findPath(u, best[0], best[1]) || [best]);
          u.acted = true;
          await this.uiPause(80);
          this.renderBattle();
          return;
        }
      }
      // 单挑：贴身（非远程）交锋且这一击并非稳赢一记击溃时，AI 也有一定概率挑发对方阵前一战，
      // 给战局添些变数，而不是逢敌必默认一味厮杀——稳赢的场合仍照常攻击，不白白把送到嘴边的战果让给赌局
      if (!u.ranged && this.manhattan(u, target) === 1 && this.computeCombat(u, target).dmg < target.hp && Math.random() < 0.18) {
        await this.challenge(u, target);
        return;
      }
      // 夹击：若目标身周已有其他未行动同袍就位，AI 优先合力围攻（伤害倍率更高、更快解决战斗、
      // 挨反击的只有主攻手），不再像旧版那样每次都单打独斗
      const joiners = this.eligibleFlankers(u, target);
      if (joiners.length > 0) {
        await this.resolveCoordinatedAttack([u, ...joiners], target);
      } else {
        await this.resolveAttack(u, target);
        u.acted = true;
      }
      this.renderBattle();
    },

    /* ---------- 回合推进与胜负 ---------- */
    startBattle() {
      this.phase = "battle";
      this.turnSide = "my"; this.turnN = 1;
      this.myOrders = this.calcOrders(this.mine); this.foeOrders = this.calcOrders(this.foes);
      this.myUnits.forEach(u => { u.acted = false; });
      this.foeUnits.forEach(u => { u.acted = false; });
      this.log(`🥁 两军对圆！各部按己方阵形列阵——前 3 回合内阵形相克（锥克方圆·方圆克雁行·雁行克鹤翼·鹤翼克锥形）额外 +10% 攻击`);
      this.renderBattle();
      // 委外战场且并非全自动推演（主角亲历，但麾下未必人人由你直接调度）：一开局就先让不在调度范围内的
      // 部众自行接战，把回合真正交到玩家手上的只有可指挥的那部分
      if (this.rpg && !this.delegated && !(this.external && this.external.auto)) this.advanceAutoPlay();
    },
    endTurnCycle() {
      this.formTurnsLeft = Math.max(0, this.formTurnsLeft - 1);
      // 雁行乱箭：改为逐将独立——持雁行阵者对身周 2 格内敌方单位各自蚀其士气
      if (this.formTurnsLeft > 0) {
        [...this.myUnits, ...this.foeUnits].forEach(u => {
          if (!u.alive || u.form !== "goose") return;
          const enemies = u.side === "my" ? this.foeUnits : this.myUnits;
          enemies.filter(e => e.alive && this.manhattan(u, e) <= 2).forEach(e => this.dropMorale(e, this.FORMS.goose.moraleDrain));
        });
      }
      [...this.myUnits, ...this.foeUnits].forEach(u => {
        if (!u.alive) return;
        if (u.side === "my" && u.r === this.myCamp.r && u.c === this.myCamp.c) u.hp = Math.min(u.hpMax, u.hp + Math.round(u.hpMax * 0.08));
        if (u.side === "foe" && u.r === this.foeCamp.r && u.c === this.foeCamp.c) u.hp = Math.min(u.hpMax, u.hp + Math.round(u.hpMax * 0.08));
        u.standDef = false; u.moved = false;
        if (u.skCd > 0) u.skCd--;
        if (u.feintTurns > 0) u.feintTurns--;
      });
      // 军令改为累积池：本回合未用完的军令带到下一回合，叠加新一轮恢复量（已减半，见 calcOrderRegen），
      // 封顶 ORDERS_CAP（10）道
      this.myOrders = Math.min(this.ORDERS_CAP, this.myOrders + this.calcOrderRegen(this.myUnits.filter(u => u.alive).map(u => u.g)));
      this.foeOrders = Math.min(this.ORDERS_CAP, this.foeOrders + this.calcOrderRegen(this.foeUnits.filter(u => u.alive).map(u => u.g)));
      // 大本营围城：敌军连续站在我方大营、或我军连续站在敌方大营满 3 回合，即视为攻破——
      // 每回合末结算一次，中途换防（占领者撤走）就清零重新计，不是"累计出现过 3 次"
      const foeInMyCamp = this.foeUnits.some(x => x.alive && x.r === this.myCamp.r && x.c === this.myCamp.c);
      const myInFoeCamp = this.myUnits.some(x => x.alive && x.r === this.foeCamp.r && x.c === this.foeCamp.c);
      this.myCampSiege = foeInMyCamp ? (this.myCampSiege || 0) + 1 : 0;
      this.foeCampSiege = myInFoeCamp ? (this.foeCampSiege || 0) + 1 : 0;
      if (foeInMyCamp) this.log(`⚠️ 我方大营遭敌军占据，已围 ${this.myCampSiege}/3 回合！`);
      if (myInFoeCamp) this.log(`🔥 我军已占据敌方大营，围困 ${this.foeCampSiege}/3 回合！`);
      if (this.foeCampSiege >= 3) { this.finish(true, "大军攻破敌方大营，敌军土崩瓦解"); return; }
      if (this.myCampSiege >= 3) { this.finish(false, "大营失守三回合，全军溃败"); return; }
      if (this.checkBattleEnd()) return;
      // 封顶 100 回合：满百回合仍未分出生死，以双方存兵多寡定胜负（兵力相同时以总士气为次级判据）
      if (this.turnN >= 100) {
        const myHp = this.totalHp("my"), foeHp = this.totalHp("foe");
        const myMor = this.myUnits.filter(u => u.alive).reduce((s, u) => s + u.morale, 0);
        const foeMor = this.foeUnits.filter(u => u.alive).reduce((s, u) => s + u.morale, 0);
        const won = myHp !== foeHp ? myHp > foeHp : myMor >= foeMor;
        this.log(`⏳ 鏖战满百回合，以存兵多寡定胜负——我方 ${Math.round(myHp).toLocaleString()} · 敌方 ${Math.round(foeHp).toLocaleString()}`);
        this.finish(won, "鏖战满百回合仍未分出生死，以存兵多寡定胜负");
        return;
      }
      this.turnN++;
      this.turnSide = "my";
      // 我方/敌方的「已行动」都在这里统一清零——旧版只清了我方，导致敌方棋子从第二回合起
      // 永远顶着「已行动」的灰化样式，分不清这一回合谁动过谁还没动（详见本方法开头的注）
      this.myUnits.forEach(u => { u.acted = false; });
      this.foeUnits.forEach(u => { u.acted = false; });
      this.log(`—— 第 ${this.turnN} 回合 ——`);
      this.renderBattle();
      // 委外战场全自动推演（主角未亲历，或玩家中途点了「委托」）：敌方回合刚结束、回到我方回合时，
      // 接着自动跑我方这一轮，不必等玩家点击——与 endMyTurn 里"我方跑完自动接敌方回合"首尾相扣，
      // 串成完整的无人值守循环
      if ((this.delegated || (this.external && this.external.auto)) && this.phase === "battle") {
        this.scheduleIfCurrent(() => this.autoPlayMyTurn(), 400);
      } else if (this.rpg && this.phase === "battle") {
        // 半自动：主角亲历但麾下未必人人受你直接调度，每回合开局先让不可控的部众自行接战
        this.advanceAutoPlay();
      }
    },
    // 胜负判定：一方全部武将皆已溃退（兵力或士气归零）才算落败——单场单挑或单一部的溃散
    // 至多只是"折损一部"，不会像旧版团队共享士气那样被一次意外拖累判定整场大捷/大败。
    // phase 守卫：部分调用链上，判定即战即败的军令（如火攻）分支内部已经调用过本函数并触发过 finish()，
    // 紧接着外层（runFoeTurn/autoPlayMyTurn 的军令循环）又会不知情地再调一次——若不拦下，finish()
    // 会被同一次胜负结果重复调用两次：第二次调用时 this.external 已被第一次的 finishExternal 清空，
    // 于是误入"非委外战场"分支，凭空多开一张野战演武自己的结算卡（叠在委外战场真正的战报之上）
    checkBattleEnd() {
      if (this.phase !== "battle") return false;
      if (!this.myUnits.some(u => u.alive)) { this.finish(false, "我军全部溃退、全线崩溃"); return true; }
      if (!this.foeUnits.some(u => u.alive)) { this.finish(true, "敌军全部溃退、全线崩溃"); return true; }
      return false;
    },
    // 功勋榜结算：存活至终局者再加一份「力战存活」功勋，随后按功勋值把双方所有参战武将一并排出名次——
    // 供 finish() 自身的战报卡片、以及委外战场（边境战/攻城战）的 res.meritRanking 共用同一份数据
    finalizeMerit() {
      [...this.myUnits, ...this.foeUnits].forEach(u => { if (u.alive) this.gainMerit(u, 5); });
      return [...this.myUnits, ...this.foeUnits]
        .map(u => ({ id: u.g.id, name: u.g.name, side: u.side, merit: Math.round(u.merit || 0), alive: u.alive }))
        .sort((a, b) => b.merit - a.merit);
    },
    // 战报唯一的"每位武将一行"展示：既是功勋榜也是战况板——委外战场（边境战/攻城战）传入的
    // 是 finalizeMerit() 精简后的 {id,name,side,merit,alive}，没有兵力/士气可看，只显示战果一行；
    // 野战演武自己的终局战报（finish()）会在调用前把 hp/hpMax/morale 一并补充进条目，多显示一行细节——
    // 同一套外观、同一处维护，不必再在战报里另起一份重复的折损/留存文字列表
    meritRankingHtml(ranking, opts = {}) {
      const list = opts.limit ? ranking.slice(0, opts.limit) : ranking;
      if (!list.length) return "";
      const medal = i => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
      const rows = list.map((r, i) => {
        const hasDetail = r.hp != null;
        return `<div class="merit-row ${r.side}${r.alive ? "" : " fallen"}">
          <div class="merit-line1">
            <span class="merit-no">${medal(i)}</span>
            <span class="merit-name">${r.name}</span>
            <span class="merit-side">${r.side === "my" ? "我方" : "敌方"}</span>
            ${r.alive ? "" : `<span class="merit-fallen-tag">阵亡</span>`}
          </div>
          <div class="merit-line2">
            ${hasDetail ? `<span>${r.alive ? `兵 ${Math.max(0, Math.round(r.hp)).toLocaleString()}/${r.hpMax.toLocaleString()}` : "－"}</span><span>${r.alive ? "气 " + Math.round(r.morale) : "－"}</span>` : ""}
            <span class="merit-val">功勋 ${r.merit}</span>
          </div>
        </div>`;
      }).join("");
      return `<div class="mc-sect">🎖️ 此役战况总览</div><div class="merit-board">${rows}</div>`;
    },
    // 终局战报：在原有胜负/阵亡/均气之外，补上此役头功、双方折损/留存武将点名，让战报更像一份可读的战报
    // 而不是三行数字——kills/dmgDealt 由 resolveAttack/useActiveSkill/tryFireAttack 全程累加
    finish(won, reason) {
      this.phase = "done";
      const meritRanking = this.finalizeMerit();
      // 委外战场（边境战/攻城战）：不展示野战演武自身的战果卡，折算为调用方约定的结果对象后回调，
      // 由调用方（MapUI.resolveBorderWar/resolveSiege）沿用既有的经验/金币/夺城结算流程
      if (this.external) { this.finishExternal(won, reason, meritRanking); return; }
      const fallenMyCount = this.myUnits.filter(u => !u.alive).length;
      const fallenFoeCount = this.foeUnits.filter(u => !u.alive).length;
      const mvp = meritRanking[0];
      // 下面这份战况总览板要一并挑大梁展示每位武将的存亡/兵力/士气/功勋，不再另起一份文字列表
      // 重复念一遍谁阵亡、谁留存——两处对不上号、还占地方，合并成一处才是真正"好好规划"过的战报
      const unitById = new Map([...this.myUnits, ...this.foeUnits].map(u => [u.g.id, u]));
      const summaryEntries = meritRanking.map(r => {
        const u = unitById.get(r.id);
        return u ? { ...r, hp: u.hp, hpMax: u.hpMax, morale: u.morale } : r;
      });
      openOverlay(`<div class="result-card">
        <h1>${won ? "🏆 野战大捷" : "💀 兵败如山"}</h1>
        <div class="wdesc">${reason}<br><br>
          ⚔️ 鏖战 ${this.turnN} 回合 · 阵亡：我方 ${fallenMyCount}/${this.myUnits.length} 将 · 敌方 ${fallenFoeCount}/${this.foeUnits.length} 将<br>
          ${mvp && mvp.merit > 0 ? `🎖️ 此役头功：${mvp.name}（${mvp.side === "my" ? "我方" : "敌方"}，功勋 ${mvp.merit}）` : ""}
        </div>
        ${this.meritRankingHtml(summaryEntries)}
        <div class="btns">
          <button class="btn-primary" id="fg-again">再战一场</button>
          <button class="btn-ghost" id="fg-home">返回菜单</button>
        </div></div>`, { modal: true });
      $("#fg-again").onclick = () => { closeOverlay(); this.open(); };
      $("#fg-home").onclick = () => { closeOverlay(); this.abort(); showScreen("home"); };
    },
    // 委外战场终局：历战成长与旧版 FieldBattle.finishExternal 同一套逻辑（双方真实参战武将各有小概率
    // 六维精进），随后折算为调用方约定的结果对象（mySurvivors/foeSurvivors 就是原样的武将对象引用，
    // 不是战场内部的 unit 包装，调用方无需关心网格战场的内部数据结构）
    finishExternal(won, reason, meritRanking) {
      if (typeof Campaign !== "undefined") {
        const gm = Campaign.mapState();
        if (gm) {
          let grew = 0;
          this.mine.forEach(g => { if (g.id != null && g.id >= 0 && Growth.battle(gm, g, won)) grew++; });
          this.foes.forEach(g => { if (g.id != null && g.id >= 0 && Growth.battle(gm, g, !won)) grew++; });
          if (grew) this.log(`📈 历战磨砺：${grew} 位武将六维有所精进`);
        }
      }
      const res = {
        playerWon: won,
        mySurvivors: this.myUnits.filter(u => u.alive).map(u => u.g),
        foeSurvivors: this.foeUnits.filter(u => u.alive).map(u => u.g),
        kills: this.foeUnits.filter(u => !u.alive).length,
        myTroopsLeft: Math.max(0, Math.round(this.totalHp("my"))),
        foeTroopsLeft: Math.max(0, Math.round(this.totalHp("foe"))),
        meritRanking: meritRanking || this.finalizeMerit(),
      };
      const onDone = this.external.onDone;
      this.external = null;
      if (onDone) onDone(res);
    },

    /* ---------- 渲染 ---------- */
    boardCellsHtml(opts = {}) {
      let html = "";
      for (let r = 0; r < this.ROWS; r++) {
        for (let c = 0; c < this.COLS; c++) {
          const terr = this.tiles[r][c];
          const u = this.unitAt(r, c);
          let cls = "fg-cell fg-t-" + terr;
          if (opts.reachSet && opts.reachSet.has(r + "," + c)) cls += " fg-reach";
          if (opts.enemySet && opts.enemySet.has(r + "," + c)) cls += " fg-enemy-in-range";
          if (opts.healSet && opts.healSet.has(r + "," + c)) cls += " fg-heal-target";
          // 军令选目标期间，非可选目标的格子整片蒙上半透明遮罩，只留可选目标清晰可辨
          if (opts.dimSet && !opts.dimSet.has(r + "," + c)) cls += " fg-dimmed";
          const selUnit = opts.selectedUnit || this.selectedUnit;
          if (selUnit && u === selUnit) cls += " fg-selected";
          let token = "";
          if (u) {
            const pct = Math.max(0, u.hp / u.hpMax);
            const moralePct = Math.max(0, u.morale / 100);
            const sk = u.skActive ? Skill.of(u.g) : null;
            const skBadge = sk ? `<span class="fg-skbadge ${u.skCd > 0 ? "cd" : ""}" title="${sk.n}${u.skCd > 0 ? `（冷却 ${u.skCd}）` : "（可用）"}">${sk.icon}</span>` : "";
            const form = this.FORMS[u.form];
            const canCycleForm = this.phase === "deploy" && u.side === "my";
            const formBadge = `<span class="fg-formbadge${canCycleForm ? " tap" : ""}" data-formcycle="1" title="${form.n}${canCycleForm ? "（点击切换阵形）" : ""}">${form.icon}</span>`;
            const tip = `${u.g.name}　${form.n}　兵力 ${Math.max(0, Math.round(u.hp))}/${u.hpMax}　士气 ${Math.round(u.morale)}`;
            token = `<div class="fg-unit ${u.side} ${this.phase === "battle" && u.acted ? "acted" : ""}" title="${tip}">
              ${formBadge}
              <span class="fg-name">${u.g.name}</span>
              ${skBadge}
              <span class="fg-hpbar"><i style="width:${pct * 100}%;background:${hpColor(pct)}"></i></span>
              <span class="fg-morbar"><i style="width:${moralePct * 100}%;background:${moraleColor(moralePct)}"></i></span>
            </div>`;
          } else {
            token = `<span class="fg-terrain-icon">${this.TERRAINS[terr].icon}</span>`;
          }
          // 大本营围城光圈：不论格上有没有棋子都要显示，进度对应围了几个回合（满 3 即破营）
          let siegeHtml = "";
          if (terr === "camp" && this.phase === "battle") {
            const isMy = r === this.myCamp.r && c === this.myCamp.c;
            const isFoe = r === this.foeCamp.r && c === this.foeCamp.c;
            const siege = isMy ? (this.myCampSiege || 0) : isFoe ? (this.foeCampSiege || 0) : 0;
            if (siege > 0) siegeHtml = `<span class="fg-siege-ring s${Math.min(3, siege)}" title="已被围 ${siege}/3 回合"></span>`;
          }
          html += `<div class="${cls}" data-r="${r}" data-c="${c}">${token}${siegeHtml}</div>`;
        }
      }
      return html;
    },
    renderDeploy() {
      showScreen("fieldgrid");
      this.syncTopbarTitle();
      const tplName = this.TERRAIN_TPL_NAME[this.terrainTpl];
      const root = $("#fg-content");
      // 选中武将后，框出该棋子本身（.fg-selected）与可落子的空格（.fg-reach），不然分不清在调谁、能挪到哪
      const deployReachSet = new Set();
      if (this.deploySel) {
        for (let r = this.ROWS - 2; r < this.ROWS; r++) for (let c = 0; c < this.COLS; c++) {
          if (!this.unitAt(r, c)) deployReachSet.add(r + "," + c);
        }
      }
      root.innerHTML = `
        <div class="section-hint">棋盘对垒：方格步阵，一将一格。阵形按将而定——点棋子左上角图标可切换该将的阵形，备好后出击</div>
        <div class="fb-banner">🗺️ 战场·${tplName} · 军令 <b>${this.myOrders}</b> 道</div>
        <div class="fg-legend">${Object.entries(this.TERRAINS).map(([k, t]) => `<span class="fg-legend-item"><i class="fg-t-${k}"></i>${t.icon}${t.n}</span>`).join("")}</div>
        <div class="fg-legend">${Object.entries(this.FORMS).map(([k, f]) => `<span class="fg-legend-item">${f.icon}${f.n}</span>`).join("")}</div>
        <div class="fg-board-wrap"><div class="fg-board" style="grid-template-columns:repeat(${this.COLS},1fr)">${this.boardCellsHtml({ selectedUnit: this.deploySel, reachSet: deployReachSet })}</div></div>
        <div class="section-hint">🚩 我营在下，🚩 敌营在上；${this.deploySel ? `已选中 <b>${this.deploySel.g.name}</b>，点蓝框空格调整站位` : "点选我方武将再点空格可调整初始站位"}</div>
        <div class="cup-start-btns" style="margin-top:10px"><button class="cup-go primary" id="fg-go">⚔️ 全军出击</button></div>`;
      const formKeys = Object.keys(this.FORMS);
      $$(".fg-cell", root).forEach(cell => cell.onclick = (e) => {
        const r = +cell.dataset.r, c = +cell.dataset.c;
        const u = this.unitAt(r, c);
        if (e.target.closest(".fg-formbadge") && u && u.side === "my") {
          u.form = formKeys[(formKeys.indexOf(u.form) + 1) % formKeys.length];
          this.renderDeploy(); return;
        }
        if (this.deploySel) {
          const sel = this.deploySel; this.deploySel = null;
          if (r >= this.ROWS - 2 && !u) { sel.r = r; sel.c = c; }
          this.renderDeploy(); return;
        }
        if (u && u.side === "my") { this.deploySel = u; this.renderDeploy(); }
      });
      $("#fg-go", root).onclick = () => this.startBattle();
    },
    // 顶部 VS 兵力条：两条从中线向外撑满，兵力越少、外沿越往中间方向收缩——一眼看出此消彼长；
    // 拆成独立方法是为了让 syncTopBars() 能在命中瞬间原地刷新这一小块，不必牵动整块棋盘重绘
    // 顶部这一行现在把兵力条与存活/均气/军令全部并进同一行——点这一整条即弹出逐将详情浮层（见 showMatchupOverlay）
    // 军令数不再显示数字，改画等量的金黄色小旗子——直观感受"还剩几道军令"而不必读数
    orderFlagsHtml(n, side) {
      return `<span class="fg-flags ${side}">${Array.from({ length: Math.max(0, n) }).map(() => `<span class="fg-flag-icon"></span>`).join("")}</span>`;
    },
    // 三行整体布局（不再是"两侧+中轴"三栏）：第一行军名紧贴左右外沿、兵力数字各自朝中间靠拢；
    // 第二行兵力色条从中线向两侧撑开；第三行"武将数+均气"仍在最外侧，中间对齐色条中轴处
    // 摆双方军令小旗——我方旗子朝左展开、敌方朝右展开，方向左右镜像
    vsbarHtml() {
      const myTotalHp = this.totalHp("my"), foeTotalHp = this.totalHp("foe");
      const myMax = this.myUnits.reduce((s, x) => s + x.hpMax, 0) || 1;
      const foeMax = this.foeUnits.reduce((s, x) => s + x.hpMax, 0) || 1;
      const myPct = Math.max(0, Math.min(100, myTotalHp / myMax * 100));
      const foePct = Math.max(0, Math.min(100, foeTotalHp / foeMax * 100));
      const myAlive = this.myUnits.filter(x => x.alive).length, foeAlive = this.foeUnits.filter(x => x.alive).length;
      return `<div class="fg-vsbar" id="fg-vsbar-open">
        <div class="fg-vsbar-row1">
          <span class="fg-vsbar-half-row my"><b>我军</b><span class="fg-vsbar-num">${myTotalHp.toLocaleString()}</span></span>
          <span class="fg-vsbar-half-row foe"><span class="fg-vsbar-num">${foeTotalHp.toLocaleString()}</span><b>敌军</b></span>
        </div>
        <div class="fg-vsbar-track">
          <div class="fg-vsbar-half my"><i style="width:${myPct}%"></i></div>
          <div class="fg-vsbar-mid">VS</div>
          <div class="fg-vsbar-half foe"><i style="width:${foePct}%"></i></div>
        </div>
        <div class="fg-vsbar-row3">
          <span class="fg-vsbar-stat">武将${myAlive} · 气${this.avgMorale("my")}</span>
          <span class="fg-vsbar-flagzone">
            ${this.orderFlagsHtml(this.myOrders, "my")}
            ${this.orderFlagsHtml(this.foeOrders, "foe")}
          </span>
          <span class="fg-vsbar-stat">武将${foeAlive} · 气${this.avgMorale("foe")}</span>
        </div>
      </div>`;
    },
    // 大本营围城提示——仅在有内容时才占位，平时这一区域高度为 0；阵形相克加成倒计时不再展示
    // （阵形相克这个功能本身留待以后再打磨，眼下先把这一行区域腾出来，压缩战报区域、多留给战场地图）
    hintLineHtml() {
      const bits = [];
      if (this.myCampSiege > 0) bits.push(`⚠️ 我方大营已被围 ${this.myCampSiege}/3 回合`);
      if (this.foeCampSiege > 0) bits.push(`🔥 已围困敌方大营 ${this.foeCampSiege}/3 回合`);
      if (!bits.length) return "";
      return `<div class="fg-hintline">${bits.join(" · ")}</div>`;
    },
    // 军令选目标提示：改成悬浮在棋盘正上方居中的小标签（与武将行动菜单收起后同一视觉语言），
    // 不再占用独立行布局，有没有这行提示都不会挤压/撑高战场区域
    orderModeHintHtml() {
      if (this.orderMode === "fire") return `<div class="fg-order-float">🔥 请点选要火攻的敌方单位</div>`;
      if (this.orderMode === "heal") return `<div class="fg-order-float">🩹 请点选要医疗营救的己方单位</div>`;
      if (this.orderMode === "feint") return `<div class="fg-order-float">🎭 请点选要疑兵佯攻的敌方单位</div>`;
      return "";
    },
    // 逐将对比明细的行/列构建，供 showMatchupOverlay() 弹层复用
    matchupDetailInner() {
      // 字段太多塞不进一行还要放大字号，改为每将两行：第一行姓名+兵力（兵力放在姓名旁的行中间，
      // 不再单独垫到姓名下面一行去，姓名与兵力数据一眼就能对上号）+阵形图标；
      // 第二行将魂名+士气+攻防三项数值，行内统一 gap 让间距看起来一致
      const row = u => {
        const sk = Skill.of(u.g);
        return `<div class="fg-md-row${u.alive ? "" : " dead"}">
        <div class="fg-md-line1">
          <span class="fg-md-name">${u.g.name}</span>
          <span class="fg-md-hp">${u.alive ? Math.max(0, Math.round(u.hp)).toLocaleString() : "阵亡"}${u.alive ? "/" + u.hpMax.toLocaleString() : ""}</span>
          <span class="fg-md-form">${this.FORMS[u.form].icon}</span>
        </div>
        <div class="fg-md-line2">
          <span class="fg-md-soul">${sk ? sk.n : "-"}</span>
          <span class="fg-md-mor">${u.alive ? "气" + Math.round(u.morale) : "-"}</span>
          <span class="fg-md-ad">${Math.round(u.atk)}/${Math.round(u.def)}</span>
        </div>
      </div>`;
      };
      const col = (units, label) => `<div class="fg-md-col">
        <div class="fg-md-head"><span>${label}</span><span class="fg-md-hint">将魂・兵力・士气・攻防</span></div>
        ${units.slice().sort((a, b) => (b.alive - a.alive) || b.hp - a.hp).map(row).join("")}
      </div>`;
      return `<div class="fg-matchup-detail">${col(this.myUnits, "我方")}${col(this.foeUnits, "敌方")}</div>`;
    },
    // 点顶部兵力条弹出的半透明浮层：不挤占棋盘任何空间，点浮层内任意处即关闭（复用全局 openOverlay，
    // 非 modal 模式下点遮罩本就会关闭，这里再给内容区自身也补一个点击关闭，覆盖"点任何区域"的要求）
    showMatchupOverlay() {
      const myGen = this.gen;
      openOverlay(`<div class="fg-matchup-overlay">
        <div class="fg-matchup-overlay-title">⚔️ 两军阵前对比</div>
        ${this.matchupDetailInner()}
        <div class="fg-matchup-overlay-hint">点任意处关闭</div>
      </div>`);
      // 点击关闭的处理器只挂在这层浮层自己的包裹元素上（随下一次 openOverlay 替换 innerHTML
      // 一并消失），不能像旧版那样直接挂到 #overlay-content 这个全局共用容器上——那个容器
      // 不会因为内容被替换而自动摘掉自己的 onclick，会一直残留、错关后续弹窗（见 openOverlay 注）
      const wrapEl = $(".fg-matchup-overlay", $("#overlay-content"));
      if (wrapEl) wrapEl.onclick = () => closeOverlay();
      // 委托/半自动战斗时后台仍在不断出手，浮层若只画开启那一刻的快照很快就会过时——按战斗节奏
      // 定时把兵力/士气/攻防数据刷成最新，直到浮层被关闭、或切换成了别的战斗（gen 变化）为止
      const timer = setInterval(() => {
        const wrap = $(".fg-matchup-detail", $("#overlay-content"));
        if (!wrap || this.gen !== myGen || !overlay.classList.contains("show")) { clearInterval(timer); return; }
        wrap.outerHTML = this.matchupDetailInner();
      }, 500);
    },
    renderBattle() {
      const u = this.selectedUnit;
      let reachSet = new Set(), enemySet = new Set();
      if (u && this.selPhase === "move") {
        this.reachable(u).forEach(([r, c]) => reachSet.add(r + "," + c));
        reachSet.add(u.r + "," + u.c);
      }
      // 目标高亮要等玩家在环形菜单里选定行动类型后才出现，避免"默认攻击"式的隐性预设
      if (u && this.selPhase === "act" && this.actionMode) {
        const range = u.ranged ? 2 : 1;
        this.foeUnits.filter(e => e.alive && this.manhattan(u, e) <= range && (this.actionMode !== "challenge" || this.manhattan(u, e) === 1))
          .forEach(e => enemySet.add(e.r + "," + e.c));
      }
      // 火攻军令：标出当前满足条件（站在山道，或我方有精通天时者时不限地形）的敌方目标
      if (this.orderMode === "fire") {
        const master = this.armyHasFiremaster("my");
        this.foeUnits.filter(e => e.alive && (this.tiles[e.r][e.c] === "hill" || master))
          .forEach(e => enemySet.add(e.r + "," + e.c));
      }
      // 疑兵佯攻：任意存活敌方单位皆可点名
      if (this.orderMode === "feint") {
        this.foeUnits.filter(e => e.alive).forEach(e => enemySet.add(e.r + "," + e.c));
      }
      // 医疗营救：任意存活己方单位皆可点名（独立于 enemySet，目标阵营不同）
      let healSet = new Set();
      if (this.orderMode === "heal") {
        this.myUnits.filter(e => e.alive).forEach(e => healSet.add(e.r + "," + e.c));
      }
      // 军令选目标期间，把非可选目标的整片战场蒙上半透明遮罩，只留可选目标本体清晰——不必再费神辨认
      const dimSet = this.orderMode === "heal" ? healSet : (this.orderMode ? enemySet : null);
      // 行动菜单浮在该武将棋子正周围、按钮环形分布一圈；一旦选定行动类型（点了🗡️/⚔️/🤺）立即收起按钮，
      // 只留一枚不挡视线的小提示条，免得菜单本身盖住紧接着要点的目标
      let floatMenu = "";
      if (u && this.selPhase === "act") {
        const leftPct = Math.min(90, Math.max(10, (u.c + 0.5) / this.COLS * 100));
        const topPct = Math.min(86, Math.max(14, (u.r + 0.5) / this.ROWS * 100));
        if (this.actionMode) {
          const modeLabel = { attack: "单独攻击", flank: "夹击", challenge: "单挑" }[this.actionMode] || "";
          floatMenu = `<div class="fg-radial-tag" style="left:${leftPct}%;top:${topPct}%">${u.g.name}·${modeLabel}中，请点选目标</div>`;
        } else {
          const range = u.ranged ? 2 : 1;
          const inRange = this.foeUnits.filter(e => e.alive && this.manhattan(u, e) <= range);
          const hasTargets = inRange.length > 0;
          const hasChallenge = inRange.some(e => this.manhattan(u, e) === 1);
          const anyFlank = inRange.some(e => this.eligibleFlankers(u, e).length > 0);
          const sk = u.skActive ? Skill.of(u.g) : null;
          const btns = [];
          if (hasTargets) btns.push({ id: "fg-mode-atk", cls: "", title: "单独攻击", icon: "🗡️" });
          if (anyFlank) btns.push({ id: "fg-mode-flank", cls: "", title: "夹击（拉上就位的同袍一起出手）", icon: "⚔️" });
          if (hasChallenge) btns.push({ id: "fg-mode-chg", cls: "", title: "单挑", icon: "🤺" });
          if (sk) btns.push(u.skCd <= 0
            ? { id: "fg-skill-btn", cls: "", title: sk.n, icon: "🌟" }
            : { id: "", cls: "dim", tag: "span", title: `${sk.n}冷却${u.skCd}`, icon: "🌟" });
          btns.push({ id: "fg-standdown", cls: "", title: `待命${u.moved ? "" : "（+15%防）"}`, icon: "🛡️" });
          const R = 48;
          const btnsHtml = btns.map((b, i) => {
            const ang = (-90 + i * (360 / btns.length)) * Math.PI / 180;
            const dx = (Math.cos(ang) * R).toFixed(1), dy = (Math.sin(ang) * R).toFixed(1);
            const tag = b.tag || "button";
            return `<${tag} class="fg-rbtn ring ${b.cls}" ${b.id ? `id="${b.id}"` : ""} style="transform:translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))" title="${b.title}">${b.icon}</${tag}>`;
          }).join("");
          floatMenu = `<div class="fg-radial" style="left:${leftPct}%;top:${topPct}%">
            <div class="fg-radial-info">${u.g.name}　兵${Math.max(0, Math.round(u.hp))}/${u.hpMax}　气${Math.round(u.morale)}</div>
            ${btnsHtml}
            ${!hasTargets ? `<div class="fg-radial-hint">附近无目标，仅可待命</div>` : ""}
          </div>`;
        }
      }
      // 底部只留一行军令按钮，靠右排列；「军令/敌令」数已并入上方对阵情况，这里不再重复。
      // 「委托」固定摆在最左侧：一键把余下战斗全交给 AI 代打，全自动推演的委外战场（已无需再委托一次）不显示
      const showDelegate = !(this.external && this.external.auto);
      const orderToolbar = `<div class="fb-orders fg-orders-row">
        ${showDelegate ? `<button class="fb-ord delegate ${this.delegated ? "active" : ""}" id="fg-delegate" title="${this.delegated ? "点击收回指挥权，恢复亲自操控" : "点击委托 AI 代打余下战斗"}">${this.delegated ? "🎮 收回指挥" : "🤝 委托"}</button>` : ""}
        <button class="fb-ord" id="fg-drum" ${this.myOrders > 0 && !this.delegated ? "" : "disabled"}>🥁 擂鼓</button>
        <button class="fb-ord ${this.orderMode === "heal" ? "active" : ""}" id="fg-heal" ${this.myOrders > 0 && !this.delegated ? "" : "disabled"} title="选定己方一部，小幅回复兵力">🩹 医疗</button>
        <button class="fb-ord ${this.orderMode === "feint" ? "active" : ""}" id="fg-feint" ${this.myOrders > 0 && !this.delegated ? "" : "disabled"} title="选定敌方一部，防御临时-20%，持续2回合">🎭 疑兵</button>
        <button class="fb-ord ${this.orderMode === "fire" ? "active" : ""}" id="fg-fire" ${this.myOrders > 0 && !this.delegated ? "" : "disabled"} title="须山道地形，或军中有精通天时者">🔥 火攻</button>
        <button class="fb-ord ctrl" id="fg-endturn" ${this.turnSide === "my" && !this.delegated ? "" : "disabled"}>⏭ 结束回合</button>
      </div>`;
      const root = $("#fg-content");
      root.innerHTML = `
        <div class="fg-layout">
          <div class="fg-area-vsbar">${this.vsbarHtml()}</div>
          <div class="fg-area-matchup">${this.hintLineHtml()}</div>
          <div class="fg-area-log"><div class="fb-log fg-log-compact" id="fg-log">${(this.logLines || []).join("")}</div></div>
          <div class="fg-area-board">
            <div class="fg-board-wrap zoomable" id="fg-board-wrap">
              <div class="fg-zoom-layer">
                <div class="fg-board" style="grid-template-columns:repeat(${this.COLS},1fr)">${this.boardCellsHtml({ reachSet, enemySet, healSet, dimSet })}</div>
                ${floatMenu}
              </div>
              ${this.orderModeHintHtml()}
            </div>
          </div>
          <div class="fg-area-orders">${orderToolbar}</div>
        </div>`;
      const logEl = $("#fg-log", root); if (logEl) logEl.scrollTop = logEl.scrollHeight;
      // 环形菜单贴着棋子摆，靠近棋盘边缘时可能溢出可视区——量出实际溢出量后原地平移拉回来
      // 注：.fg-radial 自身是 0×0 的定位锚点，getBoundingClientRect 量不到绝对定位子元素撑出的范围，
      // 必须逐个子元素（信息条/提示/环形按钮）取并集才是菜单的真实可见边界
      const radialEl = $(".fg-radial", root);
      if (radialEl && radialEl.children.length) {
        const wrapEl = $("#fg-board-wrap", root);
        const wrapRect = wrapEl.getBoundingClientRect();
        let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
        Array.from(radialEl.children).forEach(el => {
          const r = el.getBoundingClientRect();
          minL = Math.min(minL, r.left); minT = Math.min(minT, r.top);
          maxR = Math.max(maxR, r.right); maxB = Math.max(maxB, r.bottom);
        });
        let dx = 0, dy = 0;
        if (minL < wrapRect.left) dx = wrapRect.left - minL + 4;
        else if (maxR > wrapRect.right) dx = wrapRect.right - maxR - 4;
        if (minT < wrapRect.top) dy = wrapRect.top - minT + 4;
        else if (maxB > wrapRect.bottom) dy = wrapRect.bottom - maxB - 4;
        if (dx || dy) { radialEl.style.left = (radialEl.offsetLeft + dx) + "px"; radialEl.style.top = (radialEl.offsetTop + dy) + "px"; }
      }
      $$(".fg-cell", root).forEach(cell => cell.onclick = () => this.onCellClick(+cell.dataset.r, +cell.dataset.c));
      const endBtn = $("#fg-endturn", root); if (endBtn) endBtn.onclick = () => this.endMyTurn();
      const sd = $("#fg-standdown", root); if (sd) sd.onclick = () => this.standDown();
      const ma = $("#fg-mode-atk", root); if (ma) ma.onclick = () => { this.actionMode = "attack"; this.renderBattle(); };
      const mf = $("#fg-mode-flank", root); if (mf) mf.onclick = () => { this.actionMode = "flank"; this.renderBattle(); };
      const mc = $("#fg-mode-chg", root); if (mc) mc.onclick = () => { this.actionMode = "challenge"; this.renderBattle(); };
      const skb = $("#fg-skill-btn", root); if (skb) skb.onclick = () => this.useActiveSkill(u);
      const delegateBtn = $("#fg-delegate", root); if (delegateBtn) delegateBtn.onclick = () => this.delegate();
      const drum = $("#fg-drum", root); if (drum) drum.onclick = () => this.useOrder("drum");
      const fire = $("#fg-fire", root); if (fire) fire.onclick = () => this.useOrder("fire");
      const heal = $("#fg-heal", root); if (heal) heal.onclick = () => this.useOrder("heal");
      const feint = $("#fg-feint", root); if (feint) feint.onclick = () => this.useOrder("feint");
      this.bindGridZoom($("#fg-board-wrap", root));
      const vb = $("#fg-vsbar-open", root); if (vb) vb.onclick = () => this.showMatchupOverlay();
      this.syncTopbarTitle();
      // 点击棋盘/浮动菜单以外的区域（顶部对比条、战报、空白处等）：视为放弃当前武将的行动选择
      root.onclick = e => {
        if (!this.selectedUnit || this.busy) return;
        if (e.target.closest(".fg-cell") || e.target.closest(".fg-radial")) return;
        this.selectedUnit = null; this.selPhase = null; this.renderBattle();
      };
    },
    // 棋盘双指缩放/拖动：与 MapUI.bindZoom 同一套手法（不用 setPointerCapture，理由见该函数注释），
    // 缩放层同时包住棋盘格与浮动行动菜单，使菜单跟着棋盘一起缩放平移、始终贴在武将棋子旁
    applyGridZoom(box) {
      const layer = box.querySelector(".fg-zoom-layer");
      if (layer) layer.style.transform = `translate(${GridZoom.x}px,${GridZoom.y}px) scale(${GridZoom.scale})`;
    },
    // 边界收紧到"内容边缘贴齐可视区边缘就不再多让"——去掉旧版留的一截余量，缩放/拖动到头即止，
    // 不会把地图挪出可视范围留出空白
    clampGridZoomState(box) {
      GridZoom.scale = Math.min(3, Math.max(1, GridZoom.scale));
      const rect = box.getBoundingClientRect();
      const maxX = (GridZoom.scale - 1) * rect.width / 2;
      const maxY = (GridZoom.scale - 1) * rect.height / 2;
      GridZoom.x = Math.min(maxX, Math.max(-maxX, GridZoom.x));
      GridZoom.y = Math.min(maxY, Math.max(-maxY, GridZoom.y));
    },
    bindGridZoom(box) {
      if (!box) return;
      this.applyGridZoom(box);
      const pointers = new Map();
      let dragging = false, moved = false, lastX = 0, lastY = 0, pinchDist = 0, pinchScale = 1;
      const onMove = e => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
          const pts = [...pointers.values()];
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (pinchDist > 0) { GridZoom.scale = pinchScale * dist / pinchDist; this.clampGridZoomState(box); this.applyGridZoom(box); }
          return;
        }
        if (dragging) {
          const dx = e.clientX - lastX, dy = e.clientY - lastY;
          if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
          GridZoom.x += dx; GridZoom.y += dy;
          lastX = e.clientX; lastY = e.clientY;
          this.clampGridZoomState(box);
          this.applyGridZoom(box);
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
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onUp);
        if (pointers.size === 1) {
          // 未放大时（scale=1）边界钳制已把可平移范围锁死为 0（见 clampGridZoomState），平移本就无意义——
          // 这时不进入"拖拽"追踪（dragging 保持 false），单指点击就是纯粹的点击，不会因合成事件的一丁点
          // 抖动被误判成"刚拖拽过"而把紧接着的 click 拦掉（曾导致点选目标偶发失灵）；但 move/up 监听照常
          // 挂上摘下，pointerup 仍能正常收尾，不会把这根手指残留在 pointers 表里搅乱后续的双指捏合判定
          if (GridZoom.scale > 1.001) { dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY; }
        }
        else if (pointers.size === 2) {
          dragging = false;
          const pts = [...pointers.values()];
          pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          pinchScale = GridZoom.scale;
        }
      };
      box.onwheel = e => {
        e.preventDefault();
        GridZoom.scale += e.deltaY < 0 ? 0.15 : -0.15;
        this.clampGridZoomState(box);
        this.applyGridZoom(box);
      };
      box.addEventListener("click", e => { if (box._justDragged) { e.stopPropagation(); e.preventDefault(); } }, true);
    },
    // 最新一条放最下（而非旧版顶插），阅读顺序与聊天记录一致；每次写入顺带把日志滚到底部
    log(msg) {
      this.logLines = this.logLines || [];
      this.logLines.push(`<div>${msg}</div>`);
      if (this.logLines.length > 30) this.logLines.shift();
      const el = $("#fg-log");
      if (el) { el.innerHTML = this.logLines.join(""); el.scrollTop = el.scrollHeight; }
    },
  };
  window.GridBattle = GridBattle;   // 导出到 window，便于自动化测试等外部脚本直接读取战场状态

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
        </div></div>`, { modal: true });
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
        </div></div>`, { modal: true });
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
            </div></div>`, { modal: true });
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
        <div class="btns"><button class="btn-primary" id="pred-ok">确定</button></div></div>`, { modal: true });
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
      // 友谊是唯一的入账口，故忠诚联动挂在此处：本势力同僚交情见长时顺带归心一点
      if (after > before && typeof Loyalty !== "undefined" && typeof Campaign !== "undefined") {
        const m = Campaign.mapState && Campaign.mapState();
        if (m) Loyalty.onBondGain(m, id);
      }
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
    /* 可供你差遣的班底：仕官/在野期间即「我的团队」；自立当主之后，「团队」这一概念让位于「本势力麾下」——
       麾下诸将本就听你号令，不必再单列一份名单。所有需要"带谁出战"的地方统一走此入口，
       故此后新增玩法只要调用 myRoster() 即可自动适配两种身份，不必各自判断。
       返回值按评分降序，并裁至上限（自立后麾下动辄数十人，各玩法只取得力者出战）。 */
    myRoster(limit) {
      const m = typeof Campaign !== "undefined" && Campaign.mapState && Campaign.mapState();
      let arr;
      if (m && m.playerFaction === "_player_") {
        arr = DB.list.filter(g => (m.generalFaction || {})[g.id] === "_player_" && m.appeared.includes(g.id))
          .sort((a, b) => ratingScore(Armory.geared(b, b.id)) - ratingScore(Armory.geared(a, a.id)));
      } else {
        arr = this.teamGenerals();
      }
      return limit ? arr.slice(0, limit) : arr;
    },
    // 自立之后不再有"入队/退队"的概念，招募按钮相应改口为「纳入麾下」（直接改效忠，不入队列）
    isLordMode() {
      const m = typeof Campaign !== "undefined" && Campaign.mapState && Campaign.mapState();
      return !!m && m.playerFaction === "_player_";
    },
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
      if (typeof Estate !== "undefined") Estate.onRecruit(g.id);   // 掌柜入队即自动卸任（队伍随主角云游）
      if (typeof Guard !== "undefined") Guard.onRecruit(g.id);     // 守将入队同理，自动卸任
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
        { n: "传国玉玺", intro: "得之者得天命加身，号令四方——传说品阶行动力上限+1，其余品阶暴击率略增。", effect: "critBonus", legendEffect: "apBonus" },
        { n: "随侯珠", intro: "灵蛇衔珠相报，光华养神固本。", effect: "ti" },
        { n: "和氏璧", intro: "稀世美玉，握之心神安定，气血自生。", effect: "regenBonus" },
        { n: "勾玉", intro: "沟通神灵的古老玉饰，气息绵长。", effect: "stamRegenBonus" },
        { n: "八尺琼曲玉", intro: "三神器之一，佩之神佑护体。", effect: "regenBonus" },
        { n: "南蛮令", intro: "孟获信物，持之如猛虎添翼，愈战愈勇。", effect: "guardBonus" },
        { n: "不老丹方", intro: "方士所炼丹方，强身固体。", effect: "ti" },
        { n: "定军神符", intro: "军中祈福神符，佑主将屹立不倒。", effect: "guardBonus" },
        { n: "九鼎", intro: "象征天下九州的重器，坐拥九鼎——传说品阶行动力上限+1，其余品阶护体略增。", effect: "guardBonus", legendEffect: "apBonus" },
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
        // legendEffect：部分奇珍模板（如传国玉玺/九鼎）仅在生成为传说品阶时才切换为专属效果（如行动力上限），
        // 其余品阶仍走该模板的常规 effect 按稀有度正常浮动，避免低阶版本也获得等同传说的特殊效果
        if (t.legendEffect && rarityK === "legend") {
          stat = t.legendEffect;
          bonus = 1;
        } else {
          stat = t.effect || "ti";
          bonus = t.bonusOverride ? t.bonusOverride[rIdx] : (stat === "ti" ? this.rollBonus(rarityK) : this.curioVals(stat)[rIdx]);
        }
      } else if (typeK === "book") {
        stat = t.stat || "zhi";   // 每部典籍按其性质固定加智力或政治，不再随机
        bonus = t.bonusOverride ? t.bonusOverride[rIdx] : this.rollBonus(rarityK);
      } else {
        stat = type.stat;
        bonus = t.bonusOverride ? t.bonusOverride[rIdx] : this.rollBonus(rarityK);
      }
      const item = { uid: this.data.nextUid++, type: typeK, tid: t.n, name: t.n, icon: type.icon, intro: t.intro, rarity: rarityK, stat, bonus, equippedBy: null, identified: true };
      // 行动力上限奇珍：effect 结算为 apBonus 时（传国玉玺/九鼎仅传说品阶如此）佩戴即生效，由 Campaign.recalcApMax 读取 apBonus 字段计数
      if (stat === "apBonus") item.apBonus = 1;
      if (!this.data.discovered.includes(t.n)) this.data.discovered.push(t.n);
      return item;
    },

    // 唯一奇珍：全地图各仅一件，纯粹的高稀有度专属装备，不再附带行动力上限加成（该效果已转移至常规奇珍池的「传国玉玺」「九鼎」）
    UNIQUE_TREASURES: {
      chitu: { n: "赤兔·千里神驹", type: "mount", stat: "tong", intro: "人中吕布马中赤兔，日行千里，唯此一骑——佩之统帅超群。" },
      senriGeta: { n: "千里靴", type: "attire", stat: "mei", intro: "踏遍天下路不知疲，唯此一双——佩之魅力超群。" },
    },
    // 唯一奇珍判定：全地图各仅一件，夺宝/NPC 换装时不得销毁——一律回流玩家宝物库
    isUnique(item) { return Object.values(this.UNIQUE_TREASURES).some(t => t.n === item.name); },
    // 单挑夺宝赎回价：市价一倍二（基础售价 1000/3000/6000/10000 × 1.2）——敌将挟宝勒索，自然狮子大开口
    LOOT_PRICE: { normal: 1200, fine: 3600, rare: 7200, legend: 12000 },
    // NPC 自行穿戴：比同槽现役加成高才穿（换下的旧装弃毁，唯一奇珍除外——退回玩家宝物库），
    // 不如现役则弃之不取（该物若已在库中则一并移除）；返回是否穿上
    npcAutoEquip(gid, item) {
      const cur = this.data.items.find(i => i.equippedBy === gid && i.type === item.type);
      if (cur && (cur.bonus || 0) >= (item.bonus || 0)) {
        this.data.items = this.data.items.filter(i => i.uid !== item.uid);
        this.save();
        return false;
      }
      if (cur) {
        if (this.isUnique(cur)) cur.equippedBy = null;
        else this.data.items = this.data.items.filter(i => i.uid !== cur.uid);
      }
      if (!this.data.items.some(i => i.uid === item.uid)) this.data.items.push(item);
      item.equippedBy = gid;
      this.save();
      return true;
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
    // 一键拆解：批量分解所有「已鉴定 · 未装备 · 非传说」的宝物，跳过神秘宝物（尚未鉴宝，拆解入口本就不放行）、
    // 已装备的宝物、以及传说级（大概率是主力装备或稀缺材料来源，误拆代价太高，一律排除在批量操作之外）
    dismantleAllNonLegendUnequipped() {
      const targets = this.data.items.filter(i => i.identified !== false && !i.equippedBy && i.rarity !== "legend");
      if (!targets.length) return null;
      const gained = {};
      targets.forEach(item => {
        const n = this.DISMANTLE_RETURN[item.rarity];
        this.data.materials[item.type] = (this.data.materials[item.type] || 0) + n;
        gained[item.type] = (gained[item.type] || 0) + n;
      });
      const uids = new Set(targets.map(i => i.uid));
      this.data.items = this.data.items.filter(i => !uids.has(i.uid));
      this.save();
      return { count: targets.length, gained };
    },

    /* ---- 行商贩卖：按「当前所在城市」的集市行情结算售价——
     * 行情低（≤0.9）的城市买入、行情高（≥1.2）的城市卖出，才能真正吃到差价；
     * 折算下来同城买卖必亏（0.85 系数 < 1），唯有实际跑一趟高价城才有利可图，靠"移动需耗行动力"
     * 这一既有摩擦天然限制无限套利，不必另设额度或冷却。 */
    TRADE_FACTOR: 0.85,
    tradeSellPrice(item, cityId) { return Math.round(this.shopPrice(item.rarity) * cityPriceFactor(cityId) * this.TRADE_FACTOR); },
    tradeSell(uid, cityId) {
      const idx = this.data.items.findIndex(i => i.uid === uid); if (idx < 0) return false;
      const item = this.data.items[idx];
      if (item.identified === false) { toast("需先鉴宝，才能贩卖"); return false; }
      if (item.equippedBy) { toast("请先卸下装备再贩卖"); return false; }
      const price = this.tradeSellPrice(item, cityId);
      const gold = Bond.addGold(price);
      this.data.items.splice(idx, 1);
      const tmpl = { n: item.name, intro: item.intro, stat: item.stat, effect: item.stat };
      this.data.shop.push({ type: item.type, rarity: item.rarity, tmpl });
      this.save();
      toast(`已将「${item.name}」卖给本地行商，得 ${gold} 金（按本城行情结算，宝物已回流集市）`);
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
      // 自建时若指定了「将魂来源」，习得该武将库武将的将魂技能（覆盖按自身六维自动归派的默认行为）
      if (c.skillGeneralId != null) {
        const src = DB.get(c.skillGeneralId);
        if (src) g.skillOverride = Skill.of(src);
      }
      const gg = Armory.geared(g, "hero");
      // 医馆驻城加成：单挑体力（气血）回复，与奇珍「气血回复」叠加；gg 必是本次调用新建的对象（g 未被共享），可直接改写
      const m = typeof Campaign !== "undefined" && Campaign.mapState();
      const hp = m && typeof Buildings !== "undefined" ? Buildings.hpRegenBonus(m) : 0;
      if (hp) gg.regenBonus = (gg.regenBonus || 0) + hp;
      return gg;
    },
    // 随机生成基线六维(最大不超过60) + 一笔由玩家自行分配的加点(最多30)
    rollStats() {
      const base = {};
      DIMS.forEach(([k]) => base[k] = randInt(30, 60));
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
          <div class="rf-row"><label>将魂</label>
            <button class="cup-go" id="rpg-skill-pick" style="flex:1">${this._skillGenId != null ? `⭐ 习得「${(DB.get(this._skillGenId) || {}).name}」的将魂` : "选择武将库中一将，习得其将魂（可不选）"}</button></div>
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
        $("#rpg-skill-pick").onclick = () => { this._name = $("#rpg-name").value; openSkillGenPicker(this._skillGenId, id => { this._skillGenId = id; this.renderCreate("custom"); }); };
        $("#rpg-create-go").onclick = () => {
          const name = ($("#rpg-name").value || "").trim() || "无名客";
          this.create(name, $("#rpg-side").value, this._roll.base, this._roll.points, undefined, this._skillGenId);
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
    create(name, side, base, points, title, skillGeneralId) {
      const alloc = {}; DIMS.forEach(([k]) => alloc[k] = 0);
      this.char = { name, side, title: title || "", base: clone(base), alloc, level: 1, exp: 0, points: points || 0, wins: 0, losses: 0, growthMul: 1, talents: [], skillGeneralId: skillGeneralId != null ? skillGeneralId : null };
      this._roll = null; this._name = ""; this._skillGenId = null;
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
            </div>
            <div class="rpg-dims">${dims}</div>
          </div>
        </div>
        <div class="bond-team">
          ${Bond.isLordMode()
            // 自立当主之后，「我的团队」这一概念让位于「本势力麾下」——麾下诸将本就听你号令，不必再单列名册
            ? (() => {
                const mm = Campaign.mapState();
                const roster = Bond.myRoster();
                return `<div class="bt-head">💰 金币 <b>${Bond.gold()}</b> ｜ 🚩 麾下诸将 ${roster.length}<small>（自立当主后不再有「团队」之分，本势力武将皆可差遣：2v2 副将、组队/国战/阵营大战与出征一律从麾下点选）</small></div>
          <div class="bt-list">${roster.slice(0, 40).map(t => `<span class="bt-chip" data-id="${t.id}">${t.name}<i style="opacity:.7;font-style:normal">·${Loyalty.get(mm, t.id)}</i></span>`).join("") || '<span class="bt-empty">麾下暂无人手——去招揽豪杰吧</span>'}${roster.length > 40 ? `<span class="bt-empty">…等 ${roster.length} 人</span>` : ""}</div>`;
              })()
            : `<div class="bt-head">💰 金币 <b>${Bond.gold()}</b> ｜ 👥 我的团队 ${Bond.data.team.length}/${Bond.teamLimit()}<small>（挚友可招募；队友任 2v2 副将，同阵营队友在组队/国战/阵营大战必上阵；队友不可随意请出，满员时招募新武将可选择替换）</small></div>
          <div class="bt-list">${Bond.teamGenerals().map(t => `<span class="bt-chip" data-id="${t.id}">${t.name}</span>`).join("") || '<span class="bt-empty">尚无队友——先去结交武将吧</span>'}</div>`}
        </div>
        <div class="bond-team">
          <div class="bt-head">🎒 我的装备<small>（点击槽位可装备/更换宝物库中的宝物）</small></div>
          <div class="eq-slots">${eqSlotsHtml("hero")}</div>
          <button class="cup-go" id="rpg-armory" style="margin-top:8px;width:100%">🏪 宝物库（仓库 · 商店 · 锻造）</button>
        </div>
        <div class="section-hint">历练、悬赏、擂台/道场等设施挑战请在「天下游历」地图中进行（均计入经验与名声）；只想爽玩各模式可去首页「小游戏」。</div>
      </div>`;
      // 蜘蛛图外框高度与右侧（评分+加点+六维）总高度对齐；图形本身按宽度等比居中，不被拉伸变形——
      // 此前只在这一刻测量一次高度就写死，浏览器/iPad 上常见的窗口缩放、分屏宽度变化、地址栏
      // 收起展开、字体异步加载完成后的重排，都会在此后继续改变 .rpg-side 的实际高度，蜘蛛图的
      // 高度却停留在渲染瞬间的旧值不再跟着变，宽高比就对不上、看起来忽大忽小；改用 ResizeObserver
      // 持续跟随右侧高度的任何变化（不管是什么原因引起的），而不是只赌渲染那一刻的布局已经稳定
      const sideEl = C.querySelector(".rpg-side"), radarEl = C.querySelector(".rpg-radar");
      if (this._radarRO) { this._radarRO.disconnect(); this._radarRO = null; }
      if (sideEl && radarEl) {
        const sync = () => {
          const h = Math.round(sideEl.getBoundingClientRect().height);
          if (h > 0) radarEl.style.height = h + "px";
        };
        sync();
        this._radarRO = new ResizeObserver(sync);
        this._radarRO.observe(sideEl);
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
      if (m && Campaign.fameTierIndex(Campaign.effFame(m)) < this.TRAIN_FAME_TIER) {
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
      // 书院研习：所在城建有书院（且城属己方）时，本场单挑经验按书院等级 +10%/20%/30%
      const mPre = Campaign.mapState();
      const acadMult = mPre ? Buildings.expMult(mPre) : 1;
      if (acadMult > 1) gain = Math.round(gain * acadMult);
      c.exp += gain;
      let lvUp = 0;
      while (c.exp >= this.expNeed(c.level)) { c.exp -= this.expNeed(c.level); c.level++; c.points += 1; lvUp++; }
      this.save();
      // 悬赏「讨伐令」判定：命中目标即完成，未命中或落败则该次出征作废（悬赏仍保留在榜上可再次接取）
      let extraHtml = acadMult > 1 ? `<br>📚 书院研习，经验加成 +${Math.round((acadMult - 1) * 100)}%` : "";
      const m = Campaign.mapState();
      // 宿敌结缘：主角首次败于任意一位敌方阵营武将，即与其结下宿敌之约（若尚无宿敌）
      if (m && !heroWon) Nemesis.onHeroLoss(m, opp);
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
      // 天下擂台/双人比武等设施挑战：胜利额外记一笔名声（duo 也经此结算通道）；本城演武场按等级加码
      if (m && (m.activeFacility === "duel" || m.activeFacility === "duo")) {
        // 六期：设施挑战获胜不再计入城市繁荣度——与悬赏同理，是战斗成就，不是市政建设
        if (heroWon) { const fb = 8 + Buildings.drillBonus(m); Campaign.addFame(fb); extraHtml += `<br>🏯 设施挑战获胜，名声 <b style="color:var(--cn-red)">+${fb}</b>`; }
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
      // 产业劫掠应战：胜则威慑之下追回双倍进账，败则只保住一半；矿山材料不为强人所图，无论胜负均送回宝物库
      if (m && m.activeEstateRaid) {
        const r = m.activeEstateRaid;
        m.activeEstateRaid = null;
        const got = Bond.addGold(heroWon ? r.gold * 2 : Math.round(r.gold * 0.5), "产业进账");
        if (heroWon) Campaign.addFame(5);
        let raidMatTxt = "";
        if (r.mats) { const mt = Estate.deliverMats(r.cityId, r.mats); raidMatTxt = `，${mt.n}材料 +${r.mats}`; }
        extraHtml += heroWon
          ? `<br>🗡️ 击退强人！追回双倍进账 <b style="color:#b8860b">+${got}</b> 金${raidMatTxt}，名声 <b style="color:var(--cn-red)">+5</b>`
          : `<br>🗡️ 不敌强人，进账被夺大半，只保住 <b style="color:#b8860b">${got}</b> 金${raidMatTxt}`;
        Campaign.save();
      }
      // 劫牢营救被俘守将：胜则救出（名声+10、情谊更深），败则其仍陷囹圄、他日可再来
      if (m && m.activeRescue) {
        const r = m.activeRescue;
        m.activeRescue = null;
        if (heroWon) {
          const g = DB.get(r.gid);
          Guard.free(m, r.gid, "");
          Campaign.addFame(10);
          const addF = g ? Bond.addF(g.id, 20) : 0;
          Bond.save();
          extraHtml += `<br>🔓 劫牢成功，救出 ${g ? g.name : "守将"}！名声 <b style="color:var(--cn-red)">+10</b>${addF > 0 ? `，友谊 +${addF}` : ""}`;
        } else {
          extraHtml += `<br>⛓️ 营救失手，只得暂退——他日再来劫牢`;
        }
        Campaign.save();
      }
      // 宿敌单挑结算：胜则记一场战绩，累计三胜触发「恩怨了结」终局（传说奇珍+大量名声）；败则宿敌又添一分优势
      if (m && m.activeNemesis) {
        m.activeNemesis = null;
        const st = m.nemesis;
        if (st) {
          if (heroWon) {
            st.wins++;
            const goldGain2 = Bond.addGold(80 + st.wins * 20);
            Campaign.addFame(20);
            if (st.wins >= Nemesis.FINALE_WINS && !st.finaleDone) {
              st.finaleDone = true;
              const item = Armory.guaranteedItem("legend");
              Campaign.addFame(80);
              extraHtml += `<br>🏆 恩怨了结！你与【${DB.get(st.id).name}】的宿怨终告一段落，名声 <b style="color:var(--cn-red)">+100</b>，${Bond.goldLine(goldGain2)}<br>🎁 获得传说奇珍「${item.name}」（宝物库鉴宝后可用）！`;
            } else {
              extraHtml += `<br>⚔️ 力克宿敌【${DB.get(st.id).name}】！（${st.wins}/${Nemesis.FINALE_WINS}）名声 <b style="color:var(--cn-red)">+20</b>${Bond.goldLine(goldGain2)}`;
            }
          } else {
            st.nemesisWins++;
            extraHtml += `<br>⚔️ 不敌宿敌【${DB.get(st.id).name}】，此仇未报，他日再战！`;
          }
          Campaign.save();
        }
      }
      // 历战成长：与主角交手的真实武将（无论敌我阵营）胜负各有小概率百尺竿头更进一步
      if (m && opp && opp.id >= 0) extraHtml += Growth.battle(m, opp, !heroWon);
      // 威名榜：击败八大高手记录战绩，凑齐后与武道会夺冠一并达成"天下无双"终局
      if (heroWon) extraHtml += checkRivalDefeat(opp);
      // 单挑夺宝：敌我单挑（对手为真实敌方武将）的胜方有机会夺取败方随身穿戴的一件宝物——
      // 主角获胜直接收入宝物库；主角落败被夺时立刻弹赎回选择（唯一奇珍不入夺宝池，永不遗失）
      const hostileDuel = m && opp && opp.id >= 0 && opp.side !== c.side;
      let ransomItem = null;
      if (hostileDuel && heroWon && Math.random() < 0.35) {
        const spoils = Armory.itemsOf(opp.id);
        if (spoils.length) {
          const it = spoils[randInt(0, spoils.length - 1)];
          it.equippedBy = null; Armory.save();
          extraHtml += `<br>🎒 夺得 ${opp.name} 随身的 ${it.icon}「${it.name}」（${Armory.rarityDef(it.rarity).n}），已收入宝物库！`;
        }
      }
      if (hostileDuel && !heroWon && Math.random() < 0.35) {
        const pool = Armory.itemsOf("hero").filter(i => !Armory.isUnique(i));
        if (pool.length) ransomItem = pool[randInt(0, pool.length - 1)];
      }
      const bg = c.side === 'cn' ? 'linear-gradient(135deg,var(--cn-red),#7a1420)' : 'linear-gradient(135deg,var(--jp-indigo),#141e3c)';
      const showResult = () => {
        openOverlay(`<div class="result-card">
          <h1>${heroWon ? '历练胜利' : '虽败犹荣'}</h1>
          <div class="winner-av" style="background:${bg}">${avatarChar(c.name)}</div>
          <div class="wname">${c.name}</div>
          <div class="wdesc">${heroWon ? '击败' : '不敌'} ${opp.name}（武将评分 ${oppSum} / 你 ${heroSum}）${tag}<br>获得经验 <b style="color:var(--cn-red)">+${gain}</b>${Bond.goldLine(goldGain)}${Armory.dropLine(drops)}
            ${lvUp ? `<br>🎉 升级 ${lvUp} 级！获得加点 <b style="color:var(--cn-red)">+${lvUp * 1}</b>` : ''}${extraHtml}</div>
          <div class="btns">
            <button class="btn-primary" id="rpg-again">再历练</button>
            <button class="btn-ghost" id="rpg-hub">返回养成</button>
          </div></div>`, { modal: true });
        $("#rpg-again").onclick = () => { closeOverlay(); this.train(); };
        $("#rpg-hub").onclick = () => { closeOverlay(); goHome(); };
      };
      if (ransomItem) {
        const price = Armory.LOOT_PRICE[ransomItem.rarity] || 500;
        const canPay = Bond.gold() >= price;
        openOverlay(`<div class="result-card">
          <h1>🎒 宝物被夺！</h1>
          <div class="wdesc">${opp.name} 顺手夺走了你随身的 ${ransomItem.icon}「${ransomItem.name}」（${Armory.rarityDef(ransomItem.rarity).n}）！<br>是否当场以 <b style="color:#b8860b">${price}</b> 金赎回？（现有 <b style="color:#b8860b">${Bond.gold()}</b> 金${canPay ? "" : "，不足以赎回"}）</div>
          <div class="btns">
            <button class="btn-primary" id="loot-buy" ${canPay ? "" : "disabled"}>💰 赎回（${price} 金）</button>
            <button class="btn-ghost" id="loot-no">忍痛舍弃</button>
          </div></div>`, { modal: true });
        $("#loot-buy").onclick = () => {
          if (!Bond.spend(price)) return;
          extraHtml += `<br>🎒 ${opp.name} 一度夺走你的「${ransomItem.name}」，你当场以 ${price} 金赎回（现有 ${Bond.gold()} 金）`;
          closeOverlay(); showResult();
        };
        $("#loot-no").onclick = () => {
          const wore = Armory.npcAutoEquip(opp.id, ransomItem);
          Campaign.recalcApMax(); Campaign.save();   // 被夺之物可能是行动力奇珍，即时重算上限
          extraHtml += wore
            ? `<br>🎒 「${ransomItem.name}」被 ${opp.name} 夺去随身佩戴，他日战而胜之可再夺回`
            : `<br>🎒 「${ransomItem.name}」被 ${opp.name} 夺去，嫌不如其现役装备随手丢弃，就此遗失`;
          closeOverlay(); showResult();
        };
        return;
      }
      showResult();
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
      if (mChk && Campaign.fameTierIndex(Campaign.effFame(mChk)) < this.CUP_FAME_TIER) { toast(`声望不足，需达到「${Campaign.FAME_TIERS[this.CUP_FAME_TIER].n}」名声阶梯才能报名天下第一武道会`); return; }
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
      if (m && m.activeFacility === "gauntlet" && allCleared) { const fb = 10 + Buildings.drillBonus(m); Campaign.addFame(fb); bountyHtml += `<br>🏯 设施挑战全清，名声 <b style="color:var(--cn-red)">+${fb}</b>`; }
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
      const mates = Bond.myRoster(12);
      if (!mates.length) { if (!apSpent && !spendAP()) return; startDuoBattle(hero, clone(pool[2]), m2, d2, true); return; }
      openOverlay(`<div class="result-card">
        <h1>选择副将</h1>
        <div class="wdesc">从${Bond.isLordMode() ? "麾下诸将" : "团队"}中挑一名副将与你并肩（其六维15%并入你，并可驰援一次）：</div>
        <div class="buff-list">
          ${mates.map(t => `<button class="buff-btn" data-id="${t.id}"><span class="bi">👥</span><span class="bt"><b>${t.name}</b><small>评分 ${ratingScore(t)} · 友谊 ${Bond.pts(t.id)}</small></span></button>`).join("")}
          <button class="buff-btn" data-id="rand"><span class="bi">🎲</span><span class="bt"><b>随机路人副将</b><small>不使用团队</small></span></button>
        </div>
        <div class="btns"><button class="btn-ghost" id="duo-cancel">取消</button></div></div>`, { modal: true });
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
        const facilityBonus = (m && m.activeFacility === "war") ? 15 + Buildings.drillBonus(m) : 0;
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
      const mates = Bond.myRoster().filter(g => g.side === hero.side).slice(0, 9).map(clone);
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
        const facilityBonus = (m && m.activeFacility === "teamBattle") ? 15 + Buildings.drillBonus(m) : 0;
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
      const mates = Bond.myRoster().filter(g => g.side === hero.side);
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
        const facilityBonus = (m && m.activeFacility === "conquest") ? 25 + Buildings.drillBonus(m) : 0;
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
          </div></div>`, { modal: true });
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
      // 名声：按名次浮动；首次夺冠计入"天下无双"终局条件（不再额外贡献行动力上限）
      const isChamp = placement.label === "夺冠";
      const fameGain = isChamp ? 60 : /半决赛|决赛|四强/.test(placement.label) ? 30 : 12;
      Campaign.addFame(fameGain);
      let champHtml = "";
      const m = Campaign.mapState();
      // 世界杯冠亚军亦是"重要战斗"，积一次庆功宴次数（"决赛止步"即负于决赛对手、屈居亚军）
      if (m && m.playerFaction === "_player_" && (isChamp || placement.label === "决赛止步")) {
        Rewards.grantFeastCharge(m, 1, isChamp ? "勇夺世界杯冠军" : "屈居世界杯亚军");
      }
      if (isChamp && m && !m.cupWon) {
        m.cupWon = true; Campaign.save();
        champHtml = `<br>🏆 天下第一武道会首冠！`;
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
          </div></div>`, { modal: true });
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
    { id: "chengdu", n: "成都", side: "cn", x: 10.24, y: 50.38 },
    { id: "hanzhong", n: "汉中", side: "cn", x: 16.99, y: 39.44 },
    { id: "chang_an", n: "长安", side: "cn", x: 21.39, y: 33.97 },
    { id: "luoyang", n: "洛阳", side: "cn", x: 29.37, y: 32.23 },
    { id: "xuchang", n: "许昌", side: "cn", x: 32.56, y: 35.11 },
    { id: "ye", n: "邺城", side: "cn", x: 34.31, y: 24.57 },
    { id: "xuzhou", n: "徐州", side: "cn", x: 39.73, y: 34.28 },
    { id: "jingzhou", n: "荆州", side: "cn", x: 28.66, y: 44.3 },
    { id: "chaisang", n: "柴桑", side: "cn", x: 37.67, y: 54.8 },
    { id: "jianye", n: "建业", side: "cn", x: 43.84, y: 44.04 },
    { id: "tianshui", n: "天水", side: "cn", x: 14.02, y: 32.55 },
    { id: "baidicheng", n: "白帝城", side: "cn", x: 22.71, y: 48.69 },
    { id: "shangyong", n: "上庸", side: "cn", x: 24.24, y: 43.54 },
    { id: "jiangling", n: "江陵", side: "cn", x: 28.89, y: 51.84 },
    { id: "wancheng", n: "宛城", side: "cn", x: 29.55, y: 39.72 },
    { id: "runan", n: "汝南", side: "cn", x: 33.74, y: 39.71 },
    { id: "xiapi", n: "下邳", side: "cn", x: 42.55, y: 33.74 },
    { id: "shouchun", n: "寿春", side: "cn", x: 39.24, y: 41.17 },
    { id: "hefei", n: "合肥", side: "cn", x: 40.26, y: 45.63 },
    { id: "wuchang", n: "武昌", side: "cn", x: 34.72, y: 51.61 },
    { id: "tsushima", n: "对马岛", side: "sea", x: 67.76, y: 34.28 },
    { id: "satsuma", n: "萨摩", side: "jp", x: 70.66, y: 46.14 },
    { id: "aki", n: "安艺", side: "jp", x: 74.5, y: 33.48 },
    { id: "kyoto", n: "京都", side: "jp", x: 81.19, y: 30.59 },
    { id: "osaka", n: "大坂", side: "jp", x: 79.86, y: 32.05 },
    { id: "owari", n: "尾张", side: "jp", x: 85.71, y: 29.82 },
    { id: "kai", n: "甲斐", side: "jp", x: 89.11, y: 26.75 },
    { id: "sunpu", n: "骏府", side: "jp", x: 89.64, y: 31.22 },
    { id: "odawara", n: "小田原", side: "jp", x: 92.2, y: 29.45 },
    { id: "echigo", n: "越后", side: "jp", x: 89.99, y: 17.33 },
    { id: "oushu", n: "奥州", side: "jp", x: 94.16, y: 15.73 },
    { id: "higo", n: "肥后", side: "jp", x: 70.62, y: 40.71 },
    { id: "bungo", n: "丰后", side: "jp", x: 73.5, y: 38.66 },
    { id: "izumo", n: "出云", side: "jp", x: 74.7, y: 28.89 },
    { id: "bizen", n: "备前", side: "jp", x: 77.22, y: 32.19 },
    { id: "omi", n: "近江", side: "jp", x: 84.49, y: 30.64 },
    { id: "echizen", n: "越前", side: "jp", x: 82.67, y: 25.07 },
    { id: "kaga", n: "加贺", side: "jp", x: 85.43, y: 23.53 },
    { id: "mino", n: "美浓", side: "jp", x: 83.16, y: 29.46 },
    { id: "mikawa", n: "三河", side: "jp", x: 87.71, y: 31.25 },
    { id: "hitachi", n: "常陆", side: "jp", x: 93.21, y: 24.53 },
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
    ["jianye", "tsushima"], ["xuzhou", "tsushima"], ["tsushima", "satsuma"], ["tsushima", "higo"],
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
  // 武将大会：每月 15 日举行
  function isTournamentDay(day) { const d = calYMD(day); return d.dom === 15; }
  // 每月初一：集市行情有较大概率大幅变动的判定日（见 rollMarketTrends）
  function isMonthStart(day) { const d = calYMD(day); return d.dom === 1; }

  /* ============================================================
   *  势力（军事三期）：中日两国之下各自再分十家势力，40 座非海路城池尽数分属其中——
   *  国（side）永不改变（图鉴归类、小游戏、跨海规则、终局判定悉数照旧），势力（faction）
   *  才是真正"可征伐、可覆灭、可改换门庭"的那一层：城池归属、边境/内战、武将出仕，都挂在势力上。
   *  对马岛比较特殊——它不属于任何真实势力，只在 tsushima_cn/tsushima_jp 两个"番所"占位势力间来回易手，
   *  借此让它继续沿用与其余城池完全相同的势力数据结构，无需额外特判。
   * ============================================================ */
  // 势力配色：第四十五轮曾按「色温分国别」（中原一律暖色、战国一律冷色）配色，结果适得其反——
  // 中原地图本身就叠了一层暗红色地形底色（.map-land.cn），战国叠的是暗蓝色（.map-land.jp），
  // 十家中原势力全是红/橙/褐/品红，恰好与红色底色同色系、彼此也互相混淆到分不清；日本十家同理陷进蓝色里。
  // 现改为反其道而行之：中原十家专挑红色底色不覆盖的色相（蓝/绿/青/紫/黄，避开 340°~20° 的红区），
  // 战国十家专挑蓝色底色不覆盖的色相（红/橙/黄/绿/紫，避开 200°~260° 的蓝区）——用"与自家地形色相冲"
  // 而非"与国别色相合"的方式配色，才能真正跳出底色。国别辨识改由城池徽章左缘 2px 竖条（CSS .map-city::before）
  // 与城池所处的陆地板块（左中原/右战国，物理位置天然不会认错）承担，不再指望城池本身的填色去兼顾"报国别"。
  const FACTIONS = [
    { id: "shuhan", n: "蜀汉", side: "cn", lord: "刘备", color: "#b17d2f", cities: ["chengdu", "baidicheng"] },
    { id: "zhanglu", n: "张鲁", side: "cn", lord: "张鲁", color: "#a0b12f", cities: ["hanzhong", "shangyong"] },
    { id: "xiliang", n: "西凉", side: "cn", lord: "董卓", color: "#5bb12f", cities: ["chang_an", "tianshui"] },
    { id: "caowei", n: "曹魏", side: "cn", lord: "曹操", color: "#2fb149", cities: ["xuchang", "wancheng", "hefei"] },
    { id: "jin", n: "司马", side: "cn", lord: "司马懿", color: "#2fb18f", cities: ["luoyang"] },
    { id: "yuanshao", n: "袁绍", side: "cn", lord: "袁绍", color: "#2f8fb1", cities: ["ye"] },
    { id: "yuanshu", n: "袁术", side: "cn", lord: "袁术", color: "#2f49b1", cities: ["shouchun", "runan"] },
    { id: "lvbu", n: "吕布", side: "cn", lord: "吕布", color: "#5b2fb1", cities: ["xuzhou", "xiapi"] },
    { id: "jingzhou_f", n: "荆州", side: "cn", lord: "刘表", color: "#a02fb1", cities: ["jingzhou", "jiangling"] },
    { id: "dongwu", n: "东吴", side: "cn", lord: "孙权", color: "#b12f7d", cities: ["chaisang", "jianye", "wuchang"] },
    { id: "oda", n: "织田", side: "jp", lord: "织田信长", color: "#7b2fb1", cities: ["owari", "mino"] },
    { id: "kyoto_f", n: "京都", side: "jp", lord: "足利义昭", color: "#b12fa6", cities: ["kyoto", "omi", "echizen"] },
    { id: "toyotomi", n: "丰臣", side: "jp", lord: "丰臣秀吉", color: "#b12f65", cities: ["osaka", "bizen"] },
    { id: "takeda", n: "武田", side: "jp", lord: "武田信玄", color: "#b13a2f", cities: ["kai"] },
    { id: "tokugawa", n: "德川", side: "jp", lord: "德川家康", color: "#b17b2f", cities: ["sunpu", "mikawa"] },
    { id: "hojo", n: "北条", side: "jp", lord: "北条氏康", color: "#a6b12f", cities: ["odawara", "hitachi"] },
    { id: "uesugi", n: "上杉", side: "jp", lord: "上杉谦信", color: "#65b12f", cities: ["echigo", "kaga"] },
    { id: "date", n: "伊达", side: "jp", lord: "伊达政宗", color: "#2fb13a", cities: ["oushu"] },
    { id: "mori", n: "毛利", side: "jp", lord: "毛利元就", color: "#2fb17b", cities: ["aki", "izumo"] },
    { id: "shimazu", n: "岛津", side: "jp", lord: "岛津义弘", color: "#2fa6b1", cities: ["satsuma", "higo", "bungo"] },
    // 对马番所：仅为让海路中转站复用与陆地城池完全相同的归属机制而设的技术性占位，非真实势力，
    // 不参与势力一览/日常行动/威名军令等一切势力玩法（统一由 isRealFaction 过滤）
    { id: "tsushima_jp", n: "对马番所", side: "jp", lord: "—", color: "#7a7a7a", cities: ["tsushima"] },
    { id: "tsushima_cn", n: "对马番所", side: "cn", lord: "—", color: "#7a7a7a", cities: [] },
  ];
  const DUMMY_FACTIONS = ["tsushima_jp", "tsushima_cn"];
  const CITY_FACTION_INIT = {};
  FACTIONS.forEach(f => f.cities.forEach(cid => { CITY_FACTION_INIT[cid] = f.id; }));
  // "_player_"：玩家自立门户后另建的势力，非静态数据表条目——其名称/国别存在战役存档 m.playerOwnFaction 里，
  // 借由 Campaign 这一全局单例在无需改动 factionDef 调用签名的前提下取到当前存档，其余 19+2 家仍查静态表
  function factionDef(fid) {
    if (fid === "_player_") {
      const m = typeof Campaign !== "undefined" && Campaign.mapState();
      const own = m && m.playerOwnFaction;
      return { id: "_player_", n: (own && own.n) || "自立势力", side: (own && own.side) || (RPG.char ? RPG.char.side : "cn"), lord: (own && own.lord) || (RPG.char ? RPG.char.name : "?"), color: "#e8c25a", cities: [] };
    }
    return FACTIONS.find(f => f.id === fid);
  }
  // 真实势力：排除对马番所两个技术性占位；玩家自立势力算真实势力
  function isRealFaction(fid) { return !!fid && !DUMMY_FACTIONS.includes(fid); }
  // 参与势力玩法的全部势力 id（含玩家自立势力，若已建立）
  function liveFactionIds(m) {
    const ids = FACTIONS.filter(f => !DUMMY_FACTIONS.includes(f.id)).map(f => f.id);
    if (m && m.playerFaction === "_player_") ids.push("_player_");
    return ids;
  }
  function factionColor(fid) { const f = factionDef(fid); return (f && f.color) || "#7a7a7a"; }
  function factionName(fid) { const f = factionDef(fid); return (f && f.n) || "在野"; }
  // 主公沿用「按姓名匹配」而非固定 id——与威名榜八大高手同一先例，兼容玩家在武将图鉴中改名/重建默认库的场景。
  // 结果按 fid 缓存，DB 变动时由 DB 侧统一清空（见 clearLordCache 调用点）
  const _lordCache = {};
  function factionLord(fid) {
    if (fid in _lordCache) return _lordCache[fid];
    const f = factionDef(fid);
    let g = null;
    if (f && f.lord && f.lord !== "—") g = DB.list.find(x => x.name === f.lord) || null;
    if (fid === "_player_") g = null;   // 玩家自立后主公即玩家本人，不对应任何武将卡
    _lordCache[fid] = g;
    return g;
  }
  function clearLordCache() { Object.keys(_lordCache).forEach(k => delete _lordCache[k]); }
  // 主公姓名（玩家自立势力返回玩家名）
  function factionLordName(fid) {
    const f = factionDef(fid);
    return (f && f.lord) || "—";
  }
  function isFactionLord(fid, gid) { const g = factionLord(fid); return !!g && g.id === gid; }
  // 势力色点 + 名称的统一小徽标，城池面板/武将详情/各类表格通用
  function facChip(fid) {
    if (!fid) return `<span class="fac-chip"><i style="background:#6b6b6b"></i>在野</span>`;
    return `<span class="fac-chip"><i style="background:${factionColor(fid)}"></i>${factionName(fid)}</span>`;
  }
  // 忠诚五档配色：赤诚/忠心/平常/离心/异心——比裸数字直观，且一眼看出谁挖得动。
  // 刻意不用绿色系：忠诚展示大多落在武将详情弹窗（.bond-box，米黄色羊皮纸底），
  // 高亮度的绿在这种暖色浅底上对比度极差、几乎读不出来；改用与全站既有 --cn-gold/--cn-red 呼应的
  // 暖色渐变（金→棕→橙→红），在浅色纸面与全部武将表的深色表格两种场景下都保持可辨识
  const LOYALTY_TIERS = [
    { min: 80, n: "赤诚", c: "#b8860b" }, { min: 60, n: "忠心", c: "#8a6d23" },
    { min: 40, n: "平常", c: "#7a6a52" }, { min: 20, n: "离心", c: "#b5651d" },
    { min: -1, n: "异心", c: "#c1272d" },
  ];
  function loyaltyTier(v) { return LOYALTY_TIERS.find(t => v >= t.min) || LOYALTY_TIERS[LOYALTY_TIERS.length - 1]; }
  function loyaltyHtml(v) { const t = loyaltyTier(v); return `<b style="color:${t.c}">${v}</b> <small style="color:${t.c}">${t.n}</small>`; }
  // 主公即势力本身，无所谓"忠诚"可言——统一显示为"──"而非误导性的满分 100
  function loyaltyCell(m, fid, gid) {
    if (fid && isFactionLord(fid, gid)) return `<b style="color:var(--cn-gold)">──</b> <small style="color:var(--cn-gold)">主公</small>`;
    return loyaltyHtml(Loyalty.get(m, gid));
  }
  // 城池当前归属的势力 id（可随内战/边境战易主）；未记录时按开局初始势力兜底
  function cityFactionId(m, cityId) {
    if (m.cityFaction && m.cityFaction[cityId]) return m.cityFaction[cityId];
    return CITY_FACTION_INIT[cityId];
  }
  // 沿用既有函数名与语义（返回 "cn"/"jp"）：城池归属独立于武将分布用的静态 c.side，
  // 内部现在多转一道势力查询，21 处既有调用点几乎不用改
  function cityOwnerSide(m, cityId) { const f = factionDef(cityFactionId(m, cityId)); return f ? f.side : cityDef(cityId).side; }
  function isMyCity(m, cityId) { return cityFactionId(m, cityId) === m.playerFaction; }
  // 城池归属（可随内战/边境战易主，独立于武将分布用的静态 c.side）：对马岛海路中转站初始划归战国一方，
  // 其余城池按 FACTIONS 表初始势力起始归属；供 ensureMap 兼容旧存档（老档只有按国别记的 m.cityOwner）时反推
  function initCityFaction() {
    return Object.assign({}, CITY_FACTION_INIT);
  }
  // 边境/内战：owner 势力不同的两座相邻城池之间的道路——既包含中日两国间唯一通道（经对马岛），
  // 也自然涵盖同一国内、势力互异的"内战"边境；一旦某城易主，其相邻城池随之成为新前线，前线因而逐月推移
  function borderEdges(m) {
    return ROADS.filter(([a, b]) => cityFactionId(m, a) !== cityFactionId(m, b));
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
  /* ============================================================
   *  城市产业（城市经营一期）：每城一处可置办产业，收益按天懒结算、须本人到城收取；
   *  友谊满上限的武将可委任为掌柜提升收益；城池被敌方攻占则产业查封（停产且不可收取/变卖），
   *  己方夺回后自动恢复。数据全存战役层（m.estate），新开局重置。
   * ============================================================ */
  const ESTATE_TYPES = {
    tavern: { n: "酒馆", icon: "🍶", cost: 1200, rate: 35, desc: "迎来送往，日进斗金而安稳", lvN: ["酒馆", "酒楼", "天下名楼"] },
    ranch: { n: "马场", icon: "🐎", cost: 1600, rate: 48, desc: "牧养良驹，收益丰厚", lvN: ["马场", "名驹牧场", "天下第一厩"] },
    mine: { n: "矿山", icon: "⛏️", cost: 800, rate: 18, desc: "凿石采矿，金币收益微薄，但每满 5 天额外积攒 1 份本城铁匠铺专精材料", lvN: ["矿山", "深矿", "天下宝矿"] },
    farm: { n: "农庄", icon: "🌾", cost: 800, rate: 25, desc: "春种秋收，细水长流", lvN: ["农庄", "庄园", "天下粮仓"] },
    caravan: { n: "商队", icon: "🚢", cost: 2000, rate: 60, desc: "行商四方，收益最高，但收取时随行情浮动（六成～一倍四）", lvN: ["商队", "商行", "天下商盟"] },
  };
  // 各城产业类型（风味设定：西凉/甲斐产马、汉中/石见有矿、天府/浓尾产粮、丝路/堺港通商……）
  const CITY_ESTATE = {
    luoyang: "tavern", jianye: "tavern", xuchang: "tavern", jingzhou: "tavern",
    tianshui: "ranch", ye: "ranch", wancheng: "ranch", xiapi: "ranch",
    hanzhong: "mine", baidicheng: "mine", shangyong: "mine", hefei: "mine",
    chengdu: "farm", runan: "farm", jiangling: "farm", shouchun: "farm",
    chang_an: "caravan", xuzhou: "caravan", chaisang: "caravan", wuchang: "caravan",
    kyoto: "tavern", omi: "tavern", sunpu: "tavern", bizen: "tavern",
    kai: "ranch", echigo: "ranch", oushu: "ranch", mino: "ranch",
    izumo: "mine", satsuma: "mine", kaga: "mine", echizen: "mine",
    owari: "farm", hitachi: "farm", higo: "farm", aki: "farm",
    osaka: "caravan", odawara: "caravan", bungo: "caravan", mikawa: "caravan",
  };
  /* 城市繁荣度（城市经营二期，二十六期改为纯城建驱动）：不再单独记账，直接由该城六项城建
   * （医馆/书院/驿站/城墙/演武场/钱庄，各0~10级）等级总和实时算出——修了城建繁荣度自动跟着涨，
   * 不修就不涨，不再有置业/接管/扩建/AI日常经营/夺城/断道这些各自为政、换算口径都不一样的
   * "加分事件"。六项城建总和 0~60，每 12 点一档，六项都修到约 8 级（合计48）即可满 5 星，
   * 与旧版"六种城建各自封顶大致等于 5 星"的设计初衷一致，只是算法从记账变成直接读数。
   * 初始城建等级按城市地位分三档（大城/普通/边陲）在新开局时一次性随机预置，见 Campaign.reset 附近
   * 的 seedInitialBuildings；此后不再有任何"起始星级"这个独立概念。
   * 影响产业收益倍率（0.9~1.3）、集市摊位数（≥4星 +1）、铁匠铺专精工钱（≥4星 再降三成），
   * 以及人口上限/驻军上限（见 Population/Garrison）。 */
  const PROSPER_INIT_HIGH = ["luoyang", "xuchang", "chengdu", "jianye", "kyoto", "osaka", "owari", "sunpu"];
  const PROSPER_INIT_LOW = ["baidicheng", "shangyong", "oushu", "higo", "hitachi"];
  // 新开局城建预置总点数：大城/普通/边陲三档，六项城建总和的目标值（对应下方 BUILD_SUM_STEP 的星级门槛）
  const PROSPER_SEED_SUM = { high: 24, normal: 12, low: 0 };
  const Prosper = {
    MAX: 5,
    // 六项城建等级总和 0~60，每跨过一个门槛长一颗星，5 星封顶（总和达 48 即满星，留有余量不必抠到 60）
    BUILD_SUM_STEP: [12, 24, 36, 48],   // 升至 2/3/4/5 星所需的城建等级总和门槛
    buildSum(m, cityId) { return Object.keys(BUILD_TYPES).reduce((s, t) => s + Buildings.lv(m, cityId, t), 0); },
    lv(m, cityId) {
      const sum = this.buildSum(m, cityId);
      let lv = 1;
      for (const step of this.BUILD_SUM_STEP) { if (sum >= step) lv++; }
      return Math.min(this.MAX, lv);
    },
    stars(m, cityId) { return "★".repeat(this.lv(m, cityId)); },
    mult(m, cityId) { return 0.8 + 0.1 * this.lv(m, cityId); },
  };
  const Estate = {
    ACCRUE_CAP_DAYS: 15,     // 待收积攒上限（天）：满仓后停止累计，逼你规划巡视路线
    MAT_PENDING_CAP: 3,      // 矿山待收材料上限（1 级；随扩建放宽，见 MAT_CAP_BY_LV）
    SELL_FACTOR: 0.5,        // 变卖回收比例
    MANAGER_BONUS_MAX: 50,   // 掌柜收益加成封顶（%）
    // 产业升级链（城市经营四期）：1~3 级（如酒馆→酒楼→天下名楼），扩建花金币且城市繁荣须达标
    LV_MULT: [1, 1.6, 2.4],        // 各级收益倍率
    MINE_DAYS: [5, 4, 3],          // 矿山每积 N 天出 1 份材料（按级递减）
    MAT_CAP_BY_LV: [3, 4, 5],      // 矿山待收材料上限（按级放宽）
    UP_PROSPER_NEED: [0, 2, 3],    // 升至 2/3 级所需城市繁荣星级
    all(m) { if (!m.estate) m.estate = {}; return m.estate; },
    get(m, cityId) { return this.all(m)[cityId] || null; },
    typeOf(cityId) { return ESTATE_TYPES[CITY_ESTATE[cityId]] || null; },
    sealed(m, cityId) { return cityOwnerSide(m, cityId) !== RPG.char.side; },
    lvOf(est) { return (est && est.lv) || 1; },
    lvName(m, cityId) { const est = this.get(m, cityId); const t = this.typeOf(cityId); return t ? t.lvN[this.lvOf(est) - 1] : "？"; },
    upCost(cityId, toLv) { const t = this.typeOf(cityId); return Math.round(t.cost * (toLv === 2 ? 1.25 : 2)); },
    // 累计造价（含历次扩建）：作为变卖回收与敌产接管的计价基础
    cumCost(cityId, lv) {
      const t = this.typeOf(cityId);
      let s = t.cost;
      if (lv >= 2) s += this.upCost(cityId, 2);
      if (lv >= 3) s += this.upCost(cityId, 3);
      return s;
    },
    // 掌柜收益加成百分比：(智力+政治)/4（取装备后数值），封顶 50%
    managerBonus(gid) {
      const g = gid != null ? DB.get(gid) : null;
      if (!g) return 0;
      const gg = Armory.geared(g, g.id);
      return Math.min(this.MANAGER_BONUS_MAX, Math.round((gg.zhi + gg.zheng) / 4));
    },
    dailyRate(m, cityId) {
      const est = this.get(m, cityId);
      if (!est) return 0;
      return Math.round(ESTATE_TYPES[est.type].rate * this.LV_MULT[this.lvOf(est) - 1] * (1 + this.managerBonus(est.manager) / 100) * Prosper.mult(m, cityId));
    },
    // 产业收益逐日浮动：以 (城市, 游戏天数) 播种，同一天重算结果恒定不抖动，只有翻篇到下一天才换新——
    // 常规日常规 ±15% 小幅波动；另各自独立 4% 概率「🎉丰收」（+35%~60%）、4% 概率「⚠️歉收」（-45%~-30%），
    // 让日进不再是一口价，但同一天内反复查看/结算金额始终一致，不给玩家"读档刷数值"的空子
    dailyNoiseMul(cityId, day) {
      const rnd = seededRand(mixSeed(hashStr("estate|" + cityId + "|" + day)));
      const r1 = rnd();
      if (r1 < 0.04) return { mul: 1.35 + rnd() * 0.25, tag: "harvest" };
      if (r1 < 0.08) return { mul: 0.55 + rnd() * 0.15, tag: "lean" };
      return { mul: 0.85 + rnd() * 0.3, tag: "normal" };
    },
    // 敌营产业日进（无掌柜加成，行情/繁荣倍率照常）：供全部城市总览展示各城日产金额
    npcDailyRate(m, cityId) {
      const n = this.npcGet(m, cityId);
      if (!n) return 0;
      return Math.round(ESTATE_TYPES[CITY_ESTATE[cityId]].rate * this.LV_MULT[n.lv - 1] * Prosper.mult(m, cityId));
    },
    // 不论城池当前处于何种产业状态（己方已置办 / 敌营经营中 / 尚未置办 / 无产业位），统一估算其金币日产出，
    // 供边境战事按「所夺/被夺城池日产出」结算战果犒赏/赔付（见 rowData 同款兜底逻辑）
    cityDailyGold(m, cityId) {
      const t = this.typeOf(cityId);
      if (!t) return 0;
      const est = this.get(m, cityId);
      if (est) return this.dailyRate(m, cityId);
      const npc = this.npcGet(m, cityId);
      if (npc) return this.npcDailyRate(m, cityId);
      return Math.round(t.rate * Prosper.mult(m, cityId));
    },
    // 懒结算：按距上次结算的天数计入；被敌方占据期间颗粒无收（天数照样翻篇）。
    // 有掌柜时金币由掌柜逐日代收直接入账（不进待收、不受 15 天积攒上限，商队行情按整段一次判定），
    // 矿山材料同样由掌柜一并代收直接入库（不受待收上限；无掌柜时仍须本人到城收取）。
    // 边境战易主一瞬由 applyBorderWarOutcome 先行调用本函数，保证易主前的天数不漏记、易主后不多记
    accrue(m, cityId) {
      const est = this.get(m, cityId);
      if (!est) return;
      const days = Math.max(0, m.day - est.lastDay);
      const fromDay = est.lastDay;
      est.lastDay = m.day;
      if (days <= 0 || this.sealed(m, cityId)) return;
      const rate = this.dailyRate(m, cityId);
      // 按实际经过的每一天各自取当天的浮动系数再累加，而不是整段区间套用同一个数——掌柜久未收账、
      // 一口气结算多天时，期间的丰收/歉收/常规波动天数都各自算数，不会被平均抹平
      let noisyTotal = 0;
      for (let d = fromDay + 1; d <= m.day; d++) noisyTotal += rate * this.dailyNoiseMul(cityId, d).mul;
      noisyTotal = Math.round(noisyTotal);
      if (est.manager != null) {
        let gold = noisyTotal;
        if (est.type === "caravan") gold = Math.round(gold * (0.6 + Math.random() * 0.8));
        if (gold > 0) {
          Bond.addGold(gold, "掌柜代收");
          est.banked = (est.banked || 0) + gold;
        }
      } else {
        est.pending = Math.min(rate * this.ACCRUE_CAP_DAYS, (est.pending || 0) + noisyTotal);
      }
      if (est.type === "mine") {
        const lv = this.lvOf(est);
        const per = this.MINE_DAYS[lv - 1];
        est.matCarry = (est.matCarry || 0) + days;
        const gain = Math.floor(est.matCarry / per);
        est.matCarry -= gain * per;
        est.matPending = Math.min(this.MAT_CAP_BY_LV[lv - 1], (est.matPending || 0) + gain);
        if (est.manager != null && est.matPending > 0) {
          this.deliverMats(cityId, est.matPending);
          est.matBanked = (est.matBanked || 0) + est.matPending;
          est.matPending = 0;
        }
      }
    },
    accrueAll(m) { Object.keys(this.all(m)).forEach(cid => this.accrue(m, cid)); },
    // 地图左栏总览：名下产业数与待收总额（顺带把各处账目结算到今天）
    overview(m) {
      this.accrueAll(m);
      Campaign.save();
      const ests = Object.values(this.all(m));
      if (!ests.length) return null;
      return { count: ests.length, pending: ests.reduce((s, e) => s + (e.pending || 0), 0) };
    },
    buy(m, cityId) {
      const c = cityDef(cityId);
      const t = this.typeOf(cityId);
      if (!c || !t || this.get(m, cityId)) return false;
      if (this.npcGet(m, cityId)) return false;   // 敌营产业占着位置：走接管（takeover）而非新置
      if (this.sealed(m, cityId)) { toast(`敌占之城无法置业，待己方夺回再来`); return false; }
      if (m.ap <= 0) { toast(`今日行动力已耗尽，请先宿营`); return false; }
      if (!Bond.spend(t.cost)) { toast(`金币不足（置办${t.n}需 ${t.cost} 金）`); return false; }
      m.ap--;
      this.all(m)[cityId] = { type: CITY_ESTATE[cityId], lastDay: m.day, pending: 0, manager: null };
      Campaign.save();
      AudioSystem.sfx.victory();
      toast(`${t.icon} 置办${cityName(cityId)}${t.n}成功！此后每日进账，记得常回来收取`);
      return true;
    },
    // 亲自收取：goldMult 供经营事件（大市翻倍等）放大金币；矿山材料一并交割。
    // 商队行情浮动在此处一次性判定（掌柜代收的部分则在 accrue 里按整段判定）
    collect(m, cityId, goldMult, notePrefix) {
      const est = this.get(m, cityId);
      if (!est) return null;
      if (this.sealed(m, cityId)) { toast(`产业已被查封，夺回城池方可收取`); return null; }
      this.accrue(m, cityId);
      let gold = est.pending || 0;
      let fluxTxt = "";
      if (est.type === "caravan" && gold > 0) {
        const f = 0.6 + Math.random() * 0.8;
        gold = Math.round(gold * f);
        fluxTxt = f >= 1.15 ? "（行情大好）" : f <= 0.85 ? "（行情惨淡）" : "";
      }
      gold = Math.round(gold * (goldMult || 1));
      const mats = est.matPending || 0;
      if (gold <= 0 && mats <= 0) { Campaign.save(); toast(`尚无进账，改日再来`); return null; }
      est.pending = 0;
      est.matPending = 0;
      const gained = Bond.addGold(gold, "产业收益");
      let matTxt = "";
      if (mats > 0) {
        const mt = this.deliverMats(cityId, mats);
        matTxt = `，${mt.n}材料 +${mats}`;
      }
      Campaign.save();
      AudioSystem.sfx.victory();
      toast(`${notePrefix || ""}💰 收取${ESTATE_TYPES[est.type].n}进账 ${gained} 金${fluxTxt}${matTxt}`);
      return { gold: gained, mats };
    },
    // 矿山材料入库（与本城铁匠铺专精同类型）
    deliverMats(cityId, n) {
      const matType = Armory.TYPES[hashStr(cityId) % Armory.TYPES.length];
      Armory.dropMaterial(matType.k, n);
      return matType;
    },
    // 强人劫掠：把这笔待收连同材料"押在路上"——立即清空账面并返回没收额，由应战/破财结局决定实得
    seizeForRaid(m, cityId) {
      const est = this.get(m, cityId);
      if (!est) return null;
      this.accrue(m, cityId);
      let gold = est.pending || 0;
      if (est.type === "caravan" && gold > 0) gold = Math.round(gold * (0.6 + Math.random() * 0.8));
      const mats = est.matPending || 0;
      est.pending = 0;
      est.matPending = 0;
      Campaign.save();
      return { gold, mats };
    },
    sell(m, cityId) {
      const est = this.get(m, cityId);
      if (!est) return false;
      if (this.sealed(m, cityId)) { toast(`产业已被查封，无法变卖`); return false; }
      this.accrue(m, cityId);
      const refund = Math.round(this.cumCost(cityId, this.lvOf(est)) * this.SELL_FACTOR) + (est.pending || 0);
      delete this.all(m)[cityId];
      Bond.addGold(refund, "变卖产业");
      Campaign.save();
      toast(`💸 变卖${cityName(cityId)}产业，回收 ${refund} 金（含未收账款）`);
      return true;
    },
    // 扩建：1→2→3 级，花金币且城市繁荣星级须达标（升 2 级需 ★★、升 3 级需 ★★★），收益随级跃升
    upgrade(m, cityId) {
      const est = this.get(m, cityId);
      if (!est) return false;
      if (this.sealed(m, cityId)) { toast(`产业已被查封，无法扩建`); return false; }
      const lv = this.lvOf(est);
      if (lv >= 3) return false;
      const needStar = this.UP_PROSPER_NEED[lv];
      if (Prosper.lv(m, cityId) < needStar) { toast(`城市繁荣不足，扩建需 ${"★".repeat(needStar)}——多在此城行事兴市吧`); return false; }
      const cost = this.upCost(cityId, lv + 1);
      this.accrue(m, cityId);   // 先按旧费率结清旧账，再升级生效
      if (!Bond.spend(cost)) { toast(`金币不足（扩建需 ${cost} 金）`); return false; }
      est.lv = lv + 1;
      Campaign.save();
      AudioSystem.sfx.victory();
      const t = ESTATE_TYPES[est.type];
      toast(`${t.icon} ${cityName(cityId)}产业扩建为「${t.lvN[est.lv - 1]}」，日进大涨！`);
      return true;
    },
    /* 敌营产业：他家势力在其治下城市自行兴办/扩建的产业，与玩家产业互斥占用同一处产业位。
     * 己方夺城后可按其累计造价五成接管为自家产业（等级保留）；未接管期间闲置，敌方夺回城池则复归敌营。 */
    npcAll(m) { if (!m.npcEstate) m.npcEstate = {}; return m.npcEstate; },
    npcGet(m, cityId) { return this.npcAll(m)[cityId] || null; },
    takeoverPrice(m, cityId) {
      const n = this.npcGet(m, cityId);
      return n ? Math.round(this.cumCost(cityId, n.lv) * 0.5) : 0;
    },
    takeover(m, cityId) {
      const n = this.npcGet(m, cityId);
      if (!n || this.get(m, cityId)) return false;
      if (this.sealed(m, cityId)) { toast(`此城尚在敌手，夺回后方可接管敌营产业`); return false; }
      if (m.ap <= 0) { toast(`今日行动力已耗尽，请先宿营`); return false; }
      const price = this.takeoverPrice(m, cityId);
      if (!Bond.spend(price)) { toast(`金币不足（接管需 ${price} 金）`); return false; }
      m.ap--;
      delete this.npcAll(m)[cityId];
      this.all(m)[cityId] = { type: CITY_ESTATE[cityId], lastDay: m.day, pending: 0, manager: null, lv: n.lv };
      Campaign.save();
      AudioSystem.sfx.victory();
      const t = this.typeOf(cityId);
      toast(`${t.icon} 接管${cityName(cityId)}敌营产业（${t.lvN[n.lv - 1]}）成功！此后每日进账，记得常回来收取`);
      return true;
    },
    // 掌柜候选：已现身、友谊满上限、不在团队、未在别处任掌柜、未任守将（敌我阵营皆可——毕竟是过命的交情）
    eligibleManagers(m) {
      const taken = new Set(Object.values(this.all(m)).map(e => e.manager).filter(v => v != null));
      const guarded = Guard.ids(m);
      return DB.list.filter(g => m.appeared.includes(g.id) && Bond.pts(g.id) >= Bond.MAX_FRIEND
        && !Bond.inTeam(g.id) && !taken.has(g.id) && !guarded.has(g.id));
    },
    appoint(m, cityId, gid) {
      const est = this.get(m, cityId);
      if (!est) return false;
      this.accrue(m, cityId);   // 先按旧掌柜费率结清，再换人生效
      est.manager = gid;
      m.assign[gid] = cityId;   // 掌柜走马上任，常驻本城打理产业（不再随宿营云游）
      Campaign.save();
      const g = DB.get(gid);
      toast(`🤝 ${g.name} 出任${cityName(cityId)}${ESTATE_TYPES[est.type].n}掌柜，收益 +${this.managerBonus(gid)}%`);
      return true;
    },
    dismissManager(m, cityId) {
      const est = this.get(m, cityId);
      if (!est || est.manager == null) return;
      this.accrue(m, cityId);
      est.manager = null;
      Campaign.save();
    },
    // 掌柜被招募入队后自动卸任（队伍随主角云游，无法再驻店）
    onRecruit(gid) {
      const m = typeof Campaign !== "undefined" && Campaign.mapState();
      if (!m) return;
      Object.keys(this.all(m)).forEach(cid => {
        const est = this.all(m)[cid];
        if (est.manager === gid) { this.accrue(m, cid); est.manager = null; }
      });
      Campaign.save();
    },
    managerIds(m) {
      return new Set(Object.values(this.all(m)).map(e => e.manager).filter(v => v != null));
    },
  };
  /* ============================================================
   *  城建捐修（城市经营三期）：每城开放 3 种可捐资兴建的公共建筑（医馆/书院/驿站/城墙/演武场
   *  按城市哈希稳定取三），各 1~3 级，捐修花金币+本城铁匠铺专精材料、不耗行动力，并积攒繁荣点。
   *  建筑归属跟随城池：城属己方时效果为你所用，被敌方攻占即为敌用（城墙攻守对称生效），
   *  夺回后原级保留、即刻恢复。数据存战役层 m.builds。
   * ============================================================ */
  // 六种城建效果均按等级公式生成（不再是硬编码的 3 档数组）：封顶从 3 级放宽到 10 级后，
  // 60 格文案手写不现实也不好配平，改用公式让效果随等级平滑增长，desc 只说明机制、eff(lv) 给出该级具体数值
  const BUILD_TYPES = {
    hospital: {
      n: "医馆", icon: "🏥",
      desc: "郎中坐堂——本城回魂丹折价，单挑时体力（气血）每回合额外回复，带兵作战安抚军心/驰援同袍额外恢复兵力",
      eff(lv) { return `回魂丹${Buildings.hospitalRevivePrice(lv)}金 · 体力+${lv * 2}/回合 · 兵力+${lv * 3}%`; },
    },
    academy: {
      n: "书院", icon: "📚",
      desc: "名士讲学——在本城进行的单挑（历练/切磋/悬赏/设施）经验加成",
      eff(lv) { return `经验 +${lv * 10}%`; },
    },
    post: {
      n: "驿站", icon: "🏇",
      desc: "快马官道——与其他建有驿站的己方城市互通直达（不论多远只耗 1⚡，按路程收驿费，无奇遇无风浪）",
      eff(lv) { return lv <= 1 ? "开通驿路" : `驿费 -${Math.round((1 - Buildings.postDiscount(lv)) * 100)}%`; },
    },
    wall: {
      n: "城墙", icon: "🏯",
      desc: "高墙深垒——本城若被围攻，守军全员六维获此加成（易主后为敌所用），另加成本城驻军上限",
      eff(lv) { return `守备 +${lv * 2} · 驻军上限 +${(lv * Garrison.WALL_CAP_STEP).toLocaleString()}`; },
    },
    drill: {
      n: "演武场", icon: "⚔️",
      desc: "日日操练——本城特色设施挑战获胜时，名声额外加成",
      eff(lv) { return `名声 +${lv * 4}`; },
    },
    // 新增：影响本城对所属势力金库的日进贡献，与「天下名楼」等自选武将私产投资彻底分账——
    // 后者是你自己的钱袋子，钱庄是这座城给势力府库交的税，两笔账不再混为一谈（见 FactionGold.income）
    bank: {
      n: "钱庄", icon: "🏦",
      desc: "汇通四方——本城对所属势力金库的日进贡献随等级提升，未建亦有底税，与自选武将的私产收益无关",
      eff(lv) { return `势力金库日进 +${Buildings.bankIncome(lv).toLocaleString()} 金/日`; },
    },
  };
  // 每城可建全部城建类型（不再是"5 选 3"），对马岛海路中转无城建
  function cityBuildOptions(cityId) {
    const c = cityId && cityDef(cityId);
    if (!c || c.side === "sea") return [];
    return Object.keys(BUILD_TYPES);
  }
  const Buildings = {
    MAX_LV: 10,
    // 修至 1~10 级的花费（材料为本城专精类），随等级加速增长——10 级约合 1 级的近 20 倍
    COSTS: [
      { gold: 500, mats: 0 }, { gold: 800, mats: 1 }, { gold: 1200, mats: 1 }, { gold: 1800, mats: 2 }, { gold: 2600, mats: 2 },
      { gold: 3600, mats: 3 }, { gold: 4800, mats: 3 }, { gold: 6200, mats: 4 }, { gold: 7800, mats: 4 }, { gold: 9600, mats: 5 },
    ],
    all(m) { if (!m.builds) m.builds = {}; return m.builds; },
    of(m, cityId) { return this.all(m)[cityId] || {}; },
    lv(m, cityId, type) { return this.of(m, cityId)[type] || 0; },
    sealed(m, cityId) { return cityOwnerSide(m, cityId) !== RPG.char.side; },
    // 回魂丹价随医馆等级指数衰减，10 级封底 20 金（原 3 级硬编码 [100,80,65,50] 的自然延伸）
    hospitalRevivePrice(lv) { return Math.max(20, Math.round(100 * Math.pow(0.85, lv))); },
    // 驿费折扣：1 级只是"开通"，之后每级再降 9%，10 级封底剩 19% 原价（不会像线性衰减那样降到负数）
    postDiscount(lv) { return lv <= 1 ? 1 : Math.max(0.19, 1 - 0.09 * (lv - 1)); },
    // 钱庄对势力金库的日进贡献：未建亦有底税（150/日），每级再加 120——城池不至于因无人投资而颗粒无收
    BANK_BASE: 150, BANK_PER_LV: 120,
    bankIncome(lv) { return this.BANK_BASE + this.BANK_PER_LV * lv; },
    // —— 三项"驻城即享"的效果，均要求当前所在城归属己方 ——
    reviveCost() {
      const m = typeof Campaign !== "undefined" && Campaign.mapState();
      if (!m || !m.curCity || this.sealed(m, m.curCity)) return this.hospitalRevivePrice(0);
      return this.hospitalRevivePrice(this.lv(m, m.curCity, "hospital"));
    },
    expMult(m) {
      if (!m || !m.curCity || this.sealed(m, m.curCity)) return 1;
      return 1 + this.lv(m, m.curCity, "academy") * 0.1;
    },
    drillBonus(m) {
      if (!m || !m.curCity || this.sealed(m, m.curCity)) return 0;
      return this.lv(m, m.curCity, "drill") * 4;
    },
    // 医馆单挑体力恢复：所在城医馆每级 +2 点/回合体力回复（与奇珍「气血回复」叠加，见 engine.js endTurn）
    hpRegenBonus(m) {
      if (!m || !m.curCity || this.sealed(m, m.curCity)) return 0;
      return this.lv(m, m.curCity, "hospital") * 2;
    },
    // 医馆带兵作战兵力恢复：安抚军心/驰援同袍类计策在本城额外恢复的兵力比例（每级 +3%）
    troopHealBonus(m) {
      if (!m || !m.curCity || this.sealed(m, m.curCity)) return 0;
      return this.lv(m, m.curCity, "hospital") * 0.03;
    },
    build(m, cityId, type) {
      const cur = this.lv(m, cityId, type);
      if (cur >= this.MAX_LV || !cityBuildOptions(cityId).includes(type)) return false;
      if (this.sealed(m, cityId)) { toast(`敌占之城无法捐修，待己方夺回再来`); return false; }
      const cost = this.COSTS[cur];
      const matType = Armory.TYPES[hashStr(cityId) % Armory.TYPES.length];
      if (cost.mats > 0 && (Armory.data.materials[matType.k] || 0) < cost.mats) { toast(`${matType.n}材料不足（需 ${cost.mats} 份，本城铁匠铺专精类）`); return false; }
      if (!Bond.spend(cost.gold)) { toast(`金币不足（捐修需 ${cost.gold} 金）`); return false; }
      if (cost.mats > 0) { Armory.data.materials[matType.k] -= cost.mats; Armory.save(); }
      if (!this.all(m)[cityId]) this.all(m)[cityId] = {};
      this.all(m)[cityId][type] = cur + 1;
      // 繁荣度二十六期起直接由城建等级总和实时算出（见 Prosper.lv/buildSum），这里升了城建
      // 等级，繁荣度自动跟着变，不需要再手动加分
      Campaign.save();
      AudioSystem.sfx.victory();
      toast(`${BUILD_TYPES[type].icon} ${cityName(cityId)}${BUILD_TYPES[type].n}修至 ${cur + 1} 级！（${BUILD_TYPES[type].eff(cur + 1)}）`);
      return true;
    },
    // 驿站快马：两端都须是归属己方且建有驿站的城市；驿费按 BFS 最短跳数计价，本城驿站等级享折扣
    hops(a, b) {
      if (a === b) return 0;
      const seen = new Set([a]);
      let frontier = [a], d = 0;
      while (frontier.length) {
        d++;
        const next = [];
        for (const id of frontier) {
          for (const adj of adjCities(id)) {
            if (seen.has(adj)) continue;
            if (adj === b) return d;
            seen.add(adj);
            next.push(adj);
          }
        }
        frontier = next;
      }
      return 99;
    },
    postCost(m, dest) {
      const d = Math.max(1, this.hops(m.curCity, dest));
      return Math.round(60 * d * this.postDiscount(this.lv(m, m.curCity, "post")));
    },
    postDests(m) {
      if (this.sealed(m, m.curCity) || this.lv(m, m.curCity, "post") < 1) return [];
      return CITIES.filter(c => c.id !== m.curCity && c.side !== "sea"
        && cityOwnerSide(m, c.id) === RPG.char.side && this.lv(m, c.id, "post") >= 1)
        .map(c => ({ id: c.id, n: c.n, cost: this.postCost(m, c.id) }));
    },
  };
  // 新开局城建预置：大城/普通/边陲三档总点数不变（对应目标星级），但六项城建之间的具体分配
  // 每局随机抽签——总量相同、强项各异，同一座史名大城这局可能是"城墙+驿站突出"，下局重开
  // 又是"钱庄+书院突出"，既保留了"这城起步就该比较繁荣"的地位差异，也不至于每局都长一个样。
  // 边陲小城总量为0，不参与随机分配（原地起步即可，符合"待开发"的定位）。
  function randomDistributeLevels(total, types, maxEach) {
    const out = {}; types.forEach(t => out[t] = 0);
    for (let i = 0; i < total; i++) {
      const room = types.filter(t => out[t] < maxEach);
      if (!room.length) break;   // 理论上不会触发（总量远小于 类型数×封顶），留一道保险不死循环
      out[room[randInt(0, room.length - 1)]]++;
    }
    return out;
  }
  function seedInitialBuilds() {
    const types = Object.keys(BUILD_TYPES);
    const builds = {};
    CITIES.filter(c => c.side !== "sea").forEach(c => {
      const total = PROSPER_INIT_HIGH.includes(c.id) ? PROSPER_SEED_SUM.high
        : PROSPER_INIT_LOW.includes(c.id) ? PROSPER_SEED_SUM.low : PROSPER_SEED_SUM.normal;
      if (total > 0) builds[c.id] = randomDistributeLevels(total, types, Buildings.MAX_LV);
    });
    return builds;
  }
  /* ============================================================
   *  人口（二十六期）：每座陆地城市维护一个真实存量的人口数字，上限由繁荣度决定。
   *  每日按"距上限差值×3%"双向收敛——人口低于上限慢慢补齐，高于上限（多半是城建刚被
   *  攻城打残、繁荣度骤降导致上限突然变小）也慢慢回落，同一条公式两个方向都适用。
   *  征兵按1:1消耗人口（见 Garrison.recruit），攻城破城另有一次性折损（见 applyBorderWarOutcome），
   *  断道计谋也会小幅冲击人口（见 FactionAI 计谋分支）。人口同时是驻军上限与每日征兵配额的
   *  唯一输入（见 Garrison），人口越空，这座城能养的兵、当天能新募的兵都会跟着缩水，
   *  形成"竭泽而渔"的自然制衡，不需要额外的冷却机制。数据存战役层 m.population。
   * ============================================================ */
  const Population = {
    CAP_BY_LV: [300000, 450000, 600000, 800000, 1000000],   // 繁荣度1~5星对应的人口上限
    FLOW_RATE: 0.03,   // 每日按"距上限差值"回流/回落的比例
    cap(m, cityId) { return this.CAP_BY_LV[Prosper.lv(m, cityId) - 1]; },
    all(m) { if (!m.population) m.population = {}; return m.population; },
    // 首次读取即按当前上限满编初始化，与 Garrison.get 同一套"未记录视同齐整"的处理方式
    get(m, cityId) {
      const t = this.all(m);
      if (t[cityId] == null) t[cityId] = this.cap(m, cityId);
      return t[cityId];
    },
    set(m, cityId, v) { this.all(m)[cityId] = Math.max(0, Math.round(v)); },
    spend(m, cityId, n) { this.set(m, cityId, this.get(m, cityId) - n); },
    tick(m, cityId) {
      const cur = this.get(m, cityId), cap = this.cap(m, cityId);
      this.set(m, cityId, cur + Math.round((cap - cur) * this.FLOW_RATE));
    },
    tickAll(m) { CITIES.forEach(c => { if (c.side !== "sea") this.tick(m, c.id); }); },
  };
  /* ============================================================
   *  城池驻军（军事一期，二十六期改为人口驱动）：每座非海路城池（不分敌我）各自维护一支驻军，
   *  上限随人口/城墙等级提升，宿营时按同一节奏回复；边境大战出阵兵力不再纯由武将统帅推算，
   *  而是从交战双方各自所在城池的驻军中抽调——人丁兴旺、城墙厚实的边城才能撑起满编大军，
   *  弱小边城捉襟见肘。另设每日征兵名额（人口×比例×演武场加成），不论多有钱，
   *  一天最多只能招募这么多人——征兵不再是"有钱就能秒满编"，还要看这座城当天有没有名额。
   *  数据存战役层 m.troops（城→驻军数）。
   * ============================================================ */
  const Garrison = {
    // 驻军上限 = 人口×9% + 城墙等级×1000：满人口(100万)+满城墙(10级)时封顶恰好10万，
    // 城墙这部分维持原有数值不变，只是原来"基础3万+繁荣度"那部分整体替换为人口驱动
    POP_CAP_RATIO: 0.09, WALL_CAP_STEP: 1000,
    BASE_REGEN: 300, POP_REGEN_RATIO: 0.001,
    RECRUIT_GOLD_PER: 0.5,   // 每募 1 兵耗 0.5 金
    // 每日征兵配额：人口×0.5%×(1+演武场等级×15%)，按天重置、不累积——今天没用完不会攒到明天
    RECRUIT_QUOTA_RATIO: 0.005, DRILL_QUOTA_BONUS: 0.15,
    AI_COMMIT: 0.7,          // 非玩家一方出阵默认调用本城 7 成驻军，留 3 成戍守（无城池经营心思，简化处理）
    cap(m, cityId) { return Math.round(Population.get(m, cityId) * this.POP_CAP_RATIO + Buildings.lv(m, cityId, "wall") * this.WALL_CAP_STEP); },
    regen(m, cityId) { return Math.round(this.BASE_REGEN + Population.get(m, cityId) * this.POP_REGEN_RATIO); },
    recruitQuota(m, cityId) {
      return Math.round(Population.get(m, cityId) * this.RECRUIT_QUOTA_RATIO * (1 + Buildings.lv(m, cityId, "drill") * this.DRILL_QUOTA_BONUS));
    },
    recruitedToday(m, cityId) { return ((m.recruitedToday || {})[cityId + "|" + m.day]) || 0; },
    addRecruited(m, cityId, n) {
      if (!m.recruitedToday) m.recruitedToday = {};
      const key = cityId + "|" + m.day;
      m.recruitedToday[key] = (m.recruitedToday[key] || 0) + n;
    },
    remainingQuota(m, cityId) { return Math.max(0, this.recruitQuota(m, cityId) - this.recruitedToday(m, cityId)); },
    all(m) { if (!m.troops) m.troops = {}; return m.troops; },
    // 首次读取即按当前上限满编初始化（战役刚开局或城池刚被攻陷但尚无记录时，视同兵力齐整）
    get(m, cityId) {
      const t = this.all(m), cap = this.cap(m, cityId);
      if (t[cityId] == null) t[cityId] = cap;
      return Math.min(t[cityId], cap);
    },
    set(m, cityId, v) { this.all(m)[cityId] = Math.max(0, Math.min(this.cap(m, cityId), Math.round(v))); },
    add(m, cityId, n) { if (n) this.set(m, cityId, this.get(m, cityId) + n); },
    spend(m, cityId, n) { this.set(m, cityId, this.get(m, cityId) - n); },
    // 宿营时全图城池（不分敌我）同步回复驻军，人口越多恢复越快。
    // 根因修复：对马岛（对马番所）原被排除在外，导致此地驻军只出不进——一旦被攻占并用其驻军
    // 杀奔对岸，对马岛自身就此归零且永不回复，往后谁占了它都无法再借道继续进攻，中日双方一年多
    // 都卡死在这座中转岛上寸步难进。对马岛虽不能筑城墙（无城建选项），但驻军理应与其余城池一视同仁地回补
    tickAll(m) { CITIES.forEach(c => this.add(m, c.id, this.regen(m, c.id))); },
    // 募兵：一键花钱尽量补满至上限，金币不足、人口不够、当日名额用完，三者取最紧的那个卡死
    recruit(m, cityId) {
      const room = this.cap(m, cityId) - this.get(m, cityId);
      if (room <= 0) { toast("驻军已满编"); return false; }
      const quota = this.remainingQuota(m, cityId);
      if (quota <= 0) { toast("今日征兵名额已用尽，明日再来"); return false; }
      const affordable = Math.floor(Bond.gold() / this.RECRUIT_GOLD_PER);
      const n = Math.min(room, affordable, quota, Population.get(m, cityId));
      if (n <= 0) { toast(`金币不足（募兵每员需 ${this.RECRUIT_GOLD_PER} 金）`); return false; }
      const cost = Math.ceil(n * this.RECRUIT_GOLD_PER);
      Bond.spend(cost);
      this.add(m, cityId, n);
      Population.spend(m, cityId, n);
      this.addRecruited(m, cityId, n);
      Campaign.save();
      toast(`🚩 ${cityName(cityId)}募得新兵 ${n.toLocaleString()}，耗 ${cost} 金${n < room ? "（受限于金币/人口/当日名额，未能募满）" : "（已募至满编）"}（现有驻军 ${this.get(m, cityId).toLocaleString()}）`);
      return true;
    },
    // 按指定数量募兵（供募兵滑杆调用）：数量卡在「兵额尚余」「金币买得起」「人口够不够」「当日名额」
    // 四者之间，超额部分自动截断
    recruitN(m, cityId, n) {
      const room = this.cap(m, cityId) - this.get(m, cityId);
      const quota = this.remainingQuota(m, cityId);
      const affordable = Math.floor(Bond.gold() / this.RECRUIT_GOLD_PER);
      n = Math.max(0, Math.min(room, affordable, quota, Population.get(m, cityId), Math.round(n)));
      if (n <= 0) { toast("募兵数量为 0，未曾发兵（金币、人口或当日征兵名额或有不足）"); return false; }
      const cost = Math.ceil(n * this.RECRUIT_GOLD_PER);
      if (!Bond.spend(cost)) { toast(`金币不足（需 ${cost} 金）`); return false; }
      this.add(m, cityId, n);
      Population.spend(m, cityId, n);
      this.addRecruited(m, cityId, n);
      Campaign.save();
      toast(`🚩 ${cityName(cityId)}募得新兵 ${n.toLocaleString()}，耗 ${cost} 金（现有驻军 ${this.get(m, cityId).toLocaleString()}）`);
      return true;
    },
  };
  /* ============================================================
   *  势力国力三件套：威名（Fame）／军令（Orders）／金库（Gold）
   *  —— 威名是一家势力的分量，决定每日可发多少道军令；军令是行动的硬通货（营建/征兵/出征/施计/封赏皆耗之）；
   *  金库则是征兵与营建的钱粮来源。三者共同决定 FactionAI 每日能做多少事、做得多好，
   *  也让"大势力滚雪球、小势力捉襟见肘"的格局自然成立，无需另写一套难度曲线。
   * ============================================================ */
  const FactionFame = {
    BASE_PER_CITY: 100,        // 开局威名 = 初始城池数 × 100
    CAPTURE: 150, LOSE: -120,  // 夺城／失城
    PLOT_WIN: 30, PLOT_HIT: -20,
    MAX: 9999,
    // 威名九阶：与名声九阶同构（阈值相同，仅换一套适合"一方势力"的称谓），
    // 玩家自立后其个人名声即以威名×10 的形式复用这套阈值，无需另造一张表（见 Campaign.effFame）
    TIERS: [
      { min: 0, n: "微末之族" }, { min: 150, n: "一乡之豪" }, { min: 500, n: "割据一方" },
      { min: 1200, n: "名震州郡" }, { min: 2200, n: "雄踞数城" }, { min: 3500, n: "威压诸侯" },
      { min: 5000, n: "一方霸主" }, { min: 7000, n: "天下枭雄" }, { min: 9000, n: "万世基业" },
    ],
    all(m) { return m.factionFame || (m.factionFame = {}); },
    init() {
      const o = {};
      FACTIONS.forEach(f => { if (!DUMMY_FACTIONS.includes(f.id)) o[f.id] = f.cities.length * this.BASE_PER_CITY; });
      return o;
    },
    get(m, fid) { const v = this.all(m)[fid]; return v == null ? 0 : v; },
    // 威名下限随疆域走：手握城池者总还有一份摆在那里的分量，不至于被连番流言中伤到一无所有
    // （实测中曾见某家坐拥三城而威名归零、军令枯竭，形同活死人，故设此底线）
    floor(m, fid) { return factionCityCount(m, fid) * 30; },
    set(m, fid, v) { this.all(m)[fid] = Math.max(this.floor(m, fid), Math.min(this.MAX, Math.round(v))); },
    add(m, fid, n) { if (!fid || !n) return; this.set(m, fid, this.get(m, fid) + n); },
    tierName(v) { for (let i = this.TIERS.length - 1; i >= 0; i--) if (v >= this.TIERS[i].min) return this.TIERS[i].n; return this.TIERS[0].n; },
  };
  const FactionOrders = {
    // 池上限 3+威名/300（封顶 8）——威名越盛，动作越频密。
    // 每日回复改为直接回满（而非按 regen 缓慢累加）：军令最低的势力（3 道）当日满额时也恰好
    // 够发动一次出征（耗 3），不必再指望"存够军令"这种在贪心的势力 AI 手中几乎不会发生的事——
    // 旧的"加 regen"算法下，弱小势力常年徘徊在 0~2 道之间，永远凑不出一次出征。
    // 出征本身仍受 weary 冷却节制（2~4 天），故回满不会导致天天开战，只是让"能打"不再是奢望；
    // 其余耗军令动作因而变得更频密，故其数值效果相应下调，见 NON_WAR_DAMPEN。
    cap(m, fid) { return Math.min(8, 3 + Math.floor(FactionFame.get(m, fid) / 300)); },
    all(m) { return m.factionOrders || (m.factionOrders = {}); },
    get(m, fid) { const v = this.all(m)[fid]; return v == null ? this.cap(m, fid) : v; },
    set(m, fid, v) { this.all(m)[fid] = Math.max(0, Math.min(this.cap(m, fid), Math.round(v))); },
    spend(m, fid, n) { if (this.get(m, fid) < n) return false; this.set(m, fid, this.get(m, fid) - n); return true; },
    tickAll(m) { liveFactionIds(m).forEach(fid => this.set(m, fid, this.cap(m, fid))); },
    init() { const o = {}; FACTIONS.forEach(f => { if (!DUMMY_FACTIONS.includes(f.id)) o[f.id] = 3; }); return o; },
  };
  const FactionGold = {
    // 自立门户后，「势力金库」与自选武将的私人钱包实为同一笔钱——势力钱庄收上来的税本就是主公的家底，
    // 募兵/城建历来也是直接花自选武将的金币（Bond.gold）。此前两本账各记各的，势力金库那本只进不出、
    // 完全脱离玩家实际能花的钱，形同摆设。改为在此处统一收口：fid 为 "_player_" 时，get/set/add/spend
    // 一律转发到 Bond，其余势力不受影响——全部势力列表、人事面板等一切读取点自然一并打通，无需逐处修改
    all(m) { return m.factionGold || (m.factionGold = {}); },
    get(m, fid) { if (fid === "_player_") return Bond.gold(); const v = this.all(m)[fid]; return v == null ? 0 : v; },
    set(m, fid, v) {
      if (fid === "_player_") { Bond.data.gold = Math.max(0, Math.round(v)); Bond.save(); return; }
      this.all(m)[fid] = Math.max(0, Math.round(v));
    },
    add(m, fid, n) { if (!fid || !n) return; if (fid === "_player_") { Bond.addGold(Math.round(n)); return; } this.set(m, fid, this.get(m, fid) + n); },
    spend(m, fid, n) { if (fid === "_player_") return Bond.spend(Math.round(n)); if (this.get(m, fid) < n) return false; this.set(m, fid, this.get(m, fid) - n); return true; },
    // 日进：所辖各城「钱庄」贡献之和，按城市繁荣度加成——与 Estate（天下名楼等自选武将私产投资）
    // 彻底分账，不再借用后者的收益口径。城池纵使分文未投钱庄也有底税，不至于因无人经营而颗粒无收
    income(m, fid) {
      return CITIES.filter(c => c.side !== "sea" && cityFactionId(m, c.id) === fid)
        .reduce((s, c) => s + Math.round(Buildings.bankIncome(Buildings.lv(m, c.id, "bank")) * Prosper.mult(m, c.id)), 0);
    },
    tickAll(m) { liveFactionIds(m).forEach(fid => this.add(m, fid, this.income(m, fid))); },
    init() { const o = {}; FACTIONS.forEach(f => { if (!DUMMY_FACTIONS.includes(f.id)) o[f.id] = f.cities.length * 600; }); return o; },
  };
  // 势力麾下已现身武将中，某一维度前 5 名的均值——决定该势力各类动作的"战略质量"。
  // 每日各势力都要按六维各算一次，故按 (day, fid, dim) 缓存，避免 400 人名录被反复全表扫描
  const FactionTop5 = {
    _day: -1, _cache: {},
    top5(m, fid, dim) {
      if (this._day !== m.day) { this._day = m.day; this._cache = {}; }
      const k = fid + "|" + dim;
      if (k in this._cache) return this._cache[k];
      const vals = DB.list.filter(g => (m.generalFaction || {})[g.id] === fid && m.appeared.includes(g.id))
        .map(g => Armory.geared(g, g.id)[dim]).sort((a, b) => b - a).slice(0, 5);
      const v = vals.length ? Math.round(vals.reduce((s, x) => s + x, 0) / vals.length) : 40;
      this._cache[k] = v;
      return v;
    },
    invalidate() { this._day = -1; this._cache = {}; },
  };
  // 势力占城数（不含海路中转站）
  function factionCityCount(m, fid) {
    return CITIES.filter(c => c.side !== "sea" && cityFactionId(m, c.id) === fid).length;
  }
  function factionGenerals(m, fid, appearedOnly) {
    return DB.list.filter(g => (m.generalFaction || {})[g.id] === fid && (!appearedOnly || m.appeared.includes(g.id)));
  }

  /* ============================================================
   *  玩家身份线（军事三期）：在野浪人 → 投效客卿 → 累积功勋逐级晋升（偏将→重臣→城主）→ 自立门户当主。
   *  功勋来自为主公效力的实绩——完成悬赏（见 completeBountyReward）、随军攻城得胜（见 finalizeBorderWar）。
   *  自立门户会另立一家新势力（"_player_"，数据存 m.playerOwnFaction，见 factionDef），名声受挫但旧主
   *  只是暂时交恶（m.exLordUntil 记冷却到期日），并非永久为敌——冷却期满，物是人非，各自安好。
   * ============================================================ */
  const PlayerRank = {
    // 官职九阶，按国别双套命名（中原 / 战国），阈值共用。
    // 阈值较初版大幅抬高（城主 800 → 20000）：初版一条 20 层登塔令就能连跳两级，爬到顶不过数日，
    // 官职因而毫无分量；现改为需要以百场计的实绩累积，"位极人臣"才配得上这个词。
    RANKS: [
      { n: "在野", jn: "浪人", need: 0 },
      { n: "门客", jn: "足轻组头", need: 0 },
      { n: "参军", jn: "侍大将", need: 200 },
      { n: "偏将", jn: "物头", need: 600 },
      { n: "裨将军", jn: "番头", need: 1400 },
      { n: "中郎将", jn: "家老", need: 3000 },
      { n: "重臣", jn: "宿老", need: 6000 },
      { n: "太守", jn: "城代", need: 11000 },
      { n: "城主", jn: "城主", need: 20000 },
    ],
    rankLabel(idx) {
      const r = this.RANKS[idx] || this.RANKS[this.RANKS.length - 1];
      return RPG.char && RPG.char.side === "jp" ? r.jn : r.n;
    },
    rankName(m) {
      if (!m.playerFaction) return RPG.char && RPG.char.side === "jp" ? "浪人" : "在野";
      if (m.playerFaction === "_player_") return "当主（自立）";
      return this.rankLabel(m.playerRank);
    },
    nextNeed(m) {
      if (!m.playerFaction || m.playerFaction === "_player_" || m.playerRank >= this.RANKS.length - 1) return null;
      return { n: this.rankLabel(m.playerRank + 1), need: this.RANKS[m.playerRank + 1].need };
    },
    // 功勋累计驱动晋升；自立门户后（"_player_"）已无上级可言，不再计功勋
    addMerit(m, n) {
      if (!m.playerFaction || m.playerFaction === "_player_" || m.playerRank >= this.RANKS.length - 1 || n <= 0) return;
      m.playerMerit = (m.playerMerit || 0) + n;
      while (m.playerRank < this.RANKS.length - 1 && m.playerMerit >= this.RANKS[m.playerRank + 1].need) {
        m.playerRank++;
        toast(`🎖️ 功勋卓著，晋升为「${this.rankLabel(m.playerRank)}」！`);
        this.checkLordGrant(m);   // 位至中郎将/家老以上，主公可能赐下封地
      }
      Campaign.save();
    },
    // 主公赐封：官至第 5 阶（中郎将/家老）以上，有机会获赐一座本势力城池为食邑——
    // 让「仕官」本身就是一条有获得感的路，而不只是通往自立的踏板；也令"要不要自立"成为真正的两难
    LORD_GRANT_RANK: 5,
    checkLordGrant(m) {
      if (!m.playerFaction || m.playerFaction === "_player_") return;
      if (m.playerRank < this.LORD_GRANT_RANK) return;
      if (m.playerFief) return;   // 已有食邑
      if (Math.random() >= 0.5) return;
      const owned = CITIES.filter(c => c.side !== "sea" && cityFactionId(m, c.id) === m.playerFaction
        && !Object.keys(m.fiefs || {}).includes(c.id));
      if (!owned.length) return;
      const city = owned[randInt(0, owned.length - 1)];
      m.playerFief = city.id;
      Campaign.save();
      setTimeout(() => toast(`🏯 主公论功行赏，将【${city.n}】赐你为食邑——此城产出自今日起尽归你手！`), 900);
    },
    // 投效：须尚在野、目标须与本国同属、且不处于对旧主的敌对冷却期（背主未久，人家还在气头上）
    canJoin(m, factionId) {
      if (m.playerFaction) return false;
      if (factionDef(factionId).side !== RPG.char.side) return false;
      return !this.exLordHostile(m, factionId);
    },
    join(m, factionId) {
      if (!this.canJoin(m, factionId)) return false;
      m.playerFaction = factionId; m.playerRank = 1; m.playerMerit = 0;
      Campaign.save();
      toast(`🏯 投效${factionDef(factionId).n}，拜为客卿！`);
      return true;
    },
    exLordHostile(m, factionId) { return (m.exLordUntil && m.exLordUntil[factionId] || 0) > m.day; },
    INDEPENDENCE_RANK: 7, INDEPENDENCE_FAME_MIN: 1000, EX_LORD_COOLDOWN: 60,
    canDeclareIndependence(m) {
      return !!m.playerFaction && m.playerFaction !== "_player_" && m.playerRank >= this.INDEPENDENCE_RANK
        && (m.fame || 0) >= this.INDEPENDENCE_FAME_MIN && isMyCity(m, m.curCity);
    },
    // 自立势力名：中原取「某某军」，战国取「某某家」——统一叫"家"会让"刘备家"读着像日本战国
    ownFactionName(name, side) { return side === "jp" ? `${name}家` : `${name}军`; },
    // 自立：以当前所在（须已是本势力城池）城池为根基，脱离旧主另立门户——名声受挫但非永久交恶，
    // 旧主进入敌对冷却，期满后恢复中立（可重新投效）。
    // 同时完成「名声 → 势力威名」的一次性转轨：先扣 15% 自立代价，余下按 1/10 折成本家威名（见 Campaign.effFame）
    declareIndependence(m) {
      if (!this.canDeclareIndependence(m)) return false;
      const oldFid = m.playerFaction, oldDef = factionDef(oldFid);
      if (!m.exLordUntil) m.exLordUntil = {};
      m.exLordUntil[oldFid] = m.day + this.EX_LORD_COOLDOWN;
      m.playerOwnFaction = { n: this.ownFactionName(RPG.char.name, RPG.char.side), lord: RPG.char.name, side: RPG.char.side };
      if (!m.cityFaction) m.cityFaction = {};
      m.cityFaction[m.curCity] = "_player_";
      // 转轨须在 playerFaction 改写之前算好：扣掉自立代价后的名声，按 1/10 折为新势力的起家威名
      const fameAfterCost = Math.max(0, Math.round((m.fame || 0) * 0.85));
      const seedFame = Math.round(fameAfterCost * Campaign.FAME_TO_FACTION_FAME);
      m.playerFaction = "_player_"; m.playerRank = this.RANKS.length; m.playerMerit = 0;
      FactionFame.set(m, "_player_", FactionFame.BASE_PER_CITY + seedFame);
      FactionOrders.set(m, "_player_", 3);
      // 势力金库自此与自选武将的私人钱包合一（见 FactionGold.get/set/add/spend 对 "_player_" 的转发），
      // 这里不再是"重置"一本新账，而是往你已有的钱袋里添一笔开国启动资金
      FactionGold.add(m, "_player_", 600);
      // 团队就此并入势力：自立之后不再有"我的团队"，队友即本势力武将（见 myRoster）——
      // 队友此前若在原势力挂有官位/封地/结义（generalFaction 平日不随入队变动，故旧职从未被清过），
      // 此刻转投你的新势力仍会原样带过来、白占你新势力的官位/封地席位，必须一并清空，
      // 往后由你的新势力（人事·封官）重新分封，规则与其他势力一致
      const joined = Bond.teamGenerals();
      joined.forEach(g => {
        m.generalFaction[g.id] = "_player_";
        Loyalty.set(m, g.id, 70 + (Bond.pts(g.id) / Bond.MAX_FRIEND) * 25);
        Loyalty.stripRewards(m, g.id);
      });
      Bond.data.team = []; Bond.save();
      // 举事之日，根基之城中与你交厚、或本就对旧主离心的旧部会跟着反了——
      // 否则新主公将光杆一人（城池易主而人心不动），既不合情理，也让自立后无人可用、寸步难行
      const followers = [];
      DB.list.forEach(g => {
        if (m.assign[g.id] !== m.curCity || !m.appeared.includes(g.id)) return;
        if (m.generalFaction[g.id] !== oldFid || isFactionLord(oldFid, g.id)) return;
        const bond = Bond.pts(g.id) / Bond.MAX_FRIEND;
        const disaffection = (100 - Loyalty.get(m, g.id)) / 100;
        if (Math.random() < Math.min(0.9, bond * 0.7 + disaffection * 0.5)) {
          m.generalFaction[g.id] = "_player_";
          Loyalty.set(m, g.id, 60 + bond * 30);
          Loyalty.stripRewards(m, g.id);
          followers.push(g.name);
        }
      });
      Campaign.recalcApMax();
      Campaign.save();
      toast(`⚔️ 你昭告天下，以【${cityName(m.curCity)}】为根基自立门户，另建「${m.playerOwnFaction.n}」！`
        + `${joined.length ? `旧日团队 ${joined.length} 人尽数编入麾下。` : ""}`
        + `${followers.length ? `城中 ${followers.length} 将随你举事（${followers.slice(0, 4).join("、")}${followers.length > 4 ? "…" : ""}）。` : ""}`
        + `自此个人名声化作本家威名（${FactionFame.get(m, "_player_")}）。与${oldDef.n}就此分道扬镳（并非永世为敌，${this.EX_LORD_COOLDOWN} 天后旧主怒气自然平息）。`);
      return true;
    },
    // 俸禄：官至参军/侍大将起每日随宿营自动入账（不再需手动领取），官越高俸禄越厚；自立门户后无处可支
    STIPEND_BY_RANK: [0, 0, 10, 20, 40, 80, 160, 320, 640],
    dailyStipend(m) {
      if (!m.playerFaction || m.playerFaction === "_player_") return "";
      const amt = this.STIPEND_BY_RANK[m.playerRank] || 0;
      if (!amt) return "";
      const gold = Bond.addGold(amt);
      return gold ? `💰 领取俸禄 ${gold} 金（${this.rankName(m)}）` : "";
    },
  };
  /* ============================================================
   *  忠诚度（军事三期）：武将对现效忠势力的忠诚 0~100，只对有势力者维护；月度随所属势力盛衰浮动
   *  （见 monthlyTick），过低则有小概率自行叛逃（转投他家或干脆归隐在野）。友谊则是玩家可主动经营
   *  的另一条线——友谊越深、对方忠诚越低，招揽/策反的成功率就越高，两套系统一攻一守。
   * ============================================================ */
  const Loyalty = {
    DEFAULT: 60,
    get(m, gid) { return (m.loyalty && m.loyalty[gid] != null) ? m.loyalty[gid] : this.DEFAULT; },
    set(m, gid, v) { if (!m.loyalty) m.loyalty = {}; m.loyalty[gid] = Math.max(0, Math.min(100, Math.round(v))); },
    // 招揽/策反成功率：友谊越深、对方忠诚越低、己方名声越高，越容易得手；忠诚满格几乎打动不了
    persuadeChance(m, gid) {
      const loy = this.get(m, gid);
      const fp = Bond.pts(gid);
      const fameBonus = Campaign.fameTierIndex(Campaign.effFame(m)) * 0.03;
      // 势力阻力：从如日中天的大家挖人，本就该比从残破小族处挖人难得多
      const fid = (m.generalFaction || {})[gid];
      const resist = fid ? (FactionFame.get(m, fid) / 8000) * 0.2 : 0;
      return Math.max(0.05, Math.min(0.85, 0.15 + (fp / Bond.MAX_FRIEND) * 0.35 + ((100 - loy) / 100) * 0.35 + fameBonus - resist));
    },
    // 招揽费用随目标身价浮动（评分×4，与 Bond.recruitCost 的评分×10 同一取值逻辑但打了六折——
    // 招揽走的是忠诚/友谊/名声的暗中运作，不像明面招募入队那样要价那么足）；固定 200 金此前对高评分
    // 名将而言形同白菜价，与其"总评分"毫无关系
    persuadeCost(gid) {
      const g = DB.get(gid);
      return g ? ratingScore(Armory.geared(g, gid)) * 4 : 800;
    },
    // 招揽成功：对方转投玩家现效力的势力（玩家在野则等同于策反其在野）；忠诚归零重算——新东家尚需时间收服人心
    persuade(m, gid) {
      const oldFid0 = m.generalFaction[gid];
      // 主公不可招揽（UI 已置灰，此处再兜一道，防止从其它入口绕过）——要一方之尊俯首，唯有灭其势力
      if (oldFid0 && isFactionLord(oldFid0, gid)) { toast(`「${DB.get(gid).name}」乃${factionName(oldFid0)}主公，岂是金帛可动——唯灭其势力，方能收其人`); return false; }
      const cost = this.persuadeCost(gid);
      if (!Bond.spend(cost)) { toast(`金币不足（招揽需 ${cost} 金）`); return false; }
      const g = DB.get(gid);
      const chance = this.persuadeChance(m, gid);
      if (Math.random() >= chance) { toast(`「${g.name}」不为所动，招揽未果（耗资 ${cost} 金，友谊不受影响）`); return false; }
      const oldFid = m.generalFaction[gid];
      const oldName = oldFid ? factionDef(oldFid).n : "在野";
      const newName = m.playerFaction ? factionDef(m.playerFaction).n : "在野";
      m.generalFaction[gid] = m.playerFaction;
      // 初始忠诚随交情深浅浮动：交情越厚，招来的人越稳（友谊满则 75，素昧平生仅 45）
      this.set(m, gid, m.playerFaction ? 45 + (Bond.pts(gid) / Bond.MAX_FRIEND) * 30 : 0);
      Campaign.save();
      toast(`🎉 招揽成功！「${g.name}」弃${oldName}，改投${newName}！`);
      return true;
    },
    /* ---- 忠诚软上限：忠诚不会无止境地爬升，而是逐月向一个由「待遇」决定的软上限收敛 ----
     * 不做任何笼络的武将，忠诚自然停在 55~65 一带；要把人推到 90 以上，非动用封官/封地/结义
     * 这三张「席位有限」的牌不可。全势力至多只能供养十来位死忠，其余人始终是可被撬动的软肋——
     * 挖墙脚因而永远有明确目标，也正是这一点让「不要都很容易到 100」得以成立。
     * 另：赏赐一律不用金币——金帛买来的是佣兵，不是人心。 */
    BASE_CAP: 55,
    POST_BONUS: { chief: 20, deputy: 15, aide: 10 },   // 要职三等：军师/都督/家老 → 参军/侍大将 → 掾属
    FIEF_BONUS: 15, SWORN_BONUS: 10,
    softCap(m, gid) {
      const fid = (m.generalFaction || {})[gid];
      if (!fid) return 0;
      if (isFactionLord(fid, gid)) return 100;   // 主公即势力本身，无所谓忠诚
      let cap = this.BASE_CAP;
      const post = (m.posts || {})[gid];
      if (post) cap += this.POST_BONUS[post] || 0;
      if (Object.values(m.fiefs || {}).includes(gid)) cap += this.FIEF_BONUS;
      if ((m.sworn || []).includes(gid)) cap += this.SWORN_BONUS;
      cap += (Bond.pts(gid) / Bond.MAX_FRIEND) * 10;          // 私交越厚，愿为你效死的上限越高
      const lord = factionLord(fid);
      const lordMei = lord ? Armory.geared(lord, lord.id).mei
        : (fid === "_player_" && RPG.char ? Armory.geared(RPG.heroGeneral(), "hero").mei : 60);
      cap += (lordMei - 60) / 4;                               // 主公魅力：刘备的部下天生难挖，董卓的部下人心涣散
      // 势力盛衰也并入软上限（而非另作一份逐月无界叠加的增量）——否则一家连年开疆拓土，
      // 其部众忠诚会一路飘到 100，"软上限"便形同虚设；限幅 ±15 使兴衰有感而不至于压倒封赏本身
      const f = factionDef(fid);
      const baseCities = f && f.cities ? Math.max(1, f.cities.length) : 1;
      cap += Math.max(-15, Math.min(15, (factionCityCount(m, fid) - baseCities) * 2));
      return Math.max(10, Math.min(100, Math.round(cap)));
    },
    // 势力盛衰 + 私交亲疏 共同驱动的月度忠诚变化：向软上限收敛，再叠加势力扩张/收缩与友谊修正；
    // 忠诚过低者有小概率叛逃——本国尚有他家可去便改换门庭，否则心灰意冷、干脆归隐在野
    monthlyTick(m) {
      const cityCounts = {};
      FACTIONS.forEach(f => { cityCounts[f.id] = factionCityCount(m, f.id); });
      if (m.playerFaction === "_player_") cityCounts["_player_"] = factionCityCount(m, "_player_");
      const defectors = [];
      Object.keys(m.generalFaction).forEach(gidStr => {
        const gid = +gidStr, fid = m.generalFaction[gid];
        if (!fid || !m.appeared.includes(gid)) return;
        if (isFactionLord(fid, gid)) { this.set(m, gid, 100); return; }
        const cur = this.get(m, gid);
        // ① 向软上限收敛（每月走完差额的四分之一）；势力盛衰已并入软上限本身，不再另加无界增量
        let delta = (this.softCap(m, gid) - cur) * 0.25;
        // ② 私交修正（方案 B）：同僚交情越厚越死心塌地；他家武将与你越交好，对其主公反而越离心——
        //    这正好与招揽公式（友谊高 + 忠诚低 = 易得手）串成一条完整策略链：先结交，再等其离心，最后一举招揽
        const bondRatio = Bond.pts(gid) / Bond.MAX_FRIEND;
        if (fid === m.playerFaction) delta += (bondRatio - 0.3) * 8;
        else delta -= (bondRatio - 0.3) * 6;
        delta += randInt(-4, 4);
        this.set(m, gid, cur + delta);
        // 叛意按**月初**的忠诚判定，而非收敛之后的值：受封者软上限高（+15），每月都会被拉回七十上下，
        // 若按收敛后的数值判断，则封地在手者永无叛变之虞，"封地是双刃剑"便成了一句空话。
        // 一整月的离心已然酿成，主公事后的抚慰救不回当下这一遭
        if (cur < 15 && Math.random() < 0.12) defectors.push({ gid, entry: cur });
      });
      const news = [];
      defectors.forEach(({ gid, entry }) => {
        const g = DB.get(gid);
        const oldFid = m.generalFaction[gid], oldDef = factionDef(oldFid);
        // 举城叛变：手握封地或身为守将者一旦离心到极处，走的时候会把城池一并带走——
        // 封地因而是一把双刃剑：能换来死忠，也可能赔上整座城。判定同样看**月初**忠诚（entry），
        // 而非主公事后抚慰过的数值
        const fiefCity = Object.keys(m.fiefs || {}).find(cid => m.fiefs[cid] === gid);
        const guardCity = Object.keys(m.guards || {}).find(cid => m.guards[cid] === gid);
        const heldCity = fiefCity || guardCity;
        const candidates = FACTIONS.filter(f => f.side === g.side && f.id !== oldFid && cityCounts[f.id] > 0);
        if (heldCity && entry < 10 && cityFactionId(m, heldCity) === oldFid) {
          const dest = candidates.length && Math.random() < 0.7 ? candidates[randInt(0, candidates.length - 1)] : null;
          const destFid = dest ? dest.id : null;
          Estate.accrue(m, heldCity);
          if (!m.cityFaction) m.cityFaction = {};
          if (destFid) {
            m.cityFaction[heldCity] = destFid;
            m.generalFaction[gid] = destFid;
            this.set(m, gid, 55);
          } else {
            // 无处可投便据城自立——此城暂归其本人，等同于一处无主割据（沿用原势力反而更怪）
            m.cityFaction[heldCity] = oldFid === "_player_" ? "_player_" : oldFid;
            m.generalFaction[gid] = null;
          }
          this.stripRewards(m, gid);
          if (m.guards) delete m.guards[heldCity];
          FactionFame.add(m, oldFid, -80);
          news.push(`🔥 <b>${g.name}</b> 举【${cityName(heldCity)}】叛离${oldDef.n}${destFid ? `，献城投奔${factionName(destFid)}` : "，弃官而去"}！`);
          return;
        }
        if (candidates.length && Math.random() < 0.6) {
          const dest = candidates[randInt(0, candidates.length - 1)];
          m.generalFaction[gid] = dest.id;
          this.set(m, gid, 50);
          this.stripRewards(m, gid);
          news.push(`${g.name} 弃 ${oldDef.n} 投奔 ${dest.n}`);
        } else {
          m.generalFaction[gid] = null;
          this.stripRewards(m, gid);
          news.push(`${g.name} 心灰意冷，弃官归隐，就此在野`);
        }
      });
      // 威名招贤：威名越盛，越有在野豪杰慕名来投——威名因而不只是"军令换算器"
      const ronin = DB.list.filter(g => !m.generalFaction[g.id] && m.appeared.includes(g.id));
      if (ronin.length) {
        const ranked = liveFactionIds(m).filter(fid => factionCityCount(m, fid) > 0)
          .sort((a, b) => FactionFame.get(m, b) - FactionFame.get(m, a)).slice(0, 5);
        ranked.forEach(fid => {
          const fame = FactionFame.get(m, fid);
          if (Math.random() >= Math.min(0.6, fame / 4000)) return;
          const pool = ronin.filter(g => g.side === factionDef(fid).side && !m.generalFaction[g.id]);
          if (!pool.length) return;
          const g = pool[randInt(0, pool.length - 1)];
          m.generalFaction[g.id] = fid;
          this.set(m, g.id, 55);
          news.push(`${g.name} 慕${factionName(fid)}威名，自请来投`);
        });
      }
      if (news.length) Campaign.save();
      return news;
    },
    // 改换门庭者，原主所授的官职/封地/结义之谊一并作废（结义只在同一势力内有效）
    stripRewards(m, gid) {
      if (m.posts) delete m.posts[gid];
      if (m.fiefs) Object.keys(m.fiefs).forEach(cid => { if (m.fiefs[cid] === gid) delete m.fiefs[cid]; });
      if (m.sworn) m.sworn = m.sworn.filter(id => id !== gid);
    },
    // 交情增进时，同势力同僚顺带涨一点忠诚（私交是笼络人心最朴素的一种方式）
    onBondGain(m, gid) {
      if (!m || !m.generalFaction) return;
      const fid = m.generalFaction[gid];
      if (fid && fid === m.playerFaction && !isFactionLord(fid, gid)) this.set(m, gid, this.get(m, gid) + randInt(1, 2));
    },
  };
  /* ============================================================
   *  守将委任（城市经营三期）：己方城市可委任一名友谊满上限、不在团队且未任掌柜的己方武将驻城死守——
   *  常驻不云游，边境战报模拟中必上阵且六维 +3（与城墙守备叠加）。城破之日守将被俘下狱（暂从天下
   *  名录中消失），亲至关押之城可付赎金或劫牢营救；己方夺回该城则牢门大开顺势放人。
   *  数据存战役层 m.guards（城→武将）与 m.captives（武将→关押地）。
   * ============================================================ */
  const Guard = {
    STAT_BONUS: 3,
    all(m) { if (!m.guards) m.guards = {}; return m.guards; },
    captives(m) { if (!m.captives) m.captives = {}; return m.captives; },
    of(m, cityId) { const gid = this.all(m)[cityId]; return gid != null ? DB.get(gid) : null; },
    ids(m) { return new Set(Object.values(this.all(m)).filter(v => v != null)); },
    // 守将人选：本势力麾下武将本就受你调遣，不该还要求友谊满格；非本势力者则仍须私交至深（友谊满上限）才肯为你守城
    eligible(m) {
      const taken = this.ids(m), managed = Estate.managerIds(m);
      return DB.list.filter(g => {
        if (!m.appeared.includes(g.id) || g.side !== RPG.char.side) return false;
        if (Bond.inTeam(g.id) || taken.has(g.id) || managed.has(g.id)) return false;
        const fid = (m.generalFaction || {})[g.id];
        if (fid && fid === m.playerFaction) return !isFactionLord(fid, g.id);   // 主公不受你差遣
        return Bond.pts(g.id) >= Bond.MAX_FRIEND;
      });
    },
    appoint(m, cityId, gid) {
      if (!isMyCity(m, cityId)) { toast(`只能在本势力城池委任守将`); return false; }
      this.all(m)[cityId] = gid;
      m.assign[gid] = cityId;   // 守将走马上任，常驻本城（不再随宿营云游）
      Campaign.save();
      const g = DB.get(gid);
      toast(`🛡️ ${g.name} 出任${cityName(cityId)}守将，誓与此城共存亡！`);
      return true;
    },
    dismiss(m, cityId) { delete this.all(m)[cityId]; Campaign.save(); },
    // 守将被招募入队后自动卸任（队伍随主角云游，无法再驻城）
    onRecruit(gid) {
      const m = typeof Campaign !== "undefined" && Campaign.mapState();
      if (!m) return;
      Object.keys(this.all(m)).forEach(cid => { if (this.all(m)[cid] === gid) delete this.all(m)[cid]; });
      Campaign.save();
    },
    ransom(g) { return ratingScore(g) * 5; },
    // 城破被俘：守将暂从天下名录中消失（身陷囹圄，不可拜访/委任/上阵），关押于陷落之城
    capture(m, cityId, loserSide) {
      const gid = this.all(m)[cityId];
      if (gid == null) return null;
      const g = DB.get(gid);
      if (!g || g.side !== loserSide) return null;
      delete this.all(m)[cityId];
      m.appeared = m.appeared.filter(id => id !== gid);
      this.captives(m)[gid] = { cityId, day: m.day };
      return g;
    },
    free(m, gid, note) {
      const cap = this.captives(m)[gid];
      if (!cap) return;
      delete this.captives(m)[gid];
      if (!m.appeared.includes(+gid)) m.appeared.push(+gid);
      m.assign[gid] = cap.cityId;
      Campaign.save();
      const g = DB.get(+gid);
      if (g) toast(`🔓 ${g.name} 重获自由${note || ""}`);
    },
    heldAt(m, cityId) {
      return Object.entries(this.captives(m)).filter(([, c]) => c.cityId === cityId)
        .map(([gid]) => DB.get(+gid)).filter(Boolean);
    },
  };
  /* ============================================================
   *  宿营夜报：天下一日之内发生的所有事，按类别分节全量播报（不再限条数）。
   *  卡片撑满可视高度、内部滚动；空的分节自动隐去；「本势力」永远排在第一屏，「警讯」用醒目色——
   *  势力系统上线后每日事件量陡增，若仍如旧版只挑三五条报，玩家会完全看不清天下在发生什么。
   * ============================================================ */
  const NIGHT_CATS = [
    { k: "mine", n: "🏯 本势力" },
    { k: "alert", n: "⚠️ 警讯" },
    { k: "war", n: "⚔️ 战报" },
    { k: "plot", n: "🕵️ 密报" },
    { k: "people", n: "🕊️ 人心" },
    { k: "move", n: "📯 动向" },
    { k: "grow", n: "📈 修行" },
    { k: "news", n: "⚡ 快报" },
  ];
  const NightReport = {
    items: [],
    reset() { this.items = []; },
    add(cat, text) { if (text) this.items.push({ cat, text }); },
    addAll(cat, arr) { (Array.isArray(arr) ? arr : [arr]).forEach(t => this.add(cat, t)); },
    count() { return this.items.length; },
    bodyHtml() {
      return NIGHT_CATS.map(c => {
        const list = this.items.filter(i => i.cat === c.k);
        if (!list.length) return "";
        return `<div class="nr-sect ${c.k}"><div class="nr-head">${c.n}<small>${list.length}</small></div>
          ${list.map(i => `<div class="nr-item">${i.text}</div>`).join("")}</div>`;
      }).join("");
    },
  };

  /* ============================================================
   *  封赏体系：主公笼络人心的四种手段——封官、封地、结义、庆功宴。
   *
   *  刻意**一概不用金币**：金帛买来的是佣兵，不是人心。四者全部消耗军令（势力的行动力），
   *  且前三者「席位有限」——官位数随城池增长、一城只能封一人、结义全势力至多三人。
   *  这正是「忠诚不会人人都轻易到 100」的机制保障：不做笼络的武将忠诚自然停在 55~65，
   *  要推到 90 以上必须动用有限的席位，全势力至多供养十余名死忠，其余人始终是可被撬动的软肋。
   *  玩家与 AI 主公共用这一套规则，故各家势力都会自然形成「死忠核心 + 离心外围」的结构。
   * ============================================================ */
  const Rewards = {
    POSTS: [
      { k: "chief", n: "军师", jn: "家老", cost: 2 },
      { k: "deputy", n: "都督", jn: "侍大将", cost: 2 },
      { k: "aide", n: "掾属", jn: "组头", cost: 2 },
    ],
    SWORN_MAX: 3, SWORN_BOND_MIN: 200,
    FEAST_ORDERS: 1, SWORN_ORDERS: 3,
    postName(k, side) { const p = this.POSTS.find(x => x.k === k); return p ? (side === "jp" ? p.jn : p.n) : ""; },
    // 官位席位数随疆域增长：⌊城池数/2⌋+1（每等各一席上限，合计即为可授官人数）
    postSlots(m, fid) { return Math.floor(factionCityCount(m, fid) / 2) + 1; },
    postsHeldBy(m, fid) {
      return Object.keys(m.posts || {}).filter(gid => (m.generalFaction || {})[gid] === fid).map(Number);
    },
    canGrantPost(m, fid) { return this.postsHeldBy(m, fid).length < this.postSlots(m, fid); },
    grantPost(m, fid, gid, kind) {
      if (!m.posts) m.posts = {};
      m.posts[gid] = kind;
      Loyalty.set(m, gid, Loyalty.get(m, gid) + randInt(4, 8));   // 授职当即感念，其后再逐月向新的软上限靠拢
    },
    fiefHolder(m, cityId) { return (m.fiefs || {})[cityId]; },
    freeFiefCities(m, fid) {
      return CITIES.filter(c => c.side !== "sea" && cityFactionId(m, c.id) === fid && !this.fiefHolder(m, c.id)).map(c => c.id);
    },
    grantFief(m, fid, cityId, gid) {
      if (!m.fiefs) m.fiefs = {};
      m.fiefs[cityId] = gid;
      Loyalty.set(m, gid, Loyalty.get(m, gid) + randInt(6, 10));
    },
    swornOf(m, fid) { return (m.sworn || []).filter(gid => (m.generalFaction || {})[gid] === fid); },
    canSworn(m, fid) { return this.swornOf(m, fid).length < this.SWORN_MAX; },
    addSworn(m, gid) {
      if (!m.sworn) m.sworn = [];
      if (!m.sworn.includes(gid)) m.sworn.push(gid);
      Loyalty.set(m, gid, Loyalty.get(m, gid) + randInt(8, 14));
    },
    // 庆功宴：一次性普涨，不动软上限——酒宴上的热络终究不如实打实的官爵封地
    feast(m, fid) {
      const gens = factionGenerals(m, fid, true).filter(g => !isFactionLord(fid, g.id));
      gens.forEach(g => Loyalty.set(m, g.id, Loyalty.get(m, g.id) + 3));
      return gens.length;
    },
    // 庆功宴不可无功随时开——须先打了胜仗攒下"庆功次数"才能办一场：边境大战/攻城得胜（applyBorderWarOutcome）、
    // 武将世界杯/武将大会夺冠或亚军均各积 1 次，用一次扣一次，见 openLordAction 的 feast 分支
    feastCharges(m) { return m.feastCharges || 0; },
    grantFeastCharge(m, n = 1, why) {
      m.feastCharges = (m.feastCharges || 0) + n;
      Campaign.save();
      if (why) toast(`🍶 ${why}，可办一场庆功宴了（现有 ${m.feastCharges} 次）`);
    },
  };

  /* ============================================================
   *  FactionAI：天下诸侯的日常行动引擎（势力系统的心脏）
   *
   *  取代并收编了此前各行其是的三个模块——AIDev（敌境自营，只管敌国城市发展）、
   *  WorldWar（天下战报，只管非玩家势力间的攻伐）、AIGear（敌将武备，只管敌国武将捡装备）。
   *  三者原本都以「国别」划分敌我，势力系统上线后这个前提已不成立：同国也有内战，异国也可能井水不犯河水。
   *
   *  统一后的规则：每日每家势力按「威名 → 军令」的额度行动，动作从下表中随机抽取，
   *  而动作的**战略质量**由该势力麾下已现身武将中对应维度前五名的均值决定（FactionTop5）——
   *  政治高则营建快、统帅高则募兵多、智力高则计谋准、魅力高则挖人狠、武统高则打得动。
   *  于是「麾下有什么人」第一次真正决定了「这家势力擅长做什么」，而不只是打仗时的一个战力数字。
   * ============================================================ */
  const FactionAI = {
    // 军令改为每日回满后，出征之外的耗军令动作不再受"军令不够攒不出手"的天然节制而更趋频密
    // （出征本身仍有 weary 冷休限制，故其效果无需削弱）——征兵/通商/计谋/封赏因而按此系数统一调低
    // 单次效果强度，以总量而非频次去补偿，避免国力/忠诚/民生数值被"回满"变相刷快了节奏。
    NON_WAR_DAMPEN: 0.8,
    // 动作表：耗军令 / 质量维度 / 权重
    ACTIONS: [
      { k: "build", orders: 1, dim: "zheng", w: 20 },
      { k: "recruit", orders: 1, dim: "tong", w: 20 },
      { k: "trade", orders: 1, dim: "zheng", w: 11 },
      { k: "gear", orders: 1, dim: "zheng", w: 9 },
      { k: "reward", orders: 2, dim: "mei", w: 10 },
      { k: "woo", orders: 2, dim: "mei", w: 11 },
      { k: "plot", orders: 2, dim: "zhi", w: 11 },
      { k: "war", orders: 3, dim: "wu", w: 20 },
    ],
    /* 计谋池：成功率与效果强度都取决于施谋方与目标方的智力前五均值之差。
       低阶三式（离间/烧粮/流言）人人可用；高阶三式（爆破/策反/诈降）须智力占优方可施展——
       智谋因此不只是"更容易成功"，而是解锁了另一档手段。 */
    PLOTS: [
      { k: "lijian", n: "离间", adv: 0, desc: "散布流言构陷，动摇其麾下人心" },
      { k: "shaoliang", n: "烧粮", adv: 0, desc: "夜袭粮道，焚其辎重" },
      { k: "liuyan", n: "流言", adv: 0, desc: "谤书遍传，折损其声望" },
      { k: "duandao", n: "断道", adv: 5, desc: "扼其商路，市面为之萧条" },
      { k: "baopo", n: "爆破", adv: 10, desc: "掘城埋药，毁其城防" },
      { k: "cefan", n: "策反", adv: 15, desc: "重金密使，策其大将来投" },
      { k: "zhaxiang", n: "诈降", adv: 15, desc: "遣诈降之士乱其军心，数日内难以兴兵" },
    ],
    // 与某势力接壤的敌对城池（用于出征/施计选目标）
    frontiers(m, fid) {
      const out = [];
      borderEdges(m).forEach(([a, b]) => {
        const fa = cityFactionId(m, a), fb = cityFactionId(m, b);
        if (fa === fid && isRealFaction(fb)) out.push({ from: a, to: b, foe: fb });
        if (fb === fid && isRealFaction(fa)) out.push({ from: b, to: a, foe: fa });
      });
      return out;
    },
    hostility(m, fa, fb) { return ((m.hostility || {})[fa] || {})[fb] || 0; },
    addHostility(m, fa, fb, n) {
      if (!m.hostility) m.hostility = {};
      if (!m.hostility[fa]) m.hostility[fa] = {};
      if (!m.hostility[fb]) m.hostility[fb] = {};
      m.hostility[fa][fb] = Math.max(0, Math.min(100, (m.hostility[fa][fb] || 0) + n));
      m.hostility[fb][fa] = Math.max(0, Math.min(100, (m.hostility[fb][fa] || 0) + n));
    },
    weary(m, fid) { return ((m.factionWeary || {})[fid] || 0) > m.day; },
    setWeary(m, fid, days) { if (!m.factionWeary) m.factionWeary = {}; m.factionWeary[fid] = m.day + days; },

    tick(m) {
      const news = { move: [], war: [], plot: [], people: [], mine: [], alert: [] };
      const isMine = fid => fid === m.playerFaction;
      // 记账：涉及玩家势力的动作要归到「本势力」，冲着玩家来的计谋/出征要归到「警讯」
      const push = (cat, fid, text, targetFid) => {
        if (isMine(fid)) news.mine.push(text);
        else if (targetFid && isMine(targetFid)) news.alert.push(text);
        else news[cat].push(text);
      };
      liveFactionIds(m).forEach(fid => {
        if (!factionCityCount(m, fid)) return;   // 已覆灭
        // 玩家自立后，本家的军令归玩家自己支配（出征/施计/封赏都要用），AI 不代为挥霍
        if (fid === "_player_") return;
        let budget = FactionOrders.get(m, fid);
        let guard = 0;
        while (budget > 0 && guard++ < 4) {
          // 从**完整**动作表抽签，而非只抽当前付得起的那几样：抽中的动作若付不起军令，
          // 本回合就此打住、把军令存下来——诸侯会为大事攒军令，不会因为凑不够出征就转头去修城墙。
          // （初版只在付得起的动作里抽签，导致 1 道军令的杂事总把预算耗光，3 道军令的出征几乎永无机会：
          //   200 天里全天下仅发动 48 次出征、天下版图几乎纹丝不动。）
          const total = this.ACTIONS.reduce((s, a) => s + a.w, 0);
          let roll = Math.random() * total, act = this.ACTIONS[0];
          for (const a of this.ACTIONS) { roll -= a.w; if (roll <= 0) { act = a; break; } }
          if (act.orders > budget) break;   // 攒着，留待来日
          const q = FactionTop5.top5(m, fid, act.dim);
          const done = this[act.k](m, fid, q, push);
          if (done === false) { budget -= 1; continue; }   // 无处可施展，白耗一道军令免得死循环
          budget -= act.orders;
        }
        FactionOrders.set(m, fid, Math.max(0, budget));
      });
      Campaign.save();
      return news;
    },

    /* ---- 营建：二十六期起繁荣度改为纯城建等级总和实时算出，这个动作原本"50%概率修城建，
     * 50%概率抽象经营给几点繁荣"的写法里，后一半已经没有意义（繁荣度不再能凭空加点）——
     * 改为始终挑一座本势力治下、还有城建未封顶的城市，直接升一级，花费按该级实际造价结算
     * （不再是与升到几级无关的固定300金），找不到可升的城市（六项全满）则本次动作落空 */
    build(m, fid, q, push) {
      const cities = CITIES.filter(c => c.side !== "sea" && cityFactionId(m, c.id) === fid).map(c => c.id)
        .filter(cid => cityBuildOptions(cid).some(t => Buildings.lv(m, cid, t) < Buildings.MAX_LV));
      if (!cities.length) return false;
      const cid = cities[randInt(0, cities.length - 1)];
      const opts = cityBuildOptions(cid).filter(t => Buildings.lv(m, cid, t) < Buildings.MAX_LV);
      const t = opts[randInt(0, opts.length - 1)];
      const curLv = Buildings.lv(m, cid, t);
      if (!FactionGold.spend(m, fid, Buildings.COSTS[curLv].gold)) return false;
      if (!Buildings.all(m)[cid]) Buildings.all(m)[cid] = {};
      Buildings.all(m)[cid][t] = curLv + 1;
      push("move", fid, `🏗️ ${factionName(fid)}于${cityName(cid)}修筑${BUILD_TYPES[t].n}至 ${curLv + 1} 级`);
      return true;
    },
    /* ---- 征兵：统帅越高，募得越多 ---- */
    recruit(m, fid, q, push) {
      const cities = CITIES.filter(c => c.side !== "sea" && cityFactionId(m, c.id) === fid
        && Garrison.get(m, c.id) < Garrison.cap(m, c.id)).map(c => c.id);
      if (!cities.length) return false;
      const cid = cities[randInt(0, cities.length - 1)];
      const room = Garrison.cap(m, cid) - Garrison.get(m, cid);
      const n = Math.min(room, Math.round(Garrison.cap(m, cid) * (0.08 + q / 500) * this.NON_WAR_DAMPEN));
      const cost = Math.round(n * Garrison.RECRUIT_GOLD_PER);
      if (!FactionGold.spend(m, fid, cost)) return false;
      Garrison.add(m, cid, n);
      push("move", fid, `🎖️ ${factionName(fid)}于${cityName(cid)}征募新兵 +${n.toLocaleString()}（现有 ${Garrison.get(m, cid).toLocaleString()}）`);
      return true;
    },
    /* ---- 通商：政治越高，进项越丰，并小幅涨威名 ---- */
    trade(m, fid, q, push) {
      const gain = Math.round((200 + q * 8) * (0.8 + Math.random() * 0.5) * this.NON_WAR_DAMPEN);
      FactionGold.add(m, fid, gain);
      FactionFame.add(m, fid, 2);
      push("move", fid, `💰 ${factionName(fid)}通商往来，府库进账 ${gain.toLocaleString()} 金`);
      return true;
    },
    /* ---- 购置武备：势力出钱为麾下武将添置宝物（取代旧 AIGear 的"凭空捡装备"） ---- */
    gear(m, fid, q, push) {
      const pool = factionGenerals(m, fid, true);
      if (!pool.length) return false;
      const cost = 1500;
      if (!FactionGold.spend(m, fid, cost)) return false;
      const g = pool[randInt(0, pool.length - 1)];
      const typeK = Armory.TYPES[randInt(0, Armory.TYPES.length - 1)].k;
      const item = Armory.makeItem(typeK, Armory.rollRarity(false));
      if (Armory.npcAutoEquip(g.id, item)) {
        push("move", fid, `🗡️ ${factionName(fid)}为 ${g.name} 置办${item.icon}「${item.name}」（${Armory.rarityDef(item.rarity).n}）`);
        return true;
      }
      return true;
    },
    /* ---- 招揽：魅力越高越能挖动人心；优先挑忠诚低的下手 ---- */
    woo(m, fid, q, push) {
      const def = factionDef(fid);
      // 诸侯征辟：若玩家尚在野，各家也会遣使来聘——名声越显赫，来聘者越显赫。
      // 在野由此从"没人管你"变成"待价而沽"，是这条身份线上很值得玩味的一段
      if (!m.playerFaction && def.side === RPG.char.side && !PlayerRank.exLordHostile(m, fid)
        && Campaign.fameTierIndex(Campaign.effFame(m)) >= 2 && Math.random() < 0.22) {
        m.pendingCourt = { fid, day: m.day };
        push("alert", fid, `📜 <b>${factionName(fid)}</b>遣使来聘，欲请你出仕（主公 · ${def.lord}）——可于「🏯 身份」中答复。`);
        return true;
      }
      const targets = DB.list.filter(g => {
        const tf = (m.generalFaction || {})[g.id];
        if (tf === fid) return false;
        if (g.side !== def.side) return false;            // 跨国挖人不合本作立意
        if (tf && isFactionLord(tf, g.id)) return false;  // 主公不可招揽
        return m.appeared.includes(g.id) && (!tf || Loyalty.get(m, g.id) < 55);
      });
      if (!targets.length) return false;
      targets.sort((a, b) => {
        const la = (m.generalFaction || {})[a.id] ? Loyalty.get(m, a.id) : 0;
        const lb = (m.generalFaction || {})[b.id] ? Loyalty.get(m, b.id) : 0;
        return la - lb;
      });
      const g = targets[randInt(0, Math.min(4, targets.length - 1))];
      const oldFid = (m.generalFaction || {})[g.id];
      const loy = oldFid ? Loyalty.get(m, g.id) : 0;
      // 玩家麾下的人被挖时，私交是最后一道防线——这也让"平日结交"有了防守价值
      const bondShield = oldFid === m.playerFaction ? (Bond.pts(g.id) / Bond.MAX_FRIEND) * 0.35 : 0;
      const chance = Math.max(0.05, Math.min(0.7, 0.1 + q / 300 + (100 - loy) / 400 - bondShield));
      if (Math.random() >= chance) return true;
      m.generalFaction[g.id] = fid;
      Loyalty.stripRewards(m, g.id);
      Loyalty.set(m, g.id, 50);
      push("people", fid, `🎁 ${factionName(fid)}以厚礼延揽，${g.name} ${oldFid ? `弃${factionName(oldFid)}` : "自在野"}来投`, oldFid);
      return true;
    },
    /* ---- 封赏：AI 主公按评分高低把有限的官位/封地授予麾下重臣，
           于是每家势力都自然长出「死忠核心 + 离心外围」的结构——玩家挖墙脚因而永远有明确的下手处 ---- */
    reward(m, fid, q, push) {
      const side = factionDef(fid).side;
      const gens = factionGenerals(m, fid, true).filter(g => !isFactionLord(fid, g.id));
      if (!gens.length) return false;
      gens.sort((a, b) => ratingScore(Armory.geared(b, b.id)) - ratingScore(Armory.geared(a, a.id)));
      // ① 优先补满官位
      if (Rewards.canGrantPost(m, fid)) {
        const cand = gens.find(g => !(m.posts || {})[g.id]);
        if (cand) {
          const held = Rewards.postsHeldBy(m, fid).length;
          const kind = Rewards.POSTS[Math.min(held, Rewards.POSTS.length - 1)].k;
          Rewards.grantPost(m, fid, cand.id, kind);
          push("people", fid, `🎖️ ${factionName(fid)}拜 ${cand.name} 为${Rewards.postName(kind, side)}`);
          return true;
        }
      }
      // ② 再论封地
      const free = Rewards.freeFiefCities(m, fid);
      if (free.length) {
        const cand = gens.find(g => !Object.values(m.fiefs || {}).includes(g.id));
        if (cand) {
          const cid = free[randInt(0, free.length - 1)];
          Rewards.grantFief(m, fid, cid, cand.id);
          push("people", fid, `🏯 ${factionName(fid)}以${cityName(cid)}封赏 ${cand.name} 为食邑`);
          return true;
        }
      }
      // ③ 官爵封地皆已授尽，便设宴犒军
      const n = Rewards.feast(m, fid);
      if (!n) return false;
      push("people", fid, `🍶 ${factionName(fid)}大宴群臣，麾下 ${n} 将同沐恩泽（忠诚小涨）`);
      return true;
    },
    /* ---- 计谋：智力差决定能施何等手段、以及成败与效果强度 ----
       AI 随机施法与玩家亲自点选（见 MapUI.openPlot）共用同一套结算核心 resolvePlot，
       前者自动挑目标与计谋种类，后者由玩家决定打谁、使哪一式，胜负判定与七式效果完全一致 */
    plot(m, fid, q, push) {
      const fr = this.frontiers(m, fid);
      if (!fr.length) return false;
      // 敌对度越高越优先下手——攻伐因而显出恩怨脉络，不是纯随机
      fr.sort((x, y) => this.hostility(m, fid, y.foe) - this.hostility(m, fid, x.foe));
      const pick = fr[randInt(0, Math.min(2, fr.length - 1))];
      const foe = pick.foe, foeQ = FactionTop5.top5(m, foe, "zhi");
      const adv = q - foeQ;
      const usable = this.PLOTS.filter(p => adv >= p.adv);
      if (!usable.length) return true;
      const plotKey = usable[randInt(0, usable.length - 1)].k;
      this.resolvePlot(m, fid, foe, pick, plotKey, q, push);
      return true;
    },
    // 判定成败并施展七式之一的效果，返回是否得手。pick={from,to,foe} 描述哪条边境线、target 城池是哪座
    resolvePlot(m, fid, foe, pick, plotKey, q, push) {
      const foeQ = FactionTop5.top5(m, foe, "zhi");
      const adv = q - foeQ;
      const plot = this.PLOTS.find(p => p.k === plotKey);
      const chance = Math.max(0.15, Math.min(0.85, 0.4 + adv / 100));
      if (Math.random() >= chance) {
        push("plot", fid, `🕵️ ${factionName(fid)}对${factionName(foe)}施「${plot.n}」之计，为其识破，无功而返`, foe);
        return false;
      }
      const strength = (1 + Math.max(0, adv) / 40) * this.NON_WAR_DAMPEN;   // 智力差越大，效果越猛
      let detail = "";
      switch (plot.k) {
        case "lijian": {
          const pool = factionGenerals(m, foe, true).filter(g => !isFactionLord(foe, g.id));
          if (!pool.length) { detail = "然其麾下无人可间"; break; }
          const n = Math.min(pool.length, 1 + Math.floor(Math.random() * (adv >= 20 ? 3 : 2)));
          shuffle(pool);
          const hit = pool.slice(0, n);
          hit.forEach(g => Loyalty.set(m, g.id, Loyalty.get(m, g.id) - Math.round(randInt(8, 20) * strength)));
          detail = `${hit.map(g => g.name).join("、")} 心生嫌隙（忠诚受挫）`;
          break;
        }
        case "shaoliang": {
          const cur = Garrison.get(m, pick.to);
          const loss = Math.round(cur * (0.10 + Math.random() * 0.15) * strength);
          Garrison.set(m, pick.to, Math.max(0, cur - loss));
          detail = `${cityName(pick.to)}辎重被焚，折兵 ${loss.toLocaleString()}`;
          break;
        }
        case "liuyan": {
          const drop = Math.round(randInt(5, 20) * strength);
          FactionFame.add(m, foe, -drop);
          detail = `${factionName(foe)}声望受损（威名 -${drop}）`;
          break;
        }
        case "duandao": {
          // 二十六期：繁荣度改由城建等级实时算出，不再能凭空扣点——商路断绝改为直接冲击人口
          // （行商与工匠出走），比照攻城破城的战争损耗温和不少（那是真刀真枪，这只是断粮道）
          Population.set(m, pick.to, Math.round(Population.get(m, pick.to) * 0.9));
          FactionGold.spend(m, foe, Math.round(FactionGold.get(m, foe) * 0.1));
          detail = `${cityName(pick.to)}商路断绝，市面萧条`;
          break;
        }
        case "baopo": {
          const lv = Buildings.lv(m, pick.to, "wall");
          if (lv <= 0) { detail = `${cityName(pick.to)}本无城墙可毁`; break; }
          Buildings.all(m)[pick.to].wall = lv - 1;
          detail = `${cityName(pick.to)}城墙被掘塌一级（现 ${lv - 1} 级）`;
          break;
        }
        case "cefan": {
          const pool = factionGenerals(m, foe, true)
            .filter(g => !isFactionLord(foe, g.id) && Loyalty.get(m, g.id) < 30 && !(m.sworn || []).includes(g.id));
          if (!pool.length) { detail = "然其麾下并无离心之人可用"; break; }
          const g = pool[randInt(0, pool.length - 1)];
          m.generalFaction[g.id] = fid;
          Loyalty.stripRewards(m, g.id);
          Loyalty.set(m, g.id, 50);
          detail = `${g.name} 阵前反戈，改投${factionName(fid)}`;
          break;
        }
        case "zhaxiang": {
          this.setWeary(m, foe, 3 + Math.round(2 * strength));
          detail = `${factionName(foe)}军心大乱，数日内无力兴兵`;
          break;
        }
      }
      FactionFame.add(m, fid, FactionFame.PLOT_WIN);
      FactionFame.add(m, foe, FactionFame.PLOT_HIT);
      this.addHostility(m, fid, foe, 12);
      push("plot", fid, `🕵️ ${factionName(fid)}对${factionName(foe)}施「${plot.n}」之计得手——${detail}`, foe);
      return true;
    },
    /* ---- 出征：与玩家势力相关的边境交由正式的野战→攻城流程处理，此处只推演他家之间的攻伐 ----
       攻守数值经 200 天推演反复校准：守方保留城墙与一点固守之利（攻城本就难于野战），
       但不能大到让攻方永无胜算——初版曾给守方 +260 的固定加成，结果 200 天里天下版图几乎纹丝不动。
       随机项也放宽到 ±350，使强弱悬殊之外仍有爆冷余地，天下走势不至于沦为算术题。 */
    // 边境战出阵比例（非玩家亲自坐镇的一方，含"声援他国内战"与玩家全然不介入两种情形）：
    // 按己方武力评价相对敌方统率评价的优劣、以及双方积怨深浅推算敢出多少家底——
    // 优势越大、宿怨越深，越敢倾巢而出；均势或劣势则多留三分谨慎固守，全程无随机项，
    // 同等局面归同一个答案，不再是"一律 7 成"这种不问敌我强弱的死数字
    commitRatio(m, fid, foeFid) {
      const edge = FactionTop5.top5(m, fid, "wu") - FactionTop5.top5(m, foeFid, "tong");
      const hostile = this.hostility(m, fid, foeFid);
      return Math.max(0.45, Math.min(0.85, 0.62 + edge / 220 + hostile / 500));
    },
    warStrength(m, fid, from) { return FactionTop5.top5(m, fid, "wu") * 12 + Garrison.get(m, from) / 40; },
    defStrength(m, foe, to) {
      return FactionTop5.top5(m, foe, "tong") * 12 + Garrison.get(m, to) / 40 + Buildings.lv(m, to, "wall") * 160 + 60;
    },
    war(m, fid, q, push) {
      if (this.weary(m, fid)) return false;
      const fr = this.frontiers(m, fid).filter(f => f.foe !== m.playerFaction && fid !== m.playerFaction);
      if (!fr.length) return false;
      // 择弱而噬、挟怨而攻：按「己方胜算 + 宿怨」排序挑目标——真正的诸侯会试探虚实，而非闭眼开战
      fr.forEach(f => { f._score = (this.warStrength(m, fid, f.from) - this.defStrength(m, f.foe, f.to)) + this.hostility(m, fid, f.foe) * 4; });
      fr.sort((x, y) => y._score - x._score);
      const pick = fr[randInt(0, Math.min(1, fr.length - 1))];
      const foe = pick.foe;
      const atk = this.warStrength(m, fid, pick.from) + randInt(-350, 350);
      const def = this.defStrength(m, foe, pick.to) + randInt(-350, 350);
      this.addHostility(m, fid, foe, 8);
      if (atk <= def) {
        const loss = Math.round(Garrison.get(m, pick.from) * 0.18);
        Garrison.set(m, pick.from, Math.max(0, Garrison.get(m, pick.from) - loss));
        this.setWeary(m, fid, 2);
        push("war", fid, `⚔️ ${factionName(fid)}攻${cityName(pick.to)}未克，折兵 ${loss.toLocaleString()} 退去`, foe);
        return true;
      }
      Estate.accrue(m, pick.to);
      if (!m.cityFaction) m.cityFaction = {};
      m.cityFaction[pick.to] = fid;
      Garrison.set(m, pick.to, Math.round(Garrison.get(m, pick.from) * 0.3));
      Garrison.set(m, pick.from, Math.round(Garrison.get(m, pick.from) * 0.5));
      FactionFame.add(m, fid, FactionFame.CAPTURE);
      FactionFame.add(m, foe, FactionFame.LOSE);
      this.setWeary(m, fid, 4);   // 夺城后须休整，防止一家连克数城滚雪球
      // 败方原驻此城的武将退往己方相邻城池
      const managed = Estate.managerIds(m);
      DB.list.filter(g => m.assign[g.id] === pick.to && (m.generalFaction || {})[g.id] === foe && !managed.has(g.id))
        .forEach(g => {
          const opts = adjCities(pick.to).filter(id => cityFactionId(m, id) === foe);
          if (opts.length) m.assign[g.id] = opts[randInt(0, opts.length - 1)];
        });
      const extinctNow = !factionCityCount(m, foe);
      push("war", fid, `⚔️ ${factionName(fid)}攻陷${cityName(pick.to)}，${factionName(foe)}${extinctNow ? "就此覆灭" : "退守余部"}`, foe);
      if (extinctNow) { const msg = this.onExtinct(m, foe, fid); if (msg) push("people", fid, msg, foe); }
      return true;
    },
    /* ---- 势力覆灭善后：麾下武将尽数转为在野（而非效忠一个已不存在的势力），任天下各方延揽 ---- */
    // 势力覆灭善后：旧部不会凭空消失——一部分（35%）就地归降灭之者，其余心灰意冷散入民间转为在野，
    // 任天下各方竞相延揽。不再一概判其"流散在野"，更近乎史实（败军之将，或降或走，鲜有真正凭空蒸发者）。
    // winnerFid 缺省（如老档兼容路径）时全员转在野。返回一段播报文字，由调用方自行决定投递到夜报还是 toast——
    // 本函数可能在 camp() 的夜报周期内（FactionAI.war）触发，也可能在玩家随时发起的出征（applyBorderWarOutcome）中触发。
    SURRENDER_CHANCE: 0.35,
    onExtinct(m, fid, winnerFid) {
      const orphans = factionGenerals(m, fid, false);
      let surrendered = 0;
      orphans.forEach(g => {
        Loyalty.stripRewards(m, g.id);
        if (winnerFid && isRealFaction(winnerFid) && winnerFid !== fid && Math.random() < this.SURRENDER_CHANCE) {
          m.generalFaction[g.id] = winnerFid;
          Loyalty.set(m, g.id, 45);   // 新附之人，忠诚从半信半疑起算
          surrendered++;
        } else {
          m.generalFaction[g.id] = null;
          if (m.loyalty) delete m.loyalty[g.id];
        }
      });
      const scattered = orphans.length - surrendered;
      const named = orphans.filter(g => m.appeared.includes(g.id)).slice(0, 6).map(g => g.name).join("、");
      let msg = "";
      if (orphans.length) {
        msg = `🕊️ ${factionName(fid)}既灭——${surrendered ? `${surrendered} 人归降${factionName(winnerFid)}，` : ""}${scattered} 人心灰意冷，散入民间转投在野${named ? `（${named}…）` : ""}`;
      }
      // 玩家所属势力覆灭：自动转为在野，保留"故臣"身份记忆，名声受一次打击
      if (fid === m.playerFaction) {
        const wasLord = fid === "_player_";
        m.playerFaction = null; m.playerRank = 0; m.playerMerit = 0; m.playerFief = null;
        m.fame = wasLord ? 0 : Math.max(0, Math.round((m.fame || 0) * 0.8));   // 自立的基业尽丧，声名归零；仕官期覆灭则折八成
        Campaign.recalcApMax();
        msg = (msg ? msg + "；" : "") + `💔 你所效力的${factionName(fid)}已然覆灭——自此你重归在野之身，名声亦受牵累。天下之大，何处不可去得。`;
      }
      return msg;
    },
  };
  /* 全员武将成长（岁月修行 + 历战成长）：所有已现身武将都会随时间与战事缓慢变强——
     · 岁月修行（tick，每次宿营）：随机抽 3 人闭关修行，评分越低成长概率越高（追赶机制），随机一维 +1，动向并入宿营夜报；
     · 历战成长（battle，逢战结算）：参战的真实武将胜负各有小概率武力/统帅/体力随机一项 +1（胜者概率加倍）；
     两者均写入战役层 m.statGrowth（经 Armory.geared 全局生效、新开局重置、不污染武将图鉴），
     累计不设上限，但单项「不带宝物」的数值（基础+成长）不得超过 110 */
  const Growth = {
    CAP: 110, TRAIN_PICKS: 3, WIN_CHANCE: 0.12, LOSE_CHANCE: 0.06,
    bump(m, gid, dim) {
      const g = DB.get(gid); if (!g) return "";
      if (!m.statGrowth) m.statGrowth = {};
      const gr = m.statGrowth[gid] || (m.statGrowth[gid] = { ti: 0, wu: 0, tong: 0, zhi: 0, zheng: 0, mei: 0 });
      if ((g[dim[0]] || 0) + gr[dim[0]] >= this.CAP) return "";   // 基础+成长封顶 110，仅宝物加成可再往上叠
      gr[dim[0]]++;
      Campaign.save();
      return dim[1];
    },
    // 岁月修行：宿营时随机抽 TRAIN_PICKS 人（可重复抽中即多修一维），评分越低成长概率越高
    tick(m) {
      const pool = DB.list.filter(g => m.appeared.includes(g.id));
      if (!pool.length) return "";
      const news = [];
      for (let i = 0; i < this.TRAIN_PICKS; i++) {
        const g = pool[randInt(0, pool.length - 1)];
        const chance = Math.max(0.1, Math.min(0.5, (750 - ratingScore(g)) / 500));
        if (Math.random() >= chance) continue;
        const dim = DIMS[randInt(0, DIMS.length - 1)];
        if (this.bump(m, g.id, dim)) news.push(`${g.name}${this.verb(dim[0])}，${dim[1]} +1`);
      }
      return news;
    },
    verb(k) { return k === "wu" || k === "ti" ? "勤练武艺" : k === "tong" ? "操演兵马" : k === "zhi" ? "研读兵书" : k === "zheng" ? "研习政略" : "广交名士"; },
    // 历战成长：单场战斗的真实武将参与者（主角除外，其走经验升级），胜 12%/败 6% 概率战斗三维随机一项 +1
    battle(m, g, won) {
      if (!m || !g || g.id == null || g.id < 0) return "";
      if (Math.random() >= (won ? this.WIN_CHANCE : this.LOSE_CHANCE)) return "";
      const pool = [DIMS[1], DIMS[2], DIMS[0]];   // 武力/统帅/体力
      const dim = pool[randInt(0, pool.length - 1)];
      const label = this.bump(m, g.id, dim);
      return label ? `<br>📈 ${g.name} 历战砥砺，${label} <b style="color:var(--cn-red)">+1</b>` : "";
    },
  };
  /* ============================================================
   *  宿敌（天命之敌）：主角首次败于某位敌方阵营武将（刺杀反被所伤/宿营夜袭落败/边境战亲历落败等
   *  任一场敌我对决）即与其结下宿敌之约（若久未败绩，名声达「声名初显」后每次宿营亦有小概率随缘指定）。
   *  宿敌战力随主角等级、双方交手次数动态增强（战斗时临时结算，不写入其真实数据）；每隔数日可能主动
   *  寻衅——拦路挑战 / 抢先领走本城一条悬赏 / 宿营踏营下战书。累计击败三次触发「恩怨了结」终局对决，
   *  胜后获传说奇珍与大量名声；此后宿敌名号仍存，但不再主动寻衅。数据存战役层 m.nemesis。
   * ============================================================ */
  const Nemesis = {
    FINALE_WINS: 3,          // 累计击败宿敌三次触发终局了结
    EVENT_CHANCE: 0.15,      // 每次宿营触发一次主动寻衅事件的概率（宿敌存在且终局未了结时）
    FALLBACK_FAME_TIER: 3,   // 兜底指定所需名声阶梯（声名初显）
    FALLBACK_CHANCE: 0.08,   // 兜底指定：达标后每次宿营的随缘概率
    state(m) { return m.nemesis || null; },
    name(m) { const st = this.state(m); const g = st && DB.get(st.id); return g ? g.name : "？"; },
    candidate(m) {
      const pool = DB.list.filter(g => g.side !== RPG.char.side && m.appeared.includes(g.id));
      return pool.length ? pool[randInt(0, pool.length - 1)] : null;
    },
    assign(m, gid, silent) {
      m.nemesis = { id: gid, wins: 0, nemesisWins: 0, ambush: false, finaleDone: false };
      Campaign.save();
      if (!silent) toast(`⚔️ 你与【${DB.get(gid).name}】结下宿敌之约！从此天涯海角，终有一战。`);
    },
    // 首次败于敌方阵营武将：立即结为宿敌（若尚无未了结的宿敌）；
    // 旧宿敌恩怨已了后再败于新的敌将，即翻开新的一页宿怨（不与刚了结的旧宿敌原地续约）
    onHeroLoss(m, opp) {
      if (!m || !opp || opp.side === RPG.char.side || opp.id < 0) return;
      if (m.nemesis && (!m.nemesis.finaleDone || m.nemesis.id === opp.id)) return;
      this.assign(m, opp.id);
    },
    // 兜底：迟迟未与敌将交手落败（或旧怨已了后久无新怨），名声已达「声名初显」时随游历时间随缘指定一位
    ensureFallback(m) {
      if (m.nemesis && !m.nemesis.finaleDone) return;
      if (Campaign.fameTierIndex(Campaign.effFame(m)) < this.FALLBACK_FAME_TIER) return;
      if (Math.random() >= this.FALLBACK_CHANCE) return;
      const oldId = m.nemesis ? m.nemesis.id : null;
      const pool = DB.list.filter(g => g.side !== RPG.char.side && m.appeared.includes(g.id) && g.id !== oldId);
      if (pool.length) this.assign(m, pool[randInt(0, pool.length - 1)].id);
    },
    // 宿敌当前战力：在其真实数据（含装备）基础上，按主角等级与历次交手战绩临时叠加六维——
    // 只在本场战斗中生效，不写入 statGrowth，不污染其在武将图鉴/其他玩法中的数值
    buffedOpponent(m) {
      const st = this.state(m); if (!st) return null;
      const base = DB.get(st.id); if (!base) return null;
      const gg = Armory.geared(base, base.id);
      const boost = Math.min(25, Math.max(0, Math.round((RPG.char.level - 1) * 0.6) + st.wins * 2));
      if (!boost) return gg;
      const gg2 = clone(gg);
      DIMS.forEach(([k]) => { gg2[k] += boost; });
      return gg2;
    },
    // 发起一场宿敌单挑：置位 m.activeNemesis 供 RPG.onBattleEnd 识别结算通道
    duel(m) {
      const opp = this.buffedOpponent(m); if (!opp) return;
      m.activeNemesis = true; Campaign.save();
      startClassicBattle(RPG.heroGeneral(), opp, false, true);
    },
    // 宿营主动寻衅：三选一——拦路挑战（下次移动触发）/ 抢先领走本城一条悬赏 / 当场踏营下战书
    campEvent(m) {
      this.ensureFallback(m);
      const st = this.state(m);
      if (!st || st.finaleDone) return "";
      if (Math.random() >= this.EVENT_CHANCE) return "";
      const roll = Math.random();
      const nm = this.name(m);
      if (roll < 0.34) {
        st.ambush = true; Campaign.save();
        return `⚔️ 宿敌风闻：【${nm}】似已察觉你的行踪，扬言拦路挑战——下次移动多加小心。`;
      }
      if (roll < 0.67) {
        const list = m.bounties && m.bounties[m.curCity];
        if (list && list.length) {
          const idx = randInt(0, list.length - 1);
          list[idx] = genBounty(m.curCity, m.assign, m.appeared, RPG.char.side);
          Campaign.save();
          return `⚔️ 宿敌风闻：【${nm}】抢先领走本城一条悬赏，扬长而去，榜单已为之一新。`;
        }
        return "";
      }
      m.nemesisChallenge = true; Campaign.save();
      return `⚔️ 宿敌【${nm}】踏营叫阵！`;
    },
    // 宿营时若下了战书，camp() 流程结束后弹出应战确认（接管本次宿营后续流程）
    checkCampChallenge(m) {
      if (!m.nemesisChallenge) return false;
      m.nemesisChallenge = false; Campaign.save();
      const nm = this.name(m);
      openOverlay(`<div class="result-card">
        <h1>⚔️ 宿敌踏营</h1>
        <div class="wname">${nm}</div>
        <div class="wdesc">【${nm}】率众踏营叫阵，摆明了不死不休！唯有应战。</div>
        <div class="btns"><button class="btn-primary" id="nem-fight">应战</button></div>
      </div>`, { modal: true });
      $("#nem-fight").onclick = () => { closeOverlay(); this.duel(m); };
      return true;
    },
  };
  // 集市折扣：对马岛黑市常驻八折；行脚商队奇遇触发后临时持续至 discountUntilDay
  function shopDiscountActive() {
    const m = typeof Campaign !== "undefined" && Campaign.mapState();
    if (!m) return false;
    return m.curCity === "tsushima" || (m.discountUntilDay && m.day <= m.discountUntilDay);
  }
  // 各城行情系数：对马岛黑市固定八折，其余按城名哈希稳定落在 0.90~1.20 作为「底价」——低价城可"淘货"，
  // 高价城慎买；每月初一（见 rollMarketTrends）城市有较大概率叠加一段本月行情事件，在底价上再打一层折扣/溢价，
  // 让集市不再是一成不变的静态数字，跑商淘货这件事本身也随月份起伏更有玩味
  function cityPriceFactor(cityId) {
    if (cityId === "tsushima") return 0.8;
    const base = 0.9 + (hashStr(cityId) % 31) / 100;
    const m = typeof Campaign !== "undefined" && Campaign.mapState();
    const trend = m && m.marketTrend && m.marketTrend[cityId];
    return trend ? Math.max(0.5, base * trend.mul) : base;
  }
  // 月度行情事件：甩卖（降价走量）/ 平稳（不叠加）/ 抢购（涨价）/ 商旅云集（小幅降价，行商扎堆压价）——
  // 四选一，乘区分别在底价上再打折/加价，与 cityPriceFactor 的哈希底价相乘得到当月实际行情
  const MARKET_TRENDS = {
    crash: { icon: "📉", label: "甩卖", mulRange: [0.7, 0.8] },
    boom: { icon: "📈", label: "抢购", mulRange: [1.2, 1.35] },
    glut: { icon: "🈹", label: "商旅云集", mulRange: [0.85, 0.95] },
  };
  // 每月初一判定：每座城（对马岛黑市固定八折，不参与）各自独立 45% 概率触发一段本月行情事件，
  // 未触发或本月已到期的城市恢复平稳（即从 m.marketTrend 移除，退回哈希底价）——返回本轮实际变动的城市列表，
  // 供 camp() 写进宿营夜报
  function rollMarketTrends(m) {
    if (!m.marketTrend) m.marketTrend = {};
    const changed = [];
    CITIES.filter(c => c.side !== "sea" && c.id !== "tsushima").forEach(c => {
      if (Math.random() >= 0.45) { delete m.marketTrend[c.id]; return; }
      const keys = Object.keys(MARKET_TRENDS);
      const key = keys[randInt(0, keys.length - 1)];
      const t = MARKET_TRENDS[key];
      const mul = t.mulRange[0] + Math.random() * (t.mulRange[1] - t.mulRange[0]);
      m.marketTrend[c.id] = { key, mul: +mul.toFixed(3) };
      changed.push({ cityId: c.id, key });
    });
    return changed;
  }
  // 供各处「集市」相关文案拼接一段本月行情事件标签（无事件则返回空串）
  function marketTrendSuffix(m, cityId) {
    const trend = m && m.marketTrend && m.marketTrend[cityId];
    if (!trend) return "";
    const t = MARKET_TRENDS[trend.key];
    return t ? `·本月${t.icon}${t.label}` : "";
  }
  // 简易可复现随机序列：城市集市货摊按 (城市, 游戏天数, 本局种子) 生成，宿营跨天即换新货
  function seededRand(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function cityMarketStalls(m) {
    const rnd = seededRand(hashStr(m.curCity + "|" + m.day + "|" + ((Campaign.meta && Campaign.meta.createdAt) || 0)));
    // 名声达「略有耳闻」（第 1 阶）起，声名远播招来更多行商，货摊数 4→5；城市繁荣 ≥4 星再 +1 摊
    const n = (Campaign.fameTierIndex(Campaign.effFame(m)) >= 1 ? 5 : 4) + (Prosper.lv(m, m.curCity) >= 4 ? 1 : 0);
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
  // 整数雪崩混合（murmur3 finalizer 手法）：hashStr 对"前缀相同、末尾数字逐日递增"的字符串（如
  // "estate|chengdu|9" 与 "estate|chengdu|10"）只会在末位产生极小的差值，直接拿去做 seededRand 的种子，
  // LCG 输出会随天数近乎线性缓慢爬升，长期看不出"随机"的样子、极端区间（如小概率丰收/歉收判定）也很难被
  // 命中——用这道雪崩步骤把"种子相邻"打散成"输出无关"，专供 dailyNoiseMul 这类逐日取值场景使用
  function mixSeed(x) {
    x = (x ^ (x >>> 16)) >>> 0; x = Math.imul(x, 0x45d9f3b) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0; x = Math.imul(x, 0x45d9f3b) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  }
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
    // 无论史实分布还是群雄乱入，主公都必须坐镇自家城池——否则会出现主公流落敌境的怪相
    return seatLordsInOwnCities(assign);
  }
  // 武将初始势力归属：史实留名者（CITY_HINTS 命中）按其史实所在城池的初始势力效忠；
  // 次要武将按姓名哈希稳定兜底落到同阵营某城，但其中约两成天生「在野」（哈希再判一次，与城池兜底哈希各自独立）——
  // 与 buildCityAssignment 的"historical"分支使用同一套确定性哈希，不随天下格局（史实/乱入）选择而改变，
  // 因为"效忠谁"是历史归属，"人在哪座城"才是可能被打乱的地理分布，两者本就该是两件事
  function initGeneralFactions() {
    const cnCities = CITIES.filter(c => c.side === "cn").map(c => c.id);
    const jpCities = CITIES.filter(c => c.side === "jp").map(c => c.id);
    const generalFaction = {}, loyalty = {};
    const lordNames = new Set(FACTIONS.map(f => f.lord).filter(n => n && n !== "—"));
    DB.list.forEach(g => {
      const pool = g.side === "cn" ? cnCities : jpCities;
      let cid = CITY_HINTS[g.name];
      const isNamed = !!(cid && pool.includes(cid));
      if (!isNamed) cid = pool[hashStr(g.name) % pool.length];
      // 在野比例：目标约两成。CITY_HINTS 现已覆盖 350/400 位武将，若沿用"只有未指定者才可能在野"，
      // 在野者会少到只剩十来人（3%），失去"天下遍布浪人可供延揽"的意味——故改为两档概率：
      // 史实有明确归属者仅 15% 流落在野（名将多有其主），无明确归属者则 50%（本就是无名浪人居多）。
      // 主公绝不在野——一方之尊岂能无家可归。
      const ownFaction = FACTIONS.find(f => f.lord === g.name);   // 此人是否为某家主公
      const roninRate = isNamed ? 15 : 50;
      const ronin = !ownFaction && (hashStr(g.name + "|ronin") % 100 < roninRate);
      // 主公一律强制归入自家（否则会出现「袁术效力于吕布」这类荒唐事——势力归属本由所在城池推得，
      // 而 CITY_HINTS 给某些主公指的城恰好属于别家）；其余武将按所在城池的初始势力入伙
      const fid = ownFaction ? ownFaction.id : (ronin ? null : CITY_FACTION_INIT[cid]);
      generalFaction[g.id] = fid;
      if (fid) loyalty[g.id] = ownFaction ? 100 : 50 + (hashStr(g.name + "|loyalty") % 31);   // 主公对自家忠诚满值，余者 50~80
    });
    return { generalFaction, loyalty };
  }
  // 主公须坐镇自家城池——CITY_HINTS 偶尔会把某位主公指到别家地盘上，开局时统一迁回自家首城
  function seatLordsInOwnCities(assign) {
    FACTIONS.forEach(f => {
      if (!f.cities.length || f.lord === "—") return;
      const g = DB.list.find(x => x.name === f.lord);
      if (!g) return;
      if (!f.cities.includes(assign[g.id])) assign[g.id] = f.cities[0];
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
      const need = [5, 10, 15, 20][randInt(0, 3)];
      // 登塔难度随层数陡增，奖赏按层数二次方加码：5层150金/11名声 · 10层350金/34 · 15层650金/71 · 20层1050金/120
      return {
        uid, kind: "tower", need, legendary,
        desc: `登塔令：百人斩攀至第 ${need} 层`,
        rewardGold: 50 + need * 10 + need * need * 2,
        rewardFame: need + Math.round(need * need / 4),
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
    // 六期：悬赏完成不再计入城市繁荣度——为地方除害是战斗成就，与市政建设没有关系
    if (m && m.playerFaction) PlayerRank.addMerit(m, ab.rewardFame * 2);   // 为主公办事，功勋随名声同步入账
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
    </div>`, { modal: true });
    $("#ending-continue").onclick = () => { closeOverlay(); goHome(); };
  }

  /* ============================================================
   *  势力霸业双结局：本国一统（本国所有城池尽归玩家势力）／跨海一统（中日四十城尽归玩家势力）
   *  与「天下无双」相互独立、互不冲突，一局之内均可陆续达成——由随军攻城夺得关键一城时触发判定
   * ============================================================ */
  function checkUnifyEnding(m) {
    if (!m || !m.playerFaction) return "";
    const mine = cid => cityFactionId(m, cid) === m.playerFaction;
    const homeCities = CITIES.filter(c => c.side === RPG.char.side);
    const allCities = CITIES.filter(c => c.side !== "sea");
    if (!m.endingCrossSea && allCities.every(mine)) {
      m.endingCrossSea = true; m.endingHomeland = true; Campaign.save();
      setTimeout(() => showUnifyEndingOverlay(true), 1500);
      return `<br>🌏 二国江山，尽入一统……`;
    }
    if (!m.endingHomeland && homeCities.every(mine)) {
      m.endingHomeland = true; Campaign.save();
      setTimeout(() => showUnifyEndingOverlay(false), 1500);
      return `<br>👑 本国江山，尽归一统……`;
    }
    return "";
  }
  function showUnifyEndingOverlay(crossSea) {
    const c = RPG.char; if (!c) return;
    const m = Campaign.mapState();
    const ownName = m.playerFaction === "_player_" ? (m.playerOwnFaction && m.playerOwnFaction.n) : factionDef(m.playerFaction).n;
    const bg = c.side === 'cn' ? 'linear-gradient(135deg,#f4c430,#b8860b)' : 'linear-gradient(135deg,#f4c430,#8a6d3b)';
    const homeName = c.side === 'cn' ? '中原' : '日本';
    const desc = crossSea
      ? `「${ownName}」兵锋所至，中日两国四十城尽归一统——山河变色，青史将为此浓墨重彩！`
      : `「${ownName}」削平群雄，${homeName}诸城尽入麾下，成就一方霸业！（若能跨海再进一步，或可成就「跨海一统」的终极霸业）`;
    openOverlay(`<div class="result-card">
      <h1>👑 ${crossSea ? "跨海一统" : `${homeName}一统`}</h1>
      <div class="winner-av" style="background:${bg}">${avatarChar(c.name)}</div>
      <div class="wname">${c.name}</div>
      <div class="wdesc">${desc}<br>你的传奇仍将继续，天下之大，尽可去得。</div>
      <div class="btns"><button class="btn-primary" id="ending-unify-continue">继续征战</button></div>
    </div>`, { modal: true });
    $("#ending-unify-continue").onclick = () => { closeOverlay(); goHome(); };
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
          endingHomeland: false, endingCrossSea: false,
          statPenalty: {}, statGrowth: {}, activeAssassin: null, estate: {}, activeEstateRaid: null,
          builds: seedInitialBuilds(), population: {}, recruitedToday: {}, npcEstate: {}, guards: {}, captives: {}, activeRescue: null,
          nemesis: null, activeNemesis: null, nemesisChallenge: false,
          troops: {},
          // 势力（军事三期）：城池归属改记势力而非国别；玩家默认在野（浪人），后续可投效/自立；
          // 武将的初始效忠与忠诚由 initGeneralFactions 按史实/哈希兜底一次性生成
          cityFaction: initCityFaction(), playerFaction: null, playerRank: 0, playerMerit: 0, playerOwnFaction: null, exLordUntil: {},
          factionFame: FactionFame.init(), factionOrders: FactionOrders.init(), factionGold: FactionGold.init(),
          hostility: {}, posts: {}, fiefs: {}, sworn: [], factionWeary: {}, pendingCourt: null, playerFief: null, feastCharges: 0,
          ...initGeneralFactions(),
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
      if (m.endingHomeland == null) { m.endingHomeland = false; changed = true; }
      if (m.endingCrossSea == null) { m.endingCrossSea = false; changed = true; }
      if (!m.cityFaction) {
        // 兼容旧存档（军事三期之前）：老档只按国别记城池归属（m.cityOwner）；仍是原始国别的城池直接落到初始势力，
        // 曾被易主（owner 与该城固有 side 不同）的则无从得知具体夺主是谁，兜底归入该国别第一家势力
        m.cityFaction = initCityFaction();
        if (m.cityOwner) {
          Object.keys(m.cityFaction).forEach(cid => {
            const oldOwnerSide = m.cityOwner[cid];
            if (oldOwnerSide && oldOwnerSide !== cityDef(cid).side) {
              const fallback = FACTIONS.find(f => f.side === oldOwnerSide && f.cities.length);
              if (fallback) m.cityFaction[cid] = fallback.id;
            }
          });
          delete m.cityOwner;
        }
        changed = true;
      }
      if (!m.generalFaction || !m.loyalty) {
        const init = initGeneralFactions();
        if (!m.generalFaction) { m.generalFaction = init.generalFaction; changed = true; }
        if (!m.loyalty) { m.loyalty = init.loyalty; changed = true; }
      }
      if (m.playerFaction === undefined) { m.playerFaction = null; changed = true; }
      if (m.playerRank == null) { m.playerRank = 0; changed = true; }
      if (m.playerMerit == null) { m.playerMerit = 0; changed = true; }
      if (m.playerOwnFaction === undefined) { m.playerOwnFaction = null; changed = true; }
      if (!m.exLordUntil) { m.exLordUntil = {}; changed = true; }
      // 势力系统二轮新增字段：威名/军令/金库/敌对度/封赏（官职·封地·结义）/出征疲敝
      if (!m.factionFame) { m.factionFame = FactionFame.init(); changed = true; }
      if (!m.factionOrders) { m.factionOrders = FactionOrders.init(); changed = true; }
      if (!m.factionGold) { m.factionGold = FactionGold.init(); changed = true; }
      if (!m.hostility) { m.hostility = {}; changed = true; }
      if (!m.posts) { m.posts = {}; changed = true; }
      if (!m.fiefs) { m.fiefs = {}; changed = true; }
      if (!m.sworn) { m.sworn = []; changed = true; }
      if (!m.factionWeary) { m.factionWeary = {}; changed = true; }
      if (m.pendingCourt === undefined) { m.pendingCourt = null; changed = true; }
      if (m.playerFief === undefined) { m.playerFief = null; changed = true; }
      if (!m.statPenalty) { m.statPenalty = {}; changed = true; }
      if (!m.statGrowth) { m.statGrowth = {}; changed = true; }
      if (m.activeAssassin === undefined) { m.activeAssassin = null; changed = true; }
      if (!m.estate) { m.estate = {}; changed = true; }
      if (m.activeEstateRaid === undefined) { m.activeEstateRaid = null; changed = true; }
      if (!m.builds) { m.builds = {}; changed = true; }
      if (!m.population) { m.population = {}; changed = true; }
      if (!m.recruitedToday) { m.recruitedToday = {}; changed = true; }
      if (!m.npcEstate) { m.npcEstate = {}; changed = true; }
      if (!m.guards) { m.guards = {}; changed = true; }
      if (!m.captives) { m.captives = {}; changed = true; }
      if (m.activeRescue === undefined) { m.activeRescue = null; changed = true; }
      if (m.nemesis === undefined) { m.nemesis = null; changed = true; }
      if (m.activeNemesis === undefined) { m.activeNemesis = null; changed = true; }
      if (m.nemesisChallenge === undefined) { m.nemesisChallenge = false; changed = true; }
      if (!m.troops) { m.troops = {}; changed = true; }
      if (m.feastCharges === undefined) { m.feastCharges = 0; changed = true; }
      if (changed) this.save();
      return m;
    },
    // 名声九阶：数值上限 10000，各阶对应行动力上限/历练/武道会/集市/悬赏/铁匠铺渐进解锁（见 recalcApMax 与各处 fameTierIndex 判定）
    FAME_MAX: 10000,
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
    /* ---- 名声 → 势力威名 的转轨 ----
     * 在野与仕官期间，个人名声照常积累；一旦自立门户当了主公，「你的名声」与「你这家势力的威名」
     * 便合二为一：此后一切原本给名声的奖励（悬赏、设施、单挑…）统统折成势力威名（1/10 计），
     * 而所有读名声的门槛（行动力上限/武道会/集市/悬赏条数/铁匠折扣）改读 威名×10。
     * 如此既不必另造一套阈值表，也让自立后的成长仍在同一根标尺上继续，不会就此冻结。
     * 体感上这还带来一处关键转折：自立前跑腿悬赏是主线，自立后一条悬赏只折 6 点威名，
     * 而夺一城 +150——当了主公，唯有开疆拓土才算数。 */
    FAME_TO_FACTION_FAME: 0.1,
    isLordMode(m) { return !!m && m.playerFaction === "_player_"; },
    effFame(m) {
      if (!m) return 0;
      if (this.isLordMode(m)) return FactionFame.get(m, "_player_") * 10;
      return m.fame || 0;
    },
    // 名动一国（第 5 阶）解锁时：眼线渐广，每城悬赏榜永久 +1 条空缺（仅触发一次，直接补进当前各城悬赏列表）
    BOUNTY_BONUS_TIER: 5,
    // 增加名声；跨阶时提示，重算行动力上限，并在特定阶梯触发一次性福利
    // 各处调用方仍按原数值传参，此处统一减半入账，使名声整体积累速度放缓一倍
    addFame(n) {
      const m = this.mapState(); if (!m || !n) return;
      const lordMode = this.isLordMode(m);
      const before = this.fameTierIndex(this.effFame(m));
      // 自立后行动力上限等一切门槛改读威名（见 effFame），但个人名声这个数字本身不再冻结在自立那一刻——
      // 继续按老公式累加，只是不再驱动任何门槛，单纯作为「你个人的声望」与「你这家势力的威名」并存展示
      m.fame = Math.min(this.FAME_MAX, (m.fame || 0) + Math.round(n / 2));
      if (lordMode) {
        // 已自立：威名这项势力指标额外入账（名声与威名两条线各自增长，见 effFame 注释）
        FactionFame.add(m, "_player_", Math.round(n / 2 * this.FAME_TO_FACTION_FAME));
      }
      const after = this.fameTierIndex(this.effFame(m));
      this.recalcApMax();
      if (after >= this.BOUNTY_BONUS_TIER && before < this.BOUNTY_BONUS_TIER && m.bounties) {
        Object.keys(m.bounties).forEach(cid => m.bounties[cid].push(genBounty(cid, m.assign, m.appeared, RPG.char && RPG.char.side)));
      }
      this.save();
      if (after > before) {
        toast(lordMode
          ? `🎉 本家威名跨入「${FactionFame.TIERS[after].n}」！行动力上限提升，天下事更多了`
          : `🎉 名声跨入「${this.FAME_TIERS[after].n}」！行动力上限提升，天下事更多了`);
      }
    },
    // 行动力上限 = 1 + 名声阶梯/2（向下取整） + 已装备的行动力奇珍(传国玉玺/九鼎二选一，+1)，封顶 6
    // 武道会首冠不再贡献行动力上限（m.cupWon 标记仍保留，供"天下无双"终局条件判定使用）
    recalcApMax() {
      const m = this.mapState(); if (!m) return;
      let cap = 1 + Math.floor(this.fameTierIndex(this.effFame(m)) / 2);
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
      this.state = { charType: null, generalId: null, difficulty: null, custom: null, distribution: "historical", identity: null, identityFaction: null };
      this._roll = null; this._name = ""; this._genSearch = ""; this._skillGenId = null;
      this.render();
      showScreen("onboard");
    },
    render() {
      const C = $("#onboard-content");
      C.innerHTML = `<div class="ob-steps">
        <span class="ob-step ${this.step === 1 ? 'active' : this.step > 1 ? 'done' : ''}">① 选角色</span>
        <span class="ob-step ${this.step === 2 ? 'active' : this.step > 2 ? 'done' : ''}">② 选格局</span>
        <span class="ob-step ${this.step === 3 ? 'active' : this.step > 3 ? 'done' : ''}">③ 选身份</span>
        <span class="ob-step ${this.step === 4 ? 'active' : ''}">④ 确认开局</span>
      </div>` + (this.step === 1 ? this.stepChar() : this.step === 2 ? this.stepWorld() : this.step === 3 ? this.stepIdentity() : this.stepConfirm());
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
          <div class="rf-row"><label>将魂</label>
            <button class="cup-go" id="ob-skill-pick" style="flex:1">${this._skillGenId != null ? `⭐ 习得「${(DB.get(this._skillGenId) || {}).name}」的将魂` : "选择武将库中一将，习得其将魂（可不选）"}</button></div>
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
        const skillSrc = s.custom.skillGeneralId != null ? DB.get(s.custom.skillGeneralId) : null;
        desc = `自创武将 · ${s.custom.side === 'cn' ? '三国风' : '战国风'} · 基线评分 ${ratingScore(s.custom.base)}${skillSrc ? ` · 将魂习自「${skillSrc.name}」（${Skill.of(skillSrc).n}）` : ''}`;
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

    /* ---- 第 3 步：选开局身份——在野浪人 或 投效某势力 ---- */
    stepIdentity() {
      const s = this.state;
      const side = s.charType === "custom" ? s.custom.side : (DB.get(s.generalId) || {}).side;
      const facs = FACTIONS.filter(f => f.side === side && f.cities.length);
      return `<div class="section-hint">第 3 步 · 选择开局身份</div>
        <div class="buff-list">
          <button class="buff-btn ob-identity ${s.identity === 'ronin' ? 'active' : ''}" data-v="ronin"><span class="bi">🎋</span><span class="bt"><b>在野浪人</b><small>不效力任何势力，自由游历，可随时投效他人或被人招揽</small></span></button>
          <button class="buff-btn ob-identity ${s.identity === 'vassal' ? 'active' : ''}" data-v="vassal"><span class="bi">🏯</span><span class="bt"><b>投效某势力</b><small>开局即为客卿，可累积功勋晋升官职、领取主公任务，未来还可自立门户</small></span></button>
        </div>
        ${s.identity === "vassal" ? `<div class="section-hint">投效于——</div>
        <div class="grid">${facs.map(f => `<div class="card ${f.side} ob-fac ${s.identityFaction === f.id ? 'selected' : ''}" data-f="${f.id}"><div class="avatar">${f.n.slice(0, 1)}</div><div class="cname">${f.n}</div><div class="cwu">主公 · ${f.lord}</div></div>`).join("")}</div>` : ""}
        <div class="rpg-create-btns">
          <button class="cup-go" id="ob-back2">‹ 上一步</button>
          <button class="cup-go primary" id="ob-next3" ${s.identity === "vassal" && !s.identityFaction ? "disabled" : ""}>下一步 ›</button>
        </div>`;
    },

    /* ---- 第 4 步：确认开局 ---- */
    stepConfirm() {
      const s = this.state;
      const hasExisting = !!RPG.char;
      let name, desc;
      if (s.charType === "custom") { name = s.custom.name; desc = `自创武将 · ${s.custom.side === 'cn' ? '三国风' : '战国风'}`; }
      else { const g = DB.get(s.generalId); name = g.name; desc = s.difficulty === 'young' ? '少年模式' : '巅峰模式'; }
      const identityTxt = s.identity === "vassal" ? `投效 ${factionDef(s.identityFaction).n}（客卿）` : "在野浪人";
      return `<div class="section-hint">第 4 步 · 确认开局</div>
        <div class="result-card" style="padding:20px 16px">
          <div class="wname">${name}</div>
          <div class="wdesc">${desc} · 天下格局：${s.distribution === 'historical' ? '史实分布' : '群雄乱入'} · 开局身份：${identityTxt}</div>
          ${hasExisting ? `<div class="wdesc" style="color:var(--cn-red)">⚠️ 当前已有存档（${RPG.char.name}），开始新游戏将覆盖角色、金币、友谊、队伍与宝物背包，且无法恢复！</div>` : ''}
        </div>
        <div class="rpg-create-btns">
          <button class="cup-go" id="ob-back3">‹ 上一步</button>
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
      const skillPick = $("#ob-skill-pick"); if (skillPick) skillPick.onclick = () => {
        this._name = $("#ob-name").value; this._side = $("#ob-side").value;
        openSkillGenPicker(this._skillGenId, id => { this._skillGenId = id; this.render(); });
      };
      const customNext = $("#ob-custom-next"); if (customNext) customNext.onclick = () => {
        const name = ($("#ob-name").value || "").trim() || "无名客";
        const side = $("#ob-side").value;
        this.state.custom = { name, side, base: this._roll.base, points: this._roll.points, skillGeneralId: this._skillGenId };
        this._roll = null; this._name = ""; this._skillGenId = null; this.render();
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
      $$(".ob-identity").forEach(b => b.onclick = () => { this.state.identity = b.dataset.v; if (b.dataset.v === "ronin") this.state.identityFaction = null; this.render(); });
      $$(".ob-fac").forEach(el => el.onclick = () => { this.state.identityFaction = el.dataset.f; this.render(); });
      const back2 = $("#ob-back2"); if (back2) back2.onclick = () => { this.step = 2; this.render(); };
      const next3 = $("#ob-next3"); if (next3) next3.onclick = () => { if (!this.state.identity) this.state.identity = "ronin"; this.step = 4; this.render(); };
      // 第 4 步
      const back3 = $("#ob-back3"); if (back3) back3.onclick = () => { this.step = 3; this.render(); };
      const confirm = $("#ob-confirm"); if (confirm) confirm.onclick = () => this.finish();
    },

    finish() {
      const s = this.state;
      const side = s.charType === "custom" ? s.custom.side : (DB.get(s.generalId) || {}).side;
      Campaign.reset({ charType: s.charType, difficulty: s.difficulty || null, distribution: s.distribution, side });
      if (s.charType === "custom") RPG.create(s.custom.name, s.custom.side, s.custom.base, s.custom.points, undefined, s.custom.skillGeneralId);
      else RPG.createFromGeneral(DB.get(s.generalId), s.difficulty);
      // 开局身份：投效者直接获封客卿（官职一级），在野者维持 Campaign.reset 里的默认空白
      if (s.identity === "vassal" && s.identityFaction) {
        const m = Campaign.mapState();
        m.playerFaction = s.identityFaction; m.playerRank = 1; m.playerMerit = 0;
        Campaign.save();
      }
      toast(`🎉 ${RPG.char.name}，你的武将人生开始了！`);
      MapUI.open();
    },
  };

  /* ============================================================
   *  天下游历：地图主界面——移动/天数/行动力/宿营、当前城池行动、本地武将名录
   * ============================================================ */
  // 风格化陆地剪影（viewBox 0~100，与城池坐标同一相对坐标系），非精确测绘，仅取意接近真实海岸轮廓
  // 中日两国地图轮廓改为按真实海岸线数据（Natural Earth 1:50m 精度）投影生成：中国裁剪至三国故事
  // 主要舞台（巴蜀·中原·荆襄·江南，非全境，保留清晰的东部真实海岸线，西边界收紧至成都以西约3度、
  // 不再空出一大截没有城池的高原；北/南边界仍为理论裁切框线）；日本取本州+九州+四国+对马岛四片
  // 真实岛屿轮廓（不含北海道/琉球——两地均无战国势力城池）。
  // 中日采用同一套等距投影（不做纬度余弦修正，刻意与下方卫星地形栅格底图 MAP_RELIEF_RECT 共用
  // 同一种线性经纬度关系，确保矢量海岸线与栅格贴图像素级对齐），再统一按 x/y 独立归一化进 0~100，
  // 与下方城池坐标、既有 viewBox="0 0 100 100" + preserveAspectRatio="none" 的拉伸架构完全对齐
  // （生成脚本与经纬度取值见 BALANCE.md 对应轮次说明）
  const CHINA_LAND_PATH = "M19.16,92.15 L18.77,91.52 L18.67,91.47 L18.4,91.66 L18.02,91.73 L17.93,91.53 L17.74,91.69 L17.56,91.22 L17.35,91.19 L17.08,90.84 L16.99,90.65 L16.95,90.39 L16.87,90.25 L16.77,90.27 L16.65,90.12 L16.32,89.9 L16.17,90.0 L16.15,88.8 L16.11,88.59 L16.01,88.42 L15.92,88.34 L15.88,88.1 L15.92,87.62 L15.99,87.29 L16.1,87.23 L16.26,86.99 L16.44,86.35 L16.08,85.92 L15.9,85.76 L15.3,85.99 L15.23,85.94 L15.08,85.55 L15.0,85.48 L14.66,85.46 L14.57,85.63 L14.3,85.7 L13.96,85.21 L13.63,85.01 L13.59,84.79 L13.51,84.52 L13.38,84.27 L13.18,83.94 L13.01,83.77 L12.81,84.06 L12.07,84.72 L11.98,84.89 L11.91,85.75 L11.67,86.15 L11.42,86.16 L11.3,86.24 L10.95,86.69 L10.78,86.66 L10.64,86.4 L10.58,86.21 L10.43,86.25 L10.22,86.47 L10.13,86.86 L10.08,87.23 L10.04,87.39 L9.97,87.44 L9.91,87.45 L9.23,86.34 L9.12,86.55 L9.02,87.11 L8.94,87.22 L8.89,87.18 L8.63,86.46 L8.57,86.39 L8.51,86.42 L8.43,86.65 L8.13,87.2 L8.13,87.43 L7.83,87.84 L7.78,87.86 L7.67,87.78 L7.53,87.51 L7.43,87.23 L7.18,86.95 L6.72,86.52 L6.61,86.48 L6.52,86.56 L6.47,86.67 L6.4,86.95 L6.08,87.78 L5.83,88.17 L5.75,88.02 L5.6,87.9 L5.42,87.9 L5.18,88.13 L4.99,87.67 L4.94,87.64 L4.87,87.68 L4.79,87.79 L4.67,88.41 L4.56,88.64 L4.46,88.75 L4.54,89.16 L4.54,89.35 L4.57,89.65 L4.64,89.95 L4.86,90.44 L4.94,90.69 L4.96,91.7 L4.91,93.03 L5.09,93.39 L5.09,93.49 L4.92,93.75 L4.87,93.78 L4.68,93.62 L4.5,93.39 L4.27,93.41 L3.9,93.62 L3.83,93.56 L3.77,93.44 L3.74,93.19 L3.76,92.9 L3.73,92.71 L3.66,92.6 L3.71,92.08 L3.58,91.87 L3.6,91.81 L3.56,91.11 L3.54,91.06 L3.44,91.02 L3.26,91.14 L3.26,5.56 L53.42,5.56 L53.42,9.44 L53.33,9.58 L53.06,9.66 L51.9,10.73 L51.65,11.18 L51.42,11.71 L51.1,12.16 L50.96,12.24 L50.83,12.42 L50.7,12.44 L50.56,12.36 L50.4,12.39 L50.3,12.61 L50.39,12.9 L50.34,13.02 L50.04,13.17 L49.59,13.28 L49.33,13.57 L49.23,13.63 L49.14,13.25 L49.1,12.76 L49.46,12.58 L50.41,11.91 L50.29,11.4 L50.38,11.18 L50.73,10.64 L50.65,10.58 L50.03,10.69 L49.49,10.65 L49.54,10.34 L49.51,10.03 L49.47,9.92 L49.79,9.57 L49.93,9.48 L50.04,9.49 L50.03,9.28 L49.94,8.96 L50.04,8.55 L50.69,8.07 L50.84,7.63 L51.1,7.22 L51.58,6.21 L51.6,6.04 L51.74,5.56 L48.17,5.56 L47.67,6.79 L47.42,6.91 L46.24,7.9 L45.65,8.29 L45.19,8.97 L44.9,9.85 L44.81,10.54 L44.39,11.39 L44.25,11.57 L44.1,11.64 L43.9,11.62 L43.74,11.67 L43.45,11.6 L43.1,11.86 L42.7,12.1 L42.36,11.51 L42.11,11.37 L41.71,11.53 L41.53,11.79 L41.15,13.07 L41.0,13.81 L41.01,14.11 L41.24,15.03 L41.49,15.54 L42.05,16.13 L43.26,16.53 L43.54,16.39 L43.84,16.38 L44.16,16.77 L44.36,17.4 L44.39,17.98 L44.46,18.11 L44.5,18.33 L44.28,18.6 L44.2,19.27 L44.19,20.01 L44.3,20.26 L44.55,20.6 L44.96,20.89 L45.33,20.95 L46.03,20.81 L46.32,20.37 L46.31,19.92 L46.94,19.26 L47.29,18.68 L47.17,18.42 L47.23,18.37 L47.42,18.32 L48.29,17.72 L48.97,18.21 L49.36,18.78 L49.74,18.88 L50.01,19.17 L50.32,19.42 L51.06,19.49 L51.16,19.26 L51.27,19.11 L51.39,19.14 L51.53,19.44 L51.91,19.67 L52.26,19.66 L52.51,19.58 L52.66,19.68 L52.45,20.07 L52.48,20.69 L52.32,20.89 L52.16,21.21 L52.25,21.42 L52.33,21.51 L52.32,21.76 L52.18,21.91 L51.92,22.29 L51.77,22.28 L51.69,22.2 L51.64,22.07 L51.6,21.85 L51.51,21.71 L51.25,21.65 L50.99,21.71 L50.39,22.27 L49.8,22.71 L49.19,23.07 L48.98,23.29 L48.84,23.35 L48.58,23.18 L48.43,23.19 L48.4,23.31 L48.59,23.62 L48.64,23.87 L48.62,24.05 L48.51,24.14 L48.35,24.0 L48.2,24.2 L48.14,24.53 L48.13,25.31 L48.03,25.49 L47.76,25.58 L47.48,25.83 L47.37,25.72 L47.33,25.58 L47.36,25.22 L47.33,25.04 L47.2,25.05 L47.0,25.16 L46.85,25.39 L46.79,25.54 L46.99,26.0 L47.18,26.05 L47.23,26.15 L47.08,26.38 L46.7,26.71 L46.64,26.99 L46.53,27.26 L46.38,27.48 L46.27,27.7 L45.94,27.95 L45.69,28.5 L45.5,29.0 L45.28,29.26 L45.1,30.12 L44.79,30.58 L44.68,31.33 L44.76,31.78 L45.1,31.78 L45.27,31.94 L45.63,32.54 L46.06,32.93 L46.5,33.16 L47.04,33.71 L47.19,33.95 L47.32,34.43 L47.55,35.81 L47.72,36.49 L47.73,36.85 L47.98,37.52 L48.25,38.68 L48.57,39.68 L48.63,40.47 L48.52,40.83 L48.53,41.3 L48.84,41.73 L49.53,42.23 L49.64,42.38 L49.77,42.62 L49.78,43.37 L49.98,43.76 L50.4,44.08 L50.57,44.35 L50.76,44.77 L50.81,45.15 L50.84,45.67 L50.6,45.68 L50.41,45.63 L49.66,44.96 L49.47,44.94 L49.19,45.03 L48.8,44.91 L48.39,44.17 L48.09,43.94 L47.77,43.83 L47.0,44.47 L46.81,44.42 L46.66,44.6 L47.02,44.74 L47.37,44.53 L47.71,44.22 L48.21,44.39 L48.3,44.67 L48.38,45.14 L48.72,45.45 L48.99,45.59 L49.33,46.01 L49.66,46.66 L50.37,47.42 L50.65,48.13 L50.76,48.59 L50.86,49.25 L50.61,49.46 L50.06,49.6 L49.82,49.83 L49.57,50.24 L48.85,50.89 L48.63,51.64 L48.45,51.82 L48.02,51.65 L47.61,51.66 L47.14,52.14 L47.02,52.33 L47.17,52.23 L47.38,52.3 L47.71,52.05 L48.02,52.82 L48.64,52.7 L49.22,52.06 L49.45,52.05 L49.64,52.14 L49.85,52.4 L50.41,53.53 L50.71,53.65 L51.01,53.91 L51.18,53.94 L51.33,54.02 L50.93,54.44 L50.4,55.33 L50.17,55.54 L50.01,55.78 L50.43,55.66 L50.73,55.23 L50.88,55.13 L51.01,55.23 L51.07,55.75 L50.95,57.38 L50.81,57.4 L50.66,56.96 L50.5,56.82 L50.36,56.91 L50.08,56.91 L49.97,57.11 L49.88,57.39 L50.05,57.45 L50.38,57.94 L50.41,58.2 L50.32,58.37 L50.09,58.3 L50.37,58.67 L50.3,59.05 L50.21,59.2 L50.04,59.3 L49.94,59.63 L50.09,60.17 L50.23,60.88 L50.25,61.22 L50.02,61.07 L49.67,61.5 L49.48,61.54 L49.35,60.97 L49.19,61.06 L49.08,61.22 L48.94,61.83 L48.77,62.38 L48.61,62.53 L48.43,62.49 L48.28,62.5 L48.32,62.65 L48.48,62.83 L48.48,63.04 L48.14,63.71 L48.09,63.97 L48.1,64.19 L47.92,64.46 L48.01,64.91 L47.97,65.23 L47.81,65.66 L47.65,65.94 L47.46,66.4 L47.22,66.67 L46.9,67.63 L46.8,68.11 L46.78,68.61 L46.51,68.99 L46.31,68.88 L46.31,68.55 L46.22,68.52 L46.17,68.31 L46.16,68.03 L46.18,67.81 L46.1,67.88 L46.05,68.14 L45.92,68.35 L45.79,68.26 L45.64,68.09 L45.65,68.34 L45.72,68.59 L45.76,68.84 L45.96,68.89 L46.09,69.17 L46.22,69.78 L46.3,69.98 L46.31,70.14 L46.12,70.3 L45.88,70.59 L45.59,71.09 L45.36,71.42 L45.01,71.38 L44.83,71.19 L44.62,71.11 L44.9,71.78 L45.06,71.9 L45.25,71.88 L45.44,71.63 L45.71,71.65 L45.78,72.04 L45.71,72.47 L45.56,73.04 L45.53,73.53 L45.71,74.23 L45.72,74.44 L45.65,74.55 L45.44,74.36 L45.26,74.13 L45.08,74.19 L44.9,74.09 L44.71,74.18 L44.63,74.34 L44.69,74.6 L44.86,74.83 L44.95,75.17 L44.84,75.29 L44.36,75.21 L44.25,75.27 L44.1,75.65 L44.2,76.2 L44.09,76.55 L43.89,76.63 L43.63,76.91 L43.47,76.98 L43.48,77.1 L43.6,77.22 L43.66,77.38 L43.52,77.95 L43.3,78.14 L42.96,78.05 L42.69,78.17 L42.46,77.93 L42.22,77.93 L42.05,78.23 L42.03,78.59 L41.66,78.62 L41.67,78.81 L41.74,78.98 L42.08,79.05 L42.14,79.29 L42.15,79.66 L41.8,80.3 L41.65,80.73 L41.43,80.72 L41.26,81.06 L41.17,81.53 L41.06,81.44 L40.8,81.51 L40.73,81.73 L40.79,81.83 L40.79,81.99 L40.69,82.51 L40.58,82.66 L40.53,82.45 L40.49,82.11 L40.4,82.09 L40.25,82.39 L40.08,82.61 L39.93,82.7 L39.81,82.5 L39.54,82.4 L39.42,83.28 L39.19,83.6 L39.08,83.7 L38.9,83.73 L39.02,83.85 L39.05,84.08 L38.99,84.3 L38.8,84.35 L38.69,84.52 L38.65,85.31 L38.53,85.59 L38.25,85.61 L38.03,85.43 L37.93,85.71 L37.82,85.86 L37.6,85.89 L37.12,86.25 L36.64,86.01 L36.46,86.14 L36.4,86.41 L36.32,86.62 L36.05,86.62 L35.84,86.36 L35.63,86.18 L35.39,86.34 L35.21,86.67 L34.99,86.78 L34.94,86.99 L34.85,87.09 L34.61,87.05 L34.52,86.53 L34.39,86.46 L34.25,86.72 L34.14,87.07 L34.16,87.49 L34.03,87.5 L33.86,87.24 L33.68,87.2 L33.51,87.44 L33.33,87.33 L33.18,87.33 L33.02,87.43 L32.94,87.57 L32.74,87.48 L32.51,87.13 L32.34,86.56 L32.13,86.25 L32.03,85.97 L32.0,85.49 L31.96,85.25 L31.97,84.99 L32.03,84.76 L31.81,84.88 L31.64,85.09 L31.67,85.36 L31.63,85.61 L31.37,85.74 L31.41,85.96 L31.61,86.3 L31.65,86.59 L31.73,86.75 L31.88,87.19 L31.88,88.06 L31.96,88.3 L31.87,88.88 L31.82,88.78 L31.75,88.8 L31.71,89.01 L31.37,89.24 L31.23,89.5 L30.96,89.56 L30.82,88.95 L30.64,89.36 L30.58,90.18 L30.52,90.32 L30.4,90.44 L30.18,90.15 L29.85,90.54 L29.79,90.72 L29.68,90.92 L29.47,90.73 L29.3,90.45 L29.34,90.23 L29.32,90.09 L29.24,89.99 L29.16,90.0 L29.2,90.28 L29.23,90.81 L29.15,90.96 L29.04,91.08 L28.78,90.98 L28.61,90.78 L28.4,90.62 L28.21,90.59 L28.17,90.92 L28.05,91.19 L27.94,91.23 L27.83,91.18 L27.68,91.47 L27.61,91.69 L27.43,91.91 L26.95,92.02 L26.79,92.24 L26.56,92.21 L26.29,92.25 L26.2,92.13 L26.1,92.13 L26.05,92.5 L25.78,92.66 L25.54,92.7 L25.07,93.48 L24.93,93.52 L24.82,93.41 L24.77,92.97 L24.72,92.92 L24.69,93.33 L24.63,93.68 L24.54,93.86 L24.22,94.29 L24.19,94.46 L23.07,94.46 L23.11,94.22 L23.05,93.86 L23.23,93.42 L23.28,92.92 L23.6,92.74 L23.62,92.27 L23.39,92.26 L23.23,91.91 L23.2,92.05 L23.07,92.07 L22.86,91.4 L22.79,91.31 L22.69,91.3 L22.74,92.01 L22.49,92.27 L22.29,92.39 L22.0,92.44 L21.84,92.52 L21.69,92.45 L21.72,92.24 L21.8,91.98 L21.73,91.77 L21.57,91.6 L20.98,91.59 L20.62,90.95 L20.56,90.74 L20.62,90.5 L20.57,90.35 L20.31,90.34 L20.34,91.09 L20.42,91.4 L20.37,91.57 L20.23,91.69 L20.09,91.36 L20.03,91.28 L19.96,91.3 L19.91,91.63 L19.78,91.92 L19.55,91.88 L19.37,92.06 L19.16,92.15 Z";
  const JAPAN_HONSHU_PATH = "M94.98,1.59 L95.07,1.67 L95.5,1.44 L95.42,2.14 L95.37,2.85 L95.4,4.02 L95.44,4.55 L95.51,5.06 L95.7,5.42 L95.93,5.68 L96.28,6.52 L96.46,7.54 L96.59,8.03 L96.72,8.79 L96.69,9.36 L96.72,9.62 L96.69,10.45 L96.53,11.41 L96.51,11.9 L96.38,11.99 L96.3,12.22 L96.23,12.32 L96.15,12.4 L96.04,12.42 L95.96,12.52 L95.88,13.02 L95.71,13.48 L95.64,14.08 L95.62,14.69 L95.53,15.12 L95.3,15.23 L95.04,15.22 L94.71,15.42 L94.64,15.54 L94.37,16.28 L94.3,16.72 L94.3,17.19 L94.47,18.34 L94.54,19.39 L94.46,21.0 L94.39,21.51 L94.22,21.86 L93.98,22.22 L93.84,22.74 L93.61,23.79 L93.59,24.32 L93.49,25.02 L93.53,25.43 L93.6,25.81 L93.91,26.78 L94.17,27.33 L93.64,27.62 L93.22,28.31 L93.12,28.84 L93.13,29.42 L93.08,29.63 L92.99,29.81 L92.9,29.93 L92.54,30.2 L92.31,30.46 L92.0,31.1 L91.82,31.03 L91.72,30.83 L91.82,30.59 L91.79,30.31 L91.84,29.58 L91.78,29.29 L91.97,29.06 L92.05,28.71 L92.38,28.17 L92.4,27.97 L92.28,27.75 L92.15,27.59 L91.8,27.64 L91.69,27.85 L91.66,28.13 L91.65,28.38 L91.38,28.77 L91.42,29.18 L91.5,29.39 L91.6,29.49 L91.57,29.63 L91.44,29.96 L91.35,29.99 L91.19,29.53 L90.98,29.28 L90.73,29.28 L90.47,29.37 L90.27,29.68 L90.21,29.93 L90.16,30.2 L90.18,30.84 L90.1,31.37 L89.86,32.01 L89.66,32.33 L89.53,32.37 L89.43,32.23 L89.35,32.01 L89.45,31.2 L89.45,30.75 L89.68,30.52 L89.49,30.2 L89.26,30.07 L88.94,30.24 L88.84,30.44 L88.78,30.7 L88.41,31.33 L88.2,31.86 L88.05,32.48 L87.57,32.27 L86.58,32.17 L86.06,32.3 L85.48,32.54 L85.52,32.36 L86.0,31.99 L86.01,31.88 L85.97,31.67 L85.85,31.66 L85.56,31.74 L85.41,31.7 L85.35,31.49 L85.26,31.39 L85.19,31.48 L85.21,31.91 L85.14,31.96 L85.05,31.85 L85.08,31.52 L85.01,31.04 L85.0,30.73 L85.11,30.48 L85.0,30.37 L84.89,30.41 L84.76,30.53 L84.63,30.71 L84.38,31.6 L84.27,32.1 L84.46,32.51 L84.98,33.08 L85.07,33.22 L85.07,33.46 L85.01,33.72 L84.87,33.83 L84.3,34.02 L83.81,34.39 L83.67,34.76 L83.23,36.21 L82.87,37.19 L82.37,37.54 L81.81,37.23 L81.68,36.89 L81.57,36.46 L81.18,35.66 L81.07,35.16 L81.09,34.36 L81.01,33.88 L81.08,33.75 L81.39,33.46 L81.48,33.3 L81.66,32.92 L81.72,32.7 L81.73,32.38 L81.59,32.21 L81.23,32.22 L80.87,32.32 L80.62,32.18 L80.19,31.71 L79.83,31.68 L79.58,31.76 L79.33,31.9 L79.06,31.94 L78.97,32.02 L78.67,32.49 L78.43,32.79 L78.22,32.94 L77.77,32.98 L77.3,33.24 L77.24,33.22 L76.7,33.63 L76.54,33.82 L76.26,33.69 L75.71,34.03 L75.44,34.07 L75.16,33.89 L74.9,33.59 L74.65,33.72 L74.48,34.16 L74.4,35.05 L74.3,35.45 L74.27,35.93 L74.15,35.86 L73.35,34.96 L72.75,35.11 L72.59,35.18 L72.4,35.36 L72.19,35.43 L72.0,35.31 L71.82,35.1 L71.65,35.16 L71.47,35.31 L71.41,34.0 L71.44,33.83 L71.67,33.41 L71.96,33.34 L72.26,33.4 L72.47,33.31 L72.65,33.05 L72.83,32.69 L73.05,32.39 L73.61,31.89 L74.09,31.09 L74.3,30.79 L74.53,30.54 L74.88,29.93 L75.35,29.24 L75.53,28.73 L75.64,28.59 L76.04,28.31 L76.58,28.09 L76.83,28.1 L77.08,28.55 L77.35,28.37 L77.62,28.31 L77.91,28.38 L78.18,28.38 L78.46,28.33 L78.99,28.18 L79.54,27.78 L80.51,27.61 L81.18,27.23 L81.28,27.26 L81.38,27.35 L81.39,27.63 L81.31,27.94 L81.39,28.13 L81.53,28.24 L82.15,28.28 L82.33,28.34 L82.59,28.13 L82.84,27.87 L83.1,27.53 L83.28,27.14 L83.11,26.65 L83.07,26.12 L83.21,25.55 L83.42,25.06 L83.66,24.77 L83.88,24.43 L84.33,23.47 L84.65,22.7 L84.77,21.74 L84.7,20.62 L84.98,19.78 L85.25,19.63 L85.79,19.25 L86.08,19.14 L86.12,19.31 L86.11,19.53 L85.69,20.23 L85.44,20.52 L85.17,20.74 L85.11,20.98 L85.33,21.4 L85.38,21.7 L85.38,22.26 L85.62,22.55 L85.9,22.65 L86.02,22.64 L86.12,22.57 L86.51,21.74 L87.42,21.23 L87.87,20.83 L88.12,20.73 L88.35,20.52 L88.87,19.73 L89.06,19.37 L89.24,18.96 L89.38,18.5 L89.49,17.99 L89.64,17.67 L90.46,16.92 L90.73,16.51 L90.81,16.31 L90.92,15.74 L90.99,15.14 L91.09,14.67 L91.22,14.23 L91.61,13.37 L91.73,12.94 L91.98,11.36 L92.04,11.16 L92.2,10.77 L92.26,10.53 L92.33,9.56 L92.3,8.99 L92.17,8.5 L92.05,8.37 L91.75,8.4 L91.59,8.2 L91.62,8.03 L91.78,8.0 L91.89,7.91 L91.97,7.74 L92.12,7.22 L92.21,6.66 L92.21,6.41 L92.1,5.96 L92.01,5.41 L92.0,5.12 L92.1,4.78 L92.25,4.5 L92.51,4.42 L92.64,4.31 L92.76,4.16 L92.82,3.99 L92.96,3.26 L92.9,2.55 L92.96,2.36 L93.06,2.24 L93.19,2.33 L93.47,2.32 L93.61,2.39 L93.73,3.77 L93.78,3.93 L93.89,4.06 L94.01,4.04 L94.11,3.85 L94.18,3.61 L94.31,3.56 L94.73,3.82 L94.88,3.63 L94.97,3.34 L95.06,2.82 L95.02,2.35 L94.92,2.17 L94.81,2.21 L94.72,2.33 L94.62,2.41 L94.0,2.65 L94.01,2.13 L94.14,1.35 L94.21,1.1 L94.32,0.98 L94.7,1.21 L94.98,1.59 Z";
  const JAPAN_KYUSHU_PATH = "M72.06,37.01 L72.36,37.14 L72.49,37.15 L72.61,37.09 L72.8,36.91 L72.99,36.78 L73.13,36.85 L73.25,37.01 L73.31,37.23 L73.28,37.47 L73.06,37.97 L72.89,38.51 L73.29,38.61 L73.7,38.59 L73.61,38.93 L73.59,39.22 L73.72,39.36 L73.82,39.54 L73.8,39.71 L73.74,39.88 L73.96,40.12 L73.94,40.29 L73.89,40.47 L73.33,41.61 L73.17,42.19 L73.05,42.83 L72.95,43.3 L72.87,43.78 L72.81,44.31 L72.71,44.85 L72.74,45.32 L72.71,45.81 L72.43,47.03 L72.23,47.01 L71.98,46.86 L71.82,46.88 L71.74,47.15 L71.88,47.71 L71.44,48.36 L70.94,48.8 L70.94,48.6 L70.99,48.44 L71.06,48.32 L71.11,48.16 L71.18,47.65 L71.15,47.13 L71.0,46.47 L70.99,46.24 L71.09,46.15 L71.16,46.12 L71.2,46.03 L71.2,45.81 L71.15,45.65 L71.01,45.6 L70.87,45.6 L70.78,45.84 L70.65,46.31 L70.58,46.78 L70.61,47.04 L70.67,47.27 L70.85,47.65 L70.8,47.88 L70.72,48.06 L70.09,47.66 L69.95,47.63 L69.84,47.54 L69.72,47.01 L69.97,46.88 L70.05,46.82 L70.08,46.65 L70.11,46.13 L69.99,45.7 L69.89,45.54 L69.81,45.37 L69.86,45.0 L69.83,44.54 L69.82,43.9 L69.87,43.79 L70.11,43.66 L70.28,43.32 L70.43,42.92 L70.66,42.24 L70.84,41.49 L70.66,41.46 L70.51,41.32 L70.68,40.97 L70.63,40.52 L70.38,39.98 L70.25,39.33 L70.03,39.05 L69.92,38.95 L69.78,39.1 L69.67,39.28 L69.77,39.7 L69.76,40.07 L69.78,40.43 L69.89,40.45 L70.02,40.36 L70.12,40.43 L70.19,40.62 L70.2,40.87 L70.16,41.11 L70.06,41.24 L69.94,41.23 L69.82,41.09 L69.73,40.9 L69.5,40.8 L69.27,41.02 L69.04,41.48 L68.85,41.71 L68.94,41.37 L68.98,41.01 L68.89,40.75 L68.67,40.32 L68.62,40.08 L68.61,39.78 L68.65,39.48 L68.87,39.82 L68.99,40.24 L69.15,40.43 L69.36,40.43 L69.2,39.81 L69.14,39.65 L68.92,39.37 L68.62,38.9 L68.42,38.68 L68.49,38.19 L68.6,38.09 L68.7,38.12 L69.02,38.29 L69.05,38.04 L69.01,37.91 L68.98,37.76 L69.2,37.55 L69.54,37.38 L69.62,37.3 L69.68,37.12 L69.76,37.03 L70.01,37.03 L70.21,36.86 L70.38,36.41 L70.42,36.16 L70.48,35.95 L70.91,35.58 L71.01,35.53 L71.29,35.57 L71.55,35.78 L71.68,36.22 L71.79,36.69 L72.06,37.01 Z";
  const JAPAN_SHIKOKU_PATH = "M79.31,34.03 L79.63,34.22 L79.95,34.16 L79.95,35.0 L79.99,35.28 L80.09,35.53 L80.04,35.89 L80.18,36.01 L79.75,36.43 L79.36,36.98 L79.2,37.35 L79.05,37.75 L78.97,38.17 L78.91,38.63 L78.78,38.45 L78.41,37.71 L78.17,37.51 L77.78,37.4 L77.66,37.43 L76.87,38.11 L76.77,38.62 L76.55,39.38 L76.45,39.63 L76.34,39.7 L76.26,39.83 L76.17,40.48 L75.92,40.87 L75.77,40.89 L75.52,40.78 L75.4,40.84 L75.56,40.2 L75.31,40.12 L75.07,40.14 L75.06,39.72 L74.92,39.48 L75.02,39.18 L75.03,38.93 L75.09,38.79 L75.11,38.59 L75.11,38.42 L74.96,38.37 L74.86,38.25 L74.88,37.79 L74.79,37.78 L74.58,37.86 L74.14,38.2 L74.01,38.21 L74.2,37.96 L74.6,37.61 L74.77,37.42 L75.16,36.87 L75.41,36.61 L75.53,36.15 L75.57,35.87 L75.66,35.62 L75.73,35.23 L75.85,35.1 L76.07,34.76 L76.2,34.79 L76.34,35.21 L76.52,35.53 L76.66,35.5 L76.9,35.34 L77.02,35.3 L77.3,35.32 L77.55,35.12 L77.65,34.88 L77.69,34.58 L77.59,34.08 L77.71,34.14 L77.83,34.11 L78.1,33.8 L78.38,33.61 L78.67,33.56 L79.0,33.74 L79.31,34.03 Z";
  const JAPAN_TSUSHIMA_PATH = "M67.98,33.58 L67.93,33.8 L67.78,33.65 L67.71,33.51 L67.85,32.82 L67.83,32.56 L67.84,32.43 L68.13,32.07 L68.18,32.14 L68.19,32.24 L68.17,32.39 L68.18,32.73 L67.97,33.3 L67.98,33.58 Z";
  // 长江/黄河：按大致真实流经路线取关键点连线，只为增添地图的真实可信度，不追求逐水文精度
  const YANGTZE_PATH = "M8.96,55.71 L15.8,55.48 L24.46,50.24 L28.8,51.84 L33.58,50.92 L36.55,54.8 L39.74,50.24 L42.48,47.05 L43.84,44.04 L47.26,44.77 L49.54,47.05";
  const YELLOW_RIVER_PATH = "M8.96,26.08 L13.52,19.24 L18.08,14.23 L23.32,10.12 L27.88,11.49 L29.71,16.96 L25.83,31.09 L26.97,32.01 L29.37,32.23 L31.99,31.32 L33.7,30.64 L36.32,24.71 L39.28,21.52 L42.02,19.24 L44.53,18.33";
  // 卫星地形底图（Natural Earth 1:50m 明暗浮雕地形栅格，裁剪范围比矢量海岸线略大，
  // 露出朝鲜半岛/台湾岛等背景陪衬）在同一套归一化坐标系下的放置位置——见 assets/map/relief.jpg
  const MAP_RELIEF_RECT = { x: 0.98, y: 1.01, w: 98.04, h: 98.01 };
  // 城池图样：地图上不再用色块名牌代表城市，改用一座城池剪影图标，按繁荣度星级（Prosper.lv，1~5）
  // 逐级放大、逐级加旗——星级越高的名城，图标越大、越气派（3 级起挂旗，5 级旗更大更醒目），
  // 一眼就能从地图上看出各城的发展规模，不必点进去才知道
  const CITY_ICON_PATH = "M2,22 L2,13 L5,13 L5,9 L9,9 L9,13 L15,13 L15,9 L19,9 L19,13 L22,13 L22,22 Z";
  const CITY_ICON_SIZE = [13, 16, 19, 22, 26];   // 各星级对应的图标边长（px，实际渲染时按缩放比例换算）
  function cityIconSvg(lv) {
    const size = CITY_ICON_SIZE[Math.max(0, Math.min(4, lv - 1))];
    let flag = "", topPad = 0;
    if (lv >= 3) {
      const big = lv >= 5;
      const fh = big ? 10 : 7, fw = big ? 7 : 5;
      topPad = fh + 2;
      flag = `<line x1="12" y1="9" x2="12" y2="${9 - fh}" stroke="#8a6a2a" stroke-width="1"/>
        <path d="M12,${9 - fh} L${12 + fw},${9 - fh + 2} L12,${9 - fh + 4} Z" fill="#e8c25a"/>`;
    }
    const vbH = 24 + topPad;
    return `<svg class="mcity-icon" viewBox="0 -${topPad} 24 ${vbH}" width="${size}" height="${Math.round(size * vbH / 24)}">
      <path d="${CITY_ICON_PATH}" fill="var(--fac)" stroke="#1a1410" stroke-width="1.3"/>${flag}
    </svg>`;
  }
  const MapZoom = { scale: 1, x: 0, y: 0 };
  let MapLegendOpen = false;   // 势力色图例展开态，与 MapZoom 同为模块级、跨 render() 持久
  const MapUI = {
    // 边境战胜负犒赏/赔付：不再是固定数额，改为所夺/被夺城池金币日产出的倍数（约合一月产出），见 resolveBorderWar 的 onDone
    BORDER_WAR_GOLD_DAYS: 30,
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
            ${this.nemesisHtml(m)}
            ${this.estateOverviewHtml(m)}
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
      // 换了写实卫星底图后，原来那条低透明度金色虚线常被复杂地形纹理"吃掉"看不清——每条路都先垫一条
      // 更粗的深色实线做"描边衬底"，再在上面叠一条原有的金色虚线，不论压在山地还是平原上都能看清
      const lines = ROADS.map(([a, b]) => {
        const A = cityDef(a), B = cityDef(b);
        return `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="map-road-halo" vector-effect="non-scaling-stroke"/>`;
      }).join("") + ROADS.map(([a, b]) => {
        const A = cityDef(a), B = cityDef(b);
        return `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="map-road" vector-effect="non-scaling-stroke"/>`;
      }).join("");
      const adj = adjCities(m.curCity);
      const dots = CITIES.map(c => {
        const cls = c.id === m.curCity ? "cur" : adj.includes(c.id) ? "adj" : "far";
        const owner = cityOwnerSide(m, c.id);
        const fid = cityFactionId(m, c.id);
        // 势力色走行内 style（势力多达 22 家，逐一写死 CSS 类不现实）；国别仍留 owner 类名供 .sea 等既有样式挂钩
        const mine = fid && fid === m.playerFaction;
        // 城池图样按繁荣度星级取用不同大小/装饰的图标（见 cityIconSvg）——海路中转站无城建无从算繁荣度，按最低星级处理
        const lv = c.side === "sea" ? 1 : Prosper.lv(m, c.id);
        return `<div class="map-city ${owner} ${cls}${mine ? " mine" : ""}" data-id="${c.id}"
          style="left:${c.x}%;top:${c.y}%;--fac:${factionColor(fid)}">
          ${cityIconSvg(lv)}
          <span class="mcity-name">${c.n}</span>
        </div>`;
      }).join("");
      const legend = this.factionLegendHtml(m);
      return `<div class="map-zoom-layer">
        <svg class="map-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
          <image class="map-relief" href="assets/map/relief.jpg"
            x="${MAP_RELIEF_RECT.x}" y="${MAP_RELIEF_RECT.y}" width="${MAP_RELIEF_RECT.w}" height="${MAP_RELIEF_RECT.h}"
            preserveAspectRatio="none"/>
          <path class="map-land cn" d="${CHINA_LAND_PATH}"/>
          <path class="map-land jp" d="${JAPAN_HONSHU_PATH}"/>
          <path class="map-land jp" d="${JAPAN_KYUSHU_PATH}"/>
          <path class="map-land jp" d="${JAPAN_SHIKOKU_PATH}"/>
          <path class="map-land jp" d="${JAPAN_TSUSHIMA_PATH}"/>
          <path class="map-river" d="${YANGTZE_PATH}"/>
          <path class="map-river" d="${YELLOW_RIVER_PATH}"/>
          ${lines}
        </svg>
        ${dots}
      </div>
      <div class="map-zoom-ctl">
        <button id="map-zoom-in" type="button">＋</button>
        <button id="map-zoom-out" type="button">－</button>
        <button id="map-zoom-focus" type="button" title="聚焦当前城市">🎯</button>
        <button id="map-zoom-overview" type="button" title="显示全景">🗺️</button>
      </div>
      ${legend}`;
    },
    // 势力色图例：默认折叠成一枚小钮，展开后按国别分两栏列出各家色块与当前占城数（占城为 0 的已覆灭势力不列）
    factionLegendHtml(m) {
      const col = side => FACTIONS.filter(f => f.side === side && !DUMMY_FACTIONS.includes(f.id))
        .map(f => {
          const n = CITIES.filter(c => c.side !== "sea" && cityFactionId(m, c.id) === f.id).length;
          if (!n) return "";
          return `<div class="fl-item"><i style="background:${f.color}"></i>${f.n}<b>${n}</b></div>`;
        }).join("");
      let mineHtml = "";
      if (m.playerFaction === "_player_") {
        const n = CITIES.filter(c => c.side !== "sea" && cityFactionId(m, c.id) === "_player_").length;
        mineHtml = `<div class="fl-item"><i style="background:#e8c25a"></i>${factionName("_player_")}<b>${n}</b></div>`;
      }
      return `<div class="map-legend${MapLegendOpen ? " open" : ""}" id="map-legend">
        <button class="fl-toggle" id="fl-toggle" type="button">🎨 势力</button>
        <div class="fl-body">
          <div class="fl-col"><div class="fl-head cn">三国</div>${col("cn")}${mineHtml && RPG.char && RPG.char.side === "cn" ? mineHtml : ""}</div>
          <div class="fl-col"><div class="fl-head jp">战国</div>${col("jp")}${mineHtml && RPG.char && RPG.char.side === "jp" ? mineHtml : ""}</div>
        </div>
      </div>`;
    },
    // 官职/势力/功勋这行文字——在野、仕官、自立三种身份各自的措辞
    identityLine(m) {
      const fid = m.playerFaction;
      if (!fid) return `🚩 ${PlayerRank.rankName(m)}`;
      if (fid === "_player_") return `🚩 ${PlayerRank.rankName(m)}`;
      const next = PlayerRank.nextNeed(m);
      return `🚩 ${PlayerRank.rankName(m)}·${factionDef(fid).n}　功勋 ${m.playerMerit || 0}${next ? `/${next.need}` : "（顶阶）"}`;
    },
    // 身份对应的行动入口：在野→投效，仕官→自立门户，自立→人事+计谋（原「身份」面板的展示部分现已并入本卡片，
    // 只剩「需要发起的动作」还留按钮，且按身份切换措辞与去处，不再是一个万年不变的「🏯 身份」）。
    // 自立后新增「计谋」——此前只有 AI 势力能对敌施计谋，主公亲政却无此入口，明显遗漏，见 openPlot
    identityActionBtnHtml(m) {
      const fid = m.playerFaction;
      if (!fid) return `<button class="cup-go" id="map-join">🏯 投效</button>`;
      if (fid === "_player_") return `<button class="cup-go" id="map-personnel">👑 人事</button><button class="cup-go" id="map-plot">🕵️ 计谋</button>`;
      return `<button class="cup-go" id="map-indep">⚔️ 自立门户</button>`;
    },
    // 金币「日增」估算：势力金库收入（仅自立当主时——势力钱庄税收已与私人钱包合一，见 FactionGold）
    // + 名下各处产业中「已委掌柜」者的逐日代收之和（掌柜代收不问身份，仕官/在野一样适用）
    dailyGoldGain(m) {
      let gain = m.playerFaction === "_player_" ? FactionGold.income(m, "_player_") : 0;
      const ests = Estate.all(m);
      Object.keys(ests).forEach(cid => {
        const est = ests[cid];
        if (est.manager != null && !Estate.sealed(m, cid)) gain += Estate.dailyRate(m, cid);
      });
      return gain;
    },
    // 卡片改为左右两栏：左栏是「你是谁」——头像+姓名+等级（入口不变）与其下的身份行（在野/仕官/当主）；
    // 右栏是「你有什么」——名声、威名（仅自立时有此说）、金币（+日增估算）三行纵向堆叠；
    // 两栏下方另起一条放大字号的行动力+军令行，再下方才是横贯一行的操作大按钮（人事/计谋等），
    // 行动力与军令是每天都要盯着花的硬通货，理应比声望/金币更醒目、且紧挨着要花它们的按钮
    heroCardHtml(m) {
      const c = RPG.char, hg = RPG.heroGeneral();
      const fid = m.playerFaction;
      const lord = Campaign.isLordMode(m);
      const fameLine = `⭐ ${Campaign.fameLabel(m.fame || 0)}`;
      const factionLine = lord ? `🏯 ${FactionFame.tierName(FactionFame.get(m, "_player_"))}（${FactionFame.get(m, "_player_")}）` : "";
      const gain = this.dailyGoldGain(m);
      const goldLine = `💰<b>${Bond.gold()}</b>${gain > 0 ? `<small>（日增约 ${gain}）</small>` : ""}`;
      const statLine = `⚡<b>${m.ap}</b>/${m.apMax}${fid ? ` · 📜<b>${FactionOrders.get(m, fid)}</b>/${FactionOrders.cap(m, fid)}` : ""}`;
      return `<div class="map-hero-card hero-stack ${c.side}">
        <div class="mh-grid">
          <div class="mh-left">
            <div class="mh-top">
              <div class="mh-av" id="mh-avatar-btn" title="角色详情">${avatarChar(c.name)}</div>
              <div class="mh-id">
                <div class="mh-name">${c.name}</div>
                <div class="mh-sub">Lv.${c.level} · ${ratingChip(hg)}</div>
              </div>
            </div>
            <div class="mh-line mh-identity">${this.identityLine(m)}</div>
          </div>
          <div class="mh-right">
            <div class="mh-line">${fameLine}</div>
            ${factionLine ? `<div class="mh-line">${factionLine}</div>` : ""}
            <div class="mh-line">${goldLine}</div>
          </div>
        </div>
        <div class="mh-stat-line">${statLine}</div>
        <div class="mh-act-row">${this.identityActionBtnHtml(m)}</div>
      </div>`;
    },
    // 宿敌：未结缘时不显示；结缘后常驻展示战绩与终局进度，未在应战/拦路等待中时可随时主动下战书
    nemesisHtml(m) {
      const st = m.nemesis;
      if (!st) return "";
      if (st.finaleDone) return "";   // 恩怨已了：宿敌卡隐去，待与新的敌将结怨再现
      const g = DB.get(st.id);
      if (!g) return "";
      const progress = `${st.wins}/${Nemesis.FINALE_WINS}`;
      const canChallenge = !st.ambush && m.ap > 0;
      return `<div class="map-hero-card ${g.side}" style="margin-top:8px">
        <div class="mh-av">${avatarChar(g.name)}</div>
        <div class="mh-meta">
          <div class="mh-name">⚔️ 宿敌·${g.name}</div>
          <div class="mh-sub">战绩 ${st.wins}胜${st.nemesisWins}负 · ${progress}</div>
        </div>
        <div class="mh-action-col">
          <button class="cup-go" id="map-nemesis" ${canChallenge ? "" : "disabled"}>🗡️ 下战书</button>
        </div>
      </div>`;
    },
    // 名下产业总览：有产业才显示，顺带把各处账目懒结算到今天
    estateOverviewHtml(m) {
      const o = Estate.overview(m);
      if (!o) return "";
      return `<div class="mc-sect">🏪 名下产业<small>${o.count} 处 · 待收 ${o.pending} 金</small></div>`;
    },
    // 本地武将：原「游戏信息区域」（天数/行动力/金币/名声已上移顶栏状态条，等级已移入角色资料卡）腾出的位置，
    // 每行 3 个更紧凑；「全部武将」改为与「角色详情」同风格的大按钮，置于名录下方
    localGeneralsHtml(m) {
      const localGenerals = DB.list.filter(g => m.assign[g.id] === m.curCity);
      const appearedHere = localGenerals.filter(g => m.appeared.includes(g.id));
      const gf = m.generalFaction || {};
      // 有了势力之后，"本地武将"不再是一锅端的名录——同僚、他家臣属、在野浪人三者的可为之事截然不同，
      // 分组罗列才好一眼判断：谁可差遣、谁可招揽、谁是敌营耳目
      const mine = [], others = [], ronin = [];
      appearedHere.forEach(g => {
        const fid = gf[g.id];
        if (!fid) ronin.push(g);
        else if (fid === m.playerFaction) mine.push(g);
        else others.push(g);
      });
      const card = (g, extra) => {
        const fid = gf[g.id];
        const lord = fid && isFactionLord(fid, g.id) ? "👑" : "";
        return `<button class="mc-gen ${g.side}${extra || ""}" data-id="${g.id}"${fid ? ` style="--fac:${factionColor(fid)}"` : ""}>
          <span class="mcg-name">${g.name}${lord}</span>${fid && extra === " other" ? `<small class="mcg-fac">${factionName(fid)}</small>` : ""}
        </button>`;
      };
      const group = (title, arr, extra) => arr.length
        ? `<div class="mc-subsect">${title}<small>${arr.length}</small></div>
           <div class="mc-roster narrow triple">${arr.map(g => card(g, extra)).join("")}</div>` : "";
      const body = (mine.length || others.length || ronin.length)
        ? group("🤝 本势力", mine, " mine") + group("⚔️ 他势力", others, " other") + group("🎋 在野", ronin, " ronin")
        : '<div class="empty" style="width:100%;padding:14px 4px;white-space:normal;">这座城暂无现身的武将，游历天下终会遇见他们。</div>';
      return `<div class="mc-sect">🚶 本地武将<small>已现身${appearedHere.length}/${localGenerals.length}</small></div>
        ${body}
        <button class="cup-go allgen-btn" id="map-visit-all" ${m.ap <= 0 ? "disabled" : ""}>🚶 一键拜访（耗 1⚡）</button>`;
    },
    cityPanelHtml(m) {
      const c = cityDef(m.curCity);
      const isSea = c.side === "sea";
      const fac = CITY_FACILITY[m.curCity];
      const bounties = (!isSea && m.bounties[m.curCity]) || [];
      const factor = cityPriceFactor(m.curCity);
      const factorTxt = (factor <= 0.85 ? "黑市八折" : factor < 1 ? "行情便宜" : factor > 1.1 ? "行情偏贵" : "价格公道") + marketTrendSuffix(m, m.curCity);
      const smithType = Armory.TYPES[hashStr(m.curCity) % Armory.TYPES.length];
      const curFid = cityFactionId(m, m.curCity);
      const curFacDef = factionDef(curFid);
      const ownLine = isSea && !isRealFaction(curFid)
        ? `<div class="mc-owner">🌊 海路中转站 · 无主番所</div>`
        : `<div class="mc-owner">🚩 ${facChip(curFid)}<span class="mc-lord">主公 · ${factionLordName(curFid)}</span>${curFid === m.playerFaction ? '<span class="mc-mine">本势力</span>' : ""}${curFacDef ? `<span class="mc-natl ${curFacDef.side}">${sideName(curFacDef.side)}</span>` : ""}</div>`;
      return `<div class="mc-head">
          <span>📍 ${c.n} <small style="color:var(--cn-gold);letter-spacing:1px">${Prosper.stars(m, m.curCity)}</small>${isSea ? '<small>海路中转站</small>' : ''}</span>
        </div>
        ${ownLine}
        <div class="menu map-menu map-menu-free">
          <button class="menu-btn" id="map-forge"><span class="mi">⚒️</span><span>铁匠铺<small>专精${smithType.n}锻造 · 有减免</small></span></button>
          <button class="menu-btn" id="map-shop"><span class="mi">🏪</span><span>集市<small>本地货摊每日上新 · ${factorTxt}</small></span></button>
          ${this.buildBtnHtml(m)}
          ${this.estateBtnHtml(m)}
          ${this.guardBtnHtml(m)}
          ${this.garrisonBtnHtml(m)}
          ${this.sortieBtnHtml(m)}
          ${this.postBtnHtml(m)}
          ${this.rescueBtnHtml(m)}
        </div>
        <div class="menu map-menu map-menu-ap">
          ${fac ? `<button class="menu-btn" id="map-facility" ${m.ap <= 0 ? "disabled" : ""}><span class="mi">${fac.icon}</span><span>${fac.n}<small>设施挑战扬名 · 耗 1⚡</small></span></button>` : ""}
          <button class="menu-btn" id="map-camp"><span class="mi">🏕️</span><span>宿营<small>推进一天 · 行动力回满</small></span></button>
        </div>
        ${bounties.length ? `<div class="mc-sect">📋 悬赏榜<small>1⚡</small></div>
        <div class="mc-bounty-list">${bounties.map(b => `<button class="mc-bounty ${b.legendary ? 'legendary' : ''}" data-uid="${b.uid}" ${m.ap <= 0 ? "disabled" : ""}>
          <div class="mcb-desc">${b.legendary ? '⭐ ' : ''}${b.desc}</div>
          <div class="mcb-reward">赏 ${b.rewardGold} 金 · 名声 +${b.rewardFame}</div>
        </button>`).join("")}</div>` : ""}`;
    },
    // 产业按钮五态：未置办（含敌占不可置办）/ 敌营产业（敌占经营中 / 己方夺城后可接管）/ 已置办待收 / 已置办被查封
    estateBtnHtml(m) {
      const t = Estate.typeOf(m.curCity);
      if (!t) return "";
      const est = Estate.get(m, m.curCity);
      const sealed = Estate.sealed(m, m.curCity);
      if (!est) {
        const npc = Estate.npcGet(m, m.curCity);
        if (npc) {
          if (sealed) return `<button class="menu-btn" id="map-estate" disabled><span class="mi">${t.icon}</span><span>敌营${t.lvN[npc.lv - 1]}<small>敌方经营中 · 夺城后可低价接管</small></span></button>`;
          return `<button class="menu-btn" id="map-estate" ${m.ap <= 0 ? "disabled" : ""}><span class="mi">${t.icon}</span><span>接管${t.lvN[npc.lv - 1]}<small>敌产充公 · ${Estate.takeoverPrice(m, m.curCity)} 金 · 耗 1⚡</small></span></button>`;
        }
        return `<button class="menu-btn" id="map-estate" ${(m.ap <= 0 || sealed) ? "disabled" : ""}><span class="mi">${t.icon}</span><span>置办${t.n}<small>${sealed ? "敌占之城无法置业" : `${t.cost} 金 · 日进约 ${t.rate} 金 · 耗 1⚡`}</small></span></button>`;
      }
      Estate.accrue(m, m.curCity);
      Campaign.save();
      const parts = [];
      if (est.manager != null) parts.push(`掌柜代收中·日进 ${Estate.dailyRate(m, m.curCity)} 金`);
      if (est.pending) parts.push(`待收 ${est.pending} 金`);
      if (est.matPending) parts.push(`材料 ${est.matPending} 份`);
      if (!parts.length) parts.push(`日进 ${Estate.dailyRate(m, m.curCity)} 金`);
      // 今日产业行情：常规 ±15% 波动不特别提示，只在触发「丰收/歉收」这类明显大幅摆动的日子才标出来
      const todayTrend = Estate.dailyNoiseMul(m.curCity, m.day).tag;
      if (todayTrend === "harvest") parts.push(`🎉 今日丰收`);
      else if (todayTrend === "lean") parts.push(`⚠️ 今日歉收`);
      return `<button class="menu-btn" id="map-estate"><span class="mi">${t.icon}</span><span>${Estate.lvName(m, m.curCity)}<small>${sealed ? "⛔ 已被查封 · 夺回城池后恢复" : parts.join(" · ")}</small></span></button>`;
    },
    // 城建按钮：显示本城已修建筑概览（敌占城市仍可入内查看，面板内不可捐修）
    buildBtnHtml(m) {
      const opts = cityBuildOptions(m.curCity);
      if (!opts.length) return "";
      const built = opts.filter(t => Buildings.lv(m, m.curCity, t) > 0)
        .map(t => `${BUILD_TYPES[t].icon}${BUILD_TYPES[t].n}${Buildings.lv(m, m.curCity, t)}级`);
      const sealed = Buildings.sealed(m, m.curCity);
      return `<button class="menu-btn" id="map-build"><span class="mi">🏗️</span><span>城建<small>${sealed ? (built.length ? `敌占 · ${built.join(" · ")}` : "敌占之城 · 只可远观") : built.length ? built.join(" · ") : "捐资兴建公共建筑 · 泽被乡里"}</small></span></button>`;
    },
    // 牢狱营救：本城大牢关着被俘的己方守将时显示
    rescueBtnHtml(m) {
      const capt = Guard.heldAt(m, m.curCity);
      if (!capt.length) return "";
      return `<button class="menu-btn" id="map-rescue"><span class="mi">⛓️</span><span>牢狱营救<small>${capt.map(g => g.name).join("、")} 被囚于此</small></span></button>`;
    },
    // 守将按钮：本势力城池（非海路中转）可委任守将，独立于城建按钮——委任守将是政治/军事举措，
    // 须效力于据有此城的势力，不像集市/铁匠铺等经济活动那样只要同属本国即可
    guardBtnHtml(m) {
      if (!isMyCity(m, m.curCity) || cityDef(m.curCity).side === "sea") return "";
      const guard = Guard.of(m, m.curCity);
      return `<button class="menu-btn" id="map-guard"><span class="mi">🛡️</span><span>守将<small>${guard ? `${guard.name} 驻守 · 六维+${Guard.STAT_BONUS}` : "空缺 · 可委任驻守"}</small></span></button>`;
    },
    // 驻军按钮：本势力城池可查看驻军存量并募兵——驻军是势力交战的本钱，须效力于据有此城的势力才能调度。
    // 对马岛（海路中转）虽无法筑城建，但驻军照常可募可回复，否则占岛之后无兵可用、无法借道继续攻略对岸
    garrisonBtnHtml(m) {
      if (!isMyCity(m, m.curCity)) return "";
      const have = Garrison.get(m, m.curCity), cap = Garrison.cap(m, m.curCity);
      const pop = Population.get(m, m.curCity);
      return `<button class="menu-btn" id="map-garrison"><span class="mi">🚩</span><span>驻军<small>${have.toLocaleString()}/${cap.toLocaleString()}${have >= cap ? "（满编）" : ""} · 人口 ${pop.toLocaleString()}</small></span></button>`;
    },
    // 驿站快马按钮：本城已建驿站（≥1级）才显示，独立于城建按钮
    postBtnHtml(m) {
      if (Buildings.lv(m, m.curCity, "post") < 1) return "";
      const n = Buildings.postDests(m).length;
      return `<button class="menu-btn" id="map-post"><span class="mi">🏇</span><span>驿站快马<small>${n ? `可达 ${n} 城` : "尚无可达之处"}</small></span></button>`;
    },
    bind(m) {
      $$(".map-city").forEach(el => el.onclick = () => this.moveTo(el.dataset.id));
      $$(".mc-gen").forEach(el => el.onclick = () => { const g = DB.get(+el.dataset.id); if (g) showDetail(g); });
      $$(".mc-bounty").forEach(el => el.onclick = () => this.acceptBounty(m.curCity, el.dataset.uid));
      const shopBtn = $("#map-shop"); if (shopBtn) shopBtn.onclick = () => this.openMarket();
      const forgeBtn = $("#map-forge"); if (forgeBtn) forgeBtn.onclick = () => this.openForge();
      const facBtn = $("#map-facility"); if (facBtn) facBtn.onclick = () => this.openFacility();
      const estBtn = $("#map-estate"); if (estBtn) estBtn.onclick = () => this.openEstate();
      const buildBtn = $("#map-build"); if (buildBtn) buildBtn.onclick = () => this.openBuild();
      const guardBtn = $("#map-guard"); if (guardBtn) guardBtn.onclick = () => this.openGuard();
      const garrisonBtn = $("#map-garrison"); if (garrisonBtn) garrisonBtn.onclick = () => this.openGarrison();
      const sortieBtn = $("#map-sortie"); if (sortieBtn) sortieBtn.onclick = () => this.openSortie();
      const postBtn = $("#map-post"); if (postBtn) postBtn.onclick = () => this.openPostTravel(m);
      const rescueBtn = $("#map-rescue"); if (rescueBtn) rescueBtn.onclick = () => this.openRescue();
      const campBtn = $("#map-camp"); if (campBtn) campBtn.onclick = () => this.camp();
      // 角色详情改由头像直接触发，不再另占一个按钮
      const avatarBtn = $("#mh-avatar-btn"); if (avatarBtn) avatarBtn.onclick = () => RPG.open();
      const joinBtn = $("#map-join"); if (joinBtn) joinBtn.onclick = () => this.openJoin();
      const personnelBtn = $("#map-personnel"); if (personnelBtn) personnelBtn.onclick = () => this.openPersonnel();
      const indepBtn2 = $("#map-indep"); if (indepBtn2) indepBtn2.onclick = () => this.tryDeclareIndependence();
      const plotBtn = $("#map-plot"); if (plotBtn) plotBtn.onclick = () => this.openPlot();
      // 图例只切换自身 class，不整体重渲染——避免展开/收起时地图缩放态被重置
      const flBtn = $("#fl-toggle"); if (flBtn) flBtn.onclick = () => { MapLegendOpen = !MapLegendOpen; const el = $("#map-legend"); if (el) el.classList.toggle("open", MapLegendOpen); };
      const nemBtn = $("#map-nemesis"); if (nemBtn) nemBtn.onclick = () => { if (spendAP()) Nemesis.duel(m); };
      const allGenBtn = $("#map-all-gens"); if (allGenBtn) allGenBtn.onclick = () => AllGenUI.open();
      const allCityBtn = $("#map-all-cities"); if (allCityBtn) allCityBtn.onclick = () => AllCityUI.open();
      const allFacBtn = $("#map-all-facs"); if (allFacBtn) allFacBtn.onclick = () => AllFacUI.open();
      const visitAllBtn = $("#map-visit-all"); if (visitAllBtn) visitAllBtn.onclick = () => this.oneClickVisit();
    },
    // 地图缩放/拖动：鼠标拖拽、触控拖拽、双指捏合缩放、滚轮缩放、右上角 +/- 按钮；缩放状态跨渲染持久（MapZoom 为模块级变量）
    applyZoom(box) {
      const layer = box.querySelector(".map-zoom-layer");
      if (layer) layer.style.transform = `translate(${MapZoom.x}px,${MapZoom.y}px) scale(${MapZoom.scale})`;
      // 城池图标/城名要按固定视觉大小显示、不随地图放大而跟着变大变小——图标本身仍在会被整体
      // scale() 的 .map-zoom-layer 里（这样它们的锚点位置才能继续跟着地图缩放/平移走），
      // 于是在 .map-city 上叠一个反向的 scale(1/MapZoom.scale)抵消掉，二者相乘净效果就是"位置跟着
      // 地图走、尺寸不跟着变"；CSS 变量挂在 box 上，.map-city 作为其后代天然继承
      box.style.setProperty("--zk", (1 / MapZoom.scale).toFixed(4));
    },
    // 以屏幕上某一点为不动点缩放（双击/双触摸点按位置放大用）：先按当前缩放/平移状态反推出
    // 该屏幕点对应的地图归一化坐标，换到目标缩放倍数后，再反过来解出让这一坐标仍显示在同一
    // 屏幕点所需的新平移量——这样双击哪里就以哪里为中心放大，而不是永远从画面正中心放大
    zoomAtPoint(box, clientX, clientY, targetScale) {
      const rect = box.getBoundingClientRect();
      const px = clientX - rect.left, py = clientY - rect.top;
      const cx = rect.width / 2, cy = rect.height / 2;
      const origX = cx + (px - MapZoom.x - cx) / MapZoom.scale;
      const origY = cy + (py - MapZoom.y - cy) / MapZoom.scale;
      MapZoom.scale = targetScale;
      MapZoom.x = px - (cx + MapZoom.scale * (origX - cx));
      MapZoom.y = py - (cy + MapZoom.scale * (origY - cy));
      this.clampZoomState(box);
      this.applyZoom(box);
    },
    clampZoomState(box) {
      MapZoom.scale = Math.min(8, Math.max(1, MapZoom.scale));
      const rect = box.getBoundingClientRect();
      // 平移边界严格卡死在地图实际范围内，不再额外放宽 40px——放宽的那部分露出的是地图之外
      // 空空如也的容器背景（并非真的还有地图），换了写实卫星底图后这块空白格外扎眼，故收紧
      const maxX = (MapZoom.scale - 1) * rect.width / 2;
      const maxY = (MapZoom.scale - 1) * rect.height / 2;
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
      let lastTapTime = 0, lastTapX = 0, lastTapY = 0;   // 双击/双触摸点按放大用，见 onUp
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
          else {
            // 双击/双触摸点按放大：与上一次点按的时间、位置都足够接近才算——点在哪就以哪为中心放大，
            // 每次放大到当前倍数的两倍（封顶 8 倍），而不是一步到位跳到最大，手感更接近常见地图应用
            const now = Date.now();
            const tapDist = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY);
            if (now - lastTapTime < 350 && tapDist < 30) {
              this.zoomAtPoint(box, e.clientX, e.clientY, Math.min(8, MapZoom.scale * 2));
              lastTapTime = 0;
            } else {
              lastTapTime = now; lastTapX = e.clientX; lastTapY = e.clientY;
            }
          }
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
      const inBtn = $("#map-zoom-in"); if (inBtn) inBtn.onclick = () => zoomStep(0.7);
      const outBtn = $("#map-zoom-out"); if (outBtn) outBtn.onclick = () => zoomStep(-0.7);
      const focusBtn = $("#map-zoom-focus"); if (focusBtn) focusBtn.onclick = () => this.focusCurCity(box);
      const overviewBtn = $("#map-zoom-overview"); if (overviewBtn) overviewBtn.onclick = () => { MapZoom.scale = 1; MapZoom.x = 0; MapZoom.y = 0; this.applyZoom(box); };
    },
    // 聚焦当前城市：以其相对坐标为中心放大（越靠近地图边缘，越可能被 clampZoomState 的平移边界收紧，属预期内的安全兜底）
    focusCurCity(box) {
      const m = Campaign.mapState(); if (!m) return;
      const c = cityDef(m.curCity); if (!c) return;
      const rect = box.getBoundingClientRect();
      MapZoom.scale = 4.5;
      MapZoom.x = MapZoom.scale * rect.width * (0.5 - c.x / 100);
      MapZoom.y = MapZoom.scale * rect.height * (0.5 - c.y / 100);
      this.clampZoomState(box);
      this.applyZoom(box);
    },
    /* ---- 集市：每城每（游戏）日一批本地货摊，价格按城市行情浮动；已购摊位当日售罄 ----
     * 买入（本地货摊）与卖出（贩卖随身宝物）分成两个页签展示，避免两份列表堆叠在同一屏内反复上下滚动；
     * 页签内均按价格从高到低排序，弹窗尽量占满可视高度以容纳更多条目。 */
    openMarket(tab) {
      const m = Campaign.mapState();
      const c = cityDef(m.curCity);
      if (tab) this._marketTab = tab;
      const marketTab = this._marketTab === "sell" ? "sell" : "buy";
      const factor = shopDiscountActive() ? Math.min(0.8, cityPriceFactor(m.curCity)) : cityPriceFactor(m.curCity);
      const key = m.curCity + "|" + m.day;
      if (!m.marketSold) m.marketSold = {};
      const sold = m.marketSold[key] || (m.marketSold[key] = []);
      const stalls = cityMarketStalls(m);
      const stallOrder = stalls.map((s, i) => i)
        .sort((i1, i2) => Armory.shopPrice(stalls[i2].rarity) - Armory.shopPrice(stalls[i1].rarity));
      // 行商贩卖：把随身携带的宝物卖给本城行商，按本城真实行情结算（不受折扣事件影响，折扣只降买价不压卖价）——
      // 异地买贱、本城卖贵方能吃到差价，这正是"跨城倒卖"的核心玩法
      const tradable = Armory.data.items.filter(i => i.identified !== false && !i.equippedBy)
        .slice().sort((a, b) => Armory.tradeSellPrice(b, m.curCity) - Armory.tradeSellPrice(a, m.curCity));
      const buyHtml = stallOrder.map(i => {
        const s = stalls[i];
        const type = Armory.typeDef(s.type), rar = Armory.rarityDef(s.rarity);
        const price = Math.round(Armory.shopPrice(s.rarity) * factor);
        if (sold.includes(i)) return `<div class="buff-btn sold"><span class="bi">${type.icon}</span><span class="bt"><b>${s.tmpl.n}</b><small>已售出</small></span></div>`;
        return `<button class="buff-btn market-buy" data-i="${i}"><span class="bi">${type.icon}</span><span class="bt"><b style="color:${rar.color}">${s.tmpl.n}</b><small>${rar.n} · ${s.tmpl.intro}</small></span><span class="mkt-price">💰${price}</span></button>`;
      }).join("");
      const sellHtml = tradable.length ? tradable.map(item => {
        const rar = Armory.rarityDef(item.rarity);
        const price = Armory.tradeSellPrice(item, m.curCity);
        return `<button class="buff-btn market-sell" data-uid="${item.uid}"><span class="bi">${item.icon}</span><span class="bt"><b style="color:${rar.color}">${item.name}</b><small>${rar.n} · ${item.intro}</small></span><span class="mkt-price">💰${price}</span></button>`;
      }).join("") : `<div class="empty">身上暂无可贩卖的宝物</div>`;
      // 一键卖出：仅批量处理非传奇宝物（传奇宝物贵重，须逐件亲自确认，不纳入一键批处理，避免误卖）
      const bulkTargets = tradable.filter(item => item.rarity !== "legend");
      const bulkTotal = bulkTargets.reduce((s, item) => s + Armory.tradeSellPrice(item, m.curCity), 0);
      // 一键买入：本城今日在售、尚未售罄的全部货摊一次买下，不区分是否传奇（买入不像卖出那样有"手滑卖掉传家宝"的风险，
      // 无需逐件确认；总价一次性核验够不够钱，钱不够就整单作罢，不做"买到哪算哪"的半吊子结算）
      const bulkBuyTargets = stallOrder.filter(i => !sold.includes(i));
      const bulkBuyTotal = bulkBuyTargets.reduce((s, i) => s + Math.round(Armory.shopPrice(stalls[i].rarity) * factor), 0);
      openOverlay(`<div class="result-card detail-card market-card">
        <h1>🏪 ${c.n}集市</h1>
        <div class="wdesc">💰 现有 ${Bond.gold()} 金 · 货摊每日更新</div>
        <div class="mkt-tabs">
          <div class="mkt-tab ${marketTab === "buy" ? "active" : ""}" data-tab="buy">🛒 买入</div>
          <div class="mkt-tab ${marketTab === "sell" ? "active" : ""}" data-tab="sell">🚢 卖出</div>
        </div>
        <div class="wdesc mkt-hint">${marketTab === "buy"
          ? `本地行情：${factor <= 0.85 ? "🈹 黑市/折扣价" : factor < 1 ? "💰 偏低" : factor > 1.1 ? "📈 偏贵" : "⚖️ 公道"}（约 ${Math.round(factor * 100)}% 市价）${marketTrendSuffix(m, m.curCity)}`
          : `按本城真实行情结算（本城约 ${Math.round(cityPriceFactor(m.curCity) * 100)}% 市价 × 85%）；低价城买、高价城卖方能赚得差价${marketTrendSuffix(m, m.curCity)}`}</div>
        ${marketTab === "buy" && bulkBuyTargets.length ? `<div class="btns" style="margin:6px 0 0"><button class="btn-ghost" id="market-buy-all">🛒 一键买入所有宝物（${bulkBuyTargets.length} 件 · 约 ${bulkBuyTotal} 金）</button></div>` : ""}
        ${marketTab === "sell" && bulkTargets.length ? `<div class="btns" style="margin:6px 0 0"><button class="btn-ghost" id="market-sell-all">🚢 一键卖出非传奇宝物（${bulkTargets.length} 件 · 约 ${bulkTotal} 金）</button></div>` : ""}
        <div class="buff-list mkt-list">${marketTab === "buy" ? buyHtml : sellHtml}</div>
        <div class="btns"><button class="btn-ghost" id="market-close">离开集市</button></div></div>`, { modal: true });
      $$(".mkt-tab").forEach(t => t.onclick = () => this.openMarket(t.dataset.tab));
      $$(".market-buy").forEach(b => b.onclick = () => {
        const i = +b.dataset.i, s = stalls[i];
        const price = Math.round(Armory.shopPrice(s.rarity) * factor);
        if (!Bond.spend(price)) { toast(`金币不足（需 ${price} 金）`); return; }
        const item = Armory.makeItem(s.type, s.rarity, s.tmpl);
        Armory.data.items.push(item); Armory.save();
        sold.push(i); Campaign.save();
        AudioSystem.sfx.select();
        toast(`已购得 ${item.icon}「${item.name}」（${Armory.rarityDef(s.rarity).n}）-${price}金`);
        this.render();       // 集市悬浮层之下的城池面板不在 openMarket 的重绘范围内，需单独刷新其金币显示
        this.openMarket();   // 重开以刷新售罄状态与余额
      });
      // 传奇宝物贩卖须二次确认，避免误触失手卖掉贵重之物；其余稀有度维持单击即卖
      $$(".market-sell").forEach(b => b.onclick = () => {
        const uid = +b.dataset.uid;
        const item = Armory.data.items.find(i => i.uid === uid);
        if (item && item.rarity === "legend" && !confirm(`「${item.name}」是传奇级宝物，确定要贩卖换钱吗？此举无法撤销。`)) return;
        if (Armory.tradeSell(uid, m.curCity)) {
          AudioSystem.sfx.select();
          this.render();     // 同上：贩卖后同样要刷新集市悬浮层背后的城池面板金币数
          this.openMarket();
        }
      });
      const sellAllBtn = $("#market-sell-all");
      if (sellAllBtn) sellAllBtn.onclick = () => {
        if (!confirm(`一键卖出 ${bulkTargets.length} 件非传奇宝物，合计约得 ${bulkTotal} 金，确定继续？此举无法撤销。`)) return;
        bulkTargets.forEach(item => Armory.tradeSell(item.uid, m.curCity));
        AudioSystem.sfx.select();
        this.render();
        this.openMarket("sell");
      };
      const buyAllBtn = $("#market-buy-all");
      if (buyAllBtn) buyAllBtn.onclick = () => {
        if (!confirm(`一键买入本城全部 ${bulkBuyTargets.length} 件在售宝物，合计约需 ${bulkBuyTotal} 金，确定继续？`)) return;
        if (Bond.gold() < bulkBuyTotal) { toast(`金币不足（需 ${bulkBuyTotal} 金）`); return; }
        bulkBuyTargets.forEach(i => {
          const s = stalls[i];
          const price = Math.round(Armory.shopPrice(s.rarity) * factor);
          if (!Bond.spend(price)) return;
          Armory.data.items.push(Armory.makeItem(s.type, s.rarity, s.tmpl));
          sold.push(i);
        });
        Armory.save(); Campaign.save();
        AudioSystem.sfx.select();
        toast(`已买入 ${bulkBuyTargets.length} 件宝物，共花费 ${bulkBuyTotal} 金`);
        this.render();
        this.openMarket("buy");
      };
      $("#market-close").onclick = () => { closeOverlay(); this.render(); };
    },
    /* ---- 铁匠铺：各城专精一类宝物，锻造专精类省料省钱 ---- */
    openForge() {
      const m = Campaign.mapState();
      const c = cityDef(m.curCity);
      const specialty = Armory.TYPES[hashStr(m.curCity) % Armory.TYPES.length];
      // 名声达「名满天下」（第 7 阶）起，铁匠铺待你如上宾，专精类锻造再减免；城市繁荣 ≥4 星专精工钱再降三成
      const highFame = Campaign.fameTierIndex(Campaign.effFame(m)) >= 7;
      const prosperous = Prosper.lv(m, m.curCity) >= 4;
      const specMat = highFame ? 4 : 5;
      const specGold = Math.round((highFame ? 20 : 30) * (prosperous ? 0.7 : 1));
      openOverlay(`<div class="result-card detail-card">
        <h1>⚒️ ${c.n}铁匠铺</h1>
        <div class="wdesc">本铺专精<b style="color:var(--cn-gold)">${specialty.icon}${specialty.n}</b>：锻${specialty.n}只需材料 ${specMat} + ${specGold} 金（其余类型 6 + 40 金）${highFame ? '<br>⭐ 声望崇高，本铺特惠加码' : ''}${prosperous ? '<br>🏙️ 市面繁荣（★4+），专精工钱再降三成' : ''} · 💰 现有 ${Bond.gold()} 金</div>
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
        <div class="btns"><button class="btn-ghost" id="forge-close">离开铁匠铺</button></div></div>`, { modal: true });
      $$(".smith-forge").forEach(b => b.onclick = () => {
        const typeK = b.dataset.type;
        const isSpec = typeK === specialty.k;
        if (Armory.forge(typeK, isSpec ? { matCost: specMat, goldCost: specGold } : undefined)) this.openForge();
      });
      $("#forge-close").onclick = () => { closeOverlay(); this.render(); };
    },
    /* ---- 产业面板：置办 / 收取 / 委任掌柜 / 变卖（城市经营一期） ---- */
    openEstate() {
      const m = Campaign.mapState();
      const cityId = m.curCity;
      const t = Estate.typeOf(cityId);
      if (!t) return;
      const est = Estate.get(m, cityId);
      // 敌营产业：己方夺城后可按累计造价五成接管（敌占期间只可远观）
      const npc = !est && Estate.npcGet(m, cityId);
      if (npc) {
        if (Estate.sealed(m, cityId)) { toast(`敌营产业经营中，夺回城池后可低价接管`); return; }
        const price = Estate.takeoverPrice(m, cityId);
        openOverlay(`<div class="result-card detail-card">
          <h1>${t.icon} 接管${cityName(cityId)}敌营产业</h1>
          <div class="wdesc">敌营苦心经营的「<b>${t.lvN[npc.lv - 1]}</b>」（${npc.lv} 级）已随城易主，可按其累计造价五成接管为自家产业（等级保留）。<br>接管价 <b style="color:#b8860b">${price}</b> 金（现有 ${Bond.gold()} 金），接管后日进约 <b style="color:#b8860b">${Math.round(t.rate * Estate.LV_MULT[npc.lv - 1])}</b> 金起。</div>
          <div class="btns">
            <button class="btn-primary" id="est-take" ${m.ap <= 0 ? "disabled" : ""}>接管（耗 1⚡）</button>
            <button class="btn-ghost" id="est-close">再想想</button>
          </div>
        </div>`, { modal: true });
        $("#est-take").onclick = () => { if (Estate.takeover(m, cityId)) { closeOverlay(); this.render(); } };
        $("#est-close").onclick = () => closeOverlay();
        return;
      }
      // 未置办：置办确认页
      if (!est) {
        if (Estate.sealed(m, cityId)) { toast(`敌占之城无法置业，待己方夺回再来`); return; }
        openOverlay(`<div class="result-card detail-card">
          <h1>${t.icon} 置办${cityName(cityId)}${t.n}</h1>
          <div class="wdesc">${t.desc}。<br>置办价 <b style="color:#b8860b">${t.cost}</b> 金（现有 ${Bond.gold()} 金），日进约 <b style="color:#b8860b">${t.rate}</b> 金，须本人到城收取；最多积攒 ${Estate.ACCRUE_CAP_DAYS} 天。<br><small>⚠️ 城池若被敌方攻占，产业将被查封停产，直至己方夺回。</small></div>
          <div class="btns">
            <button class="btn-primary" id="est-buy" ${m.ap <= 0 ? "disabled" : ""}>置办（耗 1⚡）</button>
            <button class="btn-ghost" id="est-close">再想想</button>
          </div>
        </div>`, { modal: true });
        $("#est-buy").onclick = () => { if (Estate.buy(m, cityId)) { closeOverlay(); this.render(); } };
        $("#est-close").onclick = () => closeOverlay();
        return;
      }
      // 已置办：经营面板
      Estate.accrue(m, cityId);
      Campaign.save();
      const sealed = Estate.sealed(m, cityId);
      const lv = Estate.lvOf(est);
      const lvName = t.lvN[lv - 1];
      const mgr = est.manager != null ? DB.get(est.manager) : null;
      const bonus = Estate.managerBonus(est.manager);
      const rate = Estate.dailyRate(m, cityId);
      const matType = Armory.TYPES[hashStr(cityId) % Armory.TYPES.length];
      const canCollect = !sealed && ((est.pending || 0) > 0 || (est.matPending || 0) > 0);
      const needStar = lv < 3 ? Estate.UP_PROSPER_NEED[lv] : 0;
      const starLack = lv < 3 && Prosper.lv(m, cityId) < needStar;
      openOverlay(`<div class="result-card detail-card">
        <h1>${t.icon} ${cityName(cityId)} · ${lvName}${lv > 1 ? `（${lv} 级）` : ""}</h1>
        ${sealed ? `<div class="wdesc" style="color:var(--cn-red)"><b>⛔ 产业已被敌方查封</b>——停产且不可收取/变卖，待己方夺回此城自动恢复。</div>` : ""}
        <div class="wdesc">日进 <b style="color:#b8860b">${rate}</b> 金（${lv > 1 ? `${lv} 级 ×${Estate.LV_MULT[lv - 1]}，` : ""}繁荣 ${Prosper.stars(m, cityId)} ×${Prosper.mult(m, cityId).toFixed(1)}${mgr ? `，掌柜 +${bonus}%` : ""}） · 待收 <b style="color:#b8860b">${est.pending || 0}</b> 金${est.manager != null ? `<br>🤝 掌柜逐日代收金币直接入账（累计已代收 <b style="color:#b8860b">${est.banked || 0}</b> 金）${est.type === "mine" ? `，矿山材料亦一并代收入库（累计 <b>${est.matBanked || 0}</b> 份）` : ""}` : `（上限 ${rate * Estate.ACCRUE_CAP_DAYS}）`}${est.type === "mine" ? `<br>⛏️ 待收${matType.n}材料 <b>${est.matPending || 0}</b> 份（每满 ${Estate.MINE_DAYS[lv - 1]} 天 +1，上限 ${Estate.MAT_CAP_BY_LV[lv - 1]}）` : ""}${est.type === "caravan" ? `<br>🚢 商队行情：收取时浮动六成～一倍四` : ""}<br>🤝 掌柜：${mgr ? `<b>${mgr.name}</b>（收益 +${bonus}%）` : "空缺（可委任友谊满上限的武将，按其智力+政治提升收益，并逐日代收金币与矿山材料）"}</div>
        <div class="btns">
          <button class="btn-primary" id="est-collect" ${canCollect ? "" : "disabled"}>💰 收取进账</button>
          ${lv < 3 ? `<button class="btn-ghost" id="est-up" ${sealed ? "disabled" : ""}>扩建为「${t.lvN[lv]}」（${Estate.upCost(cityId, lv + 1)} 金 · 收益 ×${Estate.LV_MULT[lv]}${starLack ? ` · 需繁荣 ${"★".repeat(needStar)}` : ""}）</button>` : ""}
          <button class="btn-ghost" id="est-mgr">${mgr ? "更换掌柜" : "委任掌柜"}</button>
          ${mgr ? `<button class="btn-ghost" id="est-mgr-out">解任掌柜</button>` : ""}
          <button class="btn-ghost" id="est-sell" ${sealed ? "disabled" : ""}>变卖（回收 ${Math.round(Estate.cumCost(cityId, lv) * Estate.SELL_FACTOR)} 金+未收账款）</button>
          <button class="btn-ghost" id="est-close">离开</button>
        </div>
      </div>`, { modal: true });
      $("#est-collect").onclick = () => { closeOverlay(); this.collectEstate(cityId); };
      const upBtn = $("#est-up");
      if (upBtn) upBtn.onclick = () => { if (Estate.upgrade(m, cityId)) this.openEstate(); };
      $("#est-mgr").onclick = () => this.openEstateManagerPicker(m, cityId);
      const outBtn = $("#est-mgr-out");
      if (outBtn) outBtn.onclick = () => { Estate.dismissManager(m, cityId); toast(`掌柜已卸任归乡`); this.openEstate(); };
      $("#est-sell").onclick = () => { if (Estate.sell(m, cityId)) { closeOverlay(); this.render(); } };
      $("#est-close").onclick = () => { closeOverlay(); this.render(); };
    },
    openEstateManagerPicker(m, cityId) {
      const cands = Estate.eligibleManagers(m).sort((a, b) => Estate.managerBonus(b.id) - Estate.managerBonus(a.id));
      openOverlay(`<div class="result-card detail-card">
        <h1>🤝 委任掌柜</h1>
        <div class="wdesc">从<b>友谊满上限（${Bond.MAX_FRIEND}）</b>且不在团队中的武将里遴选，掌柜将常驻本城打理产业；收益加成 =（智力+政治）÷4，封顶 +${Estate.MANAGER_BONUS_MAX}%。</div>
        ${cands.length ? `<div class="menu" style="max-height:40vh;overflow-y:auto">${cands.map(g => `<button class="menu-btn est-mgr-cand" data-id="${g.id}"><span class="mi">${g.side === "cn" ? "🇨🇳" : "🇯🇵"}</span><span>${g.name}<small>智${g.zhi} 政${g.zheng} · 收益 +${Estate.managerBonus(g.id)}%</small></span></button>`).join("")}</div>` : `<div class="wdesc">暂无人选——先与武将处出满上限的交情吧（赠礼/拜访/切磋皆可积累友谊）。</div>`}
        <div class="btns"><button class="btn-ghost" id="est-mgr-back">返回</button></div>
      </div>`, { modal: true });
      $$(".est-mgr-cand").forEach(el => el.onclick = () => { Estate.appoint(m, cityId, +el.dataset.id); this.openEstate(); });
      $("#est-mgr-back").onclick = () => this.openEstate();
    },
    /* ---- 城建面板：本城全部城建的捐修/升级。行内布局：标题行（图标+名称+放大的等级数字+星级+
       同行右侧的当前效果，一行不换行，效果文字过长则省略号截断）；标题行下方另起一行放"升级后
       效果/兴建耗费"与操作按钮——此前挤在同一处 small 标签里，效果预览+花费经常被截断看不见。 ---- */
    openBuild() {
      const m = Campaign.mapState();
      const cityId = m.curCity;
      const opts = cityBuildOptions(cityId);
      if (!opts.length) return;
      const sealed = Buildings.sealed(m, cityId);
      const matType = Armory.TYPES[hashStr(cityId) % Armory.TYPES.length];
      const rows = opts.map(t => {
        const bt = BUILD_TYPES[t];
        const lv = Buildings.lv(m, cityId, t);
        const maxed = lv >= Buildings.MAX_LV;
        const maxLv = Buildings.MAX_LV;
        const curEff = lv > 0 ? bt.eff(lv) : "未建";
        let nextLine, action = "";
        if (maxed) nextLine = "已至顶级";
        else if (sealed) nextLine = "敌占之城无法捐修";
        else {
          const cost = Buildings.COSTS[lv];
          nextLine = `${lv === 0 ? "兴建" : `升至 ${lv + 1} 级`}：${bt.eff(lv + 1)} · 耗 ${cost.gold}金${cost.mats ? `+${matType.n}×${cost.mats}` : ""}`;
          action = `<button class="bld-up-btn" data-t="${t}">${lv === 0 ? "兴建" : "升级"}</button>`;
        }
        return `<div class="bld-row${maxed || sealed ? " maxed" : ""}">
          <div class="bld-row-head">
            <span class="mi">${bt.icon}</span><b class="bld-name">${bt.n}</b><b class="bld-lv">${lv}级</b>
            <span class="bld-stars">${"★".repeat(lv)}${"☆".repeat(maxLv - lv)}</span>
            <span class="bld-eff-now">${curEff}</span>
          </div>
          <div class="bld-row-next"><small>${nextLine}</small>${action}</div>
        </div>`;
      }).join("");
      openOverlay(`<div class="result-card detail-card">
        <h1>🏗️ ${cityName(cityId)} · 城建</h1>
        ${sealed ? `<div class="wdesc bld-desc" style="color:var(--cn-red)">⛔ 此城现为敌占——建筑为敌所用（城墙助其守城），夺回后原级保留、即刻为你效力。</div>` : `<div class="wdesc bld-desc"><small>捐修花金币与本城专精材料（${matType.n}），不耗行动力；等级越高对繁荣度的贡献越大。</small></div>`}
        <div class="bld-list">${rows}</div>
        <div class="btns"><button class="btn-ghost" id="bld-close">离开</button></div>
      </div>`, { modal: true });
      $$(".bld-up-btn").forEach(b => b.onclick = () => { if (Buildings.build(m, cityId, b.dataset.t)) this.openBuild(); });
      $("#bld-close").onclick = () => { closeOverlay(); this.render(); };
    },
    /* ---- 守将面板：委任/更换/解任，独立于城建按钮 ---- */
    openGuard() {
      const m = Campaign.mapState();
      const cityId = m.curCity;
      if (!isMyCity(m, cityId) || cityDef(cityId).side === "sea") return;
      const guard = Guard.of(m, cityId);
      openOverlay(`<div class="result-card detail-card">
        <h1>🛡️ ${cityName(cityId)} · 守将</h1>
        <div class="wdesc">${guard ? `<b>${guard.name}</b> 驻城死守——边境战报必上阵且六维 +${Guard.STAT_BONUS}，不随宿营云游` : "空缺——可委任一位友谊满上限的己方武将驻守，边境战报中必上阵且六维 +" + Guard.STAT_BONUS}<br><small>⚠️ 城破之日守将将被俘下狱，须付赎金或劫牢营救（己方夺回此城亦会放人）。</small></div>
        <div class="btns">
          <button class="btn-primary" id="grd-manage">${guard ? "更换守将" : "委任守将"}</button>
          ${guard ? `<button class="btn-ghost" id="grd-out">解任守将</button>` : ""}
          <button class="btn-ghost" id="grd-close">离开</button>
        </div>
      </div>`, { modal: true });
      $("#grd-manage").onclick = () => this.openGuardPicker(m, cityId);
      const outBtn = $("#grd-out"); if (outBtn) outBtn.onclick = () => { Guard.dismiss(m, cityId); toast(`守将已解任归乡`); this.openGuard(); };
      $("#grd-close").onclick = () => { closeOverlay(); this.render(); };
    },
    openGuardPicker(m, cityId) {
      const cands = Guard.eligible(m).sort((a, b) => ratingScore(b) - ratingScore(a));
      openOverlay(`<div class="result-card detail-card">
        <h1>🛡️ 委任守将</h1>
        <div class="wdesc">从<b>本势力武将</b>或<b>友谊满上限（${Bond.MAX_FRIEND}）</b>的他家武将中遴选（不在团队、未任掌柜、非一方主公），守将常驻本城死守，边境战报模拟中必上阵且六维 +${Guard.STAT_BONUS}。</div>
        ${cands.length ? `<div class="menu" style="max-height:40vh;overflow-y:auto">${cands.map(g => `<button class="menu-btn grd-cand" data-id="${g.id}"><span class="mi">🛡️</span><span>${g.name}<small>评分 ${ratingScore(g)}</small></span></button>`).join("")}</div>` : `<div class="wdesc">暂无人选——守将须是友谊满上限、且不在团队/不任掌柜的己方武将。</div>`}
        <div class="btns"><button class="btn-ghost" id="grd-back">返回</button></div>
      </div>`, { modal: true });
      $$(".grd-cand").forEach(el => el.onclick = () => { Guard.appoint(m, cityId, +el.dataset.id); this.openGuard(); });
      $("#grd-back").onclick = () => this.openGuard();
    },
    // 募兵数量滑杆的说明文案：花多少钱、募多少兵，与出阵比例滑杆同一套措辞习惯
    recruitLabel(m, cityId, n) {
      const cost = Math.ceil(n * Garrison.RECRUIT_GOLD_PER);
      return `募兵 <b>${n.toLocaleString()}</b> 人　耗 <b>${cost.toLocaleString()}</b> 金　｜　募后驻军 ${(Garrison.get(m, cityId) + n).toLocaleString()}/${Garrison.cap(m, cityId).toLocaleString()}`;
    },
    /* ---- 驻军面板：查看本城驻军上限构成并募兵；驻军决定边境大战出阵兵力上限。
       募兵数量原是"一键尽量补满"，现改为滑杆自选数量（0 ~ 兵额与金币两者中较小者），
       不再是一点就把钱包掏空、把兵额一次募满，方便按需分次调度金库 ---- */
    openGarrison() {
      const m = Campaign.mapState();
      const cityId = m.curCity;
      if (!isMyCity(m, cityId)) return;
      const have = Garrison.get(m, cityId), cap = Garrison.cap(m, cityId);
      const wallLv = Buildings.lv(m, cityId, "wall"), prosperLv = Prosper.lv(m, cityId);
      const pop = Population.get(m, cityId), popCap = Population.cap(m, cityId);
      const quota = Garrison.recruitQuota(m, cityId), quotaUsed = Garrison.recruitedToday(m, cityId), quotaLeft = Garrison.remainingQuota(m, cityId);
      const room = cap - have;
      const affordable = Math.floor(Bond.gold() / Garrison.RECRUIT_GOLD_PER);
      const sliderMax = Math.max(0, Math.min(room, affordable, quotaLeft, pop));
      this._grsN = sliderMax;   // 默认拉到当前买得起、兵额/配额/人口都容得下的最大值，可自行下调
      openOverlay(`<div class="result-card detail-card">
        <h1>🚩 ${cityName(cityId)} · 驻军</h1>
        <div class="wdesc">现有驻军 <b>${have.toLocaleString()}</b> / 上限 <b>${cap.toLocaleString()}</b>（人口 ${pop.toLocaleString()} ×9% ${Math.round(pop * Garrison.POP_CAP_RATIO).toLocaleString()} + 城墙${wallLv}级 ${(wallLv * Garrison.WALL_CAP_STEP).toLocaleString()}）<br>
        每日宿营回复 <b>${Garrison.regen(m, cityId).toLocaleString()}</b>；边境大战出阵兵力由此处驻军按你选定的出阵比例调拨，请量力而行。<br>
        本城人口 <b>${pop.toLocaleString()}</b> / 上限 ${popCap.toLocaleString()}（繁荣${prosperLv}★，人口每日向上限流动，征兵会消耗人口）<br>
        今日征兵配额 <b>${quotaLeft.toLocaleString()}</b> / ${quota.toLocaleString()}（已征 ${quotaUsed.toLocaleString()}，明日重置）<br>
        募兵每员 ${Garrison.RECRUIT_GOLD_PER} 金，💰 现有 ${Bond.gold()} 金</div>
        ${sliderMax > 0 ? `
        <div class="mc-sect">🚩 募兵数量<small>（兵额尚余 ${room.toLocaleString()}，金币最多募 ${affordable.toLocaleString()}，配额尚余 ${quotaLeft.toLocaleString()}）</small></div>
        <input type="range" id="grs-n" min="0" max="${sliderMax}" step="${Math.max(1, Math.round(sliderMax / 200))}" value="${sliderMax}" style="width:100%">
        <div class="wdesc" id="grs-n-label">${this.recruitLabel(m, cityId, sliderMax)}</div>` : `<div class="wdesc">${room <= 0 ? "驻军已满编" : quotaLeft <= 0 ? "今日征兵名额已用尽，明日再来" : pop <= 0 ? "本城人口枯竭，暂募不得一兵" : "金币不足，暂募不得一兵"}</div>`}
        <div class="btns">
          <button class="btn-primary" id="grs-recruit" ${sliderMax > 0 ? "" : "disabled"}>💰 募兵</button>
          <button class="btn-ghost" id="grs-close">离开</button>
        </div>
      </div>`, { modal: true });
      if ($("#grs-n")) {
        $("#grs-n").oninput = (e) => {
          this._grsN = +e.target.value;
          $("#grs-n-label").innerHTML = this.recruitLabel(m, cityId, this._grsN);
        };
      }
      $("#grs-recruit").onclick = () => { if (Garrison.recruitN(m, cityId, this._grsN)) { this.render(); this.openGarrison(); } };
      $("#grs-close").onclick = () => { closeOverlay(); this.render(); };
    },
    /* ---- 身份面板：查看官职/功勋进度，投效/领俸禄/自立门户的唯一入口 ---- */
    // 在野浪人的投效入口（原「身份」面板在野分支）：概况类信息（官职/功勋/俸禄）已移至左侧角色卡常驻展示，
    // 这里只保留需要玩家主动决定的事——响应诸侯征辟，或亲自择一势力投效
    openJoin() {
      const m = Campaign.mapState();
      const facs = FACTIONS.filter(f => f.side === RPG.char.side && f.cities.length);
      const court = m.pendingCourt && factionDef(m.pendingCourt.fid) && !PlayerRank.exLordHostile(m, m.pendingCourt.fid)
        ? m.pendingCourt : null;
      const body = (court ? `<div class="wdesc" style="border:1px solid var(--cn-gold);border-radius:10px;padding:10px 12px;background:rgba(232,194,90,.12)">
            📜 <b>${factionName(court.fid)}</b>遣使来聘（主公 · ${factionLordName(court.fid)}），请你出仕辅佐。<br>
            <small>接受即拜为门客，另赠见面礼 500 金；婉拒则其好感受挫，日后再投未必顺遂。</small>
            <div class="btns" style="margin-top:8px">
              <button class="btn-primary" id="id-court-yes">🤝 应聘出仕</button>
              <button class="btn-ghost" id="id-court-no">🙅 婉言谢绝</button>
            </div></div>` : "")
        + `<div class="wdesc">当前身份：<b>在野浪人</b>——不效力任何势力，自由游历。可随时投效麾下一方，累积功勋以晋升官职。</div>
          <div class="grid">${facs.map(f => {
            const hostile = PlayerRank.exLordHostile(m, f.id);
            return `<div class="card ${f.side} id-fac ${hostile ? "disabled" : ""}" data-f="${f.id}"><div class="avatar">${f.n.slice(0, 1)}</div><div class="cname">${f.n}</div><div class="cwu">主公 · ${f.lord}</div>${hostile ? `<div class="cwu">（旧怨未消，${m.exLordUntil[f.id] - m.day} 天后可投）</div>` : ""}</div>`;
          }).join("")}</div>`;
      openOverlay(`<div class="result-card detail-card">
        <h1>🏯 投效</h1>
        ${body}
        <div class="btns"><button class="btn-ghost" id="id-close">离开</button></div>
      </div>`, { modal: true });
      $$(".id-fac").forEach(el => el.onclick = () => {
        if (el.classList.contains("disabled")) return;
        if (PlayerRank.join(m, el.dataset.f)) { this.render(); this.openJoin(); }
      });
      const courtYes = $("#id-court-yes");
      if (courtYes) courtYes.onclick = () => {
        const cf = m.pendingCourt.fid;
        m.pendingCourt = null;
        if (PlayerRank.join(m, cf)) {
          const gold = Bond.addGold(500);
          toast(`🎁 ${factionName(cf)}以见面礼 ${gold} 金相赠，自此你便是其门下之人`);
          this.render(); this.openJoin();
        }
      };
      const courtNo = $("#id-court-no");
      if (courtNo) courtNo.onclick = () => {
        const cf = m.pendingCourt.fid;
        m.pendingCourt = null;
        FactionAI.addHostility(m, cf, "_none_", 0);   // 不结仇，仅记一次冷淡
        Campaign.save();
        toast(`🙅 你婉谢了${factionName(cf)}的征辟——来日方长`);
        this.openJoin();
      };
      $("#id-close").onclick = () => { closeOverlay(); this.render(); };
    },
    // 自立门户：直接判定资格并给出说明（而非把按钮悄悄藏起来让人摸不着头脑），符合条件才弹出确认框——
    // 与 lordActBtn 系列同一 UX 原则：能点、点了就有交代
    tryDeclareIndependence() {
      const m = Campaign.mapState();
      if (m.playerRank < PlayerRank.INDEPENDENCE_RANK) {
        toast(`官职尚浅（现「${PlayerRank.rankName(m)}」），须至「${PlayerRank.rankLabel(PlayerRank.INDEPENDENCE_RANK)}」以上方可自立`);
        return;
      }
      if ((m.fame || 0) < PlayerRank.INDEPENDENCE_FAME_MIN) {
        toast(`声望不足（现 ${m.fame || 0}，需 ${PlayerRank.INDEPENDENCE_FAME_MIN}）`);
        return;
      }
      if (!isMyCity(m, m.curCity)) {
        toast(`须身处本势力城池，方可昭告自立`);
        return;
      }
      if (confirm(`自立门户将脱离现主公，损失约 15% 名声，且短期内无法重投旧主，此后不可撤销。确定自立吗？`)) {
        if (PlayerRank.declareIndependence(m)) this.render();
      }
    },
    // 主公府 · 人事：自立之后原「身份」面板升级而来，只保留四类封赏动作——概况数字（威名/军令/金库/城池/麾下）
    // 仍留在这里（信息量偏细，不适合塞进寸土寸金的角色卡），但角色卡已展示威名/官职这两条最要紧的
    openPersonnel() {
      const m = Campaign.mapState();
      const fid = "_player_";
      const own = m.playerOwnFaction;
      const orders = FactionOrders.get(m, fid), cap = FactionOrders.cap(m, fid), gold = FactionGold.get(m, fid);
      const cities = factionCityCount(m, fid);
      const gens = factionGenerals(m, fid, true);
      const slots = Rewards.postSlots(m, fid), used = Rewards.postsHeldBy(m, fid).length;
      const swornN = Rewards.swornOf(m, fid).length;
      openOverlay(`<div class="result-card detail-card">
        <h1>👑 人事 · ${own.n}</h1>
        <div class="wdesc">📜 军令 <b>${orders}</b>/${cap} · 💰 府库 <b>${gold.toLocaleString()}</b> · 🗺️ 城池 <b>${cities}</b> 座 · 🎖️ 麾下 <b>${gens.length}</b> 将 · 官位 ${used}/${slots} · 结义 ${swornN}/${Rewards.SWORN_MAX}
          <br><small>军令每日按威名回复，出征与封赏皆需之。赏赐一概不用金帛——买得来兵，买不来人心。</small></div>
        <div class="menu">
          ${this.lordActBtn(m, "post", "🎖️", "封官", `${used}/${slots} 席 · 忠诚上限 +10~20`)}
          ${this.lordActBtn(m, "fief", "🏯", "封地", `余 ${Rewards.freeFiefCities(m, fid).length} 城可封 · 忠诚上限 +15`)}
          ${this.lordActBtn(m, "sworn", "🤝", "结义", `${swornN}/${Rewards.SWORN_MAX} · 需友谊 ≥${Rewards.SWORN_BOND_MIN} · 免疫策反`)}
          ${this.lordActBtn(m, "feast", "🍶", "庆功宴", `全军忠诚 +3 · 庆功 ${Rewards.feastCharges(m)} 次`)}
        </div>
        <div class="btns"><button class="btn-ghost" id="id-close">离开</button></div>
      </div>`, { modal: true });
      $$(".lord-act").forEach(b => b.onclick = () => this.openLordAction(b.dataset.a));
      $("#id-close").onclick = () => { closeOverlay(); this.render(); };
    },
    /* ---- 主公封赏：封官 / 封地 / 结义 / 庆功宴（皆耗军令，绝不用金币） ----
       军令不足时**不置灰按钮**，而是照常可点、点了给一句解释——按钮 disabled 后既无视觉变化
       （弹窗内的 .menu 不在 .menu-main/.map-menu 的禁用样式覆盖范围内）又毫无反馈，
       玩家只会觉得"点了没反应"，根本无从得知是军令不够、更不知道如何补 */
    LORD_ACT_COST: { post: 2, fief: 2, sworn: 3, feast: 1 },
    LORD_ACT_NAME: { post: "封官", fief: "封地", sworn: "结义", feast: "庆功宴" },
    lordActBtn(m, kind, icon, label, desc) {
      const need = this.LORD_ACT_COST[kind];
      const orders = FactionOrders.get(m, "_player_");
      // 庆功宴不再是想办就办——须先攒下"庆功次数"（边境大战/攻城得胜、武将世界杯/武将大会夺冠或亚军各积 1 次）
      const noCharge = kind === "feast" && Rewards.feastCharges(m) <= 0;
      const low = orders < need || noCharge;
      const reason = noCharge ? "（尚无庆功由头，先打场胜仗）" : low ? `（现有 ${orders}，不足）` : "";
      return `<button class="menu-btn lord-act${low ? " low" : ""}" data-a="${kind}"><span class="mi">${icon}</span><span>${label}<small>${desc} · 耗 ${need} 军令${reason}</small></span></button>`;
    },
    openLordAction(kind) {
      const m = Campaign.mapState();
      const fid = "_player_", side = RPG.char.side;
      const orders = FactionOrders.get(m, fid);
      const need = this.LORD_ACT_COST[kind] || 1;
      if (orders < need) {
        toast(`📜 军令不足：${this.LORD_ACT_NAME[kind]}需 ${need} 道，现有 ${orders} 道——宿营一夜即可回满至 ${FactionOrders.cap(m, fid)} 道（威名越盛上限越高）`);
        return;
      }
      if (kind === "feast" && Rewards.feastCharges(m) <= 0) {
        toast(`🍶 尚无庆功由头——边境大战/攻城得胜，或武将世界杯、武将大会夺冠/亚军，方能积下庆功次数`);
        return;
      }
      const back = `<div class="btns"><button class="btn-ghost" id="la-back">返回</button></div>`;
      const bind = () => { $("#la-back").onclick = () => this.openPersonnel(); };
      const gens = factionGenerals(m, fid, true).sort((a, b) => ratingScore(Armory.geared(b, b.id)) - ratingScore(Armory.geared(a, a.id)));
      const row = (g, extra) => `<button class="menu-btn la-pick" data-id="${g.id}"><span class="mi">🎖️</span><span>${g.name}<small>评分 ${ratingScore(Armory.geared(g, g.id))} · 忠诚 ${Loyalty.get(m, g.id)}（上限 ${Loyalty.softCap(m, g.id)}）${extra || ""}</small></span></button>`;

      if (kind === "feast") {
        if (!FactionOrders.spend(m, fid, Rewards.FEAST_ORDERS)) { toast("军令不足"); return; }
        m.feastCharges = Math.max(0, (m.feastCharges || 0) - 1);
        const n = Rewards.feast(m, fid);
        Campaign.save();
        toast(n ? `🍶 大宴群臣，麾下 ${n} 将同沐恩泽，忠诚各 +3` : "麾下暂无可赏之人");
        this.openPersonnel();
        return;
      }
      if (kind === "post") {
        const heldIds = Rewards.postsHeldBy(m, fid);
        const free = Rewards.postSlots(m, fid) - heldIds.length;
        const cand = gens.filter(g => !(m.posts || {})[g.id]);
        // 本势力官位一览：现任者一目了然，免得每次封官都要凭记忆猜"谁还没有官身"
        const heldHtml = heldIds.length
          ? `<div class="wdesc"><small>${heldIds.map(gid => {
              const g = DB.get(gid);
              return g ? `${g.name}：${Rewards.postName(m.posts[gid], g.side)}` : "";
            }).filter(Boolean).join(" · ")}</small></div>`
          : "";
        openOverlay(`<div class="result-card detail-card">
          <h1>🎖️ 封官</h1>
          <div class="wdesc">官位随疆域而增（每两城一席，现 ${Rewards.postSlots(m, fid)} 席，尚余 <b>${free}</b> 席）。授职可长久抬高其忠诚上限，是笼络重臣的根本。<br><small>耗 2 道军令 · 现有 ${orders} 道</small></div>
          ${heldHtml}
          ${free <= 0 ? '<div class="wdesc">官位已满——再拓疆土方有新席位可授。</div>'
            : cand.length ? `<div class="menu" style="max-height:44vh;overflow-y:auto">${cand.map(g => row(g)).join("")}</div>`
            : '<div class="wdesc">麾下诸将皆已有职在身。</div>'}
          ${back}</div>`, { modal: true });
        bind();
        $$(".la-pick").forEach(b => b.onclick = () => {
          if (!FactionOrders.spend(m, fid, 2)) { toast("军令不足"); return; }
          const gid = +b.dataset.id;
          const held = Rewards.postsHeldBy(m, fid).length;
          const kindK = Rewards.POSTS[Math.min(held, Rewards.POSTS.length - 1)].k;
          Rewards.grantPost(m, fid, gid, kindK);
          Campaign.save();
          toast(`🎖️ 拜 ${DB.get(gid).name} 为${Rewards.postName(kindK, side)}，其心愈固`);
          this.openPersonnel();
        });
        return;
      }
      if (kind === "fief") {
        const free = Rewards.freeFiefCities(m, fid);
        const cand = gens.filter(g => !Object.values(m.fiefs || {}).includes(g.id));
        openOverlay(`<div class="result-card detail-card">
          <h1>🏯 封地</h1>
          <div class="wdesc">以一城为食邑封赏一将（一城一人），忠诚上限 +${Loyalty.FIEF_BONUS}。<br>
            <b style="color:var(--cn-red)">⚠️ 慎择其人</b>：受封者若日后忠诚跌破 10，有举城叛变之虞——封地是双刃剑。<br><small>耗 2 道军令 · 现有 ${orders} 道 · 可封城池 ${free.length} 座</small></div>
          ${!free.length ? '<div class="wdesc">治下城池皆已有主。</div>'
            : cand.length ? `<div class="menu" style="max-height:40vh;overflow-y:auto">${cand.map(g => row(g)).join("")}</div>`
            : '<div class="wdesc">麾下诸将皆已受封。</div>'}
          ${back}</div>`, { modal: true });
        bind();
        $$(".la-pick").forEach(b => b.onclick = () => {
          const gid = +b.dataset.id;
          const cities = Rewards.freeFiefCities(m, fid);
          if (!cities.length) { toast("无城可封"); return; }
          openOverlay(`<div class="result-card detail-card">
            <h1>🏯 封 ${DB.get(gid).name} 何城？</h1>
            <div class="menu" style="max-height:50vh;overflow-y:auto">${cities.map(cid =>
              `<button class="menu-btn la-city" data-c="${cid}"><span class="mi">🏙️</span><span>${cityName(cid)}<small>繁荣 ${Prosper.stars(m, cid)} · 日进 ${Estate.cityDailyGold(m, cid)} 金</small></span></button>`).join("")}</div>
            ${back}</div>`, { modal: true });
          bind();
          $$(".la-city").forEach(cb => cb.onclick = () => {
            if (!FactionOrders.spend(m, fid, 2)) { toast("军令不足"); return; }
            Rewards.grantFief(m, fid, cb.dataset.c, gid);
            Campaign.save();
            toast(`🏯 以${cityName(cb.dataset.c)}封 ${DB.get(gid).name} 为食邑`);
            this.openPersonnel();
          });
        });
        return;
      }
      if (kind === "sworn") {
        const cand = gens.filter(g => !(m.sworn || []).includes(g.id) && Bond.pts(g.id) >= Rewards.SWORN_BOND_MIN);
        const room = Rewards.canSworn(m, fid);
        openOverlay(`<div class="result-card detail-card">
          <h1>🤝 结义</h1>
          <div class="wdesc">与生死相托之人义结金兰（全势力至多 ${Rewards.SWORN_MAX} 人，需友谊 ≥ ${Rewards.SWORN_BOND_MIN}）。<br>
            忠诚上限 +${Loyalty.SWORN_BONUS}，且<b style="color:var(--cn-gold)">终生免疫敌方策反</b>。<br><small>耗 ${Rewards.SWORN_ORDERS} 道军令 · 现有 ${orders} 道</small></div>
          ${!room ? '<div class="wdesc">义兄弟之数已满，情谊贵精不贵多。</div>'
            : cand.length ? `<div class="menu" style="max-height:44vh;overflow-y:auto">${cand.map(g => row(g, ` · 友谊 ${Bond.pts(g.id)}`)).join("")}</div>`
            : `<div class="wdesc">麾下尚无友谊达 ${Rewards.SWORN_BOND_MIN} 者——先多加走动罢。</div>`}
          ${back}</div>`, { modal: true });
        bind();
        $$(".la-pick").forEach(b => b.onclick = () => {
          if (!FactionOrders.spend(m, fid, Rewards.SWORN_ORDERS)) { toast("军令不足"); return; }
          const gid = +b.dataset.id;
          Rewards.addSworn(m, gid);
          Campaign.save();
          toast(`🤝 与 ${DB.get(gid).name} 义结金兰，自此生死与共`);
          this.openPersonnel();
        });
      }
    },
    /* ---- 主公亲自施计：此前七式计谋只有 AI 势力能对敌施展，玩家自立为主后却无处发力，是明显遗漏。
       与 AI 随机施法不同，主公亲政讲究知己知彼——玩家自己挑目标、挑计谋，结算核心复用
       FactionAI.resolvePlot，胜负判定与七式效果同一套，唯独"打谁""使哪一式"由你亲自定夺。 ---- */
    PLOT_ORDERS: 2,
    openPlot() {
      const m = Campaign.mapState();
      const fid = "_player_";
      const orders = FactionOrders.get(m, fid);
      if (orders < this.PLOT_ORDERS) {
        toast(`📜 军令不足：施计需 ${this.PLOT_ORDERS} 道，现有 ${orders} 道——宿营一夜即可回满至 ${FactionOrders.cap(m, fid)} 道（威名越盛上限越高）`);
        return;
      }
      // 接壤敌对势力去重（同一势力可能与我方有多条边境线，只需列一次）
      const fr = FactionAI.frontiers(m, fid);
      if (!fr.length) { toast("四境未接敌对势力，无从施计"); return; }
      const byFoe = new Map();
      fr.forEach(f => { if (!byFoe.has(f.foe)) byFoe.set(f.foe, f); });
      const q = FactionTop5.top5(m, fid, "zhi");
      const targets = [...byFoe.values()];
      openOverlay(`<div class="result-card detail-card">
        <h1>🕵️ 计谋 · 择一势力下手</h1>
        <div class="wdesc">按己方与对方的智力对比推算可用手段与成算，敌对度越深、优先级越靠前。<br><small>耗 ${this.PLOT_ORDERS} 道军令 · 现有 ${orders} 道</small></div>
        <div class="menu" style="max-height:50vh;overflow-y:auto">${targets
          .sort((a, b) => FactionAI.hostility(m, fid, b.foe) - FactionAI.hostility(m, fid, a.foe))
          .map(f => {
            const adv = Math.round(q - FactionTop5.top5(m, f.foe, "zhi"));
            const chance = Math.round(Math.max(0.15, Math.min(0.85, 0.4 + adv / 100)) * 100);
            return `<button class="menu-btn plot-target" data-foe="${f.foe}"><span class="mi">${factionDef(f.foe).side === "cn" ? "🐲" : "🏯"}</span><span>${factionName(f.foe)}<small>智力差 ${adv >= 0 ? "+" : ""}${adv} · 约 ${chance}% 基础成算 · 敌对 ${FactionAI.hostility(m, fid, f.foe)}</small></span></button>`;
          }).join("")}</div>
        <div class="btns"><button class="btn-ghost" id="plot-close">离开</button></div>
      </div>`, { modal: true });
      $$(".plot-target").forEach(b => b.onclick = () => this.openPlotPick(m, byFoe.get(b.dataset.foe)));
      $("#plot-close").onclick = () => { closeOverlay(); this.render(); };
    },
    openPlotPick(m, pick) {
      const fid = "_player_", foe = pick.foe;
      const q = FactionTop5.top5(m, fid, "zhi"), foeQ = FactionTop5.top5(m, foe, "zhi");
      const adv = q - foeQ;
      // 主公亲政，用兵用计但凭己意，不因一时智谋逊于敌手就束手束脚——七式一律可选，
      // 智力差只影响成算与效果强度（见 resolvePlot 的 chance/strength 计算，已天然兜底负值）
      const rows = FactionAI.PLOTS.map(p => {
        const chance = Math.round(Math.max(0.15, Math.min(0.85, 0.4 + adv / 100)) * 100);
        return `<button class="menu-btn plot-pick" data-k="${p.k}"><span class="mi">🕵️</span><span>${p.n}<small>${p.desc} · 约 ${chance}% 成算</small></span></button>`;
      }).join("");
      openOverlay(`<div class="result-card detail-card">
        <h1>🕵️ 对${factionName(foe)}施计</h1>
        <div class="wdesc">智力差 ${adv >= 0 ? "+" : ""}${Math.round(adv)}——差距越大成算与效果越猛，但七式一律可自由选用。</div>
        <div class="menu" style="max-height:50vh;overflow-y:auto">${rows}</div>
        <div class="btns"><button class="btn-ghost" id="plotpick-back">返回</button></div>
      </div>`, { modal: true });
      $$(".plot-pick").forEach(b => b.onclick = () => {
        if (!FactionOrders.spend(m, fid, this.PLOT_ORDERS)) { toast("军令不足"); return; }
        const news = { plot: [] };
        const push = (cat, f, text) => { if (news[cat]) news[cat].push(text); };
        FactionAI.resolvePlot(m, fid, foe, pick, b.dataset.k, q, push);
        Campaign.save();
        toast(news.plot[0] || "施计完毕");
        closeOverlay();
        this.render();
      });
      $("#plotpick-back").onclick = () => this.openPlot();
    },
    /* ---- 驿站快马面板：独立于城建按钮；也可由地图直接点击已通驿的远方城市触发（见 confirmPostTravel） ---- */
    openPostTravel(m) {
      const dests = Buildings.postDests(m).sort((a, b) => a.cost - b.cost);
      openOverlay(`<div class="result-card detail-card">
        <h1>🏇 驿站快马</h1>
        <div class="wdesc">快马直达任一建有驿站的己方城市：不论多远只耗 <b>1⚡</b>，驿费按路程计（本城驿站等级越高越省），一路官道无奇遇、无风浪。💰 现有 ${Bond.gold()} 金</div>
        ${dests.length ? `<div class="menu post-dest-list" style="max-height:40vh;overflow-y:auto">${dests.map(d => `<button class="menu-btn post-dest" data-id="${d.id}" ${Bond.gold() < d.cost ? "disabled" : ""}><span class="mi">🏇</span><span>${d.n}<small>驿费 ${d.cost} 金</small></span></button>`).join("")}</div>` : `<div class="wdesc">尚无可达之处——对方城市也须归属己方且建有驿站。</div>`}
        <div class="btns"><button class="btn-ghost" id="post-back">返回</button></div>
      </div>`, { modal: true });
      $$(".post-dest").forEach(el => el.onclick = () => this.postTravel(m, el.dataset.id));
      $("#post-back").onclick = () => { closeOverlay(); this.render(); };
    },
    // 地图直接点击远方城市：若与当前城池均已建驿站（即在 postDests 名单内），弹确认框走驿传而非报错
    confirmPostTravel(m, dest) {
      openOverlay(`<div class="result-card detail-card">
        <h1>🏇 驿站快马</h1>
        <div class="wdesc">${cityName(m.curCity)} 与 <b>${dest.n}</b> 均建有驿站，可快马直达：不论多远只耗 <b>1⚡</b>，驿费 <b style="color:#b8860b">${dest.cost}</b> 金（现有 ${Bond.gold()} 金），一路官道无奇遇、无风浪。</div>
        <div class="btns">
          <button class="btn-primary" id="pt-go" ${(m.ap <= 0 || Bond.gold() < dest.cost) ? "disabled" : ""}>快马前往</button>
          <button class="btn-ghost" id="pt-cancel">取消</button>
        </div>
      </div>`, { modal: true });
      $("#pt-go").onclick = () => this.postTravel(m, dest.id);
      $("#pt-cancel").onclick = () => closeOverlay();
    },
    postTravel(m, destId) {
      const dest = Buildings.postDests(m).find(d => d.id === destId);
      if (!dest) return;
      if (m.ap <= 0) { toast(`今日行动力已耗尽，请先宿营`); return; }
      if (!Bond.spend(dest.cost)) { toast(`金币不足（驿费 ${dest.cost} 金）`); return; }
      m.ap--;
      m.curCity = destId;
      Bond.data.team.forEach(gid => { m.assign[gid] = destId; });   // 团队成员随行
      Campaign.save();
      closeOverlay();
      AudioSystem.sfx.select();
      toast(`🏇 快马加鞭，直抵${cityName(destId)}！（驿费 -${dest.cost} 金，余 ${Bond.gold()} 金）`);
      this.render();
    },
    /* ---- 牢狱营救：被俘守将关押于此城时，可付赎金赎人或劫牢武力营救 ---- */
    openRescue() {
      const m = Campaign.mapState();
      const capt = Guard.heldAt(m, m.curCity);
      if (!capt.length) return;
      const g = capt[0];
      const price = Guard.ransom(g);
      openOverlay(`<div class="result-card detail-card">
        <h1>⛓️ 牢狱营救</h1>
        <div class="wdesc"><b>${g.name}</b> 城破被俘，囚于${cityName(m.curCity)}大牢。<br>可付赎金 <b style="color:#b8860b">${price}</b> 金赎人（现有 ${Bond.gold()} 金），或劫牢武力营救（耗 1⚡，经典单挑——胜则救出且名声大增，败则再图后计）。</div>
        <div class="btns">
          <button class="btn-primary" id="rsq-pay" ${Bond.gold() < price ? "disabled" : ""}>💰 付赎金赎人</button>
          <button class="btn-primary" id="rsq-fight" ${m.ap <= 0 ? "disabled" : ""}>🗡️ 劫牢营救（1⚡）</button>
          <button class="btn-ghost" id="rsq-close">先行离开</button>
        </div>
      </div>`, { modal: true });
      $("#rsq-pay").onclick = () => {
        if (!Bond.spend(price)) return;
        closeOverlay();
        Guard.free(m, g.id, `——重金赎回（-${price} 金）`);
        this.render();
      };
      $("#rsq-fight").onclick = () => {
        if (m.ap <= 0) return;
        m.ap--;
        m.activeRescue = { gid: g.id, cityId: m.curCity };
        Campaign.save();
        closeOverlay();
        startClassicBattle(RPG.heroGeneral(), this.makeJailer(), false, true);
      };
      $("#rsq-close").onclick = () => closeOverlay();
    },
    // 牢城狱吏：实力贴着主角当前水平略偏强，劫牢不是白来的；阵营取敌方仅为配色，不入武将图鉴
    makeJailer() {
      const names = ["牢城督将", "狱卒头目", "陷阵狱吏"];
      const hg = RPG.heroGeneral();
      const g = { id: -78, name: names[randInt(0, names.length - 1)], side: RPG.char.side === "cn" ? "jp" : "cn" };
      DIMS.forEach(([k]) => { g[k] = Math.max(40, Math.min(110, hg[k] - randInt(0, 8) + randInt(0, 10))); });
      return g;
    },
    // 亲自收取进账：小概率触发经营事件（强人劫掠/大市/贵客临门），否则照常结算。
    // 掌柜代收的金币走 Estate.accrue 静默入账，不经此处、不触发事件
    collectEstate(cityId) {
      const m = Campaign.mapState();
      const est = Estate.get(m, cityId);
      if (!est) return;
      if (Estate.sealed(m, cityId)) { toast(`产业已被查封，夺回城池方可收取`); return; }
      Estate.accrue(m, cityId);
      Campaign.save();
      const goldPending = est.pending || 0, mats = est.matPending || 0;
      if (goldPending <= 0 && mats <= 0) { toast(`尚无进账，改日再来`); return; }
      const roll = Math.random();
      // 事件按固定区间判定：[0,0.12) 强人劫掠（农庄安稳无此虞，命中也照常结算）、[0.12,0.22) 大市、
      // [0.22,0.32) 贵客临门（酒馆特有）；其余照常
      if (goldPending > 0 && est.type !== "farm" && roll < 0.12) { this.estateRaid(m, cityId); return; }
      // 大市（10%）：金币收益翻倍
      if (goldPending > 0 && roll >= 0.12 && roll < 0.22) { Estate.collect(m, cityId, 2, `📈 恰逢大市，收益翻倍！`); this.render(); return; }
      // 贵客临门（10%，酒馆特有）：随机一位已现身武将造访，友谊大增
      if (goldPending > 0 && est.type === "tavern" && roll >= 0.22 && roll < 0.32) {
        const cands = DB.list.filter(g => m.appeared.includes(g.id) && g.side === RPG.char.side);
        if (cands.length) {
          const g = cands[randInt(0, cands.length - 1)];
          const add = Bond.addF(g.id, 10);
          Bond.save();
          Estate.collect(m, cityId, 1, add > 0 ? `🎉 贵客【${g.name}】临门畅饮，友谊 +${add}！` : `🎉 贵客【${g.name}】临门畅饮（友谊已至上限）！`);
          this.render();
          return;
        }
      }
      Estate.collect(m, cityId, 1);
      this.render();
    },
    // 强人劫掠：先把这笔进账"押在路上"，应战（经典单挑，结算走 RPG.onBattleEnd 的 activeEstateRaid 通道：
    // 胜追回双倍、败只保住一半）或破财消灾（保住七成）；材料不为强人所图，两种结局都会送回宝物库
    estateRaid(m, cityId) {
      const seized = Estate.seizeForRaid(m, cityId);
      const raider = this.makeRaider();
      openOverlay(`<div class="result-card">
        <h1>🗡️ 强人劫掠！</h1>
        <div class="winner-av" style="background:linear-gradient(135deg,#3a3a3a,#141414)">${avatarChar(raider.name)}</div>
        <div class="wname">${raider.name}</div>
        <div class="wdesc">收账归途，强人拦路抢夺这笔 <b style="color:#b8860b">${seized.gold}</b> 金进账！<br>应战获胜可威慑追回<b>双倍</b>，落败只保得一半；破财消灾则保住七成。</div>
        <div class="btns">
          <button class="btn-primary" id="er-fight">应战</button>
          <button class="btn-ghost" id="er-pay">破财消灾（保住七成）</button>
        </div>
      </div>`, { modal: true });
      $("#er-fight").onclick = () => {
        closeOverlay();
        m.activeEstateRaid = { cityId, gold: seized.gold, mats: seized.mats };
        Campaign.save();
        startClassicBattle(RPG.heroGeneral(), raider, false, true);
      };
      $("#er-pay").onclick = () => {
        closeOverlay();
        const kept = Bond.addGold(Math.round(seized.gold * 0.7), "破财消灾");
        let matTxt = "";
        if (seized.mats) { const mt = Estate.deliverMats(cityId, seized.mats); matTxt = `，${mt.n}材料 +${seized.mats}`; }
        Campaign.save();
        toast(`💸 破财消灾，保住 ${kept} 金${matTxt}`);
        this.render();
      };
    },
    // 劫道强人：实力贴着主角当前水平上下浮动，可胜但不可轻敌；阵营取敌方仅为配色，不入武将图鉴
    makeRaider() {
      const names = ["黑风寨主", "断刀浪人", "野盗头目", "山道剑客", "流亡枪豪"];
      const hg = RPG.heroGeneral();
      const g = { id: -77, name: names[randInt(0, names.length - 1)], side: RPG.char.side === "cn" ? "jp" : "cn" };
      DIMS.forEach(([k]) => { g[k] = Math.max(40, Math.min(110, hg[k] - randInt(0, 12) + randInt(0, 8))); });
      return g;
    },
    // 一键拜访：本城所有可拜访（己方阵营、友谊未满、今日未访）的已现身武将一次访遍，汇总提示；耗 1 点行动力
    oneClickVisit() {
      const m = Campaign.mapState();
      if (m.ap <= 0) { toast(`今日行动力已耗尽，请先宿营`); return; }
      const today = Bond.dayKey();
      if (!Bond.data.visitDay) Bond.data.visitDay = {};
      const targets = DB.list.filter(g => m.assign[g.id] === m.curCity && m.appeared.includes(g.id)
        && g.side === RPG.char.side && Bond.pts(g.id) < Bond.MAX_FRIEND && Bond.data.visitDay[g.id] !== today);
      if (!targets.length) { toast(`本城暂无可拜访的武将（敌将不可访，或今日均已拜访/友谊已满）`); return; }
      m.ap--;
      const lines = targets.map(g => {
        Bond.data.visitDay[g.id] = today;
        const add = Bond.addF(g.id, randInt(1, 2));
        return `${g.name} +${add}`;
      });
      Bond.save();
      Campaign.save();
      AudioSystem.sfx.select();
      const shown = lines.slice(0, 8).join("、");
      toast(`🚶 一键拜访 ${targets.length} 位武将（-1⚡）：${shown}${lines.length > 8 ? ` 等 ${lines.length} 位` : ""}`);
      this.render();
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
          <div class="btns"><button class="btn-ghost" id="fac-cancel">取消</button></div></div>`, { modal: true });
        $$(".fac-target").forEach(b => b.onclick = () => {
          if (m.ap <= 0) { toast("今日行动力已耗尽，请先宿营恢复"); return; }
          m.ap--; m.activeFacility = "duel"; Campaign.save();
          closeOverlay();
          startClassicBattle(RPG.heroGeneral(), DB.get(+b.dataset.id), false, true);
        });
        $("#fac-cancel").onclick = closeOverlay;
        return;
      }
      if (fac.mode === "cup" && Campaign.fameTierIndex(Campaign.effFame(m)) < RPG.CUP_FAME_TIER) { toast(`声望不足，需达到「${Campaign.FAME_TIERS[RPG.CUP_FAME_TIER].n}」名声阶梯才能报名天下第一武道会`); return; }
      if (m.ap <= 0) { toast("今日行动力已耗尽，请先宿营恢复"); return; }
      m.activeFacility = fac.mode; Campaign.save();
      const fn = { gauntlet: () => RPG.gauntlet(), tower: () => RPG.tower(), duo: () => RPG.duo(), teamBattle: () => RPG.teamBattle(), conquest: () => RPG.conquest(), cup: () => RPG.joinCup(32) }[fac.mode];
      if (fn) fn();
    },
    moveTo(id) {
      const m = Campaign.mapState();
      if (id === m.curCity) return;
      if (!adjCities(m.curCity).includes(id)) {
        // 非相邻城池：若两地均已建驿站（在 postDests 名单内），弹确认框走驿传，而非直接报错
        const dest = Buildings.postDests(m).find(d => d.id === id);
        if (dest) { this.confirmPostTravel(m, dest); return; }
        toast(`距离太远，需先移动到相邻城池`); return;
      }
      if (m.ap <= 0) { toast(`今日行动力已耗尽，请先宿营`); return; }
      // 宿敌拦路：上次宿营已扬言拦路挑战时，本次移动直接被截住，先应战再论（消耗行动力照常，仍抵达目的城）
      if (m.nemesis && m.nemesis.ambush) {
        m.nemesis.ambush = false;
        m.ap--; m.curCity = id; Campaign.save();
        Bond.data.team.forEach(gid => { m.assign[gid] = id; });
        Campaign.save();
        const nm = Nemesis.name(m);
        openOverlay(`<div class="result-card">
          <h1>⚔️ 宿敌拦路！</h1>
          <div class="wname">${nm}</div>
          <div class="wdesc">【${nm}】果然候在半道，拦住去路，摆明了不死不休！唯有应战。</div>
          <div class="btns"><button class="btn-primary" id="nem-fight">应战</button></div>
        </div>`, { modal: true });
        $("#nem-fight").onclick = () => { closeOverlay(); Nemesis.duel(m); };
        return;
      }
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
      const mates = Bond.myRoster(9).filter(g => g.side === heroSide);
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
          </div>`, { modal: true });
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
      m.recruitedToday = {};   // 新的一天，各城征兵名额重新计算（旧账清空，不会累积成一个越滚越大的对象）
      Population.tickAll(m); // 全图人口先按当日繁荣度对应的上限双向收敛（驻军回复/征兵配额都要用当天的人口数）
      Garrison.tickAll(m); // 全图城池驻军同步回复（不分敌我）
      const wandered = this.wanderGenerals(m);
      NightReport.reset();
      FactionGold.tickAll(m);     // 各势力金库按辖城日产出进账
      // 天下诸侯的日常行动（营建/征兵/通商/购置/招揽/计谋/出征），已收编旧 AIDev/WorldWar/AIGear 三模块——
      // 用的是昨夜回满、尚未动用的那一整仓军令；花剩多少不重要，紧接着 tickAll 就会把它重新填满，
      // 玩家次日一看永远是满仓，不会因为"回满当天立刻被 AI 花掉"而误以为回复没生效
      const facNews = FactionAI.tick(m);
      FactionOrders.tickAll(m);   // 各势力军令回满（不分敌我/是否自立），供明日行动支取
      Object.keys(facNews).forEach(cat => NightReport.addAll(cat, facNews[cat]));
      NightReport.add("mine", PlayerRank.dailyStipend(m));   // 官至参军以上，俸禄随宿营自动入账，不再需手动领取
      NightReport.add("alert", Nemesis.campEvent(m));  // 宿敌主动寻衅：拦路挑战 / 抢先夺赏 / 踏营下战书（三选一，小概率）
      NightReport.addAll("grow", Growth.tick(m));      // 岁月修行：随机武将闭关精进（评分越低概率越高）
      if (isMonthEnd(m.day)) NightReport.addAll("people", Loyalty.monthlyTick(m));   // 忠诚随势力盛衰月度浮动，过低小概率叛逃
      // 每月初一：各城集市行情各自独立 45% 概率大幅变动（甩卖/抢购/商旅云集），详见 rollMarketTrends
      if (isMonthStart(m.day)) {
        const trendChanged = rollMarketTrends(m);
        if (trendChanged.length) NightReport.addAll("news", trendChanged.map(t =>
          `${MARKET_TRENDS[t.key].icon} ${cityName(t.cityId)}集市本月「${MARKET_TRENDS[t.key].label}」！`));
      }
      // 悬赏轮换：每次宿营，每座城的每一条悬赏各自独立 50% 概率静默换新——榜单不再一成不变；
      // 已接取中的悬赏结算按接取时写入 m.activeBounty 的独立快照进行，不受轮换影响
      if (m.bounties) {
        Object.keys(m.bounties).forEach(cid => {
          const list = m.bounties[cid];
          list.forEach((b, idx) => {
            if (Math.random() < 0.5) list[idx] = genBounty(cid, m.assign, m.appeared, RPG.char && RPG.char.side);
          });
        });
      }
      Campaign.save();
      AudioSystem.sfx.victory();
      const revealed = Campaign.checkAppearances();
      let msg;
      if (revealed.length) {
        const names = revealed.map(id => { const g = DB.get(id); return g ? g.name : "？"; }).join("、");
        msg = `${names} 现身天下！`;
        NightReport.add("news", `⚡ ${names} 现身天下！`);
      } else if (wandered) {
        msg = `天下武将行踪有变，${wandered} 位已悄然改换驻地`;
        NightReport.add("news", `🚶 天下武将行踪有变，${wandered} 位已悄然改换驻地`);
      } else {
        msg = `宿营一夜，行动力已恢复`;
      }
      // 武将大会、月末国战、敌营夜袭均会另起弹窗/战斗流程，各自负责后续渲染。
      // 它们必须排在夜报「知道了」之后触发——否则月末那一夜的忠诚浮动等消息会被大事弹窗直接吞掉（夜报根本来不及出）
      const followUp = () => {
        if (isTournamentDay(m.day) && this.checkTournament(m)) return true;
        if (isMonthEnd(m.day) && this.checkBorderWar(m)) return true;
        if (this.checkFactionRaid(m)) return true;
        if (this.checkAmbush(m)) return true;
        if (Nemesis.checkCampChallenge(m)) return true;
        return false;
      };
      // 宿营夜报：只要当夜有事发生就弹卡片全量分类播报；确实无事才退回一句 toast
      if (NightReport.count()) {
        const pending = isTournamentDay(m.day) || isMonthEnd(m.day);
        // 夜报「知道了/继续」按钮承担着推进 followUp（月末国战/武将大会/夜袭等）的关键职责，
        // 背景误触关掉后这条链路会被整个跳过、地图也不会重渲染，务必标记 modal 只留按钮可关
        openOverlay(`<div class="result-card night-report">
          <h1>🏕️ 宿营夜报<small>${calLabel(m.day)}</small></h1>
          <div class="nr-body">${NightReport.bodyHtml()}</div>
          <div class="btns"><button class="btn-primary" id="camp-ok">${pending ? "继续 ›" : "知道了"}</button></div>
        </div>`, { modal: true });
        $("#camp-ok").onclick = () => { closeOverlay(); if (!followUp()) this.render(); };
      } else {
        toast(`🏕️ ${msg}（第 ${m.day} 天）`);
        if (!followUp()) this.render();
      }
    },
    // 已现身的武将每次宿营有小概率自行迁往同阵营的相邻城池（不含对马岛海路），令天下版图持续流动
    wanderGenerals(m) {
      let count = 0;
      const managed = Estate.managerIds(m);   // 掌柜常驻店面，不参与云游
      const guarded = Guard.ids(m);           // 守将驻城死守，同样不云游
      m.appeared.forEach(gid => {
        if (managed.has(gid) || guarded.has(gid)) return;
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
    // 月末边境/内战：owner 势力不同的相邻城池间，每月最多只爆发一场（优先挑与玩家所属势力相关的边，
    // 其次挑与玩家所属国相关的边，再退而求其次随机挑一条——纯粹与玩家无关的域外战事交给「天下战报」静默推演）；
    // 只有主角本人与麾下团队成员的出战与否需玩家勾选决定，其余已现身武将一律由候选池随机抽点补满（每方至多 10 将）；
    // 以野战演武（FieldBattle）开打，只决出谁能打到对方城下，能否真正夺城还要看紧随其后的攻城战（见 resolveSiege）；
    // 返回 true 表示已接管本次宿营流程
    /* 月末国战：每月 30 日的定期大会战，**只打跨国边境**（两端势力分属中日两国）。
     * 同国势力之间的兼并，一概交由玩家主动出征（见 openSortiePicker）与各势力的日常行动（FactionAI）处理——
     * 如此两套战事各司其职、语义清晰：月末的是「两国国战」，平日的是「诸侯内耗」，不再彼此撞车。
     * 这也让"保留中日两国概念"这条立意重新有了专属的承载物。 */
    checkBorderWar(m) {
      const heroCountry = RPG.char.side;
      // 跨国边境全部经由对马番所（tsushima_jp/tsushima_cn）中转——这两个番所是纯技术性占位势力，
      // 从不分配任何真实武将（initGeneralFactions 的城池池只取陆地城市），若沿用"两端都须有已现身武将"
      // 的旧判据，番所一侧永远交不出白卷，导致月末国战从此再也凑不出一条候选边——只放宽番所一侧的武将要求，
      // 大陆一侧仍须确有已现身武将，避免打一场双方都没人的空仗
      const edges = borderEdges(m).filter(([a, b]) => {
        const fa = cityFactionId(m, a), fb = cityFactionId(m, b);
        const da = factionDef(fa), db = factionDef(fb);
        if (!da || !db || da.side === db.side) return false;   // 只取跨国边境
        const aOk = DUMMY_FACTIONS.includes(fa) || DB.list.some(g => m.generalFaction[g.id] === fa && m.appeared.includes(g.id));
        const bOk = DUMMY_FACTIONS.includes(fb) || DB.list.some(g => m.generalFaction[g.id] === fb && m.appeared.includes(g.id));
        return aOk && bOk;
      });
      if (!edges.length) return false;
      const mine = m.playerFaction ? edges.filter(([a, b]) => cityFactionId(m, a) === m.playerFaction || cityFactionId(m, b) === m.playerFaction) : [];
      const homeland = edges.filter(([a, b]) => cityOwnerSide(m, a) === heroCountry || cityOwnerSide(m, b) === heroCountry);
      const pool = mine.length ? mine : (homeland.length ? homeland : edges);
      this._sortieMode = false;
      this.openBorderWarPicker(m, pool[randInt(0, pool.length - 1)]);
      return true;
    },
    /* ---- AI 主动犯境：填补玩家现效力势力（含自立当主与仕官）从不被 AI 主动攻打的空白 ----
     * 根因：FactionAI.war()（诸侯日常内耗的即时结算版本）显式把 m.playerFaction 排除在可攻目标之外
     * （`f.foe !== m.playerFaction`），本意是不让玩家的城池在毫无 UI、毫无还手余地的情况下被静默攻陷；
     * 但月末国战只打跨国边境，同国接壤的 AI 邻居从此对玩家形同不存在——玩家可以放心大胆地只吞并邻居、
     * 永无后顾之忧，边境战的攻守张力单方面消失。此处补一条同样走正式野战→攻城两段式流程（含排兵斗将/
     * 挥军破阵的完整 UI）的每日小概率检查，专打"接壤玩家势力"这一此前被 FactionAI.war() 硬性剔除的缺口，
     * 不改动 war() 本身的即时结算逻辑（避免打乱其原有的 AI 对 AI 内耗节奏与已校准过的数值）。 */
    FACTION_RAID_CHANCE: 0.1,
    checkFactionRaid(m) {
      if (!m.playerFaction || !isRealFaction(m.playerFaction)) return false;
      if (Math.random() >= this.FACTION_RAID_CHANCE) return false;
      const fid = m.playerFaction;
      const edges = borderEdges(m).filter(([a, b]) => {
        const fa = cityFactionId(m, a), fb = cityFactionId(m, b);
        return (fa === fid && isRealFaction(fb)) || (fb === fid && isRealFaction(fa));
      });
      if (!edges.length) return false;
      // 按"敌方攻我方之利"打分：敌强我弱、宿怨越深越可能来犯；正在休整（weary）的势力这天不会犯境
      const scored = edges.map(([a, b]) => {
        const fa = cityFactionId(m, a), fb = cityFactionId(m, b);
        const foe = fa === fid ? fb : fa;
        const to = fa === fid ? a : b, from = fa === fid ? b : a;
        return { edge: [a, b], foe,
          score: (FactionAI.warStrength(m, foe, from) - FactionAI.defStrength(m, fid, to)) + FactionAI.hostility(m, foe, fid) * 3 };
      }).filter(x => !FactionAI.weary(m, x.foe));
      if (!scored.length) return false;
      scored.sort((x, y) => y.score - x.score);
      const top = scored.slice(0, Math.min(2, scored.length));
      const pick = top[randInt(0, top.length - 1)];
      if (pick.score < -400) return false;   // 敌方毫无胜算时不会以卵击石，宁可再等等
      FactionAI.setWeary(m, pick.foe, 3);
      toast(`⚠️ ${factionName(pick.foe)}举兵来犯！`);
      this._sortieMode = false;
      this.openBorderWarPicker(m, pick.edge);
      return true;
    },
    /* 主动出征：玩家随时可从本势力城池向接壤的非本势力城池发兵——耗 1 行动力 + 3 道本势力军令
     * （军令由威名决定回复速度，天然限制了出征频率，无需另设冷却）。战斗流程完全复用已验证的
     * 野战→攻城两段式，只是 edge 由玩家点选、声援方强制为本势力。 */
    SORTIE_ORDERS: 3,
    // 根因修复：对马岛此前被列为"非海路中转不可出征"的例外，占岛之后既无法在此募兵回补、
    // 出征入口又被这里堵死——两国真要跨海一统，对马岛恰恰是唯一必经的桥头堡，理应可从此处出征
    sortieTargets(m) {
      if (!m.playerFaction || !isMyCity(m, m.curCity)) return [];
      return adjCities(m.curCity).filter(id => cityFactionId(m, id) !== m.playerFaction && isRealFaction(cityFactionId(m, id)));
    },
    sortieBtnHtml(m) {
      const targets = this.sortieTargets(m);
      if (!targets.length) return "";
      const orders = FactionOrders.get(m, m.playerFaction), cap = FactionOrders.cap(m, m.playerFaction);
      return `<button class="menu-btn" id="map-sortie"><span class="mi">⚔️</span><span>出征<small>可攻 ${targets.length} 城 · 军令 ${orders}/${cap}</small></span></button>`;
    },
    openSortie() {
      const m = Campaign.mapState();
      const targets = this.sortieTargets(m);
      if (!targets.length) return;
      const orders = FactionOrders.get(m, m.playerFaction);
      const enough = orders >= this.SORTIE_ORDERS;
      const isLord = m.playerFaction === "_player_";
      openOverlay(`<div class="result-card detail-card">
        <h1>⚔️ 出征</h1>
        <div class="wdesc">自【${cityName(m.curCity)}】发兵，攻取接壤的他家城池。<br>
          耗 <b>1⚡ 行动力</b> + <b>${this.SORTIE_ORDERS} 道军令</b>（本势力现有 <b style="color:${enough ? "var(--cn-gold)" : "var(--cn-red)"}">${orders}</b>/${FactionOrders.cap(m, m.playerFaction)}）。<br>
          此战仍分野战、攻城两阵，与月末国战同一套打法。攻克得城，功勋 <b>+150</b>。
          ${enough ? "" : `<br><b style="color:var(--cn-red)">${isLord ? "军令不足，休整数日再图大业。" : "军令不足——主公未允出兵，且待时机。"}</b>`}</div>
        ${enough ? `<div class="menu" style="max-height:44vh;overflow-y:auto">${targets.map(id => {
          const fid = cityFactionId(m, id);
          return `<button class="menu-btn sortie-t" data-id="${id}"><span class="mi">🎯</span><span>${cityName(id)}<small>${factionName(fid)} · 驻军 ${Garrison.get(m, id).toLocaleString()} · 城墙 ${Buildings.lv(m, id, "wall")} 级</small></span></button>`;
        }).join("")}</div>` : ""}
        <div class="btns"><button class="btn-ghost" id="sortie-close">再议</button></div>
      </div>`, { modal: true });
      $$(".sortie-t").forEach(b => b.onclick = () => {
        const target = b.dataset.id;
        if (!spendAP()) return;
        if (!FactionOrders.spend(m, m.playerFaction, this.SORTIE_ORDERS)) { toast("军令不足"); return; }
        Campaign.save();
        closeOverlay();
        this._sortieMode = true;
        this.openBorderWarPicker(m, [m.curCity, target]);
      });
      $("#sortie-close").onclick = () => { closeOverlay(); this.render(); };
    },
    openBorderWarPicker(m, edge) {
      this._bwPicks = new Set();
      this._bwRatio = 60;   // 出阵比例滑杆默认 60%：折中于「倾巢而出」与「固守为主」之间
      this._bwSupport = null;   // 声援哪一方势力（非本势力冲突时需玩家自行抉择，见 renderBorderWarPicker）
      this.renderBorderWarPicker(m, edge);
    },
    // 自选出战：只列出主角本人与麾下团队成员供勾选——这两类由玩家亲自决定是否出战；
    // 未勾选的团队成员一概不派（不会被随机抽中），其余已现身武将与你的抉择无关，一律由候选池随机补满出战名额。
    // 主角若未勾选出战，此战金币犒赏/赔付与你无涉——胜负仍会照常易主城池，但不动你的钱袋。
    // 出阵比例滑杆的说明文案：兵越多越禁得住消耗，但出多少、家里就空多少
    bwRatioLabel(m, cityId, pct) {
      const cap = Garrison.cap(m, cityId), have = Garrison.get(m, cityId);
      const commit = Math.round(have * pct / 100);
      return `出阵 <b>${pct}%</b>（调兵 ${commit.toLocaleString()}）　留守 ${(have - commit).toLocaleString()}　｜　本城驻军 ${have.toLocaleString()}/${cap.toLocaleString()}`;
    },
    // 判定这场冲突中，主角本人可以（且只能）声援哪一方势力：若其中一方正是玩家现效力的势力，别无选择、自动声援本方；
    // 否则只能声援与自己同属一国的那一方（两国界限不因势力林立而消融），若双方都不属本国，则此战与玩家无干，只能旁观
    bwEligibleSupport(m, edge) {
      const [a, b] = edge;
      const factionA = cityFactionId(m, a), factionB = cityFactionId(m, b);
      if (m.playerFaction === factionA || m.playerFaction === factionB) return [m.playerFaction];
      const heroCountry = RPG.char.side;
      return [factionA, factionB].filter(fid => factionDef(fid).side === heroCountry);
    },
    renderBorderWarPicker(m, edge) {
      const [a, b] = edge;
      const factionA = cityFactionId(m, a), factionB = cityFactionId(m, b);
      const defA = factionDef(factionA), defB = factionDef(factionB);
      const eligible = this.bwEligibleSupport(m, edge);
      // 声援哪一方需要玩家先行抉择的情形：本势力未涉此战、且双方都与本国同属一国（如两国各自的内战都恰巧不关己方势力事）
      if (eligible.length > 1 && this._bwSupport == null) {
        openOverlay(`<div class="result-card detail-card">
          <h1>⚔️ 边境战事</h1>
          <div class="wdesc">${cityName(a)}（${defA.n}）与 ${cityName(b)}（${defB.n}）爆发冲突，双方皆与你无形式上的君臣之谊，但同属你的国家——你可以自行决定是否以及声援哪一方，也可以完全不介入。</div>
          <div class="btns">
            <button class="btn-primary bw-support" data-f="${factionA}">声援 ${defA.n}</button>
            <button class="btn-primary bw-support" data-f="${factionB}">声援 ${defB.n}</button>
            <button class="btn-ghost bw-support" data-f="">不介入，静观其变</button>
          </div>
        </div>`, { modal: true });
        $$(".bw-support").forEach(btn => btn.onclick = () => {
          this._bwSupport = btn.dataset.f || "none";
          this.renderBorderWarPicker(m, edge);
        });
        return;
      }
      const heroFaction = eligible.length > 1 ? (this._bwSupport === "none" ? null : this._bwSupport) : (eligible[0] || null);
      // 全程无法介入（双方皆与本国无关，或玩家选择旁观）：直接全自动推演，不再弹出点将/滑杆
      if (!heroFaction) {
        closeOverlay();
        toast(`📜 ${defA.n}（${cityName(a)}）与 ${defB.n}（${cityName(b)}）交兵，与你无干，静观其变。`);
        this.resolveBorderWar(m, edge, [], 60, null);
        return;
      }
      const heroCity = heroFaction === factionA ? a : b;
      const picks = this._bwPicks;
      // 自立当主后 Bond.myRoster() 返回本势力麾下全部已现身武将，人数动辄数十——原先每点选一人就
      // 整块重渲染弹窗，滚动条随之弹回顶部，选到后面的人等于每次都要重新滚一遍。改为：列表本身按评分
      // 降序排定后不再因点选而重排/重绘，只切换被点按钮的高亮与顶部计数，滚动位置纹丝不动；
      // 另加一个按姓名过滤的搜索框，人多时不必硬滚，直接打字定位
      const pool = Bond.myRoster().filter(g => g.side === RPG.char.side).slice().sort((x, y) => ratingScore(y) - ratingScore(x));
      const entries = [{ id: -1, icon: "👑", name: `${RPG.char.name}（你）`, score: ratingScore(RPG.heroGeneral()) }]
        .concat(pool.map(g => ({ id: g.id, icon: avatarChar(g.name), name: g.name, score: ratingScore(g) })));
      const pickBtnHtml = e =>
        `<button class="buff-btn bw-pick ${picks.has(e.id) ? 'active' : ''}" data-id="${e.id}"><span class="bi">${e.icon}</span><span class="bt"><b>${e.name}</b><small>评分 ${e.score}</small></span></button>`;
      const rows = entries.map(pickBtnHtml);
      // 出阵比例滑杆只在"此战确系本势力"时才由玩家亲自操盘；若只是声援同属本国的他家内战，
      // 兵力调度权本不在玩家手上，改由该势力 AI 按敌我战力对比自行决定（见 resolveBorderWar 的 commitOf）
      const isOwnFactionWar = heroFaction === m.playerFaction;
      openOverlay(`<div class="result-card detail-card">
        <h1>⚔️ 边境战事</h1>
        <div class="wdesc">冲突爆发：<b>${cityName(a)}（${defA.n}）</b> vs <b>${cityName(b)}（${defB.n}）</b>，你声援 <b>${factionDef(heroFaction).n}</b> 一方。主角本人一经勾选必定亲历野战；团队成员纵经点选，仍需看当日调度，按概率随军，未必人人到场（其余已现身武将由候选池随机补满，无需你操心）。此战分两阵：先打<b>野战</b>，得胜一方才能乘胜杀奔败方城下再打一场<b>攻城战</b>，攻克方能真正夺城。勾选自己即视为亲历野战，若野战得胜，你将随军继续亲征攻城——攻克可得所夺城池金币日产出 <b>${this.BORDER_WAR_GOLD_DAYS}</b> 倍犒赏，未克也有一份约合十天产出的掳掠慰劳金；野战落败或不勾选自己，则此战胜负不动你的钱袋。</div>
        <input id="bw-search" placeholder="🔍 搜索武将姓名…" style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:8px;border:1px solid rgba(212,175,55,.35);background:rgba(0,0,0,.3);color:var(--paper);font-family:inherit;font-size:14px;margin-bottom:6px">
        <div class="buff-list" id="bw-pick-list" style="max-height:32vh;overflow-y:auto">${rows.join("")}</div>
        <div class="wdesc">已选 <b id="bw-pick-count">${picks.size}</b> 员（至多 10 员，评分降序排列，已选者高亮）</div>
        ${isOwnFactionWar ? `
        <div class="mc-sect">🚩 出阵比例<small>（兵力从${cityName(heroCity)}驻军中调拨，出得越多越经打，但家底也空得越多）</small></div>
        <input type="range" id="bw-ratio" min="10" max="100" step="5" value="${this._bwRatio}" style="width:100%">
        <div class="wdesc" id="bw-ratio-label">${this.bwRatioLabel(m, heroCity, this._bwRatio)}</div>` : `
        <div class="wdesc">🚩 此战并非本势力亲征，出阵比例由 <b>${factionDef(heroFaction).n}</b> 按敌我战力对比自行调度，不由你操盘。</div>`}
        <div class="btns"><button class="btn-primary" id="bw-go">开战</button></div>
      </div>`, { modal: true });
      const bindPickBtns = () => {
        $$(".bw-pick").forEach(btn => btn.onclick = () => {
          const id = +btn.dataset.id;
          if (picks.has(id)) picks.delete(id);
          else { if (picks.size >= 10) { toast(`最多派遣 10 员出战`); return; } picks.add(id); }
          btn.classList.toggle("active", picks.has(id));
          const cnt = $("#bw-pick-count"); if (cnt) cnt.textContent = picks.size;
        });
      };
      bindPickBtns();
      const search = $("#bw-search");
      if (search) search.oninput = () => {
        const kw = search.value.trim().toLowerCase();
        const list = $("#bw-pick-list");
        if (!list) return;
        const filtered = kw ? entries.filter(e => e.name.toLowerCase().includes(kw)) : entries;
        list.innerHTML = filtered.length ? filtered.map(pickBtnHtml).join("") : `<div class="empty">未找到符合条件的武将</div>`;
        bindPickBtns();
      };
      // 拖动滑杆只即时刷新自身文字标签，不整体重渲染（否则拖拽手感会被打断）；松手后的最终值随「开战」一并读取
      // 非本势力亲征时压根不渲染滑杆（见上），此处需判空，否则每次弹窗都会因 null.oninput 报错
      if ($("#bw-ratio")) {
        $("#bw-ratio").oninput = (e) => {
          this._bwRatio = +e.target.value;
          $("#bw-ratio-label").innerHTML = this.bwRatioLabel(m, heroCity, this._bwRatio);
        };
      }
      $("#bw-go").onclick = () => { const ids = [...picks]; const ratio = this._bwRatio; closeOverlay(); this.resolveBorderWar(m, edge, ids, ratio, heroFaction); };
    },
    // 共用：胜方夺城，同时调整双方部署——败方原驻守此城的武将退守至己方相邻城池，
    // 胜方随机挑选若干已现身武将进驻新占领的城池；troops（可选）为 {winner, loser} 双方此役幸存兵力，
    // 胜方幸存兵力就地成为新占城池的驻军，败方幸存兵力（此役出征在外、侥幸未阵亡者）退往己方相邻城池收编，
    // 败方原留守本城、未随军出征的兵力则随城池一并陷落，不设退路——返回被占领的城池 id
    applyBorderWarOutcome(m, edge, winnerFaction, troops) {
      const [a, b] = edge;
      const factionA = cityFactionId(m, a);
      const capturedCity = factionA === winnerFaction ? b : a;
      const loserFaction = cityFactionId(m, capturedCity);
      const loserSide = factionDef(loserFaction).side;
      // 易主前先把该城产业账目结算到今天：占领前的天数照常入账，占领期间懒结算自然颗粒无收
      Estate.accrue(m, capturedCity);
      if (!m.cityFaction) m.cityFaction = {};
      m.cityFaction[capturedCity] = winnerFaction;
      // 守将结局：败方守将城破被俘，下狱于陷落之城（暂从天下名录消失，可赎可救）
      const capturedGuard = Guard.capture(m, capturedCity, loserSide);
      if (capturedGuard) toast(`⛓️ 守将 ${capturedGuard.name} 城破被俘，囚于${cityName(capturedCity)}大牢！`);
      const managed = Estate.managerIds(m);
      DB.list.filter(g => m.assign[g.id] === capturedCity && m.generalFaction[g.id] === loserFaction
        && !managed.has(g.id) && !Guard.captives(m)[g.id]).forEach(g => {
        const opts = adjCities(capturedCity).filter(id => cityFactionId(m, id) === loserFaction);
        if (opts.length) m.assign[g.id] = opts[randInt(0, opts.length - 1)];
      });
      const garrisonPool = DB.list.filter(g => m.generalFaction[g.id] === winnerFaction && m.appeared.includes(g.id) && m.assign[g.id] !== capturedCity);
      shuffle(garrisonPool);
      garrisonPool.slice(0, randInt(2, 4)).forEach(g => { m.assign[g.id] = capturedCity; });
      if (winnerFaction === m.playerFaction) {
        // 己方夺城，牢门大开：此前被囚于此城的己方守将尽数放还
        Guard.heldAt(m, capturedCity).forEach(g => Guard.free(m, g.id, `——${cityName(capturedCity)}光复，牢门大开`));
        if (m.playerFaction === "_player_") Rewards.grantFeastCharge(m, 1, `攻克${cityName(capturedCity)}`);
      }
      // 战争损耗：不论谁攻克，破城都会伤及人口与城建，二者各自独立判定——人口打七到九折
      // （战乱伤亡、流离失所），六项城建各自独立六成概率被打残1~3级（不低于0级）、四成概率完好无损。
      // 城建受损后繁荣度/驻军上限会自动跟着掉（两者都是从城建/人口实时算出的派生值，不用额外结算），
      // 新主人得自己掏钱重建，攻城略地不再是"占了就白捡一座满血城市"
      Population.set(m, capturedCity, Math.round(Population.get(m, capturedCity) * (0.7 + Math.random() * 0.2)));
      Object.keys(BUILD_TYPES).forEach(t => {
        if (Math.random() >= 0.6) return;
        const lv = Buildings.lv(m, capturedCity, t);
        if (lv <= 0) return;
        if (!Buildings.all(m)[capturedCity]) Buildings.all(m)[capturedCity] = {};
        Buildings.all(m)[capturedCity][t] = Math.max(0, lv - randInt(1, 3));
      });
      if (troops) {
        Garrison.set(m, capturedCity, troops.winner);   // 胜方幸存兵力就地驻守新占之城
        if (troops.loser > 0) {
          const opts = adjCities(capturedCity).filter(id => cityFactionId(m, id) === loserFaction);
          if (opts.length) Garrison.add(m, opts[randInt(0, opts.length - 1)], troops.loser);
        }
      }
      // 此役若恰好夺走败方最后一城，败方就此覆灭——旧部按 FactionAI.onExtinct 的规则或降或散，
      // 不会仍挂在一个已不存在的势力名下形同"消失"（此前只有 FactionAI 日常出征会触发覆灭善后，
      // 玩家亲手（月末国战/主动出征）灭掉一家势力却完全没有走到这一步，是明显遗漏）
      if (!factionCityCount(m, loserFaction)) {
        const msg = FactionAI.onExtinct(m, loserFaction, winnerFaction);
        if (msg) toast(msg);
      }
      Campaign.save();
      return capturedCity;
    },
    // 只有主角本人与团队成员的出战与否由玩家在 openBorderWarPicker 勾选决定（pickedIds，-1 代表主角本人）；
    // 团队成员未被勾选则一概不派（不进入候选池，不会被随机抽中），其余已现身武将与玩家抉择无关，一律由候选池随机抽点补满名额。
    // 战斗一律以野战演武（FieldBattle）演出：主角上阵（被勾选）即为可亲自指挥的排兵布阵/阵前斗将/挥军破阵全流程，
    // 未上阵则全自动推演（无需任何点击，最高倍速跑完），不再静默瞬间出结果。heroFaction 为 null 时表示玩家全程不介入
    resolveBorderWar(m, edge, pickedIds, ratio, heroFaction) {
      const [a, b] = edge;
      const factionA = cityFactionId(m, a), factionB = cityFactionId(m, b);
      const pickedSet = new Set(heroFaction ? (pickedIds || []) : []);
      // 根因修复：自立当主后 Bond.myRoster() 已改为返回「本势力麾下全部已现身武将」（见该函数注释），
      // 不再是仕官/在野期那种与"其余武将"泾渭分明的小型私人团队——若仍按老逻辑把 myRoster() 整体
      // 当作"团队"来强制排除未勾选者，会把麾下几乎所有人都当成"未点选的团队成员"一并剔除，导致
      // 候选池随机补位的兜底名额（rest）形同虚设，出征十有八九只剩你亲自勾选的寥寥数人（甚至独自一人）
      // 出战——阵型自然只见前一两条战线有人、其余空空如也。当主时麾下诸将本就直接听你号令，无需
      // 逐一点选才肯到场，故此处不再区分"团队/非团队"，一律交由候选池随机补满
      const isLordWar = heroFaction === "_player_";
      const teamIds = new Set(heroFaction && !isLordWar ? Bond.myRoster().filter(g => g.side === RPG.char.side).map(g => g.id) : []);
      // 出阵兵力：只有当此战确系玩家现效力的本势力时，出阵比例才由玩家手上的滑杆决定——
      // 若只是"声援他国内战"（heroFaction 只是同属本国、玩家并无实际号令权的一方）或全程不介入，
      // 两边的出阵比例一律交给各自所属势力的 AI 按战力对比推算（commitRatio），不再由玩家越俎代庖，
      // 也不再是不问敌我强弱、一律 7 成的死数字
      const heroCity = heroFaction === factionA ? a : (heroFaction === factionB ? b : null);
      const foeCity = heroCity === a ? b : a;
      const isOwnFactionWar = !!heroFaction && heroFaction === m.playerFaction;
      const commitOf = (fid, cityId, foeFid) => (isOwnFactionWar && cityId === heroCity)
        ? Math.round(Garrison.get(m, cityId) * (ratio == null ? 60 : ratio) / 100)
        : Math.round(Garrison.get(m, cityId) * FactionAI.commitRatio(m, fid, foeFid));
      const aCommit = commitOf(factionA, a, factionB);
      const bCommit = commitOf(factionB, b, factionA);
      const heroCommit = heroCity === a ? aCommit : bCommit;
      const foeCommit = heroCity === a ? bCommit : aCommit;
      Garrison.spend(m, a, aCommit);
      Garrison.spend(m, b, bCommit);

      let poolA = DB.list.filter(g => m.generalFaction[g.id] === factionA && m.appeared.includes(g.id)).map(clone);
      let poolB = DB.list.filter(g => m.generalFaction[g.id] === factionB && m.appeared.includes(g.id)).map(clone);
      shuffle(poolA); shuffle(poolB);
      // 守将必上阵：其城在此战线上时置于本方阵前，另享 +3 全维死守加成（_guard 标记）——不论其本人形式上效忠谁，
      // 既已受托驻守此城，此役便与本城共存亡
      const guardFirst = (pool, cityId) => {
        const gid = Guard.all(m)[cityId];
        if (gid == null) return pool;
        const g = DB.get(gid);
        if (!g) return pool;
        const gg = clone(g); gg._guard = true;
        return [gg, ...pool.filter(x => x.id !== gid)];
      };
      poolA = guardFirst(poolA, a);
      poolB = guardFirst(poolB, b);
      // 临阵倒戈（简化版）：忠诚过低的武将有小概率在两军集结的这一刻倒向对面，而非在混战中途才切换阵营——
      // 兼顾戏剧性与实现的稳妥；主角亲自点选出战者与刚受托死守本城的守将不受此影响
      const battleDefect = (poolX, poolY) => {
        for (let i = poolX.length - 1; i >= 0; i--) {
          const g = poolX[i];
          if (g.id === -1 || g._guard || pickedSet.has(g.id)) continue;
          if (Loyalty.get(m, g.id) < 20 && Math.random() < 0.15) { poolX.splice(i, 1); poolY.push(g); }
        }
      };
      battleDefect(poolA, poolB);
      battleDefect(poolB, poolA);
      // 自选出战：主角本人一经勾选必定亲历此役；勾选的团队成员未必人人在场待命，按概率决定当日能否随军——
      // 团队成员本就分驻各处（管产业/守城/自行游历），点选只是"愿意的话请你出战"，不是"传送到场"。
      // 根因修复：此前 pickedGens 只在 heroPool（即 generalFaction === 本方势力 的候选池）内找勾选项，
      // 但团队成员是玩家私交结拜之人，generalFaction 未必等于玩家现所效力的这一方，导致纵然勾选也从未
      // 出现在 heroPool 里、自然被过滤得一个不剩——现改为直接从 Bond.myRoster() 取勾选者，不看 generalFaction。
      // 未勾选的团队成员仍整体剔除、不参与随机补位；剩余（既非主角/团队、也未被勾选）名额由候选池随机补满
      const TEAM_JOIN_CHANCE = 0.7;
      if (heroCity) {
        const heroPool = heroCity === a ? poolA : poolB;
        const pickedTeamGens = Bond.myRoster().filter(g => g.side === RPG.char.side)
          .filter(g => pickedSet.has(g.id) && Math.random() < TEAM_JOIN_CHANCE)
          .map(clone);
        const pickedTeamIdSet = new Set(pickedTeamGens.map(g => g.id));
        let rest = heroPool.filter(g => !pickedSet.has(g.id) && !teamIds.has(g.id));
        // 极端保底：若本方已现身武将几乎全是团队成员、又都未被勾选/未掷中概率，剔除后可能凑不出一兵一卒——
        // 此时放宽限制，把未随军的团队成员一并纳入候选池，确保战事总能照常开打
        if (!rest.length && !pickedTeamGens.length && !pickedSet.has(-1)) rest = heroPool.filter(g => !pickedSet.has(g.id));
        heroPool.length = 0;
        heroPool.push(...(pickedSet.has(-1) ? [RPG.heroGeneral()] : []), ...pickedTeamGens, ...rest.filter(g => !pickedTeamIdSet.has(g.id)));
      }
      // 野战演武每方各自最多五线十将——两侧独立封顶，不再取二者较小值。
      // 曾用 Math.min(poolA.length, poolB.length, 10) 强制两侧等长，意图是让五线对垒不至于失衡，
      // 但对马番所（tsushima_jp/tsushima_cn）这类天生 0 武将的哑势力一旦成为交战一方，会把这个较小值拖到 0，
      // 连同另一侧（含玩家亲自点选、已排到阵前的主角本人）也一并被 slice(0,0) 砍空——
      // 于是玩家明明勾选了自己出战，一开战却发现"未见你的身影"。「多人数容错」（deploy 的 filter(Boolean)）
      // 早已支持两侧人数不等甚至一侧为零的五线拆分，不再需要这层人为对齐
      const guardBuff = (g) => {
        if (!g._guard || g.id === -1) return g;
        const gg = clone(g);
        DIMS.forEach(([k]) => { gg[k] += Guard.STAT_BONUS; });
        return gg;
      };
      const rosterA = poolA.slice(0, 10).map(guardBuff);
      const rosterB = poolB.slice(0, 10).map(guardBuff);
      const heroCountry = RPG.char.side;
      const myRoster = heroCity === a ? rosterA : rosterB;
      const foeRoster = heroCity === a ? rosterB : rosterA;
      const heroIn = !!heroCity && myRoster.some(g => g.id === -1);

      GridBattle.beginExternal(myRoster, foeRoster, heroCountry, {
        rpg: true,             // 返回键归属战役层（回天下地图而非首页）
        observe: !heroIn,      // 主角未被抽中：全自动推演，无需任何点击
        troopScale: { mine: heroCity === a ? heroCommit : foeCommit, foe: heroCity === a ? foeCommit : heroCommit },
        onDone: (res) => {
          // 野战只决出「谁能打到对方城下」，城池是否易主留给随后的攻城战（resolveSiege）定夺；
          // 主角只有在己方野战得胜、且本人幸存时才随军继续攻城，否则（含己方落败）此后一律全自动推演
          const fieldWinnerFaction = res.playerWon === (heroCity === a) ? factionA : factionB;
          const heroWonField = fieldWinnerFaction === heroFaction;
          const heroFought = heroIn && heroWonField && res.mySurvivors.some(g => g.id === -1);
          this.resolveSiege(m, edge, fieldWinnerFaction, res, heroFought, heroIn, heroCity === a);
        },
      });
    },
    // 野战得胜方乘胜追击，围攻败方所在城池：攻方＝野战幸存之军原样杀奔城下（不再重新点选），
    // 守方＝当前驻守该城的己现身武将（含守将，套城墙守备加成）+ 该城尚未出征的留守驻军（军事一期的"留守"在此终于派上用场）。
    // 守方若一兵一将俱无，视同空城，兵不血刃直接开城，不必再打一场；否则复用野战演武的排兵斗将/挥军破阵流程再打一场攻城战。
    // heroInFieldA 记录主角在野战中处于 a 城一方（true）还是 b 城一方（false），供折算幸存军属于攻方还是守方
    resolveSiege(m, edge, fieldWinnerFaction, fieldRes, heroFought, heroIn, heroInFieldA) {
      const [a, b] = edge;
      const factionA = cityFactionId(m, a), factionB = cityFactionId(m, b);
      const heroCountry = RPG.char.side;
      const attackerFaction = fieldWinnerFaction;
      const attackerWasA = attackerFaction === factionA;
      const loserFaction = attackerWasA ? factionB : factionA;
      const attackerCity = attackerWasA ? a : b;
      const targetCity = attackerWasA ? b : a;   // 被围攻的目标城池
      // 野战中，主角一方对应 a 城（heroInFieldA）还是 b 城，据此判断胜方幸存兵/武将归入 mySurvivors 还是 foeSurvivors
      const attackerIsMine = attackerWasA === heroInFieldA;
      const attackerSurvivors = (attackerIsMine ? fieldRes.mySurvivors : fieldRes.foeSurvivors).map(clone);
      const attackerTroops = attackerIsMine ? fieldRes.myTroopsLeft : fieldRes.foeTroopsLeft;

      let defenderPool = DB.list.filter(g => m.generalFaction[g.id] === loserFaction && m.appeared.includes(g.id) && m.assign[g.id] === targetCity).map(clone);
      const gid = Guard.all(m)[targetCity];
      if (gid != null) {
        const g = DB.get(gid);
        if (g) { const gg = clone(g); gg._guard = true; defenderPool = [gg, ...defenderPool.filter(x => x.id !== gid)]; }
      }
      const defenderTroops = Garrison.get(m, targetCity);
      const attackerName = factionDef(attackerFaction).n;

      if (!defenderPool.length) {
        // 城中一兵一将俱无：兵不血刃，直接开城，无需再打一场
        toast(`🏳️ ${cityName(targetCity)}城中空虚，${attackerName}大军兵不血刃，长驱直入！`);
        this.finalizeBorderWar(m, edge, true, attackerFaction, targetCity, attackerCity, heroFought,
          heroFought && attackerSurvivors.some(g => g.id === -1), fieldRes.kills,
          { attacker: attackerTroops, defender: 0 }, heroIn, null);
        return;
      }

      // 守城方城墙守备：城墙旧有的"野战全员六维加成"改为专属守城战，另加守将 +3
      const wallBuff = Buildings.lv(m, targetCity, "wall") * 2;
      const defBuff = (g) => {
        const extra = wallBuff + (g._guard ? Guard.STAT_BONUS : 0);
        if (!extra || g.id === -1) return g;
        const gg = clone(g);
        DIMS.forEach(([k]) => { gg[k] += extra; });
        return gg;
      };
      const defenderRoster = defenderPool.slice(0, 10).map(defBuff);
      const myRoster = attackerIsMine ? attackerSurvivors : defenderRoster;
      const foeRoster = attackerIsMine ? defenderRoster : attackerSurvivors;
      const myTroops = attackerIsMine ? attackerTroops : defenderTroops;
      const foeTroops = attackerIsMine ? defenderTroops : attackerTroops;

      toast(`⚔️ 野战得胜，${attackerName}大军直逼${cityName(targetCity)}城下，攻城战一触即发！`);
      GridBattle.beginExternal(myRoster, foeRoster, heroCountry, {
        rpg: true,
        observe: !heroFought,   // 主角只有随野战得胜之军才继续亲征攻城，否则全自动推演
        troopScale: { mine: myTroops, foe: foeTroops },
        onDone: (siegeRes) => {
          const attackerWonSiege = attackerIsMine ? siegeRes.playerWon : !siegeRes.playerWon;
          const attackerTroopsLeft = attackerIsMine ? siegeRes.myTroopsLeft : siegeRes.foeTroopsLeft;
          const defenderTroopsLeft = attackerIsMine ? siegeRes.foeTroopsLeft : siegeRes.myTroopsLeft;
          const attackerSurvivorsList = attackerIsMine ? siegeRes.mySurvivors : siegeRes.foeSurvivors;
          const heroAliveFinal = heroFought && attackerSurvivorsList.some(g => g.id === -1);
          this.finalizeBorderWar(m, edge, attackerWonSiege, attackerFaction, targetCity, attackerCity, heroFought,
            heroAliveFinal, fieldRes.kills + siegeRes.kills, { attacker: attackerTroopsLeft, defender: defenderTroopsLeft }, heroIn,
            siegeRes.meritRanking);
        },
      });
    },
    // 攻城未克：目标城池归属不变，但双方此役折损照实结算——守方战后余兵就地驻守（城未失，兵却折了不少），
    // 攻方战后余兵撤回己方出征的那座城池（撤退亦非全须全尾）
    applySiegeRepelled(m, targetCity, attackerCity, defenderTroopsLeft, attackerTroopsLeft) {
      Garrison.set(m, targetCity, defenderTroopsLeft);
      if (attackerTroopsLeft > 0) Garrison.add(m, attackerCity, attackerTroopsLeft);
      Campaign.save();
    },
    // 边境战/攻城战最终结算：captured 表示攻方是否攻下目标城池（含空城直接开城的情形）；
    // heroFought 为真时（主角随野战得胜之军追击攻城）金币/名声与你的钱袋直接相关，胜负皆有所得——
    // 攻克照旧得所夺城池日产出 30 倍犒赏，未克则改发一份约合十天产出的掳掠慰劳金，敌城本身也在这场攻城战里元气大伤；
    // 未随军攻城（含己方野战即落败）则此战胜负与你的钱袋无涉，只有战报，没有金币结算
    finalizeBorderWar(m, edge, captured, attackerFaction, targetCity, attackerCity, heroFought, heroAlive, totalKills, troops, heroIn, meritRanking) {
      let capturedCity = null;
      let unifyHtml = "";
      if (captured) {
        capturedCity = this.applyBorderWarOutcome(m, edge, attackerFaction, { winner: troops.attacker, loser: troops.defender });
        if (attackerFaction === m.playerFaction) unifyHtml = checkUnifyEnding(m);
      } else {
        this.applySiegeRepelled(m, targetCity, attackerCity, troops.defender, troops.attacker);
      }
      const reportCity = captured ? capturedCity : targetCity;
      const warGold = captured
        ? this.BORDER_WAR_GOLD_DAYS * Estate.cityDailyGold(m, reportCity)
        : Math.round(this.BORDER_WAR_GOLD_DAYS / 3) * Estate.cityDailyGold(m, reportCity);   // 攻城未克的掳掠慰劳金：约合十天产出
      let heroHtml;
      if (heroFought) {
        const c = RPG.char;
        const goldGain = Bond.addGold(30 + totalKills * 4);
        const bonusGold = Bond.addGold(warGold);
        if (captured) Campaign.addFame(20); else Campaign.addFame(10);
        // 随军攻城是效力主公最直接的实绩；主动出征（你自己挑的仗）比被动应召的月末国战更值。
        // 自二十二期起，攻城得胜的功勋不再是一口价，而是按你本人在这场攻城战里的功勋排名（战场功勋值体系，
        // 见 GridBattle.finalizeMerit）打折/加成：排在前 30% ×1.3、中间 40% 原价、垫底 30% ×0.75——
        // 未能取胜（captured=false）或本场没有真打攻城战（空城直入，meritRanking 为 null）时不参与这套折算
        const meritBase = captured ? (this._sortieMode ? 150 : 120) : 40;
        let meritMul = 1, meritRankNote = "";
        if (captured && meritRanking && meritRanking.length) {
          const idx = meritRanking.findIndex(r => r.id === -1);
          if (idx >= 0) {
            const pct = (idx + 1) / meritRanking.length;
            meritMul = pct <= 0.3 ? 1.3 : pct <= 0.7 ? 1.0 : 0.75;
            meritRankNote = `（此役功勋第 ${idx + 1}/${meritRanking.length} 名 · ${meritMul > 1 ? "居前加成" : meritMul < 1 ? "垫底折算" : "居中原价"} ×${meritMul}）`;
          }
        }
        const meritAward = Math.round(meritBase * meritMul);
        if (m.playerFaction) PlayerRank.addMerit(m, meritAward);
        const exp = totalKills * 12 + (captured ? 60 : 25);
        c.exp += exp;
        let lvUp = 0;
        while (c.exp >= RPG.expNeed(c.level)) { c.exp -= RPG.expNeed(c.level); c.level++; c.points += 1; lvUp++; }
        RPG.save();
        heroHtml = `<div class="mc-sect">🎖️ 你的战果</div>
          <div class="wdesc">${heroAlive ? '全身而退' : '力战倒下（阵中负伤）'}，此役连破野战、攻城两阵，共歼敌将 <b style="color:var(--cn-red)">${totalKills}</b> 员${captured ? `，成功攻克【${cityName(reportCity)}】，名声 <b style="color:var(--cn-red)">+20</b>` : `，惜未能攻克【${cityName(reportCity)}】，名声仍 <b style="color:var(--cn-red)">+10</b>`}<br>获得经验 <b style="color:var(--cn-red)">+${exp}</b>${m.playerFaction ? `<br>🎖️ 功勋 <b style="color:var(--cn-red)">+${meritAward}</b>${meritRankNote}` : ''}${goldGain ? Bond.goldLine(goldGain) : ''}${bonusGold ? `<br>${captured ? "🏆 边境犒赏" : "💰 掳掠慰劳"} <b style="color:#b8860b">+${bonusGold}</b> 金（${captured ? "所夺" : "攻城未克，敌城"}日产出 ${captured ? this.BORDER_WAR_GOLD_DAYS : Math.round(this.BORDER_WAR_GOLD_DAYS / 3)} 倍 · 现有 <b style="color:#b8860b">${Bond.gold()}</b>）` : ''}${lvUp ? `<br>🎉 升级 ${lvUp} 级！` : ''}</div>`;
      } else if (heroIn) {
        // 主角亲历了野战，但己方未能取胜、无缘随军攻城——仍与你的钱袋无涉，但不宜说"未见你的身影"
        heroHtml = `<div class="wdesc">你亲历此役，惜野战失利，未能扩大战果——胜负不动你的钱袋。</div>`;
      } else {
        heroHtml = `<div class="wdesc">本场未见你的身影，前线战报照常传回，胜负不动你的钱袋。</div>`;
      }
      openOverlay(`<div class="result-card detail-card">
        <h1>⚔️ 边境战报</h1>
        <div class="wdesc">${captured ? `${factionDef(attackerFaction).n}一举攻克【${cityName(reportCity)}】！` : `${factionDef(attackerFaction).n}兵临【${cityName(reportCity)}】城下，久攻不克，只得退兵。`}${unifyHtml}</div>
        ${heroHtml}
        ${meritRanking ? GridBattle.meritRankingHtml(meritRanking, { limit: 8 }) : ""}
        <div class="btns"><button class="btn-primary" id="bw-close">${heroIn ? "返回天下地图" : "知道了"}</button></div>
      </div>`, { modal: true });
      $("#bw-close").onclick = () => { closeOverlay(); this.render(); showScreen("map"); };
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
      </div>`, { modal: true });
      $("#ambush-fight").onclick = () => {
        closeOverlay();
        m.activeAssassin = attacker.id; Campaign.save();
        startClassicBattle(RPG.heroGeneral(), attacker, false, true);
      };
      return true;
    },
    // 武将大会（每月 15 日举行的武将世界杯）：询问主角是否报名（较高报名费，杀入四强全额退还）；
    // 无论主角是否参加，其余 31 席都从已现身武将中随机抽取（不含主角，不足 32 人以「轮空」占位替补，
    // 队友与其他已现身武将一视同仁、独立参赛），冠亚军照常产生并发放奖励
    checkTournament(m) {
      const pool = DB.list.filter(g => m.appeared.includes(g.id));
      if (!pool.length) return false;
      const fee = Math.round(ratingScore(RPG.heroGeneral()) * 2);
      // checkTournament 返回 true 后，camp() 的夜报流程就不再自行 render()，全指望这个弹窗的
      // 两个按钮之一去驱动 runTournament——背景误触关掉会让地图停在未渲染的状态，必须标记 modal
      openOverlay(`<div class="result-card detail-card">
        <h1>🏆 武将大会</h1>
        <div class="wdesc">四方豪杰云集，本月武将大会即将开幕（32 强淘汰赛）。是否报名参加？报名费 <b style="color:var(--cn-red)">${fee}</b> 金（现有 💰${Bond.gold()}），若能杀入四强将全额退还。</div>
        <div class="btns">
          <button class="btn-ghost" id="tn-skip">不参加，静观其变</button>
          <button class="btn-primary" id="tn-join" ${Bond.gold() < fee ? "disabled" : ""}>报名参加</button>
        </div>
      </div>`, { modal: true });
      $("#tn-join").onclick = () => { closeOverlay(); this.runTournament(m, pool, true); };
      $("#tn-skip").onclick = () => { closeOverlay(); this.runTournament(m, pool, false); };
      return true;
    },
    // 生成「轮空」占位武将：仅在已现身武将不足 32 人时用于补满赛程，几乎必败
    byeFighter(i) {
      return { id: -3000 - i, name: "轮空", title: "", intro: "", side: "cn", ti: 10, wu: 10, tong: 10, zhi: 10, zheng: 10, mei: 10 };
    },
    runTournament(m, pool, joining) {
      // 除主角外的参赛席位不再随机抽取，改为按总评分从高到低挑选已现身武将中排名靠前者，
      // 使武将大会真正汇聚"当下天下最强的一批人物"而非随缘凑数
      let others = pool.slice().sort((a, b) => ratingScore(b) - ratingScore(a));
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
        if (m.playerFaction === "_player_" && (champion.id === -1 || runnerUp.id === -1)) {
          Rewards.grantFeastCharge(m, 1, champion.id === -1 ? "武将大会夺魁" : "武将大会屈居亚军");
        }
        openOverlay(`<div class="result-card detail-card">
          <h1>🏆 武将大会战报</h1>
          <div class="wdesc">冠军：<b style="color:var(--cn-red)">${champion.name}</b>${champion.id === -1 ? '（你）' : ''}　亚军：<b>${runnerUp.name}</b>${runnerUp.id === -1 ? '（你）' : ''}${feeHtml}</div>
          <div class="wdesc">${champHtml}</div>
          <div class="wdesc">${runnerHtml}</div>
          <div class="btns"><button class="btn-primary" id="tn-close">返回天下地图</button></div>
        </div>`, { modal: true });
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
    filterFid: null,   // 从「全部势力」点武将数跳转过来时，只看这一家势力麾下的已现身武将
    sort: { key: "bond", dir: -1 },   // 默认按友谊从高到低
    open(filterFid) {
      this.side = "all";
      this.filterFid = filterFid || null;
      $$(".side-tab[data-agside]").forEach(t => t.classList.toggle("active", t.dataset.agside === "all"));
      const kw = $("#allgen-search"); if (kw) kw.value = "";
      this.render();
      showScreen("allgen");
    },
    clearFilter() { this.filterFid = null; this.render(); },
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
      if (this.filterFid) arr = arr.filter(g => (m.generalFaction || {})[g.id] === this.filterFid);
      if (kw) arr = arr.filter(g => g.name.includes(kw) || (g.title || "").includes(kw));
      const filterBar = $("#allgen-filter");
      if (filterBar) filterBar.innerHTML = this.filterFid
        ? `<span class="filter-chip">只看：${facChip(this.filterFid)}<span class="fc-clear" id="allgen-filter-clear">✕</span></span>` : "";
      const fcClear = $("#allgen-filter-clear"); if (fcClear) fcClear.onclick = () => this.clearFilter();
      const rows = arr.map(g => ({ g, hg: Armory.geared(g, g.id) }));
      const { key, dir } = this.sort;
      rows.sort((a, b) => {
        if (key === "name") return a.g.name.localeCompare(b.g.name, "zh") * dir;
        if (key === "city") return cityName(m.assign[a.g.id]).localeCompare(cityName(m.assign[b.g.id]), "zh") * dir;
        // 势力：在野一律排到最后（无势力者不参与势力名比较，否则"在野"会混进势力名的字典序里）
        if (key === "fac") {
          const fa = (m.generalFaction || {})[a.g.id], fb = (m.generalFaction || {})[b.g.id];
          if (!fa && !fb) return 0;
          if (!fa) return 1;
          if (!fb) return -1;
          return factionName(fa).localeCompare(factionName(fb), "zh") * dir;
        }
        let va, vb;
        if (key === "rating") { va = ratingScore(a.hg); vb = ratingScore(b.hg); }
        else if (key === "bond") { va = Bond.pts(a.g.id); vb = Bond.pts(b.g.id); }
        // 忠诚：在野者无忠诚概念，按 -1 参与排序，升序时排最前、降序时垫底
        else if (key === "loyal") { va = (m.generalFaction || {})[a.g.id] ? Loyalty.get(m, a.g.id) : -1; vb = (m.generalFaction || {})[b.g.id] ? Loyalty.get(m, b.g.id) : -1; }
        else { va = a.hg[key]; vb = b.hg[key]; }
        return (va - vb) * dir;
      });
      const arrow = k => key === k ? (dir > 0 ? " ▲" : " ▼") : "";
      const th = (k, label) => `<th data-sort="${k}" class="${key === k ? 'sorted' : ''}">${label}${arrow(k)}</th>`;
      const head = `<tr>${th("name", "姓名")}${th("fac", "势力")}<th>官位</th>${th("loyal", "忠诚")}${DIMS.map(([k, l]) => th(k, l[0])).join("")}${th("rating", "评分")}<th>评级</th><th>将魂</th><th>携带宝物</th>${th("bond", "友谊")}${th("city", "所在城")}</tr>`;
      const body = rows.map(({ g, hg }) => {
        const cells = DIMS.map(([k]) => `<td class="num gt-${rateLetter(hg[k])}">${hg[k]}</td>`).join("");
        const fid = (m.generalFaction || {})[g.id];
        const lordMark = fid && isFactionLord(fid, g.id) ? '<span class="lord-mark" title="主公">👑</span>' : "";
        const postK = (m.posts || {})[g.id];
        const postTxt = fid && isFactionLord(fid, g.id) ? "—" : (postK ? Rewards.postName(postK, g.side) : "—");
        const items = Armory.itemsOf(g.id);
        const itemsTxt = items.length
          ? items.map(it => { const rar = Armory.rarityDef(it.rarity); return `<span style="color:${rar.color}" title="${it.name}（${rar.n}）">${it.icon}${rar.n[0]}</span>`; }).join(" ")
          : "—";
        return `<tr data-id="${g.id}"${fid && fid === m.playerFaction ? ' class="row-mine"' : ""}>
          <td class="dt-name ${g.side}"><span class="dt-dot"></span>${g.name}${lordMark}</td>
          <td class="allgen-city">${fid ? facChip(fid) : '<span style="color:#8d8578">在野</span>'}</td>
          <td class="allgen-city">${postTxt}</td>
          <td class="num">${fid ? loyaltyCell(m, fid, g.id) : "—"}</td>
          ${cells}
          <td class="dt-total">${ratingScore(hg)}</td>
          <td class="dt-grade">${ratingChip(hg)}</td>
          <td class="dt-skl">${Skill.tag(hg)}</td>
          <td class="dt-items">${itemsTxt}</td>
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

  /* 全部城市总览：与「全部武将」同风格的只读表格（挂在天下地图之下），
   * 行点击弹出该城详情（归属/繁荣/设施/专精/行情/产业/本地武将/悬赏/相邻城池） */
  const AllCityUI = {
    sort: { key: "name", dir: 1 },
    filterFid: null,   // 从「全部势力」点城池数跳转过来时，只看这一家势力名下的城池
    open(filterFid) { this.filterFid = filterFid || null; this.render(); showScreen("allcity"); },
    clearFilter() { this.filterFid = null; this.render(); },
    sortBy(key) {
      if (this.sort.key === key) this.sort.dir *= -1;
      else this.sort = { key, dir: key === "name" ? 1 : -1 };
      this.render();
    },
    rowData(m, c) {
      const owner = cityOwnerSide(m, c.id);
      const locals = DB.list.filter(g => m.assign[g.id] === c.id);
      const appeared = locals.filter(g => m.appeared.includes(g.id));
      const est = Estate.get(m, c.id);
      const eType = Estate.typeOf(c.id);
      const npc = !est && Estate.npcGet(m, c.id);
      let estTxt = "—", dailyGold = 0, dailyTxt = "—";
      if (eType) {
        if (npc) { estTxt = Estate.sealed(m, c.id) ? `${eType.icon}敌营` : `${eType.icon}可接管`; dailyGold = Estate.npcDailyRate(m, c.id); dailyTxt = `${dailyGold}（敌）`; }
        else if (!est) { estTxt = `未置办`; dailyGold = eType.rate; dailyTxt = `潜力${dailyGold}`; }
        else if (Estate.sealed(m, c.id)) { estTxt = `${eType.icon}查封`; dailyTxt = "查封"; }
        else { estTxt = `${eType.icon}${est.pending ? `待收${est.pending}` : est.manager != null ? "代收中" : "已置办"}`; dailyGold = Estate.dailyRate(m, c.id); dailyTxt = `${dailyGold}`; }
      }
      const fac = CITY_FACILITY[c.id];
      const fid = cityFactionId(m, c.id);
      // 六项城建等级（不含海路中转站）：紧凑展示为「图标+级数」，无一兴建时显示"—"
      const buildOpts = cityBuildOptions(c.id);
      const buildTxt = buildOpts.length
        ? buildOpts.map(t => `${BUILD_TYPES[t].icon}${Buildings.lv(m, c.id, t)}`).join(" ")
        : "—";
      const priceFactor = c.side === "sea" ? null : cityPriceFactor(c.id);
      const priceTxt = priceFactor == null ? "—"
        : (priceFactor <= 0.85 ? "🈹黑市" : priceFactor < 1 ? "💰偏低" : priceFactor > 1.1 ? "📈偏贵" : "⚖️公道")
          + `${Math.round(priceFactor * 100)}%` + marketTrendSuffix(m, c.id);
      return {
        c, owner, prosper: Prosper.lv(m, c.id), buildTxt,
        fid, facnName: isRealFaction(fid) ? factionName(fid) : "无主", lord: isRealFaction(fid) ? factionLordName(fid) : "—",
        facName: fac ? fac.n : "—",
        smith: Armory.TYPES[hashStr(c.id) % Armory.TYPES.length].n,
        estTxt, dailyGold, dailyTxt, priceFactor: priceFactor || 0, priceTxt, appeared: appeared.length, total: locals.length,
        bounty: ((m.bounties && m.bounties[c.id]) || []).length,
        // 对马岛虽是海路中转站，驻军照常回补募兵，总览表不再对其隐藏兵力数字（见 Garrison.tickAll 的根因修复）
        troops: Garrison.get(m, c.id), troopsCap: Garrison.cap(m, c.id),
        population: c.side === "sea" ? null : Population.get(m, c.id),
      };
    },
    render() {
      const m = Campaign.mapState();
      const list = $("#allcity-list");
      if (!m) { list.innerHTML = '<div class="empty">尚未开局</div>'; return; }
      let rows = CITIES.map(c => this.rowData(m, c));
      if (this.filterFid) rows = rows.filter(r => r.fid === this.filterFid);
      const filterBar = $("#allcity-filter");
      if (filterBar) filterBar.innerHTML = this.filterFid
        ? `<span class="filter-chip">只看：${facChip(this.filterFid)}<span class="fc-clear" id="allcity-filter-clear">✕</span></span>` : "";
      const fcClear = $("#allcity-filter-clear"); if (fcClear) fcClear.onclick = () => this.clearFilter();
      const { key, dir } = this.sort;
      rows.sort((a, b) => {
        if (key === "name") return a.c.n.localeCompare(b.c.n, "zh") * dir;
        if (key === "owner") return a.owner.localeCompare(b.owner) * dir;
        if (key === "facn") return a.facnName.localeCompare(b.facnName, "zh") * dir;
        if (key === "lord") return a.lord.localeCompare(b.lord, "zh") * dir;
        return ((a[key] || 0) - (b[key] || 0)) * dir;
      });
      const arrow = k => key === k ? (dir > 0 ? " ▲" : " ▼") : "";
      const th = (k, label) => `<th data-sort="${k}" class="${key === k ? 'sorted' : ''}">${label}${arrow(k)}</th>`;
      const head = `<tr>${th("name", "城市")}${th("facn", "势力")}${th("lord", "主公")}${th("owner", "国别")}${th("prosper", "繁荣")}<th>城建</th><th>特色设施</th><th>铁匠专精</th><th>产业</th>${th("dailyGold", "日进")}${th("priceFactor", "本地行情")}${th("population", "人口")}${th("troops", "驻军")}${th("appeared", "武将")}${th("bounty", "悬赏")}</tr>`;
      const body = rows.map(r => `<tr data-id="${r.c.id}"${r.fid === m.playerFaction ? ' class="row-mine"' : ""}>
          <td class="dt-name ${r.owner}"><span class="dt-dot"></span>${r.c.id === m.curCity ? "📍" : ""}${r.c.n}</td>
          <td class="allgen-city">${isRealFaction(r.fid) ? facChip(r.fid) : "—"}</td>
          <td class="allgen-city">${r.lord}</td>
          <td class="num">${r.c.side === "sea" ? "🌊" : ""}${sideName(r.owner)}</td>
          <td class="num" style="color:var(--cn-gold)">${"★".repeat(r.prosper)}</td>
          <td class="allgen-city" style="white-space:nowrap">${r.buildTxt}</td>
          <td class="allgen-city">${r.facName}</td>
          <td class="allgen-city">${r.smith}</td>
          <td class="allgen-city">${r.estTxt}</td>
          <td class="num">${r.dailyTxt}</td>
          <td class="allgen-city">${r.priceTxt}</td>
          <td class="num">${r.population == null ? "—" : r.population.toLocaleString()}</td>
          <td class="num">${r.troops == null ? "—" : `${r.troops.toLocaleString()}/${r.troopsCap.toLocaleString()}`}</td>
          <td class="num">${r.appeared}/${r.total}</td>
          <td class="num">${r.bounty}</td>
        </tr>`).join("");
      list.innerHTML = `<table class="db-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
      $$("#allcity-list th[data-sort]").forEach(h => h.onclick = () => this.sortBy(h.dataset.sort));
      $$("#allcity-list tbody tr").forEach(tr => { tr.onclick = () => this.showCity(tr.dataset.id); });
    },
    showCity(cityId) {
      const m = Campaign.mapState();
      const c = cityDef(cityId);
      if (!m || !c) return;
      const r = this.rowData(m, c);
      const est = Estate.get(m, cityId);
      const eType = Estate.typeOf(cityId);
      const factor = cityPriceFactor(cityId);
      const factorTxt = (factor <= 0.85 ? "黑市八折" : factor < 1 ? "行情便宜" : factor > 1.1 ? "行情偏贵" : "价格公道") + marketTrendSuffix(m, cityId);
      const appearedNames = DB.list.filter(g => m.assign[g.id] === cityId && m.appeared.includes(g.id))
        .map(g => `<span class="dt-name ${g.side}" style="margin-right:8px">${g.name}</span>`).join("") || "暂无现身武将";
      const bounties = (m.bounties && m.bounties[cityId]) || [];
      let estHtml = "—（海路中转站无产业）";
      if (eType) {
        const npc = !est && Estate.npcGet(m, cityId);
        if (npc) estHtml = `${eType.icon}敌营${eType.lvN[npc.lv - 1]}（${npc.lv} 级） · ${Estate.sealed(m, cityId) ? "敌方经营中" : `可接管（${Estate.takeoverPrice(m, cityId)} 金）`}`;
        else if (!est) estHtml = `${eType.icon}${eType.n} · 未置办（${eType.cost} 金，日进约 ${eType.rate} 金）`;
        else if (Estate.sealed(m, cityId)) estHtml = `${eType.icon}${Estate.lvName(m, cityId)} · <b style="color:var(--cn-red)">⛔ 已被查封</b>`;
        else {
          const mgr = est.manager != null ? DB.get(est.manager) : null;
          estHtml = `${eType.icon}${Estate.lvName(m, cityId)}${Estate.lvOf(est) > 1 ? `（${Estate.lvOf(est)} 级）` : ""} · 日进 ${Estate.dailyRate(m, cityId)} 金 · 待收 ${est.pending || 0} 金${mgr ? ` · 掌柜 ${mgr.name}（累计代收 ${est.banked || 0}）` : ""}`;
        }
      }
      const buildOpts = cityBuildOptions(cityId);
      const buildHtml = buildOpts.length
        ? buildOpts.map(t => { const lv = Buildings.lv(m, cityId, t); return `${BUILD_TYPES[t].icon}${BUILD_TYPES[t].n}${lv ? ` ${lv} 级` : "未建"}`; }).join(" · ")
        : "—";
      const guard = Guard.of(m, cityId);
      const captNames = Guard.heldAt(m, cityId).map(g => g.name).join("、");
      // 若当前所在城池与这座城池之间已能通驿（两端均归属本方国别且建有驿站），额外给一个直达按钮——
      // 费用、耗行动力与驿站快马面板完全一致（同一份 postDests/postTravel），不是另起一套换算
      const postDest = RPG.char && cityId !== m.curCity ? Buildings.postDests(m).find(d => d.id === cityId) : null;
      openOverlay(`<div class="result-card detail-card">
        <h1>📍 ${c.n} <small style="color:var(--cn-gold)">${"★".repeat(r.prosper)}</small></h1>
        <div class="wdesc">
          🚩 归属：${isRealFaction(r.fid) ? `${facChip(r.fid)} · 主公 <b>${r.lord}</b> · ${sideName(r.owner)}` : `<b>无主番所</b> · ${sideName(r.owner)}`}${c.side === "sea" ? "（海路中转站）" : ""}${r.fid === m.playerFaction ? ' · <b style="color:var(--cn-gold)">本势力</b>' : ""}${cityId === m.curCity ? " · 你正在此城" : ""}<br>
          ${r.facName !== "—" ? `🏯 特色设施：${r.facName}<br>` : ""}
          ⚒️ 铁匠专精：${r.smith} · 🏪 集市：${factorTxt}<br>
          🏗️ 城建：${buildHtml}<br>
          🛡️ 守将：${guard ? guard.name : "无"}${captNames ? ` · ⛓️ 狱中：${captNames}` : ""}<br>
          ${r.population == null ? "" : `👨‍👩‍👧 人口：${r.population.toLocaleString()} / ${Population.cap(m, cityId).toLocaleString()}<br>`}
          🚩 驻军：${r.troops.toLocaleString()} / ${r.troopsCap.toLocaleString()}（每日回复 ${Garrison.regen(m, cityId).toLocaleString()}${r.fid === m.playerFaction ? ` · 今日征兵配额剩 ${Garrison.remainingQuota(m, cityId).toLocaleString()}/${Garrison.recruitQuota(m, cityId).toLocaleString()}` : ""}）<br>
          🏠 产业：${estHtml}<br>
          🚶 本地已现身武将（${r.appeared}/${r.total}）：${appearedNames}<br>
          📋 悬赏（${bounties.length}）：${bounties.map(b => `${b.legendary ? "⭐" : ""}${b.desc}`).join("；") || "暂无"}<br>
          🛣️ 相邻城池：${adjCities(cityId).map(id => cityName(id)).join("、")}
        </div>
        <div class="btns">
          ${postDest ? `<button class="btn-ghost" id="ac-post-go">🏇 驿站直达（${postDest.cost} 金 · 1⚡）</button>` : ""}
          <button class="btn-primary" id="ac-close">知道了</button>
        </div>
      </div>`, { modal: true });
      $("#ac-close").onclick = () => closeOverlay();
      if (postDest) {
        $("#ac-post-go").onclick = () => {
          MapUI.confirmPostTravel(m, postDest);
          // 从「全部城市」这张只读表格发起的直达：走完驿传后要把玩家带回天下地图去看新位置，
          // 而不是留在原地——这一点与驿站快马面板/地图点城两条既有入口（本就已在地图屏）不同
          const goBtn = $("#pt-go");
          if (goBtn) goBtn.onclick = () => { MapUI.postTravel(m, postDest.id); showScreen("map"); };
        };
      }
    },
  };

  /* 全部势力总览：与「全部城市」同风格的只读表格（挂在天下地图之下），
   * 行点击弹出该势力详情（所辖城池/麾下重臣/接壤势力/与玩家的关系）。
   * 对马番所两个技术性占位不入列——它们不是真正的势力 */
  const AllFacUI = {
    side: "all",
    sort: { key: "cities", dir: -1 },   // 默认按占城数从多到少，一眼看出天下格局
    open() {
      this.side = "all";
      $$(".side-tab[data-afside]").forEach(t => t.classList.toggle("active", t.dataset.afside === "all"));
      this.render(); showScreen("allfac");
    },
    setSide(side) {
      this.side = side;
      $$(".side-tab[data-afside]").forEach(t => t.classList.toggle("active", t.dataset.afside === side));
      this.render();
    },
    sortBy(key) {
      if (this.sort.key === key) this.sort.dir *= -1;
      else this.sort = { key, dir: key === "name" || key === "lord" ? 1 : -1 };
      this.render();
    },
    rowData(m, fid) {
      const def = factionDef(fid);
      const gens = factionGenerals(m, fid, false);
      const appeared = gens.filter(g => m.appeared.includes(g.id));
      const loyals = appeared.filter(g => !isFactionLord(fid, g.id)).map(g => Loyalty.get(m, g.id));
      const cityIds = CITIES.filter(c => c.side !== "sea" && cityFactionId(m, c.id) === fid).map(c => c.id);
      const power = appeared.map(g => ratingScore(Armory.geared(g, g.id))).sort((a, b) => b - a).slice(0, 5).reduce((s, x) => s + x, 0);
      return {
        fid, def, name: def.n, lord: def.lord, side: def.side,
        cities: cityIds.length, cityIds,
        gens: appeared.length, gensTotal: gens.length,
        troops: cityIds.reduce((s, id) => s + Garrison.get(m, id), 0),
        fame: FactionFame.get(m, fid), orders: FactionOrders.get(m, fid), ordersCap: FactionOrders.cap(m, fid),
        gold: FactionGold.get(m, fid), dailyIncome: FactionGold.income(m, fid),
        loyal: loyals.length ? Math.round(loyals.reduce((s, x) => s + x, 0) / loyals.length) : 0,
        power,
      };
    },
    render() {
      const m = Campaign.mapState();
      const list = $("#allfac-list");
      if (!m) { list.innerHTML = '<div class="empty">尚未开局</div>'; return; }
      let ids = liveFactionIds(m);
      if (this.side !== "all") ids = ids.filter(fid => factionDef(fid).side === this.side);
      const rows = ids.map(fid => this.rowData(m, fid)).filter(r => r.cities > 0 || r.gens > 0);
      const { key, dir } = this.sort;
      rows.sort((a, b) => {
        if (key === "name") return a.name.localeCompare(b.name, "zh") * dir;
        if (key === "lord") return a.lord.localeCompare(b.lord, "zh") * dir;
        return ((a[key] || 0) - (b[key] || 0)) * dir;
      });
      const arrow = k => key === k ? (dir > 0 ? " ▲" : " ▼") : "";
      const th = (k, label) => `<th data-sort="${k}" class="${key === k ? 'sorted' : ''}">${label}${arrow(k)}</th>`;
      const head = `<tr>${th("name", "势力")}${th("lord", "主公")}<th>国别</th>${th("cities", "城池")}${th("gens", "武将")}${th("troops", "兵力")}${th("fame", "威名")}${th("orders", "军令")}${th("gold", "金库")}${th("dailyIncome", "日进")}${th("loyal", "平均忠诚")}${th("power", "战力")}</tr>`;
      const body = rows.map(r => `<tr data-id="${r.fid}"${r.fid === m.playerFaction ? ' class="row-mine"' : ""}>
          <td class="allgen-city">${facChip(r.fid)}</td>
          <td class="dt-name ${r.side}">${r.lord}</td>
          <td class="num">${sideName(r.side)}</td>
          <td class="num allfac-link" data-goto="cities">${r.cities}</td>
          <td class="num allfac-link" data-goto="gens">${r.gens}/${r.gensTotal}</td>
          <td class="num">${r.troops.toLocaleString()}</td>
          <td class="num"><b style="color:var(--cn-gold)">${r.fame}</b><br><small>${FactionFame.tierName(r.fame)}</small></td>
          <td class="num">${r.orders}/${r.ordersCap}</td>
          <td class="num">${r.gold.toLocaleString()}</td>
          <td class="num">${r.dailyIncome.toLocaleString()}</td>
          <td class="num">${r.loyal ? loyaltyHtml(r.loyal) : "—"}</td>
          <td class="dt-total">${r.power}</td>
        </tr>`).join("");
      list.innerHTML = rows.length
        ? `<table class="db-table"><thead>${head}</thead><tbody>${body}</tbody></table>`
        : `<div class="empty">天下已无此列势力</div>`;
      $$("#allfac-list th[data-sort]").forEach(h => h.onclick = () => this.sortBy(h.dataset.sort));
      $$("#allfac-list tbody tr").forEach(tr => { tr.onclick = () => this.showFaction(tr.dataset.id); });
      // 城池数/武将数两格单独跳转到「全部城市/全部武将」并按本势力筛选，不冒泡到整行的势力详情弹层
      $$("#allfac-list .allfac-link").forEach(td => td.onclick = (e) => {
        e.stopPropagation();
        const fid = td.closest("tr").dataset.id;
        if (td.dataset.goto === "cities") AllCityUI.open(fid); else AllGenUI.open(fid);
      });
    },
    showFaction(fid) {
      const m = Campaign.mapState();
      if (!m || !factionDef(fid)) return;
      const r = this.rowData(m, fid);
      const top = factionGenerals(m, fid, true)
        .sort((a, b) => ratingScore(Armory.geared(b, b.id)) - ratingScore(Armory.geared(a, a.id))).slice(0, 10)
        .map(g => `<span class="dt-name ${g.side}" style="margin-right:8px">${g.name}${isFactionLord(fid, g.id) ? "👑" : ""} ${loyaltyCell(m, fid, g.id)}</span>`).join("") || "暂无现身武将";
      // 接壤势力：由边境线反查，天然反映当前版图而非初始版图
      const neigh = new Set();
      borderEdges(m).forEach(([a, b]) => {
        const fa = cityFactionId(m, a), fb = cityFactionId(m, b);
        if (fa === fid && isRealFaction(fb)) neigh.add(fb);
        if (fb === fid && isRealFaction(fa)) neigh.add(fa);
      });
      let rel = "无涉";
      if (fid === m.playerFaction) rel = '<b style="color:var(--cn-gold)">本势力</b>';
      else if (PlayerRank.exLordHostile(m, fid)) rel = `<b style="color:var(--cn-red)">旧主嫌隙未消（${m.exLordUntil[fid] - m.day} 天）</b>`;
      else if (RPG.char && factionDef(fid).side === RPG.char.side) rel = "本国他家";
      else rel = "异国";
      openOverlay(`<div class="result-card detail-card">
        <h1>${facChip(fid)}</h1>
        <div class="wdesc">
          👑 主公：<b>${r.lord}</b> · ${sideName(r.side)} · 与你：${rel}<br>
          🏯 威名：<b style="color:var(--cn-gold)">${r.fame}</b>（${FactionFame.tierName(r.fame)}） · 📜 军令：${r.orders}/${r.ordersCap} · 💰 金库：${r.gold.toLocaleString()}（日进 ${r.dailyIncome.toLocaleString()}）<br>
          🗺️ 所辖城池（${r.cities}）：${r.cityIds.map(id => cityName(id)).join("、") || "已无寸土"}<br>
          🚩 总兵力：${r.troops.toLocaleString()} · ⚔️ 战力（前五评分和）：${r.power}<br>
          🕊️ 平均忠诚：${r.loyal ? loyaltyHtml(r.loyal) : "—"} · 麾下武将 ${r.gens}/${r.gensTotal} 已现身<br>
          🤝 接壤势力：${[...neigh].map(f => factionName(f)).join("、") || "无接壤（内陆或已孤立）"}<br>
          🎖️ 麾下重臣：${top}
        </div>
        <div class="btns"><button class="btn-primary" id="af-close">知道了</button></div>
      </div>`, { modal: true });
      $("#af-close").onclick = () => closeOverlay();
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
      const head = `<tr>${th("name", "姓名")}${DIMS.map(([k, l]) => th(k, l[0])).join("")}${th("rating", "评分")}<th>评级</th><th>技能</th><th>操作</th></tr>`;
      const body = arr.map(g => {
        const cells = DIMS.map(([k]) => `<td class="num gt-${rateLetter(g[k])}">${g[k]}</td>`).join("");
        return `<tr data-id="${g.id}">
          <td class="dt-name ${g.side}"><span class="dt-dot"></span>${g.name}</td>
          ${cells}
          <td class="dt-total">${ratingScore(g)}</td>
          <td class="dt-grade">${ratingChip(g)}</td>
          <td class="dt-skl">${Skill.tag(g)}</td>
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
        </div></div>`, { modal: true });
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
      <div class="btns"><button class="btn-ghost" id="eq-cancel">取消</button></div></div>`, { modal: true });
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
    // 仓库筛选：按类别/等级筛选时未鉴定的「神秘宝物」一律放行——其真实类别/等级尚未向玩家揭示，
    // 若被过滤器悄悄吃掉或露出，等于用筛选结果反向泄露了尚未鉴宝就不该知道的信息；
    // 装备状态筛选则不受此限——未鉴定宝物本就无法装备，天然算作"未装备"
    stockFilterOptionsHtml() {
      const t = this._stockType || "all", r = this._stockRarity || "all", e = this._stockEquip || "all";
      const typeOpts = `<option value="all">全部类别</option>` + Armory.TYPES.map(x => `<option value="${x.k}" ${t === x.k ? "selected" : ""}>${x.icon} ${x.n}</option>`).join("");
      const rarOpts = `<option value="all">全部等级</option>` + Armory.RARITIES.map(x => `<option value="${x.k}" ${r === x.k ? "selected" : ""}>${x.n}</option>`).join("");
      const eqOpts = `<option value="all" ${e === "all" ? "selected" : ""}>全部</option><option value="equipped" ${e === "equipped" ? "selected" : ""}>已装备</option><option value="unequipped" ${e === "unequipped" ? "selected" : ""}>未装备</option>`;
      return `<div class="stock-filter-row">
        <select id="stock-f-type">${typeOpts}</select>
        <select id="stock-f-rarity">${rarOpts}</select>
        <select id="stock-f-equip">${eqOpts}</select>
      </div>`;
    },
    renderStock() {
      const typeF = this._stockType || "all", rarF = this._stockRarity || "all", eqF = this._stockEquip || "all";
      let items = Armory.data.items.slice();
      const totalCount = items.length;
      items = items.filter(i => {
        const mystery = i.identified === false;
        if (typeF !== "all" && !mystery && i.type !== typeF) return false;
        if (rarF !== "all" && !mystery && i.rarity !== rarF) return false;
        if (eqF === "equipped" && i.equippedBy == null) return false;
        if (eqF === "unequipped" && i.equippedBy != null) return false;
        return true;
      });
      const rarIdx = k => Armory.RARITIES.findIndex(r => r.k === k);
      // 待鉴定的神秘宝物不按其（尚未揭示的）稀有度参与排序，固定排在已鉴定宝物之后，避免用位置泄露信息
      items.sort((a, b) => {
        const au = a.identified === false, bu = b.identified === false;
        if (au !== bu) return au ? 1 : -1;
        if (au && bu) return 0;
        return rarIdx(b.rarity) - rarIdx(a.rarity);
      });
      if (!totalCount) return `<div class="empty">尚未获得任何宝物——去战场上搏一件吧</div>`;
      const filterBar = this.stockFilterOptionsHtml();
      const bulkCount = Armory.data.items.filter(i => i.identified !== false && !i.equippedBy && i.rarity !== "legend").length;
      const bulkBar = `<div class="stock-bulk-row"><button class="btn-ghost" id="stock-dismantle-all" ${bulkCount ? "" : "disabled"}>🔨 一键拆解非传说未装备（${bulkCount}）</button></div>`;
      if (!items.length) return `${filterBar}${bulkBar}<div class="empty">没有符合筛选条件的宝物</div>`;
      return `${filterBar}${bulkBar}<div class="section-hint">各玩法获胜后有机会掉落，但掉落的宝物为「未鉴定」状态，需花金鉴宝才能查看细节、装备与拆解；已装备的宝物请先在「角色扮演」或武将详情中卸下，才能在此拆解。</div>
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
      const bulkBtn = $("#stock-dismantle-all");
      if (bulkBtn) bulkBtn.onclick = () => {
        const n = Armory.data.items.filter(i => i.identified !== false && !i.equippedBy && i.rarity !== "legend").length;
        if (!n) return;
        if (!confirm(`确定一键拆解全部 ${n} 件「非传说·未装备」宝物？将永久失去这些宝物，换取材料，此操作不可撤销。`)) return;
        const result = Armory.dismantleAllNonLegendUnequipped();
        if (result) {
          const gainedTxt = Object.entries(result.gained).map(([type, n]) => `${Armory.typeDef(type).n}+${n}`).join("、");
          toast(`一键拆解 ${result.count} 件宝物，获得 ${gainedTxt}`);
        }
        this.render();
      };
      $$(".ic-identify").forEach(b => b.onclick = () => { if (Armory.identify(+b.dataset.uid)) this.render(); });
      const ft = $("#stock-f-type"); if (ft) ft.onchange = (e) => { this._stockType = e.target.value; this.render(); };
      const fr = $("#stock-f-rarity"); if (fr) fr.onchange = (e) => { this._stockRarity = e.target.value; this.render(); };
      const fe = $("#stock-f-equip"); if (fe) fe.onchange = (e) => { this._stockEquip = e.target.value; this.render(); };
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
        </div></div>`, { modal: true });
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
   *  设置：目前只有字体选择一项，右上角音乐/音效按钮旁新增的⚙️入口——
   *  切换只需改写 :root 的 --app-font 这一个 CSS 变量（见 style.css），存到 localStorage 下次启动自动生效
   * ============================================================ */
  const SETTINGS_KEY = "wujiang_settings_v1";
  const Settings = {
    FONTS: [
      { key: "heiti", n: "黑体", stack: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Heiti SC", "Source Han Sans SC", sans-serif' },
      { key: "songti", n: "宋体", stack: '"Noto Serif SC", "Songti SC", "STSong", "SimSun", serif' },
      { key: "kaiti", n: "楷体", stack: '"STKaiti", "KaiTi", "Kaiti SC", "华文楷体", serif' },
      { key: "yuanti", n: "圆体", stack: '"STYuanti", "Yuanti SC", "华文中圆", "PingFang SC", sans-serif' },
      { key: "yahei", n: "微软雅黑", stack: '"Microsoft YaHei", "Microsoft YaHei UI", "Noto Sans SC", "PingFang SC", sans-serif' },
      { key: "pingfang", n: "苹方", stack: '"PingFang SC", "PingFang TC", -apple-system, "Noto Sans SC", sans-serif' },
    ],
    data: { font: "heiti" },
    load() {
      try { const s = localStorage.getItem(SETTINGS_KEY); if (s) Object.assign(this.data, JSON.parse(s)); } catch (e) {}
      this.apply();
    },
    save() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.data)); },
    apply() {
      const f = this.FONTS.find(f => f.key === this.data.font) || this.FONTS[0];
      document.documentElement.style.setProperty("--app-font", f.stack);
    },
    setFont(key) {
      this.data.font = key;
      this.save();
      this.apply();
      this.open();   // 原地刷新，让"当前选中"高亮立即跟上
    },
    open() {
      openOverlay(`<div class="result-card detail-card">
        <h1>⚙️ 设置</h1>
        <div class="mc-sect">🔤 字体</div>
        <div class="menu map-menu-free">
          ${this.FONTS.map(f => `<button class="menu-btn settings-font-btn ${f.key === this.data.font ? "active" : ""}" data-font="${f.key}" style="font-family:${f.stack}">
            <span>${f.n}<small>${f.key === this.data.font ? "当前使用" : "点击切换"}</small></span>
          </button>`).join("")}
        </div>
        <div class="btns"><button class="btn-ghost" id="settings-close">关闭</button></div>
      </div>`, { modal: true });
      $$(".settings-font-btn").forEach(b => b.onclick = () => this.setFont(b.dataset.font));
      $("#settings-close").onclick = () => closeOverlay();
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
    $$('[id^="btn-settings"]').forEach(b => b.onclick = () => Settings.open());
  }

  /* ============================================================
   *  初始化与事件绑定
   * ============================================================ */
  function init() {
    Settings.load();
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
      else if (go === "field") FieldBattle.open();
      else if (go === "fieldgrid") GridBattle.open();
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
    // 手机系统/浏览器返回键同步：非模态弹窗（如"两军阵前对比"，本就设计成点哪都能关）优先关闭
    // 弹窗（不消耗画面层级，随即补回一条历史记录）；模态弹窗（集市、战报等需要点具体按钮才能离开的）
    // 则不关——浏览器/iPad 的横向滑动手势（触控板双指滑动、iPad 边缘滑动）在用户想滚动/操作
    // 宽屏弹窗内容时很容易被系统误判成"返回上一页"，从而触发这同一个 popstate；modal:true 的弹窗
    // 若也被这个手势一并关掉，就是用户反映的"点着点着弹窗自己没了"——这里只吸收掉这次误判的返回
    // 动作（补回历史记录，不做任何界面变化），弹窗该怎么留就怎么留，逼用户走弹窗自己的按钮离开
    window.addEventListener("popstate", () => {
      if (overlay.classList.contains("show")) {
        if (!overlayModal) closeOverlay();
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
    $$(".side-tab[data-afside]").forEach(t => t.onclick = () => AllFacUI.setSide(t.dataset.afside));
    $("#allgen-search").oninput = () => AllGenUI.render();

    bindAudio();
    syncAudioBtns();
  }

  // 势力系统的推演调参需要能脱离 UI 直接跑上百天（逐日点「宿营」既慢又会被各种弹窗打断），
  // 故与 window.Skill / window.FieldBattle 同例，导出一个只读的自动化测试句柄
  window.__wj = { Campaign, FactionAI, FactionFame, FactionOrders, FactionGold, FactionTop5, Loyalty, PlayerRank, Garrison, Population, Prosper, Bond, RPG, MapUI, Buildings, BUILD_TYPES, cityBuildOptions, Estate, Armory, Rewards, DB, CITIES, FACTIONS, cityFactionId, factionCityCount, factionName, liveFactionIds, isRealFaction, adjCities, factionDef, isFactionLord, factionGenerals, FieldFX, GridBattle, ArmoryUI };

  document.addEventListener("DOMContentLoaded", init);
})();
