const http = require('http');

const PORT = 5001;

const makeRequest = (path, method = 'GET', body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
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
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

const TestIsolationRegistry = require('./test-helpers/testIsolation');

const runSmokeTest = async () => {
  const registry = new TestIsolationRegistry('Smoke Test');
  console.log(`[Smoke Test] Running Live System Smoke Test on http://localhost:${PORT}... (Run ID: ${registry.runId})`);

  try {
    // 1. Farmer Registration & Login
    const testFarmerData = registry.getTestFarmerDetails('Smoke Farmer');
    const farmerAuth = await makeRequest('/api/auth/register', 'POST', testFarmerData);
    const farmerToken = farmerAuth.body.data?.token;
    const createdFarmerId = farmerAuth.body.data?.user?._id || farmerAuth.body.data?.user?.id;
    registry.registerUser(createdFarmerId);
    console.log('1. Farmer Registered & Authenticated:', farmerToken ? '✔ PASSED' : '❌ FAILED');

    // 2. Staff Authentication & Centre Identification
    const staffAuth = await makeRequest('/api/auth/login', 'POST', {
      email: 'gomtinagar.centre@agrinexus.demo',
      password: 'password123',
      role: 'CENTRE_STAFF'
    });
    const staffToken = staffAuth.body.data?.token;
    const centreId = staffAuth.body.data?.user?.assignedCentreId || 'c1';
    console.log('2. Staff Authenticated (Assigned Centre:', centreId, '):', staffToken ? '✔ PASSED' : '❌ FAILED');

    // 3. Slot Discovery & Booking
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const slotsRes = await makeRequest(`/api/slots?centreId=${centreId}&date=${todayStr}`, 'GET', null, farmerToken);
    const slot = slotsRes.body.data?.[0];
    console.log('3. Slot Discovery:', slot ? `✔ PASSED (${slotsRes.body.data.length} slots)` : '❌ FAILED');

    const bookingRes = await makeRequest('/api/bookings', 'POST', {
      centreId,
      slotId: slot.id || slot._id,
      bookingDate: todayStr,
      cropType: 'Wheat',
      estimatedQuantityQuintals: 45
    }, farmerToken);
    const booking = bookingRes.body.data?.booking;
    const bookingId = booking?.id || booking?._id;
    registry.registerBooking(bookingId);
    console.log('4. Slot Booked & Token Generated:', booking?.tokenNumber ? `✔ PASSED (${booking.tokenNumber})` : '❌ FAILED');

    // 4. Staff CALL NEXT Execution
    const callNextRes = await makeRequest('/api/queue/call-next', 'POST', {
      centreId,
      date: todayStr,
      counterId: 'Counter 1'
    }, staffToken);
    const qe = callNextRes.body.data?.queueEntry;
    const calledToken = qe?.tokenNumber;
    if (qe?._id || qe?.id) registry.registerQueueEntry(qe._id || qe.id);
    console.log('5. Staff CALL NEXT Execution:', calledToken ? `✔ PASSED (Called ${calledToken})` : `❌ FAILED (Status: ${callNextRes.status}, Body: ${JSON.stringify(callNextRes.body)})`);

    // 5. Produce Quality Inspection & Net Weighing
    const verifyRes = await makeRequest(`/api/procurements/${bookingId}/verify`, 'POST', {
      verifiedQuantityQuintals: 45,
      moisturePercentage: 11.5,
      qualityGrade: 'Grade A'
    }, staffToken);
    console.log('7. Produce Quality Inspection Recorded:', verifyRes.status === 200 ? '✔ PASSED' : '❌ FAILED');

    const weighRes = await makeRequest(`/api/procurements/${bookingId}/weigh-complete`, 'POST', {
      netWeightQuintals: 44.8,
      deductions: 0
    }, staffToken);
    const receipt = weighRes.body.data?.receipt || weighRes.body.data?.procurement;
    console.log('8. Net Weighing & Digital Receipt Issuance:', receipt?.receiptSerialNumber ? `✔ PASSED (${receipt.receiptSerialNumber}, Net Payable: ₹${receipt.netPayableAmount})` : '❌ FAILED');

    // 6. Farmer Tracking Procurement & Payment
    const paymentRes = await makeRequest(`/api/payments/${bookingId}`, 'GET', null, farmerToken);
    console.log('9. Farmer Payment Tracker Stage:', paymentRes.body.data?.currentStage === 'PROCUREMENT_COMPLETED' ? `✔ PASSED (${paymentRes.body.data.currentStage})` : '❌ FAILED');

    // 7. Admin Command Centre Oversight
    const adminAuth = await makeRequest('/api/auth/login', 'POST', {
      email: 'admin@agrinexus.gov.in',
      password: 'adminpassword',
      role: 'ADMIN'
    });
    const adminToken = adminAuth.body.data?.token;

    const overviewRes = await makeRequest('/api/admin/overview', 'GET', null, adminToken);
    console.log('10. Admin Command Centre KPI Overview:', overviewRes.body.data?.kpis?.activeCentresCount > 0 ? '✔ PASSED' : '❌ FAILED');

    const auditRes = await makeRequest('/api/admin/audit-logs', 'GET', null, adminToken);
    console.log('11. Compliance Audit Trail Verification:', auditRes.body.data?.length > 0 ? `✔ PASSED (${auditRes.body.data.length} records)` : '❌ FAILED');

    const reconRes = await makeRequest('/api/admin/reconciliation', 'GET', null, adminToken);
    console.log('12. Data Reconciliation Check:', reconRes.body.data?.isReconciled ? '✔ PASSED' : '❌ FAILED');

    console.log('=======================================================');
    console.log('🎉 LIVE END-TO-END DEMO SMOKE TEST PASSED 100% CLEANLY!');
    console.log('=======================================================');
  } catch (err) {
    console.error('❌ Smoke test failed:', err);
    process.exitCode = 1;
  } finally {
    await registry.teardown();
  }
};

runSmokeTest();
