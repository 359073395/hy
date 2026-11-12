'use strict';

const { randomBytes, createHash } = require('node:crypto');
const { Client } = require('pg');
const { validateCredentials, hashPassword } = require('./password.cjs');

async function manageAdminAccount(db, input) {
  if (!input || !['status', 'create', 'reset'].includes(input.action)) throw new Error('管理员操作无效');
  if (input.action === 'status') {
    const result = await db.query(
      `SELECT id, name, username, status, password_hash IS NOT NULL AS "hasPassword"
       FROM users WHERE role = 'super_admin' ORDER BY created_at, id`
    );
    return {
      admins: result.rows,
      hasPasswordAdmin: result.rows.some(user => user.status === 'active' && user.username && user.hasPassword),
    };
  }
  const username = validateCredentials(input.username, input.password);
  if (input.action === 'reset' && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.userId || '')) {
    throw new Error('请选择要重置的超级管理员');
  }
  const passwordHash = await hashPassword(input.password);
  await db.query('BEGIN');
  try {
    let user;
    if (input.action === 'create') {
      const token = randomBytes(24).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const result = await db.query(
        `INSERT INTO users(name, token_hash, username, password_hash, role, tier, status)
         VALUES ($1, $2, $3, $4, 'super_admin', 'M6', 'active') RETURNING id, name, username`,
        ['网站超级管理员', tokenHash, username, passwordHash]
      );
      user = result.rows[0];
      await db.query('INSERT INTO user_tokens(user_id, token) VALUES ($1, $2)', [user.id, token]);
    } else {
      const found = await db.query('SELECT id, role, status FROM users WHERE id = $1 FOR UPDATE', [input.userId]);
      if (!found.rows[0] || found.rows[0].role !== 'super_admin') throw new Error('所选账号不是超级管理员');
      if (found.rows[0].status !== 'active') throw new Error('所选超级管理员已停用，请选择可用账号或新增管理员');
      const result = await db.query(
        'UPDATE users SET username = $2, password_hash = $3, updated_at = now() WHERE id = $1 RETURNING id, name, username',
        [input.userId, username, passwordHash]
      );
      user = result.rows[0];
      await db.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
    }
    await db.query(
      'INSERT INTO audit_logs(user_id, action, detail) VALUES ($1, $2, $3)',
      [user.id, input.action === 'create' ? 'create_password_admin' : 'reset_admin_password', JSON.stringify({ source: 'server_terminal', username })]
    );
    await db.query('COMMIT');
    return { ok: true, user };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') throw new Error('用户名已被使用，请选择其他用户名');
    throw error;
  }
}

async function main() {
  if (!process.env.PGDATABASE_URL) throw new Error('未找到数据库连接配置');
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error('输入内容过大');
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('请输入有效的管理员设置 JSON'); }
  const db = new Client({ connectionString: process.env.PGDATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await db.connect();
    const result = await manageAdminAccount(db, input);
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { manageAdminAccount };
