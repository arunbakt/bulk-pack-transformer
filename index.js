require('dotenv').config();
const express = require('express');
require('express-async-errors');
const bodyParser = require('body-parser');
const rp = require('request-promise-native');
const { Pool } = require('pg');
const Data = require('./src/data');

const config = require('./config/config');

const pool = new Pool({
  connectionString: config.connectionString
});

pool.on('connect', (client) => {
  console.log(`connected ${client}`);
})

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const data = new Data(pool);

const app = express();
const port = process.env.NODE_PORT || 3005;


app.use(bodyParser.urlencoded({ extended: false })); // parse application/x-www-form-urlencoded
app.use(bodyParser.json()); // parse application/json

// Optional fallthrough error handler
app.use(function(err, req, res, next) {
  // The error id is attached to `res.sentry` to be returned
  // and optionally displayed to the user for support.
  res.status(500).send(`Error occurred ${err}`);
});


app.set('view engine','html');

app.post('/planter', async (req, res) => {
  const planter = await data.findOrCreateUser(req.body.planter_identifier, req.body.first_name, req.body.last_name, req.body.organization);
  const body = { ...req.body };
  body.phone = planter.phone;
  body.email = planter.email;
  await data.createPlanterRegistration(planter.id, req.body.device_identifier, body);
  console.log(`processed planter ${planter.id}`);
  res.status(200).json({});
});

app.post('/tree', async (req, res) => {
    const user = await data.findUser(req.body.planter_identifier);
    if(user == null){
      res.status(404).json({'error' : `planter not found ${req.body.planter_identifier}`})
      return
    }

    let duplicate = null;
    if(req.body.uuid !== null 
      && req.body.uuid !== undefined
      && req.body.uuid !== ""){
      duplicate  = await data.checkForExistingTree(req.body.uuid);
    }
    if(duplicate !== null){
      res.status(200).json({ duplicate });
    } else if(config.useFieldDataService === "true") {
        // translate to field-data capture payload
        const tree = req.body
        const capture = { 
          ...tree,
          planter_id: user.id
        };
        const options = {
          method: 'POST',
          uri: `${config.fieldDataURL}raw-captures`,
          body: capture,
          json: true // Automatically stringifies the body to JSON
        };
        const fieldCapture = await rp(options);
        res.status(201).json({ fieldCapture });
    } else {
        const tree = await data.createTree( user.id, req.body.device_identifier, req.body);
        console.log(`created tree ${tree.uuid}`);
        res.status(201).json({ tree });
    }
});

app.put('/device', async (req, res) => {
    const device = await data.upsertDevice(req.body);
    res.status(200).json({ device });

});


app.use((err, req, res, next) => {
  res.status(500);
  res.json({ error: err.message });
  next(err);
});


app.listen(port,()=>{
    console.log(`listening on port ${port}`);
});

module.exports = app;
