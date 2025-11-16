import { Request, Response } from 'express';
import { query } from '../config/database';
import { generateBatchId } from '../utils/helpers';
import * as XLSX from 'xlsx';
import fs from 'fs';

// ============ SINGLE QC ENTRY ============
export const createSingleQC = async (req: Request, res: Response) => {
  try {
    const {
      wsn,
      qc_date,
      qc_by,
      product_serial_number,
      qc_remarks,
      other_remarks,
      rack_no,
      warehouse_id,
      status = 'PENDING'
    } = req.body;

    const userId = (req as any).user?.id;
    const userName = (req as any).user?.full_name || 'Unknown';

    console.log('🔍 Creating single QC entry:', { wsn, warehouse_id });

    // Check if WSN exists in inbound
    const inboundSql = `
      SELECT i.*, m.* FROM inbound i
      LEFT JOIN master_data m ON i.wsn = m.wsn
      WHERE i.wsn = $1 AND i.warehouse_id = $2 LIMIT 1
    `;
    const inboundResult = await query(inboundSql, [wsn, warehouse_id]);

    if (inboundResult.rows.length === 0) {
      return res.status(404).json({ error: 'WSN not found in Inbound' });
    }

    const inboundData = inboundResult.rows[0];

    // Check duplicate QC
    const checkQCSql = `SELECT id FROM qc WHERE wsn = $1 AND warehouse_id = $2 LIMIT 1`;
    const checkQCResult = await query(checkQCSql, [wsn, warehouse_id]);

    if (checkQCResult.rows.length > 0) {
      return res.status(409).json({ error: 'QC already exists for this WSN' });
    }

    // Get warehouse name
    const whSql = `SELECT name FROM warehouses WHERE id = $1`;
    const whResult = await query(whSql, [warehouse_id]);
    const warehouseName = whResult.rows[0]?.name || '';

    // Insert QC entry (NO BATCH_ID for single entry)
    const insertSql = `
      INSERT INTO qc (
        wsn, qc_date, qc_by, product_serial_number, qc_remarks,
        other_remarks, rack_no, warehouse_id, warehouse_name,
        product_title, brand, mrp, fsp, hsn_sac, igst_rate,
        cms_vertical, fkt_link, wid, fsn, order_id, fkqc_remark,
        fk_grade, invoice_date, wh_location, vrp, yield_value,
        p_type, p_size, status, created_by, created_user_name
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21,
        $22, $23, $24, $25, $26,
        $27, $28, $29, $30, $31
      )
      RETURNING *
    `;

    const result = await query(insertSql, [
      wsn,
      qc_date || new Date(),
      qc_by || userName,
      product_serial_number || null,
      qc_remarks || null,
      other_remarks || null,
      rack_no || null,
      warehouse_id,
      warehouseName,
      inboundData.product_title || null,
      inboundData.brand || null,
      inboundData.mrp || null,
      inboundData.fsp || null,
      inboundData.hsn_sac || null,
      inboundData.igst_rate || null,
      inboundData.cms_vertical || null,
      inboundData.fkt_link || null,
      inboundData.wid || null,
      inboundData.fsn || null,
      inboundData.order_id || null,
      inboundData.fkqc_remark || null,
      inboundData.fk_grade || null,
      inboundData.invoice_date || null,
      inboundData.wh_location || null,
      inboundData.vrp || null,
      inboundData.yield_value || null,
      inboundData.p_type || null,
      inboundData.p_size || null,
      status,
      userId,
      userName
    ]);

    console.log('✅ Single QC entry created');
    res.status(201).json({ ...result.rows[0], action: 'created' });

  } catch (error: any) {
    console.error('❌ Create QC error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============ MULTI-ENTRY QC ============
export const multiQCEntry = async (req: Request, res: Response) => {
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

    const wsns = entries.map((e: any) => e.wsn).filter(Boolean);

    // Get inbound data
    const inboundSql = `
      SELECT i.*, m.* FROM inbound i
      LEFT JOIN master_data m ON i.wsn = m.wsn
      WHERE i.wsn = ANY($1) AND i.warehouse_id = $2
    `;
    const inboundResult = await query(inboundSql, [wsns, warehouse_id]);
    const inboundMap = new Map();
    inboundResult.rows.forEach((row: any) => {
      inboundMap.set(row.wsn, row);
    });

    // Check existing QC
    const qcCheckSql = `SELECT wsn FROM qc WHERE wsn = ANY($1) AND warehouse_id = $2`;
    const qcCheckResult = await query(qcCheckSql, [wsns, warehouse_id]);
    const existingQC = new Set(qcCheckResult.rows.map((r: any) => r.wsn));

    // ✅ FIXED: Call with proper parameter
    const batchId = generateBatchId('QC_MULTI', entries.length);

    let successCount = 0;
    const results: any[] = [];

    for (const entry of entries) {
      const wsn = entry.wsn?.trim();
      if (!wsn) continue;

      // Check if already QCed
      if (existingQC.has(wsn)) {
        results.push({
          wsn,
          status: 'DUPLICATE',
          message: 'QC already exists'
        });
        continue;
      }

      // Check if in inbound
      if (!inboundMap.has(wsn)) {
        results.push({
          wsn,
          status: 'NOT_FOUND',
          message: 'WSN not found in Inbound'
        });
        continue;
      }

      const inboundData = inboundMap.get(wsn);

      const insertSql = `
        INSERT INTO qc (
          wsn, qc_date, qc_by, product_serial_number, qc_remarks,
          other_remarks, rack_no, warehouse_id, warehouse_name,
          product_title, brand, mrp, fsp, hsn_sac, igst_rate,
          cms_vertical, fkt_link, wid, fsn, order_id, fkqc_remark,
          fk_grade, invoice_date, wh_location, vrp, yield_value,
          p_type, p_size, batch_id, status, created_by, created_user_name
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21,
          $22, $23, $24, $25, $26,
          $27, $28, $29, $30, $31, $32
        )
        RETURNING *
      `;

      await query(insertSql, [
        wsn,
        entry.qc_date || new Date(),
        entry.qc_by || userName,
        entry.product_serial_number || null,
        entry.qc_remarks || null,
        entry.other_remarks || null,
        entry.rack_no || null,
        warehouse_id,
        warehouseName,
        inboundData.product_title || null,
        inboundData.brand || null,
        inboundData.mrp || null,
        inboundData.fsp || null,
        inboundData.hsn_sac || null,
        inboundData.igst_rate || null,
        inboundData.cms_vertical || null,
        inboundData.fkt_link || null,
        inboundData.wid || null,
        inboundData.fsn || null,
        inboundData.order_id || null,
        inboundData.fkqc_remark || null,
        inboundData.fk_grade || null,
        inboundData.invoice_date || null,
        inboundData.wh_location || null,
        inboundData.vrp || null,
        inboundData.yield_value || null,
        inboundData.p_type || null,
        inboundData.p_size || null,
        batchId,
        entry.status || 'PENDING',
        userId,
        userName
      ]);

      results.push({ wsn, status: 'SUCCESS' });
      successCount++;
    }

    res.json({
      batchId,
      totalCount: entries.length,
      successCount,
      results
    });

  } catch (error: any) {
    console.error('❌ Multi QC error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============ BULK QC UPLOAD ============
export const bulkQCUpload = async (req: Request, res: Response) => {
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

    // ✅ FIXED: Call with proper parameter
    const batchId = generateBatchId('QC_BULK', data.length);

    res.status(202).json({
      message: 'Upload started',
      batchId,
      totalRows: data.length,
      timestamp: new Date().toISOString()
    });

    // Process in background
    processQCBulk(data, batchId, warehouse_id, userId, userName, filePath);

  } catch (error: any) {
    console.error('❌ Bulk upload error:', error);
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
    }
    res.status(500).json({ error: error.message });
  }
};

async function processQCBulk(data: any[], batchId: string, warehouseId: string, userId: number, userName: string, filePath: string) {
  const CHUNK_SIZE = 500;
  let successCount = 0;
  let duplicateCount = 0;
  let notFoundCount = 0;

  try {
    const whSql = `SELECT name FROM warehouses WHERE id = $1`;
    const whResult = await query(whSql, [warehouseId]);
    const warehouseName = whResult.rows[0]?.name || '';

    const wsns = data.map((row: any) => row['WSN'] || row['wsn']).filter(Boolean);

    // Get inbound data
    const inboundSql = `
      SELECT i.*, m.* FROM inbound i
      LEFT JOIN master_data m ON i.wsn = m.wsn
      WHERE i.wsn = ANY($1) AND i.warehouse_id = $2
    `;
    const inboundResult = await query(inboundSql, [wsns, warehouseId]);
    const inboundMap = new Map();
    inboundResult.rows.forEach((row: any) => {
      inboundMap.set(row.wsn, row);
    });

    // Check existing QC
    const qcCheckSql = `SELECT wsn FROM qc WHERE wsn = ANY($1) AND warehouse_id = $2`;
    const qcCheckResult = await query(qcCheckSql, [wsns, warehouseId]);
    const existingQC = new Set(qcCheckResult.rows.map((r: any) => r.wsn));

    const validRows: any[] = [];

    for (const row of data) {
      const wsn = String(row['WSN'] || row['wsn'] || '').trim();
      if (!wsn) continue;

      if (existingQC.has(wsn)) {
        duplicateCount++;
        continue;
      }

      if (!inboundMap.has(wsn)) {
        notFoundCount++;
        continue;
      }

      const inboundData = inboundMap.get(wsn);

      validRows.push({
        wsn,
        qc_date: row['QC_DATE'] || row['qc_date'] || new Date(),
        qc_by: row['QC_BY'] || row['qc_by'] || userName,
        product_serial_number: row['PRODUCT_SERIAL_NUMBER'] || row['product_serial_number'] || null,
        qc_remarks: row['QC_REMARKS'] || row['qc_remarks'] || null,
        other_remarks: row['OTHER_REMARKS'] || row['other_remarks'] || null,
        rack_no: row['rack_no'] || row['rack_no'] || null,
        warehouse_id: warehouseId,
        warehouse_name: warehouseName,
        batch_id: batchId,
        product_title: inboundData.product_title || null,
        brand: inboundData.brand || null,
        mrp: inboundData.mrp || null,
        fsp: inboundData.fsp || null,
        hsn_sac: inboundData.hsn_sac || null,
        igst_rate: inboundData.igst_rate || null,
        cms_vertical: inboundData.cms_vertical || null,
        fkt_link: inboundData.fkt_link || null,
        wid: inboundData.wid || null,
        fsn: inboundData.fsn || null,
        order_id: inboundData.order_id || null,
        fkqc_remark: inboundData.fkqc_remark || null,
        fk_grade: inboundData.fk_grade || null,
        invoice_date: inboundData.invoice_date || null,
        wh_location: inboundData.wh_location || null,
        vrp: inboundData.vrp || null,
        yield_value: inboundData.yield_value || null,
        p_type: inboundData.p_type || null,
        p_size: inboundData.p_size || null,
        status: row['STATUS'] || row['status'] || 'PENDING',
        created_by: userId,
        created_user_name: userName
      });
    }

    console.log(`📊 Valid rows: ${validRows.length}, Duplicates: ${duplicateCount}, Not found: ${notFoundCount}`);

    // Insert in chunks
    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
      const chunk = validRows.slice(i, i + CHUNK_SIZE);

      const valuesClauses: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      for (const row of chunk) {
        const rowParams = [
          row.wsn, row.qc_date, row.qc_by, row.product_serial_number, row.qc_remarks,
          row.other_remarks, row.rack_no, row.warehouse_id, row.warehouse_name,
          row.product_title, row.brand, row.mrp, row.fsp, row.hsn_sac, row.igst_rate,
          row.cms_vertical, row.fkt_link, row.wid, row.fsn, row.order_id, row.fkqc_remark,
          row.fk_grade, row.invoice_date, row.wh_location, row.vrp, row.yield_value,
          row.p_type, row.p_size, row.batch_id, row.status, row.created_by, row.created_user_name
        ];

        const placeholders = rowParams.map(() => `$${paramIndex++}`).join(', ');
        valuesClauses.push(`(${placeholders})`);
        params.push(...rowParams);
      }

      const sql = `
        INSERT INTO qc (
          wsn, qc_date, qc_by, product_serial_number, qc_remarks,
          other_remarks, rack_no, warehouse_id, warehouse_name,
          product_title, brand, mrp, fsp, hsn_sac, igst_rate,
          cms_vertical, fkt_link, wid, fsn, order_id, fkqc_remark,
          fk_grade, invoice_date, wh_location, vrp, yield_value,
          p_type, p_size, batch_id, status, created_by, created_user_name
        ) VALUES ${valuesClauses.join(', ')}
      `;

      const result = await query(sql, params);
      successCount += result.rowCount || 0;
    }

    console.log(`🎉 Batch ${batchId}: ${successCount} success, ${duplicateCount} duplicates, ${notFoundCount} not found`);

  } catch (error: any) {
    console.error('Process bulk error:', error);
  } finally {
    try { fs.unlinkSync(filePath); } catch (e) { }
  }
}

// ============ GET QC LIST ============
export const getQCList = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 100, search = '', warehouseId, status, dateFrom, dateTo, brand, category } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereConditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (warehouseId) {
      whereConditions.push(`warehouse_id = $${paramIndex}`);
      params.push(warehouseId);
      paramIndex++;
    }

    if (status && status !== '') {
      whereConditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (search && search !== '') {
      whereConditions.push(`(wsn ILIKE $${paramIndex} OR product_title ILIKE $${paramIndex} OR brand ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (dateFrom && dateTo) {
      whereConditions.push(`qc_date >= $${paramIndex} AND qc_date <= $${paramIndex + 1}`);
      params.push(dateFrom, dateTo);
      paramIndex += 2;
    }

    if (brand && brand !== '') {
      whereConditions.push(`brand = $${paramIndex}`);
      params.push(brand);
      paramIndex++;
    }

    if (category && category !== '') {
      whereConditions.push(`cms_vertical = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const countSql = `SELECT COUNT(*) FROM qc ${whereClause}`;
    const countResult = await query(countSql, params);
    const total = parseInt(countResult.rows[0].count);

    const dataSql = `
      SELECT
        id, wsn, qc_date, qc_by, product_serial_number, qc_remarks,
        other_remarks, rack_no, product_title, brand, cms_vertical,
        mrp, fsp, warehouse_id, warehouse_name, batch_id, status, created_at
      FROM qc
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(Number(limit), offset);
    const result = await query(dataSql, params);

    res.json({
      data: result.rows,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit))
    });

  } catch (error: any) {
    console.error('❌ Get QC list error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============ GET QC BATCHES ============
export const getQCBatches = async (req: Request, res: Response) => {
  try {
    const { warehouseId } = req.query;

    let sql = `
      SELECT
        batch_id,
        COUNT(*) as count,
        MAX(created_at) as last_updated
      FROM qc
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

// ============ DELETE QC BATCH ============
export const deleteQCBatch = async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;

    const result = await query('DELETE FROM qc WHERE batch_id = $1', [batchId]);

    res.json({
      message: 'Batch deleted',
      count: result.rowCount
    });

  } catch (error: any) {
    console.error('Delete batch error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============ GET INBOUND DATA BY WSN ============
export const getInboundByWSN = async (req: Request, res: Response) => {
  try {
    const { wsn } = req.params;
    const { warehouse_id } = req.query;

    console.log('🔍 Fetching inbound data for WSN:', wsn);

    const sql = `
      SELECT i.*, m.* FROM inbound i
      LEFT JOIN master_data m ON i.wsn = m.wsn
      WHERE i.wsn = $1 AND i.warehouse_id = $2 LIMIT 1
    `;

    const result = await query(sql, [wsn, warehouse_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'WSN not found in Inbound' });
    }

    res.json(result.rows[0]);

  } catch (error: any) {
    console.error('❌ Get inbound by WSN error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============ GET BRANDS ============
export const getBrands = async (req: Request, res: Response) => {
  try {
    const { warehouse_id } = req.query;

    let sql = `SELECT DISTINCT brand FROM qc WHERE brand IS NOT NULL AND brand != ''`;
    const params: any[] = [];

    if (warehouse_id) {
      sql += ` AND warehouse_id = $1`;
      params.push(warehouse_id);
    }

    sql += ` ORDER BY brand`;
    const result = await query(sql, params);

    res.json(result.rows.map(r => r.brand));

  } catch (error: any) {
    console.error('Get brands error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============ GET CATEGORIES ============
export const getCategories = async (req: Request, res: Response) => {
  try {
    const { warehouse_id } = req.query;

    let sql = `SELECT DISTINCT cms_vertical FROM qc WHERE cms_vertical IS NOT NULL AND cms_vertical != ''`;
    const params: any[] = [];

    if (warehouse_id) {
      sql += ` AND warehouse_id = $1`;
      params.push(warehouse_id);
    }

    sql += ` ORDER BY cms_vertical`;
    const result = await query(sql, params);

    res.json(result.rows.map(r => r.cms_vertical));

  } catch (error: any) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: error.message });
  }
};



// Check if WSN exists
export const checkWSNExists = async (req: Request, res: Response) => {
  try {
    const { wsn } = req.query;

    const sql = `SELECT id FROM qc WHERE wsn = $1 LIMIT 1`;
    const result = await query(sql, [wsn]);

    res.json({ 
      exists: result.rows.length > 0,
      id: result.rows[0]?.id || null
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Update single QC
export const updateSingleQC = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { qc_date, qc_by, product_serial_number, qc_remarks, other_remarks, rack_no, qc_grade } = req.body;

    const sql = `
      UPDATE qc SET 
        qc_date = $1, qc_by = $2, product_serial_number = $3,
        qc_remarks = $4, other_remarks = $5, rack_no = $6, qc_grade = $7,
        updated_at = NOW()
      WHERE id = $8
      RETURNING *
    `;

    const result = await query(sql, [
      qc_date, qc_by, product_serial_number, qc_remarks, 
      other_remarks, rack_no, qc_grade, id
    ]);

    res.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Get existing WSNs
export const getExistingWSNs = async (req: Request, res: Response) => {
  try {
    const { warehouse_id } = req.query;

    const sql = `
      SELECT DISTINCT wsn FROM qc 
      WHERE warehouse_id = $1
      ORDER BY wsn
    `;

    const result = await query(sql, [warehouse_id]);
    res.json(result.rows.map(r => r.wsn));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};