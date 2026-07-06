// Render the slideshow HTML to a print-friendly PDF (one step per page).
// Usage: node render-pdf.js [input.html] [output.pdf]
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const input = path.resolve(process.argv[2] || 'crv-session1.html');
  const output = path.resolve(process.argv[3] || 'crv-session1.pdf');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.goto('file://' + input, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: output,
    format: 'Letter',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  });
  await browser.close();
  console.log('Wrote ' + output);
})().catch(e => { console.error(e); process.exit(1); });
