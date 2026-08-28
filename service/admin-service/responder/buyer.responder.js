require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const { buildAdvancedSearchQuery } = require('@libs/advanced-search/advance-filter');
const path = require("path");
const APP_CONFIG = require('@libs/config/config.prod');
const { sendmail } = require('@libs/common/common-util');
const uploadDir = path.join('/app/assets', 'admin-buyer');
const fs = require("fs");
const crypto = require("crypto");
// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'buyer responder',
    key: 'buyer',
    redis: { host: redisHost, port: redisPort }
});


// ================================================================
// Generate next buyer code
// ================================================================
async function generateNextBuyerCode(pool) {
    const prefixRes = await pool.query(
        `SELECT prefix_code FROM prefix_refno
     WHERE table_name='buyer_accounts' AND is_active = true AND is_deleted = false
     ORDER BY created_at DESC LIMIT 1`
    );
    const prefix = prefixRes.rows[0]?.prefix_code || "BYR";

    const result = await pool.query(
        `SELECT buyer_code FROM buyer_accounts
     WHERE buyer_code IS NOT NULL 
     ORDER BY (regexp_replace(buyer_code,'\\D','','g'))::int DESC
     LIMIT 1`
    );
    const lastCode = result.rows[0]?.buyer_code || null;

    if (!lastCode) return `${prefix}00001`;
    const match = lastCode.match(/\d+$/);
    const number = match ? parseInt(match[0], 10) : 0;
    return `${prefix}${(number + 1).toString().padStart(5, "0")}`;
}

// --------------------------------------------------
// ADMIN - BUYER MANAGEMENT - FILE SAVE 
// --------------------------------------------------

function generateFileName(file, buyerCode, documentTypeCode, uuid) {
    const ext = path.extname(file.name);
    return `${buyerCode}_${documentTypeCode}_${uuid}${ext}`;
}

responder.on('admin-buyer-filesave', async (req, cb) => {

    const client = await pool.connect();

    try {
        let { buyer_code, document_type_name, mode } = req.body;
        const file = req.files?.file;

        /* ======================================================
           VALIDATION
        ====================================================== */

        if (!buyer_code || !document_type_name) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "buyer code and document name are required"
            });
        }

        if (!file) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "File is required"
            });
        }

        /* ======================================================
           MIME TYPE VALIDATION
        ====================================================== */

        const allowedMimeTypes = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/jpg",
            "video/mp4",
            "video/webm",
            "video/quicktime",
            "application/pdf"
        ];

        if (!allowedMimeTypes.includes(file.type)) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Invalid file type",
                error: "Only image, video and PDF files are allowed"
            });
        }

        /* ======================================================
           FILE SIZE VALIDATION
        ====================================================== */

        const MAX_SIZE_MB = 50;
        const maxSize = MAX_SIZE_MB * 1024 * 1024;

        if (file.size > maxSize) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: `File size should not exceed ${MAX_SIZE_MB}MB`
            });
        }

        /* ======================================================
       BUYER CODE UNIQUENESS CHECK
    ====================================================== */

        if (mode === "create") {

            const existing = await pool.query(
                "SELECT 1 FROM buyer_accounts WHERE buyer_code = $1",
                [buyer_code]
            );
            const finalCode =
                existing.rows.length > 0
                    ? await generateNextBuyerCode(pool)
                    : buyer_code;

            buyer_code = finalCode;
        }

        const finalCode = buyer_code;


        /* ======================================================
           FETCH DOCUMENT TYPE CODE
        ====================================================== */

        const docTypeRes = await client.query(
            `
            SELECT code
            FROM document_type_master
            WHERE LOWER(name) = LOWER($1)
              AND is_deleted = FALSE
              AND is_active = TRUE
            `,
            [document_type_name]
        );

        if (docTypeRes.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Invalid document type",
                error: "Document type not found"
            });
        }

        const documentTypeCode = docTypeRes.rows[0].code;

        /* ======================================================
           GENERATE UUID
        ====================================================== */

        const document_uuid = crypto.randomUUID();

        /* ======================================================
           FILE SAVE
        ====================================================== */

        const newFileName = generateFileName(
            file,
            finalCode,
            documentTypeCode,
            document_uuid
        );

        const finalPath = path.join(uploadDir, newFileName).replace(/\\/g, '/');

        fs.renameSync(file.path, finalPath);

        /* ======================================================
           SUCCESS RESPONSE
        ====================================================== */

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "File uploaded successfully",
            data: {
                buyer_code: finalCode,
                file_path: finalPath,
                document_uuid: document_uuid
            }
        });

    } catch (err) {

        logger.error("Responder Error (filesave):", err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });

    } finally {
        client.release();
    }
});

// --------------------------------------------------
// ADMIN - BUYER MANAGEMENT - CREATE 
// --------------------------------------------------

// ---------------- ADDRESS INSERT ----------------
async function insertAccountAddresses(client, payload) {

    const { account_type_id, account_id, addresses, created_by, assigned_to } = payload;

    for (const addr of addresses) {

        // ---------- REQUIRED FIELDS ----------
        const requiredFields = [
            "address_type_name",
            "country_id",
            "state_id",
            "city",
            "address_line1",
            "address_line2",
            "display_name",
            //  "phone_number",
            // "country_code",
            "map_address",
            "googlemap_link"
        ];

        const missingFields = requiredFields.filter(field =>
            addr[field] === undefined ||
            addr[field] === null ||
            addr[field] === ''
        );

        if (!account_type_id || !account_id || !created_by || !assigned_to) {
            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Missing required fields"
            };
            //throw new Error("Missing required fields");
        }

        if (missingFields.length > 0) {

            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: `Missing required address details: ${missingFields.join(', ')}`
            };
            // throw new Error(`Missing required address details: ${missingFields.join(', ')}`);
        }

        const addrTypeRes = await client.query(
            `SELECT address_type_id
             FROM address_type_master
             WHERE LOWER(name)=LOWER($1)`,
            [addr.address_type_name]
        );

        if (addrTypeRes.rowCount === 0)
            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: `Invalid address type : ${addr.address_type_name}`
            };
        //throw new Error(`Invalid address type : ${addr.address_type_name}`);

        const address_type_id = addrTypeRes.rows[0].address_type_id;


        // Check uniqueness condition
        const existingAddress = await client.query(
            `SELECT 1
             FROM account_addresses
             WHERE account_id = $1
             AND account_type_id = $2
             AND address_type_id = $3
             AND is_deleted = false
             AND is_active = true`,
            [account_id, account_type_id, address_type_id]
        );

        if (existingAddress.rowCount > 0) {

            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Creation failed",
                error: "Address already exists"
            };
            // throw new Error(
            //     `Address already exists`
            // );
        }

        await client.query(
            `INSERT INTO account_addresses(
                account_type_id, account_id, address_type_id,
                country_id, state_id, city,
                address_line1, address_line2, display_name,
                phone_number, country_code,
                map_address, googlemap_link,
                latitude, longitude,
                created_by, assigned_to
            )
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
            [
                account_type_id,
                account_id,
                address_type_id,
                addr.country_id,
                addr.state_id,
                addr.city,
                addr.address_line1,
                addr.address_line2,
                addr.display_name,
                addr.phone_number,
                addr.country_code,
                addr.map_address,
                addr.googlemap_link,
                addr.latitude,
                addr.longitude,
                created_by,
                assigned_to
            ]
        );
    }
}

// ---------------- DOCUMENT INSERT ----------------

async function insertAccountDocuments(client, payload) {

    const { account_type_id, account_id, documents, created_by, assigned_to } = payload;

    for (const doc of documents) {


        // ---------- REQUIRED FIELDS ----------
        const requiredFields = [
            "document_uuid",
            "document_type_name",
            "document_path",
            "expiry_date",
            "country_of_issue",
            "verified_status"
        ];

        const missingFields = requiredFields.filter(field =>
            doc[field] === undefined ||
            doc[field] === null ||
            doc[field] === ''
        );

        if (!account_type_id || !account_id || !created_by || !assigned_to) {
            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Missing required fields"
            };
            //throw new Error("Missing required fields");
        }

        if (missingFields.length > 0) {

            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: `Missing required document details: ${missingFields.join(', ')}`
            };
            // throw new Error(`Missing required document details: ${missingFields.join(', ')}`);
        }

        // ---------- EXPIRY DATE VALIDATION ----------
        const expiryDate = new Date(doc.expiry_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (isNaN(expiryDate) || expiryDate <= today) {
            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Document expiry date must be a valid future date"
            };
            //throw new Error("Document expiry date must be a valid future date");
        }


        const docTypeRes = await client.query(
            `SELECT document_type_id
             FROM document_type_master
             WHERE LOWER(name)=LOWER($1)
             AND is_deleted = FALSE
             AND is_active = TRUE`,
            [doc.document_type_name]
        );

        if (docTypeRes.rowCount === 0)
            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: `Invalid document type : ${doc.document_type_name}`
            };
        //throw new Error(`Invalid document type : ${doc.document_type_name}`);

        const document_type_id = docTypeRes.rows[0].document_type_id;

        // Check if combination already exists
        const existingDoc = await client.query(
            `SELECT 1
             FROM account_documents
             WHERE account_id = $1
             AND account_type_id = $2
             AND document_type_id = $3
             AND is_deleted = false
             AND is_active = true`,
            [account_id, account_type_id, document_type_id]
        );

        if (existingDoc.rowCount > 0) {

            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Creation failed",
                error: "Document already exists"
            };

        }

        await client.query(
            `INSERT INTO account_documents(
                document_uuid,account_type_id, account_id, document_type_id,
                document_path, expiry_date, country_of_issue,
                verified_status, created_by, assigned_to
            )
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
                doc.document_uuid,
                account_type_id,
                account_id,
                document_type_id,
                doc.document_path,
                doc.expiry_date,
                doc.country_of_issue,
                doc.verified_status,
                created_by,
                assigned_to
            ]
        );
    }
}


// ---------------- BANK INSERT ----------------
async function insertAccountBankDetails(client, payload) {

    const { account_type_id, account_id, bank_details, created_by, assigned_to } = payload;

    for (const bank of bank_details) {


        // ---------- REQUIRED FIELDS ----------
        const requiredFields = [
            "beneficiary_name",
            "bank_name",
            "branch_name",
            "account_number",
            "iban_number",
            "swift_code",
            "currency_id",
            "bank_document"
        ];

        const missingFields = requiredFields.filter(field =>
            bank[field] === undefined ||
            bank[field] === null ||
            bank[field] === ''
        );

        if (!account_type_id || !account_id || !created_by || !assigned_to) {

            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Missing required fields"
            };
            // throw new Error("Missing required fields");
        }

        if (missingFields.length > 0) {

            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: `Missing required bank details: ${missingFields.join(', ')}`
            };

            // throw new Error(`Missing required bank details: ${missingFields.join(', ')}`);
        }

        // Check uniqueness condition
        const existingBank = await client.query(
            `SELECT 1
             FROM account_bank_details
             WHERE account_id = $1
             AND account_type_id = $2
             AND LOWER(beneficiary_name) = LOWER($3)
             AND is_deleted = false
             AND is_active = true`,
            [
                account_id,
                account_type_id,
                bank.beneficiary_name
            ]
        );

        if (existingBank.rowCount > 0) {


            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Creation failed",
                error: `Bank details already exist for beneficiary ${bank.beneficiary_name}`
            };
            // throw new Error(
            //     `Bank details already exist for beneficiary ${bank.beneficiary_name}`
            // );
        }

        await client.query(
            `INSERT INTO account_bank_details(
                account_type_id, account_id,
                beneficiary_name, bank_name, branch_name,
                account_number, iban_number, swift_code,
                currency_id, bank_document,
                created_by, assigned_to
            )
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
                account_type_id,
                account_id,
                bank.beneficiary_name,
                bank.bank_name,
                bank.branch_name,
                bank.account_number,
                bank.iban_number,
                bank.swift_code,
                bank.currency_id,
                bank.bank_document,
                created_by,
                assigned_to
            ]
        );
    }
}


// ---------------- MAIN API ----------------

responder.on('create-admin-buyer', async (req, cb) => {

    const client = await pool.connect();

    try {

        const { account_type_name, body } = req;
        const { buyer_account, addresses = [], documents = [], bank_details = [] } = body;

        const created_by = buyer_account.created_by;
        const assigned_to = created_by;


        // ---------- REQUIRED FIELDS ----------
        const requiredFields = [
            "username",
            "buyer_code",
            "email_id",
            "business_name",
            "business_logo",
            "business_license_number",
            "has_multiple_branches",
            "registered_business_name",
            "subscription_id",
            "product_type_id",
            "payment_mode_id",
            "trading_type_id",
            "registration_status",
            "fail_reason",
            "tax_registration_number",
            "has_trade_license",
            "identity_country_id",
            "identity_id_number",
            "identity_expiry_date",
            "identity_first_name",
            "identity_middle_name",
            "identity_last_name",
            "phone_country_code",
            "phone_number",
            "phone_number_verified",
            "created_by"
        ];

        const missingFields = requiredFields.filter(field =>
            buyer_account[field] === undefined ||
            buyer_account[field] === null ||
            buyer_account[field] === ''
        );

        if (missingFields.length > 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: `Missing required fields: ${missingFields.join(', ')}`
            });
        }


        // ---------- BASIC VALIDATION ----------
        if (!buyer_account?.username || !buyer_account?.buyer_code || !buyer_account?.email_id) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "username, buyer code and email id are required"
            });
        }

        // ---------- IDENTITY EXPIRY DATE VALIDATION ----------
        if (buyer_account.identity_expiry_date) {
            const expiryDate = new Date(buyer_account.identity_expiry_date);
            const today = new Date();

            // Remove time part for accurate comparison
            today.setHours(0, 0, 0, 0);

            if (expiryDate <= today) {
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "Identity expiry date must be greater than today"
                });
            }
        }

        // ---------- BUYER CODE UNIQUENESS CHECK ----------
        let buyer_code = buyer_account.buyer_code;

        const existing = await pool.query(
            "SELECT 1 FROM buyer_accounts WHERE buyer_code = $1",
            [buyer_code]
        );

        const finalCode =
            existing.rows.length > 0
                ? await generateNextBuyerCode(pool)
                : buyer_code;

        buyer_code = finalCode;
        buyer_account.buyer_code = buyer_code;

                // ---------- BUYER CODE GAP CHECK ----------

        // Get the max existing buyer code number
    if (buyer_account.buyer_code) {

        const result = await pool.query(
            `SELECT MAX((regexp_replace(buyer_code, '\\D', '', 'g'))::int) AS max_num
     FROM buyer_accounts
     WHERE buyer_code IS NOT NULL AND is_deleted = false`
        );

        const maxNum = result.rows[0]?.max_num ?? 0;
        const expectedNext = maxNum + 1;

        // Extract number from submitted code
        const submittedNum = parseInt(buyer_account.buyer_code.replace(/\D/g, ""), 10);

        if (submittedNum !== expectedNext) {
            const prefix = buyer_account.buyer_code.replace(/\d+$/, "");
            const expectedCode = `${prefix}${String(expectedNext).padStart(5, "0")}`;
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: `Buyer code is not allowed. Next expected code is "${expectedCode}".`
            });
        }

    }


        await client.query("BEGIN");

        // ---------- ACCOUNT TYPE ----------
        const accTypeRes = await client.query(
            `SELECT account_type_id
             FROM account_type
             WHERE LOWER(name)=LOWER($1)`,
            [account_type_name]
        );

        if (accTypeRes.rowCount === 0)

            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Invalid account type"
            };


        const account_type_id = accTypeRes.rows[0].account_type_id;

        // ---------- USER ----------
        const userRes = await client.query(
            `SELECT user_id FROM users WHERE username=$1`,
            [buyer_account.username]
        );

        if (userRes.rowCount === 0)

            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Invalid username"
            };


        const user_id = userRes.rows[0].user_id;

        // ---------- DUPLICATE CHECK ----------
        const dupCheck = await client.query(
            `SELECT 1 FROM buyer_accounts WHERE buyer_code=$1 AND is_active = true AND is_deleted = FALSE`,
            [buyer_account.buyer_code]
        );

        if (dupCheck.rowCount > 0)
            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Creation failed",
                error: "Buyer code already exists"
            };


        // ---------- DUPLICATE CHECK : user_id + account_type_id ----------
        const duplicateCheck = await client.query(
            `SELECT 1 
     FROM buyer_accounts 
     WHERE user_id = $1
       AND account_type_id = $2
       AND is_deleted = false
       AND is_active = true`,
            [user_id, account_type_id]
        );

        if (duplicateCheck.rowCount > 0)
            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Creation failed",
                error: "Active buyer account already exists"
            };


        // ---------- INSERT BUYER ----------
        const buyerInsert = await client.query(
            `INSERT INTO buyer_accounts(
                account_type_id,user_id,buyer_code,email_id,
                business_name,business_logo,business_license_number,
                has_multiple_branches,registered_business_name,
                subscription_id,
                product_type_id,payment_mode_id,trading_type_id,
                registration_status,fail_reason,
                tax_registration_number,has_trade_license,
                identity_country_id,identity_id_number,identity_expiry_date,
                identity_first_name,identity_middle_name,identity_last_name,
                phone_country_code,phone_number,phone_number_verified,
                erp_id,last_integrated_date,
                created_by,assigned_to
            )
            VALUES(
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                $21,$22,$23,$24,$25,$26,$27,$28,$29,$30
            )
            RETURNING buyer_id`,
            [
                account_type_id,
                user_id,
                buyer_account.buyer_code,
                buyer_account.email_id,
                buyer_account.business_name,
                buyer_account.business_logo,
                buyer_account.business_license_number,
                buyer_account.has_multiple_branches,
                buyer_account.registered_business_name,
                buyer_account.subscription_id,
                buyer_account.product_type_id,
                buyer_account.payment_mode_id,
                buyer_account.trading_type_id,
                buyer_account.registration_status,
                buyer_account.fail_reason,
                buyer_account.tax_registration_number,
                buyer_account.has_trade_license,
                buyer_account.identity_country_id,
                buyer_account.identity_id_number,
                buyer_account.identity_expiry_date,
                buyer_account.identity_first_name,
                buyer_account.identity_middle_name,
                buyer_account.identity_last_name,
                buyer_account.phone_country_code,
                buyer_account.phone_number,
                buyer_account.phone_number_verified,
                buyer_account.erp_id,
                buyer_account.last_integrated_date,
                created_by,
                assigned_to
            ]
        );

        const account_id = buyerInsert.rows[0].buyer_id;

        // ---------- CHILD INSERTS ----------
        await insertAccountAddresses(client, { account_type_id, account_id, addresses, created_by, assigned_to });
        await insertAccountDocuments(client, { account_type_id, account_id, documents, created_by, assigned_to });
        await insertAccountBankDetails(client, { account_type_id, account_id, bank_details, created_by, assigned_to });

        await client.query("COMMIT");

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Buyer created successfully",
            data: {
                buyer_code: buyer_code
            }
        });

    } catch (err) {

        await client.query("ROLLBACK");

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Buyer creation failed",
            error: err.message
        });

    } finally {
        client.release();
    }
});


// --------------------------------------------------
// ADMIN - BUYER MANAGEMENT - UPDATE 
// --------------------------------------------------

// ---------------- ADDRESS UPDATE ----------------
async function updateAccountAddresses(client, payload) {

    const { account_type_id, account_id, addresses, modified_by } = payload;

    for (const addr of addresses) {

        // ---------- REQUIRED FIELDS ----------
        const requiredFields = [
            "address_type_name",
            "country_id",
            "state_id",
            "city",
            "address_line1",
            "display_name",
            "phone_number",
            "country_code",
            "map_address",
            "googlemap_link",
            "latitude",
            "longitude",
            "drop_address"
        ];

        const missingFields = requiredFields.filter(field =>
            addr[field] === undefined ||
            addr[field] === null ||
            addr[field] === ''
        );

        if (missingFields.length > 0) {
            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: `Missing required address details: ${missingFields.join(', ')}`
            };

            // throw new Error(`Missing required address details: ${missingFields.join(', ')}`);
        }

        const addrTypeRes = await client.query(
            `SELECT address_type_id
             FROM address_type_master
             WHERE LOWER(name) = LOWER($1)`,
            [addr.address_type_name]
        );

        if (addrTypeRes.rowCount === 0) {
            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: `Invalid address type : ${addr.address_type_name}`
            };
            // throw new Error(`Invalid address type : ${addr.address_type_name}`);
        }

        const address_type_id = addrTypeRes.rows[0].address_type_id;

        // ======================================================
        // INSERT NEW RECORD IF ADDRESS UUID NOT PRESENT
        // ======================================================
        if (!addr.address_uuid) {

            const dup = await client.query(
                `SELECT 1
                 FROM account_addresses
                 WHERE account_id = $1
                   AND account_type_id = $2
                   AND address_type_id = $3
                   AND is_deleted = false
                   AND is_active = true`,
                [
                    account_id,
                    account_type_id,
                    address_type_id
                ]
            );

            if (dup.rowCount > 0) {
                return {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2002,
                    message: "Updation failed",
                    error: `${addr.address_type_name} already exists`
                };
                //throw new Error(`${addr.address_type_name} already exists`);
            }

            await client.query(
                `INSERT INTO account_addresses (
                    account_id,
                    account_type_id,
                    address_type_id,
                    country_id,
                    state_id,
                    city,
                    address_line1,
                    address_line2,
                    display_name,
                    phone_number,
                    country_code,
                    map_address,
                    googlemap_link,
                    latitude,
                    longitude,
                    drop_address,
                    is_active,
                    created_by,
                    assigned_to
                )
                VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                    $11,$12,$13,$14,$15,$16,$17,$18,$19
                )`,
                [
                    account_id,
                    account_type_id,
                    address_type_id,
                    addr.country_id,
                    addr.state_id,
                    addr.city,
                    addr.address_line1,
                    addr.address_line2,
                    addr.display_name,
                    addr.phone_number,
                    addr.country_code,
                    addr.map_address,
                    addr.googlemap_link,
                    addr.latitude,
                    addr.longitude,
                    addr.drop_address,
                    true,
                    modified_by,
                    modified_by
                ]
            );

        } else {

            // ======================================================
            // UPDATE EXISTING RECORD
            // ======================================================
            const addrCheck = await client.query(
                `SELECT 1
                 FROM account_addresses
                 WHERE address_uuid = $1
                   AND account_id = $2
                   AND is_deleted = false`,
                [addr.address_uuid, account_id]
            );

            if (addrCheck.rowCount === 0) {
                return {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2003,
                    message: "Record not found",
                    error: "Address record not found"
                };
                //throw new Error("Address record not found");
            }

            const dup = await client.query(
                `SELECT 1
                 FROM account_addresses
                 WHERE account_id = $1
                   AND account_type_id = $2
                   AND address_type_id = $3
                   AND is_deleted = false
                   AND is_active = true
                   AND address_uuid <> $4`,
                [
                    account_id,
                    account_type_id,
                    address_type_id,
                    addr.address_uuid
                ]
            );

            if (dup.rowCount > 0) {
                return {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2002,
                    message: "Updation failed",
                    error: `${addr.address_type_name} already exists`
                };

                //throw new Error(`${addr.address_type_name} already exists`);
            }

            await client.query(
                `UPDATE account_addresses SET
                    address_type_id = $1,
                    country_id = $2,
                    state_id = $3,
                    city = $4,
                    address_line1 = $5,
                    address_line2 = $6,
                    display_name = $7,
                    phone_number = $8,
                    country_code = $9,
                    map_address = $10,
                    googlemap_link = $11,
                    latitude = $12,
                    longitude = $13,
                    modified_by = $14,
                    drop_address = $15,
                    is_active = $16,
                    modified_at = now()
                 WHERE address_uuid = $17`,
                [
                    address_type_id,
                    addr.country_id,
                    addr.state_id,
                    addr.city,
                    addr.address_line1,
                    addr.address_line2,
                    addr.display_name,
                    addr.phone_number,
                    addr.country_code,
                    addr.map_address,
                    addr.googlemap_link,
                    addr.latitude,
                    addr.longitude,
                    modified_by,
                    addr.drop_address,
                    addr.is_active,
                    addr.address_uuid
                ]
            );
        }
    }
}

// ---------------- DOCUMENT UPDATE ----------------
async function updateAccountDocuments(client, payload) {

    const { account_type_id, account_id, documents, modified_by } = payload;

    for (const doc of documents) {

        // ---------- REQUIRED FIELDS ----------
        const requiredFields = [
            "document_uuid",
            "document_type_name",
            "document_path",
            "expiry_date",
            "country_of_issue",
            "verified_status"
        ];

        const missingFields = requiredFields.filter(field =>
            doc[field] === undefined ||
            doc[field] === null ||
            doc[field] === ''
        );

        if (missingFields.length > 0) {

            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: `Missing required document details: ${missingFields.join(', ')}`
            };
            // throw new Error(`Missing required document details: ${missingFields.join(', ')}`);
        }

        // ---------- EXPIRY DATE VALIDATION ----------
        const expiryDate = new Date(doc.expiry_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (isNaN(expiryDate) || expiryDate <= today) {

            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Document expiry date must be a valid future date"
            };
            //throw new Error("Document expiry date must be a valid future date");
        }

        const docTypeRes = await client.query(
            `SELECT document_type_id
             FROM document_type_master
             WHERE LOWER(name) = LOWER($1)
             AND is_deleted = FALSE
             AND is_active = TRUE`,
            [doc.document_type_name]
        );

        if (docTypeRes.rowCount === 0) {
            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: `Invalid document type : ${doc.document_type_name}`
            };
        }

        const document_type_id = docTypeRes.rows[0].document_type_id;

        // ======================================================
        // INSERT NEW RECORD 
        // ======================================================
        if (doc.document_uuid) {

            // ======================================================
            // DEACTIVATE OLD RECORDS (if UUID is different)
            // ======================================================

            await client.query(
                `UPDATE account_documents
     SET is_active = false, 
     modified_by = $1,
     modified_at = NOW()
     WHERE account_id = $2
     AND account_type_id = $3
     AND document_type_id = $4
     AND is_deleted = false
     AND document_uuid <> $5`,
                [modified_by, account_id, account_type_id, document_type_id, doc.document_uuid]
            );

            await client.query(
                `INSERT INTO account_documents (
                    document_uuid,
                    account_id,
                    account_type_id,
                    document_type_id,
                    document_path,
                    expiry_date,
                    country_of_issue,
                    verified_status,
                    is_active,
                    created_by,
                    assigned_to
                )
                VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
                )`,
                [
                    doc.document_uuid,
                    account_id,
                    account_type_id,
                    document_type_id,
                    doc.document_path,
                    doc.expiry_date,
                    doc.country_of_issue,
                    doc.verified_status,
                    true,
                    modified_by,
                    modified_by
                ]
            );

        }
    }
}

// ---------------- BANK DETAILS UPDATE ----------------
async function updateAccountBankDetails(client, payload) {

    const { account_type_id, account_id, bank_details, modified_by } = payload;

    for (const bank of bank_details) {

        // ---------- REQUIRED FIELDS ----------
        const requiredFields = [
            "beneficiary_name",
            "bank_name",
            "branch_name",
            "account_number",
            "iban_number",
            "swift_code",
            "currency_id",
            "bank_document"
        ];

        const missingFields = requiredFields.filter(field =>
            bank[field] === undefined ||
            bank[field] === null ||
            bank[field] === ''
        );

        if (missingFields.length > 0) {

            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: `Missing required bank details: ${missingFields.join(', ')}`
            };

            // throw new Error(`Missing required bank details: ${missingFields.join(', ')}`);
        }

        // ======================================================
        // INSERT NEW RECORD IF ACCOUNT BANK UUID NOT PRESENT
        // ======================================================
        if (!bank.account_bank_uuid) {

            const dup = await client.query(
                `SELECT 1
                 FROM account_bank_details
                 WHERE account_id = $1
                   AND account_type_id = $2
                   AND LOWER(beneficiary_name) = LOWER($3)
                   AND is_deleted = false
                   AND is_active = true`,
                [
                    account_id,
                    account_type_id,
                    bank.beneficiary_name
                ]
            );

            if (dup.rowCount > 0) {
                return {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2002,
                    message: "Updation failed",
                    error: `Bank details already exists`
                };

                //throw new Error(`Bank details already exists`);
            }

            await client.query(
                `INSERT INTO account_bank_details (
                    account_id,
                    account_type_id,
                    beneficiary_name,
                    bank_name,
                    branch_name,
                    account_number,
                    iban_number,
                    swift_code,
                    currency_id,
                    bank_document,
                    is_primary,
                    is_active,
                    created_by,
                    assigned_to

                )
                VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                    $11,$12,$13,$14
                )`,
                [
                    account_id,
                    account_type_id,
                    bank.beneficiary_name,
                    bank.bank_name,
                    bank.branch_name,
                    bank.account_number,
                    bank.iban_number,
                    bank.swift_code,
                    bank.currency_id,
                    bank.bank_document,
                    false,
                    true,
                    modified_by,
                    modified_by
                ]
            );

        } else {

            // ======================================================
            // UPDATE EXISTING RECORD
            // ======================================================
            const bankCheck = await client.query(
                `SELECT 1
                 FROM account_bank_details
                 WHERE account_bank_uuid = $1
                   AND account_id = $2
                   AND is_deleted = false`,
                [bank.account_bank_uuid, account_id]
            );

            if (bankCheck.rowCount === 0) {

                return {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2003,
                    message: "Record not found",
                    error: "Bank record not found"
                };

                //throw new Error("Bank record not found");
            }

            const dup = await client.query(
                `SELECT 1
                 FROM account_bank_details
                 WHERE account_id = $1
                   AND account_type_id = $2
                   AND LOWER(beneficiary_name) = LOWER($3)
                   AND is_deleted = false
                   AND is_active = true
                   AND account_bank_uuid <> $4`,
                [
                    account_id,
                    account_type_id,
                    bank.beneficiary_name,
                    bank.account_bank_uuid
                ]
            );

            if (dup.rowCount > 0) {

                return {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2002,
                    message: "Updation failed",
                    error: `Bank details already exists`
                };

                // throw new Error(`Bank details already exists`);
            }

            await client.query(
                `UPDATE account_bank_details SET
                    beneficiary_name = $1,
                    bank_name = $2,
                    branch_name = $3,
                    account_number = $4,
                    iban_number = $5,
                    swift_code = $6,
                    currency_id = $7,
                    bank_document = $8,
                    modified_by = $9,
                    is_primary = $10,
                    is_active = $11,
                    modified_at = now()
                 WHERE account_bank_uuid = $12`,
                [
                    bank.beneficiary_name,
                    bank.bank_name,
                    bank.branch_name,
                    bank.account_number,
                    bank.iban_number,
                    bank.swift_code,
                    bank.currency_id,
                    bank.bank_document,
                    modified_by,
                    bank.is_primary,
                    bank.is_active,
                    bank.account_bank_uuid
                ]
            );
        }
    }
}

// ---------------- MAIN UPDATE API ----------------

// responder.on('update-admin-buyer', async (req, cb) => {

//     const client = await pool.connect();

//     try {

//         const { account_type_name, body } = req;
//         const { buyer_account, addresses = [], documents = [], bank_details = [] } = body;

//         const modified_by = buyer_account.modified_by;

//         // ---------- IDENTITY EXPIRY DATE VALIDATION ----------
//         if (buyer_account.identity_expiry_date) {
//             const expiryDate = new Date(buyer_account.identity_expiry_date);
//             const today = new Date();

//             // Remove time part for accurate comparison
//             today.setHours(0, 0, 0, 0);

//             if (expiryDate <= today) {
//                 return cb(null, {
//                     header_type: "ERROR",
//                     message_visibility: true,
//                     status: false,
//                     code: 2001,
//                     message: "Validation failed",
//                     error: "Identity expiry date must be greater than today"
//                 });
//             }
//         }

//         // ---------- BUYER CODE UNIQUENESS CHECK ----------
//         let buyer_code = buyer_account.buyer_code;

//         const existing = await pool.query(
//             `SELECT 1 FROM buyer_accounts 
//      WHERE buyer_code = $1 
//        AND buyer_uuid <> $2`,
//             [buyer_code, buyer_account.buyer_uuid]
//         );

//         if (existing.rows.length > 0) {
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2001,
//                 message: "Validation failed",
//                 error: "Buyer code already exists"
//             });
//         }
//         await client.query("BEGIN");

//         /* ======================================================
//            CHECK EDIT LOCK 
//         ====================================================== */
//         const lockCheck = await client.query(
//             `
//             SELECT 1
//             FROM record_locks
//             WHERE table_name = 'buyer_accounts'
//               AND record_id = $1
//               AND locked_by = $2
//               AND is_deleted = FALSE
//               AND expires_at > NOW()
//             `,
//             [buyer_account.buyer_uuid, modified_by]
//         );

//         if (lockCheck.rowCount === 0) {
//             await client.query('ROLLBACK');
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2005,
//                 message: "You must lock the record before updating",
//                 error: "Edit lock missing or expired"
//             });
//         }


//         // account type
//         const accTypeRes = await client.query(
//             `SELECT account_type_id
//              FROM account_type
//              WHERE LOWER(name)=LOWER($1)`,
//             [account_type_name]
//         );

//         if (accTypeRes.rowCount === 0)
//             return {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2001,
//                 message: "Validation failed",
//                 error: "Invalid account type"
//             };

//         const account_type_id = accTypeRes.rows[0].account_type_id;

//         // user
//         const userRes = await client.query(
//             `SELECT user_id FROM users WHERE username=$1`,
//             [buyer_account.username]
//         );

//         if (userRes.rowCount === 0)
//             return {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2001,
//                 message: "Validation failed",
//                 error: "Invalid username"
//             };

//         const user_id = userRes.rows[0].user_id;

//         // buyer exists
//         const buyerCheck = await client.query(
//             `SELECT buyer_id
//      FROM buyer_accounts
//      WHERE buyer_uuid = $1
//        AND is_deleted = false
//        AND is_active = true`,
//             [buyer_account.buyer_uuid]
//         );

//         if (buyerCheck.rowCount === 0)
//             return {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2003,
//                 message: "Record not found",
//                 error: "Buyer record not found"
//             };

//         const account_id = buyerCheck.rows[0].buyer_id;


//         // duplicate validation
//         const dupBuyer = await client.query(
//             `SELECT 1 FROM buyer_accounts
//              WHERE user_id=$1
//                AND account_type_id=$2
//                AND is_deleted=false
//                AND is_active=true
//                AND buyer_uuid<>$3`,
//             [user_id, account_type_id, buyer_account.buyer_uuid]
//         );

//         if (dupBuyer.rowCount > 0)
//             return {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2002,
//                 message: "Updation failed",
//                 error: "Active buyer already exists for this user"
//             };


//         // ---------- BUYER CODE GAP CHECK ----------

//         // Get the max existing buyer code number
//     if (buyer_account.buyer_code) {

//         const result = await pool.query(
//             `SELECT MAX((regexp_replace(buyer_code, '\\D', '', 'g'))::int) AS max_num
//      FROM buyer_accounts
//      WHERE buyer_code IS NOT NULL AND is_deleted = false`
//         );

//         const maxNum = result.rows[0]?.max_num ?? 0;
//         const expectedNext = maxNum + 1;

//         // Extract number from submitted code
//         const submittedNum = parseInt(buyer_account.buyer_code.replace(/\D/g, ""), 10);

//         if (submittedNum !== expectedNext) {
//             const prefix = buyer_account.buyer_code.replace(/\d+$/, "");
//             const expectedCode = `${prefix}${String(expectedNext).padStart(5, "0")}`;
//             return cb(null, {
//                 header_type: "ERROR",
//                 message_visibility: true,
//                 status: false,
//                 code: 2001,
//                 message: "Validation failed",
//                 error: `Buyer code is not allowed. Next expected code is "${expectedCode}".`
//             });
//         }

//     }
//         // update buyer
//         await client.query(
//             `UPDATE buyer_accounts SET
//                 email_id=$1,
//                 business_name=$2,
//                 business_logo=$3,
//                 business_license_number=$4,
//                 modified_by=$5,
//                 user_id=$6,
//                 buyer_code=$7,
//                 has_multiple_branches=$8,
//                 registered_business_name=$9,
//                 subscription_id=$10,
//                 business_status=$11,
//                 product_type_id = $12,
// payment_mode_id = $13,
// trading_type_id = $14,
// registration_status = $15,
// fail_reason = $16,
// tax_registration_number = $17,
// has_trade_license = $18,
// identity_country_id = $19,
// identity_id_number = $20,
// identity_expiry_date = $21,
// identity_first_name = $22,
// identity_middle_name = $23,
// identity_last_name = $24,
// phone_country_code = $25,
// phone_number = $26,
// phone_number_verified = $27,
// t_and_c_acknowledge = $28,
// erp_id = $29,
// last_integrated_date = $30,
// is_active = $31,

//                 modified_at=now()
//              WHERE buyer_uuid=$32`,
//             [
//                 buyer_account.email_id,
//                 buyer_account.business_name,
//                 buyer_account.business_logo,
//                 buyer_account.business_license_number,
//                 modified_by,
//                 user_id,
//                 buyer_account.buyer_code,
//                 buyer_account.has_multiple_branches,
//                 buyer_account.registered_business_name,
//                 buyer_account.subscription_id,
//                 buyer_account.business_status,
//                 buyer_account.product_type_id,
//                 buyer_account.payment_mode_id,
//                 buyer_account.trading_type_id,
//                 buyer_account.registration_status,
//                 buyer_account.fail_reason,
//                 buyer_account.tax_registration_number,
//                 buyer_account.has_trade_license,
//                 buyer_account.identity_country_id,
//                 buyer_account.identity_id_number,
//                 buyer_account.identity_expiry_date,
//                 buyer_account.identity_first_name,
//                 buyer_account.identity_middle_name,
//                 buyer_account.identity_last_name,
//                 buyer_account.phone_country_code,
//                 buyer_account.phone_number,
//                 buyer_account.phone_number_verified,
//                 buyer_account.t_and_c_acknowledge,
//                 buyer_account.erp_id,
//                 buyer_account.last_integrated_date,
//                 buyer_account.is_active,
//                 buyer_account.buyer_uuid
//             ]
//         );

//         await updateAccountAddresses(client, { account_type_id, account_id, addresses, modified_by });
//         await updateAccountDocuments(client, { account_type_id, account_id, documents, modified_by });
//         await updateAccountBankDetails(client, { account_type_id, account_id, bank_details, modified_by });

//         /* ======================================================
//            AUTO-UNLOCK AFTER SUCCESS
//         ====================================================== */
//         await client.query(
//             `
//             UPDATE record_locks
//             SET is_deleted = TRUE,
//             deleted_by = $1,
//             deleted_at = NOW()
//             WHERE table_name = 'buyer_accounts'
//               AND record_id = $2
//               AND locked_by = $3
//               AND is_deleted = FALSE
//             `,
//             [modified_by, buyer_account.buyer_uuid, modified_by]
//         );


//         await client.query("COMMIT");

//         return cb(null, {
//             header_type: "SUCCESS",
//             message_visibility: true,
//             status: true,
//             code: 1000,
//             message: "Buyer updated successfully"
//         });

//     } catch (err) {

//         await client.query("ROLLBACK");

//         return cb(null, {
//             header_type: "ERROR",
//             message_visibility: true,
//             status: false,
//             code: 2004,
//             message: "Buyer update failed",
//             error: err.message
//         });

//     } finally {
//         client.release();
//     }
// });

responder.on('update-admin-buyer', async (req, cb) => {

    const client = await pool.connect();

    try {

        const { account_type_name, body } = req;
        const { buyer_account, addresses = [], documents = [], bank_details = [] } = body;

        const modified_by = buyer_account.modified_by;

        // ---------- IDENTITY EXPIRY DATE VALIDATION ----------
        if (buyer_account.identity_expiry_date) {
            const expiryDate = new Date(buyer_account.identity_expiry_date);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (expiryDate <= today) {
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "Identity expiry date must be greater than today"
                });
            }
        }

        await client.query("BEGIN");

        /* ======================================================
           CHECK EDIT LOCK
        ====================================================== */
        const lockCheck = await client.query(
            `
            SELECT 1
            FROM record_locks
            WHERE table_name = 'buyer_accounts'
              AND record_id = $1
              AND locked_by = $2
              AND is_deleted = FALSE
              AND expires_at > NOW()
            `,
            [buyer_account.buyer_uuid, modified_by]
        );

        if (lockCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2005,
                message: "You must lock the record before updating",
                error: "Edit lock missing or expired"
            });
        }

        // ---------- ACCOUNT TYPE ----------
        const accTypeRes = await client.query(
            `SELECT account_type_id
             FROM account_type
             WHERE LOWER(name) = LOWER($1)`,
            [account_type_name]
        );

        if (accTypeRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Invalid account type"
            });
        }

        const account_type_id = accTypeRes.rows[0].account_type_id;

        // ---------- USER ----------
        const userRes = await client.query(
            `SELECT user_id FROM users WHERE username = $1`,
            [buyer_account.username]
        );

        if (userRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Invalid username"
            });
        }

        const user_id = userRes.rows[0].user_id;

        // ---------- BUYER EXISTS ----------
        const buyerCheck = await client.query(
            `SELECT buyer_id
             FROM buyer_accounts
             WHERE buyer_uuid = $1
               AND is_deleted = FALSE
               AND is_active = TRUE`,
            [buyer_account.buyer_uuid]
        );

        if (buyerCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Buyer record not found"
            });
        }

        const account_id = buyerCheck.rows[0].buyer_id;

        // ---------- DUPLICATE VALIDATION ----------
        const dupBuyer = await client.query(
            `SELECT 1 FROM buyer_accounts
             WHERE user_id = $1
               AND account_type_id = $2
               AND is_deleted = FALSE
               AND is_active = TRUE
               AND buyer_uuid <> $3`,
            [user_id, account_type_id, buyer_account.buyer_uuid]
        );

        if (dupBuyer.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Updation failed",
                error: "Active buyer already exists for this user"
            });
        }

        // ---------- UPDATE BUYER (buyer_code excluded — read only) ----------
        await client.query(
            `UPDATE buyer_accounts SET
                email_id                    = $1,
                business_name               = $2,
                business_logo               = $3,
                business_license_number     = $4,
                modified_by                 = $5,
                user_id                     = $6,
                has_multiple_branches       = $7,
                registered_business_name    = $8,
                subscription_id             = $9,
                business_status             = $10,
                product_type_id             = $11,
                payment_mode_id             = $12,
                trading_type_id             = $13,
                registration_status         = $14,
                fail_reason                 = $15,
                tax_registration_number     = $16,
                has_trade_license           = $17,
                identity_country_id         = $18,
                identity_id_number          = $19,
                identity_expiry_date        = $20,
                identity_first_name         = $21,
                identity_middle_name        = $22,
                identity_last_name          = $23,
                phone_country_code          = $24,
                phone_number                = $25,
                phone_number_verified       = $26,
                t_and_c_acknowledge         = $27,
                erp_id                      = $28,
                last_integrated_date        = $29,
                is_active                   = $30,
                modified_at                 = NOW()
             WHERE buyer_uuid = $31`,
            [
                buyer_account.email_id,
                buyer_account.business_name,
                buyer_account.business_logo,
                buyer_account.business_license_number,
                modified_by,
                user_id,
                buyer_account.has_multiple_branches,
                buyer_account.registered_business_name,
                buyer_account.subscription_id,
                buyer_account.business_status,
                buyer_account.product_type_id,
                buyer_account.payment_mode_id,
                buyer_account.trading_type_id,
                buyer_account.registration_status,
                buyer_account.fail_reason,
                buyer_account.tax_registration_number,
                buyer_account.has_trade_license,
                buyer_account.identity_country_id,
                buyer_account.identity_id_number,
                buyer_account.identity_expiry_date,
                buyer_account.identity_first_name,
                buyer_account.identity_middle_name,
                buyer_account.identity_last_name,
                buyer_account.phone_country_code,
                buyer_account.phone_number,
                buyer_account.phone_number_verified,
                buyer_account.t_and_c_acknowledge,
                buyer_account.erp_id,
                buyer_account.last_integrated_date,
                buyer_account.is_active,
                buyer_account.buyer_uuid
            ]
        );

        await updateAccountAddresses(client, { account_type_id, account_id, addresses, modified_by });
        await updateAccountDocuments(client, { account_type_id, account_id, documents, modified_by });
        await updateAccountBankDetails(client, { account_type_id, account_id, bank_details, modified_by });

        /* ======================================================
           AUTO-UNLOCK AFTER SUCCESS
        ====================================================== */
        await client.query(
            `
            UPDATE record_locks
            SET is_deleted  = TRUE,
                deleted_by  = $1,
                deleted_at  = NOW()
            WHERE table_name = 'buyer_accounts'
              AND record_id  = $2
              AND locked_by  = $3
              AND is_deleted = FALSE
            `,
            [modified_by, buyer_account.buyer_uuid, modified_by]
        );

        await client.query("COMMIT");

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Buyer updated successfully"
        });

    } catch (err) {

        await client.query("ROLLBACK");

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Buyer update failed",
            error: err.message
        });

    } finally {
        client.release();
    }
});

// --------------------------------------------------
// ADMIN - BUYER MANAGEMENT - LIST BY ID 
// --------------------------------------------------

responder.on('listbyidwithlock-admin-buyer', async (req, cb) => {

    const client = await pool.connect();

    try {

        const { buyer_uuid } = req;
        const mode = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;


        if (!buyer_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "buyer uuid is required"
            });
        }

        await client.query('BEGIN');

        // ---------------- FETCH BUYER ----------------
        const buyerRes = await client.query(
            `SELECT *
             FROM buyer_accounts
             WHERE buyer_uuid = $1
               AND is_deleted = false
               AND is_active = true`,
            [buyer_uuid]
        );

        if (buyerRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                status: true,
                code: 2003,
                message: "No active buyer found",
                data: {}
            });
        }

        const buyer = buyerRes.rows[0];

        // ---------------- LOCK HANDLING ----------------
        let lockRow = null;

        if (mode === 'edit') {

            if (!user_id) {
                await client.query('ROLLBACK');
                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "user id required for edit mode"
                });
            }

            const lockRes = await client.query(
                `SELECT RL.*, U.username AS locked_by_name
                 FROM record_locks RL
                 LEFT JOIN users U ON U.user_uuid = RL.locked_by
                 WHERE RL.table_name = 'buyer_accounts'
                   AND RL.record_id = $1
                   AND RL.is_deleted = false`,
                [buyer_uuid]
            );

            lockRow = lockRes.rows[0];
            const isExpired = lockRow &&
                new Date(lockRow.expires_at).getTime() < Date.now();

            if (lockRow && lockRow.locked_by !== user_id && !isExpired) {
                await client.query('ROLLBACK');
                return cb(null, {
                    status: false,
                    code: 2005,
                    message: `Record is locked by ${lockRow.locked_by_name}`
                });
            }

            if (lockRow && isExpired) {
                await client.query(
                    `UPDATE record_locks SET is_deleted=true,
                    deleted_by = $1,
                    deleted_at = NOW() 
                    WHERE lock_id=$2`,
                    [user_id, lockRow.lock_id]
                );
                lockRow = null;
            }

            if (!lockRow) {
                const newLock = await client.query(
                    `INSERT INTO record_locks(
                        table_name,record_id,locked_by,expires_at,created_by
                    )
                    VALUES(
                        'buyer_accounts',$1,$2,
                        NOW() + ($3 || ' minute')::INTERVAL,$2
                    )
                    RETURNING *`,
                    [buyer_uuid, user_id, LOCK_MINUTES]
                );
                lockRow = newLock.rows[0];
            }
            else if (lockRow.locked_by === user_id) {
                const refresh = await client.query(
                    `UPDATE record_locks
                     SET expires_at = NOW() + ($2 || ' minute')::INTERVAL
                     WHERE lock_id=$1
                     RETURNING *`,
                    [lockRow.lock_id, LOCK_MINUTES]
                );
                lockRow = refresh.rows[0];
            }
        }

        // ---------------- FETCH ADDRESSES ----------------
        const addrRes = await client.query(
            `SELECT *
             FROM account_addresses
             WHERE account_id = $1
               AND account_type_id = $2
               AND is_deleted = false
            AND is_active = true
             ORDER BY created_at ASC`,
            [buyer.buyer_id, buyer.account_type_id]
        );

        // ---------------- FETCH DOCUMENTS ----------------
        const docRes = await client.query(
            `SELECT *
             FROM account_documents
             WHERE account_id = $1
               AND account_type_id = $2
               AND is_deleted = false
               AND is_active = true
             ORDER BY created_at ASC`,
            [buyer.buyer_id, buyer.account_type_id]
        );

        // ---------------- FETCH BANK DETAILS ----------------
        const bankRes = await client.query(
            `SELECT *
             FROM account_bank_details
             WHERE account_id = $1
               AND account_type_id = $2
               AND is_deleted = false
                AND is_active = true
             ORDER BY created_at ASC`,
            [buyer.buyer_id, buyer.account_type_id]
        );

        await client.query('COMMIT');

        buyer.lock_status =
            lockRow && new Date(lockRow.expires_at).getTime() >= Date.now();

        return cb(null, {
            header_type: "SUCCESS",
            status: true,
            code: 1000,
            message: "Buyer details fetched successfully",
            data: {
                buyer,
                addresses: addrRes.rows,
                documents: docRes.rows,
                bank_details: bankRes.rows
            }
        });

    } catch (err) {

        await client.query('ROLLBACK');

        return cb(null, {
            header_type: "ERROR",
            status: false,
            code: 2004,
            message: err.message
        });

    } finally {
        client.release();
    }
});


// --------------------------------------------------
// DELETE BUYER 
// --------------------------------------------------

responder.on('delete-admin-buyer', async (req, cb) => {
    const client = await pool.connect();

    try {
        const buyer_uuid = req.buyer_uuid;
        const deleted_by = req.body?.deleted_by;

        if (!buyer_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "buyer uuid is required"
            });
        }

        await client.query('BEGIN');

        /* ======================================================
           FETCH BUYER ID
        ====================================================== */
        const buyerRes = await client.query(
            `
            SELECT buyer_id
            FROM buyer_accounts
            WHERE buyer_uuid = $1
              AND is_deleted = FALSE
            `,
            [buyer_uuid]
        );

        if (buyerRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Buyer not found",
                error: "Invalid buyer uuid"
            });
        }

        const buyer_id = buyerRes.rows[0].buyer_id;
        console.log("buyer_id", buyer_id);


        /* ======================================================
           CHECK RECORD LOCK
        ====================================================== */
        const lockCheck = await client.query(
            `
            SELECT 1
            FROM record_locks
            WHERE table_name = 'buyer_accounts'
              AND record_id = $1
              AND is_deleted = FALSE
              AND expires_at > NOW()
            `,
            [buyer_uuid]
        );

        if (lockCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2005,
                message: "Record locked",
                error: "Buyer record is currently locked"
            });
        }

        /* ======================================================
           SOFT DELETE BUYER MAIN
        ====================================================== */
        await client.query(
            `
            UPDATE buyer_accounts
            SET is_deleted = TRUE,
                is_active = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
            WHERE buyer_uuid = $2
            `,
            [deleted_by, buyer_uuid]
        );

        /* ======================================================
           SOFT DELETE CHILD TABLES
        ====================================================== */
        await client.query(
            `
            UPDATE account_addresses
            SET is_deleted = TRUE,
                is_active = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
            WHERE account_id = $2
            `,
            [deleted_by, buyer_id]
        );

        await client.query(
            `
            UPDATE account_bank_details
            SET is_deleted = TRUE,
                is_active = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
            WHERE account_id = $2
            `,
            [deleted_by, buyer_id]
        );

        await client.query(
            `
            UPDATE account_documents
            SET is_deleted = TRUE,
                is_active = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
            WHERE account_id = $2
            `,
            [deleted_by, buyer_id]
        );



        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Buyer deleted successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (delete buyer):", err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    } finally {
        client.release();
    }
});


/* ======================================================
   ADVANCED FILTER — BUYER
====================================================== */
responder.on('advancefilter-buyer', async (req, cb) => {
    try {

        const accessScope = req.dataAccessScope;
        let extraWhere = '';
        let extraParams = [];

        // If PRIVATE → only show own created data
        if (accessScope && accessScope.type === 'PRIVATE') {
            extraWhere = ' AND M.created_by = $extraUser';
            extraParams.push(accessScope.user_id);
        }

        const result = await buildAdvancedSearchQuery({
            pool,
            reqBody: req.body,

            table: 'buyer_accounts',
            alias: 'M',
            defaultSort: 'created_at',

            joinSql: `
                LEFT JOIN users creators ON M.created_by = creators.user_uuid
                LEFT JOIN users updaters ON M.modified_by = updaters.user_uuid
            `,

            allowedFields: [
                'user_id',
                'buyer_code',
                'email_id',
                'phone_number',
                'is_active',
                'created_at',
                'modified_at',
                'createdByName',
                'updatedByName'
            ],

            customFields: {
                createdByName: {
                    select: 'creators.username',
                    search: 'creators.username',
                    sort: 'creators.username'
                },
                updatedByName: {
                    select: 'updaters.username',
                    search: 'updaters.username',
                    sort: 'updaters.username'
                }
            },

            baseWhere: `
                M.is_deleted = FALSE ${extraWhere}
            `,
            baseParams: extraParams
        });

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Buyer details fetched successfully",
            error: null,
            result
        });

    } catch (err) {
        logger.error("Advance Filter Error:", err);
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    }
});


/* ======================================================
    PHONE NUMBER VERIFICATION
====================================================== */

responder.on('verify-number', async (req, cb) => {
    const client = await pool.connect();

    try {
        const buyer_uuid = req.buyer_uuid;
        const modified_by = req.body?.modified_by;
        const { phone_number_verified, phone_number, phone_country_code } = req.body;

        /* ======================================================
           VALIDATION
        ====================================================== */
        if (!buyer_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "buyer uuid is required"
            });
        }

        if (!phone_number) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "phone number is required"
            });
        }

        if (!phone_country_code) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "phone country code is required"
            });
        }
        await client.query('BEGIN');

        /* ======================================================
           CHECK BUYER EXISTS
        ====================================================== */
        const check = await client.query(
            `
            SELECT buyer_id,phone_number, phone_country_code 
            FROM buyer_accounts 
            WHERE buyer_uuid = $1 
              AND is_deleted = FALSE 
              AND is_active = TRUE
            `,
            [buyer_uuid]
        );

        if (check.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Buyer not found",
                error: "Invalid buyer uuid"
            });
        }


        const buyer = check.rows[0];

        /* ======================================================
           CHECK PHONE NUMBER MATCH
        ====================================================== */
        if (
            buyer.phone_number !== phone_number ||
            buyer.phone_country_code !== phone_country_code
        ) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2006,
                message: "Phone number does not match",
                error: "Provided phone number or country code does not match buyer record"
            });
        }

        /* ======================================================
           CHECK RECORD LOCK
        ====================================================== */
        const lockCheck = await client.query(
            `
            SELECT 1
            FROM record_locks
            WHERE table_name = 'buyer_accounts'
              AND record_id = $1
              AND locked_by = $2
              AND is_deleted = FALSE
              AND expires_at > NOW()
            `,
            [buyer_uuid, modified_by]
        );

        if (lockCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2005,
                message: "You must lock the record before updating",
                error: "Edit lock missing or expired"
            });
        }

        /* ======================================================
           UPDATE VERIFICATION STATUS
        ====================================================== */
        await client.query(
            `
            UPDATE buyer_accounts
            SET phone_number_verified = $1,
                modified_by = $2,
                modified_at = NOW()
            WHERE buyer_uuid = $3
            `,
            [phone_number_verified, modified_by, buyer_uuid]
        );


        /* ======================================================
           AUTO-UNLOCK AFTER SUCCESS
        ====================================================== */
        await client.query(
            `
            UPDATE record_locks
            SET is_deleted = TRUE,
            deleted_by = $1,
            deleted_at = NOW()
            WHERE table_name = 'buyer_accounts'
              AND record_id = $2
              AND locked_by = $3
              AND is_deleted = FALSE
            `,
            [modified_by, buyer_uuid, modified_by]
        );


        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Buyer verification status updated successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (verify number):", err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// UNLOCK BUYER (record_locks based)
// --------------------------------------------------


responder.on('unlock-admin-buyer', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { uuid } = req;
        const user_id = req.body?.user_id;

        if (!user_id) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "User ID required",
                error: "User ID missing"
            });
        }

        await client.query('BEGIN');

        // Delete lock only if same user owns it

        const result = await client.query(
            `
            DELETE FROM record_locks
            WHERE table_name = 'buyer_accounts'
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

        // Success
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Record unlocked successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// FORGOT PASSWORD 
// --------------------------------------------------
responder.on('forgotpassword-buyer', async (req, cb) => {
    try {
        const { username } = req.body;


        if (!username) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Username is required"
            });
        }

        // 1. Check user exist
        const checkUser = await pool.query(
            `SELECT user_uuid,email,user_id, username FROM users 
             WHERE username = $1 AND is_active = TRUE AND is_deleted = FALSE`,
            [username]
        );

        if (checkUser.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "User not found"
            });
        }

        const user = checkUser.rows[0];
        var emailid = user.email;
        var commonURL = APP_CONFIG.AngularRedirectURL;


        // -----------------------------
        // CHECK PHONE NUMBER VERIFIED  
        // -----------------------------
        const buyerAccRes = await pool.query(
            `SELECT buyer_id 
             FROM buyer_accounts 
             WHERE user_id = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            [user.user_id]
        );

        if (buyerAccRes.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Buyer account not found"
            });
        }

        const buyerResult = await pool.query(
            `SELECT phone_number_verified 
             FROM buyer_accounts 
             WHERE user_id = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            [user.user_id]
        );

        if (!buyerResult.rows[0].phone_number_verified) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Buyer account must be verified before password reset"
            });
        }

        // encrypting
        var encrypted_loginID = user.user_uuid;
        var encrypted_username = username;


        var subject = "Reset Forgot Password";
        var content = `Dear ` + username + `,` + '<br/>' + `<br/> You have requested for a password reset.
    Please  <a href="`+ commonURL + `?AXHLKDNZVK=` + encrypted_loginID + `&PXBQFODBTI=` + true + `&OTZHSFGSKC=` + encrypted_username + `">click </a>
     here to reset the password.<br/><br/> Thanks and Best Regards,  <br/> From German Experts.`
        var objmail = {
            subject: subject,
            content: content,
            description: "",
            tomail: emailid
            //tomail: "chitra.k@germanexperts.ae"
        }

        await sendmail(objmail).then(
            async result => {
                return cb(null, {
                    header_type: "SUCCESS",
                    message_visibility: true,
                    status: true,
                    code: 1000,
                    message: "Email sent successfully!",
                    error: null
                });
            })



    } catch (err) {
        logger.error("Responder Error (forgotpassword-buyer):", err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    }
});


// --------------------------------------------------
// RESET PASSWORD 
// --------------------------------------------------
responder.on('changepassword-buyer', async (req, cb) => {
    try {
        const { user_uuid, old_password, new_password, confirm_password } = req.body;
        // -----------------------------
        // VALIDATION
        // -----------------------------
        if (!user_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "User UUID is required"
            });
        }

        if (!old_password || !new_password || !confirm_password) {

            return {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "All fields are required"
            };
        }

        if (new_password !== confirm_password) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2002,
                message: "Password change failed",
                error: 'Passwords do not match'
            });
        }

        // -----------------------------
        // FETCH USER
        // -----------------------------
        const userResult = await pool.query(
            `SELECT user_id, password_hash,email,username, is_active 
             FROM users 
             WHERE user_uuid = $1 AND is_deleted = false`,
            [user_uuid]
        );

        if (userResult.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "User not found"
            });
        }

        const user = userResult.rows[0];
        var emailid = user.email;

        if (!user.is_active) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: 'User inactive'
            });
        }

        // -----------------------------
        // CHECK PHONE NUMBER VERIFIED  
        // -----------------------------
        const buyerResult = await pool.query(
            `SELECT phone_number_verified 
             FROM buyer_accounts 
             WHERE user_id = $1 AND is_deleted = FALSE AND is_active = TRUE`,
            [user.user_id]
        );

        if (buyerResult.rowCount === 0) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Record not found",
                error: "Buyer account not found"
            });
        }

        if (!buyerResult.rows[0].phone_number_verified) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Buyer account must be verified before password reset"
            });
        }

        // -----------------------------
        // VERIFY OLD PASSWORD
        // -----------------------------
        const match = await bcrypt.compare(old_password, user.password_hash);
        if (!match) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "Old password is incorrect"
            });
        }

        // -----------------------------
        // HASH NEW PASSWORD
        // -----------------------------
        const newPasswordHash = await bcrypt.hash(new_password, 10);

        // -----------------------------
        // UPDATE PASSWORD
        // -----------------------------
        await pool.query(
            `UPDATE users 
             SET password_hash = $1, modified_at = now(),
             modified_by = $2 
             WHERE user_id = $3`,
            [newPasswordHash, user_uuid, user.user_id]
        );

        // 1. Check Users Login Details
        const checkUser = await pool.query(
            `SELECT login_uuid,user_id, login_id FROM users_login 
             WHERE user_id = $1 AND is_active = TRUE AND is_deleted = FALSE`,
            [user.user_id]
        );
        const sessionuser = checkUser.rows[0];

        // Close previous active sessions
        await pool.query(
            `UPDATE user_session
             SET is_active = false, end_time = NOW()
             WHERE login_id = $1 AND is_active = true`,
            [sessionuser.login_id]
        );

        await pool.query(
            `UPDATE users SET is_online = false WHERE user_id = $1`,
            [user.user_id]
        );


        var subject = "New Password Added";
        var content = "Dear " + user.username + "," + '<br/>' + '<br/>' + "New Password   " + "'" + new_password + "'" + " " + "Added Successfully .Please Login with new password." + '<br/>' + '<br/>' + "Thanks and Best Regards," + '<br/>' + '<br/>' + "From German Experts.";
        var objmail = {
            subject: subject,
            content: content,
            description: "",
            tomail: emailid
            //tomail: "chitra.k@germanexperts.ae"
        }

        await sendmail(objmail).then(
            async result => {
                console.log("result", result);

                // -----------------------------
                // RESPONSE
                // -----------------------------
                return cb(null, {
                    header_type: "SUCCESS",
                    message_visibility: true,
                    status: true,
                    code: 1000,
                    message: 'Password changed successfully. Please login again.'
                });
            })



    } catch (err) {
        logger.error("Responder Error (changepassword-users):", err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    }
});

// -----------------------------
// GENERATE NEXT BUYER CODE
// -----------------------------

responder.on('generate-code-buyer', async (req, cb) => {
    try {
      
        const prefixRes = await pool.query(
            `SELECT prefix_code FROM prefix_refno
             WHERE table_name = 'buyer_accounts' AND is_active = true AND is_deleted = false
             ORDER BY created_at DESC LIMIT 1`
        );
        const prefix = prefixRes.rows[0]?.prefix_code || "BYR";

        const result = await pool.query(
            `SELECT buyer_code FROM buyer_accounts
             WHERE buyer_code IS NOT NULL 
             ORDER BY (regexp_replace(buyer_code, '\\D', '', 'g'))::int DESC
             LIMIT 1`
        );
        const lastCode = result.rows[0]?.buyer_code || null;

        let nextCode;
        if (!lastCode) {
            nextCode = `${prefix}00001`;
        } else {
            const match = lastCode.match(/\d+$/);
            const number = match ? parseInt(match[0], 10) : 0;
            nextCode = `${prefix}${(number + 1).toString().padStart(5, "0")}`;
        }

        // -----------------------------
        // RESPONSE
        // -----------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: true,
            status: true,
            code: 1000,
            message: "Buyer code generated successfully.",
            data: { buyer_code: nextCode }
        });

    } catch (err) {
        logger.error("Responder Error (generate-code-buyer):", err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: err.message,
            error: err.message
        });
    }
});