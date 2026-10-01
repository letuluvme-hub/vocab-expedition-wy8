# 架构与迁移边界

## 第一阶段的目标

将单文件发布物与开发源码分离；建立自动回归和可独立开发的边界。保留现有玩法、图形、存档和静态部署能力。基线是 `docs/baseline.json` 中的远端提交，而非旧桌面副本。

```text
main -> app/runtime
runtime -> data + domain + services + ui/components
speech/audio -> injected callbacks + platform APIs
storage -> injected Storage-like object
version -> injected fetch + announcement callback
domain -> explicit parameters / pure math
```

## 已抽取与尚未抽取

- `src/data/books/wy8a/unit-*.json`：教材数据；`words.js` 只聚合。
- `src/data/*.js`：角色、敌人、道具、遗物、单元和台词。
- `src/domain/*`：显式 run/battle/db 参数；不能直接访问 DOM 或浏览器存储。
- `src/services/storage.js`：兼容原 key 和字段；未在结构提取中引入 schemaVersion 迁移。
- `src/services/speech.js`：注入音色配置、台词、当前角色和偏好回调；运行时不读全局 DB/G/B。
- `src/services/audio.js`：注入 getCombo；不注册 DOM 交互事件，由 runtime 调用。
- `src/services/version.js`：读取小清单，失败静默；提示条渲染仍在 runtime。
- `src/ui/components/monster-art.js`：可信静态 SVG，不插入未知怪物名或颜色。
- `src/styles/game.css`：首次完整搬出，精确保留规则顺序，尚未按屏拆 CSS。
- `src/app/runtime.js`：**过渡协调层**。状态仍为闭包 DB/G/B；地图、抽词、战斗转移、奖励、页面渲染和视觉效果尚未完全解耦。

## 兼容和安全

- 网站源码通过 HTTP/HTTPS 运行；构建另导出自包含 HTML 供 file:// 离线使用。
- Vite 资源 hash 负责资源缓存，version.json 用于更新提示。构建 HTML 注释保留旧客户端 verParse 能识别的版本桥接。
- 更新只提示，不自动刷新正在进行的战斗；没有网络仍可玩。
- DEV-only 测试探针仅在测试预置标记时出现，生产编译必须完全移除。
- 现有字符串模板/innerHTML 不在本阶段整体重写。怪物 SVG 和输入释义的关键路径分别保持可信常量和 textContent；未来改模板必须单独测试输入安全。
- 当前不支持远征跨刷新恢复；DB 才是持久存档，G.done 的 Set 留在内存。

## 下一阶段顺序

1. 提取 title、fight、map、reward 渲染器与 view model，每次做一屏。
2. 抽取字母盘/抽词策略与可注入随机数，进行固定 seed 对照。
3. 抽取战斗 action -> state/effects；整词、末击和荆棘统一结算。
4. 抽取远征与奖励事务，替代回调直接改状态。
5. 增加旧延迟任务取消/代号，退出和新远征不受旧 setTimeout 影响。
6. 稳定契约后渐进引入 TypeScript，多教材 ID 与间隔复习另立功能任务。

第一次迁移不要同时改变伤害、学会判据、教学策略和存档格式。后续并行任务使用独立 worktree，所有共享接口由整合者串行处理。
