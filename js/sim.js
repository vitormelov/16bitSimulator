// EF 16-bit — simulador do shopping, um setor por vez (seletor no topo).
// Mapas: window.MALL_MAPS[setor] (gerados por tools/extract_dxf.py a partir do CAD). 1 tile = 10 cm.
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Fonte dos dados. Hoje é manual (campos do painel). Quando o contador de
  // pessoas estiver disponível, troque para mode: 'api' e aponte a url para um
  // endpoint que devolva JSON por setor, por exemplo:
  //   { "azul": { "clientes": 312, "lojistas": 190 }, "laranja": { "clientes": 280 } }
  // ou só { "clientes": 312, "lojistas": 190 } para o setor aberto.
  // Qualquer campo ausente mantém o valor atual.
  // ---------------------------------------------------------------------------
  const DATA_SOURCE = { mode: 'manual', url: null, intervalMs: 15000 };

  const MAX_CLIENTES = 3000;

  // --------------------------------------------------------------- setor ----
  const MAPS = window.MALL_MAPS;
  const SECTORS = Object.keys(MAPS);
  const SECTOR = (() => {
    const want = new URLSearchParams(location.search).get('setor');
    if (want && MAPS[want]) return want;
    try { const last = localStorage.getItem('mall8bit-setor'); if (MAPS[last]) return last; } catch (e) { /* ok */ }
    return SECTORS[0];
  })();
  try { localStorage.setItem('mall8bit-setor', SECTOR); } catch (e) { /* ok */ }
  const STORAGE_KEY = 'mall8bit-' + SECTOR;

  // ---------------------------------------------------------------- mapa ----
  const M = MAPS[SECTOR];
  const DEFAULTS = { lojistas: Math.round(M.boxes.length * 0.7), clientes: 250 }; // 70% dos boxes ocupados
  document.documentElement.style.setProperty('--setor', M.color.base);
  document.title = `EF 16-bit · Setor ${M.name}`;
  (function sectorTabs() {
    const nav = document.getElementById('sectorTabs');
    nav.innerHTML = '<span class="label">SETOR</span>';
    for (const id of SECTORS) {
      const a = document.createElement('a');
      const url = new URL(location.href);
      url.searchParams.set('setor', id);
      url.searchParams.delete('andar');
      a.href = url.pathname + url.search;
      a.textContent = MAPS[id].name.toUpperCase();
      a.style.setProperty('--c', MAPS[id].color.base);
      if (id === SECTOR) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    }
  })();
  const W = M.w, H = M.h;
  const RES = M.res;               // metros por tile
  const MPS = 1 / RES;             // tiles por metro

  function unrle(str, Type) {
    const out = new Type(W * H);
    let i = 0;
    for (const part of str.split(',')) {
      const k = part.indexOf(':');
      const v = +part.slice(0, k), n = +part.slice(k + 1);
      out.fill(v, i, i + n);
      i += n;
    }
    return out;
  }
  const tiles = unrle(M.tiles, Uint8Array);
  const boxAt = unrle(M.boxgrid, Int16Array).map((v) => v - 1); // -1 = sem box
  const boxes = M.boxes.map((b, i) => ({ ...b, idx: i, sellers: 0 }));

  // Piso andável -> índice compacto (para os campos de distância).
  const compact = new Int32Array(W * H).fill(-1);
  const cells = [];
  for (let i = 0; i < W * H; i++) if (tiles[i] === 1) { compact[i] = cells.length; cells.push(i); }
  const isWalk = (x, y) => x >= 0 && y >= 0 && x < W && y < H && compact[y * W + x] >= 0;

  function nearestWalk(x, y, maxR = 60) {
    for (let r = 0; r <= maxR; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (isWalk(x + dx, y + dy)) return [x + dx, y + dy];
        }
    return null;
  }

  // Campos de distância (BFS) calculados sob demanda e guardados.
  const N = cells.length;
  function bfs(seedCells) {
    const d = new Uint16Array(N).fill(65535);
    const q = new Int32Array(N);
    let h = 0, t = 0;
    for (const c of seedCells) { const k = compact[c]; if (k >= 0 && d[k]) { d[k] = 0; q[t++] = k; } }
    while (h < t) {
      const k = q[h++], c = cells[k], x = c % W, nd = d[k] + 1;
      if (x > 0) { const kk = compact[c - 1]; if (kk >= 0 && d[kk] > nd) { d[kk] = nd; q[t++] = kk; } }
      if (x < W - 1) { const kk = compact[c + 1]; if (kk >= 0 && d[kk] > nd) { d[kk] = nd; q[t++] = kk; } }
      if (c >= W) { const kk = compact[c - W]; if (kk >= 0 && d[kk] > nd) { d[kk] = nd; q[t++] = kk; } }
      if (c < W * (H - 1)) { const kk = compact[c + W]; if (kk >= 0 && d[kk] > nd) { d[kk] = nd; q[t++] = kk; } }
    }
    return d;
  }

  // Destinos: pontos do corredor em frente aos boxes (clientes "olhando vitrine").
  const targets = [];
  (function buildTargets() {
    const B = 22; // ~2,2 m entre destinos
    const REACH = 6; // até 60 cm do box
    const buckets = new Map();
    for (const c of cells) {
      const x = c % W, y = (c / W) | 0;
      let near = -1;
      for (let r = 1; r <= REACH && near < 0; r++) {
        for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && boxAt[yy * W + xx] >= 0) { near = boxAt[yy * W + xx]; break; }
        }
      }
      if (near < 0) continue;
      const key = ((x / B) | 0) + ',' + ((y / B) | 0);
      const arr = buckets.get(key) || [];
      arr.push([x, y, near]);
      buckets.set(key, arr);
    }
    for (const arr of buckets.values()) {
      const [x, y, box] = arr[(Math.random() * arr.length) | 0];
      targets.push({ x, y, box, field: null });
    }
  })();

  const entrances = M.entrances.map((e) => {
    const p = nearestWalk(e.x, e.y) || [cells[0] % W, (cells[0] / W) | 0];
    return { name: e.name, x: p[0], y: p[1], w: e.w || 1, field: null };
  });
  const entranceWeight = entrances.reduce((s, e) => s + e.w, 0);

  function fieldOf(t) {
    if (!t.field) {
      const seeds = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) seeds.push((t.y + dy) * W + (t.x + dx));
      t.field = bfs(seeds);
    }
    return t.field;
  }

  // ------------------------------------------------------------ pintura -----
  // O cenário é desenhado com 2 px de arte por tile (1 px = 5 cm), no estilo 16-bit.
  const ART = Sprites.SCALE;
  const AW = W * ART, AH = H * ART;
  const layer = document.createElement('canvas');
  layer.width = AW; layer.height = AH;
  const lctx = layer.getContext('2d');

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const shade = (c, f) => c.map((v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f))));
  const C = {
    out: hex('#2a2636'), out2: hex('#332e42'),
    floor: hex('#efe7d6'), grout: hex('#dcd1bb'), floorHi: hex('#f7f1e4'),
    wall: hex('#4a4550'), wallTop: hex('#6a6474'), wallFace: hex('#9690a3'), wallFaceDark: hex('#6e687a'),
    fine: hex('#a39db0'),
    room: hex('#5f5a6c'), room2: hex('#686376'),
    wood: hex('#dcc39a'), woodSeam: hex('#c4a67a'),
    part: hex('#d9dee7'), partDark: hex('#aeb6c4'),
    fascia: hex(M.color.base), fasciaHi: hex(M.color.hi), fasciaLo: hex(M.color.lo), sign: hex('#f4f1ea'),
    shut: hex('#a3acb8'), shut2: hex('#8a94a1'), shutLine: hex('#6c7684'),
    rail: hex('#4a4550'), counter: hex('#a8744a'), counterTop: hex('#d9a878'),
    outline: hex('#2b2433'),
  };
  const CLOTHES = ['#3d5a8c', '#6fa5d9', '#d9805a', '#ef9aae', '#f2b84b', '#a6bf6b', '#e89449', '#f4f1ea', '#4a4550', '#8c5fb0', '#6b4a4a'].map(hex);
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; };

  function paint() {
    const img = lctx.createImageData(AW, AH);
    const px = img.data;
    const put = (ax, ay, c) => { if (ax < 0 || ay < 0 || ax >= AW || ay >= AH) return; const o = (ay * AW + ax) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255; };
    const get = (ax, ay) => { const o = (ay * AW + ax) * 4; return [px[o], px[o + 1], px[o + 2]]; };
    const tileAt = (ax, ay) => (ax < 0 || ay < 0 || ax >= AW || ay >= AH ? 0 : tiles[((ay / ART) | 0) * W + ((ax / ART) | 0)]);
    const boxOf = (ax, ay) => (ax < 0 || ay < 0 || ax >= AW || ay >= AH ? -1 : boxAt[((ay / ART) | 0) * W + ((ax / ART) | 0)]);

    // 1. base de cada tipo de tile
    for (let ay = 0; ay < AH; ay++) {
      for (let ax = 0; ax < AW; ax++) {
        const t = tileAt(ax, ay);
        let c;
        if (t === 1) {
          // porcelanato 60x60 cm (12 px), cada peça com tom levemente diferente
          const lx = ax % 12, ly = ay % 12;
          if (lx === 0 || ly === 0) c = C.grout;
          else if (lx === 1 || ly === 1) c = C.floorHi;
          else {
            const hv = hash((ax / 12) | 0, (ay / 12) | 0);
            c = shade(C.floor, -((hv % 4) * 0.008));
            if (hash(ax, ay) % 29 === 0) c = shade(c, -0.04);
          }
        } else if (t === 2) {
          c = tileAt(ax, ay - 1) !== 2 ? C.wallTop : C.wall;
        } else if (t === 3) {
          c = C.fine;
        } else if (t === 4) {
          c = (ax + ay) % 6 === 0 ? C.room2 : C.room;
        } else if (t === 6) {
          c = C.wood;
        } else {
          c = ax % 8 === 0 && ay % 8 === 4 ? C.out2 : C.out;
        }
        put(ax, ay, c);
      }
    }

    // 2. boxes como pequenas lojas
    for (const b of boxes) paintBox(b, put, boxOf);

    // 3. face frontal das paredes (profundidade) e sombra no piso logo abaixo
    for (let ay = AH - 1; ay >= 1; ay--) {
      for (let ax = 0; ax < AW; ax++) {
        const t = tileAt(ax, ay);
        if (t !== 1) continue;
        const above = tileAt(ax, ay - 1);
        if (above === 2 || above === 3 || above === 4) {
          // faixa de parede vista de frente (3 px) + sombra suave (4 px)
          for (let k = 0; k < 7; k++) {
            if (tileAt(ax, ay + k) !== 1) break;
            if (k < 3) put(ax, ay + k, k === 2 ? C.wallFaceDark : C.wallFace);
            else put(ax, ay + k, shade(get(ax, ay + k), -0.1 + (k - 3) * 0.025));
          }
        } else if (above === 6) {
          for (let k = 0; k < 4; k++) {
            if (tileAt(ax, ay + k) !== 1) break;
            put(ax, ay + k, shade(get(ax, ay + k), -0.12 + k * 0.03));
          }
        }
      }
    }

    // 4. objetos do CAD: escadas rolantes e pilares
    for (const o of M.objects || []) {
      if (o.kind === 'escalator') paintEscalator(o, put);
      else if (o.kind === 'pillar') paintPillar(o, put);
    }
    lctx.putImageData(img, 0, 0);
  }

  function paintBox(b, put, boxOf) {
    const open = b.sellers > 0;
    const face = b.face != null ? b.face : (b.face = facingOut(b)); // lado virado para o corredor
    let seed = b.idx * 9301 + 49297;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const x0 = b.x * ART, y0 = b.y * ART, x1 = (b.x + b.w) * ART - 1, y1 = (b.y + b.h) * ART - 1;
    const inBox = (ax, ay) => boxOf(ax, ay) === b.idx;
    // distância (em px) até a borda do box em cada direção, limitada
    const edge = (ax, ay, dx, dy) => { for (let k = 1; k <= 4; k++) if (!inBox(ax + dx * k, ay + dy * k)) return k - 1; return 4; };
    const FRONT = [[0, 1], [-1, 0], [1, 0], [0, -1]][face];

    for (let ay = y0; ay <= y1; ay++) {
      for (let ax = x0; ax <= x1; ax++) {
        if (!inBox(ax, ay)) continue;
        const dF = edge(ax, ay, FRONT[0], FRONT[1]);
        const dMin = Math.min(edge(ax, ay, 1, 0), edge(ax, ay, -1, 0), edge(ax, ay, 0, 1), edge(ax, ay, 0, -1));
        let c;
        if (dF <= 3) {
          // fachada na cor do setor, do lado do corredor, com um letreiro claro no meio
          c = dF === 0 ? C.fasciaLo : dF === 3 ? C.fasciaHi : C.fascia;
          const along = face === 0 || face === 3 ? ax : ay;
          const a0 = face === 0 || face === 3 ? x0 : y0, a1 = face === 0 || face === 3 ? x1 : y1;
          const third = (a1 - a0) / 3;
          if ((dF === 1 || dF === 2) && along > a0 + third && along < a1 - third && (along + dF) % 2 === 0) c = C.sign;
          if (!open) c = shade(c, -0.3);
        } else if (dMin <= 0) {
          c = dMin === 0 ? C.partDark : C.part; // divisórias
        } else if (!open) {
          // porta de enrolar
          const along = face === 0 || face === 3 ? ay : ax;
          c = along % 4 === 0 ? C.shutLine : along % 4 < 2 ? C.shut : C.shut2;
        } else {
          const along = face === 0 || face === 3 ? ax : ay;
          c = along % 6 === 0 ? C.woodSeam : shade(C.wood, (hash(Math.floor(along / 6), b.idx) % 3) * -0.02);
        }
        put(ax, ay, c);
      }
    }
    if (!open) return;

    // arara de roupas encostada na parede do fundo (oposta à fachada)
    const back = 3 - face; // direção oposta (0<->3, 1<->2)
    const [bx, by] = [[0, 1], [-1, 0], [1, 0], [0, -1]][back];
    const vertical = face === 0 || face === 3; // roupas penduradas na vertical
    if (vertical) {
      const railY = by < 0 ? y0 + 3 : y1 - 9;
      for (let ax = x0 + 3; ax <= x1 - 3; ax++) if (inBox(ax, railY)) put(ax, railY, C.rail);
      for (let ax = x0 + 4; ax <= x1 - 5; ax += 3) {
        const col = CLOTHES[(rnd() * CLOTHES.length) | 0];
        for (let k = 1; k <= 6; k++) {
          if (!inBox(ax, railY + k) || !inBox(ax + 1, railY + k)) break;
          put(ax, railY + k, k === 1 ? shade(col, -0.3) : shade(col, 0.12));
          put(ax + 1, railY + k, k === 1 ? shade(col, -0.3) : shade(col, -0.15));
        }
      }
    } else {
      const railX = bx < 0 ? x0 + 3 : x1 - 3;
      const dir = bx < 0 ? 1 : -1;
      for (let ay = y0 + 3; ay <= y1 - 3; ay++) if (inBox(railX, ay)) put(railX, ay, C.rail);
      for (let ay = y0 + 4; ay <= y1 - 5; ay += 3) {
        const col = CLOTHES[(rnd() * CLOTHES.length) | 0];
        for (let k = 1; k <= 6; k++) {
          const ax = railX + dir * k;
          if (!inBox(ax, ay) || !inBox(ax, ay + 1)) break;
          put(ax, ay, k === 1 ? shade(col, -0.3) : shade(col, 0.12));
          put(ax, ay + 1, k === 1 ? shade(col, -0.3) : shade(col, -0.15));
        }
      }
    }
    // balcão pequeno num canto perto da fachada
    const cw = 6, ch = 4;
    let cx, cy;
    if (face === 0) { cx = x1 - 3 - cw; cy = y1 - 3 - ch; }
    else if (face === 3) { cx = x1 - 3 - cw; cy = y0 + 4; }
    else if (face === 1) { cx = x0 + 4; cy = y1 - 3 - ch; }
    else { cx = x1 - 3 - cw; cy = y1 - 3 - ch; }
    for (let ay = cy; ay < cy + ch; ay++)
      for (let ax = cx; ax < cx + cw; ax++)
        if (inBox(ax, ay)) put(ax, ay, ay === cy ? C.counterTop : ay === cy + ch - 1 ? shade(C.counter, -0.25) : C.counter);
  }

  function paintEscalator(o, put) {
    const x0 = o.x * ART, y0 = o.y * ART, x1 = (o.x + o.w) * ART - 1, y1 = (o.y + o.h) * ART - 1;
    const horiz = o.w >= o.h;
    const metal = hex('#b9c1cc'), metalDark = hex('#8791a0'), step = hex('#3b3a45'), stepLine = hex('#55545f');
    const rail = hex('#22202a'), glass = hex('#9fc6e0'), yellow = hex('#f2b84b');
    const across0 = horiz ? y0 : x0, across1 = horiz ? y1 : x1;
    const len0 = horiz ? x0 : y0, len1 = horiz ? x1 : y1;
    const mid = (across0 + across1) >> 1;
    for (let a = across0; a <= across1; a++) {
      for (let l = len0; l <= len1; l++) {
        const ax = horiz ? l : a, ay = horiz ? a : l;
        const da = Math.min(a - across0, across1 - a, Math.abs(a - mid));
        const dl = Math.min(l - len0, len1 - l);
        let c;
        if (a === across0 || a === across1 || l === len0 || l === len1) c = C.outline;
        else if (Math.abs(a - mid) <= 1) c = Math.abs(a - mid) === 0 ? metalDark : metal; // divisória central
        else if (da <= 2) c = da === 2 ? rail : glass;                                    // corrimão e vidro
        else if (dl <= 5) c = dl <= 1 ? metalDark : metal;                                // pentes nas pontas
        else c = (l - len0) % 4 === 0 ? stepLine : (dl === 6 ? yellow : step);            // degraus
        put(ax, ay, c);
      }
    }
  }

  function paintPillar(o, put) {
    const x0 = o.x * ART, y0 = o.y * ART, x1 = (o.x + o.w) * ART - 1, y1 = (o.y + o.h) * ART - 1;
    const top = hex('#8e8898'), hi = hex('#aaa4b4'), face = hex('#6e687a');
    for (let ay = y0; ay <= y1 + 4; ay++)
      for (let ax = x0; ax <= x1; ax++) {
        let c;
        if (ax === x0 || ax === x1 || ay === y0 || ay === y1 + 4) c = C.outline;
        else if (ay > y1) c = face;
        else c = ay === y0 + 1 ? hi : top;
        put(ax, ay, c);
      }
  }

  // ------------------------------------------------------------ pessoas -----
  const DIRS = [[0, 1], [-1, 0], [1, 0], [0, -1]];
  const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const clients = [];
  const sellers = [];
  let spawnQueue = 0;

  function faceBox(a) {
    const cx = a.x | 0, cy = a.y | 0;
    let best = a.dir, bestR = 1e9;
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d];
      for (let r = 1; r <= 15; r++) {
        const xx = cx + dx * r, yy = cy + dy * r;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) break;
        if (boxAt[yy * W + xx] >= 0) { if (r < bestR) { bestR = r; best = d; } break; }
        if (tiles[yy * W + xx] !== 1) break;
      }
    }
    return best;
  }

  function chooseTarget() {
    // Clientes preferem boxes abertos.
    for (let tries = 0; tries < 6; tries++) {
      const t = targets[(Math.random() * targets.length) | 0];
      if (boxes[t.box].sellers > 0 || Math.random() < 0.15) return t;
    }
    return targets[(Math.random() * targets.length) | 0];
  }

  function newClient(x, y, entering) {
    const a = {
      x: x + 0.5, y: y + 0.5,
      look: Sprites.shopper(), dir: 0, frame: 1, anim: Math.random(),
      speed: (1.0 + Math.random() * 0.5) * MPS, // 1,0–1,5 m/s
      state: 'walk', leaving: false, target: chooseTarget(), next: null, wait: 0,
      arriveR: 3 + ((Math.random() * 10) | 0),
    };
    if (!entering && Math.random() < 0.5) { a.state = 'browse'; a.wait = Math.random() * 8; a.dir = faceBox(a); }
    clients.push(a);
    return a;
  }

  function spawnAtEntrance() {
    let r = Math.random() * entranceWeight, e = entrances[0];
    for (const en of entrances) { r -= en.w; if (r <= 0) { e = en; break; } }
    newClient(e.x, e.y, true);
  }

  function stepClient(a, dt) {
    if (a.state === 'browse') {
      a.wait -= dt;
      a.frame = 1;
      if (a.wait <= 0) { a.state = 'walk'; if (!a.leaving) a.target = chooseTarget(); a.next = null; }
      return true;
    }
    let moveLeft = a.speed * dt;
    while (moveLeft > 0) {
      if (!a.next) {
        const f = fieldOf(a.target);
        const cx = a.x | 0, cy = a.y | 0;
        const k = compact[cy * W + cx];
        if (k < 0) { const p = nearestWalk(cx, cy); if (p) { a.x = p[0] + 0.5; a.y = p[1] + 0.5; } return true; }
        const dHere = f[k];
        if (dHere <= (a.leaving ? 2 : a.arriveR)) {
          if (a.leaving) return false; // saiu do setor
          a.state = 'browse';
          a.wait = 2 + Math.random() * 10;
          a.dir = faceBox(a);
          a.frame = 1;
          return true;
        }
        // vizinho que aproxima do destino; um pouco de aleatoriedade espalha as filas
        let best = null, bestD = dHere, alt = [];
        for (const [dx, dy] of NB8) {
          const nx = cx + dx, ny = cy + dy;
          if (!isWalk(nx, ny)) continue;
          if (dx && dy && (!isWalk(cx + dx, cy) || !isWalk(cx, cy + dy))) continue;
          const d = f[compact[ny * W + nx]] + (dx && dy ? 0.5 : 0);
          if (d < dHere) { alt.push([nx, ny]); if (d < bestD) { bestD = d; best = [nx, ny]; } }
        }
        if (!best) { if (!a.leaving) a.target = chooseTarget(); return true; }
        a.next = Math.random() < 0.75 ? best : alt[(Math.random() * alt.length) | 0];
      }
      const tx = a.next[0] + 0.5, ty = a.next[1] + 0.5;
      const dx = tx - a.x, dy = ty - a.y;
      const dist = Math.hypot(dx, dy);
      if (Math.abs(dx) > Math.abs(dy)) a.dir = dx < 0 ? 1 : 2; else if (dist > 0) a.dir = dy < 0 ? 3 : 0;
      if (dist <= moveLeft) { a.x = tx; a.y = ty; a.next = null; moveLeft -= dist; }
      else { a.x += dx / dist * moveLeft; a.y += dy / dist * moveLeft; moveLeft = 0; }
    }
    a.anim += dt;
    if (a.anim > 0.14) { a.anim = 0; a.frame = (a.frame + 1) & 3; }
    return true;
  }

  function nearestEntrance(c) {
    return entrances.reduce((best, e) => (Math.hypot(e.x - c.x, e.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y) ? e : best));
  }

  function setClientes(n) {
    n = Math.max(0, Math.min(MAX_CLIENTES, n | 0));
    const active = clients.filter((c) => !c.leaving).length + spawnQueue;
    if (n > active) {
      let need = n - active;
      for (const c of clients) {
        if (!need) break;
        if (c.leaving) { c.leaving = false; c.state = 'walk'; c.target = chooseTarget(); c.next = null; need--; }
      }
      spawnQueue += need;
    } else if (n < active) {
      let extra = active - n;
      const q = Math.min(spawnQueue, extra);
      spawnQueue -= q; extra -= q;
      const staying = clients.filter((c) => !c.leaving);
      for (let i = staying.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [staying[i], staying[j]] = [staying[j], staying[i]]; }
      for (const c of staying.slice(0, extra)) {
        c.leaving = true;
        c.target = nearestEntrance(c);
        if (c.state === 'browse') c.wait = Math.min(c.wait, Math.random() * 2);
        c.next = null;
      }
    }
  }

  // Lojistas: ordem fixa de ocupação (mudar o número mantém quem já está).
  const order = boxes.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
  let lojistas = 0;

  function facingOut(b) {
    const cx = Math.round(b.cx), cy = Math.round(b.cy);
    let bestD = 0, bestDist = 1e9;
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d];
      for (let r = 1; r < 40; r++) {
        if (isWalk(cx + dx * r, cy + dy * r)) { if (r < bestDist) { bestDist = r; bestD = d; } break; }
      }
    }
    return bestD;
  }

  function setLojistas(n) {
    n = Math.max(0, Math.min(order.length * 2, n | 0));
    lojistas = n;
    order.forEach((b, i) => { b.sellers = (i < n ? 1 : 0) + (i < n - order.length ? 1 : 0); });
    sellers.length = 0;
    for (const b of order) {
      const face = facingOut(b);
      for (let k = 0; k < b.sellers; k++) {
        const off = b.sellers === 2 ? (k ? 4 : -4) : 0;
        const horiz = b.w >= b.h;
        sellers.push({
          box: b,
          x: b.cx + (horiz ? off : 0) + 0.5,
          y: Math.min(b.cy + (horiz ? 0 : off) + 7.5, b.y + b.h - 2.5), // de pé dentro do box, sem passar da borda
          look: Sprites.seller(), face, dir: face, frame: 1, timer: 1 + Math.random() * 5, shift: 0,
        });
      }
    }
    repaintSoon();
  }

  function stepSeller(s, dt) {
    s.timer -= dt;
    if (s.timer <= 0) {
      s.timer = 1.5 + Math.random() * 5;
      const r = Math.random();
      s.dir = r < 0.6 ? s.face : r < 0.8 ? 1 : 2;
      s.shift = Math.random() < 0.3 ? ((Math.random() * 3) | 0) - 1 : 0;
    }
  }

  let repaintPending = false;
  function repaintSoon() {
    if (repaintPending) return;
    repaintPending = true;
    requestAnimationFrame(() => { repaintPending = false; paint(); if (fps) fps.build(); updateStats(); });
  }

  // ------------------------------------------------------- boneco (você) ----
  // fp = visão em 1ª pessoa (js/fps.js); ang = direção do olhar em radianos (0 = direita do mapa)
  const player = { active: false, fp: false, ang: 0, walkT: 0, x: 0, y: 0, dir: 0, frame: 1, anim: 0, look: Sprites.player() };
  const keys = new Set(); // códigos de tecla (KeyW, ArrowUp...) e botões do direcional (up, down, left, right)
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  const any = (...k) => k.some((c) => keys.has(c));
  const canStand = (x, y) => isWalk(Math.floor(x - 1.5), Math.floor(y)) && isWalk(Math.floor(x + 1.5), Math.floor(y)) &&
    isWalk(Math.floor(x), Math.floor(y - 1)) && isWalk(Math.floor(x), Math.floor(y + 0.9));
  const ANG_OF_DIR = [Math.PI / 2, Math.PI, 0, -Math.PI / 2];

  function stepPlayer(dt) {
    let vx = 0, vy = 0;
    if (player.fp) {
      // 1ª pessoa: W/S anda, A/D anda de lado, setas ←/→ (ou Q/E, ou mouse) giram
      const turn = (any('ArrowRight', 'KeyE', 'right') ? 1 : 0) - (any('ArrowLeft', 'KeyQ', 'left') ? 1 : 0);
      player.ang += turn * 2.2 * dt;
      const fw = (any('KeyW', 'ArrowUp', 'up') ? 1 : 0) - (any('KeyS', 'ArrowDown', 'down') ? 1 : 0);
      const st = (any('KeyD') ? 1 : 0) - (any('KeyA') ? 1 : 0);
      const c = Math.cos(player.ang), s = Math.sin(player.ang);
      vx = c * fw - s * st; vy = s * fw + c * st;
      // direção "de mapa" mais próxima, para a visão de cima
      const a = ((player.ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      player.dir = a < Math.PI / 4 || a >= 7 * Math.PI / 4 ? 2 : a < 3 * Math.PI / 4 ? 0 : a < 5 * Math.PI / 4 ? 1 : 3;
    } else {
      if (any('KeyA', 'ArrowLeft', 'left')) vx -= 1;
      if (any('KeyD', 'ArrowRight', 'right')) vx += 1;
      if (any('KeyW', 'ArrowUp', 'up')) vy -= 1;
      if (any('KeyS', 'ArrowDown', 'down')) vy += 1;
    }
    if (!vx && !vy) { player.frame = 1; return; }
    const len = Math.hypot(vx, vy);
    const speed = (keys.has('run') ? 3 : 1.4) * MPS;
    const sx = vx / len * speed * dt, sy = vy / len * speed * dt;
    player.walkT += dt * (keys.has('run') ? 1.6 : 1);
    // eixos separados: desliza encostado nas paredes
    const steps = Math.ceil(Math.max(Math.abs(sx), Math.abs(sy)) / 0.5);
    for (let i = 0; i < steps; i++) {
      if (canStand(player.x + sx / steps, player.y)) player.x += sx / steps;
      if (canStand(player.x, player.y + sy / steps)) player.y += sy / steps;
    }
    if (!player.fp) { if (Math.abs(vx) > Math.abs(vy)) player.dir = vx < 0 ? 1 : 2; else player.dir = vy < 0 ? 3 : 0; }
    player.anim += dt;
    if (player.anim > 0.12) { player.anim = 0; player.frame = (player.frame + 1) & 3; }
  }

  const exploreHud = document.getElementById('exploreHud');
  const nearInfo = document.getElementById('nearInfo');
  const dpad = document.getElementById('dpad');
  const btnPlay = document.getElementById('btnPlay');
  let nearLast = '';

  function setExplore(on) {
    player.active = on;
    keys.clear();
    exploreHud.hidden = !on;
    dpad.hidden = !on || !matchMedia('(pointer: coarse)').matches;
    btnPlay.textContent = on ? 'SAIR DO MODO ANDAR' : 'ANDAR PELO SHOPPING';
    btnPlay.classList.toggle('on', on);
    if (on) {
      if (!player.placed) {
        const e = entrances[0];
        player.x = e.x + 0.5; player.y = e.y + 0.5; player.placed = true;
        // começa olhando para o lado mais aberto do corredor
        let best = 0, bestRun = -1;
        for (let d = 0; d < 4; d++) {
          let r = 0;
          while (r < 200 && isWalk(Math.floor(player.x + DIRS[d][0] * r), Math.floor(player.y + DIRS[d][1] * r))) r++;
          if (r > bestRun) { bestRun = r; best = d; }
        }
        player.dir = best;
      }
      cam.z = Math.max(cam.z, 4);
      follow(1);
      view.focus();
    } else {
      setFirstPerson(false);
      fit();
    }
    updateViewUi();
  }

  // ---------------------------------------------------- 1ª pessoa (Doom) ----
  let fps = null;
  const fpsWorld = () => fps || (fps = FPS.create({ W, H, tiles, boxAt, boxes, objects: M.objects, color: M.color, facingOut }));
  const btnView = document.getElementById('btnView');
  const keysHint = document.getElementById('keysHint');

  function setFirstPerson(on) {
    if (on && !player.active) setExplore(true);
    player.fp = on;
    if (on) { player.ang = ANG_OF_DIR[player.dir]; fpsWorld(); view.focus(); }
    else if (document.pointerLockElement === view) document.exitPointerLock();
    keys.clear();
    updateViewUi();
  }
  function updateViewUi() {
    btnView.textContent = player.fp ? 'VISÃO DE CIMA (V)' : 'VISÃO 1ª PESSOA (V)';
    keysHint.textContent = player.fp
      ? 'W/S andar · A/D de lado · ←/→ ou mouse girar · SHIFT correr · ESC sair'
      : 'WASD / SETAS andar · SHIFT correr · V 1ª pessoa · ESC sair';
    stage.classList.toggle('fp', player.fp);
  }
  btnView.addEventListener('click', () => setFirstPerson(!player.fp));

  // olhar com o mouse (clique na tela trava o cursor; ESC solta) — ligado no início, depois da câmera
  function bindMouseLook() {
    view.addEventListener('click', () => {
      if (player.fp && document.pointerLockElement !== view && view.requestPointerLock) view.requestPointerLock();
    });
    document.addEventListener('mousemove', (e) => {
      if (player.fp && document.pointerLockElement === view) player.ang += e.movementX * 0.0028;
    });
  }

  function updateNear() {
    // box mais próximo do boneco (até 1,5 m)
    const px = player.x | 0, py = player.y | 0, R = 15;
    let best = -1, bestD = 1e9;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const x = px + dx, y = py + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const b = boxAt[y * W + x];
        if (b >= 0) { const d = dx * dx + dy * dy; if (d < bestD) { bestD = d; best = b; } }
      }
    let around = 0;
    for (const c of clients) if (!c.leaving && (c.x - player.x) ** 2 + (c.y - player.y) ** 2 < (5 * MPS) ** 2) around++;
    let html;
    if (best >= 0) {
      const b = boxes[best];
      const st = b.sellers ? `<span class="open">ABERTO · ${b.sellers} LOJISTA${b.sellers > 1 ? 'S' : ''}</span>` : '<span class="closed">FECHADO</span>';
      html = `<b>BOX ${b.num}</b> · CORREDOR ${b.corr} · ${fmtM2(b.area)}<br>${st}`;
    } else {
      html = 'Ande até um box para ver os detalhes';
    }
    html += `<br>${around} cliente${around === 1 ? '' : 's'} num raio de 5 m`;
    if (html !== nearLast) { nearLast = html; nearInfo.innerHTML = html; }
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Escape' && player.active) { setExplore(false); return; }
    if (e.code === 'KeyV') { setFirstPerson(!player.fp); e.preventDefault(); return; }
    if (e.key === 'Shift') { keys.add('run'); return; }
    if (!MOVE_KEYS.has(e.code)) return;
    if (!player.active) setExplore(true);
    keys.add(e.code);
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.key === 'Shift') keys.delete('run');
  });
  window.addEventListener('blur', () => keys.clear());
  dpad.querySelectorAll('button').forEach((b) => {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); keys.add(k); b.setPointerCapture(e.pointerId); });
    b.addEventListener('pointerup', () => keys.delete(k));
    b.addEventListener('pointercancel', () => keys.delete(k));
  });

  // ------------------------------------------------------------- câmera -----
  const stage = document.getElementById('stage');
  const view = document.getElementById('view');
  view.tabIndex = 0;
  const ctx = view.getContext('2d');
  const cam = { z: 1, x: 0, y: 0, fitZ: 1 };
  let dpr = 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    view.width = Math.round(stage.clientWidth * dpr);
    view.height = Math.round(stage.clientHeight * dpr);
  }
  function fit() {
    const cw = stage.clientWidth, ch = stage.clientHeight;
    cam.fitZ = Math.min(cw / W, ch / H) * 0.96;
    cam.z = cam.fitZ;
    cam.x = (cw - W * cam.z) / 2;
    cam.y = (ch - H * cam.z) / 2;
  }
  function follow(k) {
    const tx = stage.clientWidth / 2 - player.x * cam.z;
    const ty = stage.clientHeight / 2 - player.y * cam.z;
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
  }
  function zoomAt(f, sx, sy) {
    const nz = Math.max(cam.fitZ * 0.7, Math.min(20, cam.z * f));
    cam.x = sx - (sx - cam.x) * (nz / cam.z);
    cam.y = sy - (sy - cam.y) * (nz / cam.z);
    cam.z = nz;
  }

  let drag = null;
  view.addEventListener('pointerdown', (e) => {
    if (player.active) return;
    drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
    view.setPointerCapture(e.pointerId);
    view.classList.add('dragging');
  });
  view.addEventListener('pointerup', () => { drag = null; view.classList.remove('dragging'); });
  view.addEventListener('pointermove', (e) => {
    const r = view.getBoundingClientRect();
    if (drag) { cam.x = drag.cx + e.clientX - drag.x; cam.y = drag.cy + e.clientY - drag.y; }
    if (player.fp) { tip.hidden = true; return; }
    showTip(e.clientX - r.left, e.clientY - r.top);
  });
  view.addEventListener('pointerleave', () => { tip.hidden = true; });
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = view.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  const fmtM2 = (a) => a.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' m²';
  const tip = document.getElementById('tip');
  function showTip(sx, sy) {
    const tx = Math.floor((sx - cam.x) / cam.z), ty = Math.floor((sy - cam.y) / cam.z);
    const bi = tx >= 0 && ty >= 0 && tx < W && ty < H ? boxAt[ty * W + tx] : -1;
    if (bi < 0) { tip.hidden = true; return; }
    const b = boxes[bi];
    const st = b.sellers ? `ABERTO · ${b.sellers} LOJISTA${b.sellers > 1 ? 'S' : ''}` : 'FECHADO';
    tip.innerHTML = `BOX ${b.num} · CORREDOR ${b.corr}<br>${fmtM2(b.area)}<br>${st}`;
    tip.hidden = false;
    const x = Math.min(sx + 14, stage.clientWidth - tip.offsetWidth - 8);
    tip.style.left = x + 'px';
    tip.style.top = Math.max(8, sy - tip.offsetHeight - 10) + 'px';
  }

  // --------------------------------------------------------------- loop -----
  let paused = false, speedMul = 1, last = performance.now(), clock = 0;
  function frame(now) {
    const realDt = Math.min(0.1, (now - last) / 1000);
    const dt = realDt * speedMul;
    last = now;
    clock += realDt;
    if (!paused) {
      if (spawnQueue > 0) {
        const rate = Math.max(4, spawnQueue / 5); // pessoas por segundo
        let k = Math.floor(rate * dt + Math.random());
        k = Math.min(spawnQueue, k);
        for (let i = 0; i < k; i++) spawnAtEntrance();
        spawnQueue -= k;
      }
      for (let i = clients.length - 1; i >= 0; i--) if (!stepClient(clients[i], dt)) clients.splice(i, 1);
      for (const s of sellers) stepSeller(s, dt);
    }
    if (player.active) {
      stepPlayer(realDt);
      follow(Math.min(1, realDt * 8));
      updateNear();
    }
    draw();
    requestAnimationFrame(frame);
  }

  const drawList = [];
  function draw() {
    if (player.active && player.fp) { drawFirstPerson(); updateHud(); return; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#14131f';
    ctx.fillRect(0, 0, view.width, view.height);
    // afastado (1 px de arte menor que 1 px de tela) suaviza para não "piscar"; aproximado fica nítido
    ctx.imageSmoothingEnabled = cam.z * dpr < ART;
    ctx.setTransform(cam.z * dpr, 0, 0, cam.z * dpr, cam.x * dpr, cam.y * dpr);
    ctx.drawImage(layer, 0, 0, W, H);

    // pessoas: desenhadas em pixels de arte (1/ART de tile), com os pés no ponto (x, y)
    ctx.setTransform(cam.z * dpr / ART, 0, 0, cam.z * dpr / ART, cam.x * dpr, cam.y * dpr);
    drawList.length = 0;
    for (const s of sellers) drawList.push(s);
    for (const c of clients) drawList.push(c);
    const showPlayer = player.active || player.placed;
    if (showPlayer) drawList.push(player);
    drawList.sort((a, b) => a.y - b.y);
    for (const p of drawList) ctx.drawImage(Sprites.shadow, Math.round(p.x * ART) - 7 + (p.shift || 0), Math.round(p.y * ART) - 3);
    if (showPlayer) {
      // anel verde no chão sob o boneco
      const fx = Math.round(player.x * ART), fy = Math.round(player.y * ART);
      ctx.fillStyle = 'rgba(124, 245, 176, .9)';
      ctx.fillRect(fx - 5, fy - 3, 11, 1); ctx.fillRect(fx - 5, fy + 2, 11, 1);
      ctx.fillRect(fx - 7, fy - 2, 2, 4); ctx.fillRect(fx + 6, fy - 2, 2, 4);
    }
    for (const p of drawList) {
      const img = p.look.frames[p.dir][p.frame];
      ctx.drawImage(img, Math.round(p.x * ART) - (Sprites.W >> 1) + (p.shift || 0), Math.round(p.y * ART) - Sprites.FOOT);
    }
    if (showPlayer) {
      // marcador "você" balançando acima da cabeça
      const bob = Math.round(Math.sin(clock * 6) * 1.5);
      const mx = Math.round(player.x * ART), my = Math.round(player.y * ART) - Sprites.FOOT - 9 + bob;
      ctx.fillStyle = '#2b2433';
      ctx.fillRect(mx - 5, my - 1, 11, 1); ctx.fillRect(mx - 5, my - 1, 1, 3); ctx.fillRect(mx + 5, my - 1, 1, 3);
      ctx.fillStyle = '#7cf5b0';
      ctx.fillRect(mx - 4, my, 9, 2); ctx.fillRect(mx - 3, my + 2, 7, 1); ctx.fillRect(mx - 2, my + 3, 5, 1); ctx.fillRect(mx - 1, my + 4, 3, 1); ctx.fillRect(mx, my + 5, 1, 1);
    }
    updateHud();
  }

  // mão segurando uma sacola, estilo "arma" do Doom (pixel art gerada em código)
  const handArt = (() => {
    const rows = [
      '..........kkkkkk........',
      '.........k......k.......',
      '........k........k......',
      '.......k..........k.....',
      '....bbbbbbbbbbbbbbbbbb..',
      '....bBBBBBBBBBBBBBBBBb..',
      '....bBBBBBBBBBBBBBBBBb..',
      '....bBBBBwwwwwwwBBBBBb..',
      '....bBBBBwBBBBBwBBBBBb..',
      '....bBBBBwwwwwwwBBBBBb..',
      '....bBBBBBBBBBBBBBBBBb..',
      '....bBBBBBBBBBBBBBBBBb..',
      '....bBBBBBBBBBBBBBBBBb..',
      '....bBBBBBBBBBBBBBBBBb..',
      '....bddddddddddddddddb..',
      '....bbbbbbbbbbbbbbbbbb..',
    ];
    const hand = [
      '........oooooo..........',
      '.......osssssso.........',
      '......osssssssso........',
      '......osSsSsSsso........',
      '......ossssssssoo.......',
      '.......osssssssso.......',
      '........ossssssso.......',
      '........osssssssso......',
      '.......ocsssssssco......',
      '.......occccccccco......',
      '.......occccccccco......',
    ];
    const pal = {
      k: '#2b2433', b: '#2b2433', B: M.color.base, d: M.color.lo, w: '#f4f1ea',
      o: '#2b2433', s: '#eebd98', S: '#d49a6e', c: '#e0463c',
    };
    const c = document.createElement('canvas');
    c.width = 24; c.height = rows.length + hand.length - 4;
    const g = c.getContext('2d');
    const put = (lines, oy) => lines.forEach((r, y) => [...r].forEach((k, x) => { if (k !== '.') { g.fillStyle = pal[k]; g.fillRect(x, y + oy, 1, 1); } }));
    put(rows, hand.length - 4); // alças da sacola passam por dentro da mão
    put(hand, 0);
    return c;
  })();

  function drawFirstPerson() {
    const ow = view.width, oh = view.height;
    const bob = Math.sin(player.walkT * 9) * 0.35;
    const peopleFp = [...sellers, ...clients];
    const r = fpsWorld().render(ctx, ow, oh, { x: player.x, y: player.y, ang: player.ang, bob }, peopleFp);
    const px = oh / r.h; // tamanho de 1 px da visão em px de tela
    // mão com sacola balançando
    const hb = Math.round(Math.abs(Math.sin(player.walkT * 4.5)) * 4) * px;
    const hs = Math.round(px * 3);
    ctx.drawImage(handArt, Math.round(ow * 0.74), Math.round(oh - handArt.height * hs + hs * 3 + hb), handArt.width * hs, handArt.height * hs);
    // minimapa
    const mw = Math.round(Math.min(200 * dpr, ow * 0.2)), mh = Math.round(mw * H / W);
    const mx = ow - mw - 16 * dpr, my = 16 * dpr;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#11101c';
    ctx.fillRect(mx - 4, my - 4, mw + 8, mh + 8);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(layer, mx, my, mw, mh);
    ctx.globalAlpha = 1;
    const sx = mx + player.x / W * mw, sy = my + player.y / H * mh;
    ctx.fillStyle = 'rgba(124, 245, 176, .35)';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.arc(sx, sy, mw * 0.12, player.ang - 0.58, player.ang + 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e0463c';
    ctx.fillRect(sx - 3, sy - 3, 6, 6);
  }

  // ------------------------------------------------------------ painel ------
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString('pt-BR');
  let hudLast = -1;
  function updateHud() {
    const n = clients.filter((c) => !c.leaving).length + sellers.length;
    if (n !== hudLast) { hudLast = n; $('hudPeople').textContent = fmt(n); }
  }
  // Nível de serviço de pedestres (Fruin) pela área de corredor por pessoa.
  function movimento(m2) {
    if (m2 >= 3.3) return 'LIVRE';
    if (m2 >= 2.3) return 'TRANQUILO';
    if (m2 >= 1.4) return 'MOVIMENTADO';
    if (m2 >= 0.9) return 'CHEIO';
    if (m2 >= 0.5) return 'LOTADO';
    return 'CRÍTICO';
  }
  function updateStats() {
    const occ = boxes.filter((b) => b.sellers > 0).length;
    $('stOcc').textContent = `${occ}/${boxes.length} · ${Math.round((occ / boxes.length) * 100)}%`;
    $('stArea').textContent = fmtM2(M.walkArea);
    const m2 = state.clientes ? M.walkArea / state.clientes : Infinity;
    $('stM2').textContent = isFinite(m2) ? fmtM2(m2) : '–';
    $('stLos').textContent = movimento(m2);
    $('stRatio').textContent = lojistas ? (state.clientes / lojistas).toFixed(1).replace('.', ',') : '–';
  }

  const state = { ...DEFAULTS };
  try { Object.assign(state, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); } catch (e) { /* sem storage */ }
  const qs = new URLSearchParams(location.search);
  for (const k of Object.keys(DEFAULTS)) if (qs.has(k)) state[k] = +qs.get(k) || 0;
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ok */ } }

  function bind(key, inId, rgId, max, apply) {
    const inp = $(inId), rg = $(rgId);
    inp.max = rg.max = max;
    const set = (v, from) => {
      v = Math.max(0, Math.min(max, Math.round(+v || 0)));
      state[key] = v;
      if (from !== inp) inp.value = v;
      if (from !== rg) rg.value = v;
      apply(v);
      updateStats();
      save();
    };
    inp.addEventListener('change', () => set(inp.value, inp));
    inp.addEventListener('input', () => { if (inp.value !== '') set(inp.value, inp); });
    rg.addEventListener('input', () => set(rg.value, rg));
    return set;
  }

  const setLoj = bind('lojistas', 'inLojistas', 'rgLojistas', boxes.length * 2, setLojistas);
  const setCli = bind('clientes', 'inClientes', 'rgClientes', MAX_CLIENTES, setClientes);
  $('hintLojistas').textContent = `${boxes.length} boxes (até 2 lojistas por box)`;

  btnPlay.onclick = () => setExplore(!player.active);
  $('btnPause').onclick = (e) => { paused = !paused; e.target.textContent = paused ? 'CONTINUAR' : 'PAUSAR'; };
  $('btnFast').onclick = (e) => { speedMul = speedMul === 1 ? 2 : speedMul === 2 ? 4 : 1; e.target.textContent = `VELOC. ${speedMul}x`; };
  $('btnFit').onclick = () => { if (player.active) setExplore(false); else fit(); };
  $('btnZoomIn').onclick = () => zoomAt(1.4, stage.clientWidth / 2, stage.clientHeight / 2);
  $('btnZoomOut').onclick = () => zoomAt(1 / 1.4, stage.clientWidth / 2, stage.clientHeight / 2);
  window.addEventListener('resize', () => { resize(); if (player.active) follow(1); else fit(); });

  // API pública (para integrar o contador de pessoas depois)
  function setCounts(c) {
    if (c && c[SECTOR]) c = c[SECTOR]; // formato por setor
    else if (c && SECTORS.some((s) => c[s])) return; // veio de outros setores, não deste
    if (c.lojistas != null) setLoj(c.lojistas);
    if (c.clientes != null) setCli(c.clientes);
  }
  window.MallSim = { sector: SECTOR, setCounts, get state() { return { ...state }; } };

  if (DATA_SOURCE.mode === 'api' && DATA_SOURCE.url) {
    $('sourceInfo').innerHTML = 'Fonte dos dados: <b>contador automático</b>';
    const poll = () => fetch(DATA_SOURCE.url, { cache: 'no-store' })
      .then((r) => r.json()).then(setCounts)
      .catch((err) => console.warn('Falha ao ler contador', err));
    poll();
    setInterval(poll, DATA_SOURCE.intervalMs);
  }

  // ------------------------------------------------------------- início -----
  resize();
  fit();
  paint();
  setLoj(state.lojistas);
  for (let i = 0; i < Math.min(state.clientes, MAX_CLIENTES); i++) {
    const c = cells[(Math.random() * cells.length) | 0];
    newClient(c % W, (c / W) | 0, false);
  }
  setCli(state.clientes);
  bindMouseLook();
  if (qs.has('andar')) setExplore(true);
  if (qs.has('pos')) {
    // ?pos=x,y[,graus] em metros a partir do canto do mapa — para compartilhar um ponto de vista
    const [x, y, a] = qs.get('pos').split(',').map(Number);
    const p = nearestWalk(Math.round(x * MPS), Math.round(y * MPS));
    if (p) { if (!player.active) setExplore(true); player.x = p[0] + 0.5; player.y = p[1] + 0.5; player.placed = true; }
    if (isFinite(a)) { player.ang = a * Math.PI / 180; player.dir = [2, 0, 1, 3][Math.round(((a % 360) + 360) % 360 / 90) % 4]; }
  }
  if (qs.has('visao')) { setFirstPerson(true); if (qs.has('pos')) player.ang = (+qs.get('pos').split(',')[2] || 0) * Math.PI / 180; }
  requestAnimationFrame(frame);
})();
