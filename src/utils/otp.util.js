const twilio = require('twilio');
const { prisma } = require('../config/db');

// initialize Twilio client

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

/**
 * Generate a 6-digit OTP
 * @returns {string} 6-digit OTP
 */

const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Sav OTP to database and set expiry
 * @param {string} userId - User ID
 * @param {string} otp - Generated OTP
 */

const saveOTP = async (userId, otp) => {
    // calculate expiry ( e.g 5 minutes from now)
    const expiresAt = new Date(Date.now() + parseInt(process.env.OTP_EXPIRY) * 1000);

    // check if user already has an OTP

    const existingOtp = await prisma.otpData.findUnique({
        where: { userId }
    });

    if (existingOtp) {
        // update existing OTP
        return await prisma.otpData.update({
            where: { userId },
            data: { otp, expiresAt}
        });
    } else {
        // create new OTP
        return await prisma.otpData.create({
            data: { userId, otp, expiresAt }
        }); 
    }
};

/**
 * Send OTP via SMS using TWILIO
 * @param {string} phoneNumber - User's phone number
 * @param {string} otp - Generated OTP
 */

const sendOTPViaSMS = async (phoneNumber, otp) => {
    try {

        await twilioClient.messages.create({
            body: `Your M2You verification code is ${otp}. This code will expire in 5 minutes.`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phoneNumber
        });

        return true;
    } catch (error) {
        console.error(`Error sending SMS: error.message}`);
        return false;
    }
};

/**
 * Verify OTP provided by User
 * @param {string} userId - User's ID
 * @param {string} providedOtp - OTP provided by User
 * @param {string} whether OTP is valid 
 * */

const verifyOTP = async (userId, providedOtp) => {
    const otpData = await prisma.otpData.findUnique({
        where: { userId}
    });

    if (!otpData) {
        return false;
    }

    // check if OTP is expired
    if (otpData.otp !== providedOtp) {
        return false;
    }

    // OTP IS Valid, delete it after use
    await prisma.otpData.delete({
        where: { userId }
    });

    return true;
};

module.exports = {
    generateOTP,
    saveOTP,
    sendOTPViaSMS,
    verifyOTP
};