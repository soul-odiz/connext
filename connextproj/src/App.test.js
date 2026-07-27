import API_BASE_URL from './config';

test('provides a non-empty API base URL', () => {
  expect(typeof API_BASE_URL).toBe('string');
  expect(API_BASE_URL.length).toBeGreaterThan(0);
});
