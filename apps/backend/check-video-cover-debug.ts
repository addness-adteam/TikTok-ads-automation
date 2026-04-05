// ギガファイル便DLテスト
async function main() {
  const gigaUrl = 'https://116.gigafile.nu/0704-977320b952f1abdd35663425bb129433';
  console.log('1. まとめページ取得中...');
  const resp = await fetch(gigaUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await resp.text();

  // dl_ajax_server
  const serverMatch = html.match(/var\s+dl_ajax_server\s*=\s*"([^"]+)"/);
  console.log(`dl_ajax_server: ${serverMatch?.[1] || 'NOT FOUND'}`);

  // file
  const fileMatch = html.match(/var\s+file\s*=\s*"([^"]+)"/);
  console.log(`file: ${fileMatch?.[1] || 'NOT FOUND'}`);

  // files array
  const filesMatch = html.match(/var\s+files\s*=\s*(\[[\s\S]*?\]);/);
  if (filesMatch) {
    const files = JSON.parse(filesMatch[1]);
    console.log(`files: ${files.length}件`);
    for (const f of files) {
      console.log(`  - ${f.file} (${(f.size / 1024 / 1024).toFixed(1)}MB)`);
    }

    const mainServerMatch = html.match(/var\s+server\s*=\s*"([^"]+)"/);
    const mainServer = mainServerMatch?.[1] || '116.gigafile.nu';
    const fileKey = files[0].file;

    // Step1: 個別ファイルページにアクセスしてSet-Cookieを取得
    const filePageUrl = `https://${mainServer}/${fileKey}`;
    console.log(`\n2. 個別ファイルページ: ${filePageUrl}`);
    const axios = (await import('axios')).default;
    const pageResp = await axios.get(filePageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      maxRedirects: 5,
    });
    const setCookies = pageResp.headers['set-cookie'] || [];
    console.log(`Set-Cookie: ${JSON.stringify(setCookies)}`);
    const cookieStr = setCookies.map((c: string) => c.split(';')[0]).join('; ');

    // Step2: prog_keyを追加してDL
    const progKey = Math.random().toString(36).substring(2, 10);
    const allCookies = cookieStr ? `${cookieStr}; prog_key=${progKey}` : `prog_key=${progKey}`;
    const dlUrl = `https://${mainServer}/download.php?file=${fileKey}`;
    console.log(`\n3. DL: ${dlUrl}`);
    console.log(`   Cookies: ${allCookies}`);
    const dlResp = await axios.get(dlUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': allCookies,
        'Referer': filePageUrl,
      },
      responseType: 'arraybuffer',
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 30000,
      // only read first few bytes to test
      validateStatus: () => true,
    });
    console.log(`Status: ${dlResp.status}`);
    console.log(`Content-Type: ${dlResp.headers['content-type']}`);
    console.log(`Content-Length: ${dlResp.headers['content-length']}`);
    console.log(`Content-Disposition: ${dlResp.headers['content-disposition']}`);
    const buf = Buffer.from(dlResp.data);
    console.log(`Body size: ${buf.length} bytes`);
    const preview = buf.toString('utf-8', 0, Math.min(200, buf.length));
    const isHtml = preview.includes('<html') || preview.includes('<!DOCTYPE');
    console.log(`Is HTML: ${isHtml}`);
    if (isHtml) console.log(`Preview: ${preview.substring(0, 200)}`);
    else console.log('Binary data detected ✓');
  }
}
main();
