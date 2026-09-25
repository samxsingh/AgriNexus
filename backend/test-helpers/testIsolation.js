/**
 * AgriNexus - Test Isolation & Teardown Registry
 * 
 * Provides deterministic tracking and guaranteed cleanup for all entities
 * created during automated test execution. Ensures zero operational queue or
 * MongoDB Atlas contamination.
 */

const mongoose = require('mongoose');
const env = require('../src/config/env');

class TestIsolationRegistry {
  constructor(suiteName = 'Test') {
    this.suiteName = suiteName;
    this.runId = `AGRINEXUS_TEST_RUN_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.registry = {
      users: new Set(),
      bookings: new Set(),
      queueEntries: new Set(),
      procurements: new Set(),
      payments: new Set(),
      staffApplications: new Set()
    };
    this.isTornDown = false;

    // Register process exit listeners for emergency cleanup
    this._setupExitHooks();
  }

  getTestFarmerDetails(prefix = 'Test Farmer') {
    const random8 = Math.floor(10000000 + Math.random() * 90000000);
    return {
      fullName: `[TEST] ${prefix} (${this.runId})`,
      phone: `98${random8}`,
      email: `test_${this.runId.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${random8}@agrinexus.org`,
      password: 'password123',
      state: 'Uttar Pradesh',
      district: 'Lucknow',
      villageName: 'Gomti Nagar'
    };
  }

  registerUser(id) {
    if (id) this.registry.users.add(id.toString());
  }

  registerBooking(id) {
    if (id) this.registry.bookings.add(id.toString());
  }

  registerQueueEntry(id) {
    if (id) this.registry.queueEntries.add(id.toString());
  }

  registerProcurement(id) {
    if (id) this.registry.procurements.add(id.toString());
  }

  registerPayment(id) {
    if (id) this.registry.payments.add(id.toString());
  }

  registerStaffApplication(id) {
    if (id) this.registry.staffApplications.add(id.toString());
  }

  async teardown() {
    if (this.isTornDown) return;
    this.isTornDown = true;

    const totalTracked = 
      this.registry.users.size +
      this.registry.bookings.size +
      this.registry.queueEntries.size +
      this.registry.procurements.size +
      this.registry.payments.size +
      this.registry.staffApplications.size;

    if (totalTracked === 0) {
      return;
    }

    console.log(`\n[Test Isolation - ${this.suiteName}] Teardown initiated for run ${this.runId}...`);
    console.log(`   Tracking: ${this.registry.users.size} users, ${this.registry.bookings.size} bookings, ${this.registry.queueEntries.size} queue entries, ${this.registry.procurements.size} procurements`);

    let needDisconnect = false;
    try {
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(env.MONGODB_URI);
        needDisconnect = true;
      }

      const getValidObjectIds = (set) => {
        return Array.from(set)
          .filter(id => id && mongoose.Types.ObjectId.isValid(id.toString()))
          .map(id => new mongoose.Types.ObjectId(id.toString()));
      };
      const getStringIds = (set) => Array.from(set).map(id => id.toString());

      const userObjIds = getValidObjectIds(this.registry.users);
      const userAllIds = [...userObjIds, ...getStringIds(this.registry.users)];
      const bookingObjIds = getValidObjectIds(this.registry.bookings);
      const bookingAllIds = [...bookingObjIds, ...getStringIds(this.registry.bookings)];
      const queueObjIds = getValidObjectIds(this.registry.queueEntries);
      const queueAllIds = [...queueObjIds, ...getStringIds(this.registry.queueEntries)];
      const procObjIds = getValidObjectIds(this.registry.procurements);
      const procAllIds = [...procObjIds, ...getStringIds(this.registry.procurements)];
      const appObjIds = getValidObjectIds(this.registry.staffApplications);
      const appStrIds = getStringIds(this.registry.staffApplications);

      // In-memory cache purge if present
      try {
        const { inMemoryUsers } = require('../src/middleware/authMiddleware');
        if (inMemoryUsers) {
          for (const uid of this.registry.users) inMemoryUsers.delete(uid);
        }
      } catch (ignored) {}

      // Order of cleanup: Child records first, then parents
      // Direct raw collections for guaranteed deletion with zero schema caching/buffering issues
      const colPayments = mongoose.connection.collection('paymentstatuses');
      const colProcurements = mongoose.connection.collection('procurements');
      const colQueues = mongoose.connection.collection('queueentries');
      const colBookings = mongoose.connection.collection('bookings');
      const colStaffApps = mongoose.connection.collection('staffregistrationapplications');
      const colUsers = mongoose.connection.collection('users');

      // 1. PaymentStatus
      if (bookingAllIds.length > 0 || userAllIds.length > 0) {
        await colPayments.deleteMany({
          $or: [
            { bookingId: { $in: bookingAllIds } },
            { farmerId: { $in: userAllIds } }
          ]
        });
      }

      // 2. Procurement
      if (procObjIds.length > 0 || bookingAllIds.length > 0 || userAllIds.length > 0) {
        const procConditions = [];
        if (procObjIds.length > 0) procConditions.push({ _id: { $in: procObjIds } });
        if (bookingAllIds.length > 0) procConditions.push({ bookingId: { $in: bookingAllIds } });
        if (userAllIds.length > 0) procConditions.push({ farmerId: { $in: userAllIds } });
        await colProcurements.deleteMany({ $or: procConditions });
      }

      // 3. QueueEntry
      if (queueObjIds.length > 0 || bookingAllIds.length > 0 || userAllIds.length > 0) {
        const queueConditions = [];
        if (queueObjIds.length > 0) queueConditions.push({ _id: { $in: queueObjIds } });
        if (bookingAllIds.length > 0) queueConditions.push({ bookingId: { $in: bookingAllIds } });
        if (userAllIds.length > 0) queueConditions.push({ farmerId: { $in: userAllIds } });
        await colQueues.deleteMany({ $or: queueConditions });
      }

      // 4. Booking
      if (bookingObjIds.length > 0 || userAllIds.length > 0) {
        const bookingConditions = [];
        if (bookingObjIds.length > 0) bookingConditions.push({ _id: { $in: bookingObjIds } });
        if (userAllIds.length > 0) bookingConditions.push({ farmerId: { $in: userAllIds } });
        await colBookings.deleteMany({ $or: bookingConditions });
      }

      // 5. Staff Applications
      if (appStrIds.length > 0 || appObjIds.length > 0) {
        const appConditions = [];
        if (appStrIds.length > 0) appConditions.push({ applicationId: { $in: appStrIds } });
        if (appObjIds.length > 0) appConditions.push({ _id: { $in: appObjIds } });
        await colStaffApps.deleteMany({ $or: appConditions });
      }

      // 6. Users (Test farmers/staff)
      if (userObjIds.length > 0) {
        await colUsers.deleteMany({ _id: { $in: userObjIds } });
      }

      console.log(`   ✔ [Test Isolation - ${this.suiteName}] Teardown completed successfully. Database state preserved!\n`);
    } catch (err) {
      console.warn(`   ⚠ [Test Isolation - ${this.suiteName}] Teardown warning:`, err.message);
    } finally {
      if (needDisconnect) {
        try {
          await mongoose.disconnect();
        } catch (e) {}
      }
    }
  }

  _setupExitHooks() {
    const cleanup = async () => {
      if (!this.isTornDown) {
        await this.teardown();
      }
    };
    process.once('beforeExit', cleanup);
    process.once('SIGINT', async () => {
      await cleanup();
      process.exit(130);
    });
    process.once('SIGTERM', async () => {
      await cleanup();
      process.exit(143);
    });
  }
}

module.exports = TestIsolationRegistry;
