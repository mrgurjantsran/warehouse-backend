import { Request, Response } from 'express';
import { query } from '../config/database';
import * as XLSX from 'xlsx';
import fs from 'fs';


// Get all racks
export const getRacks = async (req: Request, res: Response) => {
  try {
    const { warehouse_id } = req.query;

    let sql = `
      SELECT r.*, w.name as warehouse_name 
      FROM racks r
      LEFT JOIN warehouses w ON r.warehouse_id = w.id
    `;
    const params: any[] = [];

    if (warehouse_id) {
      sql += ` WHERE r.warehouse_id = $1`;
      params.push(warehouse_id);
    }

    sql += ` ORDER BY r.created_at DESC`;

    const result = await query(sql, params);
    res.json(result.rows);

  } catch (error: any) {
    console.error('Get racks error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Create rack
export const createRack = async (req: Request, res: Response) => {
  try {
    const { rack_name, rack_type, capacity, location, warehouse_id } = req.body;
    const userId = (req as any).user?.id;

    const sql = `
      INSERT INTO racks (rack_name, rack_type, capacity, location, warehouse_id, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const result = await query(sql, [rack_name, rack_type, capacity, location, warehouse_id, userId]);
    res.status(201).json(result.rows[0]);

  } catch (error: any) {
    console.error('Create rack error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update rack
export const updateRack = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { rack_name, rack_type, capacity, location } = req.body;
    const userId = (req as any).user?.id;

    const sql = `
      UPDATE racks 
      SET rack_name = $1, rack_type = $2, capacity = $3, location = $4, updated_by = $5, updated_at = NOW()
      WHERE id = $6
      RETURNING *
    `;

    const result = await query(sql, [rack_name, rack_type, capacity, location, userId, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rack not found' });
    }

    res.json(result.rows[0]);

  } catch (error: any) {
    console.error('Update rack error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Delete rack
export const deleteRack = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query('DELETE FROM racks WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rack not found' });
    }

    res.json({ message: 'Rack deleted successfully' });

  } catch (error: any) {
    console.error('Delete rack error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Toggle active status
export const toggleRackStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const sql = `
      UPDATE racks 
      SET is_active = NOT is_active, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const result = await query(sql, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rack not found' });
    }

    res.json(result.rows[0]);

  } catch (error: any) {
    console.error('Toggle rack status error:', error);
    res.status(500).json({ error: error.message });
  }
};



// Bulk upload racks
export const bulkUploadRacks = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { warehouse_id } = req.body;
    const userId = (req as any).user?.id;

    console.log('📤 Bulk rack upload started:', { warehouse_id, userId });

    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: any[] = XLSX.utils.sheet_to_json(worksheet);  
    
    if (data.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    let successCount = 0;
    let errorCount = 0;

    for (const row of data) {  // Now row will have proper type
      try {
        const rackName = row['RACK_NAME'] || row['rack_name'];
        if (!rackName) continue;

        await query(
          `INSERT INTO racks (rack_name, rack_type, capacity, location, warehouse_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            rackName,
            row['RACK_TYPE'] || row['rack_type'] || 'Standard',
            row['CAPACITY'] || row['capacity'] || null,
            row['LOCATION'] || row['location'] || null,
            warehouse_id,
            userId
          ]
        );
        successCount++;
      } catch (error) {
        console.error('Rack insert error:', error);
        errorCount++;
      }
    }

    fs.unlinkSync(filePath);

    console.log(`✅ Bulk rack upload complete: ${successCount} success, ${errorCount} errors`);

    res.json({
      message: 'Bulk upload completed',
      successCount,
      errorCount,
      total: data.length
    });

  } catch (error: any) {
    console.error('❌ Bulk rack upload error:', error);
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
    }
    res.status(500).json({ error: error.message });
  }
};

