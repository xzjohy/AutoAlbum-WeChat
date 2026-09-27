# AutoAlbum-WeChat

面向 **TLSR8359F512 + SSD1683 + 400×300 黑/白/红三色电子墨水屏** 的微信小程序控制端。

小程序负责手机端图片选择、400×300 三色量化/抖动、BLE framebuffer 传输、4 槽离线相册管理、自动轮播设置以及屏幕故障恢复。设备端负责保存 framebuffer、驱动 SSD1683 和断开手机后的离线轮播。

> 微信小程序源码统一位于 `miniprogram/` 目录。仓库根目录只作为项目入口，保留微信开发者工具配置和项目文档。

## 目录结构

```text
AutoAlbum-WeChat/
├─ README.md
├─ project.config.json          # 微信开发者工具配置，miniprogramRoot=miniprogram/
└─ miniprogram/                 # 微信小程序全部源码
   ├─ app.js                    # 小程序入口
   ├─ app.json                  # 页面、窗口和 TabBar
   ├─ app.wxss                  # 全局样式
   ├─ sitemap.json              # 索引配置
   ├─ config/
   │  └─ ble.js                 # BLE UUID、写入方式、400×300/BWR 参数
   ├─ services/
   │  ├─ ble.js                 # 扫描、连接、Notify、写入、连接状态和耗时日志
   │  ├─ protocol.js            # token/status、CRC、framebuffer 上传、紧急复位传输
   │  ├─ control.js             # Flash Slot、轮播、屏幕复位高级命令
   │  └─ sync.js                # 转换→上传→CRC→Flash 保存顺序同步
   ├─ utils/
   │  ├─ image.js               # BWR 转换、RED 保护、Floyd/Atkinson/阈值处理
   │  └─ logger.js              # 运行日志
   └─ pages/
      ├─ album/                 # 四槽相册、预览、显示、同步、轮播、抖动设置
      ├─ device/                # BLE 扫描/连接/断开、READY 状态、重置屏幕
      └─ logs/                  # 日志查看
```

## 功能

### BLE 连接
支持扫描、连接、断开和 Notify。连接过程按“停止扫描 → 建立 BLE → 初始化 Notify → READY”分阶段显示，并记录连接耗时；同时防止重复点击并兼容 Adapter already-open 情况。

- Service：`13187B10-EBA9-A3BA-044E-83D3217D9A38`
- Characteristic：`4B646063-6264-F3A7-8941-E65356EA82FE`

### SSD1683 三色图片
手机端直接生成固件使用的 400×300 framebuffer：

- BLACK plane：15000 bytes
- RED plane：15000 bytes
- 合计：30000 bytes
- BLACK：`0=黑`、`1=背景`
- RED：`1=红色墨水`

支持 Floyd–Steinberg、Atkinson、无抖动阈值模式、RED 独立保护、蛇形误差扩散、红色/黑色阈值调整和三色预览。

### BLE/EPD 命令

| 命令 | 作用 |
| --- | --- |
| `0x00` | 开始 framebuffer 上传 |
| `0x03` | 分块发送 BLACK/RED plane |
| `0x08` | CRC-16/CCITT-FALSE 双图层校验 |
| `0x01` | framebuffer 刷新到屏幕 |
| `0x09` | 保存 framebuffer 到 Flash Slot |
| `0x0A` | 删除 Flash Slot |
| `0x0B` | 设置离线自动轮播 |
| `0x0C` | FORCE_EPD_RESET 强制恢复屏幕 |

CRC 字段使用大端序；轮播 interval 使用 LE16。

### 四槽离线相册
设备固定提供 4 个槽位。UI Slot 1～4 对应固件 Slot 0～3。支持选择/替换图片、三色预览、上传并显示、保存 Flash、删除设备槽位。

“一键同步到设备”的顺序为：

```text
图片转换 → BLACK/RED 上传 → CRC 校验 → Flash 保存 → 下一张
```

### 离线轮播
可开启/关闭轮播并设置 1～1440 分钟间隔。图片保存到设备 Flash 后，微信小程序断开 BLE 不影响设备自主轮播。

### 重置屏幕
设备页提供“重置屏幕”，用于 SSD1683 BUSY 异常、刷新超时、传输中断或状态机卡在 PREPARING/REFRESHING。

`0x0C FORCE_EPD_RESET` 是紧急恢复通道：小程序可中止旧 command waiter；配套固件在普通 pending/status/epd_update_state BUSY 判断之前处理它。

恢复只针对 EPD 控制链：

```text
取消图片上传
→ 清除 pending command
→ 清除 EPD 软件 BUSY
→ 终止旧时钟刷新状态
→ SSD1683 POWER OFF
→ RESET
→ 重新初始化控制接口
→ DONE / READY
```

它**不会擦除 Flash、不会删除 4 张离线图片、不会修改轮播设置、不会 MCU reboot，也不会主动清屏**。电子墨水屏掉电保持当前物理画面。

## 主要文件职责

| 文件 | 作用 |
| --- | --- |
| `project.config.json` | 微信开发者工具入口配置 |
| `miniprogram/app.js` | 应用启动入口 |
| `miniprogram/app.json` | 页面路由、窗口、TabBar |
| `miniprogram/app.wxss` | 全局 UI 样式 |
| `miniprogram/config/ble.js` | BLE UUID、写入类型、屏幕参数 |
| `miniprogram/services/ble.js` | BLE Adapter、扫描、连接、Notify、Write |
| `miniprogram/services/protocol.js` | EPD 数据协议、状态确认、CRC、紧急复位 |
| `miniprogram/services/control.js` | Slot、轮播、Reset 控制封装 |
| `miniprogram/services/sync.js` | 多 Slot 顺序同步 |
| `miniprogram/utils/image.js` | 400×300 BWR framebuffer 生成 |
| `miniprogram/utils/logger.js` | 日志记录 |
| `miniprogram/pages/album/*` | 相册主界面和图片操作 |
| `miniprogram/pages/device/*` | BLE 设备管理和屏幕复位 |
| `miniprogram/pages/logs/*` | 日志界面 |

## 导入微信开发者工具

1. Clone/下载本仓库。
2. 微信开发者工具选择“导入项目”。
3. 选择仓库根目录 `AutoAlbum-WeChat/`。
4. `project.config.json` 已配置 `miniprogramRoot: "miniprogram/"`。
5. 正式发布前把测试 AppID 替换为实际小程序 AppID。
6. BLE 功能建议使用真机调试。

## 配套固件

配套仓库：`xzjohy/eink-gpt`

目标硬件：

- MCU：TLSR8359F512
- EPD Controller：SSD1683
- Panel：400×300 黑/白/红三色电子墨水屏

小程序和固件协议需要保持一致。使用“重置屏幕”前，设备必须烧录支持 `0x0C FORCE_EPD_RESET` 的新版固件。

## 变更记录

### 2026-09-27 · 屏幕恢复与连接体验
- 新增 `0x0C FORCE_EPD_RESET` 控制入口。
- 新增“重置屏幕”按钮。
- 紧急复位绕过小程序本地旧 command waiter。
- BLE 增加 connecting / initializing / ready 阶段。
- 增加连接与 Notify 初始化耗时日志。
- 增加防重复点击和 Adapter already-open 兼容。

### 2026-09-27 · SSD1683 三色处理
- 新增 RED-safe 三色量化。
- 新增 Floyd–Steinberg、Atkinson、阈值模式。
- 新增蛇形误差扩散。
- BLACK/WHITE 误差不扩散到 RED 像素。
- 新增红色/黑色阈值调节。
- 新增每槽三色预览。
- 预览、显示和同步使用同一处理参数。

### 2026-09-26 · 四槽离线相册
- 固定 4 Slot 设备相册。
- 支持选择、替换、删除和上传显示。
- 新增顺序一键同步。
- 新增 Flash Slot 保存/删除。
- 新增 1～1440 分钟离线自动轮播。
- 支持删除仅存在设备 Flash 的槽位。

### 2026-09-26 · 固件协议对齐
- BLE UUID 与 SSD1683 固件对齐。
- 上传改为 BLACK + RED 双 plane。
- 每 plane 固定 15000 bytes。
- 新增 CRC-16/CCITT-FALSE。
- 新增 token/status 命令确认。
- 修复 BLE 重连后 Notify handler 丢失。

### 初始版本
- 建立 AutoAlbum 微信小程序。
- 提供相册、BLE 设备和日志页面。

## 注意事项
- BLE、刷新时间和 BUSY 行为以真机 + 实际 SSD1683 面板测试为准。
- 图片解码与三色量化在手机端完成，设备端不需要 JPEG/PNG 解码。
- FORCE_EPD_RESET 是 EPD 故障恢复，不等同 MCU reboot。
