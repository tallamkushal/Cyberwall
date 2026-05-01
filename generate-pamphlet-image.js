const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  const filePath = 'file:///' + path.resolve(__dirname, 'pamphlet.html').replace(/\\/g, '/');
  await page.goto(filePath, { waitUntil: 'networkidle0' });

  // Wait for Google Fonts to load
  await new Promise(r => setTimeout(r, 1500));

  const el = await page.$('.page');
  await el.screenshot({
    path: path.join(__dirname, 'pamphlet.png'),
    type: 'png',
  });

  await browser.close();
  console.log('Done! Saved as pamphlet.png');
})();
