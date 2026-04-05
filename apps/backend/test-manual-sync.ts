import axios from 'axios';

/**
 * 手動エンティティ同期エンドポイントをテストするスクリプト
 */
async function testManualSync() {
  const baseUrl = process.env.API_URL || 'http://localhost:4000';
  const endpoint = `${baseUrl}/jobs/run-entity-sync`;

  console.log('========================================');
  console.log('Testing Manual Entity Sync Endpoint');
  console.log('========================================\n');
  console.log(`Endpoint: ${endpoint}\n`);

  try {
    console.log('Sending POST request...\n');

    const response = await axios.post(endpoint, {}, {
      timeout: 300000, // 5分のタイムアウト
    });

    console.log('Response Status:', response.status);
    console.log('Response Data:', JSON.stringify(response.data, null, 2));

    if (response.data.success) {
      console.log('\n✅ SUCCESS: Entity sync completed!');
    } else {
      console.log('\n❌ FAILED: Entity sync failed');
      console.log('Error:', response.data.error);
    }
  } catch (error: any) {
    console.error('\n❌ Request Failed:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('No response received. Is the server running?');
      console.error('Make sure to start the backend server with: npm run dev');
    } else {
      console.error('Error:', error.message);
    }
  }
}

testManualSync();
