const express = require('express')
const bodyParser = require('body-parser');
const AdminRoutes = require('./routes/admin.routes');
const BuyerRoutes = require('./routes/buyer.routes');
const SellerRoutes = require('./routes/seller.routes');
const app = express()
const errorHandler = require('@libs/error-handler/error-handler');
const checkApiKey = require('@libs/JWT/apikey-auth-api');
const logger = require('@libs/logger/logger');
const path = require('path');
app.use(bodyParser.json())
const cors = require('cors');

// API AUTHENTICATION – ACCESS TOKEN CHECKING FOR EACH REQUEST
const AdminStartAuthApi = require("@libs/JWT/admin-auth-api");
const BuyerStartAuthApi = require("@libs/JWT/buyer-auth-api");
const SellerStartAuthApi = require("@libs/JWT/seller-auth-api");


// --------------------------------------
// ENABLE CORS FOR SPECIFIC ORIGINS
// --------------------------------------
const allowedOrigins = [
   'http://localhost:3000',
   'http://localhost:4000',
   'http://10.33.30.5:3000',
];

app.use(cors({
   origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
         callback(null, true);
      } else {
         callback(new Error('Not allowed by CORS'));
      }
   },
   methods: ['GET', 'POST', 'PUT', 'DELETE'],
   credentials: true
}));


// PUBLIC ROUTES
const AdminPublicRoutes = require('./routes/admin.public.routes');
const BuyerPublicRoutes = require('./routes/buyer.public.routes');
const SellerPublicRoutes = require('./routes/seller.public.routes');

/* --------------------------------
   PUBLIC ROUTES (NO AUTH)
--------------------------------- */
app.use('/api', checkApiKey, AdminPublicRoutes);
app.use('/buyer', checkApiKey, BuyerPublicRoutes);
app.use('/seller', checkApiKey, SellerPublicRoutes);

// /* -------------------------------
//    PROTECTED ROUTES wITH ACCESSTOKEN 
// -------------------------------- */
// app.use('/api', checkApiKey, AdminStartAuthApi, AdminRoutes);
// app.use('/buyer', checkApiKey, BuyerStartAuthApi, BuyerRoutes);
// app.use('/seller', checkApiKey, SellerStartAuthApi, SellerRoutes);


// /* -------------------------------
//    PROTECTED ROUTES wITH ACCESSTOKEN 
// -------------------------------- */
app.use('/api', checkApiKey,  AdminRoutes);
app.use('/buyer', checkApiKey,  BuyerRoutes);
app.use('/seller', checkApiKey,  SellerRoutes);


app.use(
  '/countries',
  express.static(path.join('/app/logs', 'countries'))
);


// GLOBAL ERROR HANDLER
app.use(errorHandler);

app.listen(3000, (err) => {
    if (err) {
        logger.error('Failed to start server:', err);
        process.exit(1);
    }
    logger.info('Server listening on port 3000');
});
