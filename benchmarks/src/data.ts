// Payloads shared by every benchmark server, so all of them send the same bytes.

/** 50 users, about 6 KB of JSON: a typical list endpoint. */
export const LIST = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  name: `User ${String(i + 1)}`,
  email: `user${String(i + 1)}@example.com`,
  active: i % 3 !== 0,
  roles: i % 10 === 0 ? ['member', 'admin'] : ['member'],
  createdAt: '2026-01-01T00:00:00.000Z',
}));

/** The bearer token `POST /orders` requires. */
export const TOKEN = 'Bearer bench-token';

export const ORDER = JSON.stringify({ product: 'book', quantity: 2, note: 'gift wrap' });
export const USER = JSON.stringify({ name: 'Shiela', email: 'shiela@example.com', age: 36 });
