require('module-alias/register');

const express = require('express');
const bodyParser = require('body-parser');
const registerRoutes = require('./imports-routes/index');
const app = express()
const errorHandler = require('@libs/error-handler/error-handler');
const logger = require('@libs/logger/logger');
const path = require('path');
app.use(bodyParser.json())
const cors = require('cors');
const setupStaticFiles = require('@libs/folders-paths/setup-static-files');
const checkApiKey = require('@libs/JWT/apikey-auth-api');

app.use(cors()); // Enables CORS for all origins and all routes
// --------------------------------------
// ENABLE CORS FOR SPECIFIC ORIGINS
// --------------------------------------
// const allowedOrigins = [
//    'http://localhost:3000',
//    'http://localhost:3000',
//    'https://yourdomain.com'
// ];

// app.use(cors({
//    origin: function (origin, callback) {
//       if (!origin || allowedOrigins.includes(origin)) {
//          callback(null, true);
//       } else {
//          callback(new Error('Not allowed by CORS'));
//       }
//    },
//    methods: ['GET', 'POST', 'PUT', 'DELETE'],
//    credentials: true
// }));

// 🔹 Map static files
setupStaticFiles(app);


// // PUBLIC ROUTES
// const AdminPublicRoutes = require('./routes/admin.public.routes');
// const BuyerPublicRoutes = require('./routes/buyer.public.routes');
// const SellerPublicRoutes = require('./routes/seller.public.routes');

// /* --------------------------------
//    PUBLIC ROUTES (NO AUTH)
// --------------------------------- */
// app.use('/api', checkApiKey, AdminPublicRoutes);
// app.use('/buyer', checkApiKey, BuyerPublicRoutes);
// app.use('/seller', checkApiKey, SellerPublicRoutes);



// Assign assigned_to middleware
const assignAssignedTo = (req, res, next) => {
    if (req.method === "POST" && req.body) {
        req.body.assigned_to = req.body.created_by || req.body.assigned_to;
    }
    next();
};


// /* -------------------------------
//    PROTECTED ROUTES wITH ACCESSTOKEN 
// -------------------------------- */

registerRoutes(app, { checkApiKey, assignAssignedTo });

// GLOBAL ERROR HANDLER
app.use(errorHandler);


app.listen(3000, '0.0.0.0', (err) => {
    if (err) {
        logger.error('Failed to start server:', err);
        process.exit(1);
    }
    logger.info('Server listening on port 3000');
});
