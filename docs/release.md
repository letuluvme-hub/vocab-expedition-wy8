# 上线与回滚

## 验证及发布

- 源码在 main，GitHub Actions `.github/workflows/deploy.yml` 验证完整 `npm run check` 后才上传 dist 并发布。
- Pages 构建方式须为 GitHub Actions (`build_type=workflow`)；不能再使用 main 根目录的 legacy 发布。
- 网址保持 `https://letuluvme-hub.github.io/vocab-expedition-wy8/`，存档键保持 `wy8a_rogue_v1`。
- 新版本修改 `public/version.json`，构建自动注入版本及旧HTML兼容标记。
- 每次发布确认 exact merge commit、workflow success、version.json、入口及每项asset的字节数/hash，并通过公共网址真实浏览器试玩。
- 必须在部署完成后执行 `npm run verify:public -- https://letuluvme-hub.github.io/vocab-expedition-wy8/`，确认旧存档保留、自定义词完成、无调试探针和手机无溢出；该脚本使用隔离浏览器，不改用户真实浏览器存档。公网验收不通过不得报告上线成功。
- 公网验收前须在 exact 发布提交上构建 `dist`。脚本对比该构建中每个文件（含入口、JS/CSS、离线单文件和 APK 下载）的线上字节数与 SHA-256；版本文件独自相同不能证明发布物一致。
- 公网试玩分别使用 320px／390px 隔离浏览器：旧 `mastered` 保留为练习记录且不追认掌握；完成热身、提示后拼完、无提示拼完及「今日完成」，真实回读日报剪贴板，刷新后再次核对掌握和日报。伙伴／图鉴及完整键盘的布局也必须通过。先读 [发布准备记录](daily-dictation-release-readiness.md)，再决定是否合并和上线。
- `dist/vocab-expedition-standalone.html` 是离线下载物，不是源代码；不得直接编辑。

## 首次迁移回滚

首次上线前给旧 main 创建 `pre-modular-release` 标签，保留旧单文件页面。如果出现阻断玩法的回归：

1. 用 Actions 的已验证旧构建 artifact重新发布，或在main提交明确revert并通过完整检查。
2. 若必须回到单文件老版本：先读取标签的原 index.html，通过独立 rollback 分支/PR 恢复，再将 Pages source 明确设置为 main 根目录 legacy，并读回设置和线上内容确认。
3. 不强推 main，不删用户存档，不从未知的桌面单文件“恢复”。
4. 保留失败构建与错误日志；验证回滚后的public字节/hash及真实浏览器，不只看workflow绿灯。

自动发布具有浏览器缓存延迟；不要把版本不一致直接归因于CDN或并发写入。先对照正在访问的URL、exact发布commit和对应资源。
