/* 「远征故事」屏：开场、切片漫画、九人档案、怪物图鉴。
 * 只画不改状态：内容全部来自 data/story.js，形象复用已有的角色 / 怪物 / 墨芽像素画。
 * 文字一律走 textContent；只有固定表生成的 SVG / 角色部件走 innerHTML。 */
import { HEROES } from '../../data/heroes.js';
import { ENEMIES, BOSS } from '../../data/enemies.js';
import { STORY_INTRO, STORY_DISCLAIMER, COMICS, HERO_LORE, FOE_LORE } from '../../data/story.js';
import { pcHTML } from '../components/hero.js';
import { pixelMonsterSVG } from '../components/pixel-art.js';
import { partnerArt } from '../components/daily-collection.js';

export function createStoryScreen({ document: doc = globalThis.document, host } = {}) {
  const el = (tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const foeByName = n => n === BOSS.n ? BOSS : ENEMIES.find(e => e.n === n);

  function actor(c) {
    const box = el('div', 'st-actor');
    if (c.hero) { box.classList.add('st-hero'); box.innerHTML = pcHTML(c.hero); }
    else if (c.boss) { box.classList.add('st-foe', 'st-boss'); box.innerHTML = pixelMonsterSVG(BOSS, true, false, { anim: false }); }
    else if (c.foe) { box.classList.add('st-foe'); box.innerHTML = pixelMonsterSVG(foeByName(c.foe) || { n: c.foe }, false, false, { anim: false }); }
    else if (c.sprout) { box.classList.add('st-sprout'); box.append(partnerArt(doc, 1, null)); }
    return box;
  }

  function panel(p, i) {
    const box = el('div', 'st-panel');
    box.dataset.scene = p.scene;
    box.append(el('span', 'st-no', String(i + 1)));
    const talk = el('div', 'st-talk');
    for (const line of p.lines) {
      if (line.who === 'narr') { talk.append(el('p', 'st-narr', line.text)); continue; }
      const b = el('p', 'st-bubble');
      b.append(el('b', '', line.who), doc.createTextNode(line.text));
      talk.append(b);
    }
    const cast = el('div', 'st-cast');
    for (const c of p.cast) cast.append(actor(c));
    box.append(talk, cast);
    return box;
  }

  function heroFile(H) {
    const lore = HERO_LORE[H.id];
    const card = el('details', 'st-file');
    card.id = 'lore-' + H.id;
    const sum = el('summary', 'st-file-head');
    const face = el('div', 'st-face'); face.innerHTML = pcHTML(H.id);
    const who = el('div', 'st-who');
    who.append(el('b', '', lore.name), el('span', 'st-class', H.n + ' · ' + H.tag), el('span', 'st-role', lore.role));
    sum.append(face, who);
    const body = el('div', 'st-file-body');
    body.append(el('p', 'st-tagline', lore.tagline), el('p', '', lore.story));
    const dl = el('dl', 'st-facts');
    for (const [k, v] of [['口头禅', lore.motto], ['人设标签', lore.meme], ['技能由来', lore.why]]) dl.append(el('dt', '', k), el('dd', '', v));
    body.append(dl);
    card.append(sum, body);
    return card;
  }

  function render() {
    host.replaceChildren();
    const intro = el('section', 'st-intro');
    intro.append(el('h2', 'st-h', '序章 · 默写本发光了'));
    for (const t of STORY_INTRO) intro.append(el('p', '', t));
    host.append(intro);

    for (const strip of COMICS) {
      const sec = el('section', 'st-strip');
      sec.id = 'comic-' + strip.id;
      sec.append(el('h2', 'st-h', strip.title));
      const grid = el('div', 'st-grid');
      strip.panels.forEach((p, i) => grid.append(panel(p, i)));
      sec.append(grid);
      host.append(sec);
    }

    const files = el('section', 'st-files');
    files.append(el('h2', 'st-h', '远征者档案'), el('p', 'st-note', '点开每个人看看 TA 的故事。'));
    for (const H of HEROES) if (HERO_LORE[H.id]) files.append(heroFile(H));
    host.append(files);

    const foes = el('section', 'st-foes');
    foes.append(el('h2', 'st-h', '词汇之境图鉴'));
    for (const f of [...ENEMIES, BOSS]) {
      const row = el('div', 'st-foe-row');
      const art = el('div', 'st-foe-art'); art.innerHTML = pixelMonsterSVG(f, f === BOSS, false, { anim: false });
      const txt = el('p'); txt.append(el('b', '', f.n), doc.createTextNode(FOE_LORE[f.n] || ''));
      row.append(art, txt);
      foes.append(row);
    }
    host.append(foes);
    host.append(el('p', 'st-disclaimer', STORY_DISCLAIMER));
  }

  /* 打开某个角色的档案并滚过去；不传就停在顶部。 */
  function focusHero(id) {
    const card = id && host.querySelector('#lore-' + id);
    if (!card) return false;
    card.open = true;
    if (card.scrollIntoView) card.scrollIntoView({ block: 'start' });
    return true;
  }

  return { render, focusHero };
}
