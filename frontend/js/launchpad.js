class CosmosLaunchpad {
    constructor() {
        this.apiBase = this.getApiBase();
        this.currentDeploymentId = null;
        this.statusInterval = null;
        this.init();
    }

    getApiBase() {
        if (window.location.hostname === 'localhost') {
            return 'http://localhost:8080/api/v1';
        } else {
            // UPDATE THIS WITH YOUR ACTUAL RENDER URL
            return 'https://cosmos-launchpad.onrender.com/api/v1';
        }
    }

    init() {
        this.bindEvents();
        this.setupSmoothScrolling();
        this.addLoadingStyles();
    }

    bindEvents() {
        const form = document.getElementById('deploymentForm');
        if (form) {
            form.addEventListener('submit', (e) => this.handleDeployment(e));
        }

        const chainNameInput = document.getElementById('chainName');
        if (chainNameInput) {
            chainNameInput.addEventListener('input', (e) => this.updateChainName(e));
        }
    }

    setupSmoothScrolling() {
        document.querySelectorAll('nav a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
    }

    async handleDeployment(e) {
        e.preventDefault();
        
        try {
            if (!this.validateForm()) {
                return;
            }

            this.showLoadingState();
            const formData = this.getFormData();

            const response = await fetch(`${this.apiBase}/deploy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const result = await response.json();
            this.currentDeploymentId = result.deployment_id;

            this.showDeploymentStatus();
            this.startStatusMonitoring();

        } catch (error) {
            console.error('Deployment error:', error);
            this.showError(`Deployment failed: ${error.message}`);
            this.hideLoadingState();
        }
    }

    validateForm() {
        const requiredFields = ['chainName', 'vpsIP', 'sshUser', 'sshKey', 'contactEmail'];
        let isValid = true;

        requiredFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (!field || !field.value.trim()) {
                this.markFieldInvalid(field);
                isValid = false;
            } else {
                this.markFieldValid(field);
            }
        });

        // Validate email
        const emailField = document.getElementById('contactEmail');
        if (emailField && emailField.value) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(emailField.value)) {
                this.markFieldInvalid(emailField);
                this.showError('Please enter a valid email address');
                isValid = false;
            }
        }

        // Validate IP
        const ipField = document.getElementById('vpsIP');
        if (ipField && ipField.value) {
            const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
            if (!ipRegex.test(ipField.value)) {
                this.markFieldInvalid(ipField);
                this.showError('Please enter a valid IP address');
                isValid = false;
            }
        }

        // Validate chain name
        const chainField = document.getElementById('chainName');
        if (chainField && chainField.value) {
            if (!/^[a-z0-9-]+$/.test(chainField.value)) {
                this.markFieldInvalid(chainField);
                this.showError('Chain name must contain only lowercase letters, numbers, and hyphens');
                isValid = false;
            }
        }

        return isValid;
    }

    getFormData() {
        return {
            chain_name: document.getElementById('chainName').value.trim(),
            vps_ip: document.getElementById('vpsIP').value.trim(),
            ssh_user: document.getElementById('sshUser').value.trim(),
            ssh_port: parseInt(document.getElementById('sshPort').value) || 22,
            ssh_key: document.getElementById('sshKey').value.trim(),
            contact_email: document.getElementById('contactEmail').value.trim()
        };
    }

    showLoadingState() {
        const submitBtn = document.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="loading"></span> Deploying FREE Blockchain...';
        }
    }

    hideLoadingState() {
        const submitBtn = document.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '🚀 Deploy FREE Blockchain';
        }
    }

    showDeploymentStatus() {
        const statusDiv = document.getElementById('deploymentStatus');
        if (statusDiv) {
            statusDiv.style.display = 'block';
            statusDiv.scrollIntoView({ behavior: 'smooth' });
        }

        const form = document.getElementById('deploymentForm');
        if (form) {
            form.style.display = 'none';
        }
    }

    async startStatusMonitoring() {
        if (!this.currentDeploymentId) return;

        if (this.statusInterval) {
            clearInterval(this.statusInterval);
        }

        this.statusInterval = setInterval(async () => {
            try {
                const response = await fetch(`${this.apiBase}/deployments/${this.currentDeploymentId}/status`);
                
                if (!response.ok) {
                    throw new Error('Failed to fetch status');
                }

                const status = await response.json();
                this.updateDeploymentStatus(status);

                if (status.status === 'COMPLETED' || status.status === 'FAILED') {
                    clearInterval(this.statusInterval);
                    if (status.status === 'COMPLETED') {
                        this.showDeploymentComplete(status);
                    } else {
                        this.showDeploymentFailed(status);
                    }
                }

            } catch (error) {
                console.error('Status check error:', error);
            }
        }, 3000);
    }

    updateDeploymentStatus(status) {
        const statusMessage = document.getElementById('statusMessage');
        const statusProgress = document.getElementById('statusProgress');

        const statusInfo = {
            'QUEUED': { message: 'Deployment queued...', progress: 10 },
            'CONNECTING': { message: 'Connecting to your VPS...', progress: 20 },
            'INSTALLING': { message: 'Installing dependencies...', progress: 30 },
            'SCAFFOLDING': { message: 'Generating blockchain code...', progress: 50 },
            'BUILDING': { message: 'Building blockchain...', progress: 70 },
            'STARTING': { message: 'Starting blockchain services...', progress: 85 },
            'VERIFYING': { message: 'Verifying deployment...', progress: 95 },
            'COMPLETED': { message: 'Deployment complete!', progress: 100 },
            'FAILED': { message: 'Deployment failed', progress: 0 }
        };

        const info = statusInfo[status.status] || statusInfo['QUEUED'];
        
        if (statusMessage) {
            statusMessage.textContent = info.message;
        }
        
        if (statusProgress) {
            statusProgress.style.width = info.progress + '%';
        }

        this.updateTerminalOutput(status.status);
    }

    updateTerminalOutput(status) {
        const terminal = document.getElementById('terminalOutput');
        if (!terminal) return;

        const commands = {
            'CONNECTING': ['ssh root@' + (document.getElementById('vpsIP')?.value || 'your-vps'), 'Connected successfully!'],
            'SCAFFOLDING': ['ignite scaffold chain ' + (document.getElementById('chainName')?.value || 'your-chain'), '✨ Creating blockchain...'],
            'BUILDING': ['ignite chain build', '🔨 Building...'],
            'STARTING': ['ignite chain serve', '🚀 Starting blockchain...'],
            'COMPLETED': ['', '✅ FREE blockchain is live!']
        };

        if (commands[status]) {
            const [command, output] = commands[status];
            if (command) {
                terminal.innerHTML += `\n<div class="terminal-line"><span class="terminal-prompt">root@vps:~$</span> ${command}</div>`;
            }
            if (output) {
                terminal.innerHTML += `\n<div class="terminal-line">${output}</div>`;
            }
            terminal.scrollTop = terminal.scrollHeight;
        }
    }

    showDeploymentComplete(status) {
        const statusMessage = document.getElementById('statusMessage');
        if (statusMessage) {
            statusMessage.style.color = '#00FF88';
            statusMessage.textContent = '🎉 Your FREE blockchain is live!';
        }

        if (status.rpc_endpoint || status.api_endpoint) {
            const terminal = document.getElementById('terminalOutput');
            if (terminal) {
                terminal.innerHTML += `\n<div class="terminal-line" style="color: #00C4FF;">RPC: ${status.rpc_endpoint}</div>`;
                terminal.innerHTML += `\n<div class="terminal-line" style="color: #00C4FF;">API: ${status.api_endpoint}</div>`;
            }
        }

        this.showSuccess('🚀 Your FREE blockchain is successfully deployed and running!');
    }

    showDeploymentFailed(status) {
        const statusMessage = document.getElementById('statusMessage');
        if (statusMessage) {
            statusMessage.style.color = '#FF4757';
            statusMessage.textContent = 'Deployment failed';
        }

        const errorMsg = status.error_message || 'Unknown error occurred';
        this.showError(`Deployment failed: ${errorMsg}`);
        
        const form = document.getElementById('deploymentForm');
        if (form) {
            form.style.display = 'block';
        }
        
        this.hideLoadingState();
    }

    markFieldValid(field) {
        if (field) {
            field.style.borderColor = '#00C4FF';
        }
    }

    markFieldInvalid(field) {
        if (field) {
            field.style.borderColor = '#FF4757';
        }
    }

    updateChainName(e) {
        const chainName = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
        e.target.value = chainName;
    }

    showSuccess(message) {
        this.showAlert(message, 'success');
    }

    showError(message) {
        this.showAlert(message, 'error');
    }

    showAlert(message, type = 'info') {
        document.querySelectorAll('.alert').forEach(alert => alert.remove());

        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.textContent = message;

        const container = document.querySelector('.deploy-form') || document.querySelector('.deployment-status');
        if (container) {
            container.insertBefore(alert, container.firstChild);
        }

        setTimeout(() => alert.remove(), 8000);
    }

    addLoadingStyles() {
        if (!document.querySelector('#loadingStyles')) {
            const style = document.createElement('style');
            style.id = 'loadingStyles';
            style.textContent = `
                .loading {
                    display: inline-block;
                    width: 20px;
                    height: 20px;
                    border: 3px solid rgba(0, 196, 255, 0.3);
                    border-radius: 50%;
                    border-top-color: #00C4FF;
                    animation: spin 1s ease-in-out infinite;
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    new CosmosLaunchpad();
});
