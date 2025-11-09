import { Request, Response } from 'express';
import { query } from '../config/database';
import { validateWarehouseCode } from '../utils/validators';

export const getWarehouses = async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, city, code, address, phone, is_active, created_at
       FROM warehouses
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createWarehouse = async (req: Request, res: Response) => {
  try {
    const { name, city, code, address, phone } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: 'Name and code are required' });
    }

    if (!validateWarehouseCode(code)) {
      return res.status(400).json({ error: 'Invalid warehouse code (2-10 chars)' });
    }

    const existing = await query('SELECT id FROM warehouses WHERE code = $1', [code]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Warehouse code already exists' });
    }

    const result = await query(
      `INSERT INTO warehouses (name, city, code, address, phone, is_active, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, true, $6, NOW())
       RETURNING id, name, city, code, address, phone, is_active, created_at`,
      [name, city || null, code, address || null, phone || null, req.user?.userId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateWarehouse = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, city, code, address, phone } = req.body;

    const result = await query(
      `UPDATE warehouses
       SET name = COALESCE($1, name),
           city = COALESCE($2, city),
           code = COALESCE($3, code),
           address = COALESCE($4, address),
           phone = COALESCE($5, phone)
       WHERE id = $6
       RETURNING *`,
      [name, city, code, address, phone, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Warehouse not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteWarehouse = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM warehouses WHERE id = $1', [id]);
    res.json({ message: 'Warehouse deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const setActiveWarehouse = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query('SELECT id FROM warehouses WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Warehouse not found' });
    }

    res.json({ message: 'Warehouse set as active', warehouseId: id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
