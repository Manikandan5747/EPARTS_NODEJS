require('module-alias/register');
const cote = require('cote');
const pool = require('@libs/db/postgresql_index');
const logger = require('@libs/logger/logger');
const path = require("path");
const uploadDir = path.join('/app/assets', 'cms');
const fs = require("fs");

// REDIS CONNECTION & COTE RESPONDER SETUP
const redisHost = process.env.COTE_DISCOVERY_REDIS_HOST || '127.0.0.1';
const redisPort = process.env.COTE_DISCOVERY_REDIS_PORT || 6379;

const responder = new cote.Responder({
    name: 'cms responder',
    key: 'cms',
    redis: { host: redisHost, port: redisPort }
});


// --------------------------------------------------
// CMS - FILE SAVE 
// --------------------------------------------------

// ================= FILE NAME GENERATOR =================

function generateFileName(file, section_key, filetype_name) {
    const ext = path.extname(file.name).toLowerCase();
    const name = path.basename(file.name, ext);

    const safeSectionKey = section_key
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^a-z0-9_-]/g, "");

    const safeFileTypeName = filetype_name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^a-z0-9_-]/g, "");

return `${safeSectionKey}_${safeFileTypeName}_${name}${ext}`;
}

// ================= API =================

responder.on("cms-filesave", async (req, cb) => {

    const client = await pool.connect();

    try {

let { section_key, filetype_name, page_key } = req.body;

section_key = section_key?.toLowerCase();
filetype_name = filetype_name?.toLowerCase();
page_key = page_key?.toLowerCase();
        const file = req.files?.file;

        /* ======================================================
           VALIDATION
        ====================================================== */
const pageKeyRes = await client.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1)
       AND is_active = TRUE
       AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid page key`
    });
}

const page_key_id = pageKeyRes.rows[0].page_key_id;

        if (!section_key) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "section key is required"
            });
        }
if (section_key !== "company profile") {

    const sectionKeyRes = await client.query(
        `SELECT section_key_id 
         FROM section_key 
         WHERE LOWER(name) = LOWER($1) 
           AND page_key_id = $2
           AND is_active = TRUE
           AND is_deleted = FALSE`,
        [section_key, page_key_id]
    );

    if (sectionKeyRes.rowCount === 0) {
        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2001,
            message: "Validation failed",
            error: `Invalid section key '${section_key}'`
        });
    }
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

        if (!filetype_name) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "filetype name is required"
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
            "image/gif",
            "video/mp4",
            "video/webm",
            "video/quicktime"
        ];

        if (!allowedMimeTypes.includes(file.type)) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Invalid file type",
                error: "Only image, gif and video files are allowed"
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

        // limit for GIF
        if (file.type === "image/gif" && file.size > 10 * 1024 * 1024) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "GIF size should not exceed 10MB"
            });
        }

        /* ======================================================
           FILE SAVE
        ====================================================== */

        const newFileName = generateFileName(file, section_key, filetype_name);
        const finalPath = path.join(uploadDir, newFileName).replace(/\\/g, '/');

        // Move file
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
                file_path: finalPath
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
// DELETE CMS 
// --------------------------------------------------

responder.on('delete-cms', async (req, cb) => {
    const client = await pool.connect();

    try {
        const item_uuid = req.item_uuid;
        const deleted_by = req.body?.deleted_by;

        if (!item_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "UUID is required"
            });
        }

        await client.query('BEGIN');

        /* ======================================================
           CHECK ITEM + FETCH PAGE UUID
        ====================================================== */
        const itemRes = await client.query(
            `
            SELECT 
                si.item_id,
                p.page_uuid
            FROM section_items si
            JOIN page_sections ps ON ps.section_id = si.section_id
            JOIN pages p ON p.page_id = ps.page_id
            WHERE si.item_uuid = $1
              AND si.is_deleted = FALSE
            `,
            [item_uuid]
        );

        if (itemRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2003,
                message: "Item not found",
                error: "Item does not exist or already deleted"
            });
        }

        const page_uuid = itemRes.rows[0].page_uuid;

        /* ======================================================
           CHECK PAGE LOCK
        ====================================================== */
        const lockCheck = await client.query(
            `
            SELECT 1
            FROM record_locks
            WHERE table_name = 'pages'
              AND record_id = $1
              AND is_deleted = FALSE
              AND expires_at > NOW()
              AND locked_by <> $2
            `,
            [page_uuid,deleted_by]
        );

        if (lockCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2005,
                message: "Item cannot be deleted",
                error: "Record is currently locked"
            });
        }

    const selfLockCheck = await client.query(
    `
    SELECT 1
    FROM record_locks
    WHERE table_name = 'pages'
      AND record_id = $1
      AND is_deleted = FALSE
      AND expires_at > NOW()
      AND locked_by = $2
    `,
    [page_uuid, deleted_by]
);

if (selfLockCheck.rowCount === 0) {
    await client.query('ROLLBACK');
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2005,
        message: "You must lock the page before deleting",
        error: "Lock missing or expired"
    });
}

        /* ======================================================
           SOFT DELETE ITEM
        ====================================================== */
        await client.query(
            `
            UPDATE section_items
            SET is_deleted = TRUE,
                is_active = FALSE,
                deleted_by = $1,
                deleted_at = NOW()
            WHERE item_uuid = $2
            `,
            [deleted_by, item_uuid]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: "Item deleted successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error("Responder Error (delete item):", err);

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
// ADMIN - HOME 
// --------------------------------------------------


responder.on('create-home', async (req, cb) => {

    const client = await pool.connect();

    try {
        const { page_key, body } = req;
        const { page, sections = [], company_info } = body;
        const created_by = page.created_by;
        const assigned_to = created_by;

        // -----------------------------
        // BASIC VALIDATION
        // -----------------------------
        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page key is required"
            });
        }

const pageKeyRes = await client.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}

const page_key_id = pageKeyRes.rows[0].page_key_id;

        await client.query('BEGIN');

        // -----------------------------
        // CHECK EXISTING ACTIVE HOME PAGE
        // -----------------------------
        const activeHomeCheck = await client.query(
            `SELECT 1 
             FROM pages 
             WHERE LOWER(page_key) = LOWER($1) 
               AND is_active = TRUE AND is_deleted = FALSE`,
                 [page_key]
        );

        if (activeHomeCheck.rowCount > 0) {
            return cb(null, {
                "header_type": "ERROR",
                "message_visibility": true,
                "status": false,
                "code": 2002,
                "message": "CMS home page creation failed",
                "error": "Home Page already exists"
            });
        }


        // -----------------------------
        // CHECK EXISTING PAGE (INACTIVE) AND ITS RELATED DATA
        // -----------------------------
        const existingPage = await client.query(
            `SELECT page_id, is_active, is_deleted FROM pages WHERE LOWER(page_key) = LOWER($1) ORDER BY created_at DESC LIMIT 1`,
            [page_key]
        );

        if (existingPage.rowCount > 0) {
            const pageData = existingPage.rows[0];

            // If existing page is inactive
            if (!pageData.is_active || pageData.is_deleted === true) {

                // Check if there are any active sections
                const activeSections = await client.query(
                    `SELECT 1 FROM page_sections 
             WHERE page_id = $1 AND is_active = TRUE AND is_deleted = FALSE LIMIT 1`,
                    [pageData.page_id]
                );

                // Check if there are any active items
                const activeItems = await client.query(
                    `SELECT 1 FROM section_items si
             JOIN page_sections ps ON si.section_id = ps.section_id
             WHERE ps.page_id = $1 AND si.is_active = TRUE AND si.is_deleted = FALSE LIMIT 1`,
                    [pageData.page_id]
                );

                if (activeSections.rowCount > 0 || activeItems.rowCount > 0) {
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2001,
                        message: "Validation failed",
                        error: "Cannot insert because inactive page has active sections or items"
                    });
                }
            }
        }
        // -----------------------------
        // INSERT PAGE
        // -----------------------------

        const insertPage = await client.query(
            `INSERT INTO pages
             (page_key, page_title, slug, is_active, sort_order, created_by, assigned_to, created_at, assigned_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
             RETURNING page_id`,
            [
                page_key,
                page.page_title,
                page.slug,
                page.is_active,
                page.sort_order,
                created_by,
                assigned_to
            ]
        );

        const page_id = insertPage.rows[0].page_id;

        // -----------------------------
        // COMPANY INFO
        // -----------------------------
        if (company_info) {
            const activeCompanyRes = await client.query(
                `SELECT 1 FROM cms_company_info WHERE is_active = TRUE AND is_deleted = FALSE LIMIT 1`
            );

            if (activeCompanyRes.rowCount > 0) {
                return cb(null, {
                    "header_type": "ERROR",
                    "message_visibility": true,
                    "status": false,
                    "code": 2002,
                    "message": "Company info creation failed",
                    "error": "Company info already exists"
                });

            }

            await client.query(
                `INSERT INTO cms_company_info
                 (company_name, description, support_email, contact_number, logo, ssl, master_card, visa, erp,
                  footer_text, copyright,
                  is_active, created_by, assigned_to, created_at, assigned_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())`,
                [
                    company_info.company_name,
                    company_info.description,
                    company_info.support_email,
                    company_info.contact_number,
                    company_info.logo,
                    company_info.ssl,
                    company_info.master_card,
                    company_info.visa,
                    company_info.erp,
                    company_info.footer_text,
                    company_info.copyright,
                    company_info.is_active,
                    created_by,
                    assigned_to
                ]
            );
        }

        // -----------------------------
        // SECTIONS & ITEMS
        // -----------------------------
        for (const section of sections) {

            const sectionKeyRes = await client.query(
    `SELECT section_key_id 
     FROM section_key 
     WHERE LOWER(name) = LOWER($1) 
       AND page_key_id = $2 
       AND is_active = TRUE
       AND is_deleted = FALSE`,
    [section.section_key, page_key_id]
);

if (sectionKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid section key '${section.section_key}'`
    });
}

            const secCheck = await client.query(
                `SELECT section_id 
                 FROM page_sections 
                 WHERE page_id=$1 AND section_key=$2 AND is_active=TRUE AND is_deleted = FALSE`,
                [page_id, section.section_key]
            );

            if (secCheck.rowCount > 0) {
                return cb(null, {
                    "header_type": "ERROR",
                    "message_visibility": true,
                    "status": false,
                    "code": 2002,
                    "message": "Section creation failed",
                    "error": "Section already exists"
                });
            }

            const insertSection = await client.query(
                `INSERT INTO page_sections
                 (page_id, section_key, section_type, title, content, image, video,
                  button_label, button_url, section_limit,
                  is_active, sort_order, playstore_link, playstore_image,
                  appstore_link, appstore_image,
                  created_by, assigned_to, created_at, assigned_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())
                 RETURNING section_id, section_limit`,
                [
                    page_id,
                    section.section_key,
                    section.section_type,
                    section.title,
                    section.content,
                    section.image,
                    section.video,
                    section.button_label,
                    section.button_url,
                    section.section_limit,
                    section.is_active,
                    section.sort_order,
                    section.playstore_link,
                    section.playstore_image,
                    section.appstore_link,
                    section.appstore_image,
                    created_by,
                    assigned_to
                ]
            );

            const { section_id, section_limit } = insertSection.rows[0];

            const valid =
                (section.section_type === 'single' && section_limit === null) ||
                (section.section_type === 'multiple' && section_limit !== null && section_limit !== 0);

            if (!valid) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "For 'single' section type, section limit must be null. For 'multiple' section type, section limit is required."
                });
            }

            if (section_limit === null && section.items?.length > 0) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "Items are not allowed when section limit is null"
                });
            }

            if (section_limit !== null && section.items.length > section_limit) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: `Only ${section_limit} items allowed for section ${section.section_key}`
                });
            }

            for (const item of section.items || []) {

                const itemCheck = await client.query(
                    `SELECT 1 
                     FROM section_items 
                     WHERE section_id=$1 AND title=$2 AND is_active=TRUE AND is_deleted = FALSE`,
                    [section_id, item.title]
                );

                if (itemCheck.rowCount > 0) {

                    return cb(null, {
                        "header_type": "ERROR",
                        "message_visibility": true,
                        "status": false,
                        "code": 2002,
                        "message": "Item creation failed",
                        "error": "Item already exists"
                    });
                }

                await client.query(
                    `INSERT INTO section_items
                     (section_id, title, content, image, icon, filetype,
                      sort_order, is_active, created_by, assigned_to, created_at, assigned_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
                    [
                        section_id,
                        item.title,
                        item.content,
                        item.image,
                        item.icon,
                        item.filetype,
                        item.sort_order,
                        item.is_active,
                        created_by,
                        assigned_to
                    ]
                );
            }
        }

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: "CMS home page created successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('CMS Error:', err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "CMS home page creation failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});

responder.on('update-home', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { page_key, body } = req;
        const { page, sections = [], company_info } = body;

        const modified_by = page?.modified_by || null;

        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page key is required"
            });
        }

        if (!page?.page_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page uuid is required for update"
            });
        }

        const pageKeyRes = await client.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}

const page_key_id = pageKeyRes.rows[0].page_key_id;

        await client.query('BEGIN');

        /* ======================================================
           CHECK EDIT LOCK (PAGE LEVEL)
        ====================================================== */
        const lockCheck = await client.query(
            `
            SELECT 1
            FROM record_locks
            WHERE table_name = 'pages'
              AND record_id = $1
              AND locked_by = $2
              AND is_deleted = FALSE
              AND expires_at > NOW()
            `,
            [page.page_uuid, modified_by]
        );

        if (lockCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2005,
                message: "You must lock the page before updating",
                error: "Edit lock missing or expired"
            });
        }

        /* ======================================================
           PAGE VALIDATION
        ====================================================== */
        const pageRes = await client.query(
            `
            SELECT page_id, is_active, is_deleted
            FROM pages
            WHERE page_uuid = $1
            `,
            [page.page_uuid]
        );

        if (pageRes.rowCount === 0) {

             return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page UUID"
    };
            //throw new Error('Invalid page UUID');
        }

        if (!pageRes.rows[0].is_active) {
                 return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Inactive page cannot be updated"
    };
            //throw new Error('Inactive page cannot be updated');
        }

        if (pageRes.rows[0].is_deleted) {
                 return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Deleted page cannot be updated"
    };
            //throw new Error('Deleted page cannot be updated');
        }

        const page_id = pageRes.rows[0].page_id;

        /* ======================================================
           PAGE UPDATE
        ====================================================== */
        await client.query(
            `
            UPDATE pages
            SET page_title = $1,
                slug = $2,
                sort_order = $3,
                is_active = $4,
                modified_by = $5,
                modified_at = NOW()
            WHERE page_uuid = $6
            `,
            [
                page.page_title,
                page.slug,
                page.sort_order,
                page.is_active,
                modified_by,
                page.page_uuid
            ]
        );

        /* ======================================================
           COMPANY INFO UPDATE
        ====================================================== */
        if (company_info?.cms_company_info_uuid) {

            const companyRes = await client.query(
                `
                SELECT is_active, is_deleted
                FROM cms_company_info
                WHERE cms_company_info_uuid = $1
                `,
                [company_info.cms_company_info_uuid]
            );

            if (
                companyRes.rowCount === 0 ||
                !companyRes.rows[0].is_active ||
                companyRes.rows[0].is_deleted
            ) {
                     return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Cannot update inactive or invalid company info"
    };
                //throw new Error('Cannot update inactive or invalid company info');
            }

            await client.query(
                `
                UPDATE cms_company_info
                SET company_name = $1,
                    description = $2,
                    support_email = $3,
                    contact_number = $4,
                    logo = $5,
                    ssl = $6,
                    master_card = $7,
                    visa = $8,
                    erp = $9,
                    footer_text = $10,
                    copyright = $11,
                    is_active = $12,
                    modified_by = $13,
                    modified_at = NOW()
                WHERE cms_company_info_uuid = $14
                `,
                [
                    company_info.company_name,
                    company_info.description,
                    company_info.support_email,
                    company_info.contact_number,
                    company_info.logo,
                    company_info.ssl,
                    company_info.master_card,
                    company_info.visa,
                    company_info.erp,
                    company_info.footer_text,
                    company_info.copyright,
                    company_info.is_active,
                    modified_by,
                    company_info.cms_company_info_uuid
                ]
            );
        }

/* ======================================================
   SECTIONS & ITEMS UPDATE / INSERT
====================================================== */
for (const section of sections) {

    
    const sectionKeyRes = await client.query(
    `SELECT section_key_id 
     FROM section_key 
     WHERE LOWER(name) = LOWER($1) 
       AND page_key_id = $2 
       AND is_active = TRUE
       AND is_deleted = FALSE`,
    [section.section_key, page_key_id]
);

if (sectionKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid section key '${section.section_key}'`
    });
}


    let section_id;
    let section_limit;

    if (section.section_uuid) {

        const secRes = await client.query(
            `
            SELECT section_id, section_limit, is_active, is_deleted
            FROM page_sections
            WHERE section_uuid = $1
            `,
            [section.section_uuid]
        );

        if (
            secRes.rowCount === 0 ||
            !secRes.rows[0].is_active ||
            secRes.rows[0].is_deleted
        ) {
                 return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid or inactive section UUID"
    };
            //throw new Error('Invalid or inactive section UUID');
        }

        section_id = secRes.rows[0].section_id;
        //section_limit = secRes.rows[0].section_limit;

    } 
    //else {
       // section_limit = section.section_limit;
    //}

    // -----------------------------
    // SECTION TYPE VALIDATION
    // -----------------------------
    if (section.section_type === 'single') {
        if (section.section_limit !== null)
            return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section ${section.section_key} is single type; section limit must be null`
    });
            // throw new Error(`Section ${section.section_key} is single type; section limit must be null`);

        if ((section.items || []).length > 0)
             return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section ${section.section_key} is single type; no items allowed`
    });
            // throw new Error(`Section ${section.section_key} is single type; no items allowed`);

    } else if (section.section_type === 'multiple') {

        if (section.section_limit === null || section.section_limit <= 0)
             return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section ${section.section_key} is multiple type; section limit must have a positive value`
    });
            // throw new Error(`Section ${section.section_key} is multiple type; section limit must have a positive value`);

        if ((section.items || []).length > section.section_limit)
             return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Only ${section.section_limit} items allowed for section ${section.section_key}`
    });
            // throw new Error(`Only ${section.section_limit} items allowed for section ${section.section_key}`);

    } else {
         return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid section type ${section.section_type} for section ${section.section_key}`
    });
        // throw new Error(`Invalid section type ${section.section_type} for section ${section.section_key}`);
    }


     // -----------------------------
    // DUPLICATE SECTION CHECK
    // -----------------------------
    const duplicateSectionRes = await client.query(
        `
        SELECT 1
        FROM page_sections
        WHERE page_id = $1
          AND LOWER(section_key) = LOWER($2)
          AND is_deleted = FALSE
        AND is_active = TRUE
          AND ($3::uuid IS NULL OR section_uuid != $3)
        `,
        [
            page_id,
            section.section_key,
            section.section_uuid || null
        ]
    );
 if (duplicateSectionRes.rowCount > 0) {
      return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2002,
        message: "Updation failed",
        error: `Section ${section.section_key} already exists`
    });
    }

    // -----------------------------
    // UPDATE / INSERT SECTION
    // -----------------------------
    if (section.section_uuid) {

        await client.query(
            `
            UPDATE page_sections
            SET section_key = $1,
                section_type = $2,
                title = $3,
                content = $4,
                image = $5,
                video = $6,
                button_label = $7,
                button_url = $8,
                section_limit = $9,
                is_active = $10,
                sort_order = $11,
                playstore_link = $12,
                playstore_image = $13,
                appstore_link = $14,
                appstore_image = $15,
                modified_by = $16,
                modified_at = NOW()
            WHERE section_uuid = $17
            `,
            [
                section.section_key,
                section.section_type,
                section.title,
                section.content,
                section.image,
                section.video,
                section.button_label,
                section.button_url,
                section.section_limit,
                section.is_active,
                section.sort_order,
                section.playstore_link,
                section.playstore_image,
                section.appstore_link,
                section.appstore_image,
                modified_by,
                section.section_uuid
            ]
        );
        section_limit = section.section_limit;

    } 
    
    else {

        const insertSectionRes = await client.query(
            `
            INSERT INTO page_sections (
                section_uuid,
                page_id,
                section_key,
                section_type,
                title,
                content,
                image,
                video,
                button_label,
                button_url,
                section_limit,
                is_active,
                sort_order,
                playstore_link,
                playstore_image,
                appstore_link,
                appstore_image,
                created_by,
                assigned_to,
                created_at
            )
            VALUES (
                gen_random_uuid(),
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                $12,
                $13,
                $14,
                $15,
                $16,
                $17,
                $18,
                NOW()
            )
            RETURNING section_id
            `,
            [
                page_id,
                section.section_key,
                section.section_type,
                section.title,
                section.content,
                section.image,
                section.video,
                section.button_label,
                section.button_url,
                section.section_limit,
                section.is_active,
                section.sort_order,
                section.playstore_link,
                section.playstore_image,
                section.appstore_link,
                section.appstore_image,
                modified_by,
                modified_by

            ]
        );

        section_id = insertSectionRes.rows[0].section_id;
        section_limit = section.section_limit;
    }

    /* ---------- SECTION LIMIT VALIDATION ---------- */
    if (section_limit === null && section.items?.length > 0) {

           return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2002,
        message: "updation failed",
        error: `Items not allowed for section ${section.section_key}`
    });
    }

    if (section_limit !== null && (section.items || []).length > section_limit) {
        return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Only ${section_limit} items are allowed for section ${section.section_key}`
    });
        // throw new Error(`Only ${section_limit} items allowed for section ${section.section_key}`);
    }

    /* ---------- ITEMS UPDATE / INSERT ---------- */
    for (const item of section.items || []) {

        const duplicateItemRes = await client.query(
            `
            SELECT 1
            FROM section_items
            WHERE section_id = $1
              AND LOWER(title) = LOWER($2)
              AND is_deleted = FALSE
              AND is_active = TRUE
              AND ($3::uuid IS NULL OR item_uuid != $3)
            `,
            [
                section_id,
                item.title,
                item.item_uuid || null
            ]
        );

        if (duplicateItemRes.rowCount > 0) {
               return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2002,
        message: "Updation failed",
        error: `Item ${item.title} already exists for this section`
    });
           // throw new Error(`Item ${item.title} already exists for this section`);
        }

        if (item.item_uuid) {

            const itemRes = await client.query(
                `
                SELECT is_active, is_deleted
                FROM section_items
                WHERE item_uuid = $1
                `,
                [item.item_uuid]
            );

            if (
                itemRes.rowCount === 0 ||
                !itemRes.rows[0].is_active ||
                itemRes.rows[0].is_deleted
            ) {
                return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid or inactive item UUID"
    };
               // throw new Error('Invalid or inactive item UUID');
            }

            await client.query(
                `
                UPDATE section_items
                SET title = $1,
                    content = $2,
                    image = $3,
                    icon = $4,
                    filetype = $5,
                    sort_order = $6,
                    is_active = $7,
                    modified_by = $8,
                    modified_at = NOW()
                WHERE item_uuid = $9
                `,
                [
                    item.title,
                    item.content,
                    item.image,
                    item.icon,
                    item.filetype,
                    item.sort_order,
                    item.is_active,
                    modified_by,
                    item.item_uuid
                ]
            );

        } else {

            await client.query(
                `
                INSERT INTO section_items (
                    item_uuid,
                    section_id,
                    title,
                    content,
                    image,
                    icon,
                    filetype,
                    sort_order,
                    is_active,
                    created_by,
                    assigned_to,
                    created_at
                )
                VALUES (
                    gen_random_uuid(),
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    $10,
                    NOW()
                )
                `,
                [
                    section_id,
                    item.title,
                    item.content,
                    item.image,
                    item.icon,
                    item.filetype,
                    item.sort_order,
                    item.is_active,
                    modified_by,
                    modified_by
                ]
            );
        }
    }
}


        /* ======================================================
           AUTO-UNLOCK AFTER SUCCESS
        ====================================================== */
        await client.query(
            `
            UPDATE record_locks
            SET is_deleted = TRUE,
            deleted_by = $1,
            deleted_at = NOW()
            WHERE table_name = 'pages'
              AND record_id = $2
              AND locked_by = $3
              AND is_deleted = FALSE
            `,
            [modified_by,page.page_uuid,modified_by]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: "CMS home page updated successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('CMS home page update Error:', err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "CMS home page update failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});


responder.on('listbyidwithlock-home', async (req, cb) => {

      const client = await pool.connect();
      

    try {

        const { page_uuid } = req;
        const mode = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;

        if (!page_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: 'page uuid is required'
            });
        }
 await client.query('BEGIN');

        // -----------------------------
        // FETCH PAGE (ACTIVE ONLY)
        // -----------------------------
        const pageRes = await client.query(
            `SELECT
                p.page_id,
                p.page_uuid,
                p.page_key,
                p.page_title,
                p.slug,
                p.is_active,
                p.sort_order,
                p.assigned_to,
                p.assigned_at,
                p.created_at,
                p.created_by,
                p.modified_at,
                p.modified_by,
                p.deleted_at,
                p.deleted_by,
                p.is_deleted,
                creators.username AS createdByName,
                updaters.username AS updatedByName
             FROM pages p
             LEFT JOIN users creators ON p.created_by = creators.user_uuid
             LEFT JOIN users updaters ON p.modified_by = updaters.user_uuid
             WHERE p.page_uuid = $1
               AND p.is_deleted = FALSE
             ORDER BY p.sort_order ASC, p.created_at ASC`,
            [page_uuid]
        );

        if (pageRes.rowCount === 0) {
             await client.query('ROLLBACK');
            return cb(null, {
                header_type: "SUCCESS",
                message_visibility: true,
                status: true,
                code: 2003,
                message: 'No active record found',
                data: []
            });
        }

        const page = pageRes.rows[0];

        // -----------------------------
        // EDIT MODE → LOCK HANDLING
        // -----------------------------
        let lockRow = null;
        if (mode === 'edit') {
            if (!user_id) {
                await client.query('ROLLBACK');
                return cb(null, {
                    status: false,
                    code: 2001,
                    error: "User ID required for edit"
                });
            }

            // Check existing lock
            const lockResult = await client.query(
                `SELECT RL.*, U.username AS locked_by_name
                 FROM record_locks RL
                 LEFT JOIN users U ON U.user_uuid = RL.locked_by
                 WHERE RL.table_name = 'pages'
                   AND RL.record_id = $1
                   AND RL.is_deleted = FALSE`,
                [page.page_uuid]
            );

            lockRow = lockResult.rows[0];
            const isExpired = lockRow && new Date(lockRow.expires_at).getTime() < Date.now();

            // Locked by another active user
            if (lockRow && lockRow.locked_by !== user_id && !isExpired) {
                await client.query('ROLLBACK');
                return cb(null, {
                    status: false,
                    code: 2008,
                    error: `This record is currently being edited by ${lockRow.locked_by_name || 'another user'}.`
                });
            }

            // Soft-delete expired lock
            if (lockRow && isExpired) {
                await client.query(
                    `UPDATE record_locks SET is_deleted = TRUE,
                    deleted_by = $1,
                    deleted_at = NOW() 
                    WHERE lock_id = $2`,
                    [user_id,lockRow.lock_id]
                );
                lockRow = null;
            }

            // Create new lock
            if (!lockRow) {
                
                const insertLock = await client.query(
                    `INSERT INTO record_locks (
                        table_name,
                        record_id,
                        locked_by,
                        expires_at,
                        created_by
                    )
                    VALUES (
                        'pages',
                        $1,
                        $2,
                        NOW() + ($3 || ' minute')::INTERVAL,
                        $2
                    )
                    RETURNING *`,
                    [page.page_uuid, user_id, LOCK_MINUTES]
                );
                lockRow = insertLock.rows[0];
            }

            // Refresh lock if same user
            else if (lockRow.locked_by === user_id) {
                const refresh = await client.query(
                    `UPDATE record_locks
                     SET expires_at = NOW() + ($2 || ' minute')::INTERVAL
                     WHERE lock_id = $1
                     RETURNING *`,
                    [lockRow.lock_id, LOCK_MINUTES]
                );
                lockRow = refresh.rows[0];
            }
        }


        // -----------------------------
        // FETCH SECTIONS (ACTIVE ONLY)
        // -----------------------------
        const sectionsRes = await client.query(
            `SELECT *
             FROM page_sections
             WHERE page_id = $1
               AND is_deleted = FALSE
             ORDER BY sort_order ASC`,
            [page.page_id]
        );

        let sections = sectionsRes.rows;

        // -----------------------------
        // FETCH ITEMS ONLY FOR MULTIPLE SECTIONS
        // -----------------------------
        const multipleSections = sections.filter(
            section => section.section_type === 'multiple'
        );

        if (multipleSections.length > 0) {
            const sectionIds = multipleSections.map(s => s.section_id);

            const itemsRes = await client.query(
                `
        SELECT *
        FROM section_items
        WHERE section_id = ANY($1)
          AND is_deleted = FALSE
        ORDER BY sort_order ASC
        `,
                [sectionIds]
            );

            // Group items by section_id
            const itemsBySection = {};
            for (const item of itemsRes.rows) {
                if (!itemsBySection[item.section_id]) {
                    itemsBySection[item.section_id] = [];
                }
                itemsBySection[item.section_id].push(item);
            }

            // Attach items to sections
            sections = sections.map(section => ({
                ...section,
                items:
                    section.section_type === 'multiple'
                        ? itemsBySection[section.section_id] || []
                        : []   // single → no items
            }));
        } else {
            // No multiple sections → all get empty items
            sections = sections.map(section => ({
                ...section,
                items: []
            }));
        }

        // -----------------------------
        // FETCH COMPANY INFO
        // -----------------------------
        const companyRes = await client.query(
            `
            SELECT
            cms_company_info_id,
            cms_company_info_uuid,
                company_name,
                description,
                support_email,
                contact_number,
                logo,
                ssl,
                master_card,
                visa,
                erp,
                footer_text,
                is_active,
                copyright
            FROM cms_company_info
            WHERE is_deleted = FALSE
              AND is_active = TRUE
            ORDER BY created_at DESC
            LIMIT 1
            `
        );

        const company_info = companyRes.rowCount > 0
            ? companyRes.rows[0]
            : {};

        await client.query('COMMIT');

        // Attach lock status to page
        page.lock_status = lockRow && new Date(lockRow.expires_at).getTime() >= Date.now();

        // -----------------------------
        // FINAL RESPONSE
        // -----------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: 'CMS home page data fetched successfully',
            data: {
                page,
                sections,
                company_info
            }
        });

    } catch (err) {
         await client.query('ROLLBACK');
        logger.error('CMS home page list Error:', err);
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
// ADMIN - ABOUT US 
// --------------------------------------------------


responder.on('create-aboutus', async (req, cb) => {

    const client = await pool.connect();

    try {
        const { page_key, body } = req;
        const { page, sections = [] } = body;

        const created_by = page.created_by;
        const assigned_to = created_by;

        // -----------------------------
        // BASIC VALIDATION
        // -----------------------------
        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page key is required"
            });
        }

     
const pageKeyRes = await client.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}

const page_key_id = pageKeyRes.rows[0].page_key_id;


        await client.query('BEGIN');

        // -----------------------------
        // CHECK EXISTING ACTIVE ABOUT US PAGE
        // -----------------------------
        const activeAboutUsCheck = await client.query(
            `SELECT 1 
             FROM pages 
             WHERE LOWER(page_key) = LOWER($1)
               AND is_active = TRUE AND is_deleted = FALSE`,
               [page_key]
        );

        if (activeAboutUsCheck.rowCount > 0) {
            return cb(null, {
                "header_type": "ERROR",
                "message_visibility": true,
                "status": false,
                "code": 2002,
                "message": "CMS about us page creation failed",
                "error": "About Us Page already exists"
            });
        }


        // -----------------------------
        // CHECK EXISTING PAGE (INACTIVE) AND ITS RELATED DATA
        // -----------------------------
        const existingPage = await client.query(
            `SELECT page_id, is_active, is_deleted FROM pages WHERE LOWER(page_key) = LOWER($1)   ORDER BY created_at DESC LIMIT 1`,[page_key]
        );

        if (existingPage.rowCount > 0) {
            const pageData = existingPage.rows[0];

            // If existing page is inactive
            if (!pageData.is_active || pageData.is_deleted === true) {

                // Check if there are any active sections
                const activeSections = await client.query(
                    `SELECT 1 FROM page_sections 
             WHERE page_id = $1 AND is_active = TRUE AND is_deleted = FALSE LIMIT 1`,
                    [pageData.page_id]
                );

                // Check if there are any active items
                const activeItems = await client.query(
                    `SELECT 1 FROM section_items si
             JOIN page_sections ps ON si.section_id = ps.section_id
             WHERE ps.page_id = $1 AND si.is_active = TRUE AND si.is_deleted = FALSE LIMIT 1`,
                    [pageData.page_id]
                );

                if (activeSections.rowCount > 0 || activeItems.rowCount > 0) {
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2001,
                        message: "Validation failed",
                        error: "Cannot insert because inactive page has active sections or items"
                    });
                }
            }
        }
        // -----------------------------
        // INSERT PAGE
        // -----------------------------

        const insertPage = await client.query(
            `INSERT INTO pages
             (page_key, page_title, slug, is_active, sort_order, created_by, assigned_to, created_at, assigned_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
             RETURNING page_id`,
            [
                page_key,
                page.page_title,
                page.slug,
                page.is_active,
                page.sort_order,
                created_by,
                assigned_to
            ]
        );

        const page_id = insertPage.rows[0].page_id;

        // -----------------------------
        // SECTIONS & ITEMS
        // -----------------------------
        for (const section of sections) {

            const sectionKeyRes = await client.query(
    `SELECT section_key_id 
     FROM section_key 
     WHERE LOWER(name) = LOWER($1) 
       AND page_key_id = $2 
       AND is_active = TRUE
       AND is_deleted = FALSE`,
    [section.section_key, page_key_id]
);

if (sectionKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid section key '${section.section_key}'`
    });
}

            const secCheck = await client.query(
                `SELECT section_id 
                 FROM page_sections 
                 WHERE page_id=$1 AND section_key=$2 AND is_active=TRUE AND is_deleted = FALSE`,
                [page_id, section.section_key]
            );

            if (secCheck.rowCount > 0) {
                return cb(null, {
                    "header_type": "ERROR",
                    "message_visibility": true,
                    "status": false,
                    "code": 2002,
                    "message": "Section creation failed",
                    "error": "Section already exists"
                });
            }

            const insertSection = await client.query(
                `INSERT INTO page_sections
                 (page_id, section_key, section_type, title, content, image, video,
                  button_label, button_url, section_limit,
                  is_active, sort_order, 
                  created_by, assigned_to, created_at, assigned_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
                 RETURNING section_id, section_limit`,
                [
                    page_id,
                    section.section_key,
                    section.section_type,
                    section.title,
                    section.content,
                    section.image,
                    section.video,
                    section.button_label,
                    section.button_url,
                    section.section_limit,
                    section.is_active,
                    section.sort_order,
                    created_by,
                    assigned_to
                ]
            );

            const { section_id, section_limit } = insertSection.rows[0];

            const valid =
                (section.section_type === 'single' && section_limit === null) ||
                (section.section_type === 'multiple' && section_limit !== null && section_limit !== 0);

            if (!valid) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "For 'single' section type, section limit must be null. For 'multiple' section type, section limit is required."
                });
            }

            if (section_limit === null && section.items?.length > 0) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "Items are not allowed when section limit is null"
                });
            }

            if (section_limit !== null && section.items.length > section_limit) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: `Only ${section_limit} items allowed for section ${section.section_key}`
                });
            }

            for (const item of section.items || []) {

                const itemCheck = await client.query(
                    `SELECT 1 
                     FROM section_items 
                     WHERE section_id=$1 AND title=$2 AND is_active=TRUE AND is_deleted = FALSE`,
                    [section_id, item.title]
                );

                if (itemCheck.rowCount > 0) {

                    return cb(null, {
                        "header_type": "ERROR",
                        "message_visibility": true,
                        "status": false,
                        "code": 2002,
                        "message": "Item creation failed",
                        "error": "Item already exists"
                    });
                }

                await client.query(
                    `INSERT INTO section_items
                     (section_id, title, content, image, icon, filetype,
                      sort_order, is_active, created_by, assigned_to, created_at, assigned_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
                    [
                        section_id,
                        item.title,
                        item.description,
                        item.image,
                        item.icon,
                        item.filetype,
                        item.sort_order,
                        item.is_active,
                        created_by,
                        assigned_to
                    ]
                );
            }
        }

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: "CMS about us page created successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('CMS Error:', err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "CMS about us page creation failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});


responder.on('update-aboutus', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { page_key, body } = req;
        const { page, sections = [] } = body;
        const modified_by = page.modified_by || null;

        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page key is required"
            });
        }

        if (!page?.page_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page uuid is required for update"
            });
        }

        const pageKeyRes = await client.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}

const page_key_id = pageKeyRes.rows[0].page_key_id;


        await client.query('BEGIN');

        /* ======================================================
           CHECK EDIT LOCK
        ====================================================== */
        const lockCheck = await client.query(
            `
            SELECT 1
            FROM record_locks
            WHERE table_name = 'pages'
              AND record_id = $1
              AND locked_by = $2
              AND is_deleted = FALSE
              AND expires_at > NOW()
            `,
            [page.page_uuid, modified_by]
        );

        if (lockCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2005,
                message: "You must lock the page before updating",
                error: "Edit lock missing or expired"
            });
        }

        /* ======================================================
           PAGE VALIDATION
        ====================================================== */
        const pageRes = await client.query(
            `SELECT page_id, is_active, is_deleted
             FROM pages
             WHERE page_uuid = $1`,
            [page.page_uuid]
        );
const page_id = pageRes.rows[0].page_id;
        if (pageRes.rowCount === 0) {
                return cb(null,{
         header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2001,
            message: "Validation failed",
            error: "Invalid page UUID"
    });

            //throw new Error('Invalid page UUID');
        }

        if (!pageRes.rows[0].is_active || pageRes.rows[0].is_deleted) {
            return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Inactive or deleted page cannot be updated"
    };
            //throw new Error('Inactive or deleted page cannot be updated');
        }

        await client.query(
            `UPDATE pages
             SET page_title = $1,
                 slug = $2,
                 sort_order = $3,
                 is_active = $4,
                 modified_by = $5,
                 modified_at = NOW()
             WHERE page_uuid = $6`,
            [
                page.page_title,
                page.slug,
                page.sort_order,
                page.is_active,
                modified_by,
                page.page_uuid
            ]
        );

/* ======================================================
   SECTIONS & ITEMS UPDATE / INSERT
====================================================== */
for (const section of sections) {

    
    const sectionKeyRes = await client.query(
    `SELECT section_key_id 
     FROM section_key 
     WHERE LOWER(name) = LOWER($1) 
       AND page_key_id = $2 
       AND is_active = TRUE
       AND is_deleted = FALSE`,
    [section.section_key, page_key_id]
);

if (sectionKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid section key '${section.section_key}'`
    });
}


    let section_id;

    /* ======================================================
       DUPLICATE SECTION CHECK
    ====================================================== */
    const duplicateSectionRes = await client.query(
        `
        SELECT 1
        FROM page_sections
        WHERE page_id = $1
          AND LOWER(section_key) = LOWER($2)
          AND is_deleted = FALSE
          AND ($3::uuid IS NULL OR section_uuid != $3)
        `,
        [
            page_id,
            section.section_key,
            section.section_uuid || null
        ]
    );

    if (duplicateSectionRes.rowCount > 0) {
          return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2002,
        message: "Updation failed",
        error: `Section ${section.section_key} already exists`
    });
        // throw new Error(

        //     `Section ${section.section_key} already exists`
        // );
    }

    /* ======================================================
       SECTION VALIDATION
    ====================================================== */
    const items = section.items || [];

    if (section.section_type === 'single') {

        if (section.section_limit !== null) {
            return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section limit must be null for single section ${section.section_key}`
    };
            // throw new Error(
            //     `section limit must be null for single section ${section.section_key}`
            // );
        }

        if (items.length > 0) {

        return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Items are not allowed for single section ${section.section_key}`
    });
            // throw new Error(
            //     `Items are not allowed for single section ${section.section_key}`
            // );
        }
    }

    if (section.section_type === 'multiple') {

        if (
            section.section_limit === null ||
            isNaN(section.section_limit) ||
            section.section_limit <= 0
        ) {
            return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section limit must be greater than 0 for multiple section ${section.section_key}`
    };

            // throw new Error(
            //     `section limit must be greater than 0 for multiple section ${section.section_key}`
            // );
        }

        if (items.length > section.section_limit) {
            return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Section validation failed",
        error: `Only ${section.section_limit} items allowed for section ${section.section_key}`
    };
            // throw new Error(
            //     `Only ${section.section_limit} items allowed for section ${section.section_key}`
            // );
        }
    }

    /* ======================================================
       UPDATE EXISTING SECTION
    ====================================================== */
    if (section.section_uuid) {

        const secRes = await client.query(
            `
            SELECT section_id, is_active, is_deleted
            FROM page_sections
            WHERE section_uuid = $1
            `,
            [section.section_uuid]
        );

        if (
            secRes.rowCount === 0 ||
            !secRes.rows[0].is_active ||
            secRes.rows[0].is_deleted
        ) {

              return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid or inactive section"
    });
            //throw new Error(`Invalid or inactive section`);
        }

        section_id = secRes.rows[0].section_id;

        await client.query(
            `
            UPDATE page_sections
            SET section_key = $1,
                section_type = $2,
                title = $3,
                content = $4,
                image = $5,
                video = $6,
                button_label = $7,
                button_url = $8,
                section_limit = $9,
                is_active = $10,
                sort_order = $11,
                modified_by = $12,
                modified_at = NOW()
            WHERE section_uuid = $13
            `,
            [
                section.section_key,
                section.section_type,
                section.title,
                section.content,
                section.image,
                section.video,
                section.button_label,
                section.button_url,
                section.section_limit,
                section.is_active,
                section.sort_order,
                modified_by,
                section.section_uuid
            ]
        );
        section_limit = section.section_limit;

    } 
    else {

        /* ======================================================
           INSERT NEW SECTION
        ====================================================== */
        const insertSectionRes = await client.query(
            `
            INSERT INTO page_sections (
                section_uuid,
                page_id,
                section_key,
                section_type,
                title,
                content,
                image,
                video,
                button_label,
                button_url,
                section_limit,
                is_active,
                sort_order,
                created_by,
                assigned_to,
                created_at
            )
            VALUES (
                gen_random_uuid(),
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                $12,
                $13,
                $14,
                NOW()
            )
            RETURNING section_id
            `,
            [
                page_id,
                section.section_key,
                section.section_type,
                section.title,
                section.content,
                section.image,
                section.video,
                section.button_label,
                section.button_url,
                section.section_limit,
                section.is_active,
                section.sort_order,
                modified_by,
                modified_by
            ]
        );

        section_id = insertSectionRes.rows[0].section_id;
        section_limit = section.section_limit;
    }


     /* ---------- SECTION LIMIT VALIDATION ---------- */
    if (section_limit === null && section.items?.length > 0) {

         return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Items not allowed for section ${section.section_key}`
    });
        //throw new Error(`Items not allowed for section ${section.section_key}`);
    }

    if (section_limit !== null && (section.items || []).length > section_limit) {

         return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Only ${section_limit} items are allowed for section ${section.section_key}`
    };
        // throw new Error(`Only ${section_limit} items allowed for section ${section.section_key}`);
    }

    /* ======================================================
       ITEMS UPDATE / INSERT (MULTIPLE ONLY)
    ====================================================== */
    //if (section.section_type === 'multiple') {
     
    for (const item of items) {

            /* ======================================================
               DUPLICATE ITEM CHECK
            ====================================================== */
            const duplicateItemRes = await client.query(
                `
                SELECT 1
                FROM section_items
                WHERE section_id = $1
                  AND LOWER(title) = LOWER($2)
                  AND is_deleted = FALSE
                  AND ($3::uuid IS NULL OR item_uuid != $3)
                `,
                [
                    section_id,
                    item.title,
                    item.item_uuid || null
                ]
            );

            if (duplicateItemRes.rowCount > 0) {

                   return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2002,
        message: "Updation failed",
        error: `Item ${item.title} already exists for this section`
    });

                // throw new Error(
                //     `Item ${item.title} already exists for this section`
                // );
            }

            /* ======================================================
               UPDATE EXISTING ITEM
            ====================================================== */
            if (item.item_uuid) {

                const itemRes = await client.query(
                    `
                    SELECT is_active, is_deleted
                    FROM section_items
                    WHERE item_uuid = $1
                    `,
                    [item.item_uuid]
                );

                if (
                    itemRes.rowCount === 0 ||
                    !itemRes.rows[0].is_active ||
                    itemRes.rows[0].is_deleted
                ) {
                    return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid or inactive item"
    };
                   // throw new Error(`Invalid or inactive item`);
                }

                await client.query(
                    `
                    UPDATE section_items
                    SET title = $1,
                        content = $2,
                        image = $3,
                        icon = $4,
                        filetype = $5,
                        sort_order = $6,
                        is_active = $7,
                        modified_by = $8,
                        modified_at = NOW()
                    WHERE item_uuid = $9
                    `,
                    [
                        item.title,
                        item.description,
                        item.image,
                        item.icon,
                        item.filetype,
                        item.sort_order,
                        item.is_active,
                        modified_by,
                        item.item_uuid
                    ]
                );

            } else {

                /* ======================================================
                   INSERT NEW ITEM
                ====================================================== */
                await client.query(
                    `
                    INSERT INTO section_items (
                        item_uuid,
                        section_id,
                        title,
                        content,
                        image,
                        icon,
                        filetype,
                        sort_order,
                        is_active,
                        created_by,
                        assigned_to,
                        created_at
                    )
                    VALUES (
                        gen_random_uuid(),
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $7,
                        $8,
                        $9,
                        $10,
                        NOW()
                    )
                    `,
                    [
                        section_id,
                        item.title,
                        item.description,
                        item.image,
                        item.icon,
                        item.filetype,
                        item.sort_order,
                        item.is_active,
                        modified_by,
                        modified_by
                    ]
                );
            }
        }
    //}
}

        /* ======================================================
           AUTO UNLOCK
        ====================================================== */
        await client.query(
            `
            UPDATE record_locks
            SET is_deleted = TRUE,
                deleted_by = $1,
                deleted_at = NOW()
            WHERE table_name = 'pages'
              AND record_id = $2
              AND locked_by = $1
              AND is_deleted = FALSE
            `,
            [modified_by, page.page_uuid]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: "CMS about us page updated successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('CMS about us page update Error:', err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "CMS about us page update failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});


responder.on('listbyidwithlock-aboutus', async (req, cb) => {

      const client = await pool.connect();
      

    try {

        const { page_uuid } = req;
        const mode = req.body?.mode;
        const user_id = req.body?.user_id;


        const LOCK_MINUTES = 1;

        if (!page_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: 'page uuid is required'
            });
        }
 await client.query('BEGIN');

        // -----------------------------
        // FETCH PAGE (ACTIVE ONLY)
        // -----------------------------
        const pageRes = await client.query(
            `SELECT
                p.page_id,
                p.page_uuid,
                p.page_key,
                p.page_title,
                p.slug,
                p.is_active,
                p.sort_order,
                p.assigned_to,
                p.assigned_at,
                p.created_at,
                p.created_by,
                p.modified_at,
                p.modified_by,
                p.deleted_at,
                p.deleted_by,
                p.is_deleted,
                creators.username AS createdByName,
                updaters.username AS updatedByName
             FROM pages p
             LEFT JOIN users creators ON p.created_by = creators.user_uuid
             LEFT JOIN users updaters ON p.modified_by = updaters.user_uuid
             WHERE p.page_uuid = $1
               AND p.is_deleted = FALSE
             ORDER BY p.sort_order ASC, p.created_at ASC`,
            [page_uuid]
        );

        if (pageRes.rowCount === 0) {
             await client.query('ROLLBACK');
            return cb(null, {
                header_type: "SUCCESS",
                message_visibility: true,
                status: true,
                code: 2003,
                message: 'No active record found',
                data: []
            });
        }

        const page = pageRes.rows[0];

        // -----------------------------
        // EDIT MODE → LOCK HANDLING
        // -----------------------------
        let lockRow = null;
        if (mode === 'edit') {
            if (!user_id) {
                await client.query('ROLLBACK');
                return cb(null, {
                    status: false,
                    code: 2001,
                    error: "User ID required for edit"
                });
            }

            // Check existing lock
            const lockResult = await client.query(
                `SELECT RL.*, U.username AS locked_by_name
                 FROM record_locks RL
                 LEFT JOIN users U ON U.user_uuid = RL.locked_by
                 WHERE RL.table_name = 'pages'
                   AND RL.record_id = $1
                   AND RL.is_deleted = FALSE`,
                [page.page_uuid]
            );

            lockRow = lockResult.rows[0];
            
            const isExpired = lockRow && new Date(lockRow.expires_at).getTime() < Date.now();

            // Locked by another active user
            if (lockRow && lockRow.locked_by !== user_id && !isExpired) {
                await client.query('ROLLBACK');
                return cb(null, {
                    status: false,
                    code: 2008,
                    error: `This record is currently being edited by ${lockRow.locked_by_name || 'another user'}.`
                });
            }

            // Soft-delete expired lock
            if (lockRow && isExpired) {
                await client.query(
                    `UPDATE record_locks SET is_deleted = TRUE ,
                                        deleted_by = $1,
                    deleted_at = NOW() 
                    WHERE lock_id = $2`,
                    [user_id,lockRow.lock_id]
                );
                lockRow = null;
            }

            // Create new lock
            if (!lockRow) {
                
                const insertLock = await client.query(
                    `INSERT INTO record_locks (
                        table_name,
                        record_id,
                        locked_by,
                        expires_at,
                        created_by
                    )
                    VALUES (
                        'pages',
                        $1,
                        $2,
                        NOW() + ($3 || ' minute')::INTERVAL,
                        $2
                    )
                    RETURNING *`,
                    [page.page_uuid, user_id, LOCK_MINUTES]
                );
                lockRow = insertLock.rows[0];
            }

            // Refresh lock if same user
            else if (lockRow.locked_by === user_id) {
                const refresh = await client.query(
                    `UPDATE record_locks
                     SET expires_at = NOW() + ($2 || ' minute')::INTERVAL
                     WHERE lock_id = $1
                     RETURNING *`,
                    [lockRow.lock_id, LOCK_MINUTES]
                );
                lockRow = refresh.rows[0];
            }
        }


        // -----------------------------
        // FETCH SECTIONS (ACTIVE ONLY)
        // -----------------------------
        const sectionsRes = await client.query(
            `SELECT *
             FROM page_sections
             WHERE page_id = $1
               AND is_deleted = FALSE
             ORDER BY sort_order ASC`,
            [page.page_id]
        );

        let sections = sectionsRes.rows;

        // -----------------------------
        // FETCH ITEMS ONLY FOR MULTIPLE SECTIONS
        // -----------------------------
        const multipleSections = sections.filter(
            section => section.section_type === 'multiple'
        );

        if (multipleSections.length > 0) {
            const sectionIds = multipleSections.map(s => s.section_id);

            const itemsRes = await client.query(
                `
        SELECT *
        FROM section_items
        WHERE section_id = ANY($1)
          AND is_deleted = FALSE
        ORDER BY sort_order ASC
        `,
                [sectionIds]
            );

            // Group items by section_id
            const itemsBySection = {};
            for (const item of itemsRes.rows) {
                if (!itemsBySection[item.section_id]) {
                    itemsBySection[item.section_id] = [];
                }
                //itemsBySection[item.section_id].push(item);
                const {

                    content,
                    ...rest
                } = item;

                itemsBySection[item.section_id].push({
                    ...rest,
                    description: content
                });
            }

            // Attach items to sections
            sections = sections.map(section => ({
                ...section,
                items:
                    section.section_type === 'multiple'
                        ? itemsBySection[section.section_id] || []
                        : []   // single → no items
            }));
        } else {
            // No multiple sections → all get empty items
            sections = sections.map(section => ({
                ...section,
                items: []
            }));
        }

          await client.query('COMMIT');

        // Attach lock status to page
        page.lock_status = lockRow && new Date(lockRow.expires_at).getTime() >= Date.now();

        // -----------------------------
        // FINAL RESPONSE
        // -----------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: 'CMS about us page data fetched successfully',
            data: {
                page,
                sections
            }
        });

    } catch (err) {
         await client.query('ROLLBACK');
        logger.error('CMS about us page list Error:', err);
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
// ADMIN - CONTACT US 
// --------------------------------------------------

responder.on('create-contactus', async (req, cb) => {

    const client = await pool.connect();

    try {
        const { page_key, body } = req;
        const { page, sections = [] } = body;

        const created_by = page.created_by;
        const assigned_to = created_by;

        // -----------------------------
        // BASIC VALIDATION
        // -----------------------------
        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page key is required"
            });
        }

        // -----------------------------
        // CONTACT US PAGE VALIDATION
        // -----------------------------
      
        
const pageKeyRes = await client.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}

const page_key_id = pageKeyRes.rows[0].page_key_id;


        await client.query('BEGIN');

        // -----------------------------
        // CHECK EXISTING ACTIVE CONTACT US PAGE
        // -----------------------------
        const activeContactUsCheck = await client.query(
            `SELECT 1 
             FROM pages 
             WHERE LOWER(page_key) = LOWER($1) 
               AND is_active = TRUE AND is_deleted = FALSE`,
               [page_key]
        );

        if (activeContactUsCheck.rowCount > 0) {
            return cb(null, {
                "header_type": "ERROR",
                "message_visibility": true,
                "status": false,
                "code": 2002,
                "message": "CMS contact us page creation failed",
                "error": "Contact Us Page already exists"
            });
        }


        // -----------------------------
        // CHECK EXISTING PAGE (INACTIVE) AND ITS RELATED DATA
        // -----------------------------
        const existingPage = await client.query(
            `SELECT page_id, is_active, is_deleted FROM pages WHERE LOWER(page_key) = LOWER($1)   ORDER BY created_at DESC LIMIT 1`,[page_key]
        );

        if (existingPage.rowCount > 0) {
            const pageData = existingPage.rows[0];

            // If existing page is inactive
            if (!pageData.is_active || pageData.is_deleted === true) {

                // Check if there are any active sections
                const activeSections = await client.query(
                    `SELECT 1 FROM page_sections 
             WHERE page_id = $1 AND is_active = TRUE AND is_deleted = FALSE LIMIT 1`,
                    [pageData.page_id]
                );

                // Check if there are any active items
                const activeItems = await client.query(
                    `SELECT 1 FROM section_items si
             JOIN page_sections ps ON si.section_id = ps.section_id
             WHERE ps.page_id = $1 AND si.is_active = TRUE AND si.is_deleted = FALSE LIMIT 1`,
                    [pageData.page_id]
                );

                if (activeSections.rowCount > 0 || activeItems.rowCount > 0) {
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2001,
                        message: "Validation failed",
                        error: "Cannot insert because inactive page has active sections or items"
                    });
                }
            }
        }
        // -----------------------------
        // INSERT PAGE
        // -----------------------------
        const insertPage = await client.query(
            `INSERT INTO pages
             (page_key, page_title, slug, is_active, sort_order, created_by, assigned_to, created_at, assigned_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
             RETURNING page_id`,
            [
                page_key,
                page.page_title,
                page.slug,
                page.is_active,
                page.sort_order,
                created_by,
                assigned_to
            ]
        );

        const page_id = insertPage.rows[0].page_id;

        // -----------------------------
        // SECTIONS & ITEMS
        // -----------------------------
        for (const section of sections) {

                        const sectionKeyRes = await client.query(
    `SELECT section_key_id 
     FROM section_key 
     WHERE LOWER(name) = LOWER($1) 
       AND page_key_id = $2 
       AND is_active = TRUE
       AND is_deleted = FALSE`,
    [section.section_key, page_key_id]
);

if (sectionKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid section key '${section.section_key}'`
    });
}


            const secCheck = await client.query(
                `SELECT section_id 
                 FROM page_sections 
                 WHERE page_id=$1 AND section_key=$2 AND is_active=TRUE AND is_deleted = FALSE`,
                [page_id, section.section_key]
            );

            if (secCheck.rowCount > 0) {
                return cb(null, {
                    "header_type": "ERROR",
                    "message_visibility": true,
                    "status": false,
                    "code": 2002,
                    "message": "Section creation failed",
                    "error": "Section already exists"
                });
            }

            const insertSection = await client.query(
                `INSERT INTO page_sections
                 (page_id, section_key, section_type, title, content, image, video,
                  button_label, button_url, section_limit,
                  is_active, sort_order, 
                  created_by, assigned_to, created_at, assigned_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
                 RETURNING section_id, section_limit`,
                [
                    page_id,
                    section.section_key,
                    section.section_type,
                    section.title,
                    section.content,
                    section.image,
                    section.video,
                    section.button_label,
                    section.button_url,
                    section.section_limit,
                    section.is_active,
                    section.sort_order,
                    created_by,
                    assigned_to
                ]
            );

            const { section_id, section_limit } = insertSection.rows[0];

            const valid =
                (section.section_type === 'single' && section_limit === null) ||
                (section.section_type === 'multiple' && section_limit !== null && section_limit !== 0);

            if (!valid) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "For 'single' section type, section limit must be null. For 'multiple' section type, section limit is required."
                });
            }

            if (section_limit === null && section.items?.length > 0) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "Items are not allowed when section limit is null"
                });
            }

            if (section_limit !== null && section.items.length > section_limit) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: `Only ${section_limit} items allowed for section ${section.section_key}`
                });
            }

            for (const item of section.items || []) {

                const itemCheck = await client.query(
                    `SELECT 1 
                     FROM section_items 
                     WHERE section_id=$1 AND title=$2 AND is_active=TRUE AND is_deleted = FALSE`,
                    [section_id, item.label_for_name]
                );

                if (itemCheck.rowCount > 0) {

                    return cb(null, {
                        "header_type": "ERROR",
                        "message_visibility": true,
                        "status": false,
                        "code": 2002,
                        "message": "Item creation failed",
                        "error": "Item already exists"
                    });
                }

                await client.query(
                    `INSERT INTO section_items
                     (section_id, title, content, image, icon, filetype,
                      sort_order, is_active,address,link,day,time,created_by, assigned_to,created_at, assigned_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())`,
                    [
                        section_id,
                        item.label_for_name,
                        item.label_for_message,
                        item.image,
                        item.label_for_email,
                        item.name,
                        item.sort_order,
                        item.is_active,
                        item.address,
                        item.link,
                        item.day,
                        item.time,
                        created_by,
                        assigned_to
                    ]
                );
            }
        }

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: "CMS contact us page created successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('CMS Error:', err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "CMS contact us page creation failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});


responder.on('update-contactus', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { page_key, body } = req;
        const { page, sections = [] } = body;

        const modified_by = page.modified_by || null;

        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page key is required"
            });
        }

        if (!page.page_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page uuid is required for update"
            });
        }

        const pageKeyRes = await client.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}

const page_key_id = pageKeyRes.rows[0].page_key_id;

        await client.query('BEGIN');

        /* ======================================================
           CHECK EDIT LOCK (PAGE LEVEL)
        ====================================================== */
        const lockCheck = await client.query(
            `
            SELECT 1
            FROM record_locks
            WHERE table_name = 'pages'
              AND record_id = $1
              AND locked_by = $2
              AND is_deleted = FALSE
              AND expires_at > NOW()
            `,
            [page.page_uuid, modified_by]
        );

        if (lockCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2005,
                message: "You must lock the page before updating",
                error: "Edit lock missing or expired"
            });
        }

        /* ======================================================
           PAGE VALIDATION
        ====================================================== */
        const pageRes = await client.query(
            `SELECT page_id, is_active, is_deleted
             FROM pages 
             WHERE page_uuid = $1`,
            [page.page_uuid]
        );

        if (pageRes.rowCount === 0) {
             return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page UUID"
    };
            //throw new Error('Invalid page UUID');
        }

        if (!pageRes.rows[0].is_active) {
             return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Inactive page cannot be updated"
    });
           // throw new Error('Inactive page cannot be updated');
        }


        if (pageRes.rows[0].is_deleted === true) {
                         return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Deleted page cannot be updated"
    });

            //throw new Error('Deleted page cannot be updated');
        }

        const page_id = pageRes.rows[0].page_id;

        await client.query(
            `UPDATE pages
             SET page_title=$1,
                 slug=$2,
                 sort_order=$3,
                is_active=$4,
                 modified_by=$5,
                 modified_at=NOW()
             WHERE page_uuid=$6`,
            [
                page.page_title,
                page.slug,
                page.sort_order,
                page.is_active,
                modified_by,
                page.page_uuid
            ]
        );

// -----------------------------
// SECTIONS & ITEMS UPDATE / INSERT
// -----------------------------
for (const section of sections) {

    
    const sectionKeyRes = await client.query(
    `SELECT section_key_id 
     FROM section_key 
     WHERE LOWER(name) = LOWER($1) 
       AND page_key_id = $2 
       AND is_active = TRUE
       AND is_deleted = FALSE`,
    [section.section_key, page_key_id]
);

if (sectionKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid section key '${section.section_key}'`
    });
}

    let section_id = null;

    // -----------------------------
    // SECTION TYPE VALIDATION
    // -----------------------------
    if (section.section_type === 'single') {
        if (section.section_limit !== null)
                                     return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section ${section.section_key} is single type; section limit must be null`
    });
            // throw new Error(`Section ${section.section_key} is single type; section limit must be null`);

        if ((section.items || []).length > 0)

        return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section ${section.section_key} is single type; no items allowed`
    });
            // throw new Error(`Section ${section.section_key} is single type; no items allowed`);

    } else if (section.section_type === 'multiple') {
        if (section.section_limit === null || section.section_limit <= 0)
            
        return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section ${section.section_key} is multiple type; section limit must have a positive value`
    });

            // throw new Error(`Section ${section.section_key} is multiple type; section limit must have a positive value`);

        if ((section.items || []).length > section.section_limit)

                    return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section ${section.section_key} is multiple type; section limit must have a positive value`
    });



            // throw new Error(`Only ${section.section_limit} items allowed for section ${section.section_key}`);
    } else {

                            return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid section type ${section.section_type} for section ${section.section_key}`
    });
        // throw new Error(`Invalid section type ${section.section_type} for section ${section.section_key}`);
    }

    // -----------------------------
    // DUPLICATE SECTION KEY CHECK
    // -----------------------------
    const duplicateSectionRes = await client.query(
        `
        SELECT 1
        FROM page_sections
        WHERE page_id = $1
          AND LOWER(section_key) = LOWER($2)
          AND is_deleted = FALSE
          AND ($3::uuid IS NULL OR section_uuid != $3)
        `,
        [
            page_id,
            section.section_key,
            section.section_uuid || null
        ]
    );

    if (duplicateSectionRes.rowCount > 0) {

          return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2002,
        message: "Updation failed",
        error: `Section ${section.section_key} already exists`
    };
       // throw new Error(`Section ${section.section_key} already exists`);
    }

    // -----------------------------
    // UPDATE SECTION
    // -----------------------------
    if (section.section_uuid) {

        const secRes = await client.query(
            `SELECT section_id, is_active, is_deleted
             FROM page_sections
             WHERE section_uuid = $1`,
            [section.section_uuid]
        );

        if (
            secRes.rowCount === 0 ||
            !secRes.rows[0].is_active ||
            secRes.rows[0].is_deleted === true
        ) {
                return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid or inactive section UUID"
    };

            //throw new Error('Invalid or inactive section UUID');
        }

        section_id = secRes.rows[0].section_id;

        await client.query(
            `UPDATE page_sections
             SET section_key = $1,
                 section_type = $2,
                 title = $3,
                 content = $4,
                 image = $5,
                 video = $6,
                 button_label = $7,
                 button_url = $8,
                 section_limit = $9,
                 is_active = $10,
                 sort_order = $11,
                 modified_by = $12,
                 modified_at = NOW()
             WHERE section_uuid = $13`,
            [
                section.section_key,
                section.section_type,
                section.title,
                section.content,
                section.image,
                section.video,
                section.button_label,
                section.button_url,
                section.section_limit,
                section.is_active,
                section.sort_order,
                modified_by,
                section.section_uuid
            ]
        );
         section_limit = section.section_limit;
    } 
    else {

        // -----------------------------
        // INSERT SECTION
        // -----------------------------
        const insertSectionRes = await client.query(
            `INSERT INTO page_sections
            (
                page_id,
                section_key,
                section_type,
                title,
                content,
                image,
                video,
                button_label,
                button_url,
                section_limit,
                is_active,
                sort_order,
                created_by,
                created_at
            )
            VALUES
            (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
            )
            RETURNING section_id`,
            [
                page_id,
                section.section_key,
                section.section_type,
                section.title,
                section.content,
                section.image,
                section.video,
                section.button_label,
                section.button_url,
                section.section_limit,
                section.is_active,
                section.sort_order,
                modified_by
            ]
        );

        section_id = insertSectionRes.rows[0].section_id;
         section_limit = section.section_limit;
    }

     /* ---------- SECTION LIMIT VALIDATION ---------- */
    if (section_limit === null && section.items?.length > 0) {

          return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Items not allowed for section ${section.section_key}`
    });
        //throw new Error(`Items not allowed for section ${section.section_key}`);
    }

    if (section_limit !== null && (section.items || []).length > section_limit) {

        return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Only ${section_limit} items allowed for section ${section.section_key}`
    });

        // throw new Error(`Only ${section_limit} items allowed for section ${section.section_key}`);
    }

    // -----------------------------
    // ITEMS UPDATE / INSERT
    // -----------------------------
    for (const item of section.items || []) {

        // -----------------------------
        // DUPLICATE ITEM TITLE CHECK
        // -----------------------------
        const duplicateItemRes = await client.query(
            `
            SELECT 1
            FROM section_items
            WHERE section_id = $1
              AND LOWER(title) = LOWER($2)
              AND is_deleted = FALSE
              AND ($3::uuid IS NULL OR item_uuid != $3)
            `,
            [
                section_id,
                item.label_for_name,
                item.item_uuid || null
            ]
        );

        if (duplicateItemRes.rowCount > 0) {

            return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2002,
        message: "Updation failed",
        error: `Item ${item.label_for_name} already exists for this section`
    });
            // throw new Error(`Item ${item.label_for_name} already exists for this section`);
        }

        // -----------------------------
        // UPDATE ITEM
        // -----------------------------
        if (item.item_uuid) {

            const itemRes = await client.query(
                `SELECT is_active, is_deleted
                 FROM section_items
                 WHERE item_uuid = $1`,
                [item.item_uuid]
            );

            if (
                itemRes.rowCount === 0 ||
                !itemRes.rows[0].is_active ||
                itemRes.rows[0].is_deleted === true
            ) {
                      return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid or inactive item"
    };
               // throw new Error('Invalid or inactive item');
            }

            await client.query(
                `UPDATE section_items
                 SET title = $1,
                     content = $2,
                     image = $3,
                     icon = $4,
                     filetype = $5,
                     sort_order = $6,
                     is_active = $7,
                     address = $8,
                     link = $9,
                     day = $10,
                     time = $11,
                     modified_by = $12,
                     modified_at = NOW()
                 WHERE item_uuid = $13`,
                [
                    item.label_for_name,
                    item.label_for_message,
                    item.image,
                    item.label_for_email,
                    item.name,
                    item.sort_order,
                    item.is_active,
                    item.address,
                    item.link,
                    item.day,
                    item.time,
                    modified_by,
                    item.item_uuid
                ]
            );

        } else {

            // -----------------------------
            // INSERT ITEM
            // -----------------------------
            await client.query(
                `INSERT INTO section_items
                (
                    section_id,
                    title,
                    content,
                    image,
                    icon,
                    filetype,
                    sort_order,
                    is_active,
                    address,
                    link,
                    day,
                    time,
                    created_by,
                    created_at
                )
                VALUES
                (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
                )`,
                [
                    section_id,
                    item.label_for_name,
                    item.label_for_message,
                    item.image,
                    item.label_for_email,
                    item.name,
                    item.sort_order,
                    item.is_active,
                    item.address,
                    item.link,
                    item.day,
                    item.time,
                    modified_by
                ]
            );
        }
    }
}


        /* ======================================================
           AUTO-UNLOCK AFTER SUCCESS
        ====================================================== */
        await client.query(
            `
            UPDATE record_locks
            SET is_deleted = TRUE,
            deleted_by = $1,
            deleted_at = NOW()
            WHERE table_name = 'pages'
              AND record_id = $2
              AND locked_by = $3
              AND is_deleted = FALSE
            `,
            [modified_by,page.page_uuid,modified_by]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: "CMS contact us page updated successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('CMS contact us page update Error:', err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "CMS contact us page update failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});


responder.on('listbyidwithlock-contactus', async (req, cb) => {

      const client = await pool.connect();
      

    try {

        const { page_uuid } = req;
        const mode = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;

        if (!page_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: 'page uuid is required'
            });
        }
 await client.query('BEGIN');

        // -----------------------------
        // FETCH PAGE (ACTIVE ONLY)
        // -----------------------------
        const pageRes = await client.query(
            `SELECT
                p.page_id,
                p.page_uuid,
                p.page_key,
                p.page_title,
                p.slug,
                p.is_active,
                p.sort_order,
                p.assigned_to,
                p.assigned_at,
                p.created_at,
                p.created_by,
                p.modified_at,
                p.modified_by,
                p.deleted_at,
                p.deleted_by,
                p.is_deleted,
                creators.username AS createdByName,
                updaters.username AS updatedByName
             FROM pages p
             LEFT JOIN users creators ON p.created_by = creators.user_uuid
             LEFT JOIN users updaters ON p.modified_by = updaters.user_uuid
             WHERE p.page_uuid = $1
               AND p.is_deleted = FALSE
             ORDER BY p.sort_order ASC, p.created_at ASC`,
            [page_uuid]
        );

        if (pageRes.rowCount === 0) {
             await client.query('ROLLBACK');
            return cb(null, {
                header_type: "SUCCESS",
                message_visibility: true,
                status: true,
                code: 2003,
                message: 'No active record found',
                data: []
            });
        }

        const page = pageRes.rows[0];

        // -----------------------------
        // EDIT MODE → LOCK HANDLING
        // -----------------------------
        let lockRow = null;
        if (mode === 'edit') {
            if (!user_id) {
                await client.query('ROLLBACK');
                return cb(null, {
                    status: false,
                    code: 2001,
                    error: "User ID required for edit"
                });
            }

            // Check existing lock
            const lockResult = await client.query(
                `SELECT RL.*, U.username AS locked_by_name
                 FROM record_locks RL
                 LEFT JOIN users U ON U.user_uuid = RL.locked_by
                 WHERE RL.table_name = 'pages'
                   AND RL.record_id = $1
                   AND RL.is_deleted = FALSE`,
                [page.page_uuid]
            );

            lockRow = lockResult.rows[0];
            const isExpired = lockRow && new Date(lockRow.expires_at).getTime() < Date.now();

            // Locked by another active user
            if (lockRow && lockRow.locked_by !== user_id && !isExpired) {
                await client.query('ROLLBACK');
                return cb(null, {
                    status: false,
                    code: 2008,
                    error: `This record is currently being edited by ${lockRow.locked_by_name || 'another user'}.`
                });
            }

            // Soft-delete expired lock
            if (lockRow && isExpired) {
                await client.query(
                    `UPDATE record_locks SET is_deleted = TRUE,
                                        deleted_by = $1,
                    deleted_at = NOW() 
                    WHERE lock_id = $2`,
                    [user_id,lockRow.lock_id]
                );
                lockRow = null;
            }

            // Create new lock
            if (!lockRow) {
                
                const insertLock = await client.query(
                    `INSERT INTO record_locks (
                        table_name,
                        record_id,
                        locked_by,
                        expires_at,
                        created_by
                    )
                    VALUES (
                        'pages',
                        $1,
                        $2,
                        NOW() + ($3 || ' minute')::INTERVAL,
                        $2
                    )
                    RETURNING *`,
                    [page.page_uuid, user_id, LOCK_MINUTES]
                );
                lockRow = insertLock.rows[0];
            }

            // Refresh lock if same user
            else if (lockRow.locked_by === user_id) {
                const refresh = await client.query(
                    `UPDATE record_locks
                     SET expires_at = NOW() + ($2 || ' minute')::INTERVAL
                     WHERE lock_id = $1
                     RETURNING *`,
                    [lockRow.lock_id, LOCK_MINUTES]
                );
                lockRow = refresh.rows[0];
            }
             await client.query('COMMIT');
        }


        // -----------------------------
        // FETCH SECTIONS (ACTIVE ONLY)
        // -----------------------------
        const sectionsRes = await client.query(
            `SELECT *
             FROM page_sections
             WHERE page_id = $1
               AND is_deleted = FALSE
             ORDER BY sort_order ASC`,
            [page.page_id]
        );

        let sections = sectionsRes.rows;

        // -----------------------------
        // FETCH ITEMS ONLY FOR MULTIPLE SECTIONS
        // -----------------------------
        const multipleSections = sections.filter(
            section => section.section_type === 'multiple'
        );

        if (multipleSections.length > 0) {
            const sectionIds = multipleSections.map(s => s.section_id);

            const itemsRes = await client.query(
                `
        SELECT *
        FROM section_items
        WHERE section_id = ANY($1)
          AND is_deleted = FALSE
        ORDER BY sort_order ASC
        `,
                [sectionIds]
            );

            // Group items by section_id
            const itemsBySection = {};
            for (const item of itemsRes.rows) {
                if (!itemsBySection[item.section_id]) {
                    itemsBySection[item.section_id] = [];
                }
                //itemsBySection[item.section_id].push(item);

                const {
                    title,
                    icon,
                    content,
                    file_type,
                    ...rest
                } = item;

                itemsBySection[item.section_id].push({
                    ...rest,
                    label_for_name: title,
                    label_for_email: icon,
                    label_for_message: content,
                    name: file_type
                });
            }

            // Attach items to sections
            sections = sections.map(section => ({
                ...section,
                items:
                    section.section_type === 'multiple'
                        ? itemsBySection[section.section_id] || []
                        : []   // single → no items
            }));
        } else {
            // No multiple sections → all get empty items
            sections = sections.map(section => ({
                ...section,
                items: []
            }));
        }

        

        // -----------------------------
        // FINAL RESPONSE
        // -----------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: 'CMS contact us page data fetched successfully',
            data: {
                page,
                sections
            }
        });

    } catch (err) {
         await client.query('ROLLBACK');
        logger.error('CMS contact us page list Error:', err);
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
// COMPANY INFO GET LIST
// --------------------------------------------------


responder.on('list-companyinfo', async (req, cb) => {
    try {

        // -----------------------------
        // FETCH PAGE (ACTIVE ONLY)
        // -----------------------------
        const pageRes = await pool.query(
            `SELECT
                p.cms_company_info_id,
                p.cms_company_info_uuid,
                p.company_name,
                p.description,
                p.support_email,
                p.contact_number,
                p.logo,
                p.ssl,
                p.master_card,
                p.visa,
                p.erp,
                p.footer_text,
                p.copyright,
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
                creators.username AS createdByName,
                updaters.username AS updatedByName
             FROM cms_company_info p
             LEFT JOIN users creators ON p.created_by = creators.user_uuid
             LEFT JOIN users updaters ON p.modified_by = updaters.user_uuid
             WHERE p.is_active = TRUE
               AND p.is_deleted = FALSE
             ORDER BY p.created_at ASC`
        );

        if (pageRes.rowCount === 0) {
            return cb(null, {
                header_type: "SUCCESS",
                message_visibility: true,
                status: true,
                code: 2003,
                message: 'No active record found',
                data: []
            });
        }


        // -----------------------------
        // FINAL RESPONSE
        // -----------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: 'CMS company info fetched successfully',
            data: pageRes.rows
        });

    } catch (err) {
        logger.error('CMS company info page list Error:', err);
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
// HOME PAGE GET LIST
// --------------------------------------------------


responder.on('list-home', async (req, cb) => {
    try {
        const { page_key } = req;

        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: 'page key is required'
            });
        }


const pageKeyRes = await pool.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}

        // -----------------------------
        // FETCH PAGE (ACTIVE ONLY)
        // -----------------------------
        const pageRes = await pool.query(
            `SELECT
                p.page_id,
                p.page_uuid,
                p.page_key,
                p.page_title,
                p.slug,
                p.sort_order
             FROM pages p
             WHERE p.page_key = $1
                            AND p.is_active = TRUE
               AND p.is_deleted = FALSE
             ORDER BY p.sort_order ASC`,
            [page_key]
        );

        if (pageRes.rowCount === 0) {
            return cb(null, {
                header_type: "SUCCESS",
                message_visibility: true,
                status: true,
                code: 2003,
                message: 'No active record found',
                data: []
            });
        }

        const page = pageRes.rows[0];

        // -----------------------------
        // FETCH SECTIONS (ACTIVE ONLY)
        // -----------------------------
        const sectionsRes = await pool.query(
            `SELECT   
            
                section_id,
                section_uuid,
                page_id,
                section_key,
                section_type,
                title,
                content,
                image,
                video,
                button_label,
                button_url,
                sort_order,
                section_limit,
                playstore_link,
                playstore_image,
                appstore_link,
                appstore_image
             FROM page_sections
             WHERE page_id = $1
              AND is_active = TRUE
               AND is_deleted = FALSE
             ORDER BY sort_order ASC`,
            [page.page_id]
        );

        let sections = sectionsRes.rows;

        // -----------------------------
        // FETCH ITEMS ONLY FOR MULTIPLE SECTIONS
        // -----------------------------
        const multipleSections = sections.filter(
            section => section.section_type === 'multiple'
        );

        if (multipleSections.length > 0) {
            const sectionIds = multipleSections.map(s => s.section_id);

            const itemsRes = await pool.query(
                `
        SELECT 
                    item_id,
                    item_uuid,
                    section_id,
                    title,
                    content,
                    image,
                    icon,
                    filetype,
                    sort_order
        FROM section_items
        WHERE section_id = ANY($1)
         AND is_active = TRUE
          AND is_deleted = FALSE
        ORDER BY sort_order ASC
        `,
                [sectionIds]
            );


            // Group items by section_id
            const itemsBySection = {};
            for (const item of itemsRes.rows) {
                if (!itemsBySection[item.section_id]) {
                    itemsBySection[item.section_id] = [];
                }
                itemsBySection[item.section_id].push(item);
            }

            // Attach items to sections
            sections = sections.map(section => {
                if (section.section_type !== "multiple") {
                    return { ...section, items: [] };
                }

                const allItems = itemsBySection[section.section_id] || [];
                const limit = Number(section.section_limit) || 0;

                return {
                    ...section,
                    items: limit > 0 ? allItems.slice(0, limit) : []
                };
            });


        } else {
            // No multiple sections → all get empty items
            sections = sections.map(section => ({
                ...section,
                items: []
            }));
        }

        // -----------------------------
        // FINAL RESPONSE
        // -----------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: 'CMS home page data fetched successfully',
            data: {
                page,
                sections
            }
        });

    } catch (err) {
        logger.error('CMS home page list Error:', err);
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
// ABOUT US PAGE GET LIST
// --------------------------------------------------

responder.on('list-aboutus', async (req, cb) => {
    try {
        const { page_key } = req;

        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: 'page key is required'
            });
        }

        const pageKeyRes = await pool.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}
        // -----------------------------
        // FETCH PAGE (ACTIVE ONLY)
        // -----------------------------
        const pageRes = await pool.query(
            `SELECT
                p.page_id,
                p.page_uuid,
                p.page_key,
                p.page_title,
                p.slug,
                p.sort_order
             FROM pages p
             WHERE p.page_key = $1
              AND p.is_active = TRUE
               AND p.is_deleted = FALSE
             ORDER BY p.sort_order ASC, p.created_at ASC`,
            [page_key]
        );

        if (pageRes.rowCount === 0) {
            return cb(null, {
                header_type: "SUCCESS",
                message_visibility: true,
                status: true,
                code: 2003,
                message: 'No active record found',
                data: []
            });
        }

        const page = pageRes.rows[0];

        // -----------------------------
        // FETCH SECTIONS (ACTIVE ONLY)
        // -----------------------------
        const sectionsRes = await pool.query(
            `SELECT 
            section_id,
                section_uuid,
                page_id,
                section_key,
                section_type,
                title,
                content,
                image,
                video,
                button_label,
                button_url,
                sort_order,
                section_limit
             FROM page_sections
             WHERE page_id = $1
              AND is_active = TRUE
               AND is_deleted = FALSE
             ORDER BY sort_order ASC`,
            [page.page_id]
        );

        let sections = sectionsRes.rows;

        // -----------------------------
        // FETCH ITEMS ONLY FOR MULTIPLE SECTIONS
        // -----------------------------
        const multipleSections = sections.filter(
            section => section.section_type === 'multiple'
        );

        if (multipleSections.length > 0) {
            const sectionIds = multipleSections.map(s => s.section_id);

            const itemsRes = await pool.query(
                `
        SELECT 
        item_id,
                    item_uuid,
                    section_id,
                    title,
                    content    AS description,
                    image,
                    icon,
                    filetype,
                    sort_order
        FROM section_items
        WHERE section_id = ANY($1)
         AND is_active = TRUE
          AND is_deleted = FALSE
        ORDER BY sort_order ASC
        `,
                [sectionIds]
            );

            // Group items by section_id
            const itemsBySection = {};
            for (const item of itemsRes.rows) {
                if (!itemsBySection[item.section_id]) {
                    itemsBySection[item.section_id] = [];
                }

                itemsBySection[item.section_id].push(item);

            }

            // Attach items to sections
            sections = sections.map(section => {
                if (section.section_type !== "multiple") {
                    return { ...section, items: [] };
                }

                const allItems = itemsBySection[section.section_id] || [];
                const limit = Number(section.section_limit) || 0;

                return {
                    ...section,
                    items: limit > 0 ? allItems.slice(0, limit) : []
                };
            });

        } else {
            // No multiple sections → all get empty items
            sections = sections.map(section => ({
                ...section,
                items: []
            }));
        }

        // -----------------------------
        // FINAL RESPONSE
        // -----------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: 'CMS about us page data fetched successfully',
            data: {
                page,
                sections
            }
        });

    } catch (err) {
        logger.error('CMS about us page list Error:', err);
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
// CONTACT US PAGE GET LIST
// --------------------------------------------------

responder.on('list-contactus', async (req, cb) => {
    try {
        const { page_key } = req;

        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: 'page key is required'
            });
        }

    const pageKeyRes = await pool.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}
        // -----------------------------
        // FETCH PAGE (ACTIVE ONLY)
        // -----------------------------
        const pageRes = await pool.query(
            `SELECT
                p.page_id,
                p.page_uuid,
                p.page_key,
                p.page_title,
                p.slug,
                p.sort_order
             FROM pages p
             WHERE p.page_key = $1
              AND p.is_active = TRUE
               AND p.is_deleted = FALSE
             ORDER BY p.sort_order ASC, p.created_at ASC`,
            [page_key]
        );

        if (pageRes.rowCount === 0) {
            return cb(null, {
                header_type: "SUCCESS",
                message_visibility: true,
                status: true,
                code: 2003,
                message: 'No active record found',
                data: []
            });
        }

        const page = pageRes.rows[0];

        // -----------------------------
        // FETCH SECTIONS (ACTIVE ONLY)
        // -----------------------------
        const sectionsRes = await pool.query(
            `SELECT 
            section_id,
                section_uuid,
                page_id,
                section_key,
                section_type,
                title,
                content,
                image,
                video,
                button_label,
                button_url,
                sort_order,
                section_limit
             FROM page_sections
             WHERE page_id = $1
              AND is_active = TRUE
               AND is_deleted = FALSE
             ORDER BY sort_order ASC`,
            [page.page_id]
        );

        let sections = sectionsRes.rows;

        // -----------------------------
        // FETCH ITEMS ONLY FOR MULTIPLE SECTIONS
        // -----------------------------
        const multipleSections = sections.filter(
            section => section.section_type === 'multiple'
        );

        if (multipleSections.length > 0) {
            const sectionIds = multipleSections.map(s => s.section_id);

            const itemsRes = await pool.query(
                `
        SELECT 
        item_id,
                    item_uuid,
                    section_id,
                    image,
                     title    AS label_for_name,
        icon     AS label_for_email,
        content  AS label_for_message,
        filetype AS name,
                    sort_order,
                    address,
                    link,
                    day,
                    time
        FROM section_items
        WHERE section_id = ANY($1)
         AND is_active = TRUE
          AND is_deleted = FALSE
        ORDER BY sort_order ASC
        `,
                [sectionIds]
            );

            // Group items by section_id
            const itemsBySection = {};
            for (const item of itemsRes.rows) {

                if (!itemsBySection[item.section_id]) {
                    itemsBySection[item.section_id] = [];
                }

                itemsBySection[item.section_id].push(item);

            }

            // Attach items to sections
            sections = sections.map(section => {
                if (section.section_type !== "multiple") {
                    return { ...section, items: [] };
                }

                const allItems = itemsBySection[section.section_id] || [];
                const limit = Number(section.section_limit) || 0;

                return {
                    ...section,
                    items: limit > 0 ? allItems.slice(0, limit) : []

                };

            });
        } else {
            // No multiple sections → all get empty items
            sections = sections.map(section => ({
                ...section,
                items: []
            }));
        }


        // -----------------------------
        // FINAL RESPONSE
        // -----------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: 'CMS contact us page data fetched successfully',
            data: {
                page,
                sections
            }
        });

    } catch (err) {
        logger.error('CMS contact us page list Error:', err);
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
// UNLOCK CMS (record_locks based)
// --------------------------------------------------

responder.on('unlock-cms', async (req, cb) => {
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
            WHERE table_name = 'pages'
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
            message_visibility: false,
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
// ADMIN - BUYER HOME 
// --------------------------------------------------


responder.on('create-buyerhome', async (req, cb) => {

    const client = await pool.connect();

    try {
        const { page_key, body } = req;
        const { page, sections = [] } = body;

        const created_by = page.created_by;
        const assigned_to = created_by;

        // -----------------------------
        // BASIC VALIDATION
        // -----------------------------
        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page key is required"
            });
        }

        // -----------------------------
        //  PAGE VALIDATION
        // -----------------------------

        
const pageKeyRes = await client.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}

const page_key_id = pageKeyRes.rows[0].page_key_id;

        await client.query('BEGIN');

        // -----------------------------
        // CHECK EXISTING ACTIVE BUYER HOME PAGE
        // -----------------------------
        const activeBuyerHomeCheck = await client.query(
            `SELECT 1 
             FROM pages 
             WHERE LOWER(page_key) = LOWER($1) 
               AND is_active = TRUE AND is_deleted = FALSE`,
               [page_key]
        );

        if (activeBuyerHomeCheck.rowCount > 0) {
            return cb(null, {
                "header_type": "ERROR",
                "message_visibility": true,
                "status": false,
                "code": 2002,
                "message": "CMS buyer home page creation failed",
                "error": "Buyer Home Page already exists"
            });
        }


        // -----------------------------
        // CHECK EXISTING PAGE (INACTIVE) AND ITS RELATED DATA
        // -----------------------------
        const existingPage = await client.query(
            `SELECT page_id, is_active, is_deleted FROM pages WHERE LOWER(page_key) = LOWER($1) ORDER BY created_at DESC LIMIT 1`,[page_key]
        );

        if (existingPage.rowCount > 0) {
            const pageData = existingPage.rows[0];

            // If existing page is inactive
            if (!pageData.is_active || pageData.is_deleted === true) {

                // Check if there are any active sections
                const activeSections = await client.query(
                    `SELECT 1 FROM page_sections 
             WHERE page_id = $1 AND is_active = TRUE AND is_deleted = FALSE LIMIT 1`,
                    [pageData.page_id]
                );

                // Check if there are any active items
                const activeItems = await client.query(
                    `SELECT 1 FROM section_items si
             JOIN page_sections ps ON si.section_id = ps.section_id
             WHERE ps.page_id = $1 AND si.is_active = TRUE AND si.is_deleted = FALSE LIMIT 1`,
                    [pageData.page_id]
                );

                if (activeSections.rowCount > 0 || activeItems.rowCount > 0) {
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2001,
                        message: "Validation failed",
                        error: "Cannot insert because inactive page has active sections or items"
                    });
                }
            }
        }
        // -----------------------------
        // INSERT PAGE
        // -----------------------------
        const insertPage = await client.query(
            `INSERT INTO pages
             (page_key, page_title, slug, is_active, sort_order, created_by, assigned_to, created_at, assigned_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
             RETURNING page_id`,
            [
                page_key,
                page.page_title,
                page.slug,
                page.is_active,
                page.sort_order,
                created_by,
                assigned_to
            ]
        );

        const page_id = insertPage.rows[0].page_id;


        // -----------------------------
        // SECTIONS & ITEMS
        // -----------------------------
        for (const section of sections) {

                        const sectionKeyRes = await client.query(
    `SELECT section_key_id 
     FROM section_key 
     WHERE LOWER(name) = LOWER($1) 
       AND page_key_id = $2 
       AND is_active = TRUE
       AND is_deleted = FALSE`,
    [section.section_key, page_key_id]
);

if (sectionKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid section key '${section.section_key}'`
    });
}


            const secCheck = await client.query(
                `SELECT section_id 
                 FROM page_sections 
                 WHERE page_id=$1 AND section_key=$2 AND is_active=TRUE AND is_deleted = FALSE`,
                [page_id, section.section_key]
            );

            if (secCheck.rowCount > 0) {
                return cb(null, {
                    "header_type": "ERROR",
                    "message_visibility": true,
                    "status": false,
                    "code": 2002,
                    "message": "Section creation failed",
                    "error": "Section already exists"
                });
            }

            const insertSection = await client.query(
                `INSERT INTO page_sections
                 (page_id, section_key, section_type, title, content, image, video,
                  button_label, button_url, section_limit,
                  is_active, sort_order, 
                  created_by, assigned_to, created_at, assigned_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
                 RETURNING section_id, section_limit`,
                [
                    page_id,
                    section.section_key,
                    section.section_type,
                    section.title,
                    section.content,
                    section.image,
                    section.video,
                    section.button_label,
                    section.button_url,
                    section.section_limit,
                    section.is_active,
                    section.sort_order,
                    created_by,
                    assigned_to
                ]
            );

            const { section_id, section_limit } = insertSection.rows[0];

            const valid =
                (section.section_type === 'single' && section_limit === null) ||
                (section.section_type === 'multiple' && section_limit !== null && section_limit !== 0);

            if (!valid) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "For 'single' section type, section limit must be null. For 'multiple' section type, section limit is required."
                });
            }

            if (section_limit === null && section.items?.length > 0) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "Items are not allowed when section limit is null"
                });
            }

            if (section_limit !== null && section.items.length > section_limit) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: `Only ${section_limit} items allowed for section ${section.section_key}`
                });
            }

            for (const item of section.items || []) {

                const itemCheck = await client.query(
                    `SELECT 1 
                     FROM section_items 
                     WHERE section_id=$1 AND title=$2 AND is_active=TRUE AND is_deleted = FALSE`,
                    [section_id, item.title]
                );

                if (itemCheck.rowCount > 0) {

                    return cb(null, {
                        "header_type": "ERROR",
                        "message_visibility": true,
                        "status": false,
                        "code": 2002,
                        "message": "Item creation failed",
                        "error": "Item already exists"
                    });
                }

                await client.query(
                    `INSERT INTO section_items
                     (section_id, title, content, image, icon, link, filetype,
                      sort_order, is_active, created_by, assigned_to, created_at, assigned_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())`,
                    [
                        section_id,
                        item.title,
                        item.content,
                        item.image,
                        item.icon,
                        item.link,
                        item.filetype,
                        item.sort_order,
                        item.is_active,
                        created_by,
                        assigned_to
                    ]
                );
            }
        }

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: "CMS buyer home page created successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('CMS Error:', err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "CMS buyer home page creation failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});


responder.on('update-buyerhome', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { page_key, body } = req;
        const { page, sections = [] } = body;

        const modified_by = page?.modified_by || null;

        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page key is required"
            });
        }

        if (!page?.page_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page uuid is required for update"
            });
        }

        const pageKeyRes = await client.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}

const page_key_id = pageKeyRes.rows[0].page_key_id;

        await client.query('BEGIN');

        /* ======================================================
           CHECK EDIT LOCK (PAGE LEVEL)
        ====================================================== */
        const lockCheck = await client.query(
            `
            SELECT 1
            FROM record_locks
            WHERE table_name = 'pages'
              AND record_id = $1
              AND locked_by = $2
              AND is_deleted = FALSE
              AND expires_at > NOW()
            `,
            [page.page_uuid, modified_by]
        );

        if (lockCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2005,
                message: "You must lock the page before updating",
                error: "Edit lock missing or expired"
            });
        }

        /* ======================================================
           PAGE VALIDATION
        ====================================================== */
        const pageRes = await client.query(
            `
            SELECT page_id, is_active, is_deleted
            FROM pages
            WHERE page_uuid = $1
            `,
            [page.page_uuid]
        );

        if (pageRes.rowCount === 0) {
                  return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page UUID"
    };
           // throw new Error('Invalid page UUID');
        }

        if (!pageRes.rows[0].is_active) {
                  return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Inactive page cannot be updated"
    };
            //throw new Error('Inactive page cannot be updated');
        }

        if (pageRes.rows[0].is_deleted) {

                        return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Deleted page cannot be updated"
    };
            //throw new Error('Deleted page cannot be updated');
        }

        const page_id = pageRes.rows[0].page_id;

        /* ======================================================
           PAGE UPDATE
        ====================================================== */
        await client.query(
            `
            UPDATE pages
            SET page_title = $1,
                slug = $2,
                sort_order = $3,
                is_active = $4,
                modified_by = $5,
                modified_at = NOW()
            WHERE page_uuid = $6
            `,
            [
                page.page_title,
                page.slug,
                page.sort_order,
                page.is_active,
                modified_by,
                page.page_uuid
            ]
        );


      /* ======================================================
    SECTIONS & ITEMS UPDATE / INSERT
====================================================== */
for (const section of sections) {

    
    const sectionKeyRes = await client.query(
    `SELECT section_key_id 
     FROM section_key 
     WHERE LOWER(name) = LOWER($1) 
       AND page_key_id = $2 
       AND is_active = TRUE
       AND is_deleted = FALSE`,
    [section.section_key, page_key_id]
);

if (sectionKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid section key '${section.section_key}'`
    });
}

    let section_id = null;
    let existing_section_limit = null;

    // -----------------------------
    // SECTION TYPE VALIDATION
    // -----------------------------
    if (section.section_type === 'single') {
        if (section.section_limit !== null)
                   return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section ${section.section_key} is single type; section limit must be null`
    });
            // throw new Error(`Section ${section.section_key} is single type; section limit must be null`);

        if ((section.items || []).length > 0)

                           return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section ${section.section_key} is single type; no items allowed`
    });
            // throw new Error(`Section ${section.section_key} is single type; no items allowed`);

    } else if (section.section_type === 'multiple') {
        if (section.section_limit === null || section.section_limit <= 0)

                                     return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section ${section.section_key} is multiple type; section limit must have a positive value`
    });
            // throw new Error(`Section ${section.section_key} is multiple type; section limit must have a positive value`);

        if ((section.items || []).length > section.section_limit)

                                               return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Only ${section.section_limit} items allowed for section ${section.section_key}`
    });
            // throw new Error(`Only ${section.section_limit} items allowed for section ${section.section_key}`);
    } else {

                                                     return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid section type ${section.section_type} for section ${section.section_key}`
    });
        // throw new Error(`Invalid section type ${section.section_type} for section ${section.section_key}`);
    }

    // -----------------------------
    // DUPLICATE SECTION KEY CHECK
    // -----------------------------
    const duplicateSectionRes = await client.query(
        `
        SELECT 1
        FROM page_sections
        WHERE page_id = $1
          AND LOWER(section_key) = LOWER($2)
          AND is_deleted = FALSE
          AND ($3::uuid IS NULL OR section_uuid != $3)
        `,
        [
            page_id,
            section.section_key,
            section.section_uuid || null
        ]
    );

    if (duplicateSectionRes.rowCount > 0) {
            return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2002,
        message: "Updation failed",
        error: `Section ${section.section_key} already exists`
    });
        //throw new Error(`Section ${section.section_key} already exists`);
    }

    // =====================================================
    // UPDATE SECTION
    // =====================================================
    if (section.section_uuid) {

        const secRes = await client.query(
            `
            SELECT section_id, section_limit, is_active, is_deleted
            FROM page_sections
            WHERE section_uuid = $1
            `,
            [section.section_uuid]
        );

        if (
            secRes.rowCount === 0 ||
            !secRes.rows[0].is_active ||
            secRes.rows[0].is_deleted
        ) {
                   return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid or inactive section UUID"
    };
            //throw new Error('Invalid or inactive section UUID');
        }

        section_id = secRes.rows[0].section_id;
       existing_section_limit = section.section_limit;

        await client.query(
            `
            UPDATE page_sections
            SET section_key = $1,
                section_type = $2,
                title = $3,
                content = $4,
                image = $5,
                video = $6,
                button_label = $7,
                button_url = $8,
                section_limit = $9,
                is_active = $10,
                sort_order = $11,
                modified_by = $12,
                modified_at = NOW()
            WHERE section_uuid = $13
            `,
            [
                section.section_key,
                section.section_type,
                section.title,
                section.content,
                section.image,
                section.video,
                section.button_label,
                section.button_url,
                section.section_limit,
                section.is_active,
                section.sort_order,
                modified_by,
                section.section_uuid
            ]
        );

    } else {

        // =====================================================
        // INSERT SECTION
        // =====================================================
        const insertSectionRes = await client.query(
            `
            INSERT INTO page_sections
            (
                page_id,
                section_key,
                section_type,
                title,
                content,
                image,
                video,
                button_label,
                button_url,
                section_limit,
                is_active,
                sort_order,
                created_by,
                created_at
            )
            VALUES
            (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
            )
            RETURNING section_id, section_limit
            `,
            [
                page_id,
                section.section_key,
                section.section_type,
                section.title,
                section.content,
                section.image,
                section.video,
                section.button_label,
                section.button_url,
                section.section_limit,
                section.is_active,
                section.sort_order,
                modified_by
            ]
        );

        section_id = insertSectionRes.rows[0].section_id;
        existing_section_limit = section.section_limit;
    }

    /* ---------- SECTION LIMIT VALIDATION ---------- */
    if (existing_section_limit === null && (section.items || []).length > 0) {
               return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Items not allowed for section ${section.section_key}`
    });

       // throw new Error(`Items not allowed for section ${section.section_key}`);
    }

    if (
        existing_section_limit !== null &&
        (section.items || []).length > existing_section_limit
    ) {

                   return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Only ${existing_section_limit} items allowed for section ${section.section_key}`
    });
        // throw new Error(`Only ${existing_section_limit} items allowed for section ${section.section_key}`);
    }

    /* ---------- ITEMS UPDATE / INSERT ---------- */
    for (const item of section.items || []) {

        // -----------------------------
        // DUPLICATE ITEM TITLE CHECK
        // -----------------------------
        const duplicateItemRes = await client.query(
            `
            SELECT 1
            FROM section_items
            WHERE section_id = $1
              AND LOWER(title) = LOWER($2)
              AND is_deleted = FALSE
              AND ($3::uuid IS NULL OR item_uuid != $3)
            `,
            [
                section_id,
                item.title,
                item.item_uuid || null
            ]
        );

        if (duplicateItemRes.rowCount > 0) {

                return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2002,
        message: "Updation failed",
        error: `Item ${item.title} already exists for this section`
    });
            //throw new Error(`Item ${item.title} already exists for this section`);
        }

        // =====================================================
        // UPDATE ITEM
        // =====================================================
        if (item.item_uuid) {

            const itemRes = await client.query(
                `
                SELECT is_active, is_deleted
                FROM section_items
                WHERE item_uuid = $1
                `,
                [item.item_uuid]
            );

            if (
                itemRes.rowCount === 0 ||
                !itemRes.rows[0].is_active ||
                itemRes.rows[0].is_deleted
            ) {
                     return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid or inactive item UUID"
    };
                //throw new Error('Invalid or inactive item UUID');
            }

            await client.query(
                `
                UPDATE section_items
                SET title = $1,
                    content = $2,
                    image = $3,
                    icon = $4,
                    link = $5,
                    filetype = $6,
                    sort_order = $7,
                    is_active = $8,
                    modified_by = $9,
                    modified_at = NOW()
                WHERE item_uuid = $10
                `,
                [
                    item.title,
                    item.content,
                    item.image,
                    item.icon,
                    item.link,
                    item.filetype,
                    item.sort_order,
                    item.is_active,
                    modified_by,
                    item.item_uuid
                ]
            );

        } else {

            // =====================================================
            // INSERT ITEM
            // =====================================================
            await client.query(
                `
                INSERT INTO section_items
                (
                    section_id,
                    title,
                    content,
                    image,
                    icon,
                    link,
                    filetype,
                    sort_order,
                    is_active,
                    created_by,
                    created_at
                )
                VALUES
                (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()
                )
                `,
                [
                    section_id,
                    item.title,
                    item.content,
                    item.image,
                    item.icon,
                    item.link,
                    item.filetype,
                    item.sort_order,
                    item.is_active,
                    modified_by
                ]
            );
        }
    }
}

        /* ======================================================
           AUTO-UNLOCK AFTER SUCCESS
        ====================================================== */
        await client.query(
            `
            UPDATE record_locks
            SET is_deleted = TRUE,
            deleted_by = $1,
            deleted_at = NOW()
            WHERE table_name = 'pages'
              AND record_id = $2
              AND locked_by = $3
              AND is_deleted = FALSE
            `,
            [modified_by,page.page_uuid,modified_by]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: "CMS buyer home page updated successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('CMS buyer home page update Error:', err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "CMS buyer home page update failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});


responder.on('listbyidwithlock-buyerhome', async (req, cb) => {

      const client = await pool.connect();
      

    try {

        const { page_uuid } = req;
        const mode = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;

        if (!page_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: 'page uuid is required'
            });
        }
 await client.query('BEGIN');

        // -----------------------------
        // FETCH PAGE (ACTIVE ONLY)
        // -----------------------------
        const pageRes = await client.query(
            `SELECT
                p.page_id,
                p.page_uuid,
                p.page_key,
                p.page_title,
                p.slug,
                p.is_active,
                p.sort_order,
                p.assigned_to,
                p.assigned_at,
                p.created_at,
                p.created_by,
                p.modified_at,
                p.modified_by,
                p.deleted_at,
                p.deleted_by,
                p.is_deleted,
                creators.username AS createdByName,
                updaters.username AS updatedByName
             FROM pages p
             LEFT JOIN users creators ON p.created_by = creators.user_uuid
             LEFT JOIN users updaters ON p.modified_by = updaters.user_uuid
             WHERE p.page_uuid = $1
               AND p.is_deleted = FALSE
             ORDER BY p.sort_order ASC, p.created_at ASC`,
            [page_uuid]
        );

        if (pageRes.rowCount === 0) {
             await client.query('ROLLBACK');
            return cb(null, {
                header_type: "SUCCESS",
                message_visibility: true,
                status: true,
                code: 2003,
                message: 'No active record found',
                data: []
            });
        }

        const page = pageRes.rows[0];

        // -----------------------------
        // EDIT MODE → LOCK HANDLING
        // -----------------------------
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
            error: "User ID required for edit"

                });
            }

            // Check existing lock
            const lockResult = await client.query(
                `SELECT RL.*, U.username AS locked_by_name
                 FROM record_locks RL
                 LEFT JOIN users U ON U.user_uuid = RL.locked_by
                 WHERE RL.table_name = 'pages'
                   AND RL.record_id = $1
                   AND RL.is_deleted = FALSE`,
                [page.page_uuid]
            );

            lockRow = lockResult.rows[0];
            const isExpired = lockRow && new Date(lockRow.expires_at).getTime() < Date.now();

            // Locked by another active user
            if (lockRow && lockRow.locked_by !== user_id && !isExpired) {
                await client.query('ROLLBACK');
                return cb(null, {
                    status: false,
                    code: 2008,
                    error: `This record is currently being edited by ${lockRow.locked_by_name || 'another user'}.`
                });
            }

            // Soft-delete expired lock
            if (lockRow && isExpired) {
                await client.query(
                    `UPDATE record_locks SET is_deleted = TRUE,
                                        deleted_by = $1,
                    deleted_at = NOW() 
                    WHERE lock_id = $2`,
                    [user_id,lockRow.lock_id]
                );
                lockRow = null;
            }

            // Create new lock
            if (!lockRow) {
                
                const insertLock = await client.query(
                    `INSERT INTO record_locks (
                        table_name,
                        record_id,
                        locked_by,
                        expires_at,
                        created_by
                    )
                    VALUES (
                        'pages',
                        $1,
                        $2,
                        NOW() + ($3 || ' minute')::INTERVAL,
                        $2
                    )
                    RETURNING *`,
                    [page.page_uuid, user_id, LOCK_MINUTES]
                );
                lockRow = insertLock.rows[0];
            }

            // Refresh lock if same user
            else if (lockRow.locked_by === user_id) {
                const refresh = await client.query(
                    `UPDATE record_locks
                     SET expires_at = NOW() + ($2 || ' minute')::INTERVAL
                     WHERE lock_id = $1
                     RETURNING *`,
                    [lockRow.lock_id, LOCK_MINUTES]
                );
                lockRow = refresh.rows[0];
            }
        }


        // -----------------------------
        // FETCH SECTIONS (ACTIVE ONLY)
        // -----------------------------
        const sectionsRes = await client.query(
            `SELECT *
             FROM page_sections
             WHERE page_id = $1
               AND is_deleted = FALSE
             ORDER BY sort_order ASC`,
            [page.page_id]
        );

        let sections = sectionsRes.rows;

        // -----------------------------
        // FETCH ITEMS ONLY FOR MULTIPLE SECTIONS
        // -----------------------------
        const multipleSections = sections.filter(
            section => section.section_type === 'multiple'
        );

        if (multipleSections.length > 0) {
            const sectionIds = multipleSections.map(s => s.section_id);

            const itemsRes = await client.query(
                `
        SELECT *
        FROM section_items
        WHERE section_id = ANY($1)
          AND is_deleted = FALSE
        ORDER BY sort_order ASC
        `,
                [sectionIds]
            );

            // Group items by section_id
            const itemsBySection = {};
            for (const item of itemsRes.rows) {
                if (!itemsBySection[item.section_id]) {
                    itemsBySection[item.section_id] = [];
                }
                itemsBySection[item.section_id].push(item);
            }

            // Attach items to sections
            sections = sections.map(section => ({
                ...section,
                items:
                    section.section_type === 'multiple'
                        ? itemsBySection[section.section_id] || []
                        : []   // single → no items
            }));
        } else {
            // No multiple sections → all get empty items
            sections = sections.map(section => ({
                ...section,
                items: []
            }));
        }


        await client.query('COMMIT');

        // Attach lock status to page
        page.lock_status = lockRow && new Date(lockRow.expires_at).getTime() >= Date.now();

        // -----------------------------
        // FINAL RESPONSE
        // -----------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: 'CMS buyer home page data fetched successfully',
            data: {
                page,
                sections
            }
        });

    } catch (err) {
         await client.query('ROLLBACK');
        logger.error('CMS buyer home page list Error:', err);
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
// BUYER HOME PAGE GET LIST
// --------------------------------------------------

responder.on('list-buyerhome', async (req, cb) => {
    try {
        const { page_key } = req;

        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: 'page key is required'
            });
        }

        const pageKeyRes = await pool.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}
        // -----------------------------
        // FETCH PAGE (ACTIVE ONLY)
        // -----------------------------
        const pageRes = await pool.query(
            `SELECT
                p.page_id,
                p.page_uuid,
                p.page_key,
                p.page_title,
                p.slug,
                p.sort_order
             FROM pages p
             WHERE p.page_key = $1
              AND p.is_active = TRUE
               AND p.is_deleted = FALSE
             ORDER BY p.sort_order ASC, p.created_at ASC`,
            [page_key]
        );

        if (pageRes.rowCount === 0) {
            return cb(null, {
                header_type: "SUCCESS",
                message_visibility: true,
                status: true,
                code: 2003,
                message: 'No active record found',
                data: []
            });
        }

        const page = pageRes.rows[0];

        // -----------------------------
        // FETCH SECTIONS (ACTIVE ONLY)
        // -----------------------------
        const sectionsRes = await pool.query(
            `SELECT 
            section_id,
                section_uuid,
                page_id,
                section_key,
                section_type,
                title,
                content,
                image,
                video,
                button_label,
                button_url,
                sort_order,
                section_limit
             FROM page_sections
             WHERE page_id = $1
              AND is_active = TRUE
               AND is_deleted = FALSE
             ORDER BY sort_order ASC`,
            [page.page_id]
        );

        let sections = sectionsRes.rows;

        // -----------------------------
        // FETCH ITEMS ONLY FOR MULTIPLE SECTIONS
        // -----------------------------
        const multipleSections = sections.filter(
            section => section.section_type === 'multiple'
        );

        if (multipleSections.length > 0) {
            const sectionIds = multipleSections.map(s => s.section_id);

            const itemsRes = await pool.query(
                `
        SELECT 
        item_id,
                    item_uuid,
                    section_id,
                    image,
                     title,
        icon  ,
        content ,
        link AS file,
                filetype,
                    sort_order,
                    is_active
        FROM section_items
        WHERE section_id = ANY($1)
         AND is_active = TRUE
          AND is_deleted = FALSE
        ORDER BY sort_order ASC
        `,
                [sectionIds]
            );

            // Group items by section_id
            const itemsBySection = {};
            for (const item of itemsRes.rows) {

                if (!itemsBySection[item.section_id]) {
                    itemsBySection[item.section_id] = [];
                }

                itemsBySection[item.section_id].push(item);

            }

            // Attach items to sections
            sections = sections.map(section => {
                if (section.section_type !== "multiple") {
                    return { ...section, items: [] };
                }

                const allItems = itemsBySection[section.section_id] || [];
                const limit = Number(section.section_limit) || 0;

                return {
                    ...section,
                    items: limit > 0 ? allItems.slice(0, limit) : []

                };

            });
        } else {
            // No multiple sections → all get empty items
            sections = sections.map(section => ({
                ...section,
                items: []
            }));
        }


        // -----------------------------
        // FINAL RESPONSE
        // -----------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: 'CMS buyer home page data fetched successfully',
            data: {
                page,
                sections
            }
        });

    } catch (err) {
        logger.error('CMS buyer home page list Error:', err);
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
// ADMIN - SELLER HOME 
// --------------------------------------------------

responder.on('create-sellerhome', async (req, cb) => {

    const client = await pool.connect();

    try {
        const { page_key, body } = req;
        const { page, sections = [] } = body;

        const created_by = page.created_by;
        const assigned_to = created_by;

        // -----------------------------
        // BASIC VALIDATION
        // -----------------------------
        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page key is required"
            });
        }

        // -----------------------------
        //  PAGE VALIDATION
        // -----------------------------

        
const pageKeyRes = await client.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}

const page_key_id = pageKeyRes.rows[0].page_key_id;

        await client.query('BEGIN');

        // -----------------------------
        // CHECK EXISTING ACTIVE SELLER HOME PAGE
        // -----------------------------
        const activeSellerHomeCheck = await client.query(
            `SELECT 1 
             FROM pages 
             WHERE LOWER(page_key)  = LOWER($1)
               AND is_active = TRUE AND is_deleted = FALSE`,[page_key]
        );

        if (activeSellerHomeCheck.rowCount > 0) {
            return cb(null, {
                "header_type": "ERROR",
                "message_visibility": true,
                "status": false,
                "code": 2002,
                "message": "CMS seller home page creation failed",
                "error": "Seller Home Page already exists"
            });
        }


        // -----------------------------
        // CHECK EXISTING PAGE (INACTIVE) AND ITS RELATED DATA
        // -----------------------------
        const existingPage = await client.query(
            `SELECT page_id, is_active, is_deleted FROM pages WHERE LOWER(page_key)  = LOWER($1)  ORDER BY created_at DESC LIMIT 1`,[page_key]
        );

        if (existingPage.rowCount > 0) {
            const pageData = existingPage.rows[0];

            // If existing page is inactive
            if (!pageData.is_active || pageData.is_deleted === true) {

                // Check if there are any active sections
                const activeSections = await client.query(
                    `SELECT 1 FROM page_sections 
             WHERE page_id = $1 AND is_active = TRUE AND is_deleted = FALSE LIMIT 1`,
                    [pageData.page_id]
                );

                // Check if there are any active items
                const activeItems = await client.query(
                    `SELECT 1 FROM section_items si
             JOIN page_sections ps ON si.section_id = ps.section_id
             WHERE ps.page_id = $1 AND si.is_active = TRUE AND si.is_deleted = FALSE LIMIT 1`,
                    [pageData.page_id]
                );

                if (activeSections.rowCount > 0 || activeItems.rowCount > 0) {
                    return cb(null, {
                        header_type: "ERROR",
                        message_visibility: true,
                        status: false,
                        code: 2001,
                        message: "Validation failed",
                        error: "Cannot insert because inactive page has active sections or items"
                    });
                }
            }
        }
        // -----------------------------
        // INSERT PAGE
        // -----------------------------
        const insertPage = await client.query(
            `INSERT INTO pages
             (page_key, page_title, slug, is_active, sort_order, created_by, assigned_to, created_at, assigned_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
             RETURNING page_id`,
            [
                page_key,
                page.page_title,
                page.slug,
                page.is_active,
                page.sort_order,
                created_by,
                assigned_to
            ]
        );

        const page_id = insertPage.rows[0].page_id;


        // -----------------------------
        // SECTIONS & ITEMS
        // -----------------------------
        for (const section of sections) {

                        const sectionKeyRes = await client.query(
    `SELECT section_key_id 
     FROM section_key 
     WHERE LOWER(name) = LOWER($1) 
       AND page_key_id = $2 
       AND is_active = TRUE
       AND is_deleted = FALSE`,
    [section.section_key, page_key_id]
);

if (sectionKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid section key '${section.section_key}'`
    });
}


            const secCheck = await client.query(
                `SELECT section_id 
                 FROM page_sections 
                 WHERE page_id=$1 AND section_key=$2 AND is_active=TRUE AND is_deleted = FALSE`,
                [page_id, section.section_key]
            );

            if (secCheck.rowCount > 0) {
                return cb(null, {
                    "header_type": "ERROR",
                    "message_visibility": true,
                    "status": false,
                    "code": 2002,
                    "message": "Section creation failed",
                    "error": "Section already exists"
                });
            }

            const insertSection = await client.query(
                `INSERT INTO page_sections
                 (page_id, section_key, section_type, title, content, image, video,
                  button_label, button_url, section_limit,
                  is_active, sort_order, 
                  created_by, assigned_to, created_at, assigned_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
                 RETURNING section_id, section_limit`,
                [
                    page_id,
                    section.section_key,
                    section.section_type,
                    section.title,
                    section.content,
                    section.image,
                    section.video,
                    section.button_label,
                    section.button_url,
                    section.section_limit,
                    section.is_active,
                    section.sort_order,
                    created_by,
                    assigned_to
                ]
            );

            const { section_id, section_limit } = insertSection.rows[0];

            const valid =
                (section.section_type === 'single' && section_limit === null) ||
                (section.section_type === 'multiple' && section_limit !== null && section_limit !== 0);

            if (!valid) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "For 'single' section type, section limit must be null. For 'multiple' section type, section limit is required."
                });
            }

            if (section_limit === null && section.items?.length > 0) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: "Items are not allowed when section limit is null"
                });
            }

            if (section_limit !== null && section.items.length > section_limit) {

                return cb(null, {
                    header_type: "ERROR",
                    message_visibility: true,
                    status: false,
                    code: 2001,
                    message: "Validation failed",
                    error: `Only ${section_limit} items allowed for section ${section.section_key}`
                });
            }

            for (const item of section.items || []) {

                const itemCheck = await client.query(
                    `SELECT 1 
                     FROM section_items 
                     WHERE section_id=$1 AND title=$2 AND is_active=TRUE AND is_deleted = FALSE`,
                    [section_id, item.title]
                );

                if (itemCheck.rowCount > 0) {

                    return cb(null, {
                        "header_type": "ERROR",
                        "message_visibility": true,
                        "status": false,
                        "code": 2002,
                        "message": "Item creation failed",
                        "error": "Item already exists"
                    });
                }

                await client.query(
                    `INSERT INTO section_items
                     (section_id,address, title, content, image, icon, link, filetype,
                      sort_order, is_active, created_by, assigned_to, created_at, assigned_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())`,
                    [
                        section_id,
                        item.address,
                        item.title,
                        item.content,
                        item.image,
                        item.icon,
                        item.link,
                        item.filetype,
                        item.sort_order,
                        item.is_active,
                        created_by,
                        assigned_to
                    ]
                );
            }
        }

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: "CMS seller home page created successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('CMS Error:', err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "CMS seller home page creation failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});

responder.on('update-sellerhome', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { page_key, body } = req;
        const { page, sections = [] } = body;

        const modified_by = page?.modified_by || null;

        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page key is required"
            });
        }

        if (!page?.page_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "page uuid is required for update"
            });
        }

        const pageKeyRes = await client.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}

const page_key_id = pageKeyRes.rows[0].page_key_id;

        await client.query('BEGIN');

        /* ======================================================
           CHECK EDIT LOCK (PAGE LEVEL)
        ====================================================== */
        const lockCheck = await client.query(
            `
            SELECT 1
            FROM record_locks
            WHERE table_name = 'pages'
              AND record_id = $1
              AND locked_by = $2
              AND is_deleted = FALSE
              AND expires_at > NOW()
            `,
            [page.page_uuid, modified_by]
        );

        if (lockCheck.rowCount === 0) {
            await client.query('ROLLBACK');
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2005,
                message: "You must lock the page before updating",
                error: "Edit lock missing or expired"
            });
        }

        /* ======================================================
           PAGE VALIDATION
        ====================================================== */
        const pageRes = await client.query(
            `
            SELECT page_id, is_active, is_deleted
            FROM pages
            WHERE page_uuid = $1
            `,
            [page.page_uuid]
        );

        if (pageRes.rowCount === 0) {
                 return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page UUID"
    };
            //throw new Error('Invalid page UUID');
        }

        if (!pageRes.rows[0].is_active) {
                 return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Inactive page cannot be updated"
    };
            //throw new Error('Inactive page cannot be updated');
        }

        if (pageRes.rows[0].is_deleted) {
                 return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Deleted page cannot be updated"
    };
            //throw new Error('Deleted page cannot be updated');
        }

        const page_id = pageRes.rows[0].page_id;

        /* ======================================================
           PAGE UPDATE
        ====================================================== */
        await client.query(
            `
            UPDATE pages
            SET page_title = $1,
                slug = $2,
                sort_order = $3,
                is_active = $4,
                modified_by = $5,
                modified_at = NOW()
            WHERE page_uuid = $6
            `,
            [
                page.page_title,
                page.slug,
                page.sort_order,
                page.is_active,
                modified_by,
                page.page_uuid
            ]
        );

 /* ======================================================
   SECTIONS & ITEMS UPDATE / INSERT
====================================================== */
for (const section of sections) {

    const sectionKeyRes = await client.query(
    `SELECT section_key_id 
     FROM section_key 
     WHERE LOWER(name) = LOWER($1) 
       AND page_key_id = $2 
       AND is_active = TRUE
       AND is_deleted = FALSE`,
    [section.section_key, page_key_id]
);

if (sectionKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid section key '${section.section_key}'`
    });
}

    let section_id = null;
    let section_limit = section.section_limit;

    // -----------------------------
    // SECTION TYPE VALIDATION
    // -----------------------------
    if (section.section_type === 'single') {
        if (section.section_limit !== null)
            return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section ${section.section_key} is single type; section limit must be null`
    });
            // throw new Error(`Section ${section.section_key} is single type; section limit must be null`);

        if ((section.items || []).length > 0)

        return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section ${section.section_key} is single type; no items allowed`
    });
            // throw new Error(`Section ${section.section_key} is single type; no items allowed`);

    } else if (section.section_type === 'multiple') {
        if (section.section_limit === null || section.section_limit <= 0)

              return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section ${section.section_key} is multiple type; section limit must have a positive value`
    });
            // throw new Error(`Section ${section.section_key} is multiple type; section limit must have a positive value`);

        if ((section.items || []).length > section.section_limit)

            return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Only ${section.section_limit} items allowed for section ${section.section_key}`
    });

            // throw new Error(`Only ${section.section_limit} items allowed for section ${section.section_key}`);
    } else {

        return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Invalid section type ${section.section_type} for section ${section.section_key}`
    });

        // throw new Error(`Invalid section type ${section.section_type} for section ${section.section_key}`);
    }

    // -----------------------------
    // DUPLICATE SECTION KEY CHECK
    // -----------------------------
    const duplicateSectionRes = await client.query(
        `
        SELECT 1
        FROM page_sections
        WHERE page_id = $1
          AND LOWER(section_key) = LOWER($2)
          AND is_deleted = FALSE
          AND ($3::uuid IS NULL OR section_uuid != $3)
        `,
        [
            page_id,
            section.section_key,
            section.section_uuid || null
        ]
    );

    if (duplicateSectionRes.rowCount > 0) {
   return {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2002,
        message: "Updation failed",
        error: `Section ${section.section_key} already exists`
    };

        //throw new Error(`Section ${section.section_key} already exists`);
    }

    // =====================================================
    // UPDATE SECTION
    // =====================================================
    if (section.section_uuid) {

        const secRes = await client.query(
            `
            SELECT section_id, section_limit, is_active, is_deleted
            FROM page_sections
            WHERE section_uuid = $1
            `,
            [section.section_uuid]
        );

        if (
            secRes.rowCount === 0 ||
            !secRes.rows[0].is_active ||
            secRes.rows[0].is_deleted
        ) {

  return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid or inactive section UUID"
    });
            //throw new Error('Invalid or inactive section UUID');
        }

        section_id = secRes.rows[0].section_id;
        section_limit = section.section_limit;

        await client.query(
            `
            UPDATE page_sections
            SET section_key = $1,
                section_type = $2,
                title = $3,
                content = $4,
                image = $5,
                video = $6,
                button_label = $7,
                button_url = $8,
                section_limit = $9,
                is_active = $10,
                sort_order = $11,
                modified_by = $12,
                modified_at = NOW()
            WHERE section_uuid = $13
            `,
            [
                section.section_key,
                section.section_type,
                section.title,
                section.content,
                section.image,
                section.video,
                section.button_label,
                section.button_url,
                section.section_limit,
                section.is_active,
                section.sort_order,
                modified_by,
                section.section_uuid
            ]
        );

    } 
    
    else {

        // =====================================================
        // INSERT SECTION
        // =====================================================
        const insertSectionRes = await client.query(
            `
            INSERT INTO page_sections
            (
                page_id,
                section_key,
                section_type,
                title,
                content,
                image,
                video,
                button_label,
                button_url,
                section_limit,
                is_active,
                sort_order,
                created_by,
                created_at
            )
            VALUES
            (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
            )
            RETURNING section_id, section_limit
            `,
            [
                page_id,
                section.section_key,
                section.section_type,
                section.title,
                section.content,
                section.image,
                section.video,
                section.button_label,
                section.button_url,
                section.section_limit,
                section.is_active,
                section.sort_order,
                modified_by
            ]
        );

        section_id = insertSectionRes.rows[0].section_id;
        section_limit = section.section_limit;
    }

    /* ---------- SECTION LIMIT VALIDATION ---------- */
    if (section_limit === null && (section.items || []).length > 0) {

        return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Items not allowed for section ${section.section_key}`
    });

       // throw new Error(`Items not allowed for section ${section.section_key}`);
    }

    if (
        section_limit !== null &&
        (section.items || []).length > section_limit
    ) {

        return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Only ${section_limit} items allowed for section ${section.section_key}`
    });
        // throw new Error(`Only ${section_limit} items allowed for section ${section.section_key}`);
    }

    /* ---------- ITEMS UPDATE / INSERT ---------- */
    for (const item of section.items || []) {

        // -----------------------------
        // DUPLICATE ITEM TITLE CHECK
        // -----------------------------
        const duplicateItemRes = await client.query(
            `
            SELECT 1
            FROM section_items
            WHERE section_id = $1
              AND LOWER(title) = LOWER($2)
              AND is_deleted = FALSE
              AND ($3::uuid IS NULL OR item_uuid != $3)
            `,
            [
                section_id,
                item.title,
                item.item_uuid || null
            ]
        );

        if (duplicateItemRes.rowCount > 0) {

             return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2002,
        message: "Updation failed",
        error: `Item ${item.title} already exists for this section`
    });
            //throw new Error(`Item ${item.title} already exists for this section`);
        }

        // =====================================================
        // UPDATE ITEM
        // =====================================================
        if (item.item_uuid) {

            const itemRes = await client.query(
                `
                SELECT is_active, is_deleted
                FROM section_items
                WHERE item_uuid = $1
                `,
                [item.item_uuid]
            );

            if (
                itemRes.rowCount === 0 ||
                !itemRes.rows[0].is_active ||
                itemRes.rows[0].is_deleted
            ) {
                  return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid or inactive item UUID"
    });
                //throw new Error('Invalid or inactive item UUID');
            }

            await client.query(
                `
                UPDATE section_items
                SET title = $1,
                    content = $2,
                    image = $3,
                    icon = $4,
                    link = $5,
                    filetype = $6,
                    sort_order = $7,
                    is_active = $8,
                    modified_by = $9,
                    address = $10,
                    modified_at = NOW()
                WHERE item_uuid = $11
                `,
                [
                    item.title,
                    item.content,
                    item.image,
                    item.icon,
                    item.link,
                    item.filetype,
                    item.sort_order,
                    item.is_active,
                    modified_by,
                    item.address,
                    item.item_uuid
                ]
            );

        } else {

            // =====================================================
            // INSERT ITEM
            // =====================================================
            await client.query(
                `
                INSERT INTO section_items
                (
                    section_id,
                    title,
                    content,
                    image,
                    icon,
                    link,
                    filetype,
                    sort_order,
                    is_active,
                    address,
                    created_by,
                    created_at
                )
                VALUES
                (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()
                )
                `,
                [
                    section_id,
                    item.title,
                    item.content,
                    item.image,
                    item.icon,
                    item.link,
                    item.filetype,
                    item.sort_order,
                    item.is_active,
                    item.address,
                    modified_by
                ]
            );
        }
    }
}

        /* ======================================================
           AUTO-UNLOCK AFTER SUCCESS
        ====================================================== */
        await client.query(
            `
            UPDATE record_locks
            SET is_deleted = TRUE,
            deleted_by = $1,
            deleted_at = NOW()
            WHERE table_name = 'pages'
              AND record_id = $2
              AND locked_by = $3
              AND is_deleted = FALSE
            `,
            [modified_by,page.page_uuid,modified_by]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: "CMS seller home page updated successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('CMS seller home page update Error:', err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "CMS seller home page update failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});

responder.on('listbyidwithlock-sellerhome', async (req, cb) => {

      const client = await pool.connect();
      

    try {

        const { page_uuid } = req;
        const mode = req.body?.mode;
        const user_id = req.body?.user_id;

        const LOCK_MINUTES = 1;

        if (!page_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: 'page uuid is required'
            });
        }
 await client.query('BEGIN');

        // -----------------------------
        // FETCH PAGE (ACTIVE ONLY)
        // -----------------------------
        const pageRes = await client.query(
            `SELECT
                p.page_id,
                p.page_uuid,
                p.page_key,
                p.page_title,
                p.slug,
                p.is_active,
                p.sort_order,
                p.assigned_to,
                p.assigned_at,
                p.created_at,
                p.created_by,
                p.modified_at,
                p.modified_by,
                p.deleted_at,
                p.deleted_by,
                p.is_deleted,
                creators.username AS createdByName,
                updaters.username AS updatedByName
             FROM pages p
             LEFT JOIN users creators ON p.created_by = creators.user_uuid
             LEFT JOIN users updaters ON p.modified_by = updaters.user_uuid
             WHERE p.page_uuid = $1
               AND p.is_deleted = FALSE
             ORDER BY p.sort_order ASC, p.created_at ASC`,
            [page_uuid]
        );

        if (pageRes.rowCount === 0) {
             await client.query('ROLLBACK');
            return cb(null, {
                header_type: "SUCCESS",
                message_visibility: true,
                status: true,
                code: 2003,
                message: 'No active record found',
                data: []
            });
        }

        const page = pageRes.rows[0];

        // -----------------------------
        // EDIT MODE → LOCK HANDLING
        // -----------------------------
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
            error: "User ID required for edit"

                });
            }

            // Check existing lock
            const lockResult = await client.query(
                `SELECT RL.*, U.username AS locked_by_name
                 FROM record_locks RL
                 LEFT JOIN users U ON U.user_uuid = RL.locked_by
                 WHERE RL.table_name = 'pages'
                   AND RL.record_id = $1
                   AND RL.is_deleted = FALSE`,
                [page.page_uuid]
            );

            lockRow = lockResult.rows[0];
            const isExpired = lockRow && new Date(lockRow.expires_at).getTime() < Date.now();

            // Locked by another active user
            if (lockRow && lockRow.locked_by !== user_id && !isExpired) {
                await client.query('ROLLBACK');
                return cb(null, {
                    status: false,
                    code: 2008,
                    error: `This record is currently being edited by ${lockRow.locked_by_name || 'another user'}.`
                });
            }

            // Soft-delete expired lock
            if (lockRow && isExpired) {
                await client.query(
                    `UPDATE record_locks SET is_deleted = TRUE,
                                        deleted_by = $1,
                    deleted_at = NOW() 
                    WHERE lock_id = $2`,
                    [user_id,lockRow.lock_id]
                );
                lockRow = null;
            }

            // Create new lock
            if (!lockRow) {
                
                const insertLock = await client.query(
                    `INSERT INTO record_locks (
                        table_name,
                        record_id,
                        locked_by,
                        expires_at,
                        created_by
                    )
                    VALUES (
                        'pages',
                        $1,
                        $2,
                        NOW() + ($3 || ' minute')::INTERVAL,
                        $2
                    )
                    RETURNING *`,
                    [page.page_uuid, user_id, LOCK_MINUTES]
                );
                lockRow = insertLock.rows[0];
            }

            // Refresh lock if same user
            else if (lockRow.locked_by === user_id) {
                const refresh = await client.query(
                    `UPDATE record_locks
                     SET expires_at = NOW() + ($2 || ' minute')::INTERVAL
                     WHERE lock_id = $1
                     RETURNING *`,
                    [lockRow.lock_id, LOCK_MINUTES]
                );
                lockRow = refresh.rows[0];
            }
        }


        // -----------------------------
        // FETCH SECTIONS (ACTIVE ONLY)
        // -----------------------------
        const sectionsRes = await client.query(
            `SELECT *
             FROM page_sections
             WHERE page_id = $1
               AND is_deleted = FALSE
             ORDER BY sort_order ASC`,
            [page.page_id]
        );

        let sections = sectionsRes.rows;

        // -----------------------------
        // FETCH ITEMS ONLY FOR MULTIPLE SECTIONS
        // -----------------------------
        const multipleSections = sections.filter(
            section => section.section_type === 'multiple'
        );

        if (multipleSections.length > 0) {
            const sectionIds = multipleSections.map(s => s.section_id);

            const itemsRes = await client.query(
                `
        SELECT *
        FROM section_items
        WHERE section_id = ANY($1)
          AND is_deleted = FALSE
        ORDER BY sort_order ASC
        `,
                [sectionIds]
            );

            // Group items by section_id
            const itemsBySection = {};
            for (const item of itemsRes.rows) {
                if (!itemsBySection[item.section_id]) {
                    itemsBySection[item.section_id] = [];
                }
                itemsBySection[item.section_id].push(item);
            }

            // Attach items to sections
            sections = sections.map(section => ({
                ...section,
                items:
                    section.section_type === 'multiple'
                        ? itemsBySection[section.section_id] || []
                        : []   // single → no items
            }));
        } else {
            // No multiple sections → all get empty items
            sections = sections.map(section => ({
                ...section,
                items: []
            }));
        }


        await client.query('COMMIT');

        // Attach lock status to page
        page.lock_status = lockRow && new Date(lockRow.expires_at).getTime() >= Date.now();

        // -----------------------------
        // FINAL RESPONSE
        // -----------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: 'CMS seller home page data fetched successfully',
            data: {
                page,
                sections
            }
        });

    } catch (err) {
         await client.query('ROLLBACK');
        logger.error('CMS seller home page list Error:', err);
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
// SELLER HOME PAGE GET LIST
// --------------------------------------------------

responder.on('list-sellerhome', async (req, cb) => {
    try {
        const { page_key } = req;

        if (!page_key?.trim()) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: 'page key is required'
            });
        }
        
        const pageKeyRes = await pool.query(
    `SELECT page_key_id 
     FROM page_key 
     WHERE LOWER(name) = LOWER($1) AND is_active = TRUE AND is_deleted = FALSE`,
    [page_key]
);

if (pageKeyRes.rowCount === 0) {
    return cb(null, {
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid page key"
    });
}
        // -----------------------------
        // FETCH PAGE (ACTIVE ONLY)
        // -----------------------------
        const pageRes = await pool.query(
            `SELECT
                p.page_id,
                p.page_uuid,
                p.page_key,
                p.page_title,
                p.slug,
                p.sort_order
             FROM pages p
             WHERE p.page_key = $1
              AND p.is_active = TRUE
               AND p.is_deleted = FALSE
             ORDER BY p.sort_order ASC, p.created_at ASC`,
            [page_key]
        );

        if (pageRes.rowCount === 0) {
            return cb(null, {
                header_type: "SUCCESS",
                message_visibility: true,
                status: true,
                code: 2003,
                message: 'No active record found',
                data: []
            });
        }

        const page = pageRes.rows[0];

        // -----------------------------
        // FETCH SECTIONS (ACTIVE ONLY)
        // -----------------------------
        const sectionsRes = await pool.query(
            `SELECT 
            section_id,
                section_uuid,
                page_id,
                section_key,
                section_type,
                title,
                content,
                image,
                video,
                button_label,
                button_url,
                sort_order,
                section_limit
             FROM page_sections
             WHERE page_id = $1
              AND is_active = TRUE
               AND is_deleted = FALSE
             ORDER BY sort_order ASC`,
            [page.page_id]
        );

        let sections = sectionsRes.rows;

        // -----------------------------
        // FETCH ITEMS ONLY FOR MULTIPLE SECTIONS
        // -----------------------------
        const multipleSections = sections.filter(
            section => section.section_type === 'multiple'
        );

        if (multipleSections.length > 0) {
            const sectionIds = multipleSections.map(s => s.section_id);

            const itemsRes = await pool.query(
                `
        SELECT 
        item_id,
                    item_uuid,
                    section_id,
                    address AS search_label,
                    image,
                     title,
        icon  ,
        content ,
        link AS file,
                filetype,
                    sort_order,
                    is_active
        FROM section_items
        WHERE section_id = ANY($1)
         AND is_active = TRUE
          AND is_deleted = FALSE
        ORDER BY sort_order ASC
        `,
                [sectionIds]
            );

            // Group items by section_id
            const itemsBySection = {};
            for (const item of itemsRes.rows) {

                if (!itemsBySection[item.section_id]) {
                    itemsBySection[item.section_id] = [];
                }

                itemsBySection[item.section_id].push(item);

            }

            // Attach items to sections
            sections = sections.map(section => {
                if (section.section_type !== "multiple") {
                    return { ...section, items: [] };
                }

                const allItems = itemsBySection[section.section_id] || [];
                const limit = Number(section.section_limit) || 0;

                return {
                    ...section,
                    items: limit > 0 ? allItems.slice(0, limit) : []

                };

            });
        } else {
            // No multiple sections → all get empty items
            sections = sections.map(section => ({
                ...section,
                items: []
            }));
        }


        // -----------------------------
        // FINAL RESPONSE
        // -----------------------------
        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: 'CMS seller home page data fetched successfully',
            data: {
                page,
                sections
            }
        });

    } catch (err) {
        logger.error('CMS seller home page list Error:', err);
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
// UPDATE SECTION LIMIT 
// --------------------------------------------------


responder.on('update-section-limit', async (req, cb) => {
    const client = await pool.connect();

    try {
        const { body } = req;
        const {
            page_uuid,
            section_uuid,
            section_limit,
            modified_by
        } = body;

        if (!section_uuid) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "section uuid is required"
            });
        }

        if (!modified_by) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "modified by is required"
            });
        }

        if (
            section_limit === null ||
            section_limit === undefined ||
            isNaN(section_limit) ||
            Number(section_limit) <= 0
        ) {
            return cb(null, {
                header_type: "ERROR",
                message_visibility: true,
                status: false,
                code: 2001,
                message: "Validation failed",
                error: "section limit must be greater than 0"
            });
        }

        await client.query('BEGIN');

        /* ======================================================
           SECTION VALIDATION
        ====================================================== */
        const sectionRes = await client.query(
            `
            SELECT 
                section_id,
                section_type,
                section_limit,
                is_active,
                is_deleted
            FROM page_sections
            WHERE section_uuid = $1
            `,
            [section_uuid]
        );

        if (sectionRes.rowCount === 0) {
              return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Invalid section UUID"
    });
            //throw new Error('Invalid section UUID');
        }

        const sectionData = sectionRes.rows[0];

        if (!sectionData.is_active || sectionData.is_deleted) {

              return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Inactive or deleted section cannot be updated"
    });
        }

        if (sectionData.section_type !== 'multiple') {
                      return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: "Section limit can be updated only for multiple type sections"
    });
        }

        /* ======================================================
           ITEM COUNT VALIDATION
        ====================================================== */
        const itemCountRes = await client.query(
            `
            SELECT COUNT(*)::int AS item_count
            FROM section_items
            WHERE section_id = $1
              AND is_deleted = FALSE
              AND is_active = TRUE
            `,
            [sectionData.section_id]
        );

        const item_count = itemCountRes.rows[0].item_count;

        if (Number(section_limit) < item_count) {

        return cb(null,{
        header_type: "ERROR",
        message_visibility: true,
        status: false,
        code: 2001,
        message: "Validation failed",
        error: `Section limit cannot be less than existing item count (${item_count})`
    });
        }

        /* ======================================================
           UPDATE SECTION LIMIT
        ====================================================== */
        await client.query(
            `
            UPDATE page_sections
            SET section_limit = $1,
                modified_by = $2,
                modified_at = NOW()
            WHERE section_uuid = $3
            `,
            [
                section_limit,
                modified_by,
                section_uuid
            ]
        );

        await client.query('COMMIT');

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: "Section limit updated successfully"
        });

    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('Update section limit Error:', err);

        return cb(null, {
            header_type: "ERROR",
            message_visibility: true,
            status: false,
            code: 2004,
            message: "Section limit update failed",
            error: err.message
        });
    } finally {
        client.release();
    }
});

// --------------------------------------------------
// RECORD AVAILABILITY CHECK
// --------------------------------------------------

responder.on('list-pages', async (req, cb) => {
    try {
      const pageKeyRes = await pool.query(
    `SELECT name 
     FROM page_key 
     WHERE is_active = TRUE 
       AND is_deleted = FALSE`
);

const requiredPages = pageKeyRes.rows.map(row => row.name.toLowerCase());

        // Fetch full page details for active and non-deleted pages
        const pageRes = await pool.query(
            `
            SELECT *
    FROM pages
    WHERE LOWER(page_key) = ANY($1)
      AND is_deleted = FALSE
      AND is_active = TRUE
            `,
            [requiredPages]
        );

        // Prepare response with availability + page data
        const pageAvailability = requiredPages.map(key => {
            const pageData = pageRes.rows.find(row => row.page_key === key);

            return {
                page_key: key,
                is_available: !!pageData,
                page_data: pageData || null
            };
        });

        // Flag to check if all required pages exist
        const allPagesAvailable = pageAvailability.every(p => p.is_available);

        return cb(null, {
            header_type: "SUCCESS",
            message_visibility: false,
            status: true,
            code: 1000,
            message: 'Page availability checked successfully',
            data: {
                all_pages_available: allPagesAvailable,
                pages: pageAvailability
            }
        });

    } catch (err) {
        logger.error('Page availability check error:', err);

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