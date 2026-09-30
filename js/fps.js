// Visão em 1ª pessoa estilo Doom (raycasting) para o modo "andar pelo shopping".
// Mundo em tiles de 10 cm; alturas também em tiles (16 = 1,6 m).
// Paredes com alturas diferentes (paredes cheias, divisórias de box, letreiros, araras, corrimãos),
// piso/teto texturizados e pessoas como sprites 2D que mostram frente, lado ou costas conforme o ângulo.
(function () {
  'use strict';

  const EYE = 16;      // altura dos olhos (1,6 m)
  const CEIL = 32;     // pé-direito (3,2 m)
  const FOV = 66 * Math.PI / 180;
  const MAXD = 420;    // alcance da visão (42 m)

  // tipos de célula e suas faixas de altura [lo, hi]
  const T = { EMPTY: 0, WALL: 1, ROOM: 2, OUT: 3, PART: 4, SIGN: 5, SHUTTER: 6, RAIL: 7, RACK: 8, ESC: 9, PILLAR: 10 };
  const LO = [], HI = [], FULL = [];
  const def = (t, lo, hi) => { LO[t] = lo; HI[t] = hi; FULL[t] = lo === 0 && hi >= CEIL; };
  def(T.EMPTY, 0, 0); def(T.WALL, 0, CEIL); def(T.ROOM, 0, CEIL); def(T.OUT, 0, CEIL);
  def(T.PART, 0, 24); def(T.SIGN, 22, 27); def(T.SHUTTER, 0, 27); def(T.RAIL, 0, 10);
  def(T.RACK, 3, 16); def(T.ESC, 0, 11); def(T.PILLAR, 0, CEIL);

  // ---------- cores ----------
  const pack = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  const hexp = (h) => pack(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
  const FOG = [29, 26, 38];
  function shade(c, f) {
    const g = 1 - f;
    const r = (c & 255) * f + FOG[0] * g, gg = ((c >>> 8) & 255) * f + FOG[1] * g, b = ((c >>> 16) & 255) * f + FOG[2] * g;
    return (0xff000000 | (b << 16) | (gg << 8) | r) >>> 0;
  }
  // versão inteira (fi de 0 a 256), bem mais barata por pixel
  const FOGC = pack(FOG[0], FOG[1], FOG[2]);
  function shadeI(c, fi) {
    const gi = 256 - fi;
    return (0xff000000 | (((((c >>> 16) & 255) * fi + FOG[2] * gi) >> 8) << 16) |
      (((((c >>> 8) & 255) * fi + FOG[1] * gi) >> 8) << 8) | ((((c & 255) * fi + FOG[0] * gi) >> 8))) >>> 0;
  }
  const hash = (x, y) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
  const P = {
    plaster: hexp('#d6cfc4'), plasterDark: hexp('#c4bcb0'), plasterTop: hexp('#e4ded4'), base: hexp('#6e687a'),
    room: hexp('#8e8898'), roomLine: hexp('#7e788a'), out: hexp('#2a2636'),
    part: hexp('#e3e6ec'), partSeam: hexp('#c9ced8'), partTop: hexp('#aeb6c4'), partBase: hexp('#9aa3b0'),
    shut: hexp('#a3acb8'), shut2: hexp('#8a94a1'), shutLine: hexp('#6c7684'),
    glass: hexp('#9fc6e0'), metal: hexp('#b9c1cc'), metalDark: hexp('#8791a0'), rail: hexp('#22202a'),
    step: hexp('#3b3a45'), stepLine: hexp('#55545f'), yellow: hexp('#f2b84b'),
    pillar: hexp('#9a94a6'), pillarEdge: hexp('#7a748a'),
    floor: hexp('#efe7d6'), grout: hexp('#d8ccb4'), wood: hexp('#d2b489'), woodSeam: hexp('#b89668'), concrete: hexp('#4a4550'),
    ceil: hexp('#e8e4dc'), ceilGrid: hexp('#cfc9bf'), light: hexp('#fffbea'), ceilDark: hexp('#3a3546'),
    white: hexp('#f4f1ea'), underside: hexp('#5a5568'),
  };
  // paleta base do piso/teto (índices B_*), sombreada uma vez por linha
  const B_OUT = 0, B_GROUT = 1, B_FLOOR = 2, B_SEAM = 6, B_WOOD = 7, B_CONC = 10, B_LIGHT = 11, B_CGRID = 12, B_CEIL = 13, B_CDARK = 14;
  const BASE = [
    P.out, P.grout,
    ...[0, 1, 2, 3].map((v) => shade(P.floor, 1 - v * 0.012)),
    P.woodSeam, ...[0, 1, 2].map((v) => shade(P.wood, 1 - v * 0.03)),
    P.concrete, P.light, P.ceilGrid, P.ceil, P.ceilDark,
  ];
  const CLOTHES = ['#3d5a8c', '#6fa5d9', '#d9805a', '#ef9aae', '#f2b84b', '#a6bf6b', '#e89449', '#f4f1ea', '#4a4550', '#8c5fb0', '#6b4a4a'].map(hexp);
  const CLOTHES_D = CLOTHES.map((c) => shade(c, 0.85));
  const DIRV = [[0, 1], [-1, 0], [1, 0], [0, -1]]; // 0 baixo, 1 esquerda, 2 direita, 3 cima (no mapa)

  function create(o) {
    const { W, H, tiles, boxAt, boxes, objects } = o;
    const N = W * H;
    const cell = new Uint8Array(N);
    // variação de tom por peça de porcelanato (60 cm) e por tábua de madeira, pré-calculada
    const W6 = Math.ceil(W / 6) + 1, WW = Math.ceil(W / 20) + 1;
    const var6 = new Uint8Array(W6 * (Math.ceil(H / 6) + 1)).map((_, i) => hash(i % W6, (i / W6) | 0) % 4);
    const varW = new Uint8Array(WW * (Math.ceil(H / 3) + 1)).map((_, i) => hash(i % WW, (i / WW) | 0) % 3);
    const SEC = { base: hexp(o.color.base), hi: hexp(o.color.hi), lo: hexp(o.color.lo) };
    SEC.baseDim = shade(SEC.base, 0.7); SEC.loDim = shade(SEC.lo, 0.7);

    // dilatação quadrada de raio r (máscara 0/1)
    function dilate(mask, r) {
      const tmp = new Uint8Array(N), out = new Uint8Array(N);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let v = 0;
          for (let k = -r; k <= r && !v; k++) { const xx = x + k; if (xx >= 0 && xx < W && mask[y * W + xx]) v = 1; }
          tmp[y * W + x] = v;
        }
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let v = 0;
          for (let k = -r; k <= r && !v; k++) { const yy = y + k; if (yy >= 0 && yy < H && tmp[yy * W + x]) v = 1; }
          out[y * W + x] = v;
        }
      return out;
    }
    const boxMask = new Uint8Array(N), corrMask = new Uint8Array(N);
    for (let i = 0; i < N; i++) { boxMask[i] = boxAt[i] >= 0 ? 1 : 0; corrMask[i] = tiles[i] === 1 ? 1 : 0; }
    const nearBox = dilate(boxMask, 2), nearCorr = dilate(corrMask, 2);

    function boxNear(i) {
      const x = i % W, y = (i / W) | 0;
      for (let r = 1; r <= 2; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H && boxAt[yy * W + xx] >= 0) return boxAt[yy * W + xx];
          }
      return -1;
    }

    // Faixa da fachada de cada box: as linhas (parede + moldura) entre o interior do box e o corredor,
    // no lado virado para o corredor. Ela fica "em corte": só o letreiro no alto (ou a porta, se fechado).
    const frontOf = new Int16Array(N).fill(-1);
    for (const b of boxes) {
      const face = b.face != null ? b.face : (b.face = o.facingOut(b));
      const [fx, fy] = DIRV[face];
      for (let y = b.y; y < b.y + b.h; y++)
        for (let x = b.x; x < b.x + b.w; x++) {
          if (boxAt[y * W + x] !== b.idx) continue;
          const nx = x + fx, ny = y + fy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || boxAt[ny * W + nx] === b.idx) continue;
          // anda para fora até chegar no corredor, marcando as linhas no caminho
          const path = [];
          for (let k = 1; k <= 10; k++) {
            const xx = x + fx * k, yy = y + fy * k;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) break;
            const t = tiles[yy * W + xx];
            if (t === 1) { for (const i of path) frontOf[i] = b.idx; break; }
            if (t !== 2 && t !== 3) break;
            path.push(yy * W + xx);
          }
        }
    }

    // monta a grade 3D (chamar de novo quando lojistas mudam: abre/fecha lojas)
    function build() {
      for (let i = 0; i < N; i++) {
        const t = tiles[i];
        let c = T.EMPTY;
        if (t === 2 || t === 3) {
          const fb = frontOf[i] >= 0 ? frontOf[i] : (nearBox[i] && nearCorr[i] ? boxNear(i) : -1);
          if (fb >= 0) c = boxes[fb].sellers > 0 ? T.SIGN : T.SHUTTER; // fachada: aberta (só letreiro) ou porta fechada
          else if (nearBox[i]) c = T.PART;
          else c = t === 2 ? T.WALL : T.RAIL;
        } else if (t === 4) c = T.ROOM;
        else if (t === 0) c = T.OUT;
        cell[i] = c;
      }
      // araras de roupa no fundo das lojas abertas
      for (const b of boxes) {
        if (!(b.sellers > 0)) continue;
        const face = b.face != null ? b.face : (b.face = o.facingOut(b));
        const [bx, by] = DIRV[3 - face]; // direção do fundo
        const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H && boxAt[y * W + x] === b.idx;
        const dist = (x, y, dx, dy) => { let k = 0; while (k < 6 && inB(x + dx * (k + 1), y + dy * (k + 1))) k++; return k; };
        for (let y = b.y; y < b.y + b.h; y++)
          for (let x = b.x; x < b.x + b.w; x++) {
            if (!inB(x, y)) continue;
            const dBack = dist(x, y, bx, by);
            const side = Math.min(dist(x, y, by, bx), dist(x, y, -by, -bx));
            if (dBack >= 1 && dBack <= 3 && side >= 2) cell[y * W + x] = T.RACK;
          }
      }
      for (const ob of objects || []) {
        const c = ob.kind === 'escalator' ? T.ESC : ob.kind === 'pillar' ? T.PILLAR : T.EMPTY;
        if (!c) continue;
        for (let y = ob.y; y < ob.y + ob.h; y++)
          for (let x = ob.x; x < ob.x + ob.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) cell[y * W + x] = c;
      }
    }

    // ---------- texturas (cor por tipo, coordenada ao longo da parede u e altura h) ----------
    function texel(t, uu, h) { // uu: posição ao longo da parede, já em [0, 64)
      switch (t) {
        case T.WALL:
          if (h < 1.2) return P.base;
          if (h > 30) return P.plasterTop;
          return uu % 12 < 0.35 ? P.plasterDark : P.plaster;
        case T.ROOM: return h % 4 < 0.4 ? P.roomLine : P.room;
        case T.OUT: return P.out;
        case T.PART:
          if (h > 23) return P.partTop;
          if (h < 1) return P.partBase;
          return uu % 6 < 0.3 ? P.partSeam : P.part;
        case T.SHUTTER:
          if (h >= 22) return h > 26 ? SEC.loDim : SEC.baseDim;
          if (h % 4 < 0.5) return P.shutLine;
          return h % 2 < 1 ? P.shut : P.shut2;
        case T.SIGN: {
          if (h > 26.2) return SEC.lo;
          if (h < 22.8) return SEC.hi;
          // "letreiro": blocos claros como letras
          const col = Math.floor(uu * 1.2), row = Math.floor((h - 23) * 1.3);
          if (row >= 0 && row < 4 && (hash(col, row) & 3) !== 0 && col % 5 !== 4) return P.white;
          return SEC.base;
        }
        case T.RAIL: return h > 9 ? P.metal : h > 8.5 ? P.rail : P.glass;
        case T.RACK: {
          if (h > 15) return P.rail;
          const col = Math.floor(uu * 1.5);
          const ci = hash(col, 7) % CLOTHES.length;
          const len = 6 + (hash(col, 3) % 6); // comprimento da peça
          if (h < 15 - len) return P.concrete;
          return (col & 1) ? CLOTHES_D[ci] : CLOTHES[ci];
        }
        case T.ESC: return h > 10 ? P.rail : h > 5 ? P.glass : P.metal;
        case T.PILLAR: return uu % 5 < 0.4 ? P.pillarEdge : P.pillar;
      }
      return P.out;
    }
    function topColor(t, x, y) {
      if (t === T.ESC) return ((y | 0) % 4 === 0 || (x | 0) % 4 === 0) ? P.stepLine : P.step;
      if (t === T.RACK) return (x | 0) % 2 ? P.rail : CLOTHES[hash(x | 0, y | 0) % CLOTHES.length];
      return P.metal;
    }

    // ---------- buffers ----------
    let Wr = 0, Hr = 0, img, buf, zbuf, off, offCtx;
    function ensure(w, h) {
      if (w === Wr && h === Hr) return;
      Wr = w; Hr = h;
      off = document.createElement('canvas'); off.width = w; off.height = h;
      offCtx = off.getContext('2d');
      img = offCtx.createImageData(w, h);
      buf = new Uint32Array(img.data.buffer);
      zbuf = new Float32Array(w * h);
    }

    const pixCache = new WeakMap();
    function spritePixels(cv) {
      let p = pixCache.get(cv);
      if (!p) { p = new Uint32Array(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data.buffer); pixCache.set(cv, p); }
      return p;
    }

    // ---------- desenho ----------
    function render(ctx, outW, outH, cam, people) {
      const w = Math.max(240, Math.min(360, Math.round(outW / 3))); // ~ resolução do Doom original
      const h = Math.max(135, Math.round(w * outH / outW));
      ensure(w, h);
      const px = cam.x, py = cam.y;
      const dirX = Math.cos(cam.ang), dirY = Math.sin(cam.ang);
      const tanH = Math.tan(FOV / 2);
      const plX = -dirY * tanH, plY = dirX * tanH;
      const proj = (Wr / 2) / tanH;
      const eye = EYE + (cam.bob || 0);
      const horizon = Hr / 2 + (cam.pitch || 0);
      const fogOf = (d) => Math.max(0.28, 1 - d / MAXD);
      const fogI = (d) => (fogOf(d) * 256) | 0;

      // piso e teto: a neblina é calculada uma vez por linha numa paleta pequena
      const rowPal = new Uint32Array(BASE.length);
      for (let y = 0; y < Hr; y++) {
        const dy = y - horizon;
        let k = y * Wr;
        if (Math.abs(dy) < 0.5) { for (let x = 0; x < Wr; x++, k++) { buf[k] = FOGC; zbuf[k] = 1e9; } continue; }
        const isFloor = dy > 0;
        const rowDist = (isFloor ? eye : CEIL - eye) * proj / Math.abs(dy);
        const fi = fogI(rowDist);
        for (let i = 0; i < BASE.length; i++) rowPal[i] = shadeI(BASE[i], fi);
        const stepX = rowDist * 2 * plX / Wr, stepY = rowDist * 2 * plY / Wr;
        let fx = px + rowDist * (dirX - plX), fy = py + rowDist * (dirY - plY);
        for (let x = 0; x < Wr; x++, k++, fx += stepX, fy += stepY) {
          const cx = fx | 0, cy = fy | 0;
          let ci = B_OUT;
          if (cx >= 0 && cy >= 0 && cx < W && cy < H) {
            const t = tiles[cy * W + cx];
            const gx = cx % 6, gy = cy % 6;
            if (isFloor) {
              if (t === 1) ci = (gx === 0 && fx - cx < 0.3) || (gy === 0 && fy - cy < 0.3) ? B_GROUT : B_FLOOR + var6[((cy / 6) | 0) * W6 + ((cx / 6) | 0)];
              else if (t === 6) ci = cy % 3 === 0 && fy - cy < 0.25 ? B_SEAM : B_WOOD + varW[((cy / 3) | 0) * WW + ((cx / 20) | 0)];
              else ci = B_CONC;
            } else if (t === 1 || t === 6) {
              if (((cx / 18) | 0) % 2 === 0 && ((cy / 18) | 0) % 2 === 0 && gx >= 1 && gy >= 1 && gx <= 4 && gy <= 4) ci = B_LIGHT;
              else ci = (gx === 0 && fx - cx < 0.25) || (gy === 0 && fy - cy < 0.25) ? B_CGRID : B_CEIL;
            } else ci = B_CDARK;
          }
          buf[k] = rowPal[ci];
          zbuf[k] = rowDist;
        }
      }

      // paredes: um raio por coluna, atravessando objetos baixos até achar uma parede cheia
      for (let x = 0; x < Wr; x++) {
        const camX = 2 * x / Wr - 1;
        const rdx = dirX + plX * camX, rdy = dirY + plY * camX;
        let mapX = px | 0, mapY = py | 0;
        const ddx = Math.abs(1 / rdx), ddy = Math.abs(1 / rdy);
        const sX = rdx < 0 ? -1 : 1, sY = rdy < 0 ? -1 : 1;
        let sdx = rdx < 0 ? (px - mapX) * ddx : (mapX + 1 - px) * ddx;
        let sdy = rdy < 0 ? (py - mapY) * ddy : (mapY + 1 - py) * ddy;
        let dEnter = 0, side = 0;
        let runT = 0, runD0 = 0, runSide = 0, runU = 0;
        for (let s = 0; s < 2000; s++) {
          if (mapX < 0 || mapY < 0 || mapX >= W || mapY >= H) break;
          const ct = cell[mapY * W + mapX];
          if (ct !== runT) {
            if (runT) drawRun(x, runT, runD0, dEnter, runSide, runU);
            runT = ct;
            if (ct) {
              runD0 = dEnter; runSide = side;
              runU = side === 0 ? py + dEnter * rdy : px + dEnter * rdx;
              if (FULL[ct]) { drawRun(x, ct, dEnter, dEnter, side, runU); runT = 0; break; }
            }
          }
          if (sdx < sdy) { dEnter = sdx; sdx += ddx; mapX += sX; side = 0; } else { dEnter = sdy; sdy += ddy; mapY += sY; side = 1; }
          if (dEnter > MAXD) break;
        }
        if (runT) drawRun(x, runT, runD0, dEnter, runSide, runU);

        function drawRun(x, t, d0, d1, sd, u) {
          if (d0 < 0.3) d0 = 0.3;
          const lo = LO[t], hi = HI[t];
          const fi = (fogI(d0) * (sd ? 0.84 : 1)) | 0;
          const uu = ((u % 64) + 64) % 64;
          // face vertical
          const yTop = horizon - (hi - eye) * proj / d0, yBot = horizon - (lo - eye) * proj / d0;
          const ya = Math.max(0, Math.ceil(yTop)), yb = Math.min(Hr - 1, Math.floor(yBot));
          const dh = d0 / proj;
          let lastC = -1, lastS = 0;
          for (let y = ya; y <= yb; y++) {
            const k = y * Wr + x;
            if (zbuf[k] <= d0) continue;
            const c = texel(t, uu, eye - (y - horizon) * dh);
            if (c !== lastC) { lastC = c; lastS = shadeI(c, fi); } // cor repetida na coluna: reaproveita
            buf[k] = lastS;
            zbuf[k] = d0;
          }
          if (d1 <= d0) return;
          // tampo de objetos abaixo dos olhos (corrimão, arara, escada rolante)
          if (hi < eye) {
            const yA = Math.max(0, Math.ceil(horizon + (eye - hi) * proj / d1));
            const yB = Math.min(Hr - 1, Math.floor(horizon + (eye - hi) * proj / d0));
            for (let y = yA; y <= yB; y++) {
              const k = y * Wr + x;
              const d = (eye - hi) * proj / (y - horizon);
              if (zbuf[k] <= d) continue;
              const wx = px + rdx * d, wy = py + rdy * d;
              buf[k] = shadeI(topColor(t, wx, wy), fogI(d));
              zbuf[k] = d;
            }
          }
          // parte de baixo de letreiros acima dos olhos
          if (lo > eye) {
            const yA = Math.max(0, Math.ceil(horizon - (lo - eye) * proj / d0));
            const yB = Math.min(Hr - 1, Math.floor(horizon - (lo - eye) * proj / d1));
            for (let y = yA; y <= yB; y++) {
              const k = y * Wr + x;
              const d = (lo - eye) * proj / (horizon - y);
              if (zbuf[k] <= d) continue;
              buf[k] = shadeI(P.underside, fogI(d));
              zbuf[k] = d;
            }
          }
        }
      }

      // pessoas (sprites 2D sempre de frente para a câmera)
      const invDet = 1 / (plX * dirY - dirX * plY);
      const SW = Sprites.W, SH = Sprites.H, FOOT = Sprites.FOOT;
      for (const p of people) {
        const rx = p.x - px, ry = p.y - py;
        if (rx * rx + ry * ry > MAXD * MAXD) continue;
        const tx = invDet * (dirY * rx - dirX * ry);
        const ty = invDet * (-plY * rx + plX * ry);
        if (ty < 2) continue;
        const scale = (1 / Sprites.SCALE) * proj / ty; // px de tela por px de arte
        const sx = (Wr / 2) * (1 + tx / ty);
        const half = SW * scale / 2;
        if (sx + half < 0 || sx - half >= Wr) continue;
        // qual lado do boneco a câmera vê
        const fv = DIRV[p.dir];
        const fwd = fv[0] * dirX + fv[1] * dirY, right = fv[0] * plX + fv[1] * plY;
        const d = fwd < -0.5 ? 0 : fwd > 0.5 ? 3 : (right > 0 ? 2 : 1);
        const pix = spritePixels(p.look.frames[d][p.frame]);
        const yFeet = horizon + eye * proj / ty;
        const top = yFeet - (FOOT + 1) * scale;
        const left = sx - half + (p.shift || 0) * scale;
        const fi = fogI(ty);
        const xa = Math.max(0, Math.ceil(left)), xb = Math.min(Wr - 1, Math.floor(left + SW * scale));
        const ya = Math.max(0, Math.ceil(top)), yb = Math.min(Hr - 1, Math.floor(top + SH * scale));
        for (let x = xa; x <= xb; x++) {
          const u = ((x - left) / scale) | 0;
          if (u < 0 || u >= SW) continue;
          for (let y = ya; y <= yb; y++) {
            const k = y * Wr + x;
            if (zbuf[k] <= ty) continue;
            const v = ((y - top) / scale) | 0;
            if (v < 0 || v >= SH) continue;
            const c = pix[v * SW + u];
            if (!(c >>> 24)) continue;
            buf[k] = shadeI(c, fi);
            zbuf[k] = ty;
          }
        }
      }

      offCtx.putImageData(img, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, outW, outH);
      return { w: Wr, h: Hr };
    }

    build();
    return { build, render };
  }

  window.FPS = { create };
})();
