import CryptoJS from "crypto-js";

const SECRET_KEY = "MySuperSecretKey123!"; 

// 🔒 Encrypt text
export const encryptData = (text) => {
  return CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
};

// 🔓 Decrypt text
export const decryptData = (cipherText) => {
  const bytes = CryptoJS.AES.decrypt(cipherText, SECRET_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
};




// import { encryptData, decryptData } from "../common-utils/encryption.js";

// const originalText = "971558943057";
// const encrypted = encryptData(originalText);
// const decrypted = decryptData(encrypted);

// console.log("Encrypted:", encrypted);
// console.log("Decrypted:", decrypted);
