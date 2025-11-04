require('module-alias/register');

const express = require('express');
const bodyParser = require('body-parser');
const UsersRoutes = require('./routes/users.routes');
const RoleRoutes = require('./routes/role.routes');

const setupStaticFiles =  require('@libs/folders-paths/setup-static-files');
const cors = require('cors');


const app = express();
app.use(bodyParser.json());

// Load all static directories automatically
setupStaticFiles(app);

app.use(cors({
    origin: '*',      // allow Angular app
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }));

// const allowedOrigins = [
//   'http://localhost:4200',
//   'https://10.33.30.5',
//   'http://10.33.30.5/EpartsAdmin',
// ];

// app.use(cors({
//   origin: function (origin, callback) {
//     if (!origin || allowedOrigins.includes(origin)) {
//       callback(null, true);
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   },
//   credentials: true
// }));

// Register route groups
app.use('/user', UsersRoutes);

app.use('/role', RoleRoutes);



app.listen(3000, () => console.log('API Gateway listening on port 3000'));
