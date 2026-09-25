const { getPaymentStatusByBooking, updatePaymentStage } = require('../services/paymentService');
const { dispatchNotification } = require('../services/notificationService');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { inMemoryBookings } = require('../services/bookingService');
const { inMemoryUsers } = require('../middleware/authMiddleware');
const { isSameCentre } = require('../utils/centreUtils');

const getPaymentStatus = async (req, res, next) => {
  try {
    const { bookingId } = req.params;

    let booking = null;
    try {
      booking = await Booking.findById(bookingId);
    } catch (e) {
      // Fallback
    }

    if (booking) {
      const userId = req.user.id || req.user._id;
      if (req.user.role === 'FARMER') {
        const bFarmerId = booking.farmerId?._id ? booking.farmerId._id.toString() : (booking.farmerId ? booking.farmerId.toString() : '');
        if (bFarmerId && bFarmerId !== userId.toString()) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You do not have permission to view payment details for this booking.' }
          });
        }
      } else if (req.user.role === 'CENTRE_STAFF') {
        const staffCentreId = req.user.assignedCentreId ? req.user.assignedCentreId.toString() : '';
        const bCentreId = booking.centreId?._id ? booking.centreId._id.toString() : (booking.centreId ? booking.centreId.toString() : '');
        if (staffCentreId && bCentreId && !isSameCentre(staffCentreId, bCentreId)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Staff can only view payments for their assigned procurement centre.' }
          });
        }
      }
    }

    const payment = await getPaymentStatusByBooking(bookingId);

    res.status(200).json({
      success: true,
      data: payment
    });
  } catch (error) {
    next(error);
  }
};

const handleUpdatePaymentStage = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const { newStage, remarks, totalAmount } = req.body;
    const io = req.app.get('io');

    let booking = null;
    try {
      booking = await Booking.findById(bookingId).populate('farmerId');
    } catch (e) {
      // Fallback
    }

    if (!booking) {
      booking = inMemoryBookings.get(bookingId);
      if (!booking) {
        for (const [, b] of inMemoryBookings) {
          if (b.id === bookingId || b._id === bookingId || b.bookingReference === bookingId) {
            booking = b;
            break;
          }
        }
      }
    }

    if (booking && req.user.role === 'CENTRE_STAFF') {
      const staffCentreId = req.user.assignedCentreId ? req.user.assignedCentreId.toString() : '';
      const bCentreId = booking.centreId?._id ? booking.centreId._id.toString() : (booking.centreId ? booking.centreId.toString() : '');
      if (staffCentreId && bCentreId && !isSameCentre(staffCentreId, bCentreId)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Staff can only update payment stages for their assigned procurement centre.' }
        });
      }
    }

    let farmerUser = null;
    if (booking?.farmerId && typeof booking.farmerId === 'object' && booking.farmerId.phone) {
      farmerUser = booking.farmerId;
    } else if (booking?.farmerId) {
      const fId = (booking.farmerId._id || booking.farmerId).toString();
      try {
        farmerUser = await User.findById(fId);
      } catch (e) {
        farmerUser = inMemoryUsers.get(fId);
      }
      if (!farmerUser) {
        farmerUser = inMemoryUsers.get(fId);
      }
    }

    const farmerId = farmerUser ? (farmerUser._id || farmerUser.id).toString() : (booking?.farmerId ? (booking.farmerId._id || booking.farmerId).toString() : req.user.id);
    const farmerPhone = farmerUser?.phone || booking?.farmerPhone;

    const updatedPayment = await updatePaymentStage({
      bookingId,
      farmerId,
      newStage,
      totalAmount,
      role: req.user.role,
      remarks,
      io
    });

    // Notify farmer of payment stage progression
    dispatchNotification({
      userId: farmerId,
      phone: farmerPhone,
      title: 'Payment Status Updated',
      message: `Your procurement payment status updated to: ${newStage.replace(/_/g, ' ')}. Ref: ${updatedPayment.demoReferenceNumber}`,
      event: 'PAYMENT_STATUS_UPDATED',
      io
    });

    // Broadcast Real-Time Payment Event
    if (io) {
      const payPayload = {
        bookingId,
        farmerId,
        currentStage: updatedPayment.currentStage,
        totalAmount: updatedPayment.totalAmount,
        demoReferenceNumber: updatedPayment.demoReferenceNumber,
        updatedAt: new Date()
      };
      const centreId = booking?.centreId?._id ? booking.centreId._id.toString() : (booking?.centreId ? booking.centreId.toString() : '');
      if (centreId) io.to(`centre_${centreId}`).emit('payment:updated', payPayload);
      if (farmerId) io.to(`farmer_${farmerId}`).emit('payment:updated', payPayload);
      io.to('admin_global').emit('payment:updated', { ...payPayload, centreId });
    }

    res.status(200).json({
      success: true,
      message: `Payment stage updated to ${newStage}`,
      data: updatedPayment
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: { code: 'PAYMENT_STAGE_UPDATE_FAILED', message: error.message }
    });
  }
};

module.exports = {
  getPaymentStatus,
  handleUpdatePaymentStage
};
