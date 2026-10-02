/* 新增样式表时唯一要登记的地方。
 *
 * 动机（VE-12，本次踩过）：`tests/unit/styles.test.js` 的 ADDED 与
 * `tests/unit/extraction.test.js` 的 ADDED_CSS 曾经是**两份独立副本**。
 * 加一张 error-guard.css 时只登记了一处，另一处就把新表算进
 * "原始七张"，于是那条"与 legacy 逐字节相同"的比对**恒假** ——
 * 而报错是一整屏 CSS 文本，根本看不出真实原因，排查花了几分钟。
 *
 * 两处各自需要的东西不一样，所以这里分开导出，但**清单只有这一份**：
 *   - ADDED_CSS  ：只要文件路径（extraction.test.js 用它做过滤与尾部顺序断言）
 *   - ADDED      ：路径 + 允许的选择器前缀 + 一句中文标签
 *                  （styles.test.js 用它逐条核对"新增表只作用于自己的容器"）
 *
 * 新增样式表的完整步骤见 AGENTS.md「新增样式表时」一节。
 */

/** 归档冻结的七张：顺序与 tests/fixtures/legacy.html 逐字节比对，一张不许动。 */
export const ORIGINAL_CSS = [
  './base.css', './map.css', './combat.css', './hero.css',
  './controls.css', './cards.css', './responsive.css',
];

/**
 * 新增样式表清单。**顺序即层叠顺序**（越晚越靠后），且全部排在 ORIGINAL_CSS 之后。
 *
 * prefix 的约定与各自的坑（都写在 styles.test.js 的核对逻辑里）：
 *   - 多数用**宿主容器 id**（#s-pause / #audioSettings …）。id 权重天然压过既有
 *     选择器，且不会漏到别处。
 *   - 自有类名的那几张**不带 \b**：类名形如 .foeAtkBar / .comboMsPip，
 *     加 \b 会把它们全判成越界，逼着那条断言放宽成"什么都不许写"。
 *   - streak-feedback 那张额外允许自己的 @keyframes 与 0%/from/to ——
 *     关键帧不是选择器，是全局命名的动画定义，改由"名字不许与归档重名"把关。
 */
export const ADDED = [
  ['./pause.css', /^#s-pause\b|^#continueRow\b/, '暂停屏'],
  ['./learning-complete.css', /^#s-learning-complete\b/, '词汇完成页'],
  ['./audio-settings.css', /^#audioSettings\b/, '主页声音设置区'],
  ['./equipment-panel.css', /^\.equip\b/, '战斗页装备面板'],
  ['./audio-compatibility.css', /^#audioCompatibility\b/, '音频兼容提示条'],
  ['./mastery-growth.css', /^#masteryGrowth\b/, '知识成长区'],
  // 蓄力条（清单 13）。容器挂在战斗页敌人信息块里，所以 .foeAtk* 被 #fFoeAtk 的
  // 后代规则约束。前缀不带 \b：.foeAtkBar / .foeAtkTxt 会被 \b 判成越界。
  ['./foe-attacks.css', /^\.foeAtk/, '战斗页蓄力条'],
  ['./streak-feedback.css', /^\.streak-toast\b|^@keyframes streak-toast-|^\d+%$|^from$|^to$/, '完整词连胜播报'],
  ['./combo-milestones.css', /^\.comboMs/, '战斗页战意条'],
  ['./relic-depth.css', /^\.rlc|^\.rl-rar/, '遗物图鉴稀有度与组合技'],
  ['./pixel-art.css', /^\.pxmon|^\.pxicon/, '像素风怪物与装备图标'],
  ['./keyboard-tip.css', /^#keyboardTip/, '主页一次性键盘提示'],
  ['./foe-avatar.css', /^#fAv/, '敌人头像尺寸与外壳'],
  ['./error-guard.css', /^#errbar\b/, '全局错误提示条'],
  // 安卓 APK 下载入口（上游 2bb108a 新增）。前缀是宿主 id #dlAndroid —— <a> 当按钮用
  // 要补的几条居中/去下划线，不能写进冻结的 base.css。
  // ★ 这一条原先进两份副本（styles.test.js 的 ADDED + extraction.test.js 的 ADDED_CSS），
  //   合并到本文件时必须**同时**补上，否则 game.css 里的导入序列与清单不一致，
  //   css-manifest.test.js 会红（这正是 VE-12 存在的意义）。
  ['./android-download.css', /^#dlAndroid/, '主页安卓版下载入口'],
];

/** 只要路径那一维（extraction.test.js 用）。顺序与 ADDED 完全一致。 */
export const ADDED_CSS = ADDED.map(([path]) => path);
