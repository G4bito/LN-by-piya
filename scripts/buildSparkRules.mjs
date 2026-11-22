// Generate and commit the rules. No production access; managed rules stay intact.
import { readFileSync, writeFileSync } from 'node:fs';
const rules = JSON.parse(readFileSync(new URL('../database.managed.rules.json', import.meta.url))).rules;
const admin = "auth != null && root.child('admins').child(auth.uid).exists() && root.child('admins').child(auth.uid).child('status').val() != 'inactive'";
const customer = "auth != null && root.child('users').child(auth.uid).child('status').val() == 'active'";
const phase = "root.child('sparkBookingControl').child('phase').val()";
const publishing = `${phase} == 'publishing'`;
const ready = `${phase} == 'ready'`;
const protect = (s) => `(${admin}) || (${s})`;
// No inherited legacy write can bypass Spark. Old clients fail closed at cutover.
rules.settings.business['.write'] = `(${admin}) && (!root.child('sparkBookingControl').exists() || (${publishing}))`;
rules.bookings.$bookingId['.write'] = `(${admin}) && !root.child('sparkBookingControl').exists()`;
rules.scheduleSlots['.write'] = `(${admin}) && !root.child('sparkBookingControl').exists()`;
rules.scheduleSlots.$dateKey.$bookingId['.write'] = rules.scheduleSlots['.write'];
rules.scheduleMutexes.$dateKey['.write'] = rules.scheduleSlots['.write'];
rules.sparkBookingControl = { '.read': `(${admin}) || (${customer})`, '.write': admin };
for (const path of ['sparkBookingPolicy', 'sparkBookingCatalog', 'sparkBookingCalendar']) rules[path] = {
  '.read': true, '.write': `(${admin}) && (${publishing})`,
};
const e = (key) => `newData.child('lastEvent').child('${key}').val()`;
const p = (key) => `newData.child('proof').child('${key}').val()`;
const d = (key) => `root.child('sparkBookingDetails').child(${e('id')}).child('${key}').val()`;
const c = (key) => `root.child('sparkBookingCalendar').child(${e('date')}).child('${key}').val()`;
const pol = (key) => `root.child('sparkBookingPolicy').child('${key}').val()`;
const service = (key) => `root.child('sparkBookingCatalog').child(${e('service')}).child('${key}').val()`;
const day = `((${c('dayStart')} - data.child('origin').val()) / 86400000)`;
const length = `(${e('duration')} + data.child('buffer').val())`;
const conditions = [
  'data.exists()', "newData.hasChildren(['version','origin','days','buffer','legacyBlocks','legacyHoldUntil','occupied','capacity','journal','lastEvent','proof'])",
  ...['version','origin','days','buffer','legacyBlocks','legacyHoldUntil','publicationToken'].map((key) => `newData.child('${key}').val() == data.child('${key}').val()`),
  "newData.child('occupied').isString()", "newData.child('capacity').isString()", "newData.child('journal').isString()",
  `${e('type')} == 'book'`, `newData.child('lastEvent').child('id').isString()`, `${e('id')}.matches(/^[A-Za-z0-9_-]{1,128}$/)`,
  `!data.child('journal').val().contains('|' + ${e('id')} + '|')`, `!root.child('bookings').child(${e('id')}).exists()`,
  `${d('uid')} == auth.uid`, `${d('id')} == ${e('id')}`, `${d('date')} == ${e('date')}`, `${d('time')} == ${e('time')}`, `${d('service')} == ${e('service')}`,
  `${d('startMinutes')} == ${e('start')}`, `${d('durationMinutes')} == ${e('duration')}`, `${e('duration')} == ${service('durationMinutes')}`,
  `${d('basePrice')} == ${service('price')}`, `${d('baseTotal')} == ${service('price')} * (${service('perNail')} == true ? ${d('nailQuantity')} : 1)`,
  `${d('totalPrice')} == ${d('baseTotal')} + ${d('nailArt/total')}`, `${d('estimatedTotal')} == ${d('totalPrice')}`, `${e('price')} == ${d('totalPrice')}`,
  `${d('nailArt/pricePerNail')} == ${pol('nailArtPrice')}`,
  `(${d('nailArt/enabled')} == true ? (${service('nailArt')} == true && ${d('nailArt/quantity')} >= 1 && ${d('nailArt/quantity')} <= ${pol('nailArtMaximum')} && ${d('nailArt/total')} == ${pol('nailArtPrice')} * ${d('nailArt/quantity')}) : (${d('nailArt/quantity')} == 0 && ${d('nailArt/total')} == 0))`,
  `(${d('referenceImageUrl')} == '' || ${pol('allowPhoto')} == true)`,
  `${e('createdAt')} == ${d('createdAt')}`, "newData.child('lastEvent').child('committedAt').isNumber()", `${e('committedAt')} <= now && ${e('committedAt')} >= now - 60000`,
  `now >= data.child('legacyHoldUntil').val()`, `data.child('buffer').val() == ${pol('buffer')}`,
  `${day} >= 0 && ${day} < data.child('days').val() && ${day} % 1 == 0`,
  `${c('dayStart')} >= now - ((now + 28800000) % 86400000)`,
  `${c('dayStart')} <= now - ((now + 28800000) % 86400000) + ${pol('advance')} * 86400000`,
  `(${pol('sameDay')} == true || ${c('dayStart')} > now - ((now + 28800000) % 86400000))`,
  `${c('dayStart')} + ${e('start')} * 60000 >= now + ${pol('notice')} * 3600000`,
  `root.child('sparkBookingCalendar').child(${e('date')}).child('starts').child(${e('time')}).val() == ${e('start')}`,
  `${length} <= root.child('sparkBookingCalendar').child(${e('date')}).child('limits').child(${e('time')}).val()`,
  `${e('start')} >= 0 && ${e('start')} + ${length} <= 1440`,
  // Concatenation proofs avoid unsupported substring/loops in RTDB Rules.
  `${p('before')}.length == ${day} * 1440 + ${e('start')}`,
  `${p('free')}.length == ${length} && ${p('free')}.matches(/^0+$/)`,
  `${p('claim')}.length == ${length} && ${p('claim')}.matches(/^1+$/)`,
  `data.child('occupied').val() == ${p('before')} + ${p('free')} + ${p('after')}`,
  `newData.child('occupied').val() == ${p('before')} + ${p('claim')} + ${p('after')}`,
  `${p('availableBefore')}.length == ${e('start')}`,
  `${c('allowed')} == ${p('availableBefore')} + ${p('claim')} + ${p('availableAfter')}`,
  `${e('token')} % 1 == 0 && ${e('token')} >= ${day} * 100 && ${e('token')} < ${day} * 100 + ${pol('capacity')}`,
  `${p('capacityBefore')}.length == ${e('token')}`,
  `data.child('capacity').val() == ${p('capacityBefore')} + '0' + ${p('capacityAfter')}`,
  `newData.child('capacity').val() == ${p('capacityBefore')} + '1' + ${p('capacityAfter')}`,
  `newData.child('journal').val().length <= 4000000`,
  `newData.child('journal').val() == data.child('journal').val() + 'B|' + ${e('id')} + '|' + ${e('date')} + '|' + ${e('time')} + '|' + ${e('service')} + '|' + ${e('start')} + '|' + ${e('duration')} + '|' + ${e('price')} + '|Pending Confirmation|' + ${e('createdAt')} + '\\n'`,
];
rules.sparkSchedule = { '.read': `(${admin}) || (${customer})`, '.write': `newData.exists() && (((${admin}) && ((${ready}) || ((${publishing}) && newData.child('publicationToken').val() == root.child('sparkBookingControl').child('token').val() && newData.child('lastEvent').child('type').val() == 'publish'))) || ((${customer}) && (${ready})))`, '.validate': protect(conditions.join(' && ')) };
for (const key of ['version','origin','days','buffer','legacyBlocks','legacyHoldUntil','publicationToken','occupied','capacity','journal','lastEvent','proof']) rules.sparkSchedule[key] = { '.validate': true };
rules.sparkSchedule.lastEvent = { '.validate': protect("newData.hasChildren(['type','id','date','time','service','start','duration','price','token','createdAt','committedAt'])") };
for (const key of ['type','id','date','time','service','start','duration','price','token','createdAt','committedAt']) rules.sparkSchedule.lastEvent[key] = { '.validate': true };
rules.sparkSchedule.lastEvent.$other = { '.validate': admin };
rules.sparkSchedule.proof = { '.validate': protect("newData.hasChildren(['before','after','free','claim','capacityBefore','capacityAfter','availableBefore','availableAfter'])") };
for (const key of ['before','after','free','claim','capacityBefore','capacityAfter','availableBefore','availableAfter']) rules.sparkSchedule.proof[key] = { '.validate': protect('newData.isString() && newData.val().length <= 1100000') };
rules.sparkSchedule.proof.$other = { '.validate': admin };
rules.sparkSchedule.$other = { '.validate': admin };
// Fields may be created once. They are not appointments until the journal commits.
const own = "auth != null && data.child('uid').val() == auth.uid";
rules.sparkBookingDetails = { '.read': rules.bookings['.read'], '.indexOn': ['uid', 'createdAt'], $id: {
  '.read': `(${admin}) || ((${customer}) && ((${own}) || !data.exists()))`,
  '.write': `(${admin}) || ((${customer}) && (${ready}) && !data.exists() && newData.exists() && newData.child('uid').val() == auth.uid && !root.child('bookings').child($id).exists() && !root.child('sparkSchedule').child('journal').val().contains('|' + $id + '|'))`,
  '.validate': protect("newData.hasChildren(['id','uid','service','date','time','startMinutes','durationMinutes','totalPrice','estimatedTotal','basePrice','baseTotal','nailQuantity','nailArt','createdAt','status','name','phone','address','notes','referenceImageUrl']) && newData.child('id').val() == $id && newData.child('status').val() == 'Draft'"),
} };
const detail = rules.sparkBookingDetails.$id;
for (const key of ['id','uid','service','date','time','createdAt','name','phone','address','notes','referenceImageUrl']) detail[key] = { '.validate': protect(`newData.isString() && newData.val().length <= ${key === 'referenceImageUrl' ? 260000 : key === 'notes' ? 2000 : 500}`) };
detail.email = { '.validate': protect('newData.isString() && newData.val() == auth.token.email') };
detail.id['.validate'] = protect("newData.isString() && newData.val().matches(/^[A-Za-z0-9_-]{1,128}$/)");
detail.date['.validate'] = protect("newData.isString() && newData.val().matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)");
detail.time['.validate'] = protect("newData.isString() && newData.val().matches(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)");
detail.createdAt['.validate'] = protect("newData.isString() && newData.val().matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/)");
detail.referenceImageUrl['.validate'] = protect("newData.isString() && (newData.val() == '' || (newData.val().length <= 260000 && newData.val().matches(/^data:image\\/jpeg;base64,[A-Za-z0-9+\\/=]+$/)) || (newData.val().length <= 2000 && newData.val().matches(/^https:\\/\\/firebasestorage\\.googleapis\\.com\\/v0\\/b\\/ln-by-piya(\\.appspot\\.com|\\.firebasestorage\\.app)\\/o\\/portfolio(%2F|\\/)[^ ]+$/)))");
for (const key of ['basePrice','baseTotal','totalPrice','estimatedTotal']) detail[key] = { '.validate': protect('newData.isNumber() && newData.val() >= 0 && newData.val() <= 1000000') };
for (const key of ['startMinutes','durationMinutes','nailQuantity']) detail[key] = { '.validate': protect('newData.isNumber() && newData.val() >= 0 && newData.val() % 1 == 0') };
detail.nailQuantity['.validate'] = protect('newData.isNumber() && newData.val() % 1 == 0 && newData.val() >= 1 && newData.val() <= 10');
detail.status = { '.validate': protect("newData.val() == 'Draft'") };
detail.nailArt = { '.validate': protect("newData.hasChildren(['enabled','quantity','pricePerNail','total'])"), enabled: { '.validate': protect('newData.isBoolean()') }, $key: { '.validate': protect("($key == 'quantity' || $key == 'pricePerNail' || $key == 'total') && newData.isNumber() && newData.val() >= 0 && newData.val() <= 1000000 && ($key != 'quantity' || newData.val() % 1 == 0)") } };
detail.$other = { '.validate': admin };
rules.sparkBookingAdmin = { '.read': rules.bookings['.read'], '.write': admin, $id: { '.read': `(${admin}) || ((${customer}) && (root.child('sparkBookingDetails').child($id).child('uid').val() == auth.uid || root.child('bookings').child($id).child('uid').val() == auth.uid))` } };
// Change requests never change appointments. Only administrators execute decisions.
rules.appointmentChangeRequests.$requestId['.read'] = `(${admin}) || ((${customer}) && (!data.exists() || data.child('uid').val() == auth.uid))`;
for (const key of ['.write', '.validate']) {
  const source = rules.appointmentChangeRequests.$requestId[key];
  const legacyOwner = "root.child('bookings').child(newData.child('bookingId').val()).child('uid').val()";
  rules.appointmentChangeRequests.$requestId[key] = source.replaceAll(`${legacyOwner} == auth.uid`, `(${legacyOwner} == auth.uid || (root.child('sparkBookingDetails').child(newData.child('bookingId').val()).child('uid').val() == auth.uid && root.child('sparkSchedule').child('journal').val().contains('|' + newData.child('bookingId').val() + '|')))`)
    .replaceAll(`${legacyOwner} == newData.child('uid').val()`, `(${legacyOwner} == newData.child('uid').val() || root.child('sparkBookingDetails').child(newData.child('bookingId').val()).child('uid').val() == newData.child('uid').val())`)
    .replaceAll("root.child('bookings').child(newData.child('bookingId').val()).child('status').val() == 'Confirmed'", "(root.child('bookings').child(newData.child('bookingId').val()).child('status').val() == 'Confirmed' || root.child('sparkBookingDetails').child(newData.child('bookingId').val()).exists())");
}
const legacyNotification = "root.child('bookings').child($notificationId).child('uid').val() == auth.uid && root.child('bookings').child($notificationId).child('status').val() == 'Pending Confirmation'";
rules.adminNotifications.$notificationId['.write'] = rules.adminNotifications.$notificationId['.write'].replace(legacyNotification, `((${legacyNotification}) || (root.child('sparkBookingDetails').child($notificationId).child('uid').val() == auth.uid && root.child('sparkSchedule').child('journal').val().contains('|' + $notificationId + '|')))`);
writeFileSync(new URL('../database.rules.json', import.meta.url), JSON.stringify({ rules }, null, 2) + '\n');
