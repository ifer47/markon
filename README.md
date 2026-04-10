# <img src="public/icon.png" width="28" height="28" /> MarkerOn

<p align="right">
  <strong>English</strong> | <a href="./README_zh.md">中文</a>
</p>

> **Lightweight screen annotation tool** — press a hotkey to instantly draw, highlight, and annotate anywhere on your desktop. Perfect for classroom demos, meeting presentations, and screencast narration.

<p align="center">
  <img src="public/screenshot.png" width="520" alt="MarkerOn Settings Panel" />
</p>

## Download

<a href="https://get.microsoft.com/installer/download/9n6623x973jv?referrer=appbadge" target="_self" >
<img src="https://get.microsoft.com/images/zh-cn%20dark.svg" width="200"/>
</a>

| Platform | Installer | Note |
| :--- | :--- | :--- |
| Windows x64 | [MarkerOn_0.1.2_x64-setup.exe](https://github.com/ifer47/markeron/releases/download/v0.1.2/MarkerOn_0.1.2_x64-setup.exe) | NSIS installer (recommended) |
| Windows x64 | [MarkerOn_0.1.2_x64_zh-CN.msi](https://github.com/ifer47/markeron/releases/download/v0.1.2/MarkerOn_0.1.2_x64_zh-CN.msi) | MSI installer |
| macOS x64 | [MarkerOn_0.1.2_x64.dmg](https://github.com/ifer47/markeron/releases/download/v0.1.2/MarkerOn_0.1.2_x64.dmg) | Open the DMG and drag to Applications. On Apple Silicon Macs, you may need to enable **Open using Rosetta** in Get Info on first launch |

You can also visit the [Releases page](https://github.com/ifer47/markeron/releases/tag/v0.1.2) for all versions and changelogs.

## Quick Start

```bash
npm install
npm run dev
npm run build
```

After launching, the app runs silently in the **system tray** with no window shown.

## Keyboard Shortcuts

On **macOS**, use <kbd>Command</kbd> (⌘) where **Windows** uses <kbd>Ctrl</kbd> for the shortcuts below.

### Global Shortcuts

> Available system-wide, regardless of the active window:

| Action | Windows | macOS |
| :--- | :--- | :--- |
| Toggle annotation mode | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> | <kbd>Command</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> |
| Clear all annotations | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> | <kbd>Command</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> |

### Annotation Mode — Drawing

> Hold modifier keys while dragging to quickly draw different shapes:

| Draws | Windows | macOS |
| :--- | :--- | :--- |
| Current tool (default: pen) | Drag | Drag |
| Rectangle | <kbd>Ctrl</kbd> + Drag | <kbd>Command</kbd> + Drag |
| Square | <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + Drag | <kbd>Command</kbd> + <kbd>Option</kbd> + Drag |
| Ellipse | <kbd>Shift</kbd> + Drag | <kbd>Shift</kbd> + Drag |
| Circle | <kbd>Shift</kbd> + <kbd>Alt</kbd> + Drag | <kbd>Shift</kbd> + <kbd>Option</kbd> + Drag |
| Arrow | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + Drag | <kbd>Command</kbd> + <kbd>Shift</kbd> + Drag |

### Annotation Mode — Edit & Move

> Move or re-edit existing elements without switching tools:

| Action | Effect |
| :--- | :--- |
| Hover over an element and drag | **Move** the element (enable "Allow dragging existing elements" in settings) |
| Double-click existing text | Re-enter **edit mode** for that text |
| Double-click empty area in <kbd>T</kbd> mode | Create a new text input at cursor position |

### Annotation Mode — Tool Switching

> Press a number key to switch tools instantly:

| Key | Tool | Description |
| :---: | :--- | :--- |
| <kbd>1</kbd> | ∕ Pen | Freehand drawing with smooth curves |
| <kbd>2</kbd> | ∕∕ Highlighter | Semi-transparent highlight strokes |
| <kbd>3</kbd> | ⤤ Arrow | Directional arrow lines |
| <kbd>4</kbd> | ▢ Rectangle | Rectangle outlines |
| <kbd>5</kbd> | ○ Ellipse | Ellipse outlines |
| <kbd>6</kbd> | ╱ Line | Straight line segments |
| <kbd>7</kbd> | ◎ Eraser | Erase annotations in real time; erased area follows element drag |
| <kbd>T</kbd> | 𝐓 Text | Double-click to place/edit text, scroll to resize; confirm with <kbd>Ctrl</kbd> + <kbd>Enter</kbd> (Windows) or <kbd>Command</kbd> + <kbd>Return</kbd> (macOS) |

### Annotation Mode — Color Switching

> The cursor color updates in real time. A brief color name tooltip appears at the bottom after switching.

| Action | Effect |
| :--- | :--- |
| <kbd>Q</kbd> | Previous color |
| <kbd>E</kbd> | Next color |
| Right-click | Open quick color picker at cursor |

### Annotation Mode — Other Actions

| Action | Windows | macOS |
| :--- | :--- | :--- |
| Toggle settings panel (tool, color, stroke width) | <kbd>Space</kbd> | <kbd>Space</kbd> |
| Copy screen to clipboard (desktop + annotations) | <kbd>Ctrl</kbd> + <kbd>C</kbd> | <kbd>Command</kbd> + <kbd>C</kbd> |
| Undo | <kbd>Ctrl</kbd> + <kbd>Z</kbd> | <kbd>Command</kbd> + <kbd>Z</kbd> |
| Redo | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> / <kbd>Ctrl</kbd> + <kbd>Y</kbd> | <kbd>Command</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> / <kbd>Command</kbd> + <kbd>Y</kbd> |
| Clear all annotations (undo to restore) | <kbd>Delete</kbd> | <kbd>Delete</kbd> |
| Exit annotation mode | <kbd>Esc</kbd> | <kbd>Esc</kbd> |
| Switch window and exit annotation mode | <kbd>Alt</kbd> + <kbd>Tab</kbd> | <kbd>Command</kbd> + <kbd>Tab</kbd> |
| Open Start menu and exit annotation mode | <kbd>Win</kbd> | — (use Mission Control, Spotlight, or the Dock; leaving focus exits mode) |

> Annotations cover the entire screen including the taskbar area. All drawings are automatically cleared when exiting annotation mode.

### Settings

Right-click the system tray icon and select **Settings** to open the settings window.

**General**

| Option | Description |
| :--- | :--- |
| Launch at startup | Automatically start the app in the background on system boot |
| Allow dragging existing elements | Enable dragging drawn shapes and text (disabled by default to prevent accidental moves) |

**Shortcuts**

Click "Modify", then press a new key combination (must include at least one of **Ctrl** (Windows) / **Command** (macOS), **Alt** / **Option**, or **Shift**, or use F1–F12). Changes take effect immediately and are auto-saved. If a shortcut conflicts with another application, it will automatically roll back with a notification.

## Tech Stack

| Technology | Role |
| :--- | :--- |
| **Tauri v2** | Desktop framework — Rust backend, system tray, global shortcuts, transparent always-on-top window |
| **Vue 3** | Frontend UI framework |
| **Vite** | Fast bundling and HMR |
| **TypeScript** | Full type safety |
| **Canvas API** | High-performance drawing engine |

## Project Structure

```
markeron/
├── src-tauri/
│   ├── src/
│   │   └── lib.rs               # Rust backend — window management, shortcuts, tray
│   └── tauri.conf.json          # Tauri configuration
│
├── src/
│   ├── components/
│   │   ├── DrawingOverlay.vue   # Drawing overlay (Canvas + interactions)
│   │   ├── SettingsPanel.vue    # Annotation toolbar (tool / color / stroke)
│   │   ├── SettingsView.vue     # Settings window (shortcut config / sidebar layout)
│   │   └── TextBox.vue          # Inline text input
│   ├── composables/
│   │   └── useDrawing.ts        # Drawing engine (pen, shapes, text, undo/redo)
│   ├── types/
│   │   └── app.d.ts             # TypeScript type declarations
│   ├── App.vue                  # Root component
│   ├── main.ts                  # Renderer entry point
│   └── style.css                # Global styles
│
├── index.html                   # HTML entry
├── vite.config.ts               # Vite configuration
└── package.json
```

## License

[MIT](./LICENSE)
