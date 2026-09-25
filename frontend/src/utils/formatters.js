/**
 * Localization helper for domain models, lifecycle enums, and commodities.
 * Maps backend database enums and technical strings to human-readable i18n keys.
 */

export const getLocalizedStage = (stageKey, t) => {
  if (!stageKey || !t) return '';
  const raw = String(stageKey).trim();
  const lower = raw.toLowerCase();

  // Normalize aliases to canonical enum keys
  let normalizedKey = lower;
  if (lower === 'confirmed' || lower === 'procured') normalizedKey = 'procurement_confirmed';
  if (lower === 'qc' || lower === 'quality') normalizedKey = 'quality_check';
  if (lower === 'verify') normalizedKey = 'verification';
  if (lower === 'weigh') normalizedKey = 'weighing';
  if (lower === 'settled' || lower === 'paid') normalizedKey = 'payment_completed';

  // 1. Check lifecycle namespace
  const lifecycleKey = `lifecycle.${normalizedKey}`;
  const translated = t(lifecycleKey);
  if (translated && translated !== lifecycleKey) return translated;

  // 2. Check status namespace with normalized key
  const statusKey = `status.${normalizedKey}`;
  const statusTranslated = t(statusKey);
  if (statusTranslated && statusTranslated !== statusKey) return statusTranslated;

  // 3. Check status namespace with direct lower key
  const directStatusKey = `status.${lower}`;
  const directTranslated = t(directStatusKey);
  if (directTranslated && directTranslated !== directStatusKey) return directTranslated;

  // Friendly human format fallback
  return raw.replace(/_/g, ' ');
};

export const getLocalizedCrop = (cropName, t) => {
  if (!cropName || !t) return '';
  const raw = String(cropName).trim();
  const key = raw.toLowerCase();
  
  const cropKey = `crops.${key}`;
  const translated = t(cropKey);
  if (translated && translated !== cropKey) return translated;

  return raw;
};

/**
 * Authoritative Government MSP policy rate lookup for client components
 * Department of Consumer Affairs / Ministry of Agriculture
 */
export const getMspRateForCrop = (cropType) => {
  const norm = String(cropType || '').trim().toLowerCase();
  switch (norm) {
    case 'paddy':
    case 'dhan':
      return 2300;
    case 'mustard':
    case 'sarson':
      return 5650;
    case 'pulses':
    case 'dal':
    case 'dalhan':
      return 6600;
    case 'wheat':
    case 'gehun':
    default:
      return 2275;
  }
};

/**
 * Canonical current calendar date in Indian Standard Time (IST / Asia-Kolkata)
 * Returns 'YYYY-MM-DD'
 */
export const getTodayIST = () => {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
};

/**
 * Normalizes any date value (YYYY-MM-DD string, ISO string, Date object)
 * into a canonical 'YYYY-MM-DD' string in Asia/Kolkata timezone.
 */
export const normalizeBookingDate = (dateVal) => {
  if (!dateVal) return '';
  if (typeof dateVal === 'string') {
    const trimmed = dateVal.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    }
    return trimmed.slice(0, 10);
  }
  if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(dateVal);
  }
  return '';
};

/**
 * Terminal statuses that represent completed, canceled, or settled appointments
 */
export const TERMINAL_BOOKING_STATUSES = [
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'PAYMENT_COMPLETED',
  'PAID',
  'NO_SHOW'
];

/**
 * Classifies a booking as UPCOMING vs HISTORY.
 * 
 * Invariants:
 * 1. An upcoming booking MUST have a bookingDate on or after today in IST (bDate >= todayStr).
 * 2. Any booking with bookingDate < todayStr MUST be classified as HISTORY, regardless of stale status
 *    (e.g., BOOKED, WAITING, CONFIRMED, CALLED, etc.).
 * 3. Any booking in a terminal status MUST be classified as HISTORY.
 */
export const isUpcomingBooking = (booking, todayStr = getTodayIST()) => {
  if (!booking) return false;
  const bDate = normalizeBookingDate(booking.bookingDate);
  if (!bDate || bDate < todayStr) {
    return false;
  }
  const op = (booking.operationalStatus || '').toUpperCase();
  const bk = (booking.bookingStatus || '').toUpperCase();
  const st = (booking.status || '').toUpperCase();

  if (
    TERMINAL_BOOKING_STATUSES.includes(op) ||
    TERMINAL_BOOKING_STATUSES.includes(bk) ||
    TERMINAL_BOOKING_STATUSES.includes(st)
  ) {
    return false;
  }

  return true;
};


