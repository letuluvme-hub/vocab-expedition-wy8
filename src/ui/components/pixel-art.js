/* 像素美术：怪物精灵与装备图标。
 *
 * 从预览稿（`public/preview-pixel-v3.html`）搬进游戏的正规实现 ——
 * 预览页本身是开发期的对比稿，不随站点发布。
 *
 * ★ 安全性契约（与 monster-art.js 同一条，改动时逐条核对）：
 *   1) 怪物名只取本文件**固定表**的键，绝不把 `foe.n` / `foe.ic` / `foe.tint`
 *      拼进 HTML —— 它们可能来自存档或自定义词表。
 *   2) 认不出的名字回落到默认精灵（'词灵'），而不是把输入原样写进标记。
 *   3) 装备图标按 **id** 从固定表取；认不出的 id 返回 null，由调用方自己决定
 *      怎么降级（通常是继续用 ❔ 文本，只经 textContent 落屏）。
 *      绝不在图标里回显未知 id。
 *   4) 所有配色来自本文件的固定调色板，不接受外部传入的颜色。
 *
 * ★ 渲染方式：字符网格 → 每个非空格子一个 <rect>，viewBox 固定 16×16（怪物）
 *   或 12×12（图标），由 CSS 缩放并用 image-rendering:pixelated 保持硬边。
 *   这样任意尺寸都清晰，且不依赖任何运行时布局。
 *
 * 字符含义： . 透明  o 描边  m 主体  l 高光  d 暗部  w 眼白  p 瞳孔  g 眼白暗部
 */
const INK = '#24152f';
const WHITE = '#fffdf4';
const EYE_SHADE = '#e8dff5';

/* ---------------- 怪物：16×16 ---------------- */

const MONSTER_PALETTES = {
  '词灵':     { mid: '#a67dff', light: '#d9c4ff', dark: '#7450cb' },
  '语素蛛':   { mid: '#ff779c', light: '#ffb6cf', dark: '#c94a72' },
  '石化词素': { mid: '#adb9c3', light: '#e2eaf0', dark: '#697681' },
  '歧义章鱼': { mid: '#cb8cf6', light: '#e8c4ff', dark: '#8e4fc4' },
  '拼写幽灵': { mid: '#cfe9f2', light: '#eef8fc', dark: '#7fb0c4' },
  '单复数蝎': { mid: '#ffd064', light: '#ffe6a8', dark: '#d9932f' },
  '冰封词灵': { mid: '#7fdcea', light: '#c4f4fb', dark: '#2a9fc4' },
  '词形旋风': { mid: '#a8b2ff', light: '#d0d8ff', dark: '#5f52c4' },
  '词汇之王': { mid: '#ffdf8a', light: '#fff2c9', dark: '#c99b3c' },
};

/* body 是 16 行的字符网格；eyes 是眼白矩形，眨眼时用同色矩形盖住它们。 */
const MONSTER_SPRITES = {
  '词灵': {
    body: [
      '......m....m....',
      '......m....m....',
      '...mmmmmmmmmm...',
      '..mmllllllllmm..',
      '..mlwggllggwlm..',
      '..mlwgpglgpwlm..',
      '..mlwggllggwlm..',
      '..mlwggllggwlm..',
      '..mllllllllllm..',
      '..mmlllllllmmm..',
      '...mmmmmmmmmm...',
      '....mm....mm....',
      '...mmm....mmm...',
      '................',
      '................',
      '................',
    ],
    eyes: [[3, 4, 2, 4], [11, 4, 2, 4]],
  },
  '语素蛛': {
    body: [
      '..o..........o..',
      '.omo........omo.',
      '.ommo......ommo.',
      '..omo.oooo.omo..',
      '...ommmmmmmmo...',
      '..ommllllllmmo..',
      '.ommlgmmgmllmmo.',
      '.ommlgpmmgpmlmo.',
      '.ommlgmmgmllmmo.',
      '..ommllllllmmo..',
      '...ommmmmmmmo...',
      '..o.mmmmmmmmo.o.',
      '.o...mmmmmmm...o',
      'o.....mm.mm....o',
      '................',
      '................',
    ],
    eyes: [[4, 6, 2, 2], [10, 6, 2, 2]],
  },
  '石化词素': {
    body: [
      '......oooo......',
      '.....ollllo.....',
      '....ollllllmo...',
      '...ollllwwlllo..',
      '..ollllwppwlllo.',
      '..ollllwppwlllo.',
      '..ollllwwwwlllo.',
      '..omllllllllmo..',
      '...omllllllmo...',
      '...ommllllmmo...',
      '..ommmllllmmmo..',
      '.ommo.ommo.ommo.',
      '.oo...oo...oo...',
      '................',
      '................',
      '................',
    ],
    eyes: [[5, 3, 2, 4], [9, 3, 2, 4]],
  },
  '歧义章鱼': {
    body: [
      '................',
      '.....mmmmmm.....',
      '....mllllllm....',
      '...mlggllgglm...',
      '...mlgpglgpglm..',
      '...mlggllgglm...',
      '...mllllllllm...',
      '..mmllllllllmm..',
      '.mmmmmmmmmmmmmm.',
      '.mmmmmmmmmmmmmm.',
      '.mmm.mmmm.mmmm..',
      '..m..mmmm..mm...',
      '.m...mmmm...m...',
      'm....mmmm....m..',
      '.....mmmm.......',
      '................',
    ],
    eyes: [[4, 3, 2, 3], [10, 3, 2, 3]],
  },
  '拼写幽灵': {
    body: [
      '................',
      '.....mmmmmm.....',
      '....mllllllm....',
      '...mlggllgglm...',
      '...mlgpglgpglm..',
      '...mlggllgglm...',
      '...mllllllllm...',
      '..mllllllllllm..',
      '.mmllllllllllmm.',
      'mllmmllmmllmllm.',
      'llm.mmllmm.llm..',
      'mm..m.mm.m..mmm.',
      '....m..m...m....',
      '...m..m.m..m....',
      '................',
      '................',
    ],
    eyes: [[4, 3, 2, 3], [10, 3, 2, 3]],
  },
  '单复数蝎': {
    body: [
      '..............mo',
      '.............mmo',
      '............mmo.',
      '...........mmo..',
      '......mmmmmmmo..',
      '....mmllllllmo..',
      '...mlggllgglmo..',
      '..mlggpggpglmo..',
      '..mllggllggllm..',
      '...mllllllllm...',
      '....mmmmmmmm....',
      '...mm......mm...',
      '..mm........mm..',
      '..m..........m..',
      '................',
      '................',
    ],
    eyes: [[4, 6, 2, 2], [8, 6, 2, 2]],
  },
  /* 菱形冰晶 + 顶角 + 底座冰凌。网格严格 16 列对齐（上一版有错位，已重画）。 */
  '冰封词灵': {
    body: [
      '...o........o...',
      '..omo......omo..',
      '.ommmo....ommmo.',
      '.omllmmo.ommllmo',
      '.omllllmmmmllmo.',
      '..omllllllllmo..',
      '..mllllllllllm..',
      '.mlwggllllggwlm.',
      '.mlwggllllggwlm.',
      '.mllllllllllllm.',
      '.mdllllllllllm..',
      '..mmllllllllmm..',
      '...mmllllllmm...',
      '..mmm.mm.mm.mmm.',
      '................',
      '................',
    ],
    eyes: [[2, 7, 2, 2], [12, 7, 2, 2]],
  },
  '词形旋风': {
    body: [
      '.....mmmmmm.....',
      '....mllllllmo...',
      '...mlllggllmmo..',
      '..mllgppggllmo..',
      '..mlgglllllgm...',
      '..mllllggggm....',
      '.mlllllllmm.....',
      '.mlllllmm.......',
      'mmllmm..........',
      'mldm............',
      '.dm.............',
      '.mm.............',
      'dm..............',
      'm...............',
      '................',
      '................',
    ],
    eyes: [[6, 2, 2, 2], [9, 2, 2, 2]],
  },
  '词汇之王': {
    body: [
      '......m.m.m.....',
      '.....mo.o.om....',
      '....m.ooooo.m...',
      '...mo.mmmm.omo..',
      '..mmo.mmmm.ommo.',
      '..mllmmmmmmmllm.',
      '..mlggmmmggwlm..',
      '..mlggmmmggwlm..',
      '..mlggmmmggwlm..',
      '..mlllllllllllm.',
      '...mmlllllmmm...',
      '...mmllllllmm...',
      '..mmmllllllmmm..',
      '.mmmm.mmmm.mmmm.',
      '................',
      '................',
    ],
    eyes: [[3, 6, 2, 3], [11, 6, 2, 3]],
  },
};

const FALLBACK_MONSTER = '词灵';

/* 首领王冠与精英标记：像素风的小装饰，叠在精灵上方。
   坐标同样写死，不接受外部输入。 */
const ORNAMENT_BOSS = '<rect x="5" y="0" width="1" height="2" fill="#ffcf44"/>'
  + '<rect x="8" y="0" width="1" height="2" fill="#ffcf44"/>'
  + '<rect x="11" y="0" width="1" height="2" fill="#ffcf44"/>'
  + '<rect x="5" y="2" width="7" height="1" fill="#ffcf44"/>'
  + '<rect x="7" y="1" width="1" height="1" fill="#ff638c"/>';
const ORNAMENT_ELITE = '<rect x="13" y="12" width="2" height="1" fill="#ffcf44"/>'
  + '<rect x="14" y="11" width="1" height="1" fill="#ffcf44"/>';

/* ---------------- 装备图标：12×12 ---------------- */

const ICON_PALETTES = {
  leech:   { mid: '#e0413f', light: '#ff8a80', dark: '#8f1d1c' },
  rage:    { mid: '#ff7a2f', light: '#ffc46b', dark: '#b03d00' },
  freeze:  { mid: '#4fc8e8', light: '#b3ecfa', dark: '#1d7fa0' },
  chain:   { mid: '#ffd83d', light: '#fff0a8', dark: '#c79400' },
  reveal:  { mid: '#b98cff', light: '#e2ceff', dark: '#6f3fc0' },
  purge:   { mid: '#8fd94f', light: '#c8f0a0', dark: '#4d8a1e' },
  greed:   { mid: '#f0c020', light: '#ffe98a', dark: '#a87900' },
  stone:   { mid: '#9aa4ae', light: '#d2d9e0', dark: '#5c6772' },
  hint:    { mid: '#b98cff', light: '#e2ceff', dark: '#6f3fc0' },
  shield:  { mid: '#6aa9e8', light: '#b8d8f5', dark: '#2f5f96' },
  combo:   { mid: '#e05c5c', light: '#ff9d9d', dark: '#932828' },
  purse:   { mid: '#f0c020', light: '#ffe98a', dark: '#a87900' },
  thorn:   { mid: '#7fc24a', light: '#c2e8a0', dark: '#4a7a20' },
  battery: { mid: '#ffd83d', light: '#fff0a8', dark: '#a87900' },
  lucky:   { mid: '#5fd88a', light: '#b0f0c8', dark: '#2a8a52' },
  scholar: { mid: '#8a6fd4', light: '#c3b3f0', dark: '#4f3a96' },
  forge:   { mid: '#b08a5a', light: '#dcc098', dark: '#6f5433' },
  ghost:   { mid: '#cfe9f2', light: '#f0faff', dark: '#7fb0c4' },
  greedEye:{ mid: '#e07fd0', light: '#f8c2ee', dark: '#8f3d84' },
  focus:   { mid: '#ff9d5c', light: '#ffd0a8', dark: '#b35a1f' },
  prophecy:{ mid: '#c9a24a', light: '#f0dcae', dark: '#7d6224' },
};

/* 道具图标。key 与 data/items.js 的 id 一一对应。 */
const ITEM_ICONS = {
  leech: ['............', '.....mm.....', '....mllm....', '....ml.m....', '...mmllm....', '..mmllllm...', '..mlllllm...', '...mlllm....', '....mmm.....', '.....m......', '.....m......', '............'],
  rage: ['....m...m...', '...mlm.mlm..', '...mlllmlm..', '....mlllm...', '...mmllmm...', '..mmllllmm..', '..mllllllm..', '...mllllm...', '....mllm....', '....mlm.....', '....m.m.....', '............'],
  freeze: ['....mm......', '...mlmm.....', '..mlllmm....', '..mllllm....', '.mmllllmm...', '.mlwgglwm...', 'mllllggllm..', '.mmllllmm...', '..mmllmm....', '...mmmm.....', '............', '............'],
  chain: ['..m......m..', '.m.m....m.m.', '..m..mm..m..', '....mllm....', '...mmllmm...', '.mmllwwllmm.', '.mlwwllwwlm.', '..mmllwwllmm', '...mllllm...', '....mmm.....', '............', '............'],
  reveal: ['............', '...mmmm.....', '..mllllm....', '.mlwggglm...', '.mlwggglm...', '.mlllggm....', '.mllllm.....', '.mlwgglm....', '.mlwgglm....', '..mllllm....', '...mmmm.....', '............'],
  /* 扫帚（原来是个认不出的圆角框） */
  purge: ['.........m..', '........mm..', '.......m.m..', '......m..m..', '.....m...m..', '....m....m..', '...mmmmmm...', '..mmllllmm..', '...mmmmmm...', '.....mm.....', '.....m......', '............'],
  greed: ['...mmmm.....', '..mllllm....', '.mllllllm...', '.mllllllm...', '..mllllm....', '..mmllmm....', '...mllm.....', '..mllllm....', '.mllllllm...', '.mllllllm...', '..mllllm....', '...mmmm.....'],
  stone: ['............', '....mmmm....', '...mllllm...', '..mllllllm..', '..mllllllm..', '.mllllllllm.', '.mlllwwlllm.', '.mlllwwlllm.', '.mllllllllm.', '..mllllllm..', '...mmmmmm...', '............'],
};

/* 遗物图标。key 与 data/relics.js 的 id 一一对应。 */
const RELIC_ICONS = {
  hint: ['............', '.....m......', '....mlm.....', '...mllgm....', '...mlwgm....', '..mllllm....', '..mllllm....', '...mllm.....', '....mmm.....', '.....m......', '.....m......', '............'],
  shield: ['............', '...mmmmmm...', '..mllllllm..', '.mllllllllm.', '.mlllwwlllm.', '.mlllwwlllm.', '.mlllllllwm.', '..mllllllm..', '...mmllmm...', '....mmmm....', '............', '............'],
  combo: ['............', '......m.....', '.....mmm....', '....mllm....', '...mmllmm...', '..mllllllm..', '.mmllwwllmm.', 'mllllllllllm', '.mmmllwwlmmm', '....mmmm....', '............', '............'],
  purse: ['............', '....m..m....', '...mmmmmm...', '..mmllllmm..', '..mllllllm..', '.mmllllllmm.', '.mlllwwlllm.', '.mmllllllmm.', '..mmmmmmmm..', '..mm....mm..', '............', '............'],
  /* 带刺藤（原来像根树枝） */
  thorn: ['..m..m...m..', '..mlm.mlm.m.', '..mllmmllm..', '.mlllmmllmm.', '.mllllllllm.', '..mllllllm..', '..ml.mm.lm..', '.mm...m...mm', 'm.....m....m', '.....m......', '............', '............'],
  /* 电池 + 闪电缺口（原来只是根竖条） */
  battery: ['...mmm......', '..mlllm.....', '.mllllm.m...', '.mllllmm.m..', '.mllllm.m...', '.mllllmmm...', '.mllllm.m...', '.mllllm.m...', '..mlllm.....', '...mmm......', '............', '............'],
  lucky: ['.....m......', '....mmm.....', '...m.m.m....', '..mm.m.mm...', '..m.mmm.m...', '.mm.m.m.mm..', '.m..mmm..m..', '..m.mmm.m...', '.mm.m.m.mm..', '.m...m...m..', '.....m......', '............'],
  /* 翻开的书（原来是个竖条） */
  scholar: ['..m......m..', '.mmm....mmm.', '.lmm....mml.', '..lm....ml..', '..lm.mm.ml..', '..lm.mm.ml..', '..lm.mm.ml..', '..lm....ml..', '.mml....lmm.', '.mmm....mmm.', '............', '............'],
  /* 铁砧 + 锤（原来是一团乱线） */
  forge: ['............', '........m...', '.......mm...', '......mmm...', '..mmmmmmm...', '.mllllllm...', 'mllllllllm..', 'mllllllllm..', '.mmmmmmmm...', '............', '............', '............'],
  ghost: ['............', '.....mmmm...', '....mllllm..', '...mlggglm..', '...mlgpglm..', '...mlllllm..', '..mllllllm..', '.mlllmmllm..', 'mllm.mm.mllm', 'mm..m.m...mm', '..m..m..m...', '............'],
  /* 贪婪之眼：遗物 id 是 greed，与道具的 greed 同名，所以表键加 Eye 后缀区分 */
  greedEye: ['............', '...mmmm.....', '..mllllm....', '.mllllllm...', '.mlgggllm...', '.mlggggm....', '..mllllm....', '..mlgllgm...', '.mllllllm...', '.mmllllmm...', '...mmmm.....', '............'],
  /* 头环 + 中央齿轮（原来是个圆角方块） */
  focus: ['............', '..mmmmmmmm..', '.mllllllm...', '.mllllllm...', '.mllllllm...', '.mldddddlm..', '.mlggggglm..', '.mldddddlm..', '.mllllllm...', '.mmmmmmmm...', '............', '............'],
  /* 传说遗物：卷轴 */
  prophecy: ['............', '.mmmmmmmmmm.', '.mllllllllm.', '.mlmmmmmmlm.', '.mllllllllm.', '.mlmmmmmmlm.', '.mllllllllm.', '.mlmmmmmmlm.', '.mllllllllm.', '.mmmmmmmmmm.', '............', '............'],
};

/* ---------------- 渲染 ---------------- */

function cellFill(ch, pal) {
  if (ch === 'o') return INK;
  if (ch === 'm') return pal.mid;
  if (ch === 'l') return pal.light;
  if (ch === 'd') return pal.dark;
  if (ch === 'w') return WHITE;
  if (ch === 'g') return EYE_SHADE;
  if (ch === 'p') return INK;
  return null;
}

/* 字符网格 → <rect> 串。cols 取第一行的长度，行数取数组长度。 */
function gridToRects(grid, pal) {
  const cols = grid[0].length;
  let out = '';
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < cols; x++) {
      const fill = cellFill(row[x], pal);
      if (fill) out += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + fill + '"/>';
    }
  }
  return out;
}

/* 怪物精灵。`anim` 为真时输出眨眼与呼吸所需的图层结构（纯 CSS 驱动，不占 JS 定时器）。
   shape-rendering="crispEdges" 是像素风的关键：不加的话浏览器会平滑缩放，
   格子边缘糊成一片，16×16 的细节全丢。 */
export function pixelMonsterSVG(foe, boss = false, elite = false, { anim = true } = {}) {
  const supplied = foe && typeof foe.n === 'string' ? foe.n : '';
  const name = Object.prototype.hasOwnProperty.call(MONSTER_SPRITES, supplied)
    ? supplied : FALLBACK_MONSTER;
  const sprite = MONSTER_SPRITES[name];
  const pal = MONSTER_PALETTES[name];
  const isBoss = Boolean(boss) || name === '词汇之王';
  const isElite = Boolean(elite) || Boolean(foe && foe.elite);

  const body = gridToRects(sprite.body, pal);
  // 眼睑：与眼白同色，眨眼时落下盖住它们。最后一笔压一条暗边，让闭眼看得出来。
  let lids = '';
  for (const [x, y, w, h] of sprite.eyes) {
    lids += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + pal.mid + '"/>'
      + '<rect x="' + x + '" y="' + (y + h - 1) + '" width="' + w + '" height="1" fill="' + pal.dark + '"/>';
  }

  const ornaments = (isBoss ? ORNAMENT_BOSS : '') + (isElite && !isBoss ? ORNAMENT_ELITE : '');
  const cls = 'foe-cartoon' + (anim ? ' pxmon anim' : ' pxmon');
  // 关掉动画就**不输出**眼睑图层：留着它虽然被 CSS 的 scaleY(0) 藏住，
  // 但那是靠样式兜底，静态场景（图鉴、截图、打印）不该依赖它。
  const lidGroup = anim ? '<g class="pm-lid">' + lids + '</g>' : '';
  const inner = '<g class="pm-breathe"><g>' + body + '</g>'
    + lidGroup
    + (ornaments ? '<g>' + ornaments + '</g>' : '') + '</g>';

  // 首领优先：同时是首领与精英时只报「首领」，不写成「首领精英」。
  const label = name + (isBoss ? '首领' : isElite ? '精英' : '');
  // label 只由固定表键 + 固定后缀组成，不含任何外部输入。
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"'
    + ' class="' + cls + '" role="img" aria-label="' + label + '" focusable="false"'
    + ' shape-rendering="crispEdges">'
    + '<title>' + label + '</title>' + inner + '</svg>';
}

/* 装备图标。认不出的 id 返回 null —— 调用方据此回落到 ❔ 文本降级，
   **绝不**把 id 回显进标记里。 */
export function pixelIconSVG(id, { size = null } = {}) {
  const key = typeof id === 'string' ? id : '';
  const grid = Object.prototype.hasOwnProperty.call(ITEM_ICONS, key) ? ITEM_ICONS[key]
    : Object.prototype.hasOwnProperty.call(RELIC_ICONS, key) ? RELIC_ICONS[key]
    : null;
  if (!grid) return null;
  const pal = ICON_PALETTES[key];
  const dim = size ? ' width="' + size + '" height="' + size + '"' : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"'
    + ' class="pxicon"' + dim + ' shape-rendering="crispEdges" focusable="false" aria-hidden="true">'
    + gridToRects(grid, pal) + '</svg>';
}

/* 遗物 id 与图标表键的映射：只有「贪婪之眼」需要区分
   （遗物 greed 是宝石，道具 greed 是钱币，两者 id 同名但不能共用一幅图）。 */
export function relicIconKey(id) {
  return id === 'greed' ? 'greedEye' : id;
}

/* 网格形状审计，供测试调用。返回所有不合规的格子，全好时为空数组。
 *
 * ★ 为什么需要它：渲染器按**第一行的长度**决定列数，于是
 *   - 某行多写一个字符 → 多出来的部分被静默截断；
 *   - 某行少写一个字符 → 右边留一块缺口；
 *   - 误敲一个空格 → 那里凭空多一个透明格。
 *   三种都不会抛错，只会让精灵「说不上哪里不对」——
 *   这一批美术初版就是这么混进去 19 行错位的。 */
export function pixelArtAudit() {
  const issues = [];
  const check = (kind, key, grid, cols) => {
    grid.forEach((row, y) => {
      if (row.length !== cols) {
        issues.push({ kind, key, y, problem: 'length', got: row.length, want: cols });
      }
      const stray = row.match(/[^omldwpg.]/);
      if (stray) issues.push({ kind, key, y, problem: 'char', got: stray[0] });
    });
  };
  for (const [key, sprite] of Object.entries(MONSTER_SPRITES)) {
    check('monster', key, sprite.body, 16);
    if (sprite.body.length !== 16) {
      issues.push({ kind: 'monster', key, problem: 'height', got: sprite.body.length, want: 16 });
    }
    // 眼睑必须落在网格内，否则眨眼时会在精灵外面画出一个方块。
    for (const [x, y, w, h] of sprite.eyes) {
      if (x < 0 || y < 0 || x + w > 16 || y + h > 16) {
        issues.push({ kind: 'monster', key, problem: 'eye-bounds', got: [x, y, w, h].join(',') });
      }
    }
  }
  for (const [key, grid] of Object.entries(ITEM_ICONS)) check('item', key, grid, 12);
  for (const [key, grid] of Object.entries(RELIC_ICONS)) check('relic', key, grid, 12);
  return issues;
}
