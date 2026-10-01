/* 进度快照的持久化适配层。
 *
 * 唯一写入入口 commit(db, envelope)：把 activeRun 挂到 db 上，然后**一次**
 * storage.save(db) 同时落盘学习记录与快照。
 * 拆成两次写就会出现「奖励已记、快照还停在上一帧」的窗口 —— 刷新后用旧快照
 * 恢复会把已经发过的金币/遗物/纪念卡再发一遍。这里用一次写把窗口关死。
 *
 * 降级分三种，都不抛错、都不假装成功：
 *   unavailable —— 根本没有 localStorage（隐私模式 / 被 CSP 挡）
 *   failed      —— 写入抛异常（配额满、file:// 下被拒）
 *   none        —— 读出来不是合法 JSON（老存档被手改）
 * 玩法在这三种情况下都必须照常可玩，只是明确告诉玩家「这次没存上」。
 */
import { decodeSnapshot } from '../domain/run-snapshot.js';

export const ACTIVE_RUN_KEY = 'activeRun';

export function createProgressStore(storage) {
  function readDB() {
    try {
      return storage.load();
    } catch {
      return null;
    }
  }
  // 「这台设备根本没有存储」与「这次写失败了」必须能区分：
  // 前者是隐私模式/被 CSP 挡，提示语完全不同，后者才可能是配额满。
  const noStore = () => storage.available === false;
  const peekSafe = raw => {
    try {
      return decodeSnapshot(raw);
    } catch {
      return { ok: false, reason: 'invalid' };
    }
  };
  const api = {
    // 读存档里的快照并解码。永远不抛错，也永不写回。
    // 双保险：decodeSnapshot 自己已兜底，这里再包一层 —— 存档是外部输入，
    // peek 的调用点在主页加载路径上，冒泡就等于整页白屏。原文保持不动。
    peek() {
      const db = readDB();
      if (!db || typeof db !== 'object') return { ok: false, reason: 'none' };
      const raw = db[ACTIVE_RUN_KEY];
      if (raw === undefined || raw === null) return { ok: false, reason: 'none' };
      return peekSafe(raw);
    },

    // 只读地看一眼存档原文：主页要靠它区分「没有快照」与「有但解不开的快照」。
    // 绝不写回 —— 损坏的存档必须原样留给玩家确认。
    rawDB() { return readDB(); },

    // 学习 DB + 快照的**唯一**提交点。envelope 由 domain/run-snapshot 产出。
    //
    // envelope === null 是**合法输入**，不是错误：encodeSnapshot 在 run.result
    // 已是布尔（endRun 跑过）时返回 null，此时这一局不该再有快照。这里转成一次
    // clear —— 只写一次盘，与普通 commit 同样的原子性。
    commit(db, envelope) {
      if (!db || typeof db !== 'object') return { ok: false, reason: 'failed' };
      if (envelope === null || envelope === undefined) return api.clear(db);
      // ★ 写入前自检：存一份自己都解不开的信封，等于「有快照但恢复不了」，
      //   而且旧的那份好存档已被覆盖，玩家连回退都没有。拒绝时必须是 no-op：
      //   不改内存 DB、不碰磁盘。
      const check = peekSafe(envelope);
      if (!check.ok) return { ok: false, reason: check.reason === 'version' ? 'version' : 'invalid' };
      const previous = db[ACTIVE_RUN_KEY];
      db[ACTIVE_RUN_KEY] = envelope;
      let ok = false;
      try {
        ok = storage.save(db);
      } catch {
        ok = false;
      }
      if (!ok) {
        // 写失败时把内存里的 db 恢复原样：宁可这一帧没有快照，
        // 也不能让「内存里有一份、磁盘上没有」的状态被后续逻辑当成已保存。
        if (previous === undefined) delete db[ACTIVE_RUN_KEY];
        else db[ACTIVE_RUN_KEY] = previous;
        return { ok: false, reason: noStore() ? 'unavailable' : 'failed' };
      }
      return { ok: true };
    },

    // 真正结束/放弃/清档时删掉快照。幂等：本来没有也算成功。
    clear(db) {
      if (!db || typeof db !== 'object') return { ok: false, reason: 'failed' };
      const had = db[ACTIVE_RUN_KEY];
      delete db[ACTIVE_RUN_KEY];
      let ok = false;
      try {
        ok = storage.save(db);
      } catch {
        ok = false;
      }
      if (!ok) {
        if (had !== undefined) db[ACTIVE_RUN_KEY] = had;
        return { ok: false, reason: 'failed' };
      }
      return { ok: true };
    },
  };
  return api;
}
