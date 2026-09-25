/**
 * AgriNexus - Database Hygiene Script
 * 
 * Safely removes only conclusively identified orphaned test records
 * from historical development/test runs while preserving all seeded
 * and legitimate operational data.
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const env = require('../src/config/env');

const ORPHANED_TEST_USERS = [
  '6aa8bab57bb792b3959c4913', // Vikram Patel (9874185711)
  '6aa8baf71aef2f225b497b34', // Vikram Patel (9880691211)
  '6aa8bb391aef2f225b497b9c', // Vikram Patel (9887363211)
  '6aa8bc2bcc16aed9e884dde4', // Vikram Patel (9811490211)
  '6aa8bc3acc16aed9e884de55', // Vikram Patel (9812987611)
  '6aa8c01bcc16aed9e884df9d', // Vikram Patel (9812346011)
  '6ab4cb93f73bec5cc68c3e71', // asdfg asdfg (6546546546)
  '6ab60bf7ba100e37f55c6a57'  // Kisan E2E Verify 36091660 (9836091660)
];

const ORPHANED_TEST_BOOKINGS = [
  '6ab4cba0f73bec5cc68c3e8a', // GOM01-103 (farmer: asdfg asdfg - deleted test user)
  '6ab5f87fb607753a47ac5696', // GOM01-102 (farmer: asdfg asdfg)
  '6ab5fa0cb607753a47ac5736', // GOM01-103 (farmer: deleted test farmer)
  '6ab5fa5cb607753a47ac576e', // GOM01-104 (farmer: deleted test farmer)
  '6ab60bf8ba100e37f55c6a64', // GOM01-105 (farmer: Kisan E2E Verify 36091660)
  '6ab60bffba100e37f55c6ad4'  // GOM01-106 (farmer: Kisan E2E Verify 36091660)
];

const ORPHANED_TEST_QUEUES = [
  '6ab4cba0f73bec5cc68c3e8d', // GOM01-103 (farmer: asdfg asdfg)
  '6ab5f87fb607753a47ac5699', // GOM01-102
  '6ab5fa0cb607753a47ac5739', // GOM01-103
  '6ab5fa5cb607753a47ac5771', // GOM01-104
  '6ab60bf8ba100e37f55c6a68', // GOM01-105
  '6ab60bffba100e37f55c6ad8'  // GOM01-106
];

const ORPHANED_TEST_PROCUREMENTS = [
  '6ab60682ba100e37f55c67b9', // for GOM01-102
  '6ab60bfbba100e37f55c6a83'  // for GOM01-105
];

const ORPHANED_TEST_PAYMENTS = [
  '6ab6068cba100e37f55c6896', // for deleted test booking 6ab5f87fb607753a47ac5696
  '6ab60bfeba100e37f55c6ac4', // for deleted test booking 6ab60bf8ba100e37f55c6a64
  '6ab60f0f4dd4fb36545640b9', // for deleted test booking 6ab60f0c4dd4fb3654564044
  '6ab60f334dd4fb3654564177', // for deleted test booking 6ab60f304dd4fb3654564102
  '6ab611008bec0f96c6f96172'  // for deleted test booking 6ab610fc8bec0f96c6f960fb
];

async function cleanOrphanedData() {
  console.log('================================================================');
  console.log('   AGRI NEXUS — DATABASE HYGIENE PURGE ROUTINE                  ');
  console.log('================================================================\n');

  console.log('Connecting to database...');
  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected successfully.\n');

  const toIds = (arr) => arr.map(id => new mongoose.Types.ObjectId(id));

  // 0. Payments
  const payRes = await mongoose.connection.collection('paymentstatuses').deleteMany({
    _id: { $in: toIds(ORPHANED_TEST_PAYMENTS) }
  });
  console.log(`0. Purged ${payRes.deletedCount} orphaned test payments.`);

  // 1. Procurements
  const procRes = await mongoose.connection.collection('procurements').deleteMany({
    _id: { $in: toIds(ORPHANED_TEST_PROCUREMENTS) }
  });
  console.log(`1. Purged ${procRes.deletedCount} orphaned test procurements.`);

  // 2. Queue Entries
  const queueRes = await mongoose.connection.collection('queueentries').deleteMany({
    _id: { $in: toIds(ORPHANED_TEST_QUEUES) }
  });
  console.log(`2. Purged ${queueRes.deletedCount} orphaned test queue entries.`);

  // 3. Bookings
  const bkgRes = await mongoose.connection.collection('bookings').deleteMany({
    _id: { $in: toIds(ORPHANED_TEST_BOOKINGS) }
  });
  console.log(`3. Purged ${bkgRes.deletedCount} orphaned test bookings.`);

  // 4. Users
  const userRes = await mongoose.connection.collection('users').deleteMany({
    _id: { $in: toIds(ORPHANED_TEST_USERS) }
  });
  console.log(`4. Purged ${userRes.deletedCount} orphaned test users.`);

  // Verify Gomti Nagar Centre queue count today
  const activeQueuesToday = await mongoose.connection.collection('queueentries').find({
    queueDate: '2026-09-25'
  }).toArray();
  console.log(`\nRemaining queue entries for today (2026-09-25): ${activeQueuesToday.length}`);
  activeQueuesToday.forEach(q => console.log(`   - Token: ${q.tokenNumber} (State: ${q.state})`));

  // Verify Ramesh Patel bookings
  const ramesh = await mongoose.connection.collection('users').findOne({ phone: '9876543210' });
  const rameshBkgs = await mongoose.connection.collection('bookings').find({
    $or: [{ farmerId: ramesh._id }, { farmerId: ramesh._id.toString() }]
  }).toArray();
  console.log(`\nRamesh Patel historical bookings intact: ${rameshBkgs.length} (Verified)`);

  await mongoose.disconnect();
  console.log('\n================================================================');
  console.log('✔ DATABASE HYGIENE COMPLETE — OPERATIONAL STATE RESTORED        ');
  console.log('================================================================\n');
}

cleanOrphanedData().catch(err => {
  console.error('Purge error:', err);
  process.exit(1);
});
