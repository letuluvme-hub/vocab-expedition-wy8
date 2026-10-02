# 真实浏览器基线与回归

## 执行

在项目根目录：

```bash
"C:/Program Files/nodejs/node.exe" node_modules/@playwright/test/cli.js test --project=legacy
"C:/Program Files/nodejs/node.exe" node_modules/@playwright/test/cli.js test --project=new
"C:/Program Files/nodejs/node.exe" tests/e2e/verify-baseline.mjs
```

最后一条先跑完整旧版，再跑完整新版，随后执行两项负向突变验证；只有正常测试全部通过、突变准确失败、旧版 HTML 校验和不变，验证脚本才返回 0。

Windows 自动使用真实 Google Chrome（`CHROME_PATH` 可覆盖）；其他平台回落 Playwright Chromium，需先安装浏览器。Vite 使用当前 `process.execPath` 启动，`127.0.0.1:4173 --strictPort`。默认 `E2E_BASE_PATH=/vocab-expedition-wy8/`，可通过环境变量更改。

## 边界

- `legacy` 从未修改的 `tests/fixtures/legacy.html` 读取内容，仅在 HTTP 路由响应的最后一个内联脚本中注入闭包桥，绕开 Vite 的旧版 HTML 转换。
- `new` 访问真实 Vite 页面，不拦截页面或模块，不用测试版业务替代生产业务。
- 只有 `addInitScript` 显式设置 `__VOCAB_TEST__=true` 才启用 `__gameTest`。额外断言普通浏览器会话不暴露它。
- 固定伪随机种子、独立浏览器 context、真实 localStorage origin、`voice=false/mute=true/vol=0`。重载不会重新覆盖存档。
- 场景控制仅改变真实词库条目、战斗生命和已生成节点；按字母、购买、战斗结算、推进、存档均执行原函数/DOM。
- 17 条共享行为测试，每条新增测试先对旧版执行，再验证新版；未改生产代码或存档 fixture。

## 已验证范围

六角色、Unit 1–6/自定义词表、旧存档字段兼容及重载、真实启动地图、前期无商店/首领前补给、非相邻节点不可点、点击与键盘一致、退格及重复字母、短语分隔/归一化、半词击杀不掌握、最后字母击杀只持久化一次、QWERTY/大小写切换不丢输入、无语音降级、护盾容量几何、商店重复交易及冷却、BOSS 成功/跳过语义、纪念卡去重持久化/下一单元、最后单元隐藏下一步、320×568 与 390×844 核心控件几何/无横向溢出。

## 不能悄悄修掉的旧版事实

1. 标题没有“全册”选择按钮：真实基线只有 Unit 1–6 和“我的词表”。`rewardScope(-1)` 的“全册”兜底不等于存在可点击入口。
2. ~~`hpBarGeom` 返回 `shield`，`paintHpBar` 却用 `g.sh` 判断显示和文字~~ **已于 2026-10-02 按本文件登记的规程修复**（先补失败测试，再改代码）：`paintHpBar` 现在读 `g.shield`，护盾层按几何显示、文字带「+N盾」。修复只动显示层，`hpBarGeom` 的返回与全部几何值逐位不变（仍由单测钉住）；无护盾的用例与旧版逐像素相同，有护盾的差异由 `tests/unit/ui-modules.test.js` 的 `shows the shield layer and the +N盾 suffix` 断言正确行为。地图页与战斗页共用同一个函数，因此两条血条一起生效。
3. 无 Speech API 时“听读音”显示“不可用”/`.off`，不是 HTML disabled；点击提示不支持、不会耗提示或播放脉冲。测试遵守旧版实际语义。
4. 退格释放字母、减 `attOk`/combo，但不撤销已造成伤害和尝试次数；再答会再次造成伤害。测试没有发明伤害回滚。

## 负向验证

仅修改路由内的字符串，不写真实 fixture：

- `E2E_MUTATION=partial-mastery` 移除 `winFight` 的 `wordComplete` 门槛，半词击杀测试准确失败，收到 `mastered=["litre"]`。
- `E2E_MUTATION=duplicate-mastery` 移除 `markMastered` 去重门槛，整词最后一击测试准确失败，收到两条 `keep an eye on`。

`artifacts/verification.json` 是本次机器结果与真实 Chrome 版本/fixture SHA-256；`legacy-baseline.json/.log`、`new-regression.json/.log` 和两个 `mutation-*.json/.log` 保留各次原始输出。`results.json` 是最后一次 Playwright 调用，验证脚本结束时它对应故意失败的突变，不是完整回归汇总。

未验证 Safari/Firefox、真实手机硬件、Linux CI 实际执行、有声 TTS 音质/音色、部署后的缓存/CDN；手机结果为真实 Chrome 的窄屏视口测试。
