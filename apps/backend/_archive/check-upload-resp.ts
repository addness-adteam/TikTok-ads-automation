import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '.env') });

const axios = require('axios');
const FormData = require('form-data');
const ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || '2092744b8976b4b9392e0c8e8bdf2bf09570bb82';
const ADV = '7543540647266074641';

async function main() {
  const info = await fetch(`https://business-api.tiktok.com/open_api/v1.3/file/video/ad/info/?advertiser_id=7468288053866561553&video_ids=["v10033g50000d5reklnog65uj38psptg"]`, {
    headers: { 'Access-Token': ACCESS_TOKEN },
  });
  const d = await info.json();
  const previewUrl = d.data?.list?.[0]?.preview_url;
  const dl = await fetch(previewUrl!);
  const buf = Buffer.from(await dl.arrayBuffer());
  console.log('Size:', buf.byteLength);

  const form = new FormData();
  form.append('advertiser_id', ADV);
  form.append('upload_type', 'UPLOAD_BY_FILE');
  form.append('video_signature', crypto.createHash('md5').update(buf).digest('hex'));
  form.append('video_file', buf, { filename: 'test_' + Date.now() + '.mp4', contentType: 'video/mp4' });
  const ur = await axios.post('https://business-api.tiktok.com/open_api/v1.3/file/video/ad/upload/', form, {
    headers: { 'Access-Token': ACCESS_TOKEN, ...form.getHeaders() },
    timeout: 120000, maxContentLength: Infinity, maxBodyLength: Infinity,
  });
  console.log('code:', ur.data.code);
  console.log('data:', JSON.stringify(ur.data.data));
}
main();
