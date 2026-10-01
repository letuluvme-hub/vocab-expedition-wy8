export const foeArtHTML = (() => {
  'use strict';
  const ink = '#24152f';
  const eye = (x, y, pupilColor = '#5d2a88') =>
    `<ellipse cx="${x}" cy="${y}" rx="10.5" ry="13" fill="#fffdf4" stroke-width="3"/><ellipse cx="${x + 1.5}" cy="${y + 1}" rx="5" ry="7" fill="${pupilColor}" stroke="none"/><circle cx="${x}" cy="${y - 2}" r="2.3" fill="#ffffff" stroke="none"/>`;
  // 所有参数均为下方作者定义的常量，不读取用户可控颜色或坐标。
  const face = (y = 51, color = '#5d2a88', mood = 'smirk') =>
    `<g>${eye(38, y, color)}${eye(62, y, color)}<path d="M27 ${y - 13} L46 ${y - 8} M54 ${y - 8} L73 ${y - 13}" fill="none" stroke-width="4.5"/><ellipse cx="25" cy="${y + 13}" rx="4.5" ry="2.4" fill="#ff91b0" stroke="none"/><ellipse cx="75" cy="${y + 13}" rx="4.5" ry="2.4" fill="#ff91b0" stroke="none"/>${mood === 'pout'
      ? `<path d="M42 ${y + 23} Q50 ${y + 17} 58 ${y + 23}" fill="none" stroke-width="3.5"/>`
      : `<path d="M39 ${y + 19} Q51 ${y + 28} 63 ${y + 16} Q55 ${y + 30} 43 ${y + 26} Z" fill="#fffdf4" stroke-width="3"/>`}</g>`;
  const shadow = '<ellipse cx="50" cy="91" rx="29" ry="4" fill="#24152f" opacity=".16" stroke="none"/>';
  const crown = '<g data-ornament="boss"><path d="M34 22 L30 8 L42 15 L50 5 L58 15 L70 8 L66 22 Z" fill="#ffcf44" stroke-width="3.5"/><path d="M35 22 H65" fill="none" stroke-width="4"/><path d="M50 12 L54 17 L50 21 L46 17 Z" fill="#ff638c" stroke-width="2"/></g>';
  const eliteMark = '<g data-ornament="elite"><path d="M85 20 L88 25 L94 26 L90 31 L90 37 L85 34 L80 37 L80 31 L76 26 L82 25 Z" fill="#ffcf44" stroke-width="2.5"/><path d="M7 73 L13 69 L18 73 L13 82 Z" fill="#ff638c" stroke-width="2.5"/></g>';
  const designs = new Map([
    ['词灵', {
      body: '<path d="M34 32 Q27 21 22 22 M66 32 Q73 21 78 22" fill="none" stroke-width="5"/><circle cx="21" cy="20" r="6" fill="#ffe36d"/><circle cx="79" cy="20" r="6" fill="#ffe36d"/><path d="M25 53 Q11 49 12 62 Q13 69 26 65 M75 53 Q89 49 88 62 Q87 69 74 65" fill="#9872f8"/><path d="M30 75 L28 88 Q35 94 43 86 M70 75 L72 88 Q65 94 57 86" fill="#7450cb"/><path d="M50 27 C24 27 20 43 24 65 Q25 84 50 85 Q75 84 76 65 C80 43 76 27 50 27 Z" fill="#a67dff"/><path d="M31 35 Q39 29 46 32" fill="none" stroke="#d9c4ff" stroke-width="4"/>',
      face: face(51)
    }],
    ['语素蛛', {
      body: '<g fill="none" stroke-width="5"><path d="M29 45 L17 33 L7 37 M26 52 L12 47 L6 54 M27 62 L12 65 L7 75 M32 71 L21 80 L20 90 M71 45 L83 33 L93 37 M74 52 L88 47 L94 54 M73 62 L88 65 L93 75 M68 71 L79 80 L80 90"/></g><ellipse cx="50" cy="36" rx="22" ry="13" fill="#e55d90"/><path d="M34 29 L40 25 M60 25 L66 29" fill="none" stroke="#ffb6cf" stroke-width="3"/><ellipse cx="50" cy="60" rx="29" ry="27" fill="#ff779c"/><path d="M45 80 L50 74 L55 80" fill="none" stroke="#b62b65" stroke-width="3"/>',
      face: face(55, '#ba2f62')
    }],
    ['石化词素', {
      body: '<path d="M25 57 L14 58 L10 77 L24 81 L32 70 M75 57 L86 58 L90 77 L76 81 L68 70" fill="#87939d"/><path d="M32 77 L29 90 L44 90 L47 79 M68 77 L71 90 L56 90 L53 79" fill="#697681"/><path d="M30 29 L62 25 L79 39 L78 73 L64 84 L31 82 L21 64 L22 40 Z" fill="#adb9c3"/><path d="M30 29 L38 38 L22 40 M62 25 L58 35 L70 37 L79 39 M31 82 L37 71 L30 67 M78 73 L66 70" fill="none" stroke="#586475" stroke-width="3"/><path d="M38 31 L49 29" fill="none" stroke="#e2eaf0" stroke-width="4"/>',
      face: face(51, '#435667', 'pout')
    }],
    ['歧义章鱼', {
      body: '<g fill="none" stroke="#24152f" stroke-width="12"><path d="M30 65 Q10 62 9 74 Q8 83 16 78 M33 74 Q15 74 20 86 Q24 94 29 85 M40 76 Q28 86 35 90 Q41 94 43 86 M46 77 Q42 95 48 93 M54 77 Q58 95 52 93 M60 76 Q72 86 65 90 Q59 94 57 86 M67 74 Q85 74 80 86 Q76 94 71 85 M70 65 Q90 62 91 74 Q92 83 84 78"/></g><g fill="none" stroke="#b669ef" stroke-width="6"><path d="M30 65 Q10 62 9 74 Q8 83 16 78 M33 74 Q15 74 20 86 Q24 94 29 85 M40 76 Q28 86 35 90 Q41 94 43 86 M46 77 Q42 95 48 93 M54 77 Q58 95 52 93 M60 76 Q72 86 65 90 Q59 94 57 86 M67 74 Q85 74 80 86 Q76 94 71 85 M70 65 Q90 62 91 74 Q92 83 84 78"/></g><path d="M50 26 C23 26 20 45 23 61 Q25 80 50 80 Q75 80 77 61 C80 45 77 26 50 26 Z" fill="#cb8cf6"/><circle cx="28" cy="77" r="2" fill="#ffb4d7" stroke="none"/><circle cx="72" cy="77" r="2" fill="#ffb4d7" stroke="none"/>',
      face: face(49, '#823eae')
    }],
    ['拼写幽灵', {
      body: '<path d="M27 51 Q11 43 13 58 L24 69 M73 51 Q89 43 87 58 L76 69" fill="#c3e8f1"/><path d="M50 27 C28 27 22 43 23 63 L20 87 Q29 83 34 89 Q42 82 50 90 Q58 82 66 89 Q71 83 80 87 L77 63 C78 43 72 27 50 27 Z" fill="#def7f3"/><path d="M31 34 Q38 30 43 32" fill="none" stroke="#ffffff" stroke-width="4"/><path d="M27 78 Q33 82 38 79 M63 79 Q69 82 74 78" fill="none" stroke="#8ebfcf" stroke-width="3"/>',
      face: face(52, '#466ba0')
    }],
    ['单复数蝎', {
      body: '<path d="M71 68 C96 70 94 37 83 27 Q74 19 80 14" fill="none" stroke-width="13"/><path d="M71 68 C96 70 94 37 83 27 Q74 19 80 14" fill="none" stroke="#ffc052" stroke-width="7"/><path d="M80 10 L89 14 L79 23 L75 16 Z" fill="#ff7956" stroke-width="3"/><path d="M27 68 L18 76 L20 83 M32 76 L28 88 M65 76 L69 88 M70 68 L78 78" fill="none" stroke-width="4"/><path d="M24 55 L12 52 L7 39 L14 33 L18 42 L25 35 L29 42 L24 55 M69 57 L80 51 L82 41 L76 35 L74 44 L67 39 L64 46 Z" fill="#ffb344"/><path d="M26 41 Q46 26 65 39 L73 55 L70 71 Q63 84 47 83 Q29 84 23 69 Z" fill="#ffd064"/><path d="M38 82 L48 89 L58 82" fill="#e99339"/>',
      face: '<g transform="translate(-2 0)">' + face(53, '#a45a27', 'pout') + '</g>'
    }],
    ['冰封词灵', {
      body: '<path d="M23 52 L8 43 L12 62 L24 68 M77 52 L92 43 L88 62 L76 68" fill="#6fe5ec"/><path d="M29 76 L27 90 L42 86 M71 76 L73 90 L58 86" fill="#29b4d2"/><path d="M28 31 L48 25 L71 29 L81 51 L74 78 L51 87 L26 78 L19 52 Z" fill="#8deef5"/><path d="M28 31 L36 40 L48 25 M71 29 L66 39 L81 51 M26 78 L34 69 M74 78 L66 70" fill="none" stroke="#36b8d2" stroke-width="3"/><path d="M27 40 L24 49 M48 30 L56 29" fill="none" stroke="#ffffff" stroke-width="4"/><path d="M48 80 H56 M52 76 V84" fill="none" stroke="#ffffff" stroke-width="2.5"/>',
      face: face(52, '#177f9f', 'pout')
    }],
    ['词形旋风', {
      body: '<path d="M22 29 Q7 29 9 39 Q12 46 24 42 M78 31 Q94 26 93 38 Q92 45 82 44" fill="none" stroke="#a6afff" stroke-width="4"/><path d="M22 32 Q50 24 78 32 Q88 38 79 49 L69 64 L63 78 L50 91 L46 78 L34 67 L24 51 Q13 42 22 32 Z" fill="#abb4ff"/><path d="M20 39 Q48 32 80 38 M26 67 Q46 75 68 67 M35 77 Q51 84 62 76 M46 88 Q54 88 60 83" fill="none" stroke="#685acc" stroke-width="3.5"/><path d="M7 66 H19 M81 60 H94 M11 76 H22" fill="none" stroke="#c7d2ff" stroke-width="3"/>',
      face: face(49, '#5948b2')
    }],
    ['词汇之王', {
      body: '<path d="M27 40 L16 81 L33 86 L50 80 L67 86 L84 81 L73 40 Z" fill="#c64c85"/><path d="M22 79 L30 72 M78 79 L70 72" fill="none" stroke="#f184ae" stroke-width="3"/><path d="M29 76 L28 90 L43 90 L47 78 M71 76 L72 90 L57 90 L53 78" fill="#ffbc4b"/><path d="M77 62 L88 65" fill="none" stroke="#ffca54" stroke-width="7"/><path d="M89 43 V83" fill="none" stroke="#ffca54" stroke-width="4"/><path d="M89 34 L95 42 L89 50 L83 42 Z" fill="#7ce7ca" stroke-width="3"/><path d="M26 31 Q39 26 50 31 Q61 26 74 31 L75 77 Q60 73 50 79 Q40 73 25 77 Z" fill="#ffe092"/><path d="M50 31 V79" fill="none" stroke="#d39d46" stroke-width="3"/><path d="M29 33 V72 M71 33 V72" fill="none" stroke="#fff4cd" stroke-width="3"/><path d="M33 82 L50 86 L67 82" fill="none" stroke="#ffcf44" stroke-width="3"/>',
      face: face(51, '#ad6136')
    }]
  ]);
  return function foeArtHTML(foe, boss = false, elite = false) {
    const suppliedName = foe && typeof foe.n === 'string' ? foe.n : '';
    const name = designs.has(suppliedName) ? suppliedName : '词灵';
    const art = designs.get(name);
    const isBoss = Boolean(boss) || name === '词汇之王';
    const isElite = Boolean(elite) || Boolean(foe && foe.elite);
    // name 只取 Map 的固定键；不能使用 suppliedName、foe.ic 或 foe.tint 插入 HTML。
    const label = name + (isBoss ? '首领' : '') + (isElite ? '精英' : '');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="foe-cartoon" role="img" aria-label="${label}" focusable="false"><title>${label}</title><g stroke="${ink}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${shadow}${art.body}${art.face}${isBoss ? crown : ''}${isElite ? eliteMark : ''}</g></svg>`;
  };
})();
