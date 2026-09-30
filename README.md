# EF 16-bit

Simulação em pixel art (estilo 16-bit) dos setores do shopping, gerada a partir das
plantas em CAD (medidas reais: 1 tile = 10 cm; arte em 5 cm por pixel). Lojistas ficam
nos boxes, clientes circulam pelos corredores, e você pode controlar um boneco.

Setores disponíveis: **Azul**, **Laranja** e **Vermelho** (seletor no topo da página).

## Rodar

É um site estático. Sirva a pasta com qualquer servidor HTTP:

```bash
python -m http.server 8080
```

e abra http://localhost:8080. Parâmetros aceitos na URL:

- `?setor=laranja` — abre um setor específico (o último aberto é lembrado)
- `?lojistas=200&clientes=300` — números iniciais
- `?andar=1` — já abre no modo "andar pelo shopping"

Os números de lojistas e clientes ficam salvos separadamente para cada setor.

## Controles

- **Painel:** quantidade de lojistas (até 2 por box) e de clientes.
- **Mapa:** roda do mouse = zoom, arrastar = mover, passar o mouse num box = detalhes.
- **Andar pelo shopping:** botão vermelho ou qualquer tecla WASD/setas. Shift corre,
  Esc sai. No celular aparece um direcional na tela.
- **1ª pessoa (estilo Doom):** dentro do modo andar, tecla **V** ou o botão "Visão 1ª
  pessoa". W/S anda, A/D anda de lado, ←/→ (ou Q/E) giram; clique na tela para girar com
  o mouse (Esc solta o mouse). Lojas abertas aparecem "em corte" (só o letreiro no alto),
  com lojista e araras dentro; lojas fechadas mostram a porta de enrolar. Minimapa no canto.

Links úteis: `?andar=1&visao=1` abre direto em 1ª pessoa; `?pos=x,y,graus` coloca o
boneco num ponto (metros a partir do canto do mapa) olhando numa direção.

## Estrutura

- `index.html`, `css/style.css` — página e painel
- `js/sim.js` — simulação (mapa, caminhos, pessoas, boneco, câmera, painel)
- `js/sprites.js` — bonecos em pixel art gerados em código
- `js/fps.js` — visão em 1ª pessoa (raycasting estilo Doom)
- `js/maps/<setor>.js` — mapa de cada setor, gerado a partir do CAD (não editar à mão)
- `tools/extract_dxf.py` — converte o DXF de um setor em `js/maps/<setor>.js`
- `tools/sprites.html` — prévia ampliada dos bonecos

## Regerar um mapa / adicionar um setor

```bash
pip install ezdxf opencv-python-headless numpy
python tools/extract_dxf.py azul
python tools/extract_dxf.py laranja
python tools/extract_dxf.py vermelho
```

Para um setor novo: coloque o DXF na pasta, adicione uma entrada em `SECTORS` no topo
de `tools/extract_dxf.py` (arquivo, nome, cores e entradas em coordenadas do CAD),
rode o script e inclua `<script src="js/maps/<setor>.js">` no `index.html`.
`tools/map-preview-<setor>.png` mostra o resultado para conferência (pontos vermelhos
= entradas).

O script reconhece cada box como a região fechada que contém um número (camada
`ARQ-AN-TEX-1`), os corredores pelos nomes de ambiente (camada `ARQ-AN-ambiente`),
e desenha escadas rolantes e pilares a partir dos blocos do CAD.

## Integração com o contador de pessoas

Hoje os números são manuais. Quando houver o contador, em `js/sim.js`:

```js
const DATA_SOURCE = { mode: 'api', url: 'https://.../contagem', intervalMs: 15000 };
```

O endpoint pode responder por setor
`{ "azul": { "clientes": 312, "lojistas": 190 }, "laranja": { "clientes": 280 } }`
ou só `{ "clientes": 312, "lojistas": 190 }` para o setor aberto. Também dá para
empurrar os dados de fora com `MallSim.setCounts({...})`.
