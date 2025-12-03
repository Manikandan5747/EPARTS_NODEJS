
async function buildAdvancedSearchQuery({
    pool,
    reqBody,
    table,
    alias = 't',
    defaultSort = 'created_at',
    joinSql = '',
    allowedFields = [],
    customFields = {},
    baseWhere = ''
}) {

    /* ---------------- Unpack Request ---------------- */
    const {
        Page = 1,
        PageSize = 10,
        SearchTerm = {},
        SortInfo = {},
        advanceFilters = []
    } = reqBody || {};

    const page = Math.max(+Page || 1, 1);
    const pageSize = Math.min(Math.max(+PageSize || 10, 1), 100);
    const offset = (page - 1) * pageSize;

    const safeOps = new Set(['=', '!=', '<', '<=', '>', '>=', 'ILIKE']);
    const where = [];
    const params = [];

    /* -------- Register custom fields into allowed list ------- */
    for (const key of Object.keys(customFields)) {
        if (!allowedFields.includes(key)) allowedFields.push(key);
    }

    const isoDate = (dStr) => {
        const d = new Date(dStr);
        return Number.isNaN(d) ? null : d.toISOString().slice(0, 10);
    };

    const addClause = (clause, value) => {
        where.push(clause);
        params.push(value);
    };

    /* ---------------- Basic SearchTerm ---------------- */
    for (const [field, obj] of Object.entries(SearchTerm)) {
        const val = obj?.filterVal;
        if (!val) continue;

        const col = customFields[field]?.search ||
            (allowedFields.includes(field) ? `${alias}.${field}` : null);

        if (!col) continue;

        if (['created_at', 'modified_at'].includes(field)) {
            const d = isoDate(val);
            if (d) addClause(`DATE(${col}) = $${params.length + 1}`, d);
        } else {
            addClause(`${col} ILIKE $${params.length + 1}`, `%${val}%`);
        }
    }

    /* ---------------- Advanced Search (AND/OR) ---------------- */
    let advClauses = [];
    let joinOperator = "AND";

    for (let i = 0; i < advanceFilters.length; i++) {
        const filter = advanceFilters[i];
        const field = filter.selectedField;
        const op = (filter.comparisonOperator || '=').toUpperCase();
        const val = filter.filterCriteria;
        const logic = (filter.logicalOperator || 'AND').toUpperCase();

        if (!val || !field || !safeOps.has(op)) continue;

        const col = customFields[field]?.search ||
            (allowedFields.includes(field) ? `${alias}.${field}` : null);

        if (!col) continue;

        const clause = `${col} ${op} $${params.length + 1}`;
        params.push(val);

        if (i === 0 || logic === 'ONLY') {
            advClauses = [clause];
            joinOperator = 'AND';
            if (logic === 'ONLY') break;
        } else {
            advClauses.push(clause);
            joinOperator = logic === 'OR' ? 'OR' : 'AND';
        }
    }

    /* ---------------- SELECT List ---------------- */
    const selectList = [`${alias}.*`];
    for (const [key, cfg] of Object.entries(customFields)) {
        if (cfg.select) selectList.push(`${cfg.select} AS "${key}"`);
    }

    /* ---------------- WHERE ---------------- */
    const whereParts = [];
    if (baseWhere) whereParts.push(baseWhere);
    if (where.length) whereParts.push(`(${where.join(' AND ')})`);
    if (advClauses.length) whereParts.push(`(${advClauses.join(` ${joinOperator} `)})`);

    const whereSQL = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    /* ---------------- SORT ---------------- */
    const sortCol =
        customFields[SortInfo.field]?.sort ||
        (allowedFields.includes(SortInfo.field) ? `${alias}.${SortInfo.field}` : `${alias}.${defaultSort}`);

    const sortDir = String(SortInfo.order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    /* ---------------- COUNT Query ---------------- */
    const countSQL = `
        SELECT COUNT(*)
        FROM ${table} ${alias}
        ${joinSql}
        ${whereSQL}
    `.trim();

    console.log(countSQL);

    const { rows: [{ count }] } = await pool.query(countSQL, params);
    const total = Number(count);
    const totalPages = Math.ceil(total / pageSize);

    /* ---------------- DATA Query ---------------- */
    const dataSQL = `
        SELECT ${selectList.join(',\n               ')}
        FROM ${table} ${alias}
        ${joinSql}
        ${whereSQL}
        ORDER BY ${sortCol} ${sortDir}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `.trim();

    console.log(dataSQL);

    const { rows } = await pool.query(dataSQL, [...params, pageSize, offset]);

    return {
        page,
        pageSize,
        total,
        totalPages,
        data: rows
    };
}


module.exports = { buildAdvancedSearchQuery };
