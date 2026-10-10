// 긴 상세 이미지를 AI가 글자를 읽을 수 있는 크기의 조각으로 나눈다.
export const MAX_TILE_WIDTH = 1000;
export const TILE_HEIGHT = 1000;
export const TILE_OVERLAP = 80;

// 원본 크기를 받아 축소 비율과 원본 좌표 기준 조각 위치를 계산한다.
export function planTiles(width, height) {
  const scale = Math.min(1, MAX_TILE_WIDTH / width);
  const tileHeight = TILE_HEIGHT / scale;
  const step = (TILE_HEIGHT - TILE_OVERLAP) / scale;
  const tiles = [];
  for (let y = 0; y < height; y += step) {
    const h = Math.min(tileHeight, height - y);
    tiles.push({ y: Math.round(y), height: Math.round(h) });
    if (y + h >= height) break;
  }
  return { scale, tiles };
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// 서비스 워커 전용: OffscreenCanvas로 조각을 잘라 JPEG base64로 만든다.
// maxBase64Length가 있으면 그 크기 아래로 들어올 때까지 품질을 낮춘다.
export async function cutTiles(bitmap, { maxBase64Length = Infinity } = {}) {
  const { scale, tiles } = planTiles(bitmap.width, bitmap.height);
  const width = Math.round(bitmap.width * scale);
  const results = [];
  for (const tile of tiles) {
    const height = Math.round(tile.height * scale);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, tile.y, bitmap.width, tile.height, 0, 0, width, height);
    results.push(await encodeJpeg(canvas, maxBase64Length));
  }
  return results;
}

async function encodeJpeg(canvas, maxBase64Length) {
  let data = '';
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    data = arrayBufferToBase64(await blob.arrayBuffer());
    if (data.length <= maxBase64Length) break;
  }
  return { mimeType: 'image/jpeg', data };
}
