'use strict';

const express = require('express');
const auth = require('../auth');
const sessions = require('../sessionManager');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const user = await auth.verifyCredentials(username, password);
  if (!user) {
    await sessions.logEvent('auth', `failed login for ${username}`, 'warn', { ip: req.ip });
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const token = auth.issueToken(user);
  await sessions.logEvent('auth', `login: ${username}`, 'info', { ip: req.ip });
  res.json({ token, user });
});

router.get('/me', auth.requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/users', auth.requireAuth, auth.requireRole('admin'), async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  try {
    const user = await auth.createUser(username, password, role || 'operator');
    await sessions.logEvent('auth', `created user ${username} (${role || 'operator'})`, 'info', { by: req.user.username });
    res.json({ user });
  } catch (err) {
    res.status(409).json({ error: 'user already exists' });
  }
});

module.exports = router;
