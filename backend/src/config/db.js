const mongoose = require('mongoose');
const env = require('./env');

// Disable query buffering globally so operations fail fast if DB is offline
mongoose.set('bufferCommands', false);

const connectDB = async () => {
  try {
    const isAtlas = env.MONGODB_URI.includes('mongodb+srv://') || env.MONGODB_URI.includes('mongodb.net');
    
    const options = {
      serverSelectionTimeoutMS: isAtlas ? 8000 : 3000,
      maxPoolSize: env.IS_PRODUCTION ? 20 : 10,
      minPoolSize: env.IS_PRODUCTION ? 2 : 1,
      socketTimeoutMS: 45000,
    };

    const conn = await mongoose.connect(env.MONGODB_URI, options);
    console.log(`[Database] MongoDB Connected (${isAtlas ? 'MongoDB Atlas' : 'Local MongoDB'}): ${conn.connection.host}/${conn.connection.name}`);

    // Connection event listeners for production stability
    mongoose.connection.on('error', (err) => {
      console.error('[Database Error] MongoDB connection error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[Database Notice] MongoDB disconnected. Attempting reconnection...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('[Database Notice] MongoDB reconnected successfully.');
    });

    // Synchronize Admin Account with authoritative credentials
    try {
      const bcrypt = require('bcryptjs');
      const User = require('../models/User');
      const adminEmail = (env.ADMIN_EMAIL || 'admin@agrinexus.gov.in').trim().toLowerCase();
      const adminPassword = process.env.AGRINEXUS_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'adminpassword';
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(adminPassword, salt);

      const existingAdmin = await User.findOne({
        $or: [
          { email: adminEmail },
          { email: 'admin@agrinexus.gov.in' },
          { email: 'admin@agrinexus.demo' },
          { role: 'ADMIN' }
        ]
      });

      if (existingAdmin) {
        existingAdmin.email = adminEmail;
        existingAdmin.emailNormalized = adminEmail;
        existingAdmin.role = 'ADMIN';
        existingAdmin.passwordHash = passwordHash;
        existingAdmin.isActive = true;
        existingAdmin.accountStatus = 'ACTIVE';
        await existingAdmin.save();
      } else {
        await User.create({
          fullName: 'State Administrator',
          email: adminEmail,
          emailNormalized: adminEmail,
          phone: '9876543212',
          role: 'ADMIN',
          passwordHash,
          district: 'Lucknow',
          state: 'Uttar Pradesh',
          isActive: true,
          accountStatus: 'ACTIVE'
        });
      }
    } catch (syncErr) {
      console.warn('[Admin Sync Notice]:', syncErr.message);
    }

    return conn;
  } catch (error) {
    console.warn(`[Database Notice] MongoDB server unavailable (${error.message}). Backend fallback in-memory store active.`);
  }
};

module.exports = connectDB;
