const { webkit } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('=== Playwright WebKit 测试 ===\n');

  // 1. 检查缓存目录
  const cacheDir = path.join(process.env.HOME, '.cache', 'ms-playwright');
  if (fs.existsSync(cacheDir)) {
    const dirs = fs.readdirSync(cacheDir).filter(d => d.startsWith('webkit'));
    console.log('📁 缓存目录中的 WebKit 版本:', dirs.length ? dirs.join(', ') : '未找到');
  } else {
    console.log('📁 缓存目录不存在:', cacheDir);
  }

  // 2. 打印 Playwright 使用的可执行文件路径
  try {
    const exePath = webkit.executablePath();
    console.log('🔧 可执行文件路径:', exePath);
    console.log('   文件存在:', fs.existsSync(exePath) ? '✅' : '❌');
  } catch (e) {
    console.log('🔧 无法获取可执行文件路径:', e.message);
  }

  // 3. 尝试启动
  console.log('\n🚀 尝试启动 WebKit (headless)...');
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
    console.log('✅ 浏览器启动成功');

    const page = await browser.newPage();
    await page.setContent('<h1>Hello CachyOS</h1><p>WebKit is working</p>');

    const title = await page.textContent('h1');
    console.log('📄 页面标题:', title);

    const ua = await page.evaluate(() => navigator.userAgent);
    console.log('🌐 User-Agent:', ua);

    console.log('\n🎉 全部测试通过，WebKit 可以正常使用！');
  } catch (err) {
    console.error('\n❌ 启动失败:', err.message);
    console.error('\n提示: 如果提示缺少 .so 文件，用以下命令查看缺失的库：');
    console.error('  ldd $(node -e "console.log(require(\'playwright\').webkit.executablePath())") | grep "not found"');
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
