# AutoAlbum-WeChat

自动相册微信小程序：通过 BLE 将本地/API 图片依次同步到墨水屏。

## MVP
- BLE 扫描、连接、断开、Notify、分包写入
- 本地多图选择与队列
- API 图片 URL 导入接口
- 顺序同步、进度与日志
- BW / BWR / BWY 三种色彩模式配置

> 设备端 Flash、显示驱动不属于本仓库范围。BLE UUID 与最终图片编码协议请在 miniprogram/config/ble.js 中配置。

## 导入
使用微信开发者工具导入仓库根目录，miniprogramRoot 已配置为 miniprogram/。
