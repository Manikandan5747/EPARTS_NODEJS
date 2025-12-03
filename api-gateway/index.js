require('module-alias/register');

const express = require('express');
const bodyParser = require('body-parser');
const AdminRoutes = require('./admin.routes');

// const setupStaticFiles =  require('@libs/folders-paths/setup-static-files');
const cors = require('cors');


const app = express();
app.use(bodyParser.json());

// Load all static directories automatically
// setupStaticFiles(app);

app.use(cors({
    origin: '*',      // allow Angular app
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }));


app.use('/', AdminRoutes);



app.listen(3000, () => console.log('API Gateway listening on port 3000'));
