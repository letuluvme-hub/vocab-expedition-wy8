import { durationText, reportText } from '../../domain/daily-learning.js';

// This view displays injected learning facts and delegates clipboard capability.
export function createDailyReportView({ host, getReport, copy = () => Promise.reject(new Error('Clipboard unavailable')),
  document: doc = globalThis.document } = {}) {
  let date = null, revision = 0;
  host.classList.add('daily-report');
  const root = doc.createElement('div'); root.className = 'daily-report-body'; host.append(root);
  const element = (tag, text, id) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (id) el.id = id; return el; };
  function paint() {
    const report = getReport(), current = ++revision; date = report.date;
    root.replaceChildren();
    root.append(element('h3', '今日记录'), element('p', report.date, 'dailyReportDate'));
    const facts = element('div'); facts.className = 'daily-report-facts';
    facts.append(element('p', `练习时长：${durationText(report.activeMs)}`, 'dailyReportDuration'),
      element('p', `练习词数：${report.practicedWords}`, 'dailyReportWords'));
    // 预习没有正式默写；一次拼对率只在当天还有旧默写记录时显示。
    if (report.formalAttempts) facts.append(element('p', `一次拼对率：${report.firstTryRate}%（${report.firstTry}/${report.formalAttempts}）`, 'dailyReportRate'));
    root.append(facts);
    const note = element('p', report.formalAttempts ? '词数当天去重，含预习；正确率按正式默写统计，包含已出错或使用帮助的中断尝试。' : '词数当天去重，含预习；预习里用了提示的词列在下面。'); note.className = 'daily-report-note'; root.append(note);
    const wrong = element('div', undefined, 'dailyReportWrong'); wrong.append(element('p', '今日错词／辅助词'));
    const list = element('ul'); for (const word of report.wrongWords) list.append(element('li', `${word.w} · ${word.z}`));
    wrong.append(report.wrongWords.length ? list : element('p', '无')); root.append(wrong);
    if (report.archive?.days) {
      const archived = element('p', `更早汇总：${report.archive.days}个练习日，${report.archive.practicedWords}词次，${durationText(report.archive.activeMs)}；正式一次拼对 ${report.archive.firstTry}/${report.archive.formalAttempts}。`, 'dailyReportArchive');
      archived.className = 'daily-report-note'; root.append(archived);
    }
    const button = element('button', '复制今日记录', 'dailyReportCopy'); button.type = 'button';
    const status = element('p', '', 'dailyReportCopyStatus'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const fallback = element('textarea', undefined, 'dailyReportFallback'); fallback.readOnly = true; fallback.hidden = true; fallback.rows = 9; fallback.setAttribute('aria-label', '可手动复制的今日记录');
    button.addEventListener('click', async () => {
      const text = reportText(report); button.disabled = true; status.textContent = '正在复制…';
      try { await copy(text); if (current === revision) status.textContent = '已复制'; }
      catch { if (current === revision) { status.textContent = '请在下方选中文本，手动复制'; fallback.value = text; fallback.hidden = false; fallback.focus(); fallback.select(); } }
      finally { if (current === revision) button.disabled = false; }
    });
    root.append(button, status, fallback);
  }
  return { paint, updateDate: () => { if (getReport().date !== date) paint(); } };
}
