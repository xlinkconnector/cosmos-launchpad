const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Import our custom modules
const { DeploymentManager } = require('./utils/deployment-manager');
const deployRoutes = require('./routes/deploy');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
    origin: [
        'https://cosmoslaunchpad.com',
        'https://www.cosmoslaunchpad.com',
        'https://cosmoslaunchpad.netlify.app',
        'http://localhost:3000',
        'http://localhost:8080'
    ],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 deployments per 15 minutes
    message: {
        error: 'Too many deployment requests. Please try again later.',
        retryAfter: '15 minutes'
    }
});

// Apply rate limiting to deployment endpoints
app.use('/api/v1/deploy', limiter);

// Initialize database
const db = new sqlite3.Database('./database/deployments.db', (err) => {
    if (err) {
        console.error('❌ Database connection failed:', err.message);
    } else {
        console.log('✅ Connected to SQLite database');
        
        // Create tables if they don't exist
        db.run(`
            CREATE TABLE IF NOT EXISTS deployments (
                id TEXT PRIMARY KEY,
                chain_name TEXT NOT NULL,
                vps_ip TEXT NOT NULL,
                ssh_user TEXT NOT NULL,
                ssh_port INTEGER DEFAULT 22,
                contact_email TEXT NOT NULL,
                status TEXT DEFAULT 'QUEUED',
                rpc_endpoint TEXT,
                api_endpoint TEXT,
                error_message TEXT,
                installation_log TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        db.run(`CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at)`);
    }
});

// Make database available to routes
app.locals.db = db;

// Health check endpoint
app.get('/api/v1/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// API routes
app.use('/api/v1', deployRoutes);

// Admin stats endpoint (basic)
app.get('/api/v1/admin/stats', (req, res) => {
    const queries = [
        "SELECT COUNT(*) as total FROM deployments",
        "SELECT COUNT(*) as successful FROM deployments WHERE status = 'COMPLETED'",
        "SELECT COUNT(*) as failed FROM deployments WHERE status = 'FAILED'",
        "SELECT COUNT(*) as pending FROM deployments WHERE status IN ('QUEUED', 'INSTALLING', 'DEPLOYING')"
    ];
    
    Promise.all(queries.map(query => 
        new Promise((resolve, reject) => {
            db.get(query, (err, row) => {
                if (err) reject(err);
                else resolve(Object.values(row)[0]);
            });
        })
    )).then(([total, successful, failed, pending]) => {
        res.json({
            total_deployments: total,
            successful_deployments: successful,
            failed_deployments: failed,
            pending_deployments: pending,
            success_rate: total > 0 ? ((successful / total) * 100).toFixed(2) + '%' : '0%'
        });
    }).catch(err => {
        res.status(500).json({ error: 'Failed to fetch stats' });
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        available_endpoints: [
            'GET /api/v1/health',
            'POST /api/v1/deploy',
            'GET /api/v1/deployments/:id/status',
            'GET /api/v1/admin/stats'
        ]
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 SIGTERM received, shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('❌ Error closing database:', err.message);
        } else {
            console.log('✅ Database connection closed');
        }
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🔄 SIGINT received, shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('❌ Error closing database:', err.message);
        } else {
            console.log('✅ Database connection closed');
        }
        process.exit(0);
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Cosmos Launchpad API running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/v1/health`);
});
