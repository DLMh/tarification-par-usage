const { VercelRequest, VercelResponse } = require('@vercel/node');
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

// Route de test simple
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Test simple - vérifier si c'est l'admin
    if (email === 'admin@example.com' && password === 'admin') {
      const token = jwt.sign({ userId: 1, email }, 'test-secret', { expiresIn: '24h' });
      return res.json({ token, user: { id: 1, email, name: 'Admin' } });
    }
    
    return res.status(401).json({ message: 'Invalid credentials' });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Route de test pour vérifier que l'API fonctionne
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'API is working' });
});

module.exports = async (req, res) => {
  app(req, res);
};
