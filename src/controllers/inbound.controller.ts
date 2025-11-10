import { Request, Response } from 'express';
import { query } from '../config/database';
import { generateBatchId } from '../utils/helpers';
import * as XLSX from 'xlsx';
import fs from 'fs';

// Single entry - with duplicate check and cross-warehouse prevention
export const createInboundEntry = async (req: Request, res: Response) => {
  try {
    const {
      wsn,
      inbound_date,
      vehicle_no,
      product_serial_number,
      rack_no,
      unload_remarks,
      warehouse_id,
      update_existing
    } = req.body;

    const userId = (req as any).user?.id;
    const userName = (req as any).user?.full_name || 'Unknown';

    console.log('📦 Creating single inbound entry:', { wsn, warehouse_id });

    // Check if WSN exists in ANY warehouse
    const checkAnySql = `SELECT id, warehouse_id FROM inbound WHERE wsn = $1 LIMIT 1`;
    const checkAnyResult = await query(checkAnySql, [wsn]);

    if (checkAnyResult.rows.length > 0) {
      const existingWarehouse = checkAnyResult.rows[0].warehouse_id;
      
      if (existingWarehouse !== Number(warehouse_id)) {
        return res.status(403).json({
          error: `WSN already inbound in different warehouse.`,
          existingWarehouseId: existingWarehouse
        });
      }

      if (!update_existing) {
        return res.status(409).json({
          error: 'Duplicate WSN in same warehouse',
          existingId: checkAnyResult.rows[0].id
        });
      }

      // Update existing
      const updateSql = `
        UPDATE inbound 
        SET inbound_date = $1, vehicle_no = $2, product_serial_number = $3,
            rack_no = $4, unload_remarks = $5, updated_at = NOW()
        WHERE id = $6
        RETURNING *
      `;
      
      const updateResult = await query(updateSql, [
        inbound_date, vehicle_no, product_serial_number,
        rack_no, unload_remarks, checkAnyResult.rows[0].id
      ]);

      console.log('✅ Inbound entry updated');
      return res.json({ ...updateResult.rows[0], action: 'updated' });
    }

    // Get master data
    const masterSql = `SELECT * FROM master_data WHERE wsn = $1 LIMIT 1`;
    const masterResult = await query(masterSql, [wsn]);

    let masterInfo: any = {};
    if (masterResult.rows.length > 0) {
      masterInfo = masterResult.rows[0];
    }

    // Get warehouse name
    const whSql = `SELECT name FROM warehouses WHERE id = $1`;
    const whResult = await query(whSql, [warehouse_id]);
    const warehouseName = whResult.rows[0]?.name || '';

// ✅ NO BATCH_ID FOR SINGLE ENTRY
    const sql = `
      INSERT INTO inbound (
        wsn, inbound_date, vehicle_no, product_serial_number,
        rack_no, unload_remarks, warehouse_id, warehouse_name,
        wid, fsn, product_title, brand, mrp, fsp, hsn_sac, igst_rate,
        cms_vertical, fkt_link, created_by, created_user_name
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )
      RETURNING *
    `;

    const result = await query(sql, [
      wsn, inbound_date, vehicle_no, product_serial_number,
      rack_no, unload_remarks, warehouse_id, warehouseName,
      masterInfo.wid || null,
      masterInfo.fsn || null,
      masterInfo.product_title || null,
      masterInfo.brand || null,
      masterInfo.mrp || null,
      masterInfo.fsp || null,
      masterInfo.hsn_sac || null,
      masterInfo.igst_rate || null,
      masterInfo.cms_vertical || null,
      masterInfo.fkt_link || null,
      userId,
      userName
    ]);

    console.log('✅ Single inbound entry created (NO BATCH)');
    res.status(201).json({ ...result.rows[0], action: 'created' });

  } catch (error: any) {
    console.error('❌ Create inbound error:', error);
    res.status(500).json({ error: error.message });
  }
};



// Get master data by WSN
export const getMasterDataByWSN = async (req: Request, res: Response) => {
  try {
    const { wsn } = req.params;
    console.log('🔍 Searching WSN:', wsn);

    const sql = `SELECT * FROM master_data WHERE wsn = $1 LIMIT 1`;
    const result = await query(sql, [wsn]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'WSN not found in master data' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('❌ Get master data error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Bulk upload with duplicate detection
export const bulkInboundUpload = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { warehouse_id } = req.body;
    const userId = (req as any).user?.id;
    const userName = (req as any).user?.full_name || 'Unknown';

    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: any[] = XLSX.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    const batchId = generateBatchId('BULK');

    res.status(202).json({
      message: 'Upload started',
      batchId,
      totalRows: data.length,
      timestamp: new Date().toISOString()
    });

    // Process in background
    processInboundBulk(data, batchId, warehouse_id, userId, userName, filePath);

  } catch (error: any) {
    console.error('❌ Bulk upload error:', error);
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
    }
    res.status(500).json({ error: error.message });
  }
};

async function processInboundBulk(data: any[], batchId: string, warehouseId: string, userId: number, userName: string, filePath: string) {
  const CHUNK_SIZE = 500;
  let successCount = 0;
  let duplicateCount = 0;
  let crossWarehouseCount = 0;
  const duplicateWSNs: any[] = [];
  const crossWarehouseWSNs: any[] = [];

  try {
    // Get warehouse name
    const whSql = `SELECT name FROM warehouses WHERE id = $1`;
    const whResult = await query(whSql, [warehouseId]);
    const warehouseName = whResult.rows[0]?.name || '';

    // Get all master data
    const wsns = data.map((row: any) => row['WSN'] || row['wsn']).filter(Boolean);
    const masterDataMap = new Map();
    
    if (wsns.length > 0) {
      const masterSql = `SELECT * FROM master_data WHERE wsn = ANY($1)`;
      const masterResult = await query(masterSql, [wsns]);
      masterResult.rows.forEach((row: any) => {
        masterDataMap.set(row.wsn, row);
      });
    }

    // Check existing WSNs
    const existingMap = new Map();
    if (wsns.length > 0) {
      const existingSql = `SELECT wsn, warehouse_id FROM inbound WHERE wsn = ANY($1)`;
      const existingResult = await query(existingSql, [wsns]);
      existingResult.rows.forEach((row: any) => {
        existingMap.set(row.wsn, row.warehouse_id);
      });
    }

    const validRows: any[] = [];

    for (const row of data) {
      const wsn = String(row['WSN'] || row['wsn'] || '').trim();
      if (!wsn) continue;

      // Check if WSN already exists
      if (existingMap.has(wsn)) {
        const existingWarehouseId = existingMap.get(wsn);
        if (existingWarehouseId !== Number(warehouseId)) {
          crossWarehouseWSNs.push(wsn);
          crossWarehouseCount++;
          continue;
        } else {
          duplicateWSNs.push(wsn);
          duplicateCount++;
          continue;
        }
      }

      const masterInfo = masterDataMap.get(wsn) || {};

      validRows.push({
        wsn,
        inbound_date: row['INBOUND_DATE'] || row['inbound_date'] || new Date(),
        vehicle_no: row['VEHICLE_NO'] || row['vehicle_no'] || null,
        product_serial_number: row['PRODUCT_SERIAL_NUMBER'] || row['product_serial_number'] || null,
        rack_no: row['RACK_NO'] || row['rack_no'] || null,
        unload_remarks: row['UNLOAD_REMARKS'] || row['unload_remarks'] || null,
        warehouse_id: warehouseId,
        warehouse_name: warehouseName,
        batch_id: batchId,
        created_by: userId,
        created_user_name: userName,
        wid: masterInfo.wid || null,
        fsn: masterInfo.fsn || null,
        order_id: masterInfo.order_id || null,
        fkqc_remark: masterInfo.fkqc_remark || null,
        fk_grade: masterInfo.fk_grade || null,
        product_title: masterInfo.product_title || null,
        hsn_sac: masterInfo.hsn_sac || null,
        igst_rate: masterInfo.igst_rate || null,
        fsp: masterInfo.fsp || null,
        mrp: masterInfo.mrp || null,
        invoice_date: masterInfo.invoice_date || null,
        fkt_link: masterInfo.fkt_link || null,
        wh_location: masterInfo.wh_location || null,
        brand: masterInfo.brand || null,
        cms_vertical: masterInfo.cms_vertical || null,
        vrp: masterInfo.vrp || null,
        yield_value: masterInfo.yield_value || null,
        p_type: masterInfo.p_type || null,
        p_size: masterInfo.p_size || null
      });
    }

    console.log(`📊 Valid rows: ${validRows.length}, Duplicates: ${duplicateCount}, Cross-warehouse: ${crossWarehouseCount}`);

    // Insert in chunks
    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
      const chunk = validRows.slice(i, i + CHUNK_SIZE);

      try {
        const valuesClauses: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        for (const row of chunk) {
          const rowParams = [
            row.wsn, row.inbound_date, row.vehicle_no, row.product_serial_number,
            row.rack_no, row.unload_remarks, row.warehouse_id, row.warehouse_name,
            row.wid, row.fsn, row.order_id, row.fkqc_remark, row.fk_grade,
            row.product_title, row.hsn_sac, row.igst_rate, row.fsp, row.mrp,
            row.invoice_date, row.fkt_link, row.wh_location, row.brand,
            row.cms_vertical, row.vrp, row.yield_value, row.p_type, row.p_size,
            row.batch_id, row.created_by, row.created_user_name
          ];

          const placeholders = rowParams.map(() => `$${paramIndex++}`).join(', ');
          valuesClauses.push(`(${placeholders})`);
          params.push(...rowParams);
        }

        const sql = `
          INSERT INTO inbound (
            wsn, inbound_date, vehicle_no, product_serial_number,
            rack_no, unload_remarks, warehouse_id, warehouse_name,
            wid, fsn, order_id, fkqc_remark, fk_grade, product_title,
            hsn_sac, igst_rate, fsp, mrp, invoice_date, fkt_link,
            wh_location, brand, cms_vertical, vrp, yield_value,
            p_type, p_size, batch_id, created_by, created_user_name
          ) VALUES ${valuesClauses.join(', ')}
        `;

        const result = await query(sql, params);
        successCount += result.rowCount || 0;

      } catch (chunkError: any) {
        console.error('Chunk error:', chunkError.message);
      }
    }

    console.log(`🎉 Batch ${batchId}: ${successCount} success, ${duplicateCount} duplicates, ${crossWarehouseCount} cross-warehouse`);

  } catch (error: any) {
    console.error('Process bulk error:', error);
  } finally {
    try { fs.unlinkSync(filePath); } catch (e) { }
  }
}

// Multi-entry with duplicate highlighting
export const multiInboundEntry = async (req: Request, res: Response) => {
  try {
    const { entries, warehouse_id } = req.body;
    const userId = (req as any).user?.id;
    const userName = (req as any).user?.full_name || 'Unknown';

    if (!entries || entries.length === 0) {
      return res.status(400).json({ error: 'No entries provided' });
    }

    // Get warehouse name
    const whSql = `SELECT name FROM warehouses WHERE id = $1`;
    const whResult = await query(whSql, [warehouse_id]);
    const warehouseName = whResult.rows[0]?.name || '';

    // ✅ CRITICAL: Check EXISTING database WSNs across ALL warehouses
    const wsns = entries.map((e: any) => e.wsn).filter(Boolean);
    const existingMap = new Map<string, number>();

    if (wsns.length > 0) {
      const existingSql = `SELECT wsn, warehouse_id FROM inbound WHERE wsn = ANY($1)`;
      const existingResult = await query(existingSql, [wsns]);
      existingResult.rows.forEach((row: any) => {
        existingMap.set(row.wsn, row.warehouse_id);
      });
    }

    // ✅ ALSO CHECK: Duplicates within current entries array
    const wsnCountInCurrentBatch = new Map<string, number>();
    wsns.forEach((wsn: string) => {
      wsnCountInCurrentBatch.set(wsn, (wsnCountInCurrentBatch.get(wsn) || 0) + 1);
    });

    // Get master data
    const masterDataMap = new Map<string, any>();
    if (wsns.length > 0) {
      const masterSql = `SELECT * FROM master_data WHERE wsn = ANY($1)`;
      const masterResult = await query(masterSql, [wsns]);
      masterResult.rows.forEach((row: any) => {
        masterDataMap.set(row.wsn, row);
      });
    }

    // ❌ NO BATCH ID FOR MULTI ENTRY
    let successCount = 0;
    const results: any[] = [];

    for (const entry of entries) {
      if (!entry.wsn || !entry.wsn.trim()) continue;

      const wsn = entry.wsn.trim();

      // Check 1: Already exists in database?
      const isDuplicate = existingMap.has(wsn);
      const isCrossWarehouse = isDuplicate && existingMap.get(wsn) !== Number(warehouse_id);

      if (isCrossWarehouse) {
        results.push({
          wsn,
          status: 'CROSS_WAREHOUSE_ERROR',
          message: `WSN exists in different warehouse`,
        });
        continue;
      }

      if (isDuplicate) {
        results.push({
          wsn,
          status: 'DUPLICATE',
          message: 'Duplicate WSN in same warehouse',
          highlight: true
        });
        continue;
      }

      // Check 2: Duplicate within current batch?
      if (wsnCountInCurrentBatch.get(wsn)! > 1) {
        results.push({
          wsn,
          status: 'DUPLICATE',
          message: 'Duplicate WSN in this batch',
          highlight: true
        });
        continue;
      }

      const masterInfo = masterDataMap.get(wsn) || {};

      try {
        // ✅ NO BATCH_ID in INSERT
        const insertSql = `
          INSERT INTO inbound (
            wsn, inbound_date, vehicle_no, product_serial_number,
            rack_no, unload_remarks, warehouse_id, warehouse_name,
            wid, fsn, order_id, fk_qc_remark, fk_grade, product_title,
            hsn_sac, igst_rate, fsp, mrp, invoice_date, fkt_link,
            wh_location, brand, cms_vertical, vrp, yield_value, p_type, p_size,
            created_by, created_user_name
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            $21, $22, $23, $24, $25, $26, $27, $28, $29
          )
        `;

        await query(insertSql, [
          entry.wsn,
          entry.inbound_date,
          entry.vehicle_no,
          entry.product_serial_number,
          entry.rack_no,
          entry.unload_remarks,
          warehouse_id,
          warehouseName,
          masterInfo.wid || null,
          masterInfo.fsn || null,
          masterInfo.order_id || null,
          masterInfo.fk_qc_remark || null,
          masterInfo.fk_grade || null,
          masterInfo.product_title || null,
          masterInfo.hsn_sac || null,
          masterInfo.igst_rate || null,
          masterInfo.fsp || null,
          masterInfo.mrp || null,
          masterInfo.invoice_date || null,
          masterInfo.fkt_link || null,
          masterInfo.wh_location || null,
          masterInfo.brand || null,
          masterInfo.cms_vertical || null,
          masterInfo.vrp || null,
          masterInfo.yield_value || null,
          masterInfo.p_type || null,
          masterInfo.p_size || null,
          userId,
          userName
        ]);

        successCount++;
        results.push({
          wsn: entry.wsn,
          status: 'SUCCESS'
        });
      } catch (error) {
        results.push({
          wsn: entry.wsn,
          status: 'ERROR',
          message: 'Insert failed'
        });
      }
    }

    res.json({
      timestamp: new Date().toISOString(),
      successCount,
      totalCount: entries.length,
      results
    });

  } catch (error: any) {
    console.error('❌ Multi-entry error:', error);
    res.status(500).json({ error: error.message });
  }
};


// Get inbound list with filters
export const getInboundList = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 100, search = '', warehouseId, dateFrom, dateTo, category, brand } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereConditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Warehouse filter
    if (warehouseId) {
      whereConditions.push(`i.warehouse_id = $${paramIndex}`);
      params.push(warehouseId);
      paramIndex++;
    }

    // Search filter
    if (search && search !== '') {
      whereConditions.push(`(i.wsn ILIKE $${paramIndex} OR i.product_title ILIKE $${paramIndex} OR i.brand ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Date range filter
    if (dateFrom && dateTo) {
      whereConditions.push(`i.inbound_date >= $${paramIndex}`);
      whereConditions.push(`i.inbound_date <= $${paramIndex + 1}`);
      params.push(dateFrom);
      params.push(dateTo);
      paramIndex += 2;
    }

    // Brand filter - FIXED
    if (brand && brand !== '') {
      whereConditions.push(`i.brand = $${paramIndex}`);
      params.push(brand);
      paramIndex++;
    }

    // Category filter - FIXED
    if (category && category !== '') {
      whereConditions.push(`i.cms_vertical = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // Get total count
    const countSql = `SELECT COUNT(*) FROM inbound i ${whereClause}`;
    const countResult = await query(countSql, params);
    const total = parseInt(countResult.rows[0].count);

    // Get paginated data
    const dataSql = `
      SELECT 
        i.id, i.wsn, i.inbound_date, i.vehicle_no, i.rack_no,
        i.product_serial_number, i.unload_remarks, i.batch_id,
        i.product_title, i.brand, i.cms_vertical, i.mrp, i.fsp,
        i.warehouse_id, i.warehouse_name, i.created_at
      FROM inbound i
      ${whereClause}
      ORDER BY i.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(Number(limit));
    params.push(offset);

    const result = await query(dataSql, params);

    res.json({
      data: result.rows,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit))
    });

  } catch (error: any) {
    console.error('❌ Get inbound list error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get batches
export const getInboundBatches = async (req: Request, res: Response) => {
  try {
    const { warehouseId } = req.query;

    let sql = `
      SELECT 
        batch_id, 
        COUNT(*) as count, 
        MAX(created_at) as last_updated
      FROM inbound
      WHERE batch_id IS NOT NULL
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (warehouseId) {
      sql += ` AND warehouse_id = $${paramIndex}`;
      params.push(warehouseId);
      paramIndex++;
    }

    sql += `
      GROUP BY batch_id
      ORDER BY last_updated DESC
    `;

    const result = await query(sql, params);
    res.json(result.rows);

  } catch (error: any) {
    console.error('❌ Get batches error:', error);
    res.status(500).json({ error: error.message });
  }
};


// Delete batch
export const deleteInboundBatch = async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;
    const result = await query('DELETE FROM inbound WHERE batch_id = $1', [batchId]);

    res.json({
      message: 'Batch deleted',
      count: result.rowCount
    });

  } catch (error: any) {
    console.error('Delete batch error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get racks
export const getWarehouseRacks = async (req: Request, res: Response) => {
  try {
    const { warehouseId } = req.params;

    const sql = `
      SELECT id, rack_name, rack_type, capacity, location
      FROM racks
      WHERE warehouse_id = $1 AND is_active = true
      ORDER BY rack_name
    `;

    const result = await query(sql, [warehouseId]);
    res.json(result.rows);

  } catch (error: any) {
    console.error('Get racks error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get brands
export const getUniqueBrands = async (req: Request, res: Response) => {
  try {
    const { warehouse_id } = req.query;
    const params: any[] = [];

    let whereClause = 'WHERE brand IS NOT NULL';

    if (warehouse_id) {
      params.push(warehouse_id);
      whereClause += ` AND warehouse_id = $${params.length}`;
    }

    const sql = `
      SELECT DISTINCT brand
      FROM inbound
      ${whereClause}
      ORDER BY brand;
    `;

    const result = await query(sql, params);
    res.json(result.rows.map((row: any) => row.brand));
  } catch (error: any) {
    console.error('Get brands error:', error);
    res.status(500).json({ error: error.message });
  }
};


// Get categories
export const getUniqueCategories = async (req: Request, res: Response) => {
  try {
    const { warehouse_id } = req.query;
    const params: any[] = [];

    let whereClause = 'WHERE cms_vertical IS NOT NULL';

    if (warehouse_id) {
      params.push(warehouse_id);
      whereClause += ` AND warehouse_id = $${params.length}`;
    }

    const sql = `
      SELECT DISTINCT cms_vertical
      FROM inbound
      ${whereClause}
      ORDER BY cms_vertical;
    `;

    const result = await query(sql, params);
    res.json(result.rows.map((row: any) => row.cms_vertical));
  } catch (error: any) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: error.message });
  }
};


// Get unique brands
export const getBrands = async (req: Request, res: Response) => {
  try {
    const { warehouse_id } = req.query;
    
    let sql = `
      SELECT DISTINCT m.brand 
      FROM inbound i
      JOIN master_data m ON i.wsn = m.wsn
      WHERE m.brand IS NOT NULL AND m.brand != ''
    `;
    
    const params: any[] = [];
    
    if (warehouse_id) {
      sql += ` AND i.warehouse_id = $1`;
      params.push(warehouse_id);
    }
    
    sql += ` ORDER BY m.brand`;
    
    const result = await query(sql, params);
    res.json(result.rows.map(r => r.brand));
  } catch (error: any) {
    console.error('Get brands error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get unique categories
export const getCategories = async (req: Request, res: Response) => {
  try {
    const { warehouse_id } = req.query;
    
    let sql = `
      SELECT DISTINCT m.cms_vertical 
      FROM inbound i
      JOIN master_data m ON i.wsn = m.wsn
      WHERE m.cms_vertical IS NOT NULL AND m.cms_vertical != ''
    `;
    
    const params: any[] = [];
    
    if (warehouse_id) {
      sql += ` AND i.warehouse_id = $1`;
      params.push(warehouse_id);
    }
    
    sql += ` ORDER BY m.cms_vertical`;
    
    const result = await query(sql, params);
    res.json(result.rows.map(r => r.cms_vertical));
  } catch (error: any) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: error.message });
  }
};
