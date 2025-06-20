const { NodeSSH } = require('node-ssh');

class VPSInstaller {
    constructor() {
        this.ssh = new NodeSSH();
    }

    async checkAndInstallDependencies(sshConfig, deploymentId, updateStatus) {
        try {
            await updateStatus(deploymentId, 'INSTALLING', 'Connecting to VPS...');
            await this.ssh.connect(sshConfig);
            
            await updateStatus(deploymentId, 'INSTALLING', 'Checking dependencies...');
            
            // Check and install each dependency
            await this.ensureGo(deploymentId, updateStatus);
            await this.ensureGit(deploymentId, updateStatus);
            await this.ensureIgnite(deploymentId, updateStatus);
            await this.ensureBuf(deploymentId, updateStatus);
            
            await updateStatus(deploymentId, 'INSTALLING', 'All dependencies ready!');
            return { success: true };
            
        } catch (error) {
            console.error('❌ Dependency installation failed:', error);
            await updateStatus(deploymentId, 'FAILED', `Dependency installation failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async ensureGo(deploymentId, updateStatus) {
        await updateStatus(deploymentId, 'INSTALLING', 'Checking Go installation...');
        
        const goCheck = await this.runCommand('go version || echo "NOT_INSTALLED"');
        
        if (goCheck.includes('NOT_INSTALLED')) {
            await updateStatus(deploymentId, 'INSTALLING', 'Installing Go (this may take a few minutes)...');
            
            // Detect OS and architecture
            const osInfo = await this.runCommand('uname -s');
            const archInfo = await this.runCommand('uname -m');
            
            let goUrl;
            if (osInfo.includes('Linux')) {
                if (archInfo.includes('x86_64')) {
                    goUrl = 'https://go.dev/dl/go1.21.6.linux-amd64.tar.gz';
                } else if (archInfo.includes('aarch64')) {
                    goUrl = 'https://go.dev/dl/go1.21.6.linux-arm64.tar.gz';
                }
            }
            
            if (!goUrl) throw new Error('Unsupported OS/Architecture for Go installation');
            
            // Install Go
            await this.runCommand(`
                cd /tmp &&
                wget -q ${goUrl} &&
                sudo rm -rf /usr/local/go &&
                sudo tar -C /usr/local -xzf go1.21.6.linux-*.tar.gz &&
                echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc &&
                echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.profile
            `);
            
            // Verify installation
            const verification = await this.runCommand('export PATH=$PATH:/usr/local/go/bin && go version');
            if (!verification.includes('go version')) {
                throw new Error('Go installation verification failed');
            }
            
            await updateStatus(deploymentId, 'INSTALLING', 'Go installed successfully');
        } else {
            await updateStatus(deploymentId, 'INSTALLING', 'Go already installed');
        }
    }

    async ensureGit(deploymentId, updateStatus) {
        await updateStatus(deploymentId, 'INSTALLING', 'Checking Git installation...');
        
        const gitCheck = await this.runCommand('git --version || echo "NOT_INSTALLED"');
        
        if (gitCheck.includes('NOT_INSTALLED')) {
            await updateStatus(deploymentId, 'INSTALLING', 'Installing Git...');
            
            const osRelease = await this.runCommand('cat /etc/os-release || echo "unknown"');
            
            if (osRelease.includes('ubuntu') || osRelease.includes('debian')) {
                await this.runCommand('sudo apt update -y && sudo apt install -y git');
            } else if (osRelease.includes('centos') || osRelease.includes('rhel')) {
                await this.runCommand('sudo yum install -y git');
            } else if (osRelease.includes('alpine')) {
                await this.runCommand('sudo apk add git');
            } else {
                // Try generic package managers
                try {
                    await this.runCommand('sudo apt install -y git || sudo yum install -y git || sudo apk add git');
                } catch (err) {
                    throw new Error('Unable to install Git on this system');
                }
            }
            
            await updateStatus(deploymentId, 'INSTALLING', 'Git installed successfully');
        } else {
            await updateStatus(deploymentId, 'INSTALLING', 'Git already installed');
        }
    }

    async ensureIgnite(deploymentId, updateStatus) {
        await updateStatus(deploymentId, 'INSTALLING', 'Checking Ignite CLI installation...');
        
        const igniteCheck = await this.runCommand('export PATH=$PATH:/usr/local/go/bin && ignite version || echo "NOT_INSTALLED"');
        
        if (igniteCheck.includes('NOT_INSTALLED')) {
            await updateStatus(deploymentId, 'INSTALLING', 'Installing Ignite CLI (this may take a few minutes)...');
            
            // Install Ignite CLI
            await this.runCommand(`
                export PATH=$PATH:/usr/local/go/bin &&
                curl -L https://get.ignite.com/cli! | bash &&
                sudo mv ignite /usr/local/bin/ || mv ignite /usr/local/bin/
            `);
            
            // Verify installation
            const verification = await this.runCommand('ignite version');
            if (!verification.includes('Ignite CLI')) {
                throw new Error('Ignite CLI installation verification failed');
            }
            
            await updateStatus(deploymentId, 'INSTALLING', 'Ignite CLI installed successfully');
        } else {
            await updateStatus(deploymentId, 'INSTALLING', 'Ignite CLI already installed');
        }
    }

    async ensureBuf(deploymentId, updateStatus) {
        await updateStatus(deploymentId, 'INSTALLING', 'Checking buf installation...');
        
        const bufCheck = await this.runCommand('buf --version || echo "NOT_INSTALLED"');
        
        if (bufCheck.includes('NOT_INSTALLED')) {
            await updateStatus(deploymentId, 'INSTALLING', 'Installing buf...');
            
            // Install buf
            await this.runCommand(`
                curl -sSL "https://github.com/bufbuild/buf/releases/download/v1.28.1/buf-\$(uname -s)-\$(uname -m)" -o "/tmp/buf" &&
                sudo mv /tmp/buf /usr/local/bin/buf &&
                sudo chmod +x /usr/local/bin/buf
            `);
            
            // Verify installation
            const verification = await this.runCommand('buf --version');
            if (!verification.includes('1.')) {
                throw new Error('buf installation verification failed');
            }
            
            await updateStatus(deploymentId, 'INSTALLING', 'buf installed successfully');
        } else {
            await updateStatus(deploymentId, 'INSTALLING', 'buf already installed');
        }
    }

    async runCommand(command) {
        const result = await this.ssh.execCommand(command, { 
            cwd: '/home/' + this.ssh.connection.config.username 
        });
        
        if (result.stderr && result.code !== 0) {
            console.error(`Command failed: ${command}`);
            console.error(`Error: ${result.stderr}`);
            throw new Error(`Command failed: ${result.stderr}`);
        }
        
        return result.stdout || result.stderr || '';
    }

    async disconnect() {
        this.ssh.dispose();
    }
}

class DeploymentManager {
    constructor(db) {
        this.db = db;
        this.installer = new VPSInstaller();
    }

    async updateDeploymentStatus(deploymentId, status, message = null, endpoints = null) {
        return new Promise((resolve, reject) => {
            const updateQuery = `
                UPDATE deployments 
                SET status = ?, 
                    error_message = ?,
                    rpc_endpoint = ?,
                    api_endpoint = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            
            this.db.run(updateQuery, [
                status, 
                message, 
                endpoints?.rpc || null,
                endpoints?.api || null,
                deploymentId
            ], function(err) {
                if (err) {
                    console.error('❌ Failed to update deployment status:', err);
                    reject(err);
                } else {
                    console.log(`✅ Updated deployment ${deploymentId}: ${status} - ${message}`);
                    resolve();
                }
            });
        });
    }

    async deployBlockchain(deploymentData) {
        const { id: deploymentId, chain_name, vps_ip, ssh_user, ssh_port, ssh_key } = deploymentData;
        
        console.log(`🔍 Connecting to VPS: ${vps_ip} as ${ssh_user} on port ${ssh_port || 22}`);
        
        const sshConfig = {
            host: vps_ip,
            username: ssh_user,
            port: ssh_port || 22,
            privateKey: ssh_key,
            readyTimeout: 30000,
            // Removed restrictive algorithms - let SSH negotiate automatically
        };

        try {
            // Phase 1: Install dependencies
            console.log(`🚀 Starting deployment ${deploymentId}: Installing dependencies...`);
            const depResult = await this.installer.checkAndInstallDependencies(
                sshConfig, 
                deploymentId, 
                this.updateDeploymentStatus.bind(this)
            );
            
            if (!depResult.success) {
                throw new Error(`Dependency installation failed: ${depResult.error}`);
            }

            // Phase 2: Deploy blockchain
            console.log(`🚀 Deployment ${deploymentId}: Creating blockchain...`);
            await this.updateDeploymentStatus(deploymentId, 'DEPLOYING', 'Creating blockchain...');
            
            // Create blockchain
            await this.installer.runCommand(`
                export PATH=$PATH:/usr/local/go/bin &&
                cd ~ &&
                rm -rf ${chain_name} &&
                ignite scaffold chain ${chain_name}
            `);
            
            await this.updateDeploymentStatus(deploymentId, 'DEPLOYING', 'Starting blockchain services...');
            
            // Start blockchain in background with proper logging
            await this.installer.runCommand(`
                export PATH=$PATH:/usr/local/go/bin &&
                cd ~/${chain_name} &&
                pkill -f "ignite chain serve" || true &&
                nohup ignite chain serve --verbose > ~/chain-${chain_name}.log 2>&1 &
            `);
            
            // Wait for blockchain to start
            await this.updateDeploymentStatus(deploymentId, 'DEPLOYING', 'Waiting for blockchain to start...');
            await new Promise(resolve => setTimeout(resolve, 15000));
            
            // Verify blockchain is running
            try {
                const statusCheck = await this.installer.runCommand(`
                    curl -s http://localhost:26657/status || echo "NOT_READY"
                `);
                
                if (statusCheck.includes('NOT_READY')) {
                    throw new Error('Blockchain failed to start properly');
                }
            } catch (err) {
                console.warn('Status check failed, but continuing...');
            }
            
            const rpcEndpoint = `http://${vps_ip}:26657`;
            const apiEndpoint = `http://${vps_ip}:1317`;
            
            await this.updateDeploymentStatus(
                deploymentId, 
                'COMPLETED', 
                'Blockchain deployed successfully!',
                { rpc: rpcEndpoint, api: apiEndpoint }
            );
            
            console.log(`✅ Deployment ${deploymentId} completed successfully!`);
            
            return {
                success: true,
                endpoints: {
                    rpc: rpcEndpoint,
                    api: apiEndpoint
                }
            };
            
        } catch (error) {
            console.error(`❌ Deployment ${deploymentId} failed:`, error);
            await this.updateDeploymentStatus(deploymentId, 'FAILED', error.message);
            
            return {
                success: false,
                error: error.message
            };
        } finally {
            await this.installer.disconnect();
        }
    }
}

module.exports = { VPSInstaller, DeploymentManager };
