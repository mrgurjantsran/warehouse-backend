import { Request, Response } from 'express';
import { query } from '../config/database';
import { generateBatchId } from '../utils/helpers';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { createReadStream } from 'fs';
import * as XLSX from 'xlsx';

const PROGRESS_DIR = path.join(__dirname, '../../temp/progress');

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
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (error: any) {
    console.error('❌ Get master data error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * ✅ Upload - Stream processing (NO memory issues)
 */
export const uploadMasterData = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const fileSize = (req.file.size / 1024 / 1024).toFixed(2);

    console.log(`📤 Upload: ${req.file.originalname} (${fileSize}MB)`);

    const batchId = generateBatchId('BULK');
    const jobId = `job_${Date.now()}`;

    // Immediate response
    res.status(202).json({
      message: 'Upload started',
      jobId,
      batchId,
      fileSize
    });

    // Background processing
    if (fileExt === '.csv') {
      processCSVStream(filePath, batchId, jobId);
    } else {
      processExcelStream(filePath, batchId, jobId);
    }

  } catch (error: any) {
    console.error('❌ Upload error:', error);
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
    }
    res.status(500).json({ error: error.message });
  }
};

/**
 * ✅ CSV Stream Processing
 */
async function processCSVStream(filePath: string, batchId: string, jobId: string) {
  const CHUNK_SIZE = 500;
  let rows: any[] = [];
  let total = 0;
  let success = 0;

  try {
    saveProgress(jobId, {
      status: 'processing',
      processed: 0,
      total: 0,
      successCount: 0,
      batchId
    });

    const stream = createReadStream(filePath).pipe(csv());

    stream.on('data', async (row: any) => {
      const wsn = row['WSN'] || row['wsn'];
      if (!wsn) return;

      rows.push({
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

      total++;

      if (rows.length >= CHUNK_SIZE) {
        stream.pause();
        try {
          await insertBatch(rows);
          success += rows.length;
          rows = [];
          
          saveProgress(jobId, {
            status: 'processing',
            processed: total,
            total: total,
            successCount: success,
            batchId
          });

          stream.resume();
        } catch (err) {
          console.error('❌ Batch insert error:', err);
          stream.resume();
        }
      }
    });

    stream.on('end', async () => {
      if (rows.length > 0) {
        try {
          await insertBatch(rows);
          success += rows.length;
        } catch (err) {
          console.error('❌ Final batch error:', err);
        }
      }

      saveProgress(jobId, {
        status: 'completed',
        processed: total,
        total: total,
        successCount: success,
        batchId
      });

      console.log(`✅ CSV complete: ${success}/${total} rows`);
      cleanup(filePath, jobId);
    });

    stream.on('error', (err) => {
      console.error('❌ Stream error:', err);
      saveProgress(jobId, { status: 'failed', error: err.message, batchId });
      cleanup(filePath, jobId);
    });

  } catch (error: any) {
    console.error('❌ CSV processing error:', error);
    saveProgress(jobId, { status: 'failed', error: error.message, batchId });
    cleanup(filePath, jobId);
  }
}

/**
 * ✅ Excel Stream Processing
 */
async function processExcelStream(filePath: string, batchId: string, jobId: string) {
  const CHUNK_SIZE = 500;
  let rows: any[] = [];
  let total = 0;
  let success = 0;
  let csvPath = '';

  try {
    saveProgress(jobId, {
      status: 'processing',
      processed: 0,
      total: 0,
      successCount: 0,
      batchId
    });

     // Convert Excel to CSV
      const workbook = XLSX.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const csvData = XLSX.utils.sheet_to_csv(sheet); // 🔹 yahan variable ka naam 'csvData' rakho
      csvPath = filePath.replace(/\.\w+$/, '.csv');
      fs.writeFileSync(csvPath, csvData);

      // Stream CSV
      const stream = createReadStream(csvPath).pipe(csv()); // 🔹 yahan 'csv()' wahi import wala function hai


     stream.on('data', async (row: any) => {
      const wsn = row['WSN'] || row['wsn'];
      if (!wsn) return;

      rows.push({
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

      total++;

      if (rows.length >= CHUNK_SIZE) {
        stream.pause();
        try {
          await insertBatch(rows);
          success += rows.length;
          rows = [];

          saveProgress(jobId, {
            status: 'processing',
            processed: total,
            total: total,
            successCount: success,
            batchId
          });

          stream.resume();
        } catch (err) {
          console.error('❌ Batch error:', err);
          stream.resume();
        }
      }
    });

    stream.on('end', async () => {
      if (rows.length > 0) {
        try {
          await insertBatch(rows);
          success += rows.length;
        } catch (err) {
          console.error('❌ Final error:', err);
        }
      }

      saveProgress(jobId, {
        status: 'completed',
        processed: total,
        total: total,
        successCount: success,
        batchId
      });

      console.log(`✅ Excel complete: ${success}/${total} rows`);
      cleanup(filePath, jobId, csvPath);
    });

    stream.on('error', (err: { message: any; }) => {
      console.error('❌ Stream error:', err);
      saveProgress(jobId, { status: 'failed', error: err.message, batchId });
      cleanup(filePath, jobId, csvPath);
    });

  } catch (error: any) {
    console.error('❌ Excel error:', error);
    saveProgress(jobId, { status: 'failed', error: error.message, batchId });
    cleanup(filePath, jobId, csvPath);
  }
}

/**
 * ✅ Batch Insert
 */
async function insertBatch(rows: any[]): Promise<void> {
  if (rows.length === 0) return;

  const values: string[] = [];
  const params: any[] = [];
  let idx = 1;

  for (const row of rows) {
    const vals = [
      row.wsn, row.wid, row.fsn, row.order_id, row.fkqc_remark, row.fk_grade,
      row.product_title, row.hsn_sac, row.igst_rate, row.fsp, row.mrp,
      row.invoice_date, row.fkt_link, row.wh_location, row.brand, row.cms_vertical,
      row.vrp, row.yield_value, row.p_type, row.p_size, row.batchId
    ];
    
    values.push(`(${vals.map(() => `$${idx++}`).join(',')})`);
    params.push(...vals);
  }

  const sql = `
    INSERT INTO master_data (
      wsn, wid, fsn, order_id, fkqc_remark, fk_grade, product_title, hsn_sac,
      igst_rate, fsp, mrp, invoice_date, fkt_link, wh_location, brand, cms_vertical,
      vrp, yield_value, p_type, p_size, batch_id
    ) VALUES ${values.join(',')}
    ON CONFLICT (wsn) DO NOTHING
  `;

  await query(sql, params);
}

function cleanup(filePath: string, jobId: string, csvPath?: string) {
  try { fs.unlinkSync(filePath); } catch (e) { }
  if (csvPath) try { fs.unlinkSync(csvPath); } catch (e) { }
  setTimeout(() => deleteProgress(jobId), 3600000);
}

export const getUploadProgress = async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const progress = getProgress(jobId);
  res.json(progress || { status: 'not_found' });
};

export const cancelUpload = async (req: Request, res: Response) => {
  const { jobId } = req.params;
  deleteProgress(jobId);
  res.json({ message: 'Cancelled' });
};

export const getActiveUploads = async (req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(PROGRESS_DIR);
    const jobs = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const jobId = f.replace('.json', '');
        const prog = getProgress(jobId);
        return { jobId, ...prog };
      })
      .filter(j => j.status === 'processing');
    
    res.json(jobs);
  } catch (error) {
    res.json([]);
  }
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
    await query('DELETE FROM master_data WHERE batch_id = $1', [batchId]);
    res.json({ message: 'Deleted' });
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

export const exportMasterData = async (req: Request, res: Response) => {
  try {
    const { batchIds, dateFrom, dateTo } = req.query;
    
    let where: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (batchIds && typeof batchIds === 'string') {
      const batches = batchIds.split(',');
      where.push(`batch_id IN (${batches.map(() => `$${idx++}`).join(',')})`);
      params.push(...batches);
    }

    if (dateFrom && dateTo) {
      where.push(`created_at >= $${idx++}`);
      where.push(`created_at <= $${idx++}`);
      params.push(dateFrom);
      params.push(dateTo);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT * FROM master_data ${whereClause} LIMIT 100000`;

    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rows.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
