// /backend/server.js - FIXED VERSION
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
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
        'https://yoursite.netlify.app',
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

// FIXED: Database initialization with proper error handling
async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        try {
            // Ensure database directory exists
            const dbDir = path.join(__dirname, 'database');
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
                console.log('✅ Created database directory');
            }

            const dbPath = path.join(dbDir, 'deployments.db');
            console.log('📁 Database path:', dbPath);

            const db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    console.error('❌ Database connection failed:', err.message);
                    reject(err);
                } else {
                    console.log('✅ Connected to SQLite database');
                    
                    // Create deployments table
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
                    `, (err) => {
                        if (err) {
                            console.error('❌ Failed to create deployments table:', err.message);
                            reject(err);
                        } else {
                            console.log('✅ Deployments table ready');
                            
                            // Create indexes
                            db.run(`CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status)`, (err) => {
                                if (err) console.error('⚠️ Index creation warning:', err.message);
                            });
                            
                            db.run(`CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at)`, (err) => {
                                if (err) console.error('⚠️ Index creation warning:', err.message);
                            });
                            
                            db.run(`CREATE INDEX IF NOT EXISTS idx_deployments_chain_name ON deployments(chain_name)`, (err) => {
                                if (err) console.error('⚠️ Index creation warning:', err.message);
                            });
                            
                            // Test the table
                            db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='deployments'", (err, row) => {
                                if (err) {
                                    console.error('❌ Table verification failed:', err.message);
                                    reject(err);
                                } else if (row) {
                                    console.log('✅ Table verification successful');
                                    resolve(db);
                                } else {
                                    console.error('❌ Table was not created');
                                    reject(new Error('Table creation failed'));
                                }
                            });
                        }
                    });
                }
            });
        } catch (error) {
            console.error('❌ Database initialization error:', error);
            reject(error);
        }
    });
}

// Health check endpoint (available immediately)
app.get('/api/v1/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        database: app.locals.db ? 'connected' : 'initializing'
    });
});

// Database initialization status endpoint
app.get('/api/v1/db-status', (req, res) => {
    if (!app.locals.db) {
        return res.status(503).json({
            status: 'initializing',
            message: 'Database is still initializing, please wait...'
        });
    }
    
    // Test database connection
    app.locals.db.get("SELECT COUNT(*) as count FROM deployments", (err, row) => {
        if (err) {
            res.status(500).json({
                status: 'error',
                message: 'Database connection failed',
                error: err.message
            });
        } else {
            res.json({
                status: 'ready',
                message: 'Database is ready',
                total_deployments: row.count
            });
        }
    });
});

// Initialize database before starting routes
initializeDatabase()
    .then((db) => {
        // Make database available to routes
        app.locals.db = db;
        console.log('🎯 Database initialization complete');
        
        // FIXED: Middleware to check database BEFORE processing deploy requests (moved inside promise)
        app.use('/api/v1/deploy*', (req, res, next) => {
            if (!app.locals.db) {
                return res.status(503).json({
                    error: 'Service unavailable',
                    message: 'Database is still initializing, please try again in a few seconds'
                });
            }
            next();
        });
        
        // NOW setup the API routes (after database and middleware are ready)
        app.use('/api/v1', deployRoutes);
        
        // Admin stats endpoint
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
        
        console.log('🚀 All routes configured');
    })
    .catch((err) => {
        console.error('💥 FATAL: Database initialization failed:', err);
        process.exit(1);
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
            'GET /api/v1/db-status',
            'POST /api/v1/deploy',
            'GET /api/v1/deployments/:id/status',
            'GET /api/v1/admin/stats'
        ]
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 SIGTERM received, shutting down gracefully...');
    if (app.locals.db) {
        app.locals.db.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err.message);
            } else {
                console.log('✅ Database connection closed');
            }
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});

process.on('SIGINT', () => {
    console.log('🔄 SIGINT received, shutting down gracefully...');
    if (app.locals.db) {
        app.locals.db.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err.message);
            } else {
                console.log('✅ Database connection closed');
            }
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Cosmos Launchpad API starting on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/v1/health`);
    console.log(`🗄️ Database status: http://localhost:${PORT}/api/v1/db-status`);
});
