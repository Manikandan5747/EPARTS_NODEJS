/**
 * ✅ Common Response Utility for APIs
 * Ensures consistent structure for both success and error responses
 */

export const successResponse = (res, data = {}, message = "Success", statusCode = 200,errorCode = 1001) => {
  return res.status(statusCode).json({
    status: 1,
    message,
    data,errorCode,
    timestamp: new Date().toISOString()
  });
};

export const errorResponse = (
  res,
  message = "An error occurred",
  errorCode = 1002,
  statusCode = 400,
  data = []
) => {
  return res.status(statusCode).json({
    status: 0,
    message,
    errorCode,
    data,
    timestamp: new Date().toISOString()
  });
};


// import express from "express";
// import axios from "axios";
// import { successResponse, errorResponse } from "../../common-utils/responseHandler.js";
// import config from "../../config/index.js";

// const router = express.Router();

// router.get("/crmCheck/:mobile", async (req, res) => {
//   try {
//     const { mobile } = req.params;
//     const url = `${config.CRM_BASE_URL}/getDetailBymobilecrmchk/${mobile}`;

//     const response = await axios.get(url, {
//       headers: { apikey: config.CRM_API_KEY },
//     });

//     if (response.data.status === 1) {
//       return successResponse(res, response.data, "Customer found");
//     } else {
//       return errorResponse(res, "Customer not found", "CUSTOMER_NOT_FOUND", 404);
//     }
//   } catch (err) {
//     console.error("CRM Check Error:", err.message);
//     return errorResponse(res, "Internal Server Error", "INTERNAL_ERROR", 500);
//   }
// });

// export default router;
