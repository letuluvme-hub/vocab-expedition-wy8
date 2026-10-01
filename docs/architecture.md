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
- `src/styles/game.css`：按base/map/combat/hero/controls/cards/responsive导入，原始规则与覆盖顺序精确对照。
- `src/ui/screens/{title,map,fight,over}.js`：读取显式getters，点击交回动作；共享角色、血条、纪念卡与词组槽位组件。
- `src/ui/effects.js`：Canvas、飘字和角色/终结动画，显式初始化。
- `src/app/{combat,encounters}.js`：战斗输入、伤害反馈与事件/商店/奖励流程，通过state getters和ports协作；奖励只兑现一次。
- `src/domain/{map,word-selection,letter-bank,run}.js`：地图、抽词、字母盘与远征结转规则，无DOM/存储。
- `src/app/lifecycle.js`：run/battle epoch归属与旧延迟回调取消；`pause()/resume()` 按剩余时间冻结与续跑在途任务。
- `src/domain/run-snapshot.js`：版本化进度快照的纯编解码（含校验与拒绝面）。Set↔数组、节点 nodeID↔身份引用都在这里闭合；不碰 DOM/存储。
- `src/services/progress.js`：快照与学习 DB 的**唯一**提交点（同一次 `save`），并区分「无存储 / 写失败 / 读损坏」。
- `src/app/progress.js`：暂停闸门 + 快照采集 + 恢复检查点重建。所有会改状态的入口都必须经过它。
- `src/ui/screens/pause.js`：暂停屏只画与只交回调，冻结行为不在这层。
- `src/app/runtime.js`：启动、状态唯一所有权、浏览器事件、音频入口及模块装配；不再包含大段屏幕渲染或重复战斗控制器实现。

## 兼容和安全

- 网站源码通过 HTTP/HTTPS 运行；构建另导出自包含 HTML 供 file:// 离线使用。
- Vite 资源 hash 负责资源缓存，version.json 用于更新提示。构建 HTML 注释保留旧客户端 verParse 能识别的版本桥接。
- 更新只提示，不自动刷新正在进行的战斗；没有网络仍可玩。
- DEV-only 测试探针仅在测试预置标记时出现，生产编译必须完全移除。
- 现有字符串模板/innerHTML 不在本阶段整体重写。怪物 SVG 和输入释义的关键路径分别保持可信常量和 textContent；未来改模板必须单独测试输入安全。
- 当前支持远征跨刷新恢复：`wy8a_rogue_v1` 的 `activeRun` 存版本化快照（`schemaVersion: 1`），G.done 的 Set 落盘成数组、地图节点 links 落盘成 nodeID 并在恢复时重新接回同一批对象。恢复不是新建：不加次数、不重跑遗物初始化、不重复发奖。损坏或版本不支持的快照 fail closed 并保留存档原文。详见 `docs/feature-pause.md`。

## 后续产品演进

页面、地图/抽词、战斗与奖励控制器、远征结转和生命周期边界已提取。**暂停快照（清单 5）已实施**：`domain/run-snapshot` 纯编解码、`services/progress` 单次提交、`app/progress` 暂停闸门与恢复检查点，见 `docs/feature-pause.md`。当前仍保留原地状态与旧调用顺序，不宣称所有函数纯化或玩法状态机已重新设计。后续攻击状态机、轮次主线和角色平衡按 `docs/product-backlog.md` 逐项实施，每功能独立Agent、先失败测试、整合者独立验收；共享状态协议串行变更。暂停闸门与 `lifecycle.pause()` 是清单 13（蓄力攻击）应当复用的冻结基础设施。稳定后可渐进TypeScript，多教材ID与教学策略另立任务。

上线与回滚见 `docs/release.md`，结构重构不同时调整伤害、学会判据和存档格式。
