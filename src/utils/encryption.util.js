// src/utils/encryption.util.js
const crypto = require('crypto');

/**
 * Generate RSA key pair
 * @returns {Object} Public and private keys
 */
const generateKeyPair = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });
  
  return { publicKey, privateKey };
};

/**
 * Generate symmetric AES key for message encryption
 * @returns {Buffer} AES key
 */
const generateAESKey = () => {
  return crypto.randomBytes(32); // 256 bits
};

/**
 * Encrypt AES key with recipient's public key
 * @param {Buffer} aesKey - AES key to encrypt
 * @param {string} recipientPublicKey - Recipient's public key in PEM format
 * @returns {string} Base64 encoded encrypted key
 */
const encryptKey = (aesKey, recipientPublicKey) => {
  const encryptedKey = crypto.publicEncrypt(
    {
      key: recipientPublicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    },
    aesKey
  );
  
  return encryptedKey.toString('base64');
};

/**
 * Decrypt AES key with user's private key
 * @param {string} encryptedKey - Base64 encoded encrypted key
 * @param {string} privateKey - User's private key in PEM format
 * @returns {Buffer} Decrypted AES key
 */
const decryptKey = (encryptedKey, privateKey) => {
  const buffer = Buffer.from(encryptedKey, 'base64');
  
  const decryptedKey = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    },
    buffer
  );
  
  return decryptedKey;
};

/**
 * Encrypt message with AES key
 * @param {string} message - Message to encrypt
 * @param {Buffer} aesKey - AES key
 * @returns {string} Base64 encoded encrypted message
 */
const encryptMessage = (message, aesKey) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  
  let encrypted = cipher.update(message, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();
  
  // Combine IV, auth tag, and encrypted data
  const result = JSON.stringify({
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    encryptedData: encrypted
  });
  
  return Buffer.from(result).toString('base64');
};

/**
 * Decrypt message with AES key
 * @param {string} encryptedMessage - Base64 encoded encrypted message
 * @param {Buffer} aesKey - AES key
 * @returns {string} Decrypted message
 */
const decryptMessage = (encryptedMessage, aesKey) => {
  const encryptedObj = JSON.parse(Buffer.from(encryptedMessage, 'base64').toString());
  
  const iv = Buffer.from(encryptedObj.iv, 'base64');
  const authTag = Buffer.from(encryptedObj.authTag, 'base64');
  const encryptedData = encryptedObj.encryptedData;
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

module.exports = {
  generateKeyPair,
  generateAESKey,
  encryptKey,
  decryptKey,
  encryptMessage,
  decryptMessage
};