# <img src="public/icon.png" width="28" height="28" /> MarkOn

> **轻量级屏幕标注工具** — 按下快捷键，随时在桌面上自由绘画、标注。适用于课堂演示 / 会议讲解 / 录屏批注。

<p align="center">
  <img src="public/screenshot.png" width="520" alt="MarkOn 设置面板" />
</p>

## 📥 下载安装

> 无需安装开发环境，直接下载安装包即可使用。

| 平台 | 安装包 | 说明 |
| :--- | :--- | :--- |
| Windows x64 | [MarkOn_0.0.4_x64-setup.exe](https://github.com/ifer47/markon/releases/download/v0.0.4/MarkOn_0.0.4_x64-setup.exe) | NSIS 安装程序（推荐） |
| Windows x64 | [MarkOn_0.0.4_x64_en-US.msi](https://github.com/ifer47/markon/releases/download/v0.0.4/MarkOn_0.0.4_x64_en-US.msi) | MSI 安装程序 |

也可以前往 [Releases 页面](https://github.com/ifer47/markon/releases/tag/v0.0.4) 查看所有版本及更新日志。

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式
npm run dev

# 打包构建（生成安装包）
npm run build
```

启动后应用静默运行在 **系统托盘**，不会弹出任何窗口。

## ⌨️ 快捷键一览

### 全局快捷键

> 以下快捷键在任何界面下都可使用：

| 快捷键 | 功能 |
| :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> | 开启 / 退出标注模式 |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> | 清除所有标注 |

### 标注模式 — 绘制

> 进入标注模式后，通过修饰键 + 鼠标拖动快速绘制不同图形：

| 操作 | 绘制内容 |
| :--- | :--- |
| 直接拖动鼠标 | 当前工具（默认画笔） |
| <kbd>Ctrl</kbd> + 拖动 | 矩形 |
| <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + 拖动 | 正方形 |
| <kbd>Shift</kbd> + 拖动 | 椭圆 |
| <kbd>Shift</kbd> + <kbd>Alt</kbd> + 拖动 | 正圆 |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + 拖动 | 箭头 |

### 标注模式 — 编辑与移动

> 绘制完成后，无需切换工具即可直接移动或重新编辑已有元素：

| 操作 | 功能 |
| :--- | :--- |
| 鼠标悬停在已有元素上并拖动 | **移动**该元素（支持所有形状、线条和文字） |
| 双击已有文字 | 重新进入该文字的**编辑模式** |
| <kbd>T</kbd> 模式下双击空白处 | 在光标位置新建文字输入框 |

### 标注模式 — 工具切换

> 按数字键即时切换，无需打开面板：

| 按键 | 工具 | 说明 |
| :---: | :--- | :--- |
| <kbd>1</kbd> | ∕ 画笔 | 自由绘画，平滑曲线 |
| <kbd>2</kbd> | ∕∕ 荧光笔 | 半透明高亮标记 |
| <kbd>3</kbd> | ⤤ 箭头 | 带箭头的指示线 |
| <kbd>4</kbd> | ▢ 矩形 | 矩形边框 |
| <kbd>5</kbd> | ○ 椭圆 | 椭圆边框 |
| <kbd>6</kbd> | ╱ 直线 | 直线段 |
| <kbd>7</kbd> | ◎ 橡皮擦 | 擦除标注内容 |
| <kbd>T</kbd> | 𝐓 文字 | 双击放置/编辑文字，滚轮调整字号，<kbd>Ctrl</kbd> + <kbd>Enter</kbd> 确认 |

### 标注模式 — 颜色切换

> 彩色光标实时显示当前画笔颜色，切换颜色后底部会短暂提示颜色名称。

| 操作 | 功能 |
| :--- | :--- |
| <kbd>Q</kbd> | 切换到上一个颜色 |
| <kbd>E</kbd> | 切换到下一个颜色 |
| 鼠标右键 | 在光标处弹出快速选色盘（支持 <kbd>Q</kbd> / <kbd>E</kbd> 切换） |

### 标注模式 — 其他操作

| 快捷键 | 功能 |
| :--- | :--- |
| <kbd>Space</kbd> | 呼出 / 隐藏设置面板（工具、颜色、线宽） |
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> | 撤销 |
| <kbd>Ctrl</kbd> + <kbd>Y</kbd> | 重做 |
| <kbd>Delete</kbd> | 清除全部标注 |
| <kbd>Esc</kbd> | 退出标注模式 |
| <kbd>Alt</kbd> + <kbd>Tab</kbd> | 切换窗口并退出标注模式 |
| <kbd>Win</kbd> | 打开开始菜单并退出标注模式 |

> 💡 标注覆盖全屏（包括任务栏区域），退出标注模式时会自动清除所有绘制内容。

### 设置窗口

右键点击系统托盘图标 → **设置**，即可打开设置窗口。目前支持自定义全局快捷键，后续版本将扩展更多设置项。

快捷键修改流程：点击「修改」→ 按下新的组合键 → 点击「保存」。若新快捷键与其他应用冲突，会自动回滚并提示。

## 🛠️ 技术栈

| 技术 | 用途 |
| :--- | :--- |
| **Tauri v2** | 桌面应用框架 — Rust 后端、系统托盘、全局快捷键、透明置顶窗口 |
| **Vue 3** | 渲染层 UI 框架 |
| **Vite** | 极速构建与热更新 |
| **TypeScript** | 完整类型支持 |
| **Canvas API** | 高性能绘图引擎 |

## 📁 项目结构

```
markon/
├── src-tauri/
│   ├── src/
│   │   └── lib.rs               # Rust 后端 — 窗口管理、快捷键、托盘
│   └── tauri.conf.json          # Tauri 配置文件
│
├── src/
│   ├── components/
│   │   ├── DrawingOverlay.vue   # 绘图覆盖层（Canvas + 交互）
│   │   ├── SettingsPanel.vue    # 标注模式工具面板（工具 / 颜色 / 线宽）
│   │   ├── SettingsView.vue     # 设置窗口（快捷键配置 / 侧边栏布局）
│   │   └── TextBox.vue          # 内联文字输入框
│   ├── composables/
│   │   └── useDrawing.ts        # 绘图引擎（画笔、形状、文字、撤销重做）
│   ├── types/
│   │   └── app.d.ts             # TypeScript 类型声明
│   ├── App.vue                  # 根组件
│   ├── main.ts                  # 渲染进程入口
│   └── style.css                # 全局样式
│
├── index.html                   # HTML 入口
├── vite.config.ts               # Vite 配置
└── package.json
```

## 📄 许可证

[MIT](./LICENSE)
