module.exports = {
    'product-types': {
        create: ['code', 'name'],
        update: ['code', 'name']
    },

    'countries': {
        create: ['name', 'country_code'],
        update: ['name', 'country_code']
    },

    'currency': {
        create: ['currency_name', 'currency_code'],
        update: ['currency_name']
    },

    'states': {
        create: ['name', 'country_id'],
        update: ['name']
    },

    'cities': {
        create: ['name', 'state_id'],
        update: ['name']
    },

    'settings': {
        create: ['setcategory', 'setparameter', 'setparametervalue'],
        update: ['setparametervalue']
    }
};
