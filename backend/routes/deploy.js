const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { DeploymentManager } = require('../utils/deployment-manager');
const router = express.Router();

// Validation helpers
const validateChainName = (chainName) => {
    if (!chainName) return 'Chain name is required';
    if (!/^[a-z0-9-]+$/.test(chainName)) return 'Chain name can only contain lowercase letters, numbers, and hyphens';
    if (chainName.length < 3 || chainName.length > 30) return 'Chain name must be 3-30 characters';
    if (chainName.startsWith('-') || chainName.endsWith('-')) return 'Chain name cannot start or end with a hyphen';
    return null;
};

const validateIP = (ip) => {
    if (!ip) return 'VPS IP address is required';
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipRegex.test(ip)) return 'Invalid IP address format';
    return null;
};

const validateEmail = (email) => {
    if (!email) return 'Contact email is required';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return 'Invalid email format';
    return null;
};

const validateSSHKey = (sshKey) => {
    if (!sshKey) return 'SSH private key is required';
    if (!sshKey.includes('BEGIN') || !sshKey.includes('PRIVATE KEY')) {
        return 'Invalid SSH private key format';
    }
    return null;
};

// POST /api/v1/deploy - Deploy a new blockchain
router.post('/deploy', async (req, res) => {
    try {
        const { chain_name, vps_ip, ssh_user, ssh_port, ssh_key, contact_email } = req.body;
        
        // Validation
        const validationErrors = [];
        
        const chainNameError = validateChainName(chain_name);
        if (chainNameError) validationErrors.push(chainNameError);
        
        const ipError = validateIP(vps_ip);
        if (ipError) validationErrors.push(ipError);
        
        const emailError = validateEmail(contact_email);
        if (emailError) validationErrors.push(emailError);
        
        const sshKeyError = validateSSHKey(ssh_key);
        if (sshKeyError) validationErrors.push(sshKeyError);
        
        if (!ssh_user) validationErrors.push('SSH username is required');
        
        if (validationErrors.length > 0) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validationErrors
            });
        }
        
        // Check if chain name already exists
        const existingDeployment = await new Promise((resolve, reject) => {
            req.app.locals.db.get(
                'SELECT id FROM deployments WHERE chain_name = ? AND status IN ("QUEUED", "INSTALLING", "DEPLOYING", "COMPLETED")',
                [chain_name],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
        
        if (existingDeployment) {
            return res.status(409).json({
                error: 'Chain name already exists',
                message: 'Please choose a different chain name'
            });
        }
        
        // Create deployment record
        const deploymentId = uuidv4();
        const deploymentData = {
            id: deploymentId,
            chain_name,
            vps_ip,
            ssh_user,
            ssh_port: ssh_port || 22,
            ssh_key,
            contact_email
        };
        
        await new Promise((resolve, reject) => {
            req.app.locals.db.run(
                `INSERT INTO deployments (id, chain_name, vps_ip, ssh_user, ssh_port, contact_email, status)
                 VALUES (?, ?, ?, ?, ?, ?, 'QUEUED')`,
                [deploymentId, chain_name, vps_ip, ssh_user, ssh_port || 22, contact_email],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
        
        // Start deployment asynchronously
        const deploymentManager = new DeploymentManager(req.app.locals.db);
        
        // Don't await - let it run in background
        deploymentManager.deployBlockchain(deploymentData).catch(err => {
            console.error(`❌ Background deployment ${deploymentId} failed:`, err);
        });
        
        res.status(202).json({
            deployment_id: deploymentId,
            status: 'QUEUED',
            message: 'Deployment started successfully',
            estimated_time: '3-6 minutes',
            status_endpoint: `/api/v1/deployments/${deploymentId}/status`
        });
        
    } catch (error) {
        console.error('❌ Deployment creation failed:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to create deployment'
        });
    }
});

// GET /api/v1/deployments/:id/status - Check deployment status
router.get('/deployments/:id/status', async (req, res) => {
    try {
        const deploymentId = req.params.id;
        
        const deployment = await new Promise((resolve, reject) => {
            req.app.locals.db.get(
                'SELECT * FROM deployments WHERE id = ?',
                [deploymentId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
        
        if (!deployment) {
            return res.status(404).json({
                error: 'Deployment not found',
                deployment_id: deploymentId
            });
        }
        
        const response = {
            deployment_id: deploymentId,
            chain_name: deployment.chain_name,
            status: deployment.status,
            created_at: deployment.created_at,
            updated_at: deployment.updated_at
        };
        
        // Add status-specific information
        switch (deployment.status) {
            case 'COMPLETED':
                response.rpc_endpoint = deployment.rpc_endpoint;
                response.api_endpoint = deployment.api_endpoint;
                response.message = 'Blockchain deployed successfully!';
                response.next_steps = [
                    'Access your blockchain via the RPC endpoint',
                    'Use the API endpoint for queries',
                    'Start building your application'
                ];
                break;
                
            case 'FAILED':
                response.error_message = deployment.error_message;
                response.message = 'Deployment failed';
                response.next_steps = [
                    'Check the error message above',
                    'Verify VPS access and SSH key',
                    'Try deploying again with a different chain name'
                ];
                break;
                
            case 'INSTALLING':
                response.message = deployment.error_message || 'Installing dependencies...';
                response.estimated_remaining = '2-4 minutes';
                break;
                
            case 'DEPLOYING':
                response.message = deployment.error_message || 'Deploying blockchain...';
                response.estimated_remaining = '1-2 minutes';
                break;
                
            case 'QUEUED':
                response.message = 'Deployment queued and starting...';
                response.estimated_remaining = '3-6 minutes';
                break;
        }
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Status check failed:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to check deployment status'
        });
    }
});

// GET /api/v1/deployments - List recent deployments (optional admin endpoint)
router.get('/deployments', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 10, 100);
        const offset = parseInt(req.query.offset) || 0;
        
        const deployments = await new Promise((resolve, reject) => {
            req.app.locals.db.all(
                `SELECT id, chain_name, vps_ip, status, created_at, updated_at 
                 FROM deployments 
                 ORDER BY created_at DESC 
                 LIMIT ? OFFSET ?`,
                [limit, offset],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
        
        const total = await new Promise((resolve, reject) => {
            req.app.locals.db.get(
                'SELECT COUNT(*) as count FROM deployments',
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row.count);
                }
            );
        });
        
        res.json({
            deployments,
            pagination: {
                total,
                limit,
                offset,
                has_more: offset + limit < total
            }
        });
        
    } catch (error) {
        console.error('❌ Deployments list failed:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to fetch deployments'
        });
    }
});

module.exports = router;
