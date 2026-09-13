# 美食天下照片接入

此文件保留早期图片助手接入调查。后续已使用用户指定的 `web-image-downloader` skill，通过可访问的来源补齐 888 道菜品照片；当前状态见 [2.1.0 更新记录](catalog-888-status.md)，以下素材交接事项已由该流程完成。

用户已明确表示有美食天下网站的转载授权，并允许本项目使用。待取得素材后，保留原站菜谱页链接和原作者署名；第三方照片不适用本项目 MIT 许可。

本次已检查 [ImageAssistant 官方网站](https://www.pullywood.com/ImageAssistant/) 和 [Chrome 应用商店](https://chromewebstore.google.com/detail/imageassistant-batch-imag/dbjbempljhcmhlfpfacalomonjpalpko?hl=zh)。当前会话未提供该扩展的调用工具，也未连接可操作的 Chrome/Edge，因此没有使用扩展下载任何图片。

可继续接入的素材形式：

- 授权方提供的可访问图片包下载链接或官方素材接口。
- 使用图片助手导出的本地图片目录或压缩包，附菜名、对应原站页面、作者信息。告诉当前任务保存路径即可继续处理。

取得素材后的处理：按菜名对应、人工核对图文、选择清晰成品图、压缩成本地图片、写入 `data/photos.json`，更新逐图来源说明；运行照片覆盖检查和浏览器检查后完成 GitHub 同步及部署。

完整菜名清单在 `data/catalog-expanded.json` 与其余四个食谱 JSON 中。`node scripts/photo-release-check.mjs` 会输出待补及待替换清单到 `artifacts/888/photo-release-report.json`。
