import { Request, Response } from 'express';
import { query } from '../config/database';
import { generateBatchId } from '../utils/helpers';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

// Progress tracking with file-based persistence
const PROGRESS_DIR = path.join(__dirname, '../../temp/progress');

// Ensure progress directory exists
if (!fs.existsSync(PROGRESS_DIR)) {
  fs.mkdirSync(PROGRESS_DIR, { recursive: true });
}

function saveProgress(jobId: string, data: any) {
  const filePath = path.join(PROGRESS_DIR, `${jobId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data));
}

function getProgress(jobId: string) {
  const filePath = path.join(PROGRESS_DIR, `${jobId}.json`);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return null;
}

function deleteProgress(jobId: string) {
  const filePath = path.join(PROGRESS_DIR, `${jobId}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export const getMasterData = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 100, search = '' } = req.query;
    const offset = ((Number(page) - 1) * Number(limit));

    let whereClause = '';
    const params: any[] = [];

    if (search && search !== '') {
      whereClause = `WHERE wsn ILIKE $3 OR fsn ILIKE $3 OR brand ILIKE $3 OR product_title ILIKE $3`;
      params.push(`%${search}%`);
    }

    params.unshift(limit);
    params.splice(1, 0, offset);

    const result = await query(
      `SELECT * FROM master_data
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    const countSql = search ? 
      `SELECT COUNT(*) FROM master_data WHERE wsn ILIKE $1 OR fsn ILIKE $1 OR brand ILIKE $1 OR product_title ILIKE $1` :
      'SELECT COUNT(*) FROM master_data';
    
    const countParams = search ? [`%${search}%`] : [];
    const countResult = await query(countSql, countParams);

    res.json({
    data: result.rows || [],
    total: parseInt(countResult.rows?.[0]?.count || "0", 10),
    page: Number(page) || 1,
    limit: Number(limit) || 100,
    });
    
  } catch (error: any) {
    console.error('Get master data error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Replace this block:
export const uploadMasterData = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const batchId = generateBatchId('BULK');
    const jobId = `job_${Date.now()}`;

    // Initialize progress
    const progressData = {
      status: 'processing',
      processed: 0,
      total: 0,
      successCount: 0,
      errorCount: 0,
      batchId,
      startTime: Date.now(),
    };
    saveProgress(jobId, progressData);

    // Send response immediately
    res.status(202).json({
      message: 'Streaming upload started',
      jobId,
      batchId,
    });

    // Process in background
    processExcelStream(filePath, batchId, jobId);

  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
};

async function processExcelStream(filePath: string, batchId: string, jobId: string) {
  const workbook = new ExcelJS.Workbook();
  const validRows: any[] = [];
  let rowCount = 0;
  let successCount = 0;
  let errorCount = 0;
  const CHUNK_SIZE = 3000;

  try {
    console.log(`🔄 Stream reading: ${filePath}`);

    // Stream read first sheet
    const stream = fs.createReadStream(filePath);
    await workbook.xlsx.read(stream);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('No worksheet found');
    }

    // Count total rows for progress
    worksheet.eachRow(() => rowCount++);
    const progress = getProgress(jobId);
    if (progress) {
      progress.total = rowCount;
      saveProgress(jobId, progress);
    }

    let processedRows = 0;

    // Re-read (stream again) for actual data
    const workbook2 = new ExcelJS.Workbook();
    await workbook2.xlsx.readFile(filePath);
    const ws = workbook2.worksheets[0];

    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const wsn = row.getCell('A').value; // Adjust column names as per your Excel

      if (!wsn) continue;

      validRows.push({
        wsn: String(wsn).trim(),
        wid: row.getCell('B').value || null,
        fsn: row.getCell('C').value || null,
        // ... map all your columns ...
        batchId
      });

      if (validRows.length >= CHUNK_SIZE) {
        await insertChunk(validRows, batchId);
        processedRows += validRows.length;
        validRows.length = 0; // clear array

        const prog = getProgress(jobId);
        if (prog) {
          prog.processed = processedRows;
          prog.successCount = processedRows;
          saveProgress(jobId, prog);
        }

        console.log(`✓ Processed ${processedRows}/${rowCount}`);
      }
    }

    // Final remaining rows
    if (validRows.length > 0) {
      await insertChunk(validRows, batchId);
    }

    const finalProgress = getProgress(jobId);
    if (finalProgress) {
      finalProgress.status = 'completed';
      finalProgress.processed = rowCount;
      finalProgress.successCount = rowCount;
      saveProgress(jobId, finalProgress);
    }

    console.log(`🎉 Upload complete for batch ${batchId}`);

  } catch (err: any) {
    console.error('Stream processing error:', err);
    const progress = getProgress(jobId);
    if (progress) {
      progress.status = 'failed';
      saveProgress(jobId, progress);
    }
  } finally {
    fs.unlinkSync(filePath);
  }
}

async function insertChunk(rows: any[], batchId: string) {
  const params: any[] = [];
  const valueClauses: string[] = [];
  let paramIndex = 1;

  for (const row of rows) {
    const cols = [
      row.wsn, row.wid, row.fsn, row.order_id, row.fkqc_remark, row.fk_grade,
      row.product_title, row.hsn_sac, row.igst_rate, row.fsp, row.mrp,
      row.invoice_date, row.fkt_link, row.wh_location, row.brand, row.cms_vertical,
      row.vrp, row.yield_value, row.p_type, row.p_size, row.batchId,
    ];

    const placeholders = cols.map(() => `$${paramIndex++}`).join(', ');
    valueClauses.push(`(${placeholders})`);
    params.push(...cols);
  }

  const sql = `
    INSERT INTO master_data (
      wsn, wid, fsn, order_id, fkqc_remark, fk_grade, product_title,
      hsn_sac, igst_rate, fsp, mrp, invoice_date, fkt_link,
      wh_location, brand, cms_vertical, vrp, yield_value, p_type, p_size, batch_id
    )
    VALUES ${valueClauses.join(', ')}
    ON CONFLICT (wsn) DO NOTHING
  `;

  await query(sql, params);
}


async function processUploadInBackground(data: any[], batchId: string, jobId: string, filePath: string) {
  const CHUNK_SIZE = 3000;
  const validRows: any[] = [];

  try {
    console.log(`🔄 Processing ${data.length} rows for batch ${batchId}`);

    // Validation
    for (let i = 0; i < data.length; i++) {
      const row: any = data[i];
      const wsn = row['WSN'] || row['wsn'];
      
      if (!wsn) continue;

      validRows.push({
        wsn: String(wsn).trim(),
        wid: row['WID'] || row['wid'] || null,
        fsn: row['FSN'] || row['fsn'] || null,
        order_id: row['Order_ID'] || row['order_id'] || null,
        fkqc_remark: row['FKQC_Remark'] || row['fkqc_remark'] || null,
        fk_grade: row['FK_Grade'] || row['fk_grade'] || null,
        product_title: row['Product_Title'] || row['product_title'] || null,
        hsn_sac: row['HSN/SAC'] || row['hsn_sac'] || null,
        igst_rate: row['IGST_Rate'] || row['igst_rate'] || null,
        fsp: row['FSP'] || row['fsp'] || null,
        mrp: row['MRP'] || row['mrp'] || null,
        invoice_date: row['Invoice_Date'] || row['invoice_date'] || null,
        fkt_link: row['Fkt_Link'] || row['fkt_link'] || null,
        wh_location: row['Wh_Location'] || row['wh_location'] || null,
        brand: row['BRAND'] || row['brand'] || null,
        cms_vertical: row['cms_vertical'] || row['CMS_Vertical'] || null,
        vrp: row['VRP'] || row['vrp'] || null,
        yield_value: row['Yield_Value'] || row['yield_value'] || null,
        p_type: row['P_Type'] || row['p_type'] || null,
        p_size: row['P_Size'] || row['p_size'] || null,
        batchId
      });
    }

    console.log(`✅ Validated ${validRows.length} rows`);

    let successCount = 0;
    let errorCount = 0;

    // Process chunks
    const totalChunks = Math.ceil(validRows.length / CHUNK_SIZE);
    
    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
      const chunk = validRows.slice(i, i + CHUNK_SIZE);
      const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
      
      try {
        const valuesClauses: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        for (const row of chunk) {
          const rowParams = [
            row.wsn, row.wid, row.fsn, row.order_id, row.fkqc_remark, row.fk_grade,
            row.product_title, row.hsn_sac, row.igst_rate, row.fsp, row.mrp,
            row.invoice_date, row.fkt_link, row.wh_location, row.brand, row.cms_vertical,
            row.vrp, row.yield_value, row.p_type, row.p_size, row.batchId
          ];

          const placeholders = rowParams.map(() => `$${paramIndex++}`).join(', ');
          valuesClauses.push(`(${placeholders})`);
          params.push(...rowParams);
        }

        const sql = `INSERT INTO master_data (
          wsn, wid, fsn, order_id, fkqc_remark, fk_grade, product_title, hsn_sac,
          igst_rate, fsp, mrp, invoice_date, fkt_link, wh_location, brand, cms_vertical,
          vrp, yield_value, p_type, p_size, batch_id
        ) VALUES ${valuesClauses.join(', ')} ON CONFLICT (wsn) DO NOTHING`;

        const result = await query(sql, params);
        successCount += result.rowCount || 0;
        
        // Update progress
        const progress = getProgress(jobId);
        if (progress) {
          progress.processed = Math.min(i + chunk.length, validRows.length);
          progress.successCount = successCount;
          progress.errorCount = errorCount;
          saveProgress(jobId, progress);
        }

        console.log(`✓ Chunk ${chunkNum}/${totalChunks}: ${result.rowCount} inserted`);

      } catch (chunkError: any) {
        console.error(`✗ Chunk ${chunkNum} error:`, chunkError.message);
        errorCount += chunk.length;
      }
    }

    // Mark complete
    const finalProgress = getProgress(jobId);
    if (finalProgress) {
      finalProgress.status = 'completed';
      finalProgress.processed = validRows.length;
      finalProgress.successCount = successCount;
      finalProgress.errorCount = errorCount;
      saveProgress(jobId, finalProgress);
    }

    console.log(`🎉 Batch ${batchId} complete: ${successCount} success, ${errorCount} errors`);

  } catch (error: any) {
    const progress = getProgress(jobId);
    if (progress) {
      progress.status = 'failed';
      saveProgress(jobId, progress);
    }
    console.error('Processing failed:', error);
  } finally {
    try { fs.unlinkSync(filePath); } catch (e) { }
    
    // Clean up after 1 hour
    setTimeout(() => deleteProgress(jobId), 3600000);
  }
}

export const getUploadProgress = async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const progress = getProgress(jobId);
  
  if (!progress) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json(progress);
};

export const cancelUpload = async (req: Request, res: Response) => {
  const { jobId } = req.params;
  deleteProgress(jobId);
  res.json({ message: 'Upload cancelled' });
};

export const deleteMasterData = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM master_data WHERE id = $1', [id]);
    res.json({ message: 'Deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteBatch = async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;
    const result = await query('DELETE FROM master_data WHERE batch_id = $1', [batchId]);
    res.json({ message: 'Batch deleted', count: result.rowCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getBatches = async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT batch_id, COUNT(*) as count, MAX(created_at) as lastupdated
       FROM master_data GROUP BY batch_id ORDER BY lastupdated DESC`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// Get active uploads (for page reload recovery)
export const getActiveUploads = async (req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(PROGRESS_DIR);
    const activeJobs = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const jobId = f.replace('.json', '');
        const progress = getProgress(jobId);
        return { jobId, ...progress };
      })
      .filter(job => job.status === 'processing');
    
    res.json(activeJobs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const exportMasterData = async (req: Request, res: Response) => {
  try {
    const { batchIds, dateFrom, dateTo } = req.query;
    
    let whereConditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Filter by batch IDs
    if (batchIds && typeof batchIds === 'string') {
      const batchArray = batchIds.split(',');
      const batchPlaceholders = batchArray.map(() => `$${paramIndex++}`).join(', ');
      whereConditions.push(`batch_id IN (${batchPlaceholders})`);
      params.push(...batchArray);
    }

    // Filter by date range
    if (dateFrom && dateTo) {
      whereConditions.push(`created_at >= $${paramIndex++}`);
      whereConditions.push(`created_at <= $${paramIndex++}`);
      params.push(dateFrom);
      params.push(new Date(dateTo + ' 23:59:59')); // Include full end date
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}` 
      : '';

    const sql = `
      SELECT * FROM master_data
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT 500000
    `;

    console.log('Export query:', sql);
    console.log('Export params:', params);

    const result = await query(sql, params);

    res.json({
      data: result.rows,
      count: result.rows.length
    });

  } catch (error: any) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
};



