const { VercelRequest, VercelResponse } = require('@vercel/node');
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Sequelize, DataTypes } = require("sequelize");

// Configuration
const sequelize = new Sequelize(
  process.env.DB_NAME || 'postgres',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: "postgres",
    logging: false
  }
);

const app = express();
app.use(cors());
app.use(express.json());

// Modèles
const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  password_hash: { type: DataTypes.STRING, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'users', timestamps: false });

const Device = sequelize.define('Device', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  type: { type: DataTypes.STRING, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'devices', timestamps: false });

const Tarif = sequelize.define('Tarif', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  label: { type: DataTypes.STRING, allowNull: false },
  price_per_15min: { type: DataTypes.INTEGER, allowNull: false },
  minimum_price: { type: DataTypes.INTEGER, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'tarifs', timestamps: false });

const Session = sequelize.define('Session', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  device_id: { type: DataTypes.INTEGER, allowNull: false },
  tarif_id: { type: DataTypes.INTEGER },
  start_time: { type: DataTypes.DATE, allowNull: false },
  end_time: { type: DataTypes.DATE },
  duration_minutes: { type: DataTypes.INTEGER },
  amount: { type: DataTypes.INTEGER },
  status: { type: DataTypes.STRING, defaultValue: 'active' },
  accumulated_minutes: { type: DataTypes.INTEGER, defaultValue: 0 },
  last_resumed_at: { type: DataTypes.DATE },
  is_paid: { type: DataTypes.BOOLEAN, defaultValue: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'sessions', timestamps: false });

const Payment = sequelize.define('Payment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  session_id: { type: DataTypes.INTEGER, allowNull: false },
  amount: { type: DataTypes.INTEGER, allowNull: false },
  paid_at: { type: DataTypes.DATE, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'payments', timestamps: false });

// Relations
Device.hasMany(Session, { foreignKey: 'device_id' });
Session.belongsTo(Device, { foreignKey: 'device_id' });
Tarif.hasMany(Session, { foreignKey: 'tarif_id' });
Session.belongsTo(Tarif, { foreignKey: 'tarif_id' });
Session.hasMany(Payment, { foreignKey: 'session_id' });
Payment.belongsTo(Session, { foreignKey: 'session_id' });

// Middleware d'authentification
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Token requis' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Token invalide' });
  }
};

// Routes
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: 'Identifiants invalides' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ message: 'Identifiants invalides' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '24h' }
    );

    res.json({ 
      token, 
      user: { id: user.id, email: user.email, name: user.name } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

app.get('/api/devices', authenticateToken, async (req, res) => {
  try {
    const devices = await Device.findAll();
    res.json(devices);
  } catch (error) {
    console.error('Devices error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

app.post('/api/devices', authenticateToken, async (req, res) => {
  try {
    const { name, type } = req.body;
    const device = await Device.create({ name, type });
    res.json(device);
  } catch (error) {
    console.error('Create device error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

app.get('/api/tarifs', authenticateToken, async (req, res) => {
  try {
    const tarifs = await Tarif.findAll();
    res.json(tarifs);
  } catch (error) {
    console.error('Tarifs error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

app.post('/api/tarifs', authenticateToken, async (req, res) => {
  try {
    const { label, price_per_15min, minimum_price } = req.body;
    const tarif = await Tarif.create({ label, price_per_15min, minimum_price });
    res.json(tarif);
  } catch (error) {
    console.error('Create tarif error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

app.get('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const sessions = await Session.findAll({
      include: [
        { model: Device, attributes: ['id', 'name', 'type'] },
        { model: Tarif, attributes: ['id', 'label', 'price_per_15min', 'minimum_price'] }
      ],
      order: [['created_at', 'DESC']]
    });
    res.json(sessions);
  } catch (error) {
    console.error('Sessions error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

app.post('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const { device_id, tarif_id } = req.body;
    
    // Calculer la durée et le montant
    const start_time = new Date();
    const end_time = new Date(start_time.getTime() + 15 * 60000); // 15 minutes par défaut
    const duration_minutes = 15;
    
    // Récupérer le tarif pour calculer le montant
    const tarif = await Tarif.findByPk(tarif_id);
    let amount = tarif ? tarif.minimum_price : 300;
    
    if (duration_minutes > 0 && tarif) {
      const units = Math.ceil(duration_minutes / 15);
      amount = Math.max(tarif.minimum_price, units * tarif.price_per_15min);
    }
    
    const session = await Session.create({
      device_id,
      tarif_id,
      start_time,
      end_time,
      duration_minutes,
      amount,
      status: 'completed'
    });
    
    res.json(session);
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

app.get('/api/payments', authenticateToken, async (req, res) => {
  try {
    const payments = await Payment.findAll({
      include: [
        { 
          model: Session, 
          include: [
            { model: Device, attributes: ['id', 'name', 'type'] }
          ]
        }
      ],
      order: [['created_at', 'DESC']]
    });
    res.json(payments);
  } catch (error) {
    console.error('Payments error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

app.post('/api/payments', authenticateToken, async (req, res) => {
  try {
    const { session_id, amount } = req.body;
    
    const payment = await Payment.create({
      session_id,
      amount,
      paid_at: new Date()
    });
    
    // Marquer la session comme payée
    await Session.update(
      { is_paid: true },
      { where: { id: session_id } }
    );
    
    res.json(payment);
  } catch (error) {
    console.error('Create payment error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Initialisation
const init = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Database connection error:', error);
  }
};

init();

module.exports = async (req, res) => {
  app(req, res);
};
