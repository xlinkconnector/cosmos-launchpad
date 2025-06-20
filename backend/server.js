// /backend/server.js - COMPLETE WORKING VERSION
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for deployment platforms
app.set('trust proxy', true);

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
    origin: [
        'https://cosmoslaunchpad.com',
        'https://www.cosmoslaunchpad.com',
        'https://cosmos-launchpad.netlify.app',
        'http://localhost:3000',
        'http://localhost:8080'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Import routes
const deployRoutes = require('./routes/deploy');

// Database initialization function
async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        // Ensure database directory exists
        const dbDir = path.join(__dirname, 'database');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        const dbPath = path.join(dbDir, 'deployments.db');
        console.log(`📁 Database path: ${dbPath}`);

        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('❌ SQLite connection error:', err);
                reject(err);
                return;
            }
            console.log('✅ Connected to SQLite database');
        });

        // Create deployments table with MEGA comprehensive schema
        db.run(`
            CREATE TABLE IF NOT EXISTS deployments (
                id TEXT PRIMARY KEY,
                chain_name TEXT NOT NULL,
                vps_ip TEXT NOT NULL,
                ssh_user TEXT NOT NULL,
                ssh_password TEXT,
                ssh_key TEXT,
                ssh_port INTEGER DEFAULT 22,
                contact_email TEXT,
                contact_name TEXT,
                company_name TEXT,
                phone_number TEXT,
                status TEXT NOT NULL DEFAULT 'PENDING',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                rpc_endpoint TEXT,
                api_endpoint TEXT,
                rest_endpoint TEXT,
                grpc_endpoint TEXT,
                websocket_endpoint TEXT,
                chain_id TEXT,
                network_name TEXT,
                error_message TEXT,
                deployment_logs TEXT,
                progress INTEGER DEFAULT 0,
                deployment_time INTEGER,
                installer_logs TEXT,
                dependencies_installed BOOLEAN DEFAULT 0,
                blockchain_started BOOLEAN DEFAULT 0,
                deployment_type TEXT,
                module_selection TEXT,
                custom_config TEXT,
                notes TEXT
            )
        `, (err) => {
            if (err) {
                console.error('❌ Table creation error:', err);
                reject(err);
                return;
            }
            console.log('✅ Deployments table ready');
        });

        // Verify table exists
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='deployments'", (err, row) => {
            if (err) {
                console.error('❌ Table verification error:', err);
                reject(err);
                return;
            }
            
            if (row) {
                console.log('✅ Table verification successful');
                console.log('🎯 Database initialization complete');
                resolve(db);
            } else {
                const error = new Error('Deployments table not found after creation');
                console.error('❌ Table verification failed:', error);
                reject(error);
            }
        });
    });
}

// Health check endpoint (outside database dependency)
app.get('/api/v1/health', (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    };
    
    if (app.locals.db) {
        health.database = 'connected';
    } else {
        health.database = 'disconnected';
    }
    
    res.json(health);
});

// Database status endpoint (outside database dependency)
app.get('/api/v1/db-status', (req, res) => {
    if (!app.locals.db) {
        return res.status(503).json({
            status: 'error',
            message: 'Database not initialized'
        });
    }

    app.locals.db.get('SELECT COUNT(*) as count FROM deployments', (err, row) => {
        if (err) {
            return res.status(500).json({
                status: 'error',
                message: 'Database query failed',
                error: err.message
            });
        }

        res.json({
            status: 'ready',
            message: 'Database is ready',
            total_deployments: row.count
        });
    });
});

// Setup API routes FIRST (before database init)
app.use('/api/v1', deployRoutes);

// Admin stats endpoint (moved outside database promise)
app.get('/api/v1/admin/stats', (req, res) => {
    if (!req.app.locals.db) {
        return res.status(503).json({
            error: 'Database not ready',
            message: 'Database is still initializing'
        });
    }
    
    const db = req.app.locals.db;
    
    db.all(`
        SELECT 
            COUNT(*) as total_deployments,
            COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) as successful_deployments,
            COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed_deployments,
            COUNT(CASE WHEN status IN ('PENDING', 'INSTALLING', 'DEPLOYING') THEN 1 END) as pending_deployments
        FROM deployments
    `, (err, rows) => {
        if (err) {
            return res.status(500).json({
                error: 'Database query failed',
                message: err.message
            });
        }
        
        const stats = rows[0];
        const successRate = stats.total_deployments > 0 
            ? ((stats.successful_deployments / stats.total_deployments) * 100).toFixed(1) + '%'
            : '0%';
        
        res.json({
            total_deployments: stats.total_deployments,
            successful_deployments: stats.successful_deployments,
            failed_deployments: stats.failed_deployments,
            pending_deployments: stats.pending_deployments,
            success_rate: successRate
        });
    });
});

// Initialize database (routes already registered above)
initializeDatabase()
    .then((db) => {
        // Make database available to routes
        app.locals.db = db;
        console.log('🚀 All routes configured');
    })
    .catch(err => {
        console.error('❌ Database initialization failed:', err);
        process.exit(1);
    });

// 404 handler for API routes
app.use('/api/v1/*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        available_endpoints: [
            'GET /api/v1/health',
            'GET /api/v1/db-status',
            'POST /api/v1/deploy',
            'GET /api/v1/deployments/:id/status',
            'GET /api/v1/admin/stats'
        ]
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('💥 Global error handler:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Cosmos Launchpad API starting on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/v1/health`);
    console.log(`🗄️ Database status: http://localhost:${PORT}/api/v1/db-status`);
});
