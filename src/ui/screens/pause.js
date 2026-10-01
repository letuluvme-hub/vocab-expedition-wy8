/* 暂停屏：只画与只交回调，不碰任何游戏状态。
 *
 * 暂停的**冻结**行为不在这里 —— 那是 src/app/progress.js 闸门的职责。
 * 本模块的契约是：玩家按下三个动作时，父层各自收到一次明确的回调；
 * 屏幕如实显示「存上了」还是「只在这一页有效」，绝不谎称保存成功。
 */
export function createPauseScreen({ getRun, onResume, onHome, onAbandon } = {}) {
  const $ = id => document.getElementById(id);
  const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  const setClass = (id, cls) => { const el = $(id); if (el) el.className = cls; };

  function renderPause({ saved = true, reason = null, fromReload = false } = {}) {
    const run = getRun ? getRun() : null;
    setText('pzTitle', '已暂停');
    const where = run
      ? 'Unit ' + run.unit + ' · 第 ' + run.floor + ' 层 · ' + run.gold + ' 金币'
      : '';
    const where2 = run ? ' · 生命 ' + run.hp + '/' + run.maxhp : '';
    const why = fromReload ? '你切到后台时自动暂停了。' : '';
    // ★ 「返回主页」不再是放弃：不加这句，玩家会以为回家就等于丢进度。
    const homeHint = '返回主页不会放弃这次远征，随时可以再继续。';
    const how = saved
      ? '进度已保存，刷新或关掉页面后可以从主页继续。'
      : '这次进度没存上，关闭页面就会丢失，本次进度只在这一页有效。';
    setText('pzText', [why, where + where2, how, homeHint].filter(Boolean).join(' '));
    setClass('pzText', 'pztext' + (saved ? '' : ' warn'));
    setText('pzSave', saved ? '已保存到本机' : '没能保存进度');
    setClass('pzSave', 'pzsave' + (saved ? ' ok' : ' warn'));

    const resume = $('pzResume'), home = $('pzHome'), abandon = $('pzAbandon');
    if (resume) {
      resume.textContent = '继续远征';
      resume.onclick = () => { if (onResume) onResume(); };
    }
    if (home) {
      home.textContent = '返回主页';
      home.title = '保留这次远征并回到主页（不丢弃进度）';
      home.onclick = () => { if (onHome) onHome(); };
    }
    if (abandon) {
      abandon.textContent = '放弃这次远征';
      abandon.onclick = () => { if (onAbandon) onAbandon(); };
    }
    return { saved, reason, fromReload };
  }

  return { renderPause };
}
