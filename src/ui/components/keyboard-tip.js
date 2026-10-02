/* 首次进入的一次性提示：建议用电脑键盘玩。
 *
 * 为什么需要它：这个游戏的输入是「按字母拼词」，在电脑键盘上比在手机字母盘上
 * 快得多，而且顺带练打字。但界面本身没有任何地方说明这一点 —— 新玩家用手机
 * 点字母盘点得很累，也不知道还有更顺手的玩法。
 *
 * 契约：
 *  1) **只出现一次**。看过并关掉之后写进存档（DB.keyboardTipSeen），
 *     此后永远不再出现 —— 一次性提示重复弹出来就是骚扰。
 *  2) **可关闭**，且关闭按钮是主动作而不是角落里的小叉：这是说明，不是通告。
 *  3) **纯只读展示**。挂载在主页文档流里（index.html 的 #keyboardTipHost），
 *     绝不浮动、绝不压住战斗页或字母盘。
 *  4) 认不出存档字段（旧档缺这个键）时按「还没看过」处理，让老玩家也看到一次；
 *     这不是数据损坏，initializeDB 会给出默认值。
 *  5) 老存档字段兼容由 storage 的 initializeDB 负责，本模块只读 isSeen()。
 */

export const KEYBOARD_TIP_ID = 'keyboardTip';

export function createKeyboardTip({ isSeen, onDismiss, document: doc = globalThis.document } = {}) {
  let host = null;
  let el = null;

  function build() {
    el = doc.createElement('div');
    el.id = KEYBOARD_TIP_ID;
    el.className = 'ktip';

    const body = doc.createElement('div');
    body.className = 'ktip-body';

    const h = doc.createElement('b');
    h.className = 'ktip-t';
    h.textContent = '💡 建议用电脑键盘玩';
    body.appendChild(h);

    // 全部 textContent：这里没有外部输入，但保持与其它提示组件同一习惯。
    const p1 = doc.createElement('span');
    p1.textContent = '接上键盘按字母拼词比点手机字母盘快得多，还能顺带练打字。手机上也一样能玩，只是慢一些。';
    body.appendChild(p1);

    const p2 = doc.createElement('span');
    p2.className = 'ktip-sub';
    p2.textContent = '想换回手机字母盘？战斗中随时点「键盘布局」切换。';
    body.appendChild(p2);

    const btn = doc.createElement('button');
    btn.className = 'btn ktip-ok';
    btn.id = 'keyboardTipOk';
    btn.textContent = '知道了';
    btn.onclick = () => {
      // 先写状态再收起来：写失败（无存储）也要能关掉，不能把用户困在这张卡上。
      try { onDismiss && onDismiss(); } catch (e) { /* 存储不可用不该挡住关闭 */ }
      host.textContent = '';
    };

    el.appendChild(body);
    el.appendChild(btn);
    return el;
  }

  function mount(node) { host = node || null; }

  function paint() {
    if (!host) return null;
    host.textContent = '';
    if (isSeen && isSeen()) return null;   // 看过就不再出现
    host.appendChild(build());
    return host;
  }

  return { mount, paint };
}
