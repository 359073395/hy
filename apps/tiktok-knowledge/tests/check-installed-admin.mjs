import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const credentials = JSON.parse(await readFile(process.argv[2], 'utf8'));
const response = await fetch('http://127.0.0.1:8791/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: credentials.username, password: credentials.password }),
});
assert.equal(response.status, 200);
assert.equal((await response.json()).user.role, 'super_admin');
console.log('PASS administrator password configured by installer');
