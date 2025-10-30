import devConfig from "./config.dev.js";
import testConfig from "./config.test.js";
import prodConfig from "./config.prod.js";

const env = process.env.NODE_ENV || "development";

let config;
switch (env) {
  case "production":
    config = prodConfig;
    break;
  case "test":
    config = testConfig;
    break;
  default:
    config = devConfig;
}

export default config;


// example
// import express from "express";
// import axios from "axios";
// import config from "../config/index.js";
// import { successResponse, errorResponse } from "../common-utils/responseHandler.js";

// const router = express.Router();

// router.get("/crmCheck/:mobile", async (req, res) => {
//   try {
//     const mobile = req.params.mobile;
//     const url = `${config.CRM_BASE_URL}/getDetailBymobilecrmchk/${mobile}`;

//     const response = await axios.get(url, {
//       headers: { apikey: config.CRM_API_KEY },
//     });

//     if (response.data.status === 1) {
//       return successResponse(res, response.data, "Customer found in CRM");
//     } else {
//       return errorResponse(res, "Customer not found in CRM");
//     }
//   } catch (error) {
//     return errorResponse(res, error.message);
//   }
// });

// export default router;
