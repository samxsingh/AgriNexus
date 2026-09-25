const Booking = require('../models/Booking');
const QueueEntry = require('../models/QueueEntry');
const Slot = require('../models/Slot');
const ProcurementCentre = require('../models/ProcurementCentre');
const { createBooking, inMemoryBookings, inMemoryQueueEntries, inMemorySlots } = require('../services/bookingService');
const { inMemoryCentres } = require('./centreController');
const mongoose = require('mongoose');
const User = require('../models/User');
const { isSameCentre, getCentreQueryIds, KNOWN_CENTRES, resolveCentre } = require('../utils/centreUtils');

// Helper for dual-type ObjectId / String query matching
const toQueryIds = (idVal) => {
  if (!idVal) return [];
  const list = Array.isArray(idVal) ? idVal : [idVal];
  const result = [];
  for (const item of list) {
    if (!item) continue;
    const str = item.toString();
    result.push(str);
    if (mongoose.Types.ObjectId.isValid(str)) {
      try {
        result.push(new mongoose.Types.ObjectId(str));
      } catch (e) {}
    }
  }
  return result;
};

const createFarmerBooking = async (req, res, next) => {
  try {
    const farmerId = req.user.id || req.user._id;
    const { centreId, slotId, cropType, estimatedQuantityQuintals } = req.body;

    if (!centreId || !slotId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'Centre ID and Slot ID are required.'
        }
      });
    }
    const io = req.app.get('io');

    const booking = await createBooking({
      farmerId,
      centreId,
      slotId,
      cropType: cropType || 'Wheat',
      estimatedQuantityQuintals: Number(estimatedQuantityQuintals) || 50,
      io
    });

    // Populate centre info for response
    let centre = await resolveCentre(centreId, ProcurementCentre, inMemoryCentres);
    if (!centre) {
      centre = inMemoryCentres.find((c) => c._id === centreId || c.id === centreId) || inMemoryCentres[0];
    }

    const bookingObj = booking.toObject ? booking.toObject() : booking;

    res.status(201).json({
      success: true,
      message: 'Procurement slot booked successfully!',
      data: {
        booking: {
          ...bookingObj,
          _id: booking._id ? booking._id.toString() : booking.id,
          id: booking._id ? booking._id.toString() : booking.id,
          centreName: centre.name,
          centreAddress: centre.address,
          centrePhone: centre.contactPhone,
          assignedStaffName: bookingObj.assignedStaffName,
          assignedStaffDesignation: bookingObj.assignedStaffDesignation,
          assignmentStatus: bookingObj.assignmentStatus || 'PENDING'
        }
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: {
        code: 'BOOKING_FAILED',
        message: error.message
      }
    });
  }
};

const getMyBookings = async (req, res, next) => {
  try {
    const farmerId = req.user.id || req.user._id;
    const farmerQuery = toQueryIds(farmerId);

    // 1. Fetch centres safely to map legacy 'c1' and ObjectIds without Mongoose CastError
    let allCentres = [];
    try {
      allCentres = await ProcurementCentre.find().lean();
    } catch (e) {
      allCentres = [];
    }

    const centreMap = new Map();
    const inMemList = Array.isArray(inMemoryCentres)
      ? inMemoryCentres
      : (inMemoryCentres?.values ? Array.from(inMemoryCentres.values()) : []);

    for (const c of inMemList) {
      if (c._id) centreMap.set(c._id.toString(), c);
      if (c.id) centreMap.set(c.id.toString(), c);
      if (c.centreCode) centreMap.set(c.centreCode, c);
    }
    for (const c of allCentres) {
      const cId = c._id ? c._id.toString() : c.id;
      if (cId) centreMap.set(cId, c);
      if (c.centreCode) centreMap.set(c.centreCode, c);
    }
    for (const kc of KNOWN_CENTRES) {
      const targetCentre = centreMap.get(kc.mongoId) || centreMap.get(kc.centreCode);
      if (targetCentre) {
        centreMap.set(kc.alias, targetCentre);
      }
    }

    const defaultCentre = centreMap.get('c1') || centreMap.get('6a9d1f24c81c8aa68f16c418') || {
      _id: '6a9d1f24c81c8aa68f16c418',
      name: 'Krishi Seva Procurement Centre — Gomti Nagar',
      address: 'Vibhuti Khand, Gomti Nagar, Lucknow',
      district: 'Lucknow',
      contactPhone: '+91 522 2720011',
      centreCode: 'LKO_GOM01'
    };

    let bookings = [];
    try {
      bookings = await Booking.find({ farmerId: { $in: farmerQuery } })
        .sort({ createdAt: -1 })
        .lean();
    } catch (dbErr) {
      bookings = [];
    }

    if (!bookings || bookings.length === 0) {
      for (const [, b] of inMemoryBookings) {
        const bFarmer = (b.farmerId?._id || b.farmerId || '').toString();
        if (farmerQuery.some((fq) => fq.toString() === bFarmer)) {
          bookings.push(b);
        }
      }
    }

    // Attach resolved centre to each booking
    bookings = bookings.map((b) => {
      const rawCId = b.centreId?._id || b.centreId?.id || b.centreId;
      const rawStr = rawCId ? rawCId.toString() : 'c1';
      const resolvedCentre = centreMap.get(rawStr) || defaultCentre;
      return {
        ...b,
        centreId: resolvedCentre,
        centre: resolvedCentre
      };
    });

    // Enrich active bookings with real queue calculations
    const bookingIds = bookings.map((b) => b._id || b.id);
    let queueEntries = [];
    try {
      queueEntries = await QueueEntry.find({ bookingId: { $in: toQueryIds(bookingIds) } }).lean();
    } catch (qeErr) {
      queueEntries = [];
    }

    const formattedBookings = await Promise.all(
      bookings.map(async (b) => {
        const bIdStr = (b._id || b.id).toString();
        let qEntry = queueEntries.find((qe) => (qe.bookingId?._id || qe.bookingId)?.toString() === bIdStr);
        if (!qEntry) {
          for (const [, qe] of inMemoryQueueEntries) {
            if ((qe.bookingId?._id || qe.bookingId)?.toString() === bIdStr) {
              qEntry = qe;
              break;
            }
          }
        }

        const opStatus = qEntry?.state || b.operationalStatus || (b.bookingStatus === 'COMPLETED' ? 'COMPLETED' : b.bookingStatus === 'CANCELLED' ? 'CANCELLED' : 'BOOKED');
        const centreId = b.centreId?._id || b.centreId?.id || b.centreId;
        const queueDate = b.bookingDate;

        let queuePosition = null;
        let farmersAhead = 0;
        let estimatedWaitMinutes = 0;
        let currentlyServingToken = 'LKO-101';
        let assignedStation = qEntry?.counterId || 'Counter 01';

        if (qEntry) {
          assignedStation = qEntry.counterId || 'Counter 01';

          if (opStatus === 'WAITING') {
            try {
              const earlierWaitingCount = await QueueEntry.countDocuments({
                centreId: { $in: getCentreQueryIds(centreId) },
                queueDate,
                state: 'WAITING',
                sequenceNumber: { $lt: qEntry.sequenceNumber }
              });
              queuePosition = earlierWaitingCount + 1;
              farmersAhead = earlierWaitingCount;
              estimatedWaitMinutes = Math.max(6, farmersAhead * 6);
            } catch (cntErr) {
              farmersAhead = Math.max(0, (qEntry.sequenceNumber || 1) - 1);
              queuePosition = farmersAhead + 1;
              estimatedWaitMinutes = Math.max(6, farmersAhead * 6);
            }

            try {
              const serving = await QueueEntry.findOne({
                centreId: { $in: getCentreQueryIds(centreId) },
                queueDate,
                state: { $in: ['CALLED', 'ARRIVED', 'VERIFICATION', 'QUALITY_CHECK', 'WEIGHING'] }
              }).sort({ updatedAt: -1 }).lean();
              if (serving) {
                currentlyServingToken = serving.tokenNumber;
              }
            } catch (srvErr) {
              // fallback
            }
          } else if (opStatus === 'CALLED') {
            queuePosition = 1;
            farmersAhead = 0;
            estimatedWaitMinutes = 0;
            currentlyServingToken = b.tokenNumber;
          } else if (['ARRIVED', 'VERIFICATION', 'QUALITY_CHECK', 'WEIGHING'].includes(opStatus)) {
            queuePosition = 1;
            farmersAhead = 0;
            estimatedWaitMinutes = 0;
            currentlyServingToken = b.tokenNumber;
          }
        }

        return {
          _id: bIdStr,
          id: bIdStr,
          bookingReference: b.bookingReference,
          tokenNumber: b.tokenNumber,
          bookingDate: b.bookingDate,
          timeWindow: b.timeWindow,
          cropType: b.cropType,
          estimatedQuantityQuintals: b.estimatedQuantityQuintals,
          bookingStatus: b.bookingStatus,
          operationalStatus: opStatus,
          statusHistory: b.statusHistory || [],
          assignedStaffName: b.assignedStaffName,
          assignedStaffDesignation: b.assignedStaffDesignation,
          assignmentStatus: b.assignmentStatus || 'PENDING',
          createdAt: b.createdAt,
          queuePosition,
          farmersAhead,
          estimatedWaitMinutes,
          currentlyServingToken,
          assignedStation,
          counterId: assignedStation,
          centre: b.centre || b.centreId || defaultCentre
        };
      })
    );

    res.status(200).json({
      success: true,
      count: formattedBookings.length,
      data: formattedBookings
    });
  } catch (error) {
    next(error);
  }
};

const cancelBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    const farmerId = req.user.id || req.user._id;
    const farmerIdStr = farmerId ? farmerId.toString() : '';
    const io = req.app.get('io');

    let booking = null;
    try {
      booking = await Booking.findOne({
        _id: { $in: toQueryIds(id) },
        farmerId: { $in: toQueryIds(farmerId) }
      });
      if (booking) {
        booking.bookingStatus = 'CANCELLED';
        booking.status = 'CANCELLED';
        booking.operationalStatus = 'CANCELLED';
        booking.cancelledAt = new Date();
        await booking.save();
      }
    } catch (err) {
      booking = inMemoryBookings.get(id);
      if (booking) {
        booking.bookingStatus = 'CANCELLED';
        booking.status = 'CANCELLED';
        booking.operationalStatus = 'CANCELLED';
        booking.cancelledAt = new Date();
      }
    }

    if (!booking) {
      for (const [, b] of inMemoryBookings) {
        const bFarmer = b.farmerId?._id ? b.farmerId._id.toString() : (b.farmerId ? b.farmerId.toString() : '');
        if ((b.id === id || b._id === id || b.bookingReference === id) && (!farmerIdStr || bFarmer === farmerIdStr)) {
          booking = b;
          booking.bookingStatus = 'CANCELLED';
          booking.status = 'CANCELLED';
          booking.operationalStatus = 'CANCELLED';
          booking.cancelledAt = new Date();
          break;
        }
      }
    }

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found or unauthorized.'
        }
      });
    }

    const bIdStr = (booking._id || booking.id).toString();
    const centreId = booking.centreId?._id ? booking.centreId._id.toString() : (booking.centreId ? booking.centreId.toString() : '');

    // 1. Cancel QueueEntry in DB and in-memory
    try {
      await QueueEntry.findOneAndUpdate(
        { bookingId: { $in: toQueryIds(booking._id || id) } },
        { $set: { state: 'CANCELLED', cancelledAt: new Date() } }
      );
    } catch (qErr) {
      // ignore
    }
    for (const [, qe] of inMemoryQueueEntries) {
      const qeBId = qe.bookingId?._id ? qe.bookingId._id.toString() : (qe.bookingId ? qe.bookingId.toString() : '');
      if (qeBId === bIdStr || qeBId === id) {
        qe.state = 'CANCELLED';
        qe.cancelledAt = new Date();
        break;
      }
    }

    // 2. Release capacity on Slot
    const slotId = booking.slotId?._id || booking.slotId;
    const qty = Number(booking.estimatedQuantityQuintals || 0);
    if (slotId) {
      try {
        await Slot.findByIdAndUpdate(slotId, {
          $inc: { bookedFarmersCount: -1, bookedCapacityQuintals: -qty },
          $set: { status: 'AVAILABLE' }
        });
      } catch (sErr) {
        const s = inMemorySlots.get(slotId.toString());
        if (s) {
          s.bookedFarmersCount = Math.max(0, (s.bookedFarmersCount || 1) - 1);
          s.bookedCapacityQuintals = Math.max(0, (s.bookedCapacityQuintals || qty) - qty);
          s.status = 'AVAILABLE';
        }
      }
    }

    // 3. Broadcast Socket Events
    if (io) {
      const cancelPayload = {
        bookingId: bIdStr,
        tokenNumber: booking.tokenNumber,
        state: 'CANCELLED',
        cancelledAt: new Date()
      };
      if (centreId) {
        for (const syn of getCentreQueryIds(centreId)) {
          io.to(`centre_${syn}`).emit('queue:updated', cancelPayload);
          io.to(`centre_${syn}`).emit('queue:cancelled', cancelPayload);
        }
      }
      if (farmerIdStr) {
        io.to(`farmer_${farmerIdStr}`).emit('queue:updated', cancelPayload);
      }
      io.to('admin_global').emit('queue:updated', { ...cancelPayload, centreId });
    }

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully.',
      data: { booking }
    });
  } catch (error) {
    next(error);
  }
};

const getBookingById = async (req, res, next) => {
  try {
    const { id } = req.params;

    let booking = null;
    try {
      booking = await Booking.findById(id).lean();
    } catch (dbErr) {
      booking = null;
    }

    if (!booking) {
      try {
        booking = await Booking.findOne({ bookingReference: id }).lean();
      } catch (e2) {}
    }

    if (!booking) {
      booking = inMemoryBookings.get(id);
      if (!booking) {
        for (const [, b] of inMemoryBookings) {
          if (b.id === id || b._id === id || b.bookingReference === id) {
            booking = b;
            break;
          }
        }
      }
    }

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' }
      });
    }

    // Resolve centre safely
    const rawCId = booking.centreId?._id || booking.centreId?.id || booking.centreId;
    let centre = await resolveCentre(rawCId, ProcurementCentre, inMemoryCentres);
    if (!centre) {
      centre = inMemoryCentres.find((c) => c._id === rawCId || c.id === rawCId) || inMemoryCentres[0];
    }
    booking.centre = centre;
    booking.centreId = centre;

    // Resolve farmer safely
    if (booking.farmerId && mongoose.Types.ObjectId.isValid((booking.farmerId._id || booking.farmerId).toString())) {
      try {
        const farmerDoc = await User.findById(booking.farmerId._id || booking.farmerId).select('fullName phone district villageName').lean();
        if (farmerDoc) booking.farmerId = farmerDoc;
      } catch (fErr) {}
    }

    // Role-based authorization & ownership check:
    // If user is a FARMER, ensure the booking belongs to this farmer
    const userId = req.user.id || req.user._id;
    if (req.user.role === 'FARMER') {
      const bookingFarmerId = booking.farmerId?._id ? booking.farmerId._id.toString() : (booking.farmerId ? booking.farmerId.toString() : '');
      if (bookingFarmerId && bookingFarmerId !== userId.toString()) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not have permission to access this booking.' }
        });
      }
    } else if (req.user.role === 'CENTRE_STAFF') {
      const staffCentreId = req.user.assignedCentreId ? req.user.assignedCentreId.toString() : '';
      const bookingCentreId = centre?._id ? centre._id.toString() : (booking.centreId ? booking.centreId.toString() : '');
      if (staffCentreId && bookingCentreId && !isSameCentre(staffCentreId, bookingCentreId)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Staff can only view bookings for their assigned procurement centre.' }
        });
      }
    }

    const bIdStr = (booking._id || booking.id).toString();
    let qEntry = null;
    try {
      qEntry = await QueueEntry.findOne({ bookingId: { $in: toQueryIds(bIdStr) } }).lean();
    } catch (e) {}

    if (!qEntry) {
      for (const [, qe] of inMemoryQueueEntries) {
        if ((qe.bookingId?._id || qe.bookingId)?.toString() === bIdStr) {
          qEntry = qe;
          break;
        }
      }
    }

    const bookingObj = booking.toObject ? booking.toObject() : booking;
    const currentOpStatus = qEntry?.state || bookingObj.operationalStatus || (bookingObj.bookingStatus === 'COMPLETED' ? 'COMPLETED' : 'BOOKED');

    res.status(200).json({
      success: true,
      data: {
        ...bookingObj,
        id: bIdStr,
        operationalStatus: currentOpStatus,
        counterId: qEntry?.counterId || 'Counter 1',
        assignedStation: qEntry?.counterId || 'Counter 1',
        queueState: qEntry?.state || currentOpStatus,
        centre: {
          id: centre._id || centre.id,
          name: centre.name,
          address: centre.address,
          contactPhone: centre.contactPhone,
          centreCode: centre.centreCode,
          district: centre.district,
          location: centre.location
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

const advanceBookingLifecycle = async (req, res, next) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');
    const { transitionQueueState } = require('../services/queueEngine');

    // 1. Fetch booking (support ID or bookingReference)
    let booking = null;
    try {
      booking = await Booking.findById(id).lean();
    } catch (e) {}

    if (!booking) {
      try {
        booking = await Booking.findOne({ bookingReference: id }).lean();
      } catch (e) {}
    }

    if (!booking) {
      booking = inMemoryBookings.get(id);
      if (!booking) {
        for (const [, b] of inMemoryBookings) {
          if (b.id === id || b._id === id || b.bookingReference === id) {
            booking = b;
            break;
          }
        }
      }
    }

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' }
      });
    }

    const bIdStr = (booking._id || booking.id).toString();

    // 2. Find or create QueueEntry
    let qEntry = null;
    try {
      qEntry = await QueueEntry.findOne({ bookingId: { $in: toQueryIds(bIdStr) } });
    } catch (e) {}

    if (!qEntry) {
      for (const [, qe] of inMemoryQueueEntries) {
        if ((qe.bookingId?._id || qe.bookingId)?.toString() === bIdStr) {
          qEntry = qe;
          break;
        }
      }
    }

    const centreIdStr = (booking.centreId?._id || booking.centreId || 'c1').toString();
    const farmerIdStr = (booking.farmerId?._id || booking.farmerId || req.user.id || req.user._id).toString();

    if (!qEntry) {
      try {
        qEntry = await QueueEntry.create({
          bookingId: booking._id || bIdStr,
          farmerId: booking.farmerId?._id || farmerIdStr,
          centreId: booking.centreId?._id || centreIdStr,
          slotId: booking.slotId || 'slot_default',
          tokenNumber: booking.tokenNumber,
          queueDate: booking.bookingDate,
          sequenceNumber: 1,
          state: booking.operationalStatus || 'WAITING',
          counterId: 'Counter 1'
        });
      } catch (err) {
        qEntry = {
          _id: 'qe_' + Date.now(),
          bookingId: bIdStr,
          farmerId: farmerIdStr,
          centreId: centreIdStr,
          slotId: booking.slotId || 'slot_default',
          tokenNumber: booking.tokenNumber,
          queueDate: booking.bookingDate,
          sequenceNumber: 1,
          state: booking.operationalStatus || 'WAITING',
          counterId: 'Counter 1'
        };
        inMemoryQueueEntries.set(qEntry._id, qEntry);
      }
    }

    // 3. Determine next canonical lifecycle state
    const CANONICAL_FLOW = [
      'BOOKED',
      'WAITING',
      'CALLED',
      'ARRIVED',
      'VERIFICATION',
      'QUALITY_CHECK',
      'WEIGHING',
      'PROCUREMENT_CONFIRMED',
      'PAYMENT_PROCESSING',
      'PAYMENT_COMPLETED'
    ];

    const currentState = qEntry.state || booking.operationalStatus || 'WAITING';
    const normCurrent = currentState.toUpperCase().replace(/\s+/g, '_');
    const currentIndex = CANONICAL_FLOW.indexOf(normCurrent);

    if (currentIndex >= CANONICAL_FLOW.length - 1) {
      return res.status(200).json({
        success: true,
        message: 'Booking has reached terminal stage PAYMENT_COMPLETED.',
        data: {
          booking,
          queueEntry: qEntry,
          currentStage: 'PAYMENT_COMPLETED'
        }
      });
    }

    const targetState = CANONICAL_FLOW[currentIndex === -1 ? 1 : currentIndex + 1];

    // 4. Transition queue state
    const qeId = qEntry._id ? qEntry._id.toString() : qEntry.id;
    const updatedEntry = await transitionQueueState({
      queueEntryId: qeId,
      targetState,
      staffUser: req.user,
      counterId: qEntry.counterId || 'Counter 1',
      notes: `Advancement to ${targetState}`,
      payload: {
        cropType: booking.cropType || 'Wheat',
        declaredQuantityQuintals: booking.estimatedQuantityQuintals || 50,
        netWeightQuintals: booking.estimatedQuantityQuintals || 50,
        qualityGrade: 'Grade A',
        moisturePercentage: 11.8
      },
      io
    });

    // 5. Re-fetch updated booking
    let updatedBooking = null;
    try {
      updatedBooking = await Booking.findById(booking._id || bIdStr).lean();
    } catch (e) {
      updatedBooking = inMemoryBookings.get(bIdStr);
    }
    if (!updatedBooking) {
      updatedBooking = inMemoryBookings.get(bIdStr) || booking;
    }

    res.status(200).json({
      success: true,
      message: `Procurement progress advanced to ${targetState}`,
      data: {
        booking: {
          ...updatedBooking,
          id: bIdStr,
          operationalStatus: targetState
        },
        queueEntry: updatedEntry,
        currentStage: targetState
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createFarmerBooking,
  getMyBookings,
  cancelBooking,
  getBookingById,
  advanceBookingLifecycle
};

