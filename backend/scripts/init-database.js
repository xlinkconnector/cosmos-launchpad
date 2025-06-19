const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Ensure database directory exists
const dbDir = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize database
const dbPath = path.join(dbDir, 'deployments.db');
const db = new sqlite3.Database(dbPath);

// Read and execute schema
const schemaPath = path.join(dbDir, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

// Split schema into individual statements and execute
const statements = schema.split(';').filter(stmt => stmt.trim().length > 0);

db.serialize(() => {
    statements.forEach(statement => {
        db.run(statement + ';', (err) => {
            if (err) {
                console.error('❌ Error executing statement:', err.message);
                console.error('Statement:', statement);
            }
        });
    });
});

db.close((err) => {
    if (err) {
        console.error('❌ Error closing database:', err.message);
    } else {
        console.log('✅ Database initialized successfully');
        console.log('📁 Database location:', dbPath);
    }
});
