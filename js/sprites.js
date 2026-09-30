// Sprites em pixel art (estilo 16-bit) gerados em código, sem imagens externas.
// Escala: 1 px de arte = 5 cm. Pessoa de 1,65 m -> 33 px de altura (sprite 16x35 com contorno).
// Direções: 0 de frente, 1 esquerda, 2 direita, 3 de costas. 4 quadros de caminhada (1 = parado).
(function () {
  const SW = 16, SH = 35;
  const OUTLINE = '#2b2433';

  const SKIN = ['#f7d7bd', '#eebd98', '#d49a6e', '#a86f47', '#7a4b2e'];
  const HAIR = ['#2b2024', '#4a3226', '#7a4a2a', '#b8763a', '#e0b060', '#1d1d26', '#8e8e96', '#a8432d'];
  const SHIRT = ['#3d5a8c', '#6fa5d9', '#d9805a', '#ef9aae', '#f2b84b', '#a6bf6b', '#e89449', '#7d8a99', '#6b4a4a', '#f4f1ea', '#8c5fb0', '#4f8a7a'];
  const PANTS = ['#2f3f66', '#3d5a8c', '#4a4550', '#6b4a4a', '#7d8a99', '#2b2b33', '#8a7a60', '#5b6f96'];
  const SHOES = ['#2b2433', '#5a3a2a', '#f4f1ea', '#4a4550', '#8a4a3a'];
  const BAGS = ['#ef9aae', '#f2b84b', '#d9805a', '#6fa5d9', '#a6bf6b', '#f4f1ea', '#8c5fb0'];
  const HAIR_STYLES = ['short', 'short', 'long', 'long', 'bun', 'ponytail', 'buzz'];

  // ---------- utilidades de cor ----------
  const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (h, t, f) => { const a = toRgb(h), b = toRgb(t); return toHex(a.map((v, i) => v + (b[i] - v) * f)); };
  const ramp = (h) => ({ base: h, lite: mix(h, '#ffffff', 0.28), dark: mix(h, '#1a1428', 0.32) });
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  // ---------- grade de desenho ----------
  function Grid() {
    const g = Array.from({ length: SH }, () => new Array(SW).fill(null));
    return {
      g,
      px(x, y, c) { if (c && x >= 0 && y >= 0 && x < SW && y < SH) g[y][x] = c; },
      rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.px(x, y, c); },
      clear(x, y) { if (x >= 0 && y >= 0 && x < SW && y < SH) g[y][x] = null; },
    };
  }

  function toCanvas(G, flip) {
    // contorno: pixel vazio encostado (4 vizinhos) num pixel pintado
    const out = G.g.map((row) => row.slice());
    for (let y = 0; y < SH; y++)
      for (let x = 0; x < SW; x++) {
        if (G.g[y][x]) continue;
        if ((G.g[y - 1] && G.g[y - 1][x]) || (G.g[y + 1] && G.g[y + 1][x]) || G.g[y][x - 1] || G.g[y][x + 1]) out[y][x] = OUTLINE;
      }
    const c = document.createElement('canvas');
    c.width = SW; c.height = SH;
    const ctx = c.getContext('2d');
    for (let y = 0; y < SH; y++)
      for (let x = 0; x < SW; x++) {
        const col = out[y][flip ? SW - 1 - x : x];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    return c;
  }

  // ---------- partes do corpo ----------
  // Linhas: coque 1 · cabeça 2–11 · tronco 12–21 · quadril 22–23 · pernas 24–31 · sapatos 32–33
  function head(G, d, o, b) {
    const S = o.skin, Hc = o.hair;
    const y0 = 2 + b;
    if (d === 1) {
      // perfil voltado à esquerda
      G.rect(4, y0 + 1, 11, y0 + 8, S.base);
      G.rect(5, y0, 10, y0, S.base);
      G.rect(5, y0 + 9, 9, y0 + 9, S.base);
      G.px(3, y0 + 6, S.base);                       // nariz
      G.rect(9, y0 + 3, 11, y0 + 8, S.dark);          // sombra da nuca
      G.px(5, y0 + 5, OUTLINE); G.px(5, y0 + 6, OUTLINE); // olho
      G.px(6, y0 + 7, mix(S.base, '#e0707a', 0.35));  // bochecha
      // cabelo
      if (o.cap) {
        G.rect(4, y0 - 1, 11, y0 + 2, o.cap.base); G.rect(2, y0 + 2, 5, y0 + 2, o.cap.dark); G.rect(5, y0 - 1, 10, y0 - 1, o.cap.lite);
        G.rect(9, y0 + 3, 11, y0 + 6, Hc.base);
      } else {
        G.rect(4, y0 - 1, 11, y0 + 1, Hc.base); G.rect(5, y0 - 1, 10, y0 - 1, Hc.lite);
        G.rect(8, y0 + 2, 11, y0 + (o.style === 'buzz' ? 3 : 6), Hc.base);
        G.px(4, y0 + 2, Hc.base);
        if (o.style === 'long') G.rect(9, y0 + 6, 11, y0 + 12, Hc.base);
        if (o.style === 'ponytail') { G.rect(12, y0 + 2, 13, y0 + 7, Hc.base); G.px(12, y0 + 2, Hc.dark); }
        if (o.style === 'bun') G.rect(9, y0 - 2, 12, y0, Hc.base);
      }
      if (o.glasses) { G.rect(4, y0 + 5, 6, y0 + 5, OUTLINE); }
      return;
    }
    // frente / costas
    G.rect(3, y0 + 1, 12, y0 + 8, S.base);
    G.rect(4, y0, 11, y0 + 9, S.base);
    G.rect(12, y0 + 2, 12, y0 + 8, S.dark);
    if (d === 0) {
      G.px(5, y0 + 5, OUTLINE); G.px(5, y0 + 6, OUTLINE);
      G.px(10, y0 + 5, OUTLINE); G.px(10, y0 + 6, OUTLINE);
      const blush = mix(S.base, '#e0707a', 0.35);
      G.px(4, y0 + 7, blush); G.px(11, y0 + 7, blush);
      if (o.glasses) { G.rect(4, y0 + 4, 11, y0 + 4, OUTLINE); G.px(4, y0 + 5, OUTLINE); G.px(11, y0 + 5, OUTLINE); G.px(7, y0 + 5, OUTLINE); G.px(8, y0 + 5, OUTLINE); }
    }
    if (o.cap) {
      G.rect(3, y0 - 1, 12, y0 + 2, o.cap.base); G.rect(4, y0 - 1, 11, y0 - 1, o.cap.lite);
      if (d === 0) G.rect(3, y0 + 3, 12, y0 + 3, o.cap.dark);
      else G.rect(3, y0 + 3, 12, y0 + 6, Hc.base);
      return;
    }
    // cabelo
    G.rect(5, y0 - 1, 10, y0 - 1, Hc.base);
    G.rect(4, y0, 11, y0, Hc.base);
    G.rect(3, y0 + 1, 12, y0 + 2, Hc.base);
    G.rect(5, y0, 9, y0, Hc.lite);
    if (d === 0) {
      if (o.style !== 'buzz') { G.rect(4, y0 + 3, 6, y0 + 3, Hc.base); G.rect(9, y0 + 3, 11, y0 + 3, Hc.base); }
      G.rect(3, y0 + 3, 3, y0 + (o.style === 'buzz' ? 3 : 6), Hc.base);
      G.rect(12, y0 + 3, 12, y0 + (o.style === 'buzz' ? 3 : 6), Hc.dark);
    } else {
      G.rect(3, y0, 12, y0 + (o.style === 'buzz' ? 5 : 8), Hc.base);
      G.rect(12, y0 + 2, 12, y0 + 8, Hc.dark);
      G.rect(5, y0 + 1, 7, y0 + 1, Hc.lite);
    }
    if (o.style === 'long') {
      G.rect(2, y0 + 3, 3, y0 + 12, Hc.base); G.rect(12, y0 + 3, 13, y0 + 12, Hc.dark);
      if (d === 3) G.rect(3, y0 + 8, 12, y0 + 12, Hc.base);
    }
    if (o.style === 'bun') { G.rect(6, y0 - 3, 9, y0 - 1, Hc.base); G.rect(6, y0 - 3, 7, y0 - 3, Hc.lite); }
    if (o.style === 'ponytail' && d === 3) G.rect(7, y0 + 8, 8, y0 + 14, Hc.base);
  }

  function torso(G, d, o, b, f) {
    const C = o.shirt, S = o.skin, y0 = 12 + b;
    if (d === 1) {
      G.rect(5, y0, 10, y0 + 9, C.base);
      G.rect(10, y0, 10, y0 + 9, C.dark);
      G.rect(5, y0, 5, y0 + 8, C.lite);
      if (o.apron) { G.rect(4, y0 + 2, 6, y0 + 10, o.apron.base); G.px(4, y0 + 2, o.apron.lite); }
      // braço balançando
      const sw = f === 0 ? -2 : f === 2 ? 2 : 0;
      const edge = mix(C.dark, OUTLINE, 0.55);
      G.rect(7, y0 + 1, 8, y0 + 4, C.base); G.rect(8, y0 + 1, 8, y0 + 4, edge); G.px(7, y0 + 1, C.lite);
      G.rect(7 + (sw >> 1), y0 + 5, 8 + (sw >> 1), y0 + 7, S.base); G.px(8 + (sw >> 1), y0 + 7, S.dark);
      G.rect(7 + sw, y0 + 8, 8 + sw, y0 + 9, S.base); G.px(8 + sw, y0 + 9, S.dark);
      if (o.bag && sw >= 0) { G.rect(7 + sw, y0 + 10, 9 + sw, y0 + 13, o.bag.base); G.rect(7 + sw, y0 + 10, 9 + sw, y0 + 10, o.bag.dark); }
      return;
    }
    G.rect(4, y0, 11, y0 + 9, C.base);
    G.rect(4, y0, 4, y0 + 9, C.lite);
    G.rect(11, y0, 11, y0 + 9, C.dark);
    G.rect(5, y0 + 9, 10, y0 + 9, C.dark);
    if (d === 0) { G.px(7, y0, S.base); G.px(8, y0, S.base); } // gola
    if (o.apron) {
      if (d === 0) {
        G.rect(5, y0 + 3, 10, y0 + 11, o.apron.base);
        G.px(5, y0 + 1, o.apron.base); G.px(5, y0 + 2, o.apron.base); G.px(10, y0 + 1, o.apron.base); G.px(10, y0 + 2, o.apron.base);
        G.rect(6, y0 + 6, 9, y0 + 6, o.apron.lite);
        G.px(9, y0 + 3, '#f4f1ea'); // crachá
      } else {
        G.px(5, y0 + 1, o.apron.base); G.px(6, y0 + 2, o.apron.base); G.px(10, y0 + 1, o.apron.base); G.px(9, y0 + 2, o.apron.base);
        G.rect(5, y0 + 7, 10, y0 + 7, o.apron.base);
      }
    }
    // braços (manga curta + antebraço + mão), balanço de 1 px
    const la = f === 0 ? 1 : f === 2 ? -1 : 0, ra = -la;
    G.rect(2, y0 + 1, 3, y0 + 3, C.base); G.px(2, y0 + 1, C.lite);
    G.rect(2, y0 + 4, 3, y0 + 7 + la, S.base); G.px(3, y0 + 4, S.dark);
    G.rect(12, y0 + 1, 13, y0 + 3, C.dark);
    G.rect(12, y0 + 4, 13, y0 + 7 + ra, S.dark);
    if (o.bag && d === 0) {
      const by = y0 + 8 + ra;
      G.rect(12, by, 14, by + 4, o.bag.base); G.rect(12, by, 14, by, o.bag.dark); G.px(12, by + 1, o.bag.lite);
    }
  }

  function legs(G, d, o, b, f) {
    const P = o.pants, Sh = o.shoes, y0 = 22 + b;
    if (d === 1) {
      G.rect(5, y0, 10, y0 + 1, P.base);
      if (f === 1 || f === 3) {
        G.rect(6, y0 + 2, 9, y0 + 9 - b, P.base); G.rect(9, y0 + 2, 9, y0 + 9 - b, P.dark);
        G.rect(5, 32, 9, 33, Sh.base); G.rect(5, 32, 6, 32, Sh.lite);
      } else {
        // passada: perna da frente para a esquerda, a de trás para a direita
        G.rect(7, y0 + 2, 10, y0 + 4, P.dark); G.rect(9, y0 + 5, 11, 31, P.dark); G.rect(9, 32, 12, 33, Sh.dark);
        G.rect(5, y0 + 2, 8, y0 + 4, P.base); G.rect(4, y0 + 5, 6, 31, P.base); G.rect(2, 32, 6, 33, Sh.base); G.px(2, 32, Sh.lite);
      }
      return;
    }
    G.rect(5, y0, 10, y0 + 1, P.base);
    G.rect(5, y0, 10, y0, P.dark); // cinto
    const liftL = f === 2 ? 1 : 0, liftR = f === 0 ? 1 : 0;
    G.rect(5, y0 + 2, 7, 31 - liftL, P.base); G.px(7, y0 + 2, P.dark); G.rect(7, y0 + 3, 7, 31 - liftL, P.dark);
    G.rect(8, y0 + 2, 10, 31 - liftR, P.base); G.rect(10, y0 + 2, 10, 31 - liftR, P.dark);
    G.rect(4, 32 - liftL, 7, 33 - liftL, Sh.base); G.px(4, 32 - liftL, Sh.lite);
    G.rect(8, 32 - liftR, 11, 33 - liftR, Sh.base); G.px(11, 33 - liftR, Sh.dark);
  }

  function person(d, f, o) {
    const G = Grid();
    const b = f === 1 || f === 3 ? 0 : 1; // corpo desce 1 px no contato do pé
    // ordem: cabelo comprido de costas fica por cima do tronco; demais, cabeça por último
    legs(G, d, o, b, f);
    torso(G, d, o, b, f);
    head(G, d, o, b);
    return G;
  }

  // Gera uma "aparência": 4 direções x 4 quadros.
  function makeLook(kind, opts = {}) {
    const o = {
      skin: ramp(pick(SKIN)),
      hair: ramp(pick(HAIR)),
      style: opts.style || pick(HAIR_STYLES),
      shirt: ramp(opts.shirt || pick(SHIRT)),
      pants: ramp(opts.pants || pick(PANTS)),
      shoes: ramp(opts.shoes || pick(SHOES)),
      glasses: opts.glasses != null ? opts.glasses : Math.random() < 0.15,
      bag: kind === 'shopper' && Math.random() < 0.4 ? ramp(pick(BAGS)) : null,
      apron: kind === 'seller' ? ramp(opts.apron || '#5a4038') : null,
      cap: opts.cap ? ramp(opts.cap) : null,
    };
    const frames = [];
    for (const d of [0, 1, 3]) frames[d] = [0, 1, 2, 3].map((f) => toCanvas(person(d, f, o)));
    frames[2] = [0, 1, 2, 3].map((f) => toCanvas(person(1, f, o), true));
    return { frames };
  }

  // sombra elíptica no chão
  const shadow = (() => {
    const c = document.createElement('canvas');
    c.width = 14; c.height = 5;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(40, 30, 50, .28)';
    [[3, 0, 8], [1, 1, 12], [0, 2, 14], [1, 3, 12], [3, 4, 8]].forEach(([x, y, w]) => ctx.fillRect(x, y, w, 1));
    return c;
  })();

  const shopperLooks = Array.from({ length: 48 }, () => makeLook('shopper'));
  const sellerLooks = Array.from({ length: 20 }, () => makeLook('seller', { shirt: pick(['#f4f1ea', '#6fa5d9', '#3d5a8c']) }));

  window.Sprites = {
    W: SW, H: SH, FOOT: 33, SCALE: 2, // SCALE = px de arte por tile de 10 cm
    shadow,
    shopper: () => pick(shopperLooks),
    seller: () => pick(sellerLooks),
    player: () => makeLook('shopper', { shirt: '#e0463c', pants: '#2f3f66', cap: '#e0463c', style: 'short', glasses: false }),
  };
})();
