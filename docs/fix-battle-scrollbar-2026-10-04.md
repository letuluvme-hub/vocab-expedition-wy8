# 战斗详情滚动条配色修复

基线 main df55411c9b74d937620701eb64335621465670ab，版本 2026.10.04-battle-scrollbar-1。

常驻战况布局将单词、道具和装备放在独立 fmid 滚动区。原规则仅指定 scrollbar-width:thin，桌面系统绘制了与深色战斗画面不相符的白色轨道与箭头。现在标准滚动条使用半透明暗紫滑块、透明轨道；WebKit 回退宽度 6px、圆角滑块、不显示箭头。窄屏或粗指针设备隐藏滚动条，保留 overflow-y:auto；高对比模式沿用系统配色。

仅修改 src/styles/battle-stage.css 的 #s-fight 容器规则、新增 tests/e2e/battle-scrollbar.spec.js、更新 public/version.json 和本记录。七张冻结 CSS、样式导入顺序、词库、战斗数值和存档均不变。

先写四项浏览器失败回归：1122×1064 桌面配色，以及 390×844 / 320×568 / 844×390 触屏隐藏。修改后用真实鼠标滚轮与 CDP touchStart/touchMove/touchEnd 验证 scrollTop 增加，再滚至装备末项，检查双方血条、头像与暂停在屏内、无横向溢出、真实点击暂停。测试每次从滚动区顶部开始，不依赖点击装备 summary 自动带来的滚动。关键变异将 overflow-y:auto 改为 hidden，鼠标滚轮行为断言失败；恢复后再跑绿。

完整 check:data / npm test / build / test:build / test:e2e / test:release 与安卓语音桩的退出码和准确数量在本 PR 登记。合并前复核 main 与 CI，发布后对照所有发布文件的 SHA-256 和字节数，并通过公开页面验证滚动、战况和暂停。生产页面不启用调试桥。

浏览器自动化使用 Chromium，触屏为浏览器模拟，未进行 Windows 原生滚动条、安卓/iPhone 真机或 Firefox/Safari 实机验证。
