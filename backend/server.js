const express = require('express');
const cors = require('cors');
const { NodeSSH } = require('node-ssh');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// CORS Configuration
app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://YOUR-SITE.netlify.app', // UPDATE WITH YOUR NETLIFY URL
        'https://cosmoslaunchpad.com'
    ],
    credentials: true
}));

app.use(express.json());

// Rate limiting
const deployLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: parseInt(process.env.DEPLOY_RATE_LIMIT) || 3,
    message: { error: 'Too many deployment attempts. Please wait before trying again.' }
});

const generalLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.GENERAL_RATE_LIMIT) || 100,
    message: { error: 'Too many requests. Please slow down.' }
});

app.use('/api/v1/deploy', deployLimit);
app.use('/', generalLimit);

// Database setup
const db = new sqlite3.Database(process.env.DATABASE_PATH || './launchpad.db');

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS deployments (
            id TEXT PRIMARY KEY,
            chain_name TEXT NOT NULL,
            vps_ip TEXT NOT NULL,
            ssh_user TEXT NOT NULL,
            ssh_port INTEGER DEFAULT 22,
            contact_email TEXT NOT NULL,
            status TEXT DEFAULT 'QUEUED',
            rpc_endpoint TEXT DEFAULT NULL,
            api_endpoint TEXT DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            deployed_at DATETIME DEFAULT NULL,
            error_message TEXT DEFAULT NULL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS deployment_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            deployment_id TEXT NOT NULL,
            step TEXT NOT NULL,
            command TEXT DEFAULT NULL,
            output TEXT DEFAULT NULL,
            error TEXT DEFAULT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(deployment_id) REFERENCES deployments(id)
        )
    `);
});

// API Endpoints
app.get('/api/v1/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        service: 'cosmos-launchpad-free' 
    });
});

app.post('/api/v1/deploy', async (req, res) => {
    try {
        const {
            chain_name,
            vps_ip,
            ssh_user,
            ssh_port = 22,
            ssh_key,
            contact_email
        } = req.body;

        // Validation
        if (!chain_name || !vps_ip || !ssh_user || !ssh_key || !contact_email) {
            return res.status(400).json({ 
                error: 'Missing required fields: chain_name, vps_ip, ssh_user, ssh_key, contact_email' 
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(contact_email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
        if (!ipRegex.test(vps_ip)) {
            return res.status(400).json({ error: 'Invalid IP address format' });
        }

        if (!/^[a-z0-9-]+$/.test(chain_name)) {
            return res.status(400).json({ 
                error: 'Chain name must contain only lowercase letters, numbers, and hyphens' 
            });
        }

        const deploymentId = 'dep_' + crypto.randomBytes(16).toString('hex');

        db.run(`
            INSERT INTO deployments (
                id, chain_name, vps_ip, ssh_user, ssh_port, contact_email, status
            ) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED')
        `, [deploymentId, chain_name, vps_ip, ssh_user, ssh_port, contact_email], (err) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Failed to create deployment' });
            }

            res.json({
                deployment_id: deploymentId,
                status: 'QUEUED',
                message: 'FREE deployment started',
                estimated_time: '2-3 minutes'
            });

            processDeployment(deploymentId, { chain_name, vps_ip, ssh_user, ssh_port, ssh_key });
        });

    } catch (error) {
        console.error('Deployment creation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/v1/deployments/:id/status', (req, res) => {
    const { id } = req.params;

    db.get('SELECT * FROM deployments WHERE id = ?', [id], (err, deployment) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!deployment) {
            return res.status(404).json({ error: 'Deployment not found' });
        }

        res.json({
            deployment_id: deployment.id,
            status: deployment.status,
            chain_name: deployment.chain_name,
            rpc_endpoint: deployment.rpc_endpoint,
            api_endpoint: deployment.api_endpoint,
            created_at: deployment.created_at,
            deployed_at: deployment.deployed_at,
            error_message: deployment.error_message
        });
    });
});

app.get('/api/v1/deployments/:id/logs', (req, res) => {
    const { id } = req.params;

    db.all(`
        SELECT step, command, output, error, timestamp 
        FROM deployment_logs 
        WHERE deployment_id = ? 
        ORDER BY timestamp ASC
    `, [id], (err, logs) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ logs });
    });
});

// Deployment processing
async function processDeployment(deploymentId, config) {
    const ssh = new NodeSSH();

    try {
        console.log(`Starting deployment ${deploymentId}`);
        await updateDeploymentStatus(deploymentId, 'CONNECTING');
        await logDeploymentStep(deploymentId, 'SSH_CONNECT', `ssh ${config.ssh_user}@${config.vps_ip}`);

        await ssh.connect({
            host: config.vps_ip,
            username: config.ssh_user,
            port: config.ssh_port,
            privateKey: config.ssh_key,
            readyTimeout: 30000
        });

        await logDeploymentStep(deploymentId, 'SSH_CONNECT', null, 'Connected successfully!');
        await updateDeploymentStatus(deploymentId, 'INSTALLING');

        // Install dependencies
        await ensureDependencies(ssh, deploymentId);
        await updateDeploymentStatus(deploymentId, 'SCAFFOLDING');

        // Scaffold blockchain
        const scaffoldCmd = `ignite scaffold chain ${config.chain_name}`;
        await logDeploymentStep(deploymentId, 'SCAFFOLD', scaffoldCmd);
        
        const scaffoldResult = await ssh.execCommand(scaffoldCmd);
        if (scaffoldResult.code !== 0) {
            throw new Error(`Scaffold failed: ${scaffoldResult.stderr}`);
        }

        await logDeploymentStep(deploymentId, 'SCAFFOLD', null, scaffoldResult.stdout);
        await updateDeploymentStatus(deploymentId, 'BUILDING');

        // Build blockchain
        const buildCmd = `cd ${config.chain_name} && ignite chain build`;
        await logDeploymentStep(deploymentId, 'BUILD', buildCmd);
        
        const buildResult = await ssh.execCommand(buildCmd);
        if (buildResult.code !== 0) {
            throw new Error(`Build failed: ${buildResult.stderr}`);
        }

        await updateDeploymentStatus(deploymentId, 'STARTING');

        // Start blockchain
        const serveCmd = `cd ${config.chain_name} && nohup ignite chain serve --reset-once > chain.log 2>&1 &`;
        await logDeploymentStep(deploymentId, 'START', serveCmd);
        
        await ssh.execCommand(serveCmd);

        // Wait for startup
        await new Promise(resolve => setTimeout(resolve, 15000));

        await updateDeploymentStatus(deploymentId, 'VERIFYING');

        // Verify deployment
        const statusResult = await ssh.execCommand(`curl -s http://localhost:26657/status`);
        if (statusResult.code !== 0 || !statusResult.stdout.includes('latest_block_height')) {
            throw new Error('Chain failed to start properly');
        }

        // Finalize
        const rpcEndpoint = `http://${config.vps_ip}:26657`;
        const apiEndpoint = `http://${config.vps_ip}:1317`;

        await finalizeDeployment(deploymentId, {
            rpc_endpoint: rpcEndpoint,
            api_endpoint: apiEndpoint
        });

        await logDeploymentStep(deploymentId, 'COMPLETE', null, 
            `FREE blockchain deployed successfully!\nRPC: ${rpcEndpoint}\nAPI: ${apiEndpoint}`);

        console.log(`Deployment ${deploymentId} completed successfully`);

    } catch (error) {
        console.error(`Deployment ${deploymentId} failed:`, error);
        await updateDeploymentStatus(deploymentId, 'FAILED', error.message);
        await logDeploymentStep(deploymentId, 'ERROR', null, null, error.message);
    } finally {
        ssh.dispose();
    }
}

async function ensureDependencies(ssh, deploymentId) {
    await logDeploymentStep(deploymentId, 'DEPENDENCIES', 'Checking dependencies');
    
    const goCheck = await ssh.execCommand('go version');
    if (goCheck.code !== 0) {
        await logDeploymentStep(deploymentId, 'DEPENDENCIES', 'Installing Go');
        await ssh.execCommand(`
            wget -q https://go.dev/dl/go1.21.5.linux-amd64.tar.gz &&
            sudo tar -C /usr/local -xzf go1.21.5.linux-amd64.tar.gz &&
            echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc &&
            source ~/.bashrc
        `);
    }
    
    const igniteCheck = await ssh.execCommand('ignite version');
    if (igniteCheck.code !== 0) {
        await logDeploymentStep(deploymentId, 'DEPENDENCIES', 'Installing Ignite CLI');
        await ssh.execCommand('curl -s https://get.ignite.com/cli! | bash && source ~/.bashrc');
    }
}

// Helper functions
function updateDeploymentStatus(deploymentId, status, errorMessage = null) {
    return new Promise((resolve, reject) => {
        let sql = 'UPDATE deployments SET status = ?';
        let params = [status];

        if (status === 'COMPLETED') {
            sql += ', deployed_at = datetime("now")';
        }
        
        if (errorMessage) {
            sql += ', error_message = ?';
            params.push(errorMessage);
        }

        sql += ' WHERE id = ?';
        params.push(deploymentId);

        db.run(sql, params, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function finalizeDeployment(deploymentId, endpoints) {
    return new Promise((resolve, reject) => {
        db.run(`
            UPDATE deployments 
            SET rpc_endpoint = ?, api_endpoint = ?, status = 'COMPLETED', deployed_at = datetime('now') 
            WHERE id = ?
        `, [endpoints.rpc_endpoint, endpoints.api_endpoint, deploymentId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function logDeploymentStep(deploymentId, step, command = null, output = null, error = null) {
    return new Promise((resolve, reject) => {
        db.run(`
            INSERT INTO deployment_logs (deployment_id, step, command, output, error) 
            VALUES (?, ?, ?, ?, ?)
        `, [deploymentId, step, command, output, error], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Admin endpoints
app.get('/api/v1/admin/stats', (req, res) => {
    db.get(`
        SELECT 
            COUNT(*) as total_deployments,
            SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as successful_deployments,
            COUNT(DISTINCT DATE(created_at)) as active_days
        FROM deployments
    `, (err, stats) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        const successRate = stats.total_deployments > 0 ? 
            ((stats.successful_deployments / stats.total_deployments) * 100).toFixed(1) : 0;

        res.json({
            total_deployments: stats.total_deployments,
            successful_deployments: stats.successful_deployments,
            success_rate: `${successRate}%`,
            active_days: stats.active_days,
            service: 'FREE Cosmos Launchpad'
        });
    });
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log(`🚀 Simplified Cosmos Launchpad running on port ${PORT}`);
    console.log(`📊 Admin stats: http://localhost:${PORT}/api/v1/admin/stats`);
    console.log(`🏥 Health check: http://localhost:${PORT}/api/v1/health`);
    console.log(`💰 Service: FREE blockchain deployments only`);
});
