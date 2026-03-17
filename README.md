# <img src="public/icon.png" width="28" height="28" /> ZoomIt Annotator

> **轻量级屏幕标注工具** — 按下快捷键，随时在桌面上自由绘画、标注。适用于课堂演示 / 会议讲解 / 录屏批注。

<p align="center">
  <img src="public/screenshot.png" width="520" alt="ZoomIt Annotator 设置面板" />
</p>

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
| <kbd>Shift</kbd> + 拖动 | 椭圆 |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + 拖动 | 箭头 |

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
| <kbd>8</kbd> | 𝐓 文字 | 点击放置文字，滚轮调整字号，<kbd>Ctrl</kbd> + <kbd>Enter</kbd> 确认 |

### 标注模式 — 其他操作

| 快捷键 | 功能 |
| :--- | :--- |
| <kbd>Space</kbd> | 呼出 / 隐藏设置面板（工具、颜色、线宽） |
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> | 撤销 |
| <kbd>Ctrl</kbd> + <kbd>Y</kbd> | 重做 |
| <kbd>Delete</kbd> | 清除全部标注 |
| <kbd>Esc</kbd> | 退出标注模式 |

> 💡 退出标注模式时会自动清除所有绘制内容。

## 🛠️ 技术栈

| 技术 | 用途 |
| :--- | :--- |
| **Electron** | 桌面应用框架 — 全局快捷键、透明置顶窗口、系统托盘 |
| **Vue3** | 渲染层 UI 框架 |
| **Vite** | 极速构建与热更新 |
| **TypeScript** | 完整类型支持 |
| **Canvas API** | 高性能绘图引擎 |

## 📁 项目结构

```
zoomit/
├── electron/
│   ├── main/index.ts            # 主进程 — 窗口管理、快捷键、托盘
│   └── preload/index.ts         # 预加载 — IPC 通信桥接
│
├── src/
│   ├── components/
│   │   ├── DrawingOverlay.vue   # 绘图覆盖层（Canvas + 交互）
│   │   ├── SettingsPanel.vue    # 设置面板（工具 / 颜色 / 线宽）
│   │   ├── TextBox.vue          # 内联文字输入框
│   │   └── Icons.vue            # SVG 图标组件
│   ├── composables/
│   │   └── useDrawing.ts        # 绘图引擎（画笔、形状、文字、撤销重做）
│   ├── types/
│   │   └── electron.d.ts        # TypeScript 类型声明
│   ├── App.vue                  # 根组件
│   ├── main.ts                  # 渲染进程入口
│   └── style.css                # 全局样式
│
├── index.html                   # HTML 入口
├── vite.config.ts               # Vite 配置
├── electron-builder.json5       # 打包配置
└── package.json
```

## 📄 许可证

[MIT](./LICENSE)
