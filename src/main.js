/* 全局错误兜底（VE-17）。
 *
 * 审计发现：src/ 下没有任何 window.onerror / unhandledrejection 监听。后果是
 * 任一渲染 / 战斗 / 事件路径抛异常就白屏，而且控制台之外拿不到任何现场 ——
 * 玩家看到"游戏坏了"，我们只看到 CI 是绿的（因为那条路径没被测到）。
 *
 * 覆盖范围要说准确：ES module 的 import 会被**提升**，所以本文件的函数体
 * （含下面这一句）在**所有被 import 的模块求值完之后**才执行。
 *   ✓ 覆盖 startGame() 及其之后发生的一切 —— 也就是全部游戏逻辑。
 *   ✗ 不覆盖"某个模块在求值阶段就抛异常"（例如数据文件语法错误）。
 *     那种情况属于构建/部署事故，由 tests/release/smoke.spec.js 的
 *     「页面能启动」断言兜住，不靠这一层。
 *
 * 这一层刻意做得很薄（详见 services/error-guard.js 的边界说明）：
 * 捕获 → 记录 → 提示；绝不吞掉、绝不自动刷新、绝不碰存档。
 */
import { installGlobalErrorGuard } from './services/error-guard.js';
import { startGame } from './app/runtime.js';

installGlobalErrorGuard();

startGame();
