-- Cosmos Launchpad Database Schema

CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    chain_name TEXT NOT NULL UNIQUE,
    vps_ip TEXT NOT NULL,
    ssh_user TEXT NOT NULL,
    ssh_port INTEGER DEFAULT 22,
    contact_email TEXT NOT NULL,
    status TEXT DEFAULT 'QUEUED' CHECK(status IN ('QUEUED', 'INSTALLING', 'DEPLOYING', 'COMPLETED', 'FAILED')),
    rpc_endpoint TEXT,
    api_endpoint TEXT,
    error_message TEXT,
    installation_log TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at);
CREATE INDEX IF NOT EXISTS idx_deployments_chain_name ON deployments(chain_name);
CREATE INDEX IF NOT EXISTS idx_deployments_vps_ip ON deployments(vps_ip);

-- Optional: Analytics table for tracking usage
CREATE TABLE IF NOT EXISTS deployment_analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deployment_id TEXT REFERENCES deployments(id),
    event_type TEXT NOT NULL, -- 'STARTED', 'DEPENDENCY_INSTALLED', 'BLOCKCHAIN_CREATED', 'COMPLETED', 'FAILED'
    event_data TEXT, -- JSON data
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_deployment_id ON deployment_analytics(deployment_id);
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON deployment_analytics(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON deployment_analytics(created_at);
