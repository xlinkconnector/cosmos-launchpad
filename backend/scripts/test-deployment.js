// Test script for local development
const axios = require('axios');

const API_BASE = 'http://localhost:3000/api/v1';

// Test deployment data (use your own test VPS)
const testDeployment = {
    chain_name: 'test-chain-' + Date.now(),
    vps_ip: '192.168.1.100', // Replace with your test VPS IP
    ssh_user: 'root',
    ssh_port: 22,
    ssh_key: `-----BEGIN OPENSSH PRIVATE KEY-----
your-test-ssh-key-here
-----END OPENSSH PRIVATE KEY-----`,
    contact_email: 'test@example.com'
};

async function testAPI() {
    try {
        console.log('🧪 Testing Cosmos Launchpad API...');
        
        // Test health endpoint
        console.log('📊 Testing health endpoint...');
        const healthResponse = await axios.get(`${API_BASE}/health`);
        console.log('✅ Health check:', healthResponse.data);
        
        // Test deployment creation
        console.log('🚀 Testing deployment creation...');
        const deployResponse = await axios.post(`${API_BASE}/deploy`, testDeployment);
        console.log('✅ Deployment created:', deployResponse.data);
        
        const deploymentId = deployResponse.data.deployment_id;
        
        // Test status checking
        console.log('📋 Testing status endpoint...');
        const statusResponse = await axios.get(`${API_BASE}/deployments/${deploymentId}/status`);
        console.log('✅ Status check:', statusResponse.data);
        
        // Test stats endpoint
        console.log('📈 Testing stats endpoint...');
        const statsResponse = await axios.get(`${API_BASE}/admin/stats`);
        console.log('✅ Stats check:', statsResponse.data);
        
        console.log('🎉 All tests passed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.response?.data || error.message);
    }
}

// Run tests
testAPI();
