module.exports = function validateMaster(entityName, action, payload) {
    const schema = require('@libs/common/masters.schema');

    const requiredFields = schema?.[entityName]?.[action];
    console.log("requiredFields",requiredFields);
    
    if (!requiredFields) return null; // no validation required

    for (const field of requiredFields) {
        if (
            payload[field] === undefined ||
            payload[field] === null ||
            payload[field] === ''
        ) {
            return `${field} is required`;
        }
    }

    return null;
};
