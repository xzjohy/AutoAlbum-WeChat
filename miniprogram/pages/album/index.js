const ble = require('../../services/ble');
const syncer = require('../../services/sync');
const control = require('../../services/control');
const modeState = require('../../services/mode');
const protocol = require('../../services/protocol');
const imageProcessor = require('../../services/image');

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'bmp', 'webp'];

function isImageFile(file) {
  if (!file) return false;

  // wx.chooseMedia 返回的图片类型
  if (String(file.fileType || '').toLowerCase() === 'image') {
    return true;
  }

  // MIME 类型，例如 image/jpeg、image/png
  const mime = String(file.type || '').toLowerCase();
  if (mime.startsWith('image/')) {
    return true;
  }

  // wx.chooseMessageFile / 普通文件路径或文件名
  const name = String(
    file.name ||
    file.tempFilePath ||
    file.path ||
    ''
  ).toLowerCase();

  // 去掉可能存在的 query/hash
  const cleanName = name.split('?')[0].split('#')[0];
  const extension = cleanName.includes('.')
    ? cleanName.split('.').pop()
    : '';

  return IMAGE_EXTENSIONS.includes(extension);
}

function carouselInterval(value) {
  return Math.max(5, Math.min(120, parseInt(value, 10) || 5));
}

Page({
  data: {
    images: [],
    connected: false,
    converting: false,
    previewMessage: '',
    syncing: false,
    carouselRunning: false,
    carouselPaused: false,
    carouselIndex: -1,
    carouselCount: 0,
    progress: 0,
    stage: '',
    monochrome: false,
    selectedIndex: 0,
    grayscale: 0,
    imageDisplayActive: false,
    imageMode: 'single',
    intervalDraft: '5',
    intervalMinutes: 5
  },

  onLoad() {
    this.removeStatusListener = protocol.onStatus(status => this.updateCarouselStatus(status));
    this.removeDisconnectListener = ble.onDisconnect(() => this.setData({ connected: false }));
  },

  onShow() {
    this.setData({
      connected: ble.isConnected(),
      imageDisplayActive: modeState.isImage()
    });
    this.updateCarouselStatus(protocol.getStatus());
  },

  onUnload() {
    if (this.data.syncing || this.data.converting) syncer.cancel();
    if (this.removeStatusListener) this.removeStatusListener();
    if (this.removeDisconnectListener) this.removeDisconnectListener();
  },

  updateCarouselStatus(status) {
    if (!status || !ble.isConnected()) return;
    if (this.data.syncing && status.busy) {
      const labels = ['', '等待设备执行指令', '设备正在准备屏幕', '设备正在清屏', '墨水屏正在刷新'];
      this.setData({ stage: `${labels[status.state] || '设备正在处理'}，可停止当前上传` });
    }
    this.setData({ carouselCount: status.carouselCount || 0, carouselIndex: status.carouselIndex - 1 });
    if (!status.carouselEnabled) {
      if (this.data.carouselRunning) this.setData({ carouselRunning: false, carouselPaused: false, stage: '设备离线轮播已停止' });
      return;
    }
    this.setData({
      carouselRunning: true,
      carouselPaused: !!status.carouselPaused,
      carouselIndex: status.carouselIndex - 1,
      stage: status.carouselPaused
        ? (status.carouselIndex ? `设备轮播已暂停，当前保持第 ${status.carouselIndex} 张` : '设备轮播已暂停，尚无确认显示的图片')
        : status.carouselIndex
          ? `设备正在显示第 ${status.carouselIndex}/${status.carouselCount} 张`
          : `设备已保存 ${status.carouselCount} 张，等待首次显示`
    });
  },

  selectImageMode(event) {
    if (this.data.converting || this.data.syncing) return;
    const mode = event.currentTarget.dataset.mode;

    if (mode === 'api') return;

    if (mode === this.data.imageMode) return;
    this.setData({
      selectedIndex: 0, grayscale: 0, previewMessage: '',
      imageMode: mode,
      images: [],
      progress: 0,
      stage: ''
    });
  },

  addImages(selected) {
    if (this.data.converting || this.data.syncing) return;
    const files = Array.isArray(selected) ? selected : [];

    console.log('[图片选择] 原始文件:', files);

    const valid = files
      .filter(item => {
        const result = isImageFile(item);

        console.log('[图片检测]', {
          name: item.name,
          path: item.path,
          tempFilePath: item.tempFilePath,
          fileType: item.fileType,
          type: item.type,
          size: item.size,
          valid: result
        });

        return result;
      })
      .map(item => ({
        path: item.tempFilePath || item.path,
        size: item.size,
        name: item.name || ''
      }))
      .filter(item => !!item.path);

    const rejected = files.length - valid.length;

    if (rejected) {
      wx.showToast({
        title: `已过滤 ${rejected} 个非图片文件`,
        icon: 'none'
      });
    }

    if (!valid.length) {
      console.warn('[图片选择] 没有可用图片');
      return;
    }

    const images = this.data.imageMode === 'single'
      ? valid.slice(0, 1)
      : this.data.images.concat(valid).slice(0, 4);

    images.forEach(item => {
      if (item.grayscale == null) item.grayscale = 0;
    });

    const selectedIndex = Math.min(this.data.selectedIndex, Math.max(0, images.length - 1));
    this.setData({ images, selectedIndex, grayscale: images[selectedIndex] ? images[selectedIndex].grayscale : 0 });

    console.log('[图片选择] 已添加图片:', images);
  },

  chooseImages() {
    const remaining = this.data.imageMode === 'single' ? 1 : 4 - this.data.images.length;
    if (remaining <= 0) return wx.showToast({ title: '最多保存 4 张图片', icon: 'none' });
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType: ['album'],

      success: result => {
        console.log('[相册选择成功]', result);

        // chooseMedia 已经限定 mediaType=['image']
        // 主动补充 fileType，避免微信不同基础库返回字段差异导致误判
        const files = (result.tempFiles || []).map(item => ({
          ...item,
          fileType: item.fileType || 'image'
        }));

        this.addImages(files);
      },

      fail: error => {
        console.error('[相册选择失败]', error);

        // 用户主动取消时不弹错误
        const message = error.errMsg || '';

        if (!message.includes('cancel')) {
          wx.showToast({
            title: '选择图片失败',
            icon: 'none'
          });
        }
      }
    });
  },

  chooseImageFiles() {
    const remaining = 4 - this.data.images.length;
    if (remaining <= 0) return wx.showToast({ title: '最多保存 4 张图片', icon: 'none' });
    wx.chooseMessageFile({
      count: remaining,
      type: 'file',
      extension: IMAGE_EXTENSIONS,

      success: result => {
        console.log('[微信文件选择成功]', result);

        this.addImages(result.tempFiles || []);
      },

      fail: error => {
        console.error('[微信文件选择失败]', error);

        const message = error.errMsg || '';

        if (!message.includes('cancel')) {
          wx.showToast({
            title: '选择文件失败',
            icon: 'none'
          });
        }
      }
    });
  },

  setMonochrome(event) {
    if (this.data.converting || this.data.syncing) return;
    this.setData({
      monochrome: event.detail.value,
      images: this.data.images.map(item => Object.assign({}, item, { previewPath: '' }))
    });
  },

  selectPhoto(event) {
    const selectedIndex = Number(event.currentTarget.dataset.index);
    const item = this.data.images[selectedIndex];
    if (!item) return;
    this.setData({ selectedIndex, grayscale: item.grayscale || 0 });
  },

  setGrayscale(event) {
    if (this.data.converting || this.data.syncing) return;
    const grayscale = Number(event.detail.value);
    const images = this.data.images.slice();
    if (images[this.data.selectedIndex]) images[this.data.selectedIndex] = Object.assign({}, images[this.data.selectedIndex], { grayscale, previewPath: '' });
    this.setData({ images, grayscale });
  },

  editSelectedImage() {
    if (this.data.converting || this.data.syncing) return;
    const index = this.data.selectedIndex;
    const item = this.data.images[index];
    if (!item) return wx.showToast({ title: '请先选择图片', icon: 'none' });
    if (!wx.editImage) return wx.showModal({
      title: '当前微信版本不支持编辑',
      content: '请升级手机微信后使用裁剪功能。',
      showCancel: false
    });
    wx.editImage({
      src: item.path,
      success: result => {
        const images = this.data.images.slice();
        images[index] = Object.assign({}, item, { path: result.tempFilePath, previewPath: '' });
        this.setData({ images });
      },
      fail: error => {
        if (!String(error.errMsg || '').includes('cancel')) {
          wx.showToast({ title: '图片编辑失败', icon: 'none' });
        }
      }
    });
  },

  getPreviewCanvas() {
    return new Promise((resolve, reject) => {
      this.createSelectorQuery().select('#conversion-canvas').fields({ node: true }).exec(result => {
        if (result && result[0] && result[0].node) resolve(result[0].node);
        else reject(new Error('预览画布尚未准备好，请稍后重试'));
      });
    });
  },

  convertSelected() { return this.convertImages(false); },
  convertAll() { return this.convertImages(true); },
  async convertImages(all) {
    if (this.data.converting || this.data.syncing || !this.data.images.length) return;
    this.setData({ converting: true, previewMessage: '正在转换为屏幕画面…' });
    try {
      const canvas = await this.getPreviewCanvas();
      const indices = all ? this.data.images.map((_, i) => i) : [this.data.selectedIndex];
      for (const index of indices) {
        const item = this.data.images[index];
        this.setData({ previewMessage: `正在转换第 ${index + 1} 张…` });
        const result = await imageProcessor.preview(item.path, {
          grayscale: item.grayscale || 0,
          monochrome: this.data.imageMode === 'single' && this.data.monochrome
        }, canvas);
        const images = this.data.images.slice();
        images[index] = Object.assign({}, item, result, {
          sizeLabel: `${item.size ? '原文件 ' + (item.size / 1024).toFixed(1) + ' KB · ' : ''}屏幕数据 ${(result.packedBytes / 1024).toFixed(1)} KB`
        });
        this.setData({ images });
      }
      this.setData({ previewMessage: `已转换 ${indices.length} 张，可点击预览放大查看` });
    } catch (error) {
      this.setData({ previewMessage: '转换失败，请重试' });
      wx.showModal({ title: '图片转换失败', content: error.message || error.errMsg || String(error), showCancel: false });
    } finally {
      this.setData({ converting: false });
    }
  },

  previewConverted() {
    const item = this.data.images[this.data.selectedIndex];
    if (!item || !item.previewPath) return;
    wx.previewImage({ current: item.previewPath, urls: this.data.images.filter(x => x.previewPath).map(x => x.previewPath) });
  },

  async toggleImageMode(event) {
    if (this.data.syncing || this.data.converting) return;

    const enableImage = event.detail.value;

    this.setData({
      syncing: true,
      stage: enableImage ? '正在切换图片模式' : '正在关闭图片模式'
    });

    try {
      if (enableImage) {
        await control.imageMode();
      } else {
        if (this.data.carouselRunning) await syncer.stopStoredCarousel();
        await control.disableImageMode();
      }

      this.setData({
        imageDisplayActive: enableImage,
        stage: enableImage
          ? '已切换为图片模式'
          : '图片模式已关闭'
      });

      wx.showToast({
        title: enableImage
          ? '图片模式已启用'
          : '图片模式已关闭'
      });
    } catch (error) {
      this.setData({
        imageDisplayActive: modeState.isImage()
      });

      this.showSyncError(error);
    } finally {
      this.setData({
        syncing: false,
        connected: ble.isConnected()
      });
    }
  },

  inputInterval(event) {
    this.setData({
      intervalDraft: event.detail.value
    });
  },

  normalizeInterval() {
    const minutes = carouselInterval(this.data.intervalDraft);

    this.setData({
      intervalMinutes: minutes,
      intervalDraft: String(minutes)
    });

    return minutes;
  },

  selectInterval(event) {
    const minutes = carouselInterval(
      event.currentTarget.dataset.minutes
    );

    this.setData({
      intervalMinutes: minutes,
      intervalDraft: String(minutes)
    });
  },

  clear() {
    if (this.data.converting || this.data.syncing) return;
    this.setData({
      images: [],
      progress: 0,
      stage: '',
      selectedIndex: 0,
      grayscale: 0
    });
  },

  goToDevice() {
    wx.switchTab({ url: '/pages/device/index' });
  },

  async resetTransfer() {
    if (!this.data.syncing && !this.data.converting) return;
    this.resetRequested = true;
    syncer.cancel();
    this.setData({
      syncing: false,
      converting: false,
      progress: 0,
      stage: '已终止本次上传，请重新连接后再试'
    });
    await ble.release().catch(() => {});
    this.setData({ connected: false });
    wx.showToast({ title: '上传已重置', icon: 'none' });
  },

  report(state, prefix = '') {
    this.setData({
      progress: Math.round(state.overall * 100),
      stage: `${prefix}${state.stage}`
    });
  },

  async syncSingle() {
    if (this.data.syncing || this.data.converting) return;
    if (!this.data.images.length) {
      wx.showToast({
        title: '请先选择图片',
        icon: 'none'
      });
      return;
    }

    this.resetRequested = false;
    this.setData({
      syncing: true,
      progress: 0,
      stage: '准备同步'
    });

    try {
      if (syncer.supportsStoredCarousel()) await syncer.stopStoredCarousel();
      await syncer.start(
        [this.data.images[0]],
        state => this.report(state),
        {
          monochrome: this.data.monochrome
        }
      );

      this.setData({
        stage: '设备已确认刷新完成',
        progress: 100,
        imageDisplayActive: true
      });

      wx.showToast({
        title: '同步完成'
      });
    } catch (error) {
      this.showSyncError(error);
    } finally {
      this.setData({
        syncing: false,
        connected: ble.isConnected()
      });
    }
  },

  async startCarousel() {
    if (
      this.data.converting || this.data.syncing || (this.data.carouselRunning && !this.data.carouselPaused) ||
      !this.data.images.length
    ) {
      return;
    }

    const minutes = this.normalizeInterval();

    this.resetRequested = false;
    this.setData({
      syncing: true,
      intervalMinutes: minutes,
      progress: 0,
      stage: '准备写入设备 Flash'
    });
    try {
      await syncer.storeCarousel(this.data.images, minutes, state => this.report(state));
      this.setData({
        carouselRunning: true,
        carouselPaused: false,
        imageDisplayActive: true,
        progress: 100,
        stage: `已保存 ${this.data.images.length} 张，设备每 ${minutes} 分钟自动轮播`
      });
      wx.showToast({ title: '离线轮播已启动' });
    } catch (error) {
      this.showSyncError(error);
    } finally {
      this.setData({ syncing: false, connected: ble.isConnected() });
    }
  },

  async stopCarousel() {
    if (this.data.syncing || this.data.converting) return;
    if (!ble.isConnected()) return wx.showToast({ title: '请先连接设备', icon: 'none' });
    this.setData({ syncing: true });
    try {
      const status = await syncer.stopStoredCarousel();
      this.updateCarouselStatus(status);
    } catch (error) {
      this.showSyncError(error);
    } finally { this.setData({ syncing: false }); }
  },

  async resumeCarousel() {
    if (this.data.syncing || this.data.converting) return;
    if (!ble.isConnected()) return wx.showToast({ title: '请先重新连接设备', icon: 'none' });
    this.setData({ syncing: true });
    try {
      const status = await syncer.resumeStoredCarousel();
      this.updateCarouselStatus(status);
    } catch (error) { this.showSyncError(error); }
    finally { this.setData({ syncing: false }); }
  },

  async applyInterval() {
    if (this.data.syncing || this.data.converting || !this.data.carouselCount) return;
    const minutes = this.normalizeInterval();
    this.setData({ syncing: true });
    try {
      const status = await syncer.configureStoredCarousel(this.data.carouselCount, minutes);
      this.updateCarouselStatus(status);
      wx.showToast({ title: '间隔已设置，重新轮播', icon: 'none' });
    } catch (error) { this.showSyncError(error); }
    finally { this.setData({ syncing: false }); }
  },

  showSyncError(error) {
    console.error('[同步失败]', error);

    if (this.resetRequested || String(error.message || error).includes('图片传输已终止')) {
      this.resetRequested = false;
      this.setData({ stage: '上传已终止，请重新连接后再试' });
      return;
    }

    this.setData({
      syncing: false,
      stage: '同步未完成，请查看运行日志'
    });

    wx.showModal({
      title: '同步失败',
      content:
        error.message ||
        error.errMsg ||
        String(error),
      showCancel: false
    });
  }
});
