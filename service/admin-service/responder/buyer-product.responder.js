require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');
const path = require("path");
const APP_CONFIG = require('@libs/config/config.prod');
const { sendmail } = require('@libs/common/common-util');
const uploadDir = path.join('/app/assets', 'buyer-product');
const fs = require("fs");
const crypto = require("crypto");
// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;
const commonenum = require('@libs/config/enum');
const responder = new cote.Responder({
    name: 'buyer-product responder',
    key: 'buyer-product',
    redis: { host: redisHost, port: redisPort }
});


// --------------------------------------
//   BUYER - VIEW PRODUCT DETAILS
// --------------------------------------


responder.on("getById-product-detail", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { product_uuid } = req;

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
        // 2. FETCH PRODUCT (approved + active + listed only)
        // --------------------------------------------------
        const result = await client.query(
            `
            SELECT
                p.product_id,
                p.product_uuid,
                p.name                        AS product_name,
                p.code                        AS product_code,
                p.sku,
                p.oem_part_number,
                p.aftermarket_number,
                p.equivalent_oem_part_numbers AS product_equivalent_oems,
                p.weight,
                p.dimension_length,
                p.dimension_width,
                p.dimension_height,
                p.uom_id,
                p.material_type,
                p.condition_id,
                p.used_years,
                p.item_description,
                p.price,
                p.price_after_sale,
                p.price_effective_from,
                p.currency_id,
                p.verify_status,
                p.verified_from,
                p.is_listed,
                p.upload_method,
                p.created_at,
                p.modified_at,

                -- Product Type
                pt.product_type_uuid,
                pt.name                       AS product_type_name,

                -- Brand
                br.brand_uuid,
                br.name                       AS brand_name,
                br.logo_path                  AS brand_logo,
                br.description                AS brand_description,

                -- Model
                mo.model_uuid,
                mo.name                       AS model_name,

                -- Manufacturer
                mf.manufacturer_uuid,
                mf.code                       AS manufacturer_code,
                mf.name                       AS manufacturer_name,
                mf.description                AS manufacturer_description,

                -- Seller (buyer-safe fields only)
                sa.seller_uuid,
                sa.business_name              AS seller_name,

                -- UOM
                um.uom_uuid,
                um.code                       AS uom_code,
                um.name                       AS uom_name,
                um.symbol                     AS uom_symbol,

                -- Condition
                pc.condition_uuid,
                pc.code                       AS condition_code,
                pc.name                       AS condition_name,

                -- Currency
                cu.currency_uuid,
                cu.code                       AS currency_code,
                cu.name                       AS currency_name,
                cu.symbol                     AS currency_symbol,

                -- All active product images, PRIMARY first then sort_order
                COALESCE(
                    (
                        SELECT json_agg(img_rows)
                        FROM (
                            SELECT
                                pi.product_image_uuid,
                                pi.image_url,
                                pi.image_type,
                                pi.sort_order
                            FROM public.product_images pi
                            WHERE pi.product_id = p.product_id
                              AND pi.is_deleted  = FALSE
                              AND pi.is_active   = TRUE
                            ORDER BY
                                CASE WHEN pi.image_type = 'PRIMARY' THEN 0 ELSE 1 END,
                                pi.sort_order ASC NULLS LAST
                        ) img_rows
                    ),
                    '[]'
                )                              AS images,

                -- Equivalent / cross-reference OEM parts.
                -- Prefer the curated oem_equivalents table; fall back
                -- to whatever is denormalized on the product row.
                COALESCE(
                    (
                        SELECT oe.equivalent_oem_part_numbers
                        FROM public.oem_equivalents oe
                        WHERE oe.oem_part_number = p.oem_part_number
                          AND oe.is_active  = TRUE
                          AND oe.is_deleted = FALSE
                        LIMIT 1
                    ),
                    p.equivalent_oem_part_numbers,
                    '[]'::jsonb
                )                              AS equivalent_oem_part_numbers,

                -- Warehouse-level availability (buyer-safe fields only —
                -- no bin_loc / reserved_qty / buffer_qty exposed)
                COALESCE(
                    (
                        SELECT json_agg(wh_rows)
                        FROM (
                            SELECT
                                sw.warehouse_uuid,
                                sw.warehouse_name,
                                sw.warehouse_address,
                                GREATEST(si.onhand_qty - si.reserved_qty - si.buffer_qty, 0) AS available_qty,
                                (GREATEST(si.onhand_qty - si.reserved_qty - si.buffer_qty, 0) > 0) AS in_stock
                            FROM public.seller_inventory si
                            JOIN public.seller_warehouse sw ON sw.warehouse_id = si.warehouse_id
                            WHERE si.product_id = p.product_id
                              AND si.is_deleted  = FALSE
                              AND si.is_active   = TRUE
                        ) wh_rows
                    ),
                    '[]'
                )                              AS warehouse_availability,

                -- Aggregate stock across all warehouses
                COALESCE(
                    (
                        SELECT SUM(GREATEST(si.onhand_qty - si.reserved_qty - si.buffer_qty, 0))
                        FROM public.seller_inventory si
                        WHERE si.product_id = p.product_id
                          AND si.is_deleted  = FALSE
                          AND si.is_active   = TRUE
                    ), 0
                )                              AS total_available_qty

            FROM public.products p

            LEFT JOIN public.product_types      pt ON pt.product_type_id    = p.product_type_id
            LEFT JOIN public.brand              br ON br.brand_id          = p.brand_id
            LEFT JOIN public.model              mo ON mo.model_id          = p.model_id
            LEFT JOIN public.manufacturer       mf ON mf.manufacturer_id   = p.manufacturer_id
            LEFT JOIN public.seller_accounts    sa ON sa.seller_id         = p.seller_id
            LEFT JOIN public.uom                um ON um.uom_id            = p.uom_id
            LEFT JOIN public.product_conditions pc ON pc.condition_id      = p.condition_id
            LEFT JOIN public.currency           cu ON cu.currency_id       = p.currency_id

            WHERE p.product_uuid  = $1
              AND p.is_deleted    = FALSE
              AND p.is_active     = TRUE
              AND p.is_listed     = TRUE
              AND p.verify_status = 'APPROVED'
            `,
            [product_uuid]
        );

        // --------------------------------------------------
        // 3. NOT FOUND / NOT AVAILABLE
        // --------------------------------------------------
        // Deliberately the same response whether the product doesn't
        // exist or simply isn't approved/active yet — avoids leaking
        // the existence of unapproved/inactive listings to buyers.
        
        if (result.rowCount === 0) {
            await client.query("ROLLBACK");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Product not found",
                error:              "No approved, active product found with the provided UUID",
            });
        }

        const product = result.rows[0];

        await client.query("COMMIT");

        // --------------------------------------------------
        // 4. SHAPE BUYER-FACING RESPONSE
        // --------------------------------------------------
        const data = {
            product_uuid: product.product_uuid,
            name:         product.product_name,
            code:         product.product_code,
            sku:          product.sku,

            oem: {
                oem_part_number:             product.oem_part_number,
                aftermarket_number:          product.aftermarket_number,
                equivalent_oem_part_numbers: product.equivalent_oem_part_numbers,
            },

            brand: product.brand_uuid ? {
                brand_uuid:  product.brand_uuid,
                name:        product.brand_name,
                logo:        product.brand_logo,
                description: product.brand_description,
            } : null,

            model: product.model_uuid ? {
                model_uuid: product.model_uuid,
                name:       product.model_name,
            } : null,

            manufacturer: product.manufacturer_uuid ? {
                manufacturer_uuid: product.manufacturer_uuid,
                code:              product.manufacturer_code,
                name:              product.manufacturer_name,
                description:       product.manufacturer_description,
            } : null,

            product_type: product.product_type_uuid ? {
                product_type_uuid: product.product_type_uuid,
                name:               product.product_type_name,
            } : null,

            seller: product.seller_uuid ? {
                seller_uuid: product.seller_uuid,
                name:        product.seller_name,
            } : null,

            specifications: {
                weight: product.weight,
                dimensions: {
                    length: product.dimension_length,
                    width:  product.dimension_width,
                    height: product.dimension_height,
                },
                uom: product.uom_uuid ? {
                    uom_uuid: product.uom_uuid,
                    code:     product.uom_code,
                    name:     product.uom_name,
                    symbol:   product.uom_symbol,
                } : null,
                material_type: product.material_type,
                condition: product.condition_uuid ? {
                    condition_uuid: product.condition_uuid,
                    code:           product.condition_code,
                    name:           product.condition_name,
                } : null,
                used_years:  product.used_years,
                description: product.item_description,
            },

            pricing: {
                price:            product.price,
                price_after_sale: product.price_after_sale,
                currency: product.currency_uuid ? {
                    currency_uuid: product.currency_uuid,
                    code:          product.currency_code,
                    name:          product.currency_name,
                    symbol:        product.currency_symbol,
                } : null,
                effective_from:   product.price_effective_from,
            },

            verification: {
                status:        product.verify_status,
                verified_from: product.verified_from,
            },

            images: product.images,

            inventory: {
                total_available_qty: product.total_available_qty,
                in_stock:             Number(product.total_available_qty) > 0,
                warehouses:           product.warehouse_availability,
            },

            created_at:  product.created_at,
            modified_at: product.modified_at,
        };

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Product details fetched successfully",
            data,
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (getById-product-detail):", err);
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
// PRODUCT SEARCH — BUYER 
// --------------------------------------------------
// Multi-field keyword search (OEM Part Number, SKU, Product Code,
// Barcode, Aftermarket/Manufacturer Part Number, Brand Name,
// Description, Equivalent OEM Number) with ranked relevance,
// optional substitution search, pagination, sorting and advanced
// filtering via buildAdvancedSearchQuery.


responder.on('search-product-buyer', async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        const body = req.body || {};

        const {
            Keyword              = null,
            warehouse_uuid       = null,
            include_substitutes  = false,
        } = body;

        let extraWhereParts = [];
        let baseParams      = [];

        // ---------------- Buyer visibility (always enforced) ----------------
        extraWhereParts.push(`P.is_deleted   = FALSE`);
        extraWhereParts.push(`P.is_active    = TRUE`);
        extraWhereParts.push(`P.is_listed    = TRUE`);
        extraWhereParts.push(`P.verify_status = 'APPROVED'`);

        // ---------------- Private access scope ----------------
        if (accessScope && accessScope.type === 'PRIVATE') {
            baseParams.push(accessScope.user_id);
            extraWhereParts.push(`P.created_by = $${baseParams.length}`);
        }

        // ---------------- Warehouse filter (EXISTS) ----------------
        let whParamIdx = null;
        if (warehouse_uuid) {
            baseParams.push(warehouse_uuid);
            whParamIdx = baseParams.length;
            extraWhereParts.push(`
                EXISTS (
                    SELECT 1 FROM public.seller_inventory SI
                    JOIN public.seller_warehouse W ON W.warehouse_id = SI.warehouse_id
                    WHERE SI.product_id = P.product_id
                      AND SI.is_deleted = FALSE
                      AND SI.is_active  = TRUE
                      AND W.warehouse_uuid = $${whParamIdx}
                )
            `);
        }

        // ---------------- Free-text multi-field search ----------------
        let pExact = null;
        let pLike  = null;

        if (Keyword && String(Keyword).trim() !== '') {
            const kw = String(Keyword).trim();

            baseParams.push(kw);
            pExact = baseParams.length;

            baseParams.push(`%${kw}%`);
            pLike = baseParams.length;
        // ---- FIX: ensure $pExact is referenced in countSQL too ----
            extraWhereParts.push(`$${pExact}::text IS NOT NULL`);
            const substitutionClause = `
                EXISTS (
                    SELECT 1
                    FROM   public.oem_equivalents OE,
                           jsonb_array_elements_text(OE.equivalent_oem_part_numbers) AS eq_part
                    WHERE  OE.oem_part_number = P.oem_part_number
                      AND  eq_part ILIKE $${pLike}
                      AND  OE.is_deleted = FALSE
                      AND  OE.is_active  = TRUE
                )
            `;

            const searchOrParts = [
                `P.oem_part_number   ILIKE $${pLike}`,
                `P.sku               ILIKE $${pLike}`,
                `P.code              ILIKE $${pLike}`,
                `P.barcode_number    ILIKE $${pLike}`,
                `P.aftermarket_number ILIKE $${pLike}`,
                `B.name              ILIKE $${pLike}`,
                `P.item_description  ILIKE $${pLike}`,
                `EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(P.equivalent_oem_part_numbers) AS eq
                    WHERE eq ILIKE $${pLike}
                )`,
            ];

            if (include_substitutes) {
                searchOrParts.push(substitutionClause);
            }

            extraWhereParts.push(`(${searchOrParts.join(' OR ')})`);
        }

        // ---------------- baseWhere ----------------
        const baseWhere = extraWhereParts.join(' AND ');

        // ---------------- Relevance ranking ----------------
        const relevanceExpr = pExact
            ? `(
                CASE
                    WHEN UPPER(P.oem_part_number) = UPPER($${pExact}) THEN 1
                    WHEN UPPER(P.sku)             = UPPER($${pExact}) THEN 2
                    WHEN P.oem_part_number  ILIKE $${pLike}           THEN 3
                    WHEN P.sku             ILIKE $${pLike}            THEN 4
                    WHEN P.code            ILIKE $${pLike}            THEN 5
                    WHEN P.barcode_number  ILIKE $${pLike}            THEN 5
                    WHEN P.aftermarket_number ILIKE $${pLike}         THEN 5
                    WHEN B.name            ILIKE $${pLike}            THEN 6
                    WHEN P.item_description ILIKE $${pLike}           THEN 7
                    WHEN EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements_text(P.equivalent_oem_part_numbers) AS eq
                        WHERE eq ILIKE $${pLike}
                    )                                                  THEN 8
                    ELSE 9
                END
            )`
            : `0`;

        // ---------------- Available quantity / warehouse breakdown ----------------
        const warehouseFilterSql = whParamIdx ? `AND W.warehouse_uuid = $${whParamIdx}` : '';

        const availableQtyExpr = `(
            SELECT COALESCE(SUM(GREATEST(SI.onhand_qty - SI.reserved_qty - SI.buffer_qty, 0)), 0)
            FROM public.seller_inventory SI
            JOIN public.seller_warehouse W ON W.warehouse_id = SI.warehouse_id
            WHERE SI.product_id = P.product_id
              AND SI.is_deleted = FALSE
              AND SI.is_active  = TRUE
              ${warehouseFilterSql}
        )`;

        const warehousesExpr = `(
            SELECT COALESCE(
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'warehouse_uuid', W.warehouse_uuid,
                        'warehouse_name', W.warehouse_name,
                        'available_qty',  GREATEST(SI.onhand_qty - SI.reserved_qty - SI.buffer_qty, 0)
                    )
                    ORDER BY W.warehouse_name
                ),
                '[]'::json
            )
            FROM public.seller_inventory SI
            JOIN public.seller_warehouse W ON W.warehouse_id = SI.warehouse_id
            WHERE SI.product_id = P.product_id
              AND SI.is_deleted = FALSE
              AND SI.is_active  = TRUE
              ${warehouseFilterSql}
        )`;

        // ---------------- Default sort ----------------
        const reqBodyForHelper = { ...body };
        if (Keyword && (!reqBodyForHelper.SortInfo || !reqBodyForHelper.SortInfo.field)) {
            reqBodyForHelper.SortInfo = { field: 'relevance', order: 'ASC' };
        }

        // ---------------- buildAdvancedSearchQuery ----------------
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: reqBodyForHelper,

            table: 'products',
            alias: 'P',
            defaultSort: 'created_at',

            joinSql: `
                LEFT JOIN public.brand                  B   ON B.brand_id                   = P.brand_id
                LEFT JOIN public.manufacturer           MF  ON MF.manufacturer_id            = P.manufacturer_id
                LEFT JOIN public.product_listing_status PLS ON PLS.product_listing_status_id = P.product_listing_status_id
            `,

            allowedFields: [
                'sku',
                'code',
                'price',
                'price_after_sale',
                'verify_status',
                'oem_part_number',
                'barcode_number',
                'aftermarket_number',
                'created_at',
            ],

            customFields: {
                brand_name: {
                    select: 'B.name', search: 'B.name', sort: 'B.name',
                },
                manufacturer_name: {
                    select: 'COALESCE(MF.name, P.manufacturer_name)',
                    search: 'COALESCE(MF.name, P.manufacturer_name)',
                    sort:   'COALESCE(MF.name, P.manufacturer_name)',
                },
                listing_status_name: {
                    select: 'PLS.name', search: 'PLS.name', sort: 'PLS.name',
                },
                part_number: {
                    select: 'P.oem_part_number', search: null, sort: null,
                },
                description: {
                    select: 'P.item_description', search: null, sort: null,
                },
                available_qty: {
                    select: availableQtyExpr, search: null, sort: availableQtyExpr,
                },
                warehouses: {
                    select: warehousesExpr, search: null, sort: null,
                },
                relevance: {
                    select: relevanceExpr, search: null, sort: relevanceExpr,
                },
            },

            baseWhere,
            baseParams,
        });

        // ---------------- Search analytics log ----------------
        pool.query(
            `INSERT INTO public.search_logs (
                keyword, warehouse_uuid, include_substitutes,
                result_count, searched_by, created_at
             ) VALUES ($1, $2, $3, $4, $5, NOW())`,
            [
                Keyword        || null,
                warehouse_uuid || null,
                !!include_substitutes,
                result.totalRecords,
                accessScope?.user_id || null,
            ]
        ).catch(logErr =>
            console.error('[search-product-buyer] failed to write search_logs:', logErr.message)
        );

        return cb(null, {
            header_type       : 'SUCCESS',
            message_visibility: true,
            status            : true,
            code              : 1000,
            message           : 'Products fetched successfully',
            error             : null,
            result
        });

    } catch (err) {
        console.error('[search-product-buyer] error:', err);
     
        return cb(null, {
            header_type       : 'ERROR',
            message_visibility: true,
            status            : false,
            code              : 2004,
            message           : err.message,
            error             : err.message
        });
    }
});

// --------------------------------------------------
// PRODUCT SEARCH WITH ETA
// --------------------------------------------------


responder.on('search-product-eta', async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        const body        = req.body || {};

        const {
            Keyword             = null,   // free-text: OEM/SKU/code/barcode/brand/desc/equivalents
            searchText          = null,   // dedicated part-number search (OEM / superseded / aftermarket)
            buyer_uuid          = null,   // used ONLY for ETA calculation
            productType         = 'ALL',  // ALL | GENUINE | AFTERMARKET | USED
            include_substitutes = false,  // also match via oem_equivalents cross-reference table
            warehouse_uuid      = null,   // scope inventory to a single warehouse
        } = body;

        // ─────────────────────────────────────────────────────────────────────
        // 0.  Resolve buyer's emirate for ETA (one lightweight query up-front)
        // ─────────────────────────────────────────────────────────────────────
        let buyerEmirate = null; // e.g. "Dubai"

        if (buyer_uuid) {
            try {
             
                const buyerRes = await pool.query(
    `SELECT C.name AS emirate
     FROM   public.buyer_accounts     BA
     JOIN   public.account_addresses  AA ON AA.account_id       = BA.buyer_id
     JOIN   public.cities             C  ON C.city_id           = AA.city
     WHERE  BA.buyer_uuid        = $1
       AND  BA.is_active         = TRUE
       AND  AA.is_deleted        = FALSE
       AND  AA.account_type_id   = 2
       AND  AA.address_type_id   = 1
     LIMIT  1`,
    [buyer_uuid]
);

                if (buyerRes.rows.length) {
                    buyerEmirate = buyerRes.rows[0].emirate;
                }
            } catch (etaErr) {
                // ETA is a nice-to-have; never block the search
                console.error('[search-product-buyer] buyer emirate lookup failed:', etaErr.message);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // 1.  Base WHERE scaffolding
        // ─────────────────────────────────────────────────────────────────────
        let extraWhereParts = [];
        let baseParams      = [];

        // Buyer visibility — always enforced
        extraWhereParts.push(`P.is_active    = TRUE`);
        extraWhereParts.push(`P.is_listed    = TRUE`);
        extraWhereParts.push(`P.is_deleted   = FALSE`);
        extraWhereParts.push(`P.verify_status = 'APPROVED'`);
// Step 2-ന് തൊട്ടുമുമ്പ്

        // ─────────────────────────────────────────────────────────────────────
        // 2.  Product-type filter
        //     Requires a join to product_types (alias PT) — added in joinSql
        // ─────────────────────────────────────────────────────────────────────
        
        if (productType && productType.toUpperCase() !== 'ALL') {
    baseParams.push(productType);
    extraWhereParts.push(`PT.name ILIKE $${baseParams.length}`);
}

        // ─────────────────────────────────────────────────────────────────────
        // 3.  Warehouse filter (scopes EXISTS check + qty subqueries)
        // ─────────────────────────────────────────────────────────────────────
        let whParamIdx = null;

        if (warehouse_uuid) {
            baseParams.push(warehouse_uuid);
            whParamIdx = baseParams.length;
            extraWhereParts.push(`
                EXISTS (
                    SELECT 1
                    FROM   public.seller_inventory SI
                    JOIN   public.seller_warehouse  W  ON W.warehouse_id = SI.warehouse_id
                    WHERE  SI.product_id  = P.product_id
                      AND  SI.is_deleted  = FALSE
                      AND  SI.is_active   = TRUE
                      AND  W.warehouse_uuid = $${whParamIdx}
                )
            `);
        }

        const warehouseFilterSql = whParamIdx
            ? `AND W.warehouse_uuid = $${whParamIdx}`
            : '';

        // ─────────────────────────────────────────────────────────────────────
        // 4.  searchText — dedicated part-number search
        //     Matches: oem_part_number, aftermarket_number, superseded numbers
        //     (via part_supersession), equivalent_oem_part_numbers
        // ─────────────────────────────────────────────────────────────────────
        if (searchText && String(searchText).trim() !== '') {
            const st = String(searchText).trim();
            baseParams.push(`%${st}%`);
            const stLike = baseParams.length;

            extraWhereParts.push(`(
                P.oem_part_number          ILIKE $${stLike}
                OR P.aftermarket_number    ILIKE $${stLike}
                OR P.equivalent_oem_part_numbers::text ILIKE $${stLike}
                OR EXISTS (
                    SELECT 1
                    FROM   public.parts            PT2
                    JOIN   public.part_supersession PS      ON PS.old_part_id  = PT2.part_id
                    JOIN   public.parts             NEW_PT  ON NEW_PT.part_id  = PS.new_part_id
                    WHERE  PT2.part_number  = P.oem_part_number
                      AND  NEW_PT.part_number ILIKE $${stLike}
                      AND  PS.is_deleted = FALSE
                      AND  PS.is_active  = TRUE
                )
            )`);
        }

// ── 5. Keyword ──
let pLike = null;

if (Keyword && String(Keyword).trim() !== '') {
    const kw = String(Keyword).trim();

    baseParams.push(`%${kw}%`);
    pLike = baseParams.length;          // only ONE param needed

    // const substitutionClause = `
    //     EXISTS (
    //         SELECT 1
    //         FROM   public.oem_equivalents OE
    //         WHERE  OE.oem_part_number = P.oem_part_number
    //           AND  OE.equivalent_oem_part_numbers::text ILIKE $${pLike}
    //           AND  OE.is_deleted = FALSE
    //           AND  OE.is_active  = TRUE
    //     )
    // `;

    const substitutionClause = `
    EXISTS (
        SELECT 1
        FROM   public.oem_equivalents OE,
               jsonb_array_elements_text(OE.equivalent_oem_part_numbers) AS eq_part
        WHERE  OE.oem_part_number = P.oem_part_number
          AND  eq_part ILIKE $${pLike}
          AND  OE.is_deleted = FALSE
          AND  OE.is_active  = TRUE
    )
`;

    const searchOrParts = [
        `P.oem_part_number                    ILIKE $${pLike}`,
        `P.sku                                ILIKE $${pLike}`,
        `P.code                               ILIKE $${pLike}`,
        `P.barcode_number                     ILIKE $${pLike}`,
        `P.aftermarket_number                 ILIKE $${pLike}`,
        `B.name                               ILIKE $${pLike}`,
        `P.item_description                   ILIKE $${pLike}`,
        //`P.equivalent_oem_part_numbers::text  ILIKE $${pLike}`,
        `EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(P.equivalent_oem_part_numbers) AS eq
    WHERE eq ILIKE $${pLike}
)`,
    ];

    if (include_substitutes) {
        searchOrParts.push(substitutionClause);
    }

    extraWhereParts.push(`(${searchOrParts.join(' OR ')})`);
}

const baseWhere = extraWhereParts.join(' AND ');

// ── 6. Relevance ranking — strips % wildcards from the param in SQL ──
// const relevanceExpr = pLike
//     ? `(
//         CASE
//             WHEN UPPER(P.oem_part_number) = UPPER(TRIM('%' FROM $${pLike}::text)) THEN 1
//             WHEN UPPER(P.sku)              = UPPER(TRIM('%' FROM $${pLike}::text)) THEN 2
//             WHEN P.oem_part_number          ILIKE $${pLike}                        THEN 3
//             WHEN P.sku                      ILIKE $${pLike}                        THEN 4
//             WHEN P.code                     ILIKE $${pLike}                        THEN 5
//             WHEN P.barcode_number           ILIKE $${pLike}                        THEN 5
//             WHEN P.aftermarket_number       ILIKE $${pLike}                        THEN 5
//             WHEN B.name                     ILIKE $${pLike}                        THEN 6
//             WHEN P.item_description         ILIKE $${pLike}                        THEN 7
//             WHEN P.equivalent_oem_part_numbers::text ILIKE $${pLike}              THEN 8
//             ELSE 9
//         END
//     )`
//     : `0`;

const relevanceExpr = pLike
    ? `(
        CASE
            WHEN UPPER(P.oem_part_number) = UPPER(TRIM('%' FROM $${pLike}::text)) THEN 1
            WHEN UPPER(P.sku)              = UPPER(TRIM('%' FROM $${pLike}::text)) THEN 2
            WHEN P.oem_part_number          ILIKE $${pLike}                        THEN 3
            WHEN P.sku                      ILIKE $${pLike}                        THEN 4
            WHEN P.code                     ILIKE $${pLike}                        THEN 5
            WHEN P.barcode_number           ILIKE $${pLike}                        THEN 5
            WHEN P.aftermarket_number       ILIKE $${pLike}                        THEN 5
            WHEN B.name                     ILIKE $${pLike}                        THEN 6
            WHEN P.item_description         ILIKE $${pLike}                        THEN 7
            WHEN EXISTS (                                                        -- ✅ NEW
                SELECT 1
                FROM jsonb_array_elements_text(P.equivalent_oem_part_numbers) AS eq
                WHERE eq ILIKE $${pLike}
            )                                                                      THEN 8
            ELSE 9
        END
    )`
    : `0`;

        // ─────────────────────────────────────────────────────────────────────
        // 7.  Inventory subquery expressions
        // ─────────────────────────────────────────────────────────────────────

        // Total available quantity (across all / scoped warehouse)
        const availableQtyExpr = `(
            SELECT COALESCE(
                SUM(GREATEST(SI.onhand_qty - SI.reserved_qty - SI.buffer_qty, 0)),
                0
            )
            FROM   public.seller_inventory SI
            JOIN   public.seller_warehouse  W  ON W.warehouse_id = SI.warehouse_id
            WHERE  SI.product_id  = P.product_id
              AND  SI.is_deleted  = FALSE
              AND  SI.is_active   = TRUE
              ${warehouseFilterSql}
        )`;

        // Warehouse breakdown array
        const warehousesExpr = `(
            SELECT COALESCE(
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'warehouse_uuid',  W.warehouse_uuid,
                        'warehouse_name',  W.warehouse_name,
                        'available_qty',   GREATEST(SI.onhand_qty - SI.reserved_qty - SI.buffer_qty, 0)
                    )
                    ORDER BY W.warehouse_name
                ),
                '[]'::json
            )
            FROM   public.seller_inventory SI
            JOIN   public.seller_warehouse  W  ON W.warehouse_id = SI.warehouse_id
            WHERE  SI.product_id  = P.product_id
              AND  SI.is_deleted  = FALSE
              AND  SI.is_active   = TRUE
              ${warehouseFilterSql}
        )`;

        // Stock status derived from available qty
        const stockStatusExpr = `(
            CASE
                WHEN ${availableQtyExpr} <= 0  THEN 'OUT_OF_STOCK'
                WHEN ${availableQtyExpr} <= 10 THEN 'LOW_STOCK'
                ELSE                                'IN_STOCK'
            END
        )`;

        // ─────────────────────────────────────────────────────────────────────
        // 8.  Current active price (from product_price_history)
        //     Falls back to P.price if no active history row exists
        // ─────────────────────────────────────────────────────────────────────
        const activePriceExpr = `(
            SELECT COALESCE(
                (
                    SELECT PPH.price_after_sale
                    FROM   public.product_price_history PPH
                    WHERE  PPH.product_id   = P.product_id
                      AND  PPH.is_active    = TRUE
                      AND  PPH.is_deleted   = FALSE
                      AND  PPH.effective_from <= NOW()
                      AND  (PPH.effective_to IS NULL OR PPH.effective_to > NOW())
                    ORDER BY PPH.effective_from DESC
                    LIMIT  1
                ),
                P.price_after_sale
            )
        )`;

        // ─────────────────────────────────────────────────────────────────────
        // 9.  Supersession details
        //     products.oem_part_number → parts.part_number → part_supersession
        // ─────────────────────────────────────────────────────────────────────
        const supersessionExpr = `(
            SELECT JSON_BUILD_OBJECT(
                'old_part_number',   OLD_PT.part_number,
                'new_part_number',   NEW_PT.part_number,
                'new_part_name',     NEW_PT.part_name,
                'effective_from',    PS.effective_from,
                'effective_to',      PS.effective_to,
                'reason',            PS.reason
            )
            FROM   public.parts            OLD_PT
            JOIN   public.part_supersession PS     ON PS.old_part_id = OLD_PT.part_id
            JOIN   public.parts            NEW_PT  ON NEW_PT.part_id = PS.new_part_id
            WHERE  OLD_PT.part_number = P.oem_part_number
              AND  PS.is_deleted      = FALSE
              AND  PS.is_active       = TRUE
            ORDER  BY PS.effective_from DESC
            LIMIT  1
        )`;

        // ─────────────────────────────────────────────────────────────────────
        // 10. Supply statistics
        //     sellerCount = distinct sellers with stock, fulfilledOrders = from order history
        // ─────────────────────────────────────────────────────────────────────
        const sellerCountExpr = `(
            SELECT COUNT(DISTINCT SI.seller_id)
            FROM   public.seller_inventory SI
            WHERE  SI.product_id = P.product_id
              AND  SI.is_deleted = FALSE
              AND  SI.is_active  = TRUE
              AND  GREATEST(SI.onhand_qty - SI.reserved_qty - SI.buffer_qty, 0) > 0
        )`;

        // fulfilledOrders: total reserved_qty consumed (proxy via stock history OUT movements)
        const fulfilledOrdersExpr = `(
            SELECT COALESCE(SUM(PSH.quantity_changed), 0)
            FROM   public.product_stock_history PSH
            WHERE  PSH.product_id    = P.product_id
              AND  PSH.movement_type = 'OUT'
              AND  PSH.is_deleted    = FALSE
        )`;

        const supplyStatusExpr = `(
            CASE
                WHEN ${sellerCountExpr} >= 10 THEN 'HIGH'
                WHEN ${sellerCountExpr} >= 4  THEN 'MEDIUM'
                ELSE                               'LOW'
            END
        )`;

        // ─────────────────────────────────────────────────────────────────────
        // 11. ETA — warehouse emirate subquery
        //     The buyer emirate is already resolved (buyerEmirate).
        //     We embed it as a literal in the SQL via a param.
        // ─────────────────────────────────────────────────────────────────────
        // We need to pick the "best" (highest stock) warehouse for this product
        // and check its emirate against the buyer's emirate.
       

       // ── 11. ETA ──
        let etaExpr;

        if (buyerEmirate) {
            // Sanitize: strip single quotes to prevent SQL injection, then embed as literal
            const safeBuyerEmirate = buyerEmirate.replace(/'/g, "''");

            etaExpr = `(
                SELECT
                    CASE
                        WHEN ${availableQtyExpr} <= 0 THEN NULL::json
                        WHEN (
                            SELECT C.name
                            FROM   public.seller_inventory  SI2
                            JOIN   public.seller_warehouse   W2  ON W2.warehouse_id = SI2.warehouse_id
                            JOIN   public.cities             C   ON C.city_id       = W2.city_id
                            WHERE  SI2.product_id  = P.product_id
                              AND  SI2.is_deleted  = FALSE
                              AND  SI2.is_active   = TRUE
                              AND  GREATEST(SI2.onhand_qty - SI2.reserved_qty - SI2.buffer_qty, 0) > 0
                            ORDER  BY GREATEST(SI2.onhand_qty - SI2.reserved_qty - SI2.buffer_qty, 0) DESC
                            LIMIT  1
                        ) = '${safeBuyerEmirate}'
                        THEN JSON_BUILD_OBJECT(
                            'minDays', 1,
                            'maxDays', 2,
                            'message', 'Delivered in 1-2 business days'
                        )
                        ELSE JSON_BUILD_OBJECT(
                            'minDays', 2,
                            'maxDays', 3,
                            'message', 'Delivered in 2-3 business days'
                        )
                    END
            )`;
        } else {
            etaExpr = `(
                CASE
                    WHEN ${availableQtyExpr} <= 0
                    THEN NULL::json
                    ELSE JSON_BUILD_OBJECT(
                        'minDays', 2,
                        'maxDays', 4,
                        'message', 'Delivered in 2-4 business days'
                    )
                END
            )`;
        }

        // ─────────────────────────────────────────────────────────────────────
        // 12. hasImage / hasInfo flags
        // ─────────────────────────────────────────────────────────────────────
        const hasImageExpr = `(
            EXISTS (
                SELECT 1
                FROM   public.product_images PI2
                WHERE  PI2.product_id  = P.product_id
                  AND  PI2.is_deleted  = FALSE
                  AND  PI2.is_active   = TRUE
            )
        )`;

        const hasInfoExpr = `(
            P.item_description IS NOT NULL
            AND LENGTH(TRIM(P.item_description)) > 0
        )`;

        // ─────────────────────────────────────────────────────────────────────
        // 13. Default sort — if Keyword supplied and no SortInfo, sort by relevance
        // ─────────────────────────────────────────────────────────────────────
        const reqBodyForHelper = { ...body };
        if (Keyword && (!reqBodyForHelper.SortInfo || !reqBodyForHelper.SortInfo.field)) {
            reqBodyForHelper.SortInfo = { field: 'relevance', order: 'ASC' };
        }

        // ─────────────────────────────────────────────────────────────────────
        // 14. Execute via buildAdvancedSearchQuery
        // ─────────────────────────────────────────────────────────────────────
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: reqBodyForHelper,

            table: 'products',
            alias: 'P',
            defaultSort: 'created_at',

            joinSql: `
                LEFT JOIN public.brand                  B    ON B.brand_id                    = P.brand_id
                LEFT JOIN public.manufacturer           MF   ON MF.manufacturer_id             = P.manufacturer_id
                LEFT JOIN public.product_types          PT   ON PT.product_type_id             = P.product_type_id
                LEFT JOIN public.product_listing_status PLS  ON PLS.product_listing_status_id  = P.product_listing_status_id
                LEFT JOIN public.parts                  PTS  ON PTS.part_number                = P.oem_part_number
            `,

            allowedFields: [
                'sku',
                'code',
                'price',
                'price_after_sale',
                'verify_status',
                'oem_part_number',
                'barcode_number',
                'aftermarket_number',
                'created_at',
                'weight',
            ],

            customFields: {
                // ── Identifiers / classification ──
                product_uuid: {
                    select: 'P.product_uuid', search: null, sort: null,
                },
                product_type: {
                    select: 'PT.code', search: 'PT.code', sort: 'PT.code',
                },

                // ── Brand / manufacturer ──
                brand_name: {
                    select: 'B.name', search: 'B.name', sort: 'B.name',
                },
                manufacturer_name: {
                    select: 'COALESCE(MF.name, P.manufacturer_name)',
                    search: 'COALESCE(MF.name, P.manufacturer_name)',
                    sort:   'COALESCE(MF.name, P.manufacturer_name)',
                },

                // ── Part numbers ──
                part_number: {
                    select: 'P.oem_part_number', search: null, sort: null,
                },
                description: {
                    select: 'P.item_description', search: null, sort: null,
                },

                // ── Active price ──
                current_price: {
                    select: activePriceExpr, search: null, sort: activePriceExpr,
                },

                // ── Inventory ──
                available_qty: {
                    select: availableQtyExpr, search: null, sort: availableQtyExpr,
                },
                stock_status: {
                    select: stockStatusExpr, search: null, sort: null,
                },
                warehouses: {
                    select: warehousesExpr, search: null, sort: null,
                },

                // ── Supersession ──
                supersession: {
                    select: supersessionExpr, search: null, sort: null,
                },

                // ── Supply stats ──
                seller_count: {
                    select: sellerCountExpr, search: null, sort: sellerCountExpr,
                },
                fulfilled_orders: {
                    select: fulfilledOrdersExpr, search: null, sort: null,
                },
                supply_status: {
                    select: supplyStatusExpr, search: null, sort: null,
                },

                // ── ETA ──
                delivery_estimate: {
                    select: etaExpr, search: null, sort: null,
                },

                // ── Flags ──
                has_image: {
                    select: hasImageExpr, search: null, sort: null,
                },
                has_info: {
                    select: hasInfoExpr, search: null, sort: null,
                },

                // ── Relevance ranking ──
                relevance: {
                    select: relevanceExpr, search: null, sort: relevanceExpr,
                },

                // ── Listing status ──
                listing_status_name: {
                    select: 'PLS.name', search: 'PLS.name', sort: 'PLS.name',
                },
            },

            baseWhere,
            baseParams,
        });

        // ─────────────────────────────────────────────────────────────────────
        // 15. Shape the response to match the buyer portal contract
        // ─────────────────────────────────────────────────────────────────────
        const products = (result.data || []).map(row => {
            const availQty       = Number(row.available_qty)    || 0;
            const sellerCnt      = Number(row.seller_count)     || 0;
            const fulfilledOrders = Number(row.fulfilled_orders) || 0;

            return {
                productId:          row.product_id,
                productUuid:        row.product_uuid,
                productType:        row.product_type        || null,
                brand:              row.brand_name          || null,
                partNumber:         row.part_number         || null,
                sku:                row.sku                 || null,
                code:               row.code                || null,
                description:        row.description         || null,
                barcodeNumber:      row.barcode_number      || null,
                aftermarketNumber:  row.aftermarket_number  || null,
                weight:             row.weight              || null,

                // Pricing
                price:              Number(row.current_price) || Number(row.price) || null,

                // Supersession
                supersededNumber:   row.supersession?.old_part_number  || null,
                newPartNumber:      row.supersession?.new_part_number   || null,
                newPartName:        row.supersession?.new_part_name     || null,
                supersessionFrom:   row.supersession?.effective_from    || null,
                supersessionTo:     row.supersession?.effective_to      || null,

                // Inventory
                availability:       availQty,
                stockStatus:        row.stock_status        || 'OUT_OF_STOCK',
                warehouses:         row.warehouses          || [],

                // Delivery
                deliveryEstimate:   row.delivery_estimate   || null,

                // Supply statistics
                supplyStatistics: {
                    supplyStatus:    row.supply_status      || 'LOW',
                    sellerCount:     sellerCnt,
                    fulfilledOrders: fulfilledOrders,
                },

                // Flags
                hasImage:   Boolean(row.has_image),
                hasInfo:    Boolean(row.has_info),

                // Internal
                relevance:  row.relevance,
            };
        });

        // ─────────────────────────────────────────────────────────────────────
        // 16. Search analytics log (fire-and-forget)
        // ─────────────────────────────────────────────────────────────────────
      
pool.query(
    `INSERT INTO public.search_logs (
        keyword, warehouse_uuid,
        include_substitutes, result_count, searched_by, created_at
     ) VALUES ($1,$2,$3,$4,$5,NOW())`,
    [
        Keyword          || searchText || null,  
        warehouse_uuid   || null,
        !!include_substitutes,
        result.totalRecords,
        accessScope?.user_id || null,
    ]
).catch(logErr =>
    console.error('[search-product-buyer] search_logs write failed:', logErr.message)
);

        return cb(null, {
            header_type        : 'SUCCESS',
            message_visibility : true,
            status             : true,
            code               : 1000,
            message            : 'Products fetched successfully',
            error              : null,
            result: {
                totalRecords : result.totalRecords,
                page         : result.page,
                pageSize     : result.pageSize,
                products,
            },
        });

    } catch (err) {
        console.error('[search-product-buyer] error:', err);
        await saveErrorLog({ pool, error: err, source: 'search-product-buyer' });
        return cb(null, {
            header_type        : 'ERROR',
            message_visibility : true,
            status             : false,
            code               : 2004,
            message            : err.message,
            error              : err.message,
        });
    }
});


// --------------------------------------------------
// ADD PRODUCT TO CART
// --------------------------------------------------



responder.on("add-to-cart", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const {
            buyer_uuid,
            product_uuid,
            warehouse_uuid,
            quantity,
            buyer_note,
            created_by,
        } = req.body;

        const now         = new Date();
        const assigned_to = created_by;
        const assigned_at = now;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });

        if (!product_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Product UUID is required" });

        if (quantity === undefined || quantity === null || isNaN(Number(quantity)))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Valid quantity is required" });

        if (Number(quantity) <= 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Quantity must be greater than zero" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created_by is required" });

        if (!warehouse_uuid?.trim())
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2001, message: "Validation failed", error: "Warehouse UUID is required",
            });

        // --------------------------------------------------
        // 2. RESOLVE UUIDs → IDs (parallel)
        // --------------------------------------------------
        const [buyerResult, productResult, whTypeResult, statusResult] = await Promise.all([
            client.query({
                text: `SELECT buyer_id
                       FROM public.buyer_accounts
                       WHERE buyer_uuid = $1
                         AND is_deleted  = FALSE
                         AND is_active   = TRUE
                         AND phone_number_verified  = TRUE`,
                values: [buyer_uuid.trim()],
            }),
            client.query({
                text: `SELECT
                           p.product_id,
                           p.seller_id,
                           p.uom_id,
                           p.name              AS product_name,
                           p.sku,
                           p.oem_part_number   AS oem_number,
                           p.price             AS unit_price,
                           p.price_after_sale  AS sale_price,
                           sw.warehouse_id,
                           si.inventory_id
                       FROM public.products p
                       JOIN public.seller_inventory si
                          ON si.product_id   = p.product_id
                         AND si.seller_id    = p.seller_id
                         AND si.is_deleted   = FALSE
                         AND si.is_active    = TRUE
                       JOIN public.seller_warehouse sw
                          ON sw.warehouse_id   = si.warehouse_id
                         AND sw.warehouse_uuid = $2
                         AND sw.is_deleted     = FALSE
                         AND sw.is_active      = TRUE
                       WHERE p.product_uuid = $1
                         AND p.is_deleted   = FALSE
                         AND p.is_active    = TRUE`,
                values: [product_uuid.trim(), warehouse_uuid.trim()],
            }),
            client.query(
                `SELECT warehouse_type_id
                 FROM public.warehouse_type
                 WHERE code = 'SLR' AND is_active = TRUE AND is_deleted = FALSE`
            ),
            client.query(
                `SELECT cart_item_status_id
                 FROM public.cart_item_status
                 WHERE code = 'PND' AND is_active = TRUE AND is_deleted = FALSE`
            ),
        ]);

        if (buyerResult.rowCount === 0)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active buyer found with the provided UUID",
            });

        if (productResult.rowCount === 0)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "Product is not available in the selected warehouse",
            });

        if (whTypeResult.rowCount === 0 || statusResult.rowCount === 0) {
            logger.error("add-to-cart: missing master data — warehouse_type(SLR) or cart_item_status(PND)");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Configuration error",
                error:              "Required master data (warehouse type / cart item status) not found",
            });
        }

        const { buyer_id } = buyerResult.rows[0];
        const {
            product_id,
            seller_id,
            uom_id,
            product_name,
            sku,
            oem_number,
            unit_price,   // p.price  — original MRP
            sale_price,   // p.price_after_sale — effective selling price per unit
            warehouse_id,
            inventory_id,
        } = productResult.rows[0];

        const warehouse_type_id = whTypeResult.rows[0].warehouse_type_id;
        const pending_status_id = statusResult.rows[0].cart_item_status_id;
        const requestedQty      = Number(quantity);

        // --------------------------------------------------
        // 3. TAX RATE LOOKUP (read-only, no lock needed — safe
        //    to run before the transaction/lock starts)
        // --------------------------------------------------
        const TAX_RATE_DEFAULT = 0.05;
        let taxRate   = TAX_RATE_DEFAULT;
        let taxCodeId = null;

        const taxResult = await client.query({
            text: `SELECT
                       tcm.tax_code_id,
                       tcm.code,
                       tcm.tax_rate
                   FROM public.tax_code_master tcm
                   JOIN public.jurisdiction j
                      ON j.jurisdiction_uuid = tcm.jurisdiction_uuid
                     AND j.code              = 'AE'
                     AND j.level             = 'COUNTRY'
                     AND j.is_deleted        = FALSE
                     AND j.is_active         = TRUE
                   WHERE tcm.is_deleted = FALSE
                     AND tcm.is_active  = TRUE
                   LIMIT 1`,
        });

        if (taxResult.rowCount > 0 && taxResult.rows[0].tax_rate !== null) {
            taxRate   = Number(taxResult.rows[0].tax_rate) / 100;
            taxCodeId = taxResult.rows[0].tax_code_id;
        }

        const taxPercentage = parseFloat((taxRate * 100).toFixed(2));

        // ====================================================
        // TRANSACTION START — everything from here on must be
        // serialized against concurrent add-to-cart calls for
        // the SAME product+seller+warehouse, to avoid overselling.
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 4. LOCK the seller_inventory row FIRST.
        //    A second concurrent request for the same
        //    inventory_id will block here until this transaction
        //    COMMITs or ROLLBACKs — making the check-then-insert
        //    sequence effectively atomic.
        // --------------------------------------------------
        const lockedInventory = await client.query({
            text: `SELECT onhand_qty, reserved_qty, buffer_qty
                   FROM public.seller_inventory
                   WHERE inventory_id = $1
                   FOR UPDATE`,
            values: [inventory_id],
        });

        if (lockedInventory.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "Inventory record no longer exists for this product/warehouse",
            });
        }

        const {
            onhand_qty:   lockedOnhand,
            reserved_qty: lockedReserved,
            buffer_qty:   lockedBuffer,
        } = lockedInventory.rows[0];

        // --------------------------------------------------
        // 5. STOCK AVAILABILITY CHECK (race-safe, lock held)
        //    inventory_available = onhand_qty - reserved_qty - buffer_qty
        //    (standard ATP formula — buffer_qty = safety stock,
        //    always excluded from sellable quantity)
        //    net_available = inventory_available
        //                    - SUM(active cart reserved_quantity for
        //                      this product/seller/warehouse, all buyers)
        //                    - SUM(active LISTING-ORIGIN quote soft-holds
        //                      for this product/warehouse, all buyers)
        //
        //    CHANGE: added the buyer_quote_items subtraction below.
        //    Listing-origin quote requests (cart_item_id IS NULL,
        //    quote still DRF/ACT — see create-buyer-quote-listing-
        //    buyer.js) soft-hold stock the same way an active cart
        //    line does. Without this, add-to-cart could oversell
        //    against stock a pending quote is already counting on.
        // --------------------------------------------------
        const inventoryAvailable =
            Number(lockedOnhand) - Number(lockedReserved) - Number(lockedBuffer);

        const cartReservedResult = await client.query({
            text: `SELECT COALESCE(SUM(cd.reserved_quantity), 0) AS total_reserved
                   FROM public.cart_details cd
                   JOIN public.cart_item_status cis
                     ON cis.cart_item_status_id = cd.cart_item_status_id
                   WHERE cd.product_id   = $1
                     AND cd.seller_id    = $2
                     AND cd.warehouse_id = $3
                     AND cd.is_deleted   = FALSE
                     AND cis.code NOT IN ('REM', 'EXP')`,
            values: [product_id, seller_id, warehouse_id],
        });

        const quoteReservedResult = await client.query({
            text: `SELECT COALESCE(SUM(bqi.quantity), 0) AS total_reserved
                   FROM public.buyer_quote_items bqi
                   JOIN public.buyer_saved_quote bsq
                     ON bsq.buyer_quote_id = bqi.buyer_quote_id
                   JOIN public.quote_statuses qs
                     ON qs.quote_status_id = bsq.status_of_quote
                   WHERE bqi.product_id     = $1
                     AND bqi.warehouse_id   = $2
                     AND bqi.cart_item_id  IS NULL
                     AND bqi.is_deleted     = FALSE
                     AND bqi.is_active      = TRUE
                     AND qs.code IN ('DRF', 'ACT')`,
            values: [product_id, warehouse_id],
        });

        const existingCartReserved  = Number(cartReservedResult.rows[0].total_reserved);
        const existingQuoteReserved = Number(quoteReservedResult.rows[0].total_reserved);
        const netAvailable          = inventoryAvailable - existingCartReserved - existingQuoteReserved;

        if (netAvailable <= 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2007,
                message:            "Out of stock",
                error:              "This product is currently out of stock",
            });
        }

        if (requestedQty > netAvailable) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2007,
                message:            "Insufficient stock",
                error:              `Only ${netAvailable} units are available for this product`,
            });
        }

        // --------------------------------------------------
        // 6. DUPLICATE CART ITEM CHECK (same buyer, same line)
        //    Safe under the same inventory lock.
        // --------------------------------------------------
        const duplicateCheck = await client.query({
            text: `SELECT cd.cart_item_uuid
                   FROM public.cart_details cd
                   JOIN public.cart_item_status cis
                     ON cis.cart_item_status_id = cd.cart_item_status_id
                   WHERE cd.buyer_id     = $1
                     AND cd.product_id   = $2
                     AND cd.seller_id    = $3
                     AND cd.warehouse_id = $4
                     AND cis.code       != 'REM'
                     AND cd.is_deleted   = FALSE`,
            values: [buyer_id, product_id, seller_id, warehouse_id],
        });

        if (duplicateCheck.rowCount > 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2002,
                message:            "Item already in cart",
                error:              "This product is already in your cart. Use the update quantity option to change the quantity",
            });
        }

        // --------------------------------------------------
        // 7. PRICE / DISCOUNT CALCULATION
        //    unit_price (cart_details) = sale_price (price_after_sale)
        //    price (cart_details)      = sale_price × quantity  (taxed line total)
        //    discount_amount            = (MRP − sale_price) × quantity — informational only
        // --------------------------------------------------
        const linePrice  = Number(sale_price) * requestedQty;
        const tax_amount = parseFloat((linePrice * taxRate).toFixed(2));

        const discount_amount = Math.max(
            0,
            parseFloat(((Number(unit_price) - Number(sale_price)) * requestedQty).toFixed(2))
        );

        const final_price = parseFloat((linePrice + tax_amount).toFixed(2));
        const reservation_expires_at = new Date(now.getTime() + commonenum.TIME_DURATION_MINUTES.RESERVATION_EXPIRY * 60 * 1000);

        // --------------------------------------------------
        // 8. INSERT cart_details.
        //    quantity = reserved_quantity (same value, $11 used twice).
        //    seller_inventory is intentionally NOT updated — no
        //    physical reservation, only the cart-side "soft hold"
        //    accounted for in step 5 above.
        // --------------------------------------------------
        const cartInsert = await client.query({
            text: `
                INSERT INTO public.cart_details (
                    buyer_id,
                    product_id,
                    seller_id,
                    warehouse_id,
                    warehouse_type_id,
                    product_name,
                    sku,
                    oem_number,
                    unit_price,
                    price,
                    quantity,
                    uom_id,
                    tax_code,
                    tax_percentage,
                    tax_amount,
                    discount_amount,
                    final_price,
                    reserved_quantity,
                    reservation_expires_at,
                    cart_item_status_id,
                    quote_id,
                    quote_item_id,
                    quote_type_id,
                    buyer_note,
                    assigned_to,
                    assigned_at,
                    created_by
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8,
                    $9, $10, $11, $12,
                    $13, $14, $15, $16, $17,
                    $11,
                    $18,
                    $19,
                    NULL, NULL, NULL,
                    $20,
                    $21, $22, $23
                )
                RETURNING cart_item_id, cart_item_uuid
            `,
            values: [
                buyer_id,                       // $1
                product_id,                     // $2
                seller_id,                      // $3
                warehouse_id,                   // $4
                warehouse_type_id,               // $5
                product_name,                     // $6
                sku,                              // $7
                oem_number,                       // $8
                Number(sale_price),             // $9  → cart_details.unit_price (price_after_sale)
                Number(linePrice),              // $10 → cart_details.price (sale_price × quantity)
                requestedQty,                   // $11 → cart_details.quantity AND reserved_quantity (same value)
                uom_id    || null,               // $12
                taxCodeId || null,               // $13
                taxPercentage,                   // $14
                tax_amount,                      // $15
                discount_amount,                 // $16
                final_price,                     // $17
                reservation_expires_at,          // $18
                pending_status_id,               // $19
                buyer_note?.trim() || null,      // $20
                assigned_to,                      // $21
                assigned_at,                      // $22
                created_by,                       // $23
            ],
        });

        const { cart_item_id, cart_item_uuid } = cartInsert.rows[0];

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 9. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Product added to cart successfully",
            data: {
                cart_item_id,
                cart_item_uuid,
                buyer_id,
                product_id,
                seller_id,
                warehouse_id,
                warehouse_type_id,
                product_name,
                sku,
                oem_number,
                unit_price:            Number(sale_price),   // effective price per unit (price_after_sale)
                price:                 Number(linePrice),    // line total (sale_price × quantity)
                quantity:              requestedQty,
                uom_id:                uom_id    || null,
                tax_code:              taxCodeId || null,
                tax_percentage:        taxPercentage,
                tax_amount,
                discount_amount,       // informational — savings vs MRP, already reflected in `price`
                final_price,
                reserved_quantity:     requestedQty,         // same as quantity
                cart_item_status_id:   pending_status_id,
                quote_id:              null,
                quote_item_id:         null,
                quote_type_id:         null,
                reservation_expires_at,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (add-to-cart):", err);
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
// GET CART
// --------------------------------------------------

responder.on("get-cart", async (req, cb) => {
    const client = await pool.connect();

    try {
        const {
            buyer_uuid,
            Page     = 1,
            PageSize = 10,
        } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Buyer UUID is required",
            });

        const page     = Math.max(Number(Page) || 1, 1);
        const pageSize = Math.min(Math.max(Number(PageSize) || 10, 1), 100);
        const offset   = (page - 1) * pageSize;

        // --------------------------------------------------
        // 2. RESOLVE buyer_uuid → buyer_id
        // --------------------------------------------------
        const buyerResult = await client.query({
            text: `SELECT buyer_id
                   FROM public.buyer_accounts
                   WHERE buyer_uuid = $1
                     AND is_deleted  = FALSE
                     AND is_active   = TRUE`,
            values: [buyer_uuid.trim()],
        });

        if (buyerResult.rowCount === 0)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active buyer found with the provided UUID",
            });

        const { buyer_id } = buyerResult.rows[0];

        // --------------------------------------------------
        // 3. COUNT (for pagination)
        //    item_status is now cart_item_status_id (FK) —
        //    join cart_item_status and filter by code = 'PND'
        // --------------------------------------------------
        const countResult = await client.query({
            text: `SELECT COUNT(*) AS total
                   FROM public.cart_details CD
                   JOIN public.cart_item_status CIS
                     ON CIS.cart_item_status_id = CD.cart_item_status_id
                   WHERE CD.buyer_id   = $1
                     AND CIS.code      = 'PND'
                     AND CD.is_deleted = FALSE`,
            values: [buyer_id],
        });

        const total      = Number(countResult.rows[0].total);
        const totalPages = Math.ceil(total / pageSize);

        // --------------------------------------------------
        // 4. FETCH CART ITEMS (paginated)
        // --------------------------------------------------
        const itemsResult = await client.query({
            text: `
                SELECT
                    -- Cart item identifiers
                    CD.cart_item_id,
                    CD.cart_item_uuid,

                    -- Product details — locked-at-add-time (from cart_details)
                    CD.product_name        AS cart_product_name,
                    CD.sku                 AS cart_sku,
                    CD.oem_number          AS cart_oem_number,

                    -- Product details — live (from products, may differ if changed since add)
                    P.product_uuid,
                    P.name                  AS product_name,
                    PT.name                 AS product_type,
                    P.oem_part_number       AS part_number,
                    P.item_description      AS description,
                    P.manufacturer_name,
                    P.price                 AS live_unit_price,   -- current MRP
                    P.price_after_sale      AS live_sale_price,   -- current selling price

                    -- Seller details
                    SA.seller_uuid,
                    SA.seller_code,
                    SA.business_name,

                    -- Warehouse details
                    WT.warehouse_type_id,
                    WT.code                 AS warehouse_type_code,
                    WT.name                 AS warehouse_type_name,

                    -- Pricing from cart (locked at time of add)
                    CD.unit_price,
                    CD.price,
                    CD.quantity,
                    CD.tax_percentage,
                    CD.tax_amount,
                    CD.discount_amount,
                    CD.final_price,
                    CD.reserved_quantity,

                    -- UOM
                    U.code                  AS uom_code,
                    U.name                  AS uom_name,

                    -- Tax code
                    TCM.tax_code_uuid,
                    TCM.code                AS tax_code_code,
                    TCM.name                AS tax_code_name,
                    TCM.tax_rate,

                    -- Status
                    CIS.cart_item_status_id,
                    CIS.code                AS item_status_code,
                    CIS.name                AS item_status_name,
                    CD.reservation_expires_at,

                    -- Quote linkage (NULL until pulled into a quote)
                    CD.quote_id,
                    CD.quote_item_id,
                    CD.quote_type_id,

                    -- Buyer note
                    CD.buyer_note,

                    -- Images (primary image only)
                    (
                        SELECT PI.image_url
                        FROM public.product_images PI
                        WHERE PI.product_id = P.product_id
                          AND PI.is_deleted  = FALSE
                          AND PI.image_type  = 'PRIMARY'
                        ORDER BY PI.sort_order ASC
                        LIMIT 1
                    ) AS primary_image,

                    CD.created_at

                FROM public.cart_details CD

                JOIN public.cart_item_status CIS
                    ON CIS.cart_item_status_id = CD.cart_item_status_id

                JOIN public.warehouse_type WT
                    ON WT.warehouse_type_id = CD.warehouse_type_id

                JOIN public.products P
                    ON P.product_id = CD.product_id
                   AND P.is_deleted = FALSE

                JOIN public.product_types PT
                    ON PT.product_type_id = P.product_type_id

                JOIN public.seller_accounts SA
                    ON SA.seller_id  = CD.seller_id
                   AND SA.is_deleted = FALSE

                LEFT JOIN public.uom U
                    ON U.uom_id     = CD.uom_id
                   AND U.is_deleted = FALSE

                LEFT JOIN public.tax_code_master TCM
                    ON TCM.tax_code_id = CD.tax_code
                   AND TCM.is_deleted  = FALSE
                   AND TCM.is_active   = TRUE

                WHERE CD.buyer_id    = $1
                  AND CIS.code       = 'PND'
                  AND CD.is_deleted  = FALSE

                ORDER BY CD.created_at DESC

                LIMIT  $2
                OFFSET $3
            `,
            values: [buyer_id, pageSize, offset],
        });

        // --------------------------------------------------
        // 4b. PRICE-CHANGE CHECK
        //     Compare the locked cart price (CD.unit_price) against
        //     the product's current live selling price (live_sale_price).
        //     Adds price_changed / price_difference per item so the
        //     frontend doesn't need to duplicate float comparison logic.
        // --------------------------------------------------
        const items = itemsResult.rows.map(item => {
            const lockedPrice = Number(item.unit_price);
            const livePrice   = Number(item.live_sale_price);
            const priceChanged = lockedPrice !== livePrice;

            return {
                ...item,
                price_changed:    priceChanged,
                price_difference: priceChanged
                    ? parseFloat((livePrice - lockedPrice).toFixed(2))
                    : 0,
            };
        });

        // --------------------------------------------------
        // 5. CART SUMMARY TOTALS (across ALL pending items, not just this page)
        //    Also surfaces total discount saved — new, since discount_amount
        //    is now actually populated (see add-to-cart).
        // --------------------------------------------------
        const summaryResult = await client.query({
            text: `
                SELECT
                    COALESCE(SUM(CD.price),            0) AS subtotal,
                    COALESCE(SUM(CD.tax_amount),       0) AS total_tax,
                    COALESCE(SUM(CD.discount_amount),  0) AS total_discount,
                    COALESCE(SUM(CD.final_price),      0) AS grand_total,
                    COUNT(*)                               AS total_items
                FROM public.cart_details CD
                JOIN public.cart_item_status CIS
                    ON CIS.cart_item_status_id = CD.cart_item_status_id
                WHERE CD.buyer_id   = $1
                  AND CIS.code      = 'PND'
                  AND CD.is_deleted = FALSE
            `,
            values: [buyer_id],
        });

        const summary = {
            subtotal:       parseFloat(Number(summaryResult.rows[0].subtotal).toFixed(2)),
            total_tax:      parseFloat(Number(summaryResult.rows[0].total_tax).toFixed(2)),
            total_discount: parseFloat(Number(summaryResult.rows[0].total_discount).toFixed(2)),
            grand_total:    parseFloat(Number(summaryResult.rows[0].grand_total).toFixed(2)),
            total_items:    Number(summaryResult.rows[0].total_items),
        };

        // --------------------------------------------------
        // 6. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Cart fetched successfully",
            error:              null,
            result: {
                page,
                pageSize,
                totalRecords: total,
                totalPages,
                summary,
                data: items,
            },
        });

    } catch (err) {
        logger.error("Responder Error (get-cart):", err);
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
// DELETE ITEM FROM CART
// --------------------------------------------------


responder.on("remove-cart-item", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { cart_item_uuid } = req;
        const { deleted_by } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!cart_item_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Cart item UUID is required",
            });
        }

        if (!deleted_by?.trim()) {
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
        // 2. FETCH CART ITEM
        // --------------------------------------------------
        const cartCheck = await pool.query(
            `SELECT
                cd.cart_item_id,
                cd.cart_item_uuid,
                cd.buyer_id,
                cd.product_id,
                cd.seller_id,
                cd.warehouse_id,
                cd.quantity,
                cd.cart_item_status_id,
                cd.quote_id,
                cd.quote_item_id,
                cis.code AS status_code
             FROM public.cart_details cd
             JOIN public.cart_item_status cis
               ON cis.cart_item_status_id = cd.cart_item_status_id
             WHERE cd.cart_item_uuid = $1
               AND cd.is_deleted     = FALSE`,
            [cart_item_uuid]
        );

        if (cartCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active cart item found with the provided UUID",
            });
        }

        const cartItem = cartCheck.rows[0];

        // --------------------------------------------------
        // 3. BUSINESS RULE — Cannot remove already removed
        //    or quoted items
        // --------------------------------------------------
        if (cartItem.status_code === 'REM') {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              "This cart item has already been removed",
            });
        }

        if (cartItem.status_code === 'QTD') {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              "This cart item is part of a saved quote and cannot be removed directly. Delete or update the quote first.",
            });
        }

        // --------------------------------------------------
        // 3.5 RESOLVE REMOVED status id
        // --------------------------------------------------
        const removedStatusResult = await pool.query(
            `SELECT cart_item_status_id
             FROM public.cart_item_status
             WHERE code = 'REM' AND is_active = TRUE AND is_deleted = FALSE`
        );

        if (removedStatusResult.rowCount === 0) {
            logger.error("remove-cart-item: missing master data — cart_item_status(REM)");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Configuration error",
                error:              "Required master data (cart item status) not found",
            });
        }

        const removed_status_id = removedStatusResult.rows[0].cart_item_status_id;

        // --------------------------------------------------
        // 4. TRANSACTION — soft-delete cart item only.
        //    NOTE: seller_inventory.reserved_qty is NOT touched here.
        //    add-to-cart no longer reserves stock in seller_inventory
        //    (only checks availability at add time), so there is
        //    nothing on the inventory side to release on removal.
        // --------------------------------------------------
        const now = new Date();

        await client.query("BEGIN");

        await client.query(
            `UPDATE public.cart_details SET
                cart_item_status_id = $1,
                quote_id             = NULL,
                quote_item_id        = NULL,
                quote_type_id        = NULL,
                is_active            = FALSE,
                is_deleted           = TRUE,
                deleted_at           = $2,
                deleted_by           = $3,
                modified_at          = $2,
                modified_by          = $3
             WHERE cart_item_uuid = $4
               AND is_deleted     = FALSE`,
            [removed_status_id, now, deleted_by, cart_item_uuid]
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
            message:            "Cart item removed successfully",
            data: {
                cart_item_uuid,
                product_id:   cartItem.product_id,
                warehouse_id: cartItem.warehouse_id,
                quantity:     cartItem.quantity,
                deleted_at:   now,
            },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (remove-cart-item):", err);
        saveErrorLog({
            api_name:   "remove-cart-item",
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
            message:            "Remove cart item failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// BULK DELETE ALL CART ITEMS FOR A BUYER
// --------------------------------------------------


responder.on("bulk-remove-cart-items", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { deleted_by, buyer_uuid } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "buyer uuid is required",
            });
        }

        if (!deleted_by?.trim()) {
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
        // 2. RESOLVE buyer_id FROM buyer_accounts
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid             = $1
               AND is_active              = TRUE
               AND is_deleted             = FALSE
               AND phone_number_verified  = TRUE`,
            [buyer_uuid]
        );

        if (buyerCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active verified buyer found with the provided UUID",
            });
        }

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // --------------------------------------------------
        // 3. RESOLVE REMOVED status id
        // --------------------------------------------------
        const removedStatusResult = await pool.query(
            `SELECT cart_item_status_id
             FROM public.cart_item_status
             WHERE code = 'REM' AND is_active = TRUE AND is_deleted = FALSE`
        );

        if (removedStatusResult.rowCount === 0) {
            logger.error("bulk-remove-cart-items: missing master data — cart_item_status(REM)");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Configuration error",
                error:              "Required master data (cart item status) not found",
            });
        }

        const removed_status_id = removedStatusResult.rows[0].cart_item_status_id;

        // --------------------------------------------------
        // 4. FETCH ALL ACTIVE REMOVABLE CART ITEMS FOR BUYER
        //    Excludes items already REM (removed) AND items that
        //    are QTD (quoted) — quoted items are never bulk-removed.
        // --------------------------------------------------
        const cartCheck = await pool.query(
            `SELECT
                cd.cart_item_id,
                cd.cart_item_uuid,
                cd.product_id,
                cd.seller_id,
                cd.warehouse_id,
                cd.quantity
             FROM public.cart_details cd
             JOIN public.cart_item_status cis
               ON cis.cart_item_status_id = cd.cart_item_status_id
             WHERE cd.buyer_id   = $1
               AND cis.code      NOT IN ('REM', 'QTD')
               AND cd.is_deleted = FALSE`,
            [buyer_id]
        );

        if (cartCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No removable cart items found for this buyer (items already removed or part of a saved quote are excluded)",
            });
        }

        const removableItems = cartCheck.rows;

        // --------------------------------------------------
        // 5. TRANSACTION — bulk soft-delete only.
        //    NOTE: seller_inventory.reserved_qty is NOT touched.
        //    add-to-cart no longer reserves stock in seller_inventory,
        //    so there is nothing on the inventory side to release.
        // --------------------------------------------------
        const now = new Date();

        await client.query("BEGIN");

        await client.query(
            `UPDATE public.cart_details SET
                cart_item_status_id = $1,
                quote_id             = NULL,
                quote_item_id        = NULL,
                quote_type_id        = NULL,
                is_active            = FALSE,
                is_deleted           = TRUE,
                deleted_at           = $2,
                deleted_by           = $3,
                modified_at          = $2,
                modified_by          = $3
             WHERE cart_item_id = ANY($4::bigint[])
               AND is_deleted   = FALSE`,
            [removed_status_id, now, deleted_by, removableItems.map((r) => r.cart_item_id)]
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
            message:            `${removableItems.length} cart item(s) removed successfully`,
            data: {
                buyer_id:      buyer_id,
                removed_count: removableItems.length,
                deleted_at:    now,
            },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (bulk-remove-cart-items):", err);
        saveErrorLog({
            api_name:   "bulk-remove-cart-items",
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
            message:            "Bulk remove cart items failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// UPDATE CART QUANTITY
// --------------------------------------------------

responder.on("update-cart-item-quantity", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const { cart_item_uuid } = req;
        const { new_quantity, modified_by } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!cart_item_uuid?.trim())
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2001, message: "Validation failed", error: "Cart item UUID is required",
            });

        if (!modified_by?.trim())
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2001, message: "Validation failed", error: "modified by is required",
            });

        if (new_quantity === undefined || new_quantity === null || isNaN(Number(new_quantity)))
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2001, message: "Validation failed", error: "Valid new quantity is required",
            });

        if (Number(new_quantity) <= 0)
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2001, message: "Validation failed", error: "new quantity must be greater than zero",
            });

        // --------------------------------------------------
        // 2. FETCH EXISTING CART ITEM (read-only, pre-transaction)
        // --------------------------------------------------
        const cartCheck = await client.query(
            `SELECT
                cd.cart_item_id,
                cd.cart_item_uuid,
                cd.buyer_id,
                cd.product_id,
                cd.seller_id,
                cd.warehouse_id,
                cd.quantity,
                cd.unit_price,
                cd.tax_code,
                cd.tax_percentage,
                cd.discount_amount,
                cd.uom_id,
                cd.cart_item_status_id,
                cis.code AS status_code
             FROM public.cart_details cd
             JOIN public.cart_item_status cis
               ON cis.cart_item_status_id = cd.cart_item_status_id
             WHERE cd.cart_item_uuid = $1
               AND cd.is_deleted     = FALSE`,
            [cart_item_uuid]
        );

        if (cartCheck.rowCount === 0)
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2003, message: "Record not found", error: "No active cart item found with the provided UUID",
            });

        const cartItem = cartCheck.rows[0];

        // --------------------------------------------------
        // 3. BUSINESS RULE GUARDS
        // --------------------------------------------------
        if (cartItem.status_code === 'REM')
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2008, message: "Action not allowed", error: "Cannot update a removed cart item",
            });

        if (cartItem.status_code === 'QTD')
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2008, message: "Action not allowed",
                error: "This cart item is part of a saved quote. Update the quantity via the quote instead.",
            });

        const oldQty  = Number(cartItem.quantity);
        const newQty  = Number(new_quantity);
        const qtyDiff = newQty - oldQty;  

        // No-op guard — avoid unnecessary writes
        if (qtyDiff === 0)
            return cb(null, {
                header_type: "SUCCESS", message_visibility: true, status: true,
                code: 1000, message: "Quantity unchanged", data: { cart_item_uuid, quantity: oldQty },
            });

        // ====================================================
        // TRANSACTION START — lock seller_inventory row before
        // checking/updating, to serialize concurrent requests
        // against the same product+seller+warehouse.
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 4. LOCK the seller_inventory row FIRST — same pattern
        //    as add-to-cart. Always locked (increase or decrease),
        //    since a decrease also frees up pool for concurrent
        //    requests and should be serialized consistently.
        // --------------------------------------------------
        const inventoryCheck = await client.query(
            `SELECT
                onhand_qty,
                reserved_qty,
                buffer_qty
             FROM public.seller_inventory
             WHERE product_id   = $1
               AND warehouse_id = $2
               AND seller_id    = $3
               AND is_deleted   = FALSE
             FOR UPDATE`,
            [cartItem.product_id, cartItem.warehouse_id, cartItem.seller_id]
        );

        if (inventoryCheck.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2003, message: "Record not found", error: "Inventory record not found for this product and warehouse",
            });
        }

        // --------------------------------------------------
        // 5. STOCK AVAILABILITY CHECK — same pattern as add-to-cart.
        //    inventory_available = onhand_qty - buffer_qty - reserved_qty
        //    net_available       = inventory_available - SUM(active cart
        //                          reserved_quantity for this product,
        //                          seller, warehouse across ALL OTHER
        //                          cart lines — current item excluded,
        //                          since its old hold is being replaced)
        //    Checked on BOTH increase and decrease, for consistency —
        //    though a decrease can never fail this check.
        // --------------------------------------------------
        const inv = inventoryCheck.rows[0];

        const inventoryAvailable =
            Number(inv.onhand_qty) - Number(inv.buffer_qty) - Number(inv.reserved_qty);

        const cartReservedResult = await client.query(
            `SELECT COALESCE(SUM(cd.reserved_quantity), 0) AS total_reserved
             FROM public.cart_details cd
             JOIN public.cart_item_status cis
               ON cis.cart_item_status_id = cd.cart_item_status_id
             WHERE cd.product_id    = $1
               AND cd.seller_id     = $2
               AND cd.warehouse_id  = $3
               AND cd.cart_item_id != $4
               AND cd.is_deleted    = FALSE
               AND cis.code NOT IN ('REM', 'EXP')`,
            [cartItem.product_id, cartItem.seller_id, cartItem.warehouse_id, cartItem.cart_item_id]
        );

        const existingCartReserved = Number(cartReservedResult.rows[0].total_reserved);
        const netAvailable         = inventoryAvailable - existingCartReserved;

        if (netAvailable <= 0 && newQty > 0 && qtyDiff > 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2007, message: "Out of stock",
                error: "This product is currently out of stock",
            });
        }

        if (newQty > netAvailable) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2007, message: "Insufficient stock",
                error: `Only ${netAvailable} unit(s) available for this product in the selected warehouse`,
            });
        }

        // --------------------------------------------------
        // 6. RECALCULATE PRICE FIELDS
        //    unit_price is the locked sale price per unit — unchanged.
        //    tax_percentage and discount_amount scale proportionally
        //    with the new quantity.
        // --------------------------------------------------
        const unitPrice     = Number(cartItem.unit_price);
        const taxPercentage = Number(cartItem.tax_percentage) || 0;

        const perUnitDiscount = oldQty > 0
            ? Number(cartItem.discount_amount) / oldQty
            : 0;

        const newPrice          = parseFloat((unitPrice * newQty).toFixed(2));
        const newTaxAmount      = parseFloat((newPrice * taxPercentage / 100).toFixed(2));
        const newDiscountAmount = parseFloat((perUnitDiscount * newQty).toFixed(2));
        const newFinalPrice     = parseFloat((newPrice + newTaxAmount).toFixed(2));

        const now                  = new Date();
        const reservationExpiresAt = new Date(now.getTime() + commonenum.TIME_DURATION_MINUTES.RESERVATION_EXPIRY * 60 * 1000 ); 

        // --------------------------------------------------
        // 7. UPDATE cart_details.
        //    quantity = reserved_quantity, same convention as add-to-cart.
        //    seller_inventory is NOT touched — no physical reservation,
        //    only the cart-side "soft hold" accounted for in step 5.
        // --------------------------------------------------
        const updateCart = await client.query(
            `UPDATE public.cart_details SET
                quantity               = $1,
                price                  = $2,
                tax_amount              = $3,
                discount_amount         = $4,
                final_price             = $5,
                reserved_quantity       = $1,
                reservation_expires_at  = $6,
                modified_at             = $7,
                modified_by             = $8
             WHERE cart_item_uuid = $9
               AND is_deleted     = FALSE
             RETURNING
                cart_item_uuid,
                quantity,
                unit_price,
                price,
                tax_percentage,
                tax_amount,
                discount_amount,
                final_price,
                reserved_quantity,
                reservation_expires_at`,
            [newQty, newPrice, newTaxAmount, newDiscountAmount, newFinalPrice, reservationExpiresAt, now, modified_by, cart_item_uuid]
        );

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 8. RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Cart item quantity updated successfully",
            data: {
                ...updateCart.rows[0],
                quantity_before:        oldQty,
                quantity_after:         newQty,
                quantity_diff:          qtyDiff,
                reservation_expires_at: reservationExpiresAt,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (update-cart-item-quantity):", err);
        saveErrorLog({
            api_name:   "update-cart-item-quantity",
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
            message:            "Update cart item quantity failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});


// --------------------------------------------------
// CREATE BUYER QUOTE (Single + Bulk)
// --------------------------------------------------

async function resolveServiceCharges(client, service_charges, product_subtotal) {
    const ALLOWED_CHARGE_TYPES = ["FIXED", "PERCENTAGE"];

    if (!Array.isArray(service_charges) || service_charges.length === 0) {
        return { chargeLineItems: [], total_charges_amount: 0 };
    }

    for (const sc of service_charges) {
        if (!sc.service_charge_uuid?.trim()) {
            throw {
                validationError: {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            "Validation failed",
                    error:              "Each service charge must have a valid service_charge_uuid",
                },
            };
        }

        const charge_type = String(sc.charge_type || "").trim().toUpperCase();
        if (!ALLOWED_CHARGE_TYPES.includes(charge_type)) {
            throw {
                validationError: {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            "Validation failed",
                    error:              `charge_type must be one of ${ALLOWED_CHARGE_TYPES.join(", ")} for service charge ${sc.service_charge_uuid}`,
                },
            };
        }

        if (sc.charge_value === undefined || sc.charge_value === null || isNaN(Number(sc.charge_value))) {
            throw {
                validationError: {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            "Validation failed",
                    error:              `charge_value must be a valid number for service charge ${sc.service_charge_uuid}`,
                },
            };
        }

        if (charge_type === "PERCENTAGE" && (Number(sc.charge_value) < 0 || Number(sc.charge_value) > 100)) {
            throw {
                validationError: {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            "Validation failed",
                    error:              `charge_value must be between 0 and 100 for a PERCENTAGE charge (${sc.service_charge_uuid})`,
                },
            };
        }

        if (charge_type === "PERCENTAGE" && (sc.charge_amount === undefined || sc.charge_amount === null || isNaN(Number(sc.charge_amount)))) {
            throw {
                validationError: {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            "Validation failed",
                    error:              `charge_amount (base amount to apply the percentage on) must be a valid number for a PERCENTAGE charge (${sc.service_charge_uuid})`,
                },
            };
        }

        if (charge_type === "PERCENTAGE" && Number(sc.charge_amount) < 0) {
            throw {
                validationError: {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            "Validation failed",
                    error:              `charge_amount must not be negative for a PERCENTAGE charge (${sc.service_charge_uuid})`,
                },
            };
        }
    }

    const chargeUuids       = service_charges.map((sc) => sc.service_charge_uuid.trim().toLowerCase());
    const uniqueChargeUuids = new Set(chargeUuids);
    if (uniqueChargeUuids.size !== chargeUuids.length) {
        throw {
            validationError: {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "service_charges contains duplicate service_charge_uuid values",
            },
        };
    }

    const uuids = service_charges.map((sc) => sc.service_charge_uuid.trim());

    const masterResult = await client.query(
        `SELECT service_charge_id, service_charge_uuid, code, name, charge_type AS default_charge_type
         FROM public.service_charge
         WHERE service_charge_uuid = ANY($1::uuid[])
           AND is_active           = TRUE
           AND is_deleted          = FALSE`,
        [uuids]
    );

    const masterMap = {};
    for (const row of masterResult.rows) {
        masterMap[row.service_charge_uuid] = row;
    }

    const missing = uuids.filter((u) => !masterMap[u]);
    if (missing.length > 0) {
        throw {
            validationError: {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              `Invalid or inactive service charge(s): ${missing.join(", ")}`,
            },
        };
    }

    let total_charges_amount = 0;

    const chargeLineItems = service_charges.map((sc) => {
        const master       = masterMap[sc.service_charge_uuid.trim()];
        const charge_type  = String(sc.charge_type).trim().toUpperCase();
        const charge_value = parseFloat(Number(sc.charge_value).toFixed(2));

        // PERCENTAGE: charge_value% is applied against the per-charge base
        // amount supplied in the payload (sc.charge_amount), NOT the quote's
        // overall product_subtotal.
        // FIXED: charge_amount is just charge_value as-is.
        const charge_amount = charge_type === "PERCENTAGE"
            ? parseFloat((Number(sc.charge_amount) * charge_value / 100).toFixed(2))
            : charge_value;

        total_charges_amount += charge_amount;

        return {
            service_charge_id: master.service_charge_id,
            service_charge_name: master.name,
            charge_type,
            charge_value,
            charge_amount,
        };
    });

    return {
        chargeLineItems,
        total_charges_amount: parseFloat(total_charges_amount.toFixed(2)),
    };
}


responder.on("create-buyer-quote", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const {
            buyer_uuid,
            customer_name,
            customer_email,
            customer_phone,
            customer_address,
            car_brand_uuid,
            car_model_uuid,
            tax_code_uuid,
            quote_type_uuid,
            cart_items,
            service_charges,   // [{ service_charge_uuid, charge_type, charge_value }]
            created_by,
        } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "buyer uuid is required",
            });
        }

        if (!customer_name?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "customer name is required",
            });
        }

        if (!tax_code_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "tax code uuid is required",
            });
        }

        if (!Array.isArray(cart_items) || cart_items.length === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "cart items must be a non-empty array",
            });
        }

        if (!created_by?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "created by is required",
            });
        }

        if (service_charges !== undefined && !Array.isArray(service_charges)) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "service charges must be an array if provided",
            });
        }

        for (const item of cart_items) {
            if (!item.cart_item_uuid?.trim()) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            "Validation failed",
                    error:              "Each cart item must have a valid cart item uuid",
                });
            }

            if (
                item.margin_per !== undefined &&
                item.margin_per !== null &&
                isNaN(Number(item.margin_per))
            ) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            "Validation failed",
                    error:              `margin percentage must be a valid number for cart item ${item.cart_item_uuid}`,
                });
            }
        }

        // --------------------------------------------------
        // 2. RESOLVE buyer_id FROM buyer_accounts
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid]
        );

        if (buyerCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active verified buyer found with the provided UUID",
            });
        }

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // --------------------------------------------------
        // 3. RESOLVE tax_code_id FROM tax_code_master
        // --------------------------------------------------
        const taxCheck = await pool.query(
            `SELECT tax_code_id, tax_rate
             FROM public.tax_code_master
             WHERE tax_code_uuid = $1
               AND is_active     = TRUE
               AND is_deleted    = FALSE`,
            [tax_code_uuid]
        );

        if (taxCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "Invalid or inactive tax code provided",
            });
        }

        const tax_code_id = taxCheck.rows[0].tax_code_id;
        const tax_rate    = Number(taxCheck.rows[0].tax_rate);

        // --------------------------------------------------
        // 4. RESOLVE quote_type_id FROM quote_type master
        // --------------------------------------------------
        let quoteTypeResult;

        if (quote_type_uuid?.trim()) {
            quoteTypeResult = await pool.query(
                `SELECT quote_type_id
                 FROM public.quote_type
                 WHERE quote_type_uuid = $1
                   AND is_active       = TRUE
                   AND is_deleted      = FALSE`,
                [quote_type_uuid.trim()]
            );

            if (quoteTypeResult.rowCount === 0) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "Invalid or inactive quote type provided",
                });
            }
        } else {
            quoteTypeResult = await pool.query(
                `SELECT quote_type_id
                 FROM public.quote_type
                 WHERE code = 'BSV'
                   AND is_active  = TRUE
                   AND is_deleted = FALSE`
            );

            if (quoteTypeResult.rowCount === 0) {
                logger.error("create-buyer-quote: missing master data — quote_type(BSV)");
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Configuration error",
                    error:              "Default quote type (BSV) not found in quote_type master table",
                });
            }
        }

        const quote_type_id = quoteTypeResult.rows[0].quote_type_id;

        // --------------------------------------------------
        // 5. RESOLVE car_brand_id FROM brand (optional)
        // --------------------------------------------------
        let car_brand_id = null;

        if (car_brand_uuid?.trim()) {
            const brandCheck = await pool.query(
                `SELECT brand_id
                 FROM public.brand
                 WHERE brand_uuid = $1
                   AND is_active  = TRUE
                   AND is_deleted = FALSE`,
                [car_brand_uuid]
            );

            if (brandCheck.rowCount === 0) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "Invalid or inactive car brand provided",
                });
            }

            car_brand_id = brandCheck.rows[0].brand_id;
        }

        // --------------------------------------------------
        // 6. RESOLVE car_model_id FROM model (optional)
        // --------------------------------------------------
        let car_model_id = null;

        if (car_model_uuid?.trim()) {
            const modelCheck = await pool.query(
                `SELECT model_id
                 FROM public.model
                 WHERE model_uuid = $1
                   AND is_active  = TRUE
                   AND is_deleted = FALSE`,
                [car_model_uuid]
            );

            if (modelCheck.rowCount === 0) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "Invalid or inactive car model provided",
                });
            }

            car_model_id = modelCheck.rows[0].model_id;
        }

        // --------------------------------------------------
        // 7. RESOLVE cart_item_status ids needed (QTD)
        // --------------------------------------------------
        const quotedStatusResult = await pool.query(
            `SELECT cart_item_status_id
             FROM public.cart_item_status
             WHERE code = 'QTD' AND is_active = TRUE AND is_deleted = FALSE`
        );

        if (quotedStatusResult.rowCount === 0) {
            logger.error("create-buyer-quote: missing master data — cart_item_status(QTD)");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Configuration error",
                error:              "Required master data (cart item status) not found",
            });
        }

        const quoted_status_id = quotedStatusResult.rows[0].cart_item_status_id;

        // --------------------------------------------------
        // 8. FETCH AND VALIDATE CART ITEMS
        //    CHANGE: warehouse_id / warehouse_type_id pulled in here
        //    too — needed to populate the same columns on
        //    buyer_quote_items (step 9 / 13c below), so listing-origin
        //    and cart-origin quote items expose warehouse info the
        //    same way.
        // --------------------------------------------------
        const cartUuids       = cart_items.map((i) => i.cart_item_uuid.trim());
        const uniqueCartUuids = [...new Set(cartUuids)];
        const placeholders    = uniqueCartUuids.map((_, i) => `$${i + 2}`).join(", ");

        const cartCheck = await pool.query(
            `SELECT
                cd.cart_item_id,
                cd.cart_item_uuid,
                cd.product_id,
                cd.quantity,
                cd.unit_price,
                cd.uom_id,
                cd.warehouse_id,
                cd.warehouse_type_id,
                cis.code AS status_code
             FROM public.cart_details cd
             JOIN public.cart_item_status cis
               ON cis.cart_item_status_id = cd.cart_item_status_id
             WHERE cd.buyer_id            = $1
               AND cd.cart_item_uuid = ANY(ARRAY[${placeholders}]::uuid[])
               AND cd.is_deleted          = FALSE
               AND cd.is_active           = TRUE`,
            [buyer_id, ...uniqueCartUuids]
        );

        if (cartCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No valid cart items found for this buyer",
            });
        }

        const foundUuids   = cartCheck.rows.map((r) => r.cart_item_uuid);
        const missingUuids = uniqueCartUuids.filter((u) => !foundUuids.includes(u));

        if (missingUuids.length > 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              `Some cart items not found or do not belong to this buyer: ${missingUuids.join(", ")}`,
            });
        }

        const ineligible = cartCheck.rows.filter(
            (r) => r.status_code === "QTD"
        );

        if (ineligible.length > 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Some cart items are already quoted or checked out: ${ineligible.map((r) => r.cart_item_uuid).join(", ")}`,
            });
        }

        const cartRowMap = {};
        for (const row of cartCheck.rows) {
            cartRowMap[row.cart_item_uuid] = row;
        }

        // --------------------------------------------------
        // 9. CALCULATE PRODUCT LINE ITEM TOTALS (product-only subtotal/tax)
        //    CHANGE: warehouse_id / warehouse_type_id carried onto
        //    each line so they can be inserted into buyer_quote_items.
        // --------------------------------------------------
        let subtotal  = 0;
        let total_tax = 0;

        const quoteLineItems = cart_items.map((item) => {
            const cartRow           = cartRowMap[item.cart_item_uuid];
            const unit_price        = Number(cartRow.unit_price);
            const quantity          = Number(cartRow.quantity);
            const margin_per        = Number(item.margin_per ?? 0);
            const price_with_margin = parseFloat(
                (unit_price + (unit_price * margin_per / 100)).toFixed(2)
            );
            const line_total = parseFloat((price_with_margin * quantity).toFixed(2));
            const tax_amount = parseFloat((line_total * tax_rate / 100).toFixed(2));

            subtotal  += line_total;
            total_tax += tax_amount;

            return {
                product_id:         cartRow.product_id,
                warehouse_id:       cartRow.warehouse_id,
                warehouse_type_id:  cartRow.warehouse_type_id,
                service_item:       "Product",
                quantity,
                uom_id:             cartRow.uom_id || null,
                price:              unit_price,
                margin_per,
                price_with_margin,
                tax_code_id,
                tax_amount,
                cart_item_id:       cartRow.cart_item_id,
                cart_item_uuid:     cartRow.cart_item_uuid,
            };
        });

        // --------------------------------------------------
        // 10. RESOLVE + COMPUTE SERVICE CHARGES (non-taxable)
        // --------------------------------------------------
        let chargeLineItems      = [];
        let total_charges_amount = 0;

        try {
            const chargeResult = await resolveServiceCharges(pool, service_charges, subtotal);
            chargeLineItems      = chargeResult.chargeLineItems;
            total_charges_amount = chargeResult.total_charges_amount;
        } catch (e) {
            if (e.validationError) return cb(null, e.validationError);
            throw e;
        }

        const total_price = parseFloat((subtotal + total_tax + total_charges_amount).toFixed(2));

        // --------------------------------------------------
        // 11. COMPUTE HEADER-LEVEL AGGREGATES (product items only)
        // --------------------------------------------------
        const total_quantity          = quoteLineItems.reduce((s, i) => s + i.quantity, 0);
        const total_price_sum         = parseFloat(
            quoteLineItems.reduce((s, i) => s + i.price, 0).toFixed(2)
        );
        const avg_margin_per          = parseFloat(
            (quoteLineItems.reduce((s, i) => s + i.margin_per, 0) / quoteLineItems.length).toFixed(2)
        );
        const total_price_with_margin = parseFloat(
            quoteLineItems.reduce((s, i) => s + (i.price_with_margin * i.quantity), 0).toFixed(2)
        );

        // --------------------------------------------------
        // 12. RESOLVE DRAFT status_of_quote id
        // --------------------------------------------------
        const statusCheck = await pool.query(
            `SELECT quote_status_id
             FROM public.quote_statuses
             WHERE UPPER(name) = 'DRAFT'
               AND is_active   = TRUE
               AND is_deleted  = FALSE
             LIMIT 1`
        );

        if (statusCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Configuration error",
                error:              "DRAFT quote status not found in quote statuses table",
            });
        }

        const draft_status_id = statusCheck.rows[0].quote_status_id;

        // --------------------------------------------------
        // 13. TRANSACTION
        // --------------------------------------------------
        const now      = new Date();
        const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");

        await client.query("BEGIN");
        inTransaction = true;

        // 13a. GENERATE QUOTE NUMBER INSIDE TRANSACTION
        await client.query(
            `SELECT pg_advisory_xact_lock($1)`,
            [commonenum.QUOTE_SEQ_LOCK_KEY]
        );

        const seqResult = await client.query(
            `SELECT COUNT(*) AS today_count
             FROM public.buyer_saved_quote
             WHERE DATE(created_at) = CURRENT_DATE`
        );

        const sequence = (Number(seqResult.rows[0].today_count) + 1)
            .toString()
            .padStart(4, "0");

        const quote_no = `QT-${datePart}-${sequence}`;

const reservation_expires_at = new Date(
    now.getTime() +
    commonenum.TIME_DURATION_MINUTES.QUOTE_RESERVATION_EXPIRY * 60 * 1000
);
        // 13b. INSERT buyer_saved_quote header
        //      NOTE: reservation_expires_at intentionally NOT set here
        //      — cart-origin items already carry their own soft-hold
        //      via cart_details.reservation_expires_at, which is what
        //      every ATP subquery already accounts for. Header-level
        //      reservation is only meaningful for listing-origin quotes
        //      (create-buyer-quote-listing-*.js), whose items have no
        //      cart_details row to hold a per-item expiry.
       
        const quoteInsert = await client.query(
    `INSERT INTO public.buyer_saved_quote (
        buyer_id,
        quote_no,
        quote_type_id,
        tax_code_id,
        status_of_quote,
        quantity,
        price,
        margin_per,
        price_with_margin,
        total_price,
        customer_name,
        customer_email,
        customer_phone,
        customer_address,
        car_brand_id,
        car_model_id,
        is_active,
        created_at,
        created_by,
        assigned_to,
        reservation_expires_at
     ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16,
        TRUE, $17, $18, $19, $20
     )
     RETURNING buyer_quote_id, buyer_quote_uuid`,
    [
        buyer_id,
        quote_no,
        quote_type_id,
        tax_code_id,
        draft_status_id,
        total_quantity,
        total_price_sum,
        avg_margin_per,
        total_price_with_margin,
        total_price,
        customer_name.trim(),
        customer_email?.trim() || null,
        customer_phone?.trim() || null,
        customer_address?.trim() || null,
        car_brand_id,
        car_model_id,
        now,
        created_by,
        created_by,
        reservation_expires_at
    ]
);

        const buyer_quote_id   = quoteInsert.rows[0].buyer_quote_id;
        const buyer_quote_uuid = quoteInsert.rows[0].buyer_quote_uuid;

        // 13c. INSERT product line items into buyer_quote_items
        //      AND link the source cart_details row (QUOTED + quote_id/item_id/type)
        //      CHANGE: warehouse_id / warehouse_type_id now populated
        //      from the source cart row, mirroring listing-origin
        //      quote items so getById-buyer-quote.js / get-buyer-
        //      quotes.js can read warehouse info consistently from
        //      buyer_quote_items regardless of origin.
        for (const line of quoteLineItems) {
            const itemInsert = await client.query(
                `INSERT INTO public.buyer_quote_items (
                    buyer_quote_id,
                    product_id,
                    warehouse_id,
                    warehouse_type_id,
                    service_item,
                    quantity,
                    uom_id,
                    price,
                    margin_per,
                    price_with_margin,
                    tax_code_id,
                    tax_amount,
                    cart_item_id,
                    is_active,
                    created_at,
                    created_by,
                    assigned_to
                 ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, $8, $9, $10,
                    $11, $12,
                    $13,
                    TRUE, $14, $15, $16
                 )
                 RETURNING buyer_quote_item_id`,
                [
                    buyer_quote_id,
                    line.product_id,
                    line.warehouse_id,
                    line.warehouse_type_id,
                    line.service_item,
                    line.quantity,
                    line.uom_id,
                    line.price,
                    line.margin_per,
                    line.price_with_margin,
                    line.tax_code_id,
                    line.tax_amount,
                    line.cart_item_id,
                    now,
                    created_by,
                    created_by,
                ]
            );

            const buyer_quote_item_id = itemInsert.rows[0].buyer_quote_item_id;

            await client.query(
                `UPDATE public.cart_details SET
                    cart_item_status_id = $1,
                    quote_id             = $2,
                    quote_item_id        = $3,
                    quote_type_id        = $4,
                    modified_at          = $5,
                    modified_by          = $6
                 WHERE cart_item_id = $7
                   AND is_deleted   = FALSE`,
                [
                    quoted_status_id,
                    buyer_quote_id,
                    buyer_quote_item_id,
                    quote_type_id,
                    now,
                    created_by,
                    line.cart_item_id,
                ]
            );
        }

        // 13d. INSERT service charges into buyer_quote_service_charges
        for (const charge of chargeLineItems) {
            await client.query(
                `INSERT INTO public.buyer_quote_service_charges (
                    buyer_quote_id,
                    service_charge_id,
                    charge_type,
                    charge_value,
                    charge_amount,
                    is_active,
                    created_at,
                    assigned_at,
                    created_by,
                    assigned_to
                 ) VALUES ($1, $2, $3, $4, $5, TRUE, $6, $6, $7, $7)`,
                [
                    buyer_quote_id,
                    charge.service_charge_id,
                    charge.charge_type,
                    charge.charge_value,
                    charge.charge_amount,
                    now,
                    created_by,
                ]
            );
        }

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 14. RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Quote created successfully",
            data: {
                buyer_quote_id,
                buyer_quote_uuid,
                quote_no,
                quote_type_id,
                total_price,
                item_count:    quoteLineItems.length,
                charge_count:  chargeLineItems.length,
                charges_total: total_charges_amount,
                created_at:    now,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (create-buyer-quote):", err);
        saveErrorLog({
            api_name:   "create-buyer-quote",
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
            message:            "Create quote failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// ADD ITEMS TO EXISTING DRAFT QUOTE
// --------------------------------------------------



responder.on("add-quote-items", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { buyer_quote_uuid } = req;
        const {
            buyer_uuid,
            cart_items,   // [{ cart_item_uuid, margin_per }]
            modified_by,
        } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_quote_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "buyer_quote_uuid is required",
            });
        }

        if (!buyer_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "buyer_uuid is required",
            });
        }

        if (!Array.isArray(cart_items) || cart_items.length === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "cart_items must be a non-empty array",
            });
        }

        if (!modified_by?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "modified_by is required",
            });
        }

        for (const item of cart_items) {
            if (!item.cart_item_uuid?.trim()) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            "Validation failed",
                    error:              "Each cart item must have a valid cart_item_uuid",
                });
            }
            if (item.margin_per === undefined || item.margin_per === null || isNaN(Number(item.margin_per))) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            "Validation failed",
                    error:              `margin_per is required for cart item ${item.cart_item_uuid}`,
                });
            }
        }

        // Duplicate cart_item_uuid check within the payload
        const cartUuidsRaw = cart_items.map((i) => i.cart_item_uuid.trim().toLowerCase());
        const uniqueRaw    = new Set(cartUuidsRaw);
        if (uniqueRaw.size !== cartUuidsRaw.length) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "cart_items contains duplicate cart_item_uuid values",
            });
        }

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid]
        );

        if (buyerCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active verified buyer found with the provided UUID",
            });
        }

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // --------------------------------------------------
        // 3. FETCH AND VALIDATE QUOTE — must be DRAFT + owned by buyer
        //    Also fetch quote_type_id so it can be propagated onto
        //    the cart rows being linked (same quote_type as the
        //    quote header itself).
        // --------------------------------------------------
        const quoteCheck = await pool.query(
            `SELECT
                bsq.buyer_quote_id,
                bsq.buyer_quote_uuid,
                bsq.quote_no,
                bsq.tax_code_id,
                bsq.quote_type_id,
                bsq.total_price,
                qs.name
             FROM public.buyer_saved_quote bsq
             JOIN public.quote_statuses qs
               ON qs.quote_status_id = bsq.status_of_quote
             WHERE bsq.buyer_quote_uuid = $1
               AND bsq.buyer_id         = $2
               AND bsq.is_deleted       = FALSE`,
            [buyer_quote_uuid, buyer_id]
        );

        if (quoteCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "Quote not found or does not belong to this buyer",
            });
        }

        const quoteRow = quoteCheck.rows[0];

        if (quoteRow.name.toUpperCase() !== "DRAFT") {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Items can only be added to a DRAFT quote. Current status: ${quoteRow.name}`,
            });
        }

        // --------------------------------------------------
        // 4. FETCH TAX RATE FROM QUOTE'S tax_code_id
        // --------------------------------------------------
        const taxCheck = await pool.query(
            `SELECT tax_rate
             FROM public.tax_code_master
             WHERE tax_code_id = $1
               AND is_active   = TRUE
               AND is_deleted  = FALSE`,
            [quoteRow.tax_code_id]
        );

        const tax_rate = taxCheck.rowCount > 0
            ? Number(taxCheck.rows[0].tax_rate)
            : 0;

        // --------------------------------------------------
        // 5. RESOLVE cart_item_status id needed (QTD)
        // --------------------------------------------------
        const quotedStatusResult = await pool.query(
            `SELECT cart_item_status_id
             FROM public.cart_item_status
             WHERE code = 'QTD' AND is_active = TRUE AND is_deleted = FALSE`
        );

        if (quotedStatusResult.rowCount === 0) {
            logger.error("add-quote-items: missing master data — cart_item_status(QTD)");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Configuration error",
                error:              "Required master data (cart item status) not found",
            });
        }

        const quoted_status_id = quotedStatusResult.rows[0].cart_item_status_id;

        // --------------------------------------------------
        // 6. FETCH AND VALIDATE CART ITEMS
        //    item_status → cart_item_status_id (FK); joined to
        //    get the readable code for the ineligibility check.
        //    CHANGE: warehouse_id / warehouse_type_id pulled in here
        //    too — needed to populate the same columns on
        //    buyer_quote_items (step 8a below).
        // --------------------------------------------------
        const cartUuids       = cart_items.map((i) => i.cart_item_uuid.trim());
        const uniqueCartUuids = [...new Set(cartUuids)];

        const cartCheck = await pool.query(
            `SELECT
                cd.cart_item_id,
                cd.cart_item_uuid,
                cd.product_id,
                cd.quantity,
                cd.unit_price,
                cd.uom_id,
                cd.warehouse_id,
                cd.warehouse_type_id,
                cis.code AS status_code
             FROM public.cart_details cd
             JOIN public.cart_item_status cis
               ON cis.cart_item_status_id = cd.cart_item_status_id
             WHERE cd.buyer_id       = $1
               AND cd.cart_item_uuid = ANY($2::uuid[])
               AND cd.is_deleted     = FALSE`,
            [buyer_id, uniqueCartUuids]
        );

        if (cartCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No valid cart items found for this buyer",
            });
        }

        const foundUuids   = cartCheck.rows.map((r) => r.cart_item_uuid);
        const missingUuids = uniqueCartUuids.filter((u) => !foundUuids.includes(u));
        if (missingUuids.length > 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              `Some cart items not found: ${missingUuids.join(", ")}`,
            });
        }

        const ineligible = cartCheck.rows.filter(
            (r) => r.status_code === "QTD"
        );
        if (ineligible.length > 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Some cart items are already quoted or checked out: ${ineligible.map((r) => r.cart_item_uuid).join(", ")}`,
            });
        }

        const cartRowMap = {};
        for (const row of cartCheck.rows) {
            cartRowMap[row.cart_item_uuid] = row;
        }

        // --------------------------------------------------
        // 7. CALCULATE NEW LINE ITEMS
        //    CHANGE: warehouse_id / warehouse_type_id carried onto
        //    each new line so they can be inserted into
        //    buyer_quote_items.
        // --------------------------------------------------
        let additionalTotal = 0;

        const newLineItems = cart_items.map((item) => {
            const cartRow           = cartRowMap[item.cart_item_uuid];
            const unit_price        = Number(cartRow.unit_price);
            const quantity          = Number(cartRow.quantity);
            const margin_per        = Number(item.margin_per);
            const price_with_margin = parseFloat(
                (unit_price + (unit_price * margin_per / 100)).toFixed(2)
            );
            const line_total = parseFloat((price_with_margin * quantity).toFixed(2));
            const tax_amount = parseFloat((line_total * tax_rate / 100).toFixed(2));

            additionalTotal += line_total + tax_amount;

            return {
                product_id:         cartRow.product_id,
                warehouse_id:       cartRow.warehouse_id,
                warehouse_type_id:  cartRow.warehouse_type_id,
                service_item:       "Product",
                quantity,
                uom_id:             cartRow.uom_id || null,
                price:              unit_price,
                margin_per,
                price_with_margin,
                tax_code_id:        quoteRow.tax_code_id,
                tax_amount,
                cart_item_id:       cartRow.cart_item_id,
            };
        });

        const new_total_price = parseFloat(
            (Number(quoteRow.total_price) + additionalTotal).toFixed(2)
        );

        // --------------------------------------------------
        // 8. TRANSACTION
        // --------------------------------------------------
        const now = new Date();

        await client.query("BEGIN");

        // --------------------------------------------------
        // 8a. INSERT new product line items AND, per-item, link
        //     the source cart_details row to this quote via
        //     quote_id / quote_item_id / quote_type_id — done in
        //     the same loop since each cart item maps to a distinct
        //     buyer_quote_item_id (can't be a bulk update).
        //     CHANGE: warehouse_id / warehouse_type_id now populated
        //     from the source cart row.
        // --------------------------------------------------
        for (const line of newLineItems) {
            const itemInsert = await client.query(
                `INSERT INTO public.buyer_quote_items (
                    buyer_quote_id,
                    product_id,
                    warehouse_id,
                    warehouse_type_id,
                    service_item,
                    quantity,
                    uom_id,
                    price,
                    margin_per,
                    price_with_margin,
                    tax_code_id,
                    tax_amount,
                    cart_item_id,
                    is_active,
                    created_at,
                    created_by,
                    assigned_to
                 ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE, $14, $15, $15
                 )
                 RETURNING buyer_quote_item_id`,
                [
                    quoteRow.buyer_quote_id,
                    line.product_id,
                    line.warehouse_id,
                    line.warehouse_type_id,
                    line.service_item,
                    line.quantity,
                    line.uom_id,
                    line.price,
                    line.margin_per,
                    line.price_with_margin,
                    line.tax_code_id,
                    line.tax_amount,
                    line.cart_item_id,
                    now,
                    modified_by,   // assigned_to = modified_by
                ]
            );

            const buyer_quote_item_id = itemInsert.rows[0].buyer_quote_item_id;

            // Link this cart item to the quote + mark QUOTED
            await client.query(
                `UPDATE public.cart_details SET
                    cart_item_status_id = $1,
                    quote_id             = $2,
                    quote_item_id        = $3,
                    quote_type_id        = $4,
                    modified_at          = $5,
                    modified_by          = $6
                 WHERE cart_item_id = $7
                   AND is_deleted   = FALSE`,
                [
                    quoted_status_id,
                    quoteRow.buyer_quote_id,
                    buyer_quote_item_id,
                    quoteRow.quote_type_id,
                    now,
                    modified_by,
                    line.cart_item_id,
                ]
            );
        }

        // --------------------------------------------------
        // 8b. RECALCULATE ALL HEADER AGGREGATES FROM DB
        //     (includes existing + newly inserted product items)
        //     Only product items (service_item = 'Product') counted
        //     — same convention as create-buyer-quote
        // --------------------------------------------------
        const aggResult = await client.query(
            `SELECT
                COALESCE(SUM(bqi.quantity), 0)                         AS total_quantity,
                COALESCE(SUM(bqi.price), 0)                            AS total_price_sum,
                COALESCE(AVG(bqi.margin_per), 0)                       AS avg_margin_per,
                COALESCE(SUM(bqi.price_with_margin * bqi.quantity), 0) AS total_price_with_margin
             FROM public.buyer_quote_items bqi
             WHERE bqi.buyer_quote_id = $1
               AND bqi.service_item   = 'Product'
               AND bqi.is_deleted     = FALSE
               AND bqi.is_active      = TRUE`,
            [quoteRow.buyer_quote_id]
        );

        const agg = aggResult.rows[0];

const reservation_expires_at = new Date(
    now.getTime() +
    commonenum.TIME_DURATION_MINUTES.QUOTE_RESERVATION_EXPIRY * 60 * 1000
);
        // --------------------------------------------------
        // 8c. UPDATE quote header — ALL 5 aggregate fields
        // --------------------------------------------------
     
         await client.query(
`UPDATE public.buyer_saved_quote SET 
    quantity              = $1,
    price                 = $2,
    margin_per             = $3,
    price_with_margin     = $4,
    total_price           = $5,
    reservation_expires_at = $6,
    modified_at           = $7,
    modified_by           = $8
WHERE buyer_quote_id = $9
  AND is_deleted = FALSE`,
[
    parseFloat(Number(agg.total_quantity).toFixed(2)),
    parseFloat(Number(agg.total_price_sum).toFixed(2)),
    parseFloat(Number(agg.avg_margin_per).toFixed(2)),
    parseFloat(Number(agg.total_price_with_margin).toFixed(2)),
    new_total_price,
    reservation_expires_at,
    now,
    modified_by,
    quoteRow.buyer_quote_id,
]
);

        await client.query("COMMIT");

        // --------------------------------------------------
        // 9. RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            `${newLineItems.length} item(s) added to quote successfully`,
            data: {
                buyer_quote_id:       quoteRow.buyer_quote_id,
                buyer_quote_uuid:     quoteRow.buyer_quote_uuid,
                quote_no:             quoteRow.quote_no,
                quote_type_id:        quoteRow.quote_type_id,
                new_total_price,
                total_quantity:       parseFloat(Number(agg.total_quantity).toFixed(2)),
                avg_margin_per:       parseFloat(Number(agg.avg_margin_per).toFixed(2)),
                price_with_margin:    parseFloat(Number(agg.total_price_with_margin).toFixed(2)),
                items_added:          newLineItems.length,
                modified_at:          now,
            },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (add-quote-items):", err);
        saveErrorLog({
            api_name:   "add-quote-items",
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
            message:            "Add quote items failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// UPDATE BUYER QUOTE
// --------------------------------------------------


responder.on("update-buyer-quote", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { buyer_quote_uuid } = req;
        const {
            buyer_uuid,
            customer_name,
            customer_email,
            customer_phone,
            customer_address,
            car_brand_uuid,
            car_model_uuid,
            tax_code_uuid,
            item_margins,        // [{ buyer_quote_item_uuid, margin_per }] — product line items only
            service_charges,     // [{ service_charge_uuid, charge_type, charge_value }] — optional, replaces existing charges
            modified_by,
        } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_quote_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "buyer quote uuid is required",
            });
        }

        if (!buyer_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "buyer uuid is required",
            });
        }

        if (!customer_name?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "customer name is required",
            });
        }

        if (!modified_by?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "modified by is required",
            });
        }

        if (item_margins !== undefined && !Array.isArray(item_margins)) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "item margins must be an array if provided",
            });
        }

        if (Array.isArray(item_margins)) {
            for (const im of item_margins) {
                if (!im.buyer_quote_item_uuid?.trim()) {
                    return cb(null, {
                        header_type:        "ERROR",
                        message_visibility: true,
                        status:             false,
                        code:               2001,
                        message:            "Validation failed",
                        error:              "Each item margins entry must have a valid buyer quote item uuid",
                    });
                }
                if (im.margin_per === undefined || im.margin_per === null || isNaN(Number(im.margin_per))) {
                    return cb(null, {
                        header_type:        "ERROR",
                        message_visibility: true,
                        status:             false,
                        code:               2001,
                        message:            "Validation failed",
                        error:              `margin percentage is required for item ${im.buyer_quote_item_uuid}`,
                    });
                }
            }

            const marginUuids = item_margins.map((im) => im.buyer_quote_item_uuid.trim().toLowerCase());
            const uniqueMarginUuids = new Set(marginUuids);
            if (uniqueMarginUuids.size !== marginUuids.length) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2001,
                    message:            "Validation failed",
                    error:              "item margins contains duplicate buyer quote item uuid values",
                });
            }
        }

        if (service_charges !== undefined && !Array.isArray(service_charges)) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "service_charges must be an array if provided",
            });
        }

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid]
        );

        if (buyerCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active verified buyer found with the provided UUID",
            });
        }

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // --------------------------------------------------
        // 3. FETCH AND VALIDATE QUOTE — must be DRAFT + owned by buyer
        // --------------------------------------------------
        const quoteCheck = await pool.query(
            `SELECT
                bsq.buyer_quote_id,
                bsq.buyer_quote_uuid,
                bsq.quote_no,
                bsq.tax_code_id,
                bsq.car_brand_id,
                bsq.car_model_id,
                qs.name
             FROM public.buyer_saved_quote bsq
             JOIN public.quote_statuses qs
               ON qs.quote_status_id = bsq.status_of_quote
             WHERE bsq.buyer_quote_uuid = $1
               AND bsq.buyer_id         = $2
               AND bsq.is_deleted       = FALSE`,
            [buyer_quote_uuid, buyer_id]
        );

        if (quoteCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "Quote not found or does not belong to this buyer",
            });
        }

        const quoteRow = quoteCheck.rows[0];

        if (quoteRow.name.toUpperCase() !== "DRAFT") {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Quote can only be updated while in DRAFT status. Current status: ${quoteRow.name}`,
            });
        }

        // --------------------------------------------------
        // 3a. CHECK EDIT LOCK
        // --------------------------------------------------
        const lockCheck = await pool.query(
            `SELECT 1 FROM record_locks
             WHERE table_name = 'buyer_saved_quote'
               AND record_id  = $1
               AND locked_by  = $2
               AND is_deleted = FALSE
               AND expires_at > NOW()`,
            [buyer_quote_uuid, modified_by]
        );

        if (lockCheck.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2005,
                message:            "Update failed",
                error:              "You must lock the record before updating",
            });
        }

        // --------------------------------------------------
        // 4. RESOLVE tax_code_id (optional — keep existing if not provided)
        // --------------------------------------------------
        let tax_code_id = quoteRow.tax_code_id;

        if (tax_code_uuid?.trim()) {
            const taxCheck = await pool.query(
                `SELECT tax_code_id
                 FROM public.tax_code_master
                 WHERE tax_code_uuid = $1
                   AND is_active     = TRUE
                   AND is_deleted    = FALSE`,
                [tax_code_uuid]
            );

            if (taxCheck.rowCount === 0) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "Invalid or inactive tax code provided",
                });
            }

            tax_code_id = taxCheck.rows[0].tax_code_id;
        }

        const taxRateCheck = await pool.query(
            `SELECT tax_rate
             FROM public.tax_code_master
             WHERE tax_code_id = $1
               AND is_active   = TRUE
               AND is_deleted  = FALSE`,
            [tax_code_id]
        );

        const tax_rate = taxRateCheck.rowCount > 0
            ? Number(taxRateCheck.rows[0].tax_rate)
            : 0;

        // --------------------------------------------------
        // 5. RESOLVE car_brand_id (optional — keep existing if not provided)
        // --------------------------------------------------
        let car_brand_id = quoteRow.car_brand_id;

        if (car_brand_uuid?.trim()) {
            const brandCheck = await pool.query(
                `SELECT brand_id
                 FROM public.brand
                 WHERE brand_uuid = $1
                   AND is_active  = TRUE
                   AND is_deleted = FALSE`,
                [car_brand_uuid]
            );

            if (brandCheck.rowCount === 0) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "Invalid or inactive car brand provided",
                });
            }

            car_brand_id = brandCheck.rows[0].brand_id;
        }

        // --------------------------------------------------
        // 6. RESOLVE car_model_id (optional — keep existing if not provided)
        // --------------------------------------------------
        let car_model_id = quoteRow.car_model_id;

        if (car_model_uuid?.trim()) {
            const modelCheck = await pool.query(
                `SELECT model_id
                 FROM public.model
                 WHERE model_uuid = $1
                   AND is_active  = TRUE
                   AND is_deleted = FALSE`,
                [car_model_uuid]
            );

            if (modelCheck.rowCount === 0) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "Invalid or inactive car model provided",
                });
            }

            car_model_id = modelCheck.rows[0].model_id;
        }

        // --------------------------------------------------
        // 7. FETCH EXISTING ACTIVE PRODUCT LINE ITEMS
        // --------------------------------------------------
        const existingItemsResult = await pool.query(
            `SELECT
                buyer_quote_item_id,
                buyer_quote_item_uuid,
                cart_item_id,
                product_id,
                service_item,
                quantity,
                uom_id,
                price,
                margin_per
             FROM public.buyer_quote_items
             WHERE buyer_quote_id = $1
               AND service_item   = 'Product'
               AND is_deleted     = FALSE
               AND is_active      = TRUE`,
            [quoteRow.buyer_quote_id]
        );

        if (existingItemsResult.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "Quote has no active product line items to update",
            });
        }

        const productItems = existingItemsResult.rows;

        const marginOverrideMap = {};
        if (Array.isArray(item_margins)) {
            for (const im of item_margins) {
                marginOverrideMap[im.buyer_quote_item_uuid.trim()] = Number(im.margin_per);
            }
        }

        const validUuids = new Set(productItems.map((r) => r.buyer_quote_item_uuid));
        const invalidMarginUuids = Object.keys(marginOverrideMap).filter((u) => !validUuids.has(u));
        if (invalidMarginUuids.length > 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              `Some buyer quote item uuid values do not belong to this quote: ${invalidMarginUuids.join(", ")}`,
            });
        }

        // --------------------------------------------------
        // 8. RECALCULATE PRODUCT LINE ITEMS
        // --------------------------------------------------
        let subtotal  = 0;
        let total_tax = 0;

        const recalculatedProductItems = productItems.map((row) => {
            const unit_price = Number(row.price);
            const quantity   = Number(row.quantity);
            const margin_per = marginOverrideMap.hasOwnProperty(row.buyer_quote_item_uuid)
                ? marginOverrideMap[row.buyer_quote_item_uuid]
                : Number(row.margin_per) || 0;

            const price_with_margin = parseFloat(
                (unit_price + (unit_price * margin_per / 100)).toFixed(2)
            );
            const line_total = parseFloat((price_with_margin * quantity).toFixed(2));
            const tax_amount = parseFloat((line_total * tax_rate / 100).toFixed(2));

            subtotal  += line_total;
            total_tax += tax_amount;

            return {
                buyer_quote_item_id: row.buyer_quote_item_id,
                margin_per,
                price_with_margin,
                tax_amount,
                quantity,
            };
        });

        // --------------------------------------------------
        // 9. RESOLVE + COMPUTE SERVICE CHARGES (non-taxable)
        // --------------------------------------------------
        let chargeLineItems      = [];
        let total_charges_amount = 0;

        try {
            const chargeResult = await resolveServiceCharges(pool, service_charges, subtotal);
            chargeLineItems      = chargeResult.chargeLineItems;
            total_charges_amount = chargeResult.total_charges_amount;
        } catch (e) {
            if (e.validationError) return cb(null, e.validationError);
            throw e;
        }

        const total_price = parseFloat((subtotal + total_tax + total_charges_amount).toFixed(2));

        // --------------------------------------------------
        // 10. HEADER-LEVEL AGGREGATES (product items only)
        // --------------------------------------------------
        const total_quantity  = recalculatedProductItems.reduce((s, i) => s + i.quantity, 0);
        const total_price_sum = parseFloat(
            productItems.reduce((s, r) => s + Number(r.price), 0).toFixed(2)
        );
        const avg_margin_per = recalculatedProductItems.length > 0
            ? parseFloat(
                (recalculatedProductItems.reduce((s, i) => s + i.margin_per, 0) / recalculatedProductItems.length).toFixed(2)
              )
            : 0;
        const total_price_with_margin = parseFloat(
            recalculatedProductItems.reduce((s, i) => s + (i.price_with_margin * i.quantity), 0).toFixed(2)
        );

        // --------------------------------------------------
        // 11. TRANSACTION
        // --------------------------------------------------
        

        await client.query("BEGIN");
const now = new Date();
        const reservation_expires_at = new Date(
    now.getTime() +
    commonenum.TIME_DURATION_MINUTES.QUOTE_RESERVATION_EXPIRY * 60 * 1000
);
        // 11a. UPDATE quote header
        await client.query(
            `UPDATE public.buyer_saved_quote SET
                tax_code_id        = $1,
                quantity           = $2,
                price               = $3,
                margin_per          = $4,
                price_with_margin   = $5,
                total_price         = $6,
                customer_name       = $7,
                customer_email      = $8,
                customer_phone      = $9,
                customer_address    = $10,
                car_brand_id        = $11,
                car_model_id        = $12,
		reservation_expires_at = $13,
		modified_at            = $14, 
    modified_by            = $15
WHERE buyer_quote_id = $16
               AND is_deleted     = FALSE`,
            [
                tax_code_id,
                total_quantity,
                total_price_sum,
                avg_margin_per,
                total_price_with_margin,
                total_price,
                customer_name.trim(),
                customer_email?.trim()   || null,
                customer_phone?.trim()   || null,
                customer_address?.trim() || null,
                car_brand_id,
                car_model_id,
 reservation_expires_at,
                now,
                modified_by,
                quoteRow.buyer_quote_id,
            ]
        );

        // 11b. UPDATE each existing product line item (margin/price/tax recalculated)
        for (const item of recalculatedProductItems) {
            await client.query(
                `UPDATE public.buyer_quote_items SET
                    margin_per          = $1,
                    price_with_margin   = $2,
                    tax_code_id         = $3,
                    tax_amount          = $4,
                    modified_at         = $5,
                    modified_by         = $6
                 WHERE buyer_quote_item_id = $7
                   AND is_deleted          = FALSE`,
                [
                    item.margin_per,
                    item.price_with_margin,
                    tax_code_id,
                    item.tax_amount,
                    now,
                    modified_by,
                    item.buyer_quote_item_id,
                ]
            );
        }

        // 11c. SOFT-DELETE existing active service charges for this quote
        await client.query(
            `UPDATE public.buyer_quote_service_charges SET
                is_active   = FALSE,
                is_deleted  = TRUE,
                deleted_at  = $1,
                deleted_by  = $2
             WHERE buyer_quote_id = $3
               AND is_deleted     = FALSE`,
            [now, modified_by, quoteRow.buyer_quote_id]
        );

        // 11d. INSERT new service charges
        for (const charge of chargeLineItems) {
            await client.query(
                `INSERT INTO public.buyer_quote_service_charges (
                    buyer_quote_id,
                    service_charge_id,
                    charge_type,
                    charge_value,
                    charge_amount,
                    is_active,
                    created_at,
                    created_by,
                    assigned_to
                 ) VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $7)`,
                [
                    quoteRow.buyer_quote_id,
                    charge.service_charge_id,
                    charge.charge_type,
                    charge.charge_value,
                    charge.charge_amount,
                    now,
                    modified_by,
                ]
            );
        }

        // 11e. AUTO-UNLOCK AFTER SUCCESS
        await client.query(
            `UPDATE record_locks
             SET    is_deleted = TRUE,
                    deleted_by = $1,
                    deleted_at = NOW()
             WHERE  table_name = 'buyer_saved_quote'
               AND  record_id  = $2
               AND  locked_by  = $3
               AND  is_deleted = FALSE`,
            [modified_by, buyer_quote_uuid, modified_by]
        );

        await client.query("COMMIT");

        // --------------------------------------------------
        // 12. RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Quote updated successfully",
            data: {
                buyer_quote_id:   quoteRow.buyer_quote_id,
                buyer_quote_uuid: quoteRow.buyer_quote_uuid,
                quote_no:         quoteRow.quote_no,
                total_price,
                subtotal:         parseFloat(subtotal.toFixed(2)),
                total_tax:        parseFloat(total_tax.toFixed(2)),
                charges_total:    total_charges_amount,
                product_items:    recalculatedProductItems.length,
                charge_items:     chargeLineItems.length,
                modified_at:      now,
            },
        });

    } catch (err) {
        await client.query("ROLLBACK");
        logger.error("Responder Error (update-buyer-quote):", err);
        saveErrorLog({
            api_name:   "update-buyer-quote",
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
            message:            "Update quote failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});


// --------------------------------------------------
// GET BUYER QUOTES
// --------------------------------------------------


responder.on("get-buyer-quotes", async (req, cb) => {
    const client = await pool.connect();

    try {
        const {
            buyer_uuid,
            status_uuid,
            from_date,
            to_date,
            quote_no,
            quote_type_uuid,
            car_brand_uuid,
            car_model_uuid,
            min_price,
            max_price,
            sort_by  = "created_at",
            sort_dir = "DESC",
            Page     = 1,
            PageSize = 10,
        } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Buyer UUID is required",
            });

        if (from_date && isNaN(Date.parse(from_date)))
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "from_date is not a valid date",
            });

        if (to_date && isNaN(Date.parse(to_date)))
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "to_date is not a valid date",
            });

        if (min_price !== undefined && min_price !== null && isNaN(Number(min_price)))
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "min_price must be a valid number",
            });

        if (max_price !== undefined && max_price !== null && isNaN(Number(max_price)))
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "max_price must be a valid number",
            });

        const ALLOWED_SORT_COLUMNS = {
            created_at:  "BSQ.created_at",
            total_price: "BSQ.total_price",
            modified_at: "BSQ.modified_at",
        };

        const sortColumn = ALLOWED_SORT_COLUMNS[sort_by] || ALLOWED_SORT_COLUMNS.created_at;
        const sortDir     = String(sort_dir).toUpperCase() === "ASC" ? "ASC" : "DESC";

        const page     = Math.max(Number(Page) || 1, 1);
        const pageSize = Math.min(Math.max(Number(PageSize) || 10, 1), 100);
        const offset   = (page - 1) * pageSize;

        // --------------------------------------------------
        // 2. RESOLVE buyer_uuid → buyer_id
        // --------------------------------------------------
        const buyerResult = await client.query({
            text: `SELECT buyer_id
                   FROM public.buyer_accounts
                   WHERE buyer_uuid = $1
                     AND is_deleted  = FALSE
                     AND is_active   = TRUE`,
            values: [buyer_uuid.trim()],
        });

        if (buyerResult.rowCount === 0)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active buyer found with the provided UUID",
            });

        const { buyer_id } = buyerResult.rows[0];

        // --------------------------------------------------
        // 3. RESOLVE status_uuid → status_of_quote (optional filter)
        // --------------------------------------------------
        let status_id = null;

        if (status_uuid?.trim()) {
            const statusResult = await client.query({
                text: `SELECT quote_status_id
                       FROM public.quote_statuses
                       WHERE quote_status_uuid = $1
                         AND is_active          = TRUE
                         AND is_deleted         = FALSE`,
                values: [status_uuid.trim()],
            });

            if (statusResult.rowCount === 0)
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "Invalid or inactive quote status provided",
                });

            status_id = statusResult.rows[0].quote_status_id;
        }

        // --------------------------------------------------
        // 3a. RESOLVE quote_type_uuid → quote_type_id (optional filter)
        // --------------------------------------------------
        let quote_type_id = null;

        if (quote_type_uuid?.trim()) {
            const quoteTypeResult = await client.query({
                text: `SELECT quote_type_id
                       FROM public.quote_type
                       WHERE quote_type_uuid = $1
                         AND is_active        = TRUE
                         AND is_deleted       = FALSE`,
                values: [quote_type_uuid.trim()],
            });

            if (quoteTypeResult.rowCount === 0)
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "Invalid or inactive quote type provided",
                });

            quote_type_id = quoteTypeResult.rows[0].quote_type_id;
        }

        // --------------------------------------------------
        // 3b. RESOLVE car_brand_uuid → brand_id (optional filter)
        // --------------------------------------------------
        let car_brand_id = null;

        if (car_brand_uuid?.trim()) {
            const brandResult = await client.query({
                text: `SELECT brand_id
                       FROM public.brand
                       WHERE brand_uuid = $1
                         AND is_active  = TRUE
                         AND is_deleted = FALSE`,
                values: [car_brand_uuid.trim()],
            });

            if (brandResult.rowCount === 0)
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "Invalid or inactive car brand provided",
                });

            car_brand_id = brandResult.rows[0].brand_id;
        }

        // --------------------------------------------------
        // 3c. RESOLVE car_model_uuid → model_id (optional filter)
        // --------------------------------------------------
        let car_model_id = null;

        if (car_model_uuid?.trim()) {
            const modelResult = await client.query({
                text: `SELECT model_id
                       FROM public.model
                       WHERE model_uuid = $1
                         AND is_active  = TRUE
                         AND is_deleted = FALSE`,
                values: [car_model_uuid.trim()],
            });

            if (modelResult.rowCount === 0)
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "Invalid or inactive car model provided",
                });

            car_model_id = modelResult.rows[0].model_id;
        }

        // --------------------------------------------------
        // 4. BUILD DYNAMIC WHERE CLAUSE
        // --------------------------------------------------
        const conditions = [
            `BSQ.buyer_id   = $1`,
            `BSQ.is_deleted = FALSE`,
        ];
        const values = [buyer_id];

        if (status_id !== null) {
            values.push(status_id);
            conditions.push(`BSQ.status_of_quote = $${values.length}`);
        }

        if (from_date) {
            values.push(from_date);
            conditions.push(`BSQ.created_at >= $${values.length}::date`);
        }

        if (to_date) {
            values.push(to_date);
            conditions.push(`BSQ.created_at < ($${values.length}::date + INTERVAL '1 day')`);
        }

        if (quote_no?.trim()) {
            values.push(`%${quote_no.trim()}%`);
            conditions.push(`BSQ.quote_no ILIKE $${values.length}`);
        }

        if (quote_type_id !== null) {
            values.push(quote_type_id);
            conditions.push(`BSQ.quote_type_id = $${values.length}`);
        }

        if (car_brand_id !== null) {
            values.push(car_brand_id);
            conditions.push(`BSQ.car_brand_id = $${values.length}`);
        }

        if (car_model_id !== null) {
            values.push(car_model_id);
            conditions.push(`BSQ.car_model_id = $${values.length}`);
        }

        if (min_price !== undefined && min_price !== null && min_price !== "") {
            values.push(Number(min_price));
            conditions.push(`BSQ.total_price >= $${values.length}`);
        }

        if (max_price !== undefined && max_price !== null && max_price !== "") {
            values.push(Number(max_price));
            conditions.push(`BSQ.total_price <= $${values.length}`);
        }

        const whereClause = conditions.join(" AND ");

        // --------------------------------------------------
        // 5. COUNT (for pagination)
        // --------------------------------------------------
        const countResult = await client.query({
            text: `SELECT COUNT(*) AS total
                   FROM public.buyer_saved_quote BSQ
                   WHERE ${whereClause}`,
            values,
        });

        const total      = Number(countResult.rows[0].total);
        const totalPages = Math.ceil(total / pageSize);

        // --------------------------------------------------
        // 6. FETCH QUOTES (paginated)
        //    CHANGE: BSQ.reservation_expires_at added — see
        //    getById-buyer-quote.js for the same reasoning.
        // --------------------------------------------------
        const limitIdx  = values.length + 1;
        const offsetIdx = values.length + 2;

        const itemsResult = await client.query({
            text: `
                SELECT
                    BSQ.buyer_quote_id,
                    BSQ.buyer_quote_uuid,
                    BSQ.quote_no,
                    BSQ.created_at,
                    BSQ.reservation_expires_at,

                    QT.quote_type_uuid,
                    QT.code                         AS quote_type_code,
                    QT.name                         AS quote_type_name,

                    QS.quote_status_uuid,
                    QS.name                         AS status_name,

                    BSQ.customer_name,
                    BSQ.customer_email,
                    BSQ.customer_phone,
                    BSQ.customer_address,

                    BR.brand_uuid                   AS car_brand_uuid,
                    BR.name                         AS car_brand_name,
                    MD.model_uuid                   AS car_model_uuid,
                    MD.name                         AS car_model_name,

                    TCM.code                        AS tax_code_code,
                    TCM.name                        AS tax_code_name,
                    TCM.tax_rate,

                    BSQ.quantity AS sum_of_all_product_quantity,
                    BSQ.price  AS sum_of_unitprice_of_all_product_items,
                    BSQ.margin_per AS avg_margin_percentage,
                    BSQ.price_with_margin AS product_subtotal_before_tax,
                    BSQ.total_price AS final_amount,

                    BSQ.modified_at

                FROM public.buyer_saved_quote BSQ

                JOIN public.quote_statuses QS
                    ON QS.quote_status_id = BSQ.status_of_quote

                LEFT JOIN public.quote_type QT
                    ON QT.quote_type_id = BSQ.quote_type_id
                   AND QT.is_deleted    = FALSE

                LEFT JOIN public.brand BR
                    ON BR.brand_id   = BSQ.car_brand_id
                   AND BR.is_deleted = FALSE

                LEFT JOIN public.model MD
                    ON MD.model_id   = BSQ.car_model_id
                   AND MD.is_deleted = FALSE

                LEFT JOIN public.tax_code_master TCM
                    ON TCM.tax_code_id = BSQ.tax_code_id
                   AND TCM.is_deleted  = FALSE
                   AND TCM.is_active   = TRUE

                WHERE ${whereClause}

                ORDER BY ${sortColumn} ${sortDir}

                LIMIT  $${limitIdx}
                OFFSET $${offsetIdx}
            `,
            values: [...values, pageSize, offset],
        });

        const quotes = itemsResult.rows;

        // --------------------------------------------------
        // 7. FETCH PRODUCT LINE ITEMS + SERVICE CHARGES FOR THE QUOTES ON THIS PAGE
        //    CHANGE: warehouse resolved DIRECTLY from BQI.warehouse_id
        //    / BQI.warehouse_type_id instead of via cart_details — see
        //    getById-buyer-quote.js for the same reasoning.
        // --------------------------------------------------
        const quoteIds = quotes.map((q) => q.buyer_quote_id);

        let lineItemsByQuoteId = {};
        let chargesByQuoteId   = {};

        if (quoteIds.length > 0) {
            const lineItemsResult = await client.query({
                text: `
                    SELECT
                        BQI.buyer_quote_id,
                        BQI.buyer_quote_item_id,
                        BQI.buyer_quote_item_uuid,
                        BQI.cart_item_id,
                        BQI.product_id,
                        BQI.service_item,
                        BQI.quantity,
                        BQI.uom_id,
                        BQI.price,
                        BQI.margin_per,
                        BQI.price_with_margin,
                        BQI.tax_code_id,
                        BQI.tax_amount,
                        BQI.is_active,
                        BQI.assigned_to,
                        BQI.assigned_at,
                        BQI.created_at,
                        BQI.created_by,
                        BQI.modified_at,
                        BQI.modified_by,

                        P.product_uuid,
                        P.name              AS product_name,
                        P.oem_part_number   AS part_number,

                        U.code               AS uom_code,
                        U.name               AS uom_name,

                        TCM.code             AS tax_code_code,
                        TCM.name             AS tax_code_name,
                        TCM.tax_rate,

                        SW.warehouse_uuid,
                        SW.warehouse_name,
                        WT.code              AS warehouse_type_code,
                        WT.name              AS warehouse_type_name

                    FROM public.buyer_quote_items BQI

                    LEFT JOIN public.products P
                        ON P.product_id = BQI.product_id
                       AND P.is_deleted = FALSE

                    LEFT JOIN public.uom U
                        ON U.uom_id     = BQI.uom_id
                       AND U.is_deleted = FALSE

                    LEFT JOIN public.tax_code_master TCM
                        ON TCM.tax_code_id = BQI.tax_code_id
                       AND TCM.is_deleted  = FALSE

                    LEFT JOIN public.seller_warehouse SW
                        ON SW.warehouse_id = BQI.warehouse_id
                       AND SW.is_deleted   = FALSE

                    LEFT JOIN public.warehouse_type WT
                        ON WT.warehouse_type_id = BQI.warehouse_type_id
                       AND WT.is_deleted        = FALSE

                    WHERE BQI.buyer_quote_id = ANY($1::int[])
                      AND BQI.service_item   = 'Product'
                      AND BQI.is_deleted      = FALSE
                      AND BQI.is_active       = TRUE

                    ORDER BY BQI.created_at ASC
                `,
                values: [quoteIds],
            });

            for (const row of lineItemsResult.rows) {
                if (!lineItemsByQuoteId[row.buyer_quote_id]) {
                    lineItemsByQuoteId[row.buyer_quote_id] = [];
                }
                lineItemsByQuoteId[row.buyer_quote_id].push(row);
            }

            const chargesResult = await client.query({
                text: `
                    SELECT
                        BQSC.buyer_quote_id,
                        BQSC.buyer_quote_service_charge_id,
                        BQSC.buyer_quote_service_charge_uuid,
                        BQSC.charge_type,
                        BQSC.charge_value,
                        BQSC.charge_amount,
                        BQSC.created_at,
                        BQSC.created_by,
                        BQSC.modified_at,
                        BQSC.modified_by,

                        SC.service_charge_uuid,
                        SC.code   AS service_charge_code,
                        SC.name   AS service_charge_name

                    FROM public.buyer_quote_service_charges BQSC

                    JOIN public.service_charge SC
                        ON SC.service_charge_id = BQSC.service_charge_id

                    WHERE BQSC.buyer_quote_id = ANY($1::int[])
                      AND BQSC.is_deleted      = FALSE
                      AND BQSC.is_active       = TRUE

                    ORDER BY BQSC.created_at ASC
                `,
                values: [quoteIds],
            });

            for (const row of chargesResult.rows) {
                if (!chargesByQuoteId[row.buyer_quote_id]) {
                    chargesByQuoteId[row.buyer_quote_id] = [];
                }
                chargesByQuoteId[row.buyer_quote_id].push(row);
            }
        }

        // Attach product_items / charge_items to each quote in the response
        for (const quote of quotes) {
            quote.product_items = lineItemsByQuoteId[quote.buyer_quote_id] || [];
            quote.charge_items  = chargesByQuoteId[quote.buyer_quote_id] || [];

            // Charges are non-taxable — plain sum of charge_amount
            quote.additional_charges_total = parseFloat(
                quote.charge_items
                    .reduce((sum, r) => sum + Number(r.charge_amount), 0)
                    .toFixed(2)
            );
        }

        // --------------------------------------------------
        // 8. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Quotes fetched successfully",
            error:              null,
            result: {
                page,
                pageSize,
                totalRecords: total,
                totalPages,
                data: quotes,
            },
        });

    } catch (err) {
        logger.error("Responder Error (get-buyer-quotes):", err);
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
// GET BUYER QUOTE BY UUID (WITH EDIT LOCKING)
// --------------------------------------------------


responder.on('getById-buyer-quote', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { buyer_quote_uuid } = req;
        const mode    = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;

        if (!buyer_quote_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Buyer quote UUID is required"
            });
        }

        // ----------------------------------------
        // FETCH QUOTE HEADER WITH ALL RELATED DATA
        //    CHANGE: bsq.reservation_expires_at added — meaningful
        //    for listing-origin quotes (whose items have no
        //    cart_details row to carry a per-item expiry); NULL for
        //    cart-origin quotes, which rely on each item's own
        //    cart_details.reservation_expires_at instead.
        // ----------------------------------------
        const result = await client.query(
            `SELECT
                bsq.buyer_quote_id,
                bsq.buyer_quote_uuid,
                bsq.quote_no,
                bsq.quote_source_id,
                bsq.quantity AS sum_of_all_product_quantity,
                bsq.price AS sum_of_unitprice_of_all_product_items,
                bsq.margin_per AS avg_margin_percentage,
                bsq.price_with_margin AS product_subtotal_before_tax,
                bsq.total_price AS final_amount,
                bsq.customer_name,
                bsq.customer_email,
                bsq.customer_phone,
                bsq.customer_address,
                bsq.is_active,
                bsq.assigned_to,
                bsq.assigned_at,
                bsq.reservation_expires_at,
                bsq.created_at,
                bsq.created_by,
                bsq.modified_at,
                bsq.modified_by,

                qt.quote_type_id,
                qt.quote_type_uuid,
                qt.code                 AS quote_type_code,
                qt.name                 AS quote_type_name,

                qs.quote_status_id,
                qs.name                 AS status_name,

                tcm.tax_code_id,
                tcm.code                AS tax_code_code,
                tcm.name                AS tax_code_name,
                tcm.tax_rate,

                br.brand_id,
                br.name                 AS car_brand_name,
                md.model_id,
                md.name                 AS car_model_name,

                creators.username       AS created_by_name,
                updaters.username       AS modified_by_name,
                assignees.username      AS assigned_to_name

            FROM public.buyer_saved_quote bsq

            JOIN public.quote_statuses qs
                ON qs.quote_status_id = bsq.status_of_quote

            LEFT JOIN public.quote_type qt
                ON qt.quote_type_id = bsq.quote_type_id
               AND qt.is_deleted    = FALSE

            LEFT JOIN public.tax_code_master tcm
                ON tcm.tax_code_id = bsq.tax_code_id
               AND tcm.is_deleted  = FALSE

            LEFT JOIN public.brand br
                ON br.brand_id   = bsq.car_brand_id
               AND br.is_deleted = FALSE

            LEFT JOIN public.model md
                ON md.model_id   = bsq.car_model_id
               AND md.is_deleted = FALSE

            LEFT JOIN public.users creators
                ON bsq.created_by  = creators.user_uuid

            LEFT JOIN public.users updaters
                ON bsq.modified_by = updaters.user_uuid

            LEFT JOIN public.users assignees
                ON bsq.assigned_to = assignees.user_uuid

            WHERE bsq.buyer_quote_uuid = $1
              AND bsq.is_deleted       = FALSE`,
            [buyer_quote_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Quote not found"
            });
        }

        const quote = result.rows[0];

        // ----------------------------------------
        // FETCH PRODUCT LINE ITEMS (buyer_quote_items — Product only)
        //    CHANGE: warehouse resolved DIRECTLY from
        //    bqi.warehouse_id / bqi.warehouse_type_id instead of via
        //    cart_details — works for BOTH cart-origin items (which
        //    also have a cart_details row, still LEFT JOINed here for
        //    discount_amount / buyer_note) AND listing-origin items
        //    (cart_item_id IS NULL pre-accept, so the old cd-based
        //    warehouse join returned nothing for them).
        // ----------------------------------------
        const itemsResult = await client.query(
            `SELECT
                bqi.buyer_quote_item_id,
                bqi.buyer_quote_item_uuid,
                bqi.cart_item_id,
                bqi.product_id,
                bqi.service_item,
                bqi.quantity,
                bqi.uom_id,
                bqi.price,
                bqi.margin_per,
                bqi.price_with_margin,
                bqi.tax_amount,
                bqi.created_at,

                p.product_uuid,
                p.name              AS product_name,
                p.oem_part_number   AS part_number,

                u.code               AS uom_code,
                u.name               AS uom_name,

                cd.discount_amount,
                cd.buyer_note,

                sw.warehouse_uuid,
                sw.warehouse_name,

                wt.warehouse_type_id,
                wt.code              AS warehouse_type_code,
                wt.name              AS warehouse_type_name

             FROM public.buyer_quote_items bqi

             LEFT JOIN public.products p
                ON p.product_id = bqi.product_id
               AND p.is_deleted = FALSE

             LEFT JOIN public.uom u
                ON u.uom_id     = bqi.uom_id
               AND u.is_deleted = FALSE

             LEFT JOIN public.cart_details cd
                ON cd.cart_item_id = bqi.cart_item_id
               AND cd.is_deleted   = FALSE

             LEFT JOIN public.seller_warehouse sw
                ON sw.warehouse_id = bqi.warehouse_id
               AND sw.is_deleted   = FALSE

             LEFT JOIN public.warehouse_type wt
                ON wt.warehouse_type_id = bqi.warehouse_type_id
               AND wt.is_deleted        = FALSE
               AND wt.is_active         = TRUE

             WHERE bqi.buyer_quote_id = $1
               AND bqi.service_item   = 'Product'
               AND bqi.is_deleted     = FALSE
               AND bqi.is_active      = TRUE

             ORDER BY bqi.created_at ASC`,
            [quote.buyer_quote_id]
        );

        quote.product_items = itemsResult.rows;

        // ----------------------------------------
        // FETCH SERVICE CHARGES (buyer_quote_service_charges)
        // ----------------------------------------
        const chargesResult = await client.query(
            `SELECT
                bqsc.buyer_quote_service_charge_id,
                bqsc.buyer_quote_service_charge_uuid,
                bqsc.charge_type,
                bqsc.charge_value,
                bqsc.charge_amount,
                bqsc.created_at,
                bqsc.created_by,
                bqsc.modified_at,
                bqsc.modified_by,

                sc.service_charge_uuid,
                sc.code AS service_charge_code,
                sc.name AS service_charge_name

             FROM public.buyer_quote_service_charges bqsc

             JOIN public.service_charge sc
                ON sc.service_charge_id = bqsc.service_charge_id

             WHERE bqsc.buyer_quote_id = $1
               AND bqsc.is_deleted     = FALSE
               AND bqsc.is_active      = TRUE

             ORDER BY bqsc.created_at ASC`,
            [quote.buyer_quote_id]
        );

        quote.charge_items = chargesResult.rows;

        // Charges are non-taxable — plain sum of charge_amount
        quote.additional_charges_total = parseFloat(
            quote.charge_items
                .reduce((sum, r) => sum + Number(r.charge_amount), 0)
                .toFixed(2)
        );

        // Total discount across product line items — sourced from
        // cart_details.discount_amount via the join above. Will be 0
        // for listing-origin items that haven't been accepted yet
        // (no cart_details row exists for them).
        quote.total_discount = parseFloat(
            quote.product_items
                .reduce((sum, r) => sum + (Number(r.discount_amount) || 0), 0)
                .toFixed(2)
        );

        // ----------------------------------------
        // LOCK HANDLING (edit mode only)
        // ----------------------------------------
        let lockRow = null;

        if (mode === 'edit') {

            if (!user_id) {
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "User ID required for edit mode"
                });
            }

            await client.query('BEGIN');

            try {
                const lockRes = await client.query(
                    `SELECT RL.*, U.username AS locked_by_name
                     FROM record_locks RL
                     LEFT JOIN users U ON U.user_uuid = RL.locked_by
                     WHERE RL.table_name = 'buyer_saved_quote'
                       AND RL.record_id  = $1
                       AND RL.is_deleted = FALSE`,
                    [buyer_quote_uuid]
                );

                lockRow = lockRes.rows[0] || null;

                const isExpired =
                    lockRow &&
                    new Date(lockRow.expires_at).getTime() < Date.now();

                if (lockRow && lockRow.locked_by !== user_id && !isExpired) {
                    await client.query('ROLLBACK');
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2005,
                        message: `Record is locked by ${lockRow.locked_by_name}`
                    });
                }

                if (lockRow && isExpired) {
                    await client.query(
                        `UPDATE record_locks
                         SET    is_deleted = TRUE,
                                deleted_by = $1,
                                deleted_at = NOW()
                         WHERE  lock_id    = $2`,
                        [user_id, lockRow.lock_id]
                    );
                    lockRow = null;
                }

                if (!lockRow) {

                    const newLock = await client.query(
                        `INSERT INTO record_locks
                             (table_name, record_id, locked_by, expires_at, created_by)
                         VALUES
                             ('buyer_saved_quote', $1, $2, NOW() + ($3 || ' minute')::INTERVAL, $2)
                         RETURNING *`,
                        [buyer_quote_uuid, user_id, LOCK_MINUTES]
                    );

                    lockRow = newLock.rows[0];
                }
                else if (lockRow.locked_by === user_id) {

                    const refresh = await client.query(
                        `UPDATE record_locks
                         SET    expires_at = NOW() + ($2 || ' minute')::INTERVAL
                         WHERE  lock_id    = $1
                         RETURNING *`,
                        [lockRow.lock_id, LOCK_MINUTES]
                    );
                    lockRow = refresh.rows[0];
                }

                await client.query('COMMIT');

            } catch (lockErr) {
                await client.query('ROLLBACK');
                logger.error(`[getById-buyer-quote] Lock transaction failed:`, lockErr);
                lockRow = null;
            }
        }

        // ----------------------------------------
        // LOCK STATUS
        // ----------------------------------------
        quote.lock_status =
            lockRow
                ? new Date(lockRow.expires_at).getTime() >= Date.now()
                : false;

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Quote fetched successfully",
            data: quote,
            lock: lockRow
                ? {
                    status    : quote.lock_status,
                    by        : lockRow.locked_by,
                    by_name   : lockRow.locked_by_name,
                    expires_at: lockRow.expires_at
                }
                : { status: false }
        });

    } catch (err) {
        logger.error("Responder Error (getById-buyer-quote):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Fetch failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// DELETE BUYER QUOTE
// --------------------------------------------------



responder.on('delete-buyer-quote', async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { buyer_quote_uuid } = req;
        const { buyer_uuid, deleted_by } = req.body;

        // ----------------------------------------
        // 1. VALIDATION
        // ----------------------------------------
        if (!buyer_quote_uuid) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Buyer quote UUID is required"
            });
        }

        if (!buyer_uuid?.trim()) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Buyer UUID is required"
            });
        }

        if (!deleted_by?.trim()) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Deleted by is required"
            });
        }

        // ----------------------------------------
        // 2. RESOLVE buyer_id
        // ----------------------------------------
        const buyerCheck = await client.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active verified buyer found with the provided UUID"
            });
        }

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // ----------------------------------------
        // 3. FETCH QUOTE — must exist + owned by this buyer
        // ----------------------------------------
        const quoteCheck = await client.query(
            `SELECT
                bsq.buyer_quote_id,
                bsq.buyer_quote_uuid,
                bsq.quote_no,
                qs.name AS status_name
             FROM public.buyer_saved_quote bsq
             JOIN public.quote_statuses qs
               ON qs.quote_status_id = bsq.status_of_quote
             WHERE bsq.buyer_quote_uuid = $1
               AND bsq.buyer_id         = $2
               AND bsq.is_deleted       = FALSE`,
            [buyer_quote_uuid, buyer_id]
        );

        if (quoteCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "Quote not found or does not belong to this buyer"
            });
        }

        const quoteRow    = quoteCheck.rows[0];
        const statusName  = quoteRow.status_name.toUpperCase();

        // ----------------------------------------
        // 4. BLOCK DELETE — only DRAFT quotes can be deleted
        // ----------------------------------------
        const EDITABLE_STATUSES = ['DRAFT'];

        if (!EDITABLE_STATUSES.includes(statusName)) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Quote cannot be deleted in its current status: ${quoteRow.status_name}. Only DRAFT quotes can be deleted`
            });
        }

        // ----------------------------------------
        // 5. RESOLVE PENDING cart_item_status id
        // ----------------------------------------
        const pendingStatusResult = await client.query(
            `SELECT cart_item_status_id
             FROM public.cart_item_status
             WHERE code = 'PND' AND is_active = TRUE AND is_deleted = FALSE`
        );

        if (pendingStatusResult.rowCount === 0) {
            await client.query('ROLLBACK');
            logger.error("delete-buyer-quote: missing master data — cart_item_status(PND)");
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Configuration error",
                error:              "Required master data (cart item status) not found"
            });
        }

        const pending_status_id = pendingStatusResult.rows[0].cart_item_status_id;

        // ----------------------------------------
        // 6. FETCH ALL ACTIVE LINE ITEMS
        //    (needed to restore cart item statuses)
        // ----------------------------------------
        const lineItemsResult = await client.query(
            `SELECT buyer_quote_item_id, cart_item_id
             FROM public.buyer_quote_items
             WHERE buyer_quote_id = $1
               AND is_deleted     = FALSE`,
            [quoteRow.buyer_quote_id]
        );

        const cartItemIds = lineItemsResult.rows
            .map((r) => r.cart_item_id)
            .filter((id) => id !== null);

        // ----------------------------------------
        // 7. SOFT DELETE — all product line items
        // ----------------------------------------
        await client.query(
            `UPDATE public.buyer_quote_items SET
                is_active   = FALSE,
                is_deleted  = TRUE,
                deleted_at  = NOW(),
                deleted_by  = $1,
                modified_at = NOW(),
                modified_by = $1
             WHERE buyer_quote_id = $2
               AND is_deleted     = FALSE`,
            [deleted_by, quoteRow.buyer_quote_id]
        );

        // ----------------------------------------
        // 7a. SOFT DELETE — service charges
        // ----------------------------------------
        await client.query(
            `UPDATE public.buyer_quote_service_charges SET
                is_active   = FALSE,
                is_deleted  = TRUE,
                deleted_at  = NOW(),
                deleted_by  = $1
             WHERE buyer_quote_id = $2
               AND is_deleted     = FALSE`,
            [deleted_by, quoteRow.buyer_quote_id]
        );

        // ----------------------------------------
        // 8. RESTORE CART ITEMS BACK TO PENDING
        // ----------------------------------------
        if (cartItemIds.length > 0) {
            await client.query(
                `UPDATE public.cart_details SET
                    cart_item_status_id = $1,
                    quote_id             = NULL,
                    quote_item_id        = NULL,
                    quote_type_id        = NULL,
                    modified_at          = NOW(),
                    modified_by          = $2
                 WHERE cart_item_id = ANY($3::bigint[])
                   AND is_deleted   = FALSE`,
                [pending_status_id, deleted_by, cartItemIds]
            );
        }

        // ----------------------------------------
        // 9. RELEASE EDIT LOCK IF EXISTS
        // ----------------------------------------
        await client.query(
            `UPDATE record_locks SET
                is_deleted = TRUE,
                deleted_by = $1,
                deleted_at = NOW()
             WHERE table_name = 'buyer_saved_quote'
               AND record_id  = $2
               AND is_deleted = FALSE`,
            [deleted_by, buyer_quote_uuid]
        );

        // ----------------------------------------
        // 10. SOFT DELETE — quote header
        // ----------------------------------------
        await client.query(
            `UPDATE public.buyer_saved_quote SET
                is_active   = FALSE,
                is_deleted  = TRUE,
                deleted_at  = NOW(),
                deleted_by  = $1,
                modified_at = NOW(),
                modified_by = $1
             WHERE buyer_quote_uuid = $2
               AND is_deleted       = FALSE`,
            [deleted_by, buyer_quote_uuid]
        );

        await client.query('COMMIT');

        // ----------------------------------------
        // 11. RESPONSE
        // ----------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Quote deleted successfully",
            data: {
                buyer_quote_uuid: quoteRow.buyer_quote_uuid,
                quote_no:         quoteRow.quote_no,
                cart_items_restored: cartItemIds.length,
            }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (delete-buyer-quote):", err);
        saveErrorLog({
            api_name:   "delete-buyer-quote",
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
            message:            "Delete quote failed",
            error:              err.message
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// PRINT BUYER QUOTE
// --------------------------------------------------


responder.on('print-buyer-quote', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { buyer_quote_uuid } = req;
        const { buyer_uuid } = req.body;

        // ----------------------------------------
        // 1. VALIDATION
        // ----------------------------------------
        if (!buyer_quote_uuid) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Buyer quote UUID is required"
            });
        }

        if (!buyer_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Buyer UUID is required"
            });
        }

        // ----------------------------------------
        // 2. RESOLVE buyer_id
        // ----------------------------------------
        const buyerResult = await client.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active verified buyer found with the provided UUID"
            });
        }

        const buyer_id = buyerResult.rows[0].buyer_id;

        // ----------------------------------------
        // 3. FETCH QUOTE HEADER
        // ----------------------------------------
        const quoteResult = await client.query(
            `SELECT
                bsq.buyer_quote_id,
                bsq.buyer_quote_uuid,
                bsq.quote_no,
                bsq.total_price         AS final_amount,
                bsq.quantity            AS total_quantity,
                bsq.price               AS sum_unit_prices,
                bsq.margin_per          AS avg_margin_per,
                bsq.price_with_margin   AS product_subtotal_before_tax,
                bsq.created_at          AS quote_date,
                bsq.modified_at,
                bsq.status_of_quote,

                qt.quote_type_uuid,
                qt.code                 AS quote_type_code,
                qt.name                 AS quote_type_name,

                qs.name                 AS status_name,

                bsq.customer_name,
                bsq.customer_email,
                bsq.customer_phone,
                bsq.customer_address,

                br.name                 AS car_brand_name,
                md.name                 AS car_model_name,

                tcm.code                AS tax_code_code,
                tcm.name                AS tax_code_name,
                tcm.tax_rate,

                u.username              AS prepared_by

             FROM public.buyer_saved_quote bsq

             JOIN public.quote_statuses qs
                ON qs.quote_status_id = bsq.status_of_quote

             LEFT JOIN public.quote_type qt
                ON qt.quote_type_id = bsq.quote_type_id
               AND qt.is_deleted    = FALSE

             LEFT JOIN public.tax_code_master tcm
                ON tcm.tax_code_id = bsq.tax_code_id
               AND tcm.is_deleted  = FALSE

             LEFT JOIN public.brand br
                ON br.brand_id   = bsq.car_brand_id
               AND br.is_deleted = FALSE

             LEFT JOIN public.model md
                ON md.model_id   = bsq.car_model_id
               AND md.is_deleted = FALSE

             LEFT JOIN public.users u
                ON u.user_uuid = bsq.created_by

             WHERE bsq.buyer_quote_uuid = $1
               AND bsq.buyer_id         = $2
               AND bsq.is_deleted       = FALSE`,
            [buyer_quote_uuid, buyer_id]
        );

        if (quoteResult.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "Quote not found or does not belong to this buyer"
            });
        }

        const quote = quoteResult.rows[0];

        // ----------------------------------------
        // 4. FETCH PRODUCT LINE ITEMS
        // ----------------------------------------
        const lineItemsResult = await client.query(
            `SELECT
                bqi.buyer_quote_item_id,
                bqi.buyer_quote_item_uuid,
                bqi.service_item,
                bqi.quantity,
                bqi.price               AS unit_price,
                bqi.margin_per,
                bqi.price_with_margin   AS unit_price_with_margin,
                bqi.tax_amount,

                ROUND(bqi.price_with_margin * bqi.quantity, 2)              AS line_subtotal,
                ROUND((bqi.price_with_margin * bqi.quantity) + bqi.tax_amount, 2) AS line_total,

                cd.discount_amount,

                p.product_uuid,
                p.name                  AS product_name,
                p.oem_part_number       AS part_number,
                p.item_description      AS description,

                u.code                  AS uom_code,
                u.name                  AS uom_name,

                tcm.code                AS tax_code_code,
                tcm.tax_rate

             FROM public.buyer_quote_items bqi

             LEFT JOIN public.cart_details cd
                ON cd.cart_item_id = bqi.cart_item_id
               AND cd.is_deleted   = FALSE

             LEFT JOIN public.products p
                ON p.product_id = bqi.product_id
               AND p.is_deleted = FALSE

             LEFT JOIN public.uom u
                ON u.uom_id     = bqi.uom_id
               AND u.is_deleted = FALSE

             LEFT JOIN public.tax_code_master tcm
                ON tcm.tax_code_id = bqi.tax_code_id
               AND tcm.is_deleted  = FALSE

             WHERE bqi.buyer_quote_id = $1
               AND bqi.service_item   = 'Product'
               AND bqi.is_deleted     = FALSE
               AND bqi.is_active      = TRUE

             ORDER BY bqi.created_at ASC`,
            [quote.buyer_quote_id]
        );

        const productItems = lineItemsResult.rows;

        // ----------------------------------------
        // 4a. FETCH SERVICE CHARGES
        // ----------------------------------------
        const chargesResult = await client.query(
            `SELECT
                bqsc.buyer_quote_service_charge_uuid,
                bqsc.charge_type,
                bqsc.charge_value,
                bqsc.charge_amount,
                sc.code AS service_charge_code,
                sc.name AS service_charge_name

             FROM public.buyer_quote_service_charges bqsc

             JOIN public.service_charge sc
                ON sc.service_charge_id = bqsc.service_charge_id

             WHERE bqsc.buyer_quote_id = $1
               AND bqsc.is_deleted     = FALSE
               AND bqsc.is_active      = TRUE

             ORDER BY bqsc.created_at ASC`,
            [quote.buyer_quote_id]
        );

        const chargeItems = chargesResult.rows;

        // ----------------------------------------
        // 5. COMPUTE PRICING BREAKDOWN (charges are non-taxable)
        // ----------------------------------------
        const product_subtotal = parseFloat(
            productItems.reduce((s, r) => s + Number(r.line_subtotal), 0).toFixed(2)
        );
        const product_tax = parseFloat(
            productItems.reduce((s, r) => s + Number(r.tax_amount), 0).toFixed(2)
        );
        const product_discount = parseFloat(
            productItems.reduce((s, r) => s + (Number(r.discount_amount) || 0), 0).toFixed(2)
        );

        const charges_total = parseFloat(
            chargeItems.reduce((s, r) => s + Number(r.charge_amount), 0).toFixed(2)
        );

        const total_subtotal = parseFloat((product_subtotal + charges_total).toFixed(2));
        const total_tax      = product_tax;   // charges are non-taxable
        const grand_total    = parseFloat((total_subtotal + total_tax).toFixed(2));

        // ----------------------------------------
        // 6. FETCH COMPANY INFO
        // ----------------------------------------
        const companyResult = await client.query(
            `SELECT
                company_name,
                description,
                support_email,
                contact_number,
                logo,
                footer_text,
                copyright
             FROM public.cms_company_info
             WHERE is_active  = TRUE
               AND is_deleted = FALSE
             ORDER BY cms_company_info_id ASC
             LIMIT 1`
        );

        const company = companyResult.rowCount > 0 ? companyResult.rows[0] : null;

        // ----------------------------------------
        // 7. RESPONSE — structured print payload
        // ----------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Quote print data fetched successfully",
            data: {

                company: {
                    name:           company?.company_name   || null,
                    description:    company?.description    || null,
                    email:          company?.support_email  || null,
                    phone:          company?.contact_number || null,
                    logo:           company?.logo           || null,
                    footer_text:    company?.footer_text    || null,
                    copyright:      company?.copyright      || null,
                },

                quote: {
                    buyer_quote_uuid:   quote.buyer_quote_uuid,
                    quote_no:           quote.quote_no,
                    quote_type: {
                        uuid: quote.quote_type_uuid || null,
                        code: quote.quote_type_code || null,
                        name: quote.quote_type_name || null,
                    },
                    quote_date:         quote.quote_date,
                    status:             quote.status_name,
                    prepared_by:        quote.prepared_by,
                },

                customer: {
                    name:    quote.customer_name,
                    email:   quote.customer_email,
                    phone:   quote.customer_phone,
                    address: quote.customer_address,
                },

                vehicle: {
                    brand: quote.car_brand_name || null,
                    model: quote.car_model_name || null,
                },

                tax: {
                    code:     quote.tax_code_code,
                    name:     quote.tax_code_name,
                    rate:     quote.tax_rate,
                },

                product_items: productItems,
                charge_items:  chargeItems,

                pricing: {
                    product_subtotal,
                    product_discount,
                    product_tax,
                    charges_total,       // sum of charge_amount for service charges — non-taxable
                    total_subtotal,      // product_subtotal + charges_total
                    total_tax,           // = product_tax (charges are non-taxable)
                    grand_total,         // total_subtotal + total_tax
                },
            },
        });

    } catch (err) {
        logger.error("Responder Error (print-buyer-quote):", err);
        saveErrorLog({
            api_name:   "print-buyer-quote",
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
            message:            "Fetch print data failed",
            error:              err.message
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// GET BUYER QUOTE HISTORY 
// --------------------------------------------------

responder.on('get-buyer-quote-history', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { buyer_quote_uuid } = req;

        if (!buyer_quote_uuid) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Buyer quote UUID is required",
            });
        }

        const quoteResult = await client.query(
            `SELECT
                bsq.buyer_quote_id,
                bsq.buyer_quote_uuid,
                bsq.quote_no,
                bsq.total_price,
                bsq.margin_per,
                bsq.created_at,
                bsq.created_by,
                creators.username AS created_by_name,
                bsq.modified_at,
                bsq.modified_by,
                updaters.username AS modified_by_name,
                qs.name            AS status_name
             FROM public.buyer_saved_quote bsq
             LEFT JOIN public.users creators
                ON creators.user_uuid = bsq.created_by
             LEFT JOIN public.users updaters
                ON updaters.user_uuid = bsq.modified_by
             LEFT JOIN public.quote_statuses qs
                ON qs.quote_status_id = bsq.status_of_quote
             WHERE bsq.buyer_quote_uuid = $1
               AND bsq.is_deleted       = FALSE`,
            [buyer_quote_uuid]
        );

        if (quoteResult.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "Quote not found",
            });
        }

        const quote = quoteResult.rows[0];

        // Product line items only
        const itemsResult = await client.query(
            `SELECT
                bqi.buyer_quote_item_id,
                bqi.buyer_quote_item_uuid,
                bqi.service_item,
                bqi.quantity,
                bqi.margin_per,
                bqi.price_with_margin,
                bqi.created_at,
                bqi.created_by,
                creators.username AS created_by_name,
                bqi.modified_at,
                bqi.modified_by,
                updaters.username AS modified_by_name,
                p.name             AS product_name
             FROM public.buyer_quote_items bqi
             LEFT JOIN public.users creators
                ON creators.user_uuid = bqi.created_by
             LEFT JOIN public.users updaters
                ON updaters.user_uuid = bqi.modified_by
             LEFT JOIN public.products p
                ON p.product_id = bqi.product_id
               AND p.is_deleted = FALSE
             WHERE bqi.buyer_quote_id = $1
               AND bqi.service_item   = 'Product'
               AND bqi.is_deleted     = FALSE
             ORDER BY bqi.created_at ASC`,
            [quote.buyer_quote_id]
        );

        // Service charges history
        const chargesHistoryResult = await client.query(
            `SELECT
                bqsc.buyer_quote_service_charge_id,
                bqsc.charge_type,
                bqsc.charge_value,
                bqsc.charge_amount,
                bqsc.created_at,
                bqsc.created_by,
                creators.username AS created_by_name,
                sc.name            AS service_charge_name
             FROM public.buyer_quote_service_charges bqsc
             LEFT JOIN public.users creators
                ON creators.user_uuid = bqsc.created_by
             JOIN public.service_charge sc
                ON sc.service_charge_id = bqsc.service_charge_id
             WHERE bqsc.buyer_quote_id = $1
               AND bqsc.is_deleted     = FALSE
             ORDER BY bqsc.created_at ASC`,
            [quote.buyer_quote_id]
        );

        // ----------------------------------------
        // FETCH PRINT HISTORY
        // ----------------------------------------
        const printResult = await client.query(
            `SELECT
                bqph.print_count,
                bqph.created_at   AS first_printed_at,
                bqph.modified_at  AS last_printed_at,
                bqph.printed_by,
                printers.username AS printed_by_name,
                printers.fullname AS printed_by_fullname,
                qs.name           AS status_at_print
             FROM public.buyer_quote_print_history bqph
             LEFT JOIN public.users printers
                ON printers.user_id = bqph.printed_by
             LEFT JOIN public.quote_statuses qs
                ON qs.quote_status_id = bqph.status_of_print
             WHERE bqph.buyer_quote_id = $1
               AND bqph.is_deleted     = FALSE`,
            [quote.buyer_quote_id]
        );

        const printHistory = printResult.rowCount > 0 ? printResult.rows[0] : null;

        // ----------------------------------------
        // BUILD TIMELINE EVENTS
        // ----------------------------------------
        const timeline = [];

        timeline.push({
            action_type:  'CREATED',
            description:  `Quote ${quote.quote_no} created`,
            performed_by: quote.created_by,
            performed_by_name: quote.created_by_name,
            performed_at: quote.created_at,
        });

        for (const item of itemsResult.rows) {
            const label = item.product_name || 'Product item';

            timeline.push({
                action_type:  'ITEM_ADDED',
                description:  `${label} added — qty ${item.quantity}, margin ${item.margin_per}%`,
                performed_by: item.created_by,
                performed_by_name: item.created_by_name,
                performed_at: item.created_at,
            });

            if (item.modified_at) {
                timeline.push({
                    action_type:  'ITEM_UPDATED',
                    description:  `${label} updated — margin ${item.margin_per}%, price ${item.price_with_margin}`,
                    performed_by: item.modified_by,
                    performed_by_name: item.modified_by_name,
                    performed_at: item.modified_at,
                });
            }
        }

        for (const charge of chargesHistoryResult.rows) {
            const valueLabel = charge.charge_type === 'PERCENTAGE'
                ? `${charge.charge_value}%`
                : charge.charge_value;

            timeline.push({
                action_type:  'CHARGE_ADDED',
                description:  `${charge.service_charge_name} added — ${valueLabel} (amount: ${charge.charge_amount})`,
                performed_by: charge.created_by,
                performed_by_name: charge.created_by_name,
                performed_at: charge.created_at,
            });
        }

        if (quote.modified_at) {
            timeline.push({
                action_type:  'QUOTE_UPDATED',
                description:  `Quote updated — total price ${quote.total_price}, margin ${quote.margin_per}%, status ${quote.status_name}`,
                performed_by: quote.modified_by,
                performed_by_name: quote.modified_by_name,
                performed_at: quote.modified_at,
            });
        }

        if (printHistory) {
            timeline.push({
                action_type:  'PRINTED',
                description:  `Quote ${quote.quote_no} printed (status at print: ${printHistory.status_at_print || 'N/A'})`,
                performed_by: printHistory.printed_by,
                performed_by_name: printHistory.printed_by_name || printHistory.printed_by_fullname,
                performed_at: printHistory.first_printed_at,
            });

            if (printHistory.last_printed_at) {
                timeline.push({
                    action_type:  'REPRINTED',
                    description:  `Quote ${quote.quote_no} reprinted (total prints: ${printHistory.print_count})`,
                    performed_by: printHistory.printed_by,
                    performed_by_name: printHistory.printed_by_name || printHistory.printed_by_fullname,
                    performed_at: printHistory.last_printed_at,
                });
            }
        }

        timeline.sort((a, b) => new Date(b.performed_at) - new Date(a.performed_at));

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Quote history fetched successfully",
            data: {
                buyer_quote_uuid: quote.buyer_quote_uuid,
                quote_no:         quote.quote_no,
                current_status:   quote.status_name,
                print_count:      printHistory ? printHistory.print_count : 0,
                history:          timeline,
            },
        });

    } catch (err) {
        logger.error("Responder Error (get-buyer-quote-history):", err);
        saveErrorLog({
            api_name:   "get-buyer-quote-history",
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
            message:            "Fetch quote history failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// UPSERT BUYER QUOTE PRINT HISTORY 
// --------------------------------------------------

responder.on('upsert-buyer-quote-print-history', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { buyer_quote_uuid } = req;
        const { buyer_uuid, user_uuid } = req.body;

        // ----------------------------------------
        // 1. VALIDATION
        // ----------------------------------------
        if (!buyer_quote_uuid) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Buyer quote UUID is required"
            });
        }

        if (!buyer_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Buyer UUID is required"
            });
        }

        // ----------------------------------------
        // 2. RESOLVE buyer_id (always needed)
        // ----------------------------------------
        const buyerResult = await client.query(
            `SELECT ba.buyer_id, ba.user_id AS buyer_user_id
             FROM public.buyer_accounts ba
             WHERE ba.buyer_uuid            = $1
               AND ba.is_active             = TRUE
               AND ba.is_deleted            = FALSE
               AND ba.phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active verified buyer found with the provided UUID"
            });
        }

        const buyer_id      = buyerResult.rows[0].buyer_id;
        const buyer_user_id = buyerResult.rows[0].buyer_user_id;

        // ----------------------------------------
        // 3. RESOLVE printed_by (+ its uuid for audit columns)
        //    - Admin flow: user_uuid explicitly passed -> validate it
        //      exists in users, use it as printed_by.
        //    - Buyer self-print flow: no user_uuid passed -> fall back
        //      to the buyer's own linked user account.
        //    NOTE: printed_by is stored to show who printed LAST; it
        //    is no longer part of the conflict/uniqueness key.
     
        // ----------------------------------------
        let printed_by;
        let printed_by_uuid;

        if (user_uuid?.trim()) {
            const adminUserResult = await client.query(
                `SELECT user_id, user_uuid
                 FROM public.users
                 WHERE user_uuid  = $1
                   AND is_active  = TRUE
                   AND is_deleted = FALSE`,
                [user_uuid.trim()]
            );

            if (adminUserResult.rowCount === 0) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "No active user found with the provided user UUID"
                });
            }

            printed_by      = adminUserResult.rows[0].user_id;
            printed_by_uuid = adminUserResult.rows[0].user_uuid;
        } else {
            printed_by = buyer_user_id;

            const buyerUserResult = await client.query(
                `SELECT user_uuid
                 FROM public.users
                 WHERE user_id    = $1
                   AND is_active  = TRUE
                   AND is_deleted = FALSE`,
                [buyer_user_id]
            );

            if (buyerUserResult.rowCount === 0) {
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              "No active user account found for this buyer; cannot record print"
                });
            }

            printed_by_uuid = buyerUserResult.rows[0].user_uuid;
        }

        if (!printed_by) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No linked user account found for this buyer; cannot record print"
            });
        }

        // ----------------------------------------
        // 4. RESOLVE buyer_quote_id + current status
        // ----------------------------------------
        const quoteResult = await client.query(
            `SELECT buyer_quote_id, status_of_quote
             FROM public.buyer_saved_quote
             WHERE buyer_quote_uuid = $1
               AND buyer_id         = $2
               AND is_deleted       = FALSE
               AND is_active = TRUE`,
            [buyer_quote_uuid, buyer_id]
        );

        if (quoteResult.rowCount === 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "Quote not found or does not belong to this buyer"
            });
        }

        const { buyer_quote_id, status_of_quote } = quoteResult.rows[0];

        // ----------------------------------------
        // 5. UPSERT PRINT HISTORY
        //    Conflict target (buyer_quote_id, buyer_id): a single
        //    combined counter per quote, regardless of whether the
        //    buyer or an admin printed. printed_by is overwritten
        //    each time to reflect the most recent printer.
        //    created_by is set only once (on insert); modified_by
        //    is refreshed on every subsequent print.
        // ----------------------------------------
        const result = await client.query(
            `INSERT INTO public.buyer_quote_print_history
                (buyer_quote_id, buyer_id, printed_by, print_count, status_of_print, assigned_to,created_by, created_at)
             VALUES ($1, $2, $3, 1, $4,$5, $5, now())
             ON CONFLICT (buyer_quote_id, buyer_id)
             DO UPDATE SET
                print_count     = buyer_quote_print_history.print_count + 1,
                printed_by      = $3,
                status_of_print = $4,
                modified_by     = $5,
                modified_at     = now()
             RETURNING buyer_quote_print_history_uuid, print_count, printed_by, created_by, modified_by`,
            [buyer_quote_id, buyer_id, printed_by, status_of_quote, printed_by_uuid]
        );

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Print history recorded successfully",
            data:               result.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (upsert-buyer-quote-print-history):", err);
        saveErrorLog({
            api_name:   "upsert-buyer-quote-print-history",
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
            message:            "Record print history failed",
            error:              err.message
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// GET BUYER QUOTE PRINT HISTORY 
// --------------------------------------------------

responder.on('get-buyer-quote-print-history', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { buyer_quote_uuid } = req.body;

        if (!buyer_quote_uuid) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Buyer quote UUID is required"
            });
        }

        const result = await client.query(
            `SELECT
                bqph.buyer_quote_print_history_uuid,
                bqph.print_count,
                bqph.created_at   AS first_printed_at,
                bqph.modified_at  AS last_printed_at,
                qs.name           AS status_at_last_print,
                ba.buyer_uuid,
                u.username        AS last_printed_by_username,
                bsq.quote_no
             FROM public.buyer_quote_print_history bqph
             JOIN public.buyer_saved_quote bsq
                ON bsq.buyer_quote_id = bqph.buyer_quote_id
             JOIN public.buyer_accounts ba
                ON ba.buyer_id = bqph.buyer_id
             JOIN public.users u
                ON u.user_id = bqph.printed_by
             LEFT JOIN public.quote_statuses qs
                ON qs.quote_status_id = bqph.status_of_print
             WHERE bsq.buyer_quote_uuid = $1
               AND bqph.is_deleted      = FALSE`,
            [buyer_quote_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, {
                header_type:        "SUCCESS",
                message_visibility: true,
                status:             true,
                code:               1000,
                message:            "No print history found for this quote",
                data:               null
            });
        }

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Print history fetched successfully",
            data:               result.rows[0]
        });

    } catch (err) {
        logger.error("Responder Error (get-buyer-quote-print-history):", err);
        saveErrorLog({
            api_name:   "get-buyer-quote-print-history",
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
            message:            "Fetch print history failed",
            error:              err.message
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// GET BUYER QUOTE PRINT COUNT 
// --------------------------------------------------

responder.on('get-buyer-quote-print-count', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { buyer_quote_uuid } = req;
        const { buyer_uuid } = req.body;

        if (!buyer_quote_uuid || !buyer_uuid?.trim()) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Buyer quote UUID and Buyer UUID are required"
            });
        }

        const result = await client.query(
            `SELECT bqph.print_count
             FROM public.buyer_quote_print_history bqph
             JOIN public.buyer_saved_quote bsq
                ON bsq.buyer_quote_id = bqph.buyer_quote_id
             JOIN public.buyer_accounts ba
                ON ba.buyer_id = bqph.buyer_id
             WHERE bsq.buyer_quote_uuid = $1
               AND ba.buyer_uuid        = $2
               AND bqph.is_deleted      = FALSE`,
            [buyer_quote_uuid, buyer_uuid.trim()]
        );

        const print_count = result.rowCount > 0 ? result.rows[0].print_count : 0;

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Print count fetched successfully",
            data: { print_count }
        });

    } catch (err) {
        logger.error("Responder Error (get-buyer-quote-print-count):", err);
        saveErrorLog({
            api_name:   "get-buyer-quote-print-count",
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
            message:            "Fetch print count failed",
            error:              err.message
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// CREATE WALLET ACCOUNT
// --------------------------------------------------


responder.on("create-wallet-account", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const {
            buyer_uuid,
            wallet_balance,
            created_by,
        } = req.body;

        const now         = new Date();
        const assigned_to = created_by;
        const assigned_at = now;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created by is required" });

        if (wallet_balance !== undefined && wallet_balance !== null && isNaN(Number(wallet_balance)))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "wallet balance must be a valid number" });

        if (wallet_balance !== undefined && wallet_balance !== null && Number(wallet_balance) < 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "wallet balance cannot be negative" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_uuid → buyer_id
        // --------------------------------------------------
        const buyerResult = await client.query({
            text: `SELECT buyer_id
                   FROM public.buyer_accounts
                   WHERE buyer_uuid = $1
                     AND is_deleted = FALSE
                     AND is_active  = TRUE
                     AND phone_number_verified = TRUE`,
            values: [buyer_uuid.trim()],
        });

        if (buyerResult.rowCount === 0)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active buyer found with the provided UUID",
            });

        const { buyer_id } = buyerResult.rows[0];

        const openingBalance = Number(wallet_balance) || 0;

        // --------------------------------------------------
        // 3. RESOLVE 'RCH' reference_type_id UP FRONT (only if opening
        //    balance > 0 — no point failing on missing master data for
        //    a wallet that opens at zero).
        // --------------------------------------------------
        let reference_type_id = null;
        if (openingBalance > 0) {
            const refTypeResult = await client.query(
                `SELECT reference_type_id
                 FROM public.reference_type
                 WHERE code = 'RCH' AND is_active = TRUE AND is_deleted = FALSE`
            );

            if (refTypeResult.rowCount === 0) {
                logger.error("create-wallet-account: missing master data — reference_type(RCH)");
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Configuration error",
                    error:              "Required master data not found: reference_type 'RCH'",
                });
            }
            reference_type_id = refTypeResult.rows[0].reference_type_id;
        }

        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 4. DUPLICATE WALLET CHECK (buyer_id is UNIQUE on table)
        // --------------------------------------------------
        const duplicateCheck = await client.query({
            text: `SELECT wallet_id
                   FROM public.wallet_accounts
                   WHERE buyer_id   = $1
                     AND is_deleted = FALSE
                     AND is_active = TRUE`,
            values: [buyer_id],
        });

        if (duplicateCheck.rowCount > 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2002,
                message:            "Wallet already exists",
                error:              "A wallet already exists for this buyer. Use the wallet recharge API to add funds.",
            });
        }

        // --------------------------------------------------
        // 5. INSERT wallet_accounts
        // --------------------------------------------------
        const walletInsert = await client.query({
            text: `
                INSERT INTO public.wallet_accounts (
                    buyer_id,
                    wallet_balance,
                    is_active,
                    assigned_to,
                    assigned_at,
                    created_by
                ) VALUES (
                    $1, $2, TRUE, $3, $4, $5
                )
                RETURNING wallet_id, wallet_uuid, buyer_id, wallet_balance, created_at
            `,
            values: [
                buyer_id,
                openingBalance,
                assigned_to,
                assigned_at,
                created_by,
            ],
        });

        const wallet = walletInsert.rows[0];

        // --------------------------------------------------
        // 6. LOG OPENING BALANCE AS A CREDIT TRANSACTION (only if > 0).
        //    Keeps wallet_transactions reconcilable against
        //    wallet_accounts.wallet_balance from day one.
        // --------------------------------------------------
        if (openingBalance > 0) {
            await client.query({
                text: `INSERT INTO public.wallet_transactions (
                            wallet_id, transaction_type, amount,
                            balance_before, balance_after, reference_type_id,
                            assigned_to, assigned_at, created_by, created_at
                       ) VALUES (
                            $1, 'CREDIT', $2,
                            $3, $4, $5,
                            $6, $7, $8, $9
                       )`,
                values: [
                    wallet.wallet_id,
                    openingBalance,
                    0,                  // balance_before
                    openingBalance,     // balance_after
                    reference_type_id,
                    assigned_to,
                    assigned_at,
                    created_by,
                    now,
                ],
            });
        }

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 7. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Wallet account created successfully",
            data: {
                wallet_id:      wallet.wallet_id,
                wallet_uuid:    wallet.wallet_uuid,
                buyer_id:       wallet.buyer_id,
                wallet_balance: Number(wallet.wallet_balance),
                created_at:     wallet.created_at,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }

        // Unique constraint race-condition fallback
        if (err.code === '23505') {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2002,
                message:            "Wallet already exists",
                error:              "A wallet already exists for this buyer",
            });
        }

        logger.error("Responder Error (create-wallet-account):", err);
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
// CHECK WALLET BALANCE
// --------------------------------------------------

responder.on("check-wallet-balance", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { buyer_uuid, required_amount } = req.body;

        
        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });

        if (required_amount !== undefined && required_amount !== null && isNaN(Number(required_amount)))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "required amount must be a valid number" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_uuid → buyer_id
        // --------------------------------------------------
        const buyerResult = await client.query({
            text: `SELECT buyer_id
                   FROM public.buyer_accounts
                   WHERE buyer_uuid = $1
                     AND is_deleted = FALSE
                     AND is_active  = TRUE
                     AND phone_number_verified = TRUE`,
            values: [buyer_uuid.trim()],
        });

        if (buyerResult.rowCount === 0)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active buyer found with the provided UUID",
            });

        const { buyer_id } = buyerResult.rows[0];

        // --------------------------------------------------
        // 3. FETCH WALLET (read-only, no lock — pre-checkout check)
        // --------------------------------------------------
        const walletResult = await client.query({
            text: `SELECT wallet_id, wallet_uuid, wallet_balance, is_active
                   FROM public.wallet_accounts
                   WHERE buyer_id   = $1
                     AND is_deleted = FALSE`,
            values: [buyer_id],
        });

        if (walletResult.rowCount === 0)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No wallet found for this buyer",
            });

        const wallet = walletResult.rows[0];

        if (!wallet.is_active)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Wallet inactive",
                error:              "This wallet is currently inactive",
            });

        // --------------------------------------------------
        // 4. SUFFICIENCY CHECK (only if required_amount passed)
        // --------------------------------------------------
        const walletBalance = Number(wallet.wallet_balance);
        const responseData  = {
            wallet_id:      wallet.wallet_id,
            wallet_uuid:    wallet.wallet_uuid,
            wallet_balance: walletBalance,
        };

        if (required_amount !== undefined && required_amount !== null) {
            const requiredAmt = Number(required_amount);
            responseData.required_amount = requiredAmt;
            responseData.is_sufficient   = walletBalance >= requiredAmt;
            responseData.shortfall       = walletBalance >= requiredAmt
                ? 0
                : parseFloat((requiredAmt - walletBalance).toFixed(2));
        }

        // --------------------------------------------------
        // 5. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Wallet balance fetched successfully",
            data:               responseData,
        });

    } catch (err) {
        logger.error("Responder Error (check-wallet-balance):", err);
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
// CHECKOUT INITIATE
// --------------------------------------------------
// Responsibility of THIS step:
//   1. Validate stock (ATP) for every cart item being checked out.
//   2. Lock unit_price + compute item-level tax_amount / discount_amount /
//      final_price from that locked price (pure arithmetic — will NOT
//      change later, since it doesn't depend on address/shipping).
//   3. Roll up subtotal / tax_amount / discount_amount on the
//      checkout_details header (= sum of item-level values — this is
//      also final and will not change).
//   4. Resolve + insert any checkout_service_charges sent in the
//      payload (does NOT roll these into subtotal/grand_total here —
//      that still happens later in /calculate).
//   5. Leave shipping_charge and grand_total UNSET (0) — these are
//      the responsibility of POST /checkout/{id}/calculate, which runs
//      after address selection (shipping needs a destination) and can
//      be re-triggered on address/payment-method/coupon changes.
// --------------------------------------------------

responder.on("checkout-initiate", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const {
            buyer_uuid,
            cart_item_uuids,
            checkout_type_uuid,
            notes,
            created_by,
            service_charges,
        } = req.body;

        const now         = new Date();
        const assigned_to = created_by;
        const assigned_at = now;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        if (!Array.isArray(cart_item_uuids) || cart_item_uuids.length === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "cart_item_uuids must be a non-empty array" });

        if (!checkout_type_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "checkout_type_uuid is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created by is required" });

        // --------------------------------------------------
        // 1b. VALIDATE SERVICE CHARGES (optional array)
        //     PERCENTAGE -> requires charge_value (the %) AND
        //     charge_amount (the base amount to apply % to).
        //     FIXED -> requires charge_value only; it is used
        //     directly as the final charge_amount.
        // --------------------------------------------------
        const serviceCharges = Array.isArray(service_charges) ? service_charges : [];

        for (const [idx, sc] of serviceCharges.entries()) {
            if (!sc.service_charge_uuid?.trim())
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `service_charges[${idx}].service_charge_uuid is required` });

            const normalizedType = sc.charge_type?.trim()?.toUpperCase();
            if (!normalizedType || !["PERCENTAGE", "FIXED"].includes(normalizedType))
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `service_charges[${idx}].charge_type must be PERCENTAGE or FIXED` });

            if (sc.charge_value === undefined || sc.charge_value === null || isNaN(Number(sc.charge_value)) || Number(sc.charge_value) <= 0)
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `service_charges[${idx}].charge_value must be a positive number` });

            if (normalizedType === "PERCENTAGE" &&
                (sc.charge_amount === undefined || sc.charge_amount === null || isNaN(Number(sc.charge_amount)) || Number(sc.charge_amount) <= 0))
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `service_charges[${idx}].charge_amount (base amount) is required when charge_type is PERCENTAGE` });
        }

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // --------------------------------------------------
        // 3. RESOLVE MASTER DATA
        //
        //    checkout_status = 'INT' (INITIATED) here — NOT a
        //    "validated/final" state. Totals are still provisional
        //    (no shipping, no grand_total) until /calculate runs.
        // --------------------------------------------------
        const [
            checkoutStatusResult,
            checkoutItemStatusResult,
            paymentStatusResult,
            checkedOutCartStatusResult,
            checkoutTypeResult,
        ] = await Promise.all([
            pool.query(`SELECT checkout_status_id FROM public.checkout_status WHERE code = 'INT' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT checkout_item_status_id FROM public.checkout_item_status WHERE code = 'VLD' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT payment_status_id FROM public.payment_statuses WHERE code = 'PEN' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT cart_item_status_id FROM public.cart_item_status WHERE code = 'CKO' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(
                `SELECT checkout_type_id
                 FROM public.checkout_type
                 WHERE checkout_type_uuid = $1
                   AND is_active          = TRUE
                   AND is_deleted         = FALSE`,
                [checkout_type_uuid.trim()]
            ),
        ]);

        if (
            checkoutStatusResult.rowCount === 0 ||
            checkoutItemStatusResult.rowCount === 0 ||
            paymentStatusResult.rowCount === 0 ||
            checkedOutCartStatusResult.rowCount === 0
        ) {
            logger.error("checkout-initiate: missing master data — checkout_status(INT) / checkout_item_status(VLD) / payment_statuses(PEN) / cart_item_status(CKO)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        if (checkoutTypeResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `Invalid checkout_type_uuid: ${checkout_type_uuid}` });

        const initiated_status_id        = checkoutStatusResult.rows[0].checkout_status_id;
        const validated_item_status_id   = checkoutItemStatusResult.rows[0].checkout_item_status_id;
        const pending_payment_status_id  = paymentStatusResult.rows[0].payment_status_id;
        const checked_out_cart_status_id = checkedOutCartStatusResult.rows[0].cart_item_status_id;
        const checkout_type_id           = checkoutTypeResult.rows[0].checkout_type_id;

        // --------------------------------------------------
        // 4. FETCH AND VALIDATE CART ITEMS (ownership + eligibility)
        //    Also pulls quote_id / quote_item_id linkage (set
        //    when a cart item originated from a saved quote)
        //    and resolves quote_type_id via buyer_saved_quote.
        // --------------------------------------------------
        const uniqueUuids  = [...new Set(cart_item_uuids.map((u) => u.trim()))];
        const placeholders = uniqueUuids.map((_, i) => `$${i + 2}`).join(", ");

        const cartCheck = await pool.query(
            `SELECT
                cd.cart_item_id,
                cd.cart_item_uuid,
                cd.product_id,
                cd.seller_id,
                cd.warehouse_id,
                cd.warehouse_type_id,
                cd.product_name,
                cd.sku,
                cd.quantity,
                cd.uom_id,
                cd.quote_id,
                cd.quote_item_id,
                bsq.quote_type_id,
                cis.code AS status_code
             FROM public.cart_details cd
             JOIN public.cart_item_status cis
               ON cis.cart_item_status_id = cd.cart_item_status_id
             LEFT JOIN public.buyer_saved_quote bsq
               ON bsq.buyer_quote_id = cd.quote_id
             WHERE cd.buyer_id            = $1
               AND cd.cart_item_uuid = ANY(ARRAY[${placeholders}]::uuid[])
               AND cd.is_deleted          = FALSE
               AND cd.is_active           = TRUE`,
            [buyer_id, ...uniqueUuids]
        );

        if (cartCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No valid cart items found for this buyer" });

        const foundUuids   = cartCheck.rows.map((r) => r.cart_item_uuid);
        const missingUuids = uniqueUuids.filter((u) => !foundUuids.includes(u));

        if (missingUuids.length > 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: `Some cart items not found or do not belong to this buyer: ${missingUuids.join(", ")}` });

        // --------------------------------------------------
        // 4a. BLOCK quote-linked items — those go through
        //     checkout-initiate-quote instead (whole-quote flow).
        // --------------------------------------------------
        const quoteLinkedItems = cartCheck.rows.filter(r => r.quote_id !== null);

        if (quoteLinkedItems.length > 0)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Quote-originated cart items must be checked out via checkout-initiate-quote: ${quoteLinkedItems.map(r => r.cart_item_uuid).join(", ")}`,
            });

        const ineligible = cartCheck.rows.filter((r) => r.status_code !== "PND");

        if (ineligible.length > 0)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Some cart items are not eligible for checkout: ${ineligible.map((r) => r.cart_item_uuid).join(", ")}`,
            });

        // --------------------------------------------------
        // 4b. RESOLVE SERVICE CHARGE IDs (optional)
        //     Validates every service_charge_uuid sent exists,
        //     is active, and is not deleted. Builds a lookup map
        //     uuid -> service_charge_id for the insert loop later.
        // --------------------------------------------------
        let serviceChargeIdMap = new Map();

        if (serviceCharges.length > 0) {
            const uniqueScUuids  = [...new Set(serviceCharges.map((s) => s.service_charge_uuid.trim()))];
            const scPlaceholders = uniqueScUuids.map((_, i) => `$${i + 1}`).join(", ");

            const scResult = await pool.query(
                `SELECT service_charge_id, service_charge_uuid
                 FROM public.service_charge
                 WHERE service_charge_uuid = ANY(ARRAY[${scPlaceholders}]::uuid[])
                   AND is_active  = TRUE
                   AND is_deleted = FALSE`,
                uniqueScUuids
            );

            serviceChargeIdMap = new Map(scResult.rows.map((r) => [r.service_charge_uuid, r.service_charge_id]));

            const missingScUuids = uniqueScUuids.filter((u) => !serviceChargeIdMap.has(u));
            if (missingScUuids.length > 0)
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: `Invalid or inactive service_charge_uuid(s): ${missingScUuids.join(", ")}` });
        }

        // --------------------------------------------------
        // 5. TAX RATE LOOKUP (same pattern as add-to-cart)
        //    NOTE: currently country-level (jurisdiction = 'AE'),
        //    i.e. NOT address-dependent yet. That's exactly why it's
        //    safe to lock tax_amount per item here at initiate.
        //    If tax ever becomes zone/emirate-dependent, this lookup
        //    must move to the /calculate step (post address-select)
        //    instead.
        // --------------------------------------------------
        const TAX_RATE_DEFAULT = 0.05;
        let taxRate   = TAX_RATE_DEFAULT;
        let taxCodeId = null;

        const taxResult = await pool.query(
            `SELECT tcm.tax_code_id, tcm.tax_rate
             FROM public.tax_code_master tcm
             JOIN public.jurisdiction j
                ON j.jurisdiction_uuid = tcm.jurisdiction_uuid
               AND j.code              = 'AE'
               AND j.level             = 'COUNTRY'
               AND j.is_deleted        = FALSE
               AND j.is_active         = TRUE
             WHERE tcm.is_deleted = FALSE
               AND tcm.is_active  = TRUE
             LIMIT 1`
        );

        if (taxResult.rowCount > 0 && taxResult.rows[0].tax_rate !== null) {
            taxRate   = Number(taxResult.rows[0].tax_rate) / 100;
            taxCodeId = taxResult.rows[0].tax_code_id;
        }

        // ====================================================
        // TRANSACTION START — everything from here on must be
        // serialized so stock checks + reservation increments
        // stay atomic per item, and checkout numbering stays
        // race-free.
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 6. GENERATE CHECKOUT NUMBER
        //    Same pg_advisory_xact_lock + COUNT(*) pattern used
        //    for quote_no generation in create-buyer-quote.
        // --------------------------------------------------
        await client.query(`SELECT pg_advisory_xact_lock($1)`, [commonenum.CHECKOUT_SEQ_LOCK_KEY]);

        const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");

        const seqResult = await client.query(
            `SELECT COUNT(*) AS today_count
             FROM public.checkout_details
             WHERE DATE(created_at) = CURRENT_DATE`
        );

        const sequence = (Number(seqResult.rows[0].today_count) + 1).toString().padStart(4, "0");
        const checkout_number = `CHK-${datePart}-${sequence}`;

        // --------------------------------------------------
        // 7. PER-ITEM: RE-VALIDATE STOCK, RE-FETCH CURRENT PRICE,
        //    LOCK unit_price + compute item-level tax/discount/final.
        //    (validation only — NO hard reservation here.
        //    seller_inventory.reserved_qty is left untouched;
        //    it is only incremented once the order is actually
        //    created after successful payment. checkout-initiate
        //    just confirms stock currently looks sufficient and
        //    locks the price for this checkout session.)
        // --------------------------------------------------
        let subtotal        = 0;
        let total_tax        = 0;
        let total_discount   = 0;
        const checkoutLines  = [];

        for (const row of cartCheck.rows) {
            const requestedQty = Number(row.quantity);

            const invResult = await client.query({
                text: `SELECT si.inventory_id, si.onhand_qty, si.reserved_qty, si.buffer_qty,
                              p.price AS mrp, p.price_after_sale AS sale_price
                       FROM public.seller_inventory si
                       JOIN public.products p
                         ON p.product_id = si.product_id
                        AND p.is_deleted = FALSE
                        AND p.is_active  = TRUE
                       WHERE si.product_id   = $1
                         AND si.seller_id    = $2
                         AND si.warehouse_id = $3
                         AND si.is_deleted   = FALSE
                         AND si.is_active    = TRUE`,
                values: [row.product_id, row.seller_id, row.warehouse_id],
            });

            if (invResult.rowCount === 0) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2003,
                    message:            "Record not found",
                    error:              `Inventory no longer available for cart item ${row.cart_item_uuid}`,
                });
            }

            const inv = invResult.rows[0];

            // ATP formula: onhand_qty - buffer_qty - reserved_qty
            const inventoryAvailable = Number(inv.onhand_qty) - Number(inv.reserved_qty) - Number(inv.buffer_qty);

            // Other buyers' active cart-level soft holds for the
            // same product/seller/warehouse (this row's own soft
            // hold is excluded — it's being validated for checkout
            // right now, not converted to any harder hold).
            const cartReservedResult = await client.query({
                text: `SELECT COALESCE(SUM(cd.reserved_quantity), 0) AS total_reserved
                       FROM public.cart_details cd
                       JOIN public.cart_item_status cis
                         ON cis.cart_item_status_id = cd.cart_item_status_id
                       WHERE cd.product_id    = $1
                         AND cd.seller_id     = $2
                         AND cd.warehouse_id  = $3
                         AND cd.cart_item_id != $4
                         AND cd.is_deleted    = FALSE
                         AND cis.code NOT IN ('REM', 'EXP')`,
                values: [row.product_id, row.seller_id, row.warehouse_id, row.cart_item_id],
            });

            // --------------------------------------------------
            // CHANGE: also subtract active LISTING-ORIGIN quote
            // soft-holds (buyer_quote_items, cart_item_id IS NULL,
            // quote still DRF/ACT) for this product/warehouse —
            // same reasoning as add-to-cart.js. This item's own
            // cart row already has cart_item_id set (it came from
            // add-to-cart or accept-buyer-quote-listing), so it can
            // never appear in this subquery — no self-exclusion
            // needed here.
            // --------------------------------------------------
            const quoteReservedResult = await client.query({
                text: `SELECT COALESCE(SUM(bqi.quantity), 0) AS total_reserved
                       FROM public.buyer_quote_items bqi
                       JOIN public.buyer_saved_quote bsq
                         ON bsq.buyer_quote_id = bqi.buyer_quote_id
                       JOIN public.quote_statuses qs
                         ON qs.quote_status_id = bsq.status_of_quote
                       WHERE bqi.product_id     = $1
                         AND bqi.warehouse_id   = $2
                         AND bqi.cart_item_id  IS NULL
                         AND bqi.is_deleted     = FALSE
                         AND bqi.is_active      = TRUE
                         AND qs.code IN ('DRF', 'ACT')`,
                values: [row.product_id, row.warehouse_id],
            });

            const otherCartReserved  = Number(cartReservedResult.rows[0].total_reserved);
            const otherQuoteReserved = Number(quoteReservedResult.rows[0].total_reserved);
            const netAvailable       = inventoryAvailable - otherCartReserved - otherQuoteReserved;

            if (requestedQty > netAvailable) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2007,
                    message:            "Insufficient stock",
                    error:              `Only ${Math.max(netAvailable, 0)} units are now available for ${row.product_name}`,
                });
            }

            // Price lock — re-fetched from products, not trusted from cart.
            // tax_amount / discount_amount / final_price are derived purely
            // from this locked unit_price, so they are final at this point
            // and will NOT be recomputed at /calculate — /calculate only
            // aggregates these plus adds shipping_charge.
            const mrp       = Number(inv.mrp);
            const salePrice = Number(inv.sale_price);
            const linePrice = salePrice * requestedQty;
            const item_tax  = parseFloat((linePrice * taxRate).toFixed(2));
            const item_discount = Math.max(0, parseFloat(((mrp - salePrice) * requestedQty).toFixed(2)));
            const item_final    = parseFloat((linePrice + item_tax).toFixed(2));

            subtotal      += linePrice;
            total_tax      += item_tax;
            total_discount += item_discount;

            checkoutLines.push({
                cart_item_id:      row.cart_item_id,
                quote_id:          row.quote_id ?? null,
                quote_item_id:     row.quote_item_id ?? null,
                quote_type_id:     row.quote_type_id ?? null,
                product_id:        row.product_id,
                seller_id:         row.seller_id,
                warehouse_id:      row.warehouse_id,
                warehouse_type_id: row.warehouse_type_id,
                product_name:      row.product_name,
                sku:               row.sku,
                quantity:          requestedQty,
                unit_price:        salePrice,
                tax_code:          taxCodeId,
                tax_amount:        item_tax,
                discount_amount:   item_discount,
                final_price:       item_final,
            });
        }

        const reservation_expires_at = new Date(
            now.getTime() + commonenum.TIME_DURATION_MINUTES.CHECKOUT_RESERVATION_EXPIRY * 60 * 1000
        );

        // --------------------------------------------------
        // 8. INSERT checkout_details header
        //    subtotal / tax_amount / discount_amount = rollup of the
        //    locked item-level values above (final, won't change).
        //    shipping_charge and grand_total are set to 0 here — they
        //    are populated only by POST /checkout/{id}/calculate, once
        //    an address (and therefore a shipping zone) is known.
        //    checkout_status_id = 'INT' (INITIATED) is the source of
        //    truth for "not yet calculated" — not the 0 value itself.
        // --------------------------------------------------
        const checkoutInsert = await client.query({
            text: `INSERT INTO public.checkout_details (
                        buyer_id, checkout_number, checkout_status_id, checkout_type_id,
                        subtotal, tax_amount, shipping_charge, discount_amount, grand_total,
                        payment_status_id, reservation_expires_at, notes,
                        assigned_to, assigned_at, created_by
                   ) VALUES (
                        $1, $2, $3, $4,
                        $5, $6, $7, $8, $9,
                        $10, $11, $12,
                        $13, $14, $15
                   )
                   RETURNING checkout_id, checkout_uuid`,
            values: [
                buyer_id,
                checkout_number,
                initiated_status_id,
                checkout_type_id,
                parseFloat(subtotal.toFixed(2)),
                parseFloat(total_tax.toFixed(2)),
                0,
                parseFloat(total_discount.toFixed(2)),
                0,
                pending_payment_status_id,
                reservation_expires_at,
                notes?.trim() || null,
                assigned_to,
                assigned_at,
                created_by,
            ],
        });

        const { checkout_id, checkout_uuid } = checkoutInsert.rows[0];

        // --------------------------------------------------
        // 9. INSERT checkout_items + UPDATE source cart_details
        //    NOTE: buyer_id column/FK no longer exists on
        //    checkout_items — buyer is reachable via
        //    checkout_id -> checkout_details.buyer_id.
        // --------------------------------------------------
        for (const line of checkoutLines) {
            await client.query({
                text: `INSERT INTO public.checkout_items (
                            checkout_id, cart_item_id, quote_id, quote_item_id, quote_type_id,
                            product_id, seller_id, warehouse_id, warehouse_type_id,
                            product_name, sku, quantity, unit_price, tax_code,
                            tax_amount, discount_amount, final_price, checkout_item_status_id,
                            assigned_to, assigned_at, created_by
                       ) VALUES (
                            $1, $2, $3, $4, $5,
                            $6, $7, $8, $9,
                            $10, $11, $12, $13, $14,
                            $15, $16, $17, $18,
                            $19, $20, $21
                       )`,
                values: [
                    checkout_id,
                    line.cart_item_id,
                    line.quote_id,
                    line.quote_item_id,
                    line.quote_type_id,
                    line.product_id,
                    line.seller_id,
                    line.warehouse_id,
                    line.warehouse_type_id,
                    line.product_name,
                    line.sku,
                    line.quantity,
                    line.unit_price,
                    line.tax_code,
                    line.tax_amount,
                    line.discount_amount,
                    line.final_price,
                    validated_item_status_id,
                    assigned_to,
                    assigned_at,
                    created_by,
                ],
            });

            await client.query({
                text: `UPDATE public.cart_details SET
                            cart_item_status_id    = $1,
                            reservation_expires_at = $2,
                            modified_at             = $3,
                            modified_by             = $4
                       WHERE cart_item_id = $5
                         AND is_deleted   = FALSE`,
                values: [checked_out_cart_status_id, reservation_expires_at, now, created_by, line.cart_item_id],
            });
        }

        // --------------------------------------------------
        // 10. INSERT checkout_service_charges (optional)
        //     charge_amount stored is the FINAL computed value:
        //       PERCENTAGE -> charge_value% of payload's base charge_amount
        //                     e.g. charge_value=5, charge_amount=1000 -> stored 50.00
        //       FIXED      -> charge_value used directly as the amount
        //     Does NOT touch checkout_details.subtotal/grand_total —
        //     that rollup happens later in /checkout/{id}/calculate.
        // --------------------------------------------------
        const appliedServiceCharges = [];

        for (const sc of serviceCharges) {
            const normalizedType    = sc.charge_type.trim().toUpperCase();
            const service_charge_id = serviceChargeIdMap.get(sc.service_charge_uuid.trim());
            const chargeValue       = Number(sc.charge_value);

            const computedChargeAmount = normalizedType === "PERCENTAGE"
                ? parseFloat(((chargeValue / 100) * Number(sc.charge_amount)).toFixed(2))
                : parseFloat(chargeValue.toFixed(2));

            const scInsert = await client.query({
                text: `INSERT INTO public.checkout_service_charges (
                            checkout_id, service_charge_id, charge_type, charge_value, charge_amount,
                            assigned_to, assigned_at, created_by
                       ) VALUES (
                            $1, $2, $3, $4, $5,
                            $6, $7, $8
                       )
                       RETURNING checkout_service_charge_id, checkout_service_charge_uuid`,
                values: [
                    checkout_id,
                    service_charge_id,
                    normalizedType,
                    chargeValue,
                    computedChargeAmount,
                    assigned_to,
                    assigned_at,
                    created_by,
                ],
            });

            appliedServiceCharges.push({
                checkout_service_charge_id:   scInsert.rows[0].checkout_service_charge_id,
                checkout_service_charge_uuid: scInsert.rows[0].checkout_service_charge_uuid,
                service_charge_uuid:          sc.service_charge_uuid.trim(),
                charge_type:                  normalizedType,
                charge_value:                 chargeValue,
                charge_amount:                computedChargeAmount,
            });
        }

        const total_service_charge = parseFloat(
            appliedServiceCharges.reduce((sum, sc) => sum + sc.charge_amount, 0).toFixed(2)
        );

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 11. SUCCESS RESPONSE
        //     shipping_charge / grand_total are 0 here — the client
        //     must call /checkout/{id}/calculate (after address
        //     selection) to get the final payable amount.
        //     total_service_charge is informational only at this
        //     stage — /calculate is responsible for folding it into
        //     grand_total alongside shipping_charge.
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Checkout session initiated successfully",
            data: {
                checkout_id,
                checkout_uuid,
                checkout_number,
                checkout_status_id: initiated_status_id,
                checkout_type_id,
                subtotal:          parseFloat(subtotal.toFixed(2)),
                tax_amount:        parseFloat(total_tax.toFixed(2)),
                discount_amount:   parseFloat(total_discount.toFixed(2)),
                shipping_charge:   0, // set by /checkout/{id}/calculate
                grand_total:       0, // set by /checkout/{id}/calculate
                payment_status_id: pending_payment_status_id,
                reservation_expires_at,
                item_count:        checkoutLines.length,
                items:             checkoutLines,
                service_charges:       appliedServiceCharges,
                total_service_charge,
                created_at:        now,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (checkout-initiate):", err);
        saveErrorLog({
            api_name:   "checkout-initiate",
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
            message:            "Checkout initiation failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// GET CHECKOUT DETAILS
// --------------------------------------------------

 
responder.on("get-checkout-details", async (req, cb) => {
    try {
        const { checkout_uuid, buyer_uuid } = req.body;
 
        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!checkout_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "checkout uuid is required" });
 
        // --------------------------------------------------
        // 2. RESOLVE buyer_id (optional — ownership check)
        // --------------------------------------------------
        let buyer_id = null;
 
        if (buyer_uuid?.trim()) {
            const buyerResult = await pool.query({
                text: `SELECT buyer_id
                       FROM public.buyer_accounts
                       WHERE buyer_uuid = $1
                         AND is_deleted = FALSE
                         AND is_active  = TRUE
                         AND phone_number_verified = TRUE`,
                values: [buyer_uuid.trim()],
            });
 
            if (buyerResult.rowCount === 0)
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });
 
            buyer_id = buyerResult.rows[0].buyer_id;
        }
 
        // --------------------------------------------------
        // 3. FETCH CHECKOUT HEADER (status / address / payment)
        // --------------------------------------------------
        const checkoutResult = await pool.query({
            text: `SELECT
                        cd.checkout_id,
                        cd.checkout_uuid,
                        cd.buyer_id,
                        cd.checkout_number,
                        cd.subtotal,
                        cd.tax_amount,
                        cd.shipping_charge,
                        cd.discount_amount,
                        cd.grand_total,
                        cd.reservation_expires_at,
                        cd.notes,
                        cd.created_at,
                        cd.modified_at,
 
                        cs.checkout_status_id,
                        cs.code AS checkout_status_code,
                        cs.name AS checkout_status_name,
 
                        ps.payment_status_id,
                        ps.code AS payment_status_code,
                        ps.name AS payment_status_name,
 
                        pm.payment_method_id,
                        pm.code AS payment_method_code,
                        pm.name AS payment_method_name,
 
                        aa.address_id,
                        aa.address_uuid,
                        aa.address_type_id,
                        aa.address_line1,
                        aa.address_line2,
                        aa.display_name,
                        aa.phone_number,
                        aa.country_code,
                        aa.is_phone_verified,
                        aa.map_address,
                        aa.googlemap_link,
                        aa.latitude,
                        aa.longitude,
 
                        ctry.country_id,
                        ctry.name AS country_name,
 
                        st.state_id,
                        st.name AS state_name,
 
                        cty.city_id,
                        cty.name AS city_name
 
                   FROM public.checkout_details cd
                   JOIN public.checkout_status cs
                     ON cs.checkout_status_id = cd.checkout_status_id
                   LEFT JOIN public.payment_statuses ps
                     ON ps.payment_status_id = cd.payment_status_id
                   LEFT JOIN public.payment_method pm
                     ON pm.payment_method_id = cd.payment_method_id
                   LEFT JOIN public.account_addresses aa
                     ON aa.address_id = cd.address_id
                    AND aa.is_deleted = FALSE
                   LEFT JOIN public.countries ctry
                     ON ctry.country_id = aa.country_id
                   LEFT JOIN public.states st
                     ON st.state_id = aa.state_id
                   LEFT JOIN public.cities cty
                     ON cty.city_id = aa.city
                   WHERE cd.checkout_uuid = $1
                     AND cd.is_deleted    = FALSE`,
            values: [checkout_uuid.trim()],
        });
 
        if (checkoutResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No checkout found for the provided UUID" });
 
        const checkout = checkoutResult.rows[0];
 
 
        // --------------------------------------------------
        // 4. OWNERSHIP CHECK (only if buyer_uuid was passed)
        // --------------------------------------------------
        if (buyer_id !== null && Number(checkout.buyer_id) !== Number(buyer_id))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "This checkout does not belong to the provided buyer" });
 
        // --------------------------------------------------
        // 5. FETCH CHECKOUT ITEMS
        // --------------------------------------------------
        const itemsResult = await pool.query({
            text: `SELECT
                        ci.checkout_item_id,
                        ci.checkout_item_uuid,
                        ci.cart_item_id,
                        ci.product_id,
                        ci.seller_id,
                        ci.warehouse_id,
                        ci.warehouse_type_id,
                        ci.product_name,
                        ci.sku,
                        ci.quantity,
                        ci.unit_price,
                        ci.tax_code,
                        ci.tax_amount,
                        ci.discount_amount,
                        ci.final_price,
 
                        cis.checkout_item_status_id,
                        cis.code AS checkout_item_status_code,
                        cis.name AS checkout_item_status_name
 
                   FROM public.checkout_items ci
                   JOIN public.checkout_item_status cis
                     ON cis.checkout_item_status_id = ci.checkout_item_status_id
                   WHERE ci.checkout_id = $1
                     AND ci.is_deleted  = FALSE
                   ORDER BY ci.checkout_item_id ASC`,
            values: [checkout.checkout_id],
        });
 
        const items = itemsResult.rows.map((row) => ({
            checkout_item_id:   row.checkout_item_id,
            checkout_item_uuid: row.checkout_item_uuid,
            cart_item_id:       row.cart_item_id,
            product_id:         row.product_id,
            seller_id:          row.seller_id,
            warehouse_id:       row.warehouse_id,
            warehouse_type_id:  row.warehouse_type_id,
            product_name:       row.product_name,
            sku:                row.sku,
            quantity:           Number(row.quantity),
            unit_price:         Number(row.unit_price),
            tax_code:           row.tax_code,
            tax_amount:         Number(row.tax_amount),
            discount_amount:    Number(row.discount_amount),
            final_price:        Number(row.final_price),
            status: {
                checkout_item_status_id: row.checkout_item_status_id,
                code:                    row.checkout_item_status_code,
                name:                    row.checkout_item_status_name,
            },
        }));
 
        // --------------------------------------------------
        // 5b. FETCH ACTIVE SERVICE CHARGES
        //     is_active = FALSE means the charge was voided
        //     (e.g. checkout was cancelled) — excluded here so
        //     the buyer-facing view only shows what's currently
        //     payable.
        // --------------------------------------------------
        const serviceChargesResult = await pool.query({
            text: `SELECT
                        csc.checkout_service_charge_id,
                        csc.checkout_service_charge_uuid,
                        csc.service_charge_id,
                        sc.service_charge_uuid,
                        sc.name AS service_charge_name,
                        csc.charge_type,
                        csc.charge_value,
                        csc.charge_amount
 
                   FROM public.checkout_service_charges csc
                   JOIN public.service_charge sc
                     ON sc.service_charge_id = csc.service_charge_id
                   WHERE csc.checkout_id = $1
                     AND csc.is_active   = TRUE
                     AND csc.is_deleted  = FALSE
                   ORDER BY csc.checkout_service_charge_id ASC`,
            values: [checkout.checkout_id],
        });
 
        const service_charges = serviceChargesResult.rows.map((row) => ({
            checkout_service_charge_id:   row.checkout_service_charge_id,
            checkout_service_charge_uuid: row.checkout_service_charge_uuid,
            service_charge_uuid:          row.service_charge_uuid,
            service_charge_name:          row.service_charge_name,
            charge_type:                  row.charge_type,
            charge_value:                 Number(row.charge_value),
            charge_amount:                Number(row.charge_amount),
        }));
 
        const total_service_charge = parseFloat(
            service_charges.reduce((sum, sc) => sum + sc.charge_amount, 0).toFixed(2)
        );
 
        // --------------------------------------------------
        // 6. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Checkout details fetched successfully",
            data: {
                checkout_id:     checkout.checkout_id,
                checkout_uuid:   checkout.checkout_uuid,
                checkout_number: checkout.checkout_number,
 
                checkout_status: {
                    checkout_status_id: checkout.checkout_status_id,
                    code:                checkout.checkout_status_code,
                    name:                checkout.checkout_status_name,
                },
 
                address: checkout.address_id ? {
                    address_id:        checkout.address_id,
                    address_uuid:      checkout.address_uuid,
                    address_type_id:   checkout.address_type_id,
                    address_line1:     checkout.address_line1,
                    address_line2:     checkout.address_line2,
                    display_name:      checkout.display_name,
                    phone_number:      checkout.phone_number,
                    country_code:      checkout.country_code,
                    is_phone_verified: checkout.is_phone_verified,
                    map_address:       checkout.map_address,
                    googlemap_link:    checkout.googlemap_link,
                    latitude:          checkout.latitude,
                    longitude:         checkout.longitude,
                    country: checkout.country_id ? {
                        country_id: checkout.country_id,
                        name:       checkout.country_name,
                    } : null,
                    state: checkout.state_id ? {
                        state_id: checkout.state_id,
                        name:     checkout.state_name,
                    } : null,
                    city: checkout.city_id ? {
                        city_id: checkout.city_id,
                        name:    checkout.city_name,
                    } : null,
                } : null,
 
                amount_summary: {
                    subtotal:            Number(checkout.subtotal),
                    tax_amount:          Number(checkout.tax_amount),
                    shipping_charge:     Number(checkout.shipping_charge),
                    discount_amount:     Number(checkout.discount_amount),
                    total_service_charge,
                    grand_total:         Number(checkout.grand_total),
                },
 
                service_charges,
 
                payment_status: checkout.payment_status_id ? {
                    payment_status_id: checkout.payment_status_id,
                    code:               checkout.payment_status_code,
                    name:               checkout.payment_status_name,
                } : null,
 
                payment_method: checkout.payment_method_id ? {
                    payment_method_id: checkout.payment_method_id,
                    code:               checkout.payment_method_code,
                    name:               checkout.payment_method_name,
                } : null,
 
                reservation_expires_at: checkout.reservation_expires_at,
                notes:                  checkout.notes,
                item_count:             items.length,
                items,
                created_at:  checkout.created_at,
                modified_at: checkout.modified_at,
            },
        });
 
    } catch (err) {
        logger.error("Responder Error (get-checkout-details):", err);
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
// CHECKOUT ADDRESS UPDATE
// --------------------------------------------------


responder.on("checkout-update-address", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const {
            checkout_uuid,
            buyer_uuid,
            address_uuid,
            modified_by,
        } = req.body;

        const now = new Date();

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!checkout_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "checkout uuid is required" });

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        if (!address_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "address uuid is required" });

        if (!modified_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "modified by is required" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // --------------------------------------------------
        // 3. RESOLVE address_id — must belong to this buyer
        //    account_type_id = 2 (buyer), address_type_id = 1
        //    (shipping address only — checkout delivery address
        //    cannot be a billing or pickup address).
        // --------------------------------------------------
        const addressCheck = await pool.query(
            `SELECT address_id
             FROM public.account_addresses
             WHERE address_uuid    = $1
               AND account_type_id = 1
               AND account_id      = $2
               AND address_type_id = 1
               AND is_active       = TRUE
               AND is_deleted      = FALSE`,
            [address_uuid.trim(), buyer_id]
        );

        if (addressCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active shipping address found for this buyer with the provided UUID" });

        const address_id = addressCheck.rows[0].address_id;

        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 4. LOCK + VALIDATE checkout ownership/status
        // --------------------------------------------------
        const checkoutResult = await client.query({
            text: `SELECT cd.checkout_id, cd.checkout_status_id, cs.code AS status_code
                   FROM public.checkout_details cd
                   JOIN public.checkout_status cs
                     ON cs.checkout_status_id = cd.checkout_status_id
                   WHERE cd.checkout_uuid = $1
                     AND cd.buyer_id      = $2
                     AND cd.is_deleted    = FALSE
                   FOR UPDATE`,
            values: [checkout_uuid.trim(), buyer_id],
        });

        if (checkoutResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No checkout found for this buyer with the provided UUID" });
        }

        const checkoutRow = checkoutResult.rows[0];

        // Address can be selected/changed any time before payment
        // has begun (INT/CVD = not yet touched; ADS = already
        // selected once; CLC = calculated, but re-selecting here
        // forces a recalculation).
        const EDITABLE_CHECKOUT_STATUS_CODES = ["INT", "CVD", "ADS", "CLC"];

        if (!EDITABLE_CHECKOUT_STATUS_CODES.includes(checkoutRow.status_code)) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Address cannot be changed once checkout status is '${checkoutRow.status_code}'`,
            });
        }

        // Resolve 'ADS' (ADDRESS_SELECTED) — this is always the
        // target status after an address update, regardless of
        // whether this is the first selection or a re-selection.
        const addressSelectedStatusResult = await client.query(
            `SELECT checkout_status_id FROM public.checkout_status WHERE code = 'ADS' AND is_active = TRUE AND is_deleted = FALSE`
        );

        if (addressSelectedStatusResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            logger.error("checkout-update-address: missing master data — checkout_status(ADS)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const address_selected_status_id = addressSelectedStatusResult.rows[0].checkout_status_id;

        // If the checkout was already calculated ('CLC'), changing
        // the address invalidates shipping_charge/grand_total since
        // they are zone-dependent. Reset both to NULL — status moves
        // to 'ADS' regardless of where it came from, so /calculate
        // must be called again before this checkout can proceed.
        const resetTotals = checkoutRow.status_code === "CLC";

        // --------------------------------------------------
        // 5. UPDATE checkout address (+ conditional totals reset)
        // --------------------------------------------------
        const updateResult = await client.query({
            text: resetTotals
                ? `UPDATE public.checkout_details SET
                        address_id          = $1,
                        shipping_charge      = 0,
                        grand_total          = 0,
                        checkout_status_id  = $2,
                        modified_at          = $3,
                        modified_by          = $4
                   WHERE checkout_id = $5
                   RETURNING checkout_id, checkout_uuid, checkout_number, address_id,
                             checkout_status_id, subtotal, tax_amount, shipping_charge,
                             discount_amount, grand_total`
                : `UPDATE public.checkout_details SET
                        address_id          = $1,
                        checkout_status_id  = $2,
                        modified_at          = $3,
                        modified_by          = $4
                   WHERE checkout_id = $5
                   RETURNING checkout_id, checkout_uuid, checkout_number, address_id,
                             checkout_status_id, subtotal, tax_amount, shipping_charge,
                             discount_amount, grand_total`,
            values: [address_id, address_selected_status_id, now, modified_by, checkoutRow.checkout_id],
        });

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 6. RESOLVE FULL ADDRESS FOR RESPONSE
        // --------------------------------------------------
        const addressDetail = await pool.query(
            `SELECT
                aa.address_id,
                aa.address_uuid,
                aa.address_type_id,
                aa.address_line1,
                aa.address_line2,
                aa.display_name,
                aa.phone_number,
                aa.country_code,
                aa.latitude,
                aa.longitude,
                co.country_id,
                co.name AS country_name,
                st.state_id,
                st.name AS state_name,
                ci.city_id,
                ci.name AS city_name
             FROM public.account_addresses aa
             LEFT JOIN public.countries co ON co.country_id = aa.country_id
             LEFT JOIN public.states st ON st.state_id = aa.state_id
             LEFT JOIN public.cities ci ON ci.city_id = aa.city
             WHERE aa.address_id = $1`,
            [address_id]
        );

        const updated = updateResult.rows[0];

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            resetTotals
                ? "Address updated. Checkout totals were reset — please call /calculate again."
                : "Checkout address updated successfully",
            data: {
                checkout_id:        updated.checkout_id,
                checkout_uuid:      updated.checkout_uuid,
                checkout_number:    updated.checkout_number,
                checkout_status_id: updated.checkout_status_id,
                subtotal:           updated.subtotal,
                tax_amount:         updated.tax_amount,
                shipping_charge:    updated.shipping_charge,   // 0 if reset
                discount_amount:    updated.discount_amount,
                grand_total:        updated.grand_total,       // 0 if reset
                address:            addressDetail.rows[0] || null,
                recalculation_required: resetTotals,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (checkout-update-address):", err);
        saveErrorLog({
            api_name:   "checkout-update-address",
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
            message:            "Checkout address update failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// CHECKOUT PAYMENT_METHOD UPDATE
// --------------------------------------------------


responder.on("checkout-update-payment-method", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const {
            checkout_uuid,
            buyer_uuid,
            payment_method_uuid,   // currently only WALLET's uuid is valid
            modified_by,
        } = req.body;

        const now = new Date();

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!checkout_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "checkout uuid is required" });

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        if (!payment_method_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "payment method uuid is required" });

        if (!modified_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "modified by is required" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // --------------------------------------------------
        // 3. RESOLVE payment_method_id via UUID
        // --------------------------------------------------
        const paymentMethodCheck = await pool.query(
            `SELECT payment_method_id, code
             FROM public.payment_method
             WHERE payment_method_uuid = $1
               AND is_active           = TRUE
               AND is_deleted          = FALSE`,
            [payment_method_uuid.trim()]
        );

        if (paymentMethodCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active payment method found with the provided UUID" });

        const payment_method_id   = paymentMethodCheck.rows[0].payment_method_id;
        const payment_method_code = paymentMethodCheck.rows[0].code;

        // --------------------------------------------------
        // 3b. WALLET-ONLY CHECK
        //     WALLET is currently the only supported payment
        //     method on this platform. Reject anything else
        //     early, and confirm the buyer actually has an
        //     active wallet account before letting them select it.
        //     NOTE: confirm the buyer-reference column name on
        //     wallet_accounts — assumed "buyer_id" here based on
        //     the wallet module built earlier.
        // --------------------------------------------------
        if (payment_method_code !== "WLT")
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              "Only WALLET is currently supported as a payment method",
            });

        const walletCheck = await pool.query(
            `SELECT wallet_id
             FROM public.wallet_accounts
             WHERE buyer_id   = $1
               AND is_active  = TRUE
               AND is_deleted = FALSE`,
            [buyer_id]
        );

        if (walletCheck.rowCount === 0)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active wallet account found for this buyer",
            });

        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 4. LOCK + VALIDATE checkout ownership/status
        // --------------------------------------------------
        const checkoutResult = await client.query({
            text: `SELECT cd.checkout_id, cd.checkout_status_id, cs.code AS status_code
                   FROM public.checkout_details cd
                   JOIN public.checkout_status cs
                     ON cs.checkout_status_id = cd.checkout_status_id
                   WHERE cd.checkout_uuid = $1
                     AND cd.buyer_id      = $2
                     AND cd.is_deleted    = FALSE
                   FOR UPDATE`,
            values: [checkout_uuid.trim(), buyer_id],
        });

        if (checkoutResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No checkout found for this buyer with the provided UUID" });
        }

        const checkoutRow = checkoutResult.rows[0];

        const EDITABLE_CHECKOUT_STATUS_CODES = ["INT", "CVD", "ADS", "CLC"];

        if (!EDITABLE_CHECKOUT_STATUS_CODES.includes(checkoutRow.status_code)) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Payment method cannot be changed once checkout status is '${checkoutRow.status_code}'`,
            });
        }

        // --------------------------------------------------
        // 5. UPDATE checkout payment method
        //    Does NOT touch totals or checkout_status —
        //    payment method choice doesn't affect pricing.
        // --------------------------------------------------
        const updateResult = await client.query({
            text: `UPDATE public.checkout_details SET
                        payment_method_id = $1,
                        modified_at        = $2,
                        modified_by        = $3
                   WHERE checkout_id = $4
                   RETURNING checkout_id, checkout_uuid, checkout_number, payment_method_id,
                             payment_status_id, checkout_status_id, subtotal, tax_amount,
                             shipping_charge, discount_amount, grand_total`,
            values: [payment_method_id, now, modified_by, checkoutRow.checkout_id],
        });

        await client.query("COMMIT");
        inTransaction = false;

        const updated = updateResult.rows[0];

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Checkout payment method updated successfully",
            data: {
                checkout_id:         updated.checkout_id,
                checkout_uuid:       updated.checkout_uuid,
                checkout_number:     updated.checkout_number,
                payment_method_id:   updated.payment_method_id,
                payment_method_uuid: payment_method_uuid.trim(),
                payment_method_code: payment_method_code,
                payment_status_id:   updated.payment_status_id,
                checkout_status_id:  updated.checkout_status_id,
                subtotal:            updated.subtotal,
                tax_amount:          updated.tax_amount,
                shipping_charge:     updated.shipping_charge,
                discount_amount:     updated.discount_amount,
                grand_total:         updated.grand_total,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (checkout-update-payment-method):", err);
        saveErrorLog({
            api_name:   "checkout-update-payment-method",
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
            message:            "Checkout payment method update failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});


// --------------------------------------------------
// CHECKOUT CALCULATE
// --------------------------------------------------

responder.on("checkout-calculate", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;
 
    try {
        const {
            checkout_uuid,
            buyer_uuid,
            modified_by,
        } = req.body;
 
        const now = new Date();
 
        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!checkout_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "checkout uuid is required" });
 
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });
 
        if (!modified_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "modified by is required" });
 
        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );
 
        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });
 
        const buyer_id = buyerCheck.rows[0].buyer_id;
 
        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;
 
        // --------------------------------------------------
        // 3. LOCK + VALIDATE checkout ownership/status
        //    /calculate can be called from 'INT' (first time)
        //    or 'CLC' (recalculating after e.g. an address
        //    change reset it back to INT — so realistically
        //    it will always be INT here, but CLC is allowed
        //    too in case a client double-calls this endpoint).
        // --------------------------------------------------
        const checkoutResult = await client.query({
            text: `SELECT cd.checkout_id, cd.checkout_status_id, cs.code AS status_code,
                          cd.address_id, cd.subtotal, cd.tax_amount, cd.discount_amount,
                          cd.reservation_expires_at
                   FROM public.checkout_details cd
                   JOIN public.checkout_status cs
                     ON cs.checkout_status_id = cd.checkout_status_id
                   WHERE cd.checkout_uuid = $1
                     AND cd.buyer_id      = $2
                     AND cd.is_deleted    = FALSE
                   FOR UPDATE`,
            values: [checkout_uuid.trim(), buyer_id],
        });
 
        if (checkoutResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No checkout found for this buyer with the provided UUID" });
        }
 
        const checkoutRow = checkoutResult.rows[0];
 
        if (!["ADS", "CLC"].includes(checkoutRow.status_code)) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Checkout cannot be calculated while status is '${checkoutRow.status_code}'`,
            });
        }
 
        if (!checkoutRow.address_id) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "A shipping address must be selected before calculating the checkout",
            });
        }
 
        if (checkoutRow.reservation_expires_at && new Date(checkoutRow.reservation_expires_at) < now) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Checkout session expired",
                error:              "This checkout session has expired. Please reinitiate checkout.",
            });
        }
 
        // --------------------------------------------------
        // 4. RESOLVE 'CLC' status
        // --------------------------------------------------
        const calculatedStatusResult = await client.query(
            `SELECT checkout_status_id FROM public.checkout_status WHERE code = 'CLC' AND is_active = TRUE AND is_deleted = FALSE`
        );
 
        if (calculatedStatusResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            logger.error("checkout-calculate: missing master data — checkout_status(CLC)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }
 
        const calculated_status_id = calculatedStatusResult.rows[0].checkout_status_id;
 
        // --------------------------------------------------
        // 5. SHIPPING CHARGE — placeholder
        //    TODO: replace with a call to the 3rd-party shipping
        //    rate API once integrated (address_id -> zone -> rate).
        //    Kept at 0 for now, but computed here as its own step
        //    so plugging in the real calculation later only
        //    touches this block.
        // --------------------------------------------------
        const shipping_charge = 0;
 
        // --------------------------------------------------
        // 5b. TOTAL ACTIVE SERVICE CHARGES
        //     Locked at /checkout/initiate — this just sums
        //     what's already in checkout_service_charges for
        //     this checkout_id. Excludes rows voided by a
        //     cancel (is_active = FALSE).
        // --------------------------------------------------
        const serviceChargeSumResult = await client.query({
            text: `SELECT COALESCE(SUM(charge_amount), 0) AS total_service_charge
                   FROM public.checkout_service_charges
                   WHERE checkout_id = $1
                     AND is_active   = TRUE
                     AND is_deleted  = FALSE`,
            values: [checkoutRow.checkout_id],
        });
 
        const total_service_charge = parseFloat(
            Number(serviceChargeSumResult.rows[0].total_service_charge).toFixed(2)
        );
 
        // subtotal / tax_amount / discount_amount were locked at
        // /checkout/initiate and are NOT recomputed here — they
        // reflect the unit_price snapshot taken at that time.
        const subtotal        = Number(checkoutRow.subtotal);
        const tax_amount       = Number(checkoutRow.tax_amount);
        const discount_amount  = Number(checkoutRow.discount_amount);
 
        const grand_total = parseFloat(
            (subtotal + tax_amount + shipping_charge + total_service_charge).toFixed(2)
        );
 
        // --------------------------------------------------
        // 6. UPDATE checkout_details
        // --------------------------------------------------
        const updateResult = await client.query({
            text: `UPDATE public.checkout_details SET
                        shipping_charge     = $1,
                        grand_total          = $2,
                        checkout_status_id  = $3,
                        modified_at          = $4,
                        modified_by          = $5
                   WHERE checkout_id = $6
                   RETURNING checkout_id, checkout_uuid, checkout_number, checkout_status_id,
                             subtotal, tax_amount, shipping_charge, discount_amount, grand_total`,
            values: [shipping_charge, grand_total, calculated_status_id, now, modified_by, checkoutRow.checkout_id],
        });
 
        await client.query("COMMIT");
        inTransaction = false;
 
        const updated = updateResult.rows[0];
 
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Checkout calculated successfully",
            data: {
                checkout_id:        updated.checkout_id,
                checkout_uuid:      updated.checkout_uuid,
                checkout_number:    updated.checkout_number,
                checkout_status_id: updated.checkout_status_id,
                subtotal:           updated.subtotal,
                tax_amount:         updated.tax_amount,
                shipping_charge:    updated.shipping_charge,
                discount_amount:    updated.discount_amount,
                total_service_charge,
                grand_total:        updated.grand_total,
            },
        });
 
    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (checkout-calculate):", err);
        saveErrorLog({
            api_name:   "checkout-calculate",
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
            message:            "Checkout calculation failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// CHECKOUT CONFIRM
// --------------------------------------------------

responder.on("checkout-confirm", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const {
            checkout_uuid,
            buyer_uuid,
            modified_by,
        } = req.body;

        const now = new Date();

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!checkout_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "checkout uuid is required" });

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        if (!modified_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "modified by is required" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 3. LOCK + VALIDATE checkout ownership/status
        //    Must be 'CLC' (calculated). address_id and
        //    payment_method_id must both be set.
        // --------------------------------------------------
        const checkoutResult = await client.query({
            text: `SELECT cd.checkout_id, cd.checkout_status_id, cs.code AS status_code,
                          cd.address_id, cd.payment_method_id, cd.reservation_expires_at,
                          cd.grand_total
                   FROM public.checkout_details cd
                   JOIN public.checkout_status cs
                     ON cs.checkout_status_id = cd.checkout_status_id
                   WHERE cd.checkout_uuid = $1
                     AND cd.buyer_id      = $2
                     AND cd.is_deleted    = FALSE
                   FOR UPDATE`,
            values: [checkout_uuid.trim(), buyer_id],
        });

        if (checkoutResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No checkout found for this buyer with the provided UUID" });
        }

        const checkoutRow = checkoutResult.rows[0];

        if (checkoutRow.status_code !== "CLC") {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Checkout must be calculated ('CLC') before confirming. Current status: '${checkoutRow.status_code}'`,
            });
        }

        if (!checkoutRow.address_id) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Shipping address is not set on this checkout" });
        }

        if (!checkoutRow.payment_method_id) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Payment method is not set on this checkout" });
        }

        if (checkoutRow.reservation_expires_at && new Date(checkoutRow.reservation_expires_at) < now) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Checkout session expired", error: "This checkout session has expired. Please reinitiate checkout." });
        }

        // --------------------------------------------------
        // 4. FETCH checkout_items for stock re-validation
        // --------------------------------------------------
        const itemsResult = await client.query({
            text: `SELECT checkout_item_id, product_id, seller_id, warehouse_id, quantity, product_name
                   FROM public.checkout_items
                   WHERE checkout_id = $1
                     AND is_deleted  = FALSE`,
            values: [checkoutRow.checkout_id],
        });

        if (itemsResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No items found on this checkout" });
        }

        // --------------------------------------------------
        // 5. RE-VALIDATE STOCK + HARD-RESERVE
        //    This is now the point where reserved_qty is
        //    actually incremented — items move to 'RES'
        //    (RESERVED) here, ahead of payment, so stock is
        //    locked in while the buyer completes payment.
        // --------------------------------------------------
        for (const item of itemsResult.rows) {
            const invResult = await client.query({
                text: `SELECT inventory_id, onhand_qty, reserved_qty, buffer_qty
                       FROM public.seller_inventory
                       WHERE product_id   = $1
                         AND seller_id    = $2
                         AND warehouse_id = $3
                         AND is_deleted   = FALSE
                         AND is_active    = TRUE
                       FOR UPDATE`,
                values: [item.product_id, item.seller_id, item.warehouse_id],
            });

            if (invResult.rowCount === 0) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: `Inventory no longer available for ${item.product_name}` });
            }

            const inv = invResult.rows[0];
            const netAvailable = Number(inv.onhand_qty) - Number(inv.reserved_qty) - Number(inv.buffer_qty);

            if (Number(item.quantity) > netAvailable) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2007,
                    message:            "Insufficient stock",
                    error:              `Only ${Math.max(netAvailable, 0)} units are now available for ${item.product_name}`,
                });
            }

            await client.query({
                text: `UPDATE public.seller_inventory SET
                            reserved_qty = reserved_qty + $1,
                            modified_at   = $2,
                            modified_by   = $3
                       WHERE inventory_id = $4`,
                values: [item.quantity, now, modified_by, inv.inventory_id],
            });
        }

        // --------------------------------------------------
        // 6. RESOLVE 'PPN' (PAYMENT_PENDING) + 'RES' (RESERVED)
        // --------------------------------------------------
        const [paymentPendingStatusResult, reservedItemStatusResult] = await Promise.all([
            client.query(`SELECT checkout_status_id FROM public.checkout_status WHERE code = 'PPN' AND is_active = TRUE AND is_deleted = FALSE`),
            client.query(`SELECT checkout_item_status_id FROM public.checkout_item_status WHERE code = 'RES' AND is_active = TRUE AND is_deleted = FALSE`),
        ]);

        if (paymentPendingStatusResult.rowCount === 0 || reservedItemStatusResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            logger.error("checkout-confirm: missing master data — checkout_status(PPN)/checkout_item_status(RES)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const payment_pending_status_id = paymentPendingStatusResult.rows[0].checkout_status_id;
        const reserved_item_status_id   = reservedItemStatusResult.rows[0].checkout_item_status_id;

        const updateResult = await client.query({
            text: `UPDATE public.checkout_details SET
                        checkout_status_id = $1,
                        modified_at         = $2,
                        modified_by         = $3
                   WHERE checkout_id = $4
                   RETURNING checkout_id, checkout_uuid, checkout_number, checkout_status_id,
                             payment_method_id, payment_status_id, grand_total`,
            values: [payment_pending_status_id, now, modified_by, checkoutRow.checkout_id],
        });

        await client.query({
            text: `UPDATE public.checkout_items SET
                        checkout_item_status_id = $1,
                        modified_at              = $2,
                        modified_by              = $3
                   WHERE checkout_id = $4
                     AND is_deleted  = FALSE`,
            values: [reserved_item_status_id, now, modified_by, checkoutRow.checkout_id],
        });

        await client.query("COMMIT");
        inTransaction = false;

        const updated = updateResult.rows[0];

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Checkout confirmed and stock reserved. Proceed to payment.",
            data: {
                checkout_id:        updated.checkout_id,
                checkout_uuid:      updated.checkout_uuid,
                checkout_number:    updated.checkout_number,
                checkout_status_id: updated.checkout_status_id,
                payment_method_id:  updated.payment_method_id,
                payment_status_id:  updated.payment_status_id,
                grand_total:        updated.grand_total,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (checkout-confirm):", err);
        saveErrorLog({
            api_name:   "checkout-confirm",
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
            message:            "Checkout confirmation failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});


// --------------------------------------------------
// CHECKOUT STATUS
// --------------------------------------------------


responder.on("checkout-status", async (req, cb) => {
    try {
        const { checkout_uuid, buyer_uuid } = req.body;
 
        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!checkout_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "checkout uuid is required" });
 
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });
 
        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );
 
        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });
 
        const buyer_id = buyerCheck.rows[0].buyer_id;
 
        // --------------------------------------------------
        // 3. FETCH checkout header + status/payment info
        // --------------------------------------------------
        const checkoutResult = await pool.query(
            `SELECT
                cd.checkout_id,
                cd.checkout_uuid,
                cd.checkout_number,
                cd.subtotal,
                cd.tax_amount,
                cd.shipping_charge,
                cd.discount_amount,
                cd.grand_total,
                cd.reservation_expires_at,
                cd.created_at,
                cd.modified_at,
                cs.checkout_status_id,
                cs.code AS checkout_status_code,
                cs.name AS checkout_status_name,
                ps.payment_status_id,
                ps.code AS payment_status_code,
                ps.name AS payment_status_name,
                pm.payment_method_id,
                pm.code AS payment_method_code,
                pm.name AS payment_method_name
             FROM public.checkout_details cd
             JOIN public.checkout_status cs
               ON cs.checkout_status_id = cd.checkout_status_id
             LEFT JOIN public.payment_statuses ps
               ON ps.payment_status_id = cd.payment_status_id
             LEFT JOIN public.payment_method pm
               ON pm.payment_method_id = cd.payment_method_id
             WHERE cd.checkout_uuid = $1
               AND cd.buyer_id      = $2
               AND cd.is_deleted    = FALSE`,
            [checkout_uuid.trim(), buyer_id]
        );
 
        if (checkoutResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No checkout found for this buyer with the provided UUID" });
 
        const checkout = checkoutResult.rows[0];
 
        // --------------------------------------------------
        // 4. FETCH checkout items with their own status
        // --------------------------------------------------
        const itemsResult = await pool.query(
            `SELECT
                ci.checkout_item_id,
                ci.checkout_item_uuid,
                ci.product_id,
                ci.product_name,
                ci.sku,
                ci.quantity,
                ci.unit_price,
                ci.tax_amount,
                ci.discount_amount,
                ci.final_price,
                cis.code AS item_status_code,
                cis.name AS item_status_name
             FROM public.checkout_items ci
             JOIN public.checkout_item_status cis
               ON cis.checkout_item_status_id = ci.checkout_item_status_id
             WHERE ci.checkout_id = $1
               AND ci.is_deleted  = FALSE
             ORDER BY ci.checkout_item_id`,
            [checkout.checkout_id]
        );
 
        // --------------------------------------------------
        // 4b. TOTAL ACTIVE SERVICE CHARGES
        //     Same as /calculate — sum of currently-active
        //     checkout_service_charges rows for this checkout.
        // --------------------------------------------------
        const serviceChargeSumResult = await pool.query(
            `SELECT COALESCE(SUM(charge_amount), 0) AS total_service_charge
             FROM public.checkout_service_charges
             WHERE checkout_id = $1
               AND is_active   = TRUE
               AND is_deleted  = FALSE`,
            [checkout.checkout_id]
        );
 
        const total_service_charge = parseFloat(
            Number(serviceChargeSumResult.rows[0].total_service_charge).toFixed(2)
        );
 
        // Terminal statuses — reservation_expires_at is no longer
        // meaningful once the checkout has finished its lifecycle
        // (order created, cancelled, or payment permanently failed).
        const isExpired =
            checkout.reservation_expires_at &&
            new Date(checkout.reservation_expires_at) < new Date() &&
            !["ORC", "CAN", "PFL"].includes(checkout.checkout_status_code);
 
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Checkout status fetched successfully",
            data: {
                checkout_id:            checkout.checkout_id,
                checkout_uuid:          checkout.checkout_uuid,
                checkout_number:        checkout.checkout_number,
                checkout_status_id:     checkout.checkout_status_id,
                checkout_status_code:   checkout.checkout_status_code,
                checkout_status_name:   checkout.checkout_status_name,
                payment_status_id:      checkout.payment_status_id,
                payment_status_code:    checkout.payment_status_code,
                payment_status_name:    checkout.payment_status_name,
                payment_method_id:      checkout.payment_method_id,
                payment_method_code:    checkout.payment_method_code,
                payment_method_name:    checkout.payment_method_name,
                subtotal:               checkout.subtotal,
                tax_amount:             checkout.tax_amount,
                shipping_charge:        checkout.shipping_charge,
                discount_amount:        checkout.discount_amount,
                total_service_charge,
                grand_total:            checkout.grand_total,
                reservation_expires_at: checkout.reservation_expires_at,
                is_expired:             isExpired,
                created_at:             checkout.created_at,
                modified_at:            checkout.modified_at,
                item_count:             itemsResult.rowCount,
                items:                  itemsResult.rows,
            },
        });
 
    } catch (err) {
        logger.error("Responder Error (checkout-status):", err);
        saveErrorLog({
            api_name:   "checkout-status",
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
            message:            "Checkout status fetch failed",
            error:              err.message,
        });
    }
});

// --------------------------------------------------
// CHECKOUT CANCEL
// --------------------------------------------------



responder.on("checkout-cancel", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;
 
    try {
        const {
            checkout_uuid,
            buyer_uuid,
            cancel_reason,
            modified_by,
        } = req.body;
 
        const now = new Date();
 
        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!checkout_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "checkout uuid is required" });
 
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });
 
        if (!modified_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "modified by is required" });
 
        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );
 
        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });
 
        const buyer_id = buyerCheck.rows[0].buyer_id;
 
        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;
 
        // --------------------------------------------------
        // 3. LOCK + VALIDATE checkout ownership/status
        //    Cancellable ONLY before payment is attempted —
        //    i.e. INT, CVD, ADS, CLC, PPN. The instant
        //    checkout-payment picks up the row (PPR onward),
        //    cancellation is no longer this API's concern;
        //    any wind-down from PPR/PSC/PFL/ORC is handled
        //    inside checkout-payment / checkout-payment-cancel.
        // --------------------------------------------------
        const checkoutResult = await client.query({
            text: `SELECT cd.checkout_id, cd.checkout_status_id, cs.code AS status_code
                   FROM public.checkout_details cd
                   JOIN public.checkout_status cs
                     ON cs.checkout_status_id = cd.checkout_status_id
                   WHERE cd.checkout_uuid = $1
                     AND cd.buyer_id      = $2
                     AND cd.is_deleted    = FALSE
                   FOR UPDATE`,
            values: [checkout_uuid.trim(), buyer_id],
        });
 
        if (checkoutResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No checkout found for this buyer with the provided UUID" });
        }
 
        const checkoutRow = checkoutResult.rows[0];
 
        const CANCELLABLE_STATUS_CODES = ["INT", "CVD", "ADS", "CLC", "PPN"];
 
        if (!CANCELLABLE_STATUS_CODES.includes(checkoutRow.status_code)) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Checkout cannot be cancelled while status is '${checkoutRow.status_code}'`,
            });
        }
 
        // Stock is hard-reserved only from PPN onward (set at
        // /confirm). INT/CVD/ADS/CLC never reserved anything, so
        // only PPN needs a release here.
        const wasReserved = checkoutRow.status_code === "PPN";
 
        // --------------------------------------------------
        // 4. FETCH checkout items (needed either way — for
        //    inventory release if reserved, and for cart reset
        //    regardless). quote_id pulled in too — needed to
        //    know whether any item on this checkout originated
        //    from a quote (see step 7c).
        // --------------------------------------------------
        const itemsResult = await client.query({
            text: `SELECT checkout_item_id, cart_item_id, product_id, seller_id, warehouse_id, quantity, quote_id
                   FROM public.checkout_items
                   WHERE checkout_id = $1
                     AND is_deleted  = FALSE`,
            values: [checkoutRow.checkout_id],
        });
 
        // --------------------------------------------------
        // 5. IF STOCK WAS RESERVED (PPN) — release the hard
        //    reservation on seller_inventory. No wallet refund
        //    path here — payment can only be attempted via
        //    checkout-payment, and by that point this API no
        //    longer accepts the cancellation.
        // --------------------------------------------------
        if (wasReserved) {
            for (const item of itemsResult.rows) {
                await client.query({
                    text: `UPDATE public.seller_inventory SET
                                reserved_qty = GREATEST(reserved_qty - $1, 0),
                                modified_at   = $2,
                                modified_by   = $3
                           WHERE product_id   = $4
                             AND seller_id    = $5
                             AND warehouse_id = $6
                             AND is_deleted   = FALSE`,
                    values: [item.quantity, now, modified_by, item.product_id, item.seller_id, item.warehouse_id],
                });
            }
        }
 
        // --------------------------------------------------
        // 6. RESOLVE 'CAN' checkout status, 'FLD' item status
        //    (no dedicated CANCELLED code exists in
        //    checkout_item_status — using FLD as closest fit;
        //    swap once a proper code is seeded), + 'PND' cart
        //    status
        // --------------------------------------------------
        const [
            cancelledCheckoutStatusResult,
            failedItemStatusResult,
            pendingCartStatusResult,
        ] = await Promise.all([
            client.query(`SELECT checkout_status_id FROM public.checkout_status WHERE code = 'CAN' AND is_active = TRUE AND is_deleted = FALSE`),
            client.query(`SELECT checkout_item_status_id FROM public.checkout_item_status WHERE code = 'CAN' AND is_active = TRUE AND is_deleted = FALSE`),
            client.query(`SELECT cart_item_status_id FROM public.cart_item_status WHERE code = 'PND' AND is_active = TRUE AND is_deleted = FALSE`),
        ]);
 
        if (
            cancelledCheckoutStatusResult.rowCount === 0 ||
            failedItemStatusResult.rowCount === 0 ||
            pendingCartStatusResult.rowCount === 0
        ) {
            await client.query("ROLLBACK");
            inTransaction = false;
            logger.error("checkout-cancel: missing master data — checkout_status(CAN)/checkout_item_status(FLD)/cart_item_status(PND)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }
 
        const cancelled_checkout_status_id = cancelledCheckoutStatusResult.rows[0].checkout_status_id;
        const cancelled_item_status_id     = failedItemStatusResult.rows[0].checkout_item_status_id;
        const pending_cart_status_id       = pendingCartStatusResult.rows[0].cart_item_status_id;
 
        // --------------------------------------------------
        // 7. UPDATE checkout_details / checkout_items / cart_details
        // --------------------------------------------------
        const updateResult = await client.query({
            text: `UPDATE public.checkout_details SET
                        checkout_status_id = $1,
                        notes                = COALESCE($2, notes),
                        modified_at          = $3,
                        modified_by          = $4
                   WHERE checkout_id = $5
                   RETURNING checkout_id, checkout_uuid, checkout_number, checkout_status_id,
                             payment_status_id, grand_total`,
            values: [cancelled_checkout_status_id, cancel_reason?.trim() || null, now, modified_by, checkoutRow.checkout_id],
        });
 
        await client.query({
            text: `UPDATE public.checkout_items SET
                        checkout_item_status_id = $1,
                        modified_at              = $2,
                        modified_by              = $3
                   WHERE checkout_id = $4
                     AND is_deleted  = FALSE`,
            values: [cancelled_item_status_id, now, modified_by, checkoutRow.checkout_id],
        });
 
        // --------------------------------------------------
        // 7b. VOID checkout_service_charges
        //     is_active = FALSE, NOT is_deleted — the charge
        //     was correctly applied at the time, it's just no
        //     longer effective because the parent checkout was
        //     cancelled. Keeps full audit trail intact, same
        //     semantics as checkout_items moving to a terminal
        //     status rather than being hard/soft-deleted.
        // --------------------------------------------------
        const serviceChargeVoidResult = await client.query({
            text: `UPDATE public.checkout_service_charges SET
                        is_active   = FALSE,
                        modified_at = $1,
                        modified_by = $2
                   WHERE checkout_id = $3
                     AND is_active   = TRUE
                     AND is_deleted  = FALSE
                   RETURNING checkout_service_charge_id`,
            values: [now, modified_by, checkoutRow.checkout_id],
        });

        // --------------------------------------------------
        // 7c. REOPEN QUOTE(S) — if any item on this checkout
        //     originated from a quote (checkout_items.quote_id),
        //     that quote was moved ACC -> CNV at
        //     checkout-initiate-quote time. Cancelling the
        //     checkout here releases the cart items back to
        //     PND, so the quote must be reverted CNV -> ACC too —
        //     otherwise it's stuck: checkout-initiate-quote only
        //     accepts ACC, and normal checkout-initiate rejects
        //     any cart item still carrying a quote_id.
        // --------------------------------------------------
        const quoteIdsToReopen = [...new Set(itemsResult.rows.filter((r) => r.quote_id).map((r) => r.quote_id))];

        if (quoteIdsToReopen.length > 0) {
            const reopenedQuoteStatusResult = await client.query(
                `SELECT quote_status_id FROM public.quote_statuses WHERE code = 'ACC' AND is_active = TRUE AND is_deleted = FALSE`
            );

            if (reopenedQuoteStatusResult.rowCount === 0) {
                await client.query("ROLLBACK");
                inTransaction = false;
                logger.error("checkout-cancel: missing master data — quote_statuses(ACC)");
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
            }

            await client.query({
                text: `UPDATE public.buyer_saved_quote SET
                            status_of_quote = $1,
                            modified_at      = $2,
                            modified_by      = $3
                       WHERE buyer_quote_id = ANY($4::int[])
                         AND is_deleted     = FALSE`,
                values: [reopenedQuoteStatusResult.rows[0].quote_status_id, now, modified_by, quoteIdsToReopen],
            });
        }
 
        // Release cart items back to PND so the buyer can
        // re-add them to a fresh checkout. reservation_expires_at
        // is re-set to a fresh soft-hold window (same as
        // add-to-cart) rather than NULL — the item is once again
        // an active, unattached cart line and needs its own
        // expiry so the background expiry job / cross-buyer
        // netAvailable calculation continues to treat it correctly.
        const fresh_reservation_expires_at = new Date(
            now.getTime() + commonenum.TIME_DURATION_MINUTES.RESERVATION_EXPIRY * 60 * 1000
        );
 
        await client.query({
            text: `UPDATE public.cart_details SET
                        cart_item_status_id    = $1,
                        reservation_expires_at = $2,
                        modified_at              = $3,
                        modified_by              = $4
                   WHERE cart_item_id = ANY($5::int[])
                     AND is_deleted   = FALSE`,
            values: [pending_cart_status_id, fresh_reservation_expires_at, now, modified_by, itemsResult.rows.map((r) => r.cart_item_id)],
        });
 
        await client.query("COMMIT");
        inTransaction = false;
 
        const updated = updateResult.rows[0];
 
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Checkout cancelled successfully",
            data: {
                checkout_id:               updated.checkout_id,
                checkout_uuid:             updated.checkout_uuid,
                checkout_number:           updated.checkout_number,
                checkout_status_id:        updated.checkout_status_id,
                payment_status_id:         updated.payment_status_id,
                grand_total:               updated.grand_total,
                was_reserved:              wasReserved,
                item_count:                itemsResult.rowCount,
                service_charges_voided:    serviceChargeVoidResult.rowCount,
                quotes_reopened:           quoteIdsToReopen,
            },
        });
 
    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (checkout-cancel):", err);
        saveErrorLog({
            api_name:   "checkout-cancel",
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
            message:            "Checkout cancellation failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
//  PAYMENT INITIATION
// --------------------------------------------------

// WALLET PROCESSOR
// Synchronous — always returns a final result (no gateway callback needed).
// Runs inside the caller's transaction (`client`); does not touch
// payment_transactions or checkout_details — caller handles that,
// since those updates are common across all payment modes.
// --------------------------------------------------
async function processWalletPayment({ client, checkoutRow, buyer_id, payment_id, created_by, now, amount }) {

    // 1. LOCK WALLET + CHECK BALANCE
    const walletResult = await client.query({
        text: `SELECT wallet_id, wallet_balance
               FROM public.wallet_accounts
               WHERE buyer_id   = $1
                 AND is_active  = TRUE
                 AND is_deleted = FALSE
               FOR UPDATE`,
        values: [buyer_id],
    });

    if (walletResult.rowCount === 0) {
        return { isFinal: true, status: "FLD", failure_reason: "No active wallet account found for this buyer" };
    }

    const wallet = walletResult.rows[0];

    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [
        commonenum.WALLET_LOCK_NAMESPACE,
        wallet.wallet_id,
    ]);

    const currentBalance = Number(wallet.wallet_balance);
    const chargeAmount   = Number(amount);

    // 2. INSUFFICIENT BALANCE
    if (currentBalance < chargeAmount) {
        return {
            isFinal:        true,
            status:         "FLD",
            failure_reason: `Wallet balance (${currentBalance}) is insufficient for amount (${chargeAmount})`,
        };
    }

    const newBalance = parseFloat((currentBalance - chargeAmount).toFixed(2));

    // 3. RESOLVE reference_type_id for this wallet debit
    //    (wallet_transactions has no `reference_type` string column —
    //    only reference_type_id, an FK to public.reference_type.
    //    reference_id is a plain integer column that stores
    //    checkoutRow.checkout_id so the debit can be traced back to
    //    the checkout it paid for.)
    const refTypeResult = await client.query(
        `SELECT reference_type_id
         FROM public.reference_type
         WHERE code = 'ORP' AND is_active = TRUE AND is_deleted = FALSE`
    );

    if (refTypeResult.rowCount === 0) {
        return { isFinal: true, status: "FLD", failure_reason: "Configuration error: reference_type 'ORP' not found" };
    }

    const reference_type_id = refTypeResult.rows[0].reference_type_id;

    // 4. DEDUCT WALLET
    await client.query({
        text: `UPDATE public.wallet_accounts SET
                    wallet_balance = $1,
                    modified_at    = $2,
                    modified_by    = $3
               WHERE wallet_id = $4`,
        values: [newBalance, now, created_by, wallet.wallet_id],
    });

    // 5. LOG WALLET TRANSACTION (linked to payment_transactions via payment_id,
    //    and to the checkout via reference_type_id + reference_id)
    const walletTxnResult = await client.query({
        text: `INSERT INTO public.wallet_transactions (
                    wallet_id, payment_id, transaction_type, amount,
                    balance_before, balance_after, reference_type_id, reference_id,
                    created_by,assigned_to,created_at
               ) VALUES (
                    $1, $2, 'DEBIT', $3,
                    $4, $5, $6, $7,
                    $8, $9,$10
               )
               RETURNING wallet_transaction_id`,
        values: [
            wallet.wallet_id,
            payment_id,
            chargeAmount,
            currentBalance,
            newBalance,
            reference_type_id,
            checkoutRow.checkout_id,
            created_by,
            created_by,
            now,
        ],
    });

    return {
        isFinal:               true,
        status:                "SUC",
        wallet_transaction_id: walletTxnResult.rows[0].wallet_transaction_id,
        wallet_balance_after:  newBalance,
    };
}

// --------------------------------------------------
// PROCESSOR REGISTRY
// Keyed by payment_method code. Add new entries as gateways are
// integrated (e.g. CRD: processCardPayment) — no other code changes.
// --------------------------------------------------
const PAYMENT_PROCESSORS = {
    WLT: processWalletPayment,
    // CRD: processCardPayment,       // future
    // NTB: processNetBankingPayment, // future
};

responder.on("payments-initiate", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const { checkout_uuid, buyer_uuid, created_by } = req.body;
        const now = new Date();

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!checkout_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "checkout_uuid is required" });

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer_uuid is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created_by is required" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 3. LOCK + VALIDATE checkout ownership/status
        //    Must be 'PPN' (payment pending) — stock hard-reserved at /confirm.
        //    Also pull payment_statuses.code (payment_status_code) so we can
        //    confirm the checkout's payment_status is still 'PEN' before
        //    allowing a new payment attempt (see check below).
      
        // --------------------------------------------------
        const checkoutResult = await client.query({
            text: `SELECT cd.checkout_id, cd.checkout_uuid, cd.checkout_status_id, cs.code AS status_code,
                          cd.checkout_number, cd.payment_method_id, cd.payment_status_id, ps.code AS payment_status_code,
                          cd.subtotal, cd.grand_total, cd.tax_amount,
                          cd.discount_amount, cd.reservation_expires_at,
                          pm.code AS payment_method_code
                   FROM public.checkout_details cd
                   JOIN public.checkout_status cs
                     ON cs.checkout_status_id = cd.checkout_status_id
                   JOIN public.payment_statuses ps
                     ON ps.payment_status_id = cd.payment_status_id
                   LEFT JOIN public.payment_method pm
                     ON pm.payment_method_id = cd.payment_method_id
                   WHERE cd.checkout_uuid = $1
                     AND cd.buyer_id      = $2
                     AND cd.is_deleted    = FALSE
                   FOR UPDATE OF cd`,
            values: [checkout_uuid.trim(), buyer_id],
        });

        if (checkoutResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No checkout found for this buyer with the provided UUID" });
        }

        const checkoutRow = checkoutResult.rows[0];

        if (checkoutRow.status_code !== "PPN") {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Checkout must be confirmed ('PPN') before payment. Current status: '${checkoutRow.status_code}'`,
            });
        }

        // --------------------------------------------------
        // 3b. Payment can only be initiated when the checkout's
        //     payment_status is still 'PEN' (set during checkout-confirm).
        //     If it's already SUC / FLD / RFD, a payment attempt has already
        //     been resolved for this checkout — block re-initiation here.
        // --------------------------------------------------
        if (checkoutRow.payment_status_code !== "PEN") {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Payment cannot be initiated. Current payment status: '${checkoutRow.payment_status_code}'`,
            });
        }

        if (checkoutRow.reservation_expires_at && new Date(checkoutRow.reservation_expires_at) < now) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Checkout session expired", error: "This checkout session has expired. Please reinitiate checkout." });
        }

        const grand_total = Number(checkoutRow.grand_total);
        const subtotal     = Number(checkoutRow.subtotal);

        if (!grand_total || grand_total <= 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Checkout grand_total is invalid for payment" });
        }

        if (!subtotal || subtotal <= 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Checkout subtotal is invalid for payment" });
        }

        // --------------------------------------------------
        // 4. RESOLVE PROCESSOR for the checkout's payment_method
        // --------------------------------------------------
        const processorFn = PAYMENT_PROCESSORS[checkoutRow.payment_method_code];

        if (!processorFn) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Payment method '${checkoutRow.payment_method_code}' is not currently supported`,
            });
        }

        // --------------------------------------------------
        // 5. RESOLVE payment_modes_id + payment_status_id (PEN) + currency_id
        // --------------------------------------------------
        const [modeResult, pendingStatusResult, currencyResult] = await Promise.all([
            client.query(`SELECT payment_modes_id FROM public.payment_modes WHERE code = $1 AND is_active = TRUE AND is_deleted = FALSE`, [checkoutRow.payment_method_code]),
            client.query(`SELECT payment_status_id FROM public.payment_statuses WHERE code = 'PEN' AND is_active = TRUE AND is_deleted = FALSE`),
            // TODO: resolve currency from checkout/buyer/tenant config once multi-currency is supported.
            // Hardcoded to AED for now, but resolved to an integer FK id — never store the raw code here.
            client.query(`SELECT currency_id FROM public.currency WHERE code = 'AED' AND is_active = TRUE AND is_deleted = FALSE`),
        ]);

        if (modeResult.rowCount === 0 || pendingStatusResult.rowCount === 0 || currencyResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            logger.error("payments-initiate: missing master data — payment_modes/payment_statuses(PEN)/currency");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const payment_modes_id  = modeResult.rows[0].payment_modes_id;
        const pending_status_id = pendingStatusResult.rows[0].payment_status_id;
        const currency_id       = currencyResult.rows[0].currency_id;

        // --------------------------------------------------
        // 5b. MARK checkout_details.payment_status_id as PENDING for this
        //     attempt. Keeps the checkout row's payment_status_id in sync
        //     with the payment_transactions row we're about to create,
        //     even in the non-final (gateway redirect) path below.
        // --------------------------------------------------
        await client.query({
            text: `UPDATE public.checkout_details SET
                        payment_status_id = $1,
                        modified_at        = $2,
                        modified_by        = $3
                   WHERE checkout_id = $4`,
            values: [pending_status_id, now, created_by, checkoutRow.checkout_id],
        });

        // --------------------------------------------------
        // 6. CREATE payment_transactions ROW (amount snapshot, attempt #1)
     
        // --------------------------------------------------
        const paymentInsertResult = await client.query({
            text: `INSERT INTO public.payment_transactions (
                        checkout_id, buyer_id, payment_modes_id, payment_status_id,
                        amount, tax_amount, discount_amount, final_amount, currency_id,
                        attempt_number, created_by,assigned_to, created_at
                   ) VALUES (
                        $1, $2, $3, $4,
                        $5, $6, $7, $8, $9,
                        1, $10, $11, $12
                   )
                   RETURNING payment_id, payment_uuid`,
            values: [
                checkoutRow.checkout_id,
                buyer_id,
                payment_modes_id,
                pending_status_id,
                subtotal,
                checkoutRow.tax_amount ?? 0,
                checkoutRow.discount_amount ?? 0,
                grand_total,
                currency_id,
                created_by,
                created_by,
                now,
            ],
        });

        const { payment_id, payment_uuid } = paymentInsertResult.rows[0];

        // --------------------------------------------------
        // 7. RUN THE PROCESSOR (WALLET today; gateway processors plug in later)
        // --------------------------------------------------
        const result = await processorFn({
            client,
            checkoutRow,
            buyer_id,
            payment_id,
            created_by,
            now,
            amount: grand_total,
        });

        // --------------------------------------------------
        // 8a. NON-FINAL (async / gateway redirect) — commit PEN state, return redirect info.
        //     checkout_details.payment_status_id is already PEN from step 5b.
        // --------------------------------------------------
        if (!result.isFinal) {
            await client.query("COMMIT");
            inTransaction = false;

            return cb(null, {
                header_type:        "SUCCESS",
                message_visibility: true,
                status:             true,
                code:               1001,
                message:            "Payment initiated. Redirect required to complete payment.",
                data: {
                    payment_id,
                    payment_uuid,
                    checkout_uuid: checkoutRow.checkout_uuid,
                    status:        "PEN",
                    redirect_url:  result.redirect_url,
                },
            });
        }

        // --------------------------------------------------
        // 8b. FINAL — resolve status codes and update payment_transactions + checkout
        //
        //  IMPORTANT: This responder's job ends at "payment settled".
        //  Order creation is a SEPARATE API (POST /buyer/orders/create,
        //  handled by orders-create.js) triggered by the client after this
        //  call returns SUCCESS. That is why checkout_status here moves to
        //  'PSC' (Payment Successful/Completed) on success — NOT 'ORC'
        //  (Order Created). Only orders-create.js is allowed to set 'ORC',
        //  because only it actually inserts the orders/order_items/sub_orders
        //  rows that the 'ORC' code implies exist.
        // --------------------------------------------------
        const [checkoutStatusResult, paymentStatusResult, itemStatusResult] = await Promise.all([
            client.query(`SELECT checkout_status_id FROM public.checkout_status WHERE code = $1 AND is_active = TRUE AND is_deleted = FALSE`, [result.status === "SUC" ? "PSC" : "PFL"]),
            client.query(`SELECT payment_status_id FROM public.payment_statuses WHERE code = $1 AND is_active = TRUE AND is_deleted = FALSE`, [result.status === "SUC" ? "SUC" : "FLD"]),
            client.query(`SELECT checkout_item_status_id FROM public.checkout_item_status WHERE code = $1 AND is_active = TRUE AND is_deleted = FALSE`, [result.status === "SUC" ? "PSC" : "FLD"]),
        ]);

        if (checkoutStatusResult.rowCount === 0 || paymentStatusResult.rowCount === 0 || itemStatusResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            logger.error("payments-initiate: missing master data — checkout_status(PSC/PFL)/payment_statuses/checkout_item_status(PSC/FLD)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        await client.query({
            text: `UPDATE public.payment_transactions SET
                        payment_status_id = $1,
                        failure_reason     = $2,
                        paid_at            = $3,
                        modified_at        = $4,
                        modified_by        = $5
                   WHERE payment_id = $6`,
            values: [
                paymentStatusResult.rows[0].payment_status_id,
                result.status === "FLD" ? result.failure_reason : null,
                result.status === "SUC" ? now : null,
                now,
                created_by,
                payment_id,
            ],
        });

        // NOTE: checkout_details.payment_status_id is updated here alongside
        // checkout_status_id. This was previously missing — the checkout row's
        // payment_status_id was left on its earlier value (e.g. PEN) forever,
        // even after the payment settled as SUC/FLD.
        await client.query({
            text: `UPDATE public.checkout_details SET
                        checkout_status_id = $1,
                        payment_status_id   = $2,
                        modified_at         = $3,
                        modified_by         = $4
                   WHERE checkout_id = $5`,
            values: [
                checkoutStatusResult.rows[0].checkout_status_id,
                paymentStatusResult.rows[0].payment_status_id,
                now,
                created_by,
                checkoutRow.checkout_id,
            ],
        });

        await client.query({
            text: `UPDATE public.checkout_items SET
                        checkout_item_status_id = $1,
                        modified_at              = $2,
                        modified_by              = $3
                   WHERE checkout_id = $4
                     AND is_deleted  = FALSE`,
            values: [itemStatusResult.rows[0].checkout_item_status_id, now, created_by, checkoutRow.checkout_id],
        });

        // NOTE: cart_details status is intentionally left untouched here.
        // It will be moved to 'ORC' (order created) by orders-create.js once
        // the order actually exists — not here, since no order exists yet.

        await client.query("COMMIT");
        inTransaction = false;

        if (result.status === "FLD") {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2007,
                message:            "Payment failed",
                error:              result.failure_reason,
                data: {
                    payment_id,
                    payment_uuid,
                    checkout_uuid: checkoutRow.checkout_uuid,
                    status:        "FLD",
                },
            });
        }

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Payment successful. You can now proceed to create the order.",
            data: {
                payment_id,
                payment_uuid,
                checkout_uuid:         checkoutRow.checkout_uuid,
                checkout_number:       checkoutRow.checkout_number,
                status:                "PSC",
                subtotal,
                grand_total,
                wallet_transaction_id: result.wallet_transaction_id,
                wallet_balance_after:  result.wallet_balance_after,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (payments-initiate):", err);
        saveErrorLog({
            api_name:   "payments-initiate",
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
            message:            "Payment initiation failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});


// --------------------------------------------------
// GET PAYMENT DETAILS
// --------------------------------------------------

// Fetch a single payment transaction's details for the owning buyer —
// amount breakdown, payment mode, current status, and gateway reference.
// Read-only. No transaction/lock needed.
// --------------------------------------------------
responder.on("payments-get", async (req, cb) => {
    try {
        const { payment_uuid, buyer_uuid } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!payment_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "payment_uuid is required" });

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer_uuid is required" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // --------------------------------------------------
        // 3. FETCH payment + related lookups
        //    Ownership enforced via buyer_id — a buyer can only ever see
        //    their own payment transactions.
        // --------------------------------------------------
        const paymentResult = await pool.query({
            text: `SELECT
                        pt.payment_id,
                        pt.payment_uuid,
                        pt.checkout_id,
                        cd.checkout_uuid,
                        cd.checkout_number,
                        pt.order_id,
                        pt.amount,
                        pt.tax_amount,
                        pt.discount_amount,
                        pt.final_amount,
                        cur.code            AS currency_code,
                        pm.code              AS payment_mode_code,
                        pm.name               AS payment_mode_name,
                        ps.code               AS payment_status_code,
                        ps.name                AS payment_status_name,
                        pt.gateway_name,
                        pt.gateway_transaction_id,
                        pt.gateway_reference,
                        pt.attempt_number,
                        pt.failure_reason,
                        pt.paid_at,
                        pt.created_at
                   FROM public.payment_transactions pt
                   JOIN public.checkout_details cd
                     ON cd.checkout_id = pt.checkout_id
                   LEFT JOIN public.payment_modes pm
                     ON pm.payment_modes_id = pt.payment_modes_id
                   LEFT JOIN public.payment_statuses ps
                     ON ps.payment_status_id = pt.payment_status_id
                   LEFT JOIN public.currency cur
                     ON cur.currency_id = pt.currency_id
                   WHERE pt.payment_uuid = $1
                     AND pt.buyer_id     = $2
                     AND pt.is_deleted   = FALSE`,
            values: [payment_uuid.trim(), buyer_id],
        });

        if (paymentResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No payment found with the provided UUID for this buyer" });

        const row = paymentResult.rows[0];

        // --------------------------------------------------
        // 3b. TOTAL ACTIVE SERVICE CHARGES ON THE LINKED CHECKOUT
        //     amount/final_amount above already have this folded in
        //     (grand_total was locked in at /calculate) — this query
        //     is purely so the breakdown can show it as its own line
        //     instead of it disappearing silently into final_amount.
        // --------------------------------------------------
        const serviceChargeSumResult = await pool.query(
            `SELECT COALESCE(SUM(charge_amount), 0) AS total_service_charge
             FROM public.checkout_service_charges
             WHERE checkout_id = $1
               AND is_active   = TRUE
               AND is_deleted  = FALSE`,
            [row.checkout_id]
        );

        const total_service_charge = parseFloat(
            Number(serviceChargeSumResult.rows[0].total_service_charge).toFixed(2)
        );

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Payment details fetched successfully",
            data: {
                payment_id:       row.payment_uuid,      // external-facing id is always the uuid
                checkout_id:      row.checkout_uuid,
                checkout_number:  row.checkout_number,
                order_id:         row.order_id,           // null until orders-create has run
                amount: {
                    amount:               Number(row.amount),
                    tax_amount:           Number(row.tax_amount ?? 0),
                    discount_amount:      Number(row.discount_amount ?? 0),
                    total_service_charge,
                    final_amount:         Number(row.final_amount),
                    currency:             row.currency_code,
                },
                payment_method: {
                    code: row.payment_mode_code,
                    name: row.payment_mode_name,
                },
                status: {
                    code: row.payment_status_code,
                    name: row.payment_status_name,
                },
                gateway: {
                    name:            row.gateway_name,
                    transaction_id:  row.gateway_transaction_id,
                    reference:       row.gateway_reference,
                },
                attempt_number:  row.attempt_number,
                failure_reason:  row.failure_reason,
                paid_at:         row.paid_at,
                created_at:      row.created_at,
            },
        });

    } catch (err) {
        logger.error("Responder Error (payments-get):", err);
        saveErrorLog({
            api_name:   "payments-get",
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
            message:            "Failed to fetch payment details",
            error:              err.message,
        });
    }
});


// --------------------------------------------------
// PAYMENT RETRY
// --------------------------------------------------


responder.on("payments-retry", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const { payment_uuid, buyer_uuid, created_by } = req.body;
        const now = new Date();

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!payment_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "payment_uuid is required" });

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer_uuid is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created_by is required" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 3. LOCK the failed payment_transactions row being retried
        //    Ownership enforced via buyer_id.
        // --------------------------------------------------
        const failedPaymentResult = await client.query({
            text: `SELECT pt.payment_id, pt.checkout_id, pt.payment_modes_id, pt.currency_id,
                          pt.amount, pt.tax_amount, pt.discount_amount, pt.final_amount,
                          pt.attempt_number, ps.code AS payment_status_code
                   FROM public.payment_transactions pt
                   JOIN public.payment_statuses ps
                     ON ps.payment_status_id = pt.payment_status_id
                   WHERE pt.payment_uuid = $1
                     AND pt.buyer_id     = $2
                     AND pt.is_deleted   = FALSE
                   FOR UPDATE`,
            values: [payment_uuid.trim(), buyer_id],
        });

        if (failedPaymentResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No payment found with the provided UUID for this buyer" });
        }

        const failedPayment = failedPaymentResult.rows[0];

        if (failedPayment.payment_status_code !== "FLD") {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Only failed payments can be retried. Current status: '${failedPayment.payment_status_code}'`,
            });
        }

        // --------------------------------------------------
        // 4. LOCK + VALIDATE checkout — must still be 'PFL' (Payment Failed).
        //    Stock reservation is retained on PFL by checkout-payment logic,
        //    so retrying here does not need to re-reserve stock.
        //    Also join payment_statuses to get the CURRENT payment_status_code
        //    for this checkout, so we can guard against a retry that is
        //    already in flight (PEN) for this checkout — see step 4b below.
        // --------------------------------------------------
        const checkoutResult = await client.query({
            text: `SELECT cd.checkout_id, cd.checkout_uuid, cd.checkout_status_id, cs.code AS status_code,
                          cd.checkout_number, cd.payment_status_id, ps2.code AS payment_status_code,
                          cd.grand_total, cd.tax_amount, cd.discount_amount, cd.reservation_expires_at,
                          pm.code AS payment_method_code
                   FROM public.checkout_details cd
                   JOIN public.checkout_status cs
                     ON cs.checkout_status_id = cd.checkout_status_id
                   LEFT JOIN public.payment_method pm
                     ON pm.payment_method_id = cd.payment_method_id
                   LEFT JOIN public.payment_statuses ps2
                     ON ps2.payment_status_id = cd.payment_status_id
                   WHERE cd.checkout_id = $1
                     AND cd.buyer_id    = $2
                     AND cd.is_deleted  = FALSE
                   FOR UPDATE OF cd`,
            values: [failedPayment.checkout_id, buyer_id],
        });

        if (checkoutResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Checkout for this payment was not found for this buyer" });
        }

        const checkoutRow = checkoutResult.rows[0];

        if (checkoutRow.status_code !== "PFL") {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Checkout is not in a retryable state ('PFL'). Current status: '${checkoutRow.status_code}'`,
            });
        }

        // --------------------------------------------------
        // 4b. GUARD: a retry already in flight for this checkout.
        //     checkout_status_id only moves to PSC/PFL once a payment
        //     reaches a FINAL state (see step 10b). If a previous retry call
        //     started a non-final (gateway redirect) payment, checkout_status
        //     stays 'PFL' while payment_status sits at 'PEN' — without this
        //     check, a duplicate/retried client call would pass the status_code
        //     check above and create a second concurrent retry attempt.
        // --------------------------------------------------
        if (checkoutRow.payment_status_code === "PEN") {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              "A payment retry is already in progress for this checkout. Please wait for it to complete before trying again.",
            });
        }

        if (checkoutRow.reservation_expires_at && new Date(checkoutRow.reservation_expires_at) < now) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Checkout session expired", error: "This checkout's stock reservation has expired. Please reinitiate checkout." });
        }

        const grand_total = Number(checkoutRow.grand_total);

        if (!grand_total || grand_total <= 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Checkout grand_total is invalid for payment" });
        }

        // --------------------------------------------------
        // 5. RESOLVE PROCESSOR for the checkout's payment_method
        // --------------------------------------------------
        const processorFn = PAYMENT_PROCESSORS[checkoutRow.payment_method_code];

        if (!processorFn) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Payment method '${checkoutRow.payment_method_code}' is not currently supported`,
            });
        }

        // --------------------------------------------------
        // 6. RESOLVE next attempt_number (based on this checkout, not just
        //    the one row being retried — covers retry-of-a-retry safely)
        // --------------------------------------------------
        const attemptResult = await client.query({
            text: `SELECT COALESCE(MAX(attempt_number), 0) AS max_attempt
                   FROM public.payment_transactions
                   WHERE checkout_id = $1
                     AND is_deleted  = FALSE`,
            values: [checkoutRow.checkout_id],
        });

        const next_attempt_number = Number(attemptResult.rows[0].max_attempt) + 1;

        // --------------------------------------------------
        // 7. RESOLVE payment_modes_id + payment_status_id (PEN) + currency_id
        //    Reuse the same payment_modes_id / currency_id as the failed
        //    attempt, since the buyer is retrying with the same method.
        // --------------------------------------------------
        const pendingStatusResult = await client.query(
            `SELECT payment_status_id FROM public.payment_statuses WHERE code = 'PEN' AND is_active = TRUE AND is_deleted = FALSE`
        );

        if (pendingStatusResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            logger.error("payments-retry: missing master data — payment_statuses(PEN)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const pending_status_id = pendingStatusResult.rows[0].payment_status_id;

        // --------------------------------------------------
        // 7b. MARK checkout_details.payment_status_id as PENDING for this
        //     retry attempt, mirroring payments-initiate.js step 5b, so the
        //     checkout row's payment_status_id doesn't stay stuck on FLD
        //     while the retry is in flight. This is also what step 4b's
        //     guard checks on the *next* call.
        // --------------------------------------------------
        await client.query({
            text: `UPDATE public.checkout_details SET
                        payment_status_id = $1,
                        modified_at        = $2,
                        modified_by        = $3
                   WHERE checkout_id = $4`,
            values: [pending_status_id, now, created_by, checkoutRow.checkout_id],
        });

        // --------------------------------------------------
        // 8. CREATE NEW payment_transactions ROW (new attempt).
        //    Previous failed row is left untouched — it remains as history.
        // --------------------------------------------------
        const paymentInsertResult = await client.query({
            text: `INSERT INTO public.payment_transactions (
                        checkout_id, buyer_id, payment_modes_id, payment_status_id,
                        amount, tax_amount, discount_amount, final_amount, currency_id,
                        attempt_number, created_by,assigned_to, created_at
                   ) VALUES (
                        $1, $2, $3, $4,
                        $5, $6, $7, $8, $9,
                        $10, $11, $12, $13
                   )
                   RETURNING payment_id, payment_uuid`,
            values: [
                checkoutRow.checkout_id,
                buyer_id,
                failedPayment.payment_modes_id,
                pending_status_id,
                grand_total,
                checkoutRow.tax_amount ?? 0,
                checkoutRow.discount_amount ?? 0,
                grand_total,
                failedPayment.currency_id,
                next_attempt_number,
                created_by,
                created_by,
                now,
            ],
        });

        const { payment_id, payment_uuid: new_payment_uuid } = paymentInsertResult.rows[0];

        // --------------------------------------------------
        // 9. RUN THE PROCESSOR (WALLET today; gateway processors plug in later)
        // --------------------------------------------------
        const result = await processorFn({
            client,
            checkoutRow,
            buyer_id,
            payment_id,
            created_by,
            now,
            amount: grand_total,
        });

        // --------------------------------------------------
        // 10a. NON-FINAL (async / gateway redirect) — commit PEN state.
        //      checkout_details.payment_status_id is already PEN from step 7b.
        //      checkout_status_id intentionally stays 'PFL' here — step 4b's
        //      guard is what prevents a duplicate retry call while this is
        //      in flight.
        // --------------------------------------------------
        if (!result.isFinal) {
            await client.query("COMMIT");
            inTransaction = false;

            return cb(null, {
                header_type:        "SUCCESS",
                message_visibility: true,
                status:             true,
                code:               1001,
                message:            "Payment retry initiated. Redirect required to complete payment.",
                data: {
                    payment_id,
                    payment_uuid:   new_payment_uuid,
                    checkout_uuid:  checkoutRow.checkout_uuid,
                    attempt_number: next_attempt_number,
                    status:         "PEN",
                    redirect_url:   result.redirect_url,
                },
            });
        }

        // --------------------------------------------------
        // 10b. FINAL — resolve status codes and update payment_transactions + checkout.
        //      Same PSC-not-ORC rule as payments-initiate.js: order creation
        //      remains a separate API (POST /buyer/orders/create).
        // --------------------------------------------------
        const [checkoutStatusResult, paymentStatusResult, itemStatusResult] = await Promise.all([
            client.query(`SELECT checkout_status_id FROM public.checkout_status WHERE code = $1 AND is_active = TRUE AND is_deleted = FALSE`, [result.status === "SUC" ? "PSC" : "PFL"]),
            client.query(`SELECT payment_status_id FROM public.payment_statuses WHERE code = $1 AND is_active = TRUE AND is_deleted = FALSE`, [result.status === "SUC" ? "SUC" : "FLD"]),
            client.query(`SELECT checkout_item_status_id FROM public.checkout_item_status WHERE code = $1 AND is_active = TRUE AND is_deleted = FALSE`, [result.status === "SUC" ? "PSC" : "FLD"]),
        ]);

        if (checkoutStatusResult.rowCount === 0 || paymentStatusResult.rowCount === 0 || itemStatusResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            logger.error("payments-retry: missing master data — checkout_status(PSC/PFL)/payment_statuses/checkout_item_status(PSC/FLD)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        await client.query({
            text: `UPDATE public.payment_transactions SET
                        payment_status_id = $1,
                        failure_reason     = $2,
                        paid_at            = $3,
                        modified_at        = $4,
                        modified_by        = $5
                   WHERE payment_id = $6`,
            values: [
                paymentStatusResult.rows[0].payment_status_id,
                result.status === "FLD" ? result.failure_reason : null,
                result.status === "SUC" ? now : null,
                now,
                created_by,
                payment_id,
            ],
        });

        // NOTE: checkout_details.payment_status_id is updated here alongside
        // checkout_status_id. This was previously missing — the checkout row's
        // payment_status_id was left on its earlier value (e.g. PEN/FLD) even
        // after this retry attempt settled as SUC/FLD.
        await client.query({
            text: `UPDATE public.checkout_details SET
                        checkout_status_id = $1,
                        payment_status_id   = $2,
                        modified_at         = $3,
                        modified_by         = $4
                   WHERE checkout_id = $5`,
            values: [
                checkoutStatusResult.rows[0].checkout_status_id,
                paymentStatusResult.rows[0].payment_status_id,
                now,
                created_by,
                checkoutRow.checkout_id,
            ],
        });

        await client.query({
            text: `UPDATE public.checkout_items SET
                        checkout_item_status_id = $1,
                        modified_at              = $2,
                        modified_by              = $3
                   WHERE checkout_id = $4
                     AND is_deleted  = FALSE`,
            values: [itemStatusResult.rows[0].checkout_item_status_id, now, created_by, checkoutRow.checkout_id],
        });

        await client.query("COMMIT");
        inTransaction = false;

        if (result.status === "FLD") {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2007,
                message:            "Payment retry failed",
                error:              result.failure_reason,
                data: {
                    payment_id,
                    payment_uuid:   new_payment_uuid,
                    checkout_uuid:  checkoutRow.checkout_uuid,
                    attempt_number: next_attempt_number,
                    status:         "FLD",
                },
            });
        }

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Payment retry successful. You can now proceed to create the order.",
            data: {
                payment_id,
                payment_uuid:           new_payment_uuid,
                checkout_uuid:          checkoutRow.checkout_uuid,
                checkout_number:        checkoutRow.checkout_number,
                attempt_number:         next_attempt_number,
                status:                 "PSC",
                grand_total,
                wallet_transaction_id:  result.wallet_transaction_id,
                wallet_balance_after:   result.wallet_balance_after,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (payments-retry):", err);
        saveErrorLog({
            api_name:   "payments-retry",
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
            message:            "Payment retry failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});


// --------------------------------------------------
//  PAYMENT CANCEL
// --------------------------------------------------
// For a checkout stuck in 'PFL' (payment failed) where the buyer does
// NOT want to retry payment (see payments-retry.js for the retry path).
// Unlike checkout-cancel.js (which handles INT/CVD/ADS/CLC/PPN — i.e.
// before or during payment attempt), this is specifically the
// "give up after a failed payment" path — stock was already hard-reserved
// at /confirm and is still sitting reserved because payments-initiate
// deliberately leaves it untouched on failure (so a retry doesn't need
// to re-check availability). This API is what finally releases it.
// --------------------------------------------------


responder.on("payment-cancel", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const {
            checkout_uuid,
            buyer_uuid,
            cancel_reason,
            modified_by,
        } = req.body;

        const now = new Date();

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!checkout_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "checkout uuid is required" });

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        if (!modified_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "modified by is required" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 3. LOCK + VALIDATE checkout ownership/status
        //    Only 'PFL' (payment failed) is accepted here.
        //    PPN belongs to checkout-cancel.js. PSC/ORC are
        //    successful/terminal — nothing to cancel. PPR
        //    (async gateway pending) isn't reachable yet since
        //    only WALLET (synchronous) is wired up.
        // --------------------------------------------------
        const checkoutResult = await client.query({
            text: `SELECT cd.checkout_id, cd.checkout_status_id, cs.code AS status_code
                   FROM public.checkout_details cd
                   JOIN public.checkout_status cs
                     ON cs.checkout_status_id = cd.checkout_status_id
                   WHERE cd.checkout_uuid = $1
                     AND cd.buyer_id      = $2
                     AND cd.is_deleted    = FALSE
                   FOR UPDATE`,
            values: [checkout_uuid.trim(), buyer_id],
        });

        if (checkoutResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No checkout found for this buyer with the provided UUID" });
        }

        const checkoutRow = checkoutResult.rows[0];

        if (checkoutRow.status_code !== "PFL") {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              checkoutRow.status_code === "PPN"
                    ? "This checkout has not been attempted for payment yet — use checkout-cancel instead"
                    : `Checkout cannot be cancelled from payment-failed state while status is '${checkoutRow.status_code}'`,
            });
        }

        // --------------------------------------------------
        // 4. FETCH checkout items — stock IS reserved here (PFL always
        //    follows a successful /confirm, which hard-reserves stock;
        //    payments-initiate intentionally does not release it on
        //    failure, precisely so payments-retry can skip re-reserving).
        //    quote_id pulled in too — needed for quote reopen (step 8b).
        // --------------------------------------------------
        const itemsResult = await client.query({
            text: `SELECT checkout_item_id, cart_item_id, product_id, seller_id, warehouse_id, quantity, quote_id
                   FROM public.checkout_items
                   WHERE checkout_id = $1
                     AND is_deleted  = FALSE`,
            values: [checkoutRow.checkout_id],
        });

        if (itemsResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No items found on this checkout" });
        }

        // --------------------------------------------------
        // 5. RELEASE HARD-RESERVED STOCK
        // --------------------------------------------------
        for (const item of itemsResult.rows) {
            await client.query({
                text: `UPDATE public.seller_inventory SET
                            reserved_qty = GREATEST(reserved_qty - $1, 0),
                            modified_at   = $2,
                            modified_by   = $3
                       WHERE product_id   = $4
                         AND seller_id    = $5
                         AND warehouse_id = $6
                         AND is_deleted   = FALSE`,
                values: [item.quantity, now, modified_by, item.product_id, item.seller_id, item.warehouse_id],
            });
        }

        // --------------------------------------------------
        // 6. RESOLVE 'CAN' checkout status, 'CAN' item status, 'PND' cart status
        // --------------------------------------------------
        const [
            cancelledCheckoutStatusResult,
            cancelledItemStatusResult,
            pendingCartStatusResult,
        ] = await Promise.all([
            client.query(`SELECT checkout_status_id FROM public.checkout_status WHERE code = 'CAN' AND is_active = TRUE AND is_deleted = FALSE`),
            client.query(`SELECT checkout_item_status_id FROM public.checkout_item_status WHERE code = 'CAN' AND is_active = TRUE AND is_deleted = FALSE`),
            client.query(`SELECT cart_item_status_id FROM public.cart_item_status WHERE code = 'PND' AND is_active = TRUE AND is_deleted = FALSE`),
        ]);

        if (
            cancelledCheckoutStatusResult.rowCount === 0 ||
            cancelledItemStatusResult.rowCount === 0 ||
            pendingCartStatusResult.rowCount === 0
        ) {
            await client.query("ROLLBACK");
            inTransaction = false;
            logger.error("checkout-payment-cancel: missing master data — checkout_status(CAN)/checkout_item_status(CAN)/cart_item_status(PND)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const cancelled_checkout_status_id = cancelledCheckoutStatusResult.rows[0].checkout_status_id;
        const cancelled_item_status_id     = cancelledItemStatusResult.rows[0].checkout_item_status_id;
        const pending_cart_status_id       = pendingCartStatusResult.rows[0].cart_item_status_id;

        // --------------------------------------------------
        // 7. UPDATE checkout_details / checkout_items
        // --------------------------------------------------
        const updateResult = await client.query({
            text: `UPDATE public.checkout_details SET
                        checkout_status_id = $1,
                        notes                = COALESCE($2, notes),
                        modified_at          = $3,
                        modified_by          = $4
                   WHERE checkout_id = $5
                   RETURNING checkout_id, checkout_uuid, checkout_number, checkout_status_id,
                             payment_status_id, grand_total`,
            values: [cancelled_checkout_status_id, cancel_reason?.trim() || null, now, modified_by, checkoutRow.checkout_id],
        });

        await client.query({
            text: `UPDATE public.checkout_items SET
                        checkout_item_status_id = $1,
                        modified_at              = $2,
                        modified_by              = $3
                   WHERE checkout_id = $4
                     AND is_deleted  = FALSE`,
            values: [cancelled_item_status_id, now, modified_by, checkoutRow.checkout_id],
        });

        // --------------------------------------------------
        // 8. VOID checkout_service_charges
        //    is_active = FALSE, NOT is_deleted — same semantics as
        //    checkout-cancel.js. Charges were correctly applied at the
        //    time; they're just no longer effective now the checkout
        //    is dead.
        // --------------------------------------------------
        const serviceChargeVoidResult = await client.query({
            text: `UPDATE public.checkout_service_charges SET
                        is_active   = FALSE,
                        modified_at = $1,
                        modified_by = $2
                   WHERE checkout_id = $3
                     AND is_active   = TRUE
                     AND is_deleted  = FALSE
                   RETURNING checkout_service_charge_id`,
            values: [now, modified_by, checkoutRow.checkout_id],
        });

        // --------------------------------------------------
        // 8b. REOPEN QUOTE(S) — same reasoning as checkout-cancel.js
        //     step 7c. A checkout reaching PFL and then abandoned here
        //     (rather than retried) must release its quote back to
        //     ACC, or the quote is permanently stuck in CNV with no
        //     path back to checkout.
        // --------------------------------------------------
        const quoteIdsToReopen = [...new Set(itemsResult.rows.filter((r) => r.quote_id).map((r) => r.quote_id))];

        if (quoteIdsToReopen.length > 0) {
            const reopenedQuoteStatusResult = await client.query(
                `SELECT quote_status_id FROM public.quote_statuses WHERE code = 'ACC' AND is_active = TRUE AND is_deleted = FALSE`
            );

            if (reopenedQuoteStatusResult.rowCount === 0) {
                await client.query("ROLLBACK");
                inTransaction = false;
                logger.error("checkout-payment-cancel: missing master data — quote_statuses(ACC)");
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
            }

            await client.query({
                text: `UPDATE public.buyer_saved_quote SET
                            status_of_quote = $1,
                            modified_at      = $2,
                            modified_by      = $3
                       WHERE buyer_quote_id = ANY($4::int[])
                         AND is_deleted     = FALSE`,
                values: [reopenedQuoteStatusResult.rows[0].quote_status_id, now, modified_by, quoteIdsToReopen],
            });
        }

        // --------------------------------------------------
        // 9. RELEASE cart items back to PND with a fresh soft-hold
        //    window — same reasoning as checkout-cancel.js.
        // --------------------------------------------------
        const fresh_reservation_expires_at = new Date(
            now.getTime() + commonenum.TIME_DURATION_MINUTES.RESERVATION_EXPIRY * 60 * 1000
        );

        await client.query({
            text: `UPDATE public.cart_details SET
                        cart_item_status_id    = $1,
                        reservation_expires_at = $2,
                        modified_at              = $3,
                        modified_by              = $4
                   WHERE cart_item_id = ANY($5::int[])
                     AND is_deleted   = FALSE`,
            values: [pending_cart_status_id, fresh_reservation_expires_at, now, modified_by, itemsResult.rows.map((r) => r.cart_item_id)],
        });

        await client.query("COMMIT");
        inTransaction = false;

        const updated = updateResult.rows[0];

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Checkout cancelled after failed payment. Stock released.",
            data: {
                checkout_id:             updated.checkout_id,
                checkout_uuid:           updated.checkout_uuid,
                checkout_number:         updated.checkout_number,
                checkout_status_id:      updated.checkout_status_id,
                payment_status_id:       updated.payment_status_id,
                grand_total:             updated.grand_total,
                item_count:              itemsResult.rowCount,
                service_charges_voided:  serviceChargeVoidResult.rowCount,
                quotes_reopened:         quoteIdsToReopen,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (checkout-payment-cancel):", err);
        saveErrorLog({
            api_name:   "checkout-payment-cancel",
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
            message:            "Checkout payment cancellation failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// OFFLINE WALLET RECHARGE
// --------------------------------------------------
// Credits an EXISTING wallet with the given amount. Does NOT create a
// wallet — that remains the sole responsibility of create-wallet-account.js.
// Every credit here is logged in wallet_transactions with reference_type
// 'RCH' (RECHARGE), keeping sum(wallet_transactions) reconcilable against
// wallet_accounts.wallet_balance.
// --------------------------------------------------

responder.on("wallet-recharge", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const { buyer_uuid, amount, created_by } = req.body;
        const now = new Date();

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created by is required" });

        if (amount === undefined || amount === null || amount === "")
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "amount is required" });

        if (isNaN(Number(amount)))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "amount must be a valid number" });

        const rechargeAmount = Number(amount);

        if (rechargeAmount <= 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "amount must be greater than zero" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_uuid → buyer_id
        // --------------------------------------------------
        const buyerResult = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });

        const { buyer_id } = buyerResult.rows[0];

        // --------------------------------------------------
        // 3. RESOLVE 'RCH' reference_type_id UP FRONT
        // --------------------------------------------------
        const refTypeResult = await pool.query(
            `SELECT reference_type_id
             FROM public.reference_type
             WHERE code = 'RCH' AND is_active = TRUE AND is_deleted = FALSE`
        );

        if (refTypeResult.rowCount === 0) {
            logger.error("wallet-recharge: missing master data — reference_type(RCH)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found: reference_type 'RCH'" });
        }

        const reference_type_id = refTypeResult.rows[0].reference_type_id;

        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 4. LOCK WALLET — must already exist. This API never creates one.
        // --------------------------------------------------
        const walletResult = await client.query({
            text: `SELECT wallet_id, wallet_uuid, wallet_balance
                   FROM public.wallet_accounts
                   WHERE buyer_id   = $1
                     AND is_active  = TRUE
                     AND is_deleted = FALSE
                   FOR UPDATE`,
            values: [buyer_id],
        });

        if (walletResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active wallet found for this buyer. Please create a wallet first.",
            });
        }

        const wallet = walletResult.rows[0];

        await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [
            commonenum.WALLET_LOCK_NAMESPACE,
            wallet.wallet_id,
        ]);

        const balance_before = Number(wallet.wallet_balance);
        const balance_after  = parseFloat((balance_before + rechargeAmount).toFixed(2));

        // --------------------------------------------------
        // 5. CREDIT WALLET
        // --------------------------------------------------
        const walletUpdate = await client.query({
            text: `UPDATE public.wallet_accounts SET
                        wallet_balance = $1,
                        modified_at    = $2,
                        modified_by    = $3
                   WHERE wallet_id = $4
                   RETURNING wallet_id, wallet_uuid, buyer_id, wallet_balance`,
            values: [balance_after, now, created_by, wallet.wallet_id],
        });

        const updatedWallet = walletUpdate.rows[0];

        // --------------------------------------------------
        // 6. LOG WALLET TRANSACTION (CREDIT / RCH)
        // --------------------------------------------------
        const walletTxnResult = await client.query({
            text: `INSERT INTO public.wallet_transactions (
                        wallet_id, transaction_type, amount,
                        balance_before, balance_after, reference_type_id,
                        assigned_to, assigned_at, created_by, created_at
                   ) VALUES (
                        $1, 'CREDIT', $2,
                        $3, $4, $5,
                        $6, $7, $8, $9
                   )
                   RETURNING wallet_transaction_id, wallet_transaction_uuid`,
            values: [
                wallet.wallet_id,
                rechargeAmount,
                balance_before,
                balance_after,
                reference_type_id,
                created_by,   // assigned_to
                now,          // assigned_at
                created_by,
                now,
            ],
        });

        const { wallet_transaction_id, wallet_transaction_uuid } = walletTxnResult.rows[0];

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 7. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Wallet recharged successfully",
            data: {
                wallet_id:               updatedWallet.wallet_id,
                wallet_uuid:             updatedWallet.wallet_uuid,
                buyer_id:                updatedWallet.buyer_id,
                wallet_balance:          Number(updatedWallet.wallet_balance),
                balance_before,
                balance_after,
                amount_credited:         rechargeAmount,
                wallet_transaction_id,
                wallet_transaction_uuid,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (wallet-recharge):", err);
        saveErrorLog({
            api_name:   "wallet-recharge",
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
            message:            "Wallet recharge failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});


// --------------------------------------------------
// GET BUYER PAYMENT TRANSACTION HISTORY
// --------------------------------------------------

responder.on("get-buyer-payment-history", async (req, cb) => {
    const client = await pool.connect();

    try {
        const {
            buyer_uuid,
            Page     = 1,
            PageSize = 10,
        } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Buyer UUID is required",
            });

        const page     = Math.max(Number(Page) || 1, 1);
        const pageSize = Math.min(Math.max(Number(PageSize) || 10, 1), 100);
        const offset   = (page - 1) * pageSize;

        // --------------------------------------------------
        // 2. RESOLVE buyer_uuid → buyer_id
        // --------------------------------------------------
        const buyerResult = await client.query({
            text: `SELECT buyer_id
                   FROM public.buyer_accounts
                   WHERE buyer_uuid = $1
                     AND is_deleted = FALSE
                     AND is_active  = TRUE`,
            values: [buyer_uuid.trim()],
        });

        if (buyerResult.rowCount === 0)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active buyer found with the provided UUID",
            });

        const { buyer_id } = buyerResult.rows[0];

        // --------------------------------------------------
        // 3. COUNT (for pagination)
        // --------------------------------------------------
        const countResult = await client.query({
            text: `SELECT COUNT(*) AS total
                   FROM public.payment_transactions PT
                   WHERE PT.buyer_id   = $1
                     AND PT.is_deleted = FALSE`,
            values: [buyer_id],
        });

        const total      = Number(countResult.rows[0].total);
        const totalPages = Math.ceil(total / pageSize);

        // --------------------------------------------------
        // 4. FETCH TRANSACTIONS (paginated)
        // --------------------------------------------------
        const itemsResult = await client.query({
            text: `
                SELECT
                    -- Payment identifiers
                    PT.payment_id,
                    PT.payment_uuid,
                    PT.attempt_number,

                    -- Linked checkout
                    CD.checkout_id,
                    CD.checkout_uuid,
                    CD.checkout_number,

                    -- Payment mode (WLT/CRD/NTB)
                    PM.code                AS payment_mode_code,
                    PM.name                AS payment_mode_name,

                    -- Payment status (PEN/SUC/FLD/RFD)
                    PS.code                AS payment_status_code,
                    PS.name                AS payment_status_name,

                    -- Amounts
                    PT.amount,
                    PT.tax_amount,
                    PT.discount_amount,
                    PT.final_amount,

                    -- Currency
                    CUR.code                AS currency_code,

                    -- Gateway info (NULL for wallet payments today)
                    PT.gateway_name,
                    PT.gateway_reference,

                    -- Failure detail (only populated when FLD)
                    PT.failure_reason,

                    -- Timestamps
                    PT.paid_at,
                    PT.created_at

                FROM public.payment_transactions PT

                JOIN public.payment_statuses PS
                    ON PS.payment_status_id = PT.payment_status_id

                JOIN public.payment_modes PM
                    ON PM.payment_modes_id = PT.payment_modes_id

                LEFT JOIN public.currency CUR
                    ON CUR.currency_id = PT.currency_id

                LEFT JOIN public.checkout_details CD
                    ON CD.checkout_id = PT.checkout_id

                WHERE PT.buyer_id   = $1
                  AND PT.is_deleted = FALSE

                ORDER BY PT.created_at DESC

                LIMIT  $2
                OFFSET $3
            `,
            values: [buyer_id, pageSize, offset],
        });

        // --------------------------------------------------
        // 5. SUMMARY TOTALS (across ALL transactions, not just this page)
        //    Only counts successful payments toward total_paid, since
        //    PEN/FLD rows don't represent real money movement.
        // --------------------------------------------------
        const summaryResult = await client.query({
            text: `
                SELECT
                    COUNT(*)                                                         AS total_transactions,
                    COUNT(*) FILTER (WHERE PS.code = 'SUC')                          AS total_success,
                    COUNT(*) FILTER (WHERE PS.code = 'FLD')                          AS total_failed,
                    COUNT(*) FILTER (WHERE PS.code = 'PEN')                          AS total_pending,
                    COALESCE(SUM(PT.final_amount) FILTER (WHERE PS.code = 'SUC'), 0) AS total_paid
                FROM public.payment_transactions PT
                JOIN public.payment_statuses PS
                    ON PS.payment_status_id = PT.payment_status_id
                WHERE PT.buyer_id   = $1
                  AND PT.is_deleted = FALSE
            `,
            values: [buyer_id],
        });

        const summary = {
            total_transactions: Number(summaryResult.rows[0].total_transactions),
            total_success:      Number(summaryResult.rows[0].total_success),
            total_failed:       Number(summaryResult.rows[0].total_failed),
            total_pending:      Number(summaryResult.rows[0].total_pending),
            total_paid:         parseFloat(Number(summaryResult.rows[0].total_paid).toFixed(2)),
        };

        // --------------------------------------------------
        // 6. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Payment history fetched successfully",
            error:              null,
            result: {
                page,
                pageSize,
                totalRecords: total,
                totalPages,
                summary,
                data: itemsResult.rows,
            },
        });

    } catch (err) {
        logger.error("Responder Error (get-buyer-payment-history):", err);
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
// GET PAYMENT RECEIPT
// --------------------------------------------------
// Combines payment + checkout + buyer + seller info into a single
// printable/downloadable receipt. Single-record fetch — NO pagination
// --------------------------------------------------

responder.on("get-payment-receipt", async (req, cb) => {
    try {
        const { payment_uuid, buyer_uuid } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!payment_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "payment_uuid is required" });

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer_uuid is required" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_id + buyer contact info + full name
        // --------------------------------------------------
        const buyerResult = await pool.query(
            `SELECT
                BA.buyer_id,
                BA.buyer_code,
                BA.business_name,
                BA.email_id,
                BA.phone_country_code,
                BA.phone_number,
                U.fullname AS buyer_full_name
             FROM public.buyer_accounts BA
             LEFT JOIN public.users U
                ON U.user_id = BA.user_id
             WHERE BA.buyer_uuid            = $1
               AND BA.is_active             = TRUE
               AND BA.is_deleted            = FALSE
               AND BA.phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });

        const buyer = buyerResult.rows[0];

        const buyer_display_name = buyer.buyer_full_name ;

        // --------------------------------------------------
        // 3. FETCH PAYMENT + CHECKOUT (single combined query)
        //    Ownership enforced via buyer_id.
        // --------------------------------------------------
        const paymentResult = await pool.query(
            `SELECT
                -- Payment
                PT.payment_id,
                PT.payment_uuid,
                PT.attempt_number,
                PT.amount,
                PT.tax_amount        AS payment_tax_amount,
                PT.discount_amount   AS payment_discount_amount,
                PT.final_amount,
                PT.gateway_name,
                PT.gateway_reference,
                PT.failure_reason,
                PT.paid_at,
                PT.created_at        AS payment_created_at,

                -- Payment mode / status
                PM.code               AS payment_mode_code,
                PM.name               AS payment_mode_name,
                PS.code               AS payment_status_code,
                PS.name               AS payment_status_name,

                -- Currency
                CUR.code              AS currency_code,

                -- Checkout
                CD.checkout_id,
                CD.checkout_uuid,
                CD.checkout_number,
                CD.subtotal,
                CD.tax_amount        AS checkout_tax_amount,
                CD.shipping_charge,
                CD.discount_amount   AS checkout_discount_amount,
                CD.grand_total,
                CD.notes,
                CD.address_id

                -- Checkout status
                , CS.code               AS checkout_status_code
                , CS.name               AS checkout_status_name

             FROM public.payment_transactions PT

             JOIN public.payment_modes PM
                ON PM.payment_modes_id = PT.payment_modes_id

             JOIN public.payment_statuses PS
                ON PS.payment_status_id = PT.payment_status_id

             LEFT JOIN public.currency CUR
                ON CUR.currency_id = PT.currency_id

             JOIN public.checkout_details CD
                ON CD.checkout_id = PT.checkout_id

             JOIN public.checkout_status CS
                ON CS.checkout_status_id = CD.checkout_status_id

             WHERE PT.payment_uuid = $1
               AND PT.buyer_id     = $2
               AND PT.is_deleted   = FALSE`,
            [payment_uuid.trim(), buyer.buyer_id]
        );

        if (paymentResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No payment found with the provided UUID for this buyer" });

        const payment = paymentResult.rows[0];

        // --------------------------------------------------
        // 4. FETCH CHECKOUT ITEMS (with product + seller info)
        // --------------------------------------------------
        const itemsResult = await pool.query(
            `SELECT
                CI.checkout_item_id,
                CI.checkout_item_uuid,
                CI.product_name,
                CI.sku,
                CI.quantity,
                CI.unit_price,
                CI.tax_amount,
                CI.discount_amount,
                CI.final_price,

                -- Seller
                SA.seller_id,
                SA.seller_uuid,
                SA.seller_code,
                SA.business_name      AS seller_business_name,
                SA.email_id           AS seller_email,
                SA.phone_country_code AS seller_phone_country_code,
                SA.phone_number       AS seller_phone_number,
                SU.fullname            AS seller_full_name

             FROM public.checkout_items CI

             JOIN public.seller_accounts SA
                ON SA.seller_id  = CI.seller_id
               AND SA.is_deleted = FALSE

             LEFT JOIN public.users SU
                ON SU.user_id = SA.user_id

             WHERE CI.checkout_id = $1
               AND CI.is_deleted  = FALSE

             ORDER BY CI.checkout_item_id ASC`,
            [payment.checkout_id]
        );

        // --------------------------------------------------
        // 4b. FETCH ACTIVE SERVICE CHARGES ON THIS CHECKOUT
        //     Shown as its own line-item block on the receipt so
        //     subtotal + tax + shipping - discount + service_charges
        //     reconciles visibly with grand_total for the buyer.
        // --------------------------------------------------
        const serviceChargesResult = await pool.query(
            `SELECT
                    csc.checkout_service_charge_uuid,
                    sc.name AS service_charge_name,
                    csc.charge_type,
                    csc.charge_value,
                    csc.charge_amount
               FROM public.checkout_service_charges csc
               JOIN public.service_charge sc
                 ON sc.service_charge_id = csc.service_charge_id
              WHERE csc.checkout_id = $1
                AND csc.is_active   = TRUE
                AND csc.is_deleted  = FALSE
              ORDER BY csc.checkout_service_charge_id ASC`,
            [payment.checkout_id]
        );

        const service_charges = serviceChargesResult.rows.map((row) => ({
            checkout_service_charge_uuid: row.checkout_service_charge_uuid,
            service_charge_name:          row.service_charge_name,
            charge_type:                  row.charge_type,
            charge_value:                 Number(row.charge_value),
            charge_amount:                Number(row.charge_amount),
        }));

        const total_service_charge = parseFloat(
            service_charges.reduce((sum, sc) => sum + sc.charge_amount, 0).toFixed(2)
        );

        // --------------------------------------------------
        // 5. DERIVE DISTINCT SELLERS ON THIS RECEIPT
        //    A checkout can span multiple sellers — surface each
        //    seller once, with their own line items nested under it.
        // --------------------------------------------------
        const sellerMap = new Map();

        for (const row of itemsResult.rows) {
            if (!sellerMap.has(row.seller_id)) {
                sellerMap.set(row.seller_id, {
                    seller_id:      row.seller_id,
                    seller_uuid:    row.seller_uuid,
                    seller_code:    row.seller_code,
                    seller_full_name:   row.seller_full_name ,
                    business_name:  row.seller_business_name,
                    email:          row.seller_email,
                    phone:          row.seller_phone_country_code && row.seller_phone_number
                                        ? `${row.seller_phone_country_code}${row.seller_phone_number}`
                                        : null,
                    items:          [],
                });
            }

            sellerMap.get(row.seller_id).items.push({
                checkout_item_id:   row.checkout_item_id,
                checkout_item_uuid: row.checkout_item_uuid,
                product_name:       row.product_name,
                sku:                row.sku,
                quantity:           Number(row.quantity),
                unit_price:         Number(row.unit_price),
                tax_amount:         Number(row.tax_amount),
                discount_amount:    Number(row.discount_amount),
                final_price:        Number(row.final_price),
            });
        }

        const sellers = Array.from(sellerMap.values());

        // --------------------------------------------------
        // 6. FETCH DELIVERY ADDRESS (if set on checkout)
        //    account_addresses.phone_number is NUMERIC — cast to
        //    text before concatenation to avoid type errors.
        // --------------------------------------------------
        let address = null;

        if (payment.address_id) {
            const addressResult = await pool.query(
                `SELECT
                    AA.address_line1,
                    AA.address_line2,
                    AA.display_name,
                    AA.phone_number::text AS phone_number,
                    AA.country_code,
                    AA.latitude,
                    AA.longitude,
                    CTRY.name AS country_name,
                    ST.name   AS state_name,
                    CTY.name  AS city_name
                 FROM public.account_addresses AA
                 LEFT JOIN public.countries CTRY ON CTRY.country_id = AA.country_id
                 LEFT JOIN public.states    ST   ON ST.state_id     = AA.state_id
                 LEFT JOIN public.cities    CTY  ON CTY.city_id     = AA.city
                 WHERE AA.address_id = $1
                   AND AA.is_deleted = FALSE`,
                [payment.address_id]
            );

            address = addressResult.rowCount > 0 ? addressResult.rows[0] : null;
        }

        // --------------------------------------------------
        // 7. FETCH COMPANY INFO (same pattern as print-buyer-quote)
        // --------------------------------------------------
        const companyResult = await pool.query(
            `SELECT company_name, support_email, contact_number, logo, footer_text, copyright
             FROM public.cms_company_info
             WHERE is_active  = TRUE
               AND is_deleted = FALSE
             ORDER BY cms_company_info_id ASC
             LIMIT 1`
        );

        const company = companyResult.rowCount > 0 ? companyResult.rows[0] : null;

        // --------------------------------------------------
        // 8. SUCCESS RESPONSE — structured receipt payload
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Payment receipt fetched successfully",
            data: {

                // --- Company (issuer of the receipt) ---
                company: company ? {
                    name:        company.company_name,
                    email:       company.support_email,
                    phone:       company.contact_number,
                    logo:        company.logo,
                    footer_text: company.footer_text,
                    copyright:   company.copyright,
                } : null,

                // --- Payment ---
                payment: {
                    payment_uuid:      payment.payment_uuid,
                    attempt_number:    payment.attempt_number,
                    amount:            Number(payment.amount),
                    tax_amount:        Number(payment.payment_tax_amount),
                    discount_amount:   Number(payment.payment_discount_amount),
                    final_amount:      Number(payment.final_amount),
                    currency_code:     payment.currency_code,
                    payment_mode:      { code: payment.payment_mode_code, name: payment.payment_mode_name },
                    payment_status:    { code: payment.payment_status_code, name: payment.payment_status_name },
                    gateway_name:      payment.gateway_name,
                    gateway_reference: payment.gateway_reference,
                    paid_at:           payment.paid_at,
                    created_at:        payment.payment_created_at,
                },

                // --- Checkout ---
                checkout: {
                    checkout_uuid:    payment.checkout_uuid,
                    checkout_number:  payment.checkout_number,
                    checkout_status:  { code: payment.checkout_status_code, name: payment.checkout_status_name },
                    subtotal:         Number(payment.subtotal),
                    tax_amount:       Number(payment.checkout_tax_amount),
                    shipping_charge:  Number(payment.shipping_charge),
                    discount_amount:  Number(payment.checkout_discount_amount),
                    total_service_charge,
                    grand_total:      Number(payment.grand_total),
                    notes:            payment.notes,
                },

                // --- Service charges (own block, for a clear receipt line) ---
                service_charges,

                // --- Buyer ---
                buyer: {
                    buyer_uuid:    buyer_uuid.trim(),
                    buyer_code:    buyer.buyer_code,
                    buyer_full_name:  buyer_display_name,
                    business_name: buyer.business_name,
                    email:         buyer.email_id,
                    phone:         buyer.phone_country_code && buyer.phone_number
                                       ? `${buyer.phone_country_code}${buyer.phone_number}`
                                       : null,
                },

                // --- Delivery address ---
                address,

                // --- Sellers + their line items ---
                sellers,
            },
        });

    } catch (err) {
        logger.error("Responder Error (get-payment-receipt):", err);
        saveErrorLog({
            api_name:   "get-payment-receipt",
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
            message:            "Fetch payment receipt failed",
            error:              err.message,
        });
    }
});

// --------------------------------------------------
// GET WALLET TRANSACTION HISTORY
// --------------------------------------------------
// Retrieves the buyer's complete wallet ledger — purchases (DEBIT via
// ORP), refunds (CREDIT via REF), recharges (CREDIT via RCH), and any
// future adjustment types — in one paginated, chronological feed.
// --------------------------------------------------

responder.on("get-wallet-transaction-history", async (req, cb) => {
    const client = await pool.connect();

    try {
        const {
            buyer_uuid,
            Page     = 1,
            PageSize = 10,
        } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Buyer UUID is required",
            });

        const page     = Math.max(Number(Page) || 1, 1);
        const pageSize = Math.min(Math.max(Number(PageSize) || 10, 1), 100);
        const offset   = (page - 1) * pageSize;

        // --------------------------------------------------
        // 2. RESOLVE buyer_uuid → buyer_id
        // --------------------------------------------------
        const buyerResult = await client.query({
            text: `SELECT buyer_id
                   FROM public.buyer_accounts
                   WHERE buyer_uuid = $1
                     AND is_deleted = FALSE
                     AND is_active  = TRUE`,
            values: [buyer_uuid.trim()],
        });

        if (buyerResult.rowCount === 0)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active buyer found with the provided UUID",
            });

        const { buyer_id } = buyerResult.rows[0];

        // --------------------------------------------------
        // 3. RESOLVE wallet_id — the ledger is keyed by wallet_id,
        //    not buyer_id directly, so this must be resolved first.
        // --------------------------------------------------
        const walletResult = await client.query({
            text: `SELECT wallet_id, wallet_uuid, wallet_balance
                   FROM public.wallet_accounts
                   WHERE buyer_id   = $1
                     AND is_deleted = FALSE`,
            values: [buyer_id],
        });

        if (walletResult.rowCount === 0)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No wallet found for this buyer",
            });

        const wallet = walletResult.rows[0];

        // --------------------------------------------------
        // 4. COUNT (for pagination)
        // --------------------------------------------------
        const countResult = await client.query({
            text: `SELECT COUNT(*) AS total
                   FROM public.wallet_transactions WT
                   WHERE WT.wallet_id  = $1
                     AND WT.is_deleted = FALSE`,
            values: [wallet.wallet_id],
        });

        const total      = Number(countResult.rows[0].total);
        const totalPages = Math.ceil(total / pageSize);

        // --------------------------------------------------
        // 5. FETCH TRANSACTIONS (paginated)
        //    reference_type surfaces WHY the transaction happened
        //    (RCH = recharge, ORP = order payment/purchase,
        //    REF = refund, or any future adjustment code) —
        //    this is what lets purchases/refunds/recharges all
        //    show up correctly labeled in one unified feed.
        //    payment_uuid is included (via LEFT JOIN, since
        //    payment_id is nullable — e.g. wallet creation credits
        //    have no linked payment) so the buyer can trace a
        //    DEBIT/CREDIT back to the specific order payment.
        // --------------------------------------------------
        const itemsResult = await client.query({
            text: `
                SELECT
                    WT.wallet_transaction_id,
                    WT.wallet_transaction_uuid,
                    WT.transaction_type,
                    WT.amount,
                    WT.balance_before,
                    WT.balance_after,

                    -- Why this transaction happened
                    RT.code    AS reference_type_code,
                    RT.name    AS reference_type_name,
                    WT.reference_id,

                    -- Linked payment (NULL for non-payment credits, e.g. recharge/opening balance)
                    PT.payment_id,
                    PT.payment_uuid,

                    WT.created_at

                FROM public.wallet_transactions WT

                JOIN public.reference_type RT
                    ON RT.reference_type_id = WT.reference_type_id

                LEFT JOIN public.payment_transactions PT
                    ON PT.payment_id = WT.payment_id
                   AND PT.is_deleted = FALSE

                WHERE WT.wallet_id  = $1
                  AND WT.is_deleted = FALSE

                ORDER BY WT.created_at DESC

                LIMIT  $2
                OFFSET $3
            `,
            values: [wallet.wallet_id, pageSize, offset],
        });

        // --------------------------------------------------
        // 6. SUMMARY TOTALS (across ALL transactions, not just this page)
        // --------------------------------------------------
        const summaryResult = await client.query({
            text: `
                SELECT
                    COUNT(*)                                                          AS total_transactions,
                    COALESCE(SUM(WT.amount) FILTER (WHERE WT.transaction_type = 'CREDIT'), 0) AS total_credited,
                    COALESCE(SUM(WT.amount) FILTER (WHERE WT.transaction_type = 'DEBIT'),  0) AS total_debited
                FROM public.wallet_transactions WT
                WHERE WT.wallet_id  = $1
                  AND WT.is_deleted = FALSE
            `,
            values: [wallet.wallet_id],
        });

        const summary = {
            total_transactions: Number(summaryResult.rows[0].total_transactions),
            total_credited:     parseFloat(Number(summaryResult.rows[0].total_credited).toFixed(2)),
            total_debited:      parseFloat(Number(summaryResult.rows[0].total_debited).toFixed(2)),
            current_balance:    parseFloat(Number(wallet.wallet_balance).toFixed(2)),
        };

        // --------------------------------------------------
        // 7. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Wallet transaction history fetched successfully",
            error:              null,
            result: {
                wallet_id:   wallet.wallet_id,
                wallet_uuid: wallet.wallet_uuid,
                page,
                pageSize,
                totalRecords: total,
                totalPages,
                summary,
                data: itemsResult.rows,
            },
        });

    } catch (err) {
        logger.error("Responder Error (get-wallet-transaction-history):", err);
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
// GET WALLET RECHARGE HISTORY
// --------------------------------------------------
// Retrieves recharge (CREDIT/RCH) entries from the wallet ledger.
// LIMITATION: wallet_transactions has no payment-mode or approval-
// status columns, so this cannot distinguish online vs offline
// recharges or show a pending/approved/rejected state — every row
// here represents an already-credited recharge.
// --------------------------------------------------

responder.on("get-wallet-recharge-history", async (req, cb) => {
    const client = await pool.connect();

    try {
        const {
            buyer_uuid,
            Page     = 1,
            PageSize = 10,
        } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });

        const page     = Math.max(Number(Page) || 1, 1);
        const pageSize = Math.min(Math.max(Number(PageSize) || 10, 1), 100);
        const offset   = (page - 1) * pageSize;

        // --------------------------------------------------
        // 2. RESOLVE buyer_uuid → buyer_id
        // --------------------------------------------------
        const buyerResult = await client.query({
            text: `SELECT buyer_id
                   FROM public.buyer_accounts
                   WHERE buyer_uuid = $1
                     AND is_deleted = FALSE
                     AND is_active  = TRUE`,
            values: [buyer_uuid.trim()],
        });

        if (buyerResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const { buyer_id } = buyerResult.rows[0];

        // --------------------------------------------------
        // 3. RESOLVE wallet_id
        // --------------------------------------------------
        const walletResult = await client.query({
            text: `SELECT wallet_id, wallet_uuid, wallet_balance
                   FROM public.wallet_accounts
                   WHERE buyer_id   = $1
                     AND is_deleted = FALSE`,
            values: [buyer_id],
        });

        if (walletResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No wallet found for this buyer" });

        const wallet = walletResult.rows[0];

        // --------------------------------------------------
        // 4. COUNT (recharge entries only — reference_type = RCH)
        // --------------------------------------------------
        const countResult = await client.query({
            text: `SELECT COUNT(*) AS total
                   FROM public.wallet_transactions WT
                   JOIN public.reference_type RT
                       ON RT.reference_type_id = WT.reference_type_id
                      AND RT.code = 'RCH'
                   WHERE WT.wallet_id  = $1
                     AND WT.is_deleted = FALSE`,
            values: [wallet.wallet_id],
        });

        const total      = Number(countResult.rows[0].total);
        const totalPages = Math.ceil(total / pageSize);

        // --------------------------------------------------
        // 5. FETCH RECHARGE ENTRIES (paginated)
        // --------------------------------------------------
        const itemsResult = await client.query({
            text: `
                SELECT
                    WT.wallet_transaction_id,
                    WT.wallet_transaction_uuid,
                    WT.transaction_type,
                    WT.amount,
                    WT.balance_before,
                    WT.balance_after,
                    RT.code    AS reference_type_code,
                    RT.name    AS reference_type_name,
                    WT.created_at
                FROM public.wallet_transactions WT
                JOIN public.reference_type RT
                    ON RT.reference_type_id = WT.reference_type_id
                   AND RT.code = 'RCH'
                WHERE WT.wallet_id  = $1
                  AND WT.is_deleted = FALSE
                ORDER BY WT.created_at DESC
                LIMIT  $2
                OFFSET $3
            `,
            values: [wallet.wallet_id, pageSize, offset],
        });

        // --------------------------------------------------
        // 6. SUMMARY
        // --------------------------------------------------
        const summaryResult = await client.query({
            text: `
                SELECT
                    COUNT(*)                        AS total_recharges,
                    COALESCE(SUM(WT.amount), 0)     AS total_recharged_amount
                FROM public.wallet_transactions WT
                JOIN public.reference_type RT
                    ON RT.reference_type_id = WT.reference_type_id
                   AND RT.code = 'RCH'
                WHERE WT.wallet_id  = $1
                  AND WT.is_deleted = FALSE
            `,
            values: [wallet.wallet_id],
        });

        const summary = {
            total_recharges:          Number(summaryResult.rows[0].total_recharges),
            total_recharged_amount:   parseFloat(Number(summaryResult.rows[0].total_recharged_amount).toFixed(2)),
            current_balance:          parseFloat(Number(wallet.wallet_balance).toFixed(2)),
        };

        // --------------------------------------------------
        // 7. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Wallet recharge history fetched successfully",
            error:              null,
            result: {
                wallet_id:   wallet.wallet_id,
                wallet_uuid: wallet.wallet_uuid,
                page,
                pageSize,
                totalRecords: total,
                totalPages,
                summary,
                data: itemsResult.rows,
            },
        });

    } catch (err) {
        logger.error("Responder Error (get-wallet-recharge-history):", err);
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
// ORDER CREATION
// --------------------------------------------------
// CHANGE: after the order + order_items + sub_orders are created,
// copies the checkout's ACTIVE checkout_service_charges rows into
// order_service_charges.
//   - source checkout_service_charges rows are left UNTOUCHED
//     (is_active stays TRUE — they remain historical record of what
//     was charged at checkout time; the checkout itself is already
//     terminal at 'ORC' so there's no risk of them being double-counted
//     anywhere else).
// --------------------------------------------------


responder.on("order-create-old", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const { payment_uuid, created_by } = req.body;

        const now = new Date();

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!payment_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "payment_uuid is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created_by is required" });

        // --------------------------------------------------
        // 2. RESOLVE PAYMENT TRANSACTION (must be SUC, and not already converted)
        // --------------------------------------------------
        const paymentResult = await pool.query(
            `SELECT pt.payment_id, pt.checkout_id, pt.buyer_id, pt.order_id,
                    pt.payment_modes_id, pt.paid_at, ps.code AS payment_status_code
             FROM public.payment_transactions pt
             JOIN public.payment_statuses ps
               ON ps.payment_status_id = pt.payment_status_id
             WHERE pt.payment_uuid = $1
               AND pt.is_deleted   = FALSE`,
            [payment_uuid.trim()]
        );

        if (paymentResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No payment transaction found for the provided UUID" });

        const payment = paymentResult.rows[0];

        if (payment.payment_status_code !== "SUC")
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2008, message: "Action not allowed", error: `Payment status is '${payment.payment_status_code}', order cannot be created` });

        // Idempotency guard — this payment already has an order linked
        if (payment.order_id !== null)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2002, message: "Action not allowed", error: "Order already created for this payment" });

        // --------------------------------------------------
        // 3. RESOLVE CHECKOUT HEADER (must be PSC)
        // --------------------------------------------------
        const checkoutResult = await pool.query(
            `SELECT cd.checkout_id, cd.buyer_id, cd.subtotal, cd.tax_amount,
                    cd.shipping_charge, cd.discount_amount, cd.grand_total,
                    cs.code AS checkout_status_code
             FROM public.checkout_details cd
             JOIN public.checkout_status cs
               ON cs.checkout_status_id = cd.checkout_status_id
             WHERE cd.checkout_id = $1
               AND cd.is_deleted  = FALSE`,
            [payment.checkout_id]
        );

        if (checkoutResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Checkout session not found" });

        const checkout = checkoutResult.rows[0];

        if (checkout.checkout_status_code !== "PSC")
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2008, message: "Action not allowed", error: `Checkout status is '${checkout.checkout_status_code}', order cannot be created` });

        // --------------------------------------------------
        // 4. FETCH CHECKOUT ITEMS (join cart_details for uom_id fallback)
        //    CHANGE (schema update): now also pulls quote_item_id /
        //    quote_type_id — needed to carry the full per-item quote
        //    linkage onto order_items.
        // --------------------------------------------------
        const itemsResult = await pool.query(
            `SELECT ci.checkout_item_id, ci.cart_item_id, ci.quote_id, ci.quote_item_id, ci.quote_type_id,
                    ci.product_id, ci.seller_id, ci.warehouse_id, ci.quantity, ci.unit_price,
                    ci.tax_amount, ci.discount_amount, ci.final_price,
                    cd.uom_id
             FROM public.checkout_items ci
             LEFT JOIN public.cart_details cd
               ON cd.cart_item_id = ci.cart_item_id
             WHERE ci.checkout_id = $1
               AND ci.is_deleted  = FALSE`,
            [payment.checkout_id]
        );

        if (itemsResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No checkout items found" });

        const buyer_id = checkout.buyer_id;

        // Single quote assumption — order.buyer_quote_id is one column,
        // so we take the first non-null quote_id found among items.
        // CHANGE (schema update): orders.buyer_quote_id no longer exists
        // as a stored column — buyer_quote_id here is now purely a
        // derived, in-memory value used to drive the rest of this
        // responder's logic (address resolution, quote conversion, etc).
        // Guarded below in case a checkout somehow spans >1 quote.
        const distinctQuoteIds = [...new Set(itemsResult.rows.filter((r) => r.quote_id !== null).map((r) => r.quote_id))];

        if (distinctQuoteIds.length > 1)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              "This checkout references more than one quote — order creation only supports a single quote per checkout",
            });

        const buyer_quote_id = distinctQuoteIds[0] ?? null;

        // --------------------------------------------------
        // 4b. FETCH ACTIVE checkout_service_charges TO COPY OVER
        //     Read here, pre-transaction, alongside the other checkout
        //     reads — inserted into order_service_charges once order_id
        //     exists (step 12b below).
        // --------------------------------------------------
        const checkoutServiceChargesResult = await pool.query(
            `SELECT service_charge_id, charge_type, charge_value, charge_amount
             FROM public.checkout_service_charges
             WHERE checkout_id = $1
               AND is_active   = TRUE
               AND is_deleted  = FALSE`,
            [payment.checkout_id]
        );

        // --------------------------------------------------
        // 5. RESOLVE MASTER DATA (statuses)
        // --------------------------------------------------
        const [
            orderStatusResult,
            orcCheckoutStatusResult,
            orcCheckoutItemStatusResult,
            orcCartItemStatusResult,
        ] = await Promise.all([
            pool.query(`SELECT order_status_id FROM public.order_statuses WHERE code = 'PND' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT checkout_status_id FROM public.checkout_status WHERE code = 'ORC' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT checkout_item_status_id FROM public.checkout_item_status WHERE code = 'ORC' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT cart_item_status_id FROM public.cart_item_status WHERE code = 'ORC' AND is_active = TRUE AND is_deleted = FALSE`),
        ]);

        if (
            orderStatusResult.rowCount === 0 ||
            orcCheckoutStatusResult.rowCount === 0 ||
            orcCheckoutItemStatusResult.rowCount === 0 ||
            orcCartItemStatusResult.rowCount === 0
        ) {
            logger.error("order-create: missing master data — order_statuses(PND) / checkout_status(ORC) / checkout_item_status(ORC) / cart_item_status(ORC)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const pending_order_status_id  = orderStatusResult.rows[0].order_status_id;
        const orc_checkout_status_id   = orcCheckoutStatusResult.rows[0].checkout_status_id;
        const orc_checkout_item_status_id = orcCheckoutItemStatusResult.rows[0].checkout_item_status_id;
        const orc_cart_item_status_id  = orcCartItemStatusResult.rows[0].cart_item_status_id;

        let cnv_quote_status_id = null;
        if (buyer_quote_id) {
            const quoteStatusResult = await pool.query(
                `SELECT quote_status_id FROM public.quote_statuses WHERE code = 'CNV' AND is_active = TRUE AND is_deleted = FALSE`
            );
            if (quoteStatusResult.rowCount === 0) {
                logger.error("order-create: missing master data — quote_statuses(CNV)");
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
            }
            cnv_quote_status_id = quoteStatusResult.rows[0].quote_status_id;
        }

        // --------------------------------------------------
        // 6. RESOLVE SHIPPING ADDRESS + GOOGLEMAP LINK
        //    Quote checkout -> buyer_saved_quote.customer_address
        //    Cart checkout  -> account_addresses (account_type_id=2, address_type_id=1)
        // --------------------------------------------------
        let buyer_shipping_address = null;
        let googlemap_link = null;

        if (buyer_quote_id) {
            const quoteAddrResult = await pool.query(
                `SELECT customer_address FROM public.buyer_saved_quote
                 WHERE buyer_quote_id = $1 AND is_deleted = FALSE`,
                [buyer_quote_id]
            );
            if (quoteAddrResult.rowCount === 0)
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Linked quote not found" });

            buyer_shipping_address = quoteAddrResult.rows[0].customer_address;
        }

        const addrResult = await pool.query(
            `SELECT address_line1, address_line2, googlemap_link
             FROM public.account_addresses
             WHERE account_id      = $1
               AND account_type_id = 2
               AND address_type_id = 1
               AND is_active       = TRUE
               AND is_deleted      = FALSE
             LIMIT 1`,
            [buyer_id]
        );

        if (addrResult.rowCount > 0) {
            googlemap_link = addrResult.rows[0].googlemap_link;
            if (!buyer_shipping_address) {
                buyer_shipping_address = [addrResult.rows[0].address_line1, addrResult.rows[0].address_line2]
                    .filter(Boolean)
                    .join(", ");
            }
        }

        if (!buyer_shipping_address)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No shipping address found for buyer" });

        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 7. GENERATE ORDER CODE (ODR00001, ODR00002 ...)
        // --------------------------------------------------
        await client.query(`SELECT pg_advisory_xact_lock($1)`, [commonenum.ORDER_SEQ_LOCK_KEY]);

        const orderSeqResult = await client.query(`SELECT COUNT(*) AS total_count FROM public.orders`);
        const orderSeq = (Number(orderSeqResult.rows[0].total_count) + 1).toString().padStart(5, "0");
        const order_code = `ODR${orderSeq}`;

        // --------------------------------------------------
        // 8. TOTALS
        // --------------------------------------------------
        const total_quantity = itemsResult.rows.reduce((sum, r) => sum + Number(r.quantity), 0);

        // --------------------------------------------------
        // 9. INSERT orders
        //    CHANGE (schema update): buyer_quote_id and quote_accepted_at
        //    columns removed from this table — both now live on
        //    order_items (per-item), inserted in step 10a below.
        // --------------------------------------------------
        const orderInsert = await client.query({
            text: `INSERT INTO public.orders (
                        order_code, buyer_id, payment_modes_id,
                        order_date, order_status_id,
                        total_quantity, subtotal_amount, total_vat_amount,
                        total_discount, total_shipping_charges, total_price,
                        buyer_shipping_address, googlemap_link,
                        assigned_to, assigned_at, created_by
                   ) VALUES (
                        $1, $2, $3,
                        $4, $5,
                        $6, $7, $8,
                        $9, $10, $11,
                        $12, $13,
                        $14, $15, $16
                   )
                   RETURNING order_id, order_uuid, order_code`,
            values: [
                order_code, buyer_id, payment.payment_modes_id,
                now, pending_order_status_id,
                total_quantity, checkout.subtotal, checkout.tax_amount,
                checkout.discount_amount, checkout.shipping_charge, checkout.grand_total,
                buyer_shipping_address, googlemap_link,
                created_by, now, created_by,
            ],
        });

        const { order_id, order_uuid } = orderInsert.rows[0];

        // --------------------------------------------------
        // 10. PER-SELLER GROUP: order_items + sub_orders (shared suborder_code per seller)
        //     A seller with multiple products in this order gets ONE
        //     suborder_code (SO{order_id}-001), matching the real-world
        //     shipment model — see confirmed data pattern:
        //       SO1003-001 -> Model Auto Parts (P001, P002)
        //       SO1003-002 -> China Auto Parts  (P003)
        // --------------------------------------------------
        const itemsBySeller = {};
        for (const item of itemsResult.rows) {
            if (!itemsBySeller[item.seller_id]) itemsBySeller[item.seller_id] = [];
            itemsBySeller[item.seller_id].push(item);
        }

        let suborderSeq = 0;
        const createdOrderItems = [];

        for (const sellerId of Object.keys(itemsBySeller)) {
            suborderSeq += 1;
            const suborder_code = `SO${order_id}-${suborderSeq.toString().padStart(3, "0")}`;
            const sellerItems = itemsBySeller[sellerId];

            for (const item of sellerItems) {
                // 10a. order_items
                //      CHANGE (schema update): quote_id / quote_item_id /
                //      quote_type_id carried over per-item from
                //      checkout_items. quote_accepted_at set to
                //      payment.paid_at (same value orders.quote_accepted_at
                //      used previously) whenever this item is quote-linked —
                //      logic unchanged, only relocated to the item row.
                const oiResult = await client.query({
                    text: `INSERT INTO public.order_items (
                                order_id, product_id, quantity, order_item_status_id,
                                quote_id, quote_item_id, quote_type_id, quote_accepted_at,
                                uom_id, warehouse_id, unit_price, vat_amount, discount_amount, total_price,
                                assigned_to, assigned_at, created_by
                           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
                           RETURNING order_item_id, order_item_uuid`,
                    values: [
                        order_id, item.product_id, item.quantity, pending_order_status_id,
                        item.quote_id, item.quote_item_id, item.quote_type_id, item.quote_id ? payment.paid_at : null,
                        item.uom_id, item.warehouse_id, item.unit_price, item.tax_amount, item.discount_amount, item.final_price,
                        created_by, now, created_by,
                    ],
                });
                createdOrderItems.push(oiResult.rows[0]);

                // 10b. sub_orders — SAME suborder_code for every product from this seller
                await client.query({
                    text: `INSERT INTO public.sub_orders (
                                suborder_code, order_id, product_id, seller_id, suborder_status_id,
                                total_quantity, total_price, shipping_charge,
                                assigned_to, assigned_at, created_by
                           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                    values: [
                        suborder_code, order_id, item.product_id, item.seller_id, pending_order_status_id,
                        item.quantity, item.final_price, 0,
                        created_by, now, created_by,
                    ],
                });

                // 10c. Commit stock — deduct onhand_qty, release matching reserved_qty
                const invUpdate = await client.query({
                    text: `UPDATE public.seller_inventory
                              SET onhand_qty   = onhand_qty - $1,
                                  reserved_qty = reserved_qty - $1,
                                  modified_at  = $2,
                                  modified_by  = $3
                            WHERE product_id   = $4
                              AND seller_id    = $5
                              AND warehouse_id = $6
                              AND onhand_qty  >= $1
                              AND is_deleted   = FALSE`,
                    values: [item.quantity, now, created_by, item.product_id, item.seller_id, item.warehouse_id],
                });

                if (invUpdate.rowCount === 0) {
                    await client.query("ROLLBACK");
                    inTransaction = false;
                    return cb(null, {
                        header_type: "ERROR", message_visibility: true, status: false,
                        code: 2007, message: "Insufficient stock",
                        error: `Unable to commit stock for product_id ${item.product_id} (seller_id ${item.seller_id})`,
                    });
                }

                // 10d. Roll source cart_details item to ORC (if it came from a cart item)
                if (item.cart_item_id) {
                    await client.query({
                        text: `UPDATE public.cart_details
                                  SET cart_item_status_id = $1, modified_at = $2, modified_by = $3
                                WHERE cart_item_id = $4 AND is_deleted = FALSE`,
                        values: [orc_cart_item_status_id, now, created_by, item.cart_item_id],
                    });
                }
            }
        }

        // --------------------------------------------------
        // 11. UPDATE payment_transactions — link order_id
        // --------------------------------------------------
        await client.query({
            text: `UPDATE public.payment_transactions
                      SET order_id = $1, modified_at = $2, modified_by = $3
                    WHERE payment_id = $4`,
            values: [order_id, now, created_by, payment.payment_id],
        });

        // --------------------------------------------------
        // 12. UPDATE checkout_details + checkout_items -> ORC
        // --------------------------------------------------
        await client.query({
            text: `UPDATE public.checkout_details
                      SET checkout_status_id = $1, modified_at = $2, modified_by = $3
                    WHERE checkout_id = $4`,
            values: [orc_checkout_status_id, now, created_by, payment.checkout_id],
        });

        await client.query({
            text: `UPDATE public.checkout_items
                      SET checkout_item_status_id = $1, modified_at = $2, modified_by = $3
                    WHERE checkout_id = $4 AND is_deleted = FALSE`,
            values: [orc_checkout_item_status_id, now, created_by, payment.checkout_id],
        });

        // --------------------------------------------------
        // 12b. COPY checkout_service_charges -> order_service_charges
        //      Straight snapshot of what was fetched in step 4b.
        //      Source checkout_service_charges rows are left AS-IS
        //      (is_active stays TRUE) — confirmed decision, no
        //      "converted" marker needed since the parent checkout
        //      is already terminal at ORC.
        // --------------------------------------------------
        const orderServiceCharges = [];

        for (const sc of checkoutServiceChargesResult.rows) {
            const osInsert = await client.query({
                text: `INSERT INTO public.order_service_charges (
                            order_id, service_charge_id, charge_type, charge_value, charge_amount,
                            assigned_to, assigned_at, created_by
                       ) VALUES (
                            $1, $2, $3, $4, $5,
                            $6, $7, $8
                       )
                       RETURNING order_service_charge_id, order_service_charge_uuid`,
                values: [
                    order_id,
                    sc.service_charge_id,
                    sc.charge_type,
                    sc.charge_value,
                    sc.charge_amount,
                    created_by,
                    now,
                    created_by,
                ],
            });

            orderServiceCharges.push({
                order_service_charge_id:   osInsert.rows[0].order_service_charge_id,
                order_service_charge_uuid: osInsert.rows[0].order_service_charge_uuid,
                service_charge_id:         sc.service_charge_id,
                charge_type:               sc.charge_type,
                charge_value:              Number(sc.charge_value),
                charge_amount:             Number(sc.charge_amount),
            });
        }

        const total_service_charge = parseFloat(
            orderServiceCharges.reduce((sum, sc) => sum + sc.charge_amount, 0).toFixed(2)
        );

        // --------------------------------------------------
        // 13. CONVERT QUOTE (if this order originated from a quote)
        // --------------------------------------------------
        if (buyer_quote_id) {
            await client.query({
                text: `UPDATE public.buyer_saved_quote
                          SET status_of_quote = $1, modified_at = $2, modified_by = $3
                        WHERE buyer_quote_id = $4 AND is_deleted = FALSE`,
                values: [cnv_quote_status_id, now, created_by, buyer_quote_id],
            });
        }

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 14. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Order created successfully",
            data: {
                order_id,
                order_uuid,
                order_code,
                buyer_quote_id,
                total_quantity,
                total_price: checkout.grand_total,
                item_count: createdOrderItems.length,
                seller_count: Object.keys(itemsBySeller).length,
                service_charges: orderServiceCharges,
                total_service_charge,
                created_at: now,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (order-create):", err);
        saveErrorLog({
            api_name: "order-create",
            method: "RESPONDER",
            payload: req,
            message: "Internal server error",
            stack: err.stack,
            error_code: 2004,
        });
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Order creation failed",
            error: err.message,
        });
    } finally {
        client.release();
    }
});


responder.on("order-create", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const { payment_uuid, created_by } = req.body;

        const now = new Date();

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!payment_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "payment_uuid is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created_by is required" });

        // --------------------------------------------------
        // 2. RESOLVE PAYMENT TRANSACTION (must be SUC, and not already converted)
        // --------------------------------------------------
        const paymentResult = await pool.query(
            `SELECT pt.payment_id, pt.checkout_id, pt.buyer_id, pt.order_id,
                    pt.payment_modes_id, pt.paid_at, ps.code AS payment_status_code
             FROM public.payment_transactions pt
             JOIN public.payment_statuses ps
               ON ps.payment_status_id = pt.payment_status_id
             WHERE pt.payment_uuid = $1
               AND pt.is_deleted   = FALSE`,
            [payment_uuid.trim()]
        );

        if (paymentResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No payment transaction found for the provided UUID" });

        const payment = paymentResult.rows[0];

        if (payment.payment_status_code !== "SUC")
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2008, message: "Action not allowed", error: `Payment status is '${payment.payment_status_code}', order cannot be created` });

        // Idempotency guard — this payment already has an order linked
        if (payment.order_id !== null)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2002, message: "Action not allowed", error: "Order already created for this payment" });

        // --------------------------------------------------
        // 3. RESOLVE CHECKOUT HEADER (must be PSC)
        // --------------------------------------------------
        const checkoutResult = await pool.query(
            `SELECT cd.checkout_id, cd.buyer_id, cd.subtotal, cd.tax_amount,
                    cd.shipping_charge, cd.discount_amount, cd.grand_total,
                    cs.code AS checkout_status_code
             FROM public.checkout_details cd
             JOIN public.checkout_status cs
               ON cs.checkout_status_id = cd.checkout_status_id
             WHERE cd.checkout_id = $1
               AND cd.is_deleted  = FALSE`,
            [payment.checkout_id]
        );

        if (checkoutResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Checkout session not found" });

        const checkout = checkoutResult.rows[0];

        if (checkout.checkout_status_code !== "PSC")
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2008, message: "Action not allowed", error: `Checkout status is '${checkout.checkout_status_code}', order cannot be created` });

        // --------------------------------------------------
        // 4. FETCH CHECKOUT ITEMS (join cart_details for uom_id fallback)
        //    CHANGE (schema update): now also pulls ci.warehouse_type_id
        //    alongside the existing ci.warehouse_id — needed to populate
        //    the new order_items.warehouse_type_id / sub_orders.warehouse_type_id
        //    columns. cd.warehouse_type_id kept as a fallback the same way
        //    cd.uom_id already backstops a null on the checkout_items row.
        // --------------------------------------------------
        const itemsResult = await pool.query(
            `SELECT ci.checkout_item_id, ci.cart_item_id, ci.quote_id, ci.quote_item_id, ci.quote_type_id,
                    ci.product_id, ci.seller_id, ci.warehouse_id,
                    COALESCE(ci.warehouse_type_id, cd.warehouse_type_id) AS warehouse_type_id,
                    ci.quantity, ci.unit_price,
                    ci.tax_amount, ci.discount_amount, ci.final_price,
                    cd.uom_id
             FROM public.checkout_items ci
             LEFT JOIN public.cart_details cd
               ON cd.cart_item_id = ci.cart_item_id
             WHERE ci.checkout_id = $1
               AND ci.is_deleted  = FALSE`,
            [payment.checkout_id]
        );

        if (itemsResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No checkout items found" });

        const buyer_id = checkout.buyer_id;

        // Single quote assumption — order.buyer_quote_id is one column,
        // so we take the first non-null quote_id found among items.
        // CHANGE (schema update): orders.buyer_quote_id no longer exists
        // as a stored column — buyer_quote_id here is now purely a
        // derived, in-memory value used to drive the rest of this
        // responder's logic (address resolution, quote conversion, etc).
        // Guarded below in case a checkout somehow spans >1 quote.
        const distinctQuoteIds = [...new Set(itemsResult.rows.filter((r) => r.quote_id !== null).map((r) => r.quote_id))];

        if (distinctQuoteIds.length > 1)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              "This checkout references more than one quote — order creation only supports a single quote per checkout",
            });

        const buyer_quote_id = distinctQuoteIds[0] ?? null;

        // --------------------------------------------------
        // 4b. FETCH ACTIVE checkout_service_charges TO COPY OVER
        //     Read here, pre-transaction, alongside the other checkout
        //     reads — inserted into order_service_charges once order_id
        //     exists (step 12b below).
        // --------------------------------------------------
        const checkoutServiceChargesResult = await pool.query(
            `SELECT service_charge_id, charge_type, charge_value, charge_amount
             FROM public.checkout_service_charges
             WHERE checkout_id = $1
               AND is_active   = TRUE
               AND is_deleted  = FALSE`,
            [payment.checkout_id]
        );

        // --------------------------------------------------
        // 5. RESOLVE MASTER DATA (statuses)
        // --------------------------------------------------
        const [
            orderStatusResult,
            orcCheckoutStatusResult,
            orcCheckoutItemStatusResult,
            orcCartItemStatusResult,
        ] = await Promise.all([
            pool.query(`SELECT order_status_id FROM public.order_statuses WHERE code = 'PND' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT checkout_status_id FROM public.checkout_status WHERE code = 'ORC' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT checkout_item_status_id FROM public.checkout_item_status WHERE code = 'ORC' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT cart_item_status_id FROM public.cart_item_status WHERE code = 'ORC' AND is_active = TRUE AND is_deleted = FALSE`),
        ]);

        if (
            orderStatusResult.rowCount === 0 ||
            orcCheckoutStatusResult.rowCount === 0 ||
            orcCheckoutItemStatusResult.rowCount === 0 ||
            orcCartItemStatusResult.rowCount === 0
        ) {
            logger.error("order-create: missing master data — order_statuses(PND) / checkout_status(ORC) / checkout_item_status(ORC) / cart_item_status(ORC)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const pending_order_status_id  = orderStatusResult.rows[0].order_status_id;
        const orc_checkout_status_id   = orcCheckoutStatusResult.rows[0].checkout_status_id;
        const orc_checkout_item_status_id = orcCheckoutItemStatusResult.rows[0].checkout_item_status_id;
        const orc_cart_item_status_id  = orcCartItemStatusResult.rows[0].cart_item_status_id;

        let cnv_quote_status_id = null;
        if (buyer_quote_id) {
            const quoteStatusResult = await pool.query(
                `SELECT quote_status_id FROM public.quote_statuses WHERE code = 'CNV' AND is_active = TRUE AND is_deleted = FALSE`
            );
            if (quoteStatusResult.rowCount === 0) {
                logger.error("order-create: missing master data — quote_statuses(CNV)");
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
            }
            cnv_quote_status_id = quoteStatusResult.rows[0].quote_status_id;
        }

        // --------------------------------------------------
        // 6. RESOLVE SHIPPING ADDRESS + GOOGLEMAP LINK
        //    Quote checkout -> buyer_saved_quote.customer_address
        //    Cart checkout  -> account_addresses (account_type_id=2, address_type_id=1)
        // --------------------------------------------------
        let buyer_shipping_address = null;
        let googlemap_link = null;

        if (buyer_quote_id) {
            const quoteAddrResult = await pool.query(
                `SELECT customer_address FROM public.buyer_saved_quote
                 WHERE buyer_quote_id = $1 AND is_deleted = FALSE`,
                [buyer_quote_id]
            );
            if (quoteAddrResult.rowCount === 0)
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Linked quote not found" });

            buyer_shipping_address = quoteAddrResult.rows[0].customer_address;
        }

        const addrResult = await pool.query(
            `SELECT address_line1, address_line2, googlemap_link
             FROM public.account_addresses
             WHERE account_id      = $1
               AND account_type_id = 2
               AND address_type_id = 1
               AND is_active       = TRUE
               AND is_deleted      = FALSE
             LIMIT 1`,
            [buyer_id]
        );

        if (addrResult.rowCount > 0) {
            googlemap_link = addrResult.rows[0].googlemap_link;
            if (!buyer_shipping_address) {
                buyer_shipping_address = [addrResult.rows[0].address_line1, addrResult.rows[0].address_line2]
                    .filter(Boolean)
                    .join(", ");
            }
        }

        if (!buyer_shipping_address)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No shipping address found for buyer" });

        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 7. GENERATE ORDER CODE (ODR00001, ODR00002 ...)
        // --------------------------------------------------
        await client.query(`SELECT pg_advisory_xact_lock($1)`, [commonenum.ORDER_SEQ_LOCK_KEY]);

        const orderSeqResult = await client.query(`SELECT COUNT(*) AS total_count FROM public.orders`);
        const orderSeq = (Number(orderSeqResult.rows[0].total_count) + 1).toString().padStart(5, "0");
        const order_code = `ODR${orderSeq}`;

        // --------------------------------------------------
        // 8. TOTALS
        // --------------------------------------------------
        const total_quantity = itemsResult.rows.reduce((sum, r) => sum + Number(r.quantity), 0);

        // --------------------------------------------------
        // 9. INSERT orders
        //    CHANGE (schema update): buyer_quote_id and quote_accepted_at
        //    columns removed from this table — both now live on
        //    order_items (per-item), inserted in step 10a below.
        // --------------------------------------------------
        const orderInsert = await client.query({
            text: `INSERT INTO public.orders (
                        order_code, buyer_id, payment_modes_id,
                        order_date, order_status_id,
                        total_quantity, subtotal_amount, total_vat_amount,
                        total_discount, total_shipping_charges, total_price,
                        buyer_shipping_address, googlemap_link,
                        assigned_to, assigned_at, created_by
                   ) VALUES (
                        $1, $2, $3,
                        $4, $5,
                        $6, $7, $8,
                        $9, $10, $11,
                        $12, $13,
                        $14, $15, $16
                   )
                   RETURNING order_id, order_uuid, order_code`,
            values: [
                order_code, buyer_id, payment.payment_modes_id,
                now, pending_order_status_id,
                total_quantity, checkout.subtotal, checkout.tax_amount,
                checkout.discount_amount, checkout.shipping_charge, checkout.grand_total,
                buyer_shipping_address, googlemap_link,
                created_by, now, created_by,
            ],
        });

        const { order_id, order_uuid } = orderInsert.rows[0];

        // --------------------------------------------------
        // 10. PER-SELLER GROUP: order_items + sub_orders (shared suborder_code per seller)
        //     A seller with multiple products in this order gets ONE
        //     suborder_code (SO{order_id}-001), matching the real-world
        //     shipment model — see confirmed data pattern:
        //       SO1003-001 -> Model Auto Parts (P001, P002)
        //       SO1003-002 -> China Auto Parts  (P003)
        //
        //    CHANGE (schema update): sub_orders now carries warehouse_id
        //    (NOT NULL) + warehouse_type_id, and its unique constraint is
        //    (suborder_code, product_id, warehouse_id) — a seller's
        //    suborder can repeat the same product_id as long as it comes
        //    from a different warehouse_id (separate physical shipment).
        //    So the grouping key for sub_orders below is product_id +
        //    warehouse_id together, NOT product_id alone.
        // --------------------------------------------------
        const itemsBySeller = {};
        for (const item of itemsResult.rows) {
            if (!itemsBySeller[item.seller_id]) itemsBySeller[item.seller_id] = [];
            itemsBySeller[item.seller_id].push(item);
        }

        let suborderSeq = 0;
        const createdOrderItems = [];

        for (const sellerId of Object.keys(itemsBySeller)) {
            suborderSeq += 1;
            const suborder_code = `SO${order_id}-${suborderSeq.toString().padStart(3, "0")}`;
            const sellerItems = itemsBySeller[sellerId];

            // --- 10a. order_items — one row per original checkout item ---
            for (const item of sellerItems) {
                // CHANGE (schema update): warehouse_type_id carried over
                // per-item from checkout_items (with cart_details fallback,
                // resolved in step 4), same pattern as warehouse_id.
                const oiResult = await client.query({
                    text: `INSERT INTO public.order_items (
                                order_id, product_id, quantity, order_item_status_id,
                                quote_id, quote_item_id, quote_type_id, quote_accepted_at,
                                uom_id, warehouse_id, warehouse_type_id, unit_price, vat_amount, discount_amount, total_price,
                                assigned_to, assigned_at, created_by
                           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
                           RETURNING order_item_id, order_item_uuid`,
                    values: [
                        order_id, item.product_id, item.quantity, pending_order_status_id,
                        item.quote_id, item.quote_item_id, item.quote_type_id, item.quote_id ? payment.paid_at : null,
                        item.uom_id, item.warehouse_id, item.warehouse_type_id, item.unit_price, item.tax_amount, item.discount_amount, item.final_price,
                        created_by, now, created_by,
                    ],
                });
                createdOrderItems.push(oiResult.rows[0]);

                // 10c. Commit stock — deduct onhand_qty, release matching reserved_qty
                const invUpdate = await client.query({
                    text: `UPDATE public.seller_inventory
                              SET onhand_qty   = onhand_qty - $1,
                                  reserved_qty = reserved_qty - $1,
                                  modified_at  = $2,
                                  modified_by  = $3
                            WHERE product_id   = $4
                              AND seller_id    = $5
                              AND warehouse_id = $6
                              AND onhand_qty  >= $1
                              AND is_deleted   = FALSE`,
                    values: [item.quantity, now, created_by, item.product_id, item.seller_id, item.warehouse_id],
                });

                if (invUpdate.rowCount === 0) {
                    await client.query("ROLLBACK");
                    inTransaction = false;
                    return cb(null, {
                        header_type: "ERROR", message_visibility: true, status: false,
                        code: 2007, message: "Insufficient stock",
                        error: `Unable to commit stock for product_id ${item.product_id} (seller_id ${item.seller_id})`,
                    });
                }

                // 10d. Roll source cart_details item to ORC (if it came from a cart item)
                if (item.cart_item_id) {
                    await client.query({
                        text: `UPDATE public.cart_details
                                  SET cart_item_status_id = $1, modified_at = $2, modified_by = $3
                                WHERE cart_item_id = $4 AND is_deleted = FALSE`,
                        values: [orc_cart_item_status_id, now, created_by, item.cart_item_id],
                    });
                }
            }

            // --- 10b. sub_orders — one row per DISTINCT (product_id, warehouse_id)
            //     within this seller. Same product from two different
            //     warehouses = two separate suborder rows (separate shipments).
            //     Same product + same warehouse across multiple checkout
            //     items = merged into one row (quantity/price summed).
            const itemsByProductWarehouse = {};
            for (const item of sellerItems) {
                const key = `${item.product_id}_${item.warehouse_id}`;
                if (!itemsByProductWarehouse[key]) {
                    itemsByProductWarehouse[key] = { ...item, quantity: 0, final_price: 0 };
                }
                itemsByProductWarehouse[key].quantity    += Number(item.quantity);
                itemsByProductWarehouse[key].final_price += Number(item.final_price);
            }

            for (const key of Object.keys(itemsByProductWarehouse)) {
                const agg = itemsByProductWarehouse[key];
                await client.query({
                    text: `INSERT INTO public.sub_orders (
                                suborder_code, order_id, product_id, seller_id, warehouse_id, warehouse_type_id, suborder_status_id,
                                total_quantity, total_price, shipping_charge,
                                assigned_to, assigned_at, created_by
                           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                    values: [
                        suborder_code, order_id, agg.product_id, agg.seller_id, agg.warehouse_id, agg.warehouse_type_id, pending_order_status_id,
                        agg.quantity, agg.final_price, 0,
                        created_by, now, created_by,
                    ],
                });
            }
        }

        // --------------------------------------------------
        // 11. UPDATE payment_transactions — link order_id
        // --------------------------------------------------
        await client.query({
            text: `UPDATE public.payment_transactions
                      SET order_id = $1, modified_at = $2, modified_by = $3
                    WHERE payment_id = $4`,
            values: [order_id, now, created_by, payment.payment_id],
        });

        // --------------------------------------------------
        // 12. UPDATE checkout_details + checkout_items -> ORC
        // --------------------------------------------------
        await client.query({
            text: `UPDATE public.checkout_details
                      SET checkout_status_id = $1, modified_at = $2, modified_by = $3
                    WHERE checkout_id = $4`,
            values: [orc_checkout_status_id, now, created_by, payment.checkout_id],
        });

        await client.query({
            text: `UPDATE public.checkout_items
                      SET checkout_item_status_id = $1, modified_at = $2, modified_by = $3
                    WHERE checkout_id = $4 AND is_deleted = FALSE`,
            values: [orc_checkout_item_status_id, now, created_by, payment.checkout_id],
        });

        // --------------------------------------------------
        // 12b. COPY checkout_service_charges -> order_service_charges
        //      Straight snapshot of what was fetched in step 4b.
        //      Source checkout_service_charges rows are left AS-IS
        //      (is_active stays TRUE) — confirmed decision, no
        //      "converted" marker needed since the parent checkout
        //      is already terminal at ORC.
        // --------------------------------------------------
        const orderServiceCharges = [];

        for (const sc of checkoutServiceChargesResult.rows) {
            const osInsert = await client.query({
                text: `INSERT INTO public.order_service_charges (
                            order_id, service_charge_id, charge_type, charge_value, charge_amount,
                            assigned_to, assigned_at, created_by
                       ) VALUES (
                            $1, $2, $3, $4, $5,
                            $6, $7, $8
                       )
                       RETURNING order_service_charge_id, order_service_charge_uuid`,
                values: [
                    order_id,
                    sc.service_charge_id,
                    sc.charge_type,
                    sc.charge_value,
                    sc.charge_amount,
                    created_by,
                    now,
                    created_by,
                ],
            });

            orderServiceCharges.push({
                order_service_charge_id:   osInsert.rows[0].order_service_charge_id,
                order_service_charge_uuid: osInsert.rows[0].order_service_charge_uuid,
                service_charge_id:         sc.service_charge_id,
                charge_type:               sc.charge_type,
                charge_value:              Number(sc.charge_value),
                charge_amount:             Number(sc.charge_amount),
            });
        }

        const total_service_charge = parseFloat(
            orderServiceCharges.reduce((sum, sc) => sum + sc.charge_amount, 0).toFixed(2)
        );

        // --------------------------------------------------
        // 13. CONVERT QUOTE (if this order originated from a quote)
        // --------------------------------------------------
        if (buyer_quote_id) {
            await client.query({
                text: `UPDATE public.buyer_saved_quote
                          SET status_of_quote = $1, modified_at = $2, modified_by = $3
                        WHERE buyer_quote_id = $4 AND is_deleted = FALSE`,
                values: [cnv_quote_status_id, now, created_by, buyer_quote_id],
            });
        }

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 14. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Order created successfully",
            data: {
                order_id,
                order_uuid,
                order_code,
                buyer_quote_id,
                total_quantity,
                total_price: checkout.grand_total,
                item_count: createdOrderItems.length,
                seller_count: Object.keys(itemsBySeller).length,
                service_charges: orderServiceCharges,
                total_service_charge,
                created_at: now,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (order-create):", err);
        saveErrorLog({
            api_name: "order-create",
            method: "RESPONDER",
            payload: req,
            message: "Internal server error",
            stack: err.stack,
            error_code: 2004,
        });
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Order creation failed",
            error: err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// ORDER LIST WITH PAGINATION
// --------------------------------------------------


responder.on('get-buyer-orders', async (req, cb) => {
    try {
        const accessScope = req.dataAccessScope;
        const body         = req.body || {};

        const {
            buyer_uuid     = null,   // required — scopes to this buyer only
            status         = null,   // order_statuses.code — single or array e.g. ['PND','CNF']
            order_category = null,   // 'New' | 'Completed' | 'Cancelled'
            date_from      = null,   // order_date range start (YYYY-MM-DD)
            date_to        = null,   // order_date range end   (YYYY-MM-DD)
            Keyword        = null,   // free-text: order_code / quote_no
        } = body;

        // ─────────────────────────────────────────────────────────────────
        // 0. Resolve buyer_id from buyer_uuid
        // ─────────────────────────────────────────────────────────────────
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer_uuid is required" });

        const buyerRes = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid = $1
               AND is_active  = TRUE
               AND is_deleted = FALSE`,
            [buyer_uuid.trim()]
        );

        if (buyerRes.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const buyer_id = buyerRes.rows[0].buyer_id;

        // ─────────────────────────────────────────────────────────────────
        // 1. Base WHERE scaffolding
        // ─────────────────────────────────────────────────────────────────
        let extraWhereParts = [];
        let baseParams      = [];

        baseParams.push(buyer_id);
        extraWhereParts.push(`O.buyer_id = $${baseParams.length}`);
        extraWhereParts.push(`O.is_deleted = FALSE`);

        // ─────────────────────────────────────────────────────────────────
        // 2. Status filter (single code or array of codes)
        // ─────────────────────────────────────────────────────────────────
        if (status) {
            const statusArr = Array.isArray(status) ? status : [status];
            baseParams.push(statusArr);
            extraWhereParts.push(`OS.code = ANY($${baseParams.length}::text[])`);
        }

        // ─────────────────────────────────────────────────────────────────
        // 3. Order category filter (derived bucket, not a stored column)
        // ─────────────────────────────────────────────────────────────────
        if (order_category) {
            if (order_category === 'Completed') {
                extraWhereParts.push(`OS.code = 'DLV'`);
            } else if (order_category === 'Cancelled') {
                extraWhereParts.push(`OS.code IN ('CNL','RTN','RFD')`);
            } else if (order_category === 'New') {
                extraWhereParts.push(`OS.code NOT IN ('DLV','CNL','RTN','RFD')`);
            }
        }

        // ─────────────────────────────────────────────────────────────────
        // 4. Date range filter (on order_date)
        // ─────────────────────────────────────────────────────────────────
        if (date_from) {
            baseParams.push(date_from);
            extraWhereParts.push(`O.order_date >= $${baseParams.length}::date`);
        }
        if (date_to) {
            baseParams.push(date_to);
            extraWhereParts.push(`O.order_date < ($${baseParams.length}::date + INTERVAL '1 day')`);
        }

        // ─────────────────────────────────────────────────────────────────
        // 5. Keyword — order_code / quote_no
        // ─────────────────────────────────────────────────────────────────
        let pLike = null;
        if (Keyword && String(Keyword).trim() !== '') {
            baseParams.push(`%${String(Keyword).trim()}%`);
            pLike = baseParams.length;
            extraWhereParts.push(`(
                O.order_code ILIKE $${pLike}
                OR BQ.quote_no ILIKE $${pLike}
            )`);
        }

        const baseWhere = extraWhereParts.join(' AND ');

        // ─────────────────────────────────────────────────────────────────
        // 6. Derived expressions
        // ─────────────────────────────────────────────────────────────────

        // Latest payment status linked to this order
        const paymentStatusExpr = `(
            SELECT JSON_BUILD_OBJECT('code', PS.code, 'name', PS.name)
            FROM   public.payment_transactions PT
            JOIN   public.payment_statuses     PS ON PS.payment_status_id = PT.payment_status_id
            WHERE  PT.order_id   = O.order_id
              AND  PT.is_deleted = FALSE
            ORDER  BY PT.created_at DESC
            LIMIT  1
        )`;

        // Seller(s) fulfilling this order — an order can span multiple sellers via sub_orders
        const sellersExpr = `(
            SELECT COALESCE(JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(
                    'seller_id',   SA.seller_id,
                    'seller_uuid', SA.seller_uuid,
                    'seller_name', SA.business_name
                )), '[]'::json)
            FROM   public.sub_orders      SO
            JOIN   public.seller_accounts SA ON SA.seller_id = SO.seller_id
                                             AND SA.is_active  = TRUE
                                             AND SA.is_deleted = FALSE
            WHERE  SO.order_id   = O.order_id
              AND  SO.is_deleted = FALSE
        )`;

        // Delivery status — distinct suborder statuses rolled up (handles split shipments)
        const deliveryStatusExpr = `(
            SELECT COALESCE(JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(
                    'code', SOS.code,
                    'name', SOS.name
                )), '[]'::json)
            FROM   public.sub_orders     SO
            JOIN   public.order_statuses SOS ON SOS.order_status_id = SO.suborder_status_id
            WHERE  SO.order_id   = O.order_id
              AND  SO.is_deleted = FALSE
        )`;

        // Order category bucket
        const orderCategoryExpr = `(
            CASE
                WHEN OS.code = 'DLV'                    THEN 'Completed'
                WHEN OS.code IN ('CNL','RTN','RFD')     THEN 'Cancelled'
                ELSE                                          'New'
            END
        )`;

        // ─────────────────────────────────────────────────────────────────
        // 7. Default sort — most recent orders first
        // ─────────────────────────────────────────────────────────────────
        const reqBodyForHelper = { ...body };
        if (!reqBodyForHelper.SortInfo || !reqBodyForHelper.SortInfo.field) {
            reqBodyForHelper.SortInfo = { field: 'order_date', order: 'DESC' };
        }

        // ─────────────────────────────────────────────────────────────────
        // 8. Execute via buildAdvancedSearchQuery
        // ─────────────────────────────────────────────────────────────────
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: reqBodyForHelper,

            table: 'orders',
            alias: 'O',
            defaultSort: 'order_date',

            joinSql: `
                LEFT JOIN LATERAL (
                    SELECT DISTINCT oi.quote_id
                    FROM public.order_items oi
                    WHERE oi.order_id   = O.order_id
                      AND oi.quote_id  IS NOT NULL
                      AND oi.is_deleted = FALSE
                    LIMIT 1
                ) OQ ON TRUE
                LEFT JOIN public.buyer_saved_quote BQ ON BQ.buyer_quote_id  = OQ.quote_id
                LEFT JOIN public.order_statuses    OS ON OS.order_status_id = O.order_status_id
            `,

            allowedFields: [
                'order_date',
                'total_price',
                'total_quantity',
                'created_at',
            ],

            customFields: {
                order_uuid:   { select: 'O.order_uuid',  search: null, sort: null },
                order_code:   { select: 'O.order_code',  search: null, sort: 'O.order_code' },
                order_date:   { select: 'O.order_date',  search: null, sort: 'O.order_date' },

                quote_uuid:   { select: 'BQ.buyer_quote_uuid', search: null, sort: null },
                quote_no:     { select: 'BQ.quote_no',         search: 'BQ.quote_no', sort: 'BQ.quote_no' },

                order_amount: { select: 'O.total_price', search: null, sort: 'O.total_price' },

                order_status_code: { select: 'OS.code', search: null, sort: null },
                order_status_name: { select: 'OS.name', search: null, sort: null },

                order_category:  { select: orderCategoryExpr, search: null, sort: null },
                payment_status:  { select: paymentStatusExpr, search: null, sort: null },
                delivery_status: { select: deliveryStatusExpr, search: null, sort: null },
                sellers:         { select: sellersExpr, search: null, sort: null },
            },

            baseWhere,
            baseParams,
        });

        // ─────────────────────────────────────────────────────────────────
        // 9. Shape response
        // ─────────────────────────────────────────────────────────────────
        const orders = (result.data || []).map(row => ({
            orderUuid:   row.order_uuid,
            orderCode:   row.order_code,
            orderDate:   row.order_date,

            quoteUuid:   row.quote_uuid || null,
            quoteNo:     row.quote_no   || null,

            orderAmount: Number(row.order_amount) || 0,

            orderStatus: {
                code: row.order_status_code || null,
                name: row.order_status_name || null,
            },
            orderCategory:  row.order_category  || 'New',
            paymentStatus:  row.payment_status  || null,
            deliveryStatus: row.delivery_status || [],
            sellers:        row.sellers         || [],
        }));

        return cb(null, {
            header_type        : 'SUCCESS',
            message_visibility : true,
            status              : true,
            code                : 1000,
            message             : 'Orders fetched successfully',
            error               : null,
            result: {
                totalRecords : result.totalRecords,
                page         : result.page,
                pageSize     : result.pageSize,
                orders,
            },
        });

    } catch (err) {
        console.error('[get-buyer-orders] error:', err);
        await saveErrorLog({ pool, error: err, source: 'get-buyer-orders' });
        return cb(null, {
            header_type        : 'ERROR',
            message_visibility : true,
            status              : false,
            code                : 2004,
            message             : err.message,
            error               : err.message,
        });
    }
});

// --------------------------------------------------
// GET ORDER BY UUID 
// --------------------------------------------------


responder.on('getById-buyer-order', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { order_uuid } = req;

        // ----------------------------------------
        // VALIDATION
        // ----------------------------------------
        if (!order_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Order UUID is required"
            });
        }

        // ----------------------------------------
        // FETCH ORDER HEADER
        // ----------------------------------------
        const result = await client.query(
            `SELECT
                O.order_id,
                O.order_uuid,
                O.order_code,
                O.order_date,
                O.total_quantity,
                O.subtotal_amount,
                O.total_vat_amount,
                O.total_discount,
                O.total_shipping_charges,
                O.total_price,
                O.buyer_shipping_address,
                O.googlemap_link,
                O.buyer_feedback,
                O.created_at,
                O.modified_at,

                -- Buyer
                BA.buyer_id,
                BA.buyer_uuid,
                BA.business_name        AS buyer_business_name,
                BA.email_id             AS buyer_email,

                -- Order status
                OS.order_status_id,
                OS.code                 AS order_status_code,
                OS.name                 AS order_status_name,

                -- Quote reference (resolved via order_items)
                BQ.buyer_quote_id,
                BQ.buyer_quote_uuid,
                BQ.quote_no,
                OQ.quote_accepted_at,

                -- Payment mode
                PM.payment_modes_id,
                PM.code                 AS payment_mode_code,
                PM.name                 AS payment_mode_name,

                -- Created / modified by
                creators.username       AS created_by_name,
                updaters.username       AS modified_by_name

             FROM public.orders O

             JOIN public.buyer_accounts BA
                ON BA.buyer_id = O.buyer_id

             LEFT JOIN public.order_statuses OS
                ON OS.order_status_id = O.order_status_id

             LEFT JOIN LATERAL (
                 SELECT DISTINCT ON (oi.quote_id) oi.quote_id, oi.quote_accepted_at
                 FROM public.order_items oi
                 WHERE oi.order_id   = O.order_id
                   AND oi.quote_id  IS NOT NULL
                   AND oi.is_deleted = FALSE
                 LIMIT 1
             ) OQ ON TRUE

             LEFT JOIN public.buyer_saved_quote BQ
                ON BQ.buyer_quote_id = OQ.quote_id
               AND BQ.is_deleted     = FALSE

             LEFT JOIN public.payment_modes PM
                ON PM.payment_modes_id = O.payment_modes_id

             LEFT JOIN public.users creators
                ON O.created_by  = creators.user_uuid

             LEFT JOIN public.users updaters
                ON O.modified_by = updaters.user_uuid

             WHERE O.order_uuid = $1
               AND O.is_deleted = FALSE`,
            [order_uuid]
        );

        if (result.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Order not found"
            });
        }

        const order = result.rows[0];

        // ----------------------------------------
        // FETCH ORDER ITEMS + PRODUCT + SELLER + WAREHOUSE
        // (warehouse resolved DIRECTLY via order_items.warehouse_id —
        //  no more seller_inventory guesswork)
        // ----------------------------------------
        const itemsResult = await client.query(
            `SELECT
                OI.order_item_id,
                OI.order_item_uuid,
                OI.quantity,
                OI.unit_price,
                OI.vat_amount,
                OI.discount_amount,
                OI.total_price,

                -- Product
                P.product_id,
                P.product_uuid,
                P.name               AS product_name,
                P.oem_part_number    AS part_number,
                P.sku,

                -- UOM
                U.uom_id,
                U.code               AS uom_code,
                U.name               AS uom_name,

                -- Order item status
                OIS.code             AS item_status_code,
                OIS.name             AS item_status_name,

                -- Seller (via matching sub_order)
                SO.suborder_id,
                SO.suborder_uuid,
                SO.suborder_code,
                SA.seller_id,
                SA.seller_uuid,
                SA.business_name     AS seller_name,

                -- Warehouse — resolved directly via order_items.warehouse_id
                SW.warehouse_id,
                SW.warehouse_uuid,
                SW.warehouse_name,
                SW.warehouse_address,
                SW.warehouse_phone_number,
                SW.warehouse_country_code,
                SW.googlemap_link     AS warehouse_googlemap_link,
                SW.latitude           AS warehouse_latitude,
                SW.longitude          AS warehouse_longitude,

                -- Warehouse type — new on order_items
                WT.warehouse_type_id,
                WT.code               AS warehouse_type_code,
                WT.name               AS warehouse_type_name

             FROM public.order_items OI

             LEFT JOIN public.products P
                ON P.product_id = OI.product_id
               AND P.is_deleted = FALSE

             LEFT JOIN public.uom U
                ON U.uom_id     = OI.uom_id
               AND U.is_deleted = FALSE

             LEFT JOIN public.order_statuses OIS
                ON OIS.order_status_id = OI.order_item_status_id

             LEFT JOIN public.sub_orders SO
                ON SO.order_id     = OI.order_id
               AND SO.product_id   = OI.product_id
               AND SO.warehouse_id = OI.warehouse_id
               AND SO.is_deleted   = FALSE

             LEFT JOIN public.seller_accounts SA
                ON SA.seller_id  = SO.seller_id
               AND SA.is_deleted = FALSE

             LEFT JOIN public.seller_warehouse SW
                ON SW.warehouse_id = OI.warehouse_id
               AND SW.is_deleted   = FALSE

             LEFT JOIN public.warehouse_type WT
                ON WT.warehouse_type_id = OI.warehouse_type_id

             WHERE OI.order_id   = $1
               AND OI.is_deleted = FALSE

             ORDER BY OI.created_at ASC`,
            [order.order_id]
        );

        order.order_items = itemsResult.rows;

        // ----------------------------------------
        // FETCH SHIPMENT DETAILS (per sub_order — split shipments)
        // ----------------------------------------
        const shipmentsResult = await client.query(
            `SELECT
                SO.suborder_id,
                SO.suborder_uuid,
                SO.suborder_code,
                SO.product_id,
                SO.total_quantity,
                SO.total_price,
                SO.shipping_charge,
                SO.tracking_number,
                SO.courier_name,
                SO.expected_delivery_date,
                SO.actual_delivery_date,

                SOS.code             AS suborder_status_code,
                SOS.name             AS suborder_status_name,

                SA.seller_id,
                SA.seller_uuid,
                SA.business_name     AS seller_name,

                SW.warehouse_id,
                SW.warehouse_uuid,
                SW.warehouse_name,

                WT.warehouse_type_id,
                WT.code               AS warehouse_type_code,
                WT.name               AS warehouse_type_name

             FROM public.sub_orders SO

             LEFT JOIN public.order_statuses SOS
                ON SOS.order_status_id = SO.suborder_status_id

             LEFT JOIN public.seller_accounts SA
                ON SA.seller_id  = SO.seller_id
               AND SA.is_deleted = FALSE

             LEFT JOIN public.seller_warehouse SW
                ON SW.warehouse_id = SO.warehouse_id
               AND SW.is_deleted   = FALSE

             LEFT JOIN public.warehouse_type WT
                ON WT.warehouse_type_id = SO.warehouse_type_id

             WHERE SO.order_id   = $1
               AND SO.is_deleted = FALSE

             ORDER BY SO.created_at ASC`,
            [order.order_id]
        );

        order.shipments = shipmentsResult.rows;

        // ----------------------------------------
        // FETCH PAYMENT DETAILS
        // ----------------------------------------
        const paymentResult = await client.query(
            `SELECT
                PT.payment_id,
                PT.payment_uuid,
                PT.amount,
                PT.tax_amount,
                PT.discount_amount,
                PT.final_amount,
                PT.gateway_name,
                PT.gateway_reference,
                PT.attempt_number,
                PT.failure_reason,
                PT.paid_at,
                PT.created_at,

                PM.code               AS payment_mode_code,
                PM.name               AS payment_mode_name,

                PS.code               AS payment_status_code,
                PS.name               AS payment_status_name

             FROM public.payment_transactions PT

             LEFT JOIN public.payment_modes PM
                ON PM.payment_modes_id = PT.payment_modes_id

             LEFT JOIN public.payment_statuses PS
                ON PS.payment_status_id = PT.payment_status_id

             WHERE PT.order_id   = $1
               AND PT.is_deleted = FALSE

             ORDER BY PT.created_at DESC`,
            [order.order_id]
        );

        order.payments = paymentResult.rows;

        // ----------------------------------------
        // FETCH ACTIVE ORDER SERVICE CHARGES
        //     is_active = FALSE means voided (e.g. order was
        //     cancelled) — excluded so the buyer-facing view only
        //     shows what's currently applicable.
        // ----------------------------------------
        const orderServiceChargesResult = await client.query(
            `SELECT
                    osc.order_service_charge_uuid,
                    sc.name AS service_charge_name,
                    osc.charge_type,
                    osc.charge_value,
                    osc.charge_amount
               FROM public.order_service_charges osc
               JOIN public.service_charge sc
                 ON sc.service_charge_id = osc.service_charge_id
              WHERE osc.order_id  = $1
                AND osc.is_active = TRUE
                AND osc.is_deleted = FALSE
              ORDER BY osc.order_service_charge_id ASC`,
            [order.order_id]
        );

        order.service_charges = orderServiceChargesResult.rows.map((row) => ({
            order_service_charge_uuid: row.order_service_charge_uuid,
            service_charge_name:       row.service_charge_name,
            charge_type:               row.charge_type,
            charge_value:              Number(row.charge_value),
            charge_amount:             Number(row.charge_amount),
        }));

        order.total_service_charge = parseFloat(
            order.service_charges.reduce((sum, sc) => sum + sc.charge_amount, 0).toFixed(2)
        );

        // ----------------------------------------
        // ORDER TIMELINE (best-effort — a dedicated
        // order_status_history table would make this
        // fully accurate for every status transition)
        // ----------------------------------------
        const timeline = [];

        timeline.push({
            label: 'Order Placed',
            timestamp: order.created_at
        });

        const successfulPayment = order.payments.find(p => p.payment_status_code === 'SUC');
        if (successfulPayment) {
            timeline.push({
                label: 'Payment Confirmed',
                timestamp: successfulPayment.paid_at
            });
        }

        for (const shipment of order.shipments) {
            if (shipment.expected_delivery_date) {
                timeline.push({
                    label: `Expected Delivery — ${shipment.suborder_code}`,
                    timestamp: shipment.expected_delivery_date
                });
            }
            if (shipment.actual_delivery_date) {
                timeline.push({
                    label: `Delivered — ${shipment.suborder_code}`,
                    timestamp: shipment.actual_delivery_date
                });
            }
        }

        timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        order.timeline = timeline;

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Order fetched successfully",
            data: order
        });

    } catch (err) {
        logger.error("Responder Error (getById-buyer-order):", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Fetch failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// GET ACTIVE BUYER ORDERS  
// --------------------------------------------------


responder.on('get-active-buyer-orders', async (req, cb) => {
    try {
        const body = req.body || {};
        const { buyer_uuid = null } = body;

        // ─────────────────────────────────────────────────────────────────
        // 0. Resolve buyer_id
        // ─────────────────────────────────────────────────────────────────
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        const buyerRes = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid = $1
               AND is_active  = TRUE
               AND is_deleted = FALSE`,
            [buyer_uuid.trim()]
        );

        if (buyerRes.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const buyer_id = buyerRes.rows[0].buyer_id;

        // ─────────────────────────────────────────────────────────────────
        // 1. Base WHERE — restricted to the active status set only
        // ─────────────────────────────────────────────────────────────────
        const ACTIVE_STATUS_CODES = ['PND', 'CNF', 'PRC', 'SHP'];

        const baseParams = [buyer_id, ACTIVE_STATUS_CODES];
        const baseWhere = `
            O.buyer_id   = $1
            AND O.is_deleted = FALSE
            AND OS.code      = ANY($2::text[])
        `;

        // ─────────────────────────────────────────────────────────────────
        // 2. Derived expressions
        // ─────────────────────────────────────────────────────────────────

        // Nearest upcoming expected delivery date across all shipments of this order
        const expectedDeliveryExpr = `(
            SELECT MIN(SO.expected_delivery_date)
            FROM   public.sub_orders SO
            WHERE  SO.order_id   = O.order_id
              AND  SO.is_deleted = FALSE
              AND  SO.expected_delivery_date IS NOT NULL
        )`;

        // Per-shipment fulfillment breakdown — DISTINCT on suborder_code
        // since a seller shares ONE suborder_code across multiple products
        // (see confirmed data pattern: SO1003-001 -> Model Auto Parts P001+P002)
        const shipmentsExpr = `(
            SELECT COALESCE(JSON_AGG(shipment_row ORDER BY shipment_row->>'suborder_code'), '[]'::json)
            FROM (
                SELECT DISTINCT ON (SO.suborder_code)
                    JSON_BUILD_OBJECT(
                        'suborder_code',          SO.suborder_code,
                        'seller_name',            SA.business_name,
                        'status_code',            SOS.code,
                        'status_name',            SOS.name,
                        'tracking_number',        SO.tracking_number,
                        'courier_name',           SO.courier_name,
                        'expected_delivery_date', SO.expected_delivery_date
                    ) AS shipment_row
                FROM   public.sub_orders SO
                LEFT JOIN public.order_statuses  SOS ON SOS.order_status_id = SO.suborder_status_id
                LEFT JOIN public.seller_accounts SA  ON SA.seller_id = SO.seller_id AND SA.is_deleted = FALSE
                WHERE  SO.order_id   = O.order_id
                  AND  SO.is_deleted = FALSE
                ORDER BY SO.suborder_code, SO.created_at ASC
            ) grouped
        )`;

        // Available buyer actions — derived per order status.
        // PND / CNF / PRC -> cancel still allowed; SHP -> tracking only.
        const buyerActionsExpr = `(
            CASE OS.code
                WHEN 'PND' THEN '["Track Order","Cancel Order"]'::json
                WHEN 'CNF' THEN '["Track Order","Cancel Order"]'::json
                WHEN 'PRC' THEN '["Track Order","Cancel Order"]'::json
                WHEN 'SHP' THEN '["Track Order"]'::json
                ELSE '["Track Order"]'::json
            END
        )`;

        // ─────────────────────────────────────────────────────────────────
        // 3. Default sort — nearest orders first
        // ─────────────────────────────────────────────────────────────────
        const reqBodyForHelper = { ...body };
        if (!reqBodyForHelper.SortInfo || !reqBodyForHelper.SortInfo.field) {
            reqBodyForHelper.SortInfo = { field: 'order_date', order: 'DESC' };
        }

        // ─────────────────────────────────────────────────────────────────
        // 4. Execute via buildAdvancedSearchQuery (pagination handled here —
        //    page / pageSize can be passed in body, defaults apply otherwise)
        // ─────────────────────────────────────────────────────────────────
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: reqBodyForHelper,

            table: 'orders',
            alias: 'O',
            defaultSort: 'order_date',

            joinSql: `
                LEFT JOIN LATERAL (
                    SELECT DISTINCT oi.quote_id
                    FROM public.order_items oi
                    WHERE oi.order_id   = O.order_id
                      AND oi.quote_id  IS NOT NULL
                      AND oi.is_deleted = FALSE
                    LIMIT 1
                ) OQ ON TRUE
                LEFT JOIN public.buyer_saved_quote BQ ON BQ.buyer_quote_id  = OQ.quote_id
                LEFT JOIN public.order_statuses    OS ON OS.order_status_id = O.order_status_id
            `,

            allowedFields: [
                'order_date',
                'total_price',
                'total_quantity',
                'created_at',
            ],

            customFields: {
                order_uuid: { select: 'O.order_uuid', search: null, sort: null },
                order_code: { select: 'O.order_code', search: null, sort: 'O.order_code' },
                order_date: { select: 'O.order_date', search: null, sort: 'O.order_date' },

                quote_uuid: { select: 'BQ.buyer_quote_uuid', search: null, sort: null },
                quote_no:   { select: 'BQ.quote_no',         search: null, sort: null },

                order_amount: { select: 'O.total_price', search: null, sort: 'O.total_price' },

                fulfillment_status_code: { select: 'OS.code', search: null, sort: null },
                fulfillment_status_name: { select: 'OS.name', search: null, sort: null },

                expected_delivery_date: { select: expectedDeliveryExpr, search: null, sort: expectedDeliveryExpr },
                shipments:              { select: shipmentsExpr, search: null, sort: null },
                buyer_actions:          { select: buyerActionsExpr, search: null, sort: null },
            },

            baseWhere,
            baseParams,
        });

        // ─────────────────────────────────────────────────────────────────
        // 5. Shape response
        // ─────────────────────────────────────────────────────────────────
        const orders = (result.data || []).map(row => ({
            orderUuid:   row.order_uuid,
            orderCode:   row.order_code,
            orderDate:   row.order_date,

            quoteUuid:   row.quote_uuid || null,
            quoteNo:     row.quote_no   || null,

            orderAmount: Number(row.order_amount) || 0,

            fulfillmentStatus: {
                code: row.fulfillment_status_code || null,
                name: row.fulfillment_status_name || null,
            },
            expectedDeliveryDate: row.expected_delivery_date || null,
            shipments:            row.shipments || [],
            buyerActions:         row.buyer_actions || [],
        }));

        return cb(null, {
            header_type        : 'SUCCESS',
            message_visibility : true,
            status              : true,
            code                : 1000,
            message             : 'Active orders fetched successfully',
            error               : null,
            result: {
                totalRecords : result.totalRecords,
                page         : result.page,
                pageSize     : result.pageSize,
                orders,
            },
        });

    } catch (err) {
        console.error('[get-active-buyer-orders] error:', err);
        await saveErrorLog({ pool, error: err, source: 'get-active-buyer-orders' });
        return cb(null, {
            header_type        : 'ERROR',
            message_visibility : true,
            status              : false,
            code                : 2004,
            message             : err.message,
            error               : err.message,
        });
    }
});

// --------------------------------------------------
// GET COMPLETED BUYER ORDERS  
// --------------------------------------------------

responder.on('get-delivered-buyer-orders', async (req, cb) => {
    try {
        const body = req.body || {};
        const { buyer_uuid = null } = body;

        // ─────────────────────────────────────────────────────────────────
        // 0. Resolve buyer_id
        // ─────────────────────────────────────────────────────────────────
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        const buyerRes = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid = $1
               AND is_active  = TRUE
               AND is_deleted = FALSE`,
            [buyer_uuid.trim()]
        );

        if (buyerRes.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const buyer_id = buyerRes.rows[0].buyer_id;

        // ─────────────────────────────────────────────────────────────────
        // 1. Base WHERE — order status must be DLV (Delivered)
        // ─────────────────────────────────────────────────────────────────
        const baseParams = [buyer_id, 'DLV'];
        const baseWhere = `
            O.buyer_id   = $1
            AND O.is_deleted = FALSE
            AND OS.code      = $2
        `;

        // ─────────────────────────────────────────────────────────────────
        // 2. Derived expressions
        // ─────────────────────────────────────────────────────────────────

        // Delivered date — latest actual_delivery_date across all sub_orders
        // (order is fully delivered only once every shipment has arrived)
        const deliveredDateExpr = `(
            SELECT MAX(SO.actual_delivery_date)
            FROM   public.sub_orders SO
            WHERE  SO.order_id   = O.order_id
              AND  SO.is_deleted = FALSE
        )`;

        // Purchased items — full line-item list with product details
        const purchasedItemsExpr = `(
            SELECT COALESCE(JSON_AGG(JSON_BUILD_OBJECT(
                    'order_item_uuid', OI.order_item_uuid,
                    'product_uuid',    P.product_uuid,
                    'product_name',    P.name,
                    'part_number',     P.oem_part_number,
                    'sku',             P.sku,
                    'quantity',        OI.quantity,
                    'uom_code',        U.code,
                    'unit_price',      OI.unit_price,
                    'vat_amount',      OI.vat_amount,
                    'discount_amount', OI.discount_amount,
                    'total_price',     OI.total_price
                ) ORDER BY OI.created_at ASC), '[]'::json)
            FROM   public.order_items OI
            LEFT JOIN public.products P ON P.product_id = OI.product_id AND P.is_deleted = FALSE
            LEFT JOIN public.uom U      ON U.uom_id     = OI.uom_id     AND U.is_deleted  = FALSE
            WHERE  OI.order_id   = O.order_id
              AND  OI.is_deleted = FALSE
        )`;

        // Active service charge total for this order — correlated
        // subquery, same style as the other per-row expressions here.
        const totalServiceChargeExpr = `(
            SELECT COALESCE(SUM(OSC.charge_amount), 0)
            FROM   public.order_service_charges OSC
            WHERE  OSC.order_id   = O.order_id
              AND  OSC.is_active  = TRUE
              AND  OSC.is_deleted = FALSE
        )`;

        // Order summary — quick totals block
        const orderSummaryExpr = `(
            JSON_BUILD_OBJECT(
                'total_quantity',         O.total_quantity,
                'subtotal_amount',        O.subtotal_amount,
                'total_vat_amount',       O.total_vat_amount,
                'total_discount',         O.total_discount,
                'total_shipping_charges', O.total_shipping_charges,
                'total_service_charge',   ${totalServiceChargeExpr},
                'total_price',            O.total_price
            )
        )`;

        // Whether a refund already exists / is in progress for this order
        // (RFD = refunded, PEN linked to a refund flow is out of scope here —
        // payment_transactions doesn't have a distinct "refund requested" status,
        // so we only check for an already-completed RFD transaction)
        const hasRefundExpr = `(
            EXISTS (
                SELECT 1
                FROM   public.payment_transactions PT
                JOIN   public.payment_statuses PS ON PS.payment_status_id = PT.payment_status_id
                WHERE  PT.order_id   = O.order_id
                  AND  PT.is_deleted = FALSE
                  AND  PS.code       = 'RFD'
            )
        )`;

        // Available buyer actions — Reorder always available;
        // Refund Request hidden if already refunded
        const buyerActionsExpr = `(
            CASE
                WHEN ${hasRefundExpr} THEN '["Reorder"]'::json
                ELSE '["Reorder","Refund Request"]'::json
            END
        )`;

        // ─────────────────────────────────────────────────────────────────
        // 3. Default sort — most recently delivered first
        // ─────────────────────────────────────────────────────────────────
        const reqBodyForHelper = { ...body };
        if (!reqBodyForHelper.SortInfo || !reqBodyForHelper.SortInfo.field) {
            reqBodyForHelper.SortInfo = { field: 'delivered_date', order: 'DESC' };
        }

        // ─────────────────────────────────────────────────────────────────
        // 4. Execute via buildAdvancedSearchQuery
        // ─────────────────────────────────────────────────────────────────
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: reqBodyForHelper,

            table: 'orders',
            alias: 'O',
            defaultSort: 'order_date',

            joinSql: `
                LEFT JOIN LATERAL (
                    SELECT DISTINCT oi.quote_id
                    FROM public.order_items oi
                    WHERE oi.order_id   = O.order_id
                      AND oi.quote_id  IS NOT NULL
                      AND oi.is_deleted = FALSE
                    LIMIT 1
                ) OQ ON TRUE
                LEFT JOIN public.buyer_saved_quote BQ ON BQ.buyer_quote_id  = OQ.quote_id
                LEFT JOIN public.order_statuses    OS ON OS.order_status_id = O.order_status_id
            `,

            allowedFields: [
                'order_date',
                'total_price',
                'total_quantity',
                'created_at',
            ],

            customFields: {
                order_uuid: { select: 'O.order_uuid', search: null, sort: null },
                order_code: { select: 'O.order_code', search: null, sort: 'O.order_code' },
                order_date: { select: 'O.order_date', search: null, sort: 'O.order_date' },

                quote_uuid: { select: 'BQ.buyer_quote_uuid', search: null, sort: null },
                quote_no:   { select: 'BQ.quote_no',         search: null, sort: null },

                delivered_date:  { select: deliveredDateExpr, search: null, sort: deliveredDateExpr },
                order_summary:   { select: orderSummaryExpr, search: null, sort: null },
                purchased_items: { select: purchasedItemsExpr, search: null, sort: null },
                buyer_actions:   { select: buyerActionsExpr, search: null, sort: null },
            },

            baseWhere,
            baseParams,
        });

        // ─────────────────────────────────────────────────────────────────
        // 5. Shape response
        // ─────────────────────────────────────────────────────────────────
        const orders = (result.data || []).map(row => ({
            orderUuid: row.order_uuid,
            orderCode: row.order_code,
            orderDate: row.order_date,

            quoteUuid: row.quote_uuid || null,
            quoteNo:   row.quote_no   || null,

            deliveredDate:   row.delivered_date || null,
            orderSummary:    row.order_summary,
            purchasedItems:  row.purchased_items || [],
            buyerActions:    row.buyer_actions || [],
        }));

        return cb(null, {
            header_type        : 'SUCCESS',
            message_visibility : true,
            status              : true,
            code                : 1000,
            message             : 'Delivered orders fetched successfully',
            error               : null,
            result: {
                totalRecords : result.totalRecords,
                page         : result.page,
                pageSize     : result.pageSize,
                orders,
            },
        });

    } catch (err) {
        console.error('[get-delivered-buyer-orders] error:', err);
        await saveErrorLog({ pool, error: err, source: 'get-delivered-buyer-orders' });
        return cb(null, {
            header_type        : 'ERROR',
            message_visibility : true,
            status              : false,
            code                : 2004,
            message             : err.message,
            error               : err.message,
        });
    }
});

// --------------------------------------------------
// GET COMPLETED ORDERS BY UUID
// --------------------------------------------------

responder.on('get-delivered-buyer-order', async (req, cb) => {
    try {
        const { order_uuid } = req;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!order_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "order_uuid is required" });

        // --------------------------------------------------
        // 2. RESOLVE ORDER HEADER + STATUS CHECK
        // --------------------------------------------------
        const orderResult = await pool.query(
            `SELECT
                O.order_id, O.order_uuid, O.order_code, O.order_date,
                O.total_quantity, O.subtotal_amount, O.total_vat_amount,
                O.total_discount, O.total_shipping_charges, O.total_price,
                BQ.buyer_quote_uuid, BQ.quote_no,
                OS.code AS order_status_code, OS.name AS order_status_name
             FROM public.orders O
             JOIN public.order_statuses OS ON OS.order_status_id = O.order_status_id
             LEFT JOIN LATERAL (
                 SELECT DISTINCT oi.quote_id
                 FROM public.order_items oi
                 WHERE oi.order_id   = O.order_id
                   AND oi.quote_id  IS NOT NULL
                   AND oi.is_deleted = FALSE
                 LIMIT 1
             ) OQ ON TRUE
             LEFT JOIN public.buyer_saved_quote BQ ON BQ.buyer_quote_id = OQ.quote_id AND BQ.is_deleted = FALSE
             WHERE O.order_uuid = $1
               AND O.is_deleted = FALSE`,
            [order_uuid.trim()]
        );

        if (orderResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Order not found" });

        const order = orderResult.rows[0];

        if (order.order_status_code !== 'DLV')
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2008, message: "Action not allowed", error: `Order is '${order.order_status_name}', not Delivered` });

        // --------------------------------------------------
        // 3. DELIVERED DATE — latest actual_delivery_date across sub_orders
        // --------------------------------------------------
        const deliveredDateResult = await pool.query(
            `SELECT MAX(SO.actual_delivery_date) AS delivered_date
             FROM public.sub_orders SO
             WHERE SO.order_id   = $1
               AND SO.is_deleted = FALSE`,
            [order.order_id]
        );
        const delivered_date = deliveredDateResult.rows[0]?.delivered_date || null;

        // --------------------------------------------------
        // 3b. TOTAL ACTIVE SERVICE CHARGES ON THIS ORDER
        // --------------------------------------------------
        const serviceChargeSumResult = await pool.query(
            `SELECT COALESCE(SUM(charge_amount), 0) AS total_service_charge
             FROM public.order_service_charges
             WHERE order_id   = $1
               AND is_active  = TRUE
               AND is_deleted = FALSE`,
            [order.order_id]
        );

        const total_service_charge = parseFloat(
            Number(serviceChargeSumResult.rows[0].total_service_charge).toFixed(2)
        );

        // --------------------------------------------------
        // 4. PURCHASED ITEMS
        // --------------------------------------------------
        const itemsResult = await pool.query(
            `SELECT
                OI.order_item_uuid,
                P.product_uuid, P.name AS product_name, P.oem_part_number AS part_number, P.sku,
                OI.quantity, U.code AS uom_code,
                OI.unit_price, OI.vat_amount, OI.discount_amount, OI.total_price
             FROM public.order_items OI
             LEFT JOIN public.products P ON P.product_id = OI.product_id AND P.is_deleted = FALSE
             LEFT JOIN public.uom U      ON U.uom_id     = OI.uom_id     AND U.is_deleted  = FALSE
             WHERE OI.order_id   = $1
               AND OI.is_deleted = FALSE
             ORDER BY OI.created_at ASC`,
            [order.order_id]
        );

        // --------------------------------------------------
        // 5. REFUND CHECK — for Refund Request action eligibility
        // --------------------------------------------------
        const refundCheckResult = await pool.query(
            `SELECT EXISTS (
                SELECT 1
                FROM public.payment_transactions PT
                JOIN public.payment_statuses PS ON PS.payment_status_id = PT.payment_status_id
                WHERE PT.order_id   = $1
                  AND PT.is_deleted = FALSE
                  AND PS.code       = 'RFD'
             ) AS has_refund`,
            [order.order_id]
        );
        const hasRefund = refundCheckResult.rows[0].has_refund;

        const buyerActions = hasRefund ? ['Reorder'] : ['Reorder', 'Refund Request'];

        // --------------------------------------------------
        // 6. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Delivered order fetched successfully",
            data: {
                orderUuid: order.order_uuid,
                orderCode: order.order_code,
                orderDate: order.order_date,

                quoteUuid: order.buyer_quote_uuid || null,
                quoteNo:   order.quote_no || null,

                deliveredDate: delivered_date,

                orderSummary: {
                    total_quantity: order.total_quantity,
                    subtotal_amount: order.subtotal_amount,
                    total_vat_amount: order.total_vat_amount,
                    total_discount: order.total_discount,
                    total_shipping_charges: order.total_shipping_charges,
                    total_service_charge,
                    total_price: order.total_price,
                },

                purchasedItems: itemsResult.rows,
                buyerActions,
            },
        });

    } catch (err) {
        logger.error("Responder Error (get-delivered-buyer-order):", err);
        saveErrorLog({
            api_name: "get-delivered-buyer-order",
            method: "RESPONDER",
            payload: req,
            message: "Internal server error",
            stack: err.stack,
            error_code: 2004,
        });
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Fetch failed",
            error: err.message,
        });
    }
});

// --------------------------------------------------
// ORDER CANCELLATION 
// --------------------------------------------------

responder.on('order-cancel', async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const { order_uuid, cancellation_reason, cancelled_by } = req.body;

        const now = new Date();

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!order_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "order uuid is required" });

        if (!cancellation_reason?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "cancellation reason is required" });

        if (!cancelled_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "cancelled by is required" });

        // --------------------------------------------------
        // 2. RESOLVE ORDER + CURRENT STATUS
        // --------------------------------------------------
        const orderResult = await pool.query(
            `SELECT O.order_id, O.buyer_id, O.order_code,
                    OS.code AS order_status_code, OS.name AS order_status_name
             FROM public.orders O
             JOIN public.order_statuses OS ON OS.order_status_id = O.order_status_id
             WHERE O.order_uuid = $1
               AND O.is_deleted = FALSE`,
            [order_uuid.trim()]
        );

        if (orderResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Order not found" });

        const order = orderResult.rows[0];

        const TERMINAL_CODES = ['CNL', 'RTN', 'RFD', 'DLV'];

        // Order-level terminal check
        if (TERMINAL_CODES.includes(order.order_status_code))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2008, message: "Action not allowed", error: `Order is already '${order.order_status_name}' and cannot be cancelled` });

        // --------------------------------------------------
        // 3. ELIGIBILITY — check sub_orders AND order_items individually
        //    a) if ANY sub_order / order_item is already in a terminal
        //       state (CNL/RTN/RFD/DLV) -> block, something already
        //       resolved independently (e.g. partial return already processed)
        //    b) if ANY sub_order / order_item has moved to SHP or beyond
        //       (i.e. not PND/CNF/PRC) -> block, shipment already dispatched
        //    (whole-order cancellation only — partial cancellation is out
        //    of scope here)
        // --------------------------------------------------
        const PRE_SHIPMENT_CODES = ['PND', 'CNF', 'PRC'];

        const subOrdersResult = await pool.query(
            `SELECT SO.suborder_id, SO.suborder_code, SO.seller_id, SOS.code AS suborder_status_code, SOS.name AS suborder_status_name
             FROM public.sub_orders SO
             JOIN public.order_statuses SOS ON SOS.order_status_id = SO.suborder_status_id
             WHERE SO.order_id   = $1
               AND SO.is_deleted = FALSE`,
            [order.order_id]
        );

        if (subOrdersResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No shipments found for this order" });

        const orderItemsStatusResult = await pool.query(
            `SELECT OI.order_item_id, OI.product_id, OIS.code AS item_status_code, OIS.name AS item_status_name
             FROM public.order_items OI
             LEFT JOIN public.order_statuses OIS ON OIS.order_status_id = OI.order_item_status_id
             WHERE OI.order_id   = $1
               AND OI.is_deleted = FALSE`,
            [order.order_id]
        );

        if (orderItemsStatusResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No items found for this order" });

        // 3a. Terminal-state check — sub_orders
        const terminalSubOrders = subOrdersResult.rows.filter((r) => TERMINAL_CODES.includes(r.suborder_status_code));
        if (terminalSubOrders.length > 0)
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2008, message: "Action not allowed",
                error: `Order cannot be cancelled — shipment(s) already in a final state: ${terminalSubOrders.map((r) => `${r.suborder_code} (${r.suborder_status_name})`).join(', ')}`,
            });

        // 3b. Terminal-state check — order_items
        const terminalItems = orderItemsStatusResult.rows.filter((r) => TERMINAL_CODES.includes(r.item_status_code));
        if (terminalItems.length > 0)
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2008, message: "Action not allowed",
                error: `Order cannot be cancelled — item(s) already in a final state: ${terminalItems.map((r) => `product_id ${r.product_id} (${r.item_status_name})`).join(', ')}`,
            });

        // 3c. Pre-shipment check — sub_orders (catches SHP and any other in-progress code)
        const shippedSubOrders = subOrdersResult.rows.filter((r) => !PRE_SHIPMENT_CODES.includes(r.suborder_status_code));
        if (shippedSubOrders.length > 0)
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2008, message: "Action not allowed",
                error: `Order cannot be cancelled — shipment(s) already dispatched: ${shippedSubOrders.map((r) => r.suborder_code).join(', ')}`,
            });

        // 3d. Pre-shipment check — order_items
        const shippedItems = orderItemsStatusResult.rows.filter((r) => !PRE_SHIPMENT_CODES.includes(r.item_status_code));
        if (shippedItems.length > 0)
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2008, message: "Action not allowed",
                error: `Order cannot be cancelled — item(s) already dispatched: ${shippedItems.map((r) => `product_id ${r.product_id}`).join(', ')}`,
            });

        // --------------------------------------------------
        // 4. RESOLVE MASTER DATA
        // --------------------------------------------------
        const cnlStatusResult = await pool.query(
            `SELECT order_status_id FROM public.order_statuses WHERE code = 'CNL' AND is_active = TRUE AND is_deleted = FALSE`
        );

        if (cnlStatusResult.rowCount === 0) {
            logger.error("order-cancel: missing master data — order_statuses(CNL)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const cnl_status_id = cnlStatusResult.rows[0].order_status_id;

        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 5. UPDATE orders -> CNL
        // --------------------------------------------------
        await client.query({
            text: `UPDATE public.orders
                      SET order_status_id     = $1,
                          cancellation_reason  = $2,
                          modified_at          = $3,
                          modified_by          = $4
                    WHERE order_id = $5`,
            values: [cnl_status_id, cancellation_reason.trim(), now, cancelled_by, order.order_id],
        });

        // --------------------------------------------------
        // 6. UPDATE sub_orders -> CNL
        // --------------------------------------------------
        await client.query({
            text: `UPDATE public.sub_orders
                      SET suborder_status_id = $1, modified_at = $2, modified_by = $3
                    WHERE order_id = $4 AND is_deleted = FALSE`,
            values: [cnl_status_id, now, cancelled_by, order.order_id],
        });

        // --------------------------------------------------
        // 7. UPDATE order_items -> CNL + RELEASE inventory
        //    (reverse of order-create commit: restore onhand_qty)
        //    CHANGE (schema update): quote_id pulled in too — needed
        //    for quote/cart reopen (step 7c below). quote_id now lives
        //    on order_items itself, so no extra join is required for it.
 
        // --------------------------------------------------
        const orderItemsResult = await client.query({
            text: `SELECT OI.order_item_id, OI.product_id, OI.quantity, OI.warehouse_id, OI.quote_id, SO.seller_id
                   FROM public.order_items OI
                   JOIN public.sub_orders SO
                     ON SO.order_id     = OI.order_id
                    AND SO.product_id   = OI.product_id
                    AND SO.warehouse_id = OI.warehouse_id
                    AND SO.is_deleted   = FALSE
                   WHERE OI.order_id   = $1
                     AND OI.is_deleted = FALSE`,
            values: [order.order_id],
        });

        await client.query({
            text: `UPDATE public.order_items
                      SET order_item_status_id = $1, modified_at = $2, modified_by = $3
                    WHERE order_id = $4 AND is_deleted = FALSE`,
            values: [cnl_status_id, now, cancelled_by, order.order_id],
        });

        for (const item of orderItemsResult.rows) {
            await client.query({
                text: `UPDATE public.seller_inventory
                          SET onhand_qty   = onhand_qty + $1,
                              modified_at  = $2,
                              modified_by  = $3
                        WHERE product_id   = $4
                          AND seller_id    = $5
                          AND warehouse_id = $6
                          AND is_deleted   = FALSE`,
                values: [item.quantity, now, cancelled_by, item.product_id, item.seller_id, item.warehouse_id],
            });
        }

        // --------------------------------------------------
        // 7b. VOID order_service_charges
        //     is_active = FALSE, NOT is_deleted — same semantics as
        //     checkout-cancel.js / checkout-payment-cancel.js. The
        //     charges were correctly applied to the order at creation
        //     time; they're just no longer effective now that the
        //     order itself is cancelled.
        // --------------------------------------------------
        const orderServiceChargeVoidResult = await client.query({
            text: `UPDATE public.order_service_charges SET
                        is_active   = FALSE,
                        modified_at = $1,
                        modified_by = $2
                   WHERE order_id  = $3
                     AND is_active = TRUE
                     AND is_deleted = FALSE
                   RETURNING order_service_charge_id`,
            values: [now, cancelled_by, order.order_id],
        });

        // --------------------------------------------------
        // 7c. REOPEN QUOTE + RELEASE CART ITEMS
        //     CHANGE (schema update): quote linkage is now per-item on
        //     order_items (not a single orders.buyer_quote_id column).
        //     Distinct quote_ids are derived from this order's items.
        //     If this order originated from a quote, that quote was
        //     moved ACC -> CNV at checkout-initiate-quote time and
        //     stayed CNV through order-create. Cancelling the order
        //     here (pre-shipment only — enforced by the eligibility
        //     checks above) must release the quote back to ACC and its
        //     cart_details rows back to PND — same reasoning as
        //     checkout-cancel.js / checkout-payment-cancel.js. Without
        //     this, the quote is permanently stuck: checkout-initiate-
        //     quote only accepts ACC, and its cart items are frozen at
        //     ORC so it would find nothing to check out even if the
        //     quote status were fixed manually.
        // --------------------------------------------------
        const quoteIdsToReopen = [...new Set(orderItemsResult.rows.filter((r) => r.quote_id).map((r) => r.quote_id))];
        let quote_reopened = false;

        if (quoteIdsToReopen.length > 0) {
            const reopenedQuoteStatusResult = await client.query(
                `SELECT quote_status_id FROM public.quote_statuses WHERE code = 'ACC' AND is_active = TRUE AND is_deleted = FALSE`
            );
            const pendingCartStatusResult = await client.query(
                `SELECT cart_item_status_id FROM public.cart_item_status WHERE code = 'PND' AND is_active = TRUE AND is_deleted = FALSE`
            );

            if (reopenedQuoteStatusResult.rowCount === 0 || pendingCartStatusResult.rowCount === 0) {
                await client.query("ROLLBACK");
                inTransaction = false;
                logger.error("order-cancel: missing master data — quote_statuses(ACC) or cart_item_status(PND)");
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
            }

            await client.query({
                text: `UPDATE public.buyer_saved_quote SET
                            status_of_quote = $1,
                            modified_at      = $2,
                            modified_by      = $3
                       WHERE buyer_quote_id = ANY($4::int[])
                         AND is_deleted     = FALSE`,
                values: [reopenedQuoteStatusResult.rows[0].quote_status_id, now, cancelled_by, quoteIdsToReopen],
            });

            // Release the quote's cart_details rows back to PND with a
            // fresh soft-hold window — same pattern as checkout-cancel.js.
            const fresh_reservation_expires_at = new Date(
                now.getTime() + commonenum.TIME_DURATION_MINUTES.RESERVATION_EXPIRY * 60 * 1000
            );

            await client.query({
                text: `UPDATE public.cart_details SET
                            cart_item_status_id    = $1,
                            reservation_expires_at = $2,
                            modified_at              = $3,
                            modified_by              = $4
                       WHERE quote_id      = ANY($5::int[])
                         AND is_deleted    = FALSE`,
                values: [pendingCartStatusResult.rows[0].cart_item_status_id, fresh_reservation_expires_at, now, cancelled_by, quoteIdsToReopen],
            });

            quote_reopened = true;
        }

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 8. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Order cancelled successfully",
            data: {
                order_id: order.order_id,
                order_uuid,
                order_code: order.order_code,
                cancellation_reason: cancellation_reason.trim(),
                cancelled_at: now,
                service_charges_voided: orderServiceChargeVoidResult.rowCount,
                quote_reopened,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (order-cancel):", err);
        saveErrorLog({
            api_name: "order-cancel",
            method: "RESPONDER",
            payload: req,
            message: "Internal server error",
            stack: err.stack,
            error_code: 2004,
        });
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Order cancellation failed",
            error: err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// CANCELLED ORDER LIST 
// --------------------------------------------------


responder.on('get-cancelled-buyer-orders', async (req, cb) => {
    try {
        const body = req.body || {};
        const { buyer_uuid = null } = body;

        // ─────────────────────────────────────────────────────────────────
        // 0. Resolve buyer_id
        // ─────────────────────────────────────────────────────────────────
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer_uuid is required" });

        const buyerRes = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid = $1
               AND is_active  = TRUE
               AND is_deleted = FALSE`,
            [buyer_uuid.trim()]
        );

        if (buyerRes.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const buyer_id = buyerRes.rows[0].buyer_id;

        // ─────────────────────────────────────────────────────────────────
        // 1. Base WHERE — order status must be CNL (Cancelled)
        // ─────────────────────────────────────────────────────────────────
        const baseParams = [buyer_id, 'CNL'];
        const baseWhere = `
            O.buyer_id   = $1
            AND O.is_deleted = FALSE
            AND OS.code      = $2
        `;

        // ─────────────────────────────────────────────────────────────────
        // 2. Derived expressions
        // ─────────────────────────────────────────────────────────────────

        // Refund status — check payment_transactions for this order
        const refundStatusExpr = `(
            SELECT JSON_BUILD_OBJECT('code', PS.code, 'name', PS.name)
            FROM   public.payment_transactions PT
            JOIN   public.payment_statuses PS ON PS.payment_status_id = PT.payment_status_id
            WHERE  PT.order_id   = O.order_id
              AND  PT.is_deleted = FALSE
            ORDER  BY PT.created_at DESC
            LIMIT  1
        )`;

        // Order history details — per-seller shipment/item breakdown at time of cancellation
        const orderHistoryExpr = `(
            SELECT COALESCE(JSON_AGG(shipment_row ORDER BY shipment_row->>'suborder_code'), '[]'::json)
            FROM (
                SELECT DISTINCT ON (SO.suborder_code)
                    JSON_BUILD_OBJECT(
                        'suborder_code', SO.suborder_code,
                        'seller_name',   SA.business_name,
                        'status_code',   SOS.code,
                        'status_name',   SOS.name
                    ) AS shipment_row
                FROM   public.sub_orders SO
                LEFT JOIN public.order_statuses  SOS ON SOS.order_status_id = SO.suborder_status_id
                LEFT JOIN public.seller_accounts SA  ON SA.seller_id = SO.seller_id AND SA.is_deleted = FALSE
                WHERE  SO.order_id   = O.order_id
                  AND  SO.is_deleted = FALSE
                ORDER BY SO.suborder_code, SO.created_at ASC
            ) grouped
        )`;

        // Purchased items — what was in the order before cancellation
        const purchasedItemsExpr = `(
            SELECT COALESCE(JSON_AGG(JSON_BUILD_OBJECT(
                    'order_item_uuid', OI.order_item_uuid,
                    'product_uuid',    P.product_uuid,
                    'product_name',    P.name,
                    'part_number',     P.oem_part_number,
                    'sku',             P.sku,
                    'quantity',        OI.quantity,
                    'unit_price',      OI.unit_price,
                    'total_price',     OI.total_price
                ) ORDER BY OI.created_at ASC), '[]'::json)
            FROM   public.order_items OI
            LEFT JOIN public.products P ON P.product_id = OI.product_id AND P.is_deleted = FALSE
            WHERE  OI.order_id   = O.order_id
              AND  OI.is_deleted = FALSE
        )`;

        // Available buyer actions — cancelled orders can only be reordered
        const buyerActionsExpr = `'["Reorder"]'::json`;

        // ─────────────────────────────────────────────────────────────────
        // 3. Default sort — most recently cancelled first
        // ─────────────────────────────────────────────────────────────────
        const reqBodyForHelper = { ...body };
        if (!reqBodyForHelper.SortInfo || !reqBodyForHelper.SortInfo.field) {
            reqBodyForHelper.SortInfo = { field: 'cancelled_date', order: 'DESC' };
        }

        // ─────────────────────────────────────────────────────────────────
        // 4. Execute via buildAdvancedSearchQuery (pagination handled here)
        // ─────────────────────────────────────────────────────────────────
        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: reqBodyForHelper,

            table: 'orders',
            alias: 'O',
            defaultSort: 'order_date',

            joinSql: `
                LEFT JOIN LATERAL (
                    SELECT DISTINCT oi.quote_id
                    FROM public.order_items oi
                    WHERE oi.order_id   = O.order_id
                      AND oi.quote_id  IS NOT NULL
                      AND oi.is_deleted = FALSE
                    LIMIT 1
                ) OQ ON TRUE
                LEFT JOIN public.buyer_saved_quote BQ ON BQ.buyer_quote_id  = OQ.quote_id
                LEFT JOIN public.order_statuses    OS ON OS.order_status_id = O.order_status_id
            `,

            allowedFields: [
                'order_date',
                'total_price',
                'total_quantity',
                'created_at',
            ],

            customFields: {
                order_uuid: { select: 'O.order_uuid', search: null, sort: null },
                order_code: { select: 'O.order_code', search: null, sort: 'O.order_code' },
                order_date: { select: 'O.order_date', search: null, sort: 'O.order_date' },

                quote_uuid: { select: 'BQ.buyer_quote_uuid', search: null, sort: null },
                quote_no:   { select: 'BQ.quote_no',         search: null, sort: null },

                cancellation_reason: { select: 'O.cancellation_reason', search: null, sort: null },
                cancelled_date:      { select: 'O.modified_at', search: null, sort: 'O.modified_at' },

                refund_status:    { select: refundStatusExpr, search: null, sort: null },
                order_history:    { select: orderHistoryExpr, search: null, sort: null },
                purchased_items:  { select: purchasedItemsExpr, search: null, sort: null },
                buyer_actions:    { select: buyerActionsExpr, search: null, sort: null },
            },

            baseWhere,
            baseParams,
        });

        // ─────────────────────────────────────────────────────────────────
        // 5. Shape response
        // ─────────────────────────────────────────────────────────────────
        const orders = (result.data || []).map(row => ({
            orderUuid: row.order_uuid,
            orderCode: row.order_code,
            orderDate: row.order_date,

            quoteUuid: row.quote_uuid || null,
            quoteNo:   row.quote_no   || null,

            cancellationReason: row.cancellation_reason || null,
            cancelledDate:      row.cancelled_date || null,

            refundStatus:    row.refund_status || null,
            orderHistory:    row.order_history || [],
            purchasedItems:  row.purchased_items || [],
            buyerActions:    row.buyer_actions || [],
        }));

        return cb(null, {
            header_type        : 'SUCCESS',
            message_visibility : true,
            status              : true,
            code                : 1000,
            message             : 'Cancelled orders fetched successfully',
            error               : null,
            result: {
                totalRecords : result.totalRecords,
                page         : result.page,
                pageSize     : result.pageSize,
                orders,
            },
        });

    } catch (err) {
        console.error('[get-cancelled-buyer-orders] error:', err);
        await saveErrorLog({ pool, error: err, source: 'get-cancelled-buyer-orders' });
        return cb(null, {
            header_type        : 'ERROR',
            message_visibility : true,
            status              : false,
            code                : 2004,
            message             : err.message,
            error               : err.message,
        });
    }
});



// --------------------------------------------------
// REORDER BUYER ORDER
// --------------------------------------------------

responder.on('reorder-buyer-order', async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const { order_uuid, buyer_uuid, created_by } = req.body;

        const now         = new Date();
        const assigned_to = created_by;
        const assigned_at = now;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!order_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "order uuid is required" });

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created by is required" });

        // --------------------------------------------------
        // 2. RESOLVE BUYER + VERIFY ORDER OWNERSHIP + DLV STATUS
        // --------------------------------------------------
        const buyerResult = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid = $1
               AND is_active  = TRUE
               AND is_deleted = FALSE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const buyer_id = buyerResult.rows[0].buyer_id;

        const orderResult = await pool.query(
            `SELECT O.order_id, OS.code AS order_status_code, OS.name AS order_status_name
             FROM public.orders O
             JOIN public.order_statuses OS ON OS.order_status_id = O.order_status_id
             WHERE O.order_uuid = $1
               AND O.buyer_id   = $2
               AND O.is_deleted = FALSE`,
            [order_uuid.trim(), buyer_id]
        );

        if (orderResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Order not found for this buyer" });

        const order = orderResult.rows[0];

        if (order.order_status_code !== 'DLV')
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2008, message: "Action not allowed", error: `Order is '${order.order_status_name}' — only Delivered orders can be reordered` });

        // --------------------------------------------------
        // 3. FETCH ORIGINAL ORDER ITEMS (includes original unit_price
        //    for the originalPrice vs currentPrice comparison below)
        // --------------------------------------------------
        const originalItemsResult = await pool.query(
            `SELECT OI.product_id, OI.warehouse_id, OI.quantity AS original_quantity,
                    OI.unit_price AS original_unit_price
             FROM public.order_items OI
             WHERE OI.order_id   = $1
               AND OI.is_deleted = FALSE`,
            [order.order_id]
        );

        if (originalItemsResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No items found in this order" });

        // --------------------------------------------------
        // 4. RESOLVE MASTER DATA (once, outside the loop)
        // --------------------------------------------------
        const [whTypeResult, statusResult, taxResult] = await Promise.all([
            pool.query(`SELECT warehouse_type_id FROM public.warehouse_type WHERE code = 'SLR' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT cart_item_status_id FROM public.cart_item_status WHERE code = 'PND' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(
                `SELECT tcm.tax_code_id, tcm.tax_rate
                 FROM public.tax_code_master tcm
                 JOIN public.jurisdiction j
                    ON j.jurisdiction_uuid = tcm.jurisdiction_uuid
                   AND j.code              = 'AE'
                   AND j.level             = 'COUNTRY'
                   AND j.is_deleted        = FALSE
                   AND j.is_active         = TRUE
                 WHERE tcm.is_deleted = FALSE
                   AND tcm.is_active  = TRUE
                 LIMIT 1`
            ),
        ]);

        if (whTypeResult.rowCount === 0 || statusResult.rowCount === 0) {
            logger.error("reorder-buyer-order: missing master data — warehouse_type(SLR) or cart_item_status(PND)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const warehouse_type_id = whTypeResult.rows[0].warehouse_type_id;
        const pending_status_id = statusResult.rows[0].cart_item_status_id;

        const TAX_RATE_DEFAULT = 0.05;
        let taxRate   = TAX_RATE_DEFAULT;
        let taxCodeId = null;
        if (taxResult.rowCount > 0 && taxResult.rows[0].tax_rate !== null) {
            taxRate   = Number(taxResult.rows[0].tax_rate) / 100;
            taxCodeId = taxResult.rows[0].tax_code_id;
        }
        const taxPercentage = parseFloat((taxRate * 100).toFixed(2));
        const reservation_expires_at = new Date(now.getTime() + commonenum.TIME_DURATION_MINUTES.RESERVATION_EXPIRY * 60 * 1000);

        // ====================================================
        // TRANSACTION START — partial-success model: each item
        // is validated & inserted independently; a failure on one
        // item does not roll back items already added successfully
        // in this same call.
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        const addedItems   = [];
        const skippedItems = [];

        for (const origItem of originalItemsResult.rows) {
            // 5a. Re-fetch CURRENT product + inventory state (price may have
            //     changed, product may be deleted/delisted since the order)
            const productResult = await client.query({
                text: `SELECT
                           p.product_id, p.product_uuid, p.seller_id, p.uom_id,
                           p.name AS product_name, p.sku, p.oem_part_number AS oem_number,
                           p.price AS unit_price, p.price_after_sale AS sale_price,
                           p.is_active, p.is_deleted, p.is_listed, p.verify_status,
                           si.inventory_id, si.onhand_qty, si.reserved_qty, si.buffer_qty
                       FROM public.products p
                       JOIN public.seller_inventory si
                          ON si.product_id   = p.product_id
                         AND si.seller_id    = p.seller_id
                         AND si.warehouse_id = $2
                         AND si.is_deleted   = FALSE
                         AND si.is_active    = TRUE
                       WHERE p.product_id = $1`,
                values: [origItem.product_id, origItem.warehouse_id],
            });

            if (productResult.rowCount === 0) {
                skippedItems.push({ product_id: origItem.product_id, reason: "Product or warehouse inventory no longer available" });
                continue;
            }

            const prod = productResult.rows[0];

            if (!prod.is_active || prod.is_deleted || !prod.is_listed || prod.verify_status !== 'APPROVED') {
                skippedItems.push({ product_id: origItem.product_id, product_name: prod.product_name, reason: "Product is no longer active/listed" });
                continue;
            }

            // 5b. Lock inventory row (same pattern as add-to-cart step 4)
            const lockedInventory = await client.query({
                text: `SELECT onhand_qty, reserved_qty, buffer_qty
                       FROM public.seller_inventory
                       WHERE inventory_id = $1
                       FOR UPDATE`,
                values: [prod.inventory_id],
            });

            const { onhand_qty: lockedOnhand, reserved_qty: lockedReserved, buffer_qty: lockedBuffer } = lockedInventory.rows[0];
            const inventoryAvailable = Number(lockedOnhand) - Number(lockedReserved) - Number(lockedBuffer);

            // 5c. Subtract existing active cart holds (all buyers) — same ATP formula.
            //     Only PND/QTD/CKO rows represent a genuine soft-hold on stock;
            //     ORC/REM/EXP are historical and must not be counted here either.
            const cartReservedResult = await client.query({
                text: `SELECT COALESCE(SUM(cd.reserved_quantity), 0) AS total_reserved
                       FROM public.cart_details cd
                       JOIN public.cart_item_status cis ON cis.cart_item_status_id = cd.cart_item_status_id
                       WHERE cd.product_id   = $1
                         AND cd.seller_id    = $2
                         AND cd.warehouse_id = $3
                         AND cd.is_deleted   = FALSE
                         AND cis.code IN ('PND', 'QTD', 'CKO')`,
                values: [prod.product_id, prod.seller_id, origItem.warehouse_id],
            });

            // --------------------------------------------------
            // CHANGE: also subtract active LISTING-ORIGIN quote
            // soft-holds (buyer_quote_items, cart_item_id IS NULL,
            // quote still DRF/ACT) for this product/warehouse — same
            // reasoning as add-to-cart.js / checkout-initiate.js.
            // --------------------------------------------------
            const quoteReservedResult = await client.query({
                text: `SELECT COALESCE(SUM(bqi.quantity), 0) AS total_reserved
                       FROM public.buyer_quote_items bqi
                       JOIN public.buyer_saved_quote bsq
                         ON bsq.buyer_quote_id = bqi.buyer_quote_id
                       JOIN public.quote_statuses qs
                         ON qs.quote_status_id = bsq.status_of_quote
                       WHERE bqi.product_id     = $1
                         AND bqi.warehouse_id   = $2
                         AND bqi.cart_item_id  IS NULL
                         AND bqi.is_deleted     = FALSE
                         AND bqi.is_active      = TRUE
                         AND qs.code IN ('DRF', 'ACT')`,
                values: [prod.product_id, origItem.warehouse_id],
            });

            const existingCartReserved  = Number(cartReservedResult.rows[0].total_reserved);
            const existingQuoteReserved = Number(quoteReservedResult.rows[0].total_reserved);
            const netAvailable          = inventoryAvailable - existingCartReserved - existingQuoteReserved;
            const requestedQty          = Number(origItem.original_quantity);

            if (netAvailable <= 0) {
                skippedItems.push({ product_id: prod.product_id, product_name: prod.product_name, reason: "Out of stock" });
                continue;
            }

            if (requestedQty > netAvailable) {
                skippedItems.push({ product_id: prod.product_id, product_name: prod.product_name, reason: `Insufficient stock — only ${netAvailable} unit(s) available`, availableQty: netAvailable });
                continue;
            }

            // 5d. Duplicate cart item check — only ACTIVE cart rows block a new add.
            //     ORC (already ordered) rows persist in cart_details forever
            //     (order-create never deletes them, only flips the status),
            //     so they must NOT be treated as "still in cart" here —
            //     otherwise a previously-ordered product could never be
            //     reordered again. REM/EXP are likewise historical, not active.
            const duplicateCheck = await client.query({
                text: `SELECT cd.cart_item_uuid
                       FROM public.cart_details cd
                       JOIN public.cart_item_status cis ON cis.cart_item_status_id = cd.cart_item_status_id
                       WHERE cd.buyer_id     = $1
                         AND cd.product_id   = $2
                         AND cd.seller_id    = $3
                         AND cd.warehouse_id = $4
                         AND cis.code NOT IN ('REM', 'EXP', 'ORC')
                         AND cd.is_deleted   = FALSE`,
                values: [buyer_id, prod.product_id, prod.seller_id, origItem.warehouse_id],
            });

            if (duplicateCheck.rowCount > 0) {
                skippedItems.push({ product_id: prod.product_id, product_name: prod.product_name, reason: "Already in cart" });
                continue;
            }

            // 5e. Price / tax computed on CURRENT sale_price — not the price
            //     paid at the time of the original order.
            const linePrice        = Number(prod.sale_price) * requestedQty;
            const tax_amount       = parseFloat((linePrice * taxRate).toFixed(2));
            const discount_amount  = Math.max(0, parseFloat(((Number(prod.unit_price) - Number(prod.sale_price)) * requestedQty).toFixed(2)));
            const final_price      = parseFloat((linePrice + tax_amount).toFixed(2));

            // 5f. Insert into cart_details (mirrors add-to-cart insert)
            const cartInsert = await client.query({
                text: `INSERT INTO public.cart_details (
                            buyer_id, product_id, seller_id, warehouse_id, warehouse_type_id,
                            product_name, sku, oem_number,
                            unit_price, price, quantity, uom_id,
                            tax_code, tax_percentage, tax_amount, discount_amount, final_price,
                            reserved_quantity, reservation_expires_at, cart_item_status_id,
                            quote_id, quote_item_id, quote_type_id, buyer_note,
                            assigned_to, assigned_at, created_by
                       ) VALUES (
                            $1,$2,$3,$4,$5,
                            $6,$7,$8,
                            $9,$10,$11,$12,
                            $13,$14,$15,$16,$17,
                            $11,$18,$19,
                            NULL, NULL, NULL, $20,
                            $21,$22,$23
                       )
                       RETURNING cart_item_id, cart_item_uuid`,
                values: [
                    buyer_id, prod.product_id, prod.seller_id, origItem.warehouse_id, warehouse_type_id,
                    prod.product_name, prod.sku, prod.oem_number,
                    Number(prod.sale_price), Number(linePrice), requestedQty, prod.uom_id || null,
                    taxCodeId, taxPercentage, tax_amount, discount_amount, final_price,
                    reservation_expires_at, pending_status_id,
                    `Reordered from ${order_uuid.trim()}`,
                    assigned_to, assigned_at, created_by,
                ],
            });

            const originalUnitPrice = Number(origItem.original_unit_price);
            const currentUnitPrice  = Number(prod.sale_price);
            const priceChanged      = originalUnitPrice !== currentUnitPrice;
            const priceDifference   = parseFloat((currentUnitPrice - originalUnitPrice).toFixed(2));

            addedItems.push({
                cart_item_id:   cartInsert.rows[0].cart_item_id,
                cart_item_uuid: cartInsert.rows[0].cart_item_uuid,
                product_id:     prod.product_id,
                product_name:   prod.product_name,
                quantity:       requestedQty,

                originalPrice:  originalUnitPrice,
                currentPrice:   currentUnitPrice,
                priceChanged,
                priceDifference,      // +ve = costlier now, -ve = cheaper now

                final_price,
            });
        }

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 6. SUCCESS RESPONSE — partial success reported explicitly
        // --------------------------------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: skippedItems.length === 0
                ? "All items added to cart successfully"
                : "Some items could not be added to cart — see skippedItems",
            data: {
                order_uuid: order_uuid.trim(),
                addedCount:   addedItems.length,
                skippedCount: skippedItems.length,
                addedItems,
                skippedItems,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (reorder-buyer-order):", err);
        saveErrorLog({
            api_name: "reorder-buyer-order",
            method: "RESPONDER",
            payload: req,
            message: "Internal server error",
            stack: err.stack,
            error_code: 2004,
        });
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Reorder failed",
            error: err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// LIST OF REORDER-ELIGIBLE-ITEMS
// --------------------------------------------------

responder.on('list-reorder-eligible-items', async (req, cb) => {
    try {
        const { order_uuid, buyer_uuid } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!order_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "order uuid is required" });

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        // --------------------------------------------------
        // 2. RESOLVE BUYER + VERIFY ORDER OWNERSHIP + COMPLETED STATUS
        // --------------------------------------------------
        const buyerResult = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid = $1
               AND is_active  = TRUE
               AND is_deleted = FALSE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const buyer_id = buyerResult.rows[0].buyer_id;

        const orderResult = await pool.query(
            `SELECT O.order_id, O.order_uuid, O.created_at AS order_date,
                    OS.code AS order_status_code, OS.name AS order_status_name
             FROM public.orders O
             JOIN public.order_statuses OS ON OS.order_status_id = O.order_status_id
             WHERE O.order_uuid = $1
               AND O.buyer_id   = $2
               AND O.is_deleted = FALSE`,
            [order_uuid.trim(), buyer_id]
        );

        if (orderResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Order not found for this buyer" });

        const order = orderResult.rows[0];

        if (order.order_status_code !== 'DLV')
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2008, message: "Action not allowed", error: `Order is '${order.order_status_name}' — only Delivered orders can be reordered` });

        // --------------------------------------------------
        // 3. FETCH ORIGINAL ORDER ITEMS
        // --------------------------------------------------
        const originalItemsResult = await pool.query(
            `SELECT OI.order_item_id, OI.product_id, OI.warehouse_id,
                    OI.quantity AS original_quantity, OI.unit_price AS original_unit_price
             FROM public.order_items OI
             WHERE OI.order_id   = $1
               AND OI.is_deleted = FALSE`,
            [order.order_id]
        );

        if (originalItemsResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No items found in this order" });

        // --------------------------------------------------
        // 4. PER-ITEM VALIDATION — NO LOCKS, NO WRITES (preview only)
        // --------------------------------------------------
        const items = [];

        for (const origItem of originalItemsResult.rows) {

            const productResult = await pool.query({
                text: `SELECT
                           p.product_id, p.product_uuid, p.seller_id, p.uom_id,
                           p.name AS product_name, p.sku, p.oem_part_number AS oem_number,
                           p.price AS unit_price, p.price_after_sale AS sale_price,
                           p.is_active, p.is_deleted, p.is_listed, p.verify_status,
                           si.onhand_qty, si.reserved_qty, si.buffer_qty
                       FROM public.products p
                       JOIN public.seller_inventory si
                          ON si.product_id   = p.product_id
                         AND si.seller_id    = p.seller_id
                         AND si.warehouse_id = $2
                         AND si.is_deleted   = FALSE
                         AND si.is_active    = TRUE
                       WHERE p.product_id = $1`,
                values: [origItem.product_id, origItem.warehouse_id],
            });

            // Product / inventory row no longer exists at all
            if (productResult.rowCount === 0) {
                items.push({
                    product_id: origItem.product_id,
                    original_quantity: Number(origItem.original_quantity),
                    original_price: Number(origItem.original_unit_price),
                    isEligible: false,
                    reason: "Product or warehouse inventory no longer available",
                });
                continue;
            }

            const prod = productResult.rows[0];

            const baseItem = {
                product_id:   prod.product_id,
                product_uuid: prod.product_uuid,
                product_name: prod.product_name,
                sku:          prod.sku,
                oem_number:   prod.oem_number,
                warehouse_id: origItem.warehouse_id,
                original_quantity: Number(origItem.original_quantity),
                original_price:    Number(origItem.original_unit_price),
            };

            if (!prod.is_active || prod.is_deleted || !prod.is_listed || prod.verify_status !== 'APPROVED') {
                items.push({ ...baseItem, isEligible: false, reason: "Product is no longer active/listed" });
                continue;
            }

            // ATP formula — same as add-to-cart/checkout
            const inventoryAvailable = Number(prod.onhand_qty) - Number(prod.reserved_qty) - Number(prod.buffer_qty);

            // Subtract existing active cart holds (all buyers) — PND/QTD/CKO only
            const cartReservedResult = await pool.query({
                text: `SELECT COALESCE(SUM(cd.reserved_quantity), 0) AS total_reserved
                       FROM public.cart_details cd
                       JOIN public.cart_item_status cis ON cis.cart_item_status_id = cd.cart_item_status_id
                       WHERE cd.product_id   = $1
                         AND cd.seller_id    = $2
                         AND cd.warehouse_id = $3
                         AND cd.is_deleted   = FALSE
                         AND cis.code IN ('PND', 'QTD', 'CKO')`,
                values: [prod.product_id, prod.seller_id, origItem.warehouse_id],
            });

            const existingCartReserved = Number(cartReservedResult.rows[0].total_reserved);
            const netAvailable         = Math.max(0, inventoryAvailable - existingCartReserved);
            const requestedQty         = Number(origItem.original_quantity);

            // Already-in-cart check — informational, not a hard block
            const duplicateCheck = await pool.query({
                text: `SELECT cd.cart_item_uuid
                       FROM public.cart_details cd
                       JOIN public.cart_item_status cis ON cis.cart_item_status_id = cd.cart_item_status_id
                       WHERE cd.buyer_id     = $1
                         AND cd.product_id   = $2
                         AND cd.seller_id    = $3
                         AND cd.warehouse_id = $4
                         AND cis.code NOT IN ('REM', 'EXP', 'ORC')
                         AND cd.is_deleted   = FALSE`,
                values: [buyer_id, prod.product_id, prod.seller_id, origItem.warehouse_id],
            });

            const isAlreadyInCart = duplicateCheck.rowCount > 0;
            const currentPrice    = Number(prod.sale_price);
            const priceChanged    = currentPrice !== baseItem.original_price;
            const priceDifference = parseFloat((currentPrice - baseItem.original_price).toFixed(2));

            let isEligible = true;
            let reason     = null;
            let maxReorderQty = requestedQty;

            if (isAlreadyInCart) {
                isEligible = false;
                reason = "Already in cart";
            } else if (netAvailable <= 0) {
                isEligible = false;
                reason = "Out of stock";
                maxReorderQty = 0;
            } else if (requestedQty > netAvailable) {
                // partially eligible — can reorder a reduced quantity
                isEligible = true;
                reason = `Only ${netAvailable} unit(s) available — quantity will be capped`;
                maxReorderQty = netAvailable;
            }

            items.push({
                ...baseItem,
                currentPrice,
                priceChanged,
                priceDifference,        // +ve = costlier now, -ve = cheaper now
                availableQty: netAvailable,
                maxReorderQty,
                isAlreadyInCart,
                isEligible,
                reason,
            });
        }

        const eligibleCount   = items.filter(i => i.isEligible).length;
        const ineligibleCount = items.length - eligibleCount;

        // --------------------------------------------------
        // 5. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Reorder eligibility list fetched successfully",
            data: {
                order_uuid: order.order_uuid,
                order_date: order.order_date,
                totalItems:      items.length,
                eligibleCount,
                ineligibleCount,
                items,
            },
        });

    } catch (err) {
        logger.error("Responder Error (list-reorder-eligible-items):", err);
        saveErrorLog({
            api_name: "list-reorder-eligible-items",
            method: "RESPONDER",
            payload: req,
            message: "Internal server error",
            stack: err.stack,
            error_code: 2004,
        });
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Failed to fetch reorder eligibility list",
            error: err.message,
        });
    }
});

// --------------------------------------------------
// ORDER LIFE CYCLE HISTORY
// --------------------------------------------------


responder.on('get-order-lifecycle-history', async (req, cb) => {
    try {
        const { order_uuid, buyer_uuid } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!order_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "order uuid is required" });

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        // --------------------------------------------------
        // 2. RESOLVE BUYER + VERIFY ORDER OWNERSHIP
        // --------------------------------------------------
        const buyerResult = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid = $1
               AND is_active  = TRUE
               AND is_deleted = FALSE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const buyer_id = buyerResult.rows[0].buyer_id;

        const orderResult = await pool.query(
            `SELECT O.order_id, O.order_uuid, O.order_code, O.order_date,
                    O.total_quantity, O.total_price, O.cancellation_reason,
                    O.created_at, O.modified_at,
                    OS.code AS order_status_code, OS.name AS order_status_name
             FROM public.orders O
             JOIN public.order_statuses OS ON OS.order_status_id = O.order_status_id
             WHERE O.order_uuid = $1
               AND O.buyer_id   = $2
               AND O.is_deleted = FALSE`,
            [order_uuid.trim(), buyer_id]
        );

        if (orderResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Order not found for this buyer" });

        const order = orderResult.rows[0];

        // --------------------------------------------------
        // 3. FETCH SUB_ORDERS (per-seller shipment breakdown)
        // --------------------------------------------------
      const subOrdersResult = await pool.query(
            `SELECT SO.suborder_id, SO.suborder_uuid, SO.suborder_code,
                    SO.product_id, SO.seller_id,
                    SO.total_quantity, SO.total_price, SO.shipping_charge,
                    SO.expected_delivery_date, SO.actual_delivery_date,
                    SO.tracking_number, SO.courier_name,
                    SO.created_at, SO.modified_at,
                    SS.code AS suborder_status_code, SS.name AS suborder_status_name,
                    U.fullname AS seller_name
             FROM public.sub_orders SO
             JOIN public.order_statuses SS ON SS.order_status_id = SO.suborder_status_id
             LEFT JOIN public.seller_accounts SA ON SA.seller_id = SO.seller_id
             LEFT JOIN public.users U ON U.user_id = SA.user_id
             WHERE SO.order_id   = $1
               AND SO.is_deleted = FALSE
             ORDER BY SO.created_at ASC`,
            [order.order_id]
        );

        // --------------------------------------------------
        // 4. FETCH ORDER_ITEMS (per-product breakdown)
        //    CHANGE (schema update): OI.quote_accepted_at pulled in —
        //    used below to derive the QUOTE_ACCEPTED timeline event,
        //    since that timestamp no longer lives on orders.
        // --------------------------------------------------
        const orderItemsResult = await pool.query(
            `SELECT OI.order_item_id, OI.order_item_uuid, OI.product_id,
                    OI.quantity, OI.unit_price, OI.vat_amount, OI.discount_amount, OI.total_price,
                    OI.warehouse_id, OI.quote_accepted_at,
                    OI.created_at, OI.modified_at,
                    OIS.code AS item_status_code, OIS.name AS item_status_name,
                    P.name AS product_name, P.sku, P.oem_part_number AS oem_number
             FROM public.order_items OI
             JOIN public.order_statuses OIS ON OIS.order_status_id = OI.order_item_status_id
             LEFT JOIN public.products P ON P.product_id = OI.product_id
             WHERE OI.order_id   = $1
               AND OI.is_deleted = FALSE
             ORDER BY OI.created_at ASC`,
            [order.order_id]
        );

        // --------------------------------------------------
        // 4b. FETCH ACTIVE ORDER SERVICE CHARGES
        //     Snapshot block, not a timeline event — charges don't
        //     carry their own timestamped state transitions the way
        //     order/suborder statuses do.
        // --------------------------------------------------
        const orderServiceChargesResult = await pool.query(
            `SELECT
                    osc.order_service_charge_uuid,
                    sc.name AS service_charge_name,
                    osc.charge_type,
                    osc.charge_value,
                    osc.charge_amount
               FROM public.order_service_charges osc
               JOIN public.service_charge sc
                 ON sc.service_charge_id = osc.service_charge_id
              WHERE osc.order_id  = $1
                AND osc.is_active = TRUE
                AND osc.is_deleted = FALSE
              ORDER BY osc.order_service_charge_id ASC`,
            [order.order_id]
        );

        const service_charges = orderServiceChargesResult.rows.map((row) => ({
            order_service_charge_uuid: row.order_service_charge_uuid,
            service_charge_name:       row.service_charge_name,
            charge_type:               row.charge_type,
            charge_value:              Number(row.charge_value),
            charge_amount:             Number(row.charge_amount),
        }));

        const total_service_charge = parseFloat(
            service_charges.reduce((sum, sc) => sum + sc.charge_amount, 0).toFixed(2)
        );

        // --------------------------------------------------
        // 5. BUILD ORDER-LEVEL TIMELINE
        // --------------------------------------------------
        // NOTE: There is no order_status_history table yet, so only
        // genuinely-timestamped milestones are included below. We do NOT
        // fabricate intermediate transition timestamps (e.g. exact time it
        // moved PRC -> SHP) since that data isn't captured anywhere.
        const orderTimeline = [];

        if (order.order_date) {
            orderTimeline.push({ event: "ORDER_PLACED", status_code: "PND", status_name: "PENDING", timestamp: order.order_date });
        }

        // CHANGE (schema update): quote_accepted_at is now derived from
        // order_items (the first quote-linked row's value) rather than
        // read off orders — that column was removed from orders and
        // relocated per-item.
        const quoteAcceptedAt = orderItemsResult.rows.find((r) => r.quote_accepted_at)?.quote_accepted_at ?? null;
        if (quoteAcceptedAt) {
            orderTimeline.push({ event: "QUOTE_ACCEPTED", timestamp: quoteAcceptedAt });
        }

        if (order.order_status_code === 'CNL') {
            orderTimeline.push({
                event: "ORDER_CANCELLED",
                status_code: "CNL",
                status_name: "CANCELLED",
                reason: order.cancellation_reason,
                timestamp: order.modified_at,
            });
        }
        // Always append current status as the latest known state
        orderTimeline.push({
            event: "CURRENT_STATUS",
            status_code: order.order_status_code,
            status_name: order.order_status_name,
            timestamp: order.modified_at || order.created_at,
        });

        orderTimeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        // --------------------------------------------------
        // 6. BUILD SUB_ORDER-LEVEL TIMELINES
        // --------------------------------------------------
        const subOrders = subOrdersResult.rows.map(so => {
            const timeline = [];

            if (so.created_at) {
                timeline.push({ event: "SUBORDER_CREATED", timestamp: so.created_at });
            }
            if (so.expected_delivery_date) {
                timeline.push({ event: "EXPECTED_DELIVERY", timestamp: so.expected_delivery_date });
            }
            if (so.tracking_number) {
                timeline.push({
                    event: "SHIPMENT_INFO_AVAILABLE",
                    tracking_number: so.tracking_number,
                    courier_name: so.courier_name,
                    // No dedicated "shipped_at" column exists — modified_at is the
                    // closest proxy and may reflect any later update, not strictly ship time.
                    timestamp: so.modified_at,
                });
            }
            if (so.suborder_status_code === 'DLV' && so.actual_delivery_date) {
                timeline.push({ event: "DELIVERED", timestamp: so.actual_delivery_date });
            }
            if (so.suborder_status_code === 'RTN') {
                timeline.push({ event: "RETURNED", timestamp: so.modified_at });
            }
            if (so.suborder_status_code === 'RFD') {
                timeline.push({ event: "REFUNDED", timestamp: so.modified_at });
            }
            timeline.push({
                event: "CURRENT_STATUS",
                status_code: so.suborder_status_code,
                status_name: so.suborder_status_name,
                timestamp: so.modified_at || so.created_at,
            });

            timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            return {
                suborder_uuid: so.suborder_uuid,
                suborder_code: so.suborder_code,
                seller_id: so.seller_id,
                seller_name: so.seller_name,
                product_id: so.product_id,
                total_quantity: Number(so.total_quantity),
                total_price: Number(so.total_price),
                shipping_charge: so.shipping_charge !== null ? Number(so.shipping_charge) : 0,
                tracking_number: so.tracking_number,
                courier_name: so.courier_name,
                expected_delivery_date: so.expected_delivery_date,
                actual_delivery_date: so.actual_delivery_date,
                current_status: { code: so.suborder_status_code, name: so.suborder_status_name },
                timeline,
            };
        });

        // --------------------------------------------------
        // 7. BUILD ORDER_ITEMS-LEVEL SNAPSHOT
        // --------------------------------------------------
        const orderItems = orderItemsResult.rows.map(oi => ({
            order_item_uuid: oi.order_item_uuid,
            product_id: oi.product_id,
            product_name: oi.product_name,
            sku: oi.sku,
            oem_number: oi.oem_number,
            warehouse_id: oi.warehouse_id,
            quantity: Number(oi.quantity),
            unit_price: Number(oi.unit_price),
            vat_amount: Number(oi.vat_amount),
            discount_amount: Number(oi.discount_amount),
            total_price: Number(oi.total_price),
            current_status: { code: oi.item_status_code, name: oi.item_status_name },
            created_at: oi.created_at,
            last_updated_at: oi.modified_at,
        }));

        // --------------------------------------------------
        // 8. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Order lifecycle history fetched successfully",
            data: {
                order_uuid: order.order_uuid,
                order_code: order.order_code,
                total_quantity: order.total_quantity !== null ? Number(order.total_quantity) : null,
                total_price: order.total_price !== null ? Number(order.total_price) : null,
                current_status: { code: order.order_status_code, name: order.order_status_name },
                timeline: orderTimeline,
                sub_orders: subOrders,
                order_items: orderItems,
                service_charges,
                total_service_charge,
            },
        });

    } catch (err) {
        logger.error("Responder Error (get-order-lifecycle-history):", err);
        saveErrorLog({
            api_name: "get-order-lifecycle-history",
            method: "RESPONDER",
            payload: req,
            message: "Internal server error",
            stack: err.stack,
            error_code: 2004,
        });
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Failed to fetch order lifecycle history",
            error: err.message,
        });
    }
});

// --------------------------------------------------
// ADD PRODUCT TO WISHLIST
// --------------------------------------------------

responder.on("add-to-wishlist", async (req, cb) => {
    try {
        const { buyer_uuid, product_uuid, created_by } = req.body;
        const now = new Date();

        // --------------------------------------------------
        // VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });

        if (!product_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Product UUID is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created by is required" });

        // --------------------------------------------------
        // RESOLVE buyer + product (parallel), enforce active listing
        // --------------------------------------------------
        const [buyerResult, productResult] = await Promise.all([
            pool.query(
                `SELECT buyer_id
                 FROM public.buyer_accounts
                 WHERE buyer_uuid = $1
                   AND is_deleted = FALSE
                   AND is_active  = TRUE
                   AND phone_number_verified = TRUE`,
                [buyer_uuid.trim()]
            ),
            pool.query(
                `SELECT p.product_id, pls.code AS listing_status_code
                 FROM public.products p
                 JOIN public.product_listing_status pls
                   ON pls.product_listing_status_id = p.product_listing_status_id
                 WHERE p.product_uuid = $1
                   AND p.is_deleted   = FALSE
                   AND p.is_active    = TRUE`,
                [product_uuid.trim()]
            ),
        ]);

        if (buyerResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        if (productResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Product not found" });

        const { buyer_id } = buyerResult.rows[0];
        const { product_id, listing_status_code } = productResult.rows[0];

        if (listing_status_code !== "ACT")
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2008, message: "Action not allowed", error: "Product is not currently listed for sale" });

        // --------------------------------------------------
        // DUPLICATE CHECK
        // --------------------------------------------------
        const existing = await pool.query(
            `SELECT wishlist_item_id
             FROM public.wishlist_items
             WHERE buyer_id = $1 AND product_id = $2 AND is_deleted = FALSE`,
            [buyer_id, product_id]
        );

        if (existing.rowCount > 0) {
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2002, message: "Item already in wishlist", error: "This product is already in your wishlist" });
        }

        const insert = await pool.query(
            `INSERT INTO public.wishlist_items (
                 buyer_id, product_id, added_date,
                 assigned_to, assigned_at, created_by
             ) VALUES ($1, $2, $3, $4, $3, $4)
             RETURNING wishlist_item_id, wishlist_item_uuid`,
            [buyer_id, product_id, now, created_by]
        );
        const { wishlist_item_id, wishlist_item_uuid } = insert.rows[0];

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Product added to wishlist successfully",
            data: { wishlist_item_id, wishlist_item_uuid, buyer_id, product_id, added_date: now },
        });

    } catch (err) {
        // Race-condition fallback: two concurrent adds hitting the
        // unique (buyer_id, product_id) constraint at the DB level.
        if (err.code === "23505") {
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2002, message: "Item already in wishlist", error: "This product is already in your wishlist" });
        }
        logger.error("Responder Error (add-to-wishlist):", err);
        saveErrorLog({
            api_name: "add-to-wishlist",
            method: "RESPONDER",
            payload: req,
            message: "Internal server error",
            stack: err.stack,
            error_code: 2004,
        });
        return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: "Internal server error", error: err.message });
    }
});


// --------------------------------------------------
// GET BUYER WISHLIST
// --------------------------------------------------

responder.on("get-buyer-wishlist", async (req, cb) => {
    const client = await pool.connect();

    try {
        const {
            buyer_uuid,
            sort_by    = "added_date",   // optional — added_date | name | price
            sort_order = "desc",         // optional — asc | desc
            Page       = 1,
            PageSize   = 20,
        } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2001,
                message:            "Validation failed",
                error:              "Buyer UUID is required",
            });

        const ALLOWED_SORT_COLUMNS = {
            added_date: "wi.added_date",
            name:       "p.name",
            price:      "p.price_after_sale",
        };

        const sortColumn = ALLOWED_SORT_COLUMNS[sort_by] || ALLOWED_SORT_COLUMNS.added_date;
        const sortDir    = String(sort_order).toUpperCase() === "ASC" ? "ASC" : "DESC";

        const page     = Math.max(Number(Page) || 1, 1);
        const pageSize = Math.min(Math.max(Number(PageSize) || 20, 1), 100);
        const offset   = (page - 1) * pageSize;

        // --------------------------------------------------
        // 2. RESOLVE buyer_uuid → buyer_id
        // --------------------------------------------------
        const buyerResult = await client.query({
            text: `SELECT buyer_id
                   FROM public.buyer_accounts
                   WHERE buyer_uuid = $1
                     AND is_deleted  = FALSE
                     AND is_active   = TRUE`,
            values: [buyer_uuid.trim()],
        });

        if (buyerResult.rowCount === 0)
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "No active buyer found with the provided UUID",
            });

        const { buyer_id } = buyerResult.rows[0];

        // --------------------------------------------------
        // 3. BUILD DYNAMIC WHERE CLAUSE
        // --------------------------------------------------
        const conditions = [
            `wi.buyer_id   = $1`,
            `wi.is_deleted = FALSE`,
        ];
        const values = [buyer_id];

        const whereClause = conditions.join(" AND ");

        // --------------------------------------------------
        // 4. COUNT (for pagination)
        // --------------------------------------------------
        const countResult = await client.query({
            text: `SELECT COUNT(*) AS total
                   FROM public.wishlist_items wi
                   WHERE ${whereClause}`,
            values,
        });

        const total      = Number(countResult.rows[0].total);
        const totalPages = Math.ceil(total / pageSize);

        // --------------------------------------------------
        // 5. FETCH WISHLIST ITEMS (paginated)
        // --------------------------------------------------
        const limitIdx  = values.length + 1;
        const offsetIdx = values.length + 2;

        const itemsResult = await client.query({
            text: `
                SELECT
                    wi.wishlist_item_id, wi.wishlist_item_uuid, wi.added_date,
                    p.product_id, p.product_uuid, p.name AS product_name, p.sku,
                    p.oem_part_number, p.manufacturer_name,
                    p.price AS mrp, p.price_after_sale AS current_price,
                    pls.code AS listing_status_code,
                    COALESCE(stock.total_atp, 0) AS available_quantity,
                    COALESCE(img.images, '[]'::json) AS images

                FROM public.wishlist_items wi

                JOIN public.products p
                    ON p.product_id = wi.product_id
                   AND p.is_deleted = FALSE

                JOIN public.product_listing_status pls
                    ON pls.product_listing_status_id = p.product_listing_status_id

                LEFT JOIN LATERAL (
                    SELECT SUM(si.onhand_qty - si.reserved_qty - si.buffer_qty) AS total_atp
                    FROM public.seller_inventory si
                    WHERE si.product_id = p.product_id
                      AND si.is_deleted = FALSE
                      AND si.is_active  = TRUE
                ) stock ON TRUE

                LEFT JOIN LATERAL (
                    SELECT json_agg(
                             json_build_object('image_url', pi.image_url, 'image_type', pi.image_type, 'sort_order', pi.sort_order)
                             ORDER BY pi.sort_order ASC NULLS LAST
                           ) AS images
                    FROM public.product_images pi
                    WHERE pi.product_id = p.product_id
                      AND pi.is_deleted = FALSE
                      AND pi.is_active  = TRUE
                ) img ON TRUE

                WHERE ${whereClause}

                ORDER BY ${sortColumn} ${sortDir}

                LIMIT  $${limitIdx}
                OFFSET $${offsetIdx}
            `,
            values: [...values, pageSize, offset],
        });

        // --------------------------------------------------
        // 6. SHAPE RESPONSE
        // --------------------------------------------------
        const data = itemsResult.rows.map((r) => ({
            wishlist_item_id:   r.wishlist_item_id,
            wishlist_item_uuid: r.wishlist_item_uuid,
            added_date:         r.added_date,
            product: {
                product_id:        r.product_id,
                product_uuid:      r.product_uuid,
                name:              r.product_name,
                sku:               r.sku,
                oem_part_number:   r.oem_part_number,
                manufacturer_name: r.manufacturer_name,
                mrp:               Number(r.mrp),
                current_price:     Number(r.current_price),
                images:            r.images,
            },
            stock_status:        Number(r.available_quantity) > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
            available_quantity:  Math.max(0, Number(r.available_quantity)),
            availability:        r.listing_status_code === "ACT" && Number(r.available_quantity) > 0,
        }));

        // --------------------------------------------------
        // 7. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Wishlist retrieved successfully",
            error:              null,
            result: {
                page,
                pageSize,
                totalRecords: total,
                totalPages,
                data,
            },
        });

    } catch (err) {
        logger.error("Responder Error (get-buyer-wishlist):", err);
        saveErrorLog({
            api_name:   "get-buyer-wishlist",
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

// --------------------------------------------------
// GET WISHLIST ITEM DETAIL
// --------------------------------------------------
responder.on("get-wishlist-item", async (req, cb) => {
    try {
        const { wishlist_item_uuid, buyer_uuid } = req.body;

        if (!wishlist_item_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Wishlist item UUID is required" });

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });

        const result = await pool.query({
            text: `
                SELECT
                    wi.wishlist_item_id, wi.wishlist_item_uuid, wi.added_date,
                    p.product_id, p.product_uuid, p.name AS product_name, p.sku,
                    p.oem_part_number, p.manufacturer_name, p.item_description,
                    p.weight, p.dimension_length, p.dimension_width, p.dimension_height,
                    p.material_type, p.condition_id,
                    p.price AS mrp, p.price_after_sale AS current_price,
                    pls.code AS listing_status_code,
                    COALESCE(stock.total_atp, 0) AS available_quantity,
                    COALESCE(img.images, '[]'::json) AS images
                FROM public.wishlist_items wi
                JOIN public.buyer_accounts ba
                  ON ba.buyer_id    = wi.buyer_id
                 AND ba.buyer_uuid  = $2
                 AND ba.is_deleted  = FALSE
                JOIN public.products p
                  ON p.product_id = wi.product_id
                 AND p.is_deleted = FALSE
                JOIN public.product_listing_status pls
                  ON pls.product_listing_status_id = p.product_listing_status_id
                LEFT JOIN LATERAL (
                    SELECT SUM(si.onhand_qty - si.reserved_qty - si.buffer_qty) AS total_atp
                    FROM public.seller_inventory si
                    WHERE si.product_id = p.product_id AND si.is_deleted = FALSE AND si.is_active = TRUE
                ) stock ON TRUE
                LEFT JOIN LATERAL (
                    SELECT json_agg(
                             json_build_object('image_url', pi.image_url, 'image_type', pi.image_type, 'sort_order', pi.sort_order)
                             ORDER BY pi.sort_order ASC NULLS LAST
                           ) AS images
                    FROM public.product_images pi
                    WHERE pi.product_id = p.product_id AND pi.is_deleted = FALSE AND pi.is_active = TRUE
                ) img ON TRUE
                WHERE wi.wishlist_item_uuid = $1
                  AND wi.is_deleted = FALSE`,
            values: [wishlist_item_uuid.trim(), buyer_uuid.trim()],
        });

        if (result.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Wishlist item not found" });

        const r = result.rows[0];

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Wishlist item retrieved successfully",
            data: {
                wishlist_item_id:   r.wishlist_item_id,
                wishlist_item_uuid: r.wishlist_item_uuid,
                added_date:         r.added_date,
                product: {
                    product_id:        r.product_id,
                    product_uuid:      r.product_uuid,
                    name:              r.product_name,
                    sku:               r.sku,
                    oem_part_number:   r.oem_part_number,
                    manufacturer_name: r.manufacturer_name,
                    item_description:  r.item_description,
                    weight:            r.weight,
                    dimension_length:  r.dimension_length,
                    dimension_width:   r.dimension_width,
                    dimension_height:  r.dimension_height,
                    material_type:     r.material_type,
                    condition_id:      r.condition_id,
                    mrp:               Number(r.mrp),
                    current_price:     Number(r.current_price),
                    images:            r.images,
                },
                stock_status:        Number(r.available_quantity) > 0 ? "IN_STOCK" : "OUT_OF_STOCK",
                available_quantity:  Math.max(0, Number(r.available_quantity)),
                availability:        r.listing_status_code === "ACT" && Number(r.available_quantity) > 0,
            },
        });

    } catch (err) {
        logger.error("Responder Error (get-wishlist-item):", err);
        saveErrorLog({
            api_name: "get-wishlist-item",
            method: "RESPONDER",
            payload: req,
            message: "Internal server error",
            stack: err.stack,
            error_code: 2004,
        });
        return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: "Internal server error", error: err.message });
    }
});

// --------------------------------------------------
// MOVE WISHLIST ITEM TO CART
// --------------------------------------------------
// Mirrors add-to-cart's stock-reservation logic exactly (locked
// inventory row, ATP check, cart-side soft-hold check, duplicate
// cart-line check). On success the wishlist item is soft-deleted
// in the SAME transaction as the cart insert.
// --------------------------------------------------
responder.on("move-wishlist-to-cart", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const {
            wishlist_item_uuid,
            buyer_uuid,
            warehouse_uuid,
            quantity,
            buyer_note,
            created_by,
        } = req.body;

        const now          = new Date();
        const assigned_to  = created_by;
        const assigned_at  = now;
        const requestedQty = quantity !== undefined && quantity !== null ? Number(quantity) : 1;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!wishlist_item_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Wishlist item UUID is required" });

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });

        if (!warehouse_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Warehouse UUID is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created by is required" });

        if (isNaN(requestedQty) || requestedQty <= 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Quantity must be greater than zero" });

        // --------------------------------------------------
        // 2. RESOLVE buyer, wishlist item, product + inventory (pre-transaction)
        // --------------------------------------------------
        const buyerResult = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const { buyer_id } = buyerResult.rows[0];

        const wishlistResult = await pool.query(
            `SELECT wishlist_item_id, product_id
             FROM public.wishlist_items
             WHERE wishlist_item_uuid = $1 AND buyer_id = $2 AND is_deleted = FALSE`,
            [wishlist_item_uuid.trim(), buyer_id]
        );

        if (wishlistResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Wishlist item not found for this buyer" });

        const { wishlist_item_id, product_id } = wishlistResult.rows[0];

        const productResult = await pool.query({
            text: `
                SELECT
                    p.product_id, p.seller_id, p.uom_id, p.name AS product_name, p.sku,
                    p.oem_part_number AS oem_number, p.price AS unit_price, p.price_after_sale AS sale_price,
                    pls.code AS listing_status_code,
                    si.inventory_id, si.warehouse_id
                FROM public.products p
                JOIN public.product_listing_status pls
                  ON pls.product_listing_status_id = p.product_listing_status_id
                JOIN public.seller_inventory si
                  ON si.product_id = p.product_id
                 AND si.seller_id  = p.seller_id
                 AND si.is_deleted = FALSE
                 AND si.is_active  = TRUE
                JOIN public.seller_warehouse sw
                  ON sw.warehouse_id   = si.warehouse_id
                 AND sw.warehouse_uuid = $2
                 AND sw.is_deleted     = FALSE
                 AND sw.is_active      = TRUE
                WHERE p.product_id = $1
                  AND p.is_deleted = FALSE
                  AND p.is_active  = TRUE`,
            values: [product_id, warehouse_uuid.trim()],
        });

        if (productResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Product is not available in the selected warehouse" });

        const {
            seller_id, uom_id, product_name, sku, oem_number,
            unit_price, sale_price, listing_status_code, inventory_id, warehouse_id,
        } = productResult.rows[0];

        if (listing_status_code !== "ACT")
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2008, message: "Action not allowed", error: "Product is not currently listed for sale" });

        const [whTypeResult, statusResult] = await Promise.all([
            pool.query(`SELECT warehouse_type_id FROM public.warehouse_type WHERE code = 'SLR' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT cart_item_status_id FROM public.cart_item_status WHERE code = 'PND' AND is_active = TRUE AND is_deleted = FALSE`),
        ]);

        if (whTypeResult.rowCount === 0 || statusResult.rowCount === 0) {
            logger.error("move-wishlist-to-cart: missing master data — warehouse_type(SLR) or cart_item_status(PND)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const warehouse_type_id = whTypeResult.rows[0].warehouse_type_id;
        const pending_status_id = statusResult.rows[0].cart_item_status_id;

        // --------------------------------------------------
        // 3. TAX RATE LOOKUP (read-only, pre-transaction)
        // --------------------------------------------------
        const TAX_RATE_DEFAULT = 0.05;
        let taxRate   = TAX_RATE_DEFAULT;
        let taxCodeId = null;

        const taxResult = await pool.query(
            `SELECT tcm.tax_code_id, tcm.tax_rate
             FROM public.tax_code_master tcm
             JOIN public.jurisdiction j
               ON j.jurisdiction_uuid = tcm.jurisdiction_uuid
              AND j.code = 'AE' AND j.level = 'COUNTRY' AND j.is_deleted = FALSE AND j.is_active = TRUE
             WHERE tcm.is_deleted = FALSE AND tcm.is_active = TRUE
             LIMIT 1`
        );

        if (taxResult.rowCount > 0 && taxResult.rows[0].tax_rate !== null) {
            taxRate   = Number(taxResult.rows[0].tax_rate) / 100;
            taxCodeId = taxResult.rows[0].tax_code_id;
        }
        const taxPercentage = parseFloat((taxRate * 100).toFixed(2));

        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // Lock the inventory row FIRST — serializes concurrent
        // move-to-cart / add-to-cart calls for the same inventory_id.
        const lockedInventory = await client.query(
            `SELECT onhand_qty, reserved_qty, buffer_qty
             FROM public.seller_inventory
             WHERE inventory_id = $1
             FOR UPDATE`,
            [inventory_id]
        );

        if (lockedInventory.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Inventory record no longer exists for this product/warehouse" });
        }

        const { onhand_qty: lockedOnhand, reserved_qty: lockedReserved, buffer_qty: lockedBuffer } = lockedInventory.rows[0];
        const inventoryAvailable = Number(lockedOnhand) - Number(lockedReserved) - Number(lockedBuffer);

        const cartReservedResult = await client.query(
            `SELECT COALESCE(SUM(cd.reserved_quantity), 0) AS total_reserved
             FROM public.cart_details cd
             JOIN public.cart_item_status cis ON cis.cart_item_status_id = cd.cart_item_status_id
             WHERE cd.product_id = $1 AND cd.seller_id = $2 AND cd.warehouse_id = $3
               AND cd.is_deleted = FALSE AND cis.code NOT IN ('REM', 'EXP')`,
            [product_id, seller_id, warehouse_id]
        );

        const existingCartReserved = Number(cartReservedResult.rows[0].total_reserved);
        const netAvailable         = inventoryAvailable - existingCartReserved;

        if (netAvailable <= 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2007, message: "Out of stock", error: "This product is currently out of stock" });
        }

        if (requestedQty > netAvailable) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2007, message: "Insufficient stock", error: `Only ${netAvailable} units are available for this product` });
        }

        const duplicateCheck = await client.query(
            `SELECT cd.cart_item_uuid
             FROM public.cart_details cd
             JOIN public.cart_item_status cis ON cis.cart_item_status_id = cd.cart_item_status_id
             WHERE cd.buyer_id = $1 AND cd.product_id = $2 AND cd.seller_id = $3 AND cd.warehouse_id = $4
               AND cis.code != 'REM' AND cd.is_deleted = FALSE`,
            [buyer_id, product_id, seller_id, warehouse_id]
        );

        if (duplicateCheck.rowCount > 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2002, message: "Item already in cart", error: "This product is already in your cart. Use the update quantity option to change the quantity" });
        }

        // --------------------------------------------------
        // PRICE / DISCOUNT CALCULATION (same formula as add-to-cart)
        // --------------------------------------------------
        const linePrice        = Number(sale_price) * requestedQty;
        const tax_amount       = parseFloat((linePrice * taxRate).toFixed(2));
        const discount_amount  = Math.max(0, parseFloat(((Number(unit_price) - Number(sale_price)) * requestedQty).toFixed(2)));
        const final_price      = parseFloat((linePrice + tax_amount).toFixed(2));
        const reservation_expires_at = new Date(now.getTime() + commonenum.TIME_DURATION_MINUTES.RESERVATION_EXPIRY * 60 * 1000);

        const cartInsert = await client.query({
            text: `
                INSERT INTO public.cart_details (
                    buyer_id, product_id, seller_id, warehouse_id, warehouse_type_id,
                    product_name, sku, oem_number,
                    unit_price, price, quantity, uom_id,
                    tax_code, tax_percentage, tax_amount, discount_amount, final_price,
                    reserved_quantity, reservation_expires_at, cart_item_status_id,
                    quote_id, quote_item_id, quote_type_id,
                    buyer_note, assigned_to, assigned_at, created_by
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8,
                    $9, $10, $11, $12,
                    $13, $14, $15, $16, $17,
                    $11, $18, $19,
                    NULL, NULL, NULL,
                    $20, $21, $22, $23
                )
                RETURNING cart_item_id, cart_item_uuid`,
            values: [
                buyer_id, product_id, seller_id, warehouse_id, warehouse_type_id,
                product_name, sku, oem_number,
                Number(sale_price), Number(linePrice), requestedQty, uom_id || null,
                taxCodeId || null, taxPercentage, tax_amount, discount_amount, final_price,
                reservation_expires_at, pending_status_id,
                buyer_note?.trim() || null, assigned_to, assigned_at, created_by,
            ],
        });

        const { cart_item_id, cart_item_uuid } = cartInsert.rows[0];

        // Remove the item from the wishlist now that it has moved to the cart
        await client.query(
            `UPDATE public.wishlist_items
                SET is_deleted  = TRUE,
                    is_active   = FALSE,
                    deleted_at  = $1,
                    deleted_by  = $2,
                    modified_at = $1,
                    modified_by = $2
              WHERE wishlist_item_id = $3`,
            [now, created_by, wishlist_item_id]
        );

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Item moved from wishlist to cart successfully",
            data: {
                cart_item_id,
                cart_item_uuid,
                wishlist_item_id,
                wishlist_item_uuid,
                buyer_id,
                product_id,
                seller_id,
                warehouse_id,
                quantity: requestedQty,
                unit_price: Number(sale_price),
                price: Number(linePrice),
                tax_amount,
                discount_amount,
                final_price,
                cart_item_status_id: pending_status_id,
                reservation_expires_at,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (move-wishlist-to-cart):", err);
        saveErrorLog({
            api_name: "move-wishlist-to-cart",
            method: "RESPONDER",
            payload: req,
            message: "Internal server error",
            stack: err.stack,
            error_code: 2004,
        });
        return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: "Internal server error", error: err.message });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// DELETE WISHLIST ITEM (soft delete)
// --------------------------------------------------
responder.on("delete-wishlist-item", async (req, cb) => {
    try {
        const { wishlist_item_uuid, buyer_uuid, deleted_by } = req.body;
        const now = new Date();

        if (!wishlist_item_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Wishlist item UUID is required" });

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });

        if (!deleted_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "deleted by is required" });

        const buyerResult = await pool.query(
            `SELECT buyer_id FROM public.buyer_accounts WHERE buyer_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const { buyer_id } = buyerResult.rows[0];

        // NOTE: "maintain wishlist activity history" — no history/log table
        // was provided in the schema, so this only performs the soft delete.
        // If a `wishlist_activity_log` (or similar) table exists, an INSERT
        // into it should be added here.
        const result = await pool.query(
            `UPDATE public.wishlist_items
                SET is_deleted  = TRUE,
                    is_active   = FALSE,
                    deleted_at  = $1,
                    deleted_by  = $2,
                    modified_at = $1,
                    modified_by = $2
              WHERE wishlist_item_uuid = $3
                AND buyer_id = $4
                AND is_deleted = FALSE
              RETURNING wishlist_item_id`,
            [now, deleted_by.trim(), wishlist_item_uuid.trim(), buyer_id]
        );

        if (result.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Wishlist item not found for this buyer" });

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Product removed from wishlist successfully",
            data: { wishlist_item_id: result.rows[0].wishlist_item_id },
        });

    } catch (err) {
        logger.error("Responder Error (delete-wishlist-item):", err);
        saveErrorLog({
            api_name: "delete-wishlist-item",
            method: "RESPONDER",
            payload: req,
            message: "Internal server error",
            stack: err.stack,
            error_code: 2004,
        });
        return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: "Internal server error", error: err.message });
    }
});

// --------------------------------------------------
// GET WISHLIST COUNT
// --------------------------------------------------
responder.on("get-wishlist-count", async (req, cb) => {
    try {
        const { buyer_uuid } = req.body;

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });

        const buyerResult = await pool.query(
            `SELECT buyer_id FROM public.buyer_accounts WHERE buyer_uuid = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const { buyer_id } = buyerResult.rows[0];

        const countResult = await pool.query(
            `SELECT COUNT(*) AS total
             FROM public.wishlist_items
             WHERE buyer_id = $1 AND is_deleted = FALSE`,
            [buyer_id]
        );

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Wishlist count retrieved successfully",
            data: { count: Number(countResult.rows[0].total) },
        });

    } catch (err) {
        logger.error("Responder Error (get-wishlist-count):", err);
        saveErrorLog({
            api_name: "get-wishlist-count",
            method: "RESPONDER",
            payload: req,
            message: "Internal server error",
            stack: err.stack,
            error_code: 2004,
        });
        return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: "Internal server error", error: err.message });
    }
});

// --------------------------------------------------
// BUYER QUOTE ACCEPTANCE
// --------------------------------------------------

//updates cart_item_status_id, unit_price, price, tax_amount, discount_amount, final_price

responder.on("accept-buyer-quote", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const { buyer_uuid, buyer_quote_uuid, accepted_by } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        if (!buyer_quote_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer quote uuid is required" });

        if (!accepted_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "accepted by is required" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // --------------------------------------------------
        // 3. RESOLVE quote + current status (buyer ownership enforced here)
        // --------------------------------------------------
        const quoteCheck = await pool.query(
            `SELECT bsq.buyer_quote_id, qs.code AS current_status_code
             FROM public.buyer_saved_quote bsq
             JOIN public.quote_statuses qs
               ON qs.quote_status_id = bsq.status_of_quote
             WHERE bsq.buyer_quote_uuid = $1
               AND bsq.buyer_id         = $2
               AND bsq.is_deleted       = FALSE`,
            [buyer_quote_uuid.trim(), buyer_id]
        );

        if (quoteCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No quote found for this buyer with the provided UUID" });

        const { buyer_quote_id, current_status_code } = quoteCheck.rows[0];

        // Only DRF (Draft) or ACT (Active/sent-to-buyer) quotes can be
        // accepted. DEN / EXP / ACC / CNV / DEL are terminal or already
        // progressed states.
        const ACCEPTABLE_STATUSES = ["DRF", "ACT"];

        if (!ACCEPTABLE_STATUSES.includes(current_status_code))
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Quote cannot be accepted from its current status (${current_status_code})`,
            });

        // --------------------------------------------------
        // 4. RESOLVE target statuses (ACC quote status, PND cart status)
        // --------------------------------------------------
        const [acceptedStatusResult, checkoutEligibleResult] = await Promise.all([
            pool.query(`SELECT quote_status_id FROM public.quote_statuses WHERE code = 'ACC' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT cart_item_status_id FROM public.cart_item_status WHERE code = 'PND' AND is_active = TRUE AND is_deleted = FALSE`),
        ]);

        if (acceptedStatusResult.rowCount === 0 || checkoutEligibleResult.rowCount === 0) {
            logger.error("accept-buyer-quote: missing master data — quote_statuses(ACC) or cart_item_status(PND)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const accepted_quote_status_id    = acceptedStatusResult.rows[0].quote_status_id;
        const checkout_eligible_status_id = checkoutEligibleResult.rows[0].cart_item_status_id;

        // --------------------------------------------------
        // 5. FETCH product-line quote items (cart_item_id NOT NULL only).
        //    Service charges live entirely in
        //    buyer_quote_service_charges (structured, service_charge_id
        //    master-linked) — NOT in buyer_quote_items. They need no
        //    cart_details sync here; checkout-initiate-quote pulls them
        //    directly from buyer_quote_service_charges via quote_id.
        // --------------------------------------------------
        const quoteItemsResult = await pool.query(
            `SELECT
                bqi.buyer_quote_item_id,
                bqi.cart_item_id,
                bqi.price_with_margin,
                bqi.quantity,
                bqi.tax_amount,
                cd.cart_item_uuid,
                cd.is_deleted AS cart_is_deleted
             FROM public.buyer_quote_items bqi
             LEFT JOIN public.cart_details cd
               ON cd.cart_item_id = bqi.cart_item_id
             WHERE bqi.buyer_quote_id = $1
               AND bqi.cart_item_id  IS NOT NULL
               AND bqi.is_active      = TRUE
               AND bqi.is_deleted     = FALSE`,
            [buyer_quote_id]
        );

        if (quoteItemsResult.rowCount === 0) {
            // A quote with zero product lines is not a valid checkout
            // target on its own — checkout always needs at least one
            // physical cart item.
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "This quote has no product line items to accept",
            });
        }

        // All-or-nothing: a quote is a fixed agreement, so if any
        // underlying cart item was removed/soft-deleted since the quote
        // was created, acceptance fails outright rather than proceeding
        // with a partial set.
        const missingCartRows = quoteItemsResult.rows.filter(
            (r) => !r.cart_item_uuid || r.cart_is_deleted
        );

        if (missingCartRows.length > 0) {
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2003,
                message:            "Record not found",
                error:              "Some quoted items are no longer available in the cart. This quote can no longer be accepted as-is.",
            });
        }

        // --------------------------------------------------
        // 6. TRANSACTION
        // --------------------------------------------------
        const now = new Date();

        // Fresh soft-hold window for the cart row. Quote review/
        // negotiation can take days, so the original add-to-cart
        // reservation_expires_at may be long stale by the time the
        // quote is accepted. Refreshing it here — same pattern used
        // in checkout-cancel.js / payment-cancel.js when a cart item
        // is handed back as an active, unattached line — keeps
        // expire-stale-cart-items.js and the cross-buyer netAvailable
        // calculation from treating a just-accepted item as expired.
        const fresh_reservation_expires_at = new Date(
            now.getTime() + commonenum.TIME_DURATION_MINUTES.RESERVATION_EXPIRY * 60 * 1000
        );

        await client.query("BEGIN");
        inTransaction = true;

        // 6a. Sync cart_details to the QUOTED price (margin applied),
        //     flip status back to checkout-eligible (PND), and refresh
        //     reservation_expires_at.
        //     quote_id / quote_item_id / quote_type_id are already set
        //     from create-buyer-quote — left untouched here, so
        //     checkout-initiate-quote can still trace these rows back
        //     to the quote.
        //     discount_amount reset to 0: the MRP-vs-sale-price
        //     "savings" framing no longer applies once a manual margin
        //     has been quoted and accepted.
        for (const item of quoteItemsResult.rows) {
            const price       = parseFloat((Number(item.price_with_margin) * Number(item.quantity)).toFixed(2));
            const final_price = parseFloat((price + Number(item.tax_amount)).toFixed(2));

            await client.query(
                `UPDATE public.cart_details SET
                    cart_item_status_id    = $1,
                    unit_price              = $2,
                    price                    = $3,
                    tax_amount               = $4,
                    discount_amount          = 0,
                    final_price              = $5,
                    reservation_expires_at   = $6,
                    modified_at              = $7,
                    modified_by              = $8
                 WHERE cart_item_id = $9
                   AND is_deleted   = FALSE`,
                [
                    checkout_eligible_status_id,
                    Number(item.price_with_margin),
                    price,
                    Number(item.tax_amount),
                    final_price,
                    fresh_reservation_expires_at,
                    now,
                    accepted_by,
                    item.cart_item_id,
                ]
            );
        }

        // 6b. Quote header -> ACC
        await client.query(
            `UPDATE public.buyer_saved_quote SET
                status_of_quote = $1,
                modified_at      = $2,
                modified_by      = $3
             WHERE buyer_quote_id = $4
               AND is_deleted     = FALSE`,
            [accepted_quote_status_id, now, accepted_by, buyer_quote_id]
        );

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 7. RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Quote accepted successfully",
            data: {
                buyer_quote_id,
                buyer_quote_uuid,
                accepted_items_count:   quoteItemsResult.rows.length,
                reservation_expires_at: fresh_reservation_expires_at,
                accepted_at:            now,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (accept-buyer-quote):", err);
        saveErrorLog({
            api_name:   "accept-buyer-quote",
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
            message:            "Quote acceptance failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// BUYER QUOTE REJECTION
// --------------------------------------------------

responder.on("reject-buyer-quote", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const {
            buyer_uuid,
            buyer_quote_uuid,
            rejection_reason,   // optional
            modified_by,
        } = req.body;

        const now = new Date();

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        if (!buyer_quote_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer quote uuid is required" });

        if (!modified_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "modified by is required" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // --------------------------------------------------
        // 3. RESOLVE quote + current status 
        // --------------------------------------------------
        const quoteCheck = await pool.query(
            `SELECT bsq.buyer_quote_id, bsq.quote_no, qs.code AS current_status_code
             FROM public.buyer_saved_quote bsq
             JOIN public.quote_statuses qs
               ON qs.quote_status_id = bsq.status_of_quote
             WHERE bsq.buyer_quote_uuid = $1
               AND bsq.buyer_id         = $2
               AND bsq.is_deleted       = FALSE`,
            [buyer_quote_uuid.trim(), buyer_id]
        );

        if (quoteCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No quote found for this buyer with the provided UUID" });

        const { buyer_quote_id, quote_no, current_status_code } = quoteCheck.rows[0];

        // Only quotes still awaiting a decision can be rejected.
        // ACC / CNV / DEN / EXP / DEL are terminal or already-progressed
        // states — rejecting from those makes no sense.
        const REJECTABLE_STATUSES = ["DRF", "ACT"];

        if (!REJECTABLE_STATUSES.includes(current_status_code))
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Quote cannot be rejected from its current status (${current_status_code})`,
            });

        // --------------------------------------------------
        // 4. RESOLVE 'DEN' quote status
        // --------------------------------------------------
        const deniedStatusResult = await pool.query(
            `SELECT quote_status_id FROM public.quote_statuses WHERE code = 'DEN' AND is_active = TRUE AND is_deleted = FALSE`
        );

        if (deniedStatusResult.rowCount === 0) {
            logger.error("reject-buyer-quote-by-buyer: missing master data — quote_statuses(DEN)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const denied_status_id = deniedStatusResult.rows[0].quote_status_id;

        // --------------------------------------------------
        // 5. TRANSACTION
        // --------------------------------------------------
        await client.query("BEGIN");
        inTransaction = true;

        // Quote header -> DEN.
        // NOTE: cart_details rows linked to this quote (status QTD) are
        // intentionally left untouched — they stay QTD, which is not an
        // eligible status for checkout-initiate (only PND is accepted).
        // This alone blocks order creation, with no separate guard needed.
        // If the buyer wants these products again, they must re-add to
        // cart or request a new quote.
        const updateResult = await client.query({
            text: `UPDATE public.buyer_saved_quote SET
                        status_of_quote  = $1,
                        modified_at       = $2,
                        modified_by       = $3
                   WHERE buyer_quote_id = $4
                     AND is_deleted     = FALSE
                   RETURNING buyer_quote_id, buyer_quote_uuid, quote_no, status_of_quote`,
            values: [denied_status_id, now, modified_by, buyer_quote_id],
        });

        await client.query("COMMIT");
        inTransaction = false;

        const updated = updateResult.rows[0];

        // --------------------------------------------------
        // 6. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Quote rejected successfully",
            data: {
                buyer_quote_id:   updated.buyer_quote_id,
                buyer_quote_uuid: updated.buyer_quote_uuid,
                quote_no:         updated.quote_no,
                status_of_quote:  updated.status_of_quote,
                rejection_reason: rejection_reason?.trim() || null,
                rejected_at:      now,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (reject-buyer-quote-by-buyer):", err);
        saveErrorLog({
            api_name:   "reject-buyer-quote-by-buyer",
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
            message:            "Quote rejection failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// SEARCH CAR BRANDS (autocomplete — no dropdown, free typing)
// --------------------------------------------------

responder.on("search-car-brands", async (req, cb) => {
    try {
        const { search = "" } = req.body;

        const result = await pool.query(
            `SELECT brand_id, brand_uuid, name, logo_path
             FROM public.brand
             WHERE is_active  = TRUE
               AND is_deleted = FALSE
               AND ($1 = '' OR name ILIKE '%' || $1 || '%')
             ORDER BY
               CASE WHEN name ILIKE $1 || '%' THEN 0 ELSE 1 END,
               name ASC
             LIMIT 10`,
            [search.trim()]
        );

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Brand suggestions fetched successfully",
            data: result.rows.map((r) => ({
                brand_id:   r.brand_id,
                brand_uuid: r.brand_uuid,
                name:        r.name,
                logo_path:   r.logo_path,
            })),
        });

    } catch (err) {
        logger.error("Responder Error (search-car-brands):", err);
        return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: "Internal server error", error: err.message });
    }
});

// --------------------------------------------------
// SEARCH CAR MODELS (autocomplete, optionally scoped by brand name)
// --------------------------------------------------

responder.on("search-car-models", async (req, cb) => {
    try {
        const { search = "", brand_name = "" } = req.body;

        // If brand_name is provided, scope to models under that brand
        // (matched by name, since no brand_id is passed from the front
        // end). If the brand name doesn't resolve to any catalogue
        // brand, fall back to an unscoped model search.
        const result = await pool.query(
            `SELECT m.model_id, m.model_uuid, m.name, b.name AS brand_name
             FROM public.model m
             LEFT JOIN public.brand b
               ON b.brand_id = m.brand_id
              AND b.is_active = TRUE AND b.is_deleted = FALSE
             WHERE m.is_active  = TRUE
               AND m.is_deleted = FALSE
               AND ($1 = '' OR m.name ILIKE '%' || $1 || '%')
               AND (
                    $2 = ''
                    OR b.name ILIKE $2
                    OR NOT EXISTS (
                        SELECT 1 FROM public.brand b2
                        WHERE b2.name ILIKE $2 AND b2.is_active = TRUE AND b2.is_deleted = FALSE
                    )
                   )
             ORDER BY
               CASE WHEN m.name ILIKE $1 || '%' THEN 0 ELSE 1 END,
               m.name ASC
             LIMIT 10`,
            [search.trim(), brand_name.trim()]
        );

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Model suggestions fetched successfully",
            data: result.rows.map((r) => ({
                model_id:   r.model_id,
                model_uuid: r.model_uuid,
                name:        r.name,
                brand_name:  r.brand_name,
            })),
        });

    } catch (err) {
        logger.error("Responder Error (search-car-models):", err);
        return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: "Internal server error", error: err.message });
    }
});

// --------------------------------------------------
// SEARCH CAR VARIANTS (autocomplete, optionally scoped)
// --------------------------------------------------

responder.on("search-car-variants", async (req, cb) => {
    try {
        const { search = "", brand_name = "", model_name = "" } = req.body;

        const result = await pool.query(
            `SELECT c.car_id, c.car_uuid, c.car_name, b.name AS brand_name, m.name AS model_name
             FROM public.cars c
             JOIN public.brand b ON b.brand_id = c.brand_id
             JOIN public.model m ON m.model_id = c.model_id
             WHERE c.is_active  = TRUE
               AND c.is_deleted = FALSE
               AND ($1 = '' OR c.car_name ILIKE '%' || $1 || '%')
               AND ($2 = '' OR b.name ILIKE $2)
               AND ($3 = '' OR m.name ILIKE $3)
             ORDER BY
               CASE WHEN c.car_name ILIKE $1 || '%' THEN 0 ELSE 1 END,
               c.car_name ASC
             LIMIT 10`,
            [search.trim(), brand_name.trim(), model_name.trim()]
        );

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Variant suggestions fetched successfully",
            data: result.rows.map((r) => ({
                car_id:      r.car_id,
                car_uuid:    r.car_uuid,
                car_name:    r.car_name,
                brand_name:  r.brand_name,
                model_name:  r.model_name,
            })),
        });

    } catch (err) {
        logger.error("Responder Error (search-car-variants):", err);
        return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: "Internal server error", error: err.message });
    }
});

// --------------------------------------------------
// CREATE VEHICLE PROFILE (free-text, search-driven — no dropdowns)
// --------------------------------------------------
// brand_name / model_name / variant are plain text the buyer typed or
// picked from search-car-brands / search-car-models / search-car-variants
// suggestions. They are stored AS-IS in brand_info / model_info /
// car_info — no FK/UUID validation against the catalogue, since there
// is no forced dropdown selection.
// --------------------------------------------------

responder.on("create-car-profile", async (req, cb) => {
    try {
        const {
            buyer_uuid,
            brand_name,
            model_name,
            variant,      // optional — e.g. "GLX 1.8L", "LE 2.5L"
            year,          // optional
            vin_no,        // optional
            created_by,
        } = req.body;

        const now = new Date();

        // --------------------------------------------------
        // VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });

        if (!brand_name?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Brand name is required" });

        if (!model_name?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Model name is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created_by is required" });

        if (brand_name.trim().length > 1000 || model_name.trim().length > 1000)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Brand/model name must be 1000 characters or fewer" });

        if (year !== undefined && year !== null && year !== "") {
            const yr = Number(year);
            const currentYear = new Date().getFullYear();
            if (isNaN(yr) || yr < 1980 || yr > currentYear + 1)
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `Year must be between 1980 and ${currentYear + 1}` });
        }

        if (vin_no?.trim() && vin_no.trim().length > 50)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "VIN number must be 50 characters or fewer" });

        // --------------------------------------------------
        // RESOLVE buyer_id
        // --------------------------------------------------
        const buyerResult = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const { buyer_id } = buyerResult.rows[0];

        // --------------------------------------------------
        // COMPOSE car_info — "<variant> (<year>)", suitable for an
        // eparts site (e.g. "GLX 1.8L (2020)"). Either half is optional.
        // --------------------------------------------------
        const carInfoParts = [];
        if (variant?.trim()) carInfoParts.push(variant.trim());
        if (year !== undefined && year !== null && year !== "") carInfoParts.push(`(${Number(year)})`);
        const car_info = carInfoParts.length > 0 ? carInfoParts.join(" ") : null;

        // --------------------------------------------------
        // INSERT — stored as plain text, exactly as provided
        // --------------------------------------------------
        const insertResult = await pool.query(
            `INSERT INTO public.car_management (
                buyer_id, brand_info, model_info, car_info, vin_no,
                assigned_to, assigned_at, created_by
             ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $6
             )
             RETURNING car_management_id, car_management_uuid, created_at`,
            [
                buyer_id,
                brand_name.trim(),
                model_name.trim(),
                car_info,
                vin_no?.trim() || null,
                created_by,
                now,
            ]
        );

        const { car_management_id, car_management_uuid, created_at } = insertResult.rows[0];

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Vehicle profile created successfully",
            data: {
                car_management_id,
                car_management_uuid,
                buyer_id,
                brand_info: brand_name.trim(),
                model_info: model_name.trim(),
                car_info,
                vin_no:     vin_no?.trim() || null,
                created_at,
            },
        });

    } catch (err) {
        if (err.code === "23505") {
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2002, message: "Duplicate VIN number", error: "A vehicle with this VIN number already exists" });
        }
        logger.error("Responder Error (create-car-profile):", err);
        saveErrorLog({
            api_name:   "create-car-profile",
            method:     "RESPONDER",
            payload:    req,
            message:    "Internal server error",
            stack:      err.stack,
            error_code: 2004,
        });
        return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: "Vehicle profile creation failed", error: err.message });
    }
});


// --------------------------------------------------
// GET ALL BUYER VEHICLE PROFILES
// --------------------------------------------------

responder.on("get-buyer-cars", async (req, cb) => {
    try {
        const { buyer_uuid, Page = 1, PageSize = 10 } = req.body;

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });

        const page     = Math.max(Number(Page) || 1, 1);
        const pageSize = Math.min(Math.max(Number(PageSize) || 10, 1), 100);
        const offset   = (page - 1) * pageSize;

        const buyerResult = await pool.query(
            `SELECT buyer_id FROM public.buyer_accounts
             WHERE buyer_uuid = $1 AND is_active = TRUE AND is_deleted = FALSE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const { buyer_id } = buyerResult.rows[0];

        const countResult = await pool.query(
            `SELECT COUNT(*) AS total FROM public.car_management
             WHERE buyer_id = $1 AND is_deleted = FALSE`,
            [buyer_id]
        );

        const total      = Number(countResult.rows[0].total);
        const totalPages = Math.ceil(total / pageSize);

        // brand_info/model_info are matched (case-insensitive, trimmed)
        // against brand.name/model.name to derive product counts, since
        // car_management stores no FK columns.
        const listResult = await pool.query(
            `SELECT
                cm.car_management_id,
                cm.car_management_uuid,
                cm.brand_info,
                cm.model_info,
                cm.car_info,
                cm.vin_no,
                cm.created_at,
                b.brand_id,
                m.model_id,
                (
                    SELECT COUNT(*) FROM public.products p
                    WHERE p.brand_id   = b.brand_id
                      AND p.model_id   = m.model_id
                      AND p.is_listed  = TRUE
                      AND p.is_active  = TRUE
                      AND p.is_deleted = FALSE
                ) AS associated_products_count
             FROM public.car_management cm
             LEFT JOIN public.brand b
               ON LOWER(TRIM(b.name)) = LOWER(TRIM(cm.brand_info))
              AND b.is_active  = TRUE
              AND b.is_deleted = FALSE
             LEFT JOIN public.model m
               ON LOWER(TRIM(m.name)) = LOWER(TRIM(cm.model_info))
              AND m.brand_id   = b.brand_id
              AND m.is_active  = TRUE
              AND m.is_deleted = FALSE
             WHERE cm.buyer_id  = $1
               AND cm.is_deleted = FALSE
             ORDER BY cm.created_at DESC
             LIMIT $2 OFFSET $3`,
            [buyer_id, pageSize, offset]
        );

        const data = listResult.rows.map((row) => ({
            car_management_id:   row.car_management_id,
            car_management_uuid: row.car_management_uuid,
            brand_info:           row.brand_info,
            model_info:           row.model_info,
            car_info:             row.car_info,
            vin_no:               row.vin_no,
            // null if brand/model text no longer matches any active
            // catalogue entry (e.g. buyer typed a non-catalogue brand,
            // or the catalogue name changed since).
            matched_brand_id:     row.brand_id,
            matched_model_id:     row.model_id,
            associated_products_count: Number(row.associated_products_count),
            created_at:           row.created_at,
        }));

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Vehicle profiles fetched successfully",
            error:              null,
            result: { page, pageSize, totalRecords: total, totalPages, data },
        });

    } catch (err) {
        logger.error("Responder Error (get-buyer-cars):", err);
        return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: "Internal server error", error: err.message });
    }
});


// ================================================================
// GET SPECIFIC VEHICLE PROFILE (WITH EDIT LOCKING)
// ================================================================

responder.on("get-car-details", async (req, cb) => {
    const client = await pool.connect();

    try {
        const { buyer_uuid, car_management_uuid, mode, user_id } = req.body;

        const LOCK_MINUTES = 1;

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });

        if (!car_management_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "car_management_uuid is required" });

        await client.query('BEGIN');

        // -----------------------------
        // RESOLVE buyer_id
        // -----------------------------
        const buyerResult = await client.query(
            `SELECT buyer_id FROM public.buyer_accounts
             WHERE buyer_uuid = $1 AND is_active = TRUE AND is_deleted = FALSE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });
        }

        const { buyer_id } = buyerResult.rows[0];

        // -----------------------------
        // FETCH CAR PROFILE (ownership enforced)
        // -----------------------------
        const carResult = await client.query(
            `SELECT
                cm.car_management_id, cm.car_management_uuid,
                cm.brand_info, cm.model_info, cm.car_info, cm.vin_no,
                cm.created_at, cm.modified_at,
                b.brand_id, b.name AS matched_brand_name, b.logo_path AS brand_logo,
                m.model_id, m.name AS matched_model_name,
                c.car_id, c.car_name AS matched_car_name, c.code AS car_code
             FROM public.car_management cm
             LEFT JOIN public.brand b
               ON LOWER(TRIM(b.name)) = LOWER(TRIM(cm.brand_info))
              AND b.is_active  = TRUE
              AND b.is_deleted = FALSE
             LEFT JOIN public.model m
               ON LOWER(TRIM(m.name)) = LOWER(TRIM(cm.model_info))
              AND m.brand_id   = b.brand_id
              AND m.is_active  = TRUE
              AND m.is_deleted = FALSE
             LEFT JOIN public.cars c
               ON c.brand_id   = b.brand_id
              AND c.model_id   = m.model_id
              AND cm.car_info ILIKE (c.car_name || '%')
              AND c.is_active  = TRUE
              AND c.is_deleted = FALSE
             WHERE cm.car_management_uuid = $1
               AND cm.buyer_id             = $2
               AND cm.is_deleted           = FALSE`,
            [car_management_uuid.trim(), buyer_id]
        );

        if (carResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No vehicle profile found for this buyer with the provided UUID" });
        }

        const car = carResult.rows[0];

        // -----------------------------
        // LOCK HANDLING (edit mode only)
        // -----------------------------
        let lockRow = null;

        if (mode === 'edit') {

            if (!user_id) {
                await client.query('ROLLBACK');
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "User ID required for edit mode" });
            }

            const lockRes = await client.query(
                `SELECT RL.*, U.username AS locked_by_name
                 FROM record_locks RL
                 LEFT JOIN users U ON U.user_uuid = RL.locked_by
                 WHERE RL.table_name = 'car_management'
                   AND RL.record_id  = $1
                   AND RL.is_deleted = FALSE`,
                [car_management_uuid.trim()]
            );

            lockRow = lockRes.rows[0];

            const isExpired =
                lockRow &&
                new Date(lockRow.expires_at).getTime() < Date.now();

            if (lockRow && lockRow.locked_by !== user_id && !isExpired) {
                await client.query('ROLLBACK');
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2005,
                    message: `Record is locked by ${lockRow.locked_by_name}`
                });
            }

            if (lockRow && isExpired) {
                await client.query(
                    `UPDATE record_locks
                     SET is_deleted = TRUE,
                         deleted_by = $1,
                         deleted_at = NOW()
                     WHERE lock_id = $2`,
                    [user_id, lockRow.lock_id]
                );
                lockRow = null;
            }

            if (!lockRow) {
                const newLock = await client.query(
                    `INSERT INTO record_locks
                        (table_name, record_id, locked_by, expires_at, created_by)
                     VALUES
                        ('car_management', $1, $2, NOW() + ($3 || ' minute')::INTERVAL, $2)
                     RETURNING *`,
                    [car_management_uuid.trim(), user_id, LOCK_MINUTES]
                );
                lockRow = newLock.rows[0];
            } else if (lockRow.locked_by === user_id) {
                const refresh = await client.query(
                    `UPDATE record_locks
                     SET expires_at = NOW() + ($2 || ' minute')::INTERVAL
                     WHERE lock_id  = $1
                     RETURNING *`,
                    [lockRow.lock_id, LOCK_MINUTES]
                );
                lockRow = refresh.rows[0];
            }
        }

        // -----------------------------
        // LINKED PRODUCTS (unrelated to locking — same as before)
        // -----------------------------
        let linked_products = { total_count: 0, sample: [] };

        if (car.brand_id && car.model_id) {
            const [productsResult, productsCountResult] = await Promise.all([
                client.query(
                    `SELECT product_uuid, name, sku, oem_part_number, price_after_sale
                     FROM public.products
                     WHERE brand_id   = $1
                       AND model_id   = $2
                       AND is_listed  = TRUE
                       AND is_active  = TRUE
                       AND is_deleted = FALSE
                     ORDER BY created_at DESC
                     LIMIT 12`,
                    [car.brand_id, car.model_id]
                ),
                client.query(
                    `SELECT COUNT(*) AS total FROM public.products
                     WHERE brand_id = $1 AND model_id = $2
                       AND is_listed = TRUE AND is_active = TRUE AND is_deleted = FALSE`,
                    [car.brand_id, car.model_id]
                ),
            ]);

            linked_products = {
                total_count: Number(productsCountResult.rows[0].total),
                sample: productsResult.rows.map((p) => ({
                    product_uuid:    p.product_uuid,
                    name:             p.name,
                    sku:              p.sku,
                    oem_part_number: p.oem_part_number,
                    price:            Number(p.price_after_sale),
                })),
            };
        }

        await client.query('COMMIT');

        const lock_status =
            lockRow &&
            new Date(lockRow.expires_at).getTime() >= Date.now();

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Vehicle profile fetched successfully",
            data: {
                car_management_id:   car.car_management_id,
                car_management_uuid: car.car_management_uuid,
                brand_info:           car.brand_info,
                model_info:           car.model_info,
                car_info:             car.car_info,
                vin_no:               car.vin_no,
                matched: {
                    brand: car.brand_id ? { brand_id: car.brand_id, name: car.matched_brand_name, logo_path: car.brand_logo } : null,
                    model: car.model_id ? { model_id: car.model_id, name: car.matched_model_name } : null,
                    variant: car.car_id ? { car_id: car.car_id, name: car.matched_car_name, code: car.car_code } : null,
                },
                linked_products,
                created_at:  car.created_at,
                modified_at: car.modified_at,
            },
            lock: lockRow
                ? {
                    status:     lock_status,
                    by:         lockRow.locked_by,
                    by_name:    lockRow.locked_by_name,
                    expires_at: lockRow.expires_at
                }
                : { status: false }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (get-car-details):", err);
        return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: "Fetch failed", error: err.message });
    } finally {
        client.release();
    }
});

// ================================================================
// UPDATE VEHICLE PROFILE (WITH EDIT LOCK ENFORCEMENT)
// ================================================================

responder.on("update-car-profile", async (req, cb) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const {
            buyer_uuid,
            car_management_uuid,
            brand_name,
            model_name,
            variant,
            year,
            vin_no,
            modified_by,
        } = req.body;

        const now = new Date();

        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!buyer_uuid?.trim()) {
            await client.query('ROLLBACK');
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });
        }

        if (!car_management_uuid?.trim()) {
            await client.query('ROLLBACK');
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "car_management_uuid is required" });
        }

        if (!modified_by?.trim()) {
            await client.query('ROLLBACK');
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "modified_by is required" });
        }

        if (year !== undefined && year !== null && year !== "") {
            const yr = Number(year);
            const currentYear = new Date().getFullYear();
            if (isNaN(yr) || yr < 1980 || yr > currentYear + 1) {
                await client.query('ROLLBACK');
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `Year must be between 1980 and ${currentYear + 1}` });
            }
        }

        // -----------------------------
        // RESOLVE buyer_id
        // -----------------------------
        const buyerResult = await client.query(
            `SELECT buyer_id FROM public.buyer_accounts
             WHERE buyer_uuid = $1 AND is_active = TRUE AND is_deleted = FALSE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });
        }

        const { buyer_id } = buyerResult.rows[0];

        // -----------------------------
        // CHECK RECORD EXISTS + OWNERSHIP
        // -----------------------------
        const existingResult = await client.query(
            `SELECT car_management_id, brand_info, model_info, car_info, vin_no
             FROM public.car_management
             WHERE car_management_uuid = $1 AND buyer_id = $2 AND is_deleted = FALSE`,
            [car_management_uuid.trim(), buyer_id]
        );

        if (existingResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No vehicle profile found for this buyer with the provided UUID" });
        }

        const existing = existingResult.rows[0];

        // -----------------------------
        // CHECK EDIT LOCK — modified_by must hold a live lock
        // -----------------------------
        const lockCheck = await client.query(
            `SELECT 1 FROM record_locks
             WHERE table_name = 'car_management'
               AND record_id  = $1
               AND locked_by  = $2
               AND is_deleted = FALSE
               AND expires_at > NOW()`,
            [car_management_uuid.trim(), modified_by]
        );

        if (lockCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2005,
                message: "Update failed",
                error: "You must lock the record before updating"
            });
        }

        // -----------------------------
        // COMPOSE brand_info / model_info / car_info
        // -----------------------------
        const brand_info = brand_name?.trim() ? brand_name.trim() : existing.brand_info;
        const model_info = model_name?.trim() ? model_name.trim() : existing.model_info;

        let car_info = existing.car_info;

        if (variant !== undefined || year !== undefined) {
            const carInfoParts = [];
            if (variant?.trim()) carInfoParts.push(variant.trim());
            if (year !== undefined && year !== null && year !== "") carInfoParts.push(`(${Number(year)})`);
            car_info = carInfoParts.length > 0 ? carInfoParts.join(" ") : null;
        }

        // -----------------------------
        // UPDATE
        // -----------------------------
        const updateResult = await client.query(
            `UPDATE public.car_management SET
                brand_info   = $1,
                model_info    = $2,
                car_info      = $3,
                vin_no        = COALESCE($4, vin_no),
                modified_at   = $5,
                modified_by   = $6
             WHERE car_management_id = $7
             RETURNING car_management_id, car_management_uuid, brand_info, model_info, car_info, vin_no, modified_at`,
            [
                brand_info,
                model_info,
                car_info,
                vin_no?.trim() || null,
                now,
                modified_by,
                existing.car_management_id,
            ]
        );

        // -----------------------------
        // AUTO-UNLOCK AFTER SUCCESS
        // -----------------------------
        await client.query(
            `UPDATE record_locks
             SET is_deleted = TRUE,
                 deleted_by = $1,
                 deleted_at = NOW()
             WHERE table_name = 'car_management'
               AND record_id  = $2
               AND locked_by  = $3
               AND is_deleted = FALSE`,
            [modified_by, car_management_uuid.trim(), modified_by]
        );

        await client.query('COMMIT');

        const updated = updateResult.rows[0];

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Vehicle profile updated successfully",
            data: {
                car_management_id:   updated.car_management_id,
                car_management_uuid: updated.car_management_uuid,
                brand_info:           updated.brand_info,
                model_info:           updated.model_info,
                car_info:             updated.car_info,
                vin_no:               updated.vin_no,
                modified_at:          updated.modified_at,
            },
        });

    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === "23505") {
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2002, message: "Duplicate VIN number", error: "A vehicle with this VIN number already exists" });
        }
        logger.error("Responder Error (update-car-profile):", err);
        saveErrorLog({
            api_name:   "update-car-profile",
            method:     "RESPONDER",
            payload:    req,
            message:    "Internal server error",
            stack:      err.stack,
            error_code: 2004,
        });
        return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: "Update failed", error: err.message });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// SOFT DELETE BUYER VEHICLE PROFILE
// --------------------------------------------------

responder.on("delete-car-profile", async (req, cb) => {
    try {
        const { buyer_uuid, car_management_uuid, modified_by } = req.body;
        const now = new Date();

        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });

        if (!car_management_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "car_management_uuid is required" });

        if (!modified_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "modified_by is required" });

        const buyerResult = await pool.query(
            `SELECT buyer_id FROM public.buyer_accounts
             WHERE buyer_uuid = $1 AND is_active = TRUE AND is_deleted = FALSE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const { buyer_id } = buyerResult.rows[0];

        const deleteResult = await pool.query(
            `UPDATE public.car_management SET
                is_deleted  = TRUE,
                is_active   = FALSE,
                deleted_at  = $1,
                deleted_by  = $2,
                modified_at = $1,
                modified_by = $2
             WHERE car_management_uuid = $3
               AND buyer_id             = $4
               AND is_deleted           = FALSE
             RETURNING car_management_id, car_management_uuid, deleted_at`,
            [now, modified_by, car_management_uuid.trim(), buyer_id]
        );

        if (deleteResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active vehicle profile found for this buyer with the provided UUID" });

        const deleted = deleteResult.rows[0];

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Vehicle profile deleted successfully",
            data: {
                car_management_id:   deleted.car_management_id,
                car_management_uuid: deleted.car_management_uuid,
                deleted_at:           deleted.deleted_at,
            },
        });

    } catch (err) {
        logger.error("Responder Error (delete-car-profile):", err);
        saveErrorLog({
            api_name:   "delete-car-profile",
            method:     "RESPONDER",
            payload:    req,
            message:    "Internal server error",
            stack:      err.stack,
            error_code: 2004,
        });
        return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: "Vehicle profile deletion failed", error: err.message });
    }
});

// --------------------------------------------------
// GET PRODUCTS BY CAR
// --------------------------------------------------

responder.on("get-products-by-vehicle", async (req, cb) => {
    try {
        const { buyer_uuid, car_management_uuid, Page = 1, PageSize = 10 } = req.body;

        // --------------------------------------------------
        // VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Buyer UUID is required" });

        if (!car_management_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "car_management_uuid is required" });

        const page     = Math.max(Number(Page) || 1, 1);
        const pageSize = Math.min(Math.max(Number(PageSize) || 10, 1), 100);
        const offset   = (page - 1) * pageSize;

        // --------------------------------------------------
        // RESOLVE buyer_id
        // --------------------------------------------------
        const buyerResult = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const { buyer_id } = buyerResult.rows[0];

        // --------------------------------------------------
        // RESOLVE car (ownership enforced) + matched brand/model/car_id
        // --------------------------------------------------
        const carResult = await pool.query(
            `SELECT
                cm.car_management_id,
                b.brand_id, m.model_id, c.car_id
             FROM public.car_management cm
             LEFT JOIN public.brand b
               ON LOWER(TRIM(b.name)) = LOWER(TRIM(cm.brand_info))
              AND b.is_active  = TRUE
              AND b.is_deleted = FALSE
             LEFT JOIN public.model m
               ON LOWER(TRIM(m.name)) = LOWER(TRIM(cm.model_info))
              AND m.brand_id   = b.brand_id
              AND m.is_active  = TRUE
              AND m.is_deleted = FALSE
             LEFT JOIN public.cars c
               ON c.brand_id   = b.brand_id
              AND c.model_id   = m.model_id
              AND cm.car_info ILIKE (c.car_name || '%')
              AND c.is_active  = TRUE
              AND c.is_deleted = FALSE
             WHERE cm.car_management_uuid = $1
               AND cm.buyer_id             = $2
               AND cm.is_deleted           = FALSE`,
            [car_management_uuid.trim(), buyer_id]
        );

        if (carResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No vehicle profile found for this buyer with the provided UUID" });

        const { brand_id, model_id, car_id } = carResult.rows[0];

        // No catalogue match at all — nothing to filter against.
        if (!brand_id && !model_id && !car_id) {
            return cb(null, {
                header_type: "SUCCESS", message_visibility: true, status: true, code: 1000,
                message: "No compatible products found for this vehicle",
                error: null,
                result: { page, pageSize, totalRecords: 0, totalPages: 0, data: [] },
            });
        }

        // --------------------------------------------------
        // COMPATIBLE PART NUMBERS — union across group / sub_group /
        // sub_node levels, all tracing back to the matched car_id.
        // --------------------------------------------------
        const compatiblePartsCTE = `
            WITH compatible_part_ids AS (
                SELECT gp.part_id
                FROM public.group_parts gp
                JOIN public.groups g
                  ON g.group_id = gp.group_id
                 AND g.car_id   = $1
                 AND g.is_active = TRUE AND g.is_deleted = FALSE
                WHERE gp.is_active = TRUE AND gp.is_deleted = FALSE

                UNION

                SELECT sgp.part_id
                FROM public.sub_group_parts sgp
                JOIN public.sub_groups sg
                  ON sg.sub_group_id = sgp.sub_group_id
                 AND sg.is_active = TRUE AND sg.is_deleted = FALSE
                JOIN public.groups g
                  ON g.group_id = sg.group_id
                 AND g.car_id   = $1
                 AND g.is_active = TRUE AND g.is_deleted = FALSE
                WHERE sgp.is_active = TRUE AND sgp.is_deleted = FALSE

                UNION

                SELECT snp.part_id
                FROM public.sub_node_parts snp
                JOIN public.sub_nodes sn
                  ON sn.sub_node_id = snp.sub_node_id
                 AND sn.is_active = TRUE AND sn.is_deleted = FALSE
                JOIN public.sub_groups sg
                  ON sg.sub_group_id = sn.sub_group_id
                 AND sg.is_active = TRUE AND sg.is_deleted = FALSE
                JOIN public.groups g
                  ON g.group_id = sg.group_id
                 AND g.car_id   = $1
                 AND g.is_active = TRUE AND g.is_deleted = FALSE
                WHERE snp.is_active = TRUE AND snp.is_deleted = FALSE
            ),
            compatible_part_numbers AS (
                SELECT DISTINCT p.part_number
                FROM public.parts p
                JOIN compatible_part_ids cpi ON cpi.part_id = p.part_id
                WHERE p.is_active = TRUE AND p.is_deleted = FALSE
            )
        `;

        // --------------------------------------------------
        // COUNT
        // --------------------------------------------------
        const countResult = await pool.query(
            `${compatiblePartsCTE}
             SELECT COUNT(DISTINCT prod.product_id) AS total
             FROM public.products prod
             WHERE prod.is_listed  = TRUE
               AND prod.is_active  = TRUE
               AND prod.is_deleted = FALSE
               AND (
                    prod.oem_part_number IN (SELECT part_number FROM compatible_part_numbers)
                 OR prod.aftermarket_number IN (SELECT part_number FROM compatible_part_numbers)
                 OR prod.equivalent_oem_part_numbers ?| (SELECT COALESCE(array_agg(part_number), ARRAY[]::text[]) FROM compatible_part_numbers)
                 OR ($2::integer IS NOT NULL AND prod.brand_id = $2)
                 OR ($3::integer IS NOT NULL AND prod.model_id = $3)
               )`,
            [car_id || null, brand_id || null, model_id || null]
        );

        const total      = Number(countResult.rows[0].total);
        const totalPages = Math.ceil(total / pageSize);

        // --------------------------------------------------
        // LIST
        // --------------------------------------------------
        const listResult = await pool.query(
            `${compatiblePartsCTE}
             SELECT DISTINCT
                prod.product_id,
                prod.product_uuid,
                prod.name,
                prod.sku,
                prod.oem_part_number,
                prod.aftermarket_number,
                prod.brand_id,
                prod.model_id,
                prod.price_after_sale
             FROM public.products prod
             WHERE prod.is_listed  = TRUE
               AND prod.is_active  = TRUE
               AND prod.is_deleted = FALSE
               AND (
                    prod.oem_part_number IN (SELECT part_number FROM compatible_part_numbers)
                 OR prod.aftermarket_number IN (SELECT part_number FROM compatible_part_numbers)
                 OR prod.equivalent_oem_part_numbers ?| (SELECT COALESCE(array_agg(part_number), ARRAY[]::text[]) FROM compatible_part_numbers)
                 OR ($2::integer IS NOT NULL AND prod.brand_id = $2)
                 OR ($3::integer IS NOT NULL AND prod.model_id = $3)
               )
             ORDER BY prod.product_id DESC
             LIMIT $4 OFFSET $5`,
            [car_id || null, brand_id || null, model_id || null, pageSize, offset]
        );

        const data = listResult.rows.map((p) => ({
            product_uuid:       p.product_uuid,
            name:                 p.name,
            sku:                  p.sku,
            oem_part_number:     p.oem_part_number,
            aftermarket_number: p.aftermarket_number,
            price:                Number(p.price_after_sale),
        }));

        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Compatible products fetched successfully",
            error:              null,
            result: { page, pageSize, totalRecords: total, totalPages, data },
        });

    } catch (err) {
        logger.error("Responder Error (get-products-by-vehicle):", err);
        saveErrorLog({
            api_name:   "get-products-by-vehicle",
            method:     "RESPONDER",
            payload:    req,
            message:    "Internal server error",
            stack:      err.stack,
            error_code: 2004,
        });
        return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2004, message: "Fetch failed", error: err.message });
    }
});

// --------------------------------------------------
// CHECKOUT INITIATE — QUOTE FLOW
// --------------------------------------------------
// Distinct from checkout-initiate.js:
//   - Input is buyer_quote_uuid, NOT cart_item_uuids. ALL PND cart
//     items under this quote are checked out together — no partial
//     selection possible (full-quote-only rule).
//   - unit_price/tax_amount/discount_amount/final_price are NOT
//     recomputed from products — they were already locked at
//     accept-buyer-quote time. Only stock (ATP) is re-validated here.
//   - service_charges are copied 1:1 from buyer_quote_service_charges.
//     NO manual/client-supplied service_charges accepted in this flow.
//   - On success, buyer_saved_quote.status_of_quote moves ACC -> CNV
//     (converted), so the quote can't be re-accepted or re-initiated
//     elsewhere while this checkout is alive.
// --------------------------------------------------


responder.on("checkout-initiate-quote", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const {
            buyer_uuid,
            buyer_quote_uuid,
            checkout_type_uuid,
            notes,
            created_by,
        } = req.body;

        const now         = new Date();
        const assigned_to = created_by;
        const assigned_at = now;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        if (!buyer_quote_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer quote uuid is required" });

        if (!checkout_type_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "checkout_type_uuid is required" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created by is required" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // --------------------------------------------------
        // 3. RESOLVE quote (ownership + status). Only ACC (accepted,
        //    not yet checked out) quotes can be initiated here.
        // --------------------------------------------------
        const quoteCheck = await pool.query(
            `SELECT bsq.buyer_quote_id, qs.code AS status_code
             FROM public.buyer_saved_quote bsq
             JOIN public.quote_statuses qs
               ON qs.quote_status_id = bsq.status_of_quote
             WHERE bsq.buyer_quote_uuid = $1
               AND bsq.buyer_id         = $2
               AND bsq.is_deleted       = FALSE`,
            [buyer_quote_uuid.trim(), buyer_id]
        );

        if (quoteCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No quote found for this buyer with the provided UUID" });

        const { buyer_quote_id, status_code } = quoteCheck.rows[0];

        if (status_code !== "ACC")
            return cb(null, {
                header_type:        "ERROR",
                message_visibility: true,
                status:             false,
                code:               2008,
                message:            "Action not allowed",
                error:              `Quote must be accepted (ACC) before checkout. Current status: '${status_code}'`,
            });

        // --------------------------------------------------
        // 4. RESOLVE MASTER DATA
        // --------------------------------------------------
        const [
            checkoutStatusResult,
            checkoutItemStatusResult,
            paymentStatusResult,
            checkedOutCartStatusResult,
            checkoutTypeResult,
        ] = await Promise.all([
            pool.query(`SELECT checkout_status_id FROM public.checkout_status WHERE code = 'INT' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT checkout_item_status_id FROM public.checkout_item_status WHERE code = 'VLD' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT payment_status_id FROM public.payment_statuses WHERE code = 'PEN' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT cart_item_status_id FROM public.cart_item_status WHERE code = 'CKO' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(
                `SELECT checkout_type_id
                 FROM public.checkout_type
                 WHERE checkout_type_uuid = $1
                   AND is_active          = TRUE
                   AND is_deleted         = FALSE`,
                [checkout_type_uuid.trim()]
            ),
        ]);

        if (
            checkoutStatusResult.rowCount === 0 ||
            checkoutItemStatusResult.rowCount === 0 ||
            paymentStatusResult.rowCount === 0 ||
            checkedOutCartStatusResult.rowCount === 0
        ) {
            logger.error("checkout-initiate-quote: missing master data — checkout_status(INT) / checkout_item_status(VLD) / payment_statuses(PEN) / cart_item_status(CKO)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        if (checkoutTypeResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `Invalid checkout_type_uuid: ${checkout_type_uuid}` });

        const initiated_status_id        = checkoutStatusResult.rows[0].checkout_status_id;
        const validated_item_status_id   = checkoutItemStatusResult.rows[0].checkout_item_status_id;
        const pending_payment_status_id  = paymentStatusResult.rows[0].payment_status_id;
        const checked_out_cart_status_id = checkedOutCartStatusResult.rows[0].cart_item_status_id;
        const checkout_type_id           = checkoutTypeResult.rows[0].checkout_type_id;

        // --------------------------------------------------
        // 5. FETCH ALL PND CART ITEMS UNDER THIS QUOTE
        //    Whole-quote, always — no partial selection input exists
        //    in this API's payload, so full-quote-coverage is
        //    structurally guaranteed rather than validated.
        //    unit_price/price/tax_amount/discount_amount/final_price
        //    are read as-is — locked at accept-buyer-quote, NOT
        //    recomputed from products here.
        // --------------------------------------------------
        const cartCheck = await pool.query(
            `SELECT
                cd.cart_item_id,
                cd.cart_item_uuid,
                cd.product_id,
                cd.seller_id,
                cd.warehouse_id,
                cd.warehouse_type_id,
                cd.product_name,
                cd.sku,
                cd.quantity,
                cd.uom_id,
                cd.quote_id,
                cd.quote_item_id,
                cd.quote_type_id,
                cd.unit_price,
                cd.tax_code,
                cd.tax_amount,
                cd.discount_amount,
                cd.final_price
             FROM public.cart_details cd
             JOIN public.cart_item_status cis
               ON cis.cart_item_status_id = cd.cart_item_status_id
             WHERE cd.buyer_id   = $1
               AND cd.quote_id   = $2
               AND cis.code      = 'PND'
               AND cd.is_deleted = FALSE
               AND cd.is_active  = TRUE`,
            [buyer_id, buyer_quote_id]
        );

        if (cartCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No checkout-eligible cart items found for this quote. It may already be checked out or its items were removed." });

        // --------------------------------------------------
        // 6. FETCH QUOTE-LOCKED SERVICE CHARGES
        // --------------------------------------------------
        const qscResult = await pool.query(
            `SELECT bqsc.service_charge_id, bqsc.charge_type, bqsc.charge_value, bqsc.charge_amount
             FROM public.buyer_quote_service_charges bqsc
             WHERE bqsc.buyer_quote_id = $1
               AND bqsc.is_active       = TRUE
               AND bqsc.is_deleted      = FALSE`,
            [buyer_quote_id]
        );

        // ====================================================
        // TRANSACTION START
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        // --------------------------------------------------
        // 7. GENERATE CHECKOUT NUMBER
        // --------------------------------------------------
        await client.query(`SELECT pg_advisory_xact_lock($1)`, [commonenum.CHECKOUT_SEQ_LOCK_KEY]);

        const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");

        const seqResult = await client.query(
            `SELECT COUNT(*) AS today_count
             FROM public.checkout_details
             WHERE DATE(created_at) = CURRENT_DATE`
        );

        const sequence = (Number(seqResult.rows[0].today_count) + 1).toString().padStart(4, "0");
        const checkout_number = `CHK-${datePart}-${sequence}`;

        // --------------------------------------------------
        // 8. PER-ITEM: RE-VALIDATE STOCK ONLY (no price recompute)
        // --------------------------------------------------
        let subtotal       = 0;
        let total_tax       = 0;
        let total_discount  = 0;
        const checkoutLines = [];

        for (const row of cartCheck.rows) {
            const requestedQty = Number(row.quantity);

            const invResult = await client.query({
                text: `SELECT si.inventory_id, si.onhand_qty, si.reserved_qty, si.buffer_qty
                       FROM public.seller_inventory si
                       WHERE si.product_id   = $1
                         AND si.seller_id    = $2
                         AND si.warehouse_id = $3
                         AND si.is_deleted   = FALSE
                         AND si.is_active    = TRUE`,
                values: [row.product_id, row.seller_id, row.warehouse_id],
            });

            if (invResult.rowCount === 0) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: `Inventory no longer available for quoted item ${row.cart_item_uuid}` });
            }

            const inv = invResult.rows[0];
            const inventoryAvailable = Number(inv.onhand_qty) - Number(inv.reserved_qty) - Number(inv.buffer_qty);

            const cartReservedResult = await client.query({
                text: `SELECT COALESCE(SUM(cd.reserved_quantity), 0) AS total_reserved
                       FROM public.cart_details cd
                       JOIN public.cart_item_status cis
                         ON cis.cart_item_status_id = cd.cart_item_status_id
                       WHERE cd.product_id    = $1
                         AND cd.seller_id     = $2
                         AND cd.warehouse_id  = $3
                         AND cd.cart_item_id != $4
                         AND cd.is_deleted    = FALSE
                         AND cis.code NOT IN ('REM', 'EXP')`,
                values: [row.product_id, row.seller_id, row.warehouse_id, row.cart_item_id],
            });

            // --------------------------------------------------
            // CHANGE: also subtract active LISTING-ORIGIN quote
            // soft-holds (buyer_quote_items, cart_item_id IS NULL,
            // quote still DRF/ACT) for this product/warehouse — same
            // reasoning as checkout-initiate.js / add-to-cart.js.
            // --------------------------------------------------
            const quoteReservedResult = await client.query({
                text: `SELECT COALESCE(SUM(bqi.quantity), 0) AS total_reserved
                       FROM public.buyer_quote_items bqi
                       JOIN public.buyer_saved_quote bsq
                         ON bsq.buyer_quote_id = bqi.buyer_quote_id
                       JOIN public.quote_statuses qs
                         ON qs.quote_status_id = bsq.status_of_quote
                       WHERE bqi.product_id     = $1
                         AND bqi.warehouse_id   = $2
                         AND bqi.cart_item_id  IS NULL
                         AND bqi.is_deleted     = FALSE
                         AND bqi.is_active      = TRUE
                         AND qs.code IN ('DRF', 'ACT')`,
                values: [row.product_id, row.warehouse_id],
            });

            const otherCartReserved  = Number(cartReservedResult.rows[0].total_reserved);
            const otherQuoteReserved = Number(quoteReservedResult.rows[0].total_reserved);
            const netAvailable       = inventoryAvailable - otherCartReserved - otherQuoteReserved;

            if (requestedQty > netAvailable) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, {
                    header_type:        "ERROR",
                    message_visibility: true,
                    status:             false,
                    code:               2007,
                    message:            "Insufficient stock",
                    error:              `Only ${Math.max(netAvailable, 0)} units are now available for ${row.product_name}`,
                });
            }

            // Locked at accept-buyer-quote — used verbatim.
            subtotal      += Number(row.unit_price) * requestedQty;
            total_tax      += Number(row.tax_amount);
            total_discount += Number(row.discount_amount);

            checkoutLines.push({
                cart_item_id:      row.cart_item_id,
                quote_id:          row.quote_id,
                quote_item_id:     row.quote_item_id,
                quote_type_id:     row.quote_type_id,
                product_id:        row.product_id,
                seller_id:         row.seller_id,
                warehouse_id:      row.warehouse_id,
                warehouse_type_id: row.warehouse_type_id,
                product_name:      row.product_name,
                sku:               row.sku,
                quantity:          requestedQty,
                unit_price:        Number(row.unit_price),
                tax_code:          row.tax_code,
                tax_amount:        Number(row.tax_amount),
                discount_amount:   Number(row.discount_amount),
                final_price:       Number(row.final_price),
            });
        }

        const reservation_expires_at = new Date(
            now.getTime() + commonenum.TIME_DURATION_MINUTES.CHECKOUT_RESERVATION_EXPIRY * 60 * 1000
        );

        // --------------------------------------------------
        // 9. INSERT checkout_details header
        // --------------------------------------------------
        const checkoutInsert = await client.query({
            text: `INSERT INTO public.checkout_details (
                        buyer_id, checkout_number, checkout_status_id, checkout_type_id,
                        subtotal, tax_amount, shipping_charge, discount_amount, grand_total,
                        payment_status_id, reservation_expires_at, notes,
                        assigned_to, assigned_at, created_by
                   ) VALUES (
                        $1, $2, $3, $4,
                        $5, $6, $7, $8, $9,
                        $10, $11, $12,
                        $13, $14, $15
                   )
                   RETURNING checkout_id, checkout_uuid`,
            values: [
                buyer_id, checkout_number, initiated_status_id, checkout_type_id,
                parseFloat(subtotal.toFixed(2)), parseFloat(total_tax.toFixed(2)),
                0, parseFloat(total_discount.toFixed(2)), 0,
                pending_payment_status_id, reservation_expires_at, notes?.trim() || null,
                assigned_to, assigned_at, created_by,
            ],
        });

        const { checkout_id, checkout_uuid } = checkoutInsert.rows[0];

        // --------------------------------------------------
        // 10. INSERT checkout_items + UPDATE source cart_details
        // --------------------------------------------------
        for (const line of checkoutLines) {
            await client.query({
                text: `INSERT INTO public.checkout_items (
                            checkout_id, cart_item_id, quote_id, quote_item_id, quote_type_id,
                            product_id, seller_id, warehouse_id, warehouse_type_id,
                            product_name, sku, quantity, unit_price, tax_code,
                            tax_amount, discount_amount, final_price, checkout_item_status_id,
                            assigned_to, assigned_at, created_by
                       ) VALUES (
                            $1, $2, $3, $4, $5,
                            $6, $7, $8, $9,
                            $10, $11, $12, $13, $14,
                            $15, $16, $17, $18,
                            $19, $20, $21
                       )`,
                values: [
                    checkout_id, line.cart_item_id, line.quote_id, line.quote_item_id, line.quote_type_id,
                    line.product_id, line.seller_id, line.warehouse_id, line.warehouse_type_id,
                    line.product_name, line.sku, line.quantity, line.unit_price, line.tax_code,
                    line.tax_amount, line.discount_amount, line.final_price, validated_item_status_id,
                    assigned_to, assigned_at, created_by,
                ],
            });

            await client.query({
                text: `UPDATE public.cart_details SET
                            cart_item_status_id    = $1,
                            reservation_expires_at = $2,
                            modified_at             = $3,
                            modified_by             = $4
                       WHERE cart_item_id = $5
                         AND is_deleted   = FALSE`,
                values: [checked_out_cart_status_id, reservation_expires_at, now, created_by, line.cart_item_id],
            });
        }

        // --------------------------------------------------
        // 11. INSERT checkout_service_charges — 1:1 copy from
        //     buyer_quote_service_charges, charge_amount used
        //     verbatim (already computed/locked at quote time).
        // --------------------------------------------------
        const appliedServiceCharges = [];

        for (const qsc of qscResult.rows) {
            const scInsert = await client.query({
                text: `INSERT INTO public.checkout_service_charges (
                            checkout_id, service_charge_id, charge_type, charge_value, charge_amount,
                            assigned_to, assigned_at, created_by
                       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                       RETURNING checkout_service_charge_id, checkout_service_charge_uuid`,
                values: [
                    checkout_id, qsc.service_charge_id, qsc.charge_type,
                    Number(qsc.charge_value), Number(qsc.charge_amount),
                    assigned_to, assigned_at, created_by,
                ],
            });

            appliedServiceCharges.push({
                checkout_service_charge_id:   scInsert.rows[0].checkout_service_charge_id,
                checkout_service_charge_uuid: scInsert.rows[0].checkout_service_charge_uuid,
                charge_type:                  qsc.charge_type,
                charge_value:                 Number(qsc.charge_value),
                charge_amount:                Number(qsc.charge_amount),
            });
        }

        const total_service_charge = parseFloat(
            appliedServiceCharges.reduce((sum, sc) => sum + sc.charge_amount, 0).toFixed(2)
        );

        // --------------------------------------------------
        // 12. QUOTE STATUS: ACC -> CNV (converted). Prevents this
        //     quote being initiated again or re-accepted while this
        //     checkout is alive.
        // --------------------------------------------------
        const convertedStatusResult = await client.query(
            `SELECT quote_status_id FROM public.quote_statuses WHERE code = 'CNV' AND is_active = TRUE AND is_deleted = FALSE`
        );

        if (convertedStatusResult.rowCount === 0) {
            await client.query("ROLLBACK");
            inTransaction = false;
            logger.error("checkout-initiate-quote: missing master data — quote_statuses(CNV)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        await client.query(
            `UPDATE public.buyer_saved_quote SET
                status_of_quote = $1,
                modified_at      = $2,
                modified_by      = $3
             WHERE buyer_quote_id = $4
               AND is_deleted     = FALSE`,
            [convertedStatusResult.rows[0].quote_status_id, now, created_by, buyer_quote_id]
        );

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 13. SUCCESS RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type:        "SUCCESS",
            message_visibility: true,
            status:             true,
            code:               1000,
            message:            "Checkout session initiated successfully from quote",
            data: {
                checkout_id, checkout_uuid, checkout_number,
                checkout_status_id: initiated_status_id,
                checkout_type_id,
                buyer_quote_id,
                buyer_quote_uuid,
                subtotal:          parseFloat(subtotal.toFixed(2)),
                tax_amount:        parseFloat(total_tax.toFixed(2)),
                discount_amount:   parseFloat(total_discount.toFixed(2)),
                shipping_charge:   0,
                grand_total:       0,
                payment_status_id: pending_payment_status_id,
                reservation_expires_at,
                item_count:        checkoutLines.length,
                items:             checkoutLines,
                service_charges:   appliedServiceCharges,
                total_service_charge,
                created_at:        now,
            },
        });

    } catch (err) {
        if (inTransaction) {
            await client.query("ROLLBACK");
        }
        logger.error("Responder Error (checkout-initiate-quote):", err);
        saveErrorLog({
            api_name:   "checkout-initiate-quote",
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
            message:            "Checkout initiation from quote failed",
            error:              err.message,
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// CREATE QUOTE FOR BUYER — FROM PRODUCT LISTING 
// --------------------------------------------------
// Distinct from create-buyer-quote.js:
//   - Input is product_id_uuid + warehouse_uuid + quantity + margin_per
//     directly (no pre-existing cart_item_uuid).
//   - customer_name/email/phone are resolved from the buyer's own
//     account — this is the self-service variant (see
//     create-buyer-quote-listing-customer.js for the explicit-contact
//     variant used when a rep quotes on behalf of someone else).
//   - STOCK VALIDATION + SOFT RESERVATION happen HERE, at request
//     time 
//   - "Soft reservation" here means: NO physical write to
//     seller_inventory (same as add-to-cart.js) — the reservation is
//     simply the EXISTENCE of this buyer_quote_items row, which is
//     subtracted from ATP by any other reservation-check query that
//     also scans buyer_quote_items (this query does — see step 8b).
//   - warehouse_id / warehouse_type_id are stored directly on
//     buyer_quote_items (new columns) — the buyer's warehouse choice
//     is locked in now, not re-resolved at accept time.
//   - reservation_expires_at is HEADER-level on buyer_saved_quote —
//     one shared expiry for every item on this quote, using
//     commonenum.TIME_DURATION_MINUTES.QUOTE_RESERVATION_EXPIRY (a
//     longer window than cart's RESERVATION_EXPIRY, since B2B quote
//     negotiation takes longer than an impulse cart hold).
//   - NO cart_details row created at this stage — buyer_quote_items
//     rows are inserted with cart_item_id = NULL. A real cart_details
//     row is only created later, at accept-buyer-quote-listing.js.
// --------------------------------------------------

responder.on("create-buyer-quote-listing-buyer", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const {
            buyer_uuid,
            car_brand_uuid,
            car_model_uuid,
            tax_code_uuid,
            quote_type_uuid,
            product_items,     // [{ product_id_uuid, warehouse_uuid, quantity, margin_per }]
            service_charges,   // [{ service_charge_uuid, charge_type, charge_value, charge_amount }]
            created_by,
        } = req.body;

        const now         = new Date();
        const assigned_to = created_by;
        const assigned_at = now;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        if (!tax_code_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "tax code uuid is required" });

        if (!Array.isArray(product_items) || product_items.length === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "product_items must be a non-empty array" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created by is required" });

        if (service_charges !== undefined && !Array.isArray(service_charges))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "service charges must be an array if provided" });

        for (const item of product_items) {
            if (!item.product_id_uuid?.trim())
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Each product item must have a valid product_id_uuid" });

            if (!item.warehouse_uuid?.trim())
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `warehouse_uuid is required for product ${item.product_id_uuid}` });

            if (item.quantity === undefined || item.quantity === null || isNaN(Number(item.quantity)) || Number(item.quantity) <= 0)
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `A positive quantity is required for product ${item.product_id_uuid}` });

            if (item.margin_per !== undefined && item.margin_per !== null && isNaN(Number(item.margin_per)))
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `margin percentage must be a valid number for product ${item.product_id_uuid}` });
        }

        // Duplicate product_id_uuid+warehouse_uuid pairs within the
        // same payload are rejected outright — same reasoning as
        // add-quote-items.js's within-payload duplicate guard.
        const pairKeys = product_items.map((i) => `${i.product_id_uuid.trim().toLowerCase()}::${i.warehouse_uuid.trim().toLowerCase()}`);
        if (new Set(pairKeys).size !== pairKeys.length)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "product_items contains duplicate product+warehouse combinations" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_id + contact info (self-service fallback)
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT ba.buyer_id, ba.business_name, ba.email_id,
                    ba.phone_country_code, ba.phone_number
             FROM public.buyer_accounts ba
             WHERE ba.buyer_uuid            = $1
               AND ba.is_active             = TRUE
               AND ba.is_deleted            = FALSE
               AND ba.phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });

        const buyer = buyerCheck.rows[0];
        const buyer_id = buyer.buyer_id;

        const customer_name  = buyer.business_name;
        const customer_email = buyer.email_id || null;
        const customer_phone = (buyer.phone_country_code && buyer.phone_number)
            ? `${buyer.phone_country_code}${buyer.phone_number}`
            : null;

        // --------------------------------------------------
        // 3. RESOLVE tax_code_id
        // --------------------------------------------------
        const taxCheck = await pool.query(
            `SELECT tax_code_id, tax_rate
             FROM public.tax_code_master
             WHERE tax_code_uuid = $1
               AND is_active     = TRUE
               AND is_deleted    = FALSE`,
            [tax_code_uuid.trim()]
        );

        if (taxCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Invalid or inactive tax code provided" });

        const tax_code_id = taxCheck.rows[0].tax_code_id;
        const tax_rate     = Number(taxCheck.rows[0].tax_rate);

        // --------------------------------------------------
        // 4. RESOLVE quote_type_id (optional, defaults to BSV)
        // --------------------------------------------------
        let quoteTypeResult;

        if (quote_type_uuid?.trim()) {
            quoteTypeResult = await pool.query(
                `SELECT quote_type_id FROM public.quote_type
                 WHERE quote_type_uuid = $1 AND is_active = TRUE AND is_deleted = FALSE`,
                [quote_type_uuid.trim()]
            );

            if (quoteTypeResult.rowCount === 0)
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Invalid or inactive quote type provided" });
        } else {
            quoteTypeResult = await pool.query(
                `SELECT quote_type_id FROM public.quote_type
                 WHERE code = 'BSV' AND is_active = TRUE AND is_deleted = FALSE`
            );

            if (quoteTypeResult.rowCount === 0) {
                logger.error("create-buyer-quote-listing-buyer: missing master data — quote_type(BSV)");
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Default quote type (BSV) not found" });
            }
        }

        const quote_type_id = quoteTypeResult.rows[0].quote_type_id;

        // --------------------------------------------------
        // 5. RESOLVE car_brand_id / car_model_id (optional)
        // --------------------------------------------------
        let car_brand_id = null;
        let car_model_id = null;

        if (car_brand_uuid?.trim()) {
            const brandCheck = await pool.query(
                `SELECT brand_id FROM public.brand WHERE brand_uuid = $1 AND is_active = TRUE AND is_deleted = FALSE`,
                [car_brand_uuid.trim()]
            );
            if (brandCheck.rowCount === 0)
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Invalid or inactive car brand provided" });
            car_brand_id = brandCheck.rows[0].brand_id;
        }

        if (car_model_uuid?.trim()) {
            const modelCheck = await pool.query(
                `SELECT model_id FROM public.model WHERE model_uuid = $1 AND is_active = TRUE AND is_deleted = FALSE`,
                [car_model_uuid.trim()]
            );
            if (modelCheck.rowCount === 0)
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Invalid or inactive car model provided" });
            car_model_id = modelCheck.rows[0].model_id;
        }

        // --------------------------------------------------
        // 6. RESOLVE MASTER DATA (warehouse_type, quote_status DRAFT)
        // --------------------------------------------------
        const [whTypeResult, draftStatusResult] = await Promise.all([
            pool.query(`SELECT warehouse_type_id FROM public.warehouse_type WHERE code = 'SLR' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT quote_status_id FROM public.quote_statuses WHERE UPPER(name) = 'DRAFT' AND is_active = TRUE AND is_deleted = FALSE LIMIT 1`),
        ]);

        if (whTypeResult.rowCount === 0 || draftStatusResult.rowCount === 0) {
            logger.error("create-buyer-quote-listing-buyer: missing master data — warehouse_type(SLR) or quote_statuses(DRAFT)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const warehouse_type_id = whTypeResult.rows[0].warehouse_type_id;
        const draft_status_id   = draftStatusResult.rows[0].quote_status_id;

        // --------------------------------------------------
        // 7. RESOLVE PRODUCT + WAREHOUSE + INVENTORY PER ITEM
        //    Combined product/warehouse/inventory resolution, same
        //    join shape as add-to-cart.js — one query per item since
        //    each item can target a different warehouse.
        // --------------------------------------------------
        const resolvedItems = [];

        for (const item of product_items) {
            const resolveResult = await pool.query({
                text: `SELECT
                           p.product_id, p.seller_id, p.uom_id,
                           p.name AS product_name, p.sku, p.oem_part_number AS oem_number,
                           p.price AS mrp, p.price_after_sale AS sale_price,
                           p.is_active, p.is_deleted, p.is_listed, p.verify_status,
                           sw.warehouse_id, sw.warehouse_uuid,
                           si.inventory_id
                       FROM public.products p
                       JOIN public.seller_inventory si
                          ON si.product_id   = p.product_id
                         AND si.seller_id    = p.seller_id
                         AND si.is_deleted   = FALSE
                         AND si.is_active    = TRUE
                       JOIN public.seller_warehouse sw
                          ON sw.warehouse_id   = si.warehouse_id
                         AND sw.warehouse_uuid = $2
                         AND sw.is_deleted     = FALSE
                         AND sw.is_active      = TRUE
                       WHERE p.product_uuid = $1
                         AND p.is_deleted   = FALSE
                         AND p.is_active    = TRUE`,
                values: [item.product_id_uuid.trim(), item.warehouse_uuid.trim()],
            });

            if (resolveResult.rowCount === 0)
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2003, message: "Record not found",
                    error: `Product ${item.product_id_uuid} is not available in the selected warehouse ${item.warehouse_uuid}`,
                });

            const row = resolveResult.rows[0];

            if (!row.is_active || row.is_deleted || !row.is_listed || row.verify_status !== "APPROVED")
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2008, message: "Action not allowed",
                    error: `Product ${item.product_id_uuid} is not currently available for quoting`,
                });

            resolvedItems.push({
                product_id:        row.product_id,
                seller_id:         row.seller_id,
                uom_id:            row.uom_id,
                product_name:      row.product_name,
                sku:               row.sku,
                oem_number:        row.oem_number,
                mrp:               Number(row.mrp),
                sale_price:        Number(row.sale_price),
                warehouse_id:      row.warehouse_id,
                inventory_id:      row.inventory_id,
                quantity:          Number(item.quantity),
                margin_per:        Number(item.margin_per ?? 0),
            });
        }

        // --------------------------------------------------
        // 8. RESOLVE reservation window
        // --------------------------------------------------
        const reservation_expires_at = new Date(
            now.getTime() + commonenum.TIME_DURATION_MINUTES.QUOTE_RESERVATION_EXPIRY * 60 * 1000
        );

        // ====================================================
        // TRANSACTION START — everything from here on must be
        // serialized against concurrent requests for the SAME
        // product+seller+warehouse, to avoid overselling.
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        let subtotal  = 0;
        let total_tax = 0;

        const quoteLineItems = [];

        for (const item of resolvedItems) {
            // --------------------------------------------------
            // 8a. LOCK the seller_inventory row FIRST — same pattern
            //     as add-to-cart.js. A second concurrent request for
            //     the same inventory_id blocks here until this
            //     transaction COMMITs/ROLLBACKs.
            // --------------------------------------------------
            const lockedInventory = await client.query({
                text: `SELECT onhand_qty, reserved_qty, buffer_qty
                       FROM public.seller_inventory
                       WHERE inventory_id = $1
                       FOR UPDATE`,
                values: [item.inventory_id],
            });

            if (lockedInventory.rowCount === 0) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2003, message: "Record not found",
                    error: `Inventory record no longer exists for ${item.product_name}`,
                });
            }

            const { onhand_qty: lockedOnhand, reserved_qty: lockedReserved, buffer_qty: lockedBuffer } = lockedInventory.rows[0];
            const inventoryAvailable = Number(lockedOnhand) - Number(lockedReserved) - Number(lockedBuffer);

            // --------------------------------------------------
            // 8b. SUBTRACT EXISTING ACTIVE HOLDS — both cart_details
            //     (all buyers, any active status) AND buyer_quote_items
            //     (all buyers, only quotes still open for negotiation —
            //     DRF/ACT — with cart_item_id IS NULL, i.e. not yet
            //     converted into a real cart row). This is what makes
            //     this API's own reservation self-consistent; it does
            //     NOT protect against add-to-cart.js / checkout-
            //     initiate.js, which don't scan buyer_quote_items yet.
            // --------------------------------------------------
            const cartReservedResult = await client.query({
                text: `SELECT COALESCE(SUM(cd.reserved_quantity), 0) AS total_reserved
                       FROM public.cart_details cd
                       JOIN public.cart_item_status cis
                         ON cis.cart_item_status_id = cd.cart_item_status_id
                       WHERE cd.product_id   = $1
                         AND cd.seller_id    = $2
                         AND cd.warehouse_id = $3
                         AND cd.is_deleted   = FALSE
                         AND cis.code NOT IN ('REM', 'EXP')`,
                values: [item.product_id, item.seller_id, item.warehouse_id],
            });

            const quoteReservedResult = await client.query({
                text: `SELECT COALESCE(SUM(bqi.quantity), 0) AS total_reserved
                       FROM public.buyer_quote_items bqi
                       JOIN public.buyer_saved_quote bsq
                         ON bsq.buyer_quote_id = bqi.buyer_quote_id
                       JOIN public.quote_statuses qs
                         ON qs.quote_status_id = bsq.status_of_quote
                       WHERE bqi.product_id     = $1
                         AND bqi.warehouse_id   = $2
                         AND bsq.buyer_id      != $3
                         AND bqi.cart_item_id  IS NULL
                         AND bqi.is_deleted     = FALSE
                         AND bqi.is_active      = TRUE
                         AND qs.code IN ('DRF', 'ACT')`,
                values: [item.product_id, item.warehouse_id, buyer_id],
            });

            const existingCartReserved  = Number(cartReservedResult.rows[0].total_reserved);
            const existingQuoteReserved = Number(quoteReservedResult.rows[0].total_reserved);
            const netAvailable          = inventoryAvailable - existingCartReserved - existingQuoteReserved;

            if (item.quantity > netAvailable) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2007, message: "Insufficient stock",
                    error: `Only ${Math.max(netAvailable, 0)} unit(s) available for ${item.product_name} at the selected warehouse`,
                });
            }

            // --------------------------------------------------
            // 8c. DUPLICATE CHECK — same buyer, same product+seller+
            //     warehouse, already held either as an active cart
            //     item or as a listing-origin line on another open
            //     quote. Blocks self-inflated double reservation.
            // --------------------------------------------------
            const duplicateCartCheck = await client.query({
                text: `SELECT cd.cart_item_uuid
                       FROM public.cart_details cd
                       JOIN public.cart_item_status cis
                         ON cis.cart_item_status_id = cd.cart_item_status_id
                       WHERE cd.buyer_id     = $1
                         AND cd.product_id   = $2
                         AND cd.seller_id    = $3
                         AND cd.warehouse_id = $4
                         AND cis.code       != 'REM'
                         AND cd.is_deleted   = FALSE`,
                values: [buyer_id, item.product_id, item.seller_id, item.warehouse_id],
            });

            if (duplicateCartCheck.rowCount > 0) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2002, message: "Item already in cart",
                    error: `${item.product_name} is already in your cart at this warehouse. Use the cart to adjust quantity instead of requesting a new quote for it.`,
                });
            }

            const duplicateQuoteCheck = await client.query({
                text: `SELECT bqi.buyer_quote_item_uuid
                       FROM public.buyer_quote_items bqi
                       JOIN public.buyer_saved_quote bsq
                         ON bsq.buyer_quote_id = bqi.buyer_quote_id
                       JOIN public.quote_statuses qs
                         ON qs.quote_status_id = bsq.status_of_quote
                       WHERE bsq.buyer_id      = $1
                         AND bqi.product_id    = $2
                         AND bqi.warehouse_id  = $3
                         AND bqi.cart_item_id  IS NULL
                         AND bqi.is_deleted     = FALSE
                         AND bqi.is_active      = TRUE
                         AND qs.code IN ('DRF', 'ACT')`,
                values: [buyer_id, item.product_id, item.warehouse_id],
            });

            if (duplicateQuoteCheck.rowCount > 0) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2002, message: "Item already quoted",
                    error: `${item.product_name} at this warehouse is already on another open quote request of yours.`,
                });
            }

            // --------------------------------------------------
            // 8d. COMPUTE PRICE / MARGIN / TAX
            // --------------------------------------------------
            const price_with_margin = parseFloat((item.sale_price + (item.sale_price * item.margin_per / 100)).toFixed(2));
            const line_total        = parseFloat((price_with_margin * item.quantity).toFixed(2));
            const tax_amount        = parseFloat((line_total * tax_rate / 100).toFixed(2));

            subtotal  += line_total;
            total_tax += tax_amount;

            quoteLineItems.push({
                product_id:        item.product_id,
                warehouse_id:      item.warehouse_id,
                warehouse_type_id,
                service_item:      "Product",
                quantity:          item.quantity,
                uom_id:            item.uom_id || null,
                price:             item.sale_price,
                margin_per:        item.margin_per,
                price_with_margin,
                tax_code_id,
                tax_amount,
            });
        }

        // --------------------------------------------------
        // 9. RESOLVE + COMPUTE SERVICE CHARGES (non-taxable)
        // --------------------------------------------------
        let chargeLineItems      = [];
        let total_charges_amount = 0;

        try {
            const chargeResult = await resolveServiceCharges(pool, service_charges, subtotal);
            chargeLineItems      = chargeResult.chargeLineItems;
            total_charges_amount = chargeResult.total_charges_amount;
        } catch (e) {
            await client.query("ROLLBACK");
            inTransaction = false;
            if (e.validationError) return cb(null, e.validationError);
            throw e;
        }

        const total_price = parseFloat((subtotal + total_tax + total_charges_amount).toFixed(2));

        // --------------------------------------------------
        // 10. COMPUTE HEADER-LEVEL AGGREGATES
        // --------------------------------------------------
        const total_quantity          = quoteLineItems.reduce((s, i) => s + i.quantity, 0);
        const total_price_sum         = parseFloat(quoteLineItems.reduce((s, i) => s + i.price, 0).toFixed(2));
        const avg_margin_per          = parseFloat((quoteLineItems.reduce((s, i) => s + i.margin_per, 0) / quoteLineItems.length).toFixed(2));
        const total_price_with_margin = parseFloat(quoteLineItems.reduce((s, i) => s + (i.price_with_margin * i.quantity), 0).toFixed(2));

        // --------------------------------------------------
        // 11. GENERATE QUOTE NUMBER
        // --------------------------------------------------
        await client.query(`SELECT pg_advisory_xact_lock($1)`, [commonenum.QUOTE_SEQ_LOCK_KEY]);

        const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");

        const seqResult = await client.query(
            `SELECT COUNT(*) AS today_count FROM public.buyer_saved_quote WHERE DATE(created_at) = CURRENT_DATE`
        );
        const sequence = (Number(seqResult.rows[0].today_count) + 1).toString().padStart(4, "0");
        const quote_no = `QT-${datePart}-${sequence}`;

        // --------------------------------------------------
        // 12. INSERT buyer_saved_quote header
        //     reservation_expires_at set here — shared across all
        //     items on this quote.
        // --------------------------------------------------
        const quoteInsert = await client.query(
            `INSERT INTO public.buyer_saved_quote (
                buyer_id, quote_no, quote_type_id, tax_code_id, status_of_quote,
                quantity, price, margin_per, price_with_margin, total_price,
                customer_name, customer_email, customer_phone, customer_address,
                car_brand_id, car_model_id, reservation_expires_at,
                is_active, assigned_to, assigned_at, created_at, created_by
             ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10,
                $11, $12, $13, $14,
                $15, $16, $17,
                TRUE, $18, $19, $20, $21
             )
             RETURNING buyer_quote_id, buyer_quote_uuid`,
            [
                buyer_id, quote_no, quote_type_id, tax_code_id, draft_status_id,
                total_quantity, total_price_sum, avg_margin_per, total_price_with_margin, total_price,
                customer_name, customer_email, customer_phone, null,
                car_brand_id, car_model_id, reservation_expires_at,
                assigned_to, assigned_at, now, created_by,
            ]
        );

        const buyer_quote_id   = quoteInsert.rows[0].buyer_quote_id;
        const buyer_quote_uuid = quoteInsert.rows[0].buyer_quote_uuid;

        // --------------------------------------------------
        // 13. INSERT product line items — cart_item_id LEFT NULL.
        //     warehouse_id / warehouse_type_id stored here (buyer's
        //     choice at request time), honored verbatim at accept time.
        // --------------------------------------------------
        for (const line of quoteLineItems) {
            await client.query(
                `INSERT INTO public.buyer_quote_items (
                    buyer_quote_id, product_id, warehouse_id, warehouse_type_id, service_item,
                    quantity, uom_id, price, margin_per, price_with_margin,
                    tax_code_id, tax_amount, cart_item_id,
                    is_active, assigned_to, assigned_at, created_at, created_by
                 ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8, $9, $10,
                    $11, $12, NULL,
                    TRUE, $13, $14, $15, $16
                 )`,
                [
                    buyer_quote_id, line.product_id, line.warehouse_id, line.warehouse_type_id, line.service_item,
                    line.quantity, line.uom_id, line.price, line.margin_per, line.price_with_margin,
                    line.tax_code_id, line.tax_amount,
                    assigned_to, assigned_at, now, created_by,
                ]
            );
        }

        // --------------------------------------------------
        // 14. INSERT service charges
        // --------------------------------------------------
        for (const charge of chargeLineItems) {
            await client.query(
                `INSERT INTO public.buyer_quote_service_charges (
                    buyer_quote_id, service_charge_id, charge_type, charge_value, charge_amount,
                    is_active, assigned_to, assigned_at, created_at, created_by
                 ) VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, $6)`,
                [buyer_quote_id, charge.service_charge_id, charge.charge_type, charge.charge_value, charge.charge_amount, created_by, now, now]
            );
        }

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 15. RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Quote created successfully from product listing",
            data: {
                buyer_quote_id,
                buyer_quote_uuid,
                quote_no,
                quote_type_id,
                total_price,
                item_count:              quoteLineItems.length,
                charge_count:            chargeLineItems.length,
                charges_total:           total_charges_amount,
                reservation_expires_at,
                created_at:              now,
            },
        });

    } catch (err) {
        if (inTransaction) await client.query("ROLLBACK");
        logger.error("Responder Error (create-buyer-quote-listing-buyer):", err);
        saveErrorLog({
            api_name: "create-buyer-quote-listing-buyer", method: "RESPONDER", payload: req,
            message: "Internal server error", stack: err.stack, error_code: 2004,
        });
        return cb(null, {
            header_type: "ERROR", message_visibility: true, status: false,
            code: 2004, message: "Create quote from listing failed", error: err.message,
        });
    } finally {
        client.release();
    }
});


// --------------------------------------------------
// CREATE QUOTE FOR CUSTOMER BY BUYER — FROM PRODUCT LISTING
// --------------------------------------------------

// Distinct from create-buyer-quote-listing-buyer.js:
//   - customer_name/email/phone/address come directly from the
//     payload — a rep can quote on behalf of a customer different
//     from the logged-in buyer account, same pattern as
//     create-buyer-quote.js.
//   - Everything else (stock validation, soft reservation, warehouse
//     locking, duplicate checks, service charges) is IDENTICAL to
//     create-buyer-quote-listing-buyer.js — see that file's header
//     comment for the full reasoning.
// --------------------------------------------------

responder.on("create-buyer-quote-listing-customer", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const {
            buyer_uuid,
            customer_name,
            customer_email,
            customer_phone,
            customer_address,
            car_brand_uuid,
            car_model_uuid,
            tax_code_uuid,
            quote_type_uuid,
            product_items,     // [{ product_id_uuid, warehouse_uuid, quantity, margin_per }]
            service_charges,   // [{ service_charge_uuid, charge_type, charge_value, charge_amount }]
            created_by,
        } = req.body;

        const now         = new Date();
        const assigned_to = created_by;
        const assigned_at = now;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        if (!customer_name?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "customer name is required" });

        if (!tax_code_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "tax code uuid is required" });

        if (!Array.isArray(product_items) || product_items.length === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "product_items must be a non-empty array" });

        if (!created_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "created by is required" });

        if (service_charges !== undefined && !Array.isArray(service_charges))
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "service charges must be an array if provided" });

        for (const item of product_items) {
            if (!item.product_id_uuid?.trim())
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "Each product item must have a valid product_id_uuid" });

            if (!item.warehouse_uuid?.trim())
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `warehouse_uuid is required for product ${item.product_id_uuid}` });

            if (item.quantity === undefined || item.quantity === null || isNaN(Number(item.quantity)) || Number(item.quantity) <= 0)
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `A positive quantity is required for product ${item.product_id_uuid}` });

            if (item.margin_per !== undefined && item.margin_per !== null && isNaN(Number(item.margin_per)))
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: `margin percentage must be a valid number for product ${item.product_id_uuid}` });
        }

        // Duplicate product_id_uuid+warehouse_uuid pairs within the
        // same payload are rejected outright — same reasoning as
        // add-quote-items.js's within-payload duplicate guard.
        const pairKeys = product_items.map((i) => `${i.product_id_uuid.trim().toLowerCase()}::${i.warehouse_uuid.trim().toLowerCase()}`);
        if (new Set(pairKeys).size !== pairKeys.length)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "product_items contains duplicate product+warehouse combinations" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active verified buyer found with the provided UUID" });

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // --------------------------------------------------
        // 3. RESOLVE tax_code_id
        // --------------------------------------------------
        const taxCheck = await pool.query(
            `SELECT tax_code_id, tax_rate
             FROM public.tax_code_master
             WHERE tax_code_uuid = $1
               AND is_active     = TRUE
               AND is_deleted    = FALSE`,
            [tax_code_uuid.trim()]
        );

        if (taxCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Invalid or inactive tax code provided" });

        const tax_code_id = taxCheck.rows[0].tax_code_id;
        const tax_rate     = Number(taxCheck.rows[0].tax_rate);

        // --------------------------------------------------
        // 4. RESOLVE quote_type_id (optional, defaults to BSV)
        // --------------------------------------------------
        let quoteTypeResult;

        if (quote_type_uuid?.trim()) {
            quoteTypeResult = await pool.query(
                `SELECT quote_type_id FROM public.quote_type
                 WHERE quote_type_uuid = $1 AND is_active = TRUE AND is_deleted = FALSE`,
                [quote_type_uuid.trim()]
            );

            if (quoteTypeResult.rowCount === 0)
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Invalid or inactive quote type provided" });
        } else {
            quoteTypeResult = await pool.query(
                `SELECT quote_type_id FROM public.quote_type
                 WHERE code = 'BSV' AND is_active = TRUE AND is_deleted = FALSE`
            );

            if (quoteTypeResult.rowCount === 0) {
                logger.error("create-buyer-quote-listing-customer: missing master data — quote_type(BSV)");
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Default quote type (BSV) not found" });
            }
        }

        const quote_type_id = quoteTypeResult.rows[0].quote_type_id;

        // --------------------------------------------------
        // 5. RESOLVE car_brand_id / car_model_id (optional)
        // --------------------------------------------------
        let car_brand_id = null;
        let car_model_id = null;

        if (car_brand_uuid?.trim()) {
            const brandCheck = await pool.query(
                `SELECT brand_id FROM public.brand WHERE brand_uuid = $1 AND is_active = TRUE AND is_deleted = FALSE`,
                [car_brand_uuid.trim()]
            );
            if (brandCheck.rowCount === 0)
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Invalid or inactive car brand provided" });
            car_brand_id = brandCheck.rows[0].brand_id;
        }

        if (car_model_uuid?.trim()) {
            const modelCheck = await pool.query(
                `SELECT model_id FROM public.model WHERE model_uuid = $1 AND is_active = TRUE AND is_deleted = FALSE`,
                [car_model_uuid.trim()]
            );
            if (modelCheck.rowCount === 0)
                return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "Invalid or inactive car model provided" });
            car_model_id = modelCheck.rows[0].model_id;
        }

        // --------------------------------------------------
        // 6. RESOLVE MASTER DATA (warehouse_type, quote_status DRAFT)
        // --------------------------------------------------
        const [whTypeResult, draftStatusResult] = await Promise.all([
            pool.query(`SELECT warehouse_type_id FROM public.warehouse_type WHERE code = 'SLR' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT quote_status_id FROM public.quote_statuses WHERE UPPER(name) = 'DRAFT' AND is_active = TRUE AND is_deleted = FALSE LIMIT 1`),
        ]);

        if (whTypeResult.rowCount === 0 || draftStatusResult.rowCount === 0) {
            logger.error("create-buyer-quote-listing-customer: missing master data — warehouse_type(SLR) or quote_statuses(DRAFT)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const warehouse_type_id = whTypeResult.rows[0].warehouse_type_id;
        const draft_status_id   = draftStatusResult.rows[0].quote_status_id;

        // --------------------------------------------------
        // 7. RESOLVE PRODUCT + WAREHOUSE + INVENTORY PER ITEM
        // --------------------------------------------------
        const resolvedItems = [];

        for (const item of product_items) {
            const resolveResult = await pool.query({
                text: `SELECT
                           p.product_id, p.seller_id, p.uom_id,
                           p.name AS product_name, p.sku, p.oem_part_number AS oem_number,
                           p.price AS mrp, p.price_after_sale AS sale_price,
                           p.is_active, p.is_deleted, p.is_listed, p.verify_status,
                           sw.warehouse_id, sw.warehouse_uuid,
                           si.inventory_id
                       FROM public.products p
                       JOIN public.seller_inventory si
                          ON si.product_id   = p.product_id
                         AND si.seller_id    = p.seller_id
                         AND si.is_deleted   = FALSE
                         AND si.is_active    = TRUE
                       JOIN public.seller_warehouse sw
                          ON sw.warehouse_id   = si.warehouse_id
                         AND sw.warehouse_uuid = $2
                         AND sw.is_deleted     = FALSE
                         AND sw.is_active      = TRUE
                       WHERE p.product_uuid = $1
                         AND p.is_deleted   = FALSE
                         AND p.is_active    = TRUE`,
                values: [item.product_id_uuid.trim(), item.warehouse_uuid.trim()],
            });

            if (resolveResult.rowCount === 0)
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2003, message: "Record not found",
                    error: `Product ${item.product_id_uuid} is not available in the selected warehouse ${item.warehouse_uuid}`,
                });

            const row = resolveResult.rows[0];

            if (!row.is_active || row.is_deleted || !row.is_listed || row.verify_status !== "APPROVED")
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2008, message: "Action not allowed",
                    error: `Product ${item.product_id_uuid} is not currently available for quoting`,
                });

            resolvedItems.push({
                product_id:        row.product_id,
                seller_id:         row.seller_id,
                uom_id:            row.uom_id,
                product_name:      row.product_name,
                sku:               row.sku,
                oem_number:        row.oem_number,
                mrp:               Number(row.mrp),
                sale_price:        Number(row.sale_price),
                warehouse_id:      row.warehouse_id,
                inventory_id:      row.inventory_id,
                quantity:          Number(item.quantity),
                margin_per:        Number(item.margin_per ?? 0),
            });
        }

        // --------------------------------------------------
        // 8. RESOLVE reservation window
        // --------------------------------------------------
        const reservation_expires_at = new Date(
            now.getTime() + commonenum.TIME_DURATION_MINUTES.QUOTE_RESERVATION_EXPIRY * 60 * 1000
        );

        // ====================================================
        // TRANSACTION START — everything from here on must be
        // serialized against concurrent requests for the SAME
        // product+seller+warehouse, to avoid overselling.
        // ====================================================
        await client.query("BEGIN");
        inTransaction = true;

        let subtotal  = 0;
        let total_tax = 0;

        const quoteLineItems = [];

        for (const item of resolvedItems) {
            // --------------------------------------------------
            // 8a. LOCK the seller_inventory row FIRST — same pattern
            //     as add-to-cart.js.
            // --------------------------------------------------
            const lockedInventory = await client.query({
                text: `SELECT onhand_qty, reserved_qty, buffer_qty
                       FROM public.seller_inventory
                       WHERE inventory_id = $1
                       FOR UPDATE`,
                values: [item.inventory_id],
            });

            if (lockedInventory.rowCount === 0) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2003, message: "Record not found",
                    error: `Inventory record no longer exists for ${item.product_name}`,
                });
            }

            const { onhand_qty: lockedOnhand, reserved_qty: lockedReserved, buffer_qty: lockedBuffer } = lockedInventory.rows[0];
            const inventoryAvailable = Number(lockedOnhand) - Number(lockedReserved) - Number(lockedBuffer);

            // --------------------------------------------------
            // 8b. SUBTRACT EXISTING ACTIVE HOLDS — both cart_details
            //     (all buyers) AND buyer_quote_items (all buyers,
            //     only open DRF/ACT quotes, listing-origin i.e.
            //     cart_item_id IS NULL). Same pattern used across
            //     add-to-cart.js / checkout-initiate.js /
            //     checkout-initiate-quote.js / reorder-buyer-order.js.
            // --------------------------------------------------
            const cartReservedResult = await client.query({
                text: `SELECT COALESCE(SUM(cd.reserved_quantity), 0) AS total_reserved
                       FROM public.cart_details cd
                       JOIN public.cart_item_status cis
                         ON cis.cart_item_status_id = cd.cart_item_status_id
                       WHERE cd.product_id   = $1
                         AND cd.seller_id    = $2
                         AND cd.warehouse_id = $3
                         AND cd.is_deleted   = FALSE
                         AND cis.code NOT IN ('REM', 'EXP')`,
                values: [item.product_id, item.seller_id, item.warehouse_id],
            });

            const quoteReservedResult = await client.query({
                text: `SELECT COALESCE(SUM(bqi.quantity), 0) AS total_reserved
                       FROM public.buyer_quote_items bqi
                       JOIN public.buyer_saved_quote bsq
                         ON bsq.buyer_quote_id = bqi.buyer_quote_id
                       JOIN public.quote_statuses qs
                         ON qs.quote_status_id = bsq.status_of_quote
                       WHERE bqi.product_id     = $1
                         AND bqi.warehouse_id   = $2
                         AND bqi.cart_item_id  IS NULL
                         AND bqi.is_deleted     = FALSE
                         AND bqi.is_active      = TRUE
                         AND qs.code IN ('DRF', 'ACT')`,
                values: [item.product_id, item.warehouse_id],
            });

            const existingCartReserved  = Number(cartReservedResult.rows[0].total_reserved);
            const existingQuoteReserved = Number(quoteReservedResult.rows[0].total_reserved);
            const netAvailable          = inventoryAvailable - existingCartReserved - existingQuoteReserved;

            if (item.quantity > netAvailable) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2007, message: "Insufficient stock",
                    error: `Only ${Math.max(netAvailable, 0)} unit(s) available for ${item.product_name} at the selected warehouse`,
                });
            }

            // --------------------------------------------------
            // 8c. DUPLICATE CHECK — same buyer, same product+seller+
            //     warehouse, already held as an active cart item or
            //     as a listing-origin line on another open quote.
            // --------------------------------------------------
            const duplicateCartCheck = await client.query({
                text: `SELECT cd.cart_item_uuid
                       FROM public.cart_details cd
                       JOIN public.cart_item_status cis
                         ON cis.cart_item_status_id = cd.cart_item_status_id
                       WHERE cd.buyer_id     = $1
                         AND cd.product_id   = $2
                         AND cd.seller_id    = $3
                         AND cd.warehouse_id = $4
                         AND cis.code       != 'REM'
                         AND cd.is_deleted   = FALSE`,
                values: [buyer_id, item.product_id, item.seller_id, item.warehouse_id],
            });

            if (duplicateCartCheck.rowCount > 0) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2002, message: "Item already in cart",
                    error: `${item.product_name} is already in your cart at this warehouse.`,
                });
            }

            const duplicateQuoteCheck = await client.query({
                text: `SELECT bqi.buyer_quote_item_uuid
                       FROM public.buyer_quote_items bqi
                       JOIN public.buyer_saved_quote bsq
                         ON bsq.buyer_quote_id = bqi.buyer_quote_id
                       JOIN public.quote_statuses qs
                         ON qs.quote_status_id = bsq.status_of_quote
                       WHERE bsq.buyer_id      = $1
                         AND bqi.product_id    = $2
                         AND bqi.warehouse_id  = $3
                         AND bqi.cart_item_id  IS NULL
                         AND bqi.is_deleted     = FALSE
                         AND bqi.is_active      = TRUE
                         AND qs.code IN ('DRF', 'ACT')`,
                values: [buyer_id, item.product_id, item.warehouse_id],
            });

            if (duplicateQuoteCheck.rowCount > 0) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2002, message: "Item already quoted",
                    error: `${item.product_name} at this warehouse is already on another open quote request of yours.`,
                });
            }

            // --------------------------------------------------
            // 8d. COMPUTE PRICE / MARGIN / TAX
            // --------------------------------------------------
            const price_with_margin = parseFloat((item.sale_price + (item.sale_price * item.margin_per / 100)).toFixed(2));
            const line_total        = parseFloat((price_with_margin * item.quantity).toFixed(2));
            const tax_amount        = parseFloat((line_total * tax_rate / 100).toFixed(2));

            subtotal  += line_total;
            total_tax += tax_amount;

            quoteLineItems.push({
                product_id:        item.product_id,
                warehouse_id:      item.warehouse_id,
                warehouse_type_id,
                service_item:      "Product",
                quantity:          item.quantity,
                uom_id:            item.uom_id || null,
                price:             item.sale_price,
                margin_per:        item.margin_per,
                price_with_margin,
                tax_code_id,
                tax_amount,
            });
        }

        // --------------------------------------------------
        // 9. RESOLVE + COMPUTE SERVICE CHARGES (non-taxable)
        // --------------------------------------------------
        let chargeLineItems      = [];
        let total_charges_amount = 0;

        try {
            const chargeResult = await resolveServiceCharges(pool, service_charges, subtotal);
            chargeLineItems      = chargeResult.chargeLineItems;
            total_charges_amount = chargeResult.total_charges_amount;
        } catch (e) {
            await client.query("ROLLBACK");
            inTransaction = false;
            if (e.validationError) return cb(null, e.validationError);
            throw e;
        }

        const total_price = parseFloat((subtotal + total_tax + total_charges_amount).toFixed(2));

        // --------------------------------------------------
        // 10. COMPUTE HEADER-LEVEL AGGREGATES
        // --------------------------------------------------
        const total_quantity          = quoteLineItems.reduce((s, i) => s + i.quantity, 0);
        const total_price_sum         = parseFloat(quoteLineItems.reduce((s, i) => s + i.price, 0).toFixed(2));
        const avg_margin_per          = parseFloat((quoteLineItems.reduce((s, i) => s + i.margin_per, 0) / quoteLineItems.length).toFixed(2));
        const total_price_with_margin = parseFloat(quoteLineItems.reduce((s, i) => s + (i.price_with_margin * i.quantity), 0).toFixed(2));

        // --------------------------------------------------
        // 11. GENERATE QUOTE NUMBER
        // --------------------------------------------------
        await client.query(`SELECT pg_advisory_xact_lock($1)`, [commonenum.QUOTE_SEQ_LOCK_KEY]);

        const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");

        const seqResult = await client.query(
            `SELECT COUNT(*) AS today_count FROM public.buyer_saved_quote WHERE DATE(created_at) = CURRENT_DATE`
        );
        const sequence = (Number(seqResult.rows[0].today_count) + 1).toString().padStart(4, "0");
        const quote_no = `QT-${datePart}-${sequence}`;

        // --------------------------------------------------
        // 12. INSERT buyer_saved_quote header
        //     customer_name/email/phone/address taken directly from
        //     the payload (explicit-contact variant).
        // --------------------------------------------------
        const quoteInsert = await client.query(
            `INSERT INTO public.buyer_saved_quote (
                buyer_id, quote_no, quote_type_id, tax_code_id, status_of_quote,
                quantity, price, margin_per, price_with_margin, total_price,
                customer_name, customer_email, customer_phone, customer_address,
                car_brand_id, car_model_id, reservation_expires_at,
                is_active, assigned_to, assigned_at, created_at, created_by
             ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10,
                $11, $12, $13, $14,
                $15, $16, $17,
                TRUE, $18, $19, $20, $21
             )
             RETURNING buyer_quote_id, buyer_quote_uuid`,
            [
                buyer_id, quote_no, quote_type_id, tax_code_id, draft_status_id,
                total_quantity, total_price_sum, avg_margin_per, total_price_with_margin, total_price,
                customer_name.trim(),
                customer_email?.trim()   || null,
                customer_phone?.trim()   || null,
                customer_address?.trim() || null,
                car_brand_id, car_model_id, reservation_expires_at,
                assigned_to, assigned_at, now, created_by,
            ]
        );

        const buyer_quote_id   = quoteInsert.rows[0].buyer_quote_id;
        const buyer_quote_uuid = quoteInsert.rows[0].buyer_quote_uuid;

        // --------------------------------------------------
        // 13. INSERT product line items — cart_item_id LEFT NULL.
        //     warehouse_id / warehouse_type_id stored here.
        // --------------------------------------------------
        for (const line of quoteLineItems) {
            await client.query(
                `INSERT INTO public.buyer_quote_items (
                    buyer_quote_id, product_id, warehouse_id, warehouse_type_id, service_item,
                    quantity, uom_id, price, margin_per, price_with_margin,
                    tax_code_id, tax_amount, cart_item_id,
                    is_active, assigned_to, assigned_at, created_at, created_by
                 ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8, $9, $10,
                    $11, $12, NULL,
                    TRUE, $13, $14, $15, $16
                 )`,
                [
                    buyer_quote_id, line.product_id, line.warehouse_id, line.warehouse_type_id, line.service_item,
                    line.quantity, line.uom_id, line.price, line.margin_per, line.price_with_margin,
                    line.tax_code_id, line.tax_amount,
                    assigned_to, assigned_at, now, created_by,
                ]
            );
        }

        // --------------------------------------------------
        // 14. INSERT service charges
        // --------------------------------------------------
        for (const charge of chargeLineItems) {
            await client.query(
                `INSERT INTO public.buyer_quote_service_charges (
                    buyer_quote_id, service_charge_id, charge_type, charge_value, charge_amount,
                    is_active, assigned_to, assigned_at, created_at, created_by
                 ) VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, $6)`,
                [buyer_quote_id, charge.service_charge_id, charge.charge_type, charge.charge_value, charge.charge_amount, created_by, now, now]
            );
        }

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 15. RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Quote created successfully from product listing",
            data: {
                buyer_quote_id,
                buyer_quote_uuid,
                quote_no,
                quote_type_id,
                total_price,
                item_count:              quoteLineItems.length,
                charge_count:            chargeLineItems.length,
                charges_total:           total_charges_amount,
                reservation_expires_at,
                created_at:              now,
            },
        });

    } catch (err) {
        if (inTransaction) await client.query("ROLLBACK");
        logger.error("Responder Error (create-buyer-quote-listing-customer):", err);
        saveErrorLog({
            api_name: "create-buyer-quote-listing-customer", method: "RESPONDER", payload: req,
            message: "Internal server error", stack: err.stack, error_code: 2004,
        });
        return cb(null, {
            header_type: "ERROR", message_visibility: true, status: false,
            code: 2004, message: "Create quote from listing failed", error: err.message,
        });
    } finally {
        client.release();
    }
});


// ------------------------------------------------------------------
// QUOTE ACCEPTANCE FOR BUYER AND CUSTOMER   — FROM PRODUCT LISTING
// ------------------------------------------------------------------
//
//   - Targets ONLY listing-origin product lines (cart_item_id IS
//     NULL) on this quote.
//   - Uses the WAREHOUSE THE BUYER/CUSTOMER CHOSE at request time
//     (buyer_quote_items.warehouse_id) — no auto-selection or
//     substitution of a different warehouse here.
//   - RE-VALIDATES stock here even though a soft reservation was
//     already taken at create time — B2B quote negotiation can span
//     days, so stock may have moved since then. This is the point
//     where the soft "quote hold" becomes a real cart_details hold.
//     All-or-nothing: any single insufficient item fails the entire
//     acceptance.
//   - The ATP check EXCLUDES this quote's own buyer_quote_items rows
//     (bsq2.buyer_quote_id != current) — without that exclusion, an
//     item would count its own outstanding soft-hold as "someone
//     else's" reservation and incorrectly shrink its own available
//     stock.
//   - Locks the seller_inventory row FOR UPDATE before inserting
//     cart_details, so concurrent accept attempts on overlapping
//     stock cannot both succeed.
// --------------------------------------------------

responder.on("accept-buyer-quote-listing", async (req, cb) => {
    const client = await pool.connect();
    let inTransaction = false;

    try {
        const { buyer_uuid, buyer_quote_uuid, accepted_by } = req.body;

        // --------------------------------------------------
        // 1. VALIDATE
        // --------------------------------------------------
        if (!buyer_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer uuid is required" });

        if (!buyer_quote_uuid?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "buyer quote uuid is required" });

        if (!accepted_by?.trim())
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2001, message: "Validation failed", error: "accepted by is required" });

        // --------------------------------------------------
        // 2. RESOLVE buyer_id
        // --------------------------------------------------
        const buyerCheck = await pool.query(
            `SELECT buyer_id
             FROM public.buyer_accounts
             WHERE buyer_uuid            = $1
               AND is_active             = TRUE
               AND is_deleted            = FALSE
               AND phone_number_verified = TRUE`,
            [buyer_uuid.trim()]
        );

        if (buyerCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No active buyer found with the provided UUID" });

        const buyer_id = buyerCheck.rows[0].buyer_id;

        // --------------------------------------------------
        // 3. RESOLVE quote + status + quote_type_id
        // --------------------------------------------------
        const quoteCheck = await pool.query(
            `SELECT bsq.buyer_quote_id, bsq.quote_type_id, qs.code AS current_status_code
             FROM public.buyer_saved_quote bsq
             JOIN public.quote_statuses qs
               ON qs.quote_status_id = bsq.status_of_quote
             WHERE bsq.buyer_quote_uuid = $1
               AND bsq.buyer_id         = $2
               AND bsq.is_deleted       = FALSE`,
            [buyer_quote_uuid.trim(), buyer_id]
        );

        if (quoteCheck.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "No quote found for this buyer with the provided UUID" });

        const { buyer_quote_id, quote_type_id, current_status_code } = quoteCheck.rows[0];

        const ACCEPTABLE_STATUSES = ["DRF", "ACT"];

        if (!ACCEPTABLE_STATUSES.includes(current_status_code))
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2008, message: "Action not allowed",
                error: `Quote cannot be accepted from its current status (${current_status_code})`,
            });

        // --------------------------------------------------
        // 4. RESOLVE target statuses
        // --------------------------------------------------
        const [
            acceptedStatusResult,
            checkoutEligibleResult,
        ] = await Promise.all([
            pool.query(`SELECT quote_status_id FROM public.quote_statuses WHERE code = 'ACC' AND is_active = TRUE AND is_deleted = FALSE`),
            pool.query(`SELECT cart_item_status_id FROM public.cart_item_status WHERE code = 'PND' AND is_active = TRUE AND is_deleted = FALSE`),
        ]);

        if (acceptedStatusResult.rowCount === 0 || checkoutEligibleResult.rowCount === 0) {
            logger.error("accept-buyer-quote-listing: missing master data — quote_statuses(ACC) / cart_item_status(PND)");
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Configuration error", error: "Required master data not found" });
        }

        const accepted_quote_status_id    = acceptedStatusResult.rows[0].quote_status_id;
        const checkout_eligible_status_id = checkoutEligibleResult.rows[0].cart_item_status_id;

        // --------------------------------------------------
        // 5. FETCH LISTING-ORIGIN product lines (cart_item_id IS NULL)
        //    — warehouse_id / warehouse_type_id already stored from
        //    request time. tax_code_id pulled here to resolve the
        //    tax rate before we enter the transaction.
        //    CHANGE: p.price (MRP) / p.price_after_sale (sale_price)
        //    added — needed to compute discount_amount the same way
        //    add-to-cart.js does (MRP-vs-current-selling-price), so
        //    the buyer sees a consistent discount figure on the cart
        //    row regardless of whether it arrived via add-to-cart or
        //    quote acceptance.
        // --------------------------------------------------
        const quoteItemsResult = await pool.query(
            `SELECT
                bqi.buyer_quote_item_id, bqi.product_id, bqi.warehouse_id, bqi.warehouse_type_id,
                bqi.price_with_margin, bqi.quantity, bqi.tax_amount, bqi.tax_code_id,
                p.seller_id, p.uom_id, p.name AS product_name, p.sku, p.oem_part_number AS oem_number,
                p.price AS mrp, p.price_after_sale AS sale_price,
                p.is_active AS product_is_active, p.is_deleted AS product_is_deleted,
                p.is_listed, p.verify_status,
                sw.warehouse_uuid, sw.is_active AS warehouse_is_active, sw.is_deleted AS warehouse_is_deleted
             FROM public.buyer_quote_items bqi
             JOIN public.products p
               ON p.product_id = bqi.product_id
             LEFT JOIN public.seller_warehouse sw
               ON sw.warehouse_id = bqi.warehouse_id
             WHERE bqi.buyer_quote_id = $1
               AND bqi.cart_item_id  IS NULL
               AND bqi.service_item   = 'Product'
               AND bqi.is_active      = TRUE
               AND bqi.is_deleted     = FALSE`,
            [buyer_quote_id]
        );

        if (quoteItemsResult.rowCount === 0)
            return cb(null, { header_type: "ERROR", message_visibility: true, status: false, code: 2003, message: "Record not found", error: "This quote has no listing-origin product line items to accept" });

        const ineligibleItems = quoteItemsResult.rows.filter(
            (r) => !r.product_is_active || r.product_is_deleted || !r.is_listed || r.verify_status !== "APPROVED"
        );

        if (ineligibleItems.length > 0)
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2008, message: "Action not allowed",
                error: `Some quoted products are no longer available: ${ineligibleItems.map((r) => r.product_name).join(", ")}`,
            });

        // Warehouse the buyer/customer chose could have been
        // deactivated since the quote was requested — re-validate here.
        const invalidWarehouseItems = quoteItemsResult.rows.filter(
            (r) => !r.warehouse_id || !r.warehouse_is_active || r.warehouse_is_deleted
        );

        if (invalidWarehouseItems.length > 0)
            return cb(null, {
                header_type: "ERROR", message_visibility: true, status: false,
                code: 2008, message: "Action not allowed",
                error: `The selected warehouse is no longer available for: ${invalidWarehouseItems.map((r) => r.product_name).join(", ")}`,
            });

        // --------------------------------------------------
        // 5b. RESOLVE tax_code / tax_rate for all distinct tax_code_id
        //     values on this quote's items, in a single batched query
        //     (avoids N+1 lookups inside the per-item loop below).
        // --------------------------------------------------
        const distinctTaxCodeIds = [
            ...new Set(
                quoteItemsResult.rows
                    .map((r) => r.tax_code_id)
                    .filter((id) => id !== null && id !== undefined)
            ),
        ];

        const taxCodeMap = new Map(); // tax_code_id -> { tax_code, tax_rate }

        if (distinctTaxCodeIds.length > 0) {
            const taxCodeResult = await pool.query(
                `SELECT tax_code_id, code, tax_rate
                 FROM public.tax_code_master
                 WHERE tax_code_id = ANY($1::int[])
                   AND is_active   = TRUE
                   AND is_deleted  = FALSE`,
                [distinctTaxCodeIds]
            );

            taxCodeResult.rows.forEach((row) => {
                taxCodeMap.set(row.tax_code_id, {
                    tax_code_id: row.tax_code_id,
                    tax_rate: row.tax_rate,
                });
            });

            const missingTaxCodeIds = distinctTaxCodeIds.filter((id) => !taxCodeMap.has(id));
            if (missingTaxCodeIds.length > 0) {
                logger.error(`accept-buyer-quote-listing: missing/inactive tax_code_master rows for tax_code_id(s): ${missingTaxCodeIds.join(", ")}`);
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2003, message: "Configuration error",
                    error: "Tax configuration not found for one or more quoted items",
                });
            }
        }

        // --------------------------------------------------
        // 6. TRANSACTION — per item: lock the chosen warehouse's
        //    inventory, re-validate ATP (excluding this quote's own
        //    soft-holds), fail-fast on first insufficient item
        //    (all-or-nothing).
        // --------------------------------------------------
        const now = new Date();

        const fresh_reservation_expires_at = new Date(
            now.getTime() + commonenum.TIME_DURATION_MINUTES.RESERVATION_EXPIRY * 60 * 1000
        );

        await client.query("BEGIN");
        inTransaction = true;

        const createdCartItems = [];

        for (const item of quoteItemsResult.rows) {
            const requestedQty = Number(item.quantity);

            // 6a. Lock the exact warehouse chosen at request time
            const invResult = await client.query({
                text: `SELECT inventory_id, onhand_qty, reserved_qty, buffer_qty
                       FROM public.seller_inventory
                       WHERE product_id   = $1
                         AND seller_id    = $2
                         AND warehouse_id = $3
                         AND is_deleted   = FALSE
                         AND is_active    = TRUE
                       FOR UPDATE`,
                values: [item.product_id, item.seller_id, item.warehouse_id],
            });

            if (invResult.rowCount === 0) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2003, message: "Record not found",
                    error: `Inventory no longer available for ${item.product_name} at the selected warehouse`,
                });
            }

            const inv = invResult.rows[0];
            const inventoryAvailable = Number(inv.onhand_qty) - Number(inv.reserved_qty) - Number(inv.buffer_qty);

            // 6b. Subtract other buyers' active cart holds
            const cartReservedResult = await client.query({
                text: `SELECT COALESCE(SUM(cd.reserved_quantity), 0) AS total_reserved
                       FROM public.cart_details cd
                       JOIN public.cart_item_status cis
                         ON cis.cart_item_status_id = cd.cart_item_status_id
                       WHERE cd.product_id   = $1
                         AND cd.seller_id    = $2
                         AND cd.warehouse_id = $3
                         AND cd.is_deleted   = FALSE
                         AND cis.code NOT IN ('REM', 'EXP', 'ORC')`,
                values: [item.product_id, item.seller_id, item.warehouse_id],
            });

            // 6c. Subtract OTHER quotes' listing-origin soft-holds —
            //     EXCLUDES this quote's own rows (bsq2.buyer_quote_id != current) so this item doesn't count its own
            //     outstanding reservation against itself.
            const quoteReservedResult = await client.query({
                text: `SELECT COALESCE(SUM(bqi2.quantity), 0) AS total_reserved
                       FROM public.buyer_quote_items bqi2
                       JOIN public.buyer_saved_quote bsq2
                         ON bsq2.buyer_quote_id = bqi2.buyer_quote_id
                       JOIN public.quote_statuses qs2
                         ON qs2.quote_status_id = bsq2.status_of_quote
                       WHERE bqi2.product_id     = $1
                         AND bqi2.warehouse_id   = $2
                         AND bqi2.cart_item_id  IS NULL
                         AND bqi2.is_deleted     = FALSE
                         AND bqi2.is_active      = TRUE
                         AND bsq2.buyer_quote_id != $3
                         AND qs2.code IN ('DRF', 'ACT')`,
                values: [item.product_id, item.warehouse_id, buyer_quote_id],
            });

            const existingCartReserved  = Number(cartReservedResult.rows[0].total_reserved);
            const existingQuoteReserved = Number(quoteReservedResult.rows[0].total_reserved);
            const netAvailable          = inventoryAvailable - existingCartReserved - existingQuoteReserved;

            if (requestedQty > netAvailable) {
                await client.query("ROLLBACK");
                inTransaction = false;
                return cb(null, {
                    header_type: "ERROR", message_visibility: true, status: false,
                    code: 2007, message: "Insufficient stock",
                    error: `Only ${Math.max(netAvailable, 0)} unit(s) available for ${item.product_name} at the selected warehouse. Quote cannot be accepted as-is.`,
                });
            }

            // 6d. Compute locked price (already fixed at quote-creation time)
            const unit_price  = Number(item.price_with_margin);
            const price       = parseFloat((unit_price * requestedQty).toFixed(2));
            const tax_amount  = Number(item.tax_amount);
            const final_price = parseFloat((price + tax_amount).toFixed(2));

            // CHANGE: discount_amount computed the same way add-to-
            // cart.js does — (MRP − current sale_price) × quantity,
            // clamped at 0. This is a product-level "savings vs
            // listed price" figure and is independent of the quoted
            // margin (unit_price/price above), matching add-to-cart.js's
            // exact formula so the buyer sees a consistent discount
            // figure on the cart row regardless of origin.
            const mrp        = Number(item.mrp);
            const sale_price = Number(item.sale_price);
            const discount_amount = Math.max(
                0,
                parseFloat(((mrp - sale_price) * requestedQty).toFixed(2))
            );

            // tax_code / tax_percentage resolved from tax_code_master (step 5b),
            // matched on tax_code_id (PK) against this item's tax_code_id.
            const taxInfo        = taxCodeMap.get(item.tax_code_id) || {};
            const tax_code       = taxInfo.tax_code_id ?? null;
            const tax_percentage = taxInfo.tax_rate ?? null;

            // 6e. INSERT cart_details — first time this product enters
            //     the cart for this buyer, at the chosen warehouse.
            const cartInsert = await client.query({
                text: `INSERT INTO public.cart_details (
                            buyer_id, product_id, seller_id, warehouse_id, warehouse_type_id,
                            product_name, sku, oem_number,
                            unit_price, price, quantity, uom_id,
                            tax_amount, tax_code, tax_percentage, discount_amount, final_price,
                            reserved_quantity, reservation_expires_at, cart_item_status_id,
                            quote_id, quote_item_id, quote_type_id,
                            assigned_to, assigned_at, created_by
                       ) VALUES (
                            $1, $2, $3, $4, $5,
                            $6, $7, $8,
                            $9, $10, $11, $12,
                            $13, $14, $15, $16, $17,
                            $11, $18, $19,
                            $20, $21, $22,
                            $23, $24, $25
                       )
                       RETURNING cart_item_id, cart_item_uuid`,
                values: [
                    buyer_id, item.product_id, item.seller_id, item.warehouse_id, item.warehouse_type_id,
                    item.product_name, item.sku, item.oem_number,
                    unit_price, price, requestedQty, item.uom_id,
                    tax_amount, tax_code, tax_percentage, discount_amount, final_price,
                    fresh_reservation_expires_at, checkout_eligible_status_id,
                    buyer_quote_id, item.buyer_quote_item_id, quote_type_id,
                    accepted_by, now, accepted_by,
                ],
            });

            const { cart_item_id, cart_item_uuid } = cartInsert.rows[0];

            // 6f. Link the quote item back to the newly created cart row
            await client.query({
                text: `UPDATE public.buyer_quote_items SET
                            cart_item_id = $1,
                            modified_at   = $2,
                            modified_by   = $3
                       WHERE buyer_quote_item_id = $4
                         AND is_deleted           = FALSE`,
                values: [cart_item_id, now, accepted_by, item.buyer_quote_item_id],
            });

            createdCartItems.push({
                cart_item_id, cart_item_uuid,
                product_id: item.product_id,
                warehouse_id: item.warehouse_id,
                quantity: requestedQty,
                discount_amount,
                tax_code,
                tax_percentage,
            });
        }

        // 6g. Quote header -> ACC
        await client.query(
            `UPDATE public.buyer_saved_quote SET
                status_of_quote = $1,
                modified_at      = $2,
                modified_by      = $3
             WHERE buyer_quote_id = $4
               AND is_deleted     = FALSE`,
            [accepted_quote_status_id, now, accepted_by, buyer_quote_id]
        );

        await client.query("COMMIT");
        inTransaction = false;

        // --------------------------------------------------
        // 7. RESPONSE
        // --------------------------------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Quote accepted successfully. Items moved to cart.",
            data: {
                buyer_quote_id,
                buyer_quote_uuid,
                accepted_items_count:   createdCartItems.length,
                cart_items:             createdCartItems,
                reservation_expires_at: fresh_reservation_expires_at,
                accepted_at:            now,
            },
        });

    } catch (err) {
        if (inTransaction) await client.query("ROLLBACK");
        logger.error("Responder Error (accept-buyer-quote-listing):", err);
        saveErrorLog({
            api_name: "accept-buyer-quote-listing", method: "RESPONDER", payload: req,
            message: "Internal server error", stack: err.stack, error_code: 2004,
        });
        return cb(null, {
            header_type: "ERROR", message_visibility: true, status: false,
            code: 2004, message: "Quote acceptance failed", error: err.message,
        });
    } finally {
        client.release();
    }
});