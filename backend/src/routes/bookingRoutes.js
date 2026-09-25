const express = require('express');
const router = express.Router();
const { createFarmerBooking, getMyBookings, cancelBooking, getBookingById, advanceBookingLifecycle } = require('../controllers/bookingController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

router.post('/', authenticate, authorize('FARMER'), createFarmerBooking);
router.get('/my', authenticate, authorize('FARMER'), getMyBookings);
router.get('/:id', authenticate, getBookingById);
router.post('/:id/advance-progress', authenticate, advanceBookingLifecycle);
router.post('/:id/cancel', authenticate, authorize('FARMER'), cancelBooking);
router.patch('/:id/cancel', authenticate, authorize('FARMER'), cancelBooking);

module.exports = router;
