

const jwt = require('jsonwebtoken');

/**
 * Generates a JWT token for authenticated users.
    * @param {Object} user - The user object containing user information( from the database).
    * @returns {string} - The generated JWT token.
 */

const generateToken = (user) => {
    return jwt.sign(
        {
            id: user.id,
            phoneNumber: user.phoneNumber
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRY}
    );
};


/**
 * Verifies the provided JWT token.
 * @param {string} token - The JWT token to verify.
 * @returns {Object} - The decoded token payload if verification is successful, otherwise null(Decode token payload).
 */

const verifyToken = (token) => {
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        throw new Error('Invalid token');
        
    }
};

module.exports = {
    generateToken,
    verifyToken
}