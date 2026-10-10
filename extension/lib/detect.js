// 실제로 내려받아 크기를 확인한 이미지 중 상세 설명 이미지로 보이는 것만 고른다.
// 1) 세로로 긴 이미지, 2) 같은 너비로 3장 이상 이어 붙인 이미지 묶음.
const MIN_WIDTH = 400;
const TALL_RATIO = 1.2;
const GROUP_MIN_COUNT = 3;
const WIDTH_TOLERANCE = 4;

export function pickDetailImages(images) {
  const wide = images.filter((img) => img.width >= MIN_WIDTH);
  const sameWidthCount = (img) =>
    wide.filter((other) => Math.abs(other.width - img.width) <= WIDTH_TOLERANCE).length;

  return wide.filter(
    (img) => img.height >= img.width * TALL_RATIO || sameWidthCount(img) >= GROUP_MIN_COUNT
  );
}
