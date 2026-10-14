// detail/detail.html의 .detail-image를 한 장씩 렌더링해 images/detail-0N.jpg로 저장한다.
// 상세 이미지 글자를 고친 뒤 다시 실행한다: npm run shop:build (eval 폴더에서)
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  await page.goto(pathToFileURL(path.join(here, 'detail/detail.html')).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  for (const block of await page.locator('.detail-image').all()) {
    const id = await block.getAttribute('id');
    const file = path.join(here, 'images', `${id}.jpg`);
    await block.screenshot({ path: file, type: 'jpeg', quality: 90 });
    const { width, height } = await block.boundingBox();
    console.log(`${path.relative(process.cwd(), file)} ${Math.ceil(width)}x${Math.ceil(height)}`);
  }
} finally {
  await browser.close();
}
