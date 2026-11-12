'use strict';

const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const deriveKey = promisify(scrypt);
const parameters = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_PASSWORD_HASH = `scrypt$16384$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`;

function normalizeUsername(value) {
  if (typeof value !== 'string') return '';
  const username = value.trim().toLowerCase();
  return /^[a-z0-9_.-]{3,64}$/.test(username) ? username : '';
}

function validateCredentials(username, password) {
  const normalized = normalizeUsername(username);
  if (!normalized) throw new Error('用户名须为3到64位英文字母、数字、点、下划线或短横线');
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new Error('密码长度须为8到128位');
  }
  return normalized;
}

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new Error('密码长度须为8到128位');
  }
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, Buffer.from(salt, 'hex'), 64, parameters);
  return `scrypt$16384$8$1$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128 || typeof encoded !== 'string') return false;
  const match = /^scrypt\$16384\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
  if (!match) return false;
  const expected = Buffer.from(match[2], 'hex');
  const actual = await deriveKey(password, Buffer.from(match[1], 'hex'), expected.length, parameters);
  return timingSafeEqual(actual, expected);
}

module.exports = { normalizeUsername, validateCredentials, hashPassword, verifyPassword, DUMMY_PASSWORD_HASH };
