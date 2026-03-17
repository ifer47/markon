# 绘制性能优化

## 性能瓶颈分析

原来的 `draw()` 函数在**每次 mousemove 事件**都执行 `redrawAll()`，即清空整个画布后重绘**所有历史操作**。随着历史记录增多，快速绘制时性能急剧下降。

## 四项优化措施

### 1. 离屏缓存画布（最大提升）

- 新增一个不可见的 `cacheCanvas`，用于缓存所有已完成的绘制操作
- 实时绘制时只需 `drawImage` 复制缓存位图（GPU 加速，极快）+ 绘制当前笔画
- 笔画完成时增量更新缓存，无需全量重建
- 仅在 undo/redo/删除 等操作时才重建缓存

### 2. requestAnimationFrame 批处理

- 用 `scheduleRender()` 替代直接渲染，确保每帧最多渲染一次（~60fps）
- 多个 mousemove 事件之间的点照常收集，但只在下一帧统一绘制
- 关键操作（endDraw、undo 等）使用 `flushRender()` 立即渲染

### 3. 最小距离过滤

- 自由绘制工具（画笔/荧光笔/橡皮擦）跳过距离 < 2px 的冗余点
- 减少路径点数量，降低 `quadraticCurveTo` 调用次数

### 4. Pointer Events + getCoalescedEvents

- 从 `mousedown/mousemove/mouseup` 切换到 `pointerdown/pointermove/pointerup`
- 利用 `getCoalescedEvents()` 获取浏览器合并的中间输入点，提升线条平滑度
- 添加 `touch-action: none` 防止触摸干扰
