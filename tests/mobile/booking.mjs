// Windows/Edge runtime QA, invoked inside the demo Functions/Auth/DB emulators.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { addDaysToDateKey, getDateKeyInTimeZone } from '../../src/businessSettings.js';

const projectId = 'demo-luxe-availability';
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9000' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw Error('Local demo emulators required.');
const databaseURL = `https://${projectId}-default-rtdb.firebaseio.com`;
const admin = initializeApp({ projectId, databaseURL }, 'mobile-booking-qa');
const database = getDatabase(admin), auth = getAuth(admin);
const today = getDateKeyInTimeZone(new Date(), 'Asia/Manila');
const date = today < '2026-11-26' ? '2026-11-26' : addDaysToDateKey(today, 2);
const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const demoPassword = 'Demo-Only-Password-24!';
const profile = { uid: 'mobile-demo', email: 'mobile@example.test', status: 'active', fullName: 'Mobile Demo', phone: '09123456789', address: 'Emulator only', completedVisits: 2, loyaltyPoints: 2, loyalty: { completedVisits: 2, awardedBookings: { previous: '2026-11-01T00:00:00Z' } } };
const hours = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, { open: true, openTime: '10:00', closeTime: '22:00' }]));
const cache = 'node_modules/.cache/mobile-booking-qa';
await fs.mkdir(cache, { recursive: true });
let browser, socket, vite;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
try {
  await auth.createUser({ uid: profile.uid, email: profile.email, password: demoPassword }).catch(error => { if (error.code !== 'auth/uid-already-exists' && error.code !== 'auth/email-already-exists') throw error; });
  await database.ref().set({ users: { [profile.uid]: profile }, settings: { business: { timezone: 'Asia/Manila', minimumNoticeHours: 0, maximumAdvanceDays: 365, bookingInterval: 60, businessHours: hours, onlineBookingHours: hours } } });
  vite = await createServer({ configFile: false, envDir: false, cacheDir: `${cache}/vite`, plugins: [react(), {
    name: 'isolated-mobile-demo',
    configResolved(config) { Object.assign(config.env, { VITE_FIREBASE_API_KEY: 'demo-key', VITE_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`, VITE_FIREBASE_DATABASE_URL: databaseURL, VITE_FIREBASE_PROJECT_ID: projectId, VITE_FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`, VITE_FIREBASE_MESSAGING_SENDER_ID: '123456', VITE_FIREBASE_APP_ID: 'demo-app' }); },
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/firebase.js')) return;
      return code.replace("import { getApp,", "import { connectAuthEmulator } from 'firebase/auth'; import { connectDatabaseEmulator } from 'firebase/database'; import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';\nimport { getApp,")
        .replace('storage = getStorage(app);', "storage = getStorage(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings:true}); connectDatabaseEmulator(rtdb, '127.0.0.1', 9000); connectFunctionsEmulator(getFunctions(app, 'asia-southeast1'), '127.0.0.1', 5001);");
    },
  }], server: { host: '127.0.0.1', port: 4180, strictPort: true } });
  await vite.listen();
  const browserProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'ln-mobile-booking-'));
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9223', `--user-data-dir=${browserProfile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await (await fetch('http://127.0.0.1:9223/json/list')).json(); if (tabs.some(tab => tab.type === 'page')) break; } catch {} await delay(200); }
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0, failFirst = true;
  const pending = new Map(), ids = [], routes = [], exceptions = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', async event => {
    const value = JSON.parse(event.data);
    if (value.id) { const task = pending.get(value.id); pending.delete(value.id); value.error ? task.reject(Error(value.error.message)) : task.resolve(value.result); }
    if (value.method === 'Runtime.exceptionThrown') exceptions.push(value.params.exceptionDetails.text);
    if (value.method === 'Network.requestWillBeSent') {
      const request = value.params.request; routes.push(request.url);
      if (request.url.endsWith('/submitBooking') && request.postData) ids.push(JSON.parse(request.postData).data.id);
    }
    if (value.method === 'Fetch.requestPaused') {
      if (failFirst && value.params.request.method === 'POST') { failFirst = false; await send('Fetch.failRequest', { requestId: value.params.requestId, errorReason: 'ConnectionFailed' }); }
      else await send('Fetch.continueRequest', { requestId: value.params.requestId });
    }
  });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  const wait = async (expression, label) => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) { checks.push(label); return; } await delay(150); } throw Error(`Timed out: ${label}`); };
  const click = async expression => { assert.equal(await evaluate(`(()=>{const button=${expression}; if(!button||button.disabled)return false;button.click();return true})()`), true); };
  const button = text => `[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)})`;
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Manila' });
  await send('Page.navigate', { url: 'http://127.0.0.1:4180/' });
  await wait("!!document.querySelector('.navbar .nav-compact')", 'mobile app loads');
  await click("document.querySelector('.navbar .nav-compact')");
  await wait("!!document.querySelector('input[type=password]')", 'existing login form opens');
  await evaluate(`(()=>{for(const [selector,value] of ${JSON.stringify([['input[type=email]', profile.email], ['input[type=password]', demoPassword]])}){const input=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
  await evaluate("document.querySelector('.auth-form').requestSubmit()");
  await wait("!!document.querySelector('[aria-label=\"Open profile\"]')", 'existing customer login succeeds');
  await click("document.querySelector('[aria-label=\"Book an appointment\"]')");
  await wait("!!document.querySelector('.booking-service-select')", 'Service step opens');
  await click("[...document.querySelectorAll('.booking-service-select')].find(button=>button.textContent.includes('Gel Manicure'))");
  await click(button('Continue to Date & Time'));
  await wait(`!![...document.querySelectorAll('.booking-calendar button')].find(button=>button.getAttribute('aria-label')===${JSON.stringify(dateLabel)}&&!button.disabled)`, 'Date and Time step exposes available date');
  await click(`[...document.querySelectorAll('.booking-calendar button')].find(button=>button.getAttribute('aria-label')===${JSON.stringify(dateLabel)})`);
  const tenAm = "[...document.querySelectorAll('button.slot')].find(button=>button.querySelector('span')?.textContent==='10:00 AM')";
  await wait(`${tenAm}&&!${tenAm}.disabled`, '10 AM full-duration slot is available');
  await click(tenAm); await click(button('Continue to Details'));
  await wait("document.querySelector('input[autocomplete=name]')?.value==='Mobile Demo'", 'Details autofill uses existing profile');
  await click(button('Review Booking'));
  await wait("document.body.innerText.includes('Review Your Appointment')&&document.body.innerText.includes('₱299')", 'Confirm step retains service and price');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true); checks.push('390px layout has no horizontal overflow');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*submitBooking', requestStage: 'Request' }] });
  await click(button('Confirm Booking'));
  await wait("document.body.innerText.includes('Booking is temporarily unavailable')", 'failed network submission has safe feedback');
  assert.equal((await database.ref('bookings').get()).exists(), false); checks.push('failed submission has no partial booking');
  await send('Fetch.disable');
  await click(button('Confirm Booking'));
  await wait("!!document.querySelector('.booking-success')", 'retry completes through actual Firebase callable');
  const bookings = (await database.ref('bookings').get()).val();
  assert.equal(Object.keys(bookings).length, 1); assert.equal(new Set(ids).size, 1); checks.push('retry keeps one intent and one appointment');
  const saved = Object.values(bookings)[0];
  assert.equal(saved.status, 'Pending Confirmation'); assert.equal(saved.totalPrice, 299); assert.equal(saved.durationMinutes, 75); checks.push('saved booking has canonical price, duration and status');
  assert.deepEqual((await database.ref(`users/${profile.uid}`).get()).val(), profile); checks.push('profile and loyalty remain unchanged');
  assert.equal(routes.some(url => url.endsWith('/api/booking')), false); checks.push('retired Vercel API is unused');
  const screenshot = await send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(`${cache}/success-390.png`, Buffer.from(screenshot.data, 'base64'));
  await click(button('View My Bookings'));
  await wait("!!document.querySelector('.history-card')", 'customer profile opens');
  await evaluate("document.querySelector('.history-card').scrollIntoView()");
  await wait("document.querySelector('.history-card')?.textContent.includes('Gel Manicure')&&document.querySelector('.history-card')?.textContent.includes('Pending Confirmation')", 'customer history shows saved appointment');
  await send('Page.reload');
  await wait("!!document.querySelector('[aria-label=\"Open profile\"]')", 'session restores after refresh');
  assert.deepEqual(exceptions, []); checks.push('no uncaught browser exceptions');
  console.log(JSON.stringify({ mobileChecksPassed: checks.length, checks, screenshot: `${cache}/success-390.png`, engine: 'Edge Chromium; not real iPhone Safari or Messenger' }));
  await send('Browser.close');
} catch (error) {
  console.error('Mobile booking QA failed:', error.message);
  process.exitCode = 1;
} finally {
  socket?.close(); browser?.kill(); await vite?.close(); await deleteApp(admin);
}
