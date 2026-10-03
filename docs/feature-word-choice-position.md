# 选词位置记忆

三张候选词卡会继承玩家上一次主动选择的位置：左、中或右。换词、下一场战斗、暂停刷新后均沿用；临时只剩一两张卡时使用最靠近的可用位置，不覆盖原偏好。没有偏好的旧存档继续使用正常抽到的词。

偏好写在既有 DB 的 `wordChoiceIndex`，存档 key 不变。点击当前已经选中的卡也能记住该位置，但不重置输入或提示。锁词规则、抽词池、伤害预估和学习判定不变。

改动文件：`src/domain/word-choice.js`、`src/app/runtime.js`、`src/ui/components/word-offer.js`、`tests/unit/word-choice-position.test.js`、`tests/e2e/word-choice.spec.js` 及本文。

先失败后实现：新单测 3 失败，浏览器三个位置均因未保存偏好失败；修复后针对性浏览器 3 通过。让位置选择退回原抽词的变异使单测 2 失败/1 通过（退出 1），随后恢复源码。

基于 `main@166f507` 的完整验收：

| 命令 | 结果 | 退出码 |
| --- | --- | ---: |
| `npm run check:data` | 259 词 | 0 |
| `npm test` | 1210 通过 / 0 失败 | 0 |
| `npm run build` | 网站与离线 HTML 成功 | 0 |
| `npm run test:build` | 3 通过 / 0 失败 | 0 |
| `npm run test:e2e` | 298 通过 / 0 失败 / 262 目标跳过 | 0 |
| `npm run test:release` | 6 通过 / 0 失败 | 0 |

本地浏览器使用仅修改端口与输出目录的临时配置，端口 4296/4298、2 workers。未进行 iOS/安卓真机体验验证。七张冻结样式表、词库和存档 key 保持不变。
