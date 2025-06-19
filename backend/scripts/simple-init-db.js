const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

console.log('🗄️ Initializing database...');

// Create database directory
const dbDir = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log('✅ Created database directory');
}

const dbPath = path.join(dbDir, 'deployments.db');
console.log('📁 Database path:', dbPath);

// Create database and table
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Database connection failed:', err.message);
        process.exit(1);
    } else {
        console.log('✅ Connected to database');
        
        // Create table
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
                console.error('❌ Table creation failed:', err.message);
                process.exit(1);
            } else {
                console.log('✅ Deployments table created');
                
                // Create indexes
                db.run(`CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status)`);
                db.run(`CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at)`);
                db.run(`CREATE INDEX IF NOT EXISTS idx_deployments_chain_name ON deployments(chain_name)`);
                
                // Verify table exists
                db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='deployments'", (err, row) => {
                    if (err) {
                        console.error('❌ Verification failed:', err.message);
                        process.exit(1);
                    } else if (row) {
                        console.log('🎉 Database initialization complete!');
                        console.log('📊 Table verified:', row.name);
                        db.close();
                        process.exit(0);
                    } else {
                        console.error('❌ Table verification failed - table not found');
                        process.exit(1);
                    }
                });
            }
        });
    }
});
