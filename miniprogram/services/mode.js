let selected = 'off';

function set(value) {
  if (!['off', 'image', 'clock'].includes(value)) throw new Error('无效显示模式');
  selected = value;
}

module.exports = {
  get: () => selected,
  set,
  isImage: () => selected === 'image',
  isClock: () => selected === 'clock'
};
