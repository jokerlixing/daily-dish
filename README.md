# Daily Dish · 吃啥呢

A responsive, dependency-free Chinese recipe picker for desktop and mobile.

[在线使用 / Live demo](https://jokerlixing.github.io/daily-dish/) · [GitHub 仓库](https://github.com/jokerlixing/daily-dish)

适配电脑和手机的随机菜单网页。收录 **168 道菜谱**：八大菜系各 15 道、家常菜 8 道、地方小吃 40 道，每道都有食材用量、分步做法和烹饪提示。

## 使用

- 一次随机 **1、2、3、4、5、6、7、8、9、10 道菜**；点击菜单中的菜名查看完整做法，可收藏整桌菜单。
- **全菜系随机**覆盖八大菜系和家常菜，排除小吃分类及地方菜系中标为小吃的配方；“随便都行”包含小吃。
- 菜系、不吃辣、素菜、时长、菜名和食材搜索可以组合使用。
- 同一桌不重复；候选不足时显示实际数量，不重复凑数。
- 输入冰箱里的食材，区分“主料已齐”和“还缺食材”，支持番茄/西红柿等常见别名。
- 可选择是否默认有常用调料和葱姜蒜；特色酱料、肉汤、米面不会自动忽略。
- 使用真实食物照片，逐图提供来源、作者和许可；同类菜参考图明确标注。
- 收藏、最近 20 道历史、冰箱食材保存在当前浏览器。不同设备之间不会自动同步。
- 食材和制作步骤可勾选，切换本桌菜品时保留进度；支持键盘、减少动画和打印菜谱。

菜谱是 2 人份的家常简化做法，多道组合可适当减少每道份量。冰箱匹配核对食材名称，不判断库存数量；“主料已齐”后仍需核对实际用量。“素菜”无肉鱼，可含蛋奶。菜谱参考见 `data/sources-*.md`，摄影信息见 `data/photo-credits.md` 和 `data/photos.json`。

168 道菜均已配图，共 145 张独立实拍。78 道菜名匹配，90 道使用明确注明差别的同类、主材或做法参考；照片不代表本页配方的实测成品。

## 本地打开

下载完整项目后，双击根目录 `index.html`。**请保留同级 `assets/photos/` 文件夹**，照片也可离线使用。样式、交互代码和菜谱数据内置于 HTML，不依赖远程脚本、字体或 AI 接口。

也可以安装 Node.js 后在项目目录运行：

```sh
npm start
```

浏览器打开 `http://localhost:4173`。同一 Wi-Fi 下，手机可访问终端显示的局域网地址，电脑需保持预览服务运行。

## 开发

没有第三方 npm 运行依赖，无需 `npm install`。

```sh
npm run build
npm test
npm start
```

- `src/template.html`、`src/styles.css`、`src/app.js`：页面结构、样式、交互。
- `src/core.js`：筛选、随机菜单、食材规范化与冰箱匹配。
- `data/cuisines-*.json`、`data/snacks.json`、`data/expanded.json`：菜谱。
- `data/photos.json`、`assets/photos/`：逐菜照片元数据与本地图片。
- `scripts/build.mjs`：生成 `index.html`。修改源码或数据后重新构建。
- `scripts/core.test.mjs`：数据完整性、随机边界、筛选、冰箱匹配测试。
- `scripts/photos.test.mjs`：逐菜照片覆盖、图片文件、来源信息与构建一致性检查。
- `scripts/browser-check.cjs`：Playwright 浏览器检查；支持 `PLAYWRIGHT_MODULE`、`BROWSER_EXE`、`TEST_URL` 环境变量。
- `scripts/layout-check.cjs`：12 种屏幕宽度下的按钮遮挡、真实点击位置和九道菜回归检查。

`npm start` 只用于本地预览。生产部署为静态文件，可使用 GitHub Pages 的 `main` 分支根目录发布。照片路径均为相对路径，支持仓库子路径。

## 许可

项目原创代码和原创菜谱文字采用 MIT 许可。**第三方摄影不适用本项目 MIT 许可**，各自保留 `data/photos.json` 列出的授权与署名；重新发布时请同时保留逐图说明。
