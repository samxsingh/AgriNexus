const mongoose = require('mongoose');

// Canonical mapping of predefined district procurement centres
// Links alias codes ('c1'..'c8'), official centreCodes, and seeded MongoDB ObjectIds
const KNOWN_CENTRES = [
  { alias: 'c1', centreCode: 'LKO_GOM01', mongoId: '6a9d1f24c81c8aa68f16c418', name: 'Krishi Seva Procurement Centre — Gomti Nagar' },
  { alias: 'c2', centreCode: 'LKO_ALI02', mongoId: '6a9d1f24c81c8aa68f16c419', name: 'Kisan Suvidha Procurement Centre — Aliganj' },
  { alias: 'c3', centreCode: 'LKO_IND03', mongoId: '6a9d1f24c81c8aa68f16c41a', name: 'Lucknow Grain Procurement Centre — Indira Nagar' },
  { alias: 'c4', centreCode: 'LKO_JAN04', mongoId: '6a9d1f24c81c8aa68f16c41b', name: 'Kisan Seva Centre — Jankipuram' },
  { alias: 'c5', centreCode: 'LKO_ALA05', mongoId: '6a9d1f24c81c8aa68f16c41c', name: 'APMC Sub-Mandi Procurement Centre — Alambagh' },
  { alias: 'c6', centreCode: 'LKO_CHI06', mongoId: '6a9d1f24c81c8aa68f16c41d', name: 'Awadh Krishi Kendra — Chinhat' },
  { alias: 'c7', centreCode: 'LKO_MOH07', mongoId: '6a9d1f24c81c8aa68f16c41e', name: 'Mohan Road Agro Procurement Centre' },
  { alias: 'c8', centreCode: 'LKO_BKT08', mongoId: '6a9d1f24c81c8aa68f16c41f', name: 'Bakshi Ka Talab Kisan Mandi' }
];

/**
 * Get all equivalent representations (synonyms) for a given procurement centre identifier.
 * Works with MongoDB ObjectIds, hex strings, alias codes ('c1'), and centreCodes ('LKO_GOM01').
 * 
 * @param {string|mongoose.Types.ObjectId} centreId
 * @returns {Array<string|mongoose.Types.ObjectId>} Array of matching IDs/codes for MongoDB queries
 */
const getCentreQueryIds = (centreId) => {
  if (!centreId) return [];

  const rawStr = centreId.toString().trim();
  const matchedEntry = KNOWN_CENTRES.find(
    (c) => c.alias === rawStr || c.centreCode === rawStr || c.mongoId === rawStr
  );

  const resultSet = new Set();
  const rawList = [];

  if (matchedEntry) {
    rawList.push(matchedEntry.alias);
    rawList.push(matchedEntry.centreCode);
    rawList.push(matchedEntry.mongoId);
    if (mongoose.Types.ObjectId.isValid(matchedEntry.mongoId)) {
      resultSet.add(new mongoose.Types.ObjectId(matchedEntry.mongoId));
    }
  }

  rawList.push(rawStr);
  if (mongoose.Types.ObjectId.isValid(rawStr)) {
    resultSet.add(new mongoose.Types.ObjectId(rawStr));
  }

  rawList.forEach((item) => resultSet.add(item));

  return Array.from(resultSet);
};

/**
 * Check if two centre identifiers represent the same procurement centre.
 * Supports cross-matching alias ('c1') vs MongoDB ObjectId vs centreCode.
 * 
 * @param {string|mongoose.Types.ObjectId} idA
 * @param {string|mongoose.Types.ObjectId} idB
 * @returns {boolean}
 */
const isSameCentre = (idA, idB) => {
  if (!idA || !idB) return false;
  const strA = idA.toString().trim();
  const strB = idB.toString().trim();
  if (strA === strB) return true;

  const synonymsA = getCentreQueryIds(idA).map((x) => x.toString());
  return synonymsA.includes(strB);
};

/**
 * Resolves a centre identifier to the corresponding MongoDB ProcurementCentre document or inMemory entry.
 * Checks _id, centreCode, and known alias mappings.
 * 
 * @param {string|mongoose.Types.ObjectId} centreId
 * @param {object} ProcurementCentreModel Mongoose model
 * @param {Array} inMemoryCentres Optional fallback array
 * @returns {Promise<object|null>}
 */
const resolveCentre = async (centreId, ProcurementCentreModel, inMemoryCentres = []) => {
  if (!centreId) return null;
  const rawStr = centreId.toString().trim();

  // 1. Direct MongoDB lookup by ObjectId if valid
  if (ProcurementCentreModel && mongoose.Types.ObjectId.isValid(rawStr)) {
    try {
      const doc = await ProcurementCentreModel.findById(rawStr).lean();
      if (doc) return doc;
    } catch (e) {}
  }

  // 2. Lookup via known mapping or centreCode in MongoDB
  const matchedEntry = KNOWN_CENTRES.find(
    (c) => c.alias === rawStr || c.centreCode === rawStr || c.mongoId === rawStr
  );

  if (ProcurementCentreModel && matchedEntry) {
    try {
      const doc = await ProcurementCentreModel.findOne({
        $or: [
          { _id: new mongoose.Types.ObjectId(matchedEntry.mongoId) },
          { centreCode: matchedEntry.centreCode }
        ]
      }).lean();
      if (doc) return doc;
    } catch (e) {}
  }

  // 3. Dynamic lookup by centreCode if rawStr is like 'LKO_...'
  if (ProcurementCentreModel && !matchedEntry && rawStr.includes('_')) {
    try {
      const doc = await ProcurementCentreModel.findOne({ centreCode: rawStr }).lean();
      if (doc) return doc;
    } catch (e) {}
  }

  // 4. Fallback to in-memory centres store
  if (inMemoryCentres && inMemoryCentres.length > 0) {
    const mem = inMemoryCentres.find(
      (c) => c._id === rawStr || c.id === rawStr || c.centreCode === rawStr || (matchedEntry && (c._id === matchedEntry.alias || c.centreCode === matchedEntry.centreCode))
    );
    if (mem) return mem;
  }

  return null;
};

/**
 * Resolves the canonical centre identifier to store in Booking and QueueEntry.
 * Prefers real MongoDB ObjectId when the centre exists in MongoDB.
 * 
 * @param {string|mongoose.Types.ObjectId} centreId
 * @param {object} ProcurementCentreModel
 * @returns {Promise<mongoose.Types.ObjectId|string>}
 */
const resolveCanonicalCentreId = async (centreId, ProcurementCentreModel) => {
  if (!centreId) return 'c1';
  const rawStr = centreId.toString().trim();

  const centreDoc = await resolveCentre(centreId, ProcurementCentreModel);
  if (centreDoc && centreDoc._id) {
    if (mongoose.Types.ObjectId.isValid(centreDoc._id.toString())) {
      return new mongoose.Types.ObjectId(centreDoc._id.toString());
    }
    return centreDoc._id;
  }

  const matchedEntry = KNOWN_CENTRES.find(
    (c) => c.alias === rawStr || c.centreCode === rawStr || c.mongoId === rawStr
  );
  if (matchedEntry && mongoose.Types.ObjectId.isValid(matchedEntry.mongoId)) {
    return new mongoose.Types.ObjectId(matchedEntry.mongoId);
  }

  return centreId;
};

module.exports = {
  KNOWN_CENTRES,
  getCentreQueryIds,
  isSameCentre,
  resolveCentre,
  resolveCanonicalCentreId
};
