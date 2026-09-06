const requiredEnvironment = [
  'FIREBASE_DATABASE_URL',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'SENDGRID_API_KEY',
  'PASSWORD_RESET_FROM_EMAIL',
];
const missing = requiredEnvironment.filter((name) => !String(process.env[name] || '').trim());
if (missing.length) {
  console.error(`Appointment reminder worker is missing required server configuration: ${missing.join(', ')}`);
  process.exit(1);
}
try {
  const { runAppointmentReminderSweep } = await import('../functions/index.js');
  const result = await runAppointmentReminderSweep();
  console.log('Appointment reminder worker completed.', result);
  process.exit(0);
} catch (error) {
  console.error('Appointment reminder worker failed.', {
    code: error?.code || 'unknown',
    message: error?.message || String(error),
  });
  process.exit(1);
}
