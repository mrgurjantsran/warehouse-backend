import { Request, Response } from 'express';
import { query } from '../config/database';
import { generateToken } from '../config/auth';
import { hashPassword, comparePasswords } from '../utils/helpers';
import { validateEmail, validatePassword, validateUsername } from '../utils/validators';

export const login = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const result = await query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValidPassword = await comparePasswords(password, user.password_hash);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
      warehouseId: user.warehouse_id,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        warehouseId: user.warehouse_id,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const register = async (req: Request, res: Response) => {
  try {
    const { username, password, email, fullName } = req.body;

    if (!validateUsername(username)) {
      return res.status(400).json({ error: 'Invalid username (3-50 chars required)' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Password must be 6+ characters' });
    }

    if (email && !validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const existingUser = await query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const hashedPassword = await hashPassword(password);

    const result = await query(
      `INSERT INTO users (username, password_hash, email, full_name, role, is_active, created_at)
       VALUES ($1, $2, $3, $4, 'operator', true, NOW())
       RETURNING id, username, email, full_name, role`,
      [username, hashedPassword, email || null, fullName || null]
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: result.rows[0],
    });
  } catch (error: any) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
};
