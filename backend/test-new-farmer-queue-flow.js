const http = require('http');

const PORT = process.env.PORT || 5001;

function makeRequest(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json'
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers
      },
      (res) => {
        let resBody = '';
        res.on('data', (chunk) => (resBody += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(resBody) });
          } catch (e) {
            resolve({ status: res.statusCode, body: resBody });
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function getTodayIST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

async function runTest() {
  console.log('========================================================================');
  console.log('🌾 E2E & REGRESSION AUDIT: BOOKING HISTORY, SAME-DAY & QUEUE INTEGRITY');
  console.log('========================================================================\n');

  const todayIST = getTodayIST();
  console.log(`[Context] Operational Date IST: ${todayIST}`);

  // -------------------------------------------------------------------------
  // TEST A: Existing booking visibility for historical farmer (Ramesh Patel)
  // -------------------------------------------------------------------------
  console.log('\n[TEST A] Existing Farmer Booking History Visibility (Ramesh Patel)...');
  const demoFarmerLogin = await makeRequest('/api/auth/login', 'POST', {
    phone: '9876543210',
    password: 'password123'
  });
  if (demoFarmerLogin.status !== 200 || !demoFarmerLogin.body.data?.token) {
    throw new Error(`Demo farmer login failed: ${JSON.stringify(demoFarmerLogin.body)}`);
  }
  const demoToken = demoFarmerLogin.body.data.token;
  console.log(`   ✔ Logged in as Ramesh Patel (${demoFarmerLogin.body.data.user._id || demoFarmerLogin.body.data.user.id})`);

  const demoBookingsRes = await makeRequest('/api/bookings/my', 'GET', null, demoToken);
  if (demoBookingsRes.status !== 200 || !Array.isArray(demoBookingsRes.body.data)) {
    throw new Error(`GET /api/bookings/my failed: ${JSON.stringify(demoBookingsRes.body)}`);
  }
  const demoBookings = demoBookingsRes.body.data;
  console.log(`   ✔ Retrieved ${demoBookings.length} historical bookings for Ramesh Patel!`);
  if (demoBookings.length < 5) {
    throw new Error(`Expected at least 5 historical bookings for Ramesh Patel, got ${demoBookings.length}`);
  }

  // Verify all bookings have resolved centre details (not string 'c1' or undefined)
  for (const b of demoBookings) {
    if (!b.centre || !b.centre.name) {
      throw new Error(`Booking ${b.tokenNumber} has unpopulated centre details!`);
    }
  }
  console.log('   ✔ All historical bookings have fully resolved centre details (no CastError)!');

  // Verify live queue ticket endpoint does not crash
  const demoTicketRes = await makeRequest('/api/queue/farmer-status', 'GET', null, demoToken);
  console.log(`   ✔ GET /api/queue/farmer-status returned status ${demoTicketRes.status}`);

  // -------------------------------------------------------------------------
  // TEST B: Register new farmer and create 1st booking
  // -------------------------------------------------------------------------
  console.log('\n[TEST B] Registering Fresh Farmer and Creating 1st Booking...');
  const randSuffix = Math.floor(10000000 + Math.random() * 90000000);
  const newPhone = `98${randSuffix}`;
  const registerPayload = {
    phone: newPhone,
    password: 'FarmerPassword123!',
    fullName: `Kisan E2E Verify ${randSuffix}`,
    villageName: 'Vikas Nagar Gram',
    district: 'Lucknow',
    state: 'Uttar Pradesh'
  };

  const regRes = await makeRequest('/api/auth/register', 'POST', registerPayload);
  if (regRes.status !== 201 || !regRes.body.data?.token) {
    throw new Error(`Farmer registration failed: ${JSON.stringify(regRes.body)}`);
  }
  const newFarmerToken = regRes.body.data.token;
  const newFarmerId = regRes.body.data.user._id || regRes.body.data.user.id;
  console.log(`   ✔ Farmer registered! ID: ${newFarmerId}, Name: ${regRes.body.data.user.fullName}`);

  // Fetch slots for today using centre alias 'c1'
  const slotsRes = await makeRequest(`/api/slots?centreId=c1&date=${todayIST}`, 'GET', null, newFarmerToken);
  if (slotsRes.status !== 200 || !slotsRes.body.data || slotsRes.body.data.length < 2) {
    throw new Error(`Failed to fetch slots for today: ${JSON.stringify(slotsRes.body)}`);
  }
  const slot1 = slotsRes.body.data[0];
  const slot2 = slotsRes.body.data[1];
  const slot1Id = slot1._id || slot1.id;
  const slot2Id = slot2._id || slot2.id;
  console.log(`   ✔ Selected Slot 1 (${slot1.timeWindow}) and Slot 2 (${slot2.timeWindow})`);

  // Book 1st slot with centreId='c1'
  const book1Res = await makeRequest('/api/bookings', 'POST', {
    centreId: 'c1',
    slotId: slot1Id,
    cropType: 'Wheat',
    estimatedQuantityQuintals: 45
  }, newFarmerToken);
  if (book1Res.status !== 201 || !book1Res.body.data?.booking) {
    throw new Error(`Booking 1 creation failed: ${JSON.stringify(book1Res.body)}`);
  }
  const booking1 = book1Res.body.data.booking;
  const booking1Id = booking1._id || booking1.id;
  const token1 = booking1.tokenNumber;
  console.log(`   ✔ Booking 1 created! Token: ${token1}, ID: ${booking1Id}`);

  // -------------------------------------------------------------------------
  // TEST C: Active Duplicate Booking is Blocked on the Same Date
  // -------------------------------------------------------------------------
  console.log('\n[TEST C] Active Duplicate Booking Protection (Attempting 2nd booking while 1st is ACTIVE)...');
  const duplicateRes = await makeRequest('/api/bookings', 'POST', {
    centreId: 'c1',
    slotId: slot2Id,
    cropType: 'Mustard',
    estimatedQuantityQuintals: 20
  }, newFarmerToken);
  if (duplicateRes.status !== 400 || !duplicateRes.body.error?.message?.includes('active procurement booking')) {
    throw new Error(`Expected active duplicate booking to be blocked with 400, got ${duplicateRes.status}: ${JSON.stringify(duplicateRes.body)}`);
  }
  console.log(`   ✔ Correctly blocked! Error: "${duplicateRes.body.error.message}"`);

  // -------------------------------------------------------------------------
  // TEST D: Verify Queue Ingestion & Staff Visibility
  // -------------------------------------------------------------------------
  console.log('\n[TEST D] Verifying Booking 1 in Staff Queue & Progressing to COMPLETED...');
  const staffLoginRes = await makeRequest('/api/auth/login', 'POST', {
    email: 'gomtinagar.centre@agrinexus.demo',
    password: 'password123'
  });
  if (staffLoginRes.status !== 200 || !staffLoginRes.body.data?.token) {
    throw new Error(`Staff login failed: ${JSON.stringify(staffLoginRes.body)}`);
  }
  const staffToken = staffLoginRes.body.data.token;
  const staffCentreId = staffLoginRes.body.data.user.assignedCentreId;

  const queueRes = await makeRequest(`/api/queue/today?centreId=${staffCentreId}`, 'GET', null, staffToken);
  const queueList = Array.isArray(queueRes.body.data) ? queueRes.body.data : (queueRes.body.data?.queue || []);
  const matchedQ = queueList.find(q => q.tokenNumber === token1);
  if (!matchedQ) {
    throw new Error(`Booking 1 (${token1}) was NOT found in staff queue! Total in queue: ${queueList.length}`);
  }
  console.log(`   ✔ Found token ${token1} in staff queue! QueueEntry ID: ${matchedQ._id || matchedQ.id}`);

  // Progress Booking 1 from WAITING -> CALLED -> ARRIVED -> VERIFICATION -> WEIGHING -> COMPLETED
  const qEntryId = matchedQ._id || matchedQ.id;
  for (const nextState of ['CALLED', 'ARRIVED', 'VERIFICATION', 'WEIGHING', 'COMPLETED']) {
    const transRes = await makeRequest(`/api/queue/${qEntryId}/transition`, 'POST', {
      targetState: nextState,
      notes: `Automated lifecycle step: ${nextState}`
    }, staffToken);
    if (transRes.status !== 200) {
      throw new Error(`Transition to ${nextState} failed: ${JSON.stringify(transRes.body)}`);
    }
  }
  console.log(`   ✔ Booking 1 successfully completed through all operational stages!`);

  // -------------------------------------------------------------------------
  // TEST E: Same-Day Rebooking ALLOWED After Completion
  // -------------------------------------------------------------------------
  console.log('\n[TEST E] Same-Day Rebooking After Previous Booking Completed...');
  const book2Res = await makeRequest('/api/bookings', 'POST', {
    centreId: 'c1',
    slotId: slot2Id,
    cropType: 'Mustard',
    estimatedQuantityQuintals: 30
  }, newFarmerToken);
  if (book2Res.status !== 201 || !book2Res.body.data?.booking) {
    throw new Error(`Same-day rebooking after completion failed: ${JSON.stringify(book2Res.body)}`);
  }
  const booking2 = book2Res.body.data.booking;
  const booking2Id = booking2._id || booking2.id;
  const token2 = booking2.tokenNumber;
  console.log(`   ✔ Same-day rebooking SUCCEEDED! New Token: ${token2}, ID: ${booking2Id}`);

  // -------------------------------------------------------------------------
  // TEST F: Farmer Booking History Retains ALL Records (Completed + Active)
  // -------------------------------------------------------------------------
  console.log('\n[TEST F] Farmer Booking History Retains Both Completed and New Active Bookings...');
  const farmerHistoryRes = await makeRequest('/api/bookings/my', 'GET', null, newFarmerToken);
  if (farmerHistoryRes.status !== 200 || !Array.isArray(farmerHistoryRes.body.data)) {
    throw new Error(`GET /api/bookings/my failed for new farmer: ${JSON.stringify(farmerHistoryRes.body)}`);
  }
  const myBookings = farmerHistoryRes.body.data;
  console.log(`   ✔ Total bookings in farmer portal: ${myBookings.length}`);
  if (myBookings.length !== 2) {
    throw new Error(`Expected exactly 2 bookings (1 COMPLETED, 1 CONFIRMED), got ${myBookings.length}`);
  }

  const foundB1 = myBookings.find(b => b.tokenNumber === token1);
  const foundB2 = myBookings.find(b => b.tokenNumber === token2);

  if (!foundB1 || !['COMPLETED', 'PAYMENT_COMPLETED'].includes(foundB1.operationalStatus)) {
    throw new Error(`Expected booking 1 (${token1}) to be COMPLETED, found: ${JSON.stringify(foundB1)}`);
  }
  if (!foundB2 || foundB2.operationalStatus !== 'WAITING') {
    throw new Error(`Expected booking 2 (${token2}) to be WAITING, found: ${JSON.stringify(foundB2)}`);
  }

  console.log(`   ✔ Booking 1 (${token1}): Status = ${foundB1.operationalStatus}`);
  console.log(`   ✔ Booking 2 (${token2}): Status = ${foundB2.operationalStatus}`);
  console.log(`   ✔ Both bookings display resolved centre: "${foundB1.centre?.name}"`);

  console.log('\n========================================================================');
  console.log('🎉 ALL 6 REGRESSION AUDIT TESTS (TESTS A-F) PASSED WITH 100% SUCCESS!');
  console.log('========================================================================\n');
}

runTest().catch((err) => {
  console.error('\n❌ REGRESSION TEST FAILED:', err);
  process.exit(1);
});
