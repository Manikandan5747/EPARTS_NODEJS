require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');


// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'product responder',
    key: 'product',
    redis: { host: redisHost, port: redisPort }
});

const ExcelJS    = require('exceljs');
const AdmZip     = require('adm-zip');
const fs         = require('fs');
const fse        = require('fs-extra');
const path       = require('path');
const { randomUUID } = require('crypto');

const uploadDir = path.join('/app/assets', 'products');
fse.ensureDirSync(uploadDir);

const ALLOWED_IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
// ─────────────────────────────────────────────────────────────
// HELPER: Generate next sequential product code
//         e.g. PRD00001, PRD00002, …
// ─────────────────────────────────────────────────────────────
async function generateNextProductCode(pool) {
    const prefixRes = await pool.query(
        `SELECT prefix_code FROM public.prefix_refno
         WHERE table_name    = 'products'
           AND category_type = 'PRODUCTS'
           AND is_active     = TRUE
           AND is_deleted    = FALSE
         ORDER BY created_at DESC LIMIT 1`
    );
    const prefix = prefixRes.rows[0]?.prefix_code || 'PRD';

    const result = await pool.query(
        `SELECT code FROM public.products
         WHERE code IS NOT NULL
           AND code LIKE $1
         ORDER BY (regexp_replace(code, '\\D', '', 'g'))::int DESC
         LIMIT 1`,
        [`${prefix}%`]
    );

    const lastCode = result.rows[0]?.code || null;
    if (!lastCode) return `${prefix}00001`;

    const match  = lastCode.match(/\d+$/);
    const number = match ? parseInt(match[0], 10) : 0;
    return `${prefix}${(number + 1).toString().padStart(5, '0')}`;
}
/**
 * Allocates `count` product codes atomically using a PostgreSQL sequence.
 * Returns an array like ['PRD00006', 'PRD00007', 'PRD00008', ...]
 */
async function allocateProductCodes(pool, count) {
    if (count === 0) return [];

    // Fetch the prefix from your config table (same as before)
    const prefixRes = await pool.query(
        `SELECT prefix_code FROM public.prefix_refno
         WHERE table_name    = 'products'
           AND category_type = 'PRODUCTS'
           AND is_active     = TRUE
           AND is_deleted    = FALSE
         ORDER BY created_at DESC LIMIT 1`
    );
    const prefix = (prefixRes.rows[0]?.prefix_code || 'PRD').toUpperCase();

    // Derive the sequence name from the prefix (e.g. PRD → prd_code_seq)
    const seqName = `${prefix.toLowerCase()}_code_seq`;

    // Allocate all N values in a single atomic round-trip
    const { rows } = await pool.query(
        `SELECT nextval($1)::int AS n
         FROM generate_series(1, $2)`,
        [seqName, count]
    );

    return rows.map(r => `${prefix}${String(r.n).padStart(5, '0')}`);
}
// ─────────────────────────────────────────────────────────────
// HELPER: Generic name → id lookup map builder
// ─────────────────────────────────────────────────────────────
async function buildLookupMap(pool, table, nameCol, idCol) {
    const { rows } = await pool.query(
        `SELECT LOWER(TRIM(${nameCol}::text)) AS nm, ${idCol} AS id FROM ${table}`
    );
    const map = new Map();
    for (const r of rows) map.set(r.nm, r.id);
    return map;
}



// ─────────────────────────────────────────────────────────────
// HELPER: Copy image from temp folder → /app/assets/products/
// ─────────────────────────────────────────────────────────────
async function uploadImageToStorage(filePath, originalName, productCode) {
    const ext = path.extname(originalName).toLowerCase();
    if (!ALLOWED_IMG_EXT.has(ext)) {
        throw new Error(`Invalid image format: ${originalName}`);
    }
    await fse.ensureDir(uploadDir);
    const destName = `${productCode}_${randomUUID()}${ext}`;
    const destPath = path.join(uploadDir, destName);
    await fse.copy(filePath, destPath);
    return `/assets/products/${destName}`;
}

// ─────────────────────────────────────────────────────────────
// HELPER: Job management
// ─────────────────────────────────────────────────────────────
async function createJob(pool, jobId, uploadedBy) {
    await pool.query(
        `INSERT INTO bulk_upload_jobs (job_uuid, status, created_by, created_at, updated_at)
         VALUES ($1, 'PROCESSING', $2, NOW(), NOW())`,
        [jobId, uploadedBy]
    );
}

async function updateJob(pool, jobId, fields) {
    const sets   = Object.keys(fields).map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = Object.values(fields);
    await pool.query(
        `UPDATE bulk_upload_jobs SET ${sets}, updated_at = NOW() WHERE job_uuid = $1`,
        [jobId, ...values]
    );
}

// ─────────────────────────────────────────────────────────────
// HELPER: Map error messages → structured error objects
// ─────────────────────────────────────────────────────────────
function mapErrorDetail(errorMessages) {
    return errorMessages.map(msg => {
        if (msg.startsWith('Duplicate')) {
            return { header_type: 'ERROR', message_visibility: true, status: false, code: 2002, message: 'Duplicate entry detected', error: msg };
        }
        if (msg.includes('not found')) {
            return { header_type: 'ERROR', message_visibility: true, status: false, code: 2003, message: 'Record not found', error: msg };
        }
        return { header_type: 'ERROR', message_visibility: true, status: false, code: 2001, message: 'Validation failed', error: msg };
    });
}

// ─────────────────────────────────────────────────────────────
// CORE: Main bulk upload processing
// ─────────────────────────────────────────────────────────────
async function processBulkUpload({ pool, jobId, excelPath, zipPath, uploadedBy, sellerUuid }) {
    const tempExtractDir = path.join('/tmp', `zip_${jobId}`);
    const errors         = [];
    let   successCount   = 0;
    let   totalDataRows  = 0;

    try {
        // ── STEP 0: Validate file paths ───────────────────────
        if (!fs.existsSync(excelPath)) throw new Error(`Excel file not found: ${excelPath}`);
        if (!fs.existsSync(zipPath))   throw new Error(`ZIP file not found: ${zipPath}`);

         // ── STEP 0.5: Resolve seller_id (integer) from seller_uuid ──
        const sellerRes = await pool.query(
            `SELECT seller_id FROM public.seller_accounts
             WHERE seller_uuid = $1
               AND is_deleted  = FALSE
               AND is_active   = TRUE
             LIMIT 1`,
            [sellerUuid]
        );
        if (!sellerRes.rows.length) {
            throw new Error(`Seller not found, inactive, or deleted for seller_uuid: ${sellerUuid}`);
        }
        const sellerId = sellerRes.rows[0].seller_id;

        // ── STEP 1: Extract ZIP ───────────────────────────────
        await fse.ensureDir(tempExtractDir);
        const zip = new AdmZip(zipPath);
        for (const entry of zip.getEntries()) {
            const resolved = path.resolve(tempExtractDir, entry.entryName);
            if (!resolved.startsWith(path.resolve(tempExtractDir))) {
                throw new Error(`ZIP path traversal detected: ${entry.entryName}`);
            }
        }
        zip.extractAllTo(tempExtractDir, true);

        const zipFileMap = new Map();
        const walkDir = (dir) => {
            for (const f of fs.readdirSync(dir)) {
                const full = path.join(dir, f);
                if (fs.statSync(full).isDirectory()) walkDir(full);
                else zipFileMap.set(f.toLowerCase(), full);
            }
        };
        walkDir(tempExtractDir);

        // ── STEP 2: Pre-fetch ALL master lookup maps in parallel ──
        const [
            productTypeMap,   // product_type_name  → product_type_id
            tradingTypeMap,   // trading_type_name   → trading_type_id
            uomMap,           // uom_name            → uom_id
            manufacturerMap,  // manufacturer_name   → manufacturer_id
            brandMap,         // brand_name          → brand_id
            modelMap,         // model_name          → model_id
            conditionMap,     // condition_name      → condition_id
            currencyMap,      // currency_code       → currency_id
            warehouseMap,     // warehouse_name      → warehouse_id
        ] = await Promise.all([
            buildLookupMap(pool, 'product_types',        'name',           'product_type_id'),
            buildLookupMap(pool, 'trading_types',        'name',           'trading_type_id'),
            buildLookupMap(pool, 'uom',                  'name',           'uom_id'),
            buildLookupMap(pool, 'manufacturer',         'name',           'manufacturer_id'),
            buildLookupMap(pool, 'brand',                'name',           'brand_id'),
            buildLookupMap(pool, 'model',                'name',           'model_id'),
            buildLookupMap(pool, 'product_conditions',   'name',           'condition_id'),
            buildLookupMap(pool, 'currency',             'code',           'currency_id'),
            buildLookupMap(pool, 'seller_warehouse',     'warehouse_name', 'warehouse_id'),
        ]);

        // ── STEP 2.5: Fetch static IDs needed for every row ──
        const listingStatusRes = await pool.query(
            `SELECT product_listing_status_id FROM product_listing_status
             WHERE LOWER(name) = 'inactive' AND is_active = true LIMIT 1`
        );
        if (!listingStatusRes.rows.length) {
            throw new Error("product_listing_status record 'INACTIVE' not found in DB.");
        }
        const inactiveListingStatusId = listingStatusRes.rows[0].product_listing_status_id;

        // ── STEP 2.6: Build oem_part_number → { part_id, group_id, sub_group_id, sub_node_id } map ──
        // part_id from parts is mapped against group_parts, sub_group_parts, sub_node_parts
        // to resolve group_id, sub_group_id and sub_node_id respectively.
        // LATERAL joins guarantee exactly one row per part even if the mapping tables
        // have multiple entries for the same part_id.
        const partLookupRes = await pool.query(`
            SELECT
                p.part_id,
                p.part_number,
                gp.group_id,
                sgp.sub_group_id,
                snp.sub_node_id
            FROM parts p
            LEFT JOIN LATERAL (
                SELECT group_id
                FROM   group_parts
                WHERE  part_id    = p.part_id
                  AND  is_deleted = false
                  AND  is_active  = true
                LIMIT 1
            ) gp  ON true
            LEFT JOIN LATERAL (
                SELECT sub_group_id
                FROM   sub_group_parts
                WHERE  part_id    = p.part_id
                  AND  is_deleted = false
                  AND  is_active  = true
                LIMIT 1
            ) sgp ON true
            LEFT JOIN LATERAL (
                SELECT sub_node_id
                FROM   sub_node_parts
                WHERE  part_id    = p.part_id
                  AND  is_deleted = false
                  AND  is_active  = true
                LIMIT 1
            ) snp ON true
            WHERE p.is_active  = true
              AND p.is_deleted = false
        `);

        const partByOemNumber = new Map();
        for (const r of partLookupRes.rows) {
            if (r.part_number) {
                partByOemNumber.set(r.part_number.toLowerCase().trim(), {
                    part_id:      r.part_id,
                    group_id:     r.group_id     ?? null,
                    sub_group_id: r.sub_group_id ?? null,
                    sub_node_id:  r.sub_node_id  ?? null,
                });
            }
        }

        // ── STEP 3: Read Excel ────────────────────────────────
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(excelPath);
        const sheet = workbook.worksheets[0];

        // ── Expected header columns (must match Excel template) ──
        const EXPECTED_HEADERS = [
            'product_name', 'sku', 'product_type_name', 'oem_part_number',
            'brand_name', 'model_name', 'manufacturer_name', 'currency_code',
            'price', 'price_after_sale', 'images', 'uom_name', 'condition_name',
            'trading_type_name', 'aftermarket_number', 'barcode_number', 'weight',
            'dimension_length', 'dimension_width', 'dimension_height', 'material_type',
            'used_years', 'item_description', 'equivalent_oem_part_numbers',
            'warehouse_name', 'onhand_qty', 'reorder_level', 'buffer_qty', 'bin_loc'
        ];

        // ── Build header map + count occurrences (to catch duplicates) ──
        const headerMap    = {};
        const headerCounts = {};
        sheet.getRow(1).eachCell((cell, colNum) => {
            if (!cell.value) return;
            const h = String(cell.value).trim().toLowerCase();
            headerCounts[h] = (headerCounts[h] || 0) + 1;
            headerMap[h]    = colNum;
        });

        const duplicateHeaders = Object.keys(headerCounts).filter(h => headerCounts[h] > 1);
        const missingHeaders   = EXPECTED_HEADERS.filter(h => !(h in headerCounts));

        if (duplicateHeaders.length > 0 || missingHeaders.length > 0) {
            const headerErrors = [];
            if (missingHeaders.length > 0) {
                headerErrors.push({
                    header_type: 'ERROR', message_visibility: true, status: false, code: 2001,
                    message: 'Validation failed',
                    error: `Missing header column(s) in row 1: ${missingHeaders.join(', ')}`
                });
            }
            if (duplicateHeaders.length > 0) {
                headerErrors.push({
                    header_type: 'ERROR', message_visibility: true, status: false, code: 2001,
                    message: 'Validation failed',
                    error: `Duplicate header column(s) in row 1: ${duplicateHeaders.join(', ')}`
                });
            }
            await updateJob(pool, jobId, {
                status:     'FAILED',
                total_rows: 0,
                success:    0,
                failed:     headerErrors.length,
                errors:     JSON.stringify(headerErrors)
            });
            return;
        }

        const getCell = (row, colName) => {
            const idx = headerMap[colName];
            if (!idx) return null;
            const v = row.getCell(idx).value;
            return v === null || v === undefined ? null : String(v).trim();
        };

        // const headerMap = {};
        // sheet.getRow(1).eachCell((cell, colNum) => {
        //     if (cell.value) headerMap[String(cell.value).trim().toLowerCase()] = colNum;
        // });
        // const getCell = (row, colName) => {
        //     const idx = headerMap[colName];
        //     if (!idx) return null;
        //     const v = row.getCell(idx).value;
        //     return v === null || v === undefined ? null : String(v).trim();
        // };

        // Count non-empty data rows first
        totalDataRows = 0;
        for (let i = 2; i <= sheet.rowCount; i++) {
            const row     = sheet.getRow(i);
            const allVals = row.values.slice(1);
            if (!allVals.every(v => v === null || v === undefined || v === '')) totalDataRows++;
        }

        // ── ROW LIMIT CHECK ───────────────────────────────────
        if (totalDataRows > 1000) {
            await updateJob(pool, jobId, {
                status:     'FAILED',
                total_rows: totalDataRows,
                success:    0,
                failed:     0,
                errors:     JSON.stringify([{
                    header_type:        'ERROR',
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            'Validation failed',
                    error:              `Row limit exceeded: file contains ${totalDataRows} rows. Maximum allowed is 1000.`
                }])
            });
            return;
        }

        // ── STEP 4: Validate each row and group inventory rows by SKU ──
        // Excel has repeated SKU rows for multiple warehouses.
        // We de-duplicate products by SKU and collect inventory entries per warehouse.

        const skuProductMap   = new Map(); // sku → candidate product object
        const skuInventoryMap = new Map(); // sku → [ { warehouse_id, onhand_qty, reorder_level, buffer_qty, bin_loc } ]
        const skuRowIndex     = new Map(); // sku → first row index (for error reporting)

        for (let i = 2; i <= sheet.rowCount; i++) {
            const row     = sheet.getRow(i);
            const allVals = row.values.slice(1);
            if (allVals.every(v => v === null || v === undefined || v === '')) continue;

            const rowErrors = [];

            // ── Read all columns ──────────────────────────────
            const rawName            = getCell(row, 'product_name');
            const rawSku             = getCell(row, 'sku');
            const rawProductType     = getCell(row, 'product_type_name');
            const rawOemPartNumber   = getCell(row, 'oem_part_number');
            const rawBrand           = getCell(row, 'brand_name');
            const rawModel           = getCell(row, 'model_name');
            const rawManufacturer    = getCell(row, 'manufacturer_name');
            const rawCurrency        = getCell(row, 'currency_code');
            const rawPrice           = getCell(row, 'price');
            const rawPriceAfterSale  = getCell(row, 'price_after_sale');
            const rawImages          = getCell(row, 'images');
            const rawUom             = getCell(row, 'uom_name');
            const rawCondition       = getCell(row, 'condition_name');
            const rawTradingType     = getCell(row, 'trading_type_name');
            const rawAftermarket     = getCell(row, 'aftermarket_number');
            const rawBarcode         = getCell(row, 'barcode_number');
            const rawWeight          = getCell(row, 'weight');
            const rawLength          = getCell(row, 'dimension_length');
            const rawWidth           = getCell(row, 'dimension_width');
            const rawHeight          = getCell(row, 'dimension_height');
            const rawMaterial        = getCell(row, 'material_type');
            const rawUsedYears       = getCell(row, 'used_years');
            const rawDescription     = getCell(row, 'item_description');
            const rawEquivOem        = getCell(row, 'equivalent_oem_part_numbers');
            const rawWarehouse       = getCell(row, 'warehouse_name');
            const rawOnhand          = getCell(row, 'onhand_qty');
            const rawReorder         = getCell(row, 'reorder_level');
            const rawBuffer          = getCell(row, 'buffer_qty');
            const rawBinLoc          = getCell(row, 'bin_loc');

            // ── Mandatory fields ──────────────────────────────

// ── Mandatory fields ──────────────────────────────
            if (!rawName?.trim())           rowErrors.push('product name is required'); // ⚠️ confirm below
            if (!rawSku?.trim())             rowErrors.push('sku is required');
            if (!rawOemPartNumber?.trim())   rowErrors.push('oem part number is required');
            if (!rawProductType?.trim())     rowErrors.push('product type name is required');
            if (!rawManufacturer?.trim())    rowErrors.push('manufacturer name is required');
            if (!rawBrand?.trim())           rowErrors.push('brand name is required');
            if (!rawModel?.trim())           rowErrors.push('model name is required');
            if (!rawCurrency?.trim())        rowErrors.push('currency code is required');
            if (!rawPrice?.trim())           rowErrors.push('price is required');
            if (!rawPriceAfterSale?.trim())  rowErrors.push('price after sale is required');

            // ── Conditional mandatory fields for Aftermarket product type ──
            const isAftermarketType = rawProductType?.trim().toLowerCase() === 'aftermarket';
            if (isAftermarketType) {
                if (!rawCondition?.trim())   rowErrors.push('condition name is required when product type name is Aftermarket');
                if (!rawAftermarket?.trim()) rowErrors.push('aftermarket number is required when product type name is Aftermarket');
                if (!rawUsedYears?.trim())   rowErrors.push('used years is required when product type name is Aftermarket');
            }

            // Warehouse fields are mandatory — every row must have a warehouse entry
            if (!rawWarehouse?.trim())       rowErrors.push('warehouse name is required');
            if (!rawOnhand?.trim())          rowErrors.push('onhand qty is required');

            // ── Numeric validations ───────────────────────────
            const price          = parseFloat(rawPrice);
            const priceAfterSale = parseFloat(rawPriceAfterSale);
            if (rawPrice          && isNaN(price))                  rowErrors.push('price must be a valid number');
            if (rawPriceAfterSale && isNaN(priceAfterSale))         rowErrors.push('price_after_sale must be a valid number');
            if (rawWeight         && isNaN(parseFloat(rawWeight)))  rowErrors.push('weight must be a valid number');
            if (rawLength         && isNaN(parseFloat(rawLength)))  rowErrors.push('dimension_length must be a valid number');
            if (rawWidth          && isNaN(parseFloat(rawWidth)))   rowErrors.push('dimension_width must be a valid number');
            if (rawHeight         && isNaN(parseFloat(rawHeight)))  rowErrors.push('dimension_height must be a valid number');
            if (rawUsedYears      && isNaN(parseInt(rawUsedYears))) rowErrors.push('used_years must be a valid integer');
            if (rawOnhand         && isNaN(parseFloat(rawOnhand)))  rowErrors.push('onhand_qty must be a valid number');
            if (rawReorder        && isNaN(parseFloat(rawReorder))) rowErrors.push('reorder_level must be a valid number');
            if (rawBuffer         && isNaN(parseFloat(rawBuffer)))  rowErrors.push('buffer_qty must be a valid number');

            // ── Master data lookups ───────────────────────────
            let productTypeId = null;
            if (rawProductType) {
                productTypeId = productTypeMap.get(rawProductType.toLowerCase());
                if (!productTypeId) rowErrors.push(`product_type_name "${rawProductType}" not found`);
            }

            let brandId = null;
            if (rawBrand) {
                brandId = brandMap.get(rawBrand.toLowerCase());
                if (!brandId) rowErrors.push(`brand_name "${rawBrand}" not found`);
            }

            let modelId = null;
            if (rawModel) {
                modelId = modelMap.get(rawModel.toLowerCase());
                if (!modelId) rowErrors.push(`model_name "${rawModel}" not found`);
            }

            let currencyId = null;
            if (rawCurrency) {
                currencyId = currencyMap.get(rawCurrency.toLowerCase());
                if (!currencyId) rowErrors.push(`currency_code "${rawCurrency}" not found`);
            }

            let manufacturerId = null;
            if (rawManufacturer) {
                manufacturerId = manufacturerMap.get(rawManufacturer.toLowerCase());
                if (!manufacturerId) rowErrors.push(`manufacturer_name "${rawManufacturer}" not found`);
            }

            let uomId = null;
            if (rawUom) {
                uomId = uomMap.get(rawUom.toLowerCase());
                if (!uomId) rowErrors.push(`uom_name "${rawUom}" not found`);
            }

            let conditionId = null;
            if (rawCondition) {
                conditionId = conditionMap.get(rawCondition.toLowerCase());
                if (!conditionId) rowErrors.push(`condition_name "${rawCondition}" not found`);
            }

            // Trading types: comma-separated, optional
            const tradingTypeIds = [];
            if (rawTradingType) {
                for (const tt of rawTradingType.split(',').map(s => s.trim()).filter(Boolean)) {
                    const ttId = tradingTypeMap.get(tt.toLowerCase());
                    if (!ttId) rowErrors.push(`trading_type_name "${tt}" not found`);
                    else tradingTypeIds.push(ttId);
                }
            }

            // ── OEM Part Number → part_id, group_id, sub_group_id, sub_node_id ──
            // Resolved via LATERAL joins against group_parts, sub_group_parts, sub_node_parts.
            // Non-blocking if not found — all ids remain null.
            let partId     = null;
            let groupId    = null;
            let subGroupId = null;
            let subNodeId  = null;
            if (rawOemPartNumber) {
                const partMatch = partByOemNumber.get(rawOemPartNumber.toLowerCase().trim());
                if (partMatch) {
                    partId     = partMatch.part_id;
                    groupId    = partMatch.group_id;
                    subGroupId = partMatch.sub_group_id;
                    subNodeId  = partMatch.sub_node_id;
                }
            }

            // ── Warehouse lookup ──────────────────────────────
            let warehouseId = null;
            if (rawWarehouse) {
                warehouseId = warehouseMap.get(rawWarehouse.toLowerCase());
                if (!warehouseId) rowErrors.push(`warehouse_name "${rawWarehouse}" not found`);
            }

            // ── Images: only validate on the FIRST occurrence of this SKU ──
            const imageFileNames = [];
            const sku            = rawSku?.trim();
            const isNewSku       = sku && !skuProductMap.has(sku.toLowerCase());

            if (isNewSku && rawImages) {
                for (const fname of rawImages.split(',').map(f => f.trim()).filter(Boolean)) {
                    if (!zipFileMap.has(fname.toLowerCase()))
                        rowErrors.push(`Image "${fname}" not found in ZIP`);
                    else
                        imageFileNames.push(fname);
                }
                if (imageFileNames.length === 0 && rawImages)
                    rowErrors.push('No valid images found in ZIP for this product');
                if (!rawImages)
                    rowErrors.push('images is required (at least one image filename)');
            }

            if (rowErrors.length > 0) {
                errors.push({
                    row:     i,
                    name:    rawName ?? `Row ${i}`,
                    sku:     sku     ?? null,
                    details: mapErrorDetail(rowErrors)
                });
                continue;
            }

            const skuKey = sku.toLowerCase();

            // ── First time seeing this SKU → build product candidate ──
            if (!skuProductMap.has(skuKey)) {
                skuRowIndex.set(skuKey, i);

                // equivalent_oem_part_numbers: comma-separated string → array
                let equivOemArray = [];
                if (rawEquivOem) {
                    equivOemArray = rawEquivOem.split(',').map(s => s.trim()).filter(Boolean);
                }

                skuProductMap.set(skuKey, {
                    rowIdx:            i,
                    name:              rawName.trim(),
                    sku,
                    productTypeId,
                    oemPartNumber:     rawOemPartNumber.trim(),
                    aftermarketNumber: rawAftermarket  || null,
                    equivOemParts:     equivOemArray,
                    tradingTypeIds,
                    brandId,
                    modelId,
                    manufacturerId,
                    manufacturerName:  rawManufacturer || null,
                    currencyId,
                    price,
                    priceAfterSale,
                    uomId,
                    conditionId,
                    barcodeNumber:     rawBarcode      || null,
                    weight:            rawWeight       ? parseFloat(rawWeight)  : null,
                    dimensionLength:   rawLength       ? parseFloat(rawLength)  : null,
                    dimensionWidth:    rawWidth        ? parseFloat(rawWidth)   : null,
                    dimensionHeight:   rawHeight       ? parseFloat(rawHeight)  : null,
                    materialType:      rawMaterial     || null,
                    usedYears:         rawUsedYears    ? parseInt(rawUsedYears) : null,
                    itemDescription:   rawDescription  || null,
                    imageFileNames,
                    partId,
                    groupId,
                    subGroupId,
                    subNodeId,
                });
                skuInventoryMap.set(skuKey, []);
            }

            // ── Append warehouse inventory entry for every row ──
            // Each Excel row represents one warehouse entry for this SKU.
            if (warehouseId) {
                skuInventoryMap.get(skuKey).push({
                    warehouseId,
                    onhandQty:    rawOnhand  ? parseFloat(rawOnhand)  : 0,
                    reorderLevel: rawReorder ? parseFloat(rawReorder) : null,
                    bufferQty:    rawBuffer  ? parseFloat(rawBuffer)  : 0,
                    binLoc:       rawBinLoc  || null
                });
            }
        }

        const candidateSkus = [...skuProductMap.keys()];

        // ── STEP 5: Batch duplicate SKU check ─────────────────
        if (candidateSkus.length > 0) {
            const placeholders = candidateSkus.map((_, i) => `$${i + 1}`).join(', ');
            const dupResult    = await pool.query(
                `SELECT LOWER(sku) AS sku FROM public.products
                 WHERE LOWER(sku) IN (${placeholders})
                   AND is_deleted = FALSE`,
                candidateSkus
            );
            const existingSkus = new Set(dupResult.rows.map(r => r.sku));

            for (const skuKey of candidateSkus) {
                if (existingSkus.has(skuKey)) {
                    const candidate = skuProductMap.get(skuKey);
                    errors.push({
                        row:     candidate.rowIdx,
                        name:    candidate.name,
                        sku:     candidate.sku,
                        details: mapErrorDetail([
                            `Duplicate: SKU "${candidate.sku}" already exists in the database`
                        ])
                    });
                    skuProductMap.delete(skuKey);
                    skuInventoryMap.delete(skuKey);
                }
            }
        }

        console.log(`[bulk-upload] Unique SKUs after validation : ${skuProductMap.size}`);
        console.log(`[bulk-upload] Total errors so far          : ${errors.length}`);

        if (errors.length > 0) {
            console.log(`[bulk-upload] Validation failed — no rows inserted.`);
            await updateJob(pool, jobId, {
                status:     'FAILED',
                total_rows: totalDataRows,
                success:    0,
                failed:     errors.length,
                errors:     JSON.stringify(errors)
            });
            return;
        }

        // ── STEP 6: Generate product codes and upload images ──
        // Product codes are generated sequentially BEFORE image upload
        // so the filename can use product_code instead of SKU.
        // const validProducts = [];

        // for (const [skuKey, candidate] of skuProductMap) {
        //     const productCode = await generateNextProductCode(pool);

        //     const imageUrls = [];
        //     for (const fname of candidate.imageFileNames) {
        //         const localPath = zipFileMap.get(fname.toLowerCase());
        //         try {
        //             const url = await uploadImageToStorage(localPath, fname, productCode);
        //             imageUrls.push(url);
        //         } catch (imgErr) {
        //             throw new Error(`Image upload failed for "${fname}": ${imgErr.message}`);
        //         }
        //     }

        //     validProducts.push({
        //         ...candidate,
        //         productCode,
        //         images:    imageUrls,
        //         inventory: skuInventoryMap.get(skuKey) || []
        //     });
        // }

// ── STEP 6: Allocate ALL product codes in one shot, then upload images ──
const skuEntries   = [...skuProductMap.entries()]; // stable order
const productCodes = await allocateProductCodes(pool, skuEntries.length);

const validProducts = [];

for (let i = 0; i < skuEntries.length; i++) {
    const [skuKey, candidate] = skuEntries[i];
    const productCode = productCodes[i]; // already guaranteed unique

    const imageUrls = [];
    for (const fname of candidate.imageFileNames) {
        const localPath = zipFileMap.get(fname.toLowerCase());
        try {
            const url = await uploadImageToStorage(localPath, fname, productCode);
            imageUrls.push(url);
        } catch (imgErr) {
            throw new Error(`Image upload failed for "${fname}": ${imgErr.message}`);
        }
    }

    validProducts.push({
        ...candidate,
        productCode,
        images:    imageUrls,
        inventory: skuInventoryMap.get(skuKey) || []
    });
}

        // ── STEP 7: Single transaction — insert all products ──
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            for (const p of validProducts) {
                const equivOemJson    = JSON.stringify(p.equivOemParts);
                const tradingTypeJson = JSON.stringify(p.tradingTypeIds);

             // 1. Insert product (images live in product_images, not here)
                const productInsert = await client.query({
                    text: `
                        INSERT INTO public.products (
                            code,
                            name,
                            sku,
                            seller_id,
                            product_type_id,
                            oem_part_number,
                            aftermarket_number,
                            equivalent_oem_part_numbers,
                            trading_type_id,
                            brand_id,
                            model_id,
                            group_id,
                            sub_group_id,
                            sub_node_id,
                            manufacturer_id,
                            manufacturer_name,
                            currency_id,
                            price,
                            price_after_sale,
                            uom_id,
                            condition_id,
                            barcode_number,
                            weight,
                            dimension_length,
                            dimension_width,
                            dimension_height,
                            material_type,
                            used_years,
                            item_description,
                            verify_status,
                            product_listing_status_id,
                            upload_method,
                            is_listed,
                            assigned_to,
                            assigned_at,
                            created_by
                        ) VALUES (
                            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                            $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                            $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
                            $31,$32,$33,$34,$35,$36
                        )
                        RETURNING product_id
                    `,
                    values: [
                        p.productCode,           // $1  code
                        p.name,                  // $2  name
                        p.sku,                   // $3  sku
                        sellerId,                // $4  seller_id
                        p.productTypeId,         // $5  product_type_id
                        p.oemPartNumber,         // $6  oem_part_number
                        p.aftermarketNumber,     // $7  aftermarket_number
                        equivOemJson,            // $8  equivalent_oem_part_numbers (JSONB)
                        tradingTypeJson,         // $9  trading_type_id (JSONB)
                        p.brandId,               // $10 brand_id
                        p.modelId,               // $11 model_id
                        p.groupId,               // $12 group_id     ← from group_parts
                        p.subGroupId,            // $13 sub_group_id ← from sub_group_parts
                        p.subNodeId,             // $14 sub_node_id  ← from sub_node_parts
                        p.manufacturerId,        // $15 manufacturer_id
                        p.manufacturerName,      // $16 manufacturer_name
                        p.currencyId,            // $17 currency_id
                        p.price,                 // $18 price
                        p.priceAfterSale,        // $19 price_after_sale
                        p.uomId,                 // $20 uom_id
                        p.conditionId,           // $21 condition_id
                        p.barcodeNumber,         // $22 barcode_number
                        p.weight,                // $23 weight
                        p.dimensionLength,       // $24 dimension_length
                        p.dimensionWidth,        // $25 dimension_width
                        p.dimensionHeight,       // $26 dimension_height
                        p.materialType,          // $27 material_type
                        p.usedYears,             // $28 used_years
                        p.itemDescription,       // $29 item_description
                        'PENDING',               // $30 verify_status
                        inactiveListingStatusId, // $31 product_listing_status_id
                        'BULK',                  // $32 upload_method
                        false,                   // $33 is_listed
                        uploadedBy,              // $34 assigned_to
                        new Date(),              // $35 assigned_at
                        uploadedBy,              // $36 created_by
                    ]
                });
                const { product_id } = productInsert.rows[0];

                // 2. Insert into product_images (one row per image, sort_order 1-based)
                for (let idx = 0; idx < p.images.length; idx++) {
                    await client.query({
                        text: `
                            INSERT INTO public.product_images
                                (product_id, image_url, image_type, sort_order, created_by, assigned_to, assigned_at)
                            VALUES ($1,$2,$3,$4,$5,$6,$7)
                        `,
                        values: [
                            product_id,
                            p.images[idx],
                            'PRODUCT',
                            idx + 1,
                            uploadedBy,
                            uploadedBy,
                            new Date()
                        ]
                    });
                }

                // 3. Insert into oem_equivalents (upsert by oem_part_number)
                if (p.equivOemParts.length > 0) {
                    await client.query({
                        text: `
                            INSERT INTO public.oem_equivalents
                                (oem_part_number, equivalent_oem_part_numbers, created_by, assigned_to, assigned_at)
                            VALUES ($1, $2, $3, $4, $5)
                            ON CONFLICT (oem_part_number)
                            DO UPDATE SET
                                equivalent_oem_part_numbers = EXCLUDED.equivalent_oem_part_numbers,
                                modified_at                 = NOW(),
                                modified_by                 = $3
                        `,
                        values: [
                            p.oemPartNumber,
                            equivOemJson,
                            uploadedBy,
                            uploadedBy,
                            new Date()
                        ]
                    });
                }

                // 4. Insert seller_inventory rows — one row per warehouse
                for (const inv of p.inventory) {
                    const invInsert = await client.query({
                        text: `
                            INSERT INTO public.seller_inventory (
                                warehouse_id,
                                seller_id,
                                product_id,
                                onhand_qty,
                                buffer_qty,
                                reorder_level,
                                bin_loc,
                                created_by,
                                assigned_to,
                                assigned_at
                            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                            RETURNING inventory_id
                        `,
                        values: [
                            inv.warehouseId,  // $1
                            sellerId,         // $2
                            product_id,       // $3
                            inv.onhandQty,    // $4
                            inv.bufferQty,    // $5
                            inv.reorderLevel, // $6
                            inv.binLoc,       // $7
                            uploadedBy,       // $8
                            uploadedBy,       // $9
                            new Date()        // $10
                        ]
                    });

                    // 5. Record initial stock history for each warehouse entry
                    await client.query({
                        text: `
                            INSERT INTO public.product_stock_history (
                                product_id,
                                warehouse_id,
                                movement_type,
                                quantity_before,
                                quantity_changed,
                                quantity_after,
                                reason,
                                reference_type,
                                reference_id,
                                created_by,
                                assigned_to,
                                assigned_at
                            ) VALUES ($1,$2,'IN',0,$3,$3,$4,'bulk_upload',$5,$6,$6,$7)
                        `,
                        values: [
                            product_id,
                            inv.warehouseId,
                            inv.onhandQty,
                            'Bulk Upload Initial Stock',
                            invInsert.rows[0].inventory_id,
                            uploadedBy,
                            new Date()
                        ]
                    });
                }

                // 6. Insert initial price history
                await client.query({
                    text: `
                        INSERT INTO public.product_price_history (
                            product_id,
                            price,
                            price_after_sale,
                            currency_id,
                            effective_from,
                            reason,
                            created_by,
                            assigned_to,
                            assigned_at
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                    `,
                    values: [
                        product_id,
                        p.price,
                        p.priceAfterSale,
                        p.currencyId,
                        new Date(),
                        'Bulk Upload Initial Price',
                        uploadedBy,
                        uploadedBy,
                        new Date()
                    ]
                });

                successCount++;
            }

            await client.query('COMMIT');
            console.log(`[bulk-upload] Transaction committed. Inserted: ${successCount}`);

        } 
        catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }

        // ── STEP 8: Mark job complete ─────────────────────────
        const finalStatus = successCount === 0 ? 'FAILED' : 'COMPLETED';
        console.log(`[bulk-upload] Job ${jobId} → ${finalStatus}`);
        await updateJob(pool, jobId, {
            status:     finalStatus,
            total_rows: totalDataRows,
            success:    successCount,
            failed:     0,
            errors:     JSON.stringify([])
        });

    } catch (fatalErr) {
        console.error('[bulk-upload] Fatal error:', fatalErr.stack);
        await updateJob(pool, jobId, {
            status: 'FAILED',
            errors: JSON.stringify([{
                header_type:        'ERROR',
                message_visibility: true,
                status:             false,
                code:               2004,
                message:            'Database / Internal server error',
                error:              fatalErr.message
            }])
        }).catch(e => console.error('[bulk-upload] updateJob also failed:', e.message));

    } finally {
        await fse.remove(excelPath).catch(() => {});
        await fse.remove(zipPath).catch(() => {});
        await fse.remove(tempExtractDir).catch(() => {});
        console.log(`[bulk-upload] Cleanup done for job: ${jobId}`);
    }
}

// ─────────────────────────────────────────────────────────────
// RESPONDER EVENT: bulk-upload-products
// ─────────────────────────────────────────────────────────────
responder.on('bulk-upload-products', async (req, cb) => {
    try {
        const { jobId, excelPath, zipPath, uploadedBy, sellerUuid  } = req.body;

        if (!jobId || !excelPath || !zipPath || !sellerUuid) {
            return cb(null, {
                header_type:        'ERROR',
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            'Validation failed',
                error:              'Missing required fields: jobId, excelPath, zipPath, sellerUuid'
            });
        }

        await createJob(pool, jobId, uploadedBy);

        // ACK immediately — process in background
        cb(null, {
            header_type:        'SUCCESS',
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            'Bulk upload accepted. Processing in background.',
            result:             { job_uuid: jobId }
        });

        processBulkUpload({ pool, jobId, excelPath, zipPath, uploadedBy, sellerUuid })
            .catch(err => console.error('[bulk-upload-products] Unhandled error:', err.stack));

    } catch (err) {
        console.error('[bulk-upload-products] Responder error:', err.stack);
        return cb(null, {
            header_type:        'ERROR',
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message
        });
    }
});

// ─────────────────────────────────────────────────────────────
// RESPONDER EVENT: bulk-upload-status
// ─────────────────────────────────────────────────────────────
responder.on('bulk-upload-status', async (req, cb) => {
    try {
        const { jobId } = req.body;
        if (!jobId) {
            return cb(null, {
                header_type: 'ERROR', message_visibility: true, status: false,
                code: 2001, message: 'Missing required field: jobId'
            });
        }

        const { rows } = await pool.query(
            `SELECT job_uuid, status, total_rows, success, failed, errors, created_at, updated_at
             FROM bulk_upload_jobs WHERE job_uuid = $1`,
            [jobId]
        );

        if (!rows.length) {
            return cb(null, {
                header_type: 'ERROR', message_visibility: true, status: false,
                code: 2003, message: 'Job not found.'
            });
        }

        const job = rows[0];

        if (job.status === 'PROCESSING') {
            return cb(null, {
                header_type: 'INFO', message_visibility: true, status: false, code: 1001,
                message: 'Bulk upload is still processing.', result: job
            });
        }

        if (job.status === 'FAILED') {
            return cb(null, {
                header_type: 'ERROR', message_visibility: true, status: false, code: 2004,
                message: 'Bulk upload failed. Please fix the errors and re-upload.', result: job
            });
        }

        return cb(null, {
            header_type: 'SUCCESS', message_visibility: true, status: true, code: 1000,
            message: 'Bulk Upload Completed', result: job
        });

    } catch (err) {
        console.error('[bulk-upload-status] error:', err.stack);
        return cb(null, {
            header_type: 'ERROR', message_visibility: true, status: false, code: 2004,
            message: err.message, error: err.message
        });
    }
});

// --------------------------------------------------
// CREATE PRODUCT
// --------------------------------------------------

// ============================================================
// CONSTANTS
// ============================================================
const IMAGE_CONFIG = {
    allowed_types: [".jpg", ".jpeg", ".png", ".webp"],
    max_size_mb:   5,
    max_width:     4000,
    max_height:    4000,
    min_width:     300,
    min_height:    300,
};

const BYTES_PER_MB = 1024 * 1024;

// ============================================================
// HELPER — FILE SIZE
// ============================================================
async function getFileSize(filePath) {
    try {
        const fs   = require("fs").promises;
        const stat = await fs.stat(filePath);
        return stat.size;
    } catch {
        return null;
    }
}

// ============================================================
// HELPER — IMAGE DIMENSIONS
// ============================================================
async function getImageDimensions(filePath) {
    try {
        const fs     = require("fs");
        const buffer = fs.readFileSync(filePath);

        // ── JPEG ──
        if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
            let offset = 2;
            while (offset < buffer.length) {
                if (buffer[offset] !== 0xFF) break;
                const marker = buffer[offset + 1];
                const segLen = buffer.readUInt16BE(offset + 2);
                if (marker >= 0xC0 && marker <= 0xC3) {
                    return {
                        height: buffer.readUInt16BE(offset + 5),
                        width:  buffer.readUInt16BE(offset + 7),
                    };
                }
                offset += 2 + segLen;
            }
            return null;
        }

        // ── PNG ──
        if (
            buffer[0] === 0x89 && buffer[1] === 0x50 &&
            buffer[2] === 0x4E && buffer[3] === 0x47
        ) {
            return {
                width:  buffer.readUInt32BE(16),
                height: buffer.readUInt32BE(20),
            };
        }

        // ── WEBP ──
        if (
            buffer.slice(0, 4).toString("ascii") === "RIFF" &&
            buffer.slice(8, 12).toString("ascii") === "WEBP"
        ) {
            if (buffer.slice(12, 16).toString("ascii") === "VP8 ") {
                return {
                    width:  buffer.readUInt16LE(26) & 0x3FFF,
                    height: buffer.readUInt16LE(28) & 0x3FFF,
                };
            }
            if (buffer.slice(12, 16).toString("ascii") === "VP8L") {
                const b = buffer[21] | (buffer[22] << 8) | (buffer[23] << 16) | (buffer[24] << 24);
                return {
                    width:  (b & 0x3FFF) + 1,
                    height: ((b >> 14) & 0x3FFF) + 1,
                };
            }
        }

        return null;

    } catch (err) {
        console.error("getImageDimensions error:", err.message);
        return null;
    }
}

// ============================================================
// HELPER — VALIDATE IMAGES
// ============================================================
async function validateImages(images) {
    const path   = require("path");
    const errors = [];

    for (let i = 0; i < images.length; i++) {
        const filePath = images[i];
        const label    = i === 0 ? "primary image" : `images[${i}]`;
        const ext      = path.extname(filePath).toLowerCase();

        // 1. File type
        if (!IMAGE_CONFIG.allowed_types.includes(ext)) {
            errors.push(`${label}: invalid file type "${ext}". Allowed: ${IMAGE_CONFIG.allowed_types.join(", ")}`);
            continue;
        }

        // 2. File size
        const sizeBytes = await getFileSize(filePath);
        if (sizeBytes === null) {
            errors.push(`${label}: file not found or unreadable`);
            continue;
        }
        if (sizeBytes > IMAGE_CONFIG.max_size_mb * BYTES_PER_MB) {
            errors.push(`${label}: size ${(sizeBytes / BYTES_PER_MB).toFixed(2)}MB exceeds limit of ${IMAGE_CONFIG.max_size_mb}MB`);
        }

        // 3. Dimensions
        const dims = await getImageDimensions(filePath);
        if (!dims) {
            errors.push(`${label}: unable to read image dimensions`);
            continue;
        }
        if (dims.width < IMAGE_CONFIG.min_width || dims.height < IMAGE_CONFIG.min_height) {
            errors.push(`${label}: too small (${dims.width}x${dims.height}px). Minimum: ${IMAGE_CONFIG.min_width}x${IMAGE_CONFIG.min_height}px`);
        }
        if (dims.width > IMAGE_CONFIG.max_width || dims.height > IMAGE_CONFIG.max_height) {
            errors.push(`${label}: too large (${dims.width}x${dims.height}px). Maximum: ${IMAGE_CONFIG.max_width}x${IMAGE_CONFIG.max_height}px`);
        }
    }

    if (errors.length > 0) return { valid: false, error: errors };
    return { valid: true };
}

// ============================================================
// HELPER — GENERATE PRODUCT CODE
// ============================================================
async function generateNextProductCode(pool) {
    const prefixRes = await pool.query(
        `SELECT prefix_code FROM public.prefix_refno
         WHERE table_name    = 'products'
           AND category_type = 'PRODUCTS'
           AND is_active     = TRUE
           AND is_deleted    = FALSE
         ORDER BY created_at DESC LIMIT 1`
    );
    const prefix = prefixRes.rows[0]?.prefix_code || "PRD";

    const result = await pool.query(
        `SELECT code FROM public.products
         WHERE code IS NOT NULL
           AND code LIKE $1
         ORDER BY (regexp_replace(code, '\\D', '', 'g'))::int DESC
         LIMIT 1`,
        [`${prefix}%`]
    );

    const lastCode = result.rows[0]?.code || null;
    if (!lastCode) return `${prefix}00001`;

    const match  = lastCode.match(/\d+$/);
    const number = match ? parseInt(match[0], 10) : 0;
    return `${prefix}${(number + 1).toString().padStart(5, "0")}`;
}

// ============================================================
// HELPER — VALIDATE INPUT
// ============================================================
function validateCreateSellerProductInput(body) {
    const {
        seller_uuid,
        product_type_uuid,
        name,
        sku,
        oem_part_number,
        manufacturer_uuid,
        brand_uuid,
        model_uuid,
        currency_uuid,
        upload_method,
        price,
        price_after_sale,
        price_effective_from,
        product_listing_status_uuid,
        images,
        equivalent_oem_part_numbers,
        inventory_details,
    } = body;
    // ── Required fields ──
    if (!seller_uuid?.trim())
        return { valid: false, error: "Seller UUID is required" };

    if (!product_type_uuid?.trim())
        return { valid: false, error: "Product type UUID is required" };
 if (!name?.trim())
        return { valid: false, error: "Product name is required" };
    if (!sku?.trim())
        return { valid: false, error: "SKU is required" };

    if (!oem_part_number?.trim())
        return { valid: false, error: "OEM part number is required" };

    if (!manufacturer_uuid?.trim())
        return { valid: false, error: "Manufacturer UUID is required" };

    if (!brand_uuid?.trim())
        return { valid: false, error: "Brand UUID is required" };

    if (!model_uuid?.trim())
        return { valid: false, error: "Model UUID is required" };

    if (!currency_uuid?.trim())
        return { valid: false, error: "Currency UUID is required" };

    if (!upload_method?.trim())
        return { valid: false, error: "Upload method is required" };

    if (!product_listing_status_uuid)
        return { valid: false, error: "Product listing status UUID is required" };

    if (price === undefined || price === null || isNaN(Number(price)))
        return { valid: false, error: "Valid price is required" };

    if (Number(price) < 0)
        return { valid: false, error: "Price cannot be negative" };

    if (price_after_sale === undefined || price_after_sale === null || isNaN(Number(price_after_sale)))
        return { valid: false, error: "Valid price after sale is required" };

    if (Number(price_after_sale) < 0)
        return { valid: false, error: "Price after sale cannot be negative" };

    if (Number(price_after_sale) > Number(price))
        return { valid: false, error: "Price after sale cannot be greater than price" };

    if (!price_effective_from?.toString().trim())
        return { valid: false, error: "Price effective from is required" };

    if (isNaN(new Date(price_effective_from).getTime()))
        return { valid: false, error: "Price effective from must be a valid date" };

    if (!images || !Array.isArray(images) || images.length === 0)
        return { valid: false, error: "At least one image is required" };

    let parsedInventory = inventory_details;

if (typeof inventory_details === 'string') {
    try {
        parsedInventory = JSON.parse(inventory_details);
    } catch (e) {
        return {
            valid: false,
            error: 'inventory_details is not valid JSON'
        };
    }
}

if (!Array.isArray(parsedInventory) || parsedInventory.length === 0) {
    return {
        valid: false,
        error: 'At least one inventory detail is required'
    };
}
    // // ── inventory details ──
    // if (!Array.isArray(inventory_details) || inventory_details.length === 0)
    //     return { valid: false, error: "At least one warehouse entry is required" };

    for (let i = 0; i < parsedInventory.length; i++) {
        const wh  = parsedInventory[i];
        const lbl = `inventory_details[${i}]`;

        if (!wh.warehouse_uuid?.trim())
            return { valid: false, error: `${lbl}: warehouse_uuid is required` };

        if (wh.onhand_qty === undefined || wh.onhand_qty === null || isNaN(Number(wh.onhand_qty)))
            return { valid: false, error: `${lbl}: valid onhand_qty is required` };

        if (Number(wh.onhand_qty) < 0)
            return { valid: false, error: `${lbl}: onhand_qty cannot be negative` };

        if (wh.reorder_level !== undefined && wh.reorder_level !== null) {
            if (isNaN(Number(wh.reorder_level)) || Number(wh.reorder_level) < 0)
                return { valid: false, error: `${lbl}: reorder_level must be a non-negative number` };
        }

        if (wh.buffer_qty !== undefined && wh.buffer_qty !== null) {
            if (isNaN(Number(wh.buffer_qty)) || Number(wh.buffer_qty) < 0)
                return { valid: false, error: `${lbl}: buffer_qty must be a non-negative number` };
        }
    }

    // Duplicate warehouse_uuid check
    const warehouseUuids = parsedInventory.map(w => w.warehouse_uuid.trim());
    if (new Set(warehouseUuids).size !== warehouseUuids.length)
        return { valid: false, error: "Duplicate warehouse_uuid entries found in inventory_details array" };

    // ── OEM equivalents (optional) ──
    if (equivalent_oem_part_numbers !== undefined && equivalent_oem_part_numbers !== null) {
        if (typeof equivalent_oem_part_numbers === "string") {
            if (!equivalent_oem_part_numbers.trim())
                return { valid: false, error: "equivalent_oem_part_numbers cannot be an empty string" };
            body.equivalent_oem_part_numbers = [equivalent_oem_part_numbers.trim()];

        } else if (Array.isArray(equivalent_oem_part_numbers)) {
            if (equivalent_oem_part_numbers.length === 0)
                return { valid: false, error: "equivalent_oem_part_numbers must be a non-empty array" };

            if (equivalent_oem_part_numbers.some(v => !v?.toString().trim()))
                return { valid: false, error: "equivalent_oem_part_numbers must not contain empty values" };

            body.equivalent_oem_part_numbers = equivalent_oem_part_numbers.map(v => v.toString().trim());

        } else {
            return { valid: false, error: "equivalent_oem_part_numbers must be a string or an array" };
        }
    }
body.inventory_details = parsedInventory;
    return { valid: true };
}

// ============================================================
// HELPER — RESOLVE UUIDs → IDs
// ============================================================
async function resolveIds(pool, body) {
    const {
        seller_uuid,
        product_type_uuid,
        manufacturer_uuid,
        brand_uuid,
        model_uuid,
        currency_uuid,
        product_listing_status_uuid,
        uom_uuid,
        condition_uuid,
        group_uuid,
        sub_group_uuid,
        sub_node_uuid,
        trading_type_uuid,
        inventory_details,
    } = body;

    // ── Mandatory lookups (parallel) ──
    const [
        sellerResult,
        productTypeResult,
        manufacturerResult,
        brandResult,
        modelResult,
        currencyResult,
        listingStatusResult,
    ] = await Promise.all([
        pool.query({
            text:   `SELECT seller_id FROM public.seller_accounts WHERE seller_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            values: [seller_uuid],
        }),
        pool.query({
            text:   `SELECT product_type_id FROM public.product_types WHERE product_type_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            values: [product_type_uuid],
        }),
        pool.query({
            text:   `SELECT manufacturer_id FROM public.manufacturer WHERE manufacturer_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            values: [manufacturer_uuid],
        }),
        pool.query({
            text:   `SELECT brand_id FROM public.brand WHERE brand_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            values: [brand_uuid],
        }),
        pool.query({
            text:   `SELECT model_id FROM public.model WHERE model_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            values: [model_uuid],
        }),
        pool.query({
            text:   `SELECT currency_id FROM public.currency WHERE currency_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            values: [currency_uuid],
        }),
        pool.query({
            text:   `SELECT product_listing_status_id FROM public.product_listing_status WHERE product_listing_status_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            values: [product_listing_status_uuid],
        }),
    ]);

    if (sellerResult.rowCount === 0)        throw { code: 2001, error: "Invalid Seller UUID" };
    if (productTypeResult.rowCount === 0)   throw { code: 2001, error: "Invalid Product Type UUID" };
    if (manufacturerResult.rowCount === 0)  throw { code: 2001, error: "Invalid Manufacturer UUID" };
    if (brandResult.rowCount === 0)         throw { code: 2001, error: "Invalid Brand UUID" };
    if (modelResult.rowCount === 0)         throw { code: 2001, error: "Invalid Model UUID" };
    if (currencyResult.rowCount === 0)      throw { code: 2001, error: "Invalid Currency UUID" };
    if (listingStatusResult.rowCount === 0) throw { code: 2001, error: "Invalid Product Listing Status UUID" };

    const resolved = {
        seller_id:                 sellerResult.rows[0].seller_id,
        product_type_id:           productTypeResult.rows[0].product_type_id,
        manufacturer_id:           manufacturerResult.rows[0].manufacturer_id,
        brand_id:                  brandResult.rows[0].brand_id,
        model_id:                  modelResult.rows[0].model_id,
        currency_id:               currencyResult.rows[0].currency_id,
        product_listing_status_id: listingStatusResult.rows[0].product_listing_status_id,
        uom_id:                    null,
        condition_id:              null,
        group_id:                  null,
        sub_group_id:              null,
        sub_node_id:               null,
        trading_type_ids:          [],
        inventory_details:                [],
    };

    // ── Optional lookups (parallel) ──
    const optionalLookups = [];

    if (uom_uuid) {
        optionalLookups.push(
            pool.query({
                text:   `SELECT uom_id FROM public.uom WHERE uom_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
                values: [uom_uuid],
            }).then(r => {
                if (r.rowCount === 0) throw { code: 2001, error: "Invalid UOM UUID" };
                resolved.uom_id = r.rows[0].uom_id;
            })
        );
    }

    if (condition_uuid) {
        optionalLookups.push(
            pool.query({
                text:   `SELECT condition_id FROM public.product_conditions WHERE condition_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
                values: [condition_uuid],
            }).then(r => {
                if (r.rowCount === 0) throw { code: 2001, error: "Invalid Condition UUID" };
                resolved.condition_id = r.rows[0].condition_id;
            })
        );
    }

    if (group_uuid) {
        optionalLookups.push(
            pool.query({
                text:   `SELECT group_id FROM public.groups WHERE group_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
                values: [group_uuid],
            }).then(r => {
                if (r.rowCount === 0) throw { code: 2001, error: "Invalid Group UUID" };
                resolved.group_id = r.rows[0].group_id;
            })
        );
    }

    if (sub_group_uuid) {
        optionalLookups.push(
            pool.query({
                text:   `SELECT sub_group_id FROM public.sub_groups WHERE sub_group_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
                values: [sub_group_uuid],
            }).then(r => {
                if (r.rowCount === 0) throw { code: 2001, error: "Invalid Sub Group UUID" };
                resolved.sub_group_id = r.rows[0].sub_group_id;
            })
        );
    }

    if (sub_node_uuid) {
        optionalLookups.push(
            pool.query({
                text:   `SELECT sub_node_id FROM public.sub_nodes WHERE sub_node_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
                values: [sub_node_uuid],
            }).then(r => {
                if (r.rowCount === 0) throw { code: 2001, error: "Invalid Sub Node UUID" };
                resolved.sub_node_id = r.rows[0].sub_node_id;
            })
        );
    }

    // ── Trading types ──
    const tradingTypeUuidList = Array.isArray(trading_type_uuid)
        ? trading_type_uuid
        : trading_type_uuid ? [trading_type_uuid] : [];

    if (tradingTypeUuidList.length > 0) {
        optionalLookups.push(
            pool.query({
                text:   `SELECT trading_type_id FROM public.trading_types WHERE trading_type_uuid = ANY($1::uuid[]) AND is_deleted = FALSE AND is_active = TRUE`,
                values: [tradingTypeUuidList],
            }).then(r => {
                if (r.rowCount !== tradingTypeUuidList.length)
                    throw { code: 2001, error: "One or more Trading Type UUIDs are invalid" };
                resolved.trading_type_ids = r.rows.map(row => row.trading_type_id);
            })
        );
    }

    // ── inventory details (batch) ──
    if (Array.isArray(inventory_details) && inventory_details.length > 0) {
        const warehouseUuids = inventory_details.map(w => w.warehouse_uuid.trim());
        optionalLookups.push(
            pool.query({
                text:   `SELECT warehouse_id, warehouse_uuid FROM public.seller_warehouse WHERE warehouse_uuid = ANY($1::uuid[]) AND is_deleted = FALSE AND is_active = TRUE`,
                values: [warehouseUuids],
            }).then(r => {
                if (r.rowCount !== warehouseUuids.length)
                    throw { code: 2001, error: "One or more Warehouse UUIDs are invalid" };

                const warehouseMap = {};
                for (const row of r.rows) {
                    warehouseMap[row.warehouse_uuid] = row.warehouse_id;
                }

                resolved.inventory_details = inventory_details.map(wh => ({
                    ...wh,
                    warehouse_id: warehouseMap[wh.warehouse_uuid.trim()],
                }));
            })
        );
    }

    await Promise.all(optionalLookups);
    return resolved;
}

// ============================================================
// HELPER — DUPLICATE CHECK
// ============================================================
async function checkDuplicates(pool, { sku, oem_part_number, seller_id }) {
    const [skuCheck, oemCheck] = await Promise.all([
        pool.query({
            text:   `SELECT 1 FROM public.products WHERE LOWER(sku) = LOWER($1) AND is_deleted = FALSE LIMIT 1`,
            values: [sku.trim()],
        }),
        pool.query({
            text:   `SELECT 1 FROM public.products WHERE LOWER(oem_part_number) = LOWER($1) AND seller_id = $2 AND is_deleted = FALSE LIMIT 1`,
            values: [oem_part_number.trim(), seller_id],
        }),
    ]);

    if (skuCheck.rowCount > 0) throw { code: 2002, error: "A product with this SKU already exists" };
    if (oemCheck.rowCount > 0) throw { code: 2002, error: "A product with this OEM part number already exists for this seller" };
}

// ============================================================
// HELPER — PROCESS IMAGES
// ============================================================
async function processImages(images, product_code) {
    return Promise.all(
        images.map(async (filePath, index) => {
            const ext      = path.extname(filePath).toLowerCase();
            const destName = `${product_code}_${randomUUID()}${ext}`;
            const destPath = path.join(uploadDir, destName);
            await fse.move(filePath, destPath, { overwrite: true });
            return {
                url:        `/assets/products/${destName}`,
                image_type: index === 0 ? "PRIMARY" : "SECONDARY",
                sort_order: index + 1,
            };
        })
    );
}

// ============================================================
// HELPER — PRODUCT TYPE CONDITIONAL VALIDATION
// ============================================================
function validateProductTypeConditionals(body, resolved) {
    if (resolved.product_type_id === 2) {
        const { oem_part_number, aftermarket_number, condition_uuid, used_years } = body;

        if (!oem_part_number?.trim())
            return { valid: false, error: "oem_part_number is required for this product type" };

        if (!aftermarket_number?.toString().trim())
            return { valid: false, error: "aftermarket_number is required for this product type" };

        if (!condition_uuid?.trim())
            return { valid: false, error: "condition_uuid is required for this product type" };

        if (!resolved.condition_id)
            return { valid: false, error: "Invalid condition_uuid for this product type" };

        if (used_years === undefined || used_years === null || used_years === "")
            return { valid: false, error: "used_years is required for this product type" };

        if (!Number.isInteger(Number(used_years)) || Number(used_years) < 0)
            return { valid: false, error: "used_years must be a non-negative integer for this product type" };
    }

    return { valid: true };
}

// ============================================================
// HELPER — EXECUTE TRANSACTION
// ============================================================
async function executeTransaction(client, { body, resolved, processedImages, product_code, now }) {
    const {
        name,
        sku,
        oem_part_number,
        aftermarket_number,
        equivalent_oem_part_numbers,
        manufacturer_name,
        barcode_number,
        weight,
        dimension_length,
        dimension_width,
        dimension_height,
        material_type,
        verify_status,
        listing_status,
        used_years,
        item_description,
        upload_method,
        price,
        price_after_sale,
        price_effective_from,
        created_by,
    } = body;

    const {
        seller_id,
        product_type_id,
        manufacturer_id,
        brand_id,
        model_id,
        currency_id,
        product_listing_status_id,
        uom_id,
        condition_id,
        group_id,
        sub_group_id,
        sub_node_id,
        trading_type_ids,
        inventory_details,
    } = resolved;

    const trading_type_jsonb = trading_type_ids.length > 0
        ? JSON.stringify(trading_type_ids)
        : null;

    const oem_equiv_jsonb = Array.isArray(equivalent_oem_part_numbers) && equivalent_oem_part_numbers.length > 0
        ? JSON.stringify(equivalent_oem_part_numbers)
        : null;

    // --------------------------------------------------
    // STEP 1: INSERT products
    // --------------------------------------------------
    
        const productInsert = await client.query({
        text: `
            INSERT INTO public.products (
                code, sku, name, seller_id, product_type_id, oem_part_number,
                aftermarket_number, equivalent_oem_part_numbers, trading_type_id,
                manufacturer_id, manufacturer_name, barcode_number,
                brand_id, model_id, group_id, sub_group_id, sub_node_id,
                weight, price, price_after_sale, price_effective_from,
                currency_id, dimension_length, dimension_width, dimension_height,
                uom_id, material_type, condition_id, used_years, item_description,
                product_listing_status_id, upload_method,
                assigned_to, assigned_at, created_by,
                verify_status, listing_status
            ) VALUES (
                $1,  $2,  $3,  $4,  $5,  $6,
                $7,  $8,  $9,  $10, $11, $12,
                $13, $14, $15, $16, $17,
                $18, $19, $20, $21,
                $22, $23, $24, $25,
                $26, $27, $28, $29, $30,
                $31, $32, $33, $34, $35,
                $36, $37
            )
            RETURNING product_id, product_uuid, code, sku
        `,
        values: [
            product_code,               // $1  code
            sku.trim(),                 // $2  sku
            name.trim(),                // $3  name        ← ADD (shifts everything below by 1)
            seller_id,                  // $4  seller_id
            product_type_id,            // $5  product_type_id
            oem_part_number.trim(),     // $6  oem_part_number
            aftermarket_number || null, // $7  aftermarket_number
            oem_equiv_jsonb,            // $8  equivalent_oem_part_numbers
            trading_type_jsonb,         // $9  trading_type_id
            manufacturer_id,            // $10 manufacturer_id
            manufacturer_name,          // $11 manufacturer_name
            barcode_number,             // $12 barcode_number
            brand_id,                   // $13 brand_id
            model_id,                   // $14 model_id
            group_id,                   // $15 group_id
            sub_group_id,               // $16 sub_group_id
            sub_node_id,               // $17 sub_node_id
            weight,                     // $18 weight
            Number(price),              // $19 price
            Number(price_after_sale),   // $20 price_after_sale
            price_effective_from || now,// $21 price_effective_from
            currency_id,                // $22 currency_id
            dimension_length,           // $23 dimension_length
            dimension_width,            // $24 dimension_width
            dimension_height,           // $25 dimension_height
            uom_id,                     // $26 uom_id
            material_type,              // $27 material_type
            condition_id,               // $28 condition_id
            used_years,                 // $29 used_years
            item_description,           // $30 item_description
            product_listing_status_id,  // $31 product_listing_status_id
            upload_method.trim(),       // $32 upload_method
            created_by,                 // $33 assigned_to
            now,                        // $34 assigned_at
            created_by,                 // $35 created_by
            verify_status  || "PENDING",   // $36 verify_status
            listing_status || "INACTIVE",  // $37 listing_status
        ],
    });

    const { product_id, product_uuid, code } = productInsert.rows[0];

    // --------------------------------------------------
    // STEP 2: BATCH INSERT product_images
    // --------------------------------------------------
    const imageValues = [];
    const imageParams = [];
    let   imgIdx      = 1;

    for (const img of processedImages) {
        imageValues.push(
            `($${imgIdx++}, $${imgIdx++}, $${imgIdx++}, $${imgIdx++}, $${imgIdx++}, $${imgIdx++}, $${imgIdx++})`
        );
        imageParams.push(
            product_id,
            img.url,
            img.image_type,
            img.sort_order,
            created_by,
            created_by,
            now
        );
    }

    await client.query({
        text: `
            INSERT INTO public.product_images
                (product_id, image_url, image_type, sort_order, created_by, assigned_to, assigned_at)
            VALUES ${imageValues.join(", ")}
        `,
        values: imageParams,
    });

    // --------------------------------------------------
    // STEP 3: INSERT product_price_history
    // --------------------------------------------------
    await client.query({
        text: `
            INSERT INTO public.product_price_history (
                product_id, price, price_after_sale, currency_id,
                effective_from, reason,
                assigned_to, assigned_at, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        values: [
            product_id,
            Number(price),
            Number(price_after_sale),
            currency_id,
            price_effective_from || now,
            "Initial listing price",
            created_by,
            now,
            created_by,
        ],
    });

    // --------------------------------------------------
    // STEP 4: UPSERT oem_equivalents (conditional)
    // --------------------------------------------------
    if (oem_equiv_jsonb) {
        await client.query({
            text: `
                INSERT INTO public.oem_equivalents (
                    oem_part_number, equivalent_oem_part_numbers,
                    assigned_to, assigned_at, created_by
                ) VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (oem_part_number)
                DO UPDATE SET
                    equivalent_oem_part_numbers = EXCLUDED.equivalent_oem_part_numbers,
                    modified_at                 = NOW(),
                    modified_by                 = EXCLUDED.created_by
            `,
            values: [
                oem_part_number.trim(),
                oem_equiv_jsonb,
                created_by,
                now,
                created_by,
            ],
        });
    }

    // --------------------------------------------------
    // STEP 5: BATCH INSERT seller_inventory
    // --------------------------------------------------
    const invValues = [];
    const invParams = [];
    let   invIdx    = 1;

    for (const wh of inventory_details) {
        invValues.push(
            `($${invIdx++}, $${invIdx++}, $${invIdx++}, $${invIdx++}, $${invIdx++}, $${invIdx++}, $${invIdx++}, $${invIdx++}, $${invIdx++}, $${invIdx++}, $${invIdx++})`
        );
        invParams.push(
            wh.warehouse_id,
            seller_id,
            product_id,
            Number(wh.onhand_qty),
            0,                                                // reserved_qty — always 0 on create
            wh.buffer_qty    ? Number(wh.buffer_qty)    : 0,
            wh.bin_loc       || null,
            wh.reorder_level ? Number(wh.reorder_level) : null,
            created_by,
            now,
            created_by
        );
    }

    const inventoryInsert = await client.query({
        text: `
            INSERT INTO public.seller_inventory (
                warehouse_id, seller_id, product_id,
                onhand_qty, reserved_qty, buffer_qty,
                bin_loc, reorder_level,
                assigned_to, assigned_at, created_by
            ) VALUES ${invValues.join(", ")}
            RETURNING inventory_id, inventory_uuid, warehouse_id
        `,
        values: invParams,
    });

    // warehouse_id → inventory_id map for stock history
    const inventoryMap = {};
    for (const row of inventoryInsert.rows) {
        inventoryMap[row.warehouse_id] = row.inventory_id;
    }

    // --------------------------------------------------
    // STEP 6: BATCH INSERT product_stock_history
    // --------------------------------------------------
    const stockValues = [];
    const stockParams = [];
    let   stockIdx    = 1;

    for (const wh of inventory_details) {
        const inventory_id = inventoryMap[wh.warehouse_id];
        stockValues.push(
            `($${stockIdx++}, $${stockIdx++}, $${stockIdx++}, $${stockIdx++}, $${stockIdx++}, $${stockIdx++}, $${stockIdx++}, $${stockIdx++}, $${stockIdx++}, $${stockIdx++}, $${stockIdx++})`
        );
        stockParams.push(
            product_id,
            wh.warehouse_id,
            "IN",
            0,                        // quantity_before
            Number(wh.onhand_qty),    // quantity_changed
            Number(wh.onhand_qty),    // quantity_after
            "Initial stock on product creation",
            "product_creation",
            inventory_id,             // reference_id → links to inventory record
            created_by,
            now
        );
    }

    await client.query({
        text: `
            INSERT INTO public.product_stock_history (
                product_id, warehouse_id,
                movement_type,
                quantity_before, quantity_changed, quantity_after,
                reason, reference_type, reference_id,
                created_by, assigned_at
            ) VALUES ${stockValues.join(", ")}
        `,
        values: stockParams,
    });

    // --------------------------------------------------
    // RETURN
    // --------------------------------------------------
    return {
        product_id,
        product_uuid,
        code,
        sku:         productInsert.rows[0].sku,
        inventories: inventoryInsert.rows.map(r => ({
            inventory_uuid: r.inventory_uuid,
            warehouse_id:   r.warehouse_id,
        })),
    };
}

// ============================================================
// RESPONDER
// ============================================================
responder.on("create-product", async (req, cb) => {
    try {
        const body = req.body;

        // ── STEP 1: Validate input ──
        const validation = validateCreateSellerProductInput(body);
        if (!validation.valid) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              validation.error,
            });
        }

        // ── STEP 2: Validate images ──
        const imageValidation = await validateImages(body.images);
        if (!imageValidation.valid) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Image validation failed",
                error:              imageValidation.error,
            });
        }

        // ── STEP 3: Resolve UUIDs → IDs ──
        let resolved;
        try {
            resolved = await resolveIds(pool, body);
        } catch (resolveErr) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               resolveErr.code || 2001,
                message:            "Validation failed",
                error:              resolveErr.error || resolveErr.message,
            });
        }

        // ── STEP 4: Product type conditional validation ──
        const typeValidation = validateProductTypeConditionals(body, resolved);
        if (!typeValidation.valid) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              typeValidation.error,
            });
        }

        // ── STEP 5: Duplicate check ──
        try {
            await checkDuplicates(pool, {
                sku:             body.sku,
                oem_part_number: body.oem_part_number,
                seller_id:       resolved.seller_id,
            });
        } catch (dupErr) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               dupErr.code || 2002,
                message:            "Duplicate entry",
                error:              dupErr.error || dupErr.message,
            });
        }

        // ── STEP 6: Generate code + process images ──
        const product_code    = await generateNextProductCode(pool);
        const processedImages = await processImages(body.images, product_code);
        const now             = new Date();

        // ── STEP 7: Transaction ──
        const client = await pool.connect();
        let result;

        try {
            await client.query("BEGIN");
            result = await executeTransaction(client, {
                body,
                resolved,
                processedImages,
                product_code,
                now,
            });
            await client.query("COMMIT");
        } catch (txErr) {
            await client.query("ROLLBACK");
            throw txErr;
        } finally {
            client.release();
        }

        // ── STEP 8: Success response ──
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Product created successfully",
            data:               result,
        });

    } catch (err) {
        logger.error("Responder Error (create-product):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    }
});

// --------------------------------------------------
// CREATE SELLER INVENTORY
// --------------------------------------------------

responder.on("create-seller-inventory", async (req, cb) => {
    const client = await pool.connect();

    try {
        const body = req.body;

        const {
            product_uuid,
            warehouse_uuid,
            onhand_qty,
            buffer_qty,
            reorder_level,
            bin_loc,
            created_by,
        } = body;

        const now         = new Date();
        const assigned_to = created_by;
        const assigned_at = now;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!product_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Product UUID is required" });

        if (!warehouse_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Warehouse UUID is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created_by is required" });

        if (onhand_qty === undefined || onhand_qty === null || isNaN(Number(onhand_qty)))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Valid onhand_qty is required" });

        if (Number(onhand_qty) < 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "onhand_qty cannot be negative" });

        if (buffer_qty !== undefined && buffer_qty !== null && isNaN(Number(buffer_qty)))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buffer_qty must be a valid number" });

        if (reorder_level !== undefined && reorder_level !== null && isNaN(Number(reorder_level)))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "reorder_level must be a valid number" });

        // --------------------------------------------------
        // 2. RESOLVE UUIDs → IDs (parallel)
        // --------------------------------------------------
        const [productResult, warehouseResult] = await Promise.all([
            pool.query({
                text: `SELECT product_id, seller_id FROM public.products
                       WHERE product_uuid = $1
                         AND is_deleted   = FALSE
                         AND is_active    = TRUE`,
                values: [product_uuid.trim()],
            }),
            pool.query({
                text: `SELECT warehouse_id, seller_id FROM public.seller_warehouse
                       WHERE warehouse_uuid = $1
                         AND is_deleted     = FALSE
                         AND is_active      = TRUE`,
                values: [warehouse_uuid.trim()],
            }),
        ]);

        if (productResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active product found with the provided UUID" });

        if (warehouseResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active warehouse found with the provided UUID" });

        const { product_id, seller_id: product_seller_id } = productResult.rows[0];
        const { warehouse_id, seller_id: warehouse_seller_id } = warehouseResult.rows[0];

        // --------------------------------------------------
        // 3. OWNERSHIP CHECK
        // Warehouse must belong to the same seller as the product
        // --------------------------------------------------
        if (product_seller_id !== warehouse_seller_id) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Warehouse does not belong to the same seller as the product",
            });
        }

        const seller_id = product_seller_id;

        // --------------------------------------------------
        // 4. DUPLICATE CHECK
        // Same product cannot have two inventory records in same warehouse
        // --------------------------------------------------
        const duplicateCheck = await pool.query({
            text: `SELECT 1 FROM public.seller_inventory
                   WHERE product_id   = $1
                     AND warehouse_id = $2
                     AND is_deleted   = FALSE
                   LIMIT 1`,
            values: [product_id, warehouse_id],
        });

        if (duplicateCheck.rowCount > 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2002,
                message:            "Duplicate entry",
                error:              "An inventory record already exists for this product in the selected warehouse",
            });
        }

        // --------------------------------------------------
        // 5. TRANSACTION
        // INSERT seller_inventory + product_stock_history
        // --------------------------------------------------
        await client.query("BEGIN");

        // STEP 1: INSERT seller_inventory
        const inventoryInsert = await client.query({
            text: `
                INSERT INTO public.seller_inventory (
                    warehouse_id,
                    seller_id,
                    product_id,
                    onhand_qty,
                    reserved_qty,
                    buffer_qty,
                    bin_loc,
                    reorder_level,
                    assigned_to,
                    assigned_at,
                    created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING inventory_id, inventory_uuid
            `,
            values: [
                warehouse_id,
                seller_id,
                product_id,
                Number(onhand_qty),
                0,                                                    // reserved_qty always 0 on create
                buffer_qty    !== undefined ? Number(buffer_qty) : 0,
                bin_loc       || null,
                reorder_level !== undefined ? Number(reorder_level) : null,
                assigned_to,
                assigned_at,
                created_by,
            ],
        });

        const { inventory_id, inventory_uuid } = inventoryInsert.rows[0];

        // STEP 2: INSERT product_stock_history (only if qty > 0)
        if (Number(onhand_qty) > 0) {
            await client.query({
                text: `
                    INSERT INTO public.product_stock_history (
                        product_id,
                        warehouse_id,
                        movement_type,
                        quantity_before,
                        quantity_changed,
                        quantity_after,
                        reason,
                        reference_type,
                        reference_id,
                        notes,
                        assigned_to,
                        assigned_at,
                        created_by
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                `,
                values: [
                    product_id,
                    warehouse_id,
                    "IN",
                    0,                                                // quantity_before
                    Number(onhand_qty),                               // quantity_changed
                    Number(onhand_qty),                               // quantity_after
                    "Initial stock entry for warehouse",
                    "INVENTORY_CREATE",
                    inventory_id,
                    `Inventory created with initial stock of ${Number(onhand_qty)}`,
                    assigned_to,
                    assigned_at,
                    created_by,
                ],
            });
        }

        await client.query("COMMIT");

        // --------------------------------------------------
        // 6. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Seller inventory created successfully",
            data: {
                inventory_id,
                inventory_uuid,
                product_id,
                warehouse_id,
                seller_id,
                onhand_qty:    Number(onhand_qty),
                reserved_qty:  0,
                buffer_qty:    buffer_qty    !== undefined ? Number(buffer_qty) : 0,
                reorder_level: reorder_level !== undefined ? Number(reorder_level) : null,
                bin_loc:       bin_loc || null,
            },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (create-seller-inventory):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// UPDATE PRODUCT
// --------------------------------------------------

// --------------------------------------------------
// HELPER FUNCTIONS
// --------------------------------------------------

// --------------------------------------------------
// IMAGE VALIDATION (update flow)
// --------------------------------------------------
async function validateUpdateImages(images) {
    const errors = [];
    const seen   = new Set();

    for (let i = 0; i < images.length; i++) {
        const filePath = images[i];
        const label    = i === 0 ? "primary image" : `images[${i}]`;

        // 0. Duplicate path check (existing or new — applies to both)
        if (seen.has(filePath)) {
            errors.push(`${label}: duplicate image path "${filePath}"`);
            continue;
        }
        seen.add(filePath);

        // ── Already-stored asset (update flow) ──
        if (filePath.startsWith("/assets/products/")) {
            // Verify the referenced file still exists on disk
            const fullPath = path.join(uploadDir, path.basename(filePath));
            const exists   = fs.existsSync(fullPath);
            if (!exists) {
                errors.push(`${label}: referenced existing image "${filePath}" no longer exists`);
            }
            continue; // skip type/size/dimension checks for existing assets
        }

        // ── New upload — full validation ──
        const ext = path.extname(filePath).toLowerCase();

        // 1. File type
        if (!IMAGE_CONFIG.allowed_types.includes(ext)) {
            errors.push(`${label}: invalid file type "${ext}". Allowed: ${IMAGE_CONFIG.allowed_types.join(", ")}`);
            continue;
        }

        // 2. File size
        const sizeBytes = await getFileSize(filePath);
        if (sizeBytes === null) {
            errors.push(`${label}: file not found or unreadable`);
            continue;
        }
        if (sizeBytes > IMAGE_CONFIG.max_size_mb * BYTES_PER_MB) {
            errors.push(`${label}: size ${(sizeBytes / BYTES_PER_MB).toFixed(2)}MB exceeds limit of ${IMAGE_CONFIG.max_size_mb}MB`);
        }

        // 3. Dimensions
        const dims = await getImageDimensions(filePath);
        if (!dims) {
            errors.push(`${label}: unable to read image dimensions`);
            continue;
        }
        if (dims.width < IMAGE_CONFIG.min_width || dims.height < IMAGE_CONFIG.min_height) {
            errors.push(`${label}: too small (${dims.width}x${dims.height}px). Minimum: ${IMAGE_CONFIG.min_width}x${IMAGE_CONFIG.min_height}px`);
        }
        if (dims.width > IMAGE_CONFIG.max_width || dims.height > IMAGE_CONFIG.max_height) {
            errors.push(`${label}: too large (${dims.width}x${dims.height}px). Maximum: ${IMAGE_CONFIG.max_width}x${IMAGE_CONFIG.max_height}px`);
        }
    }

    if (errors.length > 0) return { valid: false, error: errors };
    return { valid: true };
}


/**
 * Validates all required and conditional fields for update.
 */
function validateUpdateSellerProductInput(params, body) {
    const { product_uuid } = params;
    const {
        modified_by,
        product_type_uuid,
        name,   
        sku,
        oem_part_number,
        manufacturer_uuid,
        brand_uuid,
        model_uuid,
        currency_uuid,
        upload_method,
        price,
        price_after_sale,
        product_listing_status_uuid,
        images,
        warehouse_uuid,
        onhand_qty,
        equivalent_oem_part_numbers,
    } = body;

    if (!product_uuid?.trim())
        return { valid: false, error: "Product UUID is required" };

    if (!modified_by?.trim())
        return { valid: false, error: "modified_by is required" };

    if (!product_type_uuid?.trim())
        return { valid: false, error: "Product type UUID is required" };
 if (!name?.trim())
        return { valid: false, error: "Product name is required" };
    if (!sku?.trim())
        return { valid: false, error: "SKU is required" };

    if (!oem_part_number?.trim())
        return { valid: false, error: "OEM part number is required" };

    if (!manufacturer_uuid?.trim())
        return { valid: false, error: "Manufacturer UUID is required" };

    if (!brand_uuid?.trim())
        return { valid: false, error: "Brand UUID is required" };

    if (!model_uuid?.trim())
        return { valid: false, error: "Model UUID is required" };

    if (!currency_uuid?.trim())
        return { valid: false, error: "Currency UUID is required" };

    if (!upload_method?.trim())
        return { valid: false, error: "Upload method is required" };

    if (!product_listing_status_uuid?.trim())
        return { valid: false, error: "Product listing status UUID is required" };

    if (price === undefined || price === null || isNaN(Number(price)))
        return { valid: false, error: "Valid price is required" };

    if (Number(price) < 0)
        return { valid: false, error: "Price cannot be negative" };

    if (price_after_sale === undefined || price_after_sale === null || isNaN(Number(price_after_sale)))
        return { valid: false, error: "Valid price_after_sale is required" };

    if (Number(price_after_sale) < 0)
        return { valid: false, error: "price_after_sale cannot be negative" };

    if (Number(price_after_sale) > Number(price))
        return { valid: false, error: "price_after_sale cannot be greater than price" };

    if (!images || !Array.isArray(images) || images.length === 0)
        return { valid: false, error: "At least one image is required" };

    if (equivalent_oem_part_numbers !== undefined && equivalent_oem_part_numbers !== null) {
        if (!Array.isArray(equivalent_oem_part_numbers) || equivalent_oem_part_numbers.length === 0)
            return { valid: false, error: "equivalent_oem_part_numbers must be a non-empty array" };
    }

    return { valid: true };
}


/**
 * Checks record lock — seller must have acquired lock before updating.
 */
async function checkEditLock(client, { product_uuid, modified_by }) {
    const lockCheck = await client.query({
        text: `SELECT 1 FROM public.record_locks
               WHERE table_name = 'products'
                 AND record_id  = $1
                 AND locked_by  = $2
                 AND is_deleted = FALSE
                 AND expires_at > NOW()`,
        values: [product_uuid, modified_by],
    });
    if (lockCheck.rowCount === 0)
        throw { code: 2005, error: "You must lock the record before updating" };
}


/**
 * Fetches the existing product — ensures it exists and returns internal IDs.
 */
async function fetchExistingProduct(client, product_uuid) {
    const result = await client.query({
        text: `SELECT product_id, code, price, price_after_sale, currency_id, seller_id
               FROM public.products
               WHERE product_uuid = $1 AND is_deleted = FALSE`,
        values: [product_uuid],
    });
    if (result.rowCount === 0)
        throw { code: 2003, error: "No product found with the provided UUID" };
    return result.rows[0];
}


/**
 * Resolves all UUID → internal ID lookups in parallel where possible.
 */
async function resolveUpdateIds(client, body) {
    const {
        product_type_uuid,
        manufacturer_uuid,
        brand_uuid,
        model_uuid,
        currency_uuid,
        product_listing_status_uuid,
        uom_uuid,
        condition_uuid,
        group_uuid,
        sub_group_uuid,
        sub_node_uuid,
        trading_type_uuid,
    } = body;

    // ---------- Mandatory parallel lookups ----------
    const [
        productTypeResult,
        manufacturerResult,
        brandResult,
        modelResult,
        currencyResult,
        listingStatusResult,
    ] = await Promise.all([
        client.query({
            text: `SELECT product_type_id FROM public.product_types WHERE product_type_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            values: [product_type_uuid],
        }),
        client.query({
            text: `SELECT manufacturer_id FROM public.manufacturer WHERE manufacturer_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            values: [manufacturer_uuid],
        }),
        client.query({
            text: `SELECT brand_id FROM public.brand WHERE brand_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            values: [brand_uuid],
        }),
        client.query({
            text: `SELECT model_id FROM public.model WHERE model_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            values: [model_uuid],
        }),
        client.query({
            text: `SELECT currency_id FROM public.currency WHERE currency_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            values: [currency_uuid],
        }),
        client.query({
            text: `SELECT product_listing_status_id FROM public.product_listing_status WHERE product_listing_status_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            values: [product_listing_status_uuid],
        }),
    ]);

    if (productTypeResult.rowCount === 0)    throw { code: 2001, error: "Invalid Product Type UUID" };
    if (manufacturerResult.rowCount === 0)   throw { code: 2001, error: "Invalid Manufacturer UUID" };
    if (brandResult.rowCount === 0)          throw { code: 2001, error: "Invalid Brand UUID" };
    if (modelResult.rowCount === 0)          throw { code: 2001, error: "Invalid Model UUID" };
    if (currencyResult.rowCount === 0)       throw { code: 2001, error: "Invalid Currency UUID" };
    if (listingStatusResult.rowCount === 0)  throw { code: 2001, error: "Invalid Product Listing Status UUID" };

    const resolved = {
        product_type_id:           productTypeResult.rows[0].product_type_id,
        manufacturer_id:           manufacturerResult.rows[0].manufacturer_id,
        brand_id:                  brandResult.rows[0].brand_id,
        model_id:                  modelResult.rows[0].model_id,
        currency_id:               currencyResult.rows[0].currency_id,
        product_listing_status_id: listingStatusResult.rows[0].product_listing_status_id,
        uom_id:                    null,
        condition_id:              null,
        group_id:                  null,
        sub_group_id:              null,
        sub_node_id:               null,
        trading_type_ids:          [],
    };

    // ---------- Optional parallel lookups ----------
    const optionalLookups = [];

    if (uom_uuid) {
        optionalLookups.push(
            client.query({
                text: `SELECT uom_id FROM public.uom WHERE uom_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
                values: [uom_uuid],
            }).then(r => {
                if (r.rowCount === 0) throw { code: 2001, error: "Invalid UOM UUID" };
                resolved.uom_id = r.rows[0].uom_id;
            })
        );
    }

    if (condition_uuid) {
        optionalLookups.push(
            client.query({
                text: `SELECT condition_id FROM public.product_conditions WHERE condition_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
                values: [condition_uuid],
            }).then(r => {
                if (r.rowCount === 0) throw { code: 2001, error: "Invalid Condition UUID" };
                resolved.condition_id = r.rows[0].condition_id;
            })
        );
    }

    if (group_uuid) {
        optionalLookups.push(
            client.query({
                text: `SELECT group_id FROM public.groups WHERE group_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
                values: [group_uuid],
            }).then(r => {
                if (r.rowCount === 0) throw { code: 2001, error: "Invalid Group UUID" };
                resolved.group_id = r.rows[0].group_id;
            })
        );
    }

    if (sub_group_uuid) {
        optionalLookups.push(
            client.query({
                text: `SELECT sub_group_id FROM public.sub_groups WHERE sub_group_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
                values: [sub_group_uuid],
            }).then(r => {
                if (r.rowCount === 0) throw { code: 2001, error: "Invalid Sub Group UUID" };
                resolved.sub_group_id = r.rows[0].sub_group_id;
            })
        );
    }

    if (sub_node_uuid) {
        optionalLookups.push(
            client.query({
                text: `SELECT sub_node_id FROM public.sub_nodes WHERE sub_node_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
                values: [sub_node_uuid],
            }).then(r => {
                if (r.rowCount === 0) throw { code: 2001, error: "Invalid Sub Node UUID" };
                resolved.sub_node_id = r.rows[0].sub_node_id;
            })
        );
    }

    // Trading types — batch resolve
    const trading_type_uuid_list = Array.isArray(trading_type_uuid)
        ? trading_type_uuid
        : trading_type_uuid ? [trading_type_uuid] : [];

    if (trading_type_uuid_list.length > 0) {
        optionalLookups.push(
            client.query({
                text: `SELECT trading_type_id FROM public.trading_types WHERE trading_type_uuid = ANY($1::uuid[]) AND is_deleted = FALSE AND is_active = TRUE`,
                values: [trading_type_uuid_list],
            }).then(r => {
                if (r.rowCount !== trading_type_uuid_list.length)
                    throw { code: 2001, error: "One or more Trading Type UUIDs are invalid" };
                resolved.trading_type_ids = r.rows.map(row => row.trading_type_id);
            })
        );
    }

    await Promise.all(optionalLookups);
    return resolved;
}


/**
 * Checks SKU / OEM uniqueness — excludes the current product being updated.
 */
async function checkUpdateDuplicates(client, { sku, oem_part_number, product_id, seller_id }) {
    const [skuCheck, oemCheck] = await Promise.all([
        client.query({
            text: `SELECT 1 FROM public.products
                   WHERE LOWER(sku) = LOWER($1)
                     AND product_id != $2
                     AND is_deleted = FALSE LIMIT 1`,
            values: [sku.trim(), product_id],
        }),
        client.query({
            text: `SELECT 1 FROM public.products
                   WHERE LOWER(oem_part_number) = LOWER($1)
                     AND seller_id = $2          -- ← per seller
                     AND product_id != $3        -- ← exclude self
                     AND is_deleted = FALSE LIMIT 1`,
            values: [oem_part_number.trim(), seller_id, product_id],
        }),
    ]);
    if (skuCheck.rowCount > 0) throw { code: 2002, error: "A product with this SKU already exists" };
    if (oemCheck.rowCount > 0) throw { code: 2002, error: "A product with this OEM part number already exists for this seller" };
}


/**
 * 3-way image sync:
 *   - Existing path (/assets/products/...) → retain
 *   - New file path (/tmp/...) → move + rename
 *   - DB rows not in payload → soft-delete
 */
async function syncImages(client, { product_id, images, product_code, modified_by, now }) {
    const assigned_to = modified_by;
    const assigned_at = now;

    // Fetch existing image rows from DB
    const existingResult = await client.query({
        text: `SELECT product_image_id, image_url FROM public.product_images
               WHERE product_id = $1 AND is_deleted = FALSE`,
        values: [product_id],
    });
    const existingImages = existingResult.rows; // [{ product_image_id, image_url }]

    // Process incoming images — move new files, retain existing
    const processedImages = await Promise.all(
        images.map(async (filePath, index) => {
            if (filePath.startsWith("/assets/products/")) {
                // Existing image — retain, just update sort_order
                return {
                    url:        filePath,
                    image_type: index === 0 ? "PRIMARY" : "SECONDARY",
                    sort_order: index + 1,
                    isExisting: true,
                };
            }
            // New upload — move file
            const ext      = path.extname(filePath).toLowerCase();
            const destName = `${product_code}_${randomUUID()}${ext}`;
            const destPath = path.join(uploadDir, destName);
            await fse.move(filePath, destPath, { overwrite: true });
            return {
                url:        `/assets/products/${destName}`,
                image_type: index === 0 ? "PRIMARY" : "SECONDARY",
                sort_order: index + 1,
                isExisting: false,
            };
        })
    );

    const incomingUrls = processedImages.map(img => img.url);

    // CASE 1 — DB rows not in incoming payload → soft-delete
    for (const dbImg of existingImages) {
        if (!incomingUrls.includes(dbImg.image_url)) {
            await client.query({
                text: `UPDATE public.product_images
                       SET is_deleted  = TRUE,
                           is_active   = FALSE,
                           deleted_at  = $1,
                           deleted_by  = $2,
                           modified_at = $1,
                           modified_by = $2
                       WHERE product_image_id = $3`,
                values: [now, modified_by, dbImg.product_image_id],
            });
        }
    }

    // CASE 2 — Existing retained → update sort_order + image_type
    // CASE 3 — New → insert fresh row
    for (const img of processedImages) {
        const existingRow = existingImages.find(e => e.image_url === img.url);

        if (existingRow) {
            // CASE 2 — update sort_order and image_type only
            await client.query({
                text: `UPDATE public.product_images
                       SET sort_order  = $1,
                           image_type  = $2,
                           modified_at = $3,
                           modified_by = $4
                       WHERE product_image_id = $5`,
                values: [img.sort_order, img.image_type, now, modified_by, existingRow.product_image_id],
            });
        } else {
            // CASE 3 — insert new row
            await client.query({
                text: `INSERT INTO public.product_images
                           (product_id, image_url, image_type, sort_order, assigned_to, assigned_at, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                values: [product_id, img.url, img.image_type, img.sort_order, assigned_to, assigned_at, modified_by],
            });
        }
    }
}


/**
 * Conditional price history update:
 * Only triggers if price or price_after_sale has changed.
 * Closes previous active record (effective_to = now), inserts new record.
 */
async function syncPriceHistory(client, {
    product_id,
    newPrice,
    newPriceAfterSale,
    currency_id,
    existingProduct,
    modified_by,
    now,
}) {
    const assigned_to = modified_by;
    const assigned_at = now;

    const priceChanged =
        Number(newPrice)         !== Number(existingProduct.price) ||
        Number(newPriceAfterSale) !== Number(existingProduct.price_after_sale);

    if (!priceChanged) return; // No price change — skip

    // Close the previous active price history record
    await client.query({
        text: `UPDATE public.product_price_history
               SET effective_to = $1,
                   modified_at  = $1,
                   modified_by  = $2
               WHERE product_id   = $3
                 AND effective_to IS NULL
                 AND is_deleted   = FALSE`,
        values: [now, modified_by, product_id],
    });

    // Insert new price history record
    await client.query({
        text: `INSERT INTO public.product_price_history (
                   product_id,
                   price,
                   price_after_sale,
                   currency_id,
                   effective_from,
                   effective_to,
                   reason,
                   assigned_to,
                   assigned_at,
                   created_by
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        values: [
            product_id,
            Number(newPrice),
            Number(newPriceAfterSale),
            currency_id,
            now,
            null,
            "Price updated by seller",
            assigned_to,
            assigned_at,
            modified_by,
        ],
    });
}


/**
 * Releases the edit lock after a successful update.
 */
async function releaseEditLock(client, { product_uuid, modified_by, now }) {
    await client.query({
        text: `UPDATE public.record_locks
               SET is_deleted = TRUE,
                   deleted_by = $1,
                   deleted_at = $2
               WHERE table_name = 'products'
                 AND record_id  = $3
                 AND locked_by  = $1
                 AND is_deleted = FALSE`,
        values: [modified_by, now, product_uuid],
    });
}


// --------------------------------------------------
// RESPONDER
// --------------------------------------------------

responder.on("update-product", async (req, cb) => {
    const client = await pool.connect();

    try {
        const params = { product_uuid: req.product_uuid };
        const body   = req.body;
        const now    = new Date();

        // --------------------------------------------------
        // 1. VALIDATE INPUTS
        // --------------------------------------------------
        const validation = validateUpdateSellerProductInput(params, body);
        if (!validation.valid) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              validation.error,
            });
        }

        // --------------------------------------------------
        // 1.5 IMAGE VALIDATION
        // --------------------------------------------------
        const imageValidation = await validateUpdateImages(body.images);
        if (!imageValidation.valid) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Image validation failed",
                error:              imageValidation.error,
            });
        }

        await client.query("BEGIN");

        const { product_uuid }  = params;
        const { modified_by }   = body;
        const assigned_to       = modified_by;
        const assigned_at       = now;

        // --------------------------------------------------
        // 2. CHECK EDIT LOCK
        // --------------------------------------------------
        try {
            await checkEditLock(client, { product_uuid, modified_by });
        } catch (lockErr) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               lockErr.code || 2005,
                message:            "Update failed",
                error:              lockErr.error,
            });
        }

        // --------------------------------------------------
        // 3. FETCH EXISTING PRODUCT
        // --------------------------------------------------
        let existingProduct;
        try {
            existingProduct = await fetchExistingProduct(client, product_uuid);
        } catch (fetchErr) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               fetchErr.code || 2003,
                message:            "Record not found",
                error:              fetchErr.error,
            });
        }
        const { product_id, code: product_code, seller_id } = existingProduct;

        // --------------------------------------------------
        // 4. RESOLVE UUIDs → IDs
        // --------------------------------------------------
        let resolved;
        try {
            resolved = await resolveUpdateIds(client, body);
        } catch (resolveErr) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               resolveErr.code || 2001,
                message:            "Validation failed",
                error:              resolveErr.error,
            });
        }

        // --------------------------------------------------
        // 5. DUPLICATE CHECKS (exclude self)
        // --------------------------------------------------
        try {
            await checkUpdateDuplicates(client, {
                sku:             body.sku,
                oem_part_number: body.oem_part_number,
                product_id:      product_id,
                seller_id:       seller_id,
            });
        } catch (dupErr) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               dupErr.code || 2002,
                message:            "Duplicate entry",
                error:              dupErr.error,
            });
        }

        const {
            product_type_id,
            manufacturer_id,
            brand_id,
            model_id,
            currency_id,
            product_listing_status_id,
            uom_id,
            condition_id,
            group_id,
            sub_group_id,
            sub_node_id,
            trading_type_ids,
        } = resolved;

        const {
            name,
            sku,
            oem_part_number,
            aftermarket_number,
            equivalent_oem_part_numbers,
            manufacturer_name,
            barcode_number,
            weight,
            dimension_length,
            dimension_width,
            dimension_height,
            material_type,
            used_years,
            item_description,
            listing_remarks,
            upload_method,
            price,
            price_after_sale,
            price_effective_from,
            images,
        } = body;

        const trading_type_jsonb = trading_type_ids.length > 0
            ? JSON.stringify(trading_type_ids)
            : null;

        const oem_equiv_jsonb = Array.isArray(equivalent_oem_part_numbers) && equivalent_oem_part_numbers.length > 0
            ? JSON.stringify(equivalent_oem_part_numbers)
            : null;

        // --------------------------------------------------
        // 6. UPDATE products
        // --------------------------------------------------
        
        const productUpdate = await client.query({
    text: `
        UPDATE public.products SET
            name                      = $1,   
            sku                       = $2,
            product_type_id           = $3,
            oem_part_number           = $4,
            aftermarket_number        = $5,
            equivalent_oem_part_numbers = $6,
            trading_type_id           = $7,
            manufacturer_id           = $8,
            manufacturer_name         = $9,
            barcode_number            = $10,
            brand_id                  = $11,
            model_id                  = $12,
            group_id                  = $13,
            sub_group_id              = $14,
            sub_node_id               = $15,
            weight                    = $16,
            price                     = $17,
            price_after_sale          = $18,
            price_effective_from      = $19,
            currency_id               = $20,
            dimension_length          = $21,
            dimension_width           = $22,
            dimension_height          = $23,
            uom_id                    = $24,
            material_type             = $25,
            condition_id              = $26,
            used_years                = $27,
            item_description          = $28,
            product_listing_status_id = $29,
            upload_method             = $30,
            modified_by               = $31,
            modified_at               = $32
        WHERE product_uuid = $33
          AND is_deleted   = FALSE
        RETURNING product_id, product_uuid, code, sku
    `,
    values: [
        name.trim(),                // $1  name          
        sku.trim(),                 // $2  sku
        product_type_id,            // $3  product_type_id
        oem_part_number.trim(),     // $4  oem_part_number
        aftermarket_number || null, // $5  aftermarket_number
        oem_equiv_jsonb,            // $6  equivalent_oem_part_numbers
        trading_type_jsonb,         // $7  trading_type_id
        manufacturer_id,            // $8  manufacturer_id
        manufacturer_name,          // $9  manufacturer_name
        barcode_number,             // $10 barcode_number
        brand_id,                   // $11 brand_id
        model_id,                   // $12 model_id
        group_id,                   // $13 group_id
        sub_group_id,               // $14 sub_group_id
        sub_node_id,                // $15 sub_node_id
        weight,                     // $16 weight
        Number(price),              // $17 price
        Number(price_after_sale),   // $18 price_after_sale
        price_effective_from || now,// $19 price_effective_from
        currency_id,                // $20 currency_id
        dimension_length,           // $21 dimension_length
        dimension_width,            // $22 dimension_width
        dimension_height,           // $23 dimension_height
        uom_id,                     // $24 uom_id
        material_type,              // $25 material_type
        condition_id,               // $26 condition_id
        used_years,                 // $27 used_years
        item_description,           // $28 item_description
        product_listing_status_id,  // $29 product_listing_status_id
        upload_method.trim(),       // $30 upload_method
        modified_by,                // $31 modified_by
        now,                        // $32 modified_at
        product_uuid,               // $33 WHERE
    ],
});

        // --------------------------------------------------
        // 7. SYNC product_images (3-way)
        // --------------------------------------------------
        await syncImages(client, {
            product_id,
            images,
            product_code,
            modified_by,
            now,
        });

        // --------------------------------------------------
        // 8. SYNC product_price_history (conditional)
        // --------------------------------------------------
        await syncPriceHistory(client, {
            product_id,
            newPrice:         price,
            newPriceAfterSale: price_after_sale,
            currency_id,
            existingProduct,
            modified_by,
            now,
        });

        // --------------------------------------------------
        // 9. UPSERT oem_equivalents (conditional)
        // --------------------------------------------------
        if (oem_equiv_jsonb) {
            await client.query({
                text: `
                    INSERT INTO public.oem_equivalents (
                        oem_part_number,
                        equivalent_oem_part_numbers,
                        assigned_to,
                        assigned_at,
                        created_by
                    ) VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (oem_part_number)
                    DO UPDATE SET
                        equivalent_oem_part_numbers = EXCLUDED.equivalent_oem_part_numbers,
                        modified_at                 = NOW(),
                        modified_by                 = EXCLUDED.created_by
                `,
                values: [
                    oem_part_number.trim(),
                    oem_equiv_jsonb,
                    assigned_to,
                    assigned_at,
                    modified_by,
                ],
            });
        }

        // --------------------------------------------------
        // 10. RELEASE EDIT LOCK
        // --------------------------------------------------
        await releaseEditLock(client, { product_uuid, modified_by, now });

        await client.query("COMMIT");

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Product updated successfully",
            data:               { ...productUpdate.rows[0] },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (update-seller-product):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// UPDATE SELLER INVENTORY
// --------------------------------------------------

// ==========================================================
// Updates onhand_qty, buffer_qty, reorder_level, bin_loc
// for an existing seller_inventory record.
// Also records a stock history entry (ADJUSTMENT).
// ==========================================================

responder.on("update-seller-inventory", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { inventory_uuid } = req;
        const {
            modified_by,
            onhand_qty,
            buffer_qty,
            reorder_level,
            bin_loc,
            reason,
        } = req.body;

        const now         = new Date();
        const assigned_to = modified_by;
        const assigned_at = now;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!inventory_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Inventory UUID is required" });

        if (!modified_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "modified_by is required" });

        if (onhand_qty === undefined || onhand_qty === null || isNaN(Number(onhand_qty)))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Valid onhand_qty is required" });

        if (Number(onhand_qty) < 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "onhand_qty cannot be negative" });

        if (!reason?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Reason is required for inventory update" });

        await client.query("BEGIN");

        // --------------------------------------------------
        // 2. CHECK EDIT LOCK
        // --------------------------------------------------
        const lockCheck = await client.query({
            text: `SELECT 1 FROM public.record_locks
                   WHERE table_name = 'seller_inventory'
                     AND record_id  = $1
                     AND locked_by  = $2
                     AND is_deleted = FALSE
                     AND expires_at > NOW()`,
            values: [inventory_uuid, modified_by],
        });
        if (lockCheck.rowCount === 0) {
            await client.query("ROLLBACK");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2005, message: "Update failed", error: "You must lock the record before updating" });
        }

        // --------------------------------------------------
        // 3. FETCH EXISTING INVENTORY ROW
        // --------------------------------------------------
        const existingResult = await client.query({
            text: `SELECT inventory_id, product_id, warehouse_id, seller_id, onhand_qty, reserved_qty
                   FROM public.seller_inventory
                   WHERE inventory_uuid = $1 AND is_deleted = FALSE`,
            values: [inventory_uuid],
        });
        if (existingResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No inventory record found with the provided UUID" });
        }

        const {
            inventory_id,
            product_id,
            warehouse_id,
            onhand_qty: old_onhand_qty,
        } = existingResult.rows[0];

        const newQty      = Number(onhand_qty);
        const oldQty      = Number(old_onhand_qty);
        const qtyChanged  = newQty - oldQty;                          // +ve = IN, -ve = OUT
        const movementType = qtyChanged >= 0 ? "IN" : "OUT";

        // --------------------------------------------------
        // 4. UPDATE seller_inventory
        // --------------------------------------------------
        const inventoryUpdate = await client.query({
            text: `
                UPDATE public.seller_inventory SET
                    onhand_qty   = $1,
                    buffer_qty   = $2,
                    reorder_level = $3,
                    bin_loc      = $4,
                    modified_by  = $5,
                    modified_at  = $6
                WHERE inventory_uuid = $7
                  AND is_deleted     = FALSE
                RETURNING inventory_id, inventory_uuid, onhand_qty, reserved_qty, buffer_qty
            `,
            values: [
                newQty,
                buffer_qty    !== undefined ? Number(buffer_qty)    : null,
                reorder_level !== undefined ? Number(reorder_level) : null,
                bin_loc       || null,
                modified_by,
                now,
                inventory_uuid,
            ],
        });

        // --------------------------------------------------
        // 5. INSERT product_stock_history (always on qty change)
        // --------------------------------------------------
        if (qtyChanged !== 0) {
            await client.query({
                text: `
                    INSERT INTO public.product_stock_history (
                        product_id,
                        warehouse_id,
                        movement_type,
                        quantity_before,
                        quantity_changed,
                        quantity_after,
                        reason,
                        reference_type,
                        reference_id,
                        notes,
                        assigned_to,
                        assigned_at,
                        created_by
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                `,
                values: [
                    product_id,
                    warehouse_id,
                    movementType,
                    oldQty,
                    Math.abs(qtyChanged),
                    newQty,
                    reason.trim(),
                    "INVENTORY_UPDATE",
                    inventory_id,
                    `Stock ${movementType === "IN" ? "increased" : "decreased"} from ${oldQty} to ${newQty}`,
                    assigned_to,
                    assigned_at,
                    modified_by,
                ],
            });
        }

        // --------------------------------------------------
        // 6. RELEASE EDIT LOCK
        // --------------------------------------------------
        await client.query({
            text: `UPDATE public.record_locks
                   SET is_deleted = TRUE,
                       deleted_by = $1,
                       deleted_at = $2
                   WHERE table_name = 'seller_inventory'
                     AND record_id  = $3
                     AND locked_by  = $1
                     AND is_deleted = FALSE`,
            values: [modified_by, now, inventory_uuid],
        });

        await client.query("COMMIT");

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Inventory updated successfully",
            data:               { ...inventoryUpdate.rows[0] },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (update-seller-inventory):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// CREATE STOCK ADJUSTMENT
// --------------------------------------------------

// ==========================================================
// Manual stock adjustment — IN or OUT — by seller/admin.
// Directly updates seller_inventory + logs stock history.
// Use cases: damaged goods, write-off, found stock, returns.
// ==========================================================

responder.on("create-stock-adjustment", async (req, cb) => {
    const client = await pool.connect();

    try {
        const {
            inventory_uuid,
            movement_type,     // "IN" | "OUT"
            quantity_changed,
            reason,
            notes,
            reference_type,    // e.g. "RETURN", "DAMAGE", "WRITE_OFF", "FOUND", "MANUAL"
            reference_id,      // optional — linked order/return/document ID
            created_by,
        } = req.body;

        const now         = new Date();
        const assigned_to = created_by;
        const assigned_at = now;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!inventory_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Inventory UUID is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created by is required" });

        if (!["IN", "OUT"].includes(movement_type))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "movement type must be 'IN' or 'OUT'" });

        if (quantity_changed === undefined || quantity_changed === null || isNaN(Number(quantity_changed)))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Valid quantity changed is required" });

        if (Number(quantity_changed) <= 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "quantity changed must be greater than 0" });

        if (!reason?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Reason is required" });

        const validReferenceTypes = ["RETURN", "DAMAGE", "WRITE_OFF", "FOUND", "MANUAL", "ORDER"];
        if (reference_type && !validReferenceTypes.includes(reference_type))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `reference_type must be one of: ${validReferenceTypes.join(", ")}` });

        await client.query("BEGIN");

        // --------------------------------------------------
        // 2. FETCH EXISTING INVENTORY ROW
        // --------------------------------------------------
        const existingResult = await client.query({
            text: `SELECT inventory_id, product_id, warehouse_id, seller_id, onhand_qty, reserved_qty
                   FROM public.seller_inventory
                   WHERE inventory_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            values: [inventory_uuid],
        });
        if (existingResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active inventory record found with the provided UUID" });
        }

        const {
            inventory_id,
            product_id,
            warehouse_id,
            onhand_qty: current_onhand_qty,
            reserved_qty,
        } = existingResult.rows[0];

        const qty          = Number(quantity_changed);
        const currentQty   = Number(current_onhand_qty);
        const reservedQty  = Number(reserved_qty);

        // --------------------------------------------------
        // 3. STOCK FLOOR CHECK — OUT cannot go below reserved_qty
        // --------------------------------------------------
        if (movement_type === "OUT") {
            const availableQty = currentQty - reservedQty;
            if (qty > availableQty) {
                await client.query("ROLLBACK");
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2006,
                    message:            "Insufficient stock",
                    error:              `Cannot remove ${qty} units. Available (non-reserved) stock is ${availableQty}`,
                });
            }
        }

        // --------------------------------------------------
        // 4. COMPUTE NEW QTY
        // --------------------------------------------------
        const newQty = movement_type === "IN"
            ? currentQty + qty
            : currentQty - qty;

        // --------------------------------------------------
        // 5. UPDATE seller_inventory
        // --------------------------------------------------
        const inventoryUpdate = await client.query({
            text: `
                UPDATE public.seller_inventory SET
                    onhand_qty  = $1,
                    modified_by = $2,
                    modified_at = $3
                WHERE inventory_uuid = $4
                  AND is_deleted     = FALSE
                RETURNING inventory_id, inventory_uuid, onhand_qty, reserved_qty, buffer_qty
            `,
            values: [newQty, created_by, now, inventory_uuid],
        });

        // --------------------------------------------------
        // 6. INSERT product_stock_history
        // --------------------------------------------------
        const stockHistoryInsert = await client.query({
            text: `
                INSERT INTO public.product_stock_history (
                    product_id,
                    warehouse_id,
                    movement_type,
                    quantity_before,
                    quantity_changed,
                    quantity_after,
                    reason,
                    reference_type,
                    reference_id,
                    notes,
                    assigned_to,
                    assigned_at,
                    created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING stock_history_id, stock_history_uuid
            `,
            values: [
                product_id,
                warehouse_id,
                movement_type,
                currentQty,
                qty,
                newQty,
                reason.trim(),
                reference_type  || "MANUAL",
                reference_id    || null,
                notes           || null,
                assigned_to,
                assigned_at,
                created_by,
            ],
        });

        await client.query("COMMIT");

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Stock adjustment recorded successfully",
            data: {
                ...inventoryUpdate.rows[0],
                stock_history: { ...stockHistoryInsert.rows[0] },
            },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (create-stock-adjustment):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// GET BY ID —  PRODUCT (with edit locking)
// --------------------------------------------------

responder.on("getById-product", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { product_uuid } = req;
        const mode    = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!product_uuid) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Product UUID is required",
            });
        }

        await client.query("BEGIN");

        // --------------------------------------------------
        // 2. FETCH PRODUCT WITH ALL JOINS
        // --------------------------------------------------
        const result = await client.query(
            `
            SELECT
                -- Core product fields
                p.product_id,
                p.product_uuid,
                p.code,
                p.name,
                p.sku,
                p.oem_part_number,
                p.aftermarket_number,
                p.equivalent_oem_part_numbers,
                p.trading_type_id,
                p.manufacturer_name,
                p.barcode_number,
                p.verify_status,
                p.verified_from,
                p.weight,
                p.price,
                p.price_after_sale,
                p.price_effective_from,
                p.dimension_length,
                p.dimension_width,
                p.dimension_height,
                p.material_type,
                p.used_years,
                p.item_description,
                p.listing_remarks,
                p.upload_method,
                p.is_listed,
                p.is_active,
                p.assigned_to,
                p.assigned_at,
                p.created_at,
                p.created_by,
                p.modified_at,
                p.modified_by,
                p.deleted_at,
                p.deleted_by,
                p.is_deleted,

                -- Seller
                p.seller_id,
                sa.seller_uuid,
                sa.business_name            AS seller_name,

                -- Product Type
                p.product_type_id,
                pt.product_type_uuid,
                pt.name                     AS product_type_name,

                -- Manufacturer
                p.manufacturer_id,
                mf.manufacturer_uuid,
                mf.name                     AS manufacturer_ref_name,

                -- Brand
                p.brand_id,
                br.brand_uuid,
                br.name                     AS brand_name,

                -- Model
                p.model_id,
                mo.model_uuid,
                mo.name                     AS model_name,

                -- Group / Sub Group / Sub Node
                p.group_id,
                grp.group_uuid,
                grp.name                    AS group_name,

                p.sub_group_id,
                sg.sub_group_uuid,
                sg.name                     AS sub_group_name,

                p.sub_node_id,
                sn.sub_node_uuid,
                sn.name                     AS sub_node_name,

                -- Currency
                p.currency_id,
                cur.currency_uuid,
                cur.code                    AS currency_code,
                cur.symbol                  AS currency_symbol,

                -- UOM
                p.uom_id,
                u.uom_uuid,
                u.name                      AS uom_name,
                u.symbol                    AS uom_symbol,

                -- Condition
                p.condition_id,
                pc.condition_uuid,
                pc.name                     AS condition_name,

                -- Product Listing Status
                p.product_listing_status_id,
                pls.product_listing_status_uuid,
                pls.name                    AS listing_status_name,

                -- Product Images (aggregated)
                COALESCE(
                    (
                        SELECT json_agg(
                            json_build_object(
                                'product_image_id',   pi.product_image_id,
                                'product_image_uuid', pi.product_image_uuid,
                                'image_url',          pi.image_url,
                                'image_type',         pi.image_type,
                                'sort_order',         pi.sort_order
                            )
                            ORDER BY pi.sort_order ASC
                        )
                        FROM public.product_images pi
                        WHERE pi.product_id = p.product_id
                          AND pi.is_deleted = FALSE
                          AND pi.is_active  = TRUE
                    ),
                    '[]'
                )                           AS images,

                -- OEM Equivalents
                oe.oem_uuid,
                oe.equivalent_oem_part_numbers AS oem_equivalents,

                -- Active Price History (current)
                (
                    SELECT json_build_object(
                        'price',            ph.price,
                        'price_after_sale', ph.price_after_sale,
                        'effective_from',   ph.effective_from,
                        'effective_to',     ph.effective_to
                    )
                    FROM public.product_price_history ph
                    WHERE ph.product_id   = p.product_id
                      AND ph.effective_to IS NULL
                      AND ph.is_deleted   = FALSE
                    LIMIT 1
                )                           AS current_price,

                -- Inventory (aggregated across inventory_details)
                COALESCE(
                    (
                        SELECT json_agg(
                            json_build_object(
                                'inventory_uuid', si.inventory_uuid,
                                'warehouse_id',   si.warehouse_id,
                                'warehouse_name', sw.warehouse_name,
                                'onhand_qty',     si.onhand_qty,
                                'reserved_qty',   si.reserved_qty,
                                'buffer_qty',     si.buffer_qty,
                                'bin_loc',        si.bin_loc,
                                'reorder_level',  si.reorder_level
                            )
                        )
                        FROM public.seller_inventory si
                        LEFT JOIN public.seller_warehouse sw ON sw.warehouse_id = si.warehouse_id
                        WHERE si.product_id = p.product_id
                          AND si.seller_id  = p.seller_id
                          AND si.is_deleted = FALSE
                          AND si.is_active  = TRUE
                    ),
                    '[]'
                )                           AS inventory,

                -- Audit: created_by / modified_by usernames
                creators.username           AS created_by_name,
                updaters.username           AS modified_by_name

            FROM public.products p

            LEFT JOIN public.seller_accounts          sa  ON sa.seller_id                = p.seller_id
            LEFT JOIN public.product_types            pt  ON pt.product_type_id          = p.product_type_id
            LEFT JOIN public.manufacturer             mf  ON mf.manufacturer_id          = p.manufacturer_id
            LEFT JOIN public.brand                   br  ON br.brand_id                 = p.brand_id
            LEFT JOIN public.model                   mo  ON mo.model_id                 = p.model_id
            LEFT JOIN public.groups                   grp ON grp.group_id                = p.group_id
            LEFT JOIN public.sub_groups               sg  ON sg.sub_group_id             = p.sub_group_id
            LEFT JOIN public.sub_nodes                sn  ON sn.sub_node_id              = p.sub_node_id
            LEFT JOIN public.currency               cur ON cur.currency_id             = p.currency_id
            LEFT JOIN public.uom                      u   ON u.uom_id                    = p.uom_id
            LEFT JOIN public.product_conditions       pc  ON pc.condition_id             = p.condition_id
            LEFT JOIN public.product_listing_status pls ON pls.product_listing_status_id = p.product_listing_status_id
            LEFT JOIN public.oem_equivalents          oe  ON oe.oem_part_number          = p.oem_part_number
                                                         AND oe.is_deleted               = FALSE
            LEFT JOIN public.users                creators ON creators.user_uuid          = p.created_by
            LEFT JOIN public.users                updaters ON updaters.user_uuid          = p.modified_by

            WHERE p.product_uuid = $1
              AND p.is_deleted   = FALSE
            `,
            [product_uuid]
        );

        // --------------------------------------------------
        // 3. CHECK IF RECORD EXISTS
        // --------------------------------------------------
        if (result.rowCount === 0) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No product found with the provided UUID",
            });
        }

        const product = result.rows[0];

        // --------------------------------------------------
        // 4. LOCK HANDLING (edit mode only)
        // --------------------------------------------------
        let lockRow = null;

        if (mode === "edit") {

            if (!user_id) {
                await client.query("ROLLBACK");
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            "Validation failed",
                    error:              "user_id is required for edit mode",
                });
            }

            // Check existing lock
            const lockRes = await client.query(
                `SELECT rl.*, u.username AS locked_by_name
                 FROM public.record_locks rl
                 LEFT JOIN public.users u ON u.user_uuid = rl.locked_by
                 WHERE rl.table_name = 'products'
                   AND rl.record_id  = $1
                   AND rl.is_deleted = FALSE`,
                [product_uuid]
            );

            lockRow = lockRes.rows[0] || null;

            const isExpired = lockRow && new Date(lockRow.expires_at).getTime() < Date.now();

            // Locked by another active user
            if (lockRow && lockRow.locked_by !== user_id && !isExpired) {
                await client.query("ROLLBACK");
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2005,
                    message:            `Record is locked by ${lockRow.locked_by_name}`,
                });
            }

            // Lock expired → clear it
            if (lockRow && isExpired) {
                await client.query(
                    `UPDATE public.record_locks
                     SET is_deleted = TRUE,
                         deleted_by = $1,
                         deleted_at = NOW()
                     WHERE lock_id = $2`,
                    [user_id, lockRow.lock_id]
                );
                lockRow = null;
            }

            // No lock exists → create new lock
            if (!lockRow) {
                const newLock = await client.query(
                    `INSERT INTO public.record_locks (
                        table_name, record_id, locked_by, expires_at, created_by
                    ) VALUES (
                        'products', $1, $2,
                        NOW() + ($3 || ' minute')::INTERVAL, $2
                    )
                    RETURNING *`,
                    [product_uuid, user_id, LOCK_MINUTES]
                );
                lockRow = newLock.rows[0];
            }
            // Same user → refresh lock
            else if (lockRow.locked_by === user_id) {
                const refresh = await client.query(
                    `UPDATE public.record_locks
                     SET expires_at = NOW() + ($2 || ' minute')::INTERVAL
                     WHERE lock_id  = $1
                     RETURNING *`,
                    [lockRow.lock_id, LOCK_MINUTES]
                );
                lockRow = refresh.rows[0];
            }
        }

        await client.query("COMMIT");

        // --------------------------------------------------
        // 5. FINAL LOCK STATUS + RESPONSE
        // --------------------------------------------------
        product.lock_status = lockRow
            ? new Date(lockRow.expires_at).getTime() >= Date.now()
            : false;

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Product fetched successfully",
            data:               product,
            lock: lockRow
                ? {
                    status:     product.lock_status,
                    by:         lockRow.locked_by,
                    by_name:    lockRow.locked_by_name,
                    expires_at: lockRow.expires_at,
                }
                : { status: false },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (getById-seller-product):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Fetch failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});


// --------------------------------------------------
// GET BY ID — SELLER INVENTORY (with edit locking)
// --------------------------------------------------

responder.on("getById-seller-inventory", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { inventory_uuid } = req;
        const mode    = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!inventory_uuid) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Inventory UUID is required",
            });
        }

        await client.query("BEGIN");

        // --------------------------------------------------
        // 2. FETCH INVENTORY WITH ALL JOINS
        // --------------------------------------------------
        const result = await client.query(
            `
            SELECT
                -- Core inventory fields
                si.inventory_id,
                si.inventory_uuid,
                si.onhand_qty,
                si.reserved_qty,
                si.buffer_qty,
                si.bin_loc,
                si.reorder_level,
                si.is_active,
                si.assigned_to,
                si.assigned_at,
                si.created_at,
                si.created_by,
                si.modified_at,
                si.modified_by,
                si.deleted_at,
                si.deleted_by,
                si.is_deleted,

                -- Seller
                si.seller_id,
                sa.seller_uuid,
                sa.business_name            AS seller_name,

                -- Warehouse
                si.warehouse_id,
                sw.warehouse_uuid,
                sw.warehouse_name                     AS warehouse_name,
                sw.warehouse_address                 ,
                sw.warehouse_map_address, 
                -- Product (summary)
                si.product_id,
                p.product_uuid,
                p.code                      AS product_code,
                p.sku,
                p.oem_part_number,
                p.price,
                p.price_after_sale,
                p.is_listed,

                -- Product Type
                pt.product_type_uuid,
                pt.name                     AS product_type_name,

                -- Brand
                br.brand_uuid,
                br.name                     AS brand_name,

                -- Model
                mo.model_uuid,
                mo.name                     AS model_name,

                -- Product Images (primary only)
                (
                    SELECT pi.image_url
                    FROM public.product_images pi
                    WHERE pi.product_id = p.product_id
                      AND pi.image_type = 'PRIMARY'
                      AND pi.is_deleted = FALSE
                      AND pi.is_active  = TRUE
                    LIMIT 1
                )                           AS primary_image,

                -- Recent stock history (last 10 movements)
                COALESCE(
                    (
                        SELECT json_agg(history_rows)
                        FROM (
                            SELECT
                                psh.stock_history_uuid,
                                psh.movement_type,
                                psh.quantity_before,
                                psh.quantity_changed,
                                psh.quantity_after,
                                psh.reason,
                                psh.reference_type,
                                psh.reference_id,
                                psh.notes,
                                psh.created_at,
                                u.username AS created_by_name
                            FROM public.product_stock_history psh
                            LEFT JOIN public.users u ON u.user_uuid = psh.created_by
                            WHERE psh.product_id   = si.product_id
                              AND psh.warehouse_id = si.warehouse_id
                              AND psh.is_deleted   = FALSE
                            ORDER BY psh.created_at DESC
                            LIMIT 10
                        ) history_rows
                    ),
                    '[]'
                )                           AS recent_stock_history,

                -- Audit: created_by / modified_by usernames
                creators.username           AS created_by_name,
                updaters.username           AS modified_by_name

            FROM public.seller_inventory si

            LEFT JOIN public.seller_accounts  sa  ON sa.seller_id          = si.seller_id
            LEFT JOIN public.seller_warehouse sw  ON sw.warehouse_id       = si.warehouse_id
            LEFT JOIN public.products          p  ON p.product_id          = si.product_id
            LEFT JOIN public.product_types    pt  ON pt.product_type_id    = p.product_type_id
            LEFT JOIN public.brand           br  ON br.brand_id           = p.brand_id
            LEFT JOIN public.model           mo  ON mo.model_id           = p.model_id
            LEFT JOIN public.users       creators ON creators.user_uuid     = si.created_by
            LEFT JOIN public.users       updaters ON updaters.user_uuid     = si.modified_by

            WHERE si.inventory_uuid = $1
              AND si.is_deleted     = FALSE
            `,
            [inventory_uuid]
        );

        // --------------------------------------------------
        // 3. CHECK IF RECORD EXISTS
        // --------------------------------------------------
        if (result.rowCount === 0) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No inventory record found with the provided UUID",
            });
        }

        const inventory = result.rows[0];

        // --------------------------------------------------
        // 4. LOCK HANDLING (edit mode only)
        // --------------------------------------------------
        let lockRow = null;

        if (mode === "edit") {

            if (!user_id) {
                await client.query("ROLLBACK");
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            "Validation failed",
                    error:              "user_id is required for edit mode",
                });
            }

            // Check existing lock
            const lockRes = await client.query(
                `SELECT rl.*, u.username AS locked_by_name
                 FROM public.record_locks rl
                 LEFT JOIN public.users u ON u.user_uuid = rl.locked_by
                 WHERE rl.table_name = 'seller_inventory'
                   AND rl.record_id  = $1
                   AND rl.is_deleted = FALSE`,
                [inventory_uuid]
            );

            lockRow = lockRes.rows[0] || null;

            const isExpired = lockRow && new Date(lockRow.expires_at).getTime() < Date.now();

            // Locked by another active user
            if (lockRow && lockRow.locked_by !== user_id && !isExpired) {
                await client.query("ROLLBACK");
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2005,
                    message:            `Record is locked by ${lockRow.locked_by_name}`,
                });
            }

            // Lock expired → clear it
            if (lockRow && isExpired) {
                await client.query(
                    `UPDATE public.record_locks
                     SET is_deleted = TRUE,
                         deleted_by = $1,
                         deleted_at = NOW()
                     WHERE lock_id = $2`,
                    [user_id, lockRow.lock_id]
                );
                lockRow = null;
            }

            // No lock exists → create new lock
            if (!lockRow) {
                const newLock = await client.query(
                    `INSERT INTO public.record_locks (
                        table_name, record_id, locked_by, expires_at, created_by
                    ) VALUES (
                        'seller_inventory', $1, $2,
                        NOW() + ($3 || ' minute')::INTERVAL, $2
                    )
                    RETURNING *`,
                    [inventory_uuid, user_id, LOCK_MINUTES]
                );
                lockRow = newLock.rows[0];
            }
            // Same user → refresh lock
            else if (lockRow.locked_by === user_id) {
                const refresh = await client.query(
                    `UPDATE public.record_locks
                     SET expires_at = NOW() + ($2 || ' minute')::INTERVAL
                     WHERE lock_id  = $1
                     RETURNING *`,
                    [lockRow.lock_id, LOCK_MINUTES]
                );
                lockRow = refresh.rows[0];
            }
        }

        await client.query("COMMIT");

        // --------------------------------------------------
        // 5. FINAL LOCK STATUS + RESPONSE
        // --------------------------------------------------
        inventory.lock_status = lockRow
            ? new Date(lockRow.expires_at).getTime() >= Date.now()
            : false;

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Seller inventory fetched successfully",
            data:               inventory,
            lock: lockRow
                ? {
                    status:     inventory.lock_status,
                    by:         lockRow.locked_by,
                    by_name:    lockRow.locked_by_name,
                    expires_at: lockRow.expires_at,
                }
                : { status: false },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (getById-seller-inventory):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Fetch failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// DELETE PRODUCT (SOFT DELETE)
// --------------------------------------------------

// --------------------------------------------------
// Cascades to: product_images, product_price_history,
//              oem_equivalents, seller_inventory,
//              product_stock_history
// --------------------------------------------------

responder.on("delete-product", async (req, cb) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const { product_uuid } = req;
        const { deleted_by }   = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!product_uuid) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Product UUID is required",
            });
        }
        if (!deleted_by) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "deleted_by is required",
            });
        }

        // --------------------------------------------------
        // 2. CHECK PRODUCT EXISTS
        // --------------------------------------------------
        const check = await client.query(
            `SELECT product_id, oem_part_number, seller_id
             FROM public.products
             WHERE product_uuid = $1 AND is_deleted = FALSE`,
            [product_uuid]
        );
        if (check.rowCount === 0) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No product found with the provided UUID",
            });
        }

        const { product_id, oem_part_number, seller_id } = check.rows[0];

        // --------------------------------------------------
        // 3. SOFT DELETE product_images
        // --------------------------------------------------
        await client.query(
            `UPDATE public.product_images SET
                is_deleted  = TRUE,
                is_active   = FALSE,
                deleted_by  = $1,
                deleted_at  = NOW(),
                modified_by = $1,
                modified_at = NOW()
             WHERE product_id = $2
               AND is_deleted = FALSE`,
            [deleted_by, product_id]
        );

        // --------------------------------------------------
        // 4. SOFT DELETE product_price_history
        // --------------------------------------------------
        await client.query(
            `UPDATE public.product_price_history SET
                is_deleted  = TRUE,
                is_active   = FALSE,
                deleted_by  = $1,
                deleted_at  = NOW(),
                modified_by = $1,
                modified_at = NOW()
             WHERE product_id = $2
               AND is_deleted = FALSE`,
            [deleted_by, product_id]
        );

        // --------------------------------------------------
        // 5. SOFT DELETE oem_equivalents
        //    (only if this product's oem_part_number has a record)
        // --------------------------------------------------
        if (oem_part_number) {
            await client.query(
                `UPDATE public.oem_equivalents SET
                    is_deleted  = TRUE,
                    is_active   = FALSE,
                    deleted_by  = $1,
                    deleted_at  = NOW(),
                    modified_by = $1,
                    modified_at = NOW()
                 WHERE oem_part_number = $2
                   AND is_deleted      = FALSE`,
                [deleted_by, oem_part_number]
            );
        }

        // --------------------------------------------------
        // 6. SOFT DELETE product_stock_history
        //    (all inventory details for this product)
        // --------------------------------------------------
        await client.query(
            `UPDATE public.product_stock_history SET
                is_deleted  = TRUE,
                is_active   = FALSE,
                deleted_by  = $1,
                deleted_at  = NOW(),
                modified_by = $1,
                modified_at = NOW()
             WHERE product_id = $2
               AND is_deleted = FALSE`,
            [deleted_by, product_id]
        );

        // --------------------------------------------------
        // 7. SOFT DELETE seller_inventory
        // --------------------------------------------------
        await client.query(
            `UPDATE public.seller_inventory SET
                is_deleted  = TRUE,
                is_active   = FALSE,
                deleted_by  = $1,
                deleted_at  = NOW(),
                modified_by = $1,
                modified_at = NOW()
             WHERE product_id = $2
               AND seller_id  = $3
               AND is_deleted = FALSE`,
            [deleted_by, product_id, seller_id]
        );

        // --------------------------------------------------
        // 8. SOFT DELETE products (last — after all children)
        // --------------------------------------------------
        await client.query(
            `UPDATE public.products SET
                is_deleted  = TRUE,
                is_active   = FALSE,
                deleted_by  = $1,
                deleted_at  = NOW(),
                modified_by = $1,
                modified_at = NOW()
             WHERE product_uuid = $2
               AND is_deleted   = FALSE`,
            [deleted_by, product_uuid]
        );

        // --------------------------------------------------
        // 9. RELEASE ANY ACTIVE LOCK on this product
        // --------------------------------------------------
        await client.query(
            `UPDATE public.record_locks SET
                is_deleted = TRUE,
                deleted_by = $1,
                deleted_at = NOW()
             WHERE table_name = 'products'
               AND record_id  = $2
               AND is_deleted = FALSE`,
            [deleted_by, product_uuid]
        );

        await client.query("COMMIT");

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Product and all associated records deleted successfully",
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (delete-seller-product):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Delete failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// STATUS TOGGLE —  PRODUCT (ACTIVE / INACTIVE)
// --------------------------------------------------

// --------------------------------------------------
// Cascades to: product_images, product_price_history,
//              seller_inventory
// Note: oem_equivalents + product_stock_history are
//       global/audit records — not toggled.
// --------------------------------------------------

responder.on("status-product", async (req, cb) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const { product_uuid } = req;
        const { modified_by }  = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!product_uuid) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Product UUID is required",
            });
        }
        if (!modified_by) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "modified_by is required",
            });
        }

        // --------------------------------------------------
        // 2. CHECK PRODUCT EXISTS + GET CURRENT STATUS
        // --------------------------------------------------
        const check = await client.query(
            `SELECT product_id, seller_id, oem_part_number, is_active
             FROM public.products
             WHERE product_uuid = $1 AND is_deleted = FALSE`,
            [product_uuid]
        );
        if (check.rowCount === 0) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No product found with the provided UUID",
            });
        }

        const { product_id, seller_id, oem_part_number } = check.rows[0];
        const newStatus = !check.rows[0].is_active;   // TOGGLE

        // --------------------------------------------------
        // 3. TOGGLE product_images
        // --------------------------------------------------
        await client.query(
            `UPDATE public.product_images SET
                is_active   = $1,
                modified_by = $2,
                modified_at = NOW()
             WHERE product_id = $3
               AND is_deleted = FALSE`,
            [newStatus, modified_by, product_id]
        );

        // --------------------------------------------------
        // 4. TOGGLE product_price_history (active record only)
        // --------------------------------------------------
        await client.query(
            `UPDATE public.product_price_history SET
                is_active   = $1,
                modified_by = $2,
                modified_at = NOW()
             WHERE product_id = $3
               AND is_deleted = FALSE`,
            [newStatus, modified_by, product_id]
        );

        // --------------------------------------------------
        // 5. TOGGLE seller_inventory
        //    (only this seller's inventory for this product)
        // --------------------------------------------------
        await client.query(
            `UPDATE public.seller_inventory SET
                is_active   = $1,
                modified_by = $2,
                modified_at = NOW()
             WHERE product_id = $3
               AND seller_id  = $4
               AND is_deleted = FALSE`,
            [newStatus, modified_by, product_id, seller_id]
        );

        // --------------------------------------------------
        // 6. TOGGLE product_stock_history
        //    (all stock movement records for this product)
        // --------------------------------------------------
        await client.query(
            `UPDATE public.product_stock_history SET
                is_active   = $1,
                modified_by = $2,
                modified_at = NOW()
             WHERE product_id = $3
               AND is_deleted = FALSE`,
            [newStatus, modified_by, product_id]
        );

        // --------------------------------------------------
        // 6.5 TOGGLE oem_equivalents
        //    Only when DEACTIVATING: deactivate only if NO OTHER
        //    active product still shares this oem_part_number.
        //    Only when ACTIVATING: always reactivate (this product
        //    needs it active again).
        // --------------------------------------------------
        if (oem_part_number) {
            if (newStatus === false) {
                // Deactivating — check if any other active product
                // still references this oem_part_number
                const otherActiveCheck = await client.query(
                    `SELECT 1 FROM public.products
                     WHERE oem_part_number = $1
                       AND product_id <> $2
                       AND is_deleted = FALSE
                       AND is_active  = TRUE
                     LIMIT 1`,
                    [oem_part_number, product_id]
                );

                if (otherActiveCheck.rowCount === 0) {
                    await client.query(
                        `UPDATE public.oem_equivalents SET
                            is_active   = FALSE,
                            modified_by = $1,
                            modified_at = NOW()
                         WHERE oem_part_number = $2
                           AND is_deleted      = FALSE`,
                        [modified_by, oem_part_number]
                    );
                }
            } else {
                // Activating — always ensure oem_equivalents is active
                await client.query(
                    `UPDATE public.oem_equivalents SET
                        is_active   = TRUE,
                        modified_by = $1,
                        modified_at = NOW()
                     WHERE oem_part_number = $2
                       AND is_deleted      = FALSE`,
                    [modified_by, oem_part_number]
                );
            }
        }

        // --------------------------------------------------
        // 7. TOGGLE products (last)
        // --------------------------------------------------
        await client.query(
            `UPDATE public.products SET
                is_active   = $1,
                modified_by = $2,
                modified_at = NOW()
             WHERE product_uuid = $3
               AND is_deleted   = FALSE`,
            [newStatus, modified_by, product_uuid]
        );

        await client.query("COMMIT");

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            newStatus
                ? "Product activated successfully"
                : "Product deactivated successfully",
            data: {
                product_uuid,
                is_active: newStatus,
            },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (status-seller-product):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Status update failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// UNLOCK PRODUCT RECORD
// --------------------------------------------------

responder.on('unlock-product', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { uuid } = req;
        const user_id = req.body?.user_id;

        /* ======================================================
           VALIDATIONS
        ====================================================== */
        if (!user_id) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "User ID is required"
            });
        }

        await client.query('BEGIN');

        /* ======================================================
           DELETE LOCK (ONLY IF SAME USER OWNS IT)
        ====================================================== */
        const result = await client.query(
            `
            DELETE FROM record_locks
            WHERE table_name = 'products'
              AND record_id = $1
              AND locked_by = $2
              AND is_deleted = FALSE
            `,
            [uuid, user_id]
        );

        // No lock deleted → locked by another user OR already expired/unlocked
        if (!result.rowCount) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Unable to unlock record",
                error: "This record is currently being edited by another user or already unlocked"
            });
        }

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Product record unlocked successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');

        logger.error("Responder Error (unlock-product):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Unlock failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// UNLOCK SELLER INVENTORY RECORD
// --------------------------------------------------
responder.on('unlock-seller-inventory', async (req, cb) => {
    const client = await pool.connect();
    try {
        const { inventory_uuid } = req;
        const user_id = req.body?.user_id;

        /* ======================================================
           VALIDATIONS
        ====================================================== */
        if (!inventory_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Inventory UUID is required"
            });
        }

        if (!user_id?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "User ID is required"
            });
        }

        await client.query('BEGIN');

        /* ======================================================
           DELETE LOCK (ONLY IF SAME USER OWNS IT)
        ====================================================== */
        const result = await client.query(
            `DELETE FROM public.record_locks
             WHERE table_name = 'seller_inventory'
               AND record_id  = $1
               AND locked_by  = $2
               AND is_deleted = FALSE`,
            [inventory_uuid, user_id]
        );

        // No lock deleted → locked by another user OR already expired/unlocked
        if (!result.rowCount) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Unable to unlock record",
                error:              "This record is currently being edited by another user or already unlocked"
            });
        }

        await client.query('COMMIT');

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Seller inventory record unlocked successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (unlock-seller-inventory):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Unlock failed",
            error:              err.message
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// VERIFY PRODUCT RECORD
// --------------------------------------------------


responder.on("verify-product", async (req, cb) => {
    try {
        const { product_uuid }                                              = req;
        const { verified_from, verify_status, listing_status, listing_remarks } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!product_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Product UUID is required",
            });
        }

        if (!verified_from?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "verified_from is required",
            });
        }

        const ALLOWED_VERIFY_STATUSES = ["APPROVED", "PENDING", "REJECTED"];
        if (!verify_status || !ALLOWED_VERIFY_STATUSES.includes(verify_status)) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              `verify status must be one of: ${ALLOWED_VERIFY_STATUSES.join(", ")}`,
            });
        }

        const ALLOWED_LISTING_STATUSES = ["ACTIVE", "INACTIVE", "DRAFT"];
        if (!listing_status || !ALLOWED_LISTING_STATUSES.includes(listing_status)) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              `listing status must be one of: ${ALLOWED_LISTING_STATUSES.join(", ")}`,
            });
        }

        // --------------------------------------------------
        // 2. CHECK PRODUCT EXISTS
        // --------------------------------------------------
        const check = await pool.query(
            `SELECT product_id, verify_status AS current_verify_status, listing_status AS current_listing_status, is_listed
             FROM public.products
             WHERE product_uuid = $1
               AND is_deleted   = FALSE
               AND is_active    = TRUE`,
            [product_uuid]
        );

        if (check.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active product found with the provided UUID",
            });
        }

        const { current_verify_status, current_listing_status } = check.rows[0];

        // --------------------------------------------------
        // 3. BUSINESS RULE:
        //    Already APPROVED product → only APPROVED allowed
        //    Cannot move back to PENDING or REJECTED
        // --------------------------------------------------
        if (current_verify_status === "APPROVED" && verify_status !== "APPROVED") {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2002,
                message:            "Action not allowed",
                error:              "This product is already approved. Status cannot be changed to PENDING or REJECTED",
            });
        }

        // --------------------------------------------------
        // 4. ALREADY IN SAME STATUS — no-op guard
        // --------------------------------------------------
        if (current_verify_status === verify_status && current_listing_status === listing_status) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2002,
                message:            "No change",
                error:              "Product is already in the same verify and listing status",
            });
        }

        // --------------------------------------------------
        // 5. DERIVE is_listed AND final_listing_status
        //    APPROVED  → respect admin's listing_status input
        //    PENDING   → force INACTIVE
        //    REJECTED  → force INACTIVE
        // --------------------------------------------------
        const is_listed            = verify_status === "APPROVED" && listing_status === "ACTIVE";
        const final_listing_status = verify_status === "APPROVED" ? listing_status : "INACTIVE";

        // --------------------------------------------------
        // 6. UPDATE products
        // --------------------------------------------------
        const result = await pool.query(
            `UPDATE public.products SET
                verify_status   = $1,
                verified_from   = $2,
                is_listed       = $3,
                listing_status  = $4,
                listing_remarks = $5
             WHERE product_uuid = $6
               AND is_deleted   = FALSE
               AND is_active    = TRUE
             RETURNING product_uuid, verify_status, verified_from, is_listed, listing_status, listing_remarks`,
            [verify_status, verified_from.trim(), is_listed, final_listing_status, listing_remarks || null, product_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Update failed",
                error:              "Product not found or already deleted",
            });
        }

        // --------------------------------------------------
        // 7. SUCCESS
        // --------------------------------------------------
        const successMessages = {
            APPROVED: "Product verified and approved successfully",
            PENDING:  "Product marked as pending verification",
            REJECTED: "Product rejected successfully",
        };

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            successMessages[verify_status],
            data:               { ...result.rows[0] },
        });

    } catch (err) {
        logger.error("Responder Error (verify-seller-product):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Update failed",
            error:              err.message,
        });
    }
});

// --------------------------------------------------
// BULK VERIFICATION OF PRODUCTS
// --------------------------------------------------

responder.on("bulk-verify-products", async (req, cb) => {
    try {
        const { products } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE — top level
        // --------------------------------------------------
        if (!Array.isArray(products) || products.length === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "products must be a non-empty array",
            });
        }

        // --------------------------------------------------
        // 2. MAX LIMIT GUARD
        // --------------------------------------------------
        const MAX_LIMIT = 1000;
        if (products.length > MAX_LIMIT) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              `Cannot process more than ${MAX_LIMIT} products at once`,
            });
        }

        // --------------------------------------------------
        // 3. VALIDATE — per item
        // --------------------------------------------------
        const ALLOWED_VERIFY_STATUSES  = ["APPROVED", "PENDING", "REJECTED"];
        const ALLOWED_LISTING_STATUSES = ["ACTIVE", "INACTIVE", "DRAFT"];

        const itemErrors = [];

        for (let i = 0; i < products.length; i++) {
            const item  = products[i];
            const label = `products[${i}]`;

            if (!item.product_uuid?.trim())
                itemErrors.push(`${label}: product_uuid is required`);

            if (!item.verified_from?.trim())
                itemErrors.push(`${label}: verified_from is required`);

            if (!item.verify_status || !ALLOWED_VERIFY_STATUSES.includes(item.verify_status))
                itemErrors.push(`${label}: verify status must be one of: ${ALLOWED_VERIFY_STATUSES.join(", ")}`);

            if (!item.listing_status || !ALLOWED_LISTING_STATUSES.includes(item.listing_status))
                itemErrors.push(`${label}: listing status must be one of: ${ALLOWED_LISTING_STATUSES.join(", ")}`);
        }

        if (itemErrors.length > 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              itemErrors,
            });
        }

        // --------------------------------------------------
        // 4. DEDUPLICATE — last entry wins on duplicate uuid
        // --------------------------------------------------
        const productMap = new Map();
        for (const item of products) {
            productMap.set(item.product_uuid.trim(), item);
        }
        const uniqueItems = [...productMap.values()];
        const uniqueUuids = uniqueItems.map(i => i.product_uuid);

        // --------------------------------------------------
        // 5. FETCH ALL MATCHING PRODUCTS
        // --------------------------------------------------
        const check = await pool.query(
            `SELECT
                product_uuid,
                product_id,
                verify_status  AS current_verify_status,
                listing_status AS current_listing_status,
                is_active,
                is_listed
             FROM public.products
             WHERE product_uuid = ANY($1::uuid[])
               AND is_deleted   = FALSE`,
            [uniqueUuids]
        );

        // --------------------------------------------------
        // 6. CATEGORISE
        // --------------------------------------------------
        const dbMap      = new Map(check.rows.map(r => [r.product_uuid, r]));
        const foundUuids = check.rows.map(r => r.product_uuid);

        const notFoundUuids        = [];
        const inactiveUuids        = [];
        const alreadyApprovedUuids = [];
        const alreadySameUuids     = [];
        const eligibleItems        = [];   // { product_id, payload }

        for (const item of uniqueItems) {
            const row = dbMap.get(item.product_uuid);

            // Not found in DB
            if (!row) {
                notFoundUuids.push(item.product_uuid);
                continue;
            }

            // Inactive
            if (!row.is_active) {
                inactiveUuids.push(item.product_uuid);
                continue;
            }

            // Already APPROVED — cannot change
            if (row.current_verify_status === "APPROVED") {
                alreadyApprovedUuids.push(item.product_uuid);
                continue;
            }

            // Derive final values for this item
            const final_listing_status = item.verify_status === "APPROVED"
                ? item.listing_status
                : "INACTIVE";

            // No change needed
            if (
                row.current_verify_status  === item.verify_status &&
                row.current_listing_status === final_listing_status
            ) {
                alreadySameUuids.push(item.product_uuid);
                continue;
            }

            // Eligible
            eligibleItems.push({
                product_id:      row.product_id,
                product_uuid:    item.product_uuid,
                verify_status:   item.verify_status,
                verified_from:   item.verified_from.trim(),
                listing_status:  final_listing_status,
                listing_remarks: item.listing_remarks || null,
                is_listed:       item.verify_status === "APPROVED" && item.listing_status === "ACTIVE",
            });
        }

        // --------------------------------------------------
        // 7. NOTHING TO PROCESS
        // --------------------------------------------------
        if (eligibleItems.length === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2002,
                message:            "Nothing to process",
                error:              "All provided products are either already approved, already in the same status, inactive, or not found",
                data: {
                    summary: {
                        requested:        uniqueUuids.length,
                        processed:        0,
                        already_approved: alreadyApprovedUuids.length,
                        already_same:     alreadySameUuids.length,
                        inactive:         inactiveUuids.length,
                        not_found:        notFoundUuids.length,
                    },
                    already_approved_uuids: alreadyApprovedUuids,
                    already_same_uuids:     alreadySameUuids,
                    inactive_uuids:         inactiveUuids,
                    not_found_uuids:        notFoundUuids,
                },
            });
        }

        // --------------------------------------------------
        // 8. BULK UPDATE — per-row values via unnest
        // --------------------------------------------------
        const productIds      = eligibleItems.map(e => e.product_id);
        const verifyStatuses  = eligibleItems.map(e => e.verify_status);
        const verifiedFroms   = eligibleItems.map(e => e.verified_from);
        const isListeds       = eligibleItems.map(e => e.is_listed);
        const listingStatuses = eligibleItems.map(e => e.listing_status);
        const listingRemarks  = eligibleItems.map(e => e.listing_remarks);

        const result = await pool.query(
            `UPDATE public.products AS p SET
                verify_status   = v.verify_status,
                verified_from   = v.verified_from,
                is_listed       = v.is_listed,
                listing_status  = v.listing_status,
                listing_remarks = v.listing_remarks,
                modified_at     = NOW()
             FROM (
                SELECT
                    UNNEST($1::bigint[])  AS product_id,
                    UNNEST($2::text[])    AS verify_status,
                    UNNEST($3::text[])    AS verified_from,
                    UNNEST($4::boolean[]) AS is_listed,
                    UNNEST($5::text[])    AS listing_status,
                    UNNEST($6::text[])    AS listing_remarks
             ) AS v
             WHERE p.product_id     = v.product_id
               AND p.is_deleted     = FALSE
               AND p.is_active      = TRUE
               AND p.verify_status != 'APPROVED'
             RETURNING p.product_uuid`,
            [productIds, verifyStatuses, verifiedFroms, isListeds, listingStatuses, listingRemarks]
        );

        // --------------------------------------------------
        // 9. MAP updated rows back to UUIDs
        // --------------------------------------------------
        const processedUuids = result.rows.map(r => r.product_uuid);

        // --------------------------------------------------
        // 10. SUCCESS
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            `${processedUuids.length} product(s) verified successfully`,
            data: {
                summary: {
                    requested:        uniqueUuids.length,
                    processed:        processedUuids.length,
                    already_approved: alreadyApprovedUuids.length,
                    already_same:     alreadySameUuids.length,
                    inactive:         inactiveUuids.length,
                    not_found:        notFoundUuids.length,
                    skipped:          uniqueUuids.length - processedUuids.length,
                },
                processed_uuids:        processedUuids,
                already_approved_uuids: alreadyApprovedUuids,
                already_same_uuids:     alreadySameUuids,
                inactive_uuids:         inactiveUuids,
                not_found_uuids:        notFoundUuids,
            },
        });

    } catch (err) {
        logger.error("Responder Error (bulk-verify-seller-products):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Update failed",
            error:              err.message,
        });
    }
});


// --------------------------------------------------
// BARCODE VERIFICATION 
// --------------------------------------------------

responder.on('verify-barcode', async (req, cb) => {
    try {
        const { seller_uuid, barcode_number } = req.body;

        // --------------------------------------------------
        // VALIDATE INPUTS
        // --------------------------------------------------
        if (!barcode_number) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Barcode number is required"
            });
        }

        if (!seller_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Seller UUID is required"
            });
        }

        // --------------------------------------------------
        // FETCH seller_id
        // --------------------------------------------------
        const sellerCheck = await pool.query(
            `SELECT seller_id
             FROM public.seller_accounts
             WHERE seller_uuid = $1
               AND is_active = TRUE
               AND is_deleted = FALSE`,
            [seller_uuid]
        );
        if (sellerCheck.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "No active seller found with the provided UUID"
            });
        }
        const seller_id = sellerCheck.rows[0].seller_id;

        // --------------------------------------------------
        // CHECK IF BARCODE ALREADY EXISTS FOR THIS SELLER
        // --------------------------------------------------
        const check = await pool.query(
            `SELECT p.barcode_number
             FROM public.products p
             WHERE p.barcode_number = $1
               AND p.seller_id     = $2
               AND p.is_deleted     = FALSE
               AND p.is_active    = TRUE`,
            [barcode_number, seller_id]
        );

        if (check.rowCount > 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Verification failed",
                error: "This barcode number already exists for the provided seller"
            });
        }

        // --------------------------------------------------
        // BARCODE IS UNIQUE FOR THIS SELLER — VERIFIED
        // --------------------------------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Barcode verified successfully"
        });

    } catch (err) {
        logger.error("Responder Error (verify-barcode):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Verification failed",
            error: err.message
        });
    }
});

// ============================================================
// GET PRODUCT PRICE HISTORY
// ============================================================

responder.on("get-product-price-history", async (req, cb) => {
    try {
        const { product_uuid } = req;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!product_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Product UUID is required",
            });
        }

        // --------------------------------------------------
        // 2. CHECK PRODUCT EXISTS
        // --------------------------------------------------
        const productCheck = await pool.query(
            `SELECT product_id, product_uuid, code AS product_code, sku
             FROM public.products
             WHERE product_uuid = $1
               AND is_deleted   = FALSE`,
            [product_uuid]
        );

        if (productCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No product found with the provided UUID",
            });
        }

        const product = productCheck.rows[0];

        // --------------------------------------------------
        // 3. FETCH PRICE HISTORY
        // --------------------------------------------------
        const result = await pool.query(
            `SELECT
                pph.prd_price_uuid,
                pph.price,
                pph.price_after_sale,
                pph.currency_id,
                pph.effective_from,
                pph.effective_to,
                pph.reason,
                pph.is_active,
                pph.created_at,
                pph.modified_at,

                -- Created by
                creators.username           AS created_by_name,
                creators.user_uuid          AS created_by,

                -- Modified by
                updaters.username           AS modified_by_name,
                updaters.user_uuid          AS modified_by

             FROM public.product_price_history pph
             LEFT JOIN public.users creators ON creators.user_uuid = pph.created_by
             LEFT JOIN public.users updaters ON updaters.user_uuid = pph.modified_by

             WHERE pph.product_id = $1
               AND pph.is_deleted = FALSE
             ORDER BY pph.effective_from DESC`,
            [product.product_id]
        );

        // --------------------------------------------------
        // 4. RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Product price history fetched successfully",
            data: {
                product: {
                    product_uuid: product.product_uuid,
                    product_code: product.product_code,
                    sku:          product.sku,
                },
                total:         result.rowCount,
                price_history: result.rows,
            },
        });

    } catch (err) {
        logger.error("Responder Error (get-product-price-history):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Fetch failed",
            error:              err.message,
        });
    }
});


// ============================================================
// GET PRODUCT STOCK HISTORY
// ============================================================

responder.on("get-product-stock-history", async (req, cb) => {
    try {
        const { product_uuid } = req;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!product_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Product UUID is required",
            });
        }

        // --------------------------------------------------
        // 2. CHECK PRODUCT EXISTS
        // --------------------------------------------------
        const productCheck = await pool.query(
            `SELECT product_id, product_uuid, code AS product_code, sku
             FROM public.products
             WHERE product_uuid = $1
               AND is_deleted   = FALSE`,
            [product_uuid]
        );

        if (productCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No product found with the provided UUID",
            });
        }

        const product = productCheck.rows[0];

        // --------------------------------------------------
        // 3. FETCH STOCK HISTORY WITH WAREHOUSE JOIN
        // --------------------------------------------------
        const result = await pool.query(
            `SELECT
                psh.stock_history_uuid,
                psh.movement_type,
                psh.quantity_before,
                psh.quantity_changed,
                psh.quantity_after,
                psh.reason,
                psh.reference_type,
                psh.reference_id,
                psh.notes,
                psh.created_at,
                psh.assigned_at,

                -- Warehouse
                sw.warehouse_uuid,
                sw.warehouse_name                     AS warehouse_name,
                sw.warehouse_address                 ,
                sw.warehouse_map_address,   
                -- Created by
                u.username                  AS created_by_name,
                u.user_uuid                 AS created_by

             FROM public.product_stock_history psh
             LEFT JOIN public.seller_warehouse sw ON sw.warehouse_id = psh.warehouse_id
             LEFT JOIN public.users           u  ON u.user_uuid      = psh.created_by

             WHERE psh.product_id = $1
               AND psh.is_deleted = FALSE
             ORDER BY psh.created_at DESC`,
            [product.product_id]
        );

        // --------------------------------------------------
        // 4. RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Product stock history fetched successfully",
            data: {
                product: {
                    product_uuid: product.product_uuid,
                    product_code: product.product_code,
                    sku:          product.sku,
                },
                total:         result.rowCount,
                stock_history: result.rows,
            },
        });

    } catch (err) {
        logger.error("Responder Error (get-product-stock-history):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Fetch failed",
            error:              err.message,
        });
    }
});

// ============================================================
// GET PRODUCT AUDIT LOGS
// ============================================================


responder.on("get-product-audit-log", async (req, cb) => {
    try {
        const { product_uuid } = req;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!product_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Product UUID is required",
            });
        }

        // --------------------------------------------------
        // 2. CHECK PRODUCT EXISTS
        // --------------------------------------------------
        const productCheck = await pool.query(
            `SELECT
                p.product_id,
                p.product_uuid,
                p.code          AS product_code,
                p.sku,
                p.oem_part_number,
                p.verify_status,
                p.listing_status,
                p.is_listed,
                p.is_active,
                p.is_deleted,
                sa.business_name AS seller_name,
                sa.seller_uuid
             FROM public.products p
             LEFT JOIN public.seller_accounts sa ON sa.seller_id = p.seller_id
             WHERE p.product_uuid = $1`,
            [product_uuid]
        );

        if (productCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No product found with the provided UUID",
            });
        }

        const product = productCheck.rows[0];

        // --------------------------------------------------
        // 3. FETCH AUDIT TIMELINE — UNION of all activity sources
        // --------------------------------------------------
        const timelineResult = await pool.query(
            `
            -- ── 1. PRODUCT CREATED ──────────────────────────────────────
            SELECT
                'PRODUCT_CREATED'                           AS event_type,
                'Product was created'                       AS event_description,
                p.created_at                                AS event_at,
                p.created_by                                AS actor_uuid,
                u_c.username                                AS actor_name,
                NULL::text                                  AS reference_type,
                NULL::bigint                                AS reference_id,
                json_build_object(
                    'sku',            p.sku,
                    'oem_part_number', p.oem_part_number,
                    'price',          p.price,
                    'upload_method',  p.upload_method
                )                                           AS meta
            FROM public.products p
            LEFT JOIN public.users u_c ON u_c.user_uuid = p.created_by
            WHERE p.product_uuid = $1

            UNION ALL

            -- ── 2. PRODUCT UPDATED ──────────────────────────────────────
            SELECT
                'PRODUCT_UPDATED'                           AS event_type,
                'Product details were updated'              AS event_description,
                p.modified_at                               AS event_at,
                p.modified_by                               AS actor_uuid,
                u_m.username                                AS actor_name,
                NULL::text                                  AS reference_type,
                NULL::bigint                                AS reference_id,
                json_build_object(
                    'sku',            p.sku,
                    'oem_part_number', p.oem_part_number,
                    'price',          p.price,
                    'is_active',      p.is_active
                )                                           AS meta
            FROM public.products p
            LEFT JOIN public.users u_m ON u_m.user_uuid = p.modified_by
            WHERE p.product_uuid = $1
              AND p.modified_at IS NOT NULL
              AND p.modified_by IS NOT NULL

            UNION ALL

            -- ── 3. PRODUCT DELETED ──────────────────────────────────────
            SELECT
                'PRODUCT_DELETED'                           AS event_type,
                'Product was soft-deleted'                  AS event_description,
                p.deleted_at                                AS event_at,
                p.deleted_by                                AS actor_uuid,
                u_d.username                                AS actor_name,
                NULL::text                                  AS reference_type,
                NULL::bigint                                AS reference_id,
                json_build_object(
                    'is_deleted', p.is_deleted
                )                                           AS meta
            FROM public.products p
            LEFT JOIN public.users u_d ON u_d.user_uuid = p.deleted_by
            WHERE p.product_uuid = $1
              AND p.is_deleted   = TRUE
              AND p.deleted_at   IS NOT NULL

            UNION ALL

            -- ── 4. VERIFICATION STATUS CHANGE ───────────────────────────
            SELECT
                'PRODUCT_VERIFIED'                          AS event_type,
                'Product verification status changed to '
                    || p.verify_status                      AS event_description,
                p.modified_at                               AS event_at,
                p.modified_by                               AS actor_uuid,
                u_v.username                                AS actor_name,
                p.verified_from                             AS reference_type,
                NULL::bigint                                AS reference_id,
                json_build_object(
                    'verify_status',   p.verify_status,
                    'verified_from',   p.verified_from,
                    'listing_status',  p.listing_status,
                    'listing_remarks', p.listing_remarks,
                    'is_listed',       p.is_listed
                )                                           AS meta
            FROM public.products p
            LEFT JOIN public.users u_v ON u_v.user_uuid = p.modified_by
            WHERE p.product_uuid  = $1
              AND p.verify_status IS NOT NULL
              AND p.modified_at   IS NOT NULL

            UNION ALL

            -- ── 5. PRICE HISTORY ────────────────────────────────────────
            SELECT
                'PRICE_CHANGED'                             AS event_type,
                'Product price was updated'                 AS event_description,
                pph.created_at                              AS event_at,
                pph.created_by                              AS actor_uuid,
                u_ph.username                               AS actor_name,
                NULL::text                                  AS reference_type,
                pph.prd_price_id                            AS reference_id,
                json_build_object(
                    'price',            pph.price,
                    'price_after_sale', pph.price_after_sale,
                    'effective_from',   pph.effective_from,
                    'effective_to',     pph.effective_to,
                    'reason',           pph.reason
                )                                           AS meta
            FROM public.product_price_history pph
            LEFT JOIN public.users u_ph ON u_ph.user_uuid = pph.created_by
            WHERE pph.product_id = $2
              AND pph.is_deleted = FALSE

            UNION ALL

            -- ── 6. STOCK MOVEMENTS ──────────────────────────────────────
            SELECT
                'STOCK_MOVEMENT'                            AS event_type,
                'Stock movement: ' || psh.movement_type
                    || ' of '      || psh.quantity_changed
                    || ' units'                             AS event_description,
                psh.created_at                              AS event_at,
                psh.created_by                              AS actor_uuid,
                u_sh.username                               AS actor_name,
                psh.reference_type                          AS reference_type,
                psh.reference_id                            AS reference_id,
                json_build_object(
                    'movement_type',   psh.movement_type,
                    'quantity_before', psh.quantity_before,
                    'quantity_changed', psh.quantity_changed,
                    'quantity_after',  psh.quantity_after,
                    'reason',          psh.reason,
                    'reference_type',  psh.reference_type,
                    'reference_id',    psh.reference_id,
                    'notes',           psh.notes,
                    'warehouse_uuid',  sw.warehouse_uuid,
                    'warehouse_name',  sw.warehouse_name
                )                                           AS meta
            FROM public.product_stock_history psh
            LEFT JOIN public.users           u_sh ON u_sh.user_uuid  = psh.created_by
            LEFT JOIN public.seller_warehouse sw   ON sw.warehouse_id = psh.warehouse_id
            WHERE psh.product_id = $2
              AND psh.is_deleted = FALSE

            UNION ALL

            -- ── 7. INVENTORY CREATED ────────────────────────────────────
            SELECT
                'INVENTORY_CREATED'                         AS event_type,
                'Inventory record created for warehouse: '
                    || sw.warehouse_name                              AS event_description,
                si.created_at                               AS event_at,
                si.created_by                               AS actor_uuid,
                u_ic.username                               AS actor_name,
                NULL::text                                  AS reference_type,
                si.inventory_id                             AS reference_id,
                json_build_object(
                    'inventory_uuid',  si.inventory_uuid,
                    'warehouse_uuid',  sw.warehouse_uuid,
                    'warehouse_name',  sw.warehouse_name,
                    'onhand_qty',      si.onhand_qty,
                    'buffer_qty',      si.buffer_qty,
                    'reorder_level',   si.reorder_level,
                    'bin_loc',         si.bin_loc
                )                                           AS meta
            FROM public.seller_inventory si
            LEFT JOIN public.seller_warehouse sw  ON sw.warehouse_id  = si.warehouse_id
            LEFT JOIN public.users          u_ic ON u_ic.user_uuid    = si.created_by
            WHERE si.product_id = $2
              AND si.is_deleted = FALSE

            UNION ALL

            -- ── 8. INVENTORY UPDATED ────────────────────────────────────
            SELECT
                'INVENTORY_UPDATED'                         AS event_type,
                'Inventory updated for warehouse: '
                    || sw.warehouse_name                              AS event_description,
                si.modified_at                              AS event_at,
                si.modified_by                              AS actor_uuid,
                u_im.username                               AS actor_name,
                NULL::text                                  AS reference_type,
                si.inventory_id                             AS reference_id,
                json_build_object(
                    'inventory_uuid', si.inventory_uuid,
                    'warehouse_name', sw.warehouse_name,
                    'onhand_qty',     si.onhand_qty,
                    'buffer_qty',     si.buffer_qty,
                    'reorder_level',  si.reorder_level,
                    'bin_loc',        si.bin_loc
                )                                           AS meta
            FROM public.seller_inventory si
            LEFT JOIN public.seller_warehouse sw  ON sw.warehouse_id = si.warehouse_id
            LEFT JOIN public.users          u_im ON u_im.user_uuid   = si.modified_by
            WHERE si.product_id  = $2
              AND si.is_deleted  = FALSE
              AND si.modified_at IS NOT NULL
              AND si.modified_by IS NOT NULL

            UNION ALL

            -- ── 9. IMAGE ADDED ───────────────────────────────────────────
            SELECT
                'IMAGE_ADDED'                               AS event_type,
                'Product image added ('
                    || pi.image_type || ')'                 AS event_description,
                pi.created_at                               AS event_at,
                pi.created_by                               AS actor_uuid,
                u_pi.username                               AS actor_name,
                pi.image_type                               AS reference_type,
                pi.product_image_id                         AS reference_id,
                json_build_object(
                    'image_url',  pi.image_url,
                    'image_type', pi.image_type,
                    'sort_order', pi.sort_order
                )                                           AS meta
            FROM public.product_images pi
            LEFT JOIN public.users u_pi ON u_pi.user_uuid = pi.created_by
            WHERE pi.product_id = $2
              AND pi.is_deleted = FALSE

            UNION ALL

            -- ── 10. IMAGE REMOVED ────────────────────────────────────────
            SELECT
                'IMAGE_REMOVED'                             AS event_type,
                'Product image removed'                     AS event_description,
                pi.deleted_at                               AS event_at,
                pi.deleted_by                               AS actor_uuid,
                u_pid.username                              AS actor_name,
                pi.image_type                               AS reference_type,
                pi.product_image_id                         AS reference_id,
                json_build_object(
                    'image_url',  pi.image_url,
                    'image_type', pi.image_type
                )                                           AS meta
            FROM public.product_images pi
            LEFT JOIN public.users u_pid ON u_pid.user_uuid = pi.deleted_by
            WHERE pi.product_id = $2
              AND pi.is_deleted = TRUE
              AND pi.deleted_at IS NOT NULL

            ORDER BY event_at DESC NULLS LAST
            `,
            [product_uuid, product.product_id]
        );

        // --------------------------------------------------
        // 4. RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Product audit log fetched successfully",
            data: {
                product: {
                    product_uuid:     product.product_uuid,
                    product_code:     product.product_code,
                    sku:              product.sku,
                    oem_part_number:  product.oem_part_number,
                    verify_status:    product.verify_status,
                    listing_status:   product.listing_status,
                    is_listed:        product.is_listed,
                    is_active:        product.is_active,
                    is_deleted:       product.is_deleted,
                    seller_name:      product.seller_name,
                    seller_uuid:      product.seller_uuid,
                },
                total:    timelineResult.rowCount,
                timeline: timelineResult.rows,
            },
        });

    } catch (err) {
        logger.error("Responder Error (get-product-audit-log):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Fetch failed",
            error:              err.message,
        });
    }
});


// ============================================================
// LOW STOCK PRODUCTS
// ============================================================


responder.on("get-low-stock-products", async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        let extraWhere  = '';
        let extraParams = [];

        // --------------------------------------------------
        // OPTIONAL SCOPE FILTER (PRIVATE = seller's own only)
        // --------------------------------------------------
        if (accessScope && accessScope.type === 'PRIVATE') {
            extraWhere = ' AND SI.created_by = $extraUser';
            extraParams.push(accessScope.user_id);
        }

        // --------------------------------------------------
        // OPTIONAL warehouse_uuid / seller_uuid PRE-FILTER
        // --------------------------------------------------
        const { warehouse_uuid, seller_uuid } = req.query || {};

        if (warehouse_uuid?.trim()) {
            const wh = await pool.query(
                `SELECT warehouse_id FROM public.seller_warehouse
                 WHERE warehouse_uuid = $1 AND is_deleted = FALSE`,
                [warehouse_uuid.trim()]
            );
            if (wh.rowCount === 0) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "No warehouse found with the provided UUID",
                });
            }
            extraParams.push(wh.rows[0].warehouse_id);
            extraWhere += ` AND SI.warehouse_id = $${extraParams.length + 1}`;
        }

        if (seller_uuid?.trim()) {
            const sl = await pool.query(
                `SELECT seller_id FROM public.seller_accounts
                 WHERE seller_uuid = $1 AND is_deleted = FALSE`,
                [seller_uuid.trim()]
            );
            if (sl.rowCount === 0) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "No seller found with the provided UUID",
                });
            }
            extraParams.push(sl.rows[0].seller_id);
            extraWhere += ` AND SI.seller_id = $${extraParams.length + 1}`;
        }

        // --------------------------------------------------
        // BUILD ADVANCED SEARCH QUERY
        // --------------------------------------------------
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ── Table & Alias ── */
            table:       'seller_inventory',
            alias:       'SI',
            defaultSort: 'shortage_qty',

            /* ── Joins ── */
            joinSql: `
                LEFT JOIN public.products         P   ON P.product_id    = SI.product_id
                LEFT JOIN public.seller_accounts  SA  ON SA.seller_id    = SI.seller_id
                LEFT JOIN public.seller_warehouse SW  ON SW.warehouse_id = SI.warehouse_id
                LEFT JOIN public.product_types    PT  ON PT.product_type_id = P.product_type_id
                LEFT JOIN public.brand            BR  ON BR.brand_id     = P.brand_id
                LEFT JOIN public.model            MO  ON MO.model_id     = P.model_id
            `,

            /* ── Allowed Search/Sort Fields ── */
            allowedFields: [
                'sku',
                'oem_part_number',
                'product_code',
                'bin_loc',
                'onhand_qty',
                'reserved_qty',
                'available_qty',
                'shortage_qty',
                'reorder_level',
                'buffer_qty',
                'is_active',
                'modified_at',
                'created_at',
                // joined
                'seller_name',
                'seller_uuid',
                'warehouse_name',
                'warehouse_uuid',
                'product_type_name',
                'brand_name',
                'model_name',
                'is_listed',
            ],

            /* ── Custom Joined Fields ── */
            customFields: {

                // ── Product fields ──
                sku: {
                    select: 'P.sku',
                    search: 'P.sku',
                    sort:   'P.sku',
                },
                oem_part_number: {
                    select: 'P.oem_part_number',
                    search: 'P.oem_part_number',
                    sort:   'P.oem_part_number',
                },
                product_code: {
                    select: 'P.code',
                    search: 'P.code',
                    sort:   'P.code',
                },
                product_uuid: {
                    select: 'P.product_uuid',
                    search: 'P.product_uuid',
                    sort:   null,
                },
                price: {
                    select: 'P.price',
                    search: null,
                    sort:   'P.price',
                },
                price_after_sale: {
                    select: 'P.price_after_sale',
                    search: null,
                    sort:   'P.price_after_sale',
                },
                is_listed: {
                    select: 'P.is_listed',
                    search: 'P.is_listed',
                    sort:   'P.is_listed',
                },

                // ── Computed stock fields ──
                available_qty: {
                    select: '(SI.onhand_qty - SI.reserved_qty)',
                    search: null,
                    sort:   '(SI.onhand_qty - SI.reserved_qty)',
                },
                shortage_qty: {
                    select: '(SI.reorder_level - (SI.onhand_qty - SI.reserved_qty))',
                    search: null,
                    sort:   '(SI.reorder_level - (SI.onhand_qty - SI.reserved_qty))',
                },

                // ── Seller ──
                seller_name: {
                    select: 'SA.business_name',
                    search: 'SA.business_name',
                    sort:   'SA.business_name',
                },
                seller_uuid: {
                    select: 'SA.seller_uuid',
                    search: 'SA.seller_uuid',
                    sort:   null,
                },

                // ── Warehouse ──
                warehouse_name: {
                    select: 'SW.warehouse_name',
                    search: 'SW.warehouse_name',
                    sort:   'SW.warehouse_name',
                },
                warehouse_uuid: {
                    select: 'SW.warehouse_uuid',
                    search: 'SW.warehouse_uuid',
                    sort:   null,
                },
                warehouse_location: {
                    select: 'SW.warehouse_address',
                    search: 'SW.warehouse_address',
                    sort:   null,
                },

                // ── Product Type ──
                product_type_name: {
                    select: 'PT.name',
                    search: 'PT.name',
                    sort:   'PT.name',
                },

                // ── Brand ──
                brand_name: {
                    select: 'BR.name',
                    search: 'BR.name',
                    sort:   'BR.name',
                },

                // ── Model ──
                model_name: {
                    select: 'MO.name',
                    search: 'MO.name',
                    sort:   'MO.name',
                },

                // ── Primary image (subquery) ──
                primary_image: {
                    select: `(
                        SELECT pi.image_url
                        FROM public.product_images pi
                        WHERE pi.product_id = P.product_id
                          AND pi.image_type = 'PRIMARY'
                          AND pi.is_deleted = FALSE
                          AND pi.is_active  = TRUE
                        LIMIT 1
                    )`,
                    search: null,
                    sort:   null,
                },
            },

            /* ── Base Where — low stock condition here ── */
            baseWhere: `
                SI.is_deleted                              = FALSE
                AND SI.is_active                           = TRUE
                AND P.is_deleted                           = FALSE
                AND SI.reorder_level                       IS NOT NULL
                AND (SI.onhand_qty - SI.reserved_qty)      < SI.reorder_level
                ${extraWhere}
            `,
            baseParams: extraParams,
        });

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Low stock products fetched successfully",
            error:              null,
            result,
        });

    } catch (err) {
        logger.error("[get-low-stock-products] error:", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message,
        });
    }
});

// ============================================================
// OUT OF STOCK PRODUCTS
// ============================================================


responder.on("get-out-of-stock-products", async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        let extraWhere  = '';
        let extraParams = [];

        // --------------------------------------------------
        // OPTIONAL SCOPE FILTER (PRIVATE = seller's own only)
        // --------------------------------------------------
        if (accessScope && accessScope.type === 'PRIVATE') {
            extraWhere = ' AND SI.created_by = $extraUser';
            extraParams.push(accessScope.user_id);
        }

        // --------------------------------------------------
        // OPTIONAL warehouse_uuid / seller_uuid PRE-FILTER
        // Resolve UUIDs → IDs before passing to query builder
        // --------------------------------------------------
        const { warehouse_uuid, seller_uuid } = req.query || {};

        if (warehouse_uuid?.trim()) {
            const wh = await pool.query(
                `SELECT warehouse_id FROM public.seller_warehouse
                 WHERE warehouse_uuid = $1 AND is_deleted = FALSE`,
                [warehouse_uuid.trim()]
            );
            if (wh.rowCount === 0) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "No warehouse found with the provided UUID",
                });
            }
            extraParams.push(wh.rows[0].warehouse_id);
            extraWhere += ` AND SI.warehouse_id = $${extraParams.length + 1}`;
        }

        if (seller_uuid?.trim()) {
            const sl = await pool.query(
                `SELECT seller_id FROM public.seller_accounts
                 WHERE seller_uuid = $1 AND is_deleted = FALSE`,
                [seller_uuid.trim()]
            );
            if (sl.rowCount === 0) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "No seller found with the provided UUID",
                });
            }
            extraParams.push(sl.rows[0].seller_id);
            extraWhere += ` AND SI.seller_id = $${extraParams.length + 1}`;
        }

        // --------------------------------------------------
        // BUILD ADVANCED SEARCH QUERY
        // --------------------------------------------------
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            /* ── Table & Alias ── */
            table:       'seller_inventory',
            alias:       'SI',
            defaultSort: 'SI.modified_at',

            /* ── Joins ── */
            joinSql: `
                LEFT JOIN public.products         P   ON P.product_id    = SI.product_id
                LEFT JOIN public.seller_accounts  SA  ON SA.seller_id    = SI.seller_id
                LEFT JOIN public.seller_warehouse SW  ON SW.warehouse_id = SI.warehouse_id
                LEFT JOIN public.product_types    PT  ON PT.product_type_id = P.product_type_id
                LEFT JOIN public.brand            BR  ON BR.brand_id     = P.brand_id
                LEFT JOIN public.model            MO  ON MO.model_id     = P.model_id
            `,

            /* ── Allowed Search/Sort Fields ── */
            allowedFields: [
                'sku',
                'oem_part_number',
                'product_code',
                'bin_loc',
                'onhand_qty',
                'reserved_qty',
                'available_qty',
                'reorder_level',
                'is_active',
                'modified_at',
                'created_at',
                // joined
                'seller_name',
                'seller_uuid',
                'warehouse_name',
                'warehouse_uuid',
                'product_type_name',
                'brand_name',
                'model_name',
                'is_listed',
            ],

            /* ── Custom Joined Fields ── */
            customFields: {

                // ── Product fields ──
                sku: {
                    select: 'P.sku',
                    search: 'P.sku',
                    sort:   'P.sku',
                },
                oem_part_number: {
                    select: 'P.oem_part_number',
                    search: 'P.oem_part_number',
                    sort:   'P.oem_part_number',
                },
                product_code: {
                    select: 'P.code',
                    search: 'P.code',
                    sort:   'P.code',
                },
                product_uuid: {
                    select: 'P.product_uuid',
                    search: 'P.product_uuid',
                    sort:   null,
                },
                price: {
                    select: 'P.price',
                    search: null,
                    sort:   'P.price',
                },
                price_after_sale: {
                    select: 'P.price_after_sale',
                    search: null,
                    sort:   'P.price_after_sale',
                },
                is_listed: {
                    select: 'P.is_listed',
                    search: 'P.is_listed',
                    sort:   'P.is_listed',
                },

                // ── Computed stock fields ──
                available_qty: {
                    select: '(SI.onhand_qty - SI.reserved_qty)',
                    search: null,
                    sort:   '(SI.onhand_qty - SI.reserved_qty)',
                },

                // ── Seller ──
                seller_name: {
                    select: 'SA.business_name',
                    search: 'SA.business_name',
                    sort:   'SA.business_name',
                },
                seller_uuid: {
                    select: 'SA.seller_uuid',
                    search: 'SA.seller_uuid',
                    sort:   null,
                },

                // ── Warehouse ──
                warehouse_name: {
                    select: 'SW.warehouse_name',
                    search: 'SW.warehouse_name',
                    sort:   'SW.warehouse_name',
                },
                warehouse_uuid: {
                    select: 'SW.warehouse_uuid',
                    search: 'SW.warehouse_uuid',
                    sort:   null,
                },
                warehouse_location: {
                    select: 'SW.warehouse_address',
                    search: 'SW.warehouse_address',
                    sort:   null,
                },

                // ── Product Type ──
                product_type_name: {
                    select: 'PT.name',
                    search: 'PT.name',
                    sort:   'PT.name',
                },

                // ── Brand ──
                brand_name: {
                    select: 'BR.name',
                    search: 'BR.name',
                    sort:   'BR.name',
                },

                // ── Model ──
                model_name: {
                    select: 'MO.name',
                    search: 'MO.name',
                    sort:   'MO.name',
                },

                // ── Primary image (subquery) ──
                primary_image: {
                    select: `(
                        SELECT pi.image_url
                        FROM public.product_images pi
                        WHERE pi.product_id = P.product_id
                          AND pi.image_type = 'PRIMARY'
                          AND pi.is_deleted = FALSE
                          AND pi.is_active  = TRUE
                        LIMIT 1
                    )`,
                    search: null,
                    sort:   null,
                },

                // ── Last stock movement (subquery) ──
                last_stock_movement: {
                    select: `(
                        SELECT json_build_object(
                            'movement_type',    psh.movement_type,
                            'quantity_changed', psh.quantity_changed,
                            'reason',           psh.reason,
                            'created_at',       psh.created_at
                        )
                        FROM public.product_stock_history psh
                        WHERE psh.product_id   = SI.product_id
                          AND psh.warehouse_id = SI.warehouse_id
                          AND psh.is_deleted   = FALSE
                        ORDER BY psh.created_at DESC
                        LIMIT 1
                    )`,
                    search: null,
                    sort:   null,
                },
            },

            /* ── Base Where — out of stock condition here ── */
            baseWhere: `
                SI.is_deleted                      = FALSE
                AND SI.is_active                   = TRUE
                AND P.is_deleted                   = FALSE
                AND (SI.onhand_qty - SI.reserved_qty) <= 0
                ${extraWhere}
            `,
            baseParams: extraParams,
        });

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Out of stock products fetched successfully",
            error:              null,
            result,
        });

    } catch (err) {
        logger.error("[get-out-of-stock-products] error:", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            err.message,
            error:              err.message,
        });
    }
});


// ============================================================
// UPLOAD PRODUCT IMAGES
// ============================================================

const IMAGES_CONFIG = {
    allowed_types: [".jpg", ".jpeg", ".png", ".webp", ".pdf"],
    max_size_mb:   5,
    min_width:     100,
    min_height:    100,
    max_width:     5000,
    max_height:    5000,

    PRIMARY: {
        max_count: 1,
    },
    GALLERY: {
        max_count: 10,
    },
    DOCUMENT: {
        max_count: 5,
    },
};

async function validateProductImages(body) {
    const path   = require("path");
    const errors = [];

    const { primary_image, gallery_images, document_files } = body;

    // ── Build unified images array with type info ──
    const allImages = [];

    if (primary_image) {
        allImages.push({ url: primary_image, image_type: "PRIMARY" });
    }

    if (Array.isArray(gallery_images)) {
        for (const url of gallery_images) {
            allImages.push({ url, image_type: "GALLERY" });
        }
    }

    if (Array.isArray(document_files)) {
        for (const url of document_files) {
            allImages.push({ url, image_type: "DOCUMENT" });
        }
    }

    // ── Validate each ──
    for (let i = 0; i < allImages.length; i++) {
        const { url: filePath, image_type } = allImages[i];
        const label = `${image_type}[${i}]`;
        const ext   = path.extname(filePath).toLowerCase();

        // 1. File type
        if (!IMAGES_CONFIG.allowed_types.includes(ext)) {
            errors.push(`${label}: invalid file type "${ext}". Allowed: ${IMAGES_CONFIG.allowed_types.join(", ")}`);
            continue;
        }

        // 2. File size
        const sizeBytes = await getFileSize(filePath);
        if (sizeBytes === null) {
            errors.push(`${label}: file not found or unreadable`);
            continue;
        }
        if (sizeBytes > IMAGES_CONFIG.max_size_mb * BYTES_PER_MB) {
            errors.push(`${label}: size ${(sizeBytes / BYTES_PER_MB).toFixed(2)}MB exceeds limit of ${IMAGES_CONFIG.max_size_mb}MB`);
        }

        // 3. Dimensions (skip for DOCUMENT type)
        if (image_type !== "DOCUMENT") {
            const dims = await getImageDimensions(filePath);
            if (!dims) {
                errors.push(`${label}: unable to read image dimensions`);
                continue;
            }
            if (dims.width < IMAGES_CONFIG.min_width || dims.height < IMAGES_CONFIG.min_height) {
                errors.push(`${label}: too small (${dims.width}x${dims.height}px). Minimum: ${IMAGES_CONFIG.min_width}x${IMAGES_CONFIG.min_height}px`);
            }
            if (dims.width > IMAGES_CONFIG.max_width || dims.height > IMAGES_CONFIG.max_height) {
                errors.push(`${label}: too large (${dims.width}x${dims.height}px). Maximum: ${IMAGES_CONFIG.max_width}x${IMAGES_CONFIG.max_height}px`);
            }
        }
    }

    if (errors.length > 0) return { valid: false, error: errors };

    return { valid: true, images: allImages };  
}

responder.on("upload-product-images", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { product_uuid } = req;
        const {
            created_by,
            primary_image,
            gallery_images,
            document_files,
        } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!product_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Product UUID is required",
            });
        }

        if (!created_by?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "created_by is required",
            });
        }

        // At least one image must be provided
        const hasImages = primary_image ||
            (Array.isArray(gallery_images) && gallery_images.length > 0) ||
            (Array.isArray(document_files) && document_files.length > 0);

        if (!hasImages) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "At least one image or document is required",
            });
        }

        // --------------------------------------------------
        // 2. IMAGE VALIDATION
        // --------------------------------------------------
        const imageValidation = await validateProductImages(req.body);
        if (!imageValidation.valid) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Image validation failed",
                error:              imageValidation.error,
            });
        }

        const validatedImages = imageValidation.images;

        // --------------------------------------------------
        // 3. CHECK PRODUCT EXISTS
        // --------------------------------------------------
        const productCheck = await pool.query(
            `SELECT product_id, code AS product_code
             FROM public.products
             WHERE product_uuid = $1
               AND is_deleted   = FALSE
               AND is_active    = TRUE`,
            [product_uuid]
        );

        if (productCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active product found with the provided UUID",
            });
        }

        const { product_id, product_code } = productCheck.rows[0];

        // --------------------------------------------------
        // 4. CHECK PRIMARY IMAGE LIMIT
        //    Only 1 PRIMARY allowed per product
        // --------------------------------------------------
        const incomingPrimary = validatedImages.filter(img => img.image_type === "PRIMARY");

        if (incomingPrimary.length > 0) {
            const existingPrimary = await pool.query(
                `SELECT product_image_id FROM public.product_images
                 WHERE product_id  = $1
                   AND image_type  = 'PRIMARY'
                   AND is_deleted  = FALSE
                   AND is_active   = TRUE`,
                [product_id]
            );
            if (existingPrimary.rowCount > 0) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2002,
                    message:            "Action not allowed",
                    error:              "A primary image already exists. Delete or replace the existing primary image first",
                });
            }
        }

        // --------------------------------------------------
        // 5. CHECK GALLERY LIMIT
        //    Max 10 GALLERY images per product
        // --------------------------------------------------
        const incomingGallery = validatedImages.filter(img => img.image_type === "GALLERY");

        if (incomingGallery.length > 0) {
            const existingGallery = await pool.query(
                `SELECT COUNT(*) AS count FROM public.product_images
                 WHERE product_id = $1
                   AND image_type = 'GALLERY'
                   AND is_deleted = FALSE
                   AND is_active  = TRUE`,
                [product_id]
            );
            const existingCount = parseInt(existingGallery.rows[0].count, 10);
            if (existingCount + incomingGallery.length > IMAGES_CONFIG.GALLERY.max_count) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2002,
                    message:            "Action not allowed",
                    error:              `Adding ${incomingGallery.length} gallery image(s) would exceed the maximum of ${IMAGES_CONFIG.GALLERY.max_count}. Currently ${existingCount} exist`,
                });
            }
        }

        // --------------------------------------------------
        // 6. CHECK DOCUMENT LIMIT
        //    Max 5 DOCUMENT files per product
        // --------------------------------------------------
        const incomingDocuments = validatedImages.filter(img => img.image_type === "DOCUMENT");

        if (incomingDocuments.length > 0) {
            const existingDocs = await pool.query(
                `SELECT COUNT(*) AS count FROM public.product_images
                 WHERE product_id = $1
                   AND image_type = 'DOCUMENT'
                   AND is_deleted = FALSE
                   AND is_active  = TRUE`,
                [product_id]
            );
            const existingCount = parseInt(existingDocs.rows[0].count, 10);
            if (existingCount + incomingDocuments.length > IMAGES_CONFIG.DOCUMENT.max_count) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2002,
                    message:            "Action not allowed",
                    error:              `Adding ${incomingDocuments.length} document(s) would exceed the maximum of ${IMAGES_CONFIG.DOCUMENT.max_count}. Currently ${existingCount} exist`,
                });
            }
        }

        // --------------------------------------------------
        // 7. PROCESS IMAGES — move temp files to assets dir
        // --------------------------------------------------
        const processedImages = await Promise.all(
            validatedImages.map(async (img) => {
                if (img.url.startsWith("/assets/products/")) {
                    return img; // Already in assets — retain
                }
                const ext      = path.extname(img.url).toLowerCase();
                const destName = `${product_code}_${randomUUID()}${ext}`;
                const destPath = path.join(uploadDir, destName);
                await fse.move(img.url, destPath, { overwrite: true });
                return {
                    ...img,
                    url: `/assets/products/${destName}`,
                };
            })
        );

        // --------------------------------------------------
        // 8. GET CURRENT MAX SORT ORDER PER TYPE
        // --------------------------------------------------
        const sortOrderRes = await pool.query(
            `SELECT image_type, COALESCE(MAX(sort_order), 0) AS max_sort
             FROM public.product_images
             WHERE product_id = $1
               AND is_deleted = FALSE
             GROUP BY image_type`,
            [product_id]
        );

        const sortMap = {};
        for (const row of sortOrderRes.rows) {
            sortMap[row.image_type] = parseInt(row.max_sort, 10);
        }

        const typeCounters = {
            PRIMARY:  sortMap["PRIMARY"]  || 0,
            GALLERY:  sortMap["GALLERY"]  || 0,
            DOCUMENT: sortMap["DOCUMENT"] || 0,
        };

        // --------------------------------------------------
        // 9. BATCH INSERT
        // --------------------------------------------------
        const now          = new Date();
        const insertValues = [];
        const insertParams = [];
        let   paramIdx     = 1;

        for (const img of processedImages) {
            typeCounters[img.image_type] += 1;
            const sort_order = typeCounters[img.image_type];

            insertValues.push(
                `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
            );
            insertParams.push(
                product_id,
                img.url,
                img.image_type,
                sort_order,
                created_by,
                created_by,
                now
            );
        }

        await client.query("BEGIN");

        const insertResult = await client.query({
            text: `
                INSERT INTO public.product_images
                    (product_id, image_url, image_type, sort_order, created_by, assigned_to, assigned_at)
                VALUES ${insertValues.join(", ")}
                RETURNING product_image_uuid, image_url, image_type, sort_order, created_at
            `,
            values: insertParams,
        });

        await client.query("COMMIT");

        // --------------------------------------------------
        // 10. RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            `${insertResult.rowCount} image(s) uploaded successfully`,
            data: {
                product_uuid,
                uploaded_count: insertResult.rowCount,
                images:         insertResult.rows,
            },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (upload-product-images):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Upload failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});


// ============================================================
// DELETE PRODUCT IMAGE
// ============================================================

responder.on("delete-product-image", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { product_image_uuid } = req;
        const { deleted_by }         = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!product_image_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Product image UUID is required",
            });
        }

        if (!deleted_by?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "deleted by is required",
            });
        }

        // --------------------------------------------------
        // 2. FETCH IMAGE RECORD
        // --------------------------------------------------
        const imageCheck = await pool.query(
            `SELECT
                pi.product_image_id,
                pi.product_image_uuid,
                pi.image_type,
                pi.image_url,
                pi.sort_order,
                pi.product_id,
                p.product_uuid
             FROM public.product_images pi
             LEFT JOIN public.products p ON p.product_id = pi.product_id
             WHERE pi.product_image_uuid = $1
               AND pi.is_deleted         = FALSE`,
            [product_image_uuid]
        );

        if (imageCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active image found with the provided UUID",
            });
        }

        const image = imageCheck.rows[0];

        // --------------------------------------------------
        // 3. BUSINESS RULE — PRIMARY image protection
        //    Cannot delete PRIMARY if it's the only image
        //    and product is listed / active
        // --------------------------------------------------
        if (image.image_type === "PRIMARY") {
            const productCheck = await pool.query(
                `SELECT is_listed, is_active FROM public.products
                 WHERE product_id = $1 AND is_deleted = FALSE`,
                [image.product_id]
            );

            const product = productCheck.rows[0];

            if (product?.is_listed === true) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2002,
                    message:            "Action not allowed",
                    error:              "Cannot delete the primary image of a listed product. Unlist the product first or replace the primary image",
                });
            }

            // Check if it's the only image
            const imageCount = await pool.query(
                `SELECT COUNT(*) AS count FROM public.product_images
                 WHERE product_id = $1
                   AND is_deleted = FALSE
                   AND is_active  = TRUE`,
                [image.product_id]
            );

            if (parseInt(imageCount.rows[0].count, 10) === 1) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2002,
                    message:            "Action not allowed",
                    error:              "Cannot delete the only image of a product. Upload a replacement image first",
                });
            }
        }

        // --------------------------------------------------
        // 4. SOFT DELETE
        // --------------------------------------------------
        const now = new Date();

        await client.query("BEGIN");

        await client.query(
            `UPDATE public.product_images SET
                is_deleted  = TRUE,
                is_active   = FALSE,
                deleted_at  = $1,
                deleted_by  = $2,
                modified_at = $1,
                modified_by = $2
             WHERE product_image_uuid = $3
               AND is_deleted         = FALSE`,
            [now, deleted_by, product_image_uuid]
        );

        // --------------------------------------------------
        // 5. RE-ORDER remaining images of same type
        //    Fill the sort_order gap left by deleted image
        // --------------------------------------------------
        await client.query(
            `WITH ranked AS (
                SELECT product_image_id,
                       ROW_NUMBER() OVER (
                           PARTITION BY product_id, image_type
                           ORDER BY sort_order ASC
                       ) AS new_sort_order
                FROM public.product_images
                WHERE product_id  = $1
                  AND image_type  = $2
                  AND is_deleted  = FALSE
                  AND is_active   = TRUE
            )
            UPDATE public.product_images pi
            SET sort_order  = r.new_sort_order,
                modified_at = NOW()
            FROM ranked r
            WHERE pi.product_image_id = r.product_image_id`,
            [image.product_id, image.image_type]
        );

        await client.query("COMMIT");

        // --------------------------------------------------
        // 6. RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Product image deleted successfully",
            data: {
                product_image_uuid,
                product_uuid:   image.product_uuid,
                image_type:     image.image_type,
                image_url:      image.image_url,
                deleted_at:     now,
            },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (delete-product-image):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Delete failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------
// CREATE SELLER INVENTORY
// --------------------------------------

responder.on("create-seller-inventory", async (req, cb) => {
    const client = await pool.connect();

    try {
        const {
            seller_uuid,
            product_uuid,
            warehouse_uuid,
            onhand_qty,
            buffer_qty,
            reorder_level,
            bin_loc,
            created_by,
        } = req.body;

        const now         = new Date();
        const assigned_to = created_by;
        const assigned_at = now;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!seller_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Seller UUID is required" });

        if (!product_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Product UUID is required" });

        if (!warehouse_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Warehouse UUID is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created by is required" });

        if (onhand_qty === undefined || onhand_qty === null || isNaN(Number(onhand_qty)))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Valid onhand quantity is required" });

        if (Number(onhand_qty) < 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "onhand quantity cannot be negative" });

        if (buffer_qty !== undefined && buffer_qty !== null && isNaN(Number(buffer_qty)))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buffer quantity must be a valid number" });

        if (reorder_level !== undefined && reorder_level !== null && isNaN(Number(reorder_level)))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "reorder level must be a valid number" });

        await client.query("BEGIN");

        // --------------------------------------------------
        // 2. RESOLVE UUIDs → IDs (parallel)
        // --------------------------------------------------
        const [sellerResult, productResult, warehouseResult] = await Promise.all([
            client.query({
                text: `SELECT seller_id FROM public.seller_accounts
                       WHERE seller_uuid = $1
                         AND is_deleted  = FALSE
                         AND is_active   = TRUE`,
                values: [seller_uuid.trim()],
            }),
            client.query({
                text: `SELECT product_id, seller_id FROM public.products
                       WHERE product_uuid = $1
                         AND is_deleted   = FALSE
                         AND is_active    = TRUE`,
                values: [product_uuid.trim()],
            }),
            client.query({
                text: `SELECT warehouse_id, seller_id FROM public.seller_warehouse
                       WHERE warehouse_uuid = $1
                         AND is_deleted     = FALSE
                         AND is_active      = TRUE`,
                values: [warehouse_uuid.trim()],
            }),
        ]);

        if (sellerResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active seller found with the provided UUID" });
        }

        if (productResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active product found with the provided UUID" });
        }

        if (warehouseResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active warehouse found with the provided UUID" });
        }

        const { seller_id }                                    = sellerResult.rows[0];
        const { product_id, seller_id: product_seller_id }    = productResult.rows[0];
        const { warehouse_id, seller_id: warehouse_seller_id} = warehouseResult.rows[0];

        // --------------------------------------------------
        // 3. OWNERSHIP CHECK
        // All three must belong to the same seller
        // --------------------------------------------------
        if (
    Number(seller_id) !== Number(product_seller_id) ||
    Number(seller_id) !== Number(warehouse_seller_id)
) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Product and warehouse must belong to the provided seller",
            });
        }

        // --------------------------------------------------
        // 4. DUPLICATE CHECK
        // --------------------------------------------------
        const duplicateCheck = await client.query({
            text: `SELECT 1 FROM public.seller_inventory
                   WHERE product_id   = $1
                     AND warehouse_id = $2
                     AND is_deleted   = FALSE
                     AND is_active = TRUE
                   LIMIT 1`,
            values: [product_id, warehouse_id],
        });

        if (duplicateCheck.rowCount > 0) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2002,
                message:            "Duplicate entry",
                error:              "An inventory record already exists for this product in the selected warehouse",
            });
        }

        // --------------------------------------------------
        // 5. INSERT seller_inventory
        // --------------------------------------------------
        const inventoryInsert = await client.query({
            text: `
                INSERT INTO public.seller_inventory (
                    warehouse_id,
                    seller_id,
                    product_id,
                    onhand_qty,
                    reserved_qty,
                    buffer_qty,
                    bin_loc,
                    reorder_level,
                    assigned_to,
                    assigned_at,
                    created_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING inventory_id, inventory_uuid
            `,
            values: [
                warehouse_id,
                seller_id,
                product_id,
                Number(onhand_qty),
                0,
                buffer_qty    !== undefined && buffer_qty    !== null ? Number(buffer_qty)    : 0,
                bin_loc       || null,
                reorder_level !== undefined && reorder_level !== null ? Number(reorder_level) : null,
                assigned_to,
                assigned_at,
                created_by,
            ],
        });

        const { inventory_id, inventory_uuid } = inventoryInsert.rows[0];

        // --------------------------------------------------
        // 6. INSERT product_stock_history (only if qty > 0)
        // --------------------------------------------------
        if (Number(onhand_qty) > 0) {
            await client.query({
                text: `
                    INSERT INTO public.product_stock_history (
                        product_id,
                        warehouse_id,
                        movement_type,
                        quantity_before,
                        quantity_changed,
                        quantity_after,
                        reason,
                        reference_type,
                        reference_id,
                        notes,
                        assigned_to,
                        assigned_at,
                        created_by
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                `,
                values: [
                    product_id,
                    warehouse_id,
                    "IN",
                    0,
                    Number(onhand_qty),
                    Number(onhand_qty),
                    "Initial stock entry for warehouse",
                    "INVENTORY_CREATE",
                    inventory_id,
                    `Inventory created with initial stock of ${Number(onhand_qty)}`,
                    assigned_to,
                    assigned_at,
                    created_by,
                ],
            });
        }

        await client.query("COMMIT");

        // --------------------------------------------------
        // 7. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Seller inventory created successfully",
            data: {
                inventory_id,
                inventory_uuid,
                product_id,
                warehouse_id,
                seller_id,
                onhand_qty:    Number(onhand_qty),
                reserved_qty:  0,
                buffer_qty:    buffer_qty    !== undefined && buffer_qty    !== null ? Number(buffer_qty)    : 0,
                reorder_level: reorder_level !== undefined && reorder_level !== null ? Number(reorder_level) : null,
                bin_loc:       bin_loc || null,
            },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (create-seller-inventory):", err);
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// ADVANCED FILTER 
// --------------------------------------------------

//OLD

// responder.on('advancefilter-products', async (req, cb) => {
//     try {
//         const accessScope = req.dataAccessScope;
//         let extraWhere = '';
//         let extraParams = [];

//         if (accessScope && accessScope.type === 'PRIVATE') {
//             extraWhere = ' AND P.created_by = $extraUser';
//             extraParams.push(accessScope.user_id);
//         }

//         const result = await buildAdvancedSearchQuery({
//             pool,
//             reqBody: req.body,

//             /* ---------------- Table & Alias ---------------- */
//             table: 'products',
//             alias: 'P',
//             defaultSort: 'created_at',

//             /* ---------------- Joins ---------------- */
//             joinSql: `
//                 LEFT JOIN public.product_types  PT       ON PT.product_type_id   = P.product_type_id
//                 LEFT JOIN public.uom            U        ON U.uom_id             = P.uom_id
//                 LEFT JOIN public.manufacturer   M        ON M.manufacturer_id    = P.manufacturer_id
//                 LEFT JOIN public.users          creators ON creators.user_uuid   = P.created_by
//                 LEFT JOIN public.users          updaters ON updaters.user_uuid   = P.modified_by
//             `,

//             /* ---------------- Allowed Search/Sort Fields ---------------- */
//             allowedFields: [
//                 'name',
//                 'code',
//                 'weight',
//                 'length',
//                 'width',
//                 'height',
//                 'barcode_number',
//                 'description',
//                 'is_active',
//                 'created_at',
//                 'modified_at',
//                 // joined fields
//                 'product_type_uuid',
//                 'product_type_name',
//                 'uom_uuid',
//                 'uom_name',
//                 'manufacturer_uuid',
//                 'manufacturer_name',
//                 'createdByName',
//                 'updatedByName'
//             ],

//             /* ---------------- Custom Joined Fields ---------------- */
//             customFields: {
//                 // Product Type
//                 product_type_uuid: {
//                     select: 'PT.product_type_uuid',
//                     search: 'PT.product_type_uuid',
//                     sort:   'PT.product_type_uuid'
//                 },
//                 product_type_name: {
//                     select: 'PT.name',
//                     search: 'PT.name',
//                     sort:   'PT.name'
//                 },

//                 // UOM
//                 uom_uuid: {
//                     select: 'U.uom_uuid',
//                     search: 'U.uom_uuid',
//                     sort:   'U.uom_uuid'
//                 },
//                 uom_name: {
//                     select: 'U.name',
//                     search: 'U.name',
//                     sort:   'U.name'
//                 },

//                 // Manufacturer
//                 manufacturer_uuid: {
//                     select: 'M.manufacturer_uuid',
//                     search: 'M.manufacturer_uuid',
//                     sort:   'M.manufacturer_uuid'
//                 },
//                 manufacturer_name: {
//                     select: 'M.name',
//                     search: 'M.name',
//                     sort:   'M.name'
//                 },

//                 // Audit
//                 createdByName: {
//                     select: 'creators.username',
//                     search: 'creators.username',
//                     sort:   'creators.username'
//                 },
//                 updatedByName: {
//                     select: 'updaters.username',
//                     search: 'updaters.username',
//                     sort:   'updaters.username'
//                 },

//                 // Parts — aggregated as JSON array
//                 parts: {
//                     select: `(
//                         SELECT COALESCE(
//                             JSON_AGG(
//                                 JSON_BUILD_OBJECT(
//                                     'part_id',                  PR.part_id,
//                                     'part_uuid',                PR.part_uuid,
//                                     'part_name',                PR.part_name,
//                                     'is_primary',               PPM.is_primary,
//                                     'product_part_mapping_uuid', PPM.product_part_mapping_uuid
//                                 )
//                                 ORDER BY PPM.is_primary DESC, PPM.created_at ASC
//                             ),
//                             '[]'::json
//                         )
//                         FROM public.product_part_mapping PPM
//                         LEFT JOIN public.parts PR ON PR.part_id = PPM.part_id
//                         WHERE PPM.product_id = P.product_id
//                           AND PPM.is_deleted = FALSE
//                           AND PPM.is_active  = TRUE
//                     )`,
//                     search: null,  
//                     sort:   null   
//                 },

//                 // Trading Types — aggregated as JSON array
//                 trading_types: {
//                     select: `(
//                         SELECT COALESCE(
//                             JSON_AGG(
//                                 JSON_BUILD_OBJECT(
//                                     'trading_type_id',          TT.trading_type_id,
//                                     'trading_type_uuid',        TT.trading_type_uuid,
//                                     'trading_type_name',        TT.name,
//                                     'product_trading_type_uuid', PTT.product_trading_type_uuid
//                                 )
//                                 ORDER BY PTT.created_at ASC
//                             ),
//                             '[]'::json
//                         )
//                         FROM public.product_trading_types PTT
//                         LEFT JOIN public.trading_types TT ON TT.trading_type_id = PTT.trading_type_id
//                         WHERE PTT.product_id = P.product_id
//                           AND PTT.is_deleted = FALSE
//                           AND PTT.is_active  = TRUE
//                     )`,
//                     search: null,  
//                     sort:   null   
//                 }
//             },

//             /* ---------------- Base Where ---------------- */
//             baseWhere: `
//                 P.is_deleted = FALSE ${extraWhere}
//             `,
//             baseParams: extraParams
//         });

//         return cb(null, {
//             header_type       : "SUCCESS",
//             message_visibility: true,
//             status            : true,
//             code              : 1000,
//             message           : "Products fetched successfully",
//             error             : null,
//             result
//         });

//     } catch (err) {
//         console.error('[advancefilter-products] error:', err);
//         return cb(null, {
//             header_type       : "ERROR",
//             message_visibility: true,
//             status            : false,
//             code              : 2004,
//             message           : err.message,
//             error             : err.message
//         });
//     }
// });

// --------------------------------------------------
// PRODUCT LIST 
// --------------------------------------------------


responder.on('product-list', async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        const { warehouse_uuid } = req.body;

        let extraWhereParts = [];
        let baseParams      = [];

        // ---------------- Private access scope ----------------
        if (accessScope && accessScope.type === 'PRIVATE') {
            baseParams.push(accessScope.user_id);
            extraWhereParts.push(`P.created_by = $${baseParams.length}`);
        }

        // ---------------- Warehouse filter (EXISTS) ----------------
        if (warehouse_uuid) {
            baseParams.push(warehouse_uuid);
            extraWhereParts.push(`
                EXISTS (
                    SELECT 1 FROM public.seller_inventory SI
                    JOIN public.seller_warehouse W ON W.warehouse_id = SI.warehouse_id
                    WHERE SI.product_id = P.product_id
                      AND SI.is_deleted = FALSE
                      AND W.warehouse_uuid = $${baseParams.length}
                )
            `);
        }

        const baseWhere = `P.is_deleted = FALSE` +
            (extraWhereParts.length ? ` AND ${extraWhereParts.join(' AND ')}` : '');

        // Reusable subquery for available stock (onhand - reserved) summed across inventory details
        const availableStockExpr = `(
            SELECT COALESCE(SUM(SI.onhand_qty - SI.reserved_qty), 0)
            FROM public.seller_inventory SI
            WHERE SI.product_id = P.product_id
              AND SI.is_deleted = FALSE
        )`;

        const reorderLevelExpr = `(
            SELECT COALESCE(MAX(SI.reorder_level), 0)
            FROM public.seller_inventory SI
            WHERE SI.product_id = P.product_id
              AND SI.is_deleted = FALSE
        )`;

        const inventoryStatusExpr = `(
            CASE
                WHEN ${availableStockExpr} <= 0 THEN 'OUT_OF_STOCK'
                WHEN ${availableStockExpr} <= ${reorderLevelExpr} THEN 'LOW_STOCK'
                ELSE 'IN_STOCK'
            END
        )`;

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            table: 'products',
            alias: 'P',
            defaultSort: 'created_at',

            joinSql: `
                LEFT JOIN public.product_types          PT  ON PT.product_type_id            = P.product_type_id
                LEFT JOIN public.seller_accounts        SA  ON SA.seller_id                  = P.seller_id
                LEFT JOIN public.brand                  B   ON B.brand_id                    = P.brand_id
                LEFT JOIN public.model                  MD  ON MD.model_id                   = P.model_id
                LEFT JOIN public.product_listing_status PLS ON PLS.product_listing_status_id = P.product_listing_status_id
                LEFT JOIN public.product_conditions     PC  ON PC.condition_id               = P.condition_id
                LEFT JOIN public.users                  creators ON creators.user_uuid       = P.created_by
                LEFT JOIN public.users                  updaters ON updaters.user_uuid       = P.modified_by
            `,

            allowedFields: [
                'sku',
                'code',
                'price',
                'price_after_sale',
                'is_active',
                'is_listed',
                'verify_status',
                'created_at',
                'modified_at',
                'product_type_uuid',
                'product_type_name',
                'seller_uuid',
                'seller_name',
                'brand_uuid',
                'brand_name',
                'model_uuid',
                'model_name',
                'product_listing_status_uuid',
                'product_listing_status_name',
                'condition_uuid',
                'condition_name',
                'createdByName',
                'updatedByName',
                'inventory_status',
            ],

            customFields: {
                product_type_uuid: { select: 'PT.product_type_uuid', search: 'PT.product_type_uuid', sort: 'PT.product_type_uuid' },
                product_type_name: { select: 'PT.name',              search: 'PT.name',              sort: 'PT.name' },

                seller_uuid: { select: 'SA.seller_uuid', search: 'SA.seller_uuid', sort: 'SA.seller_uuid' },
                seller_name: { select: 'SA.business_name', search: 'SA.business_name', sort: 'SA.business_name' },

                brand_uuid: { select: 'B.brand_uuid', search: 'B.brand_uuid', sort: 'B.brand_uuid' },
                brand_name: { select: 'B.name',       search: 'B.name',       sort: 'B.name' },

                model_uuid: { select: 'MD.model_uuid', search: 'MD.model_uuid', sort: 'MD.model_uuid' },
                model_name: { select: 'MD.name',       search: 'MD.name',       sort: 'MD.name' },

                product_listing_status_uuid: { select: 'PLS.product_listing_status_uuid', search: 'PLS.product_listing_status_uuid', sort: 'PLS.product_listing_status_uuid' },
                product_listing_status_name: { select: 'PLS.name', search: 'PLS.name', sort: 'PLS.name' },

                condition_uuid: { select: 'PC.condition_uuid', search: 'PC.condition_uuid', sort: 'PC.condition_uuid' },
                condition_name: { select: 'PC.name',           search: 'PC.name',           sort: 'PC.name' },

                createdByName: { select: 'creators.username', search: 'creators.username', sort: 'creators.username' },
                updatedByName: { select: 'updaters.username', search: 'updaters.username', sort: 'updaters.username' },

                // Aggregated stock numbers (display only)
                total_onhand_qty: {
                    select: `(
                        SELECT COALESCE(SUM(SI.onhand_qty), 0)
                        FROM public.seller_inventory SI
                        WHERE SI.product_id = P.product_id AND SI.is_deleted = FALSE
                    )`,
                    search: null,
                    sort: null,
                },
                total_reserved_qty: {
                    select: `(
                        SELECT COALESCE(SUM(SI.reserved_qty), 0)
                        FROM public.seller_inventory SI
                        WHERE SI.product_id = P.product_id AND SI.is_deleted = FALSE
                    )`,
                    search: null,
                    sort: null,
                },

                // Derived inventory status — filterable AND sortable via the same expression
                inventory_status: {
                    select: inventoryStatusExpr,
                    search: inventoryStatusExpr,   // enables SearchTerm.inventory_status = 'IN_STOCK'
                    sort:   inventoryStatusExpr,
                },

                // Images
                images: {
                    select: `(
                        SELECT COALESCE(
                            JSON_AGG(
                                JSON_BUILD_OBJECT(
                                    'image_url',  PI.image_url,
                                    'image_type', PI.image_type,
                                    'sort_order', PI.sort_order
                                ) ORDER BY PI.sort_order ASC
                            ),
                            '[]'::json
                        )
                        FROM public.product_images PI
                        WHERE PI.product_id = P.product_id AND PI.is_deleted = FALSE
                    )`,
                    search: null,
                    sort: null,
                },
            },

            baseWhere,
            baseParams,
        });

        return cb(null, {
            header_type       : "SUCCESS",
            message_visibility: true,
            status            : true,
            code              : 1000,
            message           : "Products fetched successfully",
            error             : null,
            result
        });

    } catch (err) {
        console.error('[product-list] error:', err);
        return cb(null, {
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : err.message,
            error             : err.message
        });
    }
});

// --------------------------------------------------
// PRODUCT SEARCH 
// --------------------------------------------------


responder.on('product-search', async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        const { q } = req.body;

        let extraWhereParts = [];
        let baseParams      = [];

        if (accessScope && accessScope.type === 'PRIVATE') {
            baseParams.push(accessScope.user_id);
            extraWhereParts.push(`P.created_by = $${baseParams.length}`);
        }

        if (q?.trim()) {
            baseParams.push(`%${q.trim()}%`);
            const idx = baseParams.length;
            extraWhereParts.push(`(
                P.sku                            ILIKE $${idx}
                OR P.code                        ILIKE $${idx}
                OR P.oem_part_number             ILIKE $${idx}
                OR P.aftermarket_number          ILIKE $${idx}
                OR P.barcode_number              ILIKE $${idx}
                OR P.manufacturer_name           ILIKE $${idx}
                OR P.equivalent_oem_part_numbers::text ILIKE $${idx}
            )`);
        }

        const baseWhere = `P.is_deleted = FALSE` +
            (extraWhereParts.length ? ` AND ${extraWhereParts.join(' AND ')}` : '');

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            table: 'products',
            alias: 'P',
            defaultSort: 'created_at',

            joinSql: `
                LEFT JOIN public.product_types          PT  ON PT.product_type_id            = P.product_type_id
                LEFT JOIN public.seller_accounts        SA  ON SA.seller_id                  = P.seller_id
                LEFT JOIN public.brand                  B   ON B.brand_id                    = P.brand_id
                LEFT JOIN public.model                  MD  ON MD.model_id                   = P.model_id
                LEFT JOIN public.product_listing_status PLS ON PLS.product_listing_status_id = P.product_listing_status_id
            `,

            allowedFields: [
                'sku',
                'code',
                'oem_part_number',
                'aftermarket_number',
                'barcode_number',
                'manufacturer_name',
                'price',
                'created_at',
                'product_type_name',
                'seller_name',
                'brand_name',
                'model_name',
                'product_listing_status_name',
            ],

            customFields: {
                product_type_name:           { select: 'PT.name',  search: 'PT.name',  sort: 'PT.name' },
                seller_name:                  { select: 'SA.business_name', search: 'SA.business_name', sort: 'SA.business_name' },
                brand_name:                   { select: 'B.name',   search: 'B.name',   sort: 'B.name' },
                model_name:                   { select: 'MD.name',  search: 'MD.name',  sort: 'MD.name' },
                product_listing_status_name:  { select: 'PLS.name', search: 'PLS.name', sort: 'PLS.name' },

                equivalent_oem_part_numbers: {
                    select: 'P.equivalent_oem_part_numbers',
                    search: null,
                    sort: null,
                },
            },

            baseWhere,
            baseParams,
        });

        // ---------------- Mark which field(s) matched (post-fetch, JS) ----------------
        if (q?.trim() && Array.isArray(result.data)) {
            const term = q.trim().toLowerCase();
            const fieldsToCheck = [
                'sku', 'code', 'oem_part_number', 'aftermarket_number',
                'barcode_number', 'manufacturer_name'
            ];
            result.data = result.data.map(row => {
                const matched = [];
                for (const f of fieldsToCheck) {
                    if (row[f] && String(row[f]).toLowerCase().includes(term)) matched.push(f);
                }
                if (row.equivalent_oem_part_numbers) {
                    const eqStr = JSON.stringify(row.equivalent_oem_part_numbers).toLowerCase();
                    if (eqStr.includes(term)) matched.push('equivalent_oem_part_numbers');
                }
                return { ...row, matched_in: matched };
            });
        }

        return cb(null, {
            header_type       : "SUCCESS",
            message_visibility: true,
            status            : true,
            code              : 1000,
            message           : "Search results fetched successfully",
            error             : null,
            result
        });

    } catch (err) {
        console.error('[product-search] error:', err);
        return cb(null, {
            header_type       : "ERROR",
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : err.message,
            error             : err.message
        });
    }
});

// --------------------------------------------------
// UPDATE OEM EQUIVALENTS
// --------------------------------------------------

responder.on("update-oem-equivalent", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { oem_uuid } = req;
        const {
            modified_by,
            oem_part_number,
            equivalent_oem_part_numbers,
            is_active,
        } = req.body;

        const now         = new Date();
        const assigned_to = modified_by;
        const assigned_at = now;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!oem_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "OEM UUID is required" });

        if (!modified_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "modified by is required" });

        if (!oem_part_number?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "oem part number is required" });

        if (!Array.isArray(equivalent_oem_part_numbers) || equivalent_oem_part_numbers.length === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "equivalent oem part numbers must be a non-empty array" });

        const invalidEntry = equivalent_oem_part_numbers.find(
            (v) => typeof v !== "string" || !v.trim()
        );
        if (invalidEntry !== undefined)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "All entries in equivalent oem part numbers must be non-empty strings" });

        await client.query("BEGIN");

        // --------------------------------------------------
        // 2. FETCH EXISTING RECORD
        // --------------------------------------------------
        const existingResult = await client.query({
            text: `SELECT oem_id, oem_uuid, oem_part_number
                   FROM public.oem_equivalents
                   WHERE oem_uuid = $1 AND is_deleted = FALSE`,
            values: [oem_uuid],
        });

        if (existingResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No OEM equivalent record found with the provided UUID" });
        }

        const existing = existingResult.rows[0];

        // --------------------------------------------------
        // 3. CHECK DUPLICATE oem_part_number (exclude self)
        // --------------------------------------------------
        const duplicateCheck = await client.query({
            text: `SELECT 1 FROM public.oem_equivalents
                   WHERE oem_part_number = $1
                     AND oem_uuid       != $2
                     AND is_deleted      = FALSE`,
            values: [oem_part_number.trim(), oem_uuid],
        });

        if (duplicateCheck.rowCount > 0) {
            await client.query("ROLLBACK");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2002, message: "Conflict", error: "Another record with this oem part number already exists" });
        }

        // --------------------------------------------------
        // 4. UPDATE oem_equivalents
        // --------------------------------------------------
        const updateResult = await client.query({
            text: `
                UPDATE public.oem_equivalents SET
                    oem_part_number              = $1,
                    equivalent_oem_part_numbers  = $2,
                    is_active                    = $3,
                    modified_by                  = $4,
                    modified_at                  = $5,
                    assigned_to                  = $6,
                    assigned_at                  = $7
                WHERE oem_uuid  = $8
                  AND is_deleted = FALSE
                RETURNING
                    oem_id,
                    oem_uuid,
                    oem_part_number,
                    equivalent_oem_part_numbers,
                    is_active,
                    modified_by,
                    modified_at
            `,
            values: [
                oem_part_number.trim(),
                JSON.stringify(equivalent_oem_part_numbers.map((v) => v.trim())),
                is_active !== undefined ? is_active : true,
                modified_by,
                now,
                assigned_to,
                assigned_at,
                oem_uuid,
            ],
        });

        await client.query("COMMIT");

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "OEM equivalent updated successfully",
            data:               { ...updateResult.rows[0] },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (update-oem-equivalent):", err);
        saveErrorLog({
            api_name:  "update-oem-equivalent",
            method:    "RESPONDER",
            payload:   req,
            message:   "Internal server error",
            stack:     err.stack,
            error_code: 2004,
        });
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// DELETE OEM EQUIVALENTS
// --------------------------------------------------

responder.on("delete-oem-equivalent", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { oem_uuid } = req;
        const { deleted_by } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!oem_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "OEM UUID is required",
            });
        }

        if (!deleted_by?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "deleted by is required",
            });
        }

        // --------------------------------------------------
        // 2. FETCH OEM RECORD
        // --------------------------------------------------
        const oemCheck = await pool.query(
            `SELECT
                oem_id,
                oem_uuid,
                oem_part_number,
                equivalent_oem_part_numbers,
                is_active
             FROM public.oem_equivalents
             WHERE oem_uuid   = $1
               AND is_deleted = FALSE`,
            [oem_uuid]
        );

        if (oemCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active OEM equivalent record found with the provided UUID",
            });
        }

        const oem = oemCheck.rows[0];

        // --------------------------------------------------
        // 3. BUSINESS RULE — Cannot delete if active products
        //    are still referencing this oem_part_number
        // --------------------------------------------------
        const productRefCheck = await pool.query(
            `SELECT COUNT(*) AS count
             FROM public.products
             WHERE oem_part_number = $1
               AND is_deleted      = FALSE
               AND is_active       = TRUE`,
            [oem.oem_part_number]
        );

        if (parseInt(productRefCheck.rows[0].count, 10) > 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2002,
                message:            "Action not allowed",
                error:              `Cannot delete this OEM record. ${productRefCheck.rows[0].count} active product(s) are still referencing oem part number '${oem.oem_part_number}'. Unlink the products first`,
            });
        }

        // --------------------------------------------------
        // 4. SOFT DELETE
        // --------------------------------------------------
        const now = new Date();

        await client.query("BEGIN");

        await client.query(
            `UPDATE public.oem_equivalents SET
                is_deleted  = TRUE,
                is_active   = FALSE,
                deleted_at  = $1,
                deleted_by  = $2,
                modified_at = $1,
                modified_by = $2
             WHERE oem_uuid  = $3
               AND is_deleted = FALSE`,
            [now, deleted_by, oem_uuid]
        );

        await client.query("COMMIT");

        // --------------------------------------------------
        // 5. RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "OEM equivalent deleted successfully",
            data: {
                oem_uuid,
                oem_part_number:             oem.oem_part_number,
                equivalent_oem_part_numbers: oem.equivalent_oem_part_numbers,
                deleted_at:                  now,
            },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (delete-oem-equivalent):", err);
        saveErrorLog({
            api_name:   "delete-oem-equivalent",
            method:     "RESPONDER",
            payload:    req,
            message:    "Internal server error",
            stack:      err.stack,
            error_code: 2004,
        });
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Delete failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// UPDATE PRODUCT PRICE
// --------------------------------------------------

responder.on("update-product-price", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { product_uuid } = req;
        const {
            modified_by,
            price,
            price_after_sale,
            currency_uuid,
            price_effective_from,
            reason,
        } = req.body;

        const now         = new Date();
        const assigned_to = modified_by;
        const assigned_at = now;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!product_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Product UUID is required" });

        if (!modified_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "modified_by is required" });

        if (price === undefined || price === null || isNaN(Number(price)))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Valid price is required" });

        if (Number(price) <= 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Price must be greater than zero" });

        if (price_after_sale === undefined || price_after_sale === null || isNaN(Number(price_after_sale)))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Valid price_after_sale is required" });

        if (Number(price_after_sale) <= 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "price_after_sale must be greater than zero" });

        if (Number(price_after_sale) > Number(price))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "price_after_sale cannot be greater than price" });

        if (!currency_uuid?.trim())
    return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "currency uuid is required" });

        if (!reason?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Reason is required for price update" });

        const effectiveFrom = price_effective_from ? new Date(price_effective_from) : now;

        if (isNaN(effectiveFrom.getTime()))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Invalid price_effective_from date" });

        await client.query("BEGIN");

        // --------------------------------------------------
        // 2. CHECK EDIT LOCK
        // --------------------------------------------------
        const lockCheck = await client.query({
            text: `SELECT 1 FROM public.record_locks
                   WHERE table_name = 'products'
                     AND record_id  = $1
                     AND locked_by  = $2
                     AND is_deleted = FALSE
                     AND expires_at > NOW()`,
            values: [product_uuid, modified_by],
        });

        if (lockCheck.rowCount === 0) {
            await client.query("ROLLBACK");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2005, message: "Update failed", error: "You must lock the record before updating" });
        }

        // --------------------------------------------------
        // 3. FETCH EXISTING PRODUCT
        // --------------------------------------------------
        const existingResult = await client.query({
            text: `SELECT product_id, product_uuid, price, price_after_sale, currency_id, is_deleted
                   FROM public.products
                   WHERE product_uuid = $1 AND is_deleted = FALSE`,
            values: [product_uuid],
        });

        if (existingResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No product found with the provided UUID" });
        }

        const { product_id } = existingResult.rows[0];


        const currencyResult = await client.query({
    text: `SELECT currency_id FROM public.currency
           WHERE currency_uuid = $1 AND is_deleted = FALSE`,
    values: [currency_uuid],
});

if (currencyResult.rowCount === 0) {
    await client.query("ROLLBACK");
    return cb(null, {
        header_type:        "ERROR",
        message_visibility: true,
        status:             false,
        code:               2003,
        message:            "Record not found",
        error:              "No currency found with the provided UUID",
    });
}

const { currency_id } = currencyResult.rows[0];

        // --------------------------------------------------
        // 4. CLOSE previous active price history row
        // --------------------------------------------------
        await client.query({
            text: `UPDATE public.product_price_history
                   SET effective_to = $1,
                       is_active    = FALSE,
                       modified_at  = $2,
                       modified_by  = $3
                   WHERE product_id = $4
                     AND is_active  = TRUE
                     AND is_deleted = FALSE`,
            values: [effectiveFrom, now, modified_by, product_id],
        });

        // --------------------------------------------------
        // 5. INSERT new price history row
        // --------------------------------------------------
        const historyResult = await client.query({
            text: `INSERT INTO public.product_price_history (
                       product_id,
                       price,
                       price_after_sale,
                       currency_id,
                       effective_from,
                       effective_to,
                       reason,
                       is_active,
                       created_by,
                       assigned_to,
                       assigned_at
                   ) VALUES ($1, $2, $3, $4, $5, NULL, $6, TRUE, $7, $8, $9)
                   RETURNING prd_price_uuid, effective_from`,
            values: [
                product_id,
                Number(price),
                Number(price_after_sale),
                Number(currency_id),
                effectiveFrom,
                reason.trim(),
                modified_by,
                assigned_to,
                assigned_at,
            ],
        });

        // --------------------------------------------------
        // 6. UPDATE products table
        // --------------------------------------------------
        const updateResult = await client.query({
            text: `UPDATE public.products SET
                       price                 = $1,
                       price_after_sale      = $2,
                       currency_id           = $3,
                       price_effective_from  = $4,
                       modified_by           = $5,
                       modified_at           = $6,
                       assigned_to           = $7,
                       assigned_at           = $8
                   WHERE product_uuid = $9
                     AND is_deleted   = FALSE
                   RETURNING
                       product_id,
                       product_uuid,
                       sku,
                       price,
                       price_after_sale,
                       currency_id,
                       price_effective_from,
                       modified_at`,
            values: [
                Number(price),
                Number(price_after_sale),
                Number(currency_id),
                effectiveFrom,
                modified_by,
                now,
                assigned_to,
                assigned_at,
                product_uuid,
            ],
        });

        // --------------------------------------------------
        // 7. RELEASE EDIT LOCK
        // --------------------------------------------------
        await client.query({
            text: `UPDATE public.record_locks
                   SET is_deleted = TRUE,
                       deleted_by = $1,
                       deleted_at = $2
                   WHERE table_name = 'products'
                     AND record_id  = $3
                     AND locked_by  = $1
                     AND is_deleted = FALSE`,
            values: [modified_by, now, product_uuid],
        });

        await client.query("COMMIT");

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Product price updated successfully",
            data: {
                ...updateResult.rows[0],
                prd_price_uuid: historyResult.rows[0].prd_price_uuid,
            },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (update-product-price):", err);
        saveErrorLog({
            api_name:   "update-product-price",
            method:     "RESPONDER",
            payload:    req,
            message:    "Internal server error",
            stack:      err.stack,
            error_code: 2004,
        });
        return cb(null, {
            header_type:        "ERROR",
            message_visibility: true,
            status:             false,
            code:               2004,
            message:            "Internal server error",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});