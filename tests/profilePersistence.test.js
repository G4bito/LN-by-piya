import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeProfileData } from '../src/profilePersistence.js';

test('mergeProfileData keeps the latest saved name and phone', () => {
  const current = {
    uid: 'user-1',
    fullName: 'Old Name',
    phone: '09111111111',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const incoming = {
    uid: 'user-1',
    fullName: 'New Name',
    phone: '09222222222',
    updatedAt: '2024-01-02T00:00:00.000Z',
  };

  const merged = mergeProfileData(current, incoming);

  assert.equal(merged.fullName, 'New Name');
  assert.equal(merged.phone, '09222222222');
  assert.equal(merged.uid, 'user-1');
});

test('mergeProfileData preserves existing values when incoming data is incomplete', () => {
  const current = {
    uid: 'user-1',
    fullName: 'Old Name',
    phone: '09111111111',
    status: 'active',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const incoming = {
    uid: 'user-1',
    name: 'New Name',
    updatedAt: '2024-01-02T00:00:00.000Z',
  };

  const merged = mergeProfileData(current, incoming);

  assert.equal(merged.fullName, 'New Name');
  assert.equal(merged.phone, '09111111111');
  assert.equal(merged.status, 'active');
});
